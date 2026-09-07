/* =============================================================================
   GigaHack test harness — stubs/x-input-mz.js
   INPUT AND CONFIG: the DIVERGENT MZ surface. MZ 1.9.0 only.

   Modelled on MZ rmmz_core.js, rmmz_managers.js, rmmz_scenes.js.
   Loaded IMMEDIATELY AFTER engine-mz.js, which is after core.js and x-input.js.
   Everything shared is in x-input.js; only what MZ does DIFFERENTLY is here.

   The four MZ-only facts this file exists to carry:

     1. _virtualButton. MZ added a one-frame injection slot so the on-screen
        touch buttons can fake a keypress: Input.virtualClick(name) parks a
        name, and the NEXT update() forces _latestButton to it with
        _pressedTime 0 — i.e. it is TRIGGERED but never PRESSED, so
        isTriggered('ok') is true in a frame where isPressed('ok') is false.
        MV has no such thing; nothing there can produce that combination.

     2. _shouldPreventDefault lists Tab. MV's does not. On MZ a Tab keydown
        that reaches document is preventDefault()ed and focus does not move.

     3. ConfigManager is ASYNCHRONOUS. load() returns a Promise chain it does
        not wait on, so ConfigManager.alwaysDash still holds its old value when
        load() returns; _isLoaded/isLoaded() exist precisely because of that.
        MV's load() has finished applying by the time it returns.

     4. touchUI. An MZ-only flag that defaults to TRUE, which is only
        expressible because MZ's readFlag takes a default argument. MV's
        readFlag has no third parameter and every MV flag defaults to false.

   DELIBERATELY ABSENT: ResourceHandler. Grep every rmmz_*.js file — there is
   none. MZ throws ["LoadError", url, retry] and SceneManager.catchLoadError
   (rmmz_managers.js:2083) shows a retry button instead (MV-MZ-DELTA.md §A.5).
   MZ's Input._onKeyDown below is the plain form with no loader branch, and
   anything on this engine that reaches for ResourceHandler must throw.
   ========================================================================== */

/* -------------------------------------------------------------------------
   INPUT — boot.

   rmmz_core.js:5659. TWO steps. MV's has three: it also calls _wrapNwjsAlert
   (rpg_core.js:3206), a function MZ dropped entirely.
   ---------------------------------------------------------------------- */
Input.initialize = function () {
  this.clear();
  this._setupEventHandlers();
};

/* rmmz_core.js:5731 — TEN assignments. MV's clear (rpg_core.js:3055) has the
   first nine and stops; `_virtualButton` is the tenth and the whole delta.
   The harness counter is core.js's, carried across so run.js:765's
   "Input.clear() is called on open" check keeps working against the real body
   rather than against a one-line placeholder. */
Input.clear = function () {
  window.__inputCleared = (window.__inputCleared || 0) + 1;
  // what is held now, what was held last frame, and the pad snapshot
  this._currentState = {};
  this._previousState = {};
  this._gamepadStates = [];
  // the single-slot latch behind isTriggered / isRepeated / Input.date
  this._latestButton = null;
  this._pressedTime = 0;
  this._date = 0;
  // the resolved direction, and the axis _updateDirection is favouring
  this._dir4 = 0;
  this._dir8 = 0;
  this._preferredAxis = '';
  // the tenth field, and the only one MV's clear does not reset
  this._virtualButton = null;
};

/* Seeded to what clear() leaves, matching how x-input.js seeds the other nine:
   in the engine this field does not exist until Input.initialize() runs. */
Input._virtualButton = null;

/* rmmz_core.js:5747. Identical to MV's (rpg_core.js:3073) except for the
   _virtualButton block, which sits BETWEEN the for-in and _updateDirection.

   Read the block carefully — it is not a shortcut for "press this key". It
   overwrites _latestButton and zeroes _pressedTime WITHOUT touching
   _currentState, so for exactly one frame isTriggered(name) is true while
   isPressed(name) is false and isLongPressed(name) can never become true. It
   also clobbers whatever real key was triggered in the same frame. A mod that
   synthesises input through virtualClick gets a genuinely different state
   shape from one that writes _currentState directly, and only one of those two
   is available on MV at all.

   Everything MV's update does is here too, including the leak: _previousState
   is only written inside the for-in over _currentState, so a key deleted from
   _currentState is never removed from _previousState. */
Input.update = function () {
  window.__inputUpdates = (window.__inputUpdates || 0) + 1;
  this._pollGamepads();

  var held = this._currentState;
  var seen = this._previousState;

  // The latch survives the frame only while its own key is still down.
  if (held[this._latestButton]) {
    this._pressedTime++;
  } else {
    this._latestButton = null;
  }

  for (var name in held) {
    var down = held[name];
    if (down && !seen[name]) {
      this._latestButton = name;
      this._pressedTime = 0;
      this._date = Date.now();
    }
    // Only keys still IN _currentState are refreshed, hence the leak.
    seen[name] = down;
  }

  // AFTER the loop, so a parked virtual name outranks any real key triggered
  // in the same frame — and _currentState is never touched, nor is _date.
  if (this._virtualButton) {
    this._latestButton = this._virtualButton;
    this._pressedTime = 0;
    this._virtualButton = null;
  }

  this._updateDirection();
};

