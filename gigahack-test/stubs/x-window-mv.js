/* =============================================================================
   GigaHack test harness — stubs/x-window-mv.js
   THE MV HALF of the window transparency surface. Loaded IMMEDIATELY AFTER
   engine-mv.js, so `Window`, `Window.prototype.initWindow` and `Window_Base`
   all exist and the flat part tree engine-mv.js:448-513 builds is available
   to name.

   Modelled on MV rpg_core.js / rpg_windows.js / rpg_scenes.js 1.6.1, with the
   file:line each group came from. ES5, like every file here.

   WHAT MV PUTS WHERE, WHICH IS THE ENTIRE DIFFERENCE

   MV's part tree is FLAT (rpg_core.js:6623). `_windowSpriteContainer` holds
   the back sprite and the frame sprite and nothing else; the contents sprite,
   the cursor, both arrows and the pause sign are direct children of the
   window. So:

     opacity          -> _windowSpriteContainer.alpha    rpg_core.js:6440
     backOpacity      -> _windowBackSprite.alpha         rpg_core.js:6456
     contentsOpacity  -> _windowContentsSprite.alpha     rpg_core.js:6472
     openness         -> _windowSpriteContainer scale.y  rpg_core.js:6488

   Two consequences fall out of that shape and both matter to anything trying
   to take the interface out of a picture:

   1. `opacity` reaches the frame and the plate and NOT the text, because the
      contents sprite is not inside the container it alphas. Frame at 0 with
      contents left at 255 is therefore dialogue with no box, and it is one
      property write.

   2. The openness gate lands on the SAME sprite `contentsOpacity` alphas —
      `_updateContents` sets `_windowContentsSprite.visible = this.isOpen()`
      (rpg_core.js:6828). MZ gates the contents sprite's PARENT instead, so a
      check asking "is the text on screen" is asking about one object here and
      a different one there. That is what the spec's `gate` is for.

   AND ONE VALUE MV SETS AND MZ DOES NOT

   `_createAllParts` ends the back sprite's construction with
   `_windowBackSprite.alpha = 192 / 255` (rpg_core.js:6634). A bare MV window
   therefore reads back 192 through `backOpacity` before any window code has
   run, where a bare MZ one reads 255 and waits for Window_Base to tell it.
   Same number in the end on a stock game, different starting point, and the
   difference is visible to anything that reads the property on a window it
   did not construct.
   ========================================================================= */

/* -------------------------------------------------------------------------
   The gate step. rpg_core.js:6828, reached from updateTransform (:6610).

   The engine's body also re-frames the contents sprite against `origin`,
   which is how MV bakes scroll into the sprite's frame rather than its
   transform (MV-MZ-DELTA.md §C.8). Only the visibility half is modelled: the
   frame arithmetic belongs to the geometry area, and the half kept here is
   the one that decides whether the text is on screen.

   The zero-size branch is kept because it is not redundant. A window with no
   room inside it hides its contents whatever its openness says, so "closed"
   and "too small to draw" reach the same observable by different routes, and
   a check that concludes "the window must be closed" from an invisible
   contents sprite would be wrong about a collapsed one.
   ---------------------------------------------------------------------- */
Window.prototype._updateContents = function () {
  var inner = this.width - this.padding * 2;
  var innerHeight = this.height - this.padding * 2;
  this._windowContentsSprite.visible = inner > 0 && innerHeight > 0 && this.isOpen();
};

/* -------------------------------------------------------------------------
   Window_Base.updateBackOpacity — rpg_windows.js:73.

   MV asks the WINDOW CLASS how opaque its plate should be, through
   `standardBackOpacity()` (rpg_windows.js:61, already in engine-mv.js:114,
   returning 192). MZ asks the GAME, through $gameSystem. That is the whole
   delta and it decides where a "make every plate transparent" override has
   to be installed: a per-class method here, a per-save accessor there.

   It is also the seam that TAKES A WRITE BACK. Window_Base.initialize calls
   it (rpg_windows.js:22), so every window built after a mod lowered
   backOpacity comes up at 192 again, and nothing says so.
   ---------------------------------------------------------------------- */
Window_Base.prototype.updateBackOpacity = function () {
  this.backOpacity = this.standardBackOpacity();
};

/* -------------------------------------------------------------------------
   showBackgroundDimmer — rpg_windows.js:637.

   MV builds the dimmer sprite INLINE, here, and gives it no offset. MZ
   factored the same three lines out into `Window_Base.createDimmerSprite`
   and shifts the sprite four pixels left. There is deliberately no
   createDimmerSprite on this prototype: inventing one would let a mod
   feature-detect its way to a wrong conclusion about which engine it is on,
   which is the exact failure this harness exists to catch.

   refreshDimmerBitmap (rpg_windows.js:663) paints the gradient and is not
   modelled — see the note in x-window.js. What IS modelled is the placement,
   because that is the fact worth having: `addChildToBack` (rpg_core.js:6602)
   inserts the sprite into the WINDOW's children, just after
   _windowSpriteContainer — outside the container `opacity` alphas. Zero the
   opacity of a dimmed window and the dark band stays exactly where it was.
   ---------------------------------------------------------------------- */
Window_Base.prototype.showBackgroundDimmer = function () {
  if (!this._dimmerSprite) {
    this._dimmerSprite = window.__makeDimmerSprite();
    this.addChildToBack(this._dimmerSprite);
  }
  this._dimmerSprite.visible = true;
  this.updateBackgroundDimmer();
};

/* -------------------------------------------------------------------------
   Hand the shared file MV's table. Everything else about the surface — the
   property names, the range, the clamp, openness, isOpen/isClosed, the
   open/close animation, setBackgroundType, the message window's base class —
   is the same on both engines and is installed from x-window.js.
   ---------------------------------------------------------------------- */
window.__installWindowSurface({
  frame: '_windowSpriteContainer',      /* rpg_core.js:6440, :6488 */
  back: '_windowBackSprite',            /* rpg_core.js:6456 */
  contents: '_windowContentsSprite',    /* rpg_core.js:6472 */
  gate: '_windowContentsSprite',        /* rpg_core.js:6829 — the contents sprite itself */
  gateStep: '_updateContents',          /* rpg_core.js:6828 */
  backAtBirth: 192                      /* rpg_core.js:6634 */
});
