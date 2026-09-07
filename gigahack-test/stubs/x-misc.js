/* =============================================================================
   GigaHack test harness — stubs/x-misc.js
   The SMALL SHARED SURFACE: the odds and ends that MV 1.6.1 and MZ 1.9.0 agree
   on byte for byte, plus the DATA SHAPES the database rows are supposed to have.

   Copied from the shipped engine sources, not written from memory. Line
   references are MV = js/rpg_*.js (1.6.1), MZ = js/rmmz_*.js (1.9.0). Where one
   reference is given for both, the two bodies are identical character for
   character and the difference is only the line they sit on.

   Loaded IMMEDIATELY AFTER core.js, so PluginManager, ColorManager, Window and
   everything else that engine-mv.js / engine-mz.js installs does not exist yet
   and is not touched here. The divergent halves of everything below live in
   x-misc-mv.js and x-misc-mz.js, which load immediately after their engine file.

   WHAT THIS FILE DELIBERATELY DOES NOT REDEFINE
   core.js already models Utils, Graphics' shared fields, Input, TouchInput,
   SoundManager, DataManager, JsonEx, the Game_* constructors and $game* holders.
   Everything here either adds a member core.js left out or replaces one whose
   core.js body was a harness shortcut — and every replacement keeps the
   window.__* observable core.js invented, because run.js asserts on those.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Math.randomInt — MV rpg_core.js:151 / MZ rmmz_core.js:99.

   The engine bolts this onto the Math object at boot, so it is present on
   every real game and absent from a bare browser. Verbatim, including the
   argument order: `max * Math.random()`, not `Math.random() * max`.
   ---------------------------------------------------------------------- */
Math.randomInt = function (max) {
  return Math.floor(max * Math.random());
};

/* -------------------------------------------------------------------------
   Game_SelfSwitches — MV rpg_objects.js:598-609 / MZ rmmz_objects.js:761-772.

   core.js has setValue WITHOUT the trailing onChange() call. That omission is
   exactly the class of bug this harness exists to catch: on a real game,
   flipping a self switch schedules a map refresh, so the event page the player
   is standing on re-evaluates on the next frame. A stub that skips it lets a
   self-switch panel look correct while the map never changes.

   setValue is replaced (not extended) so the call order is the engine's:
   write/delete FIRST, then onChange.
   ---------------------------------------------------------------------- */
Game_SelfSwitches.prototype.setValue = function (key, value) {
  if (value) {
    this._data[key] = true;
  } else {
    delete this._data[key];
  }
  this.onChange();
};
Game_SelfSwitches.prototype.onChange = function () {
  $gameMap.requestRefresh();
};

/* -------------------------------------------------------------------------
   Game_CharacterBase direction — MV rpg_objects.js:6266 (_direction = 2, in
   initMembers), :6464 direction, :6468 setDirection, :6759 isDirectionFixed,
   :6360 resetStopCount / MZ rmmz_objects.js:6957, :7156, :7160, :7463, :7054.

   The four bodies are identical on both engines. _direction is 2 (down) out of
   initMembers, and setDirection is a NO-OP for a direction-fixed character and
   for d === 0 — the resetStopCount() call still happens either way, which is
   the awkward part and is kept.

   core.js's Game_CharacterBase constructor does not set _direction, so it is a
   prototype default here (the same trick engine-*.js uses for
   Game_Map.prototype.tileEvents). Prototype defaults are shadowed by the first
   write, which is what the engine's per-instance field does anyway.
   ---------------------------------------------------------------------- */
Game_CharacterBase.prototype._direction = 2;
Game_CharacterBase.prototype._directionFix = false;
Game_CharacterBase.prototype._stopCount = 0;
Game_CharacterBase.prototype.direction = function () {
  return this._direction;
};
Game_CharacterBase.prototype.setDirection = function (d) {
  if (!this.isDirectionFixed() && d) {
    this._direction = d;
  }
  this.resetStopCount();
};
Game_CharacterBase.prototype.isDirectionFixed = function () {
  return this._directionFix;
};
Game_CharacterBase.prototype.setDirectionFix = function (directionFix) {
  this._directionFix = directionFix;
};
Game_CharacterBase.prototype.resetStopCount = function () {
  this._stopCount = 0;
};

