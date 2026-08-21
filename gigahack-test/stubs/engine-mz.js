/* =============================================================================
   GigaHack test harness — stubs/engine-mz.js
   The DIVERGENT MZ surface. Copied from /root/work/mz/js/rmmz_*.js (MZ 1.9.0).

   STOCK ENGINE ONLY. The 1.x harness was faithful to one MZ game's build:
   Scene_File.isSavefileEnabled came from that game's ironman plugin,
   DataManager.saveGame's Promise shape was that plugin's replacement, and
   metaArray came from another. 2.0 targets arbitrary games, so everything
   here is what RPG Maker MZ itself ships and nothing else.
   ========================================================================== */

Utils.RPGMAKER_NAME = 'MZ';          /* rmmz_core.js:187 */
Utils.RPGMAKER_VERSION = '1.9.0';
/* rmmz_core.js:380 — MZ-only, and the reason PluginManager._scripts holds
   basenames rather than the full entry. */
Utils.extractFileName = function (filename) {
  return filename.split('/').pop();
};
Utils.canUseWebGL = function () { return true; };
PIXI.VERSION = '5.3.12';

/* rmmz_core.js:882 — the canvas is `gameCanvas`, lower-case g. MV's is
   `GameCanvas`, and getElementById is case-sensitive. */
window.__canvasId = 'gameCanvas';
/* rmmz_objects.js:6506 — MZ made the tile-event list private. */
window.__tileEventsKey = '_tileEvents';
Game_Map.prototype._tileEvents = [];
Game_Map.prototype.refreshTileEvents = function () {
  this._tileEvents = this.events().filter(function (e) { return e.isTile(); });
};

Object.defineProperty(Graphics, '_canvas', {
  configurable: true, get: function () { return document.getElementById('gameCanvas'); }
});
/* rmmz_core.js:488 / :1074 — MZ's meter is _fpsCounter. MV's is _fpsMeter,
   and reading the wrong one degrades the FPS readout to a dash. */
Graphics._fpsCounter = { fps: 60 };
/* rmmz_core.js:536 / :550 — MZ-only; Caps probes both. */
Graphics.app = { ticker: { add: function () { } }, render: function () { } };
Graphics.effekseer = { setContext: function () { } };
Graphics.startGameLoop = function () { };
/* rmmz_core.js:480 — MZ's initialize takes NO arguments and does none of MV's
   document-wide surgery: no _modifyExistingElements, no _disableTextSelection
   (grep both in rmmz_core.js: zero matches). */
Graphics.initialize = function () {
  window.__graphicsInits = (window.__graphicsInits || 0) + 1;
};
Graphics.setTickHandler = function () { };

/* Bitmap defaults, rmmz_core.js:1203-1245. */
Bitmap.prototype.__defaults = { fontFace: 'sans-serif', fontSize: 16, outlineWidth: 3 };

/* ---------------------------------------------------------------------------
   ColorManager — an entire static class MV does not have (rmmz_managers.js:1746).
   normalColor is what resetTextColor paints with, so it is the one value a
   global text-colour override has to go through on MZ.
   ------------------------------------------------------------------------ */
var ColorManager = {
  _windowskin: null,
  /* rmmz_managers.js:1754 — reads this._windowskin.getPixel(px, py); the
     arithmetic is byte-identical to MV's per-window Window_Base.textColor. */
  textColor: function (n) {
    var px = 96 + (n % 8) * 12 + 6;
    var py = 144 + Math.floor(n / 8) * 12 + 6;
    return '#' + ((px + py) % 256).toString(16).padZero(2) + 'c0c0';
  },
  normalColor: function () { return this.textColor(0); },          /* :1760 */
  systemColor: function () { return this.textColor(16); },
  crisisColor: function () { return this.textColor(17); },
  deathColor: function () { return this.textColor(18); },
  gaugeBackColor: function () { return this.textColor(19); },
  outlineColor: function () { return 'rgba(0, 0, 0, 0.6)'; }        /* :1877 — no MV equivalent */
};

/* ---------------------------------------------------------------------------
   Game_System — the MZ-only members.
   ------------------------------------------------------------------------ */
/* rmmz_objects.js:400 / :408 — every MZ window reads its font through these
   two, which is why the mod's font override hooks here rather than on
   Window_Base.resetFontSettings (that runs per draw call). MV has NEITHER. */
Game_System.prototype.mainFontFace = function () { return 'rmmz-mainfont, sans-serif'; };
Game_System.prototype.mainFontSize = function () { return 26; };
Game_System.prototype.numberFontFace = function () { return 'rmmz-numberfont, monospace'; };
Game_System.prototype.windowPadding = function () { return 12; };
/* rmmz_objects.js:299 / :303 — the per-session savefile id. MV has NO
   equivalent and the call throws there, which is what made quick save never
   reach DataManager.saveGame in 1.x. */
