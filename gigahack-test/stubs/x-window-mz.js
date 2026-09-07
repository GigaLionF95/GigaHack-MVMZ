/* =============================================================================
   GigaHack test harness — stubs/x-window-mz.js
   THE MZ HALF of the window transparency surface. Loaded IMMEDIATELY AFTER
   engine-mz.js, so `Window`, `Window.prototype.initWindow` and `Window_Base`
   all exist and the deep part tree engine-mz.js:343-428 builds is available
   to name.

   Modelled on MZ rmmz_core.js / rmmz_windows.js / rmmz_objects.js /
   rmmz_scenes.js 1.9.0, with the file:line each group came from. ES5, like
   every file here — MZ's own source is not, and every place its arrows and
   const are written out longhand is a rewrite, not a transcription.

   WHAT MZ PUTS WHERE, WHICH IS THE ENTIRE DIFFERENCE

   MZ's part tree is DEEP (rmmz_core.js:3981-4050). `_container` holds the
   back sprite and the frame sprite; `_clientArea` is a SIBLING of it holding
   the contents-back sprite, the cursor, the contents sprite and every
   addInnerChild a plugin ever adds. So:

     opacity          -> _container.alpha            rmmz_core.js:3703
     backOpacity      -> _backSprite.alpha           rmmz_core.js:3719
     contentsOpacity  -> _contentsSprite.alpha       rmmz_core.js:3735
     openness         -> _container scale.y          rmmz_core.js:3751

   Read alongside MV that is the same four properties over four differently
   named objects, and it would be tempting to call the two engines the same
   here. They are not, in one way that matters:

     THE OPENNESS GATE IS ON A DIFFERENT OBJECT FROM contentsOpacity.
     `_updateClientArea` sets `_clientArea.visible = this.isOpen()`
     (rmmz_core.js:4183) — the contents sprite's PARENT. MV gates the
     contents sprite itself (rpg_core.js:6828). So on MV the object that
     carries the text's alpha is also the object that disappears when the
     window closes, and here they are two objects one level apart. Anything
     that walks down to "the thing holding the text" and asks whether it is
     visible gets a truthful answer on MV and a stale one here, because
     _contentsSprite stays visible inside a hidden client area.

   The other half of the same tree is why `opacity` and `contentsOpacity` are
   independent on both engines: the client area is not inside `_container`,
   so alphaing the container takes the frame and the plate and leaves the
   text. Frame at 0 with contents at 255 is dialogue with no box here too.

   AND WHERE THE PLATE'S DEFAULT COMES FROM

   MZ's `_createBackSprite` (rmmz_core.js:3998) sets no alpha at all, so a
   bare window reads 255 through `backOpacity` and stays there until
   Window_Base asks the GAME what it should be. MV seeds 192 into the sprite
   at construction instead. Same stock number in the end, different owner of
   it, and a mod that wants to override the plate globally has one target
   here and a different one there.
   ========================================================================= */

/* -------------------------------------------------------------------------
   innerWidth / innerHeight — rmmz_core.js:3766 and :3779. MZ-ONLY; MV's
   Window_Base computes the same span with contentsWidth()/contentsHeight()
   and there is nothing on MV's Window that answers to these names.

   Needed here because the gate step below asks whether there is any room
   inside the window, and it asks through these. The floor at zero is the
   engine's own: a window narrower than its padding reports 0, not a negative
   width that would make the comparison below accidentally true.
   ---------------------------------------------------------------------- */
Object.defineProperty(Window.prototype, 'innerWidth', {
  get: function () { return Math.max(0, this.width - this.padding * 2); },
  configurable: true
});
Object.defineProperty(Window.prototype, 'innerHeight', {
  get: function () { return Math.max(0, this.height - this.padding * 2); },
  configurable: true
});

/* -------------------------------------------------------------------------
   The gate step. rmmz_core.js:4183, reached from updateTransform (:3954).

   The engine's body also moves the client area to the padding offset minus
   `origin`, which is how MZ applies scroll on the PARENT transform where MV
   bakes it into the contents sprite's frame (MV-MZ-DELTA.md §C.8). Only the
   visibility half is modelled: the placement belongs to the geometry area,
   and the half kept here is the one that decides whether the text is drawn.

   The zero-size branch is kept for the reason given in the MV file — a
   collapsed window and a closed one reach the same observable by different
   routes, and a check that reads one as the other is wrong about both.
   ---------------------------------------------------------------------- */
Window.prototype._updateClientArea = function () {
  var room = this.innerWidth > 0 && this.innerHeight > 0;
  this._clientArea.visible = room && this.isOpen();
};

