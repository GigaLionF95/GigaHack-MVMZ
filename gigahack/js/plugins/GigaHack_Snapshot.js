//=============================================================================
// GigaHack MV/MZ
// 26 · snapshot.js — what changed since the save, and between two saves
//-----------------------------------------------------------------------------
// Two questions, one machine. "What has moved since I last saved?" and "what is
// different between these two save files?" are the same diff over the same
// bounded record; the only thing that changes is where the record came from.
// So there is exactly one snapshot shape, one function that fills it, and one
// function that compares two of them — and $.snap publishes all three, because
// Trace, Auto and Quest all want to ask "what changed since the save" without
// any of them learning how a save is decoded.
//
// THE INVARIANTS THIS FILE IS BUILT AROUND. None of them is about a version.
//
//   1. A SNAPSHOT READS VALUES. IT NEVER SERIALISES THE WORLD. Both engines'
//      JsonEx._encode writes the '@' class marker onto the object it is handed
//      rather than onto a copy, and the two do not agree about cleaning it up
//      afterwards — so a "snapshot" taken with JsonEx.stringify or
//      makeDeepCopy mutates $gameSystem, $gameParty and everything under them.
//      Every field below is read out by name into a plain record whose size is
//      the project's variable count plus a fixed set, and nothing else.
//
//   2. NOTHING CALLS A METHOD ON ANYTHING THAT CAME OUT OF A SAVE. JsonEx
//      revives a class by looking its name up on `window`. When the class is
//      not in this build the lookup is undefined, no prototype is applied,
//      nothing is logged and no error is raised: the object arrives as plain
//      data with every field intact, and the first method call on it throws
//      "is not a function" somewhere far away from the read. That is why the
//      party's gold is read as `_gold` and never as `gold()`, and why an
//      actor's level is `_level` and never `level`. It is also why a section
//      whose class is missing is REPORTED as such rather than skipped — every
//      field it stored is still there and still worth comparing.
//
//   3. THE TWO ENGINES OFFER TWO DIFFERENT WAYS TO READ A SAVE WITHOUT
//      LOADING IT, and the difference is probed as a capability, never asked
//      of a version string. One storage layer is name-keyed and answers with a
//      promise; the other is id-keyed and answers synchronously with a string
//      that then goes through JsonEx as found. $.snap.readShape() says which
//      of the two this build has, or names both and stops. Neither path
//      installs anything into $game*: reading a slot is not loading it.
//
//   4. A SAVE CARRIES MORE THAN THE ENGINE WROTE. Ten top-level sections are
//      the engine's; plugins commonly extend the save contents, and comparing
//      only the ten while saying nothing about the rest is exactly the silent
//      failure this project exists to prevent. Every top-level key is listed,
//      and the ones outside the ten are marked "not compared" by name.
//
//   5. TWO CLOCKS ANSWER TWO QUESTIONS. Graphics.frameCount against a save's
//      _framesOnSave is how much the player played between two states;
//      Date.now() is how long ago an anchor was taken. $.frameCount is
//      neither — it starts at zero when the mod loads and keeps ticking while
//      the mod holds the game — so it is not used here at all.
//
//   6. THE ANCHOR IS LIVE STATE AND IS NOT PERSISTED. A five-thousand-entry
//      array written to disk on every save would be churn for something that
//      is meaningless the moment the process restarts. The panel says so
//      rather than leaving it as a gap.
//
// The save hook is a PURE PASSTHROUGH on both engines: it calls the original
// exactly once and returns the original's value untouched, so a promise stays
// a promise and a boolean stays a boolean. Where the return is a thenable it
// attaches an outcome handler WITH BOTH ARGUMENTS and still returns the
// original — a one-argument .then would leave a derived promise with no
// rejection handler, and a genuine disk failure would then surface as
// GigaHack's own unhandled rejection in the log drawer.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — what changed since the save, and between two saves
 * @author gigahack
 * @help GigaHack_Snapshot.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat. Uses Vars for verified reverts where it is present.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — snapshot not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols, clear = U.clear;

    var S = $.snap = {};

    /* =====================================================================
       SETTINGS

       Read through one helper that supplies the default when the key is
       absent, so this module works on a settings file written before it
       existed. Every key below is dotted under "snapshot.".
       ===================================================================== */
    function cfgGet(key, dflt) {
        return $.store.cfgGet('snapshot.' + key, dflt);
    }
    function cfgSet(key, value) {
        return $.store.cfgSet('snapshot.' + key, value);
    }
    function cfgNum(key, dflt, lo, hi) {
        var v = cfgGet(key, dflt);
        if (typeof v !== 'number' || v !== v || !isFinite(v)) return dflt;
        return v < lo ? lo : v > hi ? hi : v;
    }
    function cfgOn(key, dflt) {
        var v = cfgGet(key, dflt);
        return v === undefined ? !!dflt : !!v;
    }

    /* =====================================================================
       PART 1 — THE MODEL
       ===================================================================== */

    /* The ten sections both engines write, in the order both write them
       (MV rpg_managers.js:430 / MZ rmmz_managers.js:389). Everything else a
       save carries came from somewhere else and is named rather than ignored. */
    var SECTION_KEYS = ['system', 'screen', 'timer', 'switches', 'variables',
        'selfSwitches', 'actors', 'party', 'map', 'player'];

    /* What the diff walks, in table order, and which engine section each half
       of it lives in. The second entry is what "the anchor did not capture
       this" is decided from. */
    var COMPARED = [
        ['vars', 'variables', 'variables'],
        ['switches', 'switches', 'switches'],
        ['self', 'self-switches', 'selfSwitches'],
        ['gold', 'gold', 'party'],
        ['items', 'items, weapons and armors', 'party'],
        ['party', 'party roster', 'party'],
        ['actors', 'actors', 'actors'],
        ['map', 'map and position', 'map'],
        ['system', 'save count, playtime and build', 'system']
    ];

    function alive() {
        return typeof $gameVariables !== 'undefined' && $gameVariables &&
            typeof $gameSwitches !== 'undefined' && $gameSwitches &&
            typeof $dataSystem !== 'undefined' && $dataSystem && $dataSystem.variables;
    }
    S.alive = alive;

    function glob(name) {
        return $.safe(function () {
            var v = window[name];
            return (v === undefined) ? null : v;
        }, 'snapshot global ' + name, null);
    }

    function gameTitle() {
        return $.safe(function () {
            return ($dataSystem && $dataSystem.gameTitle) || '';
        }, 'snapshot game title', '');
    }

    function varNames() {
        return $.safe(function () {
            return ($dataSystem && $dataSystem.variables) || [];
        }, 'snapshot variable names', []) || [];
    }
    function switchNames() {
        return $.safe(function () {
            return ($dataSystem && $dataSystem.switches) || [];
        }, 'snapshot switch names', []) || [];
    }

    /**
     * What arrived under a section key.
     *
     * 'read'    the save named a class this build has, so the prototype is back
     * 'plain'   the save named a class this build does NOT have — every field
     *           is present, no method is, and no error was raised anywhere
     * 'missing' the section is not in the file at all
     *
     * Tested by prototype rather than by constructor NAME, because a build
     * that minifies its classes renames the constructor and would then report
     * every section as foreign.
     */
    function shapeOf(o) {
        if (o === null || o === undefined || typeof o !== 'object') return 'missing';
        var p = $.safe(function () { return Object.getPrototypeOf(o); }, 'snapshot prototype', null);
        return (p === null || p === Object.prototype) ? 'plain' : 'read';
    }

    function fieldArray(owner, key) {
        if (!owner || typeof owner !== 'object') return [];
        var a = owner[key];
        return (a && typeof a.length === 'number') ? a : [];
    }
    function fieldObject(owner, key) {
        if (!owner || typeof owner !== 'object') return {};
        var o = owner[key];
        return (o && typeof o === 'object') ? o : {};
    }
    function numOrNull(v) {
        return (typeof v === 'number' && isFinite(v)) ? v : null;
    }
    function copyCounts(src) {
        var out = {};
        if (!src || typeof src !== 'object') return out;
        Object.keys(src).forEach(function (k) {
            var n = Number(src[k]);
            if (isFinite(n) && n !== 0) out[k] = n;
        });
        return out;
    }

    /**
     * Equipment identity WITHOUT resolving it.
     *
     * Game_Item.object() maps _itemId through the LIVE database, so a save
     * written against a different build of the project would either resolve to
     * the wrong row or throw. 'weapon:14' says exactly what the save stored.
     */
    function equipText(list) {
        if (!list || typeof list.length !== 'number') return '';
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it || typeof it !== 'object') { out.push('-'); continue; }
            var cls = it._dataClass || '';
            var id = numOrNull(it._itemId);
            out.push(cls && id ? cls + ':' + id : '-');
        }
        return out.join(' ');
    }

    function idListText(list) {
        if (!list || typeof list.length !== 'number') return '';
        return Array.prototype.slice.call(list).join(',');
    }

    /**
     * One bounded record, from ten section objects.
     *
     * The same function fills a live snapshot and a file snapshot, which is
     * the whole reason the diff never has to know which side it is looking at.
     */
    function collect(contents, meta) {
        var i;
        var snap = {
            at: meta.at || Date.now(),
            origin: meta.origin || 'manual',
            side: meta.side || 'live',
            slot: (meta.slot > 0) ? Math.floor(meta.slot) : (meta.slot === 0 ? 0 : null),
            ok: meta.ok === undefined ? true : meta.ok,
            why: meta.why || '',
            label: '',
            playFrames: numOrNull(meta.playFrames),
            sections: {}, extra: [], truncated: {}, counts: {},
            v: [], vStruct: {}, s: [], self: {},
            gold: null, items: {}, weapons: {}, armors: {},
            party: [], actors: {},
            map: { mapId: null, x: null, y: null, dir: null },
            system: { saveCount: null, framesOnSave: null, versionId: null, title: meta.title || '' }
        };

        SECTION_KEYS.forEach(function (k) { snap.sections[k] = shapeOf(contents[k]); });
        Object.keys(contents).forEach(function (k) {
            if (SECTION_KEYS.indexOf(k) < 0) snap.extra.push(k);
        });

        /* Variables and switches. The upper bound is the LARGER of what the
           project defines and what the record carries: a save written by a
           build with more variables than this one holds ids past the end of
           this database, and dropping them would silently hide a real
           difference. They are kept and the row says what they are. */
        var dbV = varNames(), rawV = fieldArray(contents.variables, '_data');
        var nV = Math.max(dbV.length, rawV.length);
        for (i = 1; i < nV; i++) {
            /* A variable holding a list or an object is recorded as CAPPED
               TEXT, not as the reference. Keeping the reference would alias
               the baseline to the live object — mutate the array in place and
               the anchor silently mutates with it, so a real change becomes
               invisible — and it would let one variable holding a large
               structure make the snapshot unbounded. The row says which
               values were compared this way. */
            if (structured(rawV[i])) { snap.v[i] = textOf(rawV[i]); snap.vStruct[i] = true; }
            else snap.v[i] = rawV[i];
        }
        snap.counts.vars = Math.max(0, nV - 1);
        snap.counts.structured = Object.keys(snap.vStruct).length;

        var dbS = switchNames(), rawS = fieldArray(contents.switches, '_data');
        var nS = Math.max(dbS.length, rawS.length);
        for (i = 1; i < nS; i++) snap.s[i] = !!rawS[i];
        snap.counts.switches = Math.max(0, nS - 1);

        /* Self-switches are a PRESENCE map: setValue deletes on false, so the
           record holds only the ones that are on and its size is the number of
           set self-switches, not the number of events in the project. */
        var selfRaw = fieldObject(contents.selfSwitches, '_data');
        var selfKeys = Object.keys(selfRaw);
        var selfCap = cfgNum('selfMax', 20000, 100, 1000000);
        if (selfKeys.length > selfCap) {
            snap.truncated.self = selfKeys.length;
            selfKeys = selfKeys.slice(0, selfCap);
        }
        for (i = 0; i < selfKeys.length; i++) {
            if (selfRaw[selfKeys[i]]) snap.self[selfKeys[i]] = true;
        }
        snap.counts.self = Object.keys(snap.self).length;

        var party = contents.party;
        snap.gold = numOrNull(party && party._gold);
        snap.items = copyCounts(party && party._items);
        snap.weapons = copyCounts(party && party._weapons);
        snap.armors = copyCounts(party && party._armors);
        snap.party = (party && party._actors && typeof party._actors.length === 'number')
            ? Array.prototype.slice.call(party._actors) : [];
        snap.counts.items = Object.keys(snap.items).length + Object.keys(snap.weapons).length +
            Object.keys(snap.armors).length;

        /* $gameActors._data holds every actor ever instantiated, not the
           party, and on a game with a large cast it carries every equip, skill
           list and state array under each. A fixed field set and a cap: a
           snapshot that walked the actor graph would be larger than the save
           it came from. */
        var rawA = fieldArray(contents.actors, '_data');
        var actorCap = cfgNum('actorMax', 200, 1, 100000);
        var kept = 0;
        for (i = 1; i < rawA.length; i++) {
            var a = rawA[i];
            if (!a || typeof a !== 'object') continue;
            if (kept >= actorCap) { snap.truncated.actors = rawA.length; break; }
            kept++;
            snap.actors[i] = {
                level: numOrNull(a._level),
                classId: numOrNull(a._classId),
                exp: (a._exp && a._classId != null) ? numOrNull(a._exp[a._classId]) : null,
                hp: numOrNull(a._hp), mp: numOrNull(a._mp), tp: numOrNull(a._tp),
                name: typeof a._name === 'string' ? a._name : '',
                skills: idListText(a._skills),
                states: idListText(a._states),
                equips: equipText(a._equips)
            };
        }
        snap.counts.actors = kept;

        snap.map.mapId = numOrNull(contents.map && contents.map._mapId);
        snap.map.x = numOrNull(contents.player && contents.player._x);
        snap.map.y = numOrNull(contents.player && contents.player._y);
        /* _direction, not direction(): a save's player is exactly the object
           rule 2 is about, and both engines set the field in initMembers. */
        snap.map.dir = numOrNull(contents.player && contents.player._direction);

        var sys = contents.system;
        snap.system.saveCount = numOrNull(sys && sys._saveCount);
        snap.system.framesOnSave = numOrNull(sys && sys._framesOnSave);
        snap.system.versionId = numOrNull(sys && sys._versionId);

        if (snap.playFrames === null) snap.playFrames = snap.system.framesOnSave;
        snap.label = labelOf(snap);
        return snap;
    }

    function labelOf(snap) {
        if (snap.side === 'file') return 'slot ' + snap.slot;
        if (snap.origin === 'save') return 'save to slot ' + snap.slot;
        if (snap.origin === 'load') {
            return snap.slot ? 'loaded the state saved to slot ' + snap.slot : 'loaded a save';
        }
        if (snap.origin === 'new game') return 'new game';
        if (snap.origin === 'live') return 'live now';
        return 'anchored by hand';
    }

    /** The ten live globals, under the names the engine's own save uses. */
    function liveContents() {
        return {
            system: glob('$gameSystem'), screen: glob('$gameScreen'), timer: glob('$gameTimer'),
            switches: glob('$gameSwitches'), variables: glob('$gameVariables'),
            selfSwitches: glob('$gameSelfSwitches'), actors: glob('$gameActors'),
            party: glob('$gameParty'), map: glob('$gameMap'), player: glob('$gamePlayer')
        };
    }

    function frameCountNow() {
        return $.safe(function () {
            return (typeof Graphics !== 'undefined' && typeof Graphics.frameCount === 'number')
                ? Graphics.frameCount : null;
        }, 'snapshot frame count', null);
    }

    /**
     * A bounded snapshot of the live game.
     *
     * opts { origin, slot, ok, why }. Never null-checks its way into a partial
     * record: a global that is not there is reported as a missing section and
     * the diff says so, which is the honest answer before a game has started.
     */
    S.take = function (opts) {
        opts = opts || {};
        return $.safe(function () {
            return collect(liveContents(), {
                origin: opts.origin || 'manual',
                slot: opts.slot, ok: opts.ok, why: opts.why,
                side: 'live', title: gameTitle(),
                playFrames: frameCountNow()
            });
        }, 'snapshot.take', null);
    };

    /* ---------------------------------------------------------- read shape
       Which way this build lets a save be read WITHOUT loading it, probed as
       a capability. Never the engine's name: a plugin that installs one of
       these on the other engine is a build that can do it, and a plugin that
       removes one is a build that cannot, whatever the version says.
       ------------------------------------------------------------------ */
    var NO_READ_WHY =
        'a save cannot be read without loading it on this build. StorageManager offers neither a ' +
        'name-keyed loadObject() paired with DataManager.makeSavename(), nor an id-keyed load(). ' +
        'Debug → Environment lists what was found. Nothing on this panel can run.';

    S.readShape = function () {
        var hasObject = $.caps._hasFn('StorageManager.loadObject') &&
            $.caps._hasFn('DataManager.makeSavename');
        if (hasObject) {
            return { mode: 'object', why: '', text: 'name-keyed, answers with a promise' };
        }
        if ($.caps._hasFn('StorageManager.load')) {
            return { mode: 'json', why: '', text: 'id-keyed, answers synchronously' };
        }
        return { mode: null, why: NO_READ_WHY, text: 'neither shape is present' };
    };

    S.available = function () { return !!S.readShape().mode; };
    S.reason = function () { var r = S.readShape(); return r.mode ? null : r.why; };

    S.maxSlots = function () {
        return $.safe(function () { return DataManager.maxSavefiles(); }, 'snapshot maxSavefiles', 20) || 20;
    };

    /**
     * Is there anything in this slot.
     *
     * Through DataManager.savefileExists, which takes a numeric id on BOTH
     * engines. StorageManager.exists has the same name on both and a different
     * parameter type — a numeric id on one, a save NAME on the other — so
     * calling it with an id returns false for every slot that exists and the
     * panel reports an empty save folder on a game full of saves.
     */
    function slotExists(id) {
        if (!$.caps._hasFn('DataManager.savefileExists')) return true;
        return !!$.safe(function () { return DataManager.savefileExists(id); }, 'savefileExists', false);
    }
    S.slotExists = slotExists;

    /**
     * One slot, as a snapshot. `done(snapshot|null, why)` fires exactly once
     * on either engine — the same shape $.eng.saveGame normalises save into.
     *
     * Nothing here is installed into $game*: this reads a file, it does not
     * load it. The parsed contents object of a large save IS the whole game
     * state, so it is dropped in the same statement the snapshot is taken in.
     */
    S.fromSlot = function (id, done) {
        var fired = false;
        function finish(snap, why) {
            if (fired) return;
            fired = true;
            $.safe(function () { done(snap, why || ''); }, 'snapshot.fromSlot callback');
        }

        var shape = S.readShape();
        if (!shape.mode) return finish(null, shape.why);

        id = Math.floor(Number(id) || 0);
        if (!(id >= 0)) return finish(null, 'slot ' + id + ' is not a slot this build has.');
        if (!slotExists(id)) return finish(null, 'slot ' + id + ' is empty.');

        var title = $.safe(function () {
            var info = $.eng.savefileInfo(id);
            return (info && info.title) || '';
        }, 'snapshot slot title', '');

        function fromContents(contents) {
            if (!contents || typeof contents !== 'object') {
                finish(null, 'slot ' + id + ' is empty.');
                return;
            }
            var snap = $.safe(function () {
                return collect(contents, { origin: 'slot', slot: id, side: 'file', title: title });
            }, 'snapshot from slot ' + id, null);
            contents = null;                 // the whole game state; do not hold it
            if (!snap) { finish(null, 'slot ' + id + ' could not be turned into a snapshot — see the log.'); return; }
            finish(snap, '');
        }

        if (shape.mode === 'json') {
            /* The storage layer AS FOUND, then JsonEx AS FOUND. A plugin that
               replaced the encoder writes references plain JSON.parse cannot
               read, and both are commonly aliased to relocate or re-encode a
               save — so neither is cached and neither is reimplemented. */
            var json = $.safe(function () { return StorageManager.load(id); }, 'snapshot storage load', null);
            /* A missing file is `null` here and a rejection on the other
               engine. Two silent shapes for one condition, normalised before
               anything reads a section off the result. */
            if (json === null || json === undefined || json === '') return finish(null, 'slot ' + id + ' is empty.');
            var parsed = $.safe(function () { return JsonEx.parse(json); }, 'snapshot decode slot ' + id, null);
            json = null;
            if (parsed === null || parsed === undefined) return finish(null, 'slot ' + id + ' is empty.');
            fromContents(parsed);
            return;
        }

        var p = $.safe(function () {
            return StorageManager.loadObject(DataManager.makeSavename(id));
        }, 'snapshot storage loadObject', null);
        if (!p || typeof p.then !== 'function') {
            return finish(null, 'the storage layer did not answer with a promise for slot ' + id +
                ', so there is nothing to wait on. Something has replaced loadObject with a different shape.');
        }
        p.then(function (contents) { fromContents(contents); },
            function (e) {
                finish(null, 'slot ' + id + ' could not be read — ' +
                    ((e && e.message) ? e.message : String(e)));
            });
    };

    /* ------------------------------------------------------------- anchor */
    var anchor = null;

    S.anchor = function () { return anchor; };
    S.setAnchor = function (snap) {
        if (snap) anchor = snap;
        return anchor;
    };
    S.clearAnchor = function () { anchor = null; return null; };

    S.anchorWhy = function () {
        if (anchor) return '';
        if (!alive()) return 'there is no game world yet, so there is nothing to take a baseline of.';
        var hk = $.hooks['DataManager.saveGame (anchor)'];
        if (hk && !hk.installed) return hk.reason;
        if (!cfgOn('autoAnchor', true)) {
            return 'automatic anchoring is off and none has been placed by hand. Press "anchor here".';
        }
        return 'nothing has been saved, loaded or started since GigaHack loaded. ' +
            'Press "anchor here" to place a baseline now.';
    };

    /* ------------------------------------------------------- what is not
       Written down, not left in a comment: a panel that lists what it does
       not compare is the difference between "nothing changed" and "nothing
       I look at changed". */
    S.sections = function () {
        return COMPARED.map(function (r) { return r[1]; });
    };

    S.notCompared = function () {
        var out = [
            'the screen — tint, weather, shake, zoom and the picture slots',
            'the timer',
            'event pages, move routes and running interpreters',
            'the message queue and the troop — the engine puts neither in a save',
            'a variable holding a list or an object is compared as text, not field by field'
        ];
        var cap = cfgNum('actorMax', 200, 1, 100000);
        out.push('actors past the first ' + cap + ' — raise snapshot.actorMax in the settings file');
        out.push('anything a plugin added to the save — those are listed by name on Debug → Compare');
        return out;
    };

    /* =====================================================================
       PART 1b — THE DIFF
       ===================================================================== */

    var TEXT_CAP = 400;

    function structured(v) { return v !== null && typeof v === 'object'; }

    function textOf(v) {
        if (v === null || v === undefined) return '';
        if (!structured(v)) return String(v);
        var t = $.safe(function () { return JSON.stringify(v); }, 'snapshot value text', null);
        if (typeof t !== 'string') return '[unreadable]';
        return t.length > TEXT_CAP ? t.slice(0, TEXT_CAP) + '…' : t;
    }

    /**
     * Two stored variable values, compared the way the engine reads them.
     *
     * setValue floors NUMBERS and stores everything else verbatim, so a
     * project can park an array or an object in a variable. Comparing those
     * with !== gives a false difference on every repaint when both sides are
     * live and always when they came from separate parses, so a structured
     * value is compared by capped text and the row says which was used.
     * Primitives go through the Variables module's own equality, which already
     * knows that '', null, false and 0 all read back as 0.
     */
    function sameVar(a, b) {
        if (structured(a) || structured(b)) return textOf(a) === textOf(b);
        if ($.vars && $.vars.sameValue) return $.vars.sameValue(a, b);
        return a === b || (!a && !b);
    }

    function varDisplay(v) {
        if (structured(v)) return textOf(v);
        return String(v === undefined ? 0 : v);
    }

    var KIND_RANK = {
        'section': 0, 'var': 1, 'switch': 2, 'self': 3, 'gold': 4,
        'item': 5, 'weapon': 6, 'armor': 7, 'party': 8, 'actor': 9,
        'map': 10, 'system': 11
    };
    function kindRank(r) {
        var n = KIND_RANK[r.kind];
        return n === undefined ? 99 : n;
    }

    var SHOW_OF_KIND = {
        'var': 'vars', 'switch': 'switches', 'self': 'self', 'gold': 'gold',
        'item': 'items', 'weapon': 'items', 'armor': 'items',
        'party': 'party', 'actor': 'actors', 'map': 'map', 'system': 'system'
    };

    function dbName(table, id) {
        return $.safe(function () {
            var t = window[table];
            var row = t && t[id];
            return (row && row.name) ? String(row.name) : '';
        }, 'snapshot name ' + table, '');
    }

    /**
     * A self-switch key names a map and an event, and both are resolved LIVE
     * — never from the index, and never from the save. A key whose map is not
     * the loaded one cannot name its event, because no other map's events
     * exist right now, and the row says that rather than inventing a name.
     */
    function selfName(key) {
        var parts = String(key).split(',');
        var mapId = Number(parts[0]), evId = Number(parts[1]), letter = parts[2] || '';
        var mapName = $.safe(function () {
            if (typeof $dataMapInfos === 'undefined' || !$dataMapInfos) return '';
            var info = $dataMapInfos[mapId];
            return (info && info.name) ? String(info.name) : '';
        }, 'snapshot map name', '');
        var evName = $.safe(function () {
            if (typeof $gameMap === 'undefined' || !$gameMap || $gameMap.mapId() !== mapId) return '';
            if (typeof $dataMap === 'undefined' || !$dataMap || !$dataMap.events) return '';
            var e = $dataMap.events[evId];
            return (e && e.name) ? String(e.name) : '';
        }, 'snapshot event name', '');
        var out = (mapName || ('map ' + mapId)) + ' · ' + (evName || ('event ' + evId));
        return out + ' · ' + letter;
    }

    function pushRow(rows, r) {
        r.note = r.note || '';
        r.name = r.name || '';
        r.from = r.from === undefined ? '' : String(r.from);
        r.to = r.to === undefined ? '' : String(r.to);
        r.revertable = !!r.revertable;
        rows.push(r);
        return r;
    }

    /**
     * Every difference between two snapshots.
     *
     * opts { only: {showKey: bool}, revert: bool }. `only` is the panel's
     * chip state; `revert` says whether the B side is the running game, which
     * is the only side a value can be written back into.
     */
    S.diff = function (a, b, opts) {
        var rows = [];
        if (!a || !b) return rows;
        opts = opts || {};
        var only = opts.only || null;
        var canRevert = !!opts.revert && !!$.vars;
        function on(key) { return !only || only[key] !== false; }

        return $.safe(function () {
            var i, k, keys;

            /* Sections first: a section that arrived as plain data, or is not
               in one of the files at all, changes what every row under it is
               worth and has to be said before the rows are believed. */
            SECTION_KEYS.forEach(function (key) {
                if (a.sections[key] === b.sections[key]) return;
                pushRow(rows, {
                    kind: 'section', key: 'section:' + key, id: null, name: key,
                    from: a.sections[key], to: b.sections[key],
                    note: (a.sections[key] === 'plain' || b.sections[key] === 'plain')
                        ? 'arrived as plain data — the class this save names is not in this build'
                        : 'this section is not in both files'
                });
            });

            if (on('vars')) {
                var dbV = varNames();
                var nV = Math.max(a.v.length, b.v.length);
                for (i = 1; i < nV; i++) {
                    var sa = !!a.vStruct[i], sb = !!b.vStruct[i];
                    var asText = sa || sb;
                    if (asText ? (sa === sb && a.v[i] === b.v[i]) : sameVar(a.v[i], b.v[i])) continue;
                    pushRow(rows, {
                        kind: 'var', key: 'var:' + i, id: i,
                        name: (dbV[i] || '') || '(unnamed)',
                        from: varDisplay(a.v[i]), to: varDisplay(b.v[i]),
                        fromRaw: a.v[i], toRaw: b.v[i],
                        named: !!dbV[i],
                        note: asText ? 'compared as text — this variable holds a list or an object' :
                            (i >= dbV.length ? 'past the end of what this project defines' : ''),
                        revertable: canRevert && !asText && i < dbV.length,
                        jump: 'Variables'
                    });
                }
            }

            if (on('switches')) {
                var dbS = switchNames();
                var nS = Math.max(a.s.length, b.s.length);
                for (i = 1; i < nS; i++) {
                    if (!!a.s[i] === !!b.s[i]) continue;
                    pushRow(rows, {
                        kind: 'switch', key: 'switch:' + i, id: i,
                        name: (dbS[i] || '') || '(unnamed)',
                        from: a.s[i] ? 'ON' : 'off', to: b.s[i] ? 'ON' : 'off',
                        fromRaw: !!a.s[i], toRaw: !!b.s[i],
                        named: !!dbS[i],
                        note: i >= dbS.length ? 'past the end of what this project defines' : '',
                        revertable: canRevert && i < dbS.length,
                        jump: 'Switches'
                    });
                }
            }

            if (on('self')) {
                /* A presence diff, because the engine stores only the ones
                   that are on: setValue DELETES the key on false. */
                var seen = {};
                keys = Object.keys(a.self).concat(Object.keys(b.self));
                for (i = 0; i < keys.length; i++) {
                    k = keys[i];
                    if (seen[k]) continue;
                    seen[k] = true;
                    var wasOn = !!a.self[k], isOn = !!b.self[k];
                    if (wasOn === isOn) continue;
                    pushRow(rows, {
                        kind: 'self', key: 'self:' + k, id: Number(String(k).split(',')[1]) || 0,
                        name: selfName(k),
                        from: wasOn ? 'ON' : 'off', to: isOn ? 'ON' : 'off',
                        note: '', jump: 'Self'
                    });
                }
            }

            if (on('gold') && a.gold !== b.gold) {
                pushRow(rows, {
                    kind: 'gold', key: 'gold', id: null, name: 'gold',
                    from: a.gold === null ? '—' : a.gold,
                    to: b.gold === null ? '—' : b.gold,
                    delta: (a.gold === null || b.gold === null) ? null : (b.gold - a.gold)
                });
            }

            if (on('items')) {
                diffCounts(rows, 'item', '$dataItems', a.items, b.items);
                diffCounts(rows, 'weapon', '$dataWeapons', a.weapons, b.weapons);
                diffCounts(rows, 'armor', '$dataArmors', a.armors, b.armors);
            }

            if (on('party')) {
                var was = {}, now = {};
                for (i = 0; i < a.party.length; i++) was[a.party[i]] = true;
                for (i = 0; i < b.party.length; i++) now[b.party[i]] = true;
                keys = Object.keys(was).concat(Object.keys(now));
                var seenP = {};
                for (i = 0; i < keys.length; i++) {
                    k = keys[i];
                    if (seenP[k]) continue;
                    seenP[k] = true;
                    if (!!was[k] === !!now[k]) continue;
                    pushRow(rows, {
                        kind: 'party', key: 'party:' + k, id: Number(k),
                        name: dbName('$dataActors', Number(k)) || ('actor ' + k),
                        from: was[k] ? 'in the party' : '—',
                        to: now[k] ? 'in the party' : '—'
                    });
                }
            }

            if (on('actors')) diffActors(rows, a, b);

            if (on('map')) {
                if (a.map.mapId !== b.map.mapId) {
                    pushRow(rows, {
                        kind: 'map', key: 'map:id', id: b.map.mapId, name: 'map',
                        from: mapLabel(a.map.mapId), to: mapLabel(b.map.mapId)
                    });
                }
                if (a.map.x !== b.map.x || a.map.y !== b.map.y) {
                    pushRow(rows, {
                        kind: 'map', key: 'map:pos', id: null, name: 'position',
                        from: pos(a.map), to: pos(b.map)
                    });
                }
                if (a.map.dir !== b.map.dir) {
                    pushRow(rows, {
                        kind: 'map', key: 'map:dir', id: null, name: 'facing',
                        from: facing(a.map.dir), to: facing(b.map.dir)
                    });
                }
            }

            if (on('system')) {
                if (a.system.saveCount !== b.system.saveCount) {
                    pushRow(rows, {
                        kind: 'system', key: 'sys:saves', id: null, name: 'times saved',
                        from: a.system.saveCount, to: b.system.saveCount,
                        delta: (a.system.saveCount === null || b.system.saveCount === null)
                            ? null : (b.system.saveCount - a.system.saveCount)
                    });
                }
                if (a.playFrames !== b.playFrames) {
                    pushRow(rows, {
                        kind: 'system', key: 'sys:play', id: null, name: 'playtime',
                        from: framesText(a.playFrames), to: framesText(b.playFrames),
                        note: 'counted in frames, not wall clock'
                    });
                }
                if (a.system.versionId !== b.system.versionId) {
                    pushRow(rows, {
                        kind: 'system', key: 'sys:version', id: null, name: 'project build',
                        from: a.system.versionId, to: b.system.versionId,
                        note: 'these two states were written by different builds of the project'
                    });
                }
            }

            return rows;
        }, 'snapshot.diff', rows);
    };

    function diffCounts(rows, kind, table, before, after) {
        var seen = {};
        var keys = Object.keys(before).concat(Object.keys(after));
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (seen[k]) continue;
            seen[k] = true;
            var was = before[k] || 0, now = after[k] || 0;
            if (was === now) continue;
            var id = Number(k);
            var name = dbName(table, id);
            pushRow(rows, {
                kind: kind, key: kind + ':' + k, id: id,
                name: name || (kind + ' ' + k),
                from: was, to: now, delta: now - was,
                /* A save can name an id this build no longer defines — the
                   engine's own item lists map ids straight through $data* with
                   no guard, so the row is kept and marked rather than dropped. */
                note: name ? '' : 'this build does not define this id'
            });
        }
    }

    var ACTOR_FIELDS = [
        ['level', 'level'], ['classId', 'class'], ['exp', 'experience'],
        ['hp', 'HP'], ['mp', 'MP'], ['tp', 'TP'], ['name', 'name'],
        ['skills', 'skills'], ['states', 'states'], ['equips', 'equipment']
    ];

    function diffActors(rows, a, b) {
        var seen = {};
        var ids = Object.keys(a.actors).concat(Object.keys(b.actors));
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (seen[id]) continue;
            seen[id] = true;
            var x = a.actors[id], y = b.actors[id];
            var who = dbName('$dataActors', Number(id)) || ('actor ' + id);
            if (!x || !y) {
                pushRow(rows, {
                    kind: 'actor', key: 'actor:' + id, id: Number(id), name: who,
                    from: x ? 'present' : '—', to: y ? 'present' : '—',
                    note: 'this actor exists on only one side'
                });
                continue;
            }
            for (var f = 0; f < ACTOR_FIELDS.length; f++) {
                var key = ACTOR_FIELDS[f][0], label = ACTOR_FIELDS[f][1];
                if (x[key] === y[key]) continue;
                pushRow(rows, {
                    kind: 'actor', key: 'actor:' + id + ':' + key, id: Number(id),
                    name: who + ' · ' + label,
                    from: x[key] === null || x[key] === '' ? '—' : x[key],
                    to: y[key] === null || y[key] === '' ? '—' : y[key],
                    delta: (typeof x[key] === 'number' && typeof y[key] === 'number') ? (y[key] - x[key]) : null,
                    note: (key === 'skills' || key === 'states' || key === 'equips')
                        ? 'compared as the list of ids the save stored' : ''
                });
            }
        }
    }

    function mapLabel(id) {
        if (id === null) return '—';
        var n = $.safe(function () {
            if (typeof $dataMapInfos === 'undefined' || !$dataMapInfos) return '';
            var info = $dataMapInfos[id];
            return (info && info.name) ? String(info.name) : '';
        }, 'snapshot map label', '');
        return n ? (n + ' (' + id + ')') : String(id);
    }
    function pos(m) {
        if (m.x === null && m.y === null) return '—';
        return m.x + ',' + m.y;
    }
    function facing(d) {
        if (d === null) return '—';
        if (d === 2) return 'down';
        if (d === 4) return 'left';
        if (d === 6) return 'right';
        if (d === 8) return 'up';
        return String(d);
    }

    function p2(n) { return (n < 10 ? '0' : '') + n; }
    function framesText(frames) {
        if (typeof frames !== 'number' || !isFinite(frames)) return '—';
        var t = Math.floor(frames / 60);
        return p2(Math.floor(t / 3600)) + ':' + p2(Math.floor(t / 60) % 60) + ':' + p2(t % 60);
    }
    function playGap(a, b) {
        if (typeof a !== 'number' || typeof b !== 'number') return '';
        var secs = Math.round((b - a) / 60);
        if (secs === 0) return 'no play between them';
        var neg = secs < 0;
        secs = Math.abs(secs);
        var txt = secs < 60 ? secs + ' seconds'
            : secs < 3600 ? Math.round(secs / 60) + ' minutes'
                : (secs / 3600).toFixed(1) + ' hours';
        return neg ? txt + ' of play BEFORE it' : txt + ' of play between them';
    }

    /* ------------------------------------------------------------ sorting
       Every comparator below is a TOTAL order. Array#sort is not stable on
       the browser floor this mod targets, so two rows that compare equal come
       back in an order nothing decided — which is a table that reshuffles
       itself as you watch it. */
    function magnitude(r) {
        if (typeof r.delta === 'number' && isFinite(r.delta)) return Math.abs(r.delta);
        var x = Number(r.fromRaw), y = Number(r.toRaw);
        if (isFinite(x) && isFinite(y)) return Math.abs(y - x);
        return 0;
    }
    function sortRows(rows, mode) {
        var out = rows.slice();
        if (mode === 'by kind') {
            out.sort(function (x, y) {
                return (kindRank(x) - kindRank(y)) || ((x.id || 0) - (y.id || 0)) ||
                    (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
            });
        } else if (mode === 'by size of change') {
            out.sort(function (x, y) {
                return (magnitude(y) - magnitude(x)) || (kindRank(x) - kindRank(y)) ||
                    ((x.id || 0) - (y.id || 0)) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
            });
        } else {
            out.sort(function (x, y) {
                return ((x.id || 0) - (y.id || 0)) || (kindRank(x) - kindRank(y)) ||
                    (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
            });
        }
        return out;
    }

    /* =====================================================================
       PART 2 — HOOKS

       Three, all on DataManager, all present on both engines with identical
       bodies. Each label is unique: two modules that wrap the same method with
       the same label collide in $.hooks and the module report loses one of
       them, which is how a hook that never installed becomes invisible.
       ===================================================================== */

    function hasAutosaveSlot() {
        return !!($.caps._hasFn && $.caps._hasFn('Game_System.prototype.isAutosaveEnabled'));
    }
    S.hasAutosaveSlot = hasAutosaveSlot;

    /**
     * Should a write to this slot move the baseline.
     *
     * The autosave guard is the important half. On a build that has an
     * autosave slot, the engine writes it from a scene's own update, mid-scene
     * and unprompted — so an unguarded hook re-anchors during the very
     * cutscene this panel exists to explain, and the diff comes back empty for
     * a reason nothing on screen accounts for. Asked as a capability, and off
     * by default.
     */
    function shouldAnchorOnSave(id) {
        if (!cfgOn('autoAnchor', true)) return false;
        if (Math.floor(Number(id) || 0) === 0 && hasAutosaveSlot() && !cfgOn('anchorOnAutosave', false)) {
            return false;
        }
        return true;
    }
    S.shouldAnchorOnSave = shouldAnchorOnSave;

    function markOutcome(snap, ok, why) {
        if (!snap) return;
        snap.ok = !!ok;
        snap.why = why || '';
    }

    /**
     * The baseline follows the save.
     *
     * The one function every save on either engine goes through, and the only
     * place the slot id is known. The baseline is taken BEFORE the original,
     * because makeSaveContents() runs inside it — so what is anchored is
     * exactly the state the file is about to receive.
     *
     * PURE PASSTHROUGH. The original is called exactly once and its value is
     * returned untouched, so the calling scene awaits what it always awaited.
     * Where that value is a thenable, BOTH handlers are attached — a
     * one-argument .then would leave a derived promise with no rejection
     * handler, and a genuine disk failure would then be reported as GigaHack's
     * own unhandled rejection.
     */
    $.install('DataManager.saveGame (anchor)',
        typeof DataManager !== 'undefined' ? DataManager : null, 'saveGame',
        function (original) {
            return function (savefileId) {
                var pre = null;
                if (shouldAnchorOnSave(savefileId)) {
                    pre = $.safe(function () {
                        return S.take({ origin: 'save', slot: savefileId, ok: null });
                    }, 'anchor before save', null);
                }

                var r = original.apply(this, arguments);

                /* The engine has just rewritten the index the Compare panel
                   lists. That cache invalidates on Graphics.frameCount, which
                   stops advancing while the mod holds the game — so it has to
                   be dropped here rather than waited out. */
                $.safe(function () { if ($.eng && $.eng.invalidateSaveInfo) $.eng.invalidateSaveInfo(); },
                    'invalidate save info');

                if (pre) {
                    S.setAnchor(pre);
                    if (r && typeof r.then === 'function') {
                        pre.ok = null;
                        pre.why = 'the engine has not answered yet';
                        r.then(function () { markOutcome(pre, true, ''); },
                            function (e) {
                                markOutcome(pre, false, 'the engine reported the save failed — ' +
                                    ((e && e.message) ? e.message : String(e)));
                            });
                    } else {
                        markOutcome(pre, r !== false,
                            r === false ? 'the engine reported the save failed' : '');
                    }
                    $.emit('snapshot:anchor', pre);
                }
                return r;                    // not the derived promise
            };
        },
        'DataManager.saveGame is absent on this build, so the baseline cannot follow a save. ' +
        'Use "anchor here" in World → Since Save to place one by hand.');

    /**
     * The baseline follows a load.
     *
     * Re-anchored AFTER the original, from the globals the load has just
     * installed — so "since save" after loading a slot means "since the state
     * in that slot". Anchoring before would read the blanked globals
     * createGameObjects() put there a moment earlier.
     *
     * This module loads after the one that scrubs forged rows a save names but
     * this install can no longer resolve, so this wrapper is the OUTER one and
     * the baseline is taken after that scrub. The other way round, every load
     * would report phantom item changes for rows that were about to be
     * removed.
     */
    $.install('DataManager.extractSaveContents (anchor)',
        typeof DataManager !== 'undefined' ? DataManager : null, 'extractSaveContents',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                if (cfgOn('autoAnchor', true)) {
                    $.safe(function () {
                        var snap = S.take({ origin: 'load', slot: savedSlotOf(), ok: true });
                        S.setAnchor(snap);
                        $.emit('snapshot:anchor', snap);
                    }, 'anchor after load');
                }
                return r;
            };
        },
        'DataManager.extractSaveContents is absent on this build, so the baseline will not follow a ' +
        'load — it keeps whatever was anchored before.');

    /**
     * Which slot the state that was just installed was SAVED to.
     *
     * Not "which slot you loaded": neither engine passes the id down into
     * extractSaveContents, and the field the engine sets for its own use is
     * still the previous slot at that moment. Where the build keeps a
     * per-session savefile id on Game_System, it came out of the save and is
     * the slot that state was written to, which is the honest thing to call
     * it. Where it does not, the answer is nothing and the panel says so.
     */
    function savedSlotOf() {
        return $.safe(function () {
            if (typeof $gameSystem === 'undefined' || !$gameSystem) return null;
            var id = $gameSystem._savefileId;
            return (typeof id === 'number' && id > 0) ? id : null;
        }, 'snapshot saved slot', null);
    }

    /** A new game starts from a real baseline rather than from nothing. */
    $.install('DataManager.setupNewGame (anchor)',
        typeof DataManager !== 'undefined' ? DataManager : null, 'setupNewGame',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                if (cfgOn('autoAnchor', true)) {
                    $.safe(function () {
                        var snap = S.take({ origin: 'new game', ok: true });
                        S.setAnchor(snap);
                        $.emit('snapshot:anchor', snap);
                    }, 'anchor on new game');
                }
                return r;
            };
        },
        'DataManager.setupNewGame is absent on this build, so starting a new game will not re-anchor ' +
        'the baseline; it stays on whatever was anchored before.');

    /** True when something has aliased a hooked method on top of ours. */
    function overpatched(label) {
        var list = $.safe(function () {
            return ($.compat && $.compat.aliasIntegrity) ? $.compat.aliasIntegrity() : [];
        }, 'snapshot alias integrity', []) || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === label && list[i].state === 'overpatched') return true;
        }
        return false;
    }

    /* =====================================================================
       PART 3 — SHARED PANEL PARTS
       ===================================================================== */
    var ROW_H = 17;

    function agoText(ms) {
        var s = (Date.now() - ms) / 1000;
        return s < 1 ? 'just now' : ago(ms) + ' ago';
    }

    function ago(ms) {
        var s = (Date.now() - ms) / 1000;
        if (s < 1) return 'now';
        if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + 's';
        if (s < 3600) return Math.floor(s / 60) + 'm';
        return Math.floor(s / 3600) + 'h';
    }

    function stamp(ms) {
        if (!ms) return '—';
        return $.safe(function () {
            var d = new Date(ms);
            return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
        }, 'snapshot stamp', '—');
    }

    /**
     * Label on the left, value on the right — and the value here is always
     * unbounded: a project's own name for a slot, a joined list, a reason. The
     * edge must be allowed to shrink and wrap or it pushes the label out of
     * the row and is then clipped by the column, and neither half can be read.
     */
    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: label }),
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-selectable mm-breakall',
                text: String(value)
            }));
    }

    function note(text, warn) {
        return h('div', {
            class: 'mm-sub',
            style: 'padding:2px;white-space:normal' + (warn ? ';color:var(--mm-warn)' : ''),
            text: text
        });
    }

    function noWorld() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'no game world yet' }),
                h('div', { text: 'start or load a game, then reopen this tab' })));
    }

    function degradedFor(control) {
        return !!($.compat && $.compat.isDegraded && $.compat.isDegraded(control));
    }
    function degradedWhy(control) {
        return ($.compat && $.compat.degradedWhy && $.compat.degradedWhy(control)) || '';
    }

    /**
     * A control whose writes do not stick is MARKED, never hidden: the cause
     * may have gone away, and the only way to find out is to let the user try.
     */
    function degradeNote(control) {
        if (!degradedFor(control)) return null;
        return h('div', { class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px' },
            h('b', { text: 'writes here are not sticking. ' }),
            degradedWhy(control) + ' ',
            W.button({
                label: 'try again', mini: true, _ungated: true,
                tip: 'Try again|Clears the mark; the next write is re-tested.',
                onClick: function () {
                    if ($.compat && $.compat.clearDegraded) $.compat.clearDegraded(control);
                    U.rerender();
                }
            }));
    }

    function showMap() {
        var m = {};
        COMPARED.forEach(function (row) { m[row[0]] = cfgOn('show.' + row[0], true); });
        return m;
    }

    function filterRows(rows, q, namedOnly) {
        var out = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (namedOnly && (r.kind === 'var' || r.kind === 'switch') && !r.named) continue;
            if (q) {
                var hay = (r.name + ' ' + (r.id === null ? '' : r.id) + ' ' + r.from + ' ' + r.to +
                    ' ' + r.kind + ' ' + r.note).toLowerCase();
                if (hay.indexOf(q) === -1) continue;
            }
            out.push(r);
        }
        return out;
    }

    function diffText(rows, aLabel, bLabel) {
        var lines = [aLabel + '  →  ' + bLabel, rows.length + ' change(s)', ''];
        rows.forEach(function (r) {
            lines.push([r.kind, r.id === null ? '' : r.id, r.name, r.from, r.to, r.note].join('\t'));
        });
        return lines.join('\n');
    }

    /**
     * The one diff table, used by both panels.
     *
     * Virtual, because the row count is the PROJECT's and not ours: five
     * thousand variables and five thousand switches can all differ, and a
     * plain table would build ten thousand rows before the first one is seen.
     */
    function diffTable(opts) {
        return W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 34px', cls: 'mm-td-num' },
                { label: 'where', w: '0 0 70px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'before', w: '0 0 92px', cls: 'mm-td-num' },
                { label: 'after', w: '0 0 92px', cls: 'mm-td-val' },
                { label: '', w: '0 0 78px' }
            ],
            empty: opts.empty,
            render: function (r) {
                var buttons = [];
                if (r.jump) {
                    buttons.push(W.button({
                        label: 'go', mini: true, _ungated: true,
                        tip: 'Go|Opens this row in its own panel.',
                        onClick: function () { jumpTo(r); }
                    }));
                }
                if (opts.revert && (r.kind === 'var' || r.kind === 'switch')) {
                    buttons.push(revertButton(r));
                }
                return [
                    r.id === null ? '' : String(r.id),
                    h('span', { class: 'mm-sub', text: r.kind }),
                    h('span', { text: r.name }),
                    String(r.from),
                    String(r.to),
                    buttons.length ? h('div', { class: 'mm-cellbtns' }, buttons) : ''
                ];
            },
            onRow: function (tr, r) {
                if (r.kind === 'section') tr.style.color = 'var(--mm-warn)';
                tr.setAttribute('data-mm-tip', r.kind + (r.id === null ? '' : ' ' + r.id) + '|' +
                    r.name + (r.note ? ' — ' + r.note : ''));
            }
        });
    }

    /**
     * Reverting is a WRITE, so it goes through the same verified path the
     * Variables panel uses — which reads the value back and names what
     * recomputed it. Without that module there is no verified write to revert
     * through, and the button says exactly that rather than writing blind.
     */
    function revertButton(r) {
        var control = r.kind === 'var' ? 'vars.set' : 'switches.set';
        var why = null;
        if (!$.vars) why = 'the variables module did not load, so there is no verified write to revert through';
        else if (!r.revertable) why = 'this value cannot be written back — it is outside what this project defines, or it is a list';
        else if (degradedFor(control)) why = degradedWhy(control);
        var btn = W.button({
            label: 'revert', mini: true, mutates: true, disabled: !!why,
            onClick: function () {
                if (why) return;
                if (r.kind === 'var') $.vars.setVar(r.id, r.fromRaw, 'Variable #' + r.id + ' back to the baseline');
                else $.vars.setSwitch(r.id, r.fromRaw, 'Switch #' + r.id + ' back to the baseline');
                U.rerender();
            }
        });
        /* A disabled control takes no pointer events, so its own tip can never
           be read — which would leave the reason for the greying nowhere. The
           reason goes on a wrapper that IS hoverable. */
        return why ? h('span', { tip: 'Cannot revert|' + why }, btn) : btn;
    }

    /**
     * Open the row where it can be edited.
     *
     * Only for kinds that HAVE a panel to open. A "go" button that lands
     * nowhere is worse than no button, so kinds without one simply do not get
     * it rather than getting a greyed one.
     */
    function jumpTo(r) {
        $.safe(function () {
            if (r.kind === 'var' || r.kind === 'switch') {
                var k = r.kind === 'var' ? 'var' : 'switch';
                var f = $.store.cfgGet('ui.varFilter.' + k, null) || {};
                f.q = String(r.id);
                $.store.cfgSet('ui.varFilter.' + k, f);
            }
            $.cfg.ui.tab = 'world';
            if (!$.cfg.ui.sub) $.cfg.ui.sub = {};
            $.cfg.ui.sub.world = r.jump;
            $.store.saveSettings();
            U.rerender();
        }, 'snapshot jump');
    }

    /** Search + sort, above the table, shared by both panels. */
    function filterBar(state, repaint) {
        return h('div', { class: 'mm-toolbar' },
            W.search({
                value: state.q, placeholder: 'name, id or value',
                onInput: function (v) { state.q = v.trim(); repaint(); }
            }),
            W.dropdown({
                options: ['by id', 'by kind', 'by size of change'],
                value: cfgGet('sort', 'by id'), width: '150px', _ungated: true,
                onChange: function (v) { cfgSet('sort', v); U.rerender(); }
            }));
    }

    /* =====================================================================
       PART 4 — WORLD / SINCE SAVE
       ===================================================================== */

    function buildSince() {
        if (!alive()) return noWorld();

        var base = S.anchor();
        var live = S.take({ origin: 'live' });
        var only = showMap();
        var rows = base ? S.diff(base, live, { only: only, revert: true }) : [];
        var state = { q: '' };
        var visible = rows;

        var table = diffTable({
            empty: base ? 'nothing has changed since the anchor'
                : 'there is no anchor yet — press "anchor here"',
            revert: true
        });
        var summary = h('div', { class: 'mm-sub', style: 'padding:2px 6px;white-space:normal' });

        function repaint() {
            visible = sortRows(filterRows(rows, state.q, cfgOn('namedOnly', false)),
                cfgGet('sort', 'by id'));
            var kinds = {}, n = 0;
            for (var i = 0; i < visible.length; i++) {
                if (!kinds[visible[i].kind]) { kinds[visible[i].kind] = true; n++; }
            }
            summary.textContent = base
                ? visible.length + ' change' + (visible.length === 1 ? '' : 's') + ' across ' + n +
                  ' section' + (n === 1 ? '' : 's') + ', since ' + base.label + ', ' + agoText(base.at)
                : S.anchorWhy();
            table.mm.paint(visible);
        }
        repaint();

        /* Live, but not every frame: taking the baseline again is a walk of
           the whole variable table, and half a second is faster than anyone
           reads a row. Never while a scroll gesture is in flight. */
        var host = U.getHost();
        host.fastHooks.push(function (n) {
            if (n % 30) return;
            if (table.mm.isScrolling()) return;
            var next = S.take({ origin: 'live' });
            if (!next) return;
            live = next;
            rows = base ? S.diff(base, live, { only: only, revert: true }) : [];
            repaint();
        });

        return cols({ narrow: true, items: sinceSidebar(base, live) },
            [
                summary,
                filterBar(state, repaint),
                /* Inside the group, and inside a ROW inside it. `wide` is
                   `flex:1 1 auto`, which grows across the container's main
                   axis — sideways in a row, and downwards into every spare
                   pixel when it is a direct child of a growing column. */
                W.group('What has changed', [table, h('div', { class: 'mm-inline' }, W.button({
                    label: 'copy diff', wide: true, _ungated: true,
                    disabled: !visible.length,
                    onClick: function () {
                        var ok = U.copyText(diffText(visible, base ? base.label : 'no anchor', 'live now'));
                        U.toast(ok
                            ? { title: 'COPIED', msg: visible.length + ' rows on the clipboard', severity: 'ok', ms: 1600 }
                            : { title: 'NO CLIPBOARD', msg: 'select the rows and copy them by hand', severity: 'warn' });
                    }
                }))], { grow: true, tag: rows.length + '' })
            ]);
    }

    function sinceSidebar(base, live) {
        var out = [];

        var backed = !base ? '—'
            : base.origin !== 'save' ? 'no — anchored by hand'
                : base.ok === null ? 'waiting on the engine’s answer'
                    : base.ok ? 'yes' : 'no — ' + (base.why || 'the engine reported the save failed');

        out.push(W.group('Anchor', [
            kv('Taken', base ? agoText(base.at) + ' · ' + stamp(base.at) : 'never'),
            kv('From', base ? base.label : '—'),
            kv('Slot', base && base.slot !== null ? String(base.slot)
                : (base && base.origin === 'load'
                    ? '— (this build does not record which slot a load came from)'
                    : '—')),
            kv('Playtime at anchor', base ? framesText(base.playFrames) : '—'),
            kv('On disk', backed),
            W.button({
                label: 'anchor here', wide: true, variant: 'prime', _ungated: true,
                tip: 'Anchor|Writes nothing to the game; it only records what is there now.',
                onClick: function () {
                    S.setAnchor(S.take({ origin: 'manual' }));
                    U.toast({ title: 'ANCHORED', msg: 'baseline taken', severity: 'ok', ms: 1600 });
                    U.rerender();
                }
            }),
            W.button({
                label: 'clear anchor', wide: true, _ungated: true,
                disabled: !base,
                tip: base ? null : 'Clear|There is no anchor to clear.',
                onClick: function () { S.clearAnchor(); U.rerender(); }
            }),
            note('The anchor lives in memory only. It is gone when the game is restarted — a ' +
                'five-thousand-entry array on disk per save would be churn for something that means ' +
                'nothing after a relaunch.')
        ], { tag: base ? base.origin : 'none' }));

        var saveHook = $.hooks['DataManager.saveGame (anchor)'];
        var autoWhy = (saveHook && !saveHook.installed) ? saveHook.reason : null;
        var autoBody = [
            W.toggleRow('re-anchor at every save, load and new game', {
                value: cfgOn('autoAnchor', true), _ungated: true, disabled: !!autoWhy,
                tip: autoWhy ? 'Unavailable|' + autoWhy : null,
                onChange: function (v) { cfgSet('autoAnchor', v); U.rerender(); }
            }),
            W.toggleRow('also re-anchor when the autosave slot is written', {
                value: cfgOn('anchorOnAutosave', false), _ungated: true,
                disabled: !hasAutosaveSlot(),
                tip: hasAutosaveSlot()
                    ? 'Autosave|The engine writes it mid-scene, so this hides the change you were reading.'
                    : 'Unavailable|This build has no autosave slot, so nothing writes to slot 0 behind your back.',
                onChange: function (v) { cfgSet('anchorOnAutosave', v); U.rerender(); }
            }),
            W.toggleRow('hide variables and switches the project never named', {
                value: cfgOn('namedOnly', false), _ungated: true,
                onChange: function (v) { cfgSet('namedOnly', v); U.rerender(); }
            })
        ];
        if (overpatched('DataManager.saveGame (anchor)')) {
            autoBody.push(note('something replaced the engine’s save after GigaHack wrapped it, so ' +
                'the next save may not move the anchor. Debug → Hooks lists what is patched.', true));
        }
        out.push(W.group('Automatic', autoBody, { tag: cfgOn('autoAnchor', true) ? 'on' : 'off' }));

        var chips = [];
        COMPARED.forEach(function (row) {
            var key = row[0], label = row[1], section = row[2];
            var why = null;
            if (base && base.sections[section] === 'missing') {
                why = 'the anchor was taken before this section could be read';
            } else if (key === 'actors' && base && base.truncated.actors) {
                why = 'the anchor stopped at snapshot.actorMax actors — raise it in the settings file';
            }
            if (why) {
                /* Not a chip that toggles its own look and changes nothing:
                   a dead label carrying the reason. */
                chips.push(h('span', {
                    class: 'mm-chip', style: 'opacity:0.5', text: label, tip: label + '|' + why
                }));
                return;
            }
            chips.push(W.chip({
                label: label, value: cfgOn('show.' + key, true),
                onChange: function (on) { cfgSet('show.' + key, on); U.rerender(); }
            }));
        });
        out.push(W.group('Compare', [h('div', { class: 'mm-inline' }, chips)],
            { tag: base ? 'anchored' : 'no anchor' }));

        out.push(W.group('Not compared', S.notCompared().map(function (t) {
            return h('div', { class: 'mm-sub', style: 'padding:1px 2px;white-space:normal', text: t });
        }), { collapsed: true, tag: String(S.notCompared().length) }));

        out.push(degradeNote('vars.set'));
        out.push(degradeNote('switches.set'));

        if (live) {
            out.push(W.group('Now', [
                kv('Variables read', String(live.counts.vars)),
                kv('Switches read', String(live.counts.switches)),
                kv('Self-switches set', String(live.counts.self)),
                kv('Actors captured', String(live.counts.actors)),
                kv('Playtime', framesText(live.playFrames))
            ], { collapsed: true, tag: 'live' }));
        }
        return out;
    }

    /* =====================================================================
       PART 5 — DEBUG / COMPARE

       Two save files, or a save file and the running game, side by side. This
       panel READS. It never writes a save, never installs one into the running
       game, and never asks the engine to load one — because loading is what
       destroys the state you are trying to explain.
       ===================================================================== */

    var LIVE_SIDE = -1, ANCHOR_SIDE = -2;

    var cache = {};             // side id -> snapshot
    var cacheWhy = {};          // side id -> why it could not be read
    var readToken = 0;          // discards a result whose request is stale
    var reading = 0;            // how many reads are still in flight
    var readingWhat = '';

    function sideLabel(id) {
        if (id === LIVE_SIDE) return 'live now';
        if (id === ANCHOR_SIDE) return 'the anchor';
        if (id > 0) return 'slot ' + id;
        return 'nothing';
    }

    function sideSnapshot(id) {
        if (id === LIVE_SIDE) return S.take({ origin: 'live' });
        if (id === ANCHOR_SIDE) return S.anchor();
        return cache[id] || null;
    }

    function dropCache() {
        cache = {};
        cacheWhy = {};
        readToken++;
        reading = 0;
        readingWhat = '';
    }

    /**
     * How much state this module holds, so the bound can be asserted rather
     * than asserted about.
     *
     * One anchor, at most two read sides, and never a parsed save: the
     * contents object of a large save IS the whole game state, and keeping one
     * after its snapshot has been taken leaves a second copy of the game alive
     * for the rest of the session.
     */
    S.held = function () {
        return { anchor: anchor ? 1 : 0, sides: Object.keys(cache).length, reading: reading };
    };

    /** Drop everything: the baseline and both read sides. */
    S.forget = function () { anchor = null; dropCache(); };

    /** Read both sides, then repaint once. Never touches the DOM the read started from. */
    function runCompare(a, b) {
        var token = ++readToken;
        /* Anything that is not one of the two sides being compared is dropped
           before the read, so a session that has opened ten slots is still
           holding two. */
        Object.keys(cache).forEach(function (k) {
            if (Number(k) !== a && Number(k) !== b) delete cache[k];
        });
        Object.keys(cacheWhy).forEach(function (k) {
            if (Number(k) !== a && Number(k) !== b) delete cacheWhy[k];
        });
        var want = [];
        if (a > 0 && !cache[a]) want.push(a);
        if (b > 0 && !cache[b] && b !== a) want.push(b);
        if (!want.length) { U.rerender(); return; }

        reading = want.length;
        readingWhat = want.map(sideLabel).join(' and ');
        U.rerender();

        want.forEach(function (id) {
            S.fromSlot(id, function (snap, why) {
                /* A promise that resolves after the panel has been rebuilt
                   must not write into a dead node: park it in module scope
                   under the request token, drop it when the token is stale,
                   and repaint through the shell. */
                if (token !== readToken) return;
                if (snap) cache[id] = snap; else cacheWhy[id] = why;
                reading--;
                if (reading <= 0) { reading = 0; readingWhat = ''; }
                U.rerender();
            });
        });
    }

    function buildCompare() {
        var shape = S.readShape();
        if (!shape.mode) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'saves cannot be read on this build' }),
                    h('div', { style: 'white-space:normal;max-width:520px;line-height:1.7', text: shape.why })));
        }

        var aSel = Math.floor(cfgNum('diff.a', 0, -2, 9999));
        var bSel = Math.floor(cfgNum('diff.b', 0, -2, 9999));
        var a = aSel ? sideSnapshot(aSel) : null;
        var b = bSel ? sideSnapshot(bSel) : null;

        var state = { q: '' };
        var rows = (a && b) ? S.diff(a, b, { only: showMap(), revert: false }) : [];
        var visible = [];

        var waiting = (aSel && bSel && !(a && b));
        var table = diffTable({
            empty: (a && b)
                ? 'these two sides are identical in everything this panel compares'
                : waiting ? 'press compare to open the files'
                    : 'pick a side for A and a side for B',
            revert: false
        });
        var summary = h('div', { class: 'mm-sub', style: 'padding:2px 6px;white-space:normal' });

        function repaint() {
            visible = sortRows(filterRows(rows, state.q, cfgOn('namedOnly', false)),
                cfgGet('sort', 'by id'));
            summary.textContent = (a && b)
                ? sideLabel(aSel) + ' (' + framesText(a.playFrames) + ') → ' +
                  sideLabel(bSel) + ' (' + framesText(b.playFrames) + ') · ' +
                  visible.length + ' change' + (visible.length === 1 ? '' : 's') + ' · ' +
                  playGap(a.playFrames, b.playFrames)
                : waiting ? 'both sides are picked — press compare to open them'
                    : 'pick a side for A and a side for B, then press compare';
            table.mm.paint(visible);
        }
        repaint();

        var main = [summary, filterBar(state, repaint)];
        if (reading) {
            main.push(h('div', { class: 'mm-empty', text: 'reading ' + readingWhat + '…' }));
        } else {
            main.push(W.group('Differences', [table, h('div', { class: 'mm-inline' }, W.button({
                label: 'copy diff', wide: true, _ungated: true, disabled: !visible.length,
                onClick: function () {
                    var ok = U.copyText(diffText(visible, sideLabel(aSel), sideLabel(bSel)));
                    U.toast(ok
                        ? { title: 'COPIED', msg: visible.length + ' rows on the clipboard', severity: 'ok', ms: 1600 }
                        : { title: 'NO CLIPBOARD', msg: 'select the rows and copy them by hand', severity: 'warn' });
                }
            }))], { grow: true, tag: rows.length + '' }));
        }

        return cols({ narrow: true, items: compareSidebar(aSel, bSel, a, b, shape) }, main);
    }

    function compareSidebar(aSel, bSel, a, b, shape) {
        var out = [];

        /* The index this list reads is cached per frame, and that frame
           counter stops advancing while the mod holds the game — so it is
           dropped before the list is built rather than waited out. */
        $.safe(function () { if ($.eng && $.eng.invalidateSaveInfo) $.eng.invalidateSaveInfo(); },
            'invalidate save info');

        var slots = [];
        slots.push({ id: LIVE_SIDE, title: 'live now', playtime: framesText(frameCountNow()), stamp: 0, ready: true });
        slots.push({
            id: ANCHOR_SIDE, title: 'the anchor',
            playtime: S.anchor() ? framesText(S.anchor().playFrames) : '—',
            stamp: S.anchor() ? S.anchor().at : 0,
            ready: !!S.anchor(),
            why: S.anchor() ? null : 'there is no anchor yet — World → Since Save takes one'
        });
        var max = S.maxSlots();
        for (var i = 1; i <= max; i++) {
            var info = $.safe(function () { return $.eng.savefileInfo(i); }, 'snapshot slot info', null);
            slots.push({
                id: i,
                title: info ? (info.title || '') : '',
                playtime: info ? (info.playtime || '—') : '—',
                stamp: info ? (info.timestamp || 0) : 0,
                ready: !!info,
                why: info ? null : 'this slot is empty'
            });
        }

        function pickCell(label, row, selected) {
            if (!row.ready) {
                return h('span', { class: 'mm-sub mm-mono', text: '·', tip: label + '|' + row.why });
            }
            return W.chip({
                label: label, value: selected,
                tip: label + '|Pick this side as ' + label + '.',
                onChange: function () {
                    cfgSet('diff.' + label.toLowerCase(), selected ? 0 : row.id);
                    U.rerender();
                }
            });
        }

        /* Five columns, not six. This table lives in the narrow sidebar, and a
           project's own title for a slot is unbounded — with a timestamp
           column beside it the flexible title column is squeezed to nothing
           and the one thing you pick a slot by disappears. The timestamp is on
           the row's tooltip and in that side's own group instead. */
        var slotTable = W.table({
            rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 24px', cls: 'mm-td-num' },
                { label: 'A', w: '0 0 22px' },
                { label: 'B', w: '0 0 22px' },
                { label: 'title', w: '1 1 0' },
                { label: 'play', w: '0 0 58px', cls: 'mm-td-num' }
            ],
            empty: 'no slots',
            render: function (r) {
                return [
                    r.id > 0 ? String(r.id) : '',
                    pickCell('A', r, aSel === r.id),
                    pickCell('B', r, bSel === r.id),
                    h('span', { text: r.title || (r.ready ? '(untitled)' : 'empty') }),
                    r.playtime
                ];
            },
            onRow: function (tr, r) {
                if (!r.ready) tr.style.opacity = '0.6';
                if (r.id === aSel || r.id === bSel) tr.style.color = 'var(--mm-text-hi)';
                tr.setAttribute('data-mm-tip', sideLabel(r.id) + '|' +
                    (r.ready
                        ? (r.title || 'no title in the index') +
                          (r.stamp ? ' · saved ' + stamp(r.stamp) : '')
                        : r.why));
            }
        });
        slotTable.mm.paint(slots);
        out.push(W.group('Sides', [slotTable], { tag: max + ' slots' }));

        var pickWhy = null;
        if (!aSel || !bSel) pickWhy = 'pick a side for A and a side for B';
        else if (aSel === bSel) pickWhy = 'A and B are the same side';

        /* A disabled control takes no pointer events, so the reason it is
           disabled goes on a wrapper that IS hoverable — otherwise the greying
           is the only thing said and it says nothing. */
        var compareBtn = W.button({
            label: 'compare', wide: true, variant: 'prime', _ungated: true,
            disabled: !!pickWhy,
            onClick: function () { runCompare(aSel, bSel); }
        });
        out.push(W.group('Actions', [
            pickWhy ? h('span', { tip: 'Cannot compare|' + pickWhy }, compareBtn) : compareBtn,
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'swap', _ungated: true, disabled: !aSel || !bSel,
                    onClick: function () {
                        cfgSet('diff.a', bSel);
                        cfgSet('diff.b', aSel);
                        U.rerender();
                    }
                }),
                reading
                    ? h('span', { tip: 'Busy|A read is already running.' },
                        W.button({ label: 're-read', _ungated: true, disabled: true }))
                    : W.button({
                        label: 're-read', _ungated: true,
                        tip: 'Re-read|Drops what was read and opens the files again.',
                        onClick: function () { dropCache(); U.rerender(); }
                    })),
            cacheWhy[aSel] ? note(sideLabel(aSel) + ': ' + cacheWhy[aSel], true) : null,
            cacheWhy[bSel] ? note(sideLabel(bSel) + ': ' + cacheWhy[bSel], true) : null
        ], { tag: reading ? 'reading' : 'ready' }));

        out.push(W.group('Storage', [
            W.pathRow('Save folder', $.eng.saveDir(), {
                why: 'StorageManager did not return a save directory on this build, so the file behind a ' +
                    'slot cannot be named. Reading still goes through the storage layer, which is what ' +
                    'the game itself uses.'
            }),
            kv('Format', $.caps.saveExt || 'unknown'),
            kv('Read shape', shape.text),
            kv('Slots', String(S.maxSlots()))
        ], { tag: shape.mode }));

        out.push(W.group('Read-only', [
            note('This panel opens save files and never writes one. It cannot save, load, delete or ' +
                'retitle a slot, and it never installs a save into the running game.')
        ], { collapsed: true }));

        out.push(sideDetail('A', aSel, a));
        out.push(sideDetail('B', bSel, b));
        return out;
    }

    function sideDetail(which, id, snap) {
        if (!id) {
            return W.group('Side ' + which, [h('div', { class: 'mm-empty', text: 'nothing picked' })],
                { collapsed: true });
        }
        if (!snap) {
            return W.group('Side ' + which, [
                h('div', { class: 'mm-empty', text: cacheWhy[id] || 'not read yet — press compare' })
            ], { collapsed: true, tag: sideLabel(id) });
        }

        var info = (id > 0) ? $.safe(function () { return $.eng.savefileInfo(id); }, 'side info', null) : null;
        var body = [
            kv('Which', sideLabel(id)),
            kv('Title', snap.system.title || '—'),
            kv('Saved', (info && info.timestamp) ? stamp(info.timestamp) : '—'),
            kv('Playtime', framesText(snap.playFrames)),
            kv('Times saved', snap.system.saveCount === null ? '—' : String(snap.system.saveCount)),
            kv('Project build', snap.system.versionId === null ? '—' : String(snap.system.versionId)),
            h('div', { class: 'mm-sep' })
        ];

        SECTION_KEYS.forEach(function (k) {
            var shapeWord = snap.sections[k];
            body.push(kv(k, shapeWord === 'plain'
                ? 'arrived as plain data — the class this save names is not in this build'
                : shapeWord));
        });

        body.push(h('div', { class: 'mm-sep' }));
        if (snap.extra.length) {
            body.push(note('Also in this file, and not compared — written by another plugin:'));
            snap.extra.forEach(function (k) {
                body.push(kv(k, 'not compared'));
            });
        } else {
            body.push(note('Nothing in this file outside the ten sections the engine writes.'));
        }

        if (snap.truncated.self) {
            body.push(note('this state holds ' + snap.truncated.self + ' self-switches and only the first ' +
                cfgNum('selfMax', 20000, 100, 1000000) + ' were read — raise snapshot.selfMax in the ' +
                'settings file', true));
        }
        if (snap.truncated.actors) {
            body.push(note('this state holds more actors than snapshot.actorMax allows, so the rest were ' +
                'not read — raise it in the settings file', true));
        }

        /* A save written by another build of the project is the one thing that
           has to be said BEFORE its variable ids are believed: the same id can
           mean a different thing there. Tested engine-independently against the
           project's own title and version, which is the portable half of the
           one engine's own "is this our save" test. */
        var liveTitle = gameTitle();
        var liveVersion = $.safe(function () { return $dataSystem && $dataSystem.versionId; }, 'version id', null);
        if (snap.side === 'file' &&
            ((snap.system.title && liveTitle && snap.system.title !== liveTitle) ||
                (snap.system.versionId !== null && liveVersion != null && snap.system.versionId !== liveVersion))) {
            body.push(note('this slot was written by a different build of the project — variable and ' +
                'switch ids may not mean the same thing here.', true));
        }

        if (id > 0 && $.caps._hasFn('DataManager.isThisGameFile')) {
            var mine = $.safe(function () { return DataManager.isThisGameFile(id); }, 'isThisGameFile', true);
            if (mine === false) {
                body.push(note('the engine does not recognise this slot as this project’s save. That is ' +
                    'a guard on its LOAD path, not on reading — the file was still read here.', true));
            }
        }

        return W.group('Side ' + which, body, { collapsed: true, tag: sideLabel(id) });
    }

    /* =====================================================================
       REGISTRATION
       ===================================================================== */

    /* Both panels register unconditionally so their sub-tab never vanishes;
       each build function returns the honest body when it cannot run. A tab
       that disappears is a feature nobody can ask why about. */
    U.panel('world', 'Since Save', buildSince, 57);
    U.debugPanel('Compare', buildCompare, 57);

    $.api.anchor = function () { return S.setAnchor(S.take({ origin: 'manual' })); };
    $.api.sinceSave = function () {
        var base = S.anchor();
        return base ? S.diff(base, S.take({ origin: 'live' }), { revert: false }) : [];
    };
    $.api.readSlot = function (id, done) { return S.fromSlot(id, done || function () { }); };

    $.log('ok', 'snapshot ready — ' +
        ($.hooks['DataManager.saveGame (anchor)'] && $.hooks['DataManager.saveGame (anchor)'].installed
            ? 'the baseline follows every save, load and new game' : 'anchoring by hand only') +
        '; saves are read ' + (S.available() ? S.readShape().text : 'nowhere — ' + S.reason()));

})(window.GigaHack);
