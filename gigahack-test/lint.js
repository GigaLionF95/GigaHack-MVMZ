#!/usr/bin/env node
/*
 * GigaHack MV/MZ — build lint.
 *
 * Four rules, each of which exists because breaking it produced a silent
 * failure that cost real time:
 *
 *   1. CORE OVERWRITE. `X.prototype.y = function` without saving the original
 *      destroys whatever another plugin installed. Every alias goes through
 *      $.install, which records it, states a reason when the target is
 *      missing, and lets Debug -> Hooks unpatch it.
 *
 *   2. CSS FLOOR. MV 1.6 ships NW.js 0.29 = Chromium 66. `gap`, `clamp()`,
 *      `:is()` and friends are not merely unsupported there — an unknown
 *      declaration is dropped, so the layout silently collapses rather than
 *      erroring. Only stylesheet text is checked; Math.min/$.clamp are fine.
 *
 *   3. JS FLOOR. The same Chromium 66. This checks only syntax that does not
 *      PARSE there — `??`, `?.`, logical assignment and friends. It does not
 *      police `let` or arrow functions, which work fine on the floor; the
 *      codebase is ES5 by convention, and convention is not worth failing a
 *      build over. A plugin that fails to parse does not fail loudly either:
 *      PluginManager pushes it onto _errorUrls and nothing ever reads that
 *      list again, so the module is simply absent.
 *
 *   4. NO GAME COUPLING. No hardcoded content ids in a table, no game name in
 *      a user-visible string, no third-party plugin named outside the compat
 *      quirks table.
 *
 * Exit code is the contract: 0 clean, 1 violations.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var PLUGINS = path.resolve(__dirname, '..', 'gigahack', 'js', 'plugins');
var PROFILES = path.resolve(__dirname, '..', 'gigahack', 'profiles');

/* Files allowed to name third-party plugin frameworks, because naming them is
   the whole point of the file. */
var NAMING_ALLOWED = ['GigaHack_Compat.js'];

/* -------------------------------------------------------------------------
   Tokeniser: strip comments and string/regex literals so a rule never fires
   on prose. Returns { code, strings } where `strings` keeps the literal
   contents (with positions) for the rules that DO want to look at them.
   ---------------------------------------------------------------------- */
function tokenise(src) {
    var code = '', strings = [];
    var i = 0, n = src.length, line = 1;
    var prevSignificant = '';

    function lineOf(pos) {
        var l = 1;
        for (var k = 0; k < pos; k++) if (src.charCodeAt(k) === 10) l++;
        return l;
    }

    while (i < n) {
        var c = src[i], d = src[i + 1];

        if (c === '/' && d === '/') {
            while (i < n && src[i] !== '\n') { i++; }
            continue;
        }
        if (c === '/' && d === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
                if (src[i] === '\n') code += '\n';
                i++;
            }
            i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            var quote = c, start = i + 1;
            i++;
            var buf = '';
            while (i < n) {
                if (src[i] === '\\') { buf += src[i + 1]; i += 2; continue; }
                if (src[i] === quote) break;
                if (src[i] === '\n') code += '\n';
                buf += src[i];
                i++;
            }
            i++;
            strings.push({ text: buf, line: lineOf(start), quote: quote });
            code += '@STR@';
            prevSignificant = '@STR@';
            continue;
        }
        /* Regex literal: only where a value is expected. */
        if (c === '/' && !/[\w)\]]$/.test(prevSignificant)) {
            var rs = i;
            i++;
            var inClass = false, ok = false;
            while (i < n) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === '[') inClass = true;
                else if (src[i] === ']') inClass = false;
                else if (src[i] === '/' && !inClass) { ok = true; break; }
                else if (src[i] === '\n') break;
                i++;
            }
            if (ok) {
                i++;
                while (i < n && /[a-z]/.test(src[i])) i++;
                code += '@RE@';
                prevSignificant = '@RE@';
                continue;
            }
            i = rs;
        }
        if (c === '\n') line++;
        code += c;
        if (!/\s/.test(c)) prevSignificant = c;
        i++;
    }
    return { code: code, strings: strings };
}

