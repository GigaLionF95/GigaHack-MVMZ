/* =============================================================================
   GigaHack test harness — stubs/x-window.js
   WINDOW TRANSPARENCY, OPENNESS, AND THE LAYER A SCENE KEEPS ITS WINDOWS ON.
   Everything that is IDENTICAL on RPG Maker MV 1.6.1 and MZ 1.9.0.

   Modelled on the shipped engine source, awkward parts included, with the
   file:line each group came from. MV = MV rpg_*.js, MZ = MZ rmmz_*.js. A
   single reference means the two engines are byte-identical there apart from
   var/let and function/arrow spelling; this file is ES5 because the harness
   runs on the same floor as the mod.

   WHY THIS FILE PUBLISHES AN INSTALLER RATHER THAN A LIST OF ASSIGNMENTS

   It is loaded IMMEDIATELY AFTER core.js, and `Window` and `Window_Base` are
   declared per engine, in engine-mv.js and engine-mz.js, which have not run
   yet. A `function Window() {}` here would simply be hoisted over by theirs,
   and an `Object.defineProperty(Window.prototype, ...)` here would throw on a
   name that does not exist. So the shared knowledge is published as
   `window.__installWindowSurface(spec)`, and each engine file calls it once
   with the names of ITS OWN parts.

   That split is not a workaround; it is the shape of the fact. The two
   engines agree on every property name, on the 0-255 range, on the clamp, on
   dividing by 255 to store and multiplying by 255 to read, on the openness
   geometry and on the open/close step. They disagree about exactly one thing:
   WHICH display object each property writes through. The disagreement is one
   table, and the table lives in the two engine files where it can be read
   next to the part tree it names.

   WHAT IS FACT AND IS REPRODUCED EXACTLY
     · the property names — opacity, backOpacity, contentsOpacity, openness
     · the range: 0-255 in, 0-255 out, stored as a 0-1 alpha
     · the clamp: `value.clamp(0, 255)`, the engines' own Number extension
       (core.js:93), which THROWS on a non-number rather than coercing — the
       awkwardness is kept because a mod that writes a string to opacity
       should fail here and not silently paint nothing
     · openness: guarded by `!==` against the RAW value before the clamp, so
       a write of 300 to an already-255 window re-runs the body every time
     · isOpen is `>= 255` and isClosed is `<= 0`, on `_openness`
     · the open/close animation steps by 32 a frame
     · setBackgroundType's three-way: 0 opaque, 1 dim, 2 transparent

   WHAT core.js ALREADY MODELS AND THIS FILE DOES NOT REDEFINE
     · Window_Message's four message methods and its `close`, and
       Window_ScrollText (core.js:1106, :1141). Both are reparented onto
       Window_Base below rather than replaced, so every one of those methods
       survives and the window surface appears underneath them.
     · Game_Message's `_background` field and `setBackground` (core.js:1044,
       :1056). The matching GETTER is missing and is added below.
     · Number.prototype.clamp (core.js:93), Point, Sprite, Bitmap.

   WHAT THE SIBLING STUBS ALREADY BUILD, AND WHICH THIS FILE DOES NOT FIGHT
     · `Scene_Base.prototype.addWindow` — x-equip.js:620, correct on both.
     · `Scene_Base.prototype.createWindowLayer` — x-equip-mv.js:143 and
       x-equip-mz.js:149, each with its engine's real geometry (MV moves the
       layer and it has a size; MZ sets only x and y). Both are used as they
       stand. What their layer literals lack is a `visible` flag, a
       `removeChild`, and the class identity a real WindowLayer has — three
       fields, backfilled below, never overwritten.
     · fixtures.js:878 builds a window layer of its own and pushes it into
       `scene.children` WITHOUT assigning `scene._windowLayer`. On the engines
       createWindowLayer does both, so that layer is adopted rather than
       duplicated: a second layer would leave a check reading one and the mod
       writing the other.

   WHAT IS DELIBERATELY NOT MODELLED
     · `refreshDimmerBitmap` (MV rpg_windows.js:663 / MZ rmmz_windows.js:557)
       paints a vertical gradient into the dimmer's bitmap. Nothing about
       which property reaches which object depends on those pixels, and a
       fake gradient would only invite a check to assert on it.
     · The other six steps of `updateTransform` (cursor, arrows, pause sign,
       frame, contents back, filter area). Only the step that gates the
       CONTENTS on openness is modelled, because that is the one a "dialogue
       with no box" setting has to reason about; it is installed under its own
       engine name in each engine file and reached here through
       `__settleWindows`.
   ========================================================================= */

