//=============================================================================
// GigaHack MV/MZ
// 07 · tabs.js — the tab registry, and the Debug tab's own panels
//-----------------------------------------------------------------------------
// Two things live here:
//
//   · the registry every module registers a panel into. No module owns a tab
//     and none of them has to know what else is on the same one.
//   · the panels the Debug tab owns itself — Environment, Hooks, Plugins,
//     Compatibility, Index, Backups — plus the Settings tab.
//
// The Debug panels are the ones that answer "why does this not work on my
// game", so they are held to a harder rule than the rest: every string they
// show is derived from what was actually detected on this install. Nothing
// here names a delivery mechanism, a directory, a manifest file or another
// plugin — it asks $.paths, $.caps, $.compat and $.index, and prints the
// answer, including the command that would repair what is broken.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — tabs and the Debug panels
 * @author gigahack
 * @help GigaHack_Tabs.js — requires Core, Caps, Store, UI, Shell, Hooks
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — tabs not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols, todo = U.todo;

    /* =====================================================================
       THE TAB REGISTRY

       Six tabs, declared once, here. Every panel in the mod registers into one
       of them by name — no module owns a tab, and none of them has to know
       what else is on the same one. That is what makes a regrouping like
       "Variables, Teleport and Events are all one World tab now" an edit to
       this list plus one line per module, instead of a rewrite of six files.

       Order within a tab is the "order" argument, not load order: Vars, Map
       and Events load eleven files apart and would otherwise land in whatever
       sequence the plugin list happens to load them in.
       ===================================================================== */
    var TABDEFS = [
        { id: 'player', label: 'Player', icon: 'player', hint: 'movement, stats, skills, states, equipment, identity' },
        { id: 'world', label: 'World', icon: 'teleport', hint: 'variables, switches, maps, events, gallery' },
        { id: 'items', label: 'Items', icon: 'inventory', hint: 'inventory, gold, the Forge' },
        { id: 'game', label: 'Game', icon: 'battle', hint: 'battle and text' },
        { id: 'debug', label: 'Debug', icon: 'debug', hint: 'environment, hooks, saves, console, log' },
        { id: 'settings', label: 'Settings', icon: 'settings', hint: 'appearance, behaviour, hotkeys, profiles' }
    ];
    U.TABDEFS = TABDEFS;

    var panels = {};
    TABDEFS.forEach(function (t) { panels[t.id] = []; });

    function tabDef(def) {
        var list = panels[def.id];
        return {
            id: def.id, label: def.label, icon: def.icon, hint: def.hint,
            subs: list.map(function (p) { return p.name; }),
            // A panel that renders more than one shape under one sub name says
            // so, and the shell gives it its own scroll slot — see the note on
            // scroll memory in the shell.
            scope: function (sub) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].name === sub && list[i].scope) return list[i].scope();
                }
                return '';
            },
            build: function (sub) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].name === sub) return $.safe(function () { return list[i].build(sub); },
                        'build ' + def.id + '/' + sub, todo(def.label, sub, ['this panel threw while building']));
                }
                if (list.length) return list[0].build(list[0].name);
                return todo(def.label, def.label, ['nothing registered on this tab']);
            }
        };
    }

    /**
     * Register a panel on a tab.
     *
     *   U.panel('world', 'Teleport', buildMaps, 70)
     *
     * Re-registering the same name on the same tab replaces it, which is how
     * an optional module can be enabled at runtime and appear immediately.
     */
    U.panel = function (tabId, name, build, order, scope) {
        var def = null;
        TABDEFS.forEach(function (t) { if (t.id === tabId) def = t; });
        if (!def) { $.log('warn', 'no such tab: ' + tabId + ' (panel "' + name + '" dropped)'); return null; }
        panels[tabId] = panels[tabId].filter(function (p) { return p.name !== name; });
        panels[tabId].push({ name: name, build: build, order: order == null ? 50 : order, scope: scope || null });
        panels[tabId].sort(function (a, b) { return a.order - b.order; });
        U.tab(tabDef(def));
        return name;
    };

    /**
     * Take a panel back off a tab.
     *
     * Registration replaces by name, so nothing needed this until something
     * could be turned OFF at runtime. An addon that is disabled has to leave
     * no trace in the strip: a sub-tab that opens onto an empty body is worse
     * than one that is gone, because there is nothing in it to say why.
     *
     * Returns false when there was no such panel, which is not an error — a
     * disable that runs twice is the normal shape of a teardown.
     */
    U.removePanel = function (tabId, name) {
        var def = null;
        TABDEFS.forEach(function (t) { if (t.id === tabId) def = t; });
        if (!def || !panels[tabId]) return false;
        var before = panels[tabId].length;
        panels[tabId] = panels[tabId].filter(function (p) { return p.name !== name; });
        if (panels[tabId].length === before) return false;
        U.tab(tabDef(def));
        // The sub-tab that was showing may be the one that just went. The shell
        // falls back to the first panel on the tab when the remembered sub name
        // no longer matches, so this only has to stop pointing at a ghost.
        var sub = ($.cfg.ui.sub || {})[tabId];
        if (sub === name) $.store.cfgSet('ui.sub.' + tabId, panels[tabId].length ? panels[tabId][0].name : '');
        return true;
    };

    U.panelNames = function (tabId) {
        return (panels[tabId] || []).map(function (p) { return p.name; });
    };

    /** Every tab id, in strip order. Used by the module report. */
    U.tabIds = function () { return TABDEFS.map(function (t) { return t.id; }); };

    // Named shorthands kept for the modules that already used them. Every
    // module that registers a panel goes through U.panel underneath, so a
    // module registering late — Encounters after its boot probe, Gallery
    // after the database loads — arrives the same way as one registering
    // at load, and replaces by name rather than duplicating.
    U.actorPanel = function (name, build, order) { return U.panel('player', name, build, order); };
    U.playerPanel = function (name, build, order) { return U.panel('player', name, build, order == null ? 90 : order); };

    // Declare every tab up front so the strip has its full shape before any
    // feature module loads — a tab whose module failed still appears, and says
    // so, rather than silently vanishing from the strip.
    TABDEFS.forEach(function (t) { U.tab(tabDef(t)); });

    /* =====================================================================
       DEBUG — real in M1
       Everything the Debug tab shows registers the same way every other panel
       does — this file just declares the six it owns itself. Compatibility
       and Index are built lazily, so the modules behind them (which load
       after this file) are there by the time anyone opens the sub-tab; when
       one of them did not load at all, the panel says so instead of vanishing.
       ===================================================================== */
    U.panel('debug', 'Environment', function () { return buildEnvironment(); }, 10);
    U.panel('debug', 'Hooks', function () { return buildHooks(); }, 20);
    U.panel('debug', 'Plugins', function () { return buildPlugins(); }, 30);
    U.panel('debug', 'Compatibility', function () { return buildCompatibility(); }, 40);
    U.panel('debug', 'Index', function () { return buildIndex(); }, 45);
    U.panel('debug', 'Backups', function () { return buildBackups(); }, 90);

    /** Register a Debug sub-tab. Kept as a name because five modules use it. */
    U.debugPanel = function (name, build, order) { return U.panel('debug', name, build, order == null ? 50 : order); };

    function kv(label, value, tip) {
        // The value is unbounded — a path, a project's own name for
        // something, a joined list — so the edge is allowed to shrink and
        // wrap. Without that it pushes the label out and is then clipped
        // by the column, and neither half can be read.
        var val = h('div', {
            class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-selectable mm-breakall',
            text: String(value)
        });
        var row = h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: label }), val);
        /* Held by the three panels here that repaint one figure rather than
           rebuilding the group it sits in. The write is skipped when the text
           is already right, so a tick that changed nothing does not drop a
           selection the reader has made inside the value. */
        row.mm = { set: function (v) { if (val.textContent !== String(v)) val.textContent = String(v); } };
        return row;
    }

    /**
     * Like $.safe but silent. The Environment panel reads $data / $game
     * globals that legitimately do not exist yet when the tab is built during
     * boot (the persisted tab happened to be Debug). Those misses are
     * expected, not errors, and must not spam the log drawer with red lines
     * on every launch.
     */
    function soft(fn, fallback) {
        try {
            var v = fn();
            return (v === undefined || v === null) ? fallback : v;
        } catch (e) { return fallback; }
    }

    /* =====================================================================
       Where this install actually is.

       Delivery is discovered, never assumed: the same files run from the
       game's own plugins folder, from a web-deploy www folder, or from a mod
       loader's folder, and only $.paths knows which. Every user-facing string
       that would otherwise have named one of those goes through these.
       ===================================================================== */
    function deliveryLabel() {
        var l = $.paths.layout;
        if (l === 'plain') return 'the game plugins folder';
        if (l === 'www') return 'the web-deploy plugins folder';
        if (l === 'modloader') return 'a mod folder, set up by a mod loader';
        return 'an unrecognised layout';
    }

    /** The game's plugin list, on this install. */
    function pluginListFile() {
        var dir = $.paths.pluginsDir, path = $.env.path;
        if (!dir) return 'the game plugin list';
        if (path) return path.join(path.dirname(dir), 'plugins.js');
        return dir.replace(/[\/\\][^\/\\]*$/, '') + '/plugins.js';
    }

    /* What "pause" holds is engine-dependent and the hook module is the only
       thing that knows which functions it managed to gate. */
    function pauseAvailable() { return !!($.pause && $.pause.available()); }
    function pauseDescription() {
        if ($.pause) return $.pause.describe();
        return 'the pause module did not load, so nothing is held.';
    }

    /** The command that makes unreadable plugin files readable again. */
    function repairCommand() {
        if ($.repairCommand) return $.repairCommand();
        return 'chmod 644 ' + ($.paths.pluginsDir || '<plugins folder>') + '/GigaHack_*.js';
    }

    /**
     * The paste-into-a-bug-report artefact.
     *
     * One block of text with the engine, the capability answers and the
     * resolved paths. A screenshot of a panel loses the long "why" strings;
     * this does not, and it needs neither a writable disk nor a working
     * overlay renderer to be useful.
     */
    function envReportText() {
        return $.safe(function () {
            var L = [$.codename + ' ' + $.version, ''];
            L.push(($.caps && $.caps.reportText) ? $.caps.reportText() : 'the capability table did not load');
            L.push('');
            L.push($.describePaths());
            L.push('delivery            : ' + deliveryLabel());
            if ($.pause) L.push('pause               : ' + $.pause.describe());
            return L.join('\n');
        }, 'environment report', $.codename + ' ' + $.version + ' — the environment report could not be built');
    }

    function buildEnvironment() {
        var p = $.paths, env = $.env;

        var pathRows = [
            kv('Persistence', p.mode + (p.fallbackUsed ? ' (fallback)' : ''),
                'Persistence|fs = JSON files on disk. localStorage / memory mean Node APIs were unavailable.'),
            kv('Platform', p.platform),
            kv('Delivery', deliveryLabel()),
            kv('Node APIs', env.nwjs ? 'available' : 'missing')
        ];

        /* The capability table, verbatim. This is the artefact a bug report
           is built from: every row that says "no" carries the reason, and
           every feature that depends on one asked this table rather than a
           version string. */
        var capsRows = ($.caps && $.caps.report) ? $.safe(function () { return $.caps.report(); }, 'caps report', []) : [];
        var capsTable = W.table({
            cols: [
                { label: 'capability', w: '0 0 132px' },
                { label: 'answer', w: '1 1 0' }
            ],
            empty: 'the capability table did not load — GigaHack_Caps.js is missing',
            render: function (r) {
                return [
                    h('span', { class: 'mm-cell mm-selectable', text: String(r[0]) }),
                    h('span', {
                        class: 'mm-cell mm-sub mm-selectable',
                        style: 'white-space:normal', text: String(r[1])
                    })
                ];
            }
        });
        capsTable.mm.paint(capsRows);

        var capsGroup = W.group('Engine capabilities', [
            capsTable,
            h('div', { class: 'mm-sub', style: 'padding:4px 2px;white-space:normal' },
                'Probed at load, never read off a version number. A plugin that adds or ' +
                'removes one changes the answer.'),
            W.button({
                label: 'copy the environment report', wide: true, _ungated: true,
                tip: 'Copy|Engine, capabilities and paths as plain text, for a bug report.',
                onClick: function () {
                    var ok = U.copyText(envReportText());
                    U.toast({
                        title: ok ? 'COPIED' : 'CLIPBOARD UNAVAILABLE',
                        msg: ok ? 'Environment report on the clipboard' : 'Select the text above instead',
                        severity: ok ? 'ok' : 'warn'
                    });
                }
            })
        ], { tag: ($.caps && $.caps.engine) ? $.caps.engine : 'unknown' });

        var dirGroup = W.group('Resolved paths', [
            // Nothing in this block is anything but a path, so it wraps: the
            // tail is the half that identifies the install, and behind a
            // horizontal scrollbar it is the half nobody reads.
            h('div', { class: 'mm-pre mm-pre-wrap', text: $.describePaths() }),
            h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
                W.button({
                    label: 'copy paths', _ungated: true,
                    onClick: function () {
                        // NW.js has its own clipboard, which works regardless of
                        // whether file:// counts as a secure context here.
                        var ok = $.safe(function () {
                            if (typeof nw === 'object' && nw.Clipboard) {
                                nw.Clipboard.get().set($.describePaths(), 'text');
                                return true;
                            }
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                                navigator.clipboard.writeText($.describePaths());
                                return true;
                            }
                            return false;
                        }, 'copy paths', false);
                        U.toast({
                            title: ok ? 'COPIED' : 'CLIPBOARD UNAVAILABLE',
                            msg: ok ? 'Paths on the clipboard' : 'Select the text above instead',
                            severity: ok ? 'ok' : 'warn'
                        });
                    }
                }),
                W.button({
                    label: 'test write', _ungated: true,
                    onClick: function () {
                        var ok = $.store.write('write-test.json', { at: new Date().toISOString(), version: $.version });
                        U.toast({
                            title: ok ? 'WRITE OK' : 'WRITE FAILED',
                            msg: ok ? ($.store.path('write-test.json') || $.paths.mode) : 'see the log',
                            severity: ok ? 'ok' : 'err'
                        });
                    }
                }))
        ], { tag: p.mode });

        var save = $.saves.available()
            ? [W.pathRow('Save folder', soft(function () { return $.saves.dir(); }, ''), {
                why: 'StorageManager has not resolved one yet — refresh after the title screen',
                tip: 'Save folder|Follows the game\'s own external-save-directory option.'
            }),
            W.pathRow('Slot 1 file', soft(function () { return $.saves.fileFor(1); }, ''), {
                why: 'no save path on this install'
            })]
            : [h('div', { class: 'mm-empty', text: 'save paths unavailable (' + $.paths.mode + ' mode)' })];

        /* The Engine group is the one part of this panel that is not a
           snapshot, and until 2.2 it was the only part that pretended to be:
           it carried the tag 'live' while the scene name was read once. Two
           failures came out of that. The scene changes on every map, battle
           and menu transition, so the row disagreed with the shell's own
           footer within a second of walking through a door. And when the tab
           was built during boot — the persisted tab happened to be Debug —
           the three database rows read "loading…" and went on reading it for
           the rest of the session, because nothing ever asked again.

           Four text nodes, one signal, and nothing else on the panel moves:
           $.caps, $.paths and the save paths are boot facts and repainting
           them would be churn. */
        function engineNow() {
            return {
                game: soft(function () { return $dataSystem.gameTitle; }, 'loading…'),
                vars: soft(function () { return $dataSystem.variables.length - 1; }, 'loading…'),
                switches: soft(function () { return $dataSystem.switches.length - 1; }, 'loading…'),
                scene: soft(function () { return SceneManager._scene.constructor.name; }, '—')
            };
        }
        var now = engineNow();
        var gameRow = kv('Game', now.game);
        var varsRow = kv('Variables', now.vars);
        var switchRow = kv('Switches', now.switches);
        var sceneRow = kv('Scene', now.scene);
        var engine = [
            gameRow,
            kv('Mod version', $.version),
            varsRow,
            switchRow,
            sceneRow,
            // Still here, and no longer an admission: the four rows above keep
            // up on their own, and everything else on this panel — the
            // capability table, the resolved paths, the save files — is read
            // once per build on purpose. This is how those get read again.
            h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
                W.button({
                    label: 'refresh', wide: true, _ungated: true,
                    tip: 'Refresh|Rebuilds the panel. The rows above do not need it; the paths, the ' +
                        'capability table and the save files are read once per build.',
                    onClick: function () { U.rerender(); }
                }))
        ];

        var compat = U.compatReport();
        var missing = compat.filter(function (f) { return !f.supported; });
        var compatGroup = W.group('Renderer', compat.map(function (f) {
            return h('div', { class: 'mm-row' },
                h('i', {
                    class: 'mm-dotmark',
                    style: 'background:' + (f.supported ? 'var(--mm-ok)' : 'var(--mm-warn)') + ';margin-right:6px'
                }),
                h('div', { class: 'mm-lab', text: f.feature }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: f.supported ? 'yes' : 'NO' }));
        }).concat([
            h('div', { class: 'mm-sub', style: 'padding:4px 2px;white-space:normal' },
                missing.length
                    ? 'This build lacks ' + missing.length + ' of the features the mockup assumes. GigaHack avoids all of them; if any UI looks wrong, start here.'
                    : 'Everything the overlay uses is supported.')
        ]), { tag: missing.length ? missing.length + ' missing' : 'ok', collapsed: !missing.length });

        var notes = (p.notes || []).length
            ? W.group('Notes', (p.notes || []).map(function (n) {
                return h('div', { class: 'mm-row' }, h('div', { class: 'mm-lab mm-selectable', style: 'white-space:normal', text: n }));
            }), { tag: p.notes.length + '' })
            : null;

        var engineGroup = W.group('Engine', engine, { tag: 'live' });
        /* `within` is the Engine group and not the whole overlay: the default
           holds a repaint while focus is anywhere in the UI, and the plugin
           filter box two panels away is not a reason to stop reading the scene
           name. Nothing inside this group can take focus. */
        U.live(function () {
            var v = engineNow();
            return v.game + '|' + v.vars + '|' + v.switches + '|' + v.scene;
        }, function () {
            var v = engineNow();
            gameRow.mm.set(v.game);
            varsRow.mm.set(v.vars);
            switchRow.mm.set(v.switches);
            sceneRow.mm.set(v.scene);
        }, { name: 'debug/Environment engine', within: engineGroup });

        return cols(
            [capsGroup, W.group('Environment', pathRows, { tag: 'runtime' }), dirGroup, notes],
            [engineGroup, W.group('Save files', save, { tag: 'read-only' }), compatGroup]
        );
    }

    function buildHooks() {
        var list = $.hookList();
        var table = W.table({
            cols: [
                { label: '', w: '0 0 16px' },
                { label: 'hook', w: '1 1 0' },
                { label: 'state', w: '0 0 96px', cls: 'mm-td-num' },
                { label: '', w: '0 0 62px' }
            ],
            empty: 'no hooks installed',
            render: function (hk) {
                return [
                    h('i', {
                        class: 'mm-dotmark',
                        style: 'background:' + (hk.installed ? 'var(--mm-ok)' : 'var(--mm-warn)')
                    }),
                    h('span', { class: 'mm-selectable', text: hk.name }),
                    hk.installed ? 'installed' : 'skipped',
                    hk.installed && hk.unpatch
                        ? W.button({
                            label: 'unpatch', variant: 'danger', confirm: true, confirmLabel: 'sure?',
                            onClick: function (btn) {
                                if (hk.unpatch()) {
                                    U.toast({ title: 'UNPATCHED', msg: hk.name, severity: 'warn' });
                                    U.rerender();
                                } else {
                                    U.toast({ title: 'CANNOT UNPATCH', msg: 'another plugin patched on top', severity: 'err' });
                                }
                            }
                        })
                        : null
                ];
            },
            onRow: function (tr, hk) {
                if (!hk.installed && hk.reason) tr.setAttribute('data-mm-tip', 'Skipped|' + hk.reason);
            }
        });
        table.mm.paint(list);

        return cols([
            W.group('Installed aliases', [table], { grow: true, tag: list.length + ' hooks' }),
            h('div', { class: 'mm-sub', style: 'padding:0 2px' },
                'Unpatching only succeeds when no other plugin has patched on top of ours.')
        ]);
    }

    /**
     * What this build expects, what is on disk, and what actually ran.
     *
     * Always shown, not only when something is wrong. "It is not there" is
     * the single hardest report to act on — this turns it into four separate
     * yes/no questions that can be read off in one glance, and a Copy button
     * so the answer can leave the game as text rather than as a screenshot.
     *
     * There is no manifest to read and no loader to ask. The expected list is
     * what this version ships, each module leaves a marker on $ as it runs,
     * and the files are looked for in the directory this script is sitting
     * in. That works on every layout, and on a build with no filesystem at
     * all the file columns read "?" while the column that matters — did it
     * run — still answers.
     */
    function buildModules() {
        if (!$.moduleReport) return null;
        var mrep = $.moduleReport();

        var copyBtn = W.button({
            label: 'Copy the whole report', wide: true, _ungated: true,
            tip: 'Copy|Modules, files, panels and paths, as plain text.',
            onClick: function () {
                U.copyText($.report());
                $.log('ok', 'module report copied to the clipboard');
            }
        });

        var yn = function (v, good, bad) {
            if (v === null || v === undefined) return h('span', { class: 'mm-sub', text: '?' });
            return h('span', { style: 'color:var(--' + (v ? 'mm-ok' : 'mm-danger') + ')', text: v ? good : bad });
        };

        var table = W.table({
            cols: [
                { label: 'module', w: '1 1 0' },
                { label: 'listed', w: '0 0 62px' },
                { label: 'file', w: '0 0 62px' },
                { label: 'ran', w: '0 0 48px' },
                { label: 'state', w: '0 0 150px' }
            ],
            empty: 'no modules are expected — the module list is empty',
            render: function (r) {
                var listed = r.manifest === false ? h('span', { class: 'mm-sub', text: 'off' })
                    : r.listed === 'enabled' ? h('span', { text: 'yes' })
                        : r.listed === 'disabled' ? h('span', { class: 'mm-sub', text: 'disabled' })
                            : h('span', { class: 'mm-sub', text: 'no' });
                return [
                    h('span', { class: 'mm-cell mm-selectable', text: r.name }),
                    listed,
                    r.file && r.readable === false
                        ? h('span', { style: 'color:var(--mm-danger)', text: 'locked' })
                        : yn(r.file, 'present', 'MISSING'),
                    yn(r.ran, 'yes', 'NO'),
                    h('span', {
                        class: 'mm-cell mm-sub',
                        text: r.readable === false ? 'mode ' + (r.mode || '?')
                            : r.manifest === false ? 'off in the mod manifest'
                                : (r.claimed || '—')
                    })
                ];
            },
            onRow: function (tr, r) {
                if (r.manifest === false) tr.style.opacity = '.45';
                if (r.marker) {
                    tr.setAttribute('data-mm-tip', r.name +
                        '|declares $.' + r.marker + ' when it has run to completion');
                }
            }
        });
        table.mm.paint(mrep.rows);

        var notes = [];
        if (mrep.missing.length) {
            notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-danger)' },
                mrep.missing.join(', ') + ' — expected by this build and never registered.'));

            var locked = mrep.rows.filter(function (r) {
                return mrep.missing.indexOf(r.name) > -1 && r.readable === false;
            });
            if (locked.length) {
                notes.push(h('div', { class: 'mm-sub mm-selectable', style: 'white-space:normal;padding:2px' },
                    'These are on disk and this process is not allowed to read them (' +
                    locked.map(function (r) { return r.name + ' mode ' + (r.mode || '?'); }).join('; ') +
                    '). Nothing in the game can work around that. In a terminal: ' + repairCommand()));
            }
            var claimed = mrep.rows.filter(function (r) {
                return mrep.missing.indexOf(r.name) > -1 && r.claimed;
            });
            if (claimed.length) {
                notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                    claimed.map(function (r) { return r.name + ' — ' + r.claimed; }).join('; ') +
                    '. The engine keeps one flat list of plugin names for the whole game and skips a ' +
                    'second claim on a name; a file it does request but cannot read lands in an error ' +
                    'list that is inspected exactly once, before any of these files exists. Either way ' +
                    'nothing is raised. GigaHack reads those off disk and runs them itself — see the log.'));
            }
        }
        if (mrep.unknown.length) {
            notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
                mrep.unknown.join(', ') + ' — sitting in the plugins folder but not part of ' +
                $.codename + ' ' + $.version + '. Almost always left over from an older install: ' +
                'nothing loads them, and deleting them is safe.'));
        }
        if (mrep.absent.length) {
            notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                mrep.absent.join(', ') + ' — not installed. No file, and no plugin entry names them, ' +
                'so those features are absent rather than broken.'));
        }
        if ($.paths.fallbackUsed) {
            notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                'Settings are being written to ' + ($.paths.dataDir || '—') + ' because the preferred ' +
                'directory for this layout was not writable.'));
        }

        var footer = [
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'delivery' }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: deliveryLabel() })),
            W.pathRow('plugins dir', $.paths.pluginsDir, {
                why: 'the plugins folder was not resolved — see Environment'
            })
        ];
        if (mrep.manifest) {
            // A mod loader keeps its own list of what to load. It is an extra
            // column when it is there, and nothing at all when it is not.
            footer.push(W.pathRow('mod manifest', mrep.manifest.file, {
                prefix: mrep.manifest.version ? 'v' + mrep.manifest.version + '  ' : null
            }));
        }
        footer.push(copyBtn);

        var bad = mrep.missing.length + mrep.unknown.length;
        return W.group('GigaHack modules', [table].concat(notes).concat(footer),
            { tag: bad ? bad + ' to look at' : mrep.ran.length + ' loaded', collapsed: false });
    }

    function buildPlugins() {
        var rep = $.pluginReport();
        var modules = buildModules();

        if (!rep) {
            return h('div', { class: 'mm-body' }, h('div', { class: 'mm-col' },
                modules,
                h('div', { class: 'mm-todo' }, h('b', { text: '$plugins unavailable' }))));
        }

        var filter = '';
        var table = W.table({
            virtual: true,
            cols: [
                { label: '#', w: '0 0 34px', cls: 'mm-td-num' },
                { label: 'plugin', w: '1 1 0' },
                { label: 'status', w: '0 0 60px', cls: 'mm-td-num' }
            ],
            empty: 'no matches',
            render: function (p, i) {
                return [String(i + 1), h('span', { class: 'mm-selectable', text: p.name }), p.status ? 'on' : 'off'];
            },
            onRow: function (tr, p) {
                if (p.description) tr.setAttribute('data-mm-tip', p.name + '|' + p.description);
                if (!p.status) tr.style.opacity = '.45';
            }
        });
        function repaint() {
            table.mm.paint(rep.plugins.filter(function (p) {
                return !filter || p.name.toLowerCase().indexOf(filter) > -1 ||
                    (p.description || '').toLowerCase().indexOf(filter) > -1;
            }));
        }
        var search = W.search({
            placeholder: 'filter ' + rep.total + ' plugins…',
            onInput: function (v) { filter = v; repaint(); }
        });
        repaint();

        // Collapsed by default: on a 142-plugin project an expanded warning
        // list would push the table it is warning about off the panel.
        var warn = rep.warnings.length
            ? W.group('Compatibility warnings', rep.warnings.map(function (w) {
                return h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', style: 'white-space:normal;color:var(--mm-warn)', text: w }));
            }).concat([
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'The Compatibility sub-tab says what each one costs and whether the game ' +
                    'currently agrees.')
            ]), { tag: rep.warnings.length + ' suites', collapsed: true })
            : null;

        var body = h('div', { class: 'mm-body' },
            h('div', { class: 'mm-col' },
                modules,
                warn,
                W.group('Loaded plugins', [
                    h('div', { class: 'mm-toolbar' }, search),
                    table
                ], { grow: true, tag: rep.enabled + ' / ' + rep.total + ' enabled' })));
        return body;
    }

    /* ------------------------------------------------------------ Backups */
    function buildBackups() {
        var B = $.backup;
        if (!B) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' }, h('b', { text: 'backup module not loaded' })));
        }
        if (!B.available()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('div', { class: 'mm-todo-ms', text: 'UNAVAILABLE' }),
                    h('b', { text: 'save backups are off' }),
                    h('div', { text: B.reason() || 'unknown reason' }),
                    h('div', { text: 'dangerous actions still run, just unprotected' })));
        }

        var list = B.list();
        var saves = B.saveFiles();

        var table = W.table({
            cols: [
                { label: 'when', w: '0 0 132px', cls: 'mm-td-num' },
                { label: 'reason', w: '0 0 104px' },
                { label: 'files', w: '0 0 48px', cls: 'mm-td-num' },
                { label: '', w: '0 0 92px' }
            ],
            empty: 'no backups yet — one is taken automatically before a teleport',
            render: function (e) {
                var when = String(e.at || '').replace('T', ' ').slice(0, 19) || e.name;
                return [
                    when,
                    h('span', { class: 'mm-sub', text: e.reason }),
                    String((e.files || []).length),
                    W.button({
                        label: 'restore', mini: true, variant: 'danger', mutates: true,
                        confirmLabel: 'overwrite saves?',
                        tip: 'Restore|Overwrites your live saves. The current state is backed up ' +
                            'first.',
                        onClick: function () {
                            var n = B.restore(e);
                            if (n !== false) {
                                U.toast({
                                    title: 'RESTORED',
                                    msg: n + ' file(s) — load the save from the title screen',
                                    severity: 'warn', ms: 6000
                                });
                                U.rerender();
                            }
                        }
                    })
                ];
            },
            onRow: function (tr, e) {
                tr.setAttribute('data-mm-tip', e.name + '|' + (e.files || []).join(', '));
            }
        });
        table.mm.paint(list);

        /* This panel does not own its own list. A backup is taken before every
           dangerous action anywhere in the mod — a teleport, an instant win, a
           forge write — so the list can grow while the reader is looking at
           it, and the count beside it would then contradict the rows.

           TWO DIRECTORIES, TWO SIGNALS, BECAUSE THEY CHANGE DIFFERENTLY.

           A backup arrives as a whole new directory whose name carries a
           timestamp, so a listing of names answers the only question the hook
           has about B.dir(), and the expensive read — B.list() parses a JSON
           file per backup — happens once, on the tick that says yes.

           The save directory does not work like that. A save WRITTEN OVER AN
           EXISTING SLOT — an autosave, or an event that saves to a slot that
           already has a file — adds and removes no name at all, so a listing
           of names is byte-identical and the "Newest" row (B.saveFiles()
           sorted by mtime) goes on naming the wrong file under a group tagged
           'live'. So this one asks B.saveStamp(), which is the fold Backup
           already uses to decide whether a set of files is the same set — one
           rule, in the module that owns it, rather than a second copy here.

           That costs one statSync per save file, and it is the price of the
           claim rather than a free lunch: U.live asks the signal only after
           its holds, so nothing here runs while the overlay is closed or the
           list is being scrolled, and the list the signal builds is kept for
           the paint so the tick that repaints does not list the directory
           twice. A blind signal under a 'live' tag would be cheaper and would
           be a lie. */
        function dirKey(dir) {
            if (!dir || !$.env.fs) return '';
            return $.safe(function () {
                var names = $.env.fs.readdirSync(dir);
                return names.length + ':' + names.slice().sort().join(',');
            }, 'list ' + dir, '');
        }
        var lastSaves = saves;
        function saveKey() {
            // The list is kept for the paint, so the tick that repaints does
            // not list the directory a second time to draw what it just read.
            lastSaves = B.saveFiles();
            return B.saveStamp(lastSaves);
        }
        /* table.mm.isScrolling() is the house guard and it is a no-op here:
           its only writer is a scroll listener installed inside the virtual
           branch, and this table is not virtual (a row carries a two-click
           restore button, and virtual mode rebuilds rows on scroll, which
           would disarm one mid-confirm). So the gesture is watched here
           instead — a plain table's paint clears the body, and scrollTop goes
           with it. */
        var scrolledAt = 0;
        table.mm.body.addEventListener('scroll', function () { scrolledAt = Date.now(); });

        var savesRow = kv('Files', saves.length);
        var newestRow = kv('Newest', saves[0] ? saves[0].name : '—');
        var savesGroup = W.group('Saves on disk', [
            kv('Folder', B.saveDir() || '—'),
            savesRow,
            newestRow
        ], { tag: 'live' });

        var backupGroup = W.group('Backups', [
            kv('Folder', B.dir() || '—'),
            kv('Kept', $.store.cfgGet('behaviour.backupKeep', 20)),
            W.button({
                label: 'back up now', wide: true, _ungated: true,
                onClick: function () {
                    var r = B.make('manual', true);
                    U.toast({
                        title: r.created ? 'BACKED UP' : 'NOT BACKED UP',
                        msg: r.created ? r.entry.name : (r.why || r.skipped),
                        severity: r.created ? 'ok' : 'warn'
                    });
                    U.rerender();
                }
            }),
            null
        ], { tag: list.length + '' });

        U.live(function () { return dirKey(B.dir()) + '|' + saveKey(); }, function () {
            /* The list the signal has just built, not a second listing of the
               same directory one line later. */
            savesRow.mm.set(lastSaves.length);
            newestRow.mm.set(lastSaves[0] ? lastSaves[0].name : '—');
            var nowList = B.list();
            backupGroup.mm.tag(nowList.length + '');
            table.mm.paint(nowList);
        }, {
            name: 'debug/Backups',
            /* Every row carries a two-click "restore", and the paint rebuilds
               every row: a backup taken by any other panel between the two
               clicks would throw the armed state away under the reader's
               cursor, and the second click would land on a fresh unarmed
               button. Trace → Journal holds off for exactly this. */
            when: function () {
                return Date.now() - scrolledAt > 400 && !table.querySelector('.mm-armed');
            },
            whyNot: 'you are scrolling the list, or a restore is armed and waiting for its second click'
        });

        return cols({ narrow: true, items: [
            savesGroup,
            backupGroup
        ] }, [
            W.group('Restore', [table], { grow: true, tag: 'newest first' })
        ]);
    }

    /* =====================================================================
       STORAGE

       Where GigaHack's own files are, who decided that, and how to change it.

       Every refusal on this panel names itself, because they are not the same
       refusal: no filesystem at all, no home directory to put a shared folder
       in, an answer that has not been given yet, an answer that was "no", a
       destination that already has the file, and read-only mode. A control
       greyed with "unavailable" collapses six different situations into one,
       and five of the six are things the reader could act on.

       Nothing here reads the shared folder while the answer is anything but
       granted — including to find out whether it holds anything. That read is
       the thing the question is about.
       ===================================================================== */

    /* The last store.moveTo result, kept so its per-file report survives the
       rerender that follows it. A move is the one action on this panel whose
       outcome is a list rather than a state, and a toast cannot hold a list. */
    var lastMove = null;

    /** Can this build show a folder in a file manager, and if not, why not. */
    function revealAvailable() {
        return $.safe(function () {
            return !!($.env.nwjs && typeof nw !== 'undefined' && nw.Shell &&
                typeof nw.Shell.showItemInFolder === 'function');
        }, 'reveal available', false);
    }
    function revealWhy() {
        if (!$.env.nwjs) return 'there are no Node APIs on this build, so there is no desktop shell to ask.';
        return 'this build\'s desktop shell does not offer showItemInFolder. The path is above ' +
            'and can be copied.';
    }
    function revealButton(label, dir, noDirWhy) {
        var why = !dir ? noDirWhy : (revealAvailable() ? '' : revealWhy());
        return W.button({
            label: label, _ungated: true, disabled: !!why,
            tip: why ? 'Unavailable|' + why : '',
            onClick: function () {
                var ok = $.safe(function () { nw.Shell.showItemInFolder(dir); return true; },
                    'show ' + dir + ' in the file manager', false);
                if (!ok) U.toast({ title: 'COULD NOT OPEN', msg: revealWhy(), severity: 'warn' });
            }
        });
    }

    function explain(text) {
        return h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal', text: text });
    }

    var ANSWER_TEXT = {
        granted: 'allowed — a folder of its own, outside the game',
        declined: 'refused — everything stays beside the game',
        unasked: 'not answered yet — behaves exactly as if refused',
        moot: 'there is nothing to answer'
    };

    /* One reason, once.

       Three of the groups below carry their own "why", and on a build with no
       filesystem all three resolve to the same sentence — it was printed three
       times on one screen, which reads as three separate problems. Reset per
       panel build, so a reason that becomes true again after a move is said
       again. */
    var storageSaid = null;
    function explainOnce(text) {
        text = String(text || '');
        if (!text || (storageSaid && storageSaid[text])) return null;
        if (storageSaid) storageSaid[text] = true;
        return explain(text);
    }

    /* --------------------------------------------------------- the answer */
    function answerGroup() {
        var p = $.paths, rec = $.consentRecord();
        var rows = [
            kv('Answer', ANSWER_TEXT[p.consent] || p.consent),
            explainOnce(p.consentWhy)
        ];
        if (rec) {
            rows.push(kv('Given', rec.at || 'at an unrecorded time'));
            rows.push(kv('By version', rec.version || 'unknown'));
            rows.push(kv('Times asked', rec.asked || 1));
            rows.push(W.pathRow('Recorded in', rec._where, {
                why: 'the answer is in memory only for this launch',
                tip: 'Recorded in|Beside the game, so the answer cannot reach another game.'
            }));
        }
        if (p.consent !== 'moot' && $.consentDeferred && $.consentDeferred()) {
            rows.push(explain('You asked to be asked again next launch.'));
        }

        /* The answer that is in force is marked ON rather than removed. Two
           buttons and no mark reads as a choice nobody has made yet, and
           taking the current one away would remove the only way to re-run the
           grant — which is what adopts a shared folder somebody has just
           restored from a backup by hand. */
        function markCurrent(btn, answer) {
            if (p.consent === answer) {
                btn.classList.add('mm-on');
                btn.setAttribute('data-mm-tip', 'In force|Pressing it again re-runs it.');
            }
            return btn;
        }

        rows.push(h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
            markCurrent(W.button({
                label: 'Use the shared folder', variant: 'prime', mutates: true,
                disabled: p.consent === 'moot',
                tip: p.consent === 'moot' ? 'Unavailable|' + p.consentWhy
                    : 'Allow|Nothing is copied by this — the move below does that.',
                onClick: function () { $.safe(function () { $.store.grantStorage(); }, 'grant storage'); }
            }), 'granted'),
            markCurrent(W.button({
                label: 'Keep everything beside the game', _ungated: true,
                disabled: p.consent === 'moot',
                tip: p.consent === 'moot' ? 'Unavailable|' + p.consentWhy : '',
                onClick: function () {
                    $.safe(function () { $.store.declineStorage(); }, 'decline storage');
                    U.toast({ title: 'BESIDE THE GAME', msg: $.paths.dataDir || $.paths.mode, severity: 'ok' });
                }
            }), 'declined'),
            W.button({
                label: 'Show the question again', _ungated: true,
                disabled: p.consent === 'moot',
                tip: p.consent === 'moot' ? 'Unavailable|' + p.consentWhy : '',
                onClick: function () {
                    var r = U.showStorageCard();
                    if (!r.shown) U.toast({ title: 'NOT ASKED', msg: r.why, severity: 'warn', ms: 6000 });
                }
            })));

        return W.group('The answer', rows, { tag: $.paths.consent });
    }

    /* ------------------------------------------------------ the locations */
    function whereGroup() {
        var p = $.paths;
        return W.group('Where the data is now', [
            kv('Persistence', p.mode + (p.fallbackUsed ? ' (fallback)' : ''),
                'Persistence|localStorage and memory mean no writable directory was found.'),
            W.pathRow('In use now', p.dataDir, {
                why: 'there is no directory in ' + p.mode + ' mode — ' + ($.caps.fsWhy || 'no filesystem here.')
            }),
            kv('Outside the game folder', p.outsideGameFolder ? 'yes' : 'no',
                'Outside|Whether a game update or a reinstall would remove these files.'),
            h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
                revealButton('open this folder', p.dataDir,
                    'there is no directory to open in ' + p.mode + ' mode.'))
        ], { tag: p.mode });
    }

    function locationsGroup() {
        var p = $.paths;
        var sharedWhy = p.consent === 'granted' ? '' :
            'computed but never touched: ' + p.consentWhy;
        return W.group('The two locations', [
            W.pathRow('Beside the game', p.localDir, {
                why: 'no writable directory was found beside the game.'
            }),
            W.pathRow('A folder of its own', p.sharedDir, {
                why: 'there is no application-data folder to reach from this build.'
            }),
            W.pathRow('Shared between games', p.sharedCommonDir, {
                why: 'there is no application-data folder to reach from this build.',
                tip: 'Common folder|Holds only the sections you choose to share.'
            }),
            sharedWhy ? explainOnce(sharedWhy) : null,
            h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
                revealButton('open the shared folder',
                    p.consent === 'granted' ? p.sharedDir : null,
                    'nothing outside the game folder is opened until the answer is yes. ' + p.consentWhy))
        ], { tag: p.consent === 'granted' ? 'in use' : 'not in use' });
    }

    /* ---------------------------------------------------------- the move */
    function moveGroup() {
        var p = $.paths;
        /* ONE reason, for BOTH buttons. The consent clause used to be folded
           into the "to the shared folder" button only, so "copy everything back
           beside the game" stayed live while the answer was unasked — and
           store.moveTo would then read, stat and copy the whole file list OUT
           of a folder nobody had agreed to, with "remove the old copy"
           underneath it. Coming back out of that folder reads it, which is the
           act the question is about, so the greying is symmetric too. */
        var noDirs = '';
        if (p.mode !== 'fs') {
            noDirs = 'persistence is in ' + p.mode + ' mode here, so there are no directories to move ' +
                'anything between. ' + ($.caps.fsWhy || '');
        } else if (!p.localDir || !p.sharedDir) {
            noDirs = 'one of the two locations could not be resolved on this build (beside the game: ' +
                (p.localDir || 'unknown') + ', shared: ' + (p.sharedDir || 'unknown') + ').';
        } else if (p.consent !== 'granted') {
            noDirs = 'the shared folder needs an answer that has not been given (' + p.consent + '). ' +
                'The answer is above; copying back out of that folder reads it too, so both ' +
                'directions are greyed.';
        }

        function move(target) {
            return function () {
                lastMove = $.safe(function () { return $.store.moveTo(target); }, 'move to ' + target, null);
                if (!lastMove) return;
                U.toast({
                    title: lastMove.ok ? 'COPIED' : 'NOT COPIED',
                    msg: lastMove.copied.length + ' copied, ' + lastMove.kept.length + ' kept, ' +
                        lastMove.failed.length + ' failed. Nothing was deleted.' +
                        (lastMove.why ? ' ' + lastMove.why : ''),
                    severity: lastMove.ok ? 'ok' : 'warn', ms: 7000
                });
                U.rerender();
            };
        }

        var rows = [
            h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
                W.button({
                    label: 'copy everything to the shared folder', mutates: true,
                    disabled: !!noDirs,
                    tip: noDirs ? 'Unavailable|' + noDirs : 'Copy|' + p.localDir + ' → ' + p.sharedDir,
                    onClick: move('shared')
                }),
                W.button({
                    label: 'copy everything back beside the game', mutates: true,
                    disabled: !!noDirs,
                    tip: noDirs ? 'Unavailable|' + noDirs : 'Copy|' + p.sharedDir + ' → ' + p.localDir,
                    onClick: move('local')
                }))
        ];
        var noDirsRow = explainOnce(noDirs);
        if (noDirsRow) rows.push(noDirsRow);

        if (lastMove) {
            var report = [];
            lastMove.copied.forEach(function (c) {
                report.push({ state: 'copied', name: c.name, detail: c.files + ' file(s) → ' + c.to });
            });
            lastMove.kept.forEach(function (k) {
                report.push({ state: 'kept', name: k.name, detail: k.why + ' (' + k.at + ')' });
            });
            lastMove.failed.forEach(function (f) {
                report.push({ state: 'failed', name: f.name, detail: f.why });
            });
            var table = W.table({
                key: 'storage.move',
                cols: [
                    { label: '', w: '0 0 50px' },
                    { label: 'file', w: '0 0 108px' },
                    { label: 'what happened', w: '1 1 0' }
                ],
                empty: 'that move had nothing to do',
                render: function (r) {
                    return [
                        h('span', {
                            class: 'mm-cell mm-sub',
                            style: 'color:' + (r.state === 'failed' ? 'var(--mm-danger)'
                                : r.state === 'kept' ? 'var(--mm-warn)' : 'var(--mm-ok)'),
                            text: r.state
                        }),
                        h('span', { class: 'mm-cell mm-selectable', text: r.name }),
                        h('span', { class: 'mm-cell mm-sub', style: 'white-space:normal', text: r.detail })
                    ];
                }
            });
            table.mm.paint(report);
            rows.push(table);
            if (!lastMove.complete) rows.push(explain(lastMove.why));
            rows.push(W.button({
                label: 'remove the old copy', variant: 'danger', mutates: true, wide: true,
                disabled: !lastMove.pairs.length,
                confirmLabel: 'delete ' + lastMove.pairs.length + ' file(s)?',
                tip: lastMove.pairs.length
                    ? 'Remove|Deletes the ' + lastMove.pairs.length + ' file(s) that move copied, and ' +
                      'only where the copy is there.'
                    : 'Unavailable|That move copied nothing, so there is no old copy to remove.',
                onClick: function () {
                    var r = $.safe(function () { return $.store.dropSource(lastMove); }, 'drop the old copy', null);
                    if (!r) return;
                    /* A refusal removed nothing and left nothing behind to
                       count, so it gets its own sentence: "0 removed, 0 left in
                       place" says the opposite of what happened when the files
                       are all still there. */
                    var refused = !r.ok && !r.removed.length && !r.failed.length && r.why;
                    U.toast({
                        title: refused ? 'NOT REMOVED' : (r.ok ? 'REMOVED' : 'NOT ALL REMOVED'),
                        msg: refused ? r.why
                            : r.removed.length + ' removed, ' + r.failed.length + ' left in place. ' +
                              (r.why || 'Empty directories are left where they are.'),
                        severity: r.ok ? 'ok' : 'warn', ms: 6000
                    });
                    U.rerender();
                }
            }));
        }
        return W.group('Moving the files', rows, {
            tag: lastMove ? (lastMove.copied.length + ' copied') : 'copies, never deletes'
        });
    }

    /* ---------------------------------------------- shared between games */
    var SHARE_TEXT = {
        ui: 'Size, scale, opacity and accent.',
        behaviour: 'Pause while open, read-only, confirmations.',
        hotkeys: 'A shared bind is skipped where this game already claims the key.'
    };

    function sharedGroup() {
        var avail = $.store.sharedAvailable();
        var why = $.store.sharedWhy();
        var writers = avail ? $.store.sharedWriters() : {};
        var rows = [];

        var whyRow = avail ? null : explainOnce(why);
        if (whyRow) rows.push(whyRow);

        $.store.sharedSections().forEach(function (s) {
            /* The file's own record first: sharedSections() carries who this
               game ADOPTED from, which is the same answer until somebody
               writes again, and "who last wrote it" is the question that makes
               a setting nobody here changed attributable. */
            var wrote = writers[s.section] || s.wroteIt || null;
            rows.push(W.toggleRow(s.section, {
                value: s.on, disabled: !avail && !s.on, sub: wrote && wrote.game ? 'from ' + wrote.game : '',
                tip: s.section + '|' + (SHARE_TEXT[s.section] || ''),
                onChange: function (on) {
                    var r = $.safe(function () { return $.store.setShared(s.section, on); },
                        'share ' + s.section, null);
                    if (!r) return;
                    if (!r.ok) {
                        U.toast({ title: 'NOT SHARED', msg: r.why, severity: 'warn', ms: 6000 });
                        U.rerender();
                        return;
                    }
                    /* Adopting another game's `ui` changes the accent and the
                       scale in $.cfg, and nothing else re-reads those: without
                       this the overlay keeps its old look until the next
                       launch and the toggle reads as broken. */
                    if (s.section === 'ui') {
                        U.apply({ accent: $.cfg.ui.accent, scale: $.cfg.ui.scale, opacity: $.cfg.ui.opacity });
                    }
                    if (s.section === 'behaviour') U.apply({ readonly: $.cfg.behaviour.readonly });
                    U.toast({
                        title: r.adopted ? 'ADOPTED' : (on ? 'SHARED' : 'THIS GAME\'S OWN'),
                        msg: r.why, severity: 'ok', ms: 7000
                    });
                    U.rerender();
                }
            }));
        });

        var rep = $.store.sharedHotkeyReport();
        if (rep) {
            /* The hotkey report's reason IS sharedWhy() while there is no
               cross-game area, and that sentence is already at the top of this
               group. Print it once. */
            if (rep.reason && rep.reason !== why) rows.push(explain(rep.reason));
            rep.applied.forEach(function (a) {
                rows.push(kv(a.id, 'took ' + (a.code ? U.prettyCode(a.code) : 'unbound') + ' from the shared set'));
            });
            rep.skipped.forEach(function (a) {
                rows.push(h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: a.id }),
                    h('div', {
                        class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-sub',
                        style: 'color:var(--mm-warn)',
                        text: U.prettyCode(a.code) + ' not taken — this game claims it (' + a.claimedBy + ')'
                    })));
            });
            if (rep.skipped.length) rows.push(explain('Settings → Hotkeys binds something else.'));
        }

        if (avail) {
            rows.push(W.pathRow('Shared file', $.store.sharedFile(), {
                why: 'there is no cross-game file on this build'
            }));
        }
        return W.group('Shared between games', rows, { tag: avail ? 'available' : 'unavailable' });
    }

    /* ------------------------------------------------ what is in there */
    function contentsGroup() {
        var table = W.table({
            key: 'storage.files',
            cols: [
                { label: 'name', w: '0 0 116px' },
                { label: 'what', w: '1 1 0' },
                { label: 'travels', w: '0 0 74px' }
            ],
            empty: 'the store owns nothing on this build',
            render: function (e) {
                return [
                    h('span', { class: 'mm-cell mm-mono mm-selectable', text: e.name + (e.dir ? '/' : '') }),
                    h('span', { class: 'mm-cell mm-sub', style: 'white-space:normal', text: e.what }),
                    h('span', {
                        class: 'mm-cell mm-sub',
                        text: e.local ? 'stays' : e.transient ? 'rebuilt' : 'moves'
                    })
                ];
            }
        });
        table.mm.paint($.store.files());
        return W.group('What this folder holds', [table],
            { grow: true, tag: $.store.files().length + ' entries' });
    }

    function buildStorage() {
        storageSaid = {};
        if (!$.setConsent || !$.store || !$.store.sharedSections) {
            return todo('UNAVAILABLE', 'this build\'s storage layer cannot answer the question', [
                'Debug → Environment says where settings are being written in the meantime.'
            ]);
        }
        return cols(
            [whereGroup(), answerGroup(), locationsGroup()],
            [moveGroup(), sharedGroup(), contentsGroup()]
        );
    }

    /* =====================================================================
       SETTINGS — real in M1
       ===================================================================== */
    U.panel('settings', 'Interface', function () { return buildInterface(); }, 10);
    U.panel('settings', 'Behaviour', function () { return buildBehaviour(); }, 20);
    U.panel('settings', 'Hotkeys', function () { return buildHotkeys(); }, 30);
    U.panel('settings', 'Profiles', function () { return buildProfiles(); }, 40);
    U.panel('settings', 'Storage', function () { return buildStorage(); }, 50);

    /* An answer given on the first-launch card, or a directory relocated from
       anywhere, changes every line this panel prints. Gated on tab AND sub the
       way every other cross-panel refresh in this codebase is: Settings
       carries five other panels, and rebuilding one of those because the
       storage answer moved would take a half-typed profile name or an open
       keybind capture with it. */
    function refreshStorageIfShowing() {
        /* The move report names a source and a destination, and the answer
           that just changed is what decides which two directories those are.
           Keeping it would print a move between places nothing goes any more. */
        lastMove = null;
        if (!U.isOpen()) return;
        if ($.cfg.ui.tab !== 'settings') return;
        if (($.cfg.ui.sub || {}).settings !== 'Storage') return;
        U.rerender();
    }
    $.on('paths:changed', refreshStorageIfShowing);


    /* =====================================================================
       PROFILES (M16)
       ===================================================================== */
    var profName = '', profPaste = '', profSelected = null;

    function buildProfiles() {
        var list = $.store.profiles();
        if (profSelected && !$.store.profileExists(profSelected)) profSelected = null;
        if (!profSelected && list.length) profSelected = list[0].name;

        var table = W.table({
            rowH: 17, empty: 'no profiles saved yet',
            cols: [
                { label: 'name', w: '1 1 0' },
                { label: 'saved', w: '0 0 116px', cls: 'mm-td-num' },
                { label: '', w: '0 0 58px' }
            ],
            render: function (p) {
                return [
                    h('span', { class: p.name === profSelected ? 'mm-td-val mm-hi' : 'mm-td-val', text: p.name }),
                    h('span', { class: 'mm-sub', text: p.at ? String(p.at).replace('T', ' ').slice(0, 16) : '—' }),
                    W.button({
                        label: 'apply', mini: true, mutates: true,
                        onClick: function () {
                            var r = $.store.applyProfile(p.name);
                            if (r && r.scrubbed.length) {
                                U.toast({
                                    title: 'PROFILE APPLIED', severity: 'warn',
                                    msg: r.scrubbed.length + ' setting(s) that paint into the game were left off: ' +
                                        r.scrubbed.join(', ')
                                });
                            } else if (r) {
                                U.toast({ title: 'PROFILE APPLIED', msg: p.name, severity: 'ok', ms: 1400 });
                            }
                            U.applyAccent(U.getHost().root, $.cfg.ui.accent);
                            U.rerender();
                        }
                    })
                ];
            },
            onRow: function (tr, p) {
                tr.addEventListener('click', function () { profSelected = p.name; U.rerender(); });
            }
        });
        table.mm.paint(list);

        var exported = profSelected ? $.store.exportProfile(profSelected) : null;

        var left = [
            W.group('Save the current settings', [
                W.row('Name', W.text({
                    value: profName, width: '150px', placeholder: 'e.g. "speedrun"',
                    onInput: function (v) { profName = v; },
                    onEnter: function (v) {
                        if (!$.store.saveProfile(v)) return;
                        profName = ''; profSelected = $.store.profileName(v); U.rerender();
                    }
                }), { tip: 'Name|Enter saves. Saving over an existing name replaces it.' }),
                W.button({
                    label: 'save as a profile', wide: true, mutates: true,
                    onClick: function () {
                        if (!$.store.saveProfile(profName)) {
                            U.toast({ title: 'NEEDS A NAME', msg: 'type something to call it', severity: 'warn' });
                            return;
                        }
                        profSelected = $.store.profileName(profName);
                        profName = ''; U.rerender();
                    }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Appearance, behaviour, hotkeys and every feature flag travel together.')
            ], { tag: list.length + ' saved' }),

            W.group('Selected', [
                kv('Profile', profSelected || 'none'),
                W.button({
                    label: 'apply it', wide: true, mutates: true, disabled: !profSelected,
                    onClick: function () {
                        $.store.applyProfile(profSelected);
                        U.applyAccent(U.getHost().root, $.cfg.ui.accent);
                        U.rerender();
                    }
                }),
                W.button({
                    label: 'delete it', wide: true, variant: 'danger', mutates: true, disabled: !profSelected,
                    confirm: true, confirmLabel: 'delete the profile "' + (profSelected || '') + '"?',
                    onClick: function () { $.store.deleteProfile(profSelected); profSelected = null; U.rerender(); }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Applying and deleting are both on the undo stack.')
            ])
        ];

        var right = [
            W.group('Profiles', [table], { grow: true }),
            W.group('Move one between installs', [
                W.row('Export', W.button({
                    label: 'copy the selected one', wide: true, _ungated: true, disabled: !exported,
                    onClick: function () {
                        U.copyText(exported || '');
                        U.toast({ title: 'COPIED', msg: profSelected, severity: 'ok', ms: 1400 });
                    }
                })),
                W.textarea({
                    value: profPaste, rows: 3, mono: true, _ungated: true,
                    placeholder: 'paste an exported profile here',
                    onInput: function (v) { profPaste = v; }
                }),
                W.button({
                    label: 'import what is pasted', wide: true, mutates: true,
                    onClick: function () {
                        var r = $.store.importProfile(profPaste);
                        if (!r.ok) {
                            U.toast({ title: 'NOT IMPORTED', msg: r.error, severity: 'warn' });
                            return;
                        }
                        profPaste = ''; profSelected = r.name;
                        U.toast({
                            title: 'IMPORTED', severity: 'ok', ms: 1600,
                            msg: r.name + (r.replaced ? ' (replaced an existing one)' : '')
                        });
                        U.rerender();
                    }
                })
            ], { tag: 'json', collapsed: true })
        ];

        return cols(left, right);
    }

    function buildInterface() {
        var root = U.getHost().root;

        var swatches = h('div', { class: 'mm-inline' }, U.accents.map(function (a) {
            var b = h('button', {
                class: 'mm-sw', style: 'background:' + a.hex + ';width:22px;height:14px',
                tip: 'Accent|' + a.name,
                onclick: function () {
                    $.store.cfgSet('ui.accent', a.hex);
                    U.applyAccent(root, a.hex);
                    Array.prototype.forEach.call(swatches.children, function (c) { c.style.boxShadow = '0 0 0 1px #3a3d44'; });
                    b.style.boxShadow = '0 0 0 1px #fff';
                    $.log('info', 'accent → ' + a.name);
                }
            });
            if (a.hex === $.cfg.ui.accent) b.style.boxShadow = '0 0 0 1px #fff';
            return b;
        }));

        return cols([
            W.group('Appearance', [
                W.row('Accent preset', swatches),
                W.row('Custom accent', W.color({
                    value: $.cfg.ui.accent,
                    onChange: function (v) { $.store.cfgSet('ui.accent', v); U.applyAccent(root, v); }
                })),
                W.toggleRow('Cycle the accent colour', W.ungated({
                    value: U.accentCycling(),
                    tip: 'Cycle|Off at every launch, whatever this says. The game is untouched.',
                    onChange: function (v) { U.setAccentCycling(v); U.rerender(); }
                })),
                W.row('Cycle speed', W.slider(W.ungated({
                    value: Number($.cfg.ui.accentCycleSpeed) || 1, min: .2, max: 6, step: .2,
                    width: '116px', unit: '\u00d7', disabled: !U.accentCycling(),
                    onChange: function (v) { $.store.cfgSet('ui.accentCycleSpeed', v); }
                }))),
                W.row('UI scale', W.slider(W.ungated({
                    value: $.cfg.ui.scale, min: .75, max: 1.5, step: .05, width: '116px',
                    onChange: function (v) {
                        $.store.cfgSet('ui.scale', v); root.style.setProperty('--mm-scale', v);
                        // Scale transforms the window, so the strip's usable
                        // width changed even though nothing was resized.
                        var H = U.getHost(); if (H && H.fitTabs) H.fitTabs();
                    }
                }))),
                W.row('Opacity', W.slider(W.ungated({
                    value: Math.round($.cfg.ui.opacity * 100), min: 30, max: 100, unit: '%', width: '116px',
                    onChange: function (v) { $.store.cfgSet('ui.opacity', v / 100); root.style.setProperty('--mm-opacity', v / 100); }
                }))),
                W.toggleRow('Show FPS in footer', W.ungated({
                    value: $.cfg.ui.showFps,
                    onChange: function (v) { $.store.cfgSet('ui.showFps', v); }
                })),
                W.toggleRow('Show active-cheats HUD', W.ungated({
                    value: $.cfg.ui.showHud,
                    onChange: function (v) { $.store.cfgSet('ui.showHud', v); U.getHost().renderHud(); }
                })),
                h('div', { class: 'mm-sep' }),
                W.button({
                    label: 'reset window position', wide: true, _ungated: true,
                    onClick: function () {
                        $.cfg.ui.win = { left: 88, top: 36, width: 700, height: 520 };
                        $.cfg.ui.watch = { left: null, top: 300, right: 14, visible: $.cfg.ui.watch.visible };
                        $.store.saveSettings();
                        var host = U.getHost();
                        var w = host.win;
                        w.style.left = '88px'; w.style.top = '36px';
                        w.style.width = '700px'; w.style.height = '520px';
                        // Move the watch panel too, or it stays put until the
                        // next launch while claiming to have been reset.
                        if (host.watchEl) {
                            host.watchEl.style.left = 'auto';
                            host.watchEl.style.right = '14px';
                            host.watchEl.style.top = '300px';
                            host.watchEl.style.bottom = 'auto';
                        }
                        U.toast({ title: 'RESET', msg: 'Window and watch panel returned to their defaults', severity: 'ok' });
                    }
                })
            ], { tag: 'theme' })
        ], [
            W.group('Panels', [
                W.toggleRow('Watch panel', W.ungated({
                    value: U.isWatchOpen(),
                    sub: U.prettyCode($.cfg.hotkeys.watch),
                    onChange: function (v) { U.setWatch(v); }
                })),
                W.toggleRow('Log drawer open at start', W.ungated({
                    value: $.cfg.ui.logOpen,
                    onChange: function (v) { $.store.cfgSet('ui.logOpen', v); }
                }))
            ]),
            W.group('About', [
                kv('Build', $.codename + ' v' + $.version),
                kv('Engine', ($.caps.engine || 'unknown') + ' ' + ($.caps.engineVersion || '')),
                kv('Delivery', deliveryLabel(),
                    'Delivery|Detected from where this script sits, not assumed.'),
                null
            ], { collapsed: true })
        ]);
    }

    function buildBehaviour() {
        var root = U.getHost().root;
        return cols([
            W.group('Safety', [
                W.toggleRow('Read-only mode', W.ungated({
                    value: $.cfg.behaviour.readonly,
                    tip: 'Read-only|Blocks every write. Viewers, tables and overlays stay live.',
                    onChange: function (v) {
                        $.store.cfgSet('behaviour.readonly', v);
                        root.classList.toggle('mm-ro', v);
                        U.setActive('read-only', v);
                        $.log(v ? 'warn' : 'info', 'read-only mode ' + (v ? 'ON' : 'off'));
                    }
                })),
                W.toggleRow('Confirm dangerous actions', W.ungated({
                    value: $.cfg.behaviour.confirmDangerous,
                    tip: 'Confirm|Danger buttons arm on the first click, fire on the second.',
                    onChange: function (v) { $.store.cfgSet('behaviour.confirmDangerous', v); }
                })),
                W.toggleRow('Back up the save before dangerous actions', W.ungated({
                    value: $.cfg.behaviour.backupBeforeDanger,
                    sub: 'M4+',
                    tip: 'Backups|Teleports, forced events and bulk edits count as dangerous.',
                    onChange: function (v) { $.store.cfgSet('behaviour.backupBeforeDanger', v); }
                })),
                W.row('Backups to keep', W.number(W.ungated({
                    value: $.cfg.behaviour.backupKeep, min: 1, max: 200, step: 1, wide: true,
                    onChange: function (v) { $.store.cfgSet('behaviour.backupKeep', v); }
                })))
            ], { tag: 'guards' }),
            W.group('Undo', [
                W.row('Stack depth', h('span', { class: 'mm-mono mm-hi', text: String($.undo.size()) })),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'undo last action', wide: true, mutates: true,
                        onClick: function () { $.undo.pop(); U.rerender(); }
                    }),
                    W.button({
                        label: 'clear', variant: 'danger',
                        onClick: function () { $.undo.clear(); U.rerender(); }
                    })),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Simple edits only. Teleports, forced events, class changes and Forge ' +
                        'injections cannot be undone — a save backup is the only way back.')
            ], { tag: 'reversible only' })
        ], [
            W.group('Game', [
                W.toggleRow('Pause game while the menu is open', W.ungated({
                    value: $.cfg.behaviour.pauseGame,
                    // What pause actually holds differs by engine, and the
                    // hook module is the only thing that knows which
                    // functions it ended up gating. Ask it rather than
                    // describing one engine's frame loop here.
                    disabled: !pauseAvailable(),
                    sub: pauseAvailable() ? null : 'unavailable',
                    tip: 'Pause|' + pauseDescription(),
                    onChange: function (v) {
                        $.store.cfgSet('behaviour.pauseGame', v);
                        // Only badge it while the menu is actually open — which,
                        // if you are reading this toggle, it is.
                        U.setActive('paused', v && U.isOpen());
                    }
                })),
                W.toggleRow('Swallow game input while open', W.ungated({
                    value: $.cfg.behaviour.swallowInput,
                    tip: 'Input|Also freezes the player.',
                    onChange: function (v) { $.store.cfgSet('behaviour.swallowInput', v); }
                }))
            ]),
            W.group('Logging', [
                W.toggleRow('Log every write', W.ungated({
                    value: $.cfg.behaviour.logEveryWrite,
                    onChange: function (v) { $.store.cfgSet('behaviour.logEveryWrite', v); }
                })),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'test toasts', _ungated: true,
                        onClick: function () {
                            U.toast({ title: 'OK', msg: 'This is what success looks like', severity: 'ok' });
                            setTimeout(function () { U.toast({ title: 'WARNING', msg: 'And this is a warning', severity: 'warn' }); }, 250);
                            setTimeout(function () { U.toast({ title: 'ERROR', msg: 'And this is a failure', severity: 'err' }); }, 500);
                        }
                    }),
                    W.button({
                        label: 'raise test error', _ungated: true,
                        onClick: function () {
                            $.safe(function () { throw new Error('deliberate test error'); }, 'settings self-test');
                            U.toast({ title: 'CAUGHT', msg: 'The error was contained — see the log', severity: 'ok' });
                        }
                    }))
            ])
        ]);
    }

    function buildHotkeys() {
        // The three binds the shell owns. Everything else is contributed by a
        // feature module through U.addHotkey and listed below, so a module
        // that is not installed contributes no dead key.
        var LABELS = {
            toggleMenu: ['Toggle menu', 'Opens and closes this window'],
            watch: ['Watch panel', 'Shows the floating watch panel'],
            panicHide: ['Panic hide', 'Hides the window and every float']
        };
        var rows = Object.keys(LABELS).map(function (k) {
            var kb;
            kb = W.keybind({
                key: $.cfg.hotkeys[k], modes: false,
                onChange: function (v) {
                    // Clearing the menu bind would lock the user out of the
                    // overlay entirely — the only way back would be the
                    // DevTools console. Refuse it and restore the old bind.
                    if (k === 'toggleMenu' && !v.key) {
                        kb.mm.set({ key: $.cfg.hotkeys.toggleMenu });
                        U.toast({
                            title: 'CANNOT CLEAR', severity: 'warn',
                            msg: 'The menu key is the only way back in — rebind it instead.'
                        });
                        return;
                    }
                    var clash = U.hotkeyClash(v.key, k);
                    if (clash) {
                        kb.mm.set({ key: $.cfg.hotkeys[k] });
                        U.toast({
                            title: 'ALREADY TAKEN', severity: 'warn',
                            msg: U.prettyCode(v.key) + ' is bound to "' + clash + '" — the second bind would never fire.'
                        });
                        return;
                    }
                    $.store.cfgSet('hotkeys.' + k, v.key);
                    $.log('info', LABELS[k][0] + ' → ' + (U.prettyCode(v.key) || 'unbound'));
                }
            });
            return W.row(LABELS[k][0], kb, { tip: LABELS[k][0] + '|' + LABELS[k][1] });
        });

        // Binds contributed by feature modules. Listed the same way, so a
        // module adding one does not have to know this panel exists.
        var extras = (U.hotkeyList() || []).map(function (d) {
            var kb;
            kb = W.keybind({
                key: $.cfg.hotkeys[d.id] || '', modes: false,
                onChange: function (v) {
                    // The keydown handler returns on the first match, so a
                    // second bind on the same key is not ambiguous — it is
                    // dead. Refuse it rather than showing it as bound.
                    var clash = U.hotkeyClash(v.key, d.id);
                    if (clash) {
                        kb.mm.set({ key: $.cfg.hotkeys[d.id] || '' });
                        U.toast({
                            title: 'ALREADY TAKEN', severity: 'warn',
                            msg: U.prettyCode(v.key) + ' is bound to "' + clash + '" — the second bind would never fire.'
                        });
                        return;
                    }
                    $.store.cfgSet('hotkeys.' + d.id, v.key || null);
                    $.log('info', (d.label || d.id) + ' → ' + (U.prettyCode(v.key) || 'unbound'));
                }
            });
            return W.row(d.label || d.id, kb,
                { tip: (d.label || d.id) + '|' + (d.help || 'contributed by a feature module') });
        });

        var taken = h('div', { class: 'mm-pre', text: gameKeyReport() });
        var claimedText = claimedKeyReport();

        return cols([
            W.group('GigaHack hotkeys', rows, { tag: 'rebindable' }),
            extras.length ? W.group('Feature hotkeys', extras.concat([
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Unbound by default where an accidental press would cost you something.')
            ]), { tag: extras.length + ' available' }) : null,
            null
        ], [
            W.group('Keys this game already uses', [taken], { tag: 'reference', collapsed: false }),
            claimedText
                ? W.group('Everything already claimed', [
                    h('div', { class: 'mm-pre', text: claimedText }),
                    h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                        'The defaults were picked from what this list left over.')
                ], { tag: 'derived', collapsed: true })
                : null
        ]);
    }

    /**
     * Who has already claimed each key.
     *
     * gameKeyReport() reads Input.keyMapper live and answers "what does this
     * game do with the letters". claimedKeys() adds the keys the engine
     * reserves for itself, and is the list the default binds were derived
     * from — so the two together explain both what is taken and why a
     * particular default was chosen.
     */
    function claimedKeyReport() {
        return $.safe(function () {
            if (!$.profile || !$.profile.claimedKeys) return null;
            var taken = $.profile.claimedKeys() || {};
            var keys = Object.keys(taken).sort();
            if (!keys.length) return null;
            return keys.map(function (k) {
                return pad(U.prettyCode(k) || k, 10) + '  →  ' + taken[k];
            }).join('\n');
        }, 'claimed key report', null);
    }

    function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

    function gameKeyReport() {
        return $.safe(function () {
            if (typeof Input === 'undefined' || !Input.keyMapper) return 'Input.keyMapper unavailable';
            var out = [], codes = Object.keys(Input.keyMapper).map(Number).sort(function (a, b) { return a - b; });
            codes.forEach(function (c) {
                if (c < 65 || c > 90) return;  // letters only — that is where collisions happen
                out.push(String.fromCharCode(c) + '  →  ' + Input.keyMapper[c]);
            });
            var free = [];
            for (var c = 65; c <= 90; c++) if (!Input.keyMapper[c]) free.push(String.fromCharCode(c));
            return out.join('\n') + '\n\nunbound letters: ' + (free.join(' ') || 'none');
        }, 'key report', 'unavailable');
    }

    /* =====================================================================
       COMPATIBILITY

       Four questions, in the order they earn their keep:
         1. are our aliases the outermost ones (load order)?
         2. which recognised plugin suites are here, and what do they cost?
         3. what has already failed a write-back this session?
         4. does the game agree, right now, when we actually try it?

       Nothing here is a guess: every string comes from $.compat, which owns
       the recognition table and the live tests.
       ===================================================================== */
    function stateColour(state) {
        if (state === 'pass') return 'var(--mm-ok)';
        if (state === 'fail' || state === 'error') return 'var(--mm-danger)';
        if (state === 'note') return 'var(--mm-warn)';
        return 'var(--mm-text-dim)';
    }

    function dot(colour, top) {
        return h('i', {
            class: 'mm-dotmark',
            style: 'background:' + colour + ';margin-right:6px' + (top ? ';margin-top:5px' : '')
        });
    }

    function buildCompatibility() {
        var K = $.compat;
        if (!K) {
            return todo('UNAVAILABLE', 'the compatibility module did not load', [
                'Load order, write verification and the self-tests all live there.',
                'Debug → Plugins says whether its file is present, readable and registered.'
            ]);
        }

        /* --- 1. load order ------------------------------------------- */
        var lo = $.safe(function () { return K.loadOrder(); }, 'load order',
            { known: false, last: false, after: [], why: 'the check threw — see the log' });
        var loRows = [
            h('div', { class: 'mm-row', style: 'align-items:flex-start' },
                dot(lo.last ? 'var(--mm-ok)' : lo.known ? 'var(--mm-warn)' : 'var(--mm-text-dim)', true),
                h('div', { class: 'mm-lab mm-selectable', style: 'white-space:normal', text: lo.why }))
        ];
        if (lo.after && lo.after.length) {
            loRows.push(h('div', { class: 'mm-sub mm-selectable', style: 'padding:2px;white-space:normal' },
                'loading after us: ' + lo.after.join(', ')));
        }
        if (!lo.last) {
            // The repair, naming the file on THIS install rather than a path
            // that happens to be right on one of the three layouts.
            loRows.push(h('div', { class: 'mm-pre mm-selectable' },
                'Move every GigaHack entry to the end of\n  ' + pluginListFile() +
                '\nso that its aliases are the outermost ones.'));
        }
        var loGroup = W.group('Load order', loRows,
            { tag: lo.last ? 'last' : lo.known ? 'not last' : 'unknown' });

        /* --- 2. frameworks ------------------------------------------- */
        var fw = $.safe(function () { return K.frameworks(); }, 'frameworks', []);
        var fwRows = fw.length ? [] : [h('div', { class: 'mm-empty', text: 'no recognised plugin suite is loaded' })];
        fw.forEach(function (f) {
            fwRows.push(h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: f.name }),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-selectable mm-breakall',
                    text: (f.plugins || []).join(', ')
                })));
            fwRows.push(h('div', { class: 'mm-sub mm-selectable', style: 'padding:0 2px 4px;white-space:normal' },
                f.note));
            if (f.affects && f.affects.length) {
                fwRows.push(h('div', { class: 'mm-sub', style: 'padding:0 2px 6px;color:var(--mm-warn)' },
                    'affects: ' + f.affects.join(', ')));
            }
        });
        var fwGroup = W.group('Recognised plugin suites', fwRows,
            { tag: fw.length ? fw.length + ' found' : 'none' });

        /* --- 3. degraded controls ------------------------------------ */
        var deg = $.safe(function () { return K.degradedList(); }, 'degraded list', []);
        var degRows = deg.length ? [] : [h('div', { class: 'mm-empty', text: 'nothing has failed a write-back this session' })];
        deg.forEach(function (d) {
            degRows.push(h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab mm-mono', text: d.control }),
                h('div', { class: 'mm-edge mm-sub', text: 'degraded' })));
            degRows.push(h('div', { class: 'mm-sub mm-selectable', style: 'padding:0 2px 6px;white-space:normal' },
                d.why));
        });
        if (deg.length) {
            degRows.push(W.button({
                label: 'clear and try again', wide: true, _ungated: true,
                tip: 'Clear|Worth doing after changing the plugin setting that caused it.',
                onClick: function () { K.clearDegraded(); U.rerender(); }
            }));
        }
        var degGroup = W.group('Degraded controls', degRows,
            { tag: deg.length ? deg.length + ' degraded' : 'none' });

        /* --- 4. live self-tests -------------------------------------- */
        var run = K.lastRun;
        var results = (run && run.results) || [];
        var testRows = results.length ? [] : [h('div', { class: 'mm-empty', text: 'not run yet' })];
        results.forEach(function (r) {
            var colour = stateColour(r.state);
            testRows.push(h('div', { class: 'mm-row', style: 'align-items:flex-start' },
                dot(colour, true),
                h('div', { class: 'mm-lab', style: 'white-space:normal' },
                    h('div', { text: r.name }),
                    h('div', { class: 'mm-sub mm-selectable', style: 'white-space:normal', text: r.detail || '' })),
                h('div', { class: 'mm-edge mm-mono mm-sub', style: 'color:' + colour, text: r.state })));
        });
        var counts = { pass: 0, fail: 0, note: 0, skipped: 0, error: 0 };
        results.forEach(function (r) { if (counts[r.state] !== undefined) counts[r.state]++; });
        var testGroup = W.group('Live self-tests', [
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Run against the live game; every test restores what it touched. What they ' +
                'learn is what greys a control.'),
            W.button({
                label: 'Run self-tests', wide: true, mutates: true,
                tip: 'Run|Writes to game state and reads it back. Refused in read-only mode.',
                onClick: function () {
                    $.safe(function () { K.selfTest(); }, 'run self-tests');
                    U.rerender();
                }
            })
        ].concat(testRows).concat([
            run ? h('div', { class: 'mm-sub', style: 'padding:2px' },
                'last run ' + new Date(run.at).toLocaleTimeString()) : null
        ]), {
            grow: true,
            tag: results.length
                ? counts.pass + ' pass · ' + counts.fail + ' fail · ' + counts.skipped + ' skipped'
                : 'not run'
        });

        return cols([loGroup, fwGroup], [degGroup, testGroup]);
    }

    /* =====================================================================
       INDEX

       The index is for FINDING, never authority — every query returns
       candidates the caller re-resolves against the live database. What this
       panel is for is the other half of that bargain: what it cost to build,
       and whether each stage is worth keeping. The benchmark is the whole
       argument: a stage that cannot show a measured saving gets retired.
       ===================================================================== */
    var lastBench = null;

    function buildIndex() {
        var X = $.index;
        if (!X) {
            return todo('UNAVAILABLE', 'the index module did not load', [
                'Search falls back to scanning the live database — slower, but it works.',
                'Debug → Plugins says whether its file is present, readable and registered.'
            ]);
        }
        var st = $.safe(function () { return X.status(); }, 'index status', null);
        if (!st) {
            return todo('UNAVAILABLE', 'the index would not report its status',
                ['See the log — the call threw.']);
        }

        /* --- status ---------------------------------------------------
           The index builds in the background, and this is the panel that
           watches it do so. Painted once, it showed "building · 40%" until
           somebody pressed a button labelled "refresh" whose entire body was
           U.rerender() — which is a panel admitting in a control that it does
           not update. The button is gone and the rows update themselves.

           Every readout here is a held text node, a group tag or a table
           paint. Nothing in this panel that a person can be inside — the
           rebuild button's armed state, the benchmark table — is rebuilt by
           the tick. */
        function progressText(s) {
            return Math.round((s.progress || 0) * 100) + '%' + (s.stage ? '  —  ' + s.stage : '');
        }
        var phaseRow = kv('Phase', st.phase, 'Phase|idle · building · ready · failed · disabled');
        var progressRow = kv('Progress', progressText(st));
        var builtRow = kv('Built', st.built ? new Date(st.built).toLocaleString() : '—');
        var sourceRow = kv('Source', st.fromCache ? 'loaded from cache' : 'built this session');
        var errorRow = h('div', {
            class: 'mm-sub mm-selectable',
            style: 'padding:2px;white-space:normal;color:var(--mm-danger)',
            text: st.error ? String(st.error) : ''
        });
        errorRow.style.display = st.error ? '' : 'none';

        var statusRows = [
            phaseRow, progressRow, builtRow, sourceRow, errorRow,
            h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
                W.button({
                    label: 'Rebuild index', variant: 'danger', mutates: true,
                    confirmLabel: 'rebuild it?',
                    tip: 'Rebuild|Reads the database again. Nothing in the game is touched. The rows ' +
                        'above follow it while it runs.',
                    onClick: function () {
                        $.safe(function () { X.rebuild(); }, 'index rebuild');
                        U.toast({ title: 'REBUILDING', msg: 'the index is being rebuilt in the background', severity: 'ok' });
                    }
                }))
        ];

        /* --- counts --------------------------------------------------- */
        function countsInto(box, s) {
            var rows = [];
            if (s.counts) {
                Object.keys(s.counts).forEach(function (k) {
                    if (s.counts[k] === null || s.counts[k] === undefined) return;
                    rows.push(kv(k, s.counts[k]));
                });
            }
            if (!rows.length) rows.push(h('div', { class: 'mm-empty', text: 'nothing indexed yet' }));
            U.clear(box);
            rows.forEach(function (r) { box.appendChild(r); });
        }

        /* --- notes: why a query would be incomplete -------------------
           Always built, even when there are none. A group that appears the
           moment the first note arrives is a shape change, and a shape change
           is a rebuild of the whole tab — which would take the rebuild
           button's armed state and the benchmark results with it. */
        function notesInto(box, s) {
            var list = s.notes || [];
            U.clear(box);
            if (!list.length) {
                box.appendChild(h('div', { class: 'mm-empty', text: 'no query has reported a reason to be incomplete' }));
                return;
            }
            list.forEach(function (n) {
                box.appendChild(h('div', { class: 'mm-sub mm-selectable', style: 'padding:2px;white-space:normal', text: n }));
            });
            box.appendChild(h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Every incomplete query carries one of these as its reason.'));
        }

        /* --- timings -------------------------------------------------- */
        var timings = $.safe(function () { return X.timings(); }, 'index timings', []);
        var timingTable = W.table({
            key: 'index.timings',
            cols: [
                { label: 'stage', w: '1 1 0' },
                { label: 'ms', w: '0 0 62px', cls: 'mm-td-num' }
            ],
            empty: 'no stage has been timed yet',
            render: function (r) {
                return [h('span', { class: 'mm-cell mm-selectable', text: r.stage }), String(r.ms)];
            }
        });
        timingTable.mm.paint(timings);
        function totalOf(rows) { return rows.reduce(function (a, r) { return a + (r.ms || 0); }, 0); }
        function costText(rows, s) {
            return 'Slowest first. Total ' + totalOf(rows) + 'ms' +
                (s.fromCache ? ' when it was last built — this session loaded the cache.' : '.');
        }
        var total = totalOf(timings);
        var costNote = h('div', { class: 'mm-sub', style: 'padding:4px 2px;white-space:normal', text: costText(timings, st) });

        /* --- benchmark ------------------------------------------------ */
        var benchRows = lastBench || [];
        var benchTable = W.table({
            cols: [
                { label: 'measurement', w: '1 1 0' },
                { label: 'ms', w: '0 0 52px', cls: 'mm-td-num' },
                { label: 'detail', w: '0 0 150px' }
            ],
            empty: 'not measured yet — press Benchmark',
            render: function (r) {
                return [
                    h('span', { class: 'mm-cell mm-selectable', text: r.what }),
                    String(r.ms),
                    h('span', { class: 'mm-cell mm-sub', text: r.detail || '' })
                ];
            },
            onRow: function (tr, r) {
                if (r.detail) tr.setAttribute('data-mm-tip', r.what + '|' + r.detail);
            }
        });
        benchTable.mm.paint(benchRows);

        var benchGroup = W.group('Benchmark', [
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'The same question asked with the index and without it, back to back.'),
            W.button({
                label: 'Benchmark', wide: true, _ungated: true,
                onClick: function () {
                    lastBench = $.safe(function () { return X.benchmark(); }, 'index benchmark', []);
                    U.rerender();
                }
            }),
            benchTable
        ], { grow: true, tag: benchRows.length ? benchRows.length + ' measured' : 'not run' });

        var statusGroup = W.group('Status', statusRows, { tag: st.phase });
        var countsGroup = W.group('Contents', [], { tag: 'counts' });
        var notesGroup = W.group('Notes', [], { tag: (st.notes || []).length + '' });
        var costGroup = W.group('Build cost', [timingTable, costNote], { tag: total + 'ms' });
        countsInto(countsGroup.mm.body, st);
        notesInto(notesGroup.mm.body, st);

        /* One signal for the whole panel. `built` and `error` are in it because
           a build that finishes and one that fails both leave the phase at a
           value it could already have had, and `notes.length` because a note
           can arrive without the phase moving at all. */
        U.live(function () {
            var s = $.safe(function () { return X.status(); }, 'index status', null);
            if (!s) return 'unreadable';
            return s.phase + '|' + s.progress + '|' + s.stage + '|' + s.built + '|' +
                (s.error || '') + '|' + (s.notes || []).length + '|' + (s.fromCache ? 1 : 0);
        }, function () {
            var s = $.safe(function () { return X.status(); }, 'index status', null);
            if (!s) return;
            phaseRow.mm.set(s.phase);
            progressRow.mm.set(progressText(s));
            builtRow.mm.set(s.built ? new Date(s.built).toLocaleString() : '—');
            sourceRow.mm.set(s.fromCache ? 'loaded from cache' : 'built this session');
            errorRow.textContent = s.error ? String(s.error) : '';
            errorRow.style.display = s.error ? '' : 'none';
            statusGroup.mm.tag(s.phase);
            countsInto(countsGroup.mm.body, s);
            notesGroup.mm.tag((s.notes || []).length + '');
            notesInto(notesGroup.mm.body, s);
            var t = $.safe(function () { return X.timings(); }, 'index timings', []);
            timingTable.mm.paint(t);
            costNote.textContent = costText(t, s);
            costGroup.mm.tag(totalOf(t) + 'ms');
        }, { name: 'debug/Index', within: statusGroup });

        return cols(
            [statusGroup, countsGroup, notesGroup],
            [costGroup, benchGroup]
        );
    }

})(window.GigaHack);