/* NEITHER ENGINE DEFINES Game_Player.prototype.direction. Grep both:
   `Game_Player.prototype.direction` has zero matches in rpg_objects.js and in
   rmmz_objects.js — the player inherits Game_CharacterBase's.

   core.js:554 shadows it with `function () { return 2; }`. That shadow makes
   every direction the mod records a constant: a saved waypoint, a teleport
   target and a player-position readout all report "down" no matter which way
   the player is facing, and no check can tell, because the stub agrees with
   itself. Removing the own property restores the prototype chain the engine
   actually has. It is deleted rather than reassigned so that the lookup
   really goes through Game_CharacterBase, which is where the mod's hooks
   install. */
delete Game_Player.prototype.direction;

/* -------------------------------------------------------------------------
   Transfer reservation — MV rpg_objects.js:7451 reserveTransfer, :7464
   isTransferring / MZ rmmz_objects.js:8141, :8161. Identical bodies.

   isTransferring is the gate Scene_Map.update reads to decide whether to stop
   the map and start a fade, so anything that teleports has to leave the flag
   set and let the scene clear it. core.js's reserveTransfer is a harness
   shortcut: it records window.__transfer and moves $gamePlayer immediately,
   and sets NO flag at all — so isTransferring could never be true and a
   "teleport is pending" readout could never be wrong.

   The engine's six assignments are added; core.js's four harness side effects
   are kept verbatim after them, in that order, because run.js reads
   window.__transfer and fixtures' $gameMap.onTransfer hook.
   ---------------------------------------------------------------------- */
Game_Player.prototype._transferring = false;
Game_Player.prototype._newMapId = 0;
Game_Player.prototype._newX = 0;
Game_Player.prototype._newY = 0;
Game_Player.prototype._newDirection = 0;
Game_Player.prototype._fadeType = 0;
Game_Player.prototype.reserveTransfer = function (mapId, x, y, d, fadeType) {
  /* MV rpg_objects.js:7451-7458 / MZ rmmz_objects.js:8141-8148, verbatim. */
  this._transferring = true;
  this._newMapId = mapId;
  this._newX = x;
  this._newY = y;
  this._newDirection = d;
  this._fadeType = fadeType;
  /* core.js:558-563 — the harness observables. Kept so nothing that already
     passes stops passing; NOT part of the engine. */
  window.__transfer = { mapId: mapId, x: x, y: y, d: d, fade: fadeType };
  $gameMap.mapId = function () { return mapId; };
  $gamePlayer._x = x; $gamePlayer._y = y;
  $gameMap.onTransfer && $gameMap.onTransfer();
};
Game_Player.prototype.isTransferring = function () {
  return this._transferring;
};
Game_Player.prototype.newMapId = function () { return this._newMapId; };   /* MV :7468 / MZ :8165 */
Game_Player.prototype.fadeType = function () { return this._fadeType; };   /* MV :7480 / MZ :8177 */

/* -------------------------------------------------------------------------
   Follower gathering — MV rpg_objects.js:8002 areFollowersGathering, :8157
   gather, :8161 areGathering / MZ rmmz_objects.js:8710, :8871, :8875.
   Identical on both.

   areFollowersGathering DELEGATES: Game_Player asks its Game_Followers, which
   returns a raw flag. The flag is set by gather() and cleared inside
   updateGather() (MV :8124 / MZ :8839) once everybody has arrived — so it is
   sticky, and something that gathers followers and then never runs a frame
   leaves the game reporting "still gathering" forever. That stickiness is the
   behaviour, not a stub artefact.
   ---------------------------------------------------------------------- */
Game_Followers.prototype._gathering = false;
Game_Followers.prototype.gather = function () {
  this._gathering = true;
};
Game_Followers.prototype.areGathering = function () {
  return this._gathering;
};
/* Both read this._followers DIRECTLY, as the engine does, not through the
   followers() accessor. On a real game Game_Player.prototype.initMembers
   (MV rpg_objects.js:7407 / MZ rmmz_objects.js:8097) builds the Game_Followers
   in the constructor (MV :7420 / MZ :8110), so the field is always there.
   core.js:555 builds it LAZILY inside followers()
   instead, so in the harness these two throw until something has called
   $gamePlayer.followers() once. That is left to throw rather than guarded:
   the fix belongs in fixtures.js, and a silent `|| new Game_Followers()` here
   would hand every caller a fresh object whose _gathering is always false. */
