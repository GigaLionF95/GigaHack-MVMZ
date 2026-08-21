//=============================================================================
// GigaHack MV/MZ
// 05 · shell.js — overlay host, window shell, tab system, hotkeys, floats
//-----------------------------------------------------------------------------
// The overlay is a plain DOM layer over the game canvas, which is the only
// way to get a usable menu on both engines: MV and MZ share almost nothing
// above Window_Base, and they share the whole DOM.
//
// Two engine facts shape the mount and are handled in one place, at the bottom
// of this file: an engine may zero every positive INLINE z-index while it
// boots, and it may disable text selection document-wide. Both are asked for
// as capabilities ($.caps.zIndexClobber, $.caps.textSelectionBlocked) rather
// than by engine name, because a plugin can introduce or remove either.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — overlay shell
 * @author gigahack
 * @help GigaHack_Shell.js — requires Core, Caps, Store, Profile, UI
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.h) { console.error('[GigaHack] ui missing — shell not installed'); return; }

    var U = $.ui;
    var h = U.h, add = U.add, clear = U.clear, clamp = U.clamp, ICON = U.ICON, W = U.w;

    /* =====================================================================
       Tab registry — tabs register themselves; the shell knows nothing about
       any particular feature. `GigaHack.ui.tab({id,label,icon,subs,build})`.
       ===================================================================== */
    var TABS = [];
    U.tabs = TABS;
    U.tab = function (def) {
        var existing = TABS.filter(function (t) { return t.id === def.id; })[0];
        if (existing) { TABS[TABS.indexOf(existing)] = def; }
        else TABS.push(def);
        if (HOST && HOST.rebuildTabs) HOST.rebuildTabs();
        return def;
    };

    var HOST = null;
    var host = null;   // #gigahack-host element
    var winEl = null, watchEl = null, hudEl = null, inspectEl = null;
    var open = false;

    /* =====================================================================
       Accent presets (from ui-design/SPEC.md §1)
       ===================================================================== */
    var ACCENTS = [
        { name: 'blue-violet', hex: '#6c7ae0' },
        { name: 'cyan', hex: '#35c6d8' },
        { name: 'green', hex: '#62b56a' },
        { name: 'orange', hex: '#d98a3c' },
        { name: 'pink', hex: '#d3609b' }
    ];
    U.accents = ACCENTS;

    /* =====================================================================
       Window shell
       ===================================================================== */
    function buildWindow() {
        var cfg = $.cfg;

        var pin = h('button', { class: 'mm-icobtn', tip: 'Pin|Keep the window in place while the game runs' }, ICON.pin());
        var op = h('button', { class: 'mm-icobtn', tip: 'Opacity|Cycle 100 / 80 / 55 %' }, ICON.opacity());
        var close = h('button', { class: 'mm-icobtn mm-close', tip: 'Close|Press ' + U.prettyCode(cfg.hotkeys.toggleMenu) + ' to bring it back' }, ICON.close());

        // Which game this session is attached to. Read from the resolved
        // profile, never written into the build: an edition name baked into
        // the title bar is wrong on every game but one.
        //
        // Repainted on the shell clock rather than set once, because the
        // overlay mounts before DataManager has loaded $dataSystem — at mount
        // time the profile has no title to give, and an empty slot that fills
        // in a moment beats a placeholder that visibly changes.
        var gameName = h('div', { class: 'mm-ver', style: 'overflow:hidden;text-overflow:ellipsis;min-width:0' });

        var bar = h('div', { class: 'mm-titlebar' },
            // Wrapped so the wordmark and the version share a baseline. Left as
            // two siblings of a centre-aligned bar, the smaller mono version
            // rode visibly above the wordmark it sits next to.
            h('div', { class: 'mm-brandwrap' },
                h('div', { class: 'mm-brand' }, 'GIGA', h('span', {}, 'HACK')),
                h('div', { class: 'mm-ver', text: 'v' + $.version })),
            h('div', { class: 'mm-title-sep' }),
            gameName,
            pin, op, close);

        var strip = h('div', { class: 'mm-tabs' });
        var subs = h('div', { class: 'mm-subtabs' });
        var content = h('div', { class: 'mm-body', style: 'flex:1 1 auto' });

        /* --- log drawer --- */
        var logBody = h('div', { class: 'mm-log-bd' });
        var logCount = h('span', { class: 'mm-group-tag', text: '0 lines' });
        var logHd = h('button', { class: 'mm-log-hd' }, h('i', { class: 'mm-caret' }), h('span', { text: 'Log' }), logCount);
        var log = h('div', { class: 'mm-log' + (cfg.ui.logOpen ? '' : ' mm-collapsed') }, logHd, logBody);
        logHd.addEventListener('click', function () {
            log.classList.toggle('mm-collapsed');
            $.store.cfgSet('ui.logOpen', !log.classList.contains('mm-collapsed'));
        });

        /* --- footer --- */
        var fps = h('b', { text: '—' });
        var cheats = h('b', { text: '0' });
        var coords = h('b', { text: 'no map' });
        var footer = h('div', { class: 'mm-footer' },
            h('span', {}, h('kbd', { text: U.prettyCode(cfg.hotkeys.toggleMenu) }), ' menu'),
            h('span', {}, h('kbd', { text: U.prettyCode(cfg.hotkeys.watch) }), ' watch'),
            h('div', { class: 'mm-title-sep' }),
            h('span', {}, 'fps ', fps),
            h('span', {}, coords),
            h('span', {}, 'active ', cheats));

        var grip = h('div', { class: 'mm-grip' });
        var win = h('div', {
            class: 'mm-win',
            style: 'left:' + cfg.ui.win.left + 'px;top:' + cfg.ui.win.top + 'px;' +
                'width:' + cfg.ui.win.width + 'px;height:' + cfg.ui.win.height + 'px;display:none'
        }, bar, h('div', { class: 'mm-accent-rule' }), strip, subs, content, log, footer, grip);

        /* --- tab strip (rebuildable, so late-registering tabs appear) --- */
        function rebuildTabs() {
            clear(strip);
            TABS.forEach(function (t) {
                var icon = ICON[t.icon] ? ICON[t.icon]() : ICON.dot();
                var el = h('button', { class: 'mm-tab', tip: t.label + '|' + ((t.subs || []).join(' / ') || t.hint || '') },
                    icon, h('span', { class: 'mm-tab-label', text: t.label }));
                el.addEventListener('click', function () {
                    $.cfg.ui.tab = t.id; $.store.saveSettings(); renderTab();
                });
                t.el = el;
                strip.appendChild(el);
            });
            if (!TABS.some(function (t) { return t.id === $.cfg.ui.tab; }) && TABS.length) {
                $.cfg.ui.tab = TABS[0].id;
            }
            fitTabs();
            renderTab();
        }

        /**
         * Icon-only fallback when the strip runs out of room.
         *
         * Measured rather than counted: the window is resizable and the UI
         * scale is a setting, so "how many tabs fit" is not a constant. A tab
         * needs its icon (14px) plus enough for a few characters before the
         * ellipsis makes the label useless — below MIN_TAB the words are
         * dropped and the tooltip carries the name instead.
         *
         * Guarded on offsetWidth being non-zero: the strip is measured during
         * a rebuild that can happen while the window is display:none, and a
         * zero measurement would flip every tab to icon-only and leave it
         * there until the next rebuild.
         */
        // Raised for 1.0: at ten tabs a 520px window gives each 52px, which fits
        // the icon and about four characters — "VARIA…", "TELEP…". Below this the
        // label stops distinguishing anything and the tooltip does the work.
        var MIN_TAB = 62;
        function fitTabs() {
            $.safe(function () {
                var w = strip.offsetWidth;
                if (!w || !TABS.length) return;
                strip.classList.toggle('mm-tabs-tight', (w / TABS.length) < MIN_TAB);
            }, 'fit tabs');
        }
        HOST.fitTabs = fitTabs;

        /* Scroll memory across a tab rebuild.
           renderTab() throws the whole panel away and builds a fresh one, so
           every scrollable element inside it is a brand-new node starting at
           the top. Any action that calls ui.rerender() — selecting a map,
           editing a param, pinning a variable — therefore yanked long lists
           back to row one. Offsets are remembered per tab+sub and restored by
           position, which is stable because a rebuild produces the same
           structure. The browser clamps anything now out of range.

           "The same structure" is the assumption, and a tab can break it: the
           Forge's Item sub-tab edits items, weapons or armors under one sub
           name, and those are three different sets of panels. Restoring an
           offset taken from the taller one into the shorter one gets clamped
           to its bottom, so switching type appeared to jump to the end of the
           list. A tab that renders structurally different content under one
           sub declares it with scope(sub), and gets its own slot. */
        var scrollMemory = Object.create(null);
        var currentKey = null;
        // .mm-out is the M11 console's scrollback: a rerender rebuilds the
        // panel, so without it here every repaint of any control on that tab
        // threw the reader back to the first line of output.
        var SCROLLABLE = '.mm-tbody, .mm-col, .mm-out';

        function snapshotScroll() {
            if (!currentKey) return;
            scrollMemory[currentKey] = Array.prototype.map.call(
                content.querySelectorAll(SCROLLABLE), function (el) { return el.scrollTop; });
        }

        function restoreScroll(key) {
            var mem = scrollMemory[key];
            if (!mem) return;
            var els = content.querySelectorAll(SCROLLABLE);
            for (var i = 0; i < els.length && i < mem.length; i++) {
                if (!mem[i]) continue;
                els[i].scrollTop = mem[i];
                // A virtualised body needs to re-window against the new offset.
                var owner = els[i].parentNode;
                if (owner && owner.mm && owner.mm.refresh) $.safe(owner.mm.refresh, 'restore scroll');
            }
        }

        function renderTab() {
            if (!TABS.length) return;
            var t = null;
            TABS.forEach(function (x) {
                if (!x.el) return;
                x.el.classList.toggle('mm-on', x.id === $.cfg.ui.tab);
                if (x.id === $.cfg.ui.tab) t = x;
            });
            if (!t) t = TABS[0];
            snapshotScroll();
            HOST.tickHooks.length = 0;
            HOST.fastHooks.length = 0;
            U.closePopup();
            clear(subs); clear(content);

            (t.subs || []).forEach(function (sname) {
                if (!$.cfg.ui.sub[t.id]) $.cfg.ui.sub[t.id] = t.subs[0];
                var sb = h('button', { class: 'mm-subtab' + ($.cfg.ui.sub[t.id] === sname ? ' mm-on' : '') },
                    h('i', {}), h('span', { text: sname }));
                sb.addEventListener('click', function () {
                    $.cfg.ui.sub[t.id] = sname; $.store.saveSettings(); renderTab();
                });
                subs.appendChild(sb);
            });
            subs.appendChild(h('div', { class: 'mm-title-sep' }));
            var sc = $.cfg.ui.sub[t.id] && String($.cfg.ui.sub[t.id]).toLowerCase() !== t.id
                ? '.' + String($.cfg.ui.sub[t.id]).toLowerCase().replace(/\s+/g, '-') : '';
            subs.appendChild(h('div', { class: 'mm-crumb', text: 'gh.' + t.id + sc }));

            var node = $.safe(function () { return t.build($.cfg.ui.sub[t.id]); }, 'tab "' + t.id + '" build');
            if (!node) {
                node = h('div', { class: 'mm-body' },
                    h('div', { class: 'mm-todo' },
                        h('b', { text: 'tab failed to build' }),
                        h('div', { text: 'see the log drawer for the error' })));
            }
            node.classList.remove('mm-body');
            node.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;overflow:hidden';
            content.appendChild(node);
            content.className = 'mm-body';

            var scope = t.scope ? $.safe(function () { return t.scope($.cfg.ui.sub[t.id]); }, 'tab scope', '') : '';
            currentKey = t.id + '/' + ($.cfg.ui.sub[t.id] || '') + (scope ? '/' + scope : '');
            restoreScroll(currentKey);
        }

        HOST.renderTab = renderTab;
        HOST.rebuildTabs = rebuildTabs;
        HOST.logBody = logBody;
        HOST.logCount = logCount;
        HOST.footer = { fps: fps, cheats: cheats, coords: coords };
        HOST.win = win;

        /* --- title bar behaviour --- */
        U.makeDraggable(bar, win, HOST.root, function (l, t) {
            $.cfg.ui.win.left = Math.round(l);
            $.cfg.ui.win.top = Math.round(t);
            $.store.saveSettings();
        });

        pin.addEventListener('click', function () {
            HOST.pinned = !HOST.pinned;
            pin.classList.toggle('mm-on', HOST.pinned);
            $.log('info', 'pin ' + (HOST.pinned ? 'on' : 'off'));
        });

        var opSteps = [1, .8, .55];
        op.addEventListener('click', function () {
            var i = opSteps.indexOf($.cfg.ui.opacity);
            var next = opSteps[(i + 1 + opSteps.length) % opSteps.length];
            if (i === -1) next = opSteps[1];
            $.store.cfgSet('ui.opacity', next);
            HOST.root.style.setProperty('--mm-opacity', next);
            op.classList.toggle('mm-on', next < 1);
        });

        close.addEventListener('click', function () { setOpen(false); });

        /* --- resize --- */
        grip.addEventListener('pointerdown', function (e) {
            e.preventDefault(); grip.setPointerCapture(e.pointerId);
            var r = win.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
            var scale = $.cfg.ui.scale || 1;
            function mv(ev) {
                win.style.width = clamp(r.width / scale + (ev.clientX - sx) / scale, 520, 1400) + 'px';
                win.style.height = clamp(r.height / scale + (ev.clientY - sy) / scale, 320, 1000) + 'px';
                fitTabs();   // during the drag, not after: a label that wraps changes the strip height
            }
            function up() {
                grip.removeEventListener('pointermove', mv);
                grip.removeEventListener('pointerup', up);
                grip.removeEventListener('pointercancel', up);
                $.cfg.ui.win.width = Math.round(parseFloat(win.style.width));
                $.cfg.ui.win.height = Math.round(parseFloat(win.style.height));
                $.store.saveSettings();
                if (HOST.renderTab) HOST.renderTab();  // let virtual tables re-measure
            }
            grip.addEventListener('pointermove', mv);
            grip.addEventListener('pointerup', up);
            grip.addEventListener('pointercancel', up);
        });

        /* The title-bar game name. Truncated rather than allowed to wrap:
           the bar is one row and the buttons on its right must stay reachable
           however long a game calls itself. */
        var NAME_MAX = 42;
        function paintGameName() {
            var label = $.safe(function () {
                var prof = ($.profile && $.profile.active) ? $.profile.active() : null;
                if (!prof) return '';
                // prof.title is null until the database has loaded; prof.name
                // falls back to a generic phrase, which is not worth printing.
                return prof.title || (prof.generic ? '' : (prof.name || ''));
            }, 'profile name', '') || '';
            label = String(label);
            if (label.length > NAME_MAX) label = label.slice(0, NAME_MAX - 1) + '…';
            if (gameName.textContent === label) return;
            gameName.textContent = label;
            gameName.setAttribute('data-mm-tip', label ? 'Game|' + label : '');
        }
        paintGameName();

        /* --- 700ms clock, per the mockup's HOST.tickHooks contract --- */
        var n = 0;
        HOST.clock = setInterval(function () {
            n++;
            $.safe(function () {
                // $.eng.fps() reads whichever counter this engine keeps and
                // returns null when neither is there — a plugin that replaces
                // the renderer takes both away, and the readout degrades to a
                // dash rather than throwing once every 700ms. The value is
                // 1000/frameTime, a float, so it has to be rounded or the 18px
                // footer prints "59.880239…".
                var f = $.eng ? $.eng.fps() : null;
                fps.textContent = ($.cfg.ui.showFps && f) ? String(Math.round(f)) : '—';
                coords.textContent = mapLabel();
                cheats.textContent = String(Object.keys(HOST.active).length);
                paintGameName();
                HOST.tickHooks.forEach(function (fn) { try { fn(n); } catch (e) { } });
            }, 'shell clock');
        }, 700);

        rebuildTabs();
        return win;
    }

    function mapLabel() {
        if (typeof $gameMap === 'undefined' || !$gameMap || !$gameMap.mapId || !$gameMap.mapId()) return 'no map';
        var id = $gameMap.mapId();
        var x = (typeof $gamePlayer !== 'undefined' && $gamePlayer) ? $gamePlayer.x : '?';
        var y = (typeof $gamePlayer !== 'undefined' && $gamePlayer) ? $gamePlayer.y : '?';
        return 'MAP ' + id + ' · ' + x + ',' + y;
    }

    /* =====================================================================
       Floating components
       ===================================================================== */
    /* ---------------------------------------------------------------------
       Watch-panel providers.
       A registry rather than a single `watchProvider` slot: with one slot,
       whichever module happened to load last silently won, which is exactly
       how M2's bookmarks got clobbered by M1's fallback readout. Providers are
       tried highest priority first and the first non-empty result is shown.
       The registry lives on the module, not on HOST, so registration works
       before or after mount.
       ------------------------------------------------------------------ */
    var watchProviders = [];

    U.addWatchProvider = function (fn, priority) {
        watchProviders.push({ fn: fn, priority: priority || 0 });
        watchProviders.sort(function (a, b) { return b.priority - a.priority; });
        if (HOST && HOST.watchPaint) HOST.watchPaint();
        return fn;
    };

    U.watchRows = function () {
        for (var i = 0; i < watchProviders.length; i++) {
            var rows = $.safe(watchProviders[i].fn, 'watch provider', null);
            if (rows && rows.length) return rows;
        }
        return [];
    };

    function buildWatch() {
        var body = h('div', { class: 'mm-watch-bd' });
        var hd = h('div', { class: 'mm-float-hd' }, h('span', { text: 'Watch' }),
            h('div', { class: 'mm-title-sep' }),
            h('button', {
                class: 'mm-icobtn', style: 'width:12px;height:12px',
                onclick: function () { setWatch(false); }
            }, ICON.close()));
        var w = $.cfg.ui.watch;
        var style = 'top:' + (w.top == null ? 300 : w.top) + 'px;display:none;';
        style += (w.left == null) ? 'right:' + (w.right == null ? 14 : w.right) + 'px;' : 'left:' + w.left + 'px;';
        // A right-anchored box scaled about its own LEFT corner grows off the
        // screen edge; scaled about its right corner it grows inward. The
        // anchor changes the moment it is dragged, so the origin follows it.
        style += 'transform-origin:' + (w.left == null ? '100% 0' : '0 0') + ';';
        var panel = h('div', { class: 'mm-float mm-watch', style: style }, hd, body);

        function paint() {
            clear(body);
            var items = U.watchRows();
            if (!items || !items.length) {
                body.appendChild(h('div', { class: 'mm-empty', style: 'padding:6px', text: 'nothing pinned' }));
                return;
            }
            items.forEach(function (it) {
                body.appendChild(h('div', { class: 'mm-watch-row' },
                    h('span', { text: it.label }), h('span', { text: String(it.value) })));
            });
        }
        HOST.watchPaint = paint;
        U.makeDraggable(hd, panel, HOST.root, function (l, t) {
            $.cfg.ui.watch.left = Math.round(l);
            panel.style.transformOrigin = '0 0';   // now anchored by its left edge
            $.cfg.ui.watch.top = Math.round(t);
            $.store.saveSettings();
        });
        paint();
        return panel;
    }

    function buildHud() {
        var hud = h('div', { class: 'mm-hud', style: 'right:16px;top:132px;align-items:flex-end' });
        function paint() {
            clear(hud);
            if (!$.cfg.ui.showHud) return;
            var keys = Object.keys(HOST.active);
            if (!keys.length) return;
            hud.appendChild(h('div', { class: 'mm-hud-row' }, h('s', { text: keys.length + ' active' })));
            keys.forEach(function (k) { hud.appendChild(h('div', { class: 'mm-hud-row' }, h('i', {}), k)); });
        }
        HOST.renderHud = paint;
        paint();
        return hud;
    }

    /** Active-cheats HUD registry. setActive('noclip', true) */
    function setActive(name, on) {
        if (on) HOST.active[name] = true; else delete HOST.active[name];
        if (HOST.renderHud) HOST.renderHud();
    }

    /* Inspect layer is created empty in M1 and owned by M6. */
    function buildInspect() {
        return h('div', { class: 'mm-inspect', style: 'display:none' });
    }

    /* =====================================================================
       Open / close + input swallowing
       ===================================================================== */
    function setOpen(v) {
        if (open === v) return;
        open = v;
        if (winEl) winEl.style.display = v ? 'flex' : 'none';
        // Popups live in the floating layer, not inside the window, so hiding
        // the window alone would leave a colour picker or keybind popup painted
        // over the game and still eating clicks.
        U.closePopup();
        // The pause only applies while the menu is open, so the HUD badge has
        // to track the actual state, not the persisted setting.
        setActive('paused', v && !!$.cfg.behaviour.pauseGame);
        $.safe(function () {
            if (typeof $gameTemp !== 'undefined' && $gameTemp) $gameTemp._gigahackOpen = v;
        }, 'set $gameTemp flag');
        // Drop any half-pressed key/button state so the game does not act on
        // the keystroke that opened us.
        $.safe(function () { if (typeof Input !== 'undefined') Input.clear(); }, 'Input.clear');
        $.safe(function () { if (typeof TouchInput !== 'undefined') TouchInput.clear(); }, 'TouchInput.clear');
        // Rebuild the active tab on open: virtualised tables measure their
        // viewport, and while the window was display:none that measured zero.
        if (v && HOST && HOST.renderTab) $.safe(HOST.renderTab, 'render on open');
        $.emit('overlay', v);
    }

    /** Hide everything GigaHack draws, immediately. */
    function panicHide() {
        U.closePopup();
        setOpen(false);
        setWatch(false);
        if (HOST && HOST.toasts) clear(HOST.toasts);
        hideInspect();
    }

    /* The inspect layer itself is an empty hidden div while the M6 module is
       disabled — kept so re-enabling that module is a one-flag change rather
       than surgery on the shell.

       One place hides the inspect layer, so whoever owns its behaviour (M6)
       always hears about it. Setting display:none from two places directly
       would leave that module's own state — and its recording hook — on. */
    function hideInspect() {
        if (!inspectEl || inspectEl.style.display === 'none') return false;
        inspectEl.style.display = 'none';
        $.emit('inspect:hidden');
        return true;
    }
    U.hideInspect = hideInspect;
    U.isInspectOpen = function () { return !!inspectEl && inspectEl.style.display !== 'none'; };
    U.panicHide = panicHide;
    U.setOpen = setOpen;
    U.isOpen = function () { return open; };
    U.toggle = function () { setOpen(!open); };

    function setWatch(v) {
        if (!watchEl) return;
        watchEl.style.display = v ? 'block' : 'none';
        $.store.cfgSet('ui.watch.visible', v);
        if (v && HOST.watchPaint) HOST.watchPaint();
    }
    U.setWatch = setWatch;
    U.isWatchOpen = function () { return !!watchEl && watchEl.style.display !== 'none'; };

    /* =====================================================================
       Hotkeys

       Bound on `window` in the CAPTURE phase, which runs before the engine's
       own document-level keydown listener on both MV and MZ. That is what lets
       the overlay swallow game input while it is open.

       INVARIANT: GigaHack never adds an entry to Input.keyMapper. Games
       commonly ship key-rebinding menus that iterate keyMapper and present
       whatever they find as one of the game's own controls; an extra entry
       there shows up as a control the player cannot make sense of, and a
       rebind pass can hand our key to something else or drop it. Binding at
       the DOM instead keeps the two sets of keys entirely separate, and is
       also the only way to intercept a key the engine itself listens for.
       ===================================================================== */
    /**
     * Binds contributed by feature modules.
     *
     * The four built-ins below are hard-coded because the shell owns them, but
     * M11 wants quick-save, quick-load and one bind per saved snippet, and
     * M10 will want noclip and godmode. A module registers what it can do and
     * the key comes from $.cfg.hotkeys[id], like every other bind — so the
     * Settings panel lists them without knowing what they are.
     */
    var extraKeys = [];

    U.addHotkey = function (def) {
        if (!def || !def.id) return null;
        extraKeys = extraKeys.filter(function (d) { return d.id !== def.id; });
        extraKeys.push(def);
        return def;
    };
    U.removeHotkey = function (id) {
        extraKeys = extraKeys.filter(function (d) { return d.id !== id; });
    };
    U.hotkeyList = function () { return extraKeys.slice(); };

    var BUILTIN_LABELS = {
        toggleMenu: 'Toggle menu', watch: 'Watch panel',
        panicHide: 'Panic hide'
    };

    /**
     * Which OF OUR OWN binds already owns this key, if any.
     *
     * The keydown handler tests the built-ins first and returns on the first
     * match, then walks extraKeys and returns on the first match there — so a
     * duplicate bind is not ambiguous, it is simply dead, and the panel used to
     * show it as bound anyway. Returns the label of the owner, or null; a
     * caller that treats a non-null answer as a refusal is right to.
     */
    U.hotkeyClash = function (code, exceptId) {
        if (!code) return null;
        var hk = $.cfg.hotkeys || {}, id;
        for (id in BUILTIN_LABELS) {
            if (id !== exceptId && hk[id] === code) return BUILTIN_LABELS[id];
        }
        for (var i = 0; i < extraKeys.length; i++) {
            var d = extraKeys[i];
            if (d.id !== exceptId && hk[d.id] === code) return d.label || d.id;
        }
        return null;
    };

    /**
     * Who ELSE has claimed this key — the engine, or the game through its own
     * Input.keyMapper. $.profile.claimedKeys() is the one place that knows.
     *
     * Deliberately NOT folded into hotkeyClash: an outside claim is not a
     * clash. Our handler runs at window capture and stops the event, so our
     * bind fires either way; what is lost is the GAME's action on that key.
     * That is a thing to be told about, not to be refused — a game whose
     * plugins map half the alphabet would otherwise leave nothing bindable.
     *
     * Returns the claimant's description, or null.
     */
    U.hotkeyClaim = function (code) {
        if (!code) return null;
        var claimed = $.safe(function () {
            return ($.profile && typeof $.profile.claimedKeys === 'function')
                ? $.profile.claimedKeys() : null;
        }, 'claimed keys', null);
        return (claimed && claimed[code]) ? String(claimed[code]) : null;
    };

    /**
     * The whole picture for one key, with the sentence already written.
     *   { code, mine, claimedBy, blocking, message }
     * `blocking` is true only for a dead bind of ours.
     */
    U.hotkeyClashReport = function (code, exceptId) {
        var mine = U.hotkeyClash(code, exceptId);
        var claim = U.hotkeyClaim(code);
        var pretty = U.prettyCode ? U.prettyCode(code) : code;
        var msg = '';
        if (mine) {
            msg = pretty + ' is already bound to "' + mine + '" — the second bind would never fire.';
        } else if (claim) {
            msg = pretty + ' is claimed by ' + claim +
                '. GigaHack sees the key first, so the game will not act on it while the bind is set.';
        }
        return { code: code || null, mine: mine, claimedBy: claim, blocking: !!mine, message: msg };
    };

    /* Say it once, per key, when a bind lands on a key somebody else owns.
       Fired from the settings panel's write rather than from the panel itself,
       so any route to a rebind — panel, console, imported settings profile —
       gets the same warning. */
    var claimWarned = {};
    function warnClaimedBind(id, code, quiet) {
        if (!code || claimWarned[code]) return;
        var r = U.hotkeyClashReport(code, id);
        if (!r.claimedBy) return;
        claimWarned[code] = true;
        $.log('warn', 'hotkey "' + id + '": ' + r.message);
        if (!quiet && U.toast) U.toast({ title: 'KEY ALREADY CLAIMED', msg: r.message, severity: 'warn' });
    }

    $.on('cfg', function (e) {
        if (!e || !e.path || String(e.path).indexOf('hotkeys.') !== 0) return;
        $.safe(function () {
            warnClaimedBind(String(e.path).slice('hotkeys.'.length), e.value);
        }, 'hotkey claim warning');
    });

    function isTypingTarget(t) {
        if (!t) return false;
        var tag = t.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    }

    function installHotkeys() {
        window.addEventListener('keydown', function (e) {
            // An OS key repeat fires this 10-30 times a second while a key is
            // held. Every GigaHack bind is a discrete action — toggle a window,
            // write a save, run a snippet — and none of them means anything
            // repeated. Holding the quick-save key took a full save backup per
            // repeat and evicted the entire backup ring in about two seconds.
            if (e.repeat) {
                if (open && $.cfg.behaviour.swallowInput &&
                    !isTypingTarget(e.target) &&
                    !(e.target && e.target.nodeType && host.contains(e.target))) e.stopPropagation();
                return;
            }
            var typing = isTypingTarget(e.target);
            // e.target is not always an element (an event dispatched on window
            // has window as its target), and Node.contains throws on non-nodes.
            var inUI = !!(e.target && e.target.nodeType && host.contains(e.target));
            var hk = $.cfg.hotkeys;

            // Esc while typing in one of our own fields: leave the field. It
            // must not fall through to closing the menu, and it must not reach
            // the game either.
            if (e.code === 'Escape' && typing && inUI) {
                e.preventDefault(); e.stopPropagation();
                if (typeof e.target.mmEscape === 'function') $.safe(function () { e.target.mmEscape(); }, 'field escape');
                e.target.blur();
                return;
            }

            // Esc: close the topmost popup, then inspect, then the menu.
            if (e.code === 'Escape' && !typing) {
                if (U.closePopup()) { e.preventDefault(); e.stopPropagation(); return; }
                if (hideInspect()) { e.preventDefault(); e.stopPropagation(); return; }
                if (open) { setOpen(false); e.preventDefault(); e.stopPropagation(); return; }
                return; // let the game have Escape when we are closed
            }

            if (!typing) {
                if (e.code === hk.toggleMenu) {
                    U.toggle(); e.preventDefault(); e.stopPropagation(); return;
                }
                // Unconditional: the watch panel is the one thing you want to
                // summon without opening the whole menu first.
                if (e.code === hk.watch) {
                    setWatch(!U.isWatchOpen());
                    e.preventDefault(); e.stopPropagation(); return;
                }
                if (e.code === hk.panicHide) {
                    panicHide();
                    e.preventDefault(); e.stopPropagation(); return;
                }
                // Only bound while something is actually listening. The M6
                // inspect module is disabled, so without this guard the key
                // would swallow a keystroke and do nothing.
                if (e.code === hk.inspect && $.inspect) {
                    $.emit('inspect:toggle');
                    e.preventDefault(); e.stopPropagation(); return;
                }

                // Registered binds. Stopped at capture like the built-ins, so
                // a bind that collides with something the engine listens for
                // on `document` — F5 reloads the game, F8 opens DevTools —
                // reaches us and not the engine.
                for (var i = 0; i < extraKeys.length; i++) {
                    var d = extraKeys[i];
                    var code = hk[d.id];
                    if (!code || e.code !== code) continue;
                    if (d.when && !$.safe(d.when, 'hotkey guard ' + d.id, false)) continue;
                    $.safe(d.run, 'hotkey ' + d.id);
                    e.preventDefault(); e.stopPropagation(); return;
                }
            }

            // While the overlay is open, keystrokes must not reach the game —
            // but ONLY swallow here for events that did not originate inside
            // our own UI. MZ binds Input._onKeyDown on `document` in the bubble
            // phase, and `document` is an ancestor of our inputs: calling
            // stopPropagation at window-capture would kill the event before it
            // ever reached the input's own listeners, breaking Enter/Escape in
            // edit cells and the arrow keys in number steppers. Events from our
            // UI are stopped on the host in the bubble phase instead (below),
            // after our widgets have had them.
            if (open && $.cfg.behaviour.swallowInput && !inUI) {
                e.stopPropagation();
            }
        }, true);

        window.addEventListener('keyup', function (e) {
            if (open && $.cfg.behaviour.swallowInput && !isTypingTarget(e.target) &&
                !(e.target && e.target.nodeType && host.contains(e.target))) e.stopPropagation();
        }, true);

        // Everything that happens inside our UI stops at the host on the way
        // up, so the game's document-level Input / TouchInput handlers never
        // see it, while our own widgets still do.
        ['keydown', 'keyup', 'keypress',
            'mousedown', 'mouseup', 'click', 'dblclick', 'wheel',
            'touchstart', 'touchmove', 'touchend', 'contextmenu']
            .forEach(function (evt) {
                host.addEventListener(evt, function (e) {
                    // Only swallow when the event actually hit a widget, not the
                    // transparent root (which is pointer-events:none anyway).
                    if (e.target !== host && e.target.id !== 'mm-root') e.stopPropagation();
                }, false);
            });
    }

    /* =====================================================================
       Apply runtime options (SPEC §3)
       ===================================================================== */
    U.apply = function (o) {
        if (!HOST || !HOST.root) return false;
        o = o || {};
        if (o.accent) {
            var hex = o.accent;
            ACCENTS.forEach(function (a) { if (a.name === o.accent) hex = a.hex; });
            $.cfg.ui.accent = U.applyAccent(HOST.root, hex);
        }
        if (o.scale) { $.cfg.ui.scale = o.scale; HOST.root.style.setProperty('--mm-scale', o.scale); }
        if (o.opacity) { $.cfg.ui.opacity = o.opacity; HOST.root.style.setProperty('--mm-opacity', o.opacity); }
        if (o.tab && o.tab !== $.cfg.ui.tab) { $.cfg.ui.tab = o.tab; HOST.renderTab(); }
        if (o.watch != null) setWatch(!!o.watch);
        if (o.readonly != null) {
            $.cfg.behaviour.readonly = !!o.readonly;
            HOST.root.classList.toggle('mm-ro', !!o.readonly);
            setActive('read-only', !!o.readonly);
        }
        $.store.saveSettings();
        return true;
    };

    /* =====================================================================
       Mount

       Two engine behaviours decide WHEN and HOW the host may be attached, and
       both are asked for as capabilities rather than by engine name:

         · $.caps.zIndexClobber — the engine walks the whole document while it
           boots and zeroes every positive INLINE z-index it finds. An overlay
           attached before that runs is flattened behind the game canvas, with
           no error and nothing in the log: the mod simply looks dead while
           still swallowing input. So we wait for the engine's own DOM, and
           re-assert the z-index afterwards anyway.

         · $.caps.textSelectionBlocked — the engine sets user-select:none on
           the body, which inherits into everything we draw. The log drawer and
           every diagnostic block exist to be copied out of, so the overlay
           subtree opts itself back in.

       The stylesheet carries both properties for the normal path; the inline
       assertions below exist for the one path that sets style inline (the
       size fallback in mountNow) and for a plugin that runs the engine's boot
       pass a second time.
       ===================================================================== */
    var HOST_Z = '2147483000';        // matches #gigahack-host in the stylesheet

    /* The engine has built its DOM once its canvas is in the document. Asking
       for the canvas by $.caps.canvasId rather than for a renderer internal
       keeps this true on both engines. */
    function engineDomReady() {
        return $.safe(function () {
            var id = $.caps && $.caps.canvasId;
            if (id && document.getElementById(id)) return true;
            return !!(typeof Graphics !== 'undefined' && Graphics._canvas);
        }, 'engine dom probe', false);
    }

    function assertHostStyle(el) {
        if (!el) return;
        $.safe(function () {
            if ($.caps.zIndexClobber) el.style.zIndex = HOST_Z;
            if ($.caps.textSelectionBlocked) {
                el.style.userSelect = 'text';
                el.style.webkitUserSelect = 'text';
                el.style.msUserSelect = 'text';
                el.style.MozUserSelect = 'text';
            }
        }, 'assert host style');
    }

    /* ---------------------------------------------------------------------
       The engine's graphics initialisation, hooked ONCE and shared.

       It is two things at the same time, which is why one hook serves both:

         · the "the engine's DOM exists now" signal a deferred mount waits for;
         · the moment after which the inline z-index has to be put BACK. The
           clobber pass is part of initialisation, not of startup, so a plugin
           that changes the resolution runs it again mid-session — and an
           overlay that only asserted its z-index once at mount goes behind the
           canvas the first time that happens, silently.

       Listeners are called after the original returns, on every run.
       ------------------------------------------------------------------ */
    var domReadyFns = [], domHookInstalled = false;

    function onEngineDom(fn) {
        domReadyFns.push(fn);
        if (domHookInstalled) return;
        domHookInstalled = true;
        $.install('Graphics.initialize (overlay)',
            typeof Graphics !== 'undefined' ? Graphics : null, 'initialize',
            function (original) {
                return function () {
                    var r = original.apply(this, arguments);
                    // slice(): a listener may add another (the deferred mount
                    // registers the z-index re-assert as it runs).
                    domReadyFns.slice().forEach(function (f) {
                        $.safe(f, 'engine dom listener');
                    });
                    return r;
                };
            },
            'Graphics.initialize not found — the overlay falls back to a timed mount ' +
            'and cannot re-assert its z-index if the engine rebuilds its DOM');
    }

    /* Deferred mount. The hook above is the preferred trigger; the interval
       behind it is a safety net for a build where that function is not where
       we expect it, so a missing hook costs a few frames rather than the whole
       overlay. */
    var mountWaiters = [], mountDeferred = false;

    function mountWhenReady(done) {
        if (done) mountWaiters.push(done);
        if (mountDeferred) return null;
        mountDeferred = true;

        $.log('info', 'overlay mount deferred until the engine has built its DOM — ' +
            'this engine zeroes positive inline z-index values while it boots.');

        var fired = false, timer = null;

        function go(why) {
            if (fired || host) return;
            fired = true;
            if (timer) { clearInterval(timer); timer = null; }
            $.safe(function () { mountNow(); }, 'deferred overlay mount');
            $.log(host ? 'ok' : 'err', 'overlay mount ran after ' + why);
            var list = mountWaiters.slice();
            mountWaiters.length = 0;
            list.forEach(function (fn) { $.safe(function () { fn(HOST); }, 'mount callback'); });
        }

        onEngineDom(function () { go('the engine finished building its DOM'); });

        var waited = 0;
        timer = setInterval(function () {
            if (fired) { clearInterval(timer); timer = null; return; }
            waited += 120;
            if (engineDomReady()) { go('the game canvas appeared'); return; }
            if (waited >= 5000) {
                go('5s with no game canvas — mounting anyway, so the menu exists ' +
                   'even if this build never creates one');
            }
        }, 120);
        return null;
    }

    /**
     * mount(done)
     *
     * Returns HOST when it could mount synchronously, and null when the mount
     * had to wait for the engine. `done` is called with HOST either way, so a
     * caller that passes one never has to know which happened.
     */
    U.mount = function (done) {
        if (host) {
            if (done) $.safe(function () { done(HOST); }, 'mount callback');
            return HOST;
        }
        if ($.caps.zIndexClobber && !engineDomReady()) return mountWhenReady(done);
        var r = mountNow();
        if (done) $.safe(function () { done(r); }, 'mount callback');
        return r;
    };

    function mountNow() {
        if (host) return HOST;
        return $.safe(function () {
            host = h('div', { id: 'gigahack-host' });
            var style = document.createElement('style');
            style.id = 'gigahack-style';
            style.textContent = U.CSS + U.CSS2;
            host.appendChild(style);

            var root = h('div', { id: 'mm-root' });
            host.appendChild(root);
            var layer = h('div', { class: 'mm-layer' });

            HOST = {
                root: root, layer: layer, tickHooks: [], fastHooks: [], active: {},
                pinned: false
            };
            U.setHost(HOST);

            // Per-frame hooks owned by the current tab. Like tickHooks (700ms)
            // these are cleared on every tab render, but they run at frame rate
            // so a live table can track game state without visible lag. They
            // only run while the overlay is actually visible.
            $.onFrame('tab fast hooks', function (n) {
                if (!open || !HOST.fastHooks.length) return;
                for (var i = 0; i < HOST.fastHooks.length; i++) HOST.fastHooks[i](n);
            });

            hudEl = buildHud(); root.appendChild(hudEl);
            winEl = buildWindow(); root.appendChild(winEl);
            watchEl = buildWatch(); root.appendChild(watchEl);
            inspectEl = buildInspect(); root.appendChild(inspectEl);
            HOST.toasts = h('div', { class: 'mm-toasts' }); root.appendChild(HOST.toasts);
            root.appendChild(layer);
            HOST.watchEl = watchEl;
            HOST.inspectEl = inspectEl;

            U.initTooltips(root, layer);
            U.applyAccent(root, $.cfg.ui.accent);
            root.style.setProperty('--mm-scale', $.cfg.ui.scale);
            root.style.setProperty('--mm-opacity', $.cfg.ui.opacity);
            root.classList.toggle('mm-ro', $.isReadOnly());

            document.body.appendChild(host);
            assertHostStyle(host);
            // And again after every future graphics initialisation, because
            // each one repeats the pass that zeroes inline z-index values.
            if ($.caps.zIndexClobber || $.caps.textSelectionBlocked) {
                onEngineDom(function () { assertHostStyle(host); });
            }
            installHotkeys();

            // Self-check. #mm-root is overflow:hidden, so if the host ever
            // fails to fill the window the entire overlay is clipped away and
            // GigaHack looks dead while still swallowing input — which is
            // exactly what an unsupported layout property did on this game's
            // Chromium 85. Rather than fail silently, measure and repair.
            $.safe(function () {
                var r = root.getBoundingClientRect();
                if (r.width >= 2 && r.height >= 2) return;
                $.log('err', 'overlay measured ' + Math.round(r.width) + '×' + Math.round(r.height) +
                    ' — the host did not fill the window; applying an explicit-size fallback');
                var fix = 'position:fixed;left:0;top:0;width:' + window.innerWidth +
                    'px;height:' + window.innerHeight + 'px;z-index:' + HOST_Z + ';pointer-events:none';
                host.setAttribute('style', fix);
                // setAttribute replaces the WHOLE inline style, so the z-index
                // and the selection opt-in asserted at mount go with it — and
                // this is the one path that writes a positive z-index inline,
                // which is exactly what an engine that zeroes those looks for.
                assertHostStyle(host);
                root.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none');
                U.applyAccent(root, $.cfg.ui.accent);
                var unsupported = U.compatReport().filter(function (f) { return !f.supported; })
                    .map(function (f) { return f.feature; });
                if (unsupported.length) $.log('warn', 'renderer lacks: ' + unsupported.join(', '));
            }, 'overlay size self-check');

            // Keep the fallback path correct if the window is resized.
            window.addEventListener('resize', function () {
                $.safe(function () {
                    if (host.style.width && host.style.width !== '100%') {
                        host.style.width = window.innerWidth + 'px';
                        host.style.height = window.innerHeight + 'px';
                    }
                }, 'host resize');
            });

            // Route the core logger into the drawer and replay what happened
            // before the overlay existed.
            $.logSink = U.logRow;
            $.logHistory().forEach(function (e) { U.logRow(e.level, e.msg); });

            if ($.isReadOnly()) setActive('read-only', true);
            if ($.cfg.ui.watch.visible) setWatch(true);

            // Feature modules that need the host but must not depend on where
            // they sit in the load order listen for this.
            $.emit('mounted', HOST);

            U.setActive = setActive;

            // Say once, at mount, which of the binds we are starting with sit
            // on a key the engine or the game already owns. Derived defaults
            // avoid those, so anything reported here is a stored choice or the
            // fallback set — either way the user is the one who can fix it.
            $.safe(function () {
                var hk = $.cfg.hotkeys || {}, id;
                for (id in hk) warnClaimedBind(id, hk[id], true);
            }, 'claimed hotkey report');

            $.log('ok', 'overlay mounted — press ' + U.prettyCode($.cfg.hotkeys.toggleMenu) + ' to open');
            return HOST;
        }, 'overlay mount');
    }

    /* Re-render the current tab from outside (used after settings changes). */
    U.rerender = function () { if (HOST && HOST.renderTab) HOST.renderTab(); };
    U.setActive = function (n, v) { if (HOST) setActive(n, v); };

})(window.GigaHack);
