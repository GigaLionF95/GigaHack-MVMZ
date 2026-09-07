/* =============================================================================
   GigaHack test harness — stubs/x-screen.js
   THE SCREEN AND PICTURES: everything the two engines agree on.
   Copied from the shipped sources — MV 1.6.1 /root/work/mv/js/rpg_*.js and
   MZ 1.9.0 /root/work/mz/js/rmmz_*.js — not written from memory.

   Loaded IMMEDIATELY AFTER core.js and BEFORE engine-mv.js / engine-mz.js.
   Its per-engine halves are x-screen-mv.js and x-screen-mz.js.

   core.js already carries a PARTIAL Game_Screen (core.js:1144-1229). Nothing
   here re-states what it already has right. Three of its bodies are completed
   from the engine source, and each says so at the point of override:

     · clear()       — core.js omits clearPictures(), so `_pictures` is never
                       created and picture()/showPicture() throw on the first
                       call. The engine's clear() has SEVEN calls, not six.
     · update()      — core.js omits updateFadeOut/updateFadeIn/updatePictures,
                       i.e. the whole fade and the whole picture animation.
     · updateShake() — core.js models a square wave (`_shake = _shakePower`).
                       The engine runs a damped oscillator that reverses on
                       `_shakeDirection` and can OVERSHOOT `_shakePower`. Two
                       different numbers on every frame but the first.

   The harness's own probe counters that core.js hung off these bodies
   (__screenUpdates) are carried through unchanged, so checks written against
   core.js keep observing what they observed.

   Untouched from core.js, because they are already byte-identical to both
   engines: brightness, tone, shake, zoomX, zoomY, zoomScale, weatherType,
   weatherPower, clearFade, clearTone, clearFlash, clearShake, clearZoom,
   clearWeather, startTint, startFlash, startShake, startZoom, setZoom,
   changeWeather, updateTone, updateFlash, updateZoom, updateWeather.
   ========================================================================== */

/* -------------------------------------------------------------------------
   THE PIXI FLOOR THE SCREEN STANDS ON.

   core.js's Sprite (core.js:211) is a bare constructor — bitmap, visible, x,
   y, children — because nothing before this file needed more. Every screen
   object in both engines is a PIXI display object underneath, and the screen
   code writes through that PIXI surface: Spriteset_Base.updatePosition writes
   `this.scale.x`, MV's tone changer writes `this._baseSprite.filters` and
   `.filterArea`, MZ's writes `this.filters`. Those fields are defined here,
   in the one area that uses them.

   SHAPE, NOT BODY. The real Sprite.prototype.initialize (MV rpg_core.js:3954 /
   MZ rmmz_core.js:1858) builds a PIXI.Texture over a BaseTexture and calls
   PIXI.Sprite; the harness has no renderer, so the texture plumbing is left
   out and every field the screen code reads or writes is kept, with the same
   names and the same starting values. MZ's version additionally seeds _hue,
   _colorFilter, _blendMode and _hidden; MV's seeds _realFrame, _canvas,
   _context, _tintTexture and _isPicture. Both are listed here because a mod
   that feature-detects on either would otherwise see a sprite belonging to
   neither engine.
   ---------------------------------------------------------------------- */
Sprite._counter = 0;                                  /* MV :3982 / MZ :1879 */
Sprite.prototype.initialize = function (bitmap) {
  this.children = [];
  this.parent = null;
  this.x = 0;
  this.y = 0;
  this.alpha = 1;
  this.visible = true;
  this.scale = new Point(1, 1);
  this.pivot = new Point(0, 0);
  this.filters = null;
  this.filterArea = null;
  this._bitmap = null;
  this._frame = new Rectangle();
  this._blendColor = [0, 0, 0, 0];
  this._colorTone = [0, 0, 0, 0];
  this.spriteId = Sprite._counter++;
  this.opaque = false;
  this.bitmap = bitmap || null;
};
/* MV rpg_core.js:4094 / MZ rmmz_core.js:2034 — the two bodies are identical
   bar `var`/`const`. SHAPE: the engine compares against the existing _frame
   and calls this._refresh(), which repaints a texture and is where `width`
   and `height` come from. core.js's Sprite constructor never seeds _frame, so
   the verbatim body reads `undefined.x` and throws before it can compare;
   recording the rectangle preserves every observable the screen code has
   (the frame is read back, never re-derived), and width/height are set here
   because MV's createBaseSprite passes `this.width` straight back in. */
