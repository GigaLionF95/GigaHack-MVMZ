/* =============================================================================
   GigaHack test harness — stubs/x-input-mv.js
   INPUT AND CONFIG: the DIVERGENT MV surface. MV 1.6.1 only.

   Copied from /root/work/mv/js/rpg_core.js, rpg_managers.js.
   Loaded IMMEDIATELY AFTER engine-mv.js, which is after core.js and x-input.js.
   Everything shared is in x-input.js; only what MV does DIFFERENTLY is here.

   The three MV-only facts this file exists to carry:

     1. ResourceHandler. When an asset fails to load, MV does not throw — it
        parks a reloader, stops the scene manager and waits for the player to
        press OK. Input._onKeyDown is wired straight into that: on MV, 'ok' is
        SWALLOWED whenever a reload is pending and never reaches _currentState.
        MZ has no ResourceHandler at all (MV-MZ-DELTA.md §A.5) and its
        _onKeyDown is the plain two-line form.

     2. _shouldPreventDefault does NOT list Tab. MZ's does. So on MV a Tab
        keydown that reaches document keeps its default browser behaviour and
        moves focus; on MZ the engine kills it. An overlay with focusable
        fields behaves differently on the two engines for that one key.

     3. ConfigManager is SYNCHRONOUS here. load() reads, parses and applies
        before it returns; save() writes before it returns. On MZ both are
        Promise chains and neither has happened when the call returns.
   ========================================================================== */

/* -------------------------------------------------------------------------
   INPUT — boot.

   rpg_core.js:2971. MV's initialize has THREE steps; MZ's has two. The extra
   one is _wrapNwjsAlert, which replaces window.alert so that dismissing a
   native alert refocuses the window and clears held keys. It only fires under
   NW.js, and core.js's Utils.isNwjs() returns false, so in the harness this is
   an installed-but-inert branch — which is the honest state for a browser
   build and is exactly why the wrapper is copied rather than skipped.
   ---------------------------------------------------------------------- */
Input.initialize = function () {
  this.clear();
  this._wrapNwjsAlert();
  this._setupEventHandlers();
};

/* rpg_core.js:3206 — MV-ONLY. Nothing like it exists in rmmz_core.js.
   Copied verbatim including the require('nw.gui') that can never run here. */
Input._wrapNwjsAlert = function () {
  if (Utils.isNwjs()) {
    var _alert = window.alert;
    window.alert = function () {
      var gui = require('nw.gui');
      var win = gui.Window.get();
      _alert.apply(this, arguments);
      win.focus();
      Input.clear();
    };
  }
};

/* rpg_core.js:3055 — nine assignments. MZ's has a TENTH (_virtualButton).
   The harness counter is core.js's, carried across so run.js:765's
   "Input.clear() is called on open" check keeps working against the real body
   rather than against a one-line placeholder. */
Input.clear = function () {
  window.__inputCleared = (window.__inputCleared || 0) + 1;
  this._currentState = {};
  this._previousState = {};
  this._gamepadStates = [];
  this._latestButton = null;
  this._pressedTime = 0;
  this._dir4 = 0;
  this._dir8 = 0;
  this._preferredAxis = '';
  this._date = 0;
};

/* rpg_core.js:3073. MZ's update is this plus a _virtualButton block wedged
   between the for-in and _updateDirection.

   Two things a convenient stub loses. First, _previousState is written INSIDE
   the for-in over _currentState, so a key that is deleted from _currentState
   is never removed from _previousState — the engine leaks stale entries and a
   snapshot-style stub does not. Second, _latestButton is a SINGLE slot: with
   two keys going down in the same frame only the last one the for-in visits
   is "triggered", and isTriggered for the other returns false for as long as
   both are held. Anything asserting on multi-key hotkeys has to see that. */
Input.update = function () {
  window.__inputUpdates = (window.__inputUpdates || 0) + 1;
  this._pollGamepads();
  if (this._currentState[this._latestButton]) {
    this._pressedTime++;
  } else {
    this._latestButton = null;
  }
  for (var name in this._currentState) {
    if (this._currentState[name] && !this._previousState[name]) {
      this._latestButton = name;
      this._pressedTime = 0;
      this._date = Date.now();
    }
    this._previousState[name] = this._currentState[name];
  }
  this._updateDirection();
};

/* -------------------------------------------------------------------------
   INPUT — the sign helpers.

   rpg_core.js:3387/:3404/:3424. Same answers as MZ, different bodies: MV
   increments and decrements a running total, MZ subtracts two ternaries
   (rmmz_core.js:5991/:5997). _makeNumpadDirection likewise inverts the
   condition (MV tests "either is non-zero", MZ tests "both are zero"). Copied
   in each engine's own shape because the point of the two-engine harness is
   that nothing has been quietly merged.
   ---------------------------------------------------------------------- */
