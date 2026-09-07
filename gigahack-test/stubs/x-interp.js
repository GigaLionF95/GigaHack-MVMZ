/* =============================================================================
   GigaHack test harness — stubs/x-interp.js
   The INTERPRETER AND EVENTS surface that MV 1.6.1 and MZ 1.9.0 agree on.

   Loaded immediately after core.js, before engine-*.js. Everything here is
   written from the shipped engine source and carries the file:line whose
   behaviour it reproduces; where a body is reduced, the comment says what was
   dropped and why.

   Line references: MV = rpg_objects.js unless the citation names another file,
   MZ = rmmz_objects.js likewise. A single "MV :nnnn / MZ :nnnn" pair means the
   ENGINE'S OWN two bodies agree token for token apart from var/let/const and
   the arrow-vs-function spelling, which ES5 forces anyway — that is the claim
   the pair is making, and it is why one stub can stand in for both.

   WHAT IS NOT HERE, ON PURPOSE. Four things a naive reading calls "the same on
   both engines" are not, and each one lives in x-interp-mv.js / x-interp-mz.js
   instead:
     · executeCommand — MV sets this._params and calls command<code>() with no
       arguments; MZ never has a _params field and passes command.parameters as
       the argument. EVERY command body therefore differs, so every command
       body is in an engine file, not this one.
     · Game_Interpreter.clear — MV keeps this._character, MZ keeps
       this._characterId and re-resolves through character() each frame.
     · Game_Interpreter.setup — MV calls the static Game_Interpreter.requestImages,
       MZ the instance method loadImages, and they walk different code sets.
     · setupReservedCommonEvent — MV's Game_Temp holds ONE id, MZ's a queue.
   docs/MV-MZ-DELTA.md §C.20 currently records Game_Interpreter as "checked,
   materially compatible". That is true of the event-command CODES it lists; it
   is not true of the interpreter's own field names, which is what a panel
   reading this class sees.
   ========================================================================== */

/* -------------------------------------------------------------------------
   DEPENDENCY FILLS.

   The interpreter reaches out of its own class on nearly every path, and
   core.js does not model all of it. These are read off the engine like
   everything else. They are in THIS file, the earliest of the three, so that
   any later stub file that models the owning class properly simply overrides
   them — last assignment wins, and the better model is always the later one.
   ---------------------------------------------------------------------- */
/* MV rpg_core.js:151 / MZ rmmz_core.js:99. command122's Random operand is the
   only caller here, and it is the reason a "set variable" check has to seed or
   bound its expectation rather than assert an exact number. */
Math.randomInt = function (max) {
  return Math.floor(max * Math.random());
};

/* MV rpg_managers.js:901 / MZ rmmz_managers.js:988. SHAPE ONLY: the real body
   walks ImageManager._imageCache and asks every cached Bitmap whether it is
   ready, which needs the whole cache the asset area owns. Reduced to the value
   a harness with no pending loads would return, because the only caller here is
   updateWaitMode's 'image' arm — `waiting = !ImageManager.isReady()`. */
ImageManager.isReady = function () { return true; };

/* MV rpg_objects.js:462 / MZ rmmz_objects.js:617 — identical. command105 is
   the only caller. _scrollMode is what makes a scrolling-text window behave
   unlike a message window, so it is set here rather than folded away. */
Game_Message.prototype.setScroll = function (speed, noFast) {
  this._scrollMode = true;
  this._scrollSpeed = speed;
  this._scrollNoFast = noFast;
};
/* The two setupChoices reaches that core.js's Game_Message does not carry.
   MV rpg_objects.js:444/:448 / MZ rmmz_objects.js:599/:603. */
Game_Message.prototype.setChoiceBackground = function (background) {
  this._choiceBackground = background;
};
Game_Message.prototype.setChoicePositionType = function (positionType) {
  this._choicePositionType = positionType;
};

/* updateWaitMode's 'transfer' and 'scroll' arms. MV :7464 / MZ :8161 and
   MV :6015 / MZ :6698. NOTE core.js's Game_Player.reserveTransfer is a
   harness recorder that swaps $gameMap.mapId for a closure and never sets
   _transferring, so a command201 followed by a wait resolves IMMEDIATELY here
   where the engine would hold for a frame. That is a deviation core.js owns;
   it is named here because isOnCurrentMap() reads the same mapId() it moves. */
Game_Player.prototype.isTransferring = function () {
  return this._transferring;
};
Game_Map.prototype.isScrolling = function () {
  return this._scrollRest > 0;
};
/* updateWaitMode's 'gather' arm. MV :8002 / MZ :8710, and the flag it reads,
   MV :8161 / MZ :8875. core.js's Game_Player builds _followers lazily inside
   followers(), so this reads undefined until something has asked once — which
   is the engine's own hazard shape, not a stub artefact. */