Game_System.prototype.savefileId = function () { return this._savefileId || 1; };
Game_System.prototype.setSavefileId = function (id) { this._savefileId = id; };
Game_System.prototype.isAutosaveEnabled = function () { return false; };
Game_System.prototype.isMessageSkipEnabled = function () { return window.__skipEnabled !== false; };

/* rmmz_objects.js:576 / :508 — MV has no name-box concept at all. On the
   PROTOTYPE, not the instance: DataManager.createGameObjects rebuilds
   $gameMessage from its constructor on every load, and an instance property
   would vanish the first time a save was read. */
Game_Message.prototype.setSpeakerName = function (n) { this._speakerName = n; };
Game_Message.prototype.speakerName = function () { return this._speakerName || ''; };

/* ---------------------------------------------------------------------------
   Game_BattlerBase parameters — MZ inserts a floor at zero and has NO
   upper cap (rmmz_objects.js:2859-2891). MV clamps at 999/9999/999999 and has
   no paramBasePlus at all.
   ------------------------------------------------------------------------ */
Game_BattlerBase.prototype.paramBasePlus = function (id) {
  return Math.max(0, this.paramBase(id) + this.paramPlus(id));
};
Game_BattlerBase.prototype.paramMax = function () { return Infinity; };        /* :2871 */
Game_BattlerBase.prototype.paramMin = function (id) { return id === 0 ? 1 : 0; }; /* :2863 */
Game_BattlerBase.prototype.param = function (paramId) {
  var value = this.paramBasePlus(paramId) * this.paramRate(paramId) * this.paramBuffRate(paramId);
  var maxValue = this.paramMax(paramId);
  var minValue = this.paramMin(paramId);
  return Math.round(value.clamp(minValue, maxValue));
};
Game_Enemy.prototype.paramBasePlus = function (id) { return Math.max(0, this.paramBase(id) + this.paramPlus(id)); };

/* rmmz_objects.js — hiddenBattleMembers exists on MZ only. */
Game_Party.prototype.hiddenBattleMembers = function () {
  return this.allBattleMembers().filter(function (a) { return a.isHidden(); });
};

/* ---------------------------------------------------------------------------
   Game_Followers — MZ replaced MV's forEach/reverseEach with data()/reverseData()
   (rmmz_objects.js:8815). It is always truthy, so a `if (followers())` guard
   in front of a forEach call does not save anything; the call just throws.
   ------------------------------------------------------------------------ */
Game_Followers.prototype.data = function () { return this._data.slice(); };
Game_Followers.prototype.reverseData = function () { return this._data.slice().reverse(); };

/* ---------------------------------------------------------------------------
   Scene_File.isSavefileEnabled — rmmz_scenes.js:2276, STOCK.
   MV's Scene_File has no such member and MV's Window_SavefileList has no
   isEnabled; slot enablement simply does not exist there.
   ------------------------------------------------------------------------ */
Scene_File.prototype.firstSavefileId = function () { return 1; };
Scene_File.prototype.isSavefileEnabled = function (savefileId) {
  return this._listWindow ? this._listWindow.isEnabled(savefileId) : true;
};

/* ---------------------------------------------------------------------------
   SceneManager — MZ's frame loop.

   updateMain is a PLAIN "do one logical step": rendering is not here (it
   lives in Graphics._onTick, rmmz_core.js:808-817) and neither is the next
   frame request (PIXI's ticker drives it, rmmz_core.js:1033). That is exactly
   why it is safe to skip or repeat, and why $.caps.updateMainIsReentrant is
   true on this engine.  rmmz_managers.js:2102-2108.
   ------------------------------------------------------------------------ */
SceneManager.updateFrameCount = function () { Graphics.frameCount++; };
SceneManager.updateEffekseer = function () { };
SceneManager.isGameActive = function () { return true; };
SceneManager.updateMain = function () {
  window.__mainUpdates = (window.__mainUpdates || 0) + 1;
  this.updateFrameCount();
  this.updateInputData();
  this.updateEffekseer();
  this.changeScene();
  this.updateScene();
};
/* rmmz_managers.js:1982-1993 — the ticker calls update(deltaTime), which runs
   updateMain determineRepeatNumber(deltaTime) times and then renders
   INDEPENDENTLY. Modelled so the MZ harness drives frames through the same
   __raf queue as MV and the two engines are compared on one observable. */
