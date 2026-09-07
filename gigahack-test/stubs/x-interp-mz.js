/* =============================================================================
   GigaHack test harness — stubs/x-interp-mz.js
   The MZ 1.9.0 half of the INTERPRETER AND EVENTS surface.
   Copied from rmmz_objects.js / rmmz_managers.js / rmmz_core.js (MZ 1.9.0).

   Loaded immediately after engine-mz.js, which is where
   Game_Message.setSpeakerName lives — command101 below reads params[4] and
   calls it, and MV's command101 has no such parameter at all.

   STOCK ENGINE ONLY.

   THE FOUR DIVERGENCES THIS FILE EXISTS FOR
     1. Commands take their parameters as an ARGUMENT. executeCommand never
        writes a this._params field, and initialize never creates one. A panel
        that reads interpreter._params gets undefined here and an array on MV;
        that is not a stub artefact, it is the engine.
     2. Game_Temp holds a QUEUE. A second reserveCommonEvent APPENDS, and
        retrieveCommonEvent shifts. core.js already models this shape, so this
        file adds only what core.js is missing (clearCommonEventReservation)
        and leaves the rest alone; the MV override is in x-interp-mv.js.
     3. Game_Interpreter.clear keeps this._characterId, an id, and
        updateWaitMode re-resolves it through character() every frame — so the
        wait can go null mid-route where MV holds a stale object.
     4. Game_Map.autorunCommonEvents() exists. MV has no such method and
        inlines the same filter inside setupAutorunCommonEvent.
   ========================================================================== */

/* -------------------------------------------------------------------------
   DEPENDENCY FILLS — MZ spellings.
   ---------------------------------------------------------------------- */
/* rmmz_core.js:5569. MZ moved video out of Graphics into its own static class;
   MV asks Graphics.isVideoPlaying (rpg_core.js:2146). updateWaitMode's 'video'
   arm is the only caller here. SHAPE: the real body is
   `this._loading || this._isVisible()`, which needs MZ's <video> element. The
   class is declared the way MZ declares every static class — a function that
   throws — because `typeof Video === "object"` must be false, the same trap
   core.js records for Utils. */
function Video() {
  throw new Error('This is a static class');
}
Video.isPlaying = function () { return false; };

/* rmmz_managers.js:927 / :935. ONE argument each. MV's take a second `hue`
   (rpg_managers.js:823 / :831) and MV additionally has the whole request*
   family, which MZ deleted outright — Game_Interpreter.loadImages below is the
   MZ replacement for it. SHAPE: the real bodies go through
   ImageManager.loadBitmap and the cache, which the asset area owns; these
   record so a check can see which images a list pulled. */
ImageManager.loadFace = function (filename) {
  window.__loadedFaces = (window.__loadedFaces || []).concat([filename]);
  return null;
};
ImageManager.loadPicture = function (filename) {
  window.__loadedPictures = (window.__loadedPictures || []).concat([filename]);
  return null;
};

/* rmmz_objects.js:460 — MZ-ONLY. MV's Game_Timer has seconds() and nothing
   else; frames() does not exist there. command111's Timer arm is the caller
   and the difference is visible: MZ compares $gameTimer.frames() / 60, a
   fraction, where MV compares the floored seconds(). */
Game_Timer.prototype.frames = function () {
  return this._frames;
};

/* rmmz_objects.js:5627. MZ DELETED MV's three-line normalisation of the
   optional argument (MV rpg_objects.js:4972 opens with
   `if (includeEquip === undefined) includeEquip = false;`). Same answer either
   way; different body, and a mod that wraps hasItem has a different original
   to call through on each engine. isAnyMemberEquipped is the party area's and
   is only reached when includeEquip is true, so it is left to throw. */
Game_Party.prototype.hasItem = function (item, includeEquip) {
  if (this.numItems(item) > 0) {
    return true;
  } else if (includeEquip && this.isAnyMemberEquipped(item)) {
    return true;
  } else {
    return false;
  }
};

