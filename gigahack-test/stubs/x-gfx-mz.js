/* =============================================================================
   GigaHack test harness — stubs/x-gfx-mz.js
   IMAGES, BITMAPS AND SNAPSHOTS — the DIVERGENT MZ half. Modelled on
   MZ rmmz_*.js (MZ 1.9.0) and js/libs/pixi.js (5.3.12).
   Loaded immediately after engine-mz.js; x-gfx.js holds the shared half.

   STOCK ENGINE ONLY, same rule as engine-mz.js.

   The four differences this file exists to make observable:
     1. ImageManager keeps TWO plain-object caches, _cache and _system, and
        clear() empties only the FIRST. MV keeps one ImageCache instance and
        clear() replaces the whole thing (x-gfx-mv.js). A system sheet
        therefore survives a cache clear on MZ and does not on MV.
     2. Every loader takes (filename) and nothing else. MV's take
        (filename, hue) and pass a fourth `smooth` argument down.
     3. Bitmap#canvas / #context are lazy behind _ensureCanvas, which rebuilds
        the canvas FROM the loaded image. MV's laziness rebuilds a 1x1 canvas
        instead (rpg_core.js:754 with no arguments) and keeps the pixels in
        _image. The two engines end up in the same place by opposite routes.
     4. Bitmap.prototype.destroy and Bitmap.prototype.retry exist HERE and
        nowhere on MV; Bitmap.prototype.blur exists on MV and nowhere here —
        grep `blur` in rmmz_core.js and the only hits are a CSS filter string
        and two window blur listeners.
   ========================================================================== */

/* PIXI 5.3.12 js/libs/pixi.js:3721-3722. The two constants are INVERTED
   relative to MV's PIXI 4.5.4 (LINEAR 0 / NEAREST 1). Anything that stores a
   scale mode as a NUMBER and replays it on the other engine turns smoothing
   into pixelation and back. */
PIXI.SCALE_MODES = { NEAREST: 0, LINEAR: 1 };

/* rmmz_core.js:1268 — Bitmap.snap renders through Graphics.app.renderer and
   pulls pixels back with renderer.extract.canvas(). engine-mz.js:39 already
   models Graphics.app for the ticker; this adds the renderer half beside it
   rather than replacing the object. MV has Graphics._renderer instead and no
   Graphics.app at all. */
Graphics.app.renderer = {
  renders: 0,
  render: function (stage, renderTexture) {
    this.renders++;
    window.__stageRenders = (window.__stageRenders || 0) + 1;
    window.__lastRenderedStage = stage;
  },
  extract: {
    canvas: function (renderTexture) {
      var cv = document.createElement('canvas');
      cv.width = renderTexture.width; cv.height = renderTexture.height;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#204060';
      ctx.fillRect(0, 0, cv.width, cv.height);
      return cv;
    }
  }
};

/* rmmz_core.js:370 — encodes a filename WITHOUT escaping slashes, which is
   what lets an MZ game keep images in subfolders. MV has no Utils.encodeURI
   and calls encodeURIComponent directly (rpg_managers.js:861), so a subfolder
   path becomes %2F there. */
Utils.encodeURI = function (str) {
  return encodeURIComponent(str).replace(/%2F/g, '/');
};

/* rmmz_core.js:431 — read by Bitmap._startLoading and Bitmap._onLoad.
   Utils._hasEncryptedImages is set from $dataSystem at boot; false here, so
   the loader takes the plain branch. */
Utils._hasEncryptedImages = false;
Utils.hasEncryptedImages = function () {
  return this._hasEncryptedImages;
};

/* =============================================================================
   Bitmap — MZ
   ========================================================================== */

/* rmmz_core.js:1188 — MZ defaults smooth to TRUE, MV to false. The loaders
   below never pass a smooth flag at all, so on MZ every sheet is linear
   filtered unless something sets it; on MV every loader passes an explicit
   flag and character sheets get NEAREST. */
Bitmap.prototype._smooth = true;
Bitmap.prototype._canvas = null;
Bitmap.prototype._context = null;
Bitmap.prototype._baseTexture = null;

/* rmmz_core.js:1181. Copied without the six JSDoc-documented font fields that
   engine-mz.js:51 already carries as __defaults; everything the loading path
   reads is here. core.js:196's constructor does NOT call this — it is the
   drawing-surface shortcut — so initialize() runs only where the engine runs
   it explicitly, which is Bitmap.load (:1254). */