Game_Player.prototype.gatherFollowers = function () {
  this._followers.gather();
};
Game_Player.prototype.areFollowersGathering = function () {
  return this._followers.areGathering();
};

/* -------------------------------------------------------------------------
   Map scrolling — MV rpg_objects.js:5579 setupScroll, :6009 startScroll,
   :6015 isScrolling / MZ rmmz_objects.js:6260, :6692, :6698. Identical.

   isScrolling is `this._scrollRest > 0` — a DISTANCE remaining, not a boolean
   and not a speed. Anything that reads a scroll as "in progress" by comparing
   displayX between frames disagrees with the engine on the last frame of a
   scroll, when the rest has already reached 0 but the position is still
   settling. core.js's Game_Map constructor does not call setupScroll, so the
   three fields are prototype defaults with setupScroll's own values.
   ---------------------------------------------------------------------- */
Game_Map.prototype._scrollDirection = 2;
Game_Map.prototype._scrollRest = 0;
Game_Map.prototype._scrollSpeed = 4;
Game_Map.prototype.setupScroll = function () {
  this._scrollDirection = 2;
  this._scrollRest = 0;
  this._scrollSpeed = 4;
};
Game_Map.prototype.startScroll = function (direction, distance, speed) {
  this._scrollDirection = direction;
  this._scrollRest = distance;
  this._scrollSpeed = speed;
};
Game_Map.prototype.isScrolling = function () {
  return this._scrollRest > 0;
};

/* -------------------------------------------------------------------------
   BattleManager forced-action FIELDS — MV rpg_managers.js:2153 initMembers
   (:2162 _actionForcedBattler) / MZ rmmz_managers.js:2285 (:2295).

   Only the fields are shared. BattleManager.isActionForced itself DIFFERS
   between the engines and lives in x-misc-mv.js / x-misc-mz.js; so does
   forceAction. Putting a single isActionForced here would be exactly the
   "flatten a difference into one convenient version" that the mod's whole job
   is to detect.

   core.js:1345 keeps BattleManager.forceAction as a pure spy — it counts into
   window.__forced / window.__forcedOn and does NOT assign _actionForcedBattler.
   It is left alone here: replacing it with MZ's real body would require
   battler.numActions(), which core.js's battlers do not have, and that belongs
   to whoever owns the battle surface. The consequence is written down rather
   than papered over: a check that wants isActionForced() to be true must set
   BattleManager._actionForcedBattler itself.
   ---------------------------------------------------------------------- */
BattleManager._actionForcedBattler = null;
BattleManager._actionBattlers = [];
BattleManager._turnForced = false;
BattleManager._subject = null;

/* -------------------------------------------------------------------------
   Bitmap.prototype.isError — MV rpg_core.js:965 / MZ rmmz_core.js:1301.
   Same body, same string. Needed because ImageManager.isReady consults it on
   both engines, and because a failed load is NOT a not-ready load: the two
   read the same on a naive stub and the engine treats them completely
   differently (MZ throws out of isReady, MV does not).
   ---------------------------------------------------------------------- */
Bitmap.prototype.isError = function () {
  return this._loadingState === 'error';
};

/* -------------------------------------------------------------------------
   TextManager term accessors — MV rpg_managers.js:1649 basic, :1657 command,
   :1661 message / MZ rmmz_managers.js:1619, :1627, :1631. Identical bodies.

   The `|| ""` matters: terms.commands has two NULL HOLES (indices 20 and 23,
   see the terms block below), and TextManager.command turns those into empty
   strings. So a dump that goes through TextManager sees "" and a dump that
   reads $dataSystem.terms.commands directly sees null. Both readings are
   legitimate; they are not the same value, and code that mixes them will
   disagree with itself.

   NOT redefined here: TextManager.param. core.js:1001 gives it a harness
   fallback of 'p' + id where both engines return ''. Left as it is because
   fixtures and the suite are built on it, but the divergence is real —
   anything asserting on an unfilled param term is asserting on the harness.
   Also NOT changed: both engines declare `function TextManager()` that throws
   ("This is a static class", MV :1645 / MZ :1615) exactly as they do for
   Utils, while core.js models it as an object literal. Utils already cost this
   project a silent `typeof === 'object'` failure on every real game; the same
   shape is present here and is only reported, not altered, because changing
   the binding would drop core.js's param().
   ---------------------------------------------------------------------- */