/* rmmz_managers.js:2866. THREE terms. MV's (rpg_managers.js:2588) is the
   single `!!this._actionForcedBattler`, so an interpreter waiting on 'action'
   through a party or troop wipe releases on MZ and hangs on MV. */
BattleManager.isActionForced = function () {
  return (
    !!this._actionForcedBattler &&
    !$gameParty.isAllDead() &&
    !$gameTroop.isAllDead()
  );
};

/* -------------------------------------------------------------------------
   Game_Temp — the MZ reserved-common-event form.
   rmmz_objects.js:10 / :14 / :85 / :89 / :93 / :97.

   core.js already models this shape correctly: _commonEventQueue, push on
   reserve, shift on retrieve, length as the reservation test. Those four are
   therefore NOT redefined here — redefining them would put a second, drifting
   copy of the same body in the tree. Only the one core.js lacks is added, plus
   initialize, whose field list is the real reason the two engines' Game_Temp
   objects look nothing alike in a variable inspector.
   ---------------------------------------------------------------------- */
/* rmmz_objects.js:14. Ten fields against MV's four. core.js's constructor does
   not call initialize (it sets _commonEventQueue directly), so this is the
   declared home for the rest of them. */
Game_Temp.prototype.initialize = function () {
  this._isPlaytest = Utils.isOptionValid('test');
  this._destinationX = null;
  this._destinationY = null;
  this._touchTarget = null;
  this._touchState = '';
  this._needsBattleRefresh = false;
  this._commonEventQueue = [];
  this._animationQueue = [];
  this._balloonQueue = [];
  this._lastActionData = [0, 0, 0, 0, 0, 0];
};

/* rmmz_objects.js:93 — MZ-ONLY, and MV's clearCommonEvent is not its
   equivalent: MV's drops the single pending id, this drops the WHOLE queue.
   MV has no way to say "cancel everything pending" because it can never have
   more than one thing pending. */
Game_Temp.prototype.clearCommonEventReservation = function () {
  this._commonEventQueue.length = 0;
};

/* -------------------------------------------------------------------------
   Game_Interpreter — the MZ half.
   ---------------------------------------------------------------------- */
/* rmmz_objects.js:9488. NO `this._params = []`. MV's initialize has that line
   (rpg_objects.js:8771) and MZ's does not, because MZ passes parameters as an
   argument instead. Everything else is line-for-line the same, checkOverflow
   before clear included. */
Game_Interpreter.prototype.initialize = function (depth) {
  this._depth = depth || 0;
  this.checkOverflow();
  this.clear();
  this._branch = {};
  this._indent = 0;
  this._frameCount = 0;
  this._freezeChecker = 0;
};

/* rmmz_objects.js:9504. this._characterId — a NUMBER. MV stores the resolved
   object in this._character (rpg_objects.js:8788). updateWaitMode below turns
   the id back into a character every frame, so a route wait whose event is
   gone resolves to null and the `waiting = character && ...` guards below
   answer null, not a crash. On MV the same situation calls a method on a stale
   object. Everything clear() leaves alone is the same on both: _branch,
   _indent, _depth, _frameCount, _freezeChecker. */
Game_Interpreter.prototype.clear = function () {
  this._mapId = 0;
  this._eventId = 0;
  this._list = null;
  this._index = 0;
  this._waitCount = 0;
  this._waitMode = '';
  this._comments = '';
  this._characterId = 0;
  this._childInterpreter = null;
};

/* rmmz_objects.js:9516. Ends with an INSTANCE call, this.loadImages() — MV
   ends with the static Game_Interpreter.requestImages(list). A mod that wants
   to see every list an interpreter is handed can alias one method on MZ and
   must alias a static on MV. */
Game_Interpreter.prototype.setup = function (list, eventId) {
  this.clear();
  this._mapId = $gameMap.mapId();
  this._eventId = eventId || 0;
  this._list = list;
  this.loadImages();
};

