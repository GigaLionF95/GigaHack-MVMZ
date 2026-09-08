//=============================================================================
// GigaHack MV/MZ
// 25 · trace.js — watchpoints, the change journal, running interpreters, RNG
//-----------------------------------------------------------------------------
// FOUR SERVICES, ONE IDEA: say WHO, not just WHAT.
//
// World → Recent polls the two _data arrays once a frame and can tell you that
// a variable moved. It can never tell you who moved it, because by the time a
// frame boundary arrives the interpreter has run on to the next command and
// the answer is gone. Everything in this file exists to be standing on the
// stack at the moment of the write.
//
// THE INVARIANTS, and why each one is defended the awkward way:
//
//   · THE WRITER IS CAPTURED, NEVER RECONSTRUCTED. Game_Interpreter.executeCommand
//     is on the stack for the whole duration of a command — including a Script
//     command that calls setValue by hand — so pushing the interpreter before
//     the original and popping it in a finally makes "who is running" readable
//     from inside any write. Nothing is derived afterwards from a frame
//     counter or from what happens to be running when a panel repaints.
//
//   · A HIT HOLDS IDS AND STRINGS, NEVER AN INTERPRETER. Retaining one pins its
//     whole command list and, through _childInterpreter, a chain of them. The
//     interpreter is read at capture time and thrown away.
//
//   · THE HOT PATHS ALLOCATE NOTHING WHEN NOTHING IS ARMED. executeCommand is
//     the hottest function in either engine — its own freeze checker allows a
//     hundred thousand calls per frame before it gives up — and some projects
//     write hundreds of variables a frame from parallel processes. Both
//     wrappers begin with one boolean test and a tail call.
//
//   · NOTHING HERE PAUSES THE GAME ITSELF. Pause is $.pause's job and it is
//     already the one place that knows SceneManager.updateMain cannot be
//     wrapped on every build. A hit that wants the game held queues a request
//     and $.onFrame acts on it, because opening the overlay or writing a
//     setting from inside Game_Variables.setValue would run DOM work inside the
//     interpreter's own while-loop, mid-frame. The consequence is that the game
//     stops one frame late, and the panel says so rather than implying the
//     command was caught in the act.
//
//   · TWO CLOCKS, AND THEY ANSWER DIFFERENT QUESTIONS. $.frameCount is
//     GigaHack's own and keeps ticking while the mod holds the game;
//     Graphics.frameCount is what a player recognises and, on one engine,
//     stops. Ordering and per-frame coalescing use ours; the engine's is shown
//     as a label.
//
//   · THE JOURNAL IS FED, NOT ASKED FOR. $.undo and $.compat know nothing about
//     it: their own methods are aliased here through $.install, so every
//     reversible edit and every verified write in the mod lands in one
//     chronological list without either service growing a dependency.
//
//   · NEITHER ENGINE HAS A GENERATOR. Every roll in both — damage variance,
//     drops, encounters, and also weather, animations and particles — goes
//     through Math.random, so that is the single point at which a roll can be
//     recorded or replaced. The alias is installed ON DEMAND and removed again,
//     so a mod menu nobody is using leaves the host's own function in place;
//     and anything that captured a reference to Math.random before it was
//     switched on keeps the real one, which the panel states rather than
//     implying coverage.
//
// The module keeps its marker as $.trace, carrying only describe() and
// report(); the work is published as $.watch, $.journal, $.interp and $.rng.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — watchpoints, the change journal, running interpreters, RNG
 * @author gigahack
 * @help GigaHack_Trace.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat. Index and Events are used when present and named when
 * absent.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — trace not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    /* =====================================================================
       SETTINGS

       Every key this module reads, with its default, in one table. The
       settings module owns its own DEFAULTS and this file may not edit it, so
       the default is supplied here at read time — a missing key must read as
       the default, never as undefined, or every control here opens blank on a
       settings file written before this module existed.
       ===================================================================== */
    var DEFAULTS = {
        'watch.enabled': true,
        'watch.pauseOnHit': false,
        'watch.logHits': true,
        'watch.captureStack': false,
        'watch.maxHits': 300,
        'watch.points': [],
        'journal.max': 500,
        'journal.recordUnanchored': true,
        'interp.autoRefresh': true,
        'interp.refreshEvery': 6,
        'rng.watch': false,
        'rng.sample': 1,
        'rng.maxRolls': 400,
        'rng.maxPerFrame': 2000,
        'rng.captureStack': false,
        'rng.seedOn': false,
        'rng.seed': 1
    };

    function cfg(key) {
        var d = DEFAULTS[key];
        var v = $.store && $.store.cfgGet ? $.store.cfgGet('trace.' + key, d) : d;
        return v === undefined || v === null ? d : v;
    }
    function num(key, lo, hi) {
        var v = cfg(key), d = DEFAULTS[key];
        if (typeof v !== 'number' || v !== v) return d;
        return v < lo ? lo : v > hi ? hi : v;
    }
    function setCfg(key, value) {
        if ($.store && $.store.cfgSet) $.store.cfgSet('trace.' + key, value);
        return value;
    }

    function engineFrame() {
        return $.safe(function () {
            return (typeof Graphics !== 'undefined' && Graphics && Graphics.frameCount) || 0;
        }, 'engine frame', 0);
    }

    /* $.undo is Store's, and Store is guaranteed by the manifest — but a
       partial install is exactly the moment a mod menu must not throw, and
       every one of these is read from a panel that has to build anyway. */
    function undoSize() { return ($.undo && $.undo.size) ? $.undo.size() : 0; }
    function undoPeek() { return ($.undo && $.undo.peek) ? $.undo.peek() : null; }
    function undoPop() { return ($.undo && $.undo.pop) ? $.undo.pop() : false; }

    /* The engine's logical clock is 60 steps a second on both engines whatever
       the measured frame rate is, so a wait count converts with 60 and the
       panel says "about", not "exactly". */
    var LOGICAL_FPS = 60;

    /* =====================================================================
       PART 1 — WRITER CONTEXT

       One array used as a stack, and a depth counter, so the hot path pushes
       an object reference and nothing else. The interpreter's own fields are
       read LAZILY, at write time, by whatever actually wants them: a frame in
       which nothing matches costs one array store and one decrement.

       A child interpreter is NOT nested inside its parent's executeCommand —
       updateChild() is called from update() — so this stack is one deep in
       normal running and the parent chain is resolved by walking the roots
       when a hit actually matches.
       ===================================================================== */
    var ctxStack = [];
    var ctxDepth = 0;

    /* Raised while GigaHack itself is doing the writing, so a cheat is never
       reported as an event that did it. Every mutating control in the mod
       reaches $.compat.verify, which is aliased below; an undo runs through
       $.undo.pop, which is aliased too. */
    var mineDepth = 0;

    var watchDemand = false;   // do the three setValue aliases do any work?
    var ctxDemand = false;     // does executeCommand push at all?

    var HOOK_VAR = 'Game_Variables.setValue (watch)';
    var HOOK_SWITCH = 'Game_Switches.setValue (watch)';
    var HOOK_SELF = 'Game_SelfSwitches.setValue (watch)';
    var HOOK_WRITER = 'Game_Interpreter.executeCommand (writer context)';
    var HOOK_RNG = 'Math.random (rng)';
    var HOOK_PUSH = 'GigaHack.undo.push (journal)';
    var HOOK_POP = 'GigaHack.undo.pop (journal)';
    var HOOK_CLEAR = 'GigaHack.undo.clear (journal)';
    var HOOK_VERIFY = 'GigaHack.compat.verify (journal)';

    /**
     * The reason each alias matters, written once.
     *
     * $.install records a reason when the TARGET was missing, and that is the
     * common case — but a hook can also be removed later from Debug → Hooks, or
     * by this module's own on-demand release, and then the registry entry
     * carries no reason at all. A panel that said nothing in that case would be
     * the exact failure this codebase exists to avoid, so the reason lives here
     * and the registry's own wording wins when it has one.
     */
    var REASONS = {};

    function installed(name) {
        return !!($.hooks[name] && $.hooks[name].installed);
    }
    function hookWhy(name) {
        return ($.hooks[name] && $.hooks[name].reason) || REASONS[name] || '';
    }

    REASONS[HOOK_WRITER] =
        'Game_Interpreter.prototype.executeCommand is not the function GigaHack aliased — a plugin ' +
        'replaced the event interpreter, or the hook was removed from Debug → Hooks. Watchpoints ' +
        'still fire and still say what changed; they cannot say which event did it, and the ' +
        'Watchpoints panel says so instead of guessing.';
    REASONS[HOOK_VAR] =
        'Game_Variables.prototype.setValue is not the function GigaHack aliased — a plugin has ' +
        'replaced the variable store, or the hook was removed. A watchpoint on a variable cannot ' +
        'see the write; World → Recent still polls the values once a frame and will say what ' +
        'changed, but not who.';
    REASONS[HOOK_SWITCH] =
        'Game_Switches.prototype.setValue is not the function GigaHack aliased — a plugin has ' +
        'replaced the switch store, or the hook was removed. World → Recent still reports the ' +
        'change without the writer.';
    REASONS[HOOK_SELF] =
        'Game_SelfSwitches.prototype.setValue is not the function GigaHack aliased — a plugin ' +
        'stores self-switches somewhere else, or the hook was removed. World → Self still reads ' +
        'the values through the engine\'s own value().';
    REASONS[HOOK_PUSH] =
        'GigaHack.undo.push is not the function GigaHack aliased — the settings module did not ' +
        'load, is older than this one, or the hook was removed. The journal has no anchor feed and ' +
        'no row here can be reverted.';
    REASONS[HOOK_POP] =
        'GigaHack.undo.pop is not the function GigaHack aliased — undoing will still work through ' +
        'whatever else calls it, but the journal will not show that it happened.';
    REASONS[HOOK_CLEAR] =
        'GigaHack.undo.clear is not the function GigaHack aliased — a cleared stack will leave ' +
        'journal rows offering an undo that is no longer there. canUndoTo still refuses, because ' +
        'it tests the stack itself, but it will not say why.';
    REASONS[HOOK_VERIFY] =
        'GigaHack.compat.verify is not the function GigaHack aliased — the compatibility module ' +
        'did not load, or the hook was removed. The journal can list what was changed but not ' +
        'whether it stuck.';
    REASONS[HOOK_RNG] =
        'Math.random is not a function on this host, so rolls can be neither recorded nor seeded. ' +
        'That should be impossible; if it is reported, something has replaced Math with an object ' +
        'that has no random.';

    $.install(HOOK_WRITER,
        typeof Game_Interpreter !== 'undefined' ? Game_Interpreter.prototype : null, 'executeCommand',
        function (original) {
            return function () {
                if (!ctxDemand) return original.apply(this, arguments);
                ctxStack[ctxDepth++] = this;
                try {
                    return original.apply(this, arguments);
                } finally {
                    ctxDepth--;
                }
            };
        },
        REASONS[HOOK_WRITER]);

    /* ------------------------------------------------------- naming things */
    function mapName(id) {
        return $.safe(function () {
            if (typeof $dataMapInfos !== 'undefined' && $dataMapInfos && $dataMapInfos[id]) {
                return $dataMapInfos[id].name || '';
            }
            return '';
        }, 'map name', '');
    }
    function eventName(mapId, eventId) {
        return $.safe(function () {
            if (typeof $gameMap === 'undefined' || !$gameMap) return '';
            if ($gameMap.mapId() !== mapId) return '';
            var ev = $gameMap.event(eventId);
            if (!ev) return '';
            var d = ev.event ? ev.event() : null;
            return (d && d.name) || '';
        }, 'event name', '');
    }
    function commonEventName(id) {
        return $.safe(function () {
            var d = typeof $dataCommonEvents !== 'undefined' && $dataCommonEvents && $dataCommonEvents[id];
            return (d && d.name) || '';
        }, 'common event name', '');
    }
    function varName(id) {
        return $.safe(function () {
            return (typeof $dataSystem !== 'undefined' && $dataSystem && $dataSystem.variables &&
                $dataSystem.variables[id]) || '';
        }, 'variable name', '');
    }
    function switchName(id) {
        return $.safe(function () {
            return (typeof $dataSystem !== 'undefined' && $dataSystem && $dataSystem.switches &&
                $dataSystem.switches[id]) || '';
        }, 'switch name', '');
    }

    /**
     * Decode the command an interpreter is on.
     *
     * From _list[_index], never from _params: MV assigns this._params before
     * calling the handler and MZ has no such field at all, so anything reading
     * _params shows a blank command on one engine with no error anywhere.
     */
    function commandAt(interp) {
        return $.safe(function () {
            if (!interp || !interp._list) return null;
            return interp._list[interp._index] || null;
        }, 'current command', null);
    }
    function describeCommand(c) {
        if (!c) return '';
        if ($.events && $.events.describe) {
            return $.safe(function () { return $.events.describe(c) || ('code ' + c.code); },
                'describe command', 'code ' + c.code);
        }
        return 'code ' + c.code;
    }

    /* =====================================================================
       PART 2 — $.watch
       ===================================================================== */
    var Wt = $.watch = {};

    var points = [];          // the armed specs
    var nextPointId = 1;
    var hits = [];            // ring
    var totalHits = 0;        // NEVER key a cache on hits.length — see below
    var observed = 0;         // writes seen, for "does the idle path do work"
    var subsHit = [];
    var subsAny = [];
    var readingValue = false;
    var pendingPause = null;
    var pendingLog = [];
    var pendingRemove = [];
    var heldByHit = false;

    function pointsAvailable() {
        var missing = [];
        if (!installed(HOOK_VAR)) missing.push(hookWhy(HOOK_VAR));
        if (!installed(HOOK_SWITCH)) missing.push(hookWhy(HOOK_SWITCH));
        if (!installed(HOOK_SELF)) missing.push(hookWhy(HOOK_SELF));
        return missing;
    }

    Wt.available = function () {
        var ok = installed(HOOK_VAR) || installed(HOOK_SWITCH) || installed(HOOK_SELF);
        return {
            ok: ok,
            why: ok ? '' : pointsAvailable().join(' ') +
                ' World → Recent still polls the two _data arrays once a frame and will tell you ' +
                'WHAT changed.'
        };
    };

    Wt.attributable = function () {
        return {
            ok: installed(HOOK_WRITER),
            why: installed(HOOK_WRITER) ? '' : hookWhy(HOOK_WRITER)
        };
    };

    /* ------------------------------------------------------- value helpers */
    function sameValue(a, b) {
        if ($.vars && $.vars.sameValue) return $.vars.sameValue(a, b);
        if (a === b) return true;
        return !a && !b;
    }
    function numOf(v) {
        return (typeof v === 'number' && isFinite(v)) ? v : null;
    }

    var WHEN_LABELS = ['any change', 'any write', 'becomes', 'rises above', 'falls below', 'leaves a range'];
    var WHEN_KEYS = ['change', 'write', 'becomes', 'above', 'below', 'outside'];
    function whenKey(label) {
        var i = WHEN_LABELS.indexOf(label);
        return i < 0 ? 'change' : WHEN_KEYS[i];
    }
    function whenLabel(key) {
        var i = WHEN_KEYS.indexOf(key);
        return i < 0 ? WHEN_LABELS[0] : WHEN_LABELS[i];
    }
    Wt.conditions = function () { return WHEN_LABELS.slice(); };

    function matches(wp, from, to) {
        var want = wp.kind === 'var' ? wp.value : !!wp.value;
        var a, b;
        switch (wp.when) {
            case 'write': return true;
            case 'becomes': return sameValue(to, want) && !sameValue(from, want);
            case 'above':
                a = numOf(from); b = numOf(to);
                return b !== null && b > wp.value && !(a !== null && a > wp.value);
            case 'below':
                a = numOf(from); b = numOf(to);
                return b !== null && b < wp.value && !(a !== null && a < wp.value);
            case 'outside':
                a = numOf(from); b = numOf(to);
                if (b === null) return false;
                var lo = Math.min(wp.value, wp.hi), hi = Math.max(wp.value, wp.hi);
                var wasIn = a !== null && a >= lo && a <= hi;
                var isIn = b >= lo && b <= hi;
                return wasIn && !isIn;
            default: return !sameValue(from, to);
        }
    }

    /* ------------------------------------------------------- the spec store */
    function loadPoints() {
        var raw = cfg('watch.points');
        if (!raw || !raw.length) return;
        for (var i = 0; i < raw.length; i++) {
            var p = raw[i];
            if (!p || !p.kind) continue;
            var wp = {
                id: nextPointId++,
                kind: p.kind, target: p.target, letter: p.letter || '',
                when: WHEN_KEYS.indexOf(p.when) > -1 ? p.when : 'change',
                value: typeof p.value === 'number' ? p.value : 0,
                hi: typeof p.hi === 'number' ? p.hi : 0,
                /* pauseOnHit is registered with $.store.unsafeAtBoot below, and
                   a persisted watchpoint carrying pause:true would arrive with
                   the same problem one flag deeper — the game held before the
                   overlay it would be turned off from can be opened. */
                pause: false,
                once: !!p.once,
                enabled: p.enabled !== false,
                log: p.log !== false,
                label: p.label || '',
                hits: 0, last: 0
            };
            points.push(wp);
        }
    }

    function savePoints() {
        setCfg('watch.points', points.map(function (p) {
            return {
                kind: p.kind, target: p.target, letter: p.letter, when: p.when,
                value: p.value, hi: p.hi, pause: p.pause, once: p.once,
                enabled: p.enabled, log: p.log, label: p.label
            };
        }));
    }

    function recomputeDemand() {
        var armed = Wt.armed();
        watchDemand = (cfg('watch.enabled') !== false && armed > 0) ||
            subsHit.length > 0 || subsAny.length > 0;
        ctxDemand = watchDemand || rngRecording();
        U.setActive('watchpoints', armed > 0 && cfg('watch.enabled') !== false);
    }

    Wt.armed = function () {
        var n = 0;
        for (var i = 0; i < points.length; i++) if (points[i].enabled) n++;
        return n;
    };
    Wt.demand = function () {
        return (cfg('watch.enabled') !== false ? Wt.armed() : 0) + subsHit.length + subsAny.length;
    };

    function targetKey(wp) {
        if (wp.kind === 'selfswitch') return String(wp.target) + ',' + (wp.letter || 'any');
        return wp.kind + ':' + wp.target;
    }

    Wt.add = function (spec) {
        spec = spec || {};
        var kind = spec.kind === 'switch' ? 'switch' : spec.kind === 'selfswitch' ? 'selfswitch' : 'var';
        var wp = {
            id: nextPointId++, kind: kind,
            target: kind === 'selfswitch' ? String(spec.target || '') : Math.floor(spec.id || spec.target || 0),
            letter: kind === 'selfswitch' ? (spec.letter || 'any') : '',
            when: WHEN_KEYS.indexOf(spec.when) > -1 ? spec.when : 'change',
            value: typeof spec.value === 'number' ? spec.value : 0,
            hi: typeof spec.hi === 'number' ? spec.hi : 0,
            pause: !!spec.pause, once: !!spec.once,
            enabled: true, log: spec.log !== false,
            label: spec.label || '',
            hits: 0, last: 0
        };
        if (kind === 'selfswitch' ? !wp.target : !(wp.target > 0)) {
            U.toast({
                title: 'NOT ARMED',
                msg: 'pick a variable, a switch or a self-switch first',
                severity: 'warn'
            });
            return null;
        }
        for (var i = 0; i < points.length; i++) {
            if (targetKey(points[i]) === targetKey(wp) && points[i].when === wp.when) {
                U.toast({ title: 'ALREADY ARMED', msg: 'a watchpoint on this is already armed', severity: 'warn' });
                return null;
            }
        }
        points.push(wp);
        savePoints();
        recomputeDemand();
        $.log('ok', 'watching ' + Wt.describePoint(wp));
        return wp.id;
    };

    function findPoint(id) {
        for (var i = 0; i < points.length; i++) if (points[i].id === id) return points[i];
        return null;
    }

    Wt.get = function (id) { var p = findPoint(id); return p ? $.clone(p) : null; };
    Wt.list = function () { return points.map(function (p) { return $.clone(p); }); };
    Wt.remove = function (id) {
        for (var i = 0; i < points.length; i++) {
            if (points[i].id === id) {
                points.splice(i, 1);
                savePoints(); recomputeDemand();
                return true;
            }
        }
        return false;
    };
    Wt.clear = function () {
        points.length = 0; savePoints(); recomputeDemand(); return true;
    };
    Wt.update = function (id, patch) {
        var p = findPoint(id);
        if (!p || !patch) return false;
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
        savePoints(); recomputeDemand();
        return true;
    };
    Wt.enable = function (id, on) {
        var p = findPoint(id);
        if (!p) return false;
        p.enabled = !!on;
        savePoints(); recomputeDemand();
        return true;
    };

    Wt.describePoint = function (wp) {
        if (!wp) return '';
        var what = wp.kind === 'var' ? ('variable ' + wp.target + ' "' + varName(wp.target) + '"')
            : wp.kind === 'switch' ? ('switch ' + wp.target + ' "' + switchName(wp.target) + '"')
                : ('self-switch ' + wp.target + ' ' + (wp.letter || 'any'));
        var when = whenLabel(wp.when);
        if (wp.when === 'becomes' || wp.when === 'above' || wp.when === 'below') when += ' ' + wp.value;
        if (wp.when === 'outside') when += ' ' + wp.value + '–' + wp.hi;
        return what + ' — ' + when;
    };

    /* ------------------------------------------------------------ context */
    /**
     * Who is writing, right now.
     *
     * Valid only synchronously inside a write; null otherwise. The interpreter
     * is read here and never stored: a hit keeps the ids and the strings.
     */
    Wt.context = function () {
        if (mineDepth > 0) {
            return { where: 'gigahack', mapId: 0, eventId: 0, commonEventId: 0, battle: false,
                depth: 0, index: 0, total: 0, code: 0, command: '', aliased: true,
                mapName: '', eventName: '', commonEventName: '' };
        }
        if (!ctxDepth) return null;
        var interp = ctxStack[ctxDepth - 1];
        if (!interp) return null;
        return $.safe(function () {
            var loc = Ip.locate(interp);
            var owner = loc ? loc.root : null;
            var c = commandAt(interp);
            var mapId = interp._mapId || 0;
            var evId = interp._eventId || 0;
            var out = {
                where: 'event',
                mapId: mapId, mapName: mapName(mapId),
                eventId: evId, eventName: eventName(mapId, evId),
                commonEventId: 0, commonEventName: '',
                battle: false,
                depth: interp._depth || 0,
                index: interp._index || 0,
                total: (interp._list && interp._list.length) || 0,
                code: c ? c.code : 0,
                command: describeCommand(c),
                /* A plugin that SUBCLASSES Game_Interpreter and overrides
                   executeCommand on the subclass shadows our prototype alias,
                   and $.compat.aliasIntegrity cannot notice because the
                   prototype method is still ours. Compare per instance. */
                aliased: isAliasedInstance(interp)
            };
            if (owner) {
                if (owner.kind === 'common') {
                    out.where = 'common';
                    out.commonEventId = owner.commonEventId;
                    out.commonEventName = owner.commonEventName;
                } else if (owner.kind === 'battle') {
                    out.where = 'battle';
                    out.battle = true;
                } else if (owner.kind === 'event') {
                    out.eventId = owner.eventId || out.eventId;
                    out.eventName = owner.eventName || out.eventName;
                }
            }
            /* A child interpreter carries no record of WHICH common event it is
               running — Game_Interpreter.setup takes a list and an event id and
               nothing else. The parent's Call Common Event command is the only
               place that says so, and the parent's index has already moved past
               it by the time the child runs, so both positions are read. */
            if (loc && loc.parent) {
                var ce = calledCommonEvent(loc.parent);
                if (ce) {
                    out.where = 'common';
                    out.commonEventId = ce;
                    out.commonEventName = commonEventName(ce);
                    out.mapId = loc.parent._mapId || out.mapId;
                    out.eventId = loc.parent._eventId || out.eventId;
                    out.eventName = eventName(out.mapId, out.eventId);
                }
            }
            if (out.where === 'event' && !out.eventId && !out.mapId) out.where = 'unknown';
            return out;
        }, 'writer context', null);
    };

    /* Event command 117 is Call Common Event. The code is the engine's own
       command number, not a content id. */
    var CALL_COMMON_EVENT = 117;
    function calledCommonEvent(parent) {
        return $.safe(function () {
            if (!parent || !parent._list) return 0;
            var at = parent._list[parent._index];
            if (at && at.code === CALL_COMMON_EVENT) return at.parameters[0];
            var prev = parent._list[parent._index - 1];
            if (prev && prev.code === CALL_COMMON_EVENT) return prev.parameters[0];
            return 0;
        }, 'called common event', 0) || 0;
    }

    function isAliasedInstance(interp) {
        if (!installed(HOOK_WRITER)) return false;
        return $.safe(function () {
            return interp.executeCommand === Game_Interpreter.prototype.executeCommand;
        }, 'alias identity', false);
    }

    /**
     * The one place the writer wording lives, so the Watchpoints panel and the
     * RNG panel say it the same way.
     */
    Wt.describeWriter = function (ctx) {
        if (!ctx) return 'engine or plugin';
        if (ctx.where === 'gigahack') return 'GigaHack';
        if (ctx.where === 'battle') return 'battle event';
        if (ctx.where === 'common') {
            var ce = 'common event ' + ctx.commonEventId +
                (ctx.commonEventName ? ' “' + ctx.commonEventName + '”' : '');
            if (!ctx.eventId) return ce;
            return ce + ' · called from Map ' + ctx.mapId +
                (ctx.mapName ? ' “' + ctx.mapName + '”' : '') +
                ' · event ' + ctx.eventId +
                (ctx.eventName ? ' “' + ctx.eventName + '”' : '');
        }
        if (ctx.where === 'event') {
            var m = 'Map ' + ctx.mapId + (ctx.mapName ? ' “' + ctx.mapName + '”' : '');
            if (!ctx.eventId) return m + ' · map interpreter';
            return m + ' · event ' + ctx.eventId +
                (ctx.eventName ? ' “' + ctx.eventName + '”' : '');
        }
        return 'engine or plugin';
    };

    /* ----------------------------------------------------------- the hooks */
    /**
     * Read through value(), not off _data.
     *
     * The engine's value() returns `this._data[id] || 0`, so a raw read reports
     * a change from '' to 0 that the game itself cannot see. The read is
     * re-entrancy-guarded: only OUR two reads are, because a nested write from
     * another plugin's own setValue alias is a genuinely separate write and is
     * reported separately.
     */
    function guardedValue(store, arg) {
        if (readingValue) return undefined;
        readingValue = true;
        try {
            return store.value(arg);
        } catch (e) {
            return undefined;
        } finally {
            readingValue = false;
        }
    }

    $.install(HOOK_VAR,
        typeof Game_Variables !== 'undefined' ? Game_Variables.prototype : null, 'setValue',
        function (original) {
            return function (variableId, value) {
                if (!watchDemand || readingValue) return original.apply(this, arguments);
                var before = guardedValue(this, variableId);
                var r = original.apply(this, arguments);
                observe('var', variableId, '', before, guardedValue(this, variableId));
                return r;
            };
        },
        REASONS[HOOK_VAR]);

    $.install(HOOK_SWITCH,
        typeof Game_Switches !== 'undefined' ? Game_Switches.prototype : null, 'setValue',
        function (original) {
            return function (switchId, value) {
                if (!watchDemand || readingValue) return original.apply(this, arguments);
                var before = guardedValue(this, switchId);
                var r = original.apply(this, arguments);
                observe('switch', switchId, '', before, guardedValue(this, switchId));
                return r;
            };
        },
        REASONS[HOOK_SWITCH]);

    $.install(HOOK_SELF,
        typeof Game_SelfSwitches !== 'undefined' ? Game_SelfSwitches.prototype : null, 'setValue',
        function (original) {
            return function (key, value) {
                if (!watchDemand || readingValue) return original.apply(this, arguments);
                /* The engine stores the key coerced to 'map,event,letter'. The
                   three parts are copied out HERE, at capture time: a caller
                   that reuses one array would otherwise rewrite a hit that has
                   already been recorded. */
                var parts = Array.isArray(key) ? [key[0], key[1], key[2]] : String(key).split(',');
                var where = String(parts[0]) + ',' + String(parts[1]);
                var letter = String(parts[2] || '');
                var before = guardedValue(this, key);
                var r = original.apply(this, arguments);
                observe('selfswitch', where, letter, before, guardedValue(this, key));
                return r;
            };
        },
        REASONS[HOOK_SELF]);

    /* ------------------------------------------------------------ observe */
    function observe(kind, target, letter, from, to) {
        observed++;
        var frame = $.frameCount;
        var ctxThunk = null;
        var ctxCache;
        var cached = false;
        /* The context is a THUNK: an onAny subscriber that only wants to know
           WHICH variable moved never pays for the root walk. */
        ctxThunk = function () {
            if (!cached) { cached = true; ctxCache = Wt.context(); }
            return ctxCache;
        };

        if (subsAny.length) {
            var payload = {
                kind: kind, id: kind === 'selfswitch' ? 0 : target,
                key: kind === 'selfswitch' ? target + ',' + letter : '',
                from: from, to: to, at: Date.now(), frame: frame, context: ctxThunk
            };
            for (var s = 0; s < subsAny.length; s++) {
                $.safe(function () { subsAny[s](payload); }, 'watch subscriber');
            }
        }

        if (cfg('watch.enabled') === false) return;

        for (var i = 0; i < points.length; i++) {
            var wp = points[i];
            if (!wp.enabled) continue;
            if (wp.kind !== kind) continue;
            if (kind === 'selfswitch') {
                if (String(wp.target) !== String(target)) continue;
                if (wp.letter && wp.letter !== 'any' && wp.letter !== letter) continue;
            } else if (String(wp.target) !== String(target)) {
                continue;
            }
            if (!matches(wp, from, to)) continue;
            fire(wp, kind, target, letter, from, to, frame, ctxThunk);
        }
    }

    function fire(wp, kind, target, letter, from, to, frame, ctxThunk) {
        wp.hits++;
        wp.last = frame;

        /* A parallel process that writes every frame — a play timer, a step
           counter — would otherwise produce sixty rows a second, and so would
           a frozen variable GigaHack itself re-asserts. One row per watchpoint
           per frame, with a count, keeps the list readable and still says how
           many writes there really were. */
        for (var b = hits.length - 1; b >= 0 && hits[b].frame === frame; b--) {
            if (hits[b].wp !== wp.id) continue;
            hits[b].count++;
            hits[b].to = to;
            totalHits++;
            return;
        }

        var ctx = ctxThunk();
        var hit = {
            n: ++totalHits,
            wp: wp.id, kind: kind,
            id: kind === 'selfswitch' ? 0 : target,
            key: kind === 'selfswitch' ? target + ',' + letter : '',
            label: Wt.describePoint(wp),
            from: from, to: to, count: 1,
            at: Date.now(), frame: frame, engineFrame: engineFrame(),
            where: ctx ? ctx.where : 'unknown',
            mapId: ctx ? ctx.mapId : 0, mapName: ctx ? ctx.mapName : '',
            eventId: ctx ? ctx.eventId : 0, eventName: ctx ? ctx.eventName : '',
            commonEventId: ctx ? ctx.commonEventId : 0,
            commonEventName: ctx ? ctx.commonEventName : '',
            depth: ctx ? ctx.depth : 0,
            index: ctx ? ctx.index : 0, total: ctx ? ctx.total : 0,
            code: ctx ? ctx.code : 0, command: ctx ? ctx.command : '',
            aliased: ctx ? !!ctx.aliased : false,
            writer: Wt.describeWriter(ctx),
            /* Nothing in GigaHack routes a self-switch write through
               $.compat.verify — Vars deliberately does not, so one stuck letter
               cannot libel every switch in the game — so a self-switch hit
               carries no answer about whether it stuck. Null, not false. */
            stuck: null,
            stack: null
        };
        if (!ctx && cfg('watch.captureStack')) {
            hit.stack = $.safe(function () { return new Error('unattributed write').stack || ''; },
                'capture stack', '');
        }
        hits.push(hit);
        var max = num('watch.maxHits', 20, 5000);
        while (hits.length > max) hits.shift();

        if (wp.log && cfg('watch.logHits') !== false) {
            /* Queued, not logged here: $.log reaches the log drawer, which is
               DOM work, and this is running inside the interpreter's own
               while-loop. */
            pendingLog.push('watchpoint hit — ' + hit.label + ': ' + fmt(from) + ' → ' + fmt(to) +
                ' (' + hit.writer + ')');
        }
        if (wp.pause && !pendingPause) pendingPause = hit;
        if (wp.once) pendingRemove.push(wp.id);

        for (var i = 0; i < subsHit.length; i++) {
            $.safe(function () { subsHit[i](hit); }, 'watch hit subscriber');
        }
        $.emit('watch:hit', hit);
    }

    function fmt(v) {
        if (v === true) return 'ON';
        if (v === false) return 'off';
        if (v === undefined || v === null) return '0';
        if (typeof v === 'object') return $.safe(function () { return JSON.stringify(v).slice(0, 40); }, 'fmt', '?');
        return String(v);
    }
    Wt.format = fmt;

    Wt.on = function (fn) { subsHit.push(fn); recomputeDemand(); return fn; };
    Wt.off = function (fn) {
        var i = subsHit.indexOf(fn);
        if (i > -1) subsHit.splice(i, 1);
        recomputeDemand();
    };
    Wt.onAny = function (fn) { subsAny.push(fn); recomputeDemand(); return fn; };
    Wt.offAny = function (fn) {
        var i = subsAny.indexOf(fn);
        if (i > -1) subsAny.splice(i, 1);
        recomputeDemand();
    };

    Wt.hits = function (id) {
        if (id === undefined) return hits.slice();
        return hits.filter(function (x) { return x.wp === id; });
    };
    Wt.clearHits = function () { hits.length = 0; return true; };
    Wt.lastHit = function () { return hits.length ? hits[hits.length - 1] : null; };
    /* The total EVER recorded, never hits.length. Once the ring is full its
       length never changes again, and anything memoised on it freezes at
       whatever it concluded in the steady state. */
    Wt.totalHits = function () { return totalHits; };
    Wt.observedWrites = function () { return observed; };

    Wt.held = function () {
        return heldByHit && !!($.cfg.behaviour && $.cfg.behaviour.pauseGame);
    };
    Wt.resume = function () {
        heldByHit = false;
        if ($.store && $.store.cfgSet) $.store.cfgSet('behaviour.pauseGame', false);
        $.log('ok', 'the game is running again — behaviour.pauseGame was cleared');
        return true;
    };

    /* =====================================================================
       PART 3 — $.journal

       Two feeds, neither of which knows this exists. $.undo.push says a
       reversible edit happened and what it was; $.compat.verify says what a
       write wanted, what it got, and who is likely responsible. A row is one
       edit with its evidence attached; a verify that no push followed is its
       own row rather than being dropped, because a write that could not be
       made reversible still happened.
       ===================================================================== */
    var J = $.journal = {};

    var rows = [];
    var seq = 0;
    var totalPushes = 0;
    var pendingEvidence = [];
    /**
     * A mirror of the undo stack, holding the journal row each entry came
     * from. Position, not arithmetic: $.undo shift()s on overflow and pops
     * from the top, so a formula over "pushes so far minus the current size"
     * is right only while nothing has been popped. This is exact.
     */
    var liveRows = [];
    /**
     * Bumped by every path that changes what the Journal panel shows, and read
     * as its live-repaint signal.
     *
     * Not rows.length, and not totalPushes on their own. The list is a ring:
     * once it is full its length never moves again, which is the steady state
     * and not the state anyone tests. And totalPushes counts writes only — it
     * does not move when the undo stack is cleared, which empties "reversible
     * now" and marks every row unreversible without a single row arriving or
     * leaving. Both of those are silent staleness, so the counter sits beside
     * the state instead of being derived from it.
     */
    var jrev = 0;
    J.revision = function () { return jrev; };

    function journalMax() { return num('journal.max', 20, 5000); }

    function addRow(row) {
        jrev++;
        row.seq = ++seq;
        row.at = Date.now();
        row.frame = $.frameCount;
        row.engineFrame = engineFrame();
        rows.push(row);
        while (rows.length > journalMax()) {
            var dropped = rows.shift();
            var li = liveRows.indexOf(dropped);
            if (li > -1) liveRows.splice(li, 1);
        }
        return row;
    }

    function splitLabel(label) {
        var m = /^(.*?)\s(\S+)\s→\s(\S+)$/.exec(String(label || ''));
        if (m) return { what: m[1], from: m[2], to: m[3] };
        return { what: String(label || ''), from: '', to: '' };
    }

    function takeEvidence() {
        if (!pendingEvidence.length) return null;
        var e = pendingEvidence[pendingEvidence.length - 1];
        pendingEvidence.length = 0;
        return e;
    }

    $.install(HOOK_PUSH, $.undo, 'push',
        function (original) {
            return function (label, revert) {
                var sizeBefore = undoSize();
                var r = original.apply(this, arguments);
                $.safe(function () {
                    totalPushes++;
                    var ev = takeEvidence();
                    var parts = splitLabel(label);
                    var row = addRow({
                        kind: 'write', label: String(label || ''),
                        what: parts.what, from: parts.from, to: parts.to,
                        control: ev ? ev.control : '',
                        want: ev ? ev.want : undefined,
                        got: ev ? ev.got : undefined,
                        stuck: ev ? !!ev.ok : null,
                        culprits: ev ? ev.culprits : [],
                        message: ev ? ev.message : '',
                        undoable: true,
                        pushIndex: totalPushes,
                        depthAfter: undoSize()
                    });
                    liveRows.push(row);
                    /* The stack is capped and shift()s on overflow: when it did
                       not grow, the oldest entry has gone and its row can no
                       longer be reached by an undo. */
                    if (undoSize() <= sizeBefore) {
                        var lost = liveRows.shift();
                        if (lost && lost !== row) {
                            lost.undoable = false;
                            lost.fell = true;
                        }
                    }
                }, 'journal push');
                return r;
            };
        },
        REASONS[HOOK_PUSH]);

    $.install(HOOK_POP, $.undo, 'pop',
        function (original) {
            return function () {
                /* pop() returns only a boolean, so what was undone has to be
                   read before the original runs. */
                var top = $.safe(undoPeek, 'journal peek', null);
                var label = top ? top.label : '';
                mineDepth++;
                var ok;
                try {
                    ok = original.apply(this, arguments);
                } finally {
                    mineDepth--;
                }
                if (ok) {
                    $.safe(function () {
                        var row = liveRows.pop();
                        if (row) { row.undoable = false; row.undone = true; }
                        var parts = splitLabel(label);
                        addRow({
                            kind: 'undone', label: 'undid: ' + label,
                            what: 'undid ' + parts.what, from: parts.to, to: parts.from,
                            control: '', want: undefined, got: undefined,
                            stuck: null, culprits: [], message: '',
                            undoable: false, pushIndex: 0, depthAfter: undoSize()
                        });
                    }, 'journal pop');
                }
                return ok;
            };
        },
        REASONS[HOOK_POP]);

    $.install(HOOK_CLEAR, $.undo, 'clear',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                $.safe(function () {
                    for (var i = 0; i < liveRows.length; i++) {
                        liveRows[i].undoable = false;
                        liveRows[i].cleared = true;
                    }
                    liveRows.length = 0;
                    // No row arrived or left, so nothing else here moves — and
                    // every "undo to here" button in the panel has just become
                    // a control that looks like it works and does not.
                    jrev++;
                }, 'journal clear');
                return r;
            };
        },
        REASONS[HOOK_CLEAR]);

    $.install(HOOK_VERIFY, $.compat, 'verify',
        function (original) {
            return function (control, write, read, want, compare) {
                mineDepth++;
                var r;
                try {
                    r = original.apply(this, arguments);
                } finally {
                    mineDepth--;
                }
                /* The caller's object goes back UNCHANGED. Six modules branch
                   on .ok, .message and .culprits, and one of them calls this
                   from inside a per-frame hook. */
                $.safe(function () {
                    pendingEvidence.push({
                        control: control,
                        want: r ? r.want : want,
                        got: r ? r.got : undefined,
                        ok: !!(r && r.ok),
                        culprits: (r && r.culprits) || [],
                        message: (r && r.message) || '',
                        at: Date.now(), frame: $.frameCount
                    });
                }, 'journal evidence');
                return r;
            };
        },
        REASONS[HOOK_VERIFY]);

    J.feeds = function () {
        var u = installed(HOOK_PUSH), v = installed(HOOK_VERIFY);
        var why = '';
        if (!u && !v) {
            why = hookWhy(HOOK_PUSH) + ' ' + hookWhy(HOOK_VERIFY) +
                ' Nothing is being recorded; Debug → Hooks lists the two aliases that failed.';
        } else if (!u) {
            why = 'the undo feed is missing, so no row here can be reverted — ' + hookWhy(HOOK_PUSH);
        } else if (!v) {
            why = 'the verify feed is missing, so whether a write stuck is unknown, not assumed — ' +
                hookWhy(HOOK_VERIFY);
        }
        return { undo: u, verify: v, why: why };
    };

    J.rows = function () { return rows.map(function (r) { return $.clone(r); }); };
    J.size = function () { return rows.length; };
    J.max = journalMax;
    J.clear = function () { rows.length = 0; liveRows.length = 0; jrev++; return true; };
    J.stuckRows = function () { return J.rows().filter(function (r) { return r.stuck === false; }); };
    J.reversible = function () { return liveRows.length; };
    J.totalPushes = function () { return totalPushes; };

    function rowBySeq(s) {
        for (var i = 0; i < rows.length; i++) if (rows[i].seq === s) return rows[i];
        return null;
    }

    J.canUndoTo = function (s) {
        var row = rowBySeq(s);
        if (!row) return { ok: false, count: 0, why: 'that row is no longer in the journal' };
        if (row.kind !== 'write') {
            return { ok: false, count: 0, why: 'this row was not undoable' };
        }
        var i = liveRows.indexOf(row);
        if (i < 0) {
            var since = Math.max(0, totalPushes - row.pushIndex);
            return {
                ok: false, count: 0,
                why: row.cleared
                    ? 'the undo stack was cleared, so this entry is no longer on it'
                    : 'this entry has fallen off the undo stack — it holds the last ' +
                    undoSize() + ' reversible edits and ' + since + ' have been made since'
            };
        }
        return { ok: true, count: liveRows.length - i, why: '' };
    };

    J.undoTo = function (s) {
        var can = J.canUndoTo(s);
        if (!can.ok) {
            U.toast({ title: 'NOT UNDONE', msg: can.why, severity: 'warn' });
            return 0;
        }
        var done = 0;
        for (var i = 0; i < can.count; i++) {
            /* Stop the moment pop() says there was nothing to undo, or the log
               drawer fills with one "nothing to undo" line per iteration. */
            if (!undoPop()) break;
            done++;
        }
        $.log('ok', 'undid ' + done + ' change' + (done === 1 ? '' : 's') + ' through the journal');
        return done;
    };

    J.text = function (list) {
        list = list || J.rows();
        return list.map(function (r) {
            return '#' + r.seq + '  f' + r.frame + '  ' + r.label +
                (r.control ? '  [' + r.control + ']' : '') +
                (r.stuck === true ? '  stuck' : r.stuck === false ? '  DID NOT STICK' : '  not verified');
        }).join('\n');
    };

    /* What the journal deliberately does not see. A log with unmarked holes is
       worse than one with named holes. */
    J.blindSpots = function () {
        return [
            'writes the game makes itself — World → Recent and World → Watchpoints answer those',
            'teleports, forced event runs and Forge injections, which are deliberately not ' +
            'reversible and rely on the save backup instead',
            'anything written before this module loaded',
            'the first time a game world exists the compatibility self-test writes and restores one ' +
            'variable, one switch and one item — those rows are real, and they carry their control ' +
            'key so they can be told apart from yours'
        ];
    };

    /* =====================================================================
       PART 4 — $.interp

       A read-only view of every running interpreter, and a named answer to
       "the game froze and I do not know why". A build with no Game_Interpreter
       is itself the report.
       ===================================================================== */
    var Ip = $.interp = {};

    Ip.available = function () {
        if (typeof Game_Interpreter === 'undefined') {
            return {
                ok: false,
                why: 'this build has no Game_Interpreter, so nothing here can be read. Both engines ' +
                    'define it and no ordinary plugin removes it, so this is worth reporting rather ' +
                    'than working around.'
            };
        }
        if (typeof $gameMap === 'undefined' || !$gameMap || !$gameMap._interpreter) {
            return { ok: false, why: 'no game world yet — start or load a game.' };
        }
        return { ok: true, why: '' };
    };

    Ip.roots = function () {
        return $.safe(function () {
            var out = [];
            if (typeof $gameMap !== 'undefined' && $gameMap) {
                if ($gameMap._interpreter) {
                    out.push({
                        kind: 'map', interp: $gameMap._interpreter,
                        eventId: $gameMap._interpreter._eventId || 0,
                        eventName: eventName($gameMap.mapId(), $gameMap._interpreter._eventId || 0),
                        commonEventId: 0, commonEventName: ''
                    });
                }
                var evs = $.safe(function () { return $gameMap.events(); }, 'map events', []) || [];
                evs.forEach(function (ev) {
                    if (!ev || !ev._interpreter) return;
                    var d = ev.event ? $.safe(function () { return ev.event(); }, 'event data', null) : null;
                    out.push({
                        kind: 'event', interp: ev._interpreter,
                        eventId: ev.eventId ? ev.eventId() : (ev._eventId || 0),
                        eventName: (d && d.name) || '',
                        commonEventId: 0, commonEventName: ''
                    });
                });
                ($gameMap._commonEvents || []).forEach(function (ce) {
                    if (!ce || !ce._interpreter) return;
                    out.push({
                        kind: 'common', interp: ce._interpreter,
                        eventId: 0, eventName: '',
                        commonEventId: ce._commonEventId,
                        commonEventName: commonEventName(ce._commonEventId)
                    });
                });
            }
            if (typeof $gameTroop !== 'undefined' && $gameTroop && $gameTroop._interpreter) {
                out.push({
                    kind: 'battle', interp: $gameTroop._interpreter,
                    eventId: 0, eventName: '', commonEventId: 0, commonEventName: ''
                });
            }
            return out;
        }, 'interpreter roots', []) || [];
    };

    /**
     * Where an interpreter sits: which root owns it, which interpreter called
     * it, and how deep the chain is. The walk is over _childInterpreter, which
     * is the only link either engine keeps — a child holds no reference back.
     */
    Ip.locate = function (interp) {
        if (!interp) return null;
        var roots = Ip.roots();
        for (var i = 0; i < roots.length; i++) {
            var cur = roots[i].interp, parent = null, depth = 0, guard = 0;
            while (cur && guard++ < 128) {
                if (cur === interp) return { root: roots[i], parent: parent, depth: depth };
                parent = cur;
                cur = cur._childInterpreter;
                depth++;
            }
        }
        return null;
    };

    /** The root row that owns a given interpreter, following child chains. */
    Ip.find = function (interp) {
        var loc = Ip.locate(interp);
        return loc ? loc.root : null;
    };

    /**
     * A parallel common event has an interpreter only while its trigger is
     * Parallel AND its switch is on, so "why is this one not in the list" is
     * answered by a switch — and this names it rather than showing a gap.
     */
    Ip.idleCommonEvents = function () {
        return $.safe(function () {
            var out = [];
            if (typeof $gameMap === 'undefined' || !$gameMap || !$gameMap._commonEvents) return out;
            $gameMap._commonEvents.forEach(function (ce) {
                if (!ce || ce._interpreter) return;
                var d = $.safe(function () { return ce.event(); }, 'common event data', null);
                var sw = d ? d.switchId : 0;
                out.push({
                    id: ce._commonEventId, name: (d && d.name) || '',
                    switchId: sw, switchName: sw ? switchName(sw) : '',
                    on: sw ? $.safe(function () { return $gameSwitches.value(sw); }, 'switch', false) : false
                });
            });
            return out;
        }, 'idle common events', []) || [];
    };

    function rootLabel(root) {
        if (!root) return 'unknown';
        if (root.kind === 'map') return 'map';
        if (root.kind === 'battle') return 'battle';
        if (root.kind === 'common') {
            return 'common event ' + root.commonEventId +
                (root.commonEventName ? ' “' + root.commonEventName + '”' : '');
        }
        return 'event ' + root.eventId + (root.eventName ? ' “' + root.eventName + '”' : '');
    }
    Ip.rootLabel = rootLabel;

    Ip.all = function () {
        var out = [];
        Ip.roots().forEach(function (root) {
            var cur = root.interp, depth = 0, parent = null, guard = 0;
            while (cur && guard++ < 128) {
                out.push(rowFor(root, cur, depth, parent));
                parent = cur;
                cur = cur._childInterpreter;
                depth++;
            }
        });
        return out;
    };

    function rowFor(root, interp, depth, parent) {
        var c = commandAt(interp);
        return {
            root: root, kind: root.kind, interp: interp, parent: parent, depth: depth,
            where: depth > 0 ? ('child of ' + rootLabel(root)) : rootLabel(root),
            running: $.safe(function () { return !!interp.isRunning(); }, 'isRunning', false),
            index: interp._index || 0,
            total: (interp._list && interp._list.length) || 0,
            code: c ? c.code : 0,
            command: describeCommand(c),
            waitMode: interp._waitMode || '',
            waitCount: interp._waitCount || 0,
            eventId: interp._eventId || 0,
            mapId: interp._mapId || 0,
            aliased: isAliasedInstance(interp),
            froze: Ip.froze(interp)
        };
    }

    Ip.describe = function (interp) {
        if (!interp) return 'no interpreter';
        var root = Ip.find(interp);
        var r = rowFor(root || { kind: 'unknown' }, interp, 0, null);
        return rootLabel(root) + ' · ' + (r.running ? 'running' : 'idle') +
            ' · ' + r.index + ' of ' + r.total +
            (r.waitMode ? ' · waiting on ' + r.waitMode : '') +
            (r.waitCount ? ' · ' + r.waitCount + ' frames left' : '');
    };

    Ip.commandList = function (interp) {
        return $.safe(function () {
            if (!interp || !interp._list) return [];
            return interp._list.map(function (c, i) {
                return { i: i, code: c.code, indent: c.indent || 0, text: describeCommand(c) };
            });
        }, 'command list', []) || [];
    };

    /**
     * The engine's own runaway guard stops an interpreter after a hundred
     * thousand commands in one frame, silently, every frame, for ever. Nothing
     * anywhere reports it, which is why it is here.
     */
    Ip.froze = function (interp) {
        return $.safe(function () {
            if (!interp) return false;
            return interp._freezeChecker >= 100000 && interp._frameCount === engineFrame();
        }, 'froze', false);
    };

    Ip.releaseWait = function (interp) {
        if (!interp) return { ok: false, why: 'select an interpreter first' };
        if (!interp._waitCount && !interp._waitMode) {
            return { ok: false, why: 'this interpreter is not waiting' };
        }
        var was = (interp._waitMode || '(count only)') + ' · ' + (interp._waitCount || 0) + ' frames';
        interp._waitCount = 0;
        interp._waitMode = '';
        $.log('ok', 'released a wait (' + was + '); the command list and the index are untouched');
        return { ok: true, why: '' };
    };

    Ip.summary = function () {
        var av = Ip.available();
        if (!av.ok) return { ok: false, why: av.why };
        var all = Ip.all();
        var running = all.filter(function (r) { return r.running; });
        var mapI = $gameMap._interpreter;
        var starting = $.safe(function () {
            return $gameMap.events().filter(function (e) { return e.isStarting && e.isStarting(); }).length;
        }, 'starting events', 0);
        var engineSays = $.safe(function () { return !!$gameMap.isEventRunning(); }, 'isEventRunning', false);
        var interpSays = $.safe(function () { return !!mapI.isRunning(); }, 'map isRunning', false);
        return {
            ok: true,
            mapRunning: interpSays,
            mapEventId: mapI._eventId || 0,
            starting: starting,
            engineSays: engineSays,
            interpSays: interpSays,
            /* isEventRunning is `interpreter running OR any event starting` on
               both engines. When the two disagree and nothing is starting,
               something has replaced it. */
            disagree: engineSays !== (interpSays || starting > 0),
            message: messageState(),
            sceneChanging: $.safe(function () { return !!SceneManager.isSceneChanging(); }, 'scene changing', false),
            engineFrame: engineFrame(),
            modFrame: $.frameCount,
            count: running.length,
            total: all.length
        };
    };

    function messageState() {
        return $.safe(function () {
            if (typeof $gameMessage === 'undefined' || !$gameMessage) return 'no $gameMessage';
            if ($gameMessage.isChoice && $gameMessage.isChoice()) return 'choice';
            if ($gameMessage.isNumberInput && $gameMessage.isNumberInput()) return 'number input';
            if ($gameMessage.isItemChoice && $gameMessage.isItemChoice()) return 'item choice';
            if ($gameMessage.isBusy && $gameMessage.isBusy()) return 'busy';
            /* isBusy is `choice || number || item || hasText` on both engines,
               so a queued page with no window open yet is still something an
               interpreter can be waiting on. Asked separately rather than
               assumed to be covered. */
            if ($gameMessage.hasText && $gameMessage.hasText()) return 'text waiting';
            return 'idle';
        }, 'message state', 'unknown');
    }
    Ip.messageState = messageState;

    /**
     * Zero to five reasons the player has no control, each naming the panel
     * that releases it. A panel path, never a plugin: which plugin put the
     * game in this state is not knowable from here, and the way out is.
     */
    Ip.diagnose = function () {
        var out = [];
        if (!Ip.available().ok) return out;
        $.safe(function () {
            var all = Ip.all();

            $gameMap.events().forEach(function (ev) {
                if (!ev || ev._trigger !== 3) return;
                var isMine = $gameMap._interpreter && $gameMap._interpreter.isRunning() &&
                    $gameMap._interpreter._eventId === (ev.eventId ? ev.eventId() : ev._eventId);
                if (!isMine && !(ev.isStarting && ev.isStarting())) return;
                var d = $.safe(function () { return ev.event(); }, 'event data', null);
                var id = ev.eventId ? ev.eventId() : ev._eventId;
                out.push({
                    cause: 'an autorun page whose conditions still hold',
                    detail: 'event ' + id + (d && d.name ? ' “' + d.name + '”' : '') +
                        ' on this map is Autorun and its conditions still hold, so the map ' +
                        'interpreter restarts it every frame and the player never gets a frame back.',
                    fix: 'World → Switches, or World → Self for a self-switch, is where the ' +
                        'condition is released.'
                });
            });

            all.forEach(function (r) {
                if (!r.running) return;
                if (r.waitMode === 'message') {
                    if (messageState() !== 'idle') {
                        out.push({
                            cause: 'a message is holding an interpreter',
                            detail: rootLabel(r.root) + ' is waiting on the message window and ' +
                                'nothing has answered it (' + messageState() + ').',
                            fix: 'Game → Message.'
                        });
                    }
                } else if (r.waitMode === 'route' || r.waitMode === 'animation' || r.waitMode === 'balloon') {
                    out.push({
                        cause: 'a wait mode that is not clearing',
                        detail: rootLabel(r.root) + ' is waiting on “' + r.waitMode +
                            '” and the character it is waiting for has not finished.',
                        fix: 'Player → Movement.'
                    });
                } else if (r.waitMode) {
                    out.push({
                        cause: 'a wait mode that is not clearing',
                        detail: rootLabel(r.root) + ' is waiting on “' + r.waitMode + '”.',
                        fix: 'Debug → Interpreters can release the wait, and says what may then run early.'
                    });
                }
                if (r.waitCount >= 1000) {
                    out.push({
                        cause: 'a wait count in the thousands',
                        detail: rootLabel(r.root) + ' has ' + r.waitCount + ' frames of Wait left, ' +
                            'about ' + Math.round(r.waitCount / LOGICAL_FPS) + ' seconds.',
                        fix: 'Debug → Interpreters can release the wait.'
                    });
                }
                if (r.froze) {
                    out.push({
                        cause: 'the engine’s own runaway guard',
                        detail: rootLabel(r.root) + ' ran 100000 commands in one frame and the engine ' +
                            'stopped it without saying so — it is in a loop.',
                        fix: 'Debug → Interpreters shows the command it is on; World → Commands ' +
                            'shows the list around it.'
                    });
                }
            });
        }, 'diagnose');
        return out;
    };

    /* =====================================================================
       PART 5 — $.rng

       Neither engine has a generator of its own. Math.randomInt is the only
       wrapper either one ships and it reads Math.random at CALL time, which is
       why replacing Math.random seeds every roll in the game — and why a plugin
       that cached `var r = Math.random` is not covered by that and cannot be.
       ===================================================================== */
    var R = $.rng = {};

    var NATIVE_AT_LOAD = $.safe(function () {
        if (typeof Math === 'undefined' || typeof Math.random !== 'function') return false;
        return /\[native code\]/.test(Function.prototype.toString.call(Math.random));
    }, 'native Math.random', false);

    var rolls = [];
    var sites = {};
    var rollTotal = 0;        // every roll, sampled or not
    var rollRecorded = 0;     // rows actually kept
    var rollsThisFrame = 0;
    var rollsLastFrame = 0;
    var sampleTick = 0;
    var inRoll = false;
    var seedState = 0;
    var drawn = 0;
    var capTripped = false;

    function rngRecording() { return cfg('rng.watch') === true; }
    function rngSeeded() { return cfg('rng.seedOn') === true; }
    R.watching = rngRecording;
    R.seeded = rngSeeded;
    R.nativeAtLoad = function () { return NATIVE_AT_LOAD; };

    R.available = function () {
        if (typeof Math === 'undefined' || typeof Math.random !== 'function') {
            return { ok: false, why: REASONS[HOOK_RNG] };
        }
        if ($.hooks[HOOK_RNG] && !$.hooks[HOOK_RNG].installed && $.hooks[HOOK_RNG].reason) {
            return { ok: false, why: $.hooks[HOOK_RNG].reason };
        }
        return { ok: true, why: '' };
    };

    /* mulberry32 over a 32-bit state. Math.imul is Chromium 28, well below the
       floor, and the whole point of a named generator is that the same seed
       replays the same sequence on both engines and both platforms. */
    function mulberry() {
        seedState = (seedState + 0x6D2B79F5) | 0;
        var t = seedState;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        drawn++;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function siteOf() {
        return $.safe(function () {
            var stack = String(new Error('roll').stack || '').split('\n');
            for (var i = 1; i < stack.length; i++) {
                var line = stack[i];
                if (line.indexOf('GigaHack_Trace') > -1) continue;
                return line.replace(/^\s*at\s*/, '').slice(0, 120);
            }
            return 'unknown';
        }, 'roll site', 'unknown');
    }

    function recordRoll(value) {
        if (inRoll) return;
        inRoll = true;
        try {
            rollTotal++;
            rollsThisFrame++;
            var cap = num('rng.maxPerFrame', 10, 100000);
            if (rollsThisFrame > cap) {
                if (!capTripped) {
                    capTripped = true;
                    setCfg('rng.watch', false);
                    recomputeDemand();
                    pendingLog.push('roll recording switched itself off: more than ' + cap +
                        ' rolls in one frame. Recording every one of those would stall the frame, ' +
                        'so it stops instead. Debug → RNG turns it back on.');
                }
                return;
            }
            var sample = num('rng.sample', 1, 1000);
            sampleTick++;
            if (sample > 1 && (sampleTick % sample) !== 0) return;
            rollRecorded++;
            var site = cfg('rng.captureStack') ? siteOf() : '';
            var ctx = ctxDemand ? Wt.context() : null;
            var row = {
                n: rollTotal, value: value, at: Date.now(),
                frame: $.frameCount, engineFrame: engineFrame(),
                writer: Wt.describeWriter(ctx), site: site
            };
            rolls.push(row);
            var max = num('rng.maxRolls', 20, 5000);
            while (rolls.length > max) rolls.shift();
            if (site) {
                if (!sites[site]) sites[site] = { site: site, count: 0, lastAt: 0, sample: 0 };
                sites[site].count++;
                sites[site].lastAt = row.frame;
                sites[site].sample = value;
            }
        } finally {
            inRoll = false;
        }
    }

    function ensureRngAlias() {
        if (installed(HOOK_RNG)) return true;
        var ok = $.install(HOOK_RNG, typeof Math !== 'undefined' ? Math : null, 'random',
            function (original) {
                return function () {
                    var v = rngSeeded() ? mulberry() : original();
                    if (rngRecording()) recordRoll(v);
                    return v;
                };
            },
            REASONS[HOOK_RNG]);
        return ok;
    }

    function releaseRngAlias() {
        var hk = $.hooks[HOOK_RNG];
        if (!hk || !hk.installed) return { ok: true, why: '' };
        var ok = $.safe(function () { return hk.unpatch(); }, 'release Math.random', false);
        if (!ok) {
            return {
                ok: false,
                why: 'something replaced Math.random after GigaHack did, so GigaHack cannot put the ' +
                    'original back without removing theirs too — Debug → Hooks'
            };
        }
        /* The record is dropped rather than left behind as a skipped hook. This
           alias is installed on DEMAND, so "not installed" here means "not
           wanted", not "this build could not host it" — and the boot report
           lists a skipped hook as something missing. $.rng.available() and the
           RNG panel carry the state instead. */
        delete $.hooks[HOOK_RNG];
        return { ok: true, why: '' };
    }

    R.watch = function (on) {
        setCfg('rng.watch', !!on);
        capTripped = false;
        if (on) {
            if (!ensureRngAlias()) return false;
        } else if (!rngSeeded()) {
            releaseRngAlias();
        }
        recomputeDemand();
        return rngRecording();
    };

    R.seed = function (n) {
        var av = R.available();
        if (!av.ok) return { ok: false, why: av.why };
        var v = Math.floor(Number(n));
        if (!isFinite(v) || v < 0) v = 0;
        setCfg('rng.seed', v);
        seedState = v | 0;
        drawn = 0;
        return { ok: true, why: '' };
    };
    R.currentSeed = function () { return num('rng.seed', 0, 2147483647); };
    R.reseed = function () {
        seedState = R.currentSeed() | 0;
        drawn = 0;
        $.log('ok', 'the seeded sequence restarted at ' + R.currentSeed());
        return true;
    };
    R.setSeeded = function (on) {
        if (on) {
            var av = R.available();
            if (!av.ok) { U.toast({ title: 'NOT SEEDED', msg: av.why, severity: 'warn' }); return false; }
            if (!ensureRngAlias()) return false;
            setCfg('rng.seedOn', true);
            R.reseed();
        } else {
            setCfg('rng.seedOn', false);
            if (!rngRecording()) releaseRngAlias();
        }
        recomputeDemand();
        return rngSeeded();
    };
    R.release = function () {
        setCfg('rng.seedOn', false);
        if (rngRecording()) setCfg('rng.watch', false);
        var r = releaseRngAlias();
        recomputeDemand();
        return r;
    };
    R.drawn = function () { return drawn; };
    /** One number from the seeded stream without going through Math.random. */
    R.next = function () { return mulberry(); };

    R.rolls = function () { return rolls.slice(); };
    R.sites = function () {
        var out = [];
        var total = 0, k;
        for (k in sites) total += sites[k].count;
        for (k in sites) {
            out.push({
                site: sites[k].site, count: sites[k].count,
                share: total ? Math.round(sites[k].count * 100 / total) : 0,
                lastAt: sites[k].lastAt, sample: sites[k].sample
            });
        }
        return out.sort(function (a, b) { return b.count - a.count; });
    };
    R.clear = function () {
        rolls.length = 0; sites = {};
        rollTotal = 0; rollRecorded = 0; rollsThisFrame = 0; rollsLastFrame = 0;
        capTripped = false;
        return true;
    };
    R.count = function () {
        return { session: rollTotal, lastFrame: rollsLastFrame, recorded: rollRecorded };
    };
    /** Distinct call sites, without building and sorting the table to count. */
    R.siteCount = function () {
        var n = 0, k;
        for (k in sites) if (Object.prototype.hasOwnProperty.call(sites, k)) n++;
        return n;
    };

    /**
     * Two signals for the panel, because the two halves move at different
     * rates and one signal would make the slower half pay the faster one's
     * bill. "rolls last frame" is by definition a per-frame number, so
     * R.stamp() differs on almost every tick while the game rolls — cheap,
     * because it writes five text nodes. R.tableStamp() moves only when a row
     * is actually kept, so the list does not repaint 86 times a minute while a
     * one-in-a-hundred sample records nothing.
     *
     * rolls.length is in the table's stamp beside rollRecorded, never instead
     * of it: the roll list is a ring and its length stops moving the moment it
     * fills, which is where it spends the rest of the session.
     */
    R.stamp = function () {
        return rollTotal + '/' + rollsLastFrame + '/' + rollRecorded + '/' + drawn + '/' + R.siteCount();
    };
    R.tableStamp = function () {
        return rollRecorded + '/' + rolls.length + '/' + R.siteCount();
    };

    R.caveats = function () {
        return [
            'Anything that took a reference to Math.random before this was switched on keeps the ' +
            'real one. Those rolls stay random and never appear here.',
            'Neither engine has a generator of its own — both call Math.random — so seeding it ' +
            'seeds everything: damage variance, drops, encounters, and also animations, weather ' +
            'and particles. A seeded run looks subtly stiller than a real one.',
            'The sequence advances on every roll, not only the ones you care about. Re-rolling the ' +
            'same drop means the same save, the same seed, and the same actions in the same order.',
            'Seeding is off every time the game starts, whatever the settings file says.'
        ];
    };

    /* =====================================================================
       PART 6 — THE PER-FRAME TAIL

       Everything a write wanted to do but must not do from inside the
       interpreter's own while-loop happens here, one frame later.
       ===================================================================== */
    $.onFrame('trace', function () {
        rollsLastFrame = rollsThisFrame;
        rollsThisFrame = 0;

        if (pendingLog.length) {
            for (var i = 0; i < pendingLog.length; i++) $.log('info', pendingLog[i]);
            pendingLog.length = 0;
        }

        if (pendingRemove.length) {
            for (var r = 0; r < pendingRemove.length; r++) Wt.remove(pendingRemove[r]);
            pendingRemove.length = 0;
        }

        if (pendingPause) {
            var hit = pendingPause;
            pendingPause = null;
            if ($.pause && $.pause.available()) {
                heldByHit = true;
                $.store.cfgSet('behaviour.pauseGame', true);
                if (U.setOpen) U.setOpen(true);
                U.toast({
                    title: 'HELD',
                    msg: hit.label + ' — this set "pause the game while the menu is open", ' +
                        'which is a setting you did not touch. The Watchpoints panel has the ' +
                        'button that clears it.',
                    severity: 'warn'
                });
            } else {
                $.log('warn', 'a watchpoint asked to hold the game and pause is unavailable — ' +
                    ($.pause ? $.pause.why() : 'the hooks module did not load'));
            }
        }

        if (pendingEvidence.length && cfg('journal.recordUnanchored') !== false) {
            /* A verify that no $.undo.push followed still happened. It becomes
               its own row rather than being dropped, or the journal would be a
               partial record that looks complete. */
            for (var e = 0; e < pendingEvidence.length; e++) {
                var ev = pendingEvidence[e];
                addRow({
                    kind: 'unanchored', label: ev.control + ' → ' + fmt(ev.want),
                    what: ev.control, from: fmt(ev.got), to: fmt(ev.want),
                    control: ev.control, want: ev.want, got: ev.got,
                    stuck: !!ev.ok, culprits: ev.culprits, message: ev.message,
                    undoable: false, pushIndex: 0, depthAfter: undoSize()
                });
            }
            pendingEvidence.length = 0;
        } else if (pendingEvidence.length) {
            pendingEvidence.length = 0;
        }
    });

    /* =====================================================================
       PART 7 — PANELS
       ===================================================================== */
    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: String(label) }),
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall',
                text: String(value)
            }));
    }
    function note(text) {
        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px', text: text });
    }
    function warnNote(text) {
        return h('div', {
            class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)', text: text
        });
    }
    function nothing(title, lines) {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: title }),
                h('div', { style: 'text-align:center;line-height:1.9' },
                    lines.map(function (l) { return h('div', { text: l }); }))));
    }

    /* ------------------------------------------------------- Watchpoints */
    var draft = {
        kind: 'variable', id: 0, eventId: 0, letter: 'A',
        when: WHEN_LABELS[0], value: 0, lo: 0, hi: 0, pause: false, once: false
    };
    var searchQ = '';
    var hitFilter = 'all';
    var selectedHit = null;

    function resolveSearch(kind, q) {
        var res = null;
        if ($.index) {
            if (kind === 'variable' && $.index.findVar) res = $.index.findVar(q, 12);
            else if (kind === 'switch' && $.index.findSwitch) res = $.index.findSwitch(q, 12);
        }
        if (res && res.complete) return res;
        /* The index is for finding, never authority — and where it cannot
           answer, the live database still can. */
        var out = [];
        var names = kind === 'variable'
            ? (typeof $dataSystem !== 'undefined' && $dataSystem ? $dataSystem.variables : null)
            : (typeof $dataSystem !== 'undefined' && $dataSystem ? $dataSystem.switches : null);
        if (names) {
            var needle = String(q || '').toLowerCase();
            for (var i = 1; i < names.length && out.length < 12; i++) {
                var n = String(names[i] || '');
                if (!needle || n.toLowerCase().indexOf(needle) > -1 || String(i) === needle) {
                    out.push({ id: i, name: n });
                }
            }
        }
        return {
            candidates: out, complete: !!names,
            why: res ? res.why : (names ? '' : 'the database is not loaded yet — start or load a game, ' +
                'then reopen this tab')
        };
    }

    function buildWatchpoints() {
        var av = Wt.available();
        if (!av.ok) {
            return h('div', { class: 'mm-body' },
                W.group('Nothing can be watched', [
                    warnNote(av.why),
                    note('Debug → Hooks lists the three aliases that failed and why.')
                ], { grow: true }));
        }

        var att = Wt.attributable();
        var armed = Wt.armed();
        var enabled = cfg('watch.enabled') !== false;

        /* --------------------------------------------------- new watchpoint */
        var kindDd = W.dropdown({
            options: ['variable', 'switch', 'self-switch'], value: draft.kind, width: '124px', _ungated: true,
            onChange: function (v) { draft.kind = v; draft.id = 0; U.rerender(); }
        });

        var picker = [];
        if (draft.kind === 'self-switch') {
            var evs = $.safe(function () {
                return (typeof $gameMap !== 'undefined' && $gameMap) ? $gameMap.events() : [];
            }, 'events', []) || [];
            if (!evs.length) {
                picker.push(warnNote('this map has no events, so there is no self-switch to watch'));
            } else {
                var opts = evs.map(function (e) {
                    var d = $.safe(function () { return e.event(); }, 'event data', null);
                    return (e.eventId ? e.eventId() : e._eventId) + ' ' + ((d && d.name) || '');
                });
                if (!draft.eventId) draft.eventId = parseInt(opts[0], 10) || 0;
                picker.push(W.row('Event', W.dropdown({
                    options: opts, value: String(draft.eventId) + ' ' + eventName($gameMap.mapId(), draft.eventId),
                    width: '150px', _ungated: true,
                    onChange: function (v) { draft.eventId = parseInt(v, 10) || 0; }
                })));
                picker.push(W.row('Letter', W.dropdown({
                    options: ['A', 'B', 'C', 'D', 'any'], value: draft.letter, width: '86px', _ungated: true,
                    onChange: function (v) { draft.letter = v; }
                })));
            }
        } else {
            var found = resolveSearch(draft.kind, searchQ);
            picker.push(W.search({
                placeholder: 'id or name', value: searchQ,
                onInput: function (v) { searchQ = v; U.rerender(); }
            }));
            if (!found.complete && found.why) picker.push(warnNote(found.why));
            var chips = found.candidates.map(function (c) {
                return W.button({
                    label: c.id + (c.name ? ' ' + c.name : ''), mini: true, _ungated: true,
                    variant: draft.id === c.id ? 'prime' : null,
                    onClick: function () { draft.id = c.id; U.rerender(); }
                });
            });
            picker.push(h('div', { class: 'mm-inline', style: 'flex-wrap:wrap' }, chips));
            if (!chips.length) picker.push(note('nothing matches'));
        }

        var wk = whenKey(draft.when);
        var takesValue = wk === 'becomes' || wk === 'above' || wk === 'below';
        var newGroup = W.group('New watchpoint', [
            W.row('Watch a', kindDd),
            picker,
            h('div', { class: 'mm-sep' }),
            W.row('Fires on', W.dropdown({
                options: WHEN_LABELS, value: draft.when, width: '112px', _ungated: true,
                onChange: function (v) { draft.when = v; U.rerender(); }
            })),
            W.row('Value', W.number({
                value: draft.value, disabled: !takesValue, _ungated: true, label: 'watch value',
                onChange: function (v) { draft.value = v; }
            }), takesValue ? null : { tip: 'Value|This condition takes no value.' }),
            wk === 'outside' ? W.row('Range low', W.number({
                value: draft.lo, _ungated: true, label: 'range low',
                onChange: function (v) { draft.lo = v; }
            })) : null,
            wk === 'outside' ? W.row('Range high', W.number({
                value: draft.hi, _ungated: true, label: 'range high',
                onChange: function (v) { draft.hi = v; }
            })) : null,
            W.toggleRow('Pause the game on a hit', {
                value: draft.pause, _ungated: true,
                disabled: !($.pause && $.pause.available()),
                sub: $.pause && $.pause.available() ? '' : ($.pause ? $.pause.why() : 'no pause'),
                tip: 'Pause|Holds the game on the next frame, not the command.',
                onChange: function (v) { draft.pause = v; }
            }),
            W.toggleRow('Remove itself after the first hit', {
                value: draft.once, _ungated: true,
                onChange: function (v) { draft.once = v; }
            }),
            W.button({
                label: 'add watchpoint', wide: true, _ungated: true,
                disabled: draft.kind === 'self-switch' ? !draft.eventId : !draft.id,
                tip: 'Add|Arming a watchpoint writes nothing to the game.',
                onClick: function () {
                    var spec;
                    if (draft.kind === 'self-switch') {
                        spec = {
                            kind: 'selfswitch',
                            target: $gameMap.mapId() + ',' + draft.eventId,
                            letter: draft.letter
                        };
                    } else {
                        spec = { kind: draft.kind === 'switch' ? 'switch' : 'var', id: draft.id };
                    }
                    spec.when = wk;
                    spec.value = wk === 'outside' ? draft.lo : draft.value;
                    spec.hi = draft.hi;
                    spec.pause = draft.pause;
                    spec.once = draft.once;
                    if (Wt.add(spec)) U.rerender();
                }
            })
        ]);

        /* -------------------------------------------------------- behaviour */
        var behaviour = W.group('Behaviour', [
            W.toggleRow('Watchpoints armed', {
                value: enabled, _ungated: true,
                sub: enabled ? '' : 'the three setValue aliases return the original call and nothing else',
                onChange: function (v) { setCfg('watch.enabled', v); recomputeDemand(); U.rerender(); }
            }),
            W.toggleRow('Log every hit', {
                value: cfg('watch.logHits') !== false, _ungated: true,
                onChange: function (v) { setCfg('watch.logHits', v); }
            }),
            W.toggleRow('Stack trace when unattributed', {
                value: cfg('watch.captureStack') === true, _ungated: true,
                sub: 'one Error object per unattributed write',
                onChange: function (v) { setCfg('watch.captureStack', v); }
            }),
            W.button({
                label: 'resume the game', wide: true, variant: 'prime', _ungated: true,
                disabled: !Wt.held(),
                tip: 'Resume|Clears the pause setting a hit turned on.',
                onClick: function () { Wt.resume(); U.rerender(); }
            }),
            W.button({
                label: 'clear hits', wide: true, variant: 'danger', _ungated: true,
                disabled: !hits.length,
                onClick: function () { Wt.clearHits(); selectedHit = null; U.rerender(); }
            })
        ], { tag: enabled ? armed + ' armed' : 'idle' });

        var side = [newGroup, behaviour];
        if (!att.ok) {
            side.push(W.group('Who wrote it?', [
                warnNote(att.why),
                note('watchpoints still fire and still say what changed; the who column will read ' +
                    '"unattributed" on every row.')
            ]));
        }

        /* ------------------------------------------------------------ armed */
        var armedTable = W.table({
            key: 'trace.watchpoints', rowH: 17,
            cols: [
                { label: 'on', w: '0 0 28px' },
                { label: 'what', w: '0 0 64px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'fires on', w: '0 0 110px' },
                { label: 'hits', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'last', w: '0 0 54px', cls: 'mm-td-num' },
                { label: '', w: '0 0 46px' }
            ],
            empty: 'nothing is being watched',
            render: function (p) {
                var what = p.kind === 'var' ? 'V' + p.target
                    : p.kind === 'switch' ? 'S' + p.target : 'SS';
                var name = p.kind === 'var' ? varName(p.target)
                    : p.kind === 'switch' ? switchName(p.target)
                        : p.target + ' ' + (p.letter || 'any');
                var when = whenLabel(p.when);
                if (p.when === 'becomes' || p.when === 'above' || p.when === 'below') when += ' ' + p.value;
                if (p.when === 'outside') when += ' ' + p.value + '–' + p.hi;
                return [
                    W.checkbox({
                        value: p.enabled, _ungated: true, label: 'watchpoint',
                        onChange: function (v) { Wt.enable(p.id, v); U.rerender(); }
                    }),
                    what, name, when, String(p.hits), p.last ? String(p.last) : '—',
                    W.button({
                        label: 'x', mini: true, _ungated: true,
                        onClick: function () { Wt.remove(p.id); U.rerender(); }
                    })
                ];
            }
        });
        armedTable.mm.paint(Wt.list());

        /* ------------------------------------------------------------- hits */
        function hitRows() {
            var list = hits.slice().reverse();
            if (hitFilter === 'events only') {
                list = list.filter(function (x) { return x.where === 'event' || x.where === 'common'; });
            } else if (hitFilter === 'unattributed') {
                list = list.filter(function (x) { return x.where === 'unknown'; });
            }
            return list;
        }

        var hitTable = W.table({
            key: 'trace.hits', rowH: 17, virtual: true,
            cols: [
                { label: 'when', w: '0 0 48px', cls: 'mm-td-num' },
                { label: 'what', w: '0 0 60px' },
                { label: 'from', w: '0 0 70px', cls: 'mm-td-num' },
                { label: 'to', w: '0 0 70px', cls: 'mm-td-val' },
                { label: 'who', w: '1 1 0' },
                { label: 'command', w: '1 1 0' },
                { label: '', w: '0 0 40px' }
            ],
            empty: 'no hits yet',
            render: function (r) {
                var what = r.kind === 'var' ? 'V' + r.id : r.kind === 'switch' ? 'S' + r.id : r.key;
                return [
                    String(r.frame) + (r.count > 1 ? ' ×' + r.count : ''),
                    what, fmt(r.from), fmt(r.to),
                    r.where === 'unknown' ? 'unattributed' : r.writer,
                    r.command || '',
                    W.button({
                        label: 'pick', mini: true, _ungated: true,
                        onClick: function () { selectedHit = r; U.rerender(); }
                    })
                ];
            },
            onRow: function (tr, r) {
                tr.setAttribute('data-mm-tip', r.label + '|' + r.writer +
                    (r.command ? ' · ' + r.command : '') +
                    ' · engine frame ' + r.engineFrame);
                if (selectedHit && selectedHit.n === r.n) tr.classList.add('mm-on');
            }
        });
        hitTable.mm.paint(hitRows());

        var lastPainted = totalHits;
        var host = U.getHost();
        if (host) {
            host.fastHooks.push(function (n) {
                if (n % 6) return;
                if (hitTable.mm.isScrolling()) return;
                if (lastPainted === totalHits) return;
                lastPainted = totalHits;
                hitTable.mm.paint(hitRows());
            });
        }

        var filterChips = ['all', 'events only', 'unattributed'].map(function (f) {
            return W.button({
                label: f, mini: true, _ungated: true,
                variant: hitFilter === f ? 'prime' : null,
                onClick: function () { hitFilter = f; U.rerender(); }
            });
        });

        var hitToolbar = h('div', { class: 'mm-toolbar' },
            filterChips,
            h('div', { class: 'mm-title-sep' }),
            W.button({
                label: 'copy what is shown', mini: true, _ungated: true,
                onClick: function () {
                    var text = hitRows().map(function (r) {
                        return 'f' + r.frame + '  ' + r.label + '  ' + fmt(r.from) + ' → ' +
                            fmt(r.to) + '  ' + r.writer + (r.command ? '  ' + r.command : '');
                    }).join('\n');
                    U.toast(U.copyText(text)
                        ? { title: 'COPIED', msg: hitRows().length + ' hits', severity: 'ok' }
                        : { title: 'NO CLIPBOARD', msg: 'this build offers none', severity: 'warn' });
                }
            }),
            W.button({
                label: 'find events that touch this', mini: true, _ungated: true,
                disabled: !selectedHit,
                tip: selectedHit ? null : 'Find|Select a hit first.',
                onClick: function () {
                    if (!selectedHit) return;
                    if (!$.index || !$.index.findEventsTouching) {
                        U.toast({
                            title: 'NO INDEX',
                            msg: 'the Index module did not load, so only this map could be searched',
                            severity: 'warn'
                        });
                        return;
                    }
                    var type = selectedHit.kind === 'var' ? 'variable'
                        : selectedHit.kind === 'switch' ? 'switch' : 'selfswitch';
                    var res = $.index.findEventsTouching(type, selectedHit.id);
                    U.toast({
                        title: res.candidates.length + ' CANDIDATES',
                        msg: (res.complete ? 'resolve each against the live map before trusting it'
                            : res.why),
                        severity: res.complete ? 'ok' : 'warn'
                    });
                }
            }));

        return cols({ narrow: true, items: side }, [
            W.group('Armed', [armedTable], { tag: String(points.length) }),
            W.group('Hits', [
                hitToolbar, hitTable,
                note('The writer is captured at the moment of the write, so it is still right after ' +
                    'the interpreter has moved on. Pause holds the game on the NEXT frame — the ' +
                    'command that made the write has already finished.')
            ], { grow: true, tag: String(hits.length) })
        ]);
    }

    /* ----------------------------------------------------------- Journal */
    var journalFilter = 'all';

    function buildJournal() {
        var feeds = J.feeds();
        if (!feeds.undo && !feeds.verify) {
            return h('div', { class: 'mm-body' },
                W.group('Nothing is being recorded', [warnNote(feeds.why)], { grow: true }));
        }

        var top = $.safe(undoPeek, 'peek', null);
        function oldestText() { return rows.length ? ('frame ' + rows[0].frame) : '—'; }

        var recordedRow = kv('writes recorded', rows.length);
        var stuckRow = kv('did not stick', J.stuckRows().length);
        var liveRow = kv('reversible now', liveRows.length);
        var depthRow = kv('undo depth', undoSize());
        var oldestRow = kv('oldest row kept', oldestText());
        var topNote = note(top ? top.label : 'the undo stack is empty');
        var undoOne = W.button({
            label: 'undo the last change', wide: true, mutates: true,
            disabled: !undoSize(),
            tip: undoSize() ? null : 'Undo|The undo stack is empty.',
            onClick: function () { undoPop(); U.rerender(); }
        });
        /* The options object is what the button reads at click time, so the
           count in the confirmation is kept current by writing back into it
           rather than by rebuilding the button — which would also throw away
           its armed state mid-decision. */
        var undoAllOpts = {
            label: 'undo everything back to the start of the session',
            wide: true, variant: 'danger', confirm: true,
            confirmLabel: 'undo ' + undoSize() + ' changes?',
            disabled: !undoSize(),
            onClick: function () {
                var n = 0;
                /* Stops the moment pop() returns false, so an empty
                   stack never spams the log. */
                while (undoPop()) n++;
                U.toast({ title: 'UNDONE', msg: n + ' changes', severity: 'ok' });
                U.rerender();
            }
        };
        var undoAll = W.button(undoAllOpts);

        var side = [
            W.group('This session', [
                recordedRow, stuckRow, liveRow, depthRow, oldestRow
            ], { tag: feeds.verify ? 'verified' : 'unverified' }),
            W.group('Undo', [undoOne, topNote, undoAll]),
            W.group('Not recorded', J.blindSpots().map(note), { collapsed: true })
        ];
        if (!feeds.undo || !feeds.verify) side.splice(1, 0, W.group('Partly fed', [warnNote(feeds.why)]));

        function journalRows() {
            var list = J.rows().slice().reverse();
            if (journalFilter === 'did not stick') {
                list = list.filter(function (r) { return r.stuck === false; });
            } else if (journalFilter === 'reversible') {
                list = list.filter(function (r) { return r.undoable; });
            }
            return list;
        }

        var table = W.table({
            key: 'trace.journal', rowH: 17, virtual: true,
            cols: [
                { label: '#', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'when', w: '0 0 48px', cls: 'mm-td-num' },
                { label: 'what', w: '1 1 0' },
                { label: 'before', w: '0 0 70px', cls: 'mm-td-num' },
                { label: 'after', w: '0 0 70px', cls: 'mm-td-val' },
                { label: feeds.verify ? 'stuck' : '—', w: '0 0 44px' },
                { label: 'control', w: '0 0 90px' },
                { label: '', w: '0 0 74px' }
            ],
            empty: 'GigaHack has not changed anything yet',
            render: function (r) {
                var can = J.canUndoTo(r.seq);
                var mark = r.stuck === true ? '✓' : r.stuck === false ? '✗' : '—';
                var cell = h('span', {
                    text: mark,
                    tip: r.stuck === false && r.control && $.compat && $.compat.isDegraded(r.control)
                        ? 'Did not stick|' + $.compat.degradedWhy(r.control)
                        : (r.stuck === null ? 'Not verified|This write was not verified.' : null)
                });
                return [
                    String(r.seq), String(r.frame), r.what || r.label,
                    r.from || '—', r.to || '—', cell, r.control || '—',
                    W.button({
                        label: 'undo to here', mini: true, mutates: true, variant: 'danger',
                        confirm: true, confirmLabel: 'undo ' + can.count + ' changes?',
                        disabled: !can.ok,
                        tip: can.ok ? null : 'Cannot undo|' + can.why,
                        onClick: function () { J.undoTo(r.seq); U.rerender(); }
                    })
                ];
            }
        });
        table.mm.paint(journalRows());

        var chips = ['all', 'did not stick', 'reversible'].map(function (f) {
            return W.button({
                label: f, mini: true, _ungated: true,
                variant: journalFilter === f ? 'prime' : null,
                onClick: function () { journalFilter = f; U.rerender(); }
            });
        });

        var toolbar = h('div', { class: 'mm-toolbar' }, chips,
            h('div', { class: 'mm-title-sep' }),
            W.button({
                label: 'copy what is shown', mini: true, _ungated: true,
                onClick: function () {
                    U.toast(U.copyText(J.text(journalRows()))
                        ? { title: 'COPIED', msg: journalRows().length + ' rows', severity: 'ok' }
                        : { title: 'NO CLIPBOARD', msg: 'this build offers none', severity: 'warn' });
                }
            }));

        var journalGroup = W.group('Change journal', [toolbar, table],
            { grow: true, tag: String(rows.length) });

        /* Every panel in the mod writes into this one: open it, go and change
           a variable somewhere else, come back, and it used to still say
           nothing had happened. The signal is the journal's own revision —
           rows.length is a ring that stops moving once it is full, and
           totalPushes cannot see the undo stack being cleared under the
           "undo to here" buttons.

           Held while a confirm is armed anywhere in the table: those buttons
           are two-click by design and a repaint between the clicks would put
           the first one back. */
        U.live(J.revision, function () {
            table.mm.paint(journalRows());
            recordedRow.lastChild.textContent = String(rows.length);
            stuckRow.lastChild.textContent = String(J.stuckRows().length);
            liveRow.lastChild.textContent = String(liveRows.length);
            depthRow.lastChild.textContent = String(undoSize());
            oldestRow.lastChild.textContent = oldestText();
            var peek = $.safe(undoPeek, 'peek', null);
            topNote.textContent = peek ? peek.label : 'the undo stack is empty';
            undoOne.mm.disable(!undoSize());
            undoAll.mm.disable(!undoSize());
            undoAllOpts.confirmLabel = 'undo ' + undoSize() + ' changes?';
            journalGroup.mm.tag(String(rows.length));
        }, {
            name: 'change journal', within: table,
            when: function () {
                return !table.mm.isScrolling() && !table.querySelector('.mm-armed');
            },
            whyNot: 'a confirmation is waiting for its second click'
        });

        return cols({ narrow: true, items: side }, [journalGroup]);
    }

    /* ------------------------------------------------------ Interpreters */
    var selectedInterp = null;

    function buildInterpreters() {
        var av = Ip.available();
        if (!av.ok) {
            return h('div', { class: 'mm-body' },
                W.group('Nothing to read', [warnNote(av.why)], { grow: true }));
        }

        var all = Ip.all();
        var sum = Ip.summary();
        if (selectedInterp) {
            var stillThere = false;
            for (var i = 0; i < all.length; i++) if (all[i].interp === selectedInterp) stillThere = true;
            if (!stillThere) selectedInterp = null;
        }

        var rightNow = W.group('Right now', [
            kv('map interpreter', sum.mapRunning
                ? 'running' + (sum.mapEventId ? ' · event ' + sum.mapEventId : ' · no event')
                : 'idle'),
            kv('events starting', sum.starting),
            (function () {
                var row = kv('$gameMap.isEventRunning()', String(sum.engineSays) +
                    '  (the interpreter says ' + String(sum.interpSays) + ')');
                if (sum.disagree) {
                    row.setAttribute('data-mm-tip', 'Disagreement|something replaced ' +
                        'isEventRunning; the interpreter’s own answer is trusted here.');
                    row.style.color = 'var(--mm-warn)';
                }
                return row;
            })(),
            kv('message', sum.message),
            kv('scene changing', String(sum.sceneChanging)),
            kv('engine frame', sum.engineFrame,
                'Two clocks|One engine keeps counting while the game is held; the other stops.'),
            kv('mod frame', sum.modFrame),
            kv('interpreters', sum.count + ' running of ' + sum.total)
        ]);

        var diag = Ip.diagnose();
        var stuck = W.group('If the game is stuck',
            diag.length ? diag.map(function (d) {
                return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                    h('b', { text: d.cause + ' — ' }), d.detail + ' ' + d.fix);
            }) : [note('nothing here is holding the game.')],
            { tag: diag.length ? String(diag.length) : 'clear' });

        var idle = Ip.idleCommonEvents();
        var notRunning = W.group('Not running', idle.length ? idle.map(function (c) {
            return note('common event ' + c.id + (c.name ? ' “' + c.name + '” ' : ' ') +
                'has no interpreter: ' + (c.switchId
                    ? ('switch ' + c.switchId + (c.switchName ? ' “' + c.switchName + '”' : '') +
                        ' is ' + (c.on ? 'on' : 'off'))
                    : 'its gate switch was never picked in the editor, so it can never fire') +
                '. A parallel common event only has an interpreter while its switch is on.');
        }) : [note('every parallel common event on this map has an interpreter.')],
            { collapsed: !idle.length, tag: String(idle.length) });

        var selRow = null;
        for (var s = 0; s < all.length; s++) if (all[s].interp === selectedInterp) selRow = all[s];

        var selected = W.group('Selected', selRow ? [
            kv('where', selRow.where),
            kv('depth', selRow.depth),
            kv('map', selRow.mapId),
            kv('event', selRow.eventId || '—'),
            kv('index', selRow.index + ' of ' + selRow.total),
            kv('command', selRow.command || '—'),
            kv('wait mode', selRow.waitMode || '—'),
            kv('wait frames', selRow.waitCount),
            kv('child chain', childChain(selRow.interp)),
            W.button({
                label: 'release this wait', wide: true, mutates: true, confirm: true,
                disabled: !(selRow.waitMode || selRow.waitCount),
                tip: (selRow.waitMode || selRow.waitCount) ? null
                    : 'Cannot release|This interpreter is not waiting.',
                onClick: function () {
                    var r = Ip.releaseWait(selRow.interp);
                    U.toast(r.ok
                        ? { title: 'RELEASED', msg: 'the count and the mode are cleared', severity: 'ok' }
                        : { title: 'NOT RELEASED', msg: r.why, severity: 'warn' });
                    U.rerender();
                }
            }),
            note('This clears the count and the mode, exactly as the engine does when the wait ends. ' +
                'It does not touch the command list or the index. What it cannot do is finish the ' +
                'thing being waited for — a move route still running, a message still open — so the ' +
                'commands after the wait may run earlier than the event expects.'),
            selRow.kind === 'event' || selRow.kind === 'common'
                ? note('There is no stop button for a parallel page: the engine sets the same list ' +
                    'up again on the next frame. What stops it is the page condition — for a common ' +
                    'event, the switch that governs it.')
                : null
        ] : [note('select an interpreter')]);

        var table = W.table({
            key: 'trace.interp', rowH: 17,
            cols: [
                { label: 'depth', w: '0 0 34px', cls: 'mm-td-num' },
                { label: 'where', w: '1 1 0' },
                { label: 'running', w: '0 0 54px' },
                { label: 'at', w: '0 0 54px', cls: 'mm-td-num' },
                { label: 'command', w: '1 1 0' },
                { label: 'wait', w: '0 0 96px' },
                { label: '', w: '0 0 46px' }
            ],
            empty: 'no interpreter objects exist yet',
            render: function (r) {
                var where = h('span', { style: r.depth ? ('padding-left:' + (r.depth * 10) + 'px') : null },
                    h('span', { text: r.where }),
                    r.aliased ? null : h('span', {
                        class: 'mm-chip mm-on', style: 'margin-left:4px',
                        text: 'not aliased',
                        tip: 'Not aliased|something subclassed this interpreter, so its writes ' +
                            'read as unattributed.'
                    }));
                return [
                    String(r.depth), where, r.running ? 'yes' : 'idle',
                    r.total ? (r.index + '/' + r.total) : '—',
                    r.command || '—',
                    r.waitMode ? (r.waitMode + (r.waitCount ? ' ' + r.waitCount : ''))
                        : (r.waitCount ? r.waitCount + ' frames' : '—'),
                    W.button({
                        label: 'select', mini: true, _ungated: true,
                        onClick: function () { selectedInterp = r.interp; U.rerender(); }
                    })
                ];
            }
        });
        table.mm.paint(all);

        var listTable = W.table({
            key: 'trace.commands', rowH: 17, virtual: true,
            cols: [
                { label: '#', w: '0 0 44px', cls: 'mm-td-num' },
                { label: '', w: '0 0 16px' },
                { label: 'command', w: '1 1 0' }
            ],
            empty: 'select an interpreter',
            render: function (c) {
                return [String(c.i), c.i === (selRow ? selRow.index : -1) ? '▸' : '', c.text];
            },
            onRow: function (tr, c) {
                if (selRow && c.i === selRow.index) tr.classList.add('mm-on');
            }
        });
        listTable.mm.paint(selRow ? Ip.commandList(selRow.interp) : []);

        var follow = W.toggleRow('follow the game', {
            value: cfg('interp.autoRefresh') !== false, _ungated: true,
            onChange: function (v) { setCfg('interp.autoRefresh', v); }
        });

        var host = U.getHost();
        if (host) {
            var every = num('interp.refreshEvery', 1, 120);
            host.fastHooks.push(function (n) {
                if (cfg('interp.autoRefresh') === false) return;
                if (n % every) return;
                if (table.mm.isScrolling() || listTable.mm.isScrolling()) return;
                var next = Ip.all();
                table.mm.paint(next);
                var cur = null;
                for (var k = 0; k < next.length; k++) if (next[k].interp === selectedInterp) cur = next[k];
                listTable.mm.paint(cur ? Ip.commandList(cur.interp) : []);
            });
        }

        return cols({ narrow: true, items: [rightNow, stuck, notRunning, selected] }, [
            W.group('Running', [follow, table], { tag: sum.count + ' of ' + sum.total }),
            W.group('Command list', [listTable], {
                grow: true,
                tag: selRow ? ('index ' + selRow.index + ' of ' + selRow.total) : '—'
            })
        ]);
    }

    function childChain(interp) {
        var out = [], cur = interp, guard = 0;
        while (cur && guard++ < 32) {
            out.push(cur._list ? (cur._index + '/' + cur._list.length) : 'idle');
            cur = cur._childInterpreter;
        }
        return out.join(' → ');
    }

    /* --------------------------------------------------------------- RNG */
    var rngMode = 'rolls';

    function buildRng() {
        var av = R.available();
        var recording = rngRecording();
        var seeded = rngSeeded();
        var counts = R.count();

        var sessionRow = kv('rolls this session', counts.session);
        var lastFrameRow = kv('rolls last frame', counts.lastFrame);
        var sitesRow = kv('distinct call sites', R.sites().length);
        var recordedRow = kv('recorded', counts.recorded);
        var drawnRow = kv('numbers drawn', R.drawn());
        var clearBtn = W.button({
            label: 'clear', wide: true, variant: 'danger', _ungated: true,
            disabled: !counts.session,
            onClick: function () { R.clear(); U.rerender(); }
        });

        var recGroup = W.group('Recording', [
            W.toggleRow('Record rolls', {
                value: recording, _ungated: true, disabled: !av.ok,
                sub: av.ok ? '' : av.why,
                onChange: function (v) { R.watch(v); U.rerender(); }
            }),
            W.row('Sample', W.number({
                value: num('rng.sample', 1, 1000), min: 1, max: 1000, _ungated: true, label: 'sample',
                onChange: function (v) { setCfg('rng.sample', v); }
            }), { sub: 'record 1 roll in N; the count is exact either way' }),
            W.toggleRow('Capture call sites', {
                value: cfg('rng.captureStack') === true, _ungated: true,
                sub: 'one Error object per recorded roll',
                tip: 'Call sites|Leave it off unless you are hunting a specific roll.',
                onChange: function (v) { setCfg('rng.captureStack', v); U.rerender(); }
            }),
            sessionRow, lastFrameRow, sitesRow, recordedRow, clearBtn
        ], { tag: recording ? 'on' : 'off' });

        var seedRows = [];
        if (!NATIVE_AT_LOAD) {
            seedRows.push(warnNote('Math.random was already replaced when this loaded — something ' +
                'else got there first. Seeding replaces that one, and releasing puts that one back, ' +
                'not the browser’s.'));
        }
        seedRows.push(W.toggleRow('Seed the generator', {
            value: seeded, disabled: !av.ok,
            sub: av.ok ? '' : av.why,
            tip: 'Seeding|Makes animations, weather and particles deterministic too.',
            onChange: function (v) { R.setSeeded(v); U.rerender(); }
        }));
        seedRows.push(W.row('Seed', W.number({
            value: R.currentSeed(), min: 0, max: 2147483647, _ungated: true, label: 'seed',
            onChange: function (v) { R.seed(v); }
        })));
        seedRows.push(W.button({
            label: 'restart the sequence', wide: true, mutates: true,
            disabled: !seeded,
            tip: seeded ? null : 'Restart|The generator is not seeded.',
            onClick: function () { R.reseed(); U.rerender(); }
        }));
        seedRows.push(W.button({
            label: 'release', wide: true, variant: 'prime', _ungated: true,
            disabled: !seeded && !recording,
            tip: (seeded || recording) ? null : 'Release|The generator is not seeded.',
            onClick: function () {
                var r = R.release();
                U.toast(r.ok
                    ? { title: 'RELEASED', msg: 'Math.random is the host’s own function again', severity: 'ok' }
                    : { title: 'NOT RELEASED', msg: r.why, severity: 'warn' });
                U.rerender();
            }
        }));
        seedRows.push(drawnRow);
        var seedGroup = W.group('Seeding', seedRows, { tag: seeded ? 'seeded' : 'off' });

        var costs = W.group('What seeding costs', R.caveats().map(note), { collapsed: !seeded });

        var modeChips = ['rolls', 'call sites'].map(function (m) {
            return W.button({
                label: m, mini: true, _ungated: true,
                variant: rngMode === m ? 'prime' : null,
                onClick: function () { rngMode = m; U.rerender(); }
            });
        });

        var table;
        if (rngMode === 'rolls') {
            table = W.table({
                key: 'trace.rolls', rowH: 17, virtual: true,
                cols: [
                    { label: 'when', w: '0 0 48px', cls: 'mm-td-num' },
                    { label: '#', w: '0 0 56px', cls: 'mm-td-num' },
                    { label: 'value', w: '0 0 80px', cls: 'mm-td-val' },
                    { label: 'who', w: '1 1 0' },
                    { label: 'site', w: '1 1 0' }
                ],
                empty: recording ? 'nothing has rolled yet' : 'recording is off',
                render: function (r) {
                    return [String(r.frame), String(r.n), r.value.toFixed(6), r.writer, r.site || '—'];
                }
            });
            table.mm.paint(rolls.slice().reverse());
        } else {
            table = W.table({
                // Virtual for the same reason the rolls table is: this one is
                // now repainted while it is being read, and only the virtual
                // path keeps the reader's offset — the plain one empties the
                // body and the browser clamps the scroll to the top with it.
                // isScrolling() is a real answer only on a virtual table too.
                key: 'trace.sites', rowH: 17, virtual: true,
                cols: [
                    { label: 'site', w: '1 1 0' },
                    { label: 'rolls', w: '0 0 60px', cls: 'mm-td-num' },
                    { label: 'share', w: '0 0 54px', cls: 'mm-td-num' },
                    { label: 'last', w: '0 0 48px', cls: 'mm-td-num' },
                    { label: 'sample', w: '0 0 80px', cls: 'mm-td-val' }
                ],
                empty: 'call sites are only recorded while “capture call sites” is on',
                render: function (r) {
                    return [r.site, String(r.count), r.share + '%', String(r.lastAt), r.sample.toFixed(4)];
                }
            });
            table.mm.paint(R.sites());
        }
        function tableRows() {
            return rngMode === 'rolls' ? rolls.slice().reverse() : R.sites();
        }

        var toolbar = h('div', { class: 'mm-toolbar' }, modeChips,
            h('div', { class: 'mm-title-sep' }),
            W.button({
                label: 'copy what is shown', mini: true, _ungated: true,
                onClick: function () {
                    var text = rngMode === 'rolls'
                        ? rolls.map(function (r) { return r.n + '  ' + r.value + '  ' + r.writer; }).join('\n')
                        : R.sites().map(function (r) { return r.count + '  ' + r.share + '%  ' + r.site; }).join('\n');
                    U.toast(U.copyText(text)
                        ? { title: 'COPIED', msg: 'on the clipboard', severity: 'ok' }
                        : { title: 'NO CLIPBOARD', msg: 'this build offers none', severity: 'warn' });
                }
            }));

        var listGroup = W.group(rngMode === 'rolls' ? 'Rolls' : 'Call sites', [
            toolbar, table,
            recording ? null : note('Nothing is being recorded, and Math.random is the ' +
                (installed(HOOK_RNG) ? 'seeded generator.' : 'engine’s own function.'))
        ], { grow: true, tag: rngMode === 'rolls' ? String(rolls.length) : String(R.sites().length) });

        /* These are the fastest-moving figures in the mod and they were
           printed once. "rolls last frame" is a per-frame number by
           definition, so it is on its own signal: the counters are five text
           nodes and cost nothing to rewrite, while the list is a table and
           only moves when a roll is actually kept — with sampling on, that is
           one tick in a hundred rather than every one.

           Held while the Sample box has focus, because that box is inside the
           group the counters are in; the Seed box is not, so seeding stays
           usable while the counters keep up. */
        U.live(R.stamp, function () {
            var c = R.count();
            sessionRow.lastChild.textContent = String(c.session);
            lastFrameRow.lastChild.textContent = String(c.lastFrame);
            sitesRow.lastChild.textContent = String(R.siteCount());
            recordedRow.lastChild.textContent = String(c.recorded);
            drawnRow.lastChild.textContent = String(R.drawn());
            clearBtn.mm.disable(!c.session);
        }, { name: 'rng counters', within: recGroup });

        U.live(R.tableStamp, function () {
            var list = tableRows();
            table.mm.paint(list);
            listGroup.mm.tag(String(list.length));
        }, {
            name: 'rng rolls', within: table,
            when: function () { return !table.mm.isScrolling(); },
            whyNot: 'you are scrolling the list'
        });

        return cols({ narrow: true, items: [recGroup, seedGroup, costs] }, [listGroup]);
    }

    /* =====================================================================
       PART 8 — REGISTRATION AND THE MODULE MARKER
       ===================================================================== */
    U.panel('world', 'Watchpoints', function () { return buildWatchpoints(); }, 54);
    U.debugPanel('Journal', function () { return buildJournal(); }, 70);
    U.debugPanel('Interpreters', function () { return buildInterpreters(); }, 72);
    U.debugPanel('RNG', function () { return buildRng(); }, 74);

    /* Two flags that must never arrive switched on. A seeded generator that
       survived a launch would be a silent, invisible change to every roll in
       the game; a watchpoint that holds the game before the overlay exists is
       indistinguishable from a hang. Registered so a settings-profile load is
       scrubbed the same way, and forced false here for this launch. */
    $.store.unsafeAtBoot('trace.rng.seedOn',
        'a seeded generator that survived a launch would silently change every roll in the game');
    $.store.unsafeAtBoot('trace.watch.pauseOnHit',
        'a watchpoint that holds the game before the overlay is up looks exactly like a hang');
    if ($.cfg.trace && $.cfg.trace.rng) $.cfg.trace.rng.seedOn = false;
    if ($.cfg.trace && $.cfg.trace.watch) $.cfg.trace.watch.pauseOnHit = false;

    loadPoints();
    recomputeDemand();

    /* Not $.api.watch: the boot module already claims that name for the HUD
       watch strip, loads after this file, and would replace this one with no
       error at all. */
    $.api.watchpoint = function (spec) { return Wt.add(spec); };
    $.api.journal = function () { return J.rows(); };
    $.api.interpreters = function () { return Ip.all(); };

    $.trace = {
        describe: function () {
            var av = Wt.available(), at = Wt.attributable();
            return 'watchpoints ' + (av.ok ? 'armable' : 'unavailable') +
                ', writers ' + (at.ok ? 'named' : 'unattributed') +
                ', journal ' + (J.feeds().undo ? 'anchored' : 'unanchored') +
                ', rolls ' + (installed(HOOK_RNG) ? 'hooked' : 'untouched');
        },
        report: function () {
            var names = [HOOK_VAR, HOOK_SWITCH, HOOK_SELF, HOOK_WRITER,
                HOOK_PUSH, HOOK_POP, HOOK_CLEAR, HOOK_VERIFY, HOOK_RNG];
            return {
                hooks: names.map(function (n) {
                    return {
                        name: n,
                        installed: installed(n),
                        registered: !!$.hooks[n],
                        reason: hookWhy(n)
                    };
                }),
                watch: {
                    armed: Wt.armed(), points: points.length, hits: hits.length,
                    totalHits: totalHits, observed: observed, demand: Wt.demand(),
                    watchDemand: watchDemand, ctxDemand: ctxDemand
                },
                journal: { rows: rows.length, reversible: liveRows.length, feeds: J.feeds() },
                interp: Ip.available(),
                rng: {
                    recording: rngRecording(), seeded: rngSeeded(),
                    nativeAtLoad: NATIVE_AT_LOAD, installed: installed(HOOK_RNG)
                }
            };
        }
    };

    $.log(Wt.available().ok ? 'ok' : 'warn',
        'trace ready — ' + $.trace.describe() + '; ' + points.length + ' watchpoint(s) restored');
    if (!Wt.attributable().ok) $.log('warn', 'writer context: ' + Wt.attributable().why);

})(window.GigaHack);