SceneManager.determineRepeatNumber = function () { return 1; };
SceneManager.renderScene = function () { Graphics.render(this._scene); };
SceneManager.update = function () {
  try {
    var n = this.determineRepeatNumber();
    for (var i = 0; i < n; i++) this.updateMain();
    // Graphics._onTick renders after the tick handler returns, unconditionally
    // and exactly once per animation frame — never from inside updateMain.
    this.renderScene();
    this.requestUpdate();
  } catch (e) { this.catchException(e); }
};
/* MZ has no SceneManager.requestUpdate at all — Graphics.startGameLoop hands
   the ticker to PIXI. The harness needs SOME way to advance a frame, so the
   re-arm lives here on SceneManager.update itself rather than inside
   updateMain: that placement is the whole structural difference from MV, and
   putting it anywhere else would make the two engines untestably alike. */
SceneManager.requestUpdate = function () {
  if (!this._stopped) window.__raf.request(function () { SceneManager.update(); });
};

/* ---------------------------------------------------------------------------
   StorageManager — MZ is Promise-based and NAME-keyed (rmmz_managers.js:542-782).
   Every method MV shares a name with changed its parameter from a numeric
   savefileId to a string saveName.
   ------------------------------------------------------------------------ */
var StorageManager = {
  _files: {},
  isLocalMode: function () { return Utils.isNwjs(); },
  fileDirectoryPath: function () { return '/fake/game/save/'; },          /* :762 */
  filePath: function (saveName) { return this.fileDirectoryPath() + saveName + '.rmmzsave'; }, /* :768 */
  forageKey: function (saveName) { return 'rmmzsave.1.' + saveName; },
  exists: function (saveName) { return this._files[saveName] !== undefined; },
  remove: function (saveName) { delete this._files[saveName]; return Promise.resolve(); },
  /* :561 / :572 — the object is SERIALISED on the way in and rebuilt on the
     way out (objectToJson -> jsonToZip -> saveZip, and back). Keeping the live
     object by reference would make every save a snapshot of the future: the
     test mutates the world, loads, and the "restored" value is the mutated
     one. That is the politest possible stub and it hides the whole point of a
     save file. */
  objectToJson: function (object) { return JsonEx.stringify(object); },
  jsonToObject: function (json) { return JsonEx.parse(json); },
  jsonToZip: function (json) { if (json.length >= 50000) console.warn('Save data is too big.'); return json; },
  zipToJson: function (zip) { return zip; },
  saveObject: function (saveName, object) {
    var self = this;
    if (window.__saveShouldFail) return Promise.reject(new Error('disk full'));
    return Promise.resolve().then(function () {
      self._files[saveName] = self.jsonToZip(self.objectToJson(object));
      return 0;
    });
  },
  loadObject: function (saveName) {
    var self = this;
    return Promise.resolve().then(function () {
      if (self._files[saveName] === undefined) throw new Error('no such file');
      return self.jsonToObject(self.zipToJson(self._files[saveName]));
    });
  }
};

/* ---------------------------------------------------------------------------
   DataManager save/load — rmmz_managers.js:345-363, STOCK.

   Note what is NOT here: onBeforeSave and setSavefileId are the SCENE's job
   (rmmz_scenes.js:2375), so a caller that wants them has to run them itself.
   The 1.x harness stubbed the shape one game's ironman plugin REPLACED this
   with, which hid that.
   ------------------------------------------------------------------------ */
DataManager._globalInfo = [];      /* :44 */
DataManager.makeSavename = function (savefileId) { return 'file%1'.format(savefileId); };  /* :365 */
DataManager.makeSavefileInfo = function () {
  return {
    title: $dataSystem.gameTitle, characters: [], faces: [],
    playtime: $gameSystem.playtimeText(), timestamp: window.__now || 1700000000000
  };
};
/* :64-73 — loadGlobalInfo has NO return statement. It fires
   StorageManager.loadObject("global") and assigns _globalInfo from inside the
   .then. Anything that takes its result gets undefined. MV's RETURNS an array. */