Sprite.prototype.setFrame = function (x, y, width, height) {
  this._refreshFrame = false;
  this._frame = new Rectangle(x, y, width, height);
  this.width = width;
  this.height = height;
};

/* Bitmap.fillAll (MV rpg_core.js:1266 / MZ rmmz_core.js:1582) and drawCircle
   (MV :1309 / MZ :1640). Both are called from Weather._createBitmaps, so a
   Weather cannot be constructed without them; core.js's Bitmap has fillRect
   and gradientFillRect but not these two. */
Bitmap.prototype.fillAll = function (color) {
  this.fillRect(0, 0, this.width, this.height, color);
};
Bitmap.prototype.drawCircle = function (x, y, radius, color) {
  this.circles = (this.circles || 0) + 1;
  this.lastCircle = { x: x, y: y, radius: radius, color: color };
};

/* ImageManager.loadPicture — MV rpg_managers.js:831 / MZ rmmz_managers.js:935.
   The signatures DIFFER: MV's is loadPicture(filename, hue), MZ's dropped the
   hue argument entirely.
   Sprite_Picture.loadBitmap is the only caller here. Declared after the
   `var ImageManager` in core.js for the hoisting reason core.js:1417 gives. */
ImageManager.loadPicture = function (filename) {
  var bmp = new Bitmap(320, 240);
  bmp._name = filename;
  return bmp;
};

/* -------------------------------------------------------------------------
   ScreenSprite — MV rpg_core.js:6138-6231 / MZ rmmz_core.js:3408-3484.

   It is the mechanism behind MV's scene fade and behind BOTH engines'
   `_blackScreen`, so it is shared. setColor is NOT shared: the two engines
   draw a different rectangle and MV additionally caches a CSS colour string
   through Utils.rgbToCssColor, a helper MZ does not have at all. That method
   lives in x-screen-mv.js / x-screen-mz.js, which means a ScreenSprite cannot
   be constructed until an engine file has loaded — which is correct, and is
   the difference this split exists to keep.

   Note the constructor form: MV is `this.initialize.apply(this, arguments)`
   (:6139) and MZ is `this.initialize(...arguments)` (:3409). Identical
   behaviour, and the harness is ES5, so the MV form is used throughout.
   ---------------------------------------------------------------------- */
function ScreenSprite() {
  this.initialize.apply(this, arguments);
}
/* MV :6145 / MZ :3415 — MZ dropped MV's `this._colorText = ''` line, because
   MZ's setColor no longer keeps one. */
ScreenSprite.prototype.initialize = function () {
  PIXI.Container.call(this);
  /* NOT AN ENGINE LINE. core.js's PIXI.Container stub (core.js:159) supplies
     children and the add/remove methods but none of PIXI's own transform
     fields. The opacity accessor below writes alpha and MV's YEP anchor shim
     writes scale, so both are seeded here rather than left to throw on a read
     that the real PIXI would have answered. */
  this.alpha = 1;
  this.scale = new Point(1, 1);
  this._graphics = new PIXI.Graphics();
  this.addChild(this._graphics);
  this.opacity = 0;
  this._red = -1;
  this._green = -1;
  this._blue = -1;
  this.setBlack();
};
/* MV :6165 / MZ :3427 — byte-identical, and the reason MV's scene fade can be
   read back as a 0-255 number: `opacity` is alpha*255, not a stored field. */
Object.defineProperty(ScreenSprite.prototype, 'opacity', {
  get: function () {
    return this.alpha * 255;
  },
  set: function (value) {
    this.alpha = value.clamp(0, 255) / 255;
  },
  configurable: true
});
/* MV :6211 / MZ :3453 */
ScreenSprite.prototype.setBlack = function () {
  this.setColor(0, 0, 0);
};
/* MV :6220 / MZ :3460 */
ScreenSprite.prototype.setWhite = function () {
  this.setColor(255, 255, 255);
};

