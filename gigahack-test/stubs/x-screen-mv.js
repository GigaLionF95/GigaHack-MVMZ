/* =============================================================================
   GigaHack test harness — stubs/x-screen-mv.js
   THE SCREEN AND PICTURES: the MV-only half.
   Modelled on MV rpg_core.js, rpg_objects.js, rpg_scenes.js and
   rpg_sprites.js (MV 1.6.1, PIXI 4.5.4). Nothing here is written from memory.

   Loaded IMMEDIATELY AFTER engine-mv.js. x-screen.js has already installed
   everything the two engines agree on; this file installs only what MV does
   differently, and each divergence is called out where it is defined.

   The four that matter most, in the order the mod meets them:

     1. Scene_Base's fade is a SPRITE. `_fadeSprite` is a real ScreenSprite
        child of the scene, created lazily by createFadeSprite and driven by
        writing its opacity. MZ has no such field — it fades through a filter.
        A mod that reads scene._fadeSprite gets an object here and undefined
        there; a mod that reads scene._fadeOpacity gets the reverse.
     2. Spriteset_Base.createUpperLayer ADDS CHILDREN — _flashSprite and
        _fadeSprite (rpg_sprites.js:2200-2205). That is why appending an
        overlay to the MV spriteset puts it ABOVE the screen fade and the
        screen flash, the exact z-order bug MV-MZ-DELTA.md §C.16 describes and
        the mod's attachIndex feature-detects.
     3. The live screen tone is applied to `_baseSprite`, not to the spriteset:
        a ToneFilter in `_baseSprite.filters` under WebGL, or a ToneSprite
        CHILD under canvas. MZ's field is `_baseColorFilter`. Different name,
        different object, different owner.
     4. maxPictures() is the constant 100. MZ reads it out of the project.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Utils helpers that exist ONLY on MV. Both are grepped for zero hits in
   rmmz_core.js. ScreenSprite.setColor below calls rgbToCssColor and
   Scene_Base.initialize calls generateRuntimeId, so a port that shares either
   body between the engines dies on MZ at the first fade.
   ---------------------------------------------------------------------- */
/* rpg_core.js:278 */
Utils.rgbToCssColor = function (r, g, b) {
  r = Math.round(r);
  g = Math.round(g);
  b = Math.round(b);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
};
/* rpg_core.js:285 / :286 — the id MV stamps on every scene for its image
   reservation system, which MZ deleted along with the reservation system. */
Utils._id = 1;
Utils.generateRuntimeId = function () {
  return Utils._id++;
};

/* -------------------------------------------------------------------------
   ScreenSprite, MV's half. rpg_core.js:6232.

   The rectangle is sized off Graphics — ten screens wide and ten tall,
   centred — so that a zoomed-in spriteset still finds black under it. MZ
   hard-codes 100000x100000 instead. And MV keeps `_colorText`, a CSS string
   nothing in the engine reads back; MZ dropped both the field and the helper.
   ---------------------------------------------------------------------- */
ScreenSprite.prototype.setColor = function (r, g, b) {
  /* The dirty test compares the RAW arguments against the stored channels,
     which are already rounded and clamped. So setColor(0.4, 0, 0) on a black
     sprite is "different" and repaints, even though the rounded answer is the
     same black it already had. Identical on both engines. */
  if (this._red === r && this._green === g && this._blue === b) {
    return;
  }
  /* `v || 0` swallows undefined, null and NaN before the round. */
  function channel(v) {
    return Math.round(v || 0).clamp(0, 255);
  }
  this._red = channel(r);
  this._green = channel(g);
  this._blue = channel(b);
  /* MV-ONLY: a CSS string the engine never reads back, kept because a mod can
     read it and because MZ genuinely has no such field. */
  this._colorText = Utils.rgbToCssColor(this._red, this._green, this._blue);

  var gfx = this._graphics;
  gfx.clear();
  gfx.beginFill((this._red << 16) | (this._green << 8) | this._blue, 1);
  /* "whole screen with zoom. BWAHAHAHAHA" is the engine's own comment on the
     next line. The rectangle is ten screens across and ten down, centred on
     the origin, so a zoomed-in spriteset still finds black underneath it.
     MZ draws a flat 100000x100000 and never consults Graphics. */
  gfx.drawRect(-Graphics.width * 5, -Graphics.height * 5,
               Graphics.width * 10, Graphics.height * 10);
};