Bitmap.prototype.initialize = function (width, height) {
  this._canvas = null;
  this._context = null;
  this._baseTexture = null;
  this._image = null;
  this._url = '';
  this._paintOpacity = 255;
  this._smooth = true;
  this._loadListeners = [];

  // "none", "loading", "loaded", or "error"
  this._loadingState = 'none';

  if (width > 0 && height > 0) {
    this._createCanvas(width, height);
  }

  this.fontFace = 'sans-serif';
  this.fontSize = 16;
  this.fontBold = false;
  this.fontItalic = false;
  this.textColor = '#ffffff';
  this.outlineColor = 'rgba(0, 0, 0, 0.5)';
  this.outlineWidth = 3;
};

/* rmmz_core.js:1742. */
Bitmap.prototype._createCanvas = function (width, height) {
  this._canvas = document.createElement('canvas');
  this._context = this._canvas.getContext('2d');
  this._canvas.width = width;
  this._canvas.height = height;
  this._createBaseTexture(this._canvas);
};

/* rmmz_core.js:1750 — the whole MZ lazy-canvas story. A bitmap that came off
   the loader has NO canvas (it was thrown away at :1791) and only an _image;
   the first read of .canvas or .context rebuilds a full-size canvas and DRAWS
   THE IMAGE INTO IT. That is why an MZ bitmap keeps working after
   ImageManager.clear() destroyed its base texture — the pixels come back, the
   texture does not, and the thing renders wrong instead of throwing.
   The `else` branch is the trap: no image means a 0x0 canvas, not an error. */
Bitmap.prototype._ensureCanvas = function () {
  if (!this._canvas) {
    if (this._image) {
      this._createCanvas(this._image.width, this._image.height);
      this._context.drawImage(this._image, 0, 0);
    } else {
      this._createCanvas(0, 0);
    }
  }
};

/* rmmz_core.js:1761. */
Bitmap.prototype._destroyCanvas = function () {
  if (this._canvas) {
    this._canvas.width = 0;
    this._canvas.height = 0;
    this._canvas = null;
  }
};

/* rmmz_core.js:1769. */
Bitmap.prototype._createBaseTexture = function (source) {
  this._baseTexture = new PIXI.BaseTexture(source);
  this._baseTexture.mipmap = false;
  this._baseTexture.width = source.width;
  this._baseTexture.height = source.height;
  this._updateScaleMode();
  /* HARNESS, two lines, marked: the engine's width/height are READ-ONLY
     getters over (this._canvas || this._image) at :1384/:1399. core.js:196
     assigns width/height as plain fields, so installing those getters would
     silently zero every `new Bitmap(w, h)` in the harness (see x-gfx.js's
     header). They are kept in step from the one function both the canvas and
     the image path go through instead. */
  this.width = source.width;
  this.height = source.height;
};

/* rmmz_core.js:1777. */
Bitmap.prototype._updateScaleMode = function () {
  if (this._baseTexture) {
    if (this._smooth) {
      this._baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    } else {
      this._baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    }
  }
};

/* rmmz_core.js:1354 / :1369 — both go through _ensureCanvas. MV's are
   `return this._canvas;` / `return this._context;` over a DIFFERENT pair of
   lazy getters (rpg_core.js:801). */
Object.defineProperty(Bitmap.prototype, 'canvas', {
  get: function () { this._ensureCanvas(); return this._canvas; },
  configurable: true
});
Object.defineProperty(Bitmap.prototype, 'context', {
  get: function () { this._ensureCanvas(); return this._context; },
  configurable: true
});
/* rmmz_core.js:1340 — MZ-only. MV exposes no `image` accessor. */
Object.defineProperty(Bitmap.prototype, 'image', {
  get: function () { return this._image; },
  configurable: true
});
/* rmmz_core.js:1414. */
Object.defineProperty(Bitmap.prototype, 'rect', {
  get: function () { return new Rectangle(0, 0, this.width, this.height); },
  configurable: true
});
/* rmmz_core.js:1427 — the setter funnels through _updateScaleMode. MV's
   setter (rpg_core.js:1084) inlines the same branch and guards on
   `this.__baseTexture`, so on MV setting smooth before the texture exists is
   silently lost and on MZ it is not. */
Object.defineProperty(Bitmap.prototype, 'smooth', {
  get: function () { return this._smooth; },
  set: function (value) {
    if (this._smooth !== value) {
      this._smooth = value;
      this._updateScaleMode();
    }
  },
  configurable: true
});

