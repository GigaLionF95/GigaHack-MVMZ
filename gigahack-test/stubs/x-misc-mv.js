/* =============================================================================
   GigaHack test harness — stubs/x-misc-mv.js
   The MV 1.6.1 half of the small shared surface. Copied from js/rpg_*.js.

   Loaded IMMEDIATELY AFTER engine-mv.js, so Utils.RPGMAKER_NAME is 'MV',
   PluginManager exists with MV's full-entry dedup, and Array.prototype.contains
   is installed. x-misc.js has already run and holds everything the two engines
   agree on; nothing shared is repeated here.

   Every entry below exists because MZ does it DIFFERENTLY. If a body here ever
   becomes identical to its x-misc-mz.js counterpart, one of the two is wrong.
   ========================================================================== */

/* -------------------------------------------------------------------------
   WHERE THE FRAME COUNTER TICKS — rpg_core.js:1871-1889.

   On MV the engine's clock is advanced BY THE RENDERER. `this.frameCount++` is
   the last line of Graphics.render, outside the skip branch, so it ticks once
   per call whether or not anything was actually drawn. There is no
   SceneManager.updateFrameCount on MV at all (grep rpg_managers.js: zero
   matches) — MV's SceneManager.updateMain (rpg_managers.js:1975) never touches
   frameCount, it calls renderScene() and lets Graphics do it.

   Reading the clock from the wrong place has already cost this project once,
   so the placement is modelled rather than described. core.js:147 folds both
   halves into one two-line body that is right for MV and wrong for MZ; the
   real skip machinery is restored here and the counter left where MV puts it.

   Graphics._renders is a HARNESS counter invented by core.js, not an engine
   field. It is incremented on entry, i.e. it counts CALLS, which is what
   core.js counted and what run.js asserts on. The engine's own "did a draw
   actually happen" flag is _rendered, and that one follows the skip branch.
   ---------------------------------------------------------------------- */
window.__frameTickSite = 'Graphics.render';
Graphics._skipCount = 0;        /* rpg_core.js:1754, set in Graphics.initialize */
Graphics._maxSkip = 3;          /* rpg_core.js:1755 */
Graphics._rendered = false;     /* rpg_core.js:1756 */
Graphics.render = function (stage) {
  Graphics._renders++;          /* harness observable, core.js:147 */
  if (this._skipCount === 0) {
    var startTime = Date.now();
    /* this._renderer.render(stage) and the gl.flush() that follows it are the
       two lines left out: there is no PIXI renderer in the harness and a
       draw has no observable beyond _renders. Everything that decides WHEN a
       frame is skipped is kept, because that is what moves the clock. */
    var endTime = Date.now();
    var elapsed = endTime - startTime;
    this._skipCount = Math.min(Math.floor(elapsed / 15), this._maxSkip);
    this._rendered = true;
  } else {
    this._skipCount--;
    this._rendered = false;
  }
  this.frameCount++;
};

/* -------------------------------------------------------------------------
   BattleManager.isActionForced — rpg_managers.js:2588.

   ONE TERM. MV asks whether a battler is queued and nothing else, so a forced
   action stays "forced" across a party wipe: MV's own updateEvent
   (rpg_objects.js:8896) reads it as a reason to keep waiting, and MZ added two
   guards precisely because of that. Keeping MV's single term is what makes the
   MZ version's extra conditions visible as a difference instead of a detail.

   The field is initialised in x-misc.js from initMembers (rpg_managers.js:2162).
   BattleManager.forceAction is NOT replaced — core.js:1345 keeps it as a spy
   that never assigns _actionForcedBattler, so this predicate is false until a
   check sets the field. MV's real forceAction (rpg_managers.js:2592) takes the
   battler UNCONDITIONALLY and splices it out of _actionBattlers by index; MZ's
   refuses a battler with no actions left. That difference is recorded here and
   in x-misc-mz.js rather than modelled, because the real bodies need
   Game_Battler members the shared battler stubs do not have.
   ---------------------------------------------------------------------- */
BattleManager.isActionForced = function () {
  return !!this._actionForcedBattler;
};

