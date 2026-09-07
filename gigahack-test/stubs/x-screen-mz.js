/* =============================================================================
   GigaHack test harness — stubs/x-screen-mz.js
   THE SCREEN AND PICTURES: the MZ-only half.
   Modelled on MZ rmmz_core.js, rmmz_objects.js, rmmz_scenes.js
   and rmmz_sprites.js (MZ 1.9.0, PIXI 5.3.12). Nothing here is from memory.

   Loaded IMMEDIATELY AFTER engine-mz.js. x-screen.js has already installed
   everything the two engines agree on; this file installs only what MZ does
   differently, and each divergence is called out where it is defined.

   The four that matter most, in the order the mod meets them:

     1. Scene_Base's fade is a FILTER. There is no fade sprite anywhere. The
        scene owns a ColorFilter (createColorFilter, rmmz_scenes.js:103) and
        the fade is a number, `_fadeOpacity`, pushed into that filter's
        blendColor uniform. MV's `_fadeSprite` does not exist here, and MZ's
        `_fadeWhite`/`_fadeOpacity`/`_colorFilter` do not exist there.
     2. Spriteset_Base.createUpperLayer ADDS NO CHILDREN for the screen
        effects — createOverallFilters (rmmz_sprites.js:3198) sets
        `this.filters` on the spriteset itself. So appending an overlay to the
        MZ spriteset is CORRECT z-order, and the overlay is tinted and faded
        along with the rest of the scene. MV-MZ-DELTA.md §C.16.
     3. The live screen tone is `_baseColorFilter` on `_baseSprite`, and it is
        re-pushed every frame with no change detection. MV's is `_toneFilter`
        (WebGL) or `_toneSprite` (canvas), and MV only touches it when the
        tone array actually changed.
     4. maxPictures() reads $dataSystem.advanced.picturesUpperLimit. It is
        NOT 100 unless the project says so, and realPictureId's in-battle
        offset moves with it.
   ========================================================================== */

/* -------------------------------------------------------------------------
   PIXI.Filter and ColorFilter — rmmz_core.js:4507-4600.

   PIXI.Filter is PixiJS 5 library code, NOT engine source, so it is a
   recorder of the same shape: the constructor takes (vertexSrc, fragmentSrc)
   and exposes `uniforms`, which is the only surface ColorFilter uses and the
   only one a check can read back. The 40-line GLSL in _fragmentSrc (:4564) is
   left out — it is a shader string with no observable behaviour off a GPU —
   and replaced by a marker of the same type, so `new ColorFilter()` still
   passes a string where the engine passes one.

   MV has NO ColorFilter. Its filter chain is PIXI.filters.ColorMatrixFilter
   through ToneFilter (x-screen-mv.js), a different class with a different
   API: adjustTone/adjustSaturation versus setColorTone/setBlendColor/
   setBrightness. Nothing written against one works against the other.
   ---------------------------------------------------------------------- */
PIXI.Filter = function (vertexSrc, fragmentSrc) {
  this.vertexSrc = vertexSrc || null;
  this.fragmentSrc = fragmentSrc || null;
  this.uniforms = {};
};

/* rmmz_core.js:4507 */
function ColorFilter() {
  this.initialize.apply(this, arguments);
}
ColorFilter.prototype = Object.create(PIXI.Filter.prototype);
ColorFilter.prototype.constructor = ColorFilter;
/* rmmz_core.js:4514 — the four uniforms are the WHOLE of MZ's screen colour
   model: hue, colorTone, blendColor, brightness. brightness starts at 255,
   i.e. "no darkening", which is why $gameScreen.brightness() can be pushed
   into it unscaled. */