/* rmmz_core.js:1462 — MZ-ONLY. Verified absent from MV: grep
   `Bitmap.prototype.destroy` in rpg_core.js returns nothing, which is why
   x-gfx-mv.js deletes the convenience destroy core.js:209 gives both.
   Note what it does NOT do: it never touches _loadingState, so a destroyed
   bitmap still answers isReady() === true. */
Bitmap.prototype.destroy = function () {
  if (this._baseTexture) {
    this._baseTexture.destroy();
    this._baseTexture = null;
  }
  this._destroyCanvas();
  window.__bitmapDestroys = (window.__bitmapDestroys || 0) + 1;
};

/* rmmz_core.js:1718 — MZ-ONLY, and the reason ImageManager.throwLoadError can
   hand a retry closure to the error screen. MV has no retry; it rebuilds the
   request through ResourceHandler instead. */
Bitmap.prototype.retry = function () {
  this._startLoading();
};

/* rmmz_core.js:1476. */
Bitmap.prototype.resize = function (width, height) {
  width = Math.max(width || 0, 1);
  height = Math.max(height || 0, 1);
  this.canvas.width = width;
  this.canvas.height = height;
  this.width = width;
  this.height = height;
};

/* rmmz_core.js:1787. The network call is replaced by the harness painter (see
   x-gfx.js); everything else is the engine's, INCLUDING the order — the image
   is made first, then _destroyCanvas() throws the old canvas away, then the
   state goes to "loading". The synchronous completion is the engine's own
   already-decoded branch:
       this._image.src = this._url;
       if (this._image.width > 0) { this._image.onload = null; this._onLoad(); }
   Left out: _startDecrypting (:1804) and _onXhrLoad (:1813), the encrypted
   path, because Utils.hasEncryptedImages() is false in the harness and
   modelling an XHR would only test the XHR. */
Bitmap.prototype._startLoading = function () {
  this._image = window.__paintImage(this._url);
  this._destroyCanvas();
  this._loadingState = 'loading';
  window.__imageLoads.push(this);
  if (window.__imageLoadMode === 'error') {
    this._onError();
  } else if (window.__imageLoadMode !== 'defer') {
    this._onLoad();
  }
};

/* rmmz_core.js:1823. */
Bitmap.prototype._onLoad = function () {
  if (Utils.hasEncryptedImages()) {
    URL.revokeObjectURL(this._image.src);
  }
  this._loadingState = 'loaded';
  this._createBaseTexture(this._image);
  this._callLoadListeners();
};

/* rmmz_core.js:1839 — one line. MV's also removes the two DOM listeners
   first (rpg_core.js:1631). */
Bitmap.prototype._onError = function () {
  this._loadingState = 'error';
};

/* rmmz_core.js:1254 — note there is no _defer flag and no _decodeAfterRequest:
   MZ deleted MV's two-phase request/decode split outright. initialize() is
   called with NO arguments, so the bitmap starts canvas-less and the lazy
   _ensureCanvas above is what eventually builds one. */
Bitmap.load = function (url) {
  var bitmap = Object.create(Bitmap.prototype);
  bitmap.initialize();
  bitmap._url = url;
  bitmap._startLoading();
  return bitmap;
};

/* rmmz_core.js:1268. Differences from MV's (rpg_core.js:925): the renderer is
   Graphics.app.renderer rather than Graphics._renderer, there is no
   isWebGL()/canvas-render-target branch, the scratch canvas is explicitly
   zeroed afterwards, and it ends with baseTexture.update() where MV ends with
   _setDirty(). The `if (stage)` guard and the renderTexture.destroy are the
   same on both. */
Bitmap.snap = function (stage) {
  var width = Graphics.width;
  var height = Graphics.height;
  var bitmap = new Bitmap(width, height);
  /* core.js:196 does not run initialize(), so the canvas the next line writes
     into would not exist. This is the marked seam, not a behaviour change:
     the engine's `new Bitmap(w, h)` reaches _createCanvas through
     initialize (:1181). */
  bitmap.initialize(width, height);
  var renderTexture = PIXI.RenderTexture.create(width, height);
  if (stage) {
    var renderer = Graphics.app.renderer;
    renderer.render(stage, renderTexture);
    stage.worldTransform.identity();
    var canvas = renderer.extract.canvas(renderTexture);
    bitmap.context.drawImage(canvas, 0, 0);
    canvas.width = 0;
    canvas.height = 0;
  }
  renderTexture.destroy({ destroyBase: true });
  bitmap.baseTexture.update();
  return bitmap;
};