DataManager.loadGlobalInfo = function () {
  var self = this;
  StorageManager.loadObject('global').then(function (gi) { self._globalInfo = gi; return 0; })
    .catch(function () { self._globalInfo = []; });
};
DataManager.saveGlobalInfo = function () {                                     /* :86 — NO argument */
  StorageManager.saveObject('global', this._globalInfo);
};
DataManager.savefileInfo = function (savefileId) {                             /* :335 */
  var globalInfo = this._globalInfo;
  return globalInfo[savefileId] ? globalInfo[savefileId] : null;
};
DataManager.savefileExists = function (savefileId) {
  return StorageManager.exists(this.makeSavename(savefileId));
};
DataManager.saveGame = function (savefileId) {
  var self = this;
  window.__savedTo = savefileId;
  var contents = this.makeSaveContents();
  var globals = {};
  this._SAVE_GLOBALS.forEach(function (n) { globals[n] = window[n]; });
  contents.globals = globals;
  var saveName = this.makeSavename(savefileId);
  return StorageManager.saveObject(saveName, contents).then(function () {
    self._globalInfo[savefileId] = self.makeSavefileInfo();
    self.saveGlobalInfo();
    return 0;
  });
};
DataManager.loadGame = function (savefileId) {
  var self = this;
  window.__loadedFrom = savefileId;
  var saveName = this.makeSavename(savefileId);
  return StorageManager.loadObject(saveName).then(function (contents) {
    self.createGameObjects();
    self.extractSaveContents(contents);
    self.correctDataErrors();
    return 0;
  });
};

/* ---------------------------------------------------------------------------
   ImageManager.iconWidth / iconHeight — rmmz_managers.js:863/:870, MZ-only
   defineProperty getters over getIconSize(). MV has the constants
   Window_Base._iconWidth / _iconHeight instead.
   ------------------------------------------------------------------------ */
Object.defineProperty(ImageManager, 'iconWidth', {
  configurable: true, get: function () { return 32; }
});
Object.defineProperty(ImageManager, 'iconHeight', {
  configurable: true, get: function () { return 32; }
});

/* ---------------------------------------------------------------------------
   PluginManager — rmmz_managers.js:3109-3118.
   _scripts holds the BASENAME (so `mods/Foo/Bar` registers as `Bar`), and
   setup() silently skips any name already on it. MV dedups on the FULL
   plugin.name via Array.prototype.contains. Both drop the second claim with
   no error, which is the mechanism behind a module that is enabled, present
   on disk, and never fetched.
   ------------------------------------------------------------------------ */
var PluginManager = {
  _scripts: [], _errorUrls: [], _parameters: {}, _commands: {}, _loaded: [],
  setParameters: function (name, parameters) { this._parameters[name.toLowerCase()] = parameters; },
  parameters: function (name) { return this._parameters[name.toLowerCase()] || {}; },
  makeUrl: function (filename) { return 'js/plugins/' + encodeURIComponent(filename) + '.js'; },
  loadScript: function (filename) { this._loaded.push(this.makeUrl(filename)); },
  onError: function (e) { this._errorUrls.push(e.target._url); },
  checkErrors: function () { var url = this._errorUrls.shift(); if (url) throw new Error('Failed to load: ' + url); },
  registerCommand: function (pluginName, commandName, func) {
    var key = pluginName + ':' + commandName;
    this._commands[key] = func;
  },
  callCommand: function (self, pluginName, commandName, args) {
    var key = pluginName + ':' + commandName;
    var func = this._commands[key];
    if (typeof func === 'function') func.bind(self)(args);
  },
  setup: function (plugins) {
    for (var i = 0; i < plugins.length; i++) {
      var plugin = plugins[i];
      var pluginName = Utils.extractFileName(plugin.name);
      if (plugin.status && this._scripts.indexOf(pluginName) < 0) {
        this.setParameters(pluginName, plugin.parameters);
        this.loadScript(plugin.name);
        this._scripts.push(pluginName);
      }
    }
  }
};

/* ---------------------------------------------------------------------------
   Window — MZ's part tree. _container > _backSprite > TilingSprite and
   _clientArea > _cursorSprite > 9 sprites both sit DEEPER than
   _contentsSprite and cover the same area, and _innerChildren is the list
   that tells a plugin's gauge from window chrome. MV has none of this.
   rmmz_core.js:3503-4013.
   ------------------------------------------------------------------------ */
