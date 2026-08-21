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
function buildVariables(withConvention) {
  var heads = { 1: 'Story', 21: 'Debug', 101: 'Stats', 301: 'Timers', 601: 'Flags' };
  var a = [null];
  for (var i = 1; i <= 1400; i++) {
    if (withConvention && heads[i]) a.push('-- ' + heads[i]);
    else if (withConvention && i % 100 === 1) a.push('-- Group ' + Math.floor(i / 100));
    else if (i % 7 === 0) a.push('');                      // an unfilled gap
    else a.push('var_' + i);
  }
  return a;
}
function buildSwitches(withConvention) {
  var heads = {
    101: 'Locations', 141: 'Quests', 401: 'Scenes', 501: 'Region',
    661: 'Epilogue', 861: 'Trophies', 921: 'Endings', 1001: 'Extras',
    301: 'Chains', 64: 'Control'
  };
  var a = [null];
  for (var i = 1; i <= 1100; i++) {
    if (withConvention && heads[i]) a.push('-- ' + heads[i]);
    else if (withConvention && i % 50 === 1 && i > 1) a.push('-- Collection ' + Math.floor(i / 50));
    else if (i % 13 === 0) a.push('');
    else a.push('sw_' + i);
  }
  return a;
}

var $dataSystem = {
  gameTitle: 'Harness Project',
  variables: buildVariables(true),
  switches: buildSwitches(true),
  equipTypes: ['', 'Weapon', 'Shield', 'Head', 'Body', 'Accessory'],
  weaponTypes: ['', 'Sword', 'Staff', 'Bow'],
  armorTypes: ['', 'General', 'Magic', 'Light', 'Heavy'],
  skillTypes: ['', 'Magic', 'Special'],
  terms: { params: ['Max HP', 'Max MP', 'ATK', 'DEF', 'MATK', 'MDEF', 'AGI', 'LUCK'] },
  versionId: 12345,
  elements: ['', 'Physical', 'Fire', 'Ice', 'Thunder', 'Water', 'Earth', 'Wind', 'Light', 'Dark'],
  advanced: { gameId: 424242 },
  iconSize: 32
};

/* Swap the naming convention out from under the mod, for the Profile
   detection checks. Rebuilds the tables in place so live references stay
   valid, exactly as a database reload would. */
window.__useSectionConvention = function (on) {
  $dataSystem.variables = buildVariables(!!on);
  $dataSystem.switches = buildSwitches(!!on);
};

/* ---------------------------------------------------------------------------
   The database. Sizes are deliberately unround so a computed Forge base is
   visibly a computation and not a coincidence.
   ------------------------------------------------------------------------ */
var $dataItems = mk(700, function (i) {
  return { id: i, name: 'Item ' + i, iconIndex: 160 + (i % 40), price: i * 10, itypeId: i % 20 === 0 ? 2 : 1, description: 'desc ' + i, params: null, note: '' };
});
var $dataWeapons = mk(126, function (i) {
  return { id: i, name: 'Weapon ' + i, iconIndex: 96 + (i % 16), price: i * 50, etypeId: 1, wtypeId: 1 + (i % 3), params: [0, 0, i, 0, 0, 0, 0, 0], description: '', note: '' };
});
var $dataArmors = mk(400, function (i) {
  return { id: i, name: 'Armor ' + i, iconIndex: 128 + (i % 16), price: i * 40, etypeId: 2 + (i % 4), atypeId: 1, params: [i, 0, 0, i % 7, 0, 0, 0, 0], description: '', note: '' };
});
var $dataSkills = mk(1100, function (i) {
  return { id: i, name: 'Skill ' + i, iconIndex: 64 + (i % 16), description: 'sk ' + i, mpCost: i % 20, tpCost: 0, note: '' };
});
var $dataStates = mk(250, function (i) { return { id: i, name: 'State ' + i, iconIndex: (i % 16), note: '' }; });
var $dataClasses = mk(38, function (i) {
  return {
    id: i, name: 'Class ' + i, note: '',
    params: (function () { var p = []; for (var k = 0; k < 8; k++) { var r = []; for (var l = 0; l <= 99; l++) r.push(10 + k * 3 + l * 2); p.push(r); } return p; })(),
    learnings: []
  };
});
var $dataActors = mk(61, function (i) {
  return {
    id: i, name: 'Actor ' + i, classId: 1 + ((i - 1) % 5), initialLevel: 5, maxLevel: 99, equips: [0, 0, 0, 0, 0],
    nickname: '', profile: '', note: '',
    faceName: 'Actor' + (1 + ((i - 1) % 4)), faceIndex: (i - 1) % 8,
    characterName: 'Actor' + (1 + ((i - 1) % 4)), characterIndex: (i - 1) % 8,
    battlerName: 'Actor' + (1 + ((i - 1) % 4)) + '_1'
  };
});
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
  flags: (function () { var f = []; for (var i = 0; i < 8192; i++) f.push(i < 16 ? 0x0f : 0); return f; })()
}];

