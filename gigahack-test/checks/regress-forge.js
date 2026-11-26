/* =============================================================================
   Regressions — Forge tombstones and boot timing, Kit undo and preflight,
   Build's parameter-edit undo.

   Each section below is a bug that once shipped, asserted from the failing
   side: a retired forged class turned every actor on it to NaN, a retired
   parallel common event kept running, re-applying a kit at the level the
   actor already had threw away the exp inside that level, a kit whose class
   had gone wrote a dangling class id, the undo of a "provide a missing item"
   apply left the copy in the bag, and undoing a parameter edit left its
   session-edit row behind.

   Everything touched is put back: the Forge library file and the in-memory
   library, the length of every $data array a row was forged into, the actor's
   class, level, exp, skills, bonuses, slots and gauges, the party's bag, the
   switch the common event is gated on, every parameter value and the undo
   stack.
   ========================================================================== */
'use strict';

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev;

  /* =========================================================================
     0 — REMEMBER EVERYTHING
     ====================================================================== */
  await ev(() => {
    const G = window.GigaHack;
    const k = window.__regKeep = {};
    k.lib = G.store.exists('items.json') ? JSON.stringify(G.store.read('items.json', null)) : null;
    k.lens = {
      classes: $dataClasses.length, common: $dataCommonEvents.length, items: $dataItems.length
    };
    k.undo = G.undo.size();
    k.bag = JSON.stringify([$gameParty._items, $gameParty._weapons, $gameParty._armors]);
    const a = $gameActors.actor(1);
    k.actor = {
      classId: a._classId, level: a._level, exp: JSON.stringify(a._exp),
      skills: a._skills.slice(), paramPlus: a._paramPlus.slice(),
      equips: a._equips.map(it => [it._dataClass, it._itemId]),
      hp: a._hp, mp: a._mp, tp: a._tp
    };
    k.readonly = !!(G.cfg.behaviour || {}).readonly;
    if (G.cfg.behaviour) G.cfg.behaviour.readonly = false;
    window.__regRestoreActor = function () {
      const s = window.__regKeep.actor, b = $gameActors.actor(1);
      b._classId = s.classId; b._level = s.level; b._exp = JSON.parse(s.exp);
      b._skills = s.skills.slice(); b._paramPlus = s.paramPlus.slice();
      for (let i = 0; i < s.equips.length && i < b._equips.length; i++) {
        b._equips[i]._dataClass = s.equips[i][0]; b._equips[i]._itemId = s.equips[i][1];
      }
      b.refresh();
      b._hp = s.hp; b._mp = s.mp; b._tp = s.tp;
    };
  });

  /* =========================================================================
     1 — FORGE: a retired row still resolves, and does nothing
     ====================================================================== */
  const tomb = await ev(() => {
    const G = window.GigaHack, F = G.forge, out = {};
    const a = $gameActors.actor(1);

    /* A forged class, worn, then retired. paramBase reads params[id][level]
       with no guard, so the stub has to keep the curve's shape. */
    const cls = F.commit('klass', Object.assign(F.blank('klass'), { name: 'Regress Class' }));
    out.classId = cls && cls.id;
    if (cls) {
      a.changeClass(cls.id, true);
      out.beforeMhp = a.mhp;
      F.retire('klass', cls.id);
      out.tombstone = !!($dataClasses[cls.id] && $dataClasses[cls.id].gigahackTombstone);
      out.params = [];
      for (let p = 0; p < 8; p++) out.params.push(a.param(p));
      out.finite = out.params.every(v => typeof v === 'number' && isFinite(v));
      out.rowLen = $dataClasses[cls.id].params.map(r => Array.isArray(r) ? r.length : -1);
    }
    window.__regRestoreActor();

    /* A forged parallel common event, live on its switch, then retired. */
    const sw = 1, swWas = $gameSwitches.value(sw);
    const ce = F.commit('common', Object.assign(F.blank('common'), {
      name: 'Regress Parallel', trigger: 2, switchId: sw,
      list: [{ code: 355, indent: 0, parameters: ['window.__regRan = (window.__regRan || 0) + 1'] },
        { code: 0, indent: 0, parameters: [] }]
    }));
    out.ceId = ce && ce.id;
    if (ce) {
      $gameSwitches.setValue(sw, true);
      const gce = (typeof Game_CommonEvent === 'function') ? new Game_CommonEvent(ce.id) : null;
      out.hasGce = !!gce;
      out.activeBefore = gce ? !!gce.isActive() : null;
      F.retire('common', ce.id);
      const row = $dataCommonEvents[ce.id];
      out.ceTrigger = row.trigger;
      out.ceList = JSON.stringify(row.list);
      out.activeAfter = gce ? !!gce.isActive() : null;
      out.runRefused = F.runCommon(ce.id) === false;
      $gameSwitches.setValue(sw, swWas);
    }

    /* A forged damaging item, retired: the damage goes with the effects. */
    const it = F.commit('item', Object.assign(F.blank('item'), {
      name: 'Regress Bomb', damage: { critical: false, elementId: 0, formula: '100', type: 1, variance: 0 },
      effects: [{ code: 11, dataId: 0, value1: 0.5, value2: 0 }]
    }));
    if (it) {
      F.retire('item', it.id);
      out.itemDamageType = $dataItems[it.id].damage.type;
      out.itemEffects = $dataItems[it.id].effects.length;
    }

    /* Boot timing: the earlier hook is installed, and the boot injection ran
       once rather than twice. */
    const hk = G.hooks['DataManager.isDatabaseLoaded (forge inject)'];
    out.dbHook = !!(hk && hk.installed);
    out.bootInjected = !!(F._bootInjected && F._bootInjected());
    out.dbLoadedStill = DataManager.isDatabaseLoaded() === true;
    return out;
  });
  check('a retired forged class keeps an 8-row curve, so an actor still on it has finite stats',
    tomb.tombstone === true && tomb.finite === true &&
    tomb.rowLen && tomb.rowLen.length === 8 && tomb.rowLen.every(n => n >= 100),
    JSON.stringify({ params: tomb.params, rows: tomb.rowLen }));
  check('a retired forged parallel common event stops being active and its program is emptied',
    tomb.ceTrigger === 0 && tomb.ceList === '[{"code":0,"indent":0,"parameters":[]}]' &&
    (tomb.hasGce ? (tomb.activeBefore === true && tomb.activeAfter === false) : true),
    JSON.stringify({ trig: tomb.ceTrigger, before: tomb.activeBefore, after: tomb.activeAfter }));
  check('a retired forged common event is refused by "run it now"', tomb.runRefused === true);
  check('a retired forged item does no damage and has no effects',
    tomb.itemDamageType === 0 && tomb.itemEffects === 0,
    JSON.stringify({ type: tomb.itemDamageType, fx: tomb.itemEffects }));
  check('forged rows are injected from the first database-loaded check as well as from Scene_Boot.start',
    tomb.dbHook === true && tomb.bootInjected === true && tomb.dbLoadedStill === true,
    JSON.stringify({ hook: tomb.dbHook, injected: tomb.bootInjected }));

  /* =========================================================================
     2 — KIT: same level keeps exp; a missing class is refused whole
     ====================================================================== */
  const kit = await ev(() => {
    const G = window.GigaHack, K = G.kit, out = {};
    const a = $gameActors.actor(1);
    const undo0 = G.undo.size();

    /* Halfway into the current level, then a kit recorded right here. */
    const floor = a.expForLevel(a.level);
    const gap = a.isMaxLevel() ? 0 : a.nextLevelExp() - floor;
    const mid = floor + Math.max(1, Math.floor(gap / 2));
    if (!a.isMaxLevel()) a.changeExp(mid, false);
    const expBefore = a.currentExp(), lvBefore = a.level;
    const kitSame = K.capture(a);
    kitSame.name = '__regress same level';
    const rep = K.apply(a, kitSame, { applyEquip: false });
    out.levelStep = rep.steps.filter(s => s.what === 'level')[0] || null;
    out.expAfter = a.currentExp(); out.expBefore = expBefore;
    out.levelSame = a.level === lvBefore;
    out.undoPushed = G.undo.size() - undo0;
    G.undo.pop();
    out.expAfterUndo = a.currentExp();

    /* A kit whose class has no row here. */
    const ghost = K.capture(a);
    ghost.name = '__regress ghost class';
    ghost.classId = $dataClasses.length + 50;
    const clsBefore = a._classId, undo1 = G.undo.size();
    const bad = K.apply(a, ghost);
    out.ghost = {
      invalid: !!bad.invalid, steps: bad.steps.length, ok: bad.ok,
      classKept: a._classId === clsBefore, undoUnchanged: G.undo.size() === undo1,
      why: bad.message
    };
    const kitsBefore = K.list().length;
    const imp = K.importKit(JSON.stringify(ghost));
    out.importRefused = imp.ok === false && K.list().length === kitsBefore;
    out.importWhy = imp.why;

    window.__regRestoreActor();
    return out;
  });
  check('re-applying a kit at the level the actor already has keeps the exp inside that level',
    kit.levelStep && kit.levelStep.skipped === true && kit.levelSame === true &&
    kit.expAfter === kit.expBefore && kit.expAfterUndo === kit.expBefore,
    JSON.stringify({ before: kit.expBefore, after: kit.expAfter, undo: kit.expAfterUndo, step: kit.levelStep }));
  check('a kit whose class is not in the database is refused before anything is written',
    kit.ghost.invalid === true && kit.ghost.steps === 0 && kit.ghost.classKept === true &&
    kit.ghost.undoUnchanged === true && /no such class/.test(kit.ghost.why),
    JSON.stringify(kit.ghost));
  check('and a pasted kit naming such a class is not imported', kit.importRefused === true, kit.importWhy);

  /* =========================================================================
     3 — KIT: undoing a "provide a missing item" apply takes the copy back
     ====================================================================== */
  const prov = await ev(() => {
    const G = window.GigaHack, K = G.kit, out = {};
    const a = $gameActors.actor(1);
    const slots = a.equipSlots();
    let slot = -1, w = null;
    for (let s = 0; s < slots.length && !w; s++) {
      const pool = slots[s] === 1 ? $dataWeapons : $dataArmors;
      for (let i = 1; i < pool.length; i++) {
        const o = pool[i];
        if (!o || o.etypeId !== slots[s] || !a.canEquip(o)) continue;
        if ($gameParty.numItems(o) > 0 || a.equips()[s] === o) continue;
        if (a.isEquipTypeSealed(slots[s])) continue;
        slot = s; w = o; break;
      }
    }
    out.found = !!w;
    if (!w) return out;
    const undo0 = G.undo.size();
    const bag0 = JSON.stringify([$gameParty._items, $gameParty._weapons, $gameParty._armors]);
    const was = a.equips()[slot] || null;
    const k = K.capture(a);
    k.name = '__regress provide';
    k.slots[slot] = { etypeId: slots[slot], kind: K.kindOf(w), id: w.id, name: w.name };
    const rep = K.apply(a, k, {
      applyClass: false, applyLevel: false, applySkills: false, applyParams: false,
      applyEquip: true, provide: true, force: false
    });
    out.created = rep.created.length;
    out.equipped = a.equips()[slot] === w;
    G.undo.pop();                                  // the kit's own entry
    out.heldAfterUndo = $gameParty.numItems(w);
    out.slotBack = (a.equips()[slot] || null) === was;
    out.bagBack = JSON.stringify([$gameParty._items, $gameParty._weapons, $gameParty._armors]) === bag0;
    while (G.undo.size() > undo0) G.undo.pop();    // the inventory's own give, now a no-op
    out.bagStill = JSON.stringify([$gameParty._items, $gameParty._weapons, $gameParty._armors]) === bag0;
    window.__regRestoreActor();
    return out;
  });
  check('undoing a kit apply that provided a missing item takes that item back out of the bag',
    prov.found === true && prov.created === 1 && prov.equipped === true &&
    prov.heldAfterUndo === 0 && prov.slotBack === true && prov.bagBack === true && prov.bagStill === true,
    JSON.stringify(prov));

  /* =========================================================================
     4 — BUILD: undoing a parameter edit clears its session-edit row
     ====================================================================== */
  const pe = await ev(() => {
    const G = window.GigaHack, PM = G.build.params, out = {};
    let e = null, p = null;
    const rows = PM.entries().rows;
    for (let i = 0; i < rows.length && !p; i++) {
      if (!PM.editable(rows[i])) continue;
      for (let j = 0; j < rows[i].params.length; j++) {
        if (!rows[i].params[j].isJson && !rows[i].params[j].edited) { e = rows[i]; p = rows[i].params[j]; break; }
      }
    }
    out.found = !!p;
    if (!p) return out;
    const edits0 = PM.edits().length, undo0 = G.undo.size();
    const was = PluginManager._parameters[e.key][p.name];
    const r = PM.set(e, p.name, String(was) + '_regress');
    out.ok = r.ok;
    out.editsDuring = PM.edits().length - edits0;
    G.undo.pop();
    out.editsAfter = PM.edits().length - edits0;
    out.value = PluginManager._parameters[e.key][p.name] === was;
    out.edited = PM.rows({ q: '', filter: 'edited', showEmpty: false })
      .some(row => row.entry.key === e.key && row.param && row.param.name === p.name);
    out.undoBack = G.undo.size() === undo0;
    return out;
  });
  check('undoing a parameter edit removes its session-edit row and its "edited" mark',
    pe.found === true && pe.ok === true && pe.editsDuring === 1 && pe.editsAfter === 0 &&
    pe.value === true && pe.edited === false && pe.undoBack === true, JSON.stringify(pe));

  /* =========================================================================
     4b — FORGE: no base is worked out, or recorded, from a database that is
          still arriving. One kind's array is taken away, the library file is
          taken away so nothing recorded can answer instead, and the profile
          is re-resolved the way a file load re-resolves it.
     ====================================================================== */
  const early = await ev(() => {
    const G = window.GigaHack, F = G.forge, out = {};
    const libRaw = G.store.exists('items.json') ? JSON.stringify(G.store.read('items.json', null)) : null;
    const troops = window.$dataTroops;
    try {
      window.$dataTroops = null;
      G.profile.resolve(true);
      G.store.remove('items.json');
      F.load();
      out.troopBase = F.base('troop');
      out.itemBase = F.base('item');
      out.bases = F.bases();
      out.nextId = F.nextId('troop');
      F.save();
      const written = G.store.read('items.json', null);
      out.recorded = written ? (written._bases === null || written._bases === undefined
        ? null : written._bases.troop === undefined ? null : written._bases.troop) : 'no file';
    } finally {
      window.$dataTroops = troops;
      G.profile.resolve(true);
      if (libRaw === null) G.store.remove('items.json');
      else G.store.write('items.json', JSON.parse(libRaw), true);
      F.load();
    }
    out.globalBack = window.$dataTroops === troops && Array.isArray(window.$dataTroops);
    out.troopBaseAfter = F.base('troop');
    out.libBack = (G.store.exists('items.json') ? JSON.stringify(G.store.read('items.json', null)) : null) === libRaw;
    return out;
  });
  check('with one kind\'s data not loaded yet, no id base is computed or recorded for it',
    early.troopBase === 0 && early.nextId === 0 && early.recorded === null &&
    !(early.bases && early.bases.troop), JSON.stringify(early));
  check('and once the array is back the base resolves again, with the global and the library put back',
    early.globalBack === true && early.troopBaseAfter > 0 && early.libBack === true, JSON.stringify(early));

  /* =========================================================================
     5 — PUT EVERYTHING BACK
     ====================================================================== */
  const back = await ev(() => {
    const G = window.GigaHack, F = G.forge, k = window.__regKeep;
    while (G.undo.size() > k.undo) G.undo.pop();
    window.__regRestoreActor();
    if (k.lib === null) G.store.remove('items.json');
    else G.store.write('items.json', JSON.parse(k.lib), true);
    $dataClasses.length = k.lens.classes;
    $dataCommonEvents.length = k.lens.common;
    $dataItems.length = k.lens.items;
    F.load();
    if (G.cfg.behaviour) G.cfg.behaviour.readonly = k.readonly;
    const a = $gameActors.actor(1);
    const out = {
      lib: (G.store.exists('items.json') ? JSON.stringify(G.store.read('items.json', null)) : null) === k.lib,
      lens: $dataClasses.length === k.lens.classes && $dataCommonEvents.length === k.lens.common &&
        $dataItems.length === k.lens.items,
      undo: G.undo.size() === k.undo,
      bag: JSON.stringify([$gameParty._items, $gameParty._weapons, $gameParty._armors]) === k.bag,
      actor: a._classId === k.actor.classId && a._level === k.actor.level &&
        JSON.stringify(a._exp) === k.actor.exp && a._skills.join(',') === k.actor.skills.join(',')
    };
    delete window.__regKeep; delete window.__regRestoreActor; delete window.__regRan;
    return out;
  });
  check('the regression checks put back the library, the $data arrays, the actor, the bag and the undo stack',
    back.lib && back.lens && back.undo && back.bag && back.actor, JSON.stringify(back));
};