function Window() { }
Window.prototype.padding = 12;
Window.prototype._isWindow = true;                                   /* rmmz_core.js:3503 */
Window.prototype.initWindow = function (name, x, y, w, h) {
  this._name = name; this.x = x; this.y = y; this.width = w; this.height = h;
  this.visible = true; this.openness = 255; this.origin = new Point(0, 0);
  this.children = []; this.windowskin = { getPixel: function () { return '#ffffff'; } };
  var self = this;
  function part(hasBmp, bx, by, bw, bh) {
    var s = new Sprite(hasBmp ? new Bitmap(bw, bh) : null);
    s.visible = true; s.children = [];
    s.getBounds = function () { return { x: bx, y: by, width: bw, height: bh }; };
    return s;
  }
  this._container = part(false, x, y, w, h); this._container.parent = this;
  this._backSprite = part(false, x + 4, y + 4, w - 8, h - 8); this._backSprite.parent = this._container;
  var tiling = part(true, x + 4, y + 4, w - 8, h - 8); tiling.parent = this._backSprite;
  this._backSprite.children.push(tiling);
  this._frameSprite = part(false, x, y, w, h); this._frameSprite.parent = this._container;
  var edge = part(true, x, y, w, 4); edge.parent = this._frameSprite;
  this._frameSprite.children.push(edge);
  this._container.children.push(this._backSprite, this._frameSprite);

  this._clientArea = part(false, x + this.padding, y + this.padding, w - this.padding * 2, h - this.padding * 2);
  this._clientArea.parent = this;
  this._cursorSprite = part(false, x + this.padding, y + this.padding, w - this.padding * 2, 24);
  this._cursorSprite.parent = this._clientArea;
  var cpart = part(true, x + this.padding, y + this.padding, 8, 8); cpart.parent = this._cursorSprite;
  this._cursorSprite.children.push(cpart);

  this._contentsSprite = new Sprite(new Bitmap(w - this.padding * 2, h - this.padding * 2));
  this._contentsSprite.visible = true; this._contentsSprite.children = [];
  this._contentsSprite.parent = this._clientArea;
  this._contentsSprite.worldTransform = new Transform2D(x + this.padding, y + this.padding);
  this._contentsSprite.getBounds = function () {
    return { x: x + self.padding, y: y + self.padding, width: w - self.padding * 2, height: h - self.padding * 2 };
  };
  this._clientArea.children.push(this._cursorSprite, this._contentsSprite);
  this.children.push(this._container, this._clientArea);
  return this;
};
/* rmmz_core.js:3946 — `this._innerChildren.push(child); return this._clientArea.addChild(child);` */
Window.prototype.addInnerChild = function (child) {
  this._innerChildren = this._innerChildren || [];
  this._innerChildren.push(child);
  child.parent = this._clientArea; this._clientArea.children.push(child);
  return child;
};
/* rmmz_core.js:3935 — present in MV too (rpg_core.js:6602). */
Window.prototype.addChildToBack = function (child) { this.children.unshift(child); return child; };
Object.defineProperty(Window.prototype, 'contents', {
  get: function () { return this._contentsSprite.bitmap; }, configurable: true
});
Window.prototype.getBounds = function () { return { x: this.x, y: this.y, width: this.width, height: this.height }; };
Window.prototype.drawText = function (t, x, y, maxWidth, align) {
  this.contents.drawText(t, x, y, maxWidth, this.lineHeight(), align);
};
Window.prototype.lineHeight = function () { return 36; };
Window.prototype.refresh = function () {
  this.contents.clear();
  if (this._paint) this._paint(this);
  (this._clientArea ? this._clientArea.children : []).forEach(function (c) {
    if (c && typeof c.refresh === 'function') c.refresh();
  });
  window.__windowRefreshes = (window.__windowRefreshes || 0) + 1;
};

/* Window_Base. MZ reads its font from $gameSystem and its colours from
   ColorManager, and has innerWidth/innerHeight rather than MV's
   contentsWidth/standardPadding pair. rmmz_windows.js:46-115. */
function Window_Base() { }
Window_Base.prototype = Object.create(Window.prototype);
Window_Base.prototype.constructor = Window_Base;
Window_Base.prototype.lineHeight = function () { return 36; };
Window_Base.prototype.itemPadding = function () { return 8; };
Window_Base.prototype.resetFontSettings = function () {
  this.contents.fontFace = $gameSystem.mainFontFace();
  this.contents.fontSize = $gameSystem.mainFontSize();
  this.resetTextColor();
};
Window_Base.prototype.resetTextColor = function () {
  this.changeTextColor(ColorManager.normalColor());
  this.changeOutlineColor(ColorManager.outlineColor());
};
Window_Base.prototype.changeTextColor = function (c) { this.contents.textColor = c; };
Window_Base.prototype.changeOutlineColor = function (c) { this.contents.outlineColor = c; };

/* Sprite_Gauge — rmmz_sprites.js:2099. MV has no such class; it draws gauges
   straight into the window's contents bitmap with Window_Base.drawGauge. */
function Sprite_Gauge() {
  this.bitmap = new Bitmap(128, 24); this.visible = true; this.children = [];
  this.worldTransform = new Transform2D(0, 0);
}
Sprite_Gauge.prototype.setup = function () { };
function Sprite_Name() { this.bitmap = new Bitmap(128, 24); this.children = []; }
