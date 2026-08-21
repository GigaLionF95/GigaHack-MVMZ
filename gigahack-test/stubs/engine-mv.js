/* =============================================================================
   GigaHack test harness — stubs/engine-mv.js
   The DIVERGENT MV surface. Copied from /root/work/mv/js/rpg_*.js (MV 1.6.1).

   STOCK ENGINE ONLY. Anything a third-party plugin does is in plugins-mv.js.

   The one stub in this file that everything else is subordinate to is
   SceneManager.updateMain (rpg_managers.js:1975-1994). It ends with
       this.renderScene();
       this.requestUpdate();
   so the animation-frame chain perpetuates itself from INSIDE the function.
   Returning early there does not pause the game, it ENDS it; calling the
   original N times schedules N frames that each schedule N more. Both fatal
   behaviours are observable here only because requestUpdate goes through the
   countable __raf queue in core.js.
   ========================================================================== */

Utils.RPGMAKER_NAME = 'MV';          /* rpg_core.js:173 */
Utils.RPGMAKER_VERSION = '1.6.1';
/* Utils.extractFileName does NOT exist on MV — its absence is why MV's
   PluginManager dedups on the full plugin.name. Deliberately not defined. */
PIXI.VERSION = '4.5.4';

/* rpg_core.js:2474 — the canvas is `GameCanvas`, capital G. */
window.__canvasId = 'GameCanvas';
/* rpg_objects.js:5820 — MV's tile-event list is PUBLIC. */
window.__tileEventsKey = 'tileEvents';
Game_Map.prototype.tileEvents = [];
Game_Map.prototype.refreshTileEvents = function () {
  this.tileEvents = this.events().filter(function (e) { return e.isTile(); });
};

Object.defineProperty(Graphics, '_canvas', {
  configurable: true, get: function () { return document.getElementById('GameCanvas'); }
});
/* rpg_core.js:1752 / :2623 — MV's meter is _fpsMeter, from js/libs/fpsmeter.js.
   MV-MZ-DELTA.md §A.12 flags `.fps` as unverified from source, so the mod
   null-guards it; the guard is only exercised if the field is really here. */
Graphics._fpsMeter = { fps: 58 };
/* rpg_core.js:2526 / :2632 — MV-only elements, both with inline z-index. */
Graphics._upperCanvas = null;
Graphics._modeBox = null;

/* ---------------------------------------------------------------------------
   Graphics._modifyExistingElements — rpg_core.js:2433-2439, called from
   Graphics.initialize at :1767. MV walks the whole document at boot and zeroes
   EVERY POSITIVE INLINE z-index. MZ has no such function.

   It reads element.style.zIndex — the INLINE style only — so a host that takes
   its z-index from a stylesheet rule survives and a host that sets it inline
   does not. The overlay's fallback mount path sets inline styles, so this is
   the stub that decides whether that path is safe.
   ------------------------------------------------------------------------ */
Graphics._modifyExistingElements = function () {
  var elements = document.getElementsByTagName('*');
  var zeroed = 0;
  for (var i = 0; i < elements.length; i++) {
    if (elements[i].style.zIndex > 0) { elements[i].style.zIndex = 0; zeroed++; }
  }
  window.__zIndexZeroed = (window.__zIndexZeroed || 0) + zeroed;
  return zeroed;
};

/* rpg_core.js:1734 — Graphics.initialize(width, height, type). The two DOM
   modifiers below are called from inside it (:1767 and :1770), so the mod's
   "re-assert the overlay's z-index after the engine rebuilds its DOM" hook
   has a real target to alias and a real thing to defend against. */
Graphics.initialize = function (width, height) {
  Graphics._width = width || Graphics.width;
  Graphics._height = height || Graphics.height;
  Graphics._modifyExistingElements();
  Graphics._disableTextSelection();
  window.__graphicsInits = (window.__graphicsInits || 0) + 1;
};

/* rpg_core.js:2718-2724, called from Graphics.initialize at :1770. MZ does
   not do this at all. user-select is inherited, so on MV the whole overlay is
   unselectable unless a descendant rule opts back in. */
