/* =============================================================================
   GigaHack test harness — stubs/core.js
   Everything that is IDENTICAL on RPG Maker MV 1.6.1 and MZ 1.9.0.

   Every stub here is copied from the shipped engine source and carries the
   file:line it came from. Where a stub simplifies, the simplification is the
   bug it will hide — so the awkward parts are kept.

   Line references: MV = MV rpg_*.js, MZ = MZ rmmz_*.js.
   A single reference means the two engines are byte-identical there (see
   docs/MV-MZ-DELTA.md §C.21, which lists the 33 hooks that port unchanged).

   Loaded FIRST. engine-mv.js / engine-mz.js then add the divergent surface,
   plugins-mv.js models a third-party stack, and fixtures.js instantiates the
   world. The order is explicit because the 1.x single-file harness was
   order- and hoisting-sensitive by construction: an assignment to
   ImageManager.loadCharacter placed above `var ImageManager` saw the hoisted
   `undefined` and was silently skipped (harness-1x.html:509-513).
   ========================================================================== */

window.__errors = [];
window.addEventListener('error', function (e) {
  window.__errors.push('ERROR: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno);
});

/* -------------------------------------------------------------------------
   A CONTROLLABLE requestAnimationFrame QUEUE.

   This is the single most important piece of the harness. On MV the frame
   loop perpetuates itself from inside SceneManager.updateMain
   (rpg_managers.js:1993 -> :1894 -> requestAnimationFrame), so "how many
   animation frames are pending" is the observable that separates a correct
   pause from a hard hang, and a correct speed multiplier from exponential
   runaway. A real rAF cannot be counted; this one can.

   __raf.flush() is one real animation frame: it takes the callbacks that
   were pending, clears the queue, advances the clock by one frame, and runs
   them. Callbacks scheduled DURING the flush land in the new queue, which is
   exactly what the browser does.
   ---------------------------------------------------------------------- */
window.__raf = {
  queue: [],
  frames: 0,
  request: function (cb) { this.queue.push(cb); return this.queue.length; },
  pending: function () { return this.queue.length; },
  flush: function () {
    var batch = this.queue;
    this.queue = [];
    this.frames++;
    window.__clock += 1000 / 60;
    for (var i = 0; i < batch.length; i++) {
      // A runaway loop would otherwise hang the test browser rather than
      // failing the check. 8192 is above the 4096 the 1.x speed hook reached
      // by frame 3, so the number the suite asserts on is still observable.
      if (i > 8192) { this.overflowed = true; break; }
      try { batch[i](window.__clock); } catch (e) { window.__errors.push('rAF: ' + e.message); }
    }
    return batch.length;
  },
  reset: function () { this.queue.length = 0; this.frames = 0; this.overflowed = false; },
  overflowed: false
};
window.__clock = 1000;

/* -------------------------------------------------------------------------
   Utils. RPGMAKER_NAME is the cleanest runtime discriminator between the two
   engines (MV rpg_core.js:173, MZ rmmz_core.js:187) and is set per engine in
   engine-*.js. isNwjs is `return !!(window.require && ...)` in MV and
   typeof require === "function" in MZ; false either way in a browser.
   ---------------------------------------------------------------------- */
/* Declared as a FUNCTION, not an object literal, because that is what both
   engines do: `function Utils() { throw new Error("This is a static class"); }`
   (MV rpg_core.js:161, MZ rmmz_core.js:177). The difference is not cosmetic.
   An object-literal stub makes `typeof Utils === "object"` true, and the mod
   had exactly that test in two places — so the engine version read as
   "unknown" on every real game while every harness check passed. This stub is
   the reason that went unnoticed; writing it the awkward way the engine does
   is what stops it happening again. */
function Utils() { throw new Error('This is a static class'); }
Utils.RPGMAKER_NAME = 'unknown';
Utils.RPGMAKER_VERSION = '0.0.0';
Utils.isNwjs = function () { return false; };
Utils.isMobileSafari = function () { return false; };
Utils.isOptionValid = function () { return false; };

/* -------------------------------------------------------------------------
   Number/String prototype extensions. Both engines ship these; MV adds them
   with plain assignment (rpg_core.js:24-77), MZ with Object.defineProperties
   (rmmz_core.js:24-90). The engine's own StorageManager.localFilePath uses
   String.format, so a harness without it fails inside the stub rather than in
   the code under test.
   ---------------------------------------------------------------------- */
/* MV rpg_core.js:24 / MZ rmmz_core.js:31 */
Number.prototype.clamp = function (min, max) {
  return Math.min(Math.max(this, min), max);
};
/* MV rpg_core.js:46 / MZ rmmz_core.js:57 */
String.prototype.format = function () {
  var args = arguments;
  return this.replace(/%([0-9]+)/g, function (s, n) { return args[Number(n) - 1]; });
};
/* MV rpg_core.js:60 / MZ rmmz_core.js:71 */
String.prototype.padZero = function (length) {
  var s = String(this);
  while (s.length < length) s = '0' + s;
  return s;
};
/* Array.prototype.clone: MV rpg_core.js:108 (Object.defineProperties, NOT
   enumerable) / MZ rmmz_core.js:106. Game_Screen.startTint calls tone.clone()
   inside the engine, so anything handed an object literal throws in there. */
if (!Array.prototype.clone) {
  Object.defineProperty(Array.prototype, 'clone', {
    enumerable: false, configurable: true, value: function () { return this.slice(0); }
  });
}
/* Array.prototype.equals: MV rpg_core.js:87 / MZ rmmz_core.js:92. */
if (!Array.prototype.equals) {
  Object.defineProperty(Array.prototype, 'equals', {
    enumerable: false, configurable: true,
    value: function (array) {
      if (!array || this.length !== array.length) return false;
      for (var i = 0; i < this.length; i++) {
        if (this[i] instanceof Array && array[i] instanceof Array) {
          if (!this[i].equals(array[i])) return false;
        } else if (this[i] !== array[i]) return false;
      }
      return true;
    }
  });
}

/* -------------------------------------------------------------------------
   Graphics — the parts that agree. frameCount is module scope in MV
   (rpg_core.js:1798) and assigned in initialize() in MZ (rmmz_core.js:501);
   both are writable, which is what lets the Save panel edit playtime.
   The canvas id and the fps meter differ and live in engine-*.js.
   ---------------------------------------------------------------------- */
var Graphics = {
  frameCount: 0,
  _realScale: 1,
  width: 816, height: 624,
  boxWidth: 816, boxHeight: 624,
  _renders: 0,
  /* MV rpg_core.js:1871 / MZ has no equivalent free function — MZ renders
     from Graphics._onTick. Counted so the suite can prove that pausing on MV
     does not stop the screen being drawn. */
  render: function () { Graphics._renders++; Graphics.frameCount++; },
  printError: function () { },
  isWebGL: function () { return false; }
};

/* -------------------------------------------------------------------------
   PixiJS surface. The mod's total PIXI use is Container, Graphics, Point and
   getBounds (MV-MZ-DELTA.md §C.17). Every draw call is recorded so the
   in-scene overlays can be asserted on — their geometry is not in the DOM.
   ---------------------------------------------------------------------- */
var PIXI = {
  VERSION: '0.0.0',
  Container: function () {
    this.children = []; this.visible = true; this.x = 0; this.y = 0;
    this.addChild = function (c) { this.children.push(c); c.parent = this; return c; };
    this.addChildAt = function (c, i) { this.children.splice(i, 0, c); c.parent = this; return c; };
    this.removeChild = function (c) { var i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); return c; };
    this.destroy = function () { this.destroyed = true; };
  },
  Graphics: function () {
    this.children = []; this.visible = true; this.x = 0; this.y = 0;
    this.calls = []; this.rects = []; this.clears = 0;
    this._fill = null; this._line = null;
    this.clear = function () {
      this.clears++; this.calls.length = 0; this.rects.length = 0;
      this._fill = null; this._line = null; return this;
    };
    this.beginFill = function (c, a) { this._fill = { colour: c, alpha: a }; this.calls.push(['beginFill', c, a]); return this; };
    this.endFill = function () { this._fill = null; this.calls.push(['endFill']); return this; };
    this.lineStyle = function (w, c, a) {
      this._line = w ? { width: w, colour: c, alpha: a } : null;
      this.calls.push(['lineStyle', w, c, a]); return this;
    };
    this.drawRect = function (x, y, w, h) {
      this.rects.push({
        x: x, y: y, w: w, h: h,
        fill: this._fill ? this._fill.colour : null, fillAlpha: this._fill ? this._fill.alpha : null,
        line: this._line ? this._line.colour : null, lineWidth: this._line ? this._line.width : 0
      });
      this.calls.push(['drawRect', x, y, w, h]); return this;
    };
    this.addChild = function (c) { this.children.push(c); return c; };
    this.destroy = function () { this.destroyed = true; };
  }
};

/* Bitmap. clear() really is clearRect(0,0,w,h) on both engines
   (MV rpg_core.js:1237, MZ rmmz_core.js:1555). The defaults differ per engine
   and are set in engine-*.js. */
function Bitmap(w, h) {
  this.width = w; this.height = h; this.text = ''; this.draws = 0;
  this.fontSize = 12; this.textColor = '#fff'; this.outlineColor = '#000'; this.outlineWidth = 0;
  this.fontFace = 'sans-serif';
  this._destroyed = false;
}
Bitmap.prototype.clearRect = function () { this.text = ''; };
Bitmap.prototype.clear = function () { this.clearRect(0, 0, this.width, this.height); };
Bitmap.prototype.drawText = function (t) { this.text = String(t); this.draws++; };
Bitmap.prototype.measureTextWidth = function (t) { return String(t).length * 6; };
Bitmap.prototype.isReady = function () { return !this._destroyed; };
Bitmap.prototype.fillRect = function () { };
Bitmap.prototype.gradientFillRect = function () { };
Bitmap.prototype.destroy = function () { this._destroyed = true; };

function Sprite(bmp) { this.bitmap = bmp || null; this.visible = true; this.x = 0; this.y = 0; this.children = []; }
Sprite.prototype.update = function () { };
Sprite.prototype.addChild = function (c) { this.children.push(c); c.parent = this; return c; };

/* Point is a PIXI.Point subclass in MV (rpg_core.js:621) and plain in MZ
   (rmmz_core.js:1136); worldTransform.apply behaves the same either way. */
function Point(x, y) { this.x = x || 0; this.y = y || 0; }
function Transform2D(dx, dy) {
  this.dx = dx; this.dy = dy;
  this.apply = function (p) { return new Point(p.x + this.dx, p.y + this.dy); };
}
function Rectangle(x, y, w, h) { this.x = x || 0; this.y = y || 0; this.width = w || 0; this.height = h || 0; }

