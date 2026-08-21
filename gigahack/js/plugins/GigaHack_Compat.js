//=============================================================================
// GigaHack MV/MZ
// 08 · compat.js — surviving other people's plugins
//-----------------------------------------------------------------------------
// A cheat menu on a modded game is not fighting the engine. It is fighting the
// forty other plugins that got there first. This module is the whole answer,
// and it has one governing idea:
//
//     Turn "the cheat doesn't work in this game" into a named, specific
//     message about which plugin is responsible and what it did.
//
// Five mechanisms, in the order they earn their keep:
//
//   1. LOAD LAST. Our aliases must be outermost. Checked at boot, reported
//      when false, with the command that fixes it.
//   2. WRITE-AND-VERIFY. After every mutation, read it back. If it did not
//      stick, say so ONCE, name the likely culprit, and mark that control
//      degraded for the session.
//   3. LIVE SELF-TESTS. Run against the RUNNING GAME, not the harness. Set a
//      sentinel and read it back; gain an item and count it. The mod learns
//      what actually works here before the user finds out the hard way.
//   4. ALIAS INTEGRITY. Snapshot the identity of every method we hook. If it
//      changes later, someone re-aliased on top of us — report it.
//   5. FINGERPRINTS + QUIRKS. Recognise the big frameworks and attach named,
//      human-readable consequences.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — plugin compatibility
 * @author gigahack
 * @help GigaHack_Compat.js — requires Core, Caps, Store, UI, Shell, Hooks, Tabs
 */