/* -------------------------------------------------------------------------
   Weather — MV rpg_core.js:7242-7440 / MZ rmmz_core.js:4350-4505.

   The two are the same class line for line apart from MZ's added destroy()
   (x-screen-mz.js) and MZ's for-of in _updateAllSprites where MV uses
   forEach-with-thisArg. Neither changes what Spriteset_Map.updateWeather can
   see, so the whole class is shared.

   The three fields the map spriteset writes every frame — type, power, origin
   — are PUBLIC and undecorated on both engines. That is what makes weather
   the one screen effect a mod can drive without touching $gameScreen.
   ---------------------------------------------------------------------- */
function Weather() {
  this.initialize.apply(this, arguments);
}
/* MV :7249 / MZ :4357 */
Weather.prototype.initialize = function () {
  PIXI.Container.call(this);
  this._width = Graphics.width;
  this._height = Graphics.height;
  this._sprites = [];
  this._createBitmaps();
  this._createDimmer();
  /* The type of the weather in ['none', 'rain', 'storm', 'snow']. */
  this.type = 'none';
  /* The power of the weather in the range (0, 9). */
  this.power = 0;
  /* The origin point of the weather for scrolling. */
  this.origin = new Point();
};
/* MV :7289 / MZ :4403 */
Weather.prototype.update = function () {
  this._updateDimmer();
  this._updateAllSprites();
};
/* MV :7298 / MZ :4408 */
Weather.prototype._createBitmaps = function () {
  this._rainBitmap = new Bitmap(1, 60);
  this._rainBitmap.fillAll('white');
  this._stormBitmap = new Bitmap(2, 100);
  this._stormBitmap.fillAll('white');
  this._snowBitmap = new Bitmap(9, 9);
  this._snowBitmap.drawCircle(4, 4, 4, 'white');
};
/* MV :7311 / MZ :4417 */
Weather.prototype._createDimmer = function () {
  this._dimmerSprite = new ScreenSprite();
  this._dimmerSprite.setColor(80, 80, 80);
  this.addChild(this._dimmerSprite);
};
/* MV :7321 / MZ :4423 — power 0 is opacity 0, which is how "weather off"
   reads on screen even while the sprite pool is still being drained. */
Weather.prototype._updateDimmer = function () {
  this._dimmerSprite.opacity = Math.floor(this.power * 6);
};
/* MV :7329 / MZ :4427. The sprite pool is Math.floor(power * 10) deep, so
   power 9 is ninety sprites and power 0 is none — the drain is what makes
   changeWeather('none', ...) take frames to finish. */
Weather.prototype._updateAllSprites = function () {
  var maxSprites = Math.floor(this.power * 10);
  while (this._sprites.length < maxSprites) {
    this._addSprite();
  }
  while (this._sprites.length > maxSprites) {
    this._removeSprite();
  }
  this._sprites.forEach(function (sprite) {
    this._updateSprite(sprite);
    sprite.x = sprite.ax - this.origin.x;
    sprite.y = sprite.ay - this.origin.y;
  }, this);
};
/* MV :7348 / MZ :4442 — `this.viewport` is undefined on both engines; the
   argument is a leftover and is kept because it is what the engine passes. */
Weather.prototype._addSprite = function () {
  var sprite = new Sprite(this.viewport);
  sprite.opacity = 0;
  this._sprites.push(sprite);
  this.addChild(sprite);
};
/* MV :7359 / MZ :4449 */
Weather.prototype._removeSprite = function () {
  this.removeChild(this._sprites.pop());
};
/* MV :7368 / MZ :4453 — SHAPE. The real _updateSprite switches on this.type
   and dispatches to _updateRainSprite / _updateStormSprite / _updateSnowSprite
   (MV :7390/:7403/:7416, MZ :4470/:4478/:4486), each of which nudges ax/ay by
   a per-type velocity and calls _rebornSprite when the drop leaves the screen.
   That is ~60 lines of trigonometry per engine with no observable the mod can
   reach; what IS observable is that every sprite ends up with numeric ax/ay
   and that _rebornSprite is what seeds them, so the dispatch and the reborn
   call are kept and the velocities are not. */