/* rmmz_objects.js:9524 — VERBATIM, including the engine's own note, because
   the note IS the delta. MZ preloads only the first 200 commands and only two
   codes; MV's requestImages walks the whole list, fifteen codes, and RECURSES
   into referenced common events. So a face used past command 200, or in a
   common event, is not preloaded on MZ and is on MV. */
Game_Interpreter.prototype.loadImages = function () {
  // [Note] The certain versions of MV had a more complicated preload scheme.
  //   However it is usually sufficient to preload face and picture images.
  var list = this._list.slice(0, 200);
  for (var i = 0; i < list.length; i++) {
    var command = list[i];
    switch (command.code) {
      case 101: // Show Text
        ImageManager.loadFace(command.parameters[0]);
        break;
      case 231: // Show Picture
        ImageManager.loadPicture(command.parameters[1]);
        break;
    }
  }
  window.__loadImageCalls = (window.__loadImageCalls || 0) + 1;
};

/* rmmz_objects.js:9548. Retrieve, then NULL-TEST, then set up — and the shift
   inside retrieveCommonEvent is what clears the reservation, so there is no
   separate clear call. MV needs three statements for this (retrieve, setup,
   clearCommonEvent) and does NOT null-test, so an id with no data throws
   there and returns false here. Note also that a queued id whose data is
   missing is consumed and dropped on MZ: the queue moved on, the method
   returned false, and the next frame tries the next entry. */
Game_Interpreter.prototype.setupReservedCommonEvent = function () {
  if ($gameTemp.isCommonEventReserved()) {
    var commonEvent = $gameTemp.retrieveCommonEvent();
    if (commonEvent) {
      this.setup(commonEvent.list);
      return true;
    }
  }
  return false;
};

/* rmmz_objects.js:9604. Ten arms, same order as MV's, four differences:
   'route', 'animation' and 'balloon' each RE-RESOLVE the character from
   this._characterId first and then guard the call with `character &&` — so
   `waiting` can end up null rather than a boolean, and `if (!waiting)` clears
   the wait mode on null. MV reads this._character straight and would throw.
   'video' asks Video.isPlaying where MV asks Graphics.isVideoPlaying. */
Game_Interpreter.prototype.updateWaitMode = function () {
  var character = null;
  var waiting = false;
  switch (this._waitMode) {
    case 'message':
      waiting = $gameMessage.isBusy();
      break;
    case 'transfer':
      waiting = $gamePlayer.isTransferring();
      break;
    case 'scroll':
      waiting = $gameMap.isScrolling();
      break;
    case 'route':
      character = this.character(this._characterId);
      waiting = character && character.isMoveRouteForcing();
      break;
    case 'animation':
      character = this.character(this._characterId);
      waiting = character && character.isAnimationPlaying();
      break;
    case 'balloon':
      character = this.character(this._characterId);
      waiting = character && character.isBalloonPlaying();
      break;
    case 'gather':
      waiting = $gamePlayer.areFollowersGathering();
      break;
    case 'action':
      waiting = BattleManager.isActionForced();
      break;
    case 'video':
      waiting = Video.isPlaying();
      break;
    case 'image':
      waiting = !ImageManager.isReady();
      break;
  }
  if (!waiting) {
    this._waitMode = '';
  }
  return waiting;
};

/* rmmz_objects.js:9660. VERBATIM — and one line shorter than MV's, which is
   the whole story. There is NO `this._params = command.parameters` here.
   command.parameters is passed to the handler as its argument, so:
     · interpreter._params does not exist on MZ;
     · a mod that aliases a command and reads this._params inside the alias
       reads undefined on MZ and works on MV;
     · a mod that aliases and calls the original must FORWARD the argument.
   The rest matches MV: name built from the code, no giant switch, _index++
   only on a truthy return, terminate() when the list runs out. */
Game_Interpreter.prototype.executeCommand = function () {
  var command = this.currentCommand();
  if (command) {
    this._indent = command.indent;
    var methodName = 'command' + command.code;
    if (typeof this[methodName] === 'function') {
      if (!this[methodName](command.parameters)) {
        return false;
      }
    }
    this._index++;
  } else {
    this.terminate();
  }
  return true;
};

