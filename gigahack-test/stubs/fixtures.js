/* =============================================================================
   GigaHack test harness — stubs/fixtures.js
   The database, the game objects and the scene the checks run against.

   Loaded AFTER core.js, engine-*.js and (where present) plugins-mv.js, and
   BEFORE the 26 plugin tags. Nothing here is engine-specific; it reads the
   engine surface the previous file installed.

   This is a GENERIC project, not one game. The section-header convention is
   "-- Title" because it is the widespread one, but nothing depends on that
   being the answer: __useSectionConvention(false) rebuilds the tables with no
   convention at all, which is how the "detection returns null" check is run.
   ========================================================================== */

function mk(n, f) { var a = [null]; for (var i = 1; i <= n; i++) a.push(f(i)); return a; }
window.__mk = mk;

/* ---------------------------------------------------------------------------
   $dataSystem.

   Gaps are left unnamed on purpose: a real project leaves room for later
   additions, and a section's range must not stop at its last named entry.
   ------------------------------------------------------------------------ */
/* Detection needs a real SIGNAL, not one entry that happens to start with a
   dash: $.profile requires at least three headers AND at least 1% of named
   entries. These tables carry ~1.6%, which is what a project that actually
   uses the convention looks like. A thinner sprinkling is a different test,
   and __useSectionConvention(false) is how it is run. */

/* Two INDEPENDENT knobs, because they answer two different questions: does
   this project mark sections at all, and does it name anything in quest-shaped
   chains. Folding them into one flag would make "no groups, no panel" and
   "no convention, no gallery" the same test, and they are not. */
var USE_CONVENTION = true;
var USE_QUEST_NAMES = true;

/* Quest-shaped names, laid over the flat sw_/var_ tables.

   The flat names ARE the adversarial case: a stem rule that only wanted one
   shared leading token would swallow all 1100 sw_N into one meaningless
   "quest", which is why the rule needs two shared leading tokens plus an
   ordinal tail. These two chains are what a rule like that has to find
   ANYWAY — one sitting under the '-- Quests' header at 141, and one in the
   700s with no header above it at all, because a real project's later chains
   are dropped into whatever gap was free. */
var QUEST_SWITCH_NAMES = {
  142: 'quest_bakery_1', 143: 'quest_bakery_2', 144: 'quest_bakery_3',
  145: 'quest_bakery_4', 146: 'quest_bakery_5',
  731: 'ch_shrine_a_1', 732: 'ch_shrine_a_2', 733: 'ch_shrine_a_3', 734: 'ch_shrine_a_4'
};
/* Every chain in a real project has a progress counter beside it. */
var QUEST_VARIABLE_NAMES = { 106: 'quest_bakery_step' };

function buildVariables() {
  var heads = { 1: 'Story', 21: 'Debug', 101: 'Stats', 301: 'Timers', 601: 'Flags' };
  var a = [null];
  for (var i = 1; i <= 1400; i++) {
    if (USE_QUEST_NAMES && QUEST_VARIABLE_NAMES[i]) a.push(QUEST_VARIABLE_NAMES[i]);
    else if (USE_CONVENTION && heads[i]) a.push('-- ' + heads[i]);
    else if (USE_CONVENTION && i % 100 === 1) a.push('-- Group ' + Math.floor(i / 100));
    else if (i % 7 === 0) a.push('');                      // an unfilled gap
    else a.push('var_' + i);
  }
  return a;
}
function buildSwitches() {
  var heads = {
    101: 'Locations', 141: 'Quests', 401: 'Scenes', 501: 'Region',
    661: 'Epilogue', 861: 'Trophies', 921: 'Endings', 1001: 'Extras',
    301: 'Chains', 64: 'Control'
  };
  var a = [null];
  for (var i = 1; i <= 1100; i++) {
    if (USE_QUEST_NAMES && QUEST_SWITCH_NAMES[i]) a.push(QUEST_SWITCH_NAMES[i]);
    else if (USE_CONVENTION && heads[i]) a.push('-- ' + heads[i]);
    else if (USE_CONVENTION && i % 50 === 1 && i > 1) a.push('-- Collection ' + Math.floor(i / 50));
    else if (i % 13 === 0) a.push('');
    else a.push('sw_' + i);
  }
  return a;
}

var $dataSystem = {
  gameTitle: 'Harness Project',
  variables: buildVariables(),
  switches: buildSwitches(),
  equipTypes: ['', 'Weapon', 'Shield', 'Head', 'Body', 'Accessory'],
  weaponTypes: ['', 'Sword', 'Staff', 'Bow'],
  armorTypes: ['', 'General', 'Magic', 'Light', 'Heavy'],
  skillTypes: ['', 'Magic', 'Special'],
  /* terms.params is EIGHT entries here where the engine ships ten (HIT and EVA
     are the missing two), because a project that never displays them is a real
     project. __extendDatabase() at the end of this file adds terms.basic,
     terms.commands and terms.messages from x-misc.js — including the TWO NULLS
     that both engines really ship at commands[20] and commands[23], which is
     the hole any table view or export has to survive. */
  terms: { params: ['Max HP', 'Max MP', 'ATK', 'DEF', 'MATK', 'MDEF', 'AGI', 'LUCK'] },
  versionId: 12345,
  elements: ['', 'Physical', 'Fire', 'Ice', 'Thunder', 'Water', 'Earth', 'Wind', 'Light', 'Dark'],
  advanced: { gameId: 424242 },

  /* Scene_Title reads all four of these before a single window exists
     (MV rpg_scenes.js:497-527 / MZ rmmz_scenes.js:566-617), so a harness
     without them fails inside the engine rather than in the code under test.
     optDrawTitle is the editor's "Draw Game Title" checkbox. */
  title1Name: 'Castle', title2Name: '', optDrawTitle: true,

  /* ONE audio name carries a SUBFOLDER, and it has to be a real one: MV builds
     its url with encodeURIComponent (which escapes the '/') and MZ with
     Utils.encodeURI (which does not), so 'pack1/Overture' is the only shape
     that tells the two apart. Everything else in the audio block comes from
     __extendDatabase(); this row is written here so the trap is present by
     default rather than opt-in. */
  titleBgm: { name: 'pack1/Overture', volume: 90, pitch: 100, pan: 0 },

  /* The other named rows, pointed at the audio tree the virtual filesystem
     really carries — except gameoverMe, which names a file that is not there.
     Both answers have to be reachable: a database name with a file behind it
     and a database name with nothing behind it are the two states a "what does
     this row actually play" panel exists to tell apart, and a fixture where
     every name resolves can only ever produce one of them. */
  battleBgm: { name: 'Battle1', volume: 90, pitch: 100, pan: 0 },
  victoryMe: { name: 'Victory1', volume: 90, pitch: 100, pan: 0 },
  defeatMe: { name: 'Defeat1', volume: 90, pitch: 100, pan: 0 },
  gameoverMe: { name: 'Requiem', volume: 90, pitch: 100, pan: 0 },

  /* Encryption as a project SHIPS it — the data says yes, and the engine-side
     flags stay off until something copies them across. That copy is Scene_Boot's
     job on both engines and window.__applyEncryption() is how a check makes it,
     so the default harness is an unencrypted RUNTIME reading an encrypted
     PROJECT, which is exactly the state a mod meets before boot finishes. */
  hasEncryptedAudio: true,
  hasEncryptedImages: true,
  encryptionKey: 'd41d8cd98f00b204e9800998ecf8427e'
};

/* iconSize is MZ-ONLY in a real project: an MV System.json has no iconSize, no
   tileSize and no faceSize at all. Setting it unconditionally handed the MV
   harness a key no MV game has, so it is written only where it belongs and the
   MV side keeps the absence the engine's own readers branch on. */
if (Utils.RPGMAKER_NAME === 'MZ') $dataSystem.iconSize = 32;

/* MZ's Scene_Title.createCommandWindow reads this before it can lay a window
   out (rmmz_scenes.js:594); MV's title has no such record. */
if (Utils.RPGMAKER_NAME === 'MZ') {
  $dataSystem.titleCommandWindow = { background: 0, offsetX: 0, offsetY: 0 };
}

/* Swap the naming convention out from under the mod, for the Profile
   detection checks. Rebuilds the tables in place so live references stay
   valid, exactly as a database reload would. */
function rebuildNameTables() {
  $dataSystem.variables = buildVariables();
  $dataSystem.switches = buildSwitches();
}
window.__useSectionConvention = function (on) {
  USE_CONVENTION = !!on;
  rebuildNameTables();
};
/* The same door for the quest chains, so "this project names nothing in
   chains, therefore there are no quests to group" is a check with a real
   fixture behind it rather than a theory about a table nobody built. */
window.__useQuestNames = function (on) {
  USE_QUEST_NAMES = !!on;
  rebuildNameTables();
};

/* ---------------------------------------------------------------------------
   The database. Sizes are deliberately unround so a computed Forge base is
   visibly a computation and not a coincidence.

   EVERY ROW THAT CAN REACH traitObjects() CARRIES A `traits` ARRAY.
   Game_BattlerBase.allTraits does `r.concat(obj.traits)` with no guard
   (x-equip.js:130), and traitObjects hands it the actor record, the class
   record, every equipped item and every state — so a single row missing the
   array takes down equipSlots(), canEquip(), refresh() and therefore every
   equipment panel, with an error thrown three frames away from the row that
   caused it. Every stock engine record ships one; a fixture without them is
   the outlier, not the engine.
   ------------------------------------------------------------------------ */
var $dataItems = mk(700, function (i) {
  return { id: i, name: 'Item ' + i, iconIndex: 160 + (i % 40), price: i * 10, itypeId: i % 20 === 0 ? 2 : 1, description: 'desc ' + i, params: null, note: '' };
});
var $dataWeapons = mk(126, function (i) {
  return {
    id: i, name: 'Weapon ' + i, iconIndex: 96 + (i % 16), price: i * 50, etypeId: 1,
    wtypeId: 1 + (i % 3), params: [0, 0, i, 0, 0, 0, 0, 0],
    /* Two lines every third row, one line otherwise. The editor's description
       box is two lines tall and a game fills both; anything that splits on
       '\n' to recover the author's line break has no case to answer against a
       table where every description is ''. */
    description: (i % 3 === 0) ? ('A plain blade.\nWorn edge, honest weight.') : ('A weapon, number ' + i + '.'),
    traits: [{ code: 31, dataId: 1, value: 0 }],
    note: ''
  };
});
var $dataArmors = mk(400, function (i) {
  return {
    id: i, name: 'Armor ' + i, iconIndex: 128 + (i % 16), price: i * 40,
    etypeId: 2 + (i % 4), atypeId: 1, params: [i, 0, 0, i % 7, 0, 0, 0, 0],
    description: (i % 5 === 0) ? ('Padded and patched.\nIt has seen a winter.') : ('Armour, number ' + i + '.'),
    traits: [{ code: 22, dataId: 1, value: 0.02 }],
    note: ''
  };
});
var $dataSkills = mk(1100, function (i) {
  /* message1/message2 are added by __extendDatabase() at the end of this file
     — the battle log prefixes message1 with the subject's name and message2
     without, and either may be '' for a skill that announces nothing. */
  return { id: i, name: 'Skill ' + i, iconIndex: 64 + (i % 16), description: 'sk ' + i, mpCost: i % 20, tpCost: 0, note: '' };
});
/* A STATE HAS NO description ON EITHER ENGINE — there is no read site for one
   in either rpg_windows.js or rmmz_windows.js — so none is written here. Its
   four message fields come from __extendDatabase(). */
var $dataStates = mk(250, function (i) { return { id: i, name: 'State ' + i, iconIndex: (i % 16), traits: [], note: '' }; });
var $dataClasses = mk(38, function (i) {
  return {
    id: i, name: 'Class ' + i, note: '',
    params: (function () { var p = []; for (var k = 0; k < 8; k++) { var r = []; for (var l = 0; l <= 99; l++) r.push(10 + k * 3 + l * 2); p.push(r); } return p; })(),
    /* The editor's own default curve: [basis, extra, accelerationA,
       accelerationB]. Without it the verbatim expForLevel divides by
       undefined and every level readout is NaN. */
    expParams: [30, 20, 30, 30],
    /* Traits are filled in below, per class, because the whole point of the
       class table is that the five classes DISAGREE about what they may hold. */
    traits: [],
    learnings: []
  };
});