/* -------------------------------------------------------------------------
   Input. keyMapper is BYTE-IDENTICAL between the engines: 24 entries
   (MV rpg_core.js:3002-3027, MZ rmmz_core.js:5683-5708). The table is
   reproduced in full rather than trimmed, because Profile derives GigaHack's
   default hotkeys by subtracting everything keyMapper has claimed — a
   shortened table would hand the mod free letters the real engine does not
   have.

   This is one of the few places where reproducing the engine exactly is the
   only correct option: a key-code map is the engine's interface, it is fact
   rather than expression, and there is no other way to write which key means
   'ok'. See stubs/README.md for where the line is drawn.
   ---------------------------------------------------------------------- */
var Input = {
  keyMapper: {
    9: 'tab', 13: 'ok', 16: 'shift', 17: 'control', 18: 'control', 27: 'escape',
    32: 'ok', 33: 'pageup', 34: 'pagedown', 37: 'left', 38: 'up', 39: 'right',
    40: 'down', 45: 'escape', 81: 'pageup', 87: 'pagedown', 88: 'escape',
    90: 'ok', 96: 'escape', 98: 'down', 100: 'left', 102: 'right', 104: 'up', 120: 'debug'
  },
  _currentState: {}, _previousState: {},
  clear: function () { window.__inputCleared = (window.__inputCleared || 0) + 1; },
  /* Input.update() is the only place _previousState is snapshotted, which is
     the false->true edge isTriggered needs (MV rpg_core.js:3073 /
     MZ rmmz_core.js:5747). Skipping it makes a quick tap invisible. */
  update: function () {
    window.__inputUpdates = (window.__inputUpdates || 0) + 1;
    this._previousState = {};
    for (var k in this._currentState) this._previousState[k] = this._currentState[k];
  },
  isPressed: function (n) { return !!this._currentState[n]; },
  isTriggered: function (n) { return !!this._currentState[n] && !this._previousState[n]; }
};
var TouchInput = {
  x: 0, y: 0,
  clear: function () { },
  update: function () { window.__touchUpdates = (window.__touchUpdates || 0) + 1; },
  isTriggered: function () { return !!window.__touchTriggered; }
};

var SoundManager = {
  playSave: function () { window.__playedSave = (window.__playedSave || 0) + 1; },
  playLoad: function () { window.__playedLoad = (window.__playedLoad || 0) + 1; },
  playBuzzer: function () { window.__playedBuzzer = (window.__playedBuzzer || 0) + 1; },
  playOk: function () { }
};
var AudioManager = { stopAll: function () { } };

/* -------------------------------------------------------------------------
   Scenes. Only the seams the mod aliases.
   ---------------------------------------------------------------------- */
function Scene_Base() { }
Scene_Base.prototype.isActive = function () { return window.__sceneActive !== false; };
Scene_Base.prototype.isStarted = function () { return true; };
Scene_Base.prototype.isReady = function () { return true; };
Scene_Base.prototype.isBusy = function () { return false; };
Scene_Base.prototype.update = function () { };
Scene_Base.prototype.terminate = function () { };
Scene_Base.prototype.create = function () { };
Scene_Base.prototype.start = function () { };
Scene_Base.prototype.fadeOutAll = function () { window.__fadedOut = (window.__fadedOut || 0) + 1; };
Scene_Base.prototype.attachReservation = function () { };
Scene_Base.prototype.detachReservation = function () { };

function Scene_Map() { }
Scene_Map.prototype = Object.create(Scene_Base.prototype);
Scene_Map.prototype.constructor = Scene_Map;
/* MV rpg_scenes.js:773 / MZ rmmz_scenes.js:1057 — byte-identical. */
Scene_Map.prototype.updateCallMenu = function () { window.__calledMenu = (window.__calledMenu || 0) + 1; };
Scene_Map.prototype.isMapTouchOk = function () { return this.isActive() && $gamePlayer.canMove(); };
/* MV rpg_scenes.js:678 / MZ rmmz_scenes.js:915 — updateDestination gates
   processMapTouch on $gamePlayer.canMove() through isMapTouchOk. */
Scene_Map.prototype.updateDestination = function () {
  if (this.isMapTouchOk()) this.processMapTouch();
  else window.__destCleared = (window.__destCleared || 0) + 1;
};
Scene_Map.prototype.processMapTouch = function () { window.__mapWalks = (window.__mapWalks || 0) + 1; };
/* MV rpg_scenes.js:567 / MZ rmmz_scenes.js:783. */
Scene_Map.prototype.onMapLoaded = function () { window.__mapLoaded = (window.__mapLoaded || 0) + 1; };
Scene_Map.prototype.update = function () {
  Scene_Base.prototype.update.call(this);
  window.__sceneMapUpdates = (window.__sceneMapUpdates || 0) + 1;
};

function Scene_Battle() { }
Scene_Battle.prototype = Object.create(Scene_Base.prototype);
Scene_Battle.prototype.constructor = Scene_Battle;

/* Scene_Boot.start: MV rpg_scenes.js:391 / MZ rmmz_scenes.js:321. The bodies
   differ (MZ added startNormalGame + resizeScreen) but every mod hook runs
   AFTER the original on both, so one stub covers them. __bootProbe is how a
   test asks what the chain could see when it ran, without reaching into a
   closure — the trick that caught an ordering check measuring its own wrapper. */
function Scene_Boot() { }
Scene_Boot.prototype = Object.create(Scene_Base.prototype);
Scene_Boot.prototype.constructor = Scene_Boot;
Scene_Boot.prototype.start = function () {
  window.__bootStarts = (window.__bootStarts || 0) + 1;
  window.__bootSaw = window.__bootProbe ? window.__bootProbe() : null;
};

/* Scene_File. mode() exists on both (MV rpg_scenes.js:1664 / MZ :2321).
   isSavefileEnabled is MZ-ONLY and lives in engine-mz.js: MV's Scene_File has
   no such member and MV's Window_SavefileList has no isEnabled, so slot
   enablement simply does not exist there (MV-MZ-DELTA.md §A.4). */
function Scene_File() { }
Scene_File.prototype = Object.create(Scene_Base.prototype);
Scene_File.prototype.constructor = Scene_File;
Scene_File.prototype.mode = function () { return window.__fileMode || 'save'; };

/* -------------------------------------------------------------------------
   SceneManager — the parts that agree.

   goto (MV :2074 / MZ :2208), push (MV :2083 / MZ :2217), isSceneChanging
   (MV :2054 / MZ :2192) and updateInputData (MV :1970 / MZ :2114) are
   byte-identical. updateMain, updateScene, changeScene, renderScene and
   requestUpdate differ structurally and live in engine-*.js — that difference
   is the whole point of the two-engine harness.
   ---------------------------------------------------------------------- */
var SceneManager = {
  _scene: null,
  _nextScene: null,
  _stack: [],
  _exiting: false,
  _stopped: false,
  _sceneStarted: true,
  goto: function (sc) { window.__gotoScene = sc && sc.name; },
  push: function (sc) { window.__pushed = (window.__pushed && window.__pushed.concat([sc.name])) || [sc.name]; },
  isSceneChanging: function () { return this._exiting || !!this._nextScene; },
  isCurrentSceneBusy: function () { return this._scene && this._scene.isBusy(); },
  isCurrentSceneStarted: function () { return this._scene && this._sceneStarted; },
  /* MV rpg_managers.js:1970 / MZ rmmz_managers.js:2114 — `Input.update();
     TouchInput.update();` in both. */
  updateInputData: function () {
    window.__inputPolls = (window.__inputPolls || 0) + 1;
    Input.update(); TouchInput.update();
  },
  /* MV rpg_managers.js:2000 / MZ rmmz_managers.js:2172. Trimmed to the branch
     the mod's pause gate cares about: is a scene change pending. */
  changeScene: function () {
    window.__sceneChanges = (window.__sceneChanges || 0) + 1;
    if (this.isSceneChanging() && !this.isCurrentSceneBusy()) {
      if (this._scene) { this._scene.terminate(); this._previousClass = this._scene.constructor; }
      this._scene = this._nextScene;
      if (this._scene) { this._scene.create(); this._nextScene = null; this._sceneStarted = false; }
    }
  },
  /* MV rpg_managers.js:2021 (uses _sceneStarted) / MZ rmmz_managers.js:2143
     (uses isStarted() and gates on document.hasFocus()). The shared shape is
     "start the scene if it is ready, then update it"; MV has no focus gate,
     which matters to anything that moves the pause hook here. */
  updateScene: function () {
    window.__sceneUpdates = (window.__sceneUpdates || 0) + 1;
    if (this._scene) {
      if (!this._sceneStarted && this._scene.isReady()) { this._scene.start(); this._sceneStarted = true; }
      if (this.isCurrentSceneStarted()) this._scene.update();
    }
  },
  catchException: function (e) { window.__caught = (window.__caught || 0) + 1; window.__errors.push('caught: ' + e.message); }
};

/* -------------------------------------------------------------------------
   DataManager — the parts that agree.

   The save/load API is completely different between engines (Promise vs
   synchronous boolean, name-keyed vs id-keyed) and lives in engine-*.js.
   ---------------------------------------------------------------------- */
