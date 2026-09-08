//=============================================================================
// GigaHack MV/MZ
// 21 · gallery.js — bulk unlocks across a project's own switch sections
//-----------------------------------------------------------------------------
// RPG Maker has no "gallery" object to unlock. What a project WITH a gallery
// has instead is a run of switches under a header, and a menu that draws
// whatever those switches say is on. So a gallery unlock is a bulk switch
// write, and this panel is a front end for one — which is why it goes through
// V.bulkSet rather than looping V.setSwitch: the whole collection comes back
// in ONE undo, and the log gets one line instead of four hundred.
//
// Nothing here knows a switch id. Sections are DISCOVERED from the project's
// own switch names at runtime, using the header convention $.profile detected
// for this game. A switch table that reads:
//
//     101  -- Scenes            102..140  one named switch per scene
//     141  -- Endings           142..149  …
//     150  (unnamed)                      a gap left for later additions
//     151  EndingSecret                   still inside "Endings"
//
// produces two sections. Each range runs from its header to the switch before
// the NEXT header — not to the last named switch — because a project leaves
// gaps like 150 for content it has not written yet, and stopping at the last
// named one would silently exclude anything a patch drops into the gap.
// Unnamed slots inside a range are skipped as the gaps they are.
//
// A project with NO header convention has nothing here to group by, and this
// panel is not registered at all: World → Bulk sets a range of ids directly
// and is the right tool there. $.profile.get('sectionPattern') decides, and it
// is detected from the project's own names rather than assumed — which is also
// why the decision is made once the database has loaded, and not at load time
// when there is nothing yet to detect it from.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — bulk unlocks by switch section
 * @author gigahack
 * @help GigaHack_Gallery.js — requires Core, Caps, Store, Profile, UI, Shell
 * and Vars. Index is used to find the section headers when it is ready, and the
 * same scan runs here when it is not.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) { console.error('[GigaHack] shell missing — gallery not installed'); return; }
    if (!$.vars) { console.error('[GigaHack] vars module missing — gallery not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;
    var V = $.vars;

    var G = $.gallery = {};

    /* =====================================================================
       WHICH SECTIONS ARE OFFERED

       1.x hardcoded an English word list here — unlock|scene|gallery|ending|…
       — and hid everything it did not match behind a toggle. On a project
       whose switch names are not in English that matched nothing, so the
       panel opened empty on a game that had a perfectly good gallery. A
       filter that silently hides what you are looking for is worse than no
       filter, so the default is NO FILTER: every section is offered.

       A filter is still worth having on a large project, so there are two
       ways to get one and neither is a default: the game's profile may supply
       `galleryFilter`, and the user can type one into the panel, which wins.
       ===================================================================== */
    var FILTER_KEY = 'gallery.filter';

    function filterText() {
        return $.safe(function () {
            var v = $.store ? $.store.cfgGet(FILTER_KEY, '') : '';
            return v == null ? '' : String(v);
        }, 'gallery filter setting', '') || '';
    }

    G.setFilter = function (text) {
        $.safe(function () { $.store.cfgSet(FILTER_KEY, String(text == null ? '' : text).trim()); }, 'save gallery filter');
        return G.filter();
    };

    /**
     * The filter in force, as {re, from, text, why}.
     *
     * `re` is null when there is none, and null means OFFER EVERYTHING.
     *
     * A typed filter is read as a regular expression, because that is what a
     * profile supplies and the two should behave alike. An invalid one is not
     * dropped silently: it falls back to matching as plain text and says so,
     * since a half-typed "(scene" is a filter still being written, not an
     * instruction to show nothing.
     */
    var compiled = { src: null, re: null, ok: true };

    /* Compiled once per distinct filter text, because G.filter() is called
       from every section read and therefore from every repaint: without the
       cache, a filter that is still half-typed would log its syntax error
       several times a second instead of once. */
    function compile(src) {
        if (compiled.src === src) return compiled;
        var re = $.safe(function () { return new RegExp(src, 'i'); }, 'gallery filter "' + src + '"', null);
        compiled = re
            ? { src: src, re: re, ok: true }
            : { src: src, re: new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ok: false };
        return compiled;
    }

    G.filter = function () {
        var typed = filterText().trim();
        if (typed) {
            var c = compile(typed);
            return {
                re: c.re, from: 'yours', text: typed,
                why: c.ok ? '' : 'that is not a valid regular expression, so it is being matched as plain text instead'
            };
        }
        var supplied = $.safe(function () {
            return $.profile ? $.profile.get('galleryFilter', null) : null;
        }, 'profile galleryFilter', null);
        if (supplied) {
            var pre = $.safe(function () {
                return (typeof supplied.test === 'function') ? supplied : new RegExp(String(supplied), 'i');
            }, 'profile galleryFilter compile', null);
            if (pre) return { re: pre, from: 'profile', text: String(pre.source || supplied), why: '' };
        }
        return { re: null, from: 'none', text: '', why: '' };
    };

    G.alive = function () {
        return typeof $dataSystem !== 'undefined' && !!$dataSystem &&
            !!$dataSystem.switches && typeof $gameSwitches !== 'undefined' && !!$gameSwitches;
    };

    /**
     * The section headers, as {list: [{id, title}], from: 'index'|'scan'}.
     *
     * The index already walked $dataSystem.switches at boot and wrote down
     * every header it found, so ask it first — and treat what it says as a
     * CANDIDATE LIST, which is all the index is ever allowed to be. Every id
     * it offers is read back out of live $dataSystem here, and one whose name
     * is no longer a header is dropped. When the index is not ready — still
     * building, no filesystem, module absent — the same scan runs directly.
     */
    function headers() {
        var names = $dataSystem.switches;
        var out = [];

        function take(id) {
            var live = String(names[id] || '').trim();
            if (!live || !$.profile.isSectionHeader(live)) return false;
            out.push({ id: id, title: $.profile.sectionTitle(live) || ('section ' + id) });
            return true;
        }

        var candidates = $.safe(function () {
            return ($.index && $.index.sections) ? $.index.sections('switches') : [];
        }, 'index switch sections', []) || [];

        if (candidates.length) {
            candidates.forEach(function (c) { take(c.id); });
            if (out.length) return { list: out, from: 'index' };
        }
        for (var id = 1; id < names.length; id++) take(id);
        return { list: out, from: 'scan' };
    }

    G.headerSource = function () {
        return G.alive() ? $.safe(function () { return headers().from; }, 'gallery header source', 'scan') : 'none';
    };

    /**
     * Every switch section, with its id range and how much of it is on.
     *
     * `matches` is what the filter said, and with no filter every section
     * matches — the panel offers all of them and there is nothing hidden to
     * toggle back into view.
     */
    G.sections = function () {
        if (!G.alive()) return [];
        return $.safe(function () {
            var names = $dataSystem.switches;
            var f = G.filter();
            var heads = headers().list;
            return heads.map(function (hd, i) {
                var from = hd.id + 1;
                var to = (i + 1 < heads.length ? heads[i + 1].id : names.length) - 1;
                var ids = [], on = 0, named = 0;
                for (var s = from; s <= to; s++) {
                    if (!names[s]) continue;              // an unnamed slot is a gap, not a member
                    ids.push(s);
                    named++;
                    if ($gameSwitches.value(s)) on++;
                }
                return {
                    headerId: hd.id, title: hd.title, from: from, to: to,
                    ids: ids, total: named, on: on,
                    matches: f.re ? f.re.test(hd.title) : true
                };
            }).filter(function (sec) { return sec.total > 0; });
        }, 'gallery sections', []) || [];
    };

    G.section = function (headerId) {
        var all = G.sections();
        for (var i = 0; i < all.length; i++) if (all[i].headerId === headerId) return all[i];
        return null;
    };

    /**
     * Unlock (or lock) the first `pct` percent of a section.
     *
     * Deliberately the FIRST n and not a random n: a collection unlocked at
     * 40% should be the same 40% every time, or "unlock a bit more" becomes a
     * lottery that can take things away again.
     *
     * What that is USEFUL for rests on an assumption worth stating out loud,
     * and the panel states it to the user rather than relying on it quietly:
     * ids within a section tend to run in the order the content was written,
     * so the first n% is usually the earliest content. Nothing in the engine
     * enforces that. Where a project did not number things that way, the first
     * n% is simply the lowest n% of ids, which is still stable and repeatable
     * — just not "the early part of the story".
     */
    G.setSection = function (headerId, on, pct) {
        var sec = G.section(headerId);
        if (!sec) return 0;
        var p = pct == null ? 100 : $.clamp(Math.round(pct), 0, 100);
        var n = Math.round(sec.ids.length * p / 100);
        var target = sec.ids.slice(0, n);
        if (!target.length) return 0;
        return V.bulkSet('switch', target, !!on,
            (on ? 'unlock ' : 'lock ') + target.length + ' of "' + sec.title + '"');
    };

    /** Every offered section at once, under one undo entry each. */
    G.setAll = function (on, pct, onlyMatching) {
        var n = 0;
        G.sections().forEach(function (sec) {
            if (onlyMatching && !sec.matches) return;
            n += G.setSection(sec.headerId, on, pct);
        });
        return n;
    };

    G.totals = function (onlyMatching) {
        var on = 0, total = 0;
        G.sections().forEach(function (sec) {
            if (onlyMatching && !sec.matches) return;
            on += sec.on; total += sec.total;
        });
        return { on: on, total: total, pct: total ? Math.round(on / total * 100) : 0 };
    };

    /* =====================================================================
       PANEL
       ===================================================================== */

    var showAll = false, pct = 100, selected = null;

    function noDb() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'database not loaded yet' }),
                h('div', { text: 'start or load a game, then reopen this tab' })));
    }

    function bar(sec) {
        var wrap = h('div', { style: 'flex:0 0 46px;height:5px;background:var(--mm-bg-sunken);border-radius:2px;overflow:hidden' });
        wrap.appendChild(h('i', { style: 'display:block;height:100%' }));
        fillBar(wrap, sec);
        return wrap;
    }

    /* Split out of bar() so a live repaint can move the fill without replacing
       the row it is in. Written as two properties rather than a style string,
       because the string would also have to carry the height and the display
       and one of them would eventually be forgotten. */
    function fillBar(wrap, sec) {
        var frac = sec.total ? sec.on / sec.total : 0;
        var fill = wrap.firstChild;
        if (!fill) return;
        fill.style.width = Math.round(frac * 100) + '%';
        fill.style.background = frac >= 1 ? 'var(--mm-ok)' : 'var(--mm-accent)';
    }

    function filterGroup() {
        var f = G.filter();
        var input = W.text({
            value: f.from === 'yours' ? f.text : '',
            width: '148px', mono: true,
            placeholder: f.from === 'profile' ? f.text : 'every section',
            onEnter: function () { apply(); }
        });
        function apply() {
            G.setFilter(input.mm.get());
            showAll = false; selected = null;
            U.rerender();
        }

        var note = f.from === 'yours'
            ? (f.why || 'Sections whose title does not match are hidden until you list them ' +
                            'below.')
            : f.from === 'profile'
                ? 'The game profile supplies this. Type your own to replace it.'
                : 'No filter: every section is listed. A word or regex, matched against the title, ' +
                  'never ids.';

        return W.group('Which collections are listed', [
            W.row('Filter', [input, W.button({
                label: 'apply', mini: true, _ungated: true, onClick: apply
            })]),
            f.from === 'yours' ? W.button({
                label: 'clear the filter and list everything', wide: true, _ungated: true,
                onClick: function () { G.setFilter(''); showAll = false; selected = null; U.rerender(); }
            }) : null,
            h('div', {
                class: 'mm-sub',
                style: 'white-space:normal;padding:2px' + (f.why ? ';color:var(--mm-warn)' : ''),
                text: note
            })
        ], { tag: f.from === 'none' ? 'off' : f.from, collapsed: f.from === 'none' });
    }

    function build() {
        if (!G.alive()) return noDb();

        var f = G.filter();
        var all = G.sections();
        // With no filter every section matches, so "show the rest as well" is
        // not a second state to be in, and the toggle is not offered.
        var hiding = !!f.re && !showAll;
        var list = hiding ? all.filter(function (s) { return s.matches; }) : all;
        if (selected && !G.section(selected)) selected = null;
        if (!selected && list.length) selected = list[0].headerId;

        /* The two cells of each drawn row that count live switches, kept by
           section id. This table is not virtual, and a plain paint empties the
           body — which drops scrollHeight to zero and lets the browser clamp
           the scroll position with it. On a project with thirty collections
           that would send the reader back to the top every time a switch
           moved, so the bar and the count are rewritten in place instead. */
        var rowCells = Object.create(null);

        var table = W.table({
            rowH: 17, empty: 'no switch sections in this project',
            cols: [
                { label: 'collection', w: '1 1 0' },
                { label: '', w: '0 0 52px' },
                { label: 'unlocked', w: '0 0 74px', cls: 'mm-td-num' },
                { label: '', w: '0 0 96px' }
            ],
            render: function (sec) {
                var meter = bar(sec);
                var count = h('span', { class: 'mm-cell', text: sec.on + ' / ' + sec.total });
                rowCells[sec.headerId] = { bar: meter, count: count };
                return [
                    h('span', {
                        class: sec.headerId === selected ? 'mm-td-val mm-hi' : 'mm-td-val',
                        text: sec.title
                    }),
                    meter,
                    count,
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'all', mini: true, mutates: true,
                            onClick: function () { G.setSection(sec.headerId, true, 100); U.rerender(); }
                        }),
                        W.button({
                            label: 'none', mini: true, mutates: true,
                            onClick: function () { G.setSection(sec.headerId, false, 100); U.rerender(); }
                        }))
                ];
            },
            onRow: function (tr, sec) {
                tr.setAttribute('data-mm-tip', sec.title + '|switches ' + sec.from + '–' + sec.to +
                    ' · ' + sec.total + ' named');
                tr.addEventListener('click', function () { selected = sec.headerId; U.rerender(); });
            }
        });
        table.mm.paint(list);

        var sec = selected ? G.section(selected) : null;
        var totals = G.totals(hiding);

        /* Every row here is a count of live switches, so playing the game moves
           the bars and the panel used to sit on the numbers it was built with.
           V.revision() is the cheap question: one integer that the variables
           module moves whenever any switch or variable has changed. Walking
           every section to find out costs one pass over the switch table, and
           that is the paint's job, not the signal's. */
        var overallEl = h('div', {
            class: 'mm-edge mm-mono mm-hi',
            text: totals.on + ' / ' + totals.total + '  (' + totals.pct + '%)'
        });
        var collectionsGroup = W.group('Collections', [table], { grow: true, tag: totals.pct + '% overall' });
        var secOnEl = h('div', { class: 'mm-edge mm-mono mm-hi', text: sec ? sec.on + ' / ' + sec.total : '' });

        U.live(V.revision, function () {
            var now = G.sections(), t = { on: 0, total: 0 };
            for (var i = 0; i < now.length; i++) {
                var s = now[i], cells = rowCells[s.headerId];
                if (hiding && !s.matches) continue;
                t.on += s.on; t.total += s.total;
                // A section with no cells was not on screen when the panel was
                // built — a plugin reloaded the database and grew the switch
                // table. Its numbers still count toward the total; there is
                // simply no row to write them into until the next rebuild.
                if (!cells) continue;
                cells.count.textContent = s.on + ' / ' + s.total;
                fillBar(cells.bar, s);
                if (selected === s.headerId) secOnEl.textContent = s.on + ' / ' + s.total;
            }
            var pct = t.total ? Math.round(t.on / t.total * 100) : 0;
            overallEl.textContent = t.on + ' / ' + t.total + '  (' + pct + '%)';
            collectionsGroup.mm.tag(pct + '% overall');
        }, { name: 'gallery counts', within: table });

        var left = [
            filterGroup(),

            W.group('Everything listed', [
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Unlocked' }),
                    overallEl),
                W.button({
                    label: 'unlock everything listed', wide: true, mutates: true, variant: 'prime',
                    confirm: true,
                    confirmLabel: 'switch on all ' + totals.total + ' flags in ' +
                        (hiding ? 'the collections listed' : 'every section') + '?',
                    onClick: function () { G.setAll(true, 100, hiding); U.rerender(); }
                }),
                W.button({
                    label: 'lock everything listed', wide: true, mutates: true, variant: 'danger',
                    confirm: true,
                    confirmLabel: 'switch OFF all ' + totals.total + ' flags? This can un-finish quests.',
                    onClick: function () { G.setAll(false, 100, hiding); U.rerender(); }
                }),
                f.re ? h('div', { class: 'mm-sep' }) : null,
                f.re ? W.toggleRow('List the sections the filter hides too', {
                    value: showAll, keybind: false, _ungated: true,
                    onChange: function (v) { showAll = v; selected = null; U.rerender(); }
                }) : null,
                !hiding ? h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: 'Projects store quest state in switches too — bulk-setting those can leave a ' +
                        'quest somewhere its events do not expect.'
                }) : null
            ], { tag: list.length + (hiding ? ' of ' + all.length : '') + ' listed' }),

            W.group('Partial', [
                W.row('Amount', W.slider({
                    value: pct, min: 0, max: 100, unit: '%', width: '116px', label: 'unlock amount',
                    _ungated: true, onChange: function (v) { pct = v; U.rerender(); }
                })),
                W.button({
                    label: sec ? 'unlock ' + Math.round((sec.ids.length * pct) / 100) + ' of "' + sec.title + '"' : 'pick a collection',
                    wide: true, mutates: true, disabled: !sec,
                    onClick: function () { if (sec) { G.setSection(sec.headerId, true, pct); U.rerender(); } }
                }),
                W.button({
                    label: 'apply to everything listed', wide: true, mutates: true,
                    confirm: true, confirmLabel: 'unlock the first ' + pct + '% of every collection listed?',
                    onClick: function () { G.setAll(true, pct, hiding); U.rerender(); }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'The lowest n% of ids, not a random n — usually, but not necessarily, the earliest ' +
                    'content.')
            ], { tag: pct + '%' })
        ];

        var right = [
            collectionsGroup
        ];
        if (sec) {
            right.push(W.group('Selected', [
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Name' }),
                    // The section title comes from the project's switch names.
                    h('div', {
                        class: 'mm-edge mm-edge--shrink mm-path mm-mono mm-sub',
                        text: sec.title, title: sec.title
                    })),
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Switches' }),
                    h('div', { class: 'mm-edge mm-mono mm-sub', text: sec.from + '–' + sec.to + ' (' + sec.total + ' named)' })),
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Unlocked' }),
                    secOnEl),
                W.button({
                    label: 'open it in Switches', wide: true, _ungated: true,
                    tip: 'Switches|Opens with this section’s first flag in view.',
                    onClick: function () {
                        $.store.cfgSet('ui.varFilter.switch', {
                            q: '', named: true, active: false, changed: false, pinned: false
                        });
                        $.store.cfgSet('ui.sub.world', 'Switches');
                        U.rerender();
                    }
                })
            ], { tag: 'detail', collapsed: true }));
        }

        return cols(left, right);
    }

    /* =====================================================================
       REGISTRATION

       Deliberately NOT at load time. Plugins are set up while the database is
       still loading, so $dataSystem does not exist yet and no convention has
       been detected — asking then returns the fallback answer for every game,
       including the games that use no convention at all and for which this
       panel has nothing to show. Scene_Boot.start is the first moment every
       $data* file is present, so the decision is made there instead.
       ===================================================================== */
    var decided = false, explained = false;

    /**
     * The test is BEHAVIOURAL, not a look at what $.profile is holding: count
     * how many of this project's own switch names $.profile.isSectionHeader()
     * accepts. That answers the question actually being asked — "is there
     * anything here to group?" — and it keeps the convention in the one place
     * it is allowed to live. Three different situations fall out of it with
     * three different answers, and none of them is an empty panel:
     *
     *   · the project uses no convention          → nothing to group;
     *   · it uses one, but only in its VARIABLES  → nothing to group HERE;
     *   · asking threw                            → say so, and register
     *     nothing, because every section read would throw the same way.
     */
    function decide(why) {
        if (decided || !G.alive()) return false;

        var pattern = $.safe(function () {
            return $.profile ? $.profile.get('sectionPattern', null) : null;
        }, 'gallery section pattern', null);

        var probe = $.safe(function () { return { n: headers().list.length }; }, 'gallery header probe', null);

        if (!probe) {
            if (!explained) {
                explained = true;
                $.log('warn', 'gallery: this project\'s switch names could not be tested against the ' +
                    'section-header convention — the error above says why — so no Gallery panel is ' +
                    'registered. World → Bulk switches a range of ids directly and needs no convention.');
            }
            return false;
        }

        if (!probe.n) {
            if (!explained) {
                explained = true;
                $.log('info', 'gallery: ' + (pattern
                    ? 'this project has a section-header convention, but none of its SWITCH names use it'
                    : 'this project uses no section-header convention in its variable or switch names') +
                    ', so there are no collections to group and no Gallery panel is registered. ' +
                    'World → Bulk switches a range of ids on or off directly, which is the same job ' +
                    'without the grouping.');
            }
            // Not marked decided: a plugin that reloads the database gets
            // another answer out of this rather than a stale one.
            return false;
        }

        decided = true;
        // 120, not 110: Events' Find already claims 110, and two panels on one
        // tab with the same order leave their relative position to Array#sort's
        // tie-breaking, which is not stable below every engine's list length.
        U.panel('world', 'Gallery', build, 120);

        var f = G.filter();
        var all = G.sections();
        var offered = all.filter(function (s) { return s.matches; }).length;
        $.log('ok', 'gallery ready (' + why + ') — ' + all.length + ' switch section(s) found by the ' +
            G.headerSource() + ', ' + offered + ' offered' +
            (f.re ? ' by the filter from ' + (f.from === 'yours' ? 'your settings' : 'the game profile') : '') + '.');
        $.safe(function () { U.rerender(); }, 'gallery rerender');
        return true;
    }

    $.install('Scene_Boot.start (gallery)',
        typeof Scene_Boot !== 'undefined' ? Scene_Boot.prototype : null, 'start',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                $.safe(function () { decide('the boot scene started'); }, 'gallery decide at boot');
                return r;
            };
        },
        'Scene_Boot.start not found — the Gallery panel decides when a game world is built instead');

    $.on('gameobjects', function () { decide('a game world was built'); });

    // A database that is already loaded (the mod was set up late, or reloaded)
    // needs no hook at all.
    decide('the database was already loaded');

    $.api.unlockAll = function (pctArg) { return G.setAll(true, pctArg == null ? 100 : pctArg, true); };
    $.api.gallery = function () { return G.totals(true); };
    $.api.gallerySections = function () { return G.sections(); };

})(window.GigaHack);