Game_Player.prototype.areFollowersGathering = function () {
  return this._followers.areGathering();
};
Game_Followers.prototype.areGathering = function () {
  return this._gathering;
};

/* command302's destination. core.js models Scene_Battle and Scene_Map the same
   way and this follows it. Scene_Shop descends from
   Scene_MenuBase in both engines; core.js has no Scene_MenuBase, so Scene_Base
   stands in and the difference is confined to a chain nothing here walks. */
function Scene_Shop() { }
Scene_Shop.prototype = Object.create(Scene_Base.prototype);
Scene_Shop.prototype.constructor = Scene_Shop;
/* MV rpg_managers.js:2109 / MZ rmmz_managers.js:2243. The real body is
   `this._nextScene.prepare.apply(this._nextScene, arguments)` — MZ spells it
   with a spread, MV with apply, same effect. It cannot be reproduced exactly where it is interface
   because core.js's SceneManager.push is a RECORDER: it appends a class
   name to window.__pushed and never constructs _nextScene. So this records in
   the same register core.js chose, and a check reads __preparedScene next to
   __pushed. If SceneManager ever grows a real _nextScene, delete this. */
SceneManager.prepareNextScene = function () {
  window.__preparedScene = Array.prototype.slice.call(arguments);
};

/* MV rpg_managers.js:42 / MZ rmmz_managers.js:42 — both engines declare a
   module-scope $testEvent (MV with `var`, MZ bare), and Game_Map.setupTestEvent
   both reads and clears it. Declared here so that method has a real target; MV
   reads the bare identifier and MZ reads window.$testEvent, which is the one
   difference between their two bodies (see the engine files). */
window.$testEvent = null;

/* -------------------------------------------------------------------------
   Game_Interpreter — the shared half.

   MV rpg_objects.js:8767 / MZ rmmz_objects.js:9484. The engine constructor is
   `this.initialize.apply(this, arguments)` on MV and `this.initialize(...arguments)`
   on MZ; ES5 gives us the MV spelling and the two are equivalent. initialize
   itself is NOT here — MV's sets this._params = [] and MZ's does not.
   ---------------------------------------------------------------------- */
function Game_Interpreter() {
  this.initialize.apply(this, arguments);
}

/* MV :8782 / MZ :9498. The depth limit is what stops a common event that calls
   itself; it throws rather than returning false, so a check that drives 100
   nested setupChild calls gets an exception, not a quiet stop. */
Game_Interpreter.prototype.checkOverflow = function () {
  if (this._depth >= 100) {
    throw new Error('Common event calls exceeded the limit');
  }
};

/* MV :8808 / MZ :9540 */
Game_Interpreter.prototype.eventId = function () {
  return this._eventId;
};

/* MV :8812 / MZ :9544. Compares the map id CAPTURED AT SETUP against the map
   id now, which is how a running interpreter learns it has been transferred
   out from under itself. command117 uses the answer to decide whether a child
   common event inherits the parent's event id or 0. */
Game_Interpreter.prototype.isOnCurrentMap = function () {
  return this._mapId === $gameMap.mapId();
};

/* MV :8826 / MZ :9559. The list, not a flag: terminate() nulls _list and that
   is the only thing that stops an interpreter. */
Game_Interpreter.prototype.isRunning = function () {
  return !!this._list;
};

/* MV :8830 / MZ :9563 — byte-identical, and the loop is the whole design.
   update() runs commands until something breaks it: a child interpreter, a
   wait, a pending scene change, a command that returns false, or the freeze
   checker. One call is not one command; it is as many commands as the list
   will give up in one frame. A stub that stepped once per update would make
   every wait test pass for the wrong reason. */
Game_Interpreter.prototype.update = function () {
  while (this.isRunning()) {
    /* Three ways to be held BEFORE a command runs, asked in this order and
       short-circuiting: a live child, a wait, a scene on its way out. */
    var held = this.updateChild() || this.updateWait() || SceneManager.isSceneChanging();
    /* ...and two ways for the command itself to end the frame: it asked to
       stop, or it was the hundred-thousandth one this frame. */
    if (held || !this.executeCommand() || this.checkFreeze()) {
      return;
    }
  }
};

/* MV :8847 / MZ :9580. The child is dropped the frame AFTER it stops, not the
   frame it stops, because the null-out happens on the next visit. */
Game_Interpreter.prototype.updateChild = function () {
  if (this._childInterpreter) {
    this._childInterpreter.update();
    if (this._childInterpreter.isRunning()) {
      return true;
    } else {
      this._childInterpreter = null;
    }
  }
  return false;
};

