//=============================================================================
// GigaHack MV/MZ
// 06 · hooks.js — every engine method alias, and the module self-check
//-----------------------------------------------------------------------------
// All hooks go through $.install(), which:
//   · feature-detects the target and disables the dependent feature with a
//     visible reason instead of throwing at load time;
//   · records the alias in $.hooks so the Debug tab can list it and, where
//     safe, remove it at runtime.
// Every hook is additive (alias pattern). Nothing is replaced wholesale.
//
// One file, two engines. Every difference is asked as a capability
// ($.caps.*), never as a version string. One of those differences is worse
// than all the others put together — read the invariant in section 3 before
// touching the pause gate.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — engine hooks
 * @author gigahack
 * @help GigaHack_Hooks.js — requires Core, Caps, Store, UI, Shell
 */

(function ($) {
    'use strict';
    if (!$) { console.error('[GigaHack] core missing — hooks not installed'); return; }

    var U = $.ui;

    function overlayOpen() { return !!(U && U.isOpen && U.isOpen()); }
    function swallow() { return overlayOpen() && $.cfg.behaviour.swallowInput; }
    function isInstalled(name) { return !!($.hooks[name] && $.hooks[name].installed); }

    /* ---------------------------------------------------------------------
       1. Swallow the map's menu call while the overlay is open.

       Chosen over Scene_Map.isMenuCalled because menu-replacement plugins
       routinely replace isMenuCalled outright — it is the documented place to
       intervene, so it is the crowded one. updateCallMenu is its only caller
       and is left alone by nearly everything. The two are byte-identical on
       MV and MZ, so the choice costs nothing on either.
       ------------------------------------------------------------------ */
    $.install('Scene_Map.updateCallMenu',
        typeof Scene_Map !== 'undefined' ? Scene_Map.prototype : null, 'updateCallMenu',
        function (original) {
            return function () {
                if (swallow()) {
                    // Keep the engine's internal flags coherent while we hold
                    // input: pretend the menu was never requested.
                    this._calledMenu = undefined;
                    this.menuCalling = false;
                    return;
                }
                return original.apply(this, arguments);
            };
        }, 'Scene_Map.prototype.updateCallMenu is absent — a plugin has replaced the map scene, ' +
           'so the overlay cannot stop the game menu from opening under it');

    /* ---------------------------------------------------------------------
       2. Freeze the player while the overlay is open.
       ------------------------------------------------------------------ */
    $.install('Game_Player.canMove',
        typeof Game_Player !== 'undefined' ? Game_Player.prototype : null, 'canMove',
        function (original) {
            return function () {
                if (swallow()) return false;
                return original.apply(this, arguments);
            };
        }, 'Game_Player.prototype.canMove is absent — a movement plugin has replaced it, so the ' +
           'player will keep walking while the overlay has focus');

    /* =====================================================================
       3. Pause, and the per-frame tick that rides along with it.

       THE INVARIANT, stated plainly because breaking it hangs the game:

           SceneManager.updateMain is wrapped ONLY when
           $.caps.updateMainIsReentrant is true.

       Where it is true, the frame loop is driven from outside updateMain
       (a ticker calls it), rendering and the next-frame request live
       elsewhere, and updateMain is a plain "do one logical step" that is
       safe to skip or to repeat.

       Where it is false, updateMain ends with

           this.renderScene();
           this.requestUpdate();          // requestAnimationFrame(...)

       and the loop perpetuates itself from INSIDE the function. A wrapper
       that returns early there does not pause the game, it ENDS it: nothing
       calls updateMain again, so nothing renders and nothing schedules the
       next frame, and un-pausing cannot help because the un-pause would have
       to run inside the loop that is no longer running. Only reloading the
       game recovers it. The mirror image is as bad: calling the original
       twice schedules two animation frames, each of which schedules two
       more — exponential runaway inside a second.

       So where updateMain is not re-entrant we gate the three per-step
       functions it calls — updateInputData, changeScene, updateScene — and
       let renderScene and requestUpdate run on EVERY path, the paused one
       included. The engine keeps drawing and keeps asking for frames; only
       the game logic is held. Do not "simplify" this back into one hook.

       Note the fail-safe direction: if the capability table is missing
       entirely, updateMainIsReentrant reads as undefined and we take the
       per-step path. The worst case of guessing wrong that way is that pause
       is unavailable and says so. The worst case of guessing wrong the other
       way is an unrecoverable hang.
       ===================================================================== */

    /* Pause means "hold the game WHILE THE MENU IS OPEN", and the conjunction
       is load-bearing on both engines. The flag is persisted, so honouring it
       on its own would freeze the game the moment the menu closed — and then
       hang the NEXT launch on the loading spinner, because Scene_Boot.isReady
       is polled from SceneManager.changeScene, which is one of the functions
       this gate closes (it sits inside updateMain on one engine and beside it
       on the other; either way the gate reaches it).

       Two guards, not one. The flag is only read while the overlay is open,
       AND the gate refuses to close while a boot scene is pending whatever
       the flag and the overlay say. The second guard is what makes the first
       one's reasoning an enforced invariant instead of a comment. */
    function bootPending() {
        return $.safe(function () {
            if (typeof SceneManager === 'undefined') return false;
            if (typeof Scene_Boot === 'undefined') return false;
            return (SceneManager._scene instanceof Scene_Boot) ||
                   (SceneManager._nextScene instanceof Scene_Boot);
        }, 'boot scene check', false);
    }

    function paused() {
        var b = $.cfg && $.cfg.behaviour;
        if (!b || !b.pauseGame) return false;      // cheapest test first: this
        if (!overlayOpen()) return false;          // runs on every logical step
        return !bootPending();
    }

    var pauseTargets = [];     // labels of the functions actually gated
    var pauseWhy = '';         // why pause is unavailable, when it is
    var ticking = false;       // has something been made to call $.frame()?

    /* One gate. "tick" marks the single hook that also drives $.frame(), on
       BOTH paths — the overlay's own per-frame work must keep running while
       the game is held, or the watch panel freezes with it. */
    function gate(label, method, tick) {
        var ok = $.install(label + ' (pause)',
            typeof SceneManager !== 'undefined' ? SceneManager : null, method,
            function (original) {
                return function () {
                    if (paused()) {
                        // Nothing of the engine's step runs. That is the point
                        // of pause. GigaHack's hotkeys are DOM-level listeners
                        // and do not go through Input, so un-pausing is always
                        // reachable.
                        if (tick) $.frame();
                        return;
                    }
                    var r = original.apply(this, arguments);
                    if (tick) $.frame();
                    return r;
                };
            }, 'SceneManager.' + method + ' is not a function on this engine');
        if (ok) {
            pauseTargets.push('SceneManager.' + method);
            if (tick) ticking = true;
        }
        return ok;
    }

    if ($.caps.updateMainIsReentrant) {
        // The whole main update is skipped and rendering is left alone, so
        // the last frame stays on screen.
        gate('SceneManager.updateMain', 'updateMain', true);
    }
    if (!pauseTargets.length && $.caps.stepHooks) {
        // The per-step functions, in the order the engine calls them, with
        // the frame tick on the last so it fires once per logical step. This
        // is the only shape allowed where updateMain is not re-entrant, and
        // it is also the correct fallback where it is and could not be
        // aliased — these three exist on both engines and updateMain calls
        // all of them.
        gate('SceneManager.updateInputData', 'updateInputData', false);
        gate('SceneManager.changeScene', 'changeScene', false);
        gate('SceneManager.updateScene', 'updateScene', true);
    }

    if (!pauseTargets.length) {
        pauseWhy = 'no gateable frame-step function was found on this build' +
            ($.caps.updateMainWhy ? ' — ' + $.caps.updateMainWhy : '.');
        $.log('warn', 'pause is unavailable — ' + pauseWhy);
    }

    /* Something must drive the per-frame tick even when pause could not be
       installed, or the watch panel, the HUD and every module's per-frame
       hook stop updating. These wrappers are purely additive — they always
       call the original exactly once and never return early — so they are
       safe on a self-driving frame loop. */
    if (!ticking) {
        (function () {
            var candidates = ['updateScene', 'update'];
            for (var i = 0; i < candidates.length && !ticking; i++) {
                ticking = $.install('SceneManager.' + candidates[i] + ' (frame tick)',
                    typeof SceneManager !== 'undefined' ? SceneManager : null, candidates[i],
                    function (original) {
                        return function () {
                            var r = original.apply(this, arguments);
                            $.frame();
                            return r;
                        };
                    }, 'SceneManager.' + candidates[i] + ' is not a function on this engine');
            }
            if (!ticking) {
                $.log('err', 'nothing could be found to drive the per-frame tick — ' +
                    'the watch panel and every per-frame feature will not update.');
            }
        })();
    }

    /* ---------------------------------------------------------------------
       Per-frame entry point. Everything GigaHack needs each frame hangs off
       this one list, so there is a single try/catch boundary and a single
       place to see the cost.
       ------------------------------------------------------------------ */
    var frameHooks = [];
    /* `orig` is the function the CALLER handed over, kept beside the one that
       actually runs. Nothing here wraps fn — but the performance panel does, to
       time each hook by name, and offFrame is given the original rather than
       the wrapper. Without a record of what was registered, removing a timed
       hook would silently fail and the hook would keep running for the rest of
       the session. */
    $.onFrame = function (name, fn) { frameHooks.push({ name: name, fn: fn, orig: fn }); return fn; };
    $.offFrame = function (fn) {
        for (var i = frameHooks.length - 1; i >= 0; i--) {
            if (frameHooks[i].fn === fn || frameHooks[i].orig === fn) frameHooks.splice(i, 1);
        }
    };
    /** The registry itself, for the one panel that reports what each hook costs. */
    $.frameHooks = function () { return frameHooks; };
    $.frameCount = 0;
    $.frame = function () {
        $.frameCount++;
        // The draw registry and the read ring buffer are per-frame.
        if ($.registry.length) $.registry.length = 0;
        if ($.recentVarReads.length) $.recentVarReads.length = 0;
        for (var i = 0; i < frameHooks.length; i++) {
            try {
                frameHooks[i].fn($.frameCount);
            } catch (e) {
                var bad = frameHooks[i];
                frameHooks.splice(i, 1); i--;
                $.log('err', 'per-frame hook "' + bad.name + '" threw and was removed — ' + e.message);
            }
        }
    };

    /**
     * Advance the game by n logical steps while it is held.
     *
     * The only supported way to single-step, and the reason it lives here
     * rather than in the feature module that offers the button: calling
     * SceneManager.updateMain() by hand is safe on one engine and fatal on
     * the other, and this file is where that knowledge lives. Where updateMain
     * is not re-entrant, a step is exactly the body of its inner loop —
     * input, scene change, scene update — and deliberately NOT renderScene or
     * requestUpdate, because a hand-made requestUpdate() starts a second
     * animation-frame chain that never goes away.
     *
     * Capped, for the same reason the speed multiplier is: these calls are
     * synchronous with no render and no yield between them, so a large number
     * is a hung window and not a fast-forward.
     */
    var MAX_STEP = 600;
    $.step = function (n) {
        n = $.clamp(Math.floor(n || 1), 1, MAX_STEP);
        if (typeof SceneManager === 'undefined') return 0;
        var done = 0, i;
        for (i = 0; i < n; i++) {
            var ok = $.safe(function () {
                if ($.caps.updateMainIsReentrant) {
                    SceneManager.updateMain();
                } else {
                    if (SceneManager.updateInputData) SceneManager.updateInputData();
                    if (SceneManager.changeScene) SceneManager.changeScene();
                    if (SceneManager.updateScene) SceneManager.updateScene();
                }
                return true;
            }, 'frame step', false);
            if (!ok) break;
            done++;
            // A step goes THROUGH SceneManager, so it goes through the gate
            // installed above — and that gate already drives $.frame() on
            // both of its paths. Ticking again here would double-count every
            // stepped frame: the draw registry would be cleared twice, and
            // any per-frame rate expressed as "every n-th frame" would run at
            // double speed for the duration of a step. Only tick when nothing
            // gated is doing it for us.
            if (!ticking) $.frame();
        }
        return done;
    };

    /* What the pause gate ended up being, for the Debug tab and for any
       feature that wants to grey its own control with a reason. */
    $.pause = {
        active: paused,
        available: function () { return pauseTargets.length > 0; },
        targets: function () { return pauseTargets.slice(); },
        why: function () { return pauseWhy; },
        describe: function () {
            if (!pauseTargets.length) return 'unavailable — ' + pauseWhy;
            return 'holds ' + pauseTargets.join(', ') +
                '; rendering and the frame request are left alone, so the last frame stays on screen.';
        }
    };

    /* ---------------------------------------------------------------------
       4. Keep $gameTemp._gigahackOpen correct across scene/game rebuilds.
       DataManager.createGameObjects builds a fresh $gameTemp on new game and
       on load; without this the flag silently resets to undefined. The
       function is identical on both engines.
       ------------------------------------------------------------------ */
    $.install('DataManager.createGameObjects',
        typeof DataManager !== 'undefined' ? DataManager : null, 'createGameObjects',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                $.safe(function () {
                    if (typeof $gameTemp !== 'undefined' && $gameTemp) $gameTemp._gigahackOpen = overlayOpen();
                }, 're-apply overlay flag');
                $.emit('gameobjects');
                return r;
            };
        }, 'DataManager.createGameObjects is absent — the overlay-open flag will not survive a load');

    /* ---------------------------------------------------------------------
       5. Global error net. DevTools may not be available in a shipped build,
       so an unhandled error would otherwise be invisible. We do not suppress
       anything — the game's own error printer still runs.
       ------------------------------------------------------------------ */
    (function installErrorNet() {
        window.addEventListener('error', function (e) {
            if (!e) return;
            var where = (e.filename || '?').split(/[\\/]/).pop() + ':' + (e.lineno || '?');
            $.log('err', 'uncaught: ' + (e.message || 'unknown') + '  @ ' + where);
        });
        window.addEventListener('unhandledrejection', function (e) {
            var r = e && e.reason;
            $.log('err', 'unhandled promise rejection: ' + (r && r.message ? r.message : String(r)));
        });
    })();

    /* ---------------------------------------------------------------------
       What the game loaded, and which of it is known to fight a mod menu.

       The recognition table itself lives in $.compat: one table, with a named
       consequence per framework and the controls each one makes unreliable.
       A second list here would say less and drift out of step, so this asks
       for that one at call time (Compat loads after this file). When Compat
       is absent the report says so, rather than quietly reporting no risks.
       ------------------------------------------------------------------ */
    $.pluginReport = function () {
        return $.safe(function () {
            if (typeof $plugins === 'undefined' || !Array.isArray($plugins)) return null;
            var all = $plugins.map(function (p) {
                return { name: p.name, status: !!p.status, description: p.description || '' };
            });
            // One line per suite, not per file: a suite can ship dozens of
            // plugins and the point is made once. The consequence in full
            // belongs on the Compatibility panel, which has room for it.
            var warnings = [];
            if ($.compat && $.compat.frameworks) {
                $.compat.frameworks().forEach(function (f) {
                    warnings.push(f.name + ' (' + (f.plugins || []).join(', ') + ')' +
                        ((f.affects && f.affects.length) ? ' — affects ' + f.affects.join(', ') : ''));
                });
            } else {
                warnings.push('the compatibility module did not load, so no plugin-framework check ran. ' +
                    'Anything a large plugin suite would break is unreported, not absent.');
            }
            return {
                total: all.length,
                enabled: all.filter(function (p) { return p.status; }).length,
                plugins: all,
                warnings: warnings
            };
        }, 'plugin report', null);
    };

    /* ---------------------------------------------------------------------
       Save-file helpers used by the backup and transfer modules.

       INVARIANT: the save location is asked for at call time and never
       reconstructed from the game root. Plugins relocate the save directory
       on both engines — into the user's application-data folder, beside the
       executable, or wherever an in-game option points — and a mod that
       builds <gameRoot>/save by hand quietly backs up nothing at all.
       $.eng.saveDir()/savePath() ask StorageManager, whose method names
       differ between the engines, and return whatever it answers.
       ------------------------------------------------------------------ */
    $.saves = {
        available: function () {
            return !!($.eng && $.eng.saveDir && $.eng.saveDir()) && $.paths.mode === 'fs';
        },
        dir: function () {
            return ($.eng && $.eng.saveDir) ? $.eng.saveDir() : null;
        },
        fileFor: function (savefileId) {
            return ($.eng && $.eng.savePath) ? $.eng.savePath(savefileId) : null;
        }
    };


    /* =====================================================================
       SELF-CHECK — did every module actually run?

       A plugin file that 404s, throws on its first line, loses a name race or
       bails out of its own guard leaves NOTHING behind: the engine moves on,
       the overlay builds fine, and the only symptom is a panel that is
       quietly not there. That is a bad failure mode for a mod whose whole job
       is inspection, and it is the single hardest report to act on.

       The list is SELF-REGISTRATION, not a manifest. There is no file to read
       and no loader to ask: MODULES below is what this version ships, each
       module leaves a marker on $ as it runs, and the file for each one is
       resolved from $.paths.pluginsDir — the directory this script is sitting
       in, whichever of the three layouts that turns out to be. That works on
       a plain install, a www deploy, a mod-loader folder, and in a browser
       build with no filesystem at all (where the file columns read "?" and
       the "did it run" column still answers).

       The marker is a dotted path, not a bare property, because Core creates
       $.ui, $.caps and friends as empty objects up front: UI, Shell and Tabs
       all extend $.ui and a bare "is $.ui there" cannot tell them apart.
       ===================================================================== */
    var DEFAULT_MODULES = [
        { name: 'GigaHack_Core', marker: 'safe' },
        { name: 'GigaHack_Caps', marker: 'eng' },
        { name: 'GigaHack_Store', marker: 'store' },
        { name: 'GigaHack_Profile', marker: 'profile' },
        { name: 'GigaHack_UI', marker: 'ui.w' },
        { name: 'GigaHack_Shell', marker: 'ui.mount' },
        { name: 'GigaHack_Hooks', marker: 'onFrame' },
        { name: 'GigaHack_Tabs', marker: 'ui.panel' },
        { name: 'GigaHack_Compat', marker: 'compat' },
        { name: 'GigaHack_Index', marker: 'index' },
        { name: 'GigaHack_Vars', marker: 'vars' },
        { name: 'GigaHack_Inv', marker: 'inv' },
        { name: 'GigaHack_Party', marker: 'party' },
        { name: 'GigaHack_Backup', marker: 'backup' },
        { name: 'GigaHack_Map', marker: 'map' },
        { name: 'GigaHack_Events', marker: 'events' },
        { name: 'GigaHack_Battle', marker: 'battle' },
        { name: 'GigaHack_Text', marker: 'text' },
        { name: 'GigaHack_Forge', marker: 'forge' },
        { name: 'GigaHack_Player', marker: 'player' },
        { name: 'GigaHack_Encounters', marker: 'encounters' },
        { name: 'GigaHack_Gallery', marker: 'gallery' },
        { name: 'GigaHack_Steam', marker: 'steam' },
        { name: 'GigaHack_Save', marker: 'saveTools' },
        { name: 'GigaHack_Console', marker: 'console' },
        { name: 'GigaHack_Trace', marker: 'trace' },
        { name: 'GigaHack_Snapshot', marker: 'snap' },
        { name: 'GigaHack_Quest', marker: 'quest' },
        { name: 'GigaHack_Media', marker: 'media' },
        { name: 'GigaHack_Screen', marker: 'screen' },
        { name: 'GigaHack_Auto', marker: 'auto' },
        { name: 'GigaHack_Kit', marker: 'kit' },
        { name: 'GigaHack_Keys', marker: 'keys' },
        { name: 'GigaHack_Build', marker: 'build' },
        { name: 'GigaHack_Boot', marker: 'api.open' }
    ];

    /* Core owns the expected list when it declares one; this is the fallback
       so the report still works when Core is older than this file. Either
       way it is published on $ so there is exactly one list in the process. */
    var MODULES = ($.modules && $.modules.length) ? $.modules : DEFAULT_MODULES;
    $.modules = MODULES;

    function markerPresent(marker) {
        return $.safe(function () {
            var parts = String(marker).split('.'), o = $, i;
            for (i = 0; i < parts.length; i++) {
                if (o === undefined || o === null) return false;
                o = o[parts[i]];
            }
            return o !== undefined && o !== null;
        }, 'marker ' + marker, false);
    }

    function baseName(n) {
        return String(n).split('/').pop().split('\\').pop().replace(/\.js$/i, '');
    }

    function pluginFile(base) {
        var path = $.env.path;
        if (!path || !$.paths.pluginsDir) return null;
        return path.join($.paths.pluginsDir, base + '.js');
    }

    /** Is the module's .js file actually sitting in the plugins folder? */
    function fileOnDisk(base) {
        return $.safe(function () {
            var fs = $.env.fs, file = pluginFile(base);
            if (!fs || !file) return null;                       // null = could not tell
            return fs.existsSync(file);
        }, 'stat ' + base, null);
    }

    /**
     * Can this process actually READ it?
     *
     * Not the same question as "is it there", and the difference is the whole
     * bug this exists for: existsSync needs only search permission on the
     * directory, so a file owned by another user with mode 600 reports present
     * and then fails every read. The engine's script fetch fails, fs fails,
     * and the only visible symptom is a panel that is not there.
     *
     * Returns true / false / null when there is no way to tell.
     */
    function fileReadable(base) {
        return $.safe(function () {
            var fs = $.env.fs, file = pluginFile(base);
            if (!fs || !file || !fs.existsSync(file)) return null;
            // No accessSync is "cannot tell", not "cannot read". Reporting a
            // false negative here would rename every module unreadable on any
            // build with a reduced fs.
            if (typeof fs.accessSync !== 'function') return null;
            // R_OK is 4. fs.constants exists everywhere current, but the
            // literal costs nothing and this runs on an old Chromium.
            var R_OK = (fs.constants && fs.constants.R_OK) || 4;
            try { fs.accessSync(file, R_OK); return true; } catch (e) { return false; }
        }, 'access ' + base, null);
    }

    /** The mode and owner, for an error message that can be acted on. */
    function fileMode(base) {
        return $.safe(function () {
            var fs = $.env.fs, file = pluginFile(base);
            if (!fs || !file || typeof fs.statSync !== 'function') return '';
            var st = fs.statSync(file);
            return '0' + (st.mode & 511).toString(8) + ' uid ' + st.uid;
        }, 'mode ' + base, '');
    }

    /**
     * A mod loader keeps a manifest of what it intends to load. When the mod
     * is delivered that way it is worth reading — an entry that says
     * "status": false is the one explanation for a module that is present,
     * readable, uncontested and still absent — but it is an EXTRA column and
     * never the list itself. On the other two layouts there is no such file
     * and the report has to work exactly as well without it.
     */
    var manifestCache;
    $.manifest = function () {
        if (manifestCache !== undefined) return manifestCache;
        manifestCache = $.safe(function () {
            if ($.paths.layout !== 'modloader') return null;
            var fs = $.env.fs, path = $.env.path;
            if (!fs || !path || !$.paths.modRoot) return null;
            var file = path.join($.paths.modRoot, 'Meta.json');
            if (!fs.existsSync(file)) return null;
            var meta = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!meta) return null;
            var entries = {};
            if (Array.isArray(meta.plugins)) {
                meta.plugins.forEach(function (p) {
                    if (p && p.name) entries[baseName(p.name)] = !!p.status;
                });
            }
            return { file: file, version: meta.version ? String(meta.version) : null, entries: entries };
        }, 'read mod manifest', null);
        return manifestCache;
    };

    /**
     * Every place that names this plugin, and how.
     *
     * The two engines key their duplicate check differently, so both forms
     * are counted separately:
     *   · one dedups on the FILE BASENAME, so an entry "mods/Foo/X" collides
     *     with a plain "X";
     *   · the other dedups on the FULL ENTRY NAME, so those two do not
     *     collide but two identical entries do.
     * Either way the second claim on a name is dropped with no fetch, no
     * error and no trace, and the losing module simply never exists.
     */
    function namesFor(base) {
        return $.safe(function () {
            var out = { exact: 0, byBase: 0, from: [] };
            if (typeof $plugins !== 'undefined' && Array.isArray($plugins)) {
                $plugins.forEach(function (pl) {
                    if (!pl || !pl.name) return;
                    var n = String(pl.name);
                    if (n === base) { out.exact++; out.from.push('the game plugin list'); }
                    else if (baseName(n) === base) { out.byBase++; out.from.push('the game plugin list, as "' + n + '"'); }
                });
            }
            var man = $.manifest();
            if (man) {
                Object.keys(man.entries).forEach(function (n) {
                    if (n === base) out.from.push('the mod manifest');
                });
            }
            return out;
        }, 'names for ' + base, { exact: 0, byBase: 0, from: [] });
    }

    /** Is the name registered with the engine's plugin manager at all? */
    function registered(base) {
        return $.safe(function () {
            if (typeof PluginManager === 'undefined' || !PluginManager._scripts) return null;
            var s = PluginManager._scripts, i, n;
            for (i = 0; i < s.length; i++) {
                n = String(s[i]);
                // Both dedup keys: the full entry name and the basename.
                if (n === base || n === base + '.js' || baseName(n) === base) return true;
            }
            return false;
        }, 'registered ' + base, null);
    }

    /**
     * Why did a module that should exist not run? The answer is almost always
     * one of three, and none of them raises anything on its own.
     */
    function claimedBy(base) {
        return $.safe(function () {
            var names = namesFor(base);
            var reg = registered(base);
            var claims = names.exact + names.byBase;

            if (claims > 1) {
                return 'the name is claimed ' + claims + ' times (' + names.from.join('; ') +
                    ') — the plugin manager keeps one flat list of names for the whole game and drops ' +
                    'every claim after the first, silently';
            }
            if (reg === false) {
                return claims
                    ? 'named once but never registered — the entry was not set up'
                    : 'no plugin entry names it — the engine was never asked to load it';
            }
            if (reg === true) {
                // The engine DID request this file and it never executed.
                return 'requested; never executed';
            }
            return null;   // no plugin manager to ask
        }, 'claim check ' + base, null);
    }

    /** How the game's own plugin list describes it, if at all. */
    function listedAs(base) {
        return $.safe(function () {
            var found = null;
            if (typeof $plugins !== 'undefined' && Array.isArray($plugins)) {
                $plugins.forEach(function (pl) {
                    if (!pl || !pl.name) return;
                    if (String(pl.name) !== base && baseName(pl.name) !== base) return;
                    found = (pl.status === false) ? 'disabled' : 'enabled';
                });
            }
            if (found === null && registered(base) === true) found = 'enabled';
            return found;
        }, 'listed ' + base, null);
    }

    /**
     * Every module this version ships, and whether it actually ran.
     *
     * Four independent yes/no questions per row — named, present, readable,
     * ran — because "it is not there" collapses four different failures into
     * one symptom, and they have nothing in common but the symptom.
     */
    $.moduleReport = function () {
        var man = $.manifest();
        var out = {
            layout: $.paths.layout,
            pluginsDir: $.paths.pluginsDir,
            manifest: man,
            metaVersion: man ? man.version : null,
            rows: [], expected: [], ran: [], missing: [], absent: [], disabled: [], unknown: []
        };

        MODULES.forEach(function (m) {
            var manStatus = man ? (man.entries.hasOwnProperty(m.name) ? man.entries[m.name] : null) : null;
            var row = {
                name: m.name,
                marker: m.marker,
                listed: listedAs(m.name),
                manifest: manStatus,
                file: fileOnDisk(m.name),
                readable: fileReadable(m.name),
                ran: markerPresent(m.marker),
                claimed: null
            };
            if (row.readable === false) row.mode = fileMode(m.name);
            out.rows.push(row);
            out.expected.push(m.name);

            if (row.ran) { out.ran.push(m.name); return; }
            if (manStatus === false) { out.disabled.push(m.name); return; }
            // Not installed at all is an install variant, not a fault: shout
            // only about a module the game was asked for or that is sitting
            // right there on disk. An inert alarm is worse than none.
            if (row.file !== true && row.listed === null && manStatus === null) {
                out.absent.push(m.name);
                return;
            }
            row.claimed = claimedBy(m.name);
            out.missing.push(m.name);
        });

        // The other direction: a GigaHack_*.js in the plugins folder that this
        // version does not know about. Usually a leftover from an older
        // install — a module that was deleted between versions still sits
        // there looking installed to anyone who lists the directory.
        out.unknown = $.safe(function () {
            var fs = $.env.fs, path = $.env.path;
            if (!fs || !path || !$.paths.pluginsDir) return [];
            var known = {};
            MODULES.forEach(function (m) { known[m.name] = true; });
            return fs.readdirSync($.paths.pluginsDir)
                .filter(function (f) { return /^GigaHack_.*\.js$/.test(f); })
                .map(function (f) { return f.replace(/\.js$/, ''); })
                .filter(function (n) { return !known[n]; });
        }, 'scan plugins folder', []);

        return out;
    };

    $.missingModules = function () { return $.moduleReport().missing; };

    /**
     * Leave the answer on disk.
     *
     * Diagnosing "a sub-tab is not there" from a screenshot costs several
     * round trips. This writes what was expected and what actually ran, every
     * launch, so the question is answered by reading one file instead of by
     * inference.
     */
    $.writeModuleManifest = function (stamp) {
        return $.safe(function () {
            var rep = $.moduleReport();
            rep.wrote = $.store.write('modules.json', {
                version: $.version,
                engine: $.caps.engine + ' ' + $.caps.engineVersion,
                at: stamp || new Date().toISOString(),
                paths: {
                    layout: $.paths.layout, pluginsDir: $.paths.pluginsDir,
                    gameRoot: $.paths.gameRoot, dataDir: $.paths.dataDir,
                    mode: $.paths.mode, fallbackUsed: !!$.paths.fallbackUsed
                },
                manifest: rep.manifest ? { file: rep.manifest.file, version: rep.manifest.version } : null,
                expected: rep.expected,
                ran: rep.ran,
                missing: rep.missing,
                absent: rep.absent,
                disabled: rep.disabled,
                unknown: rep.unknown,
                claimed: rep.rows.filter(function (r) { return r.claimed; })
                    .map(function (r) { return r.name + ' <- ' + r.claimed; }),
                scripts: $.safe(function () {
                    return (typeof PluginManager !== 'undefined' && PluginManager._scripts)
                        ? PluginManager._scripts.slice() : null;
                }, 'script list', null),
                panels: $.panelMap()
            }) === true;
            return rep;
        }, 'module manifest', null);
    };

    /**
     * Every panel currently registered, by tab.
     *
     * A module can run and still register nothing — the two failures look
     * identical from the outside ("the sub-tab is not there") and have nothing
     * in common, so the report states them separately.
     */
    $.panelMap = function () {
        return $.safe(function () {
            var out = {};
            if (!$.ui || !$.ui.panelNames || !$.ui.tabIds) return out;
            $.ui.tabIds().forEach(function (id) { out[id] = $.ui.panelNames(id); });
            return out;
        }, 'panel map', {});
    };

    /**
     * The whole diagnosis as plain text, ready to paste.
     *
     * Reading it off a screenshot is lossy and reading it off disk needs the
     * file to be writable, which is one of the things in question. A block of
     * text a button can copy needs neither.
     */
    $.report = function () {
        var rep = $.moduleReport();
        var L = [];
        L.push($.codename + ' ' + $.version + '   engine ' + $.caps.engine + ' ' + $.caps.engineVersion);
        L.push('layout      : ' + ($.paths.layout || 'unknown'));
        L.push('plugins dir : ' + ($.paths.pluginsDir || '—'));
        L.push('data dir    : ' + ($.paths.dataDir || '—') + '   mode=' + $.paths.mode +
            ($.paths.fallbackUsed ? '  (fell back — the preferred directory was not writable)' : ''));
        if (rep.manifest) {
            L.push('mod manifest: ' + rep.manifest.file +
                (rep.manifest.version ? '  (version ' + rep.manifest.version + ')' : ''));
        }
        L.push('');
        L.push('module                     listed     file        ran   state');
        rep.rows.forEach(function (r) {
            L.push(pad(r.name, 26) + ' ' +
                pad(r.listed || (r.manifest === false ? 'off (mod)' : '—'), 10) + ' ' +
                pad(r.file === null ? '?'
                    : !r.file ? 'MISSING'
                        : r.readable === false ? 'UNREADABLE' : 'present', 11) + ' ' +
                pad(r.ran ? 'yes' : 'NO', 5) + ' ' +
                (r.readable === false ? 'not readable — mode ' + (r.mode || '?')
                    : r.manifest === false ? 'disabled in the mod manifest'
                        : (r.claimed || '')));
        });
        if (rep.unknown.length) {
            L.push('', 'in the plugins folder but not part of this version: ' + rep.unknown.join(', '));
        }
        var pm = $.panelMap();
        L.push('');
        Object.keys(pm).forEach(function (id) { L.push(pad(id, 10) + ' ' + pm[id].join(', ')); });
        L.push('');
        L.push('pause: ' + $.pause.describe());
        return L.join('\n');
    };

    function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

    /**
     * Load a module the engine did not.
     *
     * Two different failures land here and neither leaves a trace of its own:
     *
     *   · the plugin manager skips a plugin whose name is already registered
     *     — one flat namespace shared by the game's own plugin list and every
     *     mod, and a second claim on a name is dropped without a fetch;
     *   · the fetch itself fails. A packaged build serves the app from an
     *     origin whose restrictions the mod cannot see from inside, and a
     *     script the renderer cannot read there fails into the plugin
     *     manager's error list — which is inspected exactly once, during
     *     SceneManager.initialize(), long before any of these files is
     *     requested. Nothing checks it again.
     *
     * So this does not ask the renderer for the file. It reads the bytes with
     * fs and runs them here. Three ways, cheapest first, because which of them
     * the host permits is not knowable from inside:
     *
     *   1. an inline script element, which keeps a real stack trace via
     *      sourceURL
     *   2. eval, if inline script is refused
     *   3. a script src, in case fs is the thing that is unavailable
     *
     * Deliberately narrow: only modules this version expects, only ones whose
     * file is really on disk, only ones that did not already run. It cannot
     * load anything that was not going to be loaded anyway.
     */
    function sourceOf(base) {
        return $.safe(function () {
            var fs = $.env.fs, file = pluginFile(base);
            if (!fs || !file || !fs.existsSync(file)) return null;
            var src = fs.readFileSync(file, 'utf8');
            return src && src.length ? src : null;
        }, 'read ' + base, null);
    }

    function markerOf(base) {
        for (var i = 0; i < MODULES.length; i++) if (MODULES[i].name === base) return MODULES[i].marker;
        return null;
    }
    function ran(base) { var m = markerOf(base); return m ? markerPresent(m) : false; }

    function runInline(base, src) {
        return $.safe(function () {
            var sc = document.createElement('script');
            sc.type = 'text/javascript';
            // sourceURL keeps this file's name on any stack trace it throws,
            // instead of reporting every line as coming from this one.
            sc.textContent = src + '\n//# sourceURL=gigahack/' + base + '.js';
            document.body.appendChild(sc);
            return ran(base);
        }, 'inline ' + base, false);
    }

    function runEval(base, src) {
        return $.safe(function () {
            // Indirect eval: global scope, so the module's own IIFE sees
            // window the way it would if the engine had loaded it.
            (0, eval)(src + '\n//# sourceURL=gigahack/' + base + '.js');
            return ran(base);
        }, 'eval ' + base, false);
    }

    function runFetched(base) {
        return $.safe(function () {
            var self = $.paths.selfUrl || '';
            if (!self) return false;
            var sc = document.createElement('script');
            sc.type = 'text/javascript';
            sc.async = false;
            // Built from this script's own URL, so it is right on every
            // layout and wherever the game is installed.
            sc.src = self.replace(/[^/]+$/, base + '.js');
            sc.onload = function () {
                $.log(ran(base) ? 'ok' : 'err', ran(base)
                    ? 'loaded ' + base + ' over the network after all'
                    : base + ' fetched and still registered nothing');
                if (ran(base) && $.ui && $.ui.rerender) $.safe(function () { $.ui.rerender(); }, 'rerender');
                $.writeModuleManifest();
            };
            sc.onerror = function () {
                $.log('err', 'could not fetch ' + base + ' from ' + sc.src +
                    ' — the renderer cannot read it at that origin');
                $.writeModuleManifest();
            };
            document.body.appendChild(sc);
            return false;                        // asynchronous; not a result yet
        }, 'fetch ' + base, false);
    }

    /** The command that fixes an unreadable plugin file, on this install. */
    $.repairCommand = function () {
        var dir = $.paths.pluginsDir;
        return 'chmod 644 ' + (dir ? dir + '/GigaHack_*.js' : 'GigaHack_*.js in the plugins folder');
    };

    $.recoverMissing = function () {
        return $.safe(function () {
            var rep = $.moduleReport();
            if (!rep.missing.length) return [];
            if (typeof document === 'undefined' || !document.body) return [];

            var won = [];
            rep.rows.forEach(function (row) {
                if (rep.missing.indexOf(row.name) < 0) return;
                if (row.file !== true) return;               // nothing there to load
                // No amount of retrying reads a file this process is not
                // allowed to read. Say what would fix it instead of failing
                // three ways and reporting the last one.
                if (row.readable === false) {
                    $.log('err', row.name + ' is on disk but this process cannot read it (mode ' +
                        (row.mode || '?') + '). Fix it with:  ' + $.repairCommand());
                    return;
                }
                var src = sourceOf(row.name);
                if (!src) { runFetched(row.name); return; }  // no fs — try the network

                var how = runInline(row.name, src) ? 'inline'
                    : runEval(row.name, src) ? 'eval'
                        : null;
                if (how) {
                    won.push(row.name);
                    $.log('ok', 'loaded ' + row.name + ' from disk (' + how +
                        ') — the engine never ran it');
                } else {
                    $.log('err', row.name + ' was read from disk and still registered nothing');
                    runFetched(row.name);
                }
            });

            if (won.length) {
                if ($.ui && $.ui.rerender) $.safe(function () { $.ui.rerender(); }, 'rerender');
                $.writeModuleManifest();
            }
            return won;
        }, 'recover missing modules', []);
    };

    $.selfCheck = function () {
        $.writeModuleManifest();
        var rep = $.moduleReport();

        if (rep.unknown.length) {
            $.log('warn', 'in the plugins folder but not part of ' + $.codename + ' ' + $.version + ': ' +
                rep.unknown.join(', ') + '. Left over from an older install — nothing loads them, and ' +
                'deleting them is safe.');
        }
        if (rep.absent.length) {
            $.log('info', 'not installed: ' + rep.absent.join(', ') +
                ' — no file, and nothing asks for them. Those features are simply not present.');
        }

        var missing = rep.missing;
        if (!missing.length) return missing;

        var locked = rep.rows.filter(function (r) {
            return missing.indexOf(r.name) > -1 && r.readable === false;
        }).map(function (r) { return r.name + ' (mode ' + (r.mode || '?') + ')'; });
        var claimed = rep.rows.filter(function (r) {
            return missing.indexOf(r.name) > -1 && r.claimed;
        }).map(function (r) { return r.name + ' (' + r.claimed + ')'; });

        $.log('err', 'these modules should have loaded and did not: ' + missing.join(', ') +
            (locked.length ? ' — on disk but not readable by this process: ' + locked.join(', ') +
                '. Fix it with: ' + $.repairCommand() : '') +
            (!locked.length && claimed.length ? ' — ' + claimed.join('; ') : '') +
            '. Debug → Plugins lists them.');

        // Try to fix it rather than only to report it. Anything recovered here
        // registers its panels on load, so the tab appears without a restart.
        var recovered = $.recoverMissing();

        // Only shout about what recovery cannot help with. A module that is
        // being loaded a beat later is not worth a red box.
        var hopeless = missing.filter(function (n) { return recovered.indexOf(n) < 0; });
        if (hopeless.length && $.ui && $.ui.toast) {
            $.ui.toast({
                title: 'MODULE MISSING', severity: 'err',
                msg: hopeless.length + ' module(s) did not load: ' + hopeless.join(', ')
            });
        }
        return missing;
    };

    $.log('info', 'hooks: ' + $.hookList().filter(function (x) { return x.installed; }).length +
        ' installed, ' + $.hookList().filter(function (x) { return !x.installed; }).length + ' skipped');
    $.log($.pause.available() ? 'info' : 'warn', 'pause: ' + $.pause.describe());

})(window.GigaHack);