/* -------------------------------------------------------------------------
   Where MZ keeps the plate's opacity. rmmz_windows.js:76 and
   rmmz_objects.js:416.

   MV asks the window class (`standardBackOpacity`, a method on
   Window_Base). MZ asks the SAVE — $gameSystem, reading the number the
   editor wrote into $dataSystem.advanced. That is a real difference in where
   a global override has to go, and it is also a difference in lifetime: the
   MZ value travels in the save file and the MV one does not exist outside
   the running class.

   THE FIELD IS FAITHFULLY UNGUARDED, AND THE FIXTURE HAS NOT GOT IT.
   fixtures.js:100 builds `$dataSystem.advanced` with a single key in it and
   no windowOpacity, so this returns undefined and `updateBackOpacity` then
   dies inside clamp with "Cannot read properties of undefined" and nothing
   saying why. That is exactly what a real System.json missing the field
   does, so the guard belongs in neither place — a default invented here
   would be a number no game wrote, and a guard here would hide the same
   failure on a real game.

   THE FIX IS ONE LINE AND IT IS IN THE FIXTURE: add `windowOpacity: 192` to
   the `advanced` object at fixtures.js:100 — 192 is what the editor writes
   for a stock project, and it is the same number MV hard-codes at
   rpg_windows.js:61. Until somebody does, this method works and its caller
   throws, and the windows this area's drivers build carry the value their
   part tree was born with (255 here, 192 on MV) rather than a number
   nothing wrote.

   updateBackOpacity is also the seam that takes a write back: Window_Base
   .initialize calls it (rmmz_windows.js:25), so every window built after a
   mod lowered backOpacity comes up at the game's number again.
   ---------------------------------------------------------------------- */
Game_System.prototype.windowOpacity = function () {
  return $dataSystem.advanced.windowOpacity;
};
Window_Base.prototype.updateBackOpacity = function () {
  this.backOpacity = $gameSystem.windowOpacity();
};

/* -------------------------------------------------------------------------
   createDimmerSprite — rmmz_windows.js:538. MZ-ONLY as a method: MV builds
   the same sprite inline inside showBackgroundDimmer and has no such name.
   MZ also nudges it four pixels left, because its dimmer bitmap is drawn
   eight pixels wider than the window (refreshDimmerBitmap, :557) so the
   gradient can run past both edges.

   The gradient itself is not modelled — see the note in x-window.js. The
   PLACEMENT is, and it is the fact this whole sprite is here for:
   `addChildToBack` puts the dimmer in the WINDOW's children, outside
   `_container`, so it is untouched by `opacity`. A dimmed window faded to
   zero still lays a dark band over the scene.

   engine-mz.js:392 implements addChildToBack as `children.unshift`, where
   the engine inserts just after `_container` (rmmz_core.js:3935, the same
   body MV has at rpg_core.js:6602). The dimmer therefore lands at a
   different INDEX in this harness than in the engine. It is outside the
   opacity container either way, which is all this file's claims rest on,
   and engine-mz.js is not this file's to edit — but a check that asserts on
   child order rather than on parentage would be measuring the stub.
   ---------------------------------------------------------------------- */
Window_Base.prototype.createDimmerSprite = function () {
  this._dimmerSprite = window.__makeDimmerSprite();
  this._dimmerSprite.x = -4;
  this.addChildToBack(this._dimmerSprite);
};
/* showBackgroundDimmer — rmmz_windows.js:526. Same observable as MV's, one
   level of indirection more. */
Window_Base.prototype.showBackgroundDimmer = function () {
  if (!this._dimmerSprite) this.createDimmerSprite();
  this._dimmerSprite.visible = true;
  this.updateBackgroundDimmer();
};

/* -------------------------------------------------------------------------
   Hand the shared file MZ's table. Everything else about the surface — the
   property names, the range, the clamp, openness, isOpen/isClosed, the
   open/close animation, setBackgroundType, the message window's base class —
   is the same on both engines and is installed from x-window.js.
   ---------------------------------------------------------------------- */
window.__installWindowSurface({
  frame: '_container',                  /* rmmz_core.js:3703, :3751 */
  back: '_backSprite',                  /* rmmz_core.js:3719 */
  contents: '_contentsSprite',          /* rmmz_core.js:3735 */
  gate: '_clientArea',                  /* rmmz_core.js:4189 — the PARENT, not the sprite */
  gateStep: '_updateClientArea',        /* rmmz_core.js:4183 */
  backAtBirth: 255                      /* rmmz_core.js:3998 sets no alpha */
});