ColorFilter.prototype.initialize = function () {
  PIXI.Filter.call(this, null, this._fragmentSrc());
  this.uniforms.hue = 0;
  this.uniforms.colorTone = [0, 0, 0, 0];
  this.uniforms.blendColor = [0, 0, 0, 0];
  this.uniforms.brightness = 255;
};
/* rmmz_core.js:4527 */
ColorFilter.prototype.setHue = function (hue) {
  this.uniforms.hue = Number(hue);
};
/* rmmz_core.js:4536 — THROWS on a non-Array. The spriteset hands it
   $gameScreen.tone() directly every frame, so a mod that replaces _tone with
   anything array-like but not an Array takes the whole map scene down. MV's
   updateToneChanger calls tone.equals(...) instead, which fails differently. */
ColorFilter.prototype.setColorTone = function (tone) {
  if (!(tone instanceof Array)) {
    throw new Error('Argument must be an array');
  }
  this.uniforms.colorTone = tone.clone();
};
/* rmmz_core.js:4548 — same instanceof check, same throw. */
ColorFilter.prototype.setBlendColor = function (color) {
  if (!(color instanceof Array)) {
    throw new Error('Argument must be an array');
  }
  this.uniforms.blendColor = color.clone();
};
/* rmmz_core.js:4560 */
ColorFilter.prototype.setBrightness = function (brightness) {
  this.uniforms.brightness = Number(brightness);
};
/* rmmz_core.js:4564 — the GLSL, omitted; see the header note. */
ColorFilter.prototype._fragmentSrc = function () {
  return '/* ColorFilter fragment shader — omitted, no observable off a GPU */';
};

/* -------------------------------------------------------------------------
   ScreenSprite, MZ's half. rmmz_core.js:3471.

   The rectangle is a hard-coded 100000x100000 centred on the origin; MV sizes
   its rectangle off Graphics instead. And MZ keeps no `_colorText` — the
   helper that produced it, Utils.rgbToCssColor, does not exist on MZ at all
   (grep rmmz_core.js: zero hits).
   ---------------------------------------------------------------------- */
ScreenSprite.prototype.setColor = function (r, g, b) {
  /* The dirty test compares the RAW arguments against the stored channels,
     which are already rounded and clamped — so setColor(0.4, 0, 0) on a black
     sprite still repaints. Identical to MV's test; everything after it is not. */
  if (this._red === r && this._green === g && this._blue === b) {
    return;
  }
  function channel(v) {
    return Math.round(v || 0).clamp(0, 255);
  }
  this._red = channel(r);
  this._green = channel(g);
  this._blue = channel(b);
  /* NO _colorText here: MZ dropped the field with the helper that made it. */
  var gfx = this._graphics;
  gfx.clear();
  gfx.beginFill((this._red << 16) | (this._green << 8) | this._blue, 1);
  /* A flat 100000-square centred on the origin, big enough for any zoom.
     MV derives the same rectangle from Graphics instead. */
  gfx.drawRect(-50000, -50000, 100000, 100000);
};
/* rmmz_core.js:3445 — MZ-only; MV's ScreenSprite has no destroy override. */
ScreenSprite.prototype.destroy = function () {
  var options = { children: true, texture: true };
  PIXI.Container.prototype.destroy.call(this, options);
};

/* rmmz_core.js:4392 — MZ-only; MV's Weather has no destroy, so MV leaks the
   three weather bitmaps on every map change and MZ does not. */
Weather.prototype.destroy = function () {
  var options = { children: true, texture: true };
  PIXI.Container.prototype.destroy.call(this, options);
  this._rainBitmap.destroy();
  this._stormBitmap.destroy();
  this._snowBitmap.destroy();
};

/* -------------------------------------------------------------------------
   Game_Screen — the MZ bodies.
   ---------------------------------------------------------------------- */
/* rmmz_objects.js:903 — reads the PROJECT, not a constant. MV returns a flat
   100. Two consequences: the number of Sprite_Picture children the spriteset
   builds is project-dependent, and realPictureId's in-battle offset is too,
   so battle picture 1 is index 101 on a default project and index 201 on one
   that raised the limit to 200. Note the `in` test, not a truthiness test —
   a project that set the limit to 0 gets 0, not 100. */
