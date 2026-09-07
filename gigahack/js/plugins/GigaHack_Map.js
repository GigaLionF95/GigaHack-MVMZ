//=============================================================================
// GigaHack MV/MZ
// 14 · map.js — map tree, teleport, safe landing, bookmarks, history
//-----------------------------------------------------------------------------
// Safe landing probes the TARGET map, which is not the loaded one, so the
// engine's own passability code cannot be called against it directly:
// Game_Map.tileId reads the global $dataMap, and $dataMap is whichever map the
// player is standing on.
//
// The probe therefore borrows Game_Map.prototype onto a bare object and swaps
// $dataMap for the duration of one synchronous search, rather than
// reimplementing checkPassage. That is deliberate and it is the whole point of
// the technique:
//
//   INVARIANT: passability is not a fixed rule. Plugins commonly replace
//   Game_Map.prototype.checkPassage or isPassable outright — changing how ☆
//   tiles, region flags or per-tile note tags behave — so a hand-written copy
//   of the engine's rules is wrong on exactly the games that need it most.
//   Borrowing the live prototype means the probe automatically follows
//   whatever rules are actually installed, and inherits future ones for free.
//
// The swap is safe because the search never yields: it is one synchronous
// pass with a try/finally, so nothing else can observe $dataMap mid-flight.
//
// One file, two engines. Everything that differs is asked as a capability
// ($.caps.* / $.eng.*), never as a version string — including the name of the
// tile-event list the borrowed prototype will read.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — teleport, map tree and bookmarks
 * @author gigahack
 * @help GigaHack_Map.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Backup; uses Index for map search.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — map not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    /* =====================================================================
       PART 1 — MODEL
       ===================================================================== */
    var M = $.map = {};

    var mapCache = Object.create(null);   // mapId -> parsed Map JSON
    var loading = Object.create(null);
    var history = [];                      // {mapId,x,y,name,at}
    var bookmarks = [];

    function alive() {
        return typeof $gameMap !== 'undefined' && $gameMap &&
            typeof $dataMapInfos !== 'undefined' && $dataMapInfos;
    }
    M.alive = alive;

    M.currentMapId = function () { return $.safe(function () { return $gameMap.mapId(); }, 'mapId', 0) || 0; };
    M.currentPos = function () {
        return $.safe(function () { return { x: $gamePlayer.x, y: $gamePlayer.y, d: $gamePlayer.direction() }; },
            'player pos', { x: 0, y: 0, d: 2 });
    };

    M.mapName = function (id) {
        return $.safe(function () {
            var i = $dataMapInfos[id];
            return i ? i.name : '';
        }, 'map name', '') || ('map ' + id);
    };

    /* ------------------------------------------------------------ map tree */
    M.tree = function () {
        return $.safe(function () {
            var byParent = Object.create(null), all = [];
            $dataMapInfos.forEach(function (i) {
                if (!i) return;
                all.push(i);
                (byParent[i.parentId] = byParent[i.parentId] || []).push(i);
            });
            Object.keys(byParent).forEach(function (k) {
                byParent[k].sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
            });
            return { byParent: byParent, count: all.length };
        }, 'map tree', { byParent: {}, count: 0 });
    };

    /* --------------------------------------------------------- map search
       The index answers "which map ids match this text" without walking the
       whole tree, but it is never authority: every candidate is re-resolved
       against the live $dataMapInfos entry before it is allowed to match, and
       an id the index knows that this database no longer has is dropped
       rather than shown.

       When the index cannot answer — still building, never built, no index
       module at all — the linear walk below still can. The only cost is time,
       so the reason is shown and nothing else changes.
       ------------------------------------------------------------------ */
    M.search = function (query) {
        var out = { ids: null, count: 0, why: '' };
        var q = String(query || '').toLowerCase().trim();
        if (!q) return out;
        if (!$.index || !$.index.findMap) {
            out.why = 'the index module is not installed — searching the long way instead.';
            return out;
        }
        var r = $.safe(function () { return $.index.findMap(q); }, 'index map search', null);
        if (!r) { out.why = 'the map search threw — searching the long way instead.'; return out; }
        if (!r.complete) { out.why = r.why; return out; }      // linear fallback, with the reason shown

        var ids = Object.create(null), n = 0;
        (r.candidates || []).forEach(function (c) {
            if (!c || !(c.id > 0)) return;
            var live = $.safe(function () {
                return (typeof $dataMapInfos !== 'undefined' && $dataMapInfos && $dataMapInfos[c.id]) || null;
            }, 'map info', null);
            if (!live) return;                                  // the index is ahead of this database
            var name = String(live.name || '').toLowerCase();
            if (name.indexOf(q) === -1 && String(c.id).indexOf(q) === -1) return;   // renamed since indexing
            if (!ids[c.id]) { ids[c.id] = true; n++; }
        });
        out.ids = ids; out.count = n;
        return out;
    };

    /**
     * Flatten the tree into rows honouring the persisted expand state.
     *
     * `ids` is an optional id -> true set from M.search(). When it is present
     * it decides which maps match; the walk down the tree is unchanged, so a
     * parent still appears when only a child matched.
     */
    M.rows = function (query, ids) {
        var t = M.tree();
        var open = $.store.cfgGet('map.expanded', null);
        var expanded = Object.create(null);
        if (open) open.forEach(function (id) { expanded[id] = true; });
        var q = (query || '').toLowerCase();
        var out = [];

        function hasMatch(info) {
            if (!q) return true;
            if (ids) {
                if (ids[info.id]) return true;
            } else {
                if (String(info.id).indexOf(q) > -1) return true;
                if ((info.name || '').toLowerCase().indexOf(q) > -1) return true;
            }
            return (t.byParent[info.id] || []).some(hasMatch);
        }

        function walk(parentId, depth) {
            (t.byParent[parentId] || []).forEach(function (info) {
                if (!hasMatch(info)) return;
                var kids = t.byParent[info.id] || [];
                // While searching, everything on a matching path is expanded.
                var isOpen = q ? true : !!expanded[info.id];
                out.push({
                    id: info.id, name: info.name || '(unnamed)', depth: depth,
                    kids: kids.length, open: isOpen
                });
                if (isOpen) walk(info.id, depth + 1);
            });
        }
        walk(0, 0);
        return out;
    };

    M.toggleExpand = function (id) {
        var list = ($.store.cfgGet('map.expanded', []) || []).slice();
        var i = list.indexOf(id);
        if (i > -1) list.splice(i, 1); else list.push(id);
        $.store.cfgSet('map.expanded', list);
    };
    M.expandAll = function () {
        var t = M.tree();
        $.store.cfgSet('map.expanded', Object.keys(t.byParent).map(Number).filter(Boolean));
    };
    M.collapseAll = function () { $.store.cfgSet('map.expanded', []); };

    /* ------------------------------------------------------- map data load */
    /**
     * Ask the game's delivery layer where a data file really lives.
     *
     * Some games are played through a mod loader that redirects data/ reads at
     * runtime, so the file sitting at the plain URL is not the one the engine
     * loaded for that map. Where the active profile supplies a modLoader
     * adapter the URL goes through it; where it does not, adapter() returns
     * null and the plain URL is already the right answer. No third-party
     * global is named here — which loader a game uses is the profile's
     * knowledge, not this module's.
     */
    function resolveUrl(url) {
        return $.safe(function () {
            var ml = $.profile ? $.profile.adapter('modLoader') : null;
            if (!ml || typeof ml.updateURL !== 'function') return url;
            var r = ml.updateURL(url);
            // An adapter may answer with the URL itself or with a [was, is] pair.
            if (typeof r === 'string') return r || url;
            return (r && r[1]) || url;
        }, 'resolve map url', url);
    }

    M.mapData = function (mapId) { return mapCache[mapId] || null; };

    M.loadMapData = function (mapId, cb) {
        if (mapCache[mapId]) { cb(mapCache[mapId]); return; }
        if (loading[mapId]) { loading[mapId].push(cb); return; }
        loading[mapId] = [cb];
        $.safe(function () {
            var name = 'Map' + String(mapId).padStart(3, '0') + '.json';
            var xhr = new XMLHttpRequest();
            xhr.open('GET', resolveUrl('data/' + name));
            xhr.overrideMimeType('application/json');
            xhr.onload = function () {
                var data = null;
                if (xhr.status < 400) {
                    data = $.safe(function () { return JSON.parse(xhr.responseText); }, 'parse ' + name, null);
                }
                if (data) mapCache[mapId] = data;
                else $.log('warn', 'could not read ' + name);
                var waiting = loading[mapId] || []; delete loading[mapId];
                waiting.forEach(function (fn) { $.safe(function () { fn(data); }, 'map load callback'); });
            };
            xhr.onerror = function () {
                $.log('warn', 'failed to load map ' + mapId);
                var waiting = loading[mapId] || []; delete loading[mapId];
                waiting.forEach(function (fn) { $.safe(function () { fn(null); }, 'map load callback'); });
            };
            xhr.send();
        }, 'load map ' + mapId);
    };

    /* -------------------------------------------------------- safe landing */
    /**
     * Find somewhere the player can actually stand on `data`.
     *   1. spiral out from the centre for a tile passable in all four
     *      directions with no priority-normal event on it
     *   2. relax to "passable in at least one direction"
     *   3. the first event's tile
     *   4. the map centre, whatever it is
     */
    M.findLanding = function (data) {
        if (!data || !data.width || !data.height) return null;
        var cx = Math.floor(data.width / 2), cy = Math.floor(data.height / 2);

        // Tiles occupied by an event that could block movement on any page.
        var blocked = Object.create(null);
        var firstEvent = null;
        (data.events || []).forEach(function (ev) {
            if (!ev) return;
            if (!firstEvent) firstEvent = ev;
            var blocks = (ev.pages || []).some(function (p) { return p && p.priorityType === 1; });
            if (blocks) blocked[ev.x + ',' + ev.y] = true;
        });

        var result = $.safe(function () {
            if (typeof Game_Map === 'undefined') return null;
            var probe = Object.create(Game_Map.prototype);
            probe._tilesetId = data.tilesetId;
            /* checkPassage consults tile events as well as the tilemap, via
               tileEventsXy() — and the two engines keep that list under
               different names, so the borrowed prototype reads whichever one
               its own engine uses. Leaving it undefined is not "no tile
               events", it is a TypeError inside .filter() that takes the whole
               probe down to the map-centre fallback.

               It must be EMPTY, not $.eng.tileEvents(): that reader answers for
               the LOADED map, and this probe is deliberately looking at a
               different one. The target map's own tile events are unknowable
               without instantiating it, and an empty list is the honest
               approximation — the landing search only widens because of it. */
            probe[$.caps.tileEventsKey] = [];
            probe.tileEvents = probe.tileEvents || [];      // and the other name,
            probe._tileEvents = probe._tileEvents || [];    // for a plugin that reads it

            // One swap for the whole search. Synchronous, so nothing else can
            // observe the global mid-flight.
            var realMap = window.$dataMap;
            window.$dataMap = data;
            try {
                var DIRS = [2, 4, 6, 8];
                function score(x, y) {
                    if (blocked[x + ',' + y]) return -1;
                    var n = 0;
                    for (var i = 0; i < DIRS.length; i++) if (probe.isPassable(x, y, DIRS[i])) n++;
                    return n;
                }
                var best = null, relaxed = null;
                var maxR = Math.max(data.width, data.height);
                for (var r = 0; r <= maxR; r++) {
                    for (var dy = -r; dy <= r; dy++) {
                        for (var dx = -r; dx <= r; dx++) {
                            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                            var x = cx + dx, y = cy + dy;
                            if (x < 0 || y < 0 || x >= data.width || y >= data.height) continue;
                            var s = score(x, y);
                            if (s === 4) { best = { x: x, y: y, why: 'open tile' }; break; }
                            if (s > 0 && !relaxed) relaxed = { x: x, y: y, why: 'partly passable tile' };
                        }
                        if (best) break;
                    }
                    if (best) break;
                }
                return best || relaxed;
            } finally {
                window.$dataMap = realMap;
            }
        }, 'landing probe', null);

        if (result) return result;
        if (firstEvent) return { x: firstEvent.x, y: firstEvent.y, why: 'first event (no passable tile found)' };
        return { x: cx, y: cy, why: 'map centre (nothing better found)' };
    };

    /* ------------------------------------------------------------ teleport */
    M.canTeleport = function () {
        if (!alive()) return 'no map loaded';
        if (typeof SceneManager === 'undefined' || !SceneManager._scene) return 'no scene';
        if (typeof Scene_Map !== 'undefined' && !(SceneManager._scene instanceof Scene_Map)) {
            return 'only from the map scene — close any menu first';
        }
        if ($.safe(function () { return $gameParty.inBattle(); }, 'inBattle', false)) return 'not during battle';
        if ($.safe(function () { return $gameMessage.isBusy(); }, 'msg busy', false)) {
            return 'a message is on screen — dismiss it first';
        }
        if ($.safe(function () { return $gameMap.isEventRunning(); }, 'event running', false)) {
            return 'an event is running — wait for it to finish';
        }
        return null;
    };

    /**
     * Irreversible by design (§6.4) — no undo entry. The save backup taken
     * immediately before is the recovery path.
     */
    M.teleport = function (mapId, x, y, d, fade, opts) {
        opts = opts || {};
        if (!$.allowWrite('Teleporting')) return false;
        var why = M.canTeleport();
        if (why && !opts.force) {
            U.toast({ title: 'CANNOT TELEPORT', msg: why, severity: 'warn' });
            $.log('warn', 'teleport refused: ' + why);
            return false;
        }

        var b = $.backup.guard('teleport');
        if (b.created) U.toast({ title: 'SAVE BACKED UP', msg: b.entry.name, severity: 'ok' });

        var from = { mapId: M.currentMapId(), x: M.currentPos().x, y: M.currentPos().y, at: Date.now() };
        from.name = M.mapName(from.mapId);
        if (from.mapId) {
            history.unshift(from);
            if (history.length > 30) history.pop();
        }

        var ok = $.safe(function () {
            $gamePlayer.reserveTransfer(mapId, x, y, d || 0, fade == null ? 0 : fade);
            return true;
        }, 'reserveTransfer', false);

        if (ok) {
            $.log('warn', 'teleport → map ' + mapId + ' "' + M.mapName(mapId) + '" @ ' + x + ',' + y +
                ' (irreversible — backup ' + (b.created ? b.entry.name : b.skipped) + ')');
        }
        return ok;
    };

    M.history = function () { return history.slice(); };
    M.back = function () {
        var e = history[0];
        if (!e) { U.toast({ title: 'NO HISTORY', msg: 'Nowhere to go back to', severity: 'warn' }); return false; }
        history.shift();               // teleport() will push the current spot
        return M.teleport(e.mapId, e.x, e.y, 0, 0);
    };

    /* ----------------------------------------------------------- bookmarks */
    function loadBookmarks() {
        var m = $.store.read('bookmarks.json', null) || {};
        bookmarks = Array.isArray(m.places) ? m.places : [];
    }
    function saveBookmarks() {
        var m = $.store.read('bookmarks.json', {}) || {};
        m.places = bookmarks;
        $.store.write('bookmarks.json', m);
    }
    M.bookmarks = function () { return bookmarks.slice(); };
    M.addBookmark = function (name) {
        var p = M.currentPos();
        var id = M.currentMapId();
        if (!id) return false;
        bookmarks.push({
            name: name || (M.mapName(id) + ' ' + p.x + ',' + p.y),
            mapId: id, x: p.x, y: p.y, at: Date.now()
        });
        saveBookmarks();
        $.log('ok', 'bookmarked ' + M.mapName(id) + ' @ ' + p.x + ',' + p.y);
        return true;
    };
    M.removeBookmark = function (i) {
        bookmarks.splice(i, 1);
        saveBookmarks();
    };
    loadBookmarks();

    /* =====================================================================
       PART 2 — TAB
       ===================================================================== */
    var ROW_H = 17;
    var selected = null;          // {id, name}
    var target = { x: 0, y: 0, d: 0, fade: 0, mode: 'safe' };
    var landingNote = '';

    // Set by buildMaps(); selecting a map repaints just these two rather than
    // rebuilding the tab, which would otherwise throw the (scrolled) tree away.
    var refreshPanel = function () { };
    var refreshTree = function () { };

    function selectMap(id) {
        selected = { id: id, name: M.mapName(id) };
        landingNote = 'loading map data…';
        refreshPanel(); refreshTree();
        M.loadMapData(id, function (data) {
            if (!selected || selected.id !== id) return;
            if (!data) {
                landingNote = 'map data unavailable — using 0,0';
                target.x = 0; target.y = 0;
                refreshPanel();
                return;
            }
            var land = M.findLanding(data);
            selected.w = data.width; selected.h = data.height;
            selected.events = (data.events || []).filter(Boolean).length;
            if (target.mode !== 'exact') { target.x = land.x; target.y = land.y; }
            landingNote = data.width + '×' + data.height + ' · landing: ' + land.why;
            refreshPanel();
        });
    }

    function buildMaps() {
        var q = '';

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'id', w: '0 0 46px', cls: 'mm-td-num' },
                { label: 'map', w: '1 1 0' },
                { label: '', w: '0 0 52px' }
            ],
            empty: 'no matches',
            render: function (r) {
                var twisty = r.kids
                    ? h('button', {
                        class: 'mm-twisty' + (r.open ? ' mm-open' : ''),
                        tip: (r.open ? 'Collapse' : 'Expand') + '|' + r.kids + ' child map(s)',
                        onclick: function (e) {
                            e.stopPropagation();       // fold, do not select
                            M.toggleExpand(r.id);
                            repaint();
                        }
                    })
                    : h('i', { class: 'mm-twisty-none' });
                return [
                    twisty,
                    String(r.id),
                    h('span', {
                        style: 'padding-left:' + (r.depth * 11) + 'px;overflow:hidden;text-overflow:ellipsis',
                        text: r.name
                    }),
                    r.id === M.currentMapId()
                        ? h('span', { class: 'mm-sub', style: 'color:var(--mm-ok)', text: 'here' })
                        : (selected && selected.id === r.id
                            ? h('span', { class: 'mm-sub mm-acc', text: 'target' }) : null)
                ];
            },
            onRow: function (tr, r) {
                if (selected && selected.id === r.id) tr.classList.add('mm-on');
                tr.style.cursor = 'pointer';
                tr.setAttribute('data-mm-tip', 'Map ' + r.id + '|' + r.name +
                    (r.kids ? ' · ' + r.kids + ' child map(s)' : ''));
                tr.addEventListener('click', function () { selectMap(r.id); });
            }
        });

        var tag = h('span', { class: 'mm-group-tag' });
        // One line under the toolbar, used only when the index could not
        // answer. It is not an error: the linear walk found the same rows, it
        // just took longer, and the reason is already written for the user.
        var why = h('div', {
            class: 'mm-sub',
            style: 'display:none;padding:1px 4px;white-space:normal;color:var(--mm-warn)'
        });
        function repaint() {
            // One index query per repaint, not one per row.
            var found = M.search(q);
            var rows = M.rows(q, found.ids);
            tag.textContent = rows.length + ' / ' + M.tree().count;
            why.textContent = found.why || '';
            why.style.display = found.why ? '' : 'none';
            table.mm.paint(rows);
        }
        repaint();

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({
                placeholder: 'search ' + M.tree().count + ' maps…',
                onInput: function (v) { q = v.trim(); repaint(); }
            }),
            W.button({ label: 'expand', _ungated: true, onClick: function () { M.expandAll(); repaint(); } }),
            W.button({ label: 'collapse', _ungated: true, onClick: function () { M.collapseAll(); repaint(); } }),
            W.button({
                label: 'reveal current', _ungated: true,
                onClick: function () {
                    // Open every ancestor of the current map, then select it.
                    var id = M.currentMapId(), list = ($.store.cfgGet('map.expanded', []) || []).slice();
                    var guard = 0, cur = id;
                    while (cur && guard++ < 64) {
                        var info = $dataMapInfos[cur];
                        if (!info) break;
                        cur = info.parentId;
                        if (cur && list.indexOf(cur) === -1) list.push(cur);
                    }
                    $.store.cfgSet('map.expanded', list);
                    if (id) selectMap(id); else repaint();
                }
            }));

        var group = W.group('Maps', [toolbar, why, table], { grow: true });
        group.mm.head.appendChild(tag);

        // Hand-built body: selecting a map repaints only the left column and
        // re-renders the table's current window, so the tree keeps both its
        // scroll position and its expand state.
        var left = h('div', { class: 'mm-col mm-col-narrow' });
        refreshPanel = function () {
            var keep = left.scrollTop;
            U.clear(left);
            U.add(left, targetPanel());
            left.scrollTop = keep;
        };
        refreshTree = function () { table.mm.refresh(); };
        refreshPanel();

        return h('div', { class: 'mm-body' }, left, h('div', { class: 'mm-col' }, group));
    }

    function targetPanel() {
        var pos = M.currentPos();
        var here = M.currentMapId();
        var out = [];

        out.push(W.group('Here', [
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'Map' }),
                // A project names its own maps and some of those names are long.
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-path mm-mono mm-hi',
                    text: here ? here + ' · ' + M.mapName(here) : '—',
                    title: here ? here + ' · ' + M.mapName(here) : null
                })),
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'Position' }),
                h('div', { class: 'mm-edge mm-mono mm-hi', text: pos.x + ',' + pos.y })),
            W.button({
                label: 'bookmark this spot', wide: true, _ungated: true,
                onClick: function () {
                    if (M.addBookmark()) {
                        U.toast({ title: 'BOOKMARKED', msg: M.mapName(here), severity: 'ok' });
                        U.rerender();
                    }
                }
            })
        ], { tag: '$gamePlayer' }));

        if (!selected) {
            out.push(W.group('Target', [
                h('div', { class: 'mm-empty', text: 'pick a map on the right' })
            ]));
        } else {
            var blocked = M.canTeleport();
            out.push(W.group('Target', [
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Map' }),
                    h('div', { class: 'mm-edge mm-mono mm-hi', text: String(selected.id) })),
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', style: 'white-space:normal', text: selected.name })),
                W.row('Landing', W.dropdown({
                    options: ['safe', 'exact'], value: target.mode, width: '90px', _ungated: true,
                    tip: 'Landing|"safe" finds a standable tile; "exact" uses the numbers below.',
                    onChange: function (v) {
                        target.mode = v;
                        if (v === 'safe' && selected) selectMap(selected.id); else U.rerender();
                    }
                })),
                W.row('X', W.number({
                    value: target.x, min: 0, max: 999, wide: true, _ungated: true,
                    onChange: function (v) { target.x = v; target.mode = 'exact'; }
                })),
                W.row('Y', W.number({
                    value: target.y, min: 0, max: 999, wide: true, _ungated: true,
                    onChange: function (v) { target.y = v; target.mode = 'exact'; }
                })),
                W.row('Facing', W.dropdown({
                    options: ['keep', 'down', 'left', 'right', 'up'], width: '90px', _ungated: true,
                    value: ['keep', 'down', 'left', 'right', 'up'][[0, 2, 4, 6, 8].indexOf(target.d)] || 'keep',
                    onChange: function (v) { target.d = [0, 2, 4, 6, 8][['keep', 'down', 'left', 'right', 'up'].indexOf(v)]; }
                })),
                W.row('Fade', W.dropdown({
                    options: ['black', 'white', 'none'], value: ['black', 'white', 'none'][target.fade] || 'black',
                    width: '90px', _ungated: true,
                    onChange: function (v) { target.fade = ['black', 'white', 'none'].indexOf(v); }
                })),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal', text: landingNote }),
                h('div', { class: 'mm-sep' }),
                blocked ? h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: 'Cannot teleport: ' + blocked
                }) : null,
                W.button({
                    label: 'teleport', wide: true, variant: 'danger', mutates: true,
                    confirmLabel: 'go? (irreversible)',
                    tip: 'Teleport|Backs the save up first. There is no undo — use Debug → Backups to recover.',
                    onClick: function () {
                        if (M.teleport(selected.id, target.x, target.y, target.d, target.fade)) {
                            U.setOpen(false);
                        }
                    }
                })
            ], { tag: selected.w ? selected.w + '×' + selected.h : '…' }));
        }

        var hist = M.history();
        out.push(W.group('History', hist.length ? [
            W.button({
                label: 'back to ' + (hist[0].name || hist[0].mapId), wide: true, variant: 'danger', mutates: true,
                onClick: function () { if (M.back()) U.setOpen(false); }
            })
        ].concat(hist.slice(0, 6).map(function (e) {
            return h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: e.name || ('map ' + e.mapId) }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: e.x + ',' + e.y }));
        })) : [h('div', { class: 'mm-empty', text: 'no jumps yet' })], { tag: hist.length + '' }));

        return out;
    }

    /* ----------------------------------------------------------- Bookmarks */
    function buildBookmarks() {
        var list = M.bookmarks();
        var nameInput = W.text({ placeholder: 'name (optional)', width: '100%' });

        var table = W.table({
            cols: [
                { label: 'name', w: '1 1 0' },
                { label: 'map', w: '0 0 150px', cls: 'mm-td-num' },
                { label: 'x,y', w: '0 0 66px', cls: 'mm-td-num' },
                { label: '', w: '0 0 108px' }
            ],
            empty: 'no bookmarks yet — use "bookmark this spot" on the Teleport tab',
            render: function (b, i) {
                return [
                    h('span', { class: 'mm-hi', text: b.name }),
                    b.mapId + ' · ' + M.mapName(b.mapId),
                    b.x + ',' + b.y,
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'go', mini: true, variant: 'danger', mutates: true,
                            onClick: function () { if (M.teleport(b.mapId, b.x, b.y, 0, 0)) U.setOpen(false); }
                        }),
                        W.button({
                            label: 'delete', mini: true, variant: 'danger', mutates: true,
                            onClick: function () { M.removeBookmark(i); U.rerender(); }
                        }))
                ];
            }
        });
        table.mm.paint(list);

        return cols({ narrow: true, items: [
            W.group('Add', [
                W.row('Name', nameInput),
                W.button({
                    label: 'bookmark current spot', wide: true, _ungated: true,
                    onClick: function () {
                        if (!M.currentMapId()) {
                            U.toast({ title: 'NO MAP', msg: 'Enter a map first', severity: 'warn' });
                            return;
                        }
                        M.addBookmark(nameInput.value.trim() || null);
                        U.rerender();
                    }
                })
            ], { tag: 'bookmarks.json' })
        ] }, [
            W.group('Bookmarks', [table], { grow: true, tag: list.length + '' })
        ]);
    }

    /* -------------------------------------------------------- registration */
    function noMap() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'no map loaded' }),
                h('div', { text: 'start or load a game, then reopen this tab' })));
    }
    function onMap(fn) { return function () { return M.alive() ? fn() : noMap(); }; }

    U.panel('world', 'Teleport', onMap(buildMaps), 70);
    U.panel('world', 'Places', onMap(buildBookmarks), 80);

    $.log('ok', 'teleport ready');

})(window.GigaHack);
