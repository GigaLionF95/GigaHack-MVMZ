//=============================================================================
// GigaHack MV/MZ
// 32 · keys.js — the key map the game itself reads
//-----------------------------------------------------------------------------
// THIS IS THE ONE PANEL THAT CAN LOCK THE PLAYER OUT OF THEIR OWN GAME. Every
// other cheat writes a number into a save; this one writes the table the engine
// consults to decide whether a key means "confirm". Get it wrong and there is
// no in-game way to say so — the menu that would fix it is reached with the
// keys that no longer work. So the whole module is built around one question:
// after this change, is there still a way back?
//
// THE INVARIANTS, and why each is defended the awkward way:
//
//   · THE WAY BACK IS THE ENGINE'S RULE, NOT A LIST OF NAMES. Both engines
//     answer isPressed('cancel') true whenever 'escape' is pressed, through
//     Input._isEscapeCompatible. The stock keyboard table binds 'escape' four
//     times and binds 'cancel' and 'menu' NEVER — so a reachability test that
//     looks for the literal string 'cancel' declares every stock game already
//     broken and then refuses every write the player asks for. reachable() asks
//     the engine's own predicate; when the predicate is missing it falls back,
//     says which two names it assumed, and says it once.
//
//   · THE GUARD COMPARES AGAINST THE MAP THE GAME SHIPPED WITH, NOT AGAINST AN
//     ABSOLUTE LIST. A game whose plugins renamed the actions may have no 'ok'
//     at all; refusing every edit because of that punishes the player for the
//     game's choices. The rule is "do not make unreachable something the
//     shipped map could reach". Where the shipped map already had no way back,
//     the panel says so plainly instead of pretending to protect one.
//
//   · THE MAPS ARE MUTATED IN PLACE. A plugin that took `var km =
//     Input.keyMapper` at load keeps writing through that object forever.
//     Assigning a fresh object makes every later change invisible in both
//     directions, with nothing anywhere reporting a problem. Keys that go are
//     deleted; keys that stay are assigned.
//
//   · Input.clear() RUNS AFTER EVERY APPLIED CHANGE. Hold a key bound to 'up',
//     rebind that key number to 'ok', release it: the key-up handler looks up
//     the NEW action and clears 'ok', while the old one stays latched true for
//     the rest of the session. One clear costs a dropped keypress; not clearing
//     costs a stuck direction nobody can explain.
//
//   · THERE ARE TWO SNAPSHOTS, BECAUSE THE FIRST IS NOT NECESSARILY WHAT
//     SHIPPED. Anything later in the plugin list, and anything writing from the
//     boot scene or from the config load, runs after this file. So the map is
//     read at plugin load AND again at the first frame; when they differ the
//     panel says so and offers both, rather than quietly restoring a layout the
//     player never saw.
//
//   · THE MAP IS NOT A SETTING. Settings profiles carry the whole of $.cfg
//     between games, and a key map that arrived from a different game is a file
//     nobody asked for. Only the three preferences live in $.cfg; the map
//     itself is per-game data, stamped with the game it was written for and
//     refused when that stamp is somebody else's.
//
//   · RESTORE IS REACHABLE ON EVERY PATH. It is gated by read-only mode,
//     because it writes game input — and by nothing else. Not by the way-back
//     guard, not by a degraded write control, not by the precondition that
//     GigaHack's own menu key is bound. It is the way back; a way back with
//     preconditions is not one.
//
//   · THE WATCH NEVER REPAINTS THE PANEL. Something else rewriting the map is
//     noticed from a frame hook, and a rerender from a timer would destroy
//     every open dropdown and half-typed field under the player's cursor. It
//     toasts once per signature, emits, and lets the next build re-read.
//
//   · A KEY NUMBER IS WHAT THE ENGINE READS; KeyboardEvent.code IS WHERE THE
//     KEY IS. They are not a bijection: on a non-US layout the key printed Q
//     sends the code for a different position, and the number follows the
//     layout. So capture records BOTH from one real event, the observed pair
//     wins over the table, and the panel says the printed letter may differ.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — the key map the game itself reads
 * @author gigahack
 * @help GigaHack_Keys.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat. Nothing here reads the engine version: every difference
 * between the two engines in this area is a presence test on Input itself.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — keys not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;
    var K = $.keys = {};

    /* =====================================================================
       SETTINGS

       Three preferences, with their defaults in one table. The settings module
       owns its own DEFAULTS and this file may not edit it, so the default is
       supplied here at read time: a missing key must read as the default and
       never as undefined, or every control opens blank on a settings file
       written before this module existed.

       The MAP is deliberately not among them — see the header.
       ===================================================================== */
    var DEFAULTS = {
        'persist': false,
        'reassert': false,
        'watch': true
    };

    function cfg(key) {
        var d = DEFAULTS[key];
        var v = ($.store && $.store.cfgGet) ? $.store.cfgGet('keys.' + key, d) : d;
        return (v === undefined || v === null) ? d : v;
    }
    function setCfg(key, value) {
        if ($.store && $.store.cfgSet) $.store.cfgSet('keys.' + key, value);
        return value;
    }

    /* The two write-verification control keys. Separate, because a build can
       freeze one mapper and not the other, and one greyed table must not grey
       the other. */
    var CTRL_MAP = 'keys.map';
    var CTRL_PAD = 'keys.pad';

    /* The per-game record. Not a setting; see the header. */
    var RECORD = 'keys.json';

    /* How often the drift watch looks, and how long an armed capture waits. */
    var WATCH_EVERY = 30;          // frames
    var CAPTURE_MS = 6000;
    var PAD_FRAMES = 360;          // six seconds at the engine's logical rate

    /* =====================================================================
       PART 0 — SHARED WORDS

       Every reason the panel can give is written once, here, so the same
       sentence reaches a toast, a disabled control's tip and the console.
       ===================================================================== */
    var WHY_NO_MAPPER =
        'Input.keyMapper is not a readable object on this build, so the key map can be neither shown ' +
        'nor changed. Something has replaced the engine\'s Input object; Debug → Compatibility lists ' +
        'what loaded after GigaHack.';

    var WHY_NO_BASELINE =
        'Input.keyMapper could not be read when GigaHack loaded, so there is no map to put back if a ' +
        'change goes wrong. Nothing here will change it.';

    var WHY_NO_MENU_KEY =
        'GigaHack\'s menu key is unbound. If a rebind went wrong there would be no way to open this ' +
        'panel again. Bind it under Settings → Hotkeys first.';

    var WHY_NO_PAD =
        'Input.gamepadMapper is not present on this build, so pad buttons cannot be remapped. The ' +
        'keyboard map above is unaffected.';

    var WHY_EMPTY_KB =
        'a keyboard map with no keys in it leaves the game unplayable and this panel unreachable. ' +
        'Unbind keys one at a time, or use "restore what the game shipped with".';

    var WHY_EMPTY_PAD =
        'the pad map is now empty, which turns the controller off. The keyboard is unaffected.';

    var WHY_NO_GUARD =
        'there is no shipped map to compare against, so nothing can be said about what this change ' +
        'strands. It was applied as asked.';

    var ESC_FALLBACK_WHY =
        'Input._isEscapeCompatible is not a function on this build, so the set of actions that escape ' +
        'also satisfies had to be assumed to be "cancel" and "menu" — the pair both engines ship. A ' +
        'plugin that added a third one will not be protected by the way-back guard.';

    /* =====================================================================
       PART 1 — READING THE MAPPERS

       Usability, not a type name. `typeof Input.keyMapper === 'object'` is the
       right test HERE (it is a plain table, not a static class), but the thing
       actually needed is "can its keys be enumerated", so that is what is
       asked.
       ===================================================================== */
    function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

    function usable(o) {
        if (!o || typeof o !== 'object') return false;
        return $.safe(function () { Object.keys(o); return true; }, 'mapper readable', false);
    }

    function mapperOk() {
        return typeof Input !== 'undefined' && !!Input && usable(Input.keyMapper);
    }
    function padOk() {
        return typeof Input !== 'undefined' && !!Input && usable(Input.gamepadMapper);
    }

    /** The live object for one map name, or null. Never copied by the caller. */
    function liveMap(which) {
        if (which === 'gamepadMapper') return padOk() ? Input.gamepadMapper : null;
        return mapperOk() ? Input.keyMapper : null;
    }

    function numAsc(a, b) { return parseInt(a, 10) - parseInt(b, 10); }

    /**
     * A plain copy, keys as numeric-sorted strings.
     *
     * A for-in over a mapper yields STRING keys ('65'), while the engine
     * indexes it with the number 65. They are the same property, so writing
     * either way is safe — but a diff comparing '65' === 65 never matches, and
     * a sort comparing them as strings puts 100 before 9. Sorted numerically,
     * compared as strings, everywhere in this file.
     */
    function copyOf(src) {
        var out = {};
        if (!usable(src)) return out;
        $.safe(function () {
            Object.keys(src).sort(numAsc).forEach(function (k) {
                var v = src[k];
                if (v === undefined || v === null || v === '') return;
                out[String(k)] = String(v);
            });
        }, 'copy mapper');
        return out;
    }

    function countKeys(o) { return o ? Object.keys(o).length : 0; }

    /** One string that changes whenever the map does. Used as verify's value. */
    function signature(map) {
        return Object.keys(map || {}).sort(numAsc).map(function (k) {
            return k + ':' + map[k];
        }).join(',');
    }

    K.map = function () { return copyOf(mapperOk() ? Input.keyMapper : null); };
    K.padMap = function () { return copyOf(padOk() ? Input.gamepadMapper : null); };

    /* =====================================================================
       PART 2 — THE TWO SNAPSHOTS

       Taken at plugin load and again at the first frame. The load one is what
       "restore" means; the first-frame one exists because everything after our
       entry in the plugin list, plus the boot scene and the config load, runs
       later and can stamp a layout on top of it.
       ===================================================================== */
    var shippedKb = null;
    var shippedPad = null;
    var shippedAt = 'unavailable';
    var shippedWhy = WHY_NO_MAPPER;

    var firstKb = null;
    var firstPad = null;
    var firstFrameTaken = false;

    (function snapshotAtLoad() {
        if (!mapperOk()) return;
        shippedKb = K.map();
        shippedPad = padOk() ? K.padMap() : null;
        shippedAt = 'load';
        shippedWhy = '';
    }());

    function baselineMapFor(which) {
        return which === 'gamepadMapper' ? shippedPad : shippedKb;
    }

    /** True when something applied a different layout between load and frame 1. */
    function driftedAtBoot() {
        if (!firstFrameTaken || !shippedKb || !firstKb) return false;
        return signature(shippedKb) !== signature(firstKb);
    }

    K.shipped = function () {
        return {
            keyMapper: shippedKb ? $.clone(shippedKb) : null,
            gamepadMapper: shippedPad ? $.clone(shippedPad) : null,
            at: shippedAt,
            why: shippedWhy,
            firstFrame: firstFrameTaken
                ? { keyMapper: firstKb ? $.clone(firstKb) : null,
                    gamepadMapper: firstPad ? $.clone(firstPad) : null }
                : null,
            drifted: driftedAtBoot()
        };
    };

    /* =====================================================================
       PART 3 — LABELS

       Nothing here is content: these are the platform's own key numbers and
       the W3C standard pad layout. Anything outside the ranges is printed as
       its number rather than guessed at, because a wrong label on a key the
       player is trying to find is worse than no label.
       ===================================================================== */
    var NAMED = {
        8: 'BACKSPACE', 9: 'TAB', 13: 'ENTER', 16: 'SHIFT', 17: 'CTRL', 18: 'ALT',
        19: 'PAUSE', 20: 'CAPS', 27: 'ESC', 32: 'SPACE', 33: 'PGUP', 34: 'PGDN',
        35: 'END', 36: 'HOME', 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN',
        45: 'INS', 46: 'DEL', 91: 'META', 92: 'META', 93: 'CONTEXT',
        106: 'NUM *', 107: 'NUM +', 109: 'NUM -', 110: 'NUM .', 111: 'NUM /',
        144: 'NUMLOCK', 145: 'SCRLOCK'
    };

    /* The layout-independent half of the code table. Letters, digits, numpad
       and function keys are derived; punctuation is deliberately absent,
       because its number depends on the keyboard layout and a US-layout table
       would print the wrong symbol with total confidence. */
    var NAMED_CODE = {
        8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'ShiftLeft', 17: 'ControlLeft',
        18: 'AltLeft', 20: 'CapsLock', 27: 'Escape', 32: 'Space', 33: 'PageUp',
        34: 'PageDown', 35: 'End', 36: 'Home', 37: 'ArrowLeft', 38: 'ArrowUp',
        39: 'ArrowRight', 40: 'ArrowDown', 45: 'Insert', 46: 'Delete'
    };

    K.label = function (keyCode) {
        var n = parseInt(keyCode, 10);
        if (n !== n) return 'key ?';
        if (NAMED[n]) return NAMED[n];
        if (n >= 48 && n <= 57) return String(n - 48);
        if (n >= 65 && n <= 90) return String.fromCharCode(n);
        if (n >= 96 && n <= 105) return 'NUM ' + (n - 96);
        if (n >= 112 && n <= 123) return 'F' + (n - 111);
        return 'key ' + n;
    };

    /* Pairs observed from a real keydown this session. One of these is worth
       more than the whole table below it: it came from this player's keyboard
       on this player's layout. */
    var observedCodes = {};

    K.observe = function (keyCode, code) {
        var n = parseInt(keyCode, 10);
        if (n !== n) return null;
        if (!code) { delete observedCodes[String(n)]; return null; }
        observedCodes[String(n)] = String(code);
        return String(code);
    };

    K.observed = function () { return $.clone(observedCodes); };

    K.codeFor = function (keyCode) {
        var n = parseInt(keyCode, 10);
        if (n !== n) return null;
        if (observedCodes[String(n)]) return observedCodes[String(n)];
        if (n >= 65 && n <= 90) return 'Key' + String.fromCharCode(n);
        if (n >= 48 && n <= 57) return 'Digit' + (n - 48);
        if (n >= 96 && n <= 105) return 'Numpad' + (n - 96);
        if (n >= 112 && n <= 123) return 'F' + (n - 111);
        return NAMED_CODE[n] || null;
    };

    /* The W3C "standard" pad layout, which is what both engines' own comments
       name their ten entries by. A pad reporting a different mapping sends
       different indices for the same physical buttons, and the panel says so
       rather than printing a name the player's controller does not have. */
    var PAD_NAMES = {
        0: 'A / cross', 1: 'B / circle', 2: 'X / square', 3: 'Y / triangle',
        4: 'LB / L1', 5: 'RB / R1', 6: 'LT / L2', 7: 'RT / R2',
        8: 'select', 9: 'start', 10: 'L3', 11: 'R3',
        12: 'D-pad up', 13: 'D-pad down', 14: 'D-pad left', 15: 'D-pad right',
        16: 'guide'
    };

    K.padLabel = function (index) {
        var n = parseInt(index, 10);
        if (n !== n) return 'button ?';
        return PAD_NAMES[n] ? (n + '  ' + PAD_NAMES[n]) : ('button ' + n);
    };

    /* =====================================================================
       PART 4 — THE WAY BACK

       One place, and only one, knows the escape-compatibility rule — exactly
       as $.profile.isSectionHeader is the one place the section convention
       lives. Console, the boot report and Debug → Compatibility can all ask
       "can this game still be quit" without a second copy of it.
       ===================================================================== */
    var escFallbackSaid = false;

    K.escapeRuleIsEngine = function () {
        return typeof Input !== 'undefined' && !!Input &&
            typeof Input._isEscapeCompatible === 'function';
    };

    K.isEscapeCompatible = function (name) {
        if (K.escapeRuleIsEngine()) {
            return !!$.safe(function () { return Input._isEscapeCompatible(name); },
                'escape compatibility', false);
        }
        if (!escFallbackSaid) { escFallbackSaid = true; $.log('warn', ESC_FALLBACK_WHY); }
        return name === 'cancel' || name === 'menu';
    };

    /** Every action name any of the four maps actually uses. Never a list. */
    K.actions = function () {
        var seen = {};
        function take(m) {
            if (!m) return;
            Object.keys(m).forEach(function (k) {
                var v = m[k];
                if (typeof v === 'string' && v) seen[v] = true;
            });
        }
        take(K.map()); take(K.padMap());
        take(shippedKb); take(shippedPad);
        take(firstKb); take(firstPad);
        return Object.keys(seen).sort();
    };

    /**
     * Can `action` still be produced by `map`?
     *
     * Directly, or — for the actions the engine says escape also satisfies —
     * through any key bound to 'escape'. This is the whole guard.
     */
    K.reachable = function (action, map) {
        var m = map || K.map();
        var keys = Object.keys(m), i;
        for (i = 0; i < keys.length; i++) if (m[keys[i]] === action) return true;
        if (!K.isEscapeCompatible(action)) return false;
        for (i = 0; i < keys.length; i++) if (m[keys[i]] === 'escape') return true;
        return false;
    };

    /** 'ok', plus every discovered action escape also satisfies. */
    K.wayBack = function () {
        var out = ['ok'];
        K.actions().forEach(function (a) {
            if (a !== 'ok' && K.isEscapeCompatible(a)) out.push(a);
        });
        return out;
    };

    /**
     * Would this map strand something? Pure — no writes, no logging, no state.
     *
     * Compared against the SHIPPED map, not against an absolute list: on a
     * game whose plugins renamed the actions, 'ok' may not exist at all.
     */
    K.check = function (nextMap, which) {
        var w = which === 'gamepadMapper' ? 'gamepadMapper' : 'keyMapper';
        var next = nextMap || {};
        if (countKeys(next) === 0) {
            if (w === 'keyMapper') return { ok: false, stranded: [], message: WHY_EMPTY_KB };
            return { ok: true, stranded: [], message: WHY_EMPTY_PAD };
        }
        var base = baselineMapFor(w);
        if (!base) return { ok: true, stranded: [], message: WHY_NO_GUARD };

        var stranded = [];
        K.wayBack().forEach(function (a) {
            if (K.reachable(a, base) && !K.reachable(a, next)) stranded.push(a);
        });
        if (!stranded.length) return { ok: true, stranded: [], message: '' };

        var names = stranded.map(function (a) { return '"' + a + '"'; }).join(', ');
        return {
            ok: false,
            stranded: stranded,
            message: 'this change would leave ' + names + ' with no key at all, and the map the game ' +
                'shipped with could reach ' + (stranded.length > 1 ? 'them' : 'it') + '. Bind ' +
                (stranded.length > 1 ? 'them' : 'it') + ' to another key first, or use "restore what ' +
                'the game shipped with".'
        };
    };

    /* =====================================================================
       PART 5 — WRITING

       Everything that changes a mapper goes through applyMap: one guard, one
       $.compat.verify, one Input.clear, one undo entry. There is deliberately
       no second path — a "quick" direct assignment is exactly how a stuck key
       and an unverified write get into a build.
       ===================================================================== */
    function verify(control, write, read, want) {
        if ($.compat && $.compat.verify) return $.compat.verify(control, write, read, want);
        $.safe(write, 'write ' + control);
        var got = $.safe(read, 'read ' + control, undefined);
        var ok = got === want;
        return {
            ok: ok, got: got, want: want, culprits: [],
            message: ok ? '' : 'wrote the map and read back something else. The compatibility module ' +
                'is not installed, so nothing can be named as the cause.'
        };
    }
    function degraded(control) {
        return !!($.compat && $.compat.isDegraded && $.compat.isDegraded(control));
    }
    function degradedWhy(control) {
        return ($.compat && $.compat.degradedWhy && $.compat.degradedWhy(control)) || '';
    }
    function controlFor(which) { return which === 'gamepadMapper' ? CTRL_PAD : CTRL_MAP; }

    /** Is GigaHack's own menu key bound? The precondition for every rebind. */
    function menuKeyBound() {
        return !!$.safe(function () {
            return !!(($.cfg && $.cfg.hotkeys) ? $.cfg.hotkeys.toggleMenu : null);
        }, 'menu key', false);
    }
    K.menuKey = function () {
        return $.safe(function () {
            return (($.cfg && $.cfg.hotkeys) ? $.cfg.hotkeys.toggleMenu : null) || null;
        }, 'menu key', null);
    };

    /**
     * Everything that stops a rebind before the guard is even asked. Ordered:
     * the panel prints the first that applies, and set() refuses with it.
     */
    K.writable = function (which) {
        var w = which === 'gamepadMapper' ? 'gamepadMapper' : 'keyMapper';
        if (!mapperOk()) return { ok: false, why: WHY_NO_MAPPER, reason: 'mapper' };
        if (w === 'gamepadMapper' && !padOk()) return { ok: false, why: WHY_NO_PAD, reason: 'pad' };
        if (!baselineMapFor(w)) return { ok: false, why: WHY_NO_BASELINE, reason: 'baseline' };
        if (!menuKeyBound()) return { ok: false, why: WHY_NO_MENU_KEY, reason: 'menukey' };
        if (degraded(controlFor(w))) {
            return { ok: false, why: degradedWhy(controlFor(w)), reason: 'degraded' };
        }
        return { ok: true, why: '', reason: '' };
    };

    /**
     * Replace one map's contents IN PLACE.
     *
     * Deleting into a collected key list rather than while iterating the live
     * object, because the object being mutated is the one a plugin may be
     * holding a reference to and the iteration order of a partially deleted
     * table is not worth reasoning about.
     */
    function writeInto(target, next) {
        var have = Object.keys(target);
        var i;
        for (i = 0; i < have.length; i++) {
            if (!hasOwn(next, have[i])) delete target[have[i]];
        }
        var wanted = Object.keys(next).sort(numAsc);
        for (i = 0; i < wanted.length; i++) target[wanted[i]] = next[wanted[i]];
    }

    function clearInput() {
        $.safe(function () {
            if (typeof Input !== 'undefined' && Input && typeof Input.clear === 'function') Input.clear();
        }, 'Input.clear after a key map change');
    }

    /* What GigaHack last put there, per map. The drift baseline. */
    var setKb = null;
    var setPad = null;

    function baselineOrShipped(which) {
        if (which === 'gamepadMapper') return setPad || shippedPad;
        return setKb || shippedKb;
    }
    function noteApplied(which, map) {
        if (which === 'gamepadMapper') setPad = $.clone(map); else setKb = $.clone(map);
        driftCause = '';
        driftCauseSig = '';
    }

    /**
     * The single write path.
     *
     * `opts.skipGuard` is set only by restore, which by construction cannot
     * strand anything: the map it writes is the one the game boots with.
     * `opts.quiet` suppresses the undo entry and `opts.silent` the log line.
     * Both are for the writes the player did not ask for one at a time — the
     * saved map applied at the first frame, and the re-assert, which can run
     * many times for one rewrite. An undo entry per re-assert would push the
     * player's real history off the stack, and a log line per call is a log
     * nobody reads.
     */
    function applyMap(next, which, label, opts) {
        opts = opts || {};
        var w = which === 'gamepadMapper' ? 'gamepadMapper' : 'keyMapper';
        var target = liveMap(w);
        if (!target) {
            return { ok: false, message: w === 'gamepadMapper' ? WHY_NO_PAD : WHY_NO_MAPPER };
        }

        /* Asking for the map that is already there is not a write.
           Before every gate, because nothing is being blocked: no verify, no
           Input.clear (which would cost a real keypress), no log line, and
           above all no undo entry — a restore pressed twice must not push the
           player's actual change off the stack. */
        var already = copyOf(target);
        if (signature(already) === signature(next)) {
            return { ok: true, message: '', verified: true, stranded: [], changed: false };
        }

        if (!$.allowWrite(label)) return { ok: false, message: 'read-only mode is on.' };

        if (!opts.skipGuard) {
            if (!baselineMapFor(w)) return { ok: false, message: WHY_NO_BASELINE };
            if (!menuKeyBound()) return { ok: false, message: WHY_NO_MENU_KEY };
            var g = K.check(next, w);
            if (!g.ok) return { ok: false, message: g.message, stranded: g.stranded };
        }

        var prev = already;
        var want = signature(next);
        var res = verify(controlFor(w),
            function () { writeInto(target, next); },
            function () { return signature(copyOf(liveMap(w))); },
            want);

        /* Cleared whether or not the write stuck: a partially applied map is
           exactly the state a latched key survives in. */
        clearInput();

        if (!res.ok) {
            return { ok: false, message: res.message, verified: false };
        }

        noteApplied(w, next);

        if (!opts.quiet) {
            $.undo.push(label, function () {
                var back = liveMap(w);
                if (!back) return;
                writeInto(back, prev);
                clearInput();
                noteApplied(w, prev);
                $.emit('keys:change', { which: w, undo: true });
            });
        }

        if (!opts.silent) $.log('ok', label + ' (' + countKeys(next) + ' entries)');
        $.emit('keys:change', { which: w, undo: false });

        if (cfg('persist')) writeRecord();

        return { ok: true, message: '', verified: true, stranded: [], changed: true };
    }

    /** Bind or unbind one keyboard key. A null or empty action unbinds. */
    K.set = function (keyCode, action) {
        var n = parseInt(keyCode, 10);
        if (n !== n || n < 0 || n > 255) {
            return { ok: false, message: 'a key number must be between 0 and 255; "' + keyCode +
                '" is not one. The number is what the engine reads, not the letter on the key.' };
        }
        var next = K.map();
        var unbind = (action === null || action === undefined || action === '');
        if (unbind) delete next[String(n)]; else next[String(n)] = String(action);
        return applyMap(next, 'keyMapper',
            unbind ? ('key map: unbind ' + K.label(n) + ' (' + n + ')')
                : ('key map: ' + K.label(n) + ' (' + n + ') → ' + action));
    };

    /**
     * Bind or unbind one pad button.
     *
     * Validated as a BUTTON INDEX, not as a key number: index 0 is valid and
     * is the commonest binding there is, so a shared numeric validator written
     * for key codes rejects the one entry every pad has.
     */
    K.setPad = function (index, action) {
        var n = parseInt(index, 10);
        if (n !== n || n < 0 || n > 31) {
            return { ok: false, message: 'a pad button index must be between 0 and 31; "' + index +
                '" is not one.' };
        }
        var next = K.padMap();
        var unbind = (action === null || action === undefined || action === '');
        if (unbind) delete next[String(n)]; else next[String(n)] = String(action);
        return applyMap(next, 'gamepadMapper',
            unbind ? ('pad map: unbind ' + K.padLabel(n))
                : ('pad map: ' + K.padLabel(n) + ' → ' + action));
    };

    /** Replace a whole map at once: one guard, one verify, one undo entry. */
    K.apply = function (map, which) {
        var w = which === 'gamepadMapper' ? 'gamepadMapper' : 'keyMapper';
        return applyMap(copyOf(map), w, 'key map: apply ' + countKeys(map) + ' entries');
    };

    var WHY_NOTHING_TO_RESTORE = 'there is no shipped map to put back — Input.keyMapper was ' +
        'unreadable when GigaHack loaded.';

    function restoreOne(map, which, label, opts) {
        if (!map) {
            return { ok: false, changed: false, message: which === 'gamepadMapper'
                ? 'there is no shipped pad map to put back.'
                : WHY_NOTHING_TO_RESTORE };
        }
        opts = opts || {};
        opts.skipGuard = true;
        return applyMap($.clone(map), which, label, opts);
    }

    /**
     * Put both maps back as ONE undoable step.
     *
     * Two undo entries would mean "undo last action" left the keyboard back
     * where it was and the pad still restored — a half-state the player never
     * chose and cannot name. So the two writes are made silently and the pair
     * gets one entry and one line.
     */
    function restoreBoth(kb, pad, label) {
        if (!kb) return { ok: false, changed: false, message: WHY_NOTHING_TO_RESTORE };
        var prevKb = K.map();
        var prevPad = padOk() ? K.padMap() : null;
        var quiet = { quiet: true, silent: true };
        var a = restoreOne(kb, 'keyMapper', label, quiet);
        var b = (pad && padOk()) ? restoreOne(pad, 'gamepadMapper', label, quiet)
            : { ok: true, changed: false, message: '' };
        var changed = a.changed === true || b.changed === true;
        if (!a.ok) return { ok: false, changed: false, message: a.message };
        if (changed) {
            $.undo.push(label, function () {
                var backKb = liveMap('keyMapper');
                if (backKb) { writeInto(backKb, prevKb); noteApplied('keyMapper', prevKb); }
                var backPad = liveMap('gamepadMapper');
                if (backPad && prevPad) { writeInto(backPad, prevPad); noteApplied('gamepadMapper', prevPad); }
                clearInput();
                $.emit('keys:change', { which: 'both', undo: true });
            });
            $.log('ok', label);
        }
        return { ok: b.ok, changed: changed, message: b.ok ? '' : b.message, pad: b.ok };
    }

    /**
     * Put back what the game booted with.
     *
     * Gated by read-only mode and by nothing else — see the header. The guard
     * is skipped by construction, not by exception: this map is the one the
     * game shipped with, so it cannot strand anything the game shipped with.
     */
    var LABEL_SHIPPED = 'key map: restore what the game shipped with';
    var LABEL_FIRST = 'key map: restore the first-frame map';

    K.restoreShipped = function (which) {
        var w = which || 'both';
        if (w === 'keyMapper') return restoreOne(shippedKb, 'keyMapper', LABEL_SHIPPED);
        if (w === 'gamepadMapper') return restoreOne(shippedPad, 'gamepadMapper', LABEL_SHIPPED);
        return restoreBoth(shippedKb, shippedPad, LABEL_SHIPPED);
    };

    /** Put back the map as it stood at the first frame, when that differs. */
    K.restoreFirstFrame = function (which) {
        var w = which || 'both';
        if (!firstFrameTaken) {
            return { ok: false, changed: false, message: 'the first frame has not happened yet, so ' +
                'there is no second snapshot to put back.' };
        }
        if (w === 'keyMapper') return restoreOne(firstKb, 'keyMapper', LABEL_FIRST);
        if (w === 'gamepadMapper') return restoreOne(firstPad, 'gamepadMapper', LABEL_FIRST);
        return restoreBoth(firstKb, firstPad, LABEL_FIRST);
    };

    /* =====================================================================
       PART 6 — DRIFT

       Computed fresh from the live map every time, never cached. A cache here
       would be keyed on something that stops changing — which is the exact
       shape of bug this codebase has already paid for once.
       ===================================================================== */
    var driftCause = '';
    var driftCauseSig = '';
    var announcedSig = '';

    var CAUSE_CONFIG = 'the game applied its own configuration';
    var CAUSE_OPTIONS = 'the game\'s own options screen was closed';
    var CAUSE_UNKNOWN = 'no GigaHack hook saw it happen';

    K.drift = function (which) {
        var w = which === 'gamepadMapper' ? 'gamepadMapper' : 'keyMapper';
        var live = w === 'gamepadMapper' ? K.padMap() : K.map();
        var base = baselineOrShipped(w);
        var since = (w === 'gamepadMapper' ? setPad : setKb) ? 'set' : 'shipped';
        if (!base) {
            return { changed: false, count: 0, diff: [], cause: '', since: since, why: WHY_NO_BASELINE };
        }
        var seen = {}, diff = [];
        Object.keys(base).forEach(function (k) { seen[k] = true; });
        Object.keys(live).forEach(function (k) { seen[k] = true; });
        Object.keys(seen).sort(numAsc).forEach(function (k) {
            if (base[k] === live[k]) return;
            diff.push({
                keyCode: parseInt(k, 10),
                label: w === 'gamepadMapper' ? K.padLabel(k) : K.label(k),
                was: base[k] || '(none)',
                now: live[k] || '(none)'
            });
        });
        var sig = signature(live);
        return {
            changed: diff.length > 0,
            count: diff.length,
            diff: diff,
            cause: (diff.length && driftCauseSig === sig && driftCause) ? driftCause :
                (diff.length ? CAUSE_UNKNOWN : ''),
            since: since,
            why: ''
        };
    };

    /** Take the live map as the new baseline. Changes nothing in the game. */
    K.accept = function (which) {
        var w = which === 'gamepadMapper' ? 'gamepadMapper' : 'keyMapper';
        if (w === 'gamepadMapper') setPad = K.padMap(); else setKb = K.map();
        driftCause = '';
        driftCauseSig = '';
        announcedSig = signature(w === 'gamepadMapper' ? K.padMap() : K.map());
        $.emit('keys:accept', { which: w });
        return true;
    };

    /* =====================================================================
       PART 7 — THE HOOKS

       Two, and both exist for the same reason: a rewrite that can be
       ATTRIBUTED is worth far more than one that is merely noticed. The frame
       watch below can always tell the player that the map changed; only these
       can say what changed it, and only these can put it back in the same
       breath.

       Both run AFTER the original, because the point is to read the map the
       original left behind.
       ===================================================================== */
    var HOOK_CONFIG = 'ConfigManager.applyData (key map)';
    var HOOK_OPTIONS = 'Scene_Options.terminate (key map)';

    var REASONS = {};
    REASONS[HOOK_CONFIG] =
        'ConfigManager.applyData is not a function on this build, so a key map the game re-applies ' +
        'from its own configuration cannot be attributed to it or put back the moment it happens. ' +
        'The drift watch still notices the change and Settings → Game Keys still says which keys differ.';
    REASONS[HOOK_OPTIONS] =
        'Scene_Options.prototype.terminate is not a function on this build — a menu-replacement plugin ' +
        'may have removed or replaced the scene — so a rebind made in the game\'s own options screen ' +
        'is noticed by the drift watch rather than attributed to it.';

    function hookInstalled(name) { return !!($.hooks[name] && $.hooks[name].installed); }
    function hookWhy(name) { return ($.hooks[name] && $.hooks[name].reason) || REASONS[name] || ''; }

    /* The re-assert runs on EVERY rewrite; only the log line is deduplicated,
       by signature. One config load can call applyData repeatedly, and
       skipping the second re-apply because the first one had the same
       signature would leave the game's layout in place from the second call
       onward — with a log saying it had been put back. */
    var reassertedSig = '';
    var reassertCount = 0;

    K.reasserts = function () { return reassertCount; };

    /**
     * Something outside GigaHack has just had a turn with the map. Compare,
     * attribute, and — when asked — put ours back through the same guard every
     * other write uses.
     */
    function afterForeignWrite(cause) {
        $.safe(function () {
            if (!mapperOk()) return;
            var live = K.map();
            var base = baselineOrShipped('keyMapper');
            if (!base) return;
            var sig = signature(live);
            if (sig === signature(base)) return;

            driftCause = cause;
            driftCauseSig = sig;
            $.emit('keys:drift', { cause: cause, count: K.drift().count });

            if (!cfg('reassert')) return;
            var mine = setKb;
            if (!mine) return;
            reassertCount++;
            var r = applyMap($.clone(mine), 'keyMapper', 'key map: re-applied after ' + cause,
                { quiet: true, silent: true });
            if (reassertedSig !== sig) {
                reassertedSig = sig;
                $.log(r.ok ? 'ok' : 'warn', r.ok
                    ? ('the key map was re-applied after ' + cause + '.')
                    : ('the key map could not be re-applied after ' + cause + ' — ' + r.message));
            }
        }, 'key map drift after ' + cause);
    }

    $.install(HOOK_CONFIG,
        typeof ConfigManager !== 'undefined' ? ConfigManager : null, 'applyData',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                afterForeignWrite(CAUSE_CONFIG);
                return r;
            };
        },
        REASONS[HOOK_CONFIG]);

    $.install(HOOK_OPTIONS,
        typeof Scene_Options !== 'undefined' ? Scene_Options.prototype : null, 'terminate',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                afterForeignWrite(CAUSE_OPTIONS);
                return r;
            };
        },
        REASONS[HOOK_OPTIONS]);

    /* Reported live rather than assumed from "installed once": a plugin that
       loads after us can alias either of these on top of ours, and then the
       registry still says installed while our wrapper is no longer outermost. */
    function overpatched(name) {
        return $.safe(function () {
            if (!$.compat || !$.compat.aliasIntegrity) return false;
            var bad = $.compat.aliasIntegrity();
            for (var i = 0; i < bad.length; i++) {
                if (bad[i].name === name && bad[i].state === 'overpatched') return true;
            }
            return false;
        }, 'alias integrity ' + name, false);
    }
    K.hookState = function () {
        return {
            config: { installed: hookInstalled(HOOK_CONFIG), why: hookWhy(HOOK_CONFIG),
                overpatched: overpatched(HOOK_CONFIG), name: HOOK_CONFIG },
            options: { installed: hookInstalled(HOOK_OPTIONS), why: hookWhy(HOOK_OPTIONS),
                overpatched: overpatched(HOOK_OPTIONS), name: HOOK_OPTIONS }
        };
    };

    /* =====================================================================
       PART 8 — THE PER-GAME RECORD

       $.store is per-game only on the filesystem backend: the localStorage
       backend keys on the file name alone and the memory backend is a bare
       map. So the record carries its own stamp and is refused when the stamp
       is another game's, whichever backend it came from.
       ===================================================================== */
    function stampNow() {
        var p = $.profile && $.profile.active ? $.profile.active() : null;
        return {
            gameKey: ($.paths && $.paths.gameKey) || 'unknown',
            profile: (p && p.id) || 'generic',
            game: (p && p.name) || 'this game'
        };
    }

    K.stored = function () {
        var rec = $.store.read(RECORD, null);
        if (!rec || typeof rec !== 'object' || !rec.keyMapper) return null;
        return rec;
    };

    /** The record and whether it belongs here — the panel says which game. */
    K.storedState = function () {
        var rec = K.stored();
        if (!rec) return { rec: null, mine: false, forGame: '' };
        var s = stampNow();
        var mine = rec.gameKey === s.gameKey && rec.profile === s.profile;
        return { rec: rec, mine: mine, forGame: rec.game || 'another game' };
    };

    function writeRecord() {
        if (!mapperOk()) return false;
        var s = stampNow();
        var rec = {
            version: 1,
            gameKey: s.gameKey,
            profile: s.profile,
            game: s.game,
            at: Date.now(),
            keyMapper: K.map(),
            gamepadMapper: padOk() ? K.padMap() : null
        };
        $.store.write(RECORD, rec, true);
        return true;
    }

    K.persist = function (on) {
        setCfg('persist', !!on);
        if (on) {
            writeRecord();
            $.log('ok', 'the key map will be kept for this game.');
        } else {
            $.store.remove(RECORD);
            $.log('info', 'the saved key map was removed; changes now last for this session only.');
        }
        return !!on;
    };

    /**
     * Apply the saved map, if there is one and if it belongs to this game.
     *
     * Refused rather than silently ignored when the stamp is somebody else's:
     * a settings backend shared across games is exactly how a map from a
     * different project arrives, and applying it would be indistinguishable
     * from the game rebinding itself.
     */
    K.applyStored = function () {
        var st = K.storedState();
        var rec = st.rec;
        if (!rec) return { ok: false, applied: false, why: 'nothing is saved for this game.' };
        if (!st.mine) {
            return {
                ok: false, applied: false, forGame: st.forGame,
                why: 'the saved key map was written for "' + st.forGame + '", not for "' +
                    stampNow().game + '", so it was not applied. Settings are shared between ' +
                    'games on this storage backend; the map is not.'
            };
        }
        var r = applyMap(copyOf(rec.keyMapper), 'keyMapper', 'key map: the map saved for this game',
            { skipGuard: true, quiet: true });
        if (r.ok && rec.gamepadMapper && padOk()) {
            applyMap(copyOf(rec.gamepadMapper), 'gamepadMapper', 'pad map: the map saved for this game',
                { skipGuard: true, quiet: true });
        }
        return { ok: r.ok, applied: r.ok, why: r.ok ? '' : r.message };
    };

    /* =====================================================================
       PART 9 — THE WATCH

       One frame hook. It takes the first-frame snapshot, applies a saved map
       AFTER taking it (so our own write is never mistaken for the game's), and
       then looks for drift at a fixed interval.

       It does not rerender. See the header.
       ===================================================================== */
    var pollCount = 0;
    var lastPollFrame = -WATCH_EVERY;

    K.watchPolls = function () { return pollCount; };

    $.onFrame('key map watch', function (frame) {
        if (!firstFrameTaken) {
            firstFrameTaken = true;
            firstKb = mapperOk() ? K.map() : null;
            firstPad = padOk() ? K.padMap() : null;
            if (driftedAtBoot()) {
                $.log('warn', 'the key map changed between GigaHack loading and the first frame — ' +
                    'something applied its own layout after us. Settings → Game Keys offers both.');
            }
            if (cfg('persist')) {
                var st = K.applyStored();
                if (!st.applied && st.why && K.stored()) $.log('warn', st.why);
            }
            announcedSig = mapperOk() ? signature(K.map()) : '';
            return;
        }
        if (!cfg('watch')) return;
        if (frame - lastPollFrame < WATCH_EVERY) return;
        lastPollFrame = frame;
        pollCount++;

        if (!mapperOk()) return;
        var sig = signature(K.map());
        if (sig === announcedSig) return;
        announcedSig = sig;
        var d = K.drift();
        if (!d.changed) return;
        $.emit('keys:drift', { cause: d.cause, count: d.count });
        if (U.toast) {
            U.toast({
                title: 'KEY MAP CHANGED',
                msg: d.count + ' key(s) differ from what GigaHack set — ' + d.cause +
                    '. Settings → Game Keys says which.',
                severity: 'warn'
            });
        }
    });

    /* =====================================================================
       PART 10 — CAPTURE

       The overlay's own key handler is bound on window in the capture phase
       and runs before this one, and it ACTS on the keys it owns: Escape closes
       this panel, the menu key hides the overlay. Recording one of those would
       hand the player a binding they can only reach by giving up the way back
       to it, so those keys are refused here by name and the number field is
       offered instead. It is the only route to key 27 and it always works.
       ===================================================================== */
    function boundHotkey(code) {
        if (!code) return '';
        var hk = ($.cfg && $.cfg.hotkeys) || {};
        var names = Object.keys(hk);
        for (var i = 0; i < names.length; i++) if (hk[names[i]] === code) return names[i];
        return '';
    }

    /** Why capture will not take this key. Empty when it will. */
    K.reserved = function (code) {
        if (!code) return '';
        if (code === 'Escape') return 'Escape closes this panel before anything here can see it.';
        var id = boundHotkey(code);
        if (id) {
            return 'GigaHack acts on this key first — it is bound to "' + id + '" under ' +
                'Settings → Hotkeys.';
        }
        return '';
    };

    /**
     * What the GAME loses on this key, which is not the same question.
     *
     * A registered bind is stopped whether the overlay is open or shut, so the
     * game never sees it. Escape is stopped only while the overlay is open —
     * closed, the game gets it as usual. Saying "the game never gets it" for
     * both would be wrong about the one key every player presses.
     */
    K.claim = function (code) {
        if (!code) return '';
        if (code === 'Escape') {
            return 'Closes the overlay; the game gets it only when the menu is shut.';
        }
        var id = boundHotkey(code);
        if (id) {
            return 'Bound to "' + id + '" here, so the game never gets it, open or shut.';
        }
        return '';
    };

    K.reservedCodes = function () {
        var out = ['Escape'];
        var hk = ($.cfg && $.cfg.hotkeys) || {};
        Object.keys(hk).forEach(function (id) {
            if (hk[id] && out.indexOf(hk[id]) < 0) out.push(hk[id]);
        });
        return out.sort();
    };

    var disarmCapture = null;

    /**
     * Arm a one-shot capture. Returns the disarm function.
     *
     * preventDefault is called unconditionally, on both engines: one of them
     * does not preventDefault Tab itself, so without this a Tab during capture
     * moves focus out of the overlay before anything has been recorded.
     * An OS auto-repeat is ignored — every binding here is a discrete choice
     * and a held key would otherwise be consumed as the intended one.
     */
    K.arm = function (onGot, onEnd) {
        if (disarmCapture) disarmCapture();
        var timer = null;
        function off() {
            window.removeEventListener('keydown', onKey, true);
            if (timer) clearTimeout(timer);
            timer = null;
            disarmCapture = null;
        }
        function onKey(e) {
            if (e.repeat) return;
            e.preventDefault();
            e.stopPropagation();
            var why = K.reserved(e.code);
            if (why) {
                if (U.toast) U.toast({ title: 'NOT CAPTURED', msg: why, severity: 'warn' });
                return;
            }
            off();
            K.observe(e.keyCode, e.code);
            $.safe(function () { onGot(e.keyCode, e.code || null); }, 'key capture');
        }
        window.addEventListener('keydown', onKey, true);
        timer = setTimeout(function () {
            off();
            if (onEnd) $.safe(onEnd, 'key capture timeout');
        }, CAPTURE_MS);
        disarmCapture = off;
        return off;
    };

    K.isArmed = function () { return !!disarmCapture; };

    /* The pad API is poll-only — there is no button-down event — so reading a
       button means running a frame hook and disarming it on a timeout, or it
       polls for the rest of the session. */
    function connectedPads() {
        return $.safe(function () {
            if (!navigator.getGamepads) return [];
            var list = navigator.getGamepads() || [];
            var out = [];
            for (var i = 0; i < list.length; i++) {
                if (list[i] && list[i].connected) out.push(list[i]);
            }
            return out;
        }, 'gamepads', []);
    }

    K.padPresent = function () {
        if (typeof navigator === 'undefined' || !navigator.getGamepads) {
            return { ok: false, why: 'this build has no gamepad API, so a button cannot be read — ' +
                'enter its index instead.' };
        }
        if (!connectedPads().length) {
            return { ok: false, why: 'no gamepad is connected, so a button cannot be read — enter its ' +
                'index instead.' };
        }
        return { ok: true, why: '' };
    };

    var disarmPad = null;

    K.armPad = function (onGot, onEnd) {
        if (disarmPad) disarmPad();
        var frames = 0;
        var fn = $.onFrame('pad button read', function () {
            frames++;
            var pads = connectedPads();
            for (var p = 0; p < pads.length; p++) {
                var b = pads[p].buttons || [];
                for (var i = 0; i < b.length; i++) {
                    if (b[i] && b[i].pressed) { stop(); $.safe(function () { onGot(i); }, 'pad read'); return; }
                }
            }
            if (frames >= PAD_FRAMES) { stop(); if (onEnd) $.safe(onEnd, 'pad read timeout'); }
        });
        function stop() { $.offFrame(fn); disarmPad = null; }
        disarmPad = stop;
        return stop;
    };

    /* =====================================================================
       PART 11 — THE PANEL

       Registered unconditionally. A Settings sub-tab that vanishes on a build
       it cannot edit reads as a broken install, and on exactly that build the
       one useful thing this panel has is the sentence explaining why. The BODY
       degrades; the tab does not.
       ===================================================================== */
    var NONE = '(none)';
    var OTHER = '(other…)';

    /* Panel state, outside the build: every control here rebuilds the panel. */
    var otherKb = null;      // keyCode whose action cell is a free-text field
    var otherPad = null;     // pad index, likewise
    var addCode = 0;
    var addAction = NONE;
    var padAddIndex = 0;
    var padAddAction = NONE;
    var capturing = false;
    var padCapturing = false;

    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: label }),
            /* Unbounded on the right: a whole sentence, or the list of every
               key that reaches one action — a game may map ten to one.
               .mm-edge is flex:0 0 auto, so without --shrink and --wrap it
               pushes the label out of the row and is then clipped by the
               column, and neither half can be read. NOT .mm-breakall: that
               forces a break mid-word even where a space was available, which
               turns "this session only" into "this ses sion only". The root's
               inherited word-wrap:break-word already handles the one case
               breakall exists for — a single token longer than the box. */
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub',
                text: String(value)
            }));
    }

    function note(text, colour) {
        return h('div', {
            class: 'mm-sub',
            style: 'white-space:normal;padding:2px' + (colour ? ';color:' + colour : ''),
            text: text
        });
    }
    function warn(text) { return note(text, 'var(--mm-warn)'); }
    function danger(text) { return note(text, 'var(--mm-danger)'); }

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

    function toastResult(r, okTitle, okMsg) {
        U.toast(r.ok
            ? { title: okTitle, msg: okMsg, severity: 'ok' }
            : { title: 'NOT CHANGED', msg: r.message, severity: 'warn' });
    }

    function whenText(ms) {
        return $.safe(function () {
            var d = new Date(ms);
            return d.toISOString().slice(0, 16).replace('T', ' ');
        }, 'record time', 'at an unknown time');
    }

    function savedToRow() {
        var mode = ($.paths && $.paths.mode) || 'memory';
        if (mode === 'fs') {
            return W.pathRow('Saved to', $.store.path(RECORD),
                { why: 'no data directory resolved on this install' });
        }
        if (mode === 'localStorage') {
            return kv('Saved to', 'browser storage on this machine',
                'Storage|No writable directory was found.');
        }
        return kv('Saved to', 'memory only — lost when the game closes');
    }

    function keysReaching(action, map) {
        var out = [];
        Object.keys(map).sort(numAsc).forEach(function (k) {
            if (map[k] === action) out.push(K.label(k) + ' (' + k + ')');
        });
        return out;
    }

    /* -------------------------------------------------------- the body */
    function buildKeys() {
        if (!mapperOk()) {
            return U.todo('Settings', 'Game Keys', [
                'the key map cannot be read on this build.',
                WHY_NO_MAPPER
            ]);
        }

        var live = K.map();
        var pad = K.padMap();
        var d = K.drift();
        var write = K.writable('keyMapper');
        var writePad = K.writable('gamepadMapper');
        var actions = K.actions();
        var ship = K.shipped();
        var saved = K.storedState();
        var rec = saved.rec;
        var hooks = K.hookState();

        var distinct = {};
        Object.keys(live).forEach(function (k) { distinct[live[k]] = true; });

        /* ------------------------------------------------ G1 this map */
        var g1 = W.group('This map', [
            kv('Keys bound', countKeys(live) + ' keys → ' + Object.keys(distinct).length + ' actions'),
            h('div', { class: 'mm-row', 'data-mm-tip': 'Drift|Re-read every time this panel is built.' },
                h('div', { class: 'mm-lab' }, 'Since GigaHack set it'),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub',
                    style: d.changed ? 'color:var(--mm-warn)' : null,
                    text: d.changed ? ('CHANGED — ' + d.count + ' key(s) differ') : 'matches'
                })),
            kv('Shipped snapshot', ship.at === 'unavailable' ? 'unavailable'
                : (ship.drifted ? 'taken at plugin load; changed again before the first frame'
                    : 'taken at plugin load')),
            kv('Saved for this game', !rec ? 'no — this session only'
                : saved.mine ? ('yes, written ' + whenText(rec.at))
                    : ('a saved map exists but it was written for "' + saved.forGame + '"')),
            (rec && !saved.mine) ? warn('the saved map was written for "' + saved.forGame +
                '", not for this game, so it is not applied. Settings are shared between games on ' +
                'this storage backend; the map is not.') : null,
            savedToRow()
        ], { tag: countKeys(live) + ' keys' });

        /* -------------------------------------------------- G2 restore */
        var g2 = W.group('Restore', [
            W.button({
                label: 'restore what the game shipped with', variant: 'prime', wide: true, mutates: true,
                disabled: !shippedKb,
                tip: shippedKb ? null
                    : 'Unavailable|There is no shipped map to put back.',
                onClick: function () {
                    var r = K.restoreShipped('both');
                    toastResult(r, 'RESTORED', 'the map the game booted with is back');
                    U.rerender();
                }
            }),
            shippedKb ? null : warn(WHY_NOTHING_TO_RESTORE),
            ship.drifted ? W.button({
                label: 'restore the map as it was at the first frame', wide: true, mutates: true,
                tip: 'First frame|' + firstFrameDiffCount() + ' key(s) differ from the load snapshot.',
                onClick: function () {
                    var r = K.restoreFirstFrame('both');
                    toastResult(r, 'RESTORED', 'the first-frame map is back');
                    U.rerender();
                }
            }) : null,
            ship.drifted ? note('something applied its own layout after GigaHack loaded and before the ' +
                'first frame. Both maps are offered because only one of them is the one you saw.') : null,
            W.button({
                label: 'forget the saved map', variant: 'danger', wide: true, mutates: true,
                disabled: !rec,
                tip: rec ? 'Forget|Removes the saved map and stops keeping it.'
                    : 'Unavailable|Nothing is saved for this game.',
                onClick: function () {
                    K.persist(false);
                    U.toast({ title: 'FORGOTTEN', msg: 'the saved map is gone', severity: 'ok' });
                    U.rerender();
                }
            }),
            note('Every change here is one entry on the undo stack; Settings → Behaviour has ' +
                '"undo last action".')
        ]);

        /* ------------------------------------------------- G3 keeping */
        var memoryOnly = (($.paths && $.paths.mode) || 'memory') === 'memory';
        var reassertOff = !hooks.config.installed && !hooks.options.installed;
        var g3 = W.group('Keeping it', [
            W.toggleRow('Keep this map for this game', {
                value: !!cfg('persist'), disabled: memoryOnly,
                onChange: function (v) { K.persist(v); U.rerender(); }
            }),
            memoryOnly ? warn('no writable directory was found on this machine (' +
                ((($.paths && $.paths.notes) || []).join('; ') || 'no reason recorded') +
                '), so nothing can be kept past this launch.') : null,
            W.toggleRow('Re-apply it after the game rewrites it', {
                value: !!cfg('reassert'), disabled: reassertOff,
                tip: 'Re-apply|Only where a hook can see the rewrite happen.',
                onChange: function (v) { setCfg('reassert', !!v); U.rerender(); }
            }),
            reassertOff ? warn(hooks.config.why + ' ' + hooks.options.why +
                ' A rewrite can be noticed but not undone on this build.') : null,
            hooks.config.overpatched || hooks.options.overpatched
                ? warn('a plugin loaded after GigaHack has aliased one of these on top of ours, so the ' +
                    'attribution may be bypassed. Debug → Compatibility lists it.') : null,
            W.toggleRow('Watch for the game rewriting it', {
                value: !!cfg('watch'), sub: 'checked twice a second',
                onChange: function (v) { setCfg('watch', !!v); U.rerender(); }
            })
        ]);

        /* ------------------------------------------------ G4 way back */
        var wayRows = K.wayBack().map(function (a) {
            var direct = keysReaching(a, live);
            var viaEsc = (direct.length === 0 && K.isEscapeCompatible(a))
                ? keysReaching('escape', live) : [];
            var text = direct.length ? direct.join(', ')
                : (viaEsc.length ? ('through escape: ' + viaEsc.join(', ')) : 'NOT REACHABLE');
            return h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: a }),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub',
                    style: (direct.length || viaEsc.length) ? null : 'color:var(--mm-danger)',
                    text: text
                }));
        });
        var menuCode = K.menuKey();
        var g4 = W.group('The way back', wayRows.concat([
            h('div', { class: 'mm-row', 'data-mm-tip': 'Menu key|Matched on position; nothing in this map can take it away.' },
                h('div', { class: 'mm-lab' }, 'GigaHack menu key'),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub',
                    style: menuCode ? null : 'color:var(--mm-danger)',
                    text: menuCode ? (U.prettyCode(menuCode) || menuCode) : 'UNBOUND'
                })),
            menuCode ? null : danger(WHY_NO_MENU_KEY),
            note('A change is refused when it makes unreachable an action the shipped map could reach ' +
                'and that is one of the rows above. Escape counts as a way back for the actions the ' +
                'engine says it does.'),
            K.escapeRuleIsEngine() ? null : warn(ESC_FALLBACK_WHY)
        ]), { tag: 'guard' });

        /* ------------------------------------------------ G5 keyboard */
        var kbDisabled = !write.ok;
        var kbTable = W.table({
            virtual: false, rowH: 17, key: 'keys.kb',
            empty: 'this map is empty',
            cols: [
                { label: 'Key', w: '0 0 96px' },
                { label: 'code', w: '0 0 52px', cls: 'mm-td-num' },
                { label: 'Action', w: '1 1 0' },
                { label: '', w: '0 0 28px' }
            ],
            render: function (r) {
                return [
                    K.label(r.kc),
                    String(r.kc),
                    actionCell(r.kc, r.action, 'keyMapper', kbDisabled),
                    W.button({
                        label: '×', mini: true, mutates: true, disabled: kbDisabled,
                        onClick: function () {
                            var res = K.set(r.kc, null);
                            toastResult(res, 'UNBOUND', K.label(r.kc) + ' is now unbound');
                            U.rerender();
                        }
                    })
                ];
            },
            onRow: function (tr, r) {
                var claim = K.claim(K.codeFor(r.kc));
                if (claim) {
                    tr.style.color = 'var(--mm-warn)';
                    tr.setAttribute('data-mm-tip', 'GigaHack sees this key first|' + claim);
                }
                if (kbDisabled) tr.style.opacity = '.55';
            }
        });
        kbTable.mm.paint(Object.keys(live).sort(numAsc).map(function (k) {
            return { kc: parseInt(k, 10), action: live[k] };
        }));

        var g5 = W.group('Keyboard', [
            kbDisabled ? warn(write.why) : null,
            degradeNote(CTRL_MAP),
            kbTable,
            W.row('Add a key', [
                W.button({
                    label: capturing ? 'listening…' : 'press a key…', mini: true, _ungated: true,
                    onClick: function () {
                        if (capturing) { if (disarmCapture) disarmCapture(); capturing = false; U.rerender(); return; }
                        capturing = true;
                        K.arm(function (kc) {
                            capturing = false;
                            addCode = kc;
                            U.rerender();
                        }, function () { capturing = false; U.rerender(); });
                        U.rerender();
                    }
                }),
                W.number({
                    min: 0, max: 255, step: 1, value: addCode, _ungated: true,
                    onChange: function (v) { addCode = v; }
                }),
                W.dropdown({
                    options: [NONE].concat(actions), value: addAction, width: '112px', _ungated: true,
                    onChange: function (v) { addAction = v; }
                }),
                W.button({
                    label: 'bind', mini: true, mutates: true,
                    disabled: kbDisabled || addAction === NONE,
                    onClick: function () {
                        var res = K.set(addCode, addAction);
                        toastResult(res, 'BOUND', K.label(addCode) + ' → ' + addAction);
                        U.rerender();
                    }
                })
            ], { sub: 'or type the number' }),
            note('Escape and the keys GigaHack has bound cannot be captured here — the overlay acts on ' +
                'them first, and would close this panel. Type their number instead; it is the only ' +
                'route to key 27.'),
            note('Key numbers are what the engine reads. The letter printed on the key can differ on a ' +
                'non-US keyboard layout; capture records the number the key actually sends.')
        ], { tag: countKeys(live) + ' keys', grow: true });
        g5.style.minHeight = '170px';

        /* ------------------------------------------------- G6 gamepad */
        var padDisabled = !writePad.ok;
        var padRows = Object.keys(pad).sort(numAsc).map(function (k) {
            return { i: parseInt(k, 10), action: pad[k] };
        });
        var padTable = W.table({
            virtual: false, rowH: 17, key: 'keys.pad',
            empty: padOk() ? 'the pad map is empty, so the controller is off' : 'no pad map on this build',
            cols: [
                { label: 'Button', w: '0 0 116px' },
                { label: 'index', w: '0 0 48px', cls: 'mm-td-num' },
                { label: 'Action', w: '1 1 0' },
                { label: '', w: '0 0 28px' }
            ],
            render: function (r) {
                return [
                    K.padLabel(r.i),
                    String(r.i),
                    actionCell(r.i, r.action, 'gamepadMapper', padDisabled),
                    W.button({
                        label: '×', mini: true, mutates: true, disabled: padDisabled,
                        onClick: function () {
                            var res = K.setPad(r.i, null);
                            toastResult(res, 'UNBOUND', K.padLabel(r.i) + ' is now unbound');
                            U.rerender();
                        }
                    })
                ];
            },
            onRow: function (tr) { if (padDisabled) tr.style.opacity = '.55'; }
        });
        padTable.mm.paint(padRows);

        var padRead = K.padPresent();
        var g6 = W.group('Gamepad', [
            padOk() ? null : warn(WHY_NO_PAD),
            padDisabled && padOk() ? warn(writePad.why) : null,
            degradeNote(CTRL_PAD),
            padTable,
            W.row('Add a button', [
                W.button({
                    label: padCapturing ? 'listening…' : 'read a button…', mini: true, _ungated: true,
                    disabled: !padRead.ok,
                    tip: padRead.ok ? null : 'Unavailable|' + padRead.why,
                    onClick: function () {
                        if (padCapturing) { if (disarmPad) disarmPad(); padCapturing = false; U.rerender(); return; }
                        padCapturing = true;
                        K.armPad(function (i) { padCapturing = false; padAddIndex = i; U.rerender(); },
                            function () { padCapturing = false; U.rerender(); });
                        U.rerender();
                    }
                }),
                W.number({
                    min: 0, max: 31, step: 1, value: padAddIndex, _ungated: true,
                    onChange: function (v) { padAddIndex = v; }
                }),
                W.dropdown({
                    options: [NONE].concat(actions), value: padAddAction, width: '112px', _ungated: true,
                    onChange: function (v) { padAddAction = v; }
                }),
                W.button({
                    label: 'bind', mini: true, mutates: true,
                    disabled: padDisabled || padAddAction === NONE,
                    onClick: function () {
                        var res = K.setPad(padAddIndex, padAddAction);
                        toastResult(res, 'BOUND', K.padLabel(padAddIndex) + ' → ' + padAddAction);
                        U.rerender();
                    }
                })
            ], { sub: 'index, not a key number' }),
            padRead.ok ? null : note(padRead.why),
            note('Button names are the standard controller layout the engine\'s own table is written ' +
                'in. A pad that reports a different mapping sends different indices for the same ' +
                'physical buttons.')
        ], { tag: countKeys(pad) + ' buttons', collapsed: true });

        /* -------------------------------------------- G7 what changed */
        var g7 = null;
        if (d.changed) {
            g7 = W.group('What changed', [
                h('div', { class: 'mm-pre mm-pre-wrap' },
                    d.diff.map(function (x) {
                        return x.label + ' (' + x.keyCode + ')  ' + x.was + ' → ' + x.now;
                    }).join('\n')),
                note('cause: ' + d.cause),
                W.button({
                    label: 'put my map back', mutates: true, disabled: !setKb,
                    tip: setKb ? null : 'Unavailable|GigaHack has not set a map this session.',
                    onClick: function () {
                        var r = K.apply(setKb, 'keyMapper');
                        toastResult(r, 'PUT BACK', 'the map GigaHack set is back');
                        U.rerender();
                    }
                }),
                W.button({
                    label: 'keep the game\'s version', _ungated: true,
                    tip: 'Accept|Changes nothing in the game.',
                    onClick: function () { K.accept('keyMapper'); U.rerender(); }
                })
            ], { tag: d.count + ' keys' });
        }

        return cols({ narrow: true, items: [g1, g2, g3, g4] }, [g5, g6, g7]);
    }

    function firstFrameDiffCount() {
        if (!shippedKb || !firstKb) return 0;
        var seen = {}, n = 0;
        Object.keys(shippedKb).forEach(function (k) { seen[k] = true; });
        Object.keys(firstKb).forEach(function (k) { seen[k] = true; });
        Object.keys(seen).forEach(function (k) { if (shippedKb[k] !== firstKb[k]) n++; });
        return n;
    }

    /**
     * The Action cell.
     *
     * Nothing here hardcodes the engine's action names: the dropdown offers
     * what the four maps actually use, and '(other…)' turns the cell into a
     * field so a name no map currently carries can still be typed.
     */
    function actionCell(id, current, which, disabled) {
        var isPad = which === 'gamepadMapper';
        var open = isPad ? (otherPad === id) : (otherKb === id);
        if (open) {
            return W.text({
                value: current || '', width: '100%', mono: true,
                placeholder: 'an action name',
                onEnter: function (v) {
                    if (isPad) otherPad = null; else otherKb = null;
                    var name = String(v || '').trim();
                    var res = isPad ? K.setPad(id, name || null) : K.set(id, name || null);
                    toastResult(res, 'BOUND', (isPad ? K.padLabel(id) : K.label(id)) +
                        ' → ' + (name || '(none)'));
                    U.rerender();
                }
            });
        }
        return W.dropdown({
            options: [NONE].concat(K.actions()).concat([OTHER]),
            value: current || NONE, disabled: disabled,
            onChange: function (v) {
                if (v === OTHER) {
                    if (isPad) otherPad = id; else otherKb = id;
                    U.rerender();
                    return;
                }
                var res = isPad
                    ? K.setPad(id, v === NONE ? null : v)
                    : K.set(id, v === NONE ? null : v);
                toastResult(res, 'BOUND', (isPad ? K.padLabel(id) : K.label(id)) + ' → ' + v);
                U.rerender();
            }
        });
    }

    U.panel('settings', 'Game Keys', function () { return buildKeys(); }, 35);

    /* =====================================================================
       PART 12 — WHAT THE REST OF THE MOD ASKS

       Boot's report and Debug → Compatibility want one line about whether this
       game can still be quit, without a second copy of the escape rule.
       ===================================================================== */
    K.report = function () {
        var d = K.drift();
        var strandedNow = [];
        var liveMapNow = K.map();
        K.wayBack().forEach(function (a) {
            if (!K.reachable(a, liveMapNow)) strandedNow.push(a);
        });
        return {
            keys: countKeys(liveMapNow),
            pad: padOk() ? countKeys(K.padMap()) : null,
            shipped: shippedAt,
            drifted: d.changed,
            driftCount: d.count,
            cause: d.cause,
            unreachable: strandedNow,
            escapeRule: K.escapeRuleIsEngine() ? 'the engine\'s own' : 'assumed',
            persisted: !!cfg('persist')
        };
    };

    K.describe = function () {
        var r = K.report();
        return r.keys + ' keys, ' + (r.pad === null ? 'no pad map' : r.pad + ' pad buttons') +
            (r.drifted ? ', ' + r.driftCount + ' changed since GigaHack set it' : ', unchanged') +
            (r.unreachable.length ? ', NO WAY BACK for ' + r.unreachable.join(', ') : '');
    };

    $.log('info', 'keys: ' + K.describe());

})(window.GigaHack);
