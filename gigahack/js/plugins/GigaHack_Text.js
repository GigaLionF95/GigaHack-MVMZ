//=============================================================================
// GigaHack MV/MZ
// 17 · text.js — message speed, auto-advance, hold-to-turbo, dialogue history
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
// auto-advance, hold-to-turbo, and a searchable history of what was said.
//
// A BACKLOG IS NOT AN ENGINE FEATURE, BUT IT CAN BE RECORDED. Game_Message is
// core and generic; a scrollback of what has been said is a plugin, and a
// different one on every game that has one. So there are two sources here and
// the History panel always names the one it is showing:
//
//   the game's own — $.profile.adapter('backlog'): { available, read, clear,
//   max, setMax, open }, optionally speakerColor and restore. Nothing here
//   touches a Game_System field by name, and with no adapter this source simply
//   is not offered.
//
//   recorded here — a ring buffer this module fills from the message window as
//   pages play. It works on any game, it also holds the choices made and where
//   each line was said, and it lives only in memory.
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
 * @plugindesc GigaHack — message speed, auto-advance, turbo, dialogue history
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
       PART 2a — THE GAME'S OWN BACKLOG, THROUGH AN ADAPTER

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

       Detection scans the whole log, so it is cached against logStamp(): a
       re-derivation on every repaint of a virtual table would be the most
       expensive thing in the panel.
       ------------------------------------------------------------------ */
    var speakerCache = { key: '', index: null };

    /**
     * "Has the game's log moved" in three property reads.
     *
     * NOT raw.length. An adapter's log is a ring capped at maxLogs(), and once
     * it saturates — the steady state, not the empty one anybody tests — the
     * count is pinned forever, so a line arriving as another rolls off looks
     * like nothing happening. That is the defect HANDOFF §3 records, and it is
     * why the speaker cache and the History panel's repaint signal are both
     * this and not a count.
     *
     * Both ENDS are stamped with the count: below saturation the count moves;
     * at saturation every push changes the head as well as the tail. What it
     * cannot see is a push whose new head AND new tail are each the same
     * LENGTH as the ones they replaced — the log belongs to the game and
     * carries no revision counter to ask for instead, so the panel is as live
     * as the adapter can honestly make it and no more.
     */
    function logStamp(raw) {
        var n = raw.length;
        return n + '/' + String(raw[0] || '').length + '/' + String(raw[n - 1] || '').length;
    }

    function speakerIndex(raw) {
        var ad = backlogAdapter();
        if (ad && typeof ad.speakerColor === 'function') {
            var declared = $.safe(function () { return ad.speakerColor(); }, 'speaker colour', null);
            if (typeof declared === 'number' && declared >= 0) return declared;
        }
        /* Not raw.length alone: an adapter log is capped too, so once it saturates
           the length stops changing and the detection would freeze at whatever it
           concluded then. logStamp() carries both ends with the count. */
        var cacheKey = logStamp(raw);
        if (speakerCache.key === cacheKey) return speakerCache.index;

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
        speakerCache = { key: cacheKey, index: idx };
        return idx;
    }

    T.speakerIndex = function () {
        var ad = backlogAdapter();
        if (!ad) return null;
        return speakerIndex($.safe(function () { return ad.read() || []; }, 'backlog read', []) || []);
    };

    /**
     * The repaint signal for a panel showing the game's own backlog.
     *
     * T.backlog().length is the wrong answer twice over: it saturates with the
     * ring (see logStamp), and it is not even the raw count — backlog() drops
     * lines that strip to empty and consumes speaker headers, so a header
     * rolling off as a line arrives is invisible before saturation too. It
     * also re-strips and re-allocates the whole log to produce the number,
     * which is not what a 700ms clock should be spending.
     *
     * One ad.read(), then O(1). Empty string where there is no adapter, so a
     * panel that asks anyway simply never repaints.
     */
    T.backlogStamp = function () {
        var ad = backlogAdapter();
        if (!ad) return '';
        return logStamp($.safe(function () { return ad.read() || []; }, 'backlog read', []) || []);
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
       PART 2b — THE RECORDER: GIGAHACK'S OWN HISTORY

       Most games ship no backlog at all, so on most games the panel above had
       nothing to show. Game_Message is core, though, and so is the window that
       reads it — which means a scrollback can be RECORDED rather than borrowed.
       That is what this is: a ring buffer that every message page, every choice
       made, every number and item prompt answered and every scrolling-text
       block is copied into as it plays.

       WHERE IT LISTENS, AND WHY THERE. Window_Message.startMessage is the one
       point on both engines where a page has been assembled and not yet drawn:
       it reads $gameMessage.allText() and hands it to the text state. Every
       message reaches it — the interpreter's, a plugin's, a script call's —
       because they all end up asking the same window to show the same object.
       GigaHack loads last, so this alias sits outside any message plugin's and
       still sees the page even where the whole method was replaced.

       AND IT LISTENS AFTER, NOT BEFORE. \V[5] is a variable reference, and the
       engine resolves it exactly once, inside startMessage, into the text state.
       Capturing before that runs stores the reference instead of the number, and
       the number is then unrecoverable: the variable has moved on by the time
       anyone reads the history. So the original runs first and the CONVERTED
       text is read off the window it just filled.

       Where that window does not exist, the fallback listens to Game_Message
       itself: add() collects the lines and clear() marks the end of the page.
       That is strictly worse — it sees no conversion and no page a plugin
       renders without Game_Message — so it runs ONLY when the window hook did
       not install, and the panel says which of the two is running. The gate is
       read at call time, not at install, because Debug → Hooks can unpatch the
       window hook mid-session.

       WHAT IS NOT RECORDED, stated because a history with silent holes is worse
       than one with known ones: the battle log, which keeps its own lines and
       never touches Game_Message; any window a plugin draws from its own text
       buffer; and anything said before this module loaded. The panel says so.

       IT LIVES IN MEMORY. A save file is the game's — GigaHack_Backup takes the
       position that saves are opaque bytes belonging to other people's plugins —
       and writing to disk on every page would be the most expensive thing this
       mod does. The buffer is bounded on both axes, the panel says how much has
       rolled off the front, and anything worth keeping is exported on demand.
       ===================================================================== */

    var REC_MIN = 50, REC_MAX = 5000, REC_DEFAULT = 500;

    /* Entry count alone is not a memory bound: one add() can carry an
       arbitrarily long string, so a 500-entry cap says nothing about the bytes
       held. Each stored string is capped too, and a truncated one says so
       rather than pretending to be whole. */
    var TEXT_MAX = 4000;

    /* A speaker name is short and a line of dialogue is not. 28 characters is
       long enough for "The Mysterious Traveller" and short enough that an
       ordinary sentence ending in a colon does not qualify. */
    var NAME_MAX = 28;

    var rec = [];            // the ring buffer, oldest first
    var recSeq = 0;          // total ever recorded — numbering stays stable
    var recDropped = 0;      // how many rolled off the front
    /* Bumped by every path that changes what the buffer HOLDS, which is not the
       same question as how much has been said. A panel watching recSeq would
       never notice a clear — the total does not move when the buffer empties —
       and would go on showing lines that are gone. Watching the length is worse
       still: once the ring is full, which is the steady state, the length is
       pinned and a page rolling off looks like nothing happening at all. */
    var recRev = 0;
    var pendingLines = [];   // the fallback path's part-built page
    var pageOpen = false;    // a page is showing and has already been recorded
    var pageRaw = '';        // what that page said, for the second-start test
    var injecting = false;   // the next page is one the mod itself queued

    function histCfg() { return cfg().history || {}; }
    function histOn() { return histCfg().on !== false; }

    function histMax() {
        var v = histCfg().max;
        if (typeof v !== 'number' || v !== v) return REC_DEFAULT;
        return Math.max(REC_MIN, Math.min(REC_MAX, Math.floor(v)));
    }

    function clip(s) {
        s = String(s == null ? '' : s);
        return s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) : s;
    }

    /* The ENGINE's frame counter, which is what a player recognises as play time.
       Not $.frameCount: that is GigaHack's own, it starts at zero when the mod
       loads, and it deliberately keeps ticking while the mod holds the game. Ours
       orders and dedupes; this one is displayed. */
    function playFrames() {
        return $.safe(function () {
            return typeof Graphics !== 'undefined' && Graphics ? (Graphics.frameCount || 0) : 0;
        }, 'play frames', 0) || 0;
    }

    function mapNow() {
        return $.safe(function () {
            return (typeof $gameMap !== 'undefined' && $gameMap && $gameMap.mapId) ? $gameMap.mapId() : 0;
        }, 'map id', 0) || 0;
    }

    function inBattleNow() {
        return !!$.safe(function () {
            return typeof $gameParty !== 'undefined' && $gameParty && $gameParty.inBattle();
        }, 'in battle', false);
    }

    /** Push one record and hold the buffer to its limit. */
    function record(kind, raw, extra) {
        if (!histOn()) return null;
        var full = String(raw == null ? '' : raw);
        var r = {
            n: ++recSeq, kind: kind, raw: clip(full), conv: '',
            truncated: full.length > TEXT_MAX,
            map: mapNow(), battle: inBattleNow(),
            frame: $.frameCount || 0, play: playFrames(),
            speaker: '', face: '', origin: injecting ? 'gigahack' : 'game'
        };
        if (extra) {
            for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
        }
        r.conv = clip(r.conv);
        rec.push(r);
        var over = rec.length - histMax();
        if (over > 0) { rec.splice(0, over); recDropped += over; }
        recRev++;
        return r;
    }

    /**
     * The text the window resolved, read back off the window that drew it.
     *
     * MZ builds a text state through createTextState and MV assigns one
     * directly; a scrolling-text window on MV keeps it on _text instead. All
     * three are tried, and where none of them holds anything the raw form is
     * used and the record simply carries no converted copy — a missing
     * conversion is worth nothing, but a wrong one is worth less than nothing.
     */
    function converted(win) {
        return $.safe(function () {
            if (!win) return '';
            if (win._textState && typeof win._textState.text === 'string') return win._textState.text;
            /* NOT _text. Window_ScrollText keeps the RAW page there on both engines —
               conversion happens later, inside the draw, and is never stored — so
               reading it would present an unresolved \V[n] as though it had been
               resolved, which is worse than having no converted copy at all. */
            return '';
        }, 'converted text', '') || '';
    }

    /**
     * Record the page $gameMessage is holding, after the window has read it.
     *
     * The second-start test is not a clock. A message plugin — or a second
     * Window_Message instance built by a nameplate or preview — can start the
     * same page again, and the engine's own frame counter behaves differently
     * on the two engines and stops entirely while the mod holds the game. What
     * actually distinguishes "the same page again" from "the same line said
     * twice" is whether the page was ever closed in between, and clear() is
     * where that happens.
     */
    function capturePage(win, kind) {
        if (!histOn()) return;
        $.safe(function () {
            if (typeof $gameMessage === 'undefined' || !$gameMessage) return;
            var raw = typeof $gameMessage.allText === 'function' ? $gameMessage.allText() : '';
            if (!raw) return;
            if (pageOpen && raw === pageRaw) return;
            pageOpen = true;
            pageRaw = raw;
            record(kind || 'say', raw, {
                conv: converted(win),
                // Feature-detected, never asked of the engine name: a name box
                // is MZ's by default, and an MV plugin that adds one adds
                // exactly this method. An empty name is absent, not a speaker.
                speaker: typeof $gameMessage.speakerName === 'function'
                    ? String($gameMessage.speakerName() || '') : '',
                face: typeof $gameMessage.faceName === 'function'
                    ? String($gameMessage.faceName() || '') : ''
            });
        }, 'capture message page');
    }

    /* Set around T.inject so a page the mod itself queued is labelled as one.
       The flag is one-shot: the very next capture consumes it. */
    T._markInjected = function () { injecting = true; };

    /* ------------------------------------------------------------- capture */

    var HOOK_WINDOW = 'Window_Message.startMessage (history)';
    var HOOK_ADD = 'Game_Message.add (history fallback)';
    var HOOK_CLEAR = 'Game_Message.clear (history page end)';
    var HOOK_CHOICE = 'Game_Message.onChoice (history)';
    var HOOK_NUMBER = 'Game_Message.onNumberInput (history)';
    var HOOK_ITEM = 'Game_Message.onItemChoice (history)';
    var HOOK_SCROLL = 'Window_ScrollText.startMessage (history)';

    $.install(HOOK_WINDOW,
        typeof Window_Message !== 'undefined' ? Window_Message.prototype : null, 'startMessage',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                capturePage(this, 'say');
                injecting = false;
                return r;
            };
        }, 'Window_Message is absent — the history falls back to Game_Message');

    function windowHooked() { return !!($.hooks[HOOK_WINDOW] && $.hooks[HOOK_WINDOW].installed); }

    /* The fallback's line collector. It installs unconditionally so the pair is
       listed in Debug → Hooks either way, and does nothing while the window
       hook is doing the job — one live source, never two. */
    $.install(HOOK_ADD,
        typeof Game_Message !== 'undefined' ? Game_Message.prototype : null, 'add',
        function (original) {
            return function (text) {
                if (!windowHooked() && histOn()) pendingLines.push(String(text == null ? '' : text));
                return original.apply(this, arguments);
            };
        }, 'Game_Message.add is absent');

    /* clear() is the end of a page on BOTH paths: the fallback flushes what it
       collected, and the primary path uses it as the close that lets the same
       text be recorded again later. */
    $.install(HOOK_CLEAR,
        typeof Game_Message !== 'undefined' ? Game_Message.prototype : null, 'clear',
        function (original) {
            return function () {
                var self = this;
                $.safe(function () {
                    /* The engine's own initialize() calls clear(), so this fires
                       once from the constructor with $gameMessage still pointing
                       at the PREVIOUS object. Flushing there would push a
                       half-built page into the wrong playthrough. */
                    var current = typeof $gameMessage !== 'undefined' && self === $gameMessage;
                    if (pendingLines.length && current) {
                        var speaker = typeof self.speakerName === 'function'
                            ? String(self.speakerName() || '') : '';
                        record('say', pendingLines.join('\n'), { speaker: speaker });
                    }
                    if (current) { pendingLines = []; pageOpen = false; pageRaw = ''; }
                }, 'history page end');
                return original.apply(this, arguments);
            };
        }, 'Game_Message.clear is absent');

    /* What the player answered is the half of a conversation a message log never
       holds, and it is usually the half worth going back for. All three prompts
       are feature-detected separately so each degrades on its own. */
    $.install(HOOK_CHOICE,
        typeof Game_Message !== 'undefined' ? Game_Message.prototype : null, 'onChoice',
        function (original) {
            return function (n) {
                var self = this;
                $.safe(function () {
                    // A private field, so it is guarded rather than assumed: a
                    // choice plugin may keep the list somewhere else entirely,
                    // and the index alone is still worth recording.
                    var list = (self._choices || []).slice();
                    var ok = n >= 0 && n < list.length;
                    record('choice', ok ? String(list[n]) : '', {
                        choices: list, pick: n, cancelled: n < 0
                    });
                }, 'record choice');
                return original.apply(this, arguments);
            };
        }, 'Game_Message.onChoice is absent — choices will not appear in the history');

    $.install(HOOK_NUMBER,
        typeof Game_Message !== 'undefined' ? Game_Message.prototype : null, 'onNumberInput',
        function (original) {
            return function (n) {
                $.safe(function () { record('number', String(n)); }, 'record number input');
                return original.apply(this, arguments);
            };
        }, 'Game_Message.onNumberInput is absent — number prompts will not appear');

    $.install(HOOK_ITEM,
        typeof Game_Message !== 'undefined' ? Game_Message.prototype : null, 'onItemChoice',
        function (original) {
            return function (id) {
                $.safe(function () {
                    // Resolved now, not at render: the database can be reloaded,
                    // and an id in a history nobody can read is not a record.
                    var item = id && typeof $dataItems !== 'undefined' && $dataItems ? $dataItems[id] : null;
                    record('item', id ? ((item && item.name) || 'item ' + id) : '', { cancelled: !id });
                }, 'record item choice');
                return original.apply(this, arguments);
            };
        }, 'Game_Message.onItemChoice is absent — item prompts will not appear');

    $.install(HOOK_SCROLL,
        typeof Window_ScrollText !== 'undefined' ? Window_ScrollText.prototype : null, 'startMessage',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                capturePage(this, 'scroll');
                return r;
            };
        }, 'this build has no scrolling-text window');

    /* A new game and a loaded save both rebuild every $game object, and either
       makes what came before a different playthrough. The buffer is not thrown
       away for it — the line before the break is often exactly what you
       reloaded to re-read — but the break is marked, and the half-built page is
       dropped because its remaining lines are never coming. */
    $.on('gameobjects', function () {
        pendingLines = [];
        pageOpen = false;
        pageRaw = '';
        if (rec.length) record('break', '');
    });

    /* --------------------------------------------------------- reading back */

    /**
     * Is the "Name:" opener a convention in THIS game, or a coincidence.
     *
     * One page opening `Warning:` above `the bridge is out` is not a speaker
     * convention, and treating it as one deletes the word Warning from the
     * history — the silent failure this codebase exists to avoid. So the rule
     * is detected rather than assumed, exactly as the adapter path detects its
     * colour index: it applies only once enough pages agree, and never at all
     * where the engine hands over a real name.
     *
     * Scanning is cached against the buffer length. The buffer only grows at
     * the end, and a virtual table repaints far more often than it grows.
     */
    /* Keyed on the total ever recorded, not on the buffer length: once the ring is
       full, length is pinned at the maximum and never changes again, so a length key
       stops invalidating at exactly the point the log is big enough for the detection
       to matter. The switch is part of the key too — leaving it out let a cached split
       survive the toggle being turned off, and half the list stayed split. */
    var conventionCache = { key: '', on: false };

    function firstLineName(raw) {
        var lines = String(raw).split('\n');
        if (lines.length < 2) return null;
        var head = plain(lines[0]);
        var rest = plain(lines.slice(1).join('\n'));
        if (!rest || !head || head.length > NAME_MAX || !/:$/.test(head)) return null;
        return { speaker: head.replace(/:+$/, '').trim(), text: rest };
    }

    function conventionHolds() {
        var allow = histCfg().splitFirstLine !== false;
        var key = recSeq + '/' + rec.length + '/' + (allow ? 1 : 0);
        if (conventionCache.key === key) return conventionCache.on;
        if (!allow) { conventionCache = { key: key, on: false }; return false; }
        var pages = 0, hits = 0, i;
        for (i = 0; i < rec.length; i++) {
            if (rec[i].kind !== 'say' || rec[i].speaker) continue;
            pages++;
            if (firstLineName(rec[i].raw)) hits++;
        }
        /* Three pages is a habit; one is a label. A fifth of the pages is the
           floor for calling it the game's convention rather than a handful of
           warnings that happen to be punctuated the same way. */
        var on = hits >= 3 && hits >= pages * 0.2;
        conventionCache = { key: key, on: on };
        return on;
    }

    /** Split a recorded page into a speaker and what they said. */
    function splitSpeaker(r) {
        var body = plain(r.conv || r.raw);
        if (r.speaker) return { speaker: r.speaker, text: body };
        if (!conventionHolds()) return { speaker: '', text: body };
        var m = firstLineName(r.conv || r.raw);
        return m || { speaker: '', text: body };
    }

    /** Which of the three ways a name is being found, for the panel to state. */
    function speakerMode() {
        var i;
        for (i = 0; i < rec.length; i++) {
            if (rec[i].kind === 'say' && rec[i].speaker) return 'the name box';
        }
        if (conventionHolds()) return 'a "Name:" opener';
        return 'none found';
    }

    /* plain() walks the whole string and a virtual list repaints on every
       scroll frame, so the display form is derived once and kept on the record.
       The buffer only ever grows at the end; the one thing that can change
       underneath it is the speaker convention turning on, which drops the
       cache. */
    function view(r) {
        /* Asked FIRST, because it is what refreshes the cache the memo compares
           against. Testing r._vc against a stale conventionCache.on returned the
           previous answer forever, so turning the convention off left every row
           that had already been read back still split. */
        var conv = conventionHolds();
        if (r._v && r._vc === conv) return r._v;
        var v;
        if (r.kind === 'break') {
            v = { speaker: '', text: 'a new game was started, or a save was loaded' };
        } else if (r.kind === 'choice') {
            v = {
                speaker: 'you', text: r.cancelled ? 'cancelled the choice'
                    : 'chose "' + plain(r.raw) + '"' +
                        (r.choices && r.choices.length > 1 ? ' of ' + r.choices.length : '')
            };
        } else if (r.kind === 'number') {
            v = { speaker: 'you', text: 'entered ' + plain(r.raw) };
        } else if (r.kind === 'item') {
            v = { speaker: 'you', text: r.cancelled ? 'chose no item' : 'chose ' + plain(r.raw) };
        } else {
            v = splitSpeaker(r);
        }
        v.text = v.text.replace(/\n+/g, ' ');
        /* An icon-only or pause-only page strips to nothing. Dropping the row would
           leave the list disagreeing with "Pages kept" and there would be no gap to
           notice, because the number beside each line is its position, not its id. */
        if (!v.text && r.kind !== 'break') v.text = '(control codes only — nothing said)';
        v.text += (r.truncated ? ' …(truncated)' : '');
        v.find = (v.speaker + ' ' + v.text).toLowerCase();
        r._v = v;
        r._vc = conv;
        return v;
    }

    T.history = {
        /** Is the recorder listening. */
        on: function () { return histOn(); },
        setOn: function (v) {
            $.store.cfgSet('text.history.on', !!v);
            if (!v) { pendingLines = []; pageOpen = false; pageRaw = ''; }
            return true;
        },

        /** Did anything install — i.e. can this build be recorded at all. */
        installed: function () {
            return windowHooked() ||
                !!($.hooks[HOOK_ADD] && $.hooks[HOOK_ADD].installed &&
                    $.hooks[HOOK_CLEAR] && $.hooks[HOOK_CLEAR].installed);
        },

        /** Which seam is live, in words, for the panel to show. */
        source: function () {
            if (windowHooked()) return 'the message window';
            if (T.history.installed()) return 'Game_Message (fallback)';
            return 'nothing';
        },

        why: function () {
            if (T.history.installed()) return '';
            var hk = $.hooks[HOOK_WINDOW];
            return (hk && hk.reason) || 'no message window and no Game_Message in this build';
        },

        /** Everything this recorder cannot see, named rather than left as a gap. */
        blindSpots: function () {
            var out = [];
            if (!windowHooked()) {
                out.push('the fallback sees no variable or name substitution — \\V[n] is stored unresolved');
            }
            out.push('the battle log, which keeps its own lines and never uses Game_Message');
            if ($.hooks[HOOK_SCROLL] && $.hooks[HOOK_SCROLL].installed) {
                out.push('what \\V[n] and \\N[n] resolved to in scrolling text — that window ' +
                    'keeps the page unconverted, so those lines hold the reference, not the value');
            }
            if (!($.hooks[HOOK_SCROLL] && $.hooks[HOOK_SCROLL].installed)) {
                out.push('scrolling text — ' + (($.hooks[HOOK_SCROLL] || {}).reason || 'no window for it'));
            }
            out.push('anything said before GigaHack loaded');
            return out;
        },

        hookNames: function () {
            return [HOOK_WINDOW, HOOK_ADD, HOOK_CLEAR, HOOK_CHOICE, HOOK_NUMBER, HOOK_ITEM, HOOK_SCROLL];
        },

        /** The records, oldest first, in display form. */
        lines: function () {
            var out = [], i, v;
            for (i = 0; i < rec.length; i++) {
                v = view(rec[i]);
                out.push({
                    i: out.length, n: rec[i].n, kind: rec[i].kind,
                    speaker: v.speaker, text: v.text, find: v.find,
                    map: rec[i].map, battle: rec[i].battle,
                    frame: rec[i].frame, play: rec[i].play,
                    origin: rec[i].origin, raw: rec[i].raw
                });
            }
            return out;
        },

        count: function () { return rec.length; },
        dropped: function () { return recDropped; },

        /** Changes whenever the buffer's CONTENTS change — the live panels' signal. */
        revision: function () { return recRev; },

        speakerMode: speakerMode,

        max: function () { return histMax(); },
        setMax: function (n) {
            var v = Math.max(REC_MIN, Math.min(REC_MAX, Math.floor(n)));
            $.store.cfgSet('text.history.max', v);
            var over = rec.length - v;
            if (over > 0) { rec.splice(0, over); recDropped += over; recRev++; }
            return v;
        },

        /** Empty it. Undoable — nothing outside this buffer is touched. */
        clear: function () {
            var before = rec.slice(), droppedBefore = recDropped;
            if (!before.length) return 0;
            rec = [];
            pendingLines = [];
            pageOpen = false;
            pageRaw = '';
            conventionCache = { key: -1, on: false };
            recRev++;
            $.undo.push('cleared ' + before.length + ' recorded lines', function () {
                rec = before.slice();
                recDropped = droppedBefore;
                conventionCache = { key: -1, on: false };
                recRev++;
            });
            return before.length;
        },

        /** Plain text, oldest first — what both copy and export hand over. */
        asText: function (rows) {
            var list = rows || T.history.lines();
            return list.map(function (r) {
                if (r.kind === 'break') return '\n--- ' + r.text + ' ---\n';
                return (r.speaker ? r.speaker + ': ' : '') + r.text;
            }).join('\n');
        }
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
                spec.tip || (spec.label + '|The game\'s own option. The Options menu changes ' +
                    'the same switch.'));
        });

        var speed = W.group('The game\'s own options',
            optionRows.length ? optionRows
                : [unavailable('this build adds no options of its own')],
            { tag: optionRows.length
                ? (optionSpecs[0].declared ? 'from the profile' : 'discovered')
                : 'none' });

        var autoRows = [
            W.toggleRow('Auto-advance', W.ungated({
                value: !!cfg().auto, disabled: !!why,
                tip: 'Auto-advance|Stops at a choice, number prompt or item prompt.',
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
            }), {  }),
            W.toggleRow('Hold to turbo', W.ungated({
                value: cfg().turbo !== false, disabled: !!why,
                tip: 'Turbo|Instant text while held. Releases at every choice.',
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
            }), { tip: 'Turbo key|Matched on KeyboardEvent.code — never enters the game\'s ' +
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
                'Behaves exactly like an event’s own text.')
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
            }), { tip: 'Font|Prepended to the game’s own stack, so a font that fails to load falls ' +
                      'back to the game’s.' }),
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
                text: 'The override sits on this engine\'s text-colour reset, so it reaches ' +
                    'every stock window — a window that asks for colour index 0 directly ' +
                    'bypasses it.'
            }) : null
        ], { tag: (lk.sizeOn || lk.faceOn || lk.colourOn) ? 'overridden' : 'game default', collapsed: true });
    }


    function kv(label, value) {
        return h('div', { class: 'mm-row' },
            h('div', { class: 'mm-lab', text: String(label) }),
            // The value is unbounded — a path, a project's own name for
            // something, a joined list — so the edge is allowed to shrink and
            // wrap. Without that it pushes the label out and is then clipped
            // by the column, and neither half can be read.
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall',
                text: String(value)
            }));
    }

    /* ------------------------------------------------------------- History */

    /* Two possible sources, and the panel always names the one it is showing.
       They are two different logs, not two views of one: the game's own
       survives a reload and is what its own scene draws, while GigaHack's also
       carries the choices made, the map each line was said on, and the breaks
       between one playthrough and the next. Where the game has no backlog —
       which is most games — there is only ours and no selector at all. */
    var SRC_MOD = 'recorded here', SRC_GAME = 'the game\'s own';

    function historySources() {
        var out = [SRC_MOD];
        if (T.backlogDeclared()) out.push(SRC_GAME);
        return out;
    }

    /* With no stored choice, prefer the game's own where it exists AND has
       something in it: that log is saved into the savefile, so on a game that
       keeps one it usually holds hundreds of lines from before GigaHack was
       ever installed, and it is what the game's own backlog scene shows. Ours
       starts empty at every launch. */
    function historySource() {
        var have = historySources();
        var want = histCfg().source;
        if (have.indexOf(want) > -1) return want;
        if (have.indexOf(SRC_GAME) > -1 && T.backlogAvailable()) return SRC_GAME;
        return SRC_MOD;
    }
    T.historySource = historySource;

    function mapLabel(id) {
        if (!id) return '';
        return $.safe(function () {
            return $.map && $.map.mapName ? $.map.mapName(id) : '';
        }, 'history map name', '') || '';
    }

    /** h:mm:ss of play time, from the ENGINE frame count at the moment it was said. */
    function clockLabel(frame) {
        var s = Math.floor((frame || 0) / 60);
        var h2 = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        return h2 + ':' + (m < 10 ? '0' : '') + m + ':' + ((s % 60) < 10 ? '0' : '') + (s % 60);
    }

    /* Held outside the builder: every control in the sidebar calls U.rerender(),
       which rebuilds the whole panel body, and a search you had typed vanishing
       because you moved a slider reads as the panel losing your place. */
    var histQ = '', histKindPref = 'everything';

    function buildHistory() {
        var src = historySource();
        var mine = src === SRC_MOD;
        /* Assigned by sideRecorded(), read by the live repaint. The count and
           the list have to move together or they disagree, which is the same
           defect a dropped empty row produced: a number saying one thing and a
           list showing another, with no gap anywhere to notice. */
        var keptEl = null;
        /* The same field on the other source's side panel, for the same
           reason. Two different cells because the two logs count different
           things: ours counts records including the ones that stripped to
           nothing, the game's counts the rows it will show. */
        var linesKeptEl = null;
        function keptText() {
            var lost = T.history.dropped();
            return T.history.count() + (lost ? '  (' + lost + ' rolled off)' : '');
        }

        /* The one case where the panel has nothing at all to offer: our own
           recorder could not install AND this game has no backlog either. It
           says which hook failed rather than looking like an empty log. */
        if (mine && !T.history.installed()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'nothing is being recorded' }),
                    h('div', { text: T.history.why() }),
                    h('div', { text: 'Debug → Hooks lists every alias and why each one was skipped.' })));
        }

        var KINDS = ['everything', 'dialogue', 'answers'];

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '#', w: '0 0 40px', cls: 'mm-td-num' },
                { label: 'line', w: '1 1 0' }
            ],
            empty: mine ? 'nothing said yet — the history fills as messages play'
                : 'nothing said yet',
            // The speaker is a prefix on the line, not a column of its own: it
            // is short, often repeats down a run of lines, and a fixed column
            // for it wastes the width the dialogue actually needs.
            render: function (r) {
                if (r.kind === 'break') {
                    return ['', h('span', {
                        class: 'mm-sub mm-selectable', style: 'font-style:italic', text: r.text
                    })];
                }
                return [
                    // The record's own number, not its position: a filter renumbers a
                    // position and two lines then look like the same one.
                    String(r.n || (r.i + 1)),
                    h('span', { class: 'mm-selectable' },
                        r.speaker ? h('b', {
                            style: 'color:var(--mm-accent-hi);font-weight:400',
                            text: r.speaker + ': '
                        }) : null,
                        h('span', { text: r.text }))
                ];
            },
            onRow: function (tr, r) {
                var head = r.kind === 'break' ? 'Break' : (r.speaker || 'System');
                if (mine) {
                    // In a fight the map id is the map you LEFT, so it is not
                    // shown as a place — saying "in battle" is the true answer.
                    head += r.battle ? ' · in battle'
                        : (r.map ? ' · ' + mapLabel(r.map) : '');
                    if (r.play) head += ' · ' + clockLabel(r.play);
                    if (r.origin === 'gigahack') head += ' · shown by GigaHack';
                }
                tr.setAttribute('data-mm-tip', head + '|' + r.text.slice(0, 220));
            }
        });

        function all() { return mine ? T.history.lines() : T.backlog(); }

        var ANSWERS = { choice: 1, number: 1, item: 1 };

        function rows() {
            /* The kind filter belongs to the recorder: only its records carry a kind,
               and its dropdown is not even rendered for the game's own log. Applying a
               remembered filter across a source switch emptied the list with no visible
               cause and an empty state that said "nothing said yet". */
            var histKind = mine ? histKindPref : 'everything';
            var list = all();
            if (histKind === 'dialogue') {
                list = list.filter(function (r) { return !r.kind || r.kind === 'say' || r.kind === 'scroll'; });
            } else if (histKind === 'answers') {
                list = list.filter(function (r) { return ANSWERS[r.kind] === 1; });
            }
            if (!histQ) return list;
            // The searchable form is folded once, when the record is first
            // viewed, rather than per keystroke per row.
            var needle = histQ.toLowerCase();
            return list.filter(function (r) {
                return (r.find || (r.speaker + ' ' + r.text).toLowerCase()).indexOf(needle) > -1;
            });
        }
        /* Following the tail is the whole behaviour of an append-only log: a
           reader sitting at the bottom wants to stay there as lines arrive, and
           a reader who scrolled up to find something wants to be left exactly
           where they are. "At the bottom" is measured with a few pixels of
           slack, because a fractional row height leaves a remainder that no
           scroll ever closes and a strict test would then never follow at all. */
        var TAIL_SLACK = 4;
        function atTail() {
            var b = table.mm.body;
            if (!b || !b.clientHeight) return true;      // nothing to scroll yet
            return b.scrollHeight - b.scrollTop - b.clientHeight <= TAIL_SLACK;
        }
        function repaint(follow) {
            var tail = follow && atTail();
            table.mm.paint(rows());
            if (!tail) return;
            var b = table.mm.body;
            b.scrollTop = b.scrollHeight;
            // paint() restored the offset it had before; moving it afterwards
            // leaves the virtual window rendered for the old one.
            table.mm.refresh();
        }
        repaint();

        function asText(list) {
            return mine ? T.history.asText(list) : list.map(function (r) {
                return (r.speaker ? r.speaker + ': ' : '') + r.text;
            }).join('\n');
        }

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({
                placeholder: 'search what was said…',
                value: histQ,
                onInput: function (v) { histQ = v.trim(); repaint(); }
            }),
            mine ? W.dropdown({
                options: KINDS, value: histKindPref, width: '104px', _ungated: true,
                onChange: function (v) { histKindPref = v; repaint(); }
            }) : null,
            historySources().length > 1 ? W.dropdown({
                options: historySources(), value: src, width: '128px', _ungated: true,
                tip: 'Source|Two different logs. The game’s survives a reload; this one also holds ' +
                    'choices and where each line was said.',
                onChange: function (v) { $.store.cfgSet('text.history.source', v); U.rerender(); }
            }) : null,
            W.button({
                label: 'copy', mini: true, _ungated: true,
                onClick: function () {
                    var list = rows();
                    if (U.copyText(asText(list))) {
                        U.toast({ title: 'COPIED', msg: list.length + ' lines', severity: 'ok' });
                    } else {
                        U.toast({ title: 'NO CLIPBOARD', msg: 'this build offers none', severity: 'warn' });
                    }
                }
            }),
            mine ? W.button({
                label: 'export', mini: true, _ungated: true,
                tip: 'Export|Writes what is listed beside the settings file.',
                onClick: function () {
                    var list = rows();
                    var ok = $.store.write('history.json', {
                        source: src, at: clockLabel($.frameCount || 0), count: list.length,
                        lines: list.map(function (r) {
                            return { n: r.n, kind: r.kind || 'say', speaker: r.speaker,
                                text: r.text, map: r.map || 0 };
                        })
                    });
                    U.toast(ok
                        ? { title: 'EXPORTED', msg: list.length + ' lines to history.json', severity: 'ok' }
                        : { title: 'NOT WRITTEN', msg: 'the log names the path that failed', severity: 'warn' });
                }
            }) : null,
            !mine && T.sceneAvailable() ? W.button({
                label: 'open in game', mini: true, _ungated: true,
                onClick: function () { T.openBacklog(); }
            }) : null);

        var side = mine ? sideRecorded() : sideAdapter();

        /* The list is the one panel in the mod that fills itself while it is
           being read: a history opened before a conversation used to show
           nothing of it, and looked broken rather than stale. The signal is the
           recorder's revision, not its total — see the note beside recRev — and
           the repaint is the same call a keystroke in the search box already
           makes, so the filter, the search text and the source selector are
           honoured by construction rather than by a second code path.

           The game's own backlog gets the same treatment through
           T.backlogStamp(), which is what the recorder's revision is for a log
           we do not own: NOT the row count, which is pinned the moment the
           game's ring saturates and costs a strip of every line to ask for.
           Where there is no adapter the panel is simply not live and nothing
           pretends otherwise. */
        if (mine) {
            U.live(function () { return T.history.revision(); }, function () {
                repaint(true);
                if (keptEl) keptEl.textContent = keptText();
            }, {
                name: 'dialogue history', within: table,
                when: function () { return !table.mm.isScrolling(); }
            });
        } else if (T.backlogAvailable()) {
            U.live(T.backlogStamp, function () {
                repaint(true);
                // The count beside the list is derived from the same log, so
                // leaving it behind would put two answers to one question on
                // the same screen — the defect this whole file is against.
                if (linesKeptEl) linesKeptEl.textContent = String(T.backlog().length);
            }, {
                name: 'the game’s backlog', within: table,
                when: function () { return !table.mm.isScrolling(); }
            });
        }

        return cols({ narrow: true, items: side },
            [W.group('Lines', [toolbar, table], { grow: true })]);

        /* --------------------------------------------- the recorder's side */
        function sideRecorded() {
            keptEl = h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall',
                text: keptText()
            });
            var kept = T.history.count();
            return [
                W.group('Recording', [
                    W.toggleRow('Record what is said', {
                        value: T.history.on(), _ungated: true,
                        tip: 'Record|Off from now on. What is already here stays.',
                        onChange: function (v) { T.history.setOn(v); U.rerender(); }
                    }),
                    W.row('Listening to', h('span', { class: 'mm-sub mm-mono', text: T.history.source() }), {
                        tip: 'Listening to|The message window sees the text the engine resolved. ' +
                            'The fallback sees only what was queued.'
                    }),
                    W.row('Speaker from', h('span', { class: 'mm-sub mm-mono', text: T.history.speakerMode() }), {
                        tip: 'Speaker from|A name box where the build has one, otherwise a "Name:" ' +
                            'opener once enough pages use one. Detected, never assumed.'
                    }),
                    h('div', { class: 'mm-row' },
                        h('div', { class: 'mm-lab', text: 'Pages kept' }), keptEl),
                    W.row('Keep', W.number({
                        value: T.history.max(), min: REC_MIN, max: REC_MAX, step: 50, wide: true,
                        label: 'History size', _ungated: true,
                        onChange: function (v) { T.history.setMax(v); U.rerender(); }
                    }), { tip: 'Keep|Pages held in memory. Lowering it drops the oldest now.' }),
                    W.toggleRow('Split "Name:" openers', {
                        value: histCfg().splitFirstLine !== false, _ungated: true,
                        tip: 'Convention|The only source of a name where there is no name box. ' +
                            'Applied only once enough pages agree.',
                        onChange: function (v) {
                            $.store.cfgSet('text.history.splitFirstLine', !!v);
                            U.rerender();
                        }
                    }),
                    W.button({
                        label: 'clear the history', wide: true, variant: 'danger', _ungated: true,
                        tip: 'Clear|Undoable — nothing outside this buffer is touched.',
                        disabled: !kept,
                        onClick: function () {
                            var n = T.history.clear();
                            U.toast({ title: 'CLEARED', msg: n + ' lines', severity: 'ok' });
                            U.rerender();
                        }
                    })
                ], { tag: 'in memory' }),
                /* A log with unmarked holes is worse than one with named holes:
                   someone who fights, opens this and sees nothing will conclude
                   the recorder is broken. */
                W.group('Not recorded', T.history.blindSpots().map(function (b) {
                    return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px', text: b });
                }), { collapsed: true })
            ];
        }

        /* ------------------------------------------ the game's backlog side */
        function sideAdapter() {
            var ad = T.backlogAdapter();
            var canUndo = !!(ad && typeof ad.restore === 'function');
            var idx = T.speakerIndex();
            var keptRow = kv('Lines kept', T.backlog().length);
            linesKeptEl = keptRow.lastChild;
            return [
                W.group('The game’s backlog', [
                    keptRow,
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
                    }), { tip: 'Limit|Lowering it trims the oldest now' +
                            (canUndo ? '.' : ', and this game cannot put them back.') }) : null,
                    ad && typeof ad.clear === 'function' ? W.button({
                        label: 'clear the backlog', wide: true, variant: 'danger', mutates: true,
                        confirm: !canUndo, confirmLabel: 'clear it? (cannot be undone here)',
                        tip: canUndo ? 'Clear|Undoable.'
                            : 'Clear|This game offers no way to put lines back.',
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
        }
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
            // So the history can tell what the game said from what we did.
            T._markInjected();
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

    /* History is registered unconditionally, because GigaHack now records one
       itself and there is therefore always something to show — or, where not
       even Game_Message could be reached, a panel that names the hook that
       failed. That is the opposite of the 1.x rule, and deliberately: back then
       the panel was a front end for a feature the game either had or did not. */
    U.panel('game', 'History', function () { return buildHistory(); }, 40);

    function paintBadges() {
        U.setActive('auto-advance', !!cfg().auto);
        U.setActive('turbo', cfg().turbo !== false && held);
    }
    $.on('mounted', paintBadges);
    if (U.getHost()) paintBadges();

    $.log('ok', 'text ready — font overrides on ' + (T.lookTarget() || 'nothing (' + T.lookWhy() + ')') +
        ', colour on ' + (T.colourTarget() || 'nothing (' + T.colourWhy() + ')'));

})(window.GigaHack);