var DataManager = {
  /* MV rpg_managers.js:200 / MZ rmmz_managers.js:241 — createGameObjects
     REPLACES every $game* global with a blank one, and loadGame calls it
     BEFORE extractSaveContents. A stub that only made a new $gameTemp hides
     the whole hazard: a save that fails to extract leaves the running scene
     pointed at empty objects. */
  _LOAD_GLOBALS: ['$gameSystem', '$gameScreen', '$gameTimer', '$gameMessage', '$gameSwitches',
    '$gameVariables', '$gameSelfSwitches', '$gameActors', '$gameParty', '$gameTroop',
    '$gameMap', '$gamePlayer'],
  /* makeSaveContents writes TEN keys and deliberately not $gameTemp,
     $gameMessage or $gameTroop (the same comment sits in both engines'
     source). Saving more than the engine does would let a load put back
     objects a real load never touches. */
  _SAVE_GLOBALS: ['$gameSystem', '$gameScreen', '$gameTimer', '$gameSwitches',
    '$gameVariables', '$gameSelfSwitches', '$gameActors', '$gameParty',
    '$gameMap', '$gamePlayer'],
  createGameObjects: function () {
    window.$gameTemp = new Game_Temp();
    this._LOAD_GLOBALS.forEach(function (n) {
      var cur = window[n];
      window[n] = (cur && cur.constructor && cur.constructor !== Object) ? new cur.constructor() : null;
    });
    window.__createdGameObjects = (window.__createdGameObjects || 0) + 1;
  },
  setupNewGame: function () { window.__newGames = (window.__newGames || 0) + 1; },
  maxSavefiles: function () { return 20; },      // 20 on both (MV :333 / MZ :331)

  /* MV rpg_managers.js:1712 / MZ rmmz_managers.js:186 minus the meta shape.
     These four are IDENTITY tests, not id comparisons — $dataItems.includes(item).
     An id comparison would let the Forge hand the party a detached copy of a
     definition and still pass, while the engine files it under no container. */
  isSkill: function (item) { return item && $dataSkills.indexOf(item) > -1; },
  isItem: function (item) { return item && $dataItems.indexOf(item) > -1; },
  isWeapon: function (item) { return item && $dataWeapons.indexOf(item) > -1; },
  isArmor: function (item) { return item && $dataArmors.indexOf(item) > -1; },

  /* MV rpg_managers.js:1725 / MZ rmmz_managers.js:186. STOCK: `meta` only.
     The 1.x harness also wrote `metaArray`, which came from a plugin that one
     game shipped — not from either engine. 2.0 targets arbitrary games, so
     the stock shape is what the stubs model, and the plugin shape (where it
     is wanted) belongs in plugins-mv.js. */
  extractMetadata: function (data) {
    var regExp = /<([^<>:]+)(:?)([^>]*)>/g;
    data.meta = {};
    for (;;) {
      var match = regExp.exec(data.note);
      if (match) data.meta[match[1]] = match[2] === ':' ? match[3] : true;
      else break;
    }
  },
  /* DataManager.onLoad exists on both and is where extractMetadata runs. The
     mod hooks it twice (Profile re-resolve, Index fallback kick). */
  onLoad: function (object) {
    window.__onLoads = (window.__onLoads || 0) + 1;
    window.__lastLoaded = object;
    return object;
  },

  /* makeSaveContents / extractSaveContents write and read the same ten keys
     in the same order on both engines (MV :430-457 / MZ :389-416). */
  makeSaveContents: function () {
    var c = {};
    c.system = $gameSystem; c.screen = $gameScreen; c.timer = null;
    c.switches = $gameSwitches; c.variables = $gameVariables; c.selfSwitches = $gameSelfSwitches;
    c.actors = $gameActors; c.party = $gameParty; c.map = $gameMap; c.player = $gamePlayer;
    window.__madeContents = (window.__madeContents || 0) + 1;
    return c;
  },
  extractSaveContents: function (contents) {
    window.__extracted = (window.__extracted || 0) + 1;
    if (contents && contents.globals) {
      Object.keys(contents.globals).forEach(function (n) { window[n] = contents.globals[n]; });
    }
    return contents;
  },
  correctDataErrors: function () { },
  isBattleTest: function () { return false; },
  isEventTest: function () { return false; }
};

/* -------------------------------------------------------------------------
   Game objects
   ---------------------------------------------------------------------- */
function Game_Temp() { this._commonEventQueue = []; }
/* reserveCommonEvent queues an id for whichever interpreter is free next.
   Building a Game_Interpreter by hand instead runs it outside the map's own
   update, where its waits never tick. Present on both engines. */
Game_Temp.prototype.reserveCommonEvent = function (id) {
  this._commonEventQueue.push(id);
  window.__reservedCommon = (window.__reservedCommon || []).concat([id]);
};
Game_Temp.prototype.retrieveCommonEvent = function () { return $dataCommonEvents[this._commonEventQueue.shift()]; };
Game_Temp.prototype.isCommonEventReserved = function () { return this._commonEventQueue.length > 0; };
Game_Temp.prototype.requestBattleRefresh = function () { window.__battleRefresh = (window.__battleRefresh || 0) + 1; };

/* Game_System — the shared surface. mainFontFace/mainFontSize and
   setSavefileId are MZ-ONLY and live in engine-mz.js; adding them here would
   hide the two capabilities the whole port turns on. */
function Game_System() {
  this._saveCount = 0; this._versionId = 0; this._framesOnSave = 0;
  this._saveDisabled = false; this._encounterEnabled = true;
}
Game_System.prototype.saveCount = function () { return this._saveCount; };
/* Playtime is DERIVED from Graphics.frameCount, not stored. _framesOnSave is
   what onAfterLoad puts back, which is why editing playtime writes both.
   MV rpg_objects.js:243 / MZ rmmz_objects.js:365. */
Game_System.prototype.playtime = function () { return Math.floor(Graphics.frameCount / 60); };
Game_System.prototype.playtimeText = function () {
  var t = this.playtime();
  var hour = Math.floor(t / 60 / 60), min = Math.floor(t / 60) % 60, sec = t % 60;
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(hour) + ':' + p(min) + ':' + p(sec);
};
/* onBeforeSave and setSavefileId are the SCENE's job, not saveGame's, and
   onAfterLoad runs from Scene_Load.terminate — after the scene is already
   being left. A stub that folded either into save/load would hide the whole
   reason quick save and quick load have to sequence them by hand. */
Game_System.prototype.onBeforeSave = function () {
  this._saveCount++; this._versionId = $dataSystem.versionId;
  this._framesOnSave = Graphics.frameCount;
  window.__onBeforeSave = (window.__onBeforeSave || 0) + 1;
};
Game_System.prototype.onAfterLoad = function () {
  Graphics.frameCount = this._framesOnSave;
  window.__onAfterLoad = (window.__onAfterLoad || 0) + 1;
};
Game_System.prototype.versionId = function () { return this._versionId; };
Game_System.prototype.isSaveEnabled = function () { return !this._saveDisabled; };
Game_System.prototype.isEncounterEnabled = function () { return this._encounterEnabled !== false; };
Game_System.prototype.disableEncounter = function () { this._encounterEnabled = false; };
Game_System.prototype.isChinese = function () { return false; };
Game_System.prototype.isKorean = function () { return false; };

/* Game_CharacterBase — the noclip and speed hooks install HERE and are
   reached through the prototype chain. Copying these onto Game_Player would
   let a hook patch an object nobody calls. */
function Game_CharacterBase() {
  this._through = false; this._transparent = false; this._opacity = 255;
  this._moveSpeed = 4; this._x = 0; this._y = 0;
}
Game_CharacterBase.prototype.isThrough = function () { return this._through; };
Game_CharacterBase.prototype.setThrough = function (v) { this._through = v; };
Game_CharacterBase.prototype.isDebugThrough = function () { return false; };
Game_CharacterBase.prototype.isTransparent = function () { return this._transparent; };
Game_CharacterBase.prototype.setTransparent = function (v) { this._transparent = v; };
Game_CharacterBase.prototype.opacity = function () { return this._opacity; };
Game_CharacterBase.prototype.setOpacity = function (v) { this._opacity = v; };
Game_CharacterBase.prototype.isDashing = function () { return false; };
/* MV rpg_objects.js:6364 / MZ rmmz_objects.js:7058 — identical. */
Game_CharacterBase.prototype.realMoveSpeed = function () { return this._moveSpeed + (this.isDashing() ? 1 : 0); };
Game_CharacterBase.prototype.isMapPassable = function (x, y, d) { return !window.__wallAt || !window.__wallAt(x, y, d); };
Game_CharacterBase.prototype.isCollidedWithCharacters = function (x, y) { return !!(window.__eventAt && window.__eventAt(x, y)); };
/* MV rpg_objects.js:6391 / MZ rmmz_objects.js:7085, verbatim in structure —
   the isThrough short-circuit sits AFTER the validity check and BEFORE
   passability and collision. */
Game_CharacterBase.prototype.canPass = function (x, y, d) {
  var x2 = $gameMap.roundXWithDirection(x, d), y2 = $gameMap.roundYWithDirection(y, d);
  if (!$gameMap.isValid(x2, y2)) return false;
  if (this.isThrough() || this.isDebugThrough()) return true;
  if (!this.isMapPassable(x, y, d)) return false;
  if (this.isCollidedWithCharacters(x2, y2)) return false;
  return true;
};

function Game_Player() { Game_CharacterBase.call(this); this._encounterCount = 30; this._dashing = false; }
Game_Player.prototype = Object.create(Game_CharacterBase.prototype);
Game_Player.prototype.constructor = Game_Player;
Game_Player.prototype.canMove = function () { return true; };
Game_Player.prototype.isDashing = function () { return this._dashing; };
Game_Player.prototype.direction = function () { return 2; };
Game_Player.prototype.followers = function () {
  if (!this._followers) this._followers = new Game_Followers();
  return this._followers;
};
/* MV rpg_objects.js:7862 / MZ rmmz_objects.js:8565 — identical. */
Game_Player.prototype.canEncounter = function () {
  return !$gameParty.hasEncounterNone() && $gameSystem.isEncounterEnabled() && !this.isDebugThrough();
};
Game_Player.prototype.encounterProgressValue = function () { return 1; };
Game_Player.prototype.updateEncounterCount = function () {
  if (this.canEncounter()) this._encounterCount -= this.encounterProgressValue();
};
Game_Player.prototype.makeEncounterCount = function () {
  window.__encounterCounts = (window.__encounterCounts || 0) + 1;
  this._encounterCount = 30;
};
/* MV rpg_objects.js:7572 / MZ rmmz_objects.js:8269 — a weighted roll, and
   crucially `if (weightSum > 0)` … else fall through and return 0.
   $dataTroops[0] is null, so an empty table yields no battle at all. */
Game_Player.prototype.makeEncounterTroopId = function () {
  var list = $gameMap.encounterList() || [], sum = 0;
  list.forEach(function (e) { sum += e.weight; });
  if (sum <= 0) return 0;
  return window.__mapTroopId != null ? window.__mapTroopId : list[0].troopId;
};
/* MV rpg_objects.js:7598 / MZ rmmz_objects.js:8297 — it re-rolls the counter
   BEFORE the $dataTroops lookup and returns false when that lookup is null. */
Game_Player.prototype.executeEncounter = function () {
  if (!$gameMap.isEventRunning() && this._encounterCount <= 0) {
    this.makeEncounterCount();
    var id = this.makeEncounterTroopId();
    if (!$dataTroops[id]) return false;
    window.__encounterStarted = id;
    return true;
  }
  return false;
};
Game_Player.prototype.checkEventTriggerTouch = function () { window.__touchTriggers = (window.__touchTriggers || 0) + 1; };
/* updateNonmoving calls this with [1,2] after every step — the path a trap or
   a transfer on the tile you walked ONTO fires through, which is different
   from bumping into a solid one. MV :7878 / MZ :8586. */
Game_Player.prototype.checkEventTriggerHere = function () { window.__hereTriggers = (window.__hereTriggers || 0) + 1; };
Game_Player.prototype.canStartLocalEvents = function () { return true; };
Game_Player.prototype.refresh = function () {
  var a = $gameParty.leader ? $gameParty.leader() : null;
  this._characterName = a ? a._characterName : '';
  this._characterIndex = a ? a._characterIndex : 0;
  window.__playerRefreshes = (window.__playerRefreshes || 0) + 1;
};
Game_Player.prototype.scrolledX = function () { return $gameMap.adjustX ? $gameMap.adjustX(this._x) : this._x; };
Game_Player.prototype.scrolledY = function () { return $gameMap.adjustY ? $gameMap.adjustY(this._y) : this._y; };
Game_Player.prototype.screenX = function () { return Math.round(this.scrolledX() * 48 + 24); };
Game_Player.prototype.screenY = function () { return Math.round(this.scrolledY() * 48 + 48); };
Game_Player.prototype.reserveTransfer = function (m, x, y, d, f) {
  window.__transfer = { mapId: m, x: x, y: y, d: d, fade: f };
  $gameMap.mapId = function () { return m; };
  $gamePlayer._x = x; $gamePlayer._y = y;
  $gameMap.onTransfer && $gameMap.onTransfer();
};
Object.defineProperties(Game_Player.prototype, {
  x: { get: function () { return this._x; }, configurable: true },
  y: { get: function () { return this._y; }, configurable: true }
});

