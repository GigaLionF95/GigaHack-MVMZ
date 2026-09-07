//=============================================================================
// GigaHack MV/MZ
// 29 · screen.js — tint, weather, zoom, shake and the picture slots
//-----------------------------------------------------------------------------
// This module exists because of one failure: the screen is black, or shifted,
// or raining, and nothing in the game says why. Every control here is shaped by
// the invariants below rather than by what a screen editor "should" have.
//
// 1. THE TARGET TRAP. Every animated field on Game_Screen is a PAIR — a value
//    and a target — and `update()` walks the value toward the target once per
//    logical step. Writing `_tone` alone is undone within `_toneDuration`
//    frames with nothing in any log, and the same is true of the zoom scale,
//    the weather power and all five animated Game_Picture fields. So every
//    write here sets value AND target AND duration together, or goes through
//    the engine's own start* with a duration. There is exactly one function
//    per field that does it, so the trap can only be got wrong in one place.
//
// 2. AND ITS WORST CASE: startZoom(x, y, scale, 0) sets the target and the
//    duration and never touches the scale, so an instant zoom made through the
//    engine's own function does nothing at all. setZoom is the instant path,
//    and it must be followed by writing the target too, or the next timed zoom
//    eases from a target nobody set.
//
// 3. A SHAKE AT POWER ZERO NEVER SETTLES. updateShake moves `_shake` by
//    power × speed × direction ÷ 10 and only snaps it back to zero on the
//    frame the sign would flip. At power 0 the delta is 0, the sign never
//    flips, the duration counts past zero and the screen keeps whatever
//    offset it had — permanently, and across saves. Only clearing the shake
//    fixes it, so "stop" writes the offset as well as the duration.
//
// 4. A BLACK SCREEN HAS FOUR INDEPENDENT CAUSES AND ONLY TWO ARE ON
//    $gameScreen: the tint, the brightness, the SCENE's own fade, and a
//    picture covering the screen. Reporting "the tint is clear" while the
//    screen is black is precisely the silent failure this project exists to
//    prevent, so the diagnosis covers all four and names which mechanism each
//    belongs to.
//
// 5. THE SCENE FADE HAS NO ADAPTER. It is not in the engine delta table and
//    there is no $.eng function for it, because until now nothing needed it:
//    one engine drives a ScreenSprite child through `_fadeSprite.opacity` and
//    has no `_fadeOpacity`; the other drives a plain `_fadeOpacity` number
//    through a colour filter and has no `_fadeSprite`. Both fields are
//    feature-detected here, in one function, and the panel prints which one it
//    read. If a second module ever needs it, sceneFade() is what to promote.
//
// 6. IN BATTLE EVERY PICTURE ID IS SHIFTED. realPictureId adds maxPictures()
//    to the id while a battle is running, so slot 1 on the map and slot 1 in a
//    fight are different objects in different array positions. Everything goes
//    through picture(n), the panel always says which range it is reading, and
//    no Game_Picture reference survives a repaint — $gameScreen itself is
//    replaced wholesale when a save is loaded, so a held reference points at a
//    dead object.
//
// 7. NOTHING IN THE ENGINE EVER CLEARS THE TINT OR THE WEATHER. clear() is
//    called only when the object is built. onBattleStart clears the fade, the
//    flash, the shake, the zoom and the battle picture range and deliberately
//    does not touch the tone or the weather. That is why a stuck tint survives
//    a fight and a stuck zoom does not, and the panel has to say which.
//
// 8. VERIFY IS A SAME-TICK CHECK. A plugin that recomputes a field inside
//    Game_Screen.update passes $.compat.verify and reverts one frame later, so
//    every instant write here also arms a drift watch for a few frames and
//    reports what changed it. Without that second half a "verified" write is a
//    lie, which is the exact class of failure this project was built to stop.
//
// 9. A HOLD RE-ASSERTS AFTER THE ENGINE HAS WALKED, never before — the same
//    shape as the dialogue recorder's capture-after-the-original. Asserting
//    first lets update() move the value on the same frame and the hold looks
//    as though it half works. All three holds are boot-unsafe: a saved "hold
//    the tone black" applies from the boot screen, before the overlay that
//    would switch it off exists, and is indistinguishable from a crash.
//
// The aliases are on Game_Screen's own start* functions rather than on the
// interpreter's command handlers, because an event command is only one of the
// callers: a plugin or a script call reaches the same functions and, on a
// modded game, is most of the traffic. What that cannot see is a plugin
// writing the private fields directly, and the panel says so rather than
// implying the log is complete.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — tint, weather, zoom, shake and the picture slots
 * @author gigahack
 * @help GigaHack_Screen.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat; uses Index to look a picture's file up, and Events for
 * the Screen log's "go to the event that did this" button.
 *
 * Game → Screen holds the tint, brightness, flash, shake, zoom and weather,
 * plus one button that clears all of them. Game → Pictures lists every picture
 * slot. Game → Screen log records every write that went through the engine's
 * own functions, and who was running when it did.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — screen not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    var S = $.screen = {};

    /* =====================================================================
       SETTINGS

       Read through a local helper that supplies the default when the key is
       absent, so this module does not have to be in the Store's DEFAULTS to
       work. Every key is under `screen.`.
       ===================================================================== */
    function cfg(key, dflt) { return $.store.cfgGet('screen.' + key, dflt); }
    function set(key, v) { return $.store.cfgSet('screen.' + key, v); }
    function num(key, dflt, lo, hi) {
        var v = cfg(key, dflt);
        if (typeof v !== 'number' || v !== v) return dflt;
        return v < lo ? lo : v > hi ? hi : v;
    }

    /* =====================================================================
       SERVICES

       Compat loads before this module by manifest, but a partial install is
       exactly the moment a mod menu must not throw. The shim has the surface
       of the real service and degrades to the honest answer.
       ===================================================================== */
    function verify(control, write, read, want, compare) {
        if ($.compat && $.compat.verify) return $.compat.verify(control, write, read, want, compare);
        $.safe(write, 'write ' + control);
        var got = $.safe(read, 'read ' + control, undefined);
        var ok = compare ? compare(got, want) : got === want;
        return {
            ok: ok, got: got, want: want, culprits: [],
            message: ok ? '' : 'wrote ' + JSON.stringify(want) + ' and read back ' + JSON.stringify(got) +
                '. The compatibility module is not installed, so nothing can be named as the cause.'
        };
    }
    function degraded(control) { return !!($.compat && $.compat.isDegraded && $.compat.isDegraded(control)); }
    function degradedWhy(control) { return ($.compat && $.compat.degradedWhy && $.compat.degradedWhy(control)) || ''; }

    /**
     * A control whose writes do not stick is MARKED, never hidden and never
     * made inert: the cause may have gone away — a plugin's own state changed,
     * a scene rebuilt — and the only way to find out is to let the user try.
     */
    function degradeNote(control) {
        if (!degraded(control)) return null;
        return h('div', { class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px' },
            h('b', { text: 'writes here are not sticking. ' }),
            degradedWhy(control) + ' ',
            W.button({
                label: 'try again', mini: true, _ungated: true,
                tip: 'Try again|Clears the mark; the next write is re-tested.',
                onClick: function () {
                    if ($.compat && $.compat.clearDegraded) $.compat.clearDegraded(control);
                    U.rerender();
                }
            }));
    }

    /* =====================================================================
       PART 1 — READING THE SCREEN
       ===================================================================== */

    var NO_GAME = 'no game is running, so there is no $gameScreen to read or write.';

    function alive() { return typeof $gameScreen !== 'undefined' && !!$gameScreen; }
    S.alive = alive;

    function nz(v, d) { return (typeof v === 'number' && v === v) ? v : (d === undefined ? 0 : d); }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    /** Four real numbers, always. startTint and startFlash call clone() on
        what they are handed, so anything that is not a real Array throws
        inside the engine, at a stack frame nobody would connect to the
        control they clicked. */
    function tone4(a) { return [nz(a && a[0]), nz(a && a[1]), nz(a && a[2]), nz(a && a[3])]; }
    function sameTone(a, b) {
        if (!a || !b) return false;
        for (var i = 0; i < 4; i++) if (Math.abs(nz(a[i]) - nz(b[i])) > 0.5) return false;
        return true;
    }

    function inBattle() {
        return $.safe(function () {
            return typeof $gameParty !== 'undefined' && $gameParty &&
                typeof $gameParty.inBattle === 'function' && !!$gameParty.inBattle();
        }, 'inBattle', false);
    }

    function scene() {
        return $.safe(function () {
            return (typeof SceneManager !== 'undefined' && SceneManager) ? (SceneManager._scene || null) : null;
        }, 'scene', null) || null;
    }
    function spriteset() {
        var sc = scene();
        return (sc && sc._spriteset) || null;
    }

    function graphicsW() { return $.safe(function () { return Graphics.width; }, 'Graphics.width', 816) || 816; }
    function graphicsH() { return $.safe(function () { return Graphics.height; }, 'Graphics.height', 624) || 624; }

    /**
     * One reader for every panel row, every journal snapshot and every check.
     *
     * Plain numbers and arrays only — never a Game_Picture reference — so the
     * result is safe to snapshot, diff and keep. A field read one way in the
     * readout and another in the log is a bug that cannot happen if there is
     * only one reader.
     */
    S.state = function () {
        if (!alive()) return null;
        return $.safe(function () {
            var g = $gameScreen;
            var list = (g._pictures && g._pictures.length) ? g._pictures : [];
            var used = 0, named = 0;
            for (var i = 0; i < list.length; i++) {
                if (list[i]) { used++; if (list[i]._name) named++; }
            }
            return {
                tone: tone4(g._tone), toneTarget: tone4(g._toneTarget), toneDuration: nz(g._toneDuration),
                brightness: nz(g._brightness, 255), fadeOut: nz(g._fadeOutDuration), fadeIn: nz(g._fadeInDuration),
                flash: tone4(g._flashColor), flashDuration: nz(g._flashDuration),
                shake: nz(g._shake), shakePower: nz(g._shakePower), shakeSpeed: nz(g._shakeSpeed),
                shakeDuration: nz(g._shakeDuration), shakeDirection: nz(g._shakeDirection, 1),
                zoomX: nz(g._zoomX), zoomY: nz(g._zoomY), zoomScale: nz(g._zoomScale, 1),
                zoomScaleTarget: nz(g._zoomScaleTarget, 1), zoomDuration: nz(g._zoomDuration),
                weatherType: String(g._weatherType == null ? 'none' : g._weatherType),
                weatherPower: nz(g._weatherPower), weatherPowerTarget: nz(g._weatherPowerTarget),
                weatherDuration: nz(g._weatherDuration),
                pictures: { used: used, named: named, max: S.maxPictures().n, range: inBattle() ? 'battle' : 'map' }
            };
        }, 'screen state', null);
    };

    /**
     * Write a whole scalar snapshot back. Value, target and duration together
     * for every animated field — see invariant 1. Pictures are deliberately
     * not part of this: the snapshot holds numbers, not images.
     */
    function restore(s) {
        if (!s || !alive()) return false;
        return $.safe(function () {
            var g = $gameScreen;
            g._tone = s.tone.slice(); g._toneTarget = s.toneTarget.slice(); g._toneDuration = s.toneDuration;
            g._brightness = s.brightness; g._fadeOutDuration = s.fadeOut; g._fadeInDuration = s.fadeIn;
            g._flashColor = s.flash.slice(); g._flashDuration = s.flashDuration;
            g._shake = s.shake; g._shakePower = s.shakePower; g._shakeSpeed = s.shakeSpeed;
            g._shakeDuration = s.shakeDuration; g._shakeDirection = s.shakeDirection;
            g._zoomX = s.zoomX; g._zoomY = s.zoomY; g._zoomScale = s.zoomScale;
            g._zoomScaleTarget = s.zoomScaleTarget; g._zoomDuration = s.zoomDuration;
            g._weatherType = s.weatherType; g._weatherPower = s.weatherPower;
            g._weatherPowerTarget = s.weatherPowerTarget; g._weatherDuration = s.weatherDuration;
            return true;
        }, 'screen restore', false);
    }
    S.restore = restore;

    /* ------------------------------------------------------- the scene fade
       The fourth cause of a black screen, the one $gameScreen cannot see and
       no event command can clear. Both mechanisms are probed; neither engine
       is named. */
    S.sceneFade = function () {
        var out = {
            available: false, opacity: 0, duration: 0, sign: 0, white: false,
            field: 'neither field is present',
            why: 'no scene is running, so there is no scene fade to clear.'
        };
        var sc = scene();
        if (!sc) return out;
        return $.safe(function () {
            out.duration = nz(sc._fadeDuration);
            out.sign = nz(sc._fadeSign);
            out.white = !!sc._fadeWhite;
            if (sc._fadeSprite && typeof sc._fadeSprite.opacity === 'number') {
                out.field = '_fadeSprite.opacity';
                out.opacity = sc._fadeSprite.opacity;
            } else if (typeof sc._fadeOpacity === 'number') {
                out.field = '_fadeOpacity';
                out.opacity = sc._fadeOpacity;
            } else if (typeof sc.createFadeSprite === 'function') {
                // The sprite mechanism, not built yet: this scene has never
                // faded, so there is nothing to read and nothing is wrong.
                out.field = '_fadeSprite.opacity (not built — this scene has never faded)';
            }
            if (typeof sc.startFadeIn !== 'function') {
                out.why = 'this scene has no startFadeIn — something replaced Scene_Base. The scene fade ' +
                    'cannot be cleared from here; reloading the map will rebuild the scene.';
                return out;
            }
            out.available = true;
            out.why = '';
            return out;
        }, 'scene fade', out);
    };

    S.clearSceneFade = function () {
        var f = S.sceneFade();
        if (!f.available) return { ok: false, why: f.why };
        if (!$.allowWrite('Clearing the scene fade')) return { ok: false, why: 'read-only mode is on.' };
        var sc = scene();
        // A one-frame fade IN is the only way out: the scene owns this value
        // and no event command touches it.
        var ok = $.safe(function () { sc.startFadeIn(1, false); return true; }, 'startFadeIn', false);
        return { ok: !!ok, why: ok ? '' : 'startFadeIn threw — the log has the message.' };
    };

    /* --------------------------------------------- where the state is drawn
       Probed off the LIVE spriteset, never derived from the engine name: one
       engine picks between a filter and a child sprite at boot depending on
       the renderer, so naming the mechanism from the engine is wrong on one
       of its two paths. */
    S.toneMechanism = function () {
        var ss = spriteset();
        if (!ss) return 'no spriteset is readable here — this scene has none, or something replaced it';
        if (ss._baseColorFilter) return '_baseColorFilter, a colour filter on the spriteset\'s base sprite';
        if (ss._toneFilter) return '_toneFilter on _baseSprite (the WebGL path)';
        if (ss._toneSprite) return '_toneSprite, a child of the spriteset (the canvas path)';
        return 'no tone mechanism is readable on this spriteset';
    };
    S.brightnessMechanism = function () {
        var ss = spriteset();
        if (!ss) return 'no spriteset is readable here';
        if (ss._fadeSprite) return '255 − brightness, as the opacity of a screen sprite over the spriteset';
        if (ss._overallColorFilter) return 'the brightness of the spriteset\'s overall colour filter';
        return 'no brightness mechanism is readable on this spriteset';
    };
    S.flashMechanism = function () {
        var ss = spriteset();
        if (!ss) return 'no spriteset is readable here';
        if (ss._flashSprite) return 'the colour and opacity of a screen sprite over the spriteset';
        if (ss._overallColorFilter) return 'the blend colour of the spriteset\'s overall colour filter';
        return 'no flash mechanism is readable on this spriteset';
    };
    S.weatherSprite = function () {
        var ss = spriteset();
        if (!ss) return { present: false, why: 'no spriteset is readable here, so nothing is drawing weather.' };
        if (!ss._weather) {
            return {
                present: false,
                why: inBattle()
                    ? 'the battle spriteset has no weather sprite at all — weather is a map-only effect.'
                    : 'this scene has no weather sprite — something replaced the map spriteset, so the ' +
                      'type and power above are what $gameScreen holds and not necessarily what is on screen.'
            };
        }
        return { present: true, why: '', type: ss._weather.type, power: nz(ss._weather.power) };
    };

    /* =====================================================================
       PART 2 — THE DIAGNOSIS

       Empty means nothing on $gameScreen looks stuck. That is a POSITIVE
       answer, not an absence, and it is only safe to give because the four
       mechanisms below are checked separately and the panel says out loud
       what none of them can see.
       ===================================================================== */
    S.diagnose = function () {
        var out = [];
        if (!alive()) return out;
        var s = S.state();
        if (!s) return out;

        if (!sameTone(s.tone, [0, 0, 0, 0]) && s.toneDuration <= 0) {
            out.push({
                id: 'tint',
                what: 'the tint is ' + s.tone.join(',') + ' and nothing is moving it.',
                why: 'clear() runs only when Game_Screen is built, so no engine path ever puts a tint back — ' +
                    'and it survives a battle, because onBattleStart deliberately leaves the tone alone.',
                fix: '"clear the tint" on this tab, or GigaHack.api.unstick() in the console.'
            });
        }
        if (s.brightness < 254 && s.fadeIn <= 0 && s.fadeOut <= 0) {
            out.push({
                id: 'brightness',
                what: 'the screen brightness is ' + Math.round(s.brightness) + ' of 255 with no fade running.',
                why: 'a cutscene that faded out and was interrupted before it faded back in leaves exactly ' +
                    'this: the engine considers the fade finished, so waiting does not help.',
                fix: '"fade in" in Brightness, or GigaHack.api.unstick().'
            });
        }
        var f = S.sceneFade();
        if (f.opacity > 1 && f.duration <= 0) {
            out.push({
                id: 'sceneFade',
                what: 'the SCENE\'s own fade is at ' + Math.round(f.opacity) + ' of 255 and has finished.',
                why: 'this is not on $gameScreen and no event command clears it — it is read from ' +
                    f.field + ' on the running scene.',
                fix: '"clear the scene fade" in the sidebar, which calls startFadeIn(1) on the scene.'
            });
        }
        var cover = coveringPicture();
        if (cover) {
            out.push({
                id: 'picture',
                what: 'slot ' + cover.slot + ' is showing "' + cover.name + '" at full opacity from the top-left corner.',
                why: 'a picture over the screen leaves every value on $gameScreen clean, which is why ' +
                    '"nothing looks stuck" can be true while the screen is not.',
                fix: 'the Pictures tab: erase that slot, or "erase every picture".'
            });
        }
        if (s.weatherType !== 'none' && s.weatherDuration <= 0 && s.weatherPower > 0) {
            out.push({
                id: 'weather',
                what: 'the weather is "' + s.weatherType + '" at power ' + round1(s.weatherPower) + ' with no duration left.',
                why: 'weather is the other field the engine never clears by itself, and it survives a battle ' +
                    'for the same reason the tint does.',
                fix: '"stop" in Weather, or GigaHack.api.unstick().'
            });
        }
        if (Math.abs(s.shake) > 0.01 && s.shakeDuration <= 0) {
            out.push({
                id: 'shake',
                what: 'the screen is offset ' + round1(s.shake) + 'px and no shake is running.',
                why: 'updateShake only settles the offset on the frame the sign flips, so a shake run at ' +
                    'power 0 moves nothing and leaves the offset where it was — permanently, across saves.',
                fix: '"stop" in Shake, which writes the offset to zero as well as the duration.'
            });
        }
        if (Math.abs(s.zoomScale - 1) > 0.001 && s.zoomDuration <= 0) {
            out.push({
                id: 'zoom',
                what: 'the zoom is ' + round2(s.zoomScale) + '× at ' + Math.round(s.zoomX) + ',' + Math.round(s.zoomY) + '.',
                why: 'no event command sets the zoom on either engine, so nothing in this game\'s own event ' +
                    'list will clear it — only a script call or a plugin can.',
                fix: '"reset" in Zoom, or GigaHack.api.unstick().'
            });
        }
        if (s.flash[3] > 0 && s.flashDuration <= 0) {
            out.push({
                id: 'flash',
                what: 'a flash colour is still at alpha ' + Math.round(s.flash[3]) + ' with no duration left.',
                why: 'a flash decays through its own duration; an alpha left behind with no duration means ' +
                    'something wrote the colour without starting one.',
                fix: '"stop" in Flash.'
            });
        }
        return out;
    };

    /**
     * A picture that COULD be covering the screen.
     *
     * Deliberately narrow: full opacity, normal blend, the untranslated
     * origin, and a top-left at or before the screen origin. A looser test
     * would report every legitimate full-screen background as a fault, and a
     * diagnosis that cries wolf is worse than none.
     */
    function coveringPicture() {
        if (!alive() || typeof $gameScreen.picture !== 'function') return null;
        var rows = S.pictures();
        for (var i = 0; i < rows.length; i++) {
            var p = rows[i];
            if (!p.showing) continue;
            if (p.opacity < 255 || p.blendMode !== 0 || p.origin !== 0) continue;
            if (p.x > 0 || p.y > 0) continue;
            return p;
        }
        return null;
    }

    function round1(v) { return Math.round(v * 10) / 10; }
    function round2(v) { return Math.round(v * 100) / 100; }

    /* =====================================================================
       PART 3 — THE JOURNAL

       A capped ring of every write that went through the engine's own start*
       functions, with the interpreter that was running at the time. Bounded
       on purpose: a parallel event calling startFlash sixty times a second
       turns an unbounded diagnostic into the leak.
       ===================================================================== */
    var ALL_KINDS = ['tint', 'fade', 'flash', 'shake', 'zoom', 'weather', 'picture'];
    S.kinds = function () { return ALL_KINDS.slice(); };

    var ring = [];
    var recorded = 0;       // total ever, which is what "dropped" is measured from
    var nextId = 0;
    var selfWrite = 0;      // >0 while this module is the caller
    var bulk = 0;           // >0 while one summary record stands for many writes

    function engineFrame() {
        return $.safe(function () {
            return (typeof Graphics !== 'undefined' && Graphics && typeof Graphics.frameCount === 'number')
                ? Graphics.frameCount : -1;
        }, 'engine frame', -1);
    }

    /** Only descend into a child that is actually running: updateChild drops a
        stopped child on its NEXT visit, so a finished one stays attached for a
        frame and would otherwise be named as the writer. */
    function running(i) {
        return !!(i && (typeof i.isRunning === 'function' ? i.isRunning() : !!i._list));
    }
    function deepest(i) {
        var guard = 0;
        while (i && running(i._childInterpreter) && guard++ < 128) i = i._childInterpreter;
        return i;
    }

    /** Which common event owns this list, by identity. A called common event
        runs on a child interpreter with event id 0, so the id is not on the
        interpreter and the list is the only thing that identifies it. */
    function commonEventOfList(list) {
        if (!list) return 0;
        return $.safe(function () {
            if (typeof $dataCommonEvents === 'undefined' || !$dataCommonEvents) return 0;
            for (var i = 1; i < $dataCommonEvents.length; i++) {
                if ($dataCommonEvents[i] && $dataCommonEvents[i].list === list) return i;
            }
            return 0;
        }, 'common event of list', 0);
    }
    function commonEventName(id) {
        return $.safe(function () {
            return (id && $dataCommonEvents && $dataCommonEvents[id] && $dataCommonEvents[id].name) || '';
        }, 'common event name', '');
    }

    /**
     * The live Game_Event for an id, or null.
     *
     * Game_Map.event(id) is an INDEXED lookup into a sparse array, so a
     * plugin whose _events is packed rather than id-indexed returns a
     * DIFFERENT event with no symptom at all. The answer is checked against
     * the event's own eventId() and the scan is the fallback, because naming
     * the wrong event is worse than naming none.
     */
    function liveEvent(id) {
        if (!id) return null;
        return $.safe(function () {
            if (typeof $gameMap === 'undefined' || !$gameMap) return null;
            var e = (typeof $gameMap.event === 'function') ? $gameMap.event(id) : null;
            if (e && typeof e.eventId === 'function' && e.eventId() === id) return e;
            var all = (typeof $gameMap.events === 'function') ? $gameMap.events() : [];
            for (var i = 0; i < all.length; i++) {
                if (all[i] && typeof all[i].eventId === 'function' && all[i].eventId() === id) return all[i];
            }
            return null;
        }, 'live event', null);
    }
    S.liveEvent = liveEvent;

    function eventName(id) {
        var e = liveEvent(id);
        if (!e) return '';
        return $.safe(function () {
            var d = (typeof e.event === 'function') ? e.event() : null;
            return (d && d.name) || '';
        }, 'event name', '');
    }

    var NO_INTERP = 'no interpreter was running — a script call or a plugin did this';

    /**
     * Who is running RIGHT NOW, deepest first.
     *
     * Callable from outside a hook, so the panel can say who is running and
     * not only who wrote last. Walking only the top interpreter names the
     * CALLER of a common event instead of the common event — which is worse
     * than saying nothing, because it is confidently wrong.
     */
    S.whoRan = function () {
        var out = {
            kind: 'none', mapId: 0, eventId: 0, eventName: '', commonEventId: 0,
            commonEventName: '', index: 0, label: NO_INTERP
        };
        return $.safe(function () {
            var i = null, kind = '', ceId = 0;
            if (typeof $gameMap !== 'undefined' && $gameMap) {
                if (running($gameMap._interpreter)) { i = deepest($gameMap._interpreter); kind = 'map'; }
                if (!i && $gameMap._commonEvents && $gameMap._commonEvents.length) {
                    for (var k = 0; k < $gameMap._commonEvents.length; k++) {
                        var ce = $gameMap._commonEvents[k];
                        if (ce && running(ce._interpreter)) {
                            i = deepest(ce._interpreter); kind = 'common';
                            ceId = ce._commonEventId || 0;
                            break;
                        }
                    }
                }
            }
            if (!i && typeof $gameTroop !== 'undefined' && $gameTroop && running($gameTroop._interpreter)) {
                i = deepest($gameTroop._interpreter); kind = 'battle';
            }
            if (!i) return out;

            out.index = nz(i._index);
            out.mapId = nz(i._mapId);
            out.eventId = nz(i._eventId);
            // The DEEPEST interpreter's own list decides, not the object it
            // was reached through: a common event that called another one is
            // running its callee's list on a child, and naming the caller
            // there is confidently wrong.
            var listId = commonEventOfList(i._list);
            if (listId) ceId = listId;

            if (kind === 'battle') {
                out.kind = 'battle';
                out.label = 'battle event · cmd ' + out.index;
                return out;
            }
            if (!out.eventId) {
                // Event id 0 with a recognised list is a common event, whether
                // it arrived on its own object or as somebody's child.
                out.kind = 'common';
                out.commonEventId = ceId;
                out.commonEventName = commonEventName(ceId);
                out.label = ceId
                    ? ('common event ' + ceId + (out.commonEventName ? ' "' + out.commonEventName + '"' : '') +
                        ' · cmd ' + out.index)
                    : ('a called event list with no event id · cmd ' + out.index);
                return out;
            }
            out.kind = 'map';
            out.eventName = eventName(out.eventId);
            out.label = 'map ' + out.mapId + ' · event ' + out.eventId +
                (out.eventName ? ' "' + out.eventName + '"' : '') + ' · cmd ' + out.index;
            return out;
        }, 'screen whoRan', out);
    };

    /**
     * One journal entry.
     *
     * Called BEFORE the original runs, because `before` means the state this
     * write is about to change — the opposite of the dialogue recorder, whose
     * value only exists after the engine has converted it.
     *
     * Every param array is COPIED, never referenced: the caller owns its
     * array and the engine's own start* clone it, so a stored reference would
     * be walked out from under the log by the next frame.
     */
    function record(kind, params, overridden) {
        if (bulk) return null;
        if (!cfg('log.on', true)) return null;
        return $.safe(function () {
            var who = selfWrite ? null : S.whoRan();
            var rec = {
                id: ++nextId,
                kind: kind,
                frame: $.frameCount,
                engineFrame: engineFrame(),
                t: Date.now(),
                params: (params || []).slice(),
                self: !!selfWrite,
                overridden: !!overridden,
                from: selfWrite ? 'the mod menu' : who.label,
                kindOfCaller: selfWrite ? 'mod' : who.kind,
                mapId: who ? who.mapId : 0,
                eventId: who ? who.eventId : 0,
                eventName: who ? who.eventName : '',
                commonEventId: who ? who.commonEventId : 0,
                index: who ? who.index : 0,
                before: S.state()
            };
            ring.push(rec);
            recorded++;
            var max = num('log.max', 200, 20, 2000);
            while (ring.length > max) ring.shift();
            return rec;
        }, 'screen log record', null);
    }
    S.record = record;

    function fmtTone(t) { return '[' + tone4(t).map(function (v) { return Math.round(v); }).join(',') + ']'; }
    function fmtOver(d) { return d > 0 ? ' over ' + Math.round(d) + 'f' : ' instantly'; }

    /** The formatted arguments, one line, in the words the panel shows. */
    S.describe = function (rec) {
        if (!rec) return '';
        var p = rec.params || [];
        switch (rec.kind) {
            case 'tint': return fmtTone(p[0]) + fmtOver(nz(p[1]));
            // A brightness written straight carries the value as a third
            // argument, because "fade in over 0f" is not what happened.
            case 'fade': return p[2] === undefined
                ? (p[0] === 'in' ? 'fade in' : 'fade out') + ' over ' + Math.round(nz(p[1])) + 'f'
                : 'brightness ' + Math.round(nz(p[2])) + ' instantly';
            case 'flash': return fmtTone(p[0]) + ' α=' + Math.round(nz(p[0] && p[0][3])) + fmtOver(nz(p[1]));
            case 'shake': return 'power ' + round1(nz(p[0])) + ' speed ' + round1(nz(p[1])) + fmtOver(nz(p[2]));
            case 'zoom': return (p[3] === 'set' ? 'set ' : '') + Math.round(nz(p[0])) + ',' + Math.round(nz(p[1])) +
                ' ×' + round2(nz(p[2], 1)) + (p[3] === 'set' ? '' : fmtOver(nz(p[3])));
            case 'weather': return String(p[0]) + ' power ' + round1(nz(p[1])) + fmtOver(nz(p[2]));
            case 'picture': return String(p[0]) + (p[1] === undefined ? '' : ' ' + String(p[1]));
            default: return rec.kind;
        }
    };

    /** Newest first, filtered by kind and by a free-text query. */
    S.log = function (filter) {
        filter = filter || {};
        var kinds = filter.kinds || null;
        var q = String(filter.q || '').toLowerCase();
        var out = [];
        for (var i = ring.length - 1; i >= 0; i--) {
            var r = ring[i];
            if (kinds && kinds.length && kinds.indexOf(r.kind) < 0) continue;
            if (q && (S.describe(r) + ' ' + r.from).toLowerCase().indexOf(q) < 0) continue;
            out.push(r);
        }
        return out;
    };
    S.logCounts = function () {
        return { recorded: recorded, kept: ring.length, dropped: Math.max(0, recorded - ring.length) };
    };
    S.logText = function (filter) {
        var rows = S.log(filter);
        return rows.map(function (r) {
            return '#' + r.id + '  f' + r.frame + '  ' + r.kind + '  ' + S.describe(r) +
                (r.overridden ? '  [overridden by a hold]' : '') + '  <- ' + r.from;
        }).join('\n');
    };
    S.clearLog = function () {
        ring.length = 0;
        recorded = 0;
        // The drift reports go with it: every one of them names a log entry by
        // number, and a number that is no longer in the log is worse than no
        // report at all.
        S.clearDrift();
        return true;
    };

    /**
     * Put the screen back to what it was before one journal entry.
     *
     * The snapshot is scalars only, so the pictures are deliberately left
     * alone and the button says so — the log stores numbers, not images.
     */
    S.revertTo = function (id) {
        var rec = null;
        for (var i = 0; i < ring.length; i++) if (ring[i].id === id) rec = ring[i];
        if (!rec) return { ok: false, why: 'entry #' + id + ' has already rolled off the end of the log.' };
        if (!rec.before) {
            return {
                ok: false,
                why: 'this entry has no snapshot — $gameScreen could not be read when it was recorded, ' +
                    'so there is nothing to put back.'
            };
        }
        if (!alive()) return { ok: false, why: NO_GAME };
        if (!$.allowWrite('Reverting the screen')) return { ok: false, why: 'read-only mode is on.' };
        var now = S.state();
        var ok = restore(rec.before);
        if (ok) {
            $.undo.push('revert the screen to before #' + id, function () { restore(now); });
            $.log('ok', 'screen restored to before log entry #' + id + ' (' + rec.kind + ' ' + S.describe(rec) + ')');
        }
        return { ok: !!ok, why: ok ? '' : 'the restore threw — the log has the message.' };
    };

    /* =====================================================================
       PART 4 — THE DRIFT WATCH

       $.compat.verify is a same-tick check. A plugin that recomputes a field
       inside Game_Screen.update passes it and reverts one frame later, which
       is the failure this project exists to catch. Every instant write arms a
       watch for a few frames and reports what moved it, naming the journal
       entry that arrived in between when there is one.
       ===================================================================== */
    var watches = [];
    var drift = [];
    var DRIFT_MAX = 20;

    function armDrift(control, label, read, want, eq) {
        var frames = num('driftFrames', 12, 0, 300);
        if (frames <= 0) return;
        watches.push({
            control: control, label: label, read: read, want: want,
            eq: eq || function (a, b) { return a === b; },
            left: frames, sinceId: nextId, at: $.frameCount
        });
    }

    function reportDrift(w, got) {
        var culprit = null;
        for (var i = ring.length - 1; i >= 0; i--) {
            if (ring[i].id > w.sinceId && !ring[i].self) { culprit = ring[i]; break; }
        }
        var msg = 'the ' + w.label + ' was written and verified, then changed back ' +
            ($.frameCount - w.at) + ' frame(s) later. ' +
            (culprit
                ? 'The Screen log records #' + culprit.id + ' — ' + culprit.kind + ' ' +
                  S.describe(culprit) + ' from ' + culprit.from + '.'
                : 'Nothing was recorded in between, so whatever changed it does not go through the ' +
                  'engine\'s own start* functions — it writes the fields directly.');
        drift.unshift({
            control: w.control, label: w.label, at: $.frameCount,
            want: w.want, got: got, culprit: culprit ? culprit.id : 0, message: msg
        });
        while (drift.length > DRIFT_MAX) drift.pop();
        $.log('warn', 'screen: ' + msg);
    }

    S.drift = function () { return drift.slice(); };
    /** Clears the reports AND the watches still counting down. A watch armed
        by an earlier write would otherwise fire into a cleared list and the
        report would name a write nobody made since. */
    S.clearDrift = function () { drift.length = 0; watches.length = 0; return true; };

    /* =====================================================================
       PART 5 — THE HOLDS

       Two mechanisms, and a caller must not be able to arm one without the
       other: a per-frame re-assert AFTER the engine has walked, and an
       override inside the aliased start* so an event's attempt is recorded
       rather than silently lost.
       ===================================================================== */
    var HOLD_WHY = 'it re-asserts from the boot screen, and a held black tint is indistinguishable ' +
        'from a crash with the menu behind it';

    function holdOn(which) { return !!cfg('hold.' + which, false); }

    function heldTone() {
        var t = cfg('holdTone', [0, 0, 0, 0]);
        return tone4(t);
    }
    function heldWeather() {
        return { type: String(cfg('holdWeather.type', 'none')), power: num('holdWeather.power', 0, 0, 9) };
    }
    function heldZoom() {
        return {
            x: num('holdZoom.x', 0, -99999, 99999),
            y: num('holdZoom.y', 0, -99999, 99999),
            scale: num('holdZoom.scale', 1, 0.01, 100)
        };
    }

    /** Why a hold cannot fully work, or '' when it can. */
    function holdWhy(which) {
        var alias = { tone: 'Game_Screen.startTint (screen log)', weather: 'Game_Screen.changeWeather (screen log)', zoom: 'Game_Screen.setZoom (screen log)' }[which];
        var hk = $.hooks[alias];
        if (hk && hk.installed) return '';
        return 'the alias on ' + alias.split(' ')[0] + ' could not be installed, so an event\'s change is ' +
            'not overridden as it happens — the hold still puts the value back on the next frame, one ' +
            'frame late, and the attempt is not recorded.';
    }

    S.holds = function () {
        var t = heldTone(), w = heldWeather(), z = heldZoom();
        return {
            tone: { on: holdOn('tone'), value: t, why: holdOn('tone') ? holdWhy('tone') : '' },
            weather: { on: holdOn('weather'), type: w.type, power: w.power, why: holdOn('weather') ? holdWhy('weather') : '' },
            zoom: { on: holdOn('zoom'), x: z.x, y: z.y, scale: z.scale, why: holdOn('zoom') ? holdWhy('zoom') : '' }
        };
    };

    /**
     * Arm or disarm one hold. Turning one ON captures the value that is live
     * now, because a hold whose value came from somewhere else would snap the
     * screen to a state the user never asked for.
     */
    S.hold = function (which, on, value) {
        if (['tone', 'weather', 'zoom'].indexOf(which) < 0) return null;
        if (!$.allowWrite('Holding the ' + which)) return S.holds()[which];
        var s = alive() ? S.state() : null;
        if (on) {
            if (which === 'tone') set('holdTone', (value && tone4(value)) || (s ? s.tone.slice() : [0, 0, 0, 0]));
            if (which === 'weather') {
                set('holdWeather.type', (value && value.type) || (s ? s.weatherType : 'none'));
                set('holdWeather.power', (value && value.power) || (s ? s.weatherPower : 0));
            }
            if (which === 'zoom') {
                set('holdZoom.x', (value && value.x) || (s ? s.zoomX : 0));
                set('holdZoom.y', (value && value.y) || (s ? s.zoomY : 0));
                set('holdZoom.scale', (value && value.scale) || (s ? s.zoomScale : 1));
            }
        }
        set('hold.' + which, !!on);
        U.setActive('screen hold', holdOn('tone') || holdOn('weather') || holdOn('zoom'));
        return S.holds()[which];
    };

    /* =====================================================================
       PART 6 — THE WRITES

       One function per field, each of which: refuses through $.allowWrite
       with a named action; routes through $.compat.verify with its control
       key; writes value AND target AND duration together or goes through the
       engine's start* with a duration; pushes one undo entry; and arms a
       drift watch when the write was instant. A control someone adds later
       cannot forget one of the four, because there is nowhere to forget it.
       ===================================================================== */

    /** startTint, startFlash and Game_Picture.tint all call clone() on their
        argument. It is the engine's own Array extension, so a build that lost
        it turns a tint into a throw from inside the engine. */
    function arrayCloneOk() {
        return $.safe(function () { return typeof [].clone === 'function'; }, 'Array.clone', false);
    }
    S.arrayCloneWhy = function () {
        return arrayCloneOk() ? '' :
            'Array.prototype.clone is missing on this build — it is the engine\'s own extension and ' +
            'startTint and startFlash both call it, so the tint and flash controls write the fields ' +
            'directly instead of going through them.';
    };

    function mine(fn) {
        selfWrite++;
        try { return fn(); } finally { selfWrite--; }
    }

    function guard(label) {
        if (!alive()) return { ok: false, got: undefined, want: undefined, culprits: [], message: NO_GAME };
        if (!$.allowWrite(label)) return { ok: false, got: undefined, want: undefined, culprits: [], message: 'read-only mode is on.' };
        return null;
    }

    S.setTone = function (tone, duration) {
        var stop = guard('Changing the screen tint'); if (stop) return stop;
        var want = tone4(tone), d = Math.max(0, Math.round(nz(duration)));
        var before = S.state();
        var r = verify('screen.tone', function () {
            mine(function () {
                var g = $gameScreen;
                if (typeof g.startTint === 'function' && arrayCloneOk()) {
                    g.startTint(want.slice(), d);
                } else {
                    // The same three writes startTint makes, minus the clone
                    // it cannot do here. Target and duration together, always.
                    record('tint', [want.slice(), d]);
                    g._toneTarget = want.slice();
                    g._toneDuration = d;
                    if (d === 0) g._tone = want.slice();
                }
            });
        }, function () {
            return d === 0 ? tone4($gameScreen._tone) : tone4($gameScreen._toneTarget);
        }, want, sameTone);
        $.undo.push('change the screen tint', function () { restore(before); });
        if (d === 0) {
            armDrift('screen.tone', 'tint', function () { return tone4($gameScreen._tone); }, want, sameTone);
        }
        return r;
    };

    S.setBrightness = function (value) {
        var stop = guard('Changing the screen brightness'); if (stop) return stop;
        var want = Math.round(clamp(nz(value), 0, 255));
        var before = S.state();
        var r = verify('screen.brightness', function () {
            mine(function () {
                // There is no engine setter for the brightness itself, only
                // the two fades. Both durations go to zero with the value, or
                // an in-flight fade walks it straight back.
                record('fade', [want >= 255 ? 'in' : 'out', 0, want]);
                $gameScreen._brightness = want;
                $gameScreen._fadeOutDuration = 0;
                $gameScreen._fadeInDuration = 0;
            });
        }, function () { return Math.round(nz($gameScreen._brightness, 255)); }, want);
        $.undo.push('change the screen brightness', function () { restore(before); });
        armDrift('screen.brightness', 'brightness',
            function () { return Math.round(nz($gameScreen._brightness, 255)); }, want);
        return r;
    };

    S.fade = function (dir, duration) {
        var stop = guard('Fading the screen'); if (stop) return stop;
        var method = dir === 'in' ? 'startFadeIn' : 'startFadeOut';
        if (typeof $gameScreen[method] !== 'function') {
            return { ok: false, got: undefined, want: undefined, culprits: [],
                message: 'Game_Screen.prototype.' + method + ' is not a function on this build.' };
        }
        var d = Math.max(1, Math.round(nz(duration, 30)));
        var before = S.state();
        mine(function () { $.safe(function () { $gameScreen[method](d); }, method); });
        $.undo.push('fade the screen ' + dir, function () { restore(before); });
        return { ok: true, got: d, want: d, culprits: [], message: '' };
    };

    S.setFlash = function (colour, duration) {
        var stop = guard('Flashing the screen'); if (stop) return stop;
        var want = tone4(colour), d = Math.max(1, Math.round(nz(duration, 30)));
        var before = S.state();
        var r = verify('screen.flash', function () {
            mine(function () {
                var g = $gameScreen;
                if (typeof g.startFlash === 'function' && arrayCloneOk()) g.startFlash(want.slice(), d);
                else { record('flash', [want.slice(), d]); g._flashColor = want.slice(); g._flashDuration = d; }
            });
        }, function () { return tone4($gameScreen._flashColor); }, want, sameTone);
        $.undo.push('flash the screen', function () { restore(before); });
        return r;
    };

    S.stopFlash = function () {
        var stop = guard('Stopping the flash'); if (stop) return stop;
        var before = S.state();
        var r = verify('screen.flash', function () {
            mine(function () {
                var g = $gameScreen;
                // clear* has no alias — it is not a start* and an event never
                // calls it — so the stop is recorded here or it is invisible.
                record('flash', [[0, 0, 0, 0], 0]);
                if (typeof g.clearFlash === 'function') g.clearFlash();
                else { g._flashColor = [0, 0, 0, 0]; g._flashDuration = 0; }
            });
        }, function () { return tone4($gameScreen._flashColor).concat([nz($gameScreen._flashDuration)]).join(','); },
            '0,0,0,0,0');
        $.undo.push('stop the flash', function () { restore(before); });
        return r;
    };

    S.setShake = function (power, speed, duration) {
        var stop = guard('Shaking the screen'); if (stop) return stop;
        var p = clamp(Math.round(nz(power, 5)), 0, 9);
        var sp = clamp(Math.round(nz(speed, 5)), 0, 9);
        var d = Math.max(1, Math.round(nz(duration, 60)));
        var before = S.state();
        var r = verify('screen.shake', function () {
            mine(function () {
                var g = $gameScreen;
                if (typeof g.startShake === 'function') g.startShake(p, sp, d);
                else { record('shake', [p, sp, d]); g._shakePower = p; g._shakeSpeed = sp; g._shakeDuration = d; }
            });
        }, function () { return nz($gameScreen._shakePower) + ',' + nz($gameScreen._shakeSpeed); }, p + ',' + sp);
        $.undo.push('shake the screen', function () { restore(before); });
        return r;
    };

    /**
     * Stop a shake, offset included.
     *
     * Clearing the duration alone is what leaves a screen permanently a few
     * pixels to one side: updateShake only settles _shake on the frame the
     * sign flips, and at power 0 that frame never comes.
     */
    S.stopShake = function () {
        var stop = guard('Stopping the shake'); if (stop) return stop;
        var before = S.state();
        var r = verify('screen.shake', function () {
            mine(function () {
                var g = $gameScreen;
                record('shake', [0, 0, 0]);
                if (typeof g.clearShake === 'function') g.clearShake();
                else {
                    g._shakePower = 0; g._shakeSpeed = 0; g._shakeDuration = 0;
                    g._shakeDirection = 1; g._shake = 0;
                }
            });
        }, function () { return nz($gameScreen._shake) + ',' + nz($gameScreen._shakeDuration); }, '0,0');
        $.undo.push('stop the shake', function () { restore(before); });
        armDrift('screen.shake', 'shake offset', function () { return nz($gameScreen._shake); }, 0);
        return r;
    };

    /**
     * The zoom, instant or timed.
     *
     * The instant path does NOT go through startZoom: startZoom with a
     * duration of zero sets only the target and never moves the scale, so the
     * engine's own function does nothing at all. setZoom moves the scale and
     * leaves the target where it was, so the target is written too or the
     * next timed zoom eases from a value nobody set.
     */
    S.setZoom = function (x, y, scaleValue, duration) {
        var stop = guard('Changing the zoom'); if (stop) return stop;
        var zx = Math.round(nz(x)), zy = Math.round(nz(y));
        var sc = clamp(nz(scaleValue, 1), 0.01, 100);
        var d = Math.max(0, Math.round(nz(duration)));
        var before = S.state();
        var r = verify('screen.zoom', function () {
            mine(function () {
                var g = $gameScreen;
                if (d > 0 && typeof g.startZoom === 'function') {
                    g.startZoom(zx, zy, sc, d);
                    return;
                }
                if (typeof g.setZoom === 'function') g.setZoom(zx, zy, sc);
                else { record('zoom', [zx, zy, sc, 'set']); g._zoomX = zx; g._zoomY = zy; g._zoomScale = sc; }
                g._zoomScaleTarget = sc;
                g._zoomDuration = 0;
            });
        }, function () {
            return d > 0 ? round2(nz($gameScreen._zoomScaleTarget, 1)) : round2(nz($gameScreen._zoomScale, 1));
        }, round2(sc));
        $.undo.push('change the zoom', function () { restore(before); });
        if (d === 0) {
            armDrift('screen.zoom', 'zoom scale',
                function () { return round2(nz($gameScreen._zoomScale, 1)); }, round2(sc));
        }
        return r;
    };

    S.resetZoom = function () { return S.setZoom(0, 0, 1, 0); };

    S.setWeather = function (type, power, duration) {
        var stop = guard('Changing the weather'); if (stop) return stop;
        var t = String(type == null ? 'none' : type);
        var p = clamp(nz(power), 0, 9);
        var d = Math.max(0, Math.round(nz(duration)));
        var before = S.state();
        var r = verify('screen.weather', function () {
            mine(function () {
                var g = $gameScreen;
                if (typeof g.changeWeather === 'function') g.changeWeather(t, p, d);
                else {
                    record('weather', [t, p, d]);
                    if (t !== 'none' || d === 0) g._weatherType = t;
                    g._weatherPowerTarget = t === 'none' ? 0 : p;
                    g._weatherDuration = d;
                    if (d === 0) g._weatherPower = g._weatherPowerTarget;
                }
            });
        }, function () {
            // changeWeather keeps the OLD type until a timed fade to 'none'
            // finishes, so a timed stop is verified against the target power.
            return d > 0 ? round1(nz($gameScreen._weatherPowerTarget)) : String($gameScreen._weatherType);
        }, d > 0 ? round1(t === 'none' ? 0 : p) : t);
        $.undo.push('change the weather', function () { restore(before); });
        if (d === 0) {
            armDrift('screen.weather', 'weather', function () { return String($gameScreen._weatherType); }, t);
        }
        return r;
    };

    /**
     * The engine's four, with the current value kept when it is not one of
     * them.
     *
     * Neither engine validates the string — updateWeather copies whatever
     * $gameScreen holds straight onto the sprite — so a weather plugin can
     * define as many types as it likes and no panel can enumerate them. The
     * honest offer is "these four are the engine's own", plus a free-text
     * field, plus the current value whatever it is.
     */
    var ENGINE_WEATHER = ['none', 'rain', 'storm', 'snow'];
    S.weatherTypes = function () {
        var cur = alive() ? String($gameScreen._weatherType || 'none') : 'none';
        var opts = ENGINE_WEATHER.slice();
        var extra = opts.indexOf(cur) < 0;
        if (extra) opts.unshift(cur);
        return {
            engine: ENGINE_WEATHER.slice(), current: cur, options: opts, extra: extra,
            why: 'these four are the engine\'s own. A weather plugin can define more and no panel can ' +
                'enumerate them — set one by name below.'
        };
    };

    /**
     * Clear everything $gameScreen can hold, plus the scene fade.
     *
     * The escape hatch, reachable from the panel, from a hotkey and from the
     * console, and the command the diagnosis names. It is the answer to "name
     * the command that fixes it".
     */
    S.unstick = function (opts) {
        opts = opts || {};
        var out = { cleared: [], skipped: [], undo: 'unstick the screen' };
        if (!alive()) { out.skipped.push({ id: 'all', why: NO_GAME }); return out; }
        if (!$.allowWrite('Unsticking the screen')) {
            out.skipped.push({ id: 'all', why: 'read-only mode is on.' });
            return out;
        }
        var only = opts.only ? [].concat(opts.only) : null;
        function wanted(id) { return !only || only.indexOf(id) > -1; }
        var before = S.state();
        var g = $gameScreen;

        bulk++;
        $.safe(function () {
            if (wanted('tint')) {
                if (typeof g.clearTone === 'function') g.clearTone();
                else { g._tone = [0, 0, 0, 0]; g._toneTarget = [0, 0, 0, 0]; g._toneDuration = 0; }
                out.cleared.push('tint');
            }
            if (wanted('brightness')) {
                if (typeof g.clearFade === 'function') g.clearFade();
                else { g._brightness = 255; g._fadeOutDuration = 0; g._fadeInDuration = 0; }
                out.cleared.push('brightness');
            }
            if (wanted('flash')) {
                if (typeof g.clearFlash === 'function') g.clearFlash();
                else { g._flashColor = [0, 0, 0, 0]; g._flashDuration = 0; }
                out.cleared.push('flash');
            }
            if (wanted('shake')) {
                if (typeof g.clearShake === 'function') g.clearShake();
                else {
                    g._shakePower = 0; g._shakeSpeed = 0; g._shakeDuration = 0;
                    g._shakeDirection = 1; g._shake = 0;
                }
                out.cleared.push('shake');
            }
            if (wanted('zoom')) {
                if (typeof g.clearZoom === 'function') g.clearZoom();
                else {
                    g._zoomX = 0; g._zoomY = 0; g._zoomScale = 1;
                    g._zoomScaleTarget = 1; g._zoomDuration = 0;
                }
                out.cleared.push('zoom');
            }
            if (wanted('weather')) {
                if (typeof g.clearWeather === 'function') g.clearWeather();
                else {
                    g._weatherType = 'none'; g._weatherPower = 0;
                    g._weatherPowerTarget = 0; g._weatherDuration = 0;
                }
                out.cleared.push('weather');
            }
        }, 'unstick');
        bulk--;

        if (opts.sceneFade !== false && wanted('sceneFade')) {
            var f = S.clearSceneFade();
            if (f.ok) out.cleared.push('sceneFade');
            else out.skipped.push({ id: 'sceneFade', why: f.why });
        }

        // Every hold is switched off as well: leaving one armed means the
        // next frame puts back exactly what the user just cleared, which
        // reads as the button not working.
        ['tone', 'weather', 'zoom'].forEach(function (k) {
            if (holdOn(k)) { set('hold.' + k, false); out.cleared.push('hold.' + k); }
        });
        U.setActive('screen hold', false);

        $.undo.push('unstick the screen', function () { restore(before); });
        $.log('ok', 'screen unstuck — cleared ' + out.cleared.join(', ') +
            (out.skipped.length ? '; skipped ' + out.skipped.map(function (s) { return s.id; }).join(', ') : ''));
        return out;
    };

    /* =====================================================================
       PART 7 — PICTURES

       The battle-range shift, the target trap and the never-cache-a-
       Game_Picture rule all live behind this one interface.
       ===================================================================== */

    /**
     * How many slots this build has, and where the number came from.
     *
     * Feature-detected on the LIVE object every call, because both engines
     * have maxPictures() — one returns a literal, the other reads the
     * project's own setting — so this is a plugin question, never an engine
     * one, and a plugin can remove it or raise it at any time.
     */
    S.maxPictures = function () {
        if (alive() && typeof $gameScreen.maxPictures === 'function') {
            var v = $.safe(function () { return $gameScreen.maxPictures(); }, 'maxPictures', null);
            if (typeof v === 'number' && v > 0) {
                return { n: Math.floor(v), from: '$gameScreen.maxPictures()' };
            }
        }
        return { n: 100, from: 'no maxPictures() on this build — assuming 100' };
    };

    function realId(slot) {
        if (alive() && typeof $gameScreen.realPictureId === 'function') {
            return $.safe(function () { return $gameScreen.realPictureId(slot); }, 'realPictureId', slot);
        }
        return inBattle() ? slot + S.maxPictures().n : slot;
    }
    S.realId = realId;

    S.picturesAvailable = function () {
        return alive() && typeof $gameScreen.picture === 'function';
    };

    /**
     * Every slot, read fresh from $gameScreen.picture(n).
     *
     * Never a Game_Picture reference: $gameScreen is replaced wholesale when
     * a save is loaded, so anything held across a repaint points at a dead
     * object and shows the wrong picture with no symptom.
     */
    S.pictures = function () {
        if (!S.picturesAvailable()) return [];
        var max = S.maxPictures().n;
        var battle = inBattle();
        var out = [];
        for (var i = 1; i <= max; i++) {
            out.push(readSlot(i, battle));
        }
        return out;
    };
    S.picture = function (slot) {
        if (!S.picturesAvailable()) return null;
        return readSlot(Math.max(1, Math.round(nz(slot, 1))), inBattle());
    };

    function readSlot(slot, battle) {
        var p = $.safe(function () { return $gameScreen.picture(slot); }, 'picture ' + slot, null);
        var row = {
            slot: slot, real: realId(slot), inBattleRange: battle,
            occupied: !!p, showing: !!(p && p._name), name: (p && p._name) || '',
            origin: nz(p && p._origin), x: nz(p && p._x), y: nz(p && p._y),
            targetX: nz(p && p._targetX), targetY: nz(p && p._targetY),
            scaleX: nz(p && p._scaleX, 100), scaleY: nz(p && p._scaleY, 100),
            opacity: nz(p && p._opacity), blendMode: nz(p && p._blendMode),
            angle: nz(p && p._angle), tone: (p && p._tone) ? tone4(p._tone) : null,
            duration: nz(p && p._duration)
        };
        return row;
    }

    /** How many picture sprites the spriteset actually built. A slot above it
        is stored and never drawn, because createPictures runs ONCE. */
    S.spriteCount = function () {
        var ss = spriteset();
        if (!ss || !ss._pictureContainer || !ss._pictureContainer.children) return null;
        return ss._pictureContainer.children.length;
    };

    S.showPicture = function (slot, name, opts) {
        var stop = guard('Showing a picture'); if (stop) return stop;
        opts = opts || {};
        if (typeof $gameScreen.showPicture !== 'function') {
            return { ok: false, got: undefined, want: undefined, culprits: [],
                message: 'Game_Screen.prototype.showPicture is not a function on this build.' };
        }
        var n = Math.max(1, Math.round(nz(slot, 1)));
        var sprites = S.spriteCount();
        if (sprites !== null && n > sprites) {
            return { ok: false, got: undefined, want: undefined, culprits: [],
                message: 'slot ' + n + ' is above the ' + sprites + ' picture sprite(s) this spriteset built, ' +
                    'so nothing would be drawn.' };
        }
        var nm = String(name == null ? '' : name);
        var r = verify('screen.picture', function () {
            mine(function () {
                $gameScreen.showPicture(n, nm,
                    nz(opts.origin), nz(opts.x), nz(opts.y),
                    nz(opts.scaleX, 100), nz(opts.scaleY, 100),
                    nz(opts.opacity, 255), nz(opts.blendMode));
            });
        }, function () { var p = readSlot(n, inBattle()); return p.name; }, nm);
        $.undo.push('show a picture in slot ' + n, function () {
            mine(function () { $.safe(function () { $gameScreen.erasePicture(n); }, 'erasePicture'); });
        });
        return r;
    };

    /**
     * Move or edit one picture.
     *
     * Every value is written with its TARGET, and the duration is zeroed — the
     * same trap as the tone, five times over. On a build with easing the
     * targets are additionally reconstructed from _wholeDuration, so a value
     * edited mid-move without its target snaps somewhere neither value ever
     * was.
     */
    S.movePicture = function (slot, fields, duration) {
        var stop = guard('Moving a picture'); if (stop) return stop;
        var n = Math.max(1, Math.round(nz(slot, 1)));
        var cur = S.picture(n);
        if (!cur || !cur.occupied) {
            return { ok: false, got: undefined, want: undefined, culprits: [],
                message: 'slot ' + n + ' holds no picture, so there is nothing to move.' };
        }
        fields = fields || {};
        var d = Math.max(0, Math.round(nz(duration)));
        var target = {
            origin: fields.origin === undefined ? cur.origin : Math.round(nz(fields.origin)),
            x: fields.x === undefined ? cur.x : nz(fields.x),
            y: fields.y === undefined ? cur.y : nz(fields.y),
            scaleX: fields.scaleX === undefined ? cur.scaleX : nz(fields.scaleX),
            scaleY: fields.scaleY === undefined ? cur.scaleY : nz(fields.scaleY),
            opacity: fields.opacity === undefined ? cur.opacity : clamp(nz(fields.opacity), 0, 255),
            blendMode: fields.blendMode === undefined ? cur.blendMode : Math.round(nz(fields.blendMode))
        };
        var r = verify('screen.picture', function () {
            mine(function () {
                var p = $.safe(function () { return $gameScreen.picture(n); }, 'picture ' + n, null);
                if (!p) return;
                // One entry when the move STARTS, the way a tint with a
                // duration is one entry. There is no alias on movePicture,
                // because a picture already up and moving would otherwise fill
                // the ring by itself.
                record('picture', ['move slot ' + n,
                    Math.round(target.x) + ',' + Math.round(target.y) + (d > 0 ? ' over ' + d + 'f' : '')]);
                if (d > 0 && typeof $gameScreen.movePicture === 'function') {
                    // Ten arguments always. The tenth is the easing type on a
                    // build that has one and is ignored on a build that does
                    // not, which is the only safe way to call one function
                    // with two arities.
                    $gameScreen.movePicture(n, target.origin, target.x, target.y,
                        target.scaleX, target.scaleY, target.opacity, target.blendMode, d, 0);
                    return;
                }
                p._origin = target.origin;
                p._blendMode = target.blendMode;
                p._x = target.x; p._targetX = target.x;
                p._y = target.y; p._targetY = target.y;
                p._scaleX = target.scaleX; p._targetScaleX = target.scaleX;
                p._scaleY = target.scaleY; p._targetScaleY = target.scaleY;
                p._opacity = target.opacity; p._targetOpacity = target.opacity;
                p._duration = 0;
                if (fields.angle !== undefined) p._angle = nz(fields.angle);
            });
        }, function () {
            var p = S.picture(n);
            if (!p) return 'gone';
            return d > 0
                ? Math.round(p.targetX) + ',' + Math.round(p.targetY)
                : Math.round(p.x) + ',' + Math.round(p.y);
        }, Math.round(target.x) + ',' + Math.round(target.y));
        $.undo.push('move the picture in slot ' + n, function () {
            mine(function () {
                var p = $.safe(function () { return $gameScreen.picture(n); }, 'picture ' + n, null);
                if (!p) return;
                p._origin = cur.origin; p._blendMode = cur.blendMode;
                p._x = cur.x; p._targetX = cur.targetX;
                p._y = cur.y; p._targetY = cur.targetY;
                p._scaleX = cur.scaleX; p._targetScaleX = cur.scaleX;
                p._scaleY = cur.scaleY; p._targetScaleY = cur.scaleY;
                p._opacity = cur.opacity; p._targetOpacity = cur.opacity;
                p._angle = cur.angle; p._duration = cur.duration;
            });
        });
        return r;
    };

    /** The build's own arity for movePicture, so the panel never claims an
        easing was applied on a build that has none. */
    S.moveArity = function () {
        if (!alive() || typeof $gameScreen.movePicture !== 'function') {
            return { n: 0, why: 'Game_Screen.prototype.movePicture is not a function on this build.' };
        }
        var len = $gameScreen.movePicture.length;
        return {
            n: len,
            why: len >= 10
                ? 'this build takes an easing type; a timed move uses the default, which is linear.'
                : 'this build has no easing type — every timed move here is linear.'
        };
    };

    S.setPictureName = function (slot, name) {
        var stop = guard('Renaming a picture'); if (stop) return stop;
        var n = Math.max(1, Math.round(nz(slot, 1)));
        var nm = String(name == null ? '' : name);
        var cur = S.picture(n);
        if (!cur || !cur.occupied) {
            return { ok: false, got: undefined, want: undefined, culprits: [],
                message: 'slot ' + n + ' holds no picture, so there is no name to change.' };
        }
        var r = verify('screen.picture', function () {
            mine(function () {
                var p = $.safe(function () { return $gameScreen.picture(n); }, 'picture ' + n, null);
                if (!p) return;
                // Only the name. The sprite compares its cached _pictureName
                // and reloads on the next frame by itself, so no sprite has to
                // be touched from here.
                record('picture', ['rename slot ' + n, '"' + nm + '"']);
                p._name = nm;
            });
        }, function () { var p = S.picture(n); return p ? p.name : 'gone'; }, nm);
        $.undo.push('rename the picture in slot ' + n, function () {
            mine(function () {
                var p = $.safe(function () { return $gameScreen.picture(n); }, 'picture ' + n, null);
                if (p) p._name = cur.name;
            });
        });
        return r;
    };

    S.tintPicture = function (slot, tone, duration) {
        var stop = guard('Tinting a picture'); if (stop) return stop;
        var n = Math.max(1, Math.round(nz(slot, 1)));
        var want = tone4(tone), d = Math.max(0, Math.round(nz(duration)));
        var cur = S.picture(n);
        if (!cur || !cur.occupied) {
            return { ok: false, got: undefined, want: undefined, culprits: [],
                message: 'slot ' + n + ' holds no picture, so there is nothing to tint.' };
        }
        var r = verify('screen.picture', function () {
            mine(function () {
                var p = $.safe(function () { return $gameScreen.picture(n); }, 'picture ' + n, null);
                if (!p) return;
                if (typeof p.tint === 'function' && arrayCloneOk()) { p.tint(want.slice(), d); return; }
                record('picture', ['tint slot ' + n, fmtTone(want)]);
                p._tone = want.slice();
                p._toneTarget = want.slice();
                p._toneDuration = 0;
            });
        }, function () {
            var p = S.picture(n);
            return p && p.tone ? p.tone : [0, 0, 0, 0];
        }, want, sameTone);
        $.undo.push('tint the picture in slot ' + n, function () {
            mine(function () {
                var p = $.safe(function () { return $gameScreen.picture(n); }, 'picture ' + n, null);
                if (!p) return;
                p._tone = cur.tone ? cur.tone.slice() : null;
                p._toneTarget = cur.tone ? cur.tone.slice() : null;
                p._toneDuration = 0;
            });
        });
        return r;
    };

    S.erasePicture = function (slot) {
        var stop = guard('Erasing a picture'); if (stop) return stop;
        if (typeof $gameScreen.erasePicture !== 'function') {
            return { ok: false, got: undefined, want: undefined, culprits: [],
                message: 'Game_Screen.prototype.erasePicture is not a function on this build.' };
        }
        var n = Math.max(1, Math.round(nz(slot, 1)));
        var cur = S.picture(n);
        var idx = realId(n);
        var copy = deepCopyPicture(idx);
        var r = verify('screen.picture', function () {
            mine(function () { $gameScreen.erasePicture(n); });
        }, function () { var p = S.picture(n); return !!(p && p.occupied); }, false);
        if (copy.ok) {
            $.undo.push('erase the picture in slot ' + n, function () {
                mine(function () {
                    $.safe(function () { $gameScreen._pictures[idx] = copy.value; }, 'restore picture');
                });
            });
        } else if (cur && cur.occupied) {
            $.log('warn', 'slot ' + n + ' was erased with no undo — ' + copy.why);
        }
        return r;
    };

    /**
     * The ONLY safe copy is the live JsonEx.
     *
     * A serialiser plugin replaces JsonEx with a circular encoder;
     * JSON.parse(JSON.stringify(picture)) succeeds and hands back an object
     * with no prototype, and updatePictures then throws on the next frame from
     * inside the engine, at a stack frame nothing connects to the erase.
     */
    function jsonExOk() {
        return $.safe(function () {
            return typeof JsonEx !== 'undefined' && JsonEx && typeof JsonEx.makeDeepCopy === 'function';
        }, 'JsonEx', false);
    }
    S.jsonExWhy = function () {
        return jsonExOk() ? '' :
            'JsonEx.makeDeepCopy is not available on this build, and a plain JSON round trip returns ' +
            'objects with no prototype that throw from inside the engine on the next frame. Erasing ' +
            'still works; it just cannot be undone.';
    };
    function deepCopyPicture(idx) {
        if (!jsonExOk()) return { ok: false, value: null, why: S.jsonExWhy() };
        var v = $.safe(function () {
            return JsonEx.makeDeepCopy($gameScreen._pictures[idx] || null);
        }, 'deep copy picture', undefined);
        if (v === undefined) return { ok: false, value: null, why: 'the deep copy threw.' };
        return { ok: true, value: v, why: '' };
    }

    S.eraseAllAvailable = function () {
        if (!alive()) return { ok: false, why: NO_GAME };
        if (typeof $gameScreen.erasePicture !== 'function') {
            return { ok: false, why: 'Game_Screen.prototype.erasePicture is not a function on this build; ' +
                'the slots can be read but not cleared from here.' };
        }
        if (!$gameScreen._pictures || typeof $gameScreen._pictures.length !== 'number') {
            return { ok: false, why: '$gameScreen has no _pictures array on this build, so there is nothing to clear.' };
        }
        return { ok: true, why: '' };
    };

    /**
     * Clear BOTH ranges under one undo entry.
     *
     * erasePicture alone cannot reach both: it routes every id through
     * realPictureId, so outside a battle it can only ever touch the map half.
     * The current range goes through the engine's own function and the other
     * half is nulled directly, which is what erasePicture does anyway — it
     * writes null rather than deleting, so the array keeps its length and
     * updatePictures still visits the slot.
     */
    S.eraseAllPictures = function () {
        var avail = S.eraseAllAvailable();
        if (!avail.ok) return { ok: false, cleared: 0, why: avail.why };
        if (!$.allowWrite('Erasing every picture')) return { ok: false, cleared: 0, why: 'read-only mode is on.' };
        var g = $gameScreen;
        var max = S.maxPictures().n;
        var copy = jsonExOk()
            ? $.safe(function () { return JsonEx.makeDeepCopy(g._pictures); }, 'deep copy pictures', null)
            : null;
        var cleared = 0;
        bulk++;
        $.safe(function () {
            for (var i = 1; i <= max; i++) {
                if (g.picture(i)) cleared++;
                g.erasePicture(i);
            }
            for (var j = 0; j < g._pictures.length; j++) {
                if (g._pictures[j]) { cleared++; g._pictures[j] = null; }
            }
        }, 'erase all pictures');
        bulk--;
        record('picture', ['erase every slot', cleared + ' cleared']);
        if (copy) {
            $.undo.push('erase every picture', function () {
                $.safe(function () { $gameScreen._pictures = copy; }, 'restore pictures');
            });
        } else {
            $.log('warn', 'every picture was erased with no undo — ' + S.jsonExWhy());
        }
        $.log('ok', 'erased ' + cleared + ' picture slot(s) across both ranges');
        return { ok: true, cleared: cleared, why: copy ? '' : S.jsonExWhy() };
    };

    /* =====================================================================
       PART 8 — THE ALIASES

       Every one is on Game_Screen's own start* function, which is the choke
       point an event command, a plugin and a script call all pass through.
       Aliasing the interpreter's command handlers instead would miss every
       plugin and script writer, which on a modded game is most of them.

       Each body is one object push into a capped ring plus one interpreter
       probe, both skipped entirely when the log is off, and the whole of it
       sits inside $.safe so a bad probe cannot break a cutscene.
       ===================================================================== */
    var GS = (typeof Game_Screen !== 'undefined' && Game_Screen) ? Game_Screen.prototype : null;

    $.install('Game_Screen.startTint (screen log)', GS, 'startTint',
        function (original) {
            return function (tone, duration) {
                var held = holdOn('tone') ? heldTone() : null;
                $.safe(function () { record('tint', [tone4(tone), nz(duration)], !!held); }, 'screen log tint');
                if (held) return original.call(this, held.slice(), 0);
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.startTint is not a function on this build — tints will not appear in the ' +
        'Screen log and "hold this tint" cannot stop an event changing it. The Screen tab still reads and ' +
        'writes the tone directly.');

    $.install('Game_Screen.changeWeather (screen log)', GS, 'changeWeather',
        function (original) {
            return function (type, power, duration) {
                var held = holdOn('weather') ? heldWeather() : null;
                // The type string is recorded VERBATIM, which is how the panel
                // learns that this game's weather plugin uses names outside the
                // engine's four without having to know the plugin.
                $.safe(function () {
                    record('weather', [String(type), nz(power), nz(duration)], !!held);
                }, 'screen log weather');
                if (held) return original.call(this, held.type, held.power, 0);
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.changeWeather is not a function on this build — weather changes will not be ' +
        'logged, "hold this weather" cannot stop an event changing it, and the panel cannot learn any type ' +
        'names beyond the engine\'s four.');

    $.install('Game_Screen.startShake (screen log)', GS, 'startShake',
        function (original) {
            return function (power, speed, duration) {
                $.safe(function () {
                    record('shake', [nz(power), nz(speed), nz(duration)]);
                }, 'screen log shake');
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.startShake is not a function on this build — shakes will not be logged, so a ' +
        'screen left permanently offset cannot be traced to the call that did it.');

    $.install('Game_Screen.startFlash (screen log)', GS, 'startFlash',
        function (original) {
            return function (colour, duration) {
                // Not held: a flash decays on its own, and holding one would be
                // a strobe the user asked for.
                $.safe(function () { record('flash', [tone4(colour), nz(duration)]); }, 'screen log flash');
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.startFlash is not a function on this build — flashes will not be logged, so a ' +
        'strobing screen cannot be traced to the event repeating the call.');

    $.install('Game_Screen.startFadeOut (screen log)', GS, 'startFadeOut',
        function (original) {
            return function (duration) {
                $.safe(function () { record('fade', ['out', nz(duration)]); }, 'screen log fade out');
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.startFadeOut is not a function on this build — a screen faded to black will ' +
        'not be traceable to the event that faded it. The Screen tab can still read the brightness and ' +
        'write it back.');

    $.install('Game_Screen.startFadeIn (screen log)', GS, 'startFadeIn',
        function (original) {
            return function (duration) {
                $.safe(function () { record('fade', ['in', nz(duration)]); }, 'screen log fade in');
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.startFadeIn is not a function on this build — the log cannot tell a fade-out ' +
        'that was never answered from one that was.');

    $.install('Game_Screen.startZoom (screen log)', GS, 'startZoom',
        function (original) {
            return function (x, y, scaleValue, duration) {
                var held = holdOn('zoom') ? heldZoom() : null;
                $.safe(function () {
                    record('zoom', [nz(x), nz(y), nz(scaleValue, 1), nz(duration)], !!held);
                }, 'screen log zoom');
                if (held) {
                    // A held zoom is asserted instantly, because startZoom with
                    // a duration of zero would set the target and move nothing.
                    var self = this;
                    return $.safe(function () {
                        if (typeof self.setZoom === 'function') self.setZoom(held.x, held.y, held.scale);
                        self._zoomScaleTarget = held.scale;
                        self._zoomDuration = 0;
                    }, 'held zoom');
                }
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.startZoom is not a function on this build — zooms will not be logged and ' +
        '"hold this zoom" cannot stop a script call changing it.');

    $.install('Game_Screen.setZoom (screen log)', GS, 'setZoom',
        function (original) {
            return function (x, y, scaleValue) {
                // The instant path, and the one a plugin actually uses, because
                // startZoom with a duration of zero sets only the target.
                // Hooking startZoom alone would log the zooms that do nothing
                // and miss the ones that work.
                var held = holdOn('zoom') ? heldZoom() : null;
                $.safe(function () {
                    record('zoom', [nz(x), nz(y), nz(scaleValue, 1), 'set'], !!held);
                }, 'screen log setZoom');
                if (held) return original.call(this, held.x, held.y, held.scale);
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.setZoom is not a function on this build — instant zoom changes will not be ' +
        'logged, and the Zoom controls fall back to writing _zoomScale, _zoomScaleTarget and _zoomDuration ' +
        'directly, which is stated in the panel.');

    $.install('Game_Screen.showPicture (screen log)', GS, 'showPicture',
        function (original) {
            return function (pictureId, name) {
                $.safe(function () {
                    record('picture', ['show slot ' + nz(pictureId),
                        '"' + String(name == null ? '' : name) + '"' + (inBattle() ? ' (battle range)' : '')]);
                }, 'screen log showPicture');
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.showPicture is not a function on this build — pictures appearing will not be ' +
        'logged. The Pictures tab still reads every slot live.');

    $.install('Game_Screen.erasePicture (screen log)', GS, 'erasePicture',
        function (original) {
            return function (pictureId) {
                $.safe(function () {
                    record('picture', ['erase slot ' + nz(pictureId), inBattle() ? '(battle range)' : '']);
                }, 'screen log erasePicture');
                return original.apply(this, arguments);
            };
        },
        'Game_Screen.prototype.erasePicture is not a function on this build — pictures being erased will not ' +
        'be logged, so "shown and never erased" cannot be distinguished from "shown and erased twenty ' +
        'frames later".');

    S.hooksInstalled = function () {
        var n = 0;
        $.hookList().forEach(function (hk) {
            if (hk.installed && hk.name.indexOf('(screen log)') > -1) n++;
        });
        return n;
    };

    /* =====================================================================
       PART 9 — THE PER-FRAME WORK

       $.frame() fires once per LOGICAL step from the Hooks gate — after the
       scene has updated on both engines and before the render — which is
       exactly where a hold has to be. Game_Screen.update is the wrong place:
       it runs twice per frame while the engine fast-forwards an event, and
       more than that under a fast-forward plugin.
       ===================================================================== */
    $.onFrame('screen holds', function () {
        if (!alive()) return;
        if (!holdOn('tone') && !holdOn('weather') && !holdOn('zoom')) return;
        $.safe(function () {
            var g = $gameScreen;
            if (holdOn('tone')) {
                var t = heldTone();
                // Written only when it actually differs. One engine caches the
                // tone in the spriteset and compares before re-applying, so
                // writing the same values costs nothing — but a FRESH array
                // every time, never our own held array, or the cache and the
                // value become the same object and the comparison stops firing.
                if (!sameTone(g._tone, t) || !sameTone(g._toneTarget, t) || g._toneDuration !== 0) {
                    g._tone = t.slice();
                    g._toneTarget = t.slice();
                    g._toneDuration = 0;
                }
            }
            if (holdOn('weather')) {
                var w = heldWeather();
                if (g._weatherType !== w.type || g._weatherPower !== w.power || g._weatherDuration !== 0) {
                    g._weatherType = w.type;
                    g._weatherPower = w.power;
                    g._weatherPowerTarget = w.power;
                    g._weatherDuration = 0;
                }
            }
            if (holdOn('zoom')) {
                var z = heldZoom();
                if (g._zoomScale !== z.scale || g._zoomX !== z.x || g._zoomY !== z.y || g._zoomDuration !== 0) {
                    g._zoomX = z.x; g._zoomY = z.y;
                    g._zoomScale = z.scale; g._zoomScaleTarget = z.scale;
                    g._zoomDuration = 0;
                }
            }
        }, 'screen holds');
    });

    $.onFrame('screen drift watch', function () {
        if (!watches.length) return;
        if (!alive()) { watches.length = 0; return; }
        for (var i = watches.length - 1; i >= 0; i--) {
            var w = watches[i];
            var got = $.safe(w.read, 'drift read ' + w.control, undefined);
            if (got !== undefined && !w.eq(got, w.want)) {
                watches.splice(i, 1);
                $.safe(function () { reportDrift(w, got); }, 'screen drift report');
                continue;
            }
            if (--w.left <= 0) watches.splice(i, 1);
        }
    });

    /* =====================================================================
       PART 10 — SHARED PANEL PIECES
       ===================================================================== */

    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: label }),
            // Unbounded on the right: a mechanism name, a weather type a
            // plugin invented, a picture path. .mm-edge does not shrink, so
            // without this the label is pushed out and then clipped.
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall',
                text: String(value)
            }));
    }

    function note(text, colour) {
        return h('div', {
            class: 'mm-sub',
            style: 'white-space:normal;padding:2px' + (colour ? ';color:' + colour : ''),
            text: text
        });
    }
    function warn(text) { return note(text, 'var(--mm-warn)'); }

    function noGame() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'no game running' }),
                h('div', { text: 'every value on this tab lives on $gameScreen, which the engine builds when ' +
                    'a game starts. Start or load a game, then reopen this tab.' })));
    }

    /** A mid-grey with this tone applied, close enough to recognise a cast. */
    function toneCss(t) {
        var r = clamp(128 + nz(t[0]), 0, 255);
        var g = clamp(128 + nz(t[1]), 0, 255);
        var b = clamp(128 + nz(t[2]), 0, 255);
        var grey = clamp(nz(t[3]), 0, 255) / 255;
        var l = r * 0.299 + g * 0.587 + b * 0.114;
        r = Math.round(r + (l - r) * grey);
        g = Math.round(g + (l - g) * grey);
        b = Math.round(b + (l - b) * grey);
        // Comma form: space-separated colour arguments are CSS Color 4 and the
        // floor is Chromium 66.
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    function bind(id) {
        var code = $.cfg.hotkeys ? $.cfg.hotkeys[id] : null;
        return code ? U.prettyCode(code) : null;
    }

    function fadeField() { return S.sceneFade().field; }

    /**
     * A group holding a table, in a column that also holds something else.
     *
     * .mm-grow is `flex:1 1 auto; min-height:0`, which is right when the group
     * is alone in its column and collapses it to nothing the moment a sibling
     * wants the space — the table is then a header with no rows and no hint
     * that anything is missing. The floor is the fix, and the column scrolls.
     */
    function tableGroup(title, kids, opts) {
        var g = W.group(title, kids, opts);
        g.style.minHeight = '170px';
        return g;
    }

    /* =====================================================================
       PANEL — Screen
       ===================================================================== */
    function buildScreen() {
        if (!alive()) return noGame();

        var s = S.state();
        var toneWritable = typeof $gameScreen.startTint === 'function';
        var toneDegraded = degraded('screen.tone');

        /* ------------------------------------------------- the live readout */
        var liveRows = [];
        function liveRow(label, get, tip, extra) {
            var val = h('span', { text: '—' });
            var edge = h('div', { class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall' }, val);
            if (extra) edge.appendChild(extra);
            var row = h('div', { class: 'mm-row', tip: tip || null },
                h('div', { class: 'mm-lab', text: label }), edge);
            liveRows.push({ row: row, val: val, get: get, last: null });
            return row;
        }

        var swatch = h('i', { class: 'mm-sw', style: 'margin-left:6px;background:' + toneCss(s.tone) });
        var toneRow = liveRow('Tint', function () {
            var st = S.state();
            if (!st) return '—';
            swatch.style.background = toneCss(st.tone);
            return st.tone.map(function (v) { return Math.round(v); }).join(',');
        }, null, swatch);

        var walkRow = liveRow('Walking to', function () {
            var st = S.state();
            if (!st || st.toneDuration <= 0) return '';
            // Never claim progress while the game is held: the walk runs from
            // Game_Screen.update, which does not run on the paused path.
            return '→ ' + st.toneTarget.map(function (v) { return Math.round(v); }).join(',') +
                ' in ' + Math.round(st.toneDuration) + 'f' +
                ($.pause && $.pause.active() ? ' (held — not moving)' : '');
        });

        var rows = [
            toneRow, walkRow,
            liveRow('Brightness', function () {
                var st = S.state(); if (!st) return '—';
                return Math.round(st.brightness) + (st.brightness <= 0 ? ' (fully dark)' : '');
            }),
            /* The sidebar is 210px and the label has to stay readable beside
               the value, so each row shows the NUMBER and the mechanism goes
               in the tip. The field this one was read from is also spelled out
               in Brightness and in the reference group, where there is room. */
            liveRow('Scene fade', function () {
                return String(Math.round(S.sceneFade().opacity));
            }, 'Scene fade|Read from ' + fadeField() + '. Not on $gameScreen, and no event command clears it.'),
            liveRow('Flash', function () {
                var st = S.state(); if (!st) return '—';
                if (st.flash[3] <= 0 && st.flashDuration <= 0) return 'none';
                return 'a=' + Math.round(st.flash[3]) + ' · ' + Math.round(st.flashDuration) + 'f';
            }, 'Flash|Alpha and the frames left. The colour is in the Flash group.'),
            liveRow('Shake', function () {
                var st = S.state(); if (!st) return '—';
                return round1(st.shake) + 'px · ' + Math.round(st.shakeDuration) + 'f';
            }, 'Shake|The live offset and the frames left; the power and speed are in the Shake group.'),
            liveRow('Zoom', function () {
                var st = S.state(); if (!st) return '—';
                return round2(st.zoomScale) + '× @' + Math.round(st.zoomX) + ',' + Math.round(st.zoomY);
            }),
            liveRow('Weather', function () {
                var st = S.state(); if (!st) return '—';
                return st.weatherType === 'none' ? 'none' : st.weatherType + ' · ' + round1(st.weatherPower);
            }, 'Weather|The type and its power, 0 to 9.'),
            liveRow('Pictures', function () {
                var st = S.state(); if (!st) return '—';
                return st.pictures.used + ' / ' + st.pictures.max;
            }, 'Pictures|Occupied slots, whether or not they are showing anything.')
        ];

        /* One pass every fourth frame, and each row only writes when its own
           text changed. fastHooks is cleared on every tab rebuild and only
           runs while the overlay is open, so nothing stacks up. */
        var host = U.getHost();
        if (host) {
            host.fastHooks.push(function (n) {
                if (n % 4) return;
                $.safe(function () {
                    for (var i = 0; i < liveRows.length; i++) {
                        var lr = liveRows[i];
                        if (!lr.row.parentNode) return;
                        var v = String(lr.get());
                        if (v === lr.last) continue;
                        lr.last = v;
                        lr.val.textContent = v || '—';
                        lr.row.style.display = (v === '' ? 'none' : '');
                    }
                }, 'screen readout tick');
            });
        }
        // Seed once so the panel is right before the first tick.
        for (var li = 0; li < liveRows.length; li++) {
            var seed = String($.safe(liveRows[li].get, 'screen readout seed', ''));
            liveRows[li].last = seed;
            liveRows[li].val.textContent = seed || '—';
            liveRows[li].row.style.display = (seed === '' ? 'none' : '');
        }

        /* -------------------------------------------------- the diagnosis */
        var found = S.diagnose();
        var diagLines = found.length
            ? found.map(function (d) {
                return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
                    h('b', { text: d.what + ' ' }), d.why + ' Fix: ' + d.fix);
            })
            : [note('nothing on $gameScreen looks stuck.')];
        diagLines.push(note('a black screen can also come from a picture covering it (the Pictures tab), from ' +
            'the scene\'s own fade, or from a plugin\'s own overlay — $gameScreen cannot see any of those.'));
        S.drift().slice(0, 3).forEach(function (d) { diagLines.push(warn(d.message)); });

        var fade = S.sceneFade();

        /* The escape hatches sit ABOVE the diagnosis, not below it: the
           diagnosis is several paragraphs when something is wrong, which is
           exactly when the button must not have been pushed off the bottom of
           a 210px sidebar. */
        var sidebar = [
            W.group('Right now', rows, { tag: 'live' }),
            W.group('Escape hatches', [
                W.button({
                    label: 'unstick everything' + (bind('unstickScreen') ? '  (' + bind('unstickScreen') + ')' : ''),
                    variant: 'danger', wide: true, mutates: true, confirmLabel: 'confirm?',
                    tip: 'Unstick|Clears the tint, brightness, flash, shake, zoom, weather and the scene fade.',
                    onClick: function () { S.unstick(); U.rerender(); }
                }),
                W.button({
                    label: 'clear the scene fade', wide: true, mutates: true, disabled: !fade.available,
                    onClick: function () { S.clearSceneFade(); U.rerender(); }
                }),
                fade.available ? null : warn(fade.why),
                h('div', { class: 'mm-sep' }),
                W.toggleRow('Log every write', {
                    value: !!cfg('log.on', true), _ungated: true, sub: 'the Screen log tab',
                    onChange: function (v) { set('log.on', v); }
                })
            ]),
            W.group('Is something stuck?', diagLines, { tag: found.length ? found.length + ' found' : 'clear' })
        ];

        /* ------------------------------------------------------------ tint */
        var draft = s.tone.slice();
        function toneSlider(i, label, lo, hi) {
            return W.row(label, W.slider({
                value: draft[i], min: lo, max: hi, step: 1, width: '150px',
                disabled: toneDegraded,
                // onChange fires once per pointermove and each write is a
                // verify plus a journal entry plus a drift watch, so the drag
                // only repaints and the WRITE is on commit.
                onChange: function (v) { draft[i] = v; swatch.style.background = toneCss(draft); },
                onCommit: function (v) { draft[i] = v; applyTone(); }
            }));
        }
        function applyTone() {
            var r = S.setTone(draft, num('duration', 0, 0, 600));
            if (!r.ok && r.message) U.toast({ title: 'TINT DID NOT STICK', msg: r.message, severity: 'warn' });
            U.rerender();
        }

        // The engine editor's own five defaults, not any game's.
        var PRESETS = [
            ['normal', [0, 0, 0, 0]], ['dark', [-68, -68, -68, 0]], ['sepia', [34, -34, -68, 170]],
            ['sunset', [68, -34, -34, 0]], ['night', [-68, -68, 0, 68]]
        ];
        var presetRow = h('div', { class: 'mm-inline', style: 'padding:2px' },
            PRESETS.map(function (p) {
                return W.chip({
                    label: p[0], value: sameTone(s.tone, p[1]),
                    onChange: function () {
                        draft = p[1].slice();
                        applyTone();
                    }
                });
            }));

        var holds = S.holds();

        var tintGroup = W.group('Tint', [
            toneWritable ? null : warn('Game_Screen.prototype.startTint is not a function on this build — ' +
                'something replaced Game_Screen without keeping it. The raw fields are still readable in the ' +
                'readout on the left, and these controls write them directly.'),
            degradeNote('screen.tone'),
            S.arrayCloneWhy() ? warn(S.arrayCloneWhy()) : null,
            toneSlider(0, 'Red', -255, 255),
            toneSlider(1, 'Green', -255, 255),
            toneSlider(2, 'Blue', -255, 255),
            toneSlider(3, 'Grey', 0, 255),
            W.row('Over', W.number({
                value: num('duration', 0, 0, 600), min: 0, max: 600, wide: true, _ungated: true,
                onChange: function (v) { set('duration', v); }
            }), { sub: 'frames; 0 applies at once' }),
            presetRow,
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'apply', variant: 'prime', mutates: true, disabled: toneDegraded,
                    onClick: applyTone
                }),
                W.button({
                    label: 'clear the tint', mutates: true, disabled: toneDegraded,
                    onClick: function () { draft = [0, 0, 0, 0]; applyTone(); }
                })),
            W.toggleRow('Hold this tint', {
                value: holds.tone.on, sub: 'forced off at every launch',
                tip: 'Hold|Re-asserts the tone every frame after the engine has walked it.',
                onChange: function (v) { S.hold('tone', v); U.rerender(); }
            }),
            holds.tone.why ? warn(holds.tone.why) : null
        ], { tag: s.toneDuration > 0 ? 'walking' : (sameTone(s.tone, [0, 0, 0, 0]) ? 'clear' : 'tinted') });

        /* ------------------------------------------------------ brightness */
        var fadeOutOk = typeof $gameScreen.startFadeOut === 'function';
        var fadeInOk = typeof $gameScreen.startFadeIn === 'function';
        var fadeFrames = num('fade.frames', 30, 1, 600);

        var brightGroup = W.group('Brightness and fade', [
            degradeNote('screen.brightness'),
            W.row('Brightness', W.slider({
                value: Math.round(s.brightness), min: 0, max: 255, step: 1, width: '150px',
                onCommit: function (v) { S.setBrightness(v); U.rerender(); }
            }), { tip: 'Brightness|Writing it zeroes both fade durations, or an in-flight fade walks it back.' }),
            W.row('Over', W.number({
                value: fadeFrames, min: 1, max: 600, wide: true, _ungated: true,
                onChange: function (v) { set('fade.frames', v); }
            }), { sub: 'frames' }),
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'fade out', mutates: true, disabled: !fadeOutOk,
                    onClick: function () { S.fade('out', num('fade.frames', 30, 1, 600)); U.rerender(); }
                }),
                W.button({
                    label: 'fade in', mutates: true, disabled: !fadeInOk,
                    onClick: function () { S.fade('in', num('fade.frames', 30, 1, 600)); U.rerender(); }
                })),
            fadeOutOk ? null : warn('Game_Screen.prototype.startFadeOut is not a function on this build.'),
            fadeInOk ? null : warn('Game_Screen.prototype.startFadeIn is not a function on this build.'),
            kv('Scene fade is read from', fade.field,
                'Scene fade|A different field on each engine. This is the feature detection, made visible.')
        ], { tag: s.brightness >= 255 ? 'full' : Math.round(s.brightness) + '/255' });

        /* ----------------------------------------------------------- flash */
        var flashColour = String(cfg('flash.colour', '#ffffff'));
        var flashAlpha = num('flash.alpha', 160, 0, 255);
        var flashFrames = num('flash.frames', 30, 1, 600);
        function flashRgb() {
            var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(flashColour);
            if (!m) return [255, 255, 255];
            return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
        }
        var nothingFlashing = s.flashDuration <= 0 && s.flash[3] === 0;

        var flashGroup = W.group('Flash', [
            degradeNote('screen.flash'),
            W.row('Colour', W.color({
                value: flashColour, label: 'Flash',
                onChange: function (v) { flashColour = v; set('flash.colour', v); }
            })),
            W.row('Strength', W.slider({
                value: flashAlpha, min: 0, max: 255, step: 1, width: '150px', _ungated: true,
                onChange: function (v) { flashAlpha = v; set('flash.alpha', v); }
            }), { sub: 'the alpha' }),
            W.row('Frames', W.number({
                value: flashFrames, min: 1, max: 600, wide: true, _ungated: true,
                onChange: function (v) { flashFrames = v; set('flash.frames', v); }
            })),
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'flash', mutates: true,
                    onClick: function () {
                        S.setFlash(flashRgb().concat([flashAlpha]), flashFrames);
                        U.rerender();
                    }
                }),
                W.button({
                    label: 'stop', mutates: true, disabled: nothingFlashing,
                    onClick: function () { S.stopFlash(); U.rerender(); }
                })),
            nothingFlashing ? note('nothing is flashing.') : null
        ], { tag: nothingFlashing ? 'idle' : Math.round(s.flashDuration) + 'f' });

        /* ----------------------------------------------------------- shake */
        var shakeGroup = W.group('Shake', [
            degradeNote('screen.shake'),
            W.row('Power', W.slider({
                value: num('shake.power', 5, 0, 9), min: 0, max: 9, step: 1, width: '150px', _ungated: true,
                onChange: function (v) { set('shake.power', v); }
            })),
            W.row('Speed', W.slider({
                value: num('shake.speed', 5, 0, 9), min: 0, max: 9, step: 1, width: '150px', _ungated: true,
                onChange: function (v) { set('shake.speed', v); }
            })),
            W.row('Frames', W.number({
                value: num('shake.frames', 60, 1, 600), min: 1, max: 600, wide: true, _ungated: true,
                onChange: function (v) { set('shake.frames', v); }
            })),
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'shake', mutates: true,
                    onClick: function () {
                        S.setShake(num('shake.power', 5, 0, 9), num('shake.speed', 5, 0, 9),
                            num('shake.frames', 60, 1, 600));
                        U.rerender();
                    }
                }),
                W.button({
                    label: 'stop', mutates: true,
                    onClick: function () { S.stopShake(); U.rerender(); }
                })),
            warn('stopping a shake writes the offset to 0 as well as the duration. updateShake only settles ' +
                'to exactly zero on the frame the sign flips, so a shake that ran at power 0 leaves the ' +
                'screen shifted for good and clearing the duration alone does not move it back.')
        ], { tag: Math.abs(s.shake) > 0.01 ? round1(s.shake) + 'px' : 'still' });

        /* ------------------------------------------------------------ zoom */
        var onMap = !inBattle() && typeof $gamePlayer !== 'undefined' && !!$gamePlayer;
        var zx = s.zoomX, zy = s.zoomY, zs = s.zoomScale;
        var zoomFrames = num('zoom.frames', 0, 0, 600);

        var zoomGroup = W.group('Zoom', [
            degradeNote('screen.zoom'),
            W.row('Scale', W.slider({
                value: zs, min: 0.1, max: 4, step: 0.05, width: '150px',
                onChange: function (v) { zs = v; },
                onCommit: function (v) { zs = v; S.setZoom(zx, zy, zs, zoomFrames); U.rerender(); }
            })),
            W.row('X', W.number({
                value: Math.round(zx), min: 0, max: graphicsW(), wide: true, _ungated: true,
                onChange: function (v) { zx = v; }
            })),
            W.row('Y', W.number({
                value: Math.round(zy), min: 0, max: graphicsH(), wide: true, _ungated: true,
                onChange: function (v) { zy = v; }
            })),
            W.row('Over', W.number({
                value: zoomFrames, min: 0, max: 600, wide: true, _ungated: true,
                onChange: function (v) { zoomFrames = v; set('zoom.frames', v); }
            }), { sub: 'frames; 0 applies at once' }),
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'apply', variant: 'prime', mutates: true,
                    onClick: function () { S.setZoom(zx, zy, zs, zoomFrames); U.rerender(); }
                }),
                W.button({
                    label: 'centre on the player', mutates: true, disabled: !onMap,
                    onClick: function () {
                        var px = $.safe(function () { return $gamePlayer.screenX(); }, 'screenX', 0);
                        var py = $.safe(function () { return $gamePlayer.screenY(); }, 'screenY', 0);
                        S.setZoom(px, py, zs, zoomFrames);
                        U.rerender();
                    }
                }),
                W.button({
                    label: 'reset', mutates: true,
                    onClick: function () { S.resetZoom(); U.rerender(); }
                })),
            onMap ? null : warn('no map is loaded, so there is no player position to centre on.'),
            W.toggleRow('Hold this zoom', {
                value: holds.zoom.on, sub: 'forced off at every launch',
                onChange: function (v) { S.hold('zoom', v); U.rerender(); }
            }),
            holds.zoom.why ? warn(holds.zoom.why) : null,
            note('no event command sets zoom — only a script call or a plugin does, so nothing in this ' +
                'game\'s own event list will clear it.'),
            note('an instant zoom is written with setZoom, because startZoom with a duration of 0 sets only ' +
                'the target and never moves the scale.')
        ], { tag: round2(s.zoomScale) + '×' });

        /* --------------------------------------------------------- weather */
        var wt = S.weatherTypes();
        var wsprite = S.weatherSprite();
        var wPower = s.weatherPower;
        var wFrames = num('weather.frames', 0, 0, 600);
        var wChoice = wt.current;

        var weatherGroup = W.group('Weather', [
            degradeNote('screen.weather'),
            W.row('Type', W.dropdown({
                options: wt.options, value: wChoice, width: '130px', _ungated: true,
                onChange: function (v) { wChoice = v; }
            })),
            note(wt.why),
            W.row('Or by name', W.text({
                placeholder: 'a type this game\'s weather plugin defines', width: '150px',
                onEnter: function (v) {
                    if (!v) return;
                    S.setWeather(v, wPower, wFrames);
                    U.rerender();
                }
            })),
            W.row('Power', W.slider({
                value: wPower, min: 0, max: 9, step: 0.5, width: '150px', _ungated: true,
                onChange: function (v) { wPower = v; }
            }), { sub: 'the engine draws power×10 particles' }),
            W.row('Over', W.number({
                value: wFrames, min: 0, max: 600, wide: true, _ungated: true,
                onChange: function (v) { wFrames = v; set('weather.frames', v); }
            }), { sub: 'frames' }),
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'apply', variant: 'prime', mutates: true,
                    onClick: function () { S.setWeather(wChoice, wPower, wFrames); U.rerender(); }
                }),
                W.button({
                    label: 'stop', mutates: true,
                    onClick: function () { S.setWeather('none', 0, 0); U.rerender(); }
                })),
            inBattle() ? warn('you are in a battle. The engine\'s own Set Weather Effect command refuses to ' +
                'run in battle and the battle spriteset has no weather sprite, so a change made here is ' +
                'written but not drawn until you are back on the map.') : null,
            (!inBattle() && !wsprite.present) ? warn(wsprite.why) : null,
            W.toggleRow('Hold this weather', {
                value: holds.weather.on, sub: 'forced off at every launch',
                onChange: function (v) { S.hold('weather', v); U.rerender(); }
            }),
            holds.weather.why ? warn(holds.weather.why) : null
        ], { tag: s.weatherType === 'none' ? 'clear' : s.weatherType });

        /* ------------------------------------------------------- reference */
        var refGroup = W.group('Where the screen state lives', [
            kv('Tint', S.toneMechanism()),
            kv('Brightness', S.brightnessMechanism()),
            kv('Flash', S.flashMechanism()),
            kv('Shake and zoom', 'Spriteset_Base.updatePosition — the same function on both engines'),
            kv('Weather', 'the map spriteset\'s weather sprite; the battle spriteset has none'),
            kv('Scene fade', fade.field + ' — not on $gameScreen, and no event command clears it'),
            kv('Cleared when a battle starts',
                'fade, flash, shake, zoom and the battle picture range. NOT the tint and NOT the weather.'),
            kv('Cleared by the engine otherwise',
                'nothing. $gameScreen.clear() is called only when the object is built, so a tint or weather ' +
                'an event never cleared stays until something writes over it.')
        ], { collapsed: true });

        return cols({ narrow: true, items: sidebar },
            [tintGroup, brightGroup, flashGroup, shakeGroup, zoomGroup, weatherGroup, refGroup]);
    }

    /* =====================================================================
       PANEL — Pictures
       ===================================================================== */
    var picQuery = '';
    var picSlot = 0;

    function buildPictures() {
        if (!alive()) return noGame();
        if (typeof $gameScreen.picture !== 'function') {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'picture slots are not readable here' }),
                    h('div', { text: '$gameScreen.picture is not a function on this build — something ' +
                        'replaced Game_Screen without keeping it. The tint, weather and zoom controls on ' +
                        'the Screen tab still work.' })));
        }

        var max = S.maxPictures();
        var battle = inBattle();
        var all = S.pictures();
        var used = 0, showing = 0;
        all.forEach(function (p) { if (p.occupied) used++; if (p.showing) showing++; });

        var filter = String(cfg('pictures.filter', 'in use'));
        var preview = !!cfg('pictures.preview', false);
        var loadOk = $.safe(function () {
            return typeof ImageManager !== 'undefined' && ImageManager &&
                typeof ImageManager.loadPicture === 'function';
        }, 'loadPicture', false);
        var erase = S.eraseAllAvailable();

        function rows() {
            return all.filter(function (p) {
                if (filter === 'in use' && !p.occupied) return false;
                if (filter === 'showing something' && !p.showing) return false;
                if (picQuery && (p.name || '').toLowerCase().indexOf(picQuery) < 0) return false;
                return true;
            });
        }

        var sidebar = [
            W.group('Slots', [
                kv('Slots', max.n),
                note(max.from),
                kv('In use', used, 'In use|A slot holding a Game_Picture, named or not.'),
                kv('Showing something', showing,
                    'Showing|A slot can exist with an empty name; it draws nothing and is still occupied.'),
                kv('Reading', battle ? 'battle range ' + (max.n + 1) + '–' + (max.n * 2) : 'map range 1–' + max.n,
                    'Range|picture(n) adds maxPictures() to n while a battle is running, so slot 1 in battle ' +
                    'is a different picture from slot 1 on the map.'),
                S.spriteCount() === null ? null
                    : kv('Sprites built', S.spriteCount(),
                        'Sprites|Built once when the spriteset was created; a slot above this is stored and never drawn.')
            ], { tag: used + '/' + max.n }),
            W.group('Filter', [
                W.search({
                    placeholder: 'filter by name…', value: picQuery,
                    onInput: function (v) { picQuery = v; U.rerender(); }
                }),
                W.dropdown({
                    options: ['in use', 'showing something', 'all'], value: filter, _ungated: true,
                    onChange: function (v) { set('pictures.filter', v); U.rerender(); }
                }),
                W.toggleRow('Show thumbnails', {
                    value: preview, _ungated: true, disabled: !loadOk,
                    tip: 'Thumbnails|Re-fetched on every repaint and never cached — a cache-clearing plugin ' +
                        'can destroy the bitmap under us.',
                    onChange: function (v) { set('pictures.preview', v); U.rerender(); }
                }),
                loadOk ? null : warn('ImageManager.loadPicture is not a function on this build.')
            ]),
            W.group('Clear', [
                W.button({
                    label: 'erase every picture', variant: 'danger', wide: true, mutates: true,
                    confirmLabel: 'erase all?', disabled: !erase.ok,
                    onClick: function () {
                        var r = S.eraseAllPictures();
                        U.toast(r.ok
                            ? { title: 'ERASED', msg: r.cleared + ' slot(s), both ranges', severity: 'ok' }
                            : { title: 'NOT ERASED', msg: r.why, severity: 'warn' });
                        picSlot = 0;
                        U.rerender();
                    }
                }),
                note('both the map range and the battle range.'),
                erase.ok ? null : warn(erase.why),
                S.jsonExWhy() ? warn(S.jsonExWhy()) : null,
                degradeNote('screen.picture')
            ])
        ];

        /* --------------------------------------------------------- the table */
        /* Nine columns in a narrow window is most of the width spent before
           the name gets any, and the name is the only cell whose content is
           the project's rather than ours. Everything else is trimmed to what
           its longest real value needs; every edge is still draggable. */
        var tcols = [{ label: '#', w: '0 0 34px', cls: 'mm-td-num' }];
        if (preview) tcols.push({ label: '', w: '0 0 22px' });
        tcols = tcols.concat([
            { label: 'name', w: '1 1 0' },
            { label: 'origin', w: '0 0 48px' },
            { label: 'x,y', w: '0 0 74px', cls: 'mm-td-num' },
            { label: 'scale', w: '0 0 50px', cls: 'mm-td-num' },
            { label: 'op', w: '0 0 38px', cls: 'mm-td-num' },
            { label: 'blend', w: '0 0 54px' },
            { label: 'moving', w: '0 0 44px', cls: 'mm-td-num' },
            { label: '', w: '0 0 24px' }
        ]);

        var BLEND = ['normal', 'add', 'multiply', 'screen'];
        var picDegraded = degraded('screen.picture');

        var table = W.table({
            virtual: true, rowH: 17, key: 'screen.pictures', cols: tcols,
            empty: filter === 'all' ? 'no slots' : 'no picture is showing',
            render: function (p) {
                var cells = [String(p.slot)];
                if (preview) {
                    cells.push(p.showing && loadOk
                        ? h('i', { class: 'mm-dotmark', style: 'background:var(--mm-ok)' })
                        : h('i', { class: 'mm-dotmark', style: 'background:#3f434b' }));
                }
                cells.push(p.occupied
                    ? W.editCell(p.name || '(no name)', function (v) {
                        S.setPictureName(p.slot, v === '(no name)' ? '' : v);
                        U.rerender();
                    }, 'mm-td-val mm-cell')
                    : h('span', { class: 'mm-cell mm-sub', text: '—' }));
                cells.push(p.occupied ? (p.origin === 1 ? 'centre' : 'left') : '');
                cells.push(p.occupied
                    ? W.editCell(Math.round(p.x) + ',' + Math.round(p.y), function (v) {
                        var m = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(v);
                        if (!m) { U.toast({ title: 'NOT A POSITION', msg: 'write it as x,y', severity: 'warn' }); return; }
                        S.movePicture(p.slot, { x: parseInt(m[1], 10), y: parseInt(m[2], 10) }, 0);
                        U.rerender();
                    }, 'mm-td-val mm-cell')
                    : '');
                cells.push(p.occupied
                    ? W.editCell(Math.round(p.scaleX) + '%', function (v) {
                        var n = parseFloat(String(v).replace('%', ''));
                        if (n !== n) return;
                        S.movePicture(p.slot, { scaleX: n, scaleY: n }, 0);
                        U.rerender();
                    }, 'mm-td-val mm-cell')
                    : '');
                cells.push(p.occupied
                    ? W.editCell(String(Math.round(p.opacity)), function (v) {
                        var n = parseInt(v, 10);
                        if (n !== n) return;
                        S.movePicture(p.slot, { opacity: n }, 0);
                        U.rerender();
                    }, 'mm-td-val mm-cell')
                    : '');
                cells.push(p.occupied ? (BLEND[p.blendMode] || String(p.blendMode)) : '');
                cells.push(p.duration > 0 ? Math.round(p.duration) + 'f' : '');
                cells.push(p.occupied
                    ? W.button({
                        label: '×', mini: true, mutates: true,
                        onClick: function () { S.erasePicture(p.slot); picSlot = 0; U.rerender(); }
                    })
                    : '');
                return cells;
            },
            onRow: function (tr, p) {
                if (p.slot === picSlot) tr.classList.add('mm-on');
                if (!p.occupied) tr.style.opacity = '.45';
                if (picDegraded) tr.style.opacity = '.55';
                tr.style.cursor = 'pointer';
                tr.setAttribute('data-mm-tip', 'Slot ' + p.slot +
                    (p.real !== p.slot ? ' (array index ' + p.real + ' — the battle range)' : '') + '|' +
                    (p.name || 'no name') + (picDegraded ? ' · writes here are not sticking' : ''));
                tr.addEventListener('click', function () { picSlot = p.slot; U.rerender(); });
            }
        });
        table.mm.paint(rows());

        return cols({ narrow: true, items: sidebar },
            [tableGroup('Every slot', [table], { grow: true, tag: rows().length + ' shown' }), slotEditor()]);

        /* ------------------------------------------------ the slot editor */
        function slotEditor() {
            if (!picSlot) {
                return W.group('Selected slot', [h('div', { class: 'mm-empty', text: 'select a slot above' })]);
            }
            var p = S.picture(picSlot);
            if (!p) return W.group('Selected slot', [h('div', { class: 'mm-empty', text: 'slot ' + picSlot + ' cannot be read' })]);

            var name = p.name;
            var showOk = typeof $gameScreen.showPicture === 'function';
            var sprites = S.spriteCount();
            var aboveLimit = sprites !== null && picSlot > sprites;
            var arity = S.moveArity();
            var mx = p.x, my = p.y, mf = 0;
            var idx = $.index && $.index.findAsset ? $.index.findAsset(p.name) : null;
            var chipLabel = !p.name ? 'no name'
                : (!idx || idx.complete === false) ? 'the index cannot say'
                    : (idx.candidates && idx.candidates.length ? 'in the index' : 'not in the index');

            var kids = [
                W.row('Name', W.text({
                    value: name, width: '100%', onInput: function (v) { name = v; }
                })),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'apply', mutates: true,
                        onClick: function () { S.setPictureName(picSlot, name); U.rerender(); }
                    })),
                // A picture name is an arbitrary-length folder path, so it goes
                // through the path widget: .mm-edge does not shrink and would
                // push the label out and then clip it.
                W.pathRow('File', p.name ? 'img/pictures/' + p.name + '.png' : '',
                    { why: 'this slot has no name, so nothing is drawn' }),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.chip({ label: chipLabel, value: chipLabel === 'in the index' }),
                    W.button({
                        label: 'check it', mini: true, _ungated: true, disabled: !p.name,
                        tip: 'Check|Loads it through the engine and reports what the bitmap says.',
                        onClick: function () { checkFile(p.name); }
                    })),
                // The `why` is printed VERBATIM: an incomplete index is a third
                // answer, and it must never be rendered as "the file is missing".
                (idx && idx.complete === false) ? note(idx.why) : null,
                W.row('Origin', W.dropdown({
                    options: ['upper left', 'centre'], value: p.origin === 1 ? 'centre' : 'upper left',
                    width: '110px',
                    onChange: function (v) {
                        S.movePicture(picSlot, { origin: v === 'centre' ? 1 : 0 }, 0);
                        U.rerender();
                    }
                })),
                W.row('Blend', W.dropdown({
                    options: BLEND, value: BLEND[p.blendMode] || 'normal', width: '110px',
                    onChange: function (v) {
                        S.movePicture(picSlot, { blendMode: Math.max(0, BLEND.indexOf(v)) }, 0);
                        U.rerender();
                    }
                })),
                W.row('Angle', W.number({
                    value: Math.round(p.angle), min: -3600, max: 3600, wide: true,
                    onChange: function (v) { S.movePicture(picSlot, { angle: v }, 0); }
                })),
                h('div', { class: 'mm-sep' }),
                W.row('Move to', [
                    W.number({ value: Math.round(p.x), min: -9999, max: 9999, wide: true, _ungated: true, onChange: function (v) { mx = v; } }),
                    W.number({ value: Math.round(p.y), min: -9999, max: 9999, wide: true, _ungated: true, onChange: function (v) { my = v; } }),
                    W.number({ value: 0, min: 0, max: 600, wide: true, _ungated: true, onChange: function (v) { mf = v; } })
                ], { sub: 'x · y · frames' }),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'move', mutates: true,
                        onClick: function () { S.movePicture(picSlot, { x: mx, y: my }, mf); U.rerender(); }
                    }),
                    W.button({
                        label: 'erase this slot', variant: 'danger', mutates: true,
                        onClick: function () { S.erasePicture(picSlot); picSlot = 0; U.rerender(); }
                    })),
                note(arity.why),
                h('div', { class: 'mm-sep' }),
                W.row('Show a picture here', W.text({
                    placeholder: 'a name under img/pictures', width: '150px',
                    onEnter: function (v) { doShow(v); }
                })),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'show', mutates: true, disabled: !showOk || aboveLimit,
                        onClick: function () { doShow(name); }
                    })),
                showOk ? null : warn('Game_Screen.prototype.showPicture is not a function on this build.'),
                aboveLimit ? warn('slot ' + picSlot + ' is above the ' + sprites + ' picture sprite(s) this ' +
                    'spriteset built, so nothing would be drawn. The sprites are created once, when the ' +
                    'scene is built — leaving and re-entering the map rebuilds them.') : null,
                degradeNote('screen.picture')
            ];

            function doShow(v) {
                var r = S.showPicture(picSlot, v, { x: p.x, y: p.y, origin: p.origin });
                if (!r.ok && r.message) U.toast({ title: 'NOT SHOWN', msg: r.message, severity: 'warn' });
                U.rerender();
            }

            var toneKids = [];
            var pt = p.tone || [0, 0, 0, 0];
            ['Red', 'Green', 'Blue', 'Grey'].forEach(function (lab, i) {
                toneKids.push(W.row(lab, W.slider({
                    value: pt[i], min: i === 3 ? 0 : -255, max: 255, step: 1, width: '140px',
                    onCommit: function (v) {
                        var next = pt.slice();
                        next[i] = v;
                        S.tintPicture(picSlot, next, 0);
                        U.rerender();
                    }
                })));
            });
            if (!p.tone) {
                toneKids.push(note('this slot has no tone yet — the first change creates one.'));
            }

            return h('div', { class: 'mm-stack' },
                W.group('Selected slot', kids, { tag: '#' + picSlot + (p.real !== p.slot ? ' · index ' + p.real : '') }),
                W.group('Its tone', toneKids, { collapsed: true }));
        }

        function checkFile(nm) {
            if (!loadOk) {
                U.toast({ title: 'CANNOT CHECK', msg: 'ImageManager.loadPicture is not a function here', severity: 'warn' });
                return;
            }
            // MV's loadPicture takes a hue argument MZ dropped; one argument
            // is correct on both.
            var bmp = $.safe(function () { return ImageManager.loadPicture(nm); }, 'loadPicture', null);
            if (!bmp) {
                U.toast({ title: 'CANNOT CHECK', msg: 'loadPicture returned nothing', severity: 'warn' });
                return;
            }
            // One frame later: a cache miss is asynchronous, and the answer on
            // the same tick is "not yet" for every file, present or not.
            $.onFrame('screen file check', function once() {
                $.offFrame(once);
                var ready = $.safe(function () {
                    return typeof bmp.isReady === 'function' ? bmp.isReady() : true;
                }, 'isReady', false);
                U.toast(ready
                    ? { title: 'LOADED', msg: nm + ' is readable by the engine', severity: 'ok' }
                    : { title: 'NOT READY', msg: nm + ' has not loaded — it may be missing, or still fetching', severity: 'warn' });
            });
        }
    }

    /* =====================================================================
       PANEL — Screen log
       ===================================================================== */
    var logQuery = '';
    var logSel = 0;

    function buildLog() {
        if (!alive()) return noGame();

        var counts = S.logCounts();
        var kinds = cfg('log.kinds', ALL_KINDS.slice());
        if (!kinds || !kinds.length) kinds = ALL_KINDS.slice();
        var on = !!cfg('log.on', true);
        var installed = S.hooksInstalled();

        var sidebar = [
            installed === 0 ? W.group('Nothing can be recorded', [
                warn('nothing could be aliased on Game_Screen on this build, so no write can be recorded. ' +
                    'Debug → Hooks lists each one and the reason it was skipped.')
            ], { tag: '0 hooks' }) : null,
            W.group('Recording', [
                W.toggleRow('Record screen writes', {
                    value: on, _ungated: true,
                    onChange: function (v) { set('log.on', v); U.rerender(); }
                }),
                W.row('Keep', W.number({
                    value: num('log.max', 200, 20, 2000), min: 20, max: 2000, step: 20, wide: true, _ungated: true,
                    onChange: function (v) { set('log.max', v); U.rerender(); }
                }), { sub: 'entries', tip: 'Keep|The ring is memory-only; nothing survives a relaunch.' }),
                W.row('Show', W.dropdown({
                    multi: true, options: ALL_KINDS, value: kinds, width: '118px', _ungated: true,
                    allLabel: 'all', emptyLabel: 'none',
                    onChange: function (v) { set('log.kinds', v); U.rerender(); }
                }), { tip: 'Show|Filters the list only. Every kind is recorded either way.' }),
                W.search({
                    placeholder: 'filter…', value: logQuery,
                    onInput: function (v) { logQuery = v; U.rerender(); }
                }),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'clear the log', variant: 'danger', _ungated: true,
                        onClick: function () { S.clearLog(); logSel = 0; U.rerender(); }
                    }),
                    W.button({
                        label: 'copy the log', _ungated: true,
                        onClick: function () {
                            var text = S.logText({ kinds: kinds, q: logQuery });
                            U.toast(U.copyText(text)
                                ? { title: 'COPIED', msg: 'the log is on the clipboard', severity: 'ok' }
                                : { title: 'NO CLIPBOARD', msg: 'select it and copy it by hand', severity: 'warn' });
                        }
                    })),
                // Three numbers, never one: once the ring saturates, "kept"
                // stops moving and only "recorded" says anything is happening.
                kv('Recorded', counts.recorded),
                kv('Kept', counts.kept),
                kv('Dropped', counts.dropped)
            ], { tag: on ? 'on' : 'off' }),
            W.group('Not recorded', [
                note('a plugin that writes $gameScreen._tone directly, without going through startTint, is ' +
                    'invisible here — the aliases are on the engine\'s own start* functions.'),
                note('a scene fade is not a $gameScreen write and is not recorded; the Screen tab reads it ' +
                    'live instead.'),
                note('a picture that is already up and moving would fill the ring, so movePicture has no ' +
                    'alias; a move made here is one entry when it starts, and its remaining duration is ' +
                    'shown live on the Pictures tab.'),
                note('"erase every picture" records one summary entry, not one per slot.'),
                note('"unstick everything" is not recorded: it writes six fields at once and the undo ' +
                    'stack already holds what it replaced.')
            ], { collapsed: true })
        ];

        var rows = S.log({ kinds: kinds, q: logQuery });
        var mapId = $.safe(function () { return $gameMap.mapId(); }, 'mapId', 0);

        var table = W.table({
            virtual: true, rowH: 17, key: 'screen.log',
            empty: on ? 'nothing has written to the screen since the log started' : 'the log is off',
            cols: [
                { label: '#', w: '0 0 48px', cls: 'mm-td-num' },
                { label: 'frame', w: '0 0 62px', cls: 'mm-td-num' },
                { label: 'kind', w: '0 0 62px' },
                { label: 'what', w: '1 1 0' },
                { label: 'from', w: '1 1 0' },
                { label: '', w: '0 0 26px' }
            ],
            render: function (r) {
                var canGo = !!$.events && r.eventId > 0 && r.mapId === mapId;
                return [
                    // The RECORD id, never the row position: a filter renumbers
                    // a position and two rows then look like the same one.
                    String(r.id),
                    String(r.frame),
                    r.kind,
                    S.describe(r) + (r.overridden ? '  (held)' : ''),
                    h('span', { class: 'mm-cell', text: r.from }),
                    W.button({
                        label: '→', mini: true, _ungated: true, disabled: !canGo,
                        onClick: function () {
                            if (!canGo) return;
                            // The recorded id is resolved against the LIVE map,
                            // because an event can have been erased since — and
                            // the Events module is what owns going to one.
                            var e = liveEvent(r.eventId);
                            if (!e) {
                                U.toast({ title: 'NOT THERE', msg: 'event ' + r.eventId +
                                    ' is not on this map any more', severity: 'warn' });
                                return;
                            }
                            $.safe(function () {
                                if ($.events.select) $.events.select(r.eventId);
                                $.events.goTo({ mapId: r.mapId, x: e.x, y: e.y });
                            }, 'go to event');
                        }
                    })
                ];
            },
            onRow: function (tr, r) {
                if (r.id === logSel) tr.classList.add('mm-on');
                tr.style.cursor = 'pointer';
                var why = !$.events ? 'the Events module is not installed'
                    : !r.eventId ? 'no event was running when this was written'
                        : r.mapId !== mapId ? 'that event is on another map'
                            : 'go to event ' + r.eventId;
                tr.setAttribute('data-mm-tip', '#' + r.id + ' · ' + r.kind + '|' +
                    'engine frame ' + r.engineFrame + ' · ' + why);
                tr.addEventListener('click', function () { logSel = r.id; U.rerender(); });
            }
        });
        table.mm.paint(rows);

        return cols({ narrow: true, items: sidebar },
            [tableGroup('Writes', [table], { grow: true, tag: rows.length + ' shown' }), detail()]);

        function detail() {
            if (!logSel) {
                return W.group('This entry', [h('div', { class: 'mm-empty', text: 'select a row above' })]);
            }
            var rec = null;
            for (var i = 0; i < rows.length; i++) if (rows[i].id === logSel) rec = rows[i];
            if (!rec) {
                return W.group('This entry', [
                    h('div', { class: 'mm-empty', text: 'entry #' + logSel + ' is no longer in the log' })]);
            }
            var b = rec.before, now = S.state();
            var kids = [
                kv('Kind', rec.kind),
                kv('Record', '#' + rec.id),
                kv('Our frame', rec.frame, 'Two clocks|Ours orders and dedupes; the engine\'s is what a player recognises.'),
                kv('Engine frame', rec.engineFrame < 0 ? 'not readable on this build' : rec.engineFrame),
                kv('Wall clock', new Date(rec.t).toLocaleTimeString()),
                kv('From', rec.from),
                kv('Map', rec.mapId || '—'),
                kv('Event', rec.eventId ? rec.eventId + (rec.eventName ? ' "' + rec.eventName + '"' : '') : '—'),
                kv('Common event', rec.commonEventId || '—'),
                kv('Command index', rec.index),
                kv('Raw arguments', JSON.stringify(rec.params)),
                rec.overridden ? warn('a hold was on, so this call was overridden and the held value was ' +
                    'written instead of the one asked for.') : null
            ];
            if (b && now) {
                kids.push(h('div', { class: 'mm-sep' }));
                kids.push(kv('Tint', b.tone.join(',') + '  →  ' + now.tone.join(',')));
                kids.push(kv('Brightness', Math.round(b.brightness) + '  →  ' + Math.round(now.brightness)));
                kids.push(kv('Shake', round1(b.shake) + '  →  ' + round1(now.shake)));
                kids.push(kv('Zoom', round2(b.zoomScale) + '×  →  ' + round2(now.zoomScale) + '×'));
                kids.push(kv('Weather', b.weatherType + '  →  ' + now.weatherType));
            }
            kids.push(W.button({
                label: 'put the screen back to before this write', variant: 'danger', wide: true, mutates: true,
                disabled: !b,
                onClick: function () {
                    var r = S.revertTo(rec.id);
                    if (!r.ok) U.toast({ title: 'NOT REVERTED', msg: r.why, severity: 'warn' });
                    U.rerender();
                }
            }));
            kids.push(note('restores the tint, brightness, flash, shake, zoom and weather that were live ' +
                'before this entry. Pictures are not restored — the log stores numbers, not images.'));
            if (!b) {
                kids.push(warn('this entry has no snapshot — $gameScreen could not be read when it was ' +
                    'recorded, so there is nothing to put back.'));
            }
            return W.group('This entry', kids, { tag: '#' + rec.id });
        }
    }

    /* =====================================================================
       PART 11 — REGISTRATION

       All three panels register unconditionally: the module's marker has to
       appear in the boot report on every game, and a panel that vanishes is
       indistinguishable from a module that failed to load. The BODIES are
       what degrade, each naming what is missing.
       ===================================================================== */
    U.panel('game', 'Screen', function () { return buildScreen(); }, 60);
    U.panel('game', 'Pictures', function () { return buildPictures(); }, 65);
    U.panel('game', 'Screen log', function () { return buildLog(); }, 70);

    U.addHotkey({
        id: 'unstickScreen', label: 'Unstick the screen',
        help: 'Clear the tint, brightness, flash, shake, zoom, weather and the scene fade',
        run: function () {
            var r = S.unstick();
            U.toast(r.cleared.length
                ? { title: 'SCREEN UNSTUCK', msg: r.cleared.join(', '), severity: 'ok' }
                : { title: 'NOTHING CLEARED', msg: (r.skipped[0] && r.skipped[0].why) || 'nothing to clear', severity: 'warn' });
            if (U.isOpen && U.isOpen()) U.rerender();
        }
    });

    /* ---------------------------------------------------------- console API
       When the screen is black and the panel is somehow unreachable, one typed
       word has to fix it — and it is the command the diagnosis names. */
    $.api.unstick = function (opts) {
        var r = S.unstick(opts);
        $.log('info', 'unstick: cleared ' + (r.cleared.join(', ') || 'nothing'));
        return r;
    };
    $.api.screen = function () { return S.state(); };
    $.api.screenDiagnose = function () { return S.diagnose(); };
    $.api.screenLog = function (n) { return S.log().slice(0, n || 20); };
    $.api.erasePictures = function () { return S.eraseAllPictures(); };

    /* -------------------------------------------------------- boot-unsafe
       A persisted hold is indistinguishable from a crash: a saved "hold the
       tone black" applies from the boot screen, before the overlay that would
       switch it off exists. Registering them here is also what scrubs them
       when a settings profile is loaded — a profile is the second way one of
       these arrives switched on. */
    ['tone', 'weather', 'zoom'].forEach(function (k) {
        $.store.unsafeAtBoot('screen.hold.' + k, HOLD_WHY);
    });
    (function scrubHolds() {
        var left = [];
        ['tone', 'weather', 'zoom'].forEach(function (k) {
            if (cfg('hold.' + k, false)) { set('hold.' + k, false); left.push(k); }
        });
        if (left.length) {
            $.log('warn', 'screen hold(s) were left on (' + left.join(', ') + ') — switched off, because ' +
                HOLD_WHY + '.');
        }
    }());
    U.setActive('screen hold', false);

    $.log('ok', 'screen ready — ' + S.hooksInstalled() + '/10 write hooks, ' +
        S.maxPictures().n + ' picture slot(s) (' + S.maxPictures().from + ')');

})(window.GigaHack);