/* MV :8859 / MZ :9592 */
Game_Interpreter.prototype.updateWait = function () {
  return this.updateWaitCount() || this.updateWaitMode();
};

/* MV :8863 / MZ :9596. Decrements FIRST and returns true, so command230's
   wait(n) costs n+1 visits, not n. */
Game_Interpreter.prototype.updateWaitCount = function () {
  if (this._waitCount > 0) {
    this._waitCount--;
    return true;
  }
  return false;
};

/* MV :8911 / MZ :9648 */
Game_Interpreter.prototype.setWaitMode = function (waitMode) {
  this._waitMode = waitMode;
};

/* MV :8915 / MZ :9652 */
Game_Interpreter.prototype.wait = function (duration) {
  this._waitCount = duration;
};

/* MV :8919 / MZ :9656 */
Game_Interpreter.prototype.fadeSpeed = function () {
  return 24;
};

/* MV :8941 / MZ :9677. The freeze checker is keyed on Graphics.frameCount, so
   a harness that never advances frameCount lets 100000 commands run inside one
   update() and then reports a freeze. core.js keeps frameCount writable for
   exactly this kind of reason; a check that drives a long list must bump it. */
Game_Interpreter.prototype.checkFreeze = function () {
  var thisFrame = Graphics.frameCount;
  if (this._frameCount !== thisFrame) {
    this._frameCount = thisFrame;
    this._freezeChecker = 0;
  }
  /* POST-increment: the counter is read, THEN raised, so the 100001st command
     of a frame is the first one to be refused. The engine spells the same
     answer as an if/else pair of literals. */
  return this._freezeChecker++ >= 100000;
};

/* MV :8953 / MZ :9689. Nulls the list and clears the comment buffer and
   NOTHING ELSE — _mapId, _eventId and _index all survive termination, which is
   why Game_Map.updateInterpreter has to call clear() separately after reading
   eventId(). */
Game_Interpreter.prototype.terminate = function () {
  this._list = null;
  this._comments = '';
};

/* MV :8958 / MZ :9694. Reads _list[_index + 1] with no bounds test: a list
   whose final {code:0} terminator has been stripped runs off the end and
   throws here. That is the engine's real behaviour and the reason the mod's
   forge insists on the terminator. */
Game_Interpreter.prototype.skipBranch = function () {
  while (this._list[this._index + 1].indent > this._indent) {
    this._index++;
  }
};

/* MV :8964 / MZ :9700 */
Game_Interpreter.prototype.currentCommand = function () {
  return this._list[this._index];
};

/* MV :8968 / MZ :9704 */
Game_Interpreter.prototype.nextEventCode = function () {
  var command = this._list[this._index + 1];
  if (command) {
    return command.code;
  } else {
    return 0;
  }
};

/* MV :9377 / MZ :10133. The child gets depth + 1, which is what checkOverflow
   counts. Note it is created with `new Game_Interpreter(...)` — a mod that
   replaces Game_Interpreter after boot does not affect children already made. */
Game_Interpreter.prototype.setupChild = function (list, eventId) {
  this._childInterpreter = new Game_Interpreter(this._depth + 1);
  this._childInterpreter.setup(list, eventId);
};

/* MV :9028 / MZ :9764 — identical. Four answers, tested in this order, and the
   two nulls are not the same null: the first is "there are no map characters
   at all right now", the second is "this interpreter is no longer standing on
   the map it captured". Written as separate exits so they can carry separate
   reasons. A negative param is the player whichever map that is; 0 is the
   interpreter's OWN event, which is what makes an unqualified move route in an
   event page move that event. On MZ this is also the wait-mode path: clear()
   keeps _characterId and updateWaitMode calls character(this._characterId)
   every frame, which is how MZ gets a null where MV holds a stale object. */
Game_Interpreter.prototype.character = function (param) {
  if ($gameParty.inBattle()) {
    return null;
  }
  if (param < 0) {
    return $gamePlayer;
  }
  if (!this.isOnCurrentMap()) {
    return null;
  }
  return $gameMap.event(param > 0 ? param : this._eventId);
};

/* MV :9040 / MZ :9776 — identical apart from MZ's prettier-ignore wrapping. */
Game_Interpreter.prototype.operateValue = function (operation, operandType, operand) {
  var value = operandType === 0 ? operand : $gameVariables.value(operand);
  return operation === 0 ? value : -value;
};