/* rpg_core.js:6176-6215 — MV-ONLY compatibility shims for an old third-party
   core plugin, and they are kept because they are booby-trapped. `anchor` is
   a GETTER that MUTATES: reading screenSprite.anchor resets scale to 1,1 and
   returns a throwaway {x:0,y:0}. Its SETTER does not set an anchor at all —
   it writes alpha, a copy-paste of the opacity setter. MZ has neither
   accessor, so on MZ `sprite.anchor = 0.5` is an inert own-property write and
   on MV it silently makes the sprite invisible. */
ScreenSprite.YEPWarned = false;
ScreenSprite.warnYep = function () {
  if (!ScreenSprite.YEPWarned) {
    window.__yepWarned = (window.__yepWarned || 0) + 1;
    ScreenSprite.YEPWarned = true;
  }
};
Object.defineProperty(ScreenSprite.prototype, 'anchor', {
  get: function () {
    ScreenSprite.warnYep();
    this.scale.x = 1;
    this.scale.y = 1;
    return { x: 0, y: 0 };
  },
  set: function (value) {
    this.alpha = value.clamp(0, 255) / 255;
  },
  configurable: true
});
/* rpg_core.js:6196 — blendMode forwards to the inner PIXI.Graphics, because
   a ScreenSprite is a Container with graphics inside rather than a Sprite. */
Object.defineProperty(ScreenSprite.prototype, 'blendMode', {
  get: function () {
    return this._graphics.blendMode;
  },
  set: function (value) {
    this._graphics.blendMode = value;
  },
  configurable: true
});

/* -------------------------------------------------------------------------
   The MV tone pipeline: PIXI.filters.ColorMatrixFilter -> ToneFilter, plus
   the canvas-mode ToneSprite.

   PIXI.filters.ColorMatrixFilter is PixiJS 4.5.4 library code, NOT engine
   source, so it is a recorder of the same shape rather than a copy: the four
   members ToneFilter and the spriteset actually call (reset, hue, saturate,
   _loadMatrix) with the same signatures and the same multiply flag, and the
   resulting matrix kept where a check can read it. MZ has no such class in
   its filter chain at all — PIXI 5 dropped it from the engine's use and MZ
   ships its own ColorFilter shader instead.
   ---------------------------------------------------------------------- */
PIXI.filters = {
  ColorMatrixFilter: function () {
    this.matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
    this.calls = [];
  }
};
PIXI.filters.ColorMatrixFilter.prototype.reset = function () {
  this.matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  this.calls.push(['reset']);
};
PIXI.filters.ColorMatrixFilter.prototype._loadMatrix = function (matrix, multiply) {
  this.matrix = matrix;
  this.calls.push(['_loadMatrix', matrix, !!multiply]);
};
PIXI.filters.ColorMatrixFilter.prototype.hue = function (rotation, multiply) {
  this.calls.push(['hue', rotation, !!multiply]);
};
PIXI.filters.ColorMatrixFilter.prototype.saturate = function (amount, multiply) {
  this.calls.push(['saturate', amount, !!multiply]);
};

/* rpg_core.js:7443 */
function ToneFilter() {
  PIXI.filters.ColorMatrixFilter.call(this);
}
ToneFilter.prototype = Object.create(PIXI.filters.ColorMatrixFilter.prototype);
ToneFilter.prototype.constructor = ToneFilter;
/* rpg_core.js:7456 */
ToneFilter.prototype.adjustHue = function (value) {
  this.hue(value, true);
};
/* rpg_core.js:7466 — note the sign: the spriteset passes -tone[3], so a
   POSITIVE grey in $gameScreen.tone() is a NEGATIVE saturation here. */