/* -------------------------------------------------------------------------
   Game_Message.background — MV rpg_objects.js:369 / MZ rmmz_objects.js:520.
   core.js models setBackground and the field but not the reader, and the
   reader is the one the message window consults every page.
   ---------------------------------------------------------------------- */
if (typeof Game_Message === 'function' && !Game_Message.prototype.background) {
  Game_Message.prototype.background = function () {
    return this._background;
  };
}

/* -------------------------------------------------------------------------
   Scene_Map.snapForBattleBackground — MV rpg_scenes.js:878 / MZ
   rmmz_scenes.js:1160, byte-identical.

   This is the ENGINE'S OWN precedent for the thing being built: to photograph
   the scene without the interface on it, the engine hides the whole window
   layer for one frame, takes the picture, and puts it back. It is worth
   having in the harness for exactly that reason — a mod that hides the UI for
   a screenshot is doing what the engine already does here, and a check can
   watch the layer go down and come back up rather than inferring it.

   The counter is the harness's, not the engine's: without it there is no way
   to tell "hidden across the snap" from "never hidden", because the flag is
   true again by the time anybody can look.
   ---------------------------------------------------------------------- */
Scene_Map.prototype.snapForBattleBackground = function () {
  var layer = this._windowLayer;
  layer.visible = false;
  window.__uiHiddenForSnap = (window.__uiHiddenForSnap || 0) + 1;
  SceneManager.snapForBackground();
  layer.visible = true;
};

