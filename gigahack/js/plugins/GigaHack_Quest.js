//=============================================================================
// GigaHack MV/MZ
// 27 · quest.js — why an event is locked, common events, reconstructed
//                 objectives, the script dump
//-----------------------------------------------------------------------------
// Four panels that answer four questions the engine will not answer, and every
// one of them is defensive about the same thing: the engine records LESS than
// the player assumes it does.
//
// 1. WHY IS THIS EVENT LOCKED.  Game_Event.meetsConditions returns one boolean
//    and records nothing about which of the six stored fields failed. The only
//    way to say which is to evaluate the six again — and that means our answer
//    can DISAGREE with the engine's. That disagreement is not a bug to hide:
//    it is the single best available signal that something outside the six
//    stored fields is deciding pages (a note-tag condition, a replaced
//    meetsConditions). So the panel reports both answers and names the
//    disagreement, and never insists it is right.
//
//    Two more traps live here. The engine takes the HIGHEST-numbered page
//    whose conditions are met, so "every condition on this page is met" and
//    "this page runs" are different statements — a fully met page can be
//    permanently shadowed by a later one, and a report that only lists unmet
//    conditions gives the wrong answer for it. And an ERASED event has no page
//    at all, which is a different state from "no page qualifies" and produces
//    the same -1 by a different route.
//
// 2. WHAT ARE THE COMMON EVENTS.  Only a PARALLEL common event is instantiated
//    by the map; an autorun one runs on the map's own interpreter and appears
//    in no live list. So "is it running" and "is its gate switch on" are two
//    facts from two sources, and the panel labels which is which rather than
//    merging them. Running one is irreversible in exactly the way force-running
//    an event page is, and takes the same gate, the same backup and the same
//    confirmation.
//
// 3. WHAT ARE THE QUESTS.  Nothing in either engine records a quest. This
//    panel is INFERENCE over the project's own switch and variable NAMES, it
//    says so before it says anything else, and every group carries the
//    sentence saying what it was inferred from. Where nothing groups, no panel
//    is registered and the log names the panels that do the same job without
//    the guess. The grouping rule is derived from the project's own names —
//    never an English word list, which matched nothing on a non-English
//    project once already — and it requires two shared leading tokens plus an
//    ordinal tail, because a one-token stem groups a thousand flat sw_N names
//    into one meaningless quest.
//
// 4. WHAT DOES THE GAME SAY.  Every line the project can show the player, with
//    the SCOPE of the answer attached to each source. The cross-map half is a
//    second walk of the same files the boot index read, because the index
//    records which switches and variables an event touches and not what it
//    says. That is stated in the panel, and here, so whoever later adds a text
//    stage to the index knows exactly what to replace.
//
// The invariant behind all four: the boot index answers for MAP events only.
// Common events, troop pages and the loaded map are in NO index stage and are
// always available, so every "who sets this" and "who calls this" here is a
// JOIN of a live scan and an index lookup, and each half states what it could
// see. An empty list with no reason reads as "nothing does", which is the one
// wrong answer these panels must never give.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — why an event is locked, common events, reconstructed objectives, the script dump
 * @author gigahack
 * @help GigaHack_Quest.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs and Vars. Uses Events for the command decoder and the map
 * overlay, Index for the cross-map candidate list, Map for teleport, Text for
 * escape-code stripping, Forge for "this row was forged" and Backup for the
 * guard before a common event is run. Every one of those is optional and
 * degrades with a stated reason.
 */