ToneFilter.prototype.adjustSaturation = function (value) {
  value = (value || 0).clamp(-255, 255) / 255;
  this.saturate(value, true);
};
/* rpg_core.js:7479 — the awkward part kept: when r, g and b are ALL zero the
   matrix is never loaded, so clearing a tone back to [0,0,0,n] leaves the
   previous matrix in place and relies on the preceding reset() to undo it. */
ToneFilter.prototype.adjustTone = function (r, g, b) {
  /* Clamped to +-255 then scaled to +-1. Note there is NO rounding here,
     unlike ScreenSprite.setColor: a tone of 0.5 stays 0.5/255. */
  function unit(v) {
    return (v || 0).clamp(-255, 255) / 255;
  }
  var red = unit(r);
  var green = unit(g);
  var blue = unit(b);
  /* THE AWKWARD PART, kept: an all-zero tone loads NOTHING. Clearing a tone
     back to [0,0,0,n] therefore leaves whatever matrix was loaded last in
     place, and the only thing that actually undoes it is the reset() the
     spriteset calls first. Drop that reset and the tone never clears. */
  if (red === 0 && green === 0 && blue === 0) {
    return;
  }
  /* Rows 0-2 are identity plus a per-channel offset in the alpha column;
     row 3 leaves alpha alone. */
  this._loadMatrix([
    1, 0, 0, red, 0,
    0, 1, 0, green, 0,
    0, 0, 1, blue, 0,
    0, 0, 0, 1, 0
  ], true);
};

/* rpg_core.js:7503 — the CANVAS-mode tone. This one is a display object and
   becomes a CHILD of the spriteset (createCanvasToneChanger, :2177), i.e. one
   more sibling the mod's overlay has to reckon with, and it exists only when
   Graphics.isWebGL() is false. MZ has no canvas mode and no ToneSprite. */
function ToneSprite() {
  this.initialize.apply(this, arguments);
}
ToneSprite.prototype.initialize = function () {
  PIXI.Container.call(this);
  this.clear();
};
/* rpg_core.js:7520 */
ToneSprite.prototype.clear = function () {
  this._red = 0;
  this._green = 0;
  this._blue = 0;
  this._gray = 0;
};
/* rpg_core.js:7536 — gray clamps to (0, 255), the colours to (-255, 255). */
ToneSprite.prototype.setTone = function (r, g, b, gray) {
  this._red = Math.round(r || 0).clamp(-255, 255);
  this._green = Math.round(g || 0).clamp(-255, 255);
  this._blue = Math.round(b || 0).clamp(-255, 255);
  this._gray = Math.round(gray || 0).clamp(0, 255);
};
/* _renderCanvas (:7548) and _renderWebGL (:7597) are the actual paint and are
   left out: they take a PIXI renderer the harness does not have, and nothing
   outside the renderer reads them. */

/* -------------------------------------------------------------------------
   Game_Screen — the MV bodies.
   ---------------------------------------------------------------------- */
/* rpg_objects.js:740 — a CONSTANT. MZ's reads $dataSystem.advanced, so on MZ
   this number is whatever the project was built with and realPictureId's
   in-battle offset moves with it. Hard-coding 100 in shared code is the
   single easiest way to corrupt battle pictures on an MZ game. */
Game_Screen.prototype.maxPictures = function () {
  return 100;
};

/* rpg_objects.js:901 — NINE parameters. MZ's takes TEN: it appends
   `easingType` and forwards it. A call written for MZ and run here silently
   drops the easing argument; a call written for MV and run on MZ passes
   `undefined` for easingType, which calcEasing's default case treats as
   linear — so the MV->MZ direction degrades quietly and the MZ->MV direction
   loses a feature. Same method name, same object, different arity. */
Game_Screen.prototype.movePicture = function (pictureId, origin, x, y, scaleX,
                                              scaleY, opacity, blendMode, duration) {
  var picture = this.picture(pictureId);
  if (picture) {
    picture.move(origin, x, y, scaleX, scaleY, opacity, blendMode, duration);
  }
};

