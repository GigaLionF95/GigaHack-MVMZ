//=============================================================================
// GigaHack MV/MZ
// 19 · player.js — movement, visibility, position, game speed
//-----------------------------------------------------------------------------
// Two invariants shape this file.
//
// 1. NOCLIP MUST BE THE OUTERMOST canPass.
//    setThrough(true) is not noclip. The engine's own
//    `isThrough() || isDebugThrough()` short-circuit lives INSIDE
//    Game_CharacterBase.canPass, and plugins commonly wrap canPass and refuse
//    for their own reason — a locked region, a fog of war, a quest gate —
//    BEFORE delegating to the original. Every such wrapper sits between the
//    caller and the short-circuit, so the short-circuit is never reached and
//    the tile stays solid however "through" the player is. Being the outermost
//    canPass is the only position from which noclip can be reliable, and
//    GigaHack's is by construction: this module loads late and aliases the
//    prototype, so its wrapper runs first.
//
// 2. GAME SPEED MUST NOT TOUCH SceneManager.updateMain UNLESS IT IS
//    RE-ENTRANT. Where it is not, updateMain renders and re-arms its own
//    animation frame from inside itself: calling it N times schedules N frames
//    that each schedule N more (exponential runaway), and returning before it
//    ends the loop for good (an unrecoverable hang). Hooks owns that knowledge
//    and exposes the safe primitives; this module asks for them rather than
//    keeping a second copy. See PART 2.
//
// Per-frame work belongs on $.onFrame, never on Scene_Map.update: a
// fast-forward plugin that multiplies the map scene's update while a key is
// held would multiply anything hung off it, and repeat rates would misbehave
// exactly when the player is holding a key. Hooks drives $.frame() from one
// gated point, which is the tick every module shares.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — movement, visibility, game speed
 * @author gigahack
 * @help GigaHack_Player.js — requires Core, Caps, Store, UI, Shell, Hooks,
 * Tabs, Map. Game speed and frame step are driven by Hooks.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — player not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    var P = $.player = {};

    function cfg(key, dflt) { return $.store.cfgGet('player.' + key, dflt); }
    function set(key, v) { return $.store.cfgSet('player.' + key, v); }
    P.cfg = cfg;

    function alive() {
        return typeof $gamePlayer !== 'undefined' && !!$gamePlayer &&
            typeof $gameMap !== 'undefined' && !!$gameMap;
    }
    P.alive = alive;

    /**
     * On a map, as opposed to merely having game objects.
     *
     * DataManager.setupNewGame runs createGameObjects before the title screen
     * appears, so $gamePlayer and $gameMap both exist there — but $dataMap is
     * still null until Scene_Map.create loads it. Anything that reads the
     * map's own data (the encounter list, the encounter step) needs this one,
     * or the title screen produces two caught TypeErrors per repaint and a
     * panel full of zeroes instead of saying there is no map yet.
     */
    function onMap() {
        return alive() && typeof $dataMap !== 'undefined' && !!$dataMap && !!$dataMap.events;
    }
    P.onMap = onMap;
    P.toast = function (o) { return U.toast(o); };

    /* =====================================================================
       PART 1 — MOVEMENT
       ===================================================================== */

    /**
     * Noclip.
     *
     * The map-bounds check is kept deliberately. Returning a flat `true` would
     * let the player walk off the edge of a non-looping map, and every tile
     * lookup from there reads outside the data array — which is not "noclip",
     * it is a broken map. roundXWithDirection handles the wrap on maps that
     * do loop, so this is the engine's own idea of "is there a tile there".
     */
    $.install('Game_CharacterBase.canPass (noclip)',
        typeof Game_CharacterBase !== 'undefined' ? Game_CharacterBase.prototype : null, 'canPass',
        function (original) {
            return function (x, y, d) {
                if (cfg('noclip', false) && typeof $gamePlayer !== 'undefined' && this === $gamePlayer) {
                    return $.safe(function () {
                        var x2 = $gameMap.roundXWithDirection(x, d);
                        var y2 = $gameMap.roundYWithDirection(y, d);
                        return $gameMap.isValid(x2, y2);
                    }, 'noclip bounds', true);
                }
                return original.apply(this, arguments);
            };
        });

    /**
     * Walk past events without setting them off.
     *
     * Only the touch path: checkEventTriggerTouch is what fires when you bump
     * into an event or one bumps into you. The action button still works, so
     * this is "stop tripping over things", not "the world stops responding" —
     * which is what suppressing canStartLocalEvents would have given.
     */
    function ghostBlocks() { return cfg('ghost', false); }

    // Bumping into a solid event.
    $.install('Game_Player.checkEventTriggerTouch (ghost)',
        typeof Game_Player !== 'undefined' ? Game_Player.prototype : null, 'checkEventTriggerTouch',
        function (original) {
            return function () {
                if (ghostBlocks()) return;
                return original.apply(this, arguments);
            };
        });

    // Walking ONTO a passable event's tile. updateNonmoving calls
    // checkEventTriggerHere([1, 2]) after every step, and that is the path a
    // trap or a transfer event fires through — hooking only the "bumped into
    // something solid" path left every one of those still firing, and noclip
    // made it worse by letting the player onto tiles they used to bounce off.
    $.install('Game_Player.checkEventTriggerHere (ghost)',
        typeof Game_Player !== 'undefined' ? Game_Player.prototype : null, 'checkEventTriggerHere',
        function (original) {
            return function () {
                if (ghostBlocks()) return;
                return original.apply(this, arguments);
            };
        });

    // An event walking into the player. Different prototype, same idea.
    $.install('Game_Event.checkEventTriggerTouch (ghost)',
        typeof Game_Event !== 'undefined' ? Game_Event.prototype : null, 'checkEventTriggerTouch',
        function (original) {
            return function () {
                if (ghostBlocks()) return;
                return original.apply(this, arguments);
            };
        });

    /**
     * Move speed. The engine's realMoveSpeed is `_moveSpeed + (dashing ? 1 : 0)`
     * and distancePerFrame is 2^speed/256 — so this is exponential, and 8 is
     * already a whole tile per frame.
     */
    $.install('Game_CharacterBase.realMoveSpeed (speed)',
        typeof Game_CharacterBase !== 'undefined' ? Game_CharacterBase.prototype : null, 'realMoveSpeed',
        function (original) {
            return function () {
                if (cfg('speedOverride', false) && typeof $gamePlayer !== 'undefined' && this === $gamePlayer) {
                    return Number(cfg('speed', 4)) || 4;
                }
                return original.apply(this, arguments);
            };
        });

    P.speedAvailable = function () {
        return !!($.hooks['Game_CharacterBase.realMoveSpeed (speed)'] &&
            $.hooks['Game_CharacterBase.realMoveSpeed (speed)'].installed);
    };

    /* -------------------------------------------------------- always dash
       ConfigManager.alwaysDash is the ENGINE's own option, and the game's
       options menu — its own, or whichever plugin replaced it — is already
       showing and writing the same flag.

       INVARIANT: where the engine already owns a setting, surface it and keep
       no second copy. Two copies disagree the moment either screen is used,
       and then one of them is lying. The flag is feature-detected rather than
       assumed: a build that removed it greys the control and says so. */
    P.dashAvailable = function () {
        return $.safe(function () {
            return typeof ConfigManager !== 'undefined' && 'alwaysDash' in ConfigManager;
        }, 'dash available', false);
    };
    P.dash = function () {
        return $.safe(function () { return !!ConfigManager.alwaysDash; }, 'alwaysDash', false);
    };
    P.setDash = function (v) {
        if (!P.dashAvailable()) return false;
        if (!$.allowWrite('Changing always-dash')) return false;
        return $.safe(function () {
            ConfigManager.alwaysDash = !!v;
            ConfigManager.save();
            $.log('ok', 'always dash: ' + (v ? 'on' : 'off'));
            return true;
        }, 'setDash', false);
    };

    /* ----------------------------------------------------------- visibility
       _transparent and _opacity live on Game_CharacterBase, which means they
       are in the save file. Turning the player invisible and then saving keeps
       them invisible in that save forever, so this is never restored from
       GigaHack's settings at boot and the panel carries a reset. */
    P.opacity = function () {
        return $.safe(function () { return $gamePlayer.opacity(); }, 'opacity', 255);
    };

    /**
     * The player only, deliberately.
     *
     * Followers are not a separate decision: Game_Follower.update runs every
     * frame and does `setOpacity($gamePlayer.opacity())` and
     * `setTransparent($gamePlayer.isTransparent())`, so they re-inherit the
     * player's values within one frame no matter what is set on them. An
     * option to exclude them would be a switch that does nothing.
     *
     * (An earlier draft iterated `$gamePlayer.followers().forEach(...)`. MZ
     * removed Game_Followers.forEach — it has data() / reverseData() /
     * follower(i) — so that threw on every call, and because Game_Followers is
     * always truthy the guard in front of it never fired.)
     */
    P.setOpacity = function (v) {
        if (!alive()) return false;
        if (!$.allowWrite('Changing player opacity')) return false;
        v = $.clamp(Math.round(v), 0, 255);
        return $.safe(function () {
            $gamePlayer.setOpacity(v);
            return true;
        }, 'setOpacity', false);
    };
    P.resetVisibility = function () {
        if (!alive()) return false;
        if (!$.allowWrite('Resetting player visibility')) return false;
        var ok = $.safe(function () {
            $gamePlayer.setOpacity(255);
            $gamePlayer.setTransparent(false);
            return true;
        }, 'resetVisibility', false);
        if (ok) $.log('ok', 'player visibility reset');
        return ok;
    };

    /* ------------------------------------------------------- position slot
       One overwritable slot with a hotkey. Named, permanent places are the
       Map module's job — Teleport → Bookmarks — and restoring goes back
       through its teleport, so it inherits the safe landing and the save
       backup. Where that module did not load, the fallback below still
       works and simply gets neither. */
    P.mark = function () {
        return $.store.cfgGet('player.mark', null);
    };
    P.setMark = function () {
        if (!alive()) return false;
        var pos = $.safe(function () {
            return {
                mapId: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y,
                d: $gamePlayer.direction(), at: Date.now()
            };
        }, 'mark', null);
        if (!pos || !pos.mapId) return false;
        set('mark', pos);
        var name = $.map ? $.map.mapName(pos.mapId) : ('map ' + pos.mapId);
        $.log('ok', 'position marked: ' + name + ' @ ' + pos.x + ',' + pos.y);
        U.toast({ title: 'POSITION MARKED', msg: name + ' · ' + pos.x + ',' + pos.y, severity: 'ok', ms: 1800 });
        return true;
    };
    P.recall = function () {
        var m = P.mark();
        if (!m) {
            U.toast({ title: 'NO MARK', msg: 'mark a position first', severity: 'warn' });
            return false;
        }
        if ($.map && $.map.teleport) {
            // Through the Map module, so a recall takes a save backup and
            // joins the teleport history like any other jump. The coordinates
            // are used exactly as marked — the safe-landing search lives in
            // that module's tab, not in teleport(), and this tile is one the
            // player already stood on anyway.
            return $.map.teleport(m.mapId, m.x, m.y, m.d, 0);
        }
        if (!$.allowWrite('Recalling a position')) return false;
        return $.safe(function () {
            $gamePlayer.reserveTransfer(m.mapId, m.x, m.y, m.d, 0);
            return true;
        }, 'recall', false);
    };

    /* =====================================================================
       PART 2 — GAME SPEED

       A LOGICAL STEP, not a frame. The unit this multiplies is one pass of
       the engine's game logic — updateInputData, changeScene, updateScene —
       and never the drawing that follows it. renderScene and requestUpdate
       are not in the path on ANY branch here, including the skipped one: the
       screen keeps being drawn and the next frame keeps being asked for at
       the engine's own rate, and only how much game happens in between
       changes. That is what makes the same code correct on both engines.

       Where updateMain is re-entrant it IS one logical step (the loop is
       driven from outside it), so it is multiplied directly — which is
       exactly what that engine does itself on a 120Hz display.

       Where it is not, updateMain renders and re-arms its own animation frame
       from inside itself, and touching it is fatal in both directions:
       repeating it schedules N animation frames that each schedule N more,
       and returning before it ends the chain permanently — an unrecoverable
       hang, because the un-pause would have to run inside the loop that is no
       longer running. So the multiplier moves down one level onto the
       per-step functions, the same three Hooks gates for pause, and the
       self-driving function is left completely alone.

       Sub-1x is a SKIPPED STEP, never an early return from a self-driving
       loop. On the per-step path the engine has already polled input and run
       changeScene by the time the skip happens, so a skipped step costs
       nothing but the game logic it was meant to cost.

       The multiplier is deliberately outside the pause gate (Hooks loads
       first, so its wrapper is the one this wraps) and asks $.pause.active()
       before multiplying anything: a held game must stay held at every
       multiplier, and running the gate N times per frame would also run the
       overlay's own per-frame work N times for nothing.
       ===================================================================== */
    var carry = 0;
    var MIN_SPEED = 0.1, MAX_SPEED = 8;
    var speedTarget = '';        // the function being multiplied, for the panel
    var speedWhy = '';           // why nothing is, when nothing is
    var holding = false;         // a hand-driven step, or an extra step, is in flight

    /** The clamped multiplier. */
    function wantedSpeed() {
        var speed = cfg('speedy', false) ? Number(cfg('gameSpeed', 1)) : 1;
        // Clamped at BOTH ends. settings.json is a text file and the Console
        // tab can write anything to it: a negative or NaN speed made `carry`
        // run away downwards, `runs` was permanently zero, and the engine
        // never updated again — on this launch or any after it, because the
        // value persists.
        if (!isFinite(speed) || speed <= 0) speed = 1;
        return $.clamp(speed, MIN_SPEED, MAX_SPEED);
    }

    /**
     * How many logical steps this pass is worth. 1 is "behave exactly as the
     * engine would", 0 is "skip this one", >1 is fast-forward.
     *
     * The fractional carry is what makes 1.5x mean 1.5x rather than 1x: the
     * remainder is kept and spent on a later step.
     */
    function runsThisPass() {
        // Already inside a step we are driving by hand, so this call IS that
        // step — multiplying it again would square the speed.
        if (holding) return 1;
        // Held by pause: one pass through the gate, which will decline it.
        if ($.pause && $.pause.available() && $.pause.active()) { carry = 0; return 1; }
        var speed = wantedSpeed();
        if (speed === 1) { carry = 0; return 1; }
        carry += speed;
        var runs = Math.floor(carry);
        carry -= runs;
        return runs;
    }

    /* Below 1x the step is skipped, but the input poll must not be:
       Input._previousState is only snapshotted inside Input.update(), and
       isTriggered() needs that false -> true edge. Skipping the poll three
       frames out of four makes a quick tap invisible to the engine. On the
       per-step path the engine has already polled by the time we skip, so
       this is only needed where the whole step is one function. */
    function pollInput() {
        $.safe(function () {
            if (typeof SceneManager !== 'undefined' && SceneManager.updateInputData) {
                SceneManager.updateInputData();
            }
        }, 'speed input poll');
    }

    if ($.caps.updateMainIsReentrant) {
        // One logical step per call, rendering and the frame request live
        // elsewhere: repeat and skip are both safe here, and repeating is what
        // the engine itself does when a frame ran long.
        if ($.install('SceneManager.updateMain (speed)',
            typeof SceneManager !== 'undefined' ? SceneManager : null, 'updateMain',
            function (original) {
                return function () {
                    var runs = runsThisPass();
                    if (runs <= 0) { pollInput(); return; }
                    if (runs === 1) return original.apply(this, arguments);
                    var r;
                    holding = true;
                    try {
                        for (var i = 0; i < runs; i++) r = original.apply(this, arguments);
                    } finally { holding = false; }
                    return r;
                };
            }, 'SceneManager.updateMain is not a function on this engine')) {
            speedTarget = 'SceneManager.updateMain';
        }
    }

    if (!speedTarget && $.caps.stepHooks) {
        /* The per-step path. updateScene is hooked because it is the LAST of
           the three functions a logical step runs, so by the time this wrapper
           is reached the engine has already done the input poll and the scene
           change for step one — and the extra steps are then whole steps in
           the engine's own order (input, change, update), which is the same
           definition $.step() uses.

           The extra steps drive updateInputData and changeScene through
           SceneManager so every other module's aliases still run; only
           updateScene is called as `original`, because calling it through
           SceneManager would re-enter this wrapper.

           Two consequences worth knowing about, neither of them a hazard:

            · Where the frame loop keeps a time accumulator and catches up by
              running its inner loop more than once, this wrapper is reached
              once per LOGICAL step rather than once per animation frame — so
              a caught-up frame is multiplied per step, as it should be. The
              engine clamps how much time it will ever try to catch up, so the
              work per real frame stays bounded rather than compounding.
            · $.frame() rides on the gate this wraps, so the mod's own tick
              counts logical steps too. That is the intended reading of "a
              frame" for everything hung off $.onFrame: at 4x the game is
              doing four steps, and a watch panel that updated once for all
              four would be showing three-quarters stale values. */
        if ($.install('SceneManager.updateScene (speed)',
            typeof SceneManager !== 'undefined' ? SceneManager : null, 'updateScene',
            function (original) {
                return function () {
                    var runs = runsThisPass();
                    if (runs <= 0) return;          // skip the logic; the frame still draws
                    var r = original.apply(this, arguments);
                    if (runs === 1) return r;
                    holding = true;
                    try {
                        for (var i = 1; i < runs; i++) {
                            if (SceneManager.updateInputData) SceneManager.updateInputData();
                            if (SceneManager.changeScene) SceneManager.changeScene();
                            r = original.apply(this, arguments);
                        }
                    } finally { holding = false; }
                    return r;
                };
            }, 'SceneManager.updateScene is not a function on this engine')) {
            speedTarget = 'SceneManager.updateScene';
        }
    }

    if (!speedTarget) {
        speedWhy = 'no multipliable frame-step function was found on this build' +
            ($.caps.updateMainWhy ? ' — ' + $.caps.updateMainWhy : '.');
        $.log('warn', 'game speed is unavailable — ' + speedWhy);
    }

    P.speedyAvailable = function () { return !!speedTarget; };
    P.speedyWhy = function () { return speedWhy; };
    P.describeSpeed = function () {
        if (!speedTarget) return 'unavailable — ' + speedWhy;
        return 'multiplies ' + speedTarget + '; rendering and the frame request run once per real ' +
            'frame whatever the multiplier is.';
    };

    /**
     * Advance the game by n logical steps.
     *
     * The mechanism belongs to Hooks and this is deliberately a thin wrapper
     * over $.step(): whether a hand-made step may call updateMain at all is an
     * engine fact, and keeping a second copy of that judgement here is exactly
     * how the fatal version of it comes back.
     *
     * Two things this wrapper owns, because they are policy rather than
     * mechanism:
     *
     *  · Pause is lifted for the duration. $.step() drives the same functions
     *    the pause gate closes, so with the flag left up the gate would
     *    decline every step and the button would do nothing. The swap is
     *    synchronous with no yield between the two assignments, so nothing
     *    else can observe it, and it is restored in a finally so a throw
     *    cannot leave the game un-pausable.
     *  · The multiplier is suspended. "Step 10" has to mean ten steps, not ten
     *    times the current speed.
     */
    var MAX_STEP = 600;
    P.step = function (n) {
        // Capped here as well as inside $.step, for the same reason the
        // multiplier is: these calls are synchronous with no render and no
        // yield between them, so a big number from the console is a hung
        // window, not a fast-forward.
        n = $.clamp(Math.floor(n || 1), 1, MAX_STEP);
        if (typeof $.step !== 'function') {
            $.log('warn', 'frame step needs the Hooks module, which did not load');
            return false;
        }
        var b = $.cfg && $.cfg.behaviour;
        var wasPaused = b ? b.pauseGame : false;
        var done = 0;
        holding = true;
        if (b) b.pauseGame = false;
        try {
            done = $.step(n);
        } finally {
            if (b) b.pauseGame = wasPaused;
            holding = false;
        }
        $.log('info', 'stepped ' + done + ' step' + (done === 1 ? '' : 's') +
            (done < n ? ' of ' + n + ' — the engine stopped accepting them' : ''));
        return done > 0;
    };

    /* =====================================================================
       PART 3 — HOTKEYS
       ===================================================================== */
    /**
     * Everything on this tab that changes how the game behaves also shows in
     * the active-cheats HUD and the footer count, like every other module's
     * does. Without it you can leave noclip on, quit, relaunch, and be walking
     * through walls with nothing on screen saying why.
     */
    function syncActive() {
        U.setActive('noclip', !!cfg('noclip', false));
        U.setActive('ghost', !!cfg('ghost', false));
        U.setActive('move speed', !!cfg('speedOverride', false));
        U.setActive('game speed', !!cfg('speedy', false) && Number(cfg('gameSpeed', 1)) !== 1);
    }
    P.syncActive = syncActive;

    function setSync(key, v) { set(key, v); syncActive(); }

    function toggle(key, label, onWord, offWord) {
        var v = !cfg(key, false);
        setSync(key, v);
        var word = v ? (onWord || 'on') : (offWord || 'off');
        $.log(v ? 'ok' : 'info', label + ': ' + word);
        U.toast({ title: label.toUpperCase(), msg: word, severity: v ? 'ok' : 'info', ms: 1400 });
        if (U.isOpen && U.isOpen()) U.rerender();
        return v;
    }

    U.addHotkey({
        id: 'noclip', label: 'Noclip', help: 'Walk through walls and events',
        run: function () { toggle('noclip', 'Noclip'); }
    });
    U.addHotkey({
        id: 'ghost', label: 'Ghost (no touch events)', help: 'Stop bumping into events and setting them off',
        run: function () { toggle('ghost', 'Ghost'); }
    });
    U.addHotkey({
        id: 'markPos', label: 'Mark this position', help: 'Overwrite the single quick position slot',
        when: onMap, run: function () { P.setMark(); }
    });
    U.addHotkey({
        id: 'recallPos', label: 'Recall the marked position', help: 'Teleport back to the marked tile',
        when: alive, run: function () { P.recall(); }
    });

    // The Battle module owns god mode; it predates the hotkey registry, so the
    // bind is offered here rather than duplicating the feature.
    if ($.battle) {
        U.addHotkey({
            id: 'godMode', label: 'God mode', help: 'Party HP never drops below 1',
            run: function () {
                var v = !$.store.cfgGet('battle.god', false);
                $.store.cfgSet('battle.god', v);
                U.toast({ title: 'GOD MODE', msg: v ? 'on' : 'off', severity: v ? 'ok' : 'info', ms: 1400 });
                $.log(v ? 'ok' : 'info', 'god mode ' + (v ? 'on' : 'off'));
                if (U.isOpen && U.isOpen()) U.rerender();
            }
        });
    }

    /* =====================================================================
       PART 4 — TAB
       ===================================================================== */
    function noGame() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'no game running' }),
                h('div', { text: 'start or load a game, then reopen this tab' })));
    }

    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: label }),
            // The value is unbounded — a path, a project's own name for
            // something, a joined list — so the edge is allowed to shrink and
            // wrap. Without that it pushes the label out and is then clipped
            // by the column, and neither half can be read.
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall',
                text: String(value)
            }));
    }

    function bind(id) {
        var code = $.cfg.hotkeys[id];
        return code ? U.prettyCode(code) : null;
    }

    function buildMovement() {
        if (!alive()) return noGame();

        var speedRow = W.row('Speed', W.slider({
            value: Number(cfg('speed', 4)) || 4, min: 1, max: 10, step: 0.5, width: '116px',
            _ungated: true, disabled: !cfg('speedOverride', false),
            onChange: function (v) { set('speed', v); }
        }), {
            tip: 'Move speed|Exponential: 4 walks, 5 dashes, 8 is a tile per frame and skips ' +
                'triggers.'
        });

        var left = [
            W.group('Movement', [
                W.toggleRow('Noclip', {
                    value: !!cfg('noclip', false), _ungated: true, keybind: false,
                    sub: bind('noclip'),
                    tip: 'Noclip|The map edge still stops you; nothing else does.',
                    onChange: function (v) { setSync('noclip', v); }
                }),
                W.toggleRow('Ghost past events', {
                    value: !!cfg('ghost', false), _ungated: true, keybind: false,
                    sub: bind('ghost'),
                    tip: 'Ghost|The action button still works, so you can still talk on purpose.',
                    onChange: function (v) { setSync('ghost', v); }
                }),
                h('div', { class: 'mm-sep' }),
                W.toggleRow('Override move speed', {
                    value: !!cfg('speedOverride', false), _ungated: true, keybind: false,
                    disabled: !P.speedAvailable(),
                    onChange: function (v) { setSync('speedOverride', v); U.rerender(); }
                }),
                speedRow,
                W.toggleRow('Always dash', {
                    value: P.dash(), keybind: false, _ungated: true,
                    disabled: !P.dashAvailable(),
                    tip: 'Always dash|The game\'s own option, not a second copy.',
                    onChange: function (v) { P.setDash(v); U.rerender(); }
                }),
                P.dashAvailable() ? null : h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: 'ConfigManager.alwaysDash was not found in this build.'
                })
            ], { tag: 'Game_Player' }),

            W.group('Visibility', [
                W.row('Opacity', W.slider({
                    value: Math.round(P.opacity() / 255 * 100), min: 0, max: 100, unit: '%', width: '116px',
                    label: 'Player opacity',
                    onChange: function (v) { P.setOpacity(v / 100 * 255); }
                })),
                W.button({
                    label: 'reset to fully visible', wide: true, mutates: true,
                    onClick: function () { P.resetVisibility(); U.rerender(); }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Saved with the character, so an invisible save loads invisible.')
            ], { tag: 'in the save' })
        ];

        var m = P.mark();
        var pos = $.safe(function () {
            return $gameMap.mapId() + ' · ' + $gamePlayer.x + ',' + $gamePlayer.y;
        }, 'pos', '—');

        /* Pause and frame step are separate capabilities and are asked about
           separately. Hooks decides whether the game can be held at all and
           already writes the sentence for it; stepping only needs $.step(),
           which exists wherever Hooks loaded, and is still useful on a build
           where pause could not be installed. */
        var pauseOk = !!($.pause && $.pause.available());
        var pauseText = $.pause ? $.pause.describe()
            : 'the Hooks module did not load, so nothing can hold the game.';
        var canStep = typeof $.step === 'function';

        var right = [
            W.group('Position', [
                kv('Here', pos),
                kv('Marked', m ? (($.map ? $.map.mapName(m.mapId) : 'map ' + m.mapId) + ' · ' + m.x + ',' + m.y) : 'nothing marked'),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'mark' + (bind('markPos') ? '  (' + bind('markPos') + ')' : ''),
                        wide: true, _ungated: true,
                        onClick: function () { P.setMark(); U.rerender(); }
                    }),
                    W.button({
                        label: 'recall' + (bind('recallPos') ? '  (' + bind('recallPos') + ')' : ''),
                        wide: true, mutates: true, disabled: !m,
                        onClick: function () { P.recall(); U.rerender(); }
                    })),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'One slot, overwritten each time. Named places live in World → Places.')
            ], { tag: 'quick slot' }),

            W.group('Time', [
                W.toggleRow('Override game speed', {
                    value: !!cfg('speedy', false), keybind: false, _ungated: true,
                    disabled: !P.speedyAvailable(),
                    tip: 'Game speed|Scales game logic, not drawing — the screen still paints once per ' +
                        'real frame. ' + P.describeSpeed(),
                    onChange: function (v) { setSync('speedy', v); U.rerender(); }
                }),
                W.row('Speed', W.slider({
                    value: Number(cfg('gameSpeed', 1)) || 1, min: 0.25, max: 8, step: 0.25, width: '116px',
                    _ungated: true, disabled: !cfg('speedy', false) || !P.speedyAvailable(),
                    onChange: function (v) { setSync('gameSpeed', v); }
                }), { sub: '×' }),
                P.speedyAvailable() ? null : h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: P.speedyWhy()
                }),
                h('div', { class: 'mm-sep' }),
                W.row('Frame step', h('div', { class: 'mm-inline' },
                    W.button({
                        label: '1', mutates: true, disabled: !canStep,
                        tip: 'Step|One logical step, paused or not; it shows on the next painted ' +
                            'frame.',
                        onClick: function () { P.step(1); }
                    }),
                    W.button({ label: '10', mutates: true, disabled: !canStep, onClick: function () { P.step(10); } }),
                    W.button({ label: '60', mutates: true, disabled: !canStep, onClick: function () { P.step(60); } }))),
                W.toggleRow('Pause while this menu is open', {
                    value: !!$.store.cfgGet('behaviour.pauseGame', false), keybind: false, _ungated: true,
                    disabled: !pauseOk,
                    tip: 'Pause|The same switch as Settings → Behaviour. ' + pauseText,
                    onChange: function (v) {
                        $.store.cfgSet('behaviour.pauseGame', v);
                        // The badge tracks actual state, and pause only applies
                        // while the menu is open — the same call Settings makes.
                        U.setActive('paused', v && U.isOpen());
                        U.rerender();
                    }
                }),
                pauseOk ? null : h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: 'Pause is unavailable here — ' + ($.pause ? $.pause.why() : 'the Hooks module did not load.')
                })
            ], { tag: cfg('speedy', false) ? cfg('gameSpeed', 1) + '×' : '1×' })
        ];
        return cols(left, right);
    }

    U.actorPanel('Movement', buildMovement, 10);

    $.api.noclip = function (v) {
        if (v == null) return !!cfg('noclip', false);      // a getter is a getter
        set('noclip', v !== false); return cfg('noclip');
    };
    $.api.speed = function (v) {
        if (v == null) return cfg('speed', 4);
        set('speedOverride', true); set('speed', v); return v;
    };
    $.api.step = function (n) { return P.step(n); };

    /**
     * Never found already on.
     *
     * The multiplier sits on the engine's frame step, which drives Scene_Boot
     * and Scene_Title long before the overlay exists — so a persisted 8x would
     * run the loading screen and the title at 8x from the first frame, and a
     * persisted 0.25x would look exactly like a hang. Store.js states the rule
     * for the event overlay and the battle bars; this belongs in the same
     * class, and unlike god mode it bites before a game even starts.
     */
    $.store.unsafeAtBoot('player.speedy', 'the game-speed override applies from the boot screen — 0.25x looks exactly like a hang');
    if ($.cfg.player && $.cfg.player.speedy) {
        $.cfg.player.speedy = false;
        $.store.saveSettings();
        $.log('warn', 'game speed override was left on — reset to 1x, because it applies from the boot screen');
    }
    syncActive();

    $.log('ok', 'player ready — ' + $.hookList().filter(function (x) {
        return x.installed && /noclip|ghost|speed/.test(x.name);
    }).length + ' movement hooks');
    $.log(P.speedyAvailable() ? 'info' : 'warn', 'game speed: ' + P.describeSpeed());

})(window.GigaHack);