/* rmmz_core.js:5876 — MZ-ONLY, and the whole of it. It does not press
   anything, it parks a name for the next update() to consume. Note that it
   also does NOT set this._date, so Input.date does not move for a virtual
   click the way it does for a real key. */
Input.virtualClick = function (buttonName) {
  this._virtualButton = buttonName;
};

/* -------------------------------------------------------------------------
   INPUT — the sign helpers.

   rmmz_core.js:5991/:5997/:6003. Same answers as MV, different bodies: MZ
   subtracts two ternaries where MV increments and decrements a running total
   (rpg_core.js:3387/:3404), and _makeNumpadDirection inverts the condition —
   MZ tests "both are zero" first, MV tests "either is non-zero"
   (rpg_core.js:3424). Copied in each engine's own shape because the point of
   the two-engine harness is that nothing has been quietly merged.
   ---------------------------------------------------------------------- */
Input._signX = function () {
  var left = this.isPressed('left') ? 1 : 0;
  var right = this.isPressed('right') ? 1 : 0;
  return right - left;
};
Input._signY = function () {
  var up = this.isPressed('up') ? 1 : 0;
  var down = this.isPressed('down') ? 1 : 0;
  return down - up;
};
Input._makeNumpadDirection = function (x, y) {
  if (x === 0 && y === 0) {
    return 0;
  } else {
    return 5 - y * 3 + x;
  }
};

/* -------------------------------------------------------------------------
   INPUT — the keyboard handlers.
   ---------------------------------------------------------------------- */

/* rmmz_core.js:5886. MV's version (rpg_core.js:3236) has an extra branch:
   `if (ResourceHandler.exists() && buttonName === 'ok') ResourceHandler.retry()`
   ahead of this else. MZ has no ResourceHandler, so OK always lands in
   _currentState — there is no state on this engine in which the engine sees a
   key and does not record it. */
Input._onKeyDown = function (event) {
  var keyCode = event.keyCode;
  if (this._shouldPreventDefault(keyCode)) {
    event.preventDefault();
  }
  if (keyCode === 144) {
    // Numlock
    this.clear();
  }
  var buttonName = this.keyMapper[keyCode];
  if (buttonName) {
    this._currentState[buttonName] = true;
  }
};

/* rmmz_core.js:5900 — EIGHT key codes, all falling through to one `return
   true`. MV's (rpg_core.js:3257) has SEVEN: it is missing `case 9`, Tab. That
   one code is the delta, and it is the reason a Tab keydown reaching document
   moves browser focus on MV and does not on MZ. An overlay with focusable
   fields that relies on Tab has to stop the event before document on MZ; on MV
   it happens to work either way. (The engine writes the negative answer as a
   `return false` after the switch; a `default` arm says the same thing and
   keeps the whole decision inside one construct.) */
Input._shouldPreventDefault = function (keyCode) {
  switch (keyCode) {
  case 8:     // backspace
  case 9:     // tab
  case 33:    // pageup
  case 34:    // pagedown
  case 37:    // left arrow
  case 38:    // up arrow
  case 39:    // right arrow
  case 40:    // down arrow
    return true;
  default:
    return false;
  }
};

/* rmmz_core.js:5915 — FOUR lines. MV's (rpg_core.js:3277) has a trailing
   `if (event.keyCode === 0) this.clear();` for QtWebEngine on OS X that MZ
   dropped. A synthetic KeyboardEvent with no keyCode therefore wipes all input
   on MV and does nothing here. */
Input._onKeyUp = function (event) {
  var buttonName = this.keyMapper[event.keyCode];
  if (buttonName) {
    this._currentState[buttonName] = false;
  }
};

/* =============================================================================
   CONFIGMANAGER — MZ. rmmz_managers.js:431-533.

   ASYNCHRONOUS. MV-MZ-DELTA.md §C.13: MZ goes through
   StorageManager.saveObject/loadObject with the save NAME "config" (which
   StorageManager.filePath turns into config.rmmzsave, engine-mz.js:195) and
   both return Promises. MV goes through StorageManager.save/load with the
   magic savefileId -1 and both are done when they return.
   ========================================================================== */

/* :433 — MZ-ONLY, and the only stock flag on either engine that defaults to
   TRUE. Scene_MenuBase.needsCancelButton (rmmz_scenes.js:1286) and
   Window_Selectable's touch handling read it; MV has no equivalent, so
   reading ConfigManager.touchUI on MV comes back undefined. */
ConfigManager.touchUI = true;

/* :434 / :491 — MZ-ONLY, and they exist BECAUSE load() is async: without them
   there is no way to ask whether the config file has landed yet. MV needs no
   such thing. Scene_Boot polls isLoaded() before starting the game. */
ConfigManager._isLoaded = false;
ConfigManager.isLoaded = function () {
  return this._isLoaded;
};

