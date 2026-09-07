/* =============================================================================
   GigaHack test harness — stubs/x-gfx-mv.js
   IMAGES, BITMAPS AND SNAPSHOTS — the DIVERGENT MV half. Modelled on
   MV rpg_*.js (MV 1.6.1) and js/libs/pixi.js (4.5.4).
   Loaded immediately after engine-mv.js; x-gfx.js holds the shared half.

   STOCK ENGINE ONLY. Anything a third-party plugin does is in plugins-mv.js.

   The four differences this file exists to make observable:
     1. ONE cache — an ImageCache instance holding _items keyed by
        `path + ':' + hue`, with a 10 MB budget it enforces by DELETING
        entries. MZ has two plain objects and no budget. An MV bitmap the
        overlay holds can therefore be purged out from under it by nothing
        more than other images being loaded (MV-MZ-DELTA.md §B.4).
     2. Every loader is (filename, hue) and passes a fourth `smooth` argument
        down to loadBitmap. MZ's take (filename) and nothing else.
     3. Bitmap.prototype.destroy does NOT EXIST. core.js:209 gives one to
        both engines for convenience; it is deleted below, because a port that
        calls bitmap.destroy() works on MZ and throws here.
     4. isObjectCharacter / isBigCharacter / isZeroParallax match against the
        RAW filename. MZ runs it through Utils.extractFileName first, so a
        character in a subfolder is `$`-big on MZ and is not on MV.
   ========================================================================== */

/* PIXI 4.5.4 js/libs/pixi.js:8404 — {LINEAR: 0, NEAREST: 1}. MZ's PIXI 5.3.12
   has them the other way round. Bitmap._createBaseTexture below writes one of
   these onto the base texture, so the NUMBER stored differs between engines
   for the same visual intent. */
PIXI.SCALE_MODES = { LINEAR: 0, NEAREST: 1 };

/* rpg_core.js:925 — Bitmap.snap renders through Graphics._renderer. MZ has
   Graphics.app.renderer instead. Both branches of MV's snap are reachable:
   core.js:149 makes Graphics.isWebGL() false, so the canvas branch that reads
   renderTexture.baseTexture._canvasRenderTarget.canvas is the live one. */
Graphics._renderer = {
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
      return cv;
    }
  }
};

/* rpg_core.js:285-288 — the counter behind ImageManager._systemReservationId.
   MZ has neither, because MZ deleted the reservation system. */
Utils._id = 1;
Utils.generateRuntimeId = function () {
  return Utils._id++;
};

/* rpg_core.js:9275-9305. MV-only, and reached from BOTH Bitmap._requestImage
   (:1675) and Bitmap.decode (:1603), so the image layer cannot be modelled
   without it. Copied verbatim. ResourceHandler.retry (:9312) is not here: it
   calls Graphics.eraseLoadingError and SceneManager.resume, which belong to
   the scene layer, and no image path reaches it. Note that an exhausted retry
   budget reaches Graphics.printLoadingError / SceneManager.stop, neither of
   which this file defines — it will throw, loudly, which is the right answer
   for a harness that has not modelled the loading-error screen. */
function ResourceHandler() {
  throw new Error('This is a static class');
}
ResourceHandler._reloaders = [];
ResourceHandler._defaultRetryInterval = [500, 1000, 3000];
ResourceHandler.createLoader = function (url, retryMethod, resignMethod, retryInterval) {
  retryInterval = retryInterval || this._defaultRetryInterval;
  var reloaders = this._reloaders;
  var retryCount = 0;
  return function () {
    if (retryCount < retryInterval.length) {
      setTimeout(retryMethod, retryInterval[retryCount]);
      retryCount++;
    } else {
      if (resignMethod) {
        resignMethod();
      }
      if (url) {
        if (reloaders.length === 0) {
          Graphics.printLoadingError(url);
          SceneManager.stop();
        }
        reloaders.push(function () {
          retryCount = 0;
          retryMethod();
        });
      }
    }
  };
};
ResourceHandler.exists = function () {
  return this._reloaders.length > 0;
};

/* =============================================================================
   Bitmap — MV
   ========================================================================== */

/* rpg_core.js:718 — MV recycles Image objects "for iOS. img consumes memory."
   MZ has no such pool. */
Bitmap._reuseImages = [];

/* rpg_core.js:838 — MV defaults smooth to FALSE, MZ to true. */
Bitmap.prototype._smooth = false;
Bitmap.prototype._decodeAfterRequest = false;   /* rpg_core.js:841 — MZ has no such flag */
Bitmap.prototype._defer = false;                /* rpg_core.js:831 */
Bitmap.prototype._dirty = false;
Bitmap.prototype.__canvas = null;
Bitmap.prototype.__context = null;
Bitmap.prototype.__baseTexture = null;
/* rpg_core.js:846 — "Cache entry, for images. In all cases _url is the same
   as cacheEntry.key". MZ has no cacheEntry, because MZ has no CacheMap. */
Bitmap.prototype.cacheEntry = null;

