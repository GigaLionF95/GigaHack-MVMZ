//=============================================================================
// GigaHack MV/MZ
// 23 · save.js — save anywhere, quick save, quick load, transfer
//-----------------------------------------------------------------------------
// Five invariants shape this whole file. None of them is about a particular
// game or a particular engine version; each is a capability that is asked for.
//
//   1. SAVING IS NOT DataManager.saveGame's JOB ALONE. Marking the session's
//      savefile id and calling onBeforeSave() are the SCENE's work, and this
//      module exists precisely to save without reaching that scene. A save
//      made without them has a stale playtime, no BGM to restore, and the
//      wrong slot recorded. onAfterLoad() is the mirror image: the engine
//      calls it from the load scene's terminate(), i.e. AFTER the scene it
//      belongs to has been left, so loading outside that scene means calling
//      it here, in the same order.
//
//   2. THE WRITE ITSELF IS WHATEVER THE GAME HAS MADE IT. Replacing
//      DataManager.saveGame outright, with no alias kept, is a thing plugins
//      do — so it is called as found, at call time, and never cached, wrapped
//      or reimplemented.
//
//   3. THE TWO ENGINES DISAGREE ABOUT WHAT A SAVE RETURNS. One answers with a
//      promise, the other with a plain boolean where `false` is a genuine
//      write failure. Treating "it did not throw" as success reports SAVED for
//      a save that never happened, and treating "no promise" as failure skips
//      the entire post-load scene sequence while the globals have already been
//      swapped underneath a live scene. Both go through $.eng.saveGame /
//      $.eng.loadGame, which call back exactly once with (ok, err) on either
//      engine.
//
//   4. SOME OF THIS DOES NOT EXIST EVERYWHERE. A per-session savefile id on
//      Game_System, and a per-slot enable test on the save scene, are present
//      on one engine and absent on the other. Asking for the first directly
//      throws — inside a guarded block that also owns the write, that means
//      the write is never reached and the save silently does not happen. Both
//      go through the capability layer: $.eng.markSavefileId is a no-op where
//      the concept is missing, and $.caps.savefileEnabled decides whether
//      there is a slot restriction to lift at all.
//
//   5. THE SLOT INDEX IS EXPENSIVE ON ONE ENGINE. Reading one slot's entry is
//      a cached lookup on one and a full re-read plus decompression of the
//      whole index file on the other — and this panel asks about every slot on
//      every repaint. $.eng.savefileInfo caches per frame; every write here
//      invalidates it.
//
// A SAVE IS BYTES, NOT JSON WE UNDERSTAND. Export and import copy files
// verbatim. Plugins commonly extend DataManager.makeSaveContents, so a save
// carries sections this mod has never heard of; anything that parsed and
// re-serialised one would silently drop whichever of them it did not know
// about — and where a plugin has replaced the JSON encoder, a save cannot be
// parsed by plain JSON at all. The two engines do not even share an on-disk
// encoding. Bytes in, bytes out, no opinions.
//
// A ONE-SLOT / NO-RELOAD MODE IS A GAME'S OWN PLUGIN, never an engine feature,
// so everything about it lives behind $.profile.adapter('ironman'). With no
// adapter there is no column, no toggle, no hook and no readout — not a greyed
// control for something this game does not have.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — save anywhere, quick save/load, transfer
 * @author gigahack
 * @help GigaHack_Save.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Backup
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — save not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    var S = $.saveTools = {};

    /* =====================================================================
       PART 1 — MODEL
       ===================================================================== */
    function alive() {
        return typeof $gameSystem !== 'undefined' && !!$gameSystem &&
            typeof DataManager !== 'undefined' && typeof DataManager.saveGame === 'function';
    }
    S.alive = alive;

    S.maxSlots = function () {
        return $.safe(function () { return DataManager.maxSavefiles(); }, 'maxSavefiles', 20) || 20;
    };

    /**
     * Default to the last slot, so quick-saving never lands on a normal one.
     *
     * Worth knowing: the engines do not agree on how many of those slots their
     * own save menu lists. Both report the same maximum, but one reserves the
     * first id for an autosave and shows one fewer manual slot — so the last id
     * is a real, writable file that the game's own menu never displays. That is
     * mostly a feature for a quick-save slot, but it means a quick save there
     * is reachable only from this panel or the hotkey, never from the game.
     */
    S.quickSlot = function () {
        var v = Math.floor($.store.cfgGet('save.quickSlot', 0)) || 0;
        if (v >= 1 && v <= S.maxSlots()) return v;
        return S.maxSlots();
    };

    /**
     * True when the engine's own save menu will not list this slot.
     *
     * Asked as a capability, never as a version: an engine that has an
     * AUTOSAVE spends the first id on it and lists one fewer manual slot, so
     * the highest id falls off the end of its own list. An engine with no
     * autosave concept lists every id. The presence of the autosave test is
     * the direct signal for which of the two this is.
     */
    function hasAutosaveSlot() {
        return !!($.caps._hasFn && $.caps._hasFn('Game_System.prototype.isAutosaveEnabled'));
    }
    S.slotIsHidden = function (id) {
        return hasAutosaveSlot() && Math.floor(id) >= S.maxSlots();
    };

    /**
     * One slot's index entry.
     *
     * Through the adapter because the two engines disagree about both the name
     * and the COST: one reads a cached index, the other re-reads and
     * decompresses the whole index file on every single call. S.slots() below
     * asks about every slot on every repaint, so the adapter caches per frame
     * and every write in this file invalidates it.
     */
    S.info = function (id) {
        return $.eng.savefileInfo(id);
    };

    /**
     * Every slot, in menu order.
     *
     * The fields read here are the ones both engines write into the index.
     * `mark` is not one of them: it is whatever the game's own save mode has
     * stamped on the entry, asked for through the profile adapter, and absent
     * entirely when this game has no such mode.
     */
    S.slots = function () {
        var ad = ironman();
        var marks = (ad && typeof ad.marks === 'function') ? ad.marks : null;
        var out = [];
        for (var i = 1; i <= S.maxSlots(); i++) {
            var info = S.info(i);
            out.push({
                id: i,
                exists: !!info,
                title: info ? (info.title || '') : '',
                playtime: info ? (info.playtime || '') : '',
                timestamp: info ? (info.timestamp || 0) : 0,
                mark: marks ? !!$.safe(function () { return marks(info); }, 'slot mark', false) : false
            });
        }
        return out;
    };

    /* --------------------------------------------- has anything been saved
       The game writes slots on its own — an autosave, an event that calls save
       — and nothing tells this module when, so the slot table polls. What it
       polls MUST NOT be the index itself on an engine that has to fetch the
       index to answer.

       Asking every slot costs one array walk where the index is memory
       resident and a full re-read where it is not, because $.eng.savefileInfo
       caches per ENGINE FRAME and a 700ms wall clock lands on a new frame
       every single time. Every tick was therefore a cache miss and a
       DataManager.loadGlobalInfo(): the index file read and parsed, then an
       existence probe for every one of the twenty savefiles to prune it — a
       syscall per slot plus the index, on the render thread, eighty-six times
       a minute, for as long as the panel is open. None of it is visible on an
       engine that answers from memory, which is why it survived every test
       written against one.

       Three probes, cheapest first. Each is O(1) in the number of slots and
       each answers the same question — "could a row have changed" — so the
       shape of the answer never has to be interpreted, only compared.
       ------------------------------------------------------------------ */

    /* Asked as a capability, never as an engine name: an index that answers
       from memory is cheap to walk whoever put it there. */
    function indexInMemory() {
        return !!($.caps._hasFn && $.caps._hasFn('DataManager.savefileInfo'));
    }

    /**
     * The index file's mtime and size — an existence test and a stat, with no
     * read and no parse behind either.
     *
     * Tested rather than caught, because $.safe logs every throw and a game
     * with no saves yet would write a line about a missing file every 700ms
     * for as long as the panel stayed open.
     *
     * A file that is not there is an ANSWER ('none'), not a failure: no index
     * means no saves, and the first one written makes the file appear. null
     * means the question could not be put — no filesystem (a browser build,
     * where the index is in web storage and there are no syscalls to save), a
     * storage layer that resolves no path for it, or one that has a filesystem
     * and does not keep the index on it. That last one is why isLocalMode is
     * asked: a stat of a file the engine never writes would report "nothing
     * has changed" forever, which is the failure this whole probe exists to
     * avoid, dressed up as an optimisation.
     */
    function indexFileStamp() {
        return $.safe(function () {
            var f = $.env.fs, p = $.eng.savePath(0);
            if (!f || !p) return null;
            if (typeof StorageManager !== 'undefined' &&
                typeof StorageManager.isLocalMode === 'function' &&
                !StorageManager.isLocalMode()) return null;
            if (!f.existsSync(p)) return 'none';
            var st = f.statSync(p);
            return 'stat:' + st.mtimeMs + ':' + st.size;
        }, 'index file stamp', null);
    }

    /**
     * The raw index as the storage layer hands it over — one read instead of a
     * read plus a probe per savefile, and no prune.
     *
     * Only where that read is synchronous and really is text: the id-keyed
     * StorageManager.load belongs to the engine whose index is not memory
     * resident, and anything else (a plugin that made it return a Promise, or
     * an object) is not comparable, so it says so rather than freezing the
     * panel on `[object Promise]`.
     */
    function rawIndex() {
        return $.safe(function () {
            if (typeof StorageManager === 'undefined' ||
                typeof StorageManager.load !== 'function') return null;
            var raw = StorageManager.load(0);
            if (raw === null || raw === undefined) return 'raw:none';
            if (typeof raw !== 'string') return null;
            return 'raw:' + raw;
        }, 'raw save index', null);
    }

    /**
     * A cheap "have the files on disk moved" probe for the slot table.
     *
     * The value is opaque and only ever compared with the previous one. Every
     * branch below moves when the slot table's content could have moved, and
     * the one thing none of them sees is a save FILE deleted from outside the
     * running game: the index still names it, and the engine's own prune —
     * which is most of what the expensive path was paying for — does not write
     * the index back, so nothing on disk changes. The row goes on showing that
     * save until something writes the index. Reopening the panel re-reads
     * everything.
     */
    S.slotSignature = function () {
        if (!indexInMemory()) {
            var stamp = indexFileStamp();
            if (stamp !== null) return stamp;
            var raw = rawIndex();
            if (raw !== null) return raw;
            // Neither probe could answer. The walk below is the honest answer
            // and it is expensive; a panel is worth more than a saved read.
        }
        return $.safe(function () {
            var out = '';
            for (var i = 1; i <= S.maxSlots(); i++) {
                var info = S.info(i);
                out += (info ? (info.timestamp || 0) + ':' + (info.playtime || '') : '-') + '|';
            }
            return out;
        }, 'slot signature', '');
    };

    /**
     * One save or load at a time.
     *
     * Both are promise-driven, and `SceneManager.isSceneChanging()` — the only
     * thing that looked like a guard — does not go true until the load has
     * already resolved and called goto. Two quick-loads issued inside that
     * window both ran createGameObjects and extractSaveContents to completion,
     * and whichever file read finished last won, not the one you asked for.
     */
    var busy = null;
    S.busy = function () { return busy; };

    /**
     * The globals DataManager.loadGame replaces. It calls createGameObjects()
     * BEFORE extractSaveContents(), so a save that fails to extract leaves
     * every one of these blank while the current scene keeps running against
     * them — Spriteset_Map reads $dataTilesets[$gameMap.tileset()] on the next
     * frame and takes the game down. The engine has the same window, but only
     * ever opens it inside Scene_Load, where there is no live game to lose.
     */
    var GLOBALS = ['$gameTemp', '$gameSystem', '$gameScreen', '$gameTimer', '$gameMessage',
        '$gameSwitches', '$gameVariables', '$gameSelfSwitches', '$gameActors',
        '$gameParty', '$gameTroop', '$gameMap', '$gamePlayer'];

    function snapshotGlobals() {
        var snap = {};
        GLOBALS.forEach(function (n) { snap[n] = window[n]; });
        return snap;
    }
    function restoreGlobals(snap) {
        GLOBALS.forEach(function (n) { window[n] = snap[n]; });
    }

    /* ------------------------------------------------------------- ironman
       A game may ship its own one-slot / no-reload save mode. That is that
       game's plugin, not an engine feature, so nothing here reads its state
       directly. Everything goes through the profile adapter:

           $.profile.adapter('ironman')
               enabled()          is the mode on right now
               slot()             which slot it owns, or null
               relax(on)          suppress its next-load penalty
             optional:
               marks(info)        was this index entry written by that mode
               name()             what the game calls it

       adapter() returns null when the profile does not declare one, and every
       accessor below answers "no" rather than throwing. Resolution is LAZY —
       the profile cannot resolve before the database has loaded, which is
       after this file is set up — so the adapter is asked for at call time and
       never captured at load time.
       ------------------------------------------------------------------ */
    function ironman() {
        return $.safe(function () {
            return ($.profile && $.profile.adapter) ? $.profile.adapter('ironman') : null;
        }, 'ironman adapter', null);
    }
    S.ironmanAdapter = ironman;

    /** What the game calls its own mode, for anything user-facing. */
    S.ironmanName = function () {
        var ad = ironman();
        var n = (ad && typeof ad.name === 'function')
            ? $.safe(function () { return ad.name(); }, 'ironman name', null) : null;
        return n || 'restricted save mode';
    };

    /** The same name where there is only room for one word — a table cell. */
    S.ironmanShort = function () {
        var ad = ironman();
        var n = (ad && typeof ad.name === 'function')
            ? $.safe(function () { return ad.name(); }, 'ironman name', null) : null;
        return n || 'restricted';
    };

    S.ironmanOn = function () {
        var ad = ironman();
        if (!ad || typeof ad.enabled !== 'function') return false;
        return !!$.safe(function () { return ad.enabled(); }, 'ironman enabled', false);
    };

    S.ironmanSlot = function () {
        var ad = ironman();
        if (!ad || typeof ad.slot !== 'function') return null;
        return $.safe(function () { return ad.slot(); }, 'ironman slot', null);
    };

    /* ------------------------------------------------------------- writing */

    /**
     * Save to a slot without going through the save scene.
     *
     * That is the entire point: the save scene cannot be reached while an
     * event is running, which is exactly when you want a save. The lines that
     * scene would have run first are run here, in its order.
     *
     * `then(ok, err)` is optional and fires exactly once, after the write has
     * finished on either engine — one of which finishes before this function
     * returns and the other of which does not. Callers that want to repaint
     * afterwards use it instead of guessing at a delay.
     */
    S.saveTo = function (id, quiet, then) {
        function refuse(why) {
            toastNo(why);
            if (then) $.safe(function () { then(false, why); }, 'saveTo callback');
            return false;
        }
        if (!alive()) return refuse('there is no game running to save');
        if (!$.allowWrite('Saving the game')) {
            if (then) $.safe(function () { then(false, 'read-only mode'); }, 'saveTo callback');
            return false;
        }
        id = Math.floor(id);
        if (!(id >= 1 && id <= S.maxSlots())) return refuse('slot ' + id + ' is out of range');
        if (busy) return refuse('a ' + busy + ' is already in flight');

        // Overwriting an occupied slot is destructive and not undoable.
        if (S.info(id) && $.backup) $.safe(function () { $.backup.guard('quick save over slot ' + id); }, 'backup');

        busy = 'save';

        /* The two lines the scene would have run first, in its order — each on
           its own, so that one of them being unavailable cannot take the other
           down with it. Marking the savefile id goes through the adapter
           because one engine has no per-session savefile id at all: asking for
           it directly there throws, and a throw inside a block that also owned
           the actual write meant the write was never reached and the save
           silently did not happen. Where the concept does not exist the
           adapter is a no-op, which is the correct behaviour. */
        $.safe(function () { $.eng.markSavefileId(id); }, 'mark savefile id');
        $.safe(function () { $gameSystem.onBeforeSave(); }, 'onBeforeSave');

        /* One callback, exactly once, on both engines. In particular a plain
           `false` from the engine is a FAILURE and is reported as one — the
           pre-2.0 code treated any non-throw as a win and played the save
           sound over a save that had not been written. */
        $.eng.saveGame(id, function (ok, err) {
            busy = null;
            // The engine has just rewritten the index this panel reads.
            $.eng.invalidateSaveInfo();
            if (ok) {
                $.log('ok', 'quick saved to slot ' + id);
                $.emit('save:written', id);
            } else {
                $.log('err', 'quick save to slot ' + id + ' failed — ' +
                    (err || 'the engine did not say why'));
            }
            if (!quiet) done(id, ok);
            if (then) $.safe(function () { then(ok, err || null); }, 'saveTo callback');
        });
        return true;
    };

    function done(id, ok) {
        U.toast({
            title: ok ? 'SAVED' : 'SAVE FAILED',
            msg: ok ? 'slot ' + id + ' · ' + $.safe(function () { return $gameSystem.playtimeText(); }, 'playtime', '') : 'slot ' + id,
            severity: ok ? 'ok' : 'err'
        });
        $.safe(function () { if (ok && typeof SoundManager !== 'undefined') SoundManager.playSave(); }, 'playSave');
    }

    function toastNo(why) {
        U.toast({ title: 'NOT SAVED', msg: why, severity: 'warn' });
        $.log('warn', 'save refused: ' + why);
    }

    /* ------------------------------------------------------------- reading */

    /**
     * Load a slot without going through the load scene.
     *
     * That scene's sequence is: play the load sound, fade out, reload the map
     * if the project data has moved on, go to the map scene — and then
     * onAfterLoad() from its terminate(), once the scene is actually left.
     * onAfterLoad restores the frame counter the playtime is derived from and
     * replays the saved BGM/BGS, so it has to come after the fade, not before
     * it. The same order is reproduced here.
     */
    S.loadFrom = function (id, then) {
        function refuse(title, why) {
            U.toast({ title: title, msg: why, severity: 'warn' });
            if (then) $.safe(function () { then(false, why); }, 'loadFrom callback');
            return false;
        }
        if (typeof DataManager === 'undefined' || !DataManager.loadGame) return refuse('NOT LOADED', 'no DataManager');
        if (!$.allowWrite('Loading a save')) {
            if (then) $.safe(function () { then(false, 'read-only mode'); }, 'loadFrom callback');
            return false;
        }
        if (!S.info(id)) return refuse('EMPTY SLOT', 'slot ' + id + ' has no save in it');
        if (busy) return refuse('NOT NOW', 'a ' + busy + ' is already in flight');
        if ($.safe(function () { return SceneManager.isSceneChanging(); }, 'isSceneChanging', false)) {
            return refuse('NOT NOW', 'a scene change is already in flight — try again in a moment');
        }
        // Not from a battle. Scene_Battle.terminate() runs onBattleEnd() when
        // the scene is left, and by then it would be running against the party
        // that was just loaded: battle states removed, every buff cleared, TP
        // zeroed. You would load a save and lose the state it held. Scene_Load
        // is unreachable from Scene_Battle, so the engine never faces this.
        if ($.safe(function () { return $gameParty && $gameParty.inBattle(); }, 'inBattle', false)) {
            return refuse('NOT IN BATTLE',
                'leaving a fight would strip the loaded party of its buffs and states — end the battle first');
        }

        var before = snapshotGlobals();
        busy = 'load';

        /* One callback, exactly once, on both engines. The engine that answers
           synchronously used to fall down the "no promise" branch, which meant
           the whole sequence below — the load sound, the fade, the map reload,
           the scene change and onAfterLoad — was skipped while every global had
           ALREADY been replaced. That is the exact failure this module exists
           to avoid: fresh globals under a live scene. */
        $.eng.loadGame(id, function (ok, err) {
            busy = null;

            if (!ok) {
                /* Put the globals back on every failure path. Where the engine
                   refuses before touching anything this is a harmless no-op;
                   where it threw part-way through extracting, every global has
                   already been swapped for a blank one and this is the
                   difference between "that slot is unreadable" and an
                   unrecoverable session. */
                restoreGlobals(before);
                var why = err || 'the engine did not say why';
                $.log('err', 'quick load of slot ' + id + ' failed — ' + why +
                    ' (the running game was put back as it was)');
                U.toast({
                    title: 'LOAD FAILED',
                    msg: 'slot ' + id + ' could not be read — nothing was changed',
                    severity: 'err'
                });
                if (then) $.safe(function () { then(false, why); }, 'loadFrom callback');
                return;
            }

            $.safe(function () {
                if (typeof SoundManager !== 'undefined') SoundManager.playLoad();
                var scene = SceneManager._scene;
                if (scene && scene.fadeOutAll) scene.fadeOutAll();
                reloadMapIfUpdated();
                SceneManager.goto(Scene_Map);
                // The engine calls this from the load scene's terminate(), i.e.
                // after goto. The scene we are leaving is not that scene, so
                // nothing else will call it and there is no double-apply to
                // worry about.
                $gameSystem.onAfterLoad();
            }, 'quick load finish');

            // The scene change is queued by the scene manager's per-step
            // update, and the "pause while the menu is open" gate skips those
            // steps. Leaving the menu open would freeze the screen on the old
            // scene while every panel showed the newly loaded game.
            if ($.store.cfgGet('behaviour.pauseGame', false) && U.isOpen && U.isOpen()) {
                $.log('info', 'closing the menu so the loaded scene can actually start (pause is on)');
                U.setOpen(false);
            }

            $.log('ok', 'quick loaded slot ' + id);
            U.toast({ title: 'LOADED', msg: 'slot ' + id, severity: 'ok' });
            $.emit('save:loaded', id);
            if (then) $.safe(function () { then(true, null); }, 'loadFrom callback');
        });
        return true;
    };

    /**
     * The map-reload step the engine's own load scene runs.
     *
     * Identical on both engines: when the save was written against an older
     * version of the project data, the map has to be reloaded rather than
     * resumed, or the player stands on a map that no longer looks like that.
     */
    function reloadMapIfUpdated() {
        if ($gameSystem.versionId() === $dataSystem.versionId) return;
        var mapId = $gameMap.mapId(), x = $gamePlayer.x, y = $gamePlayer.y, d = $gamePlayer.direction();
        $gamePlayer.reserveTransfer(mapId, x, y, d, 0);
        $gamePlayer.requestMapReload();
    }

    S.quickSave = function () { return S.saveTo(S.quickSlot()); };
    S.quickLoad = function () { return S.loadFrom(S.quickSlot()); };

    /* =====================================================================
       PART 2 — HOOKS
       ===================================================================== */

    /**
     * Save anywhere.
     *
     * GigaHack loads last, so this alias sits outside anything a plugin has
     * put on the same method — a mode that returns false during an event, say
     * — and outside the engine's own `!_saveDisabled`, which the "Change Save
     * Access" event command sets. Both are the thing being overridden, so
     * short-circuiting is the point, not an oversight. The method is identical
     * on both engines.
     */
    $.install('Game_System.isSaveEnabled',
        typeof Game_System !== 'undefined' ? Game_System.prototype : null, 'isSaveEnabled',
        function (original) {
            return function () {
                if ($.store.cfgGet('save.anywhere', false)) return true;
                return original.apply(this, arguments);
            };
        });

    /**
     * Per-slot enablement.
     *
     * Where the engine's save scene has a per-slot enable test, save-anywhere
     * lifts it too, or the setting is half a feature: you could reach the menu
     * and still not be allowed to pick a slot. A plugin that restricts saving
     * to one dedicated slot overrides exactly this method, which is why
     * overriding it back is the point.
     *
     * NOT EVERY BUILD HAS THE CONCEPT. One engine's save scene has no per-slot
     * enable test at all, and its savefile list never overrides "is the current
     * item enabled" — every slot the list shows is already selectable. There is
     * then no restriction to lift, $.install records the skip with that reason,
     * and the panel reports it instead of offering a control that does nothing.
     */
    var SLOT_GATE_WHY = 'this build\'s save menu has no per-slot enable test, so there is no slot ' +
        'restriction for "save anywhere" to lift — every slot the list shows is already selectable.';

    $.install('Scene_File.isSavefileEnabled',
        ($.caps.savefileEnabled && typeof Scene_File !== 'undefined') ? Scene_File.prototype : null,
        'isSavefileEnabled',
        function (original) {
            return function (savefileId) {
                // The stock test is `!!savefileId` in save mode — i.e. slot 0,
                // the autosave, is never a manual save target. Save-anywhere
                // lifts a plugin's restriction, not that one.
                if ($.store.cfgGet('save.anywhere', false) && this.mode && this.mode() === 'save') {
                    return !!savefileId;
                }
                return original.apply(this, arguments);
            };
        }, SLOT_GATE_WHY);

    /** null when the slot gate is in force, otherwise why it is not. */
    S.slotGateWhy = function () {
        if (!$.caps.savefileEnabled) return SLOT_GATE_WHY;
        var hk = $.hooks['Scene_File.isSavefileEnabled'];
        if (hk && hk.installed) return null;
        return (hk && hk.reason) || 'the save scene\'s per-slot enable test could not be hooked.';
    };
    S.slotGateAvailable = function () { return S.slotGateWhy() === null; };

    /* ------------------------------------------- the restricted-mode relax
       A game whose save mode punishes reloading typically arms a flag on load
       and acts on it the next time a map finishes loading. Suppressing that is
       the game's own design being overridden, so it is off by default, it is
       SESSION-ONLY — deliberately not a stored GigaHack setting, because it is
       meaningless on a game with no such mode — and the state lives in the
       adapter, not in a field name this file guesses at.

       The hook is installed on FIRST SIGHT OF AN ADAPTER and not before. The
       profile cannot resolve until the database has loaded, which is after
       this file is set up, so it is retried on the events that mean "the game
       objects exist now". With no adapter the hook is never built at all.
       ------------------------------------------------------------------ */
    var relaxOn = false;
    var ironHookDone = false;

    S.relaxAvailable = function () {
        var ad = ironman();
        return !!(ad && typeof ad.relax === 'function');
    };
    S.relaxOn = function () { return relaxOn && S.relaxAvailable(); };

    S.setRelax = function (on) {
        if (!S.relaxAvailable()) return false;
        relaxOn = !!on;
        ensureIronmanHook();
        $.safe(function () { ironman().relax(relaxOn); }, 'relax restricted save mode');
        $.log('info', S.ironmanName() + ': reload penalty ' + (relaxOn ? 'suppressed' : 'left as the game intends'));
        return true;
    };

    function ensureIronmanHook() {
        if (ironHookDone) return false;
        if (!S.relaxAvailable()) return false;      // nothing to install for
        ironHookDone = true;
        return $.install('Scene_Map.onMapLoaded (restricted save mode)',
            typeof Scene_Map !== 'undefined' ? Scene_Map.prototype : null, 'onMapLoaded',
            function (original) {
                return function () {
                    if (relaxOn) {
                        $.safe(function () {
                            var ad = ironman();
                            if (ad && ad.relax) ad.relax(true);
                        }, 'relax on map load');
                    }
                    return original.apply(this, arguments);
                };
            }, 'Scene_Map.onMapLoaded was not found in this build');
    }

    // Both events mean "the database and the game objects are there now", which
    // is the earliest a profile — and therefore an adapter — can resolve.
    $.on('mounted', function () { $.safe(ensureIronmanHook, 'restricted-mode hook'); });
    $.on('gameobjects', function () { $.safe(ensureIronmanHook, 'restricted-mode hook'); });

    S.anywhereAvailable = function () {
        return !!($.hooks['Game_System.isSaveEnabled'] && $.hooks['Game_System.isSaveEnabled'].installed);
    };

    /* ------------------------------------------------------------ hotkeys */
    U.addHotkey({
        id: 'quickSave', label: 'Quick save',
        help: 'Writes the quick-save slot immediately, even mid-cutscene',
        when: function () { return alive(); },
        run: function () { S.quickSave(); }
    });
    U.addHotkey({
        id: 'quickLoad', label: 'Quick load',
        help: 'Reloads the quick-save slot. Unbound by default — an accidental press would discard everything since',
        when: function () { return typeof DataManager !== 'undefined'; },
        run: function () { S.quickLoad(); }
    });

    /* =====================================================================
       PART 3 — PANEL
       ===================================================================== */
    function stamp(ms) {
        if (!ms) return '—';
        return $.safe(function () {
            // Padded by hand, not with padStart: the browser floor one of these
            // engines ships on predates it on older builds, and a stamp is not
            // worth a runtime error in a table cell.
            var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
                ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        }, 'stamp', '—');
    }

    /**
     * The per-slot half of "save anywhere", or why there is no such half here.
     *
     * Two different messages, because they mean different things: one build
     * has a slot restriction and GigaHack lifts it; the other has no such
     * concept, so there is nothing to lift and nothing is broken.
     */
    function slotGateNote() {
        var why = S.slotGateWhy();
        if (!why) {
            return h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Also lifts the save menu\'s per-slot restriction.');
        }
        return h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal', text: why });
    }

    function build() {
        if (!alive()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'no game running' }),
                    h('div', { text: 'start or load a game, then reopen this panel' })));
        }

        var qs = S.quickSlot();
        var markName = S.ironmanName(), markShort = S.ironmanShort();

        var table = W.table({
            virtual: true, rowH: 17,
            cols: [
                { label: 'slot', w: '0 0 42px', cls: 'mm-td-num' },
                { label: 'saved', w: '0 0 104px', cls: 'mm-td-num' },
                { label: 'playtime', w: '1 1 0', cls: 'mm-td-num' },
                { label: '', w: '0 0 120px' }
            ],
            empty: 'no save files',
            render: function (r) {
                return [
                    String(r.id) + (r.id === qs ? ' ★' : ''),
                    r.exists ? stamp(r.timestamp) : '—',
                    r.exists ? (r.playtime || '—') + (r.mark ? ' · ' + markShort : '') : 'empty',
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'save', mini: true, mutates: true,
                            // Repainted from the write's own callback rather
                            // than after a guessed delay: one engine finishes
                            // before this handler returns and the other does
                            // not, and a fixed timeout is wrong on both.
                            onClick: function () { S.saveTo(r.id, false, function () { U.rerender(); }); }
                        }),
                        W.button({
                            label: 'load', mini: true, mutates: true, disabled: !r.exists,
                            confirm: true, confirmLabel: 'discard progress?',
                            onClick: function () { S.loadFrom(r.id); }
                        }),
                        W.button({
                            label: 'quick', mini: true, _ungated: true,
                            tip: 'Quick slot|Points the quick save/load hotkeys here.',
                            onClick: function () { $.store.cfgSet('save.quickSlot', r.id); U.rerender(); }
                        }))
                ];
            },
            onRow: function (tr, r) {
                if (r.id === qs) tr.style.color = 'var(--mm-text-hi)';
                // Only where the game HAS a restricted save mode, and only
                // because its adapter recognised the entry. No adapter, no
                // column, no tooltip.
                if (r.mark) {
                    tr.setAttribute('data-mm-tip',
                        markShort + '|written by the game\'s own ' + markName);
                }
            }
        });
        table.mm.paint(S.slots());

        /* The panel already repaints from its OWN write's callback. What it
           could not see was a slot the GAME wrote — an autosave, or an event
           that saves — which left a row claiming a file that had been replaced
           minutes ago. Only the table is repainted: the quick-slot box beside
           it is typed into, and "load it" is two clicks.

           The table is virtual, so a paint keeps the reader's scroll position;
           isScrolling() is a real guard here for the same reason.

           A "load" that was already armed IS disarmed by this, and that is the
           right way round: the only thing that repaints these rows is the file
           under one of them changing, and "discard progress?" asked about a
           save that has since been overwritten is a question about the wrong
           file. The signal is the index moving, so nothing else can trigger
           it — and it costs a stat, not a re-read of the index per tick; see
           slotSignature for what each engine actually pays. */
        U.live(S.slotSignature, function () { table.mm.paint(S.slots()); }, {
            name: 'save slots',
            within: table,
            when: function () { return !table.mm.isScrolling(); }
        });

        var left = [
            W.group('Quick save', [
                W.row('Slot', W.number({
                    value: qs, min: 1, max: S.maxSlots(), wide: true, _ungated: true,
                    tip: 'Quick slot|Defaults to the last slot.',
                    onChange: function (v) { $.store.cfgSet('save.quickSlot', v); U.rerender(); }
                })),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'save now', wide: true, variant: 'prime', mutates: true,
                        onClick: function () { S.saveTo(S.quickSlot(), false, function () { U.rerender(); }); }
                    }),
                    W.button({
                        label: 'load it', wide: true, mutates: true,
                        confirm: true, confirmLabel: 'discard progress?',
                        disabled: !S.info(qs),
                        onClick: function () { S.quickLoad(); }
                    })),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Works mid-cutscene. Overwriting an occupied slot takes a backup first.' +
                    (S.slotIsHidden(qs)
                        ? ' The save menu does not list slot ' + qs + ' — it is a real file, ' +
                          'reachable only from here or the hotkey.'
                        : ''))
            ], { tag: 'slot ' + qs }),

            W.group('Overrides', [
                W.toggleRow('Save anywhere', {
                    value: !!$.store.cfgGet('save.anywhere', false),
                    _ungated: true,
                    tip: 'Save anywhere|Forces the engine\'s "saving allowed" test true, so the ' +
                        'in-game menu works everywhere.',
                    onChange: function (v) { $.store.cfgSet('save.anywhere', v); U.rerender(); }
                }),
                // The per-slot half of the same feature. Where the engine has
                // no such test there is nothing to lift, and saying so beats
                // both a silent gap and a greyed control.
                slotGateNote(),
                // Built only when this game HAS a restricted save mode. With no
                // adapter there is no toggle here at all — not a disabled one
                // for a feature that does not exist.
                S.relaxAvailable() ? W.toggleRow('Ignore the reload penalty', {
                    value: S.relaxOn(),
                    _ungated: true,
                    sub: S.ironmanOn() ? markName + ' is ON' : markName + ' is off',
                    tip: 'Reload penalty|Clears the flag the game arms on load, before it is read. ' +
                        'Session-only.',
                    onChange: function (v) { S.setRelax(v); U.rerender(); }
                }) : null,
                S.anywhereAvailable() ? null : h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: 'Unavailable: this build has no "is saving allowed" test to override.'
                })
            ], { tag: S.anywhereAvailable() ? 'hooked' : 'off' })
        ];

        var right = [
            W.group('Save files', [table], { grow: true }),
            W.group('State', [
                kv('Save enabled', $.safe(function () { return $gameSystem.isSaveEnabled(); }, 'isSaveEnabled', '?')),
                // Only where the game declares one. A build with no restricted
                // save mode gets no row about it.
                ironman() ? kv(markName, S.ironmanOn()
                    ? 'on' + (S.ironmanSlot() == null ? '' : ' (slot ' + S.ironmanSlot() + ')')
                    : 'off') : null,
                kv('Event running', $.safe(function () { return $gameMap.isEventRunning(); }, 'isEventRunning', '?')),
                // Resolved through the storage layer at call time, never built
                // from the game root: relocating the save folder by aliasing
                // that resolution is common on both engines, and a hand-built
                // path would name a folder nobody reads.
                W.pathRow('Save directory', $.eng.saveDir(), {
                    why: 'StorageManager did not resolve one on this build'
                }),
                kv('Save files', $.caps.saveExt || 'unknown'),
                kv('Slot gate', S.slotGateAvailable() ? 'lifted with "save anywhere"' : 'not used by this build')
            ], { tag: 'live' })
        ];

        return cols(left, right);
    }


    /* =====================================================================
       PART 4 — METADATA, EXPORT AND IMPORT
       ===================================================================== */

    function fs() { return $.env.fs; }
    function pathMod() { return $.env.path; }

    /**
     * Playtime is not stored — it is DERIVED from Graphics.frameCount, and
     * Game_System keeps a copy in _framesOnSave that onAfterLoad puts back
     * into the counter. Writing only one of the two is why a naive "set
     * playtime" appears to work and then reverts on the next load, so both are
     * written together.
     */
    S.playtimeSeconds = function () {
        return $.safe(function () {
            return Math.floor((typeof Graphics !== 'undefined' ? Graphics.frameCount : 0) / 60);
        }, 'playtime', 0);
    };

    S.playtimeText = function () {
        return $.safe(function () { return $gameSystem.playtimeText(); }, 'playtimeText', '—');
    };

    var PLAYTIME_MAX = 60 * 60 * 999;   // 999 hours — the engine's own text format stops making sense past it

    S.setPlaytime = function (seconds) {
        if (!$.allowWrite('playtime')) return false;
        var secs = $.clamp(Math.round(Number(seconds) || 0), 0, PLAYTIME_MAX);
        return $.safe(function () {
            var before = Graphics.frameCount;
            var beforeSaved = $gameSystem._framesOnSave;
            Graphics.frameCount = secs * 60;
            $gameSystem._framesOnSave = Graphics.frameCount;
            $.undo.push('playtime ' + Math.floor(before / 60) + 's → ' + secs + 's', function () {
                Graphics.frameCount = before;
                $gameSystem._framesOnSave = beforeSaved;
            });
            $.log('ok', 'playtime → ' + S.playtimeText());
            return true;
        }, 'set playtime', false);
    };

    S.saveCount = function () {
        return $.safe(function () { return $gameSystem.saveCount(); }, 'saveCount', 0);
    };

    S.setSaveCount = function (n) {
        if (!$.allowWrite('save count')) return false;
        return $.safe(function () {
            var before = $gameSystem._saveCount;
            $gameSystem._saveCount = $.clamp(Math.round(Number(n) || 0), 0, 999999);
            $.undo.push('save count ' + before + ' → ' + $gameSystem._saveCount, function () {
                $gameSystem._saveCount = before;
            });
            return true;
        }, 'set save count', false);
    };

    /* ------------------------------------------------------- export/import */

    /**
     * The save file extension is an ENGINE FACT, asked for rather than written
     * down — the two engines use different ones — and asked for at call time so
     * that a capability table set up after this file still gives the right
     * answer. An empty string means the engine could not be identified, and
     * every caller below refuses rather than guessing which files are saves.
     */
    function saveExt() {
        return ($.caps && $.caps.saveExt) || '';
    }

    /**
     * The file the engine itself would use for a slot.
     *
     * Always the backup module's resolver, which goes through the storage
     * layer at call time. Relocating the save directory by aliasing that
     * resolution is common on both engines, so a hand-built
     * <gameRoot>/save/file<N> would export from — and import into — a folder
     * the game does not read. When it cannot be resolved the answer is null
     * and the caller says so; it is never guessed at.
     */
    function slotFile(id) {
        return ($.backup && $.backup.fileFor) ? $.backup.fileFor(id) : null;
    }

    S.transferAvailable = function () {
        return $.paths.mode === 'fs' && !!fs() && !!pathMod() && !!$.paths.dataDir &&
            !!$.backup && $.backup.available();
    };

    S.transferWhy = function () {
        if ($.paths.mode !== 'fs') return 'persistence is in ' + $.paths.mode + ' mode — no files to copy';
        if (!$.backup || !$.backup.available()) return ($.backup && $.backup.reason()) || 'the backup module is unavailable';
        if (!saveExt()) {
            return 'the engine could not be identified, so GigaHack does not know what a save file is ' +
                'called here and will not guess at which files to copy.';
        }
        return null;
    };

    S.exportDir = function () {
        return $.paths.dataDir && pathMod() ? pathMod().join($.paths.dataDir, 'exports') : null;
    };
    S.importDir = function () {
        return $.paths.dataDir && pathMod() ? pathMod().join($.paths.dataDir, 'imports') : null;
    };

    /**
     * Export copies the file BYTE FOR BYTE, for the same reason the backup
     * module does: plugins commonly extend the save contents, so a save
     * carries sections this mod has never heard of, and anything that parsed
     * and re-serialised one would silently drop whichever of them it did not
     * know about. A save is bytes, not JSON we understand.
     */
    S.exportSlot = function (id, stamp) {
        if (!S.transferAvailable()) return null;
        if (!$.allowWrite('export save slot ' + id)) return null;
        return $.safe(function () {
            var src = slotFile(id);
            if (!src) {
                $.log('warn', 'slot ' + id + ' was not exported — the engine did not resolve a path for it, ' +
                    'and GigaHack does not guess at save paths.');
                return null;
            }
            if (!fs().existsSync(src)) { $.log('warn', 'slot ' + id + ' has no file to export'); return null; }
            var out = S.exportDir();
            fs().mkdirSync(out, { recursive: true });
            var name = 'slot' + id + '_' + (stamp || fileStamp()) + saveExt();
            var dst = pathMod().join(out, name);
            fs().copyFileSync(src, dst);
            $.log('ok', 'slot ' + id + ' exported → ' + dst);
            return { file: dst, name: name, bytes: fs().statSync(dst).size };
        }, 'export slot', null);
    };

    S.exports = function () {
        var dir = S.exportDir(), ext = saveExt();
        if (!dir || !fs() || !ext) return [];
        return $.safe(function () {
            if (!fs().existsSync(dir)) return [];
            return fs().readdirSync(dir).filter(function (n) { return n.slice(-ext.length) === ext; })
                .sort().reverse();
        }, 'list exports', []);
    };

    /**
     * Importable files.
     *
     * The folder is created on demand so that the panel can name a path the
     * user can actually drop a file into, rather than telling them to make one.
     */
    S.imports = function () {
        var dir = S.importDir(), ext = saveExt();
        if (!dir || !fs() || !ext) return [];
        return $.safe(function () {
            fs().mkdirSync(dir, { recursive: true });
            return fs().readdirSync(dir).filter(function (n) { return n.slice(-ext.length) === ext; }).sort();
        }, 'list imports', []);
    };

    /**
     * Import writes over a slot, so it backs the slot up first — the one
     * operation in this module that destroys a save outright. The copy is
     * verbatim for the same reason the export is.
     */
    S.importInto = function (fileName, slotId) {
        if (!S.transferAvailable()) return { ok: false, error: S.transferWhy() || 'unavailable' };
        var id = Math.round(Number(slotId) || 0);
        if (!(id >= 1 && id <= S.maxSlots())) return { ok: false, error: 'slot ' + slotId + ' is out of range' };
        if (!$.allowWrite('import a save into slot ' + id)) return { ok: false, error: 'read-only mode' };
        // Checked here as well as in transferAvailable: this is a public entry
        // point, and a null path module three lines down is a thrown TypeError
        // rather than an answer.
        if (!fs() || !pathMod() || !S.importDir()) return { ok: false, error: 'no filesystem access' };
        var dst = slotFile(id);
        if (!dst) {
            return { ok: false, error: 'the engine did not resolve a file path for slot ' + id +
                '. GigaHack will not guess at a save path — writing to the wrong folder would look like ' +
                'success and change nothing.' };
        }
        return $.safe(function () {
            var src = pathMod().join(S.importDir(), String(fileName));
            if (!fs().existsSync(src)) return { ok: false, error: 'no such file: ' + fileName };
            var replaced = false;
            if (fs().existsSync(dst)) {
                replaced = true;
                $.backup.make('before importing into slot ' + id, true);
            }
            fs().copyFileSync(src, dst);

            /* The index the save menu reads is NOT rebuilt by copying a file
               into place, and the two engines do not even agree on whether it
               can be rewritten at all: one keeps it in a cached field that its
               own loader fills from inside a promise — so reading it back
               synchronously yields undefined and the next slot-info read takes
               the game down — while the other returns it from a plain call and
               takes it back as an argument, which is a genuine
               read-modify-write.
               $.eng.updateGlobalInfo does whichever the engine allows and says
               so by returning false when it can do neither. Either way the
               imported file IS the save; the index only carries the title and
               playtime the menu shows. */
            var retitled = $.eng.updateGlobalInfo(function (gi) {
                if (gi && gi[id]) gi[id].title = (gi[id].title || '') + ' (imported)';
            });
            $.eng.invalidateSaveInfo();
            $.log('ok', fileName + ' imported into slot ' + id +
                (replaced ? ' (previous save backed up)' : '') +
                (retitled ? '' : ' — the save menu will keep showing the old title until the engine ' +
                    'reloads its index, because this build does not allow it to be rewritten in place'));
            return { ok: true, slot: id, replaced: replaced, retitled: !!retitled };
        }, 'import save', { ok: false, error: 'the copy failed' });
    };

    function fileStamp() {
        var d = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
            p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }


    /* --------------------------------------------------- Transfer panel */
    var importPick = null, importSlot = 1;

    function buildTransfer() {
        var why = S.transferWhy();
        if (why) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'save transfer unavailable' }),
                    h('div', { text: why })));
        }

        var slots = S.slots();
        var used = slots.filter(function (r) { return r.exists; });
        var files = S.imports();
        if (importPick && files.indexOf(importPick) < 0) importPick = null;
        if (!importPick && files.length) importPick = files[0];

        var exportOptions = used.map(function (r) { return 'slot ' + r.id + (r.playtime ? ' · ' + r.playtime : ''); });
        var exportPick = exportOptions.length ? exportOptions[0] : null;

        /* The clock the player recognises, and it ticks once a second in the
           running game. The Hours and Minutes boxes beside it are seeded from
           the same number and are what somebody types into, so the readout is
           repainted and they are not — the row says what the game holds, the
           boxes say what is about to be written to it. */
        var playtimeRow = kv('Playtime', S.playtimeText());
        U.live(S.playtimeText, function () {
            playtimeRow.lastChild.textContent = S.playtimeText();
        }, { name: 'playtime', within: playtimeRow });

        var left = [
            W.group('Playtime & count', [
                playtimeRow,
                W.row('Hours', W.number({
                    value: Math.floor(S.playtimeSeconds() / 3600), min: 0, max: 999, label: 'playtime hours',
                    onChange: function (v) {
                        S.setPlaytime(v * 3600 + (S.playtimeSeconds() % 3600));
                        U.rerender();
                    }
                }), { tip: 'Playtime|Two copies, both written — otherwise the next load reverts ' +
                          'it.' }),
                W.row('Minutes', W.number({
                    value: Math.floor(S.playtimeSeconds() % 3600 / 60), min: 0, max: 59, label: 'playtime minutes',
                    onChange: function (v) {
                        S.setPlaytime(Math.floor(S.playtimeSeconds() / 3600) * 3600 + v * 60);
                        U.rerender();
                    }
                })),
                h('div', { class: 'mm-sep' }),
                W.row('Save count', W.number({
                    value: S.saveCount(), min: 0, max: 999999, label: 'save count',
                    onChange: function (v) { S.setSaveCount(v); U.rerender(); }
                })),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'On the undo stack; not on disk until the next save.')
            ], { tag: 'in the save' }),

            W.group('Export a slot', [
                exportOptions.length ? W.row('Slot', W.dropdown({
                    options: exportOptions, value: exportPick, width: '128px', _ungated: true,
                    onChange: function (v) { exportPick = v; }
                })) : h('div', { class: 'mm-empty', text: 'no save files yet' }),
                exportOptions.length ? W.button({
                    label: 'copy it to exports/', wide: true, mutates: true,
                    onClick: function () {
                        var id = parseInt(String(exportPick).replace('slot ', ''), 10);
                        var r = S.exportSlot(id);
                        U.toast(r
                            ? { title: 'EXPORTED', msg: r.name, severity: 'ok', ms: 1800 }
                            : { title: 'NOT EXPORTED', msg: 'that slot has no file', severity: 'warn' });
                        U.rerender();
                    }
                }) : null,
                W.pathRow('Folder', S.exportDir(), { why: 'no filesystem here, so there is nowhere to export to' }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Copied byte for byte — parsing and rewriting a save would drop what plugins ' +
                    'added.')
            ], { tag: S.exports().length + ' exported' })
        ];

        var right = [
            W.group('Import into a slot', [
                files.length ? W.row('File', W.dropdown({
                    options: files, value: importPick, width: '150px', _ungated: true,
                    onChange: function (v) { importPick = v; }
                })) : h('div', { class: 'mm-empty',
                    // Named from the engine, because the two engines use
                    // different extensions and telling someone to drop the
                    // wrong one is worse than saying nothing.
                    text: 'drop a ' + (saveExt() || 'save') + ' file into imports/' }),
                W.row('Into slot', W.number({
                    value: importSlot, min: 1, max: S.maxSlots(), label: 'target slot', _ungated: true,
                    onChange: function (v) { importSlot = v; U.rerender(); }
                })),
                W.button({
                    label: 'overwrite slot ' + importSlot, wide: true, variant: 'danger', mutates: true,
                    disabled: !importPick,
                    confirm: true,
                    confirmLabel: 'overwrite slot ' + importSlot +
                        (slots[importSlot - 1] && slots[importSlot - 1].exists ? ' (it has a save — it will be backed up first)' : '') + '?',
                    onClick: function () {
                        var r = S.importInto(importPick, importSlot);
                        U.toast(r.ok
                            ? { title: 'IMPORTED', msg: 'slot ' + r.slot + (r.replaced ? ' · previous save backed up' : ''), severity: 'ok' }
                            : { title: 'NOT IMPORTED', msg: r.error, severity: 'warn' });
                        U.rerender();
                    }
                }),
                W.pathRow('Folder', S.importDir(), { why: 'no filesystem here, so there is nowhere to import from' }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Backed up first — this is the one action here that destroys a save.')
            ], { tag: files.length + ' waiting' }),

            W.group('Exports on disk', [
                (function () {
                    var t = W.table({
                        rowH: 17, empty: 'nothing exported yet',
                        cols: [{ label: '#', w: '0 0 30px', cls: 'mm-td-num' }, { label: 'file', w: '1 1 0' }],
                        render: function (n, i) { return [String(i + 1), h('span', { class: 'mm-td-val', text: n })]; }
                    });
                    t.mm.paint(S.exports());
                    return t;
                })()
            ], { grow: true, collapsed: true })
        ];

        return cols(left, right);
    }

    function kv(label, value) {
        return h('div', { class: 'mm-row' },
            h('div', { class: 'mm-lab', text: label }),
            // The value is unbounded — a path, a project's own name for
            // something, a joined list — so the edge is allowed to shrink and
            // wrap. Without that it pushes the label out and is then clipped
            // by the column, and neither half can be read.
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-selectable mm-breakall',
                text: String(value)
            }));
    }

    U.debugPanel('Saves', build, 50);
    U.debugPanel('Transfer', buildTransfer, 55);

    $.api.quickSave = function () { return S.quickSave(); };
    $.api.quickLoad = function () { return S.quickLoad(); };
    $.api.saveTo = function (id) { return S.saveTo(id); };
    $.api.loadFrom = function (id) { return S.loadFrom(id); };

    $.api.exportSlot = function (id) { return S.exportSlot(id); };
    $.api.playtime = function (secs) { return secs == null ? S.playtimeSeconds() : S.setPlaytime(secs); };

    $.log('ok', 'save tools ready — quick slot ' + S.quickSlot() + ' of ' + S.maxSlots() +
        ', ' + ($.caps.saveExt || 'unknown format') + ' in ' + ($.eng.saveDir() || 'an unresolved folder') +
        ' (transfer ' + (S.transferAvailable() ? 'ready' : 'unavailable') + ')');
    if (!S.slotGateAvailable()) $.log('info', S.slotGateWhy());

})(window.GigaHack);