/* rmmz_objects.js:10316. Case 0 writes `value` plainly; MV writes
   `oldValue = value` — an assignment inside the argument list whose result is
   never read (rpg_objects.js:9543). Cosmetic, and kept apart because a
   verbatim copy is the only way the harness can prove it is cosmetic. The
   try/catch around the whole switch is identical, and it is what turns a
   divide by a non-number into a silent 0. */
Game_Interpreter.prototype.operateVariable = function (variableId, operationType, value) {
  try {
    var oldValue = $gameVariables.value(variableId);
    switch (operationType) {
      case 0: // Set
        $gameVariables.setValue(variableId, value);
        break;
      case 1: // Add
        $gameVariables.setValue(variableId, oldValue + value);
        break;
      case 2: // Sub
        $gameVariables.setValue(variableId, oldValue - value);
        break;
      case 3: // Mul
        $gameVariables.setValue(variableId, oldValue * value);
        break;
      case 4: // Div
        $gameVariables.setValue(variableId, oldValue / value);
        break;
      case 5: // Mod
        $gameVariables.setValue(variableId, oldValue % value);
        break;
    }
  } catch (e) {
    $gameVariables.setValue(variableId, 0);
  }
};

/* rmmz_objects.js:9838. cancelType is clamped in the DECLARATION's ternary;
   MV declares it raw and clamps with an if afterwards (rpg_objects.js:9097).
   The callback is an arrow in the source; ES5 forces the .bind spelling MV
   uses, and the captured `this` is the same either way. */
Game_Interpreter.prototype.setupChoices = function (params) {
  var choices = params[0].clone();
  var cancelType = params[1] < choices.length ? params[1] : -2;
  var defaultType = params.length > 2 ? params[2] : 0;
  var positionType = params.length > 3 ? params[3] : 2;
  var background = params.length > 4 ? params[4] : 0;
  $gameMessage.setChoices(choices, defaultType, cancelType);
  $gameMessage.setChoiceBackground(background);
  $gameMessage.setChoicePositionType(positionType);
  $gameMessage.setChoiceCallback(function (n) {
    this._branch[this._indent] = n;
  }.bind(this));
};

/* --- The commands. Every one takes params. ---------------------------- */

/* Show Text — rmmz_objects.js:9796. Restructured against MV's, and every
   difference matters:
     · early `if ($gameMessage.isBusy()) return false;` instead of wrapping the
       whole body in the negation;
     · $gameMessage.setSpeakerName(params[4]) — MZ-ONLY, the fifth parameter
       MV's Show Text command does not have (docs/MV-MZ-DELTA.md §A.17 records
       setSpeakerName as absent on MV);
     · NO manual `this._index++` at the end, and it returns TRUE, so
       executeCommand advances the index. MV returns false and advances by
       hand. Net effect is the same landing index — but a mod that aliases
       command101 and returns its own boolean moves the index on MZ and does
       not on MV.
   The 401 text-collection loop and the 102/103/104 lookahead are identical. */
Game_Interpreter.prototype.command101 = function (params) {
  if ($gameMessage.isBusy()) {
    return false;
  }
  $gameMessage.setFaceImage(params[0], params[1]);
  $gameMessage.setBackground(params[2]);
  $gameMessage.setPositionType(params[3]);
  $gameMessage.setSpeakerName(params[4]);
  while (this.nextEventCode() === 401) {
    // Text data
    this._index++;
    $gameMessage.add(this.currentCommand().parameters[0]);
  }
  switch (this.nextEventCode()) {
    case 102: // Show Choices
      this._index++;
      this.setupChoices(this.currentCommand().parameters);
      break;
    case 103: // Input Number
      this._index++;
      this.setupNumInput(this.currentCommand().parameters);
      break;
    case 104: // Select Item
      this._index++;
      this.setupItemChoice(this.currentCommand().parameters);
      break;
  }
  this.setWaitMode('message');
  return true;
};