Weather.prototype._updateSprite = function (sprite) {
  switch (this.type) {
    case 'rain':
    case 'storm':
    case 'snow':
      break;
    default:
      sprite.opacity = 0;
      break;
  }
  if (sprite.opacity < 40) {
    this._rebornSprite(sprite);
  }
};
/* MV :7429 / MZ :4494 */
Weather.prototype._rebornSprite = function (sprite) {
  sprite.ax = Math.randomInt(Graphics.width + 100) - 100 + this.origin.x;
  sprite.ay = Math.randomInt(Graphics.height + 200) - 200 + this.origin.y;
  sprite.opacity = 160 + Math.randomInt(60);
};

/* Math.randomInt: MV rpg_core.js:151 / MZ rmmz_core.js:99, byte-identical.
   _rebornSprite is the only caller in this file and core.js does not define
   it, so it is defined where it is used. */
Math.randomInt = function (max) {
  return Math.floor(max * Math.random());
};

/* -------------------------------------------------------------------------
   Game_Screen — the members core.js does not have, plus the three whose
   core.js bodies are incomplete against the engine.

   MV rpg_objects.js:617-931 / MZ rmmz_objects.js:780-1109. Everything below
   is byte-identical between the engines. The four that are NOT — maxPictures,
   movePicture, updatePictures, and the constructor form — are in the
   per-engine files.
   ---------------------------------------------------------------------- */

/* MV :621 / MZ :784. core.js's constructor (core.js:1148) calls clear()
   directly rather than going through initialize(), so initialize is defined
   here for anything that calls it by name — a save-restore path, or a mod
   that resets the screen the way the engine does. */
Game_Screen.prototype.initialize = function () {
  this.clear();
};

/* OVERRIDE — MV :625 / MZ :788. core.js:1149 has six of the seven calls; the
   missing clearPictures() is why `_pictures` would otherwise never exist and
   picture(1) would throw `Cannot read property '1' of undefined` on a stub
   that looked correct. */
Game_Screen.prototype.clear = function () {
  this.clearFade();
  this.clearTone();
  this.clearFlash();
  this.clearShake();
  this.clearZoom();
  this.clearWeather();
  this.clearPictures();
};

/* MV :635 / MZ :798. Note what it does NOT clear: tone and weather survive
   into battle, fade/flash/shake/zoom do not, and pictures are not cleared but
   SHIFTED — see eraseBattlePictures. */
Game_Screen.prototype.onBattleStart = function () {
  this.clearFade();
  this.clearFlash();
  this.clearShake();
  this.clearZoom();
  this.eraseBattlePictures();
};

/* MV :651 / MZ :814 — the fourth element is the alpha the flash decays. */
Game_Screen.prototype.flashColor = function () {
  return this._flashColor;
};

/* MV :679 / MZ :842 */
Game_Screen.prototype.picture = function (pictureId) {
  var realPictureId = this.realPictureId(pictureId);
  return this._pictures[realPictureId];
};

/* MV :684 / MZ :847. The awkward part kept deliberately: in battle every
   picture id is OFFSET by maxPictures(), so map picture 3 and battle picture 3
   are two different slots in one array. Since maxPictures() itself differs
   between the engines (100 on MV, project-configurable on MZ), the same
   pictureId lands on a different index on the two engines whenever a game
   raised the limit. Anything that walks _pictures by index must go through
   here, not guess. */
Game_Screen.prototype.realPictureId = function (pictureId) {
  if ($gameParty.inBattle()) {
    return pictureId + this.maxPictures();
  } else {
    return pictureId;
  }
};

/* MV :732 / MZ :895 */
Game_Screen.prototype.clearPictures = function () {
  this._pictures = [];
};

/* MV :736 / MZ :899 — slice(0, maxPictures() + 1), the off-by-one included:
   index 0 is unused, so keeping maxPictures()+1 entries keeps ids 1..max. */
Game_Screen.prototype.eraseBattlePictures = function () {
  this._pictures = this._pictures.slice(0, this.maxPictures() + 1);
};