/* Game_Followers. data()/reverseData() exist only on MZ; forEach/reverseEach
   only on MV (MV rpg_objects.js:8102, MZ rmmz_objects.js:8815). Which of the
   two this class gets is decided in engine-*.js — the 1.x suite asserted the
   MZ answer and that assertion inverts here. */
/* Game_Follower — a real subclass with actor() and isVisible(), because the
   follower panel asks each follower which party member it is standing in for.
   MV rpg_objects.js:8036 / MZ rmmz_objects.js:8719 — identical bodies. A stub
   made of bare Game_CharacterBase objects has no actor() at all, and the
   panel's read throws on a class the engine does have. */
function Game_Follower(memberIndex) {
  Game_CharacterBase.call(this);
  this._memberIndex = memberIndex;
  this.setThrough(true);
}
Game_Follower.prototype = Object.create(Game_CharacterBase.prototype);
Game_Follower.prototype.constructor = Game_Follower;
Game_Follower.prototype.actor = function () { return $gameParty.battleMembers()[this._memberIndex]; };
Game_Follower.prototype.isVisible = function () { return !!this.actor() && $gamePlayer.followers().isVisible(); };
Game_Follower.prototype.refresh = function () {
  var a = this.isVisible() ? this.actor() : null;
  this._characterName = a ? a._characterName : '';
  this._characterIndex = a ? a._characterIndex : 0;
};

function Game_Followers() { this._visible = true; this._data = [new Game_Follower(1), new Game_Follower(2)]; }
Game_Followers.prototype.isVisible = function () { return this._visible; };
Game_Followers.prototype.show = function () { this._visible = true; };
Game_Followers.prototype.hide = function () { this._visible = false; };
Game_Followers.prototype.follower = function (i) { return this._data[i]; };
/* A follower copies the player's opacity and transparency EVERY frame, which
   is why setting them per-follower is a switch that does nothing.
   MV rpg_objects.js:8218 / MZ rmmz_objects.js:8756. */
Game_Followers.prototype.update = function () {
  this._data.forEach(function (f) {
    f.setOpacity($gamePlayer.opacity());
    f.setTransparent($gamePlayer.isTransparent());
  });
};

/* Game_Map. tileEvents vs _tileEvents is the one field that changed
   visibility; it is set in engine-*.js. */
function Game_Map() { this._mapId = 12; this._tilesetId = 1; this._events = []; }
Game_Map.prototype.mapId = function () { return this._mapId; };
Game_Map.prototype.isEventRunning = function () { return !!window.__eventRunning; };
Game_Map.prototype.requestRefresh = function () { window.__refreshes = (window.__refreshes || 0) + 1; };
/* _events is SPARSE and indexed by EVENT ID — the engine builds it that way in
   setupEvents (`this._events[event.id] = new Game_Event(...)`, MV
   rpg_objects.js:5548 / MZ rmmz_objects.js:6228) and every reader compensates.
   A dense array here made $gameMap.event(1) return the SECOND event, so
   anything resolving a writer's _eventId back to an event resolved the wrong
   one — and only in the harness. */
Game_Map.prototype.events = function () {
  return this._events.filter(function (e) { return !!e; });
};
Game_Map.prototype.event = function (eventId) { return this._events[eventId]; };
Game_Map.prototype.eventsXy = function (x, y) {
  return this.events().filter(function (e) { return e.pos(x, y); });
};
Game_Map.prototype.tileWidth = function () { return ('tileSize' in $dataSystem) ? $dataSystem.tileSize : 48; };
Game_Map.prototype.tileHeight = function () { return this.tileWidth(); };
Game_Map.prototype.width = function () { return $dataMap.width; };
Game_Map.prototype.height = function () { return $dataMap.height; };
Game_Map.prototype.isLoopHorizontal = function () { return false; };
Game_Map.prototype.isLoopVertical = function () { return false; };
Game_Map.prototype.displayX = function () { return this._displayX || 0; };
Game_Map.prototype.displayY = function () { return this._displayY || 0; };
Game_Map.prototype.adjustX = function (x) { return x - this.displayX(); };
Game_Map.prototype.adjustY = function (y) { return y - this.displayY(); };
Game_Map.prototype.roundX = function (x) { return x; };
Game_Map.prototype.roundY = function (y) { return y; };
/* direction 2 down, 4 left, 6 right, 8 up. Identical on both. */
Game_Map.prototype.roundXWithDirection = function (x, d) { return this.roundX(x + (d === 6 ? 1 : d === 4 ? -1 : 0)); };
Game_Map.prototype.roundYWithDirection = function (y, d) { return this.roundY(y + (d === 2 ? 1 : d === 8 ? -1 : 0)); };
Game_Map.prototype.encounterList = function () {
  return window.__encounterList != null ? window.__encounterList : [];
};
Game_Map.prototype.encounterStep = function () { return 30; };
Game_Map.prototype.isValid = function (x, y) { return x >= 0 && x < this.width() && y >= 0 && y < this.height(); };
Game_Map.prototype.regionId = function (x, y) { return this.isValid(x, y) ? (((x + y) % 3 === 0) ? (1 + ((x * 3 + y) % 7)) : 0) : 0; };
Game_Map.prototype.canvasToMapX = function (x) { var tw = this.tileWidth(); return this.roundX(Math.floor((this.displayX() * tw + x) / tw)); };
Game_Map.prototype.canvasToMapY = function (y) { var th = this.tileHeight(); return this.roundY(Math.floor((this.displayY() * th + y) / th)); };
Game_Map.prototype.tileset = function () { return $dataTilesets[this._tilesetId]; };
Game_Map.prototype.tilesetId = function () { return this._tilesetId; };
Game_Map.prototype.tilesetFlags = function () { var t = this.tileset(); return t ? t.flags : []; };
Game_Map.prototype.tileId = function (x, y, z) { return $dataMap.data[(z * $dataMap.height + y) * $dataMap.width + x] || 0; };
Game_Map.prototype.layeredTiles = function (x, y) { var t = []; for (var i = 0; i < 4; i++) t.push(this.tileId(x, y, 3 - i)); return t; };
/* MV rpg_objects.js:5838 / MZ rmmz_objects.js:6521 — reads the tile-event
   list whose NAME differs between engines, which is why the probe object in
   the map module must set the right one or this dereferences undefined. */
Game_Map.prototype.tileEventsXy = function (x, y) {
  var list = this[window.__tileEventsKey] || [];
  return list.filter(function (e) { return e.pos(x, y); });
};
Game_Map.prototype.allTiles = function (x, y) { return this.tileEventsXy(x, y).concat(this.layeredTiles(x, y)); };
Game_Map.prototype.checkPassage = function (x, y, bit) {
  var flags = this.tilesetFlags(), tiles = this.allTiles(x, y);
  for (var i = 0; i < tiles.length; i++) {
    var f = flags[tiles[i]];
    if ((f & 0x10) !== 0) continue;
    if ((f & bit) === 0) return true;
    if ((f & bit) === bit) return false;
  }
  return false;
};
Game_Map.prototype.isPassable = function (x, y, d) { return this.checkPassage(x, y, (1 << (d / 2 - 1)) & 0x0f); };
/* MV rpg_objects.js:5637 / MZ rmmz_objects.js:6293 — setup() is what a map
   transfer calls, and it is where the encounter probe re-checks. */
Game_Map.prototype.setup = function (mapId) {
  this._mapId = mapId;
  this._events = this._events || [];
  this.refreshTileEvents();
  window.__mapSetups = (window.__mapSetups || 0) + 1;
};
Game_Map.prototype.refresh = function () {
  this._events.forEach(function (e) { e.refresh(); });
  this.refreshTileEvents();
  window.__mapRefreshes = (window.__mapRefreshes || 0) + 1;
};

function Game_Variables() { this._data = []; }
Game_Variables.prototype.value = function (id) { return this._data[id] || 0; };
Game_Variables.prototype.setValue = function (id, v) {
  if (id > 0 && id < $dataSystem.variables.length) {
    if (typeof v === 'number') v = Math.floor(v);
    this._data[id] = v; $gameMap.requestRefresh();
  }
};
function Game_Switches() { this._data = []; }
Game_Switches.prototype.value = function (id) { return !!this._data[id]; };
Game_Switches.prototype.setValue = function (id, v) {
  if (id > 0 && id < $dataSystem.switches.length) { this._data[id] = v; $gameMap.requestRefresh(); }
};
function Game_SelfSwitches() { this._data = {}; }
Game_SelfSwitches.prototype.value = function (k) { return !!this._data[k]; };
Game_SelfSwitches.prototype.setValue = function (k, v) { if (v) this._data[k] = true; else delete this._data[k]; };

function Game_Event(id, name, x, y) {
  this._eventId = id; this._name = name; this._x = x; this._y = y; this._pageIndex = 0;
  this._moveRouteIndex = 0; this._realX = x; this._realY = y;
}
/* Game_Character.locate is setPosition PLUS straightening and dropping the
   move route. setPosition alone leaves an event mid-step, so it slides back
   on the next frame. Identical on both engines. */
Game_Event.prototype.setPosition = function (x, y) { this._x = x; this._y = y; this._realX = x; this._realY = y; };
Game_Event.prototype.straighten = function () { this._pattern = 1; };
Game_Event.prototype.locate = function (x, y) {
  this.setPosition(x, y); this.straighten(); this._moveRouteIndex = 0;
  window.__eventLocates = (window.__eventLocates || 0) + 1;
};
/* An event walking into the player fires through its OWN prototype, not the
   player's, so ghosting has to cover both. MV :8721 / MZ :9438. */
