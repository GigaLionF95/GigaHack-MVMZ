/* =============================================================================
   GigaHack test harness — stubs/x-misc-mz.js
   The MZ 1.9.0 half of the small shared surface. Copied from js/rmmz_*.js.

   Loaded IMMEDIATELY AFTER engine-mz.js, so Utils.RPGMAKER_NAME is 'MZ',
   Utils.extractFileName exists, ColorManager exists, and PluginManager is the
   one that dedups on the basename. x-misc.js has already run and holds
   everything the two engines agree on; nothing shared is repeated here.

   Every entry below exists because MV does it DIFFERENTLY. If a body here ever
   becomes identical to its x-misc-mv.js counterpart, one of the two is wrong.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Array.prototype.remove — rmmz_core.js:77, made non-enumerable at :88.

   MZ-ONLY. MV ships Array.prototype.contains and NOT remove (grep rpg_core.js:
   zero matches for `Array.prototype.remove`); MZ ships remove and NOT contains.
   Neither polyfill is a language feature, so anything that reaches for the
   wrong one throws "is not a function" on the other engine — and it throws
   inside the engine, from BattleManager.forceAction (rmmz_managers.js:2877),
   not in the code that made the mistake.

   Verbatim, including the `for (;;)` that keeps going until the element is
   gone: MZ's remove strips EVERY occurrence, not the first one, and returns
   the array rather than the removed element.
   ---------------------------------------------------------------------- */
Array.prototype.remove = function (element) {
  for (;;) {
    var index = this.indexOf(element);
    if (index >= 0) {
      this.splice(index, 1);
    } else {
      return this;
    }
  }
};
Object.defineProperty(Array.prototype, 'remove', { enumerable: false });

/* -------------------------------------------------------------------------
   WHERE THE FRAME COUNTER TICKS — rmmz_managers.js:2110.

   MZ HAS NO Graphics.render. Grep rmmz_core.js: the only `render` definitions
   are Tilemap.Layer.prototype.render (:2930) and WindowLayer.prototype.render
   (:4297). Drawing happens inside Graphics._onTick (rmmz_core.js:808), which
   calls this._app.render() through PIXI's own ticker and touches no counter at
   all. The clock is advanced by the LOGIC step instead:
   SceneManager.updateMain (:2102) calls updateFrameCount (:2110) first, before
   input, before the scene.

   engine-mz.js:150 already installs updateFrameCount and calls it from
   updateMain — that half is not repeated. What has to be corrected here is the
   other half: core.js:147 gives Graphics.render a `frameCount++` copied from
   MV, and engine-mz.js's SceneManager.renderScene calls Graphics.render, so
   every MZ frame in the harness ticked the clock TWICE. A clock read from the
   wrong place is a bug this project has already had once; a clock that ticks
   at double rate on one engine only is the same bug wearing a hat.

   Graphics.render survives as a name because engine-mz.js:165 calls it and
   because Graphics._renders is the harness's per-frame draw observable that
   run.js asserts on. What it must not do is move frameCount.
   ---------------------------------------------------------------------- */
window.__frameTickSite = 'SceneManager.updateFrameCount';
Graphics.render = function (stage) {
  Graphics._renders++;          /* harness observable, core.js:147 */
  /* No frameCount++. On MZ that line lives in SceneManager.updateFrameCount
     (rmmz_managers.js:2110-2112), which engine-mz.js:150 already models.
     No _skipCount/_maxSkip/_rendered either — those are MV Graphics fields
     (rpg_core.js:1754-1756) with no MZ counterpart; MZ decides whether to draw
     with Graphics._canRender() (rmmz_core.js:822), which asks whether the PIXI
     app has a stage and never skips for elapsed time. */
};