/* MV :744 / MZ :911 — starting one direction ZEROES the other, so a fade-out
   interrupted by a fade-in does not leave two durations counting down. */
Game_Screen.prototype.startFadeOut = function (duration) {
  this._fadeOutDuration = duration;
  this._fadeInDuration = 0;
};
/* MV :749 / MZ :916 */
Game_Screen.prototype.startFadeIn = function (duration) {
  this._fadeInDuration = duration;
  this._fadeOutDuration = 0;
};

/* OVERRIDE — MV :797 / MZ :964. core.js:1192 calls five of the eight. The
   three it drops are the whole screen fade and the whole picture animation,
   so on that stub a picture shown with a duration never moves and brightness
   never changes. The __screenUpdates probe core.js hung here is kept. */
Game_Screen.prototype.update = function () {
  window.__screenUpdates = (window.__screenUpdates || 0) + 1;
  this.updateFadeOut();
  this.updateFadeIn();
  this.updateTone();
  this.updateFlash();
  this.updateShake();
  this.updateZoom();
  this.updateWeather();
  this.updatePictures();
};

/* MV :808 / MZ :975 — decays toward 0, never reaching it in `duration`
   frames on the way out because the last step is (b*(d-1))/d with d === 1. */
Game_Screen.prototype.updateFadeOut = function () {
  if (this._fadeOutDuration > 0) {
    var d = this._fadeOutDuration;
    this._brightness = (this._brightness * (d - 1)) / d;
    this._fadeOutDuration--;
  }
};
/* MV :816 / MZ :983 */
Game_Screen.prototype.updateFadeIn = function () {
  if (this._fadeInDuration > 0) {
    var d = this._fadeInDuration;
    this._brightness = (this._brightness * (d - 1) + 255) / d;
    this._fadeInDuration--;
  }
};

/* OVERRIDE — MV :842 / MZ :1009. core.js:1206 is a square wave that never
   reads _shakeDirection even though clearShake initialises it. The engine
   runs an oscillator: it accumulates `delta`, flips direction once |_shake|
   passes 2*_shakePower, and only snaps to 0 on the last frame if that frame
   would cross zero. Two consequences a square-wave stub hides — _shake
   OVERSHOOTS _shakePower (up to about 2x), and _shake keeps moving for one
   frame after _shakeDuration hits 0 because the guard is `|| this._shake !== 0`. */
Game_Screen.prototype.updateShake = function () {
  if (this._shakeDuration > 0 || this._shake !== 0) {
    var delta = (this._shakePower * this._shakeSpeed * this._shakeDirection) / 10;
    if (this._shakeDuration <= 1 && this._shake * (this._shake + delta) < 0) {
      this._shake = 0;
    } else {
      this._shake += delta;
    }
    if (this._shake > this._shakePower * 2) {
      this._shakeDirection = -1;
    }
    if (this._shake < -this._shakePower * 2) {
      this._shakeDirection = 1;
    }
    this._shakeDuration--;
  }
};

/* MV :889 / MZ :1060 — the red damage flash, hard-coded on both. */
Game_Screen.prototype.startFlashForDamage = function () {
  this.startFlash([255, 0, 0, 128], 8);
};

/* MV :893 / MZ :1065 — same nine parameters on both, and both build a fresh
   Game_Picture rather than reusing the slot, so showPicture on a live id
   discards its move/tint/rotation state. */
Game_Screen.prototype.showPicture = function (pictureId, name, origin, x, y,
                                              scaleX, scaleY, opacity, blendMode) {
  var realPictureId = this.realPictureId(pictureId);
  var picture = new Game_Picture();
  picture.show(name, origin, x, y, scaleX, scaleY, opacity, blendMode);
  this._pictures[realPictureId] = picture;
};

/* MV :909 / MZ :1087 */
Game_Screen.prototype.rotatePicture = function (pictureId, speed) {
  var picture = this.picture(pictureId);
  if (picture) {
    picture.rotate(speed);
  }
};
/* MV :916 / MZ :1094 */
Game_Screen.prototype.tintPicture = function (pictureId, tone, duration) {
  var picture = this.picture(pictureId);
  if (picture) {
    picture.tint(tone, duration);
  }
};
/* MV :923 / MZ :1101 — writes null, not delete, so _pictures keeps its length
   and updatePictures still visits the slot. */