Game_Screen.prototype.maxPictures = function () {
  if ('picturesUpperLimit' in $dataSystem.advanced) {
    return $dataSystem.advanced.picturesUpperLimit;
  } else {
    return 100;
  }
};

/* rmmz_objects.js:1075 — TEN parameters. MV's takes NINE and has no
   easingType. The extra argument is forwarded straight into Game_Picture.move,
   which is where it turns into _easingType and changes how updateMove
   interpolates. Same method name, same object, different arity. */
Game_Screen.prototype.movePicture = function (pictureId, origin, x, y, scaleX,
                                              scaleY, opacity, blendMode, duration,
                                              easingType) {
  var picture = this.picture(pictureId);
  if (picture) {
    picture.move(origin, x, y, scaleX, scaleY, opacity, blendMode,
                 duration, easingType);
  }
};

/* rmmz_objects.js:1052 — `for (const picture of this._pictures)`, which
   VISITS HOLES. _pictures is sparse (clearPictures makes an empty array and
   showPicture assigns straight into index N), so MZ walks every index from 0
   to length-1 and sees `undefined` for the gaps; MV's forEach skips them
   entirely. The `if (picture)` guard means the drawn result agrees, but the
   iteration count does not — a mod that instruments or counts through
   updatePictures gets a different answer on each engine. Written as an index
   loop because the harness is ES5 and for-of is not; the semantics kept are
   the ones that differ, namely that the holes ARE visited.
   __pictureSlotsVisited is the harness's probe for that; not in the engine. */
Game_Screen.prototype.updatePictures = function () {
  for (var i = 0; i < this._pictures.length; i++) {
    var picture = this._pictures[i];
    window.__pictureSlotsVisited = (window.__pictureSlotsVisited || 0) + 1;
    if (picture) {
      picture.update();
    }
  }
};

/* -------------------------------------------------------------------------
   Game_Picture — the MZ bodies. Three diverge, and MZ adds a whole easing
   family MV does not have. MZ also DELETED Game_Picture.prototype.erase,
   which MV still has (x-screen-mv.js) — grep it in rmmz_objects.js for zero
   hits. So `picture.erase()` is a TypeError here.
   ---------------------------------------------------------------------- */
/* rmmz_objects.js:1173 — NINE fields. MV's sets six; the three extra are
   what applyEasing needs. _wholeDuration is set here to 0, so a picture that
   has never been moved would divide by zero in applyEasing — it does not,
   only because updateMove gates on _duration > 0 and move() sets both. */
Game_Picture.prototype.initTarget = function () {
  this._targetX = this._x;
  this._targetY = this._y;
  this._targetScaleX = this._scaleX;
  this._targetScaleY = this._scaleY;
  this._targetOpacity = this._opacity;
  this._duration = 0;
  this._wholeDuration = 0;
  this._easingType = 0;
  this._easingExponent = 0;
};

/* rmmz_objects.js:1214 — NINE parameters. Note _easingExponent is hard-coded
   to 2 here, not taken from the caller, so the only knob is the type. */
Game_Picture.prototype.move = function (origin, x, y, scaleX, scaleY,
                                        opacity, blendMode, duration, easingType) {
  this._origin = origin;
  this._targetX = x;
  this._targetY = y;
  this._targetScaleX = scaleX;
  this._targetScaleY = scaleY;
  this._targetOpacity = opacity;
  this._blendMode = blendMode;
  this._duration = duration;
  this._wholeDuration = duration;
  this._easingType = easingType;
  this._easingExponent = 2;
};

/* rmmz_objects.js:1251 — every field goes through applyEasing. MV's five
   lines are plain (cur*(d-1) + target)/d. With easingType 0 the two agree to
   the last bit; with 1, 2 or 3 they do not, and the divergence is largest in
   the middle of the move rather than at either end. */
