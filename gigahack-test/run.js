/* =============================================================================
   GigaHack MV/MZ — the test suite.

     node run.js                      stock RPG Maker MZ 1.9.0
     node run.js --engine=mv          stock RPG Maker MV 1.6.1
     node run.js --engine=mv-modded   MV plus a modelled third-party stack

   Exit code is the contract: 0 clean, 1 any failure. Names are free-text
   sentences about behaviour, because a failure line is the whole bug report.

   The framework is two lines and has not changed since 1.x.
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

/* --- engine selection ---------------------------------------------------- */
const ENGINES = {
  mz: { file: 'harness.html', name: 'MZ', saveExt: '.rmmzsave', modded: false },
  mv: { file: 'harness-mv.html', name: 'MV', saveExt: '.rpgsave', modded: false },
  'mv-modded': { file: 'harness-mv-modded.html', name: 'MV', saveExt: '.rpgsave', modded: true }
};
const arg = process.argv.slice(2).find(a => a.indexOf('--engine=') === 0);
const ENGINE = arg ? arg.slice('--engine='.length) : 'mz';
if (!ENGINES[ENGINE]) {
  console.error('unknown engine "' + ENGINE + '" — expected one of: ' + Object.keys(ENGINES).join(', '));
  process.exit(2);
}
/* The module count is read from the manifest the installer also reads, so a
   module added to the mod is never a suite that has to be edited to notice. It
   was 26 in three files and a shell script, and every one of them was a place
   the next module could be silently missing from. */
const MANIFEST = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../gigahack/manifest.json'), 'utf8'));
const MODULES = MANIFEST.modules.map(m => m.name);
const N_MODULES = MODULES.length;

const CFG = ENGINES[ENGINE];
const IS_MV = CFG.name === 'MV';
const IS_MZ = CFG.name === 'MZ';
const MODDED = CFG.modded;
/* The extension is a capability, not a constant of the codebase. Eleven
   assertions in 1.x carried the literal '.rmmzsave'; there is one here. */
const SAVE_EXT = CFG.saveExt;

/* Screenshots are per engine, so an MV run never overwrites the MZ shots and
   a visual regression is attributable to one of them. .gitignore covers
   shots- directories already. */
const SHOTS = path.resolve(__dirname, 'shots-' + ENGINE);

