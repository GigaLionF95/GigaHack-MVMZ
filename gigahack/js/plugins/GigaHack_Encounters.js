//=============================================================================
// GigaHack MV/MZ
// 20 · encounters.js — random encounter control
//-----------------------------------------------------------------------------
// SHIPS ENABLED, and registers its sub-tab only when the game it is running in
// actually has random encounters somewhere.
//
// The distinction matters because a random encounter needs a non-empty
// encounterList on the map you are standing on: with an empty one,
// makeEncounterTroopId finds a weight sum of zero and returns 0, $dataTroops[0]
// is null, and executeEncounter bails. A game whose fights are all started by
// events therefore cannot produce one at all, and controls for disabling,
// rescaling or forcing something the engine will never do are not a harmless
// extra — they are switches that quietly do nothing, which is exactly what a
// mod menu must never ship.
//
// So it is a MEASUREMENT, not a setting. The boot index reads every
// data/MapNNN.json once and records each map's encounterList length alongside
// its events; this module asks it whether any map in the game has one. Where
// there is no index — a browser build, an encrypted deploy, no filesystem —
// the question cannot be answered for the whole game, so it degrades to the
// only map the engine will tell us about (the loaded one), re-checks on every
// map load, and says which of the two answers the panel is showing.
//
// The hooks and the model install either way: the module's marker has to
// appear in the boot report whatever the probe decides, and the console API
// stays reachable on a game where the panel is not offered.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — random encounter control
 * @author gigahack
 * @help GigaHack_Encounters.js — requires Core, Caps, Store, UI, Shell, Hooks,
 * Tabs, Player; uses Index for the whole-game probe.
 *
 * The Encounters sub-tab appears when this game has a random encounter table
 * on at least one map. Debug → Index shows what the probe read and why, when
 * it could not read all of it.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.playerPanel) {
        console.error('[GigaHack] player module missing — encounters not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;
    var P = $.player;

    var E = $.encounters = {};

    function cfg(key, dflt) { return $.store.cfgGet('player.' + key, dflt); }
    function set(key, v) { return $.store.cfgSet('player.' + key, v); }
    function alive() { return P.alive(); }
    function onMap() { return P.onMap(); }

    function setSync(key, v) { set(key, v); syncActive(); }

    function syncActive() {
        U.setActive('no encounters', !!cfg('noEncounters', false));
        U.setActive('encounter rate', !!cfg('rateOverride', false) && !cfg('noEncounters', false));
        U.setActive('forced troop', !!(Math.floor(cfg('troopId', 0)) || 0));
    }
    E.syncActive = syncActive;

    /**
     * Does the map the player is standing on actually have an encounter table?
     *
     * Per-map, because that is the granularity the engine works at — a game
     * can have encounters on the overworld and none indoors. The panel says
     * which it is rather than offering controls that cannot fire.
     */
    E.mapHasEncounters = function () {
        // "No map is loaded yet" is not an error, and logging it as one on
        // every call before the title screen has finished buries the errors
        // that do matter. Answer false quietly; only a genuine throw from a
        // loaded map is worth a line in the log.
        if (typeof $gameMap === 'undefined' || !$gameMap) return false;
        if (typeof $gameMap.encounterList !== 'function') return false;
        if (typeof $dataMap === 'undefined' || !$dataMap) return false;
        return $.safe(function () {
            var list = $gameMap.encounterList();
            return !!(list && list.length);
        }, 'encounterList', false);
    };

    /* =====================================================================
       THE PROBE — "does this game have random encounters at all?"

       The engine cannot answer it: it loads exactly one map at a time and
       keeps no record of the others. The boot index can, because it already
       reads every data/MapNNN.json for the cross-map event scan and now
       records each map's encounterList length in the same pass — one integer
       per file, on a read that was happening anyway.

       Three answers, and they are deliberately different:
         found:true   at least one map in the game has an encounter table.
         found:false  the whole database was read and none of them has one.
                      Only the index can say this, and only after it has
                      finished — a partial scan is not a negative answer.
         found:null   nobody could read the map files, so the question is
                      unanswerable here. Degrade to the loaded map and say so.
       ===================================================================== */
    var probe = { found: null, scope: 'none', why: '', maps: 0, scanned: 0 };
    E.probe = function () { return $.clone(probe); };

    function probeIndex() {
        if (!$.index || typeof $.index.data !== 'function') {
            return { found: null, scope: 'none', maps: 0, scanned: 0,
                why: 'the index module is not installed, so only the loaded map can be checked.' };
        }
        var status = $.safe(function () { return $.index.status(); }, 'index status', null);
        var data = $.safe(function () { return $.index.data(); }, 'index data', null);
        var enc = data ? data.encounters : undefined;
        if (!data || enc === undefined || enc === null) {
            var why = 'the map files could not be read here, so only the loaded map can be checked.';
            if (status && status.phase === 'building') {
                why = 'the index is still building (' + Math.round((status.progress || 0) * 100) + '%) — ' +
                      'showing what the loaded map says until it finishes.';
            } else if (status && status.notes && status.notes.length) {
                why = status.notes.join(' ');
            } else if (!$.caps.fs) {
                why = $.caps.fsWhy + ' Only the loaded map can be checked.';
            }
            return { found: null, scope: 'none', maps: 0, scanned: 0, why: why };
        }
        var maps = 0, scanned = 0;
        $.safe(function () {
            Object.keys(enc).forEach(function (k) { scanned++; if (enc[k] > 0) maps++; });
        }, 'count encounter maps');
        return {
            found: maps > 0, scope: 'index', maps: maps, scanned: scanned,
            why: maps > 0 ? '' : 'the index read ' + scanned + ' map file(s) and none of them has a random ' +
                                 'encounter table, so nothing here could ever start one.'
        };
    }

    /** What the panel says about where its answer came from. */
    E.describeProbe = function () {
        if (probe.scope === 'index') {
            return probe.found
                ? 'the index found random encounters on ' + probe.maps + ' of ' + probe.scanned + ' map(s).'
                : probe.why;
        }
        return 'whole-game answer unavailable — ' + probe.why;
    };

    /* Registration is separated from the probe so it can happen later: the
       index finishes after boot, and on a build with no filesystem the first
       map load is the earliest anything can be known. U.panel replaces by
       name, so registering twice is not a duplicate. */
    var registered = false;
    function registerPanel(reason) {
        if (registered) return false;
        registered = true;
        U.playerPanel('Encounters', buildEncounters);
        registerHotkeys();
        $.log('ok', 'encounters: sub-tab registered — ' + reason);
        if (U.isOpen && U.isOpen()) $.safe(function () { U.rerender(); }, 'encounters rerender');
        return true;
    }

    function reprobe(from) {
        var r = probeIndex();
        probe.found = r.found; probe.scope = r.scope;
        probe.why = r.why; probe.maps = r.maps; probe.scanned = r.scanned;
        if (r.found) return registerPanel('the index found ' + r.maps + ' map(s) with an encounter table');
        if (r.found === false) return false;      // read everything, there are none
        // Unanswerable for the whole game: the loaded map is all we have.
        if (E.mapHasEncounters()) {
            probe.scope = 'map';
            return registerPanel('this map has an encounter table (' + from + '; ' + r.why + ')');
        }
        return false;
    }
    E.reprobe = function () { return reprobe('rechecked'); };

    /**
     * "Off" has to mean off.
     *
     * canEncounter is only consulted by updateEncounterCount, so it stops the
     * counter running down — it does nothing about a counter that is ALREADY
     * at zero. Arm an encounter, switch encounters off, take a step, and the
     * fight starts anyway. executeEncounter is the gate that actually decides.
     */
    $.install('Game_Player.executeEncounter',
        typeof Game_Player !== 'undefined' ? Game_Player.prototype : null, 'executeEncounter',
        function (original) {
            return function () {
                if (cfg('noEncounters', false)) return false;
                return original.apply(this, arguments);
            };
        });

    $.install('Game_Player.canEncounter',
        typeof Game_Player !== 'undefined' ? Game_Player.prototype : null, 'canEncounter',
        function (original) {
            return function () {
                if (cfg('noEncounters', false)) return false;
                return original.apply(this, arguments);
            };
        });

    /**
     * Encounter rate as a percentage of normal. The engine subtracts
     * encounterProgressValue() from _encounterCount on every step, so scaling
     * it scales how fast the counter runs down. 0% never reaches an encounter,
     * but "no random encounters" above is the honest way to turn them off —
     * this is for making them rarer or relentless.
     */
    $.install('Game_Player.encounterProgressValue',
        typeof Game_Player !== 'undefined' ? Game_Player.prototype : null, 'encounterProgressValue',
        function (original) {
            return function () {
                var v = original.apply(this, arguments);
                if (!cfg('rateOverride', false)) return v;
                return v * (Number(cfg('rate', 100)) / 100);
            };
        });

    /** Force a specific troop instead of rolling the map's encounter table. */
    $.install('Game_Player.makeEncounterTroopId',
        typeof Game_Player !== 'undefined' ? Game_Player.prototype : null, 'makeEncounterTroopId',
        function (original) {
            return function () {
                var forced = Math.floor(cfg('troopId', 0)) || 0;
                // executeEncounter re-rolls the step counter BEFORE it looks
                // the troop up, and bails when $dataTroops[id] is null — so an
                // id that does not exist does not "force a fight", it silently
                // stops every random encounter in the game, permanently and
                // across relaunches, with nothing in the log.
                if (forced > 0 && $.safe(function () { return !!$dataTroops[forced]; }, 'troop', false)) {
                    return forced;
                }
                return original.apply(this, arguments);
            };
        });

    E.stepsToEncounter = function () {
        return $.safe(function () { return Math.max(0, Math.ceil($gamePlayer._encounterCount)); }, 'encounterCount', 0);
    };

    /**
     * The next step starts a fight. executeEncounter runs from the player's
     * non-moving update and needs the counter at or below zero — and it also
     * refuses while an event is running, which is the engine's own guard and
     * worth keeping rather than forcing a battle out of a cutscene.
     */
    E.forceEncounter = function () {
        if (!alive()) return false;
        if (!$.allowWrite('Forcing an encounter')) return false;
        if ($.safe(function () { return $gameMap.isEventRunning(); }, 'isEventRunning', false)) {
            U.toast({ title: 'NOT NOW', msg: 'an event is running — the engine will not start an encounter', severity: 'warn' });
            return false;
        }
        if (cfg('noEncounters', false)) {
            U.toast({ title: 'ENCOUNTERS ARE OFF', msg: 'turn random encounters back on first', severity: 'warn' });
            return false;
        }
        // 1, not 0. Scene_Map.updateEncounter calls executeEncounter every
        // frame the map is active and it needs no step at all — so zeroing the
        // counter starts the fight on the very next frame, with the overlay
        // still open and painted over Scene_Battle. One step's worth of
        // counter left means the label is true: it fires when you move.
        $.safe(function () { $gamePlayer._encounterCount = 1; }, 'forceEncounter');
        $.log('ok', 'encounter armed — it fires on the next step');
        U.toast({ title: 'ARMED', msg: 'the next step starts a fight', severity: 'ok', ms: 1800 });
        return true;
    };

    E.resetEncounterCount = function () {
        if (!alive()) return false;
        if (!$.allowWrite('Re-rolling the encounter counter')) return false;
        $.safe(function () { $gamePlayer.makeEncounterCount(); }, 'makeEncounterCount');
        return true;
    };

    E.troops = function () {
        return $.safe(function () {
            return $dataTroops.filter(function (t) { return t && t.name; });
        }, 'troops', []) || [];
    };

    /** The hotkey currently bound to an id, for showing beside its control. */
    function bind(id) {
        var code = $.cfg.hotkeys[id];
        return code ? U.prettyCode(code) : null;
    }

    /** Same shape as the Movement panel's; kept local so this file stands alone. */
    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: label }),
            h('div', { class: 'mm-edge mm-mono mm-sub', text: String(value) }));
    }

    function buildEncounters() {
        if (!onMap()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'no map loaded' }),
                    h('div', { text: 'start or load a game, then reopen this tab' })));
        }

        var stepsRow = kv('Steps to the next', E.stepsToEncounter());
        var host = U.getHost();
        if (host) {
            /* On the mod's own per-frame tick rather than the 700ms clock,
               because this counter moves with the game and not with the wall:
               under a game-speed multiplier — this mod's or a fast-forward
               plugin's — it can run down several times faster than real time,
               and a readout on a wall clock would then be showing a number
               that was true most of a second ago. Throttled, because the DOM
               write is the expensive part and nobody can read 60 updates a
               second. fastHooks is cleared on every tab rebuild and only runs
               while the overlay is open, so it does not stack up or cost
               anything when nothing is looking at it. */
            var lastSteps = -1;
            host.fastHooks.push(function (n) {
                if (n % 4) return;
                $.safe(function () {
                    if (!stepsRow.parentNode) return;
                    var v = E.stepsToEncounter();
                    if (v === lastSteps) return;
                    lastSteps = v;
                    stepsRow.lastChild.textContent = String(v);
                }, 'encounter tick');
            });
        }

        var troopId = Math.floor(cfg('troopId', 0)) || 0;
        var troopName = $.safe(function () {
            return troopId && $dataTroops[troopId] ? $dataTroops[troopId].name : '—';
        }, 'troop name', '—');

        var has = E.mapHasEncounters();

        var left = [
            has ? null : W.group('Nothing to control here', [
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'This map has an empty encounter table, so nothing below can start a fight on it.'),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    E.describeProbe())
            ], { tag: probe.scope === 'index' ? 'whole game' : 'this map only' }),

            W.group('Random encounters', [
                W.toggleRow('Turn them off', {
                    value: !!cfg('noEncounters', false), keybind: false, _ungated: true,
                    sub: bind('noEncounters'),
                    tip: 'No encounters|Game_Player.canEncounter returns false, which is the same lever the ' +
                        '"Change Encounter" event command pulls.',
                    onChange: function (v) { setSync('noEncounters', v); U.rerender(); }
                }),
                h('div', { class: 'mm-sep' }),
                W.toggleRow('Override the rate', {
                    value: !!cfg('rateOverride', false), keybind: false, _ungated: true,
                    disabled: !!cfg('noEncounters', false),
                    onChange: function (v) { setSync('rateOverride', v); U.rerender(); }
                }),
                W.row('Rate', W.slider({
                    value: Number(cfg('rate', 100)) || 100, min: 0, max: 400, step: 5, unit: '%', width: '116px',
                    _ungated: true, disabled: !cfg('rateOverride', false) || !!cfg('noEncounters', false),
                    onChange: function (v) { set('rate', v); }
                }), {
                    tip: 'Rate|Scales how fast the step counter runs down. 200% is twice as often; 0% never ' +
                        'arrives, though the toggle above is the honest way to say that.'
                }),
                h('div', { class: 'mm-sep' }),
                stepsRow,
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'force one' + (bind('forceEncounter') ? '  (' + bind('forceEncounter') + ')' : ''),
                        wide: true, variant: 'prime', mutates: true,
                        onClick: function () { E.forceEncounter(); U.rerender(); }
                    }),
                    W.button({
                        label: 're-roll the count', wide: true, mutates: true,
                        onClick: function () { E.resetEncounterCount(); U.rerender(); }
                    }))
            ], { tag: cfg('noEncounters', false) ? 'off' : 'on' }),

            W.group('Force a troop', [
                W.row('Troop id', W.number({
                    value: troopId, min: 0, max: 9999, wide: true, _ungated: true,
                    tip: 'Troop|0 leaves the map\'s own encounter table alone. Anything else replaces every ' +
                        'random encounter on every map with that troop.',
                    onChange: function (v) { setSync('troopId', v); U.rerender(); }
                })),
                kv('Which is', troopName),
                troopId && troopName !== '—' ? h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: 'Every random encounter, everywhere, is now this troop.'
                }) : null,
                troopId && troopName === '—' ? h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-danger);white-space:normal;padding:2px',
                    text: 'No troop ' + troopId + ' in this game — the map\'s own table is being used instead.'
                }) : null
            ], { tag: troopId ? '#' + troopId : 'off' })
        ];

        var list = $.safe(function () { return $gameMap.encounterList() || []; }, 'encounterList', []) || [];
        var rows = list.length ? list.map(function (e) {
            var name = $.safe(function () {
                return ($dataTroops[e.troopId] && $dataTroops[e.troopId].name) || ('troop ' + e.troopId);
            }, 'troop', 'troop ' + e.troopId);
            return h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: name }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: 'weight ' + e.weight }));
        }) : [h('div', { class: 'mm-empty', text: 'this map has no random encounters' })];

        var right = [
            W.group('This map', [
                kv('Map', $.safe(function () {
                    return ($.map ? $.map.mapName($gameMap.mapId()) : '') + ' · ' + $gameMap.mapId();
                }, 'map', '—')),
                kv('Encounter step', $.safe(function () { return $gameMap.encounterStep(); }, 'step', '—'),
                    'Encounter step|The engine rolls two random numbers up to this and adds one, so the real ' +
                    'gap between fights averages about this many steps.'),
                kv('Encounters enabled', $.safe(function () { return $gameSystem.isEncounterEnabled(); }, 'enabled', '?')),
                kv('Party blocks them', $.safe(function () { return $gameParty.hasEncounterNone(); }, 'none', '?')),
                kv('Elsewhere',
                    probe.scope === 'index'
                        ? probe.maps + ' / ' + probe.scanned + ' map(s)'
                        : 'not known here',
                    'Elsewhere|' + E.describeProbe())
            ], { tag: 'live' }),
            W.group('Troops here', rows, { tag: list.length + ' entries', grow: true })
        ];

        return cols(left, right);
    }


    /* ------------------------------------------------------------ hotkeys
       Registered with the panel and by the same test, not at load: a key that
       arms an encounter on a game that cannot have one is the same broken
       promise as a panel of controls that cannot fire, and it is worse for
       being invisible until it is pressed. registerHotkeys is idempotent —
       U.addHotkey replaces by id. */
    function registerHotkeys() {
        U.addHotkey({
            id: 'noEncounters', label: 'Random encounters', help: 'Toggle random encounters off and on',
            // The setting is stored as "no encounters", so the words have to be
            // flipped or pressing the key to switch them off says "on".
            run: function () {
                var off = !cfg('noEncounters', false);
                setSync('noEncounters', off);
                $.log(off ? 'ok' : 'info', 'Random encounters: ' + (off ? 'off' : 'on'));
                U.toast({ title: 'RANDOM ENCOUNTERS', msg: off ? 'off' : 'on', severity: off ? 'ok' : 'info', ms: 1400 });
                if (U.isOpen && U.isOpen()) U.rerender();
            }
        });
        U.addHotkey({
            id: 'forceEncounter', label: 'Force an encounter', help: 'The next step starts a fight',
            when: onMap, run: function () { E.forceEncounter(); }
        });
    }

    /* ----------------------------------------------------- the probe, run
       Three chances, because the answer becomes knowable at three different
       moments and the earliest one is not guaranteed to be any of them:

         · now — a cached index from a previous launch is already loaded;
         · index:ready — the first build finishes a second or two into play;
         · every map load — the fallback where there is no index at all, and
           the only point at which a new encounterList can come into view.

       The map hook is left installed after a successful registration rather
       than being removed: it is one boolean test on a function that runs once
       per transfer, and $.install's alias is the supported way to be there.
       ------------------------------------------------------------------ */
    reprobe('at boot');

    $.on('index:ready', function () { $.safe(function () { reprobe('the index finished'); }, 'encounter reprobe'); });

    $.install('Game_Map.setup (encounter probe)',
        typeof Game_Map !== 'undefined' ? Game_Map.prototype : null, 'setup',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                if (!registered) $.safe(function () { reprobe('on entering a map'); }, 'encounter map probe');
                return r;
            };
        }, 'Game_Map.prototype.setup is absent — without an index the encounter probe cannot ' +
           're-check when you enter a new map, so the sub-tab may stay hidden on a game that has encounters');

    $.api.encounters = function (v) {
        if (v == null) return !cfg('noEncounters', false);
        set('noEncounters', v === false); return !cfg('noEncounters');
    };
    $.api.encounterProbe = function () { return E.probe(); };

    syncActive();

    $.log(registered ? 'ok' : 'info', 'encounters ready — ' +
        (registered
            ? (probe.scope === 'index'
                ? 'encounters on ' + probe.maps + ' of ' + probe.scanned + ' map(s)'
                : 'this map has an encounter table')
            : 'sub-tab not registered: ' + (probe.found === false ? probe.why : E.describeProbe())));

})(window.GigaHack);