/* ---------------------------------------------------------------------------
   CLASS EQUIP PERMISSIONS — the reason 'cannot equip' is testable at all.

   The fixture's weapons are wtypeId 1..3 (Sword/Staff/Bow) and every armor is
   atypeId 1, so these five classes cover the whole permission surface:

     1  every weapon type            the everything-fits baseline
     2  ONLY wtypeId 1               hand it a Staff and canEquip is false —
                                     the forced-then-released path
     3  all types + SEAL on etype 5  a sealed slot: force it and the seal
                                     undoes it on the next refresh
     4  all types + LOCK on etype 4  a locked slot: force WALKS PAST a lock and
                                     the item stays. Lock and seal read alike
                                     in isEquipChangeOk and behave oppositely
                                     under force, which is the asymmetry
     5  all types + SLOT_TYPE 1      dual wield: equipSlots() becomes
                                     [1,1,3,4,5], so a kit captured from a
                                     single-wield actor lands a shield in a
                                     slot that now only takes weapons

   dataId on code 55 is the SLOT TYPE and 1 means dual wield; dataId 0 does
   nothing at all, which is the quiet way to write a dual-wield trait that
   never fires.
   ------------------------------------------------------------------------ */
(function classEquipTraits() {
  var W = 51, A = 52, LOCK = 53, SEAL = 54, SLOT = 55;
  function wtypes(cls, ids) {
    for (var i = 0; i < ids.length; i++) cls.traits.push({ code: W, dataId: ids[i], value: 1 });
    cls.traits.push({ code: A, dataId: 1, value: 1 });
  }
  wtypes($dataClasses[1], [1, 2, 3]);
  wtypes($dataClasses[2], [1]);
  wtypes($dataClasses[3], [1, 2, 3]);
  $dataClasses[3].traits.push({ code: SEAL, dataId: 5, value: 1 });   // Accessory sealed
  wtypes($dataClasses[4], [1, 2, 3]);
  $dataClasses[4].traits.push({ code: LOCK, dataId: 4, value: 1 });   // Body locked
  wtypes($dataClasses[5], [1, 2, 3]);
  $dataClasses[5].traits.push({ code: SLOT, dataId: 1, value: 1 });   // dual wield
  /* The other 33 classes get the baseline, so an actor of any class can hold
     something and "nobody can equip anything" is never the reason a check
     passes. */
  for (var c = 6; c < $dataClasses.length; c++) wtypes($dataClasses[c], [1, 2, 3]);

  /* ONE class with a real learning. Without it "raising the level learns a
     skill" has nothing to observe and the class -> level -> skills ordering
     has nothing to get wrong. The rest stay empty, which is also common. */
  $dataClasses[1].learnings = [{ level: 12, skillId: 40, note: '' }];
}());

var $dataActors = mk(61, function (i) {
  return {
    id: i, name: 'Actor ' + i, classId: 1 + ((i - 1) % 5), initialLevel: 5, maxLevel: 99, equips: [0, 0, 0, 0, 0],
    nickname: '', profile: '', note: '', traits: [],
    faceName: 'Actor' + (1 + ((i - 1) % 4)), faceIndex: (i - 1) % 8,
    characterName: 'Actor' + (1 + ((i - 1) % 4)), characterIndex: (i - 1) % 8,
    battlerName: 'Actor' + (1 + ((i - 1) % 4)) + '_1'
  };
});
/* A handful of actors with a real nickname and a real profile. All 61 blank
   was a table that could not fail: actor.nickname() and actor.profile() are
   read by the party panel and round-tripped by the Forge, and an empty string
   round-trips whether or not the code that moved it works. The multi-line
   profile is the engine's own shape — the editor's profile box is two lines. */
(function actorText() {
  var rows = [
    [1, 'the Unhurried', 'Left home on a Tuesday.\nHas not written since.'],
    [2, 'Quartermaster', 'Counts everything twice.'],
    [3, 'the Sparrow', ''],
    [5, '', 'No name worth the ink.\nNo nickname either.']
  ];
  for (var i = 0; i < rows.length; i++) {
    $dataActors[rows[i][0]].nickname = rows[i][1];
    $dataActors[rows[i][0]].profile = rows[i][2];
  }
  /* ONE actor with a lower level cap, so a kit recorded at level 40 and
     restored onto it is CLAMPED and said to be clamped, rather than silently
     applied at a level the class curve has no row for. */
  $dataActors[3].maxLevel = 20;
}());
var $dataEnemies = mk(140, function (i) {
  return {
    id: i, name: 'Enemy ' + i, exp: i * 7, gold: i * 13,
    params: [100 + i, 20, 15 + i, 12, 14, 11, 10, 5],
    dropItems: [{ kind: 1, dataId: (i % 50) + 1, denominator: 2 + (i % 8) },
    { kind: 2, dataId: (i % 20) + 1, denominator: 20 },
    { kind: 0, dataId: 0, denominator: 1 }],
    traits: [{ code: 11, dataId: 2, value: 1 + ((i % 5) * 0.25) }, { code: 11, dataId: 3, value: 0.5 },
    { code: 13, dataId: 4, value: 0 }, { code: 14, dataId: 6, value: 1 }],
    note: i === 7 ? 'boss: phase 2 at 50%' : ''
  };
});

/* Page condition block, in the shape the editor writes it. */
function conds(o) {
  return Object.assign({
    actorId: 1, actorValid: false, itemId: 1, itemValid: false,
    selfSwitchCh: 'A', selfSwitchValid: false, switch1Id: 1, switch1Valid: false,
    switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0
  }, o || {});
}
function page(o) {
  return Object.assign({
    conditions: conds(o && o.conditions), directionFix: false, image: {},
    moveFrequency: 3, moveRoute: {}, moveSpeed: 3, moveType: 0, priorityType: 1,
    stepAnime: false, through: false, trigger: 0, walkAnime: true, list: []
  }, o || {}, { conditions: conds(o && o.conditions) });
}
function cmd(code, indent, params) { return { code: code, indent: indent || 0, parameters: params || [] }; }
window.__page = page; window.__cmd = cmd;

var $dataTroops = (function () {
  var a = [null];
  for (var i = 1; i <= 90; i++) {
    a.push({
      id: i, name: 'Troop ' + i,
      members: [{ enemyId: 1 + (i % 140), x: 400, y: 300 }, { enemyId: 1 + ((i * 7) % 140), x: 600, y: 300 }],
      pages: [{ list: [] }]
    });
  }
  /* TWO troops with a real battle page. Every troop page carrying `list: []`
     made the troop half of every "where does this text live" and "who writes
     this switch" answer vacuously empty — a scan that walks troop pages and
     finds nothing cannot be told from one that never walked them. Troop 3 is
     the one map 14's encounter table rolls, so it is the one a player meets. */
  a[3].pages = [{
    list: [
      cmd(101, 0, ['', 0, 0, 2, '']),
      cmd(401, 0, ['Something moves in the grass.']),
      cmd(121, 0, [301, 301, 0]),
      cmd(0, 0, [])]
  }];
  a[4].pages = [{
    list: [
      cmd(101, 0, ['', 0, 0, 2, '']),
      cmd(401, 0, ['It has been waiting a while.']),
      cmd(122, 0, [11, 11, 0, 0, 1]),
      cmd(0, 0, [])]
  }];
  return a;
})();

var $dataMapInfos = (function () {
  var a = [null];
  var defs = [[1, 'Universe', 0, 1], [2, 'Reality', 1, 2], [3, 'Interior', 1, 30], [4, 'Capital', 1, 49],
  [5, 'Shrine', 14, 104], [6, 'Town', 14, 67], [7, 'Guild', 6, 68],
  [8, 'Chapel', 6, 69], [12, 'Cellar', 6, 70], [14, 'Overworld', 2, 10], [90, 'Test', 0, 900]];
  defs.forEach(function (d) { a[d[0]] = { id: d[0], name: d[1], parentId: d[2], order: d[3], expanded: false, scrollX: 0, scrollY: 0 }; });
  for (var i = 1; i <= 319; i++) if (!a[i]) a[i] = { id: i, name: 'Map' + i, parentId: (i % 3 === 0 ? 14 : 2), order: i, expanded: false };
  return a;
})();

var $dataTilesets = [null, {
  id: 1, name: 'ts',
  /* NINE names, always, on both engines. Sprite_Character.tilesetBitmap indexes
     this array by (tileId >> 8) with no bounds test, so a shorter array is an
     undefined dereference inside updateFrame rather than a missing graphic. The
     empty strings are real: an editor tileset with only two sheets filled still
     ships nine slots. */
  tilesetNames: ['World', 'World_B', '', '', 'Inside_A2', '', '', '', ''],
  flags: (function () { var f = []; for (var i = 0; i < 8192; i++) f.push(i < 16 ? 0x0f : 0); return f; })()
}];

var $dataMap = {
  width: 17, height: 13, tilesetId: 1, encounterList: [], data: new Array(17 * 13 * 6).fill(100),

  /* The map's own audio block. Game_Map.autoplay reads all four
     (x-misc.js:388), and the two checkboxes are INDEPENDENT of whether the
     records hold a name: this map plays its bgm and deliberately plays no bgs,
     while still shipping a bgs record with an empty name — which is exactly
     what the editor writes and what a round-trip has to preserve. */
  bgm: { name: 'Field1', volume: 90, pitch: 100, pan: 0 },
  bgs: { name: '', volume: 0, pitch: 0, pan: 0 },
  autoplayBgm: true,
  autoplayBgs: false,

  events: [null,
    /* 1 — a chest: page 1 loots and sets self-switch A, page 2 is the empty
       aftermath. The event-overlay acceptance case. */
    {
      id: 1, name: 'chest_37', x: 8, y: 6, note: 'loot: potion', pages: [
        page({
          trigger: 0, list: [
            cmd(250, 0, [{ name: 'Chest', volume: 90, pitch: 100, pan: 0 }]),
            cmd(126, 0, [3, 0, 0, 1]),
            cmd(101, 0, ['', 0, 0, 2, '']),
            cmd(401, 0, ['You found a Potion!']),
            cmd(123, 0, ['A', 0]),
            cmd(0, 0, [])]
        }),
        page({
          trigger: 0, conditions: { selfSwitchValid: true, selfSwitchCh: 'A' }, list: [
            cmd(108, 0, ['already looted']),
            cmd(0, 0, [])]
        })]
    },
    /* 2 — a parallel process guarding a variable. The last write before the
       terminator is a RANDOM operand (operand 2, range 1..6): it reaches
       Math.random from inside a command, so a roll traced back to "who asked
       for this" has a real caller and not a bare Math.random in a check. */
    {
      id: 2, name: 'baker', x: 3, y: 4, note: '', pages: [
        page({
          trigger: 4, list: [
            cmd(111, 0, [1, 2, 0, 50, 1]),
            cmd(122, 1, [3, 3, 0, 0, 1]),
            cmd(121, 1, [7, 7, 0]),
            cmd(411, 0, []),
            cmd(355, 1, ['$gameParty.gainGold(1);']),
            cmd(655, 1, ['console.log("baked");']),
            cmd(412, 0, []),
            cmd(122, 0, [11, 11, 0, 2, 1, 6]),
            cmd(0, 0, [])]
        })]
    },
    /* 3 — a door, i.e. a Transfer Player the overlay should outline. The Call
       Common Event is what produces a depth-1 CHILD interpreter, so a write
       has to be attributed to the child's list AND to the calling event. */
    {
      id: 3, name: 'door', x: 9, y: 9, note: '', pages: [
        page({
          trigger: 1, conditions: { switch1Valid: true, switch1Id: 9 }, list: [
            cmd(117, 0, [3]),
            cmd(201, 0, [0, 6, 10, 4, 0]),
            cmd(0, 0, [])]
        })]
    }
  ]
};

/* ---------------------------------------------------------------------------
   FOUR MORE EVENT DEFINITIONS, present in $dataMap but NOT instantiated.

   $gameMap._events is asserted to hold exactly the three events above, and it
   should: a map with three events is the honest default and every count that
   reads it is pinned to it. These four exist as DATA so a check can call
   window.__addMapEvents() to bring them to life, look at what it needed, and
   call window.__removeMapEvents() to put the map back. Building them live
   would make the fixture's own idea of "this map" untestable.

     4  gate     an AUTORUN page that never yields — the stuck diagnosis, whose
                 answer has to name both the trigger and the page condition
                 that would release it
     5  warden   ALL SIX condition fields valid at once, so the decoder is
                 exercised end to end rather than one field at a time
     6  statue   three pages where page 2 AND page 3 both qualify, so
                 "shadowed by page 3" has a case (the engine takes the LAST
                 matching page, not the first)
     7  crier    a choice block and a scrolling-text block, so the choice and
                 scrolling collectors have input
   ------------------------------------------------------------------------ */
