/* =============================================================================
   GigaHack_Kit — equipment loadouts, and an ad-hoc shop.

   The module's two claims are that it refuses BEFORE it writes and that it
   writes in an order the engine does not undo. Neither can be asserted from a
   happy path, so this file drives the fixture's disagreeing classes on purpose:
   class 2 may hold only one weapon type, class 3 has an equip type SEALED,
   class 4 has one LOCKED, and class 5 dual-wields. Those four are the whole
   permission surface, and each one produces a different sentence.

   The shop half needs one piece of fidelity core.js deliberately does not have:
   SceneManager.goto and push are modelled as RECORDERS there (core.js:344-345)
   so several areas of the suite can assert on window.__pushed, and a recorder
   never builds _nextScene — which is exactly what prepareNextScene reads. The
   two engine bodies are installed here for the length of the shop section and
   taken away again, so the module's own push-then-prepare order is measured
   against the real sequence rather than around it.

   Everything this file touches is put back: party membership, every actor's
   class, level, skills, parameter bonuses and slots, the party's item, weapon
   and armor containers, $dataSystem.equipTypes, both store files, every kit
   setting, SceneManager's scene, stack and pending scene, the compat degraded
   marks, the undo stack and the overlay's tab.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page, shot = ctx.shot;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ, MODDED = ctx.MODDED;

  const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'gigahack', 'js', 'plugins', 'GigaHack_Kit.js'), 'utf8');
  /* Comments and single-quoted strings stripped, so a rule never fires on the
     module's own prose about what it does not do. */
  const CODE = SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(\\.|[^'\\])*'/g, "''");

  /* =========================================================================
     0 — REMEMBER EVERYTHING
     ====================================================================== */
  await ev(() => {
    const G = window.GigaHack;
    const keep = window.__kitKeep = {};
    keep.actors = $gameParty._actors.slice();
    keep.items = JSON.stringify($gameParty._items);
    keep.weapons = JSON.stringify($gameParty._weapons);
    keep.armors = JSON.stringify($gameParty._armors);
    keep.equipTypes = $dataSystem.equipTypes.slice();
    keep.cfg = JSON.stringify(G.cfg.kit || {});
    keep.tab = G.cfg.ui.tab;
    keep.sub = JSON.stringify(G.cfg.ui.sub || {});
    keep.readonly = !!(G.cfg.behaviour || {}).readonly;
    keep.open = G.ui.isOpen();
    keep.actorId = G.store.cfgGet('party.actorId', 0);
    keep.battlers = {};
    for (let i = 1; i <= 6; i++) {
      const a = $gameActors.actor(i);
      if (!a) continue;
      keep.battlers[i] = {
        classId: a._classId, level: a._level, exp: JSON.stringify(a._exp),
        skills: a._skills.slice(), paramPlus: a._paramPlus.slice(),
        equips: a._equips.map(it => [it._dataClass, it._itemId])
      };
    }
    /* Every actor starts bare, so a slot that is full at the end of a section
       is this file's doing and not the fixture's. */
    window.__kitBare = function (id) {
      const a = $gameActors.actor(id);
      for (let i = 0; i < a._equips.length; i++) a._equips[i].setObject(null);
      return a;
    };
    window.__kitBag = function () {
      return JSON.stringify([$gameParty._items, $gameParty._weapons, $gameParty._armors]);
    };
    /* An accessory-etype armor and a Body-etype armor, discovered rather than
       named: the fixture's etypeIds are computed from the row id and a literal
       here would be a content id. */
    window.__kitArmorOfType = function (etypeId) {
      for (let i = 1; i < $dataArmors.length; i++) {
        if ($dataArmors[i] && $dataArmors[i].etypeId === etypeId) return $dataArmors[i];
      }
      return null;
    };
    window.__kitWeaponOfType = function (wtypeId) {
      for (let i = 1; i < $dataWeapons.length; i++) {
        if ($dataWeapons[i] && $dataWeapons[i].wtypeId === wtypeId) return $dataWeapons[i];
      }
      return null;
    };
  });

  /* =========================================================================
     1 — REGISTRATION AND THE ENGINE SURFACE
     ====================================================================== */
  const reg = await ev(() => {
    const G = window.GigaHack;
    const hooks = {};
    ['Scene_Shop.prepare (goods observer)', 'Game_Actor.changeEquip (kit)',
      'Game_Actor.releaseUnequippableItems (kit)'].forEach(n => {
        const hk = G.hooks[n];
        hooks[n] = hk ? { installed: !!hk.installed, reason: hk.reason || '', outermost: hk.installed && hk.owner[hk.method] === hk.patched } : null;
      });
    return {
      player: G.ui.panelNames('player'),
      items: G.ui.panelNames('items'),
      hooks: hooks,
      settings: Object.keys(G.kit.settingDefaults()),
      order: G.kit.applyOrder(),
      api: ['kits', 'kitSave', 'kitApply', 'shop'].filter(k => typeof G.api[k] === 'function')
    };
  });

  check('Loadouts sits between Equip and Identity on the Player tab, and Shop after Forge on Items',
    reg.player.indexOf('Loadouts') > reg.player.indexOf('Equip') &&
    reg.player.indexOf('Loadouts') < reg.player.indexOf('Identity') &&
    reg.items.indexOf('Shop') === reg.items.length - 1,
    reg.player.join(',') + ' | ' + reg.items.join(','));

  check('all three observers are installed and none of them has been patched over',
    Object.keys(reg.hooks).every(n => reg.hooks[n] && reg.hooks[n].installed && reg.hooks[n].outermost),
    JSON.stringify(reg.hooks));

  check('the apply order is exported rather than left implicit, and it is class then level then skills then equipment then bonuses',
    reg.order.join(',') === 'class,level,skills,equip,params', reg.order.join(','));

  check('every setting this module reads carries its own default, because it owns no entry in the shared table',
    reg.settings.length === 13 && reg.settings.every(k => /^(loadout|shop)\./.test(k)),
    reg.settings.join(' '));

  check('the ordering rule and the shop preflight are reachable from the console, so nothing has to grow a second copy',
    reg.api.length === 4, reg.api.join(','));

  /* =========================================================================
     2 — WHAT A KIT RECORDS

     equipSlots() is per actor and derived twice over — from
     $dataSystem.equipTypes and from the dual-wield trait — so both are moved
     here and the capture has to follow.
     ====================================================================== */
  const cap = await ev(() => {
    const G = window.GigaHack, K = G.kit;
    const out = {};
    const a1 = window.__kitBare(1);
    out.slots = a1.equipSlots().length;
    out.types = $dataSystem.equipTypes.length;
    out.captured = K.capture(a1).slots.length;

    /* Class 5 carries the dual-wield trait, so its second slot's etype becomes
       1 without the COUNT changing — the case a length test cannot catch. */
    const dw = $gameActors.actor(5);
    out.dwClass = dw._classId;
    out.dwCap = K.capture(dw).slots.map(s => s.etypeId);
    out.dwFlag = K.capture(dw).dualWield;
    out.singleCap = K.capture(a1).slots.map(s => s.etypeId);

    /* Take a whole equip type away from the project. Nothing in this module
       may notice, because equipSlots() is read live. */
    $dataSystem.equipTypes = $dataSystem.equipTypes.slice(0, 4);
    out.short = { slots: a1.equipSlots().length, captured: K.capture(a1).slots.length };
    $dataSystem.equipTypes = window.__kitKeep.equipTypes.concat(['Cloak']);
    out.long = { slots: a1.equipSlots().length, captured: K.capture(a1).slots.length };
    $dataSystem.equipTypes = window.__kitKeep.equipTypes.slice();
    return out;
  });

  check('a kit records one slot per entry in the actor\'s own equipSlots(), not a fixed five',
    cap.captured === cap.slots && cap.slots === cap.types - 1,
    'slots ' + cap.slots + ', captured ' + cap.captured + ', equipTypes ' + cap.types);

  check('and an actor whose class dual-wields records a weapon etype in the second slot, with the same slot count',
    cap.dwCap.length === cap.singleCap.length && cap.dwCap[1] === 1 && cap.singleCap[1] !== 1 && cap.dwFlag,
    'dual ' + cap.dwCap.join(',') + ' vs single ' + cap.singleCap.join(','));

  check('no part of this module assumes five equipment slots — take one away or add one and the capture follows',
    cap.short.slots === 3 && cap.short.captured === 3 &&
    cap.long.slots === cap.slots + 1 && cap.long.captured === cap.slots + 1,
    JSON.stringify(cap));

  /* =========================================================================
     3 — REFUSING BEFORE WRITING

     changeEquip's two gates are joined by && and the LEFT one has side
     effects: tradeItemWithParty has already moved the inventory by the time
     the etype comparison runs. A mismatched etype therefore duplicates the old
     item and destroys the new one, with nothing thrown and nothing returned.
     ====================================================================== */
  const ref = await ev(() => {
    const G = window.GigaHack, K = G.kit;
    const out = {};
    const a1 = window.__kitBare(1);          // class 1 — every weapon type
    const a2 = window.__kitBare(2);          // class 2 — one weapon type only
    const armor = window.__kitArmorOfType(3);
    const staff = window.__kitWeaponOfType(2);

    /* A weapon the party owns, into the weapon slot of an actor whose class
       allows it: the baseline that makes every refusal below meaningful. */
    let owned = null;
    for (const id in $gameParty._weapons) {
      const w = $dataWeapons[id];
      if (w && a1.canEquip(w)) { owned = w; break; }
    }
    out.baseline = (function () {
      const r = K.equipOne(a1, 0, owned, { force: false, provide: false });
      return { ok: r.ok, after: a1.equips()[0] === owned };
    }());
    a1.changeEquip(0, null);

    /* WRONG SLOT TYPE. An armor into the weapon slot. The bag must not move
       and changeEquip must not be called at all. */
    const bagBefore = window.__kitBag();
    const calls0 = K.equipCalls;
    const lastBefore = JSON.stringify(K.lastEquip);
    a1.changeEquip(0, owned);                       // something to displace
    const callsAfterSetup = K.equipCalls;
    const bagSetup = window.__kitBag();
    out.mismatch = (function () {
      const r = K.equipOne(a1, 0, armor, { force: true, provide: true });
      return { ok: r.ok, code: r.refusal, why: r.why };
    }());
    out.mismatchCalls = K.equipCalls - callsAfterSetup;
    out.mismatchBagMoved = window.__kitBag() !== bagSetup;
    out.mismatchStillWorn = a1.equips()[0] === owned;
    a1.changeEquip(0, null);
    out.bagRestored = window.__kitBag() === bagBefore;
    out.setupCalls = callsAfterSetup - calls0;
    out.lastMoved = JSON.stringify(K.lastEquip) !== lastBefore;

    /* NOT OWNED. An item nobody is carrying, with force and provide both off. */
    let unowned = null;
    for (let i = 1; i < $dataWeapons.length; i++) {
      const w = $dataWeapons[i];
      if (w && a1.canEquip(w) && !$gameParty.hasItem(w)) { unowned = w; break; }
    }
    const bag2 = window.__kitBag();
    const calls2 = K.equipCalls;
    out.unowned = (function () {
      const r = K.equipOne(a1, 0, unowned, { force: false, provide: false });
      return { ok: r.ok, code: r.refusal, why: r.why };
    }());
    out.unownedCalls = K.equipCalls - calls2;
    out.unownedBagMoved = window.__kitBag() !== bag2;

    /* CANNOT EQUIP. Class 2 has no trait for this weapon type. */
    out.cannot = (function () {
      const r = K.equipOne(a2, 0, staff, { force: false, provide: false });
      return { ok: r.ok, code: r.refusal, why: r.why };
    }());
    out.staffType = $dataSystem.weaponTypes[staff.wtypeId];

    /* SEALED vs LOCKED. Class 3 seals the last equip type; class 4 locks the
       Body one. canEquip consults the seal and never the lock, so force walks
       past one and is undone by the other. */
    const a3 = window.__kitBare(3);
    const a4 = window.__kitBare(4);
    const sealedType = $dataSystem.equipTypes.length - 1;
    const sealArmor = window.__kitArmorOfType(sealedType);
    const sealSlot = a3.equipSlots().indexOf(sealedType);
    out.sealed = (function () {
      const r = K.equipOne(a3, sealSlot, sealArmor, { force: false, provide: false });
      return { ok: r.ok, code: r.refusal, why: r.why };
    }());
    out.sealedForced = (function () {
      const r = K.equipOne(a3, sealSlot, sealArmor, { force: true, provide: false });
      return { ok: r.ok, code: r.refusal, why: r.why, worn: !!a3.equips()[sealSlot] };
    }());

    const lockedType = 4;
    const lockArmor = window.__kitArmorOfType(lockedType);
    const lockSlot = a4.equipSlots().indexOf(lockedType);
    out.lockedFlag = a4.isEquipTypeLocked(lockedType);
    out.lockedRefusal = K.refusal(a4, a4.equipSlots(), lockSlot, lockArmor, { force: true });
    out.lockedForced = (function () {
      const r = K.equipOne(a4, lockSlot, lockArmor, { force: true, provide: false });
      return { ok: r.ok, code: r.refusal, worn: a4.equips()[lockSlot] === lockArmor };
    }());
    out.lockNote = (function () {
      const kit = K.capture(a4);
      kit.slots[lockSlot] = { etypeId: lockedType, kind: 'armor', id: lockArmor.id, name: lockArmor.name };
      a4.forceChangeEquip(lockSlot, null);
      const rows = K.diff(a4, kit).filter(r => r.what === 'slot' && r.index === lockSlot);
      return rows.length ? rows[0].note : '';
    }());

    window.__kitBare(1); window.__kitBare(2); window.__kitBare(3); window.__kitBare(4);
    G.compat.clearDegraded('party.equip');
    return out;
  });

  check('an owned item whose type fits the slot is equipped, so every refusal below is a refusal and not an empty bag',
    ref.baseline.ok && ref.baseline.after, JSON.stringify(ref.baseline));

  check('changeEquip is never called for an item whose etypeId does not match the slot, and the party bag does not move',
    ref.mismatch.ok === false && ref.mismatch.code === 'wrong slot type' &&
    ref.mismatchCalls === 0 && !ref.mismatchBagMoved && ref.mismatchStillWorn && ref.setupCalls === 1,
    JSON.stringify({ code: ref.mismatch.code, calls: ref.mismatchCalls, bagMoved: ref.mismatchBagMoved }));

  check('and the refusal says why the write is not even attempted — the trade runs before the type test',
    /trades the item through the party/i.test(ref.mismatch.why) &&
    /both in the bag and in the slot/i.test(ref.mismatch.why), ref.mismatch.why);

  check('an item the party does not own is refused before any write, and the refusal names the two settings that would get past it',
    ref.unowned.ok === false && ref.unowned.code === 'not owned' &&
    ref.unownedCalls === 0 && !ref.unownedBagMoved &&
    /provide a missing item/.test(ref.unowned.why) && /force the slot/.test(ref.unowned.why),
    ref.unowned.why);

  check('an item the actor\'s class has no trait for is refused by weapon type NAME, not as a bare no',
    ref.cannot.ok === false && ref.cannot.code === 'cannot equip' &&
    ref.cannot.why.indexOf(ref.staffType) > -1, ref.cannot.why);

  check('a sealed equip type is named as sealed rather than folded into "cannot equip"',
    ref.sealed.ok === false && ref.sealed.code === 'slot sealed' &&
    /releaseUnequippableItems/.test(ref.sealed.why), ref.sealed.why);

  check('forcing a sealed slot is reported as released by the engine, not as applied, and the slot really is empty',
    ref.sealedForced.ok === false && ref.sealedForced.code === 'released' &&
    ref.sealedForced.worn === false && /forceChangeEquip runs releaseUnequippableItems/.test(ref.sealedForced.why),
    JSON.stringify(ref.sealedForced).slice(0, 200));

  check('forcing walks past a LOCKED slot, which is not a refusal at all — canEquip consults the seal and never the lock',
    ref.lockedFlag === true && ref.lockedRefusal === null &&
    ref.lockedForced.ok === true && ref.lockedForced.worn === true,
    JSON.stringify({ locked: ref.lockedFlag, refusal: ref.lockedRefusal, forced: ref.lockedForced }));

  check('and the difference table still says the slot is locked, because the game\'s own equip menu will refuse it',
    /locked by a trait/.test(ref.lockNote) && /changeEquip does not consult the lock/.test(ref.lockNote),
    ref.lockNote);

  /* =========================================================================
     4 — APPLYING ONE
     ====================================================================== */
  const app = await ev(() => {
    const G = window.GigaHack, K = G.kit;
    const out = {};
    const a1 = window.__kitBare(1);          // class 1, everything fits
    const a2 = window.__kitBare(2);          // class 2, one weapon type

    /* Build a kit on actor 1: a weapon actor 2's class cannot use, an armor it
       can, a skill it does not know and a parameter bonus. */
    let weapon = null;
    for (const id in $gameParty._weapons) {
      const w = $dataWeapons[id];
      if (w && a1.canEquip(w) && !a2.canEquip(w)) { weapon = w; break; }
    }
    let armor = null;
    for (const id in $gameParty._armors) {
      const r = $dataArmors[id];
      if (r && a1.canEquip(r)) { armor = r; break; }
    }
    const armorSlot = a1.equipSlots().indexOf(armor.etypeId);
    a1.changeEquip(0, weapon);
    a1.changeEquip(armorSlot, armor);
    a1.addParam(2, 25);
    a1.learnSkill(77);
    out.saved = K.save(a1, 'probe A');
    const kit = K.get('probe A');
    out.dupe = K.save(a1, 'probe A');
    out.blank = K.save(a1, '   ');
    a1.changeEquip(0, null);
    a1.changeEquip(armorSlot, null);
    a1.clearParamPlus();
    a1.forgetSkill(77);

    out.weaponName = weapon.name;
    out.weaponType = $dataSystem.weaponTypes[weapon.wtypeId];
    out.armorSlot = armorSlot;

    /* THE FULL APPLY, with the class carried across. Nothing is forced: the
       class arrives first, so the weapon the old class could not hold is
       equippable by the time the equip step runs. */
    const beforeA2 = { cls: a2._classId, lvl: a2._level, skills: a2._skills.slice(), pp: a2._paramPlus.slice() };
    const bag = window.__kitBag();
    const undo0 = G.undo.size();
    const rep = K.apply(a2, kit);
    out.undoDelta = G.undo.size() - undo0;
    out.steps = rep.steps.map(s => s.what);
    out.refused = rep.refused.length;
    out.after = {
      cls: a2._classId, lvl: a2._level, skills: a2._skills.slice(),
      pp: a2._paramPlus.slice(), eq: a2.equips().map(e => e && e.name)
    };
    out.ok = rep.ok;

    G.undo.pop();
    out.undone = {
      cls: a2._classId, lvl: a2._level, skills: a2._skills.slice(),
      pp: a2._paramPlus.slice(), eq: a2.equips().map(e => e && e.name)
    };
    out.matchesBefore = out.undone.cls === beforeA2.cls && out.undone.lvl === beforeA2.lvl &&
      out.undone.skills.join(',') === beforeA2.skills.join(',') &&
      out.undone.pp.join(',') === beforeA2.pp.join(',');
    out.bagRestored = window.__kitBag() === bag;

    /* THE SAME KIT WITHOUT THE CLASS. Now the weapon really is unequippable,
       force is on, and the engine takes it back inside forceChangeEquip —
       which is what the release observer is armed for. */
    const rep2 = K.apply(a2, kit, { applyClass: false, force: true });
    out.released = rep2.released.map(r => r.slot + ':' + r.name + ':' + r.tradedBack);
    out.releasedRefusal = rep2.refused.filter(r => r.code === 'released')
      .map(r => ({ slot: r.slot, why: r.why }));
    out.classUnmoved = a2._classId === beforeA2.cls;
    G.undo.pop();

    /* APPLYING THE SAME KIT TWICE moves nothing: a slot already holding the
       wanted record is skipped before ownership is asked about. */
    const r3 = K.apply(a1, kit);
    const bag3 = window.__kitBag();
    const calls3 = K.equipCalls;
    const r4 = K.apply(a1, kit);
    out.twice = { refused: r4.refused.length, calls: K.equipCalls - calls3, bagMoved: window.__kitBag() !== bag3 };
    G.undo.pop(); G.undo.pop();

    window.__kitBare(1); window.__kitBare(2);
    a1.clearParamPlus(); a2.clearParamPlus();
    G.compat.clearDegraded('party.equip');
    G.compat.clearDegraded('party.class');
    return out;
  });

  check('a kit name that already exists is refused rather than silently replacing the older one, and a blank name is refused too',
    app.saved.ok && !app.dupe.ok && /already exists/.test(app.dupe.why) &&
    !app.blank.ok && /the name is how you get it back/.test(app.blank.why),
    app.dupe.why + ' | ' + app.blank.why);

  check('applying a kit runs class, level, skills, equipment and bonuses in that order and in one pass',
    app.steps.join(',') === 'class,level,skills,equip,params' && app.ok && app.refused === 0,
    app.steps.join(',') + ' refused=' + app.refused);

  check('the class arrives before the equipment, so a weapon the old class could not hold still lands',
    app.after.eq[0] === app.weaponName && app.after.cls === 1,
    JSON.stringify(app.after));

  check('applying a kit is ONE undo entry, and undoing it puts back the class, the level, the skills, the bonuses and every slot',
    app.undoDelta === 1 && app.matchesBefore &&
    app.undone.eq.every(e => e === null), JSON.stringify(app.undone));

  check('and the party bag comes back with it, because a slot the apply traded is traded back',
    app.bagRestored, String(app.bagRestored));

  check('a slot the engine empties during an apply is attributed to releaseUnequippableItems by name, not left blank',
    app.released.length === 1 && app.released[0].indexOf(app.weaponName) > -1 && app.classUnmoved,
    app.released.join(' | '));

  check('and that slot is reported as released, naming the weapon type the class lacks',
    app.releasedRefusal.length === 1 &&
    app.releasedRefusal[0].why.indexOf(app.weaponType) > -1 &&
    /emptied it again inside the same call/.test(app.releasedRefusal[0].why),
    JSON.stringify(app.releasedRefusal).slice(0, 220));

  check('a slot that already holds the wanted item is skipped, so applying the same kit twice refuses nothing and moves nothing through the bag',
    app.twice.refused === 0 && app.twice.calls === 0 && !app.twice.bagMoved,
    JSON.stringify(app.twice));

  /* =========================================================================
     5 — THE THINGS A KIT CANNOT DO, SAID OUT LOUD
     ====================================================================== */
  const edge = await ev(() => {
    const G = window.GigaHack, K = G.kit;
    const out = {};
    const a1 = window.__kitBare(1);

    /* A ROW THAT HAS GONE. The kit keeps the name it was saved under as a
       tombstone, and every other slot still applies. */
    let armor = null;
    for (const id in $gameParty._armors) {
      const r = $dataArmors[id];
      if (r && a1.canEquip(r)) { armor = r; break; }
    }
    const armorSlot = a1.equipSlots().indexOf(armor.etypeId);
    const ghost = { etypeId: 1, kind: 'weapon', id: $dataWeapons.length + 400, name: 'Something Retired' };
    const kit = K.capture(a1);
    kit.name = 'probe ghost';
    kit.slots[0] = ghost;
    kit.slots[armorSlot] = { etypeId: armor.etypeId, kind: 'armor', id: armor.id, name: armor.name };
    const rep = K.apply(a1, kit);
    out.ghostRow = K.diff(a1, kit).filter(r => r.what === 'slot' && r.index === 0)
      .map(r => ({ want: r.want, code: r.refusal, why: r.why }))[0] || null;
    out.ghostRefused = rep.refused.filter(r => r.code === 'id gone')
      .map(r => ({ name: r.name, why: r.why }));
    out.otherSlotApplied = a1.equips()[armorSlot] === armor;
    G.undo.pop();

    /* MORE SLOTS THAN THE ACTOR HAS. The count is the project's, so it is the
       project that is shortened. */
    const wide = K.capture(a1);
    wide.name = 'probe wide';
    $dataSystem.equipTypes = window.__kitKeep.equipTypes.slice(0, 4);
    const narrow = K.apply(a1, wide);
    out.slotsNow = a1.equipSlots().length;
    out.dropped = narrow.dropped.map(d => ({ slot: d.slotId, why: d.why }));
    $dataSystem.equipTypes = window.__kitKeep.equipTypes.slice();
    G.undo.pop();

    /* A LEVEL ABOVE THE ACTOR'S OWN CAP. */
    const high = K.capture(a1);
    high.name = 'probe high';
    high.level = a1.maxLevel() + 51;
    const lvl = K.apply(a1, high, { applyEquip: false, applyClass: false, applySkills: false, applyParams: false });
    out.levelStep = lvl.steps.filter(s => s.what === 'level')[0] || null;
    out.levelNow = a1._level;
    out.cap = a1.maxLevel();
    G.undo.pop();

    /* A ZERO BONUS REALLY REMOVES ONE. The manual offset is cleared before the
       kit's own numbers go on; adding a difference would leave it. */
    a1.addParam(3, 40);
    const zero = K.capture(a1);
    zero.name = 'probe zero';
    zero.paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];
    const pr = K.apply(a1, zero, { applyEquip: false, applyClass: false, applySkills: false, applyLevel: false });
    out.paramAfter = a1._paramPlus.slice();
    out.paramOk = pr.steps.filter(s => s.what === 'params').map(s => s.ok)[0];
    G.undo.pop();

    /* READ-ONLY. */
    G.cfg.behaviour.readonly = true;
    const bagRO = window.__kitBag();
    const stateRO = JSON.stringify([a1._classId, a1._level, a1._skills, a1._paramPlus,
      a1.equips().map(e => e && e.id)]);
    const undoRO = G.undo.size();
    const blocked = K.apply(a1, kit);
    out.readonly = {
      blocked: blocked.blocked, message: blocked.message,
      steps: blocked.steps.length, undoMoved: G.undo.size() !== undoRO,
      bagMoved: window.__kitBag() !== bagRO,
      stateMoved: JSON.stringify([a1._classId, a1._level, a1._skills, a1._paramPlus,
        a1.equips().map(e => e && e.id)]) !== stateRO
    };
    out.roSave = K.save(a1, 'probe readonly');
    G.cfg.behaviour.readonly = window.__kitKeep.readonly;

    /* NOTHING SELECTED. */
    out.nothing = K.apply(a1, kit, {
      applyClass: false, applyLevel: false, applySkills: false, applyEquip: false, applyParams: false
    }).message;

    window.__kitBare(1);
    a1.clearParamPlus();
    G.compat.clearDegraded('party.equip');
    G.compat.clearDegraded('party.exp');
    return out;
  });

  check('a slot whose recorded id no longer resolves is reported by the name it was saved under',
    edge.ghostRow && edge.ghostRow.code === 'id gone' && edge.ghostRow.want === 'Something Retired' &&
    edge.ghostRefused.length === 1 && edge.ghostRefused[0].name === 'Something Retired',
    JSON.stringify(edge.ghostRow));

  check('and every other slot in that kit still applies',
    edge.otherSlotApplied && /Every other slot still applies/.test(edge.ghostRefused[0].why),
    edge.ghostRefused[0].why);

  check('a kit with more slots than the actor has says which ones were dropped rather than truncating in silence',
    edge.slotsNow === 3 && edge.dropped.length === 2 &&
    edge.dropped.every(d => /has nowhere to go/.test(d.why) && /3\./.test(d.why)),
    JSON.stringify(edge.dropped).slice(0, 220));

  check('a level above the actor\'s own cap reports the level that stuck and both numbers, not the one that was asked for',
    edge.levelStep && edge.levelStep.clamped === true &&
    edge.levelStep.want === edge.cap + 51 && edge.levelStep.got === edge.cap &&
    edge.levelNow === edge.cap &&
    edge.levelStep.message.indexOf(String(edge.cap + 51)) > -1 &&
    edge.levelStep.message.indexOf(String(edge.cap)) > -1,
    JSON.stringify(edge.levelStep));

  check('restoring parameter bonuses clears the manual offset first, so a kit recording a zero really removes the bonus that was there',
    edge.paramOk === true && edge.paramAfter.join(',') === '0,0,0,0,0,0,0,0',
    edge.paramAfter.join(','));

  check('a kit applied in read-only mode changes nothing at all and names the action that was refused',
    edge.readonly.blocked && edge.readonly.steps === 0 && !edge.readonly.undoMoved &&
    !edge.readonly.bagMoved && !edge.readonly.stateMoved &&
    /read-only mode is on/.test(edge.readonly.message) && /Settings/.test(edge.readonly.message) &&
    !edge.roSave.ok,
    edge.readonly.message);

  check('an apply with every "what to apply" toggle off says so instead of reporting a success that moved nothing',
    /nothing is selected to apply/.test(edge.nothing), edge.nothing);

  /* =========================================================================
     6 — VERIFY, AND WHERE THE KITS LIVE
     ====================================================================== */
  const store = await ev(() => {
    const G = window.GigaHack, K = G.kit, S = K.shop;
    const out = {};
    const a3 = window.__kitBare(3);
    const sealedType = $dataSystem.equipTypes.length - 1;
    const sealArmor = window.__kitArmorOfType(sealedType);
    const sealSlot = a3.equipSlots().indexOf(sealedType);

    G.compat.clearDegraded('party.equip');
    out.before = G.compat.isDegraded('party.equip');
    K.equipOne(a3, sealSlot, sealArmor, { force: true, provide: false });
    out.after = G.compat.isDegraded('party.equip');
    out.why = G.compat.degradedWhy('party.equip');
    G.compat.clearDegraded('party.equip');
    out.cleared = G.compat.isDegraded('party.equip');

    /* Both files are GigaHack's own, and neither is in settings.json. */
    S.clear();
    S.add($dataItems[12]);
    out.files = { kits: G.store.exists('kits.json'), goods: G.store.exists('shop.json') };
    out.cfgKit = JSON.stringify(G.cfg.kit || {});
    const names = K.list().map(k => k.name);
    const reloaded = K.reload();
    out.survives = { names: names, after: K.list().map(k => k.name), goods: reloaded.goods };
    window.__kitBare(3);
    return out;
  });

  check('every equipment write reads back through compat.verify, so a slot that did not stick marks the control and says what was read back',
    store.before === false && store.after === true &&
    /party\.equip/.test(store.why) && /read back/.test(store.why) && store.cleared === false,
    store.why.slice(0, 160));

  check('the saved kits and the goods draft are written to their own store files, not into the settings',
    store.files.kits && store.files.goods &&
    store.cfgKit.indexOf('slots') === -1 && store.cfgKit.indexOf('goods') === -1,
    JSON.stringify(store.files) + ' ' + store.cfgKit.slice(0, 120));

  check('and re-reading them from the store gives back the same kits and the same draft',
    store.survives.names.length > 0 &&
    store.survives.names.join(',') === store.survives.after.join(',') &&
    store.survives.goods === 1,
    store.survives.after.join(','));

  /* =========================================================================
     7 — THE SHOP

     core.js models SceneManager.goto and push as recorders, so _nextScene is
     never built and prepareNextScene has nothing to prepare. Both engine
     bodies go in here — MV rpg_managers.js:2074/2083, MZ
     rmmz_managers.js:2208/2217, byte-identical — and come out again below.
     ====================================================================== */
  const preflight = await ev(() => {
    const G = window.GigaHack, S = G.kit.shop;
    const out = {};
    S.clear();
    S.add($dataItems[12]);
    out.empty = (function () { S.clear(); const w = S.canOpen(); S.add($dataItems[12]); return w; }());

    out.battle = (function () {
      window.__inBattle = true;
      const w = S.canOpen();
      window.__inBattle = false;
      return w;
    }());
    out.title = (function () {
      const keep = SceneManager._scene;
      SceneManager._scene = new Scene_Title();
      const w = S.canOpen();
      SceneManager._scene = keep;
      return w;
    }());
    out.changing = (function () {
      const keep = SceneManager._nextScene;
      SceneManager._nextScene = new Scene_Shop();
      const w = S.canOpen();
      SceneManager._nextScene = keep;
      return w;
    }());
    out.message = (function () {
      window.__msgBusy = true;
      const w = S.canOpen();
      window.__msgBusy = false;
      return w;
    }());
    out.clean = S.canOpen();

    /* $gameParty is fully alive at the title — Scene_Boot.start runs
       setupNewGame() before goto(Scene_Title) on both engines — so an alive()
       test cannot catch that case and the scene identity is the only thing
       that can. */
    out.aliveAtTitle = !!($gameParty && $gameParty.members().length);
    return out;
  });

  check('the shop refuses to open from a battle, for the same reason the engine\'s own shop command does',
    /inBattle/.test(preflight.battle) && /rolled back with the battle/.test(preflight.battle),
    preflight.battle);

  check('the shop refuses to open from the title, and says the gold would be thrown away on the next new game or load',
    /not from the title/.test(preflight.title) && /thrown away/.test(preflight.title) &&
    preflight.aliveAtTitle,
    preflight.title);

  check('the shop refuses to open while a scene change is already pending, because pushing would replace it',
    /scene change is already pending/.test(preflight.changing) &&
    /one entry deeper/.test(preflight.changing), preflight.changing);

  check('a message on screen and an empty list are refusals too, and a clean state is not',
    /dismiss it first/.test(preflight.message) &&
    /add something to the list first/.test(preflight.empty) &&
    preflight.clean === null,
    JSON.stringify([preflight.message, preflight.empty, preflight.clean]));

  const noPush = await ev(() => {
    const G = window.GigaHack, S = G.kit.shop;
    /* The harness's own push is a recorder: it never builds _nextScene. That
       is exactly the shape of a plugin that replaced push or goto, and the
       module must report it rather than dereference null. */
    G.compat.clearDegraded('shop.open');
    G.store.cfgSet('kit.shop.closeOnOpen', false);
    const ok = S.open();
    return { ok: ok, why: G.compat.degradedWhy('shop.open'), open: G.ui.isOpen() };
  });

  check('a push that constructs no scene is reported instead of dereferenced, and the shop is not claimed to have opened',
    noPush.ok === false && /shop\.open/.test(noPush.why) && /read back/.test(noPush.why),
    noPush.why.slice(0, 140));

  const shop = await ev(() => {
    const G = window.GigaHack, K = G.kit, S = K.shop;
    const out = {};
    const keep = window.__kitScene = {
      push: SceneManager.push, goto: SceneManager.goto,
      scene: SceneManager._scene, next: SceneManager._nextScene, stack: SceneManager._stack.slice()
    };
    /* The engine's own bodies. MV rpg_managers.js:2074/2083, MZ
       rmmz_managers.js:2208/2217 — byte-identical apart from spelling. */
    SceneManager.goto = function (sceneClass) {
      window.__gotoScene = sceneClass && sceneClass.name;
      if (sceneClass) this._nextScene = new sceneClass();
      if (this._scene) this._scene.stop();
    };
    SceneManager.push = function (sceneClass) {
      window.__pushed = (window.__pushed && window.__pushed.concat([sceneClass.name])) || [sceneClass.name];
      this._stack.push(this._scene && this._scene.constructor);
      this.goto(sceneClass);
    };

    G.compat.clearDegraded('shop.open');
    S.clear();
    const item = $dataItems[12];
    const weapon = $dataWeapons[3];
    S.add(item);
    S.add(weapon);
    S.setPrice(1, 7);
    out.rowShape = JSON.parse(JSON.stringify(S.goods()));
    out.dbPrice = item.price;

    /* A row naming an id this build no longer defines. Window_ShopBuy drops it
       with a bare `if (item)` and the shop just opens shorter. */
    S.goods().push([1, $dataWeapons.length + 400, 0, 0]);
    const res = S.resolve();
    out.resolved = { rows: res.rows.length, dropped: res.dropped.length, why: (res.dropped[0] || {}).why };

    G.ui.setOpen(true);
    out.opened = S.open();
    const next = SceneManager._nextScene;
    out.prepared = next && next._goods ? JSON.parse(JSON.stringify(next._goods)) : null;
    out.purchaseOnly = next ? next._purchaseOnly : null;
    out.stackDepth = SceneManager._stack.length - keep.stack.length;
    out.pushedThenPrepared = !!(next && next instanceof Scene_Shop && next._goods);
    out.observer = K.lastShop ? { n: K.lastShop.goods.length, ours: K.lastShop.ours } : null;
    out.degraded = G.compat.isDegraded('shop.open');
    out.stillOpen = G.ui.isOpen();

    /* The engine's own reader for the goods contract. MZ takes a Rectangle and
       is stocked afterwards; MV takes the goods in its constructor. */
    let win;
    if (typeof Window_ShopBuy.prototype.setupGoods === 'function') {
      win = new Window_ShopBuy({ x: 0, y: 0, width: 400, height: 200 });
      win.setupGoods(next._goods);
    } else {
      win = new Window_ShopBuy(0, 0, 200, next._goods);
    }
    out.buy = win._data.map((it, i) => [it.name, win._price[i]]);

    /* Capturing what a shop carried turns any shop in the game into a draft. */
    S.clear();
    out.captured = S.captureLast();
    out.capturedRows = JSON.parse(JSON.stringify(S.goods()));

    /* Closing the overlay is a setting, and it is honoured. The pending scene
       from the push above has to go first, or the preflight refuses this one
       for the very reason section 7 asserts it should. */
    SceneManager._nextScene = null;
    G.store.cfgSet('kit.shop.closeOnOpen', true);
    G.ui.setOpen(true);
    out.openedAgain = S.open();
    out.closedAfter = G.ui.isOpen();
    G.store.cfgSet('kit.shop.closeOnOpen', false);

    SceneManager.push = keep.push;
    SceneManager.goto = keep.goto;
    SceneManager._scene = keep.scene;
    SceneManager._nextScene = keep.next;
    SceneManager._stack = keep.stack;
    G.compat.clearDegraded('shop.open');
    return out;
  });

  check('a goods row is exactly [type, id, priceType, price] on both engines',
    shop.rowShape.length === 2 &&
    shop.rowShape.every(r => r.length === 4 && r.every(n => typeof n === 'number')),
    JSON.stringify(shop.rowShape));

  check('a row left at the database price emits priceType 0, and a row given a number emits priceType 1 with that number',
    shop.rowShape[0][2] === 0 && shop.rowShape[0][3] === 0 &&
    shop.rowShape[1][2] === 1 && shop.rowShape[1][3] === 7,
    JSON.stringify(shop.rowShape));

  check('a goods row whose id does not resolve is dropped before the scene is pushed and named, because the buy window would have dropped it without a word',
    shop.resolved.rows === 2 && shop.resolved.dropped === 1 &&
    /without a word/.test(shop.resolved.why) &&
    shop.prepared.length === 2,
    shop.resolved.why);

  check('the shop is pushed and only then prepared, because prepareNextScene reads the scene the push just constructed',
    shop.opened === true && shop.pushedThenPrepared && shop.stackDepth === 1 && !shop.degraded,
    JSON.stringify({ opened: shop.opened, depth: shop.stackDepth, degraded: shop.degraded }));

  check('and the goods reach the scene unchanged, which is what the goods observer reads back for verify',
    JSON.stringify(shop.prepared) === JSON.stringify(shop.rowShape) &&
    shop.observer && shop.observer.n === 2 && shop.observer.ours === true &&
    shop.purchaseOnly === false,
    JSON.stringify(shop.observer));

  check('the engine\'s own buy window reads back the item and the price the panel showed, database price and override alike',
    shop.buy.length === 2 && shop.buy[0][1] === shop.dbPrice && shop.buy[1][1] === 7,
    JSON.stringify(shop.buy));

  check('the shop the game last opened can be captured back into the draft, row for row',
    shop.captured.ok && shop.captured.rows === 2 &&
    JSON.stringify(shop.capturedRows) === JSON.stringify(shop.prepared),
    JSON.stringify(shop.capturedRows));

  check('the overlay stays open with the setting off and closes with it on, so the shop is not hidden behind the menu',
    shop.stillOpen === true && shop.openedAgain === true && shop.closedAfter === false,
    JSON.stringify([shop.stillOpen, shop.openedAgain, shop.closedAfter]));

  /* =========================================================================
     8 — THE PICKERS AND THE PANELS
     ====================================================================== */
  const pick = await ev(() => {
    const G = window.GigaHack, S = G.kit.shop;
    const out = {};
    out.same = S.pool('item', '').length === G.inv.list('item').length;
    /* A row the Forge could have added. The picker must see it without a scan
       of its own, because it asks the inventory module rather than $data*. */
    const id = $dataItems.length;
    const before = S.pool('item', '').length;
    $dataItems.push({
      id: id, name: 'Forged Probe Widget', iconIndex: 1, price: 5, itypeId: 1,
      description: '', params: null, note: ''
    });
    const after = S.pool('item', '');
    out.grew = after.length === before + 1 &&
      after.length === G.inv.list('item').length &&
      after.filter(o => o.name === 'Forged Probe Widget').length === 1;
    $dataItems.pop();
    out.shrank = S.pool('item', '').length === before;

    /* A search the index CAN answer still resolves each candidate against the
       live row rather than trusting the index. */
    const probe = $dataItems[12];
    const hits = S.pool('item', probe.name.toLowerCase());
    out.search = { n: hits.length, has: hits.indexOf(probe) > -1, why: S.searchWhy };
    return out;
  });

  check('the item pickers are built from the inventory module\'s list, so a database the Forge has extended appears without a second scan',
    pick.same && pick.grew && pick.shrank, JSON.stringify(pick));

  check('and a search resolves every candidate back to the live database row rather than trusting the index',
    pick.search.n >= 1 && pick.search.has, JSON.stringify(pick.search));

  const panels = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    function show(tab, sub) {
      G.cfg.ui.tab = tab;
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub[tab] = sub;
      G.ui.rerender();
      const root = document.querySelector('#mm-root .mm-body');
      return root ? root.textContent : '';
    }
    out.loadouts = show('player', 'Loadouts');
    out.shop = show('items', 'Shop');
    /* No unbounded string may push its label out of a row. */
    const rows = document.querySelectorAll('#mm-root .mm-row');
    let overflow = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].scrollWidth > rows[i].clientWidth + 1) overflow++;
    }
    out.overflow = overflow;
    out.tables = document.querySelectorAll('#mm-root .mm-table').length;
    return out;
  });

  check('the Loadouts panel says where kits live and what force does not do',
    /kits\.json/.test(panels.loadouts) &&
    /does not ignore a SEALED slot/.test(panels.loadouts) &&
    /class, level, skills, equipment, bonuses/.test(panels.loadouts),
    panels.loadouts.slice(0, 90));

  check('the Shop panel says there is no shop object and what a goods row is',
    /no shop object/.test(panels.shop) &&
    /\[type, id, priceType, price\]/.test(panels.shop) &&
    panels.tables >= 2,
    panels.shop.slice(0, 90));

  check('no row in either panel is pushed sideways by an unbounded name',
    panels.overflow === 0, String(panels.overflow));

  await shot('kit-shop');
  await ev(() => {
    window.GigaHack.cfg.ui.tab = 'player';
    window.GigaHack.cfg.ui.sub.player = 'Loadouts';
    window.GigaHack.ui.rerender();
  });
  await shot('kit-loadouts');

  /* =========================================================================
     9 — THE SOURCE ITSELF
     ====================================================================== */
  check('the module never assigns a prototype method directly — every observer goes through $.install with a reason',
    !/\bGame_Actor\.prototype\.[A-Za-z]+\s*=/.test(CODE) &&
    !/\bScene_Shop\.prototype\.[A-Za-z]+\s*=/.test(CODE) &&
    (SRC.match(/\$\.install\(/g) || []).length === 3,
    String((SRC.match(/\$\.install\(/g) || []).length));

  check('nothing in it branches on the engine version — the shop and the slots ask the objects in front of them',
    !/caps\.(isMV|isMZ|engineVersion)/.test(CODE) && !/RPGMAKER_VERSION/.test(CODE),
    'clean');

  check('the release observer\'s unarmed path is one boolean test before it delegates, because it rides on refresh()',
    /if \(!releaseWatch \|\| releaseWatch\.actor !== this\) return original\.apply\(this, arguments\);/.test(SRC),
    'guarded');

  check('and the arming flag is closed in a finally, so a throw during an apply cannot leave it on for the session',
    /\} finally \{\s*releaseWatch = null;\s*\}/.test(SRC), 'closed');

  /* =========================================================================
     10 — PUT IT ALL BACK
     ====================================================================== */
  const restored = await ev(() => {
    const G = window.GigaHack, K = G.kit;
    const keep = window.__kitKeep;

    K.shop.clear();
    K.list().forEach(k => K.remove(k.name));
    G.store.remove('kits.json');
    G.store.remove('shop.json');
    K.reload();

    $gameParty._actors = keep.actors.slice();
    $gameParty._items = JSON.parse(keep.items);
    $gameParty._weapons = JSON.parse(keep.weapons);
    $gameParty._armors = JSON.parse(keep.armors);
    $dataSystem.equipTypes = keep.equipTypes.slice();

    Object.keys(keep.battlers).forEach(id => {
      const a = $gameActors.actor(Number(id));
      const b = keep.battlers[id];
      a._classId = b.classId;
      a._level = b.level;
      a._exp = JSON.parse(b.exp);
      a._skills = b.skills.slice();
      a._paramPlus = b.paramPlus.slice();
      for (let i = 0; i < a._equips.length; i++) {
        a._equips[i]._dataClass = b.equips[i] ? b.equips[i][0] : '';
        a._equips[i]._itemId = b.equips[i] ? b.equips[i][1] : 0;
      }
    });

    G.cfg.kit = JSON.parse(keep.cfg);
    G.cfg.behaviour.readonly = keep.readonly;
    G.store.cfgSet('party.actorId', keep.actorId);
    ['party.equip', 'party.class', 'party.skills', 'party.exp', 'party.param', 'shop.open']
      .forEach(c => G.compat.clearDegraded(c));
    G.undo.clear();
    K.lastShop = null;
    K.lastEquip = null;
    K.lastReport = null;

    G.cfg.ui.tab = keep.tab;
    G.cfg.ui.sub = JSON.parse(keep.sub);
    G.ui.setOpen(keep.open);
    G.ui.rerender();

    const scene = window.__kitScene || {};
    return {
      actors: $gameParty._actors.join(',') === keep.actors.join(','),
      bag: window.__kitBag() === JSON.stringify([JSON.parse(keep.items), JSON.parse(keep.weapons), JSON.parse(keep.armors)]),
      types: $dataSystem.equipTypes.length === keep.equipTypes.length,
      equips: Object.keys(keep.battlers).every(id => {
        const a = $gameActors.actor(Number(id));
        return a.equips().every(e => e === null || e === undefined) ||
          keep.battlers[id].equips.some(p => p[1] > 0);
      }),
      kits: K.list().length,
      goods: K.shop.goods().length,
      degraded: G.compat.degradedList().filter(d => /party\.|shop\./.test(d.control)).length,
      pushIsRecorder: SceneManager.push === scene.push || !scene.push,
      nextScene: SceneManager._nextScene === (scene.next === undefined ? SceneManager._nextScene : scene.next),
      readonly: !!G.cfg.behaviour.readonly,
      undo: G.undo.size()
    };
  });

  check('kit leaves the game exactly as it found it — the party, the bag, the slot table, the kits, the draft and the scene stack',
    restored.actors && restored.bag && restored.types && restored.equips &&
    restored.kits === 0 && restored.goods === 0 && restored.degraded === 0 &&
    restored.pushIsRecorder && restored.nextScene && !restored.readonly && restored.undo === 0,
    JSON.stringify(restored));
};
