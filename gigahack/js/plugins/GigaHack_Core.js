//=============================================================================
// GigaHack MV/MZ
// 00 · core.js — namespace, safe-call wrapper, logger, layout + path resolution
//-----------------------------------------------------------------------------
// This file must load before every other GigaHack_*.js.
//
// Unlike the Star Knightess edition this is descended from, nothing here
// assumes a particular install layout. The mod may be delivered three ways:
//
//   js/plugins/GigaHack_Core.js                    — plain, appended to plugins.js
//   www/js/plugins/GigaHack_Core.js                — MV/MZ web-deploy layout
//   mods/<Name>/js/plugins/GigaHack_Core.js        — a third-party mod loader
//
// resolvePaths() detects which of those it is by walking up from its own
// script URL until it finds a directory that looks like a game root, rather
// than counting a fixed number of levels. Counting levels is what broke when
// the same code met the second layout.
//
// It also decides WHETHER the mod may keep its files outside the game folder
// at all. That answer is the player's, it is recorded beside the game, and it
// is read here — before the first writability probe — because the probe
// creates the directory it tests. Up to 2.1.0 the application-data folder
// existed on disk before any part of the mod could ask about it.
//
// Nothing else in the mod may reach the shared area on its own: $.paths names
// the three locations, the answer says which of them is in use, and every
// consumer already re-reads $.paths at call time.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — core (namespace, logger, layout, paths)
 * @author gigahack
 *
 * @help GigaHack_Core.js
 *
 * Must load before every other GigaHack_*.js file. Exposes window.GigaHack.
 *
 * Works on RPG Maker MV 1.6+ and MZ 1.0+. MV 1.6 ships NW.js 0.29 on
 * Chromium 66, which is the floor the overlay stylesheet is written to;
 * older MV is progressively worse and is not supported. Engine differences
 * are resolved by
 * GigaHack_Caps.js, which loads immediately after this file; nothing in the
 * mod branches on a version string.
 */

window.GigaHack = window.GigaHack || {};

