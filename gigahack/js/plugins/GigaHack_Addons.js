//=============================================================================
// GigaHack MV/MZ
// 34 · addons.js — JavaScript the player supplies, listed before it is run
//-----------------------------------------------------------------------------
// They are called ADDONS and not plugins because "plugin" already means one of
// the game's own plugins in this window: Debug → Plugins lists those, $.compat
// reasons about them, and the installer edits js/plugins.js. Two meanings for
// one word in one menu is a defect in the vocabulary, so this one gets its own.
//
// The file is read in two halves and the split is the whole design:
//
//   · THE HEADER IS READ WITHOUT RUNNING ANYTHING. It is an annotation block
//     parsed with a regular expression, exactly the way the engine reads a
//     plugin's own /*: block, so the list can show what a file CLAIMS — its
//     name, what game it says it is for, what it needs — before a single line
//     of it has executed. A file with no header is listed as claiming nothing;
//     it is never rejected for that.
//   · THE BODY RUNS ONLY WHEN THE ADDON IS ENABLED, and nothing that arrives
//     here is enabled by arriving.
//
// Every registration an addon makes is recorded and taken back when it is
// disabled — except two, and the panel says which and why rather than leaving
// it in a comment nobody reads:
//
//   · AN ENGINE ALIAS CANNOT BE PULLED OUT of a chain once something else has
//     aliased on top. $.install's unpatch refuses by identity and there is no
//     chain walk, which is correct — forcing it would silently discard the
//     other plugin's work. So an addon's alias is installed ONCE, permanently,
//     as a wrapper that consults the addon's enabled flag and otherwise calls
//     straight through. Disabling is then real and immediate and no chain is
//     ever broken.
//   · A PROFILE IS MEMOISED at the first resolve after boot, and re-resolving
//     mid-session changes answers other modules have already read and latched.
//     So a profile from an addon applies from the next launch. The panel says
//     so, and offers the re-resolve with its cost named beside it.
//
// THIS MODULE'S OWN EVENT FAN-OUT INSTALLS NO ALIAS AT ALL, and that is the
// load order talking. It is the last feature module, so an alias it installed
// would land on top of the one another module already holds on the same
// method — Auto and Encounters both hook Game_Map.setup, Auto hooks
// BattleManager.setup, Text hooks Window_Message.startMessage, Snapshot hooks
// both halves of a save. unpatch() refuses by identity and does not walk a
// chain, so being on top of those would take away their removal from
// Debug → Hooks for the rest of the session, and the button that offers it
// would only ever be able to say no. Every addon event is NOTICED on the frame
// hook instead, at a cost of one frame of latency and a handful of property
// reads on a hook that was running anyway.
//
// It is not a sandbox. new Function is not a sandbox, an addon is arbitrary
// JavaScript running with the game's privileges exactly like any RPG Maker
// plugin, and the panel says that once, plainly, at the point where it matters
// — the import review. The protections are real and limited and are stated as
// such: nothing runs until you enable it, you see the source first, a link is
// never re-fetched behind your back, and an addon that throws is stopped,
// named, and given its line number.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — addons: user JavaScript, read before it is run
 * @author gigahack
 * @help GigaHack_Addons.js — requires Core, Caps, Store, UI, Shell, Hooks,
 * Tabs. Uses Compat, Profile, Console, Vars and Inv where they are present and
 * says which of them is missing when one is.
 *
 * Settings → Addons is the list, the import buttons and the review step.
 * Debug → Addons is the diagnostics: load order, timings, what each addon
 * registered, what threw and on which line, and the API an addon is handed.
 *
 * An addon is a .js file with an annotation header. Press "start from a
 * template" in Settings → Addons for a working one, or read
 * gigahack/addons/README.md.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] tabs module missing — addons not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    var A = $.addons = {};

    /* =====================================================================
       1. NAMES, LIMITS AND THE ONE SENTENCE THAT MATTERS
       ===================================================================== */
    var INDEX_FILE = 'addons.json';
    var LOADING_FILE = 'addons-loading.json';
    var DIR = 'addons';

    /* A ceiling with the number in the message, because "too big" without one
       is not something anybody can act on. A quarter of a megabyte is many
       times the largest plugin most games ship and small enough that a fetch
       that has gone wrong — an error page, a redirect to a download portal —
       does not sit in memory as a surprise. */
    var MAX_BYTES = 256 * 1024;

    /* Not a promise about safety. Said once, where the decision is made. */
    var NOT_A_SANDBOX =
        'An addon is JavaScript running with the game\'s privileges, exactly like any plugin the game ' +
        'itself loads. Nothing here sandboxes it — it can read and write anything the game can, and ' +
        'GigaHack cannot make that untrue. What it does do: nothing runs until you enable it, you are ' +
        'looking at the whole source now, a link is never fetched again on its own, and an addon that ' +
        'throws is stopped and named with its line.';

    /* The addon-facing event names, what each one means, and HOW it is
       noticed. One table, read by the fan-out, by api.on's refusal message and
       by the generated API surface in Debug → Addons — so the three cannot
       disagree about what an addon may subscribe to.

       NOT ONE OF THEM IS AN ALIAS, and that is the load order talking rather
       than laziness. This module is the last feature module, so an alias here
       would land on TOP of the one another module already has on the same
       method — Auto and Encounters both hook Game_Map.setup, Auto hooks
       BattleManager.setup, Text hooks Window_Message.startMessage, Snapshot
       hooks both halves of the save. $.install's unpatch refuses by identity
       and does not walk a chain, so sitting on top of those takes away their
       ability to be removed from Debug → Hooks for the rest of the session,
       and the panel that offers it would then only ever say no. Noticing a
       change instead costs a handful of property reads on a frame hook that
       is already running, and one frame of latency that nothing here needs. */
    var EVENTS = [
        { id: 'frame', what: 'every frame the mod ticks, with the mod\'s own frame count',
            how: 'the mod\'s per-frame registry' },
        { id: 'tick', what: 'about every 700ms, for anything a person reads',
            how: 'the same registry, every 42nd frame' },
        { id: 'map', what: 'the map changed, with its id',
            how: 'the map id, read on the frame tick' },
        { id: 'battle', what: 'a battle started, with its troop id',
            how: 'the party\'s in-battle flag, read on the frame tick' },
        { id: 'message', what: 'a page was said, with the CONVERTED text',
            how: 'the dialogue recorder\'s revision — the one capture in the mod that already reads ' +
                'the text AFTER the engine has resolved it' },
        { id: 'save', what: 'a save landed, with the slot id where the engine will say',
            how: 'the system\'s save count, read on the frame tick' },
        { id: 'load', what: 'the game objects were replaced — a save loaded, or a new game began',
            how: 'the identity of $gameSystem, read on the frame tick' },
        { id: 'menu', what: 'the overlay opened or closed, with true or false',
            how: 'the mod\'s own "overlay" event' }
    ];

    /* The whole api table, as data. Debug → Addons renders this rather than a
       hand-written list, and a check asserts that every key the factory really
       puts on the object appears here and nothing here is missing from it —
       which is the only thing that stops a reference page going stale. */
    var API_DOC = [
        { call: 'api.id / api.name / api.version', what: 'the identity this addon is listed under', revoked: '—' },
        { call: 'api.panel(tab, name, build, order)', what: 'a panel on one of the six tabs, under a name that tab does not already use', revoked: 'yes — taken off and the tab rebuilt' },
        { call: 'api.hotkey({id, label, help, when, run})', what: 'a bind, in Settings → Hotkeys like any other', revoked: 'yes' },
        { call: 'api.command(name, fn, help)', what: 'GigaHack.api.<name>(), listed by api.help()', revoked: 'yes' },
        { call: 'api.on(event, fn)', what: EVENTS.map(function (e) { return e.id; }).join(', '), revoked: 'yes' },
        { call: 'api.profile(def)', what: 'a game profile', revoked: 'NO — it applies from the next launch' },
        { call: 'api.hook(name, owner, method, factory, reason)', what: 'an engine alias', revoked: 'NO — it stays as a pass-through' },
        { call: 'api.store', what: 'read / write / save / remove, in this addon\'s own file', revoked: '—' },
        { call: 'api.game', what: 'guarded state: every write read back through $.compat.verify', revoked: '—' },
        { call: 'api.need(key)', what: 'a module\'s namespace, or null and the reason', revoked: '—' },
        { call: 'api.log / api.toast', what: 'the mod\'s logger and toaster', revoked: '—' },
        { call: 'api.w / api.h / api.cols / api.kv', what: 'the widget kit the rest of the menu is built from', revoked: '—' },
        { call: 'api.caps / api.eng', what: 'what this engine build can do, and the adapters', revoked: '—' },
        { call: 'api.compat', what: 'write-verify, degradation, load order', revoked: '—' },
        { call: 'api.profileOf', what: 'the resolved game profile, read-only', revoked: '—' },
        { call: 'api.watch / api.journal / api.interp / api.rng / api.snap', what: 'the Trace and Snapshot services, null when absent', revoked: '—' }
    ];

    /* =====================================================================
       2. THE HEADER, READ WITHOUT RUNNING ANYTHING

       The same shape the engine reads off a plugin: an annotation block at the
       top of the file. Parsed line by line off the comment text, so nothing in
       the file is evaluated, imported or compiled to answer "what does this
       claim to be".

       @help is greedy to the end of the block or the next @key, because a
       one-line help is the common case and a paragraph is the useful one.
       ===================================================================== */
    var HEADER_KEYS = ['id', 'name', 'version', 'author', 'game', 'needs', 'help'];

    function blockComments(src) {
        /* Only the top of the file. A header that is not at the top is not an
           annotation block, and scanning a whole file for /* pairs is how a
           string containing one gets read as a comment. */
        var head = String(src == null ? '' : src).slice(0, 8000);
        var out = [], i = 0, open, close;
        while (i < head.length && out.length < 8) {
            open = head.indexOf('/*', i);
            if (open < 0) break;
            close = head.indexOf('*/', open + 2);
            if (close < 0) break;
            out.push(head.slice(open + 2, close));
            i = close + 2;
        }
        return out;
    }

    /**
     * What a file claims, without running it.
     *
     * Always returns an object. `has` is false when there is no annotation
     * block, and that is a state, not a failure — an addon with no header is
     * listed as claiming nothing and can still be enabled.
     */
    A.header = function (src) {
        var out = {
            has: false, id: '', name: '', version: '', author: '',
            game: '', needs: [], help: '', why: '', raw: ''
        };
        var blocks = $.safe(function () { return blockComments(src); }, 'addon header scan', []);
        var body = null, i;
        for (i = 0; i < blocks.length; i++) {
            if (/@gigahack-addon\b/.test(blocks[i])) { body = blocks[i]; break; }
        }
        if (body === null) {
            for (i = 0; i < blocks.length; i++) {
                if (/^\s*:/.test(blocks[i]) && /@[a-zA-Z]/.test(blocks[i])) { body = blocks[i]; break; }
            }
        }
        if (body === null) {
            out.why = 'no header — this file claims nothing about itself. That is allowed; the id ' +
                'below was taken from the file name.';
            return out;
        }
        out.has = true;
        out.raw = body;

        var lines = String(body).split(/\r?\n/).map(function (l) {
            return l.replace(/^\s*\*?\s?/, '');
        });
        var key = null, buf = [];
        function flush() {
            if (!key) return;
            var v = buf.join('\n').replace(/\s+$/, '');
            if (key === 'needs') {
                out.needs = v.split(/[,\s]+/).filter(function (s) { return !!s; });
            } else if (HEADER_KEYS.indexOf(key) > -1) {
                out[key] = (key === 'help') ? v : v.replace(/^\s+/, '');
            }
            key = null; buf = [];
        }
        lines.forEach(function (line) {
            var m = /^@([a-zA-Z-]+)\s*(.*)$/.exec(line);
            if (m) {
                flush();
                key = m[1].toLowerCase();
                buf = [m[2]];
                return;
            }
            if (key) buf.push(line);
        });
        flush();
        return out;
    };

    /** An id that survives being a settings path and a file name. */
    function cleanId(v) {
        /* No dot, ever. Hotkey ids become part of the dotted settings path
           hotkeys.<id>, and cfgSet descends on a dot: one there writes a
           nested object the keydown handler can never match. Colons are fine
           and are the shipped precedent. */
        return String(v == null ? '' : v).toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    }
    A.cleanId = cleanId;

    var imul = Math.imul || function (a, b) {
        var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
        var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
        return ((al * bl) + ((((ah * bl) + (al * bh)) << 16) >>> 0)) | 0;
    };

    /**
     * A cheap 32-bit digest. NOT a checksum and the panel does not call it
     * one: it is FNV-1a, it answers "is this the same text as last time" and
     * nothing else, and anyone setting out to produce a collision can.
     */
    function digestOf(s) {
        var v = 0x811c9dc5, i, str = String(s == null ? '' : s);
        for (i = 0; i < str.length; i++) {
            v = (v ^ str.charCodeAt(i)) >>> 0;
            v = imul(v, 16777619) >>> 0;
        }
        return ('0000000' + v.toString(16)).slice(-8);
    }
    A.digest = digestOf;

    function firstLine(src) {
        var lines = String(src == null ? '' : src).split(/\r?\n/), i, t;
        for (i = 0; i < lines.length; i++) {
            t = lines[i].replace(/^\s+|\s+$/g, '');
            if (t) return t.length > 140 ? t.slice(0, 140) + '…' : t;
        }
        return '';
    }
    A.firstLine = firstLine;

    /**
     * Is this JavaScript, judged by looking at it?
     *
     * An HTML error page is the common case for a link that went wrong, and it
     * arrives with a 200 and a cheerful content type. Two tests, both by
     * inspection, neither of which runs anything: does it open like markup,
     * and does it compile. Compiling is not running — new Function builds a
     * function object and never calls it — and it is the only way to say
     * "line 14" instead of "it did not work".
     */
    A.inspect = function (src) {
        var text = String(src == null ? '' : src);
        var head = text.slice(0, 600).replace(/^﻿/, '');
        var lead = head.replace(/^\s+/, '');
        var out = { ok: true, why: '', first: firstLine(text), line: null };

        if (!lead) {
            out.ok = false;
            out.why = 'there is nothing in it.';
            return out;
        }
        if (lead.charAt(0) === '<' || /<!doctype/i.test(lead.slice(0, 40)) || /<html[\s>]/i.test(head)) {
            out.ok = false;
            out.why = 'this is markup, not JavaScript. The first line is: ' + out.first;
            return out;
        }
        var e = compileError(text, 'inspection');
        if (e) {
            out.ok = false;
            out.line = e.line;
            out.why = 'this does not parse as JavaScript' + (e.line ? ' (line ' + e.line + ')' : '') +
                ' — ' + e.message + '. The first line is: ' + out.first;
        }
        return out;
    };

    /* =====================================================================
       3. RUNNING ONE

           new Function('GigaHack', 'addon', src + '\n//# sourceURL=…')

       The sourceURL is not decoration. Without it every error in every addon
       comes out of the engine as VM123:1 and the panel cannot name a line;
       with it the stack says gigahack-addon:<id>:14 and the row can print it.

       The line number needs one correction, and it is MEASURED rather than
       assumed. A Function body is wrapped in a preamble before it is compiled,
       so the line a stack reports is the addon's line plus however many lines
       that preamble happens to be — two on every host tried, and nothing
       anywhere promises that. The probe below throws from a known line once,
       at load, and the difference is the bias. If it cannot be measured the
       bias is zero and the panel says the line is approximate.
       ===================================================================== */
    var SOURCE_PREFIX = 'gigahack-addon:';
    var CALIBRATION = 'gigahack-addon-line-probe';

    function lineFrom(err, tag) {
        var stack = (err && err.stack) ? String(err.stack) : '';
        var re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)');
        var m = re.exec(stack);
        if (m) return parseInt(m[1], 10);
        /* Firefox-shaped stacks and a compile error both put the position on
           the error itself rather than in a frame. */
        if (typeof err.lineNumber === 'number') return err.lineNumber;
        return null;
    }

    var lineBias = (function () {
        var measured = null;
        try {
            /* Body line 3 throws. Anything the host reports above 3 is preamble. */
            var f = new Function('\n\nthrow new Error("line probe");\n//# sourceURL=' + CALIBRATION);
            f();
        } catch (e) {
            var got = lineFrom(e, CALIBRATION);
            if (typeof got === 'number' && got >= 3 && got < 40) measured = got - 3;
        }
        return measured;
    }());

    A.lineBias = function () { return lineBias; };

    /** Compile without calling. Returns null when it compiles, else {message, line}. */
    function compileError(src, id) {
        var tag = SOURCE_PREFIX + id;
        try {
            /* eslint-disable-next-line no-new-func */
            var fn = new Function('GigaHack', 'addon', String(src) + '\n//# sourceURL=' + tag);
            return fn ? null : { message: 'the compiler returned nothing', line: null };
        } catch (e) {
            var raw = lineFrom(e, tag);
            return {
                message: (e && e.message) ? e.message : String(e),
                line: (typeof raw === 'number' && lineBias !== null) ? Math.max(1, raw - lineBias) : raw
            };
        }
    }

    /* =====================================================================
       4. WHERE ADDONS LIVE

       Two places, and the split is the same rule the storage answer follows:

         <dataDir>/addons/*.js          this game's addons
         <sharedCommonDir>/addons/*.js  the library, only when the player has
                                        allowed the shared folder

       The library is shared between games; ENABLEMENT IS PER GAME, in this
       game's addons.json. One machine-wide "on" is not what anybody means when
       they switch something on in one game.

       With no filesystem — a browser build, a web deploy — an addon lives in
       the store's own backend under the same name and the folder scan is
       replaced by the index. The panel says that rather than showing an empty
       folder and no explanation.
       ===================================================================== */
    function fs() { return $.env.fs; }
    function pathMod() { return $.env.path; }

    function onDisk() {
        return $.paths.mode === 'fs' && !!fs() && !!pathMod() && !!$.paths.dataDir;
    }

    /** This game's addon folder. Resolved at call time — never cached. */
    A.dir = function () {
        return $.safe(function () {
            if (!onDisk()) return null;
            return pathMod().join($.paths.dataDir, DIR);
        }, 'addon dir', null);
    };

    /** The cross-game library, or null and sharedWhy() says why not. */
    A.libraryDir = function () {
        return $.safe(function () {
            if (!$.store.sharedAvailable || !$.store.sharedAvailable()) return null;
            if (!pathMod() || !$.paths.sharedCommonDir) return null;
            return pathMod().join($.paths.sharedCommonDir, DIR);
        }, 'addon library dir', null);
    };

    A.libraryWhy = function () {
        if (A.libraryDir()) return '';
        if ($.store.sharedWhy) return $.store.sharedWhy();
        return 'this build has no cross-game folder.';
    };

    /** How addons are stored here, in one sentence the panel prints. */
    A.storageWhy = function () {
        if (onDisk()) return '';
        return ($.caps.fsWhy || 'there is no filesystem here') +
            ' Addons are kept in the settings store under the same names, and the list below is the ' +
            'index rather than a folder scan — importing and enabling work, a folder does not exist ' +
            'to drop a file into.';
    };

    function dirFor(scope) { return scope === 'library' ? A.libraryDir() : A.dir(); }

    /* THE FILE NAME IS NOT THE IDENTITY, and keeping the two apart is the only
       way a file called "town.gold.js" can be listed as "town-gold". The id
       goes into a dotted settings path and into a store file name, so it is
       cleaned; the file name is where the bytes are, so it is kept verbatim.
       An addon imported through the review has the two the same, because
       A.commit writes <id>.js. */
    function fileOf(rec) { return rec.file || rec.id; }
    function storeName(file) { return DIR + '/' + file + '.js'; }

    /**
     * Existence is not readability: an existence check needs only directory
     * permission, so a file that reports present can fail every read and the
     * addon is invisible rather than broken. Three answers, and null means
     * "cannot tell" rather than "no".
     */
    function readable(file) {
        return $.safe(function () {
            var f = fs();
            if (!f || !file || !f.existsSync(file)) return null;
            if (typeof f.accessSync !== 'function') return null;
            var R_OK = (f.constants && f.constants.R_OK) || 4;
            try { f.accessSync(file, R_OK); return true; } catch (e) { return false; }
        }, 'addon readable', null);
    }

    function readSource(rec) {
        return $.safe(function () {
            var dir = dirFor(rec.scope);
            if (dir && fs() && pathMod()) {
                var file = pathMod().join(dir, fileOf(rec) + '.js');
                if (!fs().existsSync(file)) return null;
                if (readable(file) === false) {
                    rec.error = 'the file is there and this process cannot read it. Fix it with: ' +
                        ($.repairCommand ? $.repairCommand() : 'chmod 644 on the addons folder');
                    return null;
                }
                var raw = fs().readFileSync(file, 'utf8');
                return raw && raw.length ? raw : null;
            }
            var kept = $.store.read(storeName(fileOf(rec)), null);
            return (typeof kept === 'string' && kept.length) ? kept : null;
        }, 'read addon ' + rec.id, null);
    }

    function writeSource(name, src, scope) {
        return $.safe(function () {
            var dir = dirFor(scope || 'game');
            if (dir && fs() && pathMod()) {
                fs().mkdirSync(dir, { recursive: true });
                var file = pathMod().join(dir, name + '.js');
                fs().writeFileSync(file, String(src), 'utf8');
                $.log('ok', 'wrote ' + file);
                return file;
            }
            $.store.write(storeName(name), String(src));
            return storeName(name);
        }, 'write addon ' + name, null);
    }

    function deleteSource(rec) {
        return $.safe(function () {
            var dir = dirFor(rec.scope);
            if (dir && fs() && pathMod()) {
                var file = pathMod().join(dir, fileOf(rec) + '.js');
                if (fs().existsSync(file)) { fs().unlinkSync(file); $.log('ok', 'deleted ' + file); }
                return true;
            }
            return $.store.remove(storeName(fileOf(rec)));
        }, 'delete addon ' + rec.id, false);
    }

    /** Absolute path of an addon's file, or the store name when there is no disk. */
    A.pathOf = function (id) {
        var rec = addons[id];
        if (!rec) return null;
        return pathFor(rec.scope, fileOf(rec));
    };

    /** Where a file of that name in that scope would be. Names a file that is
        not listed yet, which is what a two-files-one-id message needs. */
    function pathFor(scope, name) {
        var dir = dirFor(scope);
        if (dir && pathMod()) return pathMod().join(dir, name + '.js');
        return storeName(name);
    }

    /**
     * One level, and it is stated. An addon folder is a folder of addons, not
     * a tree of them; a nested walk here would be a third disagreeing opinion
     * about how deep to go and the index and the media scan already differ.
     */
    var SCAN_CAP = 200;
    function scanDir(dir) {
        return $.safe(function () {
            if (!dir || !fs()) return { names: [], complete: true, why: '' };
            if (!fs().existsSync(dir)) return { names: [], complete: true, why: '' };
            var all = fs().readdirSync(dir).filter(function (n) { return /\.js$/i.test(n); }).sort();
            var complete = all.length <= SCAN_CAP;
            return {
                names: all.slice(0, SCAN_CAP).map(function (n) { return n.replace(/\.js$/i, ''); }),
                complete: complete,
                why: complete ? '' : 'this folder holds more than ' + SCAN_CAP +
                    ' .js files; the rest are not listed.'
            };
        }, 'scan ' + dir, { names: [], complete: true, why: '' });
    }

    /* =====================================================================
       5. THE INDEX

       addons.json:  { "<id>": {enabled, source, importedAt, hash, error, file} }

       Enablement lives here and nowhere else, so it cannot travel with a
       shared library file into another game.

       `file` is carried because the key is the IDENTITY and the identity is
       not always the file name: an addon declaring "@id town-gold" in a file
       called town.gold.js is keyed on the id, and without the file name here
       a launch that has not scanned the folder yet cannot find its bytes.
       ===================================================================== */
    var addons = {};        // id -> record
    var order = [];         // ids, in the order they were loaded this session
    var revision = 0;
    var scanNote = '';

    A.revision = function () { return revision; };
    function bump() { revision++; }

    function newReg() {
        return { panels: [], hotkeys: [], commands: [], events: [], hooks: [], profiles: [] };
    }

    function blank(id) {
        return {
            id: id, name: '', version: '', author: '', game: '', needs: [], help: '',
            hasHeader: false, headerWhy: '',
            src: null, size: 0, digest: '', file: null,
            scope: 'game', source: 'folder', url: null, importedAt: null,
            enabled: false, state: 'listed', error: null, line: null,
            ms: 0, quarantined: false, registered: 0, eventThrow: null,
            reg: newReg()
        };
    }

    function readIndex() {
        var raw = $.store.read(INDEX_FILE, null);
        return (raw && typeof raw === 'object') ? raw : {};
    }

    function writeIndex(quiet) {
        var out = {};
        Object.keys(addons).forEach(function (id) {
            var r = addons[id];
            out[id] = {
                enabled: !!r.enabled,
                source: r.source,
                importedAt: r.importedAt,
                hash: r.digest,
                error: r.error || null,
                scope: r.scope,
                url: r.url || null,
                file: fileOf(r)
            };
        });
        $.store.write(INDEX_FILE, out, quiet !== false);
        return out;
    }
    A.writeIndex = writeIndex;

    /* =====================================================================
       6. THE EVENT FAN-OUT

       Eight names, one frame hook, no aliases. The reason there is no alias
       here is in the EVENTS table above and it is the load order: this module
       is last, so every alias it installed would sit on top of another
       module's alias on the same method and take away that module's ability to
       be removed from Debug → Hooks.

       Everything below therefore NOTICES rather than intercepts. The cost is
       one frame of latency and a handful of property reads on a hook that runs
       anyway; the benefit is that enabling an addon changes nothing about any
       other module's hooks, its unpatch, or the alias self-test.
       ===================================================================== */
    var subs = {};
    EVENTS.forEach(function (e) { subs[e.id] = []; });

    /* A HANDLER THAT THROWS IS STOPPED AND NAMED, and the reason is the log
       rather than the throw. `frame` runs sixty times a second, and $.safe
       logs on EVERY call — no counter, no window — so one broken handler wrote
       one log line and one console.error per frame and overwrote the whole
       4000-entry ring in about a minute. The boot report, every other module's
       diagnostics and the Log panel became one repeated sentence, and the log
       is the first thing a bug report carries. Nothing else caught it: the
       throw is swallowed inside this module's own frame hook, so $.frame's
       per-hook guard never saw it, and the record went on reading state
       'loaded' with error null while Debug → Addons printed "Nothing has
       thrown."

       So it is caught here, in the shape GigaHack_Auto already uses for the
       other place user code runs on a hot path: the first throw is logged with
       its line, the rest are counted on the record, and at the ceiling the
       SUBSCRIPTION is dropped and that is said once. The addon stays enabled —
       one dead handler is not a reason to take its panels away — and "read it
       again" in Settings → Addons puts the subscription back. */
    var HANDLER_THROWS = 8;

    function unsubscribe(sub) {
        var list = subs[sub.evt];
        if (list) {
            var i = list.indexOf(sub);
            if (i > -1) list.splice(i, 1);
        }
        sub.stopped = true;
    }

    function handlerThrew(rec, sub, e) {
        var raw = lineFrom(e, SOURCE_PREFIX + rec.id);
        var line = (typeof raw === 'number' && lineBias !== null) ? Math.max(1, raw - lineBias) : raw;
        var msg = (e && e.message) ? e.message : String(e);
        sub.throws = (sub.throws || 0) + 1;
        /* Its own field and not rec.error: rec.error is what the LOAD did and
           is persisted into the index, and a handler throw is neither. The
           panel says which of the two it is looking at. */
        rec.eventThrow = {
            evt: sub.evt, message: msg, line: line,
            count: sub.throws, stopped: sub.throws >= HANDLER_THROWS
        };
        if (sub.throws === 1) {
            $.log('err', 'addon "' + rec.id + '" threw in on("' + sub.evt + '")' +
                (line ? ' at line ' + line : '') + ' — ' + msg + '. Further throws from this handler ' +
                'are counted on its row rather than logged, because this runs on a frame clock.');
        }
        if (sub.throws >= HANDLER_THROWS) {
            unsubscribe(sub);
            $.log('warn', 'addon "' + rec.id + '": the on("' + sub.evt + '") handler threw ' + sub.throws +
                ' times, so it is not called again. The rest of the addon is untouched and still ' +
                'enabled — "read it again" in Settings → Addons re-subscribes it.');
        }
        bump();
    }

    function fire(evt, payload) {
        var list = subs[evt];
        if (!list || !list.length) return;
        list.slice().forEach(function (s) {
            var rec = addons[s.id];
            if (!rec || !rec.enabled || s.stopped) return;
            /* A bare try/catch and not $.safe. $.safe logs unconditionally,
               which is the flood this exists to stop, and the error object is
               the only thing that carries the line. */
            try {
                s.fn(payload);
            } catch (e) {
                handlerThrew(rec, s, e);
            }
        });
    }
    A._fire = fire;

    /* 700ms on the frame clock rather than a wall clock: an addon watching the
       game wants the game's own time, and the mod's frame counter keeps
       ticking while the mod holds the game so a paused inspection still
       updates. 42 frames is 700ms at 60fps and the table says "about". */
    var TICK_FRAMES = 42;

    /* Last seen, so a change can be told from a state. Undefined rather than
       null at the start: a game that genuinely has no map yet must not read as
       "the map just changed to nothing" on the first frame. */
    var seenMap;
    var seenBattle = false;
    var seenSaves;
    var seenSystem;
    var seenPage;

    function watchGame() {
        /* Map. mapId() is a getter on a live object and costs nothing; the
           alternative was an alias on Game_Map.setup, which two modules
           already hold. */
        var mapId = $.safe(function () {
            return (typeof $gameMap !== 'undefined' && $gameMap && $gameMap.mapId) ? $gameMap.mapId() : undefined;
        }, 'addon map probe', undefined);
        if (mapId !== undefined && mapId !== seenMap) {
            var wasMap = seenMap;
            seenMap = mapId;
            if (wasMap !== undefined || mapId) fire('map', mapId);
        }

        /* Battle, on the rising edge only. inBattle() is the party's own flag
           and it is true for exactly as long as the fight is. */
        var inBattle = $.safe(function () {
            return !!(typeof $gameParty !== 'undefined' && $gameParty && $gameParty.inBattle && $gameParty.inBattle());
        }, 'addon battle probe', false);
        if (inBattle && !seenBattle) {
            fire('battle', $.safe(function () {
                return (typeof $gameTroop !== 'undefined' && $gameTroop) ? $gameTroop._troopId : 0;
            }, 'addon troop id', 0));
        }
        seenBattle = inBattle;

        /* A save landed. saveCount() goes up inside onBeforeSave, which every
           save on both engines goes through, so this sees the game's own saves
           and the mod's alike — and it does not have to know which of the two
           shapes saveGame returned. */
        var sys = $.safe(function () {
            return (typeof $gameSystem !== 'undefined' && $gameSystem) ? $gameSystem : null;
        }, 'addon system probe', null);
        if (sys !== seenSystem) {
            /* The whole object was replaced: a save was loaded, or a new game
               began. The two are told apart by whether the system that arrived
               has ever been saved, which is what the engine itself records. */
            var fresh = $.safe(function () { return !sys || !sys.saveCount || sys.saveCount() === 0; },
                'addon save count', true);
            var had = seenSystem !== undefined;
            seenSystem = sys;
            seenSaves = $.safe(function () { return (sys && sys.saveCount) ? sys.saveCount() : 0; },
                'addon save count', 0);
            if (had && sys) fire('load', { fresh: fresh, saves: seenSaves });
        } else if (sys) {
            var saves = $.safe(function () { return sys.saveCount ? sys.saveCount() : 0; },
                'addon save count', 0);
            if (seenSaves !== undefined && saves > seenSaves) {
                fire('save', $.safe(function () {
                    return (typeof DataManager !== 'undefined') ? DataManager._lastAccessedId : 0;
                }, 'addon save slot', 0));
            }
            seenSaves = saves;
        }

        /* A page was said. The dialogue recorder is the one capture in the mod
           that reads the CONVERTED text — it hooks the message window AFTER
           the original, because \V[n] is resolved exactly once, inside
           startMessage, and a capture taken before it stores the reference and
           loses the number for good. Reusing it is a second reason not to
           install an alias here: a second capture of the same thing would have
           to relearn that, and one of the two would eventually get it wrong. */
        var t = $.text;
        if (t && t.history && t.history.revision) {
            var rev = $.safe(function () { return t.history.revision(); }, 'addon message revision', null);
            if (rev !== null && rev !== seenPage) {
                var first = seenPage === undefined;
                seenPage = rev;
                if (!first) {
                    var lines = $.safe(function () { return t.history.lines(); }, 'addon message lines', []);
                    var last = lines.length ? lines[lines.length - 1] : null;
                    if (last) fire('message', last.text);
                }
            }
        }
    }

    /** Why an event cannot fire on this build, or '' when it can. */
    A.eventWhy = function (id) {
        if (id === 'message' && !($.text && $.text.history && $.text.history.revision)) {
            return 'GigaHack_Text did not load, so nothing is recording what is said and this never ' +
                'fires. Debug → Environment lists which modules ran.';
        }
        if (id === 'message' && $.text.history.installed && !$.text.history.installed()) {
            return 'the dialogue recorder found nothing to record from on this build — ' +
                ($.text.history.why ? $.text.history.why() : 'no message window') +
                ' — so this never fires.';
        }
        return '';
    };

    $.onFrame('addons: events', function (n) {
        if (subs.frame.length) fire('frame', n);
        if (subs.tick.length && n % TICK_FRAMES === 0) fire('tick', n);
        /* The watches run whether or not anybody is subscribed, so that the
           FIRST subscription does not immediately fire on a state it was never
           there to see change. They are property reads on live objects. */
        $.safe(watchGame, 'addon event watch');
    });

    $.on('overlay', function (v) { fire('menu', !!v); });
    /* =====================================================================
       7. THE API HANDED TO setup()

       Every registration is recorded on the addon's own record, so disabling
       it is a walk over that record and not a search of six global registries.
       ===================================================================== */
    function moduleOf(key) {
        var TABLE = {
            vars: 'GigaHack_Vars', inv: 'GigaHack_Inv', party: 'GigaHack_Party',
            map: 'GigaHack_Map', events: 'GigaHack_Events', battle: 'GigaHack_Battle',
            text: 'GigaHack_Text', forge: 'GigaHack_Forge', player: 'GigaHack_Player',
            screen: 'GigaHack_Screen', media: 'GigaHack_Media', quest: 'GigaHack_Quest',
            snap: 'GigaHack_Snapshot', trace: 'GigaHack_Trace', auto: 'GigaHack_Auto',
            kit: 'GigaHack_Kit', keys: 'GigaHack_Keys', build: 'GigaHack_Build',
            save: 'GigaHack_Save', backup: 'GigaHack_Backup', index: 'GigaHack_Index',
            console: 'GigaHack_Console', gallery: 'GigaHack_Gallery', steam: 'GigaHack_Steam',
            encounters: 'GigaHack_Encounters', compat: 'GigaHack_Compat', profile: 'GigaHack_Profile'
        };
        return TABLE[key] || null;
    }

    /** The local write-verify shim every feature module carries, once more. */
    function verify(control, write, read, want, compare) {
        if ($.compat && $.compat.verify) return $.compat.verify(control, write, read, want, compare);
        $.safe(write, 'write ' + control);
        var got = $.safe(read, 'read ' + control, undefined);
        var ok = compare ? compare(got, want) : got === want;
        return {
            ok: ok, got: got, want: want, culprits: [],
            message: ok ? '' : 'wrote ' + JSON.stringify(want) + ' to ' + control + ' and read back ' +
                JSON.stringify(got) + '. The compatibility module is not installed, so nothing can be ' +
                'named as the cause.'
        };
    }

    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: label }),
            /* A value here is unbounded — a path, an addon's own name for
               something, a joined list — so the edge is allowed to shrink and
               wrap. Rigid, it pushes the label out and both halves are then
               clipped by the column and neither can be read. */
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall',
                text: String(value)
            }));
    }

    function makeApi(rec) {
        var reg = rec.reg;

        var api = {
            id: rec.id,
            name: rec.name || rec.id,
            version: rec.version || '',

            /* ------------------------------------------------------ panels */
            panel: function (tab, name, build, panelOrder) {
                var label = String(name || rec.id);
                var tabId = String(tab || 'world');
                /* A NAME THAT TAB ALREADY USES IS REFUSED, the way a taken
                   $.api key is. U.panel replaces by name and teardown removes
                   by name, so an addon registering "Hooks" on the debug tab
                   did not add a panel — it replaced GigaHack's own, and
                   switching the addon off then deleted the built-in for the
                   rest of the session. The worst case is an addon panel
                   called "Addons" on the settings tab: it replaces the panel
                   the player would use to switch it off. */
                if (U.panelNames(tabId).indexOf(label) > -1) {
                    var alt = label + ' (' + rec.id + ')';
                    api.log('warn', rec.id + ': the ' + tabId + ' tab already has a panel called "' +
                        label + '", so it was not registered — registering replaces by name and ' +
                        'disabling removes by name, so this would have taken that panel away.' +
                        (U.panelNames(tabId).indexOf(alt) < 0
                            ? ' Pick another name — "' + alt + '" is free.'
                            : ' Pick another name.'));
                    return null;
                }
                var wrapped = function (sub) {
                    return $.safe(function () { return build(sub); }, 'addon ' + rec.id + ' panel "' + label + '"',
                        U.todo('Addon', label, [
                            'this panel threw while building',
                            'Debug → Addons has the error and the line'
                        ]));
                };
                var got = U.panel(tabId, label, wrapped, panelOrder == null ? 165 : panelOrder);
                if (got === null) {
                    api.log('warn', rec.id + ': there is no "' + tabId + '" tab, so the panel "' + label +
                        '" was dropped. The six tabs are ' + U.tabIds().join(', ') + '.');
                    return null;
                }
                reg.panels.push({ tab: tabId, name: label });
                rec.registered++;
                return label;
            },

            /* ----------------------------------------------------- hotkeys */
            hotkey: function (def) {
                if (!def || !def.id) { api.log('warn', rec.id + ': a hotkey needs an id.'); return null; }
                var id = 'addon:' + rec.id + ':' + cleanId(def.id);
                U.addHotkey({
                    id: id,
                    label: def.label || (rec.name || rec.id) + ': ' + def.id,
                    help: def.help || 'contributed by the addon "' + (rec.name || rec.id) + '"',
                    when: def.when,
                    run: function () { $.safe(def.run, 'addon ' + rec.id + ' hotkey ' + def.id); }
                });
                reg.hotkeys.push(id);
                rec.registered++;
                /* It starts unbound: $.cfg.hotkeys has no entry for an id the
                   settings defaults never heard of, and the keydown handler
                   returns on a missing code. Saying so beats a bind that
                   silently does nothing. */
                if (!$.cfg.hotkeys || !$.cfg.hotkeys[id]) {
                    api.log('info', rec.id + ': the hotkey "' + (def.label || def.id) +
                        '" is not bound to anything yet — bind it in Settings → Hotkeys.');
                }
                return id;
            },

            /* -------------------------------------------- console commands */
            command: function (name, fn, help) {
                var key = String(name || '').replace(/[^A-Za-z0-9_]/g, '');
                if (!key) { api.log('warn', rec.id + ': a command needs a name.'); return null; }
                if (Object.prototype.hasOwnProperty.call($.api, key) && !ownsCommand(rec.id, key)) {
                    api.log('warn', rec.id + ': GigaHack.api.' + key + ' is already taken by something ' +
                        'else, so it was not registered. Pick another name — "' + rec.id.replace(/-/g, '') +
                        key.charAt(0).toUpperCase() + key.slice(1) + '" is free.');
                    return null;
                }
                /* `args` is captured here and not read off `arguments` inside
                   the $.safe closure: an inner function has its own arguments
                   object, so reading it there hands the addon no parameters at
                   all and every call arrives with undefined for everything. */
                $.api[key] = function () {
                    var args = arguments;
                    return $.safe(function () { return fn.apply(null, args); },
                        'addon ' + rec.id + ' api.' + key, { error: 'the addon threw; Debug → Addons has the line' });
                };
                /* Ownership is kept HERE and not as a property on the function.
                   The action recorder replaces $.api entries with wrappers of
                   its own, and a marker on the function would then be gone —
                   so disable would decline to remove the very name it added. */
                commandOwners[key] = rec.id;
                commandHelp[key] = help || '';
                reg.commands.push(key);
                rec.registered++;
                /* The action recorder wraps $.api once per name and never
                   clears the flag, so a name deleted and added again is
                   invisible to it for the rest of the session. Wrapping now
                   catches the first registration, which is the one that
                   matters. */
                if ($.console && $.console.wrapApi) $.safe($.console.wrapApi, 'wrap addon api');
                return key;
            },

            /* ------------------------------------------------------ events */
            on: function (evt, fn) {
                var name = String(evt || '');
                if (!subs[name]) {
                    api.log('warn', rec.id + ': there is no "' + name + '" event. The ones an addon can ' +
                        'subscribe to are ' + EVENTS.map(function (e) { return e.id; }).join(', ') + '.');
                    return null;
                }
                var sub = { id: rec.id, fn: fn, evt: name };
                subs[name].push(sub);
                reg.events.push(sub);
                rec.registered++;
                return sub;
            },

            /* ----------------------------------------------------- profile */
            profile: function (def) {
                if (!$.profile || !$.profile.register) {
                    api.log('warn', rec.id + ': GigaHack_Profile did not load, so a profile cannot be ' +
                        'registered here.');
                    return false;
                }
                var ok = $.safe(function () { return $.profile.register(def); }, 'addon profile ' + rec.id, false);
                if (ok) {
                    reg.profiles.push(def && def.id ? def.id : '(no id)');
                    rec.registered++;
                    api.log('info', rec.id + ': the profile "' + ((def && def.id) || '?') + '" is registered ' +
                        'and takes effect from the NEXT launch. Profile resolution is memoised at boot and ' +
                        'four things downstream have already read it; Settings → Addons offers a re-resolve ' +
                        'with what it does and does not move named beside it.');
                }
                return ok;
            },

            /* ------------------------------------------------------ hooks */
            hook: function (name, owner, method, factory, reason) {
                var full = String(name || (method || 'alias')) + ' (addon:' + rec.id + ')';
                if (Object.prototype.hasOwnProperty.call($.hooks, full)) {
                    api.log('warn', rec.id + ': the alias "' + full + '" is already installed. An alias ' +
                        'cannot be installed twice and cannot be removed once something has aliased on ' +
                        'top, so the first one stands — and it still consults this addon\'s enabled flag.');
                    return false;
                }
                var stacked = ourOwnPatch(owner, method);
                var ok = $.install(full, owner, method, function (original) {
                    var made = factory(original);
                    if (typeof made !== 'function') {
                        throw new Error('the factory did not return a function');
                    }
                    /* THE WHOLE REASON THIS IS A WRAPPER. An alias cannot be
                       taken back out of a chain, so disabling the addon must
                       not try: the wrapper stays where it is forever and turns
                       into a pass-through the moment the flag goes false. */
                    return function () {
                        if (!rec.enabled) return original.apply(this, arguments);
                        return made.apply(this, arguments);
                    };
                }, reason || ('the addon "' + (rec.name || rec.id) + '" wanted to alias ' + method +
                    ' and this build does not have it, so whatever that alias was for is not happening.'));
                if (ok) {
                    reg.hooks.push(full);
                    rec.registered++;
                    if (stacked) {
                        api.log('warn', rec.id + ': this alias went on top of one of GigaHack\'s own (' +
                            stacked + '). GigaHack\'s hook will now read as over-patched and the "aliases" ' +
                            'self-test will fail until the baseline is retaken — Debug → Addons has the ' +
                            'button, and retaking it also erases evidence of any genuine third-party ' +
                            'over-patch from before now.');
                    }
                }
                return ok;
            },

            /* ------------------------------------------------------ store */
            store: makeAddonStore(rec),

            /* --------------------------------------------------- utilities */
            log: function (level, msg) {
                if (msg === undefined) { msg = level; level = 'info'; }
                return $.log(level, '[' + rec.id + '] ' + msg);
            },
            toast: function (o) { return U.toast(o); },
            w: W, h: h, cols: cols, kv: kv,

            caps: $.caps,
            eng: $.eng,
            compat: $.compat || null,
            profileOf: function () { return $.profile ? $.profile.active() : null; },
            watch: $.watch || null,
            journal: $.journal || null,
            interp: $.interp || null,
            rng: $.rng || null,
            snap: $.snap || null,

            /**
             * A module's namespace, or null and the reason. An addon that asks
             * gets a sentence it can print; one that assumes gets a throw on a
             * game where the module is simply not installed.
             */
            need: function (key) {
                var k = String(key || '');
                if ($[k]) return $[k];
                var file = moduleOf(k);
                api.log('info', rec.id + ': ' + (file
                    ? file + ' did not load, so GigaHack.' + k + ' is not there. Debug → Environment ' +
                      'lists which modules ran.'
                    : 'there is no GigaHack.' + k + ' in this version.'));
                return null;
            },

            game: makeGameApi(rec)
        };
        return api;
    }

    var commandOwners = {};
    var commandHelp = {};
    function ownsCommand(id, key) {
        return Object.prototype.hasOwnProperty.call(commandOwners, key) && commandOwners[key] === id;
    }

    /** Is owner[method] currently a function GigaHack itself installed? */
    function ourOwnPatch(owner, method) {
        if (!owner || !method) return null;
        var names = Object.keys($.hooks), i, hk;
        for (i = 0; i < names.length; i++) {
            hk = $.hooks[names[i]];
            if (hk && hk.installed && hk.patched === owner[method]) return hk.name;
        }
        return null;
    }

    /**
     * An addon's own persisted file, namespaced so two addons cannot collide
     * and so removing one takes its data with it.
     */
    function makeAddonStore(rec) {
        var file = 'addon-' + rec.id + '.json';
        function all() {
            var raw = $.store.read(file, null);
            return (raw && typeof raw === 'object') ? raw : {};
        }
        if ($.store.declareFile) {
            $.safe(function () {
                $.store.declareFile(file, 'data kept by the addon "' + (rec.name || rec.id) + '"');
            }, 'declare addon file');
        }
        return {
            file: function () { return file; },
            all: all,
            read: function (key, fallback) {
                var o = all();
                return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : fallback;
            },
            write: function (key, value) {
                var o = all(); o[key] = value;
                $.store.write(file, o, true);
                return value;
            },
            /* Debounced. For anything a slider or a drag drives, so sixty
               changes a second collapse into one file write. */
            save: function (key, value) {
                var o = all(); o[key] = value;
                $.store.save(file, o);
                return value;
            },
            remove: function (key) {
                var o = all();
                if (key === undefined) return $.store.remove(file);
                delete o[key];
                $.store.write(file, o, true);
                return true;
            }
        };
    }

    /**
     * Guarded state. An addon does not have to know the write-verify
     * convention to be a good citizen: every write here is read back the way
     * the rest of the menu reads its writes, and returns the same
     * {ok, got, want, culprits, message}.
     *
     * An addon can still reach $gameVariables directly and this module does
     * not pretend otherwise — that is §3.7, and a menu that lied about it
     * would be worse than one that says it plainly.
     */

    /**
     * The five fields, and none of them invented.
     *
     * The module fast-paths — $.vars.setVar, $.vars.setSwitch, $.inv.setGold —
     * are preferred because they are the ones that push the undo entry, move a
     * freeze and log the before/after. What they hand back is a boolean (or,
     * for gold, a result object), so the {ok, got, want, culprits, message}
     * this promises used to be hand-built around it with `culprits: []` and
     * "the write did not stick — the log says why". $.compat.verify had
     * already named the plugins one call deeper and written the sentence, and
     * both were thrown away: an addon printing res.culprits — the obvious
     * thing to do with the shape it was handed — told the player nothing was
     * to blame while the log named something. So the failure is read back off
     * $.compat, which is where it was recorded.
     */
    function resultOf(control, ok, got, want, message) {
        if (ok) return { ok: true, got: got, want: want, culprits: [], message: '' };
        var K = $.compat;
        var why = message || '';
        if (!why && K && K.isDegraded && K.isDegraded(control)) why = K.degradedWhy(control);
        if (!why) {
            why = 'the write was refused before it was read back, so ' + control + ' is not marked ' +
                'degraded and nothing can be named as the cause. The log has the reason it was refused.';
        }
        return {
            ok: false, got: got, want: want,
            culprits: (K && K.likelyCulprits) ? $.safe(function () { return K.likelyCulprits(control); },
                'addon culprits ' + control, []) : [],
            message: why
        };
    }

    function makeGameApi(rec) {
        function alive() {
            return $.safe(function () {
                return typeof $gameVariables !== 'undefined' && !!$gameVariables;
            }, 'addon game alive', false);
        }
        return {
            alive: alive,
            mapId: function () { return $.safe(function () { return $gameMap.mapId(); }, 'addon mapId', 0); },
            varValue: function (id) {
                return $.safe(function () { return $gameVariables.value(id); }, 'addon var read', null);
            },
            switchValue: function (id) {
                return $.safe(function () { return $gameSwitches.value(id); }, 'addon switch read', null);
            },
            gold: function () { return $.safe(function () { return $gameParty.gold(); }, 'addon gold', 0); },

            setVar: function (id, value) {
                if (!alive()) return { ok: false, got: null, want: value, culprits: [], message: 'no game is running.' };
                if (!$.allowWrite('addon ' + rec.id + ': variable #' + id)) {
                    return { ok: false, got: null, want: value, culprits: [], message: 'read-only mode is on.' };
                }
                if ($.vars && $.vars.setVar) {
                    var ok = $.vars.setVar(id, value, 'addon ' + rec.id + ': variable #' + id);
                    var got = $.safe(function () { return $gameVariables.value(id); }, 'addon var read', null);
                    return resultOf('vars.set', !!ok, got, value, '');
                }
                return verify('vars.set',
                    function () { $gameVariables.setValue(id, value); },
                    function () { return $gameVariables.value(id); }, value);
            },
            setSwitch: function (id, on) {
                if (!alive()) return { ok: false, got: null, want: !!on, culprits: [], message: 'no game is running.' };
                if (!$.allowWrite('addon ' + rec.id + ': switch #' + id)) {
                    return { ok: false, got: null, want: !!on, culprits: [], message: 'read-only mode is on.' };
                }
                if ($.vars && $.vars.setSwitch) {
                    var ok = $.vars.setSwitch(id, !!on, 'addon ' + rec.id + ': switch #' + id);
                    var got = $.safe(function () { return $gameSwitches.value(id); }, 'addon switch read', null);
                    return resultOf('switches.set', !!ok, got, !!on, '');
                }
                return verify('switches.set',
                    function () { $gameSwitches.setValue(id, !!on); },
                    function () { return $gameSwitches.value(id); }, !!on);
            },
            setGold: function (n) {
                if (!alive()) return { ok: false, got: null, want: n, culprits: [], message: 'no game is running.' };
                if (!$.allowWrite('addon ' + rec.id + ': gold')) {
                    return { ok: false, got: null, want: n, culprits: [], message: 'read-only mode is on.' };
                }
                if ($.inv && $.inv.setGold) {
                    /* setGold returns a RESULT OBJECT and not a boolean, so
                       `!!it` was true even when the write had been clamped:
                       an addon asking for more gold than this game's cap
                       allows was told the write stuck. Read its own ok. */
                    var res = $.safe(function () { return $.inv.setGold(n); }, 'addon setGold', null);
                    var got = $.safe(function () { return $gameParty.gold(); }, 'addon gold', 0);
                    return resultOf('inv.gold', !!(res && res.ok), got, n,
                        (res && !res.ok && res.message) ? res.message : '');
                }
                return verify('inv.gold',
                    function () { $gameParty.gainGold(n - $gameParty.gold()); },
                    function () { return $gameParty.gold(); }, n);
            }
        };
    }

    /* =====================================================================
       8. THE CRASH GUARD AND SAFE MODE

       ENABLED IS NOT THE SAME AS LOADED. A file naming the addon about to be
       evaluated is written before it runs and removed after, so an addon that
       took the game down with it is named at the next launch instead of taking
       it down again. The same trick the mod already uses for settings that are
       unsafe at boot.
       ===================================================================== */
    /* TWO VARIABLES AND NOT ONE, because they answer different questions and
       one of them used to answer both wrongly.

       `quarantined` is what the marker said on THIS load pass, and it is
       assigned on every pass. Left holding the first pass's value, it made the
       "rescan the folder" button switch an addon the player had since repaired
       and turned back on straight off again, with a stated reason — "it was
       loading when the game last stopped" — that had not happened that launch.

       `lastQuarantined` is the name for the panel: "the addon that was loading
       when the game last stopped" stays true for the whole launch even after
       the player has switched it back on. Whether the quarantine is still IN
       FORCE is a fact about the record, and the panel reads it there. */
    var quarantined = null;
    var lastQuarantined = null;
    var safeModeReason = '';

    function readMarker() {
        var raw = $.store.read(LOADING_FILE, null);
        return (raw && raw.id) ? String(raw.id) : null;
    }
    function markLoading(id) { $.store.write(LOADING_FILE, { id: id, at: $.stamp ? $.stamp() : '' }, true); }
    function clearMarker() { $.store.remove(LOADING_FILE); }

    /**
     * Safe mode: skip every addon this launch.
     *
     * Two ways in, and they answer different problems. The switch survives one
     * relaunch and is the reliable one — it is a file, and a file does not
     * depend on when the browser got round to delivering a keystroke. The held
     * key is the convenient one and is honest about its limit: a key is only
     * seen if a keydown has reached this page by the time addons load, which
     * is at the moment the overlay mounts.
     */
    var held = {};
    $.safe(function () {
        window.addEventListener('keydown', function (e) { held[e.code] = true; }, true);
        window.addEventListener('keyup', function (e) { delete held[e.code]; }, true);
    }, 'addon safe-mode listener');

    /** Test seam, in the same spirit as the text module's held-key hook. */
    A._setHeld = function (code, down) {
        if (down === false) delete held[code]; else held[code] = true;
        return held;
    };

    A.safeModeKey = function () {
        return ($.cfg.hotkeys && $.cfg.hotkeys.panicHide) || 'Delete';
    };

    A.safeModeArmed = function () { return !!$.store.cfgGet('addons.safeMode', false); };
    A.armSafeMode = function (on) {
        $.store.cfgSet('addons.safeMode', !!on);
        bump();
        return !!on;
    };

    function safeModeNow() {
        if (A.safeModeArmed()) {
            return 'the "skip every addon next launch" switch was on. It has been turned off again, ' +
                'so the next launch loads them normally.';
        }
        var key = A.safeModeKey();
        if (key && held[key]) {
            return 'the panic-hide key (' + (U.prettyCode ? U.prettyCode(key) : key) + ') was held while ' +
                'addons loaded.';
        }
        return '';
    }

    /* =====================================================================
       9. LOADING, ENABLING, DISABLING
       ===================================================================== */
    function applyHeader(rec, src) {
        var hd = A.header(src);
        rec.hasHeader = hd.has;
        rec.headerWhy = hd.why;
        rec.name = hd.name || rec.name || rec.id;
        rec.version = hd.version || '';
        rec.author = hd.author || '';
        rec.game = hd.game || '';
        rec.needs = hd.needs || [];
        rec.help = hd.help || '';
        return hd;
    }

    /**
     * The identity a discovered file is listed under.
     *
     * @id when the file declares one, the file name otherwise — and ALWAYS
     * through cleanId. Both halves of that were wrong on the folder route, and
     * the folder is one of the two install-by-hand routes:
     *
     *   · The README and the import review both present @id as the identity,
     *     and applyHeader reads it and throws it away. A file called
     *     "My Addon (v2).js" declaring "@id my-addon" was listed under
     *     "My Addon (v2)", so enablement was keyed on the file name and
     *     renaming the file orphaned it.
     *   · The raw basename went through as the id with no cleanId, and the
     *     comment above cleanId names exactly what that costs: "town.gold"
     *     becomes the hotkey id "addon:town.gold:go", cfgSet descends on the
     *     dot when Settings → Hotkeys binds it, and the binding UI shows a key
     *     that can never fire.
     */
    function identityOf(name, src) {
        var hd = (src === null || src === undefined) ? null
            : $.safe(function () { return A.header(src); }, 'addon header of ' + name, null);
        var id = cleanId(hd && hd.id ? hd.id : name);
        if (!id) id = cleanId(name);
        /* A name with nothing in it a settings path can carry — "...", "!!!" —
           still has to be listable, and a digest of the name is stable across
           launches, so its enablement survives one. */
        if (!id) id = 'addon-' + digestOf(name);
        return id;
    }

    /**
     * An addon's own data file is keyed on its id, so an id that changes has to
     * take its data with it or the addon comes back empty with nothing anywhere
     * saying why. Only when the destination holds nothing: something already
     * there belongs to another addon and is not ours to overwrite.
     */
    function renameData(oldId, newId) {
        $.safe(function () {
            var from = 'addon-' + oldId + '.json', to = 'addon-' + newId + '.json';
            var kept = $.store.read(from, null);
            if (kept === null || kept === undefined) return;
            if ($.store.read(to, null) !== null) {
                $.log('warn', 'the addon data in ' + from + ' was left where it is: ' + to +
                    ' already has something in it.');
                return;
            }
            $.store.write(to, kept, true);
            $.store.remove(from);
        }, 'move addon data ' + oldId);
    }

    /**
     * Evaluate one addon and let it register.
     *
     * The exception IS the product here, so this is the one place with a bare
     * try/catch rather than a $.safe: $.safe swallows the error and returns a
     * fallback, and the fallback cannot say which line. The whole block is
     * still inside a $.safe at the call site, so nothing escapes into a frame.
     */
    /* A monotonic clock, and deliberately NOT U.ui's now(): that one is the
       wall time formatted as "12:34:56" for the log drawer, and subtracting
       two of those is NaN — which is exactly what the timing column in
       Debug → Addons showed until somebody looked at it. */
    function clock() {
        return (typeof performance === 'object' && performance &&
            typeof performance.now === 'function') ? performance.now() : Date.now();
    }

    function evaluate(rec) {
        var t0 = clock();
        var tag = SOURCE_PREFIX + rec.id;
        var fn, registeredAnything;

        try {
            /* eslint-disable-next-line no-new-func */
            fn = new Function('GigaHack', 'addon', String(rec.src) + '\n//# sourceURL=' + tag);
        } catch (e) {
            return fail(rec, e, tag, 'it does not compile');
        }

        var api = makeApi(rec);
        var setups = [];
        function collect(setup) {
            if (typeof setup !== 'function') {
                api.log('warn', rec.id + ': GigaHack.addon() was called with something that is not a ' +
                    'function, so there is nothing to run.');
                return false;
            }
            setups.push(setup);
            return true;
        }

        /* Both spellings work: the second argument is the same function as
           GigaHack.addon bound to this file, so an addon written either way
           loads, and one that calls neither is "registered nothing" said out
           loud rather than treated as success. */
        var previous = $.addon;
        $.addon = collect;
        try {
            fn(window.GigaHack, collect);
        } catch (e) {
            $.addon = previous;
            return fail(rec, e, tag, 'it threw while loading');
        }
        $.addon = previous;

        rec.registered = 0;
        var i;
        for (i = 0; i < setups.length; i++) {
            try {
                setups[i](api);
            } catch (e) {
                return fail(rec, e, tag, 'its setup threw');
            }
        }

        rec.ms = Math.round((clock() - t0) * 100) / 100;
        rec.error = null;
        rec.line = null;
        /* Fresh subscriptions, so the throw count that stopped the last set of
           them is not still on the row describing this set. */
        rec.eventThrow = null;
        registeredAnything = rec.registered > 0;
        rec.state = registeredAnything ? 'loaded' : 'inert';
        if (!setups.length) {
            rec.state = 'inert';
            $.log('warn', 'addon "' + rec.id + '" loaded and never called GigaHack.addon(), so it ' +
                'registered nothing. That is not an error and it is not success either.');
        } else if (!registeredAnything) {
            $.log('warn', 'addon "' + rec.id + '" ran its setup and registered nothing at all.');
        } else {
            $.log('ok', 'addon "' + rec.id + '" loaded in ' + rec.ms + 'ms — ' +
                describeRegistrations(rec));
        }
        return true;
    }

    function fail(rec, e, tag, what) {
        var raw = lineFrom(e, tag);
        rec.line = (typeof raw === 'number' && lineBias !== null) ? Math.max(1, raw - lineBias) : raw;
        rec.error = (e && e.message ? e.message : String(e));
        rec.state = 'failed';
        rec.enabled = false;
        rec.ms = 0;
        teardown(rec, 'it failed');
        $.log('err', 'addon "' + rec.id + '" is disabled because ' + what +
            (rec.line ? ' at line ' + rec.line : '') + ' — ' + rec.error);
        return false;
    }

    function describeRegistrations(rec) {
        var r = rec.reg, bits = [];
        if (r.panels.length) bits.push(r.panels.length + ' panel(s)');
        if (r.hotkeys.length) bits.push(r.hotkeys.length + ' hotkey(s)');
        if (r.commands.length) bits.push(r.commands.length + ' command(s)');
        if (r.events.length) bits.push(r.events.length + ' event subscription(s)');
        if (r.hooks.length) bits.push(r.hooks.length + ' alias(es), permanent');
        if (r.profiles.length) bits.push(r.profiles.length + ' profile(s), from the next launch');
        return bits.length ? bits.join(', ') : 'nothing';
    }
    A.describeRegistrations = describeRegistrations;

    /**
     * Take back everything that can be taken back.
     *
     * Panels, hotkeys, console commands and event subscriptions go. Aliases
     * and profiles stay, by the rules at the top of this file, and the record
     * keeps them so the panel can say what is still standing.
     */
    function teardown(rec, why) {
        var r = rec.reg;
        r.panels.forEach(function (p) {
            $.safe(function () { U.removePanel(p.tab, p.name); }, 'remove addon panel ' + p.name);
        });
        r.hotkeys.forEach(function (id) {
            $.safe(function () { U.removeHotkey(id); }, 'remove addon hotkey ' + id);
        });
        r.commands.forEach(function (key) {
            if (!ownsCommand(rec.id, key)) return;
            delete $.api[key];
            delete commandOwners[key];
            delete commandHelp[key];
        });
        r.events.forEach(function (sub) {
            var list = subs[sub.evt];
            if (!list) return;
            var i = list.indexOf(sub);
            if (i > -1) list.splice(i, 1);
        });
        var keptHooks = r.hooks.slice(), keptProfiles = r.profiles.slice();
        rec.reg = newReg();
        rec.reg.hooks = keptHooks;
        rec.reg.profiles = keptProfiles;
        rec.registered = 0;
        if (why && (keptHooks.length || keptProfiles.length)) {
            $.log('info', 'addon "' + rec.id + '" ' + why + '. ' +
                (keptHooks.length ? keptHooks.length + ' alias(es) stay installed as pass-throughs — ' +
                    'an alias cannot be pulled out of a chain once anything has aliased on top. ' : '') +
                (keptProfiles.length ? 'Its profile stays registered and is only re-read at the next ' +
                    'launch. ' : ''));
        }
        bump();
    }

    /* ------------------------------------------------------- the load pass */
    var loaded = false;

    /**
     * Read the index, scan for files, parse every header WITHOUT running
     * anything, then evaluate the enabled ones one at a time behind the crash
     * marker. One addon's failure never touches another: each is compiled, set
     * up and torn down on its own.
     */
    A.load = function (reason) {
        return $.safe(function () {
            /* THE MARKER DESCRIBES THIS PASS. Assigned unconditionally, so a
               later pass — the "rescan the folder" button, A.reload() — cannot
               re-apply a quarantine the player has already dealt with. */
            var marker = readMarker();
            quarantined = marker || null;
            if (marker) lastQuarantined = marker;
            var safe = safeModeNow();
            if (A.safeModeArmed()) A.armSafeMode(false);
            safeModeReason = safe;

            var index = readIndex();
            var found = {}, notes = [];
            var indexIds = {};      // the ids this index resolved to, for a collision
            var claims = {};        // id -> {path, scope}: the file that claimed it this pass
            var pre = {};           // id -> {src, error}: read once while resolving identity

            /* Everything the index knows about, whether or not there is a file
               for it — an addon whose file has gone is a row that says so, not
               a row that quietly disappeared.

               The key is cleaned on the way in, because an index written
               before ids were cleaned holds the raw file name, and a record
               keyed on "town.gold" cannot be found again once the folder scan
               lists the same file as "town-gold". Re-keying carries the
               addon's own data file with it. */
            Object.keys(index).forEach(function (rawId) {
                var e = index[rawId] || {};
                var id = cleanId(rawId) || rawId;
                if (id !== rawId && Object.prototype.hasOwnProperty.call(indexIds, id)) {
                    $.log('warn', 'the addons index holds both "' + rawId + '" and "' + id +
                        '", which are one identity once cleaned. "' + rawId + '" keeps its old key so ' +
                        'neither enablement is lost; remove one of them in Settings → Addons.');
                    id = rawId;
                } else if (id !== rawId) {
                    renameData(rawId, id);
                    $.log('info', 'the addon listed as "' + rawId + '" is listed as "' + id + '" from ' +
                        'now on — an id becomes part of the dotted settings path hotkeys.<id>, and a ' +
                        'dot there writes a nested object no keypress can match. Its file is still ' +
                        rawId + '.js.');
                }
                indexIds[id] = true;
                var rec = addons[id] || blank(id);
                rec.enabled = !!e.enabled;
                rec.source = e.source || rec.source;
                rec.importedAt = e.importedAt || rec.importedAt;
                rec.url = e.url || rec.url;
                rec.scope = e.scope === 'library' ? 'library' : 'game';
                /* rawId and not id: the bytes are in the file the index was
                   written against, whatever the record is now called. */
                rec.file = e.file || rec.file || rawId;
                addons[id] = rec;
                found[id] = true;
            });

            /* Then the folders. A file on disk that the index has never heard
               of is listed, disabled — dropping one into the folder is a
               supported way to install one, and it still has to be switched
               on by hand. Its identity is its @id where it declares one, which
               is what the README and the import review both promise and what
               this route used to be the exception to. */
            var mine = scanDir(A.dir());
            var lib = scanDir(A.libraryDir());
            if (!mine.complete) notes.push(mine.why);
            if (!lib.complete) notes.push(lib.why);

            function adopt(name, scope) {
                var probe = { id: name, file: name, scope: scope, error: null };
                var src = readSource(probe);
                var id = identityOf(name, src);
                var where = pathFor(scope, name);
                var held = claims[id];
                if (held) {
                    if (held.scope === 'game' && scope === 'library') {
                        $.log('warn', 'the shared library holds an addon that claims the id "' + id +
                            '" and so does this game\'s own folder. This game\'s own wins; ' + where +
                            ' is not listed.');
                    } else {
                        $.log('warn', 'two files claim the addon id "' + id + '": ' + held.path +
                            ' is listed and ' + where + ' is not. Change @id in one of them.');
                    }
                    notes.push('"' + id + '" is claimed by two files; ' + where + ' is not listed.');
                    return;
                }
                claims[id] = { path: where, scope: scope };
                pre[id] = { src: src, error: probe.error };

                /* THE SAME FILE UNDER ITS OLD IDENTITY. Editing @id changes
                   what an addon is called, and the index row for the old name
                   still points at this file — so without this there are two
                   rows for one file and both of them are runnable. Its
                   enablement and its own data file come across, because that
                   is what the player meant by editing one line of a header. */
                Object.keys(addons).forEach(function (was) {
                    var o = addons[was];
                    if (was === id || !found[was] || o.scope !== scope || fileOf(o) !== name) return;
                    if (!addons[id]) {
                        addons[id] = blank(id);
                        addons[id].source = o.source;
                        addons[id].enabled = o.enabled;
                        addons[id].importedAt = o.importedAt;
                        addons[id].url = o.url;
                        renameData(was, id);
                    }
                    delete found[was];
                    $.log('info', 'the addon in ' + where + ' declares @id "' + id + '" now, so it is ' +
                        'listed under that instead of "' + was + '".');
                });

                var rec = addons[id];
                if (!rec) {
                    rec = addons[id] = blank(id);
                    rec.source = scope === 'library' ? 'library' : 'folder';
                }
                rec.file = name;
                rec.scope = scope;
                found[id] = true;
            }

            mine.names.forEach(function (n) { adopt(n, 'game'); });
            lib.names.forEach(function (n) { adopt(n, 'library'); });
            scanNote = notes.join(' ');

            /* Torn down BEFORE it is dropped. A record deleted while it still
               held registrations left its panel on the tab, its hotkey in the
               list and its console name on $.api with nothing left anywhere
               that knew where they had come from — which is what happens the
               first time the data directory moves under a running game. */
            Object.keys(addons).forEach(function (id) {
                if (found[id]) return;
                teardown(addons[id], null);
                delete addons[id];
            });

            /* HEADERS FIRST, FOR EVERY ADDON, ENABLED OR NOT. This is the half
               that runs nothing. */
            Object.keys(addons).forEach(function (id) {
                var rec = addons[id];
                teardown(rec, null);
                rec.state = 'listed';
                rec.error = index[id] && index[id].error ? index[id].error : null;
                rec.line = null;
                rec.ms = 0;
                rec.quarantined = false;
                rec.eventThrow = null;
                /* Already read, once, to answer "what is this called". Reading
                   it a second time here would double the boot I/O of a folder
                   that is allowed to hold two hundred files. */
                var seen = Object.prototype.hasOwnProperty.call(pre, id) ? pre[id] : null;
                var src = seen ? seen.src : readSource(rec);
                if (src === null) {
                    rec.src = null; rec.size = 0; rec.digest = '';
                    rec.state = 'missing';
                    if (seen && seen.error) rec.error = seen.error;
                    if (!rec.error) {
                        rec.error = 'there is no file for this addon' +
                            (onDisk() ? ' at ' + A.pathOf(id) : ' in the store') +
                            '. It is still listed so that removing it is a decision rather than a surprise.';
                    }
                    return;
                }
                rec.src = src;
                rec.size = src.length;
                rec.digest = digestOf(src);
                applyHeader(rec, src);
            });

            order = Object.keys(addons).sort();

            /* THE QUARANTINE IS APPLIED HERE, ABOVE THE SAFE-MODE BRANCH, and
               the marker is only cleared once it has been.

               The documented recovery from an addon that hangs the game is
               "skip every addon next launch" — and with the marker read and
               cleared at the top of this function and the quarantine applied
               at the bottom, that launch consumed the only record of the crash
               without acting on it. enabled was still true in addons.json, the
               marker was gone, and the launch after ran the addon and hung
               again: the player's exact recovery move disarmed the guard. */
            if (quarantined) {
                var qrec = addons[quarantined];
                if (qrec && qrec.enabled && qrec.state !== 'missing') {
                    qrec.quarantined = true;
                    qrec.state = 'quarantined';
                    qrec.enabled = false;
                    /* warn, not err: nothing has failed at this moment. The
                       failure was last launch, this launch declined to repeat
                       it, and an error line here would say the guard is broken
                       when the guard is the thing that worked. */
                    $.log('warn', 'addon "' + quarantined + '" was loading when the game last stopped, ' +
                        'so it is quarantined and was NOT run. Settings → Addons can switch it back on ' +
                        'once you know why — nothing here can tell whether it was the cause.');
                }
            }
            clearMarker();

            if (safe) {
                order.forEach(function (id) {
                    if (addons[id].enabled) addons[id].state = 'skipped';
                });
                $.log('warn', 'safe mode: every addon was skipped this launch because ' + safe);
                /* Written even on this branch. The quarantine above switched
                   an addon off, and a decision that is not persisted is one
                   the next launch does not know about. */
                writeIndex(true);
                loaded = true;
                bump();
                if (U.isOpen && U.isOpen()) $.safe(function () { U.rerender(); }, 'addons rerender');
                return A.list();
            }

            order.forEach(function (id) {
                var rec = addons[id];
                /* A quarantined record is already enabled:false, above. */
                if (!rec.enabled) return;
                if (rec.state === 'missing') return;
                markLoading(id);
                $.safe(function () { evaluate(rec); }, 'addon ' + id);
                clearMarker();
            });

            writeIndex(true);
            loaded = true;
            bump();
            var on = order.filter(function (id) { return addons[id].state === 'loaded'; });
            $.log(on.length ? 'ok' : 'info', 'addons: ' + order.length + ' listed, ' + on.length +
                ' loaded' + (reason ? ' (' + reason + ')' : '') + '. ' +
                (onDisk() ? A.dir() : 'kept in the settings store'));
            if (U.isOpen && U.isOpen()) $.safe(function () { U.rerender(); }, 'addons rerender');
            return A.list();
        }, 'addon load pass', []);
    };

    A.reload = function (reason) { return A.load(reason || 'reloaded by hand'); };
    A.hasLoaded = function () { return loaded; };
    A.safeModeReason = function () { return safeModeReason; };
    /** The name the marker gave at any point this launch — not whether the
        quarantine is still in force, which is `state` on the record. */
    A.quarantinedId = function () { return lastQuarantined; };
    A.scanNote = function () { return scanNote; };

    /* --------------------------------------------------- enable and disable */
    A.enable = function (id) {
        var rec = addons[id];
        if (!rec) return { ok: false, why: 'there is no addon called "' + id + '".' };
        if (!$.allowWrite('Enabling the addon "' + id + '"')) return { ok: false, why: 'read-only mode is on.' };
        if (rec.state === 'missing') {
            return { ok: false, why: rec.error || 'there is no file for this addon.' };
        }
        if (rec.src === null) rec.src = readSource(rec);
        if (rec.src === null) return { ok: false, why: 'its file could not be read.' };

        rec.enabled = true;
        rec.quarantined = false;
        markLoading(id);
        var ok = $.safe(function () { return evaluate(rec); }, 'addon ' + id, false);
        clearMarker();
        writeIndex(true);
        bump();
        if (U.isOpen && U.isOpen()) $.safe(function () { U.rerender(); }, 'addons rerender');
        return ok
            ? { ok: true, why: '', registered: describeRegistrations(rec) }
            : { ok: false, why: rec.error || 'it threw while loading.', line: rec.line };
    };

    A.disable = function (id) {
        var rec = addons[id];
        if (!rec) return { ok: false, why: 'there is no addon called "' + id + '".' };
        if (!$.allowWrite('Disabling the addon "' + id + '"')) return { ok: false, why: 'read-only mode is on.' };
        rec.enabled = false;
        rec.state = 'listed';
        teardown(rec, 'was switched off');
        writeIndex(true);
        bump();
        if (U.isOpen && U.isOpen()) $.safe(function () { U.rerender(); }, 'addons rerender');
        return { ok: true, why: '', keptHooks: rec.reg.hooks.length, keptProfiles: rec.reg.profiles.length };
    };

    A.toggle = function (id) {
        var rec = addons[id];
        if (!rec) return { ok: false, why: 'there is no addon called "' + id + '".' };
        return rec.enabled ? A.disable(id) : A.enable(id);
    };

    /** Re-read the file from disk and run it again if it was on. */
    A.reloadOne = function (id) {
        var rec = addons[id];
        if (!rec) return { ok: false, why: 'there is no addon called "' + id + '".' };
        var wasOn = rec.enabled;
        if (wasOn) A.disable(id);
        var src = readSource(rec);
        if (src === null) {
            rec.state = 'missing';
            bump();
            return { ok: false, why: 'its file could not be read now.' };
        }
        rec.src = src; rec.size = src.length; rec.digest = digestOf(src);
        var hd = applyHeader(rec, src);
        /* Reading a file again does not re-key the row it is on: the id is
           what the record, the hotkeys and the data file are all named after,
           and moving it is a whole load pass. Said rather than left for the
           next @id edit to be a surprise. */
        if (hd.id && cleanId(hd.id) && cleanId(hd.id) !== rec.id) {
            $.log('info', 'the file for "' + rec.id + '" declares @id "' + cleanId(hd.id) + '" now. ' +
                'Reading it again keeps the row it is on — "rescan the folder" in Settings → Addons ' +
                'is what moves it, and that carries its enablement and its data across.');
        }
        bump();
        if (!wasOn) return { ok: true, why: 'read again; it is still switched off.' };
        return A.enable(id);
    };

    /**
     * Delete the file and forget the addon.
     *
     * THE LIBRARY COPY IS THE ONLY COPY. dirFor('library') is the shared
     * folder, so removing a library-scoped addon unlinks the file every game
     * on this machine reads — and the rule three sections up is that
     * enablement is per game precisely because one machine-wide switch is not
     * what anybody means. Removal is the destructive direction of that same
     * argument, and nothing in the button, its confirm, the detail rows or the
     * returned message used to say which copy was going.
     *
     * So the shared delete has to be asked for. The panel asks by naming the
     * consequence in the confirm; from the console there is no confirm at all,
     * which is why the flag has to be typed.
     */
    A.remove = function (id, opts) {
        var rec = addons[id];
        if (!rec) return { ok: false, why: 'there is no addon called "' + id + '".' };
        if (!$.allowWrite('Removing the addon "' + id + '"')) return { ok: false, why: 'read-only mode is on.' };
        var shared = rec.scope === 'library';
        var where = A.pathOf(id);
        if (shared && !(opts && opts.shared)) {
            return {
                ok: false, shared: true,
                why: '"' + id + '" is in the shared library at ' + (where || 'the store') +
                    '. Removing it deletes the only copy, and every game on this machine loses it — ' +
                    'switching it off here is per game, this is not. Settings → Addons has the button, ' +
                    'and its confirm says so; from the console it is ' +
                    'GigaHack.addons.remove("' + id + '", { shared: true }).'
            };
        }
        if (rec.enabled) A.disable(id);
        var kept = rec.reg.hooks.length;
        deleteSource(rec);
        $.store.remove('addon-' + id + '.json');
        delete addons[id];
        order = order.filter(function (x) { return x !== id; });
        writeIndex(true);
        bump();
        if (U.isOpen && U.isOpen()) $.safe(function () { U.rerender(); }, 'addons rerender');
        return {
            ok: true, shared: shared,
            why: (shared ? 'the shared copy at ' + (where || 'the store') + ' is gone, so every game ' +
                'on this machine has lost it. ' : '') +
                (kept ? kept + ' alias(es) it installed are still in place as pass-throughs and only a ' +
                'restart takes them out.' : '')
        };
    };

    /* ------------------------------------------------------------ read-out */
    A.get = function (id) { return addons[id] || null; };

    A.list = function () {
        return order.filter(function (id) { return !!addons[id]; }).map(function (id) {
            var r = addons[id];
            return {
                id: r.id, name: r.name || r.id, version: r.version, author: r.author,
                game: r.game, needs: r.needs.slice(), help: r.help,
                hasHeader: r.hasHeader, headerWhy: r.headerWhy,
                enabled: r.enabled, state: r.state, error: r.error, line: r.line,
                size: r.size, digest: r.digest, ms: r.ms, scope: r.scope,
                file: fileOf(r),
                source: r.source, url: r.url, importedAt: r.importedAt,
                quarantined: r.quarantined,
                eventThrow: r.eventThrow ? {
                    evt: r.eventThrow.evt, message: r.eventThrow.message, line: r.eventThrow.line,
                    count: r.eventThrow.count, stopped: r.eventThrow.stopped
                } : null,
                registered: describeRegistrations(r),
                panels: r.reg.panels.slice(),
                hotkeys: r.reg.hotkeys.slice(),
                commands: r.reg.commands.slice(),
                events: r.reg.events.map(function (s) { return s.evt; }),
                hooks: r.reg.hooks.slice(),
                profiles: r.reg.profiles.slice()
            };
        });
    };

    A.apiSurface = function () { return API_DOC.slice(); };
    A.events = function () { return EVENTS.slice(); };

    /* =====================================================================
       10. IMPORTING

       Five sources, one destination: a REVIEW that shows what arrived before
       anything runs. Nothing imported is enabled by the act of importing.
       ===================================================================== */
    var staged = null;

    A.staged = function () { return staged; };
    A.discard = function () { staged = null; bump(); };

    function hostOf(url) {
        var m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/.exec(String(url || ''));
        return m ? { scheme: m[1].toLowerCase(), host: m[2] } : { scheme: '', host: '' };
    }
    A.hostOf = hostOf;

    /**
     * Put something in front of the user. Runs nothing, installs nothing, and
     * every refusal names what it looked at.
     */
    A.stage = function (o) {
        o = o || {};
        var text = String(o.text == null ? '' : o.text);
        staged = null;

        if (!text.replace(/^\s+|\s+$/g, '')) {
            return { ok: false, why: 'there is nothing to look at — the text is empty.' };
        }
        if (text.length > MAX_BYTES) {
            return {
                ok: false,
                why: 'that is ' + text.length + ' characters and the ceiling is ' + MAX_BYTES +
                    '. Nothing this big is an addon; a fetch that went to the wrong place is the usual cause.'
            };
        }
        var look = A.inspect(text);
        if (!look.ok) {
            return { ok: false, why: 'refused by inspection: ' + look.why, first: look.first, line: look.line };
        }

        var hd = A.header(text);
        var id = cleanId(hd.id || o.name || '');
        if (!id) {
            id = cleanId((o.name || 'addon-' + digestOf(text)));
        }
        var clash = addons[id];
        if (clash && !o.replace) {
            return {
                ok: false, id: id,
                why: 'an addon already claims the id "' + id + '" (' + (A.pathOf(id) || 'in the store') +
                    '). Change @id in the file, or remove that one first.'
            };
        }

        staged = {
            id: id, text: text, size: text.length, digest: digestOf(text),
            header: hd, first: look.first,
            from: o.from || 'paste', url: o.url || null,
            host: o.url ? hostOf(o.url).host : null,
            via: o.via || null,
            replaces: !!clash
        };
        bump();
        return { ok: true, id: id, size: staged.size, digest: staged.digest, header: hd };
    };

    /**
     * Take what is on review and put it on disk, DISABLED. Enabling is a
     * separate, deliberate act and always was.
     */
    A.commit = function () {
        if (!staged) return { ok: false, why: 'there is nothing on review.' };
        if (!$.allowWrite('Importing the addon "' + staged.id + '"')) {
            return { ok: false, why: 'read-only mode is on.' };
        }
        var s = staged;
        var where = writeSource(s.id, s.text, 'game');
        if (!where) return { ok: false, why: 'the file could not be written. The log has the path it tried.' };

        /* TORN DOWN BEFORE IT IS OVERWRITTEN, and after the write rather than
           before it, so a write that fails takes nothing away.

           commit reuses the record when one is already listed under this id,
           and the previous version's registrations live on that record's reg.
           Neither the hotkey's run wrapper nor the $.api wrapper consults
           rec.enabled, so v1's hotkey and console command went on running
           under a row that read "off" — and switching it back on pushed a
           SECOND set into the same arrays, so one event fired both. */
        var rec = addons[s.id];
        if (rec) {
            rec.enabled = false;
            teardown(rec, 'it was replaced by an import');
        } else {
            rec = blank(s.id);
        }
        rec.file = s.id;
        rec.scope = 'game';
        rec.src = s.text;
        rec.size = s.size;
        rec.digest = s.digest;
        rec.source = s.from;
        rec.url = s.url;
        rec.importedAt = $.stamp ? $.stamp() : String(Date.now());
        rec.enabled = false;
        rec.state = 'listed';
        rec.error = null;
        rec.line = null;
        applyHeader(rec, s.text);
        addons[s.id] = rec;
        if (order.indexOf(s.id) < 0) order.push(s.id);
        order.sort();
        writeIndex(true);
        staged = null;
        bump();
        $.log('ok', 'addon "' + s.id + '" imported from ' + s.from + ' — it is NOT enabled. ' +
            'Settings → Addons switches it on.');
        if (U.isOpen && U.isOpen()) $.safe(function () { U.rerender(); }, 'addons rerender');
        return { ok: true, id: s.id, at: where, enabled: false };
    };

    /* ------------------------------------------------------------ clipboard
       There is no clipboard READ anywhere else in this mod — U.copyText is
       write-only and has no sibling — so the probe lives here, shaped like the
       fullest guard in the codebase: the env flag, then the object, then the
       method. A callback, not a return value, because the browser API is
       asynchronous and a synchronous "true" would be the same lie the write
       side already tells. */
    /* The probe the panel reads; the read itself lives beside U.copyText,
       because a second copy of "which clipboard does this build have" is how
       the write ended up implemented three times before 1.0. */
    A.clipboard = function () {
        var c = $.caps.clipboard();
        return { available: c.read, via: c.via, why: c.why };
    };

    A.readClipboard = function (cb) { U.readText(cb); };

    /* ----------------------------------------------------------------- link
       $.net picks the transport by feature detection and says which one it
       got. Nothing here re-fetches on its own, ever: "check the source again"
       is a button, it reports changed / unchanged / unreachable, and it still
       installs nothing. */
    /* Long enough for a slow link on a slow connection, and a setting rather
       than a constant because "it never answered" and "it was still coming"
       look identical from here and only the person waiting knows which. */
    function fetchTimeout() {
        var n = Math.floor($.store.cfgGet('addons.fetchTimeoutMs', 20000));
        return (n > 0 && isFinite(n)) ? n : 20000;
    }

    /* $.net arrives with Core and is the only thing in this module that is not
       reachable on an older one. It is asked for rather than assumed, because
       four of the five import sources work perfectly well without it and
       refusing the whole module over one of them would be the wrong trade. */
    function netAvailable() {
        return !!($.net && typeof $.net.get === 'function' && typeof $.net.transport === 'function');
    }
    var NO_NET = 'this build of GigaHack has no $.net, so a link cannot be fetched here. The other ' +
        'four sources — paste, clipboard, a file path and the folder — are unaffected.';

    A.transport = function () {
        return netAvailable() ? $.net.transport() : { id: null, why: NO_NET, missing: [] };
    };

    A.describeLink = function (url) {
        if (!netAvailable()) return NO_NET;
        var t = $.net.transport();
        var u = hostOf(url);
        if (!url) return 'Fetching is a request from this machine to somebody else\'s. Type a link and ' +
            'the host it would reach is named here before anything is sent.';
        if (u.scheme !== 'http' && u.scheme !== 'https') {
            return 'Only http and https links are fetched. "' + (u.scheme || 'that') +
                '" is not one of them — for a file already on this machine use the file source below.';
        }
        return 'This sends a request from your machine to ' + u.host + ', over ' +
            (t.id || 'no transport at all') + '. ' + t.why +
            (t.missing.length ? ' Not available here: ' +
                t.missing.map(function (m) { return m.id; }).join(', ') + '.' : '');
    };

    A.fetch = function (url, cb) {
        var u = hostOf(url);
        if (u.scheme !== 'http' && u.scheme !== 'https') {
            cb(new Error('only http and https links are fetched; "' + (u.scheme || 'that') +
                '" is not one of them.'), null);
            return;
        }
        if (!netAvailable()) { cb(new Error(NO_NET), null); return; }
        var t = $.net.transport();
        if (!t.id) { cb(new Error(t.why), null); return; }
        $.log('info', 'addons: fetching ' + url + ' over ' + t.id + ' (host ' + u.host + ')');
        $.net.get(url, function (err, res) {
            if (err) { cb(err, null); return; }
            if (!res) { cb(new Error('nothing came back from ' + url + '.'), null); return; }
            if (res.status >= 400 || res.status === 0) {
                cb(new Error(u.host + ' answered ' + res.status + ' for ' + res.url +
                    '. The first line of what it sent was: ' + firstLine(res.body)), null);
                return;
            }
            if (res.body && res.body.length > MAX_BYTES) {
                cb(new Error(u.host + ' sent ' + res.body.length + ' characters and the ceiling is ' +
                    MAX_BYTES + '.'), null);
                return;
            }
            cb(null, res);
        }, { timeoutMs: fetchTimeout() });
    };

    A.importLink = function (url, cb) {
        A.fetch(url, function (err, res) {
            if (err) { cb({ ok: false, why: err.message }); return; }
            var r = A.stage({ text: res.body, from: 'link', url: res.url || url, via: res.via });
            cb(r);
        });
    };

    /** Ask the source again. Reports, and installs nothing. */
    A.recheck = function (id, cb) {
        var rec = addons[id];
        if (!rec) { cb({ ok: false, why: 'there is no addon called "' + id + '".' }); return; }
        if (!rec.url) { cb({ ok: false, why: 'this addon did not come from a link, so there is no source to ask.' }); return; }
        A.fetch(rec.url, function (err, res) {
            if (err) { cb({ ok: false, state: 'unreachable', why: err.message }); return; }
            var d = digestOf(res.body);
            cb({
                ok: true,
                state: d === rec.digest ? 'unchanged' : 'changed',
                why: d === rec.digest
                    ? 'the source is byte-identical to the copy here (' + d + ').'
                    : 'the source has changed (' + rec.digest + ' → ' + d + '). Nothing has been ' +
                      'installed — review it and decide.',
                digest: d,
                text: res.body
            });
        });
    };

    /* ----------------------------------------------------------------- file */
    A.importFile = function (abs) {
        if (!onDisk()) {
            return { ok: false, why: $.caps.fsWhy || 'there is no filesystem here, so a path cannot be read.' };
        }
        var file = String(abs || '');
        if (!file) return { ok: false, why: 'type the absolute path of a .js file.' };
        var r = readable(file);
        if (r === null && !$.safe(function () { return fs().existsSync(file); }, 'exists', false)) {
            return { ok: false, why: 'there is nothing at ' + file + '.' };
        }
        if (r === false) {
            return {
                ok: false,
                why: file + ' is there and this process cannot read it. Fix it with: ' +
                    ($.repairCommand ? $.repairCommand() : 'chmod 644 on that file')
            };
        }
        var src = $.safe(function () { return fs().readFileSync(file, 'utf8'); }, 'read ' + file, null);
        if (src === null) return { ok: false, why: 'the read of ' + file + ' failed. The log has the reason.' };
        var base = String(file).split('/').pop().split('\\').pop().replace(/\.js$/i, '');
        return A.stage({ text: src, from: 'file', name: base });
    };

    /* --------------------------------------------------------------- folder */
    A.rescan = function () {
        var before = order.length;
        A.load('folder rescan');
        return { ok: true, before: before, after: order.length };
    };

    /* =====================================================================
       11. THE TEMPLATE

       A working addon, not a sketch. The button puts it on the clipboard and
       the panel's paste box takes it straight back, so "start from a template"
       is one round trip and not a documentation hunt.
       ===================================================================== */
    var TEMPLATE = [
        '/*:',
        ' * @gigahack-addon',
        ' * @id hello-addon',
        ' * @name Hello, addon',
        ' * @version 1.0.0',
        ' * @author you',
        ' * @needs vars',
        ' * @help A worked example. It adds a panel, a hotkey, a console call and',
        ' * one event listener — and every one of those goes away again when you',
        ' * switch it off. Edit it, paste it back in, and it replaces this one.',
        ' */',
        'GigaHack.addon(function (api) {',
        '',
        '    var W = api.w;',
        '',
        '    /* A panel, on any of the six tabs. Removed again on disable. */',
        '    api.panel(\'world\', \'Hello\', function () {',
        '        var opened = api.store.read(\'opened\', 0) + 1;',
        '        api.store.write(\'opened\', opened);',
        '        return api.cols([',
        '            W.group(\'This addon\', [',
        '                api.kv(\'id\', api.id),',
        '                api.kv(\'opened\', opened + \' time(s) this install\'),',
        '                api.kv(\'gold\', api.game.gold()),',
        '                W.button({',
        '                    label: \'say hello in the log\', wide: true, _ungated: true,',
        '                    onClick: function () { api.log(\'ok\', \'hello\'); }',
        '                })',
        '            ], { tag: api.version })',
        '        ]);',
        '    }, 165);',
        '',
        '    /* A bind. It appears in Settings -> Hotkeys unbound; give it a key. */',
        '    api.hotkey({',
        '        id: \'hello\',',
        '        label: \'Say hello\',',
        '        help: \'Shows a toast. Bind it in Settings -> Hotkeys.\',',
        '        run: function () {',
        '            api.toast({ title: \'HELLO\', msg: api.id, severity: \'ok\' });',
        '        }',
        '    });',
        '',
        '    /* GigaHack.api.hello() in the console tab, listed by api.help(). */',
        '    api.command(\'hello\', function () {',
        '        return { addon: api.id, gold: api.game.gold() };',
        '    }, \'What this addon can see, as an object.\');',
        '',
        '    /* Every write is read back through the same verify the menu uses. */',
        '    api.command(\'helloSetVar\', function (id, value) {',
        '        return api.game.setVar(id, value);',
        '    }, \'Set a variable and report whether it stuck.\');',
        '',
        '    /* frame, tick, map, battle, message, save, load, menu. */',
        '    api.on(\'map\', function (mapId) {',
        '        api.log(\'info\', \'entered map \' + mapId);',
        '    });',
        '});',
        ''
    ].join('\n');

    A.template = function () { return TEMPLATE; };

    /* =====================================================================
       12. PANELS
       ===================================================================== */
    function warn(text) {
        return h('div', {
            class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px', text: text
        });
    }
    function note(text) {
        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px', text: text });
    }
    function danger(text) {
        return h('div', {
            class: 'mm-sub', style: 'color:var(--mm-danger);white-space:normal;padding:2px', text: text
        });
    }

    function stateLabel(r) {
        if (r.state === 'quarantined') return 'quarantined';
        if (r.state === 'failed') return 'failed';
        if (r.state === 'missing') return 'no file';
        if (r.state === 'skipped') return 'skipped';
        if (r.enabled && r.state === 'inert') return 'on, inert';
        /* An addon whose event handler threw is not healthy, and the row was
           the only place saying it was. */
        if (r.enabled && r.eventThrow) return r.eventThrow.stopped ? 'on, stopped' : 'on, threw';
        if (r.enabled) return 'on';
        return 'off';
    }

    var selected = null;
    var pasteText = '';
    var linkUrl = '';
    var filePath = '';
    var recheckSaid = '';

    function selectedRec() {
        var list = A.list();
        if (!list.length) return null;
        var i;
        for (i = 0; i < list.length; i++) if (list[i].id === selected) return list[i];
        selected = list[0].id;
        return list[0];
    }

    /* ------------------------------------------------------ Settings → Addons */
    function buildAddons() {
        var list = A.list();

        var table = W.table({
            key: 'addons.list',
            cols: [
                { label: 'addon', w: '1 1 0' },
                { label: 'id', w: '0 0 116px' },
                { label: 'ver', w: '0 0 46px' },
                { label: 'state', w: '0 0 78px' }
            ],
            empty: 'no addons here yet — import one below',
            /* Virtual, so the paint keeps the reader's scroll position and the
               isScrolling() guard on the repaint below is a real one. Plain,
               it was neither: the guard's only writer is a listener installed
               inside the virtual branch, so it read false forever, and the
               plain paint empties the body and lets the browser clamp
               scrollTop to zero — the exact case the guard was written for. */
            rowH: 17, virtual: true,
            render: function (r) {
                return [r.name, r.id, r.version || '—', stateLabel(r)];
            },
            onRow: function (tr, r) {
                /* mm-on is the house class for a selected row and the only one
                   with a rule behind it; the class that used to be here
                   appeared exactly once in the tree, on this line, and painted
                   nothing — so clicking a row moved the detail group and gave
                   the list itself no indication of where you were. */
                if (r.id === selected) tr.classList.add('mm-on');
                tr.setAttribute('data-mm-tip',
                    (r.name || r.id) + '|' + (r.help || r.headerWhy || 'no help in the header'));
                tr.addEventListener('click', function () { selected = r.id; U.rerender(); });
            }
        });
        table.mm.paint(list);

        var listGroup = W.group('Addons in this game', [table], {
            grow: true, tag: list.length + ' listed'
        });

        var rec = selectedRec();
        var detail = rec ? detailGroup(rec) : W.group('Nothing selected', [
            note('Import one below, or press "start from a template" for a working example you can ' +
                'paste straight back in.')
        ]);

        var whereRows = [
            U.w.pathRow('This game', onDisk() ? A.dir() : null, {
                why: A.storageWhy() || 'no folder on this build'
            }),
            U.w.pathRow('Shared library', A.libraryDir(), { why: A.libraryWhy() }),
            kv('Enablement', 'per game — the library is shared, the switches are not')
        ];
        if (!onDisk()) whereRows.push(warn(A.storageWhy()));
        if (A.scanNote()) whereRows.push(warn(A.scanNote()));
        var whereGroup = W.group('Where they live', whereRows, { collapsed: true, tag: onDisk() ? 'folder' : 'store' });

        /* THE REVIEW GOES FIRST WHEN THERE IS ONE, and the import group folds
           up under it. The column scrolls, the import group is tall, and with
           the review at the bottom of it pressing "review it" put the whole
           point of the panel below the fold: the source you were about to run
           was off screen, and nothing on screen had visibly changed. */
        var staged = !!A.staged();
        var body = cols(
            [listGroup, detail],
            staged
                ? [reviewGroup(), importGroup(true), whereGroup, safeGroup()]
                : [importGroup(false), reviewGroup(), whereGroup, safeGroup()]
        );

        /* Live, because an addon can be enabled from the console or by another
           addon while this panel is on screen. The signal is a counter, not a
           length: a reload that replaces every record leaves the count exactly
           where it was. */
        /* `within` is the TABLE and not the whole overlay, which is the
           default: this panel is mostly import boxes, and a list that stopped
           updating because somebody was typing a link into a field two groups
           away would be a live view that is paused for a reason nobody could
           see. Nothing inside the table itself takes focus, so the only holds
           left are the menu being shut and a popup being over it — neither of
           which a reader can mistake for a frozen panel. */
        /* The table is virtual, so isScrolling() is a real guard here and the
           paint keeps the offset it was at. */
        U.live(function () { return A.revision(); }, function () {
            var rows = A.list();
            table.mm.paint(rows);
            listGroup.mm.tag(rows.length + ' listed');
        }, { name: 'addons list', within: table,
            when: function () { return !table.mm.isScrolling(); },
            whyNot: 'you are scrolling the list' });

        return body;
    }

    function detailGroup(r) {
        var rows = [];
        rows.push(kv('id', r.id));
        if (r.version) rows.push(kv('version', r.version));
        if (r.author) rows.push(kv('author', r.author));
        if (r.game) rows.push(kv('says it is for', r.game, 'Claimed|Read out of the header. Nothing ' +
            'checks it against this game — it is what the file says about itself.'));
        if (r.needs.length) rows.push(kv('needs', r.needs.join(', ')));
        rows.push(kv('came from', r.source + (r.url ? ' — ' + hostOf(r.url).host : '')));
        /* Said BEFORE the remove button is reached, not in the toast after it.
           "Remove it" on a library row deletes the cross-game copy, and the
           row is otherwise indistinguishable from one of this game's own. */
        rows.push(kv('kept in', r.scope === 'library'
            ? 'the shared library — one copy, read by every game on this machine'
            : 'this game\'s own folder'));
        if (r.scope === 'library') {
            rows.push(warn('Switching it on or off is per game. Removing it is not: that deletes the ' +
                'shared file and every game on this machine loses it.'));
        }
        if (r.file && r.file !== r.id) {
            rows.push(kv('file', r.file + '.js', 'File|The id comes from @id in the header; the file ' +
                'name is where the bytes are. They do not have to match.'));
        }
        rows.push(kv('fingerprint', r.digest + '  (' + r.size + ' chars)',
            'Fingerprint|A cheap 32-bit digest, not a checksum. It answers "is this the same text as ' +
            'last time" and nothing else.'));
        if (r.importedAt) rows.push(kv('imported', r.importedAt));
        if (r.help) rows.push(note(r.help));
        if (!r.hasHeader) rows.push(note(r.headerWhy));

        if (r.state === 'quarantined') {
            rows.push(danger('This was loading when the game last stopped, so it was not run this ' +
                'launch. Nothing here can tell whether it was the cause — switching it on again is ' +
                'the way to find out.'));
        }
        if (r.state === 'missing') rows.push(danger(r.error || 'there is no file for this addon.'));
        if (r.state === 'failed') {
            rows.push(danger('Stopped' + (r.line ? ' at line ' + r.line : '') + ': ' + r.error));
            if (r.line && lineBias === null) {
                rows.push(warn('The line number is approximate — this host does not report one that ' +
                    'could be calibrated.'));
            }
        }
        if (r.state === 'skipped') {
            rows.push(warn('Skipped this launch: ' + A.safeModeReason()));
        }
        /* An error that is on the record but not on this session's run came out
           of the index, which is to say it is what happened the LAST time this
           addon ran. Saying which of the two it is costs one sentence; not
           saying it makes a row that has not run today look like it just did. */
        if (r.error && r.state !== 'failed' && r.state !== 'missing') {
            rows.push(warn('The last time this ran it stopped: ' + r.error +
                ' Switching it on again is what finds out whether that is still true.'));
        }
        if (r.enabled && r.state === 'inert') {
            rows.push(warn('It loaded and registered nothing. That is not an error and it is not ' +
                'success either — the file may never call GigaHack.addon().'));
        }
        /* A handler throw is not a load failure and is not carried in from the
           index either, so it gets its own sentence rather than being folded
           into one of theirs. */
        if (r.eventThrow) {
            rows.push(danger('Its on("' + r.eventThrow.evt + '") handler threw' +
                (r.eventThrow.line ? ' at line ' + r.eventThrow.line : '') + ' — ' +
                r.eventThrow.message + ' — ' + r.eventThrow.count + ' time(s). ' +
                (r.eventThrow.stopped
                    ? 'That handler is no longer called; the rest of the addon still runs, and ' +
                      '"read it again" re-subscribes it.'
                    : 'It is still subscribed. Only the first throw is logged, because this runs on a ' +
                      'frame clock.')));
        }

        if (r.enabled) {
            rows.push(h('div', { class: 'mm-sep' }));
            rows.push(kv('registered', r.registered));
            if (r.panels.length) rows.push(kv('panels', r.panels.map(function (p) { return p.tab + ' → ' + p.name; }).join(', ')));
            if (r.hotkeys.length) rows.push(kv('hotkeys', r.hotkeys.join(', ')));
            if (r.commands.length) rows.push(kv('commands', r.commands.map(function (c) { return 'GigaHack.api.' + c + '()'; }).join(', ')));
            if (r.events.length) rows.push(kv('events', r.events.join(', ')));
        }
        if (r.hooks.length) {
            rows.push(kv('aliases', r.hooks.join(', ')));
            rows.push(warn('An alias cannot be pulled out of a chain once anything has aliased on top, ' +
                'so these stay installed for the rest of the session. Disabling makes each one a ' +
                'pass-through immediately — it is not left doing anything.'));
        }
        if (r.profiles.length) {
            rows.push(kv('profiles', r.profiles.join(', ')));
            rows.push(warn('Profile resolution is memoised at the first read after boot, so this ' +
                'applies from the NEXT launch. Re-resolving now moves the profile and does not move ' +
                'four things that have already read it: derived hotkey defaults, the Gallery panel\'s ' +
                'decision, the Forge id bases already written to its library, and any section cache.'));
            rows.push(W.button({
                label: 're-resolve the game profile now', wide: true, mini: true, mutates: true,
                disabled: !($.profile && $.profile.resolve),
                tip: ($.profile && $.profile.resolve) ? null
                    : 'No profile module|GigaHack_Profile did not load, so there is nothing to re-resolve.',
                onClick: function () {
                    var p = $.safe(function () { return $.profile.resolve(true); }, 're-resolve profile', null);
                    if ($.store.applyDerivedHotkeys) $.safe(function () { $.store.applyDerivedHotkeys(true); }, 'derive hotkeys');
                    $.emit('gameobjects');
                    U.toast({
                        title: p ? 'RE-RESOLVED' : 'NOT RE-RESOLVED',
                        msg: p ? 'now "' + (p.id || p.name || '?') + '" — the Forge bases already written do not move'
                            : 'the profile module refused; the log says why',
                        severity: p ? 'ok' : 'warn'
                    });
                    U.rerender();
                }
            }));
        }

        rows.push(h('div', { class: 'mm-sep' }));
        rows.push(h('div', { class: 'mm-inline', style: 'padding:2px' },
            W.button({
                label: r.enabled ? 'switch it off' : 'switch it on',
                wide: true, variant: r.enabled ? null : 'prime', mutates: true,
                disabled: r.state === 'missing',
                tip: r.state === 'missing' ? 'No file|' + (r.error || 'there is nothing to run') : null,
                onClick: function () {
                    var res = A.toggle(r.id);
                    U.toast({
                        title: res.ok ? (r.enabled ? 'OFF' : 'ON') : 'NOT CHANGED',
                        msg: res.ok ? (r.enabled ? 'disabled' : (res.registered || 'enabled')) : res.why,
                        severity: res.ok ? 'ok' : 'err'
                    });
                    U.rerender();
                }
            }),
            W.button({
                label: 'read it again', wide: true, mutates: true,
                tip: 'Reload|Reads the file off disk again and runs it if it was on.',
                onClick: function () {
                    var res = A.reloadOne(r.id);
                    U.toast({
                        title: res.ok ? 'RELOADED' : 'NOT RELOADED',
                        msg: res.why || r.id, severity: res.ok ? 'ok' : 'err'
                    });
                    U.rerender();
                }
            })));
        rows.push(h('div', { class: 'mm-inline', style: 'padding:2px' },
            W.button({
                label: 'check the source again', wide: true, mini: true, _ungated: true,
                disabled: !r.url,
                tip: r.url ? 'Re-check|Asks ' + hostOf(r.url).host + ' whether the file changed. It ' +
                    'installs nothing either way.'
                    : 'No link|This addon did not come from a link, so there is no source to ask.',
                onClick: function () {
                    recheckSaid = 'asking ' + hostOf(r.url).host + '…';
                    U.rerender();
                    A.recheck(r.id, function (res) {
                        recheckSaid = (res.state || 'refused') + ' — ' + res.why;
                        U.toast({
                            title: (res.state || 'refused').toUpperCase(),
                            msg: res.why, severity: res.ok ? (res.state === 'changed' ? 'warn' : 'ok') : 'err'
                        });
                        if (res.ok && res.state === 'changed') A.stage({ text: res.text, from: 'link', url: r.url, replace: true });
                        U.rerender();
                    });
                }
            }),
            W.button({
                label: 'remove it', wide: true, mini: true, variant: 'danger',
                confirm: true,
                /* The confirm is where the consequence has to be, because it
                   is the last thing read before the file goes. */
                confirmLabel: r.scope === 'library' ? 'delete the shared copy?' : 'delete the file?',
                tip: r.scope === 'library'
                    ? 'Shared|' + (A.pathOf(r.id) || 'the library copy') + ' is the cross-game copy. ' +
                      'Deleting it takes it away from every game on this machine.'
                    : 'Remove|Deletes ' + (A.pathOf(r.id) || 'the stored copy') +
                      ' and this addon\'s own data file.',
                onClick: function () {
                    var res = A.remove(r.id, { shared: r.scope === 'library' });
                    U.toast({
                        title: res.ok ? 'REMOVED' : 'NOT REMOVED',
                        msg: res.why || r.id, severity: res.ok ? 'ok' : 'err'
                    });
                    selected = null;
                    U.rerender();
                }
            })));
        if (recheckSaid) rows.push(note(recheckSaid));

        return W.group(r.name || r.id, rows, { tag: stateLabel(r) });
    }

    function importGroup(folded) {
        var clip = A.clipboard();
        var box = W.textarea({
            rows: 4, mono: true, _ungated: true,
            placeholder: 'paste an addon here, then press "review it"',
            value: pasteText,
            onInput: function (v) { pasteText = v; }
        });

        function review(r) {
            U.toast({
                title: r.ok ? 'ON REVIEW' : 'REFUSED',
                msg: r.ok ? r.id + ' — nothing has run' : r.why,
                severity: r.ok ? 'ok' : 'err'
            });
            U.rerender();
        }

        return W.group('Bring one in', [
            note('Every source ends in the same place: a review of what actually arrived. Nothing is ' +
                'enabled by being imported.'),
            box,
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'review it', wide: true, variant: 'prime', _ungated: true,
                    onClick: function () { review(A.stage({ text: box.mm.get() || pasteText, from: 'paste' })); }
                }),
                W.button({
                    label: 'start from a template', wide: true, _ungated: true,
                    tip: 'Template|A working addon — a panel, a hotkey, a console call and an event. ' +
                        'It goes on the clipboard, and into the box above if the clipboard refuses.',
                    onClick: function () {
                        var ok = U.copyText(A.template());
                        pasteText = A.template();
                        box.mm.set(pasteText);
                        U.toast({
                            title: ok ? 'COPIED' : 'IN THE BOX',
                            msg: ok ? 'a working addon is on the clipboard and in the box above'
                                : 'this build has no clipboard to write to — it is in the box above',
                            severity: 'ok'
                        });
                    }
                })),
            h('div', { class: 'mm-sep' }),
            W.button({
                label: 'read the clipboard', wide: true, mini: true, _ungated: true,
                disabled: !clip.available,
                tip: clip.available ? 'Clipboard|Read through ' + clip.via + '.' : 'No clipboard|' + clip.why,
                onClick: function () {
                    A.readClipboard(function (err, text) {
                        if (err) {
                            U.toast({ title: 'NOT READ', msg: err.message, severity: 'err' });
                            U.rerender();
                            return;
                        }
                        pasteText = text;
                        box.mm.set(text);
                        review(A.stage({ text: text, from: 'clipboard' }));
                    });
                }
            }),
            clip.available ? (clip.why ? warn(clip.why) : null) : warn(clip.why),
            h('div', { class: 'mm-sep' }),
            W.row('Link', W.text({
                value: linkUrl, width: '190px', mono: true, placeholder: 'https://…',
                onInput: function (v) { linkUrl = v; }
            })),
            note(A.describeLink(linkUrl)),
            W.button({
                label: 'fetch it', wide: true, mini: true, mutates: true,
                disabled: !A.transport().id,
                tip: A.transport().id ? null : 'No transport|' + A.transport().why,
                onClick: function () {
                    U.toast({ title: 'FETCHING', msg: hostOf(linkUrl).host || linkUrl, severity: 'info', ms: 1600 });
                    A.importLink(linkUrl, function (r) { review(r); });
                }
            }),
            h('div', { class: 'mm-sep' }),
            W.row('File', W.text({
                value: filePath, width: '190px', mono: true, placeholder: 'absolute path to a .js file',
                onInput: function (v) { filePath = v; }
            })),
            W.button({
                label: 'read that path', wide: true, mini: true, mutates: true,
                disabled: !onDisk(),
                tip: onDisk() ? null : 'No filesystem|' + ($.caps.fsWhy || 'nothing here can read a path.'),
                onClick: function () { review(A.importFile(filePath)); }
            }),
            W.button({
                label: 'rescan the folder', wide: true, mini: true, mutates: true,
                disabled: !onDisk(),
                tip: onDisk() ? 'Rescan|Reads ' + A.dir() + ' again, plus the shared library when it is available.'
                    : 'No filesystem|' + ($.caps.fsWhy || 'there is no folder to scan.'),
                onClick: function () {
                    var r = A.rescan();
                    U.toast({ title: 'RESCANNED', msg: r.after + ' listed', severity: 'ok' });
                    U.rerender();
                }
            })
        ], { tag: 'import', collapsed: !!folded });
    }

    function reviewGroup() {
        var s = A.staged();
        if (!s) {
            return W.group('Review', [
                note('Nothing is waiting. Whatever you bring in appears here first — its header, its ' +
                    'size, its fingerprint, and the whole source — and it runs only after you have ' +
                    'added it and switched it on.')
            ], { tag: 'empty' });
        }
        var rows = [
            /* The one place this is said, because this is the one place a
               decision is being made. */
            danger(NOT_A_SANDBOX),
            h('div', { class: 'mm-sep' }),
            kv('id it will take', s.id),
            kv('claims to be', s.header.has
                ? (s.header.name || '(no @name)') + (s.header.version ? ' ' + s.header.version : '')
                : 'nothing — there is no header'),
            s.header.author ? kv('author', s.header.author) : null,
            s.header.game ? kv('says it is for', s.header.game) : null,
            s.header.needs.length ? kv('needs', s.header.needs.join(', ')) : null,
            kv('size', s.size + ' characters (ceiling ' + MAX_BYTES + ')'),
            kv('fingerprint', s.digest + '  — a cheap 32-bit digest, not a checksum'),
            kv('came from', s.from + (s.via ? ' over ' + s.via : '')),
            s.host ? kv('host', s.host) : null,
            kv('first line', s.first),
            s.replaces ? warn('This replaces the addon already listed under that id.') : null,
            s.header.help ? note(s.header.help) : note(s.header.why || ''),
            h('div', { class: 'mm-sep' }),
            /* The two decisions sit ABOVE the source and not under it. The
               source is a scrolling block of somebody else's file and there is
               no length it is guaranteed to be; below it, the only two buttons
               on the panel were off the bottom of a column that had already
               scrolled once, and the review looked like a page with nothing to
               press on it. */
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'add it, switched off', wide: true, variant: 'prime', mutates: true,
                    onClick: function () {
                        var r = A.commit();
                        U.toast({
                            title: r.ok ? 'ADDED' : 'NOT ADDED',
                            msg: r.ok ? r.id + ' — it is off until you switch it on' : r.why,
                            severity: r.ok ? 'ok' : 'err'
                        });
                        if (r.ok) selected = r.id;
                        U.rerender();
                    }
                }),
                W.button({
                    label: 'discard it', wide: true, _ungated: true,
                    onClick: function () { A.discard(); U.rerender(); }
                })),
            h('div', { class: 'mm-sep' }),
            h('div', { class: 'mm-lab', style: 'padding:2px', text: 'the whole file' }),
            h('div', {
                class: 'mm-pre mm-selectable',
                style: 'max-height:220px;overflow:auto;white-space:pre',
                text: s.text
            })
        ];
        return W.group('Review', rows, { tag: s.from });
    }

    function safeGroup() {
        return W.group('If one of them breaks the game', [
            note('An addon that is loading when the game stops is named at the next launch and is not ' +
                'run again until you say so. That is the crash guard, and it needs nothing from you.'),
            note('Holding ' + (U.prettyCode ? U.prettyCode(A.safeModeKey()) : A.safeModeKey()) +
                ' while the game starts skips every addon for that launch. A held key is only seen if ' +
                'the browser has delivered a keystroke by the time addons load, so there is also a ' +
                'switch, and the switch is the reliable one.'),
            W.toggleRow('Skip every addon next launch', {
                value: A.safeModeArmed(), _ungated: true,
                sub: 'clears itself once it has been used',
                tip: 'Safe mode|Survives the relaunch, then turns itself off so the launch after that ' +
                    'is normal.',
                onChange: function (v) { A.armSafeMode(v); }
            }),
            A.safeModeReason() ? warn('This launch: every addon was skipped because ' + A.safeModeReason()) : null,
            quarantineNote()
        ], { collapsed: true, tag: A.safeModeArmed() ? 'armed' : 'off' });
    }

    /**
     * Two facts, and this used to print one sentence claiming both.
     *
     * "It was loading when the game last stopped" is a fact about the marker
     * and stays true for the launch. "It is quarantined" is a fact about the
     * record, and the two stop agreeing the moment the player uses the button
     * beside it to switch the addon back on — or, before the load pass applied
     * the quarantine above the safe-mode branch, the moment safe mode skipped
     * everything and quarantined nothing at all.
     */
    function quarantineNote() {
        var id = A.quarantinedId();
        if (!id) return null;
        var rec = A.get(id);
        if (rec && rec.state === 'quarantined') {
            return danger('"' + id + '" was loading when the game last stopped, so it is quarantined ' +
                'and has not been run this launch.');
        }
        if (rec) {
            return note('"' + id + '" was loading when the game last stopped. It reads "' +
                stateLabel(rec) + '" now, so the quarantine is not still in force.');
        }
        return note('"' + id + '" was loading when the game last stopped. Nothing is listed under that ' +
            'id any more.');
    }

    /* --------------------------------------------------------- Debug → Addons */
    function buildDebug() {
        var list = A.list();

        var loadTable = W.table({
            key: 'addons.load',
            cols: [
                { label: '#', w: '0 0 30px', cls: 'mm-td-num' },
                { label: 'addon', w: '1 1 0' },
                { label: 'state', w: '0 0 78px' },
                { label: 'ms', w: '0 0 52px', cls: 'mm-td-num' },
                { label: 'registered', w: '1 1 0' }
            ],
            empty: 'nothing listed',
            /* Virtual for the same reason as the list in Settings: the
               isScrolling() guard on the repaint below only exists because
               this table is, and a guard that cannot fail is worse than none. */
            rowH: 17, virtual: true,
            render: function (r, i) {
                return [String(i + 1), r.id, stateLabel(r), r.state === 'loaded' ? String(r.ms) : '—', r.registered];
            },
            onRow: function (tr, r) {
                tr.setAttribute('data-mm-tip', r.id + '|' +
                    (r.error ? (r.line ? 'line ' + r.line + ': ' : '') + r.error : (r.help || 'no error')));
            }
        });
        loadTable.mm.paint(list);

        var errorRows = [];
        list.forEach(function (r) {
            /* This launch or a previous one — an error carried in from the
               index and one that happened a second ago look identical in a
               list, and only one of them is worth acting on right now. */
            if (r.error) {
                errorRows.push(kv(r.id + (r.line ? ':' + r.line : ''), r.error,
                    r.id + '|' + (r.state === 'failed'
                        ? 'This launch.'
                        : 'Carried over from the index — this is what happened the last time it ran.') +
                    ' ' + r.error));
            }
            /* A throw from an event handler is neither of those. It happened
               while the addon was RUNNING, which is why the row above it can
               read "loaded" and this group used to say "Nothing has thrown."
               while a handler threw sixty times a second. */
            if (r.eventThrow) {
                errorRows.push(kv(
                    r.id + ': on("' + r.eventThrow.evt + '")' +
                        (r.eventThrow.line ? ':' + r.eventThrow.line : ''),
                    r.eventThrow.message + ' — ' + r.eventThrow.count + '×' +
                        (r.eventThrow.stopped ? ', stopped' : ''),
                    r.id + '|An event handler threw while the addon was running. ' +
                        (r.eventThrow.stopped
                            ? 'It has been dropped after ' + r.eventThrow.count + ' throws; the rest ' +
                              'of the addon still runs.'
                            : 'It is still subscribed.')));
            }
        });
        var errorCount = errorRows.length;
        if (!errorCount) {
            errorRows = [note('Nothing has thrown.')];
        } else {
            errorRows.push(note('A row whose state is not "failed" is an error this launch inherited ' +
                'from the last one, not one that has just happened. An on(...) row is neither: it ' +
                'threw while the addon was running.'));
        }

        var envRows = [
            kv('storage', onDisk() ? 'folder' : 'the settings store'),
            U.w.pathRow('This game', onDisk() ? A.dir() : null, { why: A.storageWhy() || 'no folder here' }),
            U.w.pathRow('Shared library', A.libraryDir(), { why: A.libraryWhy() }),
            kv('network transport', A.transport().id || 'none'),
            note(A.transport().why),
            kv('clipboard read', A.clipboard().via || 'none'),
            A.clipboard().why ? note(A.clipboard().why) : null,
            kv('line numbers', lineBias === null
                ? 'approximate — the wrapper offset could not be measured on this host'
                : 'exact — the wrapper offset measured as ' + lineBias + ' line(s)')
        ];

        var eventRows = [];
        EVENTS.forEach(function (e) {
            eventRows.push(kv(e.id, subs[e.id].length + ' subscriber(s) — ' + e.what,
                e.id + '|' + e.what + ' Noticed through ' + e.how + '.'));
            var why = A.eventWhy(e.id);
            if (why) eventRows.push(warn(why));
        });
        eventRows.push(note('None of these is an engine alias. This module loads last, so an alias ' +
            'here would sit on top of the one another module already holds on the same method and ' +
            'stop that one being removable from Debug → Hooks.'));

        var apiTable = W.table({
            key: 'addons.api',
            cols: [
                { label: 'call', w: '1 1 0' },
                { label: 'what it does', w: '1 1 0' },
                { label: 'undone by disable', w: '0 0 130px' }
            ],
            empty: 'nothing',
            render: function (r) { return [r.call, r.what, r.revoked]; },
            /* Three columns of prose in one table: whatever the widths are,
               something is elided. The tip carries the whole row so a trimmed
               cell is one hover from being readable rather than lost. */
            onRow: function (tr, r) {
                tr.setAttribute('data-mm-tip', r.call + '|' + r.what +
                    ' — undone by disable: ' + r.revoked);
            }
        });
        apiTable.mm.paint(API_DOC);

        var body = cols(
            [
                W.group('Load order and timings', [loadTable], { grow: true, tag: list.length + ' listed' }),
                W.group('What threw', errorRows, { tag: errorCount ? errorCount + ' error(s)' : 'clean' })
            ],
            [
                W.group('The API an addon is handed', [apiTable], { grow: true, tag: API_DOC.length + ' entries' }),
                W.group('Events', eventRows, { collapsed: true, tag: EVENTS.length }),
                W.group('This build', envRows, { collapsed: true, tag: onDisk() ? 'fs' : 'no fs' }),
                W.group('Aliases', [
                    note('An addon\'s alias is installed once and never removed: $.install refuses to ' +
                        'unpatch when anything has aliased on top, and forcing it would discard the ' +
                        'other plugin\'s work. Disabling turns the wrapper into a pass-through instead.'),
                    kv('installed by addons', aliasesFromAddons().length || 'none'),
                    aliasesFromAddons().length ? kv('names', aliasesFromAddons().join(', ')) : null,
                    W.button({
                        label: 're-baseline the alias snapshot', wide: true, mini: true, mutates: true,
                        disabled: !($.compat && $.compat.snapshotAliases),
                        tip: ($.compat && $.compat.snapshotAliases)
                            ? 'Re-baseline|Only needed when an addon aliased a method GigaHack already ' +
                              'hooks. It also erases evidence of any genuine third-party over-patch ' +
                              'from before now.'
                            : 'No compat module|GigaHack_Compat did not load.',
                        onClick: function () {
                            var n = $.safe(function () { return $.compat.snapshotAliases(); }, 're-baseline', 0);
                            U.toast({ title: 'RE-BASELINED', msg: n + ' alias(es) recorded', severity: 'ok' });
                            U.rerender();
                        }
                    })
                ], { collapsed: true, tag: aliasesFromAddons().length })
            ]
        );

        /* Virtual table, so the guard is real and the offset survives. */
        U.live(function () { return A.revision(); }, function () {
            loadTable.mm.paint(A.list());
        }, { name: 'addons debug', within: loadTable,
            when: function () { return !loadTable.mm.isScrolling(); },
            whyNot: 'you are scrolling the list' });

        return body;
    }

    function aliasesFromAddons() {
        return Object.keys($.hooks).filter(function (n) { return n.indexOf('(addon:') > -1; });
    }

    U.panel('settings', 'Addons', function () { return buildAddons(); }, 60);
    U.panel('debug', 'Addons', function () { return buildDebug(); }, 95);

    /* =====================================================================
       13. CONSOLE API AND START-UP
       ===================================================================== */
    if ($.store.declareFile) {
        $.safe(function () {
            $.store.declareFile(LOADING_FILE, 'the addon that was loading when the game last stopped',
                { transient: true });
        }, 'declare addon marker');
    }

    /**
     * GigaHack.addon(setup) outside a load is not an error — it is somebody
     * pasting the template into the console to see what it does. It says what
     * happened rather than doing nothing.
     */
    $.addon = function () {
        $.log('warn', 'GigaHack.addon() was called outside an addon file, so there is nothing to ' +
            'attach the registration to. Import the file in Settings → Addons and switch it on.');
        return false;
    };

    $.api.addons = function () { return A.list(); };
    $.api.addonTemplate = function () { return A.template(); };

    /* The load pass waits for the overlay, and not only because an addon
       registers into it: this is also the earliest moment at which a key held
       while the game started has been delivered to this page, which is what
       safe mode is asked about. Mount already happened on a fast host, so both
       doors are used and the pass is guarded against running twice. */
    function start() {
        if (loaded) return;
        $.safe(function () { A.load('at boot'); }, 'addons boot load');
    }
    $.on('mounted', function () { start(); });
    if (U.getHost && U.getHost()) start();

    $.log('info', 'addons ready — ' + (onDisk()
        ? 'reading ' + A.dir()
        : 'no filesystem here, so they are kept in the settings store'));

})(window.GigaHack);
