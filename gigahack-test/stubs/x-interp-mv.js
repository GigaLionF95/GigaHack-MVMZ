/* =============================================================================
   GigaHack test harness — stubs/x-interp-mv.js
   The MV 1.6.1 half of the INTERPRETER AND EVENTS surface.
   Copied from rpg_objects.js / rpg_managers.js / rpg_core.js (MV 1.6.1).

   Loaded immediately after engine-mv.js, which is where Array.prototype.contains
   is polyfilled — MV's own rpg_core.js:120 polyfill, and the reason two bodies
   below can spell membership the way MV really does.

   STOCK ENGINE ONLY.

   THE FOUR DIVERGENCES THIS FILE EXISTS FOR
     1. Game_Temp holds exactly ONE reserved common event id. A second
        reserveCommonEvent OVERWRITES the first, silently. core.js models MZ's
        queue for both engines; that is wrong here, and the override is below.
     2. executeCommand assigns this._params and calls command<code>() with NO
        arguments. Every command body reads this._params. On MZ neither is true.
     3. Game_Interpreter.clear keeps this._character — a resolved object —
        so updateWaitMode's route/animation/balloon arms read a stale reference
        after a transfer. MZ keeps an id and re-resolves.
     4. Game_Map has no autorunCommonEvents(); setupAutorunCommonEvent walks
        $dataCommonEvents itself and tests trigger and switch in one condition.
   ========================================================================== */

/* -------------------------------------------------------------------------
   DEPENDENCY FILLS — MV spellings. Same rule as in x-interp.js: copied from
   the engine, placed early enough that a later file modelling the owning
   class properly wins.
   ---------------------------------------------------------------------- */
/* rpg_core.js:2146. MV asks Graphics; MZ has a whole Video static class and
   asks Video.isPlaying() (rmmz_core.js:5569). updateWaitMode's 'video' arm is
   the only caller, and the two names is the whole difference. SHAPE: the real
   body is `this._videoLoading || this._isVideoVisible()`, both of which need
   MV's <video> element plumbing. */
Graphics.isVideoPlaying = function () { return false; };

/* rpg_managers.js:823 / :831 / :1023 / :1031 / :1015. MV's loaders take a
   SECOND `hue` argument that MZ dropped everywhere (MZ rmmz_managers.js:927
   is loadFace(filename), full stop), and MV also has the whole request*
   family that MZ deleted — Game_Interpreter.requestImages below is its only
   caller here. SHAPE: the real bodies go through ImageManager.loadBitmap and
   the image cache, which the asset area owns; these record the call so a
   check can see WHICH images a list caused to be pulled. */
ImageManager.loadFace = function (filename, hue) {
  window.__loadedFaces = (window.__loadedFaces || []).concat([filename]);
  return null;
};
ImageManager.loadPicture = function (filename, hue) {
  window.__loadedPictures = (window.__loadedPictures || []).concat([filename]);
  return null;
};
ImageManager.requestFace = function (filename, hue) {
  window.__requestedFaces = (window.__requestedFaces || []).concat([filename]);
  return null;
};
ImageManager.requestPicture = function (filename, hue) {
  window.__requestedPictures = (window.__requestedPictures || []).concat([filename]);
  return null;
};
ImageManager.requestCharacter = function (filename, hue) {
  window.__requestedCharacters = (window.__requestedCharacters || []).concat([filename]);
  return null;
};

/* rpg_objects.js:4972. MV NORMALISES the optional argument first
   (`if (includeEquip === undefined) includeEquip = false;`); MZ deleted those
   three lines (rmmz_objects.js:5627) and relies on `undefined && ...` being
   falsy. Same answer, different body — copied as written on each side because
   a mod that shadows hasItem has a different signature to preserve.
   command111's Item/Weapon/Armor arms and meetsConditions' itemValid clause
   are the callers. isAnyMemberEquipped is the party area's; it is only reached
   when includeEquip is true, so it is left to throw if a check goes there. */