/* rpg_core.js:754. Two things MZ's (:1742) does not do: it REUSES an existing
   __canvas rather than making a new one, and it clamps to a MINIMUM of 1x1 —
   `Math.max(width || 0, 1)` — so MV never has a zero-sized canvas and MZ's
   _ensureCanvas explicitly can (`this._createCanvas(0, 0)`). */
Bitmap.prototype._createCanvas = function (width, height) {
  this.__canvas = this.__canvas || document.createElement('canvas');
  this.__context = this.__canvas.getContext('2d');

  this.__canvas.width = Math.max(width || 0, 1);
  this.__canvas.height = Math.max(height || 0, 1);

  if (this._image) {
    var w = Math.max(this._image.width || 0, 1);
    var h = Math.max(this._image.height || 0, 1);
    this.__canvas.width = w;
    this.__canvas.height = h;
    this._createBaseTexture(this._canvas);

    this.__context.drawImage(this._image, 0, 0);
  }

  this._setDirty();
  /* HARNESS, two lines, marked — see the note in _createBaseTexture. */
  this.width = this.__canvas.width;
  this.height = this.__canvas.height;
};

/* rpg_core.js:774. MZ factored the scale-mode branch out into
   _updateScaleMode (:1777); MV inlines it here and NOWHERE ELSE, which is why
   MV's `smooth` setter has to repeat it. */
Bitmap.prototype._createBaseTexture = function (source) {
  this.__baseTexture = new PIXI.BaseTexture(source);
  this.__baseTexture.mipmap = false;
  this.__baseTexture.width = source.width;
  this.__baseTexture.height = source.height;

  if (this._smooth) {
    this._baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
  } else {
    this._baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
  }
  /* HARNESS, two lines, marked: the engine's width/height are read-only
     getters (rpg_core.js:1037/:1054) that return 0 until isReady(). core.js:196
     assigns width/height as plain fields, so installing the getters would
     silently zero every `new Bitmap(w, h)` in the harness (see x-gfx.js's
     header). They are kept in step from the two functions that set a size. */
  this.width = source.width;
  this.height = source.height;
};

/* rpg_core.js:787. Part of the "purged" path: an image that was requested but
   is not being decoded has its Image object recycled and its pixels dropped,
   and the bitmap is left with a URL and nothing else. MZ has no such state. */
Bitmap.prototype._clearImgInstance = function () {
  this._image.src = '';
  this._image.onload = null;
  this._image.onerror = null;
  this._errorListener = null;
  this._loadListener = null;

  Bitmap._reuseImages.push(this._image);
  this._image = null;
};

/* rpg_core.js:801-812. THE MV LAZY-CANVAS SHAPE, and it is not MZ's.
   `_canvas` / `_context` are getters over a private `__canvas` / `__context`,
   and the fallback calls _createCanvas() with NO ARGUMENTS — so a bitmap that
   has no image yet gets a 1x1 canvas, not a full-size one. MZ's _ensureCanvas
   (:1750) instead rebuilds the canvas AT THE IMAGE'S SIZE and draws the image
   into it. `_baseTexture` is lazy on MV too, and builds from
   `this._image || this.__canvas` — image first. */
Object.defineProperties(Bitmap.prototype, {
  _canvas: {
    get: function () {
      if (!this.__canvas) this._createCanvas();
      return this.__canvas;
    },
    configurable: true
  },
  _context: {
    get: function () {
      if (!this.__context) this._createCanvas();
      return this.__context;
    },
    configurable: true
  },
  _baseTexture: {
    get: function () {
      if (!this.__baseTexture) this._createBaseTexture(this._image || this.__canvas);
      return this.__baseTexture;
    },
    configurable: true
  }
});

/* rpg_core.js:823 — grows the canvas when a decoded image turns out bigger
   than the 1x1 the lazy getter made. MZ has no equivalent. */
Bitmap.prototype._renewCanvas = function () {
  var newImage = this._image;
  if (newImage && this.__canvas && (this.__canvas.width < newImage.width || this.__canvas.height < newImage.height)) {
    this._createCanvas();
  }
};

/* rpg_core.js:830. The `_defer` branch at the top is the whole difference in
   construction: `new Bitmap(w, h)` builds its canvas immediately, and
   Bitmap.load sets _defer first so the loaded bitmap does not. MZ expresses
   the same intent as `if (width > 0 && height > 0)` and never needs a flag.
   The font fields are the ones engine-mv.js:90 records as __defaults —
   GameFont/28/outline 4, all three different from MZ's. */