/* -------------------------------------------------------------------------
   BattleManager.isActionForced — rmmz_managers.js:2866-2872.

   THREE TERMS. MZ added the two all-dead guards that MV does not have, so a
   forced action stops being "forced" the instant either side is wiped out.
   MV's is a bare `!!this._actionForcedBattler` — same field, same name,
   different answer at exactly the moment a battle ends, which is when a
   battle panel is most likely to be looking.

   Both $gameParty.isAllDead (core.js:1008) and $gameTroop.isAllDead
   (core.js:1325) already exist, so this predicate reads the real objects.

   The field is initialised in x-misc.js from initMembers (rmmz_managers.js:2295).
   BattleManager.forceAction is NOT replaced — core.js:1345 keeps it as a spy
   that never assigns _actionForcedBattler, so this predicate is false until a
   check sets the field. MZ's real forceAction (rmmz_managers.js:2874) REFUSES
   a battler with `numActions() === 0` and removes it with
   Array.prototype.remove; MV's takes any battler and splices by index. That
   difference is recorded here and in x-misc-mv.js rather than modelled,
   because the real bodies need Game_Battler members the shared battler stubs
   do not have.
   ---------------------------------------------------------------------- */
BattleManager.isActionForced = function () {
  return (
    !!this._actionForcedBattler &&
    !$gameParty.isAllDead() &&
    !$gameTroop.isAllDead()
  );
};

/* -------------------------------------------------------------------------
   ImageManager.isReady — rmmz_managers.js:988-1001.

   MZ has NO ImageCache. It walks TWO plain url->Bitmap maps — _cache
   (:859) and _system (:860) — skips nothing, and on the first errored bitmap
   calls throwLoadError, which THROWS OUT OF isReady. MV's (rpg_managers.js:901)
   delegates to an ImageCache whose test skips request-only bitmaps and cannot
   throw at all.

   So on MZ "is everything loaded?" is a question that can raise, and a caller
   that wraps it in nothing gets an exception where MV would have returned
   false. Worse, what it throws is an ARRAY, not an Error: `["LoadError", url,
   retry]` (:1003). A catch block that reads e.message off it gets undefined,
   and one that tests `e instanceof Error` does not catch it as an error at all.
   That is copied exactly, awkwardness included, because it is the whole point.

   MAY BE REDEFINED. If the images area defines ImageManager.isReady in a file
   that loads after this one, that definition wins — this is a floor so the
   symbol is never simply absent, not a claim on the surface.
   ---------------------------------------------------------------------- */
ImageManager._cache = {};       /* rmmz_managers.js:859 */
ImageManager._system = {};      /* rmmz_managers.js:860 */
/* rmmz_core.js:1787 — the real body builds an Image or an XHR. There is no
   network in the harness, so only the fact that a retry restarts a load is
   observable; the counter stands in for the request. */
Bitmap.prototype._startLoading = function () {
  window.__bitmapLoads = (window.__bitmapLoads || 0) + 1;
};
/* rmmz_core.js:1718, verbatim — retry re-runs the load. It is bound and handed
   out inside the thrown array, so the catcher can restart the fetch it
   interrupted. `bitmap.url` (rmmz_core.js:1312, a defineProperty getter over
   this._url) is undefined on core.js's Bitmap, so the thrown array's second
   slot is undefined here: what the throw carries is the SHAPE, and the shape
   is a three-element array whose first element is a bare string. */
Bitmap.prototype.retry = function () {
  this._startLoading();
};
ImageManager.throwLoadError = function (bitmap) {         /* rmmz_managers.js:1003 */
  var retry = bitmap.retry.bind(bitmap);
  throw ['LoadError', bitmap.url, retry];
};
ImageManager.isReady = function () {                      /* rmmz_managers.js:988 */
  var caches = [this._cache, this._system];
  for (var c = 0; c < caches.length; c++) {
    var cache = caches[c];
    for (var url in cache) {
      var bitmap = cache[url];
      if (bitmap.isError()) {
        this.throwLoadError(bitmap);
      }
      if (!bitmap.isReady()) {
        return false;
      }
    }
  }
  return true;
};