Game_Party.prototype.hasItem = function (item, includeEquip) {
  if (includeEquip === undefined) {
    includeEquip = false;
  }
  if (this.numItems(item) > 0) {
    return true;
  } else if (includeEquip && this.isAnyMemberEquipped(item)) {
    return true;
  } else {
    return false;
  }
};

/* rpg_managers.js:2588. One term. MZ's (rmmz_managers.js:2866) ANDs in
   !$gameParty.isAllDead() && !$gameTroop.isAllDead(), so an interpreter
   waiting on 'action' through a party wipe hangs on MV and releases on MZ. */
BattleManager.isActionForced = function () {
  return !!this._actionForcedBattler;
};

/* -------------------------------------------------------------------------
   Game_Temp — THE MV RESERVED-COMMON-EVENT FORM.
   rpg_objects.js:10 / :14 / :25 / :29 / :33 / :37.

   core.js models MZ's queue (a _commonEventQueue array, push/shift). MV has no
   queue at all: ONE integer, and reserving a second event while a first is
   still pending throws the first away with no error and no trace. A mod that
   fires two common events in a frame gets both on MZ and one on MV.

   Two consequences are modelled rather than described:
     · retrieveCommonEvent is DELETED from the prototype. It does not exist on
       MV, and a feature test for it — the obvious way to ask "which engine is
       this?" — must answer no here.
     · clearCommonEvent is a SEPARATE call the caller has to make.
       setupReservedCommonEvent below makes it; MZ's retrieve+shift does it
       implicitly. An MV hook that reserves and never clears re-runs forever.

   core.js's constructor still leaves a _commonEventQueue = [] on every MV
   Game_Temp. It is dead once these override, and its deadness is the point: a
   panel that reads _commonEventQueue to show "what is queued" shows an empty
   array on MV no matter how many events are actually pending.
   ---------------------------------------------------------------------- */
/* rpg_objects.js:14 — initialize's own field. core.js's constructor does not
   call initialize, so this is the field's declared home; until fixtures sets
   it, `undefined > 0` is false and isCommonEventReserved answers no, which is
   the same answer a fresh engine Game_Temp gives. */
Game_Temp.prototype.initialize = function () {
  this._isPlaytest = Utils.isOptionValid('test');
  this._commonEventId = 0;
  this._destinationX = null;
  this._destinationY = null;
};

/* rpg_objects.js:25 — assignment, not push. window.__reservedCommon is
   core.js's observable and is kept, so a check can see BOTH what was asked for
   and what MV actually holds. */
Game_Temp.prototype.reserveCommonEvent = function (commonEventId) {
  this._commonEventId = commonEventId;
  window.__reservedCommon = (window.__reservedCommon || []).concat([commonEventId]);
};

/* rpg_objects.js:29 */
Game_Temp.prototype.clearCommonEvent = function () {
  this._commonEventId = 0;
};

/* rpg_objects.js:33 */
Game_Temp.prototype.isCommonEventReserved = function () {
  return this._commonEventId > 0;
};

/* rpg_objects.js:37 */
Game_Temp.prototype.reservedCommonEvent = function () {
  return $dataCommonEvents[this._commonEventId];
};

/* MZ-only, and core.js defines it for both. Removed so the absence is real. */
delete Game_Temp.prototype.retrieveCommonEvent;

/* -------------------------------------------------------------------------
   Game_Interpreter — the MV half.
   ---------------------------------------------------------------------- */
/* rpg_objects.js:8771. `this._params = []` is here and NOT in MZ's. Order is
   checkOverflow BEFORE clear, so an overflowing interpreter throws with its
   fields still unset. */
Game_Interpreter.prototype.initialize = function (depth) {
  this._depth = depth || 0;
  this.checkOverflow();
  this.clear();
  this._branch = {};
  this._params = [];
  this._indent = 0;
  this._frameCount = 0;
  this._freezeChecker = 0;
};

