/* =============================================================================
   GigaHack test harness — checks/auto.js
   GigaHack_Auto: run something when the game reaches a state; run splits.

   Two claims, and the checks are shaped by which one is being made.

   The TRIGGER claims are about refusal: a trigger that writes what it watches,
   two that write each other's condition, one that throws, one whose snippet was
   deleted. Every one of those is driven through a REAL write on a REAL switch
   so the edge arrives the way the game would deliver it — a check that called
   $.auto.fire() by hand and asserted a count would pass against a module that
   never observed anything.

   The ROUTE claims are about a clock this module does not own and cannot
   assume. Where the engine's frame counter ticks differs between builds and
   nothing in its name says so, so every clock check here MEASURES the harness
   independently and asserts that the module reports the same number — never
   that a named engine behaves a particular way. Where the two engines genuinely
   differ, the check asserts the difference in the direction the pause gate that
   actually installed implies, and says which build it is looking at.

   State discipline: the engine clock, every switch, variable, setting, snippet,
   trigger, route and the game title this file touches are captured up front and
   put back at the end, and the last block asserts that they really were.
   ========================================================================== */
module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page, shot = ctx.shot;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ, MODDED = ctx.MODDED;

  /* Every switch and variable id this file writes. High enough to sit clear of
     the fixture's own seeded rows and still inside the 1100/1400 tables. */
  const SW = [800, 810, 811, 812, 813, 814, 815, 820, 821, 822, 823, 824, 825, 826,
    830, 831, 832, 833, 834, 835];
  const VR = [900, 901];

  /* --- capture everything this file is about to disturb --------------------
     The snippet library is captured as a FILE and put back as one, rather than
     deleted entry by entry: every save and every delete rewrites it, and this
     file would otherwise contribute several dozen write lines to a log buffer
     four modules' checks are already sharing. */
  await ev(sw => {
    const G = window.GigaHack;
    window.__autoKeep = {
      snippetFile: G.store.read('snippets.json', null),
      toast: G.store.cfgGet('auto.triggers.toastOnFire', true),
      frameCount: Graphics.frameCount,
      framesOnSave: $gameSystem._framesOnSave,
      switches: sw.s.map(id => [id, $gameSwitches.value(id)]),
      vars: sw.v.map(id => [id, $gameVariables.value(id)]),
      mapId: $gameMap.mapId(),
      title: $dataSystem.gameTitle,
      switchNames: $dataSystem.switches,
      open: G.ui.isOpen(),
      tab: G.cfg.ui.tab,
      pause: !!(G.cfg.behaviour && G.cfg.behaviour.pauseGame),
      speedy: G.store.cfgGet('player.speedy', false),
      gameSpeed: G.store.cfgGet('player.gameSpeed', 1),
      snippets: G.console.snippets().map(s => s.id),
      churn: window.__churnVar
    };
    /* The rAF chain may have been left un-armed by an earlier block; every
       flush below depends on there being something queued. */
    if (!window.__raf.pending()) SceneManager.requestUpdate();

    /* One library, written once and re-read once. Six saveSnippet calls would
       be six rewrites of the same file and six lines in the shared log; a
       trigger only ever resolves a snippet by id, so the ids are chosen here
       and the file is put in place whole. A toast per fire is not what any
       check below is about either. */
    G.store.cfgSet('auto.triggers.toastOnFire', false);
    window.__autoSnips = {
      self: 'auto-check-self', alpha: 'auto-check-alpha', beta: 'auto-check-beta',
      thrower: 'auto-check-thrower', noop: 'auto-check-noop', big: 'auto-check-big'
    };
    G.store.write('snippets.json', {
      snippets: G.console.snippets().concat([
        { id: 'auto-check-self', name: 'auto-check-self', modified: 1,
          code: '$gameSwitches.setValue(820,false);$gameSwitches.setValue(820,true);"self"' },
        { id: 'auto-check-alpha', name: 'auto-check-alpha', modified: 1,
          code: '$gameSwitches.setValue(822,false);$gameSwitches.setValue(822,true);"a"' },
        { id: 'auto-check-beta', name: 'auto-check-beta', modified: 1,
          code: '$gameSwitches.setValue(821,false);$gameSwitches.setValue(821,true);"b"' },
        { id: 'auto-check-thrower', name: 'auto-check-thrower', modified: 1,
          code: 'throw new Error("deliberate test error — the trigger check makes this throw");' },
        { id: 'auto-check-noop', name: 'auto-check-noop', modified: 1, code: '"ran"' },
        { id: 'auto-check-big', name: 'auto-check-big', modified: 1,
          code: 'var s=""; for (var i=0;i<20000;i++) s+="x"; s;' }
      ])
    }, true);
    G.console.reload();
  }, { s: SW, v: VR });

  const render = async (tab, sub) => {
    await ev(p => {
      const G = window.GigaHack;
      G.ui.setOpen(true);
      G.cfg.ui.tab = p.tab;
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub[p.tab] = p.sub;
      G.ui.rerender();
    }, { tab, sub });
    await page.waitForTimeout(110);
    return await ev(() => {
      const r = document.querySelector('#mm-root .mm-win') || document.querySelector('#mm-root');
      return r ? r.textContent : '';
    });
  };

  /* =======================================================================
     1. THE CLOCK

     Nothing here is asserted from an engine name. Each block measures the
     harness itself and requires the module's published answer to agree.
     ==================================================================== */
  const whose = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.route.list().forEach(r => A.route.remove(r.id));
    const rt = A.route.create('clock-probe');
    A.route.addSplit(rt.id, { kind: 'switch', id: 834, on: true }, 'never reached');
    A.route.start('a check started it');
    for (let i = 0; i < 10; i++) window.__raf.flush();
    const before = { elapsed: A.route.elapsed(), gh: G.frameCount, engine: Graphics.frameCount };
    /* Move the ENGINE's clock and nothing else. Below auto.route.jumpFrames,
       so this is an ordinary advance rather than a discontinuity. */
    Graphics.frameCount += 120;
    const after = { elapsed: A.route.elapsed(), gh: G.frameCount, engine: Graphics.frameCount };
    return {
      before, after,
      reportedFrame: A.clock().frame,
      engineNow: Graphics.frameCount,
      ghNow: G.frameCount,
      grew: after.elapsed - before.elapsed,
      ghGrew: after.gh - before.gh
    };
  });
  check('the run clock is the engine\'s frame count and not GigaHack\'s own: moving the engine\'s number moves the run and moving nothing else does not',
    whose.grew === 120 && whose.ghGrew === 0 &&
    whose.reportedFrame === whose.engineNow && whose.reportedFrame !== whose.ghNow,
    JSON.stringify(whose));

  const held = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.clockReset();
    G.ui.setOpen(true);
    G.cfg.behaviour.pauseGame = true;
    const g0 = Graphics.frameCount;
    for (let i = 0; i < 12; i++) window.__raf.flush();
    const measuredHere = Graphics.frameCount - g0;
    G.cfg.behaviour.pauseGame = false;
    G.ui.setOpen(false);
    const c = A.clock();
    return {
      measuredHere,
      targets: c.gate.targets,
      insideGate: c.gate.insideGate,
      predictsStop: c.gate.predictsStop,
      moduleSteps: c.held.steps,
      moduleStops: c.held.stops,
      why: c.held.why,
      gateWhy: c.gate.why
    };
  });
  check('whether holding the game stops the run clock is MEASURED on this build, and the measurement agrees with what the pause gate that actually installed implies',
    held.moduleSteps >= 10 &&
    held.moduleStops === (held.measuredHere === 0) &&
    held.predictsStop === held.moduleStops &&
    held.insideGate === (held.targets.indexOf('SceneManager.updateMain') > -1),
    JSON.stringify(held));
  check('a build whose gate holds the whole main update stops the run clock while the game is held; one whose gate holds the three per-step functions leaves the draw running and does not',
    held.insideGate ? (held.measuredHere === 0 && /STOPS/.test(held.why))
      : (held.measuredHere === 12 && /KEEPS ADVANCING/.test(held.why)),
    (held.insideGate ? 'gate holds updateMain' : 'gate holds the per-step functions') +
    ' · engine clock moved ' + held.measuredHere + ' of 12');

  const ratio = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.clockReset();
    const g0 = Graphics.frameCount, f0 = G.frameCount;
    /* Push the clock ahead of the frame so the engine catches up more than one
       logical step inside a single animation frame — one draw, several steps. */
    for (let i = 0; i < 40; i++) { window.__advanceClock(2); window.__raf.flush(); }
    const engine = Graphics.frameCount - g0, steps = G.frameCount - f0;
    const c = A.clock();
    return {
      engine, steps, here: engine / steps,
      perStep: c.perStep, samples: c.samples, why: c.perStepWhy
    };
  });
  check('the clock-per-step ratio is a measurement over a rolling window, and it reports the number this build actually produced rather than printing 1',
    ratio.samples > 20 && Math.abs(ratio.perStep - ratio.here) < 0.08,
    JSON.stringify(ratio));
  check('a logical step the engine did not draw does not advance the run clock on a build that ticks it in the draw, and the panel names the draw as the reason',
    ratio.here < 0.85
      ? (/ticks the clock when it DRAWS/.test(ratio.why) && ratio.engine < ratio.steps)
      : (/one tick per logical step/.test(ratio.why) && ratio.engine === ratio.steps),
    ratio.here.toFixed(2) + ' — ' + ratio.why);

  const stall = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.clockReset();
    /* A scene that never becomes ready: updateScene will not start it, so
       isCurrentSceneStarted() stays false and a renderer gated on it is
       skipped. Nothing else about the frame changes. */
    const scene = SceneManager._scene;
    const keepReady = scene.isReady;
    scene.isReady = function () { return false; };
    SceneManager._sceneStarted = false;
    const g0 = Graphics.frameCount, f0 = G.frameCount;
    for (let i = 0; i < 12; i++) window.__raf.flush();
    const engine = Graphics.frameCount - g0, steps = G.frameCount - f0;
    scene.isReady = keepReady;
    SceneManager._sceneStarted = true;
    for (let i = 0; i < 3; i++) window.__raf.flush();
    return { engine, steps, started: SceneManager.isCurrentSceneStarted() };
  });
  check('the run clock stalls across a scene that has not started on the build whose draw is gated on it, and keeps counting on the build that ticks in the logical step — the difference is present exactly on the engine that has it',
    stall.steps >= 10 && stall.started === true &&
    (held.insideGate ? stall.engine === stall.steps : stall.engine === 0),
    JSON.stringify(stall) + ' · gate=' + (held.insideGate ? 'updateMain' : 'per-step'));

  /* =======================================================================
     2. TRIGGERS

     Every fire below arrives through a real write on a real switch.
     ==================================================================== */
  const self = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const t = A.addTrigger({
      when: { kind: 'switch', id: 820, on: true }, snippet: window.__autoSnips.self, name: 'self'
    });
    $gameSwitches.setValue(820, false);
    $gameSwitches.setValue(820, true);
    return { runs: A.trigger(t.id).runs, refusal: A.lastRefusal(), on: A.trigger(t.id).on };
  });
  check('a trigger whose snippet writes the very switch that trigger watches fires exactly once, and says that its own write was ignored',
    self.runs === 1 && self.on === true && self.refusal &&
    /writes the very thing it watches/.test(self.refusal.why),
    JSON.stringify(self));

  const cascade = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const ta = A.addTrigger({
      when: { kind: 'switch', id: 821, on: true }, snippet: window.__autoSnips.alpha, name: 'Alpha'
    });
    const tb = A.addTrigger({
      when: { kind: 'switch', id: 822, on: true }, snippet: window.__autoSnips.beta, name: 'Beta'
    });
    $gameSwitches.setValue(821, false);
    $gameSwitches.setValue(822, false);
    $gameSwitches.setValue(821, true);
    return {
      a: A.trigger(ta.id).runs, b: A.trigger(tb.id).runs,
      refusal: A.lastRefusal(), ceiling: G.store.cfgGet('auto.triggers.maxDepth', 2)
    };
  });
  check('two triggers that each set the other\'s switch stop at the cascade ceiling, and the refusal names both of them in the order they ran',
    cascade.a === 1 && cascade.b === 1 && cascade.refusal &&
    /cascade ceiling of 2/.test(cascade.refusal.why) &&
    /Alpha → Beta → Alpha/.test(cascade.refusal.why),
    JSON.stringify(cascade));

  const threw = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const t = A.addTrigger({
      when: { kind: 'switch', id: 813, on: true }, snippet: window.__autoSnips.thrower, name: 'thrower'
    });
    $gameSwitches.setValue(813, false);
    $gameSwitches.setValue(813, true);
    const after = { on: A.trigger(t.id).on, why: A.trigger(t.id).disabledWhy, runs: A.trigger(t.id).runs };
    $gameSwitches.setValue(813, false);
    $gameSwitches.setValue(813, true);
    const stayed = A.trigger(t.id).runs;
    A.enableTrigger(t.id, true);
    const rearmed = {
      on: A.trigger(t.id).on, why: A.trigger(t.id).disabledWhy, err: A.trigger(t.id).lastError
    };
    $gameSwitches.setValue(813, false);
    $gameSwitches.setValue(813, true);
    return { after, stayed, rearmed, runsAfterRearm: A.trigger(t.id).runs, id: t.id };
  });
  check('a trigger that throws is disabled, keeps the thrown message as its stated reason, and does not fire again on the next edge',
    threw.after.on === false && threw.after.runs === 1 && threw.stayed === 1 &&
    /^it threw: deliberate test error/.test(threw.after.why),
    JSON.stringify(threw.after) + ' · fired again ' + (threw.stayed - threw.after.runs) + ' time(s)');
  check('re-arming a disabled trigger clears its error rather than hiding it, and it fires again on the next edge',
    threw.rearmed.on === true && threw.rearmed.why === '' && threw.rearmed.err === '' &&
    threw.runsAfterRearm === 2,
    JSON.stringify(threw.rearmed) + ' · runs ' + threw.runsAfterRearm);

  const ceiling = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const t = A.addTrigger({
      when: { kind: 'var', id: 900, test: 'changes', value: 0 },
      snippet: window.__autoSnips.noop, name: 'churny'
    });
    /* A parallel process that writes one variable every step — a play timer,
       a step counter. It is the commonest thing in a project and it is what
       makes a naive watch fire forever. */
    window.__churnVar = 900;
    for (let i = 0; i < 30; i++) window.__raf.flush();
    window.__churnVar = 0;
    const rec = A.trigger(t.id);
    return {
      on: rec.on, why: rec.disabledWhy, runs: rec.runs,
      max: G.store.cfgGet('auto.triggers.maxPerSecond', 4)
    };
  });
  check('a trigger that exceeds the fires-per-second ceiling is switched off with the count that broke it, not silently throttled',
    ceiling.on === false && ceiling.runs === ceiling.max &&
    new RegExp('it fired ' + (ceiling.max + 1) + ' times in one second, over the ceiling of ' + ceiling.max)
      .test(ceiling.why),
    JSON.stringify(ceiling));

  const snipLife = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const del = C.saveSnippet('auto-check-del', '"del"');
    const td = A.addTrigger({ when: { kind: 'switch', id: 814, on: true }, snippet: del.id, name: 'orphan' });
    C.deleteSnippet(del.id);
    $gameSwitches.setValue(814, false);
    $gameSwitches.setValue(814, true);
    const deleted = {
      listed: A.triggers().some(x => x.id === td.id),
      on: A.trigger(td.id).on, why: A.trigger(td.id).disabledWhy, runs: A.trigger(td.id).runs
    };

    const ren = C.saveSnippet('auto-check-ren', '"ren"');
    const tr = A.addTrigger({ when: { kind: 'switch', id: 815, on: true }, snippet: ren.id, name: 'renamed' });
    C.saveSnippet('auto-check-ren-with-a-completely-different-name', '"ren"', ren.id);
    $gameSwitches.setValue(815, false);
    $gameSwitches.setValue(815, true);
    const renamed = { runs: A.trigger(tr.id).runs, why: A.trigger(tr.id).disabledWhy };
    return { deleted, renamed };
  });
  check('a trigger resolves its snippet by id at the moment it fires, so deleting that snippet leaves the trigger listed and switched off with the reason instead of running nothing',
    snipLife.deleted.listed === true && snipLife.deleted.on === false &&
    snipLife.deleted.runs === 0 &&
    /the snippet it ran was deleted from the console library/.test(snipLife.deleted.why),
    JSON.stringify(snipLife.deleted));
  check('renaming a snippet does not orphan the trigger that runs it',
    snipLife.renamed.runs === 1 && snipLife.renamed.why === '',
    JSON.stringify(snipLife.renamed));

  const relaunch = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    A.addTrigger({
      when: { kind: 'switch', id: 823, on: true }, snippet: window.__autoSnips.noop, name: 'persisted'
    });
    A.addTrigger({
      when: { kind: 'switch', id: 824, on: true }, snippet: window.__autoSnips.thrower, name: 'broken'
    });
    $gameSwitches.setValue(824, false);
    $gameSwitches.setValue(824, true);
    const routeBefore = A.route.list().map(r => r.name);
    const n = A.reload();
    A.route.reload();
    return {
      n, routeBefore, routeAfter: A.route.list().map(r => r.name),
      list: A.triggers().map(t => ({ name: t.name, on: t.on, why: t.disabledWhy, runs: t.runs }))
    };
  });
  check('every trigger and every route survives a relaunch, and a trigger that was switched off comes back off with its reason intact',
    relaunch.n === 2 &&
    relaunch.list.some(t => t.name === 'persisted' && t.on === true && t.why === '') &&
    relaunch.list.some(t => t.name === 'broken' && t.on === false &&
      /deliberate test error/.test(t.why)) &&
    relaunch.routeAfter.join(',') === relaunch.routeBefore.join(','),
    JSON.stringify(relaunch));

  const capped = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const t = A.addTrigger({
      when: { kind: 'switch', id: 825, on: true }, snippet: window.__autoSnips.big, name: 'firehose'
    });
    $gameSwitches.setValue(825, false);
    $gameSwitches.setValue(825, true);
    G.store.flush();
    const file = G.store.read('auto-triggers.json', null);
    return {
      max: G.store.cfgGet('auto.triggers.resultMax', 400),
      inMemory: A.trigger(t.id).lastResult.length,
      onDisk: JSON.stringify(file).length,
      says: /kept 400/.test(A.trigger(t.id).lastResult)
    };
  });
  check('a trigger\'s stored result is truncated before it is written, so one that returns the whole item database does not grow the settings file without bound',
    capped.inMemory < capped.max + 60 && capped.onDisk < 1200 && capped.says === true,
    JSON.stringify(capped));

  const heldFire = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const t = A.addTrigger({
      when: { kind: 'switch', id: 826, on: true }, snippet: window.__autoSnips.noop, name: 'held'
    });
    G.ui.setOpen(true);
    G.cfg.behaviour.pauseGame = true;
    $gameSwitches.setValue(826, false);
    $gameSwitches.setValue(826, true);
    const refused = A.trigger(t.id).runs;
    G.store.cfgSet('auto.triggers.whilePaused', true);
    $gameSwitches.setValue(826, false);
    $gameSwitches.setValue(826, true);
    const allowed = A.trigger(t.id).runs;
    G.store.cfgSet('auto.triggers.whilePaused', false);
    G.cfg.behaviour.pauseGame = false;
    G.ui.setOpen(false);
    return { refused, allowed, pauseAvailable: G.pause.available() };
  });
  check('a trigger does not fire while the game is held unless it has been told it may',
    heldFire.pauseAvailable === true && heldFire.refused === 0 && heldFire.allowed === 1,
    JSON.stringify(heldFire));

  /* --- the real-time timer ------------------------------------------------ */
  await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    window.__autoTimer = A.addTrigger({
      when: { kind: 'timer', seconds: 1 }, snippet: window.__autoSnips.noop, name: 'ticker'
    }).id;
    /* Four seconds of GAME time at four times speed, and no real time at all:
       the harness's frame clock is driven by hand. */
    G.store.cfgSet('player.speedy', true);
    G.store.cfgSet('player.gameSpeed', 4);
    for (let i = 0; i < 120; i++) window.__raf.flush();
    window.__autoTimerFrames = A.trigger(window.__autoTimer).runs;
    G.store.cfgSet('player.speedy', false);
    G.store.cfgSet('player.gameSpeed', 1);
  });
  await page.waitForTimeout(1200);
  const timer = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    window.__raf.flush();
    return {
      afterFrames: window.__autoTimerFrames,
      afterOneRealSecond: A.trigger(window.__autoTimer).runs,
      says: A.describe(A.trigger(window.__autoTimer).when)
    };
  });
  check('the every-N-seconds trigger is measured in real time, says so on the control, and does not fire more often when the game speed multiplier is on',
    timer.afterFrames === 0 && timer.afterOneRealSecond === 1 &&
    /every 1s of real time/.test(timer.says),
    JSON.stringify(timer));

  /* --- ids come from the loaded database ---------------------------------- */
  const ceilings = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    const before = { s: G.vars.switchCount(), v: G.vars.varCount() };
    const inRange = A.rangeWhy({ kind: 'switch', id: before.s });
    const past = A.rangeWhy({ kind: 'switch', id: before.s + 1 });
    const describedPast = A.describe({ kind: 'switch', id: before.s + 1, on: true });
    const keep = $dataSystem.switches;
    $dataSystem.switches = keep.concat(['grown one', 'grown two']);
    const afterGrow = {
      count: G.vars.switchCount(),
      wasPast: A.rangeWhy({ kind: 'switch', id: before.s + 1 }),
      nowPast: A.rangeWhy({ kind: 'switch', id: before.s + 3 })
    };
    $dataSystem.switches = keep;
    return { before, inRange, past, describedPast, afterGrow };
  });
  check('an id ceiling in this module is computed from the loaded database, so a project with a different table size gets a different ceiling and a stored id past the end is flagged rather than dropped',
    ceilings.inRange === '' &&
    ceilings.past === 'this project has ' + ceilings.before.s &&
    ceilings.describedPast.indexOf('this project has ' + ceilings.before.s) > -1 &&
    ceilings.afterGrow.count === ceilings.before.s + 2 &&
    ceilings.afterGrow.wasPast === '' &&
    ceilings.afterGrow.nowPast === 'this project has ' + (ceilings.before.s + 2),
    JSON.stringify(ceilings));

  /* =======================================================================
     3. ROUTE
     ==================================================================== */
  const edits = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    A.route.list().forEach(r => A.route.remove(r.id));
    const rt = A.route.create('edit rules');
    const one = A.route.addSplit(rt.id, { kind: 'switch', id: 830, on: true }, 'one');
    const two = A.route.addSplit(rt.id, { kind: 'switch', id: 831, on: true }, 'two');
    $gameSwitches.setValue(830, false);
    $gameSwitches.setValue(831, false);
    A.route.start('a check started it');
    for (let i = 0; i < 10; i++) window.__raf.flush();
    $gameSwitches.setValue(830, true);
    for (let i = 0; i < 10; i++) window.__raf.flush();
    $gameSwitches.setValue(831, true);
    const recorded = A.route.run().splits;
    const best0 = A.route.best();

    A.route.renameSplit(rt.id, one, 'one, renamed');
    const afterRename = A.route.best();
    A.route.moveSplit(rt.id, two, -1);
    const afterMove = A.route.best();
    const order = A.route.current().splits.map(s => s.label);

    A.route.removeSplit(rt.id, one);
    const afterDelete = A.route.best();
    const orphans = A.route.orphans(rt.id);

    const three = A.route.addSplit(rt.id, { kind: 'switch', id: 832, on: true }, 'three');
    const afterAdd = A.route.best();
    const dupWhy = A.route.duplicateWhy(rt.id, { kind: 'switch', id: 832, on: true });
    return {
      rt: rt.id, one, two, three, recorded, best0, afterRename, afterMove, order,
      afterDelete, orphans, afterAdd, dupWhy,
      /* A sid minted from a position would land back on a deleted split's
         number and inherit its best time. The new split must have no time. */
      inherited: afterAdd.splits[three] !== undefined
    };
  });
  const sameSplits = (a, b) => JSON.stringify(a && a.splits) === JSON.stringify(b && b.splits);
  check('a route split is matched to the best run by the split\'s own id, so renaming a split keeps its best time and reordering the route keeps every one of them',
    edits.best0 && edits.best0.splits[edits.one] === 10 && edits.best0.splits[edits.two] === 20 &&
    sameSplits(edits.best0, edits.afterRename) && sameSplits(edits.best0, edits.afterMove) &&
    edits.order.join(',') === 'two,one, renamed',
    JSON.stringify({ best: edits.best0 && edits.best0.splits, order: edits.order }));
  check('deleting a split leaves the best run\'s time for it on disk and says how many stored times no longer have a split, rather than dropping them',
    sameSplits(edits.best0, edits.afterDelete) && edits.orphans.length === 1 &&
    edits.orphans[0] === edits.one,
    JSON.stringify({ after: edits.afterDelete && edits.afterDelete.splits, orphans: edits.orphans }));
  check('a split id is minted once and never reused, so a split added after a deletion does not inherit the deleted one\'s best time',
    edits.inherited === false && edits.three !== edits.one && edits.three !== edits.two,
    JSON.stringify({ one: edits.one, two: edits.two, three: edits.three,
      best: edits.afterAdd && edits.afterAdd.splits }));
  check('adding a split after a best run was recorded stops the total being compared and says why, while every per-split comparison that still has a match keeps working',
    edits.afterAdd.totalValid === false && edits.afterAdd.total === edits.best0.total &&
    sameSplits(edits.best0, edits.afterAdd) &&
    /already splits on that/.test(edits.dupWhy),
    JSON.stringify({ totalValid: edits.afterAdd.totalValid, dup: edits.dupWhy }));

  const editsText = await render('player', 'Route');
  check('and the panel states the rule on screen instead of leaving it to be discovered — the total is not comparable, and the orphaned time is counted',
    /predates a split that has since been added/.test(editsText) &&
    /1 time\(s\) in the best run no longer have a split/.test(editsText),
    editsText.length + ' chars');

  const untouched = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    const before = JSON.stringify(A.route.best());
    const rt = A.route.current();
    A.route.renameSplit(rt.id, rt.splits[0].sid, 'renamed again');
    A.route.moveSplit(rt.id, rt.splits[0].sid, 1);
    A.route.addSplit(rt.id, { kind: 'switch', id: 835, on: true }, 'four');
    A.route.removeSplit(rt.id, rt.splits[0].sid);
    const afterEverything = JSON.stringify(A.route.best());
    /* Only totalValid may move, and it was already false. Clearing is its own
       action and nothing above is allowed to have done it. */
    const cleared = A.route.clearBest();
    return { before, afterEverything, same: before === afterEverything, cleared, now: A.route.best() };
  });
  check('the best run is never rewritten as a side effect of editing the route — clearing it is its own action',
    untouched.same === true && untouched.cleared === true && untouched.now === null,
    untouched.same ? 'unchanged through four edits' : untouched.before + ' → ' + untouched.afterEverything);

  const drift = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.route.list().forEach(r => A.route.remove(r.id));
    const rt = A.route.create('drift');
    const sid = A.route.addSplit(rt.id, { kind: 'switch', id: 830, on: true }, 'one');
    $gameSwitches.setValue(830, false);
    A.route.start('a check started it');
    for (let i = 0; i < 5; i++) window.__raf.flush();
    $gameSwitches.setValue(830, true);
    const saved = !!A.route.best();
    const keep = $dataSystem.switches;
    $dataSystem.switches = keep.concat(['grown one', 'grown two']);
    A.route.reload();
    const why = A.route.dbDrift(A.route.current().id);
    const stillThere = !!A.route.best() && A.route.best().splits[sid] !== undefined;
    $dataSystem.switches = keep;
    return { saved, why, stillThere, clean: A.route.dbDrift(A.route.current().id) };
  });
  check('a route recorded against a different size of switch or variable table is loaded and flagged with both sizes, never discarded',
    drift.saved === true && drift.stillThere === true && drift.clean === '' &&
    /1100 → 1102 switches/.test(drift.why) && /may no longer be the same one/.test(drift.why),
    drift.why);

  const jumped = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.route.list().forEach(r => A.route.remove(r.id));
    const rt = A.route.create('jumps');
    A.route.addSplit(rt.id, { kind: 'switch', id: 833, on: true }, 'never reached');
    A.route.start('a check started it');
    for (let i = 0; i < 10; i++) window.__raf.flush();
    const before = A.route.elapsed();
    /* The playtime editor writes Graphics.frameCount outright. No hook sees
       it, which is exactly why the discontinuity is measured instead. */
    Graphics.frameCount += 60 * 60 * 5;
    window.__raf.flush();
    const run = A.route.run();
    return {
      before, after: A.route.elapsed(), jumpBy: run.jumpBy,
      marked: run.clockJumped, state: run.state, why: run.why,
      clockWhy: A.clock().jumpWhy
    };
  });
  check('editing the play time moves the engine clock, and the run is marked as having had its clock edited rather than recording the jump as elapsed',
    jumped.marked === true && jumped.state === 'running' &&
    Math.abs(jumped.after - jumped.before) <= 2 && jumped.jumpBy >= 18000 &&
    /written directly/.test(jumped.clockWhy) && /this run is marked/.test(jumped.why),
    JSON.stringify(jumped));

  const loadedBack = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    Graphics.frameCount = 200000;
    A.route.reanchor();
    window.__raf.flush();
    const anchor = A.route.run().anchor;
    /* A load: extractSaveContents is what says "that was a load", and
       Game_System.onAfterLoad is where the clock is actually teleported. */
    $gameSystem._framesOnSave = 500;
    DataManager.extractSaveContents({});
    $gameSystem.onAfterLoad();
    window.__raf.flush();
    const run = A.route.run();
    return {
      anchor, now: Graphics.frameCount, state: run.state, why: run.why,
      elapsed: A.route.elapsed(), jumpWhy: A.clock().jumpWhy
    };
  });
  check('a load that puts the engine clock behind the run\'s anchor is reported as a load from before the run started, not as a negative elapsed time',
    loadedBack.now < loadedBack.anchor && loadedBack.state === 'void' &&
    loadedBack.elapsed === null &&
    /you loaded a save from before this run started/.test(loadedBack.why) &&
    /a save was loaded/.test(loadedBack.jumpWhy),
    JSON.stringify(loadedBack));

  const newGame = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.route.list().forEach(r => A.route.remove(r.id));
    const here = $gameMap.mapId();
    const rt = A.route.create('from a new game');
    A.route.addSplit(rt.id, { kind: 'map', id: here }, 'the starting map');
    G.store.cfgSet('auto.route.startOnNewGame', true);
    /* setupNewGame runs BEFORE the first map is set up on both engines, which
       is the whole reason the run is anchored there. */
    DataManager.setupNewGame();
    const anchoredAt = A.route.run().anchor;
    const startedBeforeMap = A.route.run().state === 'running' &&
      Object.keys(A.route.run().splits).length === 0;
    $gameMap.setup(here);
    const run = A.route.run();
    return {
      anchoredAt, startedBeforeMap,
      splits: run.splits, state: run.state,
      reachable: Object.keys(run.splits).length === 1,
      hookInstalled: !!(G.hooks['DataManager.setupNewGame (auto: run start)'] || {}).installed
    };
  });
  check('a run started on a new game is anchored before the first map is set up, so a split on the starting map is still reachable',
    newGame.hookInstalled === true && newGame.startedBeforeMap === true &&
    newGame.reachable === true,
    JSON.stringify(newGame));

  const perProject = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.route.list().forEach(r => A.route.remove(r.id));
    A.route.create('this project only');
    const key1 = A.route.gameKey();
    const routes1 = A.route.list().map(r => r.name);
    const keepTitle = $dataSystem.gameTitle;
    /* A mod-loader layout gives two projects one data directory. The key is
       derived from the profile, which reads the project's own title. */
    $dataSystem.gameTitle = 'A Second Project Sharing One Data Directory';
    G.profile.resolve(true);
    const key2 = A.route.gameKey();
    const routes2 = A.route.list().map(r => r.name);
    A.route.create('the other project\'s route');
    const routes2b = A.route.list().map(r => r.name);
    A.route.forgetProject();
    $dataSystem.gameTitle = keepTitle;
    G.profile.resolve(true);
    return { key1, key2, routes1, routes2, routes2b, routes3: A.route.list().map(r => r.name) };
  });
  check('routes are stored under a key derived from the profile, so two projects sharing one data directory do not share runs',
    perProject.key1 !== perProject.key2 &&
    perProject.routes1.join(',') === 'this project only' &&
    perProject.routes2.length === 0 &&
    perProject.routes2b.join(',') === 'the other project\'s route' &&
    perProject.routes3.join(',') === 'this project only',
    JSON.stringify(perProject));

  const manual = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    A.route.list().forEach(r => A.route.remove(r.id));
    const rt = A.route.create('manual splits');
    const known = A.route.addSplit(rt.id, { kind: 'manual', label: 'boss down' }, 'boss down');
    /* A second declared split that is never reached, so the run stays running
       and the appended one is timed rather than arriving after the finish. */
    A.route.addSplit(rt.id, { kind: 'switch', id: 835, on: true }, 'never reached');
    A.route.start('a check started it');
    for (let i = 0; i < 6; i++) window.__raf.flush();
    const sidA = G.api.split('boss down');
    const before = A.route.current().splits.length;
    for (let i = 0; i < 6; i++) window.__raf.flush();
    const sidB = G.api.split('something nobody declared');
    return {
      matched: sidA === known, before, after: A.route.current().splits.length,
      appended: sidB !== null && sidB !== known,
      times: A.route.run().splits,
      says: A.describe({ kind: 'manual', label: 'boss down' })
    };
  });
  check('a snippet can record a split the three sources cannot describe, and a label with no split of its own appends one rather than being dropped',
    manual.matched === true && manual.appended === true &&
    manual.after === manual.before + 1 &&
    Object.keys(manual.times).length === 2 &&
    /the run reaches "boss down"/.test(manual.says),
    JSON.stringify(manual));

  /* =======================================================================
     4. THE PANELS
     ==================================================================== */
  const panels = await ev(() => {
    const U = window.GigaHack.ui;
    const d = U.panelNames('debug'), p = U.panelNames('player');
    return {
      debug: d, player: p,
      triggersAt: d.indexOf('Triggers'), rngAt: d.indexOf('RNG'), captureAt: d.indexOf('Capture'),
      routeAt: p.indexOf('Route'), survivalAt: p.indexOf('Survival'),
      encountersAt: p.indexOf('Encounters'),
      dupDebug: d.length !== new Set(d).size, dupPlayer: p.length !== new Set(p).size
    };
  });
  check('the two panels this module registers land in the sort slots the panel map reserves for them, so neither shares an order with a panel that is already there',
    panels.triggersAt > -1 && panels.routeAt > -1 &&
    panels.triggersAt > panels.rngAt &&
    (panels.captureAt === -1 || panels.triggersAt < panels.captureAt) &&
    panels.routeAt > panels.survivalAt &&
    (panels.encountersAt === -1 || panels.routeAt < panels.encountersAt) &&
    !panels.dupDebug && !panels.dupPlayer,
    JSON.stringify({ debug: panels.debug, player: panels.player }));

  const noSource = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const hook = G.hooks['Game_Map.setup (auto: map loaded)'];
    hook.unpatch();
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.debug = 'Triggers';
    U.rerender();
    const opts = () => Array.prototype.map.call(
      document.querySelectorAll('#mm-root .mm-dd .mm-opt'), o => o.getAttribute('data-mm-v'));
    const gone = opts();
    const text = document.querySelector('#mm-root .mm-win').textContent;
    /* Put the wrapper back the way Debug → Hooks would if it could. */
    hook.owner[hook.method] = hook.patched;
    hook.installed = true;
    U.rerender();
    const back = opts();
    return {
      offeredWhileMissing: gone.indexOf('a map loads') > -1,
      offeredAfter: back.indexOf('a map loads') > -1,
      namesTheFunction: /Game_Map\.prototype\.setup/.test(text),
      saysNotOffered: /is not offered/.test(text),
      panelBuilt: text.length > 400
    };
  });
  check('a source whose hook did not install is not offered in the dropdown at all, and the reason on screen names the function that was missing',
    noSource.offeredWhileMissing === false && noSource.offeredAfter === true &&
    noSource.namesTheFunction === true && noSource.saysNotOffered === true &&
    noSource.panelBuilt === true,
    JSON.stringify(noSource));

  const noLibrary = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const out = {};
    const keepSnippets = G.console.snippets, keepSnippet = G.console.snippet;
    G.console.snippets = function () { return []; };
    G.console.snippet = function () { return null; };
    U.rerender();
    out.empty = document.querySelector('#mm-root .mm-win').textContent;
    G.console.snippets = keepSnippets;
    G.console.snippet = keepSnippet;

    const keepConsole = G.console;
    G.console = undefined;
    U.rerender();
    out.none = document.querySelector('#mm-root .mm-win').textContent;
    G.console = keepConsole;
    U.rerender();
    out.back = document.querySelector('#mm-root .mm-win').textContent.length;
    return out;
  });
  check('the triggers panel registers on every build, and where the console module did not load it says there is no snippet library to schedule instead of showing an empty list',
    /no snippet library to schedule/.test(noLibrary.none) &&
    /Install GigaHack_Console\.js/.test(noLibrary.none) &&
    noLibrary.back > 400,
    noLibrary.none.slice(0, 160));
  check('and where the library is merely empty it names the command that writes one, rather than handing a dropdown with no options to choose from',
    /no snippets saved yet/.test(noLibrary.empty) &&
    /save as snippet/.test(noLibrary.empty) &&
    noLibrary.empty.length > 400,
    noLibrary.empty.length + ' chars');

  const writes = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    G.compat.clearDegraded();
    /* A write the ENGINE itself refuses: setValue ignores id 0 on both
       engines, so nothing here needs a plugin to be present. */
    G.compat.verify('vars.set',
      function () { $gameVariables.setValue(0, 424242); },
      function () { return $gameVariables.value(0); },
      424242);
    U.rerender();
    const text = document.querySelector('#mm-root .mm-win').textContent;
    const declared = Object.keys(G.hooks).filter(k => /auto:/.test(k));
    G.compat.clearDegraded();
    U.rerender();
    const after = document.querySelector('#mm-root .mm-win').textContent;
    return {
      listsControl: text.indexOf('vars.set') > -1,
      listsWhy: /wrote 424242 to vars\.set and read back/.test(text),
      offersRetry: /try "vars\.set" again/.test(text),
      clearsAway: /nothing GigaHack writes has been refused this session/.test(after),
      autoHooks: declared
    };
  });
  check('this module writes no game state of its own, so it declares no compat control — and where GigaHack\'s writes have been refused this session the panel lists the control and the reason beside the triggers that will appear to do nothing',
    writes.listsControl && writes.listsWhy && writes.offersRetry && writes.clearsAway &&
    writes.autoHooks.length === 4,
    JSON.stringify(writes));

  const inPlace = await ev(() => {
    const G = window.GigaHack, A = G.auto, C = G.console, U = G.ui;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const t = A.addTrigger({
      when: { kind: 'switch', id: 800, on: true }, snippet: window.__autoSnips.noop, name: 'repaint'
    });
    U.rerender();
    const field = document.querySelector('#mm-root .mm-input[placeholder="name (optional)"]');
    if (!field) return { noField: true };
    field.focus();
    field.value = 'half-typed name';
    const table = document.querySelector('#mm-root .mm-table');
    const before = table.querySelectorAll('.mm-tr').length;
    $gameSwitches.setValue(800, false);
    $gameSwitches.setValue(800, true);
    for (let i = 0; i < 12; i++) window.__raf.flush();
    const cells = Array.prototype.map.call(
      document.querySelector('#mm-root .mm-table').querySelectorAll('.mm-tr')[0].children,
      c => c.textContent);
    return {
      stillFocused: document.activeElement === field,
      keptTyping: field.value === 'half-typed name',
      sameTableNode: document.querySelector('#mm-root .mm-table') === table,
      rows: before, cells,
      runs: A.trigger(t.id).runs
    };
  });
  check('a trigger firing while its panel is open repaints the table in place and does not rebuild the tab, so a name being typed is not lost',
    inPlace.runs === 1 && inPlace.stillFocused === true && inPlace.keptTyping === true &&
    inPlace.sameTableNode === true && inPlace.cells.indexOf('1') > -1,
    JSON.stringify(inPlace));

  const sourceSaid = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    const s = A.source();
    const text = document.querySelector('#mm-root .mm-win').textContent;
    return {
      via: s.via, blind: s.blind,
      onScreen: text.indexOf(s.blind.slice(0, 40)) > -1,
      namesTheGate: G.pause.targets().every(t => text.indexOf(t) > -1),
      watchOk: G.watch ? G.watch.available().ok : null
    };
  });
  check('the panel names which source the edges come from and what that source cannot see, rather than implying the watch is exhaustive',
    sourceSaid.via === 'trace' && sourceSaid.watchOk === true &&
    /without going through setValue/.test(sourceSaid.blind) &&
    sourceSaid.onScreen === true && sourceSaid.namesTheGate === true,
    JSON.stringify(sourceSaid));

  const precision = await ev(() => {
    const G = window.GigaHack, A = G.auto, U = G.ui;
    A.route.list().forEach(r => A.route.remove(r.id));
    const rt = A.route.create('precision');
    A.route.addSplit(rt.id, { kind: 'switch', id: 831, on: true }, 'ninety frames in');
    $gameSwitches.setValue(831, false);
    A.route.start('a check started it');
    for (let i = 0; i < 90; i++) window.__raf.flush();
    $gameSwitches.setValue(831, true);
    const shown = () => {
      U.rerender();
      const rows = document.querySelectorAll('#mm-root .mm-table .mm-tr');
      return rows.length ? rows[0].children[3].textContent : '';
    };
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub.player = 'Route';
    const keep = G.store.cfgGet('auto.route.precision', 'cs');
    G.store.cfgSet('auto.route.precision', 'cs');
    const cs = shown();
    G.store.cfgSet('auto.route.precision', 's');
    const whole = shown();
    G.store.cfgSet('auto.route.precision', 'frames');
    const frames = shown();
    G.store.cfgSet('auto.route.precision', keep);
    return { cs, whole, frames, recorded: A.route.run().splits };
  });
  check('a split time is recorded in engine frames and only converted for display, so the raw count the engine actually counted is still reachable',
    /^0:00:01\.5\d$/.test(precision.cs) && precision.whole === '0:00:01' &&
    /^9\df$/.test(precision.frames),
    JSON.stringify(precision));

  const fallback = await ev(() => {
    const G = window.GigaHack, A = G.auto, U = G.ui;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    const keep = G.watch.available;
    /* What a build without GigaHack_Trace.js looks like from here. The module
       may not install a second setValue alias of its own, so the only honest
       fallback is to poll the ids an armed condition actually names. */
    G.watch.available = function () {
      return { ok: false, why: 'Game_Variables.prototype.setValue is not the function GigaHack aliased.' };
    };
    const t = A.addTrigger({
      when: { kind: 'switch', id: 810, on: true }, snippet: window.__autoSnips.noop, name: 'polled'
    });
    const via = A.source().via, blind = A.source().blind;
    $gameSwitches.setValue(810, false);
    for (let i = 0; i < 3; i++) window.__raf.flush();
    const beforePoll = A.trigger(t.id).runs;
    $gameSwitches.setValue(810, true);
    const beforeFrame = A.trigger(t.id).runs;   // the poller has not run yet
    for (let i = 0; i < 3; i++) window.__raf.flush();
    const afterFrame = A.trigger(t.id).runs;
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub.debug = 'Triggers';
    U.rerender();
    const text = document.querySelector('#mm-root .mm-win').textContent;
    G.watch.available = keep;
    A.removeTrigger(t.id);
    return {
      via, blind, beforePoll, beforeFrame, afterFrame,
      saysWhy: /GigaHack_Trace\.js did not load|not the function GigaHack aliased/.test(text),
      saysBlind: /set and cleared inside one logical step/.test(text),
      backTo: A.source().via
    };
  });
  check('where there is no write-time source the edges are polled once per logical step instead, and the panel names the module that would have seen the write and the blind spot polling has',
    fallback.via === 'poll' && fallback.beforePoll === 0 && fallback.beforeFrame === 0 &&
    fallback.afterFrame === 1 && fallback.saysWhy === true && fallback.saysBlind === true &&
    fallback.backTo === 'trace',
    JSON.stringify(fallback));

  const noClock = await ev(() => {
    const G = window.GigaHack, A = G.auto, U = G.ui;
    const keep = Graphics.frameCount;
    /* Not a number, which is what a build with a replaced Graphics looks
       like from here. Restored inside the same synchronous block, so no frame
       can run while it is gone. */
    Graphics.frameCount = null;
    const c = A.clock();
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub.player = 'Route';
    U.rerender();
    const text = document.querySelector('#mm-root .mm-win').textContent;
    Graphics.frameCount = keep;
    U.rerender();
    return {
      ok: c.ok, why: c.why, frame: c.frame,
      says: /no readable engine frame count/.test(text),
      wallClock: /would measure your afternoon/.test(text),
      backAfter: A.clock().ok
    };
  });
  check('a build with no readable engine frame count gets a Route panel that names the missing clock and refuses to substitute a wall clock, rather than an empty one',
    noClock.ok === false && noClock.frame === null && noClock.says === true &&
    noClock.wallClock === true && noClock.backAfter === true,
    JSON.stringify(noClock));

  /* --- the long sentences stay inside their own column --------------------
     Both panels put a clock explanation and a degraded-write reason in a
     180px sidebar. Measured, not eyeballed: a column that scrolls sideways is
     a column whose content did not fit, and the text is then clipped by its
     own overflow rather than wrapped. */
  const overflow = async (tab, sub) => {
    await render(tab, sub);
    return await ev(() => {
      const out = { worst: 0, rows: 0, longest: 0 };
      document.querySelectorAll('#mm-root .mm-col').forEach(c => {
        const over = c.scrollWidth - c.clientWidth;
        if (over > out.worst) out.worst = over;
      });
      document.querySelectorAll('#mm-root .mm-row').forEach(r => {
        if (r.scrollWidth > r.clientWidth + 1) out.rows++;
      });
      document.querySelectorAll('#mm-root .mm-col-narrow .mm-sub').forEach(el => {
        if (el.textContent.length > out.longest) out.longest = el.textContent.length;
      });
      return out;
    });
  };
  await ev(() => {
    /* Something to explain: a jump the panel must describe, and a refused
       write it must list, both of them long sentences in the narrow column. */
    const G = window.GigaHack;
    G.auto.route.list().forEach(r => G.auto.route.remove(r.id));
    const rt = G.auto.route.create('layout');
    G.auto.route.addSplit(rt.id, { kind: 'switch', id: 830, on: true }, 'a split with a long-ish name');
    G.auto.route.start('a check started it');
    Graphics.frameCount += 60 * 60 * 9;
    window.__raf.flush();
    G.compat.verify('vars.set',
      function () { $gameVariables.setValue(0, 424242); },
      function () { return $gameVariables.value(0); },
      424242);
  });
  const trigLayout = await overflow('debug', 'Triggers');
  await shot('auto-triggers');
  const routeLayout = await overflow('player', 'Route');
  await shot('auto-route');
  check('the clock explanation and the refused-write reason wrap inside the narrow column instead of being pushed past its edge and clipped',
    trigLayout.worst === 0 && trigLayout.rows === 0 && trigLayout.longest > 80 &&
    routeLayout.worst === 0 && routeLayout.rows === 0 && routeLayout.longest > 80,
    JSON.stringify({ triggers: trigLayout, route: routeLayout }));

  /* =======================================================================
     5. PUT EVERYTHING BACK
     ==================================================================== */
  const restored = await ev(k => {
    const G = window.GigaHack, A = G.auto, C = G.console;
    A.triggers().forEach(t => A.removeTrigger(t.id));
    A.route.list().forEach(r => A.route.remove(r.id));
    A.route.voidRun('the checks are done');
    A.clockReset();
    window.__churnVar = k.churn;

    /* Put the library back as the file it WAS, then make the module re-read
       it — one write instead of one per snippet. A library that had never been
       written is restored by deleting the file, not by writing an empty one:
       absent means "seeded from the mod's own starters" and empty means "the
       user deleted every one of them", and the two are not the same library. */
    if (k.snippetFile) G.store.write('snippets.json', k.snippetFile, true);
    else G.store.remove('snippets.json');
    C.reload();

    G.store.cfgSet('auto.triggers.toastOnFire', k.toast);
    G.store.cfgSet('auto.triggers.whilePaused', false);
    G.store.cfgSet('auto.route.startOnNewGame', true);
    G.store.cfgSet('player.speedy', k.speedy);
    G.store.cfgSet('player.gameSpeed', k.gameSpeed);
    G.compat.clearDegraded();

    $dataSystem.gameTitle = k.title;
    $dataSystem.switches = k.switchNames;
    G.profile.resolve(true);

    if ($gameMap.mapId() !== k.mapId) $gameMap.setup(k.mapId);
    k.switches.forEach(p => $gameSwitches.setValue(p[0], p[1]));
    k.vars.forEach(p => $gameVariables.setValue(p[0], p[1]));
    $gameSystem._framesOnSave = k.framesOnSave;
    Graphics.frameCount = k.frameCount;

    G.cfg.behaviour.pauseGame = k.pause;
    G.cfg.ui.tab = k.tab;
    G.ui.setOpen(k.open);
    G.ui.rerender();
    G.store.flush();

    return {
      triggers: A.triggers().length,
      routes: A.route.list().length,
      runState: A.route.run().state,
      snippets: C.snippets().length === k.snippets.length,
      title: $dataSystem.gameTitle === k.title,
      switchTable: G.vars.switchCount(),
      frameCount: Graphics.frameCount === k.frameCount,
      mapId: $gameMap.mapId() === k.mapId,
      paused: !!(G.cfg.behaviour && G.cfg.behaviour.pauseGame) === k.pause,
      churn: window.__churnVar === k.churn,
      switches: k.switches.every(p => $gameSwitches.value(p[0]) === p[1]),
      vars: k.vars.every(p => $gameVariables.value(p[0]) === p[1]),
      degraded: G.compat.degradedList().length,
      hooks: Object.keys(G.hooks).filter(x => /auto:/.test(x))
        .every(x => G.hooks[x].installed === true)
    };
  }, await ev(() => window.__autoKeep));
  check('auto leaves the game, the settings, the snippet library and the engine clock exactly as it found them, with every one of its own hooks back in place',
    restored.triggers === 0 && restored.routes === 0 && restored.snippets === true &&
    restored.title === true && restored.switchTable === 1100 && restored.frameCount === true &&
    restored.mapId === true && restored.paused === true && restored.churn === true &&
    restored.switches === true && restored.vars === true && restored.degraded === 0 &&
    restored.hooks === true,
    JSON.stringify(restored));
};