/* -------------------------------------------------------------------------
   FACE SIZE — rmmz_managers.js:877 (the faceWidth getter) and :899
   (getFaceSize).

   MZ reads the size OUT OF THE DATABASE, behind an `in` test, falling back to
   the class constant only when the key is absent — the same shape core.js:673
   already models for tileSize. MV has no such reader: its face size is the
   constant Window_Base._faceWidth (rpg_windows.js:32) and $dataSystem.faceSize
   is never mentioned in any of MV's six source files.

   The getters on ImageManager belong to the images surface (engine-mz.js:290
   already installs iconWidth/iconHeight there), so what is added here is the
   DATA and a reader shaped exactly like the engine's, matching x-misc-mv.js.
   ---------------------------------------------------------------------- */
window.__faceSize = function () {
  /* rmmz_managers.js:899-905, with standardFaceWidth (:856) as the fallback. */
  if ('faceSize' in $dataSystem) {
    return $dataSystem.faceSize;
  } else {
    return 144;
  }
};
/* $dataSystem carries faceSize on MZ and MUST NOT on MV, because the whole
   reader above turns on `'faceSize' in $dataSystem`. iconSize and tileSize are
   MZ-only keys of the same family; tileSize is left out because core.js:673
   already branches on its absence, and iconSize because fixtures.js:69 already
   sets one. */
window.__xdata.engineSystem = function () {
  return { faceSize: 144 };
};

/* -------------------------------------------------------------------------
   ENCRYPTION — rmmz_scenes.js:294-299 and rmmz_core.js:419-441, :458.

   MZ HAS NO Decrypter. The class MV puts this on does not exist here at all;
   the same three values live on Utils, and they are reached through FUNCTIONS,
   not properties. `Utils.hasEncryptedAudio` is a function object — always
   truthy — so the MV spelling read against MZ reports every project as
   encrypted, and the MZ spelling read against MV throws "is not a function".
   The two are the same information behind incompatible shapes.

   The key is stored differently too: MZ keeps the raw 32-character string and
   splits it with `.match(/.{2}/g)` at every decrypt (rmmz_core.js:458); MV
   pre-splits it into an array once (rpg_core.js:9267). So the same field name
   holds a String on one engine and an Array on the other after boot.

   Note also WHO propagates it: MV does it inside DataManager.onLoad, MZ from
   Scene_Boot.setEncryptionInfo — a scene, one step later in the boot order.
   ---------------------------------------------------------------------- */
/* rmmz_core.js:419 — the comment in the source says it is written this way
   "for module independence"; it takes three arguments and coerces none of
   them, where MV's propagation applies `!!`. */
Utils.setEncryptionInfo = function (hasImages, hasAudio, key) {
  this._hasEncryptedImages = hasImages;
  this._hasEncryptedAudio = hasAudio;
  this._encryptionKey = key;
};
Utils.hasEncryptedImages = function () {                  /* rmmz_core.js:431 */
  return this._hasEncryptedImages;
};
Utils.hasEncryptedAudio = function () {                   /* rmmz_core.js:440 */
  return this._hasEncryptedAudio;
};
/* rmmz_scenes.js:294-299, the whole of Scene_Boot.setEncryptionInfo. core.js
   models no Scene_Boot boot sequence, so this is the propagation step a check
   calls after editing the three $dataSystem fields. */
window.__applyEncryption = function () {
  var hasImages = $dataSystem.hasEncryptedImages;
  var hasAudio = $dataSystem.hasEncryptedAudio;
  var key = $dataSystem.encryptionKey;
  Utils.setEncryptionInfo(hasImages, hasAudio, key);
  window.__encryptionApplied = (window.__encryptionApplied || 0) + 1;
};

