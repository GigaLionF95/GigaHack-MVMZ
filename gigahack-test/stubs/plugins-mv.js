/* =============================================================================
   GigaHack test harness — stubs/plugins-mv.js
   A MODELLED third-party plugin stack, loaded only by harness-mv-modded.html.

   This is what makes the compat layer testable. It is modelled on the shape a
   heavily-modded MV game really has — fifty plugins, several of which replace
   engine methods outright — but it encodes NO game: every stub is named for
   what it does, and each is the smallest thing that reproduces the behaviour
   the mod has to survive.

   The one place a real name appears is the entry each stub adds to $plugins.
   That is deliberate and it is not "encoding a game": $.compat's quirks table
   fingerprints plugins BY NAME, so a stack registered under invented names
   would exercise the matcher against nothing and every culprit-naming check
   would pass vacuously. The names below are the generic ones that table
   already knows, plus one that it deliberately does NOT know, so the "no
   loaded plugin is known to touch this" branch is covered too.

   Loaded AFTER engine-mv.js (it patches the engine) and BEFORE fixtures.js
   (which concatenates __extraPlugins into $plugins and then builds the world).
   ========================================================================== */

window.__extraPlugins = [
  { name: 'YEP_CoreEngine', status: true, description: 'framework: caps and parameters', parameters: {} },
  { name: 'speed', status: true, description: 'fast-forward while a key is held', parameters: {} },
  { name: 'cache', status: true, description: 'aggressive image cache clearing', parameters: {} },
  { name: 'save', status: true, description: 'save location override', parameters: {} },
  { name: 'CircularJSON', status: true, description: 'circular-reference save encoder', parameters: {} },
  { name: 'input_claims', status: true, description: 'claims two letters in Input.keyMapper', parameters: {} },
  /* Deliberately unrecognised by the quirks table: it recomputes a parameter
     the mod writes, so verify() fails with NO culprit and has to say so. */
  { name: 'param_recalc', status: true, description: 'recomputes a parameter on read', parameters: {} }
];

/* =============================================================================
   1. A framework plugin that OVERWRITES WITHOUT ALIASING.

   The caps are replaced outright — no saved original, no call through. These
   are the "your cheat silently does not stick" cases: the mod writes a value,
   the engine's own read path clamps it back, and nothing throws.
   ========================================================================== */
(function frameworkOverwrites() {
  /* Replaced, not aliased. */
  Game_Party.prototype.maxGold = function () { return 99999999; };

  /* Item stacks clamp to each item's own maxItem, default 99. An item whose
     note gives it a small stack is a hard ceiling the mod cannot write past. */
  Game_Party.prototype.maxItems = function (item) {
    return (item && item.maxItem !== undefined) ? item.maxItem : 99;
  };

  /* Parameter caps come DOWN: MV's stock paramMax is 999999 for MHP and 9999
     for MMP (rpg_objects.js:2432), and this framework caps both at 9999/999.
     Asking for 50000 MHP therefore reads back as 9999. */
  Game_BattlerBase.prototype.paramMax = function (paramId) {
    if (paramId === 0 || paramId === 1) return 9999;
    return 999;
  };
  Game_Actor.prototype.paramMax = function (paramId) {
    if (paramId === 0 || paramId === 1) return 9999;
    return 999;
  };

  /* Frameworks routinely extend note-tag parsing, and they do it in
     Scene_Boot.start — which is why the mod's own boot hook has to tolerate
     running inside a chain it did not write. This alias IS aliased, so
     GigaHack (which loads later) still wraps it. */
  var _start = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    window.__frameworkNoteTags = (window.__frameworkNoteTags || 0) + 1;
    /* Per-item stack limits, read from the database at boot. */
    if (typeof $dataItems !== 'undefined' && $dataItems) {
      for (var i = 1; i < $dataItems.length; i++) {
        if (!$dataItems[i]) continue;
        $dataItems[i].maxItem = (i % 50 === 1) ? 5 : 99;
      }
    }
    return _start.apply(this, arguments);
  };

  /* An extended metadata shape. The 1.x harness put `metaArray` in its
     ENGINE stub, which made a plugin's behaviour look like an engine fact on
     every game. It is a plugin's behaviour, so it lives here. */
  var _extract = DataManager.extractMetadata;
  DataManager.extractMetadata = function (data) {
    _extract.call(this, data);
    var regExp = /<([^<>:]+)(:?)([^>]*)>/g;
    data.metaArray = {};
    for (;;) {
      var match = regExp.exec(data.note);
      if (!match) break;
      var v = match[2] === ':' ? match[3] : true;
      (data.metaArray[match[1]] = data.metaArray[match[1]] || []).push(v);
    }
  };
})();

/* =============================================================================
   2. A fast-forward plugin: Scene_Map.update runs FIVE TIMES per frame while
   its key is held.

   The mod's own per-frame work must NOT be multiplied by this. That is the
   entire reason $.frame() rides on SceneManager rather than on Scene_Map:
   anything hung off the map scene's update would fire five times a frame,
   and every repeat rate and every "once per frame" guard would be wrong.
   ========================================================================== */
(function fastForward() {
  var MULTIPLIER = 5;
  window.__ffHeld = false;
  window.__ffRuns = 0;
  var _update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    var n = window.__ffHeld ? MULTIPLIER : 1;
    for (var i = 0; i < n; i++) { window.__ffRuns++; _update.call(this); }
  };
})();