/* Show Scrolling Text — rmmz_objects.js:9896. Same restructure as 101: early
   false return, no manual index bump, returns true. */
Game_Interpreter.prototype.command105 = function (params) {
  if ($gameMessage.isBusy()) {
    return false;
  }
  $gameMessage.setScroll(params[0], params[1]);
  while (this.nextEventCode() === 405) {
    this._index++;
    $gameMessage.add(this.currentCommand().parameters[0]);
  }
  this.setWaitMode('message');
  return true;
};

/* Conditional Branch — rmmz_objects.js:9926. All fourteen operand types.

   Three arms differ from MV's:
     · case 3 (Timer) computes `$gameTimer.frames() / 60` and compares the
       FRACTION. MV compares the floored $gameTimer.seconds(), so the same
       "timer >= 5" branch flips up to 59 frames earlier on MZ.
     · case 4 (Actor), "In the Party", uses native .includes. MV uses
       .contains, its own Array.prototype polyfill.
     · case 11 (Button) grew a params[2] switch for pressed / triggered /
       repeated. MV has only Input.isPressed.
   The declarations at the top are hoisted the way MZ writes them (let value1,
   value2; let actor, enemy, character) — MV declares each inside its own case
   with var, which in ES5 hoists to the same place anyway. The tail is
   identical and is the contract: the result is filed under this._indent in the
   shared _branch map, and a false result skips forward. */
Game_Interpreter.prototype.command111 = function (params) {
  var result = false;
  var value1, value2;
  var actor, enemy, character;
  switch (params[0]) {
    case 0: // Switch
      result = $gameSwitches.value(params[1]) === (params[2] === 0);
      break;
    case 1: // Variable
      value1 = $gameVariables.value(params[1]);
      if (params[2] === 0) {
        value2 = params[3];
      } else {
        value2 = $gameVariables.value(params[3]);
      }
      switch (params[4]) {
        case 0: // Equal to
          result = value1 === value2;
          break;
        case 1: // Greater than or Equal to
          result = value1 >= value2;
          break;
        case 2: // Less than or Equal to
          result = value1 <= value2;
          break;
        case 3: // Greater than
          result = value1 > value2;
          break;
        case 4: // Less than
          result = value1 < value2;
          break;
        case 5: // Not Equal to
          result = value1 !== value2;
          break;
      }
      break;
    case 2: // Self Switch
      if (this._eventId > 0) {
        var key = [this._mapId, this._eventId, params[1]];
        result = $gameSelfSwitches.value(key) === (params[2] === 0);
      }
      break;
    case 3: // Timer
      if ($gameTimer.isWorking()) {
        var sec = $gameTimer.frames() / 60;
        if (params[2] === 0) {
          result = sec >= params[1];
        } else {
          result = sec <= params[1];
        }
      }
      break;
    case 4: // Actor
      actor = $gameActors.actor(params[1]);
      if (actor) {
        var n = params[3];
        switch (params[2]) {
          case 0: // In the Party
            result = $gameParty.members().includes(actor);
            break;
          case 1: // Name
            result = actor.name() === n;
            break;
          case 2: // Class
            result = actor.isClass($dataClasses[n]);
            break;
          case 3: // Skill
            result = actor.hasSkill(n);
            break;
          case 4: // Weapon
            result = actor.hasWeapon($dataWeapons[n]);
            break;
          case 5: // Armor
            result = actor.hasArmor($dataArmors[n]);
            break;
          case 6: // State
            result = actor.isStateAffected(n);
            break;
        }
      }
      break;
    case 5: // Enemy
      enemy = $gameTroop.members()[params[1]];
      if (enemy) {
        switch (params[2]) {
          case 0: // Appeared
            result = enemy.isAlive();
            break;
          case 1: // State
            result = enemy.isStateAffected(params[3]);
            break;
        }
      }
      break;
    case 6: // Character
      character = this.character(params[1]);
      if (character) {
        result = character.direction() === params[2];
      }
      break;
    case 7: // Gold
      switch (params[2]) {
        case 0: // Greater than or equal to
          result = $gameParty.gold() >= params[1];
          break;
        case 1: // Less than or equal to
          result = $gameParty.gold() <= params[1];
          break;
        case 2: // Less than
          result = $gameParty.gold() < params[1];
          break;
      }
      break;
    case 8: // Item
      result = $gameParty.hasItem($dataItems[params[1]]);
      break;
    case 9: // Weapon
      result = $gameParty.hasItem($dataWeapons[params[1]], params[2]);
      break;
    case 10: // Armor
      result = $gameParty.hasItem($dataArmors[params[1]], params[2]);
      break;
    case 11: // Button
      switch (params[2] || 0) {
        case 0:
          result = Input.isPressed(params[1]);
          break;
        case 1:
          result = Input.isTriggered(params[1]);
          break;
        case 2:
          result = Input.isRepeated(params[1]);
          break;
      }
      break;
    case 12: // Script
      result = !!eval(params[1]);
      break;
    case 13: // Vehicle
      result = $gamePlayer.vehicle() === $gameMap.vehicle(params[1]);
      break;
  }
  this._branch[this._indent] = result;
  if (this._branch[this._indent] === false) {
    this.skipBranch();
  }
  return true;
};

