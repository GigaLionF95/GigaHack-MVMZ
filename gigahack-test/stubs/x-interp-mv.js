/* =============================================================================
   GigaHack test harness — stubs/x-interp-mv.js
   The MV 1.6.1 half of the INTERPRETER AND EVENTS surface.
   Modelled on rpg_objects.js / rpg_managers.js / rpg_core.js (MV 1.6.1). Every
   body carries the file:line whose BEHAVIOUR it reproduces; the wording is
   this harness's own, and where the engine's shape is itself the fact worth
   knowing the comment says so in prose instead.

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
   DEPENDENCY FILLS — MV spellings. Same rule as in x-interp.js: read off the
   engine, placed early enough that a later file modelling the owning class
   properly wins.
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
   falsy. Same answer, different body — modelled separately on each side
   because a mod that shadows hasItem has a different signature to preserve.
   command111's Item/Weapon/Armor arms and meetsConditions' itemValid clause
   are the callers. isAnyMemberEquipped is the party area's; it is only reached
   when includeEquip is true, so it is left to throw if a check goes there. */
Game_Party.prototype.hasItem = function (item, includeEquip) {
  /* MV's normalising line, kept because it is the difference: after it,
     includeEquip is a real boolean and the `&&` below cannot see undefined. */
  if (includeEquip === undefined) {
    includeEquip = false;
  }
  if (this.numItems(item) > 0) {
    return true;
  }
  /* The `!!` is not decoration: the engine's arms return the LITERALS true and
     false, so a shadowed isAnyMemberEquipped answering a truthy object must
     still make this answer true rather than the object. */
  return !!(includeEquip && this.isAnyMemberEquipped(item));
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

/* rpg_objects.js:8871. TEN wait modes and exactly one probe each, which is why
   they are written here as a table: the engine's switch has no fall-through, no
   shared arm and no default, so the mode string is nothing but a key.

   The four differences from MZ's are all in this table. 'route', 'animation'
   and 'balloon' read this._character DIRECTLY — MZ calls
   this.character(this._characterId) first and can therefore get null, where MV
   dereferences a stale object; and 'video' asks Graphics.isVideoPlaying where
   MZ asks Video.isPlaying.

   A mode the table does not name is not waiting — that includes '' — and the
   clearing of _waitMode when nothing is waiting is unconditional on both. */
Game_Interpreter.prototype.updateWaitMode = (function () {
  var probes = {
    message: function () { return $gameMessage.isBusy(); },
    transfer: function () { return $gamePlayer.isTransferring(); },
    scroll: function () { return $gameMap.isScrolling(); },
    route: function () { return this._character.isMoveRouteForcing(); },
    animation: function () { return this._character.isAnimationPlaying(); },
    balloon: function () { return this._character.isBalloonPlaying(); },
    gather: function () { return $gamePlayer.areFollowersGathering(); },
    action: function () { return BattleManager.isActionForced(); },
    video: function () { return Graphics.isVideoPlaying(); },
    image: function () { return !ImageManager.isReady(); }
  };
  var owns = Object.prototype.hasOwnProperty;

  return function () {
    /* hasOwnProperty and not a bare lookup: a `switch` matches those ten
       literal strings and nothing else, so a _waitMode of 'toString' or
       'constructor' has to miss rather than find Object.prototype's. */
    var probe = owns.call(probes, this._waitMode) ? probes[this._waitMode] : null;
    /* The probe's answer is passed through UNCHANGED, truthiness and all: the
       engine assigns it to `waiting` and returns that, so a probe returning 0
       returns 0 from here too. */
    var waiting = probe ? probe.call(this) : false;
    if (!waiting) {
      this._waitMode = '';
    }
    return waiting;
  };
}());

/* rpg_objects.js:8923. The real dispatcher is this small on both engines; the
   giant per-command switch a plugin author expects does not exist, the method
   name is built from the code. Three MV-specific facts: this._params is
   assigned here (MZ has no such field), the handler is called with NO
   arguments, and _index++ happens only when the handler returned truthy — a
   handler returning false leaves _index where it was, which is how command101
   and command201 re-run themselves on the next frame.

   Two answers that are easy to get backwards, and are written as separate
   exits here so they cannot be: running off the end of the list terminates and
   still answers TRUE, and a command code with no command<code> method is not an
   error at all — it is skipped and the index advances over it. */
Game_Interpreter.prototype.executeCommand = function () {
  var command = this.currentCommand();
  if (!command) {
    this.terminate();
    return true;
  }
  this._params = command.parameters;
  this._indent = command.indent;
  var handler = this['command' + command.code];
  if (typeof handler === 'function' && !handler.call(this)) {
    return false;
  }
  this._index++;
  return true;
};

/* rpg_objects.js:9543. Six operations, and every one of them is
   "old op new" — so they are written here as the six binary functions they
   are, indexed by operationType in the editor's own order.

   The awkward bit in the engine is operation 0, which spells its arm
   `$gameVariables.setValue(variableId, oldValue = value)`: an assignment INSIDE
   the argument list whose only effect is to clobber a local that nothing reads
   again, because that arm has already chosen its value. MZ cleaned it to a
   plain `value`. Set is Set on both engines and the table says so directly.

   Three behaviours the table has to keep exactly. The old value is read BEFORE
   the operation is chosen, so a value() that throws lands in the catch whatever
   the operation was. An operationType outside 0..5 writes NOTHING — the engine
   falls off the end of its switch and never calls setValue. And the whole thing
   is wrapped in a try/catch that writes a flat 0 on any failure, which is why a
   divide by a non-number silently zeroes the variable instead of throwing. */
Game_Interpreter.prototype.operateVariable = (function () {
  var combine = [
    function (old, operand) { return operand; },        // 0  Set
    function (old, operand) { return old + operand; },  // 1  Add
    function (old, operand) { return old - operand; },  // 2  Sub
    function (old, operand) { return old * operand; },  // 3  Mul
    function (old, operand) { return old / operand; },  // 4  Div
    function (old, operand) { return old % operand; }   // 5  Mod
  ];

  return function (variableId, operationType, value) {
    try {
      var current = $gameVariables.value(variableId);
      /* typeof, because a `switch` matches with === : the STRING '1' picks no
         arm in the engine and must pick no row here either. */
      var op = typeof operationType === 'number' ? combine[operationType] : null;
      if (op) {
        $gameVariables.setValue(variableId, op(current, value));
      }
    } catch (e) {
      $gameVariables.setValue(variableId, 0);
    }
  };
}());

/* rpg_objects.js:9097. Only params[0] and params[1] are guaranteed: a choice
   command written by an older editor simply stops early, so each tail parameter
   carries its own default and the test is on params.length, never on
   undefined-ness. The defaults are 0 / 2 / 0 and they are the editor's, not a
   convenience.

   MV clamps cancelType AFTER reading it, with an if; MZ folds the same test
   into the declaration's ternary. Same answer either way, and -2 is what the
   message window reads as "cancel takes the branch".

   The callback fires long after this method returns and has to reach the
   interpreter it was made for; MV binds, MZ uses an arrow, and this closes over
   a named local, which is the one spelling ES5 gives us. What matters is that
   _indent is read WHEN THE PLAYER CHOOSES, not now. */
Game_Interpreter.prototype.setupChoices = function (params) {
  function tail(index, fallback) {
    return params.length > index ? params[index] : fallback;
  }

  var choices = params[0].clone();
  var cancelType = params[1];
  var defaultType = tail(2, 0);
  var positionType = tail(3, 2);
  var background = tail(4, 0);

  if (cancelType >= choices.length) {
    cancelType = -2;
  }

  var interpreter = this;
  $gameMessage.setChoices(choices, defaultType, cancelType);
  $gameMessage.setChoiceBackground(background);
  $gameMessage.setChoicePositionType(positionType);
  $gameMessage.setChoiceCallback(function (n) {
    interpreter._branch[interpreter._indent] = n;
  });
};

/* --- The commands. Every one reads this._params. ---------------------- */

/* Show Text — rpg_objects.js:9058. Returns FALSE on every path, so
   executeCommand does not advance _index and the command re-enters next frame
   until $gameMessage stops being busy. MV has FOUR setFaceImage-family params
   and no speaker name; MZ added $gameMessage.setSpeakerName(params[4]) and
   restructured the whole body into an early `if (busy) return false;` that
   ends `return true` — so MZ ADVANCES the index itself and MV does not. The
   `this._index++` before setWaitMode is MV-only for exactly that reason, and it
   is the one at the END of the body, past the swallowed rows.

   The rest is a swallow: a Show Text command eats the 401 rows that follow it,
   and then at most ONE input row (102/103/104), and each swallowed row costs an
   _index++ so executeCommand never dispatches it as a command of its own. Any
   OTHER code after the 401s is left where it is and dispatched normally. */
Game_Interpreter.prototype.command101 = function () {
  if ($gameMessage.isBusy()) {
    return false;
  }

  var p = this._params;
  $gameMessage.setFaceImage(p[0], p[1]);
  $gameMessage.setBackground(p[2]);
  $gameMessage.setPositionType(p[3]);

  while (this.nextEventCode() === 401) {  // Text data
    this._index++;
    $gameMessage.add(this.currentCommand().parameters[0]);
  }

  var following = this.nextEventCode();
  if (following === 102 || following === 103 || following === 104) {
    this._index++;
    var row = this.currentCommand().parameters;
    if (following === 102) {
      this.setupChoices(row);        // Show Choices
    } else if (following === 103) {
      this.setupNumInput(row);       // Input Number
    } else {
      this.setupItemChoice(row);     // Select Item
    }
  }

  this._index++;
  this.setWaitMode('message');
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

   The engine is one 130-line switch with three nested switches inside it. Every
   arm does the same two things — pick a test, answer it — and none of them
   falls through, so they are written here as a table of testers indexed by
   params[0], with the sub-switches as tables of their own. Each tester is
   called with the interpreter as `this`, which is what the Script arm's eval
   and the Character arm's this.character() need.

   THE FALSE THAT IS NOT A TEST. The engine seeds `result = false` and every arm
   only ASSIGNS it, so anything that does not reach an assignment answers false:
   an operand code the editor never wrote, a self switch on an interpreter with
   no event, a timer that is not running, an actor id with no actor, a troop
   index with no enemy, a character() that answered null, a sub-code out of
   range. Each tester below reproduces that by returning false itself; the
   dispatcher answers false for an operand with no tester at all.

   What an arm DOES answer is passed through untouched — `result` is whatever
   the engine assigned, and a test method returning undefined files undefined,
   which is NOT false and therefore does not skip the branch.

   Two arms differ from MZ:
     · operand 3 (Timer) asks $gameTimer.seconds(), an INTEGER — so "timer >= 5"
       is true from 5.0s. MZ computes $gameTimer.frames() / 60 and compares the
       fraction, so the same branch flips up to 59 frames later.
     · operand 4 (Actor), "In the Party", uses $gameParty.members().contains().
       MZ uses .includes. Identical semantics; different method, and .contains
       exists only because MV polyfills it onto Array.prototype.
   MV's operand 11 (Button) has ONE form, Input.isPressed; MZ added a params[2]
   switch for triggered/repeated. Left as MV has it.

   The tail is the load-bearing part and is identical on both: the result is
   filed under this._indent in the shared _branch map, and a false result skips
   forward to the matching indent. _branch is keyed by INDENT, not by index, so
   two branches at the same depth share a slot. */
Game_Interpreter.prototype.command111 = (function () {
  /* A `switch` matches with ===, so a table standing in for one has to refuse
     a key a bare index would happily coerce and find — the STRING '3' picks no
     case in the engine and must pick no row here. */
  function pick(table, code) {
    return typeof code === 'number' ? table[code] : undefined;
  }

  /* The six comparisons an operand can end in, in the editor's order:
     ==, >=, <=, >, <, !=. Read off params[4] for a Variable branch. */
  var compare = [
    function (a, b) { return a === b; },
    function (a, b) { return a >= b; },
    function (a, b) { return a <= b; },
    function (a, b) { return a > b; },
    function (a, b) { return a < b; },
    function (a, b) { return a !== b; }
  ];

  /* Gold offers only three of them, and NOT the same three: >=, <=, <. */
  var goldCompare = [compare[1], compare[2], compare[4]];

  /* The seven things a branch can ask about an actor, off params[2], with
     params[3] as the thing asked about. */
  var actorTests = [
    function (actor, n) { return $gameParty.members().contains(actor); },
    function (actor, n) { return actor.name() === n; },
    function (actor, n) { return actor.isClass($dataClasses[n]); },
    function (actor, n) { return actor.hasSkill(n); },
    function (actor, n) { return actor.hasWeapon($dataWeapons[n]); },
    function (actor, n) { return actor.hasArmor($dataArmors[n]); },
    function (actor, n) { return actor.isStateAffected(n); }
  ];

  /* And the two it can ask about an enemy. */
  var enemyTests = [
    function (enemy, n) { return enemy.isAlive(); },
    function (enemy, n) { return enemy.isStateAffected(n); }
  ];

  var operand = [];

  /* 0 — Switch. params[2] is 0 for ON and 1 for OFF, so the test is not "is it
     on" but "does it agree with what was asked". */
  operand[0] = function (p) {
    return $gameSwitches.value(p[1]) === (p[2] === 0);
  };

  /* 1 — Variable, against a constant (params[2] === 0) or another variable. */
  operand[1] = function (p) {
    var left = $gameVariables.value(p[1]);
    var right = p[2] === 0 ? p[3] : $gameVariables.value(p[3]);
    var how = pick(compare, p[4]);
    return how ? how(left, right) : false;
  };

  /* 2 — Self switch, keyed by the interpreter's OWN captured map and event ids.
     An interpreter with no event (a reserved common event) cannot key one and
     answers false without touching $gameSelfSwitches at all. */
  operand[2] = function (p) {
    if (this._eventId > 0) {
      var key = [this._mapId, this._eventId, p[1]];
      return $gameSelfSwitches.value(key) === (p[2] === 0);
    }
    return false;
  };

  /* 3 — Timer, and only while it is running. */
  operand[3] = function (p) {
    if ($gameTimer.isWorking()) {
      var how = p[2] === 0 ? compare[1] : compare[2];
      return how($gameTimer.seconds(), p[1]);
    }
    return false;
  };

  /* 4 — Actor. Both the actor and the sub-test have to exist. */
  operand[4] = function (p) {
    var actor = $gameActors.actor(p[1]);
    var test = pick(actorTests, p[2]);
    return actor && test ? test(actor, p[3]) : false;
  };

  /* 5 — Enemy, addressed by INDEX into the live troop rather than by id, so
     params[1] means something different here than everywhere else. */
  operand[5] = function (p) {
    var enemy = $gameTroop.members()[p[1]];
    var test = pick(enemyTests, p[2]);
    return enemy && test ? test(enemy, p[3]) : false;
  };

  /* 6 — Character facing. character() answers null in battle and for an
     interpreter that has been transferred off its own map. */
  operand[6] = function (p) {
    var character = this.character(p[1]);
    return character ? character.direction() === p[2] : false;
  };

  /* 7 — Gold. $gameParty.gold() is asked only once a comparison is found. */
  operand[7] = function (p) {
    var how = pick(goldCompare, p[2]);
    return how ? how($gameParty.gold(), p[1]) : false;
  };

  /* 8/9/10 — the party's stock. Only the two equipment kinds pass MV's second
     `includeEquip` argument; Item passes one and lets hasItem default it. */
  operand[8] = function (p) {
    return $gameParty.hasItem($dataItems[p[1]]);
  };
  operand[9] = function (p) {
    return $gameParty.hasItem($dataWeapons[p[1]], p[2]);
  };
  operand[10] = function (p) {
    return $gameParty.hasItem($dataArmors[p[1]], p[2]);
  };

  /* 11 — Button, held right now. */
  operand[11] = function (p) {
    return Input.isPressed(p[1]);
  };

  /* 12 — Script. The `!!` is what files a BOOLEAN rather than the script's own
     answer, and the eval is direct so `this` is the interpreter, which is what
     a conditional-branch script written against the engine expects. */
  operand[12] = function (p) {
    return !!eval(p[1]);
  };

  /* 13 — Vehicle, by identity of the vehicle object, not by id. */
  operand[13] = function (p) {
    return $gamePlayer.vehicle() === $gameMap.vehicle(p[1]);
  };

  return function () {
    var p = this._params;
    var test = pick(operand, p[0]);
    var result = test ? test.call(this, p) : false;
    this._branch[this._indent] = result;
    if (this._branch[this._indent] === false) {
      this.skipBranch();
    }
    return true;
  };
}());

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

   The MV/MZ split is in the RANDOM operand, and it is structural. MV gives it
   a loop of its OWN and RETURNS EARLY — two loops in one method, and nothing
   but the Random operand ever touches randomness. MZ deleted
   that early return: it carries a separate `randomMax` (1 for every other
   operand) and funnels ALL five operands through one loop that adds
   Math.randomInt(randomMax) — zero unless the operand was Random. Because that
   one loop now sees Script results too, MZ had to add a
   `typeof value === "number"` test around the addition; MV needs no such test
   precisely because its Random case never reaches the shared loop.

   The engine's case 2 carries a `break` after its `return true` — unreachable,
   and in the source. There is nothing to keep: it never ran.

   ONE ROLL PER TARGET is the part worth being careful about. Random rolls
   inside its loop, so "set variables 1..5 to a random 1..6" gives five
   independent numbers; every other operand computes ONE value before its loop
   and writes that same value to every target. An operand code the editor never
   wrote writes 0 to the whole range rather than skipping it.

   gameDataOperand (operand 3) is NOT defined here: it reaches actors, enemies,
   characters, party and system counters across four other areas. Operand 3
   therefore throws rather than quietly returning 0. */
Game_Interpreter.prototype.command122 = function () {
  var p = this._params;
  var id;

  /* Random: rolled again for every variable in the range. The span is
     inclusive of both ends, which is where the + 1 comes from. */
  if (p[3] === 2) {
    var floor = p[4];
    var span = p[5] - floor + 1;
    for (id = p[0]; id <= p[1]; id++) {
      this.operateVariable(id, p[2], floor + Math.randomInt(span));
    }
    return true;
  }

  /* Everything else: one value, computed once, written to every target.
     `eval` stays in this method body rather than a helper so a Script operand
     sees the interpreter as `this`, the way the engine's does. */
  var value = 0;
  if (p[3] === 0) {                                    // Constant
    value = p[4];
  } else if (p[3] === 1) {                             // Variable
    value = $gameVariables.value(p[4]);
  } else if (p[3] === 3) {                             // Game Data
    value = this.gameDataOperand(p[4], p[5], p[6]);
  } else if (p[3] === 4) {                             // Script
    value = eval(p[4]);
  }
  for (id = p[0]; id <= p[1]; id++) {
    this.operateVariable(id, p[2], value);
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

/* Transfer Player — rpg_objects.js:9709. The RETURN VALUE is the MV/MZ split
   and it is the reason the single `return false` at the bottom is left standing
   rather than folded into an early exit: MV answers false whether it transferred
   or not, and advances _index by hand inside the guard, so a transfer attempted
   during a message re-runs next frame and a transfer that happened does not.
   MZ answers TRUE on the transferring path and lets executeCommand advance.

   params[0] chooses how the next three parameters are read — 0 means they ARE
   the destination, anything else means they are the ids of variables holding
   it — and it applies to all three together, which is why one flag drives all
   three reads. The five-argument reserveTransfer order is
   (mapId, x, y, direction, fadeType) on both engines. */
Game_Interpreter.prototype.command201 = function () {
  var p = this._params;
  var indirect = p[0] !== 0;

  function place(index) {
    return indirect ? $gameVariables.value(p[index]) : p[index];
  }

  if (!$gameParty.inBattle() && !$gameMessage.isBusy()) {
    $gamePlayer.reserveTransfer(place(1), place(2), place(3), p[4], p[5]);
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

   Six independent gates, each with its own *Valid flag, and the engine nests
   the flag test and the gate test as two ifs; && is the same thing and short
   circuits the same way, so a gate that is switched off never reads the world
   it would have asked about. The FIRST failure answers, and nothing after it
   is evaluated.

   Two exactnesses worth keeping: variableValid is `< c.variableValue` → false,
   i.e. the page needs variable >= value; and selfSwitchValid compares
   `!== true`, not falsiness, so a self switch holding a truthy non-true value
   fails the page. The key is [this._mapId, this._eventId, ch] — the event's
   OWN stored map id, not $gameMap.mapId().

   The two temporaries the engine keeps are kept here too, for order rather
   than for reading: $gameActors.actor() LAZILY CREATES the actor it is asked
   for, so it has to run before $gameParty.members() and not as an argument
   evaluated after it. */
Game_Event.prototype.meetsConditions = function (page) {
  var c = page.conditions;

  if (c.switch1Valid && !$gameSwitches.value(c.switch1Id)) {
    return false;
  }
  if (c.switch2Valid && !$gameSwitches.value(c.switch2Id)) {
    return false;
  }
  if (c.variableValid && $gameVariables.value(c.variableId) < c.variableValue) {
    return false;
  }
  if (c.selfSwitchValid) {
    var selfKey = [this._mapId, this._eventId, c.selfSwitchCh];
    if ($gameSelfSwitches.value(selfKey) !== true) {
      return false;
    }
  }
  if (c.itemValid && !$gameParty.hasItem($dataItems[c.itemId])) {
    return false;
  }
  if (c.actorValid) {
    var wanted = $gameActors.actor(c.actorId);
    if (!$gameParty.members().contains(wanted)) {
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
