/* =============================================================================
   GigaHack test harness — checks/regress-trace.js
   Regressions from the review of Trace, Auto, Snapshot and Map.

   Each block is one bug that shipped, staged the way the game would produce
   it rather than by calling the fixed function directly:

     1. A load through the engine's own load scene was never recognised as a
        load. The scene restores the clock from onAfterLoad, called from its
        terminate() AFTER a fade of a few dozen frames, while Auto only stamped
        the load at extractSaveContents and accepted a jump within one frame.
     2. A run started by "start on load" was anchored on the clock of the
        session being left, before the load put the clock back.
     3. "Record rolls" is persisted, but the Math.random alias is installed on
        demand — so a launch that found it on showed "recording" over a
        generator nothing watched.
     4. Map's "back" dropped the history entry when the teleport refused.
     5. The load anchor's playtime was the old session's clock, not the save's.

   Everything touched is put back: the engine clock, the save's frame count,
   the route list, the auto settings, the anchor, the globals and the map
   teleport check.
   ========================================================================== */
'use strict';

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page;

  /* =========================================================================
     1 + 2 — A STOCK-PATH LOAD
     ====================================================================== */
  const load = await ev(() => {
    const G = window.GigaHack, A = G.auto;
    if (!window.__raf.pending()) SceneManager.requestUpdate();
    const keep = {
      fc: Graphics.frameCount, fos: $gameSystem._framesOnSave,
      startOnLoad: G.store.cfgGet('auto.route.startOnLoad', false),
      anchor: G.snap ? G.snap.anchor() : null,
      routes: A.route.list().map(r => r.id)
    };
    const flush = n => { for (let i = 0; i < n; i++) window.__raf.flush(); };
    const out = {};

    const rt = A.route.create('regress: a load');
    A.route.addSplit(rt.id, { kind: 'switch', id: 834, on: true }, 'never reached');

    /* (1) A run in progress, then the load scene's sequence: extract, fade
       out for forty frames, THEN onAfterLoad from terminate(). */
    Graphics.frameCount = 100000;
    A.clockReset();
    A.route.start('regress: a run in progress');
    flush(3);
    $gameSystem._framesOnSave = 400000;      // later than the run, so not a void
    DataManager.extractSaveContents({});
    flush(40);
    $gameSystem.onAfterLoad();
    flush(2);
    let run = A.route.run();
    out.stock = {
      state: run.state, loaded: run.loaded, clockJumped: run.clockJumped,
      jumpWhy: A.clock().jumpWhy, now: Graphics.frameCount
    };

    /* (2) "Start on load": the run must begin on the LOADED clock. */
    G.store.cfgSet('auto.route.startOnLoad', true);
    Graphics.frameCount = 900000;           // the session being left
    A.clockReset();
    flush(2);
    $gameSystem._framesOnSave = 5000;       // the save, well behind it
    DataManager.extractSaveContents({});
    out.startedEarly = A.route.run().anchor >= 900000 && A.route.run().why === 'a save was loaded';
    flush(40);
    $gameSystem.onAfterLoad();
    flush(2);
    run = A.route.run();
    out.startOnLoad = {
      state: run.state, why: run.why, anchor: run.anchor,
      clockJumped: run.clockJumped, elapsed: A.route.elapsed()
    };
    out.hook = !!(G.hooks['Game_System.onAfterLoad (auto: load clock)'] || {}).installed;

    // Put it all back.
    A.route.stop();
    A.route.list().forEach(r => { if (keep.routes.indexOf(r.id) < 0) A.route.remove(r.id); });
    G.store.cfgSet('auto.route.startOnLoad', keep.startOnLoad);
    $gameSystem._framesOnSave = keep.fos;
    Graphics.frameCount = keep.fc;
    A.clockReset();
    if (G.snap) { if (keep.anchor) G.snap.setAnchor(keep.anchor); else G.snap.clearAnchor(); }
    return out;
  });
  check('a load through the load scene — clock restored by onAfterLoad after its fade — is recognised as a load, not as an edited play time',
    load.hook && load.stock.state === 'running' && load.stock.loaded === true &&
    /a save was loaded/.test(load.stock.jumpWhy) && !/written directly/.test(load.stock.jumpWhy),
    JSON.stringify(load.stock));
  check('"start on load" starts the run after onAfterLoad, on the loaded clock, with no jump to absorb',
    load.startedEarly === false && load.startOnLoad.state === 'running' &&
    load.startOnLoad.why === 'a save was loaded' &&
    load.startOnLoad.anchor >= 5000 && load.startOnLoad.anchor < 5100 &&
    load.startOnLoad.clockJumped === false &&
    load.startOnLoad.elapsed !== null && load.startOnLoad.elapsed <= 4,
    JSON.stringify(load));

  /* =========================================================================
     5 — THE LOAD ANCHOR'S PLAYTIME
     ====================================================================== */
  const anchor = await ev(() => {
    const G = window.GigaHack;
    const keep = { anchor: G.snap.anchor(), sys: $gameSystem, fc: Graphics.frameCount };
    const sys = Object.create(Game_System.prototype);
    Game_System.call(sys);
    sys._framesOnSave = 123456;
    Graphics.frameCount = 777;              // the session being left
    DataManager.extractSaveContents({ globals: { $gameSystem: sys } });
    const a = G.snap.anchor();
    const out = { origin: a && a.origin, playFrames: a && a.playFrames, clock: Graphics.frameCount };
    window.$gameSystem = keep.sys;
    Graphics.frameCount = keep.fc;
    G.auto.clockReset();
    if (keep.anchor) G.snap.setAnchor(keep.anchor); else G.snap.clearAnchor();
    return out;
  });
  check('the baseline a load anchors carries the save\'s playtime, not the clock of the session being left',
    anchor.origin === 'load' && anchor.playFrames === 123456, JSON.stringify(anchor));

  /* =========================================================================
     4 — MAP "BACK" WHEN THE TELEPORT REFUSES
     ====================================================================== */
  const back = await ev(() => {
    const M = window.GigaHack.map;
    if (!M.history().length) M.teleport($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y, 0, 2);
    const before = M.history();
    const realCan = M.canTeleport;
    M.canTeleport = function () { return 'a check is refusing every teleport'; };
    let ok;
    try { ok = M.back(); } finally { M.canTeleport = realCan; }
    const after = M.history();
    return {
      ok, before: before.length, after: after.length,
      sameFirst: !!(before[0] && after[0] && before[0].at === after[0].at &&
        before[0].mapId === after[0].mapId)
    };
  });
  check('"back" keeps its history entry when the teleport refuses, so the place can still be gone back to',
    back.ok === false && back.before >= 1 && back.after === back.before && back.sameFirst,
    JSON.stringify(back));

  /* =========================================================================
     3 — RECORDING ROLLS SURVIVES A LAUNCH

     A launch is a fresh page. It is given this page's storage with recording
     switched on, in a context of its own, so nothing it writes reaches the
     page every other check runs in.
     ====================================================================== */
  const dump = await ev(() => {
    const G = window.GigaHack;
    const keep = G.store.cfgGet('trace.rng.watch', false);
    G.store.cfgSet('trace.rng.watch', true);
    G.store.flush();
    const d = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      d[k] = localStorage.getItem(k);
    }
    G.store.cfgSet('trace.rng.watch', keep);
    G.store.flush();
    return { d, keep, mode: G.paths.mode, installedHere: !!(G.hooks['Math.random (rng)'] || {}).installed };
  });
  let launched = { skipped: 'storage is ' + dump.mode + ', so a setting cannot cross a launch here' };
  if (dump.mode === 'localStorage') {
    const browser = page.context().browser();
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
      await ctx2.addInitScript(d => {
        try { Object.keys(d).forEach(k => localStorage.setItem(k, d[k])); } catch (e) { }
      }, dump.d);
      const p2 = await ctx2.newPage();
      await p2.goto(page.url());
      await p2.waitForFunction(() => !!(window.GigaHack && window.GigaHack.trace && window.GigaHack.rng),
        null, { timeout: 20000 });
      launched = await p2.evaluate(() => {
        const G = window.GigaHack;
        const h = G.hooks['Math.random (rng)'];
        const before = G.rng.count().session;
        Math.random(); Math.random();
        return {
          watching: G.rng.watching(),
          installed: !!(h && h.installed),
          counted: G.rng.count().session - before
        };
      });
    } finally {
      await ctx2.close();
    }
  }
  check('"record rolls" left on at the last launch is recording after this one — the alias is installed, and a roll is counted',
    launched.watching === true && launched.installed === true && launched.counted === 2,
    JSON.stringify(launched));
  const after = await ev(() => ({
    watch: window.GigaHack.store.cfgGet('trace.rng.watch', false),
    installed: !!(window.GigaHack.hooks['Math.random (rng)'] || {}).installed
  }));
  check('the launch check leaves this page\'s roll recording exactly as it was',
    after.watch === dump.keep && after.installed === dump.installedHere, JSON.stringify(after));
};