Bitmap.prototype.initialize = function (width, height) {
  /* The whole of the _defer flag: a deferred bitmap (Bitmap.load) leaves the
     canvas to the lazy _canvas getter, a `new Bitmap(w, h)` builds it now. */
  if (!this._defer) {
    this._createCanvas(width, height);
  }

  /* Every remaining field, in the engine's own order. They are plain data
     assignments with no accessor behind any of them (`smooth` is the accessor,
     `_smooth` the field it reads), so a table says what a run of twelve
     assignments says, and says which values are MV's. _loadListeners gets a
     FRESH array here — the literal is rebuilt on every call, so no two
     bitmaps ever share one. */
  var fields = {
    _image: null,
    _url: '',
    _paintOpacity: 255,
    _smooth: false,
    _loadListeners: [],
    _loadingState: 'none',
    _decodeAfterRequest: false,
    /* CacheMap entry, when there is one; _url doubles as its key. */
    cacheEntry: null,
    /* The three engine-mv.js:90 records as __defaults, all unlike MZ's. */
    fontFace: 'GameFont',
    fontSize: 28,
    fontItalic: false,
    textColor: '#ffffff',
    outlineColor: 'rgba(0, 0, 0, 0.5)',
    outlineWidth: 4
  };
  for (var name in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      this[name] = fields[name];
    }
  }
};

/* rpg_core.js:1011 / :1024 — one line each, because the laziness is a level
   down in the `_canvas` / `_context` getters above. MZ's identically named
   accessors call _ensureCanvas() themselves. */
Object.defineProperty(Bitmap.prototype, 'canvas', {
  get: function () { return this._canvas; },
  configurable: true
});
Object.defineProperty(Bitmap.prototype, 'context', {
  get: function () { return this._context; },
  configurable: true
});
/* rpg_core.js:1071. */
Object.defineProperty(Bitmap.prototype, 'rect', {
  get: function () { return new Rectangle(0, 0, this.width, this.height); },
  configurable: true
});
/* rpg_core.js:1084 — the setter repeats the scale-mode branch inline AND
   guards it on `this.__baseTexture`, the PRIVATE field, not the lazy getter.
   Setting smooth before the texture exists is therefore recorded on _smooth
   and never reaches a texture; MZ's setter routes through _updateScaleMode,
   which has no such guard beyond `if (this._baseTexture)`. */
Object.defineProperty(Bitmap.prototype, 'smooth', {
  get: function () { return this._smooth; },
  set: function (value) {
    if (this._smooth !== value) {
      this._smooth = value;
      if (this.__baseTexture) {
        if (this._smooth) {
          this._baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
        } else {
          this._baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        }
      }
    }
  },
  configurable: true
});

/* MV HAS NO Bitmap.prototype.destroy. Verified: grep `Bitmap.prototype.destroy`
   in rpg_core.js returns nothing, and the class's own memory management is
   _clearImgInstance + the ImageCache budget instead. core.js:209 defines a
   convenience destroy() for both engines; leaving it here would let a port
   that calls bitmap.destroy() — legal on MZ (rmmz_core.js:1462) — pass on MV,
   where it throws. Deleted rather than left as a silent no-op, so the failure
   the real engine gives is the failure the harness gives.
   The `_destroyed` flag core.js pairs with it still works on the plain object
   core.js:1400 hands back from loadSystem, which carries its own isReady(). */
delete Bitmap.prototype.destroy;

/* rpg_core.js:973 — MV-only; touches the CacheMap entry so the TTL sweep
   keeps the bitmap. MZ has no cacheEntry and no touch(). */
Bitmap.prototype.touch = function () {
  if (this.cacheEntry) {
    this.cacheEntry.touch();
  }
};

/* rpg_core.js:1641 / :1649 — MV's redraw bookkeeping. MZ deleted both and
   calls this._baseTexture.update() straight from each draw call
   (MV-MZ-DELTA.md §C.15). A hook that mirrors an overlay into a bitmap has to
   set the dirty flag on MV and update the texture on MZ; neither engine
   accepts the other's gesture. */
Bitmap.prototype._setDirty = function () {
  this._dirty = true;
};
Bitmap.prototype.checkDirty = function () {
  if (this._dirty) {
    this._baseTexture.update();
    this._dirty = false;
  }
};

/* rpg_core.js:1473 — MV-ONLY. MZ has no Bitmap.prototype.blur at all, which
   is why the two snapForBackground bodies differ. Two passes of a 3x3 box
   blur through a 1px-padded scratch canvas; copied whole because the pixel
   work is the point of the call and a no-op version would let a menu
   background test pass against an unblurred snapshot. */
