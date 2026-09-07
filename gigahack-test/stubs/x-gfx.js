/* =============================================================================
   GigaHack test harness — stubs/x-gfx.js
   IMAGES, BITMAPS AND SNAPSHOTS — the part RPG Maker MV 1.6.1 and MZ 1.9.0
   agree on. Loaded IMMEDIATELY AFTER core.js. x-gfx-mv.js / x-gfx-mz.js load
   after their engine file and add the divergent half.

   Every stub here is copied from the shipped engine source and carries the
   file:line it came from. Line references follow core.js: MV =
   /root/work/mv/js/rpg_*.js, MZ = /root/work/mz/js/rmmz_*.js. A single
   reference means the two engines are byte-identical there.

   WHAT core.js ALREADY MODELS, AND IS THEREFORE NOT REDEFINED HERE
   ---------------------------------------------------------------
   · Bitmap as a DRAWING SURFACE (core.js:196-209). core.js's constructor
     assigns width/height as PLAIN FIELDS and never calls the engine's
     initialize(). Both engines instead make width/height read-only getters
     over `_canvas || _image` (MV rpg_core.js:1037/:1054, MZ rmmz_core.js:
     1384/:1399). Defining those getters here would make every
     `new Bitmap(w, h)` in core.js, engine-mv.js, engine-mz.js and fixtures.js
     silently report 0x0 — a sloppy-mode assignment to an accessor with no
     setter is dropped, not thrown. So width/height stay plain fields, the
     LOADING half of Bitmap is added on top, and the seam is named in the
     Bitmap section below rather than hidden.
   · ImageManager.loadSystem, ImageManager.clear's counter and
     ImageManager._iconSet (core.js:1387-1405). loadSystem is the IconSet
     fixture the mod's real icon path pulls through, and its returned object is
     a PLAIN OBJECT with its own isReady() — not a Bitmap. See the ImageManager
     note in x-gfx-mv.js / x-gfx-mz.js for why replacing it would be wrong.
   · PIXI.Container and PIXI.Graphics (core.js:157-191). This file only ADDS
     the texture side of PIXI that Bitmap.snap and _createBaseTexture reach.
   ========================================================================== */

/* -------------------------------------------------------------------------
   String.prototype.contains — MV rpg_core.js:139 / MZ rmmz_core.js:145.
   Both engines ship it; core.js copies clone/equals/format/padZero but not
   this one, and MV's ImageManager.isObjectCharacter/isBigCharacter call it
   (rpg_managers.js:905/:910). MZ ships it too but its own ImageManager uses
   native String.prototype.includes instead — that difference is modelled in
   the two engine files, not flattened here.
   ---------------------------------------------------------------------- */
String.prototype.contains = function (string) {
  return this.indexOf(string) >= 0;
};

/* -------------------------------------------------------------------------
   PIXI texture surface.

   PIXI.utils.TextureCache and PIXI.utils.BaseTextureCache are plain objects
   keyed by URL in both shipped builds (MV js/libs/pixi.js 4.5.4:21096, MZ
   js/libs/pixi.js 5.3.12:4452). A panel that reports "textures in memory"
   counts their keys, so they have to be countable objects rather than
   absent — an absent one reads as zero on every game and the panel looks
   like it works.

   PIXI.SCALE_MODES is NOT here: 4.5.4 has {LINEAR: 0, NEAREST: 1} and 5.3.12
   has {NEAREST: 0, LINEAR: 1} — the two constants are INVERTED between the
   engines. Each engine's values live in its own x-gfx file.
   ---------------------------------------------------------------------- */
PIXI.utils = {
  TextureCache: {},
  BaseTextureCache: {}
};

/* BaseTexture. Bitmap._createBaseTexture does `new PIXI.BaseTexture(source)`
   then writes mipmap/width/height/scaleMode onto it in both engines
   (MV rpg_core.js:774, MZ rmmz_core.js:1769). update() is what a redraw
   calls; it is counted so a test can prove a draw reached the texture. */
PIXI.BaseTexture = function (source) {
  this.source = source || null;
  this.width = source ? source.width : 0;
  this.height = source ? source.height : 0;
  this.mipmap = true;
  this.scaleMode = null;
  this.updates = 0;
  this.destroyed = false;
  this.update = function () { this.updates++; window.__textureUpdates = (window.__textureUpdates || 0) + 1; };
  this.destroy = function () { this.destroyed = true; window.__textureDestroys = (window.__textureDestroys || 0) + 1; };
};

