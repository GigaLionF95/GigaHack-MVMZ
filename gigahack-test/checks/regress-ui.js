/* =============================================================================
   GigaHack test harness — checks/regress-ui.js
   Regressions from the review of UI, Screen, Console, Gallery and Media.

   Each block pins one bug that shipped:

     · Escape in an edit cell or a number box COMMITTED what was half-typed.
       The shell stops Escape at window capture and blurs the field, so the
       field's own keydown never ran and the blur wrote the value. Driven with
       real key presses, because a programmatic value change does not fire
       `change` on blur and would pass with the bug still there.
     · A held tint made "apply" and "clear the tint" fail verify and mark
       screen.tone degraded, which then greyed the very controls out.
     · The Log panel's error list stopped repainting at 60 errors, because it
       watched the ring's LENGTH, which stops moving when the ring is full.
     · S.hold swapped an explicit 0 for the live value.
     · A slider whose onChange rebuilt the panel lost its drag on the first
       move: the rebuild removed the track holding the pointer capture.
     · An SE audition saved the BGM position, and leaving the panel rewound
       the game's music to it.
     · A sheet preview passed smooth=true for every folder, which on MV is
       written onto the cached bitmap the game draws its characters from.

   State discipline: every setting, the overlay's tab and open state, the
   undo stack, the error ring and the harness's own window-error list are
   captured first and put back by the block that disturbed them.
   ========================================================================== */
