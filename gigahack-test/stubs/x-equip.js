/* =============================================================================
   GigaHack test harness — stubs/x-equip.js
   EQUIPMENT, PARTY INVENTORY and the SHOP. Everything that is IDENTICAL on
   RPG Maker MV 1.6.1 and MZ 1.9.0.

   Copied from the shipped engine source, awkward parts included, with the
   file:line each group came from. MV = /root/work/mv/js/rpg_*.js,
   MZ = /root/work/mz/js/rmmz_*.js. A single reference means the two engines
   are byte-identical there apart from var/let and function/arrow spelling;
   this file is ES5 because the harness runs on the same floor as the mod, so
   MZ's arrows and spreads are written out longhand and each such rewrite is
   named in the comment above it.

   Loaded IMMEDIATELY AFTER core.js, so it may only reach what core.js
   defines. engine-mv.js / engine-mz.js have NOT run yet: nothing here may
   touch Utils.RPGMAKER_NAME, Window_Base, ColorManager or Array.prototype
   .contains. The divergent halves live in x-equip-mv.js / x-equip-mz.js,
   which load immediately after their engine file.

   WHAT core.js ALREADY MODELS AND THIS FILE DOES NOT REDEFINE
     · Game_Item's constructor, isSkill/isItem/isWeapon/isArmor, object,
       setObject (core.js:807-826) — the missing five members are added below.
     · Game_Party.numItems (core.js:987) — already the engine body verbatim.
     · Game_Party.itemContainer / items / weapons / armors (core.js:972-986).
     · Game_BattlerBase's hp/mp funnels, Game_Actor's identity fields, the
       Game_Actor -> Game_BattlerBase prototype link (core.js:1289).
     · Scene_Base's isActive/isBusy/create/start/update/terminate, and
       SceneManager.goto / push as RECORDERS (core.js:344-345).

   WHAT THIS FILE DELIBERATELY REPLACES
     Three core.js stubs are placeholders that the equipment surface cannot be
     tested against, and the engine bodies are installed over them here. Each
     is flagged at its definition:
       Game_Actor.equipSlots      core.js:896  — returned a literal [1,2,3,4,5]
       Game_Actor.equips          core.js:895  — right shape, restated with the
                                                 rest of the block for one read
       Game_Actor.forceChangeEquip core.js:897 — omitted releaseUnequippableItems
       Game_Party.gainItem        core.js:988  — omitted includeEquip and the
                                                 $gameMap.requestRefresh() call
     The replacements are LOUDER than the originals, not quieter: equipSlots
     now depends on $dataSystem.equipTypes and on isDualWield, gainItem now
     bumps window.__refreshes on every call, and forceChangeEquip can now empty
     a slot it was handed. All three are what the engine does.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Game_Item — the five members core.js left out.
   MV rpg_objects.js:1125-1147 / MZ rmmz_objects.js:1343-1365.

   setEquip is the one that matters. initEquips fills a slot with
   setEquip(slots[j] === 1, equips[j]) — an (isWeapon, id) PAIR, never a data
   object — so a slot can name a weapon id that $dataWeapons has no entry for
   and object() answers undefined rather than throwing. Anything that scrubs a
   save has to be able to reach that state; a stub with only setObject cannot
   build it, because setObject asks DataManager which container the object
   lives in and a nonexistent object lives in none.
   ---------------------------------------------------------------------- */
Game_Item.prototype.isUsableItem = function () {          /* MV :1125 / MZ :1343 */
  return this.isSkill() || this.isItem();
};
Game_Item.prototype.isEquipItem = function () {           /* MV :1137 / MZ :1355 */
  return this.isWeapon() || this.isArmor();
};
Game_Item.prototype.isNull = function () {                /* MV :1141 / MZ :1359 */
  return this._dataClass === '';
};
Game_Item.prototype.itemId = function () {                /* MV :1145 / MZ :1363 */
  return this._itemId;
};
Game_Item.prototype.setEquip = function (isWeapon, itemId) { /* MV :1178 / MZ :1396 */
  this._dataClass = isWeapon ? 'weapon' : 'armor';
  this._itemId = itemId;
};

/* -------------------------------------------------------------------------
   Game_BattlerBase.TRAIT_* — MV rpg_objects.js:2094-2117 / MZ :2390-2414.

   Copied in full rather than trimmed to the equip four, because the codes are
   a contiguous table and the gaps in it are meaningful: a reader that assumes
   51..55 are "the equip block" and 61.. are "the rest" is right, and a reader
   that assumes the table is dense is wrong. MZ inserted TRAIT_ATTACK_SKILL=35
   into the gap after 34, and MV has NO 35 — that one constant is defined in
   x-equip-mz.js and nowhere else, so a mod that renders trait code 35 by name
   on MV reads undefined and says so.
   ---------------------------------------------------------------------- */