Game_Picture.prototype.updateMove = function () {
  if (this._duration > 0) {
    this._x = this.applyEasing(this._x, this._targetX);
    this._y = this.applyEasing(this._y, this._targetY);
    this._scaleX = this.applyEasing(this._scaleX, this._targetScaleX);
    this._scaleY = this.applyEasing(this._scaleY, this._targetScaleY);
    this._opacity = this.applyEasing(this._opacity, this._targetOpacity);
    this._duration--;
  }
};

/* rmmz_objects.js:1278 — MZ-ONLY, and awkward on purpose: it back-solves the
   ORIGINAL start value from the current value and the easing curve every
   frame, rather than storing it. That means _wholeDuration must still hold
   the duration the move began with; anything that rewrites _duration without
   rewriting _wholeDuration makes `lt` wrong and the picture jumps. */
Game_Picture.prototype.applyEasing = function (current, target) {
  var whole = this._wholeDuration;
  var elapsed = whole - this._duration;      /* frames already spent */
  /* The curve is sampled TWICE: lt is where the move stands now, t is where
     it stands after this frame. Both go through calcEasing, in that order. */
  var lt = this.calcEasing(elapsed / whole);
  var t = this.calcEasing((elapsed + 1) / whole);
  /* Back-solve the value the move ORIGINALLY started from, rather than
     storing it: current === start + (target - start) * lt, rearranged. That
     is why _wholeDuration must keep the duration the move began with —
     rewrite _duration alone and lt is wrong and the picture jumps. */
  var start = (current - target * lt) / (1 - lt);
  return start + (target - start) * t;
};
/* rmmz_objects.js:1287 — the default case is LINEAR, which is what an
   undefined easingType (an MV-shaped 9-argument movePicture call) lands on. */
Game_Picture.prototype.calcEasing = function (t) {
  var exponent = this._easingExponent;
  switch (this._easingType) {
    case 1: // Slow start
      return this.easeIn(t, exponent);
    case 2: // Slow end
      return this.easeOut(t, exponent);
    case 3: // Slow start and end
      return this.easeInOut(t, exponent);
    default:
      return t;
  }
};
/* rmmz_objects.js:1301 / :1305 / :1309 — MZ-only, no MV counterpart. */
Game_Picture.prototype.easeIn = function (t, exponent) {
  return Math.pow(t, exponent);
};
Game_Picture.prototype.easeOut = function (t, exponent) {
  return 1 - Math.pow(1 - t, exponent);
};
Game_Picture.prototype.easeInOut = function (t, exponent) {
  if (t < 0.5) {
    return this.easeIn(t * 2, exponent) / 2;
  } else {
    return this.easeOut(t * 2 - 1, exponent) / 2 + 0.5;
  }
};

/* -------------------------------------------------------------------------
   Scene_Base fade — MZ's mechanism: a ColorFilter on the scene.

   rmmz_scenes.js:17, :87, :95, :103, :108, :114, :64, :68.

   No sprite is created and nothing is added to scene.children, so a mod that
   walks the scene's children looking for a fade finds nothing here. The fade
   is `_fadeOpacity`, a plain number, and updateColorFilter turns it into a
   blend colour whose RGB is 0 or 255 depending on `_fadeWhite`.
   core.js:269 declares Scene_Base as a bare constructor with no Stage base,
   so initialize seeds the container directly; on the engines that line is
   Stage.prototype.initialize.call, and MZ's Stage (rmmz_core.js:4665) is
   nothing but PIXI.Container.call(this) — MV's also sets `interactive = false`.
   ---------------------------------------------------------------------- */
Scene_Base.prototype.initialize = function () {
  PIXI.Container.call(this);
  this._started = false;
  this._active = false;
  this._fadeSign = 0;
  this._fadeDuration = 0;
  this._fadeWhite = 0;
  this._fadeOpacity = 0;
  this.createColorFilter();
};

/* rmmz_scenes.js:87 — note the extra call MV does not make: updateColorFilter
   runs IMMEDIATELY, so the first frame of a fade is already painted before
   any update loop turns. MV's startFadeIn just sets the sprite's opacity. */
