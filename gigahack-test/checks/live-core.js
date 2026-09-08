/* =============================================================================
   GigaHack MV/MZ — the older modules' panels, made live

   A panel that shows something the GAME changes and is painted once is not
   obviously broken from the outside: it shows a number, the number is wrong,
   and nothing anywhere says it is a snapshot. The clearest case is Player →
   Movement, whose "Here" readout disagreed with the shell's own footer — on
   the same screen, at the same moment — within a second of walking.

   Every check below drives the shell's 700ms hook list BY HAND, because that
   is all the clock does: `host.tickHooks.slice().forEach(fn => fn(1))`. The
   list is emptied on every tab render and refilled by whichever panel was
   built, so opening a panel and ticking is exactly the situation a player is
   in with the menu open.

   What each check is really asserting is one of two things, and they are the
   two halves of U.live's contract:

     · the readout follows the game;
     · the CONTROLS beside it do not move — a number field keeps the digits
       being typed into it, a two-click danger button keeps its first click,
       and a table keeps the row the reader was on.

   State discipline: every block puts back what it moved — the party's items
   and gold, the actor it edited, the variables and switches it wrote, the
   player's tile, the panel it registered — because a later check reading any
   of those must not inherit this file's fixture.
   ========================================================================== */
'use strict';

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page;

  /* Every block repeats the four lines that open a panel and drive its hooks
     inside its own page function rather than sharing one: each ev() call
     crosses into the browser, and a closure does not cross with it. */

  /* Which tab and sub-tab the run was on. Restored at the end, because the
     screenshots taken after every check file are of whatever panel each tab
     was last left showing, and a reviewer looking for Movement should not be
     handed Identity because this file walked past it. */
  const wasOn = await ev(() => {
    const G = window.GigaHack;
    return { tab: G.cfg.ui.tab, sub: JSON.parse(JSON.stringify(G.cfg.ui.sub || {})) };
  });

  /* ======================================================================
     PLAYER → MOVEMENT

     The demonstration case: the footer at the bottom of the same window
     prints the map and the tile on the same 700ms clock.
     =================================================================== */
  const movement = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const keep = { x: $gamePlayer._x, y: $gamePlayer._y };

    U.setOpen(true);
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.player = 'Movement';
    U.rerender();

    const here = () => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === 'Here') return labs[i].parentNode.children[1].textContent;
      }
      return '';
    };
    const hereRow = () => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === 'Here') return labs[i].parentNode;
      }
      return null;
    };
    const rowNode = hereRow();
    const bodyNode = document.querySelector('#mm-root .mm-body');
    out.built = here();
    out.hooks = host.tickHooks.length;

    /* Walking. The engine moves _x/_y and nothing tells the overlay. */
    $gamePlayer._x = keep.x + 3;
    $gamePlayer._y = keep.y + 2;
    out.beforeTick = here();
    tick();
    out.afterTick = here();
    out.expected = $gameMap.mapId() + ' · ' + $gamePlayer.x + ',' + $gamePlayer.y;

    /* The same nodes, before and after. U.rerender() would produce the right
       TEXT and throw away the panel to get it — the scroll offset, the open
       group, the button someone had already clicked once — so "it updated" is
       only half the claim. Reopening the overlay is not used to test the
       closed-hold here: setOpen(true) rebuilds the tab, which would make this
       pass with no live repaint at all. U.live's own hold is checked against
       the helper in run.js. */
    out.sameRow = hereRow() === rowNode;
    out.sameBody = document.querySelector('#mm-root .mm-body') === bodyNode;

    $gamePlayer._x = keep.x; $gamePlayer._y = keep.y;
    tick();
    U.setOpen(false);
    return out;
  });
  check('the "Here" readout on Player → Movement follows the player across the map instead of freezing on the tile the panel was opened on',
    movement.beforeTick === movement.built && movement.afterTick === movement.expected &&
    movement.afterTick !== movement.built, JSON.stringify(movement));
  /* The footer is repainted by the shell's own clock and not by a tick hook,
     so this one waits for the real 700ms interval rather than driving it. It
     is the defect in its original form: two readouts of the same two facts,
     on the same screen, disagreeing. */
  await ev(() => {
    const G = window.GigaHack;
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub.player = 'Movement';
    G.ui.rerender();
    window.__liveKeep = { x: $gamePlayer._x, y: $gamePlayer._y };
    $gamePlayer._x = window.__liveKeep.x + 5;
    $gamePlayer._y = window.__liveKeep.y + 1;
  });
  await page.waitForTimeout(900);
  const agree = await ev(() => {
    const labs = document.querySelectorAll('#mm-root .mm-lab');
    let here = '';
    for (let i = 0; i < labs.length; i++) {
      if (labs[i].textContent === 'Here') { here = labs[i].parentNode.children[1].textContent; break; }
    }
    const foot = document.querySelector('#mm-root .mm-footer');
    const out = {
      here: here,
      footer: foot ? foot.textContent : '',
      tile: $gamePlayer.x + ',' + $gamePlayer.y
    };
    $gamePlayer._x = window.__liveKeep.x;
    $gamePlayer._y = window.__liveKeep.y;
    delete window.__liveKeep;
    window.GigaHack.ui.setOpen(false);
    return out;
  });
  check('and it agrees with the shell footer, which prints the same map and tile on its own clock',
    agree.here.indexOf(agree.tile) > -1 && agree.footer.indexOf(agree.tile) > -1,
    JSON.stringify(agree));
  check('and it updates in place — the panel, the row and everything else on it survive the repaint that changed the number',
    movement.sameRow === true && movement.sameBody === true &&
    movement.afterTick === movement.expected, JSON.stringify(movement));

  /* ======================================================================
     PLAYER → STATS

     The most dangerous panel to repaint: HP, MP, TP, the manual bonus and
     the final value are all focusable number fields, and the columns around
     them are the game's.
     =================================================================== */
  const stats = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const bonusWas = window.__pluginParamBonus || 0;

    U.setOpen(true);
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.player = 'Stats';
    U.rerender();

    /* The "other" column of the first parameter row: base, manual box, other,
       clamp, final box. The row is found by the parameter's own name so this
       does not depend on the fixture's word for it. */
    const a = G.party.selected();
    const rowFor = (name) => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === name) return labs[i].parentNode;
      }
      return null;
    };
    const mhpRow = rowFor(G.party.paramName(0));
    const cells = mhpRow ? mhpRow.querySelector('.mm-edge').children : [];
    const otherCell = cells[2];
    out.cellCount = cells.length;
    out.otherBefore = otherCell ? otherCell.textContent : '(no row)';

    /* Something else — equipment, a plugin — moves paramPlus. The manual
       column is GigaHack's own and does not move with it. */
    window.__pluginParamBonus = bonusWas + 25;
    out.otherStillStale = otherCell ? otherCell.textContent : '';
    tick();
    out.otherAfter = otherCell ? otherCell.textContent : '';

    /* The vitals' ceiling is computed and follows; the box in front of it is
       the user's and does not. A digit is put in the box WITHOUT focusing it,
       because focus holds the repaint entirely — this is the stronger claim:
       even when it does paint, it does not touch the field. */
    const hpBox = (() => {
      const r = rowFor('HP');
      return r ? r.querySelector('input') : null;
    })();
    if (hpBox) hpBox.value = '4321';
    const maxSpan = (() => {
      const r = rowFor('HP');
      const spans = r ? r.querySelectorAll('span.mm-mono') : [];
      return spans.length ? spans[spans.length - 1] : null;
    })();
    out.maxBefore = maxSpan ? maxSpan.textContent : '';
    window.__pluginParamBonus = bonusWas + 60;
    tick();
    out.maxAfter = maxSpan ? maxSpan.textContent : '';
    out.boxKept = hpBox ? hpBox.value : '(no box)';

    window.__pluginParamBonus = bonusWas;
    tick();
    out.restored = otherCell ? otherCell.textContent : '';
    out.actor = a ? a.actorId() : 0;
    U.setOpen(false);
    return out;
  });
  check('the computed columns of Player → Stats follow the game while the boxes between them keep what is being typed into them',
    stats.otherStillStale === stats.otherBefore && stats.otherAfter !== stats.otherBefore &&
    stats.boxKept === '4321', JSON.stringify(stats));
  check('a vital\'s ceiling on Player → Stats is repainted, and the field in front of it is not',
    stats.maxAfter !== stats.maxBefore && stats.boxKept === '4321' &&
    stats.restored === stats.otherBefore, JSON.stringify(stats));

  /* ======================================================================
     PLAYER → SKILLS and STATES
     =================================================================== */
  const skills = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const a = G.party.selected();
    const keep = a._skills.slice();

    U.setOpen(true);
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.player = 'Skills';
    U.rerender();

    const tagOf = (title) => {
      const heads = document.querySelectorAll('#mm-root .mm-group-hd');
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].textContent.indexOf(title) > -1) {
          const t = heads[i].querySelector('.mm-group-tag');
          return t ? t.textContent : '';
        }
      }
      return '';
    };
    const ticked = () => document.querySelectorAll('#mm-root .mm-tbody .mm-check.mm-on').length;

    out.tagBefore = tagOf('Skills · ');
    out.onBefore = ticked();

    /* An event teaches the actor something while the panel is open. */
    let learn = 0;
    for (let i = 1; i < $dataSkills.length && !learn; i++) {
      if ($dataSkills[i] && $dataSkills[i].name && !a.isLearnedSkill(i)) learn = i;
    }
    a.learnSkill(learn);
    out.learned = learn;
    out.beforeTick = tagOf('Skills · ');
    tick();
    out.tagAfter = tagOf('Skills · ');
    out.onAfter = ticked();

    a._skills = keep;
    tick();
    U.setOpen(false);
    return out;
  });
  check('learning a skill while Player → Skills is open moves the "known" column and the count in the group title together',
    skills.beforeTick === skills.tagBefore && skills.tagAfter !== skills.tagBefore &&
    skills.onAfter === skills.onBefore + 1, JSON.stringify(skills));

  const states = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const a = G.party.selected();
    const keep = a._states.slice();

    U.setOpen(true);
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.player = 'States';
    U.rerender();

    const activeGroup = () => {
      const heads = document.querySelectorAll('#mm-root .mm-group-hd');
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].textContent.indexOf('Active') === 0) return heads[i].parentNode;
      }
      return null;
    };
    const listText = () => {
      const live = activeGroup();
      return live ? live.querySelector('.mm-group-bd').textContent : '';
    };
    const tagText = () => {
      const live = activeGroup();
      const t = live ? live.querySelector('.mm-group-tag') : null;
      return t ? t.textContent : '';
    };

    /* The danger button in the same group is armed FIRST: a repaint that
       rebuilt the group would take the first of its two clicks away.

       Found again after the tick rather than held: a detached node keeps the
       class it was wearing when it left the document, so a check that read the
       node it started with would say "still armed" about a button that is no
       longer on screen — which is precisely the failure it is meant to catch. */
    const clearBtn = () => {
      const live = activeGroup();
      return live ? live.querySelector('.mm-btn-danger') : null;
    };
    const first = clearBtn();
    if (first) first.click();
    out.armed = !!(first && first.classList.contains('mm-armed'));

    out.before = listText();
    out.tagBefore = tagText();

    /* Never the death state: the engine's own refresh() takes it straight
       off a battler whose HP is above zero, which is correct and is not what
       this check is about. */
    let add = 0;
    const death = a.deathStateId();
    for (let i = 1; i < $dataStates.length && !add; i++) {
      if (i !== death && $dataStates[i] && $dataStates[i].name && !a.isStateAffected(i)) add = i;
    }
    a.addState(add);
    out.reallyOn = a.isStateAffected(add);
    out.added = add;
    out.beforeTick = listText();
    tick();
    out.after = listText();
    out.tagAfter = tagText();
    const still = clearBtn();
    out.stillArmed = !!(still && still.classList.contains('mm-armed'));
    out.wanted = $dataStates[add] ? $dataStates[add].name : '';

    if (still && still.mm) still.mm.disarm();
    a._states = keep;
    tick();
    U.setOpen(false);
    return out;
  });
  check('a state landing on the actor while Player → States is open shows in the "Active" list and in its count',
    states.beforeTick === states.before && states.after !== states.before &&
    states.reallyOn === true && states.tagAfter !== states.tagBefore &&
    states.after.indexOf(states.wanted) > -1, JSON.stringify(states));
  check('and the two-click "clear all states" beside it keeps the first of its two clicks',
    states.armed === true && states.stillArmed === true, JSON.stringify(states));

  /* ======================================================================
     PLAYER → EQUIP
     =================================================================== */
  const equip = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const a = G.party.selected();
    const keep = a._equips.map((it) => it.object());

    U.setOpen(true);
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.player = 'Equip';
    U.rerender();

    const slotText = () => {
      const rows = document.querySelectorAll('#mm-root .mm-tree-row');
      return Array.prototype.map.call(rows, (r) => r.textContent).join(' | ');
    };
    out.before = slotText();

    /* An event hands the actor a different weapon. */
    let give = null;
    for (let i = 1; i < $dataWeapons.length && !give; i++) {
      if ($dataWeapons[i] && $dataWeapons[i].name && $dataWeapons[i] !== keep[0]) give = $dataWeapons[i];
    }
    a.forceChangeEquip(0, give);
    out.beforeTick = slotText();
    tick();
    out.after = slotText();
    out.wanted = give ? give.name : '';

    a._equips.forEach((it, i) => it.setObject(keep[i]));
    tick();
    U.setOpen(false);
    return out;
  });
  check('an event changing what the actor is wearing shows in the slot list on Player → Equip without the panel being reopened',
    equip.beforeTick === equip.before && equip.after !== equip.before &&
    equip.after.indexOf(equip.wanted) > -1, JSON.stringify(equip));

  /* ======================================================================
     PLAYER → IDENTITY

     The one panel where following the game and not fighting the user are in
     direct tension: every field on it is a text box.
     =================================================================== */
  const identity = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const a = G.party.selected();
    const keep = { name: a.name(), nick: a.nickname() };

    U.setOpen(true);
    G.cfg.ui.tab = 'player';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.player = 'Identity';
    U.rerender();

    const rowFor = (label) => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].firstChild && labs[i].firstChild.textContent === label) return labs[i].parentNode;
      }
      return null;
    };
    const nameRow = rowFor('Name');
    const nickRow = rowFor('Nickname');
    const nameBox = nameRow ? nameRow.querySelector('input') : null;
    const nickBox = nickRow ? nickRow.querySelector('input') : null;

    out.nameBefore = nameBox ? nameBox.value : '(no box)';
    out.markBefore = nameRow ? nameRow.querySelector('.mm-lab').textContent : '';

    /* An event renames the actor. The box has not been touched, so it follows
       and the "edited" marker appears with it. */
    a.setName('Renamed By An Event');
    out.beforeTick = nameBox ? nameBox.value : '';
    tick();
    out.nameAfter = nameBox ? nameBox.value : '';
    out.markAfter = nameRow ? nameRow.querySelector('.mm-lab').textContent : '';

    /* Now the user is halfway through typing a nickname. The game changes it
       underneath and the box must not be taken away from them. */
    if (nickBox) nickBox.value = 'half-typed';
    a.setNickname('Changed Elsewhere');
    tick();
    out.nickKept = nickBox ? nickBox.value : '';

    a.setName(keep.name); a.setNickname(keep.nick);
    if (nickBox) nickBox.value = keep.nick;
    tick();
    U.setOpen(false);
    return out;
  });
  check('an actor renamed by the game shows in Player → Identity, and the "edited" marker appears with it',
    identity.beforeTick === identity.nameBefore &&
    identity.nameAfter === 'Renamed By An Event' &&
    identity.markAfter.indexOf('edited') > -1, JSON.stringify(identity));
  check('and a field somebody is halfway through typing into is left alone, however far the game has moved on',
    identity.nickKept === 'half-typed', JSON.stringify(identity));

  /* ======================================================================
     WORLD → SCAN and WORLD → BULK
     =================================================================== */
  const scan = await ev(() => {
    const G = window.GigaHack, U = G.ui, V = G.vars;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const id = 7;
    const keep = $gameVariables.value(id);

    $gameVariables.setValue(id, 4242);
    V.scanReset();
    V.scanKind('var');
    V.scanRun('equals', 4242, 0);
    out.candidates = V.scanCandidates().length;

    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Scan';
    U.rerender();

    const cells = () => {
      const tds = document.querySelectorAll('#mm-root .mm-tbody .mm-td-val');
      return Array.prototype.map.call(tds, (t) => t.textContent).join(',');
    };
    out.before = cells();

    /* The game moves the number this scan exists to watch. The monitor sees
       it on its own frame hook, which is what moves the revision. */
    $gameVariables.setValue(id, 5150);
    // The change monitor runs on $.onFrame, so one frame is what turns a
    // write into a revision. This is the engine's own step, not a shortcut.
    const r0 = V.revision();
    G.frame();
    out.revisionMoved = V.revision() !== r0;
    out.beforeTick = cells();
    tick();
    out.after = cells();

    $gameVariables.setValue(id, keep);
    G.frame();
    V.scanReset();
    U.setOpen(false);
    return out;
  });
  check('a candidate\'s value on World → Scan follows the game, which is the whole point of scanning for how a number moved',
    scan.revisionMoved === true && scan.before.indexOf('4242') > -1 &&
    scan.beforeTick === scan.before && scan.after.indexOf('5150') > -1,
    JSON.stringify(scan));

  const bulk = await ev(() => {
    const G = window.GigaHack, U = G.ui, V = G.vars;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const keep = $gameVariables.value(3);

    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Bulk';
    U.rerender();

    const body = document.querySelector('#mm-root .mm-tbody');
    const rowNodes = () => Array.prototype.slice.call(body.querySelectorAll('.mm-tr'));
    const before = rowNodes();
    out.rows = before.length;
    out.textBefore = body.textContent.slice(0, 200);

    $gameVariables.setValue(3, 77777);
    G.frame();
    out.beforeTick = body.textContent.indexOf('77777') > -1;
    tick();
    out.after = body.textContent.indexOf('77777') > -1;

    /* The rows themselves are the same DOM nodes. This table is not virtual,
       so a paint would empty the body and the browser would clamp the reader's
       scroll to the top with it. */
    const after = rowNodes();
    out.sameNodes = after.length === before.length && after.every((n, i) => n === before[i]);

    $gameVariables.setValue(3, keep);
    G.frame();
    tick();
    U.setOpen(false);
    return out;
  });
  check('the "now" column of World → Bulk follows the game without rebuilding a single row, so the reader\'s place in the range survives it',
    bulk.beforeTick === false && bulk.after === true && bulk.sameNodes === true,
    JSON.stringify(bulk));

  /* ======================================================================
     WORLD → TELEPORT
     =================================================================== */
  const teleport = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const keep = { x: $gamePlayer._x, y: $gamePlayer._y };

    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Teleport';
    U.rerender();

    /* The value NODE, not its text. Selecting a map rebuilds this whole
       column through refreshPanel(), and that is what a repaint on a clock
       must never do: the X and Y boxes, the landing dropdown and the two-click
       teleport button all live in it. Holding the node and finding it still
       there is how "the column was not rebuilt" is asserted without having to
       type into a control to prove it. */
    const nodeFor = (label) => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === label) return labs[i].parentNode.children[1];
      }
      return null;
    };
    const posNode = nodeFor('Position');
    const mapNode = nodeFor('Map');
    out.before = posNode ? posNode.textContent : '';

    $gamePlayer._x = keep.x + 4;
    out.beforeTick = posNode ? posNode.textContent : '';
    tick();
    out.after = posNode ? posNode.textContent : '';
    out.want = $gamePlayer.x + ',' + $gamePlayer.y;
    out.sameNode = posNode === nodeFor('Position') && mapNode === nodeFor('Map');

    $gamePlayer._x = keep.x; $gamePlayer._y = keep.y;
    tick();
    U.setOpen(false);
    return out;
  });
  check('World → Teleport keeps its "Position" readout up to date, and does it by rewriting the value rather than rebuilding the column the target boxes live in',
    teleport.beforeTick === teleport.before && teleport.after === teleport.want &&
    teleport.after !== teleport.before && teleport.sameNode === true, JSON.stringify(teleport));

  /* ======================================================================
     WORLD → COMMANDS
     =================================================================== */
  const commands = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const evt = $gameMap.events()[0];
    const keepSelected = G.events.selected();
    const key = [$gameMap.mapId(), evt.eventId(), 'A'];
    const keepSelf = $gameSelfSwitches.value(key);

    G.events.select(evt.eventId());
    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Commands';
    U.rerender();

    const activeText = () => {
      const spans = document.querySelectorAll('#mm-root .mm-toolbar .mm-sub');
      for (let i = 0; i < spans.length; i++) {
        if (spans[i].textContent.indexOf('active page') === 0) return spans[i].textContent;
      }
      return '';
    };
    const posValue = () => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === 'Position') return labs[i].parentNode.children[1].textContent;
      }
      return '';
    };
    out.pageBefore = activeText();
    out.posBefore = posValue();
    out.pages = G.events.info(evt).pageCount;

    /* The self-switch that decides which page runs, and a step to a new tile:
       both are the game's, and both were read exactly once. */
    $gameSelfSwitches.setValue(key, !keepSelf);
    evt.refresh();
    evt._x = evt._x + 1;
    out.beforeTick = activeText();
    tick();
    out.pageAfter = activeText();
    out.posAfter = posValue();
    out.want = 'active page: ' + (evt._pageIndex >= 0 ? evt._pageIndex + 1 : 'none');

    $gameSelfSwitches.setValue(key, keepSelf);
    evt._x = evt._x - 1;
    evt.refresh();
    tick();
    G.events.select(keepSelected ? keepSelected.eventId() : 0);
    U.setOpen(false);
    return out;
  });
  check('World → Commands reports which page the engine is actually running, and where the event is standing, rather than what both were when the panel opened',
    commands.beforeTick === commands.pageBefore &&
    commands.pageAfter === commands.want &&
    (commands.pageAfter !== commands.pageBefore || commands.posAfter !== commands.posBefore),
    JSON.stringify(commands));

  /* ======================================================================
     WORLD → GALLERY
     =================================================================== */
  const gallery = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    if (U.panelNames('world').indexOf('Gallery') < 0) { out.skipped = true; return out; }

    const sections = G.gallery.sections();
    const sec = sections.filter((s) => s.ids.some((id) => !$gameSwitches.value(id)))[0];
    if (!sec) { out.skipped = true; return out; }
    const flip = sec.ids.filter((id) => !$gameSwitches.value(id))[0];

    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Gallery';
    U.rerender();

    const body = document.querySelector('#mm-root .mm-tbody');
    const counts = () => body.textContent;
    const overall = () => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === 'Unlocked') return labs[i].parentNode.children[1].textContent;
      }
      return '';
    };
    out.rows = body.querySelectorAll('.mm-tr').length;
    out.before = counts();
    out.overallBefore = overall();
    const nodes = Array.prototype.slice.call(body.querySelectorAll('.mm-tr'));

    $gameSwitches.setValue(flip, true);
    G.frame();
    out.beforeTick = counts();
    tick();
    out.after = counts();
    out.overallAfter = overall();
    const nodes2 = Array.prototype.slice.call(body.querySelectorAll('.mm-tr'));
    out.sameNodes = nodes2.length === nodes.length && nodes2.every((n, i) => n === nodes[i]);

    $gameSwitches.setValue(flip, false);
    G.frame();
    tick();
    U.setOpen(false);
    return out;
  });
  check('a switch turned on by the game moves the collection counts and the overall total on World → Gallery, and does it without rebuilding a row',
    gallery.skipped === true ||
    (gallery.beforeTick === gallery.before && gallery.after !== gallery.before &&
     gallery.overallAfter !== gallery.overallBefore && gallery.sameNodes === true),
    JSON.stringify(gallery));

  /* ======================================================================
     ITEMS → ITEMS and ITEMS → GOLD
     =================================================================== */
  const items = await ev(() => {
    const G = window.GigaHack, U = G.ui, I = G.inv;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const item = I.list('item')[0];
    const keep = I.count(item);
    /* Away from the cap, whichever side of it this build's maxItems puts the
       first item on: a modded stack ceiling swallows a gain outright, and a
       check that then measured nothing would be measuring the cap. */
    const delta = keep > 0 ? -1 : 7;

    U.setOpen(true);
    G.cfg.ui.tab = 'items';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.items = 'Items';
    U.rerender();

    const body = document.querySelector('#mm-root .mm-tbody');
    const rowText = () => {
      const tr = body.querySelector('.mm-tr');
      return tr ? tr.textContent : '';
    };
    out.before = rowText();
    out.revBefore = I.revision();

    /* The game hands the party some of it. */
    $gameParty.gainItem(item, delta);
    out.moved = I.count(item) !== keep;
    out.revMoved = I.revision() !== out.revBefore;
    out.beforeTick = rowText();
    tick();
    out.after = rowText();
    out.want = String(I.count(item));

    $gameParty.gainItem(item, keep - I.count(item));
    tick();
    U.setOpen(false);
    return out;
  });
  check('the "have" column on Items → Items follows what the party is actually carrying, which the game changes on every use, sale and reward',
    items.moved === true && items.revMoved === true && items.beforeTick === items.before &&
    items.after !== items.before && items.after.indexOf(items.want) > -1,
    JSON.stringify(items));

  const gold = await ev(() => {
    const G = window.GigaHack, U = G.ui, I = G.inv;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const keep = I.gold();

    U.setOpen(true);
    G.cfg.ui.tab = 'items';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.items = 'Gold';
    U.rerender();

    const rowValue = (label) => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === label) return labs[i].parentNode.children[1].textContent;
      }
      return '';
    };
    const setBox = (() => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].firstChild && labs[i].firstChild.textContent === 'Set to') {
          return labs[i].parentNode.querySelector('input');
        }
      }
      return null;
    })();
    if (setBox) setBox.value = '999999';

    out.before = rowValue('Current');
    out.itemsBefore = rowValue('Items');

    $gameParty.gainGold(1234);
    const it = I.list('item')[0];
    const keepIt = I.count(it);
    $gameParty.gainItem(it, keepIt > 0 ? -1 : 5);
    out.itemMoved = I.count(it) !== keepIt;
    out.beforeTick = rowValue('Current');
    tick();
    out.after = rowValue('Current');
    out.itemsAfter = rowValue('Items');
    out.boxKept = setBox ? setBox.value : '(no box)';

    $gameParty.gainGold(keep - I.gold());
    $gameParty.gainItem(it, keepIt - I.count(it));
    tick();
    U.setOpen(false);
    return out;
  });
  check('Items → Gold follows the purse and the carried totals, and leaves the amount somebody has typed into the box alone',
    gold.itemMoved === true && gold.beforeTick === gold.before && gold.after !== gold.before &&
    gold.itemsAfter !== gold.itemsBefore && gold.boxKept === '999999',
    JSON.stringify(gold));

  /* ======================================================================
     GAME → ACTIONS
     =================================================================== */
  const actions = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const keep = window.__inBattle;
    window.__inBattle = false;

    U.setOpen(true);
    G.cfg.ui.tab = 'game';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.game = 'Actions';
    U.rerender();

    const group = (() => {
      const heads = document.querySelectorAll('#mm-root .mm-group-hd');
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].textContent.indexOf('This battle') === 0) return heads[i].parentNode;
      }
      return null;
    })();
    const win = group ? group.querySelector('.mm-btn-danger') : null;
    const tagText = () => {
      const t = group ? group.querySelector('.mm-group-tag') : null;
      return t ? t.textContent : '';
    };
    out.disabledBefore = !!(win && win.classList.contains('mm-dis'));
    out.tagBefore = tagText();

    /* Open the tab on the map, then walk into a fight. */
    window.__inBattle = true;
    out.beforeTick = !!(win && win.classList.contains('mm-dis'));
    tick();
    out.disabledAfter = !!(win && win.classList.contains('mm-dis'));
    out.tagAfter = tagText();

    window.__inBattle = false;
    tick();
    out.deadAgain = !!(win && win.classList.contains('mm-dis'));

    window.__inBattle = keep;
    tick();
    U.setOpen(false);
    return out;
  });
  check('walking into a fight with Game → Actions already open makes instant win and instant lose live, instead of leaving them greyed until the panel is reopened',
    actions.disabledBefore === true && actions.beforeTick === true &&
    actions.disabledAfter === false && actions.tagAfter === 'live' &&
    actions.tagBefore === 'no battle' && actions.deadAgain === true,
    JSON.stringify(actions));

  /* ======================================================================
     GAME → ACHIEVEMENTS

     The panel exists only where a binding was found, so the check supplies
     one — and takes it away again, along with the panel it caused to be
     registered.
     =================================================================== */
  const steam = await ev(() => {
    const G = window.GigaHack, U = G.ui, S = G.steam;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const unlocked = {};
    window.greenworks = {
      isSteamRunning: function () { return true; },
      getNumberOfAchievements: function () { return 2; },
      getAchievementName: function (i) { return ['LIVE_ONE', 'LIVE_TWO'][i]; },
      activateAchievement: function (name, ok) { unlocked[name] = true; if (ok) ok(); return true; },
      clearAchievement: function (name, ok) { delete unlocked[name]; if (ok) ok(); return true; },
      getAchievement: function (name, cb) { if (cb) cb(!!unlocked[name]); return !!unlocked[name]; }
    };
    S.recheck('a live-panel check');
    out.registered = U.panelNames('game').indexOf('Achievements') > -1;

    U.setOpen(true);
    G.cfg.ui.tab = 'game';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.game = 'Achievements';
    U.rerender();

    const body = document.querySelector('#mm-root .mm-tbody');
    out.before = body ? body.textContent : '';
    out.revBefore = S.revision();

    /* An answer arriving from Steam long after the panel was drawn. */
    S.unlock('LIVE_TWO');
    out.revMoved = S.revision() !== out.revBefore;
    out.beforeTick = body ? body.textContent : '';
    tick();
    out.after = body ? body.textContent : '';

    delete window.greenworks;
    S.env(true);
    S.list(true);
    U.removePanel('game', 'Achievements');
    G.cfg.ui.sub.game = 'Actions';
    U.setOpen(false);
    return out;
  });
  check('an answer arriving from Steam repaints the state column on Game → Achievements, which used to say "…" for as long as the panel stayed open',
    steam.registered === true && steam.revMoved === true &&
    steam.beforeTick === steam.before &&
    steam.before.indexOf('unlocked') === -1 && steam.after.indexOf('unlocked') > -1,
    JSON.stringify({ reg: steam.registered, rev: steam.revMoved, b: steam.before.slice(0, 80), a: steam.after.slice(0, 80) }));

  /* ======================================================================
     DEBUG → SAVES and DEBUG → TRANSFER
     =================================================================== */
  const saves = await ev(() => {
    const G = window.GigaHack, U = G.ui, S = G.saveTools;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};

    U.setOpen(true);
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.debug = 'Saves';
    U.rerender();

    const body = document.querySelector('#mm-root .mm-tbody');
    out.before = body ? body.textContent.slice(0, 300) : '';
    /* Compared whole and REPORTED short. The probe is opaque on purpose —
       whichever of the three the build can afford — and on the engine that
       has to fetch its index the value is the index, where a playtime change
       lands well past the first sixty characters. A truncated comparison
       passed for the wrong reason and would have kept passing for it. */
    const sigBefore = S.slotSignature();
    out.sig = sigBefore.slice(0, 60);

    /* The GAME writes a slot: an autosave, or an event that saves. Nothing
       tells this module, so the timestamp is what has to be noticed.

       A slot that already has a FILE, where there is one: MV's own
       loadGlobalInfo drops every entry whose file does not exist, so an entry
       invented for an empty slot is deleted again by the next read. That is
       the engine being right, not the harness being awkward. */
    const slots = S.slots();
    const target = (slots.filter((r) => r.exists)[0] || slots[0]).id;
    const wasPlaytime = (slots.filter((r) => r.id === target)[0] || {}).playtime;
    out.target = target;
    let wrote = false;
    G.eng.updateGlobalInfo(function (gi) {
      gi[target] = gi[target] || {};
      gi[target].playtime = '99:59:59';
      wrote = true;
    });
    out.wrote = wrote;
    out.sigMoved = S.slotSignature() !== sigBefore;
    out.beforeTick = body ? body.textContent.indexOf('99:59:59') > -1 : false;
    tick();
    out.after = body ? body.textContent.indexOf('99:59:59') > -1 : false;

    G.eng.updateGlobalInfo(function (gi) {
      if (gi[target]) gi[target].playtime = wasPlaytime;
    });
    tick();
    U.setOpen(false);
    return out;
  });
  check('a slot the GAME wrote — an autosave, or an event that saves — shows on Debug → Saves without the panel being reopened',
    saves.wrote === true && saves.sigMoved === true &&
    saves.beforeTick === false && saves.after === true, JSON.stringify(saves));

  const transfer = await ev(() => {
    const G = window.GigaHack, U = G.ui, S = G.saveTools;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const keep = Graphics.frameCount;

    /* This panel refuses to build without a filesystem, and the harness runs
       in a browser — so the two answers it asks for are supplied and put back.
       Nothing else about the panel is faked: every path it prints resolves to
       null and it says so, exactly as it would on a real build with no fs. */
    const keepMode = G.paths.mode;
    const keepAvail = G.backup.available;
    G.paths.mode = 'fs';
    G.backup.available = function () { return true; };
    out.why = G.saveTools.transferWhy();

    U.setOpen(true);
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.debug = 'Transfer';
    U.rerender();

    const rowValue = (label) => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === label) return labs[i].parentNode.children[1].textContent;
      }
      return '';
    };
    const hoursBox = (() => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].firstChild && labs[i].firstChild.textContent === 'Hours') {
          return labs[i].parentNode.querySelector('input');
        }
      }
      return null;
    })();
    if (hoursBox) hoursBox.value = '42';

    out.before = rowValue('Playtime');
    Graphics.frameCount = keep + 60 * 60 * 3;      // three minutes of play
    out.beforeTick = rowValue('Playtime');
    tick();
    out.after = rowValue('Playtime');
    out.want = S.playtimeText();
    out.boxKept = hoursBox ? hoursBox.value : '(no box)';

    Graphics.frameCount = keep;
    tick();
    G.paths.mode = keepMode;
    G.backup.available = keepAvail;
    G.cfg.ui.sub.debug = 'Saves';
    U.setOpen(false);
    return out;
  });
  check('the playtime on Debug → Transfer keeps up with the running game while the Hours box beside it keeps what is being typed into it',
    transfer.why === null && transfer.beforeTick === transfer.before &&
    transfer.after === transfer.want && transfer.after !== transfer.before &&
    transfer.boxKept === '42', JSON.stringify(transfer));

  /* ======================================================================
     DEBUG → LOG
     =================================================================== */
  const log = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};

    U.setOpen(true);
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.debug = 'Log';
    U.rerender();

    const tagOf = (title) => {
      const heads = document.querySelectorAll('#mm-root .mm-group-hd');
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].textContent.indexOf(title) === 0) {
          const t = heads[i].querySelector('.mm-group-tag');
          return t ? t.textContent : '';
        }
      }
      return '';
    };
    const body = document.querySelector('#mm-root .mm-tbody');
    const MARK = 'zqx-live-marker';

    /* The table is virtual, so only the rows in the window are in the DOM and
       a line appended to four hundred others would not be among them. The
       panel's own search box is what a reader would use to find it, so the
       check uses that: with the filter on, the new line is the only row there
       is, which is also a repaint the filter has to survive. */
    const search = document.querySelector('#mm-root .mm-search input');
    search.value = MARK;
    search.dispatchEvent(new Event('input', { bubbles: true }));

    out.countBefore = tagOf('Log');
    out.heldBefore = tagOf('Breakdown');
    out.emptyFirst = body ? body.textContent.indexOf(MARK) === -1 : false;

    G.log('warn', MARK + ' — a line said while the panel was open');
    out.beforeTick = body ? body.textContent.indexOf(MARK) > -1 : false;
    tick();
    out.after = body ? body.textContent.indexOf(MARK) > -1 : false;
    out.filterKept = search.value === MARK;
    out.countAfter = tagOf('Log');
    out.heldAfter = tagOf('Breakdown');

    /* Tail following, with the filter off so the list is long enough to have
       a tail at all. */
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    body.scrollTop = body.scrollHeight;
    const wasAtTail = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
    G.log('info', 'another one');
    tick();
    out.followedTail = wasAtTail &&
      body.scrollTop + body.clientHeight >= body.scrollHeight - 4;

    /* Scrolled up, stay where you are. */
    body.scrollTop = 0;
    G.log('info', 'and another');
    tick();
    out.keptPlace = body.scrollTop === 0;

    U.setOpen(false);
    return out;
  });
  check('Debug → Log fills while it is open, so it and the shell\'s own log drawer no longer disagree on the same screen',
    log.emptyFirst === true && log.beforeTick === false && log.after === true &&
    log.countAfter !== log.countBefore && log.heldAfter !== log.heldBefore,
    JSON.stringify(log));
  check('and the search somebody typed still filters what arrives, rather than being reset by the repaint',
    log.filterKept === true && log.after === true, JSON.stringify(log));
  check('and it follows the tail for a reader who is at the tail, and holds the place of one who is not',
    log.followedTail === true && log.keptPlace === true, JSON.stringify(log));

  /* ======================================================================
     GAME → HISTORY, ON THE GAME'S OWN BACKLOG

     The recorder's side of this panel is checked in run.js against
     T.history.revision(). This is the other source, whose log belongs to the
     game: a ring, capped by the adapter, which the panel used to key its
     repaint on the LENGTH of. Everything below happens past the cap, because
     under the cap the defect does not exist and a full log is the steady
     state rather than the awkward case.
     =================================================================== */
  const backlog = await ev(() => {
    const G = window.GigaHack, T = G.text, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const MAX = 5;
    const lines = [];
    /* A real ring, because a ring is the whole point: a push past the cap
       drops the oldest and leaves the count exactly where it was. */
    const say = (t) => { lines.push(t); while (lines.length > MAX) lines.shift(); };
    const real = G.profile.adapter;
    G.profile.adapter = function (slot) {
      if (slot === 'backlog') {
        return {
          available: function () { return true; },
          read: function () { return lines.slice(); },
          max: function () { return MAX; }
        };
      }
      return real.call(G.profile, slot);
    };
    try {
      /* Opened BELOW the cap, so the count has somewhere to move before the
         interesting half: a check that only ever ran against a full ring
         could not tell a count that follows from one that is simply always
         right by accident. */
      for (let i = 1; i <= MAX - 2; i++) say('line ' + i);

      U.setOpen(true);
      G.cfg.ui.tab = 'game';
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub.game = 'History';
      G.store.cfgSet('text.history.source', "the game's own");
      U.rerender();

      const bodyText = () => document.querySelector('#mm-root .mm-body').textContent;
      const keptCell = () => {
        const labs = document.querySelectorAll('#mm-root .mm-lab');
        for (let i = 0; i < labs.length; i++) {
          if (labs[i].textContent === 'Lines kept') return labs[i].parentNode.children[1].textContent;
        }
        return '';
      };
      const tableAtBuild = document.querySelector('#mm-root .mm-table');
      out.builtRows = tableAtBuild ? tableAtBuild.mm.rows().length : 0;
      out.builtShowsOldest = bodyText().indexOf('line 1') > -1;
      out.builtKept = keptCell();

      /* Under the cap: the count moves, and the cell beside the list moves
         with it. */
      say('line ' + (MAX - 1));
      tick();
      out.grewKept = keptCell();
      out.grewRows = tableAtBuild ? tableAtBuild.mm.rows().length : 0;

      /* Now full. From here on the count is pinned and every push is a swap. */
      say('line ' + MAX);
      tick();
      out.saturated = lines.length === MAX;
      out.fullKept = keptCell();

      const stampBefore = T.backlogStamp();
      const countBefore = T.backlog().length;
      say('the newest line');
      /* The two answers to "has it changed", side by side. The count is what
         the panel used to ask, and it cannot move again for the rest of the
         session. */
      out.countPinned = T.backlog().length === countBefore;
      out.stampMoved = T.backlogStamp() !== stampBefore;

      out.beforeTick = bodyText().indexOf('the newest line') > -1;
      tick();
      out.afterTick = bodyText().indexOf('the newest line') > -1;
      out.rolledOffGone = bodyText().indexOf('line 1') === -1;
      out.sameTable = document.querySelector('#mm-root .mm-table') === tableAtBuild;
      out.keptAfter = keptCell();
    } finally {
      G.profile.adapter = real;
      G.store.cfgSet('text.history.source', 'recorded here');
      U.rerender();
      U.setOpen(false);
    }
    return out;
  });
  check('a line said past the cap of the game\'s own backlog reaches Game → History, where a repaint keyed on the row count could never have seen it — the count is pinned the moment the ring fills',
    backlog.saturated === true && backlog.countPinned === true &&
    backlog.stampMoved === true && backlog.beforeTick === false &&
    backlog.afterTick === true && backlog.rolledOffGone === true &&
    backlog.sameTable === true, JSON.stringify(backlog));
  check('and the "Lines kept" count beside the list follows the list while there is still room in the ring, so the two never disagree',
    backlog.builtKept === String(backlog.builtRows) &&
    backlog.grewKept === String(backlog.grewRows) &&
    backlog.grewKept !== backlog.builtKept &&
    backlog.keptAfter === backlog.fullKept, JSON.stringify(backlog));

  /* ======================================================================
     WORLD → SELF

     The panel with the two-click button in every row. It repainted on a bare
     tick hook — no change signal, no visibility test — so the armed state of
     a "reset" lived at most until the next 700ms tick, and the reader got a
     random slice of the 2600ms confirm window to land the second click in.
     =================================================================== */
  const selfsw = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const LETTERS = ['A', 'B', 'C', 'D'];
    const mapId = $gameMap.mapId();
    const evt = $gameMap.events()[0];
    const id = evt.eventId();
    const keepSelf = {}, keepX = evt._x;
    LETTERS.forEach((L) => { keepSelf[L] = $gameSelfSwitches.value([mapId, id, L]); });
    const keepConfirm = G.store.cfgGet('behaviour.confirmDangerous', true);
    /* Both halves of the button's own gate, stated rather than assumed: a
       read-only session refuses the click outright and would make "the second
       click cleared A-D" fail for a reason that has nothing to do with the
       repaint. */
    const keepRO = G.store.cfgGet('behaviour.readonly', false);
    G.store.cfgSet('behaviour.readonly', false);
    G.store.cfgSet('behaviour.confirmDangerous', true);
    LETTERS.forEach((L) => { $gameSelfSwitches.setValue([mapId, id, L], true); });

    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Self';
    U.rerender();

    const table = document.querySelector('#mm-root .mm-table');
    /* Re-queried every time, never held: a node detached by a repaint keeps
       the classes it was wearing, so a held reference answers "still armed"
       about a button that is no longer on screen. */
    const rowOf = (n) => {
      const trs = document.querySelectorAll('#mm-root .mm-tbody .mm-tr');
      for (let i = 0; i < trs.length; i++) {
        if (trs[i].children[0].textContent === String(n)) return trs[i];
      }
      return null;
    };
    const posOf = (n) => { const tr = rowOf(n); return tr ? tr.children[2].textContent : ''; };
    const armedNode = () => table.querySelector('.mm-armed');

    out.builtPos = posOf(id);
    out.builtSet = rowOf(id) ? rowOf(id).getAttribute('data-mm-tip') : '';

    /* Nothing has changed. A panel with no change signal rebuilds anyway, and
       the row node is how you tell. */
    const trBefore = rowOf(id);
    tick();
    out.idleKeptTheSameNode = rowOf(id) === trBefore;

    /* First click: the button arms and waits. */
    const btn = trBefore.querySelector('.mm-btn-danger');
    btn.click();
    out.armed = !!armedNode();

    /* The game moves the event while the question is on screen. The signal
       moves with it — the x,y column is real — and the repaint must not. */
    evt._x = keepX + 3;
    tick(); tick();
    out.stillArmed = !!armedNode();
    out.heldStale = posOf(id) === out.builtPos;

    /* Second click, on the button that is still there. */
    const arm = armedNode();
    if (arm) arm.click();
    out.cleared = LETTERS.every((L) => !$gameSelfSwitches.value([mapId, id, L]));

    /* And with nothing armed the panel is live again. */
    evt._x = keepX + 4;
    tick();
    out.posFollowed = posOf(id) === (evt.x + ',' + evt.y);

    /* Closed, the 700ms clock still runs. The panel it cannot be seen on must
       not be walking every event on the map for it. setOpen(true) rebuilds
       the tab, so this is measured while it is still shut. */
    U.setOpen(false);
    const trClosed = rowOf(id);
    const posClosed = posOf(id);
    evt._x = keepX + 7;
    tick(); tick();
    out.closedKeptTheSameNode = rowOf(id) === trClosed;
    out.closedKeptTheText = posOf(id) === posClosed;

    evt._x = keepX;
    LETTERS.forEach((L) => { $gameSelfSwitches.setValue([mapId, id, L], keepSelf[L]); });
    G.store.cfgSet('behaviour.confirmDangerous', keepConfirm);
    G.store.cfgSet('behaviour.readonly', keepRO);
    return out;
  });
  check('World → Self does not rebuild its rows on a tick that changed nothing, which is what took the first click off an armed "reset" before the second one could land',
    selfsw.idleKeptTheSameNode === true, JSON.stringify(selfsw));
  check('an armed "reset" survives the event walking underneath it, and its second click really does clear A–D',
    selfsw.armed === true && selfsw.stillArmed === true && selfsw.heldStale === true &&
    selfsw.cleared === true, JSON.stringify(selfsw));
  check('and with nothing armed the x,y column follows the event again — the hold deferred the repaint rather than eating it',
    selfsw.posFollowed === true && selfsw.builtPos !== '', JSON.stringify(selfsw));
  check('with the menu shut, World → Self walks nothing: the shell\'s clock runs whether or not anyone can see the panel',
    selfsw.closedKeptTheSameNode === true && selfsw.closedKeptTheText === true,
    JSON.stringify(selfsw));

  /* ======================================================================
     WORLD → EVENTS

     The same bare tick hook as Self, one panel along, and the more expensive
     one: E.list().map(E.info) allocates a row object and scans a page for
     transfer commands per event, on every tick, forever, with the menu shut.
     No armed buttons in these rows — the two claims here are that a tick
     which changed nothing changes nothing, and that a shut menu costs the
     panel nothing at all.
     =================================================================== */
  const eventList = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const evt = $gameMap.events()[0];
    const id = evt.eventId();
    const keepX = evt._x;

    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Events';
    U.rerender();

    /* Column 0 is the trigger dot, so the id is column 1 and x,y is 3. */
    const rowOf = (n) => {
      const trs = document.querySelectorAll('#mm-root .mm-tbody .mm-tr');
      for (let i = 0; i < trs.length; i++) {
        if (trs[i].children[1].textContent === String(n)) return trs[i];
      }
      return null;
    };
    const posOf = (n) => { const tr = rowOf(n); return tr ? tr.children[3].textContent : ''; };

    out.builtPos = posOf(id);
    const trBefore = rowOf(id);
    tick();
    out.idleKeptTheSameNode = rowOf(id) === trBefore;

    /* It walks. The x,y column is real, so the list follows it. */
    evt._x = keepX + 2;
    out.beforeTick = posOf(id);
    tick();
    out.afterTick = posOf(id);
    out.want = evt.x + ',' + evt.y;

    /* Shut. Nothing may be walked for a panel nobody can see. */
    U.setOpen(false);
    const trClosed = rowOf(id);
    const posClosed = posOf(id);
    evt._x = keepX + 5;
    tick(); tick();
    out.closedKeptTheSameNode = rowOf(id) === trClosed;
    out.closedKeptTheText = posOf(id) === posClosed;

    evt._x = keepX;
    return out;
  });
  check('World → Events follows an event as it walks, and does not rebuild a row on a tick that changed nothing',
    eventList.idleKeptTheSameNode === true && eventList.beforeTick === eventList.builtPos &&
    eventList.afterTick === eventList.want && eventList.afterTick !== eventList.builtPos,
    JSON.stringify(eventList));
  check('and with the menu shut it walks nothing at all — the list is the most expensive thing on the tab to rebuild',
    eventList.closedKeptTheSameNode === true && eventList.closedKeptTheText === true,
    JSON.stringify(eventList));

  /* ======================================================================
     WORLD → COMMANDS, ACROSS A TRANSFER

     E.selected() is map-scoped because event ids repeat across maps. The live
     hook was not: it held the Game_Event captured at build, which after a
     transfer is on no map at all while its event() resolves against the new
     map's data — one map's position and page index beside another map's page
     conditions, all three presented as current.
     =================================================================== */
  const commandsAcross = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = {};
    const here = $gameMap.mapId();
    const evt = $gameMap.events()[0];
    const keepSelected = G.events.selected();

    G.events.select(evt.eventId());
    U.setOpen(true);
    G.cfg.ui.tab = 'world';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.world = 'Commands';
    U.rerender();

    const bodyText = () => document.querySelector('#mm-root .mm-body').textContent;
    const rowValue = (label) => {
      const labs = document.querySelectorAll('#mm-root .mm-lab');
      for (let i = 0; i < labs.length; i++) {
        if (labs[i].textContent === label) return labs[i].parentNode.children[1].textContent;
      }
      return null;
    };
    out.builtPos = rowValue('Position');
    out.builtSaysEvent = bodyText().indexOf('no event selected') === -1;

    /* (a) The world is rebuilt underneath it, on the SAME map — a load, or a
       map refresh. Every Game_Event is a new object with the old id, so a
       guard written as an id comparison would call the detached one current
       and go on reading its position for the rest of the session. */
    const fresh = new Game_Event(evt.eventId(), evt._name, evt._x + 4, evt._y);
    $gameMap._events[evt.eventId()] = fresh;
    out.freshIsNotTheOldOne = G.events.selected() === fresh && fresh !== evt;
    out.freshPos = fresh.x + ',' + fresh.y;
    tick();
    out.rebuiltPos = rowValue('Position');

    /* (b) Through the door. Moved the way the harness's own Game_Player.
       reserveTransfer moves it — an own mapId on $gameMap, which is what a
       transfer leaves behind here — rather than by writing _mapId, which an
       earlier transfer in this suite has already shadowed. The captured event
       is on no map now, while its event() resolves against the new map's data,
       and E.selected() answers null, which is the truth. */
    const ownMapId = Object.prototype.hasOwnProperty.call($gameMap, 'mapId')
      ? $gameMap.mapId : null;
    $gameMap.mapId = function () { return here + 1; };
    out.movedTo = $gameMap.mapId();
    out.selectedGone = G.events.selected() === null;
    tick();
    out.afterSaysNone = bodyText().indexOf('no event selected') > -1;
    out.afterHasPosition = rowValue('Position') !== null;

    /* (c) And back again, with nothing clicked. The selection was never
       cleared — it is scoped to this map — so the panel that says "pick one"
       is talking about an event that is selected. */
    if (ownMapId) $gameMap.mapId = ownMapId; else delete $gameMap.mapId;
    out.selectedAgain = G.events.selected() === fresh;
    tick();
    out.backPos = rowValue('Position');
    out.backSaysEvent = bodyText().indexOf('no event selected') === -1;

    $gameMap._events[evt.eventId()] = evt;
    G.events.select(keepSelected ? keepSelected.eventId() : 0);
    U.setOpen(false);
    return out;
  });
  check('World → Commands rebuilds when the event it was built for is no longer on this map, instead of painting one map\'s position beside another map\'s page conditions',
    commandsAcross.builtSaysEvent === true && commandsAcross.builtPos !== null &&
    commandsAcross.selectedGone === true && commandsAcross.afterSaysNone === true &&
    commandsAcross.afterHasPosition === false, JSON.stringify(commandsAcross));
  check('and a world rebuilt under it on the same map is followed to the NEW event object, which an id comparison would have mistaken for the detached one',
    commandsAcross.freshIsNotTheOldOne === true &&
    commandsAcross.rebuiltPos === commandsAcross.freshPos &&
    commandsAcross.rebuiltPos !== commandsAcross.builtPos, JSON.stringify(commandsAcross));
  check('and the panel comes back on its own when the selection is valid again, rather than saying "pick one" about an event that is selected',
    commandsAcross.selectedAgain === true && commandsAcross.backSaysEvent === true &&
    commandsAcross.backPos === commandsAcross.freshPos, JSON.stringify(commandsAcross));

  /* ======================================================================
     DEBUG → SAVES — WHAT KEEPING IT LIVE COSTS

     Asserted in reads, not in a comment. The engine whose index is not
     memory resident re-reads and re-prunes the whole thing on every
     savefileInfo call that misses the per-FRAME cache, and a 700ms wall
     clock misses it every single time — so the frame counter is advanced
     between ticks here, exactly as the real clock does.
     =================================================================== */
  const savesCost = await ev(() => {
    const G = window.GigaHack, U = G.ui, S = G.saveTools;
    const host = U.getHost();
    const tick = () => host.tickHooks.slice().forEach(fn => fn(1));
    const out = { instrumented: typeof window.__globalInfoReads === 'number' };
    const keepFrames = Graphics.frameCount;

    U.setOpen(true);
    G.cfg.ui.tab = 'debug';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.debug = 'Saves';
    U.rerender();

    const reads = () => (out.instrumented ? window.__globalInfoReads : 0);
    const body = document.querySelector('#mm-root .mm-tbody');
    const before = reads();
    out.ticks = 10;
    for (let i = 0; i < out.ticks; i++) {
      Graphics.frameCount += 42;          // ~700ms of engine frames per tick
      tick();
    }
    out.idleReads = reads() - before;

    /* Still live: the game writes a slot and the row follows on the next
       tick, having paid for exactly the reads that answer changed. */
    const target = (S.slots().filter((r) => r.exists)[0] || S.slots()[0]).id;
    const wasPlaytime = (S.slots().filter((r) => r.id === target)[0] || {}).playtime;
    G.eng.updateGlobalInfo(function (gi) {
      gi[target] = gi[target] || {};
      gi[target].playtime = '88:88:88';
    });
    const beforeWrite = reads();
    Graphics.frameCount += 42;
    tick();
    out.noticed = body ? body.textContent.indexOf('88:88:88') > -1 : false;
    out.writeReads = reads() - beforeWrite;

    G.eng.updateGlobalInfo(function (gi) {
      if (gi[target]) gi[target].playtime = wasPlaytime;
    });
    tick();
    Graphics.frameCount = keepFrames;
    U.setOpen(false);
    return out;
  });
  if (ctx.IS_MV) {
    check('ten ticks of Debug → Saves with nothing saved re-read the save index ZERO times — it used to be one full re-read and an existence probe per savefile on every one of them',
      savesCost.instrumented === true && savesCost.idleReads === 0 &&
      savesCost.noticed === true && savesCost.writeReads <= 2,
      JSON.stringify(savesCost));
  } else {
    check('on an engine whose save index is memory resident there is no re-read to count, and the slot table follows a write anyway',
      savesCost.instrumented === false && savesCost.noticed === true,
      JSON.stringify(savesCost));
  }

  /* The branch a real desktop build takes, which the harness would otherwise
     never run: it is an honest browser, so $.env.fs is null and the probe
     falls through to the raw index above. The three things a desktop build
     has that this one does not are handed over here — a filesystem, a storage
     layer that says it is in local mode, and a file at the path the storage
     layer names — and nothing else about the harness is touched.

     The one block in this file that does not drive the clock: the claim is
     about what a single ask costs, so the probe is asked directly.

     Both halves of the stat move: the model advances a file's modification
     time on every write as well as reporting its size, so a rewrite of the
     SAME length — the case a size-only signal cannot see — is exercised here
     rather than reasoned about. It could not be when this was written; the
     model carried one constant mtime for every file and the note here said so.
     The model was fixed. */
  if (ctx.IS_MV) {
    const statProbe = await ev(() => {
      const G = window.GigaHack, S = G.saveTools;
      const out = {};
      const model = window.__nodeModel({});
      const keepFs = G.env.fs;
      const ownLocal = Object.prototype.hasOwnProperty.call(StorageManager, 'isLocalMode')
        ? StorageManager.isLocalMode : null;
      try {
        StorageManager.isLocalMode = function () { return true; };
        G.env.fs = model.fs;
        out.path = G.eng.savePath(0);
        out.noFileYet = S.slotSignature();
        model.add(out.path, '{"1":{"playtime":"00:10:00"}}');
        const readsBefore = window.__globalInfoReads;
        out.withFile = S.slotSignature();
        model.add(out.path, '{"1":{"playtime":"00:10:00"},"2":{"playtime":"01:00:00"}}');
        out.afterWrite = S.slotSignature();
        /* And the case only the mtime can answer: written over with a body of
           exactly the same length. A signal folding the size alone reports
           "nothing has changed" and the panel goes on showing the save that
           was displaced. */
        model.add(out.path, '{"1":{"playtime":"00:10:00"},"2":{"playtime":"09:99:99"}}');
        out.afterSameSize = S.slotSignature();
        out.reads = window.__globalInfoReads - readsBefore;
        out.statCalls = model.touched(out.path).filter((e) => e.op === 'statSync').length;

        /* A filesystem is not the same question as "the index is on it". A
           storage layer that has been pointed somewhere else writes no file
           at that path ever, and a stat of it would answer "nothing has
           changed" for the rest of the session — the exact failure the probe
           exists to avoid, wearing an optimisation's clothes. */
        StorageManager.isLocalMode = function () { return false; };
        out.notLocal = S.slotSignature();
      } finally {
        G.env.fs = keepFs;
        if (ownLocal) StorageManager.isLocalMode = ownLocal; else delete StorageManager.isLocalMode;
      }
      return out;
    });
    check('where the host has a filesystem the index is answered by stat-ing one file and never reading it — and no index file is an answer ("none"), not a failure',
      statProbe.noFileYet === 'none' && /^stat:/.test(statProbe.withFile) &&
      statProbe.afterWrite !== statProbe.withFile && statProbe.reads === 0 &&
      statProbe.statCalls === 3, JSON.stringify(statProbe));
    check('and it notices a rewrite of exactly the same length, which is the case a signal folding the size alone cannot see',
      statProbe.afterSameSize !== statProbe.afterWrite &&
      statProbe.afterSameSize.length === statProbe.afterWrite.length,
      JSON.stringify({ was: statProbe.afterWrite, now: statProbe.afterSameSize }));
    check('and a build whose storage layer is NOT on that filesystem is not stat-ed at all — it goes back to asking the storage layer, which is the only thing that knows',
      /^raw:/.test(statProbe.notLocal), JSON.stringify(statProbe));
  }

  /* Put the overlay back the way the rest of the suite expects to find it. */
  await ev((was) => {
    const G = window.GigaHack;
    G.ui.setOpen(false);
    G.cfg.ui.tab = was.tab;
    G.cfg.ui.sub = was.sub;
  }, wasOn);
};