Game_BattlerBase.TRAIT_ELEMENT_RATE = 11;
Game_BattlerBase.TRAIT_DEBUFF_RATE = 12;
Game_BattlerBase.TRAIT_STATE_RATE = 13;
Game_BattlerBase.TRAIT_STATE_RESIST = 14;
Game_BattlerBase.TRAIT_PARAM = 21;
Game_BattlerBase.TRAIT_XPARAM = 22;
Game_BattlerBase.TRAIT_SPARAM = 23;
Game_BattlerBase.TRAIT_ATTACK_ELEMENT = 31;
Game_BattlerBase.TRAIT_ATTACK_STATE = 32;
Game_BattlerBase.TRAIT_ATTACK_SPEED = 33;
Game_BattlerBase.TRAIT_ATTACK_TIMES = 34;
/* 35 is MZ-only. See x-equip-mz.js. */
Game_BattlerBase.TRAIT_STYPE_ADD = 41;
Game_BattlerBase.TRAIT_STYPE_SEAL = 42;
Game_BattlerBase.TRAIT_SKILL_ADD = 43;
Game_BattlerBase.TRAIT_SKILL_SEAL = 44;
Game_BattlerBase.TRAIT_EQUIP_WTYPE = 51;
Game_BattlerBase.TRAIT_EQUIP_ATYPE = 52;
Game_BattlerBase.TRAIT_EQUIP_LOCK = 53;
Game_BattlerBase.TRAIT_EQUIP_SEAL = 54;
Game_BattlerBase.TRAIT_SLOT_TYPE = 55;
Game_BattlerBase.TRAIT_ACTION_PLUS = 61;
Game_BattlerBase.TRAIT_SPECIAL_FLAG = 62;
Game_BattlerBase.TRAIT_COLLAPSE_TYPE = 63;
Game_BattlerBase.TRAIT_PARTY_ABILITY = 64;

/* -------------------------------------------------------------------------
   The trait pipeline — MV rpg_objects.js:2369-2413 / MZ :2816-2849.

   allTraits() concatenates obj.traits with NO guard, so a database record
   without a `traits` array poisons the whole list with an undefined entry and
   the next .filter throws inside the engine. That is the real behaviour and it
   is left in: every stock $dataActors / $dataClasses / $dataWeapons /
   $dataArmors / $dataStates record ships a traits array, and a Forge that
   writes a record without one has made a genuinely broken record.

   traitObjects() on the BASE is "states only" — the engine's own comment. Each
   subclass appends its own records; Game_Actor's version is per engine because
   the two build the array differently (see x-equip-mv.js / x-equip-mz.js).
   ---------------------------------------------------------------------- */
Game_BattlerBase.prototype.traitObjects = function () {   /* MV :2369 / MZ :2816 */
  // Returns an array of the all objects having traits. States only here.
  return this.states();
};
Game_BattlerBase.prototype.allTraits = function () {      /* MV :2374 / MZ :2821 */
  return this.traitObjects().reduce(function (r, obj) {
    return r.concat(obj.traits);
  }, []);
};
Game_BattlerBase.prototype.traits = function (code) {     /* MV :2380 / MZ :2825 */
  return this.allTraits().filter(function (trait) {
    return trait.code === code;
  });
};
Game_BattlerBase.prototype.traitsWithId = function (code, id) { /* MV :2386 / MZ :2829 */
  return this.allTraits().filter(function (trait) {
    return trait.code === code && trait.dataId === id;
  });
};
/* traitsPi / traitsSum / traitsSumAll are here because they are the same
   block and share allTraits' behaviour. Note this puts traitsPi on
   Game_BattlerBase.prototype, where Game_Actor inherits it; core.js:1260
   already gives Game_Enemy its OWN traitsPi that reads enemy().traits
   directly, and that own property still wins for enemies. */
Game_BattlerBase.prototype.traitsPi = function (code, id) {    /* MV :2392 / MZ :2835 */
  return this.traitsWithId(code, id).reduce(function (r, trait) {
    return r * trait.value;
  }, 1);
};
Game_BattlerBase.prototype.traitsSum = function (code, id) {   /* MV :2398 / MZ :2839 */
  return this.traitsWithId(code, id).reduce(function (r, trait) {
    return r + trait.value;
  }, 0);
};
Game_BattlerBase.prototype.traitsSumAll = function (code) {    /* MV :2404 / MZ :2843 */
  return this.traits(code).reduce(function (r, trait) {
    return r + trait.value;
  }, 0);
};
/* traitsSet CONCATS dataId, it does not push — so a trait whose dataId is
   itself an array would flatten one level. Kept verbatim. */
Game_BattlerBase.prototype.traitsSet = function (code) {       /* MV :2410 / MZ :2847 */
  return this.traits(code).reduce(function (r, trait) {
    return r.concat(trait.dataId);
  }, []);
};

/* -------------------------------------------------------------------------
   slotType / isDualWield — MV rpg_objects.js:2538-2545 / MZ :2978-2985.

   The bodies differ only in how the maximum is taken: MV writes
   `Math.max.apply(null, set)` and MZ writes `Math.max(...set)`. Identical
   results, and the harness floor is ES5, so the MV spelling is the one here.
   The `set.length > 0` guard is load-bearing on BOTH: Math.max of an empty
   spread is -Infinity, and slot type 0 (not dual wield) is the answer.

   isDualWield is what turns equipSlots' second slot from "shield" into
   "second weapon", so it is the switch that makes slot 1 hold a WEAPON on a
   project whose equipTypes[2] says otherwise.
   ---------------------------------------------------------------------- */
Game_BattlerBase.prototype.slotType = function () {
  var set = this.traitsSet(Game_BattlerBase.TRAIT_SLOT_TYPE);
  return set.length > 0 ? Math.max.apply(null, set) : 0;
};
Game_BattlerBase.prototype.isDualWield = function () {
  return this.slotType() === 1;
};

/* -------------------------------------------------------------------------
   canEquip — MV rpg_objects.js:2808-2826 / MZ :3260-3284, byte-identical
   apart from MZ's line wrapping.

   canEquip asks DataManager which CONTAINER the item lives in, not what
   fields it has. An item forged as a plain object and never filed under
   $dataWeapons/$dataArmors falls through both branches and answers false, so
   it can never be equipped even though it has a wtypeId — which is the same
   identity rule core.js:416-419 documents.

   Note what canEquipWeapon does NOT check: it tests isEquipTypeSealed, and
   never isEquipTypeLocked. Sealed forbids equipping; LOCKED forbids CHANGING
   an existing slot and is checked in Game_Actor.isEquipChangeOk instead. A
   stub that folded the two would make a locked slot look unequippable and an
   equip-sealed one look editable — exactly backwards.
   ---------------------------------------------------------------------- */