/* MV :9140 / MZ :9878 — identical. */
Game_Interpreter.prototype.setupNumInput = function (params) {
  $gameMessage.setNumberInput(params[0], params[1]);
};
/* MV :9154 / MZ :9892 — identical, `params[1] || 2` included. */
Game_Interpreter.prototype.setupItemChoice = function (params) {
  $gameMessage.setItemChoice(params[0], params[1] || 2);
};

/* -------------------------------------------------------------------------
   Game_CommonEvent — MV :6197-6234 / MZ :6878-6917.

   The WHOLE class, and it is identical on both engines except for the
   constructor's apply/spread spelling. It is also the smallest complete
   demonstration of the parallel-process contract: refresh() decides whether an
   interpreter exists at all, and update() re-setups the SAME list every time
   the interpreter stops, so a parallel common event restarts forever by
   design. Anything that "stops" one has to make isActive() false.
   ---------------------------------------------------------------------- */
function Game_CommonEvent() {
  this.initialize.apply(this, arguments);
}

/* MV :6201 / MZ :6882 — refresh() from the constructor, so a common event
   whose switch is already on has an interpreter before anything updates. */
Game_CommonEvent.prototype.initialize = function (commonEventId) {
  this._commonEventId = commonEventId;
  this.refresh();
};

/* MV :6206 / MZ :6887 */
Game_CommonEvent.prototype.event = function () {
  return $dataCommonEvents[this._commonEventId];
};

/* MV :6210 / MZ :6891. No null test: a common event id with no data throws
   here rather than degrading, which is the engine's real behaviour. */
Game_CommonEvent.prototype.list = function () {
  return this.event().list;
};

/* MV :6214 / MZ :6895. Creating the interpreter is conditional but REPLACING
   it is not — an already-running interpreter survives a refresh that finds the
   event still active, and is destroyed outright the moment it is not. */
Game_CommonEvent.prototype.refresh = function () {
  if (this.isActive()) {
    if (!this._interpreter) {
      this._interpreter = new Game_Interpreter();
    }
  } else {
    this._interpreter = null;
  }
};

/* MV :6224 / MZ :6905. trigger 2 is Parallel. trigger 1 (Autorun) common
   events never get a Game_CommonEvent at all — they run on the MAP's single
   interpreter, via setupAutorunCommonEvent, which is why an autorun common
   event blocks the player and a parallel one does not. */
Game_CommonEvent.prototype.isActive = function () {
  var event = this.event();
  return event.trigger === 2 && $gameSwitches.value(event.switchId);
};

/* MV :6229 / MZ :6910 */
Game_CommonEvent.prototype.update = function () {
  if (this._interpreter) {
    if (!this._interpreter.isRunning()) {
      this._interpreter.setup(this.list());
    }
    this._interpreter.update();
  }
};

/* -------------------------------------------------------------------------
   Game_Event — the shared half.

   core.js already defines Game_Event as a STANDALONE class with the
   constructor signature (id, name, x, y). The engine's is
   Game_Event(mapId, eventId) descending from Game_Character, and its
   initialize() calls locate() and refresh() before anything else touches it.
   That deviation is core.js's and is not undone here; the consequences are:
     · the engine's `Game_Character.prototype.<x>.call(this)` super calls have
       no target, so where one appears it is dropped and the comment says so;
     · the fields the engine sets in initMembers do not exist on a
       core.js-constructed event until something calls initMembers() —
       fixtures.js has to, and the report for this file says which.
   Everything below otherwise answers exactly as the engine's own body does,
   for every input, including the ones that throw.
   ---------------------------------------------------------------------- */
/* MV :8444 / MZ :9150. SHAPE: the leading
   `Game_Character.prototype.initMembers.call(this)` is dropped (no parent
   class here). Every field the engine's own initMembers sets is kept, in
   order. _trigger starts at 0 (Action Button) and _pageIndex at -2 — NOT -1,
   because -1 is the legitimate "no page meets its conditions" answer and
   refresh() only calls setupPage when the index CHANGES. Starting at -1 would
   make an event with no valid page skip its own clearPageSettings. */
Game_Event.prototype.initMembers = function () {
  this._moveType = 0;
  this._trigger = 0;
  this._starting = false;
  this._erased = false;
  this._pageIndex = -2;
  this._originalPattern = 1;
  this._originalDirection = 2;
  this._prelockDirection = 0;
  this._locked = false;
};

/* MV :8575 / MZ :9292. core.js's returns !!this._starting; the engine
   returns the field raw, so an event that has never been through initMembers
   answers undefined rather than false. Kept raw. */
Game_Event.prototype.isStarting = function () {
  return this._starting;
};

/* MV :8579 / MZ :9296 */
Game_Event.prototype.clearStartingFlag = function () {
  this._starting = false;
};