/* :476. The delta that matters most: this RETURNS IMMEDIATELY and the chain
   resolves on a later microtask. ConfigManager.alwaysDash still holds its
   previous value on the line after the call. A check that does
   `ConfigManager.load(); assert(ConfigManager.alwaysDash === false)` passes on
   MV and fails here, which is exactly the kind of thing this harness exists to
   surface — so no await, no synchronous shortcut.

   Written with function expressions for the ES5 floor; the arrows in the
   source are `config => this.applyData(config || {})` and `() => 0`, and the
   `self` binding reproduces their lexical `this`. Note the DOUBLE catch: a
   throw inside applyData is swallowed by the first one and _isLoaded is still
   set to true by the next then — a config file that fails to apply still
   reports as loaded. */
ConfigManager.load = function () {
  var self = this;
  StorageManager.loadObject('config')
    .then(function (config) { return self.applyData(config || {}); })
    .catch(function () { return 0; })
    .then(function () {
      self._isLoaded = true;
      return 0;
    })
    .catch(function () { return 0; });
};

/* :487. Fire-and-forget: the returned Promise is DROPPED, so nothing can
   observe a failed write. engine-mz.js's saveObject rejects when
   window.__saveShouldFail is set, and this body proves that rejection goes
   nowhere — the unhandled rejection is the engine's, not the harness's.
   core.js's counters ride along so a check can count flushes without
   unpacking StorageManager. */
ConfigManager.save = function () {
  this.saves++;
  window.__configSaves = (window.__configSaves || 0) + 1;
  StorageManager.saveObject('config', this.makeData());
};

/* :495. SEVEN keys — MV's makeData (rpg_managers.js:529) writes SIX. touchUI
   is the extra one. An MZ config round-tripped through an MV build loses it. */
ConfigManager.makeData = function () {
  return {
    alwaysDash: this.alwaysDash,
    commandRemember: this.commandRemember,
    touchUI: this.touchUI,
    bgmVolume: this.bgmVolume,
    bgsVolume: this.bgsVolume,
    meVolume: this.meVolume,
    seVolume: this.seVolume
  };
};

/* :507. Every readFlag call passes a DEFAULT. MV's applyData
   (rpg_managers.js:540) passes none, because MV's readFlag has no third
   parameter — which is why touchUI, a flag that must default to true, could
   not have been written on MV without changing readFlag first. */
ConfigManager.applyData = function (config) {
  this.alwaysDash = this.readFlag(config, 'alwaysDash', false);
  this.commandRemember = this.readFlag(config, 'commandRemember', false);
  this.touchUI = this.readFlag(config, 'touchUI', true);
  // The four volume names are also the four ConfigManager accessors, and each
  // write lands on AudioManager — so the order below is the order the mixer
  // sees, and it is the engine's. Identical to MV's; only the flags differ.
  var channels = ['bgmVolume', 'bgsVolume', 'meVolume', 'seVolume'];
  for (var i = 0; i < channels.length; i++) {
    this[channels[i]] = this.readVolume(config, channels[i]);
  }
};

/* :517. THREE parameters and an `in` test. MV's is the one-liner
   `return !!config[name];` (rpg_managers.js:549) — two parameters, no default,
   and an absent key is indistinguishable from a false one. Here an absent key
   yields defaultValue UNCOERCED, so readFlag(config, 'x', undefined) returns
   undefined rather than false. */
ConfigManager.readFlag = function (config, name, defaultValue) {
  if (name in config) {
    return !!config[name];
  } else {
    return defaultValue;
  }
};

/* :525. Tests `name in config`. MV tests the VALUE against undefined
   (rpg_managers.js:553), so a config object carrying an explicit
   `{ bgmVolume: undefined }` reads as 100 on MV and as NaN here —
   Number(undefined) is NaN and NaN.clamp(0, 100) is NaN. A plugin that writes
   its options object by assigning every known key, defined or not, is the way
   that shape actually arises. */
ConfigManager.readVolume = function (config, name) {
  if (name in config) {
    return Number(config[name]).clamp(0, 100);
  } else {
    return 100;
  }
};

/* =============================================================================
   SCENE_OPTIONS — the MZ-only sizing seam.

   Scene_Options itself, and its terminate() (the ConfigManager.save() point),
   are byte-identical between the engines and live in x-input.js. These two are
   MZ additions with no MV counterpart at all: MV's options window sizes itself
   from its own command list and Scene_Options never asks how many rows there
   are. A mod that adds an option row is supposed to raise maxCommands here,
   and has nothing to raise on MV.
   ========================================================================== */

/* rmmz_scenes.js:2230 — the comment is the engine's own. */
Scene_Options.prototype.maxCommands = function () {
  // Increase this value when adding option items.
  return 7;
};
/* rmmz_scenes.js:2235 */
Scene_Options.prototype.maxVisibleCommands = function () {
  return 12;
};

/* NOT MODELLED: optionsWindowRect (rmmz_scenes.js:2221) needs Graphics.boxWidth
   /boxHeight (core.js has both) but also Scene_Base.prototype.calcWindowHeight
   and a Window_Options to hand the Rectangle to — window-area concerns that
   this file does not own. The two counts above are pure numbers with no
   dependencies, so they are here; the geometry is not. */