Game_BattlerBase.prototype.canEquip = function (item) {
  if (!item) {
    return false;
  } else if (DataManager.isWeapon(item)) {
    return this.canEquipWeapon(item);
  } else if (DataManager.isArmor(item)) {
    return this.canEquipArmor(item);
  } else {
    return false;
  }
};
Game_BattlerBase.prototype.canEquipWeapon = function (item) {
  return this.isEquipWtypeOk(item.wtypeId) && !this.isEquipTypeSealed(item.etypeId);
};
Game_BattlerBase.prototype.canEquipArmor = function (item) {
  return this.isEquipAtypeOk(item.atypeId) && !this.isEquipTypeSealed(item.etypeId);
};
/* isEquipWtypeOk / isEquipAtypeOk / isEquipTypeLocked / isEquipTypeSealed are
   NOT here. Their four bodies are one line each and differ by exactly one
   token — MV's Array.prototype.contains against MZ's native includes — so
   they live in x-equip-mv.js and x-equip-mz.js. Flattening them to one
   version would erase the only place in this whole area where MV needs an
   engine-supplied Array extension that MZ does not have. */

/* -------------------------------------------------------------------------
   Game_Actor — the equipment block.
   MV rpg_objects.js:3571-3727 / MZ rmmz_objects.js:4213-4373.
   ---------------------------------------------------------------------- */

/* initEquips — MV :3571 / MZ :4213. REPLACES the slot array wholesale, sized
   from equipSlots(), then fills it with setEquip(isWeapon, id) PAIRS, then
   releases with forcing=true (no trade back to the party — these items were
   never in it), then refreshes. The `if (j < maxSlots)` drops any surplus
   entry in the actor's database `equips` array silently. */
Game_Actor.prototype.initEquips = function (equips) {
  var slots = this.equipSlots();
  var maxSlots = slots.length;
  this._equips = [];
  for (var i = 0; i < maxSlots; i++) {
    this._equips[i] = new Game_Item();
  }
  for (var j = 0; j < equips.length; j++) {
    if (j < maxSlots) {
      this._equips[j].setEquip(slots[j] === 1, equips[j]);
    }
  }
  this.releaseUnequippableItems(true);
  this.refresh();
};

/* equipSlots — MV :3587 / MZ :4229. REPLACES core.js:896's literal
   [1, 2, 3, 4, 5]. The real one is DERIVED, twice over:
     · its length is $dataSystem.equipTypes.length - 1, so a project with a
       sixth equip type has six slots and a five-slot _equips array is short;
     · slots[1] becomes 1 when the actor is dual-wielding, so the second slot
       holds a WEAPON whose etypeId is 1 while equipTypes[2] still reads
       "Shield". changeEquip compares `equipSlots()[slotId] === item.etypeId`,
       so this is the line that decides whether a shield can go there at all.
   Index 0 is skipped because equipTypes[0] is the empty placeholder. */
Game_Actor.prototype.equipSlots = function () {
  var slots = [];
  for (var i = 1; i < $dataSystem.equipTypes.length; i++) {
    slots.push(i);
  }
  if (slots.length >= 2 && this.isDualWield()) {
    slots[1] = 1;
  }
  return slots;
};

/* equips / weapons / armors — MV :3598-3616 / MZ :4240-4252. equips() is the
   same body core.js:895 already has; it is restated so the block reads as one
   piece and so the two filters below sit next to what they filter. */
Game_Actor.prototype.equips = function () {
  return this._equips.map(function (item) {
    return item.object();
  });
};
Game_Actor.prototype.weapons = function () {
  return this.equips().filter(function (item) {
    return item && DataManager.isWeapon(item);
  });
};
Game_Actor.prototype.armors = function () {
  return this.equips().filter(function (item) {
    return item && DataManager.isArmor(item);
  });
};
/* hasWeapon / hasArmor / isEquipped are per engine — contains vs includes. */

/* isEquipChangeOk — MV :3624 / MZ :4260. LOCKED or SEALED both refuse, and
   both are asked about equipSlots()[slotId] — the slot's etype, NOT the
   equipped item's. A dual-wield slot 1 therefore asks about etype 1. */
Game_Actor.prototype.isEquipChangeOk = function (slotId) {
  return (!this.isEquipTypeLocked(this.equipSlots()[slotId]) &&
          !this.isEquipTypeSealed(this.equipSlots()[slotId]));
};

/* changeEquip — MV :3629 / MZ :4267. Two gates, and the ORDER is the whole
   story: tradeItemWithParty runs FIRST and has already moved gold-equivalent
   inventory by the time the etypeId test is evaluated. If the trade succeeds
   and the etype does not match, the party has gained the old item and lost
   the new one and the slot is UNCHANGED — the engine's own leak, kept.
   Note it does NOT consult isEquipChangeOk: a locked slot can still be
   changed through this path. Only the menu window asks that question. */
Game_Actor.prototype.changeEquip = function (slotId, item) {
  if (this.tradeItemWithParty(item, this.equips()[slotId]) &&
      (!item || this.equipSlots()[slotId] === item.etypeId)) {
    this._equips[slotId].setObject(item);
    this.refresh();
  }
};

/* forceChangeEquip — MV :3637 / MZ :4277. REPLACES core.js:897, which set the
   slot and refreshed. The engine also calls releaseUnequippableItems(true) in
   between, so forcing an item the actor cannot equip sets the slot and then
   IMMEDIATELY empties it again — force does not mean "ignore the rules", it
   means "skip the party trade". A stub without that middle line makes an
   impossible equip look like it stuck. */
