/* =============================================================================
   GigaHack test harness — stubs/x-interp-mz.js
   The MZ 1.9.0 half of the INTERPRETER AND EVENTS surface.
   Modelled on rmmz_objects.js / rmmz_managers.js / rmmz_core.js (MZ 1.9.0):
   every definition below cites the source file and line its behaviour was
   read from, and is then written to say WHY the engine answers as it does.

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
   STUB-LOCAL SHAPES — NOT ENGINE SURFACE.

   Nothing under StubInterpMZ is named anywhere in RPG Maker, and nothing a mod
   can reach names it either. It exists so the definitions below can state each
   repeated idea once instead of spelling it out per command; gathering it on
   one object rather than as loose globals means a reader scanning this file
   for engine names never trips over a name the engine does not have.
   ---------------------------------------------------------------------- */
var StubInterpMZ = {};

/* The engine dispatches its command parameters with `switch`, which matches on
   ===. A bare table lookup would ALSO match the string "0", because a property
   name is a string; routing every lookup through this keeps a table exactly as
   strict as the switch it stands in for. A non-number selects no arm, and the
   caller's own default answer stands — which is the engine's `result = false`
   surviving a switch that matched nothing. */
StubInterpMZ.arm = function (table, code) {
  return typeof code === 'number' ? table[code] : undefined;
};

/* Step the interpreter onto the row it is currently peeking at and hand back
   that row's parameters. The 401 text rows, the 102/103/104 hand-off and the
   605 shop rows are each exactly this and nothing else: `_index++`, then read
   the row it now points at. Saying it once is also the clearest statement of
   why a Show Text leaves the interpreter sitting ON the last row it consumed
   rather than past it — executeCommand's own `_index++` supplies the last
   step, and that is why command101 may return true. */
StubInterpMZ.step = function (interpreter) {
  interpreter._index++;
  return interpreter.currentCommand().parameters;
};

/* A trailing parameter the editor may or may not have written: the value if
   the array is long enough to hold it, this default otherwise. Length, not
   `undefined` — an explicitly stored undefined counts as present. */