TextManager.basic = function (basicId) {
  return $dataSystem.terms.basic[basicId] || '';
};
TextManager.command = function (commandId) {
  return $dataSystem.terms.commands[commandId] || '';
};
TextManager.message = function (messageId) {
  return $dataSystem.terms.messages[messageId] || '';
};

/* -------------------------------------------------------------------------
   $dataSystem / $dataMap AUDIO READ SITES.

   These are floors: core.js models AudioManager as `{ stopAll }` only and has
   no Game_Vehicle at all, so the audio fields below would be inert data with
   nothing that reads them. Each body is the engine's; each is small; and if a
   later stub file defines the same name, that one wins, because it loads
   after this one.
   ---------------------------------------------------------------------- */
/* MV rpg_managers.js:1175 / MZ rmmz_managers.js:1164 — the real bodies stop
   the current track, swap buffers and seek. Only the call is modelled: what a
   check needs is WHICH AudioFile record was handed over, and every one of them
   comes out of $dataSystem or $dataMap. */
AudioManager.playBgm = function (bgm, pos) {
  window.__bgm = bgm;
  window.__bgmPlays = (window.__bgmPlays || 0) + 1;
  window.__bgmPos = pos;
};
AudioManager.playBgs = function (bgs, pos) {
  window.__bgs = bgs;
  window.__bgsPlays = (window.__bgsPlays || 0) + 1;
  window.__bgsPos = pos;
};
AudioManager.playMe = function (me) {
  window.__me = me;
  window.__mePlays = (window.__mePlays || 0) + 1;
};
/* MV rpg_managers.js:1538 / MZ rmmz_managers.js:1508 — playSystemSound(n)
   indexes $dataSystem.sounds by NUMBER. The 24 slots and their meanings are in
   __xdata.sounds() below. The `if ($dataSystem)` is the ENGINE's own guard,
   not a harness one: system sounds can be asked for before the database has
   loaded, and the engine's answer is to play nothing rather than throw.
   core.js:258-263 keeps its own playSave/playLoad/playBuzzer/playOk spies and
   they do NOT route through here, so this is the read site a check calls
   directly when it wants to see which record slot n resolves to. */
AudioManager.playStaticSe = function (se) {
  window.__se = se;
  window.__sePlays = (window.__sePlays || 0) + 1;
};
SoundManager.playSystemSound = function (n) {
  if ($dataSystem) {
    AudioManager.playStaticSe($dataSystem.sounds[n]);
  }
};

/* MV rpg_objects.js:193 / :201 / :209, MZ rmmz_objects.js:315 / :323 / :331 —
   identical. The `||` is the point: a project's System.json value is the
   FALLBACK, and $gameSystem's override wins. Something that dumps "the battle
   BGM" from $dataSystem alone reports the wrong track for any game that has
   ever run a Change Battle BGM command. */
Game_System.prototype.battleBgm = function () {
  return this._battleBgm || $dataSystem.battleBgm;
};
Game_System.prototype.victoryMe = function () {
  return this._victoryMe || $dataSystem.victoryMe;
};
Game_System.prototype.defeatMe = function () {
  return this._defeatMe || $dataSystem.defeatMe;
};
/* MV rpg_managers.js:1460 / MZ rmmz_managers.js:1445, verbatim — and note
   what is NOT in it: there is no `pan`. The empty audio object is a THREE-key
   object where every other AudioFile in the engine has four. Anything that
   round-trips audio by reading four fields writes `pan: undefined` back. */
