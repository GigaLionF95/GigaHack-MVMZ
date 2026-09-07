/* =============================================================================
   GigaHack MV/MZ — GigaHack_Screen.js

   The screen is the one area where a wrong answer is INVISIBLE: a tint written
   without its target is walked back with nothing in any log, a shake stopped by
   its duration alone leaves the picture three pixels to one side forever, and a
   black screen has four independent causes of which $gameScreen can only see
   two. Every check here is an attempt to make one of those failures loud.

   State discipline: the fixture's own drivers set every situation up and put it
   back, every undo entry this file pushes is popped again, and the last block
   restores the settings, the screen, the pictures, the interpreters and the
   spriteset — a later check must not inherit a paused, tinted or picture-laden
   game.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ;

  const MODULE = path.resolve(__dirname, '..', '..', 'gigahack', 'js', 'plugins', 'GigaHack_Screen.js');
  const SRC = fs.readFileSync(MODULE, 'utf8');

  /* The overlay is driven the way a person drives it: set the tab, rerender,
     read the text that ended up on screen. textContent rather than innerText,
     because a collapsed group is display:none and its copy still has to be
     there — a reason nobody can read is not a reason. */
  async function panelText(sub) {
    await ev((s) => {
      const G = window.GigaHack;
      G.ui.setOpen(true);
      G.cfg.ui.tab = 'game';
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub.game = s;
      G.ui.rerender();
    }, sub);
    return await ev(() => {
      const root = document.getElementById('mm-root');
      return root ? root.textContent : '';
    });
  }

  /* Everything this file pushes onto the shared undo stack is popped again at
     the end, so a later check that pops gets its own entry and not ours. */
  const undoBase = await ev(() => window.GigaHack.undo.size());

  await ev(() => {
    window.__raf.reset();
    SceneManager.requestUpdate();
    window.__unstickAll();
    window.__runNothing();
    window.GigaHack.screen.clearLog();
  });

  /* =======================================================================
     THE TARGET TRAP
     ==================================================================== */
  const trap = await ev(() => {
    const G = window.GigaHack, S = G.screen;
    const out = {};
    function walk(n) { for (let i = 0; i < n; i++) $gameScreen.update(); }

    /* A WALK ALREADY IN FLIGHT, which is what makes the trap a trap: an event
       said "tint back to clear over 30 frames" and the user reaches for the
       slider halfway through. */
    function inFlight() {
      $gameScreen.startTint([0, 0, 0, 0], 0);
      $gameScreen.startTint([0, 0, 0, 0], 30);
    }

    /* The naive write: the value alone. This is what every "just set _tone"
       cheat does, and the engine undoes it inside its own duration with
       nothing anywhere to say so. */
    inFlight();
    $gameScreen._tone = [-100, -100, -100, 0];
    walk(30);
    out.naive = $gameScreen.tone().slice();

    /* The module's write, into exactly the same in-flight walk. */
    inFlight();
    S.setTone([-100, -100, -100, 0], 0);
    out.immediate = $gameScreen.tone().slice();
    out.oursTarget = $gameScreen._toneTarget.slice();
    out.oursDuration = $gameScreen._toneDuration;
    walk(30);
    out.ours = $gameScreen.tone().slice();

    $gameScreen.clearTone();
    return out;
  });
  check('a tone written without its target is walked straight back by the engine within its duration, ' +
    'and the module\'s write is not',
    Math.abs(trap.naive[0]) < 1 && trap.ours.join(',') === '-100,-100,-100,0' &&
    trap.oursTarget.join(',') === '-100,-100,-100,0' && trap.oursDuration === 0,
    JSON.stringify(trap));
  check('an instant tint is on the screen the same frame it is written, not the next one',
    trap.immediate.join(',') === '-100,-100,-100,0', JSON.stringify(trap.immediate));

  const zoom = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    $gameScreen.clearZoom();
    /* The engine's own instant zoom, which does nothing at all. */
    $gameScreen.startZoom(100, 100, 2, 0);
    out.engineScale = $gameScreen.zoomScale();
    out.engineTarget = $gameScreen._zoomScaleTarget;
    $gameScreen.clearZoom();
    /* Ours. */
    S.setZoom(100, 100, 2, 0);
    out.scale = $gameScreen.zoomScale();
    out.target = $gameScreen._zoomScaleTarget;
    out.duration = $gameScreen._zoomDuration;
    out.x = $gameScreen.zoomX();
    $gameScreen.clearZoom();
    return out;
  });
  check('an instant zoom writes the scale as well as the target, because startZoom with a duration of ' +
    'zero moves nothing',
    zoom.engineScale === 1 && zoom.engineTarget === 2 &&
    zoom.scale === 2 && zoom.target === 2 && zoom.duration === 0 && zoom.x === 100,
    JSON.stringify(zoom));

  /* =======================================================================
     THE SHAKE THAT NEVER SETTLES
     ==================================================================== */
  const shake = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    window.__stickShake();
    out.stuck = $gameScreen.shake();
    out.stuckDuration = $gameScreen._shakeDuration;
    out.diagnosis = S.diagnose().filter(d => d.id === 'shake')[0] || null;

    /* Clearing the duration alone, which is what a plugin that "stops" a shake
       usually does. */
    $gameScreen._shakeDuration = 0;
    for (let i = 0; i < 40; i++) $gameScreen.updateShake();
    out.afterDurationOnly = $gameScreen.shake();

    S.stopShake();
    out.afterStop = $gameScreen.shake();
    out.afterStopPower = $gameScreen._shakePower;
    for (let i = 0; i < 40; i++) $gameScreen.updateShake();
    out.settled = $gameScreen.shake();
    out.diagnosisAfter = S.diagnose().filter(d => d.id === 'shake').length;
    return out;
  });
  check('a shake run at power zero really does leave the offset behind, and the diagnosis names it',
    Math.abs(shake.stuck) > 0.01 && shake.stuckDuration <= 0 && !!shake.diagnosis &&
    /offset/.test(shake.diagnosis.what) && /sign flips/.test(shake.diagnosis.why),
    JSON.stringify(shake).slice(0, 260));
  check('stopping a shake writes the offset to zero as well as the duration, so the screen is not left ' +
    'permanently shifted',
    Math.abs(shake.afterDurationOnly) > 0.01 && shake.afterStop === 0 && shake.settled === 0 &&
    shake.diagnosisAfter === 0,
    JSON.stringify({ durationOnly: shake.afterDurationOnly, stop: shake.afterStop, settled: shake.settled }));

  /* =======================================================================
     PICTURES
     ==================================================================== */
  const picMove = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    $gameScreen.clearPictures();
    $gameScreen.showPicture(3, 'mover', 0, 0, 0, 100, 100, 255, 0);
    /* A move already in flight, which is the state a mid-cutscene edit lands in. */
    $gameScreen.movePicture(3, 0, 400, 300, 100, 100, 255, 0, 60, 0);

    /* The naive edit: the value without its target. */
    $gameScreen.picture(3)._x = 0;
    for (let i = 0; i < 10; i++) $gameScreen.updatePictures();
    out.naiveX = Math.round($gameScreen.picture(3)._x);

    /* Ours. */
    S.movePicture(3, { x: 0, y: 0 }, 0);
    out.oursX = Math.round($gameScreen.picture(3)._x);
    out.oursTargetX = Math.round($gameScreen.picture(3)._targetX);
    out.oursDuration = $gameScreen.picture(3)._duration;
    for (let i = 0; i < 10; i++) $gameScreen.updatePictures();
    out.oursAfterWalk = Math.round($gameScreen.picture(3)._x);

    $gameScreen.clearPictures();
    return out;
  });
  check('moving a picture writes every target beside its value, so the engine\'s easing does not drag it back',
    picMove.naiveX > 10 && picMove.oursX === 0 && picMove.oursTargetX === 0 &&
    picMove.oursDuration === 0 && picMove.oursAfterWalk === 0,
    JSON.stringify(picMove));

  const maxPic = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    out.live = S.maxPictures();
    out.engineSays = $gameScreen.maxPictures();

    /* Raise the project's own limit. One engine reads it and one does not, and
       the module asks the FUNCTION either way. */
    window.__setPictureLimit(120);
    out.raised = S.maxPictures();
    out.raisedEngineSays = $gameScreen.maxPictures();
    window.__clearPictureLimit();
    out.restored = S.maxPictures().n;

    /* No maxPictures() at all — a plugin can take it away. */
    const keep = Game_Screen.prototype.maxPictures;
    delete Game_Screen.prototype.maxPictures;
    out.without = S.maxPictures();
    Game_Screen.prototype.maxPictures = keep;
    return out;
  });
  check('the picture slot count comes from maxPictures() on the live object and the panel says where the ' +
    'number came from',
    maxPic.live.n === maxPic.engineSays && maxPic.live.from === '$gameScreen.maxPictures()' &&
    maxPic.without.n === 100 && /no maxPictures\(\) on this build/.test(maxPic.without.from),
    JSON.stringify(maxPic));
  check('raising the picture limit changes the slot count on a build that reads it and changes nothing on ' +
    'a build that does not, and neither answer is reached by asking which engine this is',
    maxPic.raised.n === maxPic.raisedEngineSays && maxPic.restored === 100 &&
    maxPic.raised.n === (IS_MZ ? 120 : 100),
    JSON.stringify({ raised: maxPic.raised.n, engine: maxPic.raisedEngineSays, restored: maxPic.restored }));

  const battleRange = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    $gameScreen.clearPictures();
    window.__showPictures();
    window.__showBattlePicture(1);

    out.mapSlot = S.picture(1);
    out.mapRange = S.state().pictures.range;

    window.__inBattle = true;
    out.battleSlot = S.picture(1);
    out.battleRange = S.state().pictures.range;
    window.__inBattle = false;

    out.max = S.maxPictures().n;
    return out;
  });
  check('a picture read during a battle names the battle range and says the same id is a different slot ' +
    'on the map',
    battleRange.mapSlot.name === 'title_bg' && battleRange.mapSlot.real === 1 &&
    battleRange.battleSlot.name === 'battle_overlay' &&
    battleRange.battleSlot.real === 1 + battleRange.max &&
    battleRange.battleSlot.inBattleRange === true &&
    battleRange.mapRange === 'map' && battleRange.battleRange === 'battle',
    JSON.stringify({ map: battleRange.mapSlot.name + '@' + battleRange.mapSlot.real,
      battle: battleRange.battleSlot.name + '@' + battleRange.battleSlot.real }));

  const census = await ev(() => {
    const S = window.GigaHack.screen;
    /* An occupied slot with an EMPTY name is a real state: showPicture with an
       empty name produces one, and so does the erase() one engine still has.
       The sprite reports itself visible with an empty bitmap, so "in use" and
       "showing something" are two questions with two answers. */
    const rows = S.pictures();
    const nameless = rows.filter(p => p.occupied && !p.showing);
    const st = S.state();
    return {
      used: st.pictures.used,
      named: st.pictures.named,
      namelessSlots: nameless.map(p => p.slot),
      differ: st.pictures.used !== st.pictures.named
    };
  });
  check('a slot that is occupied with no name counts as in use and not as showing something, because they ' +
    'are different questions',
    census.differ === true && census.namelessSlots.indexOf(4) > -1 &&
    census.used === census.named + census.namelessSlots.length,
    JSON.stringify(census));

  const aboveLimit = await ev(() => {
    const S = window.GigaHack.screen;
    const sprites = S.spriteCount();
    const r = S.showPicture(sprites + 5, 'beyond_the_limit', {});
    return {
      sprites: sprites,
      ok: r.ok,
      message: r.message,
      written: !!$gameScreen.picture(sprites + 5)
    };
  });
  check('a picture slot above the sprites the spriteset actually built is refused with that reason, rather ' +
    'than written where nothing can draw it',
    aboveLimit.sprites > 0 && aboveLimit.ok === false && aboveLimit.written === false &&
    /is above the \d+ picture sprite\(s\) this spriteset built/.test(aboveLimit.message),
    aboveLimit.message);

  const eraseAll = await ev(() => {
    const G = window.GigaHack, S = G.screen;
    const out = {};
    function occupied() {
      let n = 0;
      for (let i = 0; i < $gameScreen._pictures.length; i++) if ($gameScreen._pictures[i]) n++;
      return n;
    }
    out.before = occupied();
    out.max = S.maxPictures().n;
    out.hadBattleSlot = !!$gameScreen._pictures[1 + out.max];

    const undoBefore = G.undo.size();
    const r = S.eraseAllPictures();
    out.result = r.ok;
    out.cleared = r.cleared;
    out.after = occupied();
    out.oneUndo = G.undo.size() - undoBefore;

    G.undo.pop();
    out.restored = occupied();
    const p = $gameScreen.picture(1);
    /* The prototype is the point: a plain JSON round trip returns an object
       that answers every field and throws from inside updatePictures. */
    out.prototypeIntact = !!p && typeof p.name === 'function' && p.name() === 'title_bg';
    out.stillWalks = (function () {
      try { $gameScreen.updatePictures(); return true; } catch (e) { return false; }
    }());
    return out;
  });
  check('erasing every picture clears both ranges, and one undo puts them all back with their prototypes intact',
    eraseAll.before > 0 && eraseAll.hadBattleSlot === true && eraseAll.after === 0 &&
    eraseAll.oneUndo === 1 && eraseAll.restored === eraseAll.before &&
    eraseAll.prototypeIntact === true && eraseAll.stillWalks === true,
    JSON.stringify(eraseAll));

  /* =======================================================================
     WEATHER
     ==================================================================== */
  const weather = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    $gameScreen.clearWeather();
    out.clean = S.weatherTypes();

    /* A type this panel would never have offered, set by something else. */
    $gameScreen.changeWeather('ash', 5, 0);
    out.foreign = S.weatherTypes();
    out.liveType = $gameScreen.weatherType();

    $gameScreen.clearWeather();
    return out;
  });
  check('the weather list offers the engine\'s four and says they are the engine\'s own rather than the only ones',
    weather.clean.engine.join(',') === 'none,rain,storm,snow' &&
    weather.clean.options.join(',') === 'none,rain,storm,snow' &&
    weather.clean.extra === false && /the engine's own/.test(weather.clean.why) &&
    /no panel can enumerate them/.test(weather.clean.why),
    JSON.stringify(weather.clean));
  check('a weather type set by something else is shown as the current type even though the panel would ' +
    'never have offered it',
    weather.liveType === 'ash' && weather.foreign.current === 'ash' &&
    weather.foreign.extra === true && weather.foreign.options[0] === 'ash' &&
    weather.foreign.engine.indexOf('ash') < 0,
    JSON.stringify(weather.foreign));

  await ev(() => {
    window.__inBattle = true;
    window.GigaHack.screen.setWeather('rain', 5, 0);
  });
  const battleWeatherText = await panelText('Screen');
  const battleWeather = await ev(() => {
    const out = {
      type: $gameScreen.weatherType(),
      power: $gameScreen.weatherPower(),
      sprite: window.GigaHack.screen.weatherSprite()
    };
    window.__inBattle = false;
    $gameScreen.clearWeather();
    return out;
  });
  check('weather set during a battle is written and the panel says it will not be drawn until the map, ' +
    'rather than appearing to do nothing',
    battleWeather.type === 'rain' && battleWeather.power === 5 &&
    /written but not drawn until you are back on the map/.test(battleWeatherText),
    JSON.stringify({ type: battleWeather.type, said: /not drawn until you are back/.test(battleWeatherText) }));

  /* =======================================================================
     THE FOURTH CAUSE OF A BLACK SCREEN
     ==================================================================== */
  const sceneFade = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    window.__unstickAll();
    window.__stickSceneFade();
    out.read = S.sceneFade();
    out.brightness = $gameScreen.brightness();
    const d = S.diagnose();
    out.ids = d.map(x => x.id);
    out.entry = d.filter(x => x.id === 'sceneFade')[0] || null;
    return out;
  });
  const sceneFadeText = await panelText('Screen');
  const sceneFadeCleared = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    out.cleared = S.clearSceneFade();
    /* startFadeIn starts OPAQUE and decays; one turn of the scene's own fade
       is what finishes it, which is the engine's semantics and not ours. */
    SceneManager._scene.updateFade();
    out.after = S.sceneFade().opacity;
    out.ids = S.diagnose().map(x => x.id);
    return out;
  });
  check('a scene fade is reported as a scene fade and not as a brightness, and names the call that clears it',
    sceneFade.brightness === 255 && sceneFade.ids.indexOf('sceneFade') > -1 &&
    sceneFade.ids.indexOf('brightness') < 0 && !!sceneFade.entry &&
    /startFadeIn/.test(sceneFade.entry.fix) && /not on \$gameScreen/.test(sceneFade.entry.why),
    JSON.stringify(sceneFade.ids) + ' ' + (sceneFade.entry && sceneFade.entry.fix));
  check('the scene fade is read from whichever field this build has, and the panel prints which one it read',
    sceneFade.read.field === (IS_MZ ? '_fadeOpacity' : '_fadeSprite.opacity') &&
    sceneFadeText.indexOf(sceneFade.read.field) > -1,
    sceneFade.read.field);
  check('clearing the scene fade actually clears it, and the diagnosis stops naming it',
    sceneFadeCleared.cleared.ok === true && Math.round(sceneFadeCleared.after) === 0 &&
    sceneFadeCleared.ids.indexOf('sceneFade') < 0,
    JSON.stringify(sceneFadeCleared));

  const cover = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    window.__unstickAll();
    $gameScreen.clearPictures();
    /* Full opacity, normal blend, the untranslated origin, at the corner: the
       one picture shape that can be hiding the whole game. */
    $gameScreen.showPicture(2, 'a_cover', 0, 0, 0, 100, 100, 255, 0);
    const d = S.diagnose();
    out.ids = d.map(x => x.id);
    out.entry = d.filter(x => x.id === 'picture')[0] || null;
    /* Half-transparent, and it stops being a candidate. */
    $gameScreen.picture(2)._opacity = 128;
    out.idsFaded = S.diagnose().map(x => x.id);
    $gameScreen.clearPictures();
    return out;
  });
  check('a picture that could be covering the screen is named as the cause $gameScreen cannot see, and a ' +
    'half-transparent one is not',
    cover.ids.join(',') === 'picture' && !!cover.entry && /Pictures tab/.test(cover.entry.fix) &&
    cover.idsFaded.length === 0,
    JSON.stringify(cover));

  const clean = await ev(() => {
    window.__unstickAll();
    $gameScreen.clearPictures();
    return { n: window.GigaHack.screen.diagnose().length, state: window.GigaHack.screen.state() };
  });
  const cleanText = await panelText('Screen');
  check('the diagnosis says nothing is stuck when nothing is, instead of inventing a cause',
    clean.n === 0 && cleanText.indexOf('nothing on $gameScreen looks stuck.') > -1 &&
    /a black screen can also come from a picture covering it/.test(cleanText),
    clean.n + ' entries');

  /* =======================================================================
     VERIFY, DEGRADE AND DRIFT
     ==================================================================== */
  const degrade = await ev(() => {
    const G = window.GigaHack, S = G.screen;
    const out = {};
    G.compat.clearDegraded();
    /* A plugin that takes the write and recomputes it away. The live function
       is swapped, so the mod's own alias is bypassed exactly as it would be. */
    const keep = Game_Screen.prototype.startTint;
    Game_Screen.prototype.startTint = function () { };
    const r = S.setTone([-68, -68, -68, 0], 0);
    out.ok = r.ok;
    out.message = r.message;
    out.degraded = G.compat.isDegraded('screen.tone');
    out.why = G.compat.degradedWhy('screen.tone');
    Game_Screen.prototype.startTint = keep;
    return out;
  });
  const degradeText = await panelText('Screen');
  await ev(() => {
    window.GigaHack.compat.clearDegraded('screen.tone');
    window.__unstickAll();
  });
  check('every mutating screen control routes through $.compat.verify, and greys itself with the reason ' +
    'when the write does not stick',
    degrade.ok === false && degrade.degraded === true &&
    /wrote .* to screen\.tone and read back/.test(degrade.why) &&
    degradeText.indexOf('writes here are not sticking.') > -1,
    JSON.stringify({ ok: degrade.ok, degraded: degrade.degraded }));
  check('a write that no plugin the quirks table knows is responsible for says exactly that, rather than ' +
    'naming a plugin',
    /No loaded plugin is known to touch this/.test(degrade.why),
    (degrade.why || '').slice(0, 160));

  const driftOut = await ev(() => {
    const G = window.GigaHack, S = G.screen;
    const out = {};
    window.__unstickAll();
    S.clearLog();
    S.clearDrift();

    const r = S.setTone([-68, -68, -68, 0], 0);
    out.verified = r.ok;

    /* Something else puts it back one frame later — the exact shape that
       passes a same-tick verify and is a lie by the next frame. */
    window.__runEvent(1, 7);
    $gameScreen.startTint([0, 0, 0, 0], 0);
    window.__runNothing();

    window.__raf.flush();
    out.drift = S.drift();
    out.log = S.log().map(x => ({ id: x.id, kind: x.kind, self: x.self }));
    return out;
  });
  check('a write that passes verify and is changed back one frame later is reported, and names the journal ' +
    'entry that changed it',
    driftOut.verified === true && driftOut.drift.length === 1 &&
    driftOut.drift[0].control === 'screen.tone' &&
    driftOut.drift[0].culprit > 0 &&
    /The Screen log records #/.test(driftOut.drift[0].message),
    JSON.stringify(driftOut.drift).slice(0, 240));

  /* =======================================================================
     ATTRIBUTION
     ==================================================================== */
  const attribution = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    window.__unstickAll();
    S.clearLog();

    window.__runEvent(1, 14);
    $gameScreen.startTint([-68, -68, 0, 68], 60);
    out.mapWrite = S.log()[0];
    out.mapId = $gameMap.mapId();

    window.__runNestedEvent(3);
    $gameScreen.startFlash([255, 255, 255, 128], 20);
    out.nested = S.log()[0];
    out.parentEventId = $gameMap._interpreter._eventId;

    window.__runNothing();
    $gameScreen.startShake(5, 5, 30);
    out.orphan = S.log()[0];

    S.clearLog();
    window.__unstickAll();
    return out;
  });
  check('the journal names the map, the event and the command index when an interpreter was running',
    attribution.mapWrite.kind === 'tint' &&
    attribution.mapWrite.mapId === attribution.mapId &&
    attribution.mapWrite.eventId === 1 &&
    attribution.mapWrite.index === 14 &&
    /event 1 "chest_37"/.test(attribution.mapWrite.from) &&
    /cmd 14/.test(attribution.mapWrite.from),
    attribution.mapWrite.from);
  check('the journal names the deepest running interpreter, not the one that called it',
    attribution.parentEventId === 3 &&
    attribution.nested.eventId === 0 &&
    attribution.nested.commonEventId === 3 &&
    /common event 3 "quest_bakery_award"/.test(attribution.nested.from) &&
    /* The parent is map event 3 and the child is common event 3, so the
       negative has to be anchored: the caller would have produced a label
       beginning "map ". */
    !/^map /.test(attribution.nested.from),
    attribution.nested.from);
  check('a screen write with no interpreter running says so rather than blaming the last event',
    attribution.orphan.kind === 'shake' && attribution.orphan.eventId === 0 &&
    /no interpreter was running/.test(attribution.orphan.from),
    attribution.orphan.from);

  const ringOut = await ev(() => {
    const G = window.GigaHack, S = G.screen;
    const out = {};
    S.clearLog();
    G.store.cfgSet('screen.log.max', 20);
    for (let i = 0; i < 50; i++) $gameScreen.startShake(1, 1, 1);
    const rows = S.log();
    out.counts = S.logCounts();
    out.rows = rows.length;
    out.newestId = rows[0].id;
    out.oldestId = rows[rows.length - 1].id;
    out.contiguous = rows.every((r, i) => i === 0 || rows[i - 1].id === r.id + 1);
    G.store.cfgSet('screen.log.max', 200);
    S.clearLog();
    window.__unstickAll();
    return out;
  });
  check('the journal numbers its rows by record, so the kept count and the list agree once the ring has filled',
    ringOut.counts.kept === 20 && ringOut.rows === 20 &&
    ringOut.counts.recorded >= 50 && ringOut.counts.dropped === ringOut.counts.recorded - 20 &&
    ringOut.oldestId > 1 && ringOut.contiguous === true &&
    ringOut.newestId - ringOut.oldestId === 19,
    JSON.stringify(ringOut));

  const revert = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    window.__unstickAll();
    $gameScreen.clearPictures();
    S.clearLog();

    $gameScreen.showPicture(5, 'kept_across_the_revert', 0, 10, 10, 100, 100, 255, 0);
    S.setTone([-100, -100, -100, 0], 0);
    const first = S.log().filter(r => r.kind === 'tint')[0];
    S.setTone([50, 50, 50, 0], 0);
    out.beforeRevert = $gameScreen.tone().slice();

    const r = S.revertTo(first.id);
    out.ok = r.ok;
    out.tone = $gameScreen.tone().slice();
    out.picture = $gameScreen.picture(5) ? $gameScreen.picture(5).name() : null;

    out.missing = S.revertTo(999999);
    return out;
  });
  /* The detail group is what carries the promise, and it only exists for a
     selected row — so the row is selected the way a person selects it. */
  await panelText('Screen log');
  await ev(() => {
    const rows = document.querySelectorAll('#mm-root .mm-tr');
    if (rows.length) rows[0].click();
    return rows.length;
  });
  const revertText = await ev(() => document.getElementById('mm-root').textContent);
  await ev(() => {
    $gameScreen.clearPictures();
    window.__unstickAll();
    window.GigaHack.screen.clearLog();
  });
  check('reverting to before a journal entry restores the scalar screen state and leaves the pictures ' +
    'alone, and says so',
    revert.ok === true && revert.beforeRevert.join(',') === '50,50,50,0' &&
    revert.tone.join(',') === '0,0,0,0' && revert.picture === 'kept_across_the_revert' &&
    revert.missing.ok === false && /rolled off/.test(revert.missing.why) &&
    /Pictures are not restored — the log stores numbers, not images/.test(revertText),
    JSON.stringify({ tone: revert.tone, picture: revert.picture,
      saidSo: /Pictures are not restored/.test(revertText) }));

  /* =======================================================================
     HOLDS
     ==================================================================== */
  const holdFrame = await ev(() => {
    const G = window.GigaHack, S = G.screen;
    const out = {};
    window.__unstickAll();
    S.setTone([-120, -60, 0, 0], 0);
    S.hold('tone', true);
    out.armed = S.holds().tone;

    /* A plugin writing the private field directly, which no alias can see. */
    $gameScreen._tone = [90, 90, 90, 90];
    $gameScreen._toneTarget = [90, 90, 90, 90];
    $gameScreen.update();
    out.afterWalk = $gameScreen.tone().slice();

    window.__raf.flush();
    out.afterFrame = $gameScreen.tone().slice();
    out.durationZeroed = $gameScreen._toneDuration;
    /* A fresh array each time: handing the spriteset our own held array makes
       its cache and the value the same object and the comparison stops firing. */
    out.notOurArray = $gameScreen._tone !== S.holds().tone.value;
    return out;
  });
  check('a hold re-asserts after the engine has walked, so the held value is the one on screen',
    holdFrame.armed.on === true && holdFrame.afterWalk.join(',') === '90,90,90,90' &&
    holdFrame.afterFrame.join(',') === '-120,-60,0,0' && holdFrame.durationZeroed === 0 &&
    holdFrame.notOurArray === true,
    JSON.stringify({ walk: holdFrame.afterWalk, frame: holdFrame.afterFrame }));

  const holdEvent = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    S.clearLog();
    window.__runEvent(1, 3);
    $gameScreen.startTint([-255, -255, -255, 0], 60);
    window.__runNothing();
    out.tone = $gameScreen.tone().slice();
    out.entry = S.log()[0];
    S.hold('tone', false);
    window.__unstickAll();
    S.clearLog();
    out.disarmed = S.holds().tone.on;
    return out;
  });
  check('a hold survives an event trying to change the same field, and the journal records the attempt it ' +
    'overrode',
    holdEvent.tone.join(',') === '-120,-60,0,0' &&
    holdEvent.entry.kind === 'tint' && holdEvent.entry.overridden === true &&
    holdEvent.entry.params[0].join(',') === '-255,-255,-255,0' &&
    /event 1 "chest_37"/.test(holdEvent.entry.from) &&
    holdEvent.disarmed === false,
    JSON.stringify({ tone: holdEvent.tone, overridden: holdEvent.entry.overridden }));

  const unsafe = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    out.registered = G.store.unsafeList()
      .filter(e => e.path.indexOf('screen.hold.') === 0)
      .map(e => e.path).sort();
    out.reason = (G.store.unsafeList().filter(e => e.path === 'screen.hold.tone')[0] || {}).why;
    out.atBoot = ['tone', 'weather', 'zoom'].map(k => G.store.cfgGet('screen.hold.' + k, false));
    /* Loading a settings profile is the second way one of these arrives on. */
    ['tone', 'weather', 'zoom'].forEach(k => G.store.cfgSet('screen.hold.' + k, true));
    G.store.scrubUnsafe();
    out.afterScrub = ['tone', 'weather', 'zoom'].map(k => G.store.cfgGet('screen.hold.' + k, false));
    return out;
  });
  check('the three screen holds are forced off at every launch, and the store lists all three',
    unsafe.registered.join(',') === 'screen.hold.tone,screen.hold.weather,screen.hold.zoom' &&
    /indistinguishable from a crash/.test(unsafe.reason || '') &&
    unsafe.atBoot.every(v => v === false) && unsafe.afterScrub.every(v => v === false),
    JSON.stringify(unsafe));

  /* =======================================================================
     WHAT A BATTLE CLEARS, AND WHAT IT DOES NOT
     ==================================================================== */
  const battle = await ev(() => {
    const out = {};
    window.__unstickAll();
    const keep = {
      phase: BattleManager._phase, escape: BattleManager._canEscape, lose: BattleManager._canLose,
      troopId: $gameTroop._troopId, enemies: $gameTroop._enemies, setup: window.__battleSetup
    };

    $gameScreen.startTint([-68, -68, 0, 68], 0);
    $gameScreen.changeWeather('rain', 4, 0);
    $gameScreen.startFadeOut(1); $gameScreen.updateFadeOut();
    $gameScreen.startFlash([255, 0, 0, 200], 30);
    $gameScreen.startShake(5, 5, 60); $gameScreen.updateShake();
    $gameScreen.setZoom(100, 100, 2);
    $gameScreen.showPicture(1, 'map_range', 0, 0, 0, 100, 100, 255, 0);
    window.__showBattlePicture(3);

    /* The engine's own path: BattleManager.setup calls onBattleStart. */
    BattleManager.setup(1, true, true);

    out.tone = $gameScreen.tone().slice();
    out.weather = $gameScreen.weatherType();
    out.weatherPower = $gameScreen.weatherPower();
    out.brightness = $gameScreen.brightness();
    out.flashAlpha = $gameScreen.flashColor()[3];
    out.shake = $gameScreen.shake();
    out.zoom = $gameScreen.zoomScale();
    out.mapPicture = !!$gameScreen._pictures[1];
    out.battlePicture = !!$gameScreen._pictures[3 + $gameScreen.maxPictures()];

    BattleManager._phase = keep.phase;
    BattleManager._canEscape = keep.escape;
    BattleManager._canLose = keep.lose;
    $gameTroop._troopId = keep.troopId;
    $gameTroop._enemies = keep.enemies;
    window.__battleSetup = keep.setup;
    $gameScreen.clearPictures();
    window.__unstickAll();
    return out;
  });
  check('a tint and the weather survive a battle starting; the fade, the flash, the shake and the zoom do not',
    battle.tone.join(',') === '-68,-68,0,68' && battle.weather === 'rain' && battle.weatherPower === 4 &&
    battle.brightness === 255 && battle.flashAlpha === 0 && battle.shake === 0 && battle.zoom === 1 &&
    battle.mapPicture === true && battle.battlePicture === false,
    JSON.stringify(battle));

  /* =======================================================================
     THE ALIASES
     ==================================================================== */
  const hooks = await ev(() => {
    const G = window.GigaHack;
    return G.hookList()
      .filter(h => h.name.indexOf('(screen log)') > -1)
      .map(h => ({ name: h.name, installed: h.installed, reason: h.reason || '' }));
  });
  const METHODS = ['startTint', 'changeWeather', 'startShake', 'startFlash', 'startFadeOut',
    'startFadeIn', 'startZoom', 'setZoom', 'showPicture', 'erasePicture'];
  const reasonsPresent = METHODS.every(m =>
    SRC.indexOf('Game_Screen.prototype.' + m + ' is not a function on this build') > -1);
  /* A bare assignment is what $.install exists to replace, and it is invisible
     at runtime because the original is simply gone. */
  const bareAssign = /(^|[^.\w])[A-Z][A-Za-z0-9_]*\.prototype\.[A-Za-z0-9_]+\s*=\s*function/m.test(
    SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''));
  check('no engine method is overwritten: every screen alias goes through $.install, and a missing target ' +
    'degrades with a reason that names what is lost',
    hooks.length === 10 && hooks.every(h => h.installed) && reasonsPresent && bareAssign === false,
    hooks.length + ' hooks, reasons=' + reasonsPresent + ', bareAssign=' + bareAssign);

  /* =======================================================================
     DEGRADING PANELS
     ==================================================================== */
  const absent = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    function textOf(sub) {
      G.ui.setOpen(true);
      G.cfg.ui.tab = 'game';
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub.game = sub;
      G.ui.rerender();
      const root = document.getElementById('mm-root');
      return root ? root.textContent : '';
    }
    /* Swapped and swapped back inside ONE evaluate, so no frame turns while
       the world is missing a $gameScreen. */
    const keep = window.$gameScreen;
    window.$gameScreen = null;
    out.screen = textOf('Screen');
    out.pictures = textOf('Pictures');
    out.log = textOf('Screen log');
    out.threw = window.__errors.length;
    window.$gameScreen = keep;
    textOf('Screen');
    return out;
  });
  check('with $gameScreen absent every screen panel says why rather than throwing',
    ['screen', 'pictures', 'log'].every(k =>
      absent[k].indexOf('no game running') > -1 &&
      absent[k].indexOf('which the engine builds when a game starts') > -1) &&
    absent.threw === 0,
    JSON.stringify({ screen: absent.screen.indexOf('no game running') > -1, threw: absent.threw }));

  const noPicture = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    function textOf(sub) {
      G.cfg.ui.tab = 'game';
      G.cfg.ui.sub.game = sub;
      G.ui.rerender();
      return document.getElementById('mm-root').textContent;
    }
    const keep = Game_Screen.prototype.picture;
    delete Game_Screen.prototype.picture;
    out.pictures = textOf('Pictures');
    out.screen = textOf('Screen');
    Game_Screen.prototype.picture = keep;
    textOf('Screen');
    return out;
  });
  check('with Game_Screen.prototype.picture absent the Pictures panel says so and the Screen panel still works',
    noPicture.pictures.indexOf('picture slots are not readable here') > -1 &&
    /\$gameScreen\.picture is not a function on this build/.test(noPicture.pictures) &&
    noPicture.screen.indexOf('Right now') > -1 &&
    noPicture.screen.indexOf('Is something stuck?') > -1,
    JSON.stringify({ pictures: noPicture.pictures.indexOf('picture slots are not readable here') > -1 }));

  /* =======================================================================
     WHAT IS ACTUALLY DRAWING IT
     ==================================================================== */
  const mech = await ev(() => {
    const S = window.GigaHack.screen;
    const out = { live: S.toneMechanism(), brightness: S.brightnessMechanism(), flash: S.flashMechanism() };
    window.__stripSpriteset();
    out.stripped = S.toneMechanism();
    window.__restoreSpriteset();
    out.restored = S.toneMechanism();
    return out;
  });
  const mechText = await panelText('Screen');
  check('the panel says what draws the tint on this build by reading the live spriteset, not by asking ' +
    'which engine this is',
    mech.live === (IS_MZ
      ? '_baseColorFilter, a colour filter on the spriteset\'s base sprite'
      : '_toneSprite, a child of the spriteset (the canvas path)') &&
    mech.restored === mech.live &&
    /no spriteset is readable here/.test(mech.stripped) &&
    mechText.indexOf(mech.live) > -1,
    mech.live + ' | stripped: ' + mech.stripped);
  check('the brightness and the flash are named from the same live probe, and the two engines answer ' +
    'differently',
    mech.brightness === (IS_MZ
      ? 'the brightness of the spriteset\'s overall colour filter'
      : '255 − brightness, as the opacity of a screen sprite over the spriteset') &&
    mech.flash === (IS_MZ
      ? 'the blend colour of the spriteset\'s overall colour filter'
      : 'the colour and opacity of a screen sprite over the spriteset'),
    mech.brightness + ' / ' + mech.flash);

  const wsprite = await ev(() => {
    const S = window.GigaHack.screen;
    const out = {};
    window.__createWeather();
    out.present = S.weatherSprite();
    window.__stripWeatherSprite();
    out.stripped = S.weatherSprite();
    return out;
  });
  const wspriteText = await panelText('Screen');
  await ev(() => { window.__restoreSpriteset(); });
  check('a scene whose spriteset has no weather sprite is reported as replaced rather than as working',
    wsprite.present.present === true && wsprite.stripped.present === false &&
    /something replaced the map spriteset/.test(wsprite.stripped.why) &&
    wspriteText.indexOf('something replaced the map spriteset') > -1,
    JSON.stringify(wsprite.stripped));

  /* =======================================================================
     THE PICTURES PANEL'S UNBOUNDED STRINGS
     ==================================================================== */
  await ev(() => {
    $gameScreen.clearPictures();
    window.__showPictures();
    window.GigaHack.store.cfgSet('screen.pictures.filter', 'in use');
  });
  await panelText('Pictures');
  await ev(() => {
    /* Select the long-named slot the way a person does — by clicking its row. */
    const rows = document.querySelectorAll('#mm-root .mm-tr');
    for (let i = 0; i < rows.length; i++) {
      const first = rows[i].firstChild;
      if (first && first.textContent.trim() === '7') { rows[i].click(); return true; }
    }
    return false;
  });
  await page.waitForTimeout(120);
  const longName = await ev(() => {
    const el = document.querySelector('#mm-root .mm-path');
    const edge = el ? el.parentNode : null;
    const out = {
      found: !!el,
      full: el ? el.getAttribute('title') : '',
      shrinks: !!edge && edge.className.indexOf('mm-edge--shrink') > -1,
      selectable: !!el && el.className.indexOf('mm-selectable') > -1,
      row: null
    };
    if (!el) return out;
    /* Squeeze the row to a width the name cannot fit in — which is what a
       dragged splitter or a narrow window does — and re-measure. The elision
       is measured, so it only means anything against a real box. */
    const keep = edge.style.maxWidth;
    edge.style.maxWidth = '110px';
    window.GigaHack.ui.refitPaths();
    out.shown = el.textContent;
    out.fits = el.scrollWidth <= el.clientWidth + 1;
    out.stillFull = el.getAttribute('title');
    /* The row's own label must still be readable beside it. */
    const label = edge.parentNode.querySelector('.mm-lab');
    out.labelVisible = !!label && label.getBoundingClientRect().width > 8;
    out.rowFits = edge.parentNode.scrollWidth <= edge.parentNode.clientWidth + 1;
    edge.style.maxWidth = keep;
    window.GigaHack.ui.refitPaths();
    return out;
  });
  check('a picture name long enough to push its row is shortened from the middle and still copyable in full',
    longName.found === true && longName.shrinks === true && longName.selectable === true &&
    /a_name_far_too_long_to_fit_in_this_column\.png$/.test(longName.full) &&
    longName.shown.indexOf('…') > 0 &&
    longName.shown.indexOf('…') < longName.shown.length - 1 &&
    longName.shown !== longName.full && longName.fits === true &&
    longName.stillFull === longName.full &&
    longName.labelVisible === true && longName.rowFits === true,
    JSON.stringify({ shown: longName.shown, fits: longName.fits, row: longName.rowFits }));

  await ev(() => {
    const rows = document.querySelectorAll('#mm-root .mm-tr');
    for (let i = 0; i < rows.length; i++) {
      const first = rows[i].firstChild;
      if (first && first.textContent.trim() === '20') { rows[i].click(); return true; }
    }
    return false;
  });
  await page.waitForTimeout(80);
  const indexChip = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    function render() {
      G.ui.rerender();
      return document.getElementById('mm-root').textContent;
    }

    /* Branch one: the index HAS read the asset folders and this name is not
       among them. "Not in the index" is then a real answer. */
    out.real = G.index.findAsset('not_in_any_asset_list');
    const complete = render();
    out.completeSaysMissing = complete.indexOf('not in the index') > -1;
    out.completeSaysCannot = complete.indexOf('the index cannot say') > -1;

    /* Branch two: the index could not read them at all — a browser build, an
       encrypted deploy, no filesystem. That is a THIRD answer and the one
       that must never be rendered as "the file is missing". */
    const keep = G.index.findAsset;
    const why = 'the asset index is not available here: no Node filesystem — this is a browser or ' +
      'web-deployed build.';
    G.index.findAsset = function () { return { candidates: [], complete: false, why: why }; };
    const partial = render();
    out.why = why;
    out.partialSaysCannot = partial.indexOf('the index cannot say') > -1;
    out.partialSaysMissing = partial.indexOf('not in the index') > -1;
    out.partialQuotesWhy = partial.indexOf(why) > -1;
    G.index.findAsset = keep;
    render();
    return out;
  });
  check('a picture whose file the index cannot confirm is reported as unconfirmed, never as missing',
    indexChip.partialSaysCannot === true && indexChip.partialSaysMissing === false &&
    indexChip.partialQuotesWhy === true,
    JSON.stringify({ cannot: indexChip.partialSaysCannot, missing: indexChip.partialSaysMissing,
      quoted: indexChip.partialQuotesWhy }));
  check('and a complete index that simply does not list it says so instead, which is a different answer',
    indexChip.real.complete === true && indexChip.completeSaysMissing === true &&
    indexChip.completeSaysCannot === false,
    JSON.stringify({ complete: indexChip.real.complete, missing: indexChip.completeSaysMissing }));

  /* =======================================================================
     THE ESCAPE HATCH
     ==================================================================== */
  await ev(() => {
    $gameScreen.clearPictures();
    window.__stickTint();
    window.__stickBrightness();
  });
  await panelText('Screen');
  const hatch = await ev(() => {
    const G = window.GigaHack;
    const out = {};
    const root = document.getElementById('mm-root');
    const canvas = document.getElementById(G.caps.canvasId);
    out.rootExists = !!root;
    out.canvasExists = !!canvas;
    /* The tint is inside the canvas and the overlay is not, which is the whole
       reason this is reachable with the screen fully black. */
    out.outsideCanvas = !!root && !!canvas && !canvas.contains(root);
    out.visible = !!root && getComputedStyle(root).display !== 'none';
    out.blackBefore = G.screen.diagnose().map(d => d.id).sort().join(',');

    let btn = null;
    const all = root.querySelectorAll('button');
    for (let i = 0; i < all.length; i++) {
      if (all[i].textContent.indexOf('unstick everything') === 0) btn = all[i];
    }
    out.buttonFound = !!btn;
    if (btn) { btn.click(); out.armed = btn.textContent; btn.click(); }
    out.after = G.screen.diagnose().map(d => d.id);
    out.tone = $gameScreen.tone().slice();
    out.brightness = $gameScreen.brightness();
    return out;
  });
  check('the escape hatch is still reachable with the screen fully black, because the tint is inside the ' +
    'canvas and the overlay is not',
    hatch.rootExists && hatch.canvasExists && hatch.outsideCanvas && hatch.visible &&
    hatch.blackBefore === 'brightness,tint' && hatch.buttonFound === true &&
    hatch.armed === 'confirm?' && hatch.after.length === 0 &&
    hatch.tone.join(',') === '0,0,0,0' && hatch.brightness === 255,
    JSON.stringify(hatch));

  const api = await ev(() => {
    const G = window.GigaHack;
    window.__stickTint();
    window.__stickWeather();
    const r = G.api.unstick();
    return {
      cleared: r.cleared.sort(),
      tone: $gameScreen.tone().slice(),
      weather: $gameScreen.weatherType(),
      state: !!G.api.screen(),
      diagnose: G.api.screenDiagnose().length
    };
  });
  check('the console command the diagnosis names really does clear the screen, and reports what it cleared',
    api.tone.join(',') === '0,0,0,0' && api.weather === 'none' && api.diagnose === 0 &&
    api.state === true &&
    api.cleared.indexOf('tint') > -1 && api.cleared.indexOf('weather') > -1 &&
    api.cleared.indexOf('sceneFade') > -1,
    JSON.stringify(api.cleared));

  /* =======================================================================
     REGISTRATION
     ==================================================================== */
  const panels = await ev(() => window.GigaHack.ui.panelNames('game'));
  const iMessage = panels.indexOf('Message');
  const iScreen = panels.indexOf('Screen');
  const iPictures = panels.indexOf('Pictures');
  const iLog = panels.indexOf('Screen log');
  check('the screen panels sit after the message panels on the game tab, in their own order',
    iScreen > iMessage && iPictures === iScreen + 1 && iLog === iPictures + 1,
    panels.join(', '));

  /* =======================================================================
     PUT IT BACK
     Every undo entry this file pushed is popped BEFORE the world is reset, so
     a pop does not resurrect a picture on top of the clean state.
     ==================================================================== */
  const restored = await ev((base) => {
    const G = window.GigaHack;
    let guard = 0;
    while (G.undo.size() > base && guard++ < 200) G.undo.pop();

    G.screen.clearLog();
    G.screen.clearDrift();
    G.compat.clearDegraded();
    ['tone', 'weather', 'zoom'].forEach(k => G.store.cfgSet('screen.hold.' + k, false));
    G.store.cfgSet('screen.log.max', 200);
    G.store.cfgSet('screen.pictures.filter', 'in use');
    G.store.cfgSet('screen.duration', 0);

    window.__clearPictureLimit();
    window.__restoreSpriteset();
    window.__inBattle = false;
    $gameScreen.clearPictures();
    window.__unstickAll();
    window.__runNothing();

    window.__raf.reset();
    SceneManager.requestUpdate();

    G.cfg.ui.tab = 'world';
    G.ui.rerender();

    return {
      undo: G.undo.size() - base,
      diagnose: G.screen.diagnose().length,
      pictures: G.screen.state().pictures.used,
      log: G.screen.logCounts().kept,
      holds: ['tone', 'weather', 'zoom'].map(k => G.store.cfgGet('screen.hold.' + k, false)),
      pending: window.__raf.pending()
    };
  }, undoBase);
  check('the screen checks leave the game as they found it — no tint, no pictures, no holds and no undo ' +
    'entries of their own',
    restored.undo === 0 && restored.diagnose === 0 && restored.pictures === 0 &&
    restored.log === 0 && restored.holds.every(v => v === false) && restored.pending === 1,
    JSON.stringify(restored));
};