Game_Actor.prototype.forceChangeEquip = function (slotId, item) {
  this._equips[slotId].setObject(item);
  this.releaseUnequippableItems(true);
  this.refresh();
};

/* tradeItemWithParty — MV :3643 / MZ :4283. hasItem is called with ONE
   argument, so includeEquip is falsy and an item that exists only on another
   actor's body does not count as owned. gainItem(oldItem) runs before
   loseItem(newItem), and both tolerate null. */
Game_Actor.prototype.tradeItemWithParty = function (newItem, oldItem) {
  if (newItem && !$gameParty.hasItem(newItem)) {
    return false;
  } else {
    $gameParty.gainItem(oldItem, 1);
    $gameParty.loseItem(newItem, 1);
    return true;
  }
};

/* changeEquipById — MV :3653 / MZ :4293. slotId is etypeId - 1, which is only
   correct while the slot order matches the etype order; the dual-wield slot 1
   is exactly where it stops being correct, and the engine then reads
   $dataWeapons for what the caller meant as an armor. Kept. */
Game_Actor.prototype.changeEquipById = function (etypeId, itemId) {
  var slotId = etypeId - 1;
  if (this.equipSlots()[slotId] === 1) {
    this.changeEquip(slotId, $dataWeapons[itemId]);
  } else {
    this.changeEquip(slotId, $dataArmors[itemId]);
  }
};

/* discardEquip — MV :3665 / MZ :4306. indexOf on the OBJECT, so it clears the
   first slot holding that exact record and silently does nothing for a
   detached copy. */
Game_Actor.prototype.discardEquip = function (item) {
  var slotId = this.equips().indexOf(item);
  if (slotId >= 0) {
    this._equips[slotId].setObject(null);
  }
};

/* releaseUnequippableItems — MV :3673 / MZ :4313. An UNBOUNDED `for (;;)` that
   re-reads equipSlots() and equips() every pass and only stops when a full
   sweep changes nothing. Two conditions empty a slot: the actor can no longer
   equip the item, or the item's etypeId no longer matches the slot's type —
   the second is what fires when isDualWield flips and slot 1 stops being a
   shield slot. forcing=false trades each released item back to the party;
   forcing=true drops it. Left as a bare infinite loop because it is one: a
   trait table that makes an item both equippable and mismatched would spin
   here in the real engine too. */