Bitmap.prototype.blur = function () {
  var pass, tap, edge, copy;
  for (pass = 0; pass < 2; pass++) {
    /* Re-read every pass: the second pass blurs what the first one wrote,
       and _canvas / _context are the lazy getters, in that order. */
    var w = this.width;
    var h = this.height;
    var source = this._canvas;
    var context = this._context;

    /* Step one: the image, centred in a canvas one pixel larger on each
       side, with its four EDGES smeared outward into the border so the nine
       taps below never sample past the sheet. Each entry is
       [sx, sy, sw, sh, dx, dy]; the copy keeps its size, so dw/dh repeat
       sw/sh. The four CORNER pixels of the border are deliberately left
       untouched — the engine never fills them, so a corner pixel of the
       result is short one ninth of its weight. */
    var pad = document.createElement('canvas');
    var padContext = pad.getContext('2d');
    pad.width = w + 2;
    pad.height = h + 2;
    padContext.drawImage(source, 0, 0, w, h, 1, 1, w, h);
    var edges = [
      [0, 0, w, 1, 1, 0],           /* top row    -> above */
      [0, 0, 1, h, 0, 1],           /* left col   -> left  */
      [0, h - 1, w, 1, 1, h + 1],   /* bottom row -> below */
      [w - 1, 0, 1, h, w + 1, 1]    /* right col  -> right */
    ];
    for (edge = 0; edge < edges.length; edge++) {
      copy = edges[edge];
      padContext.drawImage(source, copy[0], copy[1], copy[2], copy[3],
        copy[4], copy[5], copy[2], copy[3]);
    }

    /* Step two: a 3x3 box average done by the compositor rather than by
       hand. Black first so 'lighter' has nothing of the old image to add
       to, then the padded copy is stacked nine times at one-ninth alpha,
       each offset by one tap of the kernel — x fastest, as the engine's
       nested loops run it. */
    context.save();
    context.fillStyle = 'black';
    context.fillRect(0, 0, w, h);
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = 1 / 9;
    for (tap = 0; tap < 9; tap++) {
      context.drawImage(pad, tap % 3, Math.floor(tap / 3), w, h, 0, 0, w, h);
    }
    context.restore();
  }
  this._setDirty();
  window.__blurs = (window.__blurs || 0) + 1;
};

/* rpg_core.js:1667. The network call is replaced by the harness painter (see
   x-gfx.js); every state name and every transition is the engine's.
   Left out and why: the Image-pool pop at the top of the real body (it then
   immediately does `this._image = new Image()` again anyway — the engine's own
   dead store), and the Decrypter branch, because Decrypter.hasEncryptedImages
   is false in the harness. The ResourceHandler loader IS kept, because
   decode() reaches for the same field. */
Bitmap.prototype._requestImage = function (url) {
  if (this._decodeAfterRequest && !this._loader) {
    this._loader = ResourceHandler.createLoader(url, this._requestImage.bind(this, url), this._onError.bind(this));
  }

  this._image = window.__paintImage(url);
  this._url = url;
  this._loadingState = 'requesting';
  this._loadListener = null;
  this._errorListener = null;

  window.__imageLoads.push(this);
  if (window.__imageLoadMode === 'error') {
    this._onError();
  } else if (window.__imageLoadMode !== 'defer') {
    this._onLoad();
  }
};

/* rpg_core.js:1560. Note it does NOT set 'loaded' — it sets
   'requestCompleted' and then either decodes or PURGES. MZ's _onLoad (:1823)
   goes straight to "loaded". A port that assumes _onLoad means ready is wrong
   on MV for every request-only bitmap. */
Bitmap.prototype._onLoad = function () {
  this._image.removeEventListener('load', this._loadListener);
  this._image.removeEventListener('error', this._errorListener);

  this._renewCanvas();

  switch (this._loadingState) {
    case 'requesting':
      this._loadingState = 'requestCompleted';
      if (this._decodeAfterRequest) {
        this.decode();
      } else {
        this._loadingState = 'purged';
        this._clearImgInstance();
      }
      break;

    case 'decrypting':
      window.URL.revokeObjectURL(this._image.src);
      this._loadingState = 'decryptCompleted';
      if (this._decodeAfterRequest) {
        this.decode();
      } else {
        this._loadingState = 'purged';
        this._clearImgInstance();
      }
      break;
  }
};

/* rpg_core.js:1590 — MV-only; MZ has no decode step. The third case is the
   one that matters to a cache: a bitmap that was purged is re-REQUESTED from
   scratch when something asks for it again, so a purged reference silently
   heals instead of failing. */
Bitmap.prototype.decode = function () {
  var state = this._loadingState;

  /* Bytes already in hand — promote to 'loaded' and release everyone parked
     on addLoadListener. The __canvas test is on the PRIVATE field, so it
     asks "has a canvas been built yet", not "build me one". */
  if (state === 'requestCompleted' || state === 'decryptCompleted') {
    this._loadingState = 'loaded';
    if (!this.__canvas) {
      this._createBaseTexture(this._image);
    }
    this._setDirty();
    this._callLoadListeners();
    return;
  }

  /* Still in flight — arm the decode for when it lands, and once only, swap
     the plain error handler for the retrying loader. The removal has to use
     the OLD _errorListener, which is why the engine writes the new value
     inside the addEventListener argument; the two statements here run in
     that same order and store the same field. */
  if (state === 'requesting' || state === 'decrypting') {
    this._decodeAfterRequest = true;
    if (!this._loader) {
      this._loader = ResourceHandler.createLoader(
        this._url,
        this._requestImage.bind(this, this._url),
        this._onError.bind(this)
      );
      this._image.removeEventListener('error', this._errorListener);
      this._errorListener = this._loader;
      this._image.addEventListener('error', this._errorListener);
    }
    return;
  }

  /* Nothing is in flight and nothing is decoded: ask for the bytes again.
     'purged' lands here with the rest, which is the whole point — a bitmap
     the cache threw away re-requests itself instead of failing. */
  if (state === 'pending' || state === 'purged' || state === 'error') {
    this._decodeAfterRequest = true;
    this._requestImage(this._url);
  }

  /* 'none' and 'loaded' match no case and do nothing at all. */
};