/* -------------------------------------------------------------------------
   ImageManager.isReady — rpg_managers.js:901, which delegates to
   ImageCache.prototype.isReady (rpg_core.js:547).

   MV owns an ImageCache OBJECT whose _items are wrappers ({ bitmap, key,
   touch, reservationId }), and the readiness test SKIPS request-only bitmaps —
   a bitmap that was reserved but never decoded does not hold the game up. MZ
   has no ImageCache, walks two plain url->Bitmap maps, skips nothing, and
   throws out of isReady on a load error. Both bodies are here so a caller that
   assumes either shape fails on the other engine.

   MAY BE REDEFINED. If the images area defines ImageManager.isReady in a file
   that loads after this one, that definition wins — this is a floor so the
   symbol is never simply absent, not a claim on the surface.
   ---------------------------------------------------------------------- */
function ImageCache() {
  this.initialize.apply(this, arguments);
}
ImageCache.prototype.initialize = function () {          /* rpg_core.js:464 / :470 */
  this._items = {};
};
/* rpg_core.js:547, verbatim — including the double negative. `some` over the
   keys, negated: "ready" means "no item is both non-request-only and
   not-ready". */
ImageCache.prototype.isReady = function () {
  var items = this._items;
  return !Object.keys(items).some(function (key) {
    return !items[key].bitmap.isRequestOnly() && !items[key].bitmap.isReady();
  });
};
/* rpg_core.js:1693 — request-only means "asked for, not decoded yet". A
   bitmap in that state is deliberately NOT waited on. */
Bitmap.prototype.isRequestOnly = function () {
  return !(this._decodeAfterRequest || this.isReady());
};
ImageManager._imageCache = new ImageCache();
ImageManager.isReady = function () {                     /* rpg_managers.js:901 */
  return this._imageCache.isReady();
};

/* -------------------------------------------------------------------------
   FACE SIZE — rpg_windows.js:32-33.

   MV's face size is a CONSTANT on Window_Base, 144 by 144, and MV never reads
   $dataSystem.faceSize: grep faceSize across all six rpg_*.js files and there
   are zero matches. MZ moved it onto ImageManager as a getter that consults
   $dataSystem. So a face-preview panel that reads $dataSystem.faceSize gets
   undefined on every MV game and lays out at NaN, and one that hardcodes 144
   is wrong on any MZ project that changed it.

   Modelled as a reader rather than by defining Window_Base, whose surface
   belongs to the windows area. Same convention as core.js:673's tileWidth.
   ---------------------------------------------------------------------- */
window.__faceSize = function () {
  return 144;
};
/* $dataSystem gets NO faceSize on MV — the key is absent, not 144 and not
   null, and `'faceSize' in $dataSystem` must be false. Returning an empty
   object is what makes __extendDatabase leave it out. */
window.__xdata.engineSystem = function () {
  return {};
};

/* -------------------------------------------------------------------------
   ENCRYPTION — rpg_managers.js:147-148 and rpg_core.js:9149-9159, :9267.

   MV keeps this on a static class called Decrypter, as PLAIN BOOLEAN
   PROPERTIES, and DataManager.onLoad copies them off $dataSystem when the
   System file lands. MZ has no Decrypter at all: it hangs the same three
   values on Utils behind FUNCTIONS. `Decrypter.hasEncryptedAudio` is a
   boolean here and `Utils.hasEncryptedAudio` is a function there, so the MZ
   call spelled MV's way reads a function object — always truthy — and the MV
   read spelled MZ's way throws.

   The key is stored differently too: MV pre-splits it into an ARRAY of 16
   two-character strings at read time; MZ stores the raw string and splits it
   at every decrypt.

   MAY BE REDEFINED by whoever owns the images/media surface; this is a floor.
   ---------------------------------------------------------------------- */
function Decrypter() {
  throw new Error('This is a static class');
}
Decrypter.hasEncryptedImages = false;    /* rpg_core.js:9153 — a BOOLEAN */
Decrypter.hasEncryptedAudio = false;     /* rpg_core.js:9154 — a BOOLEAN */
Decrypter._requestImgFile = [];
Decrypter._headerlength = 16;
Decrypter._xhrOk = 400;
Decrypter._encryptionKey = '';           /* rpg_core.js:9158 — replaced by an ARRAY below */
Decrypter._ignoreList = ['img/system/Window.png'];
Decrypter.SIGNATURE = '5250474d56000000';
Decrypter.VER = '000301';
Decrypter.REMAIN = '0000000000';
/* rpg_core.js:9166 */
Decrypter.checkImgIgnore = function (url) {
  for (var cnt = 0; cnt < this._ignoreList.length; cnt++) {
    if (url === this._ignoreList[cnt]) return true;
  }
  return false;
};
/* rpg_core.js:9267 — split on a CAPTURING group, which yields empty strings
   between every pair, then filtered out. The result is an array of 16
   two-character strings, not the string it started as. */