/* rpg_objects.js:8788. this._character — a RESOLVED CHARACTER OBJECT. MZ
   stores this._characterId instead and looks it up each frame, which is why an
   MV interpreter waiting on a move route holds a reference to an event that a
   map transfer has already replaced. Note also what clear() does NOT touch:
   _branch, _params, _indent, _depth and _freezeChecker all survive, so a
   cleared interpreter still reports the last command's indent. */
Game_Interpreter.prototype.clear = function () {
  this._mapId = 0;
  this._eventId = 0;
  this._list = null;
  this._index = 0;
  this._waitCount = 0;
  this._waitMode = '';
  this._comments = '';
  this._character = null;
  this._childInterpreter = null;
};

/* rpg_objects.js:8800. The last line is a STATIC call, and it is the one thing
   MV does at setup that MZ does not do the same way. */
Game_Interpreter.prototype.setup = function (list, eventId) {
  this.clear();
  this._mapId = $gameMap.mapId();
  this._eventId = eventId || 0;
  this._list = list;
  Game_Interpreter.requestImages(list);
};

/* rpg_objects.js:10516-10641. SHAPE, and the reduction is deliberate: the real
   body is a 125-line switch over FIFTEEN command codes (101, 117, 129, 205,
   212/337, 216, 231, 282, 283, 284, 322, 323, 336) reaching requestFace,
   requestCharacter, requestAnimation, requestTileset, requestBattleback1/2,
   requestParallax, requestSvActor, requestSvEnemy and requestEnemy. Every one
   of those needs an image cache the asset area owns, and none of them changes
   the interpreter's behaviour.

   What IS kept, exactly: the static-not-instance shape, the (list, commonList)
   signature, the `if(!list) return;` bail, the forEach walk of the WHOLE list
   (MZ caps at the first 200 commands), and case 117's RECURSION into the
   referenced common event's list — MV preloads through nested common events
   and MZ does not preload common events at all. commonList is MV's cycle
   guard: it accumulates already-visited common event ids so a common event
   that calls itself does not recurse forever.

   Left out: the other thirteen cases, all of which are ImageManager calls with
   no side effect on this class. */
Game_Interpreter.requestImages = function (list, commonList) {
  if (!list) return;

  list.forEach(function (command) {
    var params = command.parameters;
    switch (command.code) {
      // Show Text
      case 101:
        ImageManager.requestFace(params[0]);
        break;

      // Common Event
      case 117:
        var commonEvent = $dataCommonEvents[params[0]];
        if (commonEvent) {
          if (!commonList) {
            commonList = [];
          }
          if (!commonList.contains(params[0])) {
            commonList.push(params[0]);
            Game_Interpreter.requestImages(commonEvent.list, commonList);
          }
        }
        break;

      // Show Picture
      case 231:
        ImageManager.requestPicture(params[1]);
        break;
    }
  });
  window.__requestImageCalls = (window.__requestImageCalls || 0) + 1;
};

/* rpg_objects.js:8816. Three calls, and the middle one is MV-only: retrieve
   and clear are SEPARATE steps here. MZ's shift does both and additionally
   null-tests the retrieved event before setting up. So on MV, reserving a
   common event id that has no data hands setup() `undefined.list` and throws;
   on MZ it returns false and the map goes on. */
Game_Interpreter.prototype.setupReservedCommonEvent = function () {
  if ($gameTemp.isCommonEventReserved()) {
    this.setup($gameTemp.reservedCommonEvent().list);
    $gameTemp.clearCommonEvent();
    return true;
  } else {
    return false;
  }
};

/* rpg_objects.js:8871. Ten arms. The four differences from MZ's are all in
   here: 'route'/'animation'/'balloon' read this._character DIRECTLY (MZ calls
   this.character(this._characterId) first and can therefore get null), and
   'video' asks Graphics.isVideoPlaying (MZ asks Video.isPlaying). The clearing
   of _waitMode at the bottom is unconditional on both. */