var EXTRA_MAP_EVENTS = [
  {
    id: 4, name: 'gate', x: 5, y: 5, note: '', pages: [
      page({ trigger: 3, list: [cmd(230, 0, [9999]), cmd(0, 0, [])] })]
  },
  {
    id: 5, name: 'warden', x: 11, y: 3, note: 'guard: needs the seal', pages: [
      page({
        trigger: 0,
        conditions: {
          switch1Valid: true, switch1Id: 141, switch2Valid: true, switch2Id: 9,
          variableValid: true, variableId: 106, variableValue: 2,
          selfSwitchValid: true, selfSwitchCh: 'B',
          itemValid: true, itemId: 12, actorValid: true, actorId: 2
        },
        list: [cmd(108, 0, ['every condition at once']), cmd(0, 0, [])]
      })]
  },
  {
    id: 6, name: 'statue', x: 2, y: 11, note: '', pages: [
      page({ trigger: 0, list: [cmd(108, 0, ['page 1']), cmd(0, 0, [])] }),
      page({
        trigger: 0, conditions: { switch1Valid: true, switch1Id: 9 },
        list: [cmd(108, 0, ['page 2']), cmd(0, 0, [])]
      }),
      page({
        trigger: 0, conditions: { switch1Valid: true, switch1Id: 9 },
        list: [cmd(108, 0, ['page 3 — this is the one that runs']), cmd(0, 0, [])]
      })]
  },
  {
    id: 7, name: 'crier', x: 14, y: 7, note: '', pages: [
      page({
        trigger: 1, list: [
          cmd(102, 0, [['Buy', 'Sell', 'Leave'], 2, 0, 2, 0]),
          cmd(402, 0, [0, 'Buy']),
          cmd(101, 0, ['', 0, 0, 2, '']),
          cmd(401, 0, ['What are you after?']),
          cmd(0, 1, []),
          cmd(402, 0, [1, 'Sell']),
          cmd(0, 1, []),
          cmd(404, 0, []),
          cmd(105, 0, [2, false]),
          cmd(405, 0, ['The market closes at dusk.']),
          cmd(405, 0, ['It has closed at dusk for nine years.']),
          cmd(405, 0, ['Nobody remembers who decided that.']),
          cmd(0, 0, [])]
      })]
  }
];

/* ---------------------------------------------------------------------------
   COMMON EVENTS, one of every shape the panel branches on.

   Two rows with empty lists could not exercise a single control. These nine
   cover: called-only, autorun with its gate off, autorun with its gate on
   (the "already running, refuse to reserve" case), parallel with its gate on,
   parallel with its gate off, the editor's UNSET gate (switchId 0, which is
   why the event never fires no matter what is switched), an empty list (the
   "no commands" refusal), a caller so "who calls this" has a hit, and one
   carrying real message text so a script dump has something to dump.

   Note which ones are ACTIVE at rest: only id 2 is trigger 2 with its switch
   on-able, and switch 5 starts OFF, so $gameMap._commonEvents holds one entry
   with a null interpreter. Nothing here runs until a check turns a switch on.
   ------------------------------------------------------------------------ */
var $dataCommonEvents = [null,
  /* 1 — trigger 0: called only, never fires by itself. The Steam scan
     replaces this list wholesale, so it stays first and stays simple. */
  { id: 1, name: 'Init', trigger: 0, switchId: 1, list: [cmd(108, 0, ['init']), cmd(0, 0, [])] },
  /* 2 — trigger 2 (Parallel), gate switch 5, which starts OFF. The list holds
     a long wait so an interpreter found running here is found PARKED, which is
     what "which switch governs this" has to be answered against. */
  { id: 2, name: 'Tick', trigger: 2, switchId: 5, list: [cmd(230, 0, [600]), cmd(0, 0, [])] },
  /* 3 — the callee of event 3's Call Common Event, and a variable writer, so a
     write can be attributed to a child interpreter's list. */
  { id: 3, name: 'quest_bakery_award', trigger: 0, switchId: 1, list: [cmd(122, 0, [9, 9, 0, 0, 77]), cmd(0, 0, [])] },
  /* 4 — trigger 1 (Autorun) with its gate OFF. */
  { id: 4, name: 'Opening', trigger: 1, switchId: 21, list: [cmd(108, 0, ['opening']), cmd(0, 0, [])] },
  /* 5 — trigger 1 with a gate that a check can turn ON, which is the autorun
     that BLOCKS the player and refuses a reservation behind it. */
  { id: 5, name: 'Cutscene', trigger: 1, switchId: 22, list: [cmd(230, 0, [120]), cmd(0, 0, [])] },
  /* 6 — trigger 2 with a gate a check can turn on independently of id 2, so
     "two parallels at once" is reachable without disturbing the first. */
  { id: 6, name: 'Weather Loop', trigger: 2, switchId: 23, list: [cmd(236, 0, ['rain', 5, 60, false]), cmd(0, 0, [])] },
  /* 7 — the editor's UNSET gate. switchId 0 is what the editor writes when the
     author picked a trigger and never picked a switch, and Game_Switches.value(0)
     is false forever, so this event can never fire. It looks armed and is not. */
  { id: 7, name: 'Never', trigger: 1, switchId: 0, list: [cmd(108, 0, ['unreachable']), cmd(0, 0, [])] },
  /* 8 — no commands at all. A real project has several: the author made the
     row and never filled it. Anything offering to run this must refuse. */
  { id: 8, name: 'Empty', trigger: 0, switchId: 1, list: [] },
  /* 9 — the caller, so "who calls common event 3" has an answer, plus the
     message text a script dump needs and a choice block for the collector. */
  {
    id: 9, name: 'Bakery Chatter', trigger: 0, switchId: 1, list: [
      cmd(117, 0, [3]),
      cmd(101, 0, ['', 0, 0, 2, '']),
      cmd(401, 0, ['The oven is still warm.']),
      cmd(102, 0, [['Wait', 'Go'], 1, 0, 2, 0]),
      cmd(402, 0, [0, 'Wait']),
      cmd(0, 1, []),
      cmd(404, 0, []),
      cmd(0, 0, [])]
  }];

/* ---------------------------------------------------------------------------
   __extendDatabase() — x-misc.js's database shapes, applied.

   It runs HERE, after the whole `var $data*` block, because nothing in
   x-misc*.js can write to a $data global at load time: this file declares them
   all with `var` and loads last, so an assignment over there would simply be
   overwritten and the harness would LOOK as though it had these fields.

   It only ADDS keys that are absent, so everything above is left exactly as
   written. What it supplies that nothing above does:
     $dataSystem   sounds (all 24, in the engine's own slot order — SoundManager
                   dereferences $dataSystem.sounds[n] with no guard, so a
                   harness without it throws inside the manager), battleBgm,
                   victoryMe, defeatMe, gameoverMe and the three vehicles
     terms         basic (10), commands (26 WITH the two nulls both engines
                   really ship at index 20 and 23), the engine's own 10-entry
                   params default is available but the 8 above win, and the
                   41 shared messages merged with each engine's own
     $dataSkills   message1 / message2
     $dataStates   message1..message4, and NO description, because a state has
                   none on either engine and inventing one invents a column
   It throws loudly if terms is missing or if x-misc-mv.js / x-misc-mz.js has
   not loaded, which is the right failure for a harness in the wrong order.
   ------------------------------------------------------------------------ */
window.__extendDatabase();

/* ---------------------------------------------------------------------------
   The game objects. Order matters: $gameMap's events read $dataMap, and every
   event's starting page is only decided once both exist.
   ------------------------------------------------------------------------ */
var $gameVariables = new Game_Variables();
var $gameSwitches = new Game_Switches();
var $gameSelfSwitches = new Game_SelfSwitches();
var $gameActors = new Game_Actors();
var $gamePlayer = new Game_Player();
$gamePlayer._x = 21; $gamePlayer._y = 14;
var $gameParty = new Game_Party();
/* ---------------------------------------------------------------------------
   PARTY OWNERSHIP.

   Empty containers made hasItem() false for everything, so every changeEquip
   refused and every equip check passed for the wrong reason. These counts are
   chosen so at least one armor covers each of the fixture's etypeIds 2..5 and
   the weapon ids span two wtypeIds, and so that MOST of the database is still
   unowned — "the party does not have one" has to stay a reachable answer.

   Item id 3 is deliberately NOT seeded: the inventory checks give ten of it
   and count them, and a fixture holding some already would make that arithmetic
   a coincidence.

   901 is a WEAPON id this build no longer defines. Game_Party.weapons() maps
   ids straight through $dataWeapons with no guard, so the row comes back
   undefined — which is the whole reason a save reader keeps tombstones instead
   of dropping what it cannot resolve. A fixture that only ever held resolvable
   ids could not produce that row.
   ------------------------------------------------------------------------ */
$gameParty._items = { 12: 3, 45: 1, 208: 9 };
$gameParty._weapons = { 1: 2, 4: 1, 901: 1 };
$gameParty._armors = { 1: 1, 5: 1, 9: 1, 14: 1 };
var $gameTemp = new Game_Temp();
var $gameSystem = new Game_System();
var $gameScreen = new Game_Screen();
var $gameTimer = new Game_Timer();
$gameMessage = new Game_Message();
var $gameTroop = new Game_Troop();
var $gameMap = new Game_Map();
/* Indexed by event id, with a hole at 0, exactly as Game_Map.setupEvents
   builds it. events() filters, so every count that reads it is unchanged and
   $gameMap.event(2) now really is event 2.

   Game_Map.setupEvents itself is NOT called: it is modelled per engine for the
   id-vs-index delta and it constructs `new Game_Event(mapId, eventId)` — the
   ENGINE's signature, not core.js's (id, name, x, y). So the events are built
   by hand and then given the two things the engine's own initialize would have
   given them:

     initMembers()   _trigger, _erased, _locked, _originalPattern/_Direction,
                     _prelockDirection and — the load-bearing one — _pageIndex
                     = -2. core.js's constructor leaves it at 0, and refresh()
                     only calls setupPage when the index CHANGES, so an event
                     whose proper page really is 0 would never run setupPage
                     and would never get a _trigger or an _interpreter at all.
     _mapId          the self-switch key in meetsConditions and in command123
                     is built from it; without it the key reads
                     "undefined,1,A" and every self-switch silently misses.
   ------------------------------------------------------------------------ */
$gameMap._events = [];
$gameMap._events[1] = new Game_Event(1, 'chest_37', 8, 6);
$gameMap._events[2] = new Game_Event(2, 'baker', 3, 4);
$gameMap._events[3] = new Game_Event(3, 'door', 9, 9);
$gameMap.events().forEach(function (e) {
  e.initMembers();
  e._mapId = $gameMap.mapId();
  e.refresh();
});

/* ---------------------------------------------------------------------------
   SELF-SWITCHES THAT ARE ACTUALLY ON.

   An empty _data made the self-switch section of every diff empty, so the
   presence half of a diff — a key that exists on one side and not the other —
   was never tested. Four keys across three map ids, chosen so name resolution
   has BOTH answers: 12 and 5 and 14 are real rows in $dataMapInfos, event 1 on
   map 5 is a real event in the map file, and 12/99 names an event id that does
   not exist anywhere, so "the map resolves and the event does not" is a row a
   reader has to render rather than crash on.

   The channels are picked so nothing here changes which page is live: event 1
   on this map keys its second page on channel A, so this file uses B and C
   there and leaves A to the checks that mean to flip it.

   [12,5,'B'] is the NUMBER 1, not `true`. The editor never writes that, but
   JsonEx round-trips and third-party save editors both do, and Game_SelfSwitches
   .value() returns !!v — so anything comparing `=== true` disagrees with the
   engine about a key the engine considers on.
   ------------------------------------------------------------------------ */
$gameSelfSwitches._data[[12, 3, 'A']] = true;
$gameSelfSwitches._data[[12, 5, 'B']] = 1;
$gameSelfSwitches._data[[12, 99, 'C']] = true;
$gameSelfSwitches._data[[5, 1, 'B']] = true;
$gameSelfSwitches._data[[14, 1, 'A']] = true;

/* The interpreter half of the map, which the engine sets in
   Game_Map.prototype.initialize / setupEvents and core.js's bare constructor
   does not. x-interp.js deliberately does not paper over the gap:
   isEventRunning dereferences _interpreter and throws loudly on a map nobody
   wired, which is how this line came to exist rather than being forgotten. */
