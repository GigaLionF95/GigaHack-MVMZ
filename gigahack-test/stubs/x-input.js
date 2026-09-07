/* =============================================================================
   GigaHack test harness — stubs/x-input.js
   INPUT AND CONFIG: everything RPG Maker MV 1.6.1 and MZ 1.9.0 agree on.

   Modelled on the shipped engine sources, awkward BEHAVIOUR included — the
   citations name where each fact was read, the expression here is our own:
     MV = MV rpg_core.js, rpg_managers.js, rpg_scenes.js
     MZ = MZ rmmz_core.js, rmmz_managers.js, rmmz_scenes.js
   A single file:line reference means the two are the same there; a pair means
   both were read and both say this.

   Loaded IMMEDIATELY AFTER core.js, so engine-mv.js / engine-mz.js and then
   x-input-mv.js / x-input-mz.js still get the last word on everything that
   diverges.

   WHAT THIS FILE OVERWRITES, AND WHY.
   core.js ships a four-member Input (keyMapper, _currentState, _previousState,
   clear/update/isPressed/isTriggered) whose update() is a wholesale snapshot
   and whose isTriggered() is `pressed && !wasPressed`. That is not what the
   engine does. The engine routes EVERY edge through a single _latestButton +
   _pressedTime pair, which means:
     - only ONE button can be "triggered" per frame, whichever won the for-in;
     - isTriggered stays true for as long as _pressedTime is 0, not for one
       frame;
     - isRepeated and isLongPressed exist at all.
   A stub with the convenient two-state form passes a hotkey test that the real
   engine fails the moment a second key is down. So clear/update/isPressed/
   isTriggered are REPLACED here (and in the per-engine files) with the engine
   bodies. keyMapper is NOT touched — core.js already carries all 24 entries and
   Profile derives GigaHack's free letters by subtracting it.
   The two harness counters core.js hangs off clear() and update()
   (window.__inputCleared, window.__inputUpdates) are carried across verbatim,
   because run.js:765 asserts on __inputCleared.

   ConfigManager is likewise ADDED TO, never replaced: core.js's alwaysDash and
   its save()-with-counter stay, and everything the engine has beside them is
   written here or in the per-engine file.
   ========================================================================== */

/* -------------------------------------------------------------------------
   INPUT — the static state.

   MV rpg_core.js:2984/:2993 / MZ rmmz_core.js:5669/:5676 — identical numbers.
   These two are the whole of the repeat model: nothing repeats before frame 24
   and then it repeats every 6th frame. A panel that polls isRepeated at 60fps
   and a panel that polls it once per its own tick get very different answers.
   ---------------------------------------------------------------------- */
Input.keyRepeatWait = 24;
Input.keyRepeatInterval = 6;

/* MV rpg_core.js:3036 / MZ rmmz_core.js:5715 — byte-identical, 10 entries.
   Note what is NOT in it: no 'tab', no 'debug', no 'escape' — on a gamepad
   'cancel' is a first-class name that the keyboard table never produces, and
   _isEscapeCompatible below is the bridge between the two vocabularies. */
Input.gamepadMapper = {
  0: 'ok',        // A
  1: 'cancel',    // B
  2: 'shift',     // X
  3: 'menu',      // Y
  4: 'pageup',    // LB
  5: 'pagedown',  // RB
  12: 'up',       // D-pad up
  13: 'down',     // D-pad down
  14: 'left',     // D-pad left
  15: 'right'     // D-pad right
};

/* The fields clear() creates. In the engine they do not exist until
   Input.initialize() -> Input.clear() runs from the boot path, so a real game
   never observes them absent; they are seeded here to the exact values clear()
   would leave, so a check that reads Input.dir4 before calling
   Input.initialize() gets 0 rather than undefined.
   MV rpg_core.js:3055-3066 / MZ rmmz_core.js:5731-5743 (MZ adds _virtualButton,
   which is seeded in x-input-mz.js, not here).
   _currentState and _previousState are already on core.js's literal — left
   alone rather than re-seeded, so nothing here can quietly wipe a fixture. */