Game_Screen.prototype.erasePicture = function (pictureId) {
  var realPictureId = this.realPictureId(pictureId);
  this._pictures[realPictureId] = null;
};

/* -------------------------------------------------------------------------
   Game_Picture — MV rpg_objects.js:933-1097 / MZ rmmz_objects.js:1111-1317.

   Shared here; the four members that diverge are in the per-engine files:
     initTarget, move, updateMove   (MZ added easing)
     erase                          (MV HAS it, MZ DELETED it)
   ---------------------------------------------------------------------- */
function Game_Picture() {
  this.initialize.apply(this, arguments);
}
/* MV :937 / MZ :1115 — four inits, and show()/erase() call three of them
   again. initBasic is the one they do NOT re-call, which is why show() has to
   assign the eight basic fields itself. */
Game_Picture.prototype.initialize = function () {
  this.initBasic();
  this.initTarget();
  this.initTone();
  this.initRotation();
};
/* MV :944-982 / MZ :1122-1160 — plain getters, identical on both. */
Game_Picture.prototype.name = function () { return this._name; };
Game_Picture.prototype.origin = function () { return this._origin; };
Game_Picture.prototype.x = function () { return this._x; };
Game_Picture.prototype.y = function () { return this._y; };
Game_Picture.prototype.scaleX = function () { return this._scaleX; };
Game_Picture.prototype.scaleY = function () { return this._scaleY; };
Game_Picture.prototype.opacity = function () { return this._opacity; };
Game_Picture.prototype.blendMode = function () { return this._blendMode; };
Game_Picture.prototype.tone = function () { return this._tone; };
Game_Picture.prototype.angle = function () { return this._angle; };
/* MV :984 / MZ :1162 — scale is in PERCENT (100 = 1x), opacity in 0-255. */
Game_Picture.prototype.initBasic = function () {
  this._name = '';
  this._origin = 0;
  this._x = 0;
  this._y = 0;
  this._scaleX = 100;
  this._scaleY = 100;
  this._opacity = 255;
  this._blendMode = 0;
};
/* MV :1004 / MZ :1185 — _tone starts NULL, not [0,0,0,0]. tint() is what
   creates the array, so anything reading picture.tone() before a tint gets
   null and `tone[0]` throws. Kept exactly. */
Game_Picture.prototype.initTone = function () {
  this._tone = null;
  this._toneTarget = null;
  this._toneDuration = 0;
};
/* MV :1010 / MZ :1191 */
Game_Picture.prototype.initRotation = function () {
  this._angle = 0;
  this._rotationSpeed = 0;
};
/* MV :1015 / MZ :1197 — identical on both, including that it re-runs
   initTarget/initTone/initRotation AFTER assigning the basics, which is what
   makes the target fields track the new position. */
Game_Picture.prototype.show = function (name, origin, x, y, scaleX,
                                        scaleY, opacity, blendMode) {
  this._name = name;
  this._origin = origin;
  this._x = x;
  this._y = y;
  this._scaleX = scaleX;
  this._scaleY = scaleY;
  this._opacity = opacity;
  this._blendMode = blendMode;
  this.initTarget();
  this.initTone();
  this.initRotation();
};
/* MV :1042 / MZ :1230 */
Game_Picture.prototype.rotate = function (speed) {
  this._rotationSpeed = speed;
};
/* MV :1046 / MZ :1234 — creates _tone lazily, then clones. tone.clone() is
   the engine's own Array extension (core.js:109), so an object literal or a
   typed array thrown at tintPicture dies inside the engine, not at the call. */
Game_Picture.prototype.tint = function (tone, duration) {
  if (!this._tone) {
    this._tone = [0, 0, 0, 0];
  }
  this._toneTarget = tone.clone();
  this._toneDuration = duration;
  if (this._toneDuration === 0) {
    this._tone = this._toneTarget.clone();
  }
};
/* MV :1065 / MZ :1245 */
Game_Picture.prototype.update = function () {
  this.updateMove();
  this.updateTone();
  this.updateRotation();
};
/* MV :1083 / MZ :1262 — linear on BOTH; MZ's easing applies to movement
   only, never to tone. */
