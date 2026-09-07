/* =============================================================================
   GigaHack test harness — checks/keys.js
   GigaHack_Keys: the key map the game itself reads.

   The claim this module makes is that a rebind REACHES THE ENGINE and that it
   can never leave the player with no way out, so the checks here drive the
   engine's own Input rather than asserting on the module's bookkeeping: keys
   are pressed through Input._onKeyDown, pads are polled through
   Input._pollGamepads, and the way-back rule is asked of the engine's own
   Input._isEscapeCompatible before it is asked of the module.

   Two things are simulated rather than mocked, and both are simulated by
   making the write happen where it really happens:

     · A plugin that re-applies its own layout from inside
       ConfigManager.applyData is modelled by making a function the ORIGINAL
       applyData calls write the mapper. A wrapper installed from here would
       sit outside GigaHack's hook and would prove nothing.
     · A mapper that refuses writes is modelled with a Proxy whose set and
       delete traps succeed and change nothing. Object.freeze would THROW under
       the module's "use strict", which is a different failure and one the
       harness would report as an error rather than as a degraded control.

   State discipline: the map, the pad map, the three settings, the stored
   record, the undo stack and the overlay's open state are captured up front
   and put back at the end, and the last block asserts that they were.
   ========================================================================== */
var fs = require('fs');
var path = require('path');

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page, shot = ctx.shot;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ, MODDED = ctx.MODDED;

  /* --- capture everything this file is about to disturb -------------------- */
  await ev(() => {
    const G = window.GigaHack;
    window.__keysKeep = {
      kb: JSON.stringify(G.keys.map()),
      pad: JSON.stringify(G.keys.padMap()),
      persist: G.store.cfgGet('keys.persist', false),
      reassert: G.store.cfgGet('keys.reassert', false),
      watch: G.store.cfgGet('keys.watch', true),
      toggleMenu: G.cfg.hotkeys.toggleMenu,
      open: G.ui.isOpen(),
      tab: G.cfg.ui.tab,
      sub: (G.cfg.ui.sub || {}).settings,
      undo: G.undo.size(),
      hadRecord: G.store.exists('keys.json'),
      mapperObject: Input.keyMapper,
      padObject: Input.gamepadMapper
    };
  });

  const render = async () => {
    await ev(() => {
      const G = window.GigaHack;
      G.ui.setOpen(true);
      G.cfg.ui.tab = 'settings';
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub.settings = 'Game Keys';
      G.ui.rerender();
    });
    await page.waitForTimeout(90);
    return await ev(() => {
      const r = document.querySelector('#mm-root .mm-win') || document.querySelector('#mm-root');
      return r ? r.textContent : '';
    });
  };

  /* The first frame is what takes the second snapshot, so nothing below can
     ask about it until at least one frame has actually run. */
  await ev(() => { for (var i = 0; i < 4; i++) window.__raf.flush(); });

  /* =======================================================================
     1. WHERE IT LIVES
     ==================================================================== */
  const placed = await ev(() => {
    const G = window.GigaHack;
    return { subs: G.ui.panelNames('settings'), marker: typeof G.keys };
  });
  check('the key map panel sits on the Settings tab between Hotkeys and Profiles, which is order 35',
    placed.subs.join(',') === 'Interface,Behaviour,Hotkeys,Game Keys,Profiles',
    placed.subs.join(','));
  check('the module publishes $.keys, so Console and the boot report can ask about the map without a second copy of the escape rule',
    placed.marker === 'object');

  /* =======================================================================
     2. WHAT THE PANEL READS

     The panel must re-read Input.keyMapper at build time. A copy taken at load
     would show the right thing on a stock game forever and the wrong thing on
     every game that rebinds anything.
     ==================================================================== */
  await ev(() => { window.GigaHack.store.cfgSet('keys.watch', false); });

  await ev(() => { Input.keyMapper[74] = 'pageup'; });   // a "plugin" writing directly
  const liveRead = await render();
  await ev(() => { delete Input.keyMapper[74]; });
  const afterRemoval = await render();
  check('the map the panel shows is read from Input.keyMapper at build time, not from a copy taken earlier',
    /J74/.test(liveRead) && !/J74/.test(afterRemoval),
    'with=' + /J74/.test(liveRead) + ' without=' + /J74/.test(afterRemoval));

  const actions = await ev(() => {
    const G = window.GigaHack;
    const union = {};
    const take = m => Object.keys(m || {}).forEach(k => { if (m[k]) union[m[k]] = true; });
    take(Input.keyMapper);
    take(Input.gamepadMapper);
    take(G.keys.shipped().keyMapper);
    take(G.keys.shipped().gamepadMapper);
    return { offered: G.keys.actions(), expected: Object.keys(union).sort() };
  });
  check('the action list offered is the set of names the live maps and the snapshots actually use, and nothing else',
    actions.offered.join(',') === actions.expected.join(',') && actions.offered.length > 0,
    actions.offered.join(','));
  check('and it is discovered, not written down — it carries the pad-only names the keyboard table never produces',
    actions.offered.indexOf('cancel') > -1 && actions.offered.indexOf('menu') > -1 &&
    actions.offered.indexOf('quicksave') < 0,
    actions.offered.join(','));

  /* =======================================================================
     3. THE WAY BACK

     The engine answers isPressed('cancel') for a press of 'escape'. The stock
     keyboard table binds 'escape' four times and 'cancel' never, so a guard
     that looked for the literal name would call every stock game broken.
     ==================================================================== */
  const escape = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    out.engineSaysCancel = Input._isEscapeCompatible('cancel');
    out.engineSaysMenu = Input._isEscapeCompatible('menu');
    out.engineSaysOk = Input._isEscapeCompatible('ok');
    out.moduleAgrees = G.keys.isEscapeCompatible('cancel') === out.engineSaysCancel &&
      G.keys.isEscapeCompatible('ok') === out.engineSaysOk;
    out.usesEngineRule = G.keys.escapeRuleIsEngine();

    const live = G.keys.map();
    out.cancelBoundDirectly = Object.keys(live).some(k => live[k] === 'cancel');
    out.cancelReachable = G.keys.reachable('cancel', live);
    out.wayBack = G.keys.wayBack();

    /* And the engine really does behave that way: press a key bound to
       'escape' and ask it for 'cancel'. */
    Input.clear();
    window.__pressKey(27);
    out.enginePressed = Input.isPressed('cancel') && Input.isTriggered('cancel');
    window.__releaseKey(27);
    Input.clear();

    /* With every escape key gone and nothing bound to cancel, it is not. */
    const stripped = {};
    Object.keys(live).forEach(k => { if (live[k] !== 'escape') stripped[k] = live[k]; });
    out.strippedReachable = G.keys.reachable('cancel', stripped);
    return out;
  });
  check('escape counts as a way back for cancel and menu, because the engine\'s own _isEscapeCompatible says it does',
    escape.engineSaysCancel === true && escape.engineSaysMenu === true &&
    escape.engineSaysOk === false && escape.moduleAgrees && escape.usesEngineRule,
    JSON.stringify(escape).slice(0, 160));
  check('so cancel is reachable on a map that never mentions it, and the engine agrees when the key is actually pressed',
    escape.cancelBoundDirectly === false && escape.cancelReachable === true &&
    escape.enginePressed === true, JSON.stringify(escape).slice(0, 200));
  check('and it stops being reachable once nothing is bound to escape',
    escape.strippedReachable === false);
  check('the way back is ok plus the escape-compatible actions, taken from the maps rather than written down',
    escape.wayBack.join(',') === 'ok,cancel,menu', escape.wayBack.join(','));

  /* --- a rebind that would strand something -------------------------------- */
  const strand = await ev(() => {
    const G = window.GigaHack;
    const before = JSON.stringify(G.keys.map());
    const steps = [];
    /* 13, 32 and 90 are the three keys the stock table binds to 'ok'. Taking
       the first two away is fine; the third is the last way to confirm. */
    steps.push(G.keys.set(13, null));
    steps.push(G.keys.set(32, null));
    const last = G.keys.set(90, null);
    const stillThere = G.keys.map()['90'];
    G.keys.restoreShipped('keyMapper');
    return {
      firstTwo: steps.every(s => s.ok),
      refused: last.ok === false,
      message: last.message,
      stranded: last.stranded || [],
      stillThere: stillThere,
      restored: JSON.stringify(G.keys.map()) === before
    };
  });
  check('a rebind that would leave no way back is refused, and says which action it would have stranded',
    strand.firstTwo && strand.refused && strand.stranded.join(',') === 'ok' &&
    /"ok"/.test(strand.message) && strand.stillThere === 'ok',
    strand.message);
  check('a refused rebind changes nothing — the key it would have unbound is still bound',
    strand.restored === true);

  /* --- the escape keys, both ways ------------------------------------------ */
  const escKeys = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    [27, 45, 88].forEach(k => G.keys.set(k, null));
    const last = G.keys.set(96, null);
    out.refused = last.ok === false;
    out.stranded = (last.stranded || []).join(',');
    out.message = last.message;

    /* Now give cancel and menu keys of their own and try the same edit. */
    G.keys.set(27, 'cancel');
    G.keys.set(45, 'menu');
    const allowed = G.keys.set(96, null);
    out.allowed = allowed.ok === true;
    out.escapeGone = Object.keys(G.keys.map()).every(k => G.keys.map()[k] !== 'escape');
    G.keys.restoreShipped('keyMapper');
    out.back = JSON.stringify(G.keys.map()) === JSON.stringify(G.keys.shipped().keyMapper);
    return out;
  });
  check('clearing every escape key is refused while cancel and menu are reached only through it',
    escKeys.refused && escKeys.stranded === 'cancel,menu', escKeys.message);
  check('and allowed once cancel and menu are each bound to a key of their own',
    escKeys.allowed && escKeys.escapeGone && escKeys.back,
    JSON.stringify({ allowed: escKeys.allowed, escapeGone: escKeys.escapeGone, back: escKeys.back }));

  /* --- emptying a map ------------------------------------------------------ */
  const empty = await ev(() => {
    const G = window.GigaHack;
    const wasKb = Object.keys(G.keys.map()).length;
    const wasPad = Object.keys(G.keys.padMap()).length;
    const kb = G.keys.check({}, 'keyMapper');
    const pad = G.keys.check({}, 'gamepadMapper');
    const kbReal = G.keys.apply({}, 'keyMapper');
    const kbSize = Object.keys(G.keys.map()).length;
    const padReal = G.keys.apply({}, 'gamepadMapper');
    const padSize = Object.keys(G.keys.padMap()).length;
    G.keys.restoreShipped('gamepadMapper');
    return {
      kbRefused: kb.ok === false, kbWhy: kb.message,
      padAllowed: pad.ok === true, padWhy: pad.message,
      kbRealRefused: kbReal.ok === false, kbSize: kbSize, wasKb: wasKb,
      padRealApplied: padReal.ok === true, padSize: padSize, wasPad: wasPad,
      padBack: Object.keys(G.keys.padMap()).length
    };
  });
  check('emptying the keyboard map is refused, and the map is left as it was',
    empty.kbRefused && empty.kbRealRefused && empty.wasKb > 0 && empty.kbSize === empty.wasKb,
    empty.kbWhy + ' [' + empty.kbSize + '/' + empty.wasKb + ' keys]');
  check('emptying the gamepad map is allowed, and is described as turning the controller off',
    empty.padAllowed && empty.padRealApplied && empty.padSize === 0 &&
    /turns the controller off/.test(empty.padWhy) && empty.padBack === empty.wasPad &&
    empty.wasPad === 10,
    empty.padWhy);

  /* =======================================================================
     4. THE PRECONDITION, AND THE ONE CONTROL IT DOES NOT GATE
     ==================================================================== */
  const noMenuKey = await ev(() => {
    const G = window.GigaHack;
    const keep = G.cfg.hotkeys.toggleMenu;
    G.cfg.hotkeys.toggleMenu = '';
    const write = G.keys.set(74, 'pageup');
    const state = G.keys.writable('keyMapper');
    /* Restore is the way back, so it is gated by read-only mode and by
       nothing else — including this. */
    G.keys.set(70, null);
    const restore = G.keys.restoreShipped('keyMapper');
    G.cfg.hotkeys.toggleMenu = keep;
    return {
      refused: write.ok === false, message: write.message, reason: state.reason,
      bound74: G.keys.map()['74'],
      restoreOk: restore.ok === true,
      back: JSON.stringify(G.keys.map()) === JSON.stringify(G.keys.shipped().keyMapper)
    };
  });
  check('a write is refused while GigaHack\'s own menu key is unbound, and names Settings → Hotkeys as the fix',
    noMenuKey.refused && noMenuKey.reason === 'menukey' &&
    /Settings → Hotkeys/.test(noMenuKey.message) && noMenuKey.bound74 === undefined,
    noMenuKey.message);
  check('but restore is not gated by it — the way back cannot have a precondition',
    noMenuKey.restoreOk && noMenuKey.back);

  /* =======================================================================
     5. RESTORE

     What it puts back is the object read at plugin load, key for key, with
     nothing added and nothing left behind.
     ==================================================================== */
  const restored = await ev(() => {
    const G = window.GigaHack;
    G.keys.set(74, 'pageup');
    G.keys.set(75, 'pagedown');
    G.keys.set(90, null);
    const dirty = JSON.stringify(G.keys.map());
    const r = G.keys.restoreShipped('both');
    const now = G.keys.map();
    const ship = G.keys.shipped().keyMapper;
    const keys = Object.keys(now).sort();
    const shipKeys = Object.keys(ship).sort();
    return {
      ok: r.ok,
      dirtyDiffered: dirty !== JSON.stringify(ship),
      sameKeys: keys.join(',') === shipKeys.join(','),
      sameValues: keys.every(k => now[k] === ship[k]),
      extras: keys.filter(k => ship[k] === undefined),
      padBack: JSON.stringify(G.keys.padMap()) === JSON.stringify(G.keys.shipped().gamepadMapper),
      shippedAt: G.keys.shipped().at
    };
  });
  check('restoring puts back exactly the object read at plugin load, key for key, and nothing else',
    restored.ok && restored.dirtyDiffered && restored.sameKeys && restored.sameValues &&
    restored.extras.length === 0 && restored.padBack && restored.shippedAt === 'load',
    JSON.stringify(restored));

  const twoSnapshots = await ev(() => {
    const G = window.GigaHack;
    const s = G.keys.shipped();
    return {
      at: s.at,
      hasFirstFrame: !!s.firstFrame,
      loadKeys: Object.keys(s.keyMapper || {}).length,
      firstFrameKeys: s.firstFrame ? Object.keys(s.firstFrame.keyMapper || {}).length : -1,
      drifted: s.drifted
    };
  });
  check('there are two snapshots — one at plugin load and one at the first frame — and the panel is told whether they differ',
    twoSnapshots.at === 'load' && twoSnapshots.hasFirstFrame &&
    twoSnapshots.loadKeys > 0 &&
    twoSnapshots.firstFrameKeys === twoSnapshots.loadKeys && twoSnapshots.drifted === false,
    JSON.stringify(twoSnapshots));

  /* =======================================================================
     6. EVERY WRITE IS VERIFIED

     $.compat.verify is wrapped from here so the control keys it is called
     with are observable. The wrapper is put back immediately.
     ==================================================================== */
  const verified = await ev(() => {
    const G = window.GigaHack;
    const seen = [];
    const real = G.compat.verify;
    G.compat.verify = function (control) { seen.push(control); return real.apply(this, arguments); };
    G.keys.set(74, 'pageup');
    G.keys.setPad(6, 'pagedown');
    G.keys.apply(G.keys.shipped().keyMapper, 'keyMapper');
    G.compat.verify = real;
    G.keys.restoreShipped('both');
    return { seen: seen };
  });
  check('every keyMapper write goes through $.compat.verify under the control key keys.map, and every gamepadMapper write under keys.pad',
    verified.seen.length === 3 &&
    verified.seen[0] === 'keys.map' && verified.seen[1] === 'keys.pad' &&
    verified.seen[2] === 'keys.map',
    verified.seen.join(','));

  /* --- a mapper that refuses writes ---------------------------------------- */
  const degradedRun = await ev(() => {
    const G = window.GigaHack;
    const real = Input.keyMapper;
    /* A hostile plugin that keeps the table but drops every write. Traps that
       report success are the honest model: Object.freeze would throw under the
       module's "use strict", which is a different failure. */
    const inert = new Proxy(Object.assign({}, real), {
      set: function () { return true; },
      deleteProperty: function () { return true; }
    });
    Input.keyMapper = inert;
    const res = G.keys.set(74, 'pageup');
    const marked = G.compat.isDegraded('keys.map');
    const why = G.compat.degradedWhy('keys.map');
    const state = G.keys.writable('keyMapper');
    Input.keyMapper = real;
    return {
      reported: res.ok === false, message: res.message,
      marked: marked, why: why, reason: state.reason,
      wroteNothing: real['74'] === undefined
    };
  });
  check('a mapper that refuses writes is reported as refused, not as success, and the control is marked degraded',
    degradedRun.reported && degradedRun.marked && degradedRun.wroteNothing &&
    degradedRun.reason === 'degraded' && degradedRun.why.length > 20,
    degradedRun.message.slice(0, 120));

  const degradedPanel = await render();
  const degradedDom = await ev(() => {
    const root = document.querySelector('#mm-root');
    const btns = Array.prototype.slice.call(root.querySelectorAll('.mm-btn'));
    const restore = btns.filter(b => /restore what the game shipped with/.test(b.textContent))[0];
    return {
      restoreFound: !!restore,
      restoreEnabled: !!restore && !restore.classList.contains('mm-dis'),
      disabledDropdowns: root.querySelectorAll('.mm-dd.mm-dd-dis').length
    };
  });
  check('a degraded control greys the table and shows degradedWhy instead of reporting success',
    /writes here are not sticking/.test(degradedPanel) && degradedDom.disabledDropdowns > 20,
    'dropdowns disabled: ' + degradedDom.disabledDropdowns);
  check('restore what the game shipped with is still offered while the control is degraded',
    degradedDom.restoreFound && degradedDom.restoreEnabled);

  await ev(() => {
    window.GigaHack.compat.clearDegraded('keys.map');
    window.GigaHack.keys.restoreShipped('both');
  });

  /* =======================================================================
     7. THE EDIT REACHES THE ENGINE

     Not "the module's copy says so" — a real key down, through the engine's
     own _onKeyDown and update().
     ==================================================================== */
  const reaches = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    Input.clear();
    window.__pressKey(74);                       // 'J', unbound on a stock table
    out.beforeTriggered = Input.isTriggered('pageup');
    out.beforeLatest = Input._latestButton;
    window.__releaseKey(74);

    G.keys.set(74, 'pageup');
    Input.clear();
    window.__pressKey(74);
    out.afterTriggered = Input.isTriggered('pageup');
    out.afterPressed = Input.isPressed('pageup');
    out.afterLatest = Input._latestButton;
    window.__releaseKey(74);
    out.releasedPressed = Input.isPressed('pageup');

    G.keys.restoreShipped('keyMapper');
    Input.clear();
    return out;
  });
  check('a key number edited to an action reaches the engine: a keydown with that number makes Input.isTriggered answer for that action',
    reaches.beforeTriggered === false && reaches.beforeLatest === null &&
    reaches.afterTriggered === true && reaches.afterPressed === true &&
    reaches.afterLatest === 'pageup' && reaches.releasedPressed === false,
    JSON.stringify(reaches));

  const padReaches = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    /* Index 6 is a trigger the stock table leaves unbound on both engines. */
    Input.clear();
    window.__attachGamepad([false, false, false, false, false, false, true]);
    Input.update();
    out.before = Input._currentState['pagedown'];
    window.__detachGamepad();

    G.keys.setPad(6, 'pagedown');
    Input.clear();
    window.__attachGamepad([false, false, false, false, false, false, true]);
    Input.update();
    out.after = Input._currentState['pagedown'];
    out.enginePressed = Input.isPressed('pagedown');
    window.__detachGamepad();

    G.keys.restoreShipped('gamepadMapper');
    Input.clear();
    return out;
  });
  check('a gamepad button edited to an action reaches the engine: a poll with that button pressed sets the action in _currentState',
    !padReaches.before && padReaches.after === true && padReaches.enginePressed === true,
    JSON.stringify(padReaches));

  /* --- in place, never replaced -------------------------------------------- */
  const inPlace = await ev(() => {
    const G = window.GigaHack;
    /* Exactly what a plugin that did `var km = Input.keyMapper` at load has. */
    const held = Input.keyMapper;
    const heldPad = Input.gamepadMapper;
    G.keys.set(74, 'pageup');
    G.keys.setPad(6, 'pagedown');
    const sawBind = held['74'] === 'pageup' && heldPad['6'] === 'pagedown';
    G.keys.restoreShipped('both');
    const sawRestore = held['74'] === undefined && heldPad['6'] === undefined;
    return {
      sameKb: held === Input.keyMapper,
      samePad: heldPad === Input.gamepadMapper,
      sawBind: sawBind, sawRestore: sawRestore
    };
  });
  check('the maps are mutated in place, so a plugin holding a reference taken at load sees every change in both directions',
    inPlace.sameKb && inPlace.samePad && inPlace.sawBind && inPlace.sawRestore,
    JSON.stringify(inPlace));

  /* --- the stuck key ------------------------------------------------------- */
  const cleared = await ev(() => {
    const G = window.GigaHack;
    const before = window.__inputCleared || 0;
    Input.clear();
    window.__pressKey(38);                        // an arrow, bound to 'up'
    const latched = Input.isPressed('up');
    const clearsBeforeSet = window.__inputCleared;
    G.keys.set(38, 'pageup');                     // rebind the key that is down
    const stillLatched = Input.isPressed('up');
    const clearsAfterSet = window.__inputCleared;
    window.__releaseKey(38);                      // the release clears the NEW action
    const afterRelease = Input.isPressed('up');
    G.keys.restoreShipped('keyMapper');
    Input.clear();
    return {
      latched: latched, stillLatched: stillLatched, afterRelease: afterRelease,
      clearsForOneSet: clearsAfterSet - clearsBeforeSet, total: clearsAfterSet - before
    };
  });
  check('Input.clear runs exactly once per applied change, so a key held across the change is not left latched under the action it used to have',
    cleared.latched === true && cleared.stillLatched === false &&
    cleared.afterRelease === false && cleared.clearsForOneSet === 1,
    JSON.stringify(cleared));

  /* --- undo ---------------------------------------------------------------- */
  const undone = await ev(() => {
    const G = window.GigaHack;
    const before = JSON.stringify(G.keys.map());
    const size = G.undo.size();
    G.keys.set(74, 'pageup');
    G.keys.set(90, null);
    const afterTwo = G.undo.size() - size;
    G.undo.pop();
    const oneBack = G.keys.map()['90'] === 'ok' && G.keys.map()['74'] === 'pageup';
    G.undo.pop();
    return {
      pushed: afterTwo, oneBack: oneBack,
      exact: JSON.stringify(G.keys.map()) === before,
      size: G.undo.size() - size
    };
  });
  check('an undo entry is pushed for every applied change and reverts to the exact previous map',
    undone.pushed === 2 && undone.oneBack && undone.exact && undone.size === 0,
    JSON.stringify(undone));

  const noop = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    const size = G.undo.size();
    const clears = window.__inputCleared;
    const logs = G.logHistory().length;
    /* The map already says this. Asking for it again is not a write, and must
       not cost a keypress or push the player's real change off the stack. */
    const current = G.keys.map()['13'];
    const same = G.keys.set(13, current);
    const restoreTwice = G.keys.restoreShipped('both');
    out.sameOk = same.ok === true && same.changed === false;
    out.restoreOk = restoreTwice.ok === true && restoreTwice.changed === false;
    out.undo = G.undo.size() - size;
    out.clears = window.__inputCleared - clears;
    out.logs = G.logHistory().length - logs;
    return out;
  });
  check('asking for the map that is already there is not a write — no undo entry, no Input.clear, no log line',
    noop.sameOk && noop.restoreOk && noop.undo === 0 && noop.clears === 0 && noop.logs === 0,
    JSON.stringify(noop));

  const bothAsOne = await ev(() => {
    const G = window.GigaHack;
    const size = G.undo.size();
    G.keys.set(74, 'pageup');
    G.keys.setPad(6, 'pagedown');
    const before = { kb: JSON.stringify(G.keys.map()), pad: JSON.stringify(G.keys.padMap()) };
    const r = G.keys.restoreShipped('both');
    const entries = G.undo.size() - size - 2;      // minus the two edits above
    G.undo.pop();                                  // one undo should put BOTH back
    const back = {
      kb: JSON.stringify(G.keys.map()) === before.kb,
      pad: JSON.stringify(G.keys.padMap()) === before.pad
    };
    G.undo.pop(); G.undo.pop();
    G.keys.restoreShipped('both');
    return { changed: r.changed, entries: entries, back: back, size: G.undo.size() - size };
  });
  check('restoring both maps is one undoable step, so undoing it never leaves the keyboard back and the pad restored',
    bothAsOne.changed === true && bothAsOne.entries === 1 &&
    bothAsOne.back.kb && bothAsOne.back.pad && bothAsOne.size === 0,
    JSON.stringify(bothAsOne));

  /* =======================================================================
     8. WHAT IS KEPT, AND FOR WHICH GAME
     ==================================================================== */
  const sessionOnly = await render();
  check('the panel says the change is for this session unless keeping it for this game is on',
    /no — this session only/.test(sessionOnly));

  const kept = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    out.beforeExists = G.store.exists('keys.json');
    G.keys.set(74, 'pageup');
    out.afterEditExists = G.store.exists('keys.json');

    G.keys.persist(true);
    const rec = G.keys.stored();
    out.written = !!rec;
    out.gameKey = rec && rec.gameKey;
    out.expectKey = G.paths.gameKey;
    out.game = rec && rec.game;
    out.expectGame = G.profile.active().name;
    out.carries74 = !!(rec && rec.keyMapper && rec.keyMapper['74'] === 'pageup');

    G.keys.set(75, 'pagedown');
    const rec2 = G.keys.stored();
    out.followsEdits = !!(rec2 && rec2.keyMapper && rec2.keyMapper['75'] === 'pagedown');

    G.keys.persist(false);
    out.gone = !G.store.exists('keys.json');
    G.keys.restoreShipped('keyMapper');
    return out;
  });
  check('a map is only written to keys.json when keeping it is on',
    kept.beforeExists === false && kept.afterEditExists === false && kept.written === true &&
    kept.gone === true, JSON.stringify(kept).slice(0, 160));
  check('and the record carries the game it was written for, so a shared storage backend cannot hand it to another game',
    kept.gameKey === kept.expectKey && kept.game === kept.expectGame && kept.carries74 &&
    kept.followsEdits,
    kept.gameKey + ' / ' + kept.game);

  const foreign = await ev(() => {
    const G = window.GigaHack;
    const before = JSON.stringify(G.keys.map());
    G.store.write('keys.json', {
      version: 1, gameKey: 'some-other-folder', profile: 'not-this-one',
      game: 'A Different Project', at: Date.now(),
      keyMapper: { 74: 'ok' }, gamepadMapper: null
    }, true);
    const r = G.keys.applyStored();
    const state = G.keys.storedState();
    return {
      applied: r.applied, why: r.why, forGame: r.forGame, mine: state.mine,
      unchanged: JSON.stringify(G.keys.map()) === before
    };
  });
  const foreignPanel = await render();
  await ev(() => { window.GigaHack.store.remove('keys.json'); });
  check('a saved map whose recorded game is not this one is not applied, and the map is untouched',
    foreign.applied === false && foreign.mine === false && foreign.unchanged === true &&
    /A Different Project/.test(foreign.why), foreign.why.slice(0, 140));
  check('and the panel says which game it was for rather than showing it as this game\'s saved map',
    /written for "A Different Project"/.test(foreignPanel) &&
    !/yes, written/.test(foreignPanel));

  /* =======================================================================
     9. SOMETHING ELSE REWROTE IT
     ==================================================================== */
  const drift = await ev(() => {
    const G = window.GigaHack;
    G.keys.set(74, 'pageup');            // give GigaHack a baseline of its own
    Input.keyMapper[74] = 'escape';      // and let something else change it
    Input.keyMapper[75] = 'shift';
    const d = G.keys.drift();
    return {
      changed: d.changed, count: d.count, since: d.since, cause: d.cause,
      codes: d.diff.map(x => x.keyCode).join(','),
      firstWas: d.diff[0] && d.diff[0].was,
      firstNow: d.diff[0] && d.diff[0].now,
      label: d.diff[0] && d.diff[0].label,
      watching: G.store.cfgGet('keys.watch', true)
    };
  });
  const driftPanel = await render();
  check('a rewrite of the mapper by anything else is noticed, and says which key numbers differ from what GigaHack set',
    drift.changed && drift.count === 2 && drift.codes === '74,75' && drift.since === 'set' &&
    drift.firstWas === 'pageup' && drift.firstNow === 'escape' && drift.label === 'J',
    JSON.stringify(drift));
  check('drift found at panel build is reported even when the frame watch is off',
    drift.watching === false && /CHANGED — 2 key\(s\) differ/.test(driftPanel) &&
    /J \(74\)  pageup → escape/.test(driftPanel) &&
    /no GigaHack hook saw it happen/.test(driftPanel));

  const accepted = await ev(() => {
    const G = window.GigaHack;
    const live = JSON.stringify(G.keys.map());
    G.keys.accept('keyMapper');
    const d = G.keys.drift();
    return { changed: d.changed, unchanged: JSON.stringify(G.keys.map()) === live };
  });
  check('keeping the game\'s version takes the live map as the baseline and changes nothing in the game',
    accepted.changed === false && accepted.unchanged === true);

  await ev(() => { window.GigaHack.keys.restoreShipped('both'); });

  /* --- attribution --------------------------------------------------------- */
  const attributed = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    G.store.cfgSet('keys.reassert', false);
    G.keys.set(74, 'pageup');

    /* A plugin that re-applies its own layout from inside applyData. The write
       is made by a function the ORIGINAL applyData calls, so it happens
       BENEATH GigaHack's hook — which is where it happens on a real game, and
       the only arrangement that proves the hook sees the result. */
    const realFlag = ConfigManager.readFlag;
    ConfigManager.readFlag = function () {
      Input.keyMapper[74] = 'escape';
      return realFlag.apply(this, arguments);
    };
    ConfigManager.applyData(window.__savedConfig);
    ConfigManager.readFlag = realFlag;

    out.configCause = G.keys.drift().cause;
    out.leftAlone = G.keys.map()['74'];
    out.reasserts = G.keys.reasserts();

    /* And the other shape: a rebinding UI that writes the mapper while its own
       options scene is up. terminate() is the first moment afterwards. */
    G.keys.set(74, 'pageup');
    const realSave = ConfigManager.save;
    ConfigManager.save = function () {
      Input.keyMapper[74] = 'shift';
      return realSave.apply(this, arguments);
    };
    window.__leaveOptions();
    ConfigManager.save = realSave;

    out.optionsCause = G.keys.drift().cause;
    out.optionsLeftAlone = G.keys.map()['74'];
    return out;
  });
  check('the ConfigManager.applyData hook attributes a rewrite to the game applying its own configuration',
    attributed.configCause === 'the game applied its own configuration', attributed.configCause);
  check('the Scene_Options hook attributes a rewrite to the game\'s own options screen',
    attributed.optionsCause === 'the game\'s own options screen was closed', attributed.optionsCause);
  check('with re-apply off, a rewrite is left alone and only reported',
    attributed.leftAlone === 'escape' && attributed.optionsLeftAlone === 'shift' &&
    attributed.reasserts === 0,
    JSON.stringify(attributed));

  const reasserted = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    G.keys.restoreShipped('keyMapper');
    G.store.cfgSet('keys.reassert', true);
    G.keys.set(74, 'pageup');
    const logsBefore = G.logHistory().filter(e => /re-applied after/.test(e.msg)).length;
    const countBefore = G.keys.reasserts();

    const realFlag = ConfigManager.readFlag;
    ConfigManager.readFlag = function () {
      Input.keyMapper[74] = 'escape';
      return realFlag.apply(this, arguments);
    };
    const seen = [];
    for (var i = 0; i < 3; i++) {
      ConfigManager.applyData(window.__savedConfig);
      seen.push(G.keys.map()['74']);
    }
    ConfigManager.readFlag = realFlag;

    out.putBack = seen.join(',');
    out.reasserts = G.keys.reasserts() - countBefore;
    out.logs = G.logHistory().filter(e => /re-applied after/.test(e.msg)).length - logsBefore;
    out.undoClean = G.undo.size();
    G.store.cfgSet('keys.reassert', false);
    G.keys.restoreShipped('keyMapper');
    return out;
  });
  check('with re-apply on, a rewrite during ConfigManager.applyData is put back every time it happens',
    reasserted.putBack === 'pageup,pageup,pageup' && reasserted.reasserts === 3,
    JSON.stringify(reasserted));
  check('and it is logged once per signature, not once per call, because a config load can run applyData repeatedly',
    reasserted.logs === 1, 'log lines: ' + reasserted.logs);

  /* --- what the hooks say when they are not there -------------------------- */
  const hookState = await ev(() => {
    const G = window.GigaHack;
    const s = G.keys.hookState();
    return {
      configInstalled: s.config.installed, optionsInstalled: s.options.installed,
      configName: s.config.name, optionsName: s.options.name,
      configWhy: s.config.why, optionsWhy: s.options.why,
      registryHasBoth: !!G.hooks[s.config.name] && !!G.hooks[s.options.name],
      removable: typeof G.hooks[s.config.name].unpatch === 'function'
    };
  });
  check('both hooks install on this engine and are listed in the registry Debug → Hooks reads',
    hookState.configInstalled && hookState.optionsInstalled &&
    hookState.registryHasBoth && hookState.removable,
    hookState.configName + ' / ' + hookState.optionsName);
  check('and each carries the sentence for the build that lacks it, naming the symbol and what still works without it',
    /ConfigManager\.applyData is not a function/.test(hookState.configWhy) &&
    /drift watch still notices/.test(hookState.configWhy) &&
    /Scene_Options\.prototype\.terminate is not a function/.test(hookState.optionsWhy) &&
    /noticed by the drift watch/.test(hookState.optionsWhy));

  const hooksAbsent = await ev(() => {
    const G = window.GigaHack;
    /* The panel reads the registry, so the registry is what is driven here —
       unpatching for real would leave the hooks off for every later check. */
    const s = G.keys.hookState();
    const a = G.hooks[s.config.name], b = G.hooks[s.options.name];
    a.installed = false; b.installed = false;
    G.cfg.ui.tab = 'settings';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.settings = 'Game Keys';
    G.ui.setOpen(true);
    G.ui.rerender();
    const root = document.querySelector('#mm-root .mm-win');
    const text = root ? root.textContent : '';
    const rows = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-cbrow'));
    const row = rows.filter(r => /Re-apply it after the game rewrites it/.test(r.textContent))[0];
    const disabled = !!row && !!row.querySelector('.mm-check.mm-dis');
    a.installed = true; b.installed = true;
    return { text: text, disabled: disabled };
  });
  check('with both hooks reported absent, the panel prints their reasons instead of offering the re-apply toggle',
    hooksAbsent.disabled === true &&
    /ConfigManager\.applyData is not a function/.test(hooksAbsent.text) &&
    /a rewrite can be noticed but not undone on this build/i.test(hooksAbsent.text),
    'toggle disabled: ' + hooksAbsent.disabled);

  /* =======================================================================
     10. THE WATCH
     ==================================================================== */
  const watch = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    G.keys.accept('keyMapper');
    G.store.cfgSet('keys.watch', false);
    const off = G.keys.watchPolls();
    for (var i = 0; i < 90; i++) window.__raf.flush();
    out.whileOff = G.keys.watchPolls() - off;

    G.store.cfgSet('keys.watch', true);
    const on = G.keys.watchPolls();
    const frame0 = G.frameCount;
    for (var j = 0; j < 90; j++) window.__raf.flush();
    out.whileOn = G.keys.watchPolls() - on;
    out.frames = G.frameCount - frame0;
    return out;
  });
  check('the drift watch does no work at all while watching is off',
    watch.whileOff === 0, 'polls: ' + watch.whileOff);
  check('and no more than once every thirty frames while it is on',
    watch.whileOn > 0 && watch.whileOn <= Math.ceil(watch.frames / 30),
    watch.whileOn + ' polls over ' + watch.frames + ' frames');

  const noRerender = await ev(() => {
    const G = window.GigaHack;
    const U = G.ui;
    const real = U.rerender;
    let repaints = 0;
    let drifts = 0;
    const sub = G.on('keys:drift', () => { drifts++; });
    U.rerender = function () { repaints++; return real.apply(this, arguments); };
    Input.keyMapper[74] = 'escape';               // something else rewrites it
    for (var i = 0; i < 90; i++) window.__raf.flush();
    U.rerender = real;
    G.off('keys:drift', sub);
    delete Input.keyMapper[74];
    G.keys.accept('keyMapper');
    return { repaints: repaints, drifts: drifts };
  });
  check('the drift watch notices the rewrite but never rerenders the panel — a repaint from a timer would destroy every open dropdown',
    noRerender.drifts >= 1 && noRerender.repaints === 0,
    JSON.stringify(noRerender));

  /* =======================================================================
     11. LABELS AND CAPTURE
     ==================================================================== */
  const labels = await ev(() => {
    const G = window.GigaHack;
    G.store.cfgSet('keys.watch', false);
    G.keys.set(226, 'shift');
    return {
      unknown: G.keys.label(226),
      letter: G.keys.label(65),
      named: G.keys.label(27),
      numpad: G.keys.label(96),
      fn: G.keys.label(120),
      padNamed: G.keys.padLabel(12),
      padUnknown: G.keys.padLabel(21),
      codeUnknown: G.keys.codeFor(226)
    };
  });
  const labelPanel = await render();
  await ev(() => { window.GigaHack.keys.restoreShipped('keyMapper'); });
  check('a key number with no known label is shown as its number and nothing is guessed',
    labels.unknown === 'key 226' && labels.codeUnknown === null &&
    /key 226226/.test(labelPanel), JSON.stringify(labels));
  check('and the numbers that do have a layout-independent name get it',
    labels.letter === 'A' && labels.named === 'ESC' && labels.numpad === 'NUM 0' &&
    labels.fn === 'F9' && labels.padNamed === '12  D-pad up' && labels.padUnknown === 'button 21',
    JSON.stringify(labels));

  const capture = await ev(() => {
    const G = window.GigaHack;
    const out = { got: null };
    out.freeCode = G.keys.reserved('KeyQ');
    G.keys.arm(function (kc, code) { out.got = { kc: kc, code: code }; });
    out.armed = G.keys.isArmed();

    /* A physical position that does NOT match the number, which is what a
       non-US layout produces. keyCode is what the engine reads. */
    const e = new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: false, cancelable: true });
    Object.defineProperty(e, 'keyCode', { value: 65 });
    window.dispatchEvent(e);

    out.stillArmed = G.keys.isArmed();
    out.observedBefore = G.keys.codeFor(65);
    G.keys.observe(65, null);
    out.observedAfter = G.keys.codeFor(65);
    return out;
  });
  check('the capture control takes the key number from the event rather than deriving one from the position, and records the pair it saw',
    capture.freeCode === '' && capture.armed === true &&
    capture.got && capture.got.kc === 65 && capture.got.code === 'KeyQ' &&
    capture.stillArmed === false &&
    capture.observedBefore === 'KeyQ' && capture.observedAfter === 'KeyA',
    JSON.stringify(capture));

  const preventsTab = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    /* One engine does not preventDefault Tab itself, so the capture listener
       must, or Tab moves focus out of the overlay before anything is recorded.
       The engine's own answer is asserted too, so the check states which
       engine has it rather than skipping. */
    out.enginePreventsTab = Input._shouldPreventDefault(9);
    const disarm = G.keys.arm(function () { });
    const e = new KeyboardEvent('keydown', { code: 'Tab', bubbles: false, cancelable: true });
    Object.defineProperty(e, 'keyCode', { value: 9 });
    window.dispatchEvent(e);
    out.prevented = e.defaultPrevented;
    disarm();
    return out;
  });
  check('the capture listener calls preventDefault itself, whatever the engine\'s own _shouldPreventDefault says about Tab',
    preventsTab.prevented === true &&
    preventsTab.enginePreventsTab === (IS_MZ ? true : false),
    'engine prevents Tab: ' + preventsTab.enginePreventsTab + ' (' + (IS_MZ ? 'MZ' : 'MV') + ')');

  const reservedKeys = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    out.escapeWhy = G.keys.reserved('Escape');
    out.menuWhy = G.keys.reserved(G.cfg.hotkeys.toggleMenu);
    out.list = G.keys.reservedCodes();
    /* What the GAME loses is a different question from what capture refuses,
       and the answer differs between the two kinds of key. */
    out.escapeClaim = G.keys.claim('Escape');
    out.menuClaim = G.keys.claim(G.cfg.hotkeys.toggleMenu);
    out.freeClaim = G.keys.claim('KeyQ');

    let got = null;
    const disarm = G.keys.arm(function (kc) { got = kc; });
    const e = new KeyboardEvent('keydown', { code: 'Escape', bubbles: false, cancelable: true });
    Object.defineProperty(e, 'keyCode', { value: 27 });
    window.dispatchEvent(e);
    out.captured = got;
    out.stillArmed = G.keys.isArmed();
    /* The overlay acted on it first — which is exactly the reason the panel
       gives for not offering capture on these keys. */
    out.overlayClosed = G.ui.isOpen() === false;
    disarm();
    G.ui.setOpen(true);
    return out;
  });
  check('the capture control refuses the keys GigaHack acts on first, and names them',
    reservedKeys.captured === null && reservedKeys.stillArmed === true &&
    /closes this panel/.test(reservedKeys.escapeWhy) &&
    /Settings → Hotkeys/.test(reservedKeys.menuWhy) &&
    reservedKeys.list.indexOf('Escape') > -1,
    reservedKeys.list.join(','));
  check('and the reason it gives is the observable one: the overlay acted on Escape before the capture could see it',
    reservedKeys.overlayClosed === true);
  check('the table says what the game loses on a key GigaHack owns, and does not claim the game never gets Escape — with the menu shut, it does',
    /gets it only when the menu is shut/.test(reservedKeys.escapeClaim) &&
    /never gets it, open or shut/.test(reservedKeys.menuClaim) &&
    reservedKeys.freeClaim === '',
    reservedKeys.escapeClaim + ' / ' + reservedKeys.menuClaim);

  const capturePanel = await render();
  check('the panel says which keys it cannot capture and names the number field as the only route to them',
    /cannot be captured here/.test(capturePanel) &&
    /only\s+route to key 27/.test(capturePanel.replace(/\s+/g, ' ')));

  /* =======================================================================
     12. NO PAD MAP ON THIS BUILD
     ==================================================================== */
  const noPad = await ev(() => {
    const G = window.GigaHack;
    const real = Input.gamepadMapper;
    delete Input.gamepadMapper;
    const out = {
      padMap: JSON.stringify(G.keys.padMap()),
      writable: G.keys.writable('gamepadMapper'),
      kbStillWritable: G.keys.writable('keyMapper').ok
    };
    G.cfg.ui.tab = 'settings';
    G.cfg.ui.sub.settings = 'Game Keys';
    G.ui.setOpen(true);
    G.ui.rerender();
    const root = document.querySelector('#mm-root .mm-win');
    out.text = root ? root.textContent : '';
    out.built = out.text.length > 400;
    Input.gamepadMapper = real;
    return out;
  });
  check('the panel still builds when Input.gamepadMapper is absent, and says the pad map cannot be edited on this build',
    noPad.built && noPad.padMap === '{}' && noPad.writable.reason === 'pad' &&
    noPad.kbStillWritable === true &&
    /Input\.gamepadMapper is not present on this build/.test(noPad.text) &&
    /keyboard map above is unaffected/.test(noPad.text),
    noPad.writable.reason);

  const noPadRead = await ev(() => {
    return window.GigaHack.keys.padPresent();
  });
  check('with no controller attached, reading a button says so and points at the index field instead of leaving a dead control',
    noPadRead.ok === false && /no gamepad is connected/.test(noPadRead.why), noPadRead.why);

  /* =======================================================================
     13. NOTHING IN THE MODULE ASKS WHICH ENGINE THIS IS
     ==================================================================== */
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'gigahack', 'js', 'plugins', 'GigaHack_Keys.js'), 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('nothing in the module branches on the engine version — every two-engine difference here is a presence test on Input itself',
    !/engineVersion|RPGMAKER_VERSION|caps\.isMV|caps\.isMZ/.test(codeOnly),
    (codeOnly.match(/engineVersion|RPGMAKER_VERSION|caps\.isM[VZ]/g) || []).join(','));
  check('and no engine method is assigned outside $.install',
    !/(^|[^.\w])(Input|ConfigManager|SceneManager|Scene_Options\.prototype)\.[A-Za-z0-9_]+\s*=[^=]/m.test(codeOnly),
    (codeOnly.match(/(^|[^.\w])(Input|ConfigManager)\.[A-Za-z0-9_]+\s*=[^=]/g) || []).join(' | '));

  await shot('panel-game-keys');

  /* =======================================================================
     14. PUT EVERYTHING BACK
     ==================================================================== */
  const putBack = await ev(() => {
    const G = window.GigaHack, k = window.__keysKeep;
    G.keys.restoreShipped('both');
    G.store.remove('keys.json');
    G.store.cfgSet('keys.persist', k.persist);
    G.store.cfgSet('keys.reassert', k.reassert);
    G.store.cfgSet('keys.watch', k.watch);
    G.cfg.hotkeys.toggleMenu = k.toggleMenu;
    G.compat.clearDegraded('keys.map');
    G.compat.clearDegraded('keys.pad');
    G.keys.observe(65, null);
    /* Unwinding this file's own undo entries is cleanup, not behaviour, and
       the mod's log is a 400-entry ring that the boot report has to survive.
       So the teardown's own "undid:" lines are kept out of it; every line the
       module wrote WHILE being tested is still there. */
    const realLog = G.log;
    G.log = function () { };
    while (G.undo.size() > k.undo) G.undo.pop();
    G.log = realLog;
    Input.clear();
    /* Let the watch re-sync quietly, so no later check inherits a toast. */
    for (var i = 0; i < 40; i++) window.__raf.flush();
    G.cfg.ui.tab = k.tab;
    if (k.sub) G.cfg.ui.sub.settings = k.sub; else delete G.cfg.ui.sub.settings;
    G.ui.setOpen(k.open);
    G.ui.rerender();
    return {
      kb: JSON.stringify(G.keys.map()) === k.kb,
      pad: JSON.stringify(G.keys.padMap()) === k.pad,
      sameKbObject: Input.keyMapper === k.mapperObject,
      samePadObject: Input.gamepadMapper === k.padObject,
      record: G.store.exists('keys.json') === k.hadRecord,
      settings: G.store.cfgGet('keys.persist', false) === k.persist &&
        G.store.cfgGet('keys.reassert', false) === k.reassert &&
        G.store.cfgGet('keys.watch', true) === k.watch,
      menuKey: G.cfg.hotkeys.toggleMenu === k.toggleMenu,
      undo: G.undo.size() === k.undo,
      degraded: !G.compat.isDegraded('keys.map') && !G.compat.isDegraded('keys.pad'),
      drift: G.keys.drift().changed,
      armed: G.keys.isArmed(),
      state: JSON.stringify(Input._currentState)
    };
  });
  check('keys leaves the game exactly as it found it — the same map object, the same map, no armed capture and no drift',
    putBack.kb && putBack.pad && putBack.sameKbObject && putBack.samePadObject &&
    putBack.record && putBack.settings && putBack.menuKey && putBack.undo &&
    putBack.degraded && putBack.drift === false && putBack.armed === false &&
    putBack.state === '{}',
    JSON.stringify(putBack));
};
