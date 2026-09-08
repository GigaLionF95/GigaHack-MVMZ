/*
 * GigaHack_Quest.js — checks.
 *
 * Four panels, and every one of them exists because the engine records less
 * than the player assumes. So these checks are mostly about the DIFFERENCE
 * between what the engine stores and what a menu is tempted to say:
 *
 *   · which of the six stored page conditions failed, when the engine records
 *     only one boolean for all six;
 *   · which page RUNS, when a fully satisfied page can be permanently shadowed
 *     by a later one;
 *   · that our own reading of the six can disagree with the engine's, and that
 *     the disagreement is reported rather than papered over;
 *   · that "who sets this" and "who calls this" join a live scan to the boot
 *     index, because the index walked map events and nothing else;
 *   · that a common event's reservation shape is probed, never assumed from
 *     the engine name.
 *
 * Every check restores what it changed: a later check must not inherit a
 * flipped switch, an erased event, a mounted filesystem or a reservation.
 */
module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ;

  /* ---------------------------------------------------------------- helpers */
  const openPanel = async (sub) => ev((s) => {
    const G = window.GigaHack;
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = s;
    G.ui.rerender();
    const body = document.querySelector('#mm-root .mm-body');
    return body ? body.textContent : '';
  }, sub);

  const WATCHED = [1, 5, 7, 9, 21, 22, 23, 141, 142, 143, 144, 145, 146, 731, 732, 733, 734];
  const before = await ev((ids) => {
    const G = window.GigaHack;
    return {
      sub: (G.cfg.ui.sub || {}).world || '',
      tab: G.cfg.ui.tab,
      open: G.ui.isOpen(),
      undo: G.undo.size(),
      events: $gameMap.events().length,
      switches: ids.filter(id => $gameSwitches.value(id)),
      gatedOnly: G.store.cfgGet('quest.common.gatedOnly', false)
    };
  }, WATCHED);

  /* =======================================================================
     PANEL REGISTRATION
     ==================================================================== */
  const panels = await ev(() => {
    const G = window.GigaHack;
    // The registry is sorted by order, so the list order IS the sort answer.
    return G.ui.panelNames('world');
  });
  const mine = ['Blocked', 'Common', 'Quests', 'Script'];
  check('the four Quest panels sort after every panel already on the World tab',
    mine.every(n => panels.indexOf(n) > -1) &&
    panels.indexOf('Blocked') === panels.length - 4 &&
    panels.indexOf('Script') === panels.length - 1,
    panels.join(','));
  check('and none of their orders collides with one already taken on that tab',
    new Set(panels).size === panels.length &&
    panels.indexOf('Blocked') > panels.indexOf('Gallery'),
    panels.join(','));

  check('registering the Quests panel from the boot scene and again from a game world ' +
    'being built leaves one panel, not two',
    await ev(() => {
      const G = window.GigaHack;
      G.emit('gameobjects');
      const names = G.ui.panelNames('world');
      return names.filter(n => n === 'Quests').length === 1;
    }));

  /* =======================================================================
     THE SIX STORED PAGE CONDITIONS

     Event 5 ("warden") is the fixture's all-six-fields-at-once page, so the
     decoder is exercised end to end rather than one field at a time.
     ==================================================================== */
  /* The four extra events are brought to life ONLY around the checks that need
     them, and put back immediately after. Event 4 is an AUTORUN page that arms
     itself on the refresh that creates it, so leaving it on the map holds the
     game for every check that runs later. */
  const six = await ev(() => {
    const G = window.GigaHack;
    window.__addMapEvents();
    const ev5 = $gameMap.event(5);
    const rows = G.quest.conditions(ev5, 0);
    return {
      kinds: rows.map(r => r.kind),
      byKind: rows.reduce((a, r) => { a[r.kind] = r; return a; }, {}),
      count: rows.length
    };
  });
  check('a page condition is decoded into the value now and the value needed, and both are shown',
    six.count === 6 &&
    six.kinds.join(',') === 'switch1,switch2,variable,selfswitch,item,actor' &&
    Object.keys(six.byKind).every(k => {
      const r = six.byKind[k];
      return typeof r.nowText === 'string' && r.nowText.length > 0 &&
        typeof r.needText === 'string' && r.needText.length > 0;
    }),
    JSON.stringify(six.kinds));

  check('an unmet switch condition names the switch by the project\'s own name for it, ' +
    'not by id alone',
    /^Switch \d+ ".+"$/.test(six.byKind.switch1.label) && six.byKind.switch1.met === false,
    six.byKind.switch1.label + ' — ' + six.byKind.switch1.nowText);

  /* The engine's variable test is `>=`, so equal already satisfies it. A menu
     that wrote value+1 would overshoot and one that tested `>` would report a
     satisfied page as blocked. */
  const varTest = await ev(() => {
    const G = window.GigaHack;
    const ev5 = $gameMap.event(5);
    const c = ev5.event().pages[0].conditions;
    const was = $gameVariables.value(c.variableId);
    const out = {};
    $gameVariables.setValue(c.variableId, c.variableValue - 1);
    out.below = G.quest.conditions(ev5, 0).filter(r => r.kind === 'variable')[0].met;
    $gameVariables.setValue(c.variableId, c.variableValue);
    const eq = G.quest.conditions(ev5, 0).filter(r => r.kind === 'variable')[0];
    out.equal = eq.met;
    out.need = eq.need;
    out.fixValue = eq.fixValue;
    $gameVariables.setValue(c.variableId, was);
    return out;
  });
  check('a variable condition is met when the live value equals the needed one, because the ' +
    'engine\'s test is >= and not >',
    varTest.below === false && varTest.equal === true, JSON.stringify(varTest));
  check('and the one-click fix writes exactly the value the condition needs, never one past it',
    varTest.fixValue === varTest.need, JSON.stringify(varTest));

  /* A self switch stored as the NUMBER 1 rather than `true`. The editor never
     writes that, but JsonEx round-trips and third-party save editors both do.
     The engine's accessor coerces, so anything comparing the RAW stored value
     against `true` disagrees with the engine about a key the engine considers
     on — and would then report a disagreement that does not exist. */
  const selfSw = await ev(() => {
    const G = window.GigaHack;
    const ev5 = $gameMap.event(5);
    const key = [ev5._mapId, 5, 'B'];
    const had = $gameSelfSwitches._data[key];
    $gameSelfSwitches._data[key] = 1;
    const row = G.quest.conditions(ev5, 0).filter(r => r.kind === 'selfswitch')[0];
    const out = {
      met: row.met, nowText: row.nowText,
      raw: JSON.stringify($gameSelfSwitches._data[key]),
      accessor: $gameSelfSwitches.value(key),
      engine: ev5.meetsConditions({
        conditions: Object.assign({}, ev5.event().pages[0].conditions, {
          switch1Valid: false, switch2Valid: false, variableValid: false,
          itemValid: false, actorValid: false
        })
      })
    };
    if (had === undefined) delete $gameSelfSwitches._data[key];
    else $gameSelfSwitches._data[key] = had;
    return out;
  });
  check('a self-switch condition is read through the engine\'s own accessor, so a value stored ' +
    'as 1 rather than true is read exactly as the engine reads it',
    selfSw.met === true && selfSw.engine === true && selfSw.raw === '1',
    JSON.stringify(selfSw));
  check('and the row still names the raw value it found, because the engine coerces and a ' +
    'plugin that replaced the accessor would not',
    selfSw.nowText.indexOf('stored as 1') > -1, selfSw.nowText);

  /* The key is [event._mapId, eventId, ch]. An event a plugin spawned from
     another map's data carries a different _mapId, and a key built from
     $gameMap.mapId() then addresses an entirely different self-switch. */
  const spawned = await ev(() => {
    const G = window.GigaHack;
    const ev5 = $gameMap.event(5);
    const here = $gameMap.mapId();
    const was = ev5._mapId;
    const other = here + 900;
    // The key for the map you are STANDING on is on; the key for the map this
    // event claims to come from is not. A menu that built the key from
    // $gameMap.mapId() would read the first and call the page satisfied.
    const hereKey = [here, 5, 'B'];
    const hadHere = $gameSelfSwitches._data[hereKey];
    $gameSelfSwitches._data[hereKey] = true;
    ev5._mapId = other;                    // as if spawned from another map's data
    const row = G.quest.conditions(ev5, 0).filter(r => r.kind === 'selfswitch')[0];
    const out = { met: row.met, label: row.label, why: row.why, here, other };
    ev5._mapId = was;
    if (hadHere === undefined) delete $gameSelfSwitches._data[hereKey];
    else $gameSelfSwitches._data[hereKey] = hadHere;
    return out;
  });
  check('the self-switch key is built from the event\'s own map id, so an event spawned from ' +
    'another map\'s data is not read against the wrong key',
    spawned.met === false && spawned.label.indexOf('map ' + spawned.other) > -1,
    JSON.stringify(spawned));
  check('and the row says the event carries a map id that is not the map you are on',
    spawned.why.indexOf('map id ' + spawned.other) > -1, spawned.why);

  /* itemValid asks hasItem(item) with includeEquip FALSE. A copy that exists
     only in an equip slot does not satisfy the page — the case a player hits
     and blames on the menu. */
  const itemCond = await ev(() => {
    const G = window.GigaHack;
    const ev5 = $gameMap.event(5);
    const c = ev5.event().pages[0].conditions;
    const held = $gameParty._items[c.itemId];
    const out = {};
    out.whenHeld = G.quest.conditions(ev5, 0).filter(r => r.kind === 'item')[0];
    delete $gameParty._items[c.itemId];
    // A plugin that makes an item equippable is exactly the modelled case.
    const wasFn = $gameParty.isAnyMemberEquipped;
    $gameParty.isAnyMemberEquipped = function () { return true; };
    out.whenWorn = G.quest.conditions(ev5, 0).filter(r => r.kind === 'item')[0];
    $gameParty.isAnyMemberEquipped = wasFn;
    $gameParty._items[c.itemId] = held;
    return out;
  });
  check('an item condition is unmet when the only copy is worn in an equip slot, because the ' +
    'engine asks hasItem without includeEquip',
    itemCond.whenHeld.met === true && itemCond.whenWorn.met === false,
    itemCond.whenHeld.nowText + ' / ' + itemCond.whenWorn.nowText);
  check('and it says which of the two it is rather than only that the item is missing',
    itemCond.whenWorn.nowText === 'equipped, not held' &&
    itemCond.whenWorn.why.indexOf('equip slot') > -1,
    itemCond.whenWorn.nowText + ' — ' + itemCond.whenWorn.why);

  check('an item or actor condition offers no one-click fix and names the panel that satisfies ' +
    'it instead',
    await ev(() => {
      const G = window.GigaHack;
      const rows = G.quest.conditions($gameMap.event(5), 0);
      const item = rows.filter(r => r.kind === 'item')[0];
      const actor = rows.filter(r => r.kind === 'actor')[0];
      return item.fixable === null && actor.fixable === null;
    }));

  /* =======================================================================
     WHICH PAGE RUNS
     ==================================================================== */
  const shadow = await ev(() => {
    const G = window.GigaHack;
    // Event 6 ("statue"): pages 2 AND 3 both key on switch 9.
    const was = $gameSwitches.value(9);
    $gameSwitches.setValue(9, true);
    const e6 = $gameMap.event(6);
    e6.refresh();
    const st = G.quest.pageStates(e6);
    $gameSwitches.setValue(9, was);
    e6.refresh();
    return st;
  });
  check('the active page is the highest-numbered page whose conditions are met',
    shadow.ourActive === 2 && shadow.engineActive === 2 && shadow.agrees === true,
    JSON.stringify({ ours: shadow.ourActive, engine: shadow.engineActive }));
  check('and a lower page with every condition met is reported as shadowed rather than as blocked',
    shadow.pages[1].state === 'shadowed' && shadow.pages[1].shadowedBy === 2 &&
    shadow.pages[0].state === 'shadowed',
    shadow.pages.map(p => p.index + ':' + p.state).join(' '));

  const erased = await ev(() => {
    const G = window.GigaHack;
    const e = $gameMap.event(6);
    window.__eraseEvent(6);
    const st = G.quest.pageStates(e);
    e._erased = false;
    e.refresh();
    return { erasedFlag: st.erased, engine: st.engineActive, ours: st.ourActive, states: st.pages.map(p => p.state) };
  });
  check('an erased event says no page runs at all, which is a different line from no page\'s ' +
    'conditions being met',
    erased.erasedFlag === true && erased.engine === -1 && erased.ours === -1 &&
    erased.states.every(s => s === 'erased'),
    JSON.stringify(erased));

  /* A plugin that replaces the page test decides pages by something the six
     stored fields do not describe. Our answer then differs from the engine's,
     and that difference is the finding. */
  const disagree = await ev(() => {
    const G = window.GigaHack;
    const e = $gameMap.event(6);
    // Exactly what a replaced meetsConditions looks like from here.
    e.meetsConditions = function () { return false; };
    e.refresh();
    const st = G.quest.pageStates(e);
    delete e.meetsConditions;
    e.refresh();
    return { agrees: st.agrees, engine: st.engineActive, ours: st.ourActive };
  });
  check('when the engine\'s active page disagrees with the six stored fields, the module reports ' +
    'the disagreement instead of insisting on its own answer',
    disagree.agrees === false && disagree.engine === -1 && disagree.ours === 0,
    JSON.stringify(disagree));

  /* =======================================================================
     THE BLOCKED PANEL
     ==================================================================== */
  await ev(() => {
    const G = window.GigaHack;
    if (G.events && G.events.select) G.events.select(5);
    G.store.cfgSet('quest.blocked.showMetPages', true);
  });
  const blockedText = await openPanel('Blocked');

  check('the panel names both answers when they disagree, and says they agree when they do',
    blockedText.indexOf('the six stored conditions agree') > -1, blockedText.slice(0, 120));
  check('the panel states that the six stored fields are all there is and that a plugin can add ' +
    'conditions through note tags that nothing here can see',
    blockedText.indexOf('note tags') > -1 && blockedText.indexOf('six stored fields') > -1);
  check('a blocked page says how many of its conditions are unmet, not merely that it is blocked',
    /blocked by \d+ of \d+ condition/.test(blockedText), /blocked by[^.]*/.exec(blockedText));

  const disagreeText = await ev(() => {
    const G = window.GigaHack;
    // Event 6's first page has no conditions, so the six stored fields say it
    // runs while the replaced page test says nothing does.
    if (G.events && G.events.select) G.events.select(6);
    const e = $gameMap.event(6);
    e.meetsConditions = function () { return false; };
    e.refresh();
    G.ui.rerender();
    const body = document.querySelector('#mm-root .mm-body');
    const txt = body ? body.textContent : '';
    delete e.meetsConditions;
    e.refresh();
    if (G.events && G.events.select) G.events.select(5);
    G.ui.rerender();
    return txt;
  });
  check('and it names both answers in words — the engine\'s page and the one the stored fields give',
    disagreeText.indexOf('Something is deciding pages that these fields do not describe') > -1 &&
    /The engine has page \d+ active; by the six stored conditions it should be page/.test(disagreeText),
    /The engine has page[^.]*\./.exec(disagreeText));

  /* The fix button routes through Vars, which routes through the switches.set
     compat control, so the write is verified and undoable. */
  const fixSwitch = await ev(() => {
    const G = window.GigaHack;
    const c = $gameMap.event(5).event().pages[0].conditions;
    const wasOn = $gameSwitches.value(c.switch1Id);
    const undoBefore = G.undo.size();
    const rows = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'));
    const btn = rows.filter(b => b.textContent === 'set it' && !b.classList.contains('mm-dis'))[0];
    if (!btn) return { found: false };
    btn.click(); btn.click();                 // danger buttons arm, then fire
    const out = {
      found: true, on: $gameSwitches.value(c.switch1Id),
      undoDelta: G.undo.size() - undoBefore,
      gated: btn.classList.contains('mm-gated')
    };
    if (!wasOn && out.on) G.undo.pop();
    return out;
  });
  check('a one-click fix for a switch condition writes through the switches.set control and ' +
    'leaves exactly one undo entry',
    fixSwitch.found === true && fixSwitch.on === true && fixSwitch.undoDelta === 1,
    JSON.stringify(fixSwitch));
  check('and the fix button is marked as one the read-only gate will refuse',
    fixSwitch.gated === true, String(fixSwitch.gated));

  /* A control whose writes do not stick is MARKED and keeps its reason. It is
     never hidden and never made inert — the cause may have gone away, and the
     only way to find out is to let the user try. */
  const degradedFix = await ev(() => {
    const G = window.GigaHack;
    const was = G.compat.isDegraded('switches.set');
    // Drive the real path: a write the engine refuses marks the control.
    const spy = $gameSwitches.setValue;
    $gameSwitches.setValue = function () { };
    G.vars.setSwitch(9, true, 'harness degrade probe');
    $gameSwitches.setValue = spy;
    G.ui.rerender();
    const btns = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'))
      .filter(b => b.textContent === 'set it');
    const marked = btns.filter(b => (b.getAttribute('data-mm-tip') || '').indexOf('Not sticking') === 0);
    const body = document.querySelector('#mm-root .mm-body');
    const out = {
      degraded: G.compat.isDegraded('switches.set'),
      buttons: btns.length,
      marked: marked.length,
      reasoned: marked.filter(b => (b.getAttribute('data-mm-tip') || '').length > 20).length,
      inert: marked.filter(b => b.classList.contains('mm-dis')).length,
      note: body ? body.textContent.indexOf('writes here are not sticking') > -1 : false,
      wasDegraded: was
    };
    if (!was) G.compat.clearDegraded('switches.set');
    return out;
  });
  check('with switches.set degraded the fix button is marked and keeps its reason, and is not ' +
    'hidden or made inert',
    degradedFix.degraded === true && degradedFix.buttons > 0 &&
    degradedFix.marked > 0 && degradedFix.marked === degradedFix.reasoned &&
    degradedFix.inert === 0,
    JSON.stringify(degradedFix));
  check('and only the switch fixes are marked, because a variable fix writes through a different ' +
    'control and libelling it would be a second wrong answer',
    degradedFix.marked < degradedFix.buttons, JSON.stringify(degradedFix));
  check('and the panel offers the "try again" note, because the cause may have gone away',
    degradedFix.note === true, String(degradedFix.note));

  // Put the map back before anything else looks at it.
  await ev(() => {
    const G = window.GigaHack;
    window.__removeMapEvents();
    if (G.events && G.events.select) G.events.select(0);
    G.ui.rerender();
  });
  check('and the four extra events are off the map again, so the autorun page they include is not ' +
    'left holding the game',
    await ev(() => $gameMap.events().length === 3 && !$gameMap.isEventRunning()));

  /* =======================================================================
     WHO SETS THIS
     ==================================================================== */
  const sources = await ev(() => {
    const G = window.GigaHack;
    // Switch 301 is written by a TROOP page and switch 7 by a map event; the
    // boot index walked neither troops nor common events.
    const troop = G.quest.sourcesOf('switch', 301);
    const map = G.quest.sourcesOf('switch', 7);
    const varCommon = G.quest.sourcesOf('variable', 9);
    return {
      troopScopes: troop.candidates.map(c => c.scope),
      mapScopes: map.candidates.map(c => c.scope),
      commonScopes: varCommon.candidates.map(c => c.scope),
      complete: map.complete, why: map.why,
      scopes: map.scopes.map(s => s.key + '=' + (s.complete ? 'live' : s.why))
    };
  });
  const blindSources = await ev(() => {
    const G = window.GigaHack;
    // A build with no filesystem: the index never read the other maps at all.
    const real = G.events.findTouching;
    G.events.findTouching = function () {
      return {
        candidates: [], complete: false,
        why: 'there is no filesystem on this build, so no other map was searched.'
      };
    };
    const r = G.quest.sourcesOf('switch', 7);
    G.events.findTouching = real;
    return {
      complete: r.complete, why: r.why, found: r.candidates.length,
      other: r.scopes.filter(s => s.key === 'other')[0],
      live: r.scopes.filter(s => s.complete).map(s => s.key)
    };
  });
  check('who sets this lists troop pages, which the boot index never walked',
    sources.troopScopes.indexOf('troop') > -1, sources.troopScopes.join(','));
  check('and common events, which the boot index never walked either',
    sources.commonScopes.indexOf('common') > -1, sources.commonScopes.join(','));
  check('and the loaded map, read live rather than through the index',
    sources.mapScopes.indexOf('map') > -1, sources.mapScopes.join(','));
  check('who sets this on a build that could not read the other maps says so, and never returns ' +
    'a list with no reason attached',
    blindSources.complete === false &&
    blindSources.why.indexOf('other maps') > -1 && blindSources.why.length > 30 &&
    blindSources.found > 0,
    blindSources.why);
  check('and the three sources the index never walked are still answered live, so the short list ' +
    'is not presented as the whole one',
    blindSources.live.join(',') === 'map,common,troop' &&
    blindSources.other.complete === false,
    blindSources.live.join(','));
  check('the scope of every half of that answer is stated whether it was complete or not',
    sources.scopes.length === 4 &&
    sources.scopes.filter(s => /^(map|common|troop)=live$/.test(s)).length === 3,
    sources.scopes.join(' · '));

  const liveRow = await ev(() => {
    const G = window.GigaHack;
    const e = $gameMap.event(2);        // the baker writes switch 7
    const wasX = e._x, wasY = e._y;
    e.locate(wasX + 1, wasY);
    const row = G.quest.sourcesOf('switch', 7).candidates.filter(c => c.eventId === 2)[0];
    e.locate(wasX, wasY);
    return { x: row.x, y: row.y, wasX, wasY, moved: row.moved, here: row.here };
  });
  check('a source row on the map you are standing on carries the live coordinates, not the ' +
    'ones the data file was written with',
    liveRow.here === true && liveRow.x === liveRow.wasX + 1 && liveRow.moved === true,
    JSON.stringify(liveRow));

  /* =======================================================================
     COMMON EVENTS
     ==================================================================== */
  const commons = await ev(() => window.GigaHack.quest.commons());
  const byId = {};
  commons.forEach(r => { byId[r.id] = r; });

  check('every common event the project ships is listed with its trigger and its gate switch, ' +
    'including the ones with no commands',
    commons.length === 9 && byId[8] && byId[8].commands === 0 &&
    commons.every(r => typeof r.triggerName === 'string' && 'switchId' in r),
    commons.map(r => r.id + ':' + r.triggerName).join(' '));

  check('a common event whose trigger is called-only shows no gate switch and says why',
    byId[1].trigger === 0 && byId[1].gated === false && byId[1].switchOn === false,
    JSON.stringify({ trigger: byId[1].trigger, gated: byId[1].gated }));

  const gateText = await openPanel('Common');
  check('and the panel says it in words rather than leaving the gate row blank',
    gateText.indexOf('none — it is called, never triggered') > -1 ||
    gateText.indexOf('called, never triggered') > -1,
    gateText.indexOf('called, never triggered') > -1);

  const unsetGate = await ev(() => {
    const G = window.GigaHack;
    G.store.cfgSet('quest.common.selected', 7);
    G.ui.rerender();
    const body = document.querySelector('#mm-root .mm-body');
    const row = G.quest.commons().filter(r => r.id === 7)[0];
    const toggles = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-cbrow'))
      .filter(t => t.textContent.trim() === 'gate switch');
    return {
      trigger: row.trigger, switchId: row.switchId,
      text: body ? body.textContent : '',
      toggles: toggles.length,
      disabled: toggles.length ? toggles[0].querySelector('.mm-check').classList.contains('mm-dis') : null,
      tip: (toggles.length ? toggles[0].getAttribute('data-mm-tip') : '') || ''
    };
  });
  check('a gate switch of zero on an autorun or parallel common event is named as the reason it ' +
    'never fires',
    unsetGate.trigger === 1 && unsetGate.switchId === 0 &&
    unsetGate.text.indexOf('unset (0)') > -1 &&
    unsetGate.tip.indexOf('The editor left this unset') > -1 &&
    unsetGate.disabled === true,
    JSON.stringify({ tip: unsetGate.tip, disabled: unsetGate.disabled }));

  const gateWrite = await ev(() => {
    const G = window.GigaHack;
    G.store.cfgSet('quest.common.selected', 2);      // Parallel, gate switch 5
    G.ui.rerender();
    const undoBefore = G.undo.size();
    const row = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-cbrow'))
      .filter(t => t.textContent.trim() === 'gate switch')[0];
    if (!row) return { found: false };
    row.querySelector('.mm-check').click();
    const out = {
      found: true, on: $gameSwitches.value(5),
      undoDelta: G.undo.size() - undoBefore,
      marked: row.classList.contains('mm-gated')
    };
    if (out.on) { G.undo.pop(); }
    return out;
  });
  check('toggling a gate switch goes through the switches.set control and leaves one undo entry',
    gateWrite.found === true && gateWrite.on === true && gateWrite.undoDelta === 1 &&
    gateWrite.marked === true,
    JSON.stringify(gateWrite));

  const refusals = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    out.empty = G.quest.whyNotRunnable(8);
    out.missing = G.quest.whyNotRunnable(9999);
    const was = $gameSwitches.value(5);
    $gameSwitches.setValue(5, true);
    out.parallelOn = G.quest.whyNotRunnable(2);
    $gameSwitches.setValue(5, was);
    const was22 = $gameSwitches.value(22);
    $gameSwitches.setValue(22, true);
    out.autorunOn = G.quest.whyNotRunnable(5);
    $gameSwitches.setValue(22, was22);
    out.runnable = G.quest.whyNotRunnable(1);
    return out;
  });
  check('run it now refuses a parallel common event whose gate switch is on, and says the engine ' +
    'is already running it every frame',
    /Parallel/.test(refusals.parallelOn) && /every frame/.test(refusals.parallelOn),
    refusals.parallelOn);
  check('and refuses an autorun one whose gate is on, naming the interpreter that has it',
    /Autorun/.test(refusals.autorunOn) && /interpreter/.test(refusals.autorunOn),
    refusals.autorunOn);
  check('run it now refuses a common event with no commands, and refuses one that does not exist',
    refusals.empty === 'this common event has no commands' &&
    refusals.missing === 'there is no common event with that id' &&
    refusals.runnable === null,
    JSON.stringify(refusals));

  /* The reservation shape is probed from WHICH ACCESSOR the build has, never
     from the engine name — and the two builds genuinely differ. */
  const shape = await ev(() => {
    const G = window.GigaHack;
    return {
      shape: G.quest.reserveShape(),
      hasRetrieve: typeof $gameTemp.retrieveCommonEvent === 'function',
      hasReserved: typeof $gameTemp.reservedCommonEvent === 'function'
    };
  });
  check('the reservation shape is decided by which accessor the build has, never by which engine ' +
    'it is',
    shape.shape.queue === shape.hasRetrieve &&
    (shape.hasRetrieve || shape.hasReserved),
    JSON.stringify(shape));
  check('the queue accessor is present exactly on the engine that has it',
    IS_MZ ? (shape.hasRetrieve === true && shape.hasReserved === false)
      : (shape.hasRetrieve === false && shape.hasReserved === true),
    JSON.stringify({ retrieve: shape.hasRetrieve, reserved: shape.hasReserved }));

  const runIt = await ev(() => {
    const G = window.GigaHack;
    const out = { first: G.quest.runCommon(1), reserved: $gameTemp.isCommonEventReserved() };
    // The single-slot build must REFUSE a second reservation rather than
    // discarding the first with no error; the queue build appends.
    out.secondWhy = G.quest.whyNotRunnable(3);
    out.second = out.secondWhy ? false : G.quest.runCommon(3);
    if ($gameTemp.clearCommonEventReservation) $gameTemp.clearCommonEventReservation();
    else if ($gameTemp.clearCommonEvent) $gameTemp.clearCommonEvent();
    out.cleared = $gameTemp.isCommonEventReserved();
    return out;
  });
  check('run it now reserves through the engine\'s own path and reads back that the engine ' +
    'accepted the reservation',
    runIt.first === true && runIt.reserved === true && runIt.cleared === false,
    JSON.stringify(runIt));
  check('on a build that holds one reserved common event at a time a second run is refused, and ' +
    'on a build that queues them it is not',
    IS_MZ ? (runIt.secondWhy === null && runIt.second === true)
      : (typeof runIt.secondWhy === 'string' && /one reserved common event at a time/.test(runIt.secondWhy)),
    JSON.stringify({ why: runIt.secondWhy, second: runIt.second }));

  const decoded = await ev(() => {
    const G = window.GigaHack;
    const mineRows = G.quest.decodeCommon(9);
    // The same decoder the event inspector uses, so an unknown code reads
    // identically in both.
    const theirs = mineRows.map(r => G.events.describe(r.raw));
    const unknown = G.events.describe({ code: 9999, parameters: [1, 2] });
    const oursUnknown = G.quest.decodeCommon(9).length ? G.events.describe({ code: 9999, parameters: [1, 2] }) : '';
    return {
      same: mineRows.every((r, i) => r.text === theirs[i]),
      first: mineRows[0] ? mineRows[0].text : '',
      unknown, oursUnknown
    };
  });
  check('the decoded command list uses the same decoder the event inspector uses, so an unknown ' +
    'code reads identically in both',
    decoded.same === true && decoded.unknown === decoded.oursUnknown &&
    /Common Event 3/.test(decoded.first),
    JSON.stringify(decoded).slice(0, 200));

  const callers = await ev(() => {
    const G = window.GigaHack;
    G.store.cfgSet('quest.common.selected', 3);
    G.ui.rerender();
    const btn = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-btn'))
      .filter(b => b.textContent === 'who calls this')[0];
    if (!btn) return { found: false };
    btn.click();
    const body = document.querySelector('#mm-root .mm-body');
    return {
      found: true,
      hits: G.quest.callersOf(3).map(c => c.scope + ':' + (c.commonId || c.eventId)),
      text: body ? body.textContent : ''
    };
  });
  check('who calls this finds the common event and the map event that call it',
    callers.hits.indexOf('common:9') > -1 && callers.hits.indexOf('map:3') > -1,
    callers.hits.join(' '));
  check('and says events on other maps are not covered, because the index records the switches ' +
    'an event touches and not the common events it calls',
    callers.text.indexOf('Events on other maps are not covered') > -1 &&
    callers.text.indexOf('not the common events it calls') > -1);

  /* The counter reads the id from whichever place THIS build puts it. Reading
     one shape counts nothing at all on the other, and counting nothing looks
     exactly like a common event that never runs. */
  const counted = await ev(() => {
    const G = window.GigaHack;
    const before = G.quest.commons().filter(r => r.id === 3)[0].ran;
    // Driven through the engine's own interpreter, so the parameters arrive
    // the way this build delivers them.
    window.__runEvent(3, 0, $dataMap.events[3].pages[0].list);
    $gameMap._interpreter.executeCommand();
    const after = G.quest.commons().filter(r => r.id === 3)[0].ran;
    window.__runNothing();
    return { before, after };
  });
  check('the run counter reads the common event id from the argument where the build passes one ' +
    'and from the interpreter\'s own params where it does not',
    counted.before !== null && counted.after === counted.before + 1,
    JSON.stringify(counted));

  const noCounter = await ev(() => {
    const G = window.GigaHack;
    const rec = G.hooks['Game_Interpreter.command117 (quest)'];
    const owner = rec.owner, method = rec.method, patched = rec.patched;
    rec.unpatch();
    const row = G.quest.commons().filter(r => r.id === 3)[0];
    G.store.cfgSet('quest.common.selected', 3);
    G.ui.rerender();
    const body = document.querySelector('#mm-root .mm-body');
    const out = { ran: row.ran, text: body ? body.textContent : '' };
    owner[method] = patched;               // put the hook back exactly as it was
    rec.installed = true;
    return out;
  });
  check('with the command117 hook absent the Common panel says the run count is not being ' +
    'counted, and gives the reason rather than reporting zero runs',
    noCounter.ran === null &&
    noCounter.text.indexOf('not counted — ') > -1 &&
    noCounter.text.indexOf('Debug → Hooks') > -1,
    /not counted — [^A-Z]{0,90}/.exec(noCounter.text));
  check('and a count of zero is qualified, because an autorun or parallel common event never ' +
    'passes through the counter at all',
    await ev(() => {
      const G = window.GigaHack;
      G.store.cfgSet('quest.common.selected', 4);      // autorun, never explicitly called
      G.ui.rerender();
      const body = document.querySelector('#mm-root .mm-body');
      const txt = body ? body.textContent : '';
      return /Only an explicit Call Common Event passes through the counter/.test(txt) &&
        /0 here does not mean it never ran/.test(txt);
    }));
  check('the hook is back in place afterwards, so nothing later inherits a missing counter',
    await ev(() => window.GigaHack.hooks['Game_Interpreter.command117 (quest)'].installed === true &&
      Game_Interpreter.prototype.command117 === window.GigaHack.hooks['Game_Interpreter.command117 (quest)'].patched));

  check('only a parallel common event has a live object, because an autorun one runs on the map\'s ' +
    'own interpreter and appears in no live list',
    await ev(() => {
      const G = window.GigaHack;
      const rows = G.quest.commons();
      const parallels = rows.filter(r => r.trigger === 2);
      const autoruns = rows.filter(r => r.trigger === 1);
      return parallels.every(r => r.hasObject === true) && autoruns.every(r => r.hasObject === false);
    }));

  /* =======================================================================
     THE INFERENCE
     ==================================================================== */
  const groups = await ev(() => window.GigaHack.quest.quests());
  check('a run of a thousand switches sharing a one-token stem produces no group, because a stem ' +
    'needs two shared leading tokens and an ordinal tail',
    groups.every(g => !/^(sw|var)$/.test(g.title)) &&
    groups.filter(g => g.from === 'stem').length === 2,
    groups.map(g => g.from + ':' + g.title + '×' + g.total).join(' '));

  check('every quest group carries the sentence saying what it was inferred from',
    groups.length > 0 && groups.every(g => typeof g.evidence === 'string' &&
      g.evidence.indexOf('inferred from') === 0),
    groups.map(g => g.evidence).join(' | ').slice(0, 200));

  const sectionOnly = await ev(() => {
    const G = window.GigaHack;
    const only = G.quest.infer({ groupBy: 'section' });
    return {
      titles: only.map(g => g.title),
      sizes: only.map(g => g.total),
      names: only.map(g => g.steps.map(s => s.name)),
      evidence: only.map(g => g.evidence),
      bulk: G.quest.bulk.tokens,
      bulkShare: G.quest.bulk.tokens.map(t => Math.round(G.quest.bulk.map[t] / G.quest.bulk.total * 100))
    };
  });
  check('a run of flags carrying the project\'s own placeholder naming produces no group, because ' +
    'a leading token a quarter of the project shares is a placeholder and not a name',
    sectionOnly.bulk.indexOf('sw') > -1 && sectionOnly.bulk.indexOf('var') > -1 &&
    sectionOnly.bulkShare.every(p => p >= 25) &&
    sectionOnly.sizes.every(n => n <= 5),
    JSON.stringify({ bulk: sectionOnly.bulk, share: sectionOnly.bulkShare, sizes: sectionOnly.sizes }));
  check('and the sections that hold real names keep exactly those members, so the rule drops the ' +
    'noise rather than the feature',
    sectionOnly.titles.length === 2 &&
    sectionOnly.names.every(list => list.every(n => !/^(sw|var)_/.test(n))) &&
    sectionOnly.evidence.every(e => /placeholder naming and say nothing/.test(e)),
    JSON.stringify(sectionOnly.names));

  const order = await ev(() => {
    const G = window.GigaHack;
    const sw = $dataSystem.switches;
    const a = sw[142], b = sw[146];
    // The same chain, with its first and last step swapped between ids: a
    // project that inserted a step later gave it a higher id, and id order
    // then tells the story backwards.
    sw[142] = b; sw[146] = a;
    const g = G.quest.infer().filter(x => x.key === 'stem:quest bakery')[0];
    const out = g ? { ids: g.steps.map(s => s.id), names: g.steps.map(s => s.name) } : { ids: [] };
    sw[142] = a; sw[146] = b;
    G.quest.reinfer();
    return out;
  });
  check('a step chain orders by the number at the end of the name and not by id',
    order.ids.length === 5 && order.ids[0] === 146 && order.ids[4] === 142 &&
    /_1$/.test(order.names[0]) && /_5$/.test(order.names[4]),
    JSON.stringify(order));

  const current = await ev(() => {
    const G = window.GigaHack;
    const ids = G.quest.quests().filter(g => g.key === 'stem:quest bakery')[0].steps.map(s => s.id);
    $gameSwitches.setValue(ids[0], true);
    $gameSwitches.setValue(ids[1], true);
    const g = G.quest.reinfer().filter(x => x.key === 'stem:quest bakery')[0];
    const out = { done: g.done, current: g.current, next: g.next ? g.next.id : 0, expect: ids[2] };
    ids.forEach(id => $gameSwitches.setValue(id, false));
    G.quest.reinfer();
    return out;
  });
  check('a group\'s current step is the first one not done',
    current.done === 2 && current.current === 2 && current.next === current.expect,
    JSON.stringify(current));

  const questsText = await openPanel('Quests');
  check('the Quests panel says it is inference before it says anything else',
    questsText.indexOf('This is inference') < questsText.indexOf('quest bakery') &&
    questsText.indexOf('Nothing in the engine records a quest') > -1,
    questsText.slice(0, 140));
  check('and it names the placeholder naming it refused to read as steps',
    /names \d+% of its flags "(sw|var)_…"/.test(questsText),
    /names[^.]*placeholders/.exec(questsText));

  const bulkComplete = await ev(() => {
    const G = window.GigaHack;
    const g = G.quest.quests().filter(x => x.key === 'stem:quest bakery')[0];
    const undoBefore = G.undo.size();
    // Scoped to THIS group's box: the first button of that label on the page
    // belongs to whichever group sorted first.
    const box = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-group'))
      .filter(b => (b.querySelector('.mm-group-hd') || {}).textContent === 'quest bakery' + g.done + '/' + g.total ||
        ((b.querySelector('.mm-group-hd') || {}).textContent || '').indexOf('quest bakery') === 0)[0];
    const btn = box ? Array.prototype.slice.call(box.querySelectorAll('.mm-btn'))
      .filter(b => b.textContent === 'complete this one')[0] : null;
    if (!btn) return { found: false };
    btn.click(); btn.click();
    const ids = g.steps.map(s => s.id);
    const out = {
      found: true,
      on: ids.filter(id => $gameSwitches.value(id)).length,
      total: ids.length,
      undoDelta: G.undo.size() - undoBefore
    };
    if (out.undoDelta) G.undo.pop();
    out.after = ids.filter(id => $gameSwitches.value(id)).length;
    G.quest.reinfer();
    return out;
  });
  check('complete this one is a single bulk write and a single undo entry, not one per step',
    bulkComplete.found === true && bulkComplete.on === bulkComplete.total &&
    bulkComplete.undoDelta === 1 && bulkComplete.after === 0,
    JSON.stringify(bulkComplete));

  const varStep = await ev(() => {
    const G = window.GigaHack;
    const vars = $dataSystem.variables;
    const was = vars[107];
    // A sixth step in the same chain, held in a VARIABLE this time: nothing in
    // the names says what value it should reach.
    vars[107] = 'quest_bakery_6';
    const ids = [142, 143, 144, 145, 146];
    ids.forEach(id => $gameSwitches.setValue(id, true));
    const g = G.quest.reinfer().filter(x => x.key === 'stem:quest bakery')[0];
    const next = g && g.next ? { kind: g.next.kind, id: g.next.id } : null;
    G.ui.rerender();
    const box = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-group'))
      .filter(b => ((b.querySelector('.mm-group-hd') || {}).textContent || '').indexOf('quest bakery') === 0)[0];
    const btn = box ? Array.prototype.slice.call(box.querySelectorAll('.mm-btn'))
      .filter(b => b.textContent === 'advance one step')[0] : null;
    let toast = '';
    if (btn) {
      btn.click(); btn.click();
      // The newest toast, not whichever one is still fading from earlier.
      const all = document.querySelectorAll('#mm-root .mm-toast');
      toast = all.length ? all[all.length - 1].textContent : '';
    }
    const wrote = $gameVariables.value(107);
    vars[107] = was;
    ids.forEach(id => $gameSwitches.setValue(id, false));
    G.quest.reinfer();
    return { next, toast, wrote, steps: g ? g.total : 0 };
  });
  check('advance one step refuses a variable step whose target value nothing in the names states, ' +
    'and says so',
    varStep.next && varStep.next.kind === 'variable' && varStep.wrote === 0 &&
    varStep.toast.indexOf('nothing in the names says what value') > -1,
    JSON.stringify(varStep));

  /* With no section convention and no quest-shaped names there is nothing to
     group, and the panel is not registered rather than opening empty. */
  const noGroups = await ev(() => {
    const G = window.GigaHack;
    window.__useQuestNames(false);
    const out = { n: G.quest.infer().length, why: G.quest.inferenceWhy() };
    window.__useQuestNames(true);
    G.quest.reinfer();
    return out;
  });
  check('the Quests panel finds nothing on a project whose flags carry no section header and no ' +
    'shared stem',
    noGroups.n === 0 && noGroups.why.length > 40, noGroups.why);
  check('and the reason names the two panels that do the same job without the inference',
    noGroups.why.indexOf('World → Switches') > -1 && noGroups.why.indexOf('World → Find') > -1,
    noGroups.why);

  const unnamed = await ev(() => {
    const G = window.GigaHack;
    const sw = $dataSystem.switches, va = $dataSystem.variables;
    const swWas = sw.slice(), vaWas = va.slice();
    for (let i = 1; i < sw.length; i++) sw[i] = '';
    for (let i = 1; i < va.length; i++) va[i] = '';
    const out = { n: G.quest.infer().length, why: G.quest.inferenceWhy() };
    for (let i = 0; i < swWas.length; i++) sw[i] = swWas[i];
    for (let i = 0; i < vaWas.length; i++) va[i] = vaWas[i];
    G.quest.reinfer();
    return out;
  });
  check('the Quests panel finds nothing on a project that leaves its flags unnamed, and says what ' +
    'fraction were named',
    unnamed.n === 0 && /leaves 100% of its switch and variable names blank/.test(unnamed.why),
    unnamed.why);

  const sectionOffer = await ev(() => {
    const G = window.GigaHack;
    const realGet = G.profile.get;
    G.profile.get = function (k, f) { return k === 'sectionPattern' ? null : realGet.apply(this, arguments); };
    G.ui.rerender();
    const dds = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-dd'));
    const dd = dds.filter(d => d.textContent.indexOf('both') > -1)[0];
    const body = document.querySelector('#mm-root .mm-body');
    const out = {
      present: !!dd,
      options: dd ? Array.prototype.map.call(dd.querySelectorAll('.mm-opt'), o => o.textContent) : [],
      note: body ? body.textContent.indexOf('no section-header convention') > -1 : false
    };
    G.profile.get = realGet;
    G.ui.rerender();
    return out;
  });
  check('the section grouping is offered as unavailable with its reason on a project with no ' +
    'section convention, rather than being absent',
    sectionOffer.present === true &&
    sectionOffer.options.indexOf('section headers') > -1 &&
    sectionOffer.note === true,
    JSON.stringify(sectionOffer));

  /* =======================================================================
     THE SCRIPT DUMP
     ==================================================================== */
  const local = await ev(() => {
    const G = window.GigaHack;
    // The crier's choice and scrolling blocks live on one of the four extra
    // events, so they come back for this section and go away again after it.
    window.__addMapEvents();
    const rows = G.quest.script.local().rows;
    const kinds = {};
    rows.forEach(r => { kinds[r.kind] = (kinds[r.kind] || 0) + 1; });
    const crier = rows.filter(r => r.eventId === 7);
    return {
      kinds,
      scopes: G.quest.script.local().scopes.map(s => s.key + '=' + s.complete),
      messages: rows.filter(r => r.kind === 'message' && /You found a Potion/.test(r.text)).length,
      speakers: rows.filter(r => r.kind === 'speaker').length,
      choices: crier.filter(r => r.kind === 'choice').map(r => r.text),
      branches: crier.filter(r => r.kind === 'branch').map(r => r.text),
      scrolls: crier.filter(r => r.kind === 'scroll'),
      stateRows: rows.filter(r => /^state · /.test(r.where)).length,
      stateDesc: rows.filter(r => /^state · /.test(r.where) && r.text === 'undefined').length,
      terms: rows.filter(r => r.kind === 'term').map(r => r.text),
      nullTerms: rows.filter(r => r.kind === 'term' && (r.text === 'null' || r.text === '')).length,
      comments: rows.filter(r => r.kind === 'comment').length,
      // Counted from the data rather than written down, so the check is an
      // assertion about the collector and not about this fixture's size.
      expectedMessages: (function () {
        let n = 0;
        const walk = l => (l || []).forEach(c => { if (c && c.code === 401) n++; });
        ($dataMap.events || []).forEach(d => d && (d.pages || []).forEach(p => walk(p.list)));
        ($dataCommonEvents || []).forEach(ce => ce && walk(ce.list));
        ($dataTroops || []).forEach(t => t && (t.pages || []).forEach(p => walk(p.list)));
        return n;
      }())
    };
  });

  check('a message page contributes one row per 401 line, and a command that produces no line ' +
    'contributes none — not a second copy of the line before it',
    local.messages === 1 && local.kinds.message > 0 && local.kinds.message === local.expectedMessages,
    JSON.stringify({ potion: local.messages, message: local.kinds.message, expected: local.expectedMessages }));
  /* The speaker name exists only where the build writes a fifth parameter on
     101. Emitting speaker:'' where there is none presents an absent field as
     an empty one — the fixture's 101s carry an EMPTY fifth parameter, so no
     speaker row is correct on both builds. */
  check('and a speaker row appears only where the build actually stored a name on the 101',
    local.speakers === 0, String(local.speakers));

  check('a choice list contributes one row per choice and one row per branch label the player sees',
    local.choices.join(',') === 'Buy,Sell,Leave' &&
    local.branches.join(',') === 'Buy,Sell',
    JSON.stringify({ choices: local.choices, branches: local.branches }));

  check('scrolling lines are dumped and marked as unconverted, because only a text state is ' +
    'converted and the stored parameters are raw',
    local.scrolls.length === 3 &&
    local.scrolls.every(r => r.note.indexOf('never stored converted') > -1),
    JSON.stringify(local.scrolls.map(r => r.text)));

  check('state text is read from message1 to message4, because a state has no description field ' +
    'on either engine',
    local.stateRows > 0 && local.stateDesc === 0,
    JSON.stringify({ rows: local.stateRows, undefinedRows: local.stateDesc }));

  check('the terms dump skips the null entries the editor leaves in the command list',
    local.nullTerms === 0 && local.terms.length > 20 &&
    await ev(() => ($dataSystem.terms.commands || []).filter(c => c === null).length > 0),
    JSON.stringify({ terms: local.terms.length, nulls: local.nullTerms }));

  check('comments are excluded from the default set and are labelled as never shown to the player',
    await ev(() => {
      const G = window.GigaHack;
      const kinds = { messages: true, choices: true, scrolling: true, descriptions: true, terms: true, comments: false };
      const off = G.quest.script.search('', { kinds, scope: 'everything' });
      kinds.comments = true;
      const on = G.quest.script.search('', { kinds, scope: 'everything' });
      return off.rows.filter(r => r.kind === 'comment').length === 0 &&
        on.rows.filter(r => r.kind === 'comment').length > 0;
    }) && local.comments > 0,
    String(local.comments));

  const scriptText = await openPanel('Script');
  await ev(() => { window.__removeMapEvents(); });
  check('and the comments chip says so, since codes 108 and 408 never reach the player',
    await ev(() => {
      const chip = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-chip'))
        .filter(c => c.textContent === 'comments')[0];
      return chip ? (chip.getAttribute('data-mm-tip') || '').indexOf('never shown to the player') > -1 : false;
    }));

  check('every source in the script dump states its own scope, and the scope list is shown ' +
    'whether the answer was complete or not',
    scriptText.indexOf('Scope of this answer') > -1 &&
    local.scopes.length === 5 && local.scopes.every(s => /=true$/.test(s)),
    local.scopes.join(' '));

  check('on a build with no filesystem the other-maps scan is offered as unavailable with the ' +
    'reason, and the sources that are complete are still named',
    await ev(() => {
      const G = window.GigaHack;
      const st = G.quest.script.state();
      const res = G.quest.script.search('', {
        kinds: { messages: true, choices: true, scrolling: true, descriptions: true, terms: true, comments: false },
        scope: 'everything'
      });
      const other = res.scopes.filter(s => s.key === 'other maps')[0];
      return st.phase === 'unavailable' && /no Node filesystem/.test(st.why) &&
        other.complete === false && other.why.length > 10 &&
        res.scopes.filter(s => s.complete).length === 5 &&
        res.complete === false;
    }));
  check('and the panel prints that reason instead of an empty list',
    scriptText.indexOf('no Node filesystem') > -1);

  const capped = await ev(() => {
    const G = window.GigaHack;
    const kinds = { messages: true, choices: true, scrolling: true, descriptions: true, terms: true, comments: false };
    const all = G.quest.script.search('', { kinds, scope: 'everything' });
    G.store.cfgSet('quest.script.max', 100);
    const small = G.quest.script.search('', { kinds, scope: 'everything' });
    G.store.cfgSet('quest.script.max', 5000);
    return {
      full: all.rows.length, matched: all.matched, truncatedFull: all.truncated,
      capped: small.rows.length, cappedMatched: small.matched, truncated: small.truncated
    };
  });
  check('a row dropped by the cap is announced rather than silently missing, and the count and ' +
    'the list agree',
    capped.truncatedFull === false && capped.full === capped.matched &&
    capped.capped === 100 && capped.truncated === true &&
    capped.cappedMatched === capped.matched,
    JSON.stringify(capped));

  const cappedPanel = await ev(() => {
    const G = window.GigaHack;
    G.store.cfgSet('quest.script.max', 100);
    G.ui.rerender();
    const body = document.querySelector('#mm-root .mm-body');
    const txt = body ? body.textContent : '';
    G.store.cfgSet('quest.script.max', 5000);
    G.ui.rerender();
    return txt;
  });
  check('and the panel says it stopped at the cap rather than showing a short list as a whole one',
    /stopped at 100 rows of \d+/.test(cappedPanel), /stopped at [^—]*/.exec(cappedPanel));

  const query = await ev(() => {
    const G = window.GigaHack;
    G.store.cfgSet('quest.script.q', 'shrine');
    G.ui.rerender();
    const box = document.querySelector('#mm-root .mm-search input');
    const value = box ? box.value : null;
    G.ui.rerender();
    const box2 = document.querySelector('#mm-root .mm-search input');
    const after = box2 ? box2.value : null;
    G.store.cfgSet('quest.script.q', '');
    G.ui.rerender();
    return { value, after };
  });
  check('the search box keeps its query across a rebuild and shows the query that is filtering ' +
    'the list',
    query.value === 'shrine' && query.after === 'shrine', JSON.stringify(query));

  /* ------------------- the second walk of the map files ------------------ */
  const scanStart = await ev(() => {
    const G = window.GigaHack;
    return { phase: G.quest.script.state().phase, rows: G.quest.script.state().rows };
  });
  check('the map-file scan is never started at boot — it is the index\'s most expensive stage ' +
    'done twice',
    scanStart.phase === 'unavailable' && scanStart.rows === 0, JSON.stringify(scanStart));

  const twice = await ev(() => {
    const G = window.GigaHack;
    window.__mountVirtualFs();
    window.__addExtraMapFiles();
    // Map 207's file exists; take it out of the map tree so "the file is there
    // and the tree does not know it" is a state the scan really meets.
    window.__questOrphan = $dataMapInfos[207];
    delete $dataMapInfos[207];
    const first = G.quest.script.scan();
    const second = G.quest.script.scan();     // must not walk the files twice
    return { first, second, phase: G.quest.script.state().phase };
  });
  check('starting it twice does not run two walks',
    twice.first === true && twice.second === false && twice.phase === 'scanning',
    JSON.stringify(twice));

  await page.waitForFunction(() => window.GigaHack.quest.script.state().phase === 'ready',
    null, { timeout: 15000 });

  const scanned = await ev(() => {
    const G = window.GigaHack;
    const st = G.quest.script.state();
    const rows = G.quest.script.search('', {
      kinds: { messages: true, choices: true, scrolling: true, descriptions: true, terms: true, comments: true },
      scope: 'other maps'
    });
    return {
      phase: st.phase, maps: st.maps, why: st.why,
      shrine: rows.rows.filter(r => /The shrine is silent/.test(r.text))[0] || null,
      cellar: rows.rows.filter(r => r.text === 'Open it')[0] || null,
      orphan: rows.rows.filter(r => r.mapId === 207)[0] || null,
      complete: rows.scopes.filter(s => s.key === 'other maps')[0].complete
    };
  });
  check('the cross-map scan finds the text the boot index walked past, because the index records ' +
    'which switches an event touches and not what it says',
    scanned.phase === 'ready' && scanned.shrine && scanned.cellar,
    JSON.stringify({ shrine: !!scanned.shrine, cellar: !!scanned.cellar, maps: scanned.maps }));
  check('a cross-map hit is re-resolved against live data before it is shown, so it carries the ' +
    'map tree\'s own name for the map',
    scanned.shrine && scanned.shrine.mapName === 'Shrine' && scanned.shrine.mapId === 5,
    JSON.stringify(scanned.shrine && { name: scanned.shrine.mapName, id: scanned.shrine.mapId }));
  check('a hit in a map file the map tree has no row for is marked rather than presented as a ' +
    'named map',
    !!scanned.orphan && scanned.orphan.stale === true && !scanned.orphan.mapName,
    JSON.stringify(scanned.orphan && { id: scanned.orphan.mapId, stale: scanned.orphan.stale, name: scanned.orphan.mapName }));
  check('a file that is not valid JSON becomes a per-file note, not a failed scan',
    scanned.phase === 'ready' && /map 99: not valid JSON/.test(scanned.why), scanned.why);
  check('once the scan is ready the other-maps scope reports itself complete',
    scanned.complete === true);

  const cancelled = await ev(() => {
    const G = window.GigaHack;
    G.quest.script.forget();
    G.quest.script.scan();
    const during = G.quest.script.state().phase;
    G.quest.script.cancel();
    const st = G.quest.script.state();
    return { during, phase: st.phase, rows: st.rows, built: st.built };
  });
  check('cancelling the scan leaves no half-built result, because half a cross-map answer shown ' +
    'as a whole one is worse than none',
    cancelled.during === 'scanning' && cancelled.phase === 'idle' &&
    cancelled.rows === 0 && cancelled.built === 0,
    JSON.stringify(cancelled));

  const stale = await ev(async () => {
    const G = window.GigaHack;
    G.quest.script.scan();
    await new Promise(r => {
      const t = setInterval(() => {
        if (G.quest.script.state().phase === 'ready') { clearInterval(t); r(); }
      }, 20);
    });
    const ready = G.quest.script.state().phase;
    const wasTitle = $dataSystem.gameTitle;
    $dataSystem.gameTitle = wasTitle + ' (patched)';   // the index fingerprint moves
    const after = G.quest.script.state();
    $dataSystem.gameTitle = wasTitle;
    const back = G.quest.script.state().phase;
    return { ready, after: after.phase, why: after.why, back };
  });
  check('the scan cache is dropped when the index fingerprint changes',
    stale.ready === 'ready' && stale.after === 'idle' &&
    /the game changed since this scan/.test(stale.why) && stale.back === 'ready',
    JSON.stringify(stale));

  await ev(() => {
    const G = window.GigaHack;
    G.quest.script.forget();
    window.__removeExtraMapFiles();
    if (window.__questOrphan) { $dataMapInfos[207] = window.__questOrphan; delete window.__questOrphan; }
    window.__unmountVirtualFs();
  });
  check('the filesystem is unmounted again, so a later check sees the browser build it expects',
    await ev(() => window.GigaHack.caps.fs === false &&
      window.GigaHack.quest.script.state().phase === 'unavailable'));

  /* =======================================================================
     LIVE — Common and Quests

     Blocked already refreshed itself from the frame hook; these two did not,
     so a gate switch thrown by the game and a quest step finished by the game
     both left the panel describing a world that had moved on. Both are driven
     through the shell's own 700ms hook list, because that is what the clock
     does.
     ==================================================================== */
  const commonLive = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};

    /* Common event 2 is the fixture's Parallel one and its gate is switch 5. */
    $gameSwitches.setValue(5, false);
    G.store.cfgSet('quest.common.selected', 2);
    G.store.cfgSet('quest.common.gatedOnly', false);
    G.store.cfgSet('quest.common.filter', '');
    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Common';
    U.rerender();

    const listTable = document.querySelectorAll('#mm-root .mm-table')[0];
    const blockOf = (label) => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === label) return labs[i].parentNode.lastChild;
      }
      return null;
    };
    const gateEl = blockOf('Gate switch');
    const rowFor = (id) => listTable.mm.rows().filter(r => r.id === id)[0];
    const toggle = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-cbrow'))
      .filter(t => t.textContent.trim() === 'gate switch')[0];

    out.gateAtBuild = gateEl ? gateEl.textContent : '';
    out.rowAtBuild = rowFor(2) ? rowFor(2).switchOn : null;
    out.toggleAtBuild = toggle ? toggle.querySelector('.mm-check').classList.contains('mm-on') : null;
    out.rowsAtBuild = listTable.mm.rows().length;

    const firstRow = listTable.mm.body.querySelector('.mm-tr');
    tick();
    out.idleKeptTheSameNode = listTable.mm.body.querySelector('.mm-tr') === firstRow;

    /* The game throws the gate. */
    $gameSwitches.setValue(5, true);
    tick();
    out.gateFollowed = gateEl ? gateEl.textContent : '';
    out.rowFollowed = rowFor(2) ? rowFor(2).switchOn : null;
    out.toggleFollowed = toggle ? toggle.querySelector('.mm-check').classList.contains('mm-on') : null;
    out.sameTable = document.querySelectorAll('#mm-root .mm-table')[0] === listTable;
    out.sameToggle = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-cbrow'))
      .filter(t => t.textContent.trim() === 'gate switch')[0] === toggle;

    /* And with "only the gated ones that are on" showing, the row SET is what
       moves — the filter reads the same live switch. */
    G.store.cfgSet('quest.common.gatedOnly', true);
    U.rerender();
    const filtered = document.querySelectorAll('#mm-root .mm-table')[0];
    out.filteredOn = filtered.mm.rows().length;
    $gameSwitches.setValue(5, false);
    tick();
    out.filteredOff = filtered.mm.rows().length;

    G.store.cfgSet('quest.common.gatedOnly', false);
    G.store.cfgSet('quest.common.selected', 0);
    U.setOpen(false);
    return out;
  });
  check('a gate switch the game throws while the Common panel is open moves the list, the gate ' +
    'sentence and the gate toggle with it',
    commonLive.rowAtBuild === false && commonLive.rowFollowed === true &&
    /OFF$/.test(commonLive.gateAtBuild) && /ON$/.test(commonLive.gateFollowed) &&
    commonLive.toggleAtBuild === false && commonLive.toggleFollowed === true,
    JSON.stringify(commonLive));
  check('and it does it without rebuilding the panel, so the gate toggle under the cursor is the ' +
    'same control it was',
    commonLive.sameTable === true && commonLive.sameToggle === true &&
    commonLive.idleKeptTheSameNode === true, JSON.stringify(commonLive));
  check('a row that stops matching "only the gated ones" leaves the list while it is being read',
    commonLive.filteredOn === 1 && commonLive.filteredOff === 0,
    JSON.stringify({ on: commonLive.filteredOn, off: commonLive.filteredOff }));

  const questLive = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};

    const g0 = G.quest.quests().filter(x => x.key === 'stem:quest bakery')[0];
    const ids = g0.steps.map(s => s.id);
    ids.forEach(id => $gameSwitches.setValue(id, false));
    G.quest.reinfer();

    G.store.cfgSet('quest.quests.filter', '');
    G.store.cfgSet('quest.quests.showDone', true);
    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Quests';
    U.rerender();

    const boxFor = () => Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-group'))
      .filter(b => {
        const hd = b.querySelector('.mm-group-hd');
        return hd && hd.textContent.indexOf('quest bakery') === 0;
      })[0];
    const tagOf = (b) => {
      const t = b.querySelector('.mm-group-tag');
      return t ? t.textContent : '';
    };
    const box = boxFor();
    out.found = !!box;
    out.tagAtBuild = tagOf(box);
    out.firstOnAtBuild = box.querySelector('.mm-check').classList.contains('mm-on');

    tick();
    out.idleKeptTheSameBox = boxFor() === box;

    /* The game finishes the first step. */
    $gameSwitches.setValue(ids[0], true);
    tick();
    out.tagFollowed = tagOf(box);
    out.firstOnFollowed = box.querySelector('.mm-check').classList.contains('mm-on');
    out.sameBox = boxFor() === box;

    /* And the last one, which takes the group's "Next" row away with it: that
       is a change of SHAPE and the only case that earns a rebuild. */
    ids.forEach(id => $gameSwitches.setValue(id, true));
    tick();
    const after = boxFor();
    out.rebuiltOnShapeChange = after !== box;
    out.tagWhenDone = after ? tagOf(after) : '';

    ids.forEach(id => $gameSwitches.setValue(id, false));
    G.quest.reinfer();
    U.setOpen(false);
    return out;
  });
  check('a quest step the game finishes while the Quests panel is open ticks its box and moves the ' +
    'group\'s count, without the group being rebuilt under the reader',
    questLive.found === true && questLive.tagAtBuild === '0/5' &&
    questLive.tagFollowed === '1/5' && questLive.firstOnAtBuild === false &&
    questLive.firstOnFollowed === true && questLive.sameBox === true &&
    questLive.idleKeptTheSameBox === true, JSON.stringify(questLive));
  check('and a group that finishes IS rebuilt, because the "Next" row it held no longer describes it',
    questLive.rebuiltOnShapeChange === true && questLive.tagWhenDone === '5/5',
    JSON.stringify(questLive));

  /* =======================================================================
     LAYOUT AND THE FRAME PATH
     ==================================================================== */
  const overflow = await ev(async () => {
    const G = window.GigaHack;
    const out = { worst: 0, rows: 0, elided: 0, cells: 0 };
    for (const sub of ['Blocked', 'Common', 'Quests', 'Script']) {
      G.cfg.ui.tab = 'world';
      G.cfg.ui.sub.world = sub;
      G.ui.rerender();
      await new Promise(r => setTimeout(r, 40));
      document.querySelectorAll('#mm-root .mm-col').forEach(c => {
        const d = c.scrollWidth - c.clientWidth;
        if (d > out.worst) out.worst = d;
      });
      document.querySelectorAll('#mm-root .mm-row').forEach(r => {
        if (r.scrollWidth > r.clientWidth + 1) out.rows++;
      });
      document.querySelectorAll('#mm-root .mm-td span').forEach(s => {
        out.cells++;
        if (s.scrollWidth > s.clientWidth) out.elided++;
      });
    }
    return out;
  });
  check('no row in any Quest panel pushes its column sideways',
    overflow.worst === 0 && overflow.rows === 0, JSON.stringify(overflow));
  check('and a long line of dialogue is elided inside its own cell rather than clipping its label',
    await ev(() => {
      const G = window.GigaHack;
      G.cfg.ui.sub.world = 'Script';
      G.ui.rerender();
      const cells = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-td span'));
      const long = cells.filter(s => s.scrollWidth > s.clientWidth);
      // Ellipsised in the cell, and the whole line still readable from the row.
      return long.every(s => getComputedStyle(s).textOverflow === 'ellipsis' &&
        getComputedStyle(s).overflow === 'hidden') &&
        Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-tr'))
          .every(tr => tr.scrollWidth <= tr.clientWidth + 1);
    }));

  const frameGate = await ev(async () => {
    const G = window.GigaHack;
    window.__addMapEvents();
    if (G.events && G.events.select) G.events.select(5);
    G.store.cfgSet('quest.blocked.onlyUnmet', false);
    G.store.cfgSet('quest.blocked.showMetPages', true);

    let builds = 0;
    const real = G.ui.rerender;
    const cellOf = () => {
      const row = Array.prototype.slice.call(document.querySelectorAll('#mm-root .mm-row'))
        .filter(r => /^Switch 141 /.test(r.textContent))[0];
      return row ? row.querySelector('.mm-edge span').textContent : null;
    };

    G.ui.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub.world = 'Blocked';
    real();                                  // paint it once, without counting
    G.ui.rerender = function () { builds++; return real.apply(this, arguments); };

    G.ui.setOpen(false);
    for (let i = 0; i < 120; i++) G.frame();
    const whenClosed = builds;

    G.ui.setOpen(true);
    G.cfg.ui.sub.world = 'Common';
    real(); builds = 0;
    for (let i = 0; i < 120; i++) G.frame();
    const whenElsewhere = builds;

    G.cfg.ui.sub.world = 'Blocked';
    real(); builds = 0;
    const cellBefore = cellOf();
    // A value moved, and nothing about the SHAPE of the report did.
    const was141 = $gameSwitches.value(141);
    $gameSwitches.setValue(141, !was141);
    for (let i = 0; i < 120; i++) G.frame();
    const cellAfter = cellOf();
    const buildsForAValue = builds;

    // Now the shape itself moves: the event is erased, so no page runs at all.
    builds = 0;
    $gameMap.event(5).erase();
    for (let i = 0; i < 120; i++) G.frame();
    const buildsForAShape = builds;

    G.ui.rerender = real;
    $gameMap.event(5)._erased = false;
    $gameMap.event(5).refresh();
    $gameSwitches.setValue(141, was141);
    G.store.cfgSet('quest.blocked.onlyUnmet', true);
    G.store.cfgSet('quest.blocked.showMetPages', false);
    if (G.events && G.events.select) G.events.select(0);
    window.__removeMapEvents();
    real();
    return { whenClosed, whenElsewhere, cellBefore, cellAfter, buildsForAValue, buildsForAShape };
  });
  check('the per-frame refresh does nothing while the overlay is closed or another sub-tab is showing',
    frameGate.whenClosed === 0 && frameGate.whenElsewhere === 0, JSON.stringify(frameGate));
  check('and when a condition\'s value moves it rewrites that value cell rather than rebuilding ' +
    'the panel several times a second',
    frameGate.cellBefore === 'now OFF' && frameGate.cellAfter === 'now ON' &&
    frameGate.buildsForAValue === 0,
    JSON.stringify({ before: frameGate.cellBefore, after: frameGate.cellAfter, builds: frameGate.buildsForAValue }));
  check('but when the shape of the answer changes — the event erased, a page gone — it rebuilds, ' +
    'because the cells it holds no longer describe the report',
    frameGate.buildsForAShape > 0, String(frameGate.buildsForAShape));

  const selectGate = await ev(() => {
    const G = window.GigaHack;
    let builds = 0;
    const real = G.ui.rerender;
    G.ui.rerender = function () { builds++; return real.apply(this, arguments); };
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub.world = 'Script';
    real(); builds = 0;
    G.events.select(2);
    const elsewhere = builds;
    G.cfg.ui.sub.world = 'Blocked';
    G.events.select(1);
    real(); builds = 0;
    // Selecting a DIFFERENT event is a change of shape: the panel was built
    // for the one before it.
    G.events.select(2);
    const showing = builds;
    G.ui.rerender = real;
    G.events.select(0);
    return { elsewhere, showing };
  });
  check('and selecting an event on the map refreshes the Blocked panel only while it is the one ' +
    'on screen',
    selectGate.elsewhere === 0 && selectGate.showing === 1, JSON.stringify(selectGate));

  /* =======================================================================
     THE CONSOLE API
     ==================================================================== */
  const api = await ev(() => {
    const G = window.GigaHack;
    const b = G.api.blocked(1);
    return {
      agrees: typeof b.agrees === 'boolean',
      pages: b.pages.length,
      conditions: b.conditions.length,
      missing: G.api.blocked(9999).why || '',
      commons: G.api.commons().length,
      quests: Array.isArray(G.api.quests()),
      script: G.api.script('potion').rows.length
    };
  });
  check('the console can reach all four answers without opening a panel',
    api.agrees === true && api.pages === 2 && api.conditions === 2 &&
    api.commons === 9 && api.quests === true && api.script > 0,
    JSON.stringify(api));
  check('and asking about an event the map does not have answers with a reason rather than a throw',
    /no such event/.test(api.missing), api.missing);

  /* =======================================================================
     PUT EVERYTHING BACK
     ==================================================================== */
  const restored = await ev((b) => {
    const G = window.GigaHack;
    window.__removeMapEvents();
    G.store.cfgSet('quest.blocked.showMetPages', false);
    G.store.cfgSet('quest.common.selected', 0);
    G.store.cfgSet('quest.common.gatedOnly', b.gatedOnly);
    G.store.cfgSet('quest.script.q', '');
    G.store.cfgSet('quest.script.max', 5000);
    G.quest.reinfer();
    if (G.events && G.events.select) G.events.select(0);
    G.cfg.ui.tab = b.tab;
    G.cfg.ui.sub.world = b.sub;
    G.ui.setOpen(b.open);
    G.ui.rerender();
    return {
      events: $gameMap.events().length,
      undo: G.undo.size(),
      undoTop: G.undo.peek() ? G.undo.peek().label : '',
      reserved: $gameTemp.isCommonEventReserved(),
      switches: b.ids.filter(id => $gameSwitches.value(id)),
      fs: G.caps.fs,
      degraded: G.compat.isDegraded('switches.set'),
      scan: G.quest.script.state().phase
    };
  }, Object.assign({ ids: WATCHED }, before));
  check('the checks leave the game as they found it — the same events, the same flags, no ' +
    'reservation, no mounted filesystem and no half-built scan',
    restored.events === before.events &&
    restored.switches.join(',') === before.switches.join(',') &&
    restored.reserved === false && restored.fs === false &&
    restored.scan === 'unavailable' && restored.degraded === false,
    JSON.stringify({ before: before.switches, after: restored.switches, events: restored.events, scan: restored.scan }));
  check('and no undo entry of theirs is left on the stack for a later check to inherit',
    restored.undo === before.undo,
    JSON.stringify({ before: before.undo, after: restored.undo, top: restored.undoTop }));

  /* --- before a game has been started ------------------------------------ */
  /* The objectives are read from the DATABASE, which exists from the title
     screen. Whether a step is done is a question about the SAVE, and there is
     no save until a new game or a load has built the game objects. Asking
     anyway threw once per step: on a real project with a thousand named
     switches that was 1,383 identical lines in the log at boot — a third of the
     ring, and the boot report with it. Found by running against a real game;
     no harness had a title screen. */
  const noGame = await ev(() => {
    const G = window.GigaHack;
    const sw = $gameSwitches, va = $gameVariables;
    const out = {};
    const before = G.logHistory().length;
    try {
      $gameSwitches = null;
      $gameVariables = null;
      out.started = G.quest.gameStarted();
      const groups = G.quest.quests();
      out.groups = groups.length;
      out.doneAnywhere = groups.some(g => g.steps.some(s => s.done));
      out.logged = G.logHistory().length - before;

      G.ui.setOpen(true);
      G.cfg.ui.tab = 'world';
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub.world = 'Quests';
      G.ui.rerender();
      out.saysSo = /No game is running yet/.test(
        (document.querySelector('#mm-root .mm-body') || {}).textContent || '');
      out.loggedAfterPanel = G.logHistory().length - before;
    } finally {
      $gameSwitches = sw;
      $gameVariables = va;
      G.ui.setOpen(false);
      G.ui.rerender();
    }
    return out;
  });
  check('with no game started the objectives still list, every step reads as not done, and not one ' +
    'line is logged about it',
    noGame.started === false && noGame.doneAnywhere === false &&
    noGame.logged === 0 && noGame.loggedAfterPanel === 0,
    JSON.stringify(noGame));
  check('and the panel says there is no save to judge them against, rather than presenting a whole ' +
    'quest list as untouched',
    noGame.saysSo === true, JSON.stringify(noGame));
};