/* MV :8587 / MZ :9304. Overrides core.js's. Two differences that matter:
   the engine LOCKS the event for triggers 0/1/2 (that is what makes an NPC
   turn to face the player and stop wandering mid-conversation), and the
   `list.length > 1` test means a page holding only its {code:0} terminator
   never starts at all. isTriggerIn is the .contains/.includes split and lives
   in the engine files. */
Game_Event.prototype.start = function () {
  var list = this.list();
  if (list && list.length > 1) {
    this._starting = true;
    if (this.isTriggerIn([0, 1, 2])) {
      this.lock();
    }
    window.__started = (window.__started || 0) + 1;   /* core.js's counter, kept */
  }
};

/* MV :8487 / MZ :9195 and MV :8495 / MZ :9203 — identical. lock() remembers
   the pre-lock facing so unlock() can put it back; Game_Map.updateInterpreter
   is the only caller of unlock, through unlockEvent. */
Game_Event.prototype.lock = function () {
  if (!this._locked) {
    this._prelockDirection = this.direction();
    this.turnTowardPlayer();
    this._locked = true;
  }
};
Game_Event.prototype.unlock = function () {
  if (this._locked) {
    this._locked = false;
    this.setDirection(this._prelockDirection);
  }
};

/* MV :8597 / MZ :9314. erase() does not remove the event; it sets a flag and
   refreshes, and refresh() then resolves the page index to -1 unconditionally.
   Modelling erase as a splice out of _events would make event(id) return
   undefined where the engine returns a live, page-less object. */
Game_Event.prototype.erase = function () {
  this._erased = true;
  this.refresh();
};

/* MV :8602 / MZ :9319. Overrides core.js's, which recomputed _pageIndex on
   every call, ignored _erased, and never ran setupPage. The guard here is the
   point: setupPage — and therefore the whole _trigger / _interpreter / image
   reset — runs ONLY when the index actually changes. */
Game_Event.prototype.refresh = function () {
  var newPageIndex = this._erased ? -1 : this.findProperPageIndex();
  if (this._pageIndex !== newPageIndex) {
    this._pageIndex = newPageIndex;
    this.setupPage();
  }
  window.__eventRefreshes = (window.__eventRefreshes || 0) + 1;  /* core.js's counter, kept */
};

/* MV :8610 / MZ :9327. LAST page wins: the loop runs backwards and returns the
   highest-numbered page whose conditions are met. */
Game_Event.prototype.findProperPageIndex = function () {
  var pages = this.event().pages;
  var i = pages.length;
  while (i--) {
    if (this.meetsConditions(pages[i])) {
      return i;
    }
  }
  /* Ran out of pages: -1 is a real answer, not an error, and refresh() turns
     it into clearPageSettings. */
  return -1;
};

/* MV :8659 / MZ :9376 */
Game_Event.prototype.setupPage = function () {
  if (this._pageIndex >= 0) {
    this.setupPageSettings();
  } else {
    this.clearPageSettings();
  }
  this.refreshBushDepth();
  this.clearStartingFlag();
  this.checkEventTriggerAuto();
};

/* MV :8670 / MZ :9387. _trigger goes to null, not 0 — so isTriggerIn([0,1,2])
   is false for a page-less event and a mod that tested `_trigger === 0` would
   read a page-less event as an Action Button event. */
Game_Event.prototype.clearPageSettings = function () {
  this.setImage('', 0);
  this._moveType = 0;
  this._trigger = null;
  this._interpreter = null;
  this.setThrough(true);
};

/* MV :8678 / MZ :9395 — the ONLY place _interpreter is ever created for a map
   event. trigger 4 is Parallel; every other trigger nulls it. That is why
   updateParallel is a no-op on a normal NPC and why a panel that wants a
   per-event interpreter must look at trigger 4 events.

   Three parts, and the middle one is the surprising one. First the artwork,
   which is a tile OR a character sheet and never both. Then facing and
   pattern, which are applied ONLY when the new page asks for something the
   event does not already remember — that is what _originalDirection and
   _originalPattern are for, and it is why walking an event onto a new page
   with the same image leaves it facing where it stood. Then every remaining
   page field, handed to its own setter.

   The ORDER of that last group is observable — anything that hooks one of
   these setters sees them in exactly this sequence — so it is written as data
   rather than as prose. setDirectionFix appears in it even though the facing
   block above may already have called it with false: the page's own
   directionFix is applied last and wins, and an event whose page fixes its
   direction still turns once, on the frame the page changes. */