Game_Picture.prototype.updateTone = function () {
  if (this._toneDuration > 0) {
    var d = this._toneDuration;
    for (var i = 0; i < 4; i++) {
      this._tone[i] = (this._tone[i] * (d - 1) + this._toneTarget[i]) / d;
    }
    this._toneDuration--;
  }
};
/* MV :1093 / MZ :1272 — speed/2 degrees per frame, and it never wraps, so
   _angle grows without bound on a spinning picture. */
Game_Picture.prototype.updateRotation = function () {
  if (this._rotationSpeed !== 0) {
    this._angle += this._rotationSpeed / 2;
  }
};

/* -------------------------------------------------------------------------
   Sprite_Picture — MV rpg_sprites.js:1903-1996 / MZ rmmz_sprites.js:2887-2979.

   Defined here so createPictures has something to build, but its BASE CLASS
   differs and is wired per engine: MV extends Sprite (:1907) and sets
   `this._isPicture = true` (:1913) to pick PIXI's heavy renderer; MZ extends
   Sprite_Clickable (:2891) and has no _isPicture at all, so on MZ every
   picture is a touch target. initialize is therefore per engine too.
   ---------------------------------------------------------------------- */
function Sprite_Picture() {
  this.initialize.apply(this, arguments);
}
/* MV :1918 / MZ :2901 */
Sprite_Picture.prototype.picture = function () {
  return $gameScreen.picture(this._pictureId);
};
/* MV :1934 / MZ :2917 — byte-identical. The visible flag is driven from
   whether the slot holds a Game_Picture at all, which is what makes
   erasePicture(id) hide the sprite without destroying it. */
Sprite_Picture.prototype.updateBitmap = function () {
  var picture = this.picture();
  if (picture) {
    var pictureName = picture.name();
    if (this._pictureName !== pictureName) {
      this._pictureName = pictureName;
      this.loadBitmap();
    }
    this.visible = true;
  } else {
    this._pictureName = '';
    this.bitmap = null;
    this.visible = false;
  }
};
/* MV :1989 / MZ :2972 — one line on both, but NOT the same one line: MV's
   ImageManager.loadPicture takes (filename, hue) (rpg_managers.js:831) and
   MZ's takes (filename) only (rmmz_managers.js:935). Sprite_Picture passes a
   single argument on both, so the hue is always the default here — but a mod
   that calls loadPicture with a hue gets it on MV and drops it on MZ. */
Sprite_Picture.prototype.loadBitmap = function () {
  this.bitmap = ImageManager.loadPicture(this._pictureName);
};
/* MV :1950-1988 / MZ :2933-2971 — updateOrigin, updatePosition, updateScale,
   updateTone and updateOther copy Game_Picture's fields onto anchor, x/y,
   scale, colour tone, blend mode and rotation. They write PIXI transform
   state the harness has no renderer for and nothing outside the renderer
   reads back, so they are recorded rather than simulated. update() itself is
   per engine, because the base-class call at the top of it differs (Sprite on
   MV; Sprite_Clickable on MZ, which adds processTouch). */
Sprite_Picture.prototype.updateOrigin = function () { };
Sprite_Picture.prototype.updatePosition = function () { };
Sprite_Picture.prototype.updateScale = function () { };
Sprite_Picture.prototype.updateTone = function () { };
Sprite_Picture.prototype.updateOther = function () { };

/* Sprite_Timer — MV rpg_sprites.js:1998 / MZ rmmz_sprites.js:2981. Shape
   only; it exists because createUpperLayer builds one on both engines and the
   mod's overlay counts the spriteset's children. Its own drawing is the
   timer's business, not the screen's. */
function Sprite_Timer() {
  this.initialize.apply(this, arguments);
}
/* MV :2002 / MZ :2985 — `Sprite_Timer.prototype = Object.create(Sprite.prototype)`
   on both. Linked rather than copied, as core.js:1297 does for the battlers. */
