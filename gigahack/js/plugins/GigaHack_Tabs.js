//=============================================================================
// GigaHack MV/MZ
// 07 · tabs.js — the tab registry, and the Debug tab's own panels
//-----------------------------------------------------------------------------
// Two things live here:
//
//   · the registry every module registers a panel into. No module owns a tab
//     and none of them has to know what else is on the same one.
//   · the panels the Debug tab owns itself — Environment, Hooks, Plugins,
//     Compatibility, Index, Backups — plus the Settings tab.
//
// The Debug panels are the ones that answer "why does this not work on my
// game", so they are held to a harder rule than the rest: every string they
// show is derived from what was actually detected on this install. Nothing
// here names a delivery mechanism, a directory, a manifest file or another
// plugin — it asks $.paths, $.caps, $.compat and $.index, and prints the
// answer, including the command that would repair what is broken.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — tabs and the Debug panels
 * @author gigahack
 * @help GigaHack_Tabs.js — requires Core, Caps, Store, UI, Shell, Hooks
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — tabs not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols, todo = U.todo;

    /* =====================================================================
       THE TAB REGISTRY

       Six tabs, declared once, here. Every panel in the mod registers into one
       of them by name — no module owns a tab, and none of them has to know
       what else is on the same one. That is what makes a regrouping like
       "Variables, Teleport and Events are all one World tab now" an edit to
       this list plus one line per module, instead of a rewrite of six files.

       Order within a tab is the "order" argument, not load order: Vars, Map
       and Events load eleven files apart and would otherwise land in whatever
       sequence the plugin list happens to load them in.
       ===================================================================== */
    var TABDEFS = [
        { id: 'player', label: 'Player', icon: 'player', hint: 'movement, stats, skills, states, equipment, identity' },
        { id: 'world', label: 'World', icon: 'teleport', hint: 'variables, switches, maps, events, gallery' },
        { id: 'items', label: 'Items', icon: 'inventory', hint: 'inventory, gold, the Forge' },
        { id: 'game', label: 'Game', icon: 'battle', hint: 'battle and text' },
        { id: 'debug', label: 'Debug', icon: 'debug', hint: 'environment, hooks, saves, console, log' },
        { id: 'settings', label: 'Settings', icon: 'settings', hint: 'appearance, behaviour, hotkeys, profiles' }
    ];
    U.TABDEFS = TABDEFS;

    var panels = {};
    TABDEFS.forEach(function (t) { panels[t.id] = []; });

    function tabDef(def) {
        var list = panels[def.id];
        return {
            id: def.id, label: def.label, icon: def.icon, hint: def.hint,
            subs: list.map(function (p) { return p.name; }),
            // A panel that renders more than one shape under one sub name says
            // so, and the shell gives it its own scroll slot — see the note on
            // scroll memory in the shell.
            scope: function (sub) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].name === sub && list[i].scope) return list[i].scope();
                }
                return '';
            },
            build: function (sub) {
                for (var i = 0; i < list.length; i++) {
                    if (list[i].name === sub) return $.safe(function () { return list[i].build(sub); },
                        'build ' + def.id + '/' + sub, todo(def.label, sub, ['this panel threw while building']));
                }
                if (list.length) return list[0].build(list[0].name);
                return todo(def.label, def.label, ['nothing registered on this tab']);
            }
        };
    }

    /**
     * Register a panel on a tab.
     *
     *   U.panel('world', 'Teleport', buildMaps, 70)
     *
     * Re-registering the same name on the same tab replaces it, which is how
     * an optional module can be enabled at runtime and appear immediately.
     */
    U.panel = function (tabId, name, build, order, scope) {
        var def = null;
        TABDEFS.forEach(function (t) { if (t.id === tabId) def = t; });
        if (!def) { $.log('warn', 'no such tab: ' + tabId + ' (panel "' + name + '" dropped)'); return null; }
        panels[tabId] = panels[tabId].filter(function (p) { return p.name !== name; });
        panels[tabId].push({ name: name, build: build, order: order == null ? 50 : order, scope: scope || null });
        panels[tabId].sort(function (a, b) { return a.order - b.order; });
        U.tab(tabDef(def));
        return name;
    };

    U.panelNames = function (tabId) {
        return (panels[tabId] || []).map(function (p) { return p.name; });
    };

    /** Every tab id, in strip order. Used by the module report. */
    U.tabIds = function () { return TABDEFS.map(function (t) { return t.id; }); };

    // Named shorthands kept for the modules that already used them. Every
    // module that registers a panel goes through U.panel underneath, so a
    // module registering late — Encounters after its boot probe, Gallery
    // after the database loads — arrives the same way as one registering
    // at load, and replaces by name rather than duplicating.
    U.actorPanel = function (name, build, order) { return U.panel('player', name, build, order); };
    U.playerPanel = function (name, build, order) { return U.panel('player', name, build, order == null ? 90 : order); };

    // Declare every tab up front so the strip has its full shape before any
    // feature module loads — a tab whose module failed still appears, and says
    // so, rather than silently vanishing from the strip.
    TABDEFS.forEach(function (t) { U.tab(tabDef(t)); });

    /* =====================================================================
       DEBUG — real in M1
       Everything the Debug tab shows registers the same way every other panel
       does — this file just declares the six it owns itself. Compatibility
       and Index are built lazily, so the modules behind them (which load
       after this file) are there by the time anyone opens the sub-tab; when
       one of them did not load at all, the panel says so instead of vanishing.
       ===================================================================== */
    U.panel('debug', 'Environment', function () { return buildEnvironment(); }, 10);
    U.panel('debug', 'Hooks', function () { return buildHooks(); }, 20);
    U.panel('debug', 'Plugins', function () { return buildPlugins(); }, 30);
    U.panel('debug', 'Compatibility', function () { return buildCompatibility(); }, 40);
    U.panel('debug', 'Index', function () { return buildIndex(); }, 45);
    U.panel('debug', 'Backups', function () { return buildBackups(); }, 90);

    /** Register a Debug sub-tab. Kept as a name because five modules use it. */
    U.debugPanel = function (name, build, order) { return U.panel('debug', name, build, order == null ? 50 : order); };

    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
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

    /**
     * Like $.safe but silent. The Environment panel reads $data / $game
     * globals that legitimately do not exist yet when the tab is built during
     * boot (the persisted tab happened to be Debug). Those misses are
     * expected, not errors, and must not spam the log drawer with red lines
     * on every launch.
     */
    function soft(fn, fallback) {
        try {
            var v = fn();
            return (v === undefined || v === null) ? fallback : v;
        } catch (e) { return fallback; }
    }

    /* =====================================================================
       Where this install actually is.

       Delivery is discovered, never assumed: the same files run from the
       game's own plugins folder, from a web-deploy www folder, or from a mod
       loader's folder, and only $.paths knows which. Every user-facing string
       that would otherwise have named one of those goes through these.
       ===================================================================== */
    function deliveryLabel() {
        var l = $.paths.layout;
        if (l === 'plain') return 'the game plugins folder';
        if (l === 'www') return 'the web-deploy plugins folder';
        if (l === 'modloader') return 'a mod folder, set up by a mod loader';
        return 'an unrecognised layout';
    }

    /** The game's plugin list, on this install. */
    function pluginListFile() {
        var dir = $.paths.pluginsDir, path = $.env.path;
        if (!dir) return 'the game plugin list';
        if (path) return path.join(path.dirname(dir), 'plugins.js');
        return dir.replace(/[\/\\][^\/\\]*$/, '') + '/plugins.js';
    }

    /* What "pause" holds is engine-dependent and the hook module is the only
       thing that knows which functions it managed to gate. */
    function pauseAvailable() { return !!($.pause && $.pause.available()); }
    function pauseDescription() {
        if ($.pause) return $.pause.describe();
        return 'the pause module did not load, so nothing is held.';
    }

    /** The command that makes unreadable plugin files readable again. */
    function repairCommand() {
        if ($.repairCommand) return $.repairCommand();
        return 'chmod 644 ' + ($.paths.pluginsDir || '<plugins folder>') + '/GigaHack_*.js';
    }

    /**
     * The paste-into-a-bug-report artefact.
     *
     * One block of text with the engine, the capability answers and the
     * resolved paths. A screenshot of a panel loses the long "why" strings;
     * this does not, and it needs neither a writable disk nor a working
     * overlay renderer to be useful.
     */
    function envReportText() {
        return $.safe(function () {
            var L = [$.codename + ' ' + $.version, ''];
            L.push(($.caps && $.caps.reportText) ? $.caps.reportText() : 'the capability table did not load');
            L.push('');
            L.push($.describePaths());
            L.push('delivery            : ' + deliveryLabel());
            if ($.pause) L.push('pause               : ' + $.pause.describe());
            return L.join('\n');
        }, 'environment report', $.codename + ' ' + $.version + ' — the environment report could not be built');
    }

    function buildEnvironment() {
        var p = $.paths, env = $.env;

        var pathRows = [
            kv('Persistence', p.mode + (p.fallbackUsed ? ' (fallback)' : ''),
                'Persistence|fs = JSON files on disk. localStorage / memory mean Node APIs were unavailable.'),
            kv('Platform', p.platform),
            kv('Delivery', deliveryLabel()),
            kv('Node APIs', env.nwjs ? 'available' : 'missing')
        ];

        /* The capability table, verbatim. This is the artefact a bug report
           is built from: every row that says "no" carries the reason, and
           every feature that depends on one asked this table rather than a
           version string. */
        var capsRows = ($.caps && $.caps.report) ? $.safe(function () { return $.caps.report(); }, 'caps report', []) : [];
        var capsTable = W.table({
            cols: [
                { label: 'capability', w: '0 0 132px' },
                { label: 'answer', w: '1 1 0' }
            ],
            empty: 'the capability table did not load — GigaHack_Caps.js is missing',
            render: function (r) {
                return [
                    h('span', { class: 'mm-cell mm-selectable', text: String(r[0]) }),
                    h('span', {
                        class: 'mm-cell mm-sub mm-selectable',
                        style: 'white-space:normal', text: String(r[1])
                    })
                ];
            }
        });
        capsTable.mm.paint(capsRows);

        var capsGroup = W.group('Engine capabilities', [
            capsTable,
            h('div', { class: 'mm-sub', style: 'padding:4px 2px;white-space:normal' },
                'Probed at load, never read off a version number. A plugin that adds or ' +
                'removes one changes the answer.'),
            W.button({
                label: 'copy the environment report', wide: true, _ungated: true,
                tip: 'Copy|Engine, capabilities and paths as plain text, for a bug report.',
                onClick: function () {
                    var ok = U.copyText(envReportText());
                    U.toast({
                        title: ok ? 'COPIED' : 'CLIPBOARD UNAVAILABLE',
                        msg: ok ? 'Environment report on the clipboard' : 'Select the text above instead',
                        severity: ok ? 'ok' : 'warn'
                    });
                }
            })
        ], { tag: ($.caps && $.caps.engine) ? $.caps.engine : 'unknown' });

        var dirGroup = W.group('Resolved paths', [
            // Nothing in this block is anything but a path, so it wraps: the
            // tail is the half that identifies the install, and behind a
            // horizontal scrollbar it is the half nobody reads.
            h('div', { class: 'mm-pre mm-pre-wrap', text: $.describePaths() }),
            h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
                W.button({
                    label: 'copy paths', _ungated: true,
                    onClick: function () {
                        // NW.js has its own clipboard, which works regardless of
                        // whether file:// counts as a secure context here.
                        var ok = $.safe(function () {
                            if (typeof nw === 'object' && nw.Clipboard) {
                                nw.Clipboard.get().set($.describePaths(), 'text');
                                return true;
                            }
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                                navigator.clipboard.writeText($.describePaths());
                                return true;
                            }
                            return false;
                        }, 'copy paths', false);
                        U.toast({
                            title: ok ? 'COPIED' : 'CLIPBOARD UNAVAILABLE',
                            msg: ok ? 'Paths on the clipboard' : 'Select the text above instead',
                            severity: ok ? 'ok' : 'warn'
                        });
                    }
                }),
                W.button({
                    label: 'test write', _ungated: true,
                    onClick: function () {
                        var ok = $.store.write('write-test.json', { at: new Date().toISOString(), version: $.version });
                        U.toast({
                            title: ok ? 'WRITE OK' : 'WRITE FAILED',
                            msg: ok ? ($.store.path('write-test.json') || $.paths.mode) : 'see the log',
                            severity: ok ? 'ok' : 'err'
                        });
                    }
                }))
        ], { tag: p.mode });

        var save = $.saves.available()
            ? [W.pathRow('Save folder', soft(function () { return $.saves.dir(); }, ''), {
                why: 'StorageManager has not resolved one yet — refresh after the title screen',
                tip: 'Save folder|Follows the game\'s own external-save-directory option.'
            }),
            W.pathRow('Slot 1 file', soft(function () { return $.saves.fileFor(1); }, ''), {
                why: 'no save path on this install'
            })]
            : [h('div', { class: 'mm-empty', text: 'save paths unavailable (' + $.paths.mode + ' mode)' })];

        // This panel is a snapshot. When the tab is built during boot (the
        // persisted tab happened to be Debug) the database is not loaded yet,
        // so several rows read "loading…" until refreshed.
        var engine = [
            kv('Game', soft(function () { return $dataSystem.gameTitle; }, 'loading…')),
            kv('Mod version', $.version),
            kv('Variables', soft(function () { return $dataSystem.variables.length - 1; }, 'loading…')),
            kv('Switches', soft(function () { return $dataSystem.switches.length - 1; }, 'loading…')),
            kv('Scene', soft(function () { return SceneManager._scene.constructor.name; }, '—')),
            h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
                W.button({ label: 'refresh', wide: true, _ungated: true, onClick: function () { U.rerender(); } }))
        ];

        var compat = U.compatReport();
        var missing = compat.filter(function (f) { return !f.supported; });
        var compatGroup = W.group('Renderer', compat.map(function (f) {
            return h('div', { class: 'mm-row' },
                h('i', {
                    class: 'mm-dotmark',
                    style: 'background:' + (f.supported ? 'var(--mm-ok)' : 'var(--mm-warn)') + ';margin-right:6px'
                }),
                h('div', { class: 'mm-lab', text: f.feature }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: f.supported ? 'yes' : 'NO' }));
        }).concat([
            h('div', { class: 'mm-sub', style: 'padding:4px 2px;white-space:normal' },
                missing.length
                    ? 'This build lacks ' + missing.length + ' of the features the mockup assumes. GigaHack avoids all of them; if any UI looks wrong, start here.'
                    : 'Everything the overlay uses is supported.')
        ]), { tag: missing.length ? missing.length + ' missing' : 'ok', collapsed: !missing.length });

        var notes = (p.notes || []).length
            ? W.group('Notes', (p.notes || []).map(function (n) {
                return h('div', { class: 'mm-row' }, h('div', { class: 'mm-lab mm-selectable', style: 'white-space:normal', text: n }));
            }), { tag: p.notes.length + '' })
            : null;

        return cols(
            [capsGroup, W.group('Environment', pathRows, { tag: 'runtime' }), dirGroup, notes],
            [W.group('Engine', engine, { tag: 'live' }), W.group('Save files', save, { tag: 'read-only' }), compatGroup]
        );
    }

    function buildHooks() {
        var list = $.hookList();
        var table = W.table({
            cols: [
                { label: '', w: '0 0 16px' },
                { label: 'hook', w: '1 1 0' },
                { label: 'state', w: '0 0 96px', cls: 'mm-td-num' },
                { label: '', w: '0 0 62px' }
            ],
            empty: 'no hooks installed',
            render: function (hk) {
                return [
                    h('i', {
                        class: 'mm-dotmark',
                        style: 'background:' + (hk.installed ? 'var(--mm-ok)' : 'var(--mm-warn)')
                    }),
                    h('span', { class: 'mm-selectable', text: hk.name }),
                    hk.installed ? 'installed' : 'skipped',
                    hk.installed && hk.unpatch
                        ? W.button({
                            label: 'unpatch', variant: 'danger', confirm: true, confirmLabel: 'sure?',
                            onClick: function (btn) {
                                if (hk.unpatch()) {
                                    U.toast({ title: 'UNPATCHED', msg: hk.name, severity: 'warn' });
                                    U.rerender();
                                } else {
                                    U.toast({ title: 'CANNOT UNPATCH', msg: 'another plugin patched on top', severity: 'err' });
                                }
                            }
                        })
                        : null
                ];
            },
            onRow: function (tr, hk) {
                if (!hk.installed && hk.reason) tr.setAttribute('data-mm-tip', 'Skipped|' + hk.reason);
            }
        });
        table.mm.paint(list);

        return cols([
            W.group('Installed aliases', [table], { grow: true, tag: list.length + ' hooks' }),
            h('div', { class: 'mm-sub', style: 'padding:0 2px' },
                'Unpatching only succeeds when no other plugin has patched on top of ours.')
        ]);
    }

    /**
     * What this build expects, what is on disk, and what actually ran.
     *
     * Always shown, not only when something is wrong. "It is not there" is
     * the single hardest report to act on — this turns it into four separate
     * yes/no questions that can be read off in one glance, and a Copy button
     * so the answer can leave the game as text rather than as a screenshot.
     *
     * There is no manifest to read and no loader to ask. The expected list is
     * what this version ships, each module leaves a marker on $ as it runs,
     * and the files are looked for in the directory this script is sitting
     * in. That works on every layout, and on a build with no filesystem at
     * all the file columns read "?" while the column that matters — did it
     * run — still answers.
     */
    function buildModules() {
        if (!$.moduleReport) return null;
        var mrep = $.moduleReport();

        var copyBtn = W.button({
            label: 'Copy the whole report', wide: true, _ungated: true,
            tip: 'Copy|Modules, files, panels and paths, as plain text.',
            onClick: function () {
                U.copyText($.report());
                $.log('ok', 'module report copied to the clipboard');
            }
        });

        var yn = function (v, good, bad) {
            if (v === null || v === undefined) return h('span', { class: 'mm-sub', text: '?' });
            return h('span', { style: 'color:var(--' + (v ? 'mm-ok' : 'mm-danger') + ')', text: v ? good : bad });
        };

        var table = W.table({
            cols: [
                { label: 'module', w: '1 1 0' },
                { label: 'listed', w: '0 0 62px' },
                { label: 'file', w: '0 0 62px' },
                { label: 'ran', w: '0 0 48px' },
                { label: 'state', w: '0 0 150px' }
            ],
            empty: 'no modules are expected — the module list is empty',
            render: function (r) {
                var listed = r.manifest === false ? h('span', { class: 'mm-sub', text: 'off' })
                    : r.listed === 'enabled' ? h('span', { text: 'yes' })
                        : r.listed === 'disabled' ? h('span', { class: 'mm-sub', text: 'disabled' })
                            : h('span', { class: 'mm-sub', text: 'no' });
                return [
                    h('span', { class: 'mm-cell mm-selectable', text: r.name }),
                    listed,
                    r.file && r.readable === false
                        ? h('span', { style: 'color:var(--mm-danger)', text: 'locked' })
                        : yn(r.file, 'present', 'MISSING'),
                    yn(r.ran, 'yes', 'NO'),
                    h('span', {
                        class: 'mm-cell mm-sub',
                        text: r.readable === false ? 'mode ' + (r.mode || '?')
                            : r.manifest === false ? 'off in the mod manifest'
                                : (r.claimed || '—')
                    })
                ];
            },
            onRow: function (tr, r) {
                if (r.manifest === false) tr.style.opacity = '.45';
                if (r.marker) {
                    tr.setAttribute('data-mm-tip', r.name +
                        '|declares $.' + r.marker + ' when it has run to completion');
                }
            }
        });
        table.mm.paint(mrep.rows);

        var notes = [];
        if (mrep.missing.length) {
            notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-danger)' },
                mrep.missing.join(', ') + ' — expected by this build and never registered.'));

            var locked = mrep.rows.filter(function (r) {
                return mrep.missing.indexOf(r.name) > -1 && r.readable === false;
            });
            if (locked.length) {
                notes.push(h('div', { class: 'mm-sub mm-selectable', style: 'white-space:normal;padding:2px' },
                    'These are on disk and this process is not allowed to read them (' +
                    locked.map(function (r) { return r.name + ' mode ' + (r.mode || '?'); }).join('; ') +
                    '). Nothing in the game can work around that. In a terminal: ' + repairCommand()));
            }
            var claimed = mrep.rows.filter(function (r) {
                return mrep.missing.indexOf(r.name) > -1 && r.claimed;
            });
            if (claimed.length) {
                notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                    claimed.map(function (r) { return r.name + ' — ' + r.claimed; }).join('; ') +
                    '. The engine keeps one flat list of plugin names for the whole game and skips a ' +
                    'second claim on a name; a file it does request but cannot read lands in an error ' +
                    'list that is inspected exactly once, before any of these files exists. Either way ' +
                    'nothing is raised. GigaHack reads those off disk and runs them itself — see the log.'));
            }
        }
        if (mrep.unknown.length) {
            notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
                mrep.unknown.join(', ') + ' — sitting in the plugins folder but not part of ' +
                $.codename + ' ' + $.version + '. Almost always left over from an older install: ' +
                'nothing loads them, and deleting them is safe.'));
        }
        if (mrep.absent.length) {
            notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                mrep.absent.join(', ') + ' — not installed. No file, and no plugin entry names them, ' +
                'so those features are absent rather than broken.'));
        }
        if ($.paths.fallbackUsed) {
            notes.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                'Settings are being written to ' + ($.paths.dataDir || '—') + ' because the preferred ' +
                'directory for this layout was not writable.'));
        }

        var footer = [
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'delivery' }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: deliveryLabel() })),
            W.pathRow('plugins dir', $.paths.pluginsDir, {
                why: 'the plugins folder was not resolved — see Environment'
            })
        ];
        if (mrep.manifest) {
            // A mod loader keeps its own list of what to load. It is an extra
            // column when it is there, and nothing at all when it is not.
            footer.push(W.pathRow('mod manifest', mrep.manifest.file, {
                prefix: mrep.manifest.version ? 'v' + mrep.manifest.version + '  ' : null
            }));
        }
        footer.push(copyBtn);

        var bad = mrep.missing.length + mrep.unknown.length;
        return W.group('GigaHack modules', [table].concat(notes).concat(footer),
            { tag: bad ? bad + ' to look at' : mrep.ran.length + ' loaded', collapsed: false });
    }

    function buildPlugins() {
        var rep = $.pluginReport();
        var modules = buildModules();

        if (!rep) {
            return h('div', { class: 'mm-body' }, h('div', { class: 'mm-col' },
                modules,
                h('div', { class: 'mm-todo' }, h('b', { text: '$plugins unavailable' }))));
        }

        var filter = '';
        var table = W.table({
            virtual: true,
            cols: [
                { label: '#', w: '0 0 34px', cls: 'mm-td-num' },
                { label: 'plugin', w: '1 1 0' },
                { label: 'status', w: '0 0 60px', cls: 'mm-td-num' }
            ],
            empty: 'no matches',
            render: function (p, i) {
                return [String(i + 1), h('span', { class: 'mm-selectable', text: p.name }), p.status ? 'on' : 'off'];
            },
            onRow: function (tr, p) {
                if (p.description) tr.setAttribute('data-mm-tip', p.name + '|' + p.description);
                if (!p.status) tr.style.opacity = '.45';
            }
        });
        function repaint() {
            table.mm.paint(rep.plugins.filter(function (p) {
                return !filter || p.name.toLowerCase().indexOf(filter) > -1 ||
                    (p.description || '').toLowerCase().indexOf(filter) > -1;
            }));
        }
        var search = W.search({
            placeholder: 'filter ' + rep.total + ' plugins…',
            onInput: function (v) { filter = v; repaint(); }
        });
        repaint();

        // Collapsed by default: on a 142-plugin project an expanded warning
        // list would push the table it is warning about off the panel.
        var warn = rep.warnings.length
            ? W.group('Compatibility warnings', rep.warnings.map(function (w) {
                return h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', style: 'white-space:normal;color:var(--mm-warn)', text: w }));
            }).concat([
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'The Compatibility sub-tab says what each one costs and whether the game ' +
                    'currently agrees.')
            ]), { tag: rep.warnings.length + ' suites', collapsed: true })
            : null;

        var body = h('div', { class: 'mm-body' },
            h('div', { class: 'mm-col' },
                modules,
                warn,
                W.group('Loaded plugins', [
                    h('div', { class: 'mm-toolbar' }, search),
                    table
                ], { grow: true, tag: rep.enabled + ' / ' + rep.total + ' enabled' })));
        return body;
    }

    /* ------------------------------------------------------------ Backups */
    function buildBackups() {
        var B = $.backup;
        if (!B) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' }, h('b', { text: 'backup module not loaded' })));
        }
        if (!B.available()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('div', { class: 'mm-todo-ms', text: 'UNAVAILABLE' }),
                    h('b', { text: 'save backups are off' }),
                    h('div', { text: B.reason() || 'unknown reason' }),
                    h('div', { text: 'dangerous actions still run, just unprotected' })));
        }

        var list = B.list();
        var saves = B.saveFiles();

        var table = W.table({
            cols: [
                { label: 'when', w: '0 0 132px', cls: 'mm-td-num' },
                { label: 'reason', w: '0 0 104px' },
                { label: 'files', w: '0 0 48px', cls: 'mm-td-num' },
                { label: '', w: '0 0 92px' }
            ],
            empty: 'no backups yet — one is taken automatically before a teleport',
            render: function (e) {
                var when = String(e.at || '').replace('T', ' ').slice(0, 19) || e.name;
                return [
                    when,
                    h('span', { class: 'mm-sub', text: e.reason }),
                    String((e.files || []).length),
                    W.button({
                        label: 'restore', mini: true, variant: 'danger', mutates: true,
                        confirmLabel: 'overwrite saves?',
                        tip: 'Restore|Overwrites your live saves. The current state is backed up ' +
                            'first.',
                        onClick: function () {
                            var n = B.restore(e);
                            if (n !== false) {
                                U.toast({
                                    title: 'RESTORED',
                                    msg: n + ' file(s) — load the save from the title screen',
                                    severity: 'warn', ms: 6000
                                });
                                U.rerender();
                            }
                        }
                    })
                ];
            },
            onRow: function (tr, e) {
                tr.setAttribute('data-mm-tip', e.name + '|' + (e.files || []).join(', '));
            }
        });
        table.mm.paint(list);

        return cols({ narrow: true, items: [
            W.group('Saves on disk', [
                kv('Folder', B.saveDir() || '—'),
                kv('Files', saves.length),
                kv('Newest', saves[0] ? saves[0].name : '—')
            ], { tag: 'live' }),
            W.group('Backups', [
                kv('Folder', B.dir() || '—'),
                kv('Kept', $.store.cfgGet('behaviour.backupKeep', 20)),
                W.button({
                    label: 'back up now', wide: true, _ungated: true,
                    onClick: function () {
                        var r = B.make('manual', true);
                        U.toast({
                            title: r.created ? 'BACKED UP' : 'NOT BACKED UP',
                            msg: r.created ? r.entry.name : (r.why || r.skipped),
                            severity: r.created ? 'ok' : 'warn'
                        });
                        U.rerender();
                    }
                }),
                null
            ], { tag: list.length + '' })
        ] }, [
            W.group('Restore', [table], { grow: true, tag: 'newest first' })
        ]);
    }

    /* =====================================================================
       SETTINGS — real in M1
       ===================================================================== */
    U.panel('settings', 'Interface', function () { return buildInterface(); }, 10);
    U.panel('settings', 'Behaviour', function () { return buildBehaviour(); }, 20);
    U.panel('settings', 'Hotkeys', function () { return buildHotkeys(); }, 30);
    U.panel('settings', 'Profiles', function () { return buildProfiles(); }, 40);


    /* =====================================================================
       PROFILES (M16)
       ===================================================================== */
    var profName = '', profPaste = '', profSelected = null;

    function buildProfiles() {
        var list = $.store.profiles();
        if (profSelected && !$.store.profileExists(profSelected)) profSelected = null;
        if (!profSelected && list.length) profSelected = list[0].name;

        var table = W.table({
            rowH: 17, empty: 'no profiles saved yet',
            cols: [
                { label: 'name', w: '1 1 0' },
                { label: 'saved', w: '0 0 116px', cls: 'mm-td-num' },
                { label: '', w: '0 0 58px' }
            ],
            render: function (p) {
                return [
                    h('span', { class: p.name === profSelected ? 'mm-td-val mm-hi' : 'mm-td-val', text: p.name }),
                    h('span', { class: 'mm-sub', text: p.at ? String(p.at).replace('T', ' ').slice(0, 16) : '—' }),
                    W.button({
                        label: 'apply', mini: true, mutates: true,
                        onClick: function () {
                            var r = $.store.applyProfile(p.name);
                            if (r && r.scrubbed.length) {
                                U.toast({
                                    title: 'PROFILE APPLIED', severity: 'warn',
                                    msg: r.scrubbed.length + ' setting(s) that paint into the game were left off: ' +
                                        r.scrubbed.join(', ')
                                });
                            } else if (r) {
                                U.toast({ title: 'PROFILE APPLIED', msg: p.name, severity: 'ok', ms: 1400 });
                            }
                            U.applyAccent(U.getHost().root, $.cfg.ui.accent);
                            U.rerender();
                        }
                    })
                ];
            },
            onRow: function (tr, p) {
                tr.addEventListener('click', function () { profSelected = p.name; U.rerender(); });
            }
        });
        table.mm.paint(list);

        var exported = profSelected ? $.store.exportProfile(profSelected) : null;

        var left = [
            W.group('Save the current settings', [
                W.row('Name', W.text({
                    value: profName, width: '150px', placeholder: 'e.g. "speedrun"',
                    onInput: function (v) { profName = v; },
                    onEnter: function (v) {
                        if (!$.store.saveProfile(v)) return;
                        profName = ''; profSelected = $.store.profileName(v); U.rerender();
                    }
                }), { tip: 'Name|Enter saves. Saving over an existing name replaces it.' }),
                W.button({
                    label: 'save as a profile', wide: true, mutates: true,
                    onClick: function () {
                        if (!$.store.saveProfile(profName)) {
                            U.toast({ title: 'NEEDS A NAME', msg: 'type something to call it', severity: 'warn' });
                            return;
                        }
                        profSelected = $.store.profileName(profName);
                        profName = ''; U.rerender();
                    }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Appearance, behaviour, hotkeys and every feature flag travel together.')
            ], { tag: list.length + ' saved' }),

            W.group('Selected', [
                kv('Profile', profSelected || 'none'),
                W.button({
                    label: 'apply it', wide: true, mutates: true, disabled: !profSelected,
                    onClick: function () {
                        $.store.applyProfile(profSelected);
                        U.applyAccent(U.getHost().root, $.cfg.ui.accent);
                        U.rerender();
                    }
                }),
                W.button({
                    label: 'delete it', wide: true, variant: 'danger', mutates: true, disabled: !profSelected,
                    confirm: true, confirmLabel: 'delete the profile "' + (profSelected || '') + '"?',
                    onClick: function () { $.store.deleteProfile(profSelected); profSelected = null; U.rerender(); }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Applying and deleting are both on the undo stack.')
            ])
        ];

        var right = [
            W.group('Profiles', [table], { grow: true }),
            W.group('Move one between installs', [
                W.row('Export', W.button({
                    label: 'copy the selected one', wide: true, _ungated: true, disabled: !exported,
                    onClick: function () {
                        U.copyText(exported || '');
                        U.toast({ title: 'COPIED', msg: profSelected, severity: 'ok', ms: 1400 });
                    }
                })),
                W.textarea({
                    value: profPaste, rows: 3, mono: true, _ungated: true,
                    placeholder: 'paste an exported profile here',
                    onInput: function (v) { profPaste = v; }
                }),
                W.button({
                    label: 'import what is pasted', wide: true, mutates: true,
                    onClick: function () {
                        var r = $.store.importProfile(profPaste);
                        if (!r.ok) {
                            U.toast({ title: 'NOT IMPORTED', msg: r.error, severity: 'warn' });
                            return;
                        }
                        profPaste = ''; profSelected = r.name;
                        U.toast({
                            title: 'IMPORTED', severity: 'ok', ms: 1600,
                            msg: r.name + (r.replaced ? ' (replaced an existing one)' : '')
                        });
                        U.rerender();
                    }
                })
            ], { tag: 'json', collapsed: true })
        ];

        return cols(left, right);
    }

    function buildInterface() {
        var root = U.getHost().root;

        var swatches = h('div', { class: 'mm-inline' }, U.accents.map(function (a) {
            var b = h('button', {
                class: 'mm-sw', style: 'background:' + a.hex + ';width:22px;height:14px',
                tip: 'Accent|' + a.name,
                onclick: function () {
                    $.store.cfgSet('ui.accent', a.hex);
                    U.applyAccent(root, a.hex);
                    Array.prototype.forEach.call(swatches.children, function (c) { c.style.boxShadow = '0 0 0 1px #3a3d44'; });
                    b.style.boxShadow = '0 0 0 1px #fff';
                    $.log('info', 'accent → ' + a.name);
                }
            });
            if (a.hex === $.cfg.ui.accent) b.style.boxShadow = '0 0 0 1px #fff';
            return b;
        }));

        return cols([
            W.group('Appearance', [
                W.row('Accent preset', swatches),
                W.row('Custom accent', W.color({
                    value: $.cfg.ui.accent,
                    onChange: function (v) { $.store.cfgSet('ui.accent', v); U.applyAccent(root, v); }
                })),
                W.toggleRow('Cycle the accent colour', W.ungated({
                    value: U.accentCycling(),
                    tip: 'Cycle|Off at every launch, whatever this says. The game is untouched.',
                    onChange: function (v) { U.setAccentCycling(v); U.rerender(); }
                })),
                W.row('Cycle speed', W.slider(W.ungated({
                    value: Number($.cfg.ui.accentCycleSpeed) || 1, min: .2, max: 6, step: .2,
                    width: '116px', unit: '\u00d7', disabled: !U.accentCycling(),
                    onChange: function (v) { $.store.cfgSet('ui.accentCycleSpeed', v); }
                }))),
                W.row('UI scale', W.slider(W.ungated({
                    value: $.cfg.ui.scale, min: .75, max: 1.5, step: .05, width: '116px',
                    onChange: function (v) {
                        $.store.cfgSet('ui.scale', v); root.style.setProperty('--mm-scale', v);
                        // Scale transforms the window, so the strip's usable
                        // width changed even though nothing was resized.
                        var H = U.getHost(); if (H && H.fitTabs) H.fitTabs();
                    }
                }))),
                W.row('Opacity', W.slider(W.ungated({
                    value: Math.round($.cfg.ui.opacity * 100), min: 30, max: 100, unit: '%', width: '116px',
                    onChange: function (v) { $.store.cfgSet('ui.opacity', v / 100); root.style.setProperty('--mm-opacity', v / 100); }
                }))),
                W.toggleRow('Show FPS in footer', W.ungated({
                    value: $.cfg.ui.showFps,
                    onChange: function (v) { $.store.cfgSet('ui.showFps', v); }
                })),
                W.toggleRow('Show active-cheats HUD', W.ungated({
                    value: $.cfg.ui.showHud,
                    onChange: function (v) { $.store.cfgSet('ui.showHud', v); U.getHost().renderHud(); }
                })),
                h('div', { class: 'mm-sep' }),
                W.button({
                    label: 'reset window position', wide: true, _ungated: true,
                    onClick: function () {
                        $.cfg.ui.win = { left: 88, top: 36, width: 700, height: 520 };
                        $.cfg.ui.watch = { left: null, top: 300, right: 14, visible: $.cfg.ui.watch.visible };
                        $.store.saveSettings();
                        var host = U.getHost();
                        var w = host.win;
                        w.style.left = '88px'; w.style.top = '36px';
                        w.style.width = '700px'; w.style.height = '520px';
                        // Move the watch panel too, or it stays put until the
                        // next launch while claiming to have been reset.
                        if (host.watchEl) {
                            host.watchEl.style.left = 'auto';
                            host.watchEl.style.right = '14px';
                            host.watchEl.style.top = '300px';
                            host.watchEl.style.bottom = 'auto';
                        }
                        U.toast({ title: 'RESET', msg: 'Window and watch panel returned to their defaults', severity: 'ok' });
                    }
                })
            ], { tag: 'theme' })
        ], [
            W.group('Panels', [
                W.toggleRow('Watch panel', W.ungated({
                    value: U.isWatchOpen(),
                    sub: U.prettyCode($.cfg.hotkeys.watch),
                    onChange: function (v) { U.setWatch(v); }
                })),
                W.toggleRow('Log drawer open at start', W.ungated({
                    value: $.cfg.ui.logOpen,
                    onChange: function (v) { $.store.cfgSet('ui.logOpen', v); }
                }))
            ]),
            W.group('About', [
                kv('Build', $.codename + ' v' + $.version),
                kv('Engine', ($.caps.engine || 'unknown') + ' ' + ($.caps.engineVersion || '')),
                kv('Delivery', deliveryLabel(),
                    'Delivery|Detected from where this script sits, not assumed.'),
                null
            ], { collapsed: true })
        ]);
    }

    function buildBehaviour() {
        var root = U.getHost().root;
        return cols([
            W.group('Safety', [
                W.toggleRow('Read-only mode', W.ungated({
                    value: $.cfg.behaviour.readonly,
                    tip: 'Read-only|Blocks every write. Viewers, tables and overlays stay live.',
                    onChange: function (v) {
                        $.store.cfgSet('behaviour.readonly', v);
                        root.classList.toggle('mm-ro', v);
                        U.setActive('read-only', v);
                        $.log(v ? 'warn' : 'info', 'read-only mode ' + (v ? 'ON' : 'off'));
                    }
                })),
                W.toggleRow('Confirm dangerous actions', W.ungated({
                    value: $.cfg.behaviour.confirmDangerous,
                    tip: 'Confirm|Danger buttons arm on the first click, fire on the second.',
                    onChange: function (v) { $.store.cfgSet('behaviour.confirmDangerous', v); }
                })),
                W.toggleRow('Back up the save before dangerous actions', W.ungated({
                    value: $.cfg.behaviour.backupBeforeDanger,
                    sub: 'M4+',
                    tip: 'Backups|Teleports, forced events and bulk edits count as dangerous.',
                    onChange: function (v) { $.store.cfgSet('behaviour.backupBeforeDanger', v); }
                })),
                W.row('Backups to keep', W.number(W.ungated({
                    value: $.cfg.behaviour.backupKeep, min: 1, max: 200, step: 1, wide: true,
                    onChange: function (v) { $.store.cfgSet('behaviour.backupKeep', v); }
                })))
            ], { tag: 'guards' }),
            W.group('Undo', [
                W.row('Stack depth', h('span', { class: 'mm-mono mm-hi', text: String($.undo.size()) })),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'undo last action', wide: true, mutates: true,
                        onClick: function () { $.undo.pop(); U.rerender(); }
                    }),
                    W.button({
                        label: 'clear', variant: 'danger',
                        onClick: function () { $.undo.clear(); U.rerender(); }
                    })),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Simple edits only. Teleports, forced events, class changes and Forge ' +
                        'injections cannot be undone — a save backup is the only way back.')
            ], { tag: 'reversible only' })
        ], [
            W.group('Game', [
                W.toggleRow('Pause game while the menu is open', W.ungated({
                    value: $.cfg.behaviour.pauseGame,
                    // What pause actually holds differs by engine, and the
                    // hook module is the only thing that knows which
                    // functions it ended up gating. Ask it rather than
                    // describing one engine's frame loop here.
                    disabled: !pauseAvailable(),
                    sub: pauseAvailable() ? null : 'unavailable',
                    tip: 'Pause|' + pauseDescription(),
                    onChange: function (v) {
                        $.store.cfgSet('behaviour.pauseGame', v);
                        // Only badge it while the menu is actually open — which,
                        // if you are reading this toggle, it is.
                        U.setActive('paused', v && U.isOpen());
                    }
                })),
                W.toggleRow('Swallow game input while open', W.ungated({
                    value: $.cfg.behaviour.swallowInput,
                    tip: 'Input|Also freezes the player.',
                    onChange: function (v) { $.store.cfgSet('behaviour.swallowInput', v); }
                }))
            ]),
            W.group('Logging', [
                W.toggleRow('Log every write', W.ungated({
                    value: $.cfg.behaviour.logEveryWrite,
                    onChange: function (v) { $.store.cfgSet('behaviour.logEveryWrite', v); }
                })),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({
                        label: 'test toasts', _ungated: true,
                        onClick: function () {
                            U.toast({ title: 'OK', msg: 'This is what success looks like', severity: 'ok' });
                            setTimeout(function () { U.toast({ title: 'WARNING', msg: 'And this is a warning', severity: 'warn' }); }, 250);
                            setTimeout(function () { U.toast({ title: 'ERROR', msg: 'And this is a failure', severity: 'err' }); }, 500);
                        }
                    }),
                    W.button({
                        label: 'raise test error', _ungated: true,
                        onClick: function () {
                            $.safe(function () { throw new Error('deliberate test error'); }, 'settings self-test');
                            U.toast({ title: 'CAUGHT', msg: 'The error was contained — see the log', severity: 'ok' });
                        }
                    }))
            ])
        ]);
    }

    function buildHotkeys() {
        // The three binds the shell owns. Everything else is contributed by a
        // feature module through U.addHotkey and listed below, so a module
        // that is not installed contributes no dead key.
        var LABELS = {
            toggleMenu: ['Toggle menu', 'Opens and closes this window'],
            watch: ['Watch panel', 'Shows the floating watch panel'],
            panicHide: ['Panic hide', 'Hides the window and every float']
        };
        var rows = Object.keys(LABELS).map(function (k) {
            var kb;
            kb = W.keybind({
                key: $.cfg.hotkeys[k], modes: false,
                onChange: function (v) {
                    // Clearing the menu bind would lock the user out of the
                    // overlay entirely — the only way back would be the
                    // DevTools console. Refuse it and restore the old bind.
                    if (k === 'toggleMenu' && !v.key) {
                        kb.mm.set({ key: $.cfg.hotkeys.toggleMenu });
                        U.toast({
                            title: 'CANNOT CLEAR', severity: 'warn',
                            msg: 'The menu key is the only way back in — rebind it instead.'
                        });
                        return;
                    }
                    var clash = U.hotkeyClash(v.key, k);
                    if (clash) {
                        kb.mm.set({ key: $.cfg.hotkeys[k] });
                        U.toast({
                            title: 'ALREADY TAKEN', severity: 'warn',
                            msg: U.prettyCode(v.key) + ' is bound to "' + clash + '" — the second bind would never fire.'
                        });
                        return;
                    }
                    $.store.cfgSet('hotkeys.' + k, v.key);
                    $.log('info', LABELS[k][0] + ' → ' + (U.prettyCode(v.key) || 'unbound'));
                }
            });
            return W.row(LABELS[k][0], kb, { tip: LABELS[k][0] + '|' + LABELS[k][1] });
        });

        // Binds contributed by feature modules. Listed the same way, so a
        // module adding one does not have to know this panel exists.
        var extras = (U.hotkeyList() || []).map(function (d) {
            var kb;
            kb = W.keybind({
                key: $.cfg.hotkeys[d.id] || '', modes: false,
                onChange: function (v) {
                    // The keydown handler returns on the first match, so a
                    // second bind on the same key is not ambiguous — it is
                    // dead. Refuse it rather than showing it as bound.
                    var clash = U.hotkeyClash(v.key, d.id);
                    if (clash) {
                        kb.mm.set({ key: $.cfg.hotkeys[d.id] || '' });
                        U.toast({
                            title: 'ALREADY TAKEN', severity: 'warn',
                            msg: U.prettyCode(v.key) + ' is bound to "' + clash + '" — the second bind would never fire.'
                        });
                        return;
                    }
                    $.store.cfgSet('hotkeys.' + d.id, v.key || null);
                    $.log('info', (d.label || d.id) + ' → ' + (U.prettyCode(v.key) || 'unbound'));
                }
            });
            return W.row(d.label || d.id, kb,
                { tip: (d.label || d.id) + '|' + (d.help || 'contributed by a feature module') });
        });

        var taken = h('div', { class: 'mm-pre', text: gameKeyReport() });
        var claimedText = claimedKeyReport();

        return cols([
            W.group('GigaHack hotkeys', rows, { tag: 'rebindable' }),
            extras.length ? W.group('Feature hotkeys', extras.concat([
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Unbound by default where an accidental press would cost you something.')
            ]), { tag: extras.length + ' available' }) : null,
            null
        ], [
            W.group('Keys this game already uses', [taken], { tag: 'reference', collapsed: false }),
            claimedText
                ? W.group('Everything already claimed', [
                    h('div', { class: 'mm-pre', text: claimedText }),
                    h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                        'The defaults were picked from what this list left over.')
                ], { tag: 'derived', collapsed: true })
                : null
        ]);
    }

    /**
     * Who has already claimed each key.
     *
     * gameKeyReport() reads Input.keyMapper live and answers "what does this
     * game do with the letters". claimedKeys() adds the keys the engine
     * reserves for itself, and is the list the default binds were derived
     * from — so the two together explain both what is taken and why a
     * particular default was chosen.
     */
    function claimedKeyReport() {
        return $.safe(function () {
            if (!$.profile || !$.profile.claimedKeys) return null;
            var taken = $.profile.claimedKeys() || {};
            var keys = Object.keys(taken).sort();
            if (!keys.length) return null;
            return keys.map(function (k) {
                return pad(U.prettyCode(k) || k, 10) + '  →  ' + taken[k];
            }).join('\n');
        }, 'claimed key report', null);
    }

    function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

    function gameKeyReport() {
        return $.safe(function () {
            if (typeof Input === 'undefined' || !Input.keyMapper) return 'Input.keyMapper unavailable';
            var out = [], codes = Object.keys(Input.keyMapper).map(Number).sort(function (a, b) { return a - b; });
            codes.forEach(function (c) {
                if (c < 65 || c > 90) return;  // letters only — that is where collisions happen
                out.push(String.fromCharCode(c) + '  →  ' + Input.keyMapper[c]);
            });
            var free = [];
            for (var c = 65; c <= 90; c++) if (!Input.keyMapper[c]) free.push(String.fromCharCode(c));
            return out.join('\n') + '\n\nunbound letters: ' + (free.join(' ') || 'none');
        }, 'key report', 'unavailable');
    }

    /* =====================================================================
       COMPATIBILITY

       Four questions, in the order they earn their keep:
         1. are our aliases the outermost ones (load order)?
         2. which recognised plugin suites are here, and what do they cost?
         3. what has already failed a write-back this session?
         4. does the game agree, right now, when we actually try it?

       Nothing here is a guess: every string comes from $.compat, which owns
       the recognition table and the live tests.
       ===================================================================== */
    function stateColour(state) {
        if (state === 'pass') return 'var(--mm-ok)';
        if (state === 'fail' || state === 'error') return 'var(--mm-danger)';
        if (state === 'note') return 'var(--mm-warn)';
        return 'var(--mm-text-dim)';
    }

    function dot(colour, top) {
        return h('i', {
            class: 'mm-dotmark',
            style: 'background:' + colour + ';margin-right:6px' + (top ? ';margin-top:5px' : '')
        });
    }

    function buildCompatibility() {
        var K = $.compat;
        if (!K) {
            return todo('UNAVAILABLE', 'the compatibility module did not load', [
                'Load order, write verification and the self-tests all live there.',
                'Debug → Plugins says whether its file is present, readable and registered.'
            ]);
        }

        /* --- 1. load order ------------------------------------------- */
        var lo = $.safe(function () { return K.loadOrder(); }, 'load order',
            { known: false, last: false, after: [], why: 'the check threw — see the log' });
        var loRows = [
            h('div', { class: 'mm-row', style: 'align-items:flex-start' },
                dot(lo.last ? 'var(--mm-ok)' : lo.known ? 'var(--mm-warn)' : 'var(--mm-text-dim)', true),
                h('div', { class: 'mm-lab mm-selectable', style: 'white-space:normal', text: lo.why }))
        ];
        if (lo.after && lo.after.length) {
            loRows.push(h('div', { class: 'mm-sub mm-selectable', style: 'padding:2px;white-space:normal' },
                'loading after us: ' + lo.after.join(', ')));
        }
        if (!lo.last) {
            // The repair, naming the file on THIS install rather than a path
            // that happens to be right on one of the three layouts.
            loRows.push(h('div', { class: 'mm-pre mm-selectable' },
                'Move every GigaHack entry to the end of\n  ' + pluginListFile() +
                '\nso that its aliases are the outermost ones.'));
        }
        var loGroup = W.group('Load order', loRows,
            { tag: lo.last ? 'last' : lo.known ? 'not last' : 'unknown' });

        /* --- 2. frameworks ------------------------------------------- */
        var fw = $.safe(function () { return K.frameworks(); }, 'frameworks', []);
        var fwRows = fw.length ? [] : [h('div', { class: 'mm-empty', text: 'no recognised plugin suite is loaded' })];
        fw.forEach(function (f) {
            fwRows.push(h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: f.name }),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-selectable mm-breakall',
                    text: (f.plugins || []).join(', ')
                })));
            fwRows.push(h('div', { class: 'mm-sub mm-selectable', style: 'padding:0 2px 4px;white-space:normal' },
                f.note));
            if (f.affects && f.affects.length) {
                fwRows.push(h('div', { class: 'mm-sub', style: 'padding:0 2px 6px;color:var(--mm-warn)' },
                    'affects: ' + f.affects.join(', ')));
            }
        });
        var fwGroup = W.group('Recognised plugin suites', fwRows,
            { tag: fw.length ? fw.length + ' found' : 'none' });

        /* --- 3. degraded controls ------------------------------------ */
        var deg = $.safe(function () { return K.degradedList(); }, 'degraded list', []);
        var degRows = deg.length ? [] : [h('div', { class: 'mm-empty', text: 'nothing has failed a write-back this session' })];
        deg.forEach(function (d) {
            degRows.push(h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab mm-mono', text: d.control }),
                h('div', { class: 'mm-edge mm-sub', text: 'degraded' })));
            degRows.push(h('div', { class: 'mm-sub mm-selectable', style: 'padding:0 2px 6px;white-space:normal' },
                d.why));
        });
        if (deg.length) {
            degRows.push(W.button({
                label: 'clear and try again', wide: true, _ungated: true,
                tip: 'Clear|Worth doing after changing the plugin setting that caused it.',
                onClick: function () { K.clearDegraded(); U.rerender(); }
            }));
        }
        var degGroup = W.group('Degraded controls', degRows,
            { tag: deg.length ? deg.length + ' degraded' : 'none' });

        /* --- 4. live self-tests -------------------------------------- */
        var run = K.lastRun;
        var results = (run && run.results) || [];
        var testRows = results.length ? [] : [h('div', { class: 'mm-empty', text: 'not run yet' })];
        results.forEach(function (r) {
            var colour = stateColour(r.state);
            testRows.push(h('div', { class: 'mm-row', style: 'align-items:flex-start' },
                dot(colour, true),
                h('div', { class: 'mm-lab', style: 'white-space:normal' },
                    h('div', { text: r.name }),
                    h('div', { class: 'mm-sub mm-selectable', style: 'white-space:normal', text: r.detail || '' })),
                h('div', { class: 'mm-edge mm-mono mm-sub', style: 'color:' + colour, text: r.state })));
        });
        var counts = { pass: 0, fail: 0, note: 0, skipped: 0, error: 0 };
        results.forEach(function (r) { if (counts[r.state] !== undefined) counts[r.state]++; });
        var testGroup = W.group('Live self-tests', [
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Run against the live game; every test restores what it touched. What they ' +
                'learn is what greys a control.'),
            W.button({
                label: 'Run self-tests', wide: true, mutates: true,
                tip: 'Run|Writes to game state and reads it back. Refused in read-only mode.',
                onClick: function () {
                    $.safe(function () { K.selfTest(); }, 'run self-tests');
                    U.rerender();
                }
            })
        ].concat(testRows).concat([
            run ? h('div', { class: 'mm-sub', style: 'padding:2px' },
                'last run ' + new Date(run.at).toLocaleTimeString()) : null
        ]), {
            grow: true,
            tag: results.length
                ? counts.pass + ' pass · ' + counts.fail + ' fail · ' + counts.skipped + ' skipped'
                : 'not run'
        });

        return cols([loGroup, fwGroup], [degGroup, testGroup]);
    }

    /* =====================================================================
       INDEX

       The index is for FINDING, never authority — every query returns
       candidates the caller re-resolves against the live database. What this
       panel is for is the other half of that bargain: what it cost to build,
       and whether each stage is worth keeping. The benchmark is the whole
       argument: a stage that cannot show a measured saving gets retired.
       ===================================================================== */
    var lastBench = null;

    function buildIndex() {
        var X = $.index;
        if (!X) {
            return todo('UNAVAILABLE', 'the index module did not load', [
                'Search falls back to scanning the live database — slower, but it works.',
                'Debug → Plugins says whether its file is present, readable and registered.'
            ]);
        }
        var st = $.safe(function () { return X.status(); }, 'index status', null);
        if (!st) {
            return todo('UNAVAILABLE', 'the index would not report its status',
                ['See the log — the call threw.']);
        }

        /* --- status --------------------------------------------------- */
        var statusRows = [
            kv('Phase', st.phase, 'Phase|idle · building · ready · failed · disabled'),
            kv('Progress', Math.round((st.progress || 0) * 100) + '%' + (st.stage ? '  —  ' + st.stage : '')),
            kv('Built', st.built ? new Date(st.built).toLocaleString() : '—'),
            kv('Source', st.fromCache ? 'loaded from cache' : 'built this session')
        ];
        if (st.error) {
            statusRows.push(h('div', { class: 'mm-sub mm-selectable', style: 'padding:2px;white-space:normal;color:var(--mm-danger)', text: String(st.error) }));
        }
        statusRows.push(h('div', { class: 'mm-inline', style: 'padding:4px 2px' },
            W.button({
                label: 'refresh', _ungated: true,
                onClick: function () { U.rerender(); }
            }),
            W.button({
                label: 'Rebuild index', variant: 'danger', mutates: true,
                confirmLabel: 'rebuild it?',
                tip: 'Rebuild|Reads the database again. Nothing in the game is touched.',
                onClick: function () {
                    $.safe(function () { X.rebuild(); }, 'index rebuild');
                    U.toast({ title: 'REBUILDING', msg: 'the index is being rebuilt in the background', severity: 'ok' });
                    U.rerender();
                }
            })));

        /* --- counts --------------------------------------------------- */
        var countRows = [];
        if (st.counts) {
            Object.keys(st.counts).forEach(function (k) {
                if (st.counts[k] === null || st.counts[k] === undefined) return;
                countRows.push(kv(k, st.counts[k]));
            });
        }
        if (!countRows.length) countRows.push(h('div', { class: 'mm-empty', text: 'nothing indexed yet' }));

        /* --- notes: why a query would be incomplete ------------------- */
        var notes = (st.notes || []).map(function (n) {
            return h('div', { class: 'mm-sub mm-selectable', style: 'padding:2px;white-space:normal', text: n });
        });
        var notesGroup = notes.length
            ? W.group('Notes', notes.concat([
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Every incomplete query carries one of these as its reason.')
            ]), { tag: notes.length + '' })
            : null;

        /* --- timings -------------------------------------------------- */
        var timings = $.safe(function () { return X.timings(); }, 'index timings', []);
        var timingTable = W.table({
            cols: [
                { label: 'stage', w: '1 1 0' },
                { label: 'ms', w: '0 0 62px', cls: 'mm-td-num' }
            ],
            empty: 'no stage has been timed yet',
            render: function (r) {
                return [h('span', { class: 'mm-cell mm-selectable', text: r.stage }), String(r.ms)];
            }
        });
        timingTable.mm.paint(timings);
        var total = timings.reduce(function (a, r) { return a + (r.ms || 0); }, 0);

        /* --- benchmark ------------------------------------------------ */
        var benchRows = lastBench || [];
        var benchTable = W.table({
            cols: [
                { label: 'measurement', w: '1 1 0' },
                { label: 'ms', w: '0 0 52px', cls: 'mm-td-num' },
                { label: 'detail', w: '0 0 150px' }
            ],
            empty: 'not measured yet — press Benchmark',
            render: function (r) {
                return [
                    h('span', { class: 'mm-cell mm-selectable', text: r.what }),
                    String(r.ms),
                    h('span', { class: 'mm-cell mm-sub', text: r.detail || '' })
                ];
            },
            onRow: function (tr, r) {
                if (r.detail) tr.setAttribute('data-mm-tip', r.what + '|' + r.detail);
            }
        });
        benchTable.mm.paint(benchRows);

        var benchGroup = W.group('Benchmark', [
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'The same question asked with the index and without it, back to back.'),
            W.button({
                label: 'Benchmark', wide: true, _ungated: true,
                onClick: function () {
                    lastBench = $.safe(function () { return X.benchmark(); }, 'index benchmark', []);
                    U.rerender();
                }
            }),
            benchTable
        ], { grow: true, tag: benchRows.length ? benchRows.length + ' measured' : 'not run' });

        return cols(
            [W.group('Status', statusRows, { tag: st.phase }),
             W.group('Contents', countRows, { tag: 'counts' }),
             notesGroup],
            [W.group('Build cost', [
                timingTable,
                h('div', { class: 'mm-sub', style: 'padding:4px 2px;white-space:normal' },
                    'Slowest first. Total ' + total + 'ms' +
                    (st.fromCache ? ' when it was last built — this session loaded the cache.' : '.'))
            ], { tag: total + 'ms' }),
             benchGroup]
        );
    }

})(window.GigaHack);