Scene_Base.prototype.startFadeIn = function (duration, white) {
  this._fadeSign = 1;
  this._fadeDuration = duration || 30;
  this._fadeWhite = white;
  this._fadeOpacity = 255;
  this.updateColorFilter();
};
/* rmmz_scenes.js:95 */
Scene_Base.prototype.startFadeOut = function (duration, white) {
  this._fadeSign = -1;
  this._fadeDuration = duration || 30;
  this._fadeWhite = white;
  this._fadeOpacity = 0;
  this.updateColorFilter();
};
/* rmmz_scenes.js:103 — REPLACES this.filters wholesale, so a mod that put a
   filter on the scene before the scene initialised loses it. MV has no
   equivalent method and never touches Scene_Base.filters at all. */
Scene_Base.prototype.createColorFilter = function () {
  this._colorFilter = new ColorFilter();
  this.filters = [this._colorFilter];
};
/* rmmz_scenes.js:108 — white fades to [255,255,255,a], black to [0,0,0,a]. */
Scene_Base.prototype.updateColorFilter = function () {
  var c = this._fadeWhite ? 255 : 0;
  var blendColor = [c, c, c, this._fadeOpacity];
  this._colorFilter.setBlendColor(blendColor);
};
/* rmmz_scenes.js:114 — the same curve as MV's, applied to a NUMBER rather
   than to a sprite's alpha. Reading the fade back therefore means reading
   scene._fadeOpacity here and scene._fadeSprite.opacity there. */
Scene_Base.prototype.updateFade = function () {
  if (this._fadeDuration > 0) {
    var d = this._fadeDuration;
    if (this._fadeSign > 0) {
      this._fadeOpacity -= this._fadeOpacity / d;
    } else {
      this._fadeOpacity += (255 - this._fadeOpacity) / d;
    }
    this._fadeDuration--;
  }
};
/* rmmz_scenes.js:68 — MZ-ONLY. Grep isFading in rpg_scenes.js: zero hits.
   This is the seam a mod aliases to make a scene look busy, and it exists on
   exactly one of the two engines. */
Scene_Base.prototype.isFading = function () {
  return this._fadeDuration > 0;
};
/* rmmz_scenes.js:64 — routed THROUGH isFading, where MV tests the duration
   directly. Aliasing isFading changes isBusy here and changes nothing there.
   core.js:273 flattens isBusy to `return false`; before initialize has run
   `undefined > 0` is still false, so nothing that relied on it changes. */
Scene_Base.prototype.isBusy = function () {
  return this.isFading();
};

/* -------------------------------------------------------------------------
   Spriteset_Base / Spriteset_Map — MZ's layer construction and tone path.
   rmmz_sprites.js:3128-3223, :3352-3501.

   createUpperLayer below REPLACES core.js:1349, which modelled it as a bare
   __upperLayers probe. That flattening removes the one thing the mod's
   overlay-position hook feature-detects — that MZ's screen effects are
   FILTERS and not children — so the real body is restored and the probe
   increment is kept inside it, unchanged, so existing checks still see it.

   Spriteset_Base.prototype.update is NOT taken. MZ's (rmmz_sprites.js:3157)
   calls updateBaseFilters, updateOverallFilters, updatePosition and
   updateAnimations; core.js owns that method and hangs the __spritesetUpdates
   probe off Spriteset_Map's caller, so overriding it here would change what
   every other area's checks observe. The per-frame methods are defined and a
   test drives them directly — or calls initialize(), which on the real engine
   is what the constructor always did and on this harness is an explicit step,
   because core.js:1351's constructor does not call it.
   ---------------------------------------------------------------------- */
/* rmmz_sprites.js:3128 — no _tone field, no `opaque = true`, no
   createToneChanger, and it ends by seeding _animationSprites rather than by
   calling update(). MV's ends with this.update(). */