Input._gamepadStates = [];
Input._latestButton = null;
Input._pressedTime = 0;
Input._dir4 = 0;
Input._dir8 = 0;
Input._preferredAxis = '';
Input._date = 0;

/* -------------------------------------------------------------------------
   INPUT — the four public predicates.

   MV rpg_core.js:3099/:3115/:3131/:3150 / MZ rmmz_core.js:5776/:5790/:5804/:5823.
   Byte-identical bodies. Every one of them opens with the same escape-compat
   recursion, so asking for 'cancel' or 'menu' also answers for 'escape' — that
   is why an overlay bound to Escape is indistinguishable from the game's own
   cancel unless the event is stopped before Input ever sees it.
   ---------------------------------------------------------------------- */
Input.isPressed = function (keyName) {
  if (this._isEscapeCompatible(keyName) && this.isPressed('escape')) {
    return true;
  } else {
    return !!this._currentState[keyName];
  }
};
Input.isTriggered = function (keyName) {
  if (this._isEscapeCompatible(keyName) && this.isTriggered('escape')) {
    return true;
  } else {
    return this._latestButton === keyName && this._pressedTime === 0;
  }
};
Input.isRepeated = function (keyName) {
  if (this._isEscapeCompatible(keyName) && this.isRepeated('escape')) {
    return true;
  } else {
    return (this._latestButton === keyName &&
            (this._pressedTime === 0 ||
             (this._pressedTime >= this.keyRepeatWait &&
              this._pressedTime % this.keyRepeatInterval === 0)));
  }
};
Input.isLongPressed = function (keyName) {
  if (this._isEscapeCompatible(keyName) && this.isLongPressed('escape')) {
    return true;
  } else {
    return (this._latestButton === keyName &&
            this._pressedTime >= this.keyRepeatWait);
  }
};

/* MV rpg_core.js:3438 / MZ rmmz_core.js:6011 — byte-identical. */
Input._isEscapeCompatible = function (keyName) {
  return keyName === 'cancel' || keyName === 'menu';
};

/* -------------------------------------------------------------------------
   INPUT — dir4 / dir8 / date, read-only accessors.
   MV rpg_core.js:3166/:3180/:3194 / MZ rmmz_core.js:5841/:5855/:5869.
   All three are `configurable: true` and getter-only in both engines, so an
   assignment to Input.dir4 is silently dropped in sloppy mode and throws in
   strict mode. Defining them as plain fields would make a mod that writes
   Input.dir4 appear to work here and fail on every real game.
   ---------------------------------------------------------------------- */
Object.defineProperty(Input, 'dir4', {
  get: function () { return this._dir4; },
  configurable: true
});
Object.defineProperty(Input, 'dir8', {
  get: function () { return this._dir8; },
  configurable: true
});
Object.defineProperty(Input, 'date', {
  get: function () { return this._date; },
  configurable: true
});

/* -------------------------------------------------------------------------
   INPUT — direction resolution.

   MV rpg_core.js:3361 / MZ rmmz_core.js:5973 — identical logic. _signX/_signY
   and _makeNumpadDirection are written DIFFERENTLY by the two engines (same
   results, different shapes) and live in the per-engine files.

   _preferredAxis is the subtle one. It is written ONLY while exactly one axis
   is live, and it names the axis that will SURVIVE the next diagonal — and it
   is set to the axis that is NOT currently down. So holding Right and then
   adding Down gives you Down: the arrow that joined last wins, and the
   decision outlives the diagonal because the both-live branch never touches
   _preferredAxis. That persistence is why an overlay that swallows one arrow
   but not the other leaves the player walking in the axis it did not swallow.
   ---------------------------------------------------------------------- */
