//=============================================================================
// GigaHack MV/MZ
// 01 · caps.js — engine detection, capability table, and the engine adapter
//-----------------------------------------------------------------------------
// Two things live here, and the distinction matters:
//
//   $.caps — FACTS. Booleans and small values probed once at load. A panel
//            asks "can I do this here?" and gets a yes or no with a name.
//
//   $.eng  — ADAPTERS. Thin functions that do the same job on both engines.
//            A panel that wants the save file path calls $.eng.savePath(3)
//            and never learns which engine it is on.
//
// The rule the whole mod follows: **ask a capability, never a version.**
// Utils.RPGMAKER_VERSION is recorded for the boot report and for the index
// fingerprint, and is not branched on anywhere. Version strings are a proxy
// for capabilities and they are wrong the moment a plugin adds or removes
// one — which, on a modded game, is most of the time.
//
// When a capability is missing, the mod's job is to SAY WHAT IS MISSING.
// Every entry carries a `why` string for exactly that.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — engine capability table
 * @author gigahack
 * @help GigaHack_Caps.js — requires Core
 */

(function ($) {
    'use strict';
    if (!$) { console.error('[GigaHack] core missing — caps not installed'); return; }

    var C = $.caps = {};
    var E = $.eng = {};

    /* =====================================================================
       1. Engine identity
       ===================================================================== */
    /* `typeof Utils === 'object'` is WRONG and cost a real diagnosis.
       Both engines declare Utils as `function Utils() { throw ... }` — a
       static class expressed as a constructor that refuses construction — so
       typeof is 'function', not 'object'. The test silently failed on every
       real game, the engine name fell through to the class-surface guess
       (which happens to be right) and the VERSION, which has no fallback,
       reported "unknown" for ever. Test for usability, not for a type name. */
    function utils() {
        return (typeof Utils !== 'undefined' && Utils) ? Utils : null;
    }
    C._utils = utils;

    C.engine = $.safe(function () {
        var U = utils();
        if (U && U.RPGMAKER_NAME) return String(U.RPGMAKER_NAME);
        // No Utils at all means we are in a harness or a very unusual build.
        // Guess from the class surface rather than refusing to run.
        if (typeof ColorManager !== 'undefined') return 'MZ';
        if (typeof Window_Base !== 'undefined' && Window_Base.prototype.standardFontFace) return 'MV';
        return 'unknown';
    }, 'engine name', 'unknown');

    C.engineVersion = $.safe(function () {
        var U = utils();
        return (U && U.RPGMAKER_VERSION) ? String(U.RPGMAKER_VERSION) : 'unknown';
    }, 'engine version', 'unknown');

    C.isMV = C.engine === 'MV';
    C.isMZ = C.engine === 'MZ';

    /* =====================================================================
       2. Class and method probes
       Each is `{ ok: bool, why: string }` when the answer needs explaining,
       and a bare boolean when "missing" is self-explanatory from the name.
       ===================================================================== */
    function has(path) {
        return $.safe(function () {
            var parts = path.split('.'), o = window, i;
            for (i = 0; i < parts.length; i++) {
                if (o === undefined || o === null) return false;
                o = o[parts[i]];
            }
            return o !== undefined && o !== null;
        }, 'probe ' + path, false);
    }
    function hasFn(path) {
        return $.safe(function () {
            var parts = path.split('.'), o = window, i;
            for (i = 0; i < parts.length; i++) {
                if (o === undefined || o === null) return false;
                o = o[parts[i]];
            }
            return typeof o === 'function';
        }, 'probe ' + path, false);
    }
    C._has = has;
    C._hasFn = hasFn;

    /* --- managers and classes ------------------------------------------ */
    C.colorManager    = has('ColorManager');
    C.spriteGauge     = has('Sprite_Gauge');
    C.spriteName      = has('Sprite_Name');
    C.registerCommand = hasFn('PluginManager.registerCommand');
    C.effekseer       = has('Graphics.effekseer');
    C.pixiApp         = has('Graphics.app');

    /* --- rendering ------------------------------------------------------ */
    C.pixiVersion = $.safe(function () {
        return (typeof PIXI !== 'undefined' && PIXI.VERSION) ? String(PIXI.VERSION) : 'unknown';
    }, 'pixi version', 'unknown');
    C.pixiMajor = $.safe(function () {
        var m = /^(\d+)/.exec(C.pixiVersion);
        return m ? parseInt(m[1], 10) : 0;
    }, 'pixi major', 0);

    /* MZ names its canvas "gameCanvas"; MV names it "GameCanvas". Any code
       that falls back to getElementById must use the right one or it silently
       finds nothing and reports the overlay as unattached. */
    C.canvasId = C.isMV ? 'GameCanvas' : 'gameCanvas';

    /* --- the fatal one --------------------------------------------------
       MV's SceneManager.updateMain ends with renderScene() and requestUpdate().
       The rAF chain perpetuates itself from INSIDE updateMain, so:
         · returning early from a wrapper terminates the loop permanently —
           the game hard-hangs and cannot be un-paused;
         · calling the original N times schedules N rAF callbacks, each of
           which schedules N more — exponential runaway.
       MZ drives the loop from PIXI's ticker instead, and updateMain is a
       plain "do one logical step" function that is safe to skip or repeat.

       Nothing in this mod may wrap updateMain unless this capability is true.
       Pause and game-speed use the per-step hooks below instead.
       ------------------------------------------------------------------ */
    C.updateMainIsReentrant = C.isMZ && hasFn('SceneManager.updateMain');
    C.updateMainWhy = C.updateMainIsReentrant
        ? ''
        : 'on MV, SceneManager.updateMain drives its own requestAnimationFrame and renders inside itself; ' +
          'skipping or repeating it hangs the game. Pause and speed hook the per-step functions instead.';

    /* The per-step functions that ARE safe to gate on both engines. */
    C.stepHooks = hasFn('SceneManager.updateScene') && hasFn('SceneManager.changeScene') &&
                  hasFn('SceneManager.updateInputData');

    /* --- save/load ------------------------------------------------------ */
    C.saveIsAsync      = C.isMZ;              // MZ returns a Promise, MV a boolean
    C.saveExt          = C.isMV ? '.rpgsave' : '.rmmzsave';
    C.savefileIdOnSystem = hasFn('Game_System.prototype.setSavefileId');   // MZ only
    C.globalInfoSync   = C.isMV;              // MV's loadGlobalInfo() returns the array
    C.savefileEnabled  = hasFn('Scene_File.prototype.isSavefileEnabled');  // MZ only

    /* --- text / colour -------------------------------------------------- */
    C.mainFontOnSystem = hasFn('Game_System.prototype.mainFontFace');      // MZ only
    C.standardFontOnWindow = hasFn('Window_Base.prototype.standardFontFace'); // MV only
    C.drawGauge        = hasFn('Window_Base.prototype.drawGauge');         // MV only

    /* --- window internals ----------------------------------------------- */
    C.innerChildren    = C.isMZ;              // MZ windows have _innerChildren/_clientArea
    C.contentsSpriteKey = C.isMV ? '_windowContentsSprite' : '_contentsSprite';

    /* --- map ------------------------------------------------------------ */
    /* MV exposes tileEvents publicly; MZ made it _tileEvents. Reading the
       wrong one throws inside the map probe. */
    C.tileEventsKey = C.isMV ? 'tileEvents' : '_tileEvents';

    /* --- host ----------------------------------------------------------- */
    C.nwjs = !!$.env.nwjs;
    C.fs   = !!$.env.fs;
    C.fsWhy = C.fs ? '' : 'no Node filesystem — this is a browser or web-deployed build; ' +
                          'anything that reads the game folder is unavailable here.';

    C.idleCallback = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function';

    /* --- CSS floor ------------------------------------------------------
       MV 1.6 ships NW.js 0.29 = Chromium 66. Older MV is worse. The overlay
       stylesheet is written to that floor, but probing is still worth doing:
       it turns "the menu looks wrong" into a named, reported fact. */
    C.cssGap = $.safe(function () {
        if (typeof CSS === 'undefined' || !CSS.supports) return false;
        return CSS.supports('gap', '1px') || CSS.supports('grid-gap', '1px');
    }, 'css gap probe', false);

    C.cssClamp = $.safe(function () {
        if (typeof CSS === 'undefined' || !CSS.supports) return false;
        return CSS.supports('width', 'clamp(1px, 2px, 3px)');
    }, 'css clamp probe', false);

    C.cssFocusWithin = $.safe(function () {
        if (typeof CSS === 'undefined' || !CSS.supports) return false;
        return CSS.supports('selector(:focus-within)');
    }, 'css focus-within probe', false);

    C.chromeVersion = $.safe(function () {
        var m = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent || '');
        return m ? parseInt(m[1], 10) : 0;
    }, 'chrome version', 0);

    /* MV zeroes every positive inline z-index in the document during
       Graphics.initialize (Graphics._modifyExistingElements). An overlay
       created before boot is flattened behind the canvas with no error.
       We always mount after boot, but the shell re-asserts z-index anyway
       and this flag is what tells it to. */
    C.zIndexClobber = C.isMV;

    /* MV calls Graphics._disableTextSelection, which sets user-select:none on
       the document body. Overlay text is not selectable unless we opt back in. */
    C.textSelectionBlocked = C.isMV;

    /* =====================================================================
       3. The engine adapter — $.eng
       Everything below works identically on both engines. Where an engine
       genuinely cannot do a thing, the adapter returns null/false rather
       than throwing, and the caller reports the matching `why`.
       ===================================================================== */

    /* --- colour --------------------------------------------------------- */
    E.normalColor = function () {
        return $.safe(function () {
            if (C.colorManager && ColorManager.normalColor) return ColorManager.normalColor();
            if (typeof Window_Base !== 'undefined' && Window_Base.prototype.normalColor) {
                // MV colour accessors are per-window and read this.windowskin.
                // Borrow any live window; fall back to white when none exists.
                var w = E.anyWindow();
                if (w) return Window_Base.prototype.normalColor.call(w);
            }
            return '#ffffff';
        }, 'eng.normalColor', '#ffffff');
    };

    /* The single best hook point for "override the normal text colour".
       MZ: ColorManager.normalColor. MV: Window_Base.prototype.normalColor,
       which resetTextColor() calls, so it reaches every stock window. */
    E.normalColorTarget = function () {
        if (C.colorManager) return { owner: ColorManager, method: 'normalColor', label: 'ColorManager.normalColor' };
        if (typeof Window_Base !== 'undefined' && Window_Base.prototype.normalColor) {
            return { owner: Window_Base.prototype, method: 'normalColor', label: 'Window_Base.normalColor' };
        }
        return null;
    };

    E.anyWindow = function () {
        return $.safe(function () {
            var s = (typeof SceneManager !== 'undefined') ? SceneManager._scene : null;
            if (!s || !s.children) return null;
            var found = null;
            (function walk(node, depth) {
                if (found || !node || depth > 4) return;
                var kids = node.children || [];
                for (var i = 0; i < kids.length; i++) {
                    if (found) return;
                    if (kids[i] && kids[i]._isWindow && kids[i].windowskin !== undefined) { found = kids[i]; return; }
                    walk(kids[i], depth + 1);
                }
            })(s, 0);
            return found;
        }, 'eng.anyWindow', null);
    };

    /* --- fonts ---------------------------------------------------------- */
    E.fontTarget = function () {
        if (C.mainFontOnSystem) {
            return {
                face: { owner: Game_System.prototype, method: 'mainFontFace', label: 'Game_System.mainFontFace' },
                size: { owner: Game_System.prototype, method: 'mainFontSize', label: 'Game_System.mainFontSize' }
            };
        }
        if (C.standardFontOnWindow) {
            return {
                face: { owner: Window_Base.prototype, method: 'standardFontFace', label: 'Window_Base.standardFontFace' },
                size: { owner: Window_Base.prototype, method: 'standardFontSize', label: 'Window_Base.standardFontSize' }
            };
        }
        return null;
    };

    /* --- icons ---------------------------------------------------------- */
    E.iconWidth = function () {
        return $.safe(function () {
            if (typeof ImageManager !== 'undefined' && ImageManager.iconWidth) return ImageManager.iconWidth;
            if (typeof Window_Base !== 'undefined' && Window_Base._iconWidth) return Window_Base._iconWidth;
            return 32;
        }, 'eng.iconWidth', 32);
    };
    E.iconHeight = function () {
        return $.safe(function () {
            if (typeof ImageManager !== 'undefined' && ImageManager.iconHeight) return ImageManager.iconHeight;
            if (typeof Window_Base !== 'undefined' && Window_Base._iconHeight) return Window_Base._iconHeight;
            return 32;
        }, 'eng.iconHeight', 32);
    };

    /* --- save paths -----------------------------------------------------
       Always resolved through StorageManager at call time, never cached and
       never built by hand. Plugins relocate save directories on both engines
       (A New Dawn's save.js redirects to nw.gui.App.dataPath), and a mod that
       hardcodes <gameRoot>/save quietly backs up nothing at all.
       ------------------------------------------------------------------ */
    E.saveDir = function () {
        return $.safe(function () {
            if (typeof StorageManager === 'undefined') return null;
            if (typeof StorageManager.fileDirectoryPath === 'function') return StorageManager.fileDirectoryPath();
            if (typeof StorageManager.localFileDirectoryPath === 'function') return StorageManager.localFileDirectoryPath();
            return null;
        }, 'eng.saveDir', null);
    };

    /* savePath(id): id < 0 is config, 0 is global, >0 is a save slot.
       MV's localFilePath takes the numeric id and does the naming itself;
       MZ splits it into makeSavename(id) + filePath(name). */
    E.savePath = function (id) {
        return $.safe(function () {
            if (typeof StorageManager === 'undefined') return null;
            if (typeof StorageManager.localFilePath === 'function') {
                return StorageManager.localFilePath(id);
            }
            if (typeof StorageManager.filePath === 'function') {
                var name;
                if (id < 0) name = 'config';
                else if (id === 0) name = 'global';
                else if (typeof DataManager !== 'undefined' && DataManager.makeSavename) name = DataManager.makeSavename(id);
                else name = 'file' + id;
                return StorageManager.filePath(name);
            }
            return null;
        }, 'eng.savePath', null);
    };

    /* --- save file info -------------------------------------------------
       MZ caches the global info on DataManager._globalInfo and reads it
       synchronously via savefileInfo(). MV's loadSavefileInfo() re-reads and
       LZString-decompresses the whole global file on EVERY call, so a panel
       that lists 20 slots would do 20 decompressions per repaint. Cache it
       per frame and let the caller invalidate.
       ------------------------------------------------------------------ */
    var infoCache = null, infoCacheStamp = -1;

    E.invalidateSaveInfo = function () { infoCache = null; infoCacheStamp = -1; };

    E.savefileInfo = function (id) {
        return $.safe(function () {
            if (typeof DataManager === 'undefined') return null;
            if (typeof DataManager.savefileInfo === 'function') return DataManager.savefileInfo(id);
            if (typeof DataManager.loadSavefileInfo === 'function') {
                var now = (typeof Graphics !== 'undefined' && Graphics.frameCount) || 0;
                if (infoCache === null || now !== infoCacheStamp) {
                    infoCache = (typeof DataManager.loadGlobalInfo === 'function') ? DataManager.loadGlobalInfo() : null;
                    infoCacheStamp = now;
                }
                return (infoCache && infoCache[id]) ? infoCache[id] : null;
            }
            return null;
        }, 'eng.savefileInfo', null);
    };

    /* Read-modify-write of the global info. Only MV can really do this;
       on MZ the cached _globalInfo is written back by saveGlobalInfo(). */
    E.updateGlobalInfo = function (mutate) {
        return $.safe(function () {
            if (typeof DataManager === 'undefined') return false;
            if (C.globalInfoSync && typeof DataManager.loadGlobalInfo === 'function') {
                var gi = DataManager.loadGlobalInfo() || [];
                mutate(gi);
                if (typeof DataManager.saveGlobalInfo === 'function') DataManager.saveGlobalInfo(gi);
                E.invalidateSaveInfo();
                return true;
            }
            if (DataManager._globalInfo) {
                mutate(DataManager._globalInfo);
                if (typeof DataManager.saveGlobalInfo === 'function') DataManager.saveGlobalInfo();
                E.invalidateSaveInfo();
                return true;
            }
            return false;
        }, 'eng.updateGlobalInfo', false);
    };

    /* --- save / load ----------------------------------------------------
       Normalises MZ's Promise and MV's boolean into one callback shape:
         E.saveGame(id, function (ok, err) { ... })
       The callback always runs exactly once, on both engines, including when
       the engine threw. MV returning `false` is a FAILURE and is reported as
       one — the pre-2.0 code treated any non-throw as success.
       ------------------------------------------------------------------ */
    E.markSavefileId = function (id) {
        return $.safe(function () {
            if (C.savefileIdOnSystem && typeof $gameSystem !== 'undefined' && $gameSystem) {
                $gameSystem.setSavefileId(id);
                return true;
            }
            // MV has no per-session savefile id on Game_System. saveGameWithoutRescue
            // sets DataManager._lastAccessedId itself, so there is nothing to do —
            // and, crucially, nothing to throw.
            return false;
        }, 'eng.markSavefileId', false);
    };

    E.saveGame = function (id, done) {
        var called = false, pending = false;
        function finish(ok, err) {
            if (called) return;
            called = true;
            $.safe(function () { done(ok, err || null); }, 'eng.saveGame callback');
        }
        $.safe(function () {
            if (typeof DataManager === 'undefined' || typeof DataManager.saveGame !== 'function') {
                finish(false, 'DataManager.saveGame is not available');
                return;
            }
            var r = DataManager.saveGame(id);
            if (r && typeof r.then === 'function') {
                // The answer arrives on a later turn. `pending` says a callback
                // is ARRANGED but not yet delivered, so the safety net below
                // does not pre-empt it with a failure the engine never
                // reported — which would report every asynchronous save as a
                // failure and then swallow the real result.
                pending = true;
                r.then(function () { finish(true, null); },
                       function (e) { finish(false, (e && e.message) || String(e)); });
            } else {
                // Synchronous boolean: false means the write failed.
                finish(r !== false, r === false ? 'the engine reported the save failed' : null);
            }
        }, 'eng.saveGame', null);
        // The body threw before it either delivered a callback or arranged
        // one, and we still owe exactly one.
        if (!called && !pending) finish(false, 'DataManager.saveGame threw');
    };

    E.loadGame = function (id, done) {
        var called = false, pending = false;
        function finish(ok, err) {
            if (called) return;
            called = true;
            $.safe(function () { done(ok, err || null); }, 'eng.loadGame callback');
        }
        $.safe(function () {
            if (typeof DataManager === 'undefined' || typeof DataManager.loadGame !== 'function') {
                finish(false, 'DataManager.loadGame is not available');
                return;
            }
            var r = DataManager.loadGame(id);
            if (r && typeof r.then === 'function') {
                // See saveGame: a pre-empted failure here would be far worse,
                // because the caller's failure path puts the pre-load globals
                // back — and the load would then land on top of them a turn
                // later with none of the scene work done.
                pending = true;
                r.then(function () { finish(true, null); },
                       function (e) { finish(false, (e && e.message) || String(e)); });
            } else {
                finish(r !== false, r === false ? 'the engine reported the load failed' : null);
            }
        }, 'eng.loadGame', null);
        if (!called && !pending) finish(false, 'DataManager.loadGame threw');
    };

    /* --- map ------------------------------------------------------------ */
    E.tileEvents = function () {
        return $.safe(function () {
            if (typeof $gameMap === 'undefined' || !$gameMap) return [];
            var v = $gameMap[C.tileEventsKey];
            if (v) return v;
            // Belt and braces: a plugin may have renamed it back.
            return $gameMap._tileEvents || $gameMap.tileEvents || [];
        }, 'eng.tileEvents', []);
    };

    /* --- window internals ----------------------------------------------- */
    E.contentsSprite = function (win) {
        if (!win) return null;
        return win[C.contentsSpriteKey] || win._contentsSprite || win._windowContentsSprite || null;
    };

    /* MZ distinguishes a window's own furniture from content added by a
       plugin via _innerChildren. MV has no such split — every child of an MV
       window is furniture — so the question answers itself. */
    E.isWindowFurniture = function (win, child) {
        if (!C.innerChildren) return true;
        return $.safe(function () {
            var inner = win && win._innerChildren;
            return !inner || inner.indexOf(child) < 0;
        }, 'eng.isWindowFurniture', true);
    };

    /* --- fps ------------------------------------------------------------ */
    E.fps = function () {
        return $.safe(function () {
            if (typeof Graphics === 'undefined') return null;
            if (Graphics._fpsCounter && typeof Graphics._fpsCounter.fps === 'number') return Graphics._fpsCounter.fps;
            if (Graphics._fpsMeter && typeof Graphics._fpsMeter.fps === 'number') return Graphics._fpsMeter.fps;
            return null;
        }, 'eng.fps', null);
    };

    /* =====================================================================
       4. The boot report
       Rendered in Debug → Environment and written to the log at boot. This is
       the artefact that turns "it doesn't work on my game" into a paste.
       ===================================================================== */
    C.report = function () {
        var rows = [
            ['engine', C.engine + ' ' + C.engineVersion],
            ['renderer', 'PIXI ' + C.pixiVersion + (C.pixiMajor ? ' (v' + C.pixiMajor + ')' : '')],
            ['chromium', C.chromeVersion || 'unknown'],
            ['host', C.nwjs ? 'NW.js' : 'browser'],
            ['filesystem', C.fs ? 'available' : 'unavailable — ' + C.fsWhy],
            ['canvas id', C.canvasId],
            ['ColorManager', C.colorManager ? 'yes' : 'no — MV draws colours per window'],
            ['Sprite_Gauge', C.spriteGauge ? 'yes' : 'no — MV draws gauges into window contents'],
            ['plugin commands', C.registerCommand ? 'yes' : 'no — MV uses pluginCommand'],
            ['save format', C.saveExt + (C.saveIsAsync ? ' (async)' : ' (sync)')],
            ['save dir', E.saveDir() || 'unresolved'],
            ['updateMain', C.updateMainIsReentrant ? 'safe to gate' : 'self-driving — ' + C.updateMainWhy],
            ['CSS gap', C.cssGap ? 'yes' : 'no — layout uses margins'],
            ['CSS clamp()', C.cssClamp ? 'yes' : 'no — layout uses fixed sizes'],
            ['requestIdleCallback', C.idleCallback ? 'yes' : 'no — indexing chunks on frames instead']
        ];
        return rows;
    };

    C.reportText = function () {
        return C.report().map(function (r) {
            return (r[0] + '                    ').slice(0, 20) + ': ' + r[1];
        }).join('\n');
    };

    /* =====================================================================
       5. Boot log
       ===================================================================== */
    $.log(C.engine === 'unknown' ? 'warn' : 'ok',
        'engine: ' + C.engine + ' ' + C.engineVersion + ', PIXI ' + C.pixiVersion +
        ', Chromium ' + (C.chromeVersion || '?'));

    if (C.engine === 'unknown') {
        $.log('warn', 'Utils.RPGMAKER_NAME was not readable — capabilities were probed directly. ' +
            'Everything below is best-effort.');
    }
    if (!C.updateMainIsReentrant) {
        $.log('info', 'pause and game speed will use the per-step hooks: ' + C.updateMainWhy);
    }
    if (!C.cssGap || !C.cssClamp) {
        $.log('info', 'browser floor: gap=' + (C.cssGap ? 'yes' : 'no') +
            ' clamp=' + (C.cssClamp ? 'yes' : 'no') + ' — the stylesheet is written to work without either.');
    }
    if (!C.fs) $.log('warn', C.fsWhy);

})(window.GigaHack);
