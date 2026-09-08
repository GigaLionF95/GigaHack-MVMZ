//=============================================================================
// GigaHack MV/MZ
// 33 · build.js — what this build costs to run, and how its plugins are configured
//-----------------------------------------------------------------------------
// Two questions about the build itself rather than about the game inside it:
// "what is one frame spending its time on" and "what were these plugins handed
// at load". Both are diagnostic, both are easy to answer wrongly, and the wrong
// answer in each case looks exactly like the right one.
//
// THE INVARIANTS THIS FILE IS BUILT AROUND.
//
//   1. THE FRAME LOOP IS NOT THIS MODULE'S TO REDIRECT. The headline cost is
//      measured by wrapping the mod's own per-frame entry point — one clock
//      read either side, the original called exactly once, no early return on
//      any path. Nothing here goes near the engine's own main loop: on one
//      build that function perpetuates its own animation-frame chain from
//      inside itself, so returning early terminates the loop for good and
//      calling the original twice doubles the chain every frame. The mod
//      already has one safe gate for that and this module measures at it.
//
//   2. A CLOCK READING IS QUANTISED, SO ONE FRAME'S NUMBER IS A LIE. The
//      browser clamps its high-resolution timer — 100µs on the floor this
//      overlay is written to, coarser under some isolation settings — and a
//      single per-frame hook costs less than one step. So every figure here is
//      a TOTAL accumulated over a counted number of frames, plus a mean. A
//      per-frame reading for one hook would be 0 or one whole step, and both
//      are wrong.
//
//   3. THREE COUNTERS, THREE QUESTIONS, NEVER AVERAGED. The renderer's own
//      frame-rate meter, the mod's logical-step counter, and the engine's
//      frame count are three different numbers: the step loop can run its
//      logical steps several times inside one rendered frame or not at all,
//      the mod's counter deliberately keeps ticking while the mod holds the
//      game, and the engine's count is advanced from a different place on each
//      build. All three are shown, all three are labelled, and none of them is
//      called "the frame rate" on its own.
//
//   4. A TEXTURE BYTE FIGURE IS AN ESTIMATE AND SAYS SO. Neither engine tracks
//      how much texture memory it holds. Width times height times four over
//      the bitmaps this build lets us see is the best available answer, and
//      presenting it as a measurement would be the more useful-looking lie.
//      A cache this build does not have is listed BY NAME as absent, because a
//      probe silently dropped from the list reads as "nothing cached" on every
//      game and the panel then looks like it works.
//
//   5. THE SCENE GRAPH IS WALKED ON DEMAND, DOWNWARD, AND CAPPED. Walking it
//      every frame would be the exact cost this panel exists to report; a walk
//      that followed `parent` or carried no cap is an infinite loop inside a
//      panel repaint, which is indistinguishable from the game hanging. Both
//      caps are settings, and when one is hit the number is reported as a
//      floor rather than as a total. The graph's SHAPE differs between builds
//      — a deep window tree with a client area on one, a flat one on the other
//      — so nothing here compares a node count against a constant.
//
//   6. EDITING A PLUGIN PARAMETER IS MOSTLY NOT A LIVE EDIT, AND THE PANEL
//      SAYS SO BEFORE IT SHOWS A SINGLE ROW. Most plugins read their
//      parameters once, at load, into their own variables; an edit changes the
//      table the engine keeps, and a plugin that already copied a value out of
//      it never looks again and cannot be reached. The one piece of evidence
//      that exists anywhere is a read counted through the engine's own
//      parameter reader — and because this module loads after every
//      third-party plugin has done its load-time read, ANY read counted here
//      happened after load. That single fact is what lets a row honestly claim
//      an edit takes effect, and it is why a zero reads as "not seen" and
//      never as "reads once".
//
//   7. EVERY PARAMETER VALUE IS A STRING. The editor writes numbers, booleans,
//      lists and whole structures as quoted text, and consumers do their own
//      Number(), === 'true' or JSON.parse over it. A commit here is
//      String(value) verbatim: a Number written where JSON text was breaks the
//      consumer with no error anywhere.
//
//   8. THE WRITE GOES INTO THE ENGINE'S OWN TABLE, IN PLACE. Asking the
//      engine's reader for an unknown name returns a FRESH empty object on
//      both builds, so writing into what it returns is a silent no-op into a
//      throwaway. And replacing the whole object instead of mutating it would
//      break every plugin that captured the object reference at load — which
//      is precisely the case mutating in place preserves. Both the engine
//      table and the game's own plugin list are written, because they diverge
//      the moment one is written without the other; the engine table is the
//      one verified, because that is the one a plugin reads.
//
//   9. THE REGISTRATION KEY IS ASKED FOR, NEVER DERIVED FROM A VERSION. One
//      build registers an entry under its base filename and the other under
//      the whole entry, both lower-cased, so an entry in a subfolder has two
//      possible keys and a panel that guesses reports a configured plugin as
//      unconfigured on exactly one build. The key is resolved by probing the
//      engine's own parameter table for the full name and then for the
//      '/'-basename. Splitting on a backslash as well would compute a key the
//      engine never used, because the engine's own splitter does not.
//
//  10. A SECOND CLAIM ON ONE NAME IS DROPPED WITH NO ERROR AT ALL. Two entries
//      with the same name share one parameter object; the engine keeps the
//      first and never mentions the second. Both rows are shown, and both say
//      which one the engine kept.
//
//  11. THE PER-FRAME REGISTRY IS SHARED, AND IS HANDED BACK INTACT. Timing a
//      hook means replacing the function inside an entry of the ONE list the
//      frame loop actually calls — a list every other module has registered
//      into. So every wrapper this module puts on comes off again the moment
//      timing goes off: a wrapper left behind is not a slow panel, it is a
//      wrapper that follows the player for the rest of the session. Removing
//      a hook keeps working while it is wrapped because the registry keeps
//      the function its owner handed over beside the one that runs and takes
//      either one back — which is why nothing here has to alias the remover.
//
// WHAT THIS MODULE CANNOT DO ON EVERY BUILD, AND SAYS SO RATHER THAN HIDING:
// per-hook cost needs the frame loop to publish its hook list. The mod's own
// hooks module publishes it, so the feature works where that module loaded; a
// build whose frame loop publishes nothing is still a build this must survive,
// and there the toggle disables itself with that reason, the table shows it,
// and the frame TOTAL is still measured because it is taken at the entry point
// rather than inside it. "Is there a list to time" and "is timing switched on"
// are asked and answered as two separate questions everywhere, because one
// answer for both would offer to switch on what the build cannot do, or blame
// the build for a toggle the user simply left off — wrong in both directions.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — what this build costs to run, and how its plugins are configured
 * @author gigahack
 * @help GigaHack_Build.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs. Uses Compat to verify a parameter write where it is present.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — build not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;
    var B = $.build = {};

    /* =====================================================================
       0 — LOCAL HELPERS

       soft() is $.safe without the log line. This module reads globals that
       legitimately do not exist yet while the tab is being built during boot,
       and a red line per repaint for an expected miss is noise that hides the
       misses that matter.
       ===================================================================== */
    function soft(fn, fallback) {
        try {
            var v = fn();
            return (v === undefined || v === null) ? fallback : v;
        } catch (e) { return fallback; }
    }

    var clock = (typeof performance !== 'undefined' && performance &&
        typeof performance.now === 'function')
        ? function () { return performance.now(); }
        : function () { return Date.now(); };

    function fixed(v, d) {
        if (typeof v !== 'number' || v !== v) return '—';
        return v.toFixed(d);
    }

    function pct(v) { return fixed(v * 100, 1) + '%'; }

    /* =====================================================================
       0b — SETTINGS

       Every key this module reads, with the value it falls back to when the
       key is absent. Nothing here writes into the settings defaults table,
       which another module owns, so each read supplies its own default and
       validates the stored value rather than trusting it: a settings file
       written by hand, or by an older build, is exactly where a string turns
       up under a number.
       ===================================================================== */
    var SERIES = ['frame rate', 'logical steps', 'heap'];
    var FILTERS = ['all', 'edited', 'seen re-reading', 'not registered', 'off in the plugin list'];
    var INTERVALS = ['0.5 s', '1 s', '2 s', '5 s'];
    var INTERVAL_MS = { '0.5 s': 500, '1 s': 1000, '2 s': 2000, '5 s': 5000 };

    function cfgGet(path, dflt) {
        if (!$.store || !$.store.cfgGet) return dflt;
        var v = $.store.cfgGet(path, undefined);
        return v === undefined ? dflt : v;
    }
    function cfgSet(path, v) {
        if ($.store && $.store.cfgSet) $.store.cfgSet(path, v);
        return v;
    }
    function optNum(path, dflt, lo, hi) {
        var v = cfgGet(path, dflt);
        if (typeof v !== 'number' || v !== v) return dflt;
        return v < lo ? lo : v > hi ? hi : v;
    }
    function optBool(path, dflt) {
        var v = cfgGet(path, dflt);
        return typeof v === 'boolean' ? v : !!dflt;
    }
    function optStr(path, dflt, allowed) {
        var v = cfgGet(path, dflt);
        if (typeof v !== 'string') return dflt;
        if (allowed && allowed.indexOf(v) < 0) return dflt;
        return v;
    }

    function sampleMs() { return optNum('build.perf.sampleMs', 500, 250, 5000); }
    function historyLen() { return optNum('build.perf.historyLen', 240, 20, 2000); }
    function timingWanted() { return optBool('build.perf.timeHooks', false); }
    function series() { return optStr('build.perf.series', 'frame rate', SERIES); }
    function budgetMs() { return optNum('build.perf.budgetMs', 4, 0.1, 16.7); }
    function nodeCap() { return optNum('build.perf.sceneNodeCap', 20000, 100, 500000); }
    function depthCap() { return optNum('build.perf.sceneDepthCap', 64, 4, 512); }
    function paramQuery() { return optStr('build.params.q', ''); }
    function paramFilter() { return optStr('build.params.filter', 'all', FILTERS); }
    function showEmpty() { return optBool('build.params.showEmpty', false); }

    /* =====================================================================
       0c — COMPAT SHIMS

       Compat loads before this module by manifest, but a partial install is
       exactly the moment a mod menu must not throw. Each shim has the surface
       of the real service and degrades to the honest answer.
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
     * made inert: the cause may have gone away, and the only way to find out
     * is to let the user try again.
     */
    function degradeMark(el, control) {
        if (!el || !degraded(control)) return el;
        el.style.opacity = '0.55';
        el.setAttribute('data-mm-tip', 'Not sticking|' + degradedWhy(control));
        return el;
    }
    function degradeNote(control) {
        if (!degraded(control)) return null;
        return h('div', { class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px' },
            h('b', { text: 'writes here are not sticking. ' }),
            degradedWhy(control) + ' ',
            W.button({
                label: 'try again', mini: true, _ungated: true,
                tip: 'Try again|Clears the mark; the next write is re-tested.',
                onClick: function () {
                    if ($.compat && $.compat.clearDegraded) $.compat.clearDegraded('plugin.param');
                    U.rerender();
                }
            }));
    }

    /* =====================================================================
       PART 1 — THE COST MODEL

       $.build.perf owns every figure. The panel is a renderer over it and the
       console can ask the same questions in one line.
       ===================================================================== */
    var P = B.perf = {};

    var HOOK_FRAME = 'GigaHack.frame (frame cost)';
    var HOOK_PARAMS = 'PluginManager.parameters (read counter)';
    var HOOK_SETPARAMS = 'PluginManager.setParameters (re-registration)';
    var HOOK_IMGCLEAR = 'ImageManager.clear (cache flushes)';

    var NO_FPS = 'this build exposes no frame-rate counter; a plugin that replaces the renderer ' +
        'takes it away and there is nothing to read instead.';
    var NO_HEAP = 'the measurement is an extension to the timing API that some builds and ' +
        'deployments do not carry. Nothing in the game can measure the heap without it, and no ' +
        'setting turns it on.';
    var NO_HOOK_LIST = 'this build\'s hook module does not publish its per-frame list, so nothing ' +
        'here can name what inside a frame is costing the time. The frame total below is still ' +
        'measured, because it is taken at the entry point rather than inside it.';
    var NO_REMOVER = 'this build\'s frame loop has no remover, so nothing here can take a hook ' +
        'out of it.';
    var NO_LOG_VOLUME = 'this build\'s log ring does not report its own size, so nothing here can ' +
        'say whether the beginning of the session has already rolled off it.';

    /* ---- the frame total ------------------------------------------------
       Two clock reads per frame, unconditionally, and that is the price of
       the number. It must not grow: per-hook timing costs two more reads per
       hook per frame and stays behind its own toggle.
       ------------------------------------------------------------------ */
    var frameCost = { frames: 0, totalMs: 0, maxMs: 0 };

    $.install(HOOK_FRAME, $, 'frame', function (original) {
        return function () {
            var t0 = clock();
            var r = original.apply(this, arguments);
            var dt = clock() - t0;
            frameCost.frames++;
            frameCost.totalMs += dt;
            if (dt > frameCost.maxMs) frameCost.maxMs = dt;
            return r;
        };
    }, 'the per-frame entry point is absent — the hooks module did not load, so nothing is ' +
       'driving per-frame work and there is no frame cost to measure');

    P.frameCost = function () {
        var installed = !!($.hooks[HOOK_FRAME] && $.hooks[HOOK_FRAME].installed);
        return {
            available: installed,
            why: installed ? '' : ($.hooks[HOOK_FRAME] ? $.hooks[HOOK_FRAME].reason : 'the frame hook was never attempted'),
            frames: frameCost.frames,
            totalMs: frameCost.totalMs,
            meanMs: frameCost.frames ? frameCost.totalMs / frameCost.frames : 0,
            maxMs: frameCost.maxMs
        };
    };
    P.resetFrameCost = function () { frameCost.frames = 0; frameCost.totalMs = 0; frameCost.maxMs = 0; };

    /* ---- the three counters --------------------------------------------- */
    P.fps = function () {
        var v = soft(function () { return ($.eng && $.eng.fps) ? $.eng.fps() : null; }, null);
        if (typeof v === 'number' && v === v) return { value: v, available: true, why: '' };
        return { value: null, available: false, why: NO_FPS };
    };

    function engineFrames() {
        return soft(function () {
            return (typeof Graphics !== 'undefined' && Graphics && typeof Graphics.frameCount === 'number')
                ? Graphics.frameCount : null;
        }, null);
    }

    /* ---- heap ------------------------------------------------------------
       Bucketed by the browser where it exists at all, so the low digits are
       not printed, and a rising figure is never called a leak: the collector
       runs when it chooses.
       ------------------------------------------------------------------ */
    var heapBase = null;

    function heapRaw() {
        return soft(function () {
            var m = (typeof performance !== 'undefined' && performance) ? performance.memory : null;
            if (!m || typeof m.usedJSHeapSize !== 'number') return null;
            return m;
        }, null);
    }

    P.memory = function () {
        var m = heapRaw();
        if (!m) {
            return {
                available: false, why: NO_HEAP,
                usedMB: null, totalMB: null, limitMB: null, growthMB: null, baseline: null
            };
        }
        var MB = 1024 * 1024;
        var used = m.usedJSHeapSize / MB;
        if (heapBase === null) heapBase = used;
        return {
            available: true, why: '',
            usedMB: used,
            totalMB: (typeof m.totalJSHeapSize === 'number') ? m.totalJSHeapSize / MB : null,
            limitMB: (typeof m.jsHeapSizeLimit === 'number') ? m.jsHeapSizeLimit / MB : null,
            growthMB: used - heapBase,
            baseline: heapBase
        };
    };
    P.resetHeapBaseline = function () {
        var m = heapRaw();
        if (!m) return { ok: false, why: NO_HEAP };
        heapBase = m.usedJSHeapSize / (1024 * 1024);
        return { ok: true, why: '' };
    };

    /* ---- the sample ring -------------------------------------------------
       Sampled on a WALL CLOCK from inside a per-frame hook, so a build running
       its logical steps at several times real speed still plots one point per
       interval, and a build that stopped stepping leaves a gap rather than a
       flat line.
       ------------------------------------------------------------------ */
    var samples = [];
    var lastAt = 0;          // clock() at the last sample
    var lastSteps = 0;       // $.frameCount at the last sample
    var lastEngine = 0;      // Graphics.frameCount at the last sample

    function takeSample(force) {
        var t = clock();
        if (!force && lastAt && (t - lastAt) < sampleMs()) return null;
        var secs = lastAt ? (t - lastAt) / 1000 : 0;
        var steps = (typeof $.frameCount === 'number') ? $.frameCount : 0;
        var eng = engineFrames();
        var mem = P.memory();
        var row = {
            t: Date.now(),
            fps: P.fps().value,
            steps: (secs > 0) ? (steps - lastSteps) / secs : null,
            frames: (secs > 0 && eng !== null) ? (eng - lastEngine) / secs : null,
            heap: mem.available ? mem.usedMB : null,
            gapMs: lastAt ? (t - lastAt) : 0
        };
        lastAt = t; lastSteps = steps; if (eng !== null) lastEngine = eng;
        samples.push(row);
        while (samples.length > historyLen()) samples.shift();
        return row;
    }

    /* Registered through the frame loop's own list rather than driven from
       the frame wrapper: the sampler costs something, and a cost this panel
       hides from its own table is the one cost it must not hide. */
    var samplerFn = $.onFrame('build: sampler', function () {
        takeSample(false);
    });

    P.samplerName = function () { return 'build: sampler'; };
    P.samples = function () { return samples.slice(); };
    P.resetSamples = function () { samples.length = 0; lastAt = 0; };
    P.sample = function () { return takeSample(true); };

    P.span = function () {
        if (!samples.length) return { count: 0, seconds: 0 };
        return {
            count: samples.length,
            seconds: (samples[samples.length - 1].t - samples[0].t) / 1000
        };
    };

    P.seriesValues = function (which) {
        var key = which === 'logical steps' ? 'steps' : which === 'heap' ? 'heap' : 'fps';
        var out = [];
        for (var i = 0; i < samples.length; i++) {
            var v = samples[i][key];
            out.push((typeof v === 'number' && v === v) ? v : null);
        }
        return out;
    };

    P.stats = function (which) {
        var v = P.seriesValues(which).filter(function (x) { return x !== null; }).sort(function (a, b) { return a - b; });
        if (!v.length) return { min: null, median: null, max: null, n: 0 };
        return { min: v[0], median: v[(v.length - 1) >> 1], max: v[v.length - 1], n: v.length };
    };

    /* ---- per-hook cost ---------------------------------------------------
       Needs the frame loop to publish its own list BY REFERENCE: a hook is
       timed by replacing its own function in place, and a copy of the list
       would time entries nothing calls. The mod's hooks module publishes
       exactly that, with each entry carrying the function its owner handed
       over beside the one that runs. Where the accessor is absent the whole
       feature disables itself with that reason rather than showing an empty
       table, which would read as "nothing inside a frame costs anything".
       ------------------------------------------------------------------ */
    var timing = { on: false, recs: [] };

    function frameHookList() {
        if (typeof $.frameHooks !== 'function') return null;
        var l = soft(function () { return $.frameHooks(); }, null);
        return (l && typeof l.length === 'number') ? l : null;
    }

    P.hooksAvailable = function () {
        var l = frameHookList();
        if (!l) return { ok: false, why: NO_HOOK_LIST, count: 0 };
        return { ok: true, why: '', count: l.length };
    };

    P.hookNames = function () {
        var l = frameHookList();
        if (!l) return null;
        var out = [];
        for (var i = 0; i < l.length; i++) out.push(String(l[i] && l[i].name));
        return out;
    };

    function recFor(entry) {
        for (var i = 0; i < timing.recs.length; i++) if (timing.recs[i].entry === entry) return timing.recs[i];
        return null;
    }

    /**
     * Wrap every entry in the live list that is not wrapped yet.
     *
     * Called on every paint as well as when timing is switched on: the frame
     * loop removes a hook that throws by splicing its own array, and modules
     * register hooks at any time, so an index held across frames is wrong by
     * the next one. The ENTRY OBJECT is held instead, and the list is re-read.
     */
    function syncTiming() {
        var l = frameHookList();
        if (!l) return;
        var i;
        for (i = 0; i < l.length; i++) {
            var entry = l[i];
            if (!entry || typeof entry.fn !== 'function') continue;
            if (recFor(entry)) continue;
            var rec = {
                entry: entry, name: String(entry.name), orig: entry.fn,
                calls: 0, totalMs: 0, wrapper: null
            };
            rec.wrapper = (function (r) {
                return function (n) {
                    var t0 = clock();
                    var out = r.orig(n);
                    r.totalMs += clock() - t0;
                    r.calls++;
                    return out;
                };
            }(rec));
            entry.fn = rec.wrapper;
            timing.recs.push(rec);
        }
        /* Drop records for entries the frame loop has removed. Their own
           function was already put back by nobody — the entry is gone, so
           there is nothing left wrapped. */
        for (i = timing.recs.length - 1; i >= 0; i--) {
            var found = false;
            for (var j = 0; j < l.length; j++) if (l[j] === timing.recs[i].entry) { found = true; break; }
            if (!found) timing.recs.splice(i, 1);
        }
    }

    /**
     * Put every entry's own function back.
     *
     * The list is shared with every other module and outlives this panel, so
     * this runs off the RECORDS rather than off the list: an entry the frame
     * loop has already spliced out is gone from the list and still holds our
     * wrapper, and one the list no longer publishes at all — the accessor
     * taken away underneath us — would leave every wrapper on for the session.
     */
    function unwrapAll() {
        var l = frameHookList() || [];
        for (var i = 0; i < timing.recs.length; i++) {
            var rec = timing.recs[i];
            /* Only put back what is still ours. Something that patched on top
               of the wrapper owns that slot now, and restoring over it would
               throw its work away silently. */
            if (rec.entry && rec.entry.fn === rec.wrapper) rec.entry.fn = rec.orig;
        }
        timing.recs = [];
        return l.length;
    }

    P.timing = function () { return timing.on; };

    P.setTiming = function (on) {
        on = !!on;
        var av = P.hooksAvailable();
        if (on && !av.ok) return { ok: false, why: av.why };
        if (on === timing.on) return { ok: true, why: '' };
        if (on) {
            timing.recs = [];
            timing.on = true;
            syncTiming();
        } else {
            timing.on = false;
            unwrapAll();
        }
        if (timingWanted() !== on) cfgSet('build.perf.timeHooks', on);
        return { ok: true, why: '' };
    };

    /**
     * The per-hook figures, and the TWO separate reasons there might be none.
     *
     * `listed` is a fact about the build: does its frame loop publish the list
     * this feature times at all. `timing` is a fact about the user: is the
     * toggle on. One flag standing for both is what makes a panel say "turn it
     * on above" on a build where the toggle can do nothing, and "this build
     * publishes no list" where the list is right there and timing is merely
     * off. `available` stays what it always meant — there are figures — and is
     * simply both of the other two.
     */
    P.hookCosts = function () {
        var av = P.hooksAvailable();
        if (!av.ok) {
            return {
                available: false, listed: false, timing: timing.on,
                why: av.why, rows: [], count: 0, totalMs: 0
            };
        }
        if (!timing.on) {
            return {
                available: false, listed: true, timing: false,
                why: 'per-hook timing is off — turn it on above. The list holds ' + av.count +
                     ' hook' + (av.count === 1 ? '' : 's') + ' either way.',
                rows: [], count: av.count, totalMs: 0
            };
        }
        syncTiming();
        var total = 0, i;
        for (i = 0; i < timing.recs.length; i++) total += timing.recs[i].totalMs;
        var rows = [];
        for (i = 0; i < timing.recs.length; i++) {
            var r = timing.recs[i];
            rows.push({
                name: r.name,
                calls: r.calls,
                totalMs: r.totalMs,
                meanUs: r.calls ? (r.totalMs * 1000) / r.calls : 0,
                share: total > 0 ? r.totalMs / total : 0,
                wrapped: r.entry.fn === r.wrapper
            });
        }
        rows.sort(function (a, b) { return b.totalMs - a.totalMs; });
        return {
            available: true, listed: true, timing: true, why: '',
            rows: rows, count: rows.length, totalMs: total
        };
    };

    P.resetHookCosts = function () {
        for (var i = 0; i < timing.recs.length; i++) { timing.recs[i].calls = 0; timing.recs[i].totalMs = 0; }
    };

    /* THE IDENTITY TRAP, AND WHY NOTHING HERE ALIASES THE REMOVER.
       A hook this module has wrapped is no longer in the list under the
       function its owner is holding. A registry that matched only the running
       function would therefore let a module ask for its own hook back, be
       told nothing, and keep paying for it for the rest of the session — and
       this module would have to alias the remover to translate. The registry
       does not work that way: it keeps the function the caller handed over
       beside the one that runs and removes on either, so the owner's own
       value comes back out whether or not timing was ever switched on, and
       there is nothing here to leave behind on the remover.

       Where the frame loop has no remover at all, nothing can take a hook out
       of it from here and NO_REMOVER says exactly that at the button. */

    /* ---- the log ring ----------------------------------------------------
       A shared, fixed-size resource, and the one the report below is pasted
       out of. A ring that has rolled over has dropped the START of the
       session — which is where a boot failure is written down — so what fell
       off is reported beside what is held. A build whose ring cannot say is
       not reported as a ring that dropped nothing.
       ------------------------------------------------------------------ */
    P.logVolume = function () {
        var held = soft(function () { return $.logHistory().length; }, 0);
        var cap = soft(function () {
            return (typeof $.logCapacity === 'function') ? $.logCapacity() : null;
        }, null);
        var dropped = soft(function () {
            return (typeof $.logDropped === 'function') ? $.logDropped() : null;
        }, null);
        var ok = (typeof cap === 'number' && cap === cap && typeof dropped === 'number' && dropped === dropped);
        return {
            available: ok, why: ok ? '' : NO_LOG_VOLUME,
            held: held,
            capacity: ok ? cap : null,
            dropped: ok ? dropped : null,
            rolled: ok ? dropped > 0 : false
        };
    };

    /* ---- scene graph ----------------------------------------------------- */
    function className(o) {
        return soft(function () {
            var c = o.constructor;
            return (c && c.name) ? String(c.name) : '';
        }, '') || 'unnamed';
    }

    /* Duck-typed against whatever classes this build actually has. A build
       that lost one of them simply has no nodes in that bucket; nothing here
       asks which engine it is. */
    function roleOf(node) {
        return soft(function () {
            if (typeof Window !== 'undefined' && Window && Window.prototype && node instanceof Window) return 'windows';
            if (typeof Sprite !== 'undefined' && Sprite && Sprite.prototype && node instanceof Sprite) return 'sprites';
            if (typeof PIXI !== 'undefined' && PIXI && PIXI.Container && node instanceof PIXI.Container) return 'containers';
            return 'other';
        }, 'other');
    }

    /* Counted so the "on demand, never per frame" claim is checkable rather
       than only stated. */
    var sceneWalks = 0;
    P.sceneWalks = function () { return sceneWalks; };

    P.sceneGraph = function () {
        sceneWalks++;
        var caps = { nodes: nodeCap(), depth: depthCap() };
        var out = {
            available: false, why: '', scene: '',
            nodes: 0, depth: 0, windows: 0, sprites: 0, containers: 0, other: 0,
            byClass: {}, capped: false, cappedWhy: '', caps: caps
        };
        var root = soft(function () {
            return (typeof SceneManager !== 'undefined' && SceneManager) ? SceneManager._scene : null;
        }, null);
        if (!root) {
            out.why = 'no scene is running yet — the graph is walked from the scene the engine ' +
                'currently has, and there is none until the game reaches one.';
            return out;
        }
        out.available = true;
        out.scene = className(root);

        /* Children only, never `parent`, with a node cap and a depth cap. A
           display list is a tree in theory and a plugin can make it not one;
           an uncapped walk inside a panel repaint looks exactly like the game
           hanging. */
        var stack = [{ n: root, d: 0 }];
        while (stack.length) {
            var it = stack.pop(), node = it.n, d = it.d;
            out.nodes++;
            if (d > out.depth) out.depth = d;
            var cn = className(node);
            out.byClass[cn] = (out.byClass[cn] || 0) + 1;
            out[roleOf(node)]++;
            if (out.nodes >= caps.nodes) { out.capped = true; break; }
            if (d >= caps.depth) { out.capped = true; continue; }
            var kids = soft(function () { return node.children; }, null);
            if (!kids || typeof kids.length !== 'number') continue;
            for (var i = 0; i < kids.length; i++) if (kids[i]) stack.push({ n: kids[i], d: d + 1 });
        }
        if (out.capped) {
            out.cappedWhy = 'stopped at ' + out.nodes + ' nodes / depth ' + out.depth +
                ' — this is a floor, not a total.';
        }
        return out;
    };

    /* ---- texture and image caches ----------------------------------------
       Every probe is listed on every build. One dropped for being absent
       reads as an empty cache on every game, which is the shape of a panel
       that looks like it works and does not.
       ------------------------------------------------------------------ */
    function imageManager() {
        return soft(function () { return (typeof ImageManager !== 'undefined') ? ImageManager : null; }, null);
    }

    var CACHE_PROBES = [
        {
            name: 'renderer textures',
            get: function () {
                return soft(function () {
                    return (typeof PIXI !== 'undefined' && PIXI && PIXI.utils) ? PIXI.utils.TextureCache : null;
                }, null);
            }
        },
        {
            name: 'renderer base textures',
            get: function () {
                return soft(function () {
                    return (typeof PIXI !== 'undefined' && PIXI && PIXI.utils) ? PIXI.utils.BaseTextureCache : null;
                }, null);
            }
        },
        {
            name: 'images by count',
            get: function () { var m = imageManager(); return (m && m._cache) ? m._cache : null; }
        },
        {
            name: 'system images',
            get: function () { var m = imageManager(); return (m && m._system) ? m._system : null; }
        },
        {
            /* Named by what bounds it, not by which engine has it: one build
               caches images by count and the other by bytes, and the panel's
               job is to say which one is here — not to say a version. */
            name: 'images by bytes',
            get: function () {
                var m = imageManager();
                return (m && m._imageCache && m._imageCache._items) ? m._imageCache._items : null;
            }
        }
    ];

    /**
     * Pixels held by one cache entry, or null when the entry does not say.
     *
     * The entry SHAPE differs per cache: one holds the bitmap directly, one
     * wraps it in a record beside a timestamp and its own key, and a texture
     * carries its size on a base texture. Reading `.width` off the wrapped
     * shape gives undefined, which sums to NaN with no error at all — so each
     * shape is tested for rather than assumed.
     */
    function pixelsOf(v) {
        return soft(function () {
            if (!v || typeof v !== 'object') return null;
            if (typeof v.width === 'number' && typeof v.height === 'number') return v.width * v.height;
            if (v.bitmap && typeof v.bitmap.width === 'number' && typeof v.bitmap.height === 'number') {
                return v.bitmap.width * v.bitmap.height;
            }
            if (v.baseTexture && typeof v.baseTexture.width === 'number' && typeof v.baseTexture.height === 'number') {
                return v.baseTexture.width * v.baseTexture.height;
            }
            return null;
        }, null);
    }

    P.caches = function () {
        var out = [];
        for (var i = 0; i < CACHE_PROBES.length; i++) {
            var probe = CACHE_PROBES[i];
            var obj = probe.get();
            if (!obj || typeof obj !== 'object') {
                out.push({
                    name: probe.name, present: false,
                    why: 'not present on this build', entries: 0, bytes: null,
                    sized: 0, estimated: true
                });
                continue;
            }
            var entries = 0, px = 0, sized = 0;
            /* Own keys only: a cache is a plain object and something that put
               a helper on Object.prototype must not be counted as an image. */
            for (var k in obj) {
                if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
                entries++;
                var p = pixelsOf(obj[k]);
                if (p !== null && p === p) { px += p; sized++; }
            }
            out.push({
                name: probe.name, present: true, why: '',
                entries: entries, bytes: px * 4, sized: sized, estimated: true
            });
        }
        return out;
    };

    /* ---- cache flushes --------------------------------------------------- */
    var flushes = 0;

    $.install(HOOK_IMGCLEAR, (typeof ImageManager !== 'undefined') ? ImageManager : null, 'clear',
        function (original) {
            return function () {
                flushes++;
                return original.apply(this, arguments);
            };
        },
        'the image cache has no clear on this build — the cached-image count can drop between two ' +
        'looks with nothing to say why');

    P.flushes = function () {
        var installed = !!($.hooks[HOOK_IMGCLEAR] && $.hooks[HOOK_IMGCLEAR].installed);
        return {
            count: flushes, available: installed,
            why: installed ? '' : ($.hooks[HOOK_IMGCLEAR] ? $.hooks[HOOK_IMGCLEAR].reason : '')
        };
    };

    /* ---- the chart's own honesty -----------------------------------------
       A panel body is built DETACHED: clientWidth is 0 there, and a canvas
       drawn at zero width paints nothing and reports no error at all. Every
       refusal is counted, so "it draws once it is in the document" is a fact
       a check can read rather than a claim in a comment.
       ------------------------------------------------------------------ */
    var chart = { drawn: 0, refusedDetached: 0 };
    P.chartState = function () { return { drawn: chart.drawn, refusedDetached: chart.refusedDetached }; };

    /* ---- the overlay's own cost ------------------------------------------ */
    P.overlay = function () {
        var host = U.getHost();
        return {
            mounted: !!(host && host.root),
            open: !!($.ui.isOpen && $.ui.isOpen()),
            nodes: host && host.root ? soft(function () { return host.root.querySelectorAll('*').length; }, 0) : 0,
            fastHooks: host && host.fastHooks ? host.fastHooks.length : 0,
            tickHooks: host && host.tickHooks ? host.tickHooks.length : 0
        };
    };

    /* =====================================================================
       PART 2 — THE PARAMETER MODEL

       $.build.params owns the key resolution and the effectiveness rule once,
       rather than once per table cell.
       ===================================================================== */
    var PM = B.params = {};

    var NO_LIST = 'the game plugin list is not readable, so no plugin can be asked what it is ' +
        'configured to do';
    var NO_TABLE = 'the engine parameter table is not reachable on this build, so nothing here can ' +
        'be edited; these values are what the engine was handed, not what any plugin is using.';
    var NO_READS = 'nothing on this build can observe a plugin reading its parameters, so no row ' +
        'can claim an edit takes effect.';

    function pluginList() {
        return soft(function () {
            return (typeof $plugins !== 'undefined' && $plugins && Array.isArray($plugins)) ? $plugins : null;
        }, null);
    }
    function pluginManager() {
        return soft(function () { return (typeof PluginManager !== 'undefined') ? PluginManager : null; }, null);
    }
    function paramTable() {
        var m = pluginManager();
        return (m && m._parameters && typeof m._parameters === 'object') ? m._parameters : null;
    }

    /* ---- read counting ---------------------------------------------------
       The one piece of evidence that exists anywhere for "does this plugin
       re-read its parameters". This module loads after every third-party
       plugin has run its load-time read, so anything counted here happened
       AFTER load. Increments only — never a clock read, never an allocation
       past the first call for a key, never the DOM: some plugins ask on a
       per-frame path.
       ------------------------------------------------------------------ */
    var reads = {};
    /* One number over the whole table, so the panel can ask "has anything read
       its parameters since I last looked" without walking every entry. It is
       the only thing on that panel the GAME moves, and the reads column was
       painted once — a counter that ticks while the game runs, shown frozen.
       Increment-only and never reset: a total that goes backwards would make
       the panel repaint on a value it had already acted on. */
    var readTotal = 0;
    /* Set while this module reads the table back to verify its own write. A
       verify read counted as evidence would let a row claim an edit takes
       effect purely because the edit was made. */
    var internalRead = false;

    $.install(HOOK_PARAMS, pluginManager(), 'parameters', function (original) {
        return function (name) {
            if (!internalRead) {
                var k = String(name).toLowerCase();
                var c = reads[k];
                readTotal++;
                if (c) { c.calls++; c.lastFrame = $.frameCount; }
                else reads[k] = { calls: 1, lastFrame: $.frameCount };
            }
            return original.apply(this, arguments);
        };
    }, 'the engine\'s parameter reader is not a function on this build, so nothing can observe a ' +
       'plugin re-reading and no row can claim an edit takes effect');

    /** Every parameter read this module has seen, across every entry. */
    PM.readTotal = function () { return readTotal; };

    PM.reads = function (key) {
        var installed = !!($.hooks[HOOK_PARAMS] && $.hooks[HOOK_PARAMS].installed);
        var c = key ? reads[key] : null;
        return {
            calls: c ? c.calls : 0,
            lastFrame: c ? c.lastFrame : null,
            available: installed,
            why: installed ? '' : NO_READS
        };
    };
    PM.readsAvailable = function () {
        return !!($.hooks[HOOK_PARAMS] && $.hooks[HOOK_PARAMS].installed);
    };

    /* ---- wholesale re-registration ---------------------------------------
       Replacing the object under a key discards every edit made into it, with
       nothing anywhere saying so. Some loaders and some reload plugins re-run
       the whole setup; without this the panel would keep presenting a
       discarded edit as applied.
       ------------------------------------------------------------------ */
    var edits = [];

    $.install(HOOK_SETPARAMS, pluginManager(), 'setParameters', function (original) {
        return function (name) {
            var key = String(name == null ? '' : name).toLowerCase();
            for (var i = 0; i < edits.length; i++) {
                if (edits[i].key === key && !edits[i].discarded) {
                    edits[i].discarded = true;
                    edits[i].discardedFrame = $.frameCount;
                }
            }
            return original.apply(this, arguments);
        };
    }, 'the engine\'s parameter registrar is absent — an edit that is later replaced wholesale ' +
       'cannot be noticed, so the panel cannot tell you when one stops being in effect');

    /* ---- key resolution --------------------------------------------------
       Asked of the engine's own table, never derived from a version. The
       basename is split on '/' ONLY, because the engine's own splitter does:
       splitting on a backslash as well would compute a key the engine never
       used and the probe would then miss an entry that is registered.
       ------------------------------------------------------------------ */
    function basename(name) { return String(name).split('/').pop(); }

    PM.key = function (name) {
        var table = paramTable();
        if (!table) return { key: null, why: NO_TABLE };
        var full = String(name).toLowerCase();
        if (Object.prototype.hasOwnProperty.call(table, full)) return { key: full, why: '' };
        var base = basename(name).toLowerCase();
        if (base !== full && Object.prototype.hasOwnProperty.call(table, base)) return { key: base, why: '' };
        return {
            key: null,
            why: 'the engine parameter table holds no entry under this name — the entry is off, or ' +
                 'another entry claimed the same name first and the second claim was dropped with no error'
        };
    };

    function parsesAsJson(s) {
        if (typeof s !== 'string') return false;
        var t = s.replace(/^\s+|\s+$/g, '');
        if (!t) return false;
        var c = t.charAt(0);
        if (c !== '[' && c !== '{') return false;
        try { JSON.parse(t); return true; } catch (e) { return false; }
    }
    PM.isJsonText = parsesAsJson;

    /* Original values, keyed by registration key and parameter name, captured
       the first time one is written so a revert restores the exact string
       that was there rather than whatever the last edit left. */
    var originals = {};
    /* NUL, spelled as an escape rather than typed as a byte. A raw one makes the
       whole file 'data' to every text tool on the machine: grep skips it in
       silence and reports nothing rather than an error, which is how the panel
       count came out two short. The separator is still NUL because it is the
       one character a plugin name cannot contain. */
    function origKey(key, pname) { return key + '\u0000' + pname; }

    PM.entries = function () {
        return $.safe(function () {
            var list = pluginList();
            if (!list) return { available: false, why: NO_LIST, rows: [], holes: 0, total: 0 };
            var table = paramTable();
            var out = [], holes = 0, claimed = {}, i;

            for (i = 0; i < list.length; i++) {
                /* A hole in the list is a legal undefined slot in an array
                   literal, and reading a field off it throws. It is counted
                   and skipped, not assumed away. */
                var p = list[i];
                if (!p || typeof p !== 'object') { holes++; continue; }
                var name = String(p.name == null ? '' : p.name);
                var status = !!p.status;
                var res = PM.key(name);
                var dup = null;
                if (status && res.key) {
                    if (Object.prototype.hasOwnProperty.call(claimed, res.key)) dup = claimed[res.key];
                    else claimed[res.key] = i;
                }
                var own = (p.parameters && typeof p.parameters === 'object') ? p.parameters : null;
                var registered = (res.key && table && dup === null)
                    ? (table[res.key] && typeof table[res.key] === 'object' ? table[res.key] : null)
                    : null;

                var names = [], k;
                if (own) for (k in own) if (Object.prototype.hasOwnProperty.call(own, k)) names.push(k);
                if (registered) {
                    for (k in registered) {
                        if (!Object.prototype.hasOwnProperty.call(registered, k)) continue;
                        if (names.indexOf(k) < 0) names.push(k);
                    }
                }
                names.sort();

                var rd = PM.reads(res.key);
                var params = [];
                for (var j = 0; j < names.length; j++) {
                    var pn = names[j];
                    /* The value shown is the one the engine holds where the
                       engine holds one, because that is what a plugin reads.
                       Where it does not — off, or a dropped second claim —
                       the entry's own declared value is shown instead, and the
                       row says why it is not the one in force. */
                    var live = registered ? registered[pn] : (own ? own[pn] : undefined);
                    var ok = res.key ? originals[origKey(res.key, pn)] : undefined;
                    params.push({
                        name: pn,
                        value: live === undefined ? '' : String(live),
                        original: ok === undefined ? (live === undefined ? '' : String(live)) : ok,
                        edited: ok !== undefined,
                        isJson: parsesAsJson(live === undefined ? '' : String(live)),
                        reads: rd.calls,
                        live: rd.calls > 0
                    });
                }

                out.push({
                    index: i, name: name, base: basename(name), status: status,
                    description: String(p.description == null ? '' : p.description),
                    key: res.key, keyWhy: res.why,
                    registered: !!registered,
                    duplicateOf: dup,
                    params: params,
                    reads: rd.calls, lastRead: rd.lastFrame
                });
            }
            return {
                available: true, why: '', rows: out, holes: holes, total: list.length,
                tableAvailable: !!table
            };
        }, 'build entries', { available: false, why: NO_LIST, rows: [], holes: 0, total: 0 });
    };

    /** One of 'live' | 'not seen' | 'off' | 'not registered' | 'name taken'. */
    PM.effect = function (entry) {
        if (!entry.status) return 'off';
        if (entry.duplicateOf !== null && entry.duplicateOf !== undefined) return 'name taken';
        if (!entry.key || !entry.registered) return 'not registered';
        if (!PM.readsAvailable()) return 'not seen';
        return entry.reads > 0 ? 'live' : 'not seen';
    };

    PM.effectWhy = function (entry) {
        var e = PM.effect(entry);
        if (e === 'off') {
            return 'this entry is off in the game plugin list, so the engine never registered its ' +
                'parameters; an edit here would go nowhere';
        }
        if (e === 'name taken') {
            return 'entry #' + entry.duplicateOf + ' claims this name too; the engine kept the first ' +
                'and dropped this one silently, so these values belong to #' + entry.duplicateOf;
        }
        if (e === 'not registered') {
            if (entry.keyWhy) return entry.keyWhy;
            if (entry.key) {
                /* The name IS on the engine's table and the value under it is
                   nothing at all. An entry in the plugin list with no
                   parameters field registers exactly this way, and the
                   engine's own reader hands back a fresh empty object for it
                   forever — writing into that is a write into a throwaway. */
                return 'the engine holds this name with no parameter object under it — the entry in ' +
                    'the plugin list carries no parameters, so there is nothing here to edit';
            }
            return NO_TABLE;
        }
        if (e === 'live') {
            return 'this entry has been seen re-reading its parameters since this module loaded, so ' +
                'an edit takes effect on its next read';
        }
        if (!PM.readsAvailable()) return NO_READS;
        return 'not seen re-reading since this module loaded — an edit is recorded and is not ' +
            'known to be in effect. Every read before that happened before this module existed.';
    };

    PM.editable = function (entry) {
        return !!(entry.status && entry.key && entry.registered &&
            (entry.duplicateOf === null || entry.duplicateOf === undefined));
    };

    PM.rows = function (opts) {
        opts = opts || {};
        var q = String(opts.q === undefined ? paramQuery() : opts.q).toLowerCase();
        var filter = opts.filter === undefined ? paramFilter() : opts.filter;
        var empty = opts.showEmpty === undefined ? showEmpty() : opts.showEmpty;
        var src = PM.entries();
        var out = [];
        for (var i = 0; i < src.rows.length; i++) {
            var e = src.rows[i];
            if (!e.params.length) {
                if (!empty) continue;
                if (!passes(e, null, q, filter)) continue;
                out.push({ entry: e, param: null });
                continue;
            }
            for (var j = 0; j < e.params.length; j++) {
                if (!passes(e, e.params[j], q, filter)) continue;
                out.push({ entry: e, param: e.params[j] });
            }
        }
        return out;
    };

    function passes(entry, param, q, filter) {
        if (filter === 'edited' && !(param && param.edited)) return false;
        if (filter === 'seen re-reading' && PM.effect(entry) !== 'live') return false;
        if (filter === 'not registered' && PM.effect(entry) !== 'not registered') return false;
        if (filter === 'off in the plugin list' && entry.status) return false;
        if (!q) return true;
        if (entry.name.toLowerCase().indexOf(q) > -1) return true;
        if (param && param.name.toLowerCase().indexOf(q) > -1) return true;
        if (param && param.value.toLowerCase().indexOf(q) > -1) return true;
        return false;
    }

    PM.count = function () {
        var src = PM.entries(), n = 0;
        for (var i = 0; i < src.rows.length; i++) n += src.rows[i].params.length;
        return n;
    };

    /**
     * Commit one parameter.
     *
     * Everything the module claims about editing is enforced here: the value
     * is a string, the write is a mutation of the object the engine already
     * holds, the game's own plugin list is mirrored, and the read-back is
     * done the way a plugin reads it so what the compat layer verifies is
     * what a plugin would see.
     */
    PM.set = function (entry, pname, value) {
        return $.safe(function () {
            if (typeof entry === 'number') {
                var all = PM.entries().rows;
                for (var i = 0; i < all.length; i++) if (all[i].index === entry) { entry = all[i]; break; }
            }
            if (!entry || typeof entry !== 'object') {
                return { ok: false, title: 'NO SUCH ENTRY', why: 'no entry in the plugin list at that index' };
            }
            if (!$.allowWrite('Editing the parameter "' + pname + '" of ' + entry.name)) {
                return { ok: false, title: 'READ-ONLY', why: 'read-only mode is on; the edit was not applied' };
            }
            if (!PM.editable(entry)) {
                return { ok: false, title: 'NOT REGISTERED', why: PM.effectWhy(entry) };
            }
            var table = paramTable();
            var obj = table ? table[entry.key] : null;
            if (!obj || typeof obj !== 'object') {
                return { ok: false, title: 'NOT REGISTERED', why: NO_TABLE };
            }

            var prev = obj[pname];
            var prevStr = prev === undefined ? '' : String(prev);
            var next = String(value);

            /* A parameter whose text the plugin parses must not stop parsing.
               The consumer of a broken one throws somewhere far from here, or
               worse, catches and falls back to a default with no message. */
            if (parsesAsJson(prevStr) && !parsesAsJson(next)) {
                return {
                    ok: false, title: 'NOT VALID JSON',
                    why: pname + ' is JSON text the plugin parses; the edit was not applied'
                };
            }

            var listEntry = null;
            var list = pluginList();
            if (list && list[entry.index] && list[entry.index].parameters &&
                typeof list[entry.index].parameters === 'object') {
                listEntry = list[entry.index].parameters;
            }

            var r = verify('plugin.param', function () {
                /* In place, never a replacement: a plugin that captured this
                   object at load reads a mutation and would never see a new
                   object. A plugin that copied the VALUE out at load sees
                   neither, and nothing in the game can reach that copy. */
                obj[pname] = next;
                /* The engine table is what a plugin reads; the game's own list
                   is what anything re-running the setup reads. They diverge
                   the moment one is written without the other. */
                if (listEntry) listEntry[pname] = next;
            }, function () {
                internalRead = true;
                var got;
                try {
                    var m = pluginManager();
                    got = (m && m.parameters) ? m.parameters(entry.key)[pname] : undefined;
                } finally {
                    internalRead = false;
                }
                return got;
            }, next);

            if (originals[origKey(entry.key, pname)] === undefined) {
                originals[origKey(entry.key, pname)] = prevStr;
            }
            edits.push({
                index: entry.index, name: entry.name, key: entry.key, param: pname,
                from: prevStr, to: next, at: Date.now(), frame: $.frameCount,
                ok: r.ok, discarded: false, discardedFrame: null
            });
            $.undo.push('parameter ' + entry.base + ' · ' + pname, function () {
                var t = paramTable(), o = t ? t[entry.key] : null;
                if (o) o[pname] = prevStr;
                if (listEntry) listEntry[pname] = prevStr;
            });

            return { ok: r.ok, title: r.ok ? 'APPLIED' : 'DID NOT STICK', why: r.message, verify: r };
        }, 'set plugin parameter', { ok: false, title: 'FAILED', why: 'the write threw — see the log' });
    };

    PM.revert = function (edit) {
        if (!edit) return { ok: false, why: 'no such edit' };
        if (!$.allowWrite('Reverting the parameter "' + edit.param + '"')) {
            return { ok: false, why: 'read-only mode is on' };
        }
        var table = paramTable();
        var obj = table ? table[edit.key] : null;
        if (!obj) return { ok: false, why: NO_TABLE };
        var list = pluginList();
        var le = (list && list[edit.index] && list[edit.index].parameters) ? list[edit.index].parameters : null;
        obj[edit.param] = edit.from;
        if (le) le[edit.param] = edit.from;
        for (var i = edits.length - 1; i >= 0; i--) if (edits[i] === edit) { edits.splice(i, 1); break; }
        var still = false;
        for (i = 0; i < edits.length; i++) if (edits[i].key === edit.key && edits[i].param === edit.param) still = true;
        if (!still) delete originals[origKey(edit.key, edit.param)];
        return { ok: true, why: '' };
    };

    PM.revertAll = function () {
        var n = 0;
        while (edits.length) {
            var r = PM.revert(edits[edits.length - 1]);
            if (!r.ok) break;
            n++;
        }
        return n;
    };

    PM.edits = function () { return edits.slice(); };
    PM.discarded = function () {
        var out = [];
        for (var i = 0; i < edits.length; i++) if (edits[i].discarded) out.push(edits[i]);
        return out;
    };

    PM.scope = function () {
        var src = PM.entries();
        var out = {
            available: src.available, why: src.why,
            entries: src.total, holes: src.holes,
            withParams: 0, registered: 0, off: 0, duplicates: 0, parameters: 0
        };
        for (var i = 0; i < src.rows.length; i++) {
            var e = src.rows[i];
            if (e.params.length) out.withParams++;
            if (e.registered) out.registered++;
            if (!e.status) out.off++;
            if (e.duplicateOf !== null && e.duplicateOf !== undefined) out.duplicates++;
            out.parameters += e.params.length;
        }
        return out;
    };

    /* =====================================================================
       PART 3 — THE PASTE-INTO-A-BUG-REPORT ARTEFACT

       A screenshot of either panel loses the long "why" strings and needs a
       working renderer. This needs neither.
       ===================================================================== */
    B.reportText = function () {
        return $.safe(function () {
            var L = [$.codename + ' ' + $.version + ' — build cost', ''];
            var f = P.fps(), fc = P.frameCost(), st = P.span();

            L.push('frame rate          : ' + (f.available ? fixed(f.value, 1) : '— (' + f.why + ')'));
            L.push('frame total         : ' + (fc.available
                ? fc.frames + ' frames · mean ' + fixed(fc.meanMs, 3) + ' ms · worst ' + fixed(fc.maxMs, 3) + ' ms'
                : '— (' + fc.why + ')'));
            L.push('samples             : ' + st.count + ' over ' + fixed(st.seconds, 1) + ' s' +
                ' (one every ' + sampleMs() + ' ms, wall clock)');

            /* The two reasons for an empty table are two different lines,
               because the reader of a bug report has to be able to tell "this
               build cannot do it" from "nobody switched it on". */
            var hc = P.hookCosts();
            if (hc.available) {
                L.push('');
                L.push('per-frame hooks     : ' + hc.rows.length);
                for (var i = 0; i < hc.rows.length; i++) {
                    var r = hc.rows[i];
                    L.push('  ' + r.name + ' — ' + r.calls + ' calls · ' + fixed(r.totalMs, 2) +
                        ' ms total · ' + fixed(r.meanUs, 1) + ' µs mean · ' + pct(r.share));
                }
            } else if (!hc.listed) {
                L.push('per-frame hooks     : not measured — ' + hc.why);
            } else {
                L.push('per-frame hooks     : ' + hc.count + ' in the list, none timed — ' + hc.why);
            }

            var m = P.memory();
            L.push('');
            L.push('heap                : ' + (m.available
                ? fixed(m.usedMB, 1) + ' / ' + fixed(m.totalMB, 1) + ' MB (limit ' + fixed(m.limitMB, 1) +
                  ', growth ' + fixed(m.growthMB, 1) + ')'
                : 'not exposed — ' + m.why));

            var sg = P.sceneGraph();
            L.push('');
            L.push('scene               : ' + (sg.available ? sg.scene : '— (' + sg.why + ')'));
            if (sg.available) {
                L.push('nodes / max depth   : ' + sg.nodes + ' / ' + sg.depth + (sg.capped ? '  [' + sg.cappedWhy + ']' : ''));
                L.push('windows/sprites/etc : ' + sg.windows + ' / ' + sg.sprites + ' / ' +
                    sg.containers + ' / ' + sg.other);
            }

            L.push('');
            L.push('caches (bytes are an ESTIMATE from bitmap dimensions, not a measurement)');
            var cs = P.caches();
            for (var c = 0; c < cs.length; c++) {
                L.push('  ' + cs[c].name + ' : ' + (cs[c].present
                    ? cs[c].entries + ' entries · ~' + fixed(cs[c].bytes / (1024 * 1024), 2) + ' MB'
                    : cs[c].why));
            }
            var fl = P.flushes();
            L.push('  flushes since load : ' + (fl.available ? String(fl.count) : '? — ' + fl.why));

            /* What this report is itself pasted out of. A ring that has rolled
               over has already dropped the start of the session. */
            var lv = P.logVolume();
            L.push('');
            L.push('log ring            : ' + (lv.available
                ? lv.held + ' of ' + lv.capacity + ' lines held, ' + (lv.rolled
                    ? lv.dropped + ' rolled off the front and are in no report from here on'
                    : 'nothing has rolled off yet')
                : lv.held + ' lines held — ' + lv.why));

            var sc = PM.scope();
            L.push('');
            if (!sc.available) {
                L.push('plugin parameters   : ' + sc.why);
            } else {
                L.push('plugin entries      : ' + sc.entries + ' (' + sc.withParams + ' with parameters, ' +
                    sc.registered + ' registered, ' + sc.off + ' off, ' + sc.duplicates + ' name claimed twice)');
                L.push('parameters in total : ' + sc.parameters);
                L.push('registration key    : resolved by probing the engine table for the whole entry, ' +
                    'then for the part after the last "/", both lower-cased');
                L.push('read hook           : ' + (PM.readsAvailable() ? 'installed' : NO_READS));
            }
            return L.join('\n');
        }, 'build report', $.codename + ' ' + $.version + ' — the build report could not be built');
    };

    /* =====================================================================
       PART 4 — PANELS
       ===================================================================== */

    function note(text) {
        return h('div', { class: 'mm-sub', style: 'padding:3px 2px;white-space:normal', text: text });
    }
    function warnLine(text) {
        return h('div', {
            class: 'mm-sub',
            style: 'padding:3px 2px;white-space:normal;color:var(--mm-warn)', text: text
        });
    }
    function valueRow(label, value, tip) {
        return W.row(label, h('span', { class: 'mm-mono mm-sub', text: String(value) }), { tip: tip || null });
    }

    /* ---------------------------------------------------------------- (A) */

    var selectedIndex = null;

    function buildParameters() {
        var src = PM.entries();

        if (!src.available) {
            return U.todo('Debug', 'Parameters', [src.why]);
        }

        var scope = PM.scope();
        var tableOk = !!src.tableAvailable;
        var readsOk = PM.readsAvailable();

        /* ---- the limit, first, before a single row ---------------------- */
        var limits = W.group('What an edit can and cannot do', [
            note('Most plugins read their parameters once, at load, into their own variables. ' +
                'Editing here changes the table the engine keeps; a plugin that already read it ' +
                'never looks again.'),
            readsOk
                ? note('A row says live only when that plugin has been seen reading its parameters ' +
                    'since this module loaded. Every read before that happened before this module ' +
                    'existed, so a zero means NOT SEEN — never "reads once".')
                : warnLine(NO_READS),
            note('An edit changes the parameter object in place, so anything still holding that ' +
                'object sees it. Anything that copied a value out of it at load does not, and ' +
                'nothing in the game can reach that copy.'),
            note('Nothing here is written to the game plugin list on disk. An edit lasts until the ' +
                'game is relaunched.'),
            tableOk ? null : warnLine(NO_TABLE),
            degradeNote('plugin.param')
        ]);

        /* ---- scope ------------------------------------------------------ */
        var scopeGroup = W.group('Scope', [
            valueRow('entries', scope.entries),
            valueRow('with parameters', scope.withParams),
            valueRow('registered with the engine', scope.registered),
            valueRow('off in the plugin list', scope.off),
            valueRow('name claimed twice', scope.duplicates,
                'Dropped|The engine keeps the first claim and drops the second with no error.'),
            valueRow('parameters in total', scope.parameters),
            scope.holes ? warnLine(scope.holes + ' slot(s) in the plugin list are empty — a list ' +
                'edited by hand can carry one, and reading a name off it throws.') : null,
            W.row('read hook', h('span', {
                class: 'mm-mono mm-sub',
                style: readsOk ? null : 'color:var(--mm-warn)',
                text: readsOk ? 'installed' : (($.hooks[HOOK_PARAMS] && $.hooks[HOOK_PARAMS].reason) || NO_READS)
            }), { edgeClass: readsOk ? null : 'mm-edge--shrink mm-edge--wrap' })
        ], { tag: String(scope.entries) });

        /* ---- session edits ---------------------------------------------- */
        var editList = PM.edits();
        var discardedRows = PM.discarded();
        var editRows = editList.map(function (e) {
            return W.row(e.base || e.name, [
                h('span', { class: 'mm-mono mm-sub', text: e.param }),
                W.button({
                    label: 'revert', mini: true, mutates: true,
                    tip: 'Revert|Writes back the exact string that was there.',
                    onClick: function () {
                        PM.revert(e);
                        U.rerender();
                    }
                })
            ], { tip: e.param + '|' + e.from + '  →  ' + e.to });
        });
        if (discardedRows.length) {
            editRows.push(warnLine(discardedRows.length + ' edit(s) were discarded when something ' +
                're-registered this entry at frame ' + discardedRows[0].discardedFrame +
                ' — they are no longer in effect.'));
        }
        var editsGroup = W.group('Session edits', editRows.concat([
            W.button({
                label: 'revert every edit', wide: true, variant: 'danger',
                confirmLabel: 'revert all?', disabled: !editList.length,
                tip: editList.length ? null : 'Nothing to revert|No parameter was edited this session.',
                onClick: function () {
                    if (!editList.length) return;
                    PM.revertAll();
                    U.rerender();
                }
            }),
            W.button({
                label: 'copy the edits as JSON', wide: true, _ungated: true,
                disabled: !editList.length,
                onClick: function () {
                    if (!editList.length) return;
                    var ok = U.copyText(JSON.stringify(PM.edits(), null, 2));
                    U.toast({
                        title: ok ? 'COPIED' : 'CLIPBOARD UNAVAILABLE',
                        msg: ok ? 'The session edits are on the clipboard' : 'Select the rows above instead',
                        severity: ok ? 'ok' : 'warn'
                    });
                }
            })
        ]), { tag: String(editList.length) });

        /* ---- the selected-entry group, repainted in place ---------------- */
        var detailBody = h('div', {});
        var detail = W.group('Selected entry', [detailBody]);

        function paintDetail() {
            if (!detailBody.parentNode) return;
            U.clear(detailBody);
            var e = null, all = PM.entries().rows, i;
            for (i = 0; i < all.length; i++) if (all[i].index === selectedIndex) { e = all[i]; break; }
            if (!e) {
                detailBody.appendChild(h('div', { class: 'mm-empty', text: 'click a row' }));
                return;
            }
            /* The raw entry is path-shaped: an entry in a subfolder is one
               unbreakable token and would push the label out of the row. */
            detailBody.appendChild(W.pathRow('entry', e.name, {
                why: 'this entry has no name in the plugin list'
            }));
            detailBody.appendChild(W.row('registration key',
                h('span', {
                    class: 'mm-edge--shrink mm-edge--wrap mm-mono mm-sub',
                    style: e.key ? null : 'color:var(--mm-warn);white-space:normal',
                    text: e.key || 'not registered'
                }), {
                    tip: 'Key|' + (e.key
                        ? 'Probed on the engine\'s own table — the whole entry, then the part after the last "/".'
                        : e.keyWhy)
                }));
            detailBody.appendChild(W.row('effect',
                h('span', { class: 'mm-mono mm-sub', text: PM.effect(e) }),
                { tip: PM.effect(e) + '|' + PM.effectWhy(e) }));
            detailBody.appendChild(h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'description' }),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-sub mm-selectable',
                    text: e.description || 'none'
                })));
            var pretty = $.safe(function () {
                var o = {}, j;
                for (j = 0; j < e.params.length; j++) o[e.params[j].name] = e.params[j].value;
                return JSON.stringify(o, null, 2);
            }, 'parameter json', '{}');
            detailBody.appendChild(h('div', { class: 'mm-pre mm-pre-wrap mm-selectable', text: pretty }));
            detailBody.appendChild(W.button({
                label: 'copy', _ungated: true,
                onClick: function () {
                    var ok = U.copyText(pretty);
                    U.toast({
                        title: ok ? 'COPIED' : 'CLIPBOARD UNAVAILABLE',
                        msg: ok ? 'The parameter object is on the clipboard' : 'Select the block above instead',
                        severity: ok ? 'ok' : 'warn'
                    });
                }
            }));
        }

        /* ---- the table --------------------------------------------------
           virtual, and not optionally: the row count is the project's, not
           ours — a hundred entries with sixty parameters each is four
           figures.
           -------------------------------------------------------------- */
        var table = W.table({
            virtual: true,
            cols: [
                { label: 'plugin', w: '1 1 0' },
                { label: 'parameter', w: '1 1 0' },
                { label: 'value', w: '1 1 0' },
                { label: 'reads', w: '0 0 54px', cls: 'mm-td-num' },
                { label: 'effect', w: '0 0 92px' }
            ],
            empty: 'no matches',
            render: function (row) {
                var e = row.entry, p = row.param;
                if (!p) {
                    return [
                        h('span', { class: 'mm-cell mm-selectable', text: e.base }),
                        h('span', { class: 'mm-cell mm-sub', text: 'no parameters' }),
                        h('span', { class: 'mm-cell mm-sub', text: '—' }),
                        readsOk ? String(e.reads) : '—',
                        h('span', { class: 'mm-cell mm-sub', text: PM.effect(e) })
                    ];
                }
                var valueCell;
                if (tableOk && PM.editable(e)) {
                    valueCell = W.editCell(p.value, function (v, old) {
                        var r = PM.set(e, p.name, v);
                        if (!r.ok) {
                            valueCell.mm.set(old);
                            U.toast({ title: r.title, msg: r.why, severity: 'warn' });
                        } else {
                            U.toast({ title: 'APPLIED', msg: e.base + ' · ' + p.name, severity: 'ok', ms: 1600 });
                        }
                        repaint();
                    }, 'mm-cell mm-td-val');
                    degradeMark(valueCell, 'plugin.param');
                } else {
                    valueCell = h('span', {
                        class: 'mm-cell mm-sub', text: p.value === '' ? '(empty)' : p.value,
                        tip: 'Not editable|' + PM.effectWhy(e)
                    });
                }
                return [
                    h('span', { class: 'mm-cell mm-selectable', text: e.base }),
                    h('span', { class: 'mm-cell mm-selectable', text: p.name }),
                    valueCell,
                    readsOk ? String(p.reads) : '—',
                    h('span', { class: 'mm-cell mm-sub', text: PM.effect(e) })
                ];
            },
            onRow: function (tr, row) {
                var e = row.entry;
                tr.setAttribute('data-mm-tip', e.name + '|' + (e.description || PM.effectWhy(e)));
                if (!e.status) tr.style.opacity = '.45';
                tr.addEventListener('click', function () {
                    /* Repainted IN PLACE. A full rerender rebuilds the body
                       and throws away the search box, the filter and the
                       scroll position. */
                    selectedIndex = e.index;
                    paintDetail();
                });
            }
        });

        function repaint() { table.mm.paint(PM.rows()); }
        repaint();
        paintDetail();

        /* The reads column is the only evidence anywhere that a plugin looks
           at its parameters again after load, and it is the one thing on this
           panel that moves on its own — so it is the one thing repainted. The
           entry detail beside the table is not: it holds a selectable JSON
           block, and rewriting it under a reader who is selecting from it
           takes the selection away for a number that changed in the table
           they can already see.

           The value cells are edit cells, which is what `within` is for, and
           the table is virtual, so isScrolling() is a real guard and the
           offset survives the paint. */
        U.live(PM.readTotal, repaint, {
            name: 'parameter reads', within: table,
            when: function () { return !table.mm.isScrolling(); },
            whyNot: 'you are scrolling the list'
        });

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({
                placeholder: 'filter ' + scope.parameters + ' parameters…',
                value: paramQuery(),
                onInput: function (v) { cfgSet('build.params.q', v); repaint(); }
            }),
            W.dropdown({
                options: FILTERS, value: paramFilter(), width: '150px', _ungated: true,
                onChange: function (v) { cfgSet('build.params.filter', v); repaint(); }
            }),
            W.chip({
                label: 'show entries with no parameters', value: showEmpty(),
                onChange: function (v) { cfgSet('build.params.showEmpty', v); repaint(); }
            }));

        return cols({ narrow: true, items: [limits, scopeGroup, editsGroup] },
            [W.group('Parameters', [toolbar, table], { grow: true, tag: String(scope.parameters) }), detail]);
    }

    /* ---------------------------------------------------------------- (B) */

    function buildPerformance() {
        var host = U.getHost();
        var mem0 = P.memory();
        var hookAv = P.hooksAvailable();

        /* ---- frame rate -------------------------------------------------- */
        var fpsVal = h('span', { class: 'mm-mono mm-sub', text: '—' });
        var stepsVal = h('span', { class: 'mm-mono mm-sub', text: '—' });
        var engVal = h('span', { class: 'mm-mono mm-sub', text: '—' });
        var f0 = P.fps();
        var fpsRow = W.row('engine fps', fpsVal,
            f0.available ? null : { tip: 'Unavailable|' + NO_FPS });
        var stepsRow = W.row('logical steps/s', stepsVal, {
            tip: 'Not the frame rate|The mod\'s own step counter; it ticks while the game is held.'
        });
        var engRow = W.row('engine frames/s', engVal, {
            tip: 'A third clock|Advanced from a different place on each build.'
        });
        var rateGroup = W.group('Frame rate', [
            fpsRow, stepsRow, engRow,
            f0.available ? null : warnLine(NO_FPS),
            note('Three different questions. Steps/s below fps means the step loop skipped work; ' +
                'above it means it caught several steps up inside one frame.')
        ], { tag: f0.available ? String(Math.round(f0.value)) : '—' });

        /* ---- memory ------------------------------------------------------ */
        var usedVal = h('span', { class: 'mm-mono mm-sub', text: '—' });
        var growVal = h('span', { class: 'mm-mono mm-sub', text: '—' });
        var heapBar = h('i', { style: 'width:0%' });
        var memGroup;
        if (!mem0.available) {
            memGroup = W.group('Memory', [
                h('div', { class: 'mm-todo' },
                    h('div', { class: 'mm-todo-ms', text: 'HEAP NOT EXPOSED' }),
                    h('b', { text: 'this build does not report heap usage' }),
                    h('div', { style: 'text-align:center;line-height:1.9;white-space:normal', text: NO_HEAP })),
                W.button({
                    label: 'reset the growth baseline', wide: true, _ungated: true, disabled: true,
                    tip: 'Unavailable|There is no heap figure on this build to take a baseline from.'
                })
            ], { tag: 'not exposed' });
        } else {
            memGroup = W.group('Memory', [
                W.row('used', usedVal),
                valueRow('total', fixed(mem0.totalMB, 1) + ' MB'),
                valueRow('limit', fixed(mem0.limitMB, 1) + ' MB'),
                h('div', { class: 'mm-bar' }, heapBar),
                W.row('growth since the baseline', growVal),
                W.button({
                    label: 'reset the growth baseline', wide: true, _ungated: true,
                    onClick: function () { P.resetHeapBaseline(); }
                }),
                note('A rising number is not proof of a leak — the collector runs when it chooses, ' +
                    'and the figure is bucketed by the browser.')
            ], { tag: 'available' });
        }

        /* ---- scene graph ------------------------------------------------- */
        var sceneBody = h('div', {});
        var sceneGroup = W.group('Scene graph', [sceneBody], { tag: '—' });

        function paintScene() {
            if (!sceneBody.parentNode) return;
            var sg = P.sceneGraph();
            U.clear(sceneBody);
            if (!sg.available) {
                sceneBody.appendChild(warnLine(sg.why));
            } else {
                sceneBody.appendChild(valueRow('scene', sg.scene,
                    'As found|Some plugin suites are identifier-obfuscated; the name is printed as found.'));
                sceneBody.appendChild(valueRow('nodes', sg.nodes));
                sceneBody.appendChild(valueRow('max depth', sg.depth));
                sceneBody.appendChild(valueRow('windows', sg.windows));
                sceneBody.appendChild(valueRow('sprites', sg.sprites));
                sceneBody.appendChild(valueRow('containers', sg.containers));
                sceneBody.appendChild(valueRow('other', sg.other));
                if (sg.capped) sceneBody.appendChild(warnLine(sg.cappedWhy));
                sceneGroup.mm.tag(String(sg.nodes));
            }
            sceneBody.appendChild(W.button({
                label: 'recount', wide: true, _ungated: true,
                tip: 'Counted on demand|Walking the graph every frame would be the cost this panel reports.',
                onClick: paintScene
            }));
        }

        /* ---- caches ------------------------------------------------------ */
        var cacheList = P.caches();
        var present = 0;
        var cacheRows = cacheList.map(function (c) {
            if (c.present) present++;
            return W.row(c.name, h('span', {
                class: 'mm-mono mm-sub',
                style: c.present ? null : 'color:var(--mm-warn)',
                text: c.present
                    ? c.entries + ' entries · ~' + fixed(c.bytes / (1024 * 1024), 2) + ' MB'
                    : c.why
            }), {
                // Where the cache is absent the value is a SENTENCE, so the edge
                // has to give way to the label rather than the other way round.
                edgeClass: c.present ? null : 'mm-edge--shrink mm-edge--wrap',
                // And where it is present the LABEL is the long half — the
                // value is a rigid "12 entries · ~3.40 MB" and the name beside
                // it is what got clipped to "renderer base tex…", which is the
                // only part saying what the number counts.
                labelClass: c.present ? 'mm-lab--wrap' : null,
                tip: c.present ? 'Estimate|Width x height x 4 over ' + c.sized + ' sized entries.' : null
            });
        });
        var fl = P.flushes();
        cacheRows.push(W.row('cache flushes since load', h('span', {
            class: 'mm-mono mm-sub',
            text: fl.available ? String(fl.count) : '?'
        }), fl.available ? null : { tip: 'Unknown|' + fl.why }));
        cacheRows.push(note('Bytes are an ESTIMATE — width x height x 4 over the bitmaps this build ' +
            'lets us see. Neither engine tracks texture memory, and anything that clears the cache ' +
            'on a map change will make this swing.'));
        var cacheGroup = W.group('Texture caches', cacheRows,
            { tag: present + ' of ' + cacheList.length + ' present' });

        /* ---- the chart --------------------------------------------------
           The panel body is built DETACHED, so clientWidth is 0 and an inline
           first draw silently paints nothing. Every draw comes from the tick
           hook, which also guards on the node still being in the document.
           -------------------------------------------------------------- */
        var canvas = h('canvas', {
            style: 'width:100%;height:64px;flex:0 0 64px;display:block;background:var(--mm-bg-sunken)'
        });
        var spanVal = h('span', { class: 'mm-mono mm-sub', text: '—' });
        var statVal = h('span', { class: 'mm-mono mm-sub', text: '—' });
        var chartWhy = h('div', { class: 'mm-sub', style: 'padding:3px 2px;white-space:normal' });
        var seriesOptions = mem0.available ? SERIES : SERIES.slice(0, 2);
        var seriesNow = series();
        if (seriesOptions.indexOf(seriesNow) < 0) seriesNow = seriesOptions[0];

        var chartToolbar = h('div', { class: 'mm-toolbar' },
            W.dropdown({
                options: seriesOptions, value: seriesNow, width: '132px', _ungated: true,
                onChange: function (v) { cfgSet('build.perf.series', v); drawChart(); }
            }),
            W.dropdown({
                options: INTERVALS, width: '86px', _ungated: true,
                value: intervalLabel(sampleMs()),
                onChange: function (v) { cfgSet('build.perf.sampleMs', INTERVAL_MS[v] || 500); }
            }),
            W.button({
                label: 'clear history', _ungated: true,
                onClick: function () { P.resetSamples(); drawChart(); }
            }));

        var overGroup = W.group('Over time', [
            chartToolbar, canvas,
            W.row('span', spanVal),
            W.row('min / median / max', statVal),
            chartWhy,
            note('Sampled on a wall clock from a per-frame hook, so a build running its logical ' +
                'steps at several times real speed still plots one point per interval. A gap in ' +
                'the line means the frame loop stopped.')
        ]);

        if (!mem0.available) {
            chartWhy.textContent = 'The heap series is not offered: ' + NO_HEAP;
            chartWhy.style.color = 'var(--mm-warn)';
        }

        function drawChart() {
            if (!canvas.parentNode) { chart.refusedDetached++; return false; }
            var w = canvas.clientWidth, ht = canvas.clientHeight;
            if (!w || !ht) { chart.refusedDetached++; return false; }
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== ht) canvas.height = ht;
            var ctx = soft(function () { return canvas.getContext('2d'); }, null);
            if (!ctx) return false;
            chart.drawn++;
            var which = series();
            if (seriesOptions.indexOf(which) < 0) which = seriesOptions[0];
            var vals = P.seriesValues(which);
            var st = P.stats(which), sp = P.span();

            spanVal.textContent = sp.count + ' samples over ' + fixed(sp.seconds, 1) + ' s';
            statVal.textContent = st.n
                ? fixed(st.min, 1) + ' / ' + fixed(st.median, 1) + ' / ' + fixed(st.max, 1)
                : 'nothing sampled yet';

            ctx.clearRect(0, 0, w, ht);
            if (st.n < 2) return true;
            var lo = st.min, hi = st.max;
            /* A series that has not moved must read as flat through the
               middle. Widening only the top pins it to the floor of the box,
               which is the one shape that reads as "it fell to nothing". */
            if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
            ctx.strokeStyle = '#7ac0ff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            var started = false;
            for (var i = 0; i < vals.length; i++) {
                var v = vals[i];
                if (v === null) { started = false; continue; }
                var x = (vals.length === 1) ? 0 : (i / (vals.length - 1)) * (w - 1);
                var y = ht - 1 - ((v - lo) / (hi - lo)) * (ht - 2);
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            return true;
        }

        /* ---- per-hook table ---------------------------------------------- */
        var hookTable = W.table({
            cols: [
                { label: 'hook', w: '1 1 0' },
                { label: 'calls', w: '0 0 56px', cls: 'mm-td-num' },
                { label: 'total ms', w: '0 0 68px', cls: 'mm-td-num' },
                { label: 'mean µs', w: '0 0 68px', cls: 'mm-td-num' },
                { label: 'share', w: '0 0 96px' },
                { label: '', w: '0 0 62px' }
            ],
            empty: hookAv.ok
                ? 'per-hook timing is off — turn it on above'
                : 'no per-hook figures on this build — the reason is above',
            render: function (r) {
                var fill = h('i', { style: 'width:' + fixed(r.share * 100, 1) + '%' });
                return [
                    h('span', { class: 'mm-cell mm-selectable', text: r.name }),
                    String(r.calls),
                    fixed(r.totalMs, 2),
                    fixed(r.meanUs, 1),
                    h('div', { class: 'mm-bar' }, fill),
                    W.button({
                        label: 'remove', mini: true, variant: 'danger', mutates: true,
                        confirmLabel: 'stop calling it?',
                        tip: (typeof $.offFrame === 'function')
                            ? 'Removes|"' + r.name + '" stops running every frame.'
                            : 'No remover|' + NO_REMOVER,
                        onClick: function () { removeHook(r.name); }
                    })
                ];
            },
            onRow: function (tr, r) {
                if (r.meanUs / 1000 > budgetMs()) tr.style.color = 'var(--mm-warn)';
                if (!r.wrapped) tr.style.opacity = '.55';
            }
        });

        /**
         * Take one hook out of the frame loop.
         *
         * Routed through the compat layer like every other mutating control:
         * the read-back is "is that name still in the list", which is exactly
         * what catches the identity trap where a hook this module has wrapped
         * cannot be removed with the function its owner registered.
         */
        function removeHook(name) {
            var l = frameHookList();
            if (!l) return;
            var target = null, i;
            for (i = 0; i < l.length; i++) if (l[i] && l[i].name === name) { target = l[i]; break; }
            if (!target) return;
            if (typeof $.offFrame !== 'function') {
                U.toast({ title: 'NO REMOVER', msg: NO_REMOVER, severity: 'warn' });
                return;
            }
            /* The function the OWNER registered where the registry kept it,
               and the running one otherwise — which is this module's wrapper
               while timing is on. Either value takes the entry out of a
               registry that records both; only one does where it records one,
               and this picks the one that matches whichever it is. */
            var own = target.orig || target.fn;
            var r = verify('build.frameHook', function () {
                $.offFrame(own);
            }, function () {
                var names = P.hookNames() || [];
                return names.indexOf(name) > -1;
            }, false);
            U.toast({
                title: r.ok ? 'REMOVED' : 'STILL RUNNING',
                msg: r.ok ? name + ' is out of the frame loop' : r.message,
                severity: r.ok ? 'ok' : 'warn'
            });
            paintHooks();
        }

        var frameTotalVal = h('span', { class: 'mm-mono mm-sub', text: '—' });
        function paintHooks() {
            if (!hookTable.parentNode) return;
            var hc = P.hookCosts();
            hookTable.mm.paint(hc.rows);
        }

        var hooksGroup = W.group('Per-frame hooks', [
            W.toggleRow('time each hook', {
                value: timing.on, _ungated: true, disabled: !hookAv.ok,
                tip: hookAv.ok
                    ? 'Costs|Two clock reads per hook per frame while it is on.'
                    : 'Unavailable|' + NO_HOOK_LIST,
                onChange: function (v) {
                    var r = P.setTiming(v);
                    if (!r.ok) U.toast({ title: 'NOT AVAILABLE', msg: r.why, severity: 'warn' });
                    paintHooks();
                }
            }),
            hookAv.ok ? null : warnLine(NO_HOOK_LIST),
            (hookAv.ok && typeof $.offFrame !== 'function') ? warnLine(NO_REMOVER) : null,
            hookTable,
            W.row('frame total', frameTotalVal, {
                tip: 'Measured either way|Taken at the entry point, not inside it.'
            }),
            W.row('budget', W.number({
                value: budgetMs(), min: 0.1, max: 16.7, step: 0.1, _ungated: true,
                onChange: function (v) { cfgSet('build.perf.budgetMs', v); paintHooks(); }
            }), { tip: 'Milliseconds|A hook whose mean is above this is coloured.' }),
            note('The clock is quantised, and one hook\'s cost in one frame is below the step. The ' +
                'table reports the total accumulated over the frames it counted and the mean — ' +
                'never one frame\'s reading.'),
            note('A hook that throws is removed by the frame loop itself and the log says which. ' +
                'It then simply is not in this table.'),
            note('Turning timing off restores each hook\'s own function, so nothing is left wrapped.')
        ], { tag: hookAv.ok ? hookAv.count + ' hooks' : 'unavailable' });

        /* Neither group grows, and the column scrolls instead.
           `.mm-table` is flex:1 1 auto with min-height:0, so inside a group
           that is fighting for height it shrinks to nothing while its own
           header keeps its size and paints straight over the rows below it —
           a table that has collapsed to a header sitting on top of the next
           control. Bounded here instead: the body scrolls past a few rows,
           and the list is ours and short. */
        hookTable.mm.body.style.maxHeight = '170px';

        paintHooks();

        /* ---- overlay cost ------------------------------------------------ */
        var ov = P.overlay();
        var lv = P.logVolume();
        var overlayGroup = W.group('Overlay cost', [
            valueRow('mounted', ov.mounted ? 'yes' : 'no'),
            valueRow('open', ov.open ? 'yes' : 'no'),
            valueRow('DOM nodes under the overlay', ov.nodes),
            valueRow('per-frame hooks the overlay owns', ov.fastHooks),
            valueRow('700 ms hooks', ov.tickHooks),
            note('Closed, the overlay\'s own per-frame hook returns on its first line.'),
            /* The log ring is a fixed-size shared resource, and it is what the
               button below pastes out of. Once it has rolled over, the start
               of the session is gone from every report taken after it. */
            lv.available
                ? valueRow('log lines held', lv.held + ' of ' + lv.capacity,
                    'The report\'s source|Once the ring is full the oldest lines roll off it.')
                : warnLine(NO_LOG_VOLUME),
            (lv.available && lv.rolled)
                ? warnLine(lv.dropped + ' log line(s) have already rolled off the front of the ring — ' +
                    'the start of this session is in no report taken from here on.')
                : null,
            W.button({
                label: 'copy the performance report', wide: true, _ungated: true,
                tip: 'Copy|Every figure here as plain text, for a bug report.',
                onClick: function () {
                    var ok = U.copyText(B.reportText());
                    U.toast({
                        title: ok ? 'COPIED' : 'CLIPBOARD UNAVAILABLE',
                        msg: ok ? 'Build report on the clipboard' : 'Select the text above instead',
                        severity: ok ? 'ok' : 'warn'
                    });
                }
            })
        ], { collapsed: true });

        /* ---- the 700 ms repaint -----------------------------------------
           Every row guards on its own node still being in the document:
           tickHooks is cleared and refilled on every tab render, and a node
           from a previous build is still referenced by a closure that has not
           been dropped yet.
           -------------------------------------------------------------- */
        function tick() {
            $.safe(function () {
                if (!fpsRow.parentNode) return;
                var f = P.fps();
                fpsVal.textContent = f.available ? String(Math.round(f.value)) : '—';
                var last = samples.length ? samples[samples.length - 1] : null;
                stepsVal.textContent = (last && last.steps !== null) ? fixed(last.steps, 1) : '—';
                engVal.textContent = (last && last.frames !== null) ? fixed(last.frames, 1) : '—';

                var fc = P.frameCost();
                if (frameTotalVal.parentNode) {
                    frameTotalVal.textContent = fc.available
                        ? fc.frames + ' frames · mean ' + fixed(fc.meanMs, 3) + ' ms · worst ' + fixed(fc.maxMs, 3) + ' ms'
                        : 'not measured — ' + fc.why;
                }

                var m = P.memory();
                if (m.available && usedVal.parentNode) {
                    usedVal.textContent = fixed(m.usedMB, 1) + ' MB';
                    growVal.textContent = (m.growthMB >= 0 ? '+' : '') + fixed(m.growthMB, 1) + ' MB';
                    if (m.limitMB) heapBar.style.width = fixed((m.usedMB / m.limitMB) * 100, 1) + '%';
                }
                drawChart();
                if (timing.on && hookTable.parentNode && !hookTable.mm.isScrolling()) paintHooks();
            }, 'build performance tick');
        }

        if (host && host.tickHooks) host.tickHooks.push(tick);
        /* One draw as soon as the body is in the document. The tick would get
           there within 700 ms, but an empty chart on open reads as "nothing
           was sampled". */
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () { paintScene(); drawChart(); tick(); });
        }

        return cols({ narrow: true, items: [rateGroup, memGroup, sceneGroup, cacheGroup] },
            [overGroup, hooksGroup, overlayGroup]);
    }

    function intervalLabel(ms) {
        for (var k in INTERVAL_MS) if (INTERVAL_MS[k] === ms) return k;
        return '0.5 s';
    }

    /* =====================================================================
       REGISTRATION

       Unconditional, both of them. A panel that vanished from the strip
       because the thing it reports on is missing is the failure this project
       exists to prevent: the panel is where the reason is written down.
       ===================================================================== */
    U.panel('debug', 'Parameters', function () { return buildParameters(); }, 35);
    U.panel('debug', 'Performance', function () { return buildPerformance(); }, 80);

    /* Restore a persisted timing preference, but only where it can be
       honoured. It is deliberately not registered as unsafe at boot —
       measuring a slow launch is a reason to want it on from frame one — so
       the default is off and the panel states the cost beside the toggle. */
    if (timingWanted()) $.safe(function () { P.setTiming(true); }, 'restore hook timing');

    $.api.build = function () { return B.reportText(); };

    $.log('info', 'build: cost model ready (' +
        (P.frameCost().available ? 'frame cost measured' : 'frame cost unavailable') + ', ' +
        (P.hooksAvailable().ok ? 'per-hook timing available' : 'per-hook timing unavailable') + ', ' +
        (PM.readsAvailable() ? 'parameter reads counted' : 'parameter reads not observable') + ')');

    /* The function the frame loop is holding, so whoever wants the sampler out
       of the loop — a check, or the console — can hand it back the same value
       $.onFrame was given. Nothing else identifies it: the loop removes by
       function identity, not by name. */
    B.samplerFn = function () { return samplerFn; };

})(window.GigaHack);