Game_Interpreter.prototype.updateWaitMode = function () {
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
      waiting = this._character.isMoveRouteForcing();
      break;
    case 'animation':
      waiting = this._character.isAnimationPlaying();
      break;
    case 'balloon':
      waiting = this._character.isBalloonPlaying();
      break;
    case 'gather':
      waiting = $gamePlayer.areFollowersGathering();
      break;
    case 'action':
      waiting = BattleManager.isActionForced();
      break;
    case 'video':
      waiting = Graphics.isVideoPlaying();
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

/* rpg_objects.js:8923. VERBATIM — the real dispatcher is already this small on
   both engines; the giant per-command switch a plugin author expects does not
   exist, the method name is built from the code. Three MV-specific facts:
   this._params is assigned here (MZ has no such field), the handler is called
   with NO arguments, and _index++ happens only when the handler returned
   truthy — a handler returning false leaves _index where it was, which is how
   command101 and command201 re-run themselves on the next frame. */
Game_Interpreter.prototype.executeCommand = function () {
  var command = this.currentCommand();
  if (command) {
    this._params = command.parameters;
    this._indent = command.indent;
    var methodName = 'command' + command.code;
    if (typeof this[methodName] === 'function') {
      if (!this[methodName]()) {
        return false;
      }
    }
    this._index++;
  } else {
    this.terminate();
  }
  return true;
};

/* rpg_objects.js:9543. Awkward part kept: case 0 writes
   `$gameVariables.setValue(variableId, oldValue = value)` — an assignment
   INSIDE the argument list, whose only effect is to clobber oldValue for a
   `case` that has already returned. MZ cleaned that to plain `value`. The
   try/catch wrapping the whole switch is on both, and it means a divide by a
   non-number silently writes 0 instead of throwing. */
Game_Interpreter.prototype.operateVariable = function (variableId, operationType, value) {
  try {
    var oldValue = $gameVariables.value(variableId);
    switch (operationType) {
      case 0:  // Set
        $gameVariables.setValue(variableId, oldValue = value);
        break;
      case 1:  // Add
        $gameVariables.setValue(variableId, oldValue + value);
        break;
      case 2:  // Sub
        $gameVariables.setValue(variableId, oldValue - value);
        break;
      case 3:  // Mul
        $gameVariables.setValue(variableId, oldValue * value);
        break;
      case 4:  // Div
        $gameVariables.setValue(variableId, oldValue / value);
        break;
      case 5:  // Mod
        $gameVariables.setValue(variableId, oldValue % value);
        break;
    }
  } catch (e) {
    $gameVariables.setValue(variableId, 0);
  }
};

/* rpg_objects.js:9097. MV clamps cancelType AFTER reading it, with an if; MZ
   folds the same test into the declaration's ternary. Same result, and the
   callback closes over `this` through .bind — MZ uses an arrow. */
Game_Interpreter.prototype.setupChoices = function (params) {
  var choices = params[0].clone();
  var cancelType = params[1];
  var defaultType = params.length > 2 ? params[2] : 0;
  var positionType = params.length > 3 ? params[3] : 2;
  var background = params.length > 4 ? params[4] : 0;
  if (cancelType >= choices.length) {
    cancelType = -2;
  }
  $gameMessage.setChoices(choices, defaultType, cancelType);
  $gameMessage.setChoiceBackground(background);
  $gameMessage.setChoicePositionType(positionType);
  $gameMessage.setChoiceCallback(function (n) {
    this._branch[this._indent] = n;
  }.bind(this));
};

/* --- The commands. Every one reads this._params. ---------------------- */

/* Show Text — rpg_objects.js:9058. Returns FALSE unconditionally, so
   executeCommand does not advance _index and the command re-enters next frame
   until $gameMessage stops being busy. MV has FOUR setFaceImage-family params
   and no speaker name; MZ added $gameMessage.setSpeakerName(params[4]) and
   restructured the whole body into an early `if (busy) return false;` that
   ends `return true` — so MZ ADVANCES the index itself and MV does not. The
   inner `this._index++` before setWaitMode is MV-only for exactly that reason. */
Game_Interpreter.prototype.command101 = function () {
  if (!$gameMessage.isBusy()) {
    $gameMessage.setFaceImage(this._params[0], this._params[1]);
    $gameMessage.setBackground(this._params[2]);
    $gameMessage.setPositionType(this._params[3]);
    while (this.nextEventCode() === 401) {  // Text data
      this._index++;
      $gameMessage.add(this.currentCommand().parameters[0]);
    }
    switch (this.nextEventCode()) {
      case 102:  // Show Choices
        this._index++;
        this.setupChoices(this.currentCommand().parameters);
        break;
      case 103:  // Input Number
        this._index++;
        this.setupNumInput(this.currentCommand().parameters);
        break;
      case 104:  // Select Item
        this._index++;
        this.setupItemChoice(this.currentCommand().parameters);
        break;
    }
    this._index++;
    this.setWaitMode('message');
  }
  return false;
};

/* Show Scrolling Text — rpg_objects.js:9159. Same false-return, same manual
   _index++, same MZ restructure. */
Game_Interpreter.prototype.command105 = function () {
  if (!$gameMessage.isBusy()) {
    $gameMessage.setScroll(this._params[0], this._params[1]);
    while (this.nextEventCode() === 405) {
      this._index++;
      $gameMessage.add(this.currentCommand().parameters[0]);
    }
    this._index++;
    this.setWaitMode('message');
  }
  return false;
};

/* Conditional Branch — rpg_objects.js:9183. All fourteen operand types, so the
   switch/variable/self-switch arms sit in their real context.

   Two arms differ from MZ:
     · case 3 (Timer) asks $gameTimer.seconds(), an INTEGER — so "timer >= 5"
       is true from 5.0s. MZ computes $gameTimer.frames() / 60 and compares the
       fraction, so the same branch flips up to 59 frames later.
     · case 4 (Actor), "In the Party", uses $gameParty.members().contains(actor).
       MZ uses .includes. Identical semantics; different method, and .contains
       exists only because MV polyfills it onto Array.prototype.
   MV's case 11 (Button) has ONE form, Input.isPressed; MZ added a params[2]
   switch for triggered/repeated. Left as MV has it.

   The tail is the load-bearing part and is identical on both: the result is
   filed under this._indent in the shared _branch map, and a false result skips
   forward to the matching indent. _branch is keyed by INDENT, not by index, so
   two branches at the same depth share a slot. */
Game_Interpreter.prototype.command111 = function () {
  var result = false;
  switch (this._params[0]) {
    case 0:  // Switch
      result = ($gameSwitches.value(this._params[1]) === (this._params[2] === 0));
      break;
    case 1:  // Variable
      var value1 = $gameVariables.value(this._params[1]);
      var value2;
      if (this._params[2] === 0) {
        value2 = this._params[3];
      } else {
        value2 = $gameVariables.value(this._params[3]);
      }
      switch (this._params[4]) {
        case 0:  // Equal to
          result = (value1 === value2);
          break;
        case 1:  // Greater than or Equal to
          result = (value1 >= value2);
          break;
        case 2:  // Less than or Equal to
          result = (value1 <= value2);
          break;
        case 3:  // Greater than
          result = (value1 > value2);
          break;
        case 4:  // Less than
          result = (value1 < value2);
          break;
        case 5:  // Not Equal to
          result = (value1 !== value2);
          break;
      }
      break;
    case 2:  // Self Switch
      if (this._eventId > 0) {
        var key = [this._mapId, this._eventId, this._params[1]];
        result = ($gameSelfSwitches.value(key) === (this._params[2] === 0));
      }
      break;
    case 3:  // Timer
      if ($gameTimer.isWorking()) {
        if (this._params[2] === 0) {
          result = ($gameTimer.seconds() >= this._params[1]);
        } else {
          result = ($gameTimer.seconds() <= this._params[1]);
        }
      }
      break;
    case 4:  // Actor
      var actor = $gameActors.actor(this._params[1]);
      if (actor) {
        var n = this._params[3];
        switch (this._params[2]) {
          case 0:  // In the Party
            result = $gameParty.members().contains(actor);
            break;
          case 1:  // Name
            result = (actor.name() === n);
            break;
          case 2:  // Class
            result = actor.isClass($dataClasses[n]);
            break;
          case 3:  // Skill
            result = actor.hasSkill(n);
            break;
          case 4:  // Weapon
            result = actor.hasWeapon($dataWeapons[n]);
            break;
          case 5:  // Armor
            result = actor.hasArmor($dataArmors[n]);
            break;
          case 6:  // State
            result = actor.isStateAffected(n);
            break;
        }
      }
      break;
    case 5:  // Enemy
      var enemy = $gameTroop.members()[this._params[1]];
      if (enemy) {
        switch (this._params[2]) {
          case 0:  // Appeared
            result = enemy.isAlive();
            break;
          case 1:  // State
            result = enemy.isStateAffected(this._params[3]);
            break;
        }
      }
      break;
    case 6:  // Character
      var character = this.character(this._params[1]);
      if (character) {
        result = (character.direction() === this._params[2]);
      }
      break;
    case 7:  // Gold
      switch (this._params[2]) {
        case 0:  // Greater than or equal to
          result = ($gameParty.gold() >= this._params[1]);
          break;
        case 1:  // Less than or equal to
          result = ($gameParty.gold() <= this._params[1]);
          break;
        case 2:  // Less than
          result = ($gameParty.gold() < this._params[1]);
          break;
      }
      break;
    case 8:  // Item
      result = $gameParty.hasItem($dataItems[this._params[1]]);
      break;
    case 9:  // Weapon
      result = $gameParty.hasItem($dataWeapons[this._params[1]], this._params[2]);
      break;
    case 10:  // Armor
      result = $gameParty.hasItem($dataArmors[this._params[1]], this._params[2]);
      break;
    case 11:  // Button
      result = Input.isPressed(this._params[1]);
      break;
    case 12:  // Script
      result = !!eval(this._params[1]);
      break;
    case 13:  // Vehicle
      result = ($gamePlayer.vehicle() === $gameMap.vehicle(this._params[1]));
      break;
  }
  this._branch[this._indent] = result;
  if (this._branch[this._indent] === false) {
    this.skipBranch();
  }
  return true;
};

/* Else — rpg_objects.js:9321. Kept because command111 is unreadable without
   the other half of the contract: `!== false`, so an indent that was never
   filed at all also skips. */
Game_Interpreter.prototype.command411 = function () {
  if (this._branch[this._indent] !== false) {
    this.skipBranch();
  }
  return true;
};

/* Common Event — rpg_objects.js:9368. Runs as a CHILD interpreter, not on this
   one, so the parent's _index does not move and the parent resumes exactly
   where it was. The event id it inherits is the parent's only while the parent
   is still on its own map; after a transfer it becomes 0, and every self
   switch the child touches then silently does nothing (command123 tests
   `this._eventId > 0`). */
Game_Interpreter.prototype.command117 = function () {
  var commonEvent = $dataCommonEvents[this._params[0]];
  if (commonEvent) {
    var eventId = this.isOnCurrentMap() ? this._eventId : 0;
    this.setupChild(commonEvent.list, eventId);
  }
  return true;
};

/* Control Switches — rpg_objects.js:9416. A RANGE, inclusive at both ends, and
   `params[2] === 0` means ON. Each setValue requests a map refresh. */
Game_Interpreter.prototype.command121 = function () {
  for (var i = this._params[0]; i <= this._params[1]; i++) {
    $gameSwitches.setValue(i, this._params[2] === 0);
  }
  return true;
};

/* Control Variables — rpg_objects.js:9424. The Constant and Variable operands
   are the two the panels drive and they are exact.

   The MV/MZ split is in the RANDOM operand, and it is structural. MV computes
   the span into `value`, runs its OWN loop, and RETURNS EARLY — two loops in
   one method, and nothing outside case 2 ever touches randomness. MZ deleted
   that early return: it carries a separate `randomMax` (1 for every other
   operand) and funnels ALL five operands through one loop that adds
   Math.randomInt(randomMax) — zero unless the operand was Random. Because that
   one loop now sees Script results too, MZ had to add a
   `typeof value === "number"` test around the addition; MV needs no such test
   precisely because its Random case never reaches the shared loop.

   Note the `break` after `return true` in case 2 — unreachable, and in the
   source. Kept.

   gameDataOperand (operand 3) is NOT defined here: it reaches actors, enemies,
   characters, party and system counters across four other areas. Operand 3
   therefore throws rather than quietly returning 0. */
Game_Interpreter.prototype.command122 = function () {
  var value = 0;
  switch (this._params[3]) { // Operand
    case 0: // Constant
      value = this._params[4];
      break;
    case 1: // Variable
      value = $gameVariables.value(this._params[4]);
      break;
    case 2: // Random
      value = this._params[5] - this._params[4] + 1;
      for (var i = this._params[0]; i <= this._params[1]; i++) {
        this.operateVariable(i, this._params[2], this._params[4] + Math.randomInt(value));
      }
      return true;
      break;
    case 3: // Game Data
      value = this.gameDataOperand(this._params[4], this._params[5], this._params[6]);
      break;
    case 4: // Script
      value = eval(this._params[4]);
      break;
  }
  for (var i = this._params[0]; i <= this._params[1]; i++) {
    this.operateVariable(i, this._params[2], value);
  }
  return true;
};

/* Control Self Switch — rpg_objects.js:9572. The key is built from the
   interpreter's OWN _mapId and _eventId, captured at setup. A common event run
   as a child of a map event therefore writes the PARENT event's self switch;
   run from a reservation it writes nothing, because _eventId is 0. */
Game_Interpreter.prototype.command123 = function () {
  if (this._eventId > 0) {
    var key = [this._mapId, this._eventId, this._params[0]];
    $gameSelfSwitches.setValue(key, this._params[1] === 0);
  }
  return true;
};

/* Transfer Player — rpg_objects.js:9709. Returns false and advances _index by
   hand inside the guard, so a transfer attempted during a message re-runs next
   frame. MZ inverted this into an early `return false` and ends `return true`.
   The five-argument reserveTransfer order is (mapId, x, y, direction, fadeType)
   on both. */
Game_Interpreter.prototype.command201 = function () {
  if (!$gameParty.inBattle() && !$gameMessage.isBusy()) {
    var mapId, x, y;
    if (this._params[0] === 0) {  // Direct designation
      mapId = this._params[1];
      x = this._params[2];
      y = this._params[3];
    } else {  // Designation with variables
      mapId = $gameVariables.value(this._params[1]);
      x = $gameVariables.value(this._params[2]);
      y = $gameVariables.value(this._params[3]);
    }
    $gamePlayer.reserveTransfer(mapId, x, y, this._params[4], this._params[5]);
    this.setWaitMode('transfer');
    this._index++;
  }
  return false;
};

/* Wait — rpg_objects.js:9907. The whole command. Note it returns TRUE, so the
   index advances immediately and the pause is entirely in _waitCount; a check
   that expects the interpreter to sit on the 230 itself is measuring the wrong
   thing. */
Game_Interpreter.prototype.command230 = function () {
  this.wait(this._params[0]);
  return true;
};

/* Shop Processing — rpg_objects.js:10177. Identical to MZ's apart from the
   params source. `[this._params]` — the first goods row IS the command's own
   parameter array, and the 605 continuation rows are pushed after it, so goods
   is an array of parameter arrays and params[4] (purchase-only) is read off
   the FIRST row. Returns true, so the interpreter walks straight past the shop
   it just pushed; the scene stack is what stops it, through
   SceneManager.isSceneChanging in update(). */
Game_Interpreter.prototype.command302 = function () {
  if (!$gameParty.inBattle()) {
    var goods = [this._params];
    while (this.nextEventCode() === 605) {
      this._index++;
      goods.push(this.currentCommand().parameters);
    }
    SceneManager.push(Scene_Shop);
    SceneManager.prepareNextScene(goods, this._params[4]);
  }
  return true;
};

/* -------------------------------------------------------------------------
   Game_Event — the two MV membership tests.
   ---------------------------------------------------------------------- */
/* rpg_objects.js:8583. `.contains`, MV's own Array.prototype polyfill
   (rpg_core.js:120, mirrored in engine-mv.js). MZ uses native .includes. A mod
   that calls isTriggerIn on an engine-agnostic array is fine either way; a mod
   that reimplements it with .contains breaks on MZ, and with .includes breaks
   on any MV build old enough to matter. */
Game_Event.prototype.isTriggerIn = function (triggers) {
  return triggers.contains(this._trigger);
};

/* rpg_objects.js:8621. The FULL condition set — core.js's version stops after
   the self switch, so itemValid and actorValid pages could never fail there.
   The actor clause is the .contains/.includes split again (MZ :9338 is
   otherwise identical, line for line).

   Two exactnesses worth keeping: variableValid is `< c.variableValue` → false,
   i.e. the page needs variable >= value; and selfSwitchValid compares
   `!== true`, not falsiness, so a self switch holding a truthy non-true value
   fails the page. The key is [this._mapId, this._eventId, ch] — the event's
   OWN stored map id, not $gameMap.mapId(). */
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
    if (!$gameParty.members().contains(actor)) {
      return false;
    }
  }
  return true;
};