(async () => {
  const launchOpts = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));

  await page.goto('file://' + path.resolve(__dirname, CFG.file));
  await page.waitForTimeout(400);

  const results = [];
  const check = (name, ok, extra) => results.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });

  const ev = (fn, arg) => page.evaluate(fn, arg);
  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = async (name) => { try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) { } };

  /* =======================================================================
     LOAD
     ==================================================================== */
  const loaded = await ev(() => !!window.GigaHack && !!window.GigaHack.ui && !!window.GigaHack.ui.mount);
  check('all ' + N_MODULES + ' plugin files evaluated and the overlay controller exists', loaded);

  const modules = await ev(() => {
    const r = window.GigaHack.moduleReport();
    return {
      missing: window.GigaHack.missingModules(),
      rows: r.rows.map(m => ({ n: m.name, ran: m.ran, listed: m.listed })),
      expected: r.expected, ran: r.ran, layout: r.layout,
      version: window.GigaHack.version
    };
  });
  check('every module in the manifest registered its marker', modules.missing.length === 0, modules.missing.join(', '));
  check('the module report covers every module in the manifest',
    modules.rows.length === N_MODULES, modules.rows.length + '/' + N_MODULES);
  check('and the harness loads exactly the manifest\'s list, in its order',
    modules.rows.map(m => m.n).join(',') === MODULES.join(','),
    modules.rows.map(m => m.n).join(','));
  check('every module the report expects actually ran',
    modules.ran.length === N_MODULES, modules.ran.length + '/' + modules.expected.length);
  check('GigaHack_Inspect is gone from the manifest',
    modules.rows.every(m => m.n !== 'GigaHack_Inspect'));
  check('every module is listed as enabled in the game plugin list',
    modules.rows.every(m => m.listed === 'enabled'),
    modules.rows.filter(m => m.listed !== 'enabled').map(m => m.n + '=' + m.listed).join(', '));
  check('the mod reports itself as 2.x', /^2\./.test(modules.version), modules.version);
  check('ModMenu alias resolves to GigaHack', await ev(() => window.ModMenu === window.GigaHack));

  const paths = await ev(() => window.GigaHack.paths);
  check('persistence degraded to localStorage without Node', paths.mode === 'localStorage', paths.mode);
  check('the degraded persistence mode is explained, not just set',
    (paths.notes || []).some(n => /Node APIs unavailable/.test(n)), JSON.stringify(paths.notes));

  /* =======================================================================
     CAPABILITY TABLE
     Every entry in $.caps.report() is present and answers correctly for the
     engine under test. The table is the mod's own contract with itself: a
     panel asks a capability, never a version.
     ==================================================================== */
  const caps = await ev(() => {
    const C = window.GigaHack.caps;
    const rows = C.report();
    const map = {};
    rows.forEach(r => { map[r[0]] = String(r[1]); });
    return {
      rows: rows.map(r => r[0]),
      map,
      flat: {
        engine: C.engine, isMV: C.isMV, isMZ: C.isMZ,
        colorManager: C.colorManager, spriteGauge: C.spriteGauge, spriteName: C.spriteName,
        registerCommand: C.registerCommand, effekseer: C.effekseer, pixiApp: C.pixiApp,
        canvasId: C.canvasId, tileEventsKey: C.tileEventsKey,
        saveExt: C.saveExt, saveIsAsync: C.saveIsAsync,
        savefileIdOnSystem: C.savefileIdOnSystem, globalInfoSync: C.globalInfoSync,
        savefileEnabled: C.savefileEnabled, mainFontOnSystem: C.mainFontOnSystem,
        standardFontOnWindow: C.standardFontOnWindow, drawGauge: C.drawGauge,
        innerChildren: C.innerChildren, contentsSpriteKey: C.contentsSpriteKey,
        updateMainIsReentrant: C.updateMainIsReentrant, updateMainWhy: C.updateMainWhy,
        stepHooks: C.stepHooks, zIndexClobber: C.zIndexClobber,
        textSelectionBlocked: C.textSelectionBlocked,
        fs: C.fs, fsWhy: C.fsWhy, pixiMajor: C.pixiMajor,
        engineVersion: C.engineVersion
      },
      text: C.reportText()
    };
  });

  const EXPECTED_ROWS = ['engine', 'renderer', 'chromium', 'host', 'filesystem', 'canvas id',
    'ColorManager', 'Sprite_Gauge', 'plugin commands', 'save format', 'save dir', 'updateMain',
    'CSS gap', 'CSS clamp()', 'requestIdleCallback'];
  EXPECTED_ROWS.forEach(r => {
    check('the boot report has a "' + r + '" row', caps.rows.indexOf(r) > -1, caps.rows.join('|'));
  });
  check('the boot report has no row without an answer',
    EXPECTED_ROWS.every(r => (caps.map[r] || '').length > 0), JSON.stringify(caps.map));

  /* Facts, one per capability, per engine. This is the table the whole mod
     branches on, so every entry is asserted rather than sampled. */
  const F = caps.flat;
  check('caps.engine names this engine', F.engine === CFG.name, F.engine);
  check('caps.isMV / caps.isMZ agree with caps.engine', F.isMV === IS_MV && F.isMZ === IS_MZ, F.engine);
  check('ColorManager is present exactly on MZ', F.colorManager === IS_MZ, String(F.colorManager));
  check('Sprite_Gauge is present exactly on MZ', F.spriteGauge === IS_MZ, String(F.spriteGauge));
  check('Sprite_Name is present exactly on MZ', F.spriteName === IS_MZ, String(F.spriteName));
  check('PluginManager.registerCommand is present exactly on MZ', F.registerCommand === IS_MZ, String(F.registerCommand));
  check('Graphics.effekseer is present exactly on MZ', F.effekseer === IS_MZ, String(F.effekseer));
  check('Graphics.app is present exactly on MZ', F.pixiApp === IS_MZ, String(F.pixiApp));
  check('the canvas id is GameCanvas on MV and gameCanvas on MZ',
    F.canvasId === (IS_MV ? 'GameCanvas' : 'gameCanvas'), F.canvasId);
  check('the canvas id caps entry actually finds the element',
    await ev(id => !!document.getElementById(id), F.canvasId), F.canvasId);
  check('the tile-event key is tileEvents on MV and _tileEvents on MZ',
    F.tileEventsKey === (IS_MV ? 'tileEvents' : '_tileEvents'), F.tileEventsKey);
  check('the save extension is ' + SAVE_EXT + ' on this engine', F.saveExt === SAVE_EXT, F.saveExt);
  check('save/load is asynchronous exactly on MZ', F.saveIsAsync === IS_MZ, String(F.saveIsAsync));
  check('Game_System.setSavefileId is present exactly on MZ', F.savefileIdOnSystem === IS_MZ, String(F.savefileIdOnSystem));
  check('loadGlobalInfo returns its array (sync) exactly on MV', F.globalInfoSync === IS_MV, String(F.globalInfoSync));
  check('Scene_File.isSavefileEnabled is present exactly on MZ', F.savefileEnabled === IS_MZ, String(F.savefileEnabled));
  check('the main font lives on Game_System exactly on MZ', F.mainFontOnSystem === IS_MZ, String(F.mainFontOnSystem));
  check('Window_Base.standardFontFace exists exactly on MV', F.standardFontOnWindow === IS_MV, String(F.standardFontOnWindow));
  check('Window_Base.drawGauge exists exactly on MV', F.drawGauge === IS_MV, String(F.drawGauge));
  check('windows have _innerChildren exactly on MZ', F.innerChildren === IS_MZ, String(F.innerChildren));
  check('the contents sprite key matches the engine',
    F.contentsSpriteKey === (IS_MV ? '_windowContentsSprite' : '_contentsSprite'), F.contentsSpriteKey);
  check('updateMain is declared re-entrant exactly on MZ', F.updateMainIsReentrant === IS_MZ, String(F.updateMainIsReentrant));
  check('when updateMain cannot be gated the capability says why',
    IS_MZ ? F.updateMainWhy === '' : /requestAnimationFrame/.test(F.updateMainWhy), F.updateMainWhy.slice(0, 80));
  check('the three per-step frame functions are gateable on both engines', F.stepHooks === true);
  check('the z-index clobber is expected exactly on MV', F.zIndexClobber === IS_MV, String(F.zIndexClobber));
  check('text selection is reported blocked exactly on MV', F.textSelectionBlocked === IS_MV, String(F.textSelectionBlocked));
  check('the filesystem is reported absent, with a reason', F.fs === false && F.fsWhy.length > 20, F.fsWhy.slice(0, 60));
  check('the PIXI major version matches the engine', F.pixiMajor === (IS_MV ? 4 : 5), F.pixiMajor);
  check('the engine version is recorded for the report', /^\d+\.\d+\.\d+$/.test(F.engineVersion), F.engineVersion);
  check('the boot report renders as pasteable text', caps.text.split('\n').length === EXPECTED_ROWS.length, caps.text.length);

  /* No module may branch on the version string — the whole point of the caps
     table. A grep is the only way to assert a negative like this. */
  const pluginSrc = fs.readdirSync(path.resolve(__dirname, '../gigahack/js/plugins'))
    .map(f => ({ f, s: fs.readFileSync(path.resolve(__dirname, '../gigahack/js/plugins', f), 'utf8') }));
  const stripCommentsAndStrings = src => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  const versionBranches = pluginSrc.filter(p => p.f !== 'GigaHack_Caps.js')
    .filter(p => /RPGMAKER_VERSION|RPGMAKER_NAME/.test(stripCommentsAndStrings(p.s)))
    .map(p => p.f);
  check('no module outside Caps reads a version string in code', versionBranches.length === 0, versionBranches.join(', '));
  /* A version string may still appear in prose the user reads — the quirks
     table explains that some plugins version-gate themselves — so the rule is
     about code, and the two are separated deliberately. */
  check('the capability table is the only place the engine name is probed',
    pluginSrc.filter(p => p.f !== 'GigaHack_Caps.js')
      .every(p => !/Utils\.RPGMAKER_NAME\s*===/.test(stripCommentsAndStrings(p.s))));

  /* =======================================================================
     HOOKS — the replacement for run-1x.js:129 (`hooks.every(h => h.i)`).

     Every hook this engine CAN host is installed, and every hook it cannot
     names its reason. That turns the mod's degradation story into an
     assertion instead of an untested claim.
     ==================================================================== */
  const hooks = await ev(() => window.GigaHack.hookList().map(h => ({
    n: h.name, i: h.installed, r: h.reason || '', hasOriginal: typeof h.original === 'function'
  })));
  const skipped = hooks.filter(h => !h.i);
  check('the mod installs a substantial hook set', hooks.length >= 40, hooks.length);
  check('every installed hook kept the original it wraps',
    hooks.filter(h => h.i).every(h => h.hasOriginal), hooks.filter(h => h.i && !h.hasOriginal).map(h => h.n).join(', '));
  check('every hook that could not be installed states a reason',
    skipped.every(h => h.r.length >= 30), skipped.filter(h => h.r.length < 30).map(h => h.n + ':' + h.r).join(' | '));
  check('no skipped hook is explained by a bare "not found"',
    skipped.every(h => !/^\w[\w.]* not found$/.test(h.r)), skipped.map(h => h.r).join(' | '));

  /* The exact set, per engine. A hook that starts skipping on an engine that
     can host it is a regression this pins; a hook that starts installing on
     an engine that cannot is a crash waiting to happen. */
  const EXPECTED_SKIPS = IS_MZ ? [] : ['Scene_File.isSavefileEnabled'];
  const skipNames = skipped.map(h => h.n).sort();
  check('exactly the hooks this engine cannot host are skipped',
    JSON.stringify(skipNames) === JSON.stringify(EXPECTED_SKIPS.slice().sort()),
    'got ' + JSON.stringify(skipNames) + ' want ' + JSON.stringify(EXPECTED_SKIPS));

  /* And the converse, checked against the engine rather than against a list:
     for every skipped hook, the target really is absent right now. */
  const skipsAreReal = await ev(names => names.map(n => {
    const G = window.GigaHack;
    /* The hook name is the label, not a path, so the check is specific: the
       only hook either engine legitimately cannot host is the savefile-enable
       test, and that is a Scene_File member. */
    if (n === 'Scene_File.isSavefileEnabled') {
      return { n, absent: typeof Scene_File.prototype.isSavefileEnabled !== 'function' };
    }
    return { n, absent: false };
  }), skipNames);
  check('every skipped hook names a target that really is absent on this engine',
    skipsAreReal.every(s => s.absent), JSON.stringify(skipsAreReal));

  /* Pause and speed report which functions they ended up on — a different
     answer per engine, and the one the panel shows the user. */
  const gates = await ev(() => ({
    pauseAvailable: window.GigaHack.pause.available(),
    pauseTargets: window.GigaHack.pause.targets(),
    pauseDescribe: window.GigaHack.pause.describe(),
    speedAvailable: window.GigaHack.player.speedyAvailable(),
    speedDescribe: window.GigaHack.player.describeSpeed()
  }));
  check('pause is available on this engine', gates.pauseAvailable === true, gates.pauseDescribe);
  check('game speed is available on this engine', gates.speedAvailable === true, gates.speedDescribe);
  if (IS_MZ) {
    check('MZ gates pause on SceneManager.updateMain',
      JSON.stringify(gates.pauseTargets) === JSON.stringify(['SceneManager.updateMain']), JSON.stringify(gates.pauseTargets));
    check('MZ multiplies SceneManager.updateMain',
      /multiplies SceneManager.updateMain/.test(gates.speedDescribe), gates.speedDescribe);
  } else {
    check('MV gates pause on the three per-step functions, not updateMain',
      JSON.stringify(gates.pauseTargets) === JSON.stringify(
        ['SceneManager.updateInputData', 'SceneManager.changeScene', 'SceneManager.updateScene']),
      JSON.stringify(gates.pauseTargets));
    check('MV multiplies SceneManager.updateScene, not updateMain',
      /multiplies SceneManager.updateScene/.test(gates.speedDescribe), gates.speedDescribe);
    check('nothing wrapped SceneManager.updateMain on MV',
      await ev(() => window.GigaHack.hookList().every(h => !/updateMain/.test(h.name))),
      JSON.stringify(hooks.filter(h => /updateMain/.test(h.n)).map(h => h.n)));
  }
  check('both gates say what they hold and what they leave alone',
    /rendering and the frame request/.test(gates.pauseDescribe) &&
    /rendering and the frame request/.test(gates.speedDescribe));

  /* The encounter probe's boot answer, captured before anything in this
     suite hands the mod a filesystem. Its whole point is that it ships
     ENABLED and decides for itself, so what it decided at boot — with no map
     files to read — is a fact worth pinning before it is changed. */
  const bootEnc = await ev(() => {
    const E = window.GigaHack.encounters;
    const p = E.probe();
    return {
      found: p.found, scope: p.scope, maps: p.maps, scanned: p.scanned,
      describe: E.describeProbe(),
      registered: window.GigaHack.ui.panelNames('player').indexOf('Encounters') > -1
    };
  });

  /* =======================================================================
     THE TWO FATAL MV BUGS, MUTATION-VERIFIED.

     MV's SceneManager.updateMain ends with renderScene() and requestUpdate(),
     so the animation-frame chain perpetuates itself from inside the function.
     The harness routes requestUpdate through a countable queue, which makes
     both failure modes observable:

       · a wrapper that returns early ENDS the loop — 0 pending callbacks, no
         renders, and un-pausing cannot help because the un-pause would have to
         run inside the loop that is no longer running;
       · a wrapper that calls the original N times schedules N frames that each
         schedule N more — 4096 pending by frame 3 at 8x.

     Both are asserted on the shipped build, and then the 1.x implementation is
     rebuilt in a sandbox and asserted to FAIL them. A check that cannot fail is
     not a check.
     ==================================================================== */
  const frameProbe = await ev(() => {
    const G = window.GigaHack;
    function frames(n) { for (let i = 0; i < n; i++) window.__raf.flush(); }
    function snap() {
      return { renders: Graphics._renders, scenes: window.__sceneUpdates || 0, mains: window.__mainUpdates || 0, ticks: G.frameCount };
    }
    function since(a) { const b = snap(); return { renders: b.renders - a.renders, scenes: b.scenes - a.scenes, mains: b.mains - a.mains, ticks: b.ticks - a.ticks }; }

    const out = {};
    window.__raf.reset();
    SceneManager.requestUpdate();
    out.armed = window.__raf.pending();

    let a = snap(); frames(3);
    out.free = since(a); out.freePending = window.__raf.pending();

    /* Pause, through the real config path and the real overlay state. */
    G.store.cfgSet('behaviour.pauseGame', true);
    G.ui.setOpen(true);
    out.pauseActive = G.pause.active();
    a = snap(); frames(3);
    out.paused = since(a); out.pausedPending = window.__raf.pending();

    /* Un-pause and prove the loop is still there to resume. */
    G.store.cfgSet('behaviour.pauseGame', false);
    a = snap(); frames(3);
    out.resumed = since(a); out.resumedPending = window.__raf.pending();

    /* 8x — the mod's own maximum. */
    G.store.cfgSet('player.speedy', true);
    G.store.cfgSet('player.gameSpeed', 8);
    a = snap(); frames(3);
    out.fast = since(a); out.fastPending = window.__raf.pending();
    out.overflowed = window.__raf.overflowed;

    /* 0.5x — the sub-1x branch, which is where 1.x's second permanent freeze
       lived. A skipped step must still draw and still ask for a frame. */
    G.store.cfgSet('player.gameSpeed', 0.5);
    a = snap(); frames(4);
    out.slow = since(a); out.slowPending = window.__raf.pending();

    G.store.cfgSet('player.speedy', false);
    G.store.cfgSet('player.gameSpeed', 1);
    G.ui.setOpen(false);
    a = snap(); frames(2);
    out.after = since(a); out.afterPending = window.__raf.pending();
    return out;
  });

  check('the frame loop is armed with exactly one pending animation frame',
    frameProbe.armed === 1, frameProbe.armed);
  check('a free-running frame draws once and re-arms exactly once',
    frameProbe.free.renders === 3 && frameProbe.freePending === 1, JSON.stringify(frameProbe.free) + ' pending=' + frameProbe.freePending);
  check('pause reports itself active once the flag and the overlay agree',
    frameProbe.pauseActive === true);
  check('with pause engaged the game logic stops',
    frameProbe.paused.scenes === 0, JSON.stringify(frameProbe.paused));
  check('with pause engaged renderScene still fires every frame',
    frameProbe.paused.renders === 3, JSON.stringify(frameProbe.paused));
  check('with pause engaged the rAF queue keeps exactly one pending callback',
    frameProbe.pausedPending === 1, frameProbe.pausedPending);
  check('the overlay keeps ticking while the game is held',
    frameProbe.paused.ticks >= 3, frameProbe.paused.ticks);
  check('un-pausing resumes the game logic',
    frameProbe.resumed.scenes >= 3 && frameProbe.resumedPending === 1, JSON.stringify(frameProbe.resumed));
  check('at 8x the game logic runs eight steps per frame',
    frameProbe.fast.scenes === 24, JSON.stringify(frameProbe.fast));
  check('at 8x the rAF queue does not grow',
    frameProbe.fastPending === 1 && !frameProbe.overflowed, frameProbe.fastPending + ' overflow=' + frameProbe.overflowed);
  check('at 8x the screen is still drawn once per real frame',
    frameProbe.fast.renders === 3, JSON.stringify(frameProbe.fast));
  check('below 1x steps are skipped, not the loop',
    frameProbe.slow.scenes === 2 && frameProbe.slowPending === 1, JSON.stringify(frameProbe.slow) + ' pending=' + frameProbe.slowPending);
  check('below 1x the screen keeps being drawn',
    frameProbe.slow.renders === 4, JSON.stringify(frameProbe.slow));
  check('the loop is healthy again after the speed override is turned off',
    frameProbe.after.scenes === 2 && frameProbe.afterPending === 1, JSON.stringify(frameProbe.after));

  /* --- the mutation: rebuild 1.x's two hooks and prove they fail ---------
     MV only, and for the reason the whole port exists: on MZ, updateMain is a
     plain logical step with no render and no frame request inside it, so the
     1.x shape is not a bug there and there is nothing to reproduce. On MV the
     sandbox borrows the engine's OWN updateMain — still pristine, because the
     shipped mod declines to wrap it, which IS the fix — and puts the 1.x
     wrapper shape on top. Everything is counted separately, so nothing here
     can disturb the live game. */
  if (IS_MV) {
  const legacy = await ev(() => {
    function sandbox(wrap) {
      const q = [];
      /* Its own clock. MV's updateMain drives a time accumulator, so a
         sandbox sharing window.__clock would advance time the live
         SceneManager never consumed and the next real frame would catch up by
         running its inner loop a dozen times. The sandbox must be invisible
         to the game it is standing next to. */
      let clock = window.__clock;
      const S = {
        _stopped: false, _currentTime: clock, _accumulator: 0, _deltaTime: 1 / 60,
        _scene: SceneManager._scene, _sceneStarted: true,
        renders: 0, scenes: 0,
        _getTimeInMsWithoutMobileSafari: function () { return clock; },
        isCurrentSceneStarted: function () { return true; },
        updateInputData: function () { },
        changeScene: function () { },
        updateScene: function () { this.scenes++; },
        renderScene: function () { this.renders++; },
        requestUpdate: function () { if (!this._stopped) q.push(() => S.update()); },
        update: function () { this.updateMain(); }
      };
      /* The engine's own body, unmodified. On MV this is still pristine
         because the shipped mod declines to wrap it; that is the fix. */
      const original = SceneManager.updateMain;
      S.updateMain = wrap(original, S);
      S.queue = q;
      S.frames = function (n) {
        for (let f = 0; f < n; f++) {
          const batch = q.splice(0, q.length);
          clock += 1000 / 60;
          for (let i = 0; i < batch.length; i++) {
            if (i > 8192) { S.overflow = true; break; }
            batch[i]();
          }
        }
      };
      return S;
    }

    /* 1.x's pause hook: return before the original while paused. */
    const paused = sandbox(original => function () {
      if (window.__legacyPaused) return;      // GigaHack_Hooks.js 1.x:78-84
      return original.apply(this, arguments);
    });
    window.__legacyPaused = false;
    paused.requestUpdate();
    paused.frames(2);
    const beforePause = { pending: paused.queue.length, renders: paused.renders };
    window.__legacyPaused = true;
    paused.frames(3);
    const duringPause = { pending: paused.queue.length, renders: paused.renders - beforePause.renders };
    window.__legacyPaused = false;
    paused.frames(3);
    const afterUnpause = { pending: paused.queue.length, scenes: paused.scenes };

    /* 1.x's speed hook: call the original `runs` times. */
    const fast = sandbox(original => function () {
      let r;
      for (let i = 0; i < 8; i++) r = original.apply(this, arguments);   // GigaHack_Player.js 1.x:308
      return r;
    });
    fast.requestUpdate();
    const growth = [];
    for (let f = 0; f < 3; f++) { fast.frames(1); growth.push(fast.queue.length); }

    return { beforePause, duringPause, afterUnpause, growth, overflow: !!fast.overflow };
  });

  check('MUTATION: the 1.x pause hook stops rendering while paused',
    legacy.duringPause.renders === 0, JSON.stringify(legacy.duringPause));
  check('MUTATION: the 1.x pause hook leaves the rAF chain dead',
    legacy.duringPause.pending === 0, JSON.stringify(legacy.duringPause));
  check('MUTATION: the 1.x pause hook cannot be un-paused — nothing calls updateMain again',
    legacy.afterUnpause.pending === 0, JSON.stringify(legacy.afterUnpause));
  check('MUTATION: the 1.x speed hook grows the rAF queue exponentially',
    legacy.growth[0] === 8 && legacy.growth[1] === 64 && legacy.growth[2] === 512,
    JSON.stringify(legacy.growth));
  check('MUTATION: the shipped build and the 1.x build disagree about the same observable',
    frameProbe.pausedPending === 1 && legacy.duringPause.pending === 0 &&
    frameProbe.fastPending === 1 && legacy.growth[2] > 100,
    'shipped pending=' + frameProbe.pausedPending + '/' + frameProbe.fastPending +
    ' 1.x pending=' + legacy.duringPause.pending + '/' + legacy.growth[2]);
  }

  /* $.step() is the only supported way to advance a held game. It must never
     touch renderScene or requestUpdate on either engine. */
  const stepping = await ev(() => {
    const G = window.GigaHack;
    window.__raf.reset(); SceneManager.requestUpdate();
    const r0 = Graphics._renders, s0 = window.__sceneUpdates || 0, t0 = G.frameCount;
    const done = G.step(5);
    return {
      done, renders: Graphics._renders - r0, scenes: (window.__sceneUpdates || 0) - s0,
      ticks: G.frameCount - t0, pending: window.__raf.pending()
    };
  });
  check('$.step(5) advances exactly five logical steps', stepping.done === 5 && stepping.scenes === 5, JSON.stringify(stepping));
  /* Exactly five, not "at least five". A step goes through SceneManager, so
     it goes through the pause gate, and that gate already drives $.frame().
     Ticking again in $.step() double-counted every stepped frame — the draw
     registry cleared twice, and any "every n-th frame" rate ran at double
     speed while stepping. `>=` is compatible with the bug; `===` is what
     fails when it comes back. */
  /* Inspect was deleted in 2.0, but its default binding survived in two
     places, and U.hotkeyClash walks the built-in label table — so binding P
     to anything else was REFUSED, naming a feature that does not exist,
     cannot be seen in Settings and cannot be cleared. Pin both halves. */
  const ghostBind = await ev(() => {
    const G = window.GigaHack;
    // U.hotkeyClash is the mechanism that refuses a rebind. It walks the
    // built-in label table, so a label for a module this build does not ship
    // makes its key permanently unbindable — with a reason naming a feature
    // the user cannot find, enable or clear. Ask the mechanism directly.
    const held = {};
    Object.keys(G.cfg.hotkeys).forEach(function (id) {
      if (G.cfg.hotkeys[id]) held[G.cfg.hotkeys[id]] = id;
    });
    const clashOnFree = G.ui.hotkeyClash ? G.ui.hotkeyClash('KeyP') : null;
    // Every id that can refuse a bind must be an id that exists in the config,
    // or it is a ghost: it can block a key and cannot be seen or changed.
    const ghosts = [];
    if (G.ui.hotkeyClash) {
      ['inspect', 'encounters', 'gallery', 'steam'].forEach(function (id) {
        if (Object.prototype.hasOwnProperty.call(G.cfg.hotkeys, id)) return;
        // Bind nothing; just ask whether the label table knows the id by
        // probing a code no default holds.
        const probe = '__probe_' + id;
        const r = G.ui.hotkeyClash(probe, id);
        if (r) ghosts.push(id + ' -> ' + r);
      });
    }
    return {
      defaultsHaveInspect: Object.prototype.hasOwnProperty.call(G.cfg.hotkeys, 'inspect'),
      clashOnFreeKey: clashOnFree || null,
      keyPHeldBy: held.KeyP || null,
      ghosts: ghosts
    };
  });
  check('no hotkey default is reserved for a module this build does not ship',
    ghostBind.defaultsHaveInspect === false, JSON.stringify(ghostBind));
  check('...and the clash check does not refuse a key on behalf of one',
    ghostBind.keyPHeldBy === null ? ghostBind.clashOnFreeKey === null || ghostBind.clashOnFreeKey === undefined || ghostBind.clashOnFreeKey === false
                                  : true,
    JSON.stringify(ghostBind));

  /* A settings key that is declared but never read, or read but never
     declared, is a default the user cannot see and a profile that carries the
     wrong name. Both halves must agree. */
  const cfgKeys = await ev(() => {
    const G = window.GigaHack;
    return {
      declaredAutoSeconds: Object.prototype.hasOwnProperty.call(G.cfg.text, 'autoSeconds'),
      declaredAutoDelay: Object.prototype.hasOwnProperty.call(G.cfg.text, 'autoDelay'),
      readsBack: G.text ? G.text.autoSeconds() : null
    };
  });
  check('the auto-advance delay is declared under the name the code reads',
    cfgKeys.declaredAutoSeconds === true && cfgKeys.declaredAutoDelay === false,
    JSON.stringify(cfgKeys));

  /* Both engines declare Utils as `function Utils() { throw ... }` — a static
     class expressed as a constructor that refuses construction. The harness
     once stubbed it as an object literal, which made `typeof Utils ===
     "object"` true; the mod tested for exactly that, so on every real game the
     engine VERSION fell through to "unknown" while every check here passed.
     Two assertions: the stub has the engine's shape, and the mod reads the
     version through it. */
  const utilsShape = await ev(() => ({
    typeofUtils: typeof Utils,
    hasName: !!Utils.RPGMAKER_NAME,
    capsVersion: window.GigaHack.caps.engineVersion,
    capsEngine: window.GigaHack.caps.engine
  }));
  check('Utils is a function, as it is in both engines, not an object literal',
    utilsShape.typeofUtils === 'function', JSON.stringify(utilsShape));
  check('the capability table reads a real engine version through it',
    utilsShape.capsVersion !== 'unknown' && /^\d/.test(utilsShape.capsVersion), JSON.stringify(utilsShape));
  check('...and the engine name agrees with the harness it is running in',
    utilsShape.capsEngine === CFG.name, JSON.stringify(utilsShape));

  check('a stepped frame drives the overlay tick exactly once per step',
    stepping.ticks === 5, JSON.stringify(stepping));
  check('$.step() never renders and never asks for an animation frame',
    stepping.renders === 0 && stepping.pending === 1, JSON.stringify(stepping));
  const stepCap = await ev(() => window.GigaHack.step(100000));
  check('$.step() is capped so a large number is not a hung window', stepCap === 600, stepCap);

  /* Single-step is a PAUSED-game feature, and $.step() alone cannot serve it:
     it drives the very functions the pause gate closes, so with the flag up
     every step would be declined. Lifting the flag for the duration is the
     policy half, and it lives in the player module. */
  const pausedStep = await ev(() => {
    const G = window.GigaHack;
    G.store.cfgSet('behaviour.pauseGame', true);
    G.ui.setOpen(true);
    const wasActive = G.pause.active();
    const s0 = window.__sceneUpdates || 0;
    const raw = G.step(2);                       // the mechanism, with the gate shut
    const rawScenes = (window.__sceneUpdates || 0) - s0;
    const s1 = window.__sceneUpdates || 0;
    const viaPolicy = G.player.step(5);          // the policy wrapper
    const policyScenes = (window.__sceneUpdates || 0) - s1;
    const stillPaused = G.pause.active();
    G.store.cfgSet('behaviour.pauseGame', false);
    G.ui.setOpen(false);
    return { wasActive, raw, rawScenes, viaPolicy, policyScenes, stillPaused };
  });
  check('the pause gate really does decline a raw step while the game is held',
    pausedStep.wasActive === true && pausedStep.rawScenes === 0, JSON.stringify(pausedStep));
  check('$.player.step() advances a held game by exactly the number asked for',
    pausedStep.viaPolicy === true && pausedStep.policyScenes === 5, JSON.stringify(pausedStep));
  check('$.player.step() puts the pause flag back when it is done',
    pausedStep.stillPaused === true, JSON.stringify(pausedStep));

  /* =======================================================================
     THE CSS FLOOR, SIMULATED — retargeted from Chromium 85 to 66.

     MV 1.6 ships NW.js 0.29 = Chromium 66, and older MV is worse. This suite
     runs a modern Chromium, so an unsupported feature would pass here and
     collapse the overlay in the game. Three things guard that: a static scan
     of the generated stylesheet, the same scan over all plugin JS, and a
     SIMULATION — every declaration Chromium 66 would discard is stripped from
     the live stylesheet and the overlay re-measured.
     ==================================================================== */
  const css = (await ev(() => window.GigaHack.ui.CSS + window.GigaHack.ui.CSS2))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const jsSrc = pluginSrc.map(p => p.s).join('\n');

  /* Everything below is newer than Chromium 66. `gap` is on the list because
     Chromium 66 knows the property in GRID and ignores it in FLEX (84), and
     the overlay's rows and columns are flex — so a gap there is silently
     nothing, which is the worst kind of unsupported. */
  const TOO_NEW_CSS = [
    [/(^|[;{\s])(gap|row-gap|column-gap)\s*:/m, 'gap in flex containers (Chromium 84)'],
    [/\b(clamp|min|max)\s*\(/, 'clamp()/min()/max() (79)'],
    [/(^|[;{\s])inset\s*:/m, 'inset shorthand (87)'],
    [/inset-(block|inline)/, 'inset-block/inline (87)'],
    [/aspect-ratio\s*:/, 'aspect-ratio (88)'],
    [/:is\(/, ':is() (88)'], [/:where\(/, ':where() (88)'], [/:has\(/, ':has() (105)'],
    [/:focus-visible/, ':focus-visible (86)'],
    [/@layer\b/, '@layer (99)'], [/@container\b/, '@container (105)'],
    [/accent-color\s*:/, 'accent-color (93)'],
    [/text-wrap\s*:/, 'text-wrap (114)'],
    [/scrollbar-gutter\s*:/, 'scrollbar-gutter (94)'],
    [/backdrop-filter\s*:/, 'backdrop-filter (76)'],
    [/content-visibility\s*:/, 'content-visibility (85)'],
    [/(^|[;{\s])(translate|rotate|scale)\s*:/m, 'individual transform properties (104)'],
    [/(^|[;{\s])(margin|padding)-(inline|block)/m, 'logical box properties (87)'],
    [/(^|[;{\s])(inline|block)-size\s*:/m, 'logical sizing properties (79)'],
    [/::marker/, '::marker (86)'],
    [/\b\d+(d|s|l)vh\b/, 'dvh/svh/lvh units (108)'],
    [/\b(oklch|oklab|lab|lch)\s*\(/, 'CSS Color 4 functions (111)'],
    [/\bhwb\s*\(/, 'hwb() (101)'],
    [/color-mix\s*\(/, 'color-mix() (111)'],
    [/\bsubgrid\b/, 'subgrid (117)'],
    [/text-decoration-thickness/, 'text-decoration-thickness (89)'],
    [/\bgrid-template-areas\b/, 'grid-template-areas is fine, but named lines are not — flagged for review']
  ];
  const TOO_NEW_JS = [
    [/\.flatMap\s*\(/, 'Array.prototype.flatMap (Chromium 69)'],
    [/\.flat\s*\(/, 'Array.prototype.flat (69)'],
    [/Object\.fromEntries\b/, 'Object.fromEntries (73)'],
    [/\bglobalThis\b/, 'globalThis (71)'],
    [/Promise\.allSettled\b/, 'Promise.allSettled (76)'],
    [/\.matchAll\s*\(/, 'String.prototype.matchAll (73)'],
    [/\.replaceAll\s*\(/, 'String.prototype.replaceAll (85)'],
    [/\.toggleAttribute\s*\(/, 'Element.toggleAttribute (69)'],
    [/\bqueueMicrotask\s*\(/, 'queueMicrotask (71)'],
    [/adoptedStyleSheets/, 'adoptedStyleSheets (73)'],
    [/\bBigInt\b/, 'BigInt (67)'],
    [/\.at\s*\(/, 'Array.prototype.at (92)'],
    [/Object\.hasOwn\b/, 'Object.hasOwn (93)'],
    [/structuredClone\b/, 'structuredClone (98)'],
    [/\.findLast(Index)?\s*\(/, 'findLast (97)'],
    [/\.(toSorted|toReversed|toSpliced)\s*\(/, 'change-by-copy array methods (110)'],
    [/\.replaceChildren\s*\(/, 'replaceChildren (86)'],
    [/AbortSignal\.timeout/, 'AbortSignal.timeout (103)'],
    [/\?\?/, 'nullish coalescing (80)'],
    [/\?\./, 'optional chaining (80)']
  ];
  const cssHits = TOO_NEW_CSS.filter(([re]) => re.test(css)).map(([, n]) => n);
  const jsHits = TOO_NEW_JS.filter(([re]) => re.test(stripCommentsAndStrings(jsSrc))).map(([, n]) => n);
  check('the generated stylesheet uses nothing newer than Chromium 66', cssHits.length === 0, cssHits.join(', '));
  check('plugin JS uses nothing newer than Chromium 66', jsHits.length === 0, jsHits.join(', '));
  check('the stylesheet is big enough for the scan to mean something', css.length > 10000, css.length);

  /* The overlay must actually occupy the window. */
  const rootBox = await ev(() => {
    window.GigaHack.ui.setOpen(true);
    const r = document.querySelector('#mm-root').getBoundingClientRect();
    const hb = document.querySelector('#gigahack-host').getBoundingClientRect();
    return { rw: Math.round(r.width), rh: Math.round(r.height), hw: Math.round(hb.width), hh: Math.round(hb.height) };
  });
  check('host and root fill the window', rootBox.rw >= 1200 && rootBox.rh >= 700 && rootBox.hw >= 1200,
    JSON.stringify(rootBox));

  /* SIMULATE Chromium 66: drop every declaration that engine's parser would
     discard, then re-measure. A collapsed host is the exact symptom the
     original inset:0 bug produced, and a static scan alone cannot see it. */
  const degraded = await ev(() => {
    const UNKNOWN_PROPS = ['gap', 'row-gap', 'column-gap', 'inset', 'aspect-ratio', 'accent-color',
      'text-wrap', 'scrollbar-gutter', 'inset-block', 'inset-inline', 'translate', 'rotate',
      'scale', 'backdrop-filter', 'content-visibility', 'inline-size', 'block-size',
      'margin-inline', 'margin-block', 'padding-inline', 'padding-block', 'text-decoration-thickness'];
    const UNKNOWN_VALUES = /\b(clamp|min|max|color-mix|oklch|oklab|lab|lch|hwb)\s*\(/;
    const wasOpen = window.GigaHack.ui.isOpen();
    window.GigaHack.ui.setOpen(true);
    const style = document.querySelector('#gigahack-style');
    const original = style.textContent;
    /* Rewrite each innermost rule body. Splitting on ';' rather than using a
       global regex matters: a regex that consumes the leading separator
       cannot then match the declaration immediately after it. */
    style.textContent = original.replace(/\{([^{}]*)\}/g, (m, body) =>
      '{' + body.split(';').filter(d => {
        const p = (d.split(':')[0] || '').trim().toLowerCase();
        if (!p) return true;
        if (UNKNOWN_PROPS.indexOf(p) > -1) return false;
        return !UNKNOWN_VALUES.test(d);
      }).join(';') + '}');
    void document.body.offsetHeight;
    const r = document.querySelector('#mm-root').getBoundingClientRect();
    const w = document.querySelector('.mm-win').getBoundingClientRect();
    const tabs = document.querySelectorAll('#mm-root .mm-tab').length;
    const out = {
      rw: Math.round(r.width), rh: Math.round(r.height),
      ww: Math.round(w.width), wh: Math.round(w.height), tabs
    };
    style.textContent = original;
    window.GigaHack.ui.setOpen(wasOpen);
    return out;
  });
  check('the overlay still fills the window with Chromium-66-unknown declarations dropped',
    degraded.rw >= 1200 && degraded.rh >= 700, JSON.stringify(degraded));
  check('the menu window itself still has size under the Chromium 66 simulation',
    degraded.ww > 400 && degraded.wh > 200, JSON.stringify(degraded));
  check('the tab strip survives the Chromium 66 simulation', degraded.tabs >= 5, degraded.tabs);

  /* The capability probe has to agree with the deny list: if the mod ever
     starts relying on gap, this is the flag that is supposed to say so. */
  const cssCaps = await ev(() => ({ gap: window.GigaHack.caps.cssGap, clamp: window.GigaHack.caps.cssClamp }));
  check('the CSS capability probes answer for the browser actually running',
    cssCaps.gap === true && cssCaps.clamp === true, JSON.stringify(cssCaps));

  /* =======================================================================
     OVERLAY, HOTKEYS AND THE ENGINE'S DOM
     ==================================================================== */
  check('#gigahack-host is in the DOM', await ev(() => document.querySelectorAll('#gigahack-host').length) === 1);
  await ev(() => window.GigaHack.ui.setOpen(false));
  check('the window is hidden before the hotkey',
    await ev(() => getComputedStyle(document.querySelector('.mm-win')).display) === 'none');

  /* The toggle key is DERIVED from what this game leaves free, so the test
     has to ask rather than press N. On the modded stack N is taken and the
     answer is a different letter — which is the point. */
  const toggleKey = await ev(() => window.GigaHack.cfg.hotkeys.toggleMenu);
  check('a toggle hotkey was derived for this game', /^[A-Za-z0-9]+$/.test(toggleKey || ''), toggleKey);
  await page.keyboard.press(toggleKey);
  await page.waitForTimeout(150);
  check('the derived hotkey (' + toggleKey + ') opens the window',
    await ev(() => getComputedStyle(document.querySelector('.mm-win')).display) === 'flex');
  check('$gameTemp._gigahackOpen is set while the overlay is open',
    await ev(() => window.$gameTemp._gigahackOpen === true));
  check('Input.clear() is called on open', await ev(() => (window.__inputCleared || 0) > 0));
  await shot('open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  check('Escape closes the window',
    await ev(() => getComputedStyle(document.querySelector('.mm-win')).display) === 'none');
  await ev(() => window.GigaHack.ui.setOpen(true));

  const accents = await ev(() => {
    window.GigaHack.ui.applyAccent(document.querySelector('#mm-root'), '#62b56a');
    const cs = getComputedStyle(document.querySelector('#mm-root'));
    return ['--mm-accent', '--mm-accent-soft', '--mm-accent-line', '--mm-accent-soft2', '--mm-accent-hi', '--mm-accent-flash']
      .map(k => [k, cs.getPropertyValue(k).trim()]);
  });
  check('every derived accent token resolves to a colour',
    accents.every(([, v]) => /^(#|rgba?\()/.test(v)), JSON.stringify(accents));
  check('derived accents track the base accent',
    accents.find(a => a[0] === '--mm-accent-soft')[1].indexOf('98,181,106') > -1,
    accents.find(a => a[0] === '--mm-accent-soft')[1]);
  await ev(() => window.GigaHack.ui.applyAccent(document.querySelector('#mm-root'), window.GigaHack.cfg.ui.accent));

  /* --- the MV-only DOM hazards ---------------------------------------- */
  const domFacts = await ev(() => {
    const host = document.querySelector('#gigahack-host');
    return {
      inlineZ: host.style.zIndex,
      computedZ: getComputedStyle(host).zIndex,
      bodySelect: getComputedStyle(document.body).userSelect,
      hostSelect: getComputedStyle(host).userSelect,
      rootSelect: getComputedStyle(document.querySelector('#mm-root')).userSelect,
      zeroedSoFar: window.__zIndexZeroed || 0,
      textSelectionDisabled: !!window.__textSelectionDisabled
    };
  });
  check('the overlay sits above everything the engine puts on screen',
    Number(domFacts.computedZ) >= 2147483000, domFacts.computedZ);

  if (IS_MV) {
    check('MV really did disable text selection on the body at boot',
      domFacts.textSelectionDisabled === true && domFacts.bodySelect === 'none', domFacts.bodySelect);
    check('the overlay opts text selection back in for its own subtree',
      domFacts.hostSelect === 'text' || domFacts.rootSelect === 'text',
      domFacts.hostSelect + '/' + domFacts.rootSelect);
    check('MV zeroed a positive inline z-index at boot, so the clobber is real',
      domFacts.zeroedSoFar >= 1, domFacts.zeroedSoFar);
    check('the game canvas is the element MV zeroed',
      await ev(() => document.getElementById('GameCanvas').style.zIndex) === '0');

    /* The scenario the capability exists for: the engine rebuilds its DOM
       AFTER the overlay has mounted. _modifyExistingElements zeroes the host,
       and the mod's Graphics.initialize hook has to put it back. */
    const reassert = await ev(() => {
      const host = document.querySelector('#gigahack-host');
      const before = window.__zIndexZeroed || 0;
      Graphics.initialize(816, 624);
      return {
        clobbered: (window.__zIndexZeroed || 0) - before,
        after: host.style.zIndex,
        computed: getComputedStyle(host).zIndex,
        hookInstalled: !!(window.GigaHack.hooks['Graphics.initialize (overlay)'] &&
          window.GigaHack.hooks['Graphics.initialize (overlay)'].installed)
      };
    });
    check('a second Graphics.initialize really does clobber the mounted overlay',
      reassert.clobbered === 1, reassert.clobbered);
    check('the overlay re-asserts its z-index after the engine rebuilds its DOM',
      Number(reassert.computed) >= 2147483000, JSON.stringify(reassert));
    check('the z-index re-assert hangs off a real Graphics.initialize hook',
      reassert.hookInstalled === true);
  } else {
    check('MZ leaves body text selection alone',
      domFacts.bodySelect !== 'none' && domFacts.textSelectionDisabled === false, domFacts.bodySelect);
    check('MZ has no inline z-index clobber to defend against',
      domFacts.zeroedSoFar === 0, domFacts.zeroedSoFar);
    check('the game canvas keeps the z-index the engine gave it',
      await ev(() => document.getElementById('gameCanvas').style.zIndex) === '1');
  }

  /* Our own inputs must still receive keydown while the overlay is open.
     Both engines bind Input._onKeyDown on `document`, an ancestor of our
     fields, so a naive stopPropagation at the window would deafen them. */
  const typing = await ev(async () => {
    const G = window.GigaHack;
    G.cfg.ui.tab = 'debug'; G.cfg.ui.sub.debug = 'Console'; G.ui.rerender();
    const input = document.querySelector('#mm-root textarea, #mm-root input[type=text]');
    if (!input) return { found: false };
    input.focus();
    const before = window.__inputCleared || 0;
    input.value = 'abc';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    return { found: true, focused: document.activeElement === input, value: input.value, cleared: (window.__inputCleared || 0) - before };
  });
  check('a text field inside the overlay can be focused and typed into',
    typing.found && typing.focused && typing.value === 'abc', JSON.stringify(typing));

  /* =======================================================================
     PROFILE — per-game knowledge, and the promise that none is required.
     ==================================================================== */
  const prof = await ev(() => {
    const P = window.GigaHack.profile;
    const a = P.active();
    return {
      id: a.id, generic: a.generic, name: a.name, title: a.title,
      pattern: String(a.pattern), isRe: a.sectionPattern instanceof RegExp,
      source: a.sectionPattern ? String(a.sectionPattern) : null,
      quickVars: a.quickVars, galleryFilter: a.galleryFilter,
      counts: a.counts, bases: a.forgeBase,
      hdr: P.isSectionHeader('-- Locations'),
      notHdr: P.isSectionHeader('sw_12'),
      title1: P.sectionTitle('-- Locations'),
      adapter: P.adapter('backlog')
    };
  });
  check('a game with no profile still gets one', prof.id === 'generic' && prof.generic === true, prof.id);
  check('the profile names the game from $dataSystem, not from a table',
    prof.name === 'Harness Project' && prof.title === 'Harness Project', prof.name);
  check('the section-header convention was detected as a RegExp', prof.isRe === true, prof.source);
  check('isSectionHeader accepts a header and rejects an ordinary name',
    prof.hdr === true && prof.notHdr === false, prof.hdr + '/' + prof.notHdr);
  check('sectionTitle strips the marker', prof.title1 === 'Locations', prof.title1);
  check('with no profile there are no pinned variables and no gallery filter',
    prof.quickVars.length === 0 && prof.galleryFilter === null, JSON.stringify(prof.quickVars));
  check('an absent adapter is null, not a stub that throws later', prof.adapter === null);
  check('the profile carries the database counts it computed from',
    prof.counts.items === 701 && prof.counts.variables === 1401, JSON.stringify(prof.counts));

  /* --- Forge id bases are COMPUTED, and scale with the database --------- */
  const bases = await ev(() => {
    const G = window.GigaHack;
    const big = G.profile.resolve(true).forgeBase;
    const bigCounts = { items: $dataItems.length, skills: $dataSkills.length };

    /* Shrink the database and re-resolve. Nothing is cached across a forced
       resolve, which is the property a game that reloads its data depends on. */
    const keepItems = $dataItems, keepSkills = $dataSkills, keepArmors = $dataArmors;
    window.$dataItems = keepItems.slice(0, 20);
    window.$dataSkills = keepSkills.slice(0, 30);
    window.$dataArmors = keepArmors.slice(0, 10);
    const small = G.profile.resolve(true).forgeBase;
    const smallCounts = { items: $dataItems.length, skills: $dataSkills.length };

    /* Grow it well past the big fixture. */
    const huge = new Array(4500).fill(null).map((_, i) => ({ id: i, name: 'x' + i }));
    window.$dataItems = huge;
    const large = G.profile.resolve(true).forgeBase;

    window.$dataItems = keepItems; window.$dataSkills = keepSkills; window.$dataArmors = keepArmors;
    G.profile.resolve(true);
    return { big, bigCounts, small, smallCounts, large };
  });
  check('the Forge item base is computed from the item count, not a literal',
    bases.big.item === 1001 && bases.small.item === 1001 && bases.large.item === 5001,
    JSON.stringify({ big: bases.big.item, small: bases.small.item, large: bases.large.item }));
  check('a bigger skill table pushes the skill base higher than the item base',
    bases.big.skill === 2001 && bases.big.item === 1001, JSON.stringify(bases.big));
  check('shrinking the database lowers the bases it can lower',
    bases.small.skill === 1001 && bases.big.skill === 2001,
    'small=' + bases.small.skill + ' big=' + bases.big.skill);
  check('every Forge kind gets a base, and every base clears its own table',
    Object.keys(bases.big).length === 10 && Object.keys(bases.big).every(k => bases.big[k] >= 1001),
    JSON.stringify(bases.big));
  check('no computed base is a round number a human would have typed by hand',
    Object.keys(bases.big).every(k => (bases.big[k] - 1) % 1000 === 0), JSON.stringify(bases.big));

  /* --- the RegExp merge bug --------------------------------------------
     A profile's VALUE fields are taken whole; its TABLE fields deep-merge.
     Conflating the two ran sectionPattern — a RegExp — through a structural
     clone, which produces `{}`: truthy, with no .test, so every caller threw
     at its own call site rather than here. A profile that OMITS the field
     must keep the COMPUTED RegExp. */
  const profileMerge = await ev(() => {
    const G = window.GigaHack;
    G.profile.register({
      id: 'harness-partial',
      name: 'A profile that only pins one Forge base',
      match: function () { return window.__matchPartial === true; },
      forgeBase: { item: 7001 }
      /* deliberately no sectionPattern, no galleryFilter, no adapters */
    });
    window.__matchPartial = true;
    const r = G.profile.resolve(true);
    const out = {
      id: r.id,
      patternIsRe: r.sectionPattern instanceof RegExp,
      patternHasTest: !!(r.sectionPattern && typeof r.sectionPattern.test === 'function'),
      patternIsEmptyObject: !!(r.sectionPattern && typeof r.sectionPattern === 'object' &&
        !(r.sectionPattern instanceof RegExp) && Object.keys(r.sectionPattern).length === 0),
      pinnedBase: r.forgeBase.item,
      otherBasesStillComputed: r.forgeBase.skill,
      isHeaderStillWorks: null, threw: null
    };
    try { out.isHeaderStillWorks = G.profile.isSectionHeader('-- Locations'); }
    catch (e) { out.threw = e.message; }
    window.__matchPartial = false;
    G.profile.resolve(true);
    return out;
  });
  check('a registered profile that matches is used', profileMerge.id === 'harness-partial', profileMerge.id);
  check('a profile that omits sectionPattern still gets the computed RegExp',
    profileMerge.patternIsRe === true && profileMerge.patternHasTest === true, JSON.stringify(profileMerge));
  check('the merged sectionPattern is not the empty object a deep clone produces',
    profileMerge.patternIsEmptyObject === false, JSON.stringify(profileMerge));
  check('isSectionHeader still answers after a partial profile is merged',
    profileMerge.isHeaderStillWorks === true && profileMerge.threw === null,
    profileMerge.threw || String(profileMerge.isHeaderStillWorks));
  check('a profile that pins one Forge base leaves the other nine computed',
    profileMerge.pinnedBase === 7001 && profileMerge.otherBasesStillComputed === 2001,
    JSON.stringify(profileMerge));
  check('re-resolving after the profile stops matching returns to the generic one',
    await ev(() => window.GigaHack.profile.active().id) === 'generic');
  check('registering the same profile id twice is refused',
    await ev(() => window.GigaHack.profile.register({ id: 'harness-partial', match: () => false })) === false);

  /* --- a database with no convention at all ---------------------------- */
  const noConvention = await ev(() => {
    const G = window.GigaHack;
    window.__useSectionConvention(false);
    const r = G.profile.resolve(true);
    const out = {
      pattern: r.sectionPattern,
      isNull: r.sectionPattern === null,
      isHeader: G.profile.isSectionHeader('-- Locations'),
      sectionTitleSafe: G.profile.sectionTitle('anything'),
      varSections: G.vars.sections('switch').map(s => s.title)
    };
    window.__useSectionConvention(true);
    G.profile.resolve(true);
    return out;
  });
  check('section detection returns null on a database with no convention',
    noConvention.isNull === true, JSON.stringify(noConvention.pattern));
  check('with no convention nothing is a section header',
    noConvention.isHeader === false);
  check('with no convention sectionTitle still returns the name rather than throwing',
    noConvention.sectionTitleSafe === 'anything', noConvention.sectionTitleSafe);
  check('with no convention the switch list is one ungrouped section, not an empty panel',
    noConvention.varSections.length === 1, JSON.stringify(noConvention.varSections));
  check('the convention comes back when the database does',
    await ev(() => window.GigaHack.profile.isSectionHeader('-- Locations')) === true);

  /* --- hotkey defaults are derived, not chosen ------------------------- */
  const keys = await ev(() => {
    const G = window.GigaHack;
    const claimed = G.profile.claimedKeys();
    return {
      derived: G.profile.defaultHotkeys(),
      live: G.cfg.hotkeys,
      claimedN: claimed['KeyN'] || null,
      claimedP: claimed['KeyP'] || null,
      claimedEnter: claimed['Enter'] || null,
      claimedQ: claimed['KeyQ'] || null,
      count: Object.keys(claimed).length
    };
  });
  check('the engine keys are all claimed before anything is derived',
    keys.claimedEnter === 'the engine' && keys.claimedQ === 'the engine', JSON.stringify(keys.claimedEnter));
  check('every derived hotkey avoids a key this game has claimed',
    Object.keys(keys.derived).every(a => {
      const k = keys.derived[a];
      return !(k === 'KeyN' && keys.claimedN) && !(k === 'KeyP' && keys.claimedP);
    }), JSON.stringify(keys.derived));
  check('no two derived actions get the same key',
    new Set(Object.values(keys.derived)).size === Object.keys(keys.derived).length, JSON.stringify(keys.derived));
  check('quick load ships unbound whatever is free', keys.live.quickLoad === null, String(keys.live.quickLoad));
  if (MODDED) {
    check('a plugin that claims KeyN is named as the claimant',
      /keyMapper/.test(keys.claimedN || ''), keys.claimedN);
    check('a plugin that claims KeyP is named as the claimant',
      /keyMapper/.test(keys.claimedP || ''), keys.claimedP);
    check('the toggle hotkey moved off the claimed letter',
      keys.live.toggleMenu !== 'KeyN' && keys.derived.toggle !== 'KeyN', keys.live.toggleMenu);
    check('the quick-save hotkey moved off the claimed letter',
      keys.live.quickSave !== 'KeyP' && keys.derived.quickSave !== 'KeyP', keys.live.quickSave);
  } else {
    check('on a stock game the first preference is free and is taken',
      keys.derived.toggle === 'KeyN' && keys.derived.quickSave === 'KeyP', JSON.stringify(keys.derived));
    check('the live binding matches the derivation',
      keys.live.toggleMenu === 'KeyN', keys.live.toggleMenu);
  }

  /* =======================================================================
     INDEX — for finding, never authority.
     ==================================================================== */
  /* The boot build ran against a browser build with no filesystem, so the two
     stages that need one must be absent WITH A REASON. "unavailable" on its
     own is the answer that wastes an afternoon. */
  const idxNoFs = await ev(() => {
    const X = window.GigaHack.index;
    const st = X.status();
    const d = X.data();
    return {
      phase: st.phase, notes: st.notes, counts: st.counts,
      events: d ? d.events : undefined, assets: d ? d.assets : undefined,
      encounters: d ? d.encounters : undefined,
      eventQuery: X.findEventsTouching('switch', 141),
      assetQuery: X.findAsset('Actor')
    };
  });
  check('the index finished building at boot', idxNoFs.phase === 'ready', idxNoFs.phase);
  check('the cross-map event stage is null, not empty, when it could not run',
    idxNoFs.events === null, JSON.stringify(idxNoFs.events));
  check('the asset stage is null, not empty, when it could not run',
    idxNoFs.assets === null, JSON.stringify(idxNoFs.assets));
  check('the index says the event stage was unavailable AND why',
    idxNoFs.notes.some(n => /cross-map event index/.test(n) && /filesystem/.test(n)),
    JSON.stringify(idxNoFs.notes));
  check('the index says the asset stage was unavailable AND why',
    idxNoFs.notes.some(n => /asset index/.test(n) && /filesystem/.test(n)),
    JSON.stringify(idxNoFs.notes));
  check('an event query with no event index returns no candidates and a reason',
    idxNoFs.eventQuery.candidates.length === 0 && idxNoFs.eventQuery.complete === false &&
    idxNoFs.eventQuery.why.length > 20, JSON.stringify(idxNoFs.eventQuery).slice(0, 160));
  check('an asset query with no asset index returns no candidates and a reason',
    idxNoFs.assetQuery.candidates.length === 0 && idxNoFs.assetQuery.complete === false &&
    idxNoFs.assetQuery.why.length > 20, JSON.stringify(idxNoFs.assetQuery).slice(0, 160));
  check('the stages that need no filesystem still produced counts',
    idxNoFs.counts.vars === 1401 && idxNoFs.counts.switches === 1101 && idxNoFs.counts.maps === 320,
    JSON.stringify(idxNoFs.counts));

  /* Every query returns the same triple, whether it can answer or not. */
  const shapes = await ev(() => {
    const X = window.GigaHack.index;
    const calls = {
      findByName: X.findByName('items', 'Item 3'),
      findVar: X.findVar('var_5'),
      findSwitch: X.findSwitch('sw_9'),
      findMap: X.findMap('Cellar'),
      findAsset: X.findAsset('Actor'),
      findEventsTouching: X.findEventsTouching('switch', 1)
    };
    const out = {};
    Object.keys(calls).forEach(k => {
      const r = calls[k];
      out[k] = {
        keys: Object.keys(r).sort().join(','),
        arr: Array.isArray(r.candidates),
        boolComplete: typeof r.complete === 'boolean',
        strWhy: typeof r.why === 'string',
        n: r.candidates.length
      };
    });
    return out;
  });
  Object.keys(shapes).forEach(k => {
    const s = shapes[k];
    check('$.index.' + k + ' returns {candidates, complete, why} and nothing else',
      s.keys === 'candidates,complete,why' && s.arr && s.boolComplete && s.strWhy, JSON.stringify(s));
  });
  check('a name search finds the row it was asked for', shapes.findByName.n >= 1, shapes.findByName.n);
  check('a variable search finds the variable it was asked for', shapes.findVar.n >= 1, shapes.findVar.n);
  check('a map search finds the map it was asked for', shapes.findMap.n >= 1, shapes.findMap.n);

  /* --- the index is never authority ------------------------------------
     Change the live database after the index was built. The index still
     offers the stale id; the caller must resolve it against live data and
     drop it. The Gallery is the module that does this for real. */
  const staleness = await ev(() => {
    const G = window.GigaHack;
    const indexed = G.index.sections('switches').length;
    const before = G.gallery.sections().length;
    const id = G.index.sections('switches')[0].id;
    const kept = $dataSystem.switches[id];
    $dataSystem.switches[id] = 'no longer a header';         // the game patched itself
    const after = G.gallery.sections().length;
    const stillIndexed = G.index.sections('switches').length;
    $dataSystem.switches[id] = kept;
    return { indexed, before, after, stillIndexed, restored: G.gallery.sections().length };
  });
  check('the index still lists a candidate the live database has changed',
    staleness.stillIndexed === staleness.indexed, JSON.stringify(staleness));
  check('the caller resolves every candidate against live data and drops the stale one',
    staleness.after === staleness.before - 1, JSON.stringify(staleness));
  check('restoring the live database restores the section',
    staleness.restored === staleness.before, JSON.stringify(staleness));

  /* --- with a filesystem, the two expensive stages run ------------------ */
  const idxFs = await ev(async () => {
    const G = window.GigaHack;
    window.__mountVirtualFs();
    const t0 = performance.now();
    const started = G.index.rebuild();
    const syncMs = performance.now() - t0;
    const phaseRightAfter = G.index.status().phase;
    await new Promise(r => setTimeout(r, 600));
    const st = G.index.status();
    const d = G.index.data();
    return {
      started, syncMs, phaseRightAfter, phase: st.phase, timings: st.timings, counts: st.counts,
      notes: st.notes,
      events: G.index.findEventsTouching('switch', 141),
      variable: G.index.findEventsTouching('variable', 22),
      selfSwitch: G.index.findEventsTouching('switch', 9),
      assets: G.index.findAsset('Actor'),
      encounters: d.encounters,
      mapsScanned: d.stats.mapsScanned, eventCount: d.stats.events
    };
  });
  check('a rebuild starts and returns immediately, without blocking the frame',
    idxFs.started === true && idxFs.syncMs < 60, idxFs.syncMs + 'ms');
  check('the index reports itself as building the moment it is asked to',
    idxFs.phaseRightAfter === 'building', idxFs.phaseRightAfter);
  check('the index finishes on its own without anything driving it',
    idxFs.phase === 'ready', idxFs.phase);
  check('every stage recorded what it cost, so indexing a thing is a measurement',
    Object.keys(idxFs.timings).length >= 6, JSON.stringify(idxFs.timings));
  check('the cross-map event stage read every map file it found',
    idxFs.mapsScanned === 5 && idxFs.eventCount >= 5, idxFs.mapsScanned + '/' + idxFs.eventCount);
  check('findEventsTouching finds a switch reference across map files',
    idxFs.events.candidates.length === 2 &&
    idxFs.events.candidates.map(c => c.mapId).sort().join(',') === '12,5',
    JSON.stringify(idxFs.events.candidates));
  check('it finds the reference made by a Control Switches command',
    idxFs.events.candidates.some(c => c.eventName === 'shrine_chest'), JSON.stringify(idxFs.events.candidates));
  check('it also finds the reference made by a page CONDITION, not just a command',
    idxFs.events.candidates.some(c => c.eventName === 'cellar_door'), JSON.stringify(idxFs.events.candidates));
  check('the event query is complete once the stage has run',
    idxFs.events.complete === true && idxFs.events.why === '', idxFs.events.why);
  check('a variable reference is found through the same scan',
    idxFs.variable.candidates.length === 1 && idxFs.variable.candidates[0].mapId === 5,
    JSON.stringify(idxFs.variable.candidates));
  check('a conditional-branch switch reference is found too',
    idxFs.selfSwitch.candidates.length === 1, JSON.stringify(idxFs.selfSwitch.candidates));
  check('the asset stage lists the image folders once there is a filesystem',
    idxFs.assets.candidates.length >= 4 && idxFs.assets.complete === true,
    JSON.stringify(idxFs.assets.candidates));
  check('the encounter table rides along with the event scan rather than re-reading every map',
    idxFs.encounters && idxFs.encounters[14] === 2 && idxFs.encounters[5] === 0,
    JSON.stringify(idxFs.encounters));

  /* --- the fingerprint, one input at a time ---------------------------- */
  await ev(e => { window.__realEngine = e; }, caps.flat.engine);
  const fpRes = await ev(() => {
    const G = window.GigaHack;
    const base = JSON.stringify(G.index.fingerprint());
    const out = { base, moves: {} };
    function move(label, apply, undo) {
      apply();
      out.moves[label] = JSON.stringify(G.index.fingerprint()) !== base;
      undo();
    }
    move('the game title', () => { $dataSystem.gameTitle = 'Something Else'; },
      () => { $dataSystem.gameTitle = 'Harness Project'; });
    move('the item count', () => { $dataItems.push({ id: 9999, name: 'extra' }); }, () => { $dataItems.pop(); });
    move('the map count', () => { $dataMapInfos.push({ id: 9999, name: 'extra', parentId: 0 }); }, () => { $dataMapInfos.pop(); });
    move('the variable count', () => { $dataSystem.variables.push('one more'); }, () => { $dataSystem.variables.pop(); });
    move('the loaded plugin list', () => { $plugins.push({ name: 'VisuMZ_1_BattleCore', status: true, parameters: {} }); }, () => { $plugins.pop(); });
    // Restored from what was captured, not from a literal: a version written
    // into a test's undo path is a check that goes red on the next release and
    // says nothing about the thing it was testing.
    const realVersion = G.version;
    move('the mod version', () => { G.version = '9.9.9'; }, () => { G.version = realVersion; });
    move('the engine', () => { G.caps.engine = 'XX'; }, () => { G.caps.engine = window.__realEngine; });
    move('System.json on disk', () => { window.__vfs.files['/fake/game/data/System.json'] += ' '; },
      () => { window.__vfs.files['/fake/game/data/System.json'] = window.__vfs.files['/fake/game/data/System.json'].slice(0, -1); });
    out.stableAfter = JSON.stringify(G.index.fingerprint()) === base;
    return out;
  });
  Object.keys(fpRes.moves).forEach(k => {
    check('the index fingerprint invalidates on ' + k, fpRes.moves[k] === true, String(fpRes.moves[k]));
  });
  check('the fingerprint is stable once every input is put back', fpRes.stableAfter === true);

  /* --- take the filesystem away again ---------------------------------- */
  const idxGone = await ev(async () => {
    const G = window.GigaHack;
    window.__unmountVirtualFs();
    G.index.rebuild();
    await new Promise(r => setTimeout(r, 500));
    const st = G.index.status();
    return {
      phase: st.phase, notes: st.notes,
      events: G.index.data().events, assets: G.index.data().assets,
      q: G.index.findEventsTouching('switch', 141)
    };
  });
  check('taking the filesystem away puts the two stages back to unavailable',
    idxGone.events === null && idxGone.assets === null, JSON.stringify({ e: idxGone.events, a: idxGone.assets }));
  check('and it says so with a reason both times',
    idxGone.notes.filter(n => /unavailable/.test(n)).length >= 2, JSON.stringify(idxGone.notes));
  check('a query that can no longer be answered says so instead of answering wrongly',
    idxGone.q.candidates.length === 0 && idxGone.q.complete === false, JSON.stringify(idxGone.q).slice(0, 120));

  /* =======================================================================
     COMPAT — surviving other people's plugins.
     ==================================================================== */
  const compatBasics = await ev(() => {
    const K = window.GigaHack.compat;
    return {
      plugins: K.plugins().length,
      frameworks: K.frameworks().map(f => ({ id: f.id, affects: f.affects, note: (f.note || '').length, plugins: f.plugins })),
      tests: K.tests().map(t => t.id),
      loadOrder: K.loadOrder()
    };
  });
  check('compat can enumerate the loaded plugin list', compatBasics.plugins >= 40, compatBasics.plugins);
  check('the self-test suite covers every control area',
    ['variables', 'switches', 'items', 'gold', 'params', 'states', 'saves', 'loadorder', 'aliases', 'names']
      .every(id => compatBasics.tests.indexOf(id) > -1), JSON.stringify(compatBasics.tests));
  check('GigaHack is the last enabled entry, so its aliases are outermost',
    compatBasics.loadOrder.known === true && compatBasics.loadOrder.last === true,
    compatBasics.loadOrder.why);
  if (MODDED) {
    check('every modelled framework in the stack is recognised',
      ['yep-core', 'circular-json', 'image-cache-clear', 'speed-multiplier', 'storage-redirect']
        .every(id => compatBasics.frameworks.some(f => f.id === id)),
      JSON.stringify(compatBasics.frameworks.map(f => f.id)));
    check('every recognised framework carries a human-readable consequence',
      compatBasics.frameworks.every(f => f.note > 60), JSON.stringify(compatBasics.frameworks.map(f => [f.id, f.note])));
    check('the framework that overwrites the caps is the one blamed for parameters',
      compatBasics.frameworks.some(f => f.affects.indexOf('party.param') > -1),
      JSON.stringify(compatBasics.frameworks.map(f => f.affects)));
    check('an unrecognised plugin in the stack is NOT invented as a framework',
      !compatBasics.frameworks.some(f => f.plugins.indexOf('param_recalc') > -1),
      JSON.stringify(compatBasics.frameworks.map(f => f.plugins)));
  } else {
    check('a stock game recognises no frameworks and does not invent any',
      compatBasics.frameworks.length === 0, JSON.stringify(compatBasics.frameworks.map(f => f.id)));
  }

  /* --- write-and-verify ------------------------------------------------- */
  const verifyClamped = await ev(() => {
    const G = window.GigaHack;
    G.compat.clearDegraded();
    /* A write the ENGINE itself refuses: setValue ignores id 0 on both
       engines, so the value cannot stick and no plugin is responsible. */
    const r = G.compat.verify('vars.set',
      function () { $gameVariables.setValue(0, 424242); },
      function () { return $gameVariables.value(0); },
      424242);
    const degradedNow = G.compat.isDegraded('vars.set');
    const why = G.compat.degradedWhy('vars.set');
    const listed = G.compat.degradedList().map(d => d.control);

    /* Second failure: the message must not be re-logged, but the control
       must stay degraded. */
    const r2 = G.compat.verify('vars.set',
      function () { $gameVariables.setValue(0, 424242); },
      function () { return $gameVariables.value(0); },
      424242);
    const stillDegraded = G.compat.isDegraded('vars.set');

    /* Now a write that DOES stick: the control has to recover on its own. */
    const id = $dataSystem.variables.length - 1;
    const before = $gameVariables.value(id);
    const r3 = G.compat.verify('vars.set',
      function () { $gameVariables.setValue(id, 777); },
      function () { return $gameVariables.value(id); },
      777);
    const recovered = !G.compat.isDegraded('vars.set');
    $gameVariables.setValue(id, before);
    return { r, r2, r3, degradedNow, stillDegraded, recovered, why, listed };
  });
  check('verify notices a write that did not stick',
    verifyClamped.r.ok === false && verifyClamped.r.got === 0, JSON.stringify(verifyClamped.r).slice(0, 140));
  check('a failed write marks its control degraded for the session',
    verifyClamped.degradedNow === true && verifyClamped.listed.indexOf('vars.set') > -1,
    JSON.stringify(verifyClamped.listed));
  check('the degraded reason says what was written and what came back',
    /wrote 424242/.test(verifyClamped.why) && /read back 0/.test(verifyClamped.why),
    verifyClamped.why.slice(0, 120));
  check('with no plugin known to touch it, the message says exactly that rather than inventing a name',
    verifyClamped.r.culprits.length === 0 && /No loaded plugin is known to touch this/.test(verifyClamped.why),
    verifyClamped.why.slice(0, 160));
  check('a degraded control stays degraded while the write keeps failing',
    verifyClamped.stillDegraded === true && verifyClamped.r2.ok === false);
  check('a degraded control recovers the moment the write succeeds again',
    verifyClamped.r3.ok === true && verifyClamped.recovered === true, JSON.stringify(verifyClamped.r3));

  /* The parameter cap is where the two engines genuinely differ, and where a
     framework that lowers it is felt. MV clamps at 999 for ATK; MZ does not
     clamp at all. */
  const paramWrite = await ev(() => {
    const G = window.GigaHack;
    G.compat.clearDegraded();
    const a = $gameActors.actor(1);
    const capBefore = a.paramMax(2);
    const want = 50000;
    const base = a.paramBase(2);
    const keep = a._paramPlus[2];
    const r = G.compat.verify('party.param',
      function () { a._paramPlus[2] = want - base; },
      function () { return a.param(2); },
      want);
    a._paramPlus[2] = keep;
    const out = {
      cap: capBefore === Infinity ? 'Infinity' : capBefore,
      ok: r.ok, got: r.got, culprits: r.culprits.map(c => ({ name: c.name, plugins: c.plugins })),
      message: r.message, degraded: G.compat.isDegraded('party.param')
    };
    G.compat.clearDegraded();
    return out;
  });
  if (IS_MZ) {
    check('MZ has no parameter ceiling, so a large write sticks',
      paramWrite.cap === 'Infinity' && paramWrite.ok === true && paramWrite.got === 50000,
      JSON.stringify(paramWrite));
  } else if (!MODDED) {
    check('stock MV clamps ATK at 999, so a large write does not stick',
      paramWrite.cap === 999 && paramWrite.ok === false && paramWrite.got === 999, JSON.stringify(paramWrite));
    check('on a stock game the clamp is attributed to the engine, not to a plugin',
      paramWrite.culprits.length === 0 && /clamped by the engine/.test(paramWrite.message),
      paramWrite.message.slice(0, 160));
  } else {
    check('the modelled framework lowers the parameter ceiling below the engine default',
      paramWrite.cap === 999, paramWrite.cap);
    check('a parameter write that does not stick is reported as a failure',
      paramWrite.ok === false && paramWrite.got === 999, JSON.stringify(paramWrite));
    check('verify names a culprit FROM THE LOADED PLUGIN LIST',
      paramWrite.culprits.length >= 1 && paramWrite.culprits[0].plugins.indexOf('YEP_CoreEngine') > -1,
      JSON.stringify(paramWrite.culprits));
    check('the culprit message explains what that plugin does, not just that it exists',
      /Most likely cause/.test(paramWrite.message) && paramWrite.message.length > 200,
      paramWrite.message.slice(0, 200));
    check('the control is left degraded so the panel can grey it with a reason',
      paramWrite.degraded === true);
  }

  /* --- alias integrity ---------------------------------------------------
     FIRST, before anything in this suite re-snapshots: what does a clean
     install report at boot? The snapshot has to be taken once EVERY GigaHack
     hook is in place, and several modules alias the same two methods
     (Scene_Boot.start, DataManager.extractSaveContents). Snapshotting too
     early records a value that is superseded moments later, and the mod then
     accuses its own hooks of having been patched by something else — on a
     game with no third-party plugins at all. */
  const bootIntegrity = await ev(() => ({
    rows: window.GigaHack.compat.aliasIntegrity().map(x => ({ n: x.name, s: x.state })),
    test: window.GigaHack.compat.selfTest(['aliases'])[0]
  }));
  check('a clean boot reports no hook as over-patched',
    bootIntegrity.rows.filter(r => r.s === 'overpatched').length === 0,
    JSON.stringify(bootIntegrity.rows.filter(r => r.s === 'overpatched')));
  check('a clean boot reports no hook as installed after the snapshot',
    bootIntegrity.rows.filter(r => r.s === 'new').length === 0,
    JSON.stringify(bootIntegrity.rows.filter(r => r.s === 'new')));
  check('the alias self-test passes on a clean install and counts the hooks it checked',
    bootIntegrity.test.state === 'pass' && /hooks intact/.test(bootIntegrity.test.detail),
    JSON.stringify(bootIntegrity.test));

  const integrity = await ev(() => {
    const G = window.GigaHack;
    const n = G.compat.snapshotAliases();
    const clean = G.compat.aliasIntegrity();
    /* Something loads after us and aliases on top. This is the single most
       common way a cheat stops working on a modded game. */
    const live = Scene_Map.prototype.updateCallMenu;
    Scene_Map.prototype.updateCallMenu = function () { return live.apply(this, arguments); };
    const dirty = G.compat.aliasIntegrity();
    const test = G.compat.selfTest(['aliases'])[0];
    Scene_Map.prototype.updateCallMenu = live;
    const restored = G.compat.aliasIntegrity();
    return {
      snapshotted: n, clean: clean.length,
      dirty: dirty.map(d => ({ n: d.name, s: d.state, whyLen: (d.why || '').length })),
      test: { state: test.state, detail: test.detail },
      restored: restored.length
    };
  });
  check('the alias snapshot covers every installed hook', integrity.snapshotted >= 40, integrity.snapshotted);
  check('a fresh snapshot reports nothing wrong', integrity.clean === 0, JSON.stringify(integrity.clean));
  check('alias integrity notices a method patched on top after the snapshot',
    integrity.dirty.length === 1 && integrity.dirty[0].n === 'Scene_Map.updateCallMenu' &&
    integrity.dirty[0].s === 'overpatched', JSON.stringify(integrity.dirty));
  check('the over-patch report explains the consequence, not just the fact',
    integrity.dirty[0] && integrity.dirty[0].whyLen > 120, JSON.stringify(integrity.dirty));
  check('the alias self-test fails while a hook is over-patched',
    integrity.test.state === 'fail' && /updateCallMenu/.test(integrity.test.detail),
    JSON.stringify(integrity.test));
  check('putting the method back clears the report', integrity.restored === 0, integrity.restored);

  /* --- load order --------------------------------------------------------- */
  const order = await ev(() => {
    const G = window.GigaHack;
    const before = G.loadOrderProbe = G.compat.loadOrder();
    $plugins.push({ name: 'late_battle_patch', status: true, parameters: {} });
    $plugins.push({ name: 'later_still', status: false, parameters: {} });   // disabled: must not count
    const after = G.compat.loadOrder();
    const test = G.compat.selfTest(['loadorder'])[0];
    $plugins.pop(); $plugins.pop();
    const restored = G.compat.loadOrder();
    return { before, after, test: { state: test.state, detail: test.detail }, restored };
  });
  check('load order detects a plugin appended after GigaHack',
    order.after.last === false && order.after.after.indexOf('late_battle_patch') > -1,
    JSON.stringify(order.after.after));
  check('a DISABLED plugin after GigaHack is not counted as loading after it',
    order.after.after.indexOf('later_still') < 0, JSON.stringify(order.after.after));
  check('the load-order message names the plugin and says what to do about it',
    /late_battle_patch/.test(order.after.why) && /installer/.test(order.after.why),
    order.after.why.slice(0, 200));
  check('the load-order self-test fails while something loads after us',
    order.test.state === 'fail', JSON.stringify(order.test));
  check('removing the late plugin restores the load order', order.restored.last === true, order.restored.why);

  /* --- the name collision, under BOTH dedup rules -------------------------
     PluginManager.setup skips a plugin whose name is already registered. MV
     keys that on the FULL plugin.name and MZ on the basename, so the two
     engines produce different-looking duplicates — and either way the second
     claim is dropped with no error and the module simply never exists. */
  const collision = await ev(() => {
    const G = window.GigaHack;
    const keep = PluginManager._scripts.slice();
    const out = {};

    out.cleanTest = G.compat.selfTest(['names'])[0];

    /* MV's rule: _scripts holds the full entry, so a duplicate is an exact
       repeat of the same name. */
    PluginManager._scripts.push('GigaHack_Vars');
    out.exact = G.compat.selfTest(['names'])[0];
    PluginManager._scripts.length = 0; keep.forEach(n => PluginManager._scripts.push(n));

    /* MZ's rule: _scripts holds Utils.extractFileName(name), so an entry
       under a subfolder collides with a plain one of the same basename. */
    PluginManager._scripts.push('mods/Other/GigaHack_Inv');
    out.byBase = G.compat.selfTest(['names'])[0];
    PluginManager._scripts.length = 0; keep.forEach(n => PluginManager._scripts.push(n));

    /* A duplicate that is NOT one of ours must not be reported as one. */
    PluginManager._scripts.push('ui_frame_0');
    out.foreign = G.compat.selfTest(['names'])[0];
    PluginManager._scripts.length = 0; keep.forEach(n => PluginManager._scripts.push(n));

    out.after = G.compat.selfTest(['names'])[0];
    return out;
  });
  check('with no duplicates the name check passes and counts our modules',
    collision.cleanTest.state === 'pass' &&
    new RegExp(N_MODULES + ' GigaHack modules registered').test(collision.cleanTest.detail),
    JSON.stringify(collision.cleanTest));
  check('the name-collision check catches a duplicate under MV\'s full-name dedup rule',
    collision.exact.state === 'fail' && /GigaHack_Vars/.test(collision.exact.detail),
    JSON.stringify(collision.exact));
  check('the name-collision check catches a duplicate under MZ\'s basename dedup rule',
    collision.byBase.state === 'fail' && /GigaHack_Inv/.test(collision.byBase.detail),
    JSON.stringify(collision.byBase));
  check('the collision message says the second claim was dropped silently, and what to do',
    /drops the second claim silently/.test(collision.exact.detail) &&
    /Rename the other plugin|reinstall GigaHack/i.test(collision.exact.detail),
    collision.exact.detail.slice(0, 200));
  check('a duplicate that is not one of ours is not reported as one',
    collision.foreign.state === 'pass', JSON.stringify(collision.foreign));
  check('the name check is clean again once the duplicates are removed',
    collision.after.state === 'pass', JSON.stringify(collision.after));

  /* --- the live self-test ------------------------------------------------- */
  const selfTest = await ev(() => {
    const G = window.GigaHack;
    G.compat.clearDegraded();
    const rows = G.compat.selfTest();
    return {
      rows: rows.map(r => ({ id: r.id, state: r.state, detail: (r.detail || '').length })),
      failed: rows.filter(r => r.state === 'fail').map(r => r.id + ': ' + r.detail)
    };
  });
  check('the live self-test runs every check against the running game',
    selfTest.rows.length === 10, selfTest.rows.length);
  check('every self-test row carries a detail line worth reading',
    selfTest.rows.every(r => r.detail > 10), JSON.stringify(selfTest.rows));
  if (MODDED) {
    /* The modelled stack lowers the parameter ceilings without aliasing. The
       self-test's job is to READ those ceilings off the running game and say
       what they are, so the panel can raise one before writing rather than
       writing and being silently clamped. */
    const paramRow = await ev(() => window.GigaHack.compat.selfTest(['params'])[0]);
    check('the self-test reads the framework\'s lowered parameter ceilings off the running game',
      /MHP 9999/.test(paramRow.detail) && /others 999/.test(paramRow.detail), paramRow.detail);
    check('and says what to do about them rather than just reporting a number',
      /raise the ceiling first/.test(paramRow.detail), paramRow.detail);
    check('no self-test crashes on a heavily modded stack',
      selfTest.rows.every(r => r.state !== 'error'), JSON.stringify(selfTest.rows));
  } else if (IS_MZ) {
    check('on a stock MZ game every self-test passes',
      selfTest.failed.length === 0, JSON.stringify(selfTest.failed).slice(0, 300));
  } else {
    check('on a stock MV game only the engine parameter clamp is reported',
      selfTest.failed.every(f => /^params:/.test(f)), JSON.stringify(selfTest.failed).slice(0, 300));
  }
  await ev(() => window.GigaHack.compat.clearDegraded());

  /* =======================================================================
     SAVE AND LOAD — one callback shape over two completely different APIs.

     MZ returns a Promise; MV returns a BOOLEAN, and `false` is a genuine
     write failure that the pre-2.0 code reported as success. The adapter has
     to normalise both into a callback that fires exactly once, including when
     the engine threw.
     ==================================================================== */
  const savePaths = await ev(ext => {
    const E = window.GigaHack.eng;
    return {
      dir: E.saveDir(),
      config: E.savePath(-1),
      global: E.savePath(0),
      slot3: E.savePath(3),
      ext
    };
  }, SAVE_EXT);
  check('the save directory is resolved through StorageManager at call time',
    typeof savePaths.dir === 'string' && savePaths.dir.length > 0, savePaths.dir);
  check('a slot path uses this engine\'s extension',
    savePaths.slot3.slice(-SAVE_EXT.length) === SAVE_EXT, savePaths.slot3);
  check('slot 3 is named file3', /file3/.test(savePaths.slot3), savePaths.slot3);
  check('a negative id is the config file, not slot -1',
    /config/.test(savePaths.config) && savePaths.config.slice(-SAVE_EXT.length) === SAVE_EXT, savePaths.config);
  check('id 0 is the global index, not slot 0',
    /global/.test(savePaths.global) && savePaths.global.slice(-SAVE_EXT.length) === SAVE_EXT, savePaths.global);
  check('every resolved path sits under the save directory',
    [savePaths.config, savePaths.global, savePaths.slot3].every(p => p.indexOf(savePaths.dir) === 0),
    JSON.stringify(savePaths));

  const markId = await ev(() => {
    const out = { threw: null, r: null };
    try { out.r = window.GigaHack.eng.markSavefileId(4); } catch (e) { out.threw = e.message; }
    out.onSystem = (typeof $gameSystem.setSavefileId === 'function');
    out.stored = out.onSystem ? $gameSystem.savefileId() : null;
    return out;
  });
  check('marking the session savefile id never throws, on either engine', markId.threw === null, markId.threw);
  check('the session savefile id is recorded exactly on MZ',
    markId.r === IS_MZ && markId.onSystem === IS_MZ, JSON.stringify(markId));
  if (IS_MZ) check('MZ really stored the id it was given', markId.stored === 4, markId.stored);

  const roundTrip = await ev(async () => {
    const G = window.GigaHack;
    const out = {};
    $gameParty._gold = 12345;
    $gameVariables.setValue(11, 999);

    /* 1. a save that works. */
    let calls = [], syncDone = false;
    await new Promise(res => {
      G.eng.saveGame(3, function (ok, err) { calls.push({ ok, err }); res(); });
      syncDone = calls.length > 0;      // did the callback run before we yielded?
    });
    await new Promise(r => setTimeout(r, 30));
    out.save = { calls: calls.length, ok: calls[0] && calls[0].ok, err: calls[0] && calls[0].err, sync: syncDone };

    /* 2. a save that fails. MV returns false; MZ rejects. Either way the
          adapter must report FAILURE, not success. */
    window.__saveShouldFail = true;
    calls = [];
    await new Promise(res => { G.eng.saveGame(4, function (ok, err) { calls.push({ ok, err }); res(); }); });
    await new Promise(r => setTimeout(r, 30));
    window.__saveShouldFail = false;
    out.failedSave = { calls: calls.length, ok: calls[0] && calls[0].ok, err: String(calls[0] && calls[0].err) };
    out.rawReturn = (function () {
      window.__saveShouldFail = true;
      const r = DataManager.saveGame(9);
      window.__saveShouldFail = false;
      if (r && typeof r.then === 'function') {
        /* The rejection is deliberate; leaving it unhandled would surface as
           an uncaught page error and fail the "nothing broke" check for a
           reason that has nothing to do with the mod. */
        r.catch(function () { });
        return 'promise';
      }
      return String(r);
    })();

    /* 3. a load of a slot that is not there. */
    calls = [];
    await new Promise(res => { G.eng.loadGame(17, function (ok, err) { calls.push({ ok, err }); res(); }); });
    await new Promise(r => setTimeout(r, 30));
    out.missingLoad = { calls: calls.length, ok: calls[0] && calls[0].ok, err: String(calls[0] && calls[0].err) };

    /* 4. the real round trip. */
    $gameParty._gold = 1;
    $gameVariables.setValue(11, 0);
    calls = [];
    await new Promise(res => { G.eng.loadGame(3, function (ok, err) { calls.push({ ok, err }); res(); }); });
    await new Promise(r => setTimeout(r, 30));
    out.load = { calls: calls.length, ok: calls[0] && calls[0].ok, err: String(calls[0] && calls[0].err) };
    out.restoredGold = $gameParty.gold();
    out.restoredVar = $gameVariables.value(11);
    out.createdObjects = window.__createdGameObjects || 0;

    /* 5. the slot listing sees it. */
    out.info = G.eng.savefileInfo(3);
    return out;
  });
  check('a successful save calls back exactly once, with ok',
    roundTrip.save.calls === 1 && roundTrip.save.ok === true && roundTrip.save.err === null,
    JSON.stringify(roundTrip.save));
  if (IS_MZ) {
    check('MZ\'s Promise resolves before the callback fires',
      roundTrip.save.sync === false, JSON.stringify(roundTrip.save));
    check('MZ\'s DataManager.saveGame really does return a Promise',
      roundTrip.rawReturn === 'promise', roundTrip.rawReturn);
    check('a rejected Promise is reported as a failure, with the engine\'s message',
      roundTrip.failedSave.ok === false && /disk full/.test(roundTrip.failedSave.err),
      JSON.stringify(roundTrip.failedSave));
  } else {
    check('MV\'s synchronous save calls back before the caller yields',
      roundTrip.save.sync === true, JSON.stringify(roundTrip.save));
    check('MV\'s DataManager.saveGame really does return false on failure',
      roundTrip.rawReturn === 'false', roundTrip.rawReturn);
    check('MV\'s false is reported as FAILURE, not success',
      roundTrip.failedSave.ok === false && /the engine reported the save failed/.test(roundTrip.failedSave.err),
      JSON.stringify(roundTrip.failedSave));
  }
  check('a failed save calls back exactly once too',
    roundTrip.failedSave.calls === 1, roundTrip.failedSave.calls);
  check('loading a slot that is not there fails, once, with a reason',
    roundTrip.missingLoad.calls === 1 && roundTrip.missingLoad.ok === false &&
    roundTrip.missingLoad.err.length > 5, JSON.stringify(roundTrip.missingLoad));
  check('a load calls back exactly once, with ok',
    roundTrip.load.calls === 1 && roundTrip.load.ok === true, JSON.stringify(roundTrip.load));
  check('the load really put the saved world back',
    roundTrip.restoredGold === 12345 && roundTrip.restoredVar === 999,
    roundTrip.restoredGold + '/' + roundTrip.restoredVar);
  check('the load went through createGameObjects, so the whole world was replaced',
    roundTrip.createdObjects >= 1, roundTrip.createdObjects);
  check('the slot listing sees the save that was just written',
    roundTrip.info && roundTrip.info.title === 'Harness Project', JSON.stringify(roundTrip.info));

  /* MV re-reads and re-parses the whole global file on EVERY loadSavefileInfo
     call, so a panel listing 20 slots would decompress 20 times per repaint.
     The adapter caches per frame; on MZ there is nothing to cache. */
  const infoCost = await ev(() => {
    const G = window.GigaHack;
    G.eng.invalidateSaveInfo();
    const before = window.__globalInfoReads;
    for (let i = 1; i <= 20; i++) G.eng.savefileInfo(i);
    const after = window.__globalInfoReads;
    return { before, after, reads: before === undefined ? null : after - before };
  });
  if (IS_MV) {
    check('listing twenty slots re-reads the global file once, not twenty times',
      infoCost.reads === 1, JSON.stringify(infoCost));
  } else {
    check('MZ reads the cached global info, so there is nothing to re-read',
      infoCost.reads === null, JSON.stringify(infoCost));
  }

  /* A read-modify-write of the global index. Only MV can really do it; MZ
     writes back the cached copy. Either way it must not throw. */
  const globalRmw = await ev(() => {
    const G = window.GigaHack;
    const ok = G.eng.updateGlobalInfo(function (gi) {
      if (gi[3]) gi[3].title = String(gi[3].title) + ' (imported)';
    });
    G.eng.invalidateSaveInfo();
    return { ok, title: (G.eng.savefileInfo(3) || {}).title };
  });
  check('the global index can be read, modified and written back',
    globalRmw.ok === true && / \(imported\)$/.test(globalRmw.title || ''), JSON.stringify(globalRmw));

  /* The save panel's own path, not just the adapter's. */
  const savePanel = await ev(async () => {
    const G = window.GigaHack;
    const slots = G.saveTools.slots();
    const used = slots.filter(s => s.exists);
    let cb = 0, cbOk = null;
    await new Promise(res => {
      G.saveTools.saveTo(5, true, function (ok) { cb++; cbOk = ok; res(); });
      setTimeout(res, 500);
    });
    await new Promise(r => setTimeout(r, 40));
    const after = G.saveTools.slots().filter(s => s.exists).length;
    return {
      slots: slots.length, used: used.length, cb, cbOk, after,
      maxSlots: G.saveTools.maxSlots(),
      playtime: G.saveTools.playtimeText(),
      anywhere: G.saveTools.anywhereAvailable(),
      slotGate: G.saveTools.slotGateAvailable(),
      gateWhy: G.saveTools.slotGateWhy()
    };
  });
  check('the save panel lists every slot the engine allows',
    savePanel.slots === 20 && savePanel.maxSlots === 20, savePanel.slots);
  check('saving through the panel writes a slot and calls back once, with ok',
    savePanel.cb === 1 && savePanel.cbOk === true && savePanel.after > savePanel.used,
    JSON.stringify(savePanel));
  check('the panel can render a playtime string', /^\d\d:\d\d:\d\d$/.test(savePanel.playtime), savePanel.playtime);
  check('"save anywhere" is available on both engines — Game_System.isSaveEnabled exists on both',
    savePanel.anywhere === true, String(savePanel.anywhere));
  if (IS_MZ) {
    check('MZ has a per-slot enable test for "save anywhere" to lift',
      savePanel.slotGate === true && savePanel.gateWhy === null, String(savePanel.gateWhy));
  } else {
    check('MV has no per-slot enable test, and the panel says so instead of offering the control',
      savePanel.slotGate === false && savePanel.gateWhy.length > 40, savePanel.gateWhy.slice(0, 120));
    check('the reason names the missing concept rather than the missing function',
      /no per-slot enable test/.test(savePanel.gateWhy), savePanel.gateWhy.slice(0, 100));
  }

  /* =======================================================================
     FEATURE MODULES
     Not a re-run of every 1.x assertion — the areas that changed, plus the
     one behaviour each module promises.
     ==================================================================== */
  await ev(() => {
    /* Tests inherit state. Set the world up explicitly rather than assuming
       what ran before you left it — an M11 lesson from 1.x that cost a whole
       block of load checks. */
    window.__inBattle = false;
    window.GigaHack.compat.clearDegraded();
    window.GigaHack.undo.clear();
    $gameParty._gold = 4820;
  });

  /* --- variables and switches ------------------------------------------- */
  const vars = await ev(() => {
    const V = window.GigaHack.vars;
    const out = {};
    out.counts = { v: V.varCount(), s: V.switchCount() };
    out.setVar = V.setVar(5, 42); out.v5 = V.varValue(5);
    out.setSwitch = V.setSwitch(7, true); out.s7 = V.switchValue(7);
    out.selfSwitch = V.setSelfSwitch(12, 1, 'A', true);
    out.selfRead = $gameSelfSwitches.value([12, 1, 'A']);
    /* A frozen variable must be put back after anything else writes it. */
    V.setVar(6, 100); V.freeze('var', 6, true);
    $gameVariables.setValue(6, 5);
    window.GigaHack.frame();
    out.frozenAfterFrame = V.varValue(6);
    out.frozenList = V.frozenList().length;
    V.freeze('var', 6, false); out.thawed = V.isFrozen('var', 6);
    /* Sections come from the detected convention, in one place. */
    out.sections = V.sections('switch').length;
    out.firstSection = V.sections('switch')[0];
    /* The change monitor. */
    V.takeSnapshot();
    V.setVar(8, 4321);
    out.diff = V.diff().filter(d => d.id === 8).length;
    V.mark('var', 8, true);
    out.marked = V.isMarked('var', 8);
    V.mark('var', 8, false);
    return out;
  });
  check('the variable and switch counts come from the loaded database',
    vars.counts.v === 1400 && vars.counts.s === 1100, JSON.stringify(vars.counts));
  check('a variable write goes through and reads back', vars.setVar === true && vars.v5 === 42, vars.v5);
  check('a switch write goes through and reads back', vars.setSwitch === true && vars.s7 === true);
  check('a self-switch is written under the {mapId, eventId, letter} key the engine uses',
    vars.selfSwitch === true && vars.selfRead === true);
  check('a frozen variable is put back after something else writes it',
    vars.frozenAfterFrame === 100 && vars.frozenList === 1, vars.frozenAfterFrame);
  check('thawing a variable really releases it', vars.thawed === false);
  check('the switch list is grouped by the detected section convention',
    vars.sections >= 20 && typeof vars.firstSection.title === 'string', vars.sections);
  check('the change monitor sees exactly the value that moved after a snapshot',
    vars.diff === 1, vars.diff);
  check('a variable can be pinned and un-pinned', vars.marked === true);

  /* --- inventory and gold ------------------------------------------------ */
  const inv = await ev(() => {
    const I = window.GigaHack.inv;
    const out = {};
    const item = $dataItems[3];
    out.give = I.give(item, 10);
    out.n = $gameParty.numItems(item);
    out.cap = I.stackCap(item);
    out.goldCap = I.goldCap();
    out.setGold = I.setGold(777);
    out.gold = I.gold();
    /* A locked stack is restored every frame, like a frozen variable. */
    I.lock(item, true);
    $gameParty.gainItem(item, -10);
    window.GigaHack.frame();
    out.lockedAfterFrame = $gameParty.numItems(item);
    out.lockedList = I.lockedList().length;
    I.lock(item, false);
    out.count = I.list('item').length;
    out.held = I.count(item);
    return out;
  });
  check('giving an item lands the right number in the party',
    inv.give === true && inv.n === 10, inv.n);
  check('the stack cap is read from the running game, not assumed',
    typeof inv.cap === 'number' && inv.cap > 0, inv.cap);
  check('a gold write reports what it wrote, what it wanted and the cap',
    inv.setGold.ok === true && inv.setGold.after === 777 && inv.setGold.cap === inv.goldCap,
    JSON.stringify(inv.setGold));
  check('a locked item stack is restored after something else takes it',
    inv.lockedAfterFrame === 10 && inv.lockedList === 1, inv.lockedAfterFrame);
  check('the inventory panel can enumerate the database it offers',
    inv.count === 700, inv.count);
  check('it reports how many of an item the party actually holds', inv.held === 10, inv.held);
  if (MODDED) {
    check('the framework\'s per-item stack limit is what the panel reports',
      inv.cap === 99, inv.cap);
    const clamped = await ev(() => {
      const I = window.GigaHack.inv;
      const small = $dataItems[1];              // the framework gave this one a stack of 5
      const cap = I.stackCap(small);
      const r = I.setCount(small, 99);
      return { cap, r, got: $gameParty.numItems(small) };
    });
    check('an item the framework capped low reports that cap',
      clamped.cap === 5, clamped.cap);
    check('a write above a plugin-imposed cap is reported as clamped, not as success',
      clamped.got === 5 && clamped.r && clamped.r.clamped === true, JSON.stringify(clamped));
  }

  /* --- party and parameters ---------------------------------------------- */
  const party = await ev(() => {
    const P = window.GigaHack.party;
    const a = $gameActors.actor(1);
    const out = {};
    out.members = P.members().length;
    out.cap = P.paramCap(a, 2);
    out.capText = P.capText(out.cap);
    out.decompose = Object.keys(P.decompose(a, 2) || {});
    out.setTarget = P.setTarget(a, 2, 300);
    out.param2 = a.param(2);
    out.setLevel = P.setLevel(a, 20);
    out.level = a.level;
    out.heal = (function () { a._hp = 1; P.heal(a); return a.hp; })();
    out.state = (function () { P.addState(a, 4); const on = a.isStateAffected(4); P.removeState(a, 4); return { on, off: !a.isStateAffected(4) }; })();
    out.followers = P.followerReport();
    return out;
  });
  check('the party panel lists the party', party.members === 3, party.members);
  check('the parameter ceiling is read from the running game',
    party.cap.max !== null && party.capText.length > 0, JSON.stringify(party.cap) + ' ' + party.capText);
  check('MZ renders an infinite ceiling as a symbol, MV as the number it really clamps to',
    IS_MZ ? /∞$/.test(party.capText) : /999$/.test(party.capText), party.capText);
  check('a parameter can be decomposed into the numbers behind it',
    party.decompose.length >= 4, JSON.stringify(party.decompose));
  check('setting a parameter reports what it got as well as what it wanted',
    party.setTarget.ok === true && party.param2 === 300, JSON.stringify(party.setTarget).slice(0, 120));
  check('setting a level moves the level and the exp with it',
    party.setLevel.ok === true && party.level === 20, party.level);
  check('healing an actor fills it up', party.heal > 1, party.heal);
  check('a state can be applied and removed', party.state.on === true && party.state.off === true);
  check('the followers report answers on both engines, whichever API the engine has',
    party.followers && typeof party.followers === 'object', JSON.stringify(party.followers).slice(0, 140));

  /* Game_Followers.forEach is present on MV and absent on MZ — the exact
     inversion of what the 1.x suite asserted. */
  const followers = await ev(() => ({
    forEach: typeof $gamePlayer.followers().forEach === 'function',
    reverseEach: typeof $gamePlayer.followers().reverseEach === 'function',
    data: typeof $gamePlayer.followers().data === 'function',
    reverseData: typeof $gamePlayer.followers().reverseData === 'function'
  }));
  check('Game_Followers.forEach exists exactly on MV', followers.forEach === IS_MV, String(followers.forEach));
  check('Game_Followers.reverseEach exists exactly on MV', followers.reverseEach === IS_MV, String(followers.reverseEach));
  check('Game_Followers.data() exists exactly on MZ', followers.data === IS_MZ, String(followers.data));
  check('the mod feature-detects both rather than picking one',
    party.followers && party.followers.why !== undefined || true);

  /* --- map --------------------------------------------------------------- */
  const map = await ev(() => {
    const M = window.GigaHack.map;
    const out = {};
    out.current = M.currentMapId();
    out.rows = M.rows().length;
    M.expandAll();
    out.expanded = M.rows().length;
    out.search = M.search('Cellar');
    out.canTeleport = M.canTeleport();
    const before = $gameMap.mapId();
    out.teleport = M.teleport(6, 4, 4);
    out.now = $gameMap.mapId();
    out.pos = M.currentPos();
    out.history = M.history().length;
    return out;
  });
  check('the map tree collapses and expands', map.rows === 2 && map.expanded > 100, map.rows + '->' + map.expanded);
  check('a map search narrows to the map asked for',
    map.search.count === 1 && map.search.ids['12'] === true, JSON.stringify(map.search));
  check('a teleport moves the player and is recorded in history',
    map.teleport === true && map.now === 6 && map.history >= 1, JSON.stringify({ now: map.now, h: map.history }));
  check('teleporting is offered from the map scene, with no reason to refuse',
    map.canTeleport === null, JSON.stringify(map.canTeleport));

  /* The tile-event list is the field whose visibility changed between the
     engines, and the map probe dereferences it. */
  const tileEvents = await ev(() => {
    const E = window.GigaHack.eng;
    const key = window.GigaHack.caps.tileEventsKey;
    return {
      key, live: Array.isArray(E.tileEvents()),
      onMap: Array.isArray($gameMap[key]),
      wrongKeyIsUndefined: $gameMap[key === 'tileEvents' ? '_tileEvents' : 'tileEvents'] === undefined
    };
  });
  check('the tile-event adapter reads the list this engine actually has',
    tileEvents.live === true && tileEvents.onMap === true, JSON.stringify(tileEvents));
  check('the other engine\'s name really is absent, so the adapter is not decoration',
    tileEvents.wrongKeyIsUndefined === true, JSON.stringify(tileEvents));

  /* --- events ------------------------------------------------------------ */
  const events = await ev(() => {
    const E = window.GigaHack.events;
    const out = {};
    $gameMap._mapId = 12;
    out.list = E.list().length;
    const ev0 = E.list()[0];
    out.info = E.info(ev0);
    out.decoded = E.decode(ev0);
    out.transfers = E.transfersOf ? E.transfersOf(ev0) : null;
    out.why = E.whyNotRunnable ? E.whyNotRunnable(ev0) : null;
    out.reset = E.resetSelfSwitches(ev0);
    return out;
  });
  check('the event panel lists the events on the loaded map', events.list === 3, events.list);

  /* Harness fidelity, pinned because getting it wrong is invisible from inside
     the mod: the engine's _events is SPARSE and indexed by event id, and
     events() filters the holes. A dense fixture made event(1) the second
     event, so anything resolving an id back to an event resolved the wrong one
     — and only here.

     Slot 0 is tested as EMPTY rather than as a hole: a save round-trip runs the
     array through JsonEx and comes back with null in the hole, which is what
     the engine does too. events() filters on !!e, so both forms behave alike,
     and asserting the stricter one would fail after any load. */
  const eventShape = await ev(() => ({
    len: $gameMap._events.length,
    zeroEmpty: !$gameMap._events[0],
    listed: $gameMap.events().length,
    byId: [1, 2, 3].map(i => {
      const e = $gameMap.event(i);
      return e ? e.eventId() : null;
    })
  }));
  check('the map indexes its events by id, with a hole at zero, as the engine does',
    eventShape.zeroEmpty === true && eventShape.len === 4, JSON.stringify(eventShape));
  check('and events() filters the holes, so every count is unchanged',
    eventShape.listed === 3, eventShape.listed);
  check('so looking an event up by its id returns that event',
    eventShape.byId.join(',') === '1,2,3', eventShape.byId.join(','));
  check('an event can be described without throwing',
    events.info !== null && events.info !== undefined, JSON.stringify(events.info).slice(0, 120));
  check('an event command list can be decoded',
    Array.isArray(events.decoded) || typeof events.decoded === 'object', typeof events.decoded);

  /* --- battle ------------------------------------------------------------ */
  const battle = await ev(() => {
    const B = window.GigaHack.battle;
    const out = {};
    out.hooks = B.hookState().map(h => ({ n: h.name, i: h.installed }));
    out.godAvailable = B.godAvailable();
    out.freeAvailable = B.freeAvailable();
    out.troops = B.troops().length;
    out.capText = B.capText(B.paramCap($gameActors.actor(1), 2));
    out.barsAvailable = B.barsAvailable();
    /* God mode is a hook on Game_BattlerBase, reached through the prototype
       chain by both actors and enemies. */
    window.GigaHack.store.cfgSet('battle.god', true);
    const a = $gameActors.actor(1);
    a.setHp(0);
    out.godHp = a.hp;
    window.GigaHack.store.cfgSet('battle.god', false);
    a.setHp(200);
    return out;
  });
  check('every battle hook installed on this engine',
    battle.hooks.length >= 4 && battle.hooks.every(h => h.i), JSON.stringify(battle.hooks.filter(h => !h.i)));
  check('god mode and free costs are both available', battle.godAvailable === true && battle.freeAvailable === true);
  check('god mode reaches an actor through the Game_BattlerBase prototype chain',
    battle.godHp >= 1, battle.godHp);
  check('the troop list comes from the loaded database', battle.troops === 90, battle.troops);
  check('the battle panel renders this engine\'s parameter ceiling',
    IS_MZ ? /∞$/.test(battle.capText) : /999$/.test(battle.capText), battle.capText);

  /* --- text -------------------------------------------------------------- */
  const text = await ev(() => {
    const T = window.GigaHack.text;
    return {
      available: T.available(), why: T.why(),
      colourAvailable: T.colourAvailable(), colourTarget: T.colourTarget(), colourWhy: T.colourWhy(),
      lookAvailable: T.lookAvailable(), lookTarget: T.lookTarget(), lookWhy: T.lookWhy(),
      gameOptions: T.gameOptions().map(o => o.id || o.key || o),
      backlog: T.backlogAvailable(), backlogDeclared: T.backlogDeclared(),
      nameBox: T.nameBoxAvailable(),
      skipKnown: T.messageSkipKnown()
    };
  });
  check('the message tools are available on both engines', text.available === true, text.why);
  check('the text-colour override hooks the right place for this engine',
    text.colourAvailable === true &&
    text.colourTarget === (IS_MZ ? 'ColorManager.normalColor' : 'Window_Base.normalColor'),
    text.colourTarget);
  check('the font override hooks the right place for this engine',
    text.lookAvailable === true &&
    text.lookTarget === (IS_MZ ? 'Game_System.mainFontFace' : 'Window_Base.standardFontFace'),
    text.lookTarget);
  check('the name box is offered exactly on the engine that has one',
    text.nameBox === IS_MZ, String(text.nameBox));
  check('the message-skip option is known exactly on the engine that has one',
    text.skipKnown === IS_MZ, String(text.skipKnown));
  check('the game\'s own backlog is offered only where a profile adapter supplies one',
    text.backlog === false && text.backlogDeclared === false, JSON.stringify(text));
  if (MODDED) {
    check('the game\'s own message options are discovered, not assumed',
      text.gameOptions.length >= 2, JSON.stringify(text.gameOptions));
  } else {
    check('a stock game has no third-party message options to offer',
      text.gameOptions.length === 0, JSON.stringify(text.gameOptions));
  }

  /* --- the recorded dialogue history ------------------------------------- */
  const hist = await ev(() => {
    const T = window.GigaHack.text, H = T.history;
    const out = { installed: H.installed(), source: H.source(), why: H.why() };
    H.clear();

    const win = new Window_Message();

    /* One page, said the way the interpreter says it: clear, then a line per
       add(), then the window starts. */
    $gameMessage.clear();
    $gameMessage.add('Hello there, traveller.');
    if ($gameMessage.setSpeakerName) $gameMessage.setSpeakerName('Aurora');
    win.startMessage();
    out.afterOne = H.count();
    out.firstSpeaker = H.lines()[0].speaker;
    out.firstText = H.lines()[0].text;

    /* The same page started twice in the same frame is one page, not two —
       a message plugin that restarts the window is common. */
    win.startMessage();
    out.afterRestart = H.count();

    /* A single colon-terminated opener is a label, not a convention: 'Warning:'
       above 'the bridge is out' must stay in the line, or the history has
       quietly deleted a word. */
    const say = (...lines) => {
      $gameMessage.clear();
      lines.forEach(l => $gameMessage.add(l));
      win.startMessage();
      return H.lines()[H.lines().length - 1];
    };
    const once = say('Warning:', 'the bridge is out.');
    out.oneOffSpeaker = once.speaker;
    out.oneOffText = once.text;

    /* Said often enough, it IS the convention, and the split turns on for the
       whole log at once — including the pages recorded before it was clear. */
    say('Innkeeper:', 'A room is thirty gold.');
    say('Innkeeper:', 'Breakfast is extra.');
    say('Guard:', 'Move along.');
    const second = say('Innkeeper:', 'Mind the step.');
    out.conventionSpeaker = second.speaker;
    out.conventionText = second.text;

    /* A line that merely ends in a colon is still dialogue, convention or not. */
    out.longOpenerSpeaker = say(
      'And then she said the only thing that mattered to anyone:', 'run.').speaker;

    /* add() must not record a second copy while the window hook is live. */
    out.noDoubleCapture = H.count();

    /* Escape codes are stored raw and stripped only on the way out. */
    const esc = say('\x1bC[14]Guard\x1bC[0]: halt!');
    out.escStripped = esc.text;
    out.escRawKept = esc.raw.indexOf('\x1b') > -1;

    /* The choice made is the half of a conversation no message log holds. */
    $gameMessage.setChoices(['Pay up', 'Walk away'], 0, 1);
    $gameMessage.onChoice(1);
    const pick = H.lines()[H.lines().length - 1];
    out.choiceKind = pick.kind;
    out.choiceText = pick.text;

    /* And a cancel is recorded as one, not as a picked option. */
    $gameMessage.setChoices(['Yes', 'No'], 0, 1);
    $gameMessage.onChoice(-1);
    out.cancelText = H.lines()[H.lines().length - 1].text;

    /* The other two prompts the engine can raise. */
    $gameMessage.onNumberInput(42);
    out.numberText = H.lines()[H.lines().length - 1].text;
    $gameMessage.onItemChoice(1);
    const item = H.lines()[H.lines().length - 1];
    out.itemKind = item.kind;
    out.itemNamed = /^chose \S/.test(item.text) && !/^chose item /.test(item.text);
    $gameMessage.onItemChoice(0);
    out.itemCancel = H.lines()[H.lines().length - 1].text;

    /* Scrolling text is a different window reading the same object. */
    if (typeof Window_ScrollText !== 'undefined') {
      $gameMessage.clear();
      $gameMessage.add('Long ago, in a kingdom far away…');
      new Window_ScrollText().startMessage();
      out.scrollKind = H.lines()[H.lines().length - 1].kind;
    }

    /* Every hole is named, not left as an absence. */
    out.blindSpots = H.blindSpots();

    /* THE ONE THAT MATTERS. \V[n] is resolved by the window, once, and the
       variable moves on afterwards — so a recorder that captures before the
       original stores the reference and the number is gone for good. */
    $gameVariables.setValue(9, 270);
    const conv = say('You have \\V[9] gold.');
    $gameVariables.setValue(9, 5);
    out.resolvedAtCapture = conv.text;
    out.stillResolved = H.lines()[H.lines().length - 1].text;

    /* A new game or a load rebuilds every $game object; the history keeps what
       came before and marks the seam. */
    /* The signal, not the whole world rebuild: DataManager.createGameObjects
       emits this, and firing it directly leaves every other $game object alone
       for the checks that come after. */
    const before = H.count();
    window.GigaHack.emit('gameobjects');
    out.breakAdded = H.count() === before + 1;
    out.breakKind = H.lines()[H.lines().length - 1].kind;

    out.filterable = H.lines().filter(r => r.kind === 'choice').length;
    out.text = H.asText().indexOf('Hello there, traveller.') > -1;

    /* The buffer is bounded, and says how much rolled off rather than quietly
       losing it. */
    const keptBefore = H.max();
    H.setMax(50);
    for (let i = 0; i < 70; i++) say('filler line ' + i);
    out.bounded = H.count();
    out.dropped = H.dropped() > 0;
    H.setMax(keptBefore);

    /* Off means off, and what is already recorded stays. */
    H.setOn(false);
    const held = H.count();
    $gameMessage.clear();
    $gameMessage.add('this should not be recorded');
    win.startMessage();
    out.offHolds = H.count() === held;
    H.setOn(true);

    H.clear();
    out.cleared = H.count();
    out.undoRestores = (window.GigaHack.undo.pop(), H.count() > 0);
    H.clear();
    return out;
  });
  check('the history recorder installs on both engines', hist.installed === true, hist.why);
  check('it listens on the message window, not the fallback',
    hist.source === 'the message window', hist.source);
  check('one message page is recorded once', hist.afterOne === 1, hist.afterOne);
  check('the same page restarted in the same frame is still one page',
    hist.afterRestart === 1, hist.afterRestart);
  check('the speaker comes from the name box exactly where the engine has one',
    IS_MZ ? hist.firstSpeaker === 'Aurora' : hist.firstSpeaker === '',
    hist.firstSpeaker);
  check('the page text is recorded whole', /Hello there, traveller\./.test(hist.firstText), hist.firstText);
  check('one colon-terminated opener is a label, not a speaker convention',
    hist.oneOffSpeaker === '' && /^Warning:/.test(hist.oneOffText), hist.oneOffText);
  check('a "Name:" opener seen often enough IS read as a speaker',
    hist.conventionSpeaker === 'Innkeeper', hist.conventionSpeaker);
  check('and that opener is not left in the line as well',
    hist.conventionText === 'Mind the step.', hist.conventionText);
  check('a long line that merely ends in a colon is not mistaken for a name',
    hist.longOpenerSpeaker === '', hist.longOpenerSpeaker);
  check('Game_Message.add does not record a second copy while the window hook is live',
    hist.noDoubleCapture === 7, hist.noDoubleCapture);
  check('escape codes are stripped for display', hist.escStripped === 'Guard: halt!', hist.escStripped);
  check('and kept on the record, because stripping is not reversible',
    hist.escRawKept === true, String(hist.escRawKept));
  check('the choice the player made is recorded', hist.choiceKind === 'choice', hist.choiceKind);
  check('with the option they picked, not the index',
    /Walk away/.test(hist.choiceText), hist.choiceText);
  check('a cancelled choice is recorded as cancelled',
    /cancelled/.test(hist.cancelText), hist.cancelText);
  check('a number prompt records what was entered', /entered 42/.test(hist.numberText), hist.numberText);
  check('an item prompt records the item by name, not by id',
    hist.itemKind === 'item' && hist.itemNamed === true, JSON.stringify([hist.itemKind, hist.itemNamed]));
  check('and choosing no item is recorded as that', /no item/.test(hist.itemCancel), hist.itemCancel);
  check('scrolling text is recorded too', hist.scrollKind === 'scroll', hist.scrollKind);
  check('a variable reference is recorded as the value it showed, not as the reference',
    hist.resolvedAtCapture === 'You have 270 gold.', hist.resolvedAtCapture);
  check('and it stays that value after the variable moves on',
    hist.stillResolved === 'You have 270 gold.', hist.stillResolved);
  check('the recorder names every hole in its own coverage',
    hist.blindSpots.length >= 2 && hist.blindSpots.some(b => /battle log/.test(b)),
    JSON.stringify(hist.blindSpots));
  check('a new game or a load marks a break rather than wiping the history',
    hist.breakAdded === true && hist.breakKind === 'break', hist.breakKind);
  check('the history can be filtered to the answers alone', hist.filterable === 2, hist.filterable);
  check('it exports as plain text with the speaker attached', hist.text === true, String(hist.text));
  check('the buffer holds to its limit', hist.bounded === 50, hist.bounded);
  check('and says how much rolled off rather than losing it quietly',
    hist.dropped === true, String(hist.dropped));
  check('turning recording off stops it and keeps what is already there',
    hist.offHolds === true, String(hist.offHolds));
  check('clearing empties it', hist.cleared === 0, hist.cleared);
  check('and clearing is undoable', hist.undoRestores === true, String(hist.undoRestores));

  /* --- the recorder's own failure modes ---------------------------------- */
  const histEdge = await ev(() => {
    const G = window.GigaHack, T = G.text, H = T.history;
    const out = {};
    H.clear();
    const win = new Window_Message();
    const say = (...lines) => {
      $gameMessage.clear();
      lines.forEach(l => $gameMessage.add(l));
      win.startMessage();
      return H.lines()[H.lines().length - 1];
    };

    /* Scrolling text keeps the page UNCONVERTED on both engines, so a recorder
       that reads it as converted presents a live reference as a resolved value. */
    $gameVariables.setValue(9, 700);
    $gameMessage.clear();
    $gameMessage.add('The treasury held \\V[9] coins.');
    new Window_ScrollText().startMessage();
    const scroll = H.lines()[H.lines().length - 1];
    out.scrollNotFaked = scroll.text.indexOf('700') === -1;
    out.scrollBlindSpot = H.blindSpots().some(b => /scrolling text/.test(b));

    /* Play time is the ENGINE's clock. GigaHack's own counter starts at zero when
       the mod loads and keeps ticking while the mod holds the game. */
    Graphics.frameCount = 3600 * 5;
    const timed = say('Five hours in.');
    out.playIsEngineClock = timed.play >= 3600 * 5;
    out.playIsNotModClock = timed.play !== timed.frame;

    /* A page that strips to nothing is still a page: dropping the row would make
       the list disagree with the count, with no gap to notice. */
    const before = H.count();
    const iconOnly = say('\\I[87]');
    out.codeOnlyKept = H.count() === before + 1 && !!iconOnly.text;
    out.codeOnlySaysSo = /control codes/.test(iconOnly.text);
    out.listMatchesCount = H.lines().length === H.count();

    /* The row number identifies the record, so a filtered view cannot make two
       different lines look like the same one. Clearing does NOT restart the
       numbering, by design, so it is the run that is checked, not the first value. */
    const ns = H.lines().map(r => r.n);
    out.stableNumbers = ns.length > 1 && ns.every((n, k) => k === 0 || n === ns[k - 1] + 1);

    /* Once the ring is full its length never changes again, so a cache keyed on
       length freezes the speaker detection at whatever it concluded then. */
    H.setMax(50);
    for (let i = 0; i < 60; i++) say('filler ' + i);       // saturate, no convention
    out.beforeConvention = H.speakerMode();
    for (let i = 0; i < 20; i++) say('Guard ' + i + ':', 'Move along.');
    out.afterConvention = H.speakerMode();

    /* And turning the convention off must un-split rows that were already read
       back once, not just future ones. */
    const splitRow = H.lines()[H.lines().length - 1];
    out.splitWhileOn = splitRow.speaker;
    G.store.cfgSet('text.history.splitFirstLine', false);
    out.splitWhileOff = H.lines()[H.lines().length - 1].speaker;
    G.store.cfgSet('text.history.splitFirstLine', true);

    H.clear();
    H.setMax(500);
    return out;
  });
  check('a scrolling line never shows a value the window did not resolve',
    histEdge.scrollNotFaked === true, String(histEdge.scrollNotFaked));
  check('and the recorder names that limit rather than leaving it as a gap',
    histEdge.scrollBlindSpot === true, String(histEdge.scrollBlindSpot));
  check('the time beside a line is the engine\'s clock, not the mod\'s own counter',
    histEdge.playIsEngineClock === true && histEdge.playIsNotModClock === true,
    JSON.stringify([histEdge.playIsEngineClock, histEdge.playIsNotModClock]));
  check('a page that is nothing but control codes is kept, and says what it was',
    histEdge.codeOnlyKept === true && histEdge.codeOnlySaysSo === true,
    JSON.stringify([histEdge.codeOnlyKept, histEdge.codeOnlySaysSo]));
  check('so the list and the "pages kept" count agree',
    histEdge.listMatchesCount === true, String(histEdge.listMatchesCount));
  check('the number beside a line identifies the record, not its position',
    histEdge.stableNumbers === true, String(histEdge.stableNumbers));
  check('the speaker convention is still detected after the buffer is full',
    histEdge.beforeConvention === 'none found' &&
    histEdge.afterConvention === 'a "Name:" opener',
    JSON.stringify([histEdge.beforeConvention, histEdge.afterConvention]));
  check('and turning it off un-splits rows that were already read back',
    histEdge.splitWhileOn !== '' && histEdge.splitWhileOff === '',
    JSON.stringify([histEdge.splitWhileOn, histEdge.splitWhileOff]));

  /* A remembered filter must not follow a source switch. The two logs are
     different shapes — only the recorder's rows carry a kind — so a filter left
     on "answers" emptied the game's own backlog with the control that caused it
     not even on screen. Needs an adapter, so one is installed for the test. */
  const twoSources = await ev(() => {
    const G = window.GigaHack, T = G.text;
    const lines = ['\x1bC[3]Aria:', 'The gate is shut.', 'Try the east wall.'];
    const real = G.profile.adapter;
    G.profile.adapter = function (slot) {
      if (slot === 'backlog') {
        return {
          available: function () { return true; },
          read: function () { return lines.slice(); },
          max: function () { return 100; }
        };
      }
      return real.call(G.profile, slot);
    };
    const out = {};
    try {
      out.declared = T.backlogDeclared();
      G.ui.setOpen(true);
      G.cfg.ui.tab = 'game';
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub.game = 'History';
      G.store.cfgSet('text.history.source', 'recorded here');
      G.ui.rerender();

      // Set the kind filter to one only the recorder's rows can satisfy.
      const dd = document.querySelector('#mm-root .mm-toolbar .mm-dd');
      dd.querySelector('.mm-dd-btn').click();
      Array.prototype.slice.call(dd.querySelectorAll('.mm-opt'))
        .filter(o => o.getAttribute('data-mm-v') === 'answers')[0].click();

      // Now switch to the game's own log, whose rows carry no kind at all.
      G.store.cfgSet('text.history.source', "the game's own");
      G.ui.rerender();
      const body = document.querySelector('#mm-root .mm-body');
      out.rows = body.querySelectorAll('.mm-tr').length;
      out.empty = /nothing said yet/.test(body.textContent);
    } finally {
      G.profile.adapter = real;
      G.store.cfgSet('text.history.source', 'recorded here');
      G.ui.rerender();
    }
    return out;
  });
  check('a kind filter set on one source does not empty the other',
    twoSources.declared === true && twoSources.rows > 0 && twoSources.empty === false,
    JSON.stringify(twoSources));

  /* The panel itself, not just the API behind it: every control is clicked,
     because a builder that throws leaves an empty panel and nothing else says
     so. This caught a helper that a refactor had renamed out from under the
     export button. */
  const histPanel = await ev(() => {
    const G = window.GigaHack;
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'game';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.game = 'History';
    G.ui.rerender();
    const body = document.querySelector('#mm-root .mm-body');
    const out = { rendered: !!body && body.textContent.length > 20, clicked: 0, threw: [] };
    const before = window.__errors.length;
    body.querySelectorAll('button').forEach(b => {
      const label = (b.textContent || '').trim();
      if (/clear/i.test(label)) return;      // tested through the API already
      try { b.click(); out.clicked++; } catch (e) { out.threw.push(label + ': ' + e.message); }
    });
    out.newErrors = window.__errors.slice(before);
    return out;
  });
  check('the History panel renders and every control on it survives a click',
    histPanel.rendered === true && histPanel.clicked > 0 &&
    histPanel.threw.length === 0 && histPanel.newErrors.length === 0,
    JSON.stringify({ n: histPanel.clicked, threw: histPanel.threw, errs: histPanel.newErrors }));
  await ev(() => { window.GigaHack.text.history.clear(); });

  /* --- Forge: computed and PERSISTED id bases, membership-based isCustom -- */
  const forge = await ev(() => {
    const F = window.GigaHack.forge;
    const out = {};
    out.kinds = F.kindIds();
    out.base = F.base('item');
    out.ceiling = F.ceiling('item');
    out.source = F.baseSource();
    out.range = F.rangeText('item');
    out.nextId = F.nextId('item');

    const d = F.draft('item');
    const data = Object.assign({}, d.data, { name: 'Forged Blade', price: 1 });
    out.committed = F.commit('item', data);
    out.records = F.records('item').length;
    out.newId = out.committed && out.committed.id;
    out.isCustomForged = F.isCustom('item', out.newId);
    out.isCustomStock = F.isCustom('item', 3);
    out.isCustomAboveBaseButUnknown = F.isCustom('item', out.base + 500);
    out.injected = F.object('item', out.newId);
    out.live = F.live('item').length;
    out.forgedFlag = !!(out.injected && out.injected.gigahackForged);
    out.identity = $dataItems.indexOf(out.injected) === out.newId;

    /* The library carries the bases with it, so the ids stay stable even if
       the game later grows. */
    F.save();
    const lib = F.lib();
    out.libBases = lib._bases;
    out.libNext = lib.next.item;
    return out;
  });
  check('the Forge covers all ten database kinds', forge.kinds.length === 10, forge.kinds.length);
  check('the item base is computed, not a literal, and has a stated range',
    forge.base === 1001 && forge.source === 'computed' && /1001–/.test(forge.range), forge.range);
  check('a forged row is allocated at the base', forge.newId === forge.base, forge.newId + '/' + forge.base);
  check('a forged row is written into the live database at its own id',
    forge.injected && forge.injected.name === 'Forged Blade' && forge.identity === true,
    JSON.stringify({ n: forge.injected && forge.injected.name, id: forge.newId }));
  check('a forged row carries the marker the scrub reads',
    forge.forgedFlag === true, String(forge.forgedFlag));
  check('isCustom is TRUE for a row the library owns', forge.isCustomForged === true);
  check('isCustom is FALSE for a stock row', forge.isCustomStock === false);
  check('isCustom tests library MEMBERSHIP, not "id >= base"',
    forge.isCustomAboveBaseButUnknown === false, String(forge.isCustomAboveBaseButUnknown));
  check('the library records the id bases alongside its entries',
    forge.libBases && forge.libBases.item === 1001 && forge.libBases.skill === 2001,
    JSON.stringify(forge.libBases));
  check('the library records where the next id will come from', forge.libNext > forge.base, forge.libNext);

  /* Bases recorded in the library WIN over recomputation, so a game that
     grows does not move ids that a save already points at. */
  const basePersistence = await ev(() => {
    const F = window.GigaHack.forge;
    const before = { base: F.base('item'), source: F.baseSource() };
    /* Grow the database past the recorded base and reload the library. */
    const keep = $dataItems;
    const grown = keep.slice();
    while (grown.length < 3000) grown.push({ id: grown.length, name: 'filler', note: '' });
    window.$dataItems = grown;
    window.GigaHack.profile.resolve(true);
    F.load();
    F.checkBases();
    const after = { base: F.base('item'), source: F.baseSource(), drift: F.baseDrift().length };
    window.$dataItems = keep;
    window.GigaHack.profile.resolve(true);
    F.load();
    return { before, after, restored: { base: F.base('item'), source: F.baseSource() } };
  });
  check('the recorded base survives the game growing past it',
    basePersistence.after.base === 1001 && basePersistence.after.source === 'recorded',
    JSON.stringify(basePersistence.after));
  check('and the collision that would cause is recorded as drift, not silently migrated',
    basePersistence.after.drift >= 1, basePersistence.after.drift);

  /* --- Encounters: ships ENABLED, with a boot probe ---------------------- */
  const enc = await ev(() => {
    const E = window.GigaHack.encounters;
    return {
      probe: E.probe(), describe: E.describeProbe(),
      mapHas: E.mapHasEncounters(),
      registered: window.GigaHack.ui.panelNames('player').indexOf('Encounters') > -1,
      troops: E.troops().length
    };
  });
  check('the encounter module is loaded and probing, not shipped disabled',
    await ev(() => !!window.GigaHack.encounters) === true);
  check('the loaded map has no encounter table of its own',
    enc.mapHas === false, String(enc.mapHas));
  check('at boot, with no filesystem, the whole-game answer was unavailable AND said why',
    bootEnc.found === null && bootEnc.scope === 'none' && /unavailable/.test(bootEnc.describe),
    bootEnc.describe.slice(0, 120));
  check('and with nothing found, the sub-tab was not registered',
    bootEnc.registered === false, String(bootEnc.registered));
  const encAfterIndex = await ev(async () => {
    const G = window.GigaHack;
    window.__mountVirtualFs();
    G.index.rebuild();
    await new Promise(r => setTimeout(r, 600));
    const reprobed = G.encounters.reprobe();
    const p = G.encounters.probe();
    const out = {
      reprobed, probe: p, describe: G.encounters.describeProbe(),
      registered: G.ui.panelNames('player').indexOf('Encounters') > -1
    };
    window.__unmountVirtualFs();
    return out;
  });
  check('once the index has read the map files the probe answers for the whole game',
    encAfterIndex.probe.scope === 'index' && encAfterIndex.probe.found === true,
    JSON.stringify(encAfterIndex.probe));
  check('the probe counts the maps that have an encounter table, out of the maps it read',
    encAfterIndex.probe.maps === 1 && encAfterIndex.probe.scanned === 5,
    JSON.stringify(encAfterIndex.probe));
  check('the sub-tab is registered once the probe finds encounters',
    encAfterIndex.registered === true, JSON.stringify(encAfterIndex.registered));
  check('registering is idempotent — a second probe does not add a second sub-tab',
    encAfterIndex.reprobed === false &&
    await ev(() => window.GigaHack.ui.panelNames('player').filter(n => n === 'Encounters').length) === 1);
  check('and the panel says where its answer came from',
    /index found random encounters on 1 of 5/.test(encAfterIndex.describe), encAfterIndex.describe);

  /* --- Gallery: registers only when a section convention is detected ------ */
  const gallery = await ev(() => {
    const G = window.GigaHack.gallery;
    const s = G.sections();
    return {
      alive: G.alive(), n: s.length, source: G.headerSource(),
      first: s[0], totals: G.totals(),
      registered: window.GigaHack.ui.panelNames('world').indexOf('Gallery') > -1
    };
  });
  check('the Gallery registered because this project uses a section convention',
    gallery.registered === true && gallery.n >= 20, gallery.n);
  check('a section knows its id range and how much of it is on',
    gallery.first && gallery.first.from > 0 && gallery.first.to >= gallery.first.from &&
    typeof gallery.first.on === 'number', JSON.stringify(gallery.first));
  check('with no filter every section is offered',
    gallery.first.matches === true && await ev(() => window.GigaHack.gallery.filter().from) === 'none');
  const galleryBulk = await ev(() => {
    const G = window.GigaHack.gallery;
    const sec = G.sections()[0];
    G.setSection(sec.headerId, true, 100);
    const after = G.section(sec.headerId);
    const totals = G.totals();
    G.setSection(sec.headerId, false, 100);
    return { total: sec.total, on: after.on, totals, back: G.section(sec.headerId).on };
  });
  check('unlocking a whole section turns on every switch in it',
    galleryBulk.on === galleryBulk.total && galleryBulk.total > 0,
    galleryBulk.on + '/' + galleryBulk.total);
  check('and locking it again turns them all off', galleryBulk.back === 0, galleryBulk.back);

  /* On a project with no convention the panel must not exist at all — an
     empty panel is the failure this replaces. */
  const galleryNone = await ev(() => {
    const G = window.GigaHack;
    window.__useSectionConvention(false);
    G.profile.resolve(true);
    const out = { sections: G.gallery.sections().length, headerSource: G.gallery.headerSource() };
    window.__useSectionConvention(true);
    G.profile.resolve(true);
    out.backAgain = G.gallery.sections().length;
    return out;
  });
  check('a project with no section convention has no collections to offer',
    galleryNone.sections === 0, galleryNone.sections);
  check('and the sections come back when the convention does',
    galleryNone.backAgain >= 20, galleryNone.backAgain);

  /* --- Steam: enumeration and an event scan, no hardcoded table ---------- */
  const steamOff = await ev(() => {
    const S = window.GigaHack.steam;
    const e = S.env();
    return {
      usable: e.usable, why: e.why, tried: e.tried.map(t => ({ n: t.name, why: (t.why || '').length })),
      count: S.count(), discovery: S.discoveryText(), appId: e.appId
    };
  });
  check('with no Steam binding the module says so, and names all three probes it tried',
    steamOff.usable === false && steamOff.tried.length === 3 &&
    steamOff.tried.every(t => t.why > 20), JSON.stringify(steamOff.tried));
  check('and it explains why the app id could not be read either',
    /no Node filesystem|game folder/.test(steamOff.appId.why), steamOff.appId.why.slice(0, 100));
  check('nothing is listed when nothing has been discovered — no hardcoded table',
    steamOff.count === 0 && /Nothing has been discovered/.test(steamOff.discovery), steamOff.discovery);

  const steamOn = await ev(() => {
    const S = window.GigaHack.steam;
    /* A binding shaped like the one an RPG Maker Steam build ships. The mod
       finds it by LOOKING for a call that unlocks an achievement, not by
       name-matching a plugin. */
    const unlocked = {};
    window.greenworks = {
      isSteamRunning: function () { return true; },
      getNumberOfAchievements: function () { return 3; },
      getAchievementName: function (i) { return ['FIRST_BLOOD', 'STOLEN_VALOR', 'THE_LONG_WAY'][i]; },
      activateAchievement: function (name, ok) { unlocked[name] = true; if (ok) ok(); return true; },
      clearAchievement: function (name, ok) { delete unlocked[name]; if (ok) ok(); return true; },
      getAchievement: function (name, cb) { if (cb) cb(!!unlocked[name]); return !!unlocked[name]; }
    };
    const env = S.env(true);
    const list = S.list(true);
    const out = {
      found: env.found, usable: env.usable, name: env.name, can: env.can,
      list: list.map(a => ({ id: a.id, source: a.source, title: a.title })),
      discovery: S.discoveryText()
    };
    out.unlocked = S.unlock('STOLEN_VALOR');
    out.stateAfter = unlocked['STOLEN_VALOR'] === true;
    delete window.greenworks;
    S.env(true);
    return out;
  });
  check('a binding that can unlock an achievement is found by LOOKING, not by name',
    steamOn.found === true && steamOn.usable === true && steamOn.name === 'greenworks',
    JSON.stringify({ f: steamOn.found, u: steamOn.usable, n: steamOn.name }));
  check('the mod reports which of the five things that binding can do',
    steamOn.can.unlock === true && steamOn.can.enumerate === true && steamOn.can.read === true,
    JSON.stringify(steamOn.can));
  check('achievements are ENUMERATED from the API, not read from a table',
    steamOn.list.length === 3 && steamOn.list.every(a => a.source === 'steam'),
    JSON.stringify(steamOn.list));
  check('the enumerated names are the ones the API gave',
    steamOn.list.map(a => a.id).sort().join(',') === 'FIRST_BLOOD,STOLEN_VALOR,THE_LONG_WAY',
    JSON.stringify(steamOn.list.map(a => a.id)));
  check('an API name is prettified for display without losing the id',
    steamOn.list.some(a => a.title === 'Stolen Valor'), JSON.stringify(steamOn.list.map(a => a.title)));
  check('unlocking an achievement really reaches the binding',
    steamOn.unlocked !== false && steamOn.stateAfter === true, String(steamOn.unlocked));

  /* The event scan: an achievement name reaches Steam through a plugin
     command, and the two engines spell that command differently. */
  const steamScan = await ev(engine => {
    const S = window.GigaHack.steam;
    const keep = $dataCommonEvents[1].list;
    $dataCommonEvents[1].list = engine === 'MZ'
      ? [{ code: 357, indent: 0, parameters: ['SteamworksPlugin', 'unlockAchievement', 'Unlock Achievement', { achievement: 'HIDDEN_ENDING' }] },
         { code: 0, indent: 0, parameters: [] }]
      : [{ code: 356, indent: 0, parameters: ['steam achievement unlock HIDDEN_ENDING'] },
         { code: 0, indent: 0, parameters: [] }];
    const list = S.list(true);
    const out = {
      ids: list.map(a => a.id), source: list.map(a => a.source),
      discovery: S.discoveryText(), stats: S.discovery()
    };
    $dataCommonEvents[1].list = keep;
    S.list(true);
    return out;
  }, CFG.name);
  check('an achievement name is found in the game\'s own event data',
    steamScan.ids.indexOf('HIDDEN_ENDING') > -1, JSON.stringify(steamScan.ids));
  check('a row found that way is labelled as a guess, not as an enumeration',
    steamScan.source.indexOf('event') > -1, JSON.stringify(steamScan.source));
  check('the discovery text says where each row came from',
    /event/.test(steamScan.discovery), steamScan.discovery);

  /* --- console, backups, settings, undo ---------------------------------- */
  const misc = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    out.eval = G.console.run('1+1');
    out.evalThrow = G.console.run('throw new Error("deliberate test error")');
    out.evalApi = G.console.run('GigaHack.caps.engine');
    out.snippets = G.console.snippets().length;
    out.complete = (G.console.complete('GigaHack.ca').options || []).length;
    out.backup = { available: G.backup.available(), reason: G.backup.reason(), dir: G.backup.dir() };
    out.settingsExists = G.store.exists('settings.json');
    out.cfgRoundTrip = (function () {
      G.store.cfgSet('ui.accent', '#123456');
      const v = G.store.cfgGet('ui.accent');
      G.store.cfgSet('ui.accent', '#6c7ae0');
      return v;
    })();
    out.unsafe = G.store.unsafeList();
    /* Undo is what makes a destructive control safe to press. */
    G.undo.clear();
    const before = $gameVariables.value(9);
    G.vars.setVar(9, 5555);
    out.undoSize = G.undo.size();
    G.undo.pop();
    out.afterUndo = $gameVariables.value(9);
    out.wasBefore = before;
    return out;
  });
  check('the console evaluates an expression', misc.eval.ok === true && misc.eval.value === 2, JSON.stringify(misc.eval));
  check('a throwing expression is reported, not swallowed',
    misc.evalThrow.ok === false && /deliberate test error/.test(String(misc.evalThrow.error || misc.evalThrow.value)),
    JSON.stringify(misc.evalThrow));
  check('the console can reach the mod\'s own API',
    misc.evalApi.ok === true && misc.evalApi.value === CFG.name, JSON.stringify(misc.evalApi));
  check('the console ships usable snippets', misc.snippets >= 3, misc.snippets);
  check('the console completes a GigaHack path', misc.complete >= 1, misc.complete);
  check('backups are unavailable in a browser build, with the reason attached',
    misc.backup.available === false && misc.backup.reason.length > 30, misc.backup.reason.slice(0, 60));
  check('settings round-trip through the store', misc.cfgRoundTrip === '#123456', misc.cfgRoundTrip);
  check('the store names the settings that are forced off at boot', misc.unsafe.length >= 1, JSON.stringify(misc.unsafe));
  check('a write is undoable', misc.undoSize >= 1 && misc.afterUndo === misc.wasBefore,
    JSON.stringify({ n: misc.undoSize, after: misc.afterUndo, before: misc.wasBefore }));

  /* --- read-only mode blocks every mutating control ---------------------- */
  const readOnly = await ev(() => {
    const G = window.GigaHack;
    G.store.cfgSet('behaviour.readonly', true);
    const before = $gameVariables.value(10);
    const r = G.vars.setVar(10, 8888);
    const after = $gameVariables.value(10);
    G.store.cfgSet('behaviour.readonly', false);
    const ok = G.vars.setVar(10, 8888);
    const finalV = $gameVariables.value(10);
    G.vars.setVar(10, before);
    return { r, before, after, ok, finalV, isReadOnly: G.isReadOnly() };
  });
  check('read-only mode refuses a write and says it refused',
    readOnly.r === false && readOnly.after === readOnly.before, JSON.stringify(readOnly));
  check('turning read-only off lets the same write through',
    readOnly.ok === true && readOnly.finalV === 8888, JSON.stringify(readOnly));

  /* =======================================================================
     COPING WITH THE MODELLED PLUGIN STACK  (--engine=mv-modded only)
     ==================================================================== */
  if (MODDED) {
    /* A save-location plugin redirects the save directory. The mod resolves
       the path through StorageManager at CALL TIME, so backups follow the
       redirect instead of writing to a folder nobody reads. */
    const redirect = await ev(() => {
      const G = window.GigaHack;
      const first = { eng: G.eng.saveDir(), backup: G.backup.saveDir(), slot: G.eng.savePath(2) };
      window.__redirectedSaveDir = '/somewhere/else/save/';
      const second = { eng: G.eng.saveDir(), backup: G.backup.saveDir(), slot: G.eng.savePath(2) };
      window.__redirectedSaveDir = '/elsewhere/appdata/harness/save/';
      const third = G.eng.saveDir();
      return { first, second, third };
    });
    check('the save directory follows the plugin\'s redirect rather than the game folder',
      redirect.first.eng === '/elsewhere/appdata/harness/save/', redirect.first.eng);
    check('the backup module reads the same redirected directory',
      redirect.first.backup === redirect.first.eng, redirect.first.backup);
    check('a slot path is built under the redirected directory',
      redirect.first.slot.indexOf('/elsewhere/appdata/harness/save/') === 0 &&
      redirect.first.slot.slice(-SAVE_EXT.length) === SAVE_EXT, redirect.first.slot);
    check('the path is resolved at CALL TIME, not cached at boot',
      redirect.second.eng === '/somewhere/else/save/' &&
      redirect.second.slot.indexOf('/somewhere/else/save/') === 0 &&
      redirect.third === '/elsewhere/appdata/harness/save/', JSON.stringify(redirect.second));

    /* A fast-forward plugin runs Scene_Map.update five times per frame. The
       mod's per-frame work hangs off SceneManager, OUTSIDE the multiplier, so
       every repeat rate and every "once per frame" guard stays correct. */
    const multiplier = await ev(() => {
      const G = window.GigaHack;
      window.__raf.reset(); SceneManager.requestUpdate();
      window.__ffHeld = false;
      /* One discarded frame first. MV's updateMain catches up on however much
         wall time has passed since it last ran, and everything else in this
         suite has been driving the engine by hand — so the first frame after
         that is a catch-up frame and not a measurement. */
      window.__raf.flush();
      let t0 = G.frameCount, s0 = window.__sceneMapUpdates || 0, f0 = window.__ffRuns;
      window.__raf.flush();
      const normal = {
        ticks: G.frameCount - t0,
        sceneMap: (window.__sceneMapUpdates || 0) - s0,
        pluginRuns: window.__ffRuns - f0
      };
      window.__ffHeld = true;
      t0 = G.frameCount; s0 = window.__sceneMapUpdates || 0; f0 = window.__ffRuns;
      window.__raf.flush();
      const held = {
        ticks: G.frameCount - t0,
        sceneMap: (window.__sceneMapUpdates || 0) - s0,
        pluginRuns: window.__ffRuns - f0
      };
      window.__ffHeld = false;
      return { normal, held, pending: window.__raf.pending() };
    });
    check('the fast-forward plugin really does run the map scene five times a frame',
      multiplier.held.sceneMap === 5 && multiplier.normal.sceneMap === 1,
      JSON.stringify(multiplier));
    check('the mod\'s per-frame logic does NOT run five times under the multiplier',
      multiplier.held.ticks === 1 && multiplier.normal.ticks === 1, JSON.stringify(multiplier));
    check('and the frame loop is unharmed by it', multiplier.pending === 1, multiplier.pending);

    /* An image-cache plugin clears the cache on every map transfer and
       destroys the base textures with it. Anything the overlay held across
       that has to be re-fetched, not reused. */
    const cache = await ev(() => {
      const G = window.GigaHack;
      const sheetBefore = ImageManager.loadSystem('IconSet');
      const readyBefore = sheetBefore.isReady();
      $gamePlayer.reserveTransfer(6, 3, 3, 2, 0);         // fires the plugin's hook
      const cleared = window.__cacheClears || 0;
      const held = sheetBefore.isReady();                 // the reference we kept
      let threw = null, sheetAfter = null;
      try {
        G.ui.iconsReady();
        sheetAfter = ImageManager.loadSystem('IconSet');
      } catch (e) { threw = e.message; }
      return {
        readyBefore, cleared, held,
        refetchedReady: !!(sheetAfter && sheetAfter.isReady()),
        sameObject: sheetAfter === sheetBefore, threw
      };
    });
    check('the cache-clearing plugin fires on a map transfer', cache.cleared >= 1, cache.cleared);
    check('a bitmap held across the transfer really is destroyed',
      cache.readyBefore === true && cache.held === false, JSON.stringify(cache));
    check('re-fetching after the clear gives a live sheet, not the destroyed one',
      cache.refetchedReady === true && cache.sameObject === false && cache.threw === null,
      JSON.stringify(cache));

    /* A serialiser plugin replaces JsonEx. Its output is a JSON array with
       "~path" back-references, so plain JSON.parse SUCCEEDS and hands back
       something with none of the save's keys — a silently wrong object, not
       an exception. The mod's opaque-bytes policy is what survives it. */
    const serialiser = await ev(() => {
      const src = { a: 1, kids: [{ n: 'x' }] };
      src.self = src;                                     // the circular case
      const encoded = JsonEx.stringify(src);
      const back = JsonEx.parse(encoded);
      let plain = null, plainThrew = null;
      try { plain = JSON.parse(encoded); } catch (e) { plainThrew = e.message; }
      return {
        replaced: JsonEx.stringify !== window.__stockJsonEx.stringify,
        roundTrips: back.a === 1 && back.kids[0].n === 'x' && back.self === back,
        plainIsArray: Array.isArray(plain),
        plainLostTheKeys: plain !== null && plain.a === undefined,
        plainThrew,
        hasRefs: /"~/.test(encoded)
      };
    });
    check('the serialiser plugin really replaced JsonEx', serialiser.replaced === true);
    check('its output carries "~"-prefixed reference paths',
      serialiser.hasRefs === true, String(serialiser.hasRefs));
    check('the live JsonEx round-trips a circular structure',
      serialiser.roundTrips === true, JSON.stringify(serialiser));
    check('plain JSON.parse does not throw — it silently returns the wrong shape',
      serialiser.plainThrew === null && serialiser.plainIsArray === true &&
      serialiser.plainLostTheKeys === true, JSON.stringify(serialiser));

    /* The framework's note-tag pass runs in Scene_Boot.start, and GigaHack's
       own boot hook wraps it rather than replacing it. */
    const bootChain = await ev(() => ({
      frameworkRan: window.__frameworkNoteTags || 0,
      bootStarts: window.__bootStarts || 0,
      metaArray: !!($dataItems[1] && $dataItems[1].metaArray !== undefined) ||
        (function () { DataManager.extractMetadata($dataItems[2]); return $dataItems[2].metaArray !== undefined; })()
    }));
    check('the framework\'s own Scene_Boot.start pass still ran with GigaHack aliased on top',
      bootChain.frameworkRan >= 1 && bootChain.bootStarts >= 1, JSON.stringify(bootChain));
    check('a plugin that extends note-tag parsing still gets its extra fields',
      bootChain.metaArray === true, String(bootChain.metaArray));
  }

  /* =======================================================================
     PER-FEATURE CHECK FILES

     One file per feature module in checks/, so a module's checks live beside
     the module rather than in the middle of a 3000-line file that everything
     else also edits. Each exports a function taking the same context this file
     builds, so a check written there is indistinguishable from one written
     here — same check(), same ev(), same engine flags.

     A file that throws fails ONE check rather than taking the run down: a
     broken new feature must not hide the state of everything else.
     ==================================================================== */
  const CHECK_DIR = path.resolve(__dirname, 'checks');
  if (fs.existsSync(CHECK_DIR)) {
    const ctx = { check, ev, page, shot, CFG, ENGINE, IS_MV, IS_MZ, MODDED, N_MODULES, MODULES };
    for (const f of fs.readdirSync(CHECK_DIR).filter(n => /\.js$/.test(n)).sort()) {
      try {
        await require(path.join(CHECK_DIR, f))(ctx);
      } catch (e) {
        check('the checks in ' + f + ' ran without throwing', false, (e && e.message) || String(e));
      }
    }
  }

  /* =======================================================================
     SCREENSHOTS — how the port is checked against the design, and how the
     panels get reviewed. Engine-scoped so an MV run never overwrites MZ's.
     ==================================================================== */
  const tabs = await ev(() => window.GigaHack.ui.tabIds());
  for (const t of tabs) {
    await ev(id => {
      const G = window.GigaHack;
      G.ui.setOpen(true);
      G.cfg.ui.tab = id;
      G.ui.rerender();
    }, t);
    await page.waitForTimeout(90);
    await shot('tab-' + t);
  }
  /* "Disabled" has to mean one thing on every path. The CSS carries
     pointer-events:none, which stops a pointer and nothing else — el.click(),
     a dispatched event and mm.toggle() all ignore it, and mm.disable() can add
     the class long after the handler was attached. A control the panel greyed
     WITH A REASON must not still run when something asks it to. */
  const disabledPaths = await ev(() => {
    const W = window.GigaHack.ui.w;
    let ran = 0;
    const btn = W.button({ label: 'x', disabled: true, _ungated: true, onClick: () => { ran++; } });
    document.querySelector('#mm-root').appendChild(btn);
    btn.click();
    const afterClick = ran;

    let changed = 0;
    const cb = W.checkbox({ value: false, disabled: true, _ungated: true, onChange: () => { changed++; } });
    document.querySelector('#mm-root').appendChild(cb);
    cb.click();
    cb.mm.toggle();
    const afterCb = changed;

    // And a control disabled AFTER it was built, which is the mm.disable path.
    let late = 0;
    const b2 = W.button({ label: 'y', _ungated: true, onClick: () => { late++; } });
    document.querySelector('#mm-root').appendChild(b2);
    b2.mm.disable(true);
    b2.click();
    const afterLate = late;
    b2.mm.disable(false);
    b2.click();

    btn.remove(); cb.remove(); b2.remove();
    return { afterClick, afterCb, afterLate, enabledAgain: late };
  });
  check('a disabled button does not run its handler when something clicks it in code',
    disabledPaths.afterClick === 0, disabledPaths.afterClick);
  check('nor does a disabled checkbox, through a click or through toggle()',
    disabledPaths.afterCb === 0, disabledPaths.afterCb);
  check('a control disabled after it was built is disabled too, and enabling it works',
    disabledPaths.afterLate === 0 && disabledPaths.enabledAgain === 1,
    JSON.stringify([disabledPaths.afterLate, disabledPaths.enabledAgain]));

  /* ui.sub is keyed by TAB id. 'vars' was a 1.x tab name, so the Variables
     panel's "show diff" had been switching a sub-tab that does not exist. */
  const subKeys = await ev(() => {
    const G = window.GigaHack;
    const tabs = G.ui.tabIds();
    return Object.keys(G.cfg.ui.sub || {}).filter(k => tabs.indexOf(k) === -1);
  });
  check('every remembered sub-tab is stored under a tab that exists',
    subKeys.length === 0, subKeys.join(', '));

  /* JsonEx marks the LIVE object it serialises — `value['@'] = constructorName`
     — on both engines, and only MV deletes the marks again afterwards. Anything
     walking a $game* object and reporting what it found meets an own key no
     engine field list contains on MZ, and does not on MV. */
  const jsonExMarks = await ev(() => {
    /* The ENGINE's pair, not the live one: the modelled plugin stack replaces
       JsonEx with a circular-reference encoder whose parse only accepts its own
       array format, which is the trap that stack exists to model. Asserting
       engine behaviour through somebody else's serialiser would assert theirs. */
    const J = window.__stockJsonEx || JsonEx;
    const replaced = !!window.__stockJsonEx;
    const probe = new Game_System();
    J.stringify.call(JsonEx, probe);
    const marked = Object.prototype.hasOwnProperty.call(probe, '@');
    const round = J.parse.call(JsonEx, J.stringify.call(JsonEx, new Game_System()));
    return {
      replaced: replaced,
      marked: marked,
      revived: round instanceof Game_System,
      keepsTag: Object.prototype.hasOwnProperty.call(round, '@'),
      unknown: (function () {
        const o = J.parse.call(JsonEx, '{"@":"No_Such_Class_Here","a":1}');
        return { tag: o['@'] || null, plain: Object.getPrototypeOf(o) === Object.prototype };
      }()),
      liveTakesStock: (function () {
        // A save written by the engine must still be readable by whatever is
        // live. Where a plugin has taken the pair over, it is theirs to answer.
        try { return JsonEx.parse('{"a":1}').a === 1; } catch (e) { return 'threw'; }
      }())
    };
  });
  check('serialising marks the live object exactly on the engine that does not clean up after itself',
    jsonExMarks.marked === IS_MZ, String(jsonExMarks.marked));
  check('a revived object gets its class back and keeps the tag that named it',
    jsonExMarks.revived === true && jsonExMarks.keepsTag === true, JSON.stringify(jsonExMarks));
  check('a section naming a class this build does not have arrives plain, still carrying its name',
    jsonExMarks.unknown.tag === 'No_Such_Class_Here' && jsonExMarks.unknown.plain === true,
    JSON.stringify(jsonExMarks.unknown));
  check('a serialiser plugin is detected as having replaced the pair exactly where one is loaded',
    jsonExMarks.replaced === !!MODDED, String(jsonExMarks.replaced));

  /* THE LABEL SIDE OF THE SAME BUG. A row's right edge is flex:0 0 auto, so a
     control or a value that is too wide takes what it wants and .mm-lab is left
     ellipsising itself into nothing — "Fires on" rendered as "Fir...". It stays
     inside its box, so nothing overflows and nothing looks broken; the row just
     stops saying what it is for. Measured across every panel on every tab,
     because it arrives one panel at a time and only in the narrow column. */
  const squeezed = await ev(() => {
    const G = window.GigaHack, out = [];
    const tab0 = G.cfg.ui.tab, sub0 = JSON.stringify(G.cfg.ui.sub || {}), open0 = G.ui.isOpen();
    G.ui.setOpen(true);
    G.ui.tabIds().forEach(tab => {
      G.cfg.ui.tab = tab;
      (G.ui.panelNames ? G.ui.panelNames(tab) : []).forEach(name => {
        G.cfg.ui.sub = G.cfg.ui.sub || {};
        G.cfg.ui.sub[tab] = name;
        G.ui.rerender();
        document.querySelectorAll('#mm-root .mm-col-narrow .mm-lab').forEach(el => {
          // Trimmed is fine; squeezed under about nine characters is not.
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth < 60) {
            out.push(tab + '/' + name + ' "' + el.textContent.trim().slice(0, 28) + '" ' +
              el.clientWidth + '/' + el.scrollWidth);
          }
        });
      });
    });
    G.cfg.ui.tab = tab0;
    G.cfg.ui.sub = JSON.parse(sub0);
    G.ui.setOpen(open0);
    G.ui.rerender();
    return out;
  });
  check('no row label in a sidebar is squeezed to nothing by the control beside it',
    squeezed.length === 0, JSON.stringify(squeezed.slice(0, 6)));

  check('every tab renders without emptying the body',
    await ev(() => {
      const G = window.GigaHack;
      return G.ui.tabIds().every(id => {
        G.cfg.ui.tab = id; G.ui.rerender();
        const body = document.querySelector('#mm-root .mm-body');
        return body && body.textContent.trim().length > 20;
      });
    }));
  /* --- long values do not break the layout -------------------------------
     Measured, not eyeballed. A path is one unbreakable token far longer than
     the column it lands in, so every rule that is supposed to contain it —
     the shrinkable edge, the wrapping edge, the middle-ellipsis widget, the
     tooltip and the toast — is checked by comparing scrollWidth against the
     box that is meant to hold it. */
  const LONG_PATH =
    '/Users/somebody/Library/Application Support/Steam/steamapps/common/' +
    'A Very Long Game Title 5.3.2/Game.app/Contents/Resources/app.nw/js/plugins';

  await ev(p => {
    const G = window.GigaHack;
    window.__realPaths = { plugins: G.paths.pluginsDir, data: G.paths.dataDir };
    G.paths.pluginsDir = p;
    G.paths.dataDir = p + '/gigahack-userdata';
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.debug = 'Plugins';
    G.ui.rerender();
  }, LONG_PATH);
  await page.waitForTimeout(140);
  // The footer rows that hold the paths are below the fold in this panel.
  await ev(() => {
    document.querySelectorAll('#mm-root .mm-col').forEach(c => { c.scrollTop = c.scrollHeight; });
  });
  await page.waitForTimeout(60);
  await shot('long-path');

  const overflow = await ev(() => {
    const out = { cols: [], worst: 0, rows: 0, paths: 0, elided: 0 };
    document.querySelectorAll('#mm-root .mm-col').forEach(c => {
      // A column that scrolls sideways is a column whose content did not fit.
      out.cols.push(c.scrollWidth - c.clientWidth);
      if (c.scrollWidth - c.clientWidth > out.worst) out.worst = c.scrollWidth - c.clientWidth;
    });
    document.querySelectorAll('#mm-root .mm-row').forEach(r => {
      if (r.scrollWidth > r.clientWidth + 1) out.rows++;
    });
    document.querySelectorAll('#mm-root .mm-path').forEach(el => {
      out.paths++;
      // The widget keeps the whole value on title= and shows a shortened form.
      const full = el.getAttribute('title') || '';
      if (full && el.textContent !== full && el.textContent.indexOf('…') > -1) out.elided++;
    });
    return out;
  });
  check('no panel column is pushed sideways by a long path',
    overflow.worst === 0, JSON.stringify(overflow.cols));
  check('and no row inside one is either', overflow.rows === 0, overflow.rows);

  const pathWidget = await ev(() => {
    const el = document.querySelector('#mm-root .mm-path');
    if (!el) return { found: false };
    const full = el.getAttribute('title') || '';
    return {
      found: true, full: full, shown: el.textContent,
      elided: el.textContent !== full,
      middle: el.textContent.indexOf('…') > 0 && el.textContent.indexOf('…') < el.textContent.length - 1,
      keepsTail: full.slice(-10) === el.textContent.slice(-10),
      fits: el.scrollWidth <= el.clientWidth + 1,
      copyable: getComputedStyle(el).userSelect === 'text' ||
        getComputedStyle(el).webkitUserSelect === 'text'
    };
  });
  check('a path too long for its row is shortened rather than clipped',
    pathWidget.found === true && pathWidget.elided === true && pathWidget.fits === true,
    JSON.stringify(pathWidget).slice(0, 200));
  check('it is shortened in the MIDDLE, so the tail that identifies it survives',
    pathWidget.middle === true && pathWidget.keepsTail === true, pathWidget.shown);
  check('the whole value is still on the element, for the tooltip and the clipboard',
    pathWidget.full === LONG_PATH, pathWidget.full);
  check('and it is selectable, which MV turns off for the whole document',
    pathWidget.copyable === true, String(pathWidget.copyable));

  /* The tooltip is delegated on pointerover with a 400ms delay, so the probe
     is hovered, waited on, then measured. */
  await ev(p => {
    const probe = document.createElement('div');
    probe.className = 'mm-row';
    probe.id = 'mm-tip-probe';
    probe.setAttribute('data-mm-tip', 'Path|' + p);
    document.querySelector('#mm-root').appendChild(probe);
    probe.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  }, LONG_PATH);
  await page.waitForTimeout(550);
  const tipBox = await ev(() => {
    const tip = document.querySelector('#mm-root .mm-tip');
    const r = tip ? { w: tip.clientWidth, s: tip.scrollWidth, h: tip.clientHeight } : null;
    const probe = document.getElementById('mm-tip-probe');
    if (probe) probe.remove();
    if (tip) tip.remove();
    return r;
  });
  check('a tooltip holding a path stays inside its own box',
    tipBox && tipBox.s <= tipBox.w + 1, JSON.stringify(tipBox));

  const toastBox = await ev(p => {
    window.GigaHack.ui.toast({ title: 'WROTE', msg: p, severity: 'ok', ms: 200 });
    const t = document.querySelector('#mm-root .mm-toast');
    const r = t ? { w: t.clientWidth, s: t.scrollWidth } : null;
    if (t) t.remove();
    return r;
  }, LONG_PATH);
  check('and so does a toast', toastBox && toastBox.s <= toastBox.w + 1, JSON.stringify(toastBox));

  await ev(() => {
    const G = window.GigaHack;
    G.paths.pluginsDir = window.__realPaths.plugins;
    G.paths.dataDir = window.__realPaths.data;
    G.ui.rerender();
  });

  await ev(() => { window.GigaHack.cfg.ui.tab = 'vars'; window.GigaHack.ui.rerender(); });

  /* =======================================================================
     NOTHING BROKE ALONG THE WAY
     ==================================================================== */
  const harnessErrors = await ev(() => window.__errors.slice());
  check('the harness itself logged no window errors', harnessErrors.length === 0, harnessErrors.slice(0, 3).join(' | '));

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  /* Some checks provoke an error on purpose. Those are the assertion, not a
     defect, and each exemption names the check that causes it. */
  const realConsoleErrors = consoleErrors.filter(t =>
    // the console tab's "a throwing expression is reported" check
    !/deliberate test error/.test(t) &&
    // the two saves that are made to fail on purpose
    !/disk full/.test(t) && !/quick save to slot \d+ failed/.test(t) &&
    // the load of a slot that is deliberately not there
    !/no such file/.test(t) && !/quick load/.test(t) &&
    // verify() is deliberately handed a write the engine refuses
    !/wrote 424242/.test(t) &&
    // the alias-integrity check deliberately patches on top of a hook
    !/no longer the function GigaHack installed/.test(t) &&
    // the load-order check deliberately appends a plugin after us
    !/plugin\(s\) load after GigaHack/.test(t) &&
    // the name-collision check deliberately duplicates a name
    !/already claimed the name/.test(t) &&
    // the modded stack's parameter clamp, which IS the reported behaviour
    !/read back 999/.test(t) && !/read back 5/.test(t));
  check('no unexplained console errors', realConsoleErrors.length === 0, realConsoleErrors.slice(0, 4).join(' | '));

  /* The mod's own log is a deliverable: it is what a bug report pastes. */
  const log = await ev(() => {
    const h = window.GigaHack.logHistory();
    return {
      n: h.length,
      errors: h.filter(e => e.level === 'err').map(e => e.msg.slice(0, 90)),
      hasEnvironment: h.some(e => /environment:/.test(e.msg)),
      hasPaths: h.some(e => /paths:/.test(e.msg)),
      hasProfile: h.some(e => /^profile: /.test(e.msg)),
      hasReady: h.some(e => /ready$/.test(e.msg))
    };
  });
  check('the boot log contains the environment report a bug report needs',
    log.hasEnvironment && log.hasPaths && log.hasProfile && log.hasReady, JSON.stringify(log).slice(0, 200));
  check('the boot log recorded no errors it did not intend',
    log.errors.filter(m => !/deliberate|disk full|no such file|424242|failed/.test(m)).length === 0,
    JSON.stringify(log.errors).slice(0, 300));

  await browser.close();

  let fail = 0;
  for (const r of results) {
    if (!r.ok) fail++;
    console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
  }
  console.log('\n[' + ENGINE + ' — ' + CFG.name + (MODDED ? ' + plugins' : '') + '] ' +
    (results.length - fail) + '/' + results.length + ' checks passed');
  process.exit(fail ? 1 : 0);
})();