Graphics._disableTextSelection = function () {
  var body = document.body;
  body.style.userSelect = 'none';
  body.style.webkitUserSelect = 'none';
  body.style.msUserSelect = 'none';
  body.style.mozUserSelect = 'none';
  window.__textSelectionDisabled = true;
};

/* Bitmap defaults, rpg_core.js:855-895 — different from MZ's on every line
   that matters to a drawn overlay. */
Bitmap.prototype.__defaults = { fontFace: 'GameFont', fontSize: 28, outlineWidth: 4 };

/* ---------------------------------------------------------------------------
   NO ColorManager. MV puts every colour accessor on Window_Base.prototype and
   reads THIS window's skin — colours are per-window, not global
   (rpg_windows.js:173-239). Window_Base.prototype.normalColor is still the
   best single hook point, because resetTextColor() calls it.
   ------------------------------------------------------------------------ */
function Window_Base() { }
Window_Base._iconWidth = 32;      /* rpg_windows.js:30 — MZ has ImageManager.iconWidth instead */
Window_Base._iconHeight = 32;     /* rpg_windows.js:31 */
Window_Base._faceWidth = 144;
Window_Base._faceHeight = 144;
Window_Base.prototype.lineHeight = function () { return 36; };            /* :35 */
Window_Base.prototype.standardFontFace = function () {                    /* :39 */
  if ($gameSystem.isChinese()) return 'SimHei, Heiti TC, sans-serif';
  if ($gameSystem.isKorean()) return 'Dotum, AppleGothic, sans-serif';
  return 'GameFont';
};
Window_Base.prototype.standardFontSize = function () { return 28; };      /* :49 */
Window_Base.prototype.standardPadding = function () { return 18; };       /* :53 */
Window_Base.prototype.textPadding = function () { return 6; };            /* :57 */
Window_Base.prototype.standardBackOpacity = function () { return 192; };  /* :61 */
Window_Base.prototype.textColor = function (n) {                          /* :173 */
  var px = 96 + (n % 8) * 12 + 6;
  var py = 144 + Math.floor(n / 8) * 12 + 6;
  return this.windowskin.getPixel(px, py);
};
Window_Base.prototype.normalColor = function () { return this.textColor(0); };   /* :179 */
Window_Base.prototype.systemColor = function () { return this.textColor(16); };  /* :183 */
Window_Base.prototype.crisisColor = function () { return this.textColor(17); };  /* :187 */
Window_Base.prototype.deathColor = function () { return this.textColor(18); };   /* :191 */
Window_Base.prototype.gaugeBackColor = function () { return this.textColor(19); };/* :195 */
/* rpg_windows.js:99 — MV's resetFontSettings reads the two window methods.
   MZ's reads $gameSystem.mainFontFace/Size, which MV does not have. */
Window_Base.prototype.resetFontSettings = function () {
  this.contents.fontFace = this.standardFontFace();
  this.contents.fontSize = this.standardFontSize();
  this.resetTextColor();
};
Window_Base.prototype.resetTextColor = function () { this.changeTextColor(this.normalColor()); };
Window_Base.prototype.changeTextColor = function (c) { this.contents.textColor = c; };
/* rpg_windows.js:465 — MV-only. MZ removed it entirely; Sprite_Gauge draws
   into its own bitmap instead. */
Window_Base.prototype.drawGauge = function (x, y, width, rate, color1, color2) {
  var fillW = Math.floor(width * rate);
  var gaugeY = y + this.lineHeight() - 8;
  this.contents.fillRect(x, gaugeY, width, 6, this.gaugeBackColor());
  this.contents.gradientFillRect(x, gaugeY, fillW, 6, color1, color2);
};

/* ---------------------------------------------------------------------------
   Game_BattlerBase parameters — MV clamps at paramMax and has NO
   paramBasePlus (rpg_objects.js:2424-2456). Asking for 5000 ATK on MV gets
   999, which is why the mod reads the cap before writing.
   ------------------------------------------------------------------------ */