/* rpg_objects.js:881 — Array.prototype.forEach, which SKIPS HOLES. _pictures
   is genuinely sparse: clearPictures makes an empty array and showPicture
   assigns straight into index N, so ids 1..N-1 are holes. MV therefore never
   visits them. MZ iterates with for-of, which visits every index including
   the holes as `undefined`. Both guard with `if (picture)`, so the drawn
   result agrees — but the iteration count does not, and a mod that replaces
   updatePictures to count or to instrument pictures gets a different answer
   on each engine. __pictureSlotsVisited is the harness's probe for exactly
   that; it is not in the engine. */
Game_Screen.prototype.updatePictures = function () {
  this._pictures.forEach(function (picture) {
    window.__pictureSlotsVisited = (window.__pictureSlotsVisited || 0) + 1;
    if (picture) {
      picture.update();
    }
  });
};

/* -------------------------------------------------------------------------
   Game_Picture — the MV bodies. Three diverge, and MV has a fourth method MZ
   deleted outright.
   ---------------------------------------------------------------------- */
/* rpg_objects.js:995 — SIX fields. MZ's sets nine: it adds _wholeDuration,
   _easingType and _easingExponent. A save made on MZ and loaded by MV-shaped
   code carries three fields MV never reads; the reverse leaves MZ's
   applyEasing dividing by an undefined _wholeDuration, which is NaN. */
Game_Picture.prototype.initTarget = function () {
  this._targetX = this._x;
  this._targetY = this._y;
  this._targetScaleX = this._scaleX;
  this._targetScaleY = this._scaleY;
  this._targetOpacity = this._opacity;
  this._duration = 0;
};

/* rpg_objects.js:1030 — EIGHT parameters, no easing. */
Game_Picture.prototype.move = function (origin, x, y, scaleX, scaleY,
                                        opacity, blendMode, duration) {
  this._origin = origin;
  this._targetX = x;
  this._targetY = y;
  this._targetScaleX = scaleX;
  this._targetScaleY = scaleY;
  this._targetOpacity = opacity;
  this._blendMode = blendMode;
  this._duration = duration;
};

/* rpg_objects.js:1057 — MV-ONLY. Grep `Game_Picture.prototype.erase` in
   rmmz_objects.js: zero hits. MZ removed the method and erases through
   Game_Screen.erasePicture nulling the slot instead. So `picture.erase()` is
   a working call on MV and a TypeError on MZ, and any mod that offers "clear
   this picture but keep the object" has to branch. */
Game_Picture.prototype.erase = function () {
  this._name = '';
  this._origin = 0;
  this.initTarget();
  this.initTone();
  this.initRotation();
};

/* rpg_objects.js:1071 — LINEAR. Every field walks (cur*(d-1) + target)/d,
   the same shape as the screen's tone and zoom. MZ routes all five through
   applyEasing instead, so with easingType 0 the numbers agree and with any
   other easing type they do not. */
Game_Picture.prototype.updateMove = function () {
  if (!(this._duration > 0)) {
    return;
  }
  var d = this._duration;
  /* One frame of the linear walk, written once and applied five times. This
     is precisely where MZ substitutes applyEasing; the two agree exactly when
     MZ's easingType is 0 and diverge everywhere else. */
  function step(from, to) {
    return (from * (d - 1) + to) / d;
  }
  this._x = step(this._x, this._targetX);
  this._y = step(this._y, this._targetY);
  this._scaleX = step(this._scaleX, this._targetScaleX);
  this._scaleY = step(this._scaleY, this._targetScaleY);
  this._opacity = step(this._opacity, this._targetOpacity);
  this._duration--;
};

/* -------------------------------------------------------------------------
   Scene_Base fade — MV's mechanism: a ScreenSprite child.

   rpg_scenes.js:28, :189, :206, :221, :240, :136.

   The scene's own children are used, so the fade sprite is a real entry in
   scene.children and anything walking that list sees it. MZ's fade is a
   filter on the scene and adds NO child. core.js:269 declares Scene_Base as a
   bare constructor with no Stage base, so initialize seeds the container
   directly; on the engines that same line is Stage.prototype.initialize.call,
   and Stage's whole body is PIXI.Container.call(this) plus — on MV only —
   `this.interactive = false` (rpg_core.js:7615; MZ's Stage at
   rmmz_core.js:4665 does not set it).
   ---------------------------------------------------------------------- */