Game_Event.prototype.setupPageSettings = function () {
  var page = this.page();
  var art = page.image;

  if (art.tileId > 0) {
    this.setTileImage(art.tileId);
  } else {
    this.setImage(art.characterName, art.characterIndex);
  }

  if (this._originalDirection !== art.direction) {
    this._originalDirection = art.direction;
    this._prelockDirection = 0;
    this.setDirectionFix(false);
    this.setDirection(art.direction);
  }
  if (this._originalPattern !== art.pattern) {
    this._originalPattern = art.pattern;
    this.setPattern(art.pattern);
  }

  var forwarded = [
    ['setMoveSpeed', 'moveSpeed'],
    ['setMoveFrequency', 'moveFrequency'],
    ['setPriorityType', 'priorityType'],
    ['setWalkAnime', 'walkAnime'],
    ['setStepAnime', 'stepAnime'],
    ['setDirectionFix', 'directionFix'],
    ['setThrough', 'through'],
    ['setMoveRoute', 'moveRoute']
  ];
  for (var i = 0; i < forwarded.length; i++) {
    this[forwarded[i][0]](page[forwarded[i][1]]);
  }

  this._moveType = page.moveType;
  this._trigger = page.trigger;
  this._interpreter = this._trigger === 4 ? new Game_Interpreter() : null;
};

/* The setters setupPageSettings and clearPageSettings call. In the engine they
   are Game_CharacterBase's (MV rpg_core-adjacent rpg_objects.js:6613 / :6660 /
   :6771, MZ :7308 / :7359 / :7475 and neighbours) and Game_Event inherits
   them. core.js's Game_Event has no parent class, so they are defined here, on
   Game_Event.prototype, as the plain field writes the engine's own bodies are
   once their sprite bookkeeping is removed. They exist so the CALL ORDER above
   is real and observable; they are not a model of Game_CharacterBase, and if
   the character area ever models one properly its file loads later and wins. */
Game_Event.prototype.setImage = function (characterName, characterIndex) {
  this._tileId = 0;
  this._characterName = characterName;
  this._characterIndex = characterIndex;
};
Game_Event.prototype.setTileImage = function (tileId) {
  this._tileId = tileId;
  this._characterName = '';
  this._characterIndex = 0;
};
Game_Event.prototype.setDirection = function (d) { if (d) this._direction = d; };
Game_Event.prototype.direction = function () { return this._direction || 2; };
Game_Event.prototype.setDirectionFix = function (fix) { this._directionFix = fix; };
Game_Event.prototype.setPattern = function (pattern) { this._pattern = pattern; };
Game_Event.prototype.setMoveSpeed = function (moveSpeed) { this._moveSpeed = moveSpeed; };
Game_Event.prototype.setMoveFrequency = function (moveFrequency) { this._moveFrequency = moveFrequency; };
Game_Event.prototype.setPriorityType = function (priorityType) { this._priorityType = priorityType; };
Game_Event.prototype.setWalkAnime = function (walkAnime) { this._walkAnime = walkAnime; };
Game_Event.prototype.setStepAnime = function (stepAnime) { this._stepAnime = stepAnime; };
Game_Event.prototype.setThrough = function (through) { this._through = through; };
Game_Event.prototype.setMoveRoute = function (moveRoute) {
  this._moveRoute = moveRoute;
  this._moveRouteIndex = 0;
};
Game_Event.prototype.refreshBushDepth = function () { this._bushDepth = 0; };
Game_Event.prototype.turnTowardPlayer = function () { this._turnedToPlayer = true; };

/* MV :8465 / MZ :9171 and MV :8469 / MZ :9175 — page() and list() OVERRIDE
   core.js's, which are written defensively (`var d = this.event(); return d && ...`). The
   engine's are not defensive: for _pageIndex === -1 page() returns undefined
   and list() then throws a TypeError on `.list`. An erased or condition-failed
   event really does do that, and the defensive stub is exactly the kind of
   convenience that lets an unguarded ev.list() ship. */
Game_Event.prototype.page = function () {
  return this.event().pages[this._pageIndex];
};
Game_Event.prototype.list = function () {
  return this.page().list;
};

/* MV :8731 / MZ :9448. trigger 3 is Autorun. Called from setupPage, so an
   autorun page arms itself the moment its conditions come true. */
Game_Event.prototype.checkEventTriggerAuto = function () {
  if (this._trigger === 3) {
    this.start();
  }
};

/* MV :8737 / MZ :9454. SHAPE: the leading
   `Game_Character.prototype.update.call(this)` is dropped — core.js's
   Game_Event has no parent, and the movement half of the frame belongs to the
   character area. The two calls that matter to this area are kept, in order. */
Game_Event.prototype.update = function () {
  this.checkEventTriggerAuto();
  this.updateParallel();
};