$gameMap._interpreter = new Game_Interpreter();
/* Built exactly the way Game_Map.setupEvents builds it — rpg_objects.js:5720 /
   rmmz_objects.js:6449 — one Game_CommonEvent per PARALLEL common event and
   none for anything else. Autorun common events get no object at all; they run
   on the map's single interpreter through setupAutorunCommonEvent, which is
   why an autorun blocks the player and a parallel does not. Both entries here
   start with a null interpreter, because both their gate switches start off. */
$gameMap._commonEvents = $gameMap.parallelCommonEvents().map(function (ce) {
  return new Game_CommonEvent(ce.id);
});
if (typeof $gameTroop !== 'undefined' && $gameTroop) {
  $gameTroop._interpreter = new Game_Interpreter();
}

/* Both engines build Game_Followers inside Game_Player.initMembers
   (rpg_objects.js:7420 / rmmz_objects.js:8110); core.js builds it lazily
   inside followers() instead. areFollowersGathering() and gatherFollowers()
   read this._followers DIRECTLY, as the engine does, so they throw until
   something has asked once. Asking once, here, is that something. */
$gamePlayer.followers();

/* ---------------------------------------------------------------------------
   The plugin list.

   Names are generic on purpose: the mod must not recognise a game, and the
   harness must not encode one either. plugins-mv.js adds the modelled
   third-party stack on top of this when it is loaded, and the GigaHack entry
   is appended last by __engineBoot so $.compat.loadOrder() has something real
   to read.
   ------------------------------------------------------------------------ */
var GIGAHACK_MODULES = ['Core', 'Caps', 'Store', 'Profile', 'UI', 'Shell', 'Hooks', 'Tabs',
  'Compat', 'Index', 'Vars', 'Inv', 'Party', 'Backup', 'Map', 'Events', 'Battle', 'Text',
  'Forge', 'Player', 'Encounters', 'Gallery', 'Steam', 'Save', 'Console',
  'Trace', 'Snapshot', 'Quest', 'Media', 'Screen', 'Auto', 'Kit', 'Keys', 'Build',
  'Boot'];

/* ---------------------------------------------------------------------------
   PLUGIN PARAMETERS.

   EVERY VALUE IS A STRING. That is not a simplification, it is the whole
   point: the RPG Maker editor writes js/plugins.js with every parameter
   value quoted, whatever the @type said it was. A number parameter arrives as
   "99", a boolean as "true", a list as a JSON string, and a struct as a JSON
   string containing more JSON strings. A fixture holding a real Number would
   let an editor that forgets to re-stringify look correct here and corrupt
   every real plugins.js — which is the class of bug this table exists to
   catch, so the awkward shape is kept.
   ------------------------------------------------------------------------ */
var PLUGIN_PARAMS = {
  /* The plain shapes, all eight of them on one entry. */
  ui_frame_0: {
    'Menu Label': 'Items',                          // plain text
    'Max Level': '99',                              // a number, as text
    'Show Icon': 'true',                            // a boolean, as text
    'Slots': '["head","body","hands"]',             // a JSON array, as text
    'Colours': '{"hp":"#c33","mp":"#36c"}',         // a JSON object, as text
    'Suffix': '',                                   // empty, and legitimately so
    'Window X': '24',                               // a key with a SPACE in it
    'note:tag': 'frame',                            // a key with a COLON in it
    /* A real newline inside a value. The editor allows it and games use it for
       help text, so any table that renders parameters has to wrap rather than
       clip, and any editor that writes one back has to re-escape it. */
    'Help Text': 'Opens the frame.\nHold shift to open it wide.'
  },
  /* A struct, i.e. JSON nested inside JSON. The inner object's own values are
     strings too, one level down, which is the shape that defeats a single
     JSON.parse and the reason a parameter viewer has to try twice. */
  message_ext_1: {
    'Name Box': '{"x":"12","y":"8","face":"true"}',
    'Presets': '["{\\"speed\\":\\"2\\"}","{\\"speed\\":\\"6\\"}"]'
  },
  battle_hud_3: {
    'Layout': 'compact',
    'Rows': '4'
  },
  /* status:false AND parameters. The engine never registers a disabled entry,
     so PluginManager.parameters() answers {} for it forever: the row must
     still exist and still show these values, and any offer to edit it must be
     refused WITH the reason. */
  audio_ext_5: {
    'Fade Frames': '30',
    'Duck On Message': 'false'
  },
  /* Roughly forty parameters on one entry, so a windowed table has something
     to window and the total row count across the list runs to four figures. */
  lighting_8: (function () {
    var p = { 'Ambient': '#101018', 'Shadow Quality': '2' };
    for (var i = 1; i <= 38; i++) p['Light Preset ' + i] = '{"radius":"' + (i * 8) + '","colour":"#ffcc88"}';
    return p;
  }())
};

var $plugins = (function () {
  var kinds = ['ui_frame', 'message_ext', 'menu_replace', 'battle_hud', 'quest_log',
    'audio_ext', 'weather', 'pathfind', 'lighting', 'shop_ext'];
  var out = [];
  for (var i = 0; i < 40; i++) {
    var name = kinds[i % kinds.length] + '_' + i;
    var entry = { name: name, status: i !== 5, description: 'plugin ' + i };
    /* Entry 12 gets NO `parameters` PROPERTY AT ALL. A hand-edited plugins.js
       really does look like this, and PluginManager.setup files `undefined`
       under the key without complaint — so parameters() answers {} through its
       `|| {}` and anything that walked the entry's own object throws. */
    if (i !== 12) entry.parameters = PLUGIN_PARAMS[name] || {};
    out.push(entry);
  }

  /* ONE ENTRY IN A SUBFOLDER, and the whole reason a key probe exists: MZ
     registers this as `pathfind_41` (PluginManager.setup runs the name through
     Utils.extractFileName) and MV as `sub/pathfind_41` (MV has no such
     function and keys on the full entry). Both lower-cased. A panel that asks
     PluginManager.parameters() with the wrong one gets {} and reports a
     configured plugin as unconfigured — on exactly one of the two engines. */
  out.push({
    name: 'sub/pathfind_41', status: true, description: 'plugin in a subfolder',
    parameters: { 'Grid': '48', 'Diagonal': 'true', 'Cost Map': '{"water":"9","road":"1"}' }
  });

  /* A DUPLICATE NAME PAIR, both enabled, with DIFFERENT parameter objects.
     PluginManager.setup drops the second claim with no error and no log line,
     so the first object is the one the engine holds and the second exists only
     in $plugins. Both rows resolve to one key; both have to say the engine
     kept the first. */
  out.push({ name: 'shop_ext_42', status: true, description: 'shop extension', parameters: { 'Markup': '120' } });
  out.push({ name: 'shop_ext_42', status: true, description: 'shop extension (second copy)', parameters: { 'Markup': '80', 'Sell Rate': '0.5' } });

  if (window.__extraPlugins) out = out.concat(window.__extraPlugins);
  /* The installer appends one entry per module to the END of js/plugins.js,
     which is what makes GigaHack's aliases outermost. $.compat.loadOrder()
     checks that at runtime and names anything that loads after us. */
  GIGAHACK_MODULES.forEach(function (m) {
    out.push({ name: 'GigaHack_' + m, status: true, description: 'GigaHack ' + m, parameters: {} });
  });
  return out;
})();

/* PluginManager.setup runs the real dedup for whichever engine is loaded:
   MV keys _scripts on the FULL plugin.name via Array.prototype.contains,
   MZ on Utils.extractFileName(plugin.name). Run here, before the module
   scripts, because that is the order the engine does it in. */
PluginManager.setup($plugins);

SceneManager._scene = new Scene_Map();

/* ---------------------------------------------------------------------------
   A scene worth inspecting: a gold window, a status window and a loose sprite,
   in canvas coordinates. Built through whichever Window the engine file
   installed, so the MV tree really is flat and the MZ tree really is deep.
   ------------------------------------------------------------------------ */
function mkWindow(cls, x, y, w, h, paint) {
  var f = new Function('return function ' + cls + '(){}')();
  f.prototype = Object.create(Window.prototype);
  f.prototype.constructor = f;
  var o = new f();
  Window.prototype.initWindow.call(o, cls, x, y, w, h);
  o._paint = paint;
  return o;
}
window.__mkWindow = mkWindow;

(function buildScene() {
  var scene = SceneManager._scene;
  scene.visible = true;
  scene.children = [];
  var layer = { visible: true, children: [], constructor: { name: 'WindowLayer' } };
  scene.children.push(layer);

  layer.children.push(mkWindow('Window_Gold', 600, 40, 200, 72, function (w) {
    w.drawText('Gold', 0, 0, 80, 'left');
    w.drawText(String($gameParty.gold()), 0, 0, 176, 'right');
  }));
  layer.children.push(mkWindow('Window_Status', 40, 400, 320, 120, function (w) {
    w.drawText($gameParty.leader().name(), 0, 0, 120, 'left');
    w.drawText('var 2', 0, 24, 140, 'left');
    w.drawText(String($gameVariables.value(2)), 140, 24, 140, 'right');
  }));

  var loose = new Sprite(new Bitmap(48, 48));
  loose.visible = true; loose.children = [];
  loose.getBounds = function () { return { x: 200, y: 200, width: 48, height: 48 }; };
  scene.children.push(loose);
  window.__looseSprite = loose;
  window.__windows = layer.children;

  /* On MZ a Sprite_Gauge draws the HP number into its OWN bitmap and lives
     inside the status window via addInnerChild, so it shadows the window in
     any hit test. On MV there is no such class and no such list: the gauge is
     drawn straight into the window's contents by Window_Base.drawGauge, so
     every child of an MV window is furniture. Both shapes are built here from
     whatever the engine file provides. */
  var status = layer.children[1];
  if (typeof Sprite_Gauge !== 'undefined' && status.addInnerChild) {
    var gauge = new Sprite_Gauge();
    gauge.worldTransform = new Transform2D(60, 470);
    gauge.getBounds = function () { return { x: 60, y: 470, width: 128, height: 24 }; };
    gauge.refresh = function () {
      this.bitmap.clear();
      this.bitmap.drawText('HP', 0, 0, 40, 24, 'left');
      this.bitmap.drawText(String($gameParty.members()[0]._hp), 0, 0, 128, 24, 'right');
    };
    status.addInnerChild(gauge);
    window.__gauge = gauge;
  } else {
    status._paintGauge = function (w) { w.drawGauge(0, 48, 128, 0.5, '#0f0', '#0a0'); };
    window.__gauge = null;
  }
})();

/* ---------------------------------------------------------------------------
   SEEDED TEXTURE AND IMAGE CACHES.

   A cache group with nothing in it counts zero and estimates zero bytes, which
   is indistinguishable from a group that failed to read the cache at all. Two
   urls into each PIXI cache, plus the ENGINE's own cache filled through
   whichever shape the engine file installed — MZ keeps two plain objects
   (_cache and _system) and MV one ImageCache instance with an add() method.

   The branch is a FEATURE TEST on the cache, not a test on the engine name.
   That is the same rule the mod follows, and writing it the other way here
   would let a mod that got the rule wrong still pass.
   ------------------------------------------------------------------------ */
(function seedCaches() {
  PIXI.utils = PIXI.utils || {};
  PIXI.utils.TextureCache = PIXI.utils.TextureCache || {};
  PIXI.utils.BaseTextureCache = PIXI.utils.BaseTextureCache || {};
  ['img/system/Window.png', 'img/characters/Actor1.png'].forEach(function (url) {
    PIXI.utils.TextureCache[url] = { width: 192, height: 192, baseTexture: { width: 192, height: 192 } };
    PIXI.utils.BaseTextureCache[url] = { width: 192, height: 192 };
  });
  if (ImageManager._cache) {
    ImageManager._cache['img/characters/Actor1.png'] = new Bitmap(576, 384);
  }
  if (ImageManager._system) {
    ImageManager._system['img/system/Window.png'] = new Bitmap(192, 192);
  }
  if (ImageManager._imageCache) {
    var mvCache = ImageManager._imageCache;
    /* add() runs the engine's budget sweep, so it is the right door when it is
       there. It is not always there: two stub files each declare their own
       ImageCache and the later declaration wins the binding, so the live
       instance can be the reduced one that carries only _items and isReady.
       The fallback writes the record add() would have written — {bitmap, touch,
       key}, the shape isReady and _truncateCache both read — so this group is
       countable either way, and the day the two declarations stop colliding
       the first branch simply takes over. */
    if (mvCache.add) {
      mvCache.add('img/system/Window.png', new Bitmap(192, 192));
      mvCache.add('img/characters/Actor1.png', new Bitmap(576, 384));
    } else if (mvCache._items) {
      mvCache._items['img/system/Window.png'] = { bitmap: new Bitmap(192, 192), touch: 1700000000000, key: 'img/system/Window.png' };
      mvCache._items['img/characters/Actor1.png'] = { bitmap: new Bitmap(576, 384), touch: 1700000000000, key: 'img/characters/Actor1.png' };
    }
  }
}());

