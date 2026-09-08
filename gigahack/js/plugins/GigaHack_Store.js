//=============================================================================
// GigaHack MV/MZ
// 02 · store.js — settings + custom data persistence
//-----------------------------------------------------------------------------
// Every write is logged with its resolved absolute path — no silent writes. A
// failed write disables persistence for that FILE rather than throwing into
// the game loop, so one unwritable path never takes the mod down with it.
//
// Three backends, chosen once by Core and used identically by read, write,
// exists and remove: the filesystem where Node is available, localStorage in a
// browser build, and an in-RAM map when even that is refused. Nothing above
// this file knows which one it got.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — persistence layer
 * @author gigahack
 * @help GigaHack_Store.js — requires Core.
 *
 * Hotkey defaults are derived from the keys the running game leaves free,
 * which needs Profile. Profile loads AFTER this file, so the derivation is
 * requested again from Boot once the whole load order has run; until then the
 * built-in fallback letters stand.
 */

(function ($) {
    'use strict';
    if (!$) { console.error('[GigaHack] core missing — store not installed'); return; }

    var store = $.store = {};
    var memory = {};              // last-resort in-RAM store
    var pending = {};             // debounce timers, keyed by file name
    var failed = Object.create(null); // files we have given up on
    var DEBOUNCE_MS = 250;

    function fsPath(name) {
        var p = $.paths;
        if (p.mode !== 'fs' || !p.dataDir || !$.env.path) return null;
        return $.env.path.join(p.dataDir, name);
    }
    store.path = fsPath;

    /* Per game, because the backend is not.
       NW.js keeps one storage area per APP, and two RPG Maker games whose
       package.json carries the same name — which is the default, and common —
       share it. Keyed on the file name alone, the second game read the first
       game's settings, and every write from either overwrote the other's. That
       is precisely the thing the consent answer is keyed to avoid, and the
       rest of the store had no business being any looser about it.

       LEGACY: a key written before this existed carries no game. read() falls
       back to it once and adopts what it finds, so an upgrade keeps the
       settings it had; whichever game reads first wins that adoption, which is
       the same coin toss as before and the last time it is tossed. */
    function lsKey(name) { return 'gigahack:' + ($.paths.gameId || $.paths.gameKey || 'game') + ':' + name; }
    function lsLegacyKey(name) { return 'gigahack:' + name; }

    /* ---------------------------------------------------------------- read */
    store.read = function (name, fallback) {
        return $.safe(function () {
            var p = $.paths;
            if (p.mode === 'fs') {
                var file = fsPath(name);
                if (!file || !$.env.fs.existsSync(file)) return fallback;
                var raw = $.env.fs.readFileSync(file, 'utf8');
                return raw ? JSON.parse(raw) : fallback;
            }
            if (p.mode === 'localStorage') {
                var v = localStorage.getItem(lsKey(name));
                if (v === null) {
                    var old = localStorage.getItem(lsLegacyKey(name));
                    if (old !== null) {
                        localStorage.setItem(lsKey(name), old);
                        localStorage.removeItem(lsLegacyKey(name));
                        $.log('info', 'adopted ' + name + ' from the unkeyed browser store into ' +
                            lsKey(name) + ' — it used to be shared with every game in this build');
                        v = old;
                    }
                }
                return v ? JSON.parse(v) : fallback;
            }
            return Object.prototype.hasOwnProperty.call(memory, name) ? memory[name] : fallback;
        }, 'store.read(' + name + ')', fallback);
    };

    /* --------------------------------------------------------------- write */
    function writeNow(name, obj, quiet) {
        if (failed[name]) return false;
        var ok = $.safe(function () {
            var p = $.paths, json = JSON.stringify(obj, null, 2);
            if (p.mode === 'fs') {
                var file = fsPath(name);
                $.env.fs.mkdirSync($.env.path.dirname(file), { recursive: true });
                $.env.fs.writeFileSync(file, json, 'utf8');
                if (!quiet) $.log('ok', 'wrote ' + file);
                return true;
            }
            if (p.mode === 'localStorage') {
                localStorage.setItem(lsKey(name), json);
                if (!quiet) $.log('ok', 'wrote localStorage:' + lsKey(name));
                return true;
            }
            memory[name] = obj;
            if (!quiet) $.log('warn', 'kept ' + name + ' in memory only (not persisted)');
            return true;
        }, 'store.write(' + name + ')', false);

        if (ok !== true) {
            // Give up on this file rather than logging an error every frame a
            // slider moves. Persistence is disabled for it until the next launch.
            failed[name] = true;
            $.log('err', 'persistence disabled for ' + name + ' after a failed write');
            return false;
        }
        return true;
    }

    /** Test hook / recovery: clear the give-up flag for a file. */
    store.retry = function (name) {
        if (name) delete failed[name]; else failed = Object.create(null);
    };
    store.hasFailed = function (name) { return !!failed[name]; };

    /** Immediate write. Use for one-shot actions the user expects to stick. */
    store.write = function (name, obj, quiet) {
        if (pending[name]) { clearTimeout(pending[name].timer); delete pending[name]; }
        return writeNow(name, obj, quiet);
    };

    /**
     * Debounced write. Use for anything driven by a slider or a drag, so a
     * 60fps stream of changes collapses into one file write.
     *
     * Logging follows behaviour.logEveryWrite: on (the default) every write
     * logs its absolute path, per §6.6. Turning it off keeps the first write
     * of each file — so the destination is always visible at least once — and
     * silences the repeats.
     */
    store.save = function (name, obj) {
        var first = !seen[name];
        seen[name] = true;
        var loud = first || ($.cfg.behaviour ? $.cfg.behaviour.logEveryWrite !== false : true);
        // pending[name] is {obj, quiet, timer} — NOT a timer id. Passing the
        // object to clearTimeout coerces it to NaN and cancels nothing, so
        // every call past the first 250ms wrote the file again: dragging one
        // slider re-serialised and rewrote settings.json about sixty times a
        // second, and a single failed write in that storm latches persistence
        // off for the rest of the session.
        if (pending[name]) clearTimeout(pending[name].timer);
        pending[name] = { obj: obj, quiet: !loud };
        pending[name].timer = setTimeout(function () {
            var job = pending[name];
            delete pending[name];
            if (job) writeNow(name, job.obj, job.quiet);
        }, DEBOUNCE_MS);
    };
    var seen = Object.create(null);

    /**
     * Write every pending debounced change out now. "Flush" means commit, not
     * discard — dropping the timers would silently lose the user's last edit.
     */
    store.flush = function () {
        Object.keys(pending).forEach(function (n) {
            var job = pending[n];
            delete pending[n];
            if (!job) return;
            clearTimeout(job.timer);
            writeNow(n, job.obj, job.quiet);
        });
        /* The cross-game file is debounced on the same clock and is NOT in
           `pending` — it is written with raw fs against an absolute path
           outside dataDir. Leaving it out here would make "flush, then move
           the directory" most of an instruction rather than all of one. */
        flushSharedWrite();
    };

    store.exists = function (name) {
        return $.safe(function () {
            var p = $.paths;
            if (p.mode === 'fs') { var f = fsPath(name); return !!f && $.env.fs.existsSync(f); }
            if (p.mode === 'localStorage') return localStorage.getItem(lsKey(name)) !== null;
            return Object.prototype.hasOwnProperty.call(memory, name);
        }, 'store.exists(' + name + ')', false);
    };

    /* -------------------------------------------------------------- delete */
    /**
     * Delete one persisted file.
     *
     * Follows the same fs -> localStorage -> memory chain as writeNow(), and
     * for the same reason: a file is only ever in ONE of the three, and
     * deleting from the wrong one leaves a "cleared" cache that comes back at
     * the next launch.
     *
     * A queued debounced write is cancelled first. Without that, remove()
     * followed 250ms later by the timer would rewrite the very file the caller
     * has just decided to throw away — which is exactly the shape of the bug
     * that made "rebuild the index" appear not to work.
     *
     * Returns true when the file is gone, INCLUDING when it was never there:
     * the caller asked for absence, and absence is what it got. False means
     * the backend refused and the file may still exist.
     */
    store.remove = function (name) {
        if (pending[name]) { clearTimeout(pending[name].timer); delete pending[name]; }
        var ok = $.safe(function () {
            var p = $.paths;
            if (p.mode === 'fs') {
                var file = fsPath(name);
                if (!file) return false;
                if ($.env.fs.existsSync(file)) {
                    $.env.fs.unlinkSync(file);
                    $.log('ok', 'deleted ' + file);
                }
                return true;
            }
            if (p.mode === 'localStorage') {
                localStorage.removeItem(lsKey(name));
                return true;
            }
            delete memory[name];
            return true;
        }, 'store.remove(' + name + ')', false);

        if (ok) {
            // A file we gave up writing is still a file we may be able to
            // delete, and having deleted it there is nothing left to be stale.
            // Clearing the latch here is what lets "clear the cache" recover a
            // session in which one write failed.
            delete failed[name];
            delete seen[name];
        } else {
            $.log('warn', 'could not delete ' + name + ' — it may still be on disk');
        }
        return ok;
    };

    /* =====================================================================
       Settings
       ===================================================================== */
    var DEFAULTS = {
        _schema: 5,

        ui: {
            accent: '#6c7ae0',
            // Cycling the accent is an appearance setting, so it lives with
            // the other appearance settings. Forced off at every launch — see
            // unsafeAtBoot in GigaHack_UI.js.
            accentCycle: false,
            accentCycleSpeed: 1,
            scale: 1,
            opacity: 1,
            tab: 'vars',
            sub: {},
            win: { left: 88, top: 36, width: 700, height: 520 },
            // Column widths and body-splitter positions, keyed by tab/sub.
            // They have to persist: every rerender rebuilds the table and the
            // body, so a drag that lived only in the DOM would be undone by
            // the next click on anything.
            cols: {},
            split: {},
            // Search box and filter chips on the Variables and Switches lists.
            // Closing the menu used to throw them away, which turns "find the
            // three variables I care about" into a job you redo every time.
            varFilter: {
                'var': { q: '', named: false, active: false, changed: false, pinned: false },
                'switch': { q: '', named: false, active: false, changed: false, pinned: false }
            },
            watch: { left: null, top: null, right: 14, visible: false },
            logOpen: false,
            showFps: true,
            showHud: true
        },

        behaviour: {
            readonly: false,          // §6.3 — blocks every mutating control
            confirmDangerous: true,   // §6.2
            pauseGame: false,         // explicit opt-in, consumed in SceneManager.updateMain
            swallowInput: true,       // block game input while the overlay is open
            logEveryWrite: true,
            backupBeforeDanger: true, // §6.1
            backupKeep: 20
        },

        /* Which whole sections of these settings follow the PERSON rather than
           the GAME. Only meaningful once the storage answer is 'granted' —
           there is no cross-game folder to share through until then, and
           store.sharedWhy() is the sentence that says so.

           ui and behaviour default on: the menu's size, scale, accent and how
           it behaves are about the person. hotkeys defaults OFF and the row
           says why — a hotkey default here is derived from the keys THIS game
           leaves free, and a key that is free in one game is claimed in
           another. When it is on, a shared bind is applied only where this
           game has not claimed the key, and every bind that was not applied is
           listed with its claimant. */
        storage: {
            share: { ui: true, behaviour: true, hotkeys: false }
        },

        inv: {
            maxItemsOverride: false,
            maxItems: 999
        },

        // M7 battle. Both flags persist across launches, which is the point —
        // but neither does anything until a battle actually runs, so a stale
        // one cannot strand the game the way a stuck pause could.
        battle: {
            god: false,        // party HP never drops below 1, death states ignored
            freeCost: false,   // skills cost no MP/TP, and none read as unaffordable
            // M18. Multiplies only what the PARTY deals, and only when the
            // number is damage — a negative makeDamageValue is a heal, and
            // scaling that would make every potion a full restore.
            damageMultOn: false,
            damageMult: 1,
            // HP/MP bars drawn over the enemies in the battle scene. Off at
            // boot for the same reason the event overlay is: it paints into
            // the game, so it must never be found already on.
            bars: {
                on: false,
                mp: true, values: true, name: false, showDead: false,
                height: 6, gap: 2, offset: 8, width: 0,   // width 0 = follow the sprite
                alpha: { back: 0.72, hp: 1, mp: 1, text: 1 }
            }
        },

        // M8 text. Instant text and skip-unseen are NOT here — those are the
        // game's own ConfigManager options, and keeping a second copy would
        // let the two disagree. Only what GigaHack itself adds lives here.
        text: {
            auto: false,           // pages turn themselves after autoSeconds
            autoSeconds: 1.5,      // seconds; the Text module reads this key
            turbo: true,           // hold a key to fast-forward
            turboKey: 'ControlLeft',

            // The recorded dialogue history. On by default: it costs one string
            // copy per message page, and a history that was not running when
            // the line went past is worth nothing.
            history: {
                on: true,
                max: 500,            // pages kept; the buffer is memory-only
                splitFirstLine: true // treat a short "Name:" opener as a speaker
            },

            // M18 appearance. Every one is off by default and every one is a
            // pure override of a value the engine already computes, so turning
            // it off restores exactly what the game shipped with.
            look: {
                sizeOn: false, size: 26,
                faceOn: false, face: '',
                colourOn: false, colour: '#ffffff'
            }
        },

        // M5 event overlay. `on` is deliberately false at boot: the overlay
        // draws into the game scene, so it must never be something the player
        // finds already switched on after a crash.
        events: {
            on: false,
            showLabels: true,
            showPassability: false,
            showRegions: false,
            showTransfers: true,
            showInactive: false,
            pick: true,
            // How strongly each layer of the overlay is painted. Every one is
            // a separate slider under Events -> Overlay -> Overlay look,
            // because they sit on completely different backgrounds: a region
            // tint covers whole tiles of artwork, a box outline is 1px over
            // whatever happens to be behind it.
            alpha: {
                fill: 0.22,        // event box interior
                line: 1,           // event box outline
                edge: 0.55,        // black keyline outside the box
                label: 1,          // the id/name text above each box
                transfer: 0.9,     // cyan "contains a transfer" outline
                grid: 0.5,         // passability dots
                region: 0.38       // region tint
            },
            lineWidth: 1,          // event box outline thickness, 1-4px
            dotSize: 8             // passability dot, 4-24px
        },

        // M10 player. None of these is restored onto the character at boot:
        // noclip and the speed override are read live by their hooks, and
        // opacity is deliberately absent because it lives in the save file.
        player: {
            noclip: false,
            ghost: false,
            speedOverride: false,
            speed: 4,
            mark: null,
            speedy: false,
            gameSpeed: 1,

            // Read by GigaHack_Encounters.js, which ships enabled and probes
            // the loaded maps at boot for encounter lists. A game with none
            // gets a panel that says so rather than an absent one.
            noEncounters: false,
            rateOverride: false,
            rate: 100,
            troopId: 0
        },

        // M11 save tools. quickSlot 0 means "the last slot", resolved at
        // call time so it follows DataManager.maxSavefiles rather than
        // freezing whatever it was when the settings file was written.
        save: {
            anywhere: false,
            quickSlot: 0
        },

        // M11 console. History and snippets are their own files; only
        // preferences live here.
        console: {
            captureLog: true,      // route console.* into the output while code runs
            historyMax: 100
        },

        /* ------------------------------------------------------------------
           The nine modules added after 2.0.

           Each owns one node, and each module reads its own keys through a
           local helper that supplies the default when the key is absent — so a
           module works before this block exists and this block is what makes
           "reset to defaults" and the profile export cover it. A key missing
           here is not a broken module; it is a setting a reset cannot clear.
           ------------------------------------------------------------------ */

        // M25 watchpoints, the change journal, interpreters and RNG.
        // pauseOnHit and rng.seedOn are both registered unsafeAtBoot by the
        // module: a watchpoint that held the game before the overlay exists,
        // and a seeded generator carried across a launch, are each
        // indistinguishable from the game being broken.
        trace: {
            watch: {
                enabled: true,
                pauseOnHit: false,
                logHits: true,
                captureStack: false,
                maxHits: 300,
                points: []          // the persisted watchpoint specs
            },
            journal: { max: 500, recordUnanchored: true },
            interp: { autoRefresh: true, refreshEvery: 6 },
            rng: {
                watch: false,
                sample: 1,
                maxRolls: 400,
                maxPerFrame: 2000,
                captureStack: false,
                seedOn: false,
                seed: 1
            }
        },

        // M26 what changed since the save, and between two saves.
        snapshot: {
            autoAnchor: true,
            anchorOnAutosave: false,
            namedOnly: false,
            selfMax: 20000,
            actorMax: 200,
            sort: 'by id',
            show: {
                vars: true, switches: true, self: true, gold: true, items: true,
                party: true, actors: true, map: true, system: true
            },
            diff: { a: 0, b: 0 }
        },

        // M27 why an event is locked, common events, objectives, script dump.
        quest: {
            blocked: { onlyUnmet: true, showMetPages: false, refreshFrames: 15 },
            common: {
                filter: '', trigger: 'any', gatedOnly: false,
                hideEmpty: true, selected: 0
            },
            // Grouping is INFERENCE over the project's own flag names, so every
            // threshold here is a knob rather than a constant: a game that
            // names nothing gets no quests, and that is the correct answer.
            quests: {
                groupBy: 'both', minMembers: 3, minNamed: 0.05,
                minStemTokens: 2, bulkShare: 0.25, showDone: true, filter: ''
            },
            script: {
                q: '',
                kinds: {
                    messages: true, choices: true, scrolling: true,
                    descriptions: true, terms: true, comments: false
                },
                scope: 'everything', strip: true, max: 5000, maxChars: 4000
            }
        },

        // M28 the audio the game ships, its image folders, screenshots.
        media: {
            audio: {
                recent: 200, logSe: true, restoreOnLeave: true,
                folder: 'audio/bgm', subfolders: true
            },
            assets: {
                folder: 'img/characters', recursive: true,
                charIndex: 0, direction: 2, animate: false, speed: 4, zoom: 2
            },
            capture: {
                dir: 'shots', namePrefix: 'shot',
                burst: 8, every: 6, hideOverlays: true
            }
        },

        // M29 tint, weather, zoom, shake and the picture slots.
        // Every hold.* is registered unsafeAtBoot by the module: a tint or a
        // weather effect re-applied before the player has done anything is the
        // exact symptom the panel exists to cure.
        screen: {
            duration: 0,
            fade: { frames: 30 },
            flash: { colour: '#ffffff', alpha: 160, frames: 30 },
            shake: { power: 5, speed: 5, frames: 60 },
            zoom: { frames: 0 },
            weather: { frames: 0 },
            driftFrames: 12,
            hold: { tone: false, weather: false, zoom: false },
            holdTone: [0, 0, 0, 0],
            holdWeather: { type: 'none', power: 0 },
            holdZoom: { x: 0, y: 0, scale: 1 },
            log: {
                on: true, max: 200,
                kinds: ['tint', 'fade', 'flash', 'shake', 'zoom', 'weather', 'picture']
            },
            pictures: { preview: false, filter: 'in use' },

            // The game's OWN windows, made transparent or hidden. `on` and
            // `hide` are both registered unsafeAtBoot by the module: a game
            // found with its interface already gone is indistinguishable from
            // a broken one, which is the whole reason that rule exists.
            win: {
                on: false,
                hide: false,
                scope: 'all',     // 'all' | 'message'
                frame: 255,       // opacity — the box and its plate
                back: 255,        // backOpacity — the plate alone
                contents: 255,    // contentsOpacity — the text
                dimmer: true      // the dim band, which opacity cannot reach
            }
        },
        // M30 run something when the game reaches a state; run splits.
        auto: {
            triggers: {
                on: true,
                maxPerSecond: 4,      // a trigger whose snippet moves what it watches
                maxDepth: 2,          //   would otherwise recurse until the stack ran out
                disableOnThrow: true,
                whilePaused: false,
                toastOnFire: true,
                resultMax: 400,
                historyMax: 20
            },
            route: {
                on: true,
                startOnNewGame: true,
                startOnLoad: false,
                autoBest: true,
                precision: 'cs',      // 'cs' | 's' | 'frames'; a split is RECORDED in
                jumpFrames: 300,      //   frames and only converted for display
                warnOnSpeed: true
            }
        },

        // M31 equipment loadouts and an ad-hoc shop.
        kit: {
            loadout: {
                applyClass: true, applyLevel: true, applySkills: true,
                applyParams: true, applyEquip: true,
                // Off by default: a loadout that conjures the equipment it names
                // is a different action from one that puts back what you had.
                provideMissing: false,
                force: false,
                max: 40
            },
            shop: {
                purchaseOnly: false,
                priceMode: 'database',
                priceValue: 100,
                closeOnOpen: true,
                kind: 'item'
            }
        },

        // M32 the key map the game itself reads.
        // persist is OFF by default: a rebind that survives a launch is a rebind
        // the player cannot escape by restarting, which is the one way out a
        // session-only change always leaves them.
        keys: { persist: false, reassert: false, watch: true },

        // M33 what this build costs to run, and how its plugins are configured.
        build: {
            perf: {
                sampleMs: 500,
                historyLen: 240,
                timeHooks: false,     // timing every per-frame hook costs a little itself
                series: 'frame rate',
                budgetMs: 4,
                sceneNodeCap: 20000,
                sceneDepthCap: 64
            },
            params: { q: '', filter: 'all', showEmpty: false }
        },

        // Single-key binds, matched against KeyboardEvent.code so they are
        // independent of the game's own rebindable Input.keyMapper.
        //
        // INVARIANT: no key is ours by right. The engine claims a set of keys,
        // and every game claims more through its own plugins; which ones is a
        // property of that game, not something a mod may assume. So the
        // defaults are DERIVED, never chosen — we read what is already claimed
        // and take the first free entry from a preference order. See
        // store.applyDerivedHotkeys() below.
        //
        // The letters here are the FALLBACK, used only when Input.keyMapper
        // cannot be read at all. They are also the historical 1.x defaults, so
        // a machine where the derivation cannot run behaves as it always did.
        //
        // quickLoad ships unbound on purpose, on every game: a mis-hit would
        // throw away everything since the last quick save. That is a safety
        // decision rather than a free-key one, so the derivation does not
        // override it.
        hotkeys: {
            toggleMenu: 'KeyN',
            watch: 'KeyM',
            panicHide: 'Delete',
            quickSave: 'KeyY',
            quickLoad: null,

            // The movement and encounter binds that ship unbound do so because
            // a stray press would teleport you or start a fight, not because
            // of anything about a particular game.
            noclip: 'KeyV',
            ghost: null,
            noEncounters: null,
            forceEncounter: 'KeyF',
            markPos: null,
            recallPos: null,
            godMode: 'KeyG'
        }
    };

    store.defaults = DEFAULTS;

    /* =====================================================================
       Derived hotkey defaults

       $.profile.defaultHotkeys() reads Input.keyMapper, subtracts what the
       engine and the game's plugins have claimed, and returns one free key per
       ACTION it knows about. This build's bind ids are a superset of those
       actions, so:

         · an id with a derived counterpart takes it;
         · an id without one keeps its fallback letter, and gives it up when
           that letter is claimed or a derived pick already took it. Shipping
           unbound and saying so is honest; shipping a bind that fights the
           game is not.

       This runs LATER than you would expect. Store is module 02 and Profile is
       03, so $.profile does not exist while this file is executing — the call
       below is a no-op at load time and Boot repeats it once the whole load
       order has run. Everything in between reads $.cfg.hotkeys live, so
       nothing is bound from a stale value in the meantime.
       ===================================================================== */
    var FALLBACK_HOTKEYS = $.clone(DEFAULTS.hotkeys);
    store.hotkeyFallbacks = function () { return $.clone(FALLBACK_HOTKEYS); };

    /* profile action name -> this build's bind id, for the actions that mean
       the same thing on both sides. Actions with no bind here (game speed,
       pause) simply go unused; the profile does not know what we registered. */
    var DERIVED_AS = { toggle: 'toggleMenu', quickSave: 'quickSave', noclip: 'noclip' };

    var derived = false;
    var rawSettings = null;

    /**
     * Recompute DEFAULTS.hotkeys from what this game leaves free, and fill in
     * any bind the user has never set. Returns the new default map, or null
     * when the derivation could not run (no profile yet, unreadable keyMapper)
     * — in which case the fallback letters stand.
     *
     * The shared-hotkey overlay is applied from the wrapper below rather than
     * from a second mechanism: both need the list of keys this game has
     * claimed, both are therefore no-ops at load time, and this is the one
     * function Boot already re-runs once the whole load order has gone by.
     * Derived defaults go on first and a shared bind wins over them — a shared
     * bind is a choice somebody made and a derived default is not.
     */
    function deriveHotkeys(force) {
        if (derived && !force) return null;

        // The derivation is only as good as the claim list behind it, and the
        // claim list is Input.keyMapper. Where that cannot be read there is
        // nothing to subtract, so a "derived" answer would just be the first
        // entry of every preference list dressed up as a measurement. Keep the
        // historical letters instead and say why.
        var mapperReadable = $.safe(function () {
            return typeof Input !== 'undefined' && !!Input && !!Input.keyMapper &&
                   Object.keys(Input.keyMapper).length > 0;
        }, 'keyMapper probe', false);
        if (!mapperReadable) {
            $.log('warn', 'Input.keyMapper is not readable, so which keys this game has ' +
                'already claimed cannot be established — hotkeys keep their built-in ' +
                'defaults. Rebind anything that fights the game under Settings.');
            return null;
        }

        var picks = $.safe(function () {
            return ($.profile && typeof $.profile.defaultHotkeys === 'function')
                ? $.profile.defaultHotkeys() : null;
        }, 'derive hotkey defaults', null);
        if (!picks) return null;

        var claimed = $.safe(function () {
            return ($.profile && typeof $.profile.claimedKeys === 'function')
                ? $.profile.claimedKeys() : {};
        }, 'claimed keys', {}) || {};

        derived = true;

        var next = {}, used = {}, id, action, code;

        for (action in DERIVED_AS) {
            id = DERIVED_AS[action];
            code = picks[action] || null;
            if (!code) continue;
            next[id] = code;
            used[code] = id;
        }

        for (id in FALLBACK_HOTKEYS) {
            if (next[id] !== undefined) continue;
            code = FALLBACK_HOTKEYS[id];
            if (!code) { next[id] = null; continue; }
            if (used[code] || claimed[code]) {
                next[id] = null;
                $.log('info', 'hotkey "' + id + '" ships unbound: ' + code + ' is taken by ' +
                    (used[code] ? 'the derived bind for "' + used[code] + '"' : claimed[code]) +
                    '. Bind it under Settings if you want it.');
                continue;
            }
            next[id] = code;
            used[code] = id;
        }

        DEFAULTS.hotkeys = next;

        // Only binds the stored settings file never mentioned may move. A key
        // the user chose is theirs, including one they deliberately cleared.
        var stored = (rawSettings && rawSettings.hotkeys) || {};
        var changed = [];
        if ($.cfg && $.cfg.hotkeys) {
            for (id in next) {
                if (Object.prototype.hasOwnProperty.call(stored, id)) continue;
                if ($.cfg.hotkeys[id] === next[id]) continue;
                $.cfg.hotkeys[id] = next[id];
                changed.push(id + ' -> ' + (next[id] || 'unbound'));
            }
        }
        if (changed.length) {
            $.log('info', 'hotkey defaults derived from the keys this game leaves free: ' +
                changed.join(', '));
            // First run only: persist so the derived set is stable from here,
            // rather than moving under the user if a plugin is added later.
            if (!rawSettings) store.saveSettings();
        }
        return next;
    }

    store.applyDerivedHotkeys = function (force) {
        var out = deriveHotkeys(force);
        $.safe(function () { store.applySharedHotkeys(force); }, 'apply shared hotkeys');
        return out;
    };

    store.loadSettings = function () {
        var raw = store.read(SETTINGS_FILE, null);
        rawSettings = raw;
        // No-op on the first pass — Profile loads after Store — but correct if
        // settings are ever reloaded later, and harmless either way.
        store.applyDerivedHotkeys();
        var cfg = $.deepMerge(DEFAULTS, raw || {});
        // Reset a schema we do not understand rather than half-applying it.
        if (raw && raw._schema && raw._schema > DEFAULTS._schema) {
            $.log('warn', 'settings.json was written by a newer GigaHack (schema ' +
                raw._schema + ' > ' + DEFAULTS._schema + ') — using defaults');
            cfg = JSON.parse(JSON.stringify(DEFAULTS));
        }
        migrate(cfg, raw);
        cfg._schema = DEFAULTS._schema;
        /* The shared sections go on LAST, over the game's own, and what the
           game's own were is remembered underneath — see §2.7. Nothing here
           reaches outside the game folder unless the answer is 'granted';
           store.sharedAvailable() is the one gate and it asks $.paths. */
        applySharedSections(cfg);
        $.cfg = cfg;
        $.log(raw ? 'ok' : 'info', raw ? 'settings loaded' : SETTINGS_FILE + ' not found — using defaults');
        return cfg;
    };

    /**
     * Forward migrations for settings written by an older GigaHack.
     *
     * Only corrections that a merge cannot make: deepMerge keeps the stored
     * value, which is right for a preference and wrong for a default that
     * turned out to be a bug.
     *
     * schema 1 -> 2: quick save shipped bound to F7. Function keys are not
     * free: the engine claims several outright and games routinely bind the
     * rest through their own plugins, so on many installs every quick save was
     * also firing somebody else's action. The bind is moved to the current
     * derived default, but only if it is still the old one: a user who
     * deliberately chose F7 keeps it.
     */
    function migrate(cfg, raw) {
        if (!raw) return;
        var from = Number(raw._schema) || 1;
        if (from < 5) {
            // Backlog became History when GigaHack started recording one of its
            // own. A stored sub-tab name that no longer exists sends the shell
            // back to the first panel, which reads as "it forgot where I was".
            if (cfg.ui && cfg.ui.sub && cfg.ui.sub.game === 'Backlog') cfg.ui.sub.game = 'History';
        }
        if (from < 4) {
            // The Toys panel is gone. Everything on it was decoration except
            // the accent cycling, which was never a toy — it is an appearance
            // setting, and it is one now. Carry the speed across so a chosen
            // rate survives; the on/off state is forced off at boot anyway.
            if (raw.toys && raw.toys.cycleSpeed != null) {
                cfg.ui.accentCycleSpeed = Number(raw.toys.cycleSpeed) || 1;
            }
            delete cfg.toys;
            if (cfg.ui && cfg.ui.sub && cfg.ui.sub.player === 'Toys') delete cfg.ui.sub.player;
        }
        if (from < 3) {
            // The eleven tabs became six. A stored ui.tab of 'vars' or 'forge'
            // is not a tab any more, and the shell would silently fall back to
            // the first one — which reads as "it forgot where I was" rather
            // than as a regrouping.
            var TAB_MAP = {
                party: ['player', 'Stats'], vars: ['world', 'Variables'],
                map: ['world', 'Teleport'], events: ['world', 'Events'],
                inv: ['items', 'Items'], forge: ['items', 'Forge'],
                battle: ['game', 'Enemies'], text: ['game', 'Message'],
                scene: ['player', 'Movement']
            };
            var SUB_MAP = {
                map: { Maps: 'Teleport', Bookmarks: 'Places' },
                events: { Overlay: 'Events' },
                forge: { Item: 'Forge', Skill: 'Forge', State: 'Forge', Actor: 'Forge', Enemy: 'Forge', Event: 'Forge' }
            };
            var was = cfg.ui && cfg.ui.tab;
            if (was && TAB_MAP[was]) {
                var to = TAB_MAP[was];
                cfg.ui.tab = to[0];
                if (!cfg.ui.sub) cfg.ui.sub = {};
                var oldSub = cfg.ui.sub[was];
                var mapped = (SUB_MAP[was] && SUB_MAP[was][oldSub]) || oldSub || to[1];
                cfg.ui.sub[to[0]] = mapped;
                $.log('info', 'tab "' + was + '" is now ' + to[0] + ' → ' + mapped);
            }
            // Per-tab layout memory is keyed by the old tab ids and means
            // nothing now. Dropping it beats restoring a column width onto a
            // table that is no longer there.
            if (cfg.ui) { cfg.ui.cols = {}; cfg.ui.split = {}; }
        }
        if (from < 2) {
            if (cfg.hotkeys && cfg.hotkeys.quickSave === 'F7') {
                cfg.hotkeys.quickSave = DEFAULTS.hotkeys.quickSave;
                $.log('warn', 'quick save was on F7, which collided with an engine or plugin binding — ' +
                    'reassigned to ' + (DEFAULTS.hotkeys.quickSave || 'unbound'));
            }
        }
    }

    // Exposed so a migration can be exercised against a hand-written old
    // settings file. Every schema step here has silently mangled someone's
    // settings at least once; running one in isolation beats reasoning about
    // what a load did.
    store.migrateInto = migrate;

    /**
     * Persist the settings.
     *
     * Two files where sharing is on: the per-game one always holds every
     * section in full — with this game's OWN value for anything shared, so
     * turning sharing off is a return rather than an adoption — and the shared
     * sections additionally go to the cross-game file. Both are debounced on
     * the same clock and both are committed by store.flush().
     */
    store.saveSettings = function () {
        store.save(SETTINGS_FILE, perGameSnapshot());
        queueSharedWrite();
    };

    /** Set a dotted path on $.cfg and persist. `cfgSet('ui.accent', '#fff')` */
    store.cfgSet = function (dotted, value) {
        var parts = dotted.split('.'), node = $.cfg;
        for (var i = 0; i < parts.length - 1; i++) {
            if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
            node = node[parts[i]];
        }
        node[parts[parts.length - 1]] = value;
        store.saveSettings();
        $.emit('cfg', { path: dotted, value: value });
        return value;
    };

    store.cfgGet = function (dotted, fallback) {
        var parts = dotted.split('.'), node = $.cfg;
        for (var i = 0; i < parts.length; i++) {
            if (node === null || node === undefined) return fallback;
            node = node[parts[i]];
        }
        return node === undefined ? fallback : node;
    };

    /* =====================================================================
       Read-only mode (§6.3)
       A single flag, checked inside the widget factory's change handlers, so
       no tab has to implement its own gating.
       ===================================================================== */
    $.isReadOnly = function () { return !!(($.cfg.behaviour || {}).readonly); };

    /**
     * Gate for any mutating action. Returns true when the write may proceed.
     * Refusals surface as a toast, never as a silent no-op — but a refusal
     * driven by a continuous gesture (dragging a slider fires one per
     * pointermove) must not turn into a toast storm, so identical refusals are
     * throttled. The refusal itself is never suppressed, only its notice.
     */
    var lastRefusal = { what: null, at: 0 };
    var REFUSAL_QUIET_MS = 1200;

    $.allowWrite = function (what) {
        if (!$.isReadOnly()) return true;
        var label = what || 'That change';
        var t = Date.now();
        if (lastRefusal.what !== label || t - lastRefusal.at > REFUSAL_QUIET_MS) {
            lastRefusal = { what: label, at: t };
            if ($.ui && $.ui.toast) {
                $.ui.toast({ title: 'READ-ONLY', msg: label + ' was blocked.', severity: 'warn' });
            }
            $.log('warn', 'read-only: blocked ' + label);
        }
        return false;
    };

    /* =====================================================================
       Undo stack (§6.4) — simple reversible edits only.
       Teleports, forced event runs, class changes and Forge injections are
       explicitly NOT undoable; those rely on the save backup instead.
       ===================================================================== */
    var undoStack = [];
    var UNDO_MAX = 100;

    $.undo = {
        push: function (label, revert) {
            undoStack.push({ label: label, revert: revert, t: Date.now() });
            if (undoStack.length > UNDO_MAX) undoStack.shift();
            $.emit('undo:change', undoStack.length);
        },
        pop: function () {
            var e = undoStack.pop();
            if (!e) { $.log('info', 'nothing to undo'); return false; }
            $.safe(e.revert, 'undo ' + e.label);
            $.log('ok', 'undid: ' + e.label);
            $.emit('undo:change', undoStack.length);
            return true;
        },
        peek: function () { return undoStack[undoStack.length - 1] || null; },
        size: function () { return undoStack.length; },
        clear: function () { undoStack.length = 0; $.emit('undo:change', 0); }
    };


    /* =====================================================================
       BOOT-UNSAFE SETTINGS (M16)

       Some settings paint into the game rather than into the overlay: the
       event overlay, the battle bars, the game-speed override, the three
       screen holds. Every one of them was already forced off at boot by the
       module that owns it, for the same reason each time — a persisted black
       tint or a persisted 0.25x is indistinguishable from a crash, and the
       overlay you would use to turn it off is behind it.

       Settings profiles made that a registry rather than five copies of the
       same rule: LOADING A PROFILE is a second way for one of those flags to
       arrive switched on, and it must be scrubbed exactly the same way.
       ===================================================================== */
    var unsafe = [];

    /** Declare a dotted path that must never be true at boot or after a load. */
    store.unsafeAtBoot = function (path, why) {
        for (var i = 0; i < unsafe.length; i++) if (unsafe[i].path === path) return unsafe[i];
        var e = { path: path, why: why || 'it applies before the overlay can turn it off' };
        unsafe.push(e);
        return e;
    };

    store.unsafeList = function () { return unsafe.slice(); };

    /**
     * Force every registered path false. Returns the ones that had to change,
     * so the caller can say so rather than silently rewriting the user's
     * settings.
     */
    store.scrubUnsafe = function (paths) {
        var out = [];
        unsafe.forEach(function (e) {
            if (paths && paths.indexOf(e.path) < 0) return;
            if (store.cfgGet(e.path, false)) {
                // Written straight onto $.cfg: cfgSet would save once per path
                // and emit a change per path, and the caller saves once.
                var parts = e.path.split('.'), node = $.cfg;
                for (var i = 0; i < parts.length - 1; i++) {
                    if (!node[parts[i]]) return;
                    node = node[parts[i]];
                }
                node[parts[parts.length - 1]] = false;
                out.push(e);
            }
        });
        return out;
    };


    /* =====================================================================
       SETTINGS PROFILES (M16)

       A profile is a whole snapshot of $.cfg under a name, kept in its own
       file so that losing settings.json does not take the profiles with it.
       Hotkeys, appearance and every feature flag travel together, because a
       profile that only carried some of them would be a worse answer than
       writing the settings down.

       Applying one is deliberately NOT a merge: a profile written before a
       milestone existed has no key for its settings, and merging would leave
       whatever the current session happened to have. The stored profile is
       merged over the DEFAULTS instead, so applying the same profile twice
       always lands in the same place.
       ===================================================================== */
    var PROFILE_FILE = 'profiles.json';
    var NAME_MAX = 40;

    /**
     * store.save is DEBOUNCED and returns nothing — it is built for slider
     * drags, where coalescing writes is the point. A profile write is a
     * deliberate one-off, and the very next thing that happens is a read of
     * the file that was just written, so it is committed immediately and the
     * read-back is what reports success.
     */
    function writeProfiles(raw) {
        store.save(PROFILE_FILE, raw);
        store.flush();
        var back = store.read(PROFILE_FILE, null);
        return !!(back && back.profiles);
    }

    function readProfiles() {
        var raw = store.read(PROFILE_FILE, null);
        if (!raw || typeof raw !== 'object' || !raw.profiles || typeof raw.profiles !== 'object') {
            return { _schema: 1, profiles: {} };
        }
        return raw;
    }

    store.profiles = function () {
        var raw = readProfiles();
        return Object.keys(raw.profiles).map(function (name) {
            var p = raw.profiles[name];
            return { name: name, at: p && p._at ? p._at : null, schema: p ? p._schema : null };
        }).sort(function (a, b) {
            var x = a.name.toLowerCase(), y = b.name.toLowerCase();
            return x < y ? -1 : x > y ? 1 : 0;
        });
    };

    store.profileExists = function (name) {
        return Object.prototype.hasOwnProperty.call(readProfiles().profiles, String(name));
    };

    /** Clean a user-typed name into something that can be a JSON key and a label. */
    store.profileName = function (name) {
        return String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').trim().slice(0, NAME_MAX);
    };

    store.saveProfile = function (name, stamp) {
        name = store.profileName(name);
        if (!name) return null;
        if (!$.allowWrite('save settings profile "' + name + '"')) return null;
        var raw = readProfiles();
        var snap = $.clone($.cfg);
        /* Where this machine keeps its files is not a preference and does not
           belong in something people hand each other. `storage.share` decides
           whether a section is read from the folder shared between games, and a
           profile carrying it would turn that on for somebody who never asked
           — silently changing which file their settings come from. The consent
           answer was never at risk: it lives in its own file and is not in
           $.cfg at all. */
        delete snap.storage;
        snap._at = stamp || new Date().toISOString();
        snap._schema = $.cfg._schema;
        raw.profiles[name] = snap;
        raw._schema = 1;
        if (!writeProfiles(raw)) return null;
        $.log('ok', 'settings profile "' + name + '" saved');
        return name;
    };

    /**
     * Apply a profile.
     *
     * The unsafe scrub runs on the way in for the same reason it runs at boot:
     * a profile saved while the event overlay was on would switch it back on
     * for a player who has no idea what it is. The scrub is reported rather
     * than silent, so "my profile had that on" has an answer.
     */
    store.applyProfile = function (name) {
        name = store.profileName(name);
        var raw = readProfiles();
        var snap = raw.profiles[name];
        if (!snap) { $.log('warn', 'no settings profile called "' + name + '"'); return null; }
        if (!$.allowWrite('apply settings profile "' + name + '"')) return null;

        var merged = $.deepMerge(DEFAULTS, snap);
        delete merged._at;
        merged._schema = DEFAULTS._schema;
        /* Whatever the profile says or does not say about storage, this machine
           keeps what it already had. A profile written before storage existed
           carries none and would otherwise be handed the defaults — which would
           quietly switch sharing on; one written by an older copy of this file
           carries somebody else's answer, which is worse. Neither is a
           preference the person applying the profile asked to change. */
        merged.storage = $.clone($.cfg.storage || DEFAULTS.storage);
        var before = $.cfg;
        $.cfg = merged;
        var scrubbed = store.scrubUnsafe();
        store.saveSettings();
        $.emit('cfg', { path: '*', value: null });
        $.emit('profile:applied', name);
        $.log('ok', 'settings profile "' + name + '" applied' +
            (scrubbed.length ? ' (' + scrubbed.length + ' unsafe flag(s) cleared)' : ''));
        $.undo.push('apply settings profile "' + name + '"', function () {
            $.cfg = before;
            store.saveSettings();
            $.emit('cfg', { path: '*', value: null });
        });
        return { name: name, scrubbed: scrubbed.map(function (e) { return e.path; }) };
    };

    store.deleteProfile = function (name) {
        name = store.profileName(name);
        var raw = readProfiles();
        if (!raw.profiles[name]) return false;
        if (!$.allowWrite('delete settings profile "' + name + '"')) return false;
        var gone = raw.profiles[name];
        delete raw.profiles[name];
        if (!writeProfiles(raw)) return false;
        $.undo.push('delete settings profile "' + name + '"', function () {
            var r = readProfiles();
            r.profiles[name] = gone;
            writeProfiles(r);
        });
        $.log('warn', 'settings profile "' + name + '" deleted');
        return true;
    };

    store.exportProfile = function (name) {
        var raw = readProfiles();
        var snap = raw.profiles[store.profileName(name)];
        if (!snap) return null;
        return JSON.stringify({ _gigahack: 'profile', name: store.profileName(name), cfg: snap }, null, 2);
    };

    /**
     * Import.
     *
     * Refuses anything that is not recognisably one of ours rather than
     * accepting arbitrary JSON as a settings object — a pasted fragment that
     * happened to parse would otherwise replace every setting with undefined.
     */
    store.importProfile = function (text, rename) {
        var obj = null;
        try { obj = JSON.parse(String(text)); } catch (e) {
            return { ok: false, error: 'that is not JSON: ' + e.message };
        }
        if (!obj || obj._gigahack !== 'profile' || !obj.cfg || typeof obj.cfg !== 'object') {
            return { ok: false, error: 'that is not a GigaHack settings profile' };
        }
        var name = store.profileName(rename || obj.name || 'imported');
        if (!name) return { ok: false, error: 'a profile needs a name' };
        if (!$.allowWrite('import settings profile "' + name + '"')) return { ok: false, error: 'read-only mode' };
        var replaced = store.profileExists(name);
        var raw = readProfiles();
        raw.profiles[name] = obj.cfg;
        if (!writeProfiles(raw)) return { ok: false, error: 'could not write profiles.json' };
        $.log('ok', 'settings profile "' + name + '" imported' + (replaced ? ' (replaced an existing one)' : ''));
        return { ok: true, name: name, replaced: replaced };
    };

    /* =====================================================================
       WHAT THIS STORE OWNS (§2.9)

       One list, because the migration, the storage panel and the "what is in
       this folder" readout all need the same answer and three copies of it
       would disagree inside a month.

       What can be derived is derived: the settings file and the profiles file
       are named by the constants this file already keeps, and the capture
       folder's name is read from the setting that decides it. What cannot be
       derived is declared here, on behalf of the module that writes it, and
       declareFile() is how a module states its own.

       Two entries are marked and never travel:
         · consent.json is `local` — the answer belongs to THIS game and stays
           beside it. An answer in a shared folder could reach another game,
           which is the one thing the answer exists to prevent.
         · modules.json and index.json are `transient` — both are rewritten
           from nothing at the next launch, so copying them across carries a
           stale file and nothing else.

       write-test.json is deliberately absent: it exists to prove a write
       worked and there is nothing in it worth carrying anywhere.
       ===================================================================== */
    var SETTINGS_FILE = 'settings.json';
    var FILES = [];

    function declareFile(name, what, opts) {
        opts = opts || {};
        for (var i = 0; i < FILES.length; i++) if (FILES[i].name === name) return FILES[i];
        var e = {
            name: name, what: what,
            dir: !!opts.dir, local: !!opts.local, transient: !!opts.transient,
            from: opts.from || null, by: opts.by || 'store'
        };
        FILES.push(e);
        return e;
    }

    /** A module declares a file it writes into the data directory. */
    store.declareFile = function (name, what, opts) {
        opts = opts || {};
        opts.by = opts.by || 'module';
        return declareFile(String(name), String(what || 'no description given'), opts);
    };

    /**
     * Everything the store owns, with the derivable names resolved now rather
     * than at declaration time — the capture folder is a setting and a panel
     * that printed 'shots' while the files were going somewhere else would be
     * worse than printing nothing.
     */
    store.files = function () {
        return FILES.map(function (e) {
            var out = $.clone(e);
            if (e.from) out.name = String(store.cfgGet(e.from, e.name) || e.name);
            return out;
        });
    };

    declareFile(SETTINGS_FILE, 'this game\'s settings, in full');
    declareFile(PROFILE_FILE, 'saved settings profiles');
    declareFile('consent.json', 'the storage answer for this game', { local: true });
    declareFile('snippets.json', 'console snippets');
    declareFile('console.json', 'the console history');
    declareFile('bookmarks.json', 'bookmarked places, variables and switches');
    declareFile('items.json', 'custom items, skills and states');
    declareFile('keys.json', 'the game key map this build saved');
    declareFile('kits.json', 'equipment loadouts');
    declareFile('shop.json', 'the ad-hoc shop');
    declareFile('auto-triggers.json', 'automation triggers');
    declareFile('auto-routes.json', 'automation routes');
    declareFile('history.json', 'an exported dialogue history');
    declareFile('addons.json', 'which addons are enabled in this game');
    declareFile('index.json', 'the boot index cache', { transient: true });
    declareFile('modules.json', 'the module report this launch wrote', { transient: true });
    declareFile('backups', 'save backups', { dir: true });
    declareFile('addons', 'addon files', { dir: true });
    declareFile('exports', 'saves exported out of the game', { dir: true });
    declareFile('imports', 'saves waiting to be imported', { dir: true });
    declareFile('shots', 'screenshots', { dir: true, from: 'media.capture.dir' });

    /* =====================================================================
       SETTINGS SHARED BETWEEN GAMES (§2.7)

       <sharedCommonDir>/settings.json holds whole SECTIONS of $.cfg, and
       $.cfg.storage.share says which. Three rules make it comprehensible:

       1. Load order is DEFAULTS, then this game's file, then the shared
          section over the top. A shared section is merged over DEFAULTS
          rather than over the game's own value, so applying it twice lands in
          the same place — the same reason applyProfile does not merge.

       2. The per-game file always keeps EVERY section, in full, and for a
          section that is currently shared it keeps THIS GAME'S OWN value
          rather than the overlay. That is what makes turning sharing off a
          return to where the game was, instead of a silent adoption of
          somebody else's settings that can never be undone.

       3. Every shared section records which game last wrote it, because "my
          hotkeys changed and I did not change them" is otherwise
          unattributable.

       The shared file is written with raw fs against an absolute path, not
       through store.write: the store's whole backend is relative to dataDir,
       and this file is deliberately not in it. It is debounced on the same
       clock as everything else, or one slider drag rewrites another game's
       settings sixty times a second.
       ===================================================================== */
    var SHARED_SECTIONS = ['ui', 'behaviour', 'hotkeys'];
    var COMMON_FILE = 'settings.json';
    var ownSections = {};      // section -> this game's own value, as loaded
    var sharedApplied = {};    // section -> the stamp of the game that wrote it
    var sharedHotkeys = null;  // the report applySharedHotkeys leaves behind
    var commonTimer = null;

    function commonDir() {
        var p = $.paths;
        if (p.consent !== 'granted') return null;
        if (p.mode !== 'fs' || !p.sharedCommonDir || !$.env.fs || !$.env.path) return null;
        return p.sharedCommonDir;
    }

    store.sharedAvailable = function () { return !!commonDir(); };

    /** Why there is no cross-game area, in one sentence, or '' when there is. */
    store.sharedWhy = function () {
        var p = $.paths;
        if (store.sharedAvailable()) return '';
        if (p.consent === 'moot') return p.consentWhy;
        if (p.consent !== 'granted') {
            return 'settings are shared between games through a folder outside the game, and ' + p.consentWhy;
        }
        if (p.mode !== 'fs') {
            return 'persistence is in ' + p.mode + ' mode on this build, so there is no cross-game folder ' +
                'to share through.';
        }
        return 'the cross-game folder could not be resolved from this environment.';
    };

    store.sharedFile = function () {
        var d = commonDir();
        return d ? $.env.path.join(d, COMMON_FILE) : null;
    };

    /** The sections that may be shared, and which of them are, for the panel. */
    store.sharedSections = function () {
        return SHARED_SECTIONS.map(function (s) {
            return { section: s, on: shareOn(s), wroteIt: sharedApplied[s] || null };
        });
    };

    /** Who last wrote each shared section. Empty when there is no shared area. */
    store.sharedWriters = function () {
        var common = readCommon();
        return (common && common.writers) ? $.clone(common.writers) : {};
    };

    function readCommon() {
        var file = store.sharedFile();
        if (!file) return null;
        return $.safe(function () {
            if (!$.env.fs.existsSync(file)) return null;
            var raw = $.env.fs.readFileSync(file, 'utf8');
            var obj = raw ? JSON.parse(raw) : null;
            if (!obj || typeof obj !== 'object') return null;
            if (!obj.sections || typeof obj.sections !== 'object') obj.sections = {};
            if (!obj.writers || typeof obj.writers !== 'object') obj.writers = {};
            return obj;
        }, 'read shared settings', null);
    }

    function writeCommon(obj) {
        var file = store.sharedFile();
        if (!file) return false;
        return $.safe(function () {
            $.env.fs.mkdirSync($.env.path.dirname(file), { recursive: true });
            $.env.fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
            $.log('ok', 'wrote ' + file);
            return true;
        }, 'write shared settings', false);
    }

    /* Which game wrote this. The title where Profile has resolved one and the
       storage key otherwise — a key is at least a folder the reader can go and
       look inside, which "another game" is not. */
    function writerStamp() {
        var name = $.safe(function () {
            return ($.profile && $.profile.active) ? $.profile.active().name : null;
        }, 'shared writer name', null);
        return {
            game: name || $.paths.gameKey,
            gameKey: $.paths.gameKey,
            gameId: $.paths.gameId,
            at: new Date().toISOString(),
            version: $.version
        };
    }

    function shareOnIn(cfg, section) {
        if (SHARED_SECTIONS.indexOf(section) < 0) return false;
        var s = (cfg && cfg.storage && cfg.storage.share) || DEFAULTS.storage.share;
        return s[section] === true;
    }

    function shareOn(section) {
        return store.sharedAvailable() && shareOnIn($.cfg, section);
    }
    store.isShared = shareOn;

    /**
     * Overlay the shared sections onto a freshly merged cfg, and remember what
     * this game had underneath. Called from loadSettings, on the object being
     * built, before it becomes $.cfg.
     *
     * hotkeys is skipped here on purpose: applying it needs the list of keys
     * this game has claimed, and Profile — the only thing that knows — loads
     * after this file. applySharedHotkeys does that half, from the one place
     * Boot already re-runs once the whole load order has gone by.
     */
    function applySharedSections(cfg) {
        var i, s, common;
        ownSections = {};
        sharedApplied = {};
        for (i = 0; i < SHARED_SECTIONS.length; i++) {
            s = SHARED_SECTIONS[i];
            ownSections[s] = $.clone(cfg[s]);
        }
        if (!store.sharedAvailable()) return;
        common = readCommon();
        if (!common) return;
        for (i = 0; i < SHARED_SECTIONS.length; i++) {
            s = SHARED_SECTIONS[i];
            if (s === 'hotkeys') continue;
            if (!shareOnIn(cfg, s)) continue;
            if (!common.sections[s]) continue;
            cfg[s] = $.deepMerge(DEFAULTS[s], common.sections[s]);
            sharedApplied[s] = common.writers[s] || null;
        }
    }

    /**
     * Apply the shared hotkey binds this game is allowed to take.
     *
     * A bind is skipped when THIS game has claimed the key, and the skip is
     * named with its claimant rather than silently dropped: GigaHack sees a key
     * before the game does, so a bind on a claimed key takes the game's own
     * action away, and that is a thing to be told about.
     *
     * Returns {settled, applied[], skipped[], reason}. `settled` is false when
     * the claim list could not be read yet, which is why this is safe to call
     * from load time and again from Boot.
     */
    store.applySharedHotkeys = function (force) {
        if (sharedHotkeys && sharedHotkeys.settled && !force) return sharedHotkeys;
        var out = { settled: false, applied: [], skipped: [], reason: '', wroteIt: null };
        sharedHotkeys = out;

        if (!$.cfg || !$.cfg.hotkeys) {
            out.reason = 'settings have not been loaded yet.';
            return out;
        }
        if (!store.sharedAvailable()) {
            out.settled = true;
            out.reason = store.sharedWhy();
            return out;
        }
        if (!shareOn('hotkeys')) {
            out.settled = true;
            out.reason = 'hotkeys are not shared between games. They default that way because a hotkey ' +
                'default is derived from the keys THIS game leaves free, and a key that is free in one ' +
                'game is claimed in another.';
            return out;
        }
        var common = readCommon();
        var binds = (common && common.sections) ? common.sections.hotkeys : null;
        if (!binds) {
            out.settled = true;
            out.reason = 'no game has written a shared hotkey set yet.';
            return out;
        }
        var claimed = $.safe(function () {
            return ($.profile && typeof $.profile.claimedKeys === 'function') ? $.profile.claimedKeys() : null;
        }, 'claimed keys', null);
        if (!claimed) {
            out.reason = 'which keys this game has already claimed is not known yet, so nothing shared ' +
                'has been applied. It is applied once the whole load order has run.';
            return out;   // deliberately NOT settled — Boot calls again
        }

        var id, code;
        for (id in binds) {
            code = binds[id];
            if (code && claimed[code]) {
                out.skipped.push({ id: id, code: code, claimedBy: String(claimed[code]) });
                continue;
            }
            if ($.cfg.hotkeys[id] === code) continue;
            $.cfg.hotkeys[id] = code;
            out.applied.push({ id: id, code: code });
        }
        out.settled = true;
        out.wroteIt = (common.writers && common.writers.hotkeys) || null;
        sharedApplied.hotkeys = out.wroteIt;

        if (out.applied.length) {
            $.log('info', 'shared hotkeys applied from ' + ((out.wroteIt && out.wroteIt.game) || 'another game') +
                ': ' + out.applied.map(function (a) { return a.id + ' → ' + (a.code || 'unbound'); }).join(', '));
        }
        if (out.skipped.length) {
            $.log('warn', 'a shared hotkey was not applied here because this game claims the key: ' +
                out.skipped.map(function (a) { return a.id + ' (' + a.code + ' is ' + a.claimedBy + ')'; }).join('; ') +
                '. Settings → Hotkeys lists them and lets you bind something else.');
        }
        return out;
    };

    /** The last shared-hotkey result, for the panel. Null before the first run. */
    store.sharedHotkeyReport = function () { return sharedHotkeys ? $.clone(sharedHotkeys) : null; };

    /* Debounced on the same clock as everything else. store.flush() commits it
       with the rest, which is what makes "flush, then move the directory" a
       complete instruction rather than most of one. */
    function queueSharedWrite() {
        if (!store.sharedAvailable()) return;
        if (commonTimer) clearTimeout(commonTimer);
        commonTimer = setTimeout(function () { commonTimer = null; writeSharedSections(); }, DEBOUNCE_MS);
    }

    /* Called from store.flush(). Commit, never discard: dropping the timer
       would silently lose the last edit, which is the whole reason flush means
       commit everywhere else in this file. */
    function flushSharedWrite() {
        if (!commonTimer) return false;
        clearTimeout(commonTimer);
        commonTimer = null;
        return writeSharedSections();
    }

    function writeSharedSections() {
        if (!store.sharedAvailable()) return false;
        var on = [], i, s;
        for (i = 0; i < SHARED_SECTIONS.length; i++) {
            s = SHARED_SECTIONS[i];
            if (shareOn(s)) on.push(s);
        }
        if (!on.length) return false;
        var common = readCommon() || { _schema: 1, sections: {}, writers: {} };
        var who = writerStamp(), changed = 0, next;
        for (i = 0; i < on.length; i++) {
            next = $.clone($.cfg[on[i]]);
            /* Only a section that actually differs is written, and only that
               section's stamp moves. Two modules scrub boot-unsafe flags at
               load and both save, so every launch of every game would
               otherwise re-stamp the shared set with whichever game was
               started last — and "who last wrote this" would then answer "the
               last one you opened" rather than "the one that changed it",
               which is the question the row exists for. */
            if (JSON.stringify(common.sections[on[i]]) === JSON.stringify(next)) continue;
            common.sections[on[i]] = next;
            common.writers[on[i]] = who;
            changed++;
        }
        if (!changed) return false;
        common._schema = 1;
        return writeCommon(common);
    }

    /* The per-game object, which is what settings.json always holds: every
       section, in full, with this game's own value for anything shared. */
    function perGameSnapshot() {
        var out = $.clone($.cfg), i, s;
        for (i = 0; i < SHARED_SECTIONS.length; i++) {
            s = SHARED_SECTIONS[i];
            if (shareOn(s) && ownSections[s] !== undefined) out[s] = $.clone(ownSections[s]);
        }
        return out;
    }

    /**
     * Turn sharing on or off for one section.
     *
     * On: the shared file wins if it already has that section — adopting beats
     * overwriting somebody else's settings with this game's — and is seeded
     * from this game's when it has none.
     * Off: this game's own value comes back, exactly as the per-game file has
     * been holding it all along.
     */
    store.setShared = function (section, on) {
        if (SHARED_SECTIONS.indexOf(section) < 0) {
            return { ok: false, why: '"' + section + '" is not a section that can be shared. ' +
                'The ones that can are: ' + SHARED_SECTIONS.join(', ') + '.' };
        }
        if (!$.allowWrite((on ? 'share ' : 'stop sharing ') + section + ' between games')) {
            return { ok: false, why: 'read-only mode' };
        }
        if (on && !store.sharedAvailable()) return { ok: false, why: store.sharedWhy() };

        if (!$.cfg.storage) $.cfg.storage = $.clone(DEFAULTS.storage);
        if (!$.cfg.storage.share) $.cfg.storage.share = $.clone(DEFAULTS.storage.share);
        $.cfg.storage.share[section] = !!on;

        var out = { ok: true, section: section, on: !!on, adopted: false, why: '' };

        if (on) {
            /* THE MOMENT THE GAME'S OWN VALUE STOPS BEING LIVE IS THIS ONE, and
               it is where the snapshot has to be taken. ownSections is written
               in exactly one other place — applySharedSections, i.e. once per
               loadSettings — so while a section was unshared it held the
               LOAD-TIME value while every edit went to $.cfg and to the
               per-game file. Turning sharing on then made the very next
               perGameSnapshot write that stale value back over the per-game
               file, and turning sharing off restored it: the edit was gone from
               memory and from disk, while the panel said "this game's own is
               still in its settings file and comes back if you turn this off".
               (A share flag cannot arrive from a settings profile — applyProfile
               keeps this machine's own storage section for exactly that reason —
               so this and the load are the only two moments there are.) */
            ownSections[section] = $.clone($.cfg[section]);
            var common = readCommon();
            var have = common && common.sections ? common.sections[section] : null;
            if (have && section !== 'hotkeys') {
                $.cfg[section] = $.deepMerge(DEFAULTS[section], have);
                sharedApplied[section] = (common.writers && common.writers[section]) || null;
                out.adopted = true;
                out.why = 'the shared set already had ' + section + ', last written by ' +
                    ((sharedApplied[section] && sharedApplied[section].game) || 'another game') +
                    ', and that is what is now in use here. This game\'s own ' + section +
                    ' is still in its settings file and comes back if you turn this off.';
            } else if (section === 'hotkeys') {
                sharedHotkeys = null;
                var rep = store.applySharedHotkeys(true);
                out.adopted = rep.applied.length > 0;
                out.why = rep.reason || (rep.applied.length + ' bind(s) applied, ' + rep.skipped.length +
                    ' not applied because this game claims the key.');
            } else {
                out.why = 'the shared set had no ' + section + ' yet, so this game\'s was written into it.';
            }
        } else {
            if (ownSections[section] !== undefined) $.cfg[section] = $.clone(ownSections[section]);
            delete sharedApplied[section];
            if (section === 'hotkeys') sharedHotkeys = null;
            out.why = section + ' is this game\'s own again, exactly as its settings file has been ' +
                'keeping it. The shared copy is untouched.';
        }

        store.saveSettings();
        store.flush();
        $.emit('cfg', { path: 'storage.share.' + section, value: !!on });
        $.emit('shared:changed', { section: section, on: !!on });
        $.log('ok', 'settings sharing: ' + section + ' is ' + (on ? 'on' : 'off') + ' — ' + out.why);
        return out;
    };

    /* =====================================================================
       MOVING THE FILES (§2.6)

       Copies, keeps, never deletes. The four rules are the whole design:

         · a FILE that already exists at the destination is KEPT and said so,
           per file, nested ones included. A merge nobody asked for is worse
           than a stated skip. A DIRECTORY of the same name is descended into
           rather than skipped, because a folder at the destination says
           nothing about what is inside it.
         · nothing is deleted. "Remove the old copy" is store.dropSource, a
           separate and explicitly-labelled act on exactly the files that were
           copied.
         · pending debounced writes are committed FIRST, or the last slider
           drag lands in the directory that was just abandoned.
         · BOTH directions need the answer. Copying out of the shared folder
           reads it, and reading it is the act the question is about.

       The tree walk is bounded and says so when it stops early, the same
       contract every other walk in this codebase carries.
       ===================================================================== */
    var COPY_CAP = 4000;
    var COPY_DEPTH = 4;
    /* How many nested "already there" files one directory entry may name in the
       report before it summarises the rest. The walk itself is bounded at
       COPY_CAP and the report has to be bounded too: re-running a migration
       over a full backups folder would otherwise put four thousand rows in a
       table somebody is trying to read. The count is never rounded off — the
       summarising row says exactly how many it stands for. */
    var KEPT_ROWS = 40;

    function isDirectory(p) {
        return $.safe(function () {
            var st = $.env.fs.statSync(p);
            return !!(st && st.isDirectory && st.isDirectory());
        }, 'stat ' + p, false);
    }

    /* Why a file already at the destination is kept. Said in one place because
       it is said in three: the top-level entries, the nested ones, and the
       panel's report table, which prints this string verbatim. */
    var KEPT_WHY = 'the destination already has one and it is kept. Nothing here merges two ' +
        'versions of a file: a merge nobody asked for is worse than a stated skip.';

    /* Two directories of the same name are the ONE case where the walk goes on.
       A folder at the destination says nothing about what is inside it, and
       every other kind of collision — a file over a file, a file over a folder —
       is kept, unmerged, and named.

       Both the top-level test and this one were once a bare existsSync, so a
       destination holding an empty `backups/` hid every save backup in the
       source: the whole tree was reported "kept — the destination already has
       one", the source-only files were never copied and never mentioned, and
       every later attempt reported the same thing. A half-finished migration
       was permanently un-completable and read as done, for the one kind of file
       this module's own comments call unregenerable. */
    function mergeableDirs(src, dst) {
        return isDirectory(src) && isDirectory(dst);
    }

    /* The destination path as a report row's name: 'backups/slotA/a.rmmzsave'
       rather than the absolute path, which the row already carries in `at`. */
    function relName(root, file) {
        var path = $.env.path, r = String(root), f = String(file);
        if (!path || !root) return f;
        return f.indexOf(r + path.sep) === 0 ? f.slice(r.length + 1) : f;
    }

    /* Is this path at or under $.paths.sharedRoot — the area the question is
       about? A resolved-prefix test rather than path.relative, which behaves
       differently across the environments a check can hand us. */
    function underSharedRoot(file) {
        var p = $.paths, path = $.env.path, root, f;
        if (!p.sharedRoot || !path || !file) return false;
        root = $.safe(function () { return path.resolve(p.sharedRoot); },
            'resolve the shared root', String(p.sharedRoot));
        f = $.safe(function () { return path.resolve(file); }, 'resolve ' + file, String(file));
        return f === root || f.indexOf(root + path.sep) === 0;
    }

    function copyTree(src, dst, state) {
        var fs = $.env.fs, path = $.env.path, names, i, s, d;
        if (state.left <= 0) {
            state.complete = false;
            state.why = 'the copy stopped at ' + COPY_CAP + ' files; the rest are still in ' + state.from + '.';
            return;
        }
        if (!isDirectory(src)) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            state.left--;
            state.pairs.push({ from: src, to: dst });
            return;
        }
        if (state.depth >= COPY_DEPTH) {
            state.complete = false;
            state.why = 'the copy stopped ' + COPY_DEPTH + ' directories deep; anything below that is ' +
                'still in ' + src + '.';
            return;
        }
        fs.mkdirSync(dst, { recursive: true });
        names = fs.readdirSync(src);
        state.depth++;
        for (i = 0; i < names.length; i++) {
            s = path.join(src, names[i]);
            d = path.join(dst, names[i]);
            if (fs.existsSync(d) && !mergeableDirs(s, d)) { state.kept.push(d); continue; }
            copyTree(s, d, state);
            if (state.left <= 0) break;
        }
        state.depth--;
    }

    /**
     * Move the store's files between the two locations.
     *
     *   store.moveTo('shared')  <localDir> -> <sharedDir>   (needs 'granted')
     *   store.moveTo('local')   <sharedDir> -> <localDir>   (needs 'granted' too:
     *                                                        it READS that folder)
     *
     * Returns {ok, from, to, copied[], kept[], failed[], pairs[], complete,
     * why}. Every absolute path is logged. Nothing in the source is removed.
     */
    store.moveTo = function (target) {
        var p = $.paths, fs = $.env.fs, path = $.env.path;
        var out = {
            ok: false, from: null, to: null, copied: [], kept: [], failed: [],
            pairs: [], complete: true, why: ''
        };

        if (target !== 'shared' && target !== 'local') {
            out.why = '"' + target + '" is not a destination: it is "shared" or "local".';
            return out;
        }
        if (p.mode !== 'fs' || !fs || !path) {
            out.why = 'persistence is in ' + p.mode + ' mode here, so there are no directories to move ' +
                'anything between. ' + ($.caps.fsWhy || '');
            return out;
        }
        /* The gate is ABOVE the branch, not inside it. It was written inside
           the 'shared' branch only, so moveTo('local') existsSync-ed,
           statSync-ed and copyFileSync-read the whole file list OUT of the
           shared folder with the answer still 'unasked' — and store.dropSource
           then unlinked there. Reading that folder is the act the question is
           about, and it does not become a different act because the copy is
           going the other way. */
        if (p.consent !== 'granted') {
            out.why = p.consent === 'moot' ? p.consentWhy
                : 'the shared folder needs an answer that has not been given (' + p.consent +
                  '), and that is the same refusal in both directions: copying files back OUT of ' +
                  'that folder reads it, which is the act the question is about. Settings → Storage ' +
                  'asks the question — answer yes there, copy, then answer no again if that is what ' +
                  'you want. Nothing is deleted by any of the three.';
            return out;
        }
        if (target === 'shared') {
            out.from = p.localDir; out.to = p.sharedDir;
        } else {
            out.from = p.sharedDir; out.to = p.localDir;
        }
        if (!out.from || !out.to) {
            out.why = 'one of the two locations could not be resolved on this build ' +
                '(beside the game: ' + (p.localDir || 'unknown') + ', shared: ' + (p.sharedDir || 'unknown') + ').';
            return out;
        }
        if (out.from === out.to) {
            out.why = 'both locations resolve to the same directory, so there is nothing to move.';
            return out;
        }
        if (!$.allowWrite('move GigaHack\'s files to ' + out.to)) {
            out.why = 'read-only mode';
            return out;
        }

        /* First, and not negotiably: a debounced write in flight resolves its
           path at fire time, so anything still pending would land in whichever
           directory the paths happen to name 250ms from now. */
        store.flush();

        var list = store.files(), i, e, src, dst, state, ok;
        for (i = 0; i < list.length; i++) {
            e = list[i];
            if (e.local) {
                out.kept.push({ name: e.name, at: path.join(out.from, e.name),
                    why: 'it is this game\'s own answer and it stays beside this game: an answer in a ' +
                        'shared folder could reach another game.' });
                continue;
            }
            if (e.transient) {
                out.kept.push({ name: e.name, at: path.join(out.from, e.name),
                    why: 'it is rebuilt from nothing at the next launch, so a copy would only ever be stale.' });
                continue;
            }
            src = path.join(out.from, e.name);
            dst = path.join(out.to, e.name);
            if (!$.safe(function () { return fs.existsSync(src); }, 'exists ' + src, false)) continue;
            /* A directory entry whose destination is also a directory is walked
               rather than skipped — see mergeableDirs. Everything else that is
               already there is kept, exactly as before. */
            if ($.safe(function () { return fs.existsSync(dst); }, 'exists ' + dst, false) &&
                !mergeableDirs(src, dst)) {
                out.kept.push({ name: e.name, at: dst, why: KEPT_WHY });
                continue;
            }
            state = { left: COPY_CAP, depth: 0, pairs: [], kept: [], complete: true, why: '', from: out.from };
            ok = $.safe(function () { copyTree(src, dst, state); return true; }, 'copy ' + src, false);
            if (!ok) {
                out.failed.push({ name: e.name, from: src, to: dst,
                    why: 'the copy threw; the original is untouched in ' + src + '.' });
                continue;
            }
            if (!state.complete) { out.complete = false; if (!out.why) out.why = state.why; }
            /* Every nested skip is a report row. The walk has always collected
               them and the caller has always thrown them away, which made a
               partial directory copy indistinguishable from a complete one. */
            state.kept.forEach(function (at, n) {
                if (n < KEPT_ROWS) out.kept.push({ name: relName(out.to, at), at: at, why: KEPT_WHY });
            });
            if (state.kept.length > KEPT_ROWS) {
                out.kept.push({ name: e.name, at: dst,
                    why: (state.kept.length - KEPT_ROWS) + ' more file(s) under this directory were ' +
                        'already at the destination and are kept, on top of the ' + KEPT_ROWS +
                        ' named above. Nothing was merged and nothing was deleted.' });
            }
            /* A walk that copied nothing because the destination already had
               every file is not a copy, and a row saying "copied, 0 files"
               beside N kept rows says the opposite of what happened. */
            if (state.pairs.length) {
                out.copied.push({ name: e.name, from: src, to: dst, files: state.pairs.length });
                out.pairs = out.pairs.concat(state.pairs);
            }
            $.log('ok', 'copied ' + src + ' → ' + dst + ' (' + state.pairs.length + ' file(s)' +
                (state.kept.length ? ', ' + state.kept.length + ' already there' : '') + ')');
        }

        out.ok = out.failed.length === 0;
        out.kept.forEach(function (k) { $.log('info', 'kept ' + k.at + ' — ' + k.why); });
        out.failed.forEach(function (f) { $.log('err', 'could not copy ' + f.from + ' — ' + f.why); });
        $.log(out.ok ? 'ok' : 'warn', 'move to ' + out.to + ': ' + out.copied.length + ' copied, ' +
            out.kept.length + ' kept, ' + out.failed.length + ' failed. Nothing was deleted from ' +
            out.from + '.');
        return out;
    };

    /**
     * Delete exactly the files a move copied, from exactly where it copied them
     * from. This is "remove the old copy", it is a separate act, and it takes
     * the result object so it can only ever touch files that verifiably arrived
     * somewhere else.
     *
     * Directories are left behind even when they end up empty: removing a
     * directory is a different and much less recoverable act than removing a
     * file this function has just proved is duplicated.
     */
    store.dropSource = function (result) {
        var fs = $.env.fs, out = { ok: false, removed: [], failed: [], why: '' };
        if (!result || !result.pairs || !result.pairs.length) {
            out.why = 'that move copied nothing, so there is no old copy to remove.';
            return out;
        }
        if (!fs) { out.why = 'there is no filesystem here.'; return out; }
        /* The same gate the move carries, because this is the half that
           deletes. A result object outlives the answer that produced it — the
           panel drops its report on 'paths:changed' but this function is
           public — and unlinking inside a folder the answer no longer covers
           is the worst version of the act the question is about. */
        if ($.paths.consent !== 'granted' &&
            result.pairs.some(function (pair) { return underSharedRoot(pair.from); })) {
            out.why = 'those files are in ' + ($.paths.sharedRoot || 'the shared folder') +
                ', and the answer for this game is "' + $.paths.consent + '". Nothing is read from ' +
                'or deleted in that folder without a yes. Settings → Storage asks the question.';
            return out;
        }
        if (!$.allowWrite('remove the files that were copied out of ' + result.from)) {
            out.why = 'read-only mode';
            return out;
        }
        result.pairs.forEach(function (pair) {
            var gone = $.safe(function () {
                if (!fs.existsSync(pair.to)) return false;   // never delete a source with no copy
                if (fs.existsSync(pair.from)) fs.unlinkSync(pair.from);
                return true;
            }, 'remove ' + pair.from, false);
            if (gone) { out.removed.push(pair.from); $.log('ok', 'deleted ' + pair.from); }
            else out.failed.push(pair.from);
        });
        out.ok = out.failed.length === 0;
        $.log(out.ok ? 'ok' : 'warn', 'old copy: ' + out.removed.length + ' file(s) removed, ' +
            out.failed.length + ' left in place. Empty directories are left where they are.');
        return out;
    };

    /* =====================================================================
       ANSWERING THE STORAGE QUESTION (§2.5, §2.8)

       Three one-call answers, so that the ordering — flush, record, re-resolve,
       clear the write latches, then look — lives here rather than in whichever
       panel is asking.

       All three go through the same settling step, and that is the point of
       this section rather than an implementation detail. Every answer can move
       dataDir, and the moment it does, ONE of the two settings files is the one
       in force and the other is not. Boot's 'paths:changed' cascade
       deliberately does not re-read settings — "whoever moved the directory has
       already dealt with them" — and only granting ever had. Declining
       after granting left $.cfg holding the SHARED folder's settings while
       dataDir pointed beside the game, so the next act as ordinary as switching
       a tab wrote the shared folder's settings over the game's own file, with
       no log line, no toast and no note.
       ===================================================================== */

    /* What the overlay is wearing, as opposed to what $.cfg says it should be.
       Read either side of an adopt: these four are the settings that live
       somewhere other than $.cfg once they are on screen. */
    function lookOf() {
        var ui = $.cfg.ui || {}, be = $.cfg.behaviour || {};
        return { accent: ui.accent, scale: ui.scale, opacity: ui.opacity, readonly: !!be.readonly };
    }

    /**
     * Put an adopted look on screen, and say what it changed.
     *
     * $.cfg is not the menu: accent, scale and opacity are CSS custom
     * properties on the host and read-only is a class on it, and nothing in the
     * mod re-reads any of the four from a settings load. The only repaint in
     * the answer sequence is Boot's rerender on 'paths:changed', which fires
     * from inside $.setConsent — BEFORE the adopt — and writes none of them.
     *
     * The sharing toggle already does this for one section, with a comment
     * saying that without it "the overlay keeps its old look until the next
     * launch and the toggle reads as broken". A whole settings file has the
     * same hazard and a worse one: read-only can come on with no badge, and
     * every mutating control then refuses with a toast for which the panel
     * shows no standing reason.
     */
    function applyLook(before) {
        var now = lookOf(), changed = [];
        if (before.accent !== now.accent) changed.push('the accent colour');
        if (before.scale !== now.scale) changed.push('the menu scale');
        if (before.opacity !== now.opacity) changed.push('the opacity');
        if (before.readonly !== now.readonly) {
            changed.push(now.readonly ? 'read-only mode, which is now ON' : 'read-only mode, which is now off');
        }
        if (!changed.length) return changed;
        /* No overlay means nothing is on screen to be wrong about, so nothing
           is claimed either. */
        if (!$.ui || !$.ui.apply) return [];
        $.safe(function () {
            $.ui.apply({
                accent: now.accent, scale: now.scale, opacity: now.opacity, readonly: now.readonly
            });
            if ($.ui.rerender) $.ui.rerender();
        }, 'apply the settings the answer adopted');
        return changed;
    }

    /**
     * The settings half of an answer: adopt what the directory now in force
     * already has, or seed it from what is in use when it has nothing.
     *
     * Never a merge and never an overwrite, in either direction — the same
     * rule the file migration follows, for the same reason. Both absolute
     * paths are named, because "which of my two settings files am I using now"
     * has to have an answer.
     */
    function settleSettings(was, answer) {
        var out = { moved: false, adopted: false, applied: [], why: '' };
        if ($.paths.dataDir === was) {
            out.why = 'the data directory did not move, so the settings in use are the file they were ' +
                'already in' + (was ? ' (' + was + ')' : '') + '.';
            return out;
        }
        out.moved = true;
        var before = lookOf();
        if ($.paths.mode === 'fs' && store.exists(SETTINGS_FILE)) {
            store.loadSettings();
            $.emit('cfg', { path: '*', value: null });
            out.adopted = true;
            out.why = 'settings were already in ' + $.paths.dataDir +
                (answer === 'granted' ? ', from a build that put them there without asking,' : '') +
                ' and those are the ones now in use. The copy in ' + (was || 'its old place') +
                ' is still there and nothing has overwritten it.';
            out.applied = applyLook(before);
            if (out.applied.length) {
                out.why += ' That file also changed ' + out.applied.join(', ') +
                    ', and the menu has been repainted to match.';
            }
        } else {
            store.saveSettings();
            store.flush();
            out.why = ($.paths.dataDir || 'the directory now in use') + ' had no settings of its own, ' +
                'so the ones already in use were written into it. ' + (was || 'the old directory') +
                ' still has its own copy and nothing has overwritten it.';
        }
        return out;
    }

    /* Record the answer, then settle the settings under it. The toast is only
       raised when the settling had something to say the caller's own toast
       cannot: both the card and the Storage panel already say where the files
       are going, and two toasts that say the same thing teach the reader to
       dismiss both. */
    function answerAndSettle(answer, opts) {
        opts = opts || {};
        var was = $.paths.dataDir;
        var r = $.setConsent(answer, opts.consent);
        if (!r.ok) {
            return { ok: false, why: r.why, answer: r.answer, was: was, dataDir: was,
                moved: false, adopted: false, applied: [] };
        }
        var s = settleSettings(was, answer);
        var out = {
            ok: true, answer: r.answer, from: r.from, where: r.where,
            was: was, dataDir: $.paths.dataDir,
            moved: s.moved, adopted: s.adopted, applied: s.applied,
            why: s.why + (r.why ? ' ' + r.why : '')
        };
        $.log('ok', 'storage: using ' + ($.paths.dataDir || $.paths.mode) + ' — ' + out.why);
        if (s.moved && $.ui && $.ui.toast) {
            $.ui.toast({
                title: s.adopted ? 'ADOPTED' : (opts.title || 'SETTINGS'),
                msg: out.why, severity: 'info'
            });
        }
        return out;
    }

    /**
     * Yes.
     *
     * §2.5 is the honest part. Everyone upgrading from 2.1.0 has settings in
     * the shared folder already, written without being asked, and the mod does
     * NOT look there to find out whether they exist: that read is the thing
     * being asked about. The first look happens here, after the answer, and
     * what is found is ADOPTED rather than overwritten with whatever
     * accumulated beside the game.
     */
    store.grantStorage = function () {
        if (!$.allowWrite('allow GigaHack a folder of its own outside the game')) {
            return { ok: false, why: 'read-only mode', answer: $.paths.consent };
        }
        return answerAndSettle('granted', { title: 'SHARED FOLDER' });
    };

    /**
     * No. Deliberately NOT gated on read-only mode: refusing to record a
     * refusal because the mod is in read-only mode would be the wrong way
     * round, and the record is written beside the game either way.
     *
     * Symmetric with grant, and it has to be — see the settling step above.
     */
    store.declineStorage = function () {
        return answerAndSettle('declined', { title: 'BESIDE THE GAME' });
    };

    /** Ask me again next launch. The card goes away for this launch only. */
    store.deferStorage = function () {
        return answerAndSettle('unasked', { consent: { defer: true }, title: 'BESIDE THE GAME' });
    };

    /* Load settings immediately — the shell needs them to build the window. */
    store.loadSettings();

})(window.GigaHack);