Input._updateDirection = function () {
  var sx = this._signX();
  var sy = this._signY();

  /* dir8 is read off the RAW pair, before anything is discarded, which is why
     dir8 can say "down-right" in the very frame dir4 says "down". */
  this._dir8 = this._makeNumpadDirection(sx, sy);

  if (sx !== 0 && sy !== 0) {
    /* Diagonal: zero the loser and leave _preferredAxis alone. Only the
       literal 'x' keeps x; the seed value '' therefore keeps y, so a diagonal
       arriving with no history at all resolves vertically. */
    if (this._preferredAxis === 'x') { sy = 0; } else { sx = 0; }
  } else if (sx !== 0 || sy !== 0) {
    /* One arrow: elect the OTHER axis for next time. */
    this._preferredAxis = sy === 0 ? 'y' : 'x';
  }
  /* Neither arrow down: _preferredAxis keeps whatever it held. */

  this._dir4 = this._makeNumpadDirection(sx, sy);
};

/* -------------------------------------------------------------------------
   INPUT — event plumbing.

   MV rpg_core.js:3224 / MZ rmmz_core.js:5880 — byte-identical, and
   MV-MZ-DELTA.md §E.6 says so. BOTH engines bind keydown/keyup on `document`
   in the BUBBLE phase and blur on `window`. That is the fact the overlay's
   two-tier key strategy rests on: a capture-phase listener on `window` runs
   before the engine on both, and a bubble-phase stopPropagation on the host
   element stops the engine ever seeing a key typed into the UI — on both.

   Calling this binds real listeners on the harness document, which is the
   point: it is how a check proves the mod's capture listener actually wins.
   ---------------------------------------------------------------------- */
Input._setupEventHandlers = function () {
  document.addEventListener('keydown', this._onKeyDown.bind(this));
  document.addEventListener('keyup', this._onKeyUp.bind(this));
  window.addEventListener('blur', this._onLostFocus.bind(this));
};

/* MV rpg_core.js:3292 / MZ rmmz_core.js:5922 — `this.clear()` in both. Losing
   focus wipes EVERY held key, so an overlay that opens a native prompt hands
   the game a clean slate whether it wanted to or not. */
Input._onLostFocus = function () {
  this.clear();
};

/* -------------------------------------------------------------------------
   INPUT — gamepads.

   MV rpg_core.js:3301 / MZ rmmz_core.js:5926. Semantically identical; the only
   difference is that MZ iterates with `for (const gamepad of gamepads)` where
   MV indexes. The ES5 floor forces the indexed form here, and nothing observable
   turns on it — GamepadList is both indexable and iterable — so this is the one
   place in this file where the two shapes are deliberately merged, named rather
   than hidden.

   In a headless Chromium navigator.getGamepads() returns four nulls, so this
   is a no-op unless a fixture installs a fake pad. That absence is honest: the
   harness is a browser build with no controller attached.
   ---------------------------------------------------------------------- */
Input._pollGamepads = function () {
  /* Both guards are real: an engine-era browser may not expose getGamepads at
     all, and a browser that does may still hand back null rather than a list.
     Neither case is an error and neither clears anything already held. */
  if (!navigator.getGamepads) return;
  var pads = navigator.getGamepads();
  if (!pads) return;
  for (var i = 0; i < pads.length; i++) {
    /* The list is sparse — disconnected slots come back null — and a pad that
       is present but not `connected` is skipped without being cleared. */
    var pad = pads[i];
    if (pad && pad.connected) this._updateGamepadState(pad);
  }
};

/* MV rpg_core.js:3322 / MZ rmmz_core.js:5939 — the two engines agree here down
   to the whitespace, so one body serves both. Three things it does that a
   naive snapshot would not, each called out where it happens below: the D-pad
   slots are seeded before the buttons are read, the analog stick is folded
   into those same slots before the mapper runs, and only CHANGED slots reach
   _currentState. */