Spriteset_Base.prototype.initialize = function () {
  Sprite.prototype.initialize.call(this);
  this.setFrame(0, 0, Graphics.width, Graphics.height);
  this.loadSystemImages();
  this.createLowerLayer();
  this.createUpperLayer();
  this._animationSprites = [];
};
/* rmmz_sprites.js:3142 — MZ-only hook; MV has no loadSystemImages anywhere. */
Spriteset_Base.prototype.loadSystemImages = function () {
  //
};
/* rmmz_sprites.js:3146 — TWO calls. MV's createLowerLayer makes one. */
Spriteset_Base.prototype.createLowerLayer = function () {
  this.createBaseSprite();
  this.createBaseFilters();
};
/* rmmz_sprites.js:3165 — MZ does NOT frame the base sprite; MV does
   (`this._baseSprite.setFrame(0, 0, this.width, this.height)`). */
Spriteset_Base.prototype.createBaseSprite = function () {
  this._baseSprite = new Sprite();
  this._blackScreen = new ScreenSprite();
  this._blackScreen.opacity = 255;
  this.addChild(this._baseSprite);
  this._baseSprite.addChild(this._blackScreen);
};
/* rmmz_sprites.js:3173 — the tone filter, on _baseSprite as on MV, but a
   ColorFilter named _baseColorFilter rather than a ToneFilter named
   _toneFilter, PUSHED into an array MZ creates empty first. And no
   filterArea: MV sets a 48px-margin clip rectangle here that MZ does not,
   so nothing under MZ's _baseSprite is clipped. */
Spriteset_Base.prototype.createBaseFilters = function () {
  this._baseSprite.filters = [];
  this._baseColorFilter = new ColorFilter();
  this._baseSprite.filters.push(this._baseColorFilter);
};
/* rmmz_sprites.js:3151 — three calls, and the third is a FILTER, not sprites. */
Spriteset_Base.prototype.createUpperLayer = function () {
  window.__upperLayers = (window.__upperLayers || 0) + 1;   /* core.js:1349's probe, kept */
  this.createPictures();
  this.createTimer();
  this.createOverallFilters();
};
/* rmmz_sprites.js:3179 — the container covers the FULL SCREEN via
   pictureContainerRect. MV sizes it to the box and centres it, so a game with
   boxWidth < width places the same picture at different pixels on the two
   engines. Ids run 1..maxPictures, and maxPictures is project-dependent here. */
Spriteset_Base.prototype.createPictures = function () {
  var rect = this.pictureContainerRect();
  this._pictureContainer = new Sprite();
  this._pictureContainer.setFrame(rect.x, rect.y, rect.width, rect.height);
  for (var i = 1; i <= $gameScreen.maxPictures(); i++) {
    this._pictureContainer.addChild(new Sprite_Picture(i));
  }
  this.addChild(this._pictureContainer);
};
/* rmmz_sprites.js:3189 — MZ-only; Spriteset_Battle overrides it to inset the
   picture container, which is the seam MV has no place for. */
Spriteset_Base.prototype.pictureContainerRect = function () {
  return new Rectangle(0, 0, Graphics.width, Graphics.height);
};
/* rmmz_sprites.js:3193 */
Spriteset_Base.prototype.createTimer = function () {
  this._timerSprite = new Sprite_Timer();
  this.addChild(this._timerSprite);
};
/* rmmz_sprites.js:3198 — THE MZ-ONLY METHOD, and the counterpart to MV's
   createScreenSprites. It sets `this.filters` ON THE SPRITESET, so the screen
   flash and the screen brightness apply to every child including anything a
   mod added — and there are no _flashSprite/_fadeSprite children to sit under.
   This is the whole of MV-MZ-DELTA.md §C.16 in four lines. */