Input._signX = function () {
  var x = 0;

  if (this.isPressed('left')) {
    x--;
  }
  if (this.isPressed('right')) {
    x++;
  }
  return x;
};
Input._signY = function () {
  var y = 0;

  if (this.isPressed('up')) {
    y--;
  }
  if (this.isPressed('down')) {
    y++;
  }
  return y;
};
Input._makeNumpadDirection = function (x, y) {
  if (x !== 0 || y !== 0) {
    return  5 - y * 3 + x;
  }
  return 0;
};

/* -------------------------------------------------------------------------
   INPUT — the keyboard handlers. THIS is where MV and MZ part company.
   ---------------------------------------------------------------------- */

/* rpg_core.js:3236. The ResourceHandler branch is MV-only (MV-MZ-DELTA.md
   §C.4). Read the else-if: while a reload is pending, 'ok' triggers a RETRY
   and is never written into _currentState — so on MV the OK key is not merely
   consumed by the game, it is consumed by the loader, and a mod that measures
   "did the engine see my key" gets a different answer on a game with a broken
   asset than on a healthy one. */
Input._onKeyDown = function (event) {
  if (this._shouldPreventDefault(event.keyCode)) {
    event.preventDefault();
  }
  if (event.keyCode === 144) {    // Numlock
    this.clear();
  }
  var buttonName = this.keyMapper[event.keyCode];
  if (ResourceHandler.exists() && buttonName === 'ok') {
    ResourceHandler.retry();
  } else if (buttonName) {
    this._currentState[buttonName] = true;
  }
};

/* rpg_core.js:3257 — SEVEN cases. MZ's list (rmmz_core.js:5900) has EIGHT: it
   adds `case 9` for Tab. That single missing case is the whole delta, and it
   is the reason Tab moves focus normally on an MV game and does not on MZ. */
Input._shouldPreventDefault = function (keyCode) {
  switch (keyCode) {
  case 8:     // backspace
  case 33:    // pageup
  case 34:    // pagedown
  case 37:    // left arrow
  case 38:    // up arrow
  case 39:    // right arrow
  case 40:    // down arrow
    return true;
  }
  return false;
};

/* rpg_core.js:3277. MV has a trailing `if (event.keyCode === 0) this.clear();`
   for QtWebEngine on OS X that MZ dropped (rmmz_core.js:5915 is the first four
   lines only). A synthetic KeyboardEvent with no keyCode therefore wipes all
   input on MV and does nothing on MZ — which matters, because a synthesised
   keyup is exactly what a UI toolkit emits. */
Input._onKeyUp = function (event) {
  var buttonName = this.keyMapper[event.keyCode];
  if (buttonName) {
    this._currentState[buttonName] = false;
  }
  if (event.keyCode === 0) {  // For QtWebEngine on OS X
    this.clear();
  }
};

/* -------------------------------------------------------------------------
   RESOURCEHANDLER — rpg_core.js:9275-9320. MV-ONLY.

   MV-MZ-DELTA.md §A.5: MZ replaced the whole thing with a
   `["LoadError", url, retry]` throw caught by SceneManager.catchLoadError
   (rmmz_managers.js:2083). Nothing named ResourceHandler exists in any
   rmmz_*.js file, so x-input-mz.js deliberately defines none — an MZ check
   that reaches for it must fail, not find a courtesy shim.

   The retry ladder is the behaviour worth having: the first three failures
   are retried on a timer, and only the FOURTH parks a reloader and stops the
   engine. Until then ResourceHandler.exists() is false and Input._onKeyDown
   above behaves normally, which is why "press OK to retry" is not always live.
   ---------------------------------------------------------------------- */
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

/* rpg_core.js:3308 — the predicate Input._onKeyDown consults every keystroke. */
ResourceHandler.exists = function () {
  return this._reloaders.length > 0;
};

/* rpg_core.js:3312. Note the order: erase, RESUME the scene manager, then run
   every parked reloader, then empty the list. SceneManager.resume() re-primes
   the frame loop, so a mod that has paused the game by other means and then
   sees a load error retried finds itself un-paused by the engine. */
ResourceHandler.retry = function () {
  if (this._reloaders.length > 0) {
    Graphics.eraseLoadingError();
    SceneManager.resume();
    this._reloaders.forEach(function (reloader) {
      reloader();
    });
    this._reloaders.length = 0;
  }
};

/* -------------------------------------------------------------------------
   RESOURCEHANDLER'S DEPENDENCIES.

   Defined here because ResourceHandler above reaches for them and core.js /
   engine-mv.js define neither; a stub that is not loadable standalone is worse
   than a stub that owns one extra symbol.
   ---------------------------------------------------------------------- */

/* rpg_core.js:1991. SHAPE ONLY. The real body builds an error-printer DOM
   node: it writes _makeErrorHtml into Graphics._errorPrinter, appends a
   <button> whose onmousedown/ontouchstart calls ResourceHandler.retry() and
   stopPropagation()s the event, and sets _loadingCount = -Infinity. All of
   that hangs off Graphics._errorPrinter and Graphics.startLoading, which are
   the graphics area's business and are not modelled anywhere in this harness —
   so what is kept is the observable: WHICH url failed, and HOW MANY times the
   engine has put the loading error on screen. */