AudioManager.makeEmptyAudioObject = function () {
  return { name: '', volume: 0, pitch: 0 };
};
/* MV rpg_managers.js:1430 / MZ rmmz_managers.js:1415 — and the saved record
   grows a FIFTH key, `pos`, that no System.json record has. */
AudioManager.saveBgm = function () {
  if (this._currentBgm) {
    var bgm = this._currentBgm;
    return {
      name: bgm.name,
      volume: bgm.volume,
      pitch: bgm.pitch,
      pan: bgm.pan,
      pos: this._bgmBuffer ? this._bgmBuffer.seek() : 0
    };
  } else {
    return this.makeEmptyAudioObject();
  }
};

/* MV rpg_objects.js:274 / MZ rmmz_objects.js:396 — identical, and NOT what
   the name suggests: saveWalkingBgm2 does not save the currently playing BGM
   (that is saveWalkingBgm, MV :270, via AudioManager.saveBgm). It stores the
   MAP's record straight out of $dataMap, so the track it remembers is the one
   the map declares, not the one actually playing. */
Game_System.prototype.saveWalkingBgm2 = function () {
  this._walkingBgm = $dataMap.bgm;
};
/* MV rpg_objects.js:7502-7516 / MZ rmmz_objects.js:8199-8213 — identical.
   isInVehicle is three comparisons, not a truthiness test on _vehicleType:
   the walking state is the STRING 'walk', not null, so `!!this._vehicleType`
   is true while walking and gets the autoplay branch exactly backwards. */
Game_Player.prototype._vehicleType = 'walk';
Game_Player.prototype.isInBoat = function () { return this._vehicleType === 'boat'; };
Game_Player.prototype.isInShip = function () { return this._vehicleType === 'ship'; };
Game_Player.prototype.isInAirship = function () { return this._vehicleType === 'airship'; };
Game_Player.prototype.isInVehicle = function () {
  return this.isInBoat() || this.isInShip() || this.isInAirship();
};

/* MV rpg_objects.js:5790-5801 / MZ rmmz_objects.js:6475-6486 — identical,
   including the asymmetry: the BGM branch is skipped for a player in a
   vehicle (the vehicle's own BGM is already playing) but the BGS branch is
   not. Both flags are read off $dataMap, so a map whose autoplayBgm is false
   has a bgm record that is never played and must still round-trip in a dump. */
Game_Map.prototype.autoplay = function () {
  if ($dataMap.autoplayBgm) {
    if ($gamePlayer.isInVehicle()) {
      $gameSystem.saveWalkingBgm2();
    } else {
      AudioManager.playBgm($dataMap.bgm);
    }
  }
  if ($dataMap.autoplayBgs) {
    AudioManager.playBgs($dataMap.bgs);
  }
};

/* =========================================================================
   DATA SHAPES.

   These are DATA, so nothing below assigns to $dataSystem, $dataMap or any of
   the row arrays at load time — fixtures.js declares all of them with `var`
   and loads AFTER this file, so an assignment here would simply be overwritten
   and the harness would look like it had these fields when it did not.

   Instead each shape is a factory, and window.__extendDatabase() applies them.
   It only ADDS keys that are absent; it never overwrites what fixtures.js
   built. fixtures.js must call it after its `var $data*` block (see the report
   accompanying this file).
   ====================================================================== */
window.__xdata = {};

/* The AudioFile record. Every one of titleBgm, battleBgm, victoryMe, defeatMe,
   gameoverMe, the three vehicle bgms, all 24 sounds, and $dataMap.bgm/bgs is
   this same four-field object — MV rpg_managers.js:1175 reads .name/.volume/
   .pitch/.pan off it, MZ rmmz_managers.js:1164 the same. An empty name means
   "no audio", NOT a missing record: the record is still there with name ''. */
window.__xdata.audioFile = function (name, volume, pitch, pan) {
  return {
    name: name,
    volume: volume === undefined ? 90 : volume,
    pitch: pitch === undefined ? 100 : pitch,
    pan: pan === undefined ? 0 : pan
  };
};

/* $dataSystem.sounds — exactly 24 entries, indexed 0..23 by
   SoundManager.playSystemSound (MV rpg_managers.js:1538 / MZ :1508). The names
   here are the SLOT ROLES the engine assigns, in the engine's order, so an
   off-by-one in a sound picker is visible instead of silent. */
