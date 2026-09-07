//=============================================================================
// GigaHack MV/MZ
// 10 · vars.js — variables, switches, change monitor, freeze, self-switches
//-----------------------------------------------------------------------------
// The change monitor is the single most useful thing in this menu: do the thing
// in-game, open this tab, and the variable responsible is at the top of
// "Recent". It runs whether or not the overlay is open — that is the whole
// point — so it is deliberately cheap: a direct read of the two _data arrays,
// no allocation on the steady path.
//
// Private-field use: the scan reads $gameVariables._data / $gameSwitches._data
// directly rather than calling value() once per id per frame. Two reasons — the
// public getter allocates nothing but costs a call per id, and a project may
// define thousands of them; and read-tracking hooks value(), so polling through
// it would flood the ring buffer with our own reads every frame. Both fields
// are typeof-guarded, and every *write* goes through the public setValue().
//
// THE INVARIANTS THIS MODULE DEFENDS AGAINST, identical on MV and MZ:
//   · Game_Variables.setValue and Game_Switches.setValue IGNORE an id outside
//     1..$dataSystem.<kind>.length-1. The write is dropped with no error, no
//     exception and no return value, so a control that does not check the
//     bound looks as though it worked.
//   · setValue applies Math.floor to a NUMBER, so a fractional value truncates
//     on the way in. Anything that is not a number is stored verbatim: nothing
//     in the engine restricts a variable to a number, and projects routinely
//     keep strings, arrays and objects in them.
//   · value() returns `this._data[id] || 0`, so a stored '', null or false
//     reads back as 0 — a naive write-and-compare would report a phantom
//     failure for a write that was in fact honoured.
//
// Every write the user can trigger goes through $.compat.verify, so a value
// another plugin recomputes or clamps is reported with a name instead of
// looking as though it took.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — variables, switches and the change monitor
 * @author gigahack
 * @help GigaHack_Vars.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat, Index
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — vars not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols, clear = U.clear;

    /* =====================================================================
       SERVICES
       Compat and Index load before this module by manifest, but a partial
       install is exactly the moment a mod menu must not throw. Each shim has
       the surface of the real service and degrades to the honest answer.
       ===================================================================== */
    function verify(control, write, read, want, compare) {
        if ($.compat && $.compat.verify) return $.compat.verify(control, write, read, want, compare);
        $.safe(write, 'write ' + control);
        var got = $.safe(read, 'read ' + control, undefined);
        var ok = compare ? compare(got, want) : got === want;
        return {
            ok: ok, got: got, want: want, culprits: [],
            message: ok ? '' : 'wrote ' + JSON.stringify(want) + ' and read back ' + JSON.stringify(got) +
                '. The compatibility module is not installed, so nothing can be named as the cause.'
        };
    }
    function degraded(control) { return !!($.compat && $.compat.isDegraded && $.compat.isDegraded(control)); }
    function degradedWhy(control) { return ($.compat && $.compat.degradedWhy && $.compat.degradedWhy(control)) || ''; }

    /**
     * A control whose writes do not stick is MARKED, never hidden and never
     * made inert: the cause may have gone away — a cap raised, a plugin's own
     * state changed — and the only way to find out is to let the user try.
     */
    function degradeNote(control) {
        if (!degraded(control)) return null;
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
    function degradeMark(el, control) {
        if (!el || !degraded(control)) return el;
        el.style.opacity = '0.55';
        el.setAttribute('data-mm-tip', 'Not sticking|' + degradedWhy(control));
        return el;
    }

    /* =====================================================================
       PART 1 — MODEL
       ===================================================================== */
    var V = $.vars = {};

    var FLASH_MS = 2000;      // "changed recently" window
    var RECENT_MAX = 400;

    var prevV = [], prevS = [];
    var changedV = Object.create(null);   // id -> {at, from, to}
    var changedS = Object.create(null);
    var recent = [];                       // newest first
    var frozenV = Object.create(null);
    var frozenS = Object.create(null);
    var snapshot = null;                   // {at, v:[], s:[]}
    var marks = { vars: [], switches: [] };
    var primed = false;

    V.FLASH_MS = FLASH_MS;

    function alive() {
        return typeof $gameVariables !== 'undefined' && $gameVariables &&
            typeof $gameSwitches !== 'undefined' && $gameSwitches &&
            typeof $dataSystem !== 'undefined' && $dataSystem && $dataSystem.variables;
    }
    V.alive = alive;

    function rawV() { return ($gameVariables && $gameVariables._data) || null; }
    function rawS() { return ($gameSwitches && $gameSwitches._data) || null; }

    V.varCount = function () { return alive() ? $dataSystem.variables.length - 1 : 0; };
    V.switchCount = function () { return alive() ? $dataSystem.switches.length - 1 : 0; };
    V.varName = function (id) { return (alive() && $dataSystem.variables[id]) || ''; };
    V.switchName = function (id) { return (alive() && $dataSystem.switches[id]) || ''; };
    V.varValue = function (id) { return alive() ? $gameVariables.value(id) : 0; };
    V.switchValue = function (id) { return alive() ? $gameSwitches.value(id) : false; };

    /* ------------------------------------------------------------- monitor */
    function record(kind, id, from, to) {
        var e = { kind: kind, id: id, at: Date.now(), from: from, to: to };
        (kind === 'var' ? changedV : changedS)[id] = e;
        // Collapse repeats: one entry per id, moved to the front.
        for (var i = 0; i < recent.length; i++) {
            if (recent[i].kind === kind && recent[i].id === id) { recent.splice(i, 1); break; }
        }
        recent.unshift(e);
        if (recent.length > RECENT_MAX) recent.pop();
    }

    /** Take the baseline without emitting change events (on load / new game). */
    function prime() {
        if (!alive()) return;
        var dv = rawV(), ds = rawS(), i;
        prevV = []; prevS = [];
        for (i = 1; i < $dataSystem.variables.length; i++) prevV[i] = dv ? dv[i] : undefined;
        for (i = 1; i < $dataSystem.switches.length; i++) prevS[i] = ds ? !!(ds && ds[i]) : false;
        changedV = Object.create(null);
        changedS = Object.create(null);
        recent.length = 0;
        primed = true;
    }
    V.prime = prime;

    function scan() {
        if (!alive()) { primed = false; return; }
        if (!primed) { prime(); return; }
        var dv = rawV(), ds = rawS(), i, a, b;
        if (dv) {
            for (i = prevV.length - 1; i >= 1; i--) {
                a = prevV[i]; b = dv[i];
                // `undefined` and 0 are the same value to the engine (value()
                // returns `this._data[id] || 0`), so do not report that flip.
                if (a === b) continue;
                if ((a === undefined || a === 0) && (b === undefined || b === 0)) { prevV[i] = b; continue; }
                prevV[i] = b;
                record('var', i, a === undefined ? 0 : a, b === undefined ? 0 : b);
            }
        }
        if (ds) {
            for (i = prevS.length - 1; i >= 1; i--) {
                a = !!prevS[i]; b = !!ds[i];
                if (a === b) continue;
                prevS[i] = b;
                record('switch', i, a, b);
            }
        }
    }

    /* -------------------------------------------------------------- freeze */
    var freezeComplained = Object.create(null);

    function enforceFreeze() {
        if (!alive()) return;
        var id;
        for (id in frozenV) {
            if (!sameValue($gameVariables.value(+id), frozenV[id])) {
                // Write through the public setter so $gameMap.requestRefresh()
                // still fires and page conditions re-evaluate.
                $gameVariables.setValue(+id, frozenV[id]);
                prevV[+id] = frozenV[id];   // do not report our own write
                if (!sameValue($gameVariables.value(+id), frozenV[id])) freezeStuck('var', +id, frozenV[id]);
            }
        }
        for (id in frozenS) {
            if ($gameSwitches.value(+id) !== frozenS[id]) {
                $gameSwitches.setValue(+id, frozenS[id]);
                prevS[+id] = frozenS[id];
                if ($gameSwitches.value(+id) !== frozenS[id]) freezeStuck('switch', +id, frozenS[id]);
            }
        }
    }

    /**
     * A freeze that cannot hold is worth exactly one report, not one per frame.
     * Run it through the verifier ONCE so the control is marked and the likely
     * culprit named, then stop asking about that id.
     */
    function freezeStuck(kind, id, want) {
        var key = kind + ':' + id;
        if (freezeComplained[key]) return;
        freezeComplained[key] = true;
        var r = writeThrough(kind, id, want);
        if (!r.ok) {
            $.log('warn', 'the freeze on ' + (kind === 'var' ? 'V' : 'S') + id +
                ' cannot hold — something writes it back every frame. ' +
                (r.verify ? r.verify.message : r.plan.why));
        }
    }

    V.isFrozen = function (kind, id) {
        return kind === 'var' ? Object.prototype.hasOwnProperty.call(frozenV, id)
            : Object.prototype.hasOwnProperty.call(frozenS, id);
    };
    V.freeze = function (kind, id, on) {
        if (!$.allowWrite('Freezing ' + kind + ' #' + id)) return false;
        var map = kind === 'var' ? frozenV : frozenS;
        if (on) map[id] = kind === 'var' ? V.varValue(id) : V.switchValue(id);
        else delete map[id];
        delete freezeComplained[kind + ':' + id];    // a new freeze earns a new report
        var n = V.frozenCount();
        U.setActive('freeze', n > 0);
        $.log('info', (on ? 'froze ' : 'unfroze ') + kind + ' #' + id + (on ? ' at ' + map[id] : '') +
            ' (' + n + ' frozen)');
        return true;
    };
    V.frozenCount = function () { return Object.keys(frozenV).length + Object.keys(frozenS).length; };
    V.frozenList = function () {
        var out = [];
        Object.keys(frozenV).forEach(function (id) { out.push({ kind: 'var', id: +id, value: frozenV[id] }); });
        Object.keys(frozenS).forEach(function (id) { out.push({ kind: 'switch', id: +id, value: frozenS[id] }); });
        return out.sort(function (a, b) { return a.id - b.id; });
    };
    V.clearFreeze = function () {
        frozenV = Object.create(null); frozenS = Object.create(null);
        freezeComplained = Object.create(null);
        U.setActive('freeze', false);
        $.log('info', 'freeze cleared');
    };

    /* --------------------------------------------------------- write plumbing
       Two things stand between a value the user typed and the value the game
       ends up holding, and they fail in different ways:

         1. THE ENGINE. setValue drops a write to an id outside the project's
            range without an error, and floors numbers. Neither is an
            interference problem and neither is worth naming a culprit for, so
            it is decided first, locally, and stated plainly.
         2. EVERYTHING ELSE. Whatever recomputes, clamps or re-writes the value
            afterwards. That is $.compat.verify's job: it reads the value back,
            and on a mismatch it names the plugins known to touch this control
            and marks it degraded for the session.
       ------------------------------------------------------------------ */

    /**
     * Game_Variables.value() returns `this._data[id] || 0`, so a stored '',
     * null or false reads back as 0. Comparing a write against the read
     * without knowing that reports a phantom failure for a write that was
     * honoured exactly as asked.
     */
    function sameValue(got, want) {
        if (got === want) return true;
        if (!want && !got) return true;      // '' / null / false / 0 all read back as 0
        return false;
    }
    V.sameValue = sameValue;

    /**
     * What the ENGINE will do with this write, before any other plugin has a
     * say. `ok:false` means the engine will not perform the write at all;
     * `note` is a change the engine will make silently and the user should be
     * told about.
     */
    V.writePlan = function (kind, id, value) {
        var count = kind === 'var' ? V.varCount() : V.switchCount();
        var plan = { ok: true, value: value, note: '', why: '' };
        if (!(id > 0 && id <= count)) {
            plan.ok = false;
            plan.why = (kind === 'var' ? 'Variable' : 'Switch') + ' #' + id + ' is outside the 1–' + count +
                ' this project defines. The engine ignores writes to id 0 and to anything at or past the ' +
                'end of the list, silently — so this one would look as though it worked.';
            return plan;
        }
        if (kind === 'switch') { plan.value = !!value; return plan; }
        if (typeof value === 'number') {
            if (!isFinite(value)) {
                plan.ok = false;
                plan.why = String(value) + ' is not a finite number, and storing it would make every ' +
                    'later comparison against this variable behave unpredictably.';
                return plan;
            }
            if (Math.floor(value) !== value) {
                plan.value = Math.floor(value);
                plan.note = 'the engine floors numeric variables on the way in, so ' + value +
                    ' is stored as ' + plan.value + '.';
            }
        }
        return plan;
    };

    /**
     * The one place a user-triggered variable or switch write happens.
     * Returns { ok, plan, verify } — `verify` is null when the engine refused
     * the write before any plugin could be blamed for it.
     */
    function writeThrough(kind, id, value) {
        var plan = V.writePlan(kind, id, value);
        if (!plan.ok) {
            $.log('warn', plan.why);
            U.toast({ title: 'NOT WRITTEN', msg: plan.why, severity: 'warn' });
            return { ok: false, plan: plan, verify: null };
        }
        var r = verify(kind === 'var' ? 'vars.set' : 'switches.set',
            function () {
                if (kind === 'var') $gameVariables.setValue(id, plan.value);
                else $gameSwitches.setValue(id, plan.value);
            },
            function () { return kind === 'var' ? $gameVariables.value(id) : $gameSwitches.value(id); },
            plan.value,
            kind === 'var' ? sameValue : null);
        if (plan.note) $.log('info', (kind === 'var' ? 'V' : 'S') + id + ': ' + plan.note);
        return { ok: r.ok, plan: plan, verify: r };
    }
    V.writeThrough = writeThrough;

    /* --------------------------------------------------------------- edits */
    V.setVar = function (id, value, label) {
        if (!alive()) return false;
        if (!$.allowWrite(label || ('Variable #' + id))) return false;
        var before = $gameVariables.value(id);
        var n = typeof value === 'string' && value.trim() !== '' && isFinite(value) ? Number(value) : value;
        if (typeof n === 'string' && n.trim() === '') n = 0;
        var w = writeThrough('var', id, n);
        if (!w.verify) return false;                      // the engine refused it outright
        var after = $gameVariables.value(id);
        if (V.isFrozen('var', id)) frozenV[id] = after;   // editing a frozen var moves the freeze
        if (!sameValue(after, before)) {
            // The revert is a write like any other, so it is verified like any
            // other: an undo that silently does not take is worse than a cheat
            // that silently does not take.
            $.undo.push('variable #' + id + ' ' + before + ' → ' + after, function () {
                writeThrough('var', id, before);
                if (V.isFrozen('var', id)) frozenV[id] = $gameVariables.value(id);
            });
        }
        if (w.ok) {
            $.log('ok', 'V' + id + ' ' + (V.varName(id) || '') + ': ' + before + ' → ' + after +
                (w.plan.note ? ' (' + w.plan.note + ')' : ''));
        } else {
            U.toast({
                title: 'DID NOT STICK',
                msg: 'V' + id + ' reads back ' + after + ', not ' + w.plan.value + '. See the log for why.',
                severity: 'warn'
            });
        }
        return w.ok;
    };

    V.setSwitch = function (id, on, label) {
        if (!alive()) return false;
        if (!$.allowWrite(label || ('Switch #' + id))) return false;
        var before = $gameSwitches.value(id);
        var w = writeThrough('switch', id, !!on);
        if (!w.verify) return false;
        var after = $gameSwitches.value(id);
        if (V.isFrozen('switch', id)) frozenS[id] = after;
        if (after !== before) {
            $.undo.push('switch #' + id + ' ' + before + ' → ' + after, function () {
                writeThrough('switch', id, before);
                if (V.isFrozen('switch', id)) frozenS[id] = $gameSwitches.value(id);
            });
        }
        if (w.ok) {
            $.log('ok', 'S' + id + ' ' + (V.switchName(id) || '') + ': ' + before + ' → ' + after);
        } else {
            U.toast({
                title: 'DID NOT STICK',
                msg: 'S' + id + ' reads back ' + after + ', not ' + !!on + '. See the log for why.',
                severity: 'warn'
            });
        }
        return w.ok;
    };

    /**
     * Self-switches are deliberately NOT routed through a compat control key.
     * A control key is a whole class of write — marking "switches.set"
     * degraded because one event's B refused to move would libel every other
     * switch in the game. This one is read back and reported on its own.
     */
    V.setSelfSwitch = function (mapId, eventId, letter, on) {
        if (typeof $gameSelfSwitches === 'undefined' || !$gameSelfSwitches) return false;
        if (!$.allowWrite('Self-switch ' + mapId + ',' + eventId + ',' + letter)) return false;
        var key = [mapId, eventId, letter];
        var before = $gameSelfSwitches.value(key);
        $.safe(function () { $gameSelfSwitches.setValue(key, !!on); }, 'setSelfSwitch');
        var after = $.safe(function () { return $gameSelfSwitches.value(key); }, 'self-switch read', null);
        if (after !== !!on) {
            var why = 'self-switch ' + key.join(',') + ': wrote ' + !!on + ', read back ' + after +
                '. Something is holding this event\'s self-switch — a plugin that stores them ' +
                'elsewhere, or an event page that rewrites it as soon as the map refreshes.';
            $.log('warn', why);
            U.toast({ title: 'DID NOT STICK', msg: why, severity: 'warn' });
            return false;
        }
        $.undo.push('self-switch ' + key.join(',') + ' ' + before + ' → ' + !!on, function () {
            $gameSelfSwitches.setValue(key, before);
        });
        $.log('ok', 'self-switch ' + key.join(',') + ': ' + before + ' → ' + !!on);
        return true;
    };

    /* ----------------------------------------------------------- snapshots */
    V.takeSnapshot = function () {
        if (!alive()) return null;
        var dv = rawV(), ds = rawS(), v = [], s = [], i;
        for (i = 1; i < $dataSystem.variables.length; i++) v[i] = dv ? (dv[i] || 0) : 0;
        for (i = 1; i < $dataSystem.switches.length; i++) s[i] = ds ? !!ds[i] : false;
        snapshot = { at: Date.now(), v: v, s: s };
        $.log('ok', 'snapshot taken (' + (v.length - 1) + ' variables, ' + (s.length - 1) + ' switches)');
        return snapshot;
    };
    V.hasSnapshot = function () { return !!snapshot; };
    V.snapshotAt = function () { return snapshot ? snapshot.at : 0; };
    V.clearSnapshot = function () { snapshot = null; };
    V.diff = function () {
        if (!snapshot || !alive()) return [];
        var out = [], i;
        for (i = 1; i < snapshot.v.length; i++) {
            var now = $gameVariables.value(i);
            if (now !== snapshot.v[i]) out.push({ kind: 'var', id: i, from: snapshot.v[i], to: now });
        }
        for (i = 1; i < snapshot.s.length; i++) {
            var nowS = $gameSwitches.value(i);
            if (nowS !== snapshot.s[i]) out.push({ kind: 'switch', id: i, from: snapshot.s[i], to: nowS });
        }
        return out;
    };

    /* ----------------------------------------------------------- bookmarks */
    function loadMarks() {
        var m = $.store.read('bookmarks.json', null) || {};
        marks.vars = Array.isArray(m.vars) ? m.vars.slice() : [];
        marks.switches = Array.isArray(m.switches) ? m.switches.slice() : [];
    }
    function saveMarks() {
        var m = $.store.read('bookmarks.json', {}) || {};
        m.vars = marks.vars; m.switches = marks.switches;
        // Written immediately rather than debounced: pinning is a deliberate
        // one-off click, not a 60fps stream, and losing a pin to a crash in the
        // next 250ms would be a bad surprise.
        $.store.write('bookmarks.json', m);
    }
    V.isMarked = function (kind, id) {
        return (kind === 'var' ? marks.vars : marks.switches).indexOf(id) > -1;
    };
    V.mark = function (kind, id, on) {
        var arr = kind === 'var' ? marks.vars : marks.switches;
        var i = arr.indexOf(id);
        if (on === undefined) on = i === -1;
        if (on && i === -1) arr.push(id);
        else if (!on && i > -1) arr.splice(i, 1);
        saveMarks();
        if (U.getHost() && U.getHost().watchPaint) U.getHost().watchPaint();
        return on;
    };
    V.marks = function () { return { vars: marks.vars.slice(), switches: marks.switches.slice() }; };

    /* ------------------------------------------------------------- changes */
    V.changeOf = function (kind, id) { return (kind === 'var' ? changedV : changedS)[id] || null; };
    V.recent = function () { return recent.slice(); };
    V.clearRecent = function () {
        recent.length = 0;
        changedV = Object.create(null); changedS = Object.create(null);
    };


    /* =====================================================================
       PART 1c — VALUE SCAN AND BULK EDIT

       This is the RPG Maker answer to a memory scanner, and it is a better one
       than scanning memory: a project has a fixed, finite set of variables with
       stable ids, so instead of hunting addresses you narrow a candidate set by
       how the values MOVE. Note it down, play until the number on screen
       changes, scan for "increased", repeat. Three rounds is usually enough.

       The candidate set and the snapshot it is compared against live at module
       scope so they survive a repaint — a scanner that forgot its candidates
       every time the panel redrew would be useless.
       ===================================================================== */

    var hunt = {
        kind: 'var',
        candidates: null,     // null = no hunt started yet; [] = scanned to nothing
        snapshot: null,       // id -> value at the last hunt, for the movement tests
        rounds: 0
    };

    V.scanState = function () {
        return {
            kind: hunt.kind, rounds: hunt.rounds,
            started: hunt.candidates !== null,
            count: hunt.candidates ? hunt.candidates.length : 0
        };
    };

    V.scanCandidates = function () { return hunt.candidates ? hunt.candidates.slice() : []; };

    V.scanReset = function () {
        hunt.candidates = null; hunt.snapshot = null; hunt.rounds = 0;
        return true;
    };

    V.scanKind = function (k) {
        if (k && k !== hunt.kind) { hunt.kind = k === 'switch' ? 'switch' : 'var'; V.scanReset(); }
        return hunt.kind;
    };

    function readAll(kind) {
        // varCount() is $dataSystem.variables.length - 1, i.e. the highest
        // VALID id — parseSections and the list panels both walk it
        // inclusively. An exclusive loop here made the last variable in the
        // project permanently invisible to the scanner.
        var n = kind === 'var' ? V.varCount() : V.switchCount();
        var out = Object.create(null);
        for (var id = 1; id <= n; id++) {
            out[id] = kind === 'var' ? V.varValue(id) : V.switchValue(id);
        }
        return out;
    }

    /**
     * Only numbers are comparable.
     *
     * $gameVariables holds whatever an event put in it. Nothing in the engine
     * restricts a variable to a number — projects routinely keep strings,
     * arrays and objects in them — and `'12' > 5` or `[] === 0` would put junk
     * in the candidate list under a numeric test. Anything that is not a real
     * finite number is simply not a candidate for a numeric predicate.
     */
    function num(v) {
        return (typeof v === 'number' && isFinite(v)) ? v : null;
    }

    var FIRST_TESTS = ['equals', 'greater than', 'less than', 'between', 'not zero', 'anything'];
    var NEXT_TESTS = ['equals', 'increased', 'decreased', 'changed', 'unchanged',
        'increased by', 'decreased by', 'greater than', 'less than'];
    V.scanFirstTests = function () { return FIRST_TESTS.slice(); };
    V.scanNextTests = function () { return NEXT_TESTS.slice(); };

    /**
     * One round of scanning.
     *
     * The first round considers every id; later rounds only re-test whatever
     * survived, which is what makes this converge. `a` and `b` are the two
     * operands the chosen test needs — unused ones are ignored rather than
     * validated, so the caller can pass both without knowing which applies.
     */
    V.scanRun = function (test, a, b) {
        if (!alive()) return { count: 0, error: 'no game running' };
        var kind = hunt.kind;
        var live = readAll(kind);
        var first = hunt.candidates === null;
        var pool = first
            ? Object.keys(live).map(Number)
            : hunt.candidates.slice();
        var prev = hunt.snapshot;
        a = Number(a); b = Number(b);

        var kept = pool.filter(function (id) {
            var v = live[id];
            if (kind === 'switch') {
                var was = prev ? !!prev[id] : null;
                switch (test) {
                    case 'on': return !!v;
                    case 'off': return !v;
                    case 'changed': return prev ? (!!v !== was) : true;
                    case 'unchanged': return prev ? (!!v === was) : true;
                    default: return true;
                }
            }
            var n = num(v);
            if (n === null) return false;      // non-numeric: never a numeric candidate
            var p = prev ? num(prev[id]) : null;
            switch (test) {
                case 'equals': return n === a;
                case 'greater than': return n > a;
                case 'less than': return n < a;
                case 'between': return n >= Math.min(a, b) && n <= Math.max(a, b);
                case 'not zero': return n !== 0;
                case 'anything': return true;
                case 'increased': return p !== null && n > p;
                case 'decreased': return p !== null && n < p;
                case 'changed': return p !== null && n !== p;
                case 'unchanged': return p !== null && n === p;
                case 'increased by': return p !== null && (n - p) === a;
                case 'decreased by': return p !== null && (p - n) === a;
                default: return true;
            }
        });

        hunt.candidates = kept;
        hunt.snapshot = live;
        hunt.rounds++;
        $.log('info', 'hunt round ' + hunt.rounds + ' (' + test + '): ' +
            pool.length + ' → ' + kept.length + ' ' + (kind === 'var' ? 'variables' : 'switches'));
        return { count: kept.length, from: pool.length, round: hunt.rounds };
    };

    /**
     * Write many values under ONE undo entry.
     *
     * V.setVar pushes an undo entry per write, and the stack is capped — a
     * bulk set of two hundred variables would evict every earlier action and
     * leave two hundred entries that have to be undone one at a time. This
     * takes a single before-snapshot and reverts the batch in one step, and it
     * logs one line instead of two hundred.
     */
    V.bulkSet = function (kind, ids, value, label) {
        if (!alive()) return 0;
        ids = (ids || []).filter(function (id) { return id > 0; });
        if (!ids.length) return 0;
        if (!$.allowWrite(label || ('bulk set ' + ids.length + ' ' + (kind === 'var' ? 'variables' : 'switches')))) return 0;

        var before = [];
        var n = 0, refused = 0, stuck = 0;
        ids.forEach(function (id) {
            var was = kind === 'var' ? $gameVariables.value(id) : $gameSwitches.value(id);
            before.push([id, was]);
            // Each write is verified individually — the read-back costs one
            // array lookup, and $.compat logs a failing control ONCE per
            // session, so two hundred failures still produce one line.
            var w = writeThrough(kind, id, kind === 'var' ? value : !!value);
            if (!w.verify) { refused++; return; }
            if (kind === 'var') {
                if (V.isFrozen('var', id)) frozenV[id] = $gameVariables.value(id);
            } else {
                if (V.isFrozen('switch', id)) frozenS[id] = $gameSwitches.value(id);
            }
            if (!w.ok) stuck++;
            n++;
        });

        $.undo.push('bulk set ' + n + ' ' + (kind === 'var' ? 'variables' : 'switches') + ' to ' + value, function () {
            before.forEach(function (pair) {
                writeThrough(kind, pair[0], pair[1]);
                if (kind === 'var') {
                    if (V.isFrozen('var', pair[0])) frozenV[pair[0]] = $gameVariables.value(pair[0]);
                } else {
                    if (V.isFrozen('switch', pair[0])) frozenS[pair[0]] = $gameSwitches.value(pair[0]);
                }
            });
        });
        $.log(stuck || refused ? 'warn' : 'ok',
            'bulk set ' + n + ' ' + (kind === 'var' ? 'variables' : 'switches') + ' → ' + value +
            (refused ? ' (' + refused + ' outside the project\'s id range — the engine ignores those)' : '') +
            (stuck ? ' (' + stuck + ' did not stick: ' + degradedWhy(kind === 'var' ? 'vars.set' : 'switches.set') + ')' : ''));
        if (stuck) {
            U.toast({
                title: 'PARTLY APPLIED',
                msg: stuck + ' of ' + n + ' did not stick — see the log.',
                severity: 'warn'
            });
        }
        return n;
    };

    /** Ids in an inclusive range, clamped to what exists. */
    V.range = function (kind, from, to) {
        var max = kind === 'var' ? V.varCount() : V.switchCount();
        var lo = $.clamp(Math.round(from) || 1, 1, max);
        var hi = $.clamp(Math.round(to) || 1, 1, max);
        if (hi < lo) { var t = lo; lo = hi; hi = t; }
        var out = [];
        for (var i = lo; i <= hi; i++) out.push(i);
        return out;
    };

    /* --------------------------------------------------------- section map */
    var sectionCache = null;

    var UNGROUPED = 'Ungrouped';

    /**
     * The "-- Title" section-header convention is widespread but is not an
     * engine feature and not universal, so the decision of what a header looks
     * like lives in exactly ONE place — $.profile — where it is detected from
     * the project's own names rather than assumed. A game that uses no
     * convention gets one "Ungrouped" section holding everything, which is a
     * flat list; the failure mode being avoided is an empty panel.
     */
    function parseSections(names) {
        var out = [], cur = null;
        for (var id = 1; id < names.length; id++) {
            var t = String(names[id] || '').trim();
            if ($.profile && $.profile.isSectionHeader(t)) {
                cur = {
                    title: $.profile.sectionTitle(t) || 'section',
                    headerId: id, items: []
                };
                out.push(cur);
                continue;
            }
            if (!cur) { cur = { title: UNGROUPED, headerId: 0, items: [] }; out.push(cur); }
            cur.items.push(id);
        }
        if (!out.length) out.push({ title: UNGROUPED, headerId: 0, items: [] });
        return out;
    }

    V.sections = function (kind) {
        if (!alive()) return [];
        if (!sectionCache) {
            sectionCache = $.safe(function () {
                return {
                    'var': parseSections($dataSystem.variables),
                    'switch': parseSections($dataSystem.switches)
                };
            }, 'parse sections', { 'var': [{ title: UNGROUPED, headerId: 0, items: [] }],
                                   'switch': [{ title: UNGROUPED, headerId: 0, items: [] }] });
            var grouped = sectionCache['var'].length > 1 || sectionCache['switch'].length > 1;
            $.log('info', grouped
                ? 'indexed ' + sectionCache['var'].length + ' variable sections, ' +
                  sectionCache['switch'].length + ' switch sections'
                : 'this project uses no section-header convention in its variable or switch names — ' +
                  'everything is listed under "' + UNGROUPED + '".');
        }
        return sectionCache[kind] || [];
    };
    $.on('gameobjects', function () { sectionCache = null; primed = false; });

    /* --------------------------------------------------- quick variables
       WHICH variables matter is knowledge about a game, not about the engine,
       so the list comes from that game's profile — as NAMES, resolved against
       the live database here. A patch that shifts ids then degrades to "not
       found" instead of editing the wrong variable.

       With no profile there is no honest way to guess, and guessing from name
       fragments would be an assumption about the language the project is
       written in. The fallback is what the USER has said matters: the rows
       they pinned and the values they froze. That list starts empty and fills
       as they work, which is the honest behaviour.
       ------------------------------------------------------------------ */
    var quickCache = null;

    function quickFromProfile() {
        if (!alive()) return [];
        if (quickCache) return quickCache;
        var names = $.safe(function () {
            return ($.profile && $.profile.get('quickVars', [])) || [];
        }, 'profile quickVars', []) || [];
        var byName = {};
        for (var id = 1; id < $dataSystem.variables.length; id++) {
            var n = $dataSystem.variables[id];
            if (n && !byName[n]) byName[n] = id;
        }
        var out = [], missing = [];
        names.forEach(function (n) {
            if (byName[n]) out.push({ id: byName[n], name: n, from: 'profile' });
            else missing.push(n);
        });
        if (missing.length) {
            $.log('warn', 'quick variables: ' + missing.length + ' of ' + names.length +
                ' names in the profile are not in this project\'s database (' +
                missing.slice(0, 4).join(', ') + (missing.length > 4 ? ', …' : '') +
                ') — the profile was written against a different version of it.');
        }
        quickCache = out;
        return out;
    }

    /** Profile names when there are any, the user's own rows when there are not. */
    V.quickVars = function () {
        if (!alive()) return [];
        var named = quickFromProfile();
        if (named.length) return named.slice();
        // Not cached: pinning and freezing change this between repaints.
        var seen = Object.create(null), out = [];
        marks.vars.forEach(function (id) {
            if (!(id > 0 && id <= V.varCount()) || seen[id]) return;
            seen[id] = true;
            out.push({ id: id, name: V.varName(id) || ('V' + id), from: 'pinned' });
        });
        V.frozenList().forEach(function (f) {
            if (f.kind !== 'var' || seen[f.id]) return;
            seen[f.id] = true;
            out.push({ id: f.id, name: V.varName(f.id) || ('V' + f.id), from: 'frozen' });
        });
        return out;
    };

    /* The panel's title for that group is the profile's to choose. With no
       profile the group is the user's own list and says so. Any title that
       refers to the game itself comes from $.profile.active().name, which
       Profile reads from $dataSystem.gameTitle. */
    V.quickTitle = function () {
        if (!quickFromProfile().length) return 'Pinned and frozen';
        return $.safe(function () {
            return $.profile.get('quickVarsTitle', null) || ($.profile.active() || {}).name || 'Quick access';
        }, 'quick title', 'Quick access');
    };

    V.quickTag = function () {
        var list = V.quickVars();
        if (!list.length) return 'nothing yet';
        return list[0].from === 'profile' ? list.length + ' named' : list.length + ' yours';
    };

    $.on('gameobjects', function () { quickCache = null; });

    /* ---------------------------------------------------- where it is used
       The boot index walks every event page on every map once and records the
       switch and variable ids each one references. That makes "what actually
       touches this?" answerable without loading twenty maps by hand.

       It is a CANDIDATE LIST and never authority: every hit is re-resolved
       against the live database before it is shown, and a map the index names
       that the database no longer has is marked rather than trusted. When the
       index cannot answer, its own reason is shown — that string is written
       for the user already.
       ------------------------------------------------------------------ */
    V.usages = function (kind, id) {
        if (!$.index || !$.index.findEventsTouching) {
            return {
                candidates: [], complete: false,
                why: 'the index module is not installed, so cross-map event usage cannot be looked up.'
            };
        }
        var r = $.safe(function () {
            return $.index.findEventsTouching(kind === 'var' ? 'variable' : 'switch', id);
        }, 'index.findEventsTouching', null);
        if (!r) return { candidates: [], complete: false, why: 'the usage query threw — see the log.' };
        var live = (r.candidates || []).map(function (c) {
            var real = $.safe(function () {
                if (typeof $dataMapInfos === 'undefined' || !$dataMapInfos) return null;
                var info = $dataMapInfos[c.mapId];
                return info ? (info.name || c.mapName) : null;
            }, 'map info', null);
            return {
                mapId: c.mapId, mapName: real || c.mapName, stale: real === null,
                eventId: c.eventId, eventName: c.eventName, x: c.x, y: c.y
            };
        });
        return { candidates: live, complete: !!r.complete, why: r.why || '' };
    };

    /* ------------------------------------------------------- installation */
    $.onFrame('vars: change monitor', function (n) {
        var every = Math.max(1, $.store.cfgGet('vars.scanEvery', 1));
        if (n % every === 0) scan();
        enforceFreeze();
    });

    loadMarks();

    /* =====================================================================
       PART 2 — TAB
       ===================================================================== */
    var ROW_H = 17;

    function ago(ms) {
        var s = (Date.now() - ms) / 1000;
        if (s < 1) return 'now';
        if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + 's';
        if (s < 3600) return Math.floor(s / 60) + 'm';
        return Math.floor(s / 3600) + 'h';
    }

    /** Recency tint. Applied inline rather than via the mockup's mm-flash
     *  animation because virtualised rows are rebuilt as you scroll, which
     *  would restart the animation and keep stale rows bright forever. */
    function tint(tr, change) {
        if (!change) return;
        var age = Date.now() - change.at;
        if (age > FLASH_MS) return;
        var a = 0.42 * (1 - age / FLASH_MS);
        var rgb = U.hexToRgb($.cfg.ui.accent) || [108, 122, 224];
        tr.style.background = 'rgba(' + rgb.join(',') + ',' + a.toFixed(3) + ')';
    }

    function collapsedSet() {
        var list = $.store.cfgGet('vars.collapsed', []);
        var set = Object.create(null);
        (list || []).forEach(function (t) { set[t] = true; });
        return set;
    }
    function setCollapsed(title, on) {
        var list = ($.store.cfgGet('vars.collapsed', []) || []).slice();
        var i = list.indexOf(title);
        if (on && i === -1) list.push(title);
        if (!on && i > -1) list.splice(i, 1);
        $.store.cfgSet('vars.collapsed', list);
    }

    /* ------------------------------------------------------------- search
       The index answers "which ids match this text" without walking every
       name, but it is never authority: each candidate is re-resolved against
       the live $dataSystem entry before it is allowed into the list, and
       anything the index knows that the game no longer has is dropped.

       When the index cannot answer — still building, never built, no index
       module at all — the linear path below still can. The only cost is time,
       so the reason is shown and nothing else changes.
       ------------------------------------------------------------------ */
    function searchIds(kind, q) {
        var out = { ids: null, count: 0, why: '' };
        if (!q) return out;
        if (!$.index || !$.index.findVar || !$.index.findSwitch) {
            out.why = 'the index module is not installed — searching the long way instead.';
            return out;
        }
        var r = $.safe(function () {
            return kind === 'var' ? $.index.findVar(q) : $.index.findSwitch(q);
        }, 'index search', null);
        if (!r) { out.why = 'the index query threw — searching the long way instead.'; return out; }
        if (!r.complete) { out.why = r.why; return out; }   // linear fallback, with the reason shown

        var max = kind === 'var' ? V.varCount() : V.switchCount();
        var ids = Object.create(null), n = 0;
        (r.candidates || []).forEach(function (c) {
            if (!c || !(c.id > 0) || c.id > max) return;    // the index is ahead of this database
            var name = String((kind === 'var' ? V.varName(c.id) : V.switchName(c.id)) || '').toLowerCase();
            if (name.indexOf(q) === -1 && String(c.id).indexOf(q) === -1) return;   // renamed since indexing
            if (!ids[c.id]) { ids[c.id] = true; n++; }
        });
        out.ids = ids; out.count = n;
        return out;
    }

    /* --------------------------------------------------- shared row model */
    var usesFocus = null;      // {kind, id} — the row whose usages the sidebar shows

    function buildRows(kind, filter) {
        var rows = [], collapsed = collapsedSet();
        var searching = !!filter.q;
        // One index query per repaint, not one per row.
        var found = searching ? searchIds(kind, filter.q) : { ids: null, why: '' };
        filter._ids = found.ids;
        filter._why = found.why;
        V.sections(kind).forEach(function (sec) {
            var kept = sec.items.filter(function (id) { return passes(kind, id, filter); });
            if (!kept.length) return;
            var isCollapsed = !searching && collapsed[sec.title];
            rows.push({ t: 'hdr', title: sec.title, count: kept.length, collapsed: isCollapsed });
            if (!isCollapsed) {
                kept.forEach(function (id) { rows.push({ t: 'row', kind: kind, id: id }); });
            }
        });
        return rows;
    }

    function passes(kind, id, f) {
        var name = kind === 'var' ? V.varName(id) : V.switchName(id);
        if (f.named && !name) return false;
        if (f.q) {
            if (f._ids) {
                if (!f._ids[id]) return false;          // the index already resolved the match
            } else {
                var q = f.q;
                if (String(id) !== q && String(id).indexOf(q) === -1 && name.toLowerCase().indexOf(q) === -1) return false;
            }
        }
        if (f.active) {
            if (kind === 'var' ? V.varValue(id) === 0 : !V.switchValue(id)) return false;
        }
        if (f.changed && !V.changeOf(kind, id)) return false;
        if (f.pinned && !V.isMarked(kind, id)) return false;
        return true;
    }

    /* --------------------------------------------------------- the table */
    function makeTable(kind, filter, onRepaint) {
        var valueCol = kind === 'var'
            ? { label: 'value', w: '0 0 92px', cls: 'mm-td-val' }
            : { label: 'on', w: '0 0 92px' };

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 30px' },
                { label: 'id', w: '0 0 46px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                valueCol,
                { label: '', w: '0 0 30px' },
                { label: '', w: '0 0 26px' }
            ],
            empty: 'no matches',
            render: function (r) {
                if (r.t === 'hdr') {
                    return [
                        h('i', { class: 'mm-caret', style: r.collapsed ? 'transform:rotate(-45deg)' : '' }),
                        '', h('span', { text: r.title }), '',
                        h('span', { class: 'mm-sub mm-mono', text: String(r.count) }), ''
                    ];
                }
                var id = r.id;
                var name = (kind === 'var' ? V.varName(id) : V.switchName(id)) || '—';
                var pinned = V.isMarked(kind, id);
                var frozen = V.isFrozen(kind, id);

                var pin = h('button', {
                    class: 'mm-chip' + (pinned ? ' mm-on' : ''),
                    style: 'height:12px;padding:0 3px;min-width:14px;justify-content:center',
                    text: pinned ? '★' : '☆',
                    tip: 'Pin|Show in the watch panel',
                    onclick: function (e) {
                        e.stopPropagation();
                        V.mark(kind, id);
                        onRepaint(true);
                    }
                });

                var snow = h('button', {
                    class: 'mm-chip' + (frozen ? ' mm-on' : ''),
                    style: 'height:12px;padding:0 3px;min-width:14px;justify-content:center',
                    text: '❄',
                    tip: frozen ? 'Frozen|Click to release' : 'Freeze|Hold this value against the game',
                    onclick: function (e) {
                        e.stopPropagation();
                        if (V.freeze(kind, id, !frozen)) onRepaint(true);
                    }
                });

                var valueCell;
                if (kind === 'var') {
                    valueCell = W.editCell(V.varValue(id), function (v) {
                        V.setVar(id, v, 'Variable #' + id);
                        onRepaint(true);
                    });
                } else {
                    valueCell = W.checkbox({
                        value: V.switchValue(id), label: 'Switch #' + id,
                        onChange: function (on) { V.setSwitch(id, on); onRepaint(true); }
                    });
                }
                // Marked, not disabled — a control the user cannot press can
                // never prove that the reason it was marked has gone away.
                degradeMark(valueCell, kind === 'var' ? 'vars.set' : 'switches.set');

                var focused = usesFocus && usesFocus.kind === kind && usesFocus.id === id;
                var uses = h('button', {
                    class: 'mm-chip' + (focused ? ' mm-on' : ''),
                    style: 'height:12px;padding:0 3px;min-width:14px;justify-content:center',
                    text: '⌕',
                    tip: 'Where is it used|Every event on every map that touches it, from the index.',
                    onclick: function (e) {
                        e.stopPropagation();
                        usesFocus = focused ? null : { kind: kind, id: id };
                        U.rerender();
                    }
                });

                return [pin, String(id), h('span', { text: name }), valueCell, snow, uses];
            },
            onRow: function (tr, r) {
                if (r.t === 'hdr') {
                    tr.className = 'mm-tr mm-tree-row mm-dir';
                    tr.style.cursor = 'pointer';
                    tr.style.background = 'var(--mm-bg-2)';
                    tr.addEventListener('click', function () {
                        setCollapsed(r.title, !r.collapsed);
                        onRepaint(true);
                    });
                    return;
                }
                tint(tr, V.changeOf(kind, r.id));
                var nm = (kind === 'var' ? V.varName(r.id) : V.switchName(r.id)) || '(unnamed)';
                tr.setAttribute('data-mm-tip', (kind === 'var' ? 'V' : 'S') + r.id + '|' + nm);
            }
        });
        return table;
    }

    /* ------------------------------------------------------- tab builders */
    function buildList(kind) {
        /**
         * The filter lives in settings, not in this closure.
         *
         * It was a fresh object per build, so it survived neither closing the
         * menu nor switching tabs — you retyped the search every time. Written
         * back on every change rather than on close, because the menu can go
         * away without a close (panic hide, a crash) and a filter you have to
         * re-enter is exactly the thing being fixed.
         */
        var stored = $.store.cfgGet('ui.varFilter.' + kind, null);
        var filter = {
            q: (stored && typeof stored.q === 'string') ? stored.q : '',
            named: !!(stored && stored.named), active: !!(stored && stored.active),
            changed: !!(stored && stored.changed), pinned: !!(stored && stored.pinned)
        };
        function remember() { $.store.cfgSet('ui.varFilter.' + kind, {
            q: filter.q, named: filter.named, active: filter.active,
            changed: filter.changed, pinned: filter.pinned
        }); }
        var control = kind === 'var' ? 'vars.set' : 'switches.set';
        var table = makeTable(kind, filter, repaint);
        var countTag = h('span', { class: 'mm-group-tag', text: '' });
        /* Two live notices above the table: the index's own reason when a
           search could not use it, and the compat module's reason when writes
           are not sticking. Both are repainted rather than built once, so a
           failure that happens while the panel is open is visible without
           closing and reopening it. */
        var whyEl = h('div', {
            class: 'mm-sub',
            style: 'padding:2px 6px;white-space:normal;color:var(--mm-warn);display:none'
        });
        var degradeHost = h('div', {});
        var lastSig = '';

        function repaint(force) {
            var rows = buildRows(kind, filter);
            var vis = rows.filter(function (r) { return r.t === 'row'; }).length;
            countTag.textContent = vis + ' / ' + (kind === 'var' ? V.varCount() : V.switchCount());
            whyEl.textContent = filter._why || '';
            whyEl.style.display = filter._why ? '' : 'none';
            clear(degradeHost);
            var note = degradeNote(control);
            if (note) degradeHost.appendChild(note);
            table.mm.paint(rows);
            if (force) lastSig = '';
        }

        // Live refresh, but never while the user is mid-edit inside the table.
        function editing() {
            var a = document.activeElement;
            return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && table.contains(a);
        }
        function signature() {
            // Cheap "has anything visible changed" probe: newest change stamp
            // plus the number of rows still inside the flash window.
            var top = recent.length ? recent[0].at : 0;
            var live = 0, now = Date.now();
            for (var i = 0; i < recent.length && now - recent[i].at < FLASH_MS; i++) live++;
            return top + ':' + live + ':' + V.frozenCount();
        }

        var host = U.getHost();
        host.fastHooks.push(function (n) {
            if (n % 6) return;
            if (editing()) return;
            // Never rebuild rows out from under an in-progress scroll gesture.
            if (table.mm.isScrolling()) return;
            var sig = signature();
            if (sig === lastSig) return;
            lastSig = sig;
            repaint();
        });

        // Each control opens showing what is actually being filtered, which is
        // the whole point of persisting it — a chip that reads "off" while the
        // list is filtered is worse than not remembering at all.
        var chips = h('div', { class: 'mm-inline' },
            W.chip({
                label: 'named', value: filter.named,
                tip: 'Named only|Hides rows the project never named',
                onChange: function (v) { filter.named = v; remember(); repaint(true); }
            }),
            W.chip({
                label: kind === 'var' ? 'non-zero' : 'enabled', value: filter.active,
                onChange: function (v) { filter.active = v; remember(); repaint(true); }
            }),
            W.chip({
                label: 'changed', value: filter.changed,
                tip: 'Changed|Only rows the monitor saw change this session',
                onChange: function (v) { filter.changed = v; remember(); repaint(true); }
            }),
            W.chip({
                label: 'pinned', value: filter.pinned,
                onChange: function (v) { filter.pinned = v; remember(); repaint(true); }
            }));

        var searchBox = W.search({
            value: filter.q,
            placeholder: 'search ' + (kind === 'var' ? V.varCount() : V.switchCount()) + ' by name or id…',
            onInput: function (v) { filter.q = v.trim(); remember(); repaint(true); }
        });

        var toolbar = h('div', { class: 'mm-toolbar' },
            searchBox,
            chips,
            W.button({
                label: 'clear filters', _ungated: true,
                tip: 'Clear|Filters are remembered between sessions.',
                onClick: function () {
                    filter.q = ''; filter.named = filter.active = filter.changed = filter.pinned = false;
                    remember(); U.rerender();
                }
            }),
            W.button({
                label: 'expand all', _ungated: true,
                onClick: function () { $.store.cfgSet('vars.collapsed', []); repaint(true); }
            }),
            W.button({
                label: 'collapse all', _ungated: true,
                onClick: function () {
                    $.store.cfgSet('vars.collapsed', V.sections(kind).map(function (s) { return s.title; }));
                    repaint(true);
                }
            }));

        repaint(true);

        /* What the engine itself will do with what you type, in the panel that
           types it. All three of these are silent in the engine. */
        var rules = h('div', { class: 'mm-sub', style: 'padding:4px 6px;white-space:normal' },
            kind === 'var'
                ? 'Numbers are floored. Text and lists are stored as typed. Ids outside 1–' +
                  V.varCount() + ' are ignored, silently.'
                : 'Anything truthy reads back as ON. Ids outside 1–' + V.switchCount() +
                  ' are ignored, silently.');

        var main = W.group(kind === 'var' ? 'Variables' : 'Switches',
            [toolbar, degradeHost, whyEl, table, rules], { grow: true });
        main.mm.head.appendChild(countTag);

        return cols({ narrow: true, items: sidebar(kind, repaint) }, [main]);
    }

    /* ------------------------------------------------------- left sidebar */
    function sidebar(kind, repaint) {
        var out = [];

        if (kind === 'var') {
            var quick = V.quickVars();
            out.push(W.group(V.quickTitle(), (quick.length ? quick.map(function (a) {
                // No bounds on the box: a variable has no engine-side ceiling,
                // only the floor applied to numbers, and a UI bound would be an
                // invented limit dressed up as the game's.
                var box = W.number({
                    value: V.varValue(a.id), wide: true,
                    label: a.name,
                    onChange: function (v) { V.setVar(a.id, v, a.name); U.rerender(); }
                });
                degradeMark(box, 'vars.set');
                return W.row(a.name, box, {
                    tip: a.name + '|V' + a.id + ' — ' + (a.from === 'profile'
                        ? 'named by this game\'s profile'
                        : a.from === 'frozen' ? 'you froze it' : 'you pinned it')
                });
            }) : [h('div', {
                class: 'mm-empty',
                text: 'pin a row with ★ or freeze one with ❄'
            })]).concat([degradeNote('vars.set')]), { tag: V.quickTag() }));
        }

        var frozen = V.frozenList();
        out.push(W.group('Frozen', frozen.length ? frozen.map(function (f) {
            return W.row((f.kind === 'var' ? 'V' : 'S') + f.id + ' ' +
                ((f.kind === 'var' ? V.varName(f.id) : V.switchName(f.id)) || ''),
                W.button({
                    label: 'release', mutates: true,
                    onClick: function () { V.freeze(f.kind, f.id, false); repaint(true); }
                }), { sub: String(f.value) });
        }).concat([
            W.button({
                label: 'release all', wide: true, variant: 'danger', mutates: true,
                onClick: function () { V.clearFreeze(); repaint(true); }
            })
        ]) : [h('div', { class: 'mm-empty', text: 'nothing frozen' })], { tag: frozen.length + '' }));

        out.push(W.group('Snapshot', [
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'Taken' }),
                h('div', {
                    class: 'mm-edge mm-mono mm-sub',
                    text: V.hasSnapshot() ? ago(V.snapshotAt()) + ' ago' : 'never'
                })),
            W.button({
                label: 'take snapshot', wide: true, _ungated: true,
                onClick: function () {
                    V.takeSnapshot();
                    U.toast({ title: 'SNAPSHOT', msg: 'Baseline captured', severity: 'ok' });
                    U.rerender();
                }
            }),
            W.button({
                label: 'show diff', wide: true, _ungated: true,
                disabled: !V.hasSnapshot(),
                onClick: function () {
                    // Keyed by TAB id, and Recent is on the world tab. 'vars'
                    // was the 1.x tab name, so this switch had been a silent
                    // no-op since the eleven tabs became six.
                    $.cfg.ui.sub.world = 'Recent';
                    $.store.saveSettings();
                    recentMode = 'diff';
                    U.rerender();
                }
            })
        ], { tag: 'baseline' }));

        out.push(usesGroup());

        return out;
    }

    /* ------------------------------------------------------- where it is used
       Answers "which events actually touch this?" from the cross-map event
       index. Every row is re-resolved against the live map list first, and
       when the index has no answer its own reason is shown rather than an
       empty list that looks like "nothing uses it".
       ------------------------------------------------------------------ */
    function usesGroup() {
        if (!usesFocus) {
            return W.group('Where it is used', [
                h('div', {
                    class: 'mm-empty',
                    text: 'press ⌕ on a row to list the events that touch it'
                })
            ], { tag: 'index', collapsed: true });
        }

        var kind = usesFocus.kind, id = usesFocus.id;
        var label = (kind === 'var' ? 'V' : 'S') + id;
        var name = (kind === 'var' ? V.varName(id) : V.switchName(id)) || '(unnamed)';
        var r = V.usages(kind, id);
        var body = [
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: label }),
                // The project's own name for the variable, and there is no
                // bound on how long a project makes one.
                h('div', { class: 'mm-edge mm-edge--shrink mm-path mm-mono mm-sub', text: name, title: name }))
        ];

        if (!r.candidates.length && !r.complete) {
            body.push(h('div', {
                class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)',
                text: r.why
            }));
        } else if (!r.candidates.length) {
            body.push(h('div', { class: 'mm-empty', text: 'no event on any map references it' }));
        } else {
            var SHOW = 40;
            r.candidates.slice(0, SHOW).forEach(function (u) {
                body.push(W.row(u.mapName, h('span', {
                    class: 'mm-sub mm-mono', text: u.x + ',' + u.y
                }), {
                    sub: u.eventName || ('event ' + u.eventId),
                    tip: u.mapName + '|map ' + u.mapId + ', event ' + u.eventId +
                        ' "' + (u.eventName || '') + '" at ' + u.x + ',' + u.y +
                        (u.stale ? ' — this map is no longer in the database; the index is stale. '
                                 + 'Rebuild it in Debug → Index.' : '')
                }));
            });
            if (r.candidates.length > SHOW) {
                body.push(h('div', {
                    class: 'mm-sub', style: 'padding:2px',
                    text: 'and ' + (r.candidates.length - SHOW) + ' more'
                }));
            }
            if (!r.complete && r.why) {
                body.push(h('div', {
                    class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)',
                    text: r.why
                }));
            }
        }

        body.push(W.button({
            label: 'clear', wide: true, _ungated: true,
            onClick: function () { usesFocus = null; U.rerender(); }
        }));
        return W.group('Where it is used', body, { tag: r.candidates.length + ' event(s)' });
    }

    /* ------------------------------------------------------------- Recent */
    var recentMode = 'recent';   // 'recent' | 'diff'

    function buildRecent() {
        var mode = recentMode;
        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: 'when', w: '0 0 48px', cls: 'mm-td-num' },
                { label: '', w: '0 0 20px', cls: 'mm-td-num' },
                { label: 'id', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'from', w: '0 0 70px', cls: 'mm-td-num' },
                { label: 'to', w: '0 0 70px', cls: 'mm-td-val' },
                { label: '', w: '0 0 54px' }
            ],
            empty: mode === 'diff'
                ? 'nothing differs from the snapshot'
                : 'nothing has changed yet',
            render: function (e) {
                var name = (e.kind === 'var' ? V.varName(e.id) : V.switchName(e.id)) || '—';
                return [
                    mode === 'diff' ? '—' : ago(e.at),
                    e.kind === 'var' ? 'V' : 'S',
                    String(e.id),
                    h('span', { text: name }),
                    String(e.from),
                    String(e.to),
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'pin', mini: true, _ungated: true,
                            onClick: function () { V.mark(e.kind, e.id, true); U.rerender(); }
                        }))
                ];
            },
            onRow: function (tr, e) {
                if (mode !== 'diff') tint(tr, e);
                tr.setAttribute('data-mm-tip',
                    (e.kind === 'var' ? 'V' : 'S') + e.id + '|' +
                    ((e.kind === 'var' ? V.varName(e.id) : V.switchName(e.id)) || '(unnamed)'));
            }
        });

        function rows() { return mode === 'diff' ? V.diff() : V.recent(); }
        function repaint() { table.mm.paint(rows()); }
        repaint();

        var host = U.getHost();
        var lastLen = -1, lastTop = 0;
        host.fastHooks.push(function (n) {
            if (n % 6) return;
            if (table.mm.isScrolling()) return;
            var r = rows();
            var top = r.length ? (r[0].at || r[0].id) : 0;
            if (r.length === lastLen && top === lastTop) {
                // still repaint while anything is inside the flash window
                if (!r.length || Date.now() - (r[0].at || 0) > FLASH_MS) return;
            }
            lastLen = r.length; lastTop = top;
            repaint();
        });

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.button({
                label: 'live changes', _ungated: true,
                variant: mode === 'recent' ? 'prime' : '',
                onClick: function () { recentMode = 'recent'; U.rerender(); }
            }),
            W.button({
                label: 'snapshot diff', _ungated: true,
                variant: mode === 'diff' ? 'prime' : '',
                disabled: !V.hasSnapshot(),
                onClick: function () { recentMode = 'diff'; U.rerender(); }
            }),
            h('div', { class: 'mm-title-sep' }),
            W.button({
                label: 'clear', variant: 'danger', _ungated: true,
                onClick: function () { V.clearRecent(); U.rerender(); }
            }));

        var help = h('div', { class: 'mm-sub', style: 'padding:4px 6px;white-space:normal' },
            mode === 'diff'
                ? ''
                : 'Newest first, one per id. The monitor runs with the menu closed.');

        return cols([
            W.group(mode === 'diff' ? 'Snapshot diff' : 'Recently changed',
                [toolbar, table, help], { grow: true, tag: rows().length + '' })
        ]);
    }

    /* --------------------------------------------------------------- Self */
    function buildSelf() {
        if (typeof $gameSelfSwitches === 'undefined' || !$gameSelfSwitches ||
            typeof $gameMap === 'undefined' || !$gameMap || !$gameMap.mapId()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'no map loaded' }),
                    h('div', { text: 'self-switches are per-map — enter a map first' })));
        }

        var mapId = $gameMap.mapId();
        var LETTERS = ['A', 'B', 'C', 'D'];
        var onlySet = false, q = '';

        function events() {
            var evs = $.safe(function () { return $gameMap.events(); }, 'map events', []) || [];
            return evs.map(function (ev) {
                var d = $.safe(function () { return ev.event(); }, 'event data', null);
                var name = (d && d.name) || '';
                var set = LETTERS.filter(function (L) { return $gameSelfSwitches.value([mapId, ev.eventId(), L]); });
                return { id: ev.eventId(), name: name, x: ev.x, y: ev.y, set: set, page: ev._pageIndex };
            }).filter(function (e) {
                if (onlySet && !e.set.length) return false;
                if (q && String(e.id).indexOf(q) === -1 && e.name.toLowerCase().indexOf(q) === -1) return false;
                return true;
            }).sort(function (a, b) { return a.id - b.id; });
        }

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: 'ev', w: '0 0 40px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'x,y', w: '0 0 60px', cls: 'mm-td-num' },
                { label: 'pg', w: '0 0 28px', cls: 'mm-td-num' },
                { label: 'A B C D', w: '0 0 96px' },
                { label: '', w: '0 0 54px' }
            ],
            empty: 'no events on this map',
            render: function (e) {
                var boxes = h('div', { class: 'mm-inline' }, LETTERS.map(function (L) {
                    return W.checkbox({
                        value: $gameSelfSwitches.value([mapId, e.id, L]),
                        label: 'Self-switch ' + L,
                        onChange: function (on) { V.setSelfSwitch(mapId, e.id, L, on); repaint(); }
                    });
                }));
                return [
                    String(e.id),
                    h('span', { text: e.name || '—' }),
                    e.x + ',' + e.y,
                    e.page === undefined || e.page < 0 ? '—' : String(e.page + 1),
                    boxes,
                    W.button({
                        label: 'reset', variant: 'danger', mini: true, mutates: true,
                        tip: 'Reset|Clears A–D on this event — re-opens a used chest',
                        onClick: function () {
                            LETTERS.forEach(function (L) {
                                if ($gameSelfSwitches.value([mapId, e.id, L])) V.setSelfSwitch(mapId, e.id, L, false);
                            });
                            repaint();
                        }
                    })
                ];
            },
            onRow: function (tr, e) {
                if (e.set.length) tr.style.color = 'var(--mm-text-hi)';
                tr.setAttribute('data-mm-tip', 'Event ' + e.id + '|' +
                    (e.set.length ? 'set: ' + e.set.join(', ') : 'no self-switches set'));
            }
        });
        function repaint() { table.mm.paint(events()); }
        repaint();

        var host = U.getHost();
        host.tickHooks.push(function () { if (!table.mm.isScrolling()) repaint(); });

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({ placeholder: 'filter events…', onInput: function (v) { q = v.trim(); repaint(); } }),
            W.chip({ label: 'set only', value: false, onChange: function (v) { onlySet = v; repaint(); } }));

        return cols([
            W.group('Self-switches · map ' + mapId, [toolbar, table], {
                grow: true, tag: '$gameSelfSwitches'
            }),
            h('div', { class: 'mm-sub', style: 'padding:0 2px;white-space:normal' },
                'Only this map — no other map\'s events exist right now.')
        ]);
    }

    /* -------------------------------------------------------- registration */

    /* ---------------------------------------------------------------- Scan */

    // Panel-local operands. Kept out of settings on purpose: a scan is a
    // session-long activity, and reloading yesterday's search term would be
    // noise rather than a convenience.
    var scanTest = 'equals', scanA = 0, scanB = 0;

    function buildScan() {
        var st = V.scanState();
        var kind = st.kind;
        var isVar = kind === 'var';
        var tests = st.started ? V.scanNextTests() : V.scanFirstTests();
        if (!isVar) tests = st.started ? ['on', 'off', 'changed', 'unchanged'] : ['on', 'off', 'anything'];
        if (tests.indexOf(scanTest) < 0) scanTest = tests[0];

        var needsA = isVar && ['equals', 'greater than', 'less than', 'between',
            'increased by', 'decreased by'].indexOf(scanTest) > -1;
        var needsB = isVar && scanTest === 'between';

        var table = W.table({
            virtual: true, rowH: ROW_H, empty: st.started ? 'nothing survived the scan' : 'run a scan to start',
            cols: [
                { label: 'id', w: '0 0 46px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: isVar ? 'value' : 'on', w: '0 0 82px', cls: 'mm-td-val' },
                { label: '', w: '0 0 30px' }
            ],
            render: function (id) {
                var val = isVar ? V.varValue(id) : V.switchValue(id);
                return [
                    String(id),
                    h('span', { class: 'mm-td-val', text: (isVar ? V.varName(id) : V.switchName(id)) || '—' }),
                    isVar
                        ? W.editCell(val, function (v) { V.setVar(id, v); U.rerender(); })
                        : h('span', { class: V.switchValue(id) ? 'mm-hi' : 'mm-sub', text: V.switchValue(id) ? 'ON' : 'off' }),
                    W.button({
                        label: V.isMarked(kind, id) ? '★' : '☆', mini: true, _ungated: true,
                        tip: 'Pin|Show in the watch panel',
                        onClick: function () { V.mark(kind, id, !V.isMarked(kind, id)); U.rerender(); }
                    })
                ];
            }
        });

        // The list is capped for display only — the candidate set itself stays
        // whole, so a scan that is still at 900 narrows correctly on the next
        // round even though only the first 400 are drawn.
        var SHOW = 400;
        var ids = V.scanCandidates();
        table.mm.paint(ids.slice(0, SHOW));

        var operands = [];
        if (needsA) {
            operands.push(W.row(needsB ? 'From' : 'Value', W.number({
                value: scanA, label: 'scan value', _ungated: true,
                onChange: function (v) { scanA = v; }
            })));
        }
        if (needsB) {
            operands.push(W.row('To', W.number({
                value: scanB, label: 'scan value 2', _ungated: true,
                onChange: function (v) { scanB = v; }
            })));
        }

        var left = [
            W.group('Scan', [
                W.row('Looking at', W.dropdown({
                    options: ['variables', 'switches'], value: isVar ? 'variables' : 'switches',
                    width: '116px', _ungated: true,
                    onChange: function (v) { V.scanKind(v === 'variables' ? 'var' : 'switch'); U.rerender(); }
                }), { tip: 'Looking at|Changing this starts a new search.' }),
                W.row('Test', W.dropdown({
                    options: tests, value: scanTest, width: '96px', _ungated: true,
                    onChange: function (v) { scanTest = v; U.rerender(); }
                }), { sub: st.started ? 'narrowing' : 'first pass' })
            ].concat(operands).concat([
                h('div', { class: 'mm-sep' }),
                W.button({
                    label: st.started ? 'narrow the search' : 'first scan', wide: true, _ungated: true,
                    onClick: function () { V.scanRun(scanTest, scanA, scanB); U.rerender(); }
                }),
                W.button({
                    label: 'start over', wide: true, _ungated: true, disabled: !st.started,
                    onClick: function () { V.scanReset(); U.rerender(); }
                })
            ]), { tag: st.started ? 'round ' + st.rounds : 'ready' }),

            W.group('How this works', [
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal;line-height:1.7' },
                    'Scan for what you know, play until the number moves, then scan for how it moved. ' +
                    'Two or three rounds usually leaves one id.')
            ], { collapsed: true })
        ];

        var tag = st.started ? (st.count + ' left' + (st.count > SHOW ? ' · showing ' + SHOW : '')) : 'not started';
        var right = [W.group('Candidates', [table], { grow: true, tag: tag })];

        return cols({ narrow: true, items: left }, right);
    }

    /* ---------------------------------------------------------------- Bulk */

    var bulkFrom = 1, bulkTo = 20, bulkValue = 0, bulkKind = 'var';

    function buildBulk() {
        var isVar = bulkKind === 'var';
        var ids = V.range(bulkKind, bulkFrom, bulkTo);
        var max = isVar ? V.varCount() : V.switchCount();

        var preview = W.table({
            rowH: ROW_H, empty: 'empty range',
            cols: [
                { label: 'id', w: '0 0 46px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'now', w: '0 0 76px', cls: 'mm-td-val' }
            ],
            render: function (id) {
                return [String(id),
                h('span', { class: 'mm-td-val', text: (isVar ? V.varName(id) : V.switchName(id)) || '—' }),
                h('span', { class: 'mm-sub', text: String(isVar ? V.varValue(id) : V.switchValue(id)) })];
            }
        });
        preview.mm.paint(ids.slice(0, 200));

        var left = [
            W.group('Range', [
                W.row('Kind', W.dropdown({
                    options: ['variables', 'switches'], value: isVar ? 'variables' : 'switches',
                    width: '116px', _ungated: true,
                    onChange: function (v) { bulkKind = v === 'variables' ? 'var' : 'switch'; U.rerender(); }
                })),
                W.row('From', W.number({
                    value: bulkFrom, min: 1, max: max, label: 'range start', _ungated: true,
                    onChange: function (v) { bulkFrom = v; U.rerender(); }
                })),
                W.row('To', W.number({
                    value: bulkTo, min: 1, max: max, label: 'range end', _ungated: true,
                    onChange: function (v) { bulkTo = v; U.rerender(); }
                })),
                h('div', { class: 'mm-sep' }),
                isVar
                    ? W.row('Set to', W.number({
                        value: bulkValue, label: 'bulk value', _ungated: true,
                        onChange: function (v) { bulkValue = v; }
                    }))
                    : W.row('Set to', W.dropdown({
                        options: ['off', 'ON'], value: bulkValue ? 'ON' : 'off', width: '116px', _ungated: true,
                        onChange: function (v) { bulkValue = v === 'ON' ? 1 : 0; }
                    })),
                W.button({
                    label: 'set ' + ids.length + ' ' + (isVar ? 'variables' : 'switches'),
                    wide: true, mutates: true, variant: 'danger',
                    confirm: true,
                    confirmLabel: 'set ' + (isVar ? 'variables' : 'switches') + ' ' +
                        (ids[0] || 0) + '–' + (ids[ids.length - 1] || 0) + ' to ' +
                        (isVar ? bulkValue : (bulkValue ? 'ON' : 'off')) + '?',
                    onClick: function () {
                        V.bulkSet(bulkKind, ids, isVar ? bulkValue : !!bulkValue);
                        U.rerender();
                    }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'One undo entry for the whole batch. Ids outside 1–' + max +
                    ' are skipped — the engine ignores those writes. ' +
                    (isVar ? 'Fractions are floored.' : '')),
                degradeNote(isVar ? 'vars.set' : 'switches.set')
            ], { tag: ids.length + ' in range' })
        ];

        return cols({ narrow: true, items: left },
            [W.group('What will change', [preview], { grow: true, tag: ids.length > 200 ? 'first 200' : 'all' })]);
    }

    function noDb() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'database not loaded yet' }),
                h('div', { text: 'start or load a game, then reopen this tab' })));
    }
    function live(fn) { return function () { return V.alive() ? fn() : noDb(); }; }

    U.panel('world', 'Variables', live(function () { return buildList('var'); }), 10);
    U.panel('world', 'Switches', live(function () { return buildList('switch'); }), 20);
    U.panel('world', 'Scan', live(buildScan), 30);
    U.panel('world', 'Bulk', live(buildBulk), 40);
    U.panel('world', 'Recent', live(buildRecent), 50);
    // Self-switches read $gameSelfSwitches, which exists without a database.
    U.panel('world', 'Self', buildSelf, 60);

    /* Bookmarks feed the watch panel. Registered at priority 10 so pinned
       rows win over M1's game-state readout; returning an empty array makes
       the shell fall through to that fallback, so the panel is never empty.
    */
    U.addWatchProvider(function () {
        var out = [];
        if (!V.alive()) return out;
        marks.vars.forEach(function (id) {
            out.push({ label: 'V' + id + ' ' + (V.varName(id) || ''), value: V.varValue(id) });
        });
        marks.switches.forEach(function (id) {
            out.push({
                label: 'S' + id + ' ' + (V.switchName(id) || ''),
                value: V.switchValue(id) ? 'ON' : 'off'
            });
        });
        return out;   // empty -> the shell falls through to the next provider
    }, 10);

    $.log('ok', 'vars ready — change monitor armed (scan, bulk, index-backed search, ' +
        'every write verified)');

})(window.GigaHack);