/* RenderTexture is what BOTH Bitmap.snap bodies render the stage into
   (MV rpg_core.js:925, MZ rmmz_core.js:1268). Both call
   PIXI.RenderTexture.create(width, height) and both finish with
   `renderTexture.destroy({ destroyBase: true })`. */
PIXI.RenderTexture = {
  _live: 0,
  create: function (width, height) {
    PIXI.RenderTexture._live++;
    /* MV's canvas path reads renderTexture.baseTexture._canvasRenderTarget
       (rpg_core.js:936) and hands that canvas straight to drawImage; MZ never
       does. It is sized here because drawImage of a 0x0 canvas throws
       InvalidStateError, which would look like a snapshot bug. */
    var target = document.createElement('canvas');
    target.width = width; target.height = height;
    return {
      width: width, height: height, destroyed: false,
      baseTexture: { _canvasRenderTarget: { canvas: target } },
      destroy: function () { this.destroyed = true; PIXI.RenderTexture._live--; }
    };
  }
};

/* -------------------------------------------------------------------------
   THE HARNESS IMAGE LOADER.

   There is no server behind the harness, so `new Image(); img.src = url` can
   never fire. Both engines' loaders are therefore given a substitute SOURCE
   while keeping their own STATE MACHINE intact (see _startLoading in
   x-gfx-mz.js and _requestImage in x-gfx-mv.js): the network call becomes
   __paintImage(url), and every state name, every transition and every
   listener callback stays the engine's.

   Default is a SYNCHRONOUS completion, because that is the steady state a
   mod menu opens into — every sheet the running game needs is already
   decoded. __imageLoadMode lets a test have the other two:

       window.__imageLoadMode = 'sync'   (default) load completes in the call
       window.__imageLoadMode = 'defer'  stays in the engine's loading state
                                         until __flushImageLoads() is called
       window.__imageLoadMode = 'error'  takes the engine's _onError path

   'defer' is how a test proves addLoadListener is really deferred, and
   'error' is the only way to reach MZ's ImageManager.throwLoadError and MV's
   ImageCache.getErrorBitmap.
   ---------------------------------------------------------------------- */
window.__imageLoadMode = 'sync';
window.__imageLoads = [];

/* The sizes are the stock RPG Maker sheet geometry, so the slicing arithmetic
   in Sprite_Character below lands on real cell boundaries:
     characters  12 x 8 cells of 48   ($ big: 3 x 4)
     faces        4 x 2 cells of 144
     IconSet     16 x 25 cells of 32  — painted with the SAME grid core.js:1391
                                        uses, so a screenshot is unchanged
   `$` is read straight off the basename here rather than through
   ImageManager.isBigCharacter, because the painter must work identically for
   both engines and that function's body differs between them. */
window.__paintImage = function (url) {
  var name = String(url).split('/').pop().replace(/\.png$/, '');
  name = decodeURIComponent(name);
  var w = 192, h = 192, cw = 48, ch = 48;
  if (url.indexOf('img/characters/') === 0) {
    if (name.charAt(0) === '$' || name.charAt(1) === '$') { w = 144; h = 192; }
    else { w = 576; h = 384; }
  } else if (url.indexOf('img/faces/') === 0) { w = 576; h = 288; cw = 144; ch = 144; }
  else if (url.indexOf('img/sv_actors/') === 0) { w = 576; h = 384; cw = 64; ch = 64; }
  else if (url.indexOf('img/tilesets/') === 0) { w = 768; h = 768; }
  else if (url.indexOf('img/pictures/') === 0 || url.indexOf('img/titles1/') === 0 ||
           url.indexOf('img/titles2/') === 0 || url.indexOf('img/parallaxes/') === 0 ||
           url.indexOf('img/battlebacks1/') === 0 || url.indexOf('img/battlebacks2/') === 0) {
    w = 816; h = 624; cw = 816; ch = 624;
  } else if (name === 'IconSet') { w = 512; h = 800; cw = 32; ch = 32; }

  var cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  var ctx = cv.getContext('2d');
  if (name === 'IconSet') {
    for (var iy = 0; iy < 25; iy++) for (var ix = 0; ix < 16; ix++) {
      ctx.fillStyle = 'hsl(' + ((ix * 23 + iy * 31) % 360) + ' 55% 45%)';
      ctx.fillRect(ix * 32 + 3, iy * 32 + 3, 26, 26);
    }
  } else {
    var seed = 0;
    for (var i = 0; i < url.length; i++) seed = (seed * 31 + url.charCodeAt(i)) % 360;
    ctx.fillStyle = 'hsl(' + seed + ' 45% 40%)';
    ctx.fillRect(0, 0, w, h);
    /* One visible cell grid, so a wrong characterBlockX/patternWidth shows up
       in a screenshot rather than only in a number. */
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    for (var gx = 0; gx <= w; gx += cw) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (var gy = 0; gy <= h; gy += ch) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
  }
  /* The engines treat this as an HTMLImageElement. A canvas answers width,
     height, src, addEventListener/removeEventListener and is a legal
     drawImage source, which is every member either loader touches. */
  window.__imagesPainted = (window.__imagesPainted || 0) + 1;
  return cv;
};