Game_Actor.prototype.releaseUnequippableItems = function (forcing) {
  for (;;) {
    var slots = this.equipSlots();
    var equips = this.equips();
    var changed = false;
    for (var i = 0; i < equips.length; i++) {
      var item = equips[i];
      if (item && (!this.canEquip(item) || item.etypeId !== slots[i])) {
        if (!forcing) {
          this.tradeItemWithParty(null, item);
        }
        this._equips[i].setObject(null);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
};

/* clearEquipments / optimizeEquipments — MV :3694/:3703 / MZ :4334/:4343.
   Both skip slots isEquipChangeOk refuses, which is the ONLY place in the
   equip surface where a locked slot is honoured. */
Game_Actor.prototype.clearEquipments = function () {
  var maxSlots = this.equipSlots().length;
  for (var i = 0; i < maxSlots; i++) {
    if (this.isEquipChangeOk(i)) {
      this.changeEquip(i, null);
    }
  }
};
Game_Actor.prototype.optimizeEquipments = function () {
  var maxSlots = this.equipSlots().length;
  this.clearEquipments();
  for (var i = 0; i < maxSlots; i++) {
    if (this.isEquipChangeOk(i)) {
      this.changeEquip(i, this.bestEquipItem(i));
    }
  }
};

/* bestEquipItem — MV :3713 / MZ :4353. Searches only $gameParty.equipItems(),
   never the database, so the "best" item is the best one the party is
   CARRYING. bestPerformance starts at -1000, not 0 or -Infinity: an item whose
   params sum below -1000 can never be chosen and null is returned instead.
   MV passes `this` as filter's thisArg; MZ uses an arrow. Same thing. */
Game_Actor.prototype.bestEquipItem = function (slotId) {
  var etypeId = this.equipSlots()[slotId];
  var items = $gameParty.equipItems().filter(function (item) {
    return item.etypeId === etypeId && this.canEquip(item);
  }, this);
  var bestItem = null;
  var bestPerformance = -1000;
  for (var i = 0; i < items.length; i++) {
    var performance = this.calcEquipItemPerformance(items[i]);
    if (performance > bestPerformance) {
      bestPerformance = performance;
      bestItem = items[i];
    }
  }
  return bestItem;
};
/* calcEquipItemPerformance — MV :3729 / MZ :4373. reduce with NO initial
   value, so a params array of length 1 returns that element untouched and an
   EMPTY params array throws TypeError inside the engine. Kept. */
Game_Actor.prototype.calcEquipItemPerformance = function (item) {
  return item.params.reduce(function (a, b) {
    return a + b;
  });
};

/* -------------------------------------------------------------------------
   Game_Party — the inventory members equipment trades against.
   MV rpg_objects.js:4846-5019 / MZ rmmz_objects.js:5490-5669.

   numItems is NOT redefined: core.js:987 already carries the engine body.
   hasItem, isAnyMemberEquipped and maxItems are per engine and live in the
   two sibling files.
   ---------------------------------------------------------------------- */
/* equipItems — MV :4846 / MZ :5490. weapons() first, then armors(), and both
   map ids through $data* with no guard (core.js:984-985), so a party holding
   an id with no definition puts `undefined` in this list and bestEquipItem's
   filter throws reading .etypeId off it. That is the engine. */
Game_Party.prototype.equipItems = function () {
  return this.weapons().concat(this.armors());
};

/* hasMaxItems — MV :4968 / MZ :5624. Window_ShopBuy.isEnabled calls it, so a
   full stack greys the row out no matter how much gold is on hand. */
Game_Party.prototype.hasMaxItems = function (item) {
  return this.numItems(item) >= this.maxItems(item);
};

/* gainItem — MV :4991 / MZ :5641. REPLACES core.js:988, which clamped and
   deleted but did neither of the two things that make this method
   interesting:
     · includeEquip. A negative result does NOT stop at zero owned copies —
       it calls discardMembersEquip and strips the shortfall off the party's
       BODIES. loseItem(item, n, true) can therefore unequip people.
     · $gameMap.requestRefresh(). Every single gainItem bumps the map refresh
       request, which is why a bulk "give 400 items" loop is not free.
   Both restored. Note the clamp is Number.prototype.clamp (core.js:94) and
   the zero-delete runs before the discard, so container[item.id] is already
   gone by the time bodies are stripped. */
Game_Party.prototype.gainItem = function (item, amount, includeEquip) {
  var container = this.itemContainer(item);
  if (container) {
    var lastNumber = this.numItems(item);
    var newNumber = lastNumber + amount;
    container[item.id] = newNumber.clamp(0, this.maxItems(item));
    if (container[item.id] === 0) {
      delete container[item.id];
    }
    if (includeEquip && newNumber < 0) {
      this.discardMembersEquip(item, -newNumber);
    }
    $gameMap.requestRefresh();
  }
};

/* discardMembersEquip — MV :5006 / MZ :5658. The `while` per actor is not a
   `for`: one actor wearing the same armor in two slots gives up both before
   the walk moves on. MV uses forEach over members(), MZ a for..of; the ES5
   spelling here is MV's. */
Game_Party.prototype.discardMembersEquip = function (item, amount) {
  var n = amount;
  this.members().forEach(function (actor) {
    while (n > 0 && actor.isEquipped(item)) {
      actor.discardEquip(item);
      n--;
    }
  });
};

/* loseItem — MV :5017 / MZ :5667. Nothing but a sign flip, and it FORWARDS
   includeEquip, which is the whole path by which taking an item away can
   unequip it. */
Game_Party.prototype.loseItem = function (item, amount, includeEquip) {
  this.gainItem(item, -amount, includeEquip);
};

/* -------------------------------------------------------------------------
   Scene_Base — the members the title and shop scenes reach, and the one the
   scene-with-arguments push depends on.

   core.js:269-280 already gives Scene_Base isActive/isStarted/isReady/isBusy/
   update/terminate/create/start/fadeOutAll and the two reservation no-ops.
   These are additive.
   ---------------------------------------------------------------------- */
/* stop — MV rpg_scenes.js:123 / MZ rmmz_scenes.js:56. One line on both, and it
   is the SECOND half of how a scene is pushed: SceneManager.goto builds
   _nextScene and then calls this on the OUTGOING scene, so by the time
   prepareNextScene runs the old scene is already inactive. A pause hook that
   keys off isActive() sees the change here, one frame before terminate. The
   probe counter is the harness's, not the engine's. */
Scene_Base.prototype.stop = function () {
  this._active = false;
  window.__sceneStops = (window.__sceneStops || 0) + 1;
};
/* Scene_Base extends Stage, which is a PIXI.Container, on both engines
   (MV rpg_core.js:5140 / MZ rmmz_core.js:2261) — so addChild is inherited and
   not written in rpg_scenes.js at all. Modelled here as the container
   behaviour core.js's PIXI.Container already uses. */
Scene_Base.prototype.addChild = function (child) {
  if (!this.children) this.children = [];
  this.children.push(child);
  child.parent = this;
  return child;
};
/* addWindow — MV rpg_scenes.js:175 / MZ rmmz_scenes.js:83. Identical: it does
   NOT add to the scene, it adds to _windowLayer, so a scene whose
   createWindowLayer has not run yet throws here. createWindowLayer itself
   differs and is per engine. */
Scene_Base.prototype.addWindow = function (win) {
  this._windowLayer.addChild(win);
};
Scene_Base.prototype.popScene = function () {             /* MV :275 / MZ :133 */
  SceneManager.pop();
};
Scene_Base.prototype.fadeSpeed = function () {            /* MV :315 / MZ :152 */
  return 24;
};
Scene_Base.prototype.slowFadeSpeed = function () {        /* MV :327 / MZ :156 */
  return this.fadeSpeed() * 2;
};

/* -------------------------------------------------------------------------
   SceneManager — pushing a scene WITH ARGUMENTS.

   This is the sequence a shop command performs on both engines:
       SceneManager.push(Scene_Shop);
       SceneManager.prepareNextScene(goods, purchaseOnly);
   push -> goto -> `this._nextScene = new sceneClass()` and `_scene.stop()`,
   and prepareNextScene then forwards its arguments to that instance's
   prepare(). The scene is constructed BEFORE it is prepared and create() does
   not run until SceneManager.changeScene picks it up, so _goods is present by
   the time createBuyWindow reads it — and a caller that forgets
   prepareNextScene reaches createBuyWindow with _goods undefined instead.
   ---------------------------------------------------------------------- */
/* MV rpg_managers.js:2109 / MZ rmmz_managers.js:2243. MZ spells the forward
   `prepare(...arguments)`; ES5 needs apply, and the two are equivalent. */
SceneManager.prepareNextScene = function () {
  this._nextScene.prepare.apply(this._nextScene, arguments);
};
SceneManager.clearStack = function () {                   /* MV :2101 / MZ :2235 */
  this._stack = [];
};
SceneManager.pop = function () {                          /* MV :2088 / MZ :2222 */
  if (this._stack.length > 0) {
    this.goto(this._stack.pop());
  } else {
    this.exit();
  }
};
SceneManager.exit = function () { window.__sceneExits = (window.__sceneExits || 0) + 1; };
SceneManager.snap = function () { return new Bitmap(Graphics.width, Graphics.height); };

/* __pushSceneWithArgs — HARNESS, not engine. core.js:344-345 deliberately
   models SceneManager.goto and push as RECORDERS: they note the class name
   and never build _nextScene, and several areas of the suite assert on
   window.__pushed / window.__gotoScene. Redefining them here to be real would
   silently change what those checks measure.

   So the real three-step is exposed under its own name, with the two engine
   bodies inlined in their engine order — MV rpg_managers.js:2074/:2083/:2109,
   MZ rmmz_managers.js:2208/:2217/:2243, which are byte-identical apart from
   the spread. A test that wants to prove a prepared scene really carries its
   goods calls this; a test that only wants to know the mod asked for a push
   keeps reading window.__pushed. */
window.__pushSceneWithArgs = function (sceneClass) {
  var args = Array.prototype.slice.call(arguments, 1);
  /* push */
  SceneManager._stack.push(SceneManager._scene && SceneManager._scene.constructor);
  /* goto */
  if (sceneClass) SceneManager._nextScene = new sceneClass();
  if (SceneManager._scene) SceneManager._scene.stop();
  /* the recorders still fire, so nothing downstream loses its observable */
  SceneManager.push(sceneClass);
  /* prepareNextScene */
  SceneManager.prepareNextScene.apply(SceneManager, args);
  return SceneManager._nextScene;
};

/* -------------------------------------------------------------------------
   Scene_Shop — MV rpg_scenes.js:1845-2100 / MZ rmmz_scenes.js:2527-2866.

   INHERITANCE NOTE. Scene_Shop really extends Scene_MenuBase on both engines.
   Scene_MenuBase is a shared menu class that is NOT this file's to declare —
   a second top-level `function Scene_MenuBase()` in a sibling stub would
   replace the constructor and leave this prototype chain pointing at an
   orphaned object. So the chain is built on Scene_Base (core.js:269) and the
   ONE Scene_MenuBase member Scene_Shop.create() actually reaches is modelled
   as __menuBaseCreate, whose body is that engine's Scene_MenuBase.create.
   Everything else Scene_MenuBase provides (the blurred background sprite, the
   actor cursor, the MZ page buttons) is not reached by prepare/create and is
   left out.
   ---------------------------------------------------------------------- */
function Scene_Shop() { this.initialize.apply(this, arguments); }
Scene_Shop.prototype = Object.create(Scene_Base.prototype);
Scene_Shop.prototype.constructor = Scene_Shop;

/* MV :1852 / MZ :2534 — the whole body is `Scene_MenuBase.prototype
   .initialize.call(this)` on both, and Scene_MenuBase's is in turn nothing but
   Scene_Base's. So a fresh Scene_Shop carries NO _goods, _purchaseOnly or
   _item at all: those three properties do not exist until prepare() runs, and
   `'_goods' in scene` is false in between. Left absent rather than
   pre-initialised to undefined, because "never prepared" and "prepared with
   undefined goods" are different bugs. */
Scene_Shop.prototype.initialize = function () {
  this._active = false;
};

/* prepare — MV :1856 / MZ :2538. THE fields a caller sets, and all three of
   them: _goods, _purchaseOnly and _item. _item is nulled here and nowhere
   else before a selection, so buyingPrice() on a freshly prepared scene reads
   price(null). Verbatim on both engines. */
Scene_Shop.prototype.prepare = function (goods, purchaseOnly) {
  this._goods = goods;
  this._purchaseOnly = purchaseOnly;
  this._item = null;
  window.__shopPrepares = (window.__shopPrepares || 0) + 1;
};

/* create — MV :1862 / MZ :2544. The nine calls are in the SAME ORDER on both
   engines and the order is load-bearing three times over:
     · createGoldWindow before createCommandWindow (MV reads _goldWindow.x for
       the command window's width; MZ reads it in commandWindowRect);
     · createDummyWindow before createNumberWindow/createStatusWindow/
       createBuyWindow, all of which take their y and height from it;
     · createCategoryWindow before createSellWindow (MZ's sellWindowRect reads
       _categoryWindow.y and .height).
   A mod that inserts its own window by aliasing create must therefore append,
   not prepend. */
Scene_Shop.prototype.create = function () {
  this.__menuBaseCreate();
  this.createHelpWindow();
  this.createGoldWindow();
  this.createCommandWindow();
  this.createDummyWindow();
  this.createNumberWindow();
  this.createStatusWindow();
  this.createBuyWindow();
  this.createCategoryWindow();
  this.createSellWindow();
  window.__shopCreates = (window.__shopCreates || 0) + 1;
};

/* The buy/sell arithmetic — MV :2050-2100 / MZ :2813-2866. Byte-identical
   apart from MZ hoisting `num` out of the maxBuy expression.
   sellingPrice is a flat half price with NO trait or note involvement, which
   is why a shop that sells at anything else is a plugin and not the engine. */
Scene_Shop.prototype.doBuy = function (number) {
  $gameParty.loseGold(number * this.buyingPrice());
  $gameParty.gainItem(this._item, number);
};
Scene_Shop.prototype.doSell = function (number) {
  $gameParty.gainGold(number * this.sellingPrice());
  $gameParty.loseItem(this._item, number);
};
Scene_Shop.prototype.maxBuy = function () {
  var max = $gameParty.maxItems(this._item) - $gameParty.numItems(this._item);
  var price = this.buyingPrice();
  if (price > 0) {
    return Math.min(max, Math.floor(this.money() / price));
  } else {
    return max;
  }
};
Scene_Shop.prototype.maxSell = function () {
  return $gameParty.numItems(this._item);
};
Scene_Shop.prototype.money = function () {
  return this._goldWindow.value();
};
Scene_Shop.prototype.currencyUnit = function () {
  return this._goldWindow.currencyUnit();
};
/* buyingPrice reads the price off the BUY WINDOW, not off the item: a goods
   row may override it. That indirection is the reason Window_ShopBuy.price
   is modelled below at all. */
Scene_Shop.prototype.buyingPrice = function () {
  return this._buyWindow.price(this._item);
};
Scene_Shop.prototype.sellingPrice = function () {
  return Math.floor(this._item.price / 2);
};

/* -------------------------------------------------------------------------
   Window_ShopBuy — MV rpg_windows.js:2919-3015 / MZ rmmz_windows.js:3271-3376.

   This class is what a GOODS ROW MEANS. A row is [type, dataId, priceType,
   price]: type 0/1/2 selects $dataItems/$dataWeapons/$dataArmors, and
   priceType 0 means "use the database price" while anything else means "use
   the fourth element". Get that wrong and a forged shop sells the right item
   at the wrong money, or reads a nonexistent third table.

   BASE-CLASS NOTE, same shape as Scene_Shop's. Window_ShopBuy really extends
   Window_Selectable. Window_Selectable is not this file's to declare, so the
   handful of its members this class calls are modelled directly on this
   prototype and cited to it. If a sibling stub later introduces a real
   Window_Selectable, one line reconnects this:
       Object.setPrototypeOf(Window_ShopBuy.prototype, Window_Selectable.prototype);
   ---------------------------------------------------------------------- */
function Window_ShopBuy() { this.initialize.apply(this, arguments); }
/* initialize, refresh, makeItemList, item and drawItem are per engine — MV
   takes the goods in its CONSTRUCTOR and MZ takes them in setupGoods() after
   construction, which is the single largest MV/MZ difference in the shop. */

Window_ShopBuy.prototype.maxItems = function () {         /* MV :2939 / MZ :3289 */
  return this._data ? this._data.length : 1;
};
/* setMoney refreshes, and refresh re-runs makeItemList — so telling the
   window how much gold there is REBUILDS the row list. MV :2947 / MZ :3301. */
Window_ShopBuy.prototype.setMoney = function (money) {
  this._money = money;
  this.refresh();
};
Window_ShopBuy.prototype.isCurrentItemEnabled = function () { /* MV :2952 / MZ :3306 */
  return this.isEnabled(this._data[this.index()]);
};
/* price — MV :2956 / MZ :3310, byte-identical. Two things are load-bearing:
   the lookup is `this._data.indexOf(item)`, an IDENTITY search, so a detached
   copy of the same record prices at 0; and the `|| 0` swallows both "not
   found" (indexOf -1 -> undefined) and a genuine free item, so a goods row
   priced 0 and a goods row that is not in this window are indistinguishable
   through this method. */
Window_ShopBuy.prototype.price = function (item) {
  return this._price[this._data.indexOf(item)] || 0;
};
/* isEnabled — MV :2960 / MZ :3314. Affordability AND stack room. */
Window_ShopBuy.prototype.isEnabled = function (item) {
  return (item && this.price(item) <= this._money &&
          !$gameParty.hasMaxItems(item));
};
Window_ShopBuy.prototype.setStatusWindow = function (statusWindow) { /* MV :3006 / MZ :3367 */
  this._statusWindow = statusWindow;
  this.callUpdateHelp();
};
Window_ShopBuy.prototype.updateHelp = function () {       /* MV :3011 / MZ :3372 */
  this.setHelpWindowItem(this.item());
  if (this._statusWindow) {
    this._statusWindow.setItem(this.item());
  }
};

/* The Window_Selectable / Window_Base surface this class calls, modelled here
   for the reason given above. Cited to the class that really owns each.
   MV rpg_windows.js — index :737, select :792, setHandler :892,
   setHelpWindow :875, callUpdateHelp :1231, drawAllItems :1251,
   createContents (Window_Base) :94.
   MZ rmmz_windows.js — :855, :921, :1032, :1015, :1339, :1359, :89. */
Window_ShopBuy.prototype.index = function () { return this._index; };
Window_ShopBuy.prototype.select = function (index) { this._index = index; };
Window_ShopBuy.prototype.setHandler = function (symbol, method) {
  if (!this._handlers) this._handlers = {};
  this._handlers[symbol] = method;
};
Window_ShopBuy.prototype.setHelpWindow = function (helpWindow) { this._helpWindow = helpWindow; };
Window_ShopBuy.prototype.setHelpWindowItem = function (item) {
  if (this._helpWindow) this._helpWindow.setItem(item);
};
Window_ShopBuy.prototype.callUpdateHelp = function () { this.updateHelp(); };
Window_ShopBuy.prototype.createContents = function () {
  this.contents = new Bitmap(this._width || 456, 24 * this.maxItems());
};
Window_ShopBuy.prototype.drawAllItems = function () {
  for (var i = 0; i < this.maxItems(); i++) this.drawItem(i);
};
Window_ShopBuy.prototype.changePaintOpacity = function (enabled) { this._paintEnabled = enabled; };
Window_ShopBuy.prototype.drawItemName = function (item) { this._lastName = item ? item.name : ''; };
Window_ShopBuy.prototype.drawText = function (text) { this._lastText = String(text); };
Window_ShopBuy.prototype.hide = function () { this.visible = false; };
Window_ShopBuy.prototype.show = function () { this.visible = true; };
Window_ShopBuy.prototype.activate = function () { this.active = true; };
Window_ShopBuy.prototype.deactivate = function () { this.active = false; };

/* -------------------------------------------------------------------------
   Scene_Title — MV rpg_scenes.js:424-529 / MZ rmmz_scenes.js:488-620.
   The shared half. start, terminate, drawGameTitle and createCommandWindow
   all differ and live in the two sibling files.
   ---------------------------------------------------------------------- */
function Scene_Title() { this.initialize.apply(this, arguments); }
Scene_Title.prototype = Object.create(Scene_Base.prototype);
Scene_Title.prototype.constructor = Scene_Title;
Scene_Title.prototype.initialize = function () {
  this._active = false;
};

/* create — MV :435 / MZ :499. Same four calls in the same order on both.
   createWindowLayer sits BETWEEN the sprites and the command window, which is
   why an overlay parented to the scene lands under the windows. */
Scene_Title.prototype.create = function () {
  this.createBackground();
  this.createForeground();
  this.createWindowLayer();
  this.createCommandWindow();
  window.__titleCreates = (window.__titleCreates || 0) + 1;
};

/* update / isBusy — MV :452/:459 / MZ :515/:522. Identical. The command
   window is opened from update, not from start, so a scene that never
   updates never shows its menu. */
Scene_Title.prototype.update = function () {
  if (!this.isBusy()) {
    this._commandWindow.open();
  }
  Scene_Base.prototype.update.call(this);
};
Scene_Title.prototype.isBusy = function () {
  return this._commandWindow.isClosing() || Scene_Base.prototype.isBusy.call(this);
};

/* createBackground / createForeground — MV :468/:475 / MZ :537/:548.
   Identical. optDrawTitle is what decides whether the title text is painted
   at all; a project that ships its own titled artwork sets it false and
   drawGameTitle never runs. */
Scene_Title.prototype.createBackground = function () {
  this._backSprite1 = new Sprite(ImageManager.loadTitle1($dataSystem.title1Name));
  this._backSprite2 = new Sprite(ImageManager.loadTitle2($dataSystem.title2Name));
  this.addChild(this._backSprite1);
  this.addChild(this._backSprite2);
};
Scene_Title.prototype.createForeground = function () {
  this._gameTitleSprite = new Sprite(new Bitmap(Graphics.width, Graphics.height));
  this.addChild(this._gameTitleSprite);
  if ($dataSystem.optDrawTitle) {
    this.drawGameTitle();
  }
};

/* The three commands — MV :509-524 / MZ :599-614. Identical bodies, and the
   asymmetry is the point: commandNewGame fades and GOES to Scene_Map, while
   the other two only close the window and PUSH, so the title stays on the
   stack under them. Scene_Load and Scene_Options are the save and options
   areas' classes and are not declared in this file; the two pushes are
   recorded instead of performed, and the close() call that precedes them —
   the part the title's own state depends on — is kept verbatim. */
Scene_Title.prototype.commandNewGame = function () {
  DataManager.setupNewGame();
  this._commandWindow.close();
  this.fadeOutAll();
  SceneManager.goto(Scene_Map);
};
Scene_Title.prototype.commandContinue = function () {
  this._commandWindow.close();
  window.__titleContinue = (window.__titleContinue || 0) + 1;
};
Scene_Title.prototype.commandOptions = function () {
  this._commandWindow.close();
  window.__titleOptions = (window.__titleOptions || 0) + 1;
};
/* playTitleMusic — MV :526 / MZ :616. Identical, and it stops BGS and ME but
   not SE. */
Scene_Title.prototype.playTitleMusic = function () {
  AudioManager.playBgm($dataSystem.titleBgm);
  AudioManager.stopBgs();
  AudioManager.stopMe();
};

/* AudioManager's three title calls. core.js:264 gives AudioManager only
   stopAll; these are additive and are recorders. */
AudioManager.playBgm = function (bgm) { window.__bgm = bgm; };
AudioManager.stopBgs = function () { window.__bgsStops = (window.__bgsStops || 0) + 1; };
AudioManager.stopMe = function () { window.__meStops = (window.__meStops || 0) + 1; };

/* Window_TitleCommand. The real class is a Window_Command subclass that lives
   with the other windows; only the two members the title scene and MV's
   Scene_Boot touch are modelled. _lastCommandSymbol is a STATIC that survives
   between visits to the title — MV rpg_windows.js:5739 / MZ :6409 — which is
   why returning to the title re-selects the command you last chose.
   initCommandPosition (MV :5741 / MZ :6411) clears it, and MV's Scene_Boot
   calls that static at boot while MZ's does not. */
function Window_TitleCommand() { this._opens = 0; this._closes = 0; this.active = false; }
Window_TitleCommand._lastCommandSymbol = null;
Window_TitleCommand.initCommandPosition = function () {
  this._lastCommandSymbol = null;
  window.__titleCommandInits = (window.__titleCommandInits || 0) + 1;
};
Window_TitleCommand.prototype.open = function () { this._opens++; this._opened = true; };
Window_TitleCommand.prototype.close = function () { this._closes++; this._opened = false; };
Window_TitleCommand.prototype.isClosing = function () { return false; };
Window_TitleCommand.prototype.setHandler = function (symbol, method) {
  if (!this._handlers) this._handlers = {};
  this._handlers[symbol] = method;
};
Window_TitleCommand.prototype.setBackgroundType = function (type) { this._backgroundType = type; };