(function ($) {
    'use strict';

    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — quest not installed');
        return;
    }
    // Vars is a HARD dependency: every fix control here writes through it, and
    // all four panels are reachable from the console API where nothing wraps
    // them. Everything else warn-degrades rather than refusing to install.
    if (!$.vars) {
        console.error('[GigaHack] vars module missing — quest not installed');
        if ($.log) $.log('warn', 'quest skipped — every fix control writes through the Vars module');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;
    var V = $.vars;

    var Q = $.quest = {};

    /* =====================================================================
       SETTINGS

       Read with a local helper that supplies the default when the key is
       absent, so this module owns no entry in the shared defaults table and a
       settings file written before it existed still produces working panels.
       ===================================================================== */
    function qraw(path) {
        return $.safe(function () {
            return $.store ? $.store.cfgGet(path, undefined) : undefined;
        }, 'quest setting ' + path, undefined);
    }
    function qbool(path, dflt) { var v = qraw(path); return typeof v === 'boolean' ? v : dflt; }
    function qstr(path, dflt) { var v = qraw(path); return typeof v === 'string' ? v : dflt; }
    function qnum(path, dflt, lo, hi) {
        var v = qraw(path);
        if (typeof v !== 'number' || v !== v) return dflt;
        return v < lo ? lo : v > hi ? hi : v;
    }
    function qset(path, value) {
        return $.safe(function () { return $.store.cfgSet(path, value); }, 'save ' + path);
    }

    /* =====================================================================
       DEGRADED CONTROLS

       A control whose writes do not stick is MARKED, never hidden and never
       made inert: the cause may have gone away — a plugin's own state changed,
       a cap raised — and the only way to find out is to let the user try.
       ===================================================================== */
    function degraded(control) {
        return !!($.compat && $.compat.isDegraded && $.compat.isDegraded(control));
    }
    function degradedWhy(control) {
        return ($.compat && $.compat.degradedWhy && $.compat.degradedWhy(control)) || '';
    }
    function degradeNote(control) {
        if (!degraded(control)) return null;
        return h('div', { class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px' },
            h('b', { text: 'writes here are not sticking. ' }),
            degradedWhy(control) + ' ',
            W.button({
                label: 'try again', mini: true, _ungated: true,
                tip: 'Try again|Re-tests on the next write; nothing is rewritten now.',
                onClick: function () {
                    if ($.compat && $.compat.clearDegraded) $.compat.clearDegraded(control);
                    U.rerender();
                }
            }));
    }
    function degradeMark(el, control) {
        if (!el || !degraded(control)) return el;
        el.style.opacity = '0.55';
        el.setAttribute('data-mm-tip', 'Not sticking|' + degradedWhy(control));
        return el;
    }

    /* --------------------------------------------------------------- names */
    function swName(id) {
        return $.safe(function () { return $dataSystem.switches[id] || ''; }, 'switch name', '') || '';
    }
    function varName(id) {
        return $.safe(function () { return $dataSystem.variables[id] || ''; }, 'variable name', '') || '';
    }
    function mapName(id) {
        return $.safe(function () {
            var info = (typeof $dataMapInfos !== 'undefined' && $dataMapInfos) ? $dataMapInfos[id] : null;
            return info ? String(info.name || '') : '';
        }, 'map name', '') || '';
    }
    function describe(c) {
        if ($.events && $.events.describe) {
            return $.safe(function () { return $.events.describe(c); }, 'describe command', '') || '';
        }
        return 'code ' + c.code;
    }
    /** Why the decoder is not the event inspector's, when it is not. */
    function decoderWhy() {
        return ($.events && $.events.describe)
            ? ''
            : 'the Events module did not load, so commands are shown as raw codes';
    }

    function dbLoaded() {
        return typeof $dataSystem !== 'undefined' && !!$dataSystem &&
            !!$dataSystem.switches && !!$dataSystem.variables;
    }
    function mapLoaded() {
        return typeof $gameMap !== 'undefined' && !!$gameMap &&
            typeof $dataMap !== 'undefined' && !!$dataMap && !!$dataMap.events;
    }
    function hereMapId() {
        return $.safe(function () { return $gameMap ? $gameMap.mapId() : 0; }, 'map id', 0) || 0;
    }

    /* =====================================================================
       PART 1 — THE SIX STORED PAGE CONDITIONS

       The Events module's E.conditions() returns pre-rendered STRINGS: enough
       to print, useless to act on. This is the same six fields as structured
       data with the live value beside the needed one, which is what a fix
       button and a source lookup both need.

       Each field is evaluated exactly as the engine evaluates it, and the
       exactnesses are the point:
         · variableValid is `>=`, not `>`. A fix that writes value+1 overshoots
           and value-1 never satisfies it; write exactly c.variableValue.
         · selfSwitchValid compares the ACCESSOR's answer against `true`, and
           the key uses the EVENT's own _mapId. An event a plugin spawned from
           another map's data carries a different _mapId, and a key built from
           $gameMap.mapId() then addresses an entirely different self-switch.
         · itemValid asks hasItem(item) with includeEquip false, so an item
           worn in an equip slot does NOT satisfy it. That is the case a player
           hits and blames on the menu, so the row says which it is.
         · actorValid tests $gameParty.members(), which some frameworks
           redefine to mean the battle members while a battle is running. It is
           read live, never cached across a scene change.
       ===================================================================== */

    function evMapId(ev) {
        // The event's OWN stored map id, with the current map as the fallback
        // for a build whose constructor never set one.
        var m = ev && ev._mapId;
        return (typeof m === 'number' && m > 0) ? m : hereMapId();
    }

    function selfSwitchRaw(key) {
        return $.safe(function () { return $gameSelfSwitches._data[key]; }, 'self-switch raw', undefined);
    }

    /**
     * The six fields of one page, decoded.
     * Never throws; returns [] when anything on the way is missing.
     */
    Q.conditions = function (ev, pageIndex) {
        return $.safe(function () {
            var d = ev.event();
            var page = d && d.pages && d.pages[pageIndex];
            if (!page) return [];
            var c = page.conditions || {};
            var out = [];

            function sw(kind, id) {
                var now = $gameSwitches.value(id);
                var name = swName(id);
                out.push({
                    kind: kind, id: id,
                    label: 'Switch ' + id + (name ? ' "' + name + '"' : ''),
                    needText: 'needs ON', nowText: 'now ' + (now ? 'ON' : 'OFF'),
                    need: true, now: now, met: !!now, why: '',
                    fixable: 'switch', fixId: id, fixValue: true, control: 'switches.set'
                });
            }
            if (c.switch1Valid) sw('switch1', c.switch1Id);
            if (c.switch2Valid) sw('switch2', c.switch2Id);

            if (c.variableValid) {
                var vNow = $gameVariables.value(c.variableId);
                var vName = varName(c.variableId);
                out.push({
                    kind: 'variable', id: c.variableId,
                    label: 'Variable ' + c.variableId + (vName ? ' "' + vName + '"' : ''),
                    // The engine's test is >=, so "equal to" already satisfies
                    // it. Writing the needed value exactly is both sufficient
                    // and the smallest change that works.
                    needText: 'needs ' + c.variableValue + ' or more',
                    nowText: 'now ' + vNow,
                    need: c.variableValue, now: vNow, met: vNow >= c.variableValue, why: '',
                    fixable: 'variable', fixId: c.variableId, fixValue: c.variableValue, control: 'vars.set'
                });
            }

            if (c.selfSwitchValid) {
                var mid = evMapId(ev);
                var key = [mid, ev.eventId(), c.selfSwitchCh];
                var raw = selfSwitchRaw(key);
                var read = $.safe(function () { return $gameSelfSwitches.value(key); }, 'self-switch value', false);
                out.push({
                    kind: 'selfswitch', id: c.selfSwitchCh,
                    label: 'Self-switch ' + c.selfSwitchCh + ' on map ' + mid + ', event ' + ev.eventId(),
                    needText: 'needs ON',
                    nowText: 'now ' + (read ? 'ON' : 'OFF') +
                        (raw !== undefined && raw !== true ? ' (stored as ' + JSON.stringify(raw) + ')' : ''),
                    need: true, now: read,
                    // The engine's own clause is `!== true` against the
                    // accessor. Asked through the accessor on a stock build
                    // that is the same as falsy; on a build whose accessor was
                    // replaced it is not, and this follows the engine.
                    met: read === true,
                    why: mid !== hereMapId()
                        ? 'this event carries map id ' + mid + ', not the map you are on — the key is built from its own.'
                        : '',
                    fixable: 'selfswitch', fixId: c.selfSwitchCh, fixValue: true, control: null,
                    mapId: mid, eventId: ev.eventId()
                });
            }

            if (c.itemValid) {
                var item = $.safe(function () { return $dataItems[c.itemId]; }, 'condition item', null);
                var held = $.safe(function () { return $gameParty.hasItem(item); }, 'hasItem', false);
                var wornOnly = false;
                if (!held && item && typeof $gameParty.isAnyMemberEquipped === 'function') {
                    wornOnly = !!$.safe(function () { return $gameParty.isAnyMemberEquipped(item); },
                        'isAnyMemberEquipped', false);
                }
                out.push({
                    kind: 'item', id: c.itemId,
                    label: 'Item ' + c.itemId + (item && item.name ? ' "' + item.name + '"' : ''),
                    needText: 'needs one in the bag',
                    nowText: held ? 'held' : (wornOnly ? 'equipped, not held' : 'not held'),
                    need: true, now: held, met: !!held,
                    why: wornOnly
                        ? 'the engine asks for it in the bag, so one worn in an equip slot does not count.'
                        : '',
                    fixable: null, fixId: c.itemId, fixValue: null, control: null
                });
            }

            if (c.actorValid) {
                var actor = $.safe(function () { return $gameActors.actor(c.actorId); }, 'condition actor', null);
                // members() is read live and never cached: some frameworks
                // redefine it to mean the battle members while a battle is
                // running, and a cached answer then survives the scene change.
                var inParty = !!$.safe(function () {
                    var m = $gameParty.members();
                    return actor && m && m.indexOf(actor) > -1;
                }, 'party members', false);
                // A live actor exposes name() as a method; the database row of
                // the same name is a plain string. Probe rather than assume.
                var aName = $.safe(function () {
                    if (!actor) return '';
                    return typeof actor.name === 'function' ? actor.name() : String(actor.name || '');
                }, 'actor name', '') || '';
                out.push({
                    kind: 'actor', id: c.actorId,
                    label: 'Actor ' + c.actorId + (aName ? ' "' + aName + '"' : ''),
                    needText: 'needs to be in the party',
                    nowText: inParty ? 'in the party' : 'not in the party',
                    need: true, now: inParty, met: inParty, why: '',
                    fixable: null, fixId: c.actorId, fixValue: null, control: null
                });
            }

            return out;
        }, 'page conditions', []) || [];
    };

    /** Do the six stored fields of one already-decoded page all pass. */
    function allMet(rows) {
        for (var i = 0; i < rows.length; i++) if (!rows[i].met) return false;
        return true;
    }

    /**
     * Which page runs, which page COULD run, and whether the engine agrees.
     *
     * `agrees` is the note-tag detector. When our answer and ev._pageIndex
     * differ, something outside the six stored fields is deciding pages, and
     * that is a finding to report rather than an error to correct.
     */
    Q.pageStates = function (ev) {
        return $.safe(function () {
            var d = ev.event();
            var pages = (d && d.pages) || [];
            var erased = !!ev._erased;
            var ours = -1;
            var met = [], decoded = [];
            // Decoded ONCE per page: every condition read touches live game
            // state, and this runs from a repaint.
            for (var i = pages.length - 1; i >= 0; i--) {
                decoded[i] = Q.conditions(ev, i);
                met[i] = allMet(decoded[i]);
                // The engine walks BACKWARDS and takes the first match, which
                // is the highest-numbered qualifying page.
                if (ours < 0 && met[i]) ours = i;
            }
            var engine = (typeof ev._pageIndex === 'number') ? ev._pageIndex : -1;
            var ourActive = erased ? -1 : ours;

            var list = [];
            for (var p = 0; p < pages.length; p++) {
                var total = decoded[p].length;
                var unmet = 0;
                decoded[p].forEach(function (c) { if (!c.met) unmet++; });
                var state;
                if (erased) state = 'erased';
                else if (p === ourActive) state = 'active';
                else if (met[p]) state = 'shadowed';
                else state = 'blocked';
                list.push({
                    index: p, state: state,
                    shadowedBy: state === 'shadowed' ? ourActive : null,
                    unmet: unmet, total: total, conditions: decoded[p]
                });
            }
            return {
                active: engine, engineActive: engine, ourActive: ourActive,
                agrees: engine === ourActive, erased: erased, pages: list
            };
        }, 'page states', { active: -1, engineActive: -1, ourActive: -1, agrees: true, erased: false, pages: [] });
    };

    /** One line saying what state a page is in, in words. */
    function pageStateLine(st, p) {
        if (p.state === 'erased') return 'erased — no page runs on this event at all';
        if (p.state === 'active') return 'active — this is the page the engine is running';
        if (p.state === 'shadowed') {
            return 'met, but page ' + (p.shadowedBy + 1) +
                ' is also met and the engine takes the highest-numbered one';
        }
        return 'blocked by ' + p.unmet + ' of ' + p.total + ' condition' + (p.total === 1 ? '' : 's');
    }

    /* =====================================================================
       PART 2 — WHO SETS THIS

       $.index.findEventsTouching answers for MAP events only: the boot index
       never walked $dataCommonEvents and never walked $dataTroops. A "who sets
       this" built on the index alone silently misses every common event in the
       game, which reads as "nothing sets it". So this is a JOIN — a live scan
       of the three sources that are always available, plus the index for the
       maps that are not loaded — and `scopes` says what each half could see.
       ===================================================================== */

    function touchesSwitch(c, id) {
        var p = c.parameters || [];
        if (c.code === 121) return { sets: p[0] <= id && id <= p[1], reads: false };
        if (c.code === 111 && p[0] === 0) return { sets: false, reads: p[1] === id };
        return null;
    }
    function touchesVariable(c, id) {
        var p = c.parameters || [];
        if (c.code === 122) {
            var sets = p[0] <= id && id <= p[1];
            var reads = (p[3] === 1 && p[4] === id);
            if (sets || reads) return { sets: sets, reads: reads };
            return null;
        }
        if (c.code === 111 && p[0] === 1) {
            return { sets: false, reads: p[1] === id || (p[2] === 1 && p[3] === id) };
        }
        if (c.code === 201 && p[0] === 1) {
            return { sets: false, reads: p[1] === id || p[2] === id || p[3] === id };
        }
        return null;
    }
    function touchesSelf(c, letter) {
        var p = c.parameters || [];
        if (c.code === 123) return { sets: p[0] === letter, reads: false };
        if (c.code === 111 && p[0] === 2) return { sets: false, reads: p[1] === letter };
        return null;
    }
    function toucher(kind) {
        if (kind === 'switch') return touchesSwitch;
        if (kind === 'variable') return touchesVariable;
        return touchesSelf;
    }

    /** Does a page's CONDITION block reference this thing (a read, never a set). */
    function conditionReads(page, kind, key) {
        var c = (page && page.conditions) || {};
        if (kind === 'switch') {
            return (c.switch1Valid && c.switch1Id === key) || (c.switch2Valid && c.switch2Id === key);
        }
        if (kind === 'variable') return !!(c.variableValid && c.variableId === key);
        return !!(c.selfSwitchValid && c.selfSwitchCh === key);
    }

    function scanList(list, kind, key, hit) {
        if (!list) return;
        var test = toucher(kind);
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c) continue;
            var r = $.safe(function () { return test(c, key); }, 'scan command', null);
            if (r && (r.sets || r.reads)) hit(i, r);
        }
    }

    /**
     * Everything that touches one switch, variable or self-switch letter.
     *
     * kind: 'switch' | 'variable' | 'selfswitch'; key: an id, or an A–D letter.
     */
    Q.sourcesOf = function (kind, key) {
        var out = [];
        var scopes = [];
        var here = hereMapId();

        /* 1. the loaded map — live, and therefore authoritative */
        var mapOk = $.safe(function () {
            if (!mapLoaded()) return false;
            ($dataMap.events || []).forEach(function (d) {
                if (!d) return;
                (d.pages || []).forEach(function (pg, pi) {
                    var live = $.safe(function () { return $gameMap.event(d.id); }, 'live event', null);
                    function push(ci, r) {
                        out.push({
                            scope: 'map', mapId: here, mapName: mapName(here) || ('map ' + here),
                            eventId: d.id, eventName: String(d.name || ''),
                            x: live ? live.x : d.x, y: live ? live.y : d.y,
                            pageIndex: pi, commandIndex: ci, sets: r.sets, reads: r.reads,
                            here: true, moved: !!(live && (live.x !== d.x || live.y !== d.y)),
                            gone: !live, stale: false
                        });
                    }
                    if (conditionReads(pg, kind, key)) push(-1, { sets: false, reads: true });
                    scanList(pg.list, kind, key, push);
                });
            });
            return true;
        }, 'source scan: loaded map', false);
        scopes.push({
            key: 'map', label: 'loaded map', complete: !!mapOk,
            why: mapOk ? '' : 'no map is loaded, so the map you are standing on could not be read'
        });

        /* 2. common events — in NO index stage, and always readable */
        var ceOk = $.safe(function () {
            if (typeof $dataCommonEvents === 'undefined' || !$dataCommonEvents) return false;
            $dataCommonEvents.forEach(function (ce) {
                if (!ce) return;
                scanList(ce.list, kind, key, function (ci, r) {
                    out.push({
                        scope: 'common', mapId: 0, mapName: '', commonId: ce.id,
                        eventId: 0, eventName: String(ce.name || ''),
                        x: 0, y: 0, pageIndex: 0, commandIndex: ci,
                        sets: r.sets, reads: r.reads, here: false, moved: false, gone: false, stale: false
                    });
                });
            });
            return true;
        }, 'source scan: common events', false);
        scopes.push({
            key: 'common', label: 'common events', complete: !!ceOk,
            why: ceOk ? '' : 'the common event list is not loaded'
        });

        /* 3. troop pages — also in no index stage, and a battle page sets
              switches like any other event list does */
        var troopOk = $.safe(function () {
            if (typeof $dataTroops === 'undefined' || !$dataTroops) return false;
            $dataTroops.forEach(function (t) {
                if (!t) return;
                (t.pages || []).forEach(function (pg, pi) {
                    scanList(pg.list, kind, key, function (ci, r) {
                        out.push({
                            scope: 'troop', mapId: 0, mapName: '', troopId: t.id,
                            eventId: 0, eventName: String(t.name || ''),
                            x: 0, y: 0, pageIndex: pi, commandIndex: ci,
                            sets: r.sets, reads: r.reads, here: false, moved: false, gone: false, stale: false
                        });
                    });
                });
            });
            return true;
        }, 'source scan: troop pages', false);
        scopes.push({
            key: 'troop', label: 'troop pages', complete: !!troopOk,
            why: troopOk ? '' : 'the troop list is not loaded'
        });

        /* 4. every other map — candidates only, from the boot index */
        var cross = { candidates: [], complete: false, why: 'the Events module did not load, so no other map was searched.' };
        if ($.events && $.events.findTouching) {
            var type = kind === 'selfswitch' ? 'self-switch' : kind;
            cross = $.safe(function () { return $.events.findTouching(type, key); },
                'cross-map source scan', cross) || cross;
        }
        (cross.candidates || []).forEach(function (r) {
            // The loaded map was just read live and is the authority for it;
            // an index row for the same map would be a second, weaker copy.
            if (r.mapId === here) return;
            out.push({
                scope: 'map', mapId: r.mapId, mapName: r.mapName || ('map ' + r.mapId),
                eventId: r.eventId, eventName: r.eventName || '',
                x: r.x, y: r.y, pageIndex: -1, commandIndex: -1,
                sets: true, reads: true, here: false,
                moved: !!r.moved, gone: !!r.gone, stale: !!r.stale
            });
        });
        scopes.push({
            key: 'other', label: 'other maps', complete: !!cross.complete,
            why: cross.why || ''
        });

        var incomplete = scopes.filter(function (s) { return !s.complete; });
        return {
            candidates: out,
            complete: incomplete.length === 0,
            why: incomplete.length
                ? incomplete.map(function (s) { return s.label + ': ' + (s.why || 'not searched'); }).join(' · ')
                : '',
            scopes: scopes
        };
    };

    /** The one line under every source table, stating the scope of the answer. */
    function sourceScopeLine(res) {
        return res.scopes.map(function (s) {
            return s.label + ': ' + (s.complete ? 'live' : (s.why || 'not searched'));
        }).join(' · ');
    }

    /* =====================================================================
       PART 3 — COMMON EVENTS

       The Forge can run a common event it MADE, and can copy one of the game's
       into its editor; there was no way to look at, gate or run one the game
       shipped.

       Two engine facts are decided here once, so no other module has to know
       them:
         · Which common events have actually FIRED this session. No amount of
           reading $dataCommonEvents supplies it — it comes from the command117
           hook below, and only EXPLICIT calls pass through there. An autorun or
           parallel common event never does, so the panel says "not counted"
           rather than reporting 0.
         · The reservation shape. One build holds a single reserved id and a
           second reserve overwrites the first with no error; another holds a
           queue and appends. Probed from WHICH ACCESSOR the build has, never
           from which engine it is.
       ===================================================================== */

    var ranCount = {};      // common event id -> times command117 called it

    var CE_HOOK = 'Game_Interpreter.command117 (quest)';
    $.install(CE_HOOK,
        typeof Game_Interpreter !== 'undefined' ? Game_Interpreter.prototype : null, 'command117',
        function (original) {
            return function () {
                /* One build passes the parameters as the first ARGUMENT; the
                   other reads this._params. A wrapper written for one shape
                   counts nothing at all on the other, and counting nothing
                   looks exactly like a common event that never runs — so both
                   shapes are read and neither is assumed. */
                var args = arguments;
                $.safe(function () {
                    var id = (args[0] && args[0][0] != null) ? args[0][0]
                        : (this && this._params ? this._params[0] : null);
                    if (id > 0) ranCount[id] = (ranCount[id] || 0) + 1;
                }.bind(this), 'count common event call');
                // The original's return value is what the engine reads as
                // "continue", so it is passed through untouched.
                return original.apply(this, arguments);
            };
        },
        'Game_Interpreter.command117 not found — the Common panel states what the data says ' +
        'and does not claim a run count');

    function runCountAvailable() {
        return !!($.hooks[CE_HOOK] && $.hooks[CE_HOOK].installed);
    }
    /* Two different absences, and they take two different sentences: the
       target was never there, or the alias was removed at runtime. Reporting
       the first for the second sends the reader looking for a missing engine
       method that is sitting right there. */
    function runCountWhy() {
        var rec = $.hooks[CE_HOOK];
        if (!rec) return 'the call counter was never registered';
        if (rec.reason) return rec.reason;
        return 'the alias was removed in Debug → Hooks, so calls are no longer counted';
    }

    /**
     * Does this build hold a QUEUE of reserved common events, or exactly one?
     * Probed from the accessors present, never from the engine name.
     */
    Q.reserveShape = function () {
        if (typeof $gameTemp === 'undefined' || !$gameTemp) {
            return { queue: null, why: 'there is no game world yet, so nothing can be reserved' };
        }
        if (typeof $gameTemp.retrieveCommonEvent === 'function') {
            return { queue: true, why: '' };
        }
        if (typeof $gameTemp.reservedCommonEvent === 'function') {
            return { queue: false, why: '' };
        }
        return {
            queue: null,
            why: 'this build has neither reservation accessor, so nothing here can run a common event'
        };
    };

    var TRIGGER_NAMES = ['called only', 'autorun', 'parallel'];

    function triggerName(t) { return TRIGGER_NAMES[t] || ('trigger ' + t); }

    /** The live Game_CommonEvent for an id, when the map built one. */
    function liveCommon(id) {
        return $.safe(function () {
            var list = $gameMap && $gameMap._commonEvents;
            if (!list) return null;
            for (var i = 0; i < list.length; i++) {
                if (list[i] && list[i]._commonEventId === id) return list[i];
            }
            return null;
        }, 'live common event', null);
    }

    function commandCount(ce) {
        var list = ce.list || [];
        var n = 0;
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].code !== 0) n++;
        return n;
    }
    function textLineCount(ce) {
        var list = ce.list || [];
        var n = 0;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && (list[i].code === 401 || list[i].code === 405)) n++;
        }
        return n;
    }

    Q.commons = function () {
        return $.safe(function () {
            if (typeof $dataCommonEvents === 'undefined' || !$dataCommonEvents) return [];
            var out = [];
            $dataCommonEvents.forEach(function (ce) {
                if (!ce) return;
                var sid = ce.switchId || 0;
                var gated = ce.trigger !== 0;
                var on = gated && sid > 0
                    ? !!$.safe(function () { return $gameSwitches.value(sid); }, 'gate switch', false)
                    : false;
                var live = liveCommon(ce.id);
                out.push({
                    id: ce.id, name: String(ce.name || ''),
                    trigger: ce.trigger, triggerName: triggerName(ce.trigger),
                    switchId: sid, switchName: sid ? swName(sid) : '',
                    switchOn: on, gated: gated,
                    // Only a PARALLEL common event is instantiated by the map.
                    // An autorun one runs on the map's own interpreter and
                    // appears in no live list, so "there is an object for it"
                    // is only a fact about parallels.
                    live: !!(live && live._interpreter),
                    hasObject: !!live,
                    ran: runCountAvailable() ? (ranCount[ce.id] || 0) : null,
                    commands: commandCount(ce),
                    textLines: textLineCount(ce),
                    forged: !!($.forge && $.forge.isCustom &&
                        $.safe(function () { return $.forge.isCustom('common', ce.id); }, 'forged?', false)),
                    why: Q.whyNotRunnable(ce.id)
                });
            });
            return out;
        }, 'common events', []) || [];
    };

    /**
     * One string that changes when anything live in Q.commons() has moved.
     *
     * The panel asks this on every tick and only re-runs Q.commons() — which
     * decodes a trigger name, counts commands and text lines and asks the
     * Forge about every row — when the answer differs. Three live things go in
     * it: the gate switch, whether a parallel one has an interpreter right
     * now, and the explicit-call counter. The database fields are left out
     * BECAUSE they cannot change: a signal that includes what never moves
     * costs the same on every tick and buys nothing.
     */
    Q.commonsStamp = function () {
        return $.safe(function () {
            if (typeof $dataCommonEvents === 'undefined' || !$dataCommonEvents) return 'none';
            /* The live list is walked ONCE and indexed, rather than searched
               per row through liveCommon: a project with two hundred common
               events and twenty parallels would otherwise cost four thousand
               comparisons on every tick, to answer a question whose whole
               purpose is to be cheaper than the repaint it guards. */
            var alive = {};
            var list = $gameMap && $gameMap._commonEvents;
            if (list) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i]) alive[list[i]._commonEventId] = list[i]._interpreter ? 2 : 1;
                }
            }
            var out = [], counted = runCountAvailable();
            $dataCommonEvents.forEach(function (ce) {
                if (!ce) return;
                var sid = ce.switchId || 0;
                var on = ce.trigger !== 0 && sid > 0 &&
                    !!$.safe(function () { return $gameSwitches.value(sid); }, 'gate switch', false);
                out.push(ce.id + ':' + (on ? 1 : 0) + ':' + (alive[ce.id] || 0) +
                    ':' + (counted ? (ranCount[ce.id] || 0) : '-'));
            });
            return out.join('|');
        }, 'common event stamp', 'unreadable');
    };

    Q.decodeCommon = function (id) {
        return $.safe(function () {
            var ce = $dataCommonEvents[id];
            if (!ce || !ce.list) return [];
            var out = [];
            ce.list.forEach(function (c, i) {
                if (c.code === 0 && i > 0) return;
                out.push({ i: i, code: c.code, indent: c.indent || 0, text: describe(c), raw: c });
            });
            return out;
        }, 'decode common event', []) || [];
    };

    /**
     * Why this common event cannot be run from here, or null when it can.
     *
     * Checked before anything is spent: the backup below copies the whole save
     * directory synchronously, so it must not be paid for a call that then
     * refuses.
     */
    Q.whyNotRunnable = function (id) {
        if (typeof $dataCommonEvents === 'undefined' || !$dataCommonEvents) {
            return 'the common event list is not loaded';
        }
        var ce = $dataCommonEvents[id];
        if (!ce) return 'there is no common event with that id';
        var list = ce.list || [];
        if (list.length <= 1) return 'this common event has no commands';

        var shape = Q.reserveShape();
        if (shape.queue === null) return shape.why;

        var sid = ce.switchId || 0;
        var on = sid > 0 && !!$.safe(function () { return $gameSwitches.value(sid); }, 'gate switch', false);
        // Starting one the engine is already driving runs the same command
        // list on two interpreters at once, so every gold, item and variable
        // change in it applies twice.
        if (ce.trigger === 2 && on) {
            return 'this is Parallel and its gate switch is on — the engine is already running it every frame';
        }
        if (ce.trigger === 1 && on) {
            return 'this is Autorun and its gate switch is on — the map\'s own interpreter is already running it';
        }
        // A single-slot build overwrites the pending reservation with no error
        // at all, so a second run here would silently discard the first.
        if (!shape.queue && $.safe(function () { return $gameTemp.isCommonEventReserved(); }, 'reserved?', false)) {
            return 'this build holds one reserved common event at a time and one is already pending — ' +
                'reserving now would discard it';
        }
        return null;
    };

    Q.runCommon = function (id) {
        var why = Q.whyNotRunnable(id);
        if (why) {
            U.toast({ title: 'CANNOT RUN', msg: why, severity: 'warn' });
            $.log('warn', 'run common event ' + id + ' refused: ' + why);
            return false;
        }
        if (!$.allowWrite('Running a common event')) return false;

        var b = ($.backup && $.backup.guard)
            ? $.backup.guard('run common event')
            : { created: false, skipped: 'the Backup module did not load' };
        if (b.created && b.entry) {
            U.toast({ title: 'SAVE BACKED UP', msg: b.entry.name, severity: 'ok' });
        }

        // Reserved through the engine's own path, and read back: a reservation
        // the engine did not accept looks exactly like one it did.
        var accepted = $.safe(function () {
            $gameTemp.reserveCommonEvent(id);
            return !!$gameTemp.isCommonEventReserved();
        }, 'reserve common event', false);

        if (!accepted) {
            var msg = 'the engine did not accept the reservation — nothing is queued';
            U.toast({ title: 'CANNOT RUN', msg: msg, severity: 'warn' });
            $.log('warn', 'run common event ' + id + ': ' + msg);
            return false;
        }
        // Irreversible in exactly the way force-running an event page is: it
        // can set switches, transfer the player, or start a battle.
        $.log('warn', 'reserved common event ' + id + ' to run (irreversible — backup ' +
            (b.created && b.entry ? b.entry.name : b.skipped) + ')');
        return true;
    };

    /** Who calls a common event — a live scan, because the index never did one. */
    Q.callersOf = function (id) {
        var out = [];
        $.safe(function () {
            function walk(list, row) {
                if (!list) return;
                list.forEach(function (c, i) {
                    if (!c || c.code !== 117) return;
                    var p = c.parameters || [];
                    if (p[0] !== id) return;
                    out.push({
                        scope: row.scope, label: row.label, commandIndex: i,
                        mapId: row.mapId || 0, eventId: row.eventId || 0,
                        commonId: row.commonId || 0, troopId: row.troopId || 0,
                        x: row.x || 0, y: row.y || 0, eventName: row.eventName || ''
                    });
                });
            }
            if (typeof $dataCommonEvents !== 'undefined' && $dataCommonEvents) {
                $dataCommonEvents.forEach(function (ce) {
                    if (!ce) return;
                    walk(ce.list, {
                        scope: 'common', label: 'common ' + ce.id + ' "' + (ce.name || '') + '"',
                        commonId: ce.id, eventName: String(ce.name || '')
                    });
                });
            }
            if (typeof $dataTroops !== 'undefined' && $dataTroops) {
                $dataTroops.forEach(function (t) {
                    if (!t) return;
                    (t.pages || []).forEach(function (pg, pi) {
                        walk(pg.list, {
                            scope: 'troop', label: 'troop ' + t.id + ' page ' + (pi + 1),
                            troopId: t.id, eventName: String(t.name || '')
                        });
                    });
                });
            }
            if (mapLoaded()) {
                var here = hereMapId();
                ($dataMap.events || []).forEach(function (d) {
                    if (!d) return;
                    (d.pages || []).forEach(function (pg, pi) {
                        walk(pg.list, {
                            scope: 'map',
                            label: (mapName(here) || ('map ' + here)) + ' · ' + (d.name || ('event ' + d.id)) +
                                ' page ' + (pi + 1),
                            mapId: here, eventId: d.id, eventName: String(d.name || ''), x: d.x, y: d.y
                        });
                    });
                });
            }
        }, 'callers of common event');
        return out;
    };

    // The scope of that answer, stated whether or not anything was found.
    var CALLERS_SCOPE = 'Events on other maps are not covered: the boot index records the switches ' +
        'and variables an event touches, not the common events it calls.';

    /* =====================================================================
       PART 4 — INFERENCE

       Nothing in either engine records a quest. What a project WITH quests has
       instead is a run of switches, named by its author, that a menu reads.

       Two rules, both derived from the project's own names:

         STEM — a name whose last token is a number, and whose remaining tokens
         are shared with at least `minMembers` others. TWO shared leading
         tokens are required, and that requirement is the whole rule: a
         one-token stem groups sw_1 … sw_1100 into one meaningless quest of a
         thousand members. A project naming its flags q1 q2 q3 is then missed,
         which is the right side to fail on — this feature degrades to nothing
         rather than to a guess.

         SECTION — a run under a section header, using the convention
         $.profile detected for this game. The convention lives in exactly one
         place ($.profile.isSectionHeader / sectionTitle) and this module does
         not grow a fourth private copy of it.

       Where both are on, STEMS CLAIM THEIR IDS FIRST and a section group lists
       only what no chain already took. Otherwise a chain would appear twice —
       once as itself and once buried inside its section.
       ===================================================================== */

    /** Split a project's own name into lowercase tokens. */
    function tokens(name) {
        return String(name || '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camelCase is a boundary too
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(function (t) { return t.length > 0; });
    }
    /** The trailing ordinal, or null when the name does not end in one. */
    function ordinalTail(toks) {
        if (!toks.length) return null;
        var last = toks[toks.length - 1];
        return /^\d+$/.test(last) ? parseInt(last, 10) : null;
    }

    var memo = null;        // the inferred groups, until something invalidates them
    var lastWhy = '';

    Q.inferenceWhy = function () { return lastWhy; };

    function namedEntries() {
        var out = [];
        function take(kind, arr) {
            for (var id = 1; id < arr.length; id++) {
                var name = String(arr[id] || '').trim();
                if (!name) continue;
                if ($.profile && $.profile.isSectionHeader(name)) continue;
                out.push({ kind: kind, id: id, name: name, toks: tokens(name) });
            }
        }
        take('switch', $dataSystem.switches);
        take('variable', $dataSystem.variables);
        return out;
    }

    /**
     * The project's DEFAULT NAMING, derived from the project.
     *
     * A section rule with nothing else in it groups every run under every
     * header, and on a project that names its thousand spare flags sw_1 …
     * sw_1100 that is thirty-five "quests" of forty-five members each, with
     * the two real chains buried among them. The signal that separates them is
     * in the names and needs no word list: a leading token shared by a QUARTER
     * of everything the project named is not a name, it is the placeholder the
     * editor writes. Members named that way carry no information, so they are
     * not read as steps — and a section left with nothing else is not a group.
     *
     * On a project that genuinely names its flags, no token reaches the share
     * and nothing is excluded.
     */
    function bulkStems(entries, share) {
        var counts = {}, total = 0;
        entries.forEach(function (e) {
            if (!e.toks.length) return;
            total++;
            var t = e.toks[0];
            counts[t] = (counts[t] || 0) + 1;
        });
        var out = {};
        var found = [];
        Object.keys(counts).forEach(function (t) {
            if (total && counts[t] / total >= share) { out[t] = counts[t]; found.push(t); }
        });
        return { map: out, tokens: found, total: total };
    }

    /** How much of this project is named at all — the floor the inference needs. */
    function namedFraction() {
        return $.safe(function () {
            var total = 0, named = 0;
            [$dataSystem.switches, $dataSystem.variables].forEach(function (arr) {
                for (var i = 1; i < arr.length; i++) {
                    total++;
                    if (String(arr[i] || '').trim()) named++;
                }
            });
            return total ? named / total : 0;
        }, 'named fraction', 0);
    }

    function stepLabel(e) {
        return (e.kind === 'switch' ? 'Switch ' : 'Variable ') + e.id + ' "' + e.name + '"';
    }
    /* Is there a game to ask at all.

       The objectives are inferred from the DATABASE, which exists from the
       title screen onward, but whether a step is done is a question about the
       SAVE — and the game objects do not exist until a new game or a load has
       created them. Asking anyway is not merely wrong, it is loud: this runs
       once per step, and on a project with a thousand named switches that was
       1,383 identical "Cannot read properties of null" lines in the log at
       boot, which is a third of the ring and the boot report with it. Found on
       a real game; no harness had a title screen to catch it. */
    function gameStarted() {
        return typeof $gameSwitches !== 'undefined' && !!$gameSwitches &&
            typeof $gameVariables !== 'undefined' && !!$gameVariables;
    }
    Q.gameStarted = gameStarted;

    function stepDone(e) {
        if (!gameStarted()) return false;
        if (e.kind === 'switch') {
            return !!$.safe(function () { return $gameSwitches.value(e.id); }, 'step switch', false);
        }
        return !!$.safe(function () { return $gameVariables.value(e.id) !== 0; }, 'step variable', false);
    }

    function finishGroup(g) {
        g.steps.sort(function (a, b) {
            // Ordered by the number at the END of the name, not by id: a
            // project that inserted step 3 later gave it a higher id than
            // step 4, and id order then tells the story backwards.
            if (a.order !== b.order) return a.order - b.order;
            return a.id - b.id;
        });
        var done = 0, next = null;
        g.steps.forEach(function (s) {
            s.done = stepDone(s);
            if (s.done) done++;
            else if (!next) next = s;
        });
        g.done = done;
        g.total = g.steps.length;
        g.pct = g.total ? Math.round(done / g.total * 100) : 0;
        g.current = done;
        g.next = next;
        return g;
    }

    /**
     * Infer the quest groups.
     * opts: { groupBy: 'section'|'stem'|'both', minMembers, minStemTokens }
     */
    Q.infer = function (opts) {
        opts = opts || {};
        var groupBy = opts.groupBy || qstr('quest.quests.groupBy', 'both');
        var minMembers = opts.minMembers || qnum('quest.quests.minMembers', 3, 2, 10);
        var minStem = opts.minStemTokens || qnum('quest.quests.minStemTokens', 2, 1, 6);
        var minNamed = opts.minNamed || qnum('quest.quests.minNamed', 0.05, 0, 1);

        lastWhy = '';
        if (!dbLoaded()) {
            lastWhy = 'this project\'s switch and variable names could not be read, so no Quests panel ' +
                'is registered. ' + FALLBACK;
            return [];
        }

        var frac = namedFraction();
        if (frac < minNamed) {
            lastWhy = 'this project leaves ' + Math.round((1 - frac) * 100) + '% of its switch and ' +
                'variable names blank, which is below the ' + Math.round(minNamed * 100) +
                '% floor, so there is nothing to infer from. ' + FALLBACK;
            return [];
        }

        var entries = $.safe(namedEntries, 'named entries', []) || [];
        var groups = [];
        var claimed = {};       // 'kind:id' -> true, so a section cannot re-list a chain
        var bulk = bulkStems(entries, qnum('quest.quests.bulkShare', 0.25, 0, 1));
        Q.bulk = bulk;          // read by the panel, so it can say what it excluded

        /* ---- stems ---- */
        if (groupBy === 'stem' || groupBy === 'both') {
            var byStem = {};
            var counters = {};
            entries.forEach(function (e) {
                if (e.toks.length < minStem + 1) return;
                var ord = ordinalTail(e.toks);
                var stem = e.toks.slice(0, e.toks.length - 1).join(' ');
                if (ord === null) {
                    // Same stem, non-ordinal tail: a project writes its
                    // progress counter beside the chain it counts.
                    (counters[stem] = counters[stem] || []).push(e);
                    return;
                }
                e.order = ord;
                (byStem[stem] = byStem[stem] || []).push(e);
            });
            Object.keys(byStem).forEach(function (stem) {
                var members = byStem[stem];
                if (members.length < minMembers) return;
                members.forEach(function (e) { claimed[e.kind + ':' + e.id] = true; });
                var counter = (counters[stem] || [])[0] || null;
                if (counter) claimed[counter.kind + ':' + counter.id] = true;
                groups.push(finishGroup({
                    key: 'stem:' + stem, title: stem, from: 'stem',
                    evidence: 'inferred from ' + members.length + ' ' +
                        (members[0].kind === 'switch' ? 'switch' : 'variable') +
                        ' names sharing the stem "' + stem + '" and ending in a number' +
                        (counter ? ', with "' + counter.name + '" beside them as the counter' : ''),
                    kind: members[0].kind,
                    counter: counter ? { kind: counter.kind, id: counter.id, name: counter.name } : null,
                    steps: members.map(function (e) {
                        return {
                            id: e.id, kind: e.kind, name: e.name, label: stepLabel(e),
                            order: e.order, done: false
                        };
                    })
                }));
            });
        }

        /* ---- sections ---- */
        if (groupBy === 'section' || groupBy === 'both') {
            var pattern = $.safe(function () {
                return $.profile ? $.profile.get('sectionPattern', null) : null;
            }, 'section pattern', null);
            if (pattern) {
                [['switch', $dataSystem.switches], ['variable', $dataSystem.variables]].forEach(function (pair) {
                    var kind = pair[0], arr = pair[1];
                    var heads = [];
                    for (var i = 1; i < arr.length; i++) {
                        var nm = String(arr[i] || '').trim();
                        if (nm && $.profile.isSectionHeader(nm)) heads.push({ id: i, title: $.profile.sectionTitle(nm) });
                    }
                    heads.forEach(function (hd, hi) {
                        var to = (hi + 1 < heads.length ? heads[hi + 1].id : arr.length) - 1;
                        var steps = [], skippedBulk = 0;
                        for (var id = hd.id + 1; id <= to; id++) {
                            var nm2 = String(arr[id] || '').trim();
                            if (!nm2) continue;                            // a gap, not a member
                            if (claimed[kind + ':' + id]) continue;        // a chain already took it
                            var toks2 = tokens(nm2);
                            // Named by the project's own placeholder pattern,
                            // so the name says nothing and neither would a
                            // "step" built out of it.
                            if (toks2.length && bulk.map[toks2[0]]) { skippedBulk++; continue; }
                            var ord = ordinalTail(toks2);
                            steps.push({
                                id: id, kind: kind, name: nm2,
                                label: (kind === 'switch' ? 'Switch ' : 'Variable ') + id + ' "' + nm2 + '"',
                                order: ord === null ? id : ord, done: false
                            });
                        }
                        if (steps.length < minMembers) return;
                        var plural = kind === 'switch' ? 'switches' : 'variables';
                        groups.push(finishGroup({
                            key: 'section:' + kind + ':' + hd.id, title: hd.title || ('section ' + hd.id),
                            from: 'section',
                            evidence: 'inferred from a section header at ' + kind + ' ' + hd.id +
                                ' ("' + hd.title + '") and the ' + steps.length + ' named ' + plural +
                                ' under it that no chain already claimed' +
                                (skippedBulk ? ' (' + skippedBulk + ' more carry this project\'s ' +
                                    'placeholder naming and say nothing)' : ''),
                            kind: kind, counter: null, steps: steps
                        }));
                    });
                });
            }
        }

        if (!groups.length) {
            var noPattern = !$.safe(function () {
                return $.profile ? $.profile.get('sectionPattern', null) : null;
            }, 'section pattern', null);
            lastWhy = noPattern
                ? 'no run of this project\'s switch or variable names sits under a section header or ' +
                  'shares a two-token stem with an ordinal tail, so there is nothing to reconstruct. ' + FALLBACK
                : 'the only groups found have fewer than ' + minMembers + ' named members, so there is ' +
                  'nothing worth reconstructing. ' + FALLBACK;
            return [];
        }

        groups.sort(function (a, b) {
            if (a.from !== b.from) return a.from === 'stem' ? -1 : 1;
            return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
        });
        return groups;
    };

    // Named once: every refusal ends with the same sentence, because the two
    // panels it names do the same job without the inference.
    var FALLBACK = 'World → Switches lists every flag raw, and World → Find answers which event sets one.';

    Q.quests = function () {
        if (!memo) memo = Q.infer();
        return memo;
    };
    Q.reinfer = function () { memo = null; return Q.quests(); };

    /**
     * Re-read the live flags into the groups already inferred.
     *
     * NOT a re-inference: the grouping is read off the project's switch and
     * variable NAMES, which cannot change while the game runs, and re-running
     * it would reorder the panel under whoever is reading it. Only done, next
     * and each step's own flag are refreshed — the same fields finishGroup
     * computes at inference time, from the same function, so the live panel
     * and a freshly-built one cannot disagree.
     */
    Q.refreshQuests = function () {
        if (!memo) return Q.quests();
        for (var i = 0; i < memo.length; i++) finishGroup(memo[i]);
        return memo;
    };

    /**
     * One string that changes when any inferred step has moved.
     *
     * A variable step carries its VALUE, not whether it is done: a counter
     * going from 3 to 5 leaves "done" true the whole way, and keying on the
     * boolean would freeze the number the panel prints beside it while the
     * quest visibly advanced.
     */
    Q.questsStamp = function () {
        return $.safe(function () {
            if (!memo) return 'not inferred';
            var out = [];
            for (var i = 0; i < memo.length; i++) {
                var g = memo[i], part = [];
                for (var j = 0; j < g.steps.length; j++) {
                    var s = g.steps[j];
                    part.push(s.kind === 'switch' ? (stepDone(s) ? '1' : '0') : String(varValue(s.id)));
                }
                if (g.counter) part.push('c' + varValue(g.counter.id));
                out.push(part.join('.'));
            }
            return out.join('|');
        }, 'quest stamp', 'unreadable');
    };

    function varValue(id) {
        if (!gameStarted()) return 0;
        return $.safe(function () { return $gameVariables.value(id); }, 'variable value', 0);
    }

    $.on('gameobjects', function () { memo = null; });

    /* =====================================================================
       PART 5 — THE SCRIPT DUMP

       Every line the project can show the player, with the scope of the answer
       attached to each source.

       Two things it must never imply. First, only a text STATE is converted:
       the command parameters in $dataMap are RAW, so a \V[5] here is a
       reference the game resolves later and not what the player sees — the
       detail box says so whenever the stored string still carries an escape
       code. Second, the cross-map half is a SECOND read of the same files the
       boot index walked, because the index records which switches and
       variables an event touches and not what it says.
       ===================================================================== */

    var SCRIPT_KINDS = [
        { key: 'messages', label: 'messages', tip: '' },
        { key: 'choices', label: 'choices', tip: '' },
        { key: 'scrolling', label: 'scrolling', tip: '' },
        { key: 'descriptions', label: 'descriptions', tip: '' },
        { key: 'terms', label: 'terms', tip: '' },
        { key: 'comments', label: 'comments', tip: 'Comments|Codes 108 and 408 are never shown to the player.' }
    ];
    var SCOPES = ['everything', 'this map', 'common events', 'troop pages', 'database', 'other maps'];

    // kind of a produced row -> the chip that governs it
    var KIND_GROUP = {
        message: 'messages', speaker: 'messages',
        choice: 'choices', branch: 'choices',
        scroll: 'scrolling', comment: 'comments',
        description: 'descriptions', term: 'terms'
    };

    function stripOn() {
        return qbool('quest.script.strip', true) && !!($.text && $.text._plain);
    }
    function plainText(s) {
        var raw = String(s == null ? '' : s);
        if (!stripOn()) return raw;
        // $.text._plain strips ESC-prefixed codes as well as backslash ones.
        // Stripping only backslashes leaves invisible \x1b control characters
        // in the DOM and the line reads as "c[14]Name:" with nothing to
        // explain it.
        return $.safe(function () { return $.text._plain(raw); }, 'strip escape codes', raw);
    }
    var ESC_PRESENT = /\\[a-zA-Z.|!^$<>{}]|\x1b/;
    function hasEscape(s) { return ESC_PRESENT.test(String(s == null ? '' : s)); }

    function cap(s) {
        var max = qnum('quest.script.maxChars', 4000, 100, 100000);
        var t = String(s == null ? '' : s);
        return t.length > max ? t.slice(0, max) + '…' : t;
    }

    /**
     * Walk one command list and emit its text rows.
     * `base` carries the scope fields every row from this list shares.
     */
    function collectList(list, base, out) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c) continue;
            var p = c.parameters || [];
            // Reset every iteration. `var` is function-scoped, so a command
            // that produces no row would otherwise re-emit the PREVIOUS one —
            // every terminator and every branch end duplicating the line
            // before it, with the count and the list still agreeing.
            var row = null;
            if (c.code === 101) {
                // The speaker name exists only where the build writes a fifth
                // parameter. Emitting speaker:'' on a build that has none
                // presents an absent field as an empty one.
                if (p.length > 4 && p[4]) {
                    row = { kind: 'speaker', text: plainText(p[4]), raw: String(p[4]) };
                }
            } else if (c.code === 401) {
                row = { kind: 'message', text: plainText(p[0]), raw: String(p[0] == null ? '' : p[0]) };
            } else if (c.code === 102) {
                (p[0] || []).forEach(function (choice, ci) {
                    out.push(mkRow(base, {
                        kind: 'choice', text: plainText(choice), raw: String(choice),
                        i: i, sub: ci
                    }));
                });
            } else if (c.code === 402) {
                row = { kind: 'branch', text: plainText(p[1]), raw: String(p[1] == null ? '' : p[1]) };
            } else if (c.code === 403) {
                row = { kind: 'branch', text: '(Cancel)', raw: '(Cancel)' };
            } else if (c.code === 405) {
                row = {
                    kind: 'scroll', text: plainText(p[0]), raw: String(p[0] == null ? '' : p[0]),
                    // Scrolling text carries no converted copy anywhere: the
                    // engine converts it inside the draw and never stores it.
                    note: 'scrolling text is never stored converted'
                };
            } else if (c.code === 108 || c.code === 408) {
                row = { kind: 'comment', text: String(p[0] == null ? '' : p[0]), raw: String(p[0] == null ? '' : p[0]) };
            }
            if (row) { row.i = i; out.push(mkRow(base, row)); }
        }
    }

    function mkRow(base, r) {
        return {
            where: base.where, scope: base.scope,
            mapId: base.mapId || 0, mapName: base.mapName || '',
            eventId: base.eventId || 0, eventName: base.eventName || '',
            commonId: base.commonId || 0, troopId: base.troopId || 0,
            x: base.x || 0, y: base.y || 0, pageIndex: base.pageIndex == null ? -1 : base.pageIndex,
            gone: !!base.gone, stale: !!base.stale, here: !!base.here,
            kind: r.kind, text: cap(r.text), raw: cap(r.raw),
            note: r.note || '', i: r.i == null ? -1 : r.i, sub: r.sub == null ? -1 : r.sub
        };
    }

    function collectDatabase(out) {
        function pushDesc(arr, label, fields) {
            if (!arr) return;
            arr.forEach(function (o) {
                if (!o) return;
                fields.forEach(function (f) {
                    var s = o[f];
                    if (!s) return;
                    out.push(mkRow({ where: label + ' · ' + (o.name || ('#' + o.id)), scope: 'db' },
                        { kind: 'description', text: plainText(s), raw: String(s) }));
                });
            });
        }
        $.safe(function () {
            pushDesc(typeof $dataItems !== 'undefined' ? $dataItems : null, 'item', ['description']);
            pushDesc(typeof $dataWeapons !== 'undefined' ? $dataWeapons : null, 'weapon', ['description']);
            pushDesc(typeof $dataArmors !== 'undefined' ? $dataArmors : null, 'armor', ['description']);
            pushDesc(typeof $dataSkills !== 'undefined' ? $dataSkills : null, 'skill',
                ['description', 'message1', 'message2']);
            // A STATE has message1..message4 and NO description on either
            // engine; reading .description off one yields undefined and dumps
            // an empty row per state.
            pushDesc(typeof $dataStates !== 'undefined' ? $dataStates : null, 'state',
                ['message1', 'message2', 'message3', 'message4']);
            pushDesc(typeof $dataActors !== 'undefined' ? $dataActors : null, 'actor',
                ['nickname', 'profile']);
        }, 'database descriptions');
    }

    function collectTerms(out) {
        $.safe(function () {
            var t = $dataSystem && $dataSystem.terms;
            if (!t) return;
            function pushArr(arr, label) {
                if (!arr) return;
                arr.forEach(function (s, i) {
                    // The editor writes null where a command was removed, and
                    // one build ships holes in this array. Iterating it without
                    // a null guard prints "null" as a line of the game's script.
                    if (s == null || s === '') return;
                    out.push(mkRow({ where: 'terms · ' + label + ' ' + i, scope: 'db' },
                        { kind: 'term', text: String(s), raw: String(s) }));
                });
            }
            pushArr(t.basic, 'basic');
            pushArr(t.commands, 'command');
            pushArr(t.params, 'param');
            if (t.messages) {
                Object.keys(t.messages).forEach(function (k) {
                    var s = t.messages[k];
                    if (!s) return;
                    out.push(mkRow({ where: 'terms · ' + k, scope: 'db' },
                        { kind: 'term', text: String(s), raw: String(s) }));
                });
            }
        }, 'database terms');
    }

    /* --------- the local half: everything available without a filesystem --- */
    var localMemo = null;

    /**
     * Every line the loaded map, the common events, the troop pages and the
     * database can show.
     *
     * The memo is keyed on the TOTAL COLLECTED, never on a kept count: a memo
     * keyed on a capped list's length stops invalidating the moment the list
     * saturates, and the dialogue history was bitten by exactly that shape.
     */
    Q.script = {};

    Q.script.local = function () {
        var key = [
            hereMapId(),
            stripOn() ? 1 : 0,
            $.safe(function () { return $dataMap && $dataMap.events ? $dataMap.events.length : 0; }, 'k1', 0),
            $.safe(function () { return typeof $dataCommonEvents !== 'undefined' && $dataCommonEvents ? $dataCommonEvents.length : 0; }, 'k2', 0),
            $.safe(function () { return typeof $dataTroops !== 'undefined' && $dataTroops ? $dataTroops.length : 0; }, 'k3', 0),
            $.safe(function () { return typeof $dataItems !== 'undefined' && $dataItems ? $dataItems.length : 0; }, 'k4', 0)
        ].join('/');
        // The memo key is what the sources ARE, and `collected` is the total
        // this collector produced — never a kept count. A memo keyed on a
        // capped list's length stops invalidating the moment the list
        // saturates, which is the normal steady state and not the empty one
        // anyone tests. The cap lives in search(), which is not memoised.
        if (localMemo && localMemo.key === key) return localMemo;

        var t0 = Date.now();
        var rows = [];
        var scopes = [];

        var here = hereMapId();
        var mapOk = $.safe(function () {
            if (!mapLoaded()) return false;
            var nm = mapName(here) || ('map ' + here);
            ($dataMap.events || []).forEach(function (d) {
                if (!d) return;
                var live = $.safe(function () { return $gameMap.event(d.id); }, 'live event', null);
                (d.pages || []).forEach(function (pg, pi) {
                    collectList(pg.list, {
                        where: nm + ' · ' + (d.name || ('event ' + d.id)),
                        scope: 'map', mapId: here, mapName: nm,
                        eventId: d.id, eventName: String(d.name || ''),
                        x: live ? live.x : d.x, y: live ? live.y : d.y,
                        pageIndex: pi, here: true, gone: !live
                    }, rows);
                });
            });
            return true;
        }, 'script: loaded map', false);
        scopes.push({
            key: 'this map', label: 'loaded map', complete: !!mapOk,
            why: mapOk ? '' : 'no map is loaded'
        });

        var ceOk = $.safe(function () {
            if (typeof $dataCommonEvents === 'undefined' || !$dataCommonEvents) return false;
            $dataCommonEvents.forEach(function (ce) {
                if (!ce) return;
                collectList(ce.list, {
                    where: 'common ' + ce.id + ' · ' + (ce.name || ''),
                    scope: 'common', commonId: ce.id, eventName: String(ce.name || '')
                }, rows);
            });
            return true;
        }, 'script: common events', false);
        scopes.push({
            key: 'common events', label: 'common events', complete: !!ceOk,
            why: ceOk ? '' : 'the common event list is not loaded'
        });

        var trOk = $.safe(function () {
            if (typeof $dataTroops === 'undefined' || !$dataTroops) return false;
            $dataTroops.forEach(function (t) {
                if (!t) return;
                (t.pages || []).forEach(function (pg, pi) {
                    collectList(pg.list, {
                        where: 'troop ' + t.id + ' · ' + (t.name || '') + ' page ' + (pi + 1),
                        scope: 'troop', troopId: t.id, pageIndex: pi, eventName: String(t.name || '')
                    }, rows);
                });
            });
            return true;
        }, 'script: troop pages', false);
        scopes.push({
            key: 'troop pages', label: 'troop pages', complete: !!trOk,
            why: trOk ? '' : 'the troop list is not loaded'
        });

        var dbOk = $.safe(function () {
            collectDatabase(rows);
            return true;
        }, 'script: database', false);
        scopes.push({
            key: 'database', label: 'database rows', complete: !!dbOk,
            why: dbOk ? '' : 'the database is not loaded'
        });

        var tmOk = $.safe(function () {
            collectTerms(rows);
            return true;
        }, 'script: terms', false);
        scopes.push({
            key: 'terms', label: 'system terms', complete: !!tmOk,
            why: tmOk ? '' : 'the system terms are not loaded'
        });

        localMemo = {
            key: key, rows: rows, collected: rows.length,
            ms: Date.now() - t0,
            complete: scopes.every(function (s) { return s.complete; }),
            scopes: scopes
        };
        return localMemo;
    };

    /* --------- the cross-map half: a second walk of the map files --------- */
    var scan = {
        phase: 'idle',      // idle | scanning | ready | unavailable
        progress: 0, built: 0, maps: 0, rows: [], fp: null, why: '', total: 0
    };
    var scanRun = null;     // the live pump, so a second start cannot make a second walk

    /* Chunked through idle time and NEVER through a frame hook: a per-frame
       schedule runs several chunks a frame under a fast-forward plugin, which
       is the reason the boot index chunks this way too. Same 8ms budget. */
    var BUDGET_MS = 8;
    function schedule(fn) {
        if ($.caps.idleCallback) {
            window.requestIdleCallback(function (deadline) {
                fn(function () { return deadline.timeRemaining ? deadline.timeRemaining() > 1 : false; });
            }, { timeout: 200 });
        } else {
            setTimeout(function () {
                var t0 = Date.now();
                fn(function () { return Date.now() - t0 < BUDGET_MS; });
            }, 0);
        }
    }

    function mapFiles() {
        return $.safe(function () {
            if (!$.caps.fs || !$.paths.gameRoot) return [];
            var pathMod = $.env.path, fsMod = $.env.fs;
            var dirs = [pathMod.join($.paths.gameRoot, 'data'), pathMod.join($.paths.gameRoot, 'www', 'data')];
            for (var i = 0; i < dirs.length; i++) {
                try {
                    if (!fsMod.existsSync(dirs[i])) continue;
                    var names = fsMod.readdirSync(dirs[i]).filter(function (n) { return /^Map\d+\.json$/i.test(n); });
                    if (!names.length) continue;
                    return names.map(function (n) {
                        return { id: parseInt(/(\d+)/.exec(n)[1], 10), file: pathMod.join(dirs[i], n) };
                    }).sort(function (a, b) { return a.id - b.id; });
                } catch (e) { /* try the next */ }
            }
            return [];
        }, 'quest map files', []) || [];
    }

    function fingerprint() {
        return $.safe(function () {
            return ($.index && $.index.fingerprint) ? JSON.stringify($.index.fingerprint()) : 'no-index';
        }, 'script scan fingerprint', 'no-index');
    }

    Q.script.state = function () {
        var s = {
            phase: scan.phase, progress: scan.progress, built: scan.built,
            maps: scan.maps, rows: scan.rows.length, total: scan.total, why: scan.why
        };
        if (!$.caps.fs) {
            s.phase = 'unavailable';
            s.why = $.caps.fsWhy || 'this build has no filesystem to read map files from';
        } else if (scan.phase === 'ready' && scan.fp !== fingerprint()) {
            // Cached against the same fingerprint the index uses, so a patched
            // game does not read its old answer back.
            s.phase = 'idle';
            s.why = 'the game changed since this scan, so it was dropped';
        }
        return s;
    };

    Q.script.forget = function () {
        scan.rows = []; scan.built = 0; scan.fp = null; scan.maps = 0;
        scan.total = 0; scan.progress = 0;
        scan.phase = 'idle'; scan.why = '';
        return true;
    };

    Q.script.cancel = function () {
        if (scan.phase !== 'scanning') return false;
        scanRun = null;
        // A cancelled scan leaves NO half-built result: half a cross-map
        // answer presented as a whole one is worse than no answer.
        Q.script.forget();
        $.log('info', 'quest: the map-file scan was cancelled and nothing was kept');
        return true;
    };

    /** Start the second walk. Returns whether it started. */
    Q.script.scan = function (onProgress) {
        if (scan.phase === 'scanning') return false;       // starting twice runs one walk
        if (!$.caps.fs) {
            scan.phase = 'unavailable';
            scan.why = $.caps.fsWhy || 'this build has no filesystem to read map files from';
            return false;
        }
        var files = mapFiles();
        if (!files.length) {
            scan.phase = 'unavailable';
            scan.why = 'no data/MapNNN.json files were found under ' + $.paths.gameRoot;
            return false;
        }

        Q.script.forget();
        scan.phase = 'scanning';
        scan.maps = files.length;
        scan.fp = fingerprint();
        var i = 0, t0 = Date.now();
        var notes = [];

        function pump(hasTime) {
            if (scanRun !== pump) return;                  // cancelled, or superseded
            while (i < files.length) {
                if (!hasTime() && (Date.now() - t0) > BUDGET_MS) {
                    scan.progress = i / files.length;
                    t0 = Date.now();
                    schedule(pump);
                    if (onProgress) $.safe(onProgress, 'scan progress');
                    return;
                }
                var f = files[i];
                $.safe(function () {
                    var raw;
                    try { raw = $.env.fs.readFileSync(f.file, 'utf8'); }
                    catch (e) { notes.push('map ' + f.id + ': could not be read (' + e.message + ')'); return; }
                    var m;
                    try { m = JSON.parse(raw); }
                    catch (e2) { notes.push('map ' + f.id + ': not valid JSON (' + e2.message + ')'); return; }
                    var nm = mapName(f.id);
                    (m.events || []).forEach(function (d) {
                        if (!d) return;
                        (d.pages || []).forEach(function (pg, pi) {
                            collectList(pg.list, {
                                where: (nm || ('map ' + f.id)) + ' · ' + (d.name || ('event ' + d.id)),
                                scope: 'map', mapId: f.id, mapName: nm,
                                eventId: d.id, eventName: String(d.name || ''),
                                x: d.x, y: d.y, pageIndex: pi,
                                // The file exists and the map tree does not
                                // know it: a half-deleted map looks like this.
                                stale: !nm
                            }, scan.rows);
                        });
                    });
                }, 'scan map ' + f.id);
                i++;
                scan.built = i;
            }
            scan.progress = 1;
            scan.phase = 'ready';
            scan.total = scan.rows.length;
            scan.why = notes.length ? notes.join(' · ') : '';
            scanRun = null;
            $.log('ok', 'quest: read ' + files.length + ' map file(s) for their text — ' +
                scan.rows.length + ' line(s)' + (notes.length ? ', ' + notes.length + ' file(s) noted' : ''));
            if (onProgress) $.safe(onProgress, 'scan progress');
        }

        scanRun = pump;
        schedule(pump);
        return true;
    };

    // Why this is a second read of files the index already opened. Stated
    // here as well as in the panel, so whoever later adds a text stage to the
    // index knows exactly what this replaces.
    var SECOND_READ = 'The boot index walked these same files, but records which switches and ' +
        'variables each event touches, not what it says — so this is a second read. It is chunked ' +
        'through idle time, cancellable, and cached against the same fingerprint the index uses.';

    /**
     * Search the collected lines.
     * filters: { kinds: {messages:bool,…}, scope: one of SCOPES }
     */
    Q.script.search = function (query, filters) {
        filters = filters || {};
        var kinds = filters.kinds || {};
        var scope = filters.scope || 'everything';
        var max = qnum('quest.script.max', 5000, 100, 50000);
        var q = String(query || '').toLowerCase().trim();

        var local = Q.script.local();
        var pool = local.rows;
        var st = Q.script.state();
        var crossUsed = false;
        if ((scope === 'everything' || scope === 'other maps') && st.phase === 'ready') {
            pool = pool.concat(scan.rows);
            crossUsed = true;
        }

        var out = [];
        var seen = 0;
        for (var i = 0; i < pool.length; i++) {
            var r = pool[i];
            if (!kinds[KIND_GROUP[r.kind]]) continue;
            if (scope !== 'everything') {
                if (scope === 'this map' && !(r.scope === 'map' && r.here)) continue;
                if (scope === 'common events' && r.scope !== 'common') continue;
                if (scope === 'troop pages' && r.scope !== 'troop') continue;
                if (scope === 'database' && r.scope !== 'db') continue;
                if (scope === 'other maps' && !(r.scope === 'map' && !r.here)) continue;
            }
            if (q && r.text.toLowerCase().indexOf(q) < 0 && r.where.toLowerCase().indexOf(q) < 0) continue;
            seen++;
            if (out.length < max) out.push(r);
        }

        var scopes = local.scopes.slice();
        scopes.push({
            key: 'other maps', label: 'other maps',
            complete: crossUsed && st.phase === 'ready',
            why: crossUsed && st.phase === 'ready' ? ''
                : (st.phase === 'unavailable' ? st.why
                    : (st.phase === 'scanning' ? 'the scan is still running'
                        : 'not scanned — press "scan every map file"'))
        });

        return {
            rows: out, matched: seen,
            truncated: seen > out.length, max: max,
            complete: scopes.every(function (s) { return s.complete; }),
            why: scopes.filter(function (s) { return !s.complete; })
                .map(function (s) { return s.label + ': ' + s.why; }).join(' · '),
            scopes: scopes
        };
    };

    /* =====================================================================
       PART 6 — PANELS
       ===================================================================== */

    var ROW_H = 17;

    function todo(title, line) {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: title }),
                h('div', { text: line })));
    }

    function note(text, warn) {
        return h('div', {
            class: 'mm-sub',
            style: 'white-space:normal;padding:2px' + (warn ? ';color:var(--mm-warn)' : ''),
            text: text
        });
    }

    /* A value too long for a row's right-hand side goes UNDER its label, not
       beside it: .mm-edge--shrink lets the value wrap, but the label is still
       squeezed to "Sta…" by a sentence, and a label nobody can read is worse
       than a taller box. */
    function block(label, text, warn) {
        return h('div', { style: 'padding:2px' },
            h('div', { class: 'mm-lab', text: label }),
            h('div', {
                class: 'mm-sub mm-selectable',
                style: 'white-space:normal;word-wrap:break-word' + (warn ? ';color:var(--mm-warn)' : ''),
                text: String(text)
            }));
    }

    function kv(label, value) {
        return h('div', { class: 'mm-row' },
            h('div', { class: 'mm-lab', text: label }),
            // An unbounded value — a project's own name for something, a joined
            // list — so the edge is allowed to shrink and wrap. Without that it
            // pushes the label out and is then clipped by the column.
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-selectable mm-breakall',
                text: String(value)
            }));
    }

    function jumpTo(tab, sub) {
        qset('ui.tab', tab);
        qset('ui.sub.' + tab, sub);
        U.rerender();
    }

    /* --------------------------------------------------------------------
       6a — BLOCKED
       -------------------------------------------------------------------- */

    var blockedEventId = 0, blockedPage = -1;
    // Set by the last build, read by the one per-frame hook and the one
    // selection subscription. Never a fresh handler per rebuild — those
    // accumulate for the life of the session and every one of them fires.
    var repaintBlocked = null;

    function selectedEvent() {
        if (!mapLoaded()) return null;
        var id = blockedEventId;
        if ($.events && $.events.selected) {
            var sel = $.safe(function () { return $.events.selected(); }, 'selected event', null);
            if (sel) id = sel.eventId();
        }
        if (!id) {
            var first = $.safe(function () { return $gameMap.events()[0]; }, 'first event', null);
            return first || null;
        }
        // events() FILTERS a list indexed by event id, so events()[n] is not
        // event n. event(id) is the lookup.
        return $.safe(function () { return $gameMap.event(id); }, 'event by id', null) || null;
    }

    /**
     * The STRUCTURE of a blocked report, as a string.
     *
     * Everything that decides which groups and which rows exist, and nothing
     * that decides what a row says. When this is unchanged the per-frame
     * refresh can rewrite the value cells in place; when it changes, the DOM
     * itself is wrong and only a rebuild will do.
     */
    function shapeOf(st, onlyUnmet, showMet) {
        return [st.engineActive, st.ourActive, st.erased ? 1 : 0, st.pages.length].join('/') + '|' +
            st.pages.map(function (p) {
                var shownHere = onlyUnmet ? p.unmet : p.total;
                var hidden = (!showMet && p.state === 'active' && st.pages.length > 1) ? 1 : 0;
                return p.index + ':' + p.state + ':' + shownHere + ':' + hidden;
            }).join(',');
    }

    function fixButton(c, ev) {
        if (c.fixable === 'switch') {
            return degradeMark(W.button({
                label: 'set it', mini: true, variant: 'danger', mutates: true,
                onClick: function () { V.setSwitch(c.fixId, true, 'unmet page condition'); U.rerender(); }
            }), 'switches.set');
        }
        if (c.fixable === 'variable') {
            return degradeMark(W.button({
                label: 'set it', mini: true, variant: 'danger', mutates: true,
                // Exactly the value the condition needs: the engine's test is
                // >=, so +1 overshoots and -1 never satisfies it.
                tip: 'Set it|Writes exactly ' + c.fixValue + ', which is what the test needs.',
                onClick: function () { V.setVar(c.fixId, c.fixValue, 'unmet page condition'); U.rerender(); }
            }), 'vars.set');
        }
        if (c.fixable === 'selfswitch') {
            return W.button({
                label: 'set it', mini: true, variant: 'danger', mutates: true,
                onClick: function () {
                    V.setSelfSwitch(c.mapId, c.eventId, c.id, true);
                    $.safe(function () { ev.refresh(); }, 'refresh after self-switch');
                    U.rerender();
                }
            });
        }
        // No one-click fix exists for these two: an item condition is
        // satisfied by holding the item and an actor condition by the party
        // roster, so the honest thing is a dead control with a reason — and,
        // beside it, the panel that does satisfy it.
        if (c.kind === 'item') {
            return h('div', { class: 'mm-cellbtns' },
                W.button({
                    label: 'set it', mini: true, disabled: true,
                    tip: 'Set it|Not available: hold the item. Items → Items gives you one.'
                }),
                W.button({
                    label: 'Items', mini: true, _ungated: true,
                    onClick: function () { jumpTo('items', 'Items'); }
                }));
        }
        return h('div', { class: 'mm-cellbtns' },
            W.button({
                label: 'set it', mini: true, disabled: true,
                tip: 'Set it|Not available: the actor must be in the party. Player → Identity.'
            }),
            W.button({
                label: 'Identity', mini: true, _ungated: true,
                onClick: function () { jumpTo('player', 'Identity'); }
            }));
    }

    function sourcesTable(kind, key) {
        var res = Q.sourcesOf(kind, key);
        var t = W.table({
            virtual: true, rowH: ROW_H,
            empty: 'nothing in this project touches it',
            cols: [
                { label: 'where', w: '1 1 0' },
                { label: '#', w: '0 0 38px', cls: 'mm-td-num' },
                { label: 'event', w: '1 1 0' },
                { label: 'x,y', w: '0 0 54px', cls: 'mm-td-num' },
                { label: '', w: '0 0 44px' }
            ],
            render: function (r) {
                var canGo = r.scope === 'map' && !r.gone && !r.here;
                return [
                    h('span', {
                        text: r.scope === 'common' ? 'common event'
                            : r.scope === 'troop' ? 'troop page'
                                : (r.mapName || ('map ' + r.mapId))
                    }),
                    String(r.commonId || r.troopId || r.eventId || 0),
                    h('span', { text: r.eventName || '(unnamed)' }),
                    r.scope === 'map' && !r.gone ? (r.x + ',' + r.y) : '—',
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: r.here ? 'pick' : 'go', mini: true, variant: 'danger', mutates: true,
                            disabled: r.here ? !$.events : (!canGo || !$.map || !$.map.teleport),
                            tip: r.scope !== 'map'
                                ? 'Go|Not on a map — World → Common lists it.'
                                : (!$.map || !$.map.teleport)
                                    ? 'Go|Not available: the Teleport module did not load.'
                                    : null,
                            onClick: function () {
                                // A row on the map you are standing on is
                                // selected, not teleported to: you are here.
                                if (r.here) {
                                    if ($.events) { $.events.select(r.eventId); U.rerender(); }
                                } else if ($.events && $.events.goTo) {
                                    if ($.events.goTo(r)) U.setOpen(false);
                                }
                            }
                        }))
                ];
            },
            onRow: function (tr, r) {
                if (r.here) tr.classList.add('mm-on');
                if (r.gone || r.stale) tr.style.opacity = '.55';
                tr.setAttribute('data-mm-tip', (r.eventName || 'row') + '|' +
                    (r.sets ? 'writes it' : 'reads it') +
                    (r.commandIndex >= 0 ? ' at command ' + r.commandIndex : ' in a page condition') +
                    (r.gone ? ' — the index lists it and the loaded map has no such event.' : '') +
                    (r.stale ? ' — this map is no longer in the database.' : ''));
            }
        });
        t.mm.paint(res.candidates);
        return h('div', {}, t, note(sourceScopeLine(res)));
    }

    function conditionRow(c, ev, pageIndex, sink) {
        // The "now" half is the only part of this row a live game changes, so
        // it is kept by reference: the per-frame refresh rewrites this span
        // and nothing else, rather than rebuilding the panel four times a
        // second for a value that moved by one.
        var nowSpan = h('span', {
            style: c.met ? 'color:var(--mm-ok)' : 'color:var(--mm-warn)',
            text: c.nowText
        });
        if (sink) sink.push({ span: nowSpan, page: pageIndex, kind: c.kind, id: String(c.id) });
        var edge = h('div', { class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub' },
            nowSpan,
            h('span', { text: '  ·  ' + c.needText }));
        var row = W.row(c.label, [edge, fixButton(c, ev)]);
        var box = h('div', {}, row);
        if (c.why) box.appendChild(note(c.why, !c.met));

        var opened = false;
        var slot = h('div', {});
        box.appendChild(W.row('', W.button({
            label: 'who sets this', mini: true, _ungated: true,
            onClick: function () {
                if (opened) { U.clear(slot); opened = false; return; }
                opened = true;
                U.clear(slot);
                var kind = c.kind === 'switch1' || c.kind === 'switch2' ? 'switch'
                    : c.kind === 'variable' ? 'variable'
                        : c.kind === 'selfswitch' ? 'selfswitch' : null;
                if (!kind) {
                    slot.appendChild(note('an item or actor condition is not set by an event command, so ' +
                        'there is nothing to list here.'));
                    return;
                }
                slot.appendChild(sourcesTable(kind, c.kind === 'selfswitch' ? c.id : c.id));
            }
        })));
        box.appendChild(slot);
        return box;
    }

    function buildBlocked() {
        if (!mapLoaded()) {
            return todo('no map loaded', 'start or load a game, then reopen this tab');
        }
        var list = $.safe(function () { return $gameMap.events(); }, 'map events', []) || [];
        if (!list.length) {
            return todo('this map has no events', 'World → Teleport moves you to one that has');
        }

        var ev = selectedEvent();
        if (!ev) ev = list[0];
        blockedEventId = ev.eventId();

        var st = Q.pageStates(ev);
        var liveCells = [];
        var d = $.safe(function () { return ev.event(); }, 'event data', null);
        var pages = (d && d.pages) || [];
        var onlyUnmet = qbool('quest.blocked.onlyUnmet', true);
        var showMet = qbool('quest.blocked.showMetPages', false);

        var opts = list.map(function (e) {
            var ed = $.safe(function () { return e.event(); }, 'event data', null);
            return e.eventId() + ' · ' + ((ed && ed.name) || '(unnamed)');
        });
        var mine = ev.eventId() + ' · ' + ((d && d.name) || '(unnamed)');

        var pageOpts = [];
        for (var pi = 0; pi < pages.length; pi++) pageOpts.push('page ' + (pi + 1));
        if (!pageOpts.length) pageOpts.push('page 1');
        var pageSel = blockedPage >= 0 && blockedPage < pages.length ? blockedPage
            : (st.engineActive >= 0 ? st.engineActive : 0);

        var left = [
            W.group('Event', [
                W.row('Event', W.dropdown({
                    options: opts, value: mine, width: '116px', _ungated: true,
                    onChange: function (v) {
                        var id = parseInt(v, 10) || 0;
                        blockedEventId = id; blockedPage = -1;
                        if ($.events && $.events.select) $.events.select(id);
                        U.rerender();
                    }
                })),
                W.row('Page', W.dropdown({
                    options: pageOpts, value: 'page ' + (pageSel + 1), width: '92px', _ungated: true,
                    onChange: function (v) { blockedPage = (parseInt(v.replace(/\D+/g, ''), 10) || 1) - 1; U.rerender(); }
                })),
                W.button({
                    label: 'select on the map', wide: true, _ungated: true,
                    disabled: !$.events,
                    tip: !$.events
                        ? 'Select|Not available: the Events module did not load.'
                        : null,
                    onClick: function () { if ($.events) { $.events.select(ev.eventId()); U.rerender(); } }
                }),
                W.button({
                    label: 'move player here', wide: true, mutates: true, variant: 'danger',
                    disabled: !$.events || !$.events.walkTo,
                    tip: !$.events
                        ? 'Move|Not available: the Events module did not load.'
                        : 'Move|Puts you on its tile; a touch trigger then fires.',
                    onClick: function () { if ($.events) { $.events.walkTo(ev); U.setOpen(false); } }
                }),
                W.button({
                    label: 'open this event in Commands', wide: true, _ungated: true,
                    disabled: !$.events,
                    tip: !$.events ? 'Commands|Not available: the Events module did not load.' : null,
                    onClick: function () {
                        if ($.events) $.events.select(ev.eventId());
                        jumpTo('world', 'Commands');
                    }
                })
            ], { tag: 'event ' + ev.eventId() }),

            W.group('View', [
                W.toggleRow('only the conditions that are unmet', {
                    value: onlyUnmet, keybind: false, _ungated: true,
                    onChange: function (v) { qset('quest.blocked.onlyUnmet', v); U.rerender(); }
                }),
                W.toggleRow('show the pages that already run', {
                    value: showMet, keybind: false, _ungated: true,
                    onChange: function (v) { qset('quest.blocked.showMetPages', v); U.rerender(); }
                }),
                W.button({
                    label: 're-check now', wide: true, _ungated: true,
                    onClick: function () { U.rerender(); }
                })
            ]),

            W.group('What this cannot see', [
                note('These six stored fields are all a page records. A plugin can add conditions ' +
                    'through note tags, or replace the page test outright, and nothing here can see ' +
                    'either. When that happens the cross-check above says so.'),
                note($.compat && $.compat.frameworks
                    ? (function () {
                        var f = $.safe(function () { return $.compat.frameworks(); }, 'frameworks', []) || [];
                        return f.length
                            ? 'Recognised here: ' + f.map(function (x) { return x.name || String(x); }).join(', ')
                            : 'No plugin suite this build recognises is installed.';
                    }())
                    : 'The compatibility module did not load, so no plugin suite can be named.')
            ], { collapsed: true })
        ];

        /* --- the cross-check: our answer against the engine's --- */
        var right = [];
        var crossBody;
        if (st.agrees) {
            crossBody = note('The engine and the six stored conditions agree' +
                (st.erased ? ' — this event is erased, so no page runs.' : '.'));
        } else {
            crossBody = note('The engine has page ' + (st.engineActive + 1) +
                ' active; by the six stored conditions it should be page ' + (st.ourActive + 1) +
                '. Something is deciding pages that these fields do not describe — a plugin ' +
                'note-tag condition, or a replaced page test.', true);
        }
        right.push(W.group('Cross-check', [crossBody], { tag: st.agrees ? 'agree' : 'DISAGREE' }));

        /* Which page groups are on screen at all, decided BEFORE the open one
           is chosen. The Page dropdown picks the open group — but a dropdown
           pointing at a page this view is hiding would close the only group
           there is, so the choice falls back to the first one shown. */
        var visible = st.pages.filter(function (p) {
            return showMet || p.state !== 'active' || st.pages.length === 1;
        });
        var openPage = -1;
        visible.forEach(function (p) {
            if (p.index === pageSel) openPage = p.index;
        });
        if (openPage < 0 && visible.length) openPage = visible[0].index;

        var stack = [];
        visible.forEach(function (p) {
            var conds = p.conditions;
            var shown = onlyUnmet ? conds.filter(function (c) { return !c.met; }) : conds;
            var kids = [h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px', text: pageStateLine(st, p) })];
            if (!conds.length) {
                kids.push(note('no conditions — this page is always eligible'));
            } else if (!shown.length) {
                kids.push(note('every condition on this page is met'));
            } else {
                var dn = degradeNote('switches.set');
                if (dn) kids.push(dn);
                var dn2 = degradeNote('vars.set');
                if (dn2) kids.push(dn2);
                shown.forEach(function (c) { kids.push(conditionRow(c, ev, p.index, liveCells)); });
            }
            stack.push(W.group('Page ' + (p.index + 1), kids, {
                tag: p.state,
                // The Page dropdown above picks which one is open, so it does
                // something on an event with eight pages rather than being a
                // label for a list that is already all on screen.
                collapsed: p.index !== openPage
            }));
        });
        if (!stack.length) stack.push(note('every page on this event already runs; turn on "show the ' +
            'pages that already run" to list them.'));
        right.push(W.group('Pages', stack, { grow: true, tag: pages.length + ' page(s)' }));
        var builtShape = shapeOf(st, onlyUnmet, showMet);

        /* ONE handler, re-pointed by each build. It rewrites the value cells
           it holds references to, and asks for a full rebuild only when the
           SHAPE of the answer changed — a page went active, a page appeared
           or vanished from this view, the event was erased. Calling
           U.rerender() unconditionally would rebuild this panel's whole DOM
           several times a second for a number that moved by one. */
        var builtFor = ev.eventId();
        repaintBlocked = function () {
            var live = selectedEvent();
            if (!live || live.eventId() !== builtFor) { U.rerender(); return; }
            var now = Q.pageStates(live);
            if (shapeOf(now, onlyUnmet, showMet) !== builtShape) { U.rerender(); return; }
            for (var i = 0; i < liveCells.length; i++) {
                var cell = liveCells[i];
                var pg = now.pages[cell.page];
                if (!pg) continue;
                for (var j = 0; j < pg.conditions.length; j++) {
                    var c = pg.conditions[j];
                    if (c.kind !== cell.kind || String(c.id) !== cell.id) continue;
                    if (cell.span.textContent !== c.nowText) cell.span.textContent = c.nowText;
                    cell.span.style.color = c.met ? 'var(--mm-ok)' : 'var(--mm-warn)';
                    break;
                }
            }
        };

        return cols({ narrow: true, items: left }, right);
    }

    /* --------------------------------------------------------------------
       6b — COMMON
       -------------------------------------------------------------------- */

    var commonSel = 0;

    function buildCommon() {
        if (typeof $dataCommonEvents === 'undefined' || !$dataCommonEvents || $dataCommonEvents.length <= 1) {
            return todo('the common event list is not loaded yet', 'start or load a game, then reopen this tab');
        }

        var all = Q.commons();
        var trig = qstr('quest.common.trigger', 'any');
        var gatedOnly = qbool('quest.common.gatedOnly', false);
        var hideEmpty = qbool('quest.common.hideEmpty', true);
        // The setting is the selection, not a copy of it: a module-local
        // variable that only seeds from the setting once makes the setting a
        // lie the moment anything else writes it.
        commonSel = qnum('quest.common.selected', 0, 0, 100000);

        var anyGated = all.some(function (r) { return r.trigger !== 0; });

        /* The three sentences in the Selected group that move on their own,
           pulled out of the build so the live repaint writes exactly the same
           words rather than a second set that could drift from them. */
        function gateText(r) {
            if (r.trigger === 0) return 'none — it is called, never triggered';
            if (!r.switchId) return 'unset (0) — the editor never picked one, which is why it never fires';
            return 'switch ' + r.switchId + ' "' + r.switchName + '" — ' + (r.switchOn ? 'ON' : 'OFF');
        }
        function objectText(r) {
            if (r.trigger !== 2) return 'none — only a Parallel one gets one';
            if (!r.hasObject) return 'no';
            return r.live ? 'yes — it has an interpreter' : 'yes, parked';
        }
        function ranText(r) {
            return r.ran === null ? 'not counted — ' + runCountWhy() : r.ran + ' explicit call(s)';
        }
        /* Filled in only when there IS a selection; the repaint checks each. */
        var gateBlock = null, objectBlock = null, ranBlock = null, gateToggle = null;

        function matching(filter) {
            return all.filter(function (r) {
                if (hideEmpty && !r.commands) return false;
                if (trig !== 'any' && r.triggerName !== trig) return false;
                if (gatedOnly && !(r.gated && r.switchOn)) return false;
                if (filter) {
                    var hay = (r.id + ' ' + r.name).toLowerCase();
                    if (hay.indexOf(filter) < 0) {
                        var body = Q.decodeCommon(r.id).map(function (c) { return c.text; }).join(' ').toLowerCase();
                        if (body.indexOf(filter) < 0) return false;
                    }
                }
                return true;
            });
        }
        var rows = matching(qstr('quest.common.filter', '').toLowerCase());

        if (!commonSel || !all.some(function (r) { return r.id === commonSel; })) {
            commonSel = rows.length ? rows[0].id : (all.length ? all[0].id : 0);
        }
        var sel = null;
        all.forEach(function (r) { if (r.id === commonSel) sel = r; });

        var listTable = W.table({
            virtual: true, rowH: ROW_H, empty: 'nothing matches',
            cols: [
                { label: '#', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'trigger', w: '0 0 78px' },
                { label: 'gate', w: '0 0 60px', cls: 'mm-td-num' },
                { label: 'cmds', w: '0 0 46px', cls: 'mm-td-num' }
            ],
            render: function (r) {
                return [
                    String(r.id),
                    h('span', {
                        class: r.id === commonSel ? 'mm-td-val mm-hi' : 'mm-td-val',
                        text: (r.forged ? '✦ ' : '') + (r.name || '(unnamed)')
                    }),
                    r.triggerName,
                    r.trigger === 0 ? '—' : (r.switchId ? (r.switchOn ? 'ON' : 'off') : 'unset'),
                    String(r.commands)
                ];
            },
            onRow: function (tr, r) {
                if (!r.commands) tr.style.opacity = '.55';
                if (r.forged) tr.classList.add('mm-on');
                tr.setAttribute('data-mm-tip', (r.name || 'common event ' + r.id) + '|' + r.triggerName +
                    (r.trigger === 0 ? ', so it has no gate switch'
                        : r.switchId ? ', gate switch ' + r.switchId : ', gate switch unset')
                    + (r.commands ? '' : ' — no commands'));
                tr.addEventListener('click', function () {
                    commonSel = r.id; qset('quest.common.selected', r.id); U.rerender();
                });
            }
        });
        listTable.mm.paint(rows);

        var decoded = sel ? Q.decodeCommon(sel.id) : [];
        var cmdTable = W.table({
            virtual: true, rowH: ROW_H, empty: 'this common event has no commands',
            cols: [
                { label: '#', w: '0 0 38px', cls: 'mm-td-num' },
                { label: 'code', w: '0 0 46px', cls: 'mm-td-num' },
                { label: 'command', w: '1 1 0' }
            ],
            render: function (c) {
                return [
                    String(c.i), String(c.code),
                    h('span', {
                        style: 'overflow:hidden;text-overflow:ellipsis;padding-left:' + (c.indent * 8) + 'px',
                        text: c.text
                    })
                ];
            },
            onRow: function (tr, c) { tr.setAttribute('data-mm-tip', 'code ' + c.code + '|' + c.text); }
        });
        cmdTable.mm.paint(decoded);

        var callersSlot = h('div', {});

        // Typing repaints the LIST, not the panel: a rebuild on every keystroke
        // takes the focus out of the box being typed into.
        var listGroup = null;
        var left = [
            W.group('Which ones are listed', [
                W.search({
                    value: qstr('quest.common.filter', ''), placeholder: 'id, name or command text',
                    onInput: function (v) {
                        qset('quest.common.filter', v);
                        var next = matching(String(v).toLowerCase());
                        listTable.mm.paint(next);
                        if (listGroup) listGroup.mm.tag(next.length + ' of ' + all.length);
                    }
                }),
                W.row('Trigger', W.dropdown({
                    options: ['any', 'called only', 'autorun', 'parallel'],
                    value: trig, width: '106px', _ungated: true,
                    onChange: function (v) { qset('quest.common.trigger', v); U.rerender(); }
                })),
                W.toggleRow('only the ones whose gate switch is on', {
                    value: gatedOnly, keybind: false, _ungated: true, disabled: !anyGated,
                    tip: anyGated ? null
                        : 'Gated only|Not available: no common event here has a trigger.',
                    onChange: function (v) { qset('quest.common.gatedOnly', v); U.rerender(); }
                }),
                W.toggleRow('hide the ones with no commands', {
                    value: hideEmpty, keybind: false, _ungated: true,
                    onChange: function (v) { qset('quest.common.hideEmpty', v); U.rerender(); }
                })
            ])
        ];

        if (sel) {
            var gateKids = [];
            gateKids.push(kv('Id', sel.id));
            gateKids.push(kv('Name', sel.name || '(unnamed)'));
            gateKids.push(kv('Trigger', sel.triggerName));
            gateBlock = block('Gate switch', gateText(sel), sel.trigger !== 0 && !sel.switchId);
            gateKids.push(gateBlock);
            gateKids.push(kv('Commands', sel.commands));
            gateKids.push(kv('Text lines', sel.textLines));
            objectBlock = block('Live object', objectText(sel));
            gateKids.push(objectBlock);
            ranBlock = block('Run this session', ranText(sel), sel.ran === null);
            gateKids.push(ranBlock);
            if (sel.ran !== null) {
                gateKids.push(note('Only an explicit Call Common Event passes through the counter. ' +
                    'An autorun or parallel one never does, so 0 here does not mean it never ran.'));
            }
            if (sel.forged) gateKids.push(kv('Forged', 'this row was written by the Forge'));

            var dn = degradeNote('switches.set');
            if (dn) gateKids.push(dn);
            gateToggle = W.toggleRow('gate switch', {
                value: sel.switchOn, keybind: false,
                disabled: sel.trigger === 0 || !sel.switchId,
                tip: sel.trigger === 0
                    ? 'Gate switch|Not available: this runs only when something calls it.'
                    : !sel.switchId
                        ? 'Gate switch|The editor left this unset, which is why it never fires.'
                        : null,
                onChange: function (v) {
                    // A dimmed control still receives the click, so the
                    // precondition is re-checked here rather than trusted to
                    // the class: writing switch 0 is a write to nothing that
                    // reads back as a success.
                    if (sel.trigger === 0 || !sel.switchId) return;
                    V.setSwitch(sel.switchId, v, 'common event ' + sel.id + ' gate');
                    U.rerender();
                }
            });
            gateKids.push(degradeMark(gateToggle, 'switches.set'));

            left.push(W.group('Selected', gateKids, { tag: '#' + sel.id }));

            var actions = [];
            actions.push(W.button({
                label: 'run it now', wide: true, mutates: true, variant: 'danger',
                confirm: true, confirmLabel: 'run it? (irreversible)',
                disabled: !!sel.why,
                onClick: function () { if (Q.runCommon(sel.id)) U.setOpen(false); }
            }));
            if (sel.why) actions.push(note(sel.why, true));
            actions.push(W.button({
                label: 'who calls this', wide: true, _ungated: true,
                onClick: function () {
                    U.clear(callersSlot);
                    var hits = Q.callersOf(sel.id);
                    if (!hits.length) {
                        callersSlot.appendChild(note('nothing in the loaded map, the common events or ' +
                            'the troop pages calls it.'));
                    } else {
                        hits.forEach(function (hit) {
                            callersSlot.appendChild(h('div', { class: 'mm-row' },
                                h('div', { class: 'mm-lab', text: hit.scope }),
                                h('div', {
                                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub',
                                    text: hit.label + ' @' + hit.commandIndex
                                })));
                        });
                    }
                    callersSlot.appendChild(note(CALLERS_SCOPE));
                }
            }));
            actions.push(callersSlot);
            actions.push(W.button({
                label: 'open in the Forge editor', wide: true, _ungated: true,
                disabled: !$.forge || !$.forge.kind,
                tip: !$.forge ? 'Forge|Not available: the Forge module did not load.' : null,
                onClick: function () {
                    if (!$.forge || !$.forge.kind) return;
                    $.forge.kind('common');
                    jumpTo('items', 'Forge');
                    U.toast({
                        title: 'FORGE', severity: 'ok',
                        msg: 'Browse the library and copy this row'
                    });
                }
            }));
            var shape = Q.reserveShape();
            actions.push(note(shape.queue === null
                ? shape.why
                : shape.queue
                    ? 'This build queues reserved common events, so a second run is added rather than ' +
                      'replacing the first.'
                    : 'This build holds ONE reserved common event at a time. A second reservation would ' +
                      'discard the first with no error, so it is refused instead.'));
            left.push(W.group('Run it', actions));
        }

        listGroup = W.group('Common events', [listTable],
            { grow: true, tag: rows.length + ' of ' + all.length });

        /* A gate switch is thrown by the game, not by this panel, and a
           parallel common event acquires and loses its interpreter as the map
           runs — so the ON/off column, the "only the gated ones" filter and
           the three sentences about the selected row are all describing
           something that moves while they are being read.

           The list is repainted and four held nodes are rewritten. Nothing
           else in the Selected group is touched: it holds the gate toggle,
           and a group rebuilt on a timer takes with it every expanded box and
           the arm of the "run it now" confirm. The gate toggle is set SILENTLY
           — firing its onChange would write the switch the game just wrote,
           through the verify path, once every 700ms. */
        U.live(Q.commonsStamp, function () {
            all = Q.commons();
            var next = matching(qstr('quest.common.filter', '').toLowerCase());
            listTable.mm.paint(next);
            listGroup.mm.tag(next.length + ' of ' + all.length);
            var now = null;
            for (var i = 0; i < all.length; i++) if (all[i].id === commonSel) now = all[i];
            if (!now) return;
            if (gateBlock) gateBlock.lastChild.textContent = gateText(now);
            if (objectBlock) objectBlock.lastChild.textContent = objectText(now);
            if (ranBlock) ranBlock.lastChild.textContent = ranText(now);
            if (gateToggle) gateToggle.mm.set(now.switchOn, true);
        }, {
            name: 'common events', within: listTable,
            when: function () { return !listTable.mm.isScrolling(); },
            whyNot: 'you are scrolling the list'
        });

        var right = [
            listGroup,
            W.group('Commands', [
                decoderWhy() ? note(decoderWhy(), true) : null,
                cmdTable
            ], { grow: true, tag: sel ? 'common event ' + sel.id : 'none' })
        ];

        return cols({ narrow: true, items: left }, right);
    }

    /* --------------------------------------------------------------------
       6c — QUESTS
       -------------------------------------------------------------------- */

    function stepSources(step) {
        return sourcesTable(step.kind === 'switch' ? 'switch' : 'variable', step.id);
    }

    function buildQuests() {
        var groups = Q.quests();
        var showDone = qbool('quest.quests.showDone', true);
        var groupBy = qstr('quest.quests.groupBy', 'both');
        var minMembers = qnum('quest.quests.minMembers', 3, 2, 10);
        var hasPattern = !!$.safe(function () {
            return $.profile ? $.profile.get('sectionPattern', null) : null;
        }, 'section pattern', null);

        function matching(filter) {
            return groups.filter(function (g) {
                if (!showDone && g.done >= g.total) return false;
                if (filter && g.title.toLowerCase().indexOf(filter) < 0) return false;
                return true;
            });
        }
        var shown = matching(qstr('quest.quests.filter', '').toLowerCase());
        var groupsHost = h('div', {});
        var questGroup = null;

        var left = [
            /* Before a new game or a load, there is a database but no save, so
               every step reads as not done and the panel would present a full
               list of untouched objectives as though the player had done
               nothing — which is true of no game and looks like a broken
               inference rather than an absent one. */
            gameStarted() ? null : W.group('No game is running yet', [
                note('The objectives below are read from the project\'s own names, which exist from ' +
                    'the title screen. Whether each one is DONE is a question about the save, and ' +
                    'there is no save loaded — so every step reads as not done, and none of them ' +
                    'means anything until a game is started or loaded.')
            ], { tag: 'from the database only' }),
            W.group('This is inference', [
                note('Nothing in the engine records a quest. This reads the project\'s own switch and ' +
                    'variable NAMES and the events that touch them. Where the reading is wrong, the ' +
                    'names are what it is wrong about — World → Switches shows them raw.'),
                note('A chain claims its own flags first; a section then lists only what no chain took.'),
                (Q.bulk && Q.bulk.tokens.length)
                    ? note('This project names ' +
                        Q.bulk.tokens.map(function (t) {
                            return Math.round(Q.bulk.map[t] / Q.bulk.total * 100) + '% of its flags "' + t + '_…"';
                        }).join(' and ') +
                        '. Those are placeholders, not names, so they are not read as steps — World → ' +
                        'Bulk sets a range of them directly.')
                    : null
            ]),
            W.group('Which ones are listed', [
                // Repaints the groups, not the panel: a full rebuild on every
                // keystroke takes the focus out of the box being typed into.
                W.search({
                    value: qstr('quest.quests.filter', ''), placeholder: 'title',
                    onInput: function (v) {
                        qset('quest.quests.filter', v);
                        paintGroups(matching(String(v).toLowerCase()));
                    }
                }),
                W.row('Group by', W.dropdown({
                    options: ['section headers', 'shared name stems', 'both'],
                    value: groupBy === 'section' ? 'section headers'
                        : groupBy === 'stem' ? 'shared name stems' : 'both',
                    width: '118px', _ungated: true,
                    disabled: !hasPattern && groupBy === 'section',
                    tip: hasPattern ? null
                        : 'Grouped by|Section headers need a convention this project does not use.',
                    onChange: function (v) {
                        qset('quest.quests.groupBy', v === 'section headers' ? 'section'
                            : v === 'shared name stems' ? 'stem' : 'both');
                        Q.reinfer(); U.rerender();
                    }
                })),
                hasPattern ? null : note('"section headers" is offered and unavailable: this project uses ' +
                    'no section-header convention in its variable or switch names.'),
                W.row('Smallest', W.slider({
                    value: minMembers, min: 2, max: 10, width: '104px', label: 'smallest group',
                    _ungated: true,
                    onChange: function (v) { qset('quest.quests.minMembers', v); Q.reinfer(); U.rerender(); }
                })),
                W.toggleRow('show the finished ones', {
                    value: showDone, keybind: false, _ungated: true,
                    onChange: function (v) { qset('quest.quests.showDone', v); U.rerender(); }
                }),
                W.button({
                    label: 're-infer', wide: true, _ungated: true,
                    onClick: function () { Q.reinfer(); U.rerender(); }
                })
            ], { tag: shown.length + ' of ' + groups.length })
        ];

        var right = [];
        if (!groups.length) {
            right.push(W.group('Nothing to reconstruct', [note(Q.inferenceWhy() || FALLBACK, true)],
                { grow: true }));
            return cols({ narrow: true, items: left }, right);
        }

        /* One record per group box on screen, holding the nodes a live repaint
           writes into. Reset by paintGroups, because the boxes it builds are
           the only ones that exist. */
        var liveBoxes = [];

        function groupBox(g) {
            var rec = { g: g, box: null, steps: [], counter: null, nextEl: null,
                        nextGo: null, nextKey: '', advance: null };
            liveBoxes.push(rec);

            var kids = [h('div', {
                class: 'mm-sub', style: 'white-space:normal;padding:2px', text: g.evidence
            })];

            var dn = degradeNote('switches.set');
            if (dn) kids.push(dn);
            var dn2 = degradeNote('vars.set');
            if (dn2) kids.push(dn2);

            g.steps.forEach(function (s) {
                var control;
                if (s.kind === 'switch') {
                    control = degradeMark(W.checkbox({
                        value: s.done, label: s.name,
                        onChange: function (on) { V.setSwitch(s.id, on, g.title); U.rerender(); }
                    }), 'switches.set');
                } else {
                    control = degradeMark(W.editCell(varValue(s.id), function (v) {
                        V.setVar(s.id, v, g.title); U.rerender();
                    }), 'vars.set');
                }
                rec.steps.push({ s: s, control: control });
                var slot = h('div', {});
                var opened = false;
                kids.push(h('div', {},
                    W.row(s.label, [control, W.button({
                        label: 'who sets it', mini: true, _ungated: true,
                        onClick: function () {
                            if (opened) { U.clear(slot); opened = false; return; }
                            opened = true; U.clear(slot);
                            slot.appendChild(stepSources(s));
                        }
                    })]),
                    slot));
            });

            if (g.counter) {
                rec.counter = kv('Counter', counterText(g));
                kids.push(rec.counter);
            }

            if (g.next) {
                var found = nextSetter(g);
                var setter = found.setter;
                rec.nextKey = stepKey(g.next);
                rec.nextEl = h('div', { class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-sub',
                    text: nextLine(g, setter) });
                rec.nextGo = W.button({
                    label: 'go', mini: true, variant: 'danger', mutates: true,
                    disabled: !setter || setter.scope !== 'map' || setter.here || !$.map || !$.map.teleport,
                    tip: !$.map || !$.map.teleport
                        ? 'Go|Not available: the Teleport module did not load.' : null,
                    // Read from the record rather than closed over, so the
                    // button still goes to the right place after the step it
                    // describes has moved on under it.
                    onClick: function () {
                        var s = rec.setter;
                        if (s && $.events && $.events.goTo && $.events.goTo(s)) U.setOpen(false);
                    }
                });
                rec.setter = setter;
                kids.push(W.row('Next', [rec.nextEl, rec.nextGo]));
                if (!found.src.complete) kids.push(note(found.src.why, true));
            }

            rec.advance = W.button({
                label: 'advance one step', wide: true, mutates: true, variant: 'danger',
                confirm: true, confirmLabel: 'set the next step?',
                disabled: !g.next,
                onClick: function () {
                    if (!g.next) return;
                    if (g.next.kind === 'switch') {
                        V.setSwitch(g.next.id, true, g.title);
                    } else {
                        // Nothing in the names states what value this variable
                        // should reach, so guessing one would write a number
                        // the project never asked for.
                        U.toast({
                            title: 'NOT WRITTEN', severity: 'warn',
                            msg: 'nothing in the names says what value this variable should reach; ' +
                                'World → Variables sets it directly'
                        });
                        return;
                    }
                    U.rerender();
                }
            });
            kids.push(rec.advance);

            var switchIds = g.steps.filter(function (s) { return s.kind === 'switch'; })
                .map(function (s) { return s.id; });
            var varIds = g.steps.filter(function (s) { return s.kind === 'variable'; })
                .map(function (s) { return s.id; });
            kids.push(W.button({
                label: 'complete this one', wide: true, mutates: true, variant: 'danger',
                confirm: true, confirmLabel: 'switch on all ' + switchIds.length + '?',
                disabled: !switchIds.length,
                onClick: function () {
                    // ONE bulk write, so the whole group is one undo entry and
                    // one log line rather than one of each per step.
                    V.bulkSet('switch', switchIds, true, g.title);
                    U.rerender();
                }
            }));
            if (varIds.length) {
                kids.push(note('not covered by that: variable step' + (varIds.length === 1 ? ' ' : 's ') +
                    varIds.join(', ') + ' — World → Variables sets those.', true));
            }

            rec.box = W.group(g.title, kids, { tag: g.done + '/' + g.total });
            return rec.box;
        }

        function paintGroups(list) {
            liveBoxes.length = 0;
            U.clear(groupsHost);
            if (!list.length) {
                groupsHost.appendChild(note('nothing matches the filter'));
            } else {
                list.forEach(function (g) { groupsHost.appendChild(groupBox(g)); });
            }
            if (questGroup) questGroup.mm.tag(list.length + ' of ' + groups.length);
        }
        paintGroups(shown);

        /* Quest progress is the one thing on this panel that the GAME moves —
           that is what the panel is for — and it never moved while the panel
           was open. paintGroups is not the repaint: it rebuilds every box, and
           with them a checkbox per step, an edit cell per variable step, two
           armed-confirm buttons and whatever "who sets it" the reader had
           opened. The live path writes the held nodes instead, and escalates
           to a rebuild only when a group gains or loses its "Next" row —
           a step count changing shape, which is what a quest finishing IS. */
        U.live(Q.questsStamp, function () {
            Q.refreshQuests();
            var i, j;
            for (i = 0; i < liveBoxes.length; i++) {
                if (!!liveBoxes[i].g.next !== !!liveBoxes[i].nextEl) { U.rerender(); return; }
            }
            for (i = 0; i < liveBoxes.length; i++) {
                var rec = liveBoxes[i], g = rec.g;
                rec.box.mm.tag(g.done + '/' + g.total);
                for (j = 0; j < rec.steps.length; j++) {
                    var st = rec.steps[j];
                    // Silent: firing the checkbox's own onChange would write
                    // the switch the game has just written, through the verify
                    // path, once every 700ms.
                    if (st.s.kind === 'switch') st.control.mm.set(st.s.done, true);
                    else st.control.mm.set(varValue(st.s.id));
                }
                if (rec.counter) rec.counter.lastChild.textContent = counterText(g);
                if (rec.advance) rec.advance.mm.disable(!g.next);
                if (!rec.nextEl || !g.next) continue;
                var key = stepKey(g.next);
                // sourcesOf walks the index, so it is asked again only when the
                // step it describes has actually changed.
                if (key === rec.nextKey) {
                    rec.nextEl.textContent = nextLine(g, rec.setter);
                    continue;
                }
                rec.nextKey = key;
                rec.setter = nextSetter(g).setter;
                rec.nextEl.textContent = nextLine(g, rec.setter);
                if (rec.nextGo) {
                    rec.nextGo.mm.disable(!rec.setter || rec.setter.scope !== 'map' ||
                        rec.setter.here || !$.map || !$.map.teleport);
                }
            }
        }, { name: 'quest progress', within: groupsHost });

        questGroup = W.group('Reconstructed', [groupsHost],
            { grow: true, tag: shown.length + ' of ' + groups.length });
        right.push(questGroup);
        return cols({ narrow: true, items: left }, right);
    }

    function stepKey(s) { return s ? (s.kind + ':' + s.id) : ''; }

    function counterText(g) {
        return g.counter ? (g.counter.name + ' = ' + varValue(g.counter.id)) : '';
    }

    /** The first candidate that WRITES the group's next flag, and the index
        answer it came from — which carries its own "why" when incomplete. */
    function nextSetter(g) {
        var src = Q.sourcesOf(g.next.kind === 'switch' ? 'switch' : 'variable', g.next.id);
        var setter = null;
        src.candidates.forEach(function (r) { if (!setter && r.sets) setter = r; });
        return { setter: setter, src: src };
    }

    function nextLine(g, setter) {
        var line = 'step ' + (g.current + 1) + ' of ' + g.total + ' — ';
        if (setter && setter.scope === 'map') {
            return line + 'the event that sets it is "' + (setter.eventName || 'unnamed') + '" on ' +
                (setter.mapName || ('map ' + setter.mapId)) + ' at ' + setter.x + ',' + setter.y;
        }
        if (setter) {
            return line + 'it is set by a ' +
                (setter.scope === 'common' ? 'common event' : 'troop page') +
                ' — "' + (setter.eventName || '') + '"';
        }
        return line + 'nothing in this project appears to set it';
    }

    /* --------------------------------------------------------------------
       6d — SCRIPT
       -------------------------------------------------------------------- */

    var scriptSel = null;

    function kindFlags() {
        var out = {};
        SCRIPT_KINDS.forEach(function (k) {
            out[k.key] = qbool('quest.script.kinds.' + k.key, k.key !== 'comments');
        });
        return out;
    }

    function buildScript() {
        if (!dbLoaded()) return todo('the database is not loaded yet', 'start or load a game, then reopen this tab');

        var q = qstr('quest.script.q', '');
        var scope = qstr('quest.script.scope', 'everything');
        var kinds = kindFlags();
        var res = Q.script.search(q, { kinds: kinds, scope: scope });
        var st = Q.script.state();
        var linesGroup = null, capNote = h('div', {});

        var table = W.table({
            virtual: true, rowH: ROW_H, empty: 'nothing matches',
            cols: [
                { label: 'where', w: '1 1 0' },
                { label: 'kind', w: '0 0 76px' },
                { label: 'text', w: '2 1 0' },
                { label: '', w: '0 0 52px' }
            ],
            render: function (r) {
                var onMap = r.scope === 'map';
                return [
                    h('span', { style: 'overflow:hidden;text-overflow:ellipsis', text: r.where }),
                    r.kind,
                    // Every cell gets its own ellipsis and the full line goes
                    // on the row tooltip: a line of dialogue in an unbounded
                    // cell pushes the column sideways and is then clipped.
                    h('span', { style: 'overflow:hidden;text-overflow:ellipsis', text: r.text || '(empty)' }),
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: r.here ? 'pick' : 'go', mini: true, variant: 'danger', mutates: true,
                            disabled: !onMap || r.gone || (r.here ? !$.events : (!$.map || !$.map.teleport)),
                            tip: r.scope === 'common'
                                ? 'Go|Not on a map — World → Common lists it.'
                                : r.scope === 'troop'
                                    ? 'Go|A troop page is a battle, not a map.'
                                    : r.scope === 'db'
                                        ? 'Go|This is a database row, not an event.'
                                        : (!$.map || !$.map.teleport)
                                            ? 'Go|Not available: the Teleport module did not load.'
                                            : null,
                            onClick: function () {
                                if (r.here) {
                                    if ($.events) { $.events.select(r.eventId); U.rerender(); }
                                } else if ($.events && $.events.goTo) {
                                    if ($.events.goTo(r)) U.setOpen(false);
                                }
                            }
                        }))
                ];
            },
            onRow: function (tr, r) {
                if (r.gone || r.stale) tr.style.opacity = '.55';
                tr.setAttribute('data-mm-tip', r.where + '|' + (r.text || '(empty)') +
                    (r.note ? ' — ' + r.note : '') +
                    (r.stale ? ' — the file exists and the map tree does not know this map.' : '') +
                    (r.gone ? ' — the loaded map no longer has this event.' : ''));
                tr.addEventListener('click', function () { scriptSel = r; U.rerender(); });
            }
        });
        table.mm.paint(res.rows);

        /* One repaint for the list, so typing and toggling a chip do not
           rebuild the whole panel and take the focus out of the search box.
           The cap note is repainted with it: a row dropped by the cap has to
           be announced, or the count and the list disagree with nothing to
           notice. */
        function repaintRows() {
            res = Q.script.search(qstr('quest.script.q', ''),
                { kinds: kindFlags(), scope: qstr('quest.script.scope', 'everything') });
            table.mm.paint(res.rows);
            if (linesGroup) linesGroup.mm.tag(res.rows.length + ' of ' + res.matched);
            U.clear(capNote);
            if (res.truncated) {
                capNote.appendChild(note('stopped at ' + res.max + ' rows of ' + res.matched +
                    ' — raise the cap above if you need more', true));
            }
        }

        var chips = h('div', { class: 'mm-toolbar' });
        SCRIPT_KINDS.forEach(function (k) {
            chips.appendChild(W.chip({
                label: k.label, value: kinds[k.key], tip: k.tip || null,
                onChange: function (on) { qset('quest.script.kinds.' + k.key, on); repaintRows(); }
            }));
        });

        var scanBtn;
        if (st.phase === 'scanning') {
            scanBtn = W.button({
                label: 'cancel', wide: true, _ungated: true,
                onClick: function () { Q.script.cancel(); U.rerender(); }
            });
        } else {
            scanBtn = W.button({
                label: 'scan every map file', wide: true, _ungated: true,
                disabled: st.phase === 'unavailable',
                tip: st.phase === 'unavailable' ? 'Scan|Not available: ' + st.why : null,
                onClick: function () { Q.script.scan(function () { U.rerender(); }); U.rerender(); }
            });
        }

        var stateLine = st.phase === 'unavailable' ? 'not searched — ' + st.why
            : st.phase === 'scanning' ? 'scanning ' + st.built + ' of ' + st.maps +
                ' · ' + Math.round(st.progress * 100) + '%'
                : st.phase === 'ready' ? 'ready, ' + st.maps + ' map file(s), ' + st.rows + ' line(s)'
                    : 'not scanned yet';

        var scopeRows = res.scopes.map(function (s) {
            return h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: s.label }),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-sub mm-mono',
                    style: s.complete ? null : 'color:var(--mm-warn)',
                    text: s.complete ? 'complete' : (s.why || 'not searched')
                }));
        });

        var strippable = !!($.text && $.text._plain);

        var left = [
            W.group('Search', [
                W.search({
                    value: q, placeholder: 'any word',
                    onInput: function (v) { qset('quest.script.q', v); repaintRows(); }
                }),
                chips,
                W.row('Scope', W.dropdown({
                    options: SCOPES, value: scope, width: '118px', _ungated: true,
                    disabled: false,
                    onChange: function (v) { qset('quest.script.scope', v); U.rerender(); }
                })),
                scope === 'other maps' && st.phase !== 'ready'
                    ? note('"other maps" has nothing behind it yet — ' + stateLine, true) : null,
                W.toggleRow('strip the message codes', {
                    value: qbool('quest.script.strip', true) && strippable,
                    keybind: false, _ungated: true, disabled: !strippable,
                    tip: strippable ? null
                        : 'Strip|Not available: the Text module did not load.',
                    onChange: function (v) { qset('quest.script.strip', v); U.rerender(); }
                }),
                W.row('Max rows', W.number({
                    value: qnum('quest.script.max', 5000, 100, 50000), min: 100, max: 50000, step: 100,
                    _ungated: true, label: 'max rows',
                    onChange: function (v) { qset('quest.script.max', v); repaintRows(); }
                })),
                capNote,
                W.button({
                    label: 'copy the visible rows', wide: true, _ungated: true,
                    onClick: function () {
                        U.copyText(res.rows.map(function (r) {
                            return r.where + '\t' + r.kind + '\t' + r.text;
                        }).join('\n'));
                    }
                })
            ]),

            W.group('Other maps', [
                block('State', stateLine, st.phase === 'unavailable'),
                scanBtn,
                W.button({
                    label: 'forget the scan', wide: true, _ungated: true,
                    disabled: st.phase !== 'ready',
                    onClick: function () { Q.script.forget(); U.rerender(); }
                }),
                note(SECOND_READ)
            ], { tag: st.phase }),

            W.group('Scope of this answer', scopeRows, { tag: res.complete ? 'complete' : 'partial' })
        ];

        var detail = [];
        if (scriptSel) {
            detail.push(kv('Where', scriptSel.where));
            detail.push(kv('Kind', scriptSel.kind));
            detail.push(h('div', {
                class: 'mm-sub mm-selectable mm-breakall',
                style: 'white-space:pre-wrap;padding:4px',
                text: scriptSel.text || '(empty)'
            }));
            if (hasEscape(scriptSel.raw)) {
                detail.push(note('this is the stored text — only a text state is converted, so a \\V[n] ' +
                    'here is a reference the game resolves later'));
            }
            if (scriptSel.note) detail.push(note(scriptSel.note));
        } else {
            detail.push(note('click a row to read the whole line'));
        }

        linesGroup = W.group('Lines', [table], { grow: true, tag: res.rows.length + ' of ' + res.matched });
        repaintRows();
        var right = [linesGroup, W.group('The line', detail)];

        return cols({ narrow: true, items: left }, right);
    }

    /* =====================================================================
       PART 7 — REGISTRATION

       Blocked, Common and Script are unconditional: every project has events,
       common events and text. Quests is INFERRED and is registered only when
       the inference found something — decided from the boot scene, again when
       a game world is built, and once immediately for a database that is
       already loaded. The decision is deliberately NOT marked final when the
       answer was "nothing to group", so a plugin that reloads the database
       gets another answer out of it rather than a stale one.
       ===================================================================== */

    U.panel('world', 'Blocked', function () { return buildBlocked(); }, 130);
    U.panel('world', 'Common', function () { return buildCommon(); }, 140);
    U.panel('world', 'Script', function () { return buildScript(); }, 160);

    var questsDecided = false, questsExplained = false;

    function decide(why) {
        if (questsDecided || !dbLoaded()) return false;
        var groups = $.safe(function () { return Q.reinfer(); }, 'quest inference', null);
        if (!groups || !groups.length) {
            if (!questsExplained) {
                questsExplained = true;
                $.log('info', 'quest: ' + (Q.inferenceWhy() || FALLBACK));
            }
            // Not marked decided — a database reload gets another answer.
            return false;
        }
        questsDecided = true;
        U.panel('world', 'Quests', function () { return buildQuests(); }, 150);
        $.log('ok', 'quest ready (' + why + ') — ' + groups.length + ' group(s) inferred from this ' +
            'project\'s own switch and variable names. This is inference, and every group carries the ' +
            'sentence saying what it was inferred from.');
        $.safe(function () { U.rerender(); }, 'quest rerender');
        return true;
    }

    $.install('Scene_Boot.start (quest)',
        typeof Scene_Boot !== 'undefined' ? Scene_Boot.prototype : null, 'start',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                $.safe(function () { decide('the boot scene started'); }, 'quest decide at boot');
                return r;
            };
        },
        'Scene_Boot.start not found — the Quests panel decides when a game world is built instead');

    $.on('gameobjects', function () { decide('a game world was built'); });
    decide('the database was already loaded');

    /* ---------------------------------------------------------------------
       LIVE REFRESH

       Four new sub-tabs on a tab that already carries a dozen. The per-frame
       hook must do nothing at all unless the overlay is open AND this tab AND
       this sub-tab are the ones on screen, or the Blocked panel would rebuild
       its whole DOM sixty times a second while nobody is looking at it.
       ------------------------------------------------------------------ */
    $.onFrame('quest blocked refresh', function (frame) {
        if (!repaintBlocked) return;
        if (!U.isOpen || !U.isOpen()) return;
        if (!$.cfg.ui || $.cfg.ui.tab !== 'world') return;
        if (($.cfg.ui.sub || {}).world !== 'Blocked') return;
        var every = qnum('quest.blocked.refreshFrames', 15, 1, 600);
        if (frame % every !== 0) return;
        $.safe(repaintBlocked, 'quest blocked refresh');
    });

    /* One module-level subscription, re-pointed by each build. One per build
       would accumulate for the life of the session and every one of them would
       fire. Checked by SUB as well as by tab: World carries a dozen panels and
       refreshing one nobody is looking at rebuilds DOM on every map click. */
    $.on('event:select', function () {
        if (!repaintBlocked) return;
        if (!$.cfg.ui || $.cfg.ui.tab !== 'world') return;
        if (($.cfg.ui.sub || {}).world !== 'Blocked') return;
        $.safe(repaintBlocked, 'quest refresh on select');
    });

    /* =====================================================================
       CONSOLE API
       ===================================================================== */
    $.api.blocked = function (eventId) {
        var ev = eventId
            ? $.safe(function () { return $gameMap.event(eventId); }, 'event by id', null)
            : selectedEvent();
        if (!ev) return { why: 'no such event on the loaded map' };
        var st = Q.pageStates(ev);
        st.conditions = [];
        st.pages.forEach(function (p) { st.conditions.push(Q.conditions(ev, p.index)); });
        return st;
    };
    $.api.commons = function () { return Q.commons(); };
    $.api.quests = function () { return Q.quests(); };
    $.api.script = function (query) {
        return Q.script.search(query, { kinds: kindFlags(), scope: qstr('quest.script.scope', 'everything') });
    };

})(window.GigaHack);
