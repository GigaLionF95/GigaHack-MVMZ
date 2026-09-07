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

    function lsKey(name) { return 'gigahack:' + name; }

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
            pictures: { preview: false, filter: 'in use' }
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
     */
    store.applyDerivedHotkeys = function (force) {
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
    };

    store.loadSettings = function () {
        var raw = store.read('settings.json', null);
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
        $.cfg = cfg;
        $.log(raw ? 'ok' : 'info', raw ? 'settings loaded' : 'settings.json not found — using defaults');
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

    store.saveSettings = function () {
        store.save('settings.json', $.cfg);
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

    /* Load settings immediately — the shell needs them to build the window. */
    store.loadSettings();

})(window.GigaHack);