Game_BattlerBase.prototype.paramMax = function (paramId) {                 /* :2432 */
  if (paramId === 0) return 999999;      // MHP
  if (paramId === 1) return 9999;        // MMP
  return 999;
};
Game_BattlerBase.prototype.paramMin = function (paramId) {                 /* :2424 */
  if (paramId === 1) return 0;           // MMP
  return 1;
};
Game_BattlerBase.prototype.param = function (paramId) {                    /* :2450 */
  var value = this.paramBase(paramId) + this.paramPlus(paramId);
  value *= this.paramRate(paramId) * this.paramBuffRate(paramId);
  var maxValue = this.paramMax(paramId);
  var minValue = this.paramMin(paramId);
  return Math.round(value.clamp(minValue, maxValue));
};
/* `grep -c paramBasePlus rpg_objects.js` -> 0. Deliberately absent. */

/* ---------------------------------------------------------------------------
   Game_Followers — MV HAS forEach and reverseEach (rpg_objects.js:8102/:8106).
   MZ is the engine that lacks them. The 1.x suite asserted the opposite and
   that assertion inverts here.
   ------------------------------------------------------------------------ */
Game_Followers.prototype.forEach = function (callback, thisObject) {
  this._data.forEach(callback, thisObject);
};
Game_Followers.prototype.reverseEach = function (callback, thisObject) {
  this._data.reverse();
  this._data.forEach(callback, thisObject);
  this._data.reverse();
};

/* Scene_File on MV has firstSavefileIndex, not firstSavefileId, and NO
   isSavefileEnabled at all (rpg_scenes.js:1621-1680). */
Scene_File.prototype.firstSavefileIndex = function () { return 0; };

/* ---------------------------------------------------------------------------
   SceneManager — MV's SELF-DRIVING frame loop.
   ------------------------------------------------------------------------ */
SceneManager._currentTime = 1000;
SceneManager._accumulator = 0;
SceneManager._deltaTime = 1.0 / 60.0;
/* rpg_managers.js:1894 — requestAnimationFrame(this.update.bind(this)).
   Routed through the countable queue so the suite can assert how many frames
   are pending, which is the only observable that separates "paused" from
   "the loop is dead" and "8x" from "exponential runaway". */
SceneManager.requestUpdate = function () {
  if (!this._stopped) window.__raf.request(function () { SceneManager.update(); });
};
/* MV drives its own clock off performance.now(); the harness advances
   __clock by exactly one frame per __raf.flush() so the accumulator loop runs
   exactly once per frame and the tests are deterministic. The STRUCTURE below
   is the engine's, unchanged. */
SceneManager._getTimeInMsWithoutMobileSafari = function () { return window.__clock; };
SceneManager.tickStart = function () { };
SceneManager.tickEnd = function () { };
SceneManager.updateManagers = function () { ImageManager.update(); };
/* rpg_managers.js:2034 — renderScene lives on SceneManager on MV and is
   called from INSIDE updateMain. */
SceneManager.renderScene = function () {
  if (this.isCurrentSceneStarted()) Graphics.render(this._scene);
};
/* rpg_managers.js:1975-1994, verbatim in structure. */
SceneManager.updateMain = function () {
  window.__mainUpdates = (window.__mainUpdates || 0) + 1;
  if (Utils.isMobileSafari()) {
    this.changeScene();
    this.updateScene();
  } else {
    var newTime = this._getTimeInMsWithoutMobileSafari();
    var fTime = (newTime - this._currentTime) / 1000;
    if (fTime > 0.25) fTime = 0.25;
    this._currentTime = newTime;
    this._accumulator += fTime;
    while (this._accumulator >= this._deltaTime) {
      this.updateInputData();
      this.changeScene();
      this.updateScene();
      this._accumulator -= this._deltaTime;
    }
  }
  this.renderScene();
  this.requestUpdate();
};
/* rpg_managers.js:1900 */
SceneManager.update = function () {
  try {
    this.tickStart();
    this.updateManagers();
    this.updateMain();
    this.tickEnd();
  } catch (e) { this.catchException(e); }
};