window.__xdata.soundRoles = [
  'cursor', 'ok', 'cancel', 'buzzer', 'equip', 'save', 'load', 'battleStart',
  'escape', 'enemyAttack', 'enemyDamage', 'enemyCollapse', 'bossCollapse1',
  'bossCollapse2', 'actorDamage', 'actorCollapse', 'recovery', 'miss',
  'evasion', 'magicEvasion', 'reflection', 'shop', 'useItem', 'useSkill'
];
window.__xdata.sounds = function () {
  var a = [];
  for (var i = 0; i < window.__xdata.soundRoles.length; i++) {
    a.push(window.__xdata.audioFile('Se_' + window.__xdata.soundRoles[i]));
  }
  return a;
};

/* The vehicle record — MV rpg_objects.js:8244 Game_Vehicle.prototype.vehicle
   returns $dataSystem.boat / .ship / .airship, :8256 loadSystemSettings reads
   .bgm, .characterName and .characterIndex off it; MZ rmmz_objects.js:8950 /
   :8962, identical. startMapId/startX/startY are where the editor parks a
   vehicle that has never been placed. */
window.__xdata.vehicle = function (bgmName, characterIndex) {
  return {
    bgm: window.__xdata.audioFile(bgmName),
    characterIndex: characterIndex,
    characterName: 'Vehicle',
    startMapId: 0,
    startX: 0,
    startY: 0
  };
};

/* The $dataSystem audio block. Read sites:
   titleBgm   MV rpg_scenes.js:527  / MZ rmmz_scenes.js:617  (AudioManager.playBgm)
   battleBgm  MV rpg_objects.js:194 / MZ rmmz_objects.js:316 (Game_System fallback)
   victoryMe  MV rpg_objects.js:202 / MZ rmmz_objects.js:324
   defeatMe   MV rpg_objects.js:210 / MZ rmmz_objects.js:332
   gameoverMe MV rpg_scenes.js:2681 / MZ rmmz_scenes.js:3670 (AudioManager.playMe)
   boat/ship/airship  MV rpg_objects.js:8246 / MZ rmmz_objects.js:8952 */
window.__xdata.systemAudio = function () {
  return {
    sounds: window.__xdata.sounds(),
    titleBgm: window.__xdata.audioFile('Bgm_title'),
    battleBgm: window.__xdata.audioFile('Bgm_battle'),
    victoryMe: window.__xdata.audioFile('Me_victory'),
    defeatMe: window.__xdata.audioFile('Me_defeat'),
    gameoverMe: window.__xdata.audioFile('Me_gameover'),
    boat: window.__xdata.vehicle('Bgm_boat', 0),
    ship: window.__xdata.vehicle('Bgm_ship', 1),
    airship: window.__xdata.vehicle('Bgm_airship', 3)
  };
};

/* Encryption. The three fields are identical on both engines; WHO READS THEM
   and WHAT SHAPE the answer has is not, and that half is in x-misc-mv.js /
   x-misc-mz.js. hasEncrypted* default to true here so the read path is
   actually exercised — window.__applyEncryption() (per engine) re-runs the
   engine's own propagation after a test edits these. */
window.__xdata.encryption = function () {
  return {
    hasEncryptedAudio: true,
    hasEncryptedImages: true,
    /* 32 hex characters. Both engines chop it into 16 byte-pairs, so a key of
       any other length is a decrypt that produces garbage rather than an
       error — MV rpg_core.js:9267 splits on /(.{2})/ and filters the empty
       strings out, MZ rmmz_core.js:458 matches /.{2}/g. */
    encryptionKey: '00112233445566778899aabbccddeeff'
  };
};

/* terms.basic — 10 entries, identical default on both engines.
   Read through TextManager.basic (MV rpg_managers.js:1649 / MZ :1619). The
   doubled entries are the long form and the abbreviation of the same term. */
window.__xdata.termsBasic = function () {
  return ['Level', 'Lv', 'HP', 'HP', 'MP', 'MP', 'TP', 'TP', 'EXP', 'EXP'];
};

