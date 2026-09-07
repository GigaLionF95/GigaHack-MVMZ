//=============================================================================
// GigaHack MV/MZ
// 30 · auto.js — run something when the game reaches a state; run splits
//-----------------------------------------------------------------------------
// TWO FEATURES, ONE MACHINE: a trigger runs a saved snippet when the game
// reaches a state, and a route records how long it took to get there. Both are
// a condition matched against an observed edge, so there is one condition
// shape, one matcher and one place where a condition becomes English.
//
// THE INVARIANTS, and why each one is defended the awkward way:
//
//   · THERE IS ONE LIVE SOURCE OF EDGES AND THIS FILE DOES NOT INSTALL IT.
//     GigaHack_Trace.js already aliases the three setValue methods and
//     publishes every observed write through $.watch.onAny. A second alias on
//     the same methods would double every edge and hide the first one's
//     absence, so this module subscribes and, where $.watch cannot see the
//     writes, falls back to polling only the ids an armed condition actually
//     names. Which of the two is running is REPORTED, together with the blind
//     spot that source has.
//
//   · THE RUN CLOCK IS THE ENGINE'S, NEVER GigaHack'S. $.frameCount starts at
//     zero when the mod loads, ignores a forty-hour save, and deliberately
//     keeps ticking while the mod holds the game — so a run timed with it
//     would be longer than the run. Graphics.frameCount is what a player
//     recognises. It is also the one the engine will write into a save.
//
//   · WHERE THAT CLOCK TICKS IS A PROPERTY OF THE BUILD, AND IT IS MEASURED.
//     One engine advances it inside the logical step; the other advances it
//     inside the DRAW, which sits inside the same function but outside the
//     part GigaHack's pause gate is allowed to hold. Every consequence — does
//     holding the game stop the run, does a logical step the engine caught up
//     without drawing count, does time spent entering a scene count — follows
//     from that one placement, and NOTHING here tests for it by engine name.
//     The ratio of engine-clock ticks to logical steps is sampled over a
//     rolling window and printed as the measurement it is.
//
//   · A DISCONTINUITY IS DETECTED, NOT PREDICTED. Graphics.frameCount is
//     writable and this mod writes it: editing the play time sets it outright,
//     and loading a save teleports it to that save's recorded frame. Watching
//     for a load hook would catch one of those and miss the other, so the
//     clock is watched for a jump instead and the run is MARKED. A jump the
//     player did not play never lands in the elapsed time.
//
//   · THE BEST RUN IS KEYED BY THE SPLIT'S OWN ID AND IS NEVER REWRITTEN AS A
//     SIDE EFFECT. Renaming a split keeps its time; reordering keeps every
//     one; deleting one LEAVES its time on disk and says how many stored times
//     no longer have a split, rather than throwing away data the user cannot
//     get back; adding one stops the TOTAL being comparable and says so while
//     every per-split comparison that still matches keeps working. Clearing
//     the best is its own confirmed action and nothing else does it.
//
//   · THIS MODULE WRITES NO GAME STATE. Every write is the snippet's, so there
//     is no "did that write stick" for $.compat.verify to answer and no compat
//     control of its own is declared. The obligation is the other way round:
//     the panel lists what $.compat has already refused this session beside
//     the triggers whose snippets will appear to do nothing.
//
//   · A CONDITION IS RESOLVED AGAINST THE LIVE DATABASE ON EVERY PAINT. A
//     stored trigger on switch 1400 in a project with 1100 is listed, named
//     and flagged — never silently dropped and never trusted from the file.
//
//   · THE TWO THINGS THAT GROW WITH USE ARE CAPPED BEFORE THEY ARE WRITTEN.
//     A trigger returning the whole item database would otherwise put a
//     megabyte per fire into the settings directory.
//
// A trigger fires SYNCHRONOUSLY, inside the command that made the write —
// that is what "run something when the game reaches a state" means, and it is
// also the only way a cascade can be counted on one stack. What is deferred to
// the next frame is the log line and the toast, for the reason Trace defers
// its own: the interpreter's while-loop is not a place to do DOM work.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — run something when the game reaches a state; run splits
 * @author gigahack
 * @help GigaHack_Auto.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat. Consumes GigaHack_Trace.js for the write-time edge
 * source and GigaHack_Console.js for the snippet library; both are named on
 * screen when they are absent. Vars, Map and Player are used where present.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — auto not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    var A = $.auto = {};

    /* The engine's logical step rate is 60 a second on both engines whatever
       the measured frame rate is — MV's SceneManager._deltaTime is 1/60 and
       MZ's determineRepeatNumber targets 60 — so a frame count converts with
       60. $.eng.fps() is a MEASUREMENT that wobbles, and a run timer built on
       it would jitter by tenths while nothing was happening. */
    var LOGICAL_FPS = 60;

    /* =====================================================================
       SETTINGS

       Every key this module reads, with its default, in one table. The
       settings module owns its own DEFAULTS and this file may not edit it, so
       the default is supplied here at read time — a missing key must read as
       the default, never as undefined, or every control opens blank on a
       settings file written before this module existed.
       ===================================================================== */
    var DEFAULTS = {
        'triggers.on': true,
        'triggers.maxPerSecond': 4,
        'triggers.maxDepth': 2,
        'triggers.disableOnThrow': true,
        'triggers.whilePaused': false,
        'triggers.toastOnFire': true,
        'triggers.resultMax': 400,
        'triggers.historyMax': 20,
        'route.on': true,
        'route.startOnNewGame': true,
        'route.startOnLoad': false,
        'route.autoBest': true,
        'route.precision': 'cs',
        'route.jumpFrames': 300,
        'route.warnOnSpeed': true
    };

    function cfg(key) {
        var d = DEFAULTS[key];
        var v = ($.store && $.store.cfgGet) ? $.store.cfgGet('auto.' + key, d) : d;
        return (v === undefined || v === null) ? d : v;
    }
    function num(key, lo, hi) {
        var v = cfg(key), d = DEFAULTS[key];
        if (typeof v !== 'number' || v !== v || !isFinite(v)) return d;
        return v < lo ? lo : v > hi ? hi : v;
    }
    function on(key) { return cfg(key) !== false; }
    function setCfg(key, value) {
        if ($.store && $.store.cfgSet) $.store.cfgSet('auto.' + key, value);
        return value;
    }

    var TRIG_FILE = 'auto-triggers.json';
    var ROUTE_FILE = 'auto-routes.json';

    /* =====================================================================
       SMALL SHARED HELPERS
       ===================================================================== */
    function note(text) {
        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px', text: text });
    }
    function warnNote(text) {
        return h('div', {
            class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)', text: text
        });
    }
    /* An unbounded string on a row's right side. .mm-edge is flex:0 0 auto and
       does not shrink, which is correct for a button and fatal for a thrown
       message, so the shrinking and wrapping variants are opted into here. */
    function edgeText(text, cls) {
        return h('div', {
            class: 'mm-edge mm-edge--shrink mm-edge--wrap ' + (cls || 'mm-sub'), text: text
        });
    }
    /**
     * A labelled sentence, for the narrow column.
     *
     * A label-plus-edge row cannot hold one: .mm-lab does not shrink below its
     * text and .mm-edge--shrink then has a strip a few characters wide to wrap
     * into, so the sentence spills past the column's own overflow:hidden and
     * is clipped rather than wrapped. Long copy in a 180px column is a
     * paragraph, not a row.
     */
    function longNote(label, text) {
        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px 2px 5px' },
            h('b', { class: 'mm-hi', text: label }), ' — ' + text);
    }

    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: label }),
            edgeText(String(value)));
    }
    function pad2(n) { return n < 10 ? '0' + n : String(n); }

    var PRECISIONS = ['centiseconds', 'whole seconds', 'engine frames'];
    var PRECISION_KEYS = ['cs', 's', 'frames'];
    function precisionKey(label) {
        var i = PRECISIONS.indexOf(label);
        return i < 0 ? 'cs' : PRECISION_KEYS[i];
    }
    function precisionLabel(key) {
        var i = PRECISION_KEYS.indexOf(key);
        return i < 0 ? PRECISIONS[0] : PRECISIONS[i];
    }

    /**
     * A frame count as a time.
     *
     * Frames are the honest unit — they are what the engine counts and what a
     * split is recorded in — so "engine frames" is offered alongside the two
     * clock forms rather than the number being converted away and lost.
     */
    function clockText(frames) {
        if (frames === null || frames === undefined || frames !== frames) return '—';
        var neg = frames < 0;
        var f = Math.abs(frames);
        var mode = cfg('route.precision');
        if (PRECISION_KEYS.indexOf(mode) < 0) mode = 'cs';
        if (mode === 'frames') return (neg ? '−' : '') + f + 'f';
        var cs = Math.floor(f * 100 / LOGICAL_FPS);
        var s = Math.floor(cs / 100); cs = cs % 100;
        var m = Math.floor(s / 60); s = s % 60;
        var hh = Math.floor(m / 60); m = m % 60;
        return (neg ? '−' : '') + hh + ':' + pad2(m) + ':' + pad2(s) +
            (mode === 's' ? '' : '.' + pad2(cs));
    }
    function deltaText(frames) {
        if (frames === null || frames === undefined) return '—';
        return (frames < 0 ? '−' : '+') + clockText(Math.abs(frames)).replace(/^0:/, '');
    }
    function truncate(s, max) {
        s = String(s == null ? '' : s);
        return s.length > max ? s.slice(0, max) + '… (' + s.length + ' chars, kept ' + max + ')' : s;
    }
    function slug(s) {
        return String(s == null ? '' : s).toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    }
    function sameValue(a, b) {
        if ($.vars && $.vars.sameValue) return $.vars.sameValue(a, b);
        if (a === b) return true;
        return !a && !b;
    }
    function numOf(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

    function switchCount() {
        if ($.vars && $.vars.switchCount) return $.vars.switchCount();
        return $.safe(function () { return $dataSystem.switches.length - 1; }, 'auto: switch count', 0) || 0;
    }
    function varCount() {
        if ($.vars && $.vars.varCount) return $.vars.varCount();
        return $.safe(function () { return $dataSystem.variables.length - 1; }, 'auto: variable count', 0) || 0;
    }
    function switchName(id) {
        return $.safe(function () { return ($dataSystem.switches && $dataSystem.switches[id]) || ''; },
            'auto: switch name', '') || '';
    }
    function varName(id) {
        return $.safe(function () { return ($dataSystem.variables && $dataSystem.variables[id]) || ''; },
            'auto: variable name', '') || '';
    }
    function mapName(id) {
        var n = ($.map && $.map.mapName) ? $.safe(function () { return $.map.mapName(id); }, 'auto: map name', '') : '';
        /* $.map.mapName falls back to "map <id>", which would render as
           `map 12 "map 12" loads`. One lookup, and its fallback is dropped. */
        return (n && n !== 'map ' + id) ? n : '';
    }
    function dbReady() {
        return $.safe(function () {
            return typeof $dataSystem !== 'undefined' && !!$dataSystem && !!$dataSystem.variables;
        }, 'auto: database ready', false);
    }

    /* =====================================================================
       PART 1 — THE CLOCK

       Published as $.auto.clock() because it is the one honest answer to
       "what time is it in this game", and it is a MEASUREMENT of what was
       installed on this build rather than a fact about a version.
       ===================================================================== */
    var CLOCK_WINDOW = 120;

    var clock = {
        last: null,          // last sampled Graphics.frameCount
        ring: [], sum: 0,    // rolling engine-tick deltas, jumps excluded
        heldSteps: 0,        // logical steps observed while the game was held
        heldMoved: 0,        // ...of which the engine clock also advanced
        jumpAt: 0, jumpBy: 0, jumpWhy: ''
    };

    function engineFrame() {
        return $.safe(function () {
            if (typeof Graphics === 'undefined' || !Graphics) return null;
            return (typeof Graphics.frameCount === 'number' && isFinite(Graphics.frameCount))
                ? Graphics.frameCount : null;
        }, 'auto: engine frame', null);
    }

    var NO_CLOCK =
        'this build has no readable Graphics.frameCount, so there is no game clock to split ' +
        'against. A wall clock would measure your afternoon, not the run.';

    /* Does the pause gate's list contain the whole main update? Where it does,
       the tick site is inside what is held; where it is the three per-step
       functions, the draw and the frame request are deliberately left running
       and a clock that ticks in the draw goes on ticking. This is the
       PREDICTION; heldVerdict() below is the measurement. */
    function gateHoldsWholeUpdate() {
        var t = ($.pause && $.pause.targets) ? $.pause.targets() : [];
        for (var i = 0; i < t.length; i++) if (t[i] === 'SceneManager.updateMain') return true;
        return false;
    }
    function gatePrediction() {
        if (!$.pause || !$.pause.available || !$.pause.available()) {
            return { holds: null, why: 'pause is unavailable on this build' +
                (($.pause && $.pause.why) ? ' — ' + $.pause.why() : '') + ', so the game is never held.' };
        }
        if (gateHoldsWholeUpdate()) {
            return { holds: true, why: 'the whole main update is held and the engine clock ticks inside it, ' +
                'so holding the game should STOP the run clock.' };
        }
        return { holds: false, why: 'only the per-step functions are held; the draw and the frame request ' +
            'are deliberately left running, so a clock that ticks in the draw should KEEP advancing while ' +
            'the game is held.' };
    }
    function heldVerdict() {
        if (clock.heldSteps < 4) return { known: false, stops: null, text: 'not observed yet' };
        var stops = clock.heldMoved === 0;
        return {
            known: true, stops: stops,
            text: stops
                ? 'measured: it STOPS (' + clock.heldSteps + ' held step(s), the clock moved on none of them)'
                : 'measured: it KEEPS ADVANCING (' + clock.heldMoved + ' of ' + clock.heldSteps +
                  ' held step(s) moved the clock)'
        };
    }

    function perStep() {
        return clock.ring.length ? (clock.sum / clock.ring.length) : null;
    }
    function perStepText() {
        var p = perStep();
        if (p === null) return 'not measured yet — the sampler needs two logical steps.';
        var n = p.toFixed(2) + ' per logical step';
        if (p > 1.15) {
            return n + ' — more than one thing on this build is advancing the engine clock, so the ' +
                'run clock runs faster than the game does.';
        }
        if (p < 0.85) {
            return n + ' — this build ticks the clock when it DRAWS, so logical steps the engine ' +
                'catches up inside one frame are not counted.';
        }
        return n + ' — one tick per logical step on this build.';
    }

    A.clock = function () {
        var pred = gatePrediction();
        var held = heldVerdict();
        /* Read live rather than reported from the sampler's last pass: the
           first caller is a panel that may build before a frame has run, and
           "no clock" is the one answer here that must never be wrong. */
        var f = engineFrame();
        return {
            frame: f,
            ok: f !== null,
            why: f !== null ? '' : NO_CLOCK,
            perStep: perStep(),
            samples: clock.ring.length,
            perStepWhy: perStepText(),
            gate: {
                targets: ($.pause && $.pause.targets) ? $.pause.targets() : [],
                insideGate: gateHoldsWholeUpdate(),
                predictsStop: pred.holds,
                why: pred.why
            },
            held: {
                steps: clock.heldSteps, moved: clock.heldMoved,
                known: held.known, stops: held.stops, why: held.text
            },
            jumped: !!clock.jumpAt,
            jumpBy: clock.jumpBy,
            jumpWhy: clock.jumpWhy
        };
    };

    /* Reset the measurements — used when the game world is rebuilt, and by any
       caller that wants a fresh window rather than one polluted by whatever the
       last scene was doing. */
    A.clockReset = function () {
        clock.ring.length = 0; clock.sum = 0;
        clock.heldSteps = 0; clock.heldMoved = 0;
        clock.last = engineFrame();
        return true;
    };

    /* =====================================================================
       PART 2 — CONDITIONS

       One shape, one matcher, one place where a condition becomes English.
       Every name and every ceiling is resolved against the LIVE database at
       the moment it is asked for, never trusted from the stored record.
       ===================================================================== */
    var SRC_SWITCH_ON = 'a switch turns on';
    var SRC_SWITCH_OFF = 'a switch turns off';
    var SRC_VAR = 'a variable reaches a value';
    var SRC_MAP = 'a map loads';
    var SRC_BATTLE = 'a battle starts';
    var SRC_TIMER = 'every N seconds';

    var VAR_TESTS = ['reaches', 'passes above', 'drops below', 'equals', 'changes to anything else'];
    var VAR_KEYS = ['reaches', 'above', 'below', 'equals', 'changes'];
    function testKey(label) {
        var i = VAR_TESTS.indexOf(label);
        return i < 0 ? 'reaches' : VAR_KEYS[i];
    }
    function testLabel(key) {
        var i = VAR_KEYS.indexOf(key);
        return i < 0 ? VAR_TESTS[0] : VAR_TESTS[i];
    }

    /** '' when the condition names something this project has, or the sentence. */
    function rangeWhy(w) {
        if (!w || !dbReady()) return '';
        if (w.kind === 'switch') {
            var sc = switchCount();
            if (sc && w.id > sc) return 'this project has ' + sc;
        }
        if (w.kind === 'var') {
            var vc = varCount();
            if (vc && w.id > vc) return 'this project has ' + vc;
        }
        return '';
    }
    A.rangeWhy = rangeWhy;

    function describeWhen(w) {
        if (!w || !w.kind) return 'nothing';
        var tail = rangeWhy(w);
        tail = tail ? ' — ' + tail : '';
        if (w.kind === 'switch') {
            var sn = switchName(w.id);
            return 'switch ' + w.id + (sn ? ' "' + sn + '"' : '') +
                (w.on ? ' turns on' : ' turns off') + tail;
        }
        if (w.kind === 'var') {
            var vn = varName(w.id);
            var head = 'variable ' + w.id + (vn ? ' "' + vn + '"' : '') + ' ' + testLabel(w.test);
            return head + (w.test === 'changes' ? '' : ' ' + w.value) + tail;
        }
        if (w.kind === 'map') {
            var mn = mapName(w.id);
            return 'map ' + w.id + (mn ? ' "' + mn + '"' : '') + ' loads';
        }
        if (w.kind === 'battle') return 'a battle starts';
        if (w.kind === 'timer') return 'every ' + w.seconds + 's of real time';
        if (w.kind === 'manual') return 'the run reaches "' + w.label + '"';
        return 'nothing';
    }
    A.describe = describeWhen;

    /** A condition's identity, so two splits on the same thing can be refused. */
    function whenKeyOf(w) {
        if (!w || !w.kind) return '';
        if (w.kind === 'switch') return 'switch:' + w.id + ':' + (w.on ? 1 : 0);
        if (w.kind === 'var') return 'var:' + w.id + ':' + w.test + ':' + w.value;
        if (w.kind === 'map') return 'map:' + w.id;
        if (w.kind === 'battle') return 'battle';
        if (w.kind === 'timer') return 'timer:' + w.seconds;
        if (w.kind === 'manual') return 'manual:' + String(w.label).toLowerCase();
        return '';
    }

    /**
     * Does this edge satisfy this condition?
     *
     * An edge is {kind, id, from, to}. undefined and false are the same value
     * to Game_Switches, and undefined and 0 are the same to Game_Variables
     * (its value() returns `this._data[id] || 0`), so neither flip is an edge
     * and sameValue is what decides.
     */
    function matchEdge(w, e) {
        if (!w || !e) return false;
        if (w.kind === 'switch') {
            if (e.kind !== 'switch' || Number(e.id) !== Number(w.id)) return false;
            return (!!e.to === !!w.on) && (!!e.from !== !!w.on);
        }
        if (w.kind === 'var') {
            if (e.kind !== 'var' || Number(e.id) !== Number(w.id)) return false;
            var a = numOf(e.from), b = numOf(e.to);
            switch (w.test) {
                case 'above': return b !== null && b > w.value && !(a !== null && a > w.value);
                case 'below': return b !== null && b < w.value && !(a !== null && a < w.value);
                case 'equals': return sameValue(e.to, w.value) && !sameValue(e.from, w.value);
                case 'changes': return !sameValue(e.from, e.to);
                default: return b !== null && b >= w.value && !(a !== null && a >= w.value);
            }
        }
        if (w.kind === 'map') return e.kind === 'map' && Number(e.id) === Number(w.id);
        if (w.kind === 'battle') return e.kind === 'battle';
        if (w.kind === 'manual') {
            return e.kind === 'manual' &&
                String(e.label).toLowerCase() === String(w.label).toLowerCase();
        }
        return false;
    }

    /* =====================================================================
       PART 3 — THE EDGE SOURCE

       $.watch sees the write itself. Where it cannot, the ids an armed
       condition actually names are polled once per logical step — never the
       whole table, because a project's variable count is the project's and
       walking four figures of it every step for two armed triggers is a cost
       nobody asked for.
       ===================================================================== */
    var HOOK_MAP = 'Game_Map.setup (auto: map loaded)';
    var HOOK_BATTLE = 'BattleManager.setup (auto: battle started)';
    var HOOK_NEWGAME = 'DataManager.setupNewGame (auto: run start)';
    var HOOK_LOAD = 'DataManager.extractSaveContents (auto: a load happened)';

    /**
     * Why each alias matters, written once.
     *
     * $.install records a reason when the TARGET was missing, which is the
     * common case — but a hook can also be removed from Debug → Hooks, and
     * then the registry entry carries no reason at all. A dropdown that
     * silently lost an option in that case would be the exact failure this
     * codebase exists to avoid, so the reason lives here and the registry's
     * own wording wins where it has one.
     */
    var REASONS = {};
    REASONS[HOOK_MAP] =
        'Game_Map.prototype.setup is not the function GigaHack aliased — a plugin has replaced the ' +
        'map object, or the hook was removed from Debug → Hooks. A trigger or a split that waits for ' +
        'a map cannot fire. Every other source still works; watch a switch the map turns on instead.';
    REASONS[HOOK_BATTLE] =
        'BattleManager.setup is not the function GigaHack aliased — a battle-system plugin has ' +
        'replaced it, or the hook was removed. "a battle starts" cannot fire. Watch the switch or ' +
        'variable the battle sets instead.';
    REASONS[HOOK_NEWGAME] =
        'DataManager.setupNewGame is not the function GigaHack aliased, so a run cannot start itself ' +
        'on a new game — start it with "start the run now" in Player → Route, or make the first ' +
        'split the starting map.';
    REASONS[HOOK_LOAD] =
        'DataManager.extractSaveContents is not the function GigaHack aliased, so a load cannot be ' +
        'told apart from an ordinary frame: the baselines still re-prime through the gameobjects ' +
        'event, but a run whose clock moves is marked "the clock was edited" rather than "a save ' +
        'was loaded".';

    function installed(name) { return !!($.hooks[name] && $.hooks[name].installed); }
    function hookWhy(name) {
        return ($.hooks[name] && $.hooks[name].reason) || REASONS[name] || '';
    }

    var traceSubscribed = null;   // the onAny function we handed to $.watch
    var pollWant = { s: {}, v: {} };
    var pollBase = { s: {}, v: {} };
    var pollArmed = false;

    function traceUsable() {
        return !!($.watch && typeof $.watch.onAny === 'function' &&
            $.watch.available && $.watch.available().ok);
    }

    A.source = function () {
        var via = traceUsable() ? 'trace' : 'poll';
        var av = ($.watch && $.watch.available) ? $.watch.available() : null;
        return {
            via: via,
            detection: via === 'trace'
                ? 'every write, as it happens'
                : 'once per logical step, from GigaHack\'s own frame hook',
            why: via === 'trace' ? '' : (av && !av.ok ? av.why :
                'GigaHack_Trace.js did not load, so switch and variable edges are polled once per ' +
                'logical step from GigaHack\'s own frame hook instead. Install GigaHack_Trace.js to ' +
                'see the write itself.'),
            blind: via === 'trace'
                ? 'a write made straight into the _data array, without going through setValue, is ' +
                  'not seen. Nothing in either engine does that; a plugin can.'
                : 'a value that is set and cleared inside one logical step is not seen — the poller ' +
                  'compares once per step and both writes have already happened.'
        };
    };

    /** The ids an armed condition names, so the poller walks nothing else. */
    function rebuildWants() {
        var s = {}, v = {}, i, j, w;
        for (i = 0; i < triggers.length; i++) {
            if (!triggers[i].on) continue;
            w = triggers[i].when;
            if (!w) continue;
            if (w.kind === 'switch') s[w.id] = 1;
            if (w.kind === 'var') v[w.id] = 1;
        }
        var r = currentRoute();
        if (r && run.state === 'running') {
            for (j = 0; j < r.splits.length; j++) {
                w = r.splits[j].when;
                if (!w) continue;
                if (w.kind === 'switch') s[w.id] = 1;
                if (w.kind === 'var') v[w.id] = 1;
            }
        }
        pollWant = { s: s, v: v };
        pollArmed = false;   // re-prime before the next comparison
    }

    function primePoll() {
        pollBase = { s: {}, v: {} };
        $.safe(function () {
            var id;
            for (id in pollWant.s) pollBase.s[id] = $gameSwitches ? $gameSwitches.value(Number(id)) : false;
            for (id in pollWant.v) pollBase.v[id] = $gameVariables ? $gameVariables.value(Number(id)) : 0;
        }, 'auto: prime poll');
        pollArmed = true;
    }

    function pollOnce() {
        if (traceUsable()) return;
        if (!pollArmed) { primePoll(); return; }
        $.safe(function () {
            var id, now;
            for (id in pollWant.s) {
                if (!$gameSwitches) break;
                now = $gameSwitches.value(Number(id));
                if (!sameValue(now, pollBase.s[id])) {
                    var was = pollBase.s[id];
                    pollBase.s[id] = now;
                    onEdge({ kind: 'switch', id: Number(id), from: was, to: now });
                }
            }
            for (id in pollWant.v) {
                if (!$gameVariables) break;
                now = $gameVariables.value(Number(id));
                if (!sameValue(now, pollBase.v[id])) {
                    var wasV = pollBase.v[id];
                    pollBase.v[id] = now;
                    onEdge({ kind: 'var', id: Number(id), from: wasV, to: now });
                }
            }
        }, 'auto: poll');
    }

    /* One subscription, attached only while something is armed. $.watch's own
       hot path does no work at all while nothing demands it, and a mod menu
       nobody is using must not be what turns that on. */
    function recomputeSource() {
        rebuildWants();
        var wanted = armedCount() > 0 || (run.state === 'running' && currentRoute());
        if (wanted && traceUsable() && !traceSubscribed) {
            traceSubscribed = $.watch.onAny(function (e) {
                if (!e) return;
                if (e.kind !== 'var' && e.kind !== 'switch') return;
                onEdge({ kind: e.kind, id: e.id, from: e.from, to: e.to });
            });
        } else if ((!wanted || !traceUsable()) && traceSubscribed) {
            if ($.watch && $.watch.offAny) $.watch.offAny(traceSubscribed);
            traceSubscribed = null;
        }
        if (wanted && !traceUsable()) primePoll();
    }

    /** Every edge, from whichever source. Triggers first, then the route. */
    function onEdge(e) {
        fireMatching(e);
        splitMatching(e);
    }

    /* =====================================================================
       PART 4 — TRIGGERS
       ===================================================================== */
    var triggers = [];
    var trigSeq = 1;
    var trigLoaded = false;
    var history = [];          // recent fires, for the "Last fire" group
    var refusals = [];         // cascade and ceiling refusals, capped
    var notices = [];          // log lines + toasts queued off the write path
    var depth = 0;             // cascade depth
    var chain = [];            // trigger names on the stack

    function loadTriggers() {
        if (trigLoaded) return triggers;
        trigLoaded = true;
        var raw = $.store.read(TRIG_FILE, null);
        var list = (raw && raw.triggers && raw.triggers.length) ? raw.triggers : [];
        var dropped = 0;
        for (var i = 0; i < list.length; i++) {
            var t = list[i];
            if (!t || !t.when || !t.when.kind || !t.snippet) { dropped++; continue; }
            triggers.push({
                id: String(t.id || ('t' + trigSeq)),
                name: String(t.name || ''),
                when: t.when,
                snippet: String(t.snippet),
                on: t.on !== false,
                disabledWhy: String(t.disabledWhy || ''),
                runs: Number(t.runs) || 0,
                lastFrame: Number(t.lastFrame) || 0,
                lastAt: Number(t.lastAt) || 0,
                lastResult: String(t.lastResult || ''),
                lastError: String(t.lastError || ''),
                fires: [], quietUntil: 0, firing: false
            });
        }
        trigSeq = Math.max(Number(raw && raw.seq) || 1, triggers.length + 1);
        if (dropped) $.log('warn', TRIG_FILE + ': dropped ' + dropped + ' unusable trigger(s)');
        return triggers;
    }

    /**
     * The persisted shape, built in ONE place.
     *
     * $.store.write is immediate and $.store.save is debounced, and write
     * clears a pending save for the same file. Fire counts move on every edge
     * and go through the debounced path; a structural edit goes through the
     * immediate one. Both serialising from here is what stops the immediate
     * write dropping the counts the debounced one was holding.
     */
    function fileShape() {
        return {
            _schema: 1,
            seq: trigSeq,
            triggers: triggers.map(function (t) {
                return {
                    id: t.id, name: t.name, when: t.when, snippet: t.snippet,
                    on: t.on, disabledWhy: t.disabledWhy,
                    runs: t.runs, lastFrame: t.lastFrame, lastAt: t.lastAt,
                    lastResult: t.lastResult, lastError: t.lastError
                };
            })
        };
    }
    /* Loud once, quiet after: the destination is always visible at least once
       (§6.6) and the rest are not, or a trigger arming itself off a busy
       switch would put a line in the log drawer for every edge. */
    var trigWritten = false;
    function writeTriggers() {
        $.store.write(TRIG_FILE, fileShape(), trigWritten);
        trigWritten = true;
    }
    function saveTriggers() { $.store.save(TRIG_FILE, fileShape()); }

    A.persistFailed = function () {
        return !!($.store.hasFailed && ($.store.hasFailed(TRIG_FILE) || $.store.hasFailed(ROUTE_FILE)));
    };

    function armedCount() {
        var n = 0;
        loadTriggers();
        if (!on('triggers.on')) return 0;
        for (var i = 0; i < triggers.length; i++) if (triggers[i].on) n++;
        return n;
    }
    A.armedCount = armedCount;

    A.triggers = function () {
        loadTriggers();
        return triggers.map(function (t) { return $.clone(stripLive(t)); });
    };
    function stripLive(t) {
        return {
            id: t.id, name: t.name, when: t.when, snippet: t.snippet, on: t.on,
            disabledWhy: t.disabledWhy, runs: t.runs, lastFrame: t.lastFrame,
            lastAt: t.lastAt, lastResult: t.lastResult, lastError: t.lastError
        };
    }
    A.trigger = function (id) {
        loadTriggers();
        for (var i = 0; i < triggers.length; i++) if (triggers[i].id === id) return triggers[i];
        return null;
    };

    A.addTrigger = function (spec) {
        if (!spec || !spec.when || !spec.when.kind) return null;
        if (!spec.snippet) return null;
        if (!$.allowWrite('Adding a trigger')) return null;
        loadTriggers();
        var rec = {
            id: 't' + (trigSeq++).toString(36),
            name: String(spec.name || describeWhen(spec.when)).slice(0, 60),
            when: spec.when,
            snippet: String(spec.snippet),
            on: spec.on !== false,
            disabledWhy: '', runs: 0, lastFrame: 0, lastAt: 0,
            lastResult: '', lastError: '',
            fires: [], quietUntil: 0, firing: false
        };
        triggers.push(rec);
        writeTriggers();
        recomputeSource();
        /* Deliberately not logged. The list is on screen and on disk, and the
           log drawer is a fixed-size ring shared by every module — what goes in
           it is what the user cannot otherwise see: a refusal, a trigger
           switching itself off, a write that would not persist. */
        return rec;
    };

    A.removeTrigger = function (id) {
        loadTriggers();
        for (var i = 0; i < triggers.length; i++) {
            if (triggers[i].id !== id) continue;
            if (!$.allowWrite('Deleting a trigger')) return false;
            triggers.splice(i, 1);
            writeTriggers();
            recomputeSource();
            return true;
        }
        return false;
    };

    A.renameTrigger = function (id, name) {
        var rec = A.trigger(id);
        if (!rec) return false;
        rec.name = String(name || '').slice(0, 60) || describeWhen(rec.when);
        writeTriggers();
        return true;
    };

    /**
     * Turning one on CLEARS its stated reason and re-arms it, because
     * re-arming is exactly how you find out whether the cause has gone.
     */
    A.enableTrigger = function (id, want) {
        var rec = A.trigger(id);
        if (!rec) return false;
        if (!$.allowWrite('Arming a trigger')) return false;
        rec.on = !!want;
        if (rec.on) {
            rec.disabledWhy = '';
            rec.lastError = '';
            rec.fires.length = 0;
            rec.quietUntil = 0;
        }
        writeTriggers();
        recomputeSource();
        return true;
    };

    A.armAll = function () {
        loadTriggers();
        var n = 0;
        for (var i = 0; i < triggers.length; i++) {
            if (triggers[i].on && !triggers[i].disabledWhy) continue;
            triggers[i].on = true;
            triggers[i].disabledWhy = '';
            triggers[i].lastError = '';
            triggers[i].fires.length = 0;
            triggers[i].quietUntil = 0;
            n++;
        }
        if (n) { writeTriggers(); recomputeSource(); }
        return n;
    };

    /** Drop the in-memory list and re-read the file, as a launch would. */
    A.reload = function () {
        $.store.flush();
        triggers.length = 0;
        trigLoaded = false;
        loadTriggers();
        recomputeSource();
        return triggers.length;
    };

    function pushNotice(level, msg, toast) {
        notices.push({ level: level, msg: msg, toast: toast || null });
        if (notices.length > 40) notices.shift();
    }

    function refuse(rec, why) {
        var line = { at: Date.now(), trigger: rec ? rec.name : '', why: why };
        var last = refusals[refusals.length - 1];
        refusals.push(line);
        while (refusals.length > num('triggers.historyMax', 1, 200)) refusals.shift();
        if (!last || last.why !== why || Date.now() - last.at > 1000) pushNotice('warn', why, null);
        return { ok: false, error: why, refused: true };
    }
    A.refusals = function () { return refusals.slice(); };
    A.lastRefusal = function () { return refusals.length ? refusals[refusals.length - 1] : null; };

    function disable(rec, why) {
        rec.on = false;
        rec.disabledWhy = why;
        writeTriggers();
        recomputeSource();
        pushNotice('warn', 'trigger "' + rec.name + '" disabled: ' + why,
            { title: 'TRIGGER OFF', msg: rec.name + ' — ' + why, severity: 'warn' });
    }

    /**
     * Run one trigger.
     *
     * The guards are ordered so that the cascade ceiling is what a mutual pair
     * hits and the re-entry guard is what a self-write hits: with the two the
     * other way round, two triggers writing each other's condition would be
     * stopped by re-entry and the ceiling would never be reached, so the
     * refusal would name one of them instead of the chain.
     */
    A.fire = function (id, why) {
        var rec = A.trigger(id);
        if (!rec) return { ok: false, error: 'no trigger with id ' + id };

        var max = Math.floor(num('triggers.maxDepth', 1, 8));
        if (depth >= max) {
            return refuse(rec, 'the cascade ceiling of ' + max + ' was reached: ' +
                chain.concat([rec.name]).join(' → ') + '. Each of those is writing the next one\'s ' +
                'condition. Debug → Triggers → Safety raises the ceiling.');
        }
        if (rec.firing) {
            return refuse(rec, 'trigger "' + rec.name + '" writes the very thing it watches, so it ' +
                'fires once and its own write is ignored.');
        }

        var now = Date.now();
        if (now < rec.quietUntil) {
            return { ok: false, error: 'held for a second after its last error', refused: true };
        }

        var ceiling = Math.floor(num('triggers.maxPerSecond', 1, 60));
        rec.fires.push(now);
        while (rec.fires.length && now - rec.fires[0] > 1000) rec.fires.shift();
        if (rec.fires.length > ceiling) {
            var count = rec.fires.length;
            rec.fires.length = 0;
            disable(rec, 'it fired ' + count + ' times in one second, over the ceiling of ' + ceiling +
                '. Something writes its condition every step — a parallel process usually — so the ' +
                'trigger is off rather than throttled. Raise the ceiling under Safety, or watch ' +
                'something that moves less often.');
            return { ok: false, error: rec.disabledWhy, refused: true };
        }

        /* Resolved by ID at the moment it fires, never cached as code. A
           snippet deleted from the library must show as a stated reason, not
           as a trigger that runs nothing. */
        var snip = ($.console && $.console.snippet) ? $.console.snippet(rec.snippet) : null;
        if (!snip) {
            disable(rec, 'the snippet it ran was deleted from the console library.');
            return { ok: false, error: rec.disabledWhy, refused: true };
        }

        var res;
        rec.firing = true;
        depth++;
        chain.push(rec.name);
        try {
            /* Quiet: the trigger's source is not echoed into the console on
               every fire, or a trigger on a busy switch would fill the output
               ring with its own text. The result and any error are kept here. */
            res = $.console.run(snip.code, true);
        } finally {
            chain.pop();
            depth--;
            rec.firing = false;
        }

        rec.runs++;
        rec.lastAt = Date.now();
        rec.lastFrame = engineFrame() || 0;

        if (res && res.ok) {
            rec.lastError = '';
            /* Capped BEFORE it is written. A trigger that returns the whole
               item database would otherwise write a megabyte per fire into the
               settings directory. */
            rec.lastResult = truncate(
                $.console.format ? $.console.format(res.value) : String(res.value),
                Math.floor(num('triggers.resultMax', 40, 4000)));
        } else {
            var msg = res && res.error === 'read-only'
                ? 'read-only'
                : (res && res.error && res.error.message) ? res.error.message : String(res && res.error);
            rec.lastResult = '';
            rec.lastError = truncate(msg, Math.floor(num('triggers.resultMax', 40, 4000)));
            if (msg !== 'read-only') {
                if (on('triggers.disableOnThrow')) {
                    disable(rec, 'it threw: ' + rec.lastError);
                } else {
                    /* Kept armed on purpose, and rate-limited to one fire a
                        second so a throwing trigger on a busy switch does not
                        run sixty times before anyone reads the message. */
                    rec.quietUntil = Date.now() + 1000;
                }
            }
        }

        history.push({
            at: rec.lastAt, frame: rec.lastFrame, id: rec.id, name: rec.name,
            why: why || '', ok: !!(res && res.ok),
            result: rec.lastResult, error: rec.lastError
        });
        while (history.length > Math.floor(num('triggers.historyMax', 1, 200))) history.shift();

        saveTriggers();
        if (on('triggers.toastOnFire') && res && res.ok) {
            pushNotice('info', 'trigger "' + rec.name + '" fired — ' + (why || describeWhen(rec.when)),
                { title: 'TRIGGER', msg: rec.name, severity: 'ok', ms: 1400 });
        }
        return res || { ok: false, error: 'the console returned nothing' };
    };

    A.history = function () { return history.slice(); };
    A.lastFire = function () { return history.length ? history[history.length - 1] : null; };

    function heldNow() {
        return !!($.pause && $.pause.active && $.pause.active());
    }

    function fireMatching(e) {
        if (!on('triggers.on')) return;
        if (heldNow() && !on('triggers.whilePaused')) return;
        loadTriggers();
        for (var i = 0; i < triggers.length; i++) {
            var t = triggers[i];
            if (!t.on) continue;
            if (!matchEdge(t.when, e)) continue;
            A.fire(t.id, describeWhen(t.when));
        }
    }

    /* The every-N-seconds trigger is REAL time, deliberately. The game speed
       multiplier changes how many logical steps happen in a second, so a timer
       counted in frames would fire four times as often at 4× — which is not
       what "every thirty seconds" means to anybody. */
    var timerLast = {};
    function fireTimers() {
        if (!on('triggers.on')) return;
        if (heldNow() && !on('triggers.whilePaused')) return;
        loadTriggers();
        var now = Date.now();
        for (var i = 0; i < triggers.length; i++) {
            var t = triggers[i];
            if (!t.on || !t.when || t.when.kind !== 'timer') continue;
            var every = Math.max(1, Number(t.when.seconds) || 1) * 1000;
            if (!timerLast[t.id]) { timerLast[t.id] = now; continue; }
            if (now - timerLast[t.id] < every) continue;
            timerLast[t.id] = now;
            A.fire(t.id, 'every ' + t.when.seconds + 's of real time');
        }
    }

    A.available = function () {
        var why = [];
        if (!$.console || !$.console.snippets) {
            why.push('the console module did not load, so there is no snippet library to schedule.');
        } else if (!$.console.snippets().length) {
            why.push('the snippet library is empty.');
        }
        return { ok: !why.length, why: why.join(' ') };
    };

    /* =====================================================================
       PART 5 — ROUTE

       Per project, because a mod-loader layout gives two projects one data
       directory and a run recorded in one of them is not a run in the other.
       The key is resolved LAZILY: this file loads before the boot report, so
       $.profile.active().name at load time is the generic "this game" and
       every project's runs would be filed under one key.
       ===================================================================== */
    var book = null;           // { seq, current, routes:[] } for the live key
    var bookKey = null;
    var routeRaw = null;       // the whole file, all keys

    function gameKey() {
        var name = $.safe(function () {
            return ($.profile && $.profile.active) ? $.profile.active().name : '';
        }, 'auto: profile name', '');
        var s = slug(name);
        if (s && s !== 'this-game') return s;
        return slug($.paths.gameKey) || 'unknown';
    }

    function readBook() {
        var key = gameKey();
        if (book && bookKey === key) return book;
        if (!routeRaw) {
            routeRaw = $.store.read(ROUTE_FILE, null);
            if (!routeRaw || typeof routeRaw !== 'object' || !routeRaw.games) {
                routeRaw = { _schema: 1, games: {} };
            }
        }
        var b = routeRaw.games[key];
        if (!b || typeof b !== 'object') b = { seq: 1, current: null, routes: [] };
        if (!b.routes || !b.routes.length) b.routes = [];
        b.seq = Number(b.seq) || 1;
        /* Normalised on the way in: a record written by hand, or by an older
           schema, must not reach the matcher half-formed. */
        b.routes = b.routes.filter(function (r) { return r && r.id; }).map(function (r) {
            return {
                id: String(r.id), name: String(r.name || r.id),
                splits: (r.splits || []).filter(function (s) { return s && s.sid && s.when; })
                    .map(function (s) {
                        return { sid: String(s.sid), label: String(s.label || ''), when: s.when };
                    }),
                best: r.best && typeof r.best === 'object' ? {
                    at: Number(r.best.at) || 0,
                    total: (typeof r.best.total === 'number') ? r.best.total : null,
                    totalValid: r.best.totalValid !== false,
                    splits: r.best.splits && typeof r.best.splits === 'object' ? r.best.splits : {},
                    db: r.best.db && typeof r.best.db === 'object' ? r.best.db : null
                } : null
            };
        });
        routeRaw.games[key] = b;
        book = b; bookKey = key;
        return book;
    }
    var routeWritten = false;
    function writeBook() {
        readBook();
        routeRaw.games[bookKey] = book;
        $.store.write(ROUTE_FILE, routeRaw, routeWritten);
        routeWritten = true;
    }

    var R = A.route = {};
    R.gameKey = function () { return gameKey(); };
    R.list = function () { return readBook().routes.map(function (r) { return $.clone(r); }); };
    R.raw = function () { return readBook().routes; };

    R.current = function () {
        var b = readBook();
        for (var i = 0; i < b.routes.length; i++) if (b.routes[i].id === b.current) return b.routes[i];
        return b.routes.length ? b.routes[0] : null;
    };
    function currentRoute() { return R.current(); }

    R.select = function (id) {
        var b = readBook();
        b.current = id;
        writeBook();
        recomputeSource();
        return R.current();
    };

    R.create = function (name) {
        if (!$.allowWrite('Creating a route')) return null;
        var b = readBook();
        var r = {
            id: 'r' + (b.seq++).toString(36),
            name: String(name || 'route').slice(0, 40) || 'route',
            splits: [], best: null
        };
        b.routes.push(r);
        b.current = r.id;
        writeBook();
        return r;
    };

    R.duplicate = function (id) {
        var b = readBook(), src = null, i;
        for (i = 0; i < b.routes.length; i++) if (b.routes[i].id === id) src = b.routes[i];
        if (!src) return null;
        if (!$.allowWrite('Duplicating a route')) return null;
        var r = {
            id: 'r' + (b.seq++).toString(36),
            name: (src.name + ' copy').slice(0, 40),
            /* New sids: a copy that shared its sids would share the original's
               best times, and editing one would silently move the other's. */
            splits: src.splits.map(function (s) {
                return { sid: 'x' + (b.seq++).toString(36), label: s.label, when: s.when };
            }),
            best: null
        };
        b.routes.push(r); b.current = r.id;
        writeBook();
        return r;
    };

    R.remove = function (id) {
        var b = readBook();
        for (var i = 0; i < b.routes.length; i++) {
            if (b.routes[i].id !== id) continue;
            if (!$.allowWrite('Deleting a route')) return false;
            b.routes.splice(i, 1);
            if (b.current === id) b.current = b.routes.length ? b.routes[0].id : null;
            writeBook();
            recomputeSource();
            return true;
        }
        return false;
    };

    function findRoute(id) {
        var b = readBook();
        for (var i = 0; i < b.routes.length; i++) if (b.routes[i].id === id) return b.routes[i];
        return null;
    }

    /** '' when the condition is new to this route, or the sentence refusing it. */
    R.duplicateWhy = function (routeId, when) {
        var r = findRoute(routeId);
        if (!r) return '';
        var k = whenKeyOf(when);
        for (var i = 0; i < r.splits.length; i++) {
            if (whenKeyOf(r.splits[i].when) === k) {
                return 'this route already splits on that, and two splits on one condition would ' +
                    'both fire on the same edge.';
            }
        }
        return '';
    };

    /**
     * Add a split.
     *
     * The best run is NOT rewritten. Its total stops being comparable, because
     * a total recorded before this split existed is a total for a different
     * route — but every per-split comparison that still has a match keeps
     * working, and no stored time is touched.
     */
    R.addSplit = function (routeId, when, label) {
        var r = findRoute(routeId);
        if (!r || !when || !when.kind) return null;
        if (!$.allowWrite('Adding a split')) return null;
        if (R.duplicateWhy(routeId, when)) return null;
        var b = readBook();
        var sid = 'x' + (b.seq++).toString(36);
        r.splits.push({ sid: sid, label: String(label || describeWhen(when)).slice(0, 40), when: when });
        if (r.best && r.best.totalValid) {
            r.best.totalValid = false;
            $.log('warn', 'route "' + r.name + '": the best run predates a split that has since been ' +
                'added, so its total is no longer this route. Every split time it holds is untouched.');
        }
        writeBook();
        recomputeSource();
        return sid;
    };

    R.removeSplit = function (routeId, sid) {
        var r = findRoute(routeId);
        if (!r) return false;
        for (var i = 0; i < r.splits.length; i++) {
            if (r.splits[i].sid !== sid) continue;
            if (!$.allowWrite('Deleting a split')) return false;
            r.splits.splice(i, 1);
            /* The best run keeps its time for the deleted split. Dropping it
               would throw away a number the user cannot get back, and the
               panel says how many stored times no longer have a split. */
            writeBook();
            recomputeSource();
            return true;
        }
        return false;
    };

    R.renameSplit = function (routeId, sid, label) {
        var r = findRoute(routeId);
        if (!r) return false;
        for (var i = 0; i < r.splits.length; i++) {
            if (r.splits[i].sid !== sid) continue;
            r.splits[i].label = String(label || '').slice(0, 40) || describeWhen(r.splits[i].when);
            writeBook();
            return true;
        }
        return false;
    };

    R.moveSplit = function (routeId, sid, delta) {
        var r = findRoute(routeId);
        if (!r) return false;
        for (var i = 0; i < r.splits.length; i++) {
            if (r.splits[i].sid !== sid) continue;
            var to = i + delta;
            if (to < 0 || to >= r.splits.length) return false;
            var moved = r.splits.splice(i, 1)[0];
            r.splits.splice(to, 0, moved);
            writeBook();
            return true;
        }
        return false;
    };

    /** Best-run entries whose split has since been deleted. */
    R.orphans = function (routeId) {
        var r = findRoute(routeId);
        if (!r || !r.best) return [];
        var have = {}, i, out = [];
        for (i = 0; i < r.splits.length; i++) have[r.splits[i].sid] = 1;
        for (var sid in r.best.splits) if (!have[sid]) out.push(sid);
        return out;
    };

    function dbSignature() {
        return { switches: switchCount(), variables: varCount() };
    }
    /** '' when the stored record matches the live tables, or the sentence. */
    R.dbDrift = function (routeId) {
        var r = findRoute(routeId);
        if (!r || !r.best || !r.best.db || !dbReady()) return '';
        var now = dbSignature();
        var was = r.best.db;
        if (was.switches === now.switches && was.variables === now.variables) return '';
        return 'this project\'s tables have changed size since this route was recorded (' +
            was.switches + ' → ' + now.switches + ' switches, ' + was.variables + ' → ' +
            now.variables + ' variables) — a split on a switch or variable id may no longer be the ' +
            'same one.';
    };

    /* ------------------------------------------------------------ the run */
    var run = {
        state: 'idle',       // 'idle' | 'running' | 'finished' | 'void'
        why: '',
        routeId: null,
        anchor: 0,
        startedAt: 0,
        splits: {},
        speedTouched: false,
        clockJumped: false,
        jumpBy: 0,
        loaded: false
    };

    R.run = function () { return $.clone(run); };

    R.start = function (why) {
        var f = engineFrame();
        if (f === null) return null;
        var r = currentRoute();
        run = {
            state: 'running', why: why || '',
            routeId: r ? r.id : null,
            anchor: f, startedAt: Date.now(),
            splits: {}, speedTouched: speedIsOn(), clockJumped: false, jumpBy: 0, loaded: false
        };
        recomputeSource();
        $.log('ok', 'run started at engine frame ' + f + (why ? ' — ' + why : ''));
        return R.run();
    };
    R.stop = function () {
        if (run.state === 'running') run.state = 'finished';
        recomputeSource();
        return R.run();
    };
    R.reanchor = function () {
        var f = engineFrame();
        if (f === null) return null;
        run.anchor = f;
        run.startedAt = Date.now();
        run.splits = {};
        run.clockJumped = false; run.jumpBy = 0; run.loaded = false;
        if (run.state !== 'running') run.state = 'running';
        recomputeSource();
        return R.run();
    };
    R.voidRun = function (why) {
        run.state = 'void';
        run.why = why || 'voided by hand';
        recomputeSource();
        return R.run();
    };

    /**
     * Frames since the anchor, or null when there is no answer.
     *
     * A voided run returns null rather than a negative number: loading a save
     * from before the anchor makes the subtraction come out below zero, and a
     * minus sign in a run timer is a bug report waiting to happen. The reason
     * is on run.why, where the panel prints it.
     */
    R.elapsed = function () {
        var f = engineFrame();
        if (f === null || run.state === 'idle' || run.state === 'void') return null;
        return f - run.anchor;
    };

    R.complete = function () {
        var r = currentRoute();
        if (!r || !r.splits.length) return false;
        for (var i = 0; i < r.splits.length; i++) {
            if (run.splits[r.splits[i].sid] === undefined) return false;
        }
        return true;
    };
    R.total = function () {
        var r = currentRoute();
        if (!r || !r.splits.length) return null;
        var last = r.splits[r.splits.length - 1];
        var v = run.splits[last.sid];
        return v === undefined ? null : v;
    };

    R.best = function (routeId) {
        var r = routeId ? findRoute(routeId) : currentRoute();
        return r && r.best ? $.clone(r.best) : null;
    };

    R.saveBest = function () {
        var r = currentRoute();
        if (!r || !R.complete()) return null;
        if (!$.allowWrite('Saving the best run')) return null;
        r.best = {
            at: Date.now(),
            total: R.total(),
            totalValid: true,
            splits: $.clone(run.splits),
            db: dbSignature()
        };
        writeBook();
        $.log('ok', 'best run saved for "' + r.name + '" — ' + clockText(r.best.total));
        return $.clone(r.best);
    };
    R.clearBest = function (routeId) {
        var r = routeId ? findRoute(routeId) : currentRoute();
        if (!r || !r.best) return false;
        if (!$.allowWrite('Clearing the best run')) return false;
        r.best = null;
        writeBook();
        return true;
    };
    R.keepBestStopTotals = function (routeId) {
        var r = routeId ? findRoute(routeId) : currentRoute();
        if (!r || !r.best) return false;
        r.best.totalValid = false;
        writeBook();
        return true;
    };
    R.forgetProject = function () {
        if (!$.allowWrite('Forgetting every run for this project')) return false;
        readBook();
        delete routeRaw.games[bookKey];
        book = null; bookKey = null;
        $.store.write(ROUTE_FILE, routeRaw, routeWritten);
        routeWritten = true;
        run = { state: 'idle', why: '', routeId: null, anchor: 0, startedAt: 0, splits: {},
            speedTouched: false, clockJumped: false, jumpBy: 0, loaded: false };
        recomputeSource();
        return true;
    };

    /** Drop every cache and re-read, as a launch would. */
    R.reload = function () {
        $.store.flush();
        routeRaw = null; book = null; bookKey = null;
        readBook();
        recomputeSource();
        return R.list().length;
    };

    function recordSplit(sid, frame) {
        if (run.splits[sid] !== undefined) return false;
        run.splits[sid] = frame - run.anchor;
        if (R.complete()) {
            if (on('route.autoBest')) {
                var r = currentRoute();
                var better = !r.best || !r.best.totalValid ||
                    (typeof r.best.total !== 'number') || R.total() < r.best.total;
                if (better) R.saveBest();
            }
            run.state = 'finished';
            recomputeSource();
        }
        return true;
    }

    function splitMatching(e) {
        if (!on('route.on')) return;
        if (run.state !== 'running') return;
        var r = currentRoute();
        if (!r) return;
        var f = engineFrame();
        if (f === null) return;
        for (var i = 0; i < r.splits.length; i++) {
            var s = r.splits[i];
            if (run.splits[s.sid] !== undefined) continue;
            if (!matchEdge(s.when, e)) continue;
            recordSplit(s.sid, f);
        }
    }

    /**
     * The manual split, and the escape hatch that keeps "only a few sources"
     * from being a wall: a snippet can test anything at all and then call
     * this. A label with no split of its own appends one — by the same rule as
     * adding a split by hand, which is why the best run's total stops being
     * comparable and says so.
     */
    R.mark = function (label) {
        label = String(label == null ? '' : label).slice(0, 40);
        if (!label) return null;
        var r = currentRoute();
        if (!r) return null;
        var f = engineFrame();
        if (f === null) return null;
        var sid = null, i;
        for (i = 0; i < r.splits.length; i++) {
            if (String(r.splits[i].label).toLowerCase() === label.toLowerCase()) sid = r.splits[i].sid;
        }
        if (!sid) sid = R.addSplit(r.id, { kind: 'manual', label: label }, label);
        if (!sid) return null;
        if (run.state === 'running') recordSplit(sid, f);
        return sid;
    };

    function speedIsOn() {
        return $.safe(function () {
            if (!$.player || !$.player.speedyAvailable || !$.player.speedyAvailable()) return false;
            if (!$.store.cfgGet('player.speedy', false)) return false;
            return Number($.store.cfgGet('player.gameSpeed', 1)) !== 1;
        }, 'auto: speed multiplier', false);
    }

    /* =====================================================================
       PART 6 — HOOKS

       Every one is purely additive: it calls the original exactly once, on
       every path, and returns the original's value.
       ===================================================================== */

    /* The one function every map entry passes through — a transfer, a new game
       and a load all land in it, on both engines. It runs BEFORE the map scene
       exists, which is what makes it earlier and far more reliable than
       Scene_Map.onMapLoaded, a method menu- and map-replacing plugins commonly
       own. The wrapper runs after the original so mapId() already reads the
       new id, and it does nothing but record: the map is mid-rebuild and
       $gameMap._events is not populated yet, so resolving the map's NAME waits
       until a panel paints. */
    $.install(HOOK_MAP,
        typeof Game_Map !== 'undefined' ? Game_Map.prototype : null, 'setup',
        function (original) {
            return function (mapId) {
                var r = original.apply(this, arguments);
                $.safe(function () { onEdge({ kind: 'map', id: Number(mapId) }); }, 'auto: map edge');
                return r;
            };
        },
        REASONS[HOOK_MAP]);

    /* The single entry point every battle passes through on both engines — a
       map encounter, an event-called troop and GigaHack's own forced troop
       alike. Scene_Battle.create is routinely replaced by battle-system
       plugins and $gameParty.inBattle() only flips later, so neither is a
       dependable edge. After the original, so $gameTroop is set up. */
    $.install(HOOK_BATTLE,
        typeof BattleManager !== 'undefined' ? BattleManager : null, 'setup',
        function (original) {
            return function (troopId) {
                var r = original.apply(this, arguments);
                $.safe(function () { onEdge({ kind: 'battle', id: Number(troopId) || 0 }); },
                    'auto: battle edge');
                return r;
            };
        },
        REASONS[HOOK_BATTLE]);

    /* The one place a new game begins on both engines, and it runs BEFORE the
       first map is set up — so a run anchored here is anchored before any
       split can be reached, which is the difference between a route whose
       first split is the starting map and one whose first split is
       unreachable. Note this is NOT where the engine clock is reset:
       Graphics.frameCount has been running since the title screen and the
       engine never zeroes it, which is why a run stores an anchor rather than
       assuming zero. */
    $.install(HOOK_NEWGAME,
        typeof DataManager !== 'undefined' ? DataManager : null, 'setupNewGame',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                $.safe(function () {
                    A.clockReset();
                    if (on('route.on') && on('route.startOnNewGame') && currentRoute()) {
                        R.start('a new game was started');
                    }
                }, 'auto: new game');
                return r;
            };
        },
        REASONS[HOOK_NEWGAME]);

    /* createGameObjects has just replaced every $game* global, so every
       baseline held against the old ones is meaningless, and this is the first
       moment the LOADED state is actually in place. It is also how a load is
       told apart from an ordinary frame — the clock jump itself is detected by
       MEASUREMENT rather than by a hook, because measurement also catches the
       playtime editor writing Graphics.frameCount directly, which no load hook
       would. Nothing here caches $gameSwitches or $gameVariables: the objects
       it is called about are brand new. */
    var loadStamp = -1;
    $.install(HOOK_LOAD,
        typeof DataManager !== 'undefined' ? DataManager : null, 'extractSaveContents',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                $.safe(function () {
                    loadStamp = $.frameCount;
                    primePoll();
                    if (on('route.on') && on('route.startOnLoad') && currentRoute()) {
                        R.start('a save was loaded');
                    }
                }, 'auto: load stamp');
                return r;
            };
        },
        REASONS[HOOK_LOAD]);

    /* Hooks already emits this from its own createGameObjects alias on BOTH
       the new-game and the load path, so Auto adds no second alias for it. */
    $.on('gameobjects', function () {
        book = null; bookKey = null;   // the title may have changed with the world
        pollArmed = false;
        A.clockReset();
        recomputeSource();
    });

    /* =====================================================================
       PART 7 — THE PER-FRAME SAMPLER

       One hook. It measures the clock, drains the queued notices, polls where
       there is no write-time source, and runs the real-time timers.
       ===================================================================== */
    $.onFrame('auto', function () {
        var f = engineFrame();
        if (f !== null) {
            if (clock.last !== null) {
                var d = f - clock.last;
                var limit = Math.floor(num('route.jumpFrames', 1, 60 * 60 * 60));
                if (d < 0 || d > limit) {
                    /* A discontinuity nobody played. Which of the two it was is
                       decided by whether a load was stamped on this frame or
                       the last one — a load teleports the clock to the save's
                       recorded frame, and the playtime editor writes it
                       outright with no hook at all. */
                    var wasLoad = (loadStamp >= 0 && $.frameCount - loadStamp <= 1);
                    clock.jumpAt = $.frameCount;
                    clock.jumpBy = d;
                    clock.jumpWhy = wasLoad
                        ? 'a save was loaded, so the engine clock moved to that save\'s play time'
                        : 'the engine clock was written directly — editing the play time does that, ' +
                          'and no hook can see it';
                    if (run.state === 'running') {
                        if (wasLoad && f < run.anchor) {
                            run.state = 'void';
                            run.why = 'you loaded a save from before this run started, so there is ' +
                                'no elapsed time to report.';
                        } else {
                            /* The anchor moves with the clock: a jump the
                               player did not play must not land in the elapsed
                               time. The run is marked instead. */
                            run.anchor += d;
                            run.clockJumped = true;
                            run.jumpBy += d;
                            run.loaded = run.loaded || wasLoad;
                            run.why = clock.jumpWhy + ' — the anchor moved with it, so the elapsed ' +
                                'time is still what was played, and this run is marked.';
                        }
                    }
                } else {
                    clock.ring.push(d);
                    clock.sum += d;
                    while (clock.ring.length > CLOCK_WINDOW) clock.sum -= clock.ring.shift();
                    if (heldNow()) {
                        clock.heldSteps++;
                        if (d > 0) clock.heldMoved++;
                    }
                }
            }
            clock.last = f;
        }

        if (run.state === 'running' && speedIsOn()) run.speedTouched = true;

        if (notices.length) {
            var queued = notices.slice();
            notices.length = 0;
            for (var i = 0; i < queued.length; i++) {
                $.log(queued[i].level, queued[i].msg);
                if (queued[i].toast && U.toast) U.toast(queued[i].toast);
            }
        }

        pollOnce();
        fireTimers();
    });

    /* =====================================================================
       PART 8 — PANEL: DEBUG → TRIGGERS
       ===================================================================== */
    var tQuery = '';
    var tChips = { armed: true, off: true, errored: true };
    var draft = {
        source: SRC_SWITCH_ON, id: 1, test: VAR_TESTS[0], value: 1,
        seconds: 30, snippet: null, name: ''
    };

    /** The sources whose hook installed. One that did not is DROPPED. */
    function availableSources() {
        var out = [SRC_SWITCH_ON, SRC_SWITCH_OFF, SRC_VAR];
        if (installed(HOOK_MAP)) out.push(SRC_MAP);
        if (installed(HOOK_BATTLE)) out.push(SRC_BATTLE);
        out.push(SRC_TIMER);
        return out;
    }
    function droppedSources() {
        var out = [];
        if (!installed(HOOK_MAP)) out.push({ label: SRC_MAP, why: hookWhy(HOOK_MAP) });
        if (!installed(HOOK_BATTLE)) out.push({ label: SRC_BATTLE, why: hookWhy(HOOK_BATTLE) });
        return out;
    }

    function draftWhen() {
        if (draft.source === SRC_SWITCH_ON) return { kind: 'switch', id: draft.id, on: true };
        if (draft.source === SRC_SWITCH_OFF) return { kind: 'switch', id: draft.id, on: false };
        if (draft.source === SRC_VAR) {
            return { kind: 'var', id: draft.id, test: testKey(draft.test), value: draft.value };
        }
        if (draft.source === SRC_MAP) return { kind: 'map', id: draft.id };
        if (draft.source === SRC_BATTLE) return { kind: 'battle' };
        return { kind: 'timer', seconds: draft.seconds };
    }

    function snippetNames() {
        return ($.console && $.console.snippets) ? $.console.snippets() : [];
    }
    function snippetByName(name) {
        var list = snippetNames();
        for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
        return null;
    }

    function writesGroup() {
        var list = ($.compat && $.compat.degradedList) ? $.compat.degradedList() : [];
        var rows = [];
        if (!list.length) {
            rows.push(note('nothing GigaHack writes has been refused this session.'));
        } else {
            list.forEach(function (d) {
                rows.push(longNote(d.control, d.why));
                rows.push(W.button({
                    label: 'try "' + d.control + '" again', wide: true, mini: true, _ungated: true,
                    onClick: function () { $.compat.clearDegraded(d.control); U.rerender(); }
                }));
            });
        }
        return W.group('Writes', rows, { tag: list.length ? String(list.length) : 'clear' });
    }

    function buildTriggers() {
        loadTriggers();

        if (!$.console || !$.console.snippets) {
            return U.todo('Debug', 'Triggers', [
                'the console module did not load, so there is no snippet library to schedule.',
                'A trigger runs a saved snippet by id; without a library there is nothing to run.',
                'Install GigaHack_Console.js.'
            ]);
        }

        var snips = snippetNames();
        var src = A.source();

        /* ---------------------------------------------------------- table */
        function rows() {
            var q = tQuery;
            return triggers.filter(function (t) {
                var state = t.disabledWhy ? 'errored' : (t.on ? 'armed' : 'off');
                if (!tChips[state]) return false;
                if (!q) return true;
                var snip = $.console.snippet(t.snippet);
                var hay = (t.name + ' ' + (snip ? snip.name : t.snippet) + ' ' +
                    describeWhen(t.when)).toLowerCase();
                return hay.indexOf(q) > -1;
            });
        }

        /* Non-virtual on purpose: the row count here is OURS — tens — not the
           project's, and a windowed table would cost a scroll listener and a
           spacer skeleton for nothing. */
        var table = W.table({
            key: 'auto:triggers', rowH: 17, virtual: false,
            empty: 'no triggers yet — build one on the right',
            cols: [
                { label: 'on', w: '0 0 26px' },
                { label: 'name', w: '1 1 0' },
                { label: 'when', w: '2 2 0' },
                { label: 'runs', w: '0 0 40px', cls: 'mm-td-num' },
                { label: 'last fire', w: '0 0 92px', cls: 'mm-td-num' },
                { label: 'result', w: '2 2 0' },
                { label: 'run', w: '0 0 34px' },
                { label: '', w: '0 0 22px' }
            ],
            render: function (t) {
                var snip = $.console.snippet(t.snippet);
                var when = h('span', {
                    class: rangeWhy(t.when) ? 'mm-sev-warn' : '', text: describeWhen(t.when)
                });
                var result = t.lastError
                    ? h('span', { class: 'mm-sev-err', text: t.lastError })
                    : (t.lastResult || '—');
                return [
                    W.checkbox({
                        value: t.on, label: t.name, _ungated: true,
                        onChange: function (v) { A.enableTrigger(t.id, v); U.rerender(); }
                    }),
                    W.editCell(t.name || '(unnamed)', function (v) {
                        A.renameTrigger(t.id, v); return v;
                    }),
                    when,
                    String(t.runs),
                    t.lastFrame ? clockText(t.lastFrame) : 'never',
                    result,
                    W.button({
                        label: '▶', mini: true, mutates: true,
                        disabled: !snip,
                        tip: snip ? null : 'Cannot run|The snippet it ran was deleted.',
                        onClick: function () { A.fire(t.id, 'run by hand'); U.rerender(); }
                    }),
                    W.button({
                        label: '−', mini: true, variant: 'danger',
                        onClick: function () { A.removeTrigger(t.id); U.rerender(); }
                    })
                ];
            },
            onRow: function (tr, t) {
                if (t.disabledWhy) {
                    tr.setAttribute('data-mm-tip', 'Disabled|' + t.disabledWhy +
                        ' — switching it back on clears the error and re-arms it.');
                }
            }
        });
        table.mm.paint(rows());

        /* A fire while this panel is open repaints the table IN PLACE. A
           rerender would rebuild the whole tab and take the name field's focus
           and the scroll position with it. */
        var painted = -1;
        var host = U.getHost();
        if (host && host.fastHooks) {
            host.fastHooks.push(function (n) {
                if (n % 6) return;
                if (table.mm.isScrolling()) return;
                var total = 0;
                for (var i = 0; i < triggers.length; i++) total += triggers[i].runs;
                if (total === painted) return;
                painted = total;
                if (!document.body.contains(table)) return;
                table.mm.paint(rows());
            });
        }

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({
                placeholder: 'search triggers…', value: tQuery,
                onInput: function (v) { tQuery = v; table.mm.paint(rows()); }
            }),
            ['armed', 'off', 'errored'].map(function (k) {
                return W.chip({
                    label: k, value: tChips[k],
                    onChange: function (v) { tChips[k] = v; table.mm.paint(rows()); }
                });
            }));

        /* ------------------------------------------------------ last fire */
        var last = A.lastFire();
        var lastRows = [];
        if (last) {
            lastRows.push(kv('Trigger', last.name));
            lastRows.push(kv('At', 'engine frame ' + last.frame + ' · ' + clockText(last.frame)));
            lastRows.push(kv('Returned', last.ok ? (last.result || '(nothing)') : 'it threw'));
            if (last.error) lastRows.push(longNote('Message', last.error));
        } else {
            lastRows.push(note('nothing has fired yet this session.'));
        }
        var refusal = A.lastRefusal();
        if (refusal) lastRows.push(longNote('Last refusal', refusal.why));
        if (A.persistFailed()) {
            lastRows.push(warnNote('the trigger list could not be written and will not persist this ' +
                'session — Debug → Environment names the directory it tried.'));
        }

        /* ----------------------------------------------------- new trigger */
        var sources = availableSources();
        if (sources.indexOf(draft.source) < 0) draft.source = sources[0];
        var needsId = draft.source === SRC_SWITCH_ON || draft.source === SRC_SWITCH_OFF ||
            draft.source === SRC_VAR || draft.source === SRC_MAP;
        var isSwitch = draft.source === SRC_SWITCH_ON || draft.source === SRC_SWITCH_OFF;
        var isVar = draft.source === SRC_VAR;
        var isMap = draft.source === SRC_MAP;

        var live = dbReady() && $.vars && $.vars.alive && $.vars.alive();
        var ceiling = isSwitch ? (switchCount() || 1) : isVar ? (varCount() || 1) : 9999;

        var newRows = [
            W.row('When', W.dropdown({
                options: sources, value: draft.source, width: '138px', _ungated: true,
                onChange: function (v) { draft.source = v; U.rerender(); }
            }))
        ];
        droppedSources().forEach(function (d) {
            newRows.push(warnNote('"' + d.label + '" is not offered: ' + d.why));
        });
        if (needsId) {
            newRows.push(W.row(isMap ? 'Map id' : isSwitch ? 'Switch id' : 'Variable id',
                W.number({
                    value: draft.id, min: 1, max: ceiling, _ungated: true, label: 'id',
                    disabled: !live && !isMap,
                    onChange: function (v) { draft.id = v; U.rerender(); }
                }), {
                    sub: isMap ? (mapName(draft.id) || '') : '',
                    tip: (!live && !isMap)
                        ? 'No database|It has not loaded, so there is no id range to pick from.'
                        : null
                }));
            if (!live && !isMap) {
                newRows.push(warnNote('the database has not loaded yet, so there is no id range to ' +
                    'pick from. The ceiling here is computed from $dataSystem, never written down.'));
            }
            if (isMap && !$.map) {
                newRows.push(note('the map module did not load, so a map cannot be named here; the ' +
                    'id still works.'));
            }
        }
        if (isVar) {
            newRows.push(W.row('Test', W.dropdown({
                options: VAR_TESTS, value: draft.test, width: '138px', _ungated: true,
                onChange: function (v) { draft.test = v; U.rerender(); }
            })));
            if (testKey(draft.test) !== 'changes') {
                newRows.push(W.row('Value', W.number({
                    value: draft.value, _ungated: true, label: 'value',
                    onChange: function (v) { draft.value = v; }
                })));
            }
        }
        if (draft.source === SRC_TIMER) {
            newRows.push(W.row('Every', W.slider({
                value: draft.seconds, min: 1, max: 600, step: 1, unit: 's', width: '138px',
                _ungated: true, label: 'seconds',
                onChange: function (v) { draft.seconds = v; }
            }), { sub: 'real seconds — the game speed multiplier does not change it' }));
        }
        if (draft.source === SRC_BATTLE) {
            newRows.push(note('fires as the battle is set up, before its scene exists.'));
        }

        if (!snips.length) {
            newRows.push(warnNote('no snippets saved yet — Debug → Console → "save as snippet" ' +
                'writes one, and this list reads that same library.'));
        } else {
            var names = snips.map(function (s) { return s.name; });
            if (!draft.snippet || names.indexOf(draft.snippet) < 0) draft.snippet = names[0];
            newRows.push(W.row('Snippet', W.dropdown({
                options: names, value: draft.snippet, width: '124px', _ungated: true,
                onChange: function (v) { draft.snippet = v; }
            })));
        }
        newRows.push(W.row('Name', W.text({
            value: draft.name, placeholder: 'name (optional)',
            onInput: function (v) { draft.name = v; }
        })));

        var picked = draft.snippet ? snippetByName(draft.snippet) : null;
        var addWhy = '';
        if (!picked) addWhy = 'pick a snippet: a trigger is a schedule over one, not a new language.';
        else if (needsId && rangeWhy(draftWhen())) {
            addWhy = describeWhen(draftWhen()) + ' does not exist on this project.';
        }
        newRows.push(W.button({
            label: 'add the trigger', wide: true, variant: 'prime', mutates: true,
            disabled: !!addWhy,
            onClick: function () {
                A.addTrigger({ when: draftWhen(), snippet: picked.id, name: draft.name });
                draft.name = '';
                U.rerender();
            }
        }));
        if (addWhy) newRows.push(note(addWhy));

        /* --------------------------------------------------------- safety */
        var pauseOk = !!($.pause && $.pause.available && $.pause.available());
        var safety = W.group('Safety', [
            W.row('Fires a second, max', W.number({
                value: num('triggers.maxPerSecond', 1, 60), min: 1, max: 60, _ungated: true,
                label: 'fires per second',
                onChange: function (v) { setCfg('triggers.maxPerSecond', v); }
            }), { tip: 'Ceiling|Over it the trigger is switched off, not throttled.' }),
            W.row('Cascade depth', W.number({
                value: num('triggers.maxDepth', 1, 8), min: 1, max: 8, _ungated: true,
                label: 'cascade depth',
                onChange: function (v) { setCfg('triggers.maxDepth', v); }
            }), { tip: 'Cascade|How deep one trigger may set off the next.' }),
            W.toggleRow('Disable a trigger that throws', {
                value: on('triggers.disableOnThrow'), _ungated: true,
                sub: on('triggers.disableOnThrow') ? '' :
                    'off means it is rate-limited to one fire a second and keeps the error instead',
                onChange: function (v) { setCfg('triggers.disableOnThrow', v); U.rerender(); }
            }),
            W.toggleRow('Run while the game is held', {
                value: on('triggers.whilePaused'), _ungated: true,
                disabled: !pauseOk,
                sub: pauseOk ? '' : 'pause is unavailable on this build',
                tip: pauseOk ? null : 'Unavailable|' +
                    (($.pause && $.pause.why) ? $.pause.why() : 'no gateable step function') +
                    ', so there is no held state to run in.',
                onChange: function (v) { setCfg('triggers.whilePaused', v); }
            }),
            W.toggleRow('Toast when one fires', {
                value: on('triggers.toastOnFire'), _ungated: true,
                onChange: function (v) { setCfg('triggers.toastOnFire', v); }
            }),
            W.button({
                label: 're-arm every disabled trigger', wide: true, mutates: true,
                onClick: function () { A.armAll(); U.rerender(); }
            })
        ]);

        /* --------------------------------------------------- watch source */
        var targets = ($.pause && $.pause.targets) ? $.pause.targets() : [];
        var sourceRows = [
            kv('Detection', src.detection),
            longNote('Blind spot', src.blind),
            longNote('Frame hook', targets.length
                ? 'rides on ' + targets.join(', ') + ', which is what also drives the overlay'
                : 'nothing gateable was found — ' + (($.pause && $.pause.why) ? $.pause.why() : ''))
        ];
        if (src.via !== 'trace') sourceRows.unshift(warnNote(src.why));

        var body = cols(
            [
                W.group('Triggers', [toolbar, table], { grow: true, tag: armedCount() + ' armed' }),
                W.group('Last fire', lastRows,
                    { tag: A.history().length + ' fire(s) this session' })
            ],
            {
                narrow: true, items: [
                    W.group('New trigger', newRows),
                    safety,
                    W.group('Watch source', sourceRows, { tag: src.via }),
                    writesGroup()
                ]
            });
        return body;
    }

    U.debugPanel('Triggers', function () { return buildTriggers(); }, 76);

    /* =====================================================================
       PART 9 — PANEL: PLAYER → ROUTE
       ===================================================================== */
    var rDraft = { source: SRC_SWITCH_ON, id: 1, test: VAR_TESTS[0], value: 1, label: '' };
    var newRouteName = '';

    function rDraftWhen() {
        if (rDraft.source === SRC_SWITCH_ON) return { kind: 'switch', id: rDraft.id, on: true };
        if (rDraft.source === SRC_SWITCH_OFF) return { kind: 'switch', id: rDraft.id, on: false };
        if (rDraft.source === SRC_VAR) {
            return { kind: 'var', id: rDraft.id, test: testKey(rDraft.test), value: rDraft.value };
        }
        return { kind: 'map', id: rDraft.id };
    }
    function splitSources() {
        var out = [SRC_SWITCH_ON, SRC_SWITCH_OFF, SRC_VAR];
        if (installed(HOOK_MAP)) out.push(SRC_MAP);
        return out;
    }

    function stateText() {
        if (run.state === 'idle') return 'not started';
        if (run.state === 'void') return 'voided — ' + (run.why || 'no reason recorded');
        if (run.state === 'finished') return 'finished';
        var extra = [];
        if (run.speedTouched) extra.push('speed multiplier was on');
        if (run.clockJumped) extra.push('clock jumped ' + run.jumpBy + ' frames');
        return 'running' + (extra.length ? ' — ' + extra.join(', ') : '');
    }

    function buildRoute() {
        if (engineFrame() === null) {
            return U.todo('Player', 'Route', [
                'this build has no readable engine frame count, so there is no game clock to split against.',
                'A wall clock would measure your afternoon, not the run.'
            ]);
        }

        var b = readBook();
        var route = currentRoute();
        var ck = A.clock();

        /* ------------------------------------------------------------ run */
        var elapsedEl = h('b', { class: 'mm-mono mm-hi', text: '—' });
        var engineEl = h('span', { class: 'mm-mono', text: '—' });
        var ratioEl = h('span', { class: 'mm-sub', text: '—' });
        var playEl = h('span', { class: 'mm-mono', text: '—' });
        var stateEl = h('span', { class: 'mm-sub', text: '—' });

        function paintRun() {
            var f = engineFrame();
            var e = R.elapsed();
            elapsedEl.textContent = clockText(e);
            engineEl.textContent = f === null ? '—' : String(f);
            var p = perStep();
            ratioEl.textContent = p === null ? 'not measured yet' : p.toFixed(2) + ' per logical step';
            playEl.textContent = $.safe(function () {
                return ($gameSystem && $gameSystem.playtimeText) ? $gameSystem.playtimeText() : '—';
            }, 'auto: playtime', '—');
            stateEl.textContent = stateText();
        }
        paintRun();

        var runGroup = W.group('Run', [
            h('div', { class: 'mm-row' }, h('div', { class: 'mm-lab', text: 'Elapsed' }),
                h('div', { class: 'mm-edge' }, elapsedEl)),
            h('div', { class: 'mm-row' }, h('div', { class: 'mm-lab', text: 'Engine clock' }),
                h('div', { class: 'mm-edge' }, engineEl)),
            h('div', { class: 'mm-row' }, h('div', { class: 'mm-lab', text: 'Clock per step' }),
                h('div', { class: 'mm-edge mm-edge--shrink mm-edge--wrap' }, ratioEl)),
            h('div', { class: 'mm-row', tip: 'Game time|What the game will write into a save.' },
                h('div', { class: 'mm-lab', text: 'Game time' }),
                h('div', { class: 'mm-edge' }, playEl)),
            h('div', { class: 'mm-row' }, h('div', { class: 'mm-lab', text: 'State' }),
                h('div', { class: 'mm-edge mm-edge--shrink mm-edge--wrap' }, stateEl))
        ], {});

        /* --------------------------------------------------------- splits */
        var best = route && route.best ? route.best : null;
        var splitTable = W.table({
            key: 'auto:route', rowH: 17, virtual: false,
            empty: 'no splits yet',
            cols: [
                { label: '#', w: '0 0 22px', cls: 'mm-td-num' },
                { label: 'split', w: '2 2 0' },
                { label: 'when', w: '2 2 0' },
                { label: 'at', w: '0 0 74px', cls: 'mm-td-num' },
                { label: 'best', w: '0 0 74px', cls: 'mm-td-num' },
                { label: '±', w: '0 0 66px', cls: 'mm-td-num' },
                { label: '', w: '0 0 40px' },
                { label: '', w: '0 0 22px' }
            ],
            render: function (s, i) {
                var at = run.splits[s.sid];
                var bt = (best && typeof best.splits[s.sid] === 'number') ? best.splits[s.sid] : null;
                var delta = null;
                if (at !== undefined && bt !== null) delta = at - bt;
                var deltaCell;
                if (bt === null) {
                    deltaCell = h('span', {
                        class: 'mm-sub', text: '—',
                        tip: 'No comparison|The best run has no time for this split.'
                    });
                } else if (delta === null) {
                    deltaCell = '—';
                } else {
                    deltaCell = h('span', {
                        class: delta <= 0 ? 'mm-sev-ok' : 'mm-sev-err', text: deltaText(delta)
                    });
                }
                return [
                    String(i + 1),
                    W.editCell(s.label, function (v) { R.renameSplit(route.id, s.sid, v); return v; }),
                    h('span', {
                        class: rangeWhy(s.when) ? 'mm-sev-warn' : '', text: describeWhen(s.when)
                    }),
                    at === undefined ? '—' : clockText(at),
                    bt === null ? '—' : clockText(bt),
                    deltaCell,
                    [
                        W.button({
                            label: '↑', mini: true, _ungated: true,
                            onClick: function () { R.moveSplit(route.id, s.sid, -1); U.rerender(); }
                        }),
                        W.button({
                            label: '↓', mini: true, _ungated: true,
                            onClick: function () { R.moveSplit(route.id, s.sid, 1); U.rerender(); }
                        })
                    ],
                    W.button({
                        label: '−', mini: true, variant: 'danger',
                        confirmLabel: 'delete? the best keeps its time',
                        onClick: function () { R.removeSplit(route.id, s.sid); U.rerender(); }
                    })
                ];
            }
        });
        if (route) splitTable.mm.paint(route.splits);

        var host = U.getHost();
        if (host && host.fastHooks) {
            /* About 4 Hz. The readout must not write to the DOM sixty times a
               second, and a rerender per frame would take the focus out of the
               route-name field. */
            var lastSplits = -1;
            host.fastHooks.push(function (n) {
                if (n % 15) return;
                if (!document.body.contains(elapsedEl)) return;
                paintRun();
                if (!route || splitTable.mm.isScrolling()) return;
                var count = 0, k;
                for (k in run.splits) count++;
                if (count === lastSplits) return;
                lastSplits = count;
                splitTable.mm.paint(route.splits);
            });
        }

        var splitBody = route
            ? [splitTable]
            : [note('no route for this project yet — name one on the right, then add the first split.')];

        /* ---------------------------------------------------------- clock */
        var clockRows = [
            kv('Source', 'Graphics.frameCount'),
            longNote('Advances', ck.perStepWhy),
            longNote('While the game is held',
                ck.held.why + '. From the gate that installed: ' + ck.gate.why),
            W.row('Shown as', W.dropdown({
                options: PRECISIONS, value: precisionLabel(cfg('route.precision')),
                width: '104px', _ungated: true,
                onChange: function (v) { setCfg('route.precision', precisionKey(v)); U.rerender(); }
            }), { tip: 'Shown as|A split is recorded in frames; one is 1/60 s.' })
        ];
        if (ck.held.known && ck.gate.predictsStop !== null && ck.held.stops !== ck.gate.predictsStop) {
            clockRows.push(warnNote('the measurement and the gate list disagree — something other ' +
                'than GigaHack is moving the engine clock while the game is held. The measurement ' +
                'is what the run uses.'));
        }
        if (speedIsOn() && on('route.warnOnSpeed')) {
            clockRows.push(warnNote('the speed multiplier is on — this run is marked and its times ' +
                'are not comparable to one recorded at 1×.'));
        }
        if (ck.jumped) {
            clockRows.push(longNote('Last jump', deltaText(ck.jumpBy) + ' — ' + ck.jumpWhy));
        }

        /* ---------------------------------------------------------- route */
        var routeRows = [];
        var names = b.routes.map(function (r) { return r.name; });
        if (!names.length) {
            routeRows.push(note('no routes yet — name one below.'));
        } else {
            routeRows.push(W.row('Route', W.dropdown({
                options: names, value: route ? route.name : names[0], width: '138px', _ungated: true,
                onChange: function (v) {
                    for (var i = 0; i < b.routes.length; i++) {
                        if (b.routes[i].name === v) R.select(b.routes[i].id);
                    }
                    U.rerender();
                }
            })));
        }
        routeRows.push(W.row('New', W.text({
            value: newRouteName, placeholder: 'route name',
            onInput: function (v) { newRouteName = v; }
        })));
        routeRows.push(W.button({
            label: 'new route', wide: true, mutates: true,
            onClick: function () { R.create(newRouteName || 'route'); newRouteName = ''; U.rerender(); }
        }));
        if (route) {
            routeRows.push(W.button({
                label: 'duplicate', wide: true, mutates: true,
                onClick: function () { R.duplicate(route.id); U.rerender(); }
            }));
            routeRows.push(W.button({
                label: 'delete this route', wide: true, variant: 'danger',
                onClick: function () { R.remove(route.id); U.rerender(); }
            }));
        }

        var addRows = [];
        if (route) {
            var srcs = splitSources();
            if (srcs.indexOf(rDraft.source) < 0) rDraft.source = srcs[0];
            var rIsSwitch = rDraft.source === SRC_SWITCH_ON || rDraft.source === SRC_SWITCH_OFF;
            var rIsVar = rDraft.source === SRC_VAR;
            var rIsMap = rDraft.source === SRC_MAP;
            var rLive = dbReady() && $.vars && $.vars.alive && $.vars.alive();
            var rCeiling = rIsSwitch ? (switchCount() || 1) : rIsVar ? (varCount() || 1) : 9999;

            addRows.push(W.row('On', W.dropdown({
                options: srcs, value: rDraft.source, width: '138px', _ungated: true,
                onChange: function (v) { rDraft.source = v; U.rerender(); }
            })));
            if (!installed(HOOK_MAP)) {
                addRows.push(warnNote('"' + SRC_MAP + '" is not offered: ' + hookWhy(HOOK_MAP)));
            }
            addRows.push(W.row(rIsMap ? 'Map id' : rIsSwitch ? 'Switch id' : 'Variable id',
                W.number({
                    value: rDraft.id, min: 1, max: rCeiling, _ungated: true, label: 'id',
                    disabled: !rLive && !rIsMap,
                    onChange: function (v) { rDraft.id = v; U.rerender(); }
                }), { sub: rIsMap ? (mapName(rDraft.id) || '') : '' }));
            if (!rLive && !rIsMap) {
                addRows.push(warnNote('the database has not loaded yet, so there is no id range to ' +
                    'pick from.'));
            }
            if (rIsVar) {
                addRows.push(W.row('Test', W.dropdown({
                    options: VAR_TESTS, value: rDraft.test, width: '138px', _ungated: true,
                    onChange: function (v) { rDraft.test = v; U.rerender(); }
                })));
                if (testKey(rDraft.test) !== 'changes') {
                    addRows.push(W.row('Value', W.number({
                        value: rDraft.value, _ungated: true, label: 'value',
                        onChange: function (v) { rDraft.value = v; }
                    })));
                }
            }
            addRows.push(W.row('Label', W.text({
                value: rDraft.label, placeholder: 'split name',
                onInput: function (v) { rDraft.label = v; }
            })));
            var dupWhy = R.duplicateWhy(route.id, rDraftWhen());
            addRows.push(W.button({
                label: 'add the split', wide: true, variant: 'prime', mutates: true,
                disabled: !!dupWhy,
                onClick: function () {
                    R.addSplit(route.id, rDraftWhen(), rDraft.label);
                    rDraft.label = '';
                    U.rerender();
                }
            }));
            if (dupWhy) addRows.push(note(dupWhy));
            addRows.push(note('a snippet can call GigaHack.api.split("name") to record anything these ' +
                'three cannot describe.'));
        }

        var startRows = [
            W.toggleRow('Start on a new game', {
                value: on('route.startOnNewGame'), _ungated: true,
                disabled: !installed(HOOK_NEWGAME),
                sub: installed(HOOK_NEWGAME) ? '' : 'unavailable on this build',
                tip: installed(HOOK_NEWGAME) ? null : 'Unavailable|' + hookWhy(HOOK_NEWGAME),
                onChange: function (v) { setCfg('route.startOnNewGame', v); }
            }),
            W.toggleRow('Start the run on a load', {
                value: on('route.startOnLoad'), _ungated: true,
                sub: 'a load sets the engine clock to that save\'s play time',
                onChange: function (v) { setCfg('route.startOnLoad', v); }
            }),
            W.button({
                label: 'start the run now', wide: true, variant: 'prime', mutates: true,
                onClick: function () { R.start('started by hand'); U.rerender(); }
            }),
            W.button({
                label: 'stop the run', wide: true, _ungated: true,
                disabled: run.state !== 'running',
                onClick: function () { R.stop(); U.rerender(); }
            }),
            W.button({
                label: 're-anchor to now', wide: true, mutates: true,
                tip: 'Re-anchor|Keeps the route; this run\'s split times are cleared.',
                onClick: function () { R.reanchor(); U.rerender(); }
            }),
            W.button({
                label: 'void this run', wide: true, variant: 'danger',
                onClick: function () { R.voidRun('voided by hand'); U.rerender(); }
            })
        ];

        /* ------------------------------------------------------- best run */
        var bestRows = [];
        var matched = 0, total = 0;
        if (route) {
            total = route.splits.length;
            for (var bi = 0; bi < route.splits.length; bi++) {
                if (best && typeof best.splits[route.splits[bi].sid] === 'number') matched++;
            }
        }
        if (best) {
            bestRows.push(kv('Recorded', new Date(best.at).toLocaleString() + ' · ' +
                (best.totalValid ? clockText(best.total) : 'total not comparable')));
            bestRows.push(kv('Splits matched', matched + ' of ' + total + ' by id'));
            if (!best.totalValid) {
                bestRows.push(warnNote('the best run predates a split that has since been added, so ' +
                    'its total is not this route. Every per-split comparison that still has a match ' +
                    'keeps working.'));
            }
        } else {
            bestRows.push(note('no best run recorded for this route yet.'));
        }
        var completeWhy = R.complete() ? '' :
            'the run has not reached its last split, so there is no total to compare.';
        bestRows.push(W.button({
            label: 'save this run as the best', wide: true, mutates: true,
            disabled: !!completeWhy || !route,
            onClick: function () { R.saveBest(); U.rerender(); }
        }));
        if (completeWhy) bestRows.push(note(completeWhy));
        bestRows.push(W.toggleRow('Save a new best automatically', {
            value: on('route.autoBest'), _ungated: true,
            onChange: function (v) { setCfg('route.autoBest', v); }
        }));
        bestRows.push(W.button({
            label: 'clear the best run', wide: true, variant: 'danger',
            disabled: !best,
            onClick: function () { R.clearBest(); U.rerender(); }
        }));

        /* -------------------------------------------------- editing rules */
        var orphans = route ? R.orphans(route.id) : [];
        var editRows = [
            note('the best run is keyed by each split\'s own id, minted once and never reused.'),
            note('renaming keeps the best. Reordering keeps every one of them.'),
            note('deleting a split leaves its time in the best run rather than dropping data you ' +
                'cannot get back.'),
            note('adding a split stops the TOTAL being compared; every split that still matches ' +
                'keeps its ±.')
        ];
        if (orphans.length) {
            editRows.push(warnNote(orphans.length + ' time(s) in the best run no longer have a split.'));
        }
        var drift = route ? R.dbDrift(route.id) : '';
        if (drift) editRows.push(warnNote(drift));
        editRows.push(W.button({
            label: 'accept the route and clear the best', wide: true, variant: 'danger',
            disabled: !best,
            onClick: function () { R.clearBest(); U.rerender(); }
        }));
        editRows.push(W.button({
            label: 'keep the best, stop comparing totals', wide: true, _ungated: true,
            disabled: !best || !best.totalValid,
            onClick: function () { R.keepBestStopTotals(); U.rerender(); }
        }));

        var danger = W.group('Danger', [
            kv('Runs filed under', bookKey),
            W.button({
                label: 'forget every run recorded for this project', wide: true,
                variant: 'danger', confirm: true,
                onClick: function () { R.forgetProject(); U.rerender(); }
            })
        ]);

        return cols(
            [
                runGroup,
                W.group('Splits', splitBody, {
                    grow: true, tag: route ? (route.splits.length + ' split(s)') : 'no route'
                })
            ],
            {
                narrow: true, items: [
                    W.group('Clock', clockRows),
                    W.group('Route', routeRows, { tag: b.routes.length + ' saved' }),
                    route ? W.group('Add a split', addRows) : null,
                    W.group('The run', startRows, { tag: run.state }),
                    W.group('Best run', bestRows),
                    W.group('Editing the route', editRows),
                    danger
                ]
            });
    }

    U.actorPanel('Route', function () { return buildRoute(); }, 85);

    /* =====================================================================
       PART 10 — CONSOLE API

       Everything on $.api is recorded by the console's action recorder and
       listed by $.api.help(), so triggers and routes become scriptable and
       replayable for free. The recorder wraps $.api lazily and re-wraps when a
       new key appears, so registering after Console has loaded is fine.
       ===================================================================== */
    $.api.triggers = function () { return A.triggers(); };
    $.api.trigger = function (id) { return A.fire(id, 'called from the console'); };
    $.api.route = function () {
        return {
            key: gameKey(),
            route: currentRoute() ? $.clone(currentRoute()) : null,
            run: R.run(),
            clock: A.clock()
        };
    };
    $.api.split = function (label) { return R.mark(label); };

    /* =====================================================================
       BOOT
       ===================================================================== */
    loadTriggers();
    A.clockReset();
    recomputeSource();

    var ready = A.available();
    $.log(ready.ok ? 'info' : 'warn', 'auto: ' + triggers.length + ' trigger(s), ' +
        readBook().routes.length + ' route(s) for "' + bookKey + '"; edges from ' +
        A.source().via + (ready.ok ? '' : ' — ' + ready.why));
    if (!installed(HOOK_MAP)) $.log('warn', 'auto: ' + hookWhy(HOOK_MAP));
    if (!installed(HOOK_BATTLE)) $.log('warn', 'auto: ' + hookWhy(HOOK_BATTLE));

})(window.GigaHack);