/* ---------------------------------------------------------------------------
   StorageManager — MV is SYNCHRONOUS and ID-keyed (rpg_managers.js:571-777).
   ------------------------------------------------------------------------ */
var StorageManager = {
  _files: {},
  _backups: {},
  isLocalMode: function () { return Utils.isNwjs(); },                     /* :669 */
  save: function (savefileId, json) { this._files[savefileId] = json; },   /* :571 */
  load: function (savefileId) { return this._files[savefileId] || null; }, /* :579 */
  exists: function (savefileId) { return this._files[savefileId] !== undefined; }, /* :587 */
  remove: function (savefileId) { delete this._files[savefileId]; },       /* :595 */
  /* :603 — copies the live file to a ".bak" sidecar. MZ has no engine-level
     save backup at all, which is why the mod's backup module is the only one
     on that engine. */
  backup: function (savefileId) {
    if (this.exists(savefileId)) this._backups[savefileId] = LZString.compressToBase64(this.load(savefileId));
  },
  backupExists: function (savefileId) { return this._backups[savefileId] !== undefined; }, /* :624 */
  cleanBackup: function (savefileId) { delete this._backups[savefileId]; },                /* :632 */
  restoreBackup: function (savefileId) {                                                   /* :646 */
    if (this.backupExists(savefileId)) {
      this._files[savefileId] = LZString.decompressFromBase64(this._backups[savefileId]);
      delete this._backups[savefileId];
    }
  },
  /* :755 — <game root>/save/, resolved from the NW.js entry module. Plugins
     redirect this (plugins-mv.js models one), which is why the mod resolves it
     at call time rather than caching it. */
  localFileDirectoryPath: function () { return '/fake/game/save/'; },
  /* :762 — MV maps the numeric id to a filename ITSELF, special cases
     included. MZ splits it into makeSavename(id) + filePath(name). */
  localFilePath: function (savefileId) {
    var name;
    if (savefileId < 0) name = 'config.rpgsave';
    else if (savefileId === 0) name = 'global.rpgsave';
    else name = 'file%1.rpgsave'.format(savefileId);
    return this.localFileDirectoryPath() + name;
  },
  webStorageKey: function (savefileId) {                                    /* :774 */
    if (savefileId < 0) return 'RPG Config';
    if (savefileId === 0) return 'RPG Global';
    return 'RPG File%1'.format(savefileId);
  }
};

/* ---------------------------------------------------------------------------
   DataManager save/load — rpg_managers.js:241-395, STOCK.

   SYNCHRONOUS, returning BOOLEANS. `false` is a genuine write failure and the
   1.x code reported it as success. loadGlobalInfo RETURNS the array;
   saveGlobalInfo TAKES it as an argument; savefileInfo is called
   loadSavefileInfo here and re-reads and re-parses the whole global file on
   EVERY call, so a panel listing 20 slots decompresses 20 times per repaint.
   ------------------------------------------------------------------------ */