Graphics.printLoadingError = function (url) {
  window.__loadingErrorUrl = url;
  window.__loadingErrors = (window.__loadingErrors || 0) + 1;
};

/* rpg_core.js:2014. SHAPE ONLY, same reason: the real body clears
   _errorPrinter.innerHTML and calls this.startLoading(). */
Graphics.eraseLoadingError = function () {
  window.__loadingErrorUrl = null;
  window.__loadingErrorsErased = (window.__loadingErrorsErased || 0) + 1;
};

/* rpg_managers.js:2105 / :2126. VERBATIM. resume() is the interesting half:
   besides clearing _stopped it calls requestUpdate() — which on MV pushes a
   new callback onto the countable __raf queue in core.js — and then resets the
   fixed-timestep accumulator that engine-mv.js's updateMain runs on. Both
   _currentTime and _accumulator are engine-mv.js:185-187, and
   _getTimeInMsWithoutMobileSafari is :199. */
SceneManager.stop = function () {
  this._stopped = true;
};
SceneManager.resume = function () {
  this._stopped = false;
  this.requestUpdate();
  if (!Utils.isMobileSafari()) {
    this._currentTime = this._getTimeInMsWithoutMobileSafari();
    this._accumulator = 0;
  }
};

/* =============================================================================
   CONFIGMANAGER — MV. rpg_managers.js:511-556.

   SYNCHRONOUS, top to bottom. MV-MZ-DELTA.md §C.13: MV goes through
   StorageManager.save/load with the magic savefileId -1 (which
   StorageManager.localFilePath maps to 'config.rpgsave', engine-mv.js:270),
   MZ goes through StorageManager.saveObject/loadObject with the save NAME
   "config" and returns Promises. Neither engine's save() is awaitable, but
   MV's has finished when it returns and MZ's has not.
   ========================================================================== */

/* :511. Note the try/catch around the READ ONLY: a corrupt config file is
   still parsed outside the catch, so JSON.parse throwing takes the game down
   where a missing file does not. Kept as shipped. */
ConfigManager.load = function () {
  var json;
  var config = {};
  try {
    json = StorageManager.load(-1);
  } catch (e) {
    console.error(e);
  }
  if (json) {
    config = JSON.parse(json);
  }
  this.applyData(config);
};

/* :525. core.js's counters ride along so that a check can count flushes
   without unpacking StorageManager; everything below them is the engine's. */
ConfigManager.save = function () {
  this.saves++;
  window.__configSaves = (window.__configSaves || 0) + 1;
  StorageManager.save(-1, JSON.stringify(this.makeData()));
};

/* :529. SIX keys. MZ's makeData writes SEVEN — it adds touchUI. An MV config
   file round-tripped through an MZ build gains a key; the reverse loses one. */
ConfigManager.makeData = function () {
  var config = {};
  config.alwaysDash = this.alwaysDash;
  config.commandRemember = this.commandRemember;
  config.bgmVolume = this.bgmVolume;
  config.bgsVolume = this.bgsVolume;
  config.meVolume = this.meVolume;
  config.seVolume = this.seVolume;
  return config;
};

/* :540. readFlag takes TWO arguments here. MZ's takes three, the third being
   the default — which is how MZ can default touchUI to true while MV has no
   way to express a flag that defaults to anything but false. */
ConfigManager.applyData = function (config) {
  this.alwaysDash = this.readFlag(config, 'alwaysDash');
  this.commandRemember = this.readFlag(config, 'commandRemember');
  this.bgmVolume = this.readVolume(config, 'bgmVolume');
  this.bgsVolume = this.readVolume(config, 'bgsVolume');
  this.meVolume = this.readVolume(config, 'meVolume');
  this.seVolume = this.readVolume(config, 'seVolume');
};

/* :549. `!!config[name]` — an absent key and a false key are the same thing,
   and there is no default. MZ's is `if (name in config) ... else defaultValue`. */
ConfigManager.readFlag = function (config, name) {
  return !!config[name];
};

/* :553. Tests the VALUE against undefined. MZ tests `name in config` instead
   (rmmz_managers.js:525), so a config object carrying an explicit
   `{ bgmVolume: undefined }` reads as 100 on MV and as NaN on MZ. A plugin
   that writes its options object by assigning every known key, defined or not,
   is the way that shape actually arises. */
ConfigManager.readVolume = function (config, name) {
  var value = config[name];
  if (value !== undefined) {
    return Number(value).clamp(0, 100);
  } else {
    return 100;
  }
};

/* NOT DEFINED, ON PURPOSE: ConfigManager.touchUI, ConfigManager._isLoaded and
   ConfigManager.isLoaded(). All three are MZ-only (rmmz_managers.js:433/:434/
   :491). Reading ConfigManager.touchUI on MV must come back undefined, and
   calling ConfigManager.isLoaded() must throw, because that is what happens on
   a real MV game. Same for Scene_Options.maxCommands/maxVisibleCommands. */