(function ($) {
    'use strict';

    /* ---------------------------------------------------------------------
       Identity
       ------------------------------------------------------------------ */
    $.version  = '2.2.0';
    $.codename = 'GigaHack';

    /* Filled in by Profile once $dataSystem is loaded. Until then the mod has
       no idea what game it is in, and must not pretend otherwise. */
    $.gameTitle = null;

    /* ---------------------------------------------------------------------
       Public surface
       ------------------------------------------------------------------ */
    $.paths          = {};   // resolved directories + platform flags
    $.env            = {};   // Node/NW.js detection results
    $.caps           = {};   // engine capability table (populated by caps.js)
    $.cfg            = {};   // loaded settings (populated by store.js)
    $.ui             = {};   // overlay controller (populated by ui.js / shell.js)
    $.hooks          = {};   // registry of installed aliases, by name
    $.registry       = [];   // per-frame text draw registry
    $.recentVarReads = [];   // ring buffer of variable IDs read this frame
    $.api            = {};   // feature functions, callable from the console tab

    /* ---------------------------------------------------------------------
       Logger
       Buffers until the log drawer exists, then flushes into it. Every entry
       also mirrors to the devtools console with a stable prefix so the log is
       recoverable even if the overlay itself fails to mount.
       ------------------------------------------------------------------ */
    var LEVELS = { info: 1, ok: 1, warn: 1, err: 1 };
    var buffer = [];

    /* The log is a DELIVERABLE — it is what a bug report pastes, and the boot
       report at the front of it is the half that says which build, which game
       and which layout. At 400 the ring was small enough that a long session
       pushed those lines out, and it did so SILENTLY, which is the one thing
       this project does not do to itself.

       Two changes. The ring is large enough that a real session does not reach
       it, and when it does roll it says how much it dropped instead of leaving
       a log that merely starts in the middle. */
    var MAX_BUFFER = 4000;
    var dropped = 0;

    $.logSink = null; // set by the shell once the drawer exists

    $.log = function (level, msg) {
        if (!LEVELS[level]) { msg = level; level = 'info'; }
        var text = String(msg);
        var entry = { level: level, msg: text, t: Date.now() };
        buffer.push(entry);
        if (buffer.length > MAX_BUFFER) { buffer.shift(); dropped++; }
        try {
            var tag = '[GigaHack]';
            if (level === 'err') console.error(tag, text);
            else if (level === 'warn') console.warn(tag, text);
            else console.log(tag, text);
        } catch (e) { /* console unavailable — ignore */ }
        if ($.logSink) { try { $.logSink(level, text); } catch (e) { } }
        return entry;
    };

    $.logHistory = function () { return buffer.slice(); };

    /* How many entries the ring holds, without copying it.
       A live panel asks this every 700ms only to find out that nothing has
       changed; logHistory() would allocate a copy of up to 4000 entries to
       answer the same question. */
    $.logCount = function () { return buffer.length; };

    /** How many lines have rolled off the front, and how many the ring holds. */
    $.logDropped = function () { return dropped; };
    $.logCapacity = function () { return MAX_BUFFER; };

    /* ---------------------------------------------------------------------
       safe() — never let a feature crash the game.
       Returns the callback's value, or `fallback` when it threw.
       ------------------------------------------------------------------ */
    $.safe = function (fn, label, fallback) {
        try {
            return fn();
        } catch (e) {
            $.log('err', (label || 'unlabelled') + ' — ' + (e && e.message ? e.message : e));
            try { console.error('[GigaHack]', label, e); } catch (e2) { }
            return fallback;
        }
    };

    /* Wrap a function so every call is guarded. Preserves `this` + arguments. */
    $.safeWrap = function (fn, label, fallback) {
        return function () {
            var self = this, args = arguments;
            return $.safe(function () { return fn.apply(self, args); }, label, fallback);
        };
    };

    /* ---------------------------------------------------------------------
       Feature detection + hook registry

       Every alias goes through install() so that:
         · a missing target disables the dependent feature with a stated
           reason instead of throwing at load time;
         · the Debug tab can list what is patched and unpatch it at runtime;
         · Compat can snapshot alias identity and notice when a plugin that
           loaded after us patches on top.

       install() never replaces a method wholesale. The factory receives the
       original and is expected to call it.
       ------------------------------------------------------------------ */
    $.canHook = function (owner, method) {
        return !!(owner && typeof owner[method] === 'function');
    };

    /**
     * install('Scene_Map.updateCallMenu', Scene_Map.prototype, 'updateCallMenu',
     *         function (original) { return function () { ... }; })
     * Returns true when installed, false when the target was missing.
     */
    $.install = function (name, owner, method, factory, reason) {
        if (!$.canHook(owner, method)) {
            $.hooks[name] = { name: name, installed: false, reason: reason || (method + ' not found') };
            $.log('warn', 'Hook skipped: ' + name + ' — ' + $.hooks[name].reason);
            return false;
        }
        var original = owner[method];
        var replacement;
        try {
            replacement = factory(original);
        } catch (e) {
            $.hooks[name] = { name: name, installed: false, reason: 'factory threw: ' + e.message };
            $.log('err', 'Hook factory failed: ' + name + ' — ' + e.message);
            return false;
        }
        owner[method] = replacement;
        $.hooks[name] = {
            name: name, installed: true, owner: owner, method: method,
            original: original, patched: replacement,
            unpatch: function () {
                if (owner[method] !== replacement) return false; // someone patched on top of us
                owner[method] = original;
                $.hooks[name].installed = false;
                $.log('warn', 'Hook removed: ' + name);
                return true;
            }
        };
        return true;
    };

    $.hookList = function () {
        return Object.keys($.hooks).map(function (k) { return $.hooks[k]; });
    };

    /* ---------------------------------------------------------------------
       Tiny event bus — used to decouple tabs from the shell.
       ------------------------------------------------------------------ */
    var subs = {};
    $.on = function (evt, fn) { (subs[evt] = subs[evt] || []).push(fn); return fn; };
    $.off = function (evt, fn) {
        if (!subs[evt]) return;
        var i = subs[evt].indexOf(fn);
        if (i > -1) subs[evt].splice(i, 1);
    };
    $.emit = function (evt, payload) {
        if (!subs[evt]) return;
        subs[evt].slice().forEach(function (fn) {
            $.safe(function () { fn(payload); }, 'event ' + evt);
        });
    };

    /* ---------------------------------------------------------------------
       Environment detection (Node / NW.js availability, platform)
       Engine capabilities live in caps.js; this is only about the host.
       ------------------------------------------------------------------ */
    function detectEnv() {
        var env = {
            nwjs: false, fs: null, path: null, os: null, proc: null,
            platform: 'unknown', mac: false, win: false, linux: false
        };
        try {
            // Both engines declare Utils as `function Utils() { throw ... }`,
            // so `typeof Utils === 'object'` is false on every real game and
            // this used to fall through to the manual check every time. The
            // manual check happens to agree, which is why it went unnoticed —
            // but it means the engine's own answer was never consulted.
            env.nwjs = (typeof Utils !== 'undefined' && Utils && typeof Utils.isNwjs === 'function')
                ? Utils.isNwjs()
                : (typeof require === 'function' && typeof process === 'object');
        } catch (e) { env.nwjs = false; }
        if (env.nwjs) {
            try {
                env.fs = require('fs');
                env.path = require('path');
                env.os = require('os');
                /* The host process object, carried so that path resolution is
                   a function of its inputs. It reads exactly two things off
                   it — mainModule.filename and env.LOCALAPPDATA — and holding
                   the reference here is what lets a check hand the resolver a
                   modelled host instead of the real one. `require` itself is
                   still deliberately not exposed: NW.js can switch node
                   integration off per window, so anything wanting the loader
                   must re-derive it and cope with its absence. */
                env.proc = process;
                env.platform = process.platform;
                env.mac = process.platform === 'darwin';
                env.win = process.platform === 'win32';
                env.linux = process.platform === 'linux';
            } catch (e) {
                env.nwjs = false;
                env.fs = env.path = env.os = env.proc = null;
            }
        }
        return env;
    }

    /* ---------------------------------------------------------------------
       Path + layout resolution

       The anchor is the URL of this script, because that is correct on a
       Windows folder build, inside a macOS .app bundle, and under a mod
       loader alike. From there we walk UP looking for a game root rather
       than counting levels, because the number of levels is exactly what
       differs between the three supported layouts.

       A directory is a game root when it contains index.html, or when it
       contains both js/ and data/. Both tests are needed: a web deploy may
       have index.html one level above www/, and some repacked macOS bundles
       drop index.html beside js/ and data/ with no www/ at all (A New Dawn
       is one of these, and its own package.json still points at www/).

       ---- The storage answer, and why it lives in this function ----------

       Up to and including 2.1.0 this function picked the per-user
       application-data folder first and nobody was asked. Worse than the
       choice: isWritable() creates the directory it tests and writes a probe
       file into it, so the folder existed on disk before any UI could exist
       to ask about it. "GigaHack made a folder in my Application Support
       without asking" is the complaint the gate is here to prevent, and a
       gate anywhere above this function would gate the CONTENT of that folder
       and not its creation.

       So the answer is read here, before the first probe, and it decides
       which candidates are probed at all. The three locations are computed
       always, because a panel has to be able to print them; not one of the
       shared ones is touched — not existsSync, not mkdirSync, not the write
       probe — until the answer is 'granted'.

       The one read outside the game folder that survives, on every answer, is
       the walk upward looking for a game root: it reads the install's own
       parent directories and it is how the game root is found at all. It
       creates nothing and it never looks in the application-data area.

       Dropped in 2.2.0: ~/Documents/GigaHack/<key>, which was tried on macOS
       when Application Support refused. There are three named locations now
       and a fourth that nobody can predict is worse than the game folder,
       which is where a refused shared write lands instead.
       ------------------------------------------------------------------ */
    var SELF_URL = (document.currentScript && document.currentScript.src) || '';

    /* The folder name under the application-data area. A literal, and it stays
       one: it names a directory that already exists on people's disks, so
       deriving it from anything that could change would strand their settings
       the first time that thing changed. */
    var APP_DIR = 'GigaHack';
    var CONSENT_FILE = 'consent.json';
    var COMMON_KEY = '_shared';

    /* Every helper below takes `env` instead of reading $.env, and
       resolvePaths takes env plus an options bag. That is not ceremony. The
       whole per-game guarantee is "nothing outside the game folder is touched
       while the answer is unasked", and the only way to prove it is to run
       the production function against a filesystem a check can watch. A
       test-only copy of this logic would prove something about the copy.
       $.pathsFor / $.usePaths below are that seam. */

    function urlToFsPath(url) {
        if (!url) return null;
        if (url.indexOf('file://') !== 0) return null;
        var p = decodeURIComponent(url.slice('file://'.length));
        // file:///C:/x -> /C:/x ; strip the leading slash on Windows drive paths
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
        return p;
    }

    function dirUp(env, p, n) {
        var path = env.path;
        for (var i = 0; i < n; i++) p = path ? path.dirname(p) : p.replace(/[\/\\][^\/\\]*$/, '');
        return p;
    }

    function looksLikeGameRoot(env, dir) {
        var fs = env.fs, path = env.path;
        if (!fs || !path || !dir) return false;
        try {
            if (fs.existsSync(path.join(dir, 'index.html'))) return true;
            return fs.existsSync(path.join(dir, 'js')) && fs.existsSync(path.join(dir, 'data'));
        } catch (e) { return false; }
    }

    /**
     * DESTRUCTIVE, and every call site says so.
     *
     * It creates the directory and writes a probe file into it, which is what
     * makes it a truthful answer to "can we write here" and the wrong thing to
     * point at a directory nobody has agreed to. It is called on a shared
     * candidate only when the stored answer is already 'granted'.
     */
    function isWritable(env, dir) {
        var fs = env.fs, path = env.path;
        if (!fs || !path) return false;
        try {
            fs.mkdirSync(dir, { recursive: true });
            var probe = path.join(dir, '.gigahack-write-probe');
            fs.writeFileSync(probe, 'ok');
            fs.unlinkSync(probe);
            return true;
        } catch (e) {
            return false;
        }
    }

    /* A filesystem-safe key for this game, used to name its directory under
       the shared root and to keep two games' settings apart when they share a
       fallback data directory.

       It is the game root's basename and nothing more, and it is NOT refined
       later: $dataSystem is not loaded when this runs, and no module rewrites
       it afterwards. The comment here used to promise that Profile sharpened
       it once the title was known. Profile has never touched it. Two installs
       of the same game in identically-named folders therefore produce the same
       key, which is why anything that must not collide uses p.gameId instead. */
    function keyFromPath(p) {
        if (!p) return 'unknown';
        var base = String(p).replace(/[\/\\]+$/, '').split(/[\/\\]/).pop() || 'game';
        return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'game';
    }

    /* An 8-hex-character digest of a string: FNV-1a, 32 bits, all shifts so it
       stays inside what the floor's integer arithmetic does exactly.

       It is a DISAMBIGUATOR, not a checksum, and nothing may present it as one.
       It exists so that two copies of one game in identically-named folders get
       different storage keys, which is a real case: gameKey is a basename. */
    function hash8(s) {
        var h = 0x811c9dc5, i;
        s = String(s === null || s === undefined ? '' : s);
        for (i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return ('0000000' + h.toString(16)).slice(-8);
    }

    /* <appdata>/GigaHack, or null when there is no home directory to hang it
       off. No home means there is no shared area at all, which is a reason to
       say the question is moot rather than to invent a location. */
    function sharedRootFor(env, home) {
        var path = env.path, proc = env.proc, local = null;
        if (!path || !home) return null;
        if (env.mac) return path.join(home, 'Library', 'Application Support', APP_DIR);
        if (env.win) {
            try { local = (proc && proc.env) ? proc.env.LOCALAPPDATA : null; } catch (e) { local = null; }
            return path.join(local || path.join(home, 'AppData', 'Local'), APP_DIR);
        }
        return path.join(home, '.local', 'share', APP_DIR);
    }

    /* Is `child` inside `parent`? Used for p.outsideGameFolder, which is the
       field that means what fallbackUsed's name suggests and fallbackUsed does
       not. path.relative is the only test that survives a trailing slash, a
       case difference the platform does not care about, and a sibling
       directory whose name starts with the parent's. */
    function isInside(env, parent, child) {
        var path = env.path, rel;
        if (!path || !parent || !child) return false;
        try { rel = path.relative(path.resolve(parent), path.resolve(child)); } catch (e) { return false; }
        if (rel === null || rel === undefined) return false;
        rel = String(rel);
        if (rel === '') return true;
        return rel.indexOf('..') !== 0 && rel.charAt(0) !== '/' && rel.charAt(0) !== '\\' &&
            !/^[A-Za-z]:/.test(rel);
    }

    /* ---------------------------------------------------------------------
       The answer

       'granted'  — may read and write the shared folder
       'declined' — may not; everything stays beside the game
       'unasked'  — has not been asked; behaves exactly like declined until it is
       'moot'     — there is nothing outside the game folder to reach, so there
                    is no question worth asking

       It is written BESIDE THE GAME, in <localDir>/consent.json, and that is
       the whole of the per-game guarantee. A registry keyed by game inside the
       shared folder would put every game's answer in one file, and one bad
       merge there spreads a yes to games nobody asked about. A file in the
       game's own folder cannot reach another game.

       Fallbacks, in order, when that file cannot be written:
         1. localStorage under gigahack:consent:<gameId> — KEYED BY GAME,
            because NW.js can share one storage profile between two games whose
            package.json carries the same name, and an unkeyed answer would
            then be exactly the spread this design exists to prevent;
         2. memory, which means the question is asked again next launch and the
            panel says so.

       Reading tries all three in that order regardless of whether the game
       folder is writable. Reading an answer is not the same act as choosing
       where to write one, and a game folder that turned read-only after the
       answer was given should not lose it.
       ------------------------------------------------------------------ */
    var ANSWERS = { granted: 1, declined: 1, unasked: 1, moot: 1 };
    var memoryConsent = {};    // gameId -> record, when nothing else will hold it
    var consentDeferred = {};  // gameId -> true, "ask me again next launch"

    function lsConsentKey(gameId) { return 'gigahack:consent:' + gameId; }

    function validRecord(rec) {
        if (!rec || typeof rec !== 'object') return null;
        if (!ANSWERS[rec.answer] || rec.answer === 'moot') return null;
        return rec;
    }

    /* Is a record found beside the game an answer about THIS game?

       The per-game guarantee holds for copying the MOD — a file beside one game
       cannot reach another. It did not hold for copying the GAME, which is the
       ordinary way to keep a vanilla install beside a modded one: the copy
       carries consent.json inside it, and a bare "is this well-formed" test
       reads the original's yes as the copy's, under a storage key the record
       itself says is not its own.

       $.setConsent has always stamped gameKey and gameRoot into the record for
       exactly this, and nothing read them. A record that carries NEITHER is
       accepted: it was written by a build that did not stamp, and there is
       nothing to compare it against. One that carries a stamp must match, and a
       mismatch is not an error — it is an unanswered question, which behaves
       exactly as a refusal until somebody answers it here. A game folder that
       was moved rather than copied lands here too, and asking again is the safe
       direction for both. */
    function recordIsForThisGame(env, p, rec) {
        var path = env.path, a, b;
        if (!rec.gameRoot && !rec.gameKey) return true;
        if (rec.gameKey && p.gameKey && rec.gameKey !== p.gameKey) return false;
        if (rec.gameRoot && p.gameRoot && path) {
            a = $.safe(function () { return path.resolve(rec.gameRoot); },
                'resolve the recorded game root', String(rec.gameRoot));
            b = $.safe(function () { return path.resolve(p.gameRoot); },
                'resolve this game root', String(p.gameRoot));
            if (a !== b) return false;
        }
        return true;
    }

    /* Notes from here are said once, not once per reader. $.consentRecord()
       re-reads the record on every render of the Storage panel, and a note
       pushed on each of those grows $.paths.notes without bound — the boot
       report and the panel both print that list whole. */
    function note(p, text) {
        if (p.notes.indexOf(text) < 0) p.notes.push(text);
        return text;
    }

    function readConsentRecord(env, p) {
        var fs = env.fs, path = env.path, rec = null, raw;

        if (fs && path && p.localDir) {
            try {
                var file = path.join(p.localDir, CONSENT_FILE);
                if (fs.existsSync(file)) {
                    raw = fs.readFileSync(file, 'utf8');
                    rec = validRecord(JSON.parse(raw));
                    if (!rec) {
                        note(p, 'The storage answer beside the game (' + file + ') is not one this ' +
                            'build understands, so it is being asked again. Settings → Storage answers it.');
                    } else if (!recordIsForThisGame(env, p, rec)) {
                        note(p, 'The storage answer in ' + file + ' was recorded for ' +
                            (rec.gameRoot || rec.gameKey) + ' and this game is ' +
                            (p.gameRoot || p.gameKey) + ', so it is not this game\'s answer and is not ' +
                            'being used: copying a game folder copies the answer inside it, and an ' +
                            'answer given for one game is not one for another. Nothing outside this ' +
                            'game folder is read or created until the question is answered here. ' +
                            'Settings → Storage answers it.');
                    } else {
                        rec._from = 'file'; rec._where = file; return rec;
                    }
                }
            } catch (e) {
                note(p, 'The storage answer beside the game could not be read (' + e.message +
                    '), so it is being asked again. Settings → Storage answers it.');
            }
        }

        if (p.gameId) {
            try {
                if (typeof localStorage !== 'undefined') {
                    raw = localStorage.getItem(lsConsentKey(p.gameId));
                    if (raw) {
                        rec = validRecord(JSON.parse(raw));
                        if (rec) { rec._from = 'localStorage'; rec._where = lsConsentKey(p.gameId); return rec; }
                    }
                }
            } catch (e) { /* a storage that refuses to be read is an unanswered question */ }

            rec = validRecord(memoryConsent[p.gameId]);
            if (rec) { rec._from = 'memory'; rec._where = 'memory'; return rec; }
        }

        return null;
    }

    function writeConsentRecord(env, p, rec) {
        var fs = env.fs, path = env.path, file;

        if (fs && path && p.localDir) {
            try {
                fs.mkdirSync(p.localDir, { recursive: true });
                file = path.join(p.localDir, CONSENT_FILE);
                fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8');
                return { ok: true, from: 'file', where: file };
            } catch (e) {
                $.log('warn', 'the storage answer could not be written beside the game (' + e.message +
                    '), so it is being kept where it can be: it will not travel to another game either way.');
            }
        }

        if (p.gameId) {
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(lsConsentKey(p.gameId), JSON.stringify(rec));
                    return { ok: true, from: 'localStorage', where: lsConsentKey(p.gameId) };
                }
            } catch (e) { /* fall through to memory */ }
            memoryConsent[p.gameId] = rec;
            return {
                ok: true, from: 'memory', where: 'memory',
                why: 'nothing on this build would hold the answer past the window closing, so the ' +
                    'question is asked again next launch.'
            };
        }

        return { ok: false, from: null, where: null, why: 'there is no game to record an answer for.' };
    }

    /**
     * Resolve every path from an environment and an options bag, and nothing
     * else. The only free variable left is the script URL, and opts.selfUrl
     * overrides that.
     *
     *   opts.selfUrl  the script URL to anchor on (default: this file's)
     *   opts.probe    the writability probe. Default is isWritable, which
     *                 CREATES the directory it tests; pass false for a
     *                 resolution that touches nothing at all, which is what a
     *                 panel wants when it is only printing the locations.
     *   opts.consent  force an answer instead of reading one. For checks that
     *                 are about what an answer DOES, not about where it lives.
     */
    function resolvePaths(env, opts) {
        env = env || {};
        opts = opts || {};
        var path = env.path;
        var selfUrl = (opts.selfUrl === undefined || opts.selfUrl === null) ? SELF_URL : opts.selfUrl;
        var probe = (opts.probe === false) ? null
            : (typeof opts.probe === 'function' ? opts.probe : isWritable);
        var p = {
            platform: env.platform || 'unknown',
            mode: 'memory',          // 'fs' | 'localStorage' | 'memory'
            layout: 'unknown',       // 'plain' | 'www' | 'modloader'
            selfUrl: selfUrl,
            selfFile: null,
            pluginsDir: null,        // the directory this file sits in
            modRoot: null,           // the mod's own root, when it has one
            gameRoot: null,          // folder containing index.html / js / data
            dataDir: null,           // where settings.json etc. actually land
            backupsDir: null,
            localDir: null,          // beside the game; needs no permission
            sharedRoot: null,        // <appdata>/GigaHack
            sharedDir: null,         // <appdata>/GigaHack/<gameKey>
            sharedCommonDir: null,   // <appdata>/GigaHack/_shared
            gameKey: 'unknown',
            gameId: null,
            consent: 'moot',
            consentFrom: null,
            consentWhy: '',
            consentAsked: 0,
            outsideGameFolder: false,
            fallbackUsed: false,
            notes: []
        };

        if (!env.nwjs || !path) {
            p.mode = (typeof localStorage !== 'undefined') ? 'localStorage' : 'memory';
            p.notes.push('Node APIs unavailable (browser build) — persistence degraded to ' + p.mode + '.');
            p.consent = 'moot';
            p.consentWhy = 'there is no filesystem on this build, so there is nothing outside the game ' +
                'folder to reach and nothing to ask about. Settings live in ' + p.mode + '.';
            // The layout is still worth guessing from the URL for diagnostics.
            if (selfUrl.indexOf('/mods/') > -1) p.layout = 'modloader';
            else if (selfUrl.indexOf('/www/js/') > -1) p.layout = 'www';
            else if (selfUrl) p.layout = 'plain';
            return p;
        }

        p.selfFile = urlToFsPath(selfUrl);
        if (!p.selfFile) {
            p.notes.push('Could not resolve this script to a filesystem path from ' + (selfUrl || '(no currentScript)') + '.');
        } else {
            p.pluginsDir = dirUp(env, p.selfFile, 1);

            // Walk up, at most six levels, looking for a game root. Six covers
            // the deepest supported layout (mods/<Name>/js/plugins) with room
            // to spare, and stops well before reaching the filesystem root.
            var dir = p.pluginsDir, hops = 0;
            while (dir && hops < 6) {
                if (looksLikeGameRoot(env, dir)) { p.gameRoot = dir; break; }
                var next = dirUp(env, dir, 1);
                if (next === dir) break;   // reached the volume root
                dir = next; hops++;
            }
        }

        // Cross-check against the engine's own idea of the game root. On MV and
        // MZ alike process.mainModule.filename is the index.html the game booted
        // from, so its directory is authoritative when the walk disagrees.
        var mainRoot = null;
        try {
            mainRoot = path.dirname(env.proc.mainModule.filename);
        } catch (e) {
            p.notes.push('process.mainModule unavailable: ' + e.message);
        }
        if (!p.gameRoot && mainRoot) {
            p.gameRoot = mainRoot;
            p.notes.push('Game root taken from process.mainModule; the walk up from this script found none.');
        } else if (p.gameRoot && mainRoot && path.resolve(p.gameRoot) !== path.resolve(mainRoot)) {
            // Not necessarily wrong — a mod loader can live outside the root —
            // but it is always worth saying out loud.
            p.notes.push('Script-relative game root (' + p.gameRoot +
                ') differs from process.mainModule (' + mainRoot + '); using the script-relative one.');
        }

        // Classify the layout from the resolved pair.
        if (p.pluginsDir && p.gameRoot) {
            var rel = path.relative(p.gameRoot, p.pluginsDir).split(path.sep).join('/');
            if (rel === 'js/plugins') {
                p.layout = 'plain';
                p.modRoot = p.gameRoot;
            } else if (rel === 'www/js/plugins') {
                p.layout = 'www';
                p.modRoot = path.join(p.gameRoot, 'www');
            } else if (/^mods\//.test(rel)) {
                p.layout = 'modloader';
                p.modRoot = dirUp(env, p.pluginsDir, 2);   // plugins → js → <mod root>
            } else {
                p.layout = 'plain';
                p.modRoot = dirUp(env, p.pluginsDir, 2);
                p.notes.push('Unrecognised layout: this script sits at "' + rel + '" relative to the game root.');
            }
        }

        p.gameKey = keyFromPath(p.gameRoot);

        /* A game whose folder is literally named _shared would be given the
           same directory as the cross-game area, and one person's settings
           would quietly become everyone's. Two lines, and the alternative is
           unrecoverable. */
        if (p.gameKey === COMMON_KEY) {
            p.gameKey = COMMON_KEY + '-game';
            p.notes.push('This game\'s folder is named "' + COMMON_KEY + '", which is the name the ' +
                'cross-game area uses. Its storage key is "' + p.gameKey + '" so the two cannot merge.');
        }

        /* gameKey names a directory that already exists on people's disks, so
           it stays a basename. gameId is for keys that must not collide, and
           two games in identically-named folders is a real case rather than a
           theoretical one. */
        if (p.gameRoot) {
            p.gameId = p.gameKey + '-' + hash8($.safe(function () { return path.resolve(p.gameRoot); },
                'resolve game root', p.gameRoot));
        }

        /* ---- The three locations. Computed always, touched selectively ---- */
        if (p.layout === 'modloader' && p.modRoot) {
            // A mod-loader install owns a folder of its own, so keeping
            // userdata inside it means uninstalling is "delete one folder".
            p.localDir = path.join(p.modRoot, 'userdata');
        } else if (p.gameRoot) {
            p.localDir = path.join(p.gameRoot, 'gigahack-userdata');
        }

        var home = null;
        try { home = env.os.homedir(); } catch (e) { home = null; }
        p.sharedRoot = sharedRootFor(env, home);
        if (p.sharedRoot) {
            p.sharedDir = path.join(p.sharedRoot, p.gameKey);
            p.sharedCommonDir = path.join(p.sharedRoot, COMMON_KEY);
        }

        /* ---- The answer, before the first probe ---- */
        if (opts.consent && ANSWERS[opts.consent]) {
            p.consent = opts.consent;
            p.consentFrom = 'injected';
        } else if (!p.sharedRoot) {
            p.consent = 'moot';
            p.consentWhy = 'there is no home directory here, so there is no shared area to reach and ' +
                'nothing to ask about. Everything stays beside the game.';
        } else {
            var rec = readConsentRecord(env, p);
            if (rec) {
                p.consent = rec.answer;
                p.consentFrom = rec._from;
                p.consentAsked = Number(rec.asked) || 0;
            } else {
                p.consent = 'unasked';
                p.consentFrom = null;
            }
        }
        if (!p.consentWhy) {
            if (p.consent === 'granted') {
                p.consentWhy = 'you allowed GigaHack to use a folder of its own outside the game.';
            } else if (p.consent === 'declined') {
                p.consentWhy = 'you asked GigaHack to keep everything beside the game. Nothing outside ' +
                    'the game folder is read or written. Settings → Storage changes the answer.';
            } else if (p.consent === 'unasked') {
                p.consentWhy = 'GigaHack has not asked yet, and until it does it behaves exactly as if ' +
                    'you had declined: nothing outside the game folder is read, written or created.';
            }
        }

        /* ---- Where user data lands ----

           The answer decides, and nothing else. A plain install does not own a
           folder of its own — writing into the game's js/plugins would scatter
           our files among the game's, and a game update that replaces that
           directory would take them with it — which is the argument for the
           shared folder and is not an argument for taking it without asking. */
        var candidates = [];
        if (p.consent === 'granted' && p.sharedDir) candidates.push(p.sharedDir);
        if (p.localDir) candidates.push(p.localDir);

        for (var i = 0; i < candidates.length && probe; i++) {
            if (probe(env, candidates[i])) {
                p.dataDir = candidates[i];
                p.mode = 'fs';
                /* Literally "the preferred candidate for this layout was not
                   writable", and nothing more. It is NOT "we are outside the
                   game folder": p.outsideGameFolder is the field that means
                   that, and on 2.1.0 this flag was false in exactly the case
                   its readers took it to describe. */
                p.fallbackUsed = i > 0;
                break;
            }
        }

        if (p.mode !== 'fs') {
            p.mode = (typeof localStorage !== 'undefined') ? 'localStorage' : 'memory';
            if (!probe) {
                p.notes.push('Paths were resolved without probing anything, so no directory was chosen ' +
                    'or created. This is an inspection, not the live resolution.');
            } else if (p.consent === 'granted') {
                p.notes.push('Neither the shared folder nor the game folder could be written to — ' +
                    'persistence degraded to ' + p.mode + '.');
            } else if (p.localDir) {
                /* Both halves of the reason, in one sentence, because either
                   half alone sends the reader to fix the wrong thing. */
                p.notes.push('The game folder is not writable, and the shared folder needs an answer ' +
                    'that has not been given (' + p.consent + ') — persistence degraded to ' + p.mode +
                    '. Settings → Storage asks the question.');
            } else {
                p.notes.push('No writable directory found among ' + candidates.length +
                    ' candidates — persistence degraded to ' + p.mode + '.');
            }
        } else {
            p.backupsDir = path.join(p.dataDir, 'backups');
            p.outsideGameFolder = !isInside(env, p.gameRoot, p.dataDir);
        }
        return p;
    }

    /* The shape returned when resolution throws. It carries every field the
       real one does: a fallback that omits half of them turns one failure into
       a second, different failure in whichever module reads the missing key. */
    function fallbackPaths() {
        return {
            platform: 'unknown', mode: 'memory', layout: 'unknown',
            selfUrl: SELF_URL, selfFile: null, pluginsDir: null, modRoot: null,
            gameRoot: null, dataDir: null, backupsDir: null,
            localDir: null, sharedRoot: null, sharedDir: null, sharedCommonDir: null,
            gameKey: 'unknown', gameId: null,
            consent: 'moot', consentFrom: null, consentAsked: 0,
            consentWhy: 'path resolution threw, so nothing is known about where anything lives.',
            outsideGameFolder: false, fallbackUsed: false,
            notes: ['path resolution threw']
        };
    }

    /* ---------------------------------------------------------------------
       The paths seam

       $.pathsFor(env, opts)  the production resolution, safe-wrapped
       $.usePaths(p, env)     swap the live pair, get the restore back
       $.paths.recompute(env) re-run and install

       recompute is defined NON-ENUMERABLE deliberately: $.paths is read whole
       and serialised by the boot report, the module manifest and the test
       harness, and a function property in the middle of that is a value none
       of them can carry.
       ------------------------------------------------------------------ */
    $.pathsFor = function (env, opts) {
        return $.safe(function () { return resolvePaths(env || $.env, opts); },
            'path resolution', fallbackPaths());
    };

    function installPaths(p) {
        try {
            Object.defineProperty(p, 'recompute', {
                value: function (env, opts) { return installPaths($.pathsFor(env || $.env, opts)); },
                enumerable: false, writable: true, configurable: true
            });
        } catch (e) { p.recompute = function (env, opts) { return installPaths($.pathsFor(env || $.env, opts)); }; }
        $.paths = p;
        return p;
    }

    /**
     * Swap $.paths, and $.env with it when one is given. Returns the function
     * that puts both back; a check that swaps must restore in the same check,
     * because everything after it reads $.paths.mode.
     *
     * $.env travels with the paths for a reason the harness already learned
     * once: a mount that moved only the paths left every write resolving
     * against the wrong filesystem, and every one of them "succeeded" by never
     * writing anything at all.
     */
    $.usePaths = function (p, env) {
        var wasPaths = $.paths, wasEnv = $.env;
        installPaths(p);
        if (env) $.env = env;
        return function () {
            installPaths(wasPaths);
            $.env = wasEnv;
            return true;
        };
    };

    /* ---------------------------------------------------------------------
       Answering the question
       ------------------------------------------------------------------ */

    /** The stored record, or null when there is none. Never reads the shared folder. */
    $.consentRecord = function () {
        return $.safe(function () { return readConsentRecord($.env, $.paths); }, 'read storage answer', null);
    };

    /** True when the player asked to be left alone for this launch only. */
    $.consentDeferred = function () {
        var id = $.paths.gameId;
        return !!(id && consentDeferred[id]);
    };

    /**
     * Record the answer beside the game and re-resolve the paths from it.
     *
     * Answering 'unasked' is the third button — "ask again next launch". It is
     * still written, because the count of times the question has been put is
     * worth knowing, and the card is suppressed for this launch through a
     * session flag rather than by pretending an answer was given.
     *
     * Returns {ok, answer, from, where, dataDir, was, why}. It does NOT move
     * any data: that is store.moveTo, which flushes first and copies rather
     * than overwrites, and which the panel offers as a separate act.
     */
    $.setConsent = function (answer, opts) {
        opts = opts || {};
        var p = $.paths, was = p.dataDir, prev = $.consentRecord();

        if (!ANSWERS[answer] || answer === 'moot') {
            return { ok: false, answer: p.consent, dataDir: was, was: was,
                why: '"' + answer + '" is not an answer: it is one of granted, declined or unasked.' };
        }
        if (p.consent === 'moot') {
            return { ok: false, answer: 'moot', dataDir: was, was: was, why: p.consentWhy };
        }

        var rec = {
            answer: answer,
            at: 'f' + (typeof $.frameCount === 'number' ? $.frameCount : 0) + ' ' + new Date().toISOString(),
            version: $.version,
            gameKey: p.gameKey,
            gameRoot: p.gameRoot || null,
            asked: ((prev && Number(prev.asked)) || 0) + 1
        };

        var w = writeConsentRecord($.env, p, rec);
        if (opts.defer && p.gameId) consentDeferred[p.gameId] = true;

        if ($.store && $.store.flush) $.safe(function () { $.store.flush(); }, 'flush before the answer');
        /* Re-resolved from the CURRENT anchor rather than from this file's own
           script URL. In production the two are the same string; they are not
           when a check has swapped the paths, and re-reading the module-level
           one there would resolve a different game than the one just answered. */
        var next = installPaths($.pathsFor($.env, { selfUrl: p.selfUrl }));
        if ($.store && $.store.retry) $.safe(function () { $.store.retry(); }, 'clear write latches');

        $.log('ok', 'storage answer "' + answer + '" recorded in ' + (w.where || 'nowhere') +
            '; settings now live in ' + (next.dataDir || next.mode) + '.');
        if (w.why) $.log('warn', w.why);
        if (was && next.dataDir && was !== next.dataDir) {
            $.log('warn', 'the data directory moved from ' + was + ' to ' + next.dataDir +
                '. Nothing was copied: Settings → Storage offers the move, which copies and never deletes.');
        }
        $.emit('paths:changed', { was: was, now: next.dataDir, why: 'storage answer: ' + answer });
        return { ok: !!w.ok, answer: next.consent, from: next.consentFrom, where: w.where,
            dataDir: next.dataDir, was: was, why: w.why || '' };
    };

    /**
     * Point persistence at a different directory, in one place.
     *
     * mode, dataDir and backupsDir move TOGETHER. Backup prefers the cached
     * backupsDir over dataDir and is the only module that does, so moving
     * dataDir alone keeps writing save backups — the one thing a player cannot
     * regenerate — under the directory that was just abandoned, with nothing
     * anywhere saying so. Pending debounced writes are committed first, or the
     * last slider drag lands in the directory being left; the give-up latches
     * are cleared afterwards, or a file that failed against the old directory
     * stays refused for the session with no new log line.
     */
    $.relocateData = function (dir, why) {
        var p = $.paths, path = $.env.path, was = p.dataDir;
        if (!dir || !path) return { ok: false, was: was, now: was, why: 'no directory to move to.' };
        if ($.store && $.store.flush) $.safe(function () { $.store.flush(); }, 'flush before relocate');
        p.dataDir = dir;
        p.mode = 'fs';
        p.backupsDir = path.join(dir, 'backups');
        p.outsideGameFolder = !isInside($.env, p.gameRoot, dir);
        p.notes.push('The data directory moved to ' + dir + ' — ' + (why || 'no reason given') + '.');
        if ($.store && $.store.retry) $.safe(function () { $.store.retry(); }, 'clear write latches');
        $.log('ok', 'data directory: ' + was + ' → ' + dir + ' (' + (why || 'no reason given') + ')');
        $.emit('paths:changed', { was: was, now: dir, why: why || '' });
        return { ok: true, was: was, now: dir, why: why || '' };
    };

    /* ---------------------------------------------------------------------
       Misc helpers shared by every module
       ------------------------------------------------------------------ */
    $.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

    /**
     * Structural clone for plain JSON-ish values.
     *
     * RegExp, Date and functions are passed through BY REFERENCE rather than
     * walked. Walking them produces `{}` — a truthy object with none of the
     * methods the caller is about to invoke, which fails at the call site
     * rather than here and is correspondingly hard to trace. A game profile
     * carries a RegExp (the section-header pattern) and adapter objects full
     * of functions through exactly this path.
     */
    $.clone = function (v) {
        if (v === null || typeof v !== 'object') return v;
        if (v instanceof RegExp || v instanceof Date) return v;
        if (Array.isArray(v)) return v.map($.clone);
        var out = {}, k;
        for (k in v) out[k] = $.clone(v[k]);
        return out;
    };

    /**
     * Merge `over` onto `base`, deeply.
     *
     * Two properties this needs and the obvious implementation gets wrong:
     *   · `undefined` in `over` means "absent, take the default"; an explicit
     *     `null` means "the user really did clear this" and must win. Without
     *     the distinction, clearing a hotkey silently resurrects it on the
     *     next launch.
     *   · The result must not share any object with `base`, or $.cfg ends up
     *     aliasing the defaults table and every settings change corrupts it.
     */
    $.deepMerge = function (base, over) {
        if (over === undefined) return $.clone(base);
        if (over === null) return null;
        // Non-plain objects are values, not trees. Merging into a RegExp or a
        // Date produces neither; take the override whole, or keep the base.
        if (over instanceof RegExp || over instanceof Date) return over;
        if (base instanceof RegExp || base instanceof Date) {
            return (typeof over === 'object' && !Array.isArray(over)) ? base : $.clone(over);
        }
        if (typeof base !== 'object' || base === null || Array.isArray(base)) return $.clone(over);
        if (typeof over !== 'object' || Array.isArray(over)) return $.clone(over);
        var out = {}, k;
        for (k in base) out[k] = $.clone(base[k]);
        for (k in over) out[k] = $.deepMerge(base[k], over[k]);
        return out;
    };

    $.stamp = function () {
        var d = new Date(), p = function (n, w) { return String(n).padStart(w || 2, '0'); };
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
            p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    };

    /* Human-readable summary used by the Debug tab and the boot log.

       Both storage locations are named in full, on every answer, because "what
       would change if I said yes" is the question the card is asking and a
       path nobody can see is not an answer to it. */
    $.describePaths = function () {
        var p = $.paths;
        return [
            'platform   : ' + p.platform,
            'layout     : ' + p.layout,
            'persistence: ' + p.mode + (p.fallbackUsed ? ' (fallback)' : ''),
            'storage    : ' + p.consent + (p.consentFrom ? ' (answer read from ' + p.consentFrom + ')' : ''),
            'game root  : ' + (p.gameRoot || '—'),
            'plugins dir: ' + (p.pluginsDir || '—'),
            'data dir   : ' + (p.dataDir || '—') + (p.outsideGameFolder ? ' (outside the game folder)' : ''),
            'beside game: ' + (p.localDir || '—'),
            'shared     : ' + (p.sharedDir || '—') + (p.consent === 'granted' ? '' : ' (not in use)'),
            'shared all : ' + (p.sharedCommonDir || '—') + (p.consent === 'granted' ? '' : ' (not in use)')
        ].join('\n');
    };

    /* ---------------------------------------------------------------------
       $.net — one HTTP GET, and an honest answer about how it was made.

       Three transports, chosen by feature detection, in this order:

         node-https  Node's own http/https through the host process. The only
                     one that reliably works from a file:// page, because it is
                     not subject to the page's origin at all.
         fetch       cannot read a file:// URL, and from a file:// page the
                     request carries an Origin of null, which the far end has
                     to allow explicitly.
         xhr         the same origin constraint as fetch, but it is what the
                     engine itself reaches for from a local page.

       The chooser reports which one it has AND what the absence of the others
       costs, so a link that will not load is a sentence rather than a shrug.

       `require` is re-derived here rather than read off $.env: $.env carries
       the three resolved modules and never the loader, and NW.js can have node
       integration switched off per window, so "env.nwjs is true" is not proof
       that require is in scope at the moment of the call.

       fetch and XHR follow redirects on their own and Node does not, so the
       Node path follows up to three and reports the URL it ended on. Three
       transports that disagree about a redirect is three different bug reports
       for one server configuration.
       ------------------------------------------------------------------ */
    var netOverride = null;
    var MAX_REDIRECTS = 3;

    function nodeLoader() {
        return $.safe(function () {
            return (typeof require === 'function' && typeof process === 'object') ? require : null;
        }, 'node loader probe', null);
    }

    function nodeHttp(url) {
        var load = nodeLoader();
        if (!load) return null;
        return $.safe(function () {
            var mod = load(String(url).indexOf('http:') === 0 ? 'http' : 'https');
            return (mod && typeof mod.get === 'function') ? mod : null;
        }, 'node http module', null);
    }

    $.net = {};

    /**
     * Which transport this build has, and what the missing ones would have
     * given it. Returns {id, why, missing:[{id, why}]}; id is null when there
     * is no transport at all, and `why` then says what to do instead.
     */
    $.net.transport = function () {
        if (netOverride) {
            return { id: netOverride.id || 'injected', why: 'a test has replaced the transport.', missing: [] };
        }
        var all = [
            { id: 'node-https', have: !!nodeHttp('https://x'),
                why: 'Node http/https through the host process. It is not subject to this page\'s ' +
                    'origin, which is why it is the only transport that reliably works from a file:// page.' },
            { id: 'fetch', have: typeof fetch === 'function',
                why: 'window.fetch. It cannot read a file:// URL at all, and from a file:// page it sends ' +
                    'an Origin of null that the far end has to allow explicitly.' },
            { id: 'xhr', have: typeof XMLHttpRequest === 'function',
                why: 'XMLHttpRequest. Same origin constraint as fetch, but it is what the engine itself ' +
                    'uses to read its own data files from a local page.' }
        ];
        var chosen = null, missing = [], i;
        for (i = 0; i < all.length; i++) {
            if (all[i].have) { if (!chosen) chosen = all[i]; }
            else missing.push({ id: all[i].id, why: all[i].why });
        }
        return {
            id: chosen ? chosen.id : null,
            why: chosen ? chosen.why
                : 'there is no transport on this build: no Node http module, no fetch and no ' +
                  'XMLHttpRequest. Paste the text instead of fetching it.',
            missing: missing
        };
    };

    /**
     * GET a URL. cb(err, {status, body, via, url}) is called exactly once.
     *
     *   opts.timeoutMs  give up after this long. The timer is here rather than
     *                   in each transport so that "it never answered" is one
     *                   behaviour and not three.
     *
     * A network request is the player's machine talking to somebody else's, so
     * every caller of this is expected to have said whose, and to have been
     * clicked. Nothing here re-fetches anything on its own.
     */
    $.net.get = function (url, cb, opts) {
        opts = opts || {};
        var timer = null, done = false;

        function finish(err, res) {
            if (done) return;
            done = true;
            if (timer) { clearTimeout(timer); timer = null; }
            $.safe(function () { cb(err || null, res || null); }, 'net callback for ' + url);
        }

        if (opts.timeoutMs > 0) {
            timer = setTimeout(function () {
                finish(new Error('no answer from ' + url + ' within ' + opts.timeoutMs + 'ms'), null);
            }, opts.timeoutMs);
        }

        if (netOverride) {
            $.safe(function () { netOverride(String(url), finish); }, 'injected transport');
            return;
        }

        var t = $.net.transport();
        if (!t.id) { finish(new Error(t.why), null); return; }

        if (t.id === 'node-https') {
            (function viaNode(u, hops) {
                $.safe(function () {
                    var mod = nodeHttp(u);
                    if (!mod) {
                        finish(new Error('the Node http module was there when it was probed and gone when ' +
                            'it was called; node integration may have been switched off for this window.'), null);
                        return;
                    }
                    var req = mod.get(u, function (res) {
                        var status = res.statusCode || 0;
                        var loc = res.headers ? res.headers.location : null;
                        if (status >= 300 && status < 400 && loc && hops < MAX_REDIRECTS) {
                            if (res.resume) res.resume();
                            viaNode(loc, hops + 1);
                            return;
                        }
                        var body = '';
                        if (res.setEncoding) res.setEncoding('utf8');
                        res.on('data', function (c) { body += c; });
                        res.on('end', function () {
                            finish(null, { status: status, body: body, via: 'node-https', url: u });
                        });
                    });
                    req.on('error', function (e) { finish(e, null); });
                }, 'node http get');
            })(String(url), 0);
            return;
        }

        if (t.id === 'fetch') {
            $.safe(function () {
                var r = fetch(String(url));
                /* Guarded the way the clipboard write is guarded: what comes
                   back is the host's promise, not one built here, and a host
                   that returns something else must not throw into the caller. */
                if (!r || typeof r.then !== 'function') {
                    finish(new Error('fetch returned nothing that can be waited on.'), null);
                    return;
                }
                r.then(function (resp) {
                    var text = resp.text ? resp.text() : null;
                    if (!text || typeof text.then !== 'function') {
                        finish(null, { status: resp.status || 0, body: '', via: 'fetch', url: resp.url || String(url) });
                        return;
                    }
                    text.then(function (body) {
                        finish(null, { status: resp.status || 0, body: body, via: 'fetch', url: resp.url || String(url) });
                    }, function (e) { finish(e, null); });
                }, function (e) { finish(e, null); });
            }, 'fetch get');
            return;
        }

        $.safe(function () {
            var x = new XMLHttpRequest();
            x.open('GET', String(url));
            x.onload = function () {
                finish(null, { status: x.status || 0, body: x.responseText || '', via: 'xhr', url: x.responseURL || String(url) });
            };
            x.onerror = function () {
                finish(new Error('the request to ' + url + ' failed before any status came back. From a ' +
                    'file:// page that is usually the far end declining an Origin of null.'), null);
            };
            x.send();
        }, 'xhr get');
    };

    /**
     * Test hook. `fn(url, done)` calls done(err, {status, body, via}); set
     * fn.id to name it in the transport report. Returns the function that puts
     * the real chooser back.
     *
     * Inert until it is called: nothing else in the mod reads the override.
     */
    $.net._use = function (fn) {
        var was = netOverride;
        netOverride = (typeof fn === 'function') ? fn : null;
        return function () { netOverride = was; return true; };
    };

    /* ---------------------------------------------------------------------
       Boot
       ------------------------------------------------------------------ */
    $.env = detectEnv();
    installPaths($.pathsFor($.env));

    $.log('info', $.codename + ' v' + $.version + ' loading…');
    $.log('info', 'platform=' + $.paths.platform + ' layout=' + $.paths.layout + ' persistence=' + $.paths.mode);
    if ($.paths.gameRoot) $.log('info', 'game root: ' + $.paths.gameRoot);
    if ($.paths.dataDir) $.log($.paths.fallbackUsed ? 'warn' : 'ok', 'data dir:  ' + $.paths.dataDir);
    /* Said at every launch, on every answer. Which folder the mod is using and
       who decided that are the two facts a bug report about missing settings
       needs, and neither of them was in the log before 2.2.0. */
    $.log($.paths.consent === 'granted' ? 'ok' : 'info',
        'storage:   ' + $.paths.consent + ' — ' + $.paths.consentWhy);
    ($.paths.notes || []).forEach(function (n) { $.log('warn', n); });

})(window.GigaHack);
