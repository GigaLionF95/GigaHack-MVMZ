//=============================================================================
// GigaHack MV/MZ
// 17 · text.js — message speed, auto-advance, hold-to-turbo, backlog
//-----------------------------------------------------------------------------
// SURFACE WHAT THE GAME ALREADY HAS; BUILD ONLY WHAT IS MISSING. Games commonly
// ship their own text options — instant text, a guard that stops skipping at
// unread lines — as player-facing settings on ConfigManager. Rebuilding those
// would mean two systems fighting over the same text, so this module surfaces
// them instead: the toggle writes the game's own flag through the game's own
// config, and the mod and the Options menu agree in both directions.
//
// WHICH options those are is a property of the game, not of the engine, so no
// key is written down here. The profile may declare the ones worth surfacing;
// otherwise they are discovered — every boolean on ConfigManager the engine did
// not put there is, by definition, one this game added. A build that added none
// gets a panel that says so.
//
// What is genuinely missing on both engines, and is therefore built here:
// auto-advance, hold-to-turbo, and a searchable view of the message backlog.
//
// A BACKLOG IS NOT AN ENGINE FEATURE. Game_Message is core and generic; keeping
// a scrollback of what has been said is a plugin, and a different one on every
// game that has it. So the whole Backlog panel is a front end for
// $.profile.adapter('backlog') — { available, read, clear, max, setMax, open },
// optionally speakerColor and restore — and with no adapter the panel is not
// registered at all. Nothing here touches a Game_System field by name.
//
// THE TEXT-APPEARANCE OVERRIDES ARE THE ENGINE-SPECIFIC PART. The single place
// that decides the main font, and the single place that decides the normal text
// colour, are on completely different objects on the two engines — a manager
// class on one, per-window accessors on the other. Both are asked for through
// $.eng.fontTarget() and $.eng.normalColorTarget(), which name the one hook
// point that reaches every stock window on this engine, and both degrade with a
// stated reason where there is none.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — message speed, auto-advance, turbo, backlog
 * @author gigahack
 * @help GigaHack_Text.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) {
        console.error('[GigaHack] shell missing — text not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;
    var T = $.text = {};

    function cfg() { return $.cfg.text || {}; }
    function num(k, dflt, lo, hi) {
        var v = cfg()[k];
        if (typeof v !== 'number' || v !== v) return dflt;
        return v < lo ? lo : v > hi ? hi : v;
    }

    /* =====================================================================
       PART 1 — THE GAME'S OWN OPTIONS

       No option key is written down in this file. Which text options a game
       has is that game's business, so they come from one of two places:

         1. the profile declares them, with the names to show:
              $.profile.adapter('gameOptions').list()
                  -> [{ key, label, tip }]
            (also read from $.profile.get('gameOptions') for a profile that
            carries the list as a plain field);

         2. otherwise they are DISCOVERED. Both engines ship a small, known set
            of options; every OTHER boolean on ConfigManager was put there by
            this game, which is exactly the definition of "worth surfacing".

       Discovery is what makes this work on a game nobody has written a profile
       for, and the declaration is what lets a profile give those options real
       names instead of de-camel-cased keys.
       ===================================================================== */

    /* What the engines ship themselves. The volumes are numbers and would be
       excluded by the boolean test anyway; they are listed so the set reads as
       what it is — "the engine's own options" — rather than as a filter whose
       shape has to be inferred. */
    var STOCK_CONFIG = ['alwaysDash', 'commandRemember', 'touchUI',
        'bgmVolume', 'bgsVolume', 'meVolume', 'seVolume'];

    /* A list long enough to be useful and short enough to stay a sidebar. A
       game that exposes thirty flags is not asking for all thirty here. */
    var MAX_OPTIONS = 8;

    function hasConfig(key) {
        return typeof ConfigManager !== 'undefined' && ConfigManager &&
            ConfigManager[key] !== undefined;
    }

    function readConfig(key) { return hasConfig(key) ? !!ConfigManager[key] : false; }

    /** Write one of the game's own options and persist it the game's way. */
    function writeConfig(key, value, label) {
        if (!hasConfig(key)) return false;
        if (!$.allowWrite(label)) return false;
        return $.safe(function () {
            ConfigManager[key] = !!value;
            /* Through ConfigManager.save, so it lands in the game's own config
               file and the Options menu shows the same thing next time it
               opens. One engine's save is synchronous and the other's answers
               with a promise — an unhandled rejection there would surface as a
               console error nobody could attribute, so a rejection is caught
               and reported as what it is. */
            if (ConfigManager.save) {
                var r = ConfigManager.save();
                if (r && typeof r.then === 'function') {
                    r.then(null, function (e) {
                        $.log('warn', 'the game option "' + key + '" was changed but its config file could ' +
                            'not be written — ' + ((e && e.message) || e));
                    });
                }
            }
            $.log('ok', label + ' → ' + (value ? 'on' : 'off') + ' (game option ' + key + ')');
            return true;
        }, 'write ' + key, false);
    }

    /** "skipUnseen" -> "Skip Unseen". Only used when nobody named the option for us. */
    function labelFor(key) {
        return String(key)
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .replace(/^./, function (c) { return c.toUpperCase(); });
    }

    function declaredOptions() {
        return $.safe(function () {
            if (!$.profile) return null;
            var ad = $.profile.adapter ? $.profile.adapter('gameOptions') : null;
            var list = (ad && typeof ad.list === 'function') ? ad.list() : null;
            if (!list && $.profile.get) list = $.profile.get('gameOptions', null);
            if (!list || !list.length) return null;
            return list.map(function (o) {
                if (typeof o === 'string') return { key: o, label: labelFor(o), tip: null };
                return { key: o.key, label: o.label || labelFor(o.key), tip: o.tip || null };
            }).filter(function (o) { return !!o.key; });
        }, 'declared game options', null);
    }

    function discoveredOptions() {
        return $.safe(function () {
            if (typeof ConfigManager === 'undefined' || !ConfigManager) return [];
            var out = [];
            for (var k in ConfigManager) {
                if (typeof ConfigManager[k] !== 'boolean') continue;
                if (STOCK_CONFIG.indexOf(k) > -1) continue;
                if (k.charAt(0) === '_') continue;
                out.push({ key: k, label: labelFor(k), tip: null });
            }
            out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
            return out;
        }, 'discover game options', []) || [];
    }

    /**
     * The options this build actually has, in the order they will be shown.
     * `declared` says whether a profile named them, which is the difference
     * between a real label and a de-camel-cased key.
     */
    T.gameOptions = function () {
        var declared = declaredOptions();
        var list = declared || discoveredOptions();
        return list.filter(function (o) { return hasConfig(o.key); })
            .slice(0, MAX_OPTIONS)
            .map(function (o) {
                o.declared = !!declared;
                return o;
            });
    };

    T.optionAvailable = function (key) { return hasConfig(key); };
    T.option = function (key) { return readConfig(key); };
    T.setOption = function (key, v, label) { return writeConfig(key, v, label || labelFor(key)); };

    /**
     * Whether the game will let a message be skipped here.
     *
     * One engine has this test and the other has no such concept, so it is
     * feature-detected and reported as "not a thing on this build" rather than
     * as "no". The panel prints one or the other; neither is an error.
     */
    T.messageSkipKnown = function () {
        return $.safe(function () {
            return !!(typeof $gameSystem !== 'undefined' && $gameSystem &&
                typeof $gameSystem.isMessageSkipEnabled === 'function');
        }, 'message skip known', false);
    };

    T.messageSkipEnabled = function () {
        return $.safe(function () {
            return !!($gameSystem && $gameSystem.isMessageSkipEnabled &&
                $gameSystem.isMessageSkipEnabled());
        }, 'message skip', false);
    };

    /* =====================================================================
       PART 2 — BACKLOG (the game's own, through an adapter)

       Game_Message is core and generic. A SCROLLBACK of what has been said is
       not: it is a plugin, and a different one on every game that has one. So
       this panel reads nothing by name and owns no second copy of the log. It
       is a front end for one optional adapter:

           $.profile.adapter('backlog')
               available()      is there anything to read yet
               read()           the lines, oldest first, as the game stores them
               clear()          empty it
               max()            how many lines the game keeps
               setMax(n)        change that
               open()           push the game's own backlog scene
             optional:
               speakerColor()   the text colour index used for speaker headers
               restore(lines)   put lines back, which is what makes undo possible

       With no adapter the panel is never registered. Resolution is LAZY — the
       profile cannot resolve before the database has loaded, which is after
       this file is set up — so the adapter is asked for at call time.
       ===================================================================== */
    function backlogAdapter() {
        return $.safe(function () {
            if (!$.profile || !$.profile.adapter) return null;
            var ad = $.profile.adapter('backlog');
            if (!ad || typeof ad.read !== 'function') return null;
            return ad;
        }, 'backlog adapter', null);
    }
    T.backlogAdapter = backlogAdapter;

    /** Does this game have a backlog at all — i.e. is the panel worth having. */
    T.backlogDeclared = function () { return !!backlogAdapter(); };

    /** Is there something in it right now. */
    T.backlogAvailable = function () {
        var ad = backlogAdapter();
        if (!ad) return false;
        if (typeof ad.available !== 'function') return true;
        return !!$.safe(function () { return ad.available(); }, 'backlog available', false);
    };

    /**
     * Strip message escape codes.
     *
     * The critical detail: a game that stores converted text has already run it
     * through the engine's convertEscapeCharacters, whose FIRST act is
     * `text.replace(/\\/g, "\x1b")`. By the time it is stored there is no
     * backslash left — the codes are ESC-prefixed. Matching on a backslash
     * finds nothing, and since \x1b is an invisible control character the DOM
     * then shows a bare "c[14]Name:". Both forms are handled, because a game
     * that stores raw text reaches here too.
     */
    var ESC_CODE = /\x1b(?:[a-zA-Z]+\[[^\]]*\]|[a-zA-Z]|[.|!^$<>{}])/g;
    var RAW_CODE = /\\(?:[a-zA-Z]+\[[^\]]*\]|[.|!^$<>{}]|[a-zA-Z](?![a-zA-Z]))/g;

    /* Any colour code at the head of an entry, with its index captured. WHICH
       index means "speaker" is a property of the game, never a constant — see
       speakerIndex() below. */
    var COLOUR_HEAD = /^(?:\x1b|\\)[cC]\[(\d+)\]/;

    function plain(s) {
        return String(s)
            .replace(ESC_CODE, '')
            .replace(RAW_CODE, '')
            .replace(/\x1b/g, '')          // any stray control char
            .replace(/\r/g, '')
            .replace(/[ \t]+/g, ' ')
            .trim();
    }
    T._plain = plain;

    /* ------------------------------------------------------- speaker split
       A game that keeps a backlog commonly writes the speaker as its OWN entry
       — a colour code, the name, a colon — and then the lines that speaker
       said. Pairing them back up is what turns a flat list of strings into
       something worth searching.

       Which colour index carries that meaning is the game's choice, so it is
       never hardcoded. Three answers, in order:
         1. the adapter declares it;
         2. it is DETECTED from the log itself — the colour index that most
            often introduces an entry ending in a colon;
         3. nothing is detected, and there is simply no speaker split. Every
            line is then listed exactly as it was said, which is worse than a
            split but far better than eating dialogue that merely ends in a
            colon.

       Detection scans the whole log, so it is cached against its length: a log
       only grows, and re-deriving this on every repaint of a virtual table
       would be the most expensive thing in the panel.
       ------------------------------------------------------------------ */
    var speakerCache = { key: -1, index: null };

    function speakerIndex(raw) {
        var ad = backlogAdapter();
        if (ad && typeof ad.speakerColor === 'function') {
            var declared = $.safe(function () { return ad.speakerColor(); }, 'speaker colour', null);
            if (typeof declared === 'number' && declared >= 0) return declared;
        }
        if (speakerCache.key === raw.length) return speakerCache.index;

        var tally = {}, best = null, bestN = 0, candidates = 0, i, m, n;
        for (i = 0; i < raw.length; i++) {
            m = COLOUR_HEAD.exec(String(raw[i] || ''));
            if (!m) continue;
            if (!/:$/.test(plain(raw[i]))) continue;
            candidates++;
            n = tally[m[1]] = (tally[m[1]] || 0) + 1;
            if (n > bestN) { bestN = n; best = parseInt(m[1], 10); }
        }
        /* A real signal, or nothing. Two entries that happen to open with a
           colour code and end in a colon are not a convention, and guessing
           wrong removes lines from the list rather than mislabelling them. */
        var idx = (bestN >= 3 && bestN >= candidates * 0.5) ? best : null;
        speakerCache = { key: raw.length, index: idx };
        return idx;
    }

    T.speakerIndex = function () {
        var ad = backlogAdapter();
        if (!ad) return null;
        return speakerIndex($.safe(function () { return ad.read() || []; }, 'backlog read', []) || []);
    };

    T.backlog = function () {
        var ad = backlogAdapter();
        if (!ad) return [];
        var raw = $.safe(function () { return ad.read() || []; }, 'backlog read', []) || [];
        var idx = speakerIndex(raw);
        var out = [], speaker = '', i, line, text, m;
        for (i = 0; i < raw.length; i++) {
            line = String(raw[i] || '');
            text = plain(line);
            if (!text) continue;
            if (idx !== null) {
                m = COLOUR_HEAD.exec(line);
                // Both parts are required — the detected colour index AND the
                // trailing colon — so a line of dialogue that merely ends in a
                // colon is not mistaken for a speaker header.
                if (m && parseInt(m[1], 10) === idx && /:$/.test(text)) {
                    speaker = text.replace(/:+$/, '').trim();
                    continue;
                }
            }
            out.push({ i: out.length, speaker: speaker, text: text.replace(/\n+/g, ' ') });
        }
        return out;
    };

    T.maxLogs = function () {
        var ad = backlogAdapter();
        if (!ad || typeof ad.max !== 'function') return 0;
        return $.safe(function () { return ad.max() || 0; }, 'max logs', 0) || 0;
    };

    T.maxLogsWritable = function () {
        var ad = backlogAdapter();
        return !!(ad && typeof ad.setMax === 'function');
    };

    /**
     * Change how many lines the game keeps.
     *
     * Lowering the limit throws lines away. Whether they can be put back is the
     * adapter's business — with restore() the undo is real, and without it the
     * undo entry would be a lie, so it is not offered and the loss is stated
     * instead.
     */
    T.setMaxLogs = function (n) {
        if (!T.maxLogsWritable()) return false;
        if (!$.allowWrite('Backlog size')) return false;
        var ad = backlogAdapter();
        return $.safe(function () {
            var v = Math.max(10, Math.min(2000, Math.floor(n)));
            var before = T.maxLogs();
            var lines = (ad.read() || []).slice();
            ad.setMax(v);
            var after = (ad.read() || []).length;
            var lost = lines.length - after;
            if (typeof ad.restore === 'function') {
                $.undo.push('backlog size ' + before + ' → ' + v +
                    (lost > 0 ? ' (' + lost + ' lines trimmed)' : ''), function () {
                    $.safe(function () { ad.setMax(before); ad.restore(lines); }, 'undo backlog size');
                });
            } else if (lost > 0) {
                $.log('warn', 'backlog trimmed to ' + v + ' lines — ' + lost + ' older line(s) are gone, ' +
                    'and this game\'s backlog offers no way to put them back, so there is no undo entry ' +
                    'for it.');
            }
            return true;
        }, 'set max logs', false);
    };

    T.clearBacklog = function () {
        var ad = backlogAdapter();
        if (!ad || typeof ad.clear !== 'function') return false;
        if (!$.allowWrite('Clearing the backlog')) return false;
        return $.safe(function () {
            var before = (ad.read() || []).slice();
            ad.clear();
            speakerCache = { key: -1, index: null };
            if (typeof ad.restore === 'function') {
                $.undo.push('cleared ' + before.length + ' backlog lines', function () {
                    $.safe(function () { ad.restore(before); }, 'undo clear backlog');
                });
                $.log('ok', 'backlog cleared (' + before.length + ' lines) — undoable');
            } else {
                $.log('warn', 'backlog cleared (' + before.length + ' lines). This game\'s backlog offers no ' +
                    'way to put lines back, so this cannot be undone.');
            }
            return before.length;
        }, 'clear backlog', false);
    };

    /** Can the game's own backlog window be opened from here. */
    T.sceneAvailable = function () {
        var ad = backlogAdapter();
        return !!(ad && typeof ad.open === 'function');
    };

    T.openBacklog = function () {
        var ad = backlogAdapter();
        if (!ad || typeof ad.open !== 'function') return false;
        return $.safe(function () {
            if (typeof $gameParty !== 'undefined' && $gameParty && $gameParty.inBattle()) {
                U.toast({ title: 'NOT IN BATTLE', msg: 'the backlog scene cannot open from a fight', severity: 'warn' });
                return false;
            }
            U.setOpen(false);
            return ad.open() !== false;
        }, 'open backlog', false);
    };

    /* =====================================================================
       PART 3 — AUTO-ADVANCE AND HOLD-TO-TURBO
       ===================================================================== */
    var held = false;

    function turboCode() { return cfg().turboKey || 'ControlLeft'; }

    // Tracked on KeyboardEvent.code rather than through Input.keyMapper. A
    // game that exposes key rebinding lets the player edit keyMapper, and a
    // symbol GigaHack added would appear in their rebind screen as though the
    // game owned it — and could be deleted from under us. The DOM event is
    // outside all of that and behaves the same on both engines.
    window.addEventListener('keydown', function (e) {
        if (e.code === turboCode()) held = true;
    }, true);
    window.addEventListener('keyup', function (e) {
        if (e.code === turboCode()) held = false;
    }, true);
    // A window that loses focus never sees the keyup.
    window.addEventListener('blur', function () { held = false; });

    T.turboHeld = function () { return held && !!cfg().turbo; };
    T._setHeld = function (v) { held = !!v; };      // test hook

    /**
     * A choice, a number prompt or an item prompt always stops both turbo and
     * auto-advance. Reading past a decision you did not make is the one thing
     * a text accelerator must never do.
     */
    function atDecision() {
        return $.safe(function () {
            if (typeof $gameMessage === 'undefined' || !$gameMessage) return false;
            return !!(($gameMessage.isChoice && $gameMessage.isChoice()) ||
                ($gameMessage.isNumberInput && $gameMessage.isNumberInput()) ||
                ($gameMessage.isItemChoice && $gameMessage.isItemChoice()));
        }, 'at decision', true);        // on doubt, stop
    }
    T.atDecision = atDecision;

    var pauseFrames = 0;

    // The setting is seconds because that is what a reader thinks in; the
    // engine counts frames, so the conversion lives in exactly one place.
    var FPS = 60;
    T.autoSeconds = function () { return num('autoSeconds', 1.5, 0.1, 10); };
    T.autoFrames = function () { return Math.max(1, Math.round(T.autoSeconds() * FPS)); };

    $.install('Window_Message.startPause.auto',
        typeof Window_Message !== 'undefined' ? Window_Message.prototype : null, 'startPause',
        function (original) {
            return function () {
                pauseFrames = 0;        // a new page: start counting again
                return original.apply(this, arguments);
            };
        });

    /**
     * The thing that makes turbo actually fast.
     *
     * startPause runs startWait(10) before setting `pause`, and updateWait
     * blocks updateInput while that counter runs down — so releasing the pause
     * alone still caps at roughly six pages a second, which does not read as
     * turbo at all. Holding the key skips every wait: the page-end one, and
     * the ones the \. and \| text codes ask for.
     */
    $.install('Window_Message.updateWait.turbo',
        typeof Window_Message !== 'undefined' ? Window_Message.prototype : null, 'updateWait',
        function (original) {
            return function () {
                if (T.turboHeld() && !atDecision()) {
                    this._waitCount = 0;
                    return false;
                }
                return original.apply(this, arguments);
            };
        });

    // Render the page instantly while turbo is held. A game's own instant-text
    // option commonly aliases this same method; GigaHack loads last, so this
    // wraps whatever is already there rather than replacing it.
    $.install('Window_Message.updateShowFast.turbo',
        typeof Window_Message !== 'undefined' ? Window_Message.prototype : null, 'updateShowFast',
        function (original) {
            return function () {
                original.apply(this, arguments);
                if (T.turboHeld() && !atDecision()) this._showFast = true;
            };
        });

    /**
     * isTriggered is the engine's "has the player asked to move on" test, and
     * it is only consulted while the message is paused at the end of a page —
     * so this is the one seam that advances text without touching the input
     * system or the choice windows at all.
     */
    $.install('Window_Message.isTriggered.auto',
        typeof Window_Message !== 'undefined' ? Window_Message.prototype : null, 'isTriggered',
        function (original) {
            return function () {
                var real = original.apply(this, arguments);
                if (real) return true;
                var c = cfg();
                if (atDecision()) return false;
                if (T.turboHeld()) return true;
                if (c.auto) {
                    pauseFrames++;
                    if (pauseFrames >= T.autoFrames()) {
                        pauseFrames = 0;
                        return true;
                    }
                }
                return false;
            };
        });

    T.available = function () {
        return ['Window_Message.startPause.auto', 'Window_Message.updateShowFast.turbo',
            'Window_Message.updateWait.turbo', 'Window_Message.isTriggered.auto'].every(function (n) {
                return !!($.hooks[n] && $.hooks[n].installed);
            });
    };
    T.why = function () {
        var names = ['Window_Message.startPause.auto', 'Window_Message.updateShowFast.turbo',
            'Window_Message.updateWait.turbo', 'Window_Message.isTriggered.auto'];
        for (var i = 0; i < names.length; i++) {
            var hk = $.hooks[names[i]];
            if (!hk || !hk.installed) return (hk && hk.reason) || 'Window_Message was not found in this build';
        }
        return null;
    };
    T._pauseFrames = function () { return pauseFrames; };
    T._resetPause = function () { pauseFrames = 0; };

    /* =====================================================================
       PART 4 — TAB
       ===================================================================== */
    var ROW_H = 17;

    function unavailable(why) {
        return h('div', {
            class: 'mm-sub', style: 'padding:0 2px 4px;white-space:normal;color:var(--mm-warn)',
            text: 'unavailable — ' + why
        });
    }

    function buildMessage() {
        var why = T.why();

        /**
         * These two mirror options the player can also change in the game's own
         * Options menu, so the widget's idea of its state goes stale the moment
         * they do. Two consequences, both handled here:
         *
         *  - the NEW value is computed from the game's current value, never
         *    from the checkbox's own toggled state, so a stale box cannot
         *    write the wrong thing;
         *  - the box is re-read from the game on the tick, so it catches up
         *    rather than sitting there lying.
         *
         * The game is the single source of truth in both directions.
         */
        function gameOption(label, read, write, tip) {
            var row = W.toggleRow(label, W.ungated({
                value: read(), tip: tip,
                onChange: function () {
                    var want = !read();          // from the GAME, not the widget
                    if (!write(want)) row.mm.set(read(), true);   // refused: snap back
                    else row.mm.set(want, true);
                }
            }));
            row.mmSync = function () {
                var real = read();
                if (row.mm.get() !== real) row.mm.set(real, true);
            };
            return row;
        }

        /* One row per option this build actually has. No key is named here:
           the list is whatever the profile declared or, failing that, whatever
           booleans this game added to ConfigManager that the engine did not.
           A build with none gets a sentence saying so rather than a column of
           controls for things that are not there. */
        var optionSpecs = T.gameOptions();
        var optionRows = optionSpecs.map(function (spec) {
            return gameOption(spec.label,
                function () { return T.option(spec.key); },
                function (v) { return T.setOption(spec.key, v, spec.label); },
                spec.tip || (spec.label + '|The game\'s own option, and the same switch as its Options ' +
                    'menu. Changing it in either place changes it in both.'));
        });

        var speed = W.group('The game\'s own options',
            optionRows.length ? optionRows : [unavailable('this build adds no options of its own — ' +
                'GigaHack surfaces the ones a game already has and never invents one to fight it over ' +
                'the same text')],
            { tag: optionRows.length
                ? (optionSpecs[0].declared ? 'from the profile' : 'discovered')
                : 'none' });

        var autoRows = [
            W.toggleRow('Auto-advance', W.ungated({
                value: !!cfg().auto, disabled: !!why,
                tip: 'Auto-advance|Pages turn themselves after a delay. Always stops at a choice, ' +
                    'a number prompt or an item prompt.',
                onChange: function (v) {
                    $.store.cfgSet('text.auto', v);
                    U.setActive('auto-advance', v);
                }
            })),
            W.row('delay', W.slider({
                value: T.autoSeconds(), min: 0.1, max: 10, step: 0.1,
                unit: 's', width: '104px', label: 'auto delay', _ungated: true,
                disabled: !!why,
                onChange: function (v) { $.store.cfgSet('text.autoSeconds', v); }
            }), { tip: 'Delay|Seconds to wait before turning the page.' }),
            W.toggleRow('Hold to turbo', W.ungated({
                value: cfg().turbo !== false, disabled: !!why,
                tip: 'Turbo|While the key is held, text renders instantly and pages turn themselves. ' +
                    'Releases at every choice.',
                onChange: function (v) {
                    $.store.cfgSet('text.turbo', v);
                    U.setActive('turbo', v);
                }
            })),
            W.row('turbo key', W.keybind({
                key: turboCode(), modes: false,
                onChange: function (v) {
                    $.store.cfgSet('text.turboKey', v.key || 'ControlLeft');
                    held = false;
                }
            }), { tip: 'Turbo key|Matched on KeyboardEvent.code, so it never enters the game\'s own ' +
                'rebindable key map.' })
        ];
        if (why) autoRows.splice(1, 0, unavailable(why));

        // .mm-stack-tight, not an inline gap: `gap` in a flex container needs
        // a browser far newer than the floor one of these engines ships with,
        // and the stylesheet already carries the margin-based equivalent.
        var live = h('div', { class: 'mm-stack-tight' });
        function paintLive() {
            U.clear(live);
            U.add(live, [
                kv('Message on screen', $.safe(function () {
                    return $gameMessage && $gameMessage.isBusy() ? 'yes' : 'no';
                }, 'busy', '?')),
                kv('At a choice', atDecision() ? 'yes — accelerators held' : 'no'),
                kv('Turbo key down', T.turboHeld() ? 'yes' : 'no'),
                // One engine has a "may this message be skipped" test and the
                // other has no such concept. Both are facts about the build,
                // and neither is an error.
                kv('Message skip', T.messageSkipKnown()
                    ? (T.messageSkipEnabled() ? 'allowed here' : 'blocked here')
                    : 'not a concept on this build')
            ]);
        }
        paintLive();
        var host = U.getHost();
        if (host) {
            host.tickHooks.push(function () {
                if (!U.isOpen || !U.isOpen()) return;
                paintLive();
                // Catch up with the game's own Options menu without rebuilding
                // the panel. The game is the single source of truth in both
                // directions, so a row that has gone stale is re-read rather
                // than left there lying.
                optionRows.forEach(function (r) { $.safe(r.mmSync, 'sync game option'); });
            });
        }

        return cols({ narrow: true, items: [speed, W.group('Auto & turbo', autoRows, { tag: 'gigahack' })] },
            [W.group('Right now', [live], { tag: 'live' }), injectGroup(), lookGroup()]);
    }

    /* ------------------------------------------------------- panel groups */
    var injectText = '', injectSpeaker = '';

    /** Does this build have a message name box at all. */
    function nameBoxAvailable() {
        return $.safe(function () {
            return typeof $gameMessage !== 'undefined' && !!$gameMessage &&
                typeof $gameMessage.setSpeakerName === 'function';
        }, 'name box', false);
    }
    T.nameBoxAvailable = nameBoxAvailable;

    function injectGroup() {
        var why = T.injectWhy();
        return W.group('Say something', [
            W.row('Speaker', W.text({
                value: injectSpeaker, width: '140px',
                // One engine has a name box and the other has no such concept;
                // the field says which this is rather than silently dropping
                // what was typed into it.
                placeholder: nameBoxAvailable() ? 'optional name box' : 'no name box on this build',
                disabled: !nameBoxAvailable(),
                onInput: function (v) { injectSpeaker = v; }
            })),
            W.textarea({
                value: injectText, rows: 3, label: 'message text',
                placeholder: 'up to four lines, control codes work',
                onInput: function (v) { injectText = v; }
            }),
            W.button({
                label: 'show it', wide: true, mutates: true, disabled: !!why,
                onClick: function () {
                    var r = T.inject(injectText, { speaker: injectSpeaker || null });
                    U.toast(r.ok
                        ? {
                            title: 'SHOWN', severity: 'ok', ms: 1400,
                            msg: r.lines + ' line' + (r.lines === 1 ? '' : 's') +
                                (r.dropped ? ' · ' + r.dropped + ' past the fourth were dropped' : '')
                        }
                        : { title: 'NOT SHOWN', msg: r.error, severity: 'warn' });
                }
            }),
            why ? h('div', {
                class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px', text: why
            }) : h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Queued through $gameMessage, so it looks and behaves like an event’s own text.')
        ], { tag: why ? 'unavailable' : '$gameMessage' });
    }

    function lookGroup() {
        var lk = T.look();
        return W.group('Appearance', [
            W.toggleRow('Override the font size', {
                value: lk.sizeOn, keybind: false, disabled: !T.lookAvailable(),
                onChange: function (v) { $.store.cfgSet('text.look.sizeOn', v); T.refreshWindows(); U.rerender(); }
            }),
            W.row('Size', W.slider({
                value: lk.size, min: 12, max: 48, width: '116px', label: 'font size',
                disabled: !lk.sizeOn,
                onChange: function (v) { $.store.cfgSet('text.look.size', v); T.refreshWindows(); }
            })),
            h('div', { class: 'mm-sep' }),
            W.toggleRow('Override the font', {
                value: lk.faceOn, keybind: false, disabled: !T.lookAvailable(),
                onChange: function (v) { $.store.cfgSet('text.look.faceOn', v); T.refreshWindows(); U.rerender(); }
            }),
            W.row('Font', W.text({
                value: lk.face, mono: true, width: '140px', placeholder: 'e.g. Verdana',
                onEnter: function (v) { $.store.cfgSet('text.look.face', v); T.refreshWindows(); U.rerender(); }
            }), { tip: 'Font|Put in FRONT of the game’s own stack, not instead of it, so a font that fails to ' +
                    'load falls back to what the game shipped with rather than to the browser default.' }),
            T.lookAvailable() ? null : unavailable(T.lookWhy()),
            h('div', { class: 'mm-sep' }),
            W.toggleRow('Override the text colour', {
                value: lk.colourOn, keybind: false, disabled: !T.colourAvailable(),
                onChange: function (v) { $.store.cfgSet('text.look.colourOn', v); U.rerender(); }
            }),
            W.row('Colour', W.color({
                value: lk.colour, label: 'text colour',
                onChange: function (v) { $.store.cfgSet('text.look.colour', v); }
            })),
            T.colourAvailable() ? null : unavailable(T.colourWhy()),
            // Naming the method these landed on is the difference between "the
            // font control does nothing" and a paste that says which single
            // point this engine actually has.
            kv('In force', T.colourNow()),
            T.lookTarget() ? kv('Font hook', T.lookTarget()) : null,
            T.colourTarget() ? kv('Colour hook', T.colourTarget()) : null,
            T.colourAvailable() && !$.caps.colorManager ? h('div', {
                class: 'mm-sub', style: 'padding:2px;white-space:normal',
                text: 'On this engine the colour is a per-window accessor. The override is installed at the ' +
                    'one point the engine\'s own text-colour reset calls, so it reaches every stock window — ' +
                    'but a window that asks for colour index 0 directly still bypasses it.'
            }) : null
        ], { tag: (lk.sizeOn || lk.faceOn || lk.colourOn) ? 'overridden' : 'game default', collapsed: true });
    }


    function kv(label, value) {
        return h('div', { class: 'mm-row' },
            h('div', { class: 'mm-lab', text: String(label) }),
            h('div', {
                class: 'mm-edge mm-mono mm-sub', style: 'white-space:normal;text-align:right',
                text: String(value)
            }));
    }

    /* ------------------------------------------------------------- Backlog */
    function buildBacklog() {
        if (!T.backlogAvailable()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'no backlog to read' }),
                    h('div', { text: 'start a game first — the game\'s own backlog fills as messages play' })));
        }

        var q = '';
        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '#', w: '0 0 40px', cls: 'mm-td-num' },
                { label: 'line', w: '1 1 0' }
            ],
            empty: 'nothing said yet',
            // The speaker is a prefix on the line, not a column of its own: it
            // is short, often repeats down a run of lines, and a fixed column
            // for it wastes the width the dialogue actually needs.
            render: function (r) {
                return [
                    String(r.i + 1),
                    h('span', { class: 'mm-selectable' },
                        r.speaker ? h('b', {
                            style: 'color:var(--mm-accent-hi);font-weight:400',
                            text: r.speaker + ': '
                        }) : null,
                        h('span', { text: r.text }))
                ];
            },
            onRow: function (tr, r) {
                tr.setAttribute('data-mm-tip', (r.speaker || 'System') + '|' + r.text.slice(0, 220));
            }
        });

        function rows() {
            var all = T.backlog();
            if (!q) return all;
            var needle = q.toLowerCase();
            return all.filter(function (r) {
                return r.text.toLowerCase().indexOf(needle) > -1 ||
                    (r.speaker || '').toLowerCase().indexOf(needle) > -1;
            });
        }
        function repaint() { table.mm.paint(rows()); }
        repaint();

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({
                placeholder: 'search the backlog…',
                onInput: function (v) { q = v.trim(); repaint(); }
            }),
            W.button({
                label: 'open in game', mini: true, _ungated: true,
                disabled: !T.sceneAvailable(),
                tip: 'Open|The game\'s own backlog window, opened the way the game opens it.',
                onClick: function () { T.openBacklog(); }
            }),
            W.button({
                label: 'copy all', mini: true, _ungated: true,
                tip: 'Copy|Puts everything currently listed on the clipboard.',
                onClick: function () {
                    var txt = rows().map(function (r) {
                        return (r.speaker ? r.speaker + ': ' : '') + r.text;
                    }).join('\n');
                    $.safe(function () {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(txt);
                        } else {
                            var ta = document.createElement('textarea');
                            ta.value = txt; document.body.appendChild(ta);
                            ta.select(); document.execCommand('copy');
                            document.body.removeChild(ta);
                        }
                        U.toast({ title: 'COPIED', msg: rows().length + ' lines', severity: 'ok' });
                    }, 'copy backlog');
                }
            }));

        var ad = T.backlogAdapter();
        var canUndo = !!(ad && typeof ad.restore === 'function');
        var idx = T.speakerIndex();

        var side = [
            W.group('Backlog', [
                kv('Lines kept', T.backlog().length),
                // Which colour index the game uses for a speaker header is
                // detected, not assumed — and where nothing convincing turns
                // up there is simply no split, which is worth saying because
                // it explains why every line reads as unattributed.
                kv('Speaker split', idx === null
                    ? 'none found — lines are listed as said'
                    : 'colour index ' + idx),
                T.maxLogsWritable() ? W.row('Limit', W.number({
                    value: T.maxLogs(), min: 10, max: 2000, step: 10, wide: true, label: 'Backlog limit',
                    onChange: function (v) { T.setMaxLogs(v); U.rerender(); }
                }), { tip: 'Limit|How many lines the game keeps. Lowering it trims the oldest immediately' +
                        (canUndo ? '.' : ', and this game\'s backlog cannot put them back.') }) : null,
                ad && typeof ad.clear === 'function' ? W.button({
                    label: 'clear the backlog', wide: true, variant: 'danger', mutates: true,
                    confirm: !canUndo, confirmLabel: 'clear it? (cannot be undone here)',
                    tip: 'Clear|Empties the game\'s backlog. ' +
                        (canUndo ? 'Undoable.' : 'This game\'s backlog offers no way to put lines back, ' +
                            'so this cannot be undone.'),
                    onClick: function () {
                        var n = T.clearBacklog();
                        if (n !== false) {
                            U.toast({ title: 'CLEARED', msg: n + ' lines', severity: 'ok' });
                            U.rerender();
                        }
                    }
                }) : null
            ], { tag: 'game data' })
        ];

        return cols({ narrow: true, items: side },
            [W.group('Lines', [toolbar, table], { grow: true })]);
    }


    /* =====================================================================
       INJECTING A MESSAGE, AND THE APPEARANCE OVERRIDES
       ===================================================================== */

    T.canInject = function () {
        return typeof $gameMessage !== 'undefined' && !!$gameMessage &&
            typeof $gameMessage.add === 'function';
    };

    T.injectWhy = function () {
        if (!T.canInject()) return 'no $gameMessage in this build';
        if ($.safe(function () { return $gameMessage.isBusy(); }, 'isBusy', false)) {
            return 'a message is already on screen';
        }
        if (!$.safe(function () { return SceneManager._scene instanceof Scene_Map; }, 'scene', false)) {
            return 'messages only show on the map';
        }
        return null;
    };

    /**
     * Put text on screen as though an event had said it.
     *
     * Each line is added separately because Game_Message.add is per-line — one
     * call with embedded newlines produces a single line the window then
     * clips, rather than the four the window is sized for. Four is the
     * engine's own page height; the rest are dropped here rather than silently
     * lost inside the window.
     */
    var MSG_LINES = 4;

    T.inject = function (text, opts) {
        // injectWhy(), not canInject(): the panel's disabled state is frozen at
        // build time, so by the time the button is clicked an event may have
        // started talking. Window_Message snapshots allText() on startMessage
        // and clear()s on terminate, so lines added over a live message are
        // silently discarded — and the old code toasted "SHOWN" for them.
        var why = T.injectWhy();
        if (why) return { ok: false, error: why };
        if (!$.allowWrite('show a message')) return { ok: false, error: 'read-only mode' };
        opts = opts || {};
        var lines = String(text == null ? '' : text).split('\n');
        var dropped = Math.max(0, lines.length - MSG_LINES);
        lines = lines.slice(0, MSG_LINES);
        // Every line blank still queues a page the player has to dismiss, so
        // the whole thing is tested rather than just the first line.
        if (!lines.length || !lines.join('').trim()) {
            return { ok: false, error: 'nothing to say' };
        }
        return $.safe(function () {
            // Feature-detected: only one of the two engines has a name box.
            // Where there is none the name is dropped rather than faked, and
            // the panel's field already says so.
            if (opts.speaker && $gameMessage.setSpeakerName) $gameMessage.setSpeakerName(String(opts.speaker));
            if (opts.faceName && $gameMessage.setFaceImage) {
                $gameMessage.setFaceImage(String(opts.faceName), Math.round(opts.faceIndex) || 0);
            }
            if (opts.background != null && $gameMessage.setBackground) $gameMessage.setBackground(Math.round(opts.background) || 0);
            if (opts.position != null && $gameMessage.setPositionType) $gameMessage.setPositionType(Math.round(opts.position));
            lines.forEach(function (l) { $gameMessage.add(l); });
            $.log('ok', 'message injected (' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ')');
            return { ok: true, lines: lines.length, dropped: dropped };
        }, 'inject message', { ok: false, error: 'the message could not be queued' });
    };

    /* ---------------------------------------------------------- appearance
       THE ONE ENGINE-SPECIFIC PART OF THIS FILE.

       "Override the main font" and "override the normal text colour" both need
       a single choke point that every stock window reads. Neither engine puts
       that point in the same place:

         · the font is decided by a pair of accessors that live on a global
           game object on one engine and on the window base class on the other.
           The CONSUMER differs with them — one engine's resetFontSettings reads
           the global object, the other's reads the window accessors — so there
           is exactly one correct target per engine and it is not the same
           object. $.eng.fontTarget() names it.

           The 1.x reasoning for hooking the global object was that
           resetFontSettings runs from createContents and from every drawTextEx,
           so hooking the value everyone READS is cheaper than hooking the reset
           itself. That choice simply does not exist on the engine whose only
           single point IS the window accessor — there, this hook runs once per
           createContents and once per drawTextEx rather than once per value
           read, which is still far short of per-glyph, and it is the cheapest
           point available. Neither engine is hooked at the per-draw call.

         · the colour is decided by a manager class on one engine and by
           per-window accessors on the other. $.eng.normalColorTarget() names
           the best single point: on the engine with per-window accessors that
           is the base class's own normalColor, which resetTextColor() calls, so
           it reaches every stock window. A window that calls textColor(0)
           directly still bypasses it — that is a real limit of that engine and
           is stated rather than papered over.

       Where an engine offers neither, $.install records the skip with a reason
       and the controls report it instead of appearing to work.
       ------------------------------------------------------------------ */

    function look(key, dflt) { return $.store.cfgGet('text.look.' + key, dflt); }

    var FONT_TARGET = $.safe(function () { return $.eng.fontTarget(); }, 'font target', null);
    var COLOUR_TARGET = $.safe(function () { return $.eng.normalColorTarget(); }, 'colour target', null);

    var FONT_SIZE_HOOK = (FONT_TARGET ? FONT_TARGET.size.label : 'main font size') + ' (override)';
    var FONT_FACE_HOOK = (FONT_TARGET ? FONT_TARGET.face.label : 'main font face') + ' (override)';
    var COLOUR_HOOK = (COLOUR_TARGET ? COLOUR_TARGET.label : 'normal text colour') + ' (override)';

    var FONT_WHY = 'this build has no single place where the main font is decided, so the font ' +
        'overrides would have to be applied per window and are off instead.';
    var COLOUR_WHY = 'this build has no single place where the normal text colour is decided, so the ' +
        'colour override is off rather than applied to some windows and not others.';

    $.install(FONT_SIZE_HOOK,
        FONT_TARGET ? FONT_TARGET.size.owner : null,
        FONT_TARGET ? FONT_TARGET.size.method : 'mainFontSize',
        function (original) {
            return function () {
                var v = original.apply(this, arguments);
                if (!look('sizeOn', false)) return v;
                return $.clamp(Math.round(look('size', v)) || v, 8, 72);
            };
        }, FONT_WHY);

    $.install(FONT_FACE_HOOK,
        FONT_TARGET ? FONT_TARGET.face.owner : null,
        FONT_TARGET ? FONT_TARGET.face.method : 'mainFontFace',
        function (original) {
            return function () {
                var v = original.apply(this, arguments);
                var face = String(look('face', '') || '');
                if (!look('faceOn', false) || !face) return v;
                // The engine's own value is kept as the fallback in the stack,
                // so a face that fails to load still renders as it used to
                // rather than as whatever the browser defaults to. Both engines
                // return a CSS font stack here, so appending is safe on both.
                return face + ', ' + v;
            };
        }, FONT_WHY);

    $.install(COLOUR_HOOK,
        COLOUR_TARGET ? COLOUR_TARGET.owner : null,
        COLOUR_TARGET ? COLOUR_TARGET.method : 'normalColor',
        function (original) {
            return function () {
                if (!look('colourOn', false)) return original.apply(this, arguments);
                return String(look('colour', '#ffffff'));
            };
        }, COLOUR_WHY);

    function hookOk(name) {
        var hk = $.hooks[name];
        return !!(hk && hk.installed);
    }

    T.lookAvailable = function () { return hookOk(FONT_SIZE_HOOK) && hookOk(FONT_FACE_HOOK); };
    T.lookWhy = function () {
        if (T.lookAvailable()) return null;
        var hk = $.hooks[FONT_SIZE_HOOK] || $.hooks[FONT_FACE_HOOK];
        return (hk && hk.reason) || FONT_WHY;
    };
    /** Which method the font overrides actually landed on, for the report. */
    T.lookTarget = function () { return FONT_TARGET ? FONT_TARGET.face.label : null; };

    T.colourAvailable = function () { return hookOk(COLOUR_HOOK); };
    T.colourWhy = function () {
        if (T.colourAvailable()) return null;
        var hk = $.hooks[COLOUR_HOOK];
        return (hk && hk.reason) || COLOUR_WHY;
    };
    T.colourTarget = function () { return COLOUR_TARGET ? COLOUR_TARGET.label : null; };

    /** The colour text is being drawn in right now, override included. */
    T.colourNow = function () {
        return $.safe(function () { return $.eng.normalColor(); }, 'normal colour', '#ffffff') || '#ffffff';
    };

    T.look = function () {
        return {
            sizeOn: !!look('sizeOn', false), size: look('size', 26),
            faceOn: !!look('faceOn', false), face: look('face', ''),
            colourOn: !!look('colourOn', false), colour: look('colour', '#ffffff')
        };
    };

    /**
     * Windows cache their contents bitmap, so a size change is invisible until
     * something redraws. createContents() rebuilds that bitmap and re-runs the
     * font reset on both engines, so nudging the message window is enough for
     * the one the player is looking at; the rest catch up as they open.
     */
    T.refreshWindows = function () {
        return $.safe(function () {
            var scene = SceneManager._scene;
            if (scene && scene._messageWindow && scene._messageWindow.createContents) {
                scene._messageWindow.createContents();
            }
            return true;
        }, 'refresh windows', false);
    };

    /* -------------------------------------------------------- registration */
    U.panel('game', 'Message', function () { return buildMessage(); }, 30);

    /* The Backlog panel is registered only where this game HAS a backlog.
       It is a front end for a plugin feature, so on a game without one there
       is nothing to show and nothing to explain — an empty panel offering to
       search a log that does not exist is worse than no panel.

       Registration is deferred because it cannot be decided yet: the profile
       resolves against the database, and the database has not loaded when this
       file is set up. Both events below mean "the game objects exist now", and
       U.panel replaces by name, so registering twice is harmless. */
    var backlogRegistered = false;
    function registerBacklog() {
        if (backlogRegistered || !T.backlogDeclared()) return;
        backlogRegistered = true;
        U.panel('game', 'Backlog', function () { return buildBacklog(); }, 40);
        $.log('ok', 'backlog panel registered — this game declares a backlog adapter');
    }
    $.on('mounted', function () { $.safe(registerBacklog, 'register backlog panel'); });
    $.on('gameobjects', function () { $.safe(registerBacklog, 'register backlog panel'); });

    function paintBadges() {
        U.setActive('auto-advance', !!cfg().auto);
        U.setActive('turbo', cfg().turbo !== false && held);
    }
    $.on('mounted', paintBadges);
    if (U.getHost()) paintBadges();

    $.log('ok', 'text ready — font overrides on ' + (T.lookTarget() || 'nothing (' + T.lookWhy() + ')') +
        ', colour on ' + (T.colourTarget() || 'nothing (' + T.colourWhy() + ')'));

})(window.GigaHack);