/* Completes every bitmap parked by __imageLoadMode = 'defer'. Each engine's
   own completion path is used (MV _onLoad -> decode, MZ _onLoad), so this
   drives the real state machine rather than assigning 'loaded'. */
window.__flushImageLoads = function () {
  var batch = window.__imageLoads;
  window.__imageLoads = [];
  for (var i = 0; i < batch.length; i++) {
    if (batch[i]._loadingState !== 'loaded' && batch[i]._loadingState !== 'error') batch[i]._onLoad();
  }
  return batch.length;
};

/* -------------------------------------------------------------------------
   Bitmap — the loading half, byte-identical on both engines.

   core.js's constructor never runs the engine's initialize(), so these four
   sit on the PROTOTYPE as defaults: a core-built drawing bitmap then answers
   isReady() exactly the way the engine answers it for `new Bitmap(w, h)`
   (state 'none' -> ready), and addLoadListener fires immediately for it,
   which is also what the engine does. A bitmap built through Bitmap.load gets
   its OWN copies from initialize().
   ---------------------------------------------------------------------- */
Bitmap.prototype._loadingState = 'none';   /* MV rpg_core.js:840 / MZ rmmz_core.js:1192 */
Bitmap.prototype._url = '';                /* MV rpg_core.js:836 / MZ rmmz_core.js:1186 */
Bitmap.prototype._paintOpacity = 255;      /* MV rpg_core.js:837 / MZ rmmz_core.js:1187 */
Bitmap.prototype._image = null;            /* MV rpg_core.js:835 / MZ rmmz_core.js:1185 */

/* MV rpg_core.js:955 / MZ rmmz_core.js:1292 — byte-identical, and confirmed
   identical by MV-MZ-DELTA.md §C.15. NOTE this REPLACES core.js:206's
   `return !this._destroyed`: the engine's readiness has nothing to do with
   destruction, and a destroyed MZ bitmap still reports ready — which is
   exactly the hazard behind the mod's "re-fetched, never cached" icon policy.
   core.js's _destroyed flag still works on the plain object core.js's
   loadSystem hands back, because that object carries its own isReady(). */
Bitmap.prototype.isReady = function () {
  return this._loadingState === 'loaded' || this._loadingState === 'none';
};

/* MV rpg_core.js:965 / MZ rmmz_core.js:1301 — byte-identical. */
Bitmap.prototype.isError = function () {
  return this._loadingState === 'error';
};

/* MV rpg_core.js:1509 / MZ rmmz_core.js:1707 — byte-identical, misspelled
   parameter included. The `else` branch calling the listener SYNCHRONOUSLY is
   the part that matters: anything that assumes a load listener always fires
   later is wrong on a cache hit in both engines. */
Bitmap.prototype.addLoadListener = function (listner) {
  if (!this.isReady()) {
    this._loadListeners.push(listner);
  } else {
    listner(this);
  }
};

/* MV rpg_core.js:1620 / MZ rmmz_core.js:1832 — byte-identical. It SHIFTS the
   array empty, so a listener added from inside a listener runs in the same
   drain. */
