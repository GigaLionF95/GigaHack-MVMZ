/* =============================================================================
   GigaHack MV/MZ — regressions from the gameplay-module review

   One block per bug that review found, each written as the scenario that
   failed: the item an equip swap deleted, the freeze that followed a player
   into another save, the instant win that decided an already-ended battle a
   second time, the Ghost toggle that ate the action button, the re-imported
   addon whose alias never ran, the Steam refresh a silent binding wedged, and
   the global probe a cross-origin object took down.

   Every block puts back what it touched in a finally, and says so in the
   check when it could not.
   ========================================================================== */
'use strict';

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev;

  /* =======================================================================
     PARTY — an equip swap keeps the bag honest
     ==================================================================== */
  const equip = await ev(() => {
    const G = window.GigaHack, P = G.party;
    const a = $gameActors.actor(1);
    const n = (it) => $gameParty.numItems(it);
    const W3 = $dataWeapons[3], W6 = $dataWeapons[6], W9 = $dataWeapons[9], W1 = $dataWeapons[1];
    const keep = {
      cls: a._classId,
      eq: a._equips.map(e => e.object()),
      weapons: JSON.stringify($gameParty._weapons || {}),
      armors: JSON.stringify($gameParty._armors || {}),
      undo: G.undo.size()
    };
    const out = {};
    try {
      a._classId = 1;                                // every weapon type
      a._equips[0].setObject(W3);
      delete $gameParty._weapons[3]; delete $gameParty._weapons[6]; delete $gameParty._weapons[9];

      out.swap = P.equip(a, 0, W6);
      out.swapSlot = a.equips()[0] ? a.equips()[0].id : 0;
      out.swapOldInBag = n(W3);
      out.swapNewInBag = n(W6);                      // conjured, not taken from the bag

      out.unequip = P.equip(a, 0, null);
      out.unequipSlot = a.equips()[0];
      out.unequipInBag = n(W6);

      G.undo.pop();                                  // the unequip
      out.undo1 = { slot: a.equips()[0] ? a.equips()[0].id : 0, bag6: n(W6) };
      G.undo.pop();                                  // the swap
      out.undo2 = { slot: a.equips()[0] ? a.equips()[0].id : 0, bag3: n(W3), bag6: n(W6) };

      /* From the bag: one comes out, the old one goes in, undo reverses both. */
      $gameParty._weapons[9] = 2;
      out.fromBag = P.equip(a, 0, W9);
      out.fromBagCounts = { bag9: n(W9), bag3: n(W3) };
      G.undo.pop();
      out.fromBagUndo = { slot: a.equips()[0] ? a.equips()[0].id : 0, bag9: n(W9), bag3: n(W3) };

      /* Class 2 is sword-only; weapon 1 is a staff. Refused, and nothing moves. */
      a._classId = 2;
      out.canStaff = a.canEquip(W1);
      const undoBefore = G.undo.size();
      out.refused = P.equip(a, 0, W1);
      out.refusedSlot = a.equips()[0] ? a.equips()[0].id : 0;
      out.refusedBag3 = n(W3);
      out.refusedNoUndo = G.undo.size() === undoBefore;
      out.why = P.whyCannotEquip(a, 0, W1);
    } catch (e) {
      out.threw = String(e && e.message || e);
    } finally {
      while (G.undo.size() > keep.undo) G.undo.pop();
      a._classId = keep.cls;
      keep.eq.forEach((it, i) => { if (a._equips[i]) a._equips[i].setObject(it); });
      $gameParty._weapons = JSON.parse(keep.weapons);
      $gameParty._armors = JSON.parse(keep.armors);
      out.restored = G.undo.size() === keep.undo && a._classId === keep.cls &&
        JSON.stringify($gameParty._weapons) === keep.weapons;
    }
    return out;
  });
  check('equipping over a worn weapon puts the old one back in the bag instead of deleting it',
    !equip.threw && equip.swap === true && equip.swapSlot === 6 && equip.swapOldInBag === 1 &&
    equip.swapNewInBag === 0, JSON.stringify(equip));
  check('unequipping a slot returns the item to the bag',
    equip.unequip === true && equip.unequipSlot === null && equip.unequipInBag === 1, JSON.stringify(equip));
  check('undoing an unequip and a swap puts slot and bag back exactly — the conjured item goes, ' +
    'the original comes back off the shelf',
    equip.undo1 && equip.undo1.slot === 6 && equip.undo1.bag6 === 0 &&
    equip.undo2 && equip.undo2.slot === 3 && equip.undo2.bag3 === 0 && equip.undo2.bag6 === 0,
    JSON.stringify({ u1: equip.undo1, u2: equip.undo2 }));
  check('an item the party owns is taken out of the bag when it is equipped, and undo puts it back',
    equip.fromBag === true && equip.fromBagCounts.bag9 === 1 && equip.fromBagCounts.bag3 === 1 &&
    equip.fromBagUndo.slot === 3 && equip.fromBagUndo.bag9 === 2 && equip.fromBagUndo.bag3 === 0,
    JSON.stringify({ c: equip.fromBagCounts, u: equip.fromBagUndo }));
  check('a weapon the class cannot use is refused before anything is written — the worn one stays',
    equip.canStaff === false && equip.refused === false && equip.refusedSlot === 3 &&
    equip.refusedBag3 === 0 && equip.refusedNoUndo === true && equip.why.length > 0,
    JSON.stringify(equip));
  check('the equip checks put the actor, the bag and the undo stack back', equip.restored === true);

  /* =======================================================================
     VARS — a freeze does not follow the player into another playthrough
     ==================================================================== */
  const freeze = await ev(() => {
    const G = window.GigaHack, V = G.vars, H = G.text && G.text.history;
    const keep = {
      v6: $gameVariables._data[6], s7: $gameSwitches._data[7],
      frozen: V.frozenList(), hist: H ? H.on() : null
    };
    const out = {};
    try {
      V.clearFreeze();
      V.freeze('var', 6, true);
      V.freeze('switch', 7, true);
      out.before = V.frozenCount();
      const logAt = G.logCount();
      if (H) H.setOn(false);           // the signal also marks a break in the history
      // The signal alone (a profile re-resolve) is not a new playthrough.
      G.emit('gameobjects');
      out.keptOnSameSystem = V.frozenCount();
      // A load or new game replaces $gameSystem; model exactly that.
      const sys = window.$gameSystem;
      window.$gameSystem = Object.create(sys);
      try { G.emit('gameobjects'); } finally { window.$gameSystem = sys; }
      if (H) H.setOn(keep.hist);
      out.after = V.frozenCount();
      out.said = G.logHistory().slice(logAt).some(e => /released 2 frozen/.test(e.msg));
      $gameVariables.setValue(6, 12345);
      G.frame();
      out.notReapplied = $gameVariables.value(6) === 12345;
    } catch (e) {
      out.threw = String(e && e.message || e);
    } finally {
      V.clearFreeze();
      $gameVariables._data[6] = keep.v6;
      $gameSwitches._data[7] = keep.s7;
      keep.frozen.forEach(f => {
        if (f.kind === 'var') { const was = $gameVariables._data[f.id]; $gameVariables._data[f.id] = f.value; V.freeze('var', f.id, true); $gameVariables._data[f.id] = was; }
        else { const was = $gameSwitches._data[f.id]; $gameSwitches._data[f.id] = f.value; V.freeze('switch', f.id, true); $gameSwitches._data[f.id] = was; }
      });
      if (H) H.setOn(keep.hist);
      out.restored = V.frozenCount() === keep.frozen.length;
    }
    return out;
  });
  check('a new game or a loaded save releases every freeze, and the log says so',
    !freeze.threw && freeze.before === 2 && freeze.after === 0 && freeze.said === true,
    JSON.stringify(freeze));
  check('the same signal with the playthrough unchanged (a profile re-resolve) keeps the freezes',
    !freeze.threw && freeze.keptOnSameSystem === 2, JSON.stringify(freeze));
  check('so the old frozen value is not written into the new playthrough on the next frame',
    freeze.notReapplied === true, JSON.stringify(freeze));
  check('the freeze check put the variables, switches and freezes back', freeze.restored === true);

  /* =======================================================================
     BATTLE — an ended battle is not decided a second time
     ==================================================================== */
  const ended = await ev(() => {
    const G = window.GigaHack, B = G.battle;
    const keep = {
      inBattle: window.__inBattle, phase: BattleManager._phase,
      enemies: $gameTroop._enemies ? $gameTroop._enemies.slice() : null, troopId: $gameTroop._troopId,
      victories: window.__victories || 0, defeats: window.__defeats || 0, forced: window.__forced || 0
    };
    const out = {};
    try {
      window.__inBattle = true;
      if (!B.enemies().length) $gameTroop.setup(1);
      const hp = B.enemies().map(e => e.hp);
      const party = B.actors().map(a => a.hp);
      BattleManager._phase = 'battleEnd';
      out.over = B.battleOver();
      out.win = B.instantWin();
      out.lose = B.instantLose();
      out.hpKept = JSON.stringify(B.enemies().map(e => e.hp)) === JSON.stringify(hp);
      out.partyKept = JSON.stringify(B.actors().map(a => a.hp)) === JSON.stringify(party);
      out.victories = (window.__victories || 0) - keep.victories;
      out.defeats = (window.__defeats || 0) - keep.defeats;
      out.forceWhy = B.forceWhy();

      /* A live phase, a dead battler: forcing it is refused. */
      BattleManager._phase = 'input';
      const corpse = {
        isAppeared: () => true, isDeathStateAffected: () => true,
        forceAction: function () { window.__corpseActed = true; }, name: () => 'corpse'
      };
      out.forceDead = B.forceAction(corpse, 1, -1);
      out.corpseActed = window.__corpseActed === true;
      out.forcedDelta = (window.__forced || 0) - keep.forced;
    } catch (e) {
      out.threw = String(e && e.message || e);
    } finally {
      delete window.__corpseActed;
      window.__inBattle = keep.inBattle;
      BattleManager._phase = keep.phase;
      if (keep.enemies) $gameTroop._enemies = keep.enemies;
      $gameTroop._troopId = keep.troopId;
    }
    return out;
  });
  check('instant win and instant lose are refused once the battle has ended, and nothing is decided again',
    !ended.threw && ended.over === true && ended.win === false && ended.lose === false &&
    ended.hpKept && ended.partyKept && ended.victories === 0 && ended.defeats === 0,
    JSON.stringify(ended));
  check('force action says the battle is over, and refuses a dead battler while it is still on',
    /already ended/.test(ended.forceWhy || '') && ended.forceDead === false &&
    ended.corpseActed === false && ended.forcedDelta === 0, JSON.stringify(ended));

  /* =======================================================================
     PLAYER — Ghost blocks touch triggers, not the action button
     ==================================================================== */
  const ghost = await ev(() => {
    const G = window.GigaHack;
    const keep = { ghost: G.store.cfgGet('player.ghost', false), n: window.__hereTriggers };
    const out = {};
    try {
      G.store.cfgSet('player.ghost', true);
      window.__hereTriggers = 0;
      $gamePlayer.checkEventTriggerHere([0]);
      out.action = window.__hereTriggers;
      $gamePlayer.checkEventTriggerHere([1, 2]);
      out.touchOnly = window.__hereTriggers;
      $gamePlayer.checkEventTriggerHere([0, 1, 2]);
      out.mixed = window.__hereTriggers;
    } catch (e) {
      out.threw = String(e && e.message || e);
    } finally {
      G.store.cfgSet('player.ghost', keep.ghost);
      window.__hereTriggers = keep.n;
    }
    return out;
  });
  check('with Ghost on, the action button still reaches an event on the player\'s own tile (trigger 0)',
    !ghost.threw && ghost.action === 1 && ghost.mixed === 2, JSON.stringify(ghost));
  check('and a touch-only check on that tile (triggers 1 and 2) is still blocked',
    ghost.touchOnly === 1, JSON.stringify(ghost));

  /* =======================================================================
     ADDONS — a removed and re-imported addon's alias runs
     ==================================================================== */
  const hook = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const NAME = 'regress probe (addon:regress-hook)';
    const src = (v) => [
      '/*:',
      ' * @gigahack-addon',
      ' * @id regress-hook',
      ' * @name Regress hook',
      ' */',
      'GigaHack.addon(function (api) {',
      '    api.hook(\'regress probe\', Game_Player.prototype, \'__regressProbe\',',
      '        function (original) { return function () { return \'' + v + '\'; }; });',
      '});'
    ].join('\n');
    const out = {};
    Game_Player.prototype.__regressProbe = function () { return 'original'; };
    try {
      A.stage({ text: src('v1'), from: 'paste' }); A.commit(); A.enable('regress-hook');
      out.v1 = $gamePlayer.__regressProbe();
      A.remove('regress-hook');
      out.removed = $gamePlayer.__regressProbe();
      A.stage({ text: src('v2'), from: 'paste' }); A.commit();
      out.importedOff = $gamePlayer.__regressProbe();
      A.enable('regress-hook');
      out.v2 = $gamePlayer.__regressProbe();
      out.oneAlias = Object.keys(G.hooks).filter(n => n === NAME).length === 1;
    } catch (e) {
      out.threw = String(e && e.message || e);
    } finally {
      if (A.get('regress-hook')) A.remove('regress-hook');
      delete Game_Player.prototype.__regressProbe;
      delete G.hooks[NAME];
      out.restored = !A.get('regress-hook') && !G.hooks[NAME] &&
        typeof Game_Player.prototype.__regressProbe === 'undefined';
    }
    return out;
  });
  check('an addon alias passes through once the addon is removed, and stays off after a re-import ' +
    'until it is enabled',
    !hook.threw && hook.v1 === 'v1' && hook.removed === 'original' && hook.importedOff === 'original',
    JSON.stringify(hook));
  check('a removed and re-imported addon\'s alias runs the NEW code — not a dead record\'s pass-through',
    hook.v2 === 'v2' && hook.oneAlias === true, JSON.stringify(hook));
  check('the addon alias check removed its addon, its probe method and its hook record', hook.restored === true);

  /* =======================================================================
     STEAM — a silent or 0-answering binding does not wedge refresh
     ==================================================================== */
  const steam = await ev(async () => {
    const G = window.GigaHack, S = G.steam;
    const keep = { ach: S._achieved(), gw: window.greenworks, had: 'greenworks' in window, t: S._callTimeout() };
    const out = {};
    try {
      window.greenworks = {
        isSteamRunning: function () { return true; },
        getAchievementNames: function () { return ['RG_ZERO', 'RG_SILENT']; },
        activateAchievement: function () { return undefined; },
        /* Neither calls back. One answers 0 synchronously, one says nothing. */
        getAchievement: function (name) { return name === 'RG_ZERO' ? 0 : undefined; }
      };
      S._callTimeout(40);
      S.env(true); S.list(true);
      let done = 0;
      out.started = S.refresh(function () { done++; });
      out.zeroSettled = S.stateOf('RG_ZERO') === false;
      await new Promise(r => setTimeout(r, 250));
      out.done = done;
      out.polling = S._polling();
      out.again = S.refresh();
      await new Promise(r => setTimeout(r, 250));
      out.pollingAfter = S._polling();
    } catch (e) {
      out.threw = String(e && e.message || e);
    } finally {
      if (keep.had) window.greenworks = keep.gw; else delete window.greenworks;
      S._callTimeout(keep.t);
      S.env(true); S.list(true);
      S._achieved(keep.ach);
      out.restored = JSON.stringify(S._achieved()) === JSON.stringify(keep.ach) && S._callTimeout() === keep.t;
    }
    return out;
  });
  check('a Steam binding answering 0 synchronously is read as "locked" at once',
    !steam.threw && steam.started === true && steam.zeroSettled === true, JSON.stringify(steam));
  check('and one that never answers is settled by the timeout, so refresh finishes and can run again',
    steam.done === 1 && steam.polling === false && steam.again === true && steam.pollingAfter === false,
    JSON.stringify(steam));
  check('the Steam refresh check put the binding, the timeout and the answers back', steam.restored === true);

  /* =======================================================================
     STEAM — the global probe survives a cross-origin-shaped object
     ==================================================================== */
  const shim = await ev(() => {
    const G = window.GigaHack, S = G.steam;
    function sec() { const e = new Error('Blocked a frame with origin "null" from accessing a cross-origin frame.'); e.name = 'SecurityError'; return e; }
    const out = {};
    const logAt = G.logCount();
    let consoleErrs = 0;
    const realErr = console.error;
    console.error = function () { consoleErrs++; return realErr.apply(console, arguments); };
    try {
      window.__regressCrossOrigin = new Proxy({}, {
        get: function () { throw sec(); },
        ownKeys: function () { throw sec(); },
        getOwnPropertyDescriptor: function () { throw sec(); }
      });
      Object.defineProperty(window, '__regressThrowingGetter', {
        get: function () { throw sec(); }, enumerable: true, configurable: true
      });
      /* After both, so finding it proves the walk did not stop at them. */
      window.__regressShapedBinding = { unlockAchievement: function () { return true; } };
      const e = S.env(true);
      const shimProbe = e.tried.filter(t => t.name === 'any other binding')[0] || {};
      out.foundAfter = !!shimProbe.found;
      out.label = shimProbe.api ? shimProbe.api.name : (shimProbe.why || '');
      out.errLogged = G.logHistory().slice(logAt).filter(x => x.level === 'err').map(x => x.msg);
      out.consoleErrs = consoleErrs;
    } catch (e) {
      out.threw = String(e && e.message || e);
    } finally {
      console.error = realErr;
      delete window.__regressCrossOrigin;
      delete window.__regressThrowingGetter;
      delete window.__regressShapedBinding;
      S.env(true); S.list(true);
      out.restored = !('__regressCrossOrigin' in window) && !('__regressThrowingGetter' in window) &&
        !('__regressShapedBinding' in window);
    }
    return out;
  });
  check('the Steam global probe walks past an object that throws SecurityError on every read, ' +
    'and still finds a binding after it',
    !shim.threw && shim.foundAfter === true && /__regressShapedBinding/.test(shim.label), JSON.stringify(shim));
  check('and nothing about the cross-origin read is logged as an error',
    shim.errLogged && shim.errLogged.length === 0 && shim.consoleErrs === 0, JSON.stringify(shim));
  check('the probe check removed its three globals', shim.restored === true);
};
