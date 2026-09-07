/* =============================================================================
   GigaHack_Snapshot — what changed since the save, and between two saves.

   The module's whole claim is that it can READ a save without loading it, and
   describe it without ever calling a method on anything that came out of it.
   Both halves are staged here rather than asserted about: slots are seeded
   through the engine's own save path, and the classes a save names are taken
   away from the build before it is read, which is the only way to prove the
   field-reading discipline is real and not a comment.

   Everything this file touches is put back: the thirteen globals, the values
   under them, the save files, the slot index, the frame counter, the project
   version and every snapshot setting.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page, shot = ctx.shot;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ, MODDED = ctx.MODDED;

  const SRC_PATH = path.resolve(__dirname, '..', '..', 'gigahack', 'js', 'plugins', 'GigaHack_Snapshot.js');
  const SRC = fs.readFileSync(SRC_PATH, 'utf8');
  /* Comments and string literals stripped, so a rule never fires on the
     module's own prose about what it does not do. */
  const CODE = SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(\\.|[^'\\])*'/g, "''");

  /* =========================================================================
     0 — REMEMBER EVERYTHING, THEN SEED
     ====================================================================== */
  const GLOBALS = ['$gameTemp', '$gameSystem', '$gameScreen', '$gameTimer', '$gameMessage',
    '$gameSwitches', '$gameVariables', '$gameSelfSwitches', '$gameActors',
    '$gameParty', '$gameTroop', '$gameMap', '$gamePlayer'];

  await ev((names) => {
    const G = window.GigaHack;
    const keep = window.__snapKeep = { globals: {}, ctors: {} };
    names.forEach(n => { keep.globals[n] = window[n]; });
    keep.files = JSON.stringify(StorageManager._files);
    keep.globalInfo = (typeof DataManager._globalInfo !== 'undefined')
      ? JSON.stringify(DataManager._globalInfo) : null;
    keep.vars = $gameVariables._data.slice();
    keep.switches = $gameSwitches._data.slice();
    keep.self = JSON.parse(JSON.stringify($gameSelfSwitches._data));
    keep.gold = $gameParty._gold;
    keep.items = JSON.parse(JSON.stringify($gameParty._items));
    keep.weapons = JSON.parse(JSON.stringify($gameParty._weapons));
    keep.armors = JSON.parse(JSON.stringify($gameParty._armors));
    keep.actors = $gameParty._actors.slice();
    keep.mapId = $gameMap._mapId;
    keep.px = $gamePlayer._x; keep.py = $gamePlayer._y; keep.pd = $gamePlayer._direction;
    keep.frameCount = Graphics.frameCount;
    keep.versionId = $dataSystem.versionId;
    keep.sysVersion = $gameSystem._versionId;
    keep.saveCount = $gameSystem._saveCount;
    keep.framesOnSave = $gameSystem._framesOnSave;
    keep.snapCfg = JSON.stringify(G.cfg.snapshot || {});
    keep.tab = G.cfg.ui.tab;
    keep.sub = JSON.stringify(G.cfg.ui.sub || {});
    keep.open = G.ui.isOpen();
    keep.makeSaveContents = DataManager.makeSaveContents;

    /* One save, normalised: one engine answers with a promise and the other
       with a boolean, exactly as the mod's own adapter has to. */
    window.__snapSave = function (id) {
      return new Promise(function (res) {
        var r = DataManager.saveGame(id);
        if (r && typeof r.then === 'function') r.then(function () { res(true); }, function () { res(false); });
        else res(r !== false);
      });
    };
    window.__snapRead = function (id) {
      return new Promise(function (res) {
        G.snap.fromSlot(id, function (s, why) { res({ snap: s, why: why }); });
      });
    };
    /* Only what a check needs off a snapshot: sending a 1400-entry array
       across the bridge for every assertion is a slow suite for no answer. */
    window.__snapFacts = function (s) {
      if (!s) return null;
      return {
        origin: s.origin, side: s.side, slot: s.slot, label: s.label, ok: s.ok, why: s.why,
        sections: s.sections, extra: s.extra.slice(), counts: s.counts,
        truncated: s.truncated,
        vLen: s.v.length, sLen: s.s.length,
        gold: s.gold, items: s.items, weapons: s.weapons, armors: s.armors,
        party: s.party.slice(), map: s.map, system: s.system,
        playFrames: s.playFrames,
        selfKeys: Object.keys(s.self).sort(),
        actorIds: Object.keys(s.actors),
        struct: Object.keys(s.vStruct)
      };
    };
    window.__snapVar = function (s, id) { return s ? s.v[id] : undefined; };
  }, GLOBALS);

  /* --- two slots with genuinely different state, written by the engine ---- */
  const seeded = await ev(async () => {
    const G = window.GigaHack;

    function stateA() {
      $gameVariables.setValue(11, 100);
      $gameVariables.setValue(12, 'a string');
      $gameVariables.setValue(13, [1, 2, 3]);       // a list in a variable
      $gameVariables.setValue(14, 7);
      $gameVariables.setValue(7, 42);               // id 7 is unnamed in this project
      $gameSwitches.setValue(21, true);
      $gameSwitches.setValue(22, false);
      $gameSelfSwitches.setValue([12, 1, 'A'], true);
      $gameSelfSwitches.setValue([5, 1, 'B'], true);
      $gameParty._gold = 1000;
      $gameParty._items = { 12: 3, 45: 1 };
      $gameParty._weapons = { 1: 2 };
      $gameParty._armors = { 1: 1 };
      $gameParty._actors = [1, 2];
      $gameActors.actor(1)._level = 10;
      $gameMap._mapId = 12;
      $gamePlayer._x = 3; $gamePlayer._y = 4;
      Graphics.frameCount = 60 * 600;               // ten minutes of play
    }
    function stateB() {
      $gameVariables.setValue(11, 250);
      $gameVariables.setValue(13, [1, 2, 3, 4]);
      $gameSwitches.setValue(22, true);
      $gameSelfSwitches.setValue([12, 1, 'A'], false);   // the engine DELETES it
      $gameSelfSwitches.setValue([14, 1, 'A'], true);
      $gameParty._gold = 1500;
      $gameParty._items = { 12: 5, 45: 1, 208: 2 };
      $gameParty._actors = [1, 2, 3];
      $gameActors.actor(1)._level = 14;
      $gameMap._mapId = 5;
      $gamePlayer._x = 9; $gamePlayer._y = 4;
      Graphics.frameCount = 60 * 1500;              // twenty-five minutes
    }

    stateA();
    $gameSystem.onBeforeSave();                     // the scene's job, not saveGame's
    const okA = await window.__snapSave(1);
    stateB();
    $gameSystem.onBeforeSave();
    const okB = await window.__snapSave(2);

    /* A third slot written by a DIFFERENT build of the project. */
    const wasVersion = $dataSystem.versionId;
    $dataSystem.versionId = wasVersion + 7;
    $gameSystem.onBeforeSave();
    const okC = await window.__snapSave(3);
    $dataSystem.versionId = wasVersion;
    $gameSystem.onBeforeSave();

    return { okA, okB, okC, exists: [1, 2, 3].map(i => DataManager.savefileExists(i)) };
  });
  check('the harness can seed three slots through the engine\'s own save path',
    seeded.okA && seeded.okB && seeded.okC && seeded.exists.every(Boolean), JSON.stringify(seeded));

  /* =========================================================================
     1 — THE SNAPSHOT ITSELF
     ====================================================================== */

  const bounded = await ev(() => {
    const G = window.GigaHack;

    /* Anything that is not a primitive, a plain object or a plain array is a
       live engine object the snapshot has kept hold of. */
    function foreign(v, depth, seen) {
      if (v === null || typeof v !== 'object') return null;
      if (depth > 6) return 'too deep';
      const p = Object.getPrototypeOf(v);
      if (p !== Object.prototype && p !== Array.prototype && p !== null) {
        return (v.constructor && v.constructor.name) || 'unknown';
      }
      for (const k of Object.keys(v)) {
        const f = foreign(v[k], depth + 1, seen);
        if (f) return k + ':' + f;
      }
      return null;
    }

    const a = G.snap.take({ origin: 'live' });
    const sizeA = JSON.stringify(a).length;

    /* Grow everything the snapshot is NOT allowed to notice. */
    const evCount = $gameMap._events.length;
    for (let i = 0; i < 40; i++) $gameMap._events.push(new Game_Event(900 + i, 'noise', 1, 1));
    const before = $gameScreen._pictures ? $gameScreen._pictures.length : 0;
    const b = G.snap.take({ origin: 'live' });
    const sizeB = JSON.stringify(b).length;
    $gameMap._events.length = evCount;

    /* And grow the one thing it IS: the project's variable table. */
    const wasLen = $dataSystem.variables.length;
    for (let i = 0; i < 25; i++) $dataSystem.variables.push('extra_' + i);
    const c = G.snap.take({ origin: 'live' });
    const sizeC = JSON.stringify(c).length;
    $dataSystem.variables.length = wasLen;

    return {
      sizeA, sizeB, sizeC, wasLen,
      vLen: a.v.length, sLen: a.s.length,
      foreign: foreign(a, 0, null),
      mapKeys: Object.keys(a.map).sort().join(','),
      topKeys: Object.keys(a).sort().join(',')
    };
  });
  check('a live snapshot holds no tile data, no map event objects and no engine object at all',
    bounded.foreign === null && bounded.mapKeys === 'dir,mapId,x,y',
    JSON.stringify({ foreign: bounded.foreign, mapKeys: bounded.mapKeys }));
  check('a live snapshot does not grow when the map gains forty events, and does when the project gains variables',
    bounded.sizeA === bounded.sizeB && bounded.sizeC > bounded.sizeA,
    JSON.stringify({ a: bounded.sizeA, b: bounded.sizeB, c: bounded.sizeC }));
  check('a snapshot covers every variable and switch id the project defines',
    bounded.vLen === bounded.wasLen && bounded.sLen === 1101,
    JSON.stringify({ vLen: bounded.vLen, want: bounded.wasLen, sLen: bounded.sLen }));

  const noSerialise = await ev(() => {
    const G = window.GigaHack;
    const s = JsonEx.stringify, d = JsonEx.makeDeepCopy;
    let calls = 0;
    JsonEx.stringify = function () { calls++; return s.apply(this, arguments); };
    JsonEx.makeDeepCopy = function () { calls++; return d.apply(this, arguments); };
    /* Measured on objects this check owns and puts on the world itself, not on
       $gameSystem: JsonEx._encode marks IN PLACE on both engines, and only MV
       cleans the marks off again afterwards (rpg_core.js:8944). So a live
       $gameSystem that has been through any save legitimately carries '@' on
       MZ, and asserting its absence would be asserting an engine difference
       rather than anything this module does. */
    const probeA = { probe: 1 };
    const probeB = { probe: 2 };
    $gameSystem.__snapProbe = probeA;
    $gameParty.__snapProbe = probeB;
    G.snap.take({ origin: 'live' });
    JsonEx.stringify = s; JsonEx.makeDeepCopy = d;
    const out = {
      calls,
      markedSystem: Object.prototype.hasOwnProperty.call(probeA, '@'),
      markedParty: Object.prototype.hasOwnProperty.call(probeB, '@')
    };
    delete $gameSystem.__snapProbe;
    delete $gameParty.__snapProbe;
    return out;
  });
  check('taking a snapshot never serialises the world, so nothing under $gameSystem is marked on the way past',
    noSerialise.calls === 0 && !noSerialise.markedSystem && !noSerialise.markedParty,
    JSON.stringify(noSerialise));

  const pastEnd = await ev(() => {
    const G = window.GigaHack;
    const beyond = $dataSystem.variables.length + 4;
    const base = G.snap.take({ origin: 'live' });
    $gameVariables._data[beyond] = 99;             // an id this database has no name for
    const now = G.snap.take({ origin: 'live' });
    const rows = G.snap.diff(base, now, { revert: false });
    delete $gameVariables._data[beyond];
    const row = rows.filter(r => r.kind === 'var' && r.id === beyond)[0];
    return { beyond, found: !!row, note: row ? row.note : '', to: row ? row.to : '' };
  });
  check('an id a save carries past the end of the database is kept and marked, not dropped',
    pastEnd.found && /past the end/.test(pastEnd.note) && pastEnd.to === '99',
    JSON.stringify(pastEnd));

  const structured = await ev(() => {
    const G = window.GigaHack;
    const a = G.snap.take({ origin: 'live' });
    const b = G.snap.take({ origin: 'live' });
    const quiet = G.snap.diff(a, b, { revert: false }).filter(r => r.kind === 'var' && r.id === 13);
    /* Mutated IN PLACE — the case a snapshot that kept the reference cannot see. */
    $gameVariables.value(13).push(99);
    const c = G.snap.take({ origin: 'live' });
    const loud = G.snap.diff(a, c, { revert: false }).filter(r => r.kind === 'var' && r.id === 13);
    $gameVariables.value(13).pop();
    return {
      quiet: quiet.length, loud: loud.length,
      note: loud[0] ? loud[0].note : '',
      revertable: loud[0] ? loud[0].revertable : null,
      from: loud[0] ? loud[0].from : '',
      structIds: Object.keys(a.vStruct)
    };
  });
  check('a variable holding a list is compared by text — identical twice over, and different when the list is edited in place',
    structured.quiet === 0 && structured.loud === 1 && /compared as text/.test(structured.note) &&
    structured.revertable === false && structured.structIds.indexOf('13') > -1,
    JSON.stringify(structured));

  const selfDiff = await ev(() => {
    const G = window.GigaHack;
    const a = G.snap.take({ origin: 'live' });
    const onCount = Object.keys(a.self).length;
    $gameSelfSwitches.setValue([12, 3, 'C'], true);
    const b = G.snap.take({ origin: 'live' });
    $gameSelfSwitches.setValue([12, 3, 'C'], false);   // the engine DELETES the key
    const c = G.snap.take({ origin: 'live' });
    const added = G.snap.diff(a, b, { revert: false }).filter(r => r.kind === 'self');
    const removed = G.snap.diff(b, c, { revert: false }).filter(r => r.kind === 'self');
    return {
      onCount, hasDeletedKey: Object.prototype.hasOwnProperty.call(c.self, '12,3,C'),
      added: added.length, removed: removed.length,
      addedName: added[0] ? added[0].name : '',
      addedTo: added[0] ? added[0].to : '', removedTo: removed[0] ? removed[0].to : ''
    };
  });
  check('self-switches diff by presence, because the engine stores only the ones that are on',
    selfDiff.added === 1 && selfDiff.removed === 1 && !selfDiff.hasDeletedKey &&
    selfDiff.addedTo === 'ON' && selfDiff.removedTo === 'off',
    JSON.stringify(selfDiff));
  check('a self-switch row names the map and the event that own it, resolved live',
    /Cellar/.test(selfDiff.addedName) && / C$/.test(selfDiff.addedName), selfDiff.addedName);

  /* =========================================================================
     2 — READING A SLOT
     ====================================================================== */

  const readShape = await ev(() => {
    const G = window.GigaHack;
    const r = G.snap.readShape();
    return { mode: r.mode, text: r.text, available: G.snap.available(), reason: G.snap.reason() };
  });
  check('the read shape is the one this build actually offers, and is named as a shape rather than as an engine',
    readShape.available === true &&
    readShape.mode === (IS_MZ ? 'object' : 'json') &&
    readShape.text === (IS_MZ ? 'name-keyed, answers with a promise' : 'id-keyed, answers synchronously'),
    JSON.stringify(readShape));

  const untouched = await ev(async (names) => {
    const G = window.GigaHack;
    const before = {};
    names.forEach(n => { before[n] = window[n]; });
    const state = {
      gold: $gameParty._gold, vars: $gameVariables._data.length,
      self: JSON.stringify($gameSelfSwitches._data), mapId: $gameMap._mapId,
      created: window.__createdGameObjects || 0, extracted: window.__extracted || 0
    };
    const r = await window.__snapRead(1);
    const same = names.every(n => window[n] === before[n]);
    return {
      got: !!r.snap, same,
      gold: $gameParty._gold === state.gold,
      vars: $gameVariables._data.length === state.vars,
      self: JSON.stringify($gameSelfSwitches._data) === state.self,
      mapId: $gameMap._mapId === state.mapId,
      created: (window.__createdGameObjects || 0) === state.created,
      extracted: (window.__extracted || 0) === state.extracted
    };
  }, GLOBALS);
  check('reading a slot touches no $game global — all thirteen are the same object with the same contents afterwards',
    untouched.got && untouched.same && untouched.gold && untouched.vars && untouched.self &&
    untouched.mapId && untouched.created && untouched.extracted, JSON.stringify(untouched));

  const asFound = await ev(async () => {
    const G = window.GigaHack;
    const mode = G.snap.readShape().mode;
    const probe = { storage: 0, arg: null, decoder: 0 };
    const parse = JsonEx.parse;
    JsonEx.parse = function (j) { probe.decoder++; return parse.apply(this, arguments); };
    let restore;
    if (mode === 'object') {
      const orig = StorageManager.loadObject;
      StorageManager.loadObject = function (name) { probe.storage++; probe.arg = name; return orig.apply(this, arguments); };
      restore = function () { StorageManager.loadObject = orig; };
    } else {
      const orig = StorageManager.load;
      StorageManager.load = function (id) { probe.storage++; probe.arg = id; return orig.apply(this, arguments); };
      restore = function () { StorageManager.load = orig; };
    }
    const r = await window.__snapRead(2);
    restore(); JsonEx.parse = parse;
    return {
      mode, storage: probe.storage, decoder: probe.decoder, arg: probe.arg,
      wantArg: mode === 'object' ? DataManager.makeSavename(2) : 2,
      got: !!r.snap
    };
  });
  check('reading a slot goes through the storage layer as found — a replacement installed after load is the one that runs',
    asFound.got && asFound.storage === 1 && asFound.arg === asFound.wantArg, JSON.stringify(asFound));
  check('and the save is decoded through this build\'s own JsonEx, never a parser this module brought',
    asFound.decoder >= 1, JSON.stringify({ decoder: asFound.decoder }));

  const emptySlot = await ev(async () => {
    const G = window.GigaHack;
    const free = G.snap.maxSlots();          // nothing was ever written here
    const r = await window.__snapRead(free);
    return { free, snap: !!r.snap, why: r.why, exists: DataManager.savefileExists(free) };
  });
  check('a slot that does not exist reads as empty and says so, rather than as a failed read',
    emptySlot.exists === false && emptySlot.snap === false && /empty/.test(emptySlot.why),
    JSON.stringify(emptySlot));

  const slotFacts = await ev(async () => {
    const r1 = await window.__snapRead(1);
    const r2 = await window.__snapRead(2);
    return {
      a: window.__snapFacts(r1.snap), b: window.__snapFacts(r2.snap),
      title: $dataSystem.gameTitle
    };
  });
  const A = slotFacts.a || {}, B = slotFacts.b || {};
  check('a slot reads back exactly the state that was written into it, whichever shape the storage layer answered in',
    A.gold === 1000 && B.gold === 1500 &&
    A.map.mapId === 12 && B.map.mapId === 5 && A.map.x === 3 && B.map.x === 9 &&
    A.playFrames === 60 * 600 && B.playFrames === 60 * 1500 &&
    A.party.join(',') === '1,2' && B.party.join(',') === '1,2,3' &&
    A.side === 'file' && A.slot === 1,
    JSON.stringify({ aGold: A.gold, bGold: B.gold, aMap: A.map, bMap: B.map, aPlay: A.playFrames }));
  check('every engine section of a stock save arrives with its class back on it',
    ['system', 'screen', 'switches', 'variables', 'selfSwitches', 'actors', 'party', 'map', 'player']
      .every(k => A.sections[k] === 'read'), JSON.stringify(A.sections));

  const dropped = await ev(async () => {
    const G = window.GigaHack;
    const r = await window.__snapRead(1);
    function foreign(v, depth) {
      if (v === null || typeof v !== 'object') return null;
      if (depth > 6) return 'too deep';
      const p = Object.getPrototypeOf(v);
      if (p !== Object.prototype && p !== Array.prototype && p !== null) {
        return (v.constructor && v.constructor.name) || 'unknown';
      }
      for (const k of Object.keys(v)) { const f = foreign(v[k], depth + 1); if (f) return k + ':' + f; }
      return null;
    }
    return { foreign: foreign(r.snap, 0), held: G.snap.held() };
  });
  check('the parsed save is dropped as soon as its snapshot is taken — nothing in the record came out of the file by reference',
    dropped.foreign === null, String(dropped.foreign));

  /* --- the crux: a save naming classes this build does not have ----------- */
  const CLASSES = ['Game_System', 'Game_Screen', 'Game_Timer', 'Game_Switches', 'Game_Variables',
    'Game_SelfSwitches', 'Game_Actors', 'Game_Party', 'Game_Map', 'Game_Player'];
  const foreignSave = await ev(async (names) => {
    const saved = {};
    names.forEach(n => { saved[n] = window[n]; window[n] = undefined; });
    let threw = null, facts = null, gold = null;
    try {
      const r = await window.__snapRead(1);
      facts = window.__snapFacts(r.snap);
      gold = r.snap ? r.snap.gold : null;
    } catch (e) { threw = e && e.message; }
    names.forEach(n => { window[n] = saved[n]; });
    return { threw, facts, gold };
  }, CLASSES);
  const F = foreignSave.facts || {};
  check('a save naming classes this build does not have still yields every field it stored',
    !foreignSave.threw && !!foreignSave.facts &&
    F.gold === 1000 && F.map.mapId === 12 && F.map.x === 3 &&
    F.counts.vars === 1400 && F.selfKeys.length === A.selfKeys.length &&
    JSON.stringify(F.items) === JSON.stringify(A.items),
    JSON.stringify({ threw: foreignSave.threw, gold: F.gold, map: F.map, counts: F.counts }));
  check('and each such section is reported as having arrived as plain data, not silently skipped',
    !!foreignSave.facts && ['system', 'switches', 'variables', 'selfSwitches', 'party', 'map', 'player']
      .every(k => F.sections[k] === 'plain'), JSON.stringify(F.sections || {}));
  check('nothing in the module calls a method on an object that came out of a save',
    !foreignSave.threw && !!foreignSave.facts, String(foreignSave.threw));

  /* --- a section the engine never wrote ----------------------------------- */
  const extraSection = await ev(async () => {
    const G = window.GigaHack;
    const orig = DataManager.makeSaveContents;
    /* Exactly what a plugin that extends the save does. */
    DataManager.makeSaveContents = function () {
      const c = orig.apply(this, arguments);
      c.questLog = { version: 2, entries: [1, 2, 3] };
      return c;
    };
    await window.__snapSave(4);
    DataManager.makeSaveContents = orig;
    const r = await window.__snapRead(4);
    const facts = window.__snapFacts(r.snap);
    return { extra: facts ? facts.extra : [], sections: facts ? Object.keys(facts.sections).length : 0 };
  });
  check('a section a save carries that the engine did not write is listed by name, not silently ignored',
    extraSection.extra.indexOf('questLog') > -1 && extraSection.sections === 10,
    JSON.stringify(extraSection));

  /* =========================================================================
     3 — THE HOOKS
     ====================================================================== */

  const hooks = await ev(() => {
    const H = window.GigaHack.hooks;
    const names = ['DataManager.saveGame (anchor)', 'DataManager.extractSaveContents (anchor)',
      'DataManager.setupNewGame (anchor)'];
    const out = {};
    names.forEach(n => { out[n] = H[n] ? { installed: H[n].installed, reason: H[n].reason || '' } : null; });
    out.forgeStillThere = !!(H['DataManager.extractSaveContents (forge scrub)'] &&
      H['DataManager.extractSaveContents (forge scrub)'].installed);
    out.bootStillThere = !!(H['DataManager.setupNewGame (self-test)'] &&
      H['DataManager.setupNewGame (self-test)'].installed);
    return out;
  });
  check('all three anchor hooks installed, under labels that do not collide with the two other modules on the same methods',
    hooks['DataManager.saveGame (anchor)'] && hooks['DataManager.saveGame (anchor)'].installed &&
    hooks['DataManager.extractSaveContents (anchor)'].installed &&
    hooks['DataManager.setupNewGame (anchor)'].installed &&
    hooks.forgeStillThere && hooks.bootStillThere, JSON.stringify(hooks));

  const onSave = await ev(async () => {
    const G = window.GigaHack;
    const madeBefore = window.__madeContents || 0;
    const r = DataManager.saveGame(5);
    const isThenable = !!(r && typeof r.then === 'function');
    const isBoolean = typeof r === 'boolean';
    if (isThenable) await r;
    const a = G.snap.anchor();
    return {
      isThenable, isBoolean, saveIsAsync: G.caps.saveIsAsync,
      originalRuns: (window.__madeContents || 0) - madeBefore,
      origin: a && a.origin, slot: a && a.slot, label: a && a.label, ok: a && a.ok
    };
  });
  check('the save hook hands back exactly what the engine returned — a promise stays a promise, a boolean stays a boolean',
    onSave.isThenable === onSave.saveIsAsync && onSave.isBoolean === !onSave.saveIsAsync,
    JSON.stringify(onSave));
  check('and the original save runs exactly once through the wrapper',
    onSave.originalRuns === 1, String(onSave.originalRuns));
  check('the baseline moves when a save is written, and names the slot it anchored to',
    onSave.origin === 'save' && onSave.slot === 5 && /slot 5/.test(onSave.label) && onSave.ok === true,
    JSON.stringify(onSave));

  /* --- a save the engine reports as failed --------------------------------
     Watched from Node rather than from a window listener: Chromium reports an
     unhandled rejection on a file:// page through the debugger's exception
     channel, and a page-side "unhandledrejection" handler never sees it. */
  const strayRejections = [];
  const onStray = function (e) { strayRejections.push(String(e && e.message).split('\n')[0]); };
  page.on('pageerror', onStray);
  const failed = await ev(async () => {
    const G = window.GigaHack;
    window.__saveShouldFail = true;
    const r = DataManager.saveGame(6);
    /* The calling scene handles its own promise; the point of the check is
       that the module's outcome handler does not add a SECOND one. */
    if (r && typeof r.then === 'function') { try { await r; } catch (e) { /* the scene's job */ } }
    window.__saveShouldFail = false;
    const a = G.snap.anchor();
    return { ok: a && a.ok, why: a && a.why, origin: a && a.origin, slot: a && a.slot };
  });
  await page.waitForTimeout(220);
  page.off('pageerror', onStray);
  check('an anchor taken for a save the engine then reported as failed says it is not backed by a file',
    failed.ok === false && /failed/.test(failed.why || '') && failed.slot === 6,
    JSON.stringify(failed));
  check('a rejected save never becomes an unhandled rejection through the outcome handler this module attaches',
    strayRejections.length === 0, strayRejections.join(' | '));

  /* --- the autosave guard -------------------------------------------------- */
  const autosave = await ev(async () => {
    const G = window.GigaHack;
    const has = G.snap.hasAutosaveSlot();
    const out = { has, guardedWhenOff: null, allowedWhenOn: null, unguardedWithoutTheConcept: null };
    if (!has) {
      /* No autosave concept means nothing writes slot 0 behind the player's
         back, so there is nothing to guard — and slot 0 is the index file on
         this build, which is why the guard is asked about rather than tried. */
      out.unguardedWithoutTheConcept = G.snap.shouldAnchorOnSave(0) === true;
      return out;
    }
    G.store.cfgSet('snapshot.anchorOnAutosave', false);
    const beforeAt = G.snap.anchor().at;
    await window.__snapSave(0);
    out.guardedWhenOff = G.snap.anchor().at === beforeAt && G.snap.anchor().slot !== 0;
    G.store.cfgSet('snapshot.anchorOnAutosave', true);
    await window.__snapSave(0);
    out.allowedWhenOn = G.snap.anchor().slot === 0;
    G.store.cfgSet('snapshot.anchorOnAutosave', false);
    return out;
  });
  check('a write to the autosave slot moves the baseline only where the setting says it may, and only on a build that has one',
    autosave.has === IS_MZ &&
    (autosave.has
      ? (autosave.guardedWhenOff === true && autosave.allowedWhenOn === true)
      : autosave.unguardedWithoutTheConcept === true),
    JSON.stringify(autosave));

  const staleIndex = await ev(async () => {
    /* The slot index is cached against a frame counter that stops advancing
       while the mod holds the game, so a save made while it is held would
       otherwise read back as the pre-save index. */
    const G = window.GigaHack;
    const slot = 7;
    G.eng.invalidateSaveInfo();
    const primed = G.eng.savefileInfo(slot);          // caches "nothing there"
    const frames = Graphics.frameCount;
    await window.__snapSave(slot);
    const after = G.eng.savefileInfo(slot);
    return { primed: !!primed, after: !!after, frozen: Graphics.frameCount === frames };
  });
  check('the save hook drops the slot-index cache, so the next read is not the pre-save one even with the game held',
    staleIndex.primed === false && staleIndex.after === true && staleIndex.frozen,
    JSON.stringify(staleIndex));

  /* --- the load and new-game anchors --------------------------------------- */
  const onLoad = await ev(async (names) => {
    const G = window.GigaHack;
    const keep = {};
    names.forEach(n => { keep[n] = window[n]; });

    $gameVariables.setValue(11, 4242);              // the state we are about to leave
    const beforeLoad = $gameVariables.value(11);

    const r = DataManager.loadGame(1);              // slot 1 holds 100
    let loaded;
    if (r && typeof r.then === 'function') { loaded = await r.then(() => true, () => false); }
    else loaded = r !== false;

    const a = G.snap.anchor();
    const out = {
      loaded, beforeLoad,
      origin: a && a.origin,
      anchoredValue: a ? a.v[11] : null,
      liveValue: $gameVariables.value(11),
      label: a && a.label
    };
    names.forEach(n => { window[n] = keep[n]; });    // put the running game back
    return out;
  }, GLOBALS);
  check('the baseline moves after a load, to the state the load installed and not the state before it',
    onLoad.loaded && onLoad.origin === 'load' && onLoad.beforeLoad === 4242 &&
    onLoad.anchoredValue === 100, JSON.stringify(onLoad));

  const onNew = await ev(() => {
    const G = window.GigaHack;
    const before = G.snap.anchor();
    DataManager.setupNewGame();
    const a = G.snap.anchor();
    return { origin: a && a.origin, label: a && a.label, moved: a !== before, at: a && a.at };
  });
  check('the baseline moves when a new game starts, and is labelled as one',
    onNew.origin === 'new game' && onNew.label === 'new game' && onNew.moved,
    JSON.stringify(onNew));

  const autoOff = await ev(async () => {
    const G = window.GigaHack;
    G.store.cfgSet('snapshot.autoAnchor', false);
    const before = G.snap.anchor();
    await window.__snapSave(8);
    const same = G.snap.anchor() === before;
    G.store.cfgSet('snapshot.autoAnchor', true);
    return { same, why: G.snap.anchorWhy() };
  });
  check('turning automatic anchoring off actually stops the baseline moving on a save',
    autoOff.same === true, JSON.stringify(autoOff));

  /* =========================================================================
     4 — THE PANELS
     ====================================================================== */

  const registration = await ev(() => {
    const G = window.GigaHack;
    const world = G.ui.panelNames('world'), debug = G.ui.panelNames('debug');
    return {
      world, debug,
      sinceOnce: world.filter(n => n === 'Since Save').length,
      compareOnce: debug.filter(n => n === 'Compare').length
    };
  });
  const w = registration.world, d = registration.debug;
  check('Since Save registers on the World tab between Recent and Self, and Compare on Debug between Transfer and Console',
    registration.sinceOnce === 1 && registration.compareOnce === 1 &&
    w.indexOf('Since Save') > w.indexOf('Recent') && w.indexOf('Since Save') < w.indexOf('Self') &&
    d.indexOf('Compare') > d.indexOf('Transfer') && d.indexOf('Compare') < d.indexOf('Console'),
    JSON.stringify({ world: w.join(','), debug: d.join(',') }));

  const sincePanel = await ev(() => {
    const G = window.GigaHack;
    G.snap.setAnchor(G.snap.take({ origin: 'manual' }));
    $gameVariables.setValue(14, 555);
    $gameParty._gold = 9999;
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub.world = 'Since Save';
    G.ui.rerender();
    const body = document.querySelector('#mm-root .mm-body');
    const text = body ? body.textContent : '';
    const rows = document.querySelectorAll('#mm-root .mm-tbody .mm-tr').length;
    return {
      text: text.slice(0, 4000),
      rows,
      hasSummary: /2 changes across 2 sections, since anchored by hand, /.test(text),
      notCompared: G.snap.notCompared(),
      allNamed: G.snap.notCompared().every(t => text.indexOf(t) > -1)
    };
  });
  await shot('snapshot-since-save');
  check('the Since Save panel summarises the change count and the section count against the anchor it names',
    sincePanel.hasSummary && sincePanel.rows >= 2, JSON.stringify({ rows: sincePanel.rows }) +
    ' ' + sincePanel.text.slice(0, 160));
  check('every section the diff does not compare is named in the panel, not left in a comment',
    sincePanel.notCompared.length >= 5 && sincePanel.allNamed,
    JSON.stringify(sincePanel.notCompared));

  const revert = await ev(() => {
    const G = window.GigaHack;
    const K = G.compat;
    let seen = [];
    const orig = K.verify;
    K.verify = function (control) { seen.push(control); return orig.apply(this, arguments); };

    const btns = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'));
    const rev = btns.filter(b => b.textContent === 'revert' && !b.classList.contains('mm-dis'));
    const had = rev.length;
    if (rev.length) rev[0].click();
    K.verify = orig;
    return { had, seen, value: $gameVariables.value(14) };
  });
  check('reverting a row goes through the same verified write the Variables panel uses',
    revert.had >= 1 && revert.seen.indexOf('vars.set') > -1 && revert.value === 7,
    JSON.stringify(revert));

  const revertDegraded = await ev(() => {
    const G = window.GigaHack;
    $gameVariables.setValue(14, 777);
    /* Force the control degraded exactly the way a plugin that recomputes the
       value would: write, read back something else. */
    G.compat.verify('vars.set', function () { }, function () { return 'not what was asked'; }, 424242);
    G.ui.rerender();
    const btns = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'));
    const rev = btns.filter(b => b.textContent === 'revert');
    const disabled = rev.length && rev.every(b => b.classList.contains('mm-dis'));
    const wrapped = rev.length && rev.every(b => b.parentNode && b.parentNode.getAttribute &&
      /Cannot revert\|/.test(b.parentNode.getAttribute('data-mm-tip') || ''));
    const body = document.querySelector('#mm-root .mm-body');
    const said = body ? /writes here are not sticking/.test(body.textContent) : false;
    G.compat.clearDegraded();
    $gameVariables.setValue(14, 7);
    return { count: rev.length, disabled, wrapped, said };
  });
  check('a revert greys itself with that control\'s own reason when the verified write is degraded, and the reason stays readable',
    revertDegraded.count >= 1 && revertDegraded.disabled && revertDegraded.wrapped && revertDegraded.said,
    JSON.stringify(revertDegraded));

  await ev(() => {
    const G = window.GigaHack;
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub.debug = 'Compare';
    G.store.cfgSet('snapshot.diff.a', 1);
    G.store.cfgSet('snapshot.diff.b', 2);
    G.ui.rerender();
  });
  const pressed = await ev(() => {
    const btn = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'))
      .filter(b => b.textContent === 'compare' && !b.classList.contains('mm-dis'))[0];
    if (btn) btn.click();
    return !!btn;
  });
  await page.waitForTimeout(220);
  const comparePanel = await ev(() => {
    const body = document.querySelector('#mm-root .mm-body');
    const text = body ? body.textContent : '';
    return {
      text: text.slice(0, 6000),
      rows: document.querySelectorAll('#mm-root .mm-tbody .mm-tr').length,
      held: window.GigaHack.snap.held(),
      summary: /slot 1 \(00:10:00\) → slot 2 \(00:25:00\)/.test(text),
      play: /15 minutes of play between them/.test(text),
      notCompared: /questLog/.test(text) === false
    };
  });
  check('the Compare panel reads two slots on demand and says how much play sits between them',
    pressed && comparePanel.summary && comparePanel.play && comparePanel.rows > 4,
    JSON.stringify({ pressed, summary: comparePanel.summary, play: comparePanel.play, rows: comparePanel.rows }) +
    ' ' + comparePanel.text.slice(0, 200));
  check('at most one anchor and two compared sides are held at a time',
    comparePanel.held.anchor === 1 && comparePanel.held.sides <= 2,
    JSON.stringify(comparePanel.held));
  await shot('snapshot-compare');

  const noWrite = await ev(() => JSON.stringify(StorageManager._files).length);
  const noWriteBefore = await ev(() => window.__snapFilesAtCompare);
  check('the compare panel never writes a save — the module names no storage write anywhere in its source',
    !/StorageManager\s*\.\s*(save|saveObject|remove)\b/.test(CODE) &&
    !/saveGlobalInfo/.test(CODE) &&
    !/DataManager\s*\.\s*saveGame\s*\(/.test(CODE) &&
    !/DataManager\s*\.\s*loadGame/.test(CODE),
    'source scan');

  const filesStable = await ev(async () => {
    const before = JSON.stringify(StorageManager._files);
    await window.__snapRead(1);
    await window.__snapRead(2);
    await window.__snapRead(3);
    return JSON.stringify(StorageManager._files) === before;
  });
  check('and every slot file is byte-identical after three of them have been read',
    filesStable === true, String(filesStable));

  const otherBuild = await ev(async () => {
    const G = window.GigaHack;
    G.store.cfgSet('snapshot.diff.a', 3);      // written with a different versionId
    G.store.cfgSet('snapshot.diff.b', -1);
    G.ui.rerender();
    await window.__snapRead(3);
    const btn = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'))
      .filter(b => b.textContent === 'compare' && !b.classList.contains('mm-dis'))[0];
    if (btn) btn.click();
    return !!btn;
  });
  await page.waitForTimeout(200);
  const otherBuildText = await ev(() => {
    const body = document.querySelector('#mm-root .mm-body');
    return body ? body.textContent : '';
  });
  check('a save from a different build of the project is flagged before its variable ids are believed',
    otherBuild && /different build of the project/.test(otherBuildText),
    otherBuildText.slice(0, 160));

  const plainInPanel = await ev(async (names) => {
    const G = window.GigaHack;
    const saved = {};
    names.forEach(n => { saved[n] = window[n]; window[n] = undefined; });
    let text = '';
    try {
      G.snap.setAnchor(G.snap.anchor());
      const held = G.snap.held();
      /* Drop what was already read so the panel opens the file again with the
         classes gone. */
      const reread = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'))
        .filter(b => b.textContent === 're-read')[0];
      if (reread) reread.click();
      const btn = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'))
        .filter(b => b.textContent === 'compare' && !b.classList.contains('mm-dis'))[0];
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 150));
      const body = document.querySelector('#mm-root .mm-body');
      text = body ? body.textContent : '';
    } finally {
      names.forEach(n => { window[n] = saved[n]; });
    }
    return text.slice(0, 6000);
  }, CLASSES);
  check('the Compare panel says which sections arrived as plain data, rather than showing them as read',
    /arrived as plain data/.test(plainInPanel), plainInPanel.slice(0, 160));

  const extraInPanel = await ev(async () => {
    const G = window.GigaHack;
    G.store.cfgSet('snapshot.diff.a', 4);      // the slot with the plugin's own section
    G.store.cfgSet('snapshot.diff.b', -1);
    G.ui.rerender();
    const reread = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'))
      .filter(b => b.textContent === 're-read')[0];
    if (reread) reread.click();
    const btn = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'))
      .filter(b => b.textContent === 'compare' && !b.classList.contains('mm-dis'))[0];
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 150));
    const body = document.querySelector('#mm-root .mm-body');
    return body ? body.textContent.slice(0, 6000) : '';
  });
  check('a top-level section written by another plugin is listed in the panel and marked not compared',
    /questLog/.test(extraInPanel) && /not compared/.test(extraInPanel),
    extraInPanel.slice(0, 160));

  const noShape = await ev(() => {
    const G = window.GigaHack;
    const lo = StorageManager.loadObject, l = StorageManager.load, mk = DataManager.makeSavename;
    StorageManager.loadObject = undefined; StorageManager.load = undefined;
    DataManager.makeSavename = undefined;
    const available = G.snap.available();
    const reason = G.snap.reason();
    G.ui.rerender();
    const body = document.querySelector('#mm-root .mm-body');
    const text = body ? body.textContent : '';
    const tables = document.querySelectorAll('#mm-root .mm-table').length;
    StorageManager.loadObject = lo; StorageManager.load = l; DataManager.makeSavename = mk;
    G.ui.rerender();
    return { available, reason, text: text.slice(0, 1200), tables };
  });
  check('when neither storage read shape is present the panel names the two it looked for and stops',
    noShape.available === false &&
    /loadObject/.test(noShape.reason) && /makeSavename/.test(noShape.reason) && /load\(\)/.test(noShape.reason) &&
    /Nothing on this panel can run/.test(noShape.text) && noShape.tables === 0,
    JSON.stringify({ available: noShape.available, tables: noShape.tables }) + ' ' + noShape.text.slice(0, 120));

  const settingsRead = await ev(() => {
    const G = window.GigaHack;
    /* Every key this module reads has to answer with its default when it is
       not in the settings file at all, because it is not in Store's DEFAULTS. */
    const had = G.cfg.snapshot;
    delete G.cfg.snapshot;
    const out = {
      auto: G.store.cfgGet('snapshot.autoAnchor', true),
      shows: G.snap.sections().length,
      took: !!G.snap.take({ origin: 'live' }),
      notCompared: G.snap.notCompared().length
    };
    G.cfg.snapshot = had;
    return out;
  });
  check('every snapshot setting answers with its default on a settings file written before this module existed',
    settingsRead.auto === true && settingsRead.shows === 9 && settingsRead.took &&
    settingsRead.notCompared >= 5, JSON.stringify(settingsRead));

  /* =========================================================================
     5 — PUT IT ALL BACK
     ====================================================================== */
  const restored = await ev((names) => {
    const G = window.GigaHack;
    const keep = window.__snapKeep;
    names.forEach(n => { window[n] = keep.globals[n]; });
    StorageManager._files = JSON.parse(keep.files);
    if (keep.globalInfo !== null) DataManager._globalInfo = JSON.parse(keep.globalInfo);
    $gameVariables._data = keep.vars;
    $gameSwitches._data = keep.switches;
    $gameSelfSwitches._data = keep.self;
    $gameParty._gold = keep.gold;
    $gameParty._items = keep.items;
    $gameParty._weapons = keep.weapons;
    $gameParty._armors = keep.armors;
    $gameParty._actors = keep.actors;
    $gameMap._mapId = keep.mapId;
    $gamePlayer._x = keep.px; $gamePlayer._y = keep.py; $gamePlayer._direction = keep.pd;
    Graphics.frameCount = keep.frameCount;
    $dataSystem.versionId = keep.versionId;
    $gameSystem._versionId = keep.sysVersion;
    $gameSystem._saveCount = keep.saveCount;
    $gameSystem._framesOnSave = keep.framesOnSave;
    DataManager.makeSaveContents = keep.makeSaveContents;
    G.snap.forget();
    G.compat.clearDegraded();
    G.eng.invalidateSaveInfo();
    G.cfg.snapshot = JSON.parse(keep.snapCfg);
    G.cfg.ui.tab = keep.tab;
    G.cfg.ui.sub = JSON.parse(keep.sub);
    G.store.saveSettings();
    G.ui.setOpen(keep.open);
    G.ui.rerender();
    delete window.__snapSave; delete window.__snapRead;
    delete window.__snapFacts; delete window.__snapVar; delete window.__snapKeep;
    /* Measured against what was there BEFORE, not against a literal: a later
       check inheriting this module's gold, its saves or its anchor would be a
       failure attributed to whatever ran next. */
    return {
      files: JSON.stringify(StorageManager._files) === keep.files,
      gold: $gameParty._gold === keep.gold,
      mapId: $gameMap._mapId === keep.mapId,
      vars: JSON.stringify($gameVariables._data) === JSON.stringify(keep.vars),
      self: JSON.stringify($gameSelfSwitches._data) === JSON.stringify(keep.self),
      frames: Graphics.frameCount === keep.frameCount,
      version: $dataSystem.versionId === keep.versionId,
      makeSaveContents: DataManager.makeSaveContents === keep.makeSaveContents,
      anchor: G.snap.anchor() === null,
      held: G.snap.held()
    };
  }, GLOBALS);
  check('the snapshot checks leave the game, the save folder and the settings exactly as they found them',
    restored.files && restored.gold && restored.mapId && restored.vars && restored.self &&
    restored.frames && restored.version && restored.makeSaveContents &&
    restored.anchor && restored.held.sides === 0 && restored.held.anchor === 0,
    JSON.stringify(restored));
};