/* -------------------------------------------------------------------------
   Game_Map — the MV halves.
   ---------------------------------------------------------------------- */
/* rpg_objects.js:5546. Indexes _events by the LOOP COUNTER i, walking the raw
   $dataMap.events array including its holes; MZ filters first and indexes by
   event.id (rmmz_objects.js:6224). The two agree only because $dataMap.events
   is itself id-indexed — an editor or a plugin that compacts that array makes
   MV's ids drift and MZ's stay put. MV also builds _commonEvents with .map on
   the filtered parallel list; MZ clears the array first and pushes.

   CAUTION: `new Game_Event(this._mapId, i)` is the ENGINE's constructor
   signature. core.js's Game_Event takes (id, name, x, y), so calling this
   against core.js's class produces events whose _eventId is the map id. It is
   copied anyway because the id-vs-index difference is the point; a fixture
   that wants populated events should build them the way fixtures.js already
   does and set _mapId, not call this. */
Game_Map.prototype.setupEvents = function () {
  this._events = [];
  for (var i = 0; i < $dataMap.events.length; i++) {
    if ($dataMap.events[i]) {
      this._events[i] = new Game_Event(this._mapId, i);
    }
  }
  this._commonEvents = this.parallelCommonEvents().map(function (commonEvent) {
    return new Game_CommonEvent(commonEvent.id);
  });
  this.refreshTileEvents();
};