Spriteset_Base.prototype.createOverallFilters = function () {
  this.filters = [];
  this._overallColorFilter = new ColorFilter();
  this.filters.push(this._overallColorFilter);
};
/* rmmz_sprites.js:3204 — UNCONDITIONAL. No equals() check, no cached _tone;
   the tone array is cloned into the uniform every single frame. MV caches and
   skips, so a tone written in place is invisible on MV and immediate here. */
Spriteset_Base.prototype.updateBaseFilters = function () {
  var filter = this._baseColorFilter;
  filter.setColorTone($gameScreen.tone());
};
/* rmmz_sprites.js:3209 — flash colour and brightness into ONE filter, where
   MV pushes the same two values into two separate ScreenSprite children. */
Spriteset_Base.prototype.updateOverallFilters = function () {
  var filter = this._overallColorFilter;
  filter.setBlendColor($gameScreen.flashColor());
  filter.setBrightness($gameScreen.brightness());
};

/* rmmz_sprites.js:3362 — MZ-only override; MV's Spriteset_Map has no
   loadSystemImages, and MV loads its balloon and shadow sheets from
   Scene_Map.createDisplayObjects instead. */
Spriteset_Map.prototype.loadSystemImages = function () {
  Spriteset_Base.prototype.loadSystemImages.call(this);
  ImageManager.loadSystem('Balloon');
  ImageManager.loadSystem('Shadow1');
};

/* -------------------------------------------------------------------------
   Sprite_Picture's base class, MZ side. rmmz_sprites.js:2891-2900, and
   Sprite_Clickable at rmmz_sprites.js:10-26.

   MZ pictures are CLICKABLE: Sprite_Picture extends Sprite_Clickable, whose
   update calls processTouch, so every picture on an MZ map is a touch target
   with _pressed/_hovered state. MV's extends plain Sprite and sets
   `_isPicture = true` instead, a PIXI 4 renderer hint MZ has no use for.
   Sprite_Clickable does not exist on MV at all.
   ---------------------------------------------------------------------- */
/* rmmz_sprites.js:10 */
function Sprite_Clickable() {
  this.initialize.apply(this, arguments);
}
Sprite_Clickable.prototype = Object.create(Sprite.prototype);
Sprite_Clickable.prototype.constructor = Sprite_Clickable;
/* rmmz_sprites.js:17 */
Sprite_Clickable.prototype.initialize = function () {
  Sprite.prototype.initialize.call(this);
  this._pressed = false;
  this._hovered = false;
};
/* rmmz_sprites.js:23 */
Sprite_Clickable.prototype.update = function () {
  Sprite.prototype.update.call(this);
  this.processTouch();
};
/* rmmz_sprites.js:28 — SHAPE. The real processTouch reads TouchInput's
   pressed/triggered state through isBeingTouched/hitTest and fires
   onMouseEnter/onMouseExit/onPress/onClick (:28-54). Those four handlers are
   empty on Sprite_Clickable itself and the hit test needs a real world
   transform, so the dispatch is recorded rather than simulated; what matters
   for the screen is that MZ calls it once per picture per frame and MV never
   calls anything of the kind. */
Sprite_Clickable.prototype.processTouch = function () {
  window.__clickableTouches = (window.__clickableTouches || 0) + 1;
};
Sprite_Clickable.prototype.isClickEnabled = function () {
  return this.worldVisible;
};
Sprite_Clickable.prototype.isPressed = function () {
  return this._pressed;
};

Object.setPrototypeOf(Sprite_Picture.prototype, Sprite_Clickable.prototype);
/* rmmz_sprites.js:2894 — no _isPicture. */
Sprite_Picture.prototype.initialize = function (pictureId) {
  Sprite_Clickable.prototype.initialize.call(this);
  this._pictureId = pictureId;
  this._pictureName = '';
  this.update();
};
/* rmmz_sprites.js:2905 — the base call is Sprite_Clickable's, which runs
   processTouch. MV's base call is plain Sprite's and does no such thing. */
Sprite_Picture.prototype.update = function () {
  Sprite_Clickable.prototype.update.call(this);
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