Game_Event.prototype.checkEventTriggerTouch = function () { window.__eventTouches = (window.__eventTouches || 0) + 1; };
Game_Event.prototype.eventId = function () { return this._eventId; };
Game_Event.prototype.event = function () { return $dataMap.events[this._eventId]; };
Game_Event.prototype.page = function () { var d = this.event(); return d && d.pages[this._pageIndex]; };
Game_Event.prototype.list = function () { var p = this.page(); return p && p.list; };
Game_Event.prototype.pos = function (x, y) { return this._x === x && this._y === y; };
Game_Event.prototype.isStarting = function () { return !!this._starting; };
Game_Event.prototype.isTile = function () { return false; };
Game_Event.prototype.start = function () {
  var list = this.list();
  if (list && list.length > 1) { this._starting = true; window.__started = (window.__started || 0) + 1; }
};
Game_Event.prototype.refresh = function () {
  var d = this.event(); this._pageIndex = -1;
  if (!d) return;
  for (var i = d.pages.length - 1; i >= 0; i--) {
    if (this.meetsConditions(d.pages[i])) { this._pageIndex = i; break; }
  }
  window.__eventRefreshes = (window.__eventRefreshes || 0) + 1;
};
Game_Event.prototype.meetsConditions = function (page) {
  var c = page.conditions;
  if (c.switch1Valid && !$gameSwitches.value(c.switch1Id)) return false;
  if (c.switch2Valid && !$gameSwitches.value(c.switch2Id)) return false;
  if (c.variableValid && !($gameVariables.value(c.variableId) >= c.variableValue)) return false;
  if (c.selfSwitchValid) {
    if (!$gameSelfSwitches.value([$gameMap.mapId(), this._eventId, c.selfSwitchCh])) return false;
  }
  return true;
};
Game_Event.prototype.scrolledX = function () { return $gameMap.adjustX(this._x); };
Game_Event.prototype.scrolledY = function () { return $gameMap.adjustY(this._y); };
/* shiftY is 6 for anything that is not an object character. The overlay must
   NOT build its tile rectangle from screenY(), so this has to be the real
   value or the geometry test proves nothing. */
Game_Event.prototype.isObjectCharacter = function () { return !!this._isObjectCharacter; };
Game_Event.prototype.shiftY = function () { return this.isObjectCharacter() ? 0 : 6; };
Game_Event.prototype.jumpHeight = function () { return 0; };
Game_Event.prototype.screenX = function () { var tw = $gameMap.tileWidth(); return Math.floor(this.scrolledX() * tw + tw / 2); };
Game_Event.prototype.screenY = function () { var th = $gameMap.tileHeight(); return Math.floor(this.scrolledY() * th + th - this.shiftY() - this.jumpHeight()); };
Object.defineProperties(Game_Event.prototype, {
  x: { get: function () { return this._x; } }, y: { get: function () { return this._y; } }
});

/* Game_Item — an equip slot holds a {_dataClass,_itemId} pair, not the data
   object. Modelling it as the raw object hides anything that reads a slot BY
   ID, which is what the Forge's scrub does when a save outlives its
   definitions. MV rpg_objects.js:1170 / MZ rmmz_objects.js:1323. */
function Game_Item(item) { this._dataClass = ''; this._itemId = 0; if (item) this.setObject(item); }
Game_Item.prototype.isSkill = function () { return this._dataClass === 'skill'; };
Game_Item.prototype.isItem = function () { return this._dataClass === 'item'; };
Game_Item.prototype.isWeapon = function () { return this._dataClass === 'weapon'; };
Game_Item.prototype.isArmor = function () { return this._dataClass === 'armor'; };
Game_Item.prototype.object = function () {
  if (this.isSkill()) return $dataSkills[this._itemId];
  if (this.isItem()) return $dataItems[this._itemId];
  if (this.isWeapon()) return $dataWeapons[this._itemId];
  if (this.isArmor()) return $dataArmors[this._itemId];
  return null;
};
Game_Item.prototype.setObject = function (item) {
  if (DataManager.isSkill(item)) this._dataClass = 'skill';
  else if (DataManager.isItem(item)) this._dataClass = 'item';
  else if (DataManager.isWeapon(item)) this._dataClass = 'weapon';
  else if (DataManager.isArmor(item)) this._dataClass = 'armor';
  else this._dataClass = '';
  this._itemId = item ? item.id : 0;
};

/* Game_BattlerBase — the funnels god mode hooks. paramMax/paramMin/param are
   the three that differ between engines and live in engine-*.js. */
function Game_BattlerBase() { }
Game_BattlerBase.prototype.setHp = function (hp) { this._hp = hp; this.refresh(); };
Game_BattlerBase.prototype.setMp = function (mp) { this._mp = mp; this.refresh(); };
Game_BattlerBase.prototype.die = function () { this._hp = 0; this._states = []; };
Game_BattlerBase.prototype.revive = function () { if (this._hp === 0) this._hp = 1; };
Game_BattlerBase.prototype.refresh = function () {
  this._hp = Math.max(0, Math.min(this._hp, this.mhp));
  this._mp = Math.max(0, Math.min(this._mp, this.mmp));
};
Game_BattlerBase.prototype.recoverAll = function () { this._states = []; this._hp = this.mhp; this._mp = this.mmp; };
Game_BattlerBase.prototype.skillMpCost = function (s) { return (s && s.mpCost) || 0; };
Game_BattlerBase.prototype.skillTpCost = function (s) { return (s && s.tpCost) || 0; };
Game_BattlerBase.prototype.canPaySkillCost = function (s) {
  return this._tp >= this.skillTpCost(s) && this._mp >= this.skillMpCost(s);
};
Game_BattlerBase.prototype.paySkillCost = function (s) { this._mp -= this.skillMpCost(s); this._tp -= this.skillTpCost(s); };
Game_BattlerBase.prototype.addNewState = function (id) {
  if (id === this.deathStateId()) this.die();
  if (this._states.indexOf(id) === -1) this._states.push(id);
};
Game_BattlerBase.prototype.paramRate = function () { return window.__paramRate || 1; };
Game_BattlerBase.prototype.paramBuffRate = function () { return 1; };
Game_BattlerBase.prototype.addParam = function (id, v) { this._paramPlus[id] += v; this.refresh(); };
Game_BattlerBase.prototype.clearParamPlus = function () { this._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0]; };

function Game_Actor(id) {
  this._actorId = id; this._classId = $dataActors[id].classId; this._level = 10;
  /* Game_Actor.setup COPIES the identity fields onto the instance and saves
     them with it. name() reads the copy, not the database; a stub that read
     $dataActors would make setName look like a no-op that still passed. */
  var db = $dataActors[id];
  this._name = db.name; this._nickname = db.nickname || ''; this._profile = db.profile || '';
  this._faceName = db.faceName || ''; this._faceIndex = db.faceIndex || 0;
  this._characterName = db.characterName || ''; this._characterIndex = db.characterIndex || 0;
  this._battlerName = db.battlerName || '';
  this._exp = {}; this._exp[this._classId] = 0;
  this._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0]; this._skills = [1, 2, 3]; this._states = []; this._stateTurns = {};
  this._equips = [new Game_Item(), new Game_Item(), new Game_Item(), new Game_Item(), new Game_Item()];
  this._hp = 200; this._mp = 50; this._tp = 0;
}
Game_Actor.prototype.actorId = function () { return this._actorId; };
Game_Actor.prototype.actor = function () { return $dataActors[this._actorId]; };
Game_Actor.prototype.name = function () { return this._name; };
Game_Actor.prototype.setName = function (n) { this._name = n; };
Game_Actor.prototype.nickname = function () { return this._nickname; };
Game_Actor.prototype.setNickname = function (n) { this._nickname = n; };
Game_Actor.prototype.profile = function () { return this._profile; };
Game_Actor.prototype.setProfile = function (p) { this._profile = p; };
Game_Actor.prototype.setFaceImage = function (name, index) {
  this._faceName = name; this._faceIndex = index;
  if (typeof $gameTemp !== 'undefined' && $gameTemp && $gameTemp.requestBattleRefresh) $gameTemp.requestBattleRefresh();
};
Game_Actor.prototype.setCharacterImage = function (name, index) { this._characterName = name; this._characterIndex = index; };
Game_Actor.prototype.setBattlerImage = function (name) { this._battlerName = name; };
Game_Actor.prototype.currentClass = function () { return $dataClasses[this._classId]; };
/* paramBase is `currentClass().params[paramId][this._level]` on both engines,
   both WITHOUT a bounds guard — which is what the Forge's level warnings are
   about. MV rpg_objects.js:3843 / MZ rmmz_objects.js:4480. */
Game_Actor.prototype.paramBase = function (id) { return this.currentClass().params[id][this._level]; };
Game_Actor.prototype.paramPlus = function (id) {
  var v = this._paramPlus[id];
  this.equips().forEach(function (e) { if (e && e.params) v += e.params[id] || 0; });
  return v + (window.__pluginParamBonus || 0);
};
Game_Actor.prototype.refresh = function () { window.__refreshCount = (window.__refreshCount || 0) + 1; };
Game_Actor.prototype.equips = function () { return this._equips.map(function (it) { return it.object(); }); };
Game_Actor.prototype.equipSlots = function () { return [1, 2, 3, 4, 5]; };
Game_Actor.prototype.forceChangeEquip = function (slot, item) { this._equips[slot].setObject(item); this.refresh(); };
Game_Actor.prototype.isLearnedSkill = function (id) { return this._skills.indexOf(id) > -1; };
Game_Actor.prototype.learnSkill = function (id) {
  if (!this.isLearnedSkill(id)) { this._skills.push(id); this._skills.sort(function (a, b) { return a - b; }); }
};
Game_Actor.prototype.forgetSkill = function (id) { var i = this._skills.indexOf(id); if (i > -1) this._skills.splice(i, 1); };
Game_Actor.prototype.skills = function () { var self = this; return this._skills.map(function (i) { return $dataSkills[i]; }); };
Game_Actor.prototype.states = function () { return this._states.map(function (i) { return $dataStates[i]; }); };
Game_Actor.prototype.isStateAffected = function (id) { return this._states.indexOf(id) > -1; };
Game_Actor.prototype.addState = function (id) {
  if (id === window.__unaddableState) return;
  if (!this.isStateAffected(id)) this._states.push(id);
  this.refresh();
};
Game_Actor.prototype.removeState = function (id) { var i = this._states.indexOf(id); if (i > -1) this._states.splice(i, 1); this.refresh(); };
Game_Actor.prototype.clearStates = function () { this._states = []; this.refresh(); };
Game_Actor.prototype.deathStateId = function () { return 1; };
Game_Actor.prototype.stateRate = function () { return 1; };
Game_Actor.prototype.setMp = function (v) { this._mp = v; this.refresh(); };
Game_Actor.prototype.setTp = function (v) { this._tp = v; this.refresh(); };
Game_Actor.prototype.maxTp = function () { return 100; };
/* From the actor's own row, not a constant: both engines read
   this.actor().maxLevel (MV :3554 / MZ :4196), and a project that caps one
   actor lower is the case a level restore has to clamp against. */