/* MV :8743 / MZ :9460. Same restart-forever contract as Game_CommonEvent:
   whenever the interpreter is not running it is set up again from the top of
   the SAME page list, with this event's id. */
Game_Event.prototype.updateParallel = function () {
  if (this._interpreter) {
    if (!this._interpreter.isRunning()) {
      this._interpreter.setup(this.list(), this._eventId);
    }
    this._interpreter.update();
  }
};

/* -------------------------------------------------------------------------
   Game_Map — the interpreter half.

   core.js constructs Game_Map without _interpreter and without
   _commonEvents, because the engine sets both in Game_Map.prototype.initialize
   and core.js's constructor does not call it. Nothing here papers over that:
   isEventRunning below dereferences this._interpreter and will throw loudly on
   a map nobody wired. fixtures.js is where the wiring belongs and the report
   for this file names the two lines.
   ---------------------------------------------------------------------- */
/* MV :5489 / MZ :6167. OVERRIDES core.js's, which counted the call and
   dropped the flag. The flag is the whole mechanism: setValue on a switch or
   variable requests a refresh, and setupStartingEvent cashes it in through
   refreshIfNeeded on the very next interpreter pass. core's counter is kept so
   anything already reading window.__refreshes still reads it.
   MV's signature takes an unused `mapId` argument; MZ's takes none. */
Game_Map.prototype.requestRefresh = function (mapId) {
  this._needsRefresh = true;
  window.__refreshes = (window.__refreshes || 0) + 1;
};

/* MV :5803 / MZ :6488 */
Game_Map.prototype.refreshIfNeeded = function () {
  if (this._needsRefresh) {
    this.refresh();
  }
};

/* MV :5809 / MZ :6494 — listed in docs/MV-MZ-DELTA.md §C.21 as byte-identical.
   OVERRIDES core.js's, which refreshed events but not common events and
   never cleared _needsRefresh, so refreshIfNeeded would have refreshed on
   every single interpreter pass forever. core's counter is kept. */
Game_Map.prototype.refresh = function () {
  this.events().forEach(function (event) {
    event.refresh();
  });
  this._commonEvents.forEach(function (commonEvent) {
    commonEvent.refresh();
  });
  this.refreshTileEvents();
  this._needsRefresh = false;
  window.__mapRefreshes = (window.__mapRefreshes || 0) + 1;
};

/* MV :5559 / MZ :6236. core.js already filters the sparse _events the same
   way; this is the engine's own body, in this file so the class's interpreter
   half is complete in one place. _events is SPARSE — indexed by event id with
   a hole at 0 — so the filter is not cosmetic. */
Game_Map.prototype.events = function () {
  return this._events.filter(function (event) {
    return !!event;
  });
};

/* MV :5565 / MZ :6240. Indexed lookup, no filter, so event(0) is the hole. */
Game_Map.prototype.event = function (eventId) {
  return this._events[eventId];
};

/* MV :5569 / MZ :6244. Dereferences without a test — eraseEvent on an id that
   does not exist throws. */
Game_Map.prototype.eraseEvent = function (eventId) {
  this._events[eventId].erase();
};

/* MV :5844 / MZ :6521. Returns 0, not null, when nothing is there — so a
   caller testing the result truthily reads "no event", and a caller comparing
   to null does not. */
Game_Map.prototype.eventIdXy = function (x, y) {
  var list = this.eventsXy(x, y);
  return list.length === 0 ? 0 : list[0].eventId();
};

/* MV :5573 / MZ :6254 — same filter, same trigger constant. The MZ-only
   sibling autorunCommonEvents() is in x-interp-mz.js; MV has no such method
   and inlines the equivalent loop inside setupAutorunCommonEvent. */
Game_Map.prototype.parallelCommonEvents = function () {
  return $dataCommonEvents.filter(function (commonEvent) {
    return commonEvent && commonEvent.trigger === 2;
  });
};

/* MV :6064 / MZ :6747 */
Game_Map.prototype.updateEvents = function () {
  this.events().forEach(function (event) {
    event.update();
  });
  this._commonEvents.forEach(function (commonEvent) {
    commonEvent.update();
  });
};

/* MV :6113 / MZ :6799 — identical, and the most load-bearing loop in the
   class. The engine spells it `for (;;)` with a mid-loop `if (!setupStarting
   Event()) return;`, which is a do/while by another name and is written as one
   here. TWO exits, and what happens between them is the point: the interpreter
   is still running, or nothing else wants to start — and anything that DOES
   want to start is started in the SAME frame the last one finished. So
   terminating one map event and starting the next costs zero frames, and a
   hook that returns early here silently starves every autorun and every
   reserved common event without stopping the game. */