/* rpg_core.js:1631 — removes the two DOM listeners first; MZ's is one line. */
Bitmap.prototype._onError = function () {
  this._image.removeEventListener('load', this._loadListener);
  this._image.removeEventListener('error', this._errorListener);
  this._loadingState = 'error';
};

/* rpg_core.js:1693 / :1697 / :1703 — the request-only trio. ImageCache reads
   isRequestOnly() to decide what it is allowed to purge, and RequestQueue
   reads isRequestReady()/startRequest() to drive one load at a time. MZ has
   none of these: it starts every load immediately. */
Bitmap.prototype.isRequestOnly = function () {
  return !(this._decodeAfterRequest || this.isReady());
};
Bitmap.prototype.isRequestReady = function () {
  return this._loadingState !== 'pending' &&
    this._loadingState !== 'requesting' &&
    this._loadingState !== 'decrypting';
};
Bitmap.prototype.startRequest = function () {
  if (this._loadingState === 'pending') {
    this._decodeAfterRequest = false;
    this._requestImage(this._url);
  }
};

/* rpg_core.js:906 — two flags MZ's Bitmap.load (:1254) does not set, because
   MZ has neither concept. */
Bitmap.load = function (url) {
  var bitmap = Object.create(Bitmap.prototype);
  bitmap._defer = true;
  bitmap.initialize();

  bitmap._decodeAfterRequest = true;
  bitmap._requestImage(url);

  return bitmap;
};

/* rpg_core.js:1656 — MV-only. Makes a bitmap in the 'pending' state that has
   not asked for anything yet; the reservation/request system starts it later. */
Bitmap.request = function (url) {
  var bitmap = Object.create(Bitmap.prototype);
  bitmap._defer = true;
  bitmap.initialize();

  bitmap._url = url;
  bitmap._loadingState = 'pending';

  return bitmap;
};

/* rpg_core.js:925. Differences from MZ's (rmmz_core.js:1268): the renderer is
   Graphics._renderer, there is an isWebGL() branch and the canvas path reads
   the render target off the texture instead of extracting it, the scratch
   canvas is NOT zeroed afterwards, there is an empty `else` block, and it
   ends with _setDirty() where MZ ends with baseTexture.update(). `var context`
   is captured from bitmap._context BEFORE the render, which on MV forces the
   lazy canvas into existence at full size. */
Bitmap.snap = function (stage) {
  var width = Graphics.width;
  var height = Graphics.height;
  var bitmap = new Bitmap(width, height);
  /* core.js:196 does not run initialize(), so the canvas the next line reaches
     for would be built at 1x1 by the lazy getter. This is the marked seam, not
     a behaviour change: the engine's `new Bitmap(w, h)` reaches _createCanvas
     through initialize (:830). */
  bitmap.initialize(width, height);
  /* Taken BEFORE the render, exactly as the engine does: on MV this is the
     lazy getter, so reading it here is what forces the canvas into existence
     at the full size rather than at 1x1 afterwards. */
  var target = bitmap._context;
  var renderTexture = PIXI.RenderTexture.create(width, height);
  if (stage) {
    Graphics._renderer.render(stage, renderTexture);
    stage.worldTransform.identity();
    /* WebGL has to have the pixels pulled back out of the GPU; the canvas
       renderer already owns a 2D canvas and hands that over as it stands.
       The engine primes a `var canvas = null` it then always overwrites, and
       pairs this branch with an EMPTY else — a stage-less snap simply skips
       the copy and still runs the destroy/dirty tail below. */
    var source = Graphics.isWebGL()
      ? Graphics._renderer.extract.canvas(renderTexture)
      : renderTexture.baseTexture._canvasRenderTarget.canvas;
    target.drawImage(source, 0, 0);
  }
  renderTexture.destroy({ destroyBase: true });
  bitmap._setDirty();
  return bitmap;
};

/* rpg_managers.js:2117. NOT the same as MZ's (rmmz_managers.js:2251): MV
   BLURS the snapshot in place and never destroys the one it is replacing.
   Two consequences a port has to pick up — MZ menus get a sharp background
   where MV's are blurred, and MV leaks the previous background bitmap to the
   cache budget instead of destroying it. */
SceneManager.snapForBackground = function () {
  this._backgroundBitmap = this.snap();
  this._backgroundBitmap.blur();
};

/* =============================================================================
   ImageCache / RequestQueue / CacheMap — MV only. MZ has none of the three.
   ========================================================================== */

/* rpg_core.js:464-472. */
function ImageCache() {
  this.initialize.apply(this, arguments);
}