Game_Actor.prototype.maxLevel = function () {
  var row = this.actor();
  return (row && row.maxLevel) || 99;
};
Game_Actor.prototype.isMaxLevel = function () { return this._level >= 99; };
Game_Actor.prototype.currentExp = function () { return this._exp[this._classId] || 0; };
Game_Actor.prototype.nextLevelExp = function () { return (this._level + 1) * 100; };
Game_Actor.prototype.expForLevel = function (l) { return l * 100; };
Game_Actor.prototype.changeExp = function (exp) { this._exp[this._classId] = Math.max(0, exp); this.refresh(); };
Game_Actor.prototype.changeLevel = function (l) {
  this._level = Math.max(1, Math.min(99, l)); this._exp[this._classId] = this._level * 100; this.refresh();
};
Game_Actor.prototype.changeClass = function (c) { this._classId = c; this.refresh(); };
Game_Actor.prototype.isActor = function () { return true; };
Game_Actor.prototype.isEnemy = function () { return false; };
Game_Actor.prototype.isHidden = function () { return !!this._hidden; };
Game_Actor.prototype.isAppeared = function () { return !this.isHidden(); };
Game_Actor.prototype.isDeathStateAffected = function () { return this._hp <= 0; };
Game_Actor.prototype.isAlive = function () { return this.isAppeared() && !this.isDeathStateAffected(); };
Game_Actor.prototype.isDead = function () { return this.isAppeared() && this.isDeathStateAffected(); };
Object.defineProperties(Game_Actor.prototype, {
  level: { get: function () { return this._level; } },
  hp: { get: function () { return this._hp; } },
  mp: { get: function () { return this._mp; } },
  tp: { get: function () { return this._tp; } },
  mhp: { get: function () { return this.param(0); } },
  mmp: { get: function () { return this.param(1); } }
});

function Game_Actors() { this._data = []; }
Game_Actors.prototype.actor = function (id) {
  if (!$dataActors[id]) return null;
  if (!this._data[id]) this._data[id] = new Game_Actor(id);
  return this._data[id];
};

function Game_Party() {
  this._actors = [1, 2, 3];
  this._items = {}; this._weapons = {}; this._armors = {};
  this._gold = 4820;
}
Game_Party.prototype.inBattle = function () { return !!window.__inBattle; };
Game_Party.prototype.hasEncounterNone = function () { return !!window.__encounterNone; };
Game_Party.prototype.allMembers = function () { return this._actors.map(function (i) { return $gameActors.actor(i); }); };
Game_Party.prototype.leader = function () { return this.allMembers()[0] || null; };
Game_Party.prototype.members = function () { return this.allMembers(); };
Game_Party.prototype.gold = function () { return this._gold; };
/* STOCK maxGold is 99999999 on both engines (MV rpg_objects.js:4935 /
   MZ rmmz_objects.js:5590). A framework that overwrites it without aliasing
   is modelled in plugins-mv.js, not here. */
Game_Party.prototype.maxGold = function () { return 99999999; };
Game_Party.prototype.gainGold = function (n) { this._gold = Math.max(0, Math.min(this.maxGold(), this._gold + n)); };
/* loseGold delegates to gainGold on both engines. Hooked separately anyway:
   a plugin that replaced one and not the other would slip past. */
Game_Party.prototype.loseGold = function (amount) { this.gainGold(-amount); };
/* STOCK maxItems is 99 on both (MV :4964 / MZ :5619). */
Game_Party.prototype.maxItems = function () { return 99; };
Game_Party.prototype.itemContainer = function (it) {
  if (!it) return null;
  if (DataManager.isItem(it)) return this._items;
  if (DataManager.isWeapon(it)) return this._weapons;
  if (DataManager.isArmor(it)) return this._armors;
  return null;
};
/* These map ids straight through $data* with NO guard, which is why a save
   holding a custom id with no definition takes the game down. A harness that
   filtered nulls here would make the Forge's tombstones look unnecessary.
   MV rpg_objects.js:4886 / MZ rmmz_objects.js:5478. */
Game_Party.prototype.items = function () { return Object.keys(this._items).map(function (id) { return $dataItems[id]; }); };
Game_Party.prototype.weapons = function () { return Object.keys(this._weapons).map(function (id) { return $dataWeapons[id]; }); };
Game_Party.prototype.armors = function () { return Object.keys(this._armors).map(function (id) { return $dataArmors[id]; }); };
Game_Party.prototype.allItems = function () { return this.items().concat(this.weapons()).concat(this.armors()); };
Game_Party.prototype.numItems = function (it) { var c = this.itemContainer(it); return c ? (c[it.id] || 0) : 0; };
Game_Party.prototype.gainItem = function (it, n) {
  var c = this.itemContainer(it); if (!c) return;
  var v = (c[it.id] || 0) + n;
  c[it.id] = Math.max(0, Math.min(this.maxItems(it), v));
  if (c[it.id] === 0) delete c[it.id];
};
Game_Party.prototype.addActor = function (id) { if (this._actors.indexOf(id) === -1) this._actors.push(id); };
Game_Party.prototype.removeActor = function (id) { var i = this._actors.indexOf(id); if (i > -1) this._actors.splice(i, 1); };
Game_Party.prototype.hasDropItemDouble = function () { return !!window.__dropDouble; };
Game_Party.prototype.isAllDead = function () { return this.members().every(function (a) { return a.isDead(); }); };
Game_Party.prototype.allBattleMembers = function () { return this.allMembers(); };
Game_Party.prototype.battleMembers = function () { return this.allMembers(); };

var TextManager = { param: function (id) { return $dataSystem.terms.params[id] || ('p' + id); } };

/* ConfigManager. alwaysDash exists on BOTH engines; instantText and skipUnseen
   exist on NEITHER — they are third-party plugin fields, which the mod probes
   for. Adding them to the stock stub would make an absent capability look
   present on every game. */
var ConfigManager = {
  alwaysDash: true, saves: 0,
  save: function () { this.saves++; window.__configSaves = (window.__configSaves || 0) + 1; }
};

/* Game_Message. A real CONSTRUCTOR, not an object literal, because
   DataManager.createGameObjects rebuilds every $game* global by calling its
   constructor — a literal would be replaced by null on the first load, and
   every capability that probes $gameMessage would then read as absent for a
   reason that has nothing to do with the engine.
   setSpeakerName is MZ-only (engine-mz.js); everything below is identical
   (MV rpg_objects.js:421-495 / MZ rmmz_objects.js:572-650). */
function Game_Message() {
  this._texts = []; this._speakerName = '';
  this._faceName = ''; this._faceIndex = 0; this._background = 0; this._positionType = 2;
}
Game_Message.prototype.isBusy = function () { return !!window.__msgBusy; };
Game_Message.prototype.isChoice = function () { return !!window.__msgChoice; };
Game_Message.prototype.isNumberInput = function () { return !!window.__msgNumber; };
Game_Message.prototype.isItemChoice = function () { return !!window.__msgItem; };
/* add() is per LINE. One call with newlines gives the window a single line it
   then clips, not the four it is sized for. */
Game_Message.prototype.add = function (text) { this._texts.push(text); };
Game_Message.prototype.hasText = function () { return this._texts.length > 0; };
Game_Message.prototype.clear = function () { this._texts = []; this._speakerName = ''; };
Game_Message.prototype.setFaceImage = function (n, i) { this._faceName = n; this._faceIndex = i; };
Game_Message.prototype.setBackground = function (n) { this._background = n; };
Game_Message.prototype.setPositionType = function (n) { this._positionType = n; };
/* allText joins with a newline and appends one — verbatim, trailing newline
   included, because a recorder that splits on \n sees an empty last line and a
   stub that trimmed would hide that. MV rpg_objects.js:466 / MZ :621. */
Game_Message.prototype.allText = function () {
  return this._texts.reduce(function (r, text) { return r + text + '\n'; }, '');
};
Game_Message.prototype.faceName = function () { return this._faceName || ''; };
Game_Message.prototype.setChoices = function (choices, defaultType, cancelType) {
  this._choices = choices; this._choiceDefaultType = defaultType; this._choiceCancelType = cancelType;
};
Game_Message.prototype.setChoiceCallback = function (cb) { this._choiceCallback = cb; };
/* onChoice fires for a cancel too, with the cancel type as the index — which
   is why the recorder cannot assume the index is inside the list. */
Game_Message.prototype.onChoice = function (n) {
  if (this._choiceCallback) { this._choiceCallback(n); this._choiceCallback = null; }
  window.__lastChoice = n;
};
/* The other two prompts, identical on both engines. onItemChoice is handed 0
   for a cancel, which is why an id is never indexed without a test. */
Game_Message.prototype.setNumberInput = function (variableId, maxDigits) {
  this._numInputVariableId = variableId; this._numInputMaxDigits = maxDigits;
};
Game_Message.prototype.onNumberInput = function (n) {
  if (this._numberInputCallback) { this._numberInputCallback(n); this._numberInputCallback = null; }
  window.__lastNumber = n;
};
Game_Message.prototype.setItemChoice = function (variableId, itemType) {
  this._itemChoiceVariableId = variableId; this._itemChoiceItypeId = itemType;
};
Game_Message.prototype.onItemChoice = function (id) {
  if (this._itemChoiceCallback) { this._itemChoiceCallback(id); this._itemChoiceCallback = null; }
  window.__lastItem = id;
};
var $gameMessage = new Game_Message();

/* Game_Timer — present on both engines and in the createGameObjects list. */
function Game_Timer() { this._frames = 0; this._working = false; }
Game_Timer.prototype.update = function () { if (this._working && this._frames > 0) this._frames--; };
Game_Timer.prototype.seconds = function () { return Math.floor(this._frames / 60); };
Game_Timer.prototype.start = function (count) { this._frames = count; this._working = true; };
Game_Timer.prototype.stop = function () { this._working = false; };
Game_Timer.prototype.isWorking = function () { return this._working; };

/* Window_Message. updateInput only consults isTriggered while `pause` is
   true, which is why that is the seam auto-advance and turbo use — it never
   touches the input system or the choice windows. MV rpg_windows.js:4561 /
   MZ rmmz_windows.js:5173 for startPause; the other three at
   MV :4361/:4472/:4457 and MZ :4915/:5067/:5044. */
function Window_Message() { this.pause = false; this._showFast = false; this._textState = null; }
/* startMessage is the seam the history recorder listens on: it is the one point
   on both engines where the page has been assembled out of $gameMessage and has
   not yet been drawn. MV rpg_windows.js:4361 / MZ rmmz_windows.js:4915. The two
   differ in how they build the text state and not at all in what they read. */
Window_Message.prototype.startMessage = function () {
  this._textState = { index: 0, text: this.convertEscapeCharacters($gameMessage.allText()) };
  window.__messagesStarted = (window.__messagesStarted || 0) + 1;
};
Window_Message.prototype.terminateMessage = function () {
  this.close();
  $gameMessage.clear();
};
Window_Message.prototype.close = function () { this._closing = true; };
Window_Message.prototype.startWait = function (n) { this._waitCount = n; };
Window_Message.prototype.startPause = function () {
  this.startWait(10); this.pause = true;
  window.__pauses = (window.__pauses || 0) + 1;
};
Window_Message.prototype.updateShowFast = function () { };
Window_Message.prototype.isTriggered = function () { return !!window.__okPressed; };
Window_Message.prototype.updateWait = function () {
  if (this._waitCount > 0) { this._waitCount--; return true; }
  return false;
};
Window_Message.prototype.updateInput = function () {
  if (this.pause) {
    if (this.isTriggered()) { this.pause = false; window.__advanced = (window.__advanced || 0) + 1; }
    return true;
  }
  return false;
};