'use strict';

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page;

  await ev(() => {
    const G = window.GigaHack;
    window.__regKeep = {
      open: G.ui.isOpen(),
      tab: G.cfg.ui.tab,
      sub: JSON.parse(JSON.stringify(G.cfg.ui.sub || {})),
      undo: G.undo.size(),
      readonly: !!G.cfg.behaviour.readonly
    };
    G.cfg.behaviour.readonly = false;
    G.ui.setOpen(true);
  });

  /* =======================================================================
     ESCAPE IS A CANCEL
     ==================================================================== */
  await ev(() => {
    const W = window.GigaHack.ui.w;
    const root = document.getElementById('mm-root');
    window.__regEsc = { cell: [], num: [], slider: [] };
    const cell = W.editCell('old', function (v) { window.__regEsc.cell.push(v); });
    cell.id = 'regress-cell';
    const num = W.number({ value: 5, min: 0, max: 99, onChange: function (v) { window.__regEsc.num.push(v); } });
    num.id = 'regress-num';
    const sl = W.slider({
      value: 10, min: 0, max: 100, step: 1, _ungated: true,
      onChange: function (v) { window.__regEsc.slider.push(v); }
    });
    sl.id = 'regress-slider';
    const b = document.createElement('div');
    b.id = 'regress-box';
    b.style.cssText = 'position:absolute;left:10px;top:10px;pointer-events:auto;z-index:999';
    b.appendChild(cell); b.appendChild(num); b.appendChild(sl);
    root.appendChild(b);
    cell.click();                       // becomes an <input>, focused and selected
  });
  await page.keyboard.type('NEW');
  await page.keyboard.press('Escape');

  await ev(() => {
    const inp = document.querySelector('#regress-num input');
    inp.focus(); inp.select();
  });
  await page.keyboard.type('42');
  await page.keyboard.press('Escape');

  await ev(() => {
    const inp = document.querySelector('#regress-slider .mm-numbox');
    inp.focus(); inp.select();
  });
  await page.keyboard.type('77');
  await page.keyboard.press('Escape');

  const esc = await ev(() => {
    const b = document.getElementById('regress-box');
    const cell = document.getElementById('regress-cell');
    const out = {
      cellCommits: window.__regEsc.cell.slice(),
      cellText: cell ? cell.textContent : null,
      cellBack: !!(cell && cell.isConnected),
      num: window.__regEsc.num.slice(),
      numVal: document.getElementById('regress-num').mm.get(),
      slider: window.__regEsc.slider.slice(),
      sliderVal: document.getElementById('regress-slider').mm.get()
    };
    if (b) b.remove();
    delete window.__regEsc;
    return out;
  });
  check('Escape in an edit cell cancels the edit instead of committing what was typed',
    esc.cellCommits.length === 0 && esc.cellText === 'old' && esc.cellBack === true,
    JSON.stringify({ commits: esc.cellCommits, text: esc.cellText }));
  check('Escape in a number box puts the old value back instead of writing the half-typed one',
    esc.num.length === 0 && esc.numVal === 5, JSON.stringify({ calls: esc.num, val: esc.numVal }));
  check('Escape in a slider\'s number box puts the old value back instead of writing the half-typed one',
    esc.slider.length === 0 && esc.sliderVal === 10, JSON.stringify({ calls: esc.slider, val: esc.sliderVal }));

  /* =======================================================================
     A HELD SCREEN VALUE FOLLOWS THE PANEL
     ==================================================================== */
  const held = await ev(() => {
    const G = window.GigaHack, S = G.screen;
    const keys = ['holdTone', 'holdZoom.x', 'holdZoom.y', 'holdZoom.scale',
      'holdWeather.type', 'holdWeather.power', 'hold.tone', 'hold.zoom', 'hold.weather'];
    const keep = {};
    keys.forEach(k => { keep[k] = JSON.stringify(G.store.cfgGet('screen.' + k, null)); });
    const base = G.undo.size();
    const out = {};
    window.__unstickAll();
    G.compat.clearDegraded('screen.tone');
    G.compat.clearDegraded('screen.zoom');
    G.compat.clearDegraded('screen.weather');

    S.hold('tone', true);
    const a = S.setTone([-50, -40, -30, 0], 0);
    window.__raf.flush();
    out.apply = { ok: a.ok, tone: $gameScreen.tone().slice(), held: S.holds().tone.value.slice() };
    const c = S.setTone([0, 0, 0, 0], 0);
    window.__raf.flush();
    out.clear = { ok: c.ok, tone: $gameScreen.tone().slice() };
    out.toneDegraded = G.compat.isDegraded('screen.tone');
    S.hold('tone', false);

    S.hold('zoom', true);
    const z = S.setZoom(100, 80, 2, 0);
    window.__raf.flush();
    out.zoom = { ok: z.ok, scale: $gameScreen._zoomScale, degraded: G.compat.isDegraded('screen.zoom') };
    S.hold('zoom', false);

    S.hold('weather', true);
    const w = S.setWeather('rain', 4, 0);
    window.__raf.flush();
    out.weather = { ok: w.ok, type: $gameScreen._weatherType, degraded: G.compat.isDegraded('screen.weather') };
    S.hold('weather', false);

    /* an explicit 0 is a value */
    S.setZoom(400, 300, 2, 0);
    S.setWeather('rain', 5, 0);
    const hz = S.hold('zoom', true, { x: 0, y: 0, scale: 2 });
    const hw = S.hold('weather', true, { type: 'rain', power: 0 });
    out.zero = { x: hz.x, y: hz.y, scale: hz.scale, power: hw.power };
    S.hold('zoom', false);
    S.hold('weather', false);

    let guard = 0;
    while (G.undo.size() > base && guard++ < 50) G.undo.pop();
    window.__unstickAll();
    G.compat.clearDegraded('screen.tone');
    G.compat.clearDegraded('screen.zoom');
    G.compat.clearDegraded('screen.weather');
    keys.forEach(k => { G.store.cfgSet('screen.' + k, JSON.parse(keep[k])); });
    out.undoLeft = G.undo.size() - base;
    return out;
  });
  check('a held tint lets "apply" succeed, and the hold follows the applied tint instead of snapping back',
    held.apply.ok === true && held.apply.tone.join(',') === '-50,-40,-30,0' &&
    held.apply.held.join(',') === '-50,-40,-30,0',
    JSON.stringify(held.apply));
  check('a held tint lets "clear the tint" succeed, and screen.tone is not marked degraded',
    held.clear.ok === true && held.clear.tone.join(',') === '0,0,0,0' && held.toneDegraded === false,
    JSON.stringify({ clear: held.clear, degraded: held.toneDegraded }));
  check('a held zoom and a held weather let the panel\'s own writes through and follow them',
    held.zoom.ok === true && held.zoom.scale === 2 && held.zoom.degraded === false &&
    held.weather.ok === true && held.weather.type === 'rain' && held.weather.degraded === false,
    JSON.stringify({ zoom: held.zoom, weather: held.weather }));
  check('S.hold keeps an explicit 0 rather than swapping in the live value',
    held.zero.x === 0 && held.zero.y === 0 && held.zero.scale === 2 && held.zero.power === 0,
    JSON.stringify(held.zero));
  check('the hold checks leave no undo entries behind', held.undoLeft === 0, String(held.undoLeft));

  /* =======================================================================
     THE ERROR LIST REPAINTS PAST A FULL RING
     ==================================================================== */
  const errs = await ev(() => {
    const G = window.GigaHack, C = G.console;
    const keepErrors = C.errors();
    const keepHarness = window.__errors.length;
    function fire(msg) {
      window.dispatchEvent(new ErrorEvent('error', { message: msg, filename: 'regress-ui.js', lineno: 1 }));
    }
    C.clearErrors();
    for (let i = 0; i < 60; i++) fire('regress-' + i + ' deliberate test error');
    const out = { full: C.errors().length };
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub.debug = 'Log';
    G.ui.rerender();
    const host = G.ui.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    tick();
    fire('regress-last deliberate test error');
    tick();
    const text = host.root.textContent || '';
    out.stillFull = C.errors().length;
    out.shown = text.indexOf('regress-last deliberate test error') > -1;

    C.clearErrors();
    keepErrors.forEach(e => fire(e.message));
    window.__errors.length = keepHarness;
    out.restored = C.errors().length === keepErrors.length;
    return out;
  });
  check('the uncaught-error list still shows a new error once the 60-entry ring is full',
    errs.full === 60 && errs.stillFull === 60 && errs.shown === true && errs.restored === true,
    JSON.stringify(errs));

  /* =======================================================================
     A SLIDER DRAG SURVIVES ITS OWN onChange
     ==================================================================== */
  async function drag(label, where) {
    const rect = await ev((a) => {
      const G = window.GigaHack;
      if (a.where === 'assets') {
        G.store.cfgSet('media.assets.folder', 'img/characters');
        G.cfg.ui.tab = 'game'; G.cfg.ui.sub.game = 'Assets';
      } else {
        G.cfg.ui.tab = 'world'; G.cfg.ui.sub.world = 'Gallery';
      }
      G.ui.rerender();
      const rows = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-row'));
      const row = rows.filter(r => {
        const lab = r.querySelector('.mm-lab');
        return lab && lab.textContent.trim().indexOf(a.label) === 0 && r.querySelector('.mm-slider-track');
      })[0];
      if (!row) return null;
      const track = row.querySelector('.mm-slider-track');
      track.scrollIntoView({ block: 'center' });
      window.__regTrack = track;
      const b = track.getBoundingClientRect();
      return { x: b.left, y: b.top + b.height / 2, w: b.width };
    }, { label: label, where: where });
    if (!rect || !rect.w) return null;
    await page.mouse.move(rect.x + rect.w * 0.1, rect.y);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.w * 0.5, rect.y, { steps: 3 });
    await page.mouse.move(rect.x + rect.w * 0.95, rect.y, { steps: 3 });
    const mid = await ev(() => !!(window.__regTrack && window.__regTrack.isConnected));
    await page.mouse.up();
    const after = await ev(() => {
      const gone = !(window.__regTrack && window.__regTrack.isConnected);
      delete window.__regTrack;
      return gone;
    });
    return { connectedMidDrag: mid, rebuiltOnRelease: after };
  }

  const keepAssets = await ev(() => {
    const m = (window.GigaHack.cfg.media || {}).assets || {};
    return JSON.stringify({ zoom: m.zoom, folder: m.folder });
  });
  const assets = await drag('Zoom', 'assets');
  const zoomAfter = await ev(() => ((window.GigaHack.cfg.media || {}).assets || {}).zoom);
  await ev((keep) => {
    const G = window.GigaHack, k = JSON.parse(keep);
    const a = (G.cfg.media && G.cfg.media.assets) || {};
    ['zoom', 'folder'].forEach(n => {
      if (k[n] === undefined) delete a[n]; else a[n] = k[n];
    });
    G.store.saveSettings();
  }, keepAssets);
  check('the Assets zoom slider keeps its drag to the end, and the panel rebuilds on release',
    !!assets && assets.connectedMidDrag === true && assets.rebuiltOnRelease === true && zoomAfter === 4,
    JSON.stringify({ assets: assets, zoom: zoomAfter }));

  const hasGallery = await ev(() => {
    const G = window.GigaHack;
    return !!(G.gallery && G.gallery.sections().length &&
      G.ui.tabIds().indexOf('world') > -1);
  });
  if (hasGallery) {
    const gal = await drag('Amount', 'gallery');
    /* put the panel's own amount back to 100 through its own number box */
    const galBack = await ev(() => {
      const G = window.GigaHack;
      G.ui.rerender();
      const rows = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-row'));
      const row = rows.filter(r => {
        const lab = r.querySelector('.mm-lab');
        return lab && lab.textContent.trim().indexOf('Amount') === 0;
      })[0];
      if (!row) return null;
      const box = row.querySelector('.mm-numbox');
      box.value = '100';
      box.dispatchEvent(new Event('change'));
      return row.querySelector('.mm-slider') ? true : false;
    });
    check('the Gallery amount slider keeps its drag to the end, and the panel rebuilds on release',
      !!gal && gal.connectedMidDrag === true && gal.rebuiltOnRelease === true && galBack === true,
      JSON.stringify(gal));
  }

  /* =======================================================================
     MEDIA — an effect audition saves nothing, and a preview keeps the
     folder's own smoothing
     ==================================================================== */
  const media = await ev(() => {
    const G = window.GigaHack, A = G.media.audio, AS = G.media.assets;
    const out = {};
    window.__mountVirtualFs();
    window.__audioReset();
    A.restore();
    AudioManager.playBgm({ name: 'Field1', volume: 90, pitch: 100, pan: 0 }, 0);
    A.play('se', 'Cursor1');
    out.savedAfterSe = A.saved();
    A.play('bgm', 'Title');
    out.savedAfterBgm = !!A.saved();
    A.restore();
    window.__audioReset();
    A.clearRecent();
    A.clearFailures();
    window.__unmountVirtualFs();

    const real = ImageManager.loadBitmap;
    const seen = {};
    ImageManager.loadBitmap = function (folder, name, hue, smooth) {
      seen[folder] = smooth;
      return real.apply(this, arguments);
    };
    try {
      AS.sheet('img/characters', 'Actor1', function () { })();
      AS.sheet('img/pictures', 'Actor1', function () { })();
    } finally {
      ImageManager.loadBitmap = real;
    }
    out.smooth = { characters: seen['img/characters/'], pictures: seen['img/pictures/'] };
    return out;
  });
  check('auditioning a sound effect does not save the music, so leaving the panel cannot rewind it',
    media.savedAfterSe === null && media.savedAfterBgm === true,
    JSON.stringify({ se: media.savedAfterSe, bgm: media.savedAfterBgm }));
  check('a sheet preview passes the folder\'s own smoothing — off for characters, on for pictures',
    media.smooth.characters === false && media.smooth.pictures === true, JSON.stringify(media.smooth));

  /* =======================================================================
     PUT IT BACK
     ==================================================================== */
  const back = await ev(() => {
    const G = window.GigaHack, k = window.__regKeep;
    let guard = 0;
    while (G.undo.size() > k.undo && guard++ < 50) G.undo.pop();
    G.cfg.behaviour.readonly = k.readonly;
    G.cfg.ui.tab = k.tab;
    G.cfg.ui.sub = k.sub;
    G.ui.setOpen(k.open);
    G.ui.rerender();
    const out = { undo: G.undo.size() - k.undo, open: G.ui.isOpen() === k.open, tab: G.cfg.ui.tab === k.tab };
    delete window.__regKeep;
    return out;
  });
  check('the regression checks leave the overlay, the undo stack and the settings as they found them',
    back.undo === 0 && back.open === true && back.tab === true, JSON.stringify(back));
};
