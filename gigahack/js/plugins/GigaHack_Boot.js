//=============================================================================
// GigaHack MV/MZ
// 25 · boot.js — boot report, overlay mount, index kick-off, self-test wiring
//-----------------------------------------------------------------------------
// This file must load last, because GigaHack's aliases only sit outermost if
// nothing installs its own on top of them afterwards.
//
// That is no longer guaranteed by construction. A mod loader appends our
// scripts after everything in js/plugins.js and the property holds for free;
// on a plain install it holds only if the installer put our entry at the end
// of js/plugins.js, and a game update that rewrites that file can undo it
// silently. So it is not assumed — $.compat.loadOrder() checks at runtime,
// names every plugin that loaded after us, and says what to do about it. The
// boot report below is where that answer is printed.
//
// Nothing here may assume $data* or $game* exist yet: on both engines this
// file runs while the database is still loading. Everything that needs data
// hangs off an engine hook and fires when the data is actually there —
// the index off the boot scene, the full self-test off the first game world.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — bootstrap
 * @author gigahack
 * @help GigaHack_Boot.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat and Index. Loads last.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.mount) { console.error('[GigaHack] shell missing — boot aborted'); return; }

    var U = $.ui;

    /* ---------------------------------------------------------------------
       Default watch provider, registered at the lowest priority: any module
       with something better to show (pinned variables) wins automatically.
       Every reader is guarded, because each of these objects is absent on the
       title screen and this runs on a clock that does not care.
       ------------------------------------------------------------------ */
    function defaultWatch() {
        var out = [];
        var g = function (label, fn) {
            var v = $.safe(fn, 'watch ' + label, null);
            if (v !== null && v !== undefined) out.push({ label: label, value: v });
        };
        g('map', function () { return $gameMap && $gameMap.mapId() ? $gameMap.mapId() : '—'; });
        g('x,y', function () { return $gamePlayer ? $gamePlayer.x + ',' + $gamePlayer.y : '—'; });
        g('gold', function () { return $gameParty ? $gameParty.gold() : '—'; });
        g('party', function () { return $gameParty ? $gameParty.members().length : '—'; });
        g('scene', function () { return SceneManager._scene ? SceneManager._scene.constructor.name.replace('Scene_', '') : '—'; });
        return out;
    }

    /* ---------------------------------------------------------------------
       Run a job off the boot path.

       Everything below is triggered from an engine hook, and an engine hook is
       the game's frame budget. Handing the work to the idle queue (or the next
       timer tick where there is none) means a slow disk or a large database
       shows up as a slightly later index, never as a hitch in the boot scene.
       ------------------------------------------------------------------ */
    function soon(label, fn) {
        var run = function () { $.safe(fn, label); };
        if ($.caps.idleCallback) {
            try { window.requestIdleCallback(run, { timeout: 2000 }); return; } catch (e) { }
        }
        setTimeout(run, 0);
    }

    /* ---------------------------------------------------------------------
       1-2. The boot report

       Printed before anything else runs, and printed unconditionally. This is
       the artefact that turns "it doesn't work on my game" into a paste: the
       engine and its capabilities, then which profile answered for this game.
       The logger buffers until the drawer exists, so all of it is still there
       to be read inside the overlay once it mounts.
       ------------------------------------------------------------------ */
    function bootReport() {
        // Guarded individually: a missing capability table is itself the most
        // useful line in the report, and must not take the rest of it down.
        $.safe(function () {
            $.log('info', 'environment:\n' + $.caps.reportText());
        }, 'capability report');
        $.safe(function () {
            $.log('info', 'paths:\n' + $.describePaths());
        }, 'path report');

        var prof = $.safe(function () { return $.profile.active(); }, 'profile resolve', null);
        if (!prof) {
            $.log('warn', 'no profile could be resolved — every per-game value falls back ' +
                'to what can be computed from the loaded database.');
            return;
        }
        // Resolution before the database has loaded is provisional by design:
        // Profile refuses to cache one built without $dataSystem, and re-runs
        // itself from DataManager.onLoad. Say which of the two this is.
        var provisional = !prof.title;
        $.log(prof.generic ? 'info' : 'ok',
            'profile: ' + prof.id + ' (' + prof.name + ')' +
            (prof.generic ? ' — computed defaults, no profile is needed for this game' : '') +
            (provisional ? ' [provisional: the database is still loading]' : ''));
        (prof.notes || []).forEach(function (n) { $.log('info', 'profile note: ' + n); });
    }

    /* ---------------------------------------------------------------------
       4. The index, once the database is really loaded.

       Scene_Boot.start is the first moment at which every $data* file is
       present — DataManager.isDatabaseLoaded() gates the scene's own create —
       and it happens exactly once per launch, which DataManager.onLoad does
       not. The build itself is chunked, so all this has to do is call it at
       the right moment and stay off the frame that called it.
       ------------------------------------------------------------------ */
    function wireIndex() {
        if (!$.index || typeof $.index.build !== 'function') {
            $.log('warn', 'index module absent — search falls back to scanning live data');
            return;
        }
        var kicked = false;
        function kick(why) {
            if (kicked) return;
            kicked = true;
            soon('index build', function () {
                $.log('info', 'index: building (' + why + ')');
                $.index.build();
            });
        }

        var ok = $.install('Scene_Boot.start (index)',
            typeof Scene_Boot !== 'undefined' ? Scene_Boot.prototype : null, 'start',
            function (original) {
                return function () {
                    var r = original.apply(this, arguments);
                    kick('the boot scene started');
                    return r;
                };
            },
            'Scene_Boot.start not found — the index will be kicked from DataManager.onLoad instead');

        if (ok) return;

        // Fallback for a build with no Scene_Boot we can reach: watch the data
        // loader instead and go as soon as $dataSystem lands. build() checks
        // for itself that the files it needs are present, so an early call is
        // a no-op rather than a half-built index.
        $.install('DataManager.onLoad (index)',
            typeof DataManager !== 'undefined' ? DataManager : null, 'onLoad',
            function (original) {
                return function (object) {
                    var r = original.apply(this, arguments);
                    if (typeof $dataSystem !== 'undefined' && object === $dataSystem) {
                        kick('the database finished loading');
                    }
                    return r;
                };
            },
            'neither Scene_Boot.start nor DataManager.onLoad is available — ' +
            'the index must be built by hand with GigaHack.api.reindex()');
    }

    /* ---------------------------------------------------------------------
       5. The full self-test, the first time a game world exists.

       The non-destructive checks already ran in bootCheck(). The rest need
       $gameVariables, $gameParty and friends, and there are exactly two ways
       those come into being: a new game, or a save being read back. Hooking
       both is narrower than hooking Scene_Map.start, which fires on every map
       change for the whole session.

       maybeFullRun() self-guards against running twice, so hooking both is
       safe. It is deferred off the hook because the tests write sentinels into
       the game and read them back, and doing that inside the call that is
       still assembling the game objects is asking for a half-built world.
       ------------------------------------------------------------------ */
    function wireSelfTest() {
        if (!$.compat || typeof $.compat.maybeFullRun !== 'function') {
            $.log('warn', 'compat module absent — no self-test will run');
            return;
        }
        // maybeFullRun() self-guards, but scheduling is guarded here too: both
        // hooks fire again on every later load, and without this each one would
        // queue a job and print a line to say it had nothing to do.
        var scheduled = false;
        function later(why) {
            if (scheduled) return;
            scheduled = true;
            soon('full self-test', function () {
                $.log('info', 'self-test: a game world exists (' + why + ')');
                $.compat.maybeFullRun();
            });
        }
        function hook(label, method, why) {
            $.install(label, typeof DataManager !== 'undefined' ? DataManager : null, method,
                function (original) {
                    return function () {
                        var r = original.apply(this, arguments);
                        later(why);
                        return r;
                    };
                },
                'DataManager.' + method + ' not found — the self-test will wait for the other trigger');
        }
        hook('DataManager.setupNewGame (self-test)', 'setupNewGame', 'a new game was started');
        hook('DataManager.extractSaveContents (self-test)', 'extractSaveContents', 'a save was loaded');
    }

    /* ---------------------------------------------------------------------
       Boot, in the order the port brief sets out.
       ------------------------------------------------------------------ */
    function boot() {
        bootReport();

        // Hotkey defaults are derived from the keys this game leaves free, and
        // the derivation needs Profile — which loads after Store, so Store's
        // own attempt at load time was a no-op. This is the first point at
        // which the whole load order has run. It must happen before the shell
        // builds its title bar and footer, which print the bindings.
        $.safe(function () {
            if ($.store && $.store.applyDerivedHotkeys) $.store.applyDerivedHotkeys();
        }, 'derive hotkeys');

        // Mounting may have to wait for the engine to finish building its own
        // DOM — see the shell. Everything that needs the host goes in here.
        U.mount(function (host) {
            if (!host) { $.log('err', 'overlay failed to mount — GigaHack is inert'); return; }

            U.addWatchProvider(defaultWatch, 0);

            // Repaint the watch panel on the shell clock, but only while visible.
            $.onFrame('watch repaint', function (n) {
                if (n % 6 !== 0) return;              // ~10×/second at 60fps
                if (!U.isWatchOpen()) return;
                if (host.watchPaint) host.watchPaint();
            });

            var rep = $.pluginReport();
            if (rep) {
                $.log('info', 'game loaded ' + rep.enabled + '/' + rep.total + ' plugins');
                rep.warnings.forEach(function (w) { $.log('warn', 'compat: ' + w); });
            }

            $.log('ok', $.codename + ' v' + $.version + ' ready');
        });

        wireIndex();
        wireSelfTest();

        // 3. Load order, alias snapshot, framework fingerprints and the checks
        //    that need no game world.
        //
        //    LAST, and the ordering is load-bearing. The snapshot is what
        //    "has anything patched on top of us?" is measured against, so it
        //    has to be taken once EVERY GigaHack hook is in place — the
        //    shell's, from the mount request above, and the two that
        //    wireIndex/wireSelfTest install. Both of those land on methods
        //    another module has already hooked (Scene_Boot.start, which Forge,
        //    Gallery and Steam also alias; DataManager.extractSaveContents,
        //    which Forge aliases), so snapshotting before them recorded a
        //    value that was superseded moments later and alias integrity then
        //    reported four of our own hooks as over-patched on a clean
        //    install, every launch.
        $.safe(function () {
            if ($.compat && $.compat.bootCheck) $.compat.bootCheck();
            else $.log('warn', 'compat module absent — load order and alias integrity are unchecked');
        }, 'compat boot check');
    }

    if (document.body) {
        $.safe(boot, 'boot');
    } else {
        document.addEventListener('DOMContentLoaded', function () { $.safe(boot, 'boot'); });
    }

    /* ---------------------------------------------------------------------
       Console API — usable from the embedded JS console or DevTools.
       Everything a bug report needs is reachable from here without opening a
       single panel, which matters when the thing being reported is the panels.
       ------------------------------------------------------------------ */
    $.api.open = function () { U.setOpen(true); };
    $.api.close = function () { U.setOpen(false); };
    $.api.toggle = function () { U.toggle(); };
    $.api.watch = function (v) { U.setWatch(v !== false); };
    $.api.apply = function (o) { return U.apply(o); };
    $.api.paths = function () { return $.paths; };
    $.api.hooks = function () { return $.hookList(); };
    $.api.plugins = function () { return $.pluginReport(); };
    $.api.cfg = function () { return $.cfg; };
    $.api.log = function () { return $.logHistory(); };
    $.api.readonly = function (v) { return U.apply({ readonly: v !== false }); };
    $.api.caps = function () {
        $.safe(function () { console.log('[GigaHack]\n' + $.caps.reportText()); }, 'api.caps');
        return $.caps;
    };
    $.api.profile = function () { return $.profile ? $.profile.active() : null; };
    $.api.loadOrder = function () { return $.compat ? $.compat.loadOrder() : null; };
    $.api.selfTest = function (only) { return $.compat ? $.compat.selfTest(only) : null; };
    $.api.index = function () { return $.index ? $.index.status() : null; };
    $.api.reindex = function () { return $.index ? $.index.rebuild() : null; };
    $.api.help = function () {
        var lines = Object.keys($.api).map(function (k) { return 'GigaHack.api.' + k + '()'; });
        console.log('[GigaHack] API:\n  ' + lines.join('\n  '));
        return lines;
    };

    /* Last file in the load order, so this is the first moment at which
       "did every module run" has an answer. Loud on purpose: a module that
       silently is not there is the failure this exists to end. */
    $.safe(function () { $.selfCheck(); }, 'self check');

    /* An older namespace some notes and snippets still use. Kept as a
       read-only alias so either name works from the console without there
       being two objects to keep in step. */
    if (!window.ModMenu) {
        try {
            Object.defineProperty(window, 'ModMenu', { get: function () { return $; }, configurable: true });
        } catch (e) { window.ModMenu = $; }
    }

})(window.GigaHack);