Object.setPrototypeOf(Sprite_Timer.prototype, Sprite.prototype);
/* MV :2005 / MZ :2988 */
Sprite_Timer.prototype.initialize = function () {
  Sprite.prototype.initialize.call(this);
  this._seconds = 0;
  this.createBitmap();
  this.update();
};
/* MV :2012 / MZ :3000 — MV's is Bitmap(96, 48) with fontSize 32; MZ's is
   Bitmap(96, 48) too but takes its face from $gameSystem.numberFontFace().
   The face is engine-mz.js's business; the size is the same on both. */
Sprite_Timer.prototype.createBitmap = function () {
  this.bitmap = new Bitmap(96, 48);
  this.bitmap.fontSize = 32;
};
Sprite_Timer.prototype.update = function () {
  window.__timerSpriteUpdates = (window.__timerSpriteUpdates || 0) + 1;
};

/* -------------------------------------------------------------------------
   Spriteset — the shared seams.

   core.js:1348 declares `function Spriteset_Base() { }` with a bare Object
   prototype, so nothing of Sprite reaches it. Both engines really do write
   `Spriteset_Base.prototype = Object.create(Sprite.prototype)` (MV
   rpg_sprites.js:2120 / MZ rmmz_sprites.js:3125), and updatePosition below
   writes `this.scale.x` — a field that only exists on that chain. The link is
   made the way core.js:1297 makes the Game_Battler one: the REAL prototype
   chain, not copies, so a patch to Sprite.prototype reaches the spriteset.
   core.js's own members on Spriteset_Base.prototype (createUpperLayer's
   __upperLayers probe, update) are own properties and keep winning.
   ---------------------------------------------------------------------- */
Object.setPrototypeOf(Spriteset_Base.prototype, Sprite.prototype);

/* MV rpg_sprites.js:2238 / MZ rmmz_sprites.js:3215 — byte-identical, and the
   only place the screen's zoom and shake reach the display list. Both round:
   zoom offset and shake are integer pixels, so a shake of 0.4 shows nothing.
   Shake is added to x AFTER the zoom offset, never scaled by it. */
Spriteset_Base.prototype.updatePosition = function () {
  var screen = $gameScreen;
  var scale = screen.zoomScale();
  this.scale.x = scale;
  this.scale.y = scale;
  this.x = Math.round(-screen.zoomX() * (scale - 1));
  this.y = Math.round(-screen.zoomY() * (scale - 1));
  this.x += Math.round(screen.shake());
};

/* MV rpg_sprites.js:2361 / MZ rmmz_sprites.js:3461 — byte-identical. The
   weather goes in as a plain child of the spriteset, ABOVE the tilemap and
   below whatever createUpperLayer adds. */
Spriteset_Map.prototype.createWeather = function () {
  this._weather = new Weather();
  this.addChild(this._weather);
};

/* MV rpg_sprites.js:2412 / MZ rmmz_sprites.js:3496 — byte-identical. This is
   the whole of the engine's weather binding: three fields copied from
   $gameScreen and the map scroll, every frame, with no change detection. */
Spriteset_Map.prototype.updateWeather = function () {
  this._weather.type = $gameScreen.weatherType();
  this._weather.power = $gameScreen.weatherPower();
  this._weather.origin.x = $gameMap.displayX() * $gameMap.tileWidth();
  this._weather.origin.y = $gameMap.displayY() * $gameMap.tileHeight();
};

/* -------------------------------------------------------------------------
   Scene_Base fade — the two constants both engines share.

   Everything else about the fade is per engine and deliberately NOT flattened
   here: MV drives a ScreenSprite child, MZ drives a ColorFilter on the scene
   itself, and the field names do not overlap (MV _fadeSprite; MZ _fadeWhite,
   _fadeOpacity, _colorFilter). See x-screen-mv.js / x-screen-mz.js.
   ---------------------------------------------------------------------- */
/* MV rpg_scenes.js:315 / MZ rmmz_scenes.js:152 */
Scene_Base.prototype.fadeSpeed = function () {
  return 24;
};
/* MV rpg_scenes.js:327 / MZ rmmz_scenes.js:156 */
Scene_Base.prototype.slowFadeSpeed = function () {
  return this.fadeSpeed() * 2;
};