/* ---------------------------------------------------------------------------
   MV's boot-time DOM surgery.

   Graphics.initialize() calls _modifyExistingElements (rpg_core.js:1767) and
   _disableTextSelection (:1770) before any plugin has mounted anything. The
   mod always mounts after boot, so running them HERE — before the plugin tags
   — is the faithful order, and it is what makes the "re-assert z-index"
   capability testable rather than theoretical.
   ------------------------------------------------------------------------ */
Graphics.initialize(816, 624);

/* ---------------------------------------------------------------------------
   __engineBoot() — what SceneManager.run + the boot scene do, once the mod's
   own aliases are installed. Called from the shell AFTER the 26 plugin tags,
   because half of what it exercises is those aliases.
   ------------------------------------------------------------------------ */
window.__engineBoot = function () {
  var boot = new Scene_Boot();
  SceneManager._scene = boot;
  boot.start();

  /* Input.initialize() is what binds the real keydown/keyup listeners on
     `document` and the blur listener on `window` (rpg_core.js:2971 /
     rmmz_core.js:5665). Nothing else in the harness calls it, and without it
     there is no engine listener for a capture-phase-versus-bubble-phase key
     test to race against — the test would be measuring an empty room. It also
     re-runs clear(), which is why it happens here, at boot, before anything
     starts counting. */
  Input.initialize();

  var scene = new Scene_Map();
  /* The engine's constructors always ran initialize(); core.js's bare ones do
     not. Running it here gives the live scene the fade state both engines keep
     in DIFFERENT places — MV a _fadeSprite child, MZ a _colorFilter and a
     plain _fadeOpacity — so a fade assertion has a real mechanism to read
     instead of an undefined field that compares false either way. */
  if (scene.initialize) scene.initialize();
  /* Scene_Map.create builds the spriteset on both engines, and the weather
     probe, the tone probe and the scene-fade probe all read through it. The
     constructor does not call initialize() here either, so the spriteset is
     brought up the way the real one comes up. createWeather is NOT part of
     initialize on this harness, so a weather test calls it explicitly — which
     is also how __stickWeather() below reaches it. */
  if (typeof Spriteset_Map !== 'undefined') {
    var ss = new Spriteset_Map();
    if (ss.initialize) ss.initialize();
    scene._spriteset = ss;
  }
  /* One node inside the scene carrying the mod's own marker. A screenshot that
     claims to exclude the mod's drawing has to be able to name what it
     excluded, and with no marked node in the tree that claim is unfalsifiable.
     The marker is a plain property, which is what an overlay sprite would
     carry. */
  var modLayer = new Sprite(new Bitmap(8, 8));
  modLayer.visible = true;
  modLayer.children = [];
  modLayer.__gigahack = true;
  modLayer.name = 'GigaHack overlay';
  if (scene.addChild) scene.addChild(modLayer);
  else (scene.children = scene.children || []).push(modLayer);
  window.__modLayer = modLayer;

  SceneManager._scene = scene;
  SceneManager._sceneStarted = true;

  /* DataManager.onLoad fires per data file; $dataSystem is the one Profile
     and Index care about. */
  DataManager.onLoad($dataSystem);

  /* The frame loop, primed. From here every frame is one __raf.flush(). */
  window.__raf.reset();
  SceneManager.requestUpdate();
};

/* =============================================================================
   A VIRTUAL FILESYSTEM, available but NOT installed.

   The harness is a browser build, so $.caps.fs is false and every module that
   reads the game folder degrades with a reason — which is itself worth
   asserting. But the index's two most valuable stages (cross-map events and
   assets) exist ONLY when there is a filesystem, and a suite that never runs
   them is a suite that never tests the thing the index was built for.

   So both worlds are available. run.js calls __mountVirtualFs() to give the
   mod a game folder to read, and __unmountVirtualFs() to take it away again
   and re-check the degraded path. Nothing is installed by default: the
   default harness stays an honest browser build.

   The map files below are the point of the event stage. Map 5 and map 12 each
   reference switch 141 from a DIFFERENT command shape (a Control Switches
   command and a page condition), so "find every event that touches switch
   141" has to cross files and cross command shapes to answer correctly.
   ========================================================================== */