DataManager._globalId = 'RPGMV';
DataManager._lastAccessedId = 1;
window.__globalInfoReads = 0;
DataManager.loadGlobalInfo = function () {                                  /* :241 */
  window.__globalInfoReads++;
  var json;
  try { json = StorageManager.load(0); } catch (e) { console.error(e); return []; }
  if (json) {
    var globalInfo = JSON.parse(json);
    for (var i = 1; i <= this.maxSavefiles(); i++) {
      if (!StorageManager.exists(i)) delete globalInfo[i];
    }
    return globalInfo;
  }
  return [];
};
DataManager.saveGlobalInfo = function (info) {                              /* :262 — TAKES the array */
  StorageManager.save(0, JSON.stringify(info));
};
DataManager.loadSavefileInfo = function (savefileId) {                      /* :360 */
  var globalInfo = this.loadGlobalInfo();
  return (globalInfo && globalInfo[savefileId]) ? globalInfo[savefileId] : null;
};
DataManager.lastAccessedSavefileId = function () { return this._lastAccessedId; };  /* :359 */
DataManager.savefileExists = function (id) { return StorageManager.exists(id); };
DataManager.isThisGameFile = function (savefileId) {                        /* :266 */
  var globalInfo = this.loadGlobalInfo();
  if (globalInfo && globalInfo[savefileId]) {
    if (StorageManager.isLocalMode()) return true;
    var savefile = globalInfo[savefileId];
    return (savefile.globalId === this._globalId && savefile.title === $dataSystem.gameTitle);
  }
  return false;
};
DataManager.makeSavefileInfo = function () {                                /* :415 */
  return {
    globalId: this._globalId,        // MV-only field, used by isThisGameFile
    title: $dataSystem.gameTitle, characters: [], faces: [],
    playtime: $gameSystem.playtimeText(), timestamp: window.__now || 1700000000000
  };
};
DataManager.saveGameWithoutRescue = function (savefileId) {                 /* :370 */
  var contents = this.makeSaveContents();
  var globals = {};
  this._SAVE_GLOBALS.forEach(function (n) { globals[n] = window[n]; });
  contents.globals = globals;
  var json = JsonEx.stringify(contents);
  if (json.length >= 200000) console.warn('Save data too big!');
  if (window.__saveShouldFail) throw new Error('disk full');
  StorageManager.save(savefileId, json);
  this._lastAccessedId = savefileId;
  var globalInfo = this.loadGlobalInfo() || [];
  globalInfo[savefileId] = this.makeSavefileInfo();
  this.saveGlobalInfo(globalInfo);
  return true;
};
DataManager.loadGameWithoutRescue = function (savefileId) {                 /* :383 */
  if (this.isThisGameFile(savefileId)) {
    var json = StorageManager.load(savefileId);
    this.createGameObjects();
    this.extractSaveContents(JsonEx.parse(json));
    this._lastAccessedId = savefileId;
    return true;
  }
  return false;                       // NOT an exception — a plain false
};
DataManager.saveGame = function (savefileId) {                              /* :337 */
  window.__savedTo = savefileId;
  try {
    StorageManager.backup(savefileId);
    return this.saveGameWithoutRescue(savefileId);
  } catch (e) {
    console.error(e);
    try {
      StorageManager.remove(savefileId);
      StorageManager.restoreBackup(savefileId);
    } catch (e2) { }
    return false;
  }
};
DataManager.loadGame = function (savefileId) {                              /* :352 */
  window.__loadedFrom = savefileId;
  try {
    return this.loadGameWithoutRescue(savefileId);
  } catch (e) {
    console.error(e);
    return false;
  }
};

/* ---------------------------------------------------------------------------
   PluginManager — rpg_managers.js:2806-2814.

   The dedup is on the FULL plugin.name (MZ dedups on the basename), via MV's
   own Array.prototype.contains polyfill, and loadScript APPENDS '.js' from
   PluginManager._path. Both are copied rather than paraphrased: a convenient
   PluginManager without the real dedup once hid the exact bug it existed to
   catch, for days.
   ------------------------------------------------------------------------ */
/* rpg_core.js:120 — the polyfill MV's own setup() calls. */
if (!Array.prototype.contains) {
  Object.defineProperty(Array.prototype, 'contains', {
    enumerable: false, configurable: true,
    value: function (element) { return this.indexOf(element) >= 0; }
  });
}
var PluginManager = {
  _path: 'js/plugins/',                /* :2801 — MV-only */
  _scripts: [], _errorUrls: [], _parameters: {}, _loaded: [],
  parameters: function (name) { return this._parameters[name.toLowerCase()] || {}; },
  setParameters: function (name, parameters) { this._parameters[name.toLowerCase()] = parameters; },
  loadScript: function (name) { this._loaded.push(this._path + name); },
  onError: function (e) { this._errorUrls.push(e.target._url); },
  checkErrors: function () { var url = this._errorUrls.shift(); if (url) throw new Error('Failed to load: ' + url); },
  setup: function (plugins) {
    plugins.forEach(function (plugin) {
      if (plugin.status && !this._scripts.contains(plugin.name)) {
        this.setParameters(plugin.name, plugin.parameters);
        this.loadScript(plugin.name + '.js');
        this._scripts.push(plugin.name);
      }
    }, this);
  }
};