/* =============================================================================
   3. An image-cache plugin: ImageManager.clear() on every map transfer, and
   the base textures are destroyed with it.

   Any bitmap the overlay holds across a map change has to be re-fetched. A
   cached reference is a destroyed texture, and on MV nothing holds a
   reservation for it either.
   ========================================================================== */
(function imageCacheClearing() {
  Game_Map.prototype.onTransfer = function () {
    window.__cacheClears = (window.__cacheClears || 0) + 1;
    if (ImageManager._iconSet) ImageManager._iconSet._destroyed = true;
    ImageManager.clear();
    ImageManager._iconSet = null;
  };
})();

/* =============================================================================
   4. A save-location plugin: the save directory is somewhere else entirely.

   The mod resolves the path through StorageManager at CALL TIME for exactly
   this reason. Anything that cached <gameRoot>/save at boot backs up nothing.
   ========================================================================== */
(function saveLocationOverride() {
  window.__redirectedSaveDir = '/elsewhere/appdata/harness/save/';
  StorageManager.localFileDirectoryPath = function () { return window.__redirectedSaveDir; };
})();

/* =============================================================================
   5. A serialiser plugin: JsonEx.stringify/parse replaced with a circular-
   reference encoder.

   The output is a JSON ARRAY whose members carry "~path" back-references, so
   plain JSON.parse SUCCEEDS and hands back something with none of the save's
   top-level keys. That is the trap: the failure is not an exception, it is a
   silently wrong object. Anything that parses a save must go through the live
   JsonEx; backups copy bytes and are unaffected.
   ========================================================================== */
(function circularSerialiser() {
  window.__stockJsonEx = { stringify: JsonEx.stringify, parse: JsonEx.parse };
  JsonEx.stringify = function (root) {
    var known = [], paths = [];
    function walk(v, path) {
      if (v === null || typeof v !== 'object') return v;
      var i = known.indexOf(v);
      if (i > -1) return '~' + paths[i];
      known.push(v); paths.push(path);
      var copy = Array.isArray(v) ? [] : {};
      if (!Array.isArray(v)) {
        var name = v.constructor ? v.constructor.name : 'Object';
        if (name !== 'Object') copy['@'] = name;
      }
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) copy[k] = walk(v[k], path + '.' + k);
      }
      return copy;
    }
    return JSON.stringify([walk(root, '')]);
  };
  JsonEx.parse = function (s) {
    var arr = JSON.parse(s);
    var root = arr[0];
    var seen = [];
    function follow(p) {
      var parts = p.split('.').filter(function (x) { return x.length; });
      var o = root;
      for (var i = 0; i < parts.length; i++) o = o[parts[i]];
      return o;
    }
    function revive(v) {
      if (typeof v === 'string' && v.charAt(0) === '~') return follow(v.slice(1));
      if (v === null || typeof v !== 'object') return v;
      if (seen.indexOf(v) > -1) return v;
      seen.push(v);
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) v[k] = revive(v[k]);
      if (!Array.isArray(v) && v['@']) {
        var cls = window[v['@']];
        if (typeof cls === 'function') {
          var out = Object.create(cls.prototype);
          for (var j in v) if (j !== '@') out[j] = v[j];
          return out;
        }
      }
      return v;
    }
    return revive(root);
  };
})();

/* =============================================================================
   6. Two plugins that claim a letter each in Input.keyMapper.

   GigaHack derives its hotkey defaults by subtracting everything keyMapper has
   claimed, so a stack that takes N and P must push the defaults elsewhere. A
   mod that shipped a hand-picked letter would collide silently: the game would
   act on the key as well as the menu.
   ========================================================================== */
(function inputClaims() {
  Input.keyMapper[78] = 'quicklog';    // KeyN — GigaHack's first choice for `toggle`
  Input.keyMapper[80] = 'partyswap';   // KeyP — GigaHack's first choice for `quickSave`
})();

/* =============================================================================
   7. A plugin that RECOMPUTES a parameter on read, and is not in the quirks
   table.

   It exists so the failure path with NO recognised culprit is exercised: the
   mod must still say the write did not stick, and say plainly that nothing it
   recognises is responsible rather than inventing a name.
   ========================================================================== */
(function unrecognisedRecalc() {
  window.__recalcOn = false;
  var _paramPlus = Game_Actor.prototype.paramPlus;
  Game_Actor.prototype.paramPlus = function (id) {
    if (window.__recalcOn && id === 3) return 0;      // DEF is always recomputed to base
    return _paramPlus.apply(this, arguments);
  };
})();

/* =============================================================================
   8. A message plugin adding its own ConfigManager options.

   instantText and skipUnseen exist on NEITHER engine — the mod probes for them
   and offers the controls only where a plugin has supplied them. The stock
   ConfigManager in core.js deliberately has neither.
   ========================================================================== */
(function messageOptions() {
  ConfigManager.instantText = true;
  ConfigManager.skipUnseen = true;
  var _showFast = Window_Message.prototype.updateShowFast;
  Window_Message.prototype.updateShowFast = function () {
    if (ConfigManager.instantText === true) this._showFast = true;
    return _showFast.apply(this, arguments);
  };
})();