Game_Map.prototype.updateInterpreter = function () {
  do {
    this._interpreter.update();
    if (this._interpreter.isRunning()) {
      return;                       /* exit one: still busy, come back next frame */
    }
    /* It stopped. eventId survives terminate(), so this is where the map
       learns WHICH event just finished and hands its lock back. */
    var finishedEventId = this._interpreter.eventId();
    if (finishedEventId > 0) {
      this.unlockEvent(finishedEventId);
      this._interpreter.clear();
    }
    /* exit two is the while: nothing else wants to start. Otherwise round
       again, in the SAME frame, on whatever setupStartingEvent just loaded. */
  } while (this.setupStartingEvent());
};

/* MV :6129 / MZ :6815 */
Game_Map.prototype.unlockEvent = function (eventId) {
  if (this._events[eventId]) {
    this._events[eventId].unlock();
  }
};

/* MV :6135 / MZ :6821 — identical, and the PRIORITY ORDER is the contract:
   a reserved common event outranks a test event, which outranks a starting map
   event, which outranks an autorun common event. A mod that injects work by
   reserving a common event therefore jumps the queue ahead of the map event
   the player just talked to. setupTestEvent and setupAutorunCommonEvent differ
   between engines and live in the engine files. */
Game_Map.prototype.setupStartingEvent = function () {
  this.refreshIfNeeded();
  /* Highest rank first, short-circuiting, so at most ONE of the four ever
     runs. !! because the engine's four `return true`s hand back a literal and
     these four sources do not all promise one. */
  return !!(this._interpreter.setupReservedCommonEvent() ||
    this.setupTestEvent() ||
    this.setupStartingMapEvent() ||
    this.setupAutorunCommonEvent());
};

/* MV :6161 / MZ :6847. FIRST starting event by list order wins, and its flag
   is cleared before its list is handed over — so the event is no longer
   "starting" while it runs. */
Game_Map.prototype.setupStartingMapEvent = function () {
  var events = this.events();
  var armed = null;
  var i;
  for (i = 0; i < events.length; i++) {
    if (events[i].isStarting()) {
      armed = events[i];
      break;                    /* first by list order, and only the first */
    }
  }
  if (!armed) {
    return false;
  }
  /* Disarmed BEFORE its list is handed over, so isAnyEventStarting() is
     already false for this event while its own commands run. */
  armed.clearStartingFlag();
  this._interpreter.setup(armed.list(), armed.eventId());
  return true;
};

/* MV :5449 / MZ :6119. OVERRIDES core.js's, which read window.__eventRunning
   — a flag no engine has and nothing in the repo sets. The real answer is two
   things ORed: an interpreter with a list, or any event with its starting flag
   up. A panel showing "Event running" that reads only the interpreter misses
   the whole frame between a talk and its first command. */
Game_Map.prototype.isEventRunning = function () {
  return this._interpreter.isRunning() || this.isAnyEventStarting();
};

/* MV :6185 / MZ :6868 */
Game_Map.prototype.isAnyEventStarting = function () {
  return this.events().some(function (event) {
    return event.isStarting();
  });
};

/* -------------------------------------------------------------------------
   Game_Troop — the interpreter half. MV :5215-5245 / MZ :5873-5903, identical.

   core.js constructs Game_Troop without _interpreter for the same reason
   Game_Map has none: the engine creates it in initialize() and core.js's
   constructor does not call it. Same remedy, same place — fixtures.js.

   NOT MODELLED HERE: setupBattleEvent (MV :5345 / MZ :6013) and the troop
   meetsConditions it drives. They are the battle area's page-condition table,
   not the interpreter's, and copying setupBattleEvent without them would put a
   call to an undefined method in this file.
   ---------------------------------------------------------------------- */
/* MV :5221 / MZ :5879. Note this is NOT Game_Map's: the troop version asks the
   interpreter only, with no isAnyEventStarting term, because battle events do
   not have a starting flag. */
Game_Troop.prototype.isEventRunning = function () {
  return this._interpreter.isRunning();
};

/* MV :5225 / MZ :5883. One flat call — no for(;;), no unlock, no
   setupStartingEvent. The battle interpreter is re-fed from
   BattleManager's phase machine instead. */
Game_Troop.prototype.updateInterpreter = function () {
  this._interpreter.update();
};

/* MV :5237 / MZ :5895. clear() goes THROUGH the interpreter, so calling it on
   a troop whose _interpreter was never made throws — which is the loud form of
   "this fixture forgot to wire the battle interpreter". */
Game_Troop.prototype.clear = function () {
  this._interpreter.clear();
  this._troopId = 0;
  this._eventFlags = {};
  this._enemies = [];
  this._turnCount = 0;
  this._namesCount = {};
};