/* Else — rmmz_objects.js:10077. Kept because command111 is unreadable without
   it, and identical to MV's: `!== false`, so an indent that was never filed
   also skips. */
Game_Interpreter.prototype.command411 = function () {
  if (this._branch[this._indent] !== false) {
    this.skipBranch();
  }
  return true;
};

/* Common Event — rmmz_objects.js:10123. Identical to MV's apart from the
   params source. The child gets the parent's event id only while the parent is
   still on its own map; after a transfer it gets 0, and every self switch the
   child touches then does nothing, because command123 tests _eventId > 0. */
Game_Interpreter.prototype.command117 = function (params) {
  var commonEvent = $dataCommonEvents[params[0]];
  if (commonEvent) {
    var eventId = this.isOnCurrentMap() ? this._eventId : 0;
    this.setupChild(commonEvent.list, eventId);
  }
  return true;
};

/* Control Switches — rmmz_objects.js:10172. Inclusive range, `params[2] === 0`
   means ON, one requestRefresh per switch. */
Game_Interpreter.prototype.command121 = function (params) {
  for (var i = params[0]; i <= params[1]; i++) {
    $gameSwitches.setValue(i, params[2] === 0);
  }
  return true;
};

/* Control Variables — rmmz_objects.js:10180. Constant and Variable operands
   exact; the structure is where MZ parted from MV.

   MV's Random case builds its own loop and RETURNS EARLY, so nothing outside
   that case ever adds randomness (rpg_objects.js:9424). MZ deleted the early
   return: it carries a separate randomMax — 1 for every operand except Random,
   floored at 1 with Math.max — and funnels ALL five operands through ONE loop
   that adds Math.randomInt(randomMax). That addition is zero for every
   non-Random operand, so the answers agree; but because the shared loop now
   also sees a Script operand's result, MZ had to guard it with
   `typeof value === "number"` and write non-numbers straight through. MV has
   no such guard and needs none.

   gameDataOperand (operand 3) is NOT defined here: it reaches actors, enemies,
   characters, party and system counters across four other areas. Operand 3
   throws rather than quietly returning 0. */
Game_Interpreter.prototype.command122 = function (params) {
  var startId = params[0];
  var endId = params[1];
  var operationType = params[2];
  var operand = params[3];
  var value = 0;
  var randomMax = 1;
  switch (operand) {
    case 0: // Constant
      value = params[4];
      break;
    case 1: // Variable
      value = $gameVariables.value(params[4]);
      break;
    case 2: // Random
      value = params[4];
      randomMax = params[5] - params[4] + 1;
      randomMax = Math.max(randomMax, 1);
      break;
    case 3: // Game Data
      value = this.gameDataOperand(params[4], params[5], params[6]);
      break;
    case 4: // Script
      value = eval(params[4]);
      break;
  }
  for (var i = startId; i <= endId; i++) {
    if (typeof value === 'number') {
      var realValue = value + Math.randomInt(randomMax);
      this.operateVariable(i, operationType, realValue);
    } else {
      this.operateVariable(i, operationType, value);
    }
  }
  return true;
};