/* terms.commands — 26 entries WITH TWO NULLS, at index 20 and index 23, on
   BOTH engines. (The task brief called these MZ's holes; they are not — an MV
   project's System.json carries the same two nulls in the same two slots.
   Modelled as shared for that reason.)

   TextManager's getters skip them: newGame is 18, continue_ 19, toTitle 21,
   cancel 22, buy 24, sell 25. Nothing reads 20 or 23 — they are slots the
   editor stopped emitting a value for and never renumbered. Any dump, export
   or table view has to survive a null in the middle of a string array; the
   convenient fix of filtering them out silently renumbers every command after
   the hole. */
window.__xdata.termsCommands = function () {
  return [
    'Fight', 'Escape', 'Attack', 'Guard', 'Item', 'Skill', 'Equip', 'Status',
    'Formation', 'Save', 'Game End', 'Options', 'Weapon', 'Armor', 'Key Item',
    'Equip', 'Optimize', 'Clear', 'New Game', 'Continue', null, 'To Title',
    'Cancel', null, 'Buy', 'Sell'
  ];
};

/* terms.messages — the 41 keys whose default value is IDENTICAL on both
   engines. The 10 that differ, and the 2 that exist only on MZ, are in
   x-misc-mv.js / x-misc-mz.js as __xdata.termsMessagesEngine(); merging the
   two halves is what __extendDatabase does.

   The %1/%2/%3 slots are String.prototype.format placeholders (core.js:100).
   They are kept exactly as shipped — a term editor that HTML-escapes or
   trims them breaks the battle log, and it can only be caught if the real
   ones are here. */
window.__xdata.termsMessagesShared = function () {
  return {
    alwaysDash: 'Always Dash',
    commandRemember: 'Command Remember',
    bgmVolume: 'BGM Volume',
    bgsVolume: 'BGS Volume',
    meVolume: 'ME Volume',
    seVolume: 'SE Volume',
    possession: 'Possession',
    expTotal: 'Current %1',
    expNext: 'To Next %1',
    emerge: '%1 emerged!',
    preemptive: '%1 got the upper hand!',
    surprise: '%1 was surprised!',
    escapeStart: '%1 has started to escape!',
    escapeFailure: 'However, it was unable to escape!',
    victory: '%1 was victorious!',
    defeat: '%1 was defeated.',
    obtainExp: '%1 %2 received!',
    /* \\G is an escape code, not a literal backslash-G: the message window
       expands it to the currency unit. It survives JSON as a single
       backslash, so it is a single backslash here too. */
    obtainGold: '%1\\G found!',
    obtainItem: '%1 found!',
    levelUp: '%1 is now %2 %3!',
    obtainSkill: '%1 learned!',
    useItem: '%1 uses %2!',
    criticalToEnemy: 'An excellent hit!!',
    criticalToActor: 'A painful blow!!',
    actorRecovery: '%1 recovered %2 %3!',
    actorGain: '%1 gained %2 %3!',
    actorLoss: '%1 lost %2 %3!',
    actorDrain: '%1 was drained of %2 %3!',
    actorNoDamage: '%1 took no damage!',
    actorNoHit: 'Miss! %1 took no damage!',
    enemyRecovery: '%1 recovered %2 %3!',
    enemyGain: '%1 gained %2 %3!',
    enemyLoss: '%1 lost %2 %3!',
    enemyDrain: '%1 was drained of %2 %3!',
    enemyNoDamage: '%1 took no damage!',
    enemyNoHit: 'Miss! %1 took no damage!',
    evasion: '%1 evaded the attack!',
    magicEvasion: '%1 nullified the magic!',
    magicReflection: '%1 reflected the magic!',
    substitute: '%1 protected %2!',
    actionFailure: 'There was no effect on %1!'
  };
};

/* $dataMap audio — the four fields Game_Map.autoplay above reads.
   autoplayBgm / autoplayBgs are the editor's "Autoplay" checkboxes and are
   INDEPENDENT of whether bgm/bgs hold a record: a map with autoplayBgm false
   still ships a bgm object, and a map with autoplayBgm true and an empty name
   plays silence deliberately. Both cases have to round-trip. */