/* -------------------------------------------------------------------------
   PLUGIN PARAMETER KEY — rmmz_managers.js:3109-3118.

   engine-mz.js already models PluginManager itself, including the dedup on the
   BASENAME via Utils.extractFileName and the encodeURIComponent in makeUrl;
   none of that is repeated. What is missing is the answer a panel needs: given
   a plugins.js entry, WHICH KEY are its parameters filed under.

   MZ: setParameters(Utils.extractFileName(plugin.name), ...) — the basename.
   MV: setParameters(plugin.name, ...) — the whole entry, lower-cased.
   For a flat entry the two agree, which is why this can go unnoticed for as
   long as no project uses a subfolder. For an entry like 'mods/Foo/Bar' they
   do not: MZ files it under 'bar' and MV under 'mods/foo/bar', so a panel that
   calls PluginManager.parameters() with the wrong one gets {} and reports the
   plugin as having no settings rather than as missing. HANDOFF.md records the
   dedup half of this; the lookup half is the same fork.

   Utils.extractFileName is itself MZ-only (rmmz_core.js:380, and deliberately
   absent from engine-mv.js), which is why this reader cannot be shared.
   ---------------------------------------------------------------------- */
window.__pluginParamKey = function (entryName) {
  return Utils.extractFileName(entryName).toLowerCase();
};

/* -------------------------------------------------------------------------
   TERMS — the MZ halves of $dataSystem.terms.

   params: 10 entries. MZ's shipped defaults are the abbreviations where MV's
   are the long forms. The ENGINE reads them identically (TextManager.param,
   MZ rmmz_managers.js:1623 / MV rpg_managers.js:1653) — it is the default TEXT
   that differs, so a column sized for 'MDEF' clips on MV and a layout measured
   against 'M.Defense' wastes half its width on MZ.

   messages: the 10 keys whose default value differs from MV's, plus the TWO
   that exist on MZ ALONE — touchUI and autosave, both options MV never had.
   An options dump that iterates a fixed key list drops them; one that iterates
   the object gets a different length per engine, which is the correct answer.
   The other 41 keys are in x-misc.js.
   ---------------------------------------------------------------------- */
window.__xdata.termsParams = function () {
  return ['Max HP', 'Max MP', 'ATK', 'DEF', 'MATK', 'MDEF',
    'AGI', 'LUCK', 'HIT', 'EVA'];
};
window.__xdata.termsMessagesEngine = function () {
  return {
    /* MZ-only keys. Absent from MV's terms.messages entirely — not empty,
       not null, absent, so `'touchUI' in terms.messages` is the test. */
    touchUI: 'Touch UI',
    autosave: 'Autosave',

    saveMessage: 'Which file would you like to save to?',
    loadMessage: 'Which file would you like to load?',
    /* 'Save' on MZ, 'File' on MV — the same key, labelling the same window,
       with a different word. */
    file: 'Save',
    /* U+2019 RIGHT SINGLE QUOTATION MARK, where MV uses the ASCII apostrophe.
       Four of these keys carry it. Kept as the real character: a terms dump
       that goes through a byte-oriented path mangles exactly these and nothing
       else, and with ASCII everywhere the harness could never show it. */
    partyName: '%1’s Party',
    /* THREE placeholders, and MZ's own battle log only ever supplies two:
       Window_BattleLog.makeHpDamageText (rmmz_windows.js:5236) calls
       fmt.format(target.name(), damage) for the plain-damage branch, so %3
       resolves to arguments[2] === undefined and the line renders with the
       literal text "undefined" in it. Copied as shipped. A term editor that
       "fixes" the string by dropping %3 has changed the game's data; one that
       validates placeholders against the caller's arity flags the engine's own
       default as broken, which it is. */
    actorDamage: '%1 took %2%3 damage!',
    enemyDamage: '%1 took %2%3 damage!',
    counterAttack: '%1 made a counterattack!',
    buffAdd: '%1’s %2 went up!',
    debuffAdd: '%1’s %2 went down!',
    buffRemove: '%1’s %2 returned to normal!'
  };
};