(function () {

  /* The part table the engine file hands over. Held here so the drivers can
     report which object carries which property without asking the engine. */
  var SPEC = null;

  /* -----------------------------------------------------------------------
     Every part these accessors write through is a PIXI display object on the
     engines, where `alpha` is always present and `scale` is always a Point.
     core.js's Sprite (core.js:211) and PIXI.Container (core.js:159) carry
     neither. The field is therefore seeded the first time an accessor reaches
     the part, at the value the engine's own part creation leaves there — 255
     everywhere except one, which the spec names.

     Seeded, not defaulted in the getter: a write has to land somewhere a
     later read can find it, and a getter that invents 255 for a missing field
     would report the write as lost.

     A missing part is not tolerated. On the engines it cannot happen —
     _createAllParts runs inside initialize, before anything can reach a
     property — so rather than return a plausible zero, say which part is
     absent. A named failure beats a NaN that travels.
     -------------------------------------------------------------------- */
  function partOf(win, key, birth) {
    var p = win ? win[key] : null;
    if (!p) {
      throw new Error('window part ' + key + ' is absent; initWindow has not run on this window');
    }
    if (typeof p.alpha !== 'number') p.alpha = birth / 255;
    if (!p.scale) p.scale = new Point(1, 1);
    return p;
  }

  /* The openness setter's own lookup, which tolerates a missing part.
     REASON, and it is a property of the harness rather than of the engines:
     `Window.prototype.initialize` assigns `this._openness = 255` DIRECTLY
     (MV rpg_core.js:6275 / MZ rmmz_core.js:3508) and only then builds the
     parts, so the accessor is never reached before they exist. The stub
     builders in engine-mv.js:453 and engine-mz.js:348 assign through the
     PROPERTY instead, and they do it before the parts are made. The scale is
     replayed by __settleWindows once the window is whole. */
  function frameOrNull(win) {
    return win && SPEC && win[SPEC.frame] ? partOf(win, SPEC.frame, 255) : null;
  }

  /* openness moves the frame container and nothing else: it scales it
     vertically and slides it back down by half of what the scale took away,
     so the window closes toward its own middle. MV rpg_core.js:6488 /
     MZ rmmz_core.js:3751 — same arithmetic, different container. */
  function applyOpenness(win) {
    var c = frameOrNull(win);
    if (!c) return;
    var open = win._openness / 255;
    c.scale.y = open;
    c.y = (win.height / 2) * (1 - open);
  }

  /* -----------------------------------------------------------------------
     THE INSTALLER. Called once by x-window-mv.js and once by x-window-mz.js,
     each with its own part names.

     spec = {
       frame:    the container `opacity` alphas and `openness` scales
       back:     the sprite `backOpacity` alphas — the plate behind the text
       contents: the sprite `contentsOpacity` alphas — the text itself
       gate:     the object whose `visible` the engine ties to isOpen()
       gateStep: the engine's own method name that sets it
       backAtBirth: what the back sprite's alpha is before any window code
                    has touched it, in the 0-255 the property speaks
     }
     -------------------------------------------------------------------- */
  window.__installWindowSurface = function (spec) {
    SPEC = spec;

    /* --- the three opacity properties -----------------------------------
       MV rpg_core.js:6440 / :6456 / :6472.
       MZ rmmz_core.js:3703 / :3719 / :3735.

       Three properties, three different objects, one idiom: the property
       speaks 0-255 and the object stores 0-1. Which object is the whole of
       the difference between the engines, and it is why a mod must never
       reach past the property to the sprite it thinks is underneath.

       What the three MEAN, because the names do not say it: `opacity` is the
       frame AND the plate together, since both hang off the container it
       alphas; `backOpacity` is the plate alone; `contentsOpacity` is the
       text. Frame at 0 with contents left at 255 is dialogue with no box,
       and that combination is the point of the whole surface. */
    function define(name, key, birth) {
      Object.defineProperty(Window.prototype, name, {
        get: function () { return partOf(this, key, birth).alpha * 255; },
        set: function (value) { partOf(this, key, birth).alpha = value.clamp(0, 255) / 255; },
        configurable: true
      });
    }
    define('opacity', spec.frame, 255);
    define('backOpacity', spec.back, spec.backAtBirth);
    define('contentsOpacity', spec.contents, 255);

    /* --- openness --------------------------------------------------------
       MV rpg_core.js:6488 / MZ rmmz_core.js:3751.

       Two things here are load-bearing and both survive into the stub.

       The guard compares against the RAW argument, before the clamp: a
       window already at 255 that is handed 300 sees 255 !== 300, does the
       work, and clamps back to 255 — so the body re-runs on every such write
       forever. Harmless on the engine, and exactly the sort of thing a stub
       that "tidied" it would hide.

       And openness is a SEPARATE axis from opacity even though both act on
       the same container. Opacity fades it; openness squashes it. A window
       at opacity 0 is invisible but still open, so the engine still runs its
       input; a window at openness 0 is closed and its contents are gated off
       as well. "Transparent" and "hidden" are not the same request. */
    Object.defineProperty(Window.prototype, 'openness', {
      get: function () { return this._openness; },
      set: function (value) {
        if (this._openness === value) return;
        this._openness = value.clamp(0, 255);
        applyOpenness(this);
      },
      configurable: true
    });

    /* isOpen / isClosed — MV rpg_core.js:6542 / :6551,
       MZ rmmz_core.js:3857 / :3866. Both read `_openness`, and the two
       thresholds are not complementary: 0 < openness < 255 is neither open
       nor closed, which is what makes the 32-a-frame animation observable.

       Installed only where the engine file has not already written one.
       engine-mv.js:506 carries an isOpen that reads the property rather than
       the field — the same answer through the accessor above — and replacing
       a sibling's correct method with an identical one is noise. */
    if (!Window.prototype.isOpen) {
      Window.prototype.isOpen = function () { return this._openness >= 255; };
    }
    if (!Window.prototype.isClosed) {
      Window.prototype.isClosed = function () { return this._openness <= 0; };
    }

    /* --- Window_Base: opening, closing, showing, hiding ------------------
       MV rpg_windows.js:117-165 / MZ rmmz_windows.js:134-182. Byte-identical
       across the engines, every one of them.

       `hide()` is the cheapest honest answer to "get this out of the shot":
       it sets `visible` false and the window stops rendering entirely,
       contents and all, with no arithmetic and nothing for the game to
       recompute. `close()` is the polite one — it animates out and the game
       can see it happen. Opacity is the only one of the three that leaves
       the window running and interactive while it is not there to look at. */
    Window_Base.prototype.open = function () {
      if (!this.isOpen()) this._opening = true;
      this._closing = false;
    };
    Window_Base.prototype.close = function () {
      if (!this.isClosed()) this._closing = true;
      this._opening = false;
    };
    Window_Base.prototype.updateOpen = function () {
      if (!this._opening) return;
      this.openness += 32;
      if (this.isOpen()) this._opening = false;
    };
    Window_Base.prototype.updateClose = function () {
      if (!this._closing) return;
      this.openness -= 32;
      if (this.isClosed()) this._closing = false;
    };
    Window_Base.prototype.isOpening = function () { return this._opening; };
    Window_Base.prototype.isClosing = function () { return this._closing; };
    Window_Base.prototype.show = function () { this.visible = true; };
    Window_Base.prototype.hide = function () { this.visible = false; };

    /* --- setBackgroundType, and the dim band that opacity cannot reach ---
       MV rpg_windows.js:624 / MZ rmmz_windows.js:513, byte-identical.

       This is the engine's own three-way transparency switch, and it is the
       best evidence available that writing `opacity = 0` is the supported
       way to take a window's frame away: type 0 is the normal box, type 2 is
       "transparent", and the engine implements the difference as exactly
       that one assignment.

       Type 1 is the trap. The dim background is a SEPARATE sprite, added
       with addChildToBack, which puts it outside the container `opacity`
       alphas — so a window in dim mode at opacity 0 still shows a dark band
       across the scene and the frame is the only thing that went away. The
       dimmer tracks OPENNESS instead (updateBackgroundDimmer, below), so
       closing or hiding the window does take it with them and fading does
       not. Anything offering "make the message window transparent" has to
       say that, or it is a control that lies.

       hideBackgroundDimmer and updateBackgroundDimmer are identical on both
       engines and live here. Creating the sprite is not — MZ factored it out
       into createDimmerSprite and offsets it — so showBackgroundDimmer is
       installed per engine. */
    Window_Base.prototype.setBackgroundType = function (type) {
      this.opacity = type === 0 ? 255 : 0;
      if (type === 1) this.showBackgroundDimmer();
      else this.hideBackgroundDimmer();
    };
    Window_Base.prototype.hideBackgroundDimmer = function () {
      if (this._dimmerSprite) this._dimmerSprite.visible = false;
    };
    /* MV rpg_windows.js:657 / MZ rmmz_windows.js:551. */
    Window_Base.prototype.updateBackgroundDimmer = function () {
      if (this._dimmerSprite) this._dimmerSprite.opacity = this.openness;
    };

    /* The dimmer's own `opacity`, which is Sprite.prototype.opacity on the
       engines (MV rpg_core.js:4050 / MZ rmmz_core.js:1940) and the same
       alpha-times-255 idiom as the window's three.

       DEFINED PER SPRITE, NOT ON Sprite.prototype, and the reason is a
       harness one. core.js's Sprite is shared, and x-screen.js already uses
       `.opacity` on sprites as a plain field in seven places (x-screen.js:145
       and on, x-screen-mv.js:371 and on). Turning it into an accessor
       underneath them would push every one of those values through a divide
       and a multiply by 255 and change what those checks measure. The
       engine's behaviour is reproduced exactly where this file needs it and
       nowhere else. */
    window.__makeDimmerSprite = function () {
      var sprite = new Sprite();
      sprite.bitmap = new Bitmap(0, 0);
      sprite.visible = true;
      sprite.alpha = 1;
      Object.defineProperty(sprite, 'opacity', {
        get: function () { return sprite.alpha * 255; },
        set: function (value) { sprite.alpha = value.clamp(0, 255) / 255; },
        configurable: true
      });
      return sprite;
    };

    /* --- the message window's place in all of this -----------------------
       Window_Message and Window_ScrollText both extend Window_Base on both
       engines — MV rpg_windows.js:4245 and :4576, MZ rmmz_windows.js:4789
       and :5192.

       core.js declares them as bare constructors with prototypes of their
       own, because the modules that needed them only ever wanted the four
       message methods. Reparenting rather than replacing keeps every one of
       those methods, adds the whole window surface underneath, and is what
       makes a walk of the layer meet objects that answer to all three
       opacity properties instead of two kinds of thing.

       ONE SHADOW SURVIVES AND IS LEFT ALONE: core.js:1119 gives
       Window_Message its own `close`, which sets `_closing` unconditionally
       where Window_Base's guards on isClosed() and also clears `_opening`.
       That method belongs to the text module's checks; it is not this file's
       to change. A check that wants the engine's open/close arithmetic uses
       a window whose class does not override it. */
    Object.setPrototypeOf(Window_Message.prototype, Window_Base.prototype);
    Object.setPrototypeOf(Window_ScrollText.prototype, Window_Base.prototype);

    /* updateBackground — MV rpg_windows.js:4350 / MZ rmmz_windows.js:4904,
       byte-identical.

       THIS IS WHERE THE GAME TAKES A TRANSPARENCY SETTING BACK. The engine
       calls it from startMessage (MV :4334-4343 / MZ :4869-4885, both ending
       updatePlacement -> updateBackground -> open), so every page re-asserts
       the background type the event asked for, and a mod's `opacity = 0`
       written between two messages is gone by the next one.

       core.js's startMessage (core.js:1111) is a recorder for the dialogue
       history and stops before that step, and it is not wrapped here: doing
       so would drive setBackgroundType through every existing message check,
       including ones holding a Window_Message that was never given parts. A
       check that wants the re-assertion calls updateBackground() itself,
       which is the engine's own single point for it. */
    Window_Message.prototype.updateBackground = function () {
      this._background = $gameMessage.background();
      this.setBackgroundType(this._background);
    };
  };

  /* =======================================================================
     THE WINDOW LAYER, and the drivers a check needs.

     Nothing below runs at load. The default state of the harness is
     unchanged by this file: no window is added, no layer is created, and
     nothing appears on the scene until a check asks for it.
     ==================================================================== */

  /* A real WindowLayer is a class on both engines, and `scene._windowLayer`
     is an instance of it. The sibling stubs build object literals instead —
     x-equip-mv.js:148, x-equip-mz.js:150, fixtures.js:878 — each carrying
     what its own area needed. This tops up whichever one is there with the
     three members the rest are missing, and never replaces one that exists.

     The class identity is topped up too, guarded on the layer still being a
     plain object: on the engines a walk of `scene.children` recognises the
     layer by what it IS, and a literal answers `Object` to that question. */
  function adopt(layer) {
    if (!layer) return null;
    if (!layer.children) layer.children = [];
    if (typeof layer.visible !== 'boolean') layer.visible = true;
    if (typeof layer.addChild !== 'function') {
      layer.addChild = function (child) {
        this.children.push(child);
        child.parent = this;
        return child;
      };
    }
    if (typeof layer.removeChild !== 'function') {
      layer.removeChild = function (child) {
        var at = this.children.indexOf(child);
        if (at > -1) this.children.splice(at, 1);
        if (child && child.parent === this) child.parent = null;
        return child;
      };
    }
    if (layer.constructor === Object) layer.constructor = { name: 'WindowLayer' };
    return layer;
  }

  /* The layer the current scene draws its windows on.

     Resolution order matters and is not arbitrary. `_windowLayer` is the
     engine's own field and wins outright. Failing that, a layer already
     sitting in the scene's children is ADOPTED rather than duplicated —
     fixtures.js builds one and never assigns the field, and creating a
     second would leave the fixture's windows on one layer and everything
     asked for here on another, with a check reading whichever it happened to
     find. Only when there is neither does the scene's own createWindowLayer
     run, which is the sibling stubs' method and stays theirs. */
  window.__windowLayer = function () {
    var scene = SceneManager._scene;
    if (!scene) return null;
    if (!scene._windowLayer) {
      var kids = scene.children || [];
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid && kid.constructor && kid.constructor.name === 'WindowLayer') {
          scene._windowLayer = kid;
          break;
        }
      }
    }
    if (!scene._windowLayer && typeof scene.createWindowLayer === 'function') {
      scene.createWindowLayer();
    }
    return adopt(scene._windowLayer);
  };

  /* Replay, once, the accessor effects the stub builders could not have:
     engine-mv.js:453 and engine-mz.js:348 assign `openness` before the parts
     exist, so the container never got scaled and no part got its alpha. The
     engines have no equivalent step — they assign the FIELD at that point —
     which is why this is a driver with a harness name and not a method.

     Idempotent, and safe on a window it has already settled. */
  window.__settleWindows = function (list) {
    var layer = window.__windowLayer();
    var wins = list || (layer ? layer.children : []);
    for (var i = 0; i < wins.length; i++) {
      var win = wins[i];
      if (!win || !SPEC || !win[SPEC.frame]) continue;
      partOf(win, SPEC.frame, 255);
      partOf(win, SPEC.back, SPEC.backAtBirth);
      partOf(win, SPEC.contents, 255);
      applyOpenness(win);
      /* and the engine's own step that ties the contents to isOpen(), under
         its real name — MV and MZ spell it differently because they gate a
         different object, and the spec carries whichever this engine has. */
      if (typeof win[SPEC.gateStep] === 'function') win[SPEC.gateStep]();
    }
    return wins;
  };

  /* Windows this file put on the layer, so that taking them away again takes
     away exactly those and leaves whatever the fixture built alone. */
  var ADDED = [];
  var MADE = {};

  /* Rough geometry per kind, so a handful of windows land where their real
     counterparts do and do not sit on top of one another. Sizes only; no
     check should assert on them. */
  function boxFor(kind) {
    var w = Graphics.boxWidth;
    var h = Graphics.boxHeight;
    if (kind === 'Window_Message') return [0, h - 180, w, 180];
    if (kind === 'Window_ScrollText') return [0, 0, w, h];
    if (kind === 'Window_Help') return [0, 0, w, 108];
    return [40, 40, 240, 120];
  }

  /* A class for a kind name. A kind the harness already declares is used as
     it is — Window_Message and Window_ScrollText come from core.js and carry
     their real methods. Anything else is synthesised as a Window_Base
     subclass, which is what nearly every window in either engine is, and is
     cached so that asking twice gives one class rather than two.

     A declared kind is built with its OWN constructor, so a class whose
     constructor demands arguments — x-equip.js:815's Window_ShopBuy forwards
     straight into initialize — is not a candidate here. The window surface is
     what this driver is for; a window with real content is that file's job.

     The name is checked against an identifier pattern before it reaches the
     Function constructor: a driver argument is still an argument. */
  function classFor(kind) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(kind)) {
      throw new Error('window kind must be an identifier, got: ' + kind);
    }
    if (typeof window[kind] === 'function') return window[kind];
    if (!MADE[kind]) {
      var made = new Function('return function ' + kind + '(){};')();
      made.prototype = Object.create(Window_Base.prototype);
      made.prototype.constructor = made;
      MADE[kind] = made;
    }
    return MADE[kind];
  }

  /* Put a handful of windows of different kinds on the current scene's
     window layer, through the scene's own addWindow where that exists —
     x-equip.js:620, which is the engine's route (MV rpg_scenes.js:175 /
     MZ rmmz_scenes.js:83) and adds to the LAYER rather than to the scene.

     The default set is deliberately mixed: a plain Window_Base, the message
     window the whole feature is about, the scrolling-text window that shares
     its base and none of its behaviour, and one ordinary named window so a
     walk meets something that is neither. Pass an array of kind names for
     anything else. */
  window.__addWindows = function (kinds) {
    var layer = window.__windowLayer();
    if (!layer) return [];
    var want = kinds || ['Window_Base', 'Window_Message', 'Window_ScrollText', 'Window_Help'];
    var scene = SceneManager._scene;
    var made = [];
    for (var i = 0; i < want.length; i++) {
      var kind = want[i];
      var box = boxFor(kind);
      var win = new (classFor(kind))();
      Window.prototype.initWindow.call(win, kind, box[0], box[1], box[2], box[3]);
      if (typeof scene.addWindow === 'function') scene.addWindow(win);
      else layer.addChild(win);
      ADDED.push({ layer: layer, win: win });
      made.push(win);
    }
    /* the whole layer, not just what was made: anything the fixture put there
       was built through the same builder and is in the same half-settled
       state, and a check reading the layer should not have to know which
       windows came from where. */
    window.__settleWindows();
    return made;
  };

  /* Take them away again, from the layer each was added to, and leave the
     scene as it was found. Returns how many went. */
  window.__clearWindows = function () {
    var gone = 0;
    while (ADDED.length) {
      var entry = ADDED.pop();
      if (entry.layer && typeof entry.layer.removeChild === 'function') {
        entry.layer.removeChild(entry.win);
        gone++;
      }
    }
    return gone;
  };

  /* What every window on the layer currently reads back through the four
     properties, plus the two flags that decide whether it is on screen at
     all, plus the names of the objects each property actually reached. The
     last part is the point: a check that expects "the frame is gone and the
     text is not" can say which object it means on this engine without
     knowing which engine it is on. */
  window.__windowState = function () {
    var layer = window.__windowLayer();
    var out = [];
    if (!layer) return out;
    for (var i = 0; i < layer.children.length; i++) {
      var win = layer.children[i];
      if (!win || !SPEC || !win[SPEC.frame]) continue;
      var gate = win[SPEC.gate];
      out.push({
        kind: win._name || (win.constructor && win.constructor.name) || 'window',
        opacity: win.opacity,
        backOpacity: win.backOpacity,
        contentsOpacity: win.contentsOpacity,
        openness: win.openness,
        visible: win.visible,
        contentsShown: gate ? gate.visible !== false : false,
        dimmed: !!(win._dimmerSprite && win._dimmerSprite.visible),
        parts: { frame: SPEC.frame, back: SPEC.back, contents: SPEC.contents, gate: SPEC.gate },
        layerVisible: layer.visible
      });
    }
    return out;
  };

}());