Input._updateGamepadState = function (gamepad) {
  var UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
  var THRESHOLD = 0.5;
  var buttons = gamepad.buttons;
  var axes = gamepad.axes;
  var previous = this._gamepadStates[gamepad.index] || [];
  var current = [];
  var i;

  /* Seed the four D-pad slots first, then let the real buttons overwrite
     them. Two consequences worth knowing:
       - the array is at least 16 long even for a three-button pad, and the
         gap between buttons.length and 12 stays a HOLE (undefined), which the
         edge filter below then never reports as a change;
       - a pad that really does have 16 buttons has its own 12-15 win, because
         the button loop runs after this. */
  current[UP] = current[DOWN] = current[LEFT] = current[RIGHT] = false;
  for (i = 0; i < buttons.length; i++) {
    current[i] = buttons[i].pressed;
  }

  /* The analog stick is folded INTO the D-pad slots, before the mapper runs,
     which is why nothing downstream can tell a stick from a D-pad. Note the
     fold only ever turns a slot ON: a centred stick does not turn one off, so
     a genuine D-pad press on button 12-15 survives a neutral axis. */
  function fold(axis, negative, positive) {
    if (axis < -THRESHOLD) current[negative] = true;
    else if (axis > THRESHOLD) current[positive] = true;
  }
  fold(axes[1], UP, DOWN);
  fold(axes[0], LEFT, RIGHT);

  /* EDGE FILTER. Only slots whose value CHANGED since the last poll are
     written through to _currentState. A held button therefore asserts itself
     exactly once, so anything that wipes _currentState behind the engine's
     back loses that press until the pad releases and presses again. */
  for (i = 0; i < current.length; i++) {
    if (current[i] === previous[i]) continue;
    var name = this.gamepadMapper[i];
    if (name) this._currentState[name] = current[i];
  }

  this._gamepadStates[gamepad.index] = current;
};

/* =============================================================================
   AUDIOMANAGER — the volume surface only.

   This exists here because ConfigManager's four volume properties are pure
   pass-throughs to it (see below): without a real AudioManager backing them,
   `ConfigManager.bgmVolume = 80` writes into nothing and reads back 100, and
   a config panel would test green against a stub that cannot hold a value.
   The rest of AudioManager — buffers, playback, WebAudio — is NOT modelled
   here; only the fields and methods the volume accessors touch.

   MV rpg_managers.js:1105-1108 / MZ rmmz_managers.js:1107-1110.
   MV rpg_managers.js:1132/:1143/:1154/:1165 vs MZ rmmz_managers.js:1121/:1132/
   :1143/:1154 — the four accessor bodies are byte-identical, so they are shared.
   DELTA WORTH NAMING BUT NOT MODELLED HERE: MV also defines
   AudioManager.masterVolume (rpg_managers.js:1120), whose setter reaches into
   WebAudio.setMasterVolume and Graphics.setVideoVolume. MZ 1.9.0 has NO
   masterVolume at all (grep rmmz_managers.js: zero matches). A mod that offers
   a master-volume slider works on MV and writes a dead property on MZ.
   ========================================================================== */
AudioManager._bgmVolume = 100;
AudioManager._bgsVolume = 100;
AudioManager._meVolume = 100;
AudioManager._seVolume = 100;
AudioManager._currentBgm = null;
AudioManager._currentBgs = null;
AudioManager._bgmBuffer = null;
AudioManager._bgsBuffer = null;
AudioManager._meBuffer = null;

Object.defineProperty(AudioManager, 'bgmVolume', {
  get: function () { return this._bgmVolume; },
  set: function (value) {
    this._bgmVolume = value;
    this.updateBgmParameters(this._currentBgm);
  },
  configurable: true
});
Object.defineProperty(AudioManager, 'bgsVolume', {
  get: function () { return this._bgsVolume; },
  set: function (value) {
    this._bgsVolume = value;
    this.updateBgsParameters(this._currentBgs);
  },
  configurable: true
});
Object.defineProperty(AudioManager, 'meVolume', {
  get: function () { return this._meVolume; },
  set: function (value) {
    this._meVolume = value;
    /* `this._currentMe` is never assigned ANYWHERE in either engine — grep
       both files. The setter therefore always hands updateBufferParameters an
       undefined `audio` and the guard below turns the call into a no-op. Kept
       exactly as shipped: a stub that "fixed" it would be modelling a game
       nobody has. */
    this.updateMeParameters(this._currentMe);
  },
  configurable: true
});
Object.defineProperty(AudioManager, 'seVolume', {
  get: function () { return this._seVolume; },
  /* The odd one out: no update call, because SE buffers are one-shot. */
  set: function (value) { this._seVolume = value; },
  configurable: true
});