Bitmap.prototype._callLoadListeners = function () {
  while (this._loadListeners.length > 0) {
    var listener = this._loadListeners.shift();
    listener(this);
  }
};

/* MV rpg_core.js:985 / MZ rmmz_core.js:1312 — byte-identical. */
Object.defineProperty(Bitmap.prototype, 'url', {
  get: function () { return this._url; },
  configurable: true
});

/* MV rpg_core.js:998 / MZ rmmz_core.js:1326 — the BODY is identical
   (`return this._baseTexture;`) but what it reads is not: on MZ _baseTexture
   is a plain field, on MV it is itself a lazy getter that builds the texture
   on first read (rpg_core.js:801-812). That half is in x-gfx-mv.js. */
Object.defineProperty(Bitmap.prototype, 'baseTexture', {
  get: function () { return this._baseTexture; },
  configurable: true
});

/* -------------------------------------------------------------------------
   SceneManager snapshots.

   snap() and backgroundBitmap() are byte-identical (MV rpg_managers.js:2113
   and :2122 / MZ rmmz_managers.js:2247 and :2258), and _backgroundBitmap is
   listed as an identical field in MV-MZ-DELTA.md §C.3.

   snapForBackground is NOT identical and is deliberately absent here — MV
   blurs the snapshot in place (rpg_managers.js:2117), MZ destroys the
   previous one first and does not blur at all (rmmz_managers.js:2251),
   because MZ has no Bitmap.prototype.blur to call. Each version lives in its
   own engine file.
   ---------------------------------------------------------------------- */
SceneManager._backgroundBitmap = null;   /* MV rpg_managers.js:1791 / MZ rmmz_managers.js:1912 */

SceneManager.snap = function () {
  window.__snaps = (window.__snaps || 0) + 1;
  return Bitmap.snap(this._scene);
};

SceneManager.backgroundBitmap = function () {
  return this._backgroundBitmap;
};

/* Both Bitmap.snap bodies call `stage.worldTransform.identity()` on whatever
   SceneManager._scene is. A real Scene_Base is a PIXI.Container and has one;
   core.js's Scene_Base (core.js:269) is a bare function, so snap() would
   throw there before reaching anything worth testing. Given here because
   Bitmap.snap is its only caller. */
Scene_Base.prototype.worldTransform = {
  identity: function () {
    window.__transformIdentities = (window.__transformIdentities || 0) + 1;
    return this;
  }
};

/* -------------------------------------------------------------------------
   Game_CharacterBase — the walk-cycle half.

   animationWait / maxPattern / pattern are byte-identical (MV
   rpg_objects.js:6573, :6593, :6597 / MZ rmmz_objects.js:7268, :7288, :7292),
   and pattern() is the one a sprite viewer has to get right: the sheet has
   FOUR columns but the walk cycle only ever shows three, because pattern 3
   folds back onto 1. A viewer that draws column 3 draws a frame the game
   never shows.

   direction / tileId / characterName / characterIndex are also identical
   (MV rpg_objects.js:6464, :6648, :6652, :6656 / MZ rmmz_objects.js:7156,
   :7347, :7351, :7355). core.js's Game_CharacterBase constructor does not run
   the engine's initMembers (MV :6257 / MZ :6948), so the four fields those
   accessors read are prototype defaults here, taken from that initMembers.
   ---------------------------------------------------------------------- */
Game_CharacterBase.prototype._pattern = 1;
Game_CharacterBase.prototype._direction = 2;
Game_CharacterBase.prototype._tileId = 0;
Game_CharacterBase.prototype._characterName = '';
Game_CharacterBase.prototype._characterIndex = 0;

Game_CharacterBase.prototype.animationWait = function () {
  return (9 - this.realMoveSpeed()) * 3;
};

Game_CharacterBase.prototype.maxPattern = function () {
  return 4;
};

Game_CharacterBase.prototype.pattern = function () {
  return this._pattern < 3 ? this._pattern : 1;
};

Game_CharacterBase.prototype.setPattern = function (pattern) {
  this._pattern = pattern;
};

/* core.js:554 already overrides direction() on Game_Player to a constant 2;
   this is the base the events and followers reach through. */