/* Control Self Switch — rmmz_objects.js:10349. The key is built from the
   interpreter's OWN _mapId and _eventId, captured at setup — so a common event
   run as a child of a map event writes the PARENT event's self switch, and one
   run from a reservation writes nothing at all. */
Game_Interpreter.prototype.command123 = function (params) {
  if (this._eventId > 0) {
    var key = [this._mapId, this._eventId, params[0]];
    $gameSelfSwitches.setValue(key, params[1] === 0);
  }
  return true;
};

/* Transfer Player — rmmz_objects.js:10490. Inverted against MV's: early
   `return false` on the guard, no manual this._index++, and `return true` at
   the end so executeCommand advances. MV wraps the body in the negation,
   bumps the index itself and always returns false. The five-argument
   reserveTransfer order is the same on both. */
Game_Interpreter.prototype.command201 = function (params) {
  if ($gameParty.inBattle() || $gameMessage.isBusy()) {
    return false;
  }
  var mapId, x, y;
  if (params[0] === 0) {
    // Direct designation
    mapId = params[1];
    x = params[2];
    y = params[3];
  } else {
    // Designation with variables
    mapId = $gameVariables.value(params[1]);
    x = $gameVariables.value(params[2]);
    y = $gameVariables.value(params[3]);
  }
  $gamePlayer.reserveTransfer(mapId, x, y, params[4], params[5]);
  this.setWaitMode('transfer');
  return true;
};

/* Wait — rmmz_objects.js:10702. Returns TRUE on both engines, so the index
   advances immediately and the whole pause lives in _waitCount; nothing sits
   on the 230 itself. */
Game_Interpreter.prototype.command230 = function (params) {
  this.wait(params[0]);
  return true;
};

/* Shop Processing — rmmz_objects.js:10983. Structurally identical to MV's:
   `[params]` — the first goods row IS the command's own parameter array — then
   the 605 continuation rows are appended, and params[4] (purchase-only) is
   read off that first row. Returns true, so the interpreter walks past the
   shop it just pushed; SceneManager.isSceneChanging in update() is what stops
   it, not this. */
Game_Interpreter.prototype.command302 = function (params) {
  if (!$gameParty.inBattle()) {
    var goods = [params];
    while (this.nextEventCode() === 605) {
      this._index++;
      goods.push(this.currentCommand().parameters);
    }
    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, params[4]);
  }
  return true;
};

/* -------------------------------------------------------------------------
   Game_Event — the two MZ membership tests.
   ---------------------------------------------------------------------- */
/* rmmz_objects.js:9300. Native `.includes`. MV uses `.contains`, which is a
   polyfill MV puts on Array.prototype and MZ does not have at all — so an MV
   plugin ported by copying this line breaks, and an MZ plugin ported the other
   way breaks on any MV build. */
Game_Event.prototype.isTriggerIn = function (triggers) {
  return triggers.includes(this._trigger);
};

/* rmmz_objects.js:9338. The FULL condition set — core.js's shared version
   stops after the self switch, so itemValid and actorValid pages could never
   fail there. Line for line identical to MV's (rpg_objects.js:8621) EXCEPT the
   actor clause, which is .includes here and .contains there.

   Two exactnesses worth keeping: variableValid fails on `< c.variableValue`,
   i.e. the page needs variable >= value; and selfSwitchValid compares
   `!== true`, not falsiness, so a self switch holding a truthy non-true value
   fails the page. The key uses this._mapId — the event's OWN stored map id,
   not $gameMap.mapId(). */