var $dataMap = {
  width: 17, height: 13, tilesetId: 1, encounterList: [], data: new Array(17 * 13 * 6).fill(100), events: [null,
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
    /* 2 — a parallel process guarding a variable. */
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
            cmd(0, 0, [])]
        })]
    },
    /* 3 — a door, i.e. a Transfer Player the overlay should outline. */
    {
      id: 3, name: 'door', x: 9, y: 9, note: '', pages: [
        page({
          trigger: 1, conditions: { switch1Valid: true, switch1Id: 9 }, list: [
            cmd(201, 0, [0, 6, 10, 4, 0]),
            cmd(0, 0, [])]
        })]
    }
  ]
};

var $dataCommonEvents = [null,
  { id: 1, name: 'Init', trigger: 0, switchId: 1, list: [] },
  { id: 2, name: 'Tick', trigger: 2, switchId: 5, list: [] }];

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
var $gameTemp = new Game_Temp();
var $gameSystem = new Game_System();
var $gameScreen = new Game_Screen();
var $gameTimer = new Game_Timer();
$gameMessage = new Game_Message();
var $gameTroop = new Game_Troop();
var $gameMap = new Game_Map();
$gameMap._events = [new Game_Event(1, 'chest_37', 8, 6), new Game_Event(2, 'baker', 3, 4), new Game_Event(3, 'door', 9, 9)];
$gameMap._events.forEach(function (e) { e.refresh(); });

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
  'Forge', 'Player', 'Encounters', 'Gallery', 'Steam', 'Save', 'Console', 'Boot'];

var $plugins = (function () {
  var kinds = ['ui_frame', 'message_ext', 'menu_replace', 'battle_hud', 'quest_log',
    'audio_ext', 'weather', 'pathfind', 'lighting', 'shop_ext'];
  var out = [];
  for (var i = 0; i < 40; i++) {
    out.push({ name: kinds[i % kinds.length] + '_' + i, status: i !== 5, description: 'plugin ' + i, parameters: {} });
  }
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
  SceneManager._scene = new Scene_Map();
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

  /* Map 5: a chest that sets switch 141 and reads variable 22. */
  addFile(GAME_ROOT + '/data/Map005.json', mapFile(5, [
    ev(1, 'shrine_chest', 4, 4, [cmd(121, 0, [141, 141, 0]), cmd(122, 0, [22, 22, 0, 0, 3]), cmd(0)]),
    ev(2, 'guard', 6, 2, [cmd(111, 0, [0, 9, 0]), cmd(412, 0, []), cmd(0)])
  ]));
  /* Map 12: a door whose PAGE CONDITION is switch 141 — a different command
     shape entirely, and the one a list-only scan misses. */
  addFile(GAME_ROOT + '/data/Map012.json', mapFile(12, [
    ev(1, 'cellar_door', 8, 8, [cmd(201, 0, [0, 6, 10, 4, 0]), cmd(0)], { switch1Valid: true, switch1Id: 141 })
  ]));
  /* Map 14: the only map in the project with a random-encounter table. */
  addFile(GAME_ROOT + '/data/Map014.json', mapFile(14, [
    ev(1, 'signpost', 2, 2, [cmd(108, 0, ['overworld']), cmd(0)])
  ], [{ troopId: 3, weight: 5, regionSet: [] }, { troopId: 4, weight: 2, regionSet: [] }]));
  /* Two more with nothing interesting, so "scanned" is bigger than "found". */
  addFile(GAME_ROOT + '/data/Map001.json', mapFile(1, []));
  addFile(GAME_ROOT + '/data/Map002.json', mapFile(2, [ev(1, 'sign', 1, 1, [cmd(0)])]));

  ['Actor1', 'Actor2', 'People1'].forEach(function (n) { addFile(GAME_ROOT + '/img/characters/' + n + '.png', 'x'); });
  ['Actor1', 'Actor2'].forEach(function (n) { addFile(GAME_ROOT + '/img/faces/' + n + '.png', 'x'); });
  ['Title', 'Battle1'].forEach(function (n) { addFile(GAME_ROOT + '/audio/bgm/' + n + '.ogg', 'x'); });
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
    writeFileSync: function (p, data) { addFile(pathMod.resolve(p), String(data)); },
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

  var saved = null;
  window.__mountVirtualFs = function () {
    var $ = window.GigaHack;
    if (!saved) saved = { fs: $.env.fs, path: $.env.path, capsFs: $.caps.fs, why: $.caps.fsWhy, root: $.paths.gameRoot, nwjs: $.env.nwjs };
    $.env.fs = fsMod; $.env.path = pathMod; $.env.nwjs = true;
    $.caps.fs = true; $.caps.fsWhy = '';
    $.paths.gameRoot = GAME_ROOT;
    $.paths.pluginsDir = GAME_ROOT + '/js/plugins';
    return true;
  };
  window.__unmountVirtualFs = function () {
    var $ = window.GigaHack;
    if (!saved) return false;
    $.env.fs = saved.fs; $.env.path = saved.path; $.env.nwjs = saved.nwjs;
    $.caps.fs = saved.capsFs; $.caps.fsWhy = saved.why;
    $.paths.gameRoot = saved.root;
    return true;
  };
})();