Game_CharacterBase.prototype.direction = function () { return this._direction; };
Game_CharacterBase.prototype.tileId = function () { return this._tileId; };
Game_CharacterBase.prototype.characterName = function () { return this._characterName; };
Game_CharacterBase.prototype.characterIndex = function () { return this._characterIndex; };

/* -------------------------------------------------------------------------
   Sprite_Character — the sheet slicer. Every method below is byte-identical
   between the engines (MV rpg_sprites.js:238-345 / MZ rmmz_sprites.js:272-382,
   `var` for `const` being the only edit), and together they are the whole
   answer to "which 48x48 of this sheet is this character right now".

   The class declaration itself is NOT identical: MV extends Sprite_Base
   (rpg_sprites.js:188), MZ extends Sprite (rmmz_sprites.js:211) because MZ
   removed Sprite_Base. core.js models one Sprite (core.js:211) and no
   Sprite_Base, so the constructor below builds on that; the divergent base
   class is named here rather than pretended away.
   ---------------------------------------------------------------------- */
function Sprite_Character(character) {
  Sprite.call(this, null);
  /* PIXI.Sprite supplies anchor in both engines; core.js's Sprite does not.
     initMembers sets it to (0.5, 1) — bottom-centre — on both
     (MV rpg_sprites.js:197 / MZ rmmz_sprites.js:220). */
  this.anchor = { x: 0.5, y: 1 };
  this._character = null;
  this._balloonDuration = 0;
  this._tilesetId = 0;
  this._upperBody = null;
  this._lowerBody = null;
  /* Not in initMembers: _tileId / _characterName / _characterIndex start
     undefined in the engine too, which is exactly why isImageChanged() below
     is true on the first update. _isBigCharacter and _bushDepth are written
     by setCharacterBitmap and updateOther respectively. */
  this._isBigCharacter = false;
  this._bushDepth = 0;
  this._frame = null;
  this.setCharacter(character);
}
Sprite_Character.prototype = Object.create(Sprite.prototype);
Sprite_Character.prototype.constructor = Sprite_Character;

/* MV rpg_sprites.js:207 / MZ rmmz_sprites.js:230. */
Sprite_Character.prototype.setCharacter = function (character) {
  this._character = character;
};

/* Sprite.prototype.setFrame lives on the PIXI-backed base class in both
   engines and is not in core.js's Sprite. Recorded here — on Sprite_Character
   so nothing else in the harness is stomped — because the frame rectangle IS
   the observable the slicing arithmetic produces. */
Sprite_Character.prototype.setFrame = function (x, y, width, height) {
  this._frame = { x: x, y: y, width: width, height: height };
  window.__spriteFrames = (window.__spriteFrames || 0) + 1;
};

/* MV rpg_sprites.js:238 / MZ rmmz_sprites.js:272. */
Sprite_Character.prototype.updateBitmap = function () {
  if (this.isImageChanged()) {
    this._tilesetId = $gameMap.tilesetId();
    this._tileId = this._character.tileId();
    this._characterName = this._character.characterName();
    this._characterIndex = this._character.characterIndex();
    if (this._tileId > 0) {
      this.setTileBitmap();
    } else {
      this.setCharacterBitmap();
    }
  }
};

/* MV rpg_sprites.js:252 / MZ rmmz_sprites.js:286. */
Sprite_Character.prototype.isImageChanged = function () {
  return (this._tilesetId !== $gameMap.tilesetId() ||
          this._tileId !== this._character.tileId() ||
          this._characterName !== this._character.characterName() ||
          this._characterIndex !== this._character.characterIndex());
};

/* MV rpg_sprites.js:232 / MZ rmmz_sprites.js:266. */
Sprite_Character.prototype.tilesetBitmap = function (tileId) {
  var tileset = $gameMap.tileset();
  var setNumber = 5 + Math.floor(tileId / 256);
  return ImageManager.loadTileset(tileset.tilesetNames[setNumber]);
};

/* MV rpg_sprites.js:259 / MZ rmmz_sprites.js:295. */
Sprite_Character.prototype.setTileBitmap = function () {
  this.bitmap = this.tilesetBitmap(this._tileId);
};

/* MV rpg_sprites.js:263 / MZ rmmz_sprites.js:299. Two calls, and the SECOND
   one is the one a port forgets: _isBigCharacter is not a property of the
   bitmap, it is re-derived from the FILENAME every time the sheet changes.
   Note the arity — MV's loadCharacter takes (filename, hue), MZ's takes
   (filename); this call site passes one argument on both, so the difference
   only bites code that passes a hue. */