window.__xdata.mapAudio = function () {
  return {
    autoplayBgm: true,
    bgm: window.__xdata.audioFile('Bgm_field'),
    autoplayBgs: false,
    bgs: window.__xdata.audioFile('', 0)
  };
};

/* -------------------------------------------------------------------------
   ROW DESCRIPTION FIELDS.

   Where fixtures.js already builds a field, it is left exactly as it is; only
   absent keys are added. As of this writing fixtures.js gives
   $dataItems/$dataWeapons/$dataArmors/$dataSkills a `description` and
   $dataActors a `nickname` and `profile` (fixtures.js:83-110), and gives
   $dataSkills NO message1/message2 and $dataStates NO message1..message4 —
   those are the ones added below.

   A STATE HAS NO description ON EITHER ENGINE. Items, weapons, armors and
   skills do; states do not, and neither engine has a read site for one (grep
   `.description` in rpg_windows.js: the single hit is Window_Help.setItem at
   :1500, MZ rmmz_windows.js:1620, and a state is never passed to it). A dump
   that emits `description: ''` for a state is inventing a column, and a Forge
   round-trip that writes one adds a key the editor will not read back.
   ---------------------------------------------------------------------- */
window.__xdata.skillMessages = function (i) {
  /* MV rpg_windows.js:5075-5080 / MZ rmmz_windows.js:5330 — the battle log
     pushes message1 with the SUBJECT's name prefixed and message2 without.
     Both are format strings taking the item name as %1, and either may be ''
     for a skill that announces nothing. */
  return { message1: ' uses %1!', message2: '' };
};
window.__xdata.stateMessages = function (i) {
  /* message1 to an ACTOR, message2 to an ENEMY (MV rpg_windows.js:5224 / MZ
     rmmz_windows.js:5480 pick between them by target.isActor()), message3 is
     the "still afflicted" line read out of Game_BattlerBase (MV
     rpg_objects.js:2728), message4 is the removal line (MV rpg_windows.js:5239
     / rpg_objects.js:4169). All four are prefixed with the target's name by
     the caller, which is why they start with a space. */
  return {
    message1: ' is afflicted!',
    message2: ' is afflicted!',
    message3: ' is still afflicted.',
    message4: ' is no longer afflicted!'
  };
};

/* Add every key of src that target does not already have. Never overwrites —
   "extend rather than replace" is the whole contract of this block. */
window.__xdata.fill = function (target, src) {
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k) && !(k in target)) {
      target[k] = src[k];
    }
  }
  return target;
};

/* The applier. Call it from fixtures.js AFTER the `var $data*` declarations.
   Idempotent: running it twice adds nothing the second time. */
window.__extendDatabase = function () {
  var X = window.__xdata;

  /* $dataSystem: audio block, encryption block, and the engine's own extras
     (MZ contributes faceSize; MV contributes none — see x-misc-m*.js). */
  X.fill($dataSystem, X.systemAudio());
  X.fill($dataSystem, X.encryption());
  X.fill($dataSystem, X.engineSystem());

  /* terms. fixtures.js:64 already supplies terms.params (8 of the engine's 10
     entries); it is left untouched, and the engine's own 10-entry default is
     available as X.termsParams() for a check that wants the real table.
     $dataSystem.terms is NOT created if it is missing — fixtures.js always
     builds it, and a harness where it is absent should throw here rather than
     quietly grow an empty one. */
  X.fill($dataSystem.terms, {
    basic: X.termsBasic(),
    commands: X.termsCommands(),
    params: X.termsParams(),
    messages: X.fill(X.termsMessagesShared(), X.termsMessagesEngine())
  });

  /* $dataMap audio. */
  X.fill($dataMap, X.mapAudio());

  /* Rows. Index 0 is the null the editor always writes; from 1 up there are
     no holes in a database array, so the loops start at 1 and do not test. */
  var i;
  for (i = 1; i < $dataSkills.length; i++) {
    X.fill($dataSkills[i], X.skillMessages(i));
  }
  for (i = 1; i < $dataStates.length; i++) {
    X.fill($dataStates[i], X.stateMessages(i));
  }
  window.__databaseExtended = (window.__databaseExtended || 0) + 1;
};
