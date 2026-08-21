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
    $.version  = '2.0.0';
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
    var MAX_BUFFER = 400;

    $.logSink = null; // set by the shell once the drawer exists

    $.log = function (level, msg) {
        if (!LEVELS[level]) { msg = level; level = 'info'; }
        var text = String(msg);
        var entry = { level: level, msg: text, t: Date.now() };
        buffer.push(entry);
        if (buffer.length > MAX_BUFFER) buffer.shift();
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
            nwjs: false, fs: null, path: null, os: null,
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
                env.platform = process.platform;
                env.mac = process.platform === 'darwin';
                env.win = process.platform === 'win32';
                env.linux = process.platform === 'linux';
            } catch (e) {
                env.nwjs = false;
                env.fs = env.path = env.os = null;
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
       ------------------------------------------------------------------ */
    var SELF_URL = (document.currentScript && document.currentScript.src) || '';

    function urlToFsPath(url) {
        if (!url) return null;
        if (url.indexOf('file://') !== 0) return null;
        var p = decodeURIComponent(url.slice('file://'.length));
        // file:///C:/x -> /C:/x ; strip the leading slash on Windows drive paths
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
        return p;
    }

    function dirUp(p, n) {
        var path = $.env.path;
        for (var i = 0; i < n; i++) p = path ? path.dirname(p) : p.replace(/[\/\\][^\/\\]*$/, '');
        return p;
    }

    function looksLikeGameRoot(dir) {
        var fs = $.env.fs, path = $.env.path;
        if (!fs || !path || !dir) return false;
        try {
            if (fs.existsSync(path.join(dir, 'index.html'))) return true;
            return fs.existsSync(path.join(dir, 'js')) && fs.existsSync(path.join(dir, 'data'));
        } catch (e) { return false; }
    }

    function isWritable(dir) {
        var fs = $.env.fs, path = $.env.path;
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

    /* A filesystem-safe, collision-resistant key for this game, used to keep
       two games' settings apart when they share a fallback data directory.
       $dataSystem is not loaded yet at this point, so the key is derived from
       the game root path and refined by Profile once the title is known. */
    function keyFromPath(p) {
        if (!p) return 'unknown';
        var base = String(p).replace(/[\/\\]+$/, '').split(/[\/\\]/).pop() || 'game';
        return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'game';
    }

    function resolvePaths() {
        var env = $.env, path = env.path;
        var p = {
            platform: env.platform,
            mode: 'memory',          // 'fs' | 'localStorage' | 'memory'
            layout: 'unknown',       // 'plain' | 'www' | 'modloader'
            selfUrl: SELF_URL,
            selfFile: null,
            pluginsDir: null,        // the directory this file sits in
            modRoot: null,           // the mod's own root, when it has one
            gameRoot: null,          // folder containing index.html / js / data
            dataDir: null,           // where settings.json etc. actually land
            backupsDir: null,
            gameKey: 'unknown',
            fallbackUsed: false,
            notes: []
        };

        if (!env.nwjs || !path) {
            p.mode = (typeof localStorage !== 'undefined') ? 'localStorage' : 'memory';
            p.notes.push('Node APIs unavailable (browser build) — persistence degraded to ' + p.mode + '.');
            // The layout is still worth guessing from the URL for diagnostics.
            if (SELF_URL.indexOf('/mods/') > -1) p.layout = 'modloader';
            else if (SELF_URL.indexOf('/www/js/') > -1) p.layout = 'www';
            else if (SELF_URL) p.layout = 'plain';
            return p;
        }

        p.selfFile = urlToFsPath(SELF_URL);
        if (!p.selfFile) {
            p.notes.push('Could not resolve this script to a filesystem path from ' + (SELF_URL || '(no currentScript)') + '.');
        } else {
            p.pluginsDir = dirUp(p.selfFile, 1);

            // Walk up, at most six levels, looking for a game root. Six covers
            // the deepest supported layout (mods/<Name>/js/plugins) with room
            // to spare, and stops well before reaching the filesystem root.
            var dir = p.pluginsDir, hops = 0;
            while (dir && hops < 6) {
                if (looksLikeGameRoot(dir)) { p.gameRoot = dir; break; }
                var next = dirUp(dir, 1);
                if (next === dir) break;   // reached the volume root
                dir = next; hops++;
            }
        }

        // Cross-check against the engine's own idea of the game root. On MV and
        // MZ alike process.mainModule.filename is the index.html the game booted
        // from, so its directory is authoritative when the walk disagrees.
        var mainRoot = null;
        try {
            mainRoot = path.dirname(process.mainModule.filename);
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
                p.modRoot = dirUp(p.pluginsDir, 2);   // plugins → js → <mod root>
            } else {
                p.layout = 'plain';
                p.modRoot = dirUp(p.pluginsDir, 2);
                p.notes.push('Unrecognised layout: this script sits at "' + rel + '" relative to the game root.');
            }
        }

        p.gameKey = keyFromPath(p.gameRoot);

        // Where user data lands.
        //
        // A mod-loader install owns a folder of its own, so keeping userdata
        // inside it means uninstalling is "delete one folder". A plain install
        // does NOT own a folder — writing into the game's js/plugins would
        // scatter our files among the game's own, and a game update that
        // replaces that directory would take them with it. So a plain install
        // prefers the per-user application-support directory, keyed by game.
        var candidates = [];
        if (p.layout === 'modloader' && p.modRoot) {
            candidates.push(path.join(p.modRoot, 'userdata'));
        }
        var home = null;
        try { home = env.os.homedir(); } catch (e) { }
        if (home && env.mac) {
            candidates.push(path.join(home, 'Library', 'Application Support', 'GigaHack', p.gameKey));
            candidates.push(path.join(home, 'Documents', 'GigaHack', p.gameKey));
        } else if (home && env.win) {
            candidates.push(path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'GigaHack', p.gameKey));
        } else if (home) {
            candidates.push(path.join(home, '.local', 'share', 'GigaHack', p.gameKey));
        }
        // Last resort: beside the game itself.
        if (p.gameRoot) candidates.push(path.join(p.gameRoot, 'gigahack-userdata'));

        for (var i = 0; i < candidates.length; i++) {
            if (isWritable(candidates[i])) {
                p.dataDir = candidates[i];
                p.mode = 'fs';
                p.fallbackUsed = i > 0;
                break;
            }
        }

        if (p.mode !== 'fs') {
            p.mode = (typeof localStorage !== 'undefined') ? 'localStorage' : 'memory';
            p.notes.push('No writable directory found among ' + candidates.length +
                ' candidates — persistence degraded to ' + p.mode + '.');
        } else {
            p.backupsDir = path.join(p.dataDir, 'backups');
        }
        return p;
    }

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

    /* Human-readable summary used by the Debug tab and the boot log. */
    $.describePaths = function () {
        var p = $.paths;
        return [
            'platform   : ' + p.platform,
            'layout     : ' + p.layout,
            'persistence: ' + p.mode + (p.fallbackUsed ? ' (fallback)' : ''),
            'game root  : ' + (p.gameRoot || '—'),
            'plugins dir: ' + (p.pluginsDir || '—'),
            'data dir   : ' + (p.dataDir || '—')
        ].join('\n');
    };

    /* ---------------------------------------------------------------------
       Boot
       ------------------------------------------------------------------ */
    $.env = detectEnv();
    $.paths = $.safe(resolvePaths, 'path resolution', {
        platform: 'unknown', mode: 'memory', layout: 'unknown',
        notes: ['path resolution threw'], gameRoot: null, modRoot: null,
        pluginsDir: null, dataDir: null, gameKey: 'unknown'
    });

    $.log('info', $.codename + ' v' + $.version + ' loading…');
    $.log('info', 'platform=' + $.paths.platform + ' layout=' + $.paths.layout + ' persistence=' + $.paths.mode);
    if ($.paths.gameRoot) $.log('info', 'game root: ' + $.paths.gameRoot);
    if ($.paths.dataDir) $.log($.paths.fallbackUsed ? 'warn' : 'ok', 'data dir:  ' + $.paths.dataDir);
    ($.paths.notes || []).forEach(function (n) { $.log('warn', n); });

})(window.GigaHack);
