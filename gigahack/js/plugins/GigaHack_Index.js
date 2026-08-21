//=============================================================================
// GigaHack MV/MZ
// 09 · index.js — the boot index and cache
//-----------------------------------------------------------------------------
// ONE RULE, and everything else follows from it:
//
//     THE INDEX IS FOR FINDING. IT IS NEVER AUTHORITY.
//
// Every read and every write in this mod still goes to the live $data* and
// $game* objects. The index may only ever produce a CANDIDATE LIST, which the
// caller then resolves against live data. That single constraint eliminates
// the entire "the cache said X, the game had Y" class of bug — the class that
// makes caches in mod menus a net negative more often than not.
//
// Scope is set by measurement, not by ambition. build() times every stage and
// records it; Debug → Index shows what each one cost. If a stage is cheap it
// does not need an index, and an index nobody needed is just a large file and
// a new way to be wrong.
//
// Nothing here blocks boot. The build is chunked through requestIdleCallback
// (or a timer where that is unavailable) rather than the game's frame hooks,
// deliberately: a fast-forward plugin that runs Scene_Map.update five times a
// frame would otherwise run five index chunks a frame too.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — boot index and cache
 * @author gigahack
 * @help GigaHack_Index.js — requires Core, Caps, Store, Profile
 */

(function ($) {
    'use strict';
    if (!$) { console.error('[GigaHack] core missing — index not installed'); return; }

    var X = $.index = {};

    var FORMAT = 4;                 // bump when the on-disk shape changes
    var FILE = 'index.json';

    var state = {
        phase: 'idle',              // idle | building | ready | failed | disabled
        progress: 0,                // 0..1
        stage: '',
        built: null,                // timestamp
        fromCache: false,
        timings: {},                // stage -> ms
        notes: [],
        error: null
    };

    var data = null;                // the index itself

    /* =====================================================================
       1. Fingerprint
       Cheap to compute, and catches the cases that actually happen: the game
       was patched, the mod was updated, a plugin was installed, or this is a
       different game entirely. Anything else is a staleness bug we accept,
       because the index is only ever a candidate list.
       ===================================================================== */
    function fingerprint() {
        return $.safe(function () {
            function len(a) { return (a && a.length) ? a.length : 0; }
            var fp = {
                format: FORMAT,
                mod: $.version,
                engine: $.caps.engine + ' ' + $.caps.engineVersion,
                title: (typeof $dataSystem !== 'undefined' && $dataSystem) ? String($dataSystem.gameTitle || '') : '',
                items: len(typeof $dataItems !== 'undefined' && $dataItems),
                maps: len(typeof $dataMapInfos !== 'undefined' && $dataMapInfos),
                vars: (typeof $dataSystem !== 'undefined' && $dataSystem && $dataSystem.variables) ? $dataSystem.variables.length : 0,
                system: null,
                plugins: null
            };

            // System.json size + mtime: catches a content patch that keeps the
            // same counts.
            if ($.caps.fs && $.paths.gameRoot) {
                var path = $.env.path, fs = $.env.fs;
                var candidates = [
                    path.join($.paths.gameRoot, 'data', 'System.json'),
                    path.join($.paths.gameRoot, 'www', 'data', 'System.json')
                ];
                for (var i = 0; i < candidates.length; i++) {
                    try {
                        var st = fs.statSync(candidates[i]);
                        fp.system = st.size + ':' + Math.floor(st.mtimeMs || (st.mtime && st.mtime.getTime()) || 0);
                        break;
                    } catch (e) { /* try the next */ }
                }
            }

            // The loaded plugin list. Installing VisuMZ changes no count above
            // but changes what the game does, and an index of "which event
            // touches switch 42" is only as good as the plugin set that
            // produced it.
            fp.plugins = $.safe(function () {
                var names = ($.compat && $.compat.plugins) ? $.compat.plugins() : [];
                return names.slice().sort().join(',');
            }, 'fingerprint plugins', null);

            return fp;
        }, 'fingerprint', { format: FORMAT, mod: $.version });
    }

    function sameFingerprint(a, b) {
        if (!a || !b) return false;
        var keys = ['format', 'mod', 'engine', 'title', 'items', 'maps', 'vars', 'system', 'plugins'];
        for (var i = 0; i < keys.length; i++) {
            if (a[keys[i]] !== b[keys[i]]) return false;
        }
        return true;
    }
    X.fingerprint = fingerprint;

    /* =====================================================================
       2. The chunked runner
       A stage is a generator-ish object: { name, total, step(i) }. The runner
       spends a slice of an idle period on it and yields.
       ===================================================================== */
    var BUDGET_MS = 8;              // per slice; well under a frame at 60fps
    var running = null;

    function schedule(fn) {
        if ($.caps.idleCallback) {
            window.requestIdleCallback(function (deadline) {
                fn(function () {
                    return deadline.timeRemaining ? deadline.timeRemaining() > 1 : false;
                });
            }, { timeout: 200 });
        } else {
            setTimeout(function () {
                var t0 = Date.now();
                fn(function () { return Date.now() - t0 < BUDGET_MS; });
            }, 0);
        }
    }

    function runStages(stages, done) {
        var si = 0, i = 0, t0 = Date.now(), stageStart = Date.now();
        var totalUnits = stages.reduce(function (a, s) { return a + Math.max(1, s.total); }, 0);
        var doneUnits = 0;

        function pump(hasTime) {
            if (running !== pump) return;      // a rebuild superseded us
            while (si < stages.length) {
                var s = stages[si];
                if (i === 0) { stageStart = Date.now(); state.stage = s.name; }
                while (i < s.total) {
                    if (!hasTime() && (Date.now() - t0) > BUDGET_MS) {
                        state.progress = totalUnits ? doneUnits / totalUnits : 0;
                        t0 = Date.now();
                        schedule(pump);
                        return;
                    }
                    $.safe(function () { s.step(i); }, 'index stage ' + s.name + ' @' + i);
                    i++; doneUnits++;
                }
                state.timings[s.name] = Date.now() - stageStart;
                si++; i = 0;
            }
            state.progress = 1;
            done();
        }

        running = pump;
        schedule(pump);
    }

    /* =====================================================================
       3. The indexes
       ===================================================================== */
    function blank() {
        return {
            fp: null,
            db: {},          // kind -> [{id, name, lc, icon, note}]
            vars: [],        // [{id, name, lc, section}]
            switches: [],
            sections: { vars: [], switches: [] },
            maps: [],        // [{id, name, parent, order}]
            events: null,    // {mapId: [{id, name, x, y, refs:{v:[],s:[],ss:[]}}]} — may stay null
            assets: null,    // {folder: [names]} — null when there is no filesystem
            plugins: [],
            stats: {}
        };
    }

    var DB_KINDS = [
        ['items', '$dataItems'], ['weapons', '$dataWeapons'], ['armors', '$dataArmors'],
        ['skills', '$dataSkills'], ['states', '$dataStates'], ['actors', '$dataActors'],
        ['classes', '$dataClasses'], ['enemies', '$dataEnemies'], ['troops', '$dataTroops'],
        ['common', '$dataCommonEvents']
    ];

    function stageDatabase(out) {
        var jobs = [];
        DB_KINDS.forEach(function (pair) {
            var arr = window[pair[1]];
            if (!arr || !arr.length) { out.db[pair[0]] = []; return; }
            out.db[pair[0]] = new Array(arr.length);
            jobs.push({ kind: pair[0], arr: arr });
        });
        var flat = [];
        jobs.forEach(function (j) {
            for (var i = 0; i < j.arr.length; i++) flat.push([j.kind, j.arr, i]);
        });
        return {
            name: 'database names',
            total: flat.length,
            step: function (n) {
                var kind = flat[n][0], arr = flat[n][1], i = flat[n][2];
                var row = arr[i];
                if (!row) { out.db[kind][i] = null; return; }
                var name = row.name === undefined ? '' : String(row.name);
                out.db[kind][i] = {
                    id: row.id !== undefined ? row.id : i,
                    name: name,
                    lc: name.toLowerCase(),
                    icon: row.iconIndex === undefined ? null : row.iconIndex,
                    note: (row.note && row.note.length) ? String(row.note).slice(0, 400) : ''
                };
            }
        };
    }

    function stageVarsSwitches(out) {
        var sysVars = $.safe(function () { return ($dataSystem && $dataSystem.variables) || []; }, 'sys vars', []);
        var sysSw = $.safe(function () { return ($dataSystem && $dataSystem.switches) || []; }, 'sys switches', []);
        var items = [];
        for (var i = 0; i < sysVars.length; i++) items.push(['vars', sysVars, i]);
        for (var j = 0; j < sysSw.length; j++) items.push(['switches', sysSw, j]);
        out.vars = new Array(sysVars.length);
        out.switches = new Array(sysSw.length);
        var currentSection = { vars: '', switches: '' };

        return {
            name: 'variables and switches',
            total: items.length,
            step: function (n) {
                var which = items[n][0], list = items[n][1], i = items[n][2];
                var name = list[i] === undefined || list[i] === null ? '' : String(list[i]);
                var target = which === 'vars' ? out.vars : out.switches;
                if ($.profile.isSectionHeader(name)) {
                    currentSection[which] = $.profile.sectionTitle(name);
                    out.sections[which].push({ id: i, title: currentSection[which] });
                    target[i] = { id: i, name: name, lc: name.toLowerCase(), section: currentSection[which], header: true };
                } else {
                    target[i] = {
                        id: i, name: name, lc: name.toLowerCase(),
                        section: currentSection[which], header: false,
                        named: name.length > 0
                    };
                }
            }
        };
    }

    function stageMaps(out) {
        var infos = $.safe(function () { return (typeof $dataMapInfos !== 'undefined' && $dataMapInfos) || []; }, 'map infos', []);
        out.maps = new Array(infos.length);
        return {
            name: 'map tree',
            total: infos.length,
            step: function (i) {
                var m = infos[i];
                if (!m) { out.maps[i] = null; return; }
                var name = String(m.name || '');
                out.maps[i] = {
                    id: m.id !== undefined ? m.id : i,
                    name: name, lc: name.toLowerCase(),
                    parent: m.parentId === undefined ? 0 : m.parentId,
                    order: m.order === undefined ? i : m.order
                };
            }
        };
    }

    /* --- the expensive one ----------------------------------------------
       Cross-map events. Reading every data/MapNNN.json is the only way to
       answer "which event touches switch 42" — the engine loads exactly one
       map at a time and keeps no such record. This is the stage that earns
       the index's existence, and the stage most likely to be skipped: it
       needs a filesystem, so on a browser build it simply is not available
       and the panel says so.
       ------------------------------------------------------------------ */
    function mapFiles() {
        return $.safe(function () {
            if (!$.caps.fs || !$.paths.gameRoot) return [];
            var path = $.env.path, fs = $.env.fs;
            var dirs = [path.join($.paths.gameRoot, 'data'), path.join($.paths.gameRoot, 'www', 'data')];
            for (var i = 0; i < dirs.length; i++) {
                try {
                    if (!fs.existsSync(dirs[i])) continue;
                    var names = fs.readdirSync(dirs[i]).filter(function (n) { return /^Map\d+\.json$/i.test(n); });
                    return names.map(function (n) {
                        return { id: parseInt(/(\d+)/.exec(n)[1], 10), file: path.join(dirs[i], n) };
                    }).sort(function (a, b) { return a.id - b.id; });
                } catch (e) { /* try the next */ }
            }
            return [];
        }, 'mapFiles', []);
    }

    /* Event command codes that carry variable/switch/self-switch references.
       Shared by MV and MZ — the command vocabulary is one of the things that
       did not change between engines. */
    function scanRefs(list, refs) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c) continue;
            var p = c.parameters || [];
            switch (c.code) {
                case 121:  // Control Switches (from, to, value)
                    for (var s = p[0]; s <= p[1]; s++) if (refs.s.indexOf(s) < 0) refs.s.push(s);
                    break;
                case 122:  // Control Variables (from, to, ...)
                    for (var v = p[0]; v <= p[1]; v++) if (refs.v.indexOf(v) < 0) refs.v.push(v);
                    if (p[3] === 1 && refs.v.indexOf(p[4]) < 0) refs.v.push(p[4]);   // operand: variable
                    break;
                case 123:  // Control Self Switch
                    if (refs.ss.indexOf(p[0]) < 0) refs.ss.push(p[0]);
                    break;
                case 111:  // Conditional Branch
                    if (p[0] === 0 && refs.s.indexOf(p[1]) < 0) refs.s.push(p[1]);
                    if (p[0] === 1) {
                        if (refs.v.indexOf(p[1]) < 0) refs.v.push(p[1]);
                        if (p[2] === 1 && refs.v.indexOf(p[3]) < 0) refs.v.push(p[3]);
                    }
                    if (p[0] === 2 && refs.ss.indexOf(p[1]) < 0) refs.ss.push(p[1]);
                    break;
                case 201:  // Transfer Player — records the destination map
                    if (p[0] === 1) { /* variable-driven, ids in p[1..3] */
                        [p[1], p[2], p[3]].forEach(function (id) { if (refs.v.indexOf(id) < 0) refs.v.push(id); });
                    }
                    break;
                default: break;
            }
        }
    }

    function stageEvents(out) {
        var files = mapFiles();
        if (!files.length) {
            out.events = null;
            // null, not {}: "the scan did not run" and "the scan ran and found
            // none" are different answers, and the encounter panel degrades
            // differently for each.
            out.encounters = null;
            state.notes.push($.caps.fs
                ? 'cross-map event index: no data/MapNNN.json files were found under ' + $.paths.gameRoot + '.'
                : 'cross-map event index: unavailable — ' + $.caps.fsWhy);
            return { name: 'cross-map events (skipped)', total: 0, step: function () { } };
        }
        out.events = {};
        /* encounterList rides along with the event scan rather than getting a
           pass of its own: this stage already parses every data/MapNNN.json,
           and "does this game have random encounters anywhere" is otherwise a
           second read of all 100+ of them for one integer per file. */
        out.encounters = {};
        var fs = $.env.fs;
        var totalEvents = 0;
        var encounterMaps = 0;
        return {
            name: 'cross-map events',
            total: files.length,
            step: function (i) {
                var f = files[i];
                var raw;
                try { raw = fs.readFileSync(f.file, 'utf8'); } catch (e) {
                    state.notes.push('map ' + f.id + ': could not be read (' + e.message + ')');
                    return;
                }
                var map;
                try { map = JSON.parse(raw); } catch (e) {
                    state.notes.push('map ' + f.id + ': not valid JSON (' + e.message + ')');
                    return;
                }
                var evs = [];
                (map.events || []).forEach(function (ev) {
                    if (!ev) return;
                    var refs = { v: [], s: [], ss: [] };
                    (ev.pages || []).forEach(function (pg) {
                        if (!pg) return;
                        scanRefs(pg.list, refs);
                        var cond = pg.conditions || {};
                        if (cond.switch1Valid && refs.s.indexOf(cond.switch1Id) < 0) refs.s.push(cond.switch1Id);
                        if (cond.switch2Valid && refs.s.indexOf(cond.switch2Id) < 0) refs.s.push(cond.switch2Id);
                        if (cond.variableValid && refs.v.indexOf(cond.variableId) < 0) refs.v.push(cond.variableId);
                        if (cond.selfSwitchValid && refs.ss.indexOf(cond.selfSwitchCh) < 0) refs.ss.push(cond.selfSwitchCh);
                    });
                    evs.push({
                        id: ev.id, name: String(ev.name || ''), x: ev.x, y: ev.y,
                        pages: (ev.pages || []).length, refs: refs
                    });
                    totalEvents++;
                });
                out.events[f.id] = evs;
                var enc = (map.encounterList || []).length;
                out.encounters[f.id] = enc;
                if (enc) encounterMaps++;
                out.stats.events = totalEvents;
                out.stats.encounterMaps = encounterMaps;
                out.stats.mapsScanned = i + 1;
            }
        };
    }

    /* --- assets ----------------------------------------------------------
       MV and MZ ship no asset manifest, so a directory listing is the only
       way. That means no filesystem, no asset index — and the honest thing
       is to say which precondition failed.
       ------------------------------------------------------------------ */
    var ASSET_DIRS = [
        'img/characters', 'img/faces', 'img/pictures', 'img/battlebacks1', 'img/battlebacks2',
        'img/enemies', 'img/sv_actors', 'img/sv_enemies', 'img/tilesets', 'img/titles1', 'img/system',
        'audio/bgm', 'audio/bgs', 'audio/me', 'audio/se'
    ];

    function stageAssets(out) {
        if (!$.caps.fs || !$.paths.gameRoot) {
            out.assets = null;
            state.notes.push('asset index: unavailable — ' + ($.caps.fsWhy || 'no game root resolved') +
                '. The Identity panel\'s "rescan image folders" button is the fallback where it applies.');
            return { name: 'assets (skipped)', total: 0, step: function () { } };
        }
        var path = $.env.path, fs = $.env.fs;
        var base = $.paths.gameRoot;
        // A www/ deploy keeps assets under www/.
        try {
            if (!fs.existsSync(path.join(base, 'img')) && fs.existsSync(path.join(base, 'www', 'img'))) {
                base = path.join(base, 'www');
            }
        } catch (e) { /* keep base */ }
        out.assets = {};
        return {
            name: 'assets',
            total: ASSET_DIRS.length,
            step: function (i) {
                var rel = ASSET_DIRS[i];
                var dir = path.join(base, rel.split('/').join(path.sep));
                try {
                    if (!fs.existsSync(dir)) { out.assets[rel] = []; return; }
                    out.assets[rel] = fs.readdirSync(dir)
                        .filter(function (n) { return n.charAt(0) !== '.'; })
                        // Encrypted deploys rename to .rpgmvp/.png_/.ogg_ — keep
                        // the real stem so a name search still finds them.
                        .map(function (n) { return n.replace(/\.(png_|ogg_|m4a_|rpgmvp|rpgmvo|rpgmvm|png|ogg|m4a)$/i, ''); });
                } catch (e) {
                    out.assets[rel] = [];
                    state.notes.push('asset folder ' + rel + ': ' + e.message);
                }
            }
        };
    }

    function stagePlugins(out) {
        return {
            name: 'plugins',
            total: 1,
            step: function () {
                out.plugins = $.safe(function () {
                    if (typeof $plugins === 'undefined' || !$plugins) return [];
                    return $plugins.map(function (p, i) {
                        return {
                            order: i,
                            name: String((p && p.name) || ''),
                            base: String((p && p.name) || '').split('/').pop(),
                            on: !!(p && p.status)
                        };
                    });
                }, 'plugin index', []);
            }
        };
    }

    /* =====================================================================
       4. Build / load / save
       ===================================================================== */
    function ready() {
        return typeof $dataSystem !== 'undefined' && !!$dataSystem &&
               typeof $dataItems !== 'undefined' && !!$dataItems &&
               typeof $dataMapInfos !== 'undefined' && !!$dataMapInfos;
    }

    X.status = function () {
        return {
            phase: state.phase, progress: state.progress, stage: state.stage,
            built: state.built, fromCache: state.fromCache,
            timings: $.clone(state.timings), notes: state.notes.slice(),
            error: state.error,
            counts: data ? {
                database: DB_KINDS.reduce(function (a, k) { return a + ((data.db[k[0]] || []).length); }, 0),
                vars: (data.vars || []).length,
                switches: (data.switches || []).length,
                maps: (data.maps || []).length,
                events: (data.stats && data.stats.events) || 0,
                assets: data.assets ? Object.keys(data.assets).reduce(function (a, k) { return a + data.assets[k].length; }, 0) : null
            } : null
        };
    };

    X.data = function () { return data; };

    X.build = function (opts) {
        opts = opts || {};
        if (!ready()) {
            state.phase = 'idle';
            state.notes.push('build deferred: the database is not loaded yet.');
            return false;
        }
        if (state.phase === 'building' && !opts.force) return false;

        var fp = fingerprint();

        if (!opts.force && $.store) {
            var cached = $.safe(function () { return $.store.read(FILE, null); }, 'index cache read', null);
            if (cached && sameFingerprint(cached.fp, fp)) {
                data = cached;
                state.phase = 'ready';
                state.fromCache = true;
                state.built = cached.builtAt || null;
                state.progress = 1;
                state.timings = cached.timings || {};
                $.log('ok', 'index: loaded from cache (' + ((data.maps || []).length) + ' maps, ' +
                    ((data.stats && data.stats.events) || 0) + ' events)');
                $.emit('index:ready', X.status());
                return true;
            }
            if (cached) {
                state.notes.push('cached index was stale — ' + describeDrift(cached.fp, fp) + '. Rebuilding.');
                $.log('info', 'index: cache is stale (' + describeDrift(cached.fp, fp) + '), rebuilding');
            }
        }

        var out = blank();
        out.fp = fp;
        state.phase = 'building';
        state.progress = 0;
        state.timings = {};
        state.notes = [];
        state.error = null;
        state.fromCache = false;
        var t0 = Date.now();

        var stages = [
            stageDatabase(out),
            stageVarsSwitches(out),
            stageMaps(out),
            stagePlugins(out),
            stageAssets(out),
            stageEvents(out)          // last: the expensive one, so everything
        ];                            // else is usable before it finishes

        runStages(stages, function () {
            out.builtAt = Date.now();
            out.timings = $.clone(state.timings);
            data = out;
            state.phase = 'ready';
            state.built = out.builtAt;
            var ms = Date.now() - t0;
            $.log('ok', 'index: built in ' + ms + 'ms — ' +
                ((out.maps || []).length) + ' maps, ' +
                ((out.stats && out.stats.events) || 0) + ' events, ' +
                (out.assets ? Object.keys(out.assets).reduce(function (a, k) { return a + out.assets[k].length; }, 0) : 0) + ' assets');
            Object.keys(state.timings).forEach(function (k) {
                $.log('info', '  ' + k + ': ' + state.timings[k] + 'ms');
            });
            state.notes.forEach(function (n) { $.log('warn', 'index: ' + n); });
            $.safe(function () { if ($.store) $.store.write(FILE, out); }, 'index cache write');
            $.emit('index:ready', X.status());
        });
        return true;
    };

    function describeDrift(a, b) {
        if (!a) return 'no fingerprint';
        var diff = [];
        ['format', 'mod', 'engine', 'title', 'items', 'maps', 'vars', 'system', 'plugins'].forEach(function (k) {
            if (a[k] !== b[k]) {
                diff.push(k === 'plugins' ? 'the plugin list changed' : k + ' ' + JSON.stringify(a[k]) + ' → ' + JSON.stringify(b[k]));
            }
        });
        return diff.length ? diff.join(', ') : 'unknown difference';
    }

    X.rebuild = function () {
        $.log('info', 'index: rebuild requested');
        running = null;
        return X.build({ force: true });
    };

    X.clear = function () {
        data = null;
        state.phase = 'idle';
        state.built = null;
        $.safe(function () { if ($.store) $.store.remove(FILE); }, 'index cache delete');
        $.log('info', 'index: cleared');
    };

    /* =====================================================================
       5. Queries — every one returns CANDIDATES ONLY
       The caller resolves each candidate against the live database and game
       objects before showing or changing anything.
       ===================================================================== */
    function noIndex(what) {
        return {
            candidates: [],
            complete: false,
            why: state.phase === 'building'
                ? 'the index is still building (' + Math.round(state.progress * 100) + '% — ' + state.stage + ').'
                : 'the ' + what + ' index is not available here: ' +
                  (state.notes.length ? state.notes.join(' ') : 'it has not been built yet.')
        };
    }

    /** Search database names. kind is one of DB_KINDS, or 'all'. */
    X.findByName = function (kind, query, limit) {
        if (!data) return noIndex('database');
        var q = String(query || '').toLowerCase().trim();
        var kinds = kind === 'all' ? DB_KINDS.map(function (k) { return k[0]; }) : [kind];
        var out = [];
        limit = limit || 200;
        for (var ki = 0; ki < kinds.length && out.length < limit; ki++) {
            var rows = data.db[kinds[ki]] || [];
            for (var i = 0; i < rows.length && out.length < limit; i++) {
                var r = rows[i];
                if (!r) continue;
                if (!q || r.lc.indexOf(q) > -1) out.push({ kind: kinds[ki], id: r.id, name: r.name, icon: r.icon });
            }
        }
        return { candidates: out, complete: true, why: '' };
    };

    /** Every event that references a given switch / variable / self-switch. */
    X.findEventsTouching = function (type, id) {
        if (!data || !data.events) return noIndex('cross-map event');
        var key = type === 'switch' ? 's' : type === 'variable' ? 'v' : 'ss';
        var out = [];
        Object.keys(data.events).forEach(function (mapId) {
            data.events[mapId].forEach(function (ev) {
                if (ev.refs[key].indexOf(id) > -1) {
                    var m = data.maps[parseInt(mapId, 10)];
                    out.push({
                        mapId: parseInt(mapId, 10),
                        mapName: m ? m.name : ('Map ' + mapId),
                        eventId: ev.id, eventName: ev.name, x: ev.x, y: ev.y
                    });
                }
            });
        });
        return { candidates: out, complete: true, why: '' };
    };

    X.findVar = function (query, limit) {
        if (!data) return noIndex('variable');
        var q = String(query || '').toLowerCase().trim();
        var out = [];
        for (var i = 0; i < data.vars.length && out.length < (limit || 300); i++) {
            var v = data.vars[i];
            if (!v || v.header) continue;
            if (!q || v.lc.indexOf(q) > -1 || String(v.id) === q) out.push(v);
        }
        return { candidates: out, complete: true, why: '' };
    };

    X.findSwitch = function (query, limit) {
        if (!data) return noIndex('switch');
        var q = String(query || '').toLowerCase().trim();
        var out = [];
        for (var i = 0; i < data.switches.length && out.length < (limit || 300); i++) {
            var v = data.switches[i];
            if (!v || v.header) continue;
            if (!q || v.lc.indexOf(q) > -1 || String(v.id) === q) out.push(v);
        }
        return { candidates: out, complete: true, why: '' };
    };

    X.findMap = function (query, limit) {
        if (!data) return noIndex('map');
        var q = String(query || '').toLowerCase().trim();
        var out = [];
        for (var i = 0; i < data.maps.length && out.length < (limit || 300); i++) {
            var m = data.maps[i];
            if (!m) continue;
            if (!q || m.lc.indexOf(q) > -1 || String(m.id) === q) out.push(m);
        }
        return { candidates: out, complete: true, why: '' };
    };

    X.findAsset = function (query, limit) {
        if (!data || !data.assets) return noIndex('asset');
        var q = String(query || '').toLowerCase().trim();
        var out = [];
        Object.keys(data.assets).forEach(function (folder) {
            data.assets[folder].forEach(function (name) {
                if (out.length >= (limit || 300)) return;
                if (!q || name.toLowerCase().indexOf(q) > -1) out.push({ folder: folder, name: name });
            });
        });
        return { candidates: out, complete: true, why: '' };
    };

    X.sections = function (which) {
        if (!data) return [];
        return (data.sections && data.sections[which]) || [];
    };

    /* =====================================================================
       6. Instrumentation
       What each stage cost, so the decision to index something is a
       measurement and not a hunch. Shown in Debug → Index.
       ===================================================================== */
    X.timings = function () {
        var t = state.timings, out = [];
        Object.keys(t).forEach(function (k) { out.push({ stage: k, ms: t[k] }); });
        out.sort(function (a, b) { return b.ms - a.ms; });
        return out;
    };

    /* Measure the cost of NOT having an index, for comparison. Used by the
       Debug panel to justify (or retire) each stage. */
    X.benchmark = function () {
        var out = [];
        var t;

        t = Date.now();
        $.safe(function () {
            var hits = 0, q = 'a';
            for (var i = 0; i < ($dataItems || []).length; i++) {
                if ($dataItems[i] && String($dataItems[i].name).toLowerCase().indexOf(q) > -1) hits++;
            }
            out.push({ what: 'linear scan of $dataItems', ms: Date.now() - t, detail: hits + ' hits' });
        }, 'benchmark items');

        t = Date.now();
        var r = X.findByName('items', 'a');
        out.push({ what: 'indexed search of items', ms: Date.now() - t, detail: r.candidates.length + ' candidates' });

        if (data && data.events) {
            t = Date.now();
            var e = X.findEventsTouching('switch', 1);
            out.push({ what: 'indexed "events touching switch 1"', ms: Date.now() - t, detail: e.candidates.length + ' hits' });
            out.push({
                what: 'the same question without an index',
                ms: state.timings['cross-map events'] || 0,
                detail: 'would require re-reading every map file: ' +
                        ((state.timings['cross-map events'] || 0)) + 'ms of disk reads'
            });
        }
        return out;
    };

})(window.GigaHack);