/* -------------------------------------------------------------------------
   Rules
   ---------------------------------------------------------------------- */
var violations = [];
function report(file, line, rule, detail) {
    violations.push({ file: file, line: line, rule: rule, detail: detail });
}

function lineNumbers(code) {
    return code.split('\n');
}

/* 1. Core overwrite ----------------------------------------------------- */
var OVERWRITE = /(^|[^.\w])([A-Z][A-Za-z0-9_]*)\.prototype\.([A-Za-z0-9_]+)\s*=\s*function/;
var STATIC_OVERWRITE = /(^|[^.\w])(SceneManager|DataManager|StorageManager|ConfigManager|ImageManager|AudioManager|SoundManager|PluginManager|BattleManager|ColorManager|TextManager|Graphics|Input|TouchInput|Utils|JsonEx)\.([A-Za-z0-9_]+)\s*=\s*function/;

function ruleOverwrite(file, code) {
    lineNumbers(code).forEach(function (ln, idx) {
        var m = OVERWRITE.exec(ln) || STATIC_OVERWRITE.exec(ln);
        if (!m) return;
        report(file, idx + 1, 'core-overwrite',
            m[2] + '.' + (m[3] || '') + ' is assigned directly. Route it through ' +
            '$.install(label, owner, method, factory, reason) so the original is preserved, ' +
            'the alias is listed in Debug -> Hooks, and a missing target degrades with a reason.');
    });
}