/* rpg_core.js:468 — 10 MB, measured in PIXELS (width * height), not bytes. */
ImageCache.limit = 10 * 1000 * 1000;

ImageCache.prototype.initialize = function () {
  this._items = {};
};

/* rpg_core.js:474 — every add() runs the budget sweep, so loading one image
   is what evicts another. */
ImageCache.prototype.add = function (key, value) {
  this._items[key] = {
    bitmap: value,
    touch: Date.now(),
    key: key
  };

  this._truncateCache();
};

/* rpg_core.js:484 — a HIT re-stamps `touch`, which is what makes the sweep an
   LRU. Reading through the cache is therefore not free of side effects. */
ImageCache.prototype.get = function (key) {
  if (this._items[key]) {
    var item = this._items[key];
    item.touch = Date.now();
    return item.bitmap;
  }

  return null;
};

/* rpg_core.js:494. */
ImageCache.prototype.reserve = function (key, value, reservationId) {
  if (!this._items[key]) {
    this._items[key] = {
      bitmap: value,
      touch: Date.now(),
      key: key
    };
  }

  this._items[key].reservationId = reservationId;
};

/* rpg_core.js:506. */
ImageCache.prototype.releaseReservation = function (reservationId) {
  var items = this._items;

  Object.keys(items)
    .map(function (key) { return items[key]; })
    .forEach(function (item) {
      if (item.reservationId === reservationId) {
        delete item.reservationId;
      }
    });
};

/* rpg_core.js:518. Newest first, subtract each bitmap's pixel count from the
   budget, and DELETE everything past the line that is not held. Note the
   awkward part kept: `sizeLeft` is decremented INSIDE the keep branch, so an
   item that is only kept because _mustBeHeld() said so still spends budget. */
ImageCache.prototype._truncateCache = function () {
  var items = this._items;
  var sizeLeft = ImageCache.limit;

  Object.keys(items).map(function (key) {
    return items[key];
  }).sort(function (a, b) {
    return b.touch - a.touch;
  }).forEach(function (item) {
    if (sizeLeft > 0 || this._mustBeHeld(item)) {
      var bitmap = item.bitmap;
      sizeLeft -= bitmap.width * bitmap.height;
    } else {
      delete items[item.key];
    }
  }.bind(this));
};

/* rpg_core.js:536, comments and all — this is the function MV-MZ-DELTA.md
   §B.4 is about. A loaded, unreserved bitmap is PURGEABLE, so a reference the
   overlay keeps across enough loads is a cache miss waiting to happen. */
ImageCache.prototype._mustBeHeld = function (item) {
  // request only is weak so It's purgeable
  if (item.bitmap.isRequestOnly()) return false;
  // reserved item must be held
  if (item.reservationId) return true;
  // not ready bitmap must be held (because of checking isReady())
  if (!item.bitmap.isReady()) return true;
  // then the item may purgeable
  return false;
};

/* rpg_core.js:547 — request-only bitmaps do not count towards readiness. */
ImageCache.prototype.isReady = function () {
  var items = this._items;
  return !Object.keys(items).some(function (key) {
    return !items[key].bitmap.isRequestOnly() && !items[key].bitmap.isReady();
  });
};

/* rpg_core.js:554 — returns the bitmap, not the error. MZ's equivalent
   information comes out of ImageManager.throwLoadError as a thrown array. */
ImageCache.prototype.getErrorBitmap = function () {
  var items = this._items;
  var bitmap = null;
  if (Object.keys(items).some(function (key) {
    if (items[key].bitmap.isError()) {
      bitmap = items[key].bitmap;
      return true;
    }
    return false;
  })) {
    return bitmap;
  }

  return null;
};

/* rpg_core.js:569-612. One load in flight at a time, driven from
   ImageManager.update once per frame. Only initialize/enqueue/update/clear are
   modelled; raisePriority (:598) is a reordering helper no mod path reaches
   and is left out. */
function RequestQueue() {
  this.initialize.apply(this, arguments);
}
RequestQueue.prototype.initialize = function () {
  this._queue = [];
};
RequestQueue.prototype.enqueue = function (key, value) {
  this._queue.push({
    key: key,
    value: value
  });
};
RequestQueue.prototype.update = function () {
  if (this._queue.length === 0) return;

  var top = this._queue[0];
  if (top.value.isRequestReady()) {
    this._queue.shift();
    if (this._queue.length !== 0) {
      this._queue[0].value.startRequest();
    }
  } else {
    top.value.startRequest();
  }
};
RequestQueue.prototype.clear = function () {
  this._queue.splice(0);
};

/* rpg_core.js:399-407 — the TTL-swept map behind ImageManager.cache. Field
   names copied exactly; checkTTL/getItem/setItem/update (:412-458) are left
   out because MV 1.6 wires ImageManager through _imageCache instead and
   nothing in the mod's path reaches this one. It exists so
   `ImageManager.cache` is the object MV really has rather than a hole. */
