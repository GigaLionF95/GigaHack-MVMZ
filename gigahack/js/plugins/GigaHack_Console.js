//=============================================================================
// GigaHack MV/MZ
// 24 · console.js — embedded JS console, snippet library, log inspector
//-----------------------------------------------------------------------------
// ASSUME THERE ARE NO DEVTOOLS. A game packaged with the release flavour of
// NW.js has no devtools API at all: the key that would open them does nothing,
// nothing in the page can open one, and a plugin that offers to is offering
// something the runtime does not have. That is a property of how the game was
// packaged, not a setting, and it cannot be detected reliably before the fact.
// A browser deploy can be worse — the page may be inside a wrapper with no menu
// bar at all.
//
// So this is written as though it were the only console the game has, and it
// behaves like one: results formatted rather than dumped, console.* captured
// while your code runs, history that survives a relaunch, and errors that are
// displayed rather than allowed to reach the game loop.
//
// It is also where a game GigaHack knows nothing about gets debugged, so every
// service the panels are built on is reachable from here by name, listed in the
// Reference group, and pre-written into the starter snippets: what engine and
// capabilities this is, which plugin suites are known to fight the mod, what
// the index holds, and which events touch a given switch.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — embedded JS console, snippets, log inspector
 * @author gigahack
 * @help GigaHack_Console.js — requires Core, Caps, Store, UI, Shell, Hooks and
 * Tabs. Compat, Index and Profile are used where they are present.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — console not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols, clear = U.clear, add = U.add;

    var C = $.console = {};

    /* =====================================================================
       PART 0 — STYLES
       ===================================================================== */
    var CSS = [
        '#mm-root .mm-code{width:100%;box-sizing:border-box;resize:none;display:block;',
        '  font-family:var(--mm-font-mono);font-size:var(--mm-fs-sm);line-height:1.45;',
        '  background:var(--mm-bg-sunken);color:var(--mm-text-hi);border:0;box-shadow:var(--mm-inset);',
        '  padding:4px 5px;min-height:64px;overflow:auto;overflow-anchor:none;white-space:pre;tab-size:2}',
        '#mm-root .mm-code:focus{outline:0;box-shadow:inset 0 0 0 1px var(--mm-accent-line)}',
        '#mm-root .mm-out{background:var(--mm-bg-sunken);box-shadow:var(--mm-inset);',
        '  overflow:auto;overflow-anchor:none;flex:1 1 auto;min-height:80px;padding:3px 4px;',
        '  font-family:var(--mm-font-mono);font-size:var(--mm-fs-sm);line-height:1.45}',
        '#mm-root .mm-out-row{display:flex;padding:1px 0;white-space:pre-wrap;',
        '  word-break:break-word;border-bottom:1px solid rgba(255,255,255,.03)}',
        // FLOOR: flex 'gap' needs Chromium 84 and the floor is 66, so every
        // horizontal strip spaces its children with '> * + *{margin-left}'
        // instead — the same idiom the design system's sheet uses throughout.
        // Long-hand, never the 'margin' shorthand: a shorthand here would wipe
        // out any margin a sibling rule sets on the same elements.
        '#mm-root .mm-out-row>*+*{margin-left:var(--mm-sp-3)}',
        '#mm-root .mm-out-gut{flex:0 0 12px;text-align:center;color:var(--mm-text-dim);user-select:none}',
        '#mm-root .mm-out-txt{flex:1 1 0;min-width:0}',
        '#mm-root .mm-out-in .mm-out-txt{color:var(--mm-text)}',
        '#mm-root .mm-out-in .mm-out-gut{color:var(--mm-accent)}',
        '#mm-root .mm-out-out .mm-out-txt{color:var(--mm-text-hi)}',
        '#mm-root .mm-out-err .mm-out-txt{color:var(--mm-danger)}',
        '#mm-root .mm-out-warn .mm-out-txt{color:var(--mm-warn)}',
        '#mm-root .mm-out-log .mm-out-txt{color:var(--mm-info)}',
        // A WRAPPING container, so '> * + *' is not enough: a '+' margin cannot
        // open a gap between wrapped ROWS. The spacing therefore goes on the
        // trailing edge of every child, and the 2px it adds below the last row
        // is given back out of the container's bottom padding, so the strip is
        // exactly the height it was.
        '#mm-root .mm-comp{display:flex;flex-wrap:wrap;padding:2px 0 0}',
        '#mm-root .mm-comp>*{margin-right:2px;margin-bottom:2px}',
        '#mm-root .mm-comp button{font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);',
        '  padding:0 4px;height:14px;background:var(--mm-bg-2);box-shadow:0 0 0 1px var(--mm-line)}',
        '#mm-root .mm-comp button:hover{background:var(--mm-bg-3);color:var(--mm-text-hi)}',
        // Named .mm-trace, not .mm-stack: the design system already owns
        // .mm-stack as a flex column with its own child spacing, and a block of
        // stack-trace text was silently inheriting that layout.
        '#mm-root .mm-trace{font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);color:var(--mm-text-dim);',
        '  white-space:pre-wrap;word-break:break-word;padding:2px 0 2px 12px}'
    ].join('\n');
    U.CSS2 = (U.CSS2 || '') + '\n' + CSS;
    (function () {
        var live = document.getElementById('gigahack-style');
        if (live) live.textContent += '\n' + CSS;
    })();

    /* =====================================================================
       PART 1 — VALUE FORMATTING
       A console that prints [object Object] is not a console. This is a
       bounded pretty-printer: depth-limited, count-limited, cycle-safe, and
       it never calls anything on the value it is describing except through
       $.safe — a getter on a game object can and does throw.
       ===================================================================== */
    var MAX_DEPTH = 2, MAX_KEYS = 40, MAX_ITEMS = 60, MAX_STR = 400;

    function typeOf(v) {
        if (v === null) return 'null';
        if (Array.isArray(v)) return 'array';
        var t = typeof v;
        if (t !== 'object') return t;
        if (v.nodeType) return 'node';
        return 'object';
    }

    function quote(s) {
        if (s.length > MAX_STR) s = s.slice(0, MAX_STR) + '… (' + s.length + ' chars)';
        return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
    }

    function ctorName(v) {
        return $.safe(function () {
            return (v.constructor && v.constructor.name) || 'Object';
        }, 'ctor', 'Object');
    }

    C.format = function (v) { return fmt(v, 0, []); };

    function fmt(v, depth, seen) {
        var t = typeOf(v);
        if (t === 'undefined') return 'undefined';
        if (t === 'null') return 'null';
        if (t === 'string') return quote(v);
        if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
        if (t === 'symbol') return $.safe(function () { return v.toString(); }, 'symbol', 'Symbol()');
        if (t === 'function') {
            var n = v.name || 'anonymous';
            return 'ƒ ' + n + '(' + (v.length ? v.length + ' arg' + (v.length > 1 ? 's' : '') : '') + ')';
        }
        if (t === 'node') {
            return '<' + String(v.nodeName || '?').toLowerCase() +
                (v.id ? '#' + v.id : '') +
                (v.className && typeof v.className === 'string' ? '.' + v.className.split(/\s+/).join('.') : '') + '>';
        }

        // Objects and arrays from here down.
        for (var i = 0; i < seen.length; i++) if (seen[i] === v) return '[circular]';
        if (depth > MAX_DEPTH) return t === 'array' ? '[…]' : '{…}';
        seen = seen.concat([v]);

        if (t === 'array') {
            var n = v.length, items = [], shown = Math.min(n, MAX_ITEMS);
            for (var k = 0; k < shown; k++) {
                items.push(k in v ? fmt(v[k], depth + 1, seen) : '<hole>');
            }
            if (n > shown) items.push('… ' + (n - shown) + ' more');
            return '(' + n + ') [' + items.join(', ') + ']';
        }

        if (v instanceof Error) {
            return v.name + ': ' + v.message;
        }
        if ($.safe(function () { return v instanceof Date; }, 'date', false)) {
            return $.safe(function () { return v.toISOString(); }, 'iso', 'Invalid Date');
        }

        var keys = $.safe(function () { return Object.keys(v); }, 'keys', []) || [];
        var name = ctorName(v);
        var prefix = (name && name !== 'Object') ? name + ' ' : '';
        if (!keys.length) return prefix + '{}';
        var parts = [], lim = Math.min(keys.length, MAX_KEYS);
        for (var j = 0; j < lim; j++) {
            var key = keys[j];
            // A property access can throw: RPG Maker defines accessors that
            // read $game* globals, and this may be called before those exist.
            var val = $.safe(function () { return v[key]; }, 'read ' + key, '<threw>');
            parts.push(key + ': ' + fmt(val, depth + 1, seen));
        }
        if (keys.length > lim) parts.push('… ' + (keys.length - lim) + ' more');
        return prefix + '{' + parts.join(', ') + '}';
    }

    /* =====================================================================
       PART 2 — EVALUATION
       ===================================================================== */
    var out = [];            // { kind, text } — kind: in|out|err|warn|log
    var MAX_OUT = 300;

    /**
     * One subscriber, not a list. There is only ever one console panel, and
     * the shell throws the whole tab away and rebuilds it on every rerender —
     * so a list would grow one painter per rebuild, every one of them writing
     * into a detached node for the rest of the session.
     */
    var listener = null;

    C.output = function () { return out.slice(); };
    C.onOutput = function (fn) { listener = fn; return fn; };
    C.listenerCount = function () { return listener ? 1 : 0; };
    C.clear = function () { out.length = 0; emit(); };

    function push(kind, text) {
        out.push({ kind: kind, text: text });
        while (out.length > MAX_OUT) out.shift();
    }
    function emit() { if (listener) $.safe(listener, 'console listener'); }

    /**
     * Indirect eval, so the code runs in global scope — `var x = 1` sticks,
     * and `$gameParty` resolves without being threaded in. A direct eval here
     * would put declarations in this module's closure and lose them.
     */
    var globalEval = eval;

    function captureConsole(sink) {
        if (!$.store.cfgGet('console.captureLog', true)) return function () { };
        var names = ['log', 'info', 'warn', 'error', 'debug'];
        var saved = {};
        names.forEach(function (n) {
            if (typeof console === 'undefined' || typeof console[n] !== 'function') return;
            saved[n] = console[n];
            console[n] = function () {
                var parts = [];
                for (var i = 0; i < arguments.length; i++) {
                    parts.push(typeof arguments[i] === 'string' ? arguments[i] : C.format(arguments[i]));
                }
                sink(n === 'error' ? 'err' : n === 'warn' ? 'warn' : 'log', parts.join(' '));
                return saved[n].apply(console, arguments);
            };
        });
        return function () {
            Object.keys(saved).forEach(function (n) { console[n] = saved[n]; });
        };
    }

    /**
     * Run a fragment. Returns { ok, value, error }.
     *
     * Nothing here rethrows: an exception from the console is a result to
     * display, not something to let escape into a game frame.
     */
    C.run = function (src, quiet) {
        src = String(src == null ? '' : src);
        if (!src.trim()) return { ok: true, value: undefined, empty: true };

        // Read-only cannot tell a read from a write in arbitrary source, so it
        // refuses the whole thing rather than pretending to be selective.
        if ($.isReadOnly()) {
            $.allowWrite('Running console code');
            push('err', 'read-only mode is on — the console cannot tell a read from a write, so it refuses both');
            emit();
            return { ok: false, error: 'read-only' };
        }

        if (!quiet) push('in', src);
        var restore = captureConsole(function (kind, text) { push(kind, text); });
        var result;
        try {
            result = { ok: true, value: globalEval(src) };
            push('out', C.format(result.value));
        } catch (e) {
            result = { ok: false, error: e };
            push('err', (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)));
            var stack = e && e.stack ? String(e.stack).split('\n').slice(1, 4).join('\n') : '';
            if (stack) push('err', stack);
        } finally {
            $.safe(restore, 'console restore');
        }

        C.remember(src);
        emit();
        return result;
    };

    /* -------------------------------------------------------------- history */
    var HIST_FILE = 'console.json';
    var history = null;
    var histWritten = false;

    function hist() {
        if (!history) {
            var raw = $.store.read(HIST_FILE, null);
            history = (raw && Array.isArray(raw.history)) ? raw.history.filter(function (x) {
                return typeof x === 'string';
            }) : [];
        }
        return history;
    }
    C.history = function () { return hist().slice(); };

    C.remember = function (src) {
        var list = hist();
        // Re-running the same line should not fill the history with copies.
        if (list.length && list[list.length - 1] === src) return;
        list.push(src);
        var max = Math.floor($.store.cfgGet('console.historyMax', 100)) || 100;
        while (list.length > max) list.shift();
        // Written immediately, not debounced. A debounced write is the right
        // call for a slider dragging at 60fps; here it means a line you ran and
        // then quit within 250ms is simply gone, which is the one thing the
        // history exists to prevent. The first write of the session is loud so
        // the path is visible at least once (§6.6); the rest are not, or every
        // console line would add one.
        $.store.write(HIST_FILE, { history: list }, histWritten);
        histWritten = true;
    };

    C.clearHistory = function () {
        history = [];
        $.store.write(HIST_FILE, { history: [] });
    };

    /* ---------------------------------------------------------- completion
       Only for a plain dotted path — `$gameParty.mem`. Anything with a call,
       an index or an operator in it is left alone, because completing it would
       mean evaluating it, and evaluating half-typed code with side effects is
       not a feature anybody asked for.
       --------------------------------------------------------------------- */
    var SAFE_PATH = /(^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\.?)$/;

    C.complete = function (src) {
        var m = SAFE_PATH.exec(String(src || ''));
        if (!m) return { prefix: '', options: [] };
        var path = m[2];
        var parts = path.split('.');
        var partial = parts.pop();
        var basePath = parts.join('.');

        var base = window;
        if (basePath) {
            base = $.safe(function () {
                var node = window;
                for (var i = 0; i < parts.length; i++) {
                    node = node[parts[i]];
                    if (node === null || node === undefined) return null;
                }
                return node;
            }, 'complete base', null);
        }
        if (base === null || base === undefined) return { prefix: partial, options: [] };

        var names = $.safe(function () {
            var seen = {}, list = [], node = base, hops = 0;
            while (node && hops < 4) {
                Object.getOwnPropertyNames(node).forEach(function (n) {
                    if (seen[n]) return;
                    seen[n] = 1;
                    list.push(n);
                });
                node = Object.getPrototypeOf(node);
                hops++;
            }
            return list;
        }, 'complete names', []) || [];

        var hits = names.filter(function (n) {
            return n.indexOf(partial) === 0 && n.indexOf('__') !== 0;
        }).sort();
        return { prefix: partial, base: basePath, options: hits.slice(0, 60), total: hits.length };
    };

    /* =====================================================================
       PART 3 — SNIPPETS
       ===================================================================== */
    var SNIP_FILE = 'snippets.json';
    var snippets = null;

    /** Ids become part of a dotted settings path (`hotkeys.snippet:<id>`), so
        a dot in one would make store.cfgSet descend into a nested object and
        write a bind no keydown can ever match — and the file is user-editable,
        so this cannot only be enforced where ids are generated. */
    function cleanId(v) {
        return String(v == null ? '' : v).toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    /* ---------------------------------------------------------- defaults
       The library shipped empty, which meant the first thing a new user saw
       was an empty box and no clue what could go in it. These seven are the
       questions worth asking about a game the mod knows nothing about, and
       each one is written out rather than hidden behind an API call, so they
       double as documentation of the services: read one, edit it, run it.

       Written as GigaHack.* and not $.*: `$` is this file's closure parameter
       and does not exist in the global scope where C.run evaluates.

       They are SEEDED, not written. The file is only created once the user
       saves or deletes something, so a default that has been deleted stays
       deleted, and one that has been left alone is refreshed with the mod.
       -------------------------------------------------------------------- */
    var DEFAULTS = [
        {
            id: 'gh-environment',
            name: 'what engine and capabilities am I on',
            code: '// Engine, host, renderer, CSS floor, save format — every capability\n' +
                '// GigaHack probed at boot, and the reason for each one that is missing.\n' +
                'console.log(GigaHack.caps.reportText());\n' +
                'GigaHack.caps.report();\n'
        },
        {
            id: 'gh-profile',
            name: 'what does GigaHack know about this game',
            code: '(function () {\n' +
                '    var p = GigaHack.profile.active();\n' +
                '    return {\n' +
                '        profile: p.id + (p.generic ? " (computed defaults, no profile written)" : ""),\n' +
                '        game: p.name,\n' +
                '        sectionHeaders: p.sectionPattern ? String(p.sectionPattern) : "this project uses no convention",\n' +
                '        forgeBase: p.forgeBase,\n' +
                '        counts: p.counts\n' +
                '    };\n' +
                '}());\n'
        },
        {
            id: 'gh-frameworks',
            name: 'which plugins is GigaHack worried about',
            code: '// Recognised plugin suites, and the named consequence of each one.\n' +
                '// Empty is a good answer: it means nothing known to fight the mod is loaded.\n' +
                'GigaHack.compat.frameworks().map(function (f) {\n' +
                '    return f.name + " [" + f.plugins.join(", ") + "]\\n  affects: " +\n' +
                '        (f.affects.join(", ") || "nothing this mod writes") + "\\n  " + f.note;\n' +
                '});\n'
        },
        {
            id: 'gh-self-test',
            name: 'what actually works on this build',
            code: '// LIVE tests against the running game: each one writes a sentinel and\n' +
                '// reads it back, so run it on a save you do not mind touching.\n' +
                '// Only the results that are not a clean pass are returned.\n' +
                'GigaHack.compat.selfTest().filter(function (r) { return r.state !== "pass"; });\n'
        },
        {
            id: 'gh-index',
            name: 'what is the index holding',
            code: '(function () {\n' +
                '    var s = GigaHack.index.status();\n' +
                '    // Every note is a stage that could not run, and why.\n' +
                '    s.notes.forEach(function (n) { console.warn(n); });\n' +
                '    return s;\n' +
                '}());\n'
        },
        {
            id: 'gh-events-touching',
            name: 'find every event that touches this switch',
            code: '(function () {\n' +
                '    var id = 1;                       // <- the switch id to look for\n' +
                '    var r = GigaHack.index.findEventsTouching("switch", id);\n' +
                '    // The index is for FINDING, never authority: this is a candidate\n' +
                '    // list, and `complete` says whether it could see everything.\n' +
                '    if (!r.complete) { console.warn(r.why); }\n' +
                '    return r.candidates.map(function (c) {\n' +
                '        return c.mapName + " · event " + c.eventId + " " + c.eventName +\n' +
                '            " (" + c.x + "," + c.y + ")";\n' +
                '    });\n' +
                '}());\n'
        },
        {
            id: 'gh-find-by-name',
            name: 'find a switch or variable by name',
            code: '(function () {\n' +
                '    var q = "gold";                   // <- any part of the name\n' +
                '    var v = GigaHack.index.findVar(q), s = GigaHack.index.findSwitch(q);\n' +
                '    if (!v.complete) { console.warn(v.why); }\n' +
                '    return {\n' +
                '        variables: v.candidates.slice(0, 20),\n' +
                '        switches: s.candidates.slice(0, 20)\n' +
                '    };\n' +
                '}());\n'
        }
    ];
    C.defaults = function () { return DEFAULTS.slice(); };

    function snips() {
        if (!snippets) {
            var raw = $.store.read(SNIP_FILE, null);
            var stored = (raw && Array.isArray(raw.snippets)) ? raw.snippets : null;
            var seeded = stored === null;
            var list = seeded ? DEFAULTS : stored;
            snippets = [];
            var seen = {}, dropped = 0;
            list.forEach(function (s) {
                if (!s || typeof s !== 'object') { dropped++; return; }
                var id = cleanId(s.id);
                // A duplicate id would give two records one hotkey and one
                // lookup: the bind would be labelled with the second one's name
                // and run the first one's code.
                if (!id || seen[id]) { dropped++; return; }
                seen[id] = 1;
                snippets.push({
                    id: id,
                    name: String(s.name || id),
                    code: String(s.code || ''),
                    modified: s.modified || 0
                });
            });
            if (dropped) $.log('warn', SNIP_FILE + ': dropped ' + dropped + ' unusable snippet(s)');
            if (seeded) {
                $.log('info', 'console: no snippet library yet, so it starts with ' + snippets.length +
                    ' starter snippet(s). Saving or deleting any of them writes ' + SNIP_FILE +
                    ' and they stop being refreshed from the mod.');
            }
        }
        return snippets;
    }
    C.snippets = function () { return snips().slice(); };

    /** Drop the in-memory caches and re-read both files, as a launch would. */
    C.reload = function () {
        snippets = null;
        history = null;
        bindSnippets();
        return { snippets: snips().length, history: hist().length };
    };
    C.snippet = function (id) {
        var list = snips();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    };

    function saveSnips() {
        $.store.write(SNIP_FILE, { snippets: snips() });
        bindSnippets();
    }

    function newId(name) {
        var base = cleanId(name) || 'snippet';
        var id = base, n = 2;
        while (C.snippet(id)) { id = base + '-' + n; n++; }
        return id;
    }

    C.saveSnippet = function (name, code, id) {
        if (!$.allowWrite('Saving a snippet')) return null;
        var rec = id ? C.snippet(id) : null;
        if (!rec) {
            rec = { id: newId(name), name: '', code: '', modified: 0 };
            snips().push(rec);
        }
        rec.name = String(name || rec.id);
        rec.code = String(code || '');
        rec.modified = Date.now();
        saveSnips();
        $.log('ok', 'snippet saved: ' + rec.name);
        return rec;
    };

    C.deleteSnippet = function (id) {
        if (!$.allowWrite('Deleting a snippet')) return false;
        var list = snips();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id !== id) continue;
            list.splice(i, 1);
            // Drop its bind too, or the Settings panel keeps offering a key
            // for something that no longer exists.
            $.store.cfgSet('hotkeys.snippet:' + id, null);
            saveSnips();
            return true;
        }
        return false;
    };

    C.runSnippet = function (id) {
        var rec = C.snippet(id);
        if (!rec) return null;
        $.log('info', 'running snippet "' + rec.name + '"');
        var r = C.run(rec.code);
        if (r && r.ok) {
            U.toast({ title: 'SNIPPET', msg: rec.name, severity: 'ok', ms: 1600 });
        } else if (r && r.error !== 'read-only') {
            U.toast({ title: 'SNIPPET FAILED', msg: rec.name + ' — see the console', severity: 'err' });
        }
        return r;
    };

    /** One bind per snippet, registered through the shell's hotkey registry. */
    function bindSnippets() {
        (U.hotkeyList() || []).forEach(function (d) {
            if (d.id.indexOf('snippet:') === 0) U.removeHotkey(d.id);
        });
        snips().forEach(function (rec) {
            U.addHotkey({
                id: 'snippet:' + rec.id,
                label: 'Run "' + rec.name + '"',
                help: 'Snippet from the console library',
                run: function () { C.runSnippet(rec.id); }
            });
        });
    }
    bindSnippets();

    /* =====================================================================
       PART 4 — ERROR CAPTURE
       Hooks.js already nets uncaught errors, but it keeps one log line and
       throws the stack away. These listeners keep the structure. They do not
       replace it — both run, and neither suppresses the game's own printer.
       ===================================================================== */
    var errors = [];
    var MAX_ERRORS = 60;

    /* =====================================================================
       ACTION RECORDER

       "Macro recording" for a game like this is not keystroke capture. Input
       replay against a game with async asset loads, message timing and its own
       RNG reproduces nothing reliably, and a macro that works four times in
       five is worse than none.

       What IS reproducible is the thing GigaHack itself did. Every feature has
       a $.api entry point, so recording wraps those and writes out the calls
       as JavaScript — which is a snippet, which the library already runs. The
       result is a macro you can read, edit and diff before you trust it.
       ===================================================================== */
    var recording = false, tape = [];
    var recName = '';

    C.recording = function () { return recording; };
    C.tape = function () { return tape.slice(); };
    C.clearTape = function () { tape.length = 0; return true; };

    function literal(v) {
        if (v === undefined) return 'undefined';
        if (v === null) return 'null';
        var t = typeof v;
        if (t === 'number' || t === 'boolean') return String(v);
        if (t === 'string') return JSON.stringify(v);
        if (t === 'function') return '/* function */ null';
        return $.safe(function () { return JSON.stringify(v); }, 'literal', '/* unserialisable */ null');
    }

    /**
     * Wrap every $.api function once.
     *
     * Done at load rather than when recording starts: wrapping and unwrapping
     * live would fight anything else that has aliased the same functions, and
     * this way the tape is simply not appended to while `recording` is false.
     * Later modules add to $.api after this file runs, so the wrap is redone
     * lazily whenever a new key appears.
     */
    var wrapped = Object.create(null);

    function wrapApi() {
        Object.keys($.api).forEach(function (name) {
            if (wrapped[name] || typeof $.api[name] !== 'function') return;
            var original = $.api[name];
            wrapped[name] = true;
            $.api[name] = function () {
                if (recording) {
                    var args = Array.prototype.slice.call(arguments).map(literal).join(', ');
                    // GigaHack.api, not $.api: `$` is this file's closure
                    // parameter and does not exist in global scope, which is
                    // where C.run evaluates. A tape written as $.api threw
                    // ReferenceError on its first line — i.e. every recording
                    // was unrunnable.
                    tape.push('GigaHack.api.' + name + '(' + args + ');');
                }
                return original.apply(this, arguments);
            };
        });
    }
    C.wrapApi = wrapApi;

    C.record = function (on) {
        on = !!on;
        if (on) wrapApi();
        recording = on;
        U.setActive('recording', on);
        $.log(on ? 'warn' : 'info', on ? 'recording GigaHack actions' : 'recording stopped (' + tape.length + ' step(s))');
        return recording;
    };

    /** The tape as a runnable snippet body. */
    C.tapeCode = function () {
        if (!tape.length) return '';
        return '// recorded with GigaHack\n' + tape.join('\n') + '\n';
    };

    C.saveTape = function (name) {
        if (!tape.length) return null;
        return C.saveSnippet(name || 'recording', C.tapeCode());
    };

    C.errors = function () { return errors.slice(); };
    C.clearErrors = function () { errors.length = 0; };

    function record(kind, message, where, stack) {
        errors.push({
            kind: kind, message: String(message || 'unknown'),
            where: where || '', stack: stack || '', t: Date.now()
        });
        while (errors.length > MAX_ERRORS) errors.shift();
    }

    window.addEventListener('error', function (e) {
        if (!e) return;
        record('error', e.message,
            (e.filename || '?').split(/[\\/]/).pop() + ':' + (e.lineno || '?') + ':' + (e.colno || '?'),
            e.error && e.error.stack ? String(e.error.stack) : '');
    });
    window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        record('rejection', (r && r.message) ? r.message : String(r), '',
            (r && r.stack) ? String(r.stack) : '');
    });

    $.api.eval = function (src) { return C.run(src); };
    $.api.snippets = function () { return C.snippets(); };
    $.api.errors = function () { return C.errors(); };

    /* ---------------------------------------------------------------------
       The services, on the API surface.

       The panels are thin: nearly everything they show comes from a handful of
       services, and on a game nobody has written a profile for those services
       ARE the toolkit. Each is guarded, because a module that did not load
       should answer with a stated reason rather than throw ReferenceError at
       someone who is already debugging something else.

       Only names no other module owns are registered here. Boot owns
       api.caps, api.profile, api.selfTest, api.loadOrder and api.index, and it
       loads after this file — registering those names here would simply be
       overwritten, so they are documented in reference() instead.
       ------------------------------------------------------------------ */
    function absent(mod, call) {
        return { error: 'GigaHack.' + mod + ' did not load, so ' + call + ' has nothing to ask.' };
    }

    /** Plugin suites GigaHack recognises, and the named consequence of each. */
    $.api.frameworks = function () {
        if (!$.compat || !$.compat.frameworks) return absent('compat', 'frameworks()');
        return $.compat.frameworks();
    };

    /** Every event that reads or writes a switch, variable or self-switch. */
    $.api.eventsTouching = function (kind, id) {
        if (!$.index || !$.index.findEventsTouching) return absent('index', 'eventsTouching()');
        return $.index.findEventsTouching(kind || 'switch', Number(id) || 0);
    };

    /**
     * Everything a bug report needs, in one read-only call.
     *
     * Read-only deliberately: the self-test writes sentinels into the running
     * game, so it stays behind its own name (GigaHack.api.selfTest) and is
     * never something this fires as a side effect of being asked a question.
     */
    $.api.diagnose = function () {
        var out = {
            engine: $.safe(function () { return $.caps.engine + ' ' + $.caps.engineVersion; }, 'diagnose engine', 'unknown'),
            host: $.safe(function () { return ($.caps.nwjs ? 'NW.js' : 'browser') + ' · Chromium ' + ($.caps.chromeVersion || '?'); }, 'diagnose host', 'unknown'),
            layout: $.safe(function () { return $.paths.layout + ' · settings in ' + $.paths.mode; }, 'diagnose paths', 'unknown'),
            capabilities: $.safe(function () { return $.caps.report(); }, 'diagnose caps', []),
            profile: $.safe(function () {
                if (!$.profile) return 'the profile module did not load';
                var pr = $.profile.active();
                return pr.id + (pr.generic ? ' (computed defaults)' : '');
            }, 'diagnose profile', 'unknown'),
            loadOrder: $.safe(function () { return $.compat ? $.compat.loadOrder() : null; }, 'diagnose load order', null),
            frameworks: $.safe(function () {
                return $.compat ? $.compat.frameworks().map(function (f) { return f.name; }) : [];
            }, 'diagnose frameworks', []),
            degraded: $.safe(function () { return $.compat ? $.compat.degradedList() : []; }, 'diagnose degraded', []),
            index: $.safe(function () { return $.index ? $.index.status() : null; }, 'diagnose index', null)
        };
        $.safe(function () { console.log('[GigaHack]\n' + $.caps.reportText()); }, 'diagnose print');
        return out;
    };

    /* =====================================================================
       PART 5 — THE CONSOLE PANEL
       ===================================================================== */
    function timeOf(ms) {
        return $.safe(function () {
            var d = new Date(ms), p = function (n) { return String(n).padStart(2, '0'); };
            return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        }, 'time', '--:--:--');
    }

    function buildConsole() {
        var histAt = hist().length;      // where Alt+Up starts from
        var editor = h('textarea', {
            class: 'mm-code', spellcheck: 'false', rows: '5',
            placeholder: '$gameParty.gainGold(1000)\n\nctrl+enter runs · tab completes · alt+↑ history'
        });
        var outBox = h('div', { class: 'mm-out' });
        var comp = h('div', { class: 'mm-comp' });
        var stick = true;               // follow the tail unless the user scrolls up

        var outGroup = null;
        function paintOut() {
            // The panel this belongs to may already have been rebuilt away.
            if (!outBox.parentNode) { listener = null; return; }
            // Emptying a scroll container drops its scrollHeight to zero and the
            // browser clamps scrollTop to 0 with it — so a rebuild while the
            // user was reading something further up put them at the very top
            // instead. Same failure the virtual tables hit; same fix.
            var was = outBox.scrollTop;
            clear(outBox);
            if (outGroup) outGroup.mm.tag(out.length + ' lines');
            out.forEach(function (row) {
                outBox.appendChild(h('div', { class: 'mm-out-row mm-out-' + row.kind },
                    h('span', { class: 'mm-out-gut', text: row.kind === 'in' ? '›' : row.kind === 'out' ? '‹' : '·' }),
                    h('span', { class: 'mm-out-txt', text: row.text })));
            });
            outBox.scrollTop = stick ? outBox.scrollHeight
                : Math.min(was, Math.max(0, outBox.scrollHeight - outBox.clientHeight));
        }
        outBox.addEventListener('scroll', function () {
            stick = outBox.scrollTop + outBox.clientHeight >= outBox.scrollHeight - 4;
        });

        function paintComp(res) {
            clear(comp);
            if (!res || !res.options.length) return;
            res.options.slice(0, 24).forEach(function (name) {
                var b = h('button', { type: 'button', text: name });
                // Recomputed on click, never taken from the list that was
                // painted: the editor may have been typed into since, and
                // splicing off a prefix that is no longer there produced
                // `$gameParty.gaigainGold`.
                b.addEventListener('click', function () { accept(name); });
                comp.appendChild(b);
            });
            if (res.total > 24) comp.appendChild(h('span', { class: 'mm-sub', text: '+' + (res.total - 24) + ' more' }));
        }

        /** Complete at the caret, not at the end of the buffer. */
        function here() {
            var caret = editor.selectionStart;
            if (caret == null || caret < 0) caret = editor.value.length;
            return { caret: caret, left: editor.value.slice(0, caret) };
        }

        function accept(name) {
            var at = here();
            var fresh = C.complete(at.left);
            if (!fresh || fresh.options.indexOf(name) === -1) { clear(comp); return; }
            editor.value = at.left.slice(0, at.left.length - fresh.prefix.length) + name +
                editor.value.slice(at.caret);
            var pos = at.caret - fresh.prefix.length + name.length;
            clear(comp);
            editor.focus();
            $.safe(function () { editor.setSelectionRange(pos, pos); }, 'caret');
        }

        // Any edit invalidates whatever is on the strip.
        editor.addEventListener('input', function () { if (comp.firstChild) clear(comp); });

        function run() {
            var src = editor.value;
            if (!src.trim()) return;
            stick = true;
            C.run(src);
            histAt = hist().length;
            editor.value = '';
            clear(comp);
            editor.focus();
        }

        editor.addEventListener('keydown', function (e) {
            if (e.code === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault(); e.stopPropagation();
                run();
                return;
            }
            if (e.code === 'Tab') {
                // Completion, not focus movement — there is nowhere useful for
                // focus to go from here and losing the caret mid-expression is
                // worse than no tab key at all.
                e.preventDefault(); e.stopPropagation();
                var res = C.complete(here().left);
                if (res.options.length === 1) accept(res.options[0]);
                else paintComp(res);
                return;
            }
            // Alt, not bare arrows: the arrows have to keep moving the caret in
            // a multi-line editor.
            if (e.altKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
                e.preventDefault(); e.stopPropagation();
                var list = hist();
                if (!list.length) return;
                histAt += (e.code === 'ArrowUp' ? -1 : 1);
                histAt = U.clamp(histAt, 0, list.length);
                editor.value = histAt >= list.length ? '' : list[histAt];
                return;
            }
        });

        // Direct, not through paintOut: the box is not in the document yet, and
        // the detached-node guard would (correctly) refuse.
        out.forEach(function (row) {
            outBox.appendChild(h('div', { class: 'mm-out-row mm-out-' + row.kind },
                h('span', { class: 'mm-out-gut', text: row.kind === 'in' ? '›' : row.kind === 'out' ? '‹' : '·' }),
                h('span', { class: 'mm-out-txt', text: row.text })));
        });
        setTimeout(function () { if (outBox.parentNode) outBox.scrollTop = outBox.scrollHeight; }, 0);
        C.onOutput(paintOut);

        var main = [
            W.group('Evaluate', [
                editor,
                comp,
                h('div', { class: 'mm-inline', style: 'padding:3px 2px' },
                    W.button({ label: 'run  (ctrl+enter)', wide: true, variant: 'prime', mutates: true, onClick: run }),
                    W.button({
                        label: 'save as snippet', wide: true, mutates: true,
                        onClick: function () {
                            var code = editor.value;
                            if (!code.trim()) { U.toast({ title: 'NOTHING TO SAVE', msg: 'the editor is empty', severity: 'warn' }); return; }
                            var first = code.split('\n')[0].slice(0, 40);
                            if (C.saveSnippet(first, code)) U.rerender();
                        }
                    }),
                    W.button({ label: 'clear output', _ungated: true, onClick: function () { C.clear(); } }))
            ], { tag: 'global scope' }),
            outGroup = W.group('Output', [outBox], { grow: true, tag: out.length + ' lines' })
        ];

        return cols(main, { narrow: true, items: sidebar(editor) });
    }

    function sidebar(editor) {
        var list = C.snippets();
        var snipRows = list.length ? list.map(function (rec) {
            return h('div', { class: 'mm-row' },
                h('div', {
                    class: 'mm-lab', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                    text: rec.name, tip: rec.name + '|' + rec.code.split('\n')[0].slice(0, 80)
                }),
                h('div', { class: 'mm-edge' },
                    W.button({
                        label: 'run', mini: true, mutates: true,
                        onClick: function () { C.runSnippet(rec.id); }
                    }),
                    W.button({
                        label: 'edit', mini: true, _ungated: true,
                        onClick: function () { if (editor) { editor.value = rec.code; editor.focus(); } }
                    }),
                    W.button({
                        label: '−', mini: true, variant: 'danger',
                        onClick: function () { if (C.deleteSnippet(rec.id)) U.rerender(); }
                    })));
        }) : [h('div', { class: 'mm-empty', text: 'no snippets yet' })];

        var histList = C.history().slice(-12).reverse();
        var histRows = histList.length ? histList.map(function (src) {
            var one = src.split('\n')[0].slice(0, 60);
            var b = W.button({ label: one, wide: true, _ungated: true, tip: 'History|' + src.slice(0, 200) });
            b.addEventListener('click', function () { if (editor) { editor.value = src; editor.focus(); } });
            b.style.justifyContent = 'flex-start';
            b.style.fontFamily = 'var(--mm-font-mono)';
            b.style.overflow = 'hidden';
            b.style.textOverflow = 'ellipsis';
            b.style.whiteSpace = 'nowrap';
            b.style.display = 'block';
            b.style.textAlign = 'left';
            return b;
        }) : [h('div', { class: 'mm-empty', text: 'nothing run yet' })];

        return [
            W.group('Snippets', snipRows, {
                tag: list.length + ' saved',
                tip: 'Snippets|Each can take a hotkey in Settings → Hotkeys.'
            }),

            W.group('Record what you do', [
                W.toggleRow('Recording', {
                    value: C.recording(), keybind: false, _ungated: true,
                    tip: 'Recording|GigaHack actions with an API entry point, written as ' +
                        'replayable JavaScript — not keystrokes.',
                    onChange: function (v) { C.record(v); U.rerender(); }
                }),
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Steps' }),
                    h('div', { class: 'mm-edge mm-mono ' + (C.tape().length ? 'mm-hi' : 'mm-sub'), text: String(C.tape().length) })),
                C.tape().length ? h('div', { class: 'mm-pre', text: C.tapeCode() }) : null,
                W.row('Save as', W.text({
                    value: recName, width: '132px', placeholder: 'snippet name',
                    onInput: function (v) { recName = v; },
                    onEnter: function (v) { if (C.saveTape(v)) { recName = ''; C.clearTape(); U.rerender(); } }
                })),
                W.button({
                    label: 'save the recording as a snippet', wide: true, mutates: true,
                    disabled: !C.tape().length,
                    onClick: function () {
                        if (!C.saveTape(recName || 'recording')) return;
                        recName = ''; C.clearTape(); U.rerender();
                    }
                }),
                W.button({
                    label: 'throw it away', wide: true, _ungated: true, disabled: !C.tape().length,
                    onClick: function () { C.clearTape(); U.rerender(); }
                })
            ], { tag: C.recording() ? 'live' : (C.tape().length + ' step(s)'), collapsed: !C.recording() && !C.tape().length }),

            W.group('History', histRows.concat([
                W.button({
                    label: 'clear history', wide: true, variant: 'danger',
                    onClick: function () { C.clearHistory(); U.rerender(); }
                })
            ]), { tag: C.history().length + ' lines', collapsed: !histList.length }),

            W.group('Reference', [
                h('div', { class: 'mm-pre', text: reference() })
            ], { tag: 'GigaHack.api', collapsed: true }),

            W.group('Behaviour', [
                W.toggleRow('Capture console.log', {
                    value: $.store.cfgGet('console.captureLog', true) !== false, keybind: false, _ungated: true,
                    tip: 'Capture|warn and error too; the real console still gets them.',
                    onChange: function (v) { $.store.cfgSet('console.captureLog', v); }
                })
            ], { collapsed: true })
        ];
    }

    /**
     * What is reachable from the editor, written as it must be TYPED.
     *
     * `GigaHack.`, never `$.` — the closure parameter this file calls `$` does
     * not exist in the global scope where C.run evaluates, and a reference
     * that cannot be pasted is worse than none.
     */
    function reference() {
        var names = Object.keys($.api).sort();
        return 'GigaHack.api.*\n  ' + names.join('\n  ') +
            '\n\nservices — the same objects every panel is built on:\n' +
            '  GigaHack.caps.report()              engine + capability table, with reasons\n' +
            '  GigaHack.caps.reportText()          the same thing as pasteable text\n' +
            '  GigaHack.profile.active()           what is known about this game\n' +
            '  GigaHack.compat.frameworks()        plugin suites, and what each one breaks\n' +
            '  GigaHack.compat.selfTest()          live write tests — these WRITE to the game\n' +
            '  GigaHack.compat.loadOrder()         are our aliases outermost, and why not\n' +
            '  GigaHack.index.status()             what the index holds, and what it skipped\n' +
            '  GigaHack.index.findEventsTouching(\'switch\', 42)\n' +
            '  GigaHack.index.findVar(q) / findSwitch(q) / findMap(q) / findAsset(q)\n' +
            '  every index query returns {candidates, complete, why} — candidates only,\n' +
            '  never authority: resolve each one against live $data*/$game* before use.\n' +
            '\nglobals: $gameParty $gameActors $gameVariables\n' +
            '         $gameSwitches $gameMap $gamePlayer\n' +
            '         $dataItems $dataSkills $dataStates';
    }

    /* =====================================================================
       PART 6 — THE LOG PANEL
       ===================================================================== */
    /**
     * How many lines the log ring holds, without copying it.
     *
     * `$.logHistory()` answers with a slice of up to `$.logCapacity()` entries,
     * and a signal asked every 700ms must not allocate one of those to find out
     * that nothing has changed. Core publishes no count today; when it does,
     * this reads it, and until then the copy is paid for once per tick rather
     * than pretending the problem is not there.
     */
    function logCount() {
        if (typeof $.logCount === 'function') return $.logCount();
        return $.logHistory().length;
    }

    function buildLog() {
        var q = '';
        var levels = { info: true, ok: true, warn: true, err: true };

        function rows() {
            return $.logHistory().filter(function (e) {
                if (!levels[e.level]) return false;
                if (q && e.msg.toLowerCase().indexOf(q) === -1) return false;
                return true;
            });
        }

        var table = W.table({
            virtual: true, rowH: 17,
            cols: [
                { label: 'time', w: '0 0 60px', cls: 'mm-td-num' },
                { label: 'level', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'message', w: '1 1 0' }
            ],
            empty: 'nothing matches',
            render: function (e) {
                return [
                    timeOf(e.t),
                    h('span', { class: 'mm-sev-' + e.level, text: e.level }),
                    h('span', { text: e.msg })
                ];
            },
            onRow: function (tr, e) {
                if (e.level === 'err') tr.style.color = 'var(--mm-danger)';
                else if (e.level === 'warn') tr.style.color = 'var(--mm-warn)';
                tr.setAttribute('data-mm-tip', e.level + '|' + e.msg);
            }
        });

        var tag = h('span', { class: 'mm-group-tag' });
        function repaint() {
            /* An append-only list is read from the bottom, so following the
               tail is the whole behaviour — but only for somebody who is AT
               the tail. Anywhere else, every new line would yank them forward
               out of what they were reading. Four pixels of slack, because a
               scroller does not always land on an exact boundary. */
            var body = table.mm.body;
            var atTail = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
            var r = rows();
            tag.textContent = r.length + ' / ' + logCount();
            table.mm.paint(r);
            if (!atTail) return;
            // Past the end clamps to the end; refresh() then draws the window
            // that scroll position actually lands on.
            body.scrollTop = body.scrollHeight;
            table.mm.refresh();
        }
        repaint();

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({ placeholder: 'search the log…', onInput: function (v) { q = v.trim(); repaint(); } }),
            ['info', 'ok', 'warn', 'err'].map(function (lv) {
                return W.chip({
                    label: lv, value: true,
                    onChange: function (on) { levels[lv] = on; repaint(); }
                });
            }));

        var group = W.group('Log', [toolbar, table], { grow: true });
        group.mm.head.appendChild(tag);

        /* The errors are in a container of their own so a new one can appear
           without the "clear" button under them being replaced. Each row's
           stack is expanded by a click, and that state lives on the node — so
           the list is rebuilt only when the COUNT has moved, which is the one
           time there is something new to show. */
        var errBox = h('div', { class: 'mm-stack-tight' });
        function paintErrors() {
            var errs = C.errors();
            clear(errBox);
            add(errBox, errs.length ? errs.slice().reverse().map(function (e) {
                var body = h('div', { class: 'mm-trace', style: 'display:none', text: e.stack || '(no stack)' });
                var head = h('div', { class: 'mm-row' },
                    h('div', {
                        class: 'mm-lab', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                        text: e.message
                    }),
                    h('div', { class: 'mm-edge mm-mono mm-sub', text: timeOf(e.t) }));
                head.style.cursor = 'pointer';
                head.addEventListener('click', function () {
                    body.style.display = body.style.display === 'none' ? 'block' : 'none';
                });
                return h('div', {}, head,
                    e.where ? h('div', { class: 'mm-sub mm-mono', style: 'padding-left:2px', text: e.where }) : null,
                    body);
            }) : [h('div', { class: 'mm-empty', text: 'no uncaught errors' })]);
            return errs.length;
        }
        var errCount = paintErrors();
        var errGroup = W.group('Uncaught errors', [
            errBox,
            W.button({
                label: 'clear', wide: true, _ungated: true,
                onClick: function () { C.clearErrors(); U.rerender(); }
            })
        ], { tag: errCount ? errCount + ' caught' : 'clean' });

        var levelCells = [];
        var breakdownGroup = W.group('Breakdown', ['info', 'ok', 'warn', 'err'].map(function (lv) {
            var cell = h('div', { class: 'mm-edge mm-mono mm-sub', text: '0' });
            levelCells.push({ level: lv, el: cell });
            return h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab' }, h('span', { class: 'mm-sev-' + lv, text: lv })),
                cell);
        }).concat([
            h('div', { class: 'mm-sep' }),
            W.button({
                label: 'copy what is shown', wide: true, _ungated: true,
                onClick: function () {
                    var text = rows().map(function (e) {
                        return timeOf(e.t) + '  ' + e.level + '  ' + e.msg;
                    }).join('\n');
                    var ok = $.safe(function () {
                        if (typeof nw !== 'undefined' && nw.Clipboard) { nw.Clipboard.get().set(text, 'text'); return true; }
                        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return true; }
                        return false;
                    }, 'clipboard', false);
                    U.toast({
                        title: ok ? 'COPIED' : 'CLIPBOARD BLOCKED',
                        msg: ok ? rows().length + ' lines' : 'the log is also printed to the devtools console',
                        severity: ok ? 'ok' : 'warn'
                    });
                }
            })
        ]), { tag: '0 held' });

        /* The one thing on this panel that never stops moving. The shell's own
           log drawer is already live off $.logSink, so a frozen panel and a
           moving drawer disagree on the same screen — which reads as one of
           them being broken rather than as one of them being a snapshot.
           There is only ONE sink slot and the drawer owns it, so this is
           polled: the dropped count plus the length, which together move on
           every line whether or not the ring has started rolling.

           within: the table. Its search box is not in the thing being
           repainted and must not stop the log from following. */
        function paintCounts() {
            var all = $.logHistory();
            for (var i = 0; i < levelCells.length; i++) {
                var lv = levelCells[i], n = 0;
                for (var j = 0; j < all.length; j++) if (all[j].level === lv.level) n++;
                lv.el.textContent = String(n);
            }
            breakdownGroup.mm.tag(all.length + ' held');
        }
        paintCounts();

        U.live(function () {
            return $.logDropped() + ':' + logCount() + ':' + C.errors().length;
        }, function () {
            repaint();
            paintCounts();
            if (C.errors().length === errCount) return;
            errCount = paintErrors();
            errGroup.mm.tag(errCount ? errCount + ' caught' : 'clean');
        }, {
            name: 'log',
            within: table,
            when: function () { return !table.mm.isScrolling(); }
        });

        return cols([group], { narrow: true, items: [errGroup, breakdownGroup, null] });
    }

    U.debugPanel('Console', buildConsole, 60);
    U.debugPanel('Log', buildLog, 65);

    $.log('ok', 'console ready — ' + C.snippets().length + ' snippet(s), ' +
        C.history().length + ' line(s) of history');

    // Console loads after every feature module in the load order, so one pass
    // here catches all of them. C.record re-runs it anyway, which covers a
    // module that registers late or is enabled at runtime.
    wrapApi();

})(window.GigaHack);