StubInterpMZ.optional = function (params, index, fallback) {
  return params.length > index ? params[index] : fallback;
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

/* The only two command codes MZ preloads for, and which parameter of each
   holds the filename. A code that is not a key here is walked past. */
StubInterpMZ.preloaders = {
  101: function (parameters) { return ImageManager.loadFace(parameters[0]); },    // Show Text
  231: function (parameters) { return ImageManager.loadPicture(parameters[1]); }  // Show Picture
};

/* rmmz_objects.js:9524. Two codes, and only over the FIRST 200 commands of the
   list — MZ's own note beside this method says as much: the elaborate preload
   some MV builds carried was cut back on the grounds that faces and pictures
   are the two that matter. That cut is the delta. MV's requestImages walks the
   whole list, knows fifteen codes, and RECURSES into referenced common events,
   so a face used past command 200, or used inside a common event, is preloaded
   on MV and is not preloaded here.

   `slice(0, 200)` and not a bounded loop: the copy is what makes the 200 a
   property of the list being read rather than of the walk, so a list that
   grows while this runs is still only read 200 deep. */
Game_Interpreter.prototype.loadImages = function () {
  var head = this._list.slice(0, 200);
  for (var i = 0; i < head.length; i++) {
    var preload = StubInterpMZ.arm(StubInterpMZ.preloaders, head[i].code);
    if (preload) {
      preload(head[i].parameters);
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

/* rmmz_objects.js:9660. One line shorter than MV's, and the missing line is
   the whole story: there is NO `this._params = command.parameters` here.
   command.parameters is handed to the handler as its argument instead, so:
     · interpreter._params does not exist on MZ;
     · a mod that aliases a command and reads this._params inside the alias
       reads undefined on MZ and works on MV;
     · a mod that aliases and calls the original must FORWARD the argument.
   The rest matches MV: the handler's name is built from the code rather than
   found in a giant switch, an unknown code is walked past rather than being an
   error, _index++ happens only on a truthy return — a falsy one means "run me
   again next frame" — and running off the end of the list terminates. */
Game_Interpreter.prototype.executeCommand = function () {
  var command = this.currentCommand();
  if (!command) {
    this.terminate();
    return true;
  }
  this._indent = command.indent;
  var methodName = 'command' + command.code;
  if (typeof this[methodName] === 'function' && !this[methodName](command.parameters)) {
    return false;
  }
  this._index++;
  return true;
};

/* The six operation codes, as the binary operator each one names. Set ignores
   the old value; that is the ONLY thing that distinguishes it. */
StubInterpMZ.variableOps = [
  function (oldValue, value) { return value; },             // 0 Set
  function (oldValue, value) { return oldValue + value; },  // 1 Add
  function (oldValue, value) { return oldValue - value; },  // 2 Sub
  function (oldValue, value) { return oldValue * value; },  // 3 Mul
  function (oldValue, value) { return oldValue / value; },  // 4 Div
  function (oldValue, value) { return oldValue % value; }   // 5 Mod
];

/* rmmz_objects.js:10316. Every arm of the engine's switch is the same three
   moves — read the old value, combine it with the incoming one, write the
   answer back — so the table above holds the only part that varies and the
   read and the write are written once. Three exactnesses survive the rewrite
   and are the reason the shape is worth stating:
     · the read happens BEFORE the operation is chosen, and happens even for
       Set, which never looks at what it read. Anything counting reads through
       $gameVariables sees the count the engine produces.
     · an operationType with no arm writes NOTHING AT ALL. The engine's switch
       falls off the end; there is no default that stores a 0.
     · the try/catch wraps the read, the combine and the write together, so an
       operand the engine cannot combine — a Symbol, an object whose valueOf
       throws — lands on a flat write of 0 rather than propagating.
   MZ's Set arm passes `value` plainly where MV's passes `oldValue = value`, an
   assignment inside the argument list whose result is never read
   (rpg_objects.js:9543). Cosmetic there; the table is what makes that claim
   checkable, because both engines' Set writes the incoming value and nothing
   else. */
Game_Interpreter.prototype.operateVariable = function (variableId, operationType, value) {
  try {
    var oldValue = $gameVariables.value(variableId);
    var combine = StubInterpMZ.arm(StubInterpMZ.variableOps, operationType);
    if (combine) {
      $gameVariables.setValue(variableId, combine(oldValue, value));
    }
  } catch (e) {
    $gameVariables.setValue(variableId, 0);
  }
};

/* rmmz_objects.js:9838. Two parameters are mandatory and three are optional,
   each with its own default — the engine writes that test out three times, one
   index and one fallback apart; StubInterpMZ.optional says it once.

   cancelType is clamped in the DECLARATION's ternary here; MV declares it raw
   and clamps with an if afterwards (rpg_objects.js:9097). Same answer, and -2
   is the engine's "there is no cancel branch" sentinel: an index the choice
   list is too short to hold becomes -2 rather than pointing past the end.

   Note the call order — setChoices, then BACKGROUND, then position — which is
   not the order the three optional parameters sit in. The callback is an arrow
   in the source; a closure over the interpreter is the ES5 way to capture the
   same `this`, and either spelling reads _branch and _indent when the player
   answers, not when the list is built. */
Game_Interpreter.prototype.setupChoices = function (params) {
  var choices = params[0].clone();
  var cancelType = params[1] < choices.length ? params[1] : -2;
  var interpreter = this;
  $gameMessage.setChoices(choices, StubInterpMZ.optional(params, 2, 0), cancelType);
  $gameMessage.setChoiceBackground(StubInterpMZ.optional(params, 4, 0));
  $gameMessage.setChoicePositionType(StubInterpMZ.optional(params, 3, 2));
  $gameMessage.setChoiceCallback(function (n) {
    interpreter._branch[interpreter._indent] = n;
  });
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
   The 401 text-collection loop and the 102/103/104 lookahead behave exactly
   as MV's do; only the shape they are written in differs. */
Game_Interpreter.prototype.command101 = function (params) {
  if ($gameMessage.isBusy()) {
    return false;
  }
  /* The message header, in the engine's order. params[4] is the MZ-ONLY one. */
  $gameMessage.setFaceImage(params[0], params[1]);
  $gameMessage.setBackground(params[2]);
  $gameMessage.setPositionType(params[3]);
  $gameMessage.setSpeakerName(params[4]);
  /* Every 401 row that follows is one more line of this same message, and the
     interpreter walks onto each one to read it. */
  while (this.nextEventCode() === 401) {
    var textRow = StubInterpMZ.step(this);
    $gameMessage.add(textRow[0]);
  }
  /* An input command sitting directly after the text belongs TO the text: it
     is set up now, from here, and never executed as a command of its own — so
     its own command10x method is never the thing that ran. nextEventCode is
     asked once, exactly as the engine's single switch asks it once. */
  var follower = this.nextEventCode();
  if (follower === 102) {          // Show Choices
    this.setupChoices(StubInterpMZ.step(this));
  } else if (follower === 103) {   // Input Number
    this.setupNumInput(StubInterpMZ.step(this));
  } else if (follower === 104) {   // Select Item
    this.setupItemChoice(StubInterpMZ.step(this));
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
  /* 405 is the scrolling-text row code; the loop is otherwise command101's. */
  while (this.nextEventCode() === 405) {
    var textRow = StubInterpMZ.step(this);
    $gameMessage.add(textRow[0]);
  }
  this.setWaitMode('message');
  return true;
};

/* The six variable comparison operators, indexed by the code the editor
   stores in params[4]. */
StubInterpMZ.compare = [
  function (a, b) { return a === b; },   // 0 Equal to
  function (a, b) { return a >= b; },    // 1 Greater than or Equal to
  function (a, b) { return a <= b; },    // 2 Less than or Equal to
  function (a, b) { return a > b; },     // 3 Greater than
  function (a, b) { return a < b; },     // 4 Less than
  function (a, b) { return a !== b; }    // 5 Not Equal to
];

/* Gold's three operator codes are a RENUMBERED SUBSET of those six — 0 is >=,
   1 is <=, 2 is <. The editor offers no "greater than" for gold, which is why
   its codes do not line up with the variable ones, and why a plugin that
   forwards a variable operator code into a Gold condition means something
   else by it. */
StubInterpMZ.goldCompare = [
  StubInterpMZ.compare[1],
  StubInterpMZ.compare[2],
  StubInterpMZ.compare[4]
];

/* The seven Actor sub-conditions, each handed the actor and params[3]. */
StubInterpMZ.actorTests = [
  function (actor, n) { return $gameParty.members().includes(actor); }, // 0 In the Party
  function (actor, n) { return actor.name() === n; },                   // 1 Name
  function (actor, n) { return actor.isClass($dataClasses[n]); },       // 2 Class
  function (actor, n) { return actor.hasSkill(n); },                    // 3 Skill
  function (actor, n) { return actor.hasWeapon($dataWeapons[n]); },     // 4 Weapon
  function (actor, n) { return actor.hasArmor($dataArmors[n]); },       // 5 Armor
  function (actor, n) { return actor.isStateAffected(n); }              // 6 State
];

/* The three Button sub-conditions. This whole table is MZ-ONLY: MV's Button
   arm knows Input.isPressed and nothing else, so a triggered- or repeated-
   flavoured Button branch authored in MZ reads as plain "pressed" there. */
StubInterpMZ.buttonTests = [
  function (name) { return Input.isPressed(name); },   // 0 pressed
  function (name) { return Input.isTriggered(name); }, // 1 triggered
  function (name) { return Input.isRepeated(name); }   // 2 repeated
];

/* Conditional Branch — rmmz_objects.js:9926. One arm per operand code, in the
   editor's own order, each answering the whole condition for its operand.

   Every arm hands back the engine's answer RAW and uncoerced — hasSkill,
   hasItem and friends are not wrapped in !! — because command111 files that
   answer in _branch untouched and command411 tests it against false rather
   than against falsiness. An arm that answers undefined is NOT a false branch.

   An operand code with no arm here, or a sub-code with no entry in the tables
   above, answers false: that is the engine's `let result = false` surviving a
   switch that matched nothing. Operand 12 (Script) is deliberately absent —
   see command111 itself.

   Three arms differ from MV's:
     · 3 (Timer) divides FRAMES by 60 and compares the fraction. MV compares
       the floored $gameTimer.seconds(), so the same "timer >= 5" flips up to
       59 frames earlier here.
     · 4 (Actor), In the Party, uses native .includes. MV uses .contains, its
       own Array.prototype polyfill.
     · 11 (Button) reads params[2]; MV has no such parameter. */
StubInterpMZ.conditions = [];

StubInterpMZ.conditions[0] = function (interpreter, p) {   // Switch
  /* p[2] is 0 for ON and 1 for OFF, so the test is an equality against the
     wanted state rather than a negation. */
  return $gameSwitches.value(p[1]) === (p[2] === 0);
};

StubInterpMZ.conditions[1] = function (interpreter, p) {   // Variable
  var left = $gameVariables.value(p[1]);
  var right = p[2] === 0 ? p[3] : $gameVariables.value(p[3]);
  var op = StubInterpMZ.arm(StubInterpMZ.compare, p[4]);
  return op ? op(left, right) : false;
};

StubInterpMZ.conditions[2] = function (interpreter, p) {   // Self Switch
  /* The interpreter's OWN map and event, captured at setup. A common event
     run from a reservation has no event id and answers false without ever
     touching $gameSelfSwitches. Written as the negation of the engine's
     `> 0` rather than as `<= 0`, so a NaN event id fails both the same way. */
  if (!(interpreter._eventId > 0)) {
    return false;
  }
  var key = [interpreter._mapId, interpreter._eventId, p[1]];
  return $gameSelfSwitches.value(key) === (p[2] === 0);
};

StubInterpMZ.conditions[3] = function (interpreter, p) {   // Timer
  if (!$gameTimer.isWorking()) {
    return false;
  }
  var seconds = $gameTimer.frames() / 60;
  return p[2] === 0 ? seconds >= p[1] : seconds <= p[1];
};

StubInterpMZ.conditions[4] = function (interpreter, p) {   // Actor
  var actor = $gameActors.actor(p[1]);
  var test = StubInterpMZ.arm(StubInterpMZ.actorTests, p[2]);
  return actor && test ? test(actor, p[3]) : false;
};

StubInterpMZ.conditions[5] = function (interpreter, p) {   // Enemy
  /* Indexed into the troop by POSITION, not by enemy id — a troop slot that
     was never filled answers false. */
  var enemy = $gameTroop.members()[p[1]];
  if (!enemy) {
    return false;
  }
  if (p[2] === 0) {                       // Appeared
    return enemy.isAlive();
  }
  if (p[2] === 1) {                       // State
    return enemy.isStateAffected(p[3]);
  }
  return false;
};

StubInterpMZ.conditions[6] = function (interpreter, p) {   // Character
  var character = interpreter.character(p[1]);
  return character ? character.direction() === p[2] : false;
};

StubInterpMZ.conditions[7] = function (interpreter, p) {   // Gold
  var op = StubInterpMZ.arm(StubInterpMZ.goldCompare, p[2]);
  /* gold() is not even read for an operator code the editor cannot write. */
  return op ? op($gameParty.gold(), p[1]) : false;
};

StubInterpMZ.conditions[8] = function (interpreter, p) {   // Item
  /* ONE argument. includeEquip is left undefined, so an item held only in an
     equip slot does not satisfy an Item condition — unlike the Weapon and
     Armor arms below, which forward p[2] as that flag. */
  return $gameParty.hasItem($dataItems[p[1]]);
};

StubInterpMZ.conditions[9] = function (interpreter, p) {   // Weapon
  return $gameParty.hasItem($dataWeapons[p[1]], p[2]);
};

StubInterpMZ.conditions[10] = function (interpreter, p) {  // Armor
  return $gameParty.hasItem($dataArmors[p[1]], p[2]);
};

StubInterpMZ.conditions[11] = function (interpreter, p) {  // Button
  var test = StubInterpMZ.arm(StubInterpMZ.buttonTests, p[2] || 0);
  return test ? test(p[1]) : false;
};

StubInterpMZ.conditions[13] = function (interpreter, p) {  // Vehicle
  return $gamePlayer.vehicle() === $gameMap.vehicle(p[1]);
};

/* The dispatch, and the tail that is the actual contract: the answer is filed
   under the CURRENT indent in the shared _branch map, read straight back out
   of that map the way the engine reads it, and a false answer — false itself,
   not merely a falsy one — skips forward to the matching Else. */
Game_Interpreter.prototype.command111 = function (params) {
  var result;
  if (params[0] === 12) {
    /* Script. Held here rather than in a table arm because this is a DIRECT
       eval: the script sees this method's scope and sees the interpreter as
       `this`. Moving it into an arm would hand it a different scope and a
       different `this`, which is a behaviour and not a formatting choice. */
    result = !!eval(params[1]);
  } else {
    var arm = StubInterpMZ.arm(StubInterpMZ.conditions, params[0]);
    result = arm ? arm(this, params) : false;
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
  /* Read out of params BEFORE the operand is evaluated, exactly as the engine
     does: a Script operand that reaches in and edits its own parameter array
     cannot move the range it is already writing to. */
  var startId = params[0];
  var endId = params[1];
  var operationType = params[2];
  var operand = params[3];
  var value = 0;
  /* The width of the roll added to every write below. Only Random widens it;
     for the other four operands it stays 1, and Math.randomInt(1) is always 0.
     That is the whole trick by which MZ puts ONE loop under all five operands
     where MV needs a private loop and an early return for Random alone. */
  var spread = 1;
  if (operand === 0) {          // Constant
    value = params[4];
  } else if (operand === 1) {   // Variable
    value = $gameVariables.value(params[4]);
  } else if (operand === 2) {   // Random
    value = params[4];
    /* Inclusive on both ends, and floored at 1 so a reversed range still
       rolls a legal width rather than asking randomInt for a negative one. */
    spread = Math.max(params[5] - params[4] + 1, 1);
  } else if (operand === 3) {   // Game Data
    value = this.gameDataOperand(params[4], params[5], params[6]);
  } else if (operand === 4) {   // Script
    /* Direct eval, so the script sees this interpreter as `this`. It is also
       why the typeof guard below has to exist: a script may hand back a
       string or an object, and only a number may take the roll. MV, whose
       shared loop never sees a Script result, needs no such guard. */
    value = eval(params[4]);
  }
  for (var id = startId; id <= endId; id++) {
    /* One FRESH roll per variable in the range, not one roll for the range —
       "set variables 1..3 to a random 1..6" gives three independent dice. A
       non-number is written straight through, roll and all skipped. */
    var written = typeof value === 'number' ? value + Math.randomInt(spread) : value;
    this.operateVariable(id, operationType, written);
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
  /* params[0] says how the three destination numbers are spelled: 0 means
     they are the values themselves, anything else means they are VARIABLE IDS
     to read through. The engine writes the same three-way choice out twice,
     once per branch; one reader says it once, and reads the variables in
     params order — map, x, y — which is the order the engine reads them in
     too, and the order anything watching $gameVariables will see. */
  var throughVariables = params[0] !== 0;
  function destination(index) {
    return throughVariables ? $gameVariables.value(params[index]) : params[index];
  }
  /* Five arguments, and the last two — fade type and the direction to face on
     arrival — are passed straight through on both engines. */
  $gamePlayer.reserveTransfer(destination(1), destination(2), destination(3), params[4], params[5]);
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
      goods.push(StubInterpMZ.step(this));
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
  var event = this;
  /* Six rows, each answering "this row does not BLOCK the page". A row whose
     *Valid flag is off never blocks and never reads the id beside it, so a
     page carrying a stale actorId is harmless while actorValid is false. The
     rows are walked in the engine's order and the first one that blocks ends
     the method — nothing after it is asked. */
  var rows = [
    function () {
      return !c.switch1Valid || !!$gameSwitches.value(c.switch1Id);
    },
    function () {
      return !c.switch2Valid || !!$gameSwitches.value(c.switch2Id);
    },
    function () {
      /* Written as the negation of the engine's `<` rather than as `>=`, so a
         variable holding NaN passes here exactly as it does there: the page
         asks for AT LEAST the value, and only a value it can prove is smaller
         blocks it. */
      return !c.variableValid || !($gameVariables.value(c.variableId) < c.variableValue);
    },
    function () {
      /* Compared against true itself, not against truthiness — the engine's
         own accessor is what coerces, and a raw store of 1 or "A" that the
         accessor reports as on is on here too. The key is built from the
         event's OWN _mapId, not $gameMap.mapId(): an event whose data came
         from another map addresses that map's self switches. */
      if (!c.selfSwitchValid) {
        return true;
      }
      var key = [event._mapId, event._eventId, c.selfSwitchCh];
      return $gameSelfSwitches.value(key) === true;
    },
    function () {
      return !c.itemValid || !!$gameParty.hasItem($dataItems[c.itemId]);
    },
    function () {
      /* .includes here; MV's identical line reads .contains, its own
         Array.prototype polyfill, which MZ does not ship at all. */
      return !c.actorValid || $gameParty.members().includes($gameActors.actor(c.actorId));
    }
  ];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i]()) {
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
   signature; core.js's Game_Event takes (id, name, x, y). Modelled anyway,
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