function CacheMap(manager) {
  this.manager = manager;
  this._inner = {};
  this._lastRemovedEntries = {};
  this.updateTicks = 0;
  this.lastCheckTTL = 0;
  this.delayCheckTTL = 100.0;
  this.updateSeconds = Date.now();
}

/* =============================================================================
   ImageManager — MV

   NOT redefined here: ImageManager.loadSystem (core.js:1389) and
   ImageManager._iconSet. core.js's loadSystem is the IconSet fixture — it
   returns a PLAIN OBJECT carrying its own isReady() over a _destroyed flag,
   which is what lets plugins-mv.js:129 destroy a held sheet and what the
   mod's icon extraction is written against. Replacing it with the real
   one-liner below would hand back a Bitmap whose isReady() reads
   _loadingState, and a sheet destroyed out from under the overlay would
   report itself healthy — the exact failure the fixture exists to catch.
   The real body, for the record, is:

       ImageManager.loadSystem = function(filename, hue) {      // :843
           return this.loadBitmap('img/system/', filename, hue, false);
       };

   The arity is the point: MZ's is loadSystem(filename), with no hue and no
   smooth flag.

   Also not redefined: Window_Base._faceWidth / _faceHeight = 144, already at
   engine-mv.js:101-102 (rpg_windows.js:32-33). They are CONSTANTS on MV.
   MZ has no such pair; it has ImageManager.faceWidth / faceHeight as getters
   over getFaceSize(), which reads $dataSystem.faceSize (x-gfx-mz.js). A port
   that reads ImageManager.faceWidth gets undefined here, and a port that
   reads Window_Base._faceWidth gets undefined there.
   ========================================================================== */

/* rpg_managers.js:793 — legacy, still constructed at boot. MZ has nothing. */
ImageManager.cache = new CacheMap(ImageManager);

/* rpg_managers.js:795-797 — ONE cache, a request queue, and a reservation id
   generated at load time. MZ has _cache and _system and neither of the other
   two. */
ImageManager._imageCache = new ImageCache();
ImageManager._requestQueue = new RequestQueue();
ImageManager._systemReservationId = Utils.generateRuntimeId();

/* rpg_managers.js:799 — the hue is part of the KEY, so the same file at two
   hues is two cache entries and two bitmaps. MZ has no hue anywhere in
   ImageManager, so the same file is always one entry. */
ImageManager._generateCacheKey = function (path, hue) {
  return path + ':' + hue;
};

/* rpg_managers.js:819 / :823 / :831 / :827 / :847 — every loader is
   (filename, hue) and every one names its own SMOOTH flag. Characters and
   tilesets are false (nearest, so pixel art stays crisp); faces, pictures and
   parallaxes are true. MZ's loaders take (filename) and pass no flag at all,
   so on MZ the smooth default (true, rmmz_core.js:1188) applies to every
   sheet including characters. */
ImageManager.loadCharacter = function (filename, hue) {
  return this.loadBitmap('img/characters/', filename, hue, false);
};
ImageManager.loadFace = function (filename, hue) {
  return this.loadBitmap('img/faces/', filename, hue, true);
};
ImageManager.loadPicture = function (filename, hue) {
  return this.loadBitmap('img/pictures/', filename, hue, true);
};
ImageManager.loadParallax = function (filename, hue) {
  return this.loadBitmap('img/parallaxes/', filename, hue, true);
};
ImageManager.loadTileset = function (filename, hue) {
  return this.loadBitmap('img/tilesets/', filename, hue, false);
};

/* rpg_managers.js:859. encodeURIComponent, NOT MZ's Utils.encodeURI — a
   filename with a slash in it becomes %2F here and stays a subfolder there.
   `hue || 0` also means hue 0 and hue undefined share a cache key. */
ImageManager.loadBitmap = function (folder, filename, hue, smooth) {
  /* No name at all — including the empty string — is the shared 1x1. */
  if (!filename) {
    return this.loadEmptyBitmap();
  }
  var bitmap = this.loadNormalBitmap(
    folder + encodeURIComponent(filename) + '.png', hue || 0);
  bitmap.smooth = smooth;
  return bitmap;
};

/* rpg_managers.js:870 — built lazily and RESERVED under the system id, so the
   budget sweep can never take it. MZ's is a plain `new Bitmap(1, 1)` field
   (rmmz_managers.js:861) that nothing can evict because there is no sweep. */
ImageManager.loadEmptyBitmap = function () {
  var empty = this._imageCache.get('empty');
  if (!empty) {
    empty = new Bitmap();
    /* HARNESS, one line, marked: the engine's constructor is
       `function Bitmap(){ this.initialize.apply(this, arguments); }`
       (rpg_core.js:713), so this bitmap is 1x1 by way of
       _createCanvas(undefined, undefined) and Math.max(w || 0, 1). core.js:196
       is the drawing-surface shortcut and does not call initialize, which
       would leave width/height undefined — and ImageCache._truncateCache
       multiplies them, so the budget would go NaN and evict the cache. */
    empty.initialize();
    this._imageCache.add('empty', empty);
    this._imageCache.reserve('empty', empty, this._systemReservationId);
  }

  return empty;
};