/* ---------------------------------------------------------------------------
   Window — MV's FLAT part tree (rpg_core.js:6623-6642).

   _windowSpriteContainer holds _windowBackSprite and _windowFrameSprite;
   _windowCursorSprite, _windowContentsSprite and the three signs are direct
   children of the window. There is NO _clientArea, NO _innerChildren and NO
   addInnerChild — every child of an MV window is window furniture.
   ------------------------------------------------------------------------ */
function Window() { }
Window.prototype.padding = 18;                     /* standardPadding() is 18 on MV */
Window.prototype._isWindow = true;
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
  this._windowSpriteContainer = new PIXI.Container();
  this._windowBackSprite = part(true, x + 4, y + 4, w - 8, h - 8);
  this._windowFrameSprite = part(true, x, y, w, 4);
  this._windowCursorSprite = part(false, x + this.padding, y + this.padding, w - this.padding * 2, 24);
  this._windowContentsSprite = new Sprite(new Bitmap(w - this.padding * 2, h - this.padding * 2));
  this._downArrowSprite = part(false, x, y, 8, 8);
  this._upArrowSprite = part(false, x, y, 8, 8);
  this._windowPauseSignSprite = part(false, x, y, 8, 8);

  this._windowSpriteContainer.addChild(this._windowBackSprite);
  this._windowSpriteContainer.addChild(this._windowFrameSprite);
  this.children.push(this._windowSpriteContainer);
  this._windowSpriteContainer.parent = this;
  this.children.push(this._windowCursorSprite, this._windowContentsSprite,
    this._downArrowSprite, this._upArrowSprite, this._windowPauseSignSprite);
  this.children.forEach(function (c) { c.parent = self; });

  this._windowContentsSprite.visible = true;
  this._windowContentsSprite.children = [];
  /* rpg_core.js:6828 — scroll is baked into the sprite's FRAME ORIGIN on MV,
     not its transform (MZ applies it on the parent _clientArea). A bitmap
     point (bx,by) therefore lands at sprite-local (bx - origin.x, by - origin.y). */
  this._windowContentsSprite.worldTransform = new Transform2D(x + this.padding, y + this.padding);
  this._windowContentsSprite.getBounds = function () {
    return { x: x + self.padding, y: y + self.padding, width: w - self.padding * 2, height: h - self.padding * 2 };
  };
  return this;
};
/* rpg_core.js:6602 — present in MZ too. MV's Window_Base uses it for
   _dimmerSprite; there is no addInnerChild counterpart. */
Window.prototype.addChildToBack = function (child) {
  var containerIndex = this.children.indexOf(this._windowSpriteContainer);
  this.children.splice(containerIndex + 1, 0, child);
  child.parent = this;
  return child;
};
Object.defineProperty(Window.prototype, 'contents', {
  get: function () { return this._windowContentsSprite.bitmap; }, configurable: true
});
Window.prototype.getBounds = function () { return { x: this.x, y: this.y, width: this.width, height: this.height }; };
Window.prototype.drawText = function (t, x, y, maxWidth, align) {
  this.contents.drawText(t, x, y, maxWidth, this.lineHeight(), align);
};
Window.prototype.lineHeight = function () { return 36; };
Window.prototype.isOpen = function () { return this.openness >= 255; };
Window.prototype.refresh = function () {
  this.contents.clear();
  if (this._paint) this._paint(this);
  window.__windowRefreshes = (window.__windowRefreshes || 0) + 1;
};
Object.setPrototypeOf(Window_Base.prototype, Window.prototype);
Window_Base.prototype.constructor = Window_Base;