Game_Event.prototype.meetsConditions = function (page) {
  var c = page.conditions;
  if (c.switch1Valid) {
    if (!$gameSwitches.value(c.switch1Id)) {
      return false;
    }
  }
  if (c.switch2Valid) {
    if (!$gameSwitches.value(c.switch2Id)) {
      return false;
    }
  }
  if (c.variableValid) {
    if ($gameVariables.value(c.variableId) < c.variableValue) {
      return false;
    }
  }
  if (c.selfSwitchValid) {
    var key = [this._mapId, this._eventId, c.selfSwitchCh];
    if ($gameSelfSwitches.value(key) !== true) {
      return false;
    }
  }
  if (c.itemValid) {
    var item = $dataItems[c.itemId];
    if (!$gameParty.hasItem(item)) {
      return false;
    }
  }
  if (c.actorValid) {
    var actor = $gameActors.actor(c.actorId);
    if (!$gameParty.members().includes(actor)) {
      return false;
    }
  }
  return true;
};

/* -------------------------------------------------------------------------
   Game_Map — the MZ halves.
   ---------------------------------------------------------------------- */
/* rmmz_objects.js:6224. Clears BOTH arrays first, filters $dataMap.events
   before iterating, and indexes _events by event.id — MV indexes by the loop
   counter and walks the holes (rpg_objects.js:5546). The two agree only while
   $dataMap.events is itself id-indexed; compact that array and MV's ids drift
   while MZ's stay put. MZ also pushes common events one at a time where MV
   assigns the result of .map.

   CAUTION: `new Game_Event(this._mapId, event.id)` is the ENGINE's constructor
   signature; core.js's Game_Event takes (id, name, x, y). Copied anyway
   because the id-vs-index difference is the point. A fixture that wants
   populated events should build them the way fixtures.js already does and set
   _mapId, not call this. */
Game_Map.prototype.setupEvents = function () {
  this._events = [];
  this._commonEvents = [];
  var events = $dataMap.events.filter(function (event) { return !!event; });
  for (var i = 0; i < events.length; i++) {
    this._events[events[i].id] = new Game_Event(this._mapId, events[i].id);
  }
  var parallels = this.parallelCommonEvents();
  for (var j = 0; j < parallels.length; j++) {
    this._commonEvents.push(new Game_CommonEvent(parallels[j].id));
  }
  this.refreshTileEvents();
};

/* rmmz_objects.js:6248 — MZ-ONLY. There is NO Game_Map.autorunCommonEvents on
   MV; MV inlines the same trigger test inside setupAutorunCommonEvent
   (rpg_objects.js:6174). The seam is the difference: on MZ a mod can override
   the CANDIDATE LIST without touching the switch test that follows it, and on
   MV there is nothing to override short of the whole method. This is also the
   one method a feature test can use to tell the two Game_Map classes apart
   without touching Utils. */
Game_Map.prototype.autorunCommonEvents = function () {
  return $dataCommonEvents.filter(function (commonEvent) {
    return commonEvent && commonEvent.trigger === 1;
  });
};

/* rmmz_objects.js:6838. Reads window.$testEvent — an explicit property lookup,
   so an MZ build survives the global never having been declared. MV reads the
   bare identifier (rpg_objects.js:6152) and throws a ReferenceError in the
   same situation. Both then ASSIGN the bare identifier to null, which on MZ
   means the read is defensive and the write is not. */
Game_Map.prototype.setupTestEvent = function () {
  if (window.$testEvent) {
    this._interpreter.setup($testEvent, 0);
    $testEvent = null;
    return true;
  }
  return false;
};

/* rmmz_objects.js:6858. Two steps: get the autorun candidates, then test each
   one's switch. MV does both in a single condition inside one loop over the
   whole of $dataCommonEvents. Same first-match-wins result. */
Game_Map.prototype.setupAutorunCommonEvent = function () {
  var commonEvents = this.autorunCommonEvents();
  for (var i = 0; i < commonEvents.length; i++) {
    if ($gameSwitches.value(commonEvents[i].switchId)) {
      this._interpreter.setup(commonEvents[i].list);
      return true;
    }
  }
  return false;
};