/* rpg_managers.js:881. Three behaviours MZ's loadBitmapFromUrl (:972) does
   not have: a hue rotation hung on a load listener, a re-DECODE of a cached
   bitmap that is not ready (the purged-bitmap heal path), and a single cache
   with no system/non-system split.
   rotateHue is not modelled — it is a getImageData pixel loop
   (rpg_core.js:1404) and nothing in the mod's path passes a non-zero hue; the
   listener is still registered so the deferred-load ordering is real. */
ImageManager.loadNormalBitmap = function (path, hue) {
  var key = this._generateCacheKey(path, hue);
  var bitmap = this._imageCache.get(key);
  if (!bitmap) {
    bitmap = Bitmap.load(path);
    bitmap.addLoadListener(function () {
      bitmap.rotateHue(hue);
    });
    this._imageCache.add(key, bitmap);
  } else if (!bitmap.isReady()) {
    bitmap.decode();
  }

  return bitmap;
};

/* rpg_core.js:1404 — SHAPE ONLY. The real body is a getImageData /
   putImageData pass that walks every pixel through an RGB->HSL rotation; it
   is left out because it would test the colour maths and nothing else, and
   because loadNormalBitmap above calls it with hue 0 on every mod path.
   The call, the guard and the dirty flag are the engine's. */
Bitmap.prototype.rotateHue = function (offset) {
  if (offset) {
    window.__hueRotations = (window.__hueRotations || 0) + 1;
    this._hueRotated = offset;
    this._setDirty();
  }
};

/* rpg_managers.js:897 — ONE LINE, and it destroys nothing. The old ImageCache
   is dropped whole, system sheets included, and every bitmap in it keeps its
   pixels and its base texture and simply stops being findable. MZ's clear
   (rmmz_managers.js:980) does the opposite on both counts: it calls destroy()
   on each entry and it leaves _system alone.
   The `this._cleared++` counter is core.js:1404's and is kept because
   plugins-mv.js:130 and the suite observe it; the line above it is the
   engine's. */
ImageManager.clear = function () {
  this._imageCache = new ImageCache();
  this._cleared++;
};

/* rpg_managers.js:901 — delegates, and never throws. MZ's walks both caches
   itself and throws an array on the first errored bitmap. */
ImageManager.isReady = function () {
  return this._imageCache.isReady();
};

/* rpg_managers.js:1087 — MV-only, called once a frame from
   SceneManager.updateManagers (engine-mv.js:202). MZ has neither function.
   This REPLACES core.js:1405's no-op, which exists only so engine-mv.js's
   updateManagers has something to call. */
ImageManager.update = function () {
  this._requestQueue.update();
};

/* rpg_managers.js:905 / :910 / :915 — matched against the RAW filename, and
   using MV's own String.prototype.contains (rpg_core.js:139, copied in
   x-gfx.js). MZ runs the name through Utils.extractFileName first and uses
   native includes. Consequence, and it is not academic: `evt/$Big` is a big
   character on MZ and is NOT one on MV, so the same sheet slices 3-wide on
   one engine and 12-wide on the other. */
ImageManager.isObjectCharacter = function (filename) {
  var sign = filename.match(/^[\!\$]+/);
  return sign && sign[0].contains('!');
};

ImageManager.isBigCharacter = function (filename) {
  var sign = filename.match(/^[\!\$]+/);
  return sign && sign[0].contains('$');
};

ImageManager.isZeroParallax = function (filename) {
  return filename.charAt(0) === '!';
};

/* -------------------------------------------------------------------------
   DELIBERATELY ABSENT ON MV, and each absence is a hazard for a port:

   · Bitmap.prototype.destroy      — deleted above. MZ rmmz_core.js:1462.
   · Bitmap.prototype.retry        — MZ rmmz_core.js:1718. MV rebuilds the
                                     request through ResourceHandler instead.
   · Bitmap.prototype.strokeRect   — MZ rmmz_core.js:1595.
   · Bitmap.prototype._ensureCanvas /
     _destroyCanvas / _updateScaleMode /
     the `image` accessor           — MZ rmmz_core.js:1750, :1761, :1777, :1340.
   · ImageManager.faceWidth /
     faceHeight / getFaceSize /
     getIconSize / standard*        — MZ rmmz_managers.js:854-905. MV's face
                                     size is the constant pair
                                     Window_Base._faceWidth / _faceHeight
                                     (engine-mv.js:101-102) and its icon size
                                     is Window_Base._iconWidth / _iconHeight
                                     (engine-mv.js:99-100).
   · ImageManager._cache /
     _system / _emptyBitmap /
     loadBitmapFromUrl /
     throwLoadError                 — MZ rmmz_managers.js:859, :860, :861,
                                     :972, :1003.
   · Utils.encodeURI                — MZ rmmz_core.js:370. engine-mv.js:21
                                     already records the same for
                                     Utils.extractFileName.
   ---------------------------------------------------------------------- */