Sprite_Character.prototype.setCharacterBitmap = function () {
  this.bitmap = ImageManager.loadCharacter(this._characterName);
  this._isBigCharacter = ImageManager.isBigCharacter(this._characterName);
};

/* MV rpg_sprites.js:268 / MZ rmmz_sprites.js:304. */
Sprite_Character.prototype.updateFrame = function () {
  if (this._tileId > 0) {
    this.updateTileFrame();
  } else {
    this.updateCharacterFrame();
  }
};

/* MV rpg_sprites.js:276 / MZ rmmz_sprites.js:312. */
Sprite_Character.prototype.updateTileFrame = function () {
  var pw = this.patternWidth();
  var ph = this.patternHeight();
  var sx = (Math.floor(this._tileId / 128) % 2 * 8 + this._tileId % 8) * pw;
  var sy = Math.floor(this._tileId % 256 / 8) % 16 * ph;
  this.setFrame(sx, sy, pw, ph);
};

/* MV rpg_sprites.js:284 / MZ rmmz_sprites.js:321. The bush branch sets the
   sprite's own frame to ZERO WIDTH and hands the pixels to two half sprites —
   a viewer that reads this.bitmap plus this._frame while a character is in a
   bush gets an empty rectangle from the real engine, not a bug in itself.
   updateHalfBodySprites is not modelled: it only builds the two child
   sprites, and the frames it hands them are computed here. */
Sprite_Character.prototype.updateCharacterFrame = function () {
  var pw = this.patternWidth();
  var ph = this.patternHeight();
  var sx = (this.characterBlockX() + this.characterPatternX()) * pw;
  var sy = (this.characterBlockY() + this.characterPatternY()) * ph;
  if (this._bushDepth > 0) {
    var d = this._bushDepth;
    this._upperBody.setFrame(sx, sy, pw, ph - d);
    this._lowerBody.setFrame(sx, sy + ph - d, pw, d);
    this.setFrame(sx, sy, 0, ph);
  } else {
    this.setFrame(sx, sy, pw, ph);
  }
};

/* MV rpg_sprites.js:300 / MZ rmmz_sprites.js:337. */
Sprite_Character.prototype.characterBlockX = function () {
  if (this._isBigCharacter) {
    return 0;
  } else {
    var index = this._character.characterIndex();
    return index % 4 * 3;
  }
};

/* MV rpg_sprites.js:309 / MZ rmmz_sprites.js:346. */
Sprite_Character.prototype.characterBlockY = function () {
  if (this._isBigCharacter) {
    return 0;
  } else {
    var index = this._character.characterIndex();
    return Math.floor(index / 4) * 4;
  }
};

/* MV rpg_sprites.js:318 / MZ rmmz_sprites.js:355. */
Sprite_Character.prototype.characterPatternX = function () {
  return this._character.pattern();
};

/* MV rpg_sprites.js:322 / MZ rmmz_sprites.js:359. Directions are 2/4/6/8, so
   the row is (direction - 2) / 2: down 0, left 1, right 2, up 3. */
Sprite_Character.prototype.characterPatternY = function () {
  return (this._character.direction() - 2) / 2;
};

/* MV rpg_sprites.js:326 / MZ rmmz_sprites.js:363. The divisors are the whole
   sheet contract: a normal sheet is 12 columns (4 characters x 3 patterns),
   a `$` sheet is 3. */
Sprite_Character.prototype.patternWidth = function () {
  if (this._tileId > 0) {
    return $gameMap.tileWidth();
  } else if (this._isBigCharacter) {
    return this.bitmap.width / 3;
  } else {
    return this.bitmap.width / 12;
  }
};

/* MV rpg_sprites.js:336 / MZ rmmz_sprites.js:373. 8 rows (2 x 4 directions)
   normally, 4 for a `$` sheet. */
Sprite_Character.prototype.patternHeight = function () {
  if (this._tileId > 0) {
    return $gameMap.tileHeight();
  } else if (this._isBigCharacter) {
    return this.bitmap.height / 4;
  } else {
    return this.bitmap.height / 8;
  }
};