/* rmmz_managers.js:2251. NOT the same as MV's (rpg_managers.js:2117): MZ
   DESTROYS the previous background before replacing it and never blurs,
   because MZ has no Bitmap.prototype.blur. A port that keeps MV's blur call
   throws here; one that keeps MV's version leaks a bitmap per menu open. */
SceneManager.snapForBackground = function () {
  if (this._backgroundBitmap) {
    this._backgroundBitmap.destroy();
  }
  this._backgroundBitmap = this.snap();
};

/* =============================================================================
   ImageManager — MZ

   NOT redefined here: ImageManager.loadSystem (core.js:1389) and
   ImageManager._iconSet. core.js's loadSystem is the IconSet fixture — it
   returns a PLAIN OBJECT carrying its own isReady() over a _destroyed flag,
   which is what lets a cache-clearing plugin destroy a held sheet and what
   the mod's icon extraction is written against. Replacing it with the real
   one-liner below would hand back a Bitmap whose isReady() reads
   _loadingState instead, and a sheet destroyed out from under the overlay
   would report itself healthy — the exact failure the fixture exists to
   catch. The real body, for the record, is:

       ImageManager.loadSystem = function(filename) {          // :947
           return this.loadBitmap("img/system/", filename);
       };

   The arity is the point: MV's is loadSystem(filename, hue) and passes
   `false` for smooth (rpg_managers.js:843).
   ========================================================================== */

ImageManager.standardIconWidth = 32;    /* rmmz_managers.js:854 */
ImageManager.standardIconHeight = 32;   /* rmmz_managers.js:855 */
ImageManager.standardFaceWidth = 144;   /* rmmz_managers.js:856 */
ImageManager.standardFaceHeight = 144;  /* rmmz_managers.js:857 */

/* rmmz_managers.js:859 / :860 — TWO caches, both plain objects keyed by url,
   and which one a url lands in is decided by a substring test in
   loadBitmapFromUrl. MV has a single ImageCache instance keyed by
   `path + ':' + hue`. A panel that reports cache size has to know which
   engine it is on to know how many objects to count. */
ImageManager._cache = {};
ImageManager._system = {};
/* rmmz_managers.js:861 — one shared instance handed back for every empty
   filename. MV builds its empty bitmap lazily and RESERVES it
   (rpg_managers.js:870). */
ImageManager._emptyBitmap = new Bitmap(1, 1);

/* rmmz_managers.js:877 / :884 — MZ-only defineProperty getters over
   getFaceSize(). MV has the constants Window_Base._faceWidth /
   Window_Base._faceHeight = 144 (engine-mv.js:101-102, from
   rpg_windows.js:32-33) and no ImageManager face size at all.
   engine-mz.js:291-296 already models the iconWidth/iconHeight pair the same
   way, so only the face pair is added here. */
Object.defineProperty(ImageManager, 'faceWidth', {
  get: function () { return this.getFaceSize(); },
  configurable: true
});
Object.defineProperty(ImageManager, 'faceHeight', {
  get: function () { return this.getFaceSize(); },
  configurable: true
});

/* rmmz_managers.js:899 — `in`, not a truth test: a game that ships
   faceSize: 0 gets 0, not 144. And ONE size drives both width and height, so
   a non-square face is not expressible on MZ either. */
ImageManager.getFaceSize = function () {
  if ('faceSize' in $dataSystem) {
    return $dataSystem.faceSize;
  } else {
    return this.standardFaceWidth;
  }
};

/* rmmz_managers.js:923 / :927 / :935 / :951 — every loader is
   (filename) -> loadBitmap(folder, filename). No hue, no smooth flag. Every
   one of MV's is (filename, hue) -> loadBitmap(folder, filename, hue, smooth)
   with a per-folder smooth constant. */
ImageManager.loadCharacter = function (filename) {
  return this.loadBitmap('img/characters/', filename);
};
ImageManager.loadFace = function (filename) {
  return this.loadBitmap('img/faces/', filename);
};
ImageManager.loadPicture = function (filename) {
  return this.loadBitmap('img/pictures/', filename);
};
ImageManager.loadParallax = function (filename) {
  return this.loadBitmap('img/parallaxes/', filename);
};
ImageManager.loadTileset = function (filename) {
  return this.loadBitmap('img/tilesets/', filename);
};

/* rmmz_managers.js:963. Utils.encodeURI keeps slashes, so `mods/Foo` stays a
   subfolder. MV's (:859) uses encodeURIComponent, sets bitmap.smooth from the
   fourth argument, and returns loadEmptyBitmap() rather than a shared field. */