Decrypter.readEncryptionkey = function () {
  this._encryptionKey = $dataSystem.encryptionKey.split(/(.{2})/).filter(Boolean);
};
/* rpg_managers.js:147-148, the $dataSystem branch of DataManager.onLoad.
   core.js:437 models onLoad without it, so this is the propagation step a
   check calls after editing the three fields. Note that MV coerces with `!!`
   and MZ passes the raw value through Utils.setEncryptionInfo. */
window.__applyEncryption = function () {
  Decrypter.hasEncryptedImages = !!$dataSystem.hasEncryptedImages;
  Decrypter.hasEncryptedAudio = !!$dataSystem.hasEncryptedAudio;
  Decrypter.readEncryptionkey();
  window.__encryptionApplied = (window.__encryptionApplied || 0) + 1;
};

/* -------------------------------------------------------------------------
   PLUGIN PARAMETER KEY — rpg_managers.js:2801-2814.

   engine-mv.js already models PluginManager itself, including the dedup on
   the FULL plugin.name and the '.js' that loadScript appends; none of that is
   repeated. What is missing is the answer a panel needs: given a plugins.js
   entry, WHICH KEY are its parameters filed under.

   MV: setParameters(plugin.name, ...) — the whole entry, lower-cased.
   MZ: setParameters(Utils.extractFileName(plugin.name), ...) — the basename.
   For a flat entry the two agree, which is why this can go unnoticed for as
   long as no project uses a subfolder. For an entry like 'mods/Foo/Bar' they
   do not: MV files it under 'mods/foo/bar' and MZ under 'bar', so a panel that
   calls PluginManager.parameters() with the wrong one gets {} and reports the
   plugin as having no settings rather than as missing. HANDOFF.md records the
   dedup half of this; the lookup half is the same fork.
   ---------------------------------------------------------------------- */
window.__pluginParamKey = function (entryName) {
  return entryName.toLowerCase();
};

/* -------------------------------------------------------------------------
   TERMS — the MV halves of $dataSystem.terms.

   params: 10 entries. MV's shipped defaults are the long forms; MZ's are the
   abbreviations. The ENGINE reads them identically (TextManager.param, MV
   rpg_managers.js:1653 / MZ rmmz_managers.js:1623) — it is the default TEXT
   that differs, so a layout measured against 'M.Defense' overflows nothing on
   MZ and a column sized for 'MDEF' clips on MV.

   messages: the 10 keys whose default value differs from MZ's. The other 41
   are in x-misc.js. MV has NO touchUI and NO autosave key at all — both are
   MZ-only options — and MV's apostrophes are the ASCII ' where MZ's are the
   typographic U+2019.
   ---------------------------------------------------------------------- */
window.__xdata.termsParams = function () {
  return ['Max HP', 'Max MP', 'Attack', 'Defense', 'M.Attack', 'M.Defense',
    'Agility', 'Luck', 'Hit', 'Evasion'];
};
window.__xdata.termsMessagesEngine = function () {
  return {
    saveMessage: 'Save to which file?',
    loadMessage: 'Load which file?',
    /* 'File' on MV, 'Save' on MZ — the same key, labelling the same window,
       with a different word. */
    file: 'File',
    partyName: "%1's Party",
    /* Two placeholders on MV. MZ's carries a third that its own battle log
       never supplies; see x-misc-mz.js. */
    actorDamage: '%1 took %2 damage!',
    enemyDamage: '%1 took %2 damage!',
    counterAttack: '%1 counterattacked!',
    buffAdd: "%1's %2 went up!",
    debuffAdd: "%1's %2 went down!",
    buffRemove: "%1's %2 returned to normal!"
  };
};
