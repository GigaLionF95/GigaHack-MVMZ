/* =============================================================================
   GigaHack test harness — checks/build.js
   GigaHack_Build: what this build costs to run, and how its plugins are
   configured.

   Both halves of this module make claims that are easy to make wrongly and
   impossible to spot from a screenshot, so almost nothing here asserts a
   number. The frame-cost claims are driven through the mod's own frame entry
   point and counted; the parameter claims are made against the fixture's
   plugin list, which deliberately carries every shape a real one does — an
   entry in a subfolder, an entry that is off, two entries claiming one name,
   an entry with no parameters object at all, and values that are JSON text.

   The per-hook cost feature needs the frame loop to publish its hook list, and
   it does: the hooks module hands the registry over BY REFERENCE, each entry
   carrying the function its owner registered beside the one that runs. So the
   whole feature is driven here against the list the frame loop actually calls
   — wrapping, ranking, removal and unwrapping alike — rather than against a
   model of it. The other world is asserted too: a build whose frame loop
   publishes nothing is one the mod still has to survive, and it is simulated
   by taking the accessor away.

   State discipline: every setting, edit, hook, degradation and undo entry this
   file touches is captured up front and put back at the end, and the last
   block asserts that it really was.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page, shot = ctx.shot;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ, MODDED = ctx.MODDED;

  const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'gigahack', 'js', 'plugins', 'GigaHack_Build.js'), 'utf8');
  /* Comments stripped so a rule never fires on the module's own prose about
     what it does not do; string contents kept separately, because two of the
     rules are about what the user is shown. */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const NAKED = CODE.replace(/'(\\.|[^'\\])*'/g, "''").replace(/"(\\.|[^"\\])*"/g, '""');
  const LITERALS = (CODE.match(/'(\\.|[^'\\\n])*'/g) || []).join('\n');

  /* =========================================================================
     0 — CAPTURE
     ====================================================================== */
  await ev(() => {
    const G = window.GigaHack;
    window.__buildKeep = {
      cfg: JSON.stringify(G.cfg.build === undefined ? null : G.cfg.build),
      hadCfg: G.cfg.build !== undefined,
      tab: G.cfg.ui.tab,
      sub: JSON.stringify(G.cfg.ui.sub || {}),
      open: G.ui.isOpen(),
      readonly: !!(G.cfg.behaviour && G.cfg.behaviour.readonly),
      undo: G.undo.size(),
      frameCount: G.frameCount,
      params: JSON.stringify(PluginManager._parameters),
      onFrame: G.onFrame,
      offFrame: G.offFrame,
      frameHooks: G.frameHooks,
      /* The registry is a live array shared with every module. Its CONTENTS
         are the footprint that matters — a probe hook this file registered and
         failed to take out again would run for the rest of the session. */
      hookNames: G.frameHooks().map(e => e.name).sort().join(' | '),
      pmParameters: PluginManager.parameters,
      pmSetParameters: PluginManager.setParameters
    };
    /* One frame, the way the engine drives it. Nothing here reaches for the
       engine's own main loop — the mod's entry point is the only safe door on
       a build whose loop perpetuates itself from inside. */
    window.__buildFrames = function (n) { for (var i = 0; i < n; i++) G.frame(); };
    /* Settings are written straight onto the live table rather than through
       cfgSet: this file only needs the module to READ a different value, and
       a persisted write per assertion is a settings file saved thirty times
       and thirty lines in a log the suite also asserts on. */
    window.__buildCfg = function (dotted, v) {
      var parts = dotted.split('.'), node = G.cfg, i;
      for (i = 0; i < parts.length - 1; i++) {
        if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = v;
    };
  });

  const render = async (sub) => {
    await ev((s) => {
      const G = window.GigaHack;
      G.ui.setOpen(true);
      G.cfg.ui.tab = 'debug';
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub.debug = s;
      G.ui.rerender();
    }, sub);
    await page.waitForTimeout(130);
    return await ev(() => {
      const r = document.querySelector('#mm-root .mm-win') || document.querySelector('#mm-root');
      return r ? r.textContent : '';
    });
  };

  /* =========================================================================
     1 — REGISTRATION
     ====================================================================== */
  const panels = await ev(() => window.GigaHack.ui.panelNames('debug'));
  const at = (n) => panels.indexOf(n);
  check('the build module registers two panels on the debug tab, once each',
    panels.filter(n => n === 'Parameters').length === 1 &&
    panels.filter(n => n === 'Performance').length === 1, panels.join(', '));
  check('and it claims orders no other panel on that tab already holds, so neither displaces one',
    at('Plugins') > -1 && at('Parameters') > at('Plugins') && at('Parameters') < at('Compatibility') &&
    at('Performance') > at('Log') && at('Performance') < at('Backups'),
    panels.join(', '));

  /* =========================================================================
     2 — THE FRAME TOTAL

     The wrapper is the one thing in this module that runs on every frame of
     every build, so what it must not do is worth more than what it does.
     ====================================================================== */
  const wrap = await ev(() => {
    const G = window.GigaHack, P = G.build.perf;
    const before = { frames: P.frameCost().frames, count: G.frameCount };
    window.__buildFrames(10);
    const after = { frames: P.frameCost().frames, count: G.frameCount };
    return {
      hookInstalled: !!(G.hooks['GigaHack.frame (frame cost)'] || {}).installed,
      keptOriginal: typeof (G.hooks['GigaHack.frame (frame cost)'] || {}).original === 'function',
      framesDelta: after.frames - before.frames,
      countDelta: after.count - before.count,
      available: P.frameCost().available,
      timingOn: P.timing()
    };
  });
  check('the frame-cost wrapper calls the original exactly once per frame and never returns early, ' +
    'so it is safe on a build whose frame loop drives itself',
    wrap.hookInstalled && wrap.keptOriginal && wrap.framesDelta === 10 && wrap.countDelta === 10,
    JSON.stringify(wrap));
  check('the total frame cost is measured whether or not per-hook timing is on',
    wrap.available === true && wrap.timingOn === false && wrap.framesDelta === 10, JSON.stringify(wrap));

  const totals = await ev(() => {
    const P = window.GigaHack.build.perf;
    const f = P.frameCost();
    return { frames: f.frames, mean: f.meanMs, max: f.maxMs, total: f.totalMs };
  });
  check('the frame cost is reported as a total over counted frames and a mean, never as one ' +
    'frame\'s reading, because the browser quantises its clock',
    totals.frames >= 10 && totals.total >= 0 && totals.max >= 0 &&
    Math.abs(totals.mean - totals.total / totals.frames) < 1e-9, JSON.stringify(totals));

  /* =========================================================================
     3 — THE SAMPLER AND THE WALL CLOCK
     ====================================================================== */
  const wall = await ev(async () => {
    const G = window.GigaHack, P = G.build.perf;
    P.resetSamples();
    window.__buildFrames(1);                 // primes the interval
    const primed = P.samples().length;
    window.__buildFrames(300);               // 300 logical steps, no wall time
    const burst = P.samples().length;
    await new Promise(r => setTimeout(r, 620));
    window.__buildFrames(1);
    return { primed: primed, burst: burst, afterWait: P.samples().length };
  });
  check('the sample history is taken on a wall clock, so a build running its logical steps at ' +
    'several times real speed still plots one point per interval',
    wall.primed === 1 && wall.burst === 1 && wall.afterWait === 2, JSON.stringify(wall));

  const sampler = await ev(async () => {
    const G = window.GigaHack, P = G.build.perf;
    P.resetSamples();
    G.offFrame(G.build.samplerFn());
    window.__buildFrames(1);
    await new Promise(r => setTimeout(r, 620));
    window.__buildFrames(1);
    const stopped = P.samples().length;
    G.onFrame('build: sampler', G.build.samplerFn());
    window.__buildFrames(1);
    return { stopped: stopped, resumed: P.samples().length };
  });
  check('the sampler runs from the frame loop\'s own hook list rather than from the frame-cost ' +
    'wrapper, so removing it stops it and its own cost is not hidden from the table it fills',
    sampler.stopped === 0 && sampler.resumed === 1, JSON.stringify(sampler));

  const gap = await ev(async () => {
    const P = window.GigaHack.build.perf;
    P.resetSamples();
    window.__buildFrames(1);
    await new Promise(r => setTimeout(r, 620));
    window.__buildFrames(1);
    const s = P.samples();
    return { n: s.length, firstSteps: s[0].steps, secondSteps: s[1].steps, gapMs: s[1].gapMs };
  });
  check('the first sample carries no rate, because a rate needs two readings and an interval ' +
    'between them, and the second carries one',
    gap.n === 2 && gap.firstSteps === null && typeof gap.secondSteps === 'number' && gap.gapMs >= 500,
    JSON.stringify(gap));

  /* =========================================================================
     4 — THE FRAME RATE, AND ITS ABSENCE
     ====================================================================== */
  const fps = await ev(() => {
    const G = window.GigaHack, P = G.build.perf;
    const live = P.fps();
    /* The engine's own counter, reached only through the adapter — this
       module never names either of the two fields, because a plugin that
       replaces the renderer takes both away. */
    const engine = G.eng.fps();
    const keepC = Graphics._fpsCounter, keepM = Graphics._fpsMeter;
    delete Graphics._fpsCounter; delete Graphics._fpsMeter;
    const gone = P.fps();
    Graphics._fpsCounter = keepC; Graphics._fpsMeter = keepM;
    if (keepC === undefined) delete Graphics._fpsCounter;
    if (keepM === undefined) delete Graphics._fpsMeter;
    return { live: live, engine: engine, gone: gone, back: P.fps().available };
  });
  check('the frame-rate readout comes from the engine\'s own counter through the adapter, and is ' +
    'the number that counter holds',
    fps.live.available === true && fps.live.value === fps.engine && fps.back === true,
    JSON.stringify(fps.live) + ' engine=' + fps.engine);
  check('a build with neither frame-rate counter reports it as unavailable with the reason, not ' +
    'as zero',
    fps.gone.available === false && fps.gone.value === null &&
    /no frame-rate counter/.test(fps.gone.why), JSON.stringify(fps.gone));

  /* =========================================================================
     5 — PER-HOOK COST

     Two worlds, both asserted, and the real one first. Everything here is
     driven against the registry the frame loop actually calls: the probes are
     registered through $.onFrame, the frames are driven through $.frame(), and
     the wrappers this module puts on go onto the same entries every other
     module is sharing. The second world — a frame loop that publishes no list
     at all — is simulated further down by taking the accessor away.
     ====================================================================== */
  const listed = await ev(() => {
    const G = window.GigaHack, P = G.build.perf;
    const av = P.hooksAvailable();
    const c = P.hookCosts();
    return {
      av: av,
      live: G.frameHooks().length,
      byRef: G.frameHooks() === G.frameHooks(),
      names: P.hookNames(),
      costs: {
        available: c.available, listed: c.listed, timing: c.timing,
        rows: c.rows.length, count: c.count, why: c.why
      }
    };
  });
  check('the hook list this module times is the frame loop\'s own, handed over by reference and ' +
    're-read rather than copied — a copy would time entries nothing calls',
    listed.av.ok === true && listed.byRef === true && listed.live > 0 &&
    listed.av.count === listed.live && listed.names.length === listed.live &&
    listed.names.indexOf('build: sampler') > -1,
    JSON.stringify({ count: listed.av.count, live: listed.live, names: listed.names }).slice(0, 200));
  check('"is there a list to time" and "is timing switched on" are two questions with two answers, ' +
    'so a published list with the toggle off never reads as a build that cannot do it at all',
    listed.costs.listed === true && listed.costs.timing === false &&
    listed.costs.available === false && listed.costs.rows === 0 &&
    listed.costs.count === listed.live &&
    /per-hook timing is off/.test(listed.costs.why) &&
    !/does not publish its per-frame list/.test(listed.costs.why),
    JSON.stringify(listed.costs));

  /* --- timing, against the live registry ---------------------------------- */
  const timed = await ev(async () => {
    const G = window.GigaHack, P = G.build.perf;
    const list = G.frameHooks();
    const before = list.map(e => e.name).sort().join(' | ');

    let slowRuns = 0, idleRuns = 0;
    const slow = G.onFrame('build check: costly probe', function () {
      slowRuns++;
      var t = performance.now();
      while (performance.now() - t < 1.2) { /* burn a measurable slice */ }
    });
    const idle = G.onFrame('build check: free probe', function () { idleRuns++; });

    const on = P.setTiming(true);
    /* Every entry in the shared list, not only the two probes: the wrapper is
       put on in place, and the module's own sampler is not exempt from the
       table it fills. */
    const liveBefore = list.length;
    const wrappedNow = list.filter(e => e.fn !== e.orig).length;
    window.__buildFrames(12);

    const costs = P.hookCosts();
    const liveNames = (P.hookNames() || []).slice().sort().join(' | ');
    const byName = {};
    costs.rows.forEach(r => { byName[r.name] = r; });
    const shareSum = costs.rows.reduce((a, r) => a + r.share, 0);

    /* The identity trap: the owner is holding the function it registered, not
       the wrapper this module put in its place. The registry records both. */
    G.offFrame(idle);
    const afterRemove = P.hookNames();

    const off = P.setTiming(false);
    const unwrapped = list.every(e => e.fn === e.orig);
    const removerUntouched = G.offFrame === window.__buildKeep.offFrame;

    /* Unwrapped has to mean WORKING, not merely different: the sampler was one
       of the entries wrapped, and it is what fills the chart. */
    G.offFrame(slow);
    P.resetSamples();
    window.__buildFrames(1);
    await new Promise(r => setTimeout(r, 620));
    window.__buildFrames(1);

    return {
      on: on, off: off, liveBefore: liveBefore, wrappedNow: wrappedNow,
      rowNames: costs.rows.map(r => r.name).sort().join(' | '), liveNames: liveNames,
      rows: costs.rows.length, first: costs.rows[0] || null,
      costly: byName['build check: costly probe'] || null,
      free: byName['build check: free probe'] || null,
      sampler: byName['build: sampler'] || null,
      shareSum: shareSum, slowRuns: slowRuns, idleRuns: idleRuns,
      afterRemove: afterRemove, unwrapped: unwrapped, removerUntouched: removerUntouched,
      samplesAfter: P.samples().length,
      before: before, after: list.map(e => e.name).sort().join(' | '),
      noAlias: G.hooks['GigaHack.offFrame (hook timing)'] === undefined
    };
  });
  check('with timing on, the table names every hook the frame loop actually holds and nothing ' +
    'else — the module\'s own sampler included, because a panel that hid its own cost would be ' +
    'hiding a cost it put there',
    timed.on.ok === true && timed.rowNames === timed.liveNames &&
    timed.rows === timed.liveBefore && timed.wrappedNow === timed.liveBefore &&
    !!timed.sampler && timed.sampler.calls === 12,
    JSON.stringify({ rows: timed.rows, live: timed.liveBefore, wrapped: timed.wrappedNow }));
  check('a hook that costs measurable time ranks above one that costs none, and the table names it',
    !!timed.first && timed.first.name === 'build check: costly probe' &&
    !!timed.costly && !!timed.free && timed.costly.totalMs > timed.free.totalMs &&
    timed.costly.share > 0.5,
    JSON.stringify(timed.first) + ' | ' + JSON.stringify(timed.free));
  check('every hook wrapped for timing is still called exactly once per frame, so measuring a ' +
    'frame does not change what the frame does',
    timed.slowRuns === 12 && timed.idleRuns === 12 &&
    timed.costly.calls === 12 && timed.free.calls === 12 &&
    Math.abs(timed.shareSum - 1) < 1e-6,
    JSON.stringify({ slow: timed.slowRuns, idle: timed.idleRuns, share: timed.shareSum }));
  check('the frame loop\'s own remover takes out a hook this module has wrapped, so the module ' +
    'that registered it does not have to know it was wrapped and this module aliases nothing to ' +
    'translate for it',
    timed.afterRemove.indexOf('build check: free probe') === -1 &&
    timed.afterRemove.indexOf('build check: costly probe') > -1 &&
    timed.noAlias === true,
    JSON.stringify({ gone: timed.afterRemove.indexOf('build check: free probe') === -1, alias: !timed.noAlias }));
  check('turning per-hook timing off puts every hook\'s own function back into the registry the ' +
    'frame loop calls, leaves the remover it shares alone, and leaves those hooks working — a ' +
    'wrapper left on either would follow the player for the rest of the session',
    timed.off.ok === true && timed.unwrapped === true && timed.removerUntouched === true &&
    timed.samplesAfter === 2 && timed.after === timed.before,
    JSON.stringify({ unwrapped: timed.unwrapped, remover: timed.removerUntouched, samples: timed.samplesAfter }));

  /* --- removal, through the compat layer ---------------------------------- */
  const removal = await ev(() => {
    const G = window.GigaHack, P = G.build.perf;
    const own = G.onFrame('build check: removable probe', function () { });
    const listedNow = (P.hookNames() || []).indexOf('build check: removable probe') > -1;
    /* What the panel's remove button does, verified the same way. */
    const r = G.compat.verify('build.frameHook', function () { G.offFrame(own); },
      function () { return (P.hookNames() || []).indexOf('build check: removable probe') > -1; }, false);
    return {
      before: listedNow, after: (P.hookNames() || []).indexOf('build check: removable probe') > -1,
      ok: r.ok, degraded: G.compat.isDegraded('build.frameHook')
    };
  });
  check('taking a hook out of the frame loop is verified by asking the loop whether the name is ' +
    'still there, which is what catches a hook that refuses to come out',
    removal.before === true && removal.after === false &&
    removal.ok === true && removal.degraded === false, JSON.stringify(removal));

  /* --- the other world: a frame loop that publishes nothing ----------------
     No longer the default, and still a build the mod has to survive. The
     accessor is taken away rather than modelled, so what is exercised is the
     module's own answer to its absence.
     ------------------------------------------------------------------- */
  const noList = await ev(() => {
    const G = window.GigaHack, P = G.build.perf, k = window.__buildKeep;
    delete G.frameHooks;
    const av = P.hooksAvailable();
    const c = P.hookCosts();
    const asked = P.setTiming(true);
    G.cfg.ui.tab = 'debug'; G.cfg.ui.sub.debug = 'Performance';
    G.ui.setOpen(true); G.ui.rerender();
    const text = (document.querySelector('#mm-root .mm-win') || {}).textContent || '';
    const report = G.build.reportText();
    G.frameHooks = k.frameHooks;
    return {
      av: av, asked: asked, timing: P.timing(),
      costs: {
        available: c.available, listed: c.listed, timing: c.timing,
        rows: c.rows.length, count: c.count, why: c.why
      },
      saysNoList: /does not publish its per-frame list/.test(text),
      offersToggle: /turn it on above/.test(text),
      report: /per-frame hooks\s+: not measured/.test(report),
      back: G.frameHooks === k.frameHooks, listedAgain: P.hooksAvailable().ok
    };
  });
  check('where the frame loop publishes no hook list the panel names that list as the missing ' +
    'piece, rather than showing an empty table that would read as "nothing inside a frame costs ' +
    'anything"',
    noList.av.ok === false && noList.costs.listed === false &&
    noList.costs.available === false && noList.costs.rows === 0 && noList.costs.count === 0 &&
    /does not publish its per-frame list/.test(noList.costs.why) &&
    noList.saysNoList === true && noList.report === true,
    JSON.stringify(noList.costs).slice(0, 200));
  check('and it blames the build rather than the toggle: asking for timing there is refused with ' +
    'that reason, and nothing offers to turn on a measurement the build cannot make',
    noList.asked.ok === false && noList.timing === false &&
    /does not publish its per-frame list/.test(noList.asked.why) &&
    noList.offersToggle === false,
    JSON.stringify({ asked: noList.asked, offersToggle: noList.offersToggle }));
  check('and the accessor coming back is all it takes for the feature to be offered again, because ' +
    'the list is asked for on every look rather than answered once at load',
    noList.back === true && noList.listedAgain === true,
    JSON.stringify({ back: noList.back, ok: noList.listedAgain }));

  /* --- a hook that throws is the frame loop's business, not this module's -- */
  const thrower = await ev(() => {
    const G = window.GigaHack;
    const before = G.logHistory().length;
    G.onFrame('build check: deliberate test error hook', function () {
      throw new Error('deliberate test error — this hook is made to throw');
    });
    window.__buildFrames(1);
    const afterOne = G.logHistory().slice(before).filter(e => /threw and was removed/.test(e.msg));
    window.__buildFrames(3);
    const afterMore = G.logHistory().slice(before).filter(e => /threw and was removed/.test(e.msg));
    return { one: afterOne.length, more: afterMore.length, msg: (afterOne[0] || {}).msg || '' };
  });
  check('a hook that throws is removed by the frame loop itself, with a log line naming it, and it ' +
    'is then simply not there to be measured again',
    thrower.one === 1 && thrower.more === 1 &&
    /deliberate test error hook/.test(thrower.msg), JSON.stringify(thrower));

  /* =========================================================================
     6 — HEAP
     ====================================================================== */
  const heap = await ev(() => {
    const P = window.GigaHack.build.perf;
    const exposed = !!(window.performance && window.performance.memory);
    const m = P.memory();
    return { exposed: exposed, available: m.available, used: m.usedMB, why: m.why };
  });
  check('heap usage is reported exactly where the build exposes the measurement, and read in ' +
    'megabytes rather than the bucketed raw figure',
    heap.available === heap.exposed &&
    (!heap.exposed || (typeof heap.used === 'number' && heap.used > 0)), JSON.stringify(heap));

  const heapGone = await ev(() => {
    const G = window.GigaHack, P = G.build.perf;
    const had = !!(window.performance && window.performance.memory);
    Object.defineProperty(performance, 'memory', { get: function () { return undefined; }, configurable: true });
    const m = P.memory();
    const reset = P.resetHeapBaseline();
    G.cfg.ui.tab = 'debug'; G.cfg.ui.sub.debug = 'Performance'; G.ui.setOpen(true); G.ui.rerender();
    const text = (document.querySelector('#mm-root .mm-win') || {}).textContent || '';
    delete performance.memory;
    return {
      had: had, available: m.available, why: m.why, reset: reset,
      saysAbsent: /HEAP NOT EXPOSED/.test(text) && /does not report heap usage/.test(text),
      seriesGone: /The heap series is not offered/.test(text),
      back: !!(window.performance && window.performance.memory)
    };
  });
  check('where the build does not expose heap usage the panel says the measurement is absent and ' +
    'why, rather than drawing an empty gauge',
    heapGone.available === false && /extension to the timing API/.test(heapGone.why) &&
    heapGone.saysAbsent === true && heapGone.reset.ok === false, JSON.stringify(heapGone).slice(0, 200));
  check('and the heap series is dropped from the chart with a stated reason rather than plotting ' +
    'a line of nothing',
    heapGone.seriesGone === true && heapGone.back === heapGone.had, JSON.stringify(heapGone).slice(0, 160));

  /* =========================================================================
     7 — THE SCENE GRAPH
     ====================================================================== */
  const scene = await ev(() => {
    const P = window.GigaHack.build.perf;
    const walksBefore = P.sceneWalks();
    window.__buildFrames(30);
    const walksAfterFrames = P.sceneWalks();
    const a = P.sceneGraph();
    const b = P.sceneGraph();
    return {
      walksBefore: walksBefore, walksAfterFrames: walksAfterFrames, walksNow: P.sceneWalks(),
      a: a, b: b,
      liveScene: SceneManager._scene.constructor.name
    };
  });
  check('the scene-graph count is taken on demand and never per frame — walking it every frame ' +
    'would be the exact cost this panel exists to report',
    scene.walksBefore === scene.walksAfterFrames && scene.walksNow === scene.walksBefore + 2,
    JSON.stringify({ b: scene.walksBefore, f: scene.walksAfterFrames, n: scene.walksNow }));
  check('counting twice with nothing changed gives the same number, and every node counted lands ' +
    'in exactly one of the by-role buckets',
    scene.a.nodes === scene.b.nodes && scene.a.depth === scene.b.depth &&
    scene.a.nodes >= 1 &&
    scene.a.windows + scene.a.sprites + scene.a.containers + scene.a.other === scene.a.nodes,
    JSON.stringify({ a: scene.a.nodes, b: scene.b.nodes, roles: [scene.a.windows, scene.a.sprites, scene.a.containers, scene.a.other] }));
  check('the scene name is printed as the build reports it, never replaced with a friendlier ' +
    'invented one — some plugin suites are identifier-obfuscated',
    scene.a.scene === scene.liveScene && scene.a.byClass[scene.liveScene] === 1,
    scene.a.scene + ' / ' + scene.liveScene);

  const capped = await ev(() => {
    const G = window.GigaHack, P = G.build.perf;
    window.__buildCfg('build.perf.sceneNodeCap', 100);
    window.__buildCfg('build.perf.sceneDepthCap', 4);
    /* A cycle is what an uncapped walk turns into an infinite loop over, and
       a plugin can make one. The walk follows `children` only and stops. */
    const root = SceneManager._scene;
    const a = { children: [] }, b = { children: [a] };
    a.children.push(b);
    root.children.push(b);
    const walk = P.sceneGraph();
    root.children.pop();
    window.__buildCfg('build.perf.sceneNodeCap', 20000);
    window.__buildCfg('build.perf.sceneDepthCap', 64);
    const free = P.sceneGraph();
    return { walk: walk, free: free };
  });
  check('the scene walk stops at its node and depth caps and says the number is a floor, rather ' +
    'than following a cycle a plugin created',
    capped.walk.capped === true && /floor, not a total/.test(capped.walk.cappedWhy) &&
    capped.walk.nodes <= 100 && capped.walk.depth <= 4 && capped.free.capped === false,
    JSON.stringify({ nodes: capped.walk.nodes, depth: capped.walk.depth, why: capped.walk.cappedWhy }));

  /* =========================================================================
     8 — TEXTURE AND IMAGE CACHES
     ====================================================================== */
  const caches = await ev(() => {
    const P = window.GigaHack.build.perf;
    const rows = P.caches();
    const byName = {};
    rows.forEach(r => { byName[r.name] = r; });
    /* Computed from the live cache, not written down: the fixture's sizes are
       the fixture's business and a literal here would pin the wrong thing. */
    let want = 0, n = 0;
    for (const k in PIXI.utils.TextureCache) {
      if (!Object.prototype.hasOwnProperty.call(PIXI.utils.TextureCache, k)) continue;
      const t = PIXI.utils.TextureCache[k];
      want += t.width * t.height * 4; n++;
    }
    return {
      names: rows.map(r => r.name),
      present: rows.filter(r => r.present).map(r => r.name),
      absent: rows.filter(r => !r.present).map(r => r.name),
      everyEstimated: rows.every(r => r.estimated === true),
      absentWhy: rows.filter(r => !r.present).map(r => r.why),
      textures: byName['renderer textures'],
      wantBytes: want, wantEntries: n,
      hasFlat: !!ImageManager._cache,
      hasBudgeted: !!(ImageManager._imageCache && ImageManager._imageCache._items)
    };
  });
  check('every texture and image cache is listed by name on every build, and one this build does ' +
    'not have is shown as absent rather than dropped from the list',
    caches.names.length === 5 && caches.absent.length >= 1 &&
    caches.absent.length + caches.present.length === 5 &&
    caches.absentWhy.every(w => /not present on this build/.test(w)),
    JSON.stringify({ present: caches.present, absent: caches.absent }));
  check('the two caches only one engine keeps are present exactly on the engine that has one, and ' +
    'the module decides that by probing the cache rather than by asking which engine it is',
    caches.present.indexOf('images by count') > -1 === caches.hasFlat &&
    caches.present.indexOf('images by bytes') > -1 === caches.hasBudgeted &&
    caches.hasFlat !== caches.hasBudgeted &&
    caches.hasFlat === IS_MZ && caches.hasBudgeted === IS_MV &&
    !/isMV|isMZ|RPGMAKER/.test(NAKED),
    JSON.stringify({ flat: caches.hasFlat, budgeted: caches.hasBudgeted, present: caches.present }));
  check('the byte figure is derived from the bitmap dimensions the build exposes and is labelled ' +
    'an estimate, never presented as a measurement',
    caches.everyEstimated === true && caches.textures.present === true &&
    caches.textures.entries === caches.wantEntries && caches.textures.bytes === caches.wantBytes,
    JSON.stringify(caches.textures) + ' want=' + caches.wantBytes);

  const flush = await ev(() => {
    const P = window.GigaHack.build.perf;
    const before = P.flushes();
    ImageManager.clear();
    const after = P.flushes();
    return { before: before, after: after };
  });
  check('clearing the image cache is counted, so a count that drops between two looks has ' +
    'something beside it that says why',
    flush.before.available === true && flush.after.count === flush.before.count + 1,
    JSON.stringify(flush));

  /* =========================================================================
     9 — THE PLUGIN LIST, ITS KEYS, AND THE EVIDENCE FOR A LIVE EDIT

     The read count comes first, before anything in this file has asked the
     engine's reader for anything: a check that read the table to look at it
     and then asserted "nothing has read it" would be asserting its own
     footprint.
     ====================================================================== */
  const notSeen = await ev(() => {
    const PM = window.GigaHack.build.params;
    const e = PM.entries().rows.filter(r => r.name === 'battle_hud_3')[0];
    return { reads: e.reads, effect: PM.effect(e), why: PM.effectWhy(e), live: e.params[0].live };
  });
  check('a read count of zero reads as "not seen", never as "reads once" — every read before this ' +
    'module loaded happened before it existed',
    notSeen.reads === 0 && notSeen.effect === 'not seen' && notSeen.live === false &&
    /not seen re-reading since this module loaded/.test(notSeen.why) &&
    !/reads once/.test(notSeen.why), JSON.stringify(notSeen));

  const live = await ev(() => {
    const G = window.GigaHack, PM = G.build.params;
    let e = PM.entries().rows.filter(r => r.name === 'battle_hud_3')[0];
    const wasEffect = PM.effect(e);
    /* Exactly what a plugin that re-reads its own parameters does. */
    PluginManager.parameters('battle_hud_3');
    e = PM.entries().rows.filter(r => r.name === 'battle_hud_3')[0];
    return {
      wasEffect: wasEffect, effect: PM.effect(e), reads: e.reads, why: PM.effectWhy(e),
      live: e.params[0].live, lastFrame: e.lastRead
    };
  });
  check('a row for an entry seen re-reading since this module loaded says the edit takes effect, ' +
    'and every other row says it is recorded and not known to be in effect',
    live.wasEffect === 'not seen' && live.effect === 'live' && live.reads === 1 &&
    live.live === true && /takes effect on its next read/.test(live.why) &&
    typeof live.lastFrame === 'number', JSON.stringify(live));

  const keys = await ev(() => {
    const G = window.GigaHack, PM = G.build.params;
    const src = PM.entries();
    const bad = [];
    const table = PluginManager._parameters;
    src.rows.forEach(e => {
      if (!e.status) return;
      if (e.duplicateOf !== null && e.duplicateOf !== undefined) return;
      /* The key is right only if the engine's own table holds it AND the
         engine's own reader answers with the object the entry declared. */
      if (!e.key || !Object.prototype.hasOwnProperty.call(table, e.key)) { bad.push(e.name + ':no key'); return; }
      const own = $plugins[e.index].parameters;
      if (own !== undefined && PluginManager.parameters(e.key) !== own) bad.push(e.name + ':wrong object');
    });
    const sub = src.rows.filter(e => e.name.indexOf('/') > -1)[0] || null;
    return {
      bad: bad,
      sub: sub && {
        name: sub.name, key: sub.key, registered: sub.registered, params: sub.params.length,
        holdsSame: PluginManager.parameters(sub.key) === $plugins[sub.index].parameters,
        keyIsWholeName: sub.key === sub.name.toLowerCase(),
        keyIsBasename: sub.key === sub.name.split('/').pop().toLowerCase()
      }
    };
  });
  check('every enabled entry resolves to the key the engine registered it under, proved by asking ' +
    'the engine\'s own reader for the object the entry declared',
    keys.bad.length === 0, keys.bad.slice(0, 4).join(' | '));
  check('including an entry that lives in a subfolder, whose key is the whole entry on one build ' +
    'and the part after the last slash on the other, and is found on both without asking which',
    !!keys.sub && keys.sub.registered === true && keys.sub.params === 3 &&
    keys.sub.holdsSame === true && (keys.sub.keyIsWholeName !== keys.sub.keyIsBasename),
    JSON.stringify(keys.sub));
  const splits = (CODE.match(/\.split\([^)]*\)/g) || []);
  check('the key is resolved by splitting the name on a forward slash only, because the engine\'s ' +
    'own splitter does — splitting on a backslash too would compute a key it never used',
    splits.length === 1 && splits[0] === ".split('/')", splits.join(' | '));

  const shapes = await ev(() => {
    const G = window.GigaHack, PM = G.build.params;
    const src = PM.entries();
    const off = src.rows.filter(e => !e.status && e.params.length)[0] || null;
    const dups = src.rows.filter(e => e.duplicateOf !== null && e.duplicateOf !== undefined);
    const dup = dups[0] || null;
    const keeper = dup ? src.rows.filter(e => e.index === dup.duplicateOf)[0] : null;
    const noParams = src.rows.filter(e => $plugins[e.index] && $plugins[e.index].parameters === undefined)[0] || null;
    return {
      off: off && {
        name: off.name, effect: PM.effect(off), editable: PM.editable(off),
        params: off.params.length, why: PM.effectWhy(off),
        refuse: PM.set(off, off.params[0].name, 'nope')
      },
      dupCount: dups.length,
      dup: dup && { name: dup.name, of: dup.duplicateOf, effect: PM.effect(dup), why: PM.effectWhy(dup), params: dup.params.length },
      keeper: keeper && { name: keeper.name, effect: PM.effect(keeper), dupOf: keeper.duplicateOf },
      noParams: noParams && { name: noParams.name, params: noParams.params.length, effect: PM.effect(noParams), why: PM.effectWhy(noParams) }
    };
  });
  check('an entry that is off in the game plugin list is still shown with its parameters, marked ' +
    'as never registered, and its value cannot be edited',
    !!shapes.off && shapes.off.params === 2 && shapes.off.effect === 'off' &&
    shapes.off.editable === false && shapes.off.refuse.ok === false &&
    /off in the game plugin list/.test(shapes.off.refuse.why), JSON.stringify(shapes.off).slice(0, 220));
  check('two entries claiming one name are both shown, and the second says the engine kept the ' +
    'first and dropped it with no error',
    shapes.dupCount === 1 && !!shapes.dup && shapes.dup.effect === 'name taken' &&
    /kept the first/.test(shapes.dup.why) && shapes.dup.params === 2 &&
    !!shapes.keeper && shapes.keeper.dupOf === null && shapes.keeper.effect !== 'name taken',
    JSON.stringify(shapes.dup) + ' | ' + JSON.stringify(shapes.keeper));
  check('the table survives an entry with no parameters object at all, and says the engine holds ' +
    'the name with nothing under it rather than blaming the parameter table',
    !!shapes.noParams && shapes.noParams.params === 0 &&
    shapes.noParams.effect === 'not registered' &&
    /no parameter object under it/.test(shapes.noParams.why), JSON.stringify(shapes.noParams));

  const hole = await ev(() => {
    const PM = window.GigaHack.build.params;
    const before = PM.entries();
    const kept = $plugins[3];
    delete $plugins[3];                       // a real hole, not an undefined value
    const errsBefore = window.GigaHack.logHistory().filter(e => e.level === 'err').length;
    const withHole = PM.entries();
    const rows = PM.rows({ q: '', filter: 'all', showEmpty: true }).length;
    const errs = window.GigaHack.logHistory().filter(e => e.level === 'err').length - errsBefore;
    $plugins[3] = kept;
    return {
      before: before.rows.length, holesBefore: before.holes,
      after: withHole.rows.length, holes: withHole.holes, total: withHole.total,
      rows: rows, errs: errs, restored: PM.entries().rows.length
    };
  });
  check('a hole in the game plugin list is counted and skipped rather than thrown on — a list ' +
    'edited by hand really does carry one',
    hole.holesBefore === 0 && hole.holes === 1 && hole.after === hole.before - 1 &&
    hole.errs === 0 && hole.rows > 0 && hole.restored === hole.before, JSON.stringify(hole));

  /* =========================================================================
     10 — EDITING
     ====================================================================== */
  const roundTrip = await ev(() => {
    const G = window.GigaHack, PM = G.build.params;
    const e = PM.entries().rows.filter(r => r.name === 'ui_frame_0')[0];
    const held = PluginManager._parameters[e.key];     // what a plugin captured at load
    const before = held['Slots'];
    const undoBefore = G.undo.size();

    /* A spy over the engine's own reader, so "verified by reading it back the
       way a plugin reads it" is proved rather than asserted. */
    let readCalls = 0;
    const real = PluginManager.parameters;
    const countedBefore = PM.reads(e.key).calls;
    PluginManager.parameters = function (n) { readCalls++; return real.apply(this, arguments); };
    const r = PM.set(e, 'Slots', '["a","b"]');
    PluginManager.parameters = real;

    const after = PluginManager._parameters[e.key]['Slots'];
    const mirrored = $plugins[e.index].parameters['Slots'];
    let parsed = null;
    try { parsed = JSON.parse(after); } catch (x) { parsed = 'threw'; }
    const readsCounted = PM.reads(e.key).calls - countedBefore;

    G.undo.pop();
    return {
      r: { ok: r.ok, title: r.title },
      verified: !!(r.verify && r.verify.got === '["a","b"]'),
      sameObject: PluginManager._parameters[e.key] === held,
      before: before, after: after, mirrored: mirrored,
      type: typeof after, parsed: parsed,
      readCalls: readCalls, readsCounted: readsCounted,
      undoBefore: undoBefore, undoAfter: G.undo.size(),
      restored: PluginManager._parameters[e.key]['Slots'],
      restoredMirror: $plugins[e.index].parameters['Slots']
    };
  });
  check('a parameter value is committed as a string, so text a plugin parses as JSON survives a ' +
    'round trip unchanged',
    roundTrip.r.ok === true && roundTrip.type === 'string' &&
    roundTrip.after === '["a","b"]' && JSON.stringify(roundTrip.parsed) === '["a","b"]',
    JSON.stringify(roundTrip).slice(0, 200));
  check('the edit mutates the parameter object the engine already holds, in place, so a plugin ' +
    'that captured that object at load reads the new value on its next call',
    roundTrip.sameObject === true && roundTrip.mirrored === '["a","b"]', JSON.stringify(roundTrip).slice(0, 200));
  check('the write is verified by reading it back through the engine\'s own reader, the way a ' +
    'plugin reads it, and this module\'s own read is not counted as a plugin re-reading',
    roundTrip.readCalls >= 1 && roundTrip.verified === true && roundTrip.readsCounted === 0,
    JSON.stringify({ spy: roundTrip.readCalls, countedDelta: roundTrip.readsCounted, got: roundTrip.verified }));
  check('an edit is undoable, and undoing it writes back the exact string that was there, in both ' +
    'the engine table and the game plugin list',
    roundTrip.undoAfter === roundTrip.undoBefore &&
    roundTrip.restored === roundTrip.before && roundTrip.restoredMirror === roundTrip.before,
    JSON.stringify({ was: roundTrip.before, now: roundTrip.restored, mirror: roundTrip.restoredMirror }));

  const badJson = await ev(() => {
    const G = window.GigaHack, PM = G.build.params;
    const e = PM.entries().rows.filter(r => r.name === 'ui_frame_0')[0];
    const before = PluginManager._parameters[e.key]['Colours'];
    const undo = G.undo.size();
    const r = PM.set(e, 'Colours', 'not json at all');
    /* Plain text that was never JSON is not JSON-guarded — the rule is about
       a value that stops parsing, not about every value. */
    const plain = PM.set(e, 'Menu Label', 'Bag');
    const plainAfter = PluginManager._parameters[e.key]['Menu Label'];
    if (plain.ok) G.undo.pop();
    return {
      r: { ok: r.ok, title: r.title, why: r.why },
      after: PluginManager._parameters[e.key]['Colours'], before: before,
      undoUnchanged: G.undo.size() === undo,
      plainOk: plain.ok, plainNow: PluginManager._parameters[e.key]['Menu Label'], plainWas: plainAfter
    };
  });
  check('an edit that would leave a JSON-text parameter unparseable is refused, names the ' +
    'parameter it would have broken, and changes nothing',
    badJson.r.ok === false && badJson.r.title === 'NOT VALID JSON' &&
    /^Colours is JSON text/.test(badJson.r.why) && badJson.after === badJson.before &&
    badJson.undoUnchanged === true, JSON.stringify(badJson.r));
  check('a parameter that was never JSON is not held to that rule, so plain text stays editable',
    badJson.plainOk === true && badJson.plainWas === 'Bag' && badJson.plainNow === 'Items',
    JSON.stringify({ ok: badJson.plainOk, during: badJson.plainWas, after: badJson.plainNow }));

  const readOnly = await ev(() => {
    const G = window.GigaHack, PM = G.build.params;
    const e = PM.entries().rows.filter(r => r.name === 'battle_hud_3')[0];
    const before = PluginManager._parameters[e.key]['Rows'];
    window.__buildCfg('behaviour.readonly', true);
    const r = PM.set(e, 'Rows', '9');
    const after = PluginManager._parameters[e.key]['Rows'];
    window.__buildCfg('behaviour.readonly', false);
    const log = G.logHistory().slice(-6).filter(l => /read-only: blocked/.test(l.msg));
    return { ok: r.ok, title: r.title, why: r.why, before: before, after: after, named: (log[0] || {}).msg || '' };
  });
  check('read-only mode refuses a parameter edit, names the parameter and the entry it refused, ' +
    'and leaves the value alone',
    readOnly.ok === false && readOnly.title === 'READ-ONLY' && readOnly.after === readOnly.before &&
    /Rows/.test(readOnly.named) && /battle_hud_3/.test(readOnly.named), JSON.stringify(readOnly));

  const discarded = await ev(() => {
    const G = window.GigaHack, PM = G.build.params;
    const e = PM.entries().rows.filter(r => r.name === 'battle_hud_3')[0];
    const held = PluginManager._parameters[e.key];
    const undo = G.undo.size();
    PM.set(e, 'Layout', 'wide');
    const beforeReReg = PM.discarded().length;
    /* Re-registering the same name is what a loader that re-runs the whole
       setup does; the object under the key is replaced and every edit into
       the old one goes with it. Handed the SAME object here, so the fixture
       is left exactly as it was and only the notice is exercised. */
    PluginManager.setParameters('battle_hud_3', held);
    const after = PM.discarded();
    G.undo.pop();
    return {
      before: beforeReReg, count: after.length,
      frame: after.length ? after[0].discardedFrame : null,
      param: after.length ? after[0].param : null,
      edits: PM.edits().length,
      value: PluginManager._parameters[e.key]['Layout'], undo: undo, undoNow: G.undo.size()
    };
  });
  check('an edit whose parameter object is later re-registered wholesale is reported as discarded, ' +
    'with the frame it happened on, rather than left showing as applied',
    discarded.before === 0 && discarded.count === 1 && discarded.param === 'Layout' &&
    typeof discarded.frame === 'number' && discarded.value === 'compact' &&
    discarded.undoNow === discarded.undo, JSON.stringify(discarded));

  const degrade = await ev(() => {
    const G = window.GigaHack;
    /* A write the engine refuses, so the control really is marked rather than
       having the mark simulated. */
    G.compat.verify('plugin.param', function () { }, function () { return 'x'; }, 'y');
    G.cfg.ui.tab = 'debug'; G.cfg.ui.sub.debug = 'Parameters';
    window.__buildCfg('build.params.q', 'battle_hud');
    G.ui.setOpen(true); G.ui.rerender();
    const cells = document.querySelectorAll('#mm-root .mm-tr .mm-td-val');
    const first = cells[0] || null;
    const out = {
      degraded: G.compat.isDegraded('plugin.param'),
      cells: cells.length,
      opacity: first ? first.style.opacity : '',
      tip: first ? (first.getAttribute('data-mm-tip') || '') : '',
      disabled: first ? first.classList.contains('mm-dis') : true,
      gated: first ? first.classList.contains('mm-gated') : false,
      says: /writes here are not sticking/.test(
        (document.querySelector('#mm-root .mm-win') || {}).textContent || '')
    };
    G.compat.clearDegraded('plugin.param');
    return out;
  });
  check('a degraded parameter control is marked with the reason and stays pressable, so the user ' +
    'can prove the reason has gone away',
    degrade.degraded === true && degrade.cells >= 1 && degrade.opacity === '0.55' &&
    /^Not sticking\|/.test(degrade.tip) && degrade.disabled === false &&
    degrade.gated === true && degrade.says === true, JSON.stringify(degrade).slice(0, 220));

  /* =========================================================================
     10b — LIVE

     The reads column is the only evidence anywhere that a plugin looks at its
     parameters again after load — a counter that ticks while the game runs,
     and it was painted once. Driven through the shell's own 700ms hook list,
     because that is the clock the panel now runs on.
     ====================================================================== */
  const paramLive = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};

    window.__buildCfg('build.params.q', 'battle_hud');
    U.setOpen(true);
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.debug = 'Parameters';
    U.rerender();

    const table = document.querySelector('#mm-root .mm-table');
    /* The reads cell of the first row by column index, not by reading the row
       as one string: the value beside it is the project's own and could be any
       number at all. */
    const cellOf = (i) => {
      const tr = table.mm.body.querySelector('.mm-tr');
      return tr ? tr.children[i].textContent : '';
    };
    out.rows = table.mm.rows().length;
    out.readsAtBuild = cellOf(3);
    out.effectAtBuild = cellOf(4);

    const firstRow = table.mm.body.querySelector('.mm-tr');
    tick();
    out.idleKeptTheSameNode = table.mm.body.querySelector('.mm-tr') === firstRow;

    /* Exactly what a plugin that re-reads its own parameters does. */
    PluginManager.parameters('battle_hud_3');
    out.readsBeforeTick = cellOf(3);
    tick();
    out.readsAfterTick = cellOf(3);
    out.effectAfterTick = cellOf(4);
    out.sameTable = document.querySelector('#mm-root .mm-table') === table;

    window.__buildCfg('build.params.q', '');
    U.setOpen(false);
    return out;
  });
  check('a plugin re-reading its parameters while the Parameters panel is open moves the reads ' +
    'column, without the panel being rebuilt',
    paramLive.rows > 0 && paramLive.idleKeptTheSameNode === true &&
    paramLive.readsBeforeTick === paramLive.readsAtBuild &&
    Number(paramLive.readsAfterTick) === Number(paramLive.readsAtBuild) + 1 &&
    paramLive.sameTable === true && paramLive.effectAfterTick === 'live',
    JSON.stringify(paramLive));

  /* =========================================================================
     11 — THE PANELS
     ====================================================================== */
  await ev(() => { window.__buildCfg('build.params.q', ''); });
  const paramsText = await render('Parameters');
  check('the parameters panel states the limit on live editing before it shows a single row',
    /Most plugins read their parameters once, at load/.test(paramsText) &&
    /never looks again/.test(paramsText) &&
    /never "reads once"/.test(paramsText) &&
    /lasts until the game is relaunched/.test(paramsText) &&
    paramsText.indexOf('Most plugins read their parameters once') < paramsText.indexOf('parametervalue'),
    paramsText.slice(paramsText.indexOf('What an edit'), paramsText.indexOf('What an edit') + 120));

  const order = await ev(() => {
    const heads = document.querySelectorAll('#mm-root .mm-col .mm-group-hd span');
    return heads.length ? heads[0].textContent : '';
  });
  check('and that limit is the first thing on the panel, not a footnote under the table',
    order === 'What an edit can and cannot do', order);

  await shot('build-parameters');

  const perfText = await render('Performance');
  check('the performance panel labels its three counters as three different questions rather than ' +
    'presenting any of them as the frame rate',
    /engine fps/.test(perfText) && /logical steps\/s/.test(perfText) && /engine frames\/s/.test(perfText) &&
    /Three different questions/.test(perfText), perfText.slice(0, 120));
  check('and it says the byte figures are an estimate, and — with the list published and timing ' +
    'off — points at the toggle rather than at the build, which is the other half of the same ' +
    'distinction',
    /Bytes are an ESTIMATE/.test(perfText) &&
    /not present on this build/.test(perfText) &&
    /turn it on above/.test(perfText) &&
    !/does not publish its per-frame list/.test(perfText), perfText.slice(0, 120));
  await shot('build-performance');

  /* The body is built DETACHED, where clientWidth is 0 and a canvas painted
     at zero width paints nothing and reports no error. */
  const chart = await ev(async () => {
    const G = window.GigaHack, P = G.build.perf;
    const canvas = document.querySelector('#mm-root canvas');
    const a = P.chartState();
    await new Promise(r => setTimeout(r, 820));
    const b = P.chartState();
    const sized = canvas ? { w: canvas.width, cw: canvas.clientWidth } : null;
    G.ui.setOpen(false);                       // the whole window loses its box
    await new Promise(r => setTimeout(r, 820));
    const c = P.chartState();
    G.ui.setOpen(true);
    return { a: a, b: b, c: c, sized: sized };
  });
  check('the chart draws only once the panel is in the document with a width, and refuses rather ' +
    'than painting into the zero width a detached or hidden body reports',
    !!chart.sized && chart.sized.w === chart.sized.cw && chart.sized.w > 0 &&
    chart.b.drawn > chart.a.drawn &&
    chart.c.drawn === chart.b.drawn && chart.c.refusedDetached > chart.b.refusedDetached,
    JSON.stringify(chart));

  const report = await ev(() => window.GigaHack.build.reportText());
  check('the pasteable report carries every figure and every reason, so a bug report needs neither ' +
    'a screenshot nor a working renderer',
    /frame total/.test(report) && /per-frame hooks/.test(report) &&
    /ESTIMATE/.test(report) && /registration key/.test(report) &&
    /scene/.test(report) && report.split('\n').length > 15, report.split('\n').length + ' lines');
  check('and the report says per-hook cost is untimed because the toggle is off, naming how many ' +
    'hooks the list holds either way, rather than saying the build cannot do it',
    /per-frame hooks\s+: \d+ in the list, none timed/.test(report) &&
    /per-hook timing is off/.test(report) &&
    !/does not publish its per-frame list/.test(report),
    (report.split('\n').filter(l => /^per-frame hooks/.test(l))[0] || ''));

  const logRing = await ev(() => {
    const G = window.GigaHack, P = G.build.perf;
    const v = P.logVolume();
    return {
      v: v, held: G.logHistory().length, cap: G.logCapacity(), dropped: G.logDropped(),
      line: (G.build.reportText().split('\n').filter(l => /^log ring/.test(l))[0] || '')
    };
  });
  check('the report says how much of the log ring is held and how much has already rolled off the ' +
    'front of it, because the ring is what a bug report is pasted out of and what rolled off is ' +
    'in no report taken afterwards',
    logRing.v.available === true && logRing.v.held === logRing.held &&
    logRing.v.capacity === logRing.cap && logRing.v.dropped === logRing.dropped &&
    logRing.v.rolled === (logRing.dropped > 0) &&
    new RegExp('of ' + logRing.cap + ' lines held').test(logRing.line),
    logRing.line);

  /* =========================================================================
     12 — WHAT THE MODULE MAY NOT SAY OR DO
     ====================================================================== */
  check('no line of this module branches on the engine version or the engine name — every ' +
    'difference is asked of a capability or probed on the object itself',
    !/RPGMAKER_VERSION|RPGMAKER_NAME/.test(NAKED) &&
    !/caps\s*\.\s*(isMV|isMZ|engineVersion)/.test(NAKED) &&
    !/\bengine\s*===/.test(NAKED),
    (NAKED.match(/caps\s*\.\s*\w+/g) || []).join(' '));
  check('and it never reads a frame-rate counter by name, because a plugin that replaces the ' +
    'renderer takes both of them away and only the adapter knows that',
    !/_fpsCounter|_fpsMeter/.test(NAKED), (NAKED.match(/_fps\w+/g) || []).join(' '));
  check('and it never reaches for the engine\'s own main loop, which cannot be wrapped on every ' +
    'build without terminating it',
    !/updateMain/.test(NAKED), (NAKED.match(/\w*updateMain\w*/g) || []).join(' '));
  check('no string in this module names a plugin, a game, an edition or an engine version',
    !/\b(YEP_|VisuMZ_|MOG_|SRD_|Olivia_|HIME_|TDDP_|Galv)/.test(LITERALS) &&
    !/RPG\s*Maker|\bMV\b|\bMZ\b/.test(LITERALS) &&
    !/star\s*knightess|aura\s*mz/i.test(LITERALS),
    (LITERALS.match(/\bMV\b|\bMZ\b|RPG\s*Maker/g) || []).join(' '));
  check('every engine alias it installs goes through the hook registry with a reason for the build ' +
    'that lacks the target, and none is a bare prototype assignment',
    /\$\.install\(HOOK_FRAME/.test(NAKED) && /\$\.install\(HOOK_PARAMS/.test(NAKED) &&
    /\$\.install\(HOOK_SETPARAMS/.test(NAKED) && /\$\.install\(HOOK_IMGCLEAR/.test(NAKED) &&
    !/\.prototype\.\w+\s*=\s*function/.test(NAKED),
    (NAKED.match(/\$\.install\(\w+/g) || []).join(' '));

  const hookReasons = await ev(() => {
    const G = window.GigaHack;
    return ['GigaHack.frame (frame cost)', 'PluginManager.parameters (read counter)',
      'PluginManager.setParameters (re-registration)', 'ImageManager.clear (cache flushes)']
      .map(n => ({ n: n, i: !!(G.hooks[n] || {}).installed, r: (G.hooks[n] || {}).reason || '' }));
  });
  check('all four of this module\'s aliases install on this build, and each was given a reason ' +
    'written for the build where its target is absent rather than a bare "not found"',
    hookReasons.every(hh => hh.i === true) &&
    /the per-frame entry point is absent/.test(LITERALS) &&
    /parameter reader is not a function on this build/.test(LITERALS) &&
    /parameter registrar is absent/.test(LITERALS) &&
    /the image cache has no clear on this build/.test(LITERALS),
    JSON.stringify(hookReasons.map(hh => hh.n + '=' + hh.i)));

  /* =========================================================================
     13 — PUT EVERYTHING BACK
     ====================================================================== */
  const restored = await ev(() => {
    const G = window.GigaHack, k = window.__buildKeep;
    G.build.params.revertAll();
    while (G.undo.size() > k.undo) G.undo.pop();
    G.build.perf.setTiming(false);
    G.build.perf.resetSamples();
    G.build.perf.resetFrameCost();
    if (G.compat.isDegraded('plugin.param')) G.compat.clearDegraded('plugin.param');
    if (G.compat.isDegraded('build.frameHook')) G.compat.clearDegraded('build.frameHook');
    if (k.hadCfg) G.cfg.build = JSON.parse(k.cfg); else delete G.cfg.build;
    window.__buildCfg('behaviour.readonly', k.readonly);
    G.cfg.ui.tab = k.tab;
    G.cfg.ui.sub = JSON.parse(k.sub);
    G.ui.setOpen(k.open);
    G.ui.rerender();
    return {
      params: JSON.stringify(PluginManager._parameters) === k.params,
      edits: G.build.params.edits().length,
      undo: G.undo.size() === k.undo,
      /* Compared against what it was, not against undefined: `build` is a
         DEFAULTS node now, so it is legitimately an object before this check
         runs. The invariant is that the module left it as it found it. */
      cfg: JSON.stringify(G.cfg.build === undefined ? null : G.cfg.build) === k.cfg,
      readonlyBack: !!(G.cfg.behaviour && G.cfg.behaviour.readonly) === k.readonly,
      onFrame: G.onFrame === k.onFrame && G.offFrame === k.offFrame,
      /* Against what it was, never against undefined: the frame loop publishes
         its registry on this build, so the invariant is that the accessor, the
         hooks in it and the function inside each one are the ones found. */
      frameHooks: G.frameHooks === k.frameHooks,
      hookNames: G.frameHooks().map(e => e.name).sort().join(' | ') === k.hookNames,
      unwrapped: G.frameHooks().every(e => e.fn === e.orig),
      pm: PluginManager.parameters === k.pmParameters && PluginManager.setParameters === k.pmSetParameters,
      alias: G.hooks['GigaHack.offFrame (hook timing)'] === undefined,
      degraded: G.compat.isDegraded('plugin.param') || G.compat.isDegraded('build.frameHook'),
      timing: G.build.perf.timing(),
      memory: !!(window.performance && window.performance.memory)
    };
  });
  check('build leaves the game exactly as it found it — every parameter back to its own string, ' +
    'no session edit, no undo entry, no probe left in the frame loop, no hook in it still wrapped ' +
    'and no setting of its own left behind',
    restored.params && restored.edits === 0 && restored.undo && restored.cfg &&
    restored.readonlyBack && restored.onFrame && restored.frameHooks &&
    restored.hookNames && restored.unwrapped &&
    restored.pm && restored.alias && restored.degraded === false && restored.timing === false,
    JSON.stringify(restored));

  await ev(() => {
    delete window.__buildKeep;
    delete window.__buildFrames;
    delete window.__buildCfg;
  });
};