/* Window_ScrollText. Present on both engines and, like Window_Message, it reads
   the page straight off $gameMessage. MV rpg_windows.js:4700 / MZ :5300. */
function Window_ScrollText() { this._text = ''; }
Window_ScrollText.prototype.startMessage = function () {
  this._text = $gameMessage.allText();
  window.__scrollsStarted = (window.__scrollsStarted || 0) + 1;
};

/* convertEscapeCharacters, on Window_Base and inherited by both message
   windows. Only the parts that matter to anything reading the result back are
   modelled — the backslash becomes ESC and \V[n] is substituted from the LIVE
   variable — because the whole reason a recorder must read the window's own
   output is that this substitution happens exactly once and cannot be redone
   later. On the engines it is Window_Base.prototype.convertEscapeCharacters —
   MV rpg_windows.js:1114 / MZ rmmz_windows.js:1345. */
function convertEscapeCharacters(text) {
  text = String(text == null ? '' : text).replace(/\\/g, '\x1b');
  text = text.replace(/\x1b\x1b/g, '\\');
  text = text.replace(/\x1bV\[(\d+)\]/gi, function (_, n) {
    return $gameVariables.value(parseInt(n, 10));
  });
  return text;
}
/* On the real engines this lives on Window_Base and both windows inherit it;
   the stub windows do not share a base, so both are given it directly. */
Window_Message.prototype.convertEscapeCharacters = convertEscapeCharacters;
Window_ScrollText.prototype.convertEscapeCharacters = convertEscapeCharacters;

/* Game_Screen — written from the engine, awkward parts included: startTint
   calls tone.clone() (the engine's own Array extension) and sets a TARGET
   that update() walks toward. A stub that applied instantly would hide the
   stutter the hold code avoids. Identical on both engines. */
function Game_Screen() { this.clear(); }
Game_Screen.prototype.clear = function () {
  this.clearFade(); this.clearTone(); this.clearFlash();
  this.clearShake(); this.clearZoom(); this.clearWeather();
};
Game_Screen.prototype.clearFade = function () { this._brightness = 255; this._fadeOutDuration = 0; this._fadeInDuration = 0; };
Game_Screen.prototype.clearTone = function () { this._tone = [0, 0, 0, 0]; this._toneTarget = [0, 0, 0, 0]; this._toneDuration = 0; };
Game_Screen.prototype.clearFlash = function () { this._flashColor = [0, 0, 0, 0]; this._flashDuration = 0; };
Game_Screen.prototype.clearShake = function () {
  this._shakePower = 0; this._shakeSpeed = 0; this._shakeDuration = 0; this._shakeDirection = 1; this._shake = 0;
};
Game_Screen.prototype.clearZoom = function () {
  this._zoomX = 0; this._zoomY = 0; this._zoomScale = 1; this._zoomScaleTarget = 1; this._zoomDuration = 0;
};
Game_Screen.prototype.clearWeather = function () {
  this._weatherType = 'none'; this._weatherPower = 0; this._weatherPowerTarget = 0; this._weatherDuration = 0;
};
Game_Screen.prototype.brightness = function () { return this._brightness; };
Game_Screen.prototype.tone = function () { return this._tone; };
Game_Screen.prototype.shake = function () { return this._shake; };
Game_Screen.prototype.zoomScale = function () { return this._zoomScale; };
Game_Screen.prototype.zoomX = function () { return this._zoomX; };
Game_Screen.prototype.zoomY = function () { return this._zoomY; };
Game_Screen.prototype.weatherType = function () { return this._weatherType; };
Game_Screen.prototype.weatherPower = function () { return this._weatherPower; };
Game_Screen.prototype.startTint = function (tone, duration) {
  this._toneTarget = tone.clone();
  this._toneDuration = duration;
  if (this._toneDuration === 0) this._tone = this._toneTarget.clone();
};
Game_Screen.prototype.startFlash = function (color, duration) { this._flashColor = color.clone(); this._flashDuration = duration; };
Game_Screen.prototype.startShake = function (power, speed, duration) {
  this._shakePower = power; this._shakeSpeed = speed; this._shakeDuration = duration;
};
Game_Screen.prototype.startZoom = function (x, y, scale, duration) {
  this._zoomX = x; this._zoomY = y; this._zoomScaleTarget = scale; this._zoomDuration = duration;
};
Game_Screen.prototype.setZoom = function (x, y, scale) { this._zoomX = x; this._zoomY = y; this._zoomScale = scale; };
Game_Screen.prototype.changeWeather = function (type, power, duration) {
  if (type !== 'none' || duration === 0) this._weatherType = type;
  this._weatherPowerTarget = type === 'none' ? 0 : power;
  this._weatherDuration = duration;
  if (duration === 0) this._weatherPower = this._weatherPowerTarget;
};
Game_Screen.prototype.update = function () {
  window.__screenUpdates = (window.__screenUpdates || 0) + 1;
  this.updateTone(); this.updateFlash(); this.updateShake(); this.updateZoom(); this.updateWeather();
};
Game_Screen.prototype.updateTone = function () {
  if (this._toneDuration > 0) {
    var d = this._toneDuration;
    for (var i = 0; i < 4; i++) this._tone[i] = (this._tone[i] * (d - 1) + this._toneTarget[i]) / d;
    this._toneDuration--;
  }
};
Game_Screen.prototype.updateFlash = function () {
  if (this._flashDuration > 0) { var d = this._flashDuration; this._flashColor[3] *= (d - 1) / d; this._flashDuration--; }
};
Game_Screen.prototype.updateShake = function () {
  if (this._shakeDuration > 0 || this._shake !== 0) {
    this._shake = this._shakeDuration > 0 ? this._shakePower : 0;
    if (this._shakeDuration > 0) this._shakeDuration--; else this._shake = 0;
  }
};
Game_Screen.prototype.updateZoom = function () {
  if (this._zoomDuration > 0) {
    var d = this._zoomDuration;
    this._zoomScale = (this._zoomScale * (d - 1) + this._zoomScaleTarget) / d;
    this._zoomDuration--;
  }
};
Game_Screen.prototype.updateWeather = function () {
  if (this._weatherDuration > 0) {
    var d = this._weatherDuration;
    this._weatherPower = (this._weatherPower * (d - 1) + this._weatherPowerTarget) / d;
    this._weatherDuration--;
    if (this._weatherDuration === 0 && this._weatherPowerTarget === 0) this._weatherType = 'none';
  }
};

/* Battle. Every member the mod touches exists on both engines with the same
   signature (MV rpg_managers.js:2144-2638 / MZ rmmz_managers.js:2276-2921).
   _phase's sentinel differs ('init'/null on MV, "" on MZ) and both are falsy,
   which is what the mod's `if (!BattleManager._phase) return;` relies on. */
function Game_Enemy(enemyId) {
  this._enemyId = enemyId; this._letter = ''; this._plural = false; this._states = [];
  this._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];
  this._hp = this.mhp; this._mp = this.mmp; this._tp = 0;
}
Game_Enemy.prototype.isActor = function () { return false; };
Game_Enemy.prototype.isEnemy = function () { return true; };
Game_Enemy.prototype.enemyId = function () { return this._enemyId; };
Game_Enemy.prototype.enemy = function () { return $dataEnemies[this._enemyId]; };
Game_Enemy.prototype.index = function () { return $gameTroop.members().indexOf(this); };
Game_Enemy.prototype.originalName = function () { return this.enemy().name; };
Game_Enemy.prototype.name = function () { return this.originalName() + (this._plural ? this._letter : ''); };
Game_Enemy.prototype.paramBase = function (id) { return this.enemy().params[id]; };
Game_Enemy.prototype.paramPlus = function (id) { return this._paramPlus[id]; };
Game_Enemy.prototype.refresh = function () { window.__enemyRefresh = (window.__enemyRefresh || 0) + 1; };
Game_Enemy.prototype.exp = function () { return this.enemy().exp; };
Game_Enemy.prototype.gold = function () { return this.enemy().gold; };
Game_Enemy.prototype.states = function () { return this._states.map(function (i) { return $dataStates[i]; }); };
Game_Enemy.prototype.isStateAffected = function (id) { return this._states.indexOf(id) > -1; };
Game_Enemy.prototype.addState = function (id) { if (!this.isStateAffected(id)) this._states.push(id); this.refresh(); };
Game_Enemy.prototype.removeState = function (id) { var i = this._states.indexOf(id); if (i > -1) this._states.splice(i, 1); };
/* isDead/isAlive both gate on isAppeared, so a hidden enemy is NEITHER. */
Game_Enemy.prototype.isHidden = function () { return !!this._hidden; };
Game_Enemy.prototype.isAppeared = function () { return !this.isHidden(); };
Game_Enemy.prototype.isDeathStateAffected = function () { return this._hp <= 0; };
Game_Enemy.prototype.isAlive = function () { return this.isAppeared() && !this.isDeathStateAffected(); };
Game_Enemy.prototype.isDead = function () { return this.isAppeared() && this.isDeathStateAffected(); };
Game_Enemy.prototype.deathStateId = function () { return 1; };
Game_Enemy.prototype.traitsPi = function (code, dataId) {
  return (this.enemy().traits || []).filter(function (t) { return t.code === code && t.dataId === dataId; })
    .reduce(function (r, t) { return r * t.value; }, 1);
};
Game_Enemy.prototype.elementRate = function (id) { return this.traitsPi(11, id); };
Game_Enemy.prototype.stateRate = function (id) { return this.traitsPi(13, id); };
Game_Enemy.prototype.stateResistSet = function () {
  return (this.enemy().traits || []).filter(function (t) { return t.code === 14; }).map(function (t) { return t.dataId; });
};
Game_Enemy.prototype.isStateResist = function (id) { return this.stateResistSet().indexOf(id) > -1; };
Game_Enemy.prototype.dropItemRate = function () { return $gameParty.hasDropItemDouble() ? 2 : 1; };
Game_Enemy.prototype.itemObject = function (kind, dataId) {
  return kind === 1 ? $dataItems[dataId] : kind === 2 ? $dataWeapons[dataId] : kind === 3 ? $dataArmors[dataId] : null;
};
Game_Enemy.prototype.performCollapse = function () { window.__collapses = (window.__collapses || 0) + 1; };
Game_Enemy.prototype.screenX = function () { return 300 + this.index() * 200; };
Game_Enemy.prototype.screenY = function () { return 400; };
Object.defineProperties(Game_Enemy.prototype, {
  hp: { get: function () { return this._hp; }, configurable: true },
  mp: { get: function () { return this._mp; }, configurable: true },
  tp: { get: function () { return this._tp; }, configurable: true },
  mhp: { get: function () { return this.enemy().params[0]; }, configurable: true },
  mmp: { get: function () { return this.enemy().params[1]; }, configurable: true }
});

/* The real prototype CHAIN, not copies: patching setHp on the base must reach
   actors and enemies. Copying the methods onto each subclass would leave the
   hooks patching an object nobody calls. */