/* MV rpg_managers.js:1229/:1294/:1343 / MZ rmmz_managers.js:1199/:1267/:1316. */
AudioManager.updateBgmParameters = function (bgm) {
  this.updateBufferParameters(this._bgmBuffer, this._bgmVolume, bgm);
};
AudioManager.updateBgsParameters = function (bgs) {
  this.updateBufferParameters(this._bgsBuffer, this._bgsVolume, bgs);
};
AudioManager.updateMeParameters = function (me) {
  this.updateBufferParameters(this._meBuffer, this._meVolume, me);
};
/* MV rpg_managers.js:1476 / MZ rmmz_managers.js:1458 — identical but for MZ's
   extra parentheses around the volume product. The `if (buffer && audio)` is
   the engine's own guard, not a harness softening: with no buffer playing,
   setting a volume does nothing but store the number. */
AudioManager.updateBufferParameters = function (buffer, configVolume, audio) {
  if (buffer && audio) {
    buffer.volume = configVolume * (audio.volume || 0) / 10000;
    buffer.pitch = (audio.pitch || 0) / 100;
    buffer.pan = (audio.pan || 0) / 100;
  }
};

/* =============================================================================
   CONFIGMANAGER — the parts that agree.

   core.js already has `alwaysDash` and a save() that counts. Both are left
   exactly as they are; save() is REPLACED per engine (the two write through
   completely different storage APIs) but keeps core.js's counters.

   NOT DEFINED HERE, ON PURPOSE: instantText and skipUnseen. They exist on
   NEITHER engine — they are third-party plugin fields the mod probes for
   (MV-MZ-DELTA.md §C.13). core.js says the same; repeating the omission here
   so nobody adds them while filling this class out.
   ========================================================================== */

/* MV rpg_managers.js:469 / MZ rmmz_managers.js:432 — `false` in both.
   (core.js seeds alwaysDash `true`, which is a harness choice, not the engine
   default; both engines ship it `false`. Either way applyData overwrites it
   from the file on the first load, so the seed only matters before boot.)
   touchUI is MZ-ONLY and lives in x-input-mz.js. */
ConfigManager.commandRemember = false;

/* MV rpg_managers.js:471-509 / MZ rmmz_managers.js:436-474 — byte-identical
   in both engines, including the ASYMMETRY: bgmVolume's getter reads the
   PRIVATE AudioManager._bgmVolume while the other three read the public
   accessor. It makes no observable difference (the public getter just returns
   the private field) and it is preserved rather than tidied, because a mod
   that monkey-patches AudioManager's bgmVolume getter to add a master gain
   will find ConfigManager.bgmVolume routing around it — and that asymmetry is
   the only reason why. */
Object.defineProperty(ConfigManager, 'bgmVolume', {
  get: function () { return AudioManager._bgmVolume; },
  set: function (value) { AudioManager.bgmVolume = value; },
  configurable: true
});
Object.defineProperty(ConfigManager, 'bgsVolume', {
  get: function () { return AudioManager.bgsVolume; },
  set: function (value) { AudioManager.bgsVolume = value; },
  configurable: true
});
Object.defineProperty(ConfigManager, 'meVolume', {
  get: function () { return AudioManager.meVolume; },
  set: function (value) { AudioManager.meVolume = value; },
  configurable: true
});
Object.defineProperty(ConfigManager, 'seVolume', {
  get: function () { return AudioManager.seVolume; },
  set: function (value) { AudioManager.seVolume = value; },
  configurable: true
});