/* 2. CSS floor ---------------------------------------------------------- */
var CSS_RULES = [
    { re: /(^|[;{\s])gap\s*:/, name: 'gap', needs: 'Chrome 84', fix: 'use margins: `> * + * { margin-left: Npx }`' },
    { re: /(^|[;{\s:(,])(grid-gap|grid-row-gap|grid-column-gap|row-gap|column-gap)\s*:/, name: 'grid gap', needs: 'Chrome 66/84', fix: 'use margins' },
    { re: /:\s*[^;{}]*\bclamp\s*\(/, name: 'clamp()', needs: 'Chrome 79', fix: 'use a fixed value, or calc() plus a media query' },
    { re: /:\s*[^;{}]*[^a-zA-Z.$]min\s*\([^)]*,/, name: 'CSS min()', needs: 'Chrome 79', fix: 'use a fixed value' },
    { re: /:\s*[^;{}]*[^a-zA-Z.$]max\s*\([^)]*,/, name: 'CSS max()', needs: 'Chrome 79', fix: 'use a fixed value' },
    { re: /:is\s*\(/, name: ':is()', needs: 'Chrome 88', fix: 'write the selectors out' },
    { re: /:where\s*\(/, name: ':where()', needs: 'Chrome 88', fix: 'write the selectors out' },
    { re: /:has\s*\(/, name: ':has()', needs: 'Chrome 105', fix: 'add a class from JS' },
    { re: /(^|[;{\s])aspect-ratio\s*:/, name: 'aspect-ratio', needs: 'Chrome 88', fix: 'use a padding-top percentage box' },
    { re: /(^|[;{\s])inset\s*:/, name: 'inset', needs: 'Chrome 87', fix: 'use top/right/bottom/left' },
    { re: /(^|[;{\s])(margin|padding)-(inline|block)/, name: 'logical properties', needs: 'Chrome 87', fix: 'use physical properties' },
    { re: /color-mix\s*\(/, name: 'color-mix()', needs: 'Chrome 111', fix: 'precompute the colour' },
    { re: /@container/, name: 'container queries', needs: 'Chrome 105', fix: 'use a media query or a class' },
    { re: /(^|[;{\s])text-wrap\s*:/, name: 'text-wrap', needs: 'Chrome 114', fix: 'drop it' },
    /* Two-position colour stops in a gradient are CSS Images 4. Below
       Chromium 72 the WHOLE gradient is invalid, not just the stop. */
    { re: /(linear|radial|conic|repeating-linear|repeating-radial)-gradient\([^;]*?(#[0-9a-fA-F]{3,8}|\btransparent\b|\brgba?\([^)]*\))\s+[-\d.]+[a-z%]+\s+[-\d.]+[a-z%]+/, name: 'two-position colour stop', needs: 'Chrome 72', fix: 'write one stop per edge' },
    /* hsl()/rgb() with space-separated arguments is CSS Color 4. */
    { re: /\b(hsla?|rgba?)\(\s*[^,);]+\s+[^,);]+\s+[^,);]+\s*[)/]/, name: 'space-separated colour arguments', needs: 'Chrome 65', fix: 'use the comma form' }
];

/* A string is stylesheet text if it declares or closes a rule. */
function looksLikeCss(s) {
    if (s.length < 4) return false;
    if (/[{;]\s*[-a-zA-Z]+\s*:/.test(s)) return true;
    if (/^\s*[.#@:a-zA-Z][^{}]*\{/.test(s)) return true;
    if (/^\s*[-a-zA-Z]+\s*:\s*[^;{}]+;?\s*$/.test(s) && /[-:]/.test(s)) return true;
    return false;
}

function ruleCss(file, strings) {
    strings.forEach(function (s) {
        if (!looksLikeCss(s.text)) return;
        /* Strip CSS comments first. The stylesheet documents which post-floor
           features it deliberately avoids, and matching that prose would make
           the lint fire on its own explanation of why it does not fire. */
        var css = s.text.replace(/\/\*[\s\S]*?\*\//g, ' ');
        CSS_RULES.forEach(function (r) {
            if (r.re.test(css)) {
                report(file, s.line, 'css-floor',
                    r.name + ' needs ' + r.needs + '; the MV floor is Chromium 66 (NW.js 0.29). ' +
                    'An unknown declaration is dropped silently, so the layout collapses rather than erroring. ' + r.fix + '.');
            }
        });
    });
}

/* 3. JS floor -----------------------------------------------------------
   The hard floor is Chromium 66 (MV 1.6.x on NW.js 0.29). Everything through
   ES2017 exists there, so this rule deliberately does NOT flag `let`, arrow
   functions, template literals, `padStart` or `includes` — they work. The
   codebase is written ES5 by convention, for consistency and because MV 1.5
   and older (Chromium 41) will then mostly work too, but convention is not
   worth failing a build over. What IS worth failing over is syntax that does
   not parse on the floor, because a plugin with a syntax error is pushed onto
   PluginManager._errorUrls and nothing ever reads that list: no error, no
   crash, the module simply is not there.
   -------------------------------------------------------------------- */
var JS_FLOOR = [
    { re: /\?\?/, name: 'nullish coalescing `??`', needs: 'Chrome 80' },
    { re: /\?\.[A-Za-z_$[(]/, name: 'optional chaining `?.`', needs: 'Chrome 80' },
    { re: /\bObject\.fromEntries\b/, name: 'Object.fromEntries', needs: 'Chrome 73' },
    { re: /\.flat\(|\.flatMap\(/, name: 'Array.flat / flatMap', needs: 'Chrome 69' },
    { re: /\.matchAll\(/, name: 'String.matchAll', needs: 'Chrome 73' },
    { re: /\bglobalThis\b/, name: 'globalThis', needs: 'Chrome 71' },
    { re: /\.replaceAll\(/, name: 'String.replaceAll', needs: 'Chrome 85' },
    { re: /\bstructuredClone\(/, name: 'structuredClone', needs: 'Chrome 98' },
    { re: /\bPromise\.allSettled\b/, name: 'Promise.allSettled', needs: 'Chrome 76' },
    { re: /\bBigInt\b|[0-9]n\b/, name: 'BigInt', needs: 'Chrome 67' },
    { re: /[0-9]_[0-9]/, name: 'numeric separators', needs: 'Chrome 75' },
    { re: /\.at\(\s*-/, name: 'Array.at with a negative index', needs: 'Chrome 92' },
    { re: /\?\?=|\|\|=|&&=/, name: 'logical assignment', needs: 'Chrome 85' }
];

function ruleJs(file, code) {
    lineNumbers(code).forEach(function (ln, idx) {
        JS_FLOOR.forEach(function (r) {
            if (r.re.test(ln)) {
                report(file, idx + 1, 'js-floor', r.name + ' needs ' + r.needs +
                    '; the floor is Chromium 66 (MV 1.6 on NW.js 0.29). A plugin that fails to parse is ' +
                    'pushed onto PluginManager._errorUrls, which nothing reads — the module is simply absent, ' +
                    'with no error and no crash.');
            }
        });
    });
}

/* 4. Game coupling ------------------------------------------------------ */
var COUPLED_NAMES = /\b(star\s*knightess|aura\s*mz|auramz|ska_[a-z]+|SteamLink|greenworks-win(32|64))\b/i;
var FRAMEWORK_NAMES = /\b(YEP_[A-Za-z]+|VisuMZ_[A-Za-z0-9_]+|MOG_[A-Za-z]+|SRD_[A-Za-z]+|Olivia_[A-Za-z]+|HIME_[A-Za-z]+|TDDP_[A-Za-z]+|Galv[A-Za-z_]*)\b/;

function ruleCoupling(file, strings, code) {
    strings.forEach(function (s) {
        var m = COUPLED_NAMES.exec(s.text);
        if (m) {
            report(file, s.line, 'coupling',
                'the string names a specific game or its mod loader ("' + m[0] + '"). ' +
                'Read the name from $dataSystem.gameTitle via $.profile.active().name, ' +
                'or move the knowledge into a profile.');
        }
        if (NAMING_ALLOWED.indexOf(file) < 0) {
            var f = FRAMEWORK_NAMES.exec(s.text);
            if (f) {
                report(file, s.line, 'coupling',
                    'the string names a third-party plugin ("' + f[0] + '"). ' +
                    'Recognising plugin suites belongs in the quirks table in GigaHack_Compat.js, ' +
                    'which owns the user-facing text for them.');
            }
        }
    });
    /* An id table: four or more bare integers >= 100 in one array literal.
       Round numbers are excluded — [100, 1000, 10000] is a set of step sizes
       for a row of "+N" buttons, not a list of content ids, and flagging it
       teaches the reader to ignore this rule. A real id table read off one
       game's data files is arbitrary, so requiring at least one value that is
       not a multiple of ten separates the two reliably. */
    lineNumbers(code).forEach(function (ln, idx) {
        var m = /\[\s*(\d{3,}\s*,\s*){3,}\d{3,}\s*\]/.exec(ln);
        if (m) {
            var nums = m[0].replace(/[[\]\s]/g, '').split(',').map(Number);
            var arbitrary = nums.some(function (n) { return n % 10 !== 0; });
            if (!arbitrary) return;
            report(file, idx + 1, 'coupling',
                'a literal list of content ids. It must be computed from the loaded database ' +
                'or supplied by a profile — a table read off one game is wrong on every other.');
        }
    });
}

/* -------------------------------------------------------------------------
   Run
   ---------------------------------------------------------------------- */
function lintDir(dir, label) {
    if (!fs.existsSync(dir)) return 0;
    var files = fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).sort();
    files.forEach(function (f) {
        var src = fs.readFileSync(path.join(dir, f), 'utf8');
        var t = tokenise(src);
        ruleOverwrite(f, t.code);
        ruleCss(f, t.strings);
        ruleJs(f, t.code);
        /* Profiles are the ONE place game knowledge is allowed to live. */
        if (label !== 'profiles') ruleCoupling(f, t.strings, t.code);
    });
    return files.length;
}

var count = lintDir(PLUGINS, 'plugins') + lintDir(PROFILES, 'profiles');

if (!violations.length) {
    console.log('lint: ' + count + ' files clean');
    process.exit(0);
}

var byRule = {};
violations.forEach(function (v) { byRule[v.rule] = (byRule[v.rule] || 0) + 1; });

violations.forEach(function (v) {
    console.log('  ' + v.rule.toUpperCase() + '  ' + v.file + ':' + v.line);
    console.log('        ' + v.detail);
});
console.log('\nlint: ' + violations.length + ' violation(s) across ' + count + ' files — ' +
    Object.keys(byRule).map(function (k) { return k + ': ' + byRule[k]; }).join(', '));
process.exit(1);
