/* =============================================================================
   GigaHack test harness — checks/trace.js
   GigaHack_Trace: watchpoints, the change journal, running interpreters, RNG.

   The claim this module makes is "who", not "what", so almost every check here
   drives a REAL interpreter over a REAL command list and then asks who the
   writer was. A check that called setValue by hand and asserted a name would
   pass against a module that guessed.

   State discipline: every variable, switch, self-switch, setting and hook this
   file touches is captured up front and put back at the end, and the last
   block asserts that it really was.
   ========================================================================== */
module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page, shot = ctx.shot;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ, MODDED = ctx.MODDED;

  /* --- capture everything this file is about to disturb -------------------- */
  await ev(() => {
    const G = window.GigaHack;
    window.__traceKeep = {
      vars: [2, 3, 5, 9, 11].map(id => [id, $gameVariables.value(id)]),
      switches: [1, 5, 7, 9, 21, 22, 23].map(id => [id, $gameSwitches.value(id)]),
      self: [[12, 1, 'A'], [12, 1, 'B']].map(k => [k, $gameSelfSwitches.value(k)]),
      open: G.ui.isOpen(),
      tab: G.cfg.ui.tab,
      pause: !!(G.cfg.behaviour && G.cfg.behaviour.pauseGame),
      mapInterpList: $gameMap._interpreter._list,
      mapInterpIndex: $gameMap._interpreter._index,
      undoSize: G.undo.size()
    };
  });

  const render = async (tab, sub) => {
    await ev(p => {
      const G = window.GigaHack;
      G.ui.setOpen(true);
      G.cfg.ui.tab = p.tab;
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub[p.tab] = p.sub;
      G.ui.rerender();
    }, { tab, sub });
    await page.waitForTimeout(110);
    return await ev(() => {
      const r = document.querySelector('#mm-root .mm-win') || document.querySelector('#mm-root');
      return r ? r.textContent : '';
    });
  };

  /* =======================================================================
     1. THE WRITER

     Every one of these runs the engine's own interpreter over the fixture's
     own command lists. Nothing is hand-written into a hit.
     ==================================================================== */
  const writer = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = {};
    W.clear(); W.clearHits();

    /* Event 2 'baker' is a Parallel page whose first branch writes variable 3
       and switch 7. The branch is `variable 2 >= 50`, so the fixture's own
       condition is satisfied rather than the command being reached around. */
    $gameVariables.setValue(2, 100);
    const idVar = W.add({ kind: 'var', id: 3, when: 'write' });
    const idSw = W.add({ kind: 'switch', id: 7, when: 'write' });
    out.added = idVar !== null && idSw !== null;

    const baker = $gameMap.event(2);
    baker._interpreter.setup(baker.list(), baker.eventId());
    baker._interpreter.update();

    out.mapId = $gameMap.mapId();
    const hits = W.hits();
    out.hitCount = hits.length;
    const v3 = hits.filter(x => x.kind === 'var' && x.id === 3)[0];
    out.v3 = v3 ? {
      writer: v3.writer, where: v3.where, mapId: v3.mapId, mapName: v3.mapName,
      eventId: v3.eventId, eventName: v3.eventName, from: v3.from, to: v3.to,
      command: v3.command, index: v3.index, aliased: v3.aliased
    } : null;
    /* The interpreter has run past that command by now — it ran the whole page
       in one update() — so anything reconstructed after the fact would name the
       last command, not the one that wrote. */
    out.interpMovedOn = baker._interpreter._index !== (v3 ? v3.index : -1) ||
      !baker._interpreter.isRunning();
    out.commandAtWrite = v3 ? v3.command : '';
    out.listCommandAtIndex = v3 ? (baker.list()[v3.index] || {}).code : 0;

    /* A hit must hold ids and strings. An interpreter in there pins its whole
       command list and, through _childInterpreter, a chain of them. */
    out.noObjects = v3 ? Object.keys(v3).every(k => v3[k] === null || typeof v3[k] !== 'object') : false;

    W.clear(); W.clearHits();
    return out;
  });

  check('a watchpoint on a variable names the map and the event that wrote it, not only the value that moved',
    writer.v3 && writer.v3.eventId === 2 && writer.v3.eventName === 'baker' &&
    writer.v3.mapId === writer.mapId &&
    new RegExp('Map ' + writer.mapId + ' .*event 2').test(writer.v3.writer),
    JSON.stringify(writer.v3));
  check('the writer is captured at the moment of the write, so it is still correct after the interpreter has moved on',
    writer.interpMovedOn && writer.listCommandAtIndex === 122 &&
    /Variable 3/.test(writer.commandAtWrite),
    writer.commandAtWrite + ' @' + (writer.v3 && writer.v3.index) + ' code ' + writer.listCommandAtIndex);
  check('a hit record holds ids and strings, never an interpreter, so nothing pins a command list alive',
    writer.noObjects === true, JSON.stringify(writer.v3));

  /* --- a child interpreter, i.e. a Call Common Event ----------------------- */
  const child = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    W.clear(); W.clearHits();
    W.add({ kind: 'var', id: 9, when: 'write' });
    /* Event 3 'door' calls common event 3, which writes variable 9. The child
       carries no record of WHICH common event it is running — only the
       parent's Call Common Event command says so. */
    const pair = window.__runNestedEvent(3);
    pair.parent.update();
    const hit = W.hits().filter(x => x.id === 9)[0];
    const out = hit ? {
      writer: hit.writer, where: hit.where,
      commonEventId: hit.commonEventId, commonEventName: hit.commonEventName,
      eventId: hit.eventId, to: hit.to, depth: hit.depth
    } : null;
    W.clear(); W.clearHits();
    window.__runNothing();
    return out;
  });
  check('a write made from a child interpreter names the common event that is running and the event that called it',
    child && child.where === 'common' && child.commonEventId === 3 &&
    child.eventId === 3 && /common event 3/.test(child.writer) && /event 3/.test(child.writer),
    JSON.stringify(child));

  /* --- nobody on the stack, and GigaHack itself ---------------------------- */
  const attribution = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = {};
    W.clear(); W.clearHits();
    W.add({ kind: 'var', id: 5, when: 'write' });

    /* Not inside any executeCommand: the honest answer is "something else". */
    $gameVariables.setValue(5, 11);
    const plain = W.lastHit();
    out.plain = { writer: plain.writer, where: plain.where, eventId: plain.eventId };

    /* A cheat, through the mod's own verified write path. The frame boundary is
       load-bearing: hits coalesce per watchpoint per frame, so without it the
       second write would be counted onto the first row rather than named. */
    G.frame();
    G.vars.setVar(5, 12);
    const mine = W.lastHit();
    out.mine = { writer: mine.writer, where: mine.where };

    out.contextOutsideAWrite = W.context();
    W.clear(); W.clearHits();
    return out;
  });
  check('a write with no interpreter on the stack is reported as coming from the engine or a plugin, and is never guessed at as an event',
    attribution.plain.where === 'unknown' && attribution.plain.writer === 'engine or plugin' &&
    attribution.plain.eventId === 0, JSON.stringify(attribution.plain));
  check('GigaHack\'s own writes are labelled as GigaHack\'s, so a cheat is not reported as an event that did it',
    attribution.mine.where === 'gigahack' && attribution.mine.writer === 'GigaHack',
    JSON.stringify(attribution.mine));
  check('the writer context is null outside a write, rather than reporting whatever ran last',
    attribution.contextOutsideAWrite === null, String(attribution.contextOutsideAWrite));

  /* --- the idle path ------------------------------------------------------- */
  const idle = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = {};
    W.clear(); W.clearHits();
    out.demandEmpty = W.demand();
    out.watchDemandEmpty = G.trace.report().watch.watchDemand;
    const before = G.trace.report().watch.observed;
    for (let i = 0; i < 8; i++) $gameVariables.setValue(5, i);
    out.observedIdle = G.trace.report().watch.observed - before;

    const fn = () => { };
    W.onAny(fn);
    out.demandWithSub = W.demand();
    out.watchDemandWithSub = G.trace.report().watch.watchDemand;
    const mid = G.trace.report().watch.observed;
    $gameVariables.setValue(5, 99);
    out.observedArmed = G.trace.report().watch.observed - mid;
    W.offAny(fn);
    out.demandAfterOff = W.demand();
    out.watchDemandAfterOff = G.trace.report().watch.watchDemand;
    const after = G.trace.report().watch.observed;
    $gameVariables.setValue(5, 3);
    out.observedIdleAgain = G.trace.report().watch.observed - after;
    return out;
  });
  check('with no watchpoint armed and nothing subscribed, setValue does no work beyond the original call',
    idle.demandEmpty === 0 && idle.watchDemandEmpty === false && idle.observedIdle === 0,
    JSON.stringify(idle));
  check('removing the last watchpoint and the last subscriber returns setValue to its idle path',
    idle.watchDemandWithSub === true && idle.observedArmed === 1 &&
    idle.demandAfterOff === 0 && idle.watchDemandAfterOff === false && idle.observedIdleAgain === 0,
    JSON.stringify(idle));

  /* --- a second subscriber, and the context thunk -------------------------- */
  const subs = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = { seenA: 0, seenB: 0, thunk: '', resolved: null, asked: 0 };
    const a = p => { out.seenA++; out.thunk = typeof p.context; };
    const b = p => { out.seenB++; out.asked++; out.resolved = p.context(); };
    W.onAny(a); W.onAny(b);
    $gameVariables.setValue(5, 41);
    W.offAny(a); W.offAny(b);
    out.resolvedIsContext = out.resolved === null || typeof out.resolved === 'object';
    return out;
  });
  check('$.watch delivers every write to a second subscriber, and the subscriber pays for the writer context only when it asks for it',
    subs.seenA === 1 && subs.seenB === 1 && subs.thunk === 'function' && subs.resolvedIsContext,
    JSON.stringify(subs));

  /* --- self-switches ------------------------------------------------------- */
  const selfsw = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = {};
    W.clear(); W.clearHits();
    /* The engine coerces the ARRAY key to 'map,event,letter'; a watchpoint that
       keyed on anything else would match nothing here and everything in a test
       that built its own key. */
    const here = $gameMap.mapId();
    out.here = here;
    out.coercion = String([here, 1, 'A']);
    W.add({ kind: 'selfswitch', target: here + ',1', letter: 'A', when: 'write' });
    W.add({ kind: 'selfswitch', target: here + ',1', letter: 'B', when: 'write' });

    /* Command 123 from the map interpreter, running as event 1 on map 12. */
    window.__runEvent(1, 0, [window.__cmd(123, 0, ['A', 0]), window.__cmd(0, 0, [])]);
    $gameMap._interpreter.update();

    const all = W.hits();
    out.count = all.length;
    const hit = all[0] || null;
    out.hit = hit ? {
      key: hit.key, kind: hit.kind, to: hit.to, stuck: hit.stuck,
      writer: hit.writer, eventId: hit.eventId
    } : null;
    out.letterBDidNotFire = all.every(x => x.key !== here + ',1,B');

    /* A caller that reuses one key array must not be able to rewrite a hit
       that has already been recorded. */
    G.frame();
    const shared = [here, 1, 'B'];
    $gameSelfSwitches.setValue(shared, true);
    const before = W.lastHit().key;
    shared[2] = 'C';
    out.keyIsACopy = W.lastHit().key === before && before === here + ',1,B';

    W.clear(); W.clearHits();
    $gameSelfSwitches.setValue([here, 1, 'A'], false);
    $gameSelfSwitches.setValue([here, 1, 'B'], false);
    return out;
  });
  check('a self-switch watchpoint keys on map, event and letter exactly the way the engine coerces the key',
    selfsw.coercion === selfsw.here + ',1,A' && selfsw.hit &&
    selfsw.hit.key === selfsw.here + ',1,A' &&
    selfsw.hit.eventId === 1 && selfsw.letterBDidNotFire,
    JSON.stringify(selfsw));
  check('a self-switch hit reports that whether it stuck is unknown, rather than reporting that it stuck',
    selfsw.hit && selfsw.hit.stuck === null, JSON.stringify(selfsw.hit));
  check('a self-switch key is copied at capture time, so a caller reusing the array cannot rewrite a recorded hit',
    selfsw.keyIsACopy === true, JSON.stringify(selfsw));

  /* --- coalescing ---------------------------------------------------------- */
  const churn = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = {};
    W.clear(); W.clearHits();
    W.add({ kind: 'var', id: 5, when: 'write' });
    const total0 = W.totalHits();
    for (let i = 1; i <= 6; i++) $gameVariables.setValue(5, i);
    out.rowsOneFrame = W.hits().length;
    out.countOneFrame = W.lastHit().count;
    /* The ring's length is not the count. Once it is full its length never
       changes again, so what is counted is the total ever recorded. */
    out.totalRecorded = W.totalHits() - total0;
    G.frame();
    $gameVariables.setValue(5, 7);
    out.rowsTwoFrames = W.hits().length;
    out.lastCount = W.lastHit().count;
    W.clear(); W.clearHits();
    return out;
  });
  check('a watchpoint on a variable a parallel process writes every frame records one hit for that frame and counts the rest',
    churn.rowsOneFrame === 1 && churn.countOneFrame === 6 && churn.totalRecorded === 6 &&
    churn.rowsTwoFrames === 2 && churn.lastCount === 1, JSON.stringify(churn));

  /* --- pause --------------------------------------------------------------- */
  const held = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = {};
    W.clear(); W.clearHits();
    out.sceneHooksBefore = G.pause.targets().slice();
    out.traceOwnsNoSceneHook = G.trace.report().hooks.every(hh => !/SceneManager/.test(hh.name));
    W.add({ kind: 'var', id: 5, when: 'write', pause: true });
    $gameVariables.setValue(5, 55);
    /* The write happened inside the interpreter's own loop; nothing may open
       the overlay or write a setting from there. */
    out.pausedAtWriteTime = !!(G.cfg.behaviour && G.cfg.behaviour.pauseGame);
    G.frame();
    out.pausedNextFrame = !!(G.cfg.behaviour && G.cfg.behaviour.pauseGame);
    out.heldSaysSo = W.held();
    out.sceneHooksAfter = G.pause.targets().slice();
    W.resume();
    out.afterResume = !!(G.cfg.behaviour && G.cfg.behaviour.pauseGame);
    out.heldAfterResume = W.held();
    W.clear(); W.clearHits();
    return out;
  });
  check('pause-on-hit goes through $.pause and installs no gate of its own',
    held.traceOwnsNoSceneHook === true &&
    JSON.stringify(held.sceneHooksBefore) === JSON.stringify(held.sceneHooksAfter) &&
    held.sceneHooksAfter.length > 0, JSON.stringify(held));
  check('the game is held on the frame after the hit, not during the write that caused it',
    held.pausedAtWriteTime === false && held.pausedNextFrame === true && held.heldSaysSo === true,
    JSON.stringify(held));
  check('clearing the hold puts the pause setting back the way it was found',
    held.afterResume === false && held.heldAfterResume === false, JSON.stringify(held));

  /* --- persistence --------------------------------------------------------- */
  const persist = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = {};
    W.clear(); W.clearHits();
    W.add({ kind: 'var', id: 5, when: 'becomes', value: 7 });
    $gameVariables.setValue(5, 7);
    const saved = G.store.cfgGet('trace.watch.points', []);
    out.savedCount = saved.length;
    out.savedShape = saved[0] ? Object.keys(saved[0]).sort().join(',') : '';
    out.hitsRecorded = W.hits().length;
    out.hitsNotPersisted = JSON.stringify(saved).indexOf('writer') === -1 &&
      JSON.stringify(G.cfg.trace.watch).indexOf('writer') === -1;

    /* The two flags that must never arrive switched on. */
    out.unsafe = G.store.unsafeList().map(e => e.path);
    G.store.cfgSet('trace.rng.seedOn', true);
    G.store.cfgSet('trace.watch.pauseOnHit', true);
    const scrubbed = G.store.scrubUnsafe(['trace.rng.seedOn', 'trace.watch.pauseOnHit'])
      .map(e => e.path).sort();
    out.scrubbed = scrubbed;
    out.seedOffAfter = G.store.cfgGet('trace.rng.seedOn', null);
    out.pauseOffAfter = G.store.cfgGet('trace.watch.pauseOnHit', null);

    W.clear(); W.clearHits();
    return out;
  });
  check('the watchpoints themselves survive a launch and the hits they recorded do not',
    persist.savedCount === 1 && /kind/.test(persist.savedShape) && /when/.test(persist.savedShape) &&
    persist.hitsRecorded === 1 && persist.hitsNotPersisted === true, JSON.stringify(persist));
  check('pause-on-hit and seeding are both registered as unsafe at boot, and a settings profile is scrubbed of them',
    persist.unsafe.indexOf('trace.watch.pauseOnHit') > -1 &&
    persist.unsafe.indexOf('trace.rng.seedOn') > -1 &&
    persist.scrubbed.join(',') === 'trace.rng.seedOn,trace.watch.pauseOnHit' &&
    persist.seedOffAfter === false && persist.pauseOffAfter === false, JSON.stringify(persist));

  /* --- the writer alias, removed ------------------------------------------- */
  const unattributed = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const NAME = 'Game_Interpreter.executeCommand (writer context)';
    const out = {};
    const hook = G.hooks[NAME];
    const ours = Game_Interpreter.prototype.executeCommand;
    out.attributableBefore = W.attributable().ok;
    hook.unpatch();
    out.attributableAfter = W.attributable().ok;
    out.reason = W.attributable().why;

    W.clear(); W.clearHits();
    W.add({ kind: 'var', id: 5, when: 'write' });
    $gameVariables.setValue(2, 100);
    const baker = $gameMap.event(2);
    baker._interpreter.setup([window.__cmd(122, 0, [5, 5, 0, 0, 3]), window.__cmd(0, 0, [])],
      baker.eventId());
    baker._interpreter.update();
    const hit = W.lastHit();
    out.stillFired = !!hit;
    out.writer = hit ? hit.writer : '';
    out.where = hit ? hit.where : '';

    /* Put it back exactly: the function and the flag the registry keeps. */
    Game_Interpreter.prototype.executeCommand = ours;
    hook.installed = true;
    out.restored = W.attributable().ok && Game_Interpreter.prototype.executeCommand === ours;
    W.clear(); W.clearHits();
    return out;
  });
  check('when the interpreter alias could not install, watchpoints still fire and the panel names the reason the writer cannot be named',
    unattributed.attributableBefore === true && unattributed.attributableAfter === false &&
    unattributed.stillFired === true && unattributed.where === 'unknown' &&
    unattributed.writer === 'engine or plugin' &&
    unattributed.reason.length > 40 && unattributed.restored === true,
    JSON.stringify(unattributed));

  /* --- a subclassed interpreter ------------------------------------------- */
  const subclassed = await ev(() => {
    const G = window.GigaHack, W = G.watch;
    const out = {};
    W.clear(); W.clearHits();
    W.add({ kind: 'var', id: 5, when: 'write' });
    const i = $gameMap._interpreter;
    window.__runEvent(1, 0, [window.__cmd(122, 0, [5, 5, 0, 0, 8]), window.__cmd(0, 0, [])]);
    out.aliasedNormally = G.interp.all().filter(r => r.interp === i)[0].aliased;

    /* A plugin that subclasses the interpreter and overrides executeCommand on
       the subclass shadows the prototype alias. $.compat.aliasIntegrity cannot
       see that, because the prototype method is still ours. */
    const engineOwn = G.hooks['Game_Interpreter.executeCommand (writer context)'].original;
    i.executeCommand = function () { return engineOwn.apply(this, arguments); };
    out.aliasedShadowed = G.interp.all().filter(r => r.interp === i)[0].aliased;
    i.executeCommand();
    const hit = W.lastHit();
    out.shadowedWriter = hit ? hit.where : '';
    delete i.executeCommand;
    out.aliasedRestored = G.interp.all().filter(r => r.interp === i)[0].aliased;
    W.clear(); W.clearHits();
    window.__runNothing();
    return out;
  });
  check('an interpreter whose executeCommand is not the function GigaHack aliased is listed as unattributed rather than attributed to the wrong event',
    subclassed.aliasedNormally === true && subclassed.aliasedShadowed === false &&
    subclassed.shadowedWriter === 'unknown' && subclassed.aliasedRestored === true,
    JSON.stringify(subclassed));

  /* =======================================================================
     2. THE JOURNAL
     ==================================================================== */
  const journal = await ev(() => {
    const G = window.GigaHack, J = G.journal;
    const out = {};
    J.clear();
    const before = J.size();
    G.vars.setVar(5, 4242);
    const rows = J.rows();
    out.added = rows.length - before;
    const r = rows[rows.length - 1];
    out.row = { control: r.control, want: r.want, got: r.got, stuck: r.stuck, kind: r.kind, undoable: r.undoable };

    /* A verify that no undo entry follows is a real write and gets its own row
       at the next frame boundary rather than being dropped. */
    const n0 = J.size();
    const was = $gameVariables.value(9);
    G.compat.verify('vars.set', () => $gameVariables.setValue(9, 4243), () => $gameVariables.value(9), 4243);
    out.notYet = J.size() - n0;
    G.frame();
    out.afterFrame = J.size() - n0;
    const un = J.rows()[J.size() - 1];
    out.unanchored = { kind: un.kind, control: un.control, undoable: un.undoable, stuck: un.stuck };
    $gameVariables.setValue(9, was);

    out.feeds = J.feeds();
    out.blindSpots = J.blindSpots().length;
    out.blindSpotsAreSentences = J.blindSpots().every(b => b.length > 40);
    /* The feed is an alias, not a dependency: neither service holds a
       reference to the journal it fills. */
    out.undoOwner = G.hooks['GigaHack.undo.push (journal)'].owner === G.undo;
    out.verifyOwner = G.hooks['GigaHack.compat.verify (journal)'].owner === G.compat;
    out.undoKnowsNothing = Object.keys(G.undo).every(k => G.undo[k] !== J && G.undo[k] !== G.trace);
    out.compatKnowsNothing = Object.keys(G.compat).every(k => G.compat[k] !== J && G.compat[k] !== G.trace);
    return out;
  });
  check('every verified write appears in the journal with what it wanted, what it got, and whether it stuck',
    journal.row.control === 'vars.set' && journal.row.want === 4242 && journal.row.got === 4242 &&
    journal.row.stuck === true, JSON.stringify(journal.row));
  check('an undo entry and the verify that preceded it are one journal row, not two',
    journal.added === 1, String(journal.added));
  check('a verify with no undo entry after it still appears, as its own row, rather than being dropped',
    journal.notYet === 0 && journal.afterFrame === 1 &&
    journal.unanchored.kind === 'unanchored' && journal.unanchored.control === 'vars.set' &&
    journal.unanchored.undoable === false, JSON.stringify(journal.unanchored));
  check('feeding the journal costs $.undo and $.compat nothing — neither has any reference to it',
    journal.undoOwner && journal.verifyOwner && journal.undoKnowsNothing && journal.compatKnowsNothing,
    JSON.stringify(journal));
  check('the journal names what it cannot see rather than implying it saw everything',
    journal.blindSpots === 4 && journal.blindSpotsAreSentences === true, String(journal.blindSpots));
  check('both journal feeds are live on a clean install',
    journal.feeds.undo === true && journal.feeds.verify === true && journal.feeds.why === '',
    JSON.stringify(journal.feeds));

  const undoBack = await ev(() => {
    const G = window.GigaHack, J = G.journal;
    const out = {};
    J.clear();
    const base = G.undo.size();
    const v0 = $gameVariables.value(5), s0 = $gameSwitches.value(9);
    G.vars.setVar(5, 111);
    const anchor = J.rows()[J.size() - 1].seq;
    G.vars.setVar(5, 222);
    G.vars.setSwitch(9, !s0);
    out.depth = G.undo.size() - base;
    out.can = J.canUndoTo(anchor);
    const rowsBefore = J.size();
    out.popped = J.undoTo(anchor);
    out.depthAfter = G.undo.size() - base;
    out.valueBack = $gameVariables.value(5) === v0;
    out.switchBack = $gameSwitches.value(9) === s0;
    /* Undoing is itself a change, so the journal still reads as what happened. */
    const added = J.rows().slice(rowsBefore);
    out.undoneRows = added.filter(r => r.kind === 'undone').length;
    out.anchorNowIrreversible = J.canUndoTo(anchor).ok === false;
    return out;
  });
  check('undo back to a row pops exactly the entries made after it, and no more',
    undoBack.can.ok === true && undoBack.can.count === 3 && undoBack.popped === 3 &&
    undoBack.depthAfter === 0 && undoBack.valueBack && undoBack.switchBack,
    JSON.stringify(undoBack));
  check('undoing through the journal is itself journaled, so the list still reads as what happened',
    undoBack.undoneRows === 3 && undoBack.anchorNowIrreversible === true, JSON.stringify(undoBack));

  const fallen = await ev(() => {
    const G = window.GigaHack, J = G.journal;
    const out = {};
    J.clear(); G.undo.clear();
    G.undo.push('probe 0 → 1', () => { });
    const oldest = J.rows()[0].seq;
    out.oldestUndoableAtFirst = J.canUndoTo(oldest).ok;
    /* The stack is capped at a hundred and shift()s on overflow, so the oldest
       entry stops being reachable long before the row leaves the journal. */
    for (let i = 1; i <= 120; i++) G.undo.push('probe ' + i + ' → ' + (i + 1), () => { });
    const verdict = J.canUndoTo(oldest);
    out.verdict = verdict;
    out.rowStillListed = J.rows().some(r => r.seq === oldest);
    out.saysHowMany = /\d+ have been made since/.test(verdict.why);

    /* Clearing marks every row irreversible instead of deleting it. */
    const rowsBefore = J.size();
    const live = J.reversible();
    G.undo.clear();
    out.rowsKept = J.size() === rowsBefore;
    out.hadLiveRows = live > 0;
    out.noneReversible = J.reversible() === 0 && J.rows().every(r => !r.undoable);
    out.clearedWhy = J.canUndoTo(J.rows()[J.size() - 1].seq).why;
    J.clear();
    return out;
  });
  check('a row whose undo entry has fallen off the hundred-deep stack refuses, and says how many edits have been made since',
    fallen.oldestUndoableAtFirst === true && fallen.verdict.ok === false &&
    fallen.rowStillListed === true && fallen.saysHowMany === true, JSON.stringify(fallen));
  check('clearing the undo stack marks every journal row irreversible instead of deleting it',
    fallen.rowsKept && fallen.hadLiveRows && fallen.noneReversible &&
    /cleared/.test(fallen.clearedWhy), JSON.stringify(fallen));

  const passthrough = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    /* Six modules branch on .ok, .message and .culprits. The wrapper must hand
       back the object verify built, not a copy of it — so a sentinel placed
       inside verify's own answer has to come out the other side by identity. */
    const sentinel = [{ name: 'sentinel', plugins: ['none'], note: 'sentinel' }];
    const realCulprits = G.compat.likelyCulprits;
    G.compat.likelyCulprits = () => sentinel;
    const r = G.compat.verify('trace.selftest', () => { }, () => 1, 2);
    G.compat.likelyCulprits = realCulprits;
    out.sameArray = r.culprits === sentinel;
    out.shape = Object.keys(r).sort().join(',');
    out.ok = r.ok;
    G.compat.clearDegraded('trace.selftest');
    G.frame();
    G.journal.clear();
    return out;
  });
  check('the journal wrapper hands the caller back the same result object $.compat.verify built',
    passthrough.sameArray === true && passthrough.ok === false &&
    passthrough.shape === 'culprits,got,message,ok,want', JSON.stringify(passthrough));

  /* =======================================================================
     3. INTERPRETERS
     ==================================================================== */
  const roots = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    window.__runNothing();
    /* Game_Troop.prototype.initialize builds the battle interpreter and
       core.js's bare constructor does not, so a check that replaced $gameTroop
       left the harness in a state the engine never produces. Put it back the
       way Game_Troop.initialize does before asking who is running. */
    if ($gameTroop && !$gameTroop._interpreter) $gameTroop._interpreter = new Game_Interpreter();
    window.__runEvent(3, 0, $dataMap.events[3].pages[0].list);
    window.__runCommonEvent(2);
    out.kinds = G.interp.roots().map(r => r.kind).sort().join(',');
    out.commonNamed = G.interp.roots().filter(r => r.kind === 'common')
      .map(r => r.commonEventId + ':' + r.commonEventName).join(',');
    out.eventNamed = G.interp.roots().filter(r => r.kind === 'event')
      .map(r => r.eventId + ':' + r.eventName).join(',');

    /* A child interpreter is shown under its parent, at its depth. */
    const pair = window.__runNestedEvent(3);
    const all = G.interp.all();
    const childRow = all.filter(r => r.interp === pair.child)[0];
    out.childDepth = childRow ? childRow.depth : -1;
    out.childParentIsMap = childRow ? childRow.parent === pair.parent : false;
    out.childWhere = childRow ? childRow.where : '';
    return out;
  });
  check('the interpreter panel lists the map interpreter, every parallel event\'s own, every parallel common event\'s own, and the battle one',
    roots.kinds === 'battle,common,event,map' && /2:Tick/.test(roots.commonNamed) &&
    /2:baker/.test(roots.eventNamed), JSON.stringify(roots));
  check('a child interpreter is shown under its parent, at its depth',
    roots.childDepth === 1 && roots.childParentIsMap === true && /child of map/.test(roots.childWhere),
    JSON.stringify(roots));

  const engineDelta = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    const i = $gameMap._interpreter;
    window.__runEvent(3, 0, [window.__cmd(230, 0, [45]), window.__cmd(0, 0, [])]);
    /* MV assigns this._params before calling the handler; MZ passes the
       parameters as an argument and has no such field at all. Anything reading
       _params for the current command is blank on one engine with no error. */
    out.hasParams = Object.prototype.hasOwnProperty.call(i, '_params');
    i._params = [{ nonsense: true }];
    const row = G.interp.all().filter(r => r.interp === i)[0];
    out.command = row.command;
    out.code = row.code;
    if (!out.hasParams) delete i._params;

    /* The character an interpreter waits for is an OBJECT on one engine and an
       id on the other. Feature-detected, never engine-named. */
    i.clear();
    out.hasCharacter = Object.prototype.hasOwnProperty.call(i, '_character');
    out.hasCharacterId = Object.prototype.hasOwnProperty.call(i, '_characterId');
    return out;
  });
  check('the command an interpreter is on is read from its list and its index, never from _params, which only one engine has',
    engineDelta.code === 230 && /Wait/i.test(engineDelta.command) &&
    engineDelta.command.indexOf('nonsense') === -1, JSON.stringify(engineDelta));
  check('_params is present exactly on the engine that has it',
    engineDelta.hasParams === IS_MV, 'hasParams=' + engineDelta.hasParams + ' MV=' + IS_MV);
  check('the wait a character is being waited for is kept on whichever field this engine has, and both are answered for',
    engineDelta.hasCharacter === IS_MV && engineDelta.hasCharacterId === IS_MZ,
    JSON.stringify(engineDelta));

  const waits = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    window.__runNothing();
    const i = window.__runEvent(3, 0, [window.__cmd(230, 0, [45]), window.__cmd(0, 0, [])]);
    i._waitMode = 'route';
    i._waitCount = 45;
    let row = G.interp.all().filter(r => r.interp === i)[0];
    out.waitNamed = row.waitMode + ':' + row.waitCount;
    out.describe = G.interp.describe(i);
    const routeDiag = G.interp.diagnose();
    out.routeCause = routeDiag.map(d => d.cause).join('|');
    out.routeFix = routeDiag.map(d => d.fix).join(' ');

    /* A message holding an interpreter is named as the message. */
    i._waitMode = 'message';
    i._waitCount = 0;
    $gameMessage.clear();
    $gameMessage.add('who closed this');
    window.__msgBusy = true;
    const msgDiag = G.interp.diagnose();
    out.messageCause = msgDiag.some(d => /message is holding/.test(d.cause));
    out.messageFix = msgDiag.filter(d => /message is holding/.test(d.cause))
      .map(d => d.fix).join('');
    window.__msgBusy = false;
    $gameMessage.clear();

    /* A wait count in the thousands is its own diagnosis, in seconds. */
    i._waitMode = '';
    i._waitCount = 9412;
    const longDiag = G.interp.diagnose();
    out.longWait = longDiag.filter(d => /thousands/.test(d.cause)).map(d => d.detail).join('');

    /* Releasing clears the count and the mode and touches nothing else. */
    i._waitMode = 'route';
    i._waitCount = 9412;
    const list = i._list, index = i._index;
    const rel = G.interp.releaseWait(i);
    out.released = rel.ok;
    out.afterMode = i._waitMode;
    out.afterCount = i._waitCount;
    out.listUntouched = i._list === list && i._index === index;
    out.refuses = G.interp.releaseWait(i).why;

    /* The engine's own runaway guard stops an interpreter and says nothing. */
    i._freezeChecker = 100000;
    i._frameCount = Graphics.frameCount;
    out.froze = G.interp.froze(i);
    out.frozeReported = G.interp.diagnose().some(d => /runaway/.test(d.cause));
    i._freezeChecker = 0;
    window.__runNothing();
    return out;
  });
  check('an interpreter sitting on a wait says which wait and how many frames are left',
    waits.waitNamed === 'route:45' && /route/.test(waits.describe) && /45 frames left/.test(waits.describe),
    JSON.stringify(waits));
  check('a wait that is not clearing names the panel that releases it, never a plugin',
    /wait mode that is not clearing/.test(waits.routeCause) && /Player → Movement/.test(waits.routeFix) &&
    waits.routeFix.toLowerCase().indexOf('plugin') === -1, JSON.stringify(waits));
  check('a message holding an interpreter is named as the message, not as an unknown wait',
    waits.messageCause === true && /Game → Message/.test(waits.messageFix), JSON.stringify(waits));
  check('a wait count in the thousands is reported in seconds as well as frames',
    /9412 frames/.test(waits.longWait) && /about 157 seconds/.test(waits.longWait), waits.longWait);
  check('releasing a wait clears the count and the mode and touches neither the list nor the index',
    waits.released === true && waits.afterMode === '' && waits.afterCount === 0 &&
    waits.listUntouched === true && /not waiting/.test(waits.refuses), JSON.stringify(waits));
  check('an interpreter that hit the engine\'s hundred-thousand-command guard is reported, because the engine reports nothing',
    waits.froze === true && waits.frozeReported === true, JSON.stringify(waits));

  const autorun = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    window.__runNothing();
    window.__addMapEvents();
    const diag = G.interp.diagnose().filter(d => /autorun/i.test(d.cause));
    out.named = diag.length > 0;
    out.detail = diag.map(d => d.detail).join('');
    out.fix = diag.map(d => d.fix).join('');
    window.__removeMapEvents();
    out.goneAfter = G.interp.diagnose().filter(d => /autorun/i.test(d.cause)).length;
    out.clean = G.interp.diagnose().length;
    return out;
  });
  check('an autorun page whose conditions still hold is named as the reason the player has no control, and the fix names a panel rather than a plugin',
    autorun.named && /event 4/.test(autorun.detail) && /gate/.test(autorun.detail) &&
    /Autorun/.test(autorun.detail) && /World → Switches/.test(autorun.fix) &&
    autorun.fix.toLowerCase().indexOf('plugin') === -1 && autorun.goneAfter === 0,
    JSON.stringify(autorun));
  check('with nothing holding the game the diagnosis is empty rather than speculative',
    autorun.clean === 0, String(autorun.clean));

  const disagree = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    window.__runNothing();
    out.agrees = G.interp.summary().disagree;
    const real = Game_Map.prototype.isEventRunning;
    Game_Map.prototype.isEventRunning = function () { return true; };
    const s = G.interp.summary();
    out.engineSays = s.engineSays;
    out.interpSays = s.interpSays;
    out.disagree = s.disagree;
    Game_Map.prototype.isEventRunning = real;
    out.restored = G.interp.summary().disagree;
    return out;
  });
  check('$gameMap.isEventRunning and the map interpreter\'s own answer are both shown, and a disagreement between them is named',
    disagree.agrees === false && disagree.engineSays === true && disagree.interpSays === false &&
    disagree.disagree === true && disagree.restored === false, JSON.stringify(disagree));

  const idleCommon = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    window.__runCommonEvent(2);
    out.runningWhileOn = G.interp.idleCommonEvents().some(c => c.id === 2);
    $gameSwitches.setValue(2 && $dataCommonEvents[2].switchId, false);
    $gameMap._commonEvents.forEach(c => c.refresh());
    const idleRows = G.interp.idleCommonEvents();
    out.row = idleRows.filter(c => c.id === 2)[0] || null;
    out.rootsWithout = G.interp.roots().filter(r => r.kind === 'common').length;
    return out;
  });
  check('a common event with no interpreter is explained by the switch that governs it',
    idleCommon.runningWhileOn === false && idleCommon.row &&
    idleCommon.row.switchId === 5 && idleCommon.row.on === false && idleCommon.rootsWithout === 0,
    JSON.stringify(idleCommon));

  /* =======================================================================
     4. RNG
     ==================================================================== */
  const rngIdle = await ev(() => {
    const G = window.GigaHack;
    return {
      watching: G.rng.watching(),
      seeded: G.rng.seeded(),
      native: /\[native code\]/.test(Function.prototype.toString.call(Math.random)),
      noHook: !G.hooks['Math.random (rng)'],
      nativeAtLoad: G.rng.nativeAtLoad()
    };
  });
  check('the roll recorder is off unless armed, and Math.random is the host\'s own function until it is',
    rngIdle.watching === false && rngIdle.seeded === false && rngIdle.native === true &&
    rngIdle.noHook === true, JSON.stringify(rngIdle));

  const rngArm = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    const before = Math.random;
    G.rng.watch(true);
    out.installed = !!(G.hooks['Math.random (rng)'] && G.hooks['Math.random (rng)'].installed);
    out.replaced = Math.random !== before;
    out.nativeAtLoadStillTrue = G.rng.nativeAtLoad();

    /* A roll made from inside a command must carry the event that asked for it.
       Event 2's page ends with a Control Variables whose operand is Random, so
       the roll goes through Math.randomInt from inside command122. */
    G.rng.clear();
    $gameVariables.setValue(2, 100);
    const baker = $gameMap.event(2);
    baker._interpreter.setup(baker.list(), baker.eventId());
    baker._interpreter.update();
    const rolls = G.rng.rolls();
    out.rolled = rolls.length > 0;
    out.writers = rolls.map(r => r.writer).join(' | ');
    out.fromEvent = rolls.some(r => /event 2/.test(r.writer));
    out.countExact = G.rng.count().session === rolls.length;

    /* Neither the recorder nor the writer lookup may roll a number of its own. */
    const n0 = G.rng.count().session;
    G.watch.context(); G.interp.all(); G.journal.rows(); G.rng.sites();
    G.watch.describeWriter(null);
    out.selfRolls = G.rng.count().session - n0;

    G.rng.watch(false);
    out.removed = !G.hooks['Math.random (rng)'];
    out.backToNative = Math.random === before;
    return out;
  });
  check('arming the recorder installs the alias and disarming it removes it, so an unused mod menu leaves Math.random alone',
    rngArm.installed && rngArm.replaced && rngArm.removed && rngArm.backToNative,
    JSON.stringify({ i: rngArm.installed, r: rngArm.replaced, rm: rngArm.removed, b: rngArm.backToNative }));
  check('a recorded roll carries the event that asked for it when an event asked for it',
    rngArm.rolled && rngArm.fromEvent && rngArm.countExact, rngArm.writers);
  check('nothing in the recorder or the writer lookup rolls a number of its own',
    rngArm.selfRolls === 0, String(rngArm.selfRolls));
  check('a Math.random that was already not the host\'s own function at load is answered from load time, not from now',
    rngIdle.nativeAtLoad === true && rngArm.nativeAtLoadStillTrue === true,
    String(rngIdle.nativeAtLoad) + '/' + String(rngArm.nativeAtLoadStillTrue));

  const seedRun = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    const nativeFn = Math.random;
    const cached = Math.random;      // a reference taken BEFORE seeding
    G.rng.seed(1234);
    G.rng.setSeeded(true);
    out.replaced = Math.random !== nativeFn;
    const a = [];
    for (let i = 0; i < 8; i++) a.push(Math.random());
    G.rng.reseed();
    const b = [];
    for (let i = 0; i < 8; i++) b.push(Math.random());
    out.replays = JSON.stringify(a) === JSON.stringify(b);
    G.rng.seed(9999);
    G.rng.reseed();
    const c = [];
    for (let i = 0; i < 8; i++) c.push(Math.random());
    out.differentSeedDiffers = JSON.stringify(a) !== JSON.stringify(c);

    /* Math.randomInt is the engine's only wrapper and it reads Math.random at
       CALL time, which is why replacing Math.random seeds every roll. */
    G.rng.seed(1234); G.rng.reseed();
    const r1 = Math.randomInt(1000000);
    G.rng.reseed();
    const r2 = Math.randomInt(1000000);
    G.rng.reseed();
    out.randomIntSeeded = r1 === r2 && r1 === Math.floor(1000000 * a[0]);

    /* A reference taken before seeding keeps the real generator: that is the
       first caveat, and it is true rather than merely stated. */
    G.rng.reseed();
    const cachedA = cached();
    G.rng.reseed();
    const cachedB = cached();
    out.cachedNotSeeded = cachedA !== cachedB;
    out.caveatSaysSo = /took a reference/.test(G.rng.caveats()[0]) &&
      /never appear here/.test(G.rng.caveats()[0]);
    out.caveats = G.rng.caveats().length;

    out.drawn = G.rng.drawn() > 0;
    const rel = G.rng.release();
    out.released = rel.ok;
    out.exactFunctionBack = Math.random === nativeFn;
    out.seededOff = G.rng.seeded();
    return out;
  });
  check('the same seed replays the same sequence of numbers',
    seedRun.replaced && seedRun.replays && seedRun.differentSeedDiffers, JSON.stringify(seedRun));
  check('Math.randomInt goes through the seeded generator, because it reads Math.random at call time',
    seedRun.randomIntSeeded === true, String(seedRun.randomIntSeeded));
  check('releasing the seed restores the exact function that was taken',
    seedRun.released && seedRun.exactFunctionBack && seedRun.seededOff === false,
    JSON.stringify(seedRun));
  check('a reference taken before seeding keeps the real generator, and the panel says so rather than implying coverage',
    seedRun.cachedNotSeeded === true && seedRun.caveatSaysSo === true && seedRun.caveats === 4,
    JSON.stringify(seedRun));

  const rngCap = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    const keep = G.store.cfgGet('trace.rng.maxPerFrame', 2000);
    G.store.cfgSet('trace.rng.maxPerFrame', 5);
    G.rng.clear();
    G.rng.watch(true);
    for (let i = 0; i < 20; i++) Math.random();
    out.disarmed = G.rng.watching() === false;
    G.frame();
    const log = G.logHistory().map(e => e.msg);
    out.saidSo = log.some(m => /switched itself off/.test(m) && /Debug → RNG/.test(m));
    G.store.cfgSet('trace.rng.maxPerFrame', keep);
    G.rng.watch(false);
    G.rng.clear();
    out.cleanAfter = !G.hooks['Math.random (rng)'] && G.rng.count().session === 0;
    return out;
  });
  check('the recorder disables itself and says so when one frame rolls past the cap, instead of stalling the game',
    rngCap.disarmed && rngCap.saidSo && rngCap.cleanAfter, JSON.stringify(rngCap));

  /* =======================================================================
     5. THE PANELS
     ==================================================================== */
  const worldNames = await ev(() => window.GigaHack.ui.panelNames('world'));
  const debugNames = await ev(() => window.GigaHack.ui.panelNames('debug'));
  check('trace registers its four panels on tabs that already exist, at orders no other panel on those tabs uses',
    worldNames.indexOf('Watchpoints') === worldNames.indexOf('Recent') + 1 &&
    worldNames.indexOf('Self') > worldNames.indexOf('Watchpoints') &&
    debugNames.indexOf('Interpreters') === debugNames.indexOf('Journal') + 1 &&
    debugNames.indexOf('RNG') === debugNames.indexOf('Interpreters') + 1 &&
    debugNames.indexOf('Backups') > debugNames.indexOf('RNG'),
    worldNames.join(',') + ' || ' + debugNames.join(','));

  check('no hook in this module wraps SceneManager.updateMain on either engine',
    await ev(() => window.GigaHack.trace.report().hooks
      .every(hh => !/SceneManager/.test(hh.name) && !/updateMain/.test(hh.name))),
    JSON.stringify(await ev(() => window.GigaHack.trace.report().hooks.map(hh => hh.name))));

  await ev(() => {
    const G = window.GigaHack;
    G.watch.clear(); G.watch.clearHits();
    G.watch.add({ kind: 'var', id: 5, when: 'change' });
    $gameVariables.setValue(5, 606);
    window.__runEvent(3, 0, $dataMap.events[3].pages[0].list);
  });
  const watchText = await render('world', 'Watchpoints');
  check('the watchpoints panel says that the hold is one frame late rather than implying it caught the command',
    /NEXT frame/.test(watchText) && /already finished/.test(watchText), watchText.slice(0, 160));
  await shot('trace-watchpoints');

  const interpText = await render('debug', 'Interpreters');
  check('the interpreters panel shows both answers to "is an event running" and labels the two frame clocks',
    /isEventRunning/.test(interpText) && /engine frame/.test(interpText) && /mod frame/.test(interpText),
    interpText.slice(0, 160));
  await shot('trace-interpreters');


  const journalText = await render('debug', 'Journal');
  check('the journal panel lists what it deliberately does not see',
    /Not recorded/.test(journalText) && /self-test/.test(journalText), journalText.slice(0, 160));
  await shot('trace-journal');

  const rngText = await render('debug', 'RNG');
  check('the RNG panel states what seeding costs before anything is switched on',
    /Anything that took a reference/.test(rngText) && /stiller/.test(rngText) &&
    /Seeding is off every time the game starts/.test(rngText), rngText.slice(0, 200));
  await shot('trace-rng');

  /* --- no game world ------------------------------------------------------- */
  const noWorld = await ev(async () => {
    const G = window.GigaHack;
    const keepInterp = $gameMap._interpreter;
    const keepSystem = window.$dataSystem;
    $gameMap._interpreter = null;
    window.$dataSystem = null;
    const out = {};
    out.interpWhy = G.interp.available().why;
    const errsBefore = G.logHistory().filter(e => e.level === 'err').length;
    ['Watchpoints', 'Journal', 'Interpreters', 'RNG'].forEach(name => {
      const tab = name === 'Watchpoints' ? 'world' : 'debug';
      G.cfg.ui.tab = tab;
      G.cfg.ui.sub[tab] = name;
      G.ui.rerender();
      const root = document.querySelector('#mm-root .mm-win');
      out[name] = root ? root.textContent.length : 0;
    });
    out.errs = G.logHistory().filter(e => e.level === 'err').length - errsBefore;
    $gameMap._interpreter = keepInterp;
    window.$dataSystem = keepSystem;
    return out;
  });
  check('every panel here builds without a game world and says what it is waiting for',
    /no game world yet/.test(noWorld.interpWhy) && noWorld.errs === 0 &&
    noWorld.Watchpoints > 100 && noWorld.Journal > 100 &&
    noWorld.Interpreters > 100 && noWorld.RNG > 100, JSON.stringify(noWorld));

  /* =======================================================================
     6. PUT EVERYTHING BACK
     ==================================================================== */
  const restored = await ev(() => {
    const G = window.GigaHack, k = window.__traceKeep;
    G.watch.clear();
    G.watch.clearHits();
    G.journal.clear();
    G.rng.clear();
    if (G.rng.watching() || G.rng.seeded()) G.rng.release();
    G.undo.clear();
    window.__runNothing();
    $gameMap._interpreter._list = k.mapInterpList;
    $gameMap._interpreter._index = k.mapInterpIndex;
    k.vars.forEach(p => $gameVariables.setValue(p[0], p[1]));
    k.switches.forEach(p => $gameSwitches.setValue(p[0], p[1]));
    k.self.forEach(p => $gameSelfSwitches.setValue(p[0], p[1]));
    $gameMap._commonEvents.forEach(c => c.refresh());
    $gameMessage.clear();
    G.store.cfgSet('behaviour.pauseGame', k.pause);
    G.cfg.ui.tab = k.tab;
    G.ui.setOpen(k.open);
    G.ui.rerender();
    return {
      points: G.watch.list().length,
      hits: G.watch.hits().length,
      rngHook: !!G.hooks['Math.random (rng)'],
      native: /\[native code\]/.test(Function.prototype.toString.call(Math.random)),
      paused: !!(G.cfg.behaviour && G.cfg.behaviour.pauseGame),
      demand: G.watch.demand(),
      vars: k.vars.every(p => $gameVariables.value(p[0]) === p[1]),
      switches: k.switches.every(p => $gameSwitches.value(p[0]) === p[1]),
      self: k.self.every(p => $gameSelfSwitches.value(p[0]) === p[1]),
      events: $gameMap.events().length
    };
  });
  check('trace leaves the game exactly as it found it — no watchpoints, no hold, no hook on Math.random',
    restored.points === 0 && restored.hits === 0 && restored.rngHook === false &&
    restored.native === true && restored.paused === false && restored.demand === 0 &&
    restored.vars && restored.switches && restored.self && restored.events === 3,
    JSON.stringify(restored));
};