Scene_Base.prototype.initialize = function () {
  PIXI.Container.call(this);
  this.interactive = false;
  this._active = false;
  this._fadeSign = 0;
  this._fadeDuration = 0;
  this._fadeSprite = null;
  this._imageReservationId = Utils.generateRuntimeId();
};

/* rpg_scenes.js:189 — starts OPAQUE and decays to clear. */
Scene_Base.prototype.startFadeIn = function (duration, white) {
  this.createFadeSprite(white);
  this._fadeSign = 1;
  this._fadeDuration = duration || 30;
  this._fadeSprite.opacity = 255;
};
/* rpg_scenes.js:206 — starts CLEAR and grows to opaque. */
Scene_Base.prototype.startFadeOut = function (duration, white) {
  this.createFadeSprite(white);
  this._fadeSign = -1;
  this._fadeDuration = duration || 30;
  this._fadeSprite.opacity = 0;
};
/* rpg_scenes.js:221 — created ONCE and reused; the white/black choice is
   re-applied on every start, so a white fade-out followed by a black fade-in
   reuses the same child and only repaints it. MZ has no equivalent method. */
Scene_Base.prototype.createFadeSprite = function (white) {
  if (!this._fadeSprite) {
    this._fadeSprite = new ScreenSprite();
    this.addChild(this._fadeSprite);
  }
  if (white) {
    this._fadeSprite.setWhite();
  } else {
    this._fadeSprite.setBlack();
  }
};
/* rpg_scenes.js:240 — the arithmetic is the same as MZ's, but the value lives
   on the SPRITE (`_fadeSprite.opacity`, i.e. alpha*255) rather than in a
   plain `_fadeOpacity` number. Same curve, different address. */
Scene_Base.prototype.updateFade = function () {
  if (this._fadeDuration > 0) {
    var d = this._fadeDuration;
    if (this._fadeSign > 0) {
      this._fadeSprite.opacity -= this._fadeSprite.opacity / d;
    } else {
      this._fadeSprite.opacity += (255 - this._fadeSprite.opacity) / d;
    }
    this._fadeDuration--;
  }
};
/* rpg_scenes.js:136 — MV tests the duration DIRECTLY. MZ goes through
   isFading(), a method MV does not have at all (grep isFading in
   rpg_scenes.js: zero hits), which is the seam a mod would want to alias to
   make a scene look busy. core.js:273 flattens isBusy to `return false`;
   before initialize has run `undefined > 0` is still false, so nothing that
   relied on the flat version changes. */
Scene_Base.prototype.isBusy = function () {
  return this._fadeDuration > 0;
};

/* -------------------------------------------------------------------------
   Spriteset_Base / Spriteset_Map — MV's layer construction and tone path.
   rpg_sprites.js:2123-2251.

   createUpperLayer below REPLACES core.js:1349, which modelled it as a bare
   __upperLayers probe. That flattening removes the one thing the mod's
   overlay-position hook feature-detects — whether _flashSprite and _fadeSprite
   are CHILDREN — so the real body is restored and the probe increment is kept
   inside it, unchanged, so existing checks still see their counter.

   Spriteset_Base.prototype.update is NOT taken. MV's (rpg_sprites.js:2144)
   calls updateScreenSprites, updateToneChanger and updatePosition; core.js
   owns that method and hangs the __spritesetUpdates probe off Spriteset_Map's
   caller, so overriding it here would change what every other area's checks
   observe. The three per-frame methods are defined and a test drives them
   directly — or calls initialize(), which on the real engine is what the
   constructor always did and on this harness is an explicit step, because
   core.js:1351's constructor does not call it.
   ---------------------------------------------------------------------- */