/* =============================================================================
   SCENE_MENUBASE / SCENE_OPTIONS — the config-write seam.

   Only what a panel needs. The point of having Scene_Options here at all is
   its terminate(): it is the single place the stock engine flushes the config
   file, on BOTH engines, and it runs on the way OUT of the options scene. A
   mod that writes a ConfigManager field while the options scene is open has
   its value overwritten by whatever the options window holds; a mod that
   writes one while the scene is closed must call ConfigManager.save() itself.
   ========================================================================== */

/* MV rpg_scenes.js:898 / MZ rmmz_scenes.js:1180. MZ's constructor is written
   `this.initialize(...arguments)` and MV's `this.initialize.apply(this,
   arguments)`; identical behaviour, and the ES5 floor picks MV's form. */
function Scene_MenuBase() {
  this.initialize.apply(this, arguments);
}
Scene_MenuBase.prototype = Object.create(Scene_Base.prototype);
Scene_MenuBase.prototype.constructor = Scene_MenuBase;

/* MV rpg_scenes.js:905 / MZ rmmz_scenes.js:1187 — both are the single line
   `Scene_Base.prototype.initialize.call(this);`.
   WHAT IS LEFT OUT AND WHY: core.js's Scene_Base is a bare
   `function Scene_Base() { }` with prototype methods but NO initialize (the
   Stage / scene-graph surface is not modelled in this file, and the two
   engines' Scene_Base.initialize bodies differ — MV seeds _imageReservationId,
   MZ seeds _started and calls createColorFilter). Making the super call here
   would throw on construction. The call this stub could not make is named
   rather than silently dropped, and the counter is how a check asks whether
   the chain ran at all. */
Scene_MenuBase.prototype.initialize = function () {
  window.__menuBaseInits = (window.__menuBaseInits || 0) + 1;
};

/* NOT MODELLED, and worth knowing about: MZ's Scene_MenuBase carries an entire
   button/help-area surface MV has none of — create() calls createButtons()
   (rmmz_scenes.js:1191), update() calls updatePageButtons() (:1199), plus
   helpAreaTop/helpAreaBottom/helpAreaHeight/mainAreaTop/mainAreaBottom/
   mainAreaHeight (:1204-1238), needsCancelButton/createCancelButton
   (:1286/:1290) and needsPageButtons/createPageButtons (:1297/:1301).
   needsCancelButton reads ConfigManager.touchUI, which is the MZ-only flag
   defined in x-input-mz.js. None of it is the config-write seam, so none of it
   is stubbed; it is listed so that its absence reads as a decision. */

/* MV rpg_scenes.js:1584 / MZ rmmz_scenes.js:2193 — same constructor split as
   above. */
function Scene_Options() {
  this.initialize.apply(this, arguments);
}
Scene_Options.prototype = Object.create(Scene_MenuBase.prototype);
Scene_Options.prototype.constructor = Scene_Options;

/* MV rpg_scenes.js:1591 / MZ rmmz_scenes.js:2200 — identical. */
Scene_Options.prototype.initialize = function () {
  Scene_MenuBase.prototype.initialize.call(this);
};

/* MV rpg_scenes.js:1600 / MZ rmmz_scenes.js:2209 — BYTE-IDENTICAL, both:
       Scene_MenuBase.prototype.terminate.call(this);
       ConfigManager.save();
   Scene_MenuBase has no terminate of its own on either engine, so that first
   call resolves up the chain to Scene_Base.prototype.terminate (core.js).
   The counter is the harness's own, so a check can prove the flush happened
   without reaching into StorageManager. */
Scene_Options.prototype.terminate = function () {
  Scene_MenuBase.prototype.terminate.call(this);
  window.__optionsTerminates = (window.__optionsTerminates || 0) + 1;
  ConfigManager.save();
};

/* NOT MODELLED: create()/createOptionsWindow() on both (MV :1595/:1605,
   MZ :2204/:2214) build a Window_Options, which is a window-area concern and
   would drag in the whole options command list. MZ's optionsWindowRect
   (:2221), maxCommands (:2230) and maxVisibleCommands (:2235) are MZ-only and
   the two cheap ones are in x-input-mz.js. */