/* rpg_objects.js:6152. Reads the BARE identifier $testEvent. MZ reads
   window.$testEvent (rmmz_objects.js:6838) — which is why an MZ build survives
   a global that was never declared and an MV build throws a ReferenceError.
   x-interp.js declares it so both bodies have a target. */
Game_Map.prototype.setupTestEvent = function () {
  if ($testEvent) {
    this._interpreter.setup($testEvent, 0);
    $testEvent = null;
    return true;
  }
  return false;
};

/* rpg_objects.js:6174 — and this is the MZ-only-method delta from the other
   side. MV has NO Game_Map.autorunCommonEvents(); it walks $dataCommonEvents
   itself, from index 0, and tests trigger AND switch in ONE condition, taking
   the first match. MZ splits the two tests across autorunCommonEvents() and
   this method, which means an MZ mod can override the CANDIDATE LIST without
   touching the switch test and an MV mod cannot: on MV there is no seam. */
Game_Map.prototype.setupAutorunCommonEvent = function () {
  for (var i = 0; i < $dataCommonEvents.length; i++) {
    var event = $dataCommonEvents[i];
    if (event && event.trigger === 1 && $gameSwitches.value(event.switchId)) {
      this._interpreter.setup(event.list);
      return true;
    }
  }
  return false;
};