/* rpg_sprites.js:2123 */
Spriteset_Base.prototype.initialize = function () {
  Sprite.prototype.initialize.call(this);
  this.setFrame(0, 0, Graphics.width, Graphics.height);
  this._tone = [0, 0, 0, 0];
  this.opaque = true;
  this.createLowerLayer();
  this.createToneChanger();
  this.createUpperLayer();
  this.update();
};
/* rpg_sprites.js:2134 — ONE call. MZ's adds createBaseFilters. */
Spriteset_Base.prototype.createLowerLayer = function () {
  this.createBaseSprite();
};
/* rpg_sprites.js:2151 — MV frames the base sprite; MZ does not. */
Spriteset_Base.prototype.createBaseSprite = function () {
  this._baseSprite = new Sprite();
  this._baseSprite.setFrame(0, 0, this.width, this.height);
  this._blackScreen = new ScreenSprite();
  this._blackScreen.opacity = 255;
  this.addChild(this._baseSprite);
  this._baseSprite.addChild(this._blackScreen);
};
/* rpg_sprites.js:2160 — a RENDERER BRANCH that MZ does not have. Which of the
   two tone mechanisms exists depends on Graphics.isWebGL(), decided at boot,
   so on MV the answer to "where is the screen tone" is not a constant. */
Spriteset_Base.prototype.createToneChanger = function () {
  if (Graphics.isWebGL()) {
    this.createWebGLToneChanger();
  } else {
    this.createCanvasToneChanger();
  }
};
/* rpg_sprites.js:2168 — the filter goes on _baseSprite, NOT on the spriteset,
   which is why an overlay added to the spriteset is NOT tinted on MV. The
   filterArea is a 48px-margin rectangle around the screen, and it clips
   everything in _baseSprite's subtree — including anything a mod adds under
   _battleField. MV-MZ-DELTA.md §C.16. */
Spriteset_Base.prototype.createWebGLToneChanger = function () {
  var margin = 48;
  var grown = margin * 2;   /* the margin is paid on BOTH sides of each axis */
  this._toneFilter = new ToneFilter();
  this._baseSprite.filters = [this._toneFilter];
  this._baseSprite.filterArea = new Rectangle(
    -margin, -margin, Graphics.width + grown, Graphics.height + grown);
};
/* rpg_sprites.js:2177 — canvas mode adds a CHILD to the spriteset instead. */
Spriteset_Base.prototype.createCanvasToneChanger = function () {
  this._toneSprite = new ToneSprite();
  this.addChild(this._toneSprite);
};
/* rpg_sprites.js:2138 — three calls, and the third is the one that matters. */
Spriteset_Base.prototype.createUpperLayer = function () {
  window.__upperLayers = (window.__upperLayers || 0) + 1;   /* core.js:1349's probe, kept */
  this.createPictures();
  this.createTimer();
  this.createScreenSprites();
};
/* rpg_sprites.js:2182 — the container is sized to the BOX and centred inside
   the screen, so pictures are letterboxed with the windows. MZ's covers the
   full screen instead (pictureContainerRect). Ids run 1..maxPictures, so
   there is no sprite for index 0. */
Spriteset_Base.prototype.createPictures = function () {
  this._pictureContainer = new Sprite();
  var container = this._pictureContainer;
  /* The frame is the BOX, centred in the screen — half the letterbox on each
     side. MZ passes pictureContainerRect() here, which covers the full
     screen, so the same picture lands on different pixels on the two engines
     whenever boxWidth < width. */
  container.setFrame(
    (Graphics.width - Graphics.boxWidth) / 2,
    (Graphics.height - Graphics.boxHeight) / 2,
    Graphics.boxWidth,
    Graphics.boxHeight
  );
  /* maxPictures() is re-read as the loop CONDITION, once per iteration, on
     both engines — not hoisted. Ids start at 1, so index 0 has no sprite. */
  for (var id = 1; id <= $gameScreen.maxPictures(); id++) {
    container.addChild(new Sprite_Picture(id));
  }
  this.addChild(container);
};
/* rpg_sprites.js:2195 */
Spriteset_Base.prototype.createTimer = function () {
  this._timerSprite = new Sprite_Timer();
  this.addChild(this._timerSprite);
};
/* rpg_sprites.js:2200 — THE MV-ONLY METHOD. Two ScreenSprite children,
   appended last, so they are the topmost things in the spriteset. MZ has no
   createScreenSprites and no _flashSprite/_fadeSprite anywhere. */