(function virtualFs() {
  var GAME_ROOT = '/fake/game';
  var files = {};      // full path -> string contents
  var dirs = {};       // full path -> true

  function addDir(p) {
    var parts = p.split('/');
    var cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur = i === 0 ? parts[0] : cur + '/' + parts[i];
      if (cur) dirs[cur] = true;
    }
  }
  function addFile(p, contents) { addDir(p.replace(/\/[^/]*$/, '')); files[p] = contents; }

  function mapFile(id, events, encounterList) {
    return JSON.stringify({
      width: 17, height: 13, tilesetId: 1,
      encounterList: encounterList || [],
      events: [null].concat(events)
    });
  }
  function ev(id, name, x, y, list, conditions) {
    return {
      id: id, name: name, x: x, y: y,
      pages: [{ conditions: conds(conditions), list: list || [] }]
    };
  }

  addFile(GAME_ROOT + '/index.html', '<html></html>');
  addFile(GAME_ROOT + '/data/System.json', JSON.stringify({ gameTitle: $dataSystem.gameTitle }));
  GIGAHACK_MODULES.forEach(function (m) {
    addFile(GAME_ROOT + '/js/plugins/GigaHack_' + m + '.js', '// GigaHack_' + m);
  });

  /* Map 5: a chest that sets switch 141 and reads variable 22, and SAYS
     something — the text commands are here so a cross-map script scan has
     something to find in a file it had to read anyway. */
  addFile(GAME_ROOT + '/data/Map005.json', mapFile(5, [
    ev(1, 'shrine_chest', 4, 4, [
      cmd(121, 0, [141, 141, 0]), cmd(122, 0, [22, 22, 0, 0, 3]),
      cmd(101, 0, ['', 0, 0, 2, '']), cmd(401, 0, ['The shrine is silent.']), cmd(0)]),
    ev(2, 'guard', 6, 2, [cmd(111, 0, [0, 9, 0]), cmd(412, 0, []), cmd(0)])
  ]));
  /* Map 12: a door whose PAGE CONDITION is switch 141 — a different command
     shape entirely, and the one a list-only scan misses. Its choice block is
     the cross-file case for the choice collector: a choice that only exists in
     a map file nobody has loaded. */
  addFile(GAME_ROOT + '/data/Map012.json', mapFile(12, [
    ev(1, 'cellar_door', 8, 8, [
      cmd(102, 0, [['Open it', 'Leave it'], 1, 0, 2, 0]),
      cmd(402, 0, [0, 'Open it']),
      cmd(201, 0, [0, 6, 10, 4, 0]),
      cmd(0, 1, []),
      cmd(402, 0, [1, 'Leave it']),
      cmd(0, 1, []),
      cmd(404, 0, []),
      cmd(0)], { switch1Valid: true, switch1Id: 141 })
  ]));
  /* Map 14: the only map in the project with a random-encounter table. */
  addFile(GAME_ROOT + '/data/Map014.json', mapFile(14, [
    ev(1, 'signpost', 2, 2, [cmd(108, 0, ['overworld']), cmd(0)])
  ], [{ troopId: 3, weight: 5, regionSet: [] }, { troopId: 4, weight: 2, regionSet: [] }]));
  /* Two more with nothing interesting, so "scanned" is bigger than "found". */
  addFile(GAME_ROOT + '/data/Map001.json', mapFile(1, []));
  addFile(GAME_ROOT + '/data/Map002.json', mapFile(2, [ev(1, 'sign', 1, 1, [cmd(0)])]));

  /* -------------------------------------------------------------------------
     THE ASSET TREE.

     img/characters carries the three filename conventions the engine reads out
     of the NAME rather than out of the file:
       $Big1    a single-character sheet, 1x1 frames instead of 4x2
       !Door1   an object character: no shift, no bush depth
       !$Gate1  BOTH, and the row that breaks every implementation that tested
                only the first character. It is a real filename from a shipped
                MV project, not an invented adversarial case.
     pack1/Hero is a real SUBDIRECTORY. A one-level directory listing reports
     'pack1' as if it were a file, which is a blind spot worth being able to
     see rather than one to design around.
     Actor3.rpgmvp is the encrypted spelling of an image; the index has to strip
     the stem to recognise it as the same asset under a different extension.
     -------------------------------------------------------------------------- */
  ['Actor1', 'Actor2', 'People1', '$Big1', '!Door1', '!$Gate1'].forEach(function (n) {
    addFile(GAME_ROOT + '/img/characters/' + n + '.png', 'x');
  });
  addFile(GAME_ROOT + '/img/characters/pack1/Hero.png', 'x');
  addFile(GAME_ROOT + '/img/characters/Actor3.rpgmvp', 'x');
  ['Actor1', 'Actor2'].forEach(function (n) { addFile(GAME_ROOT + '/img/faces/' + n + '.png', 'x'); });
  addFile(GAME_ROOT + '/img/pictures/Splash.png', 'x');
  addFile(GAME_ROOT + '/img/pictures/title_bg.png', 'x');
  addFile(GAME_ROOT + '/img/system/Window.png', 'x');
  addFile(GAME_ROOT + '/img/system/IconSet.png', 'x');
  addFile(GAME_ROOT + '/img/enemies/Slime.png', 'x');

  /* The rest of the audio tree. The database names audio no filesystem lists
     and the filesystem lists audio no database names; both halves have to
     exist or "the file behind this name" has only one possible answer.
     audio/bgm/pack1/Overture.ogg is the file $dataSystem.titleBgm points at,
     and it is in a real subdirectory for the same reason the name is.
     Battle1 appears three times over — .ogg, MV's .rpgmvo and MZ's .ogg_ — so
     the stem strip is exercised under either engine's encrypted spelling. */
  ['Title', 'Battle1', 'Field1'].forEach(function (n) { addFile(GAME_ROOT + '/audio/bgm/' + n + '.ogg', 'x'); });
  addFile(GAME_ROOT + '/audio/bgm/pack1/Overture.ogg', 'x');
  addFile(GAME_ROOT + '/audio/bgm/Battle1.rpgmvo', 'x');
  addFile(GAME_ROOT + '/audio/bgm/Battle1.ogg_', 'x');
  ['Town1', 'Sea1'].forEach(function (n) { addFile(GAME_ROOT + '/audio/bgs/' + n + '.ogg', 'x'); });
  addFile(GAME_ROOT + '/audio/bgs/Town1.rpgmvo', 'x');
  ['Victory1', 'Defeat1'].forEach(function (n) { addFile(GAME_ROOT + '/audio/me/' + n + '.ogg', 'x'); });
  addFile(GAME_ROOT + '/audio/me/Victory1.ogg_', 'x');
  ['Cursor1', 'Cancel1', 'Sword1'].forEach(function (n) { addFile(GAME_ROOT + '/audio/se/' + n + '.ogg', 'x'); });
  addFile(GAME_ROOT + '/audio/se/Cursor1.rpgmvo', 'x');
  addDir(GAME_ROOT + '/save');

  var pathMod = {
    sep: '/',
    join: function () {
      var parts = Array.prototype.slice.call(arguments).filter(function (p) { return p !== undefined && p !== null && p !== ''; });
      return parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    },
    dirname: function (p) { return String(p).replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'; },
    basename: function (p) { return String(p).replace(/\/+$/, '').split('/').pop(); },
    extname: function (p) { var m = /\.[^.\/]*$/.exec(String(p)); return m ? m[0] : ''; },
    resolve: function (p) { return String(p).replace(/\/+$/, ''); },
    relative: function (from, to) {
      var f = pathMod.resolve(from), t = pathMod.resolve(to);
      return t.indexOf(f + '/') === 0 ? t.slice(f.length + 1) : t;
    }
  };

  var fsMod = {
    constants: { R_OK: 4 },
    existsSync: function (p) { p = pathMod.resolve(p); return !!files[p] || !!dirs[p]; },
    readFileSync: function (p) {
      p = pathMod.resolve(p);
      if (files[p] === undefined) { var e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
    /* NOT String(data). A capture writes PNG bytes, and coercing a Uint8Array
       to a string turns 8 bytes into "137,80,78,71,13,10,26,10" — the write
       succeeds, statSync reports a plausible-looking size, and the file is
       garbage. Binary payloads are stored as they arrive; only genuine strings
       are coerced, which is what the real fs does. */
    writeFileSync: function (p, data) {
      var isBinary = data && typeof data === 'object' && typeof data.length === 'number' && typeof data !== 'string';
      addFile(pathMod.resolve(p), isBinary ? data : String(data));
    },
    unlinkSync: function (p) {
      p = pathMod.resolve(p);
      if (files[p] === undefined) { var e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
      delete files[p];
    },
    copyFileSync: function (a, b) { fsMod.writeFileSync(b, fsMod.readFileSync(a)); },
    renameSync: function (a, b) { fsMod.copyFileSync(a, b); fsMod.unlinkSync(a); },
    mkdirSync: function (p) { addDir(pathMod.resolve(p)); },
    accessSync: function (p) { if (!fsMod.existsSync(p)) throw new Error('ENOENT: ' + p); },
    statSync: function (p) {
      p = pathMod.resolve(p);
      if (files[p] !== undefined) return { size: files[p].length, mtimeMs: 1700000000000, isDirectory: function () { return false; }, isFile: function () { return true; } };
      if (dirs[p]) return { size: 0, mtimeMs: 1700000000000, isDirectory: function () { return true; }, isFile: function () { return false; } };
      throw new Error('ENOENT: ' + p);
    },
    readdirSync: function (p) {
      p = pathMod.resolve(p);
      if (!dirs[p]) throw new Error('ENOENT: ' + p);
      var out = {}, prefix = p + '/';
      Object.keys(files).concat(Object.keys(dirs)).forEach(function (f) {
        if (f.indexOf(prefix) !== 0) return;
        var rest = f.slice(prefix.length);
        if (!rest) return;
        out[rest.split('/')[0]] = true;
      });
      return Object.keys(out);
    }
  };

  window.__vfs = { fs: fsMod, path: pathMod, root: GAME_ROOT, files: files, dirs: dirs };

  /* Where a real install would have found somewhere writable. $.store.path()
     returns null unless paths.mode is 'fs' AND paths.dataDir is set, so a
     mount that moved only gameRoot left every write path resolving to null
     even with a filesystem underneath — the capture, the backup and the
     settings file all "succeeded" by never writing. */
  var DATA_DIR = GAME_ROOT + '/gigahack-userdata';
  addDir(DATA_DIR);
  addDir(DATA_DIR + '/backups');

  var saved = null;
  window.__mountVirtualFs = function () {
    var $ = window.GigaHack;
    if (!saved) {
      saved = {
        fs: $.env.fs, path: $.env.path, capsFs: $.caps.fs, why: $.caps.fsWhy,
        root: $.paths.gameRoot, nwjs: $.env.nwjs, pluginsDir: $.paths.pluginsDir,
        dataDir: $.paths.dataDir, mode: $.paths.mode, backupsDir: $.paths.backupsDir
      };
    }
    $.env.fs = fsMod; $.env.path = pathMod; $.env.nwjs = true;
    $.caps.fs = true; $.caps.fsWhy = '';
    $.paths.gameRoot = GAME_ROOT;
    $.paths.pluginsDir = GAME_ROOT + '/js/plugins';
    $.paths.dataDir = DATA_DIR;
    $.paths.mode = 'fs';
    $.paths.backupsDir = DATA_DIR + '/backups';
    return true;
  };
  window.__unmountVirtualFs = function () {
    var $ = window.GigaHack;
    if (!saved) return false;
    $.env.fs = saved.fs; $.env.path = saved.path; $.env.nwjs = saved.nwjs;
    $.caps.fs = saved.capsFs; $.caps.fsWhy = saved.why;
    $.paths.gameRoot = saved.root;
    $.paths.pluginsDir = saved.pluginsDir;
    $.paths.dataDir = saved.dataDir;
    $.paths.mode = saved.mode;
    $.paths.backupsDir = saved.backupsDir;
    return true;
  };

  /* -------------------------------------------------------------------------
     MAP FILES THE DEFAULT TREE DOES NOT HAVE.

     The index's own counters are pinned to five map files, and they should be:
     "it scanned every map file it found" is only an assertion if the number is
     known. These two are therefore a DRIVER, not part of the default tree.

       Map099  the single character '{'. A file that exists, is named like a
               map and is not JSON — the branch that has to become a per-file
               note rather than a failed stage.
       Map207  a valid map at an id $dataMapInfos has no row for. The file
               exists and the map tree does not know it, which is what a
               half-deleted map looks like on disk.
     -------------------------------------------------------------------------- */
  window.__addExtraMapFiles = function () {
    addFile(GAME_ROOT + '/data/Map099.json', '{');
    addFile(GAME_ROOT + '/data/Map207.json', mapFile(207, [
      ev(1, 'orphan', 1, 1, [cmd(108, 0, ['nobody knows this map is here']), cmd(0)])
    ]));
    return 2;
  };
  window.__removeExtraMapFiles = function () {
    delete files[GAME_ROOT + '/data/Map099.json'];
    delete files[GAME_ROOT + '/data/Map207.json'];
    return true;
  };
})();

/* =============================================================================
   DRIVERS.

   Everything below is a FUNCTION a check calls. Nothing here is applied at
   load, and that is the whole design rule: the default fixture has nothing
   stuck, nothing playing, no pad attached and no trigger armed, so "nothing
   looks stuck" can be asserted as the TRUE answer and not merely as the answer
   nobody bothered to falsify. A check turns one thing on, looks, and turns it
   off again.

   Each driver does exactly one thing, for the same reason a diagnosis wants
   exactly one cause: a helper that tinted the screen AND started a shake would
   make "which of these is the problem" unanswerable by construction.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   THE MV CLOCK.

   MV's SceneManager.updateMain runs its inner loop once per _deltaTime of
   ELAPSED TIME and renders ONCE per animation frame (engine-mv.js:209). The
   harness advances window.__clock by exactly one frame per __raf.flush(), so
   every flush is one logical step and one draw and the two are indistinguishable.
   Pushing the clock forward first is the only way to produce a frame carrying
   three logical steps and one draw — which is what it takes to observe that
   the engine's frame counter counts draws on one engine and steps on the other.
   ------------------------------------------------------------------------ */
window.__frameMs = 1000 / 60;
window.__advanceClock = function (frames) {
  window.__clock += frames * window.__frameMs;
  return window.__clock;
};

/* ---------------------------------------------------------------------------
   A PARALLEL PROCESS THAT REALLY WRITES.

   Nothing in the harness runs interpreters on its own, so the runaway case a
   fires-per-second ceiling exists for cannot otherwise be produced. Every real
   project has one of these — a play timer, a step counter, a weather tick —
   and it is what makes a naive watch fire forever.

   Written THROUGH setValue, exactly as the Control Variables command does, so
   requestRefresh still fires and anything hooked on the write still sees it.
   __churnVar is 0 by default, so this costs one comparison per frame and
   changes nothing until a check names a variable.
   ------------------------------------------------------------------------ */
window.__churnVar = 0;
(function churn() {
  var base = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    base.call(this);
    if (window.__churnVar) {
      $gameVariables.setValue(window.__churnVar, $gameVariables.value(window.__churnVar) + 1);
    }
  };
}());

/* ---------------------------------------------------------------------------
   INPUT.

   Input._onKeyDown reads exactly two things off its argument — .keyCode and
   .preventDefault — so a plain object is a faithful stand-in and a real
   KeyboardEvent would only add ceremony. The returned object is the one the
   engine saw, so a check can assert on preventDefault having been called.

   Input.update() is called once after the event, because that is the only
   place _previousState is snapshotted and therefore the only place a
   false->true edge becomes isTriggered. Note that only ONE button can be
   _latestButton per frame: two keys down in the same frame leave exactly one
   of them triggered, and that is the engine's behaviour, not a limitation here.
   ------------------------------------------------------------------------ */
window.__prevented = 0;
window.__pressKey = function (keyCode, code) {
  var ev = {
    keyCode: keyCode,
    code: code || null,
    preventDefault: function () { window.__prevented = (window.__prevented || 0) + 1; }
  };
  Input._onKeyDown(ev);
  Input.update();
  return ev;
};
window.__releaseKey = function (keyCode) {
  var ev = { keyCode: keyCode };
  Input._onKeyUp(ev);
  Input.update();
  return ev;
};

/* A controllable gamepad, ABSENT by default so "no gamepad is connected" is
   what the stock harness exercises — headless Chromium answers four nulls,
   which is the honest state for a browser build with nothing plugged in.

   Both halves save and restore the ORIGINAL navigator.getGamepads, because
   Input._pollGamepads now runs from every single Input.update(): a driver that
   left a fake pad installed would have every later check polling it.

   Note the engine's edge filter — a held button is written into _currentState
   only on the frame it CHANGES — so attaching a pad with a button already down
   and updating twice is not the same as pressing it. */
(function gamepad() {
  var original = navigator.getGamepads;
  var installed = false;
  window.__attachGamepad = function (buttons, axes) {
    var pad = {
      index: 0, connected: true, mapping: 'standard',
      buttons: (buttons || []).map(function (p) { return { pressed: !!p, value: p ? 1 : 0 }; }),
      axes: axes || [0, 0]
    };
    navigator.getGamepads = function () { return [pad, null, null, null]; };
    installed = true;
    return pad;
  };
  window.__detachGamepad = function () {
    if (!installed) return false;
    navigator.getGamepads = original;
    installed = false;
    Input._gamepadStates = [];
    return true;
  };
}());

/* The config an applyData hook can be driven with. ConfigManager.applyData is
   where a rebinding plugin re-asserts its own layout, so a check needs a
   plausible config object to hand it rather than inventing one at the call
   site. */
window.__savedConfig = {
  alwaysDash: true, commandRemember: false,
  bgmVolume: 100, bgsVolume: 100, meVolume: 100, seVolume: 100
};

/* Scene_Options.terminate is the ONE place the stock engine flushes the config
   file, on both engines, and it runs on the way OUT of the scene. */
window.__leaveOptions = function () {
  var s = new Scene_Options();
  s.terminate();
  return s;
};

/* ---------------------------------------------------------------------------
   INTERPRETERS — who is running, and where.

   The map's single interpreter is set up the way Game_Interpreter.setup sets
   it up: a map id captured at setup (which is how a running interpreter learns
   it has been transferred out from under itself), an event id, a list, and an
   index into it. The list ends with its {code:0} terminator, because
   skipBranch reads _list[_index + 1] with no bounds test and a stripped list
   runs off the end and throws.
   ------------------------------------------------------------------------ */
window.__runEvent = function (eventId, index, list) {
  var i = $gameMap._interpreter;
  i.clear();
  i._mapId = $gameMap.mapId();
  i._eventId = eventId;
  i._list = list || [cmd(223, 0, [[-255, -255, -255, 0], 60, false]), cmd(0, 0, [])];
  i._index = index || 0;
  return i;
};

/* A common event running on its OWN Game_CommonEvent, which is what a PARALLEL
   common event does. isActive() is `trigger === 2 && $gameSwitches.value(switchId)`,
   so the switch has to go on before refresh() will build an interpreter at all
   — and that is precisely what makes "which switch governs this" answerable. */
window.__runCommonEvent = function (id) {
  var data = $dataCommonEvents[id];
  if (!data) return null;
  $gameSwitches.setValue(data.switchId, true);
  var found = null;
  for (var i = 0; i < $gameMap._commonEvents.length; i++) {
    if ($gameMap._commonEvents[i]._commonEventId === id) found = $gameMap._commonEvents[i];
  }
  if (!found) {
    found = new Game_CommonEvent(id);
    $gameMap._commonEvents.push(found);
  }
  found.refresh();
  if (found._interpreter) found._interpreter.setup(found.list());
  return found;
};

/* A CHILD interpreter, one level down. The deepest running interpreter is the
   one actually executing, so a write has to be attributed to the child's list
   and not to the parent that called it — command117 is the everyday way a
   project produces this, and a panel that names the caller is naming the wrong
   list. eventId 0 is what a common event called from a common event gets. */
window.__runNestedEvent = function (commonEventId) {
  var parent = window.__runEvent(3, 0, $dataMap.events[3].pages[0].list);
  var child = new Game_Interpreter(parent._depth ? parent._depth + 1 : 1);
  child.setup($dataCommonEvents[commonEventId || 3].list, 0);
  parent._childInterpreter = child;
  return { parent: parent, child: child };
};

/* Nobody is running anything. The third state, and the one a panel has to be
   able to report as confidently as the other two. */
window.__runNothing = function () {
  $gameMap._interpreter.clear();
  $gameMap._commonEvents.forEach(function (ce) {
    var data = ce.event();
    if (data) $gameSwitches.setValue(data.switchId, false);
    ce.refresh();
  });
  $gameMap.events().forEach(function (e) { e.clearStartingFlag(); });
  return true;
};

/* ---------------------------------------------------------------------------
   THE FOUR EXTRA MAP EVENTS, brought to life.

   $gameMap._events is asserted to hold exactly three events, and it should:
   three is this map's honest shape. These bring the four definitions declared
   above into both $dataMap.events and $gameMap._events, wired the way the
   engine wires an event — initMembers, _mapId, refresh — and put the map back
   afterwards. Note that event 4 is an AUTORUN page: refresh() runs setupPage,
   setupPage calls checkEventTriggerAuto, and the event arms itself the moment
   it appears. That is the stuck case, and it arms on the same call that
   creates it.
   ------------------------------------------------------------------------ */
window.__addMapEvents = function () {
  for (var i = 0; i < EXTRA_MAP_EVENTS.length; i++) {
    var d = EXTRA_MAP_EVENTS[i];
    $dataMap.events[d.id] = d;
    var e = new Game_Event(d.id, d.name, d.x, d.y);
    e.initMembers();
    e._mapId = $gameMap.mapId();
    e.refresh();
    $gameMap._events[d.id] = e;
  }
  return $gameMap.events().length;
};
window.__removeMapEvents = function () {
  for (var i = 0; i < EXTRA_MAP_EVENTS.length; i++) {
    delete $dataMap.events[EXTRA_MAP_EVENTS[i].id];
    delete $gameMap._events[EXTRA_MAP_EVENTS[i].id];
  }
  $dataMap.events.length = 4;
  $gameMap._events.length = 4;
  $gameMap.events().forEach(function (e) { e.clearStartingFlag(); });
  $gameMap._interpreter.clear();
  return $gameMap.events().length;
};

/* erase() does NOT remove the event: it raises a flag and refreshes, and
   refresh then resolves the page index to -1 unconditionally. So "erased, no
   page runs" and "no page meets its conditions" produce the same -1 by two
   different routes, and only the flag tells them apart. */
window.__eraseEvent = function (eventId) {
  var e = $gameMap.event(eventId);
  if (!e) return false;
  e.erase();
  return true;
};

/* ---------------------------------------------------------------------------
   THE SIX STUCK SCREENS, one function each.

   Every one of these is a state a real game gets left in when a cutscene is
   interrupted, and every one of them is reached through the engine's OWN API
   rather than by assigning the fields — a fixture that hand-wrote the end
   state would agree with a diagnosis that read the same fields and disagree
   with the engine.
   ------------------------------------------------------------------------ */

/* A tint with duration 0 lands immediately and stays: _tone and _toneTarget
   are both fully black and _toneDuration is 0, so updateTone never runs again
   and nothing will ever move it back. */
window.__stickTint = function () {
  $gameScreen.startTint([-255, -255, -255, 0], 0);
  return $gameScreen.tone();
};

/* Brightness 0 with both fade durations spent — the screen is black and the
   engine considers the fade finished, which is why waiting does not help. */
window.__stickBrightness = function () {
  $gameScreen.startFadeOut(1);
  $gameScreen.updateFadeOut();
  return $gameScreen.brightness();
};

/* A shake that a plugin "stopped" by zeroing the POWER instead of clearing the
   shake. Run a real shake first so the engine's own oscillator carries the
   offset off zero; then set power 0. From there delta is (0 * speed * dir)/10
   = 0, so _shake never moves, the sign never flips, and the only branch that
   snaps _shake back to zero — the one that needs the next step to CROSS zero —
   can never fire. The duration runs out and the offset stays forever. */
window.__stickShake = function () {
  var i;
  $gameScreen.startShake(5, 5, 60);
  for (i = 0; i < 8; i++) $gameScreen.updateShake();
  $gameScreen.startShake(0, 5, 60);
  for (i = 0; i < 61; i++) $gameScreen.updateShake();
  return $gameScreen.shake();
};

/* Weather with duration 0 arrives at full power immediately and has no
   remaining duration to decay through. */
window.__stickWeather = function () {
  $gameScreen.changeWeather('storm', 9, 0);
  return $gameScreen.weatherType();
};

/* setZoom, not startZoom: it writes _zoomScale directly and leaves
   _zoomDuration at 0, so updateZoom has nothing to unwind. */
window.__stickZoom = function () {
  $gameScreen.setZoom(408, 312, 2.5);
  return $gameScreen.zoomScale();
};

/* The SCENE's fade, which is a different mechanism on each engine and lives
   nowhere near $gameScreen: MV drives a ScreenSprite child's opacity, MZ a
   plain _fadeOpacity number fed into a ColorFilter. Both end opaque with
   _fadeDuration 0, which is a scene that has finished fading out and will
   never fade back in. */
window.__stickSceneFade = function () {
  var s = SceneManager._scene;
  if (!s || !s.startFadeOut) return null;
  s.startFadeOut(1);
  s.updateFade();
  s.updateFade();
  return s._fadeSprite ? s._fadeSprite.opacity : s._fadeOpacity;
};

/* Everything back to the clean default, so a check can prove that the mod's
   own unstick and this fixture agree about what clean means.
   Game_Screen.clear() is the engine's own reset and covers fade, tone, flash,
   shake, zoom, weather and pictures in one call; the scene fade is separate
   because the scene owns it. */
window.__unstickAll = function () {
  $gameScreen.clear();
  var s = SceneManager._scene;
  if (s) {
    s._fadeDuration = 0;
    s._fadeSign = 0;
    if (s._fadeSprite) s._fadeSprite.opacity = 0;
    if ('_fadeOpacity' in s) {
      s._fadeOpacity = 0;
      if (s.updateColorFilter) s.updateColorFilter();
    }
  }
  window.__inBattle = false;
  return true;
};

/* ---------------------------------------------------------------------------
   PICTURE SLOTS.

   Built through showPicture so the Game_Picture objects are real ones with
   real defaults, not literals that happen to have the right fields.

     1   a name the asset index would recognise
     4   OCCUPIED AND NAMELESS. MV's Game_Picture.erase leaves exactly this —
         a live picture with name '' — so "the slot is in use" and "the slot is
         showing something" are different questions with different answers, and
         a panel that conflates them reports an empty slot as full
     7   a long, foldered name, for the middle-elision and shrink paths
     12  MID-MOVE: movePicture then one update, so _duration is non-zero and
         _x sits between where it was and where it is going
     20  a name no asset list contains. With no filesystem the index answers
         complete:false, and THAT is the branch that must never be rendered as
         "the file is missing" — the index cannot say, which is a third answer
   ------------------------------------------------------------------------ */
window.__showPictures = function () {
  $gameScreen.showPicture(1, 'title_bg', 0, 100, 100, 100, 100, 255, 0);
  $gameScreen.showPicture(4, '', 1, 200, 150, 100, 100, 128, 1);
  $gameScreen.showPicture(7, 'cutscene/act3/a_name_far_too_long_to_fit_in_this_column',
    0, 10, 10, 100, 100, 255, 0);
  $gameScreen.showPicture(12, 'mover', 0, 0, 0, 100, 100, 255, 0);
  /* MV's movePicture takes nine arguments and MZ's ten; the tenth is the
     easing type. Passing ten is harmless on MV, which ignores it, and passing
     nine on MZ would silently mean linear — so ten is written here and the
     asymmetry is named rather than papered over. */
  $gameScreen.movePicture(12, 0, 400, 300, 100, 100, 255, 0, 60, 0);
  $gameScreen.picture(12).update();
  $gameScreen.showPicture(20, 'not_in_any_asset_list', 0, 50, 50, 100, 100, 255, 0);
  return $gameScreen._pictures.length;
};

/* A picture in the BATTLE range. In battle every id is offset by maxPictures(),
   so map picture 1 and battle picture 1 are two different slots in one array —
   and because maxPictures() itself differs between the engines, the same id
   lands at a different index on each. Anything walking _pictures by index has
   to go through realPictureId rather than guess. */
window.__showBattlePicture = function (pictureId) {
  var id = pictureId || 1;
  var keep = window.__inBattle;
  window.__inBattle = true;
  $gameScreen.showPicture(id, 'battle_overlay', 0, 0, 0, 100, 100, 255, 0);
  /* Read the slot back BEFORE leaving battle, because realPictureId answers
     differently outside it — which is the whole hazard. */
  var slot = $gameScreen.realPictureId(id);
  window.__inBattle = keep;
  return slot;
};

/* A slot ABOVE the limit. The spriteset only ever builds maxPictures() sprites,
   so a picture written here exists in the data and can never be drawn — the
   refusal a panel has to be able to explain. */
window.__showPictureAboveLimit = function () {
  var id = $gameScreen.maxPictures() + 5;
  $gameScreen.showPicture(id, 'beyond_the_limit', 0, 0, 0, 100, 100, 255, 0);
  return id;
};

/* MZ reads picturesUpperLimit out of $dataSystem.advanced and MV ignores it
   entirely (its maxPictures is the constant 100). With the key absent both
   answer 100 and the delta is invisible, so both states have to be reachable
   from one fixture — and the key starts ABSENT, because that is what most
   projects ship. */
window.__setPictureLimit = function (n) {
  $dataSystem.advanced.picturesUpperLimit = n;
  return $gameScreen.maxPictures();
};
window.__clearPictureLimit = function () {
  delete $dataSystem.advanced.picturesUpperLimit;
  return $gameScreen.maxPictures();
};

/* ---------------------------------------------------------------------------
   THE TWO "SOMETHING REPLACED THE MAP SPRITESET" BRANCHES.

   A weather extension that swaps the sprite out, and a scene that has no
   spriteset at all. Both are things real plugins do, and both have to degrade
   with a reason rather than throwing. Restorable, because a fixture that could
   only break the scene once would let the first check that used it poison
   every check after it.
   ------------------------------------------------------------------------ */
(function spritesetSurgery() {
  var savedWeather = null, savedSpriteset = null;
  window.__stripWeatherSprite = function () {
    var ss = SceneManager._scene && SceneManager._scene._spriteset;
    if (!ss || !ss._weather) return false;
    savedWeather = ss._weather;
    delete ss._weather;
    return true;
  };
  window.__stripSpriteset = function () {
    var s = SceneManager._scene;
    if (!s || !s._spriteset) return false;
    savedSpriteset = s._spriteset;
    delete s._spriteset;
    return true;
  };
  window.__restoreSpriteset = function () {
    var s = SceneManager._scene;
    if (savedSpriteset && s) { s._spriteset = savedSpriteset; savedSpriteset = null; }
    if (savedWeather && s && s._spriteset) { s._spriteset._weather = savedWeather; savedWeather = null; }
    return true;
  };
  /* createWeather is not called by initialize() on this harness, so the weather
     sprite only exists once something asks for it — which is what the engine's
     Spriteset_Map.createLowerLayer does and what a weather check has to do. */
  window.__createWeather = function () {
    var ss = SceneManager._scene && SceneManager._scene._spriteset;
    if (!ss || !ss.createWeather) return null;
    ss.createWeather();
    return ss._weather;
  };
}());

/* ---------------------------------------------------------------------------
   BattleManager.setup — the missing line.

   Both engines call $gameScreen.onBattleStart() from inside setup
   (rpg_managers.js:2149 / rmmz_managers.js:2281). core.js's recorder does not,
   so "a tint survives a battle start and a zoom does not" was an assertion
   about a call that never happened. Aliased rather than replaced, so the
   recorder's own __battleSetup observable is untouched.
   ------------------------------------------------------------------------ */
(function battleStartScreen() {
  var base = BattleManager.setup;
  BattleManager.setup = function (troopId, canEscape, canLose) {
    base.call(this, troopId, canEscape, canLose);
    $gameScreen.onBattleStart();
  };
}());

/* ---------------------------------------------------------------------------
   MISSING FILES, one name at a time.

   Both tables are EMPTY by default, so every file loads and the default
   harness is a project with nothing wrong with it. A check names one file, and
   the failure has to come out as a panel message rather than as a load-error
   screen or a poisoned cache entry that every later check inherits.

   The lookup accepts a full url, a bare filename or a stem, because the caller
   knows the name the game uses and not the url the engine builds from it.
   ------------------------------------------------------------------------ */
window.__audioMissing = {};
window.__imageMissing = {};

(function missingFiles() {
  /* Local, not a window.__ name: it is shared machinery, not a driver, and a
     harness observable that a check could reasonably call should not be sitting
     next to two that it must not. */
  function isMissing(table, url) {
    if (!table || !url) return false;
    var s = String(url);
    if (table[s]) return true;
    var decoded = s;
    try { decoded = decodeURIComponent(s); } catch (e) { /* a malformed escape is the url itself */ }
    if (table[decoded]) return true;
    var file = decoded.split('/').pop();
    if (table[file]) return true;
    return !!table[file.replace(/\.[^.]*$/, '')];
  }

  /* __audioExists is the seam x-audio.js already installed and both engines'
     loaders already consult; it defaults to `return true`. This replacement
     adds the per-name table and — only when a check asks for it — the real
     file table, so "this project is missing a file" and "this one name is
     missing" stay separate switches. Strictness is opt-in because most checks
     are not about the filesystem, and a strict default would quietly turn
     every one of them into a filesystem test. */
  window.__audioStrict = false;
  window.__strictAudioFiles = function (on) { window.__audioStrict = !!on; return window.__audioStrict; };
  window.__audioExists = function (url) {
    if (isMissing(window.__audioMissing, url)) return false;
    if (!window.__audioStrict) return true;
    var vfs = window.__vfs;
    if (!vfs) return true;
    var rel = String(url).replace(/^\.?\//, '');
    var decoded = rel;
    try { decoded = decodeURIComponent(rel); } catch (e) { /* keep the raw form */ }
    return vfs.files[vfs.root + '/' + decoded] !== undefined;
  };

  /* Images have no per-name seam of their own: the engine's loaders read the
     GLOBAL window.__imageLoadMode. So the miss is applied by wrapping the two
     entry points — MV's Bitmap._requestImage and MZ's Bitmap._startLoading —
     and flipping that global for the duration of the one call, which drives
     each engine's own _onError path rather than assigning a state name. With
     the table empty this is one property lookup and nothing else.

     Whatever is on the prototype at this point is what gets wrapped, which is
     the right shape for a seam: it does not care which file won the method, so
     it keeps working if a later stub file takes the name back. */
  function wrap(name, urlOf) {
    var base = Bitmap.prototype[name];
    if (typeof base !== 'function') return;
    Bitmap.prototype[name] = function () {
      if (!isMissing(window.__imageMissing, urlOf(this, arguments))) {
        return base.apply(this, arguments);
      }
      var keep = window.__imageLoadMode;
      window.__imageLoadMode = 'error';
      try { return base.apply(this, arguments); }
      finally { window.__imageLoadMode = keep; }
    };
  }
  wrap('_requestImage', function (self, args) { return args[0] || self._url; });
  wrap('_startLoading', function (self) { return self._url; });
}());

/* ---------------------------------------------------------------------------
   WAIT STATES.

   updateWaitMode has ten arms and every one of them asks a different object a
   different question. The stubs answer all of them honestly for a harness at
   rest — nothing is playing, nothing is transferring, nothing is gathering —
   which is correct and also means no arm is ever reachable. These six flags
   are ORed into the six predicates that have no other seam, so a check can
   make exactly one arm true and leave the other nine answering the truth.
   All false by default: at rest, nothing is waiting.
   ------------------------------------------------------------------------ */
window.__videoPlaying = false;
window.__imagesBusy = false;
window.__transferring = false;
window.__scrolling = false;
window.__gathering = false;
window.__actionForced = false;
(function waitSeams() {
  function orFlag(owner, name, flag) {
    if (!owner || typeof owner[name] !== 'function') return;
    var base = owner[name];
    owner[name] = function () {
      return !!window[flag] || base.apply(this, arguments);
    };
  }
  /* MV asks Graphics.isVideoPlaying and MZ asks Video.isPlaying — the same
     question through two names that exist on one engine each. */
  orFlag(Graphics, 'isVideoPlaying', '__videoPlaying');
  if (typeof Video !== 'undefined') orFlag(Video, 'isPlaying', '__videoPlaying');
  orFlag(Game_Player.prototype, 'isTransferring', '__transferring');
  orFlag(Game_Map.prototype, 'isScrolling', '__scrolling');
  orFlag(Game_Followers.prototype, 'areGathering', '__gathering');
  orFlag(BattleManager, 'isActionForced', '__actionForced');
  /* The 'image' arm reads `!ImageManager.isReady()`, so this one inverts. */
  var ready = ImageManager.isReady;
  if (typeof ready === 'function') {
    ImageManager.isReady = function () {
      return !window.__imagesBusy && ready.apply(this, arguments);
    };
  }
}());

/* ---------------------------------------------------------------------------
   SAVE SLOTS.

   StorageManager starts empty, so there is nothing to read and every diff is
   a diff of nothing. __seedSaves writes two slots with GENUINELY different
   state — different variables including a string-valued and an array-valued
   one, different switches, different gold, different inventory, a different
   party, a different map and a different player position.

   It goes through DataManager.saveGame, so the on-disk shape is whatever THAT
   engine writes: MV's synchronous boolean into an id-keyed store, MZ's Promise
   into a name-keyed one. Normalising the two is exactly what the mod's own
   save wrapper does, and it is why this takes a callback rather than returning.

   Slot 2 is written with a much larger Graphics.frameCount than slot 1, so
   "how much play is between these two saves" has a real answer rather than
   zero.

   The live world is not touched. Rather than mutating and restoring — which
   leaves every reference elsewhere pointing at objects that were briefly
   somebody else's — the globals are SWAPPED for a private world for the
   duration and swapped back. Nothing else holds a reference to the temporary
   one, so there is nothing to put back wrongly.
   ------------------------------------------------------------------------ */
(function saveSeeding() {
  var SWAP = ['$gameSystem', '$gameScreen', '$gameTimer', '$gameSwitches', '$gameVariables',
    '$gameSelfSwitches', '$gameActors', '$gameParty', '$gameMap', '$gamePlayer'];

  function freshWorld() {
    window.$gameSystem = new Game_System();
    window.$gameScreen = new Game_Screen();
    window.$gameTimer = new Game_Timer();
    window.$gameSwitches = new Game_Switches();
    window.$gameVariables = new Game_Variables();
    window.$gameSelfSwitches = new Game_SelfSwitches();
    window.$gameActors = new Game_Actors();
    window.$gameParty = new Game_Party();
    window.$gameMap = new Game_Map();
    window.$gamePlayer = new Game_Player();
  }

  /* MV returns a boolean and MZ a Promise. Both are normalised to one callback
     taking a boolean, which is the same shape the mod's own $.eng.saveGame
     produces and the reason this whole function is asynchronous. */
  function saveThrough(slot, done) {
    var r;
    try { r = DataManager.saveGame(slot); }
    catch (e) { done(false); return; }
    if (r && typeof r.then === 'function') {
      r.then(function () { done(true); }, function () { done(false); });
    } else {
      done(r !== false);
    }
  }

  function withPrivateWorld(fill, done) {
    var keep = {}, i;
    for (i = 0; i < SWAP.length; i++) keep[SWAP[i]] = window[SWAP[i]];
    var keepFrames = Graphics.frameCount;
    var keepSavedTo = window.__savedTo;
    freshWorld();
    fill(function (result) {
      for (var j = 0; j < SWAP.length; j++) window[SWAP[j]] = keep[SWAP[j]];
      Graphics.frameCount = keepFrames;
      window.__savedTo = keepSavedTo;
      done(result);
    });
  }

  window.__seedSaves = function (done) {
    done = done || function () { };
    withPrivateWorld(function (finish) {
      var v = $gameVariables, s = $gameSwitches, i;

      /* Slot 1 — early in a playthrough. */
      for (i = 1; i <= 10; i++) v.setValue(i, i * 3);
      v.setValue(11, 'a string, because a variable holds whatever it was given');
      v.setValue(12, [1, 2, 3]);
      v.setValue(106, 1);
      for (i = 1; i <= 12; i++) s.setValue(i, i % 3 === 0);
      s.setValue(141, true);
      $gameParty._gold = 1200;
      $gameParty._items = { 12: 1, 45: 2 };
      $gameParty._weapons = { 1: 1 };
      $gameParty._armors = { 5: 1 };
      $gameParty._actors = [1, 2];
      $gameMap._mapId = 5;
      $gamePlayer._x = 4; $gamePlayer._y = 4; $gamePlayer._direction = 2;
      $gameSelfSwitches._data[[5, 1, 'A']] = true;
      Graphics.frameCount = 60 * 60 * 12;              // twelve minutes in
      $gameSystem.onBeforeSave();

      saveThrough(1, function (ok1) {
        /* Slot 2 — later, and different in every section, so a diff has
           something to say about each one rather than about one of them. */
        for (i = 1; i <= 10; i++) v.setValue(i, i * 7);
        v.setValue(11, 'a different string');
        v.setValue(12, [1, 2, 3, 4, 5]);
        v.setValue(106, 4);
        v.setValue(207, 99);                            // a variable slot 1 never set
        for (i = 1; i <= 12; i++) s.setValue(i, i % 2 === 0);
        s.setValue(142, true);
        $gameParty._gold = 48200;
        $gameParty._items = { 12: 9, 208: 1, 901: 1 };  // 901 has no definition
        $gameParty._weapons = { 1: 1, 4: 2 };
        $gameParty._armors = { 5: 1, 9: 1 };
        $gameParty._actors = [1, 2, 3, 5];              // an extra member joined
        $gameMap._mapId = 14;
        $gamePlayer._x = 21; $gamePlayer._y = 14; $gamePlayer._direction = 6;
        $gameSelfSwitches._data[[5, 1, 'A']] = true;
        $gameSelfSwitches._data[[14, 1, 'A']] = true;
        $gameSelfSwitches._data[[12, 3, 'B']] = true;
        Graphics.frameCount = 60 * 60 * 47;             // forty-seven minutes in
        $gameSystem.onBeforeSave();

        saveThrough(2, function (ok2) { finish({ slot1: ok1, slot2: ok2 }); });
      });
    }, done);
  };

  /* A SAVE NAMING A CLASS THIS BUILD DOES NOT HAVE.

     JsonEx records each object's constructor name under '@' and looks it up on
     window when parsing; a name that is gone resolves to nothing and the
     section comes back as PLAIN DATA. That is the crux — a save written by a
     game with a party plugin, read by the same game with the plugin removed —
     and the only way to produce it is to declare the class, write with it, and
     take it away again. Every field must still be readable afterwards; only
     the methods are gone. */
  window.__seedForeignClassSave = function (slot, done) {
    done = done || function () { };
    withPrivateWorld(function (finish) {
      window.Game_PartyEx = function () {
        this._actors = [1, 2, 3];
        this._items = { 12: 2 };
        this._weapons = {};
        this._armors = {};
        this._gold = 9999;
        this._reserveMembers = [4, 5];
        this._extendedByAPlugin = true;
      };
      window.Game_PartyEx.prototype = Object.create(Game_Party.prototype);
      window.Game_PartyEx.prototype.constructor = window.Game_PartyEx;
      window.$gameParty = new window.Game_PartyEx();
      Graphics.frameCount = 60 * 60 * 20;
      $gameSystem.onBeforeSave();
      saveThrough(slot || 3, function (ok) {
        delete window.Game_PartyEx;
        finish(ok);
      });
    }, done);
  };

  /* A save written by a DIFFERENT BUILD of the game: another versionId and
     another title. Both are recorded in the file, and a reader that ignores
     them offers to load a save whose ids mean something else. */
  window.__seedForeignBuildSave = function (slot, done) {
    done = done || function () { };
    var keepVersion = $dataSystem.versionId, keepTitle = $dataSystem.gameTitle;
    withPrivateWorld(function (finish) {
      $dataSystem.versionId = 98765;
      $dataSystem.gameTitle = 'Harness Project (earlier build)';
      $gameParty._gold = 77;
      Graphics.frameCount = 60 * 60 * 3;
      $gameSystem.onBeforeSave();
      saveThrough(slot || 4, function (ok) {
        $dataSystem.versionId = keepVersion;
        $dataSystem.gameTitle = keepTitle;
        finish(ok);
      });
    }, done);
  };

  /* Back to an empty store, so a check that wants "there are no saves" can
     have it after another check has written some. */
  window.__clearSaves = function () {
    StorageManager._files = {};
    if (DataManager._globalInfo) DataManager._globalInfo = [];
    return true;
  };
}());