(function ($) {
    'use strict';
    if (!$) { console.error('[GigaHack] core missing — compat not installed'); return; }

    var K = $.compat = {};
    var U = $.ui;

    /* =====================================================================
       1. The quirks table
       Each entry: a test that says whether the framework is present, and the
       consequences that follow. `affects` names the mod controls that become
       unreliable; `note` is shown to the user verbatim.
       ===================================================================== */
    var QUIRKS = [
        {
            id: 'yep-core',
            match: /^YEP_CoreEngine$/i,
            name: 'Yanfly Core Engine',
            affects: ['party.param', 'inv.gold', 'inv.items'],
            note: 'Overwrites maxGold, maxItems and paramMax outright (no alias). ' +
                  'Parameters are recomputed on every read, so writing a param value does not stick — ' +
                  'the parameter cap has to be raised first. Item stacks clamp to each item\'s maxItem ' +
                  '(default 99) and gold to the plugin\'s Gold Max.',
            probe: function () {
                var out = {};
                $.safe(function () {
                    if (typeof $gameParty !== 'undefined' && $gameParty && $gameParty.maxGold) out.maxGold = $gameParty.maxGold();
                    if (typeof $dataItems !== 'undefined' && $dataItems && $dataItems[1] && $dataItems[1].maxItem !== undefined) {
                        out.maxItem = $dataItems[1].maxItem;
                    }
                    if (typeof $gameActors !== 'undefined' && $gameActors && $gameActors.actor(1)) {
                        out.paramMax = $gameActors.actor(1).paramMax(2);
                    }
                }, 'yep-core probe');
                return out;
            }
        },
        {
            id: 'yep-suite',
            match: /^YEP_/i,
            name: 'Yanfly plugin suite',
            affects: [],
            note: 'Many YEP plugins version-gate their own bodies against Utils.RPGMAKER_VERSION, ' +
                  'so a large part of what the file contains may never run. Do not assume a method ' +
                  'exists because the file defines it.'
        },
        {
            id: 'visu',
            match: /^VisuMZ_/i,
            name: 'VisuStella MZ',
            affects: ['party.param', 'party.exp', 'battle.params'],
            note: 'Replaces large parts of the parameter and battle pipeline. Parameter writes are ' +
                  'commonly recomputed from its own formulas; use the Party panel\'s decomposition ' +
                  'view to see which layer a value is coming from.'
        },
        {
            id: 'srd-supertools',
            match: /^SRD_SuperToolsEngine$/i,
            name: 'SumRndmDde Super Tools Engine',
            affects: ['hotkeys'],
            note: 'Claims F12 for its own editor, but only in a playtest launch — it captures ' +
                  'Utils.isOptionValid("test") once at load. In a normal launch most of it never runs.'
        },
        {
            id: 'srd-hud',
            match: /^SRD_HUDMaker$/i,
            name: 'SumRndmDde HUD Maker',
            affects: [],
            note: 'Draws its HUD with PIXI inside the scene, not the DOM, so it does not collide ' +
                  'with the overlay. It does reorder sprites in Scene_Map.'
        },
        {
            id: 'circular-json',
            match: /CircularJSON/i,
            name: 'CircularJSON save encoder',
            affects: ['save.parse'],
            note: 'Replaces JsonEx.stringify/parse. Save files contain "~"-prefixed reference paths ' +
                  'that plain JSON.parse cannot read. Backups copy bytes and are unaffected; anything ' +
                  'that parses a save must go through the live JsonEx.'
        },
        {
            id: 'image-cache-clear',
            match: /^(cache|ImageCache|MK_ImageCache)$/i,
            name: 'aggressive image cache clearing',
            affects: ['ui.icons'],
            note: 'Clears the image cache on map transfer and destroys base textures. Any bitmap the ' +
                  'overlay holds across a map change must be re-fetched, not cached.'
        },
        {
            id: 'speed-multiplier',
            match: /^(speed|FastForward|TurboMode)$/i,
            name: 'fast-forward plugin',
            affects: ['timing'],
            note: 'Runs Scene_Map.update several times per frame while its key is held. Per-frame mod ' +
                  'logic hangs off SceneManager, outside the multiplier, so repeat rates stay correct.'
        },
        {
            id: 'storage-redirect',
            match: /^(save|SaveDirectory|toggle_save_directory|android-loader)$/i,
            name: 'save location override',
            affects: ['backup'],
            note: 'Redirects where save files are written. GigaHack always resolves save paths through ' +
                  'StorageManager at call time, so backups follow the redirect rather than writing to ' +
                  'a folder nobody reads.'
        },
        {
            id: 'mog',
            match: /^MOG_/i,
            name: 'Moghunter plugin suite',
            affects: [],
            note: 'Heavy scene and sprite replacement. Overlay is unaffected; in-scene overlays ' +
                  '(event markers, battle bars) may be drawn under its layers.'
        },
        {
            id: 'olivia',
            match: /^Olivia_/i,
            name: 'Olivia / Atelier Irina',
            affects: [],
            note: 'Some files are identifier-obfuscated. Hooks use a consistent alias convention, ' +
                  'so aliasing on top is safe.'
        }
    ];

    /* =====================================================================
       2. Fingerprints
       ===================================================================== */
    function loadedPluginNames() {
        return $.safe(function () {
            var names = [];
            if (typeof $plugins !== 'undefined' && $plugins) {
                $plugins.forEach(function (p) {
                    if (!p) return;
                    if (p.status === false) return;      // listed but disabled
                    names.push(String(p.name || '').split('/').pop());
                });
            }
            // PluginManager._scripts is the authoritative "actually set up"
            // list on both engines, and catches anything added outside $plugins.
            if (typeof PluginManager !== 'undefined' && PluginManager._scripts) {
                PluginManager._scripts.forEach(function (n) {
                    var base = String(n).split('/').pop().replace(/\.js$/i, '');
                    if (names.indexOf(base) < 0) names.push(base);
                });
            }
            return names;
        }, 'loadedPluginNames', []);
    }
    K.plugins = loadedPluginNames;

    K.frameworks = function () {
        var names = loadedPluginNames();
        var found = [];
        QUIRKS.forEach(function (q) {
            var hits = names.filter(function (n) { return q.match.test(n); });
            if (!hits.length) return;
            found.push({
                id: q.id, name: q.name, note: q.note,
                affects: q.affects || [],
                plugins: hits,
                probe: q.probe ? $.safe(function () { return q.probe(); }, 'quirk probe ' + q.id, null) : null
            });
        });
        return found;
    };

    /* Which loaded plugins are plausibly responsible for a failed write to
       `control`? Used to turn "that didn't stick" into a name. */
    K.likelyCulprits = function (control) {
        return K.frameworks().filter(function (f) {
            return f.affects.indexOf(control) > -1;
        });
    };

    /* =====================================================================
       3. Load order
       Our aliases must be outermost, which means our entry must be LAST in
       js/plugins.js. Under a mod loader we are appended after everything in
       plugins.js by construction, so the question only arises on a plain
       install.
       ===================================================================== */
    K.loadOrder = function () {
        return $.safe(function () {
            var out = { known: false, last: false, after: [], why: '' };
            if ($.paths.layout === 'modloader') {
                out.known = true; out.last = true;
                out.why = 'a mod loader registers this mod after everything in js/plugins.js.';
                return out;
            }
            if (typeof $plugins === 'undefined' || !$plugins) {
                out.why = '$plugins is not readable, so load order cannot be confirmed.';
                return out;
            }
            var ours = -1;
            for (var i = 0; i < $plugins.length; i++) {
                var n = String(($plugins[i] && $plugins[i].name) || '').split('/').pop();
                if (/^GigaHack/i.test(n)) ours = i;
            }
            if (ours < 0) {
                // We are running, so we were loaded somehow — but not from
                // $plugins. That is worth saying: it usually means a game
                // update rewrote js/plugins.js and something else is loading us.
                out.why = 'no GigaHack entry is present in js/plugins.js, yet the mod is running. ' +
                          'If the game was recently updated, js/plugins.js may have been replaced — ' +
                          're-run the installer to restore the entry.';
                return out;
            }
            out.known = true;
            for (var j = ours + 1; j < $plugins.length; j++) {
                if ($plugins[j] && $plugins[j].status !== false) {
                    out.after.push(String($plugins[j].name || '').split('/').pop());
                }
            }
            out.last = out.after.length === 0;
            out.why = out.last
                ? 'GigaHack is the last enabled entry in js/plugins.js, so its hooks are outermost.'
                : out.after.length + ' plugin(s) load after GigaHack: ' + out.after.join(', ') +
                  '. Their aliases sit on top of ours, so they can intercept or undo what GigaHack does. ' +
                  'Re-run the installer to move the GigaHack entry back to the end of js/plugins.js.';
            return out;
        }, 'compat.loadOrder', { known: false, last: false, after: [], why: 'the check threw' });
    };

    /* =====================================================================
       4. Alias integrity
       Snapshot what each of our hooks installed. Later, if the live method is
       no longer the function we put there, someone patched on top.
       ===================================================================== */
    var snapshot = null;

    K.snapshotAliases = function () {
        snapshot = {};
        $.hookList().forEach(function (h) {
            if (!h.installed || !h.owner) return;
            snapshot[h.name] = h.owner[h.method];
        });
        return Object.keys(snapshot).length;
    };

    K.aliasIntegrity = function () {
        if (!snapshot) K.snapshotAliases();
        var out = [];
        $.hookList().forEach(function (h) {
            if (!h.installed || !h.owner) return;
            var live = h.owner[h.method];
            var expected = snapshot[h.name];
            if (expected === undefined) {
                out.push({ name: h.name, state: 'new', why: 'installed after the snapshot was taken' });
            } else if (live !== expected) {
                out.push({
                    name: h.name, state: 'overpatched',
                    why: h.method + ' is no longer the function GigaHack installed. Something aliased or ' +
                         'replaced it afterwards, so GigaHack\'s wrapper may be bypassed. Debug → Hooks ' +
                         'can remove GigaHack\'s hook if it is now doing more harm than good.'
                });
            }
        });
        return out;
    };

    /* =====================================================================
       5. Write-and-verify
       The generic form of what Vars and Forge already did by hand.

           K.verify('vars.set', function () { $gameVariables.setValue(7, 42); },
                                function () { return $gameVariables.value(7); },
                                42)

       Returns { ok, got, want, culprits, message }. On failure the control is
       marked degraded for the session and the message is logged ONCE — a
       cheat that does not stick would otherwise fill the log with one line
       per frame.
       ===================================================================== */
    var degraded = {};      // control -> {why, culprits, at}
    var reported = {};      // control -> true, so we only say it once

    K.verify = function (control, write, read, want, compare) {
        var eq = compare || function (a, b) { return a === b; };
        var got;
        var threw = null;

        $.safe(function () { write(); }, 'verify write: ' + control);
        got = $.safe(function () { return read(); }, 'verify read: ' + control, undefined);

        var ok = threw === null && eq(got, want);
        if (ok) {
            if (degraded[control]) {
                // It works again — a plugin state changed, or the user raised a cap.
                delete degraded[control];
                delete reported[control];
                $.log('ok', control + ' is writable again.');
            }
            return { ok: true, got: got, want: want, culprits: [], message: '' };
        }

        var culprits = K.likelyCulprits(control);
        var msg = 'wrote ' + JSON.stringify(want) + ' to ' + control +
                  ' and read back ' + JSON.stringify(got) + '.';
        if (culprits.length) {
            msg += ' Most likely cause: ' + culprits.map(function (c) {
                return c.name + ' (' + c.plugins.join(', ') + ')';
            }).join('; ') + '. ' + culprits[0].note;
        } else {
            msg += ' No loaded plugin is known to touch this; the value may be clamped by the engine ' +
                   'itself, or recomputed by something GigaHack does not recognise.';
        }

        degraded[control] = { why: msg, culprits: culprits, at: Date.now() };
        if (!reported[control]) {
            reported[control] = true;
            $.log('warn', msg);
        }
        return { ok: false, got: got, want: want, culprits: culprits, message: msg };
    };

    K.isDegraded = function (control) { return !!degraded[control]; };
    K.degradedWhy = function (control) { return degraded[control] ? degraded[control].why : ''; };
    K.degradedList = function () {
        return Object.keys(degraded).map(function (k) {
            return { control: k, why: degraded[k].why };
        });
    };
    K.clearDegraded = function (control) {
        if (control) { delete degraded[control]; delete reported[control]; }
        else { degraded = {}; reported = {}; }
    };

    /* =====================================================================
       6. Live self-tests
       These run against the RUNNING GAME. That is the entire point: the
       harness proves the mod is internally consistent, and these prove the
       game agrees. Every test restores what it touched.
       ===================================================================== */
    var TESTS = [
        {
            id: 'variables',
            name: 'variables can be written and read back',
            needs: function () { return typeof $gameVariables !== 'undefined' && !!$gameVariables; },
            run: function () {
                // Pick a high, unnamed id so we never disturb game state.
                var id = $.safe(function () {
                    var n = ($dataSystem && $dataSystem.variables) ? $dataSystem.variables.length - 1 : 0;
                    return n > 1 ? n : 1;
                }, 'pick variable', 1);
                var before = $gameVariables.value(id);
                var sentinel = 424242;
                var r = K.verify('vars.set',
                    function () { $gameVariables.setValue(id, sentinel); },
                    function () { return $gameVariables.value(id); },
                    sentinel);
                $gameVariables.setValue(id, before);
                return { ok: r.ok, detail: r.ok ? 'variable ' + id + ' round-tripped' : r.message };
            }
        },
        {
            id: 'switches',
            name: 'switches can be toggled and read back',
            needs: function () { return typeof $gameSwitches !== 'undefined' && !!$gameSwitches; },
            run: function () {
                var id = $.safe(function () {
                    var n = ($dataSystem && $dataSystem.switches) ? $dataSystem.switches.length - 1 : 0;
                    return n > 1 ? n : 1;
                }, 'pick switch', 1);
                var before = $gameSwitches.value(id);
                var r = K.verify('switches.set',
                    function () { $gameSwitches.setValue(id, !before); },
                    function () { return $gameSwitches.value(id); },
                    !before);
                $gameSwitches.setValue(id, before);
                return { ok: r.ok, detail: r.ok ? 'switch ' + id + ' round-tripped' : r.message };
            }
        },
        {
            id: 'items',
            name: 'items can be gained and removed',
            needs: function () {
                return typeof $gameParty !== 'undefined' && !!$gameParty &&
                       typeof $dataItems !== 'undefined' && $dataItems && $dataItems[1];
            },
            run: function () {
                var item = $dataItems[1];
                var before = $gameParty.numItems(item);
                var want = before + 1;
                var r = K.verify('inv.items',
                    function () { $gameParty.gainItem(item, 1); },
                    function () { return $gameParty.numItems(item); },
                    want);
                // Restore regardless of outcome.
                $.safe(function () {
                    var now = $gameParty.numItems(item);
                    if (now !== before) $gameParty.gainItem(item, before - now);
                }, 'restore item count');
                var detail = r.ok ? 'item 1 round-tripped' : r.message;
                if (!r.ok) {
                    var cap = $.safe(function () { return $gameParty.maxItems(item); }, 'maxItems', null);
                    if (cap !== null && before >= cap) {
                        detail = 'item 1 is already at this game\'s stack cap (' + cap + '), so one more ' +
                                 'could not be added. That is a cap, not a failure — raise the cap in the ' +
                                 'Items panel to exceed it.';
                        return { ok: true, detail: detail, soft: true };
                    }
                }
                return { ok: r.ok, detail: detail };
            }
        },
        {
            id: 'gold',
            name: 'gold can be changed',
            needs: function () { return typeof $gameParty !== 'undefined' && !!$gameParty; },
            run: function () {
                var before = $gameParty.gold();
                var cap = $.safe(function () { return $gameParty.maxGold(); }, 'maxGold', 99999999);
                if (before >= cap) {
                    return { ok: true, soft: true, detail: 'gold is already at this game\'s cap (' + cap + ').' };
                }
                var r = K.verify('inv.gold',
                    function () { $gameParty.gainGold(1); },
                    function () { return $gameParty.gold(); },
                    before + 1);
                $.safe(function () {
                    var now = $gameParty.gold();
                    if (now !== before) $gameParty.gainGold(before - now);
                }, 'restore gold');
                return { ok: r.ok, detail: r.ok ? 'gold cap here is ' + cap : r.message };
            }
        },
        {
            id: 'params',
            name: 'actor parameters are readable, and their ceiling is known',
            needs: function () {
                return typeof $gameActors !== 'undefined' && !!$gameActors && !!$gameActors.actor(1);
            },
            run: function () {
                var a = $gameActors.actor(1);
                var caps = [], i;
                for (i = 0; i < 8; i++) {
                    caps.push($.safe(function () { return a.paramMax(i); }, 'paramMax', null));
                }
                var readable = $.safe(function () { return typeof a.param(2) === 'number'; }, 'param read', false);
                // paramPlus is the only durable write surface; param() itself is
                // recomputed on every read on both engines.
                var beforePlus = $.safe(function () { return a._paramPlus ? a._paramPlus[2] : null; }, 'paramPlus', null);
                var r = { ok: readable };
                if (readable && beforePlus !== null) {
                    r = K.verify('party.param',
                        function () { a.addParam(2, 1); },
                        function () { return a._paramPlus[2]; },
                        beforePlus + 1);
                    $.safe(function () { a.addParam(2, beforePlus - a._paramPlus[2]); }, 'restore paramPlus');
                }
                return {
                    ok: r.ok,
                    detail: r.ok
                        ? 'parameter ceilings here: MHP ' + caps[0] + ', MMP ' + caps[1] + ', others ' + caps[2] +
                          '. Values above the ceiling are clamped on read, so raise the ceiling first.'
                        : (r.message || 'parameters are not readable on actor 1')
                };
            }
        },
        {
            id: 'states',
            name: 'states can be applied and cleared',
            needs: function () {
                return typeof $gameActors !== 'undefined' && !!$gameActors && !!$gameActors.actor(1) &&
                       typeof $dataStates !== 'undefined' && $dataStates && $dataStates.length > 1;
            },
            run: function () {
                var a = $gameActors.actor(1);
                // Find a state the actor does not already have and is not immune to.
                var id = null;
                for (var i = 1; i < $dataStates.length; i++) {
                    if (!$dataStates[i]) continue;
                    if (a.isStateAffected(i)) continue;
                    if (a.isStateResist && a.isStateResist(i)) continue;
                    if (i === a.deathStateId()) continue;
                    id = i; break;
                }
                if (id === null) return { ok: true, soft: true, detail: 'no free state to test with.' };
                var r = K.verify('battle.states',
                    function () { a.addState(id); },
                    function () { return a.isStateAffected(id); },
                    true);
                $.safe(function () { a.removeState(id); }, 'clear test state');
                return { ok: r.ok, detail: r.ok ? 'state ' + id + ' applied and cleared' : r.message };
            }
        },
        {
            id: 'saves',
            name: 'the save directory is resolvable and readable',
            needs: function () { return true; },
            run: function () {
                var dir = $.eng.saveDir();
                if (!dir) {
                    return { ok: false, detail: 'StorageManager did not return a save directory. Backups are unavailable.' };
                }
                if (!$.caps.fs) {
                    return { ok: true, soft: true, detail: 'save directory is "' + dir +
                        '" but there is no filesystem here (browser build), so backups are unavailable.' };
                }
                var exists = $.safe(function () { return $.env.fs.existsSync(dir); }, 'save dir exists', false);
                var one = $.eng.savePath(1);
                return {
                    ok: true,
                    detail: 'saves live in ' + dir + (exists ? '' : ' (not created yet)') +
                            (one ? '; slot 1 would be ' + one : '')
                };
            }
        },
        {
            id: 'loadorder',
            name: 'GigaHack loads after every other plugin',
            needs: function () { return true; },
            run: function () {
                var lo = K.loadOrder();
                return { ok: lo.last, soft: !lo.known, detail: lo.why };
            }
        },
        {
            id: 'aliases',
            name: 'no plugin has patched on top of GigaHack\'s hooks',
            needs: function () { return true; },
            run: function () {
                var bad = K.aliasIntegrity().filter(function (x) { return x.state === 'overpatched'; });
                return {
                    ok: bad.length === 0,
                    detail: bad.length ? bad.map(function (b) { return b.name; }).join(', ') + ' — ' + bad[0].why
                                       : $.hookList().filter(function (h) { return h.installed; }).length +
                                         ' hooks intact'
                };
            }
        },
        {
            id: 'names',
            name: 'no plugin name collides with a GigaHack module',
            needs: function () { return typeof PluginManager !== 'undefined' && !!PluginManager._scripts; },
            run: function () {
                // PluginManager.setup skips a plugin whose name is already in
                // _scripts. On MZ the key is the basename; on MV it is the full
                // entry. Either way a duplicate is dropped with NO error, and
                // the module simply never exists.
                var ours = [], seen = {}, dupes = [];
                PluginManager._scripts.forEach(function (n) {
                    var base = String(n).split('/').pop().replace(/\.js$/i, '');
                    if (seen[base]) dupes.push(base);
                    seen[base] = true;
                    if (/^GigaHack/i.test(base)) ours.push(base);
                });
                var ghDupes = dupes.filter(function (d) { return /^GigaHack/i.test(d); });
                return {
                    ok: ghDupes.length === 0,
                    detail: ghDupes.length
                        ? 'another plugin already claimed the name(s) ' + ghDupes.join(', ') +
                          '. PluginManager drops the second claim silently, so that GigaHack module was ' +
                          'never fetched. Rename the other plugin, or reinstall GigaHack.'
                        : ours.length + ' GigaHack modules registered, no name collisions'
                };
            }
        }
    ];

    K.tests = function () { return TESTS.map(function (t) { return { id: t.id, name: t.name }; }); };

    K.selfTest = function (only) {
        var results = [];
        TESTS.forEach(function (t) {
            if (only && only.indexOf(t.id) < 0) return;
            var can = $.safe(function () { return t.needs(); }, 'selftest needs: ' + t.id, false);
            if (!can) {
                results.push({
                    id: t.id, name: t.name, state: 'skipped',
                    detail: 'not applicable yet — start a game first, or this build does not have it.'
                });
                return;
            }
            var r = $.safe(function () { return t.run(); }, 'selftest run: ' + t.id, null);
            if (!r) {
                results.push({ id: t.id, name: t.name, state: 'error', detail: 'the test itself threw — see the log.' });
                return;
            }
            results.push({
                id: t.id, name: t.name,
                state: r.ok ? (r.soft ? 'note' : 'pass') : 'fail',
                detail: r.detail || ''
            });
        });
        K.lastRun = { at: Date.now(), results: results };
        var failed = results.filter(function (r) { return r.state === 'fail'; });
        $.log(failed.length ? 'warn' : 'ok',
            'self-test: ' + results.filter(function (r) { return r.state === 'pass'; }).length + ' passed, ' +
            failed.length + ' failed, ' +
            results.filter(function (r) { return r.state === 'skipped'; }).length + ' skipped');
        failed.forEach(function (f) { $.log('warn', '  ' + f.name + ' — ' + f.detail); });
        return results;
    };

    K.lastRun = null;

    /* =====================================================================
       7. Boot wiring
       Snapshot aliases once every module has installed its hooks, then run
       the non-destructive part of the self-test on first boot only.
       ===================================================================== */
    K.bootCheck = function () {
        K.snapshotAliases();
        var lo = K.loadOrder();
        $.log(lo.last ? 'ok' : 'warn', 'load order: ' + lo.why);

        var fw = K.frameworks();
        if (fw.length) {
            $.log('info', 'recognised plugin frameworks: ' +
                fw.map(function (f) { return f.name; }).join(', '));
            fw.forEach(function (f) {
                if (f.affects.length) $.log('info', '  ' + f.name + ' affects: ' + f.affects.join(', '));
            });
        }

        // Only the checks that need no game world; the rest wait until a
        // save is loaded, because running them on the title screen would
        // report "skipped" for everything and teach the user nothing.
        K.selfTest(['loadorder', 'aliases', 'names', 'saves']);
    };

    /* Run the full suite once, the first time a game world exists. */
    var fullRunDone = false;
    K.maybeFullRun = function () {
        if (fullRunDone) return;
        if (typeof $gameParty === 'undefined' || !$gameParty) return;
        if (typeof $gameVariables === 'undefined' || !$gameVariables) return;
        fullRunDone = true;
        $.log('info', 'running the full self-test against the loaded game…');
        K.selfTest();
    };

})(window.GigaHack);