Spriteset_Base.prototype.createScreenSprites = function () {
  this._flashSprite = new ScreenSprite();
  this._fadeSprite = new ScreenSprite();
  this.addChild(this._flashSprite);
  this.addChild(this._fadeSprite);
};
/* rpg_sprites.js:2207 — flash colour and brightness are pushed into the two
   sprites every frame. MZ pushes the same two values into one ColorFilter's
   blendColor and brightness uniforms instead. */
Spriteset_Base.prototype.updateScreenSprites = function () {
  var color = $gameScreen.flashColor();
  this._flashSprite.setColor(color[0], color[1], color[2]);
  this._flashSprite.opacity = color[3];
  this._fadeSprite.opacity = 255 - $gameScreen.brightness();
};
/* rpg_sprites.js:2214 — MV CACHES: the filter is only touched when the tone
   array actually changed, using Array.prototype.equals (core.js:115). MZ
   re-pushes the tone unconditionally every frame. So on MV a mod that writes
   $gameScreen._tone in place, without changing the values, produces no update
   at all — and one that swaps the array for an equal one produces none either. */
Spriteset_Base.prototype.updateToneChanger = function () {
  var tone = $gameScreen.tone();
  if (!this._tone.equals(tone)) {
    this._tone = tone.clone();
    if (Graphics.isWebGL()) {
      this.updateWebGLToneChanger();
    } else {
      this.updateCanvasToneChanger();
    }
  }
};
/* rpg_sprites.js:2226 — reset THEN adjust, and saturation takes -tone[3]. */
Spriteset_Base.prototype.updateWebGLToneChanger = function () {
  var tone = this._tone;
  this._toneFilter.reset();
  this._toneFilter.adjustTone(tone[0], tone[1], tone[2]);
  this._toneFilter.adjustSaturation(-tone[3]);
};
/* rpg_sprites.js:2233 — canvas mode passes tone[3] straight through, NOT
   negated. The two renderers do not agree with each other on MV. */
Spriteset_Base.prototype.updateCanvasToneChanger = function () {
  var tone = this._tone;
  this._toneSprite.setTone(tone[0], tone[1], tone[2], tone[3]);
};

/* -------------------------------------------------------------------------
   Sprite_Picture's base class, MV side. rpg_sprites.js:1907-1916.

   MV extends Sprite and sets `_isPicture = true`, a flag MV's own Sprite
   reads to pick PIXI 4's heavy renderer (rpg_core.js:3973). MZ extends
   Sprite_Clickable and has no such flag. The chain is linked rather than
   copied for the reason core.js:1297 gives.
   ---------------------------------------------------------------------- */
Object.setPrototypeOf(Sprite_Picture.prototype, Sprite.prototype);
/* rpg_sprites.js:1910 */
Sprite_Picture.prototype.initialize = function (pictureId) {
  Sprite.prototype.initialize.call(this);
  this._pictureId = pictureId;
  this._pictureName = '';
  this._isPicture = true;
  this.update();
};
/* rpg_sprites.js:1922 — the base call is Sprite's, which does nothing but
   walk children. MZ's is Sprite_Clickable's, which also runs processTouch, so
   an MZ picture costs a touch test per frame and an MV picture does not. */
Sprite_Picture.prototype.update = function () {
  Sprite.prototype.update.call(this);
  this.updateBitmap();
  if (this.visible) {
    this.updateOrigin();
    this.updatePosition();
    this.updateScale();
    this.updateTone();
    this.updateOther();
  }
  window.__pictureSpriteUpdates = (window.__pictureSpriteUpdates || 0) + 1;
};