ImageManager.loadBitmap = function (folder, filename) {
  if (filename) {
    var url = folder + Utils.encodeURI(filename) + '.png';
    return this.loadBitmapFromUrl(url);
  } else {
    return this._emptyBitmap;
  }
};

/* rmmz_managers.js:972 — the substring test is on the URL, so ANY folder
   whose path contains "/system/" goes in the protected cache, not just
   img/system/. MV has no equivalent split. */
ImageManager.loadBitmapFromUrl = function (url) {
  var cache = url.includes('/system/') ? this._system : this._cache;
  if (!cache[url]) {
    cache[url] = Bitmap.load(url);
  }
  return cache[url];
};

/* rmmz_managers.js:980. It destroys and empties _cache and LEAVES _system
   ALONE — the system sheets survive. MV's clear (rpg_managers.js:897) throws
   the whole ImageCache away, system sheets included, and destroys nothing, so
   the old bitmaps keep their pixels and lose only their cache slot.
   The `this._cleared++` counter is core.js:1404's and is kept because
   plugins-mv.js:130 and the suite observe it; everything above it is the
   engine's. */
ImageManager.clear = function () {
  var cache = this._cache;
  for (var url in cache) {
    cache[url].destroy();
  }
  this._cache = {};
  this._cleared++;
};

/* rmmz_managers.js:988 — walks BOTH caches, and throws on the first errored
   bitmap rather than reporting not-ready. Transliterated from `for...of` over
   the two-element array to an indexed loop; same order, same short-circuit.
   MV's isReady (rpg_managers.js:901) delegates to ImageCache.isReady, which
   ignores request-only bitmaps and never throws. */
ImageManager.isReady = function () {
  var caches = [this._cache, this._system];
  for (var i = 0; i < caches.length; i++) {
    var cache = caches[i];
    for (var url in cache) {
      var bitmap = cache[url];
      if (bitmap.isError()) {
        this.throwLoadError(bitmap);
      }
      if (!bitmap.isReady()) {
        return false;
      }
    }
  }
  return true;
};

/* rmmz_managers.js:1003 — throws an ARRAY, not an Error, and the third
   element is a bound retry. MV has no equivalent; its error path goes through
   ResourceHandler.retry. Anything catching this with `e.message` gets
   undefined on MZ. */
ImageManager.throwLoadError = function (bitmap) {
  var retry = bitmap.retry.bind(bitmap);
  throw ['LoadError', bitmap.url, retry];
};

/* rmmz_managers.js:1008 / :1013 / :1018 — all three run the filename through
   Utils.extractFileName FIRST (engine-mz.js:16), so `evt/$Big` is big on MZ.
   MV's three (rpg_managers.js:905/:910/:915) match against the RAW filename,
   so the same subfolder name is NOT big there — the marker has to be on the
   first character of the whole string. That is the single most portable-
   looking, least portable pair of functions in the image layer. */
ImageManager.isObjectCharacter = function (filename) {
  var sign = Utils.extractFileName(filename).match(/^[!$]+/);
  return sign && sign[0].includes('!');
};

ImageManager.isBigCharacter = function (filename) {
  var sign = Utils.extractFileName(filename).match(/^[!$]+/);
  return sign && sign[0].includes('$');
};

ImageManager.isZeroParallax = function (filename) {
  return Utils.extractFileName(filename).charAt(0) === '!';
};

/* -------------------------------------------------------------------------
   DELIBERATELY ABSENT ON MZ, and each absence is a hazard for a port:

   · Bitmap.prototype.blur          — MV rpg_core.js:1473. MZ has none; grep
                                      `blur` in rmmz_core.js finds only a CSS
                                      filter string (:938) and window blur
                                      listeners. SceneManager.snapForBackground
                                      above is the only caller MV had.
   · Bitmap.prototype.decode /
     isRequestOnly / isRequestReady /
     startRequest / touch /
     _setDirty / checkDirty         — MV rpg_core.js:1590, :1693, :1697,
                                      :1703, :973, :1641, :1649. MZ deleted
                                      the request/decode split entirely.
   · ImageManager.update /
     _requestQueue / reserve* /
     request* / releaseReservation  — MV rpg_managers.js:1087, :796, :920-1091.
                                      MZ deleted the whole reservation system
                                      (MV-MZ-DELTA.md §B.4). core.js:1405
                                      gives ImageManager an update() no-op for
                                      both; on MZ nothing ever calls it,
                                      because MZ has no
                                      SceneManager.updateManagers either.
   · ImageCache / CacheMap /
     RequestQueue                   — MV rpg_core.js:464, :399, :569.
   ---------------------------------------------------------------------- */