Object.setPrototypeOf(Game_Enemy.prototype, Game_BattlerBase.prototype);
Object.setPrototypeOf(Game_Actor.prototype, Game_BattlerBase.prototype);
/* Game_Battler.refresh: hp 0 becomes the death state, which routes to die(). */
Game_Enemy.prototype.refresh = function () {
  Game_BattlerBase.prototype.refresh.call(this);
  if (this._hp === 0) this.addNewState(this.deathStateId());
  else { var i = this._states.indexOf(this.deathStateId()); if (i > -1) this._states.splice(i, 1); }
};
/* releaseUnequippableItems FIRST — it is the literal first line on both engines
   (MV rpg_objects.js:3755 / MZ rmmz_objects.js:4393) and it is the entire
   mechanism behind "a class change silently strips gear the new class cannot
   hold and trades it back into the party". A refresh that skipped it left the
   actor wearing equipment the engine would have taken off, so the one thing a
   loadout has to warn about could not happen in the harness. */
Game_Actor.prototype.refresh = function () {
  if (typeof this.releaseUnequippableItems === 'function') this.releaseUnequippableItems(false);
  Game_BattlerBase.prototype.refresh.call(this);
  window.__refreshCount = (window.__refreshCount || 0) + 1;
  if (this._hp === 0) this.addNewState(this.deathStateId());
  else { var i = this._states.indexOf(this.deathStateId()); if (i > -1) this._states.splice(i, 1); }
};

/* makeDamageValue is where an action's number comes from, and its SIGN is
   what separates damage from recovery. executeDamage is not the same place:
   HP costs and drains land there too. MV :1668 / MZ :1937. */
function Game_Action(subject) { this._subject = subject; this._item = null; }
Game_Action.prototype.subject = function () { return this._subject; };
Game_Action.prototype.setSkill = function (id) { this._item = { id: id }; };
Game_Action.prototype.makeDamageValue = function () { return window.__rawDamage == null ? 100 : window.__rawDamage; };

function Game_Troop() { this._enemies = []; this._troopId = 0; }
Game_Troop.prototype.members = function () { return this._enemies; };
Game_Troop.prototype.aliveMembers = function () { return this._enemies.filter(function (e) { return e.isAlive(); }); };
Game_Troop.prototype.isAllDead = function () { return this.aliveMembers().length === 0; };
Game_Troop.prototype.troop = function () { return $dataTroops[this._troopId]; };
Game_Troop.prototype.setup = function (troopId) {
  this._troopId = troopId; this._enemies = [];
  var self = this;
  this.troop().members.forEach(function (m) {
    if ($dataEnemies[m.enemyId]) self._enemies.push(new Game_Enemy(m.enemyId));
  });
};

var BattleManager = {
  _phase: '', _canEscape: false, _canLose: false,
  setup: function (troopId, canEscape, canLose) {
    this._phase = 'start'; this._canEscape = canEscape; this._canLose = canLose;
    $gameTroop.setup(troopId);
    window.__battleSetup = { troopId: troopId, canEscape: canEscape, canLose: canLose };
  },
  processVictory: function () { window.__victories = (window.__victories || 0) + 1; },
  processDefeat: function () { window.__defeats = (window.__defeats || 0) + 1; },
  processAbort: function () { window.__aborts = (window.__aborts || 0) + 1; },
  forceAction: function (b) { window.__forced = (window.__forced || 0) + 1; window.__forcedOn = b; },
  invokeAction: function () { window.__invoked = (window.__invoked || 0) + 1; },
  checkBattleEnd: function () {
    if (!this._phase) return false;
    if ($gameParty.isAllDead()) { this.processDefeat(); return true; }
    if ($gameTroop.isAllDead()) { this.processVictory(); return true; }
    return false;
  }
};

/* Spriteset. The overlay lands in a different z-position on the two engines
   (MV appends after _flashSprite/_fadeSprite children; MZ's upper layer adds
   no children at all) — see MV-MZ-DELTA.md §C.16. The child list is per
   engine; the two aliased seams are shared. */
function Spriteset_Base() { }
Spriteset_Base.prototype.createUpperLayer = function () { window.__upperLayers = (window.__upperLayers || 0) + 1; };
Spriteset_Base.prototype.update = function () { };
function Spriteset_Map() { this.children = []; }
Spriteset_Map.prototype = Object.create(Spriteset_Base.prototype);
Spriteset_Map.prototype.constructor = Spriteset_Map;
Spriteset_Map.prototype.addChild = function (c) { this.children.push(c); c.parent = this; return c; };
Spriteset_Map.prototype.addChildAt = function (c, i) { this.children.splice(i, 0, c); c.parent = this; return c; };
Spriteset_Map.prototype.update = function () {
  Spriteset_Base.prototype.update.call(this);
  window.__spritesetUpdates = (window.__spritesetUpdates || 0) + 1;
};

/* Sprite_Battler's anchor is (0.5, 1): x is the horizontal CENTRE and y is
   the FEET, so the top of the graphic is y - height. Getting the anchor wrong
   is exactly the mistake this models. */
function Sprite_Enemy(enemy) {
  this._enemy = enemy; this._battler = enemy; this.visible = true; this.children = [];
  this._homeX = enemy ? enemy.screenX() : 0; this._homeY = enemy ? enemy.screenY() : 0;
  this.x = this._homeX; this.y = this._homeY;
  this.width = 120; this.height = 160;
}
function Spriteset_Battle() { this.children = []; }
Spriteset_Battle.prototype.addChild = function (c) { this.children.push(c); c.parent = this; return c; };
Spriteset_Battle.prototype.createLowerLayer = function () {
  this._battleField = { children: [], addChild: function (c) { this.children.push(c); return c; } };
  this._enemySprites = $gameTroop.members().map(function (e) { return new Sprite_Enemy(e); });
  window.__battleLowerLayers = (window.__battleLowerLayers || 0) + 1;
};
Spriteset_Battle.prototype.update = function () {
  window.__battleSpritesetUpdates = (window.__battleSpritesetUpdates || 0) + 1;
};

/* ImageManager. A real IconSet, because the overlay pulls the sheet through
   ImageManager (it is encrypted on disk, so CSS cannot reference it), converts
   it once with toDataURL and injects one background rule. With `{}` that whole
   path is dead and every icon in every screenshot is a grey placeholder.
   iconWidth/iconHeight are MZ-only getters (engine-mz.js); MV's constants live
   on Window_Base (engine-mv.js). */
var ImageManager = {
  _iconSet: null,
  _cleared: 0,
  loadSystem: function (name) {
    if (name !== 'IconSet') return null;
    if (!this._iconSet) {
      var cv = document.createElement('canvas');
      cv.width = 512; cv.height = 800;
      var ctx = cv.getContext('2d');
      for (var y = 0; y < 25; y++) for (var x = 0; x < 16; x++) {
        ctx.fillStyle = 'hsl(' + ((x * 23 + y * 31) % 360) + ' 55% 45%)';
        ctx.fillRect(x * 32 + 3, y * 32 + 3, 26, 26);
      }
      this._iconSet = { width: 512, height: 800, canvas: cv, _destroyed: false, isReady: function () { return !this._destroyed; } };
    }
    return this._iconSet;
  },
  clear: function () { this._cleared++; },
  update: function () { }
};
/* Declared AFTER ImageManager itself: an assignment placed above the `var`
   sees the hoisted `undefined` and is silently skipped — the hoisting bug the
   1.x harness documents at harness-1x.html:509-513, and one of the reasons
   this file is split out and its load order made explicit. */
ImageManager.loadCharacter = function (name) {
  var c = document.createElement('canvas');
  c.width = 576; c.height = 384;
  var g = c.getContext('2d');
  g.fillStyle = '#8a5'; g.fillRect(0, 0, c.width, c.height);
  return { _name: name, width: 576, height: 384, canvas: c, isReady: function () { return true; } };
};

/* JsonEx. Both engines ship it and both use it for save serialisation, and
   both record each object's CONSTRUCTOR NAME under '@' so parse() can put the
   prototype back (MV rpg_core.js:5586 / MZ rmmz_core.js:1053). A stub that
   round-tripped through plain JSON would hand extractSaveContents a $gameSystem
   with no methods — and every later read would fail somewhere else entirely.
   A plugin that replaces the pair with a circular-reference encoder is
   modelled in plugins-mv.js. */
var JsonEx = {
  maxDepth: 100,
  stringify: function (o) { return JSON.stringify(this._encode(o, 0)); },
  parse: function (s) { return this._decode(JSON.parse(s)); },
  makeDeepCopy: function (o) { return this.parse(this.stringify(o)); },
  /* IN PLACE, on the object the caller handed over. Both engines write
     `value['@'] = constructorName` onto the LIVE object and walk its own keys
     in place (MV rpg_core.js:8955 / MZ rmmz_core.js:6458). MV's stringify then
     calls _cleanMetadata and takes the marks off again; MZ's does not, so on MZ
     a single JsonEx.stringify($gameSystem) leaves '@' on the live object for
     good. engine-mv.js supplies the cleanup half.

     A copying _encode hid all of that: it left the world spotless on both
     engines, so a panel that walks a $game* object and reports its own keys
     looked identical on MV and MZ and is not. */
  _encode: function (value, depth) {
    if (depth > this.maxDepth) throw new Error('Object too deep');
    if (value === null || typeof value !== 'object') return value;
    if (!Array.isArray(value)) {
      var name = value.constructor ? value.constructor.name : 'Object';
      if (name !== 'Object') value['@'] = name;
    }
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      value[keys[i]] = this._encode(value[keys[i]], depth + 1);
    }
    return value;
  },
  /* IN PLACE, and the '@' key STAYS. Both engines reset the prototype on the
     object they were handed — MZ with Object.setPrototypeOf (rmmz_core.js:6483),
     MV through _resetPrototype which does the same where the platform allows
     (rpg_core.js:9131) — and where window[name] does NOT resolve they leave the
     object completely alone. So on a real game an unrecognised section arrives
     as a plain object still carrying its own '@' naming the class this build
     does not have, and that key is the only evidence of what it was.

     The earlier stub built a fresh object and stripped '@' on both branches,
     which made an unknown class indistinguishable from a plain object and hid
     the one thing a save reader has to be honest about. */
  _decode: function (value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) value[i] = this._decode(value[i]);
      return value;
    }
    if (value['@']) {
      var cls = window[value['@']];
      if (typeof cls === 'function') Object.setPrototypeOf(value, cls.prototype);
    }
    for (var j in value) {
      if (Object.prototype.hasOwnProperty.call(value, j)) value[j] = this._decode(value[j]);
    }
    return value;
  }
};

/* LZString — MV compresses saves with it (rpg_managers.js:674). Only the two
   calls the engine makes are modelled. */
var LZString = {
  compressToBase64: function (s) { return 'LZ:' + s; },
  decompressFromBase64: function (s) { return String(s).indexOf('LZ:') === 0 ? String(s).slice(3) : null; }
};
