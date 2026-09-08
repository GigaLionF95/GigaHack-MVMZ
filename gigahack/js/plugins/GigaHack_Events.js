//=============================================================================
// GigaHack MV/MZ
// 15 · events.js — event overlay ("hitboxes"), inspector and cross-map search
//-----------------------------------------------------------------------------
// The only part of GigaHack that draws into the PixiJS scene instead of the
// DOM overlay. A PIXI.Container is added to Spriteset_Map in an alias of
// createUpperLayer, so it sits above the tilemap, characters and pictures but
// still inside the spriteset — which means below the window layer.
//
// WHERE INSIDE the spriteset is not the same question on both engines, and
// getting it wrong is visible rather than fatal: see the invariant on the
// createUpperLayer hook. In one, screen fade and flash are CHILDREN of the
// spriteset, so appending puts a debug overlay on top of a fade-to-black.
//
// The spriteset is rebuilt on every map transfer, so the layer is recreated
// with it; nothing needs to survive a transfer. Positions are refreshed from
// an alias of Spriteset_Map.update rather than a generic per-frame hook, so
// the rectangles are computed against the same scroll offset the frame is
// drawn with and never lag the map by one frame.
//
// PIXI is version 4 on one engine and 5 on the other. The total surface used
// here is PIXI.Container, PIXI.Graphics and Graphics' clear/lineStyle/
// beginFill/drawRect/endFill — API-compatible across that change — plus the
// engine's own Sprite and Bitmap for labels. Nothing here touches a PIXI
// internal, a filter, or getBounds, and the `typeof PIXI === 'undefined'`
// guard on the constructor keeps a build that renders some other way to a
// missing overlay with a reason rather than a throw.
//
// This module also owns the one question the engine cannot answer at all:
// "which events, anywhere in the game, touch switch 42?" The engine loads one
// map at a time and keeps no record of the others, so it is answered from the
// boot index — as a candidate list, re-resolved against live data before
// anything is shown or jumped to.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — event overlay, inspector and cross-map search
 * @author gigahack
 * @help GigaHack_Events.js — requires Core, Caps, Store, UI, Shell, Hooks,
 * Tabs, Vars, Backup; uses Index for cross-map search and Map for teleport.
 */

(function ($) {
    'use strict';
    // Declared dependencies are checked, not assumed: forceRun calls
    // $.backup.guard and the self-switch controls call $.vars.setSelfSwitch,
    // and both are reachable from the console API where nothing wraps them.
    if (!$ || !$.ui || !$.ui.tab || !$.vars || !$.backup) {
        console.error('[GigaHack] dependency missing — events not installed');
        if ($ && $.log) $.log('warn', 'events skipped — needs shell, vars and backup');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    /* =====================================================================
       PART 1 — MODEL
       ===================================================================== */
    var E = $.events = {};

    // page.trigger, per the MZ editor's "Trigger" dropdown.
    var TRIGGERS = [
        { name: 'Action Button', colour: 0x5b8bb5 },
        { name: 'Player Touch', colour: 0x5fa463 },
        { name: 'Event Touch', colour: 0xd19a3c },
        { name: 'Autorun', colour: 0xd1495b },
        { name: 'Parallel', colour: 0x9b6cd8 }
    ];
    E.TRIGGERS = TRIGGERS;

    function alive() {
        return typeof $gameMap !== 'undefined' && $gameMap && $gameMap.mapId() &&
            typeof $dataMap !== 'undefined' && $dataMap;
    }
    E.alive = alive;

    E.list = function () {
        return $.safe(function () { return $gameMap.events(); }, 'events', []) || [];
    };

    // page/transfersOf are on the per-frame draw path, so they are written to
    // be non-throwing by construction rather than wrapped in $.safe — a $.safe
    // that fires at 60Hz writes 60 log lines a second.
    E.page = function (ev) {
        if (!ev || typeof ev.event !== 'function') return null;
        var idx = ev._pageIndex;
        if (idx === undefined || idx === null || idx < 0) return null;
        var d = ev.event();
        var pages = d && d.pages;
        return (pages && pages[idx]) || null;
    };

    E.trigger = function (ev) {
        var p = E.page(ev);
        return p ? p.trigger : -1;
    };

    E.info = function (ev) {
        return $.safe(function () {
            var d = ev.event();
            var pages = (d && d.pages) || [];
            var idx = ev._pageIndex;
            return {
                id: ev.eventId(), name: (d && d.name) || '', x: ev.x, y: ev.y,
                pageIndex: idx, pageCount: pages.length,
                trigger: E.trigger(ev),
                erased: !!ev._erased,
                note: (d && d.note) || '',
                transfers: E.transfersOf(ev)
            };
        }, 'event info', null);
    };

    /** Transfer-player commands (code 201) anywhere in the active page. */
    var EMPTY = Object.freeze([]);
    // Keyed on the page object, so it needs no invalidation: $dataMap is
    // re-parsed on every map load and the old pages become garbage, taking
    // their entries with them. A WeakMap rather than a property on the page,
    // because a plugin may have deep-frozen the map data.
    var transferCache = (typeof WeakMap === 'function') ? new WeakMap() : null;

    E.transfersOf = function (ev) {
        var p = E.page(ev);
        if (!p || !p.list) return EMPTY;
        if (transferCache && transferCache.has(p)) return transferCache.get(p);
        var out = [];
        for (var i = 0; i < p.list.length; i++) {
            var c = p.list[i];
            if (!c || c.code !== 201) continue;
            var pr = c.parameters || [];
            out.push(pr[0] === 0
                ? { mapId: pr[1], x: pr[2], y: pr[3], direct: true }
                : { mapId: null, byVariable: pr[1], direct: false });
        }
        if (transferCache) transferCache.set(p, out);
        return out;
    };

    /* ------------------------------------------------------ page conditions */
    E.conditions = function (ev, pageIndex) {
        return $.safe(function () {
            var page = ev.event().pages[pageIndex];
            if (!page) return [];
            var c = page.conditions, out = [];
            if (c.switch1Valid) out.push('Switch ' + c.switch1Id + ' "' + swName(c.switch1Id) + '" is ON');
            if (c.switch2Valid) out.push('Switch ' + c.switch2Id + ' "' + swName(c.switch2Id) + '" is ON');
            if (c.variableValid) {
                out.push('Variable ' + c.variableId + ' "' + varName(c.variableId) + '" ≥ ' + c.variableValue +
                    '  (now ' + $.safe(function () { return $gameVariables.value(c.variableId); }, 'v', '?') + ')');
            }
            if (c.selfSwitchValid) out.push('Self-switch ' + c.selfSwitchCh + ' is ON');
            if (c.itemValid) out.push('Party has item ' + c.itemId);
            if (c.actorValid) out.push('Actor ' + c.actorId + ' is in the party');
            if (!out.length) out.push('(no conditions — always eligible)');
            return out;
        }, 'conditions', []) || [];
    };

    function swName(id) { return $.safe(function () { return $dataSystem.switches[id] || ''; }, 'sw', ''); }
    function varName(id) { return $.safe(function () { return $dataSystem.variables[id] || ''; }, 'v', ''); }

    /* ---------------------------------------------------- command decoding */
    // Names for the codes this decoder does not summarise individually. The
    // point is that an unknown command still reads as something, rather than
    // as a bare number.
    var CODE_NAMES = {
        103: 'Input Number', 104: 'Select Item', 105: 'Scrolling Text',
        112: 'Loop', 113: 'Break Loop', 115: 'Exit Event Processing',
        118: 'Label', 119: 'Jump to Label', 124: 'Control Timer',
        129: 'Change Party Member', 132: 'Change Battle BGM', 133: 'Change Victory ME',
        134: 'Change Save Access', 135: 'Change Menu Access', 136: 'Change Encounter',
        137: 'Change Formation Access', 138: 'Change Window Color',
        201: 'Transfer Player', 202: 'Set Vehicle Location', 203: 'Set Event Location',
        204: 'Scroll Map', 205: 'Set Movement Route', 206: 'Get on/off Vehicle',
        211: 'Change Transparency', 212: 'Show Animation', 213: 'Show Balloon',
        214: 'Erase Event', 216: 'Change Player Followers', 217: 'Gather Followers',
        221: 'Fadeout Screen', 222: 'Fadein Screen', 223: 'Tint Screen',
        224: 'Flash Screen', 225: 'Shake Screen', 230: 'Wait',
        231: 'Show Picture', 232: 'Move Picture', 233: 'Rotate Picture',
        234: 'Tint Picture', 235: 'Erase Picture', 236: 'Set Weather',
        241: 'Play BGM', 242: 'Fadeout BGM', 243: 'Save BGM', 244: 'Resume BGM',
        245: 'Play BGS', 246: 'Fadeout BGS', 249: 'Play ME', 250: 'Play SE',
        251: 'Stop SE', 261: 'Play Movie', 281: 'Change Map Name Display',
        282: 'Change Tileset', 283: 'Change Battleback', 284: 'Change Parallax',
        285: 'Get Location Info', 301: 'Battle Processing', 302: 'Shop Processing',
        303: 'Name Input', 311: 'Change HP', 312: 'Change MP', 313: 'Change State',
        314: 'Recover All', 315: 'Change EXP', 316: 'Change Level',
        317: 'Change Parameter', 318: 'Change Skill', 319: 'Change Equipment',
        320: 'Change Name', 321: 'Change Class', 322: 'Change Actor Images',
        351: 'Open Menu', 352: 'Save Screen', 353: 'Game Over', 354: 'Return to Title',
        402: 'When', 403: 'When Cancel', 404: 'End Choices',
        411: 'Else', 412: 'End', 413: 'Repeat Above', 601: 'If Win', 602: 'If Escape',
        603: 'If Lose', 604: 'End Battle'
    };

    var OPERAND = ['=', '+=', '-=', '*=', '/=', '%='];

    /** Human-readable one-liner per command. */
    E.describe = function (c) {
        var p = c.parameters || [];
        switch (c.code) {
            case 0: return '';
            case 101: return 'Show Text' + (p[4] ? ' — ' + p[4] : '');
            case 401: return '“' + p[0] + '”';
            case 102: return 'Show Choices: ' + (p[0] || []).join(' / ');
            case 108: return '# ' + p[0];
            case 408: return '# ' + p[0];
            case 111: return 'If: ' + describeCondition(p);
            case 117: return 'Common Event ' + p[0] +
                ' "' + $.safe(function () { return $dataCommonEvents[p[0]].name; }, 'ce', '') + '"';
            case 121: return 'Switch ' + p[0] + (p[1] !== p[0] ? '–' + p[1] : '') +
                ' "' + swName(p[0]) + '" = ' + (p[2] === 0 ? 'ON' : 'OFF');
            case 122: return 'Variable ' + p[0] + (p[1] !== p[0] ? '–' + p[1] : '') +
                ' "' + varName(p[0]) + '" ' + (OPERAND[p[2]] || '?') + ' ' + describeOperand(p);
            case 123: return 'Self-switch ' + p[0] + ' = ' + (p[1] === 0 ? 'ON' : 'OFF');
            case 125: return 'Gold ' + (p[0] === 0 ? '+' : '−') + ' ' + (p[1] === 0 ? p[2] : 'variable ' + p[2]);
            case 126: return 'Item ' + p[0] + ' ' + (p[1] === 0 ? '+' : '−') + ' ' + (p[2] === 0 ? p[3] : 'var ' + p[3]);
            case 201: return p[0] === 0
                ? 'Transfer → map ' + p[1] + ' @ ' + p[2] + ',' + p[3]
                : 'Transfer → by variables ' + p[1] + ',' + p[2] + ',' + p[3];
            case 355: return '⟨script⟩ ' + p[0];
            case 655: return '        ' + p[0];
            case 356: return '⟨plugin⟩ ' + p[0];
            case 357: return '⟨plugin⟩ ' + p[0] + ' · ' + p[1];
        }
        var name = CODE_NAMES[c.code];
        if (name) return name;
        return 'code ' + c.code + (p.length ? ' ' + JSON.stringify(p).slice(0, 60) : '');
    };

    function describeOperand(p) {
        // p[3] is the operand type: 0 constant, 1 variable, 2 random, 3 game data, 4 script
        if (p[3] === 0) return String(p[4]);
        if (p[3] === 1) return 'variable ' + p[4] + ' "' + varName(p[4]) + '"';
        if (p[3] === 2) return 'random ' + p[4] + '–' + p[5];
        if (p[3] === 4) return '⟨script⟩ ' + p[4];
        return 'game data';
    }

    // Sub-checks for condition types 4 and 5, per Game_Interpreter.command111.
    var ACTOR_CHECK = ['is in the party', 'is named', 'has class', 'has skill',
        'has weapon', 'has armor', 'has state'];
    var ENEMY_CHECK = ['is alive', 'has state'];
    var BUTTON_CHECK = ['pressed', 'triggered', 'repeated'];
    var DIRS = { 2: 'down', 4: 'left', 6: 'right', 8: 'up' };

    function describeCondition(p) {
        switch (p[0]) {
            case 0: return 'switch ' + p[1] + ' "' + swName(p[1]) + '" is ' + (p[2] === 0 ? 'ON' : 'OFF');
            case 1: return 'variable ' + p[1] + ' "' + varName(p[1]) + '" ' +
                ['=', '≥', '≤', '>', '<', '≠'][p[4]] + ' ' + (p[2] === 0 ? p[3] : 'variable ' + p[3]);
            case 2: return 'self-switch ' + p[1] + ' is ' + (p[2] === 0 ? 'ON' : 'OFF');
            case 3: return 'timer ' + (p[2] === 0 ? '≥' : '≤') + ' ' + p[1] + 's';
            // p[2] picks the sub-check and p[3] is its operand — without them
            // three different tests all read as "actor 1".
            case 4: return 'actor ' + p[1] + ' ' + (ACTOR_CHECK[p[2]] || 'check ' + p[2]) +
                (p[2] === 0 ? '' : ' ' + p[3]);
            case 5: return 'troop member #' + p[1] + ' ' + (ENEMY_CHECK[p[2]] || 'check ' + p[2]) +
                (p[2] === 0 ? '' : ' ' + p[3]);
            case 6: return 'character ' + (p[1] === -1 ? 'player' : p[1] === 0 ? 'this event' : 'event ' + p[1]) +
                ' faces ' + (DIRS[p[2]] || p[2]);
            case 7: return 'gold ' + ['≥', '≤', '<'][p[2]] + ' ' + p[1];
            case 8: return 'party has item ' + p[1];
            case 9: return 'party has weapon ' + p[1] + (p[2] ? ' (including equipped)' : '');
            case 10: return 'party has armor ' + p[1] + (p[2] ? ' (including equipped)' : '');
            case 11: return 'button "' + p[1] + '" is ' + (BUTTON_CHECK[p[2] || 0] || 'pressed');
            case 12: return '⟨script⟩ ' + p[1];
            case 13: return 'riding vehicle ' + p[1];
            default: return 'condition type ' + p[0];
        }
    }

    E.decode = function (ev, pageIndex) {
        return $.safe(function () {
            var page = ev.event().pages[pageIndex];
            if (!page || !page.list) return [];
            return page.list.map(function (c, i) {
                return { i: i, code: c.code, indent: c.indent || 0, text: E.describe(c), raw: c };
            }).filter(function (r) { return r.code !== 0 || r.i === 0; });
        }, 'decode', []) || [];
    };

    /* --------------------------------------------------------- operations */
    /**
     * Why an event cannot be force-run, or null when it can. Checked before
     * anything is spent — the backup below copies the whole save directory
     * synchronously, so it must not be paid for a call that then throws.
     */
    E.whyNotRunnable = function (ev) {
        if (!ev) return 'no event selected';
        var t = E.trigger(ev);
        // pageIndex -1: erased, or no page's conditions are met. ev.list()
        // would be pages[-1].list and throw.
        if (t < 0) return 'no page on this event is active right now';
        // Autorun and Parallel pages are already being driven by the engine —
        // Parallel by the event's own interpreter, every frame. Starting one
        // again runs the same command list on two interpreters at once, so
        // every gold/item/variable change in it applies twice.
        if (t === 3) return 'this page is Autorun — the engine already runs it';
        if (t === 4) return 'this page is Parallel — it is already running';
        var list = $.safe(function () { return ev.list(); }, 'event list', null);
        if (!list || list.length <= 1) return 'this page has no commands';
        return null;
    };

    E.forceRun = function (ev) {
        var why = E.whyNotRunnable(ev);
        if (why) {
            U.toast({ title: 'CANNOT RUN', msg: why, severity: 'warn' });
            $.log('warn', 'force-run refused: ' + why);
            return false;
        }
        if (!$.allowWrite('Forcing an event to run')) return false;
        var b = $.backup.guard('force-run event');
        if (b.created) U.toast({ title: 'SAVE BACKED UP', msg: b.entry.name, severity: 'ok' });

        var ok = $.safe(function () {
            ev.start();
            return ev.isStarting && ev.isStarting() ? null : 'the engine did not accept the start';
        }, 'force run', 'threw');

        if (ok) {
            U.toast({ title: 'CANNOT RUN', msg: ok, severity: 'warn' });
            $.log('warn', 'force-run event ' + ev.eventId() + ' refused: ' + ok);
            return false;
        }
        // Irreversible: the event may set switches, transfer, or start a battle.
        $.log('warn', 'forced event ' + ev.eventId() + ' to run (irreversible — backup ' +
            (b.created ? b.entry.name : b.skipped) + ')');
        return true;
    };

    // Returns the number cleared; 0 when refused, so a caller can interpolate
    // the result straight into "n self-switch(es) cleared".
    E.resetSelfSwitches = function (ev) {
        if (!ev || !$.allowWrite('Resetting self-switches')) return 0;
        var mapId = $gameMap.mapId(), n = 0;
        ['A', 'B', 'C', 'D'].forEach(function (L) {
            if ($gameSelfSwitches.value([mapId, ev.eventId(), L])) {
                $.vars.setSelfSwitch(mapId, ev.eventId(), L, false);
                n++;
            }
        });
        $.safe(function () { ev.refresh(); }, 'event refresh');
        $.log('ok', 'event ' + ev.eventId() + ': cleared ' + n + ' self-switch(es)');
        return n;
    };

    E.walkTo = function (ev) {
        if (!$.allowWrite('Moving the player')) return false;
        return $.safe(function () {
            $gamePlayer.locate(ev.x, ev.y);
            $.log('ok', 'moved player to event ' + ev.eventId() + ' @ ' + ev.x + ',' + ev.y);
            return true;
        }, 'walk to event', false);
    };

    /**
     * Move an event.
     *
     * locate() rather than setPosition(): setPosition leaves the event
     * mid-step if it was walking, so it slides back toward where it came from
     * on the next frame. locate stops the move route, straightens the sprite
     * and puts it down — which is what "put it there" has to mean.
     *
     * Spawning a NEW event is deliberately not offered. Neither engine has a
     * spawn API, and every plugin that adds one does it by rebuilding
     * Spriteset_Map's character list. On a heavily modded game — which is the
     * normal case for anything this menu is used on — several plugins own
     * sprites in that spriteset, so rebuilding it is the single most likely
     * thing GigaHack could do to break someone's save.
     */
    E.moveTo = function (ev, x, y) {
        if (!ev || !ev.locate) return false;
        if (!$.allowWrite('Moving an event')) return false;
        return $.safe(function () {
            var bx = ev.x, by = ev.y;
            var tx = $.clamp(Math.round(x) || 0, 0, $gameMap.width() - 1);
            var ty = $.clamp(Math.round(y) || 0, 0, $gameMap.height() - 1);
            ev.locate(tx, ty);
            $.undo.push('event ' + ev.eventId() + ' moved ' + bx + ',' + by + ' → ' + tx + ',' + ty,
                function () { ev.locate(bx, by); });
            $.log('ok', 'event ' + ev.eventId() + ' → ' + tx + ',' + ty);
            return true;
        }, 'move event', false);
    };

    /** Bring an event to the player's tile. */
    E.bringHere = function (ev) {
        if (typeof $gamePlayer === 'undefined' || !$gamePlayer) return false;
        return E.moveTo(ev, $gamePlayer.x, $gamePlayer.y);
    };

    /* =====================================================================
       PART 2 — THE PIXI LAYER
       ===================================================================== */
    var layer = null;          // current overlay instance (one per spriteset)
    var selectedId = 0, selectedMap = 0;

    function cfg() { return $.cfg.events || {}; }

    /* Per-layer strength. Read through a fallback table so a settings.json
       written before these existed — or one where a key was hand-edited to
       nonsense — still draws something visible rather than nothing at all. */
    var ALPHA_FALLBACK = { fill: 0.22, line: 1, edge: 0.55, label: 1, transfer: 0.9, grid: 0.5, region: 0.38 };
    function alpha(key) {
        var a = cfg().alpha;
        var v = a ? a[key] : undefined;
        if (typeof v !== 'number' || v !== v) return ALPHA_FALLBACK[key];
        return v < 0 ? 0 : v > 1 ? 1 : v;
    }
    function lineWidth() {
        var v = cfg().lineWidth;
        if (typeof v !== 'number' || v !== v) return 1;
        return v < 1 ? 1 : v > 4 ? 4 : v;
    }
    function dotSize() {
        var v = cfg().dotSize;
        if (typeof v !== 'number' || v !== v) return 8;
        return v < 4 ? 4 : v > 24 ? 24 : v;
    }
    E.alpha = alpha;
    E.lineWidth = lineWidth;
    E.dotSize = dotSize;

    function makeOverlay() {
        return $.safe(function () {
            if (typeof PIXI === 'undefined' || !PIXI.Container || !PIXI.Graphics) return null;
            var root = new PIXI.Container();
            // Two Graphics, because they redraw on very different clocks: the
            // tile grid only changes when the camera crosses a tile boundary,
            // the event rectangles change every frame.
            root.grid = new PIXI.Graphics();
            root.gfx = new PIXI.Graphics();
            root.labels = new PIXI.Container();
            root.addChild(root.grid);
            root.addChild(root.gfx);
            root.addChild(root.labels);
            root._labelBy = Object.create(null);
            root._labelIds = [];
            root._gridKey = '';
            return root;
        }, 'create overlay', null);
    }

    var canLabel = (typeof Sprite !== 'undefined' && typeof Bitmap !== 'undefined');
    var NO_PAGE = { name: 'no page', colour: 0x5c616b };

    function labelFor(root, ev, pageIndex) {
        if (!canLabel) return null;
        var id = ev.eventId();
        var s = root._labelBy[id];
        if (s && s._page === pageIndex) return s;
        if (!s) {
            s = new Sprite();
            s.bitmap = new Bitmap(180, 16);
            root.labels.addChild(s);
            root._labelBy[id] = s;
            root._labelIds.push(String(id));
        }
        s._page = pageIndex;
        var d = ev.event();
        var text = id + ((d && d.name) ? ' ' + d.name : '') +
            (pageIndex >= 0 ? ' p' + (pageIndex + 1) : '');
        s._text = text;
        var b = s.bitmap;
        b.clear();
        b.fontSize = 12;
        b.textColor = '#ffffff';
        b.outlineColor = 'rgba(0,0,0,0.85)';
        b.outlineWidth = 4;
        b.drawText(text, 0, 0, 180, 16, 'left');
        return s;
    }

    /* ------------------------------------------------------------ the grid
       Passability + region tint over the visible tiles.

       isPassable() goes through checkPassage, and checkPassage is one of the
       functions plugins most often replace outright — so it must be treated
       as arbitrarily expensive rather than as the engine's cheap bit-test.
       A screenful is ~250 visible tiles x 4 directions = 1000 calls, every
       frame, through code this module does not control.

       So the grid is drawn into its own Graphics keyed on the integer tile
       origin and merely TRANSLATED on the frames in between, which turns a
       per-frame cost into a per-tile-crossed cost. The key carries everything
       that can change the answer without the camera moving.
       -------------------------------------------------------------------- */
    var refreshGen = 0;
    $.install('Game_Map.refresh.gen',
        typeof Game_Map !== 'undefined' ? Game_Map.prototype : null, 'refresh',
        function (original) {
            return function () {
                original.apply(this, arguments);
                refreshGen++;
            };
        });

    /** Cheap fingerprint of the tile events' positions. They are rare. */
    function tileEventKey() {
        // Through $.eng, because the two engines keep this list under
        // different names and reading the wrong one throws inside a function
        // that runs on the draw path.
        var te = $.eng.tileEvents();
        if (!te || !te.length) return '0';
        var s = '';
        for (var i = 0; i < te.length; i++) s += te[i]._x + ',' + te[i]._y + ';';
        return s;
    }

    function updateGrid(root, c, tw, th) {
        var g = root.grid;
        var want = !!(c.showPassability || c.showRegions);
        g.visible = want;
        if (!want) { root._gridKey = ''; return; }

        var dx = $gameMap.displayX(), dy = $gameMap.displayY();
        var ox = Math.floor(dx), oy = Math.floor(dy);
        // Local coords are tile-relative to (ox, oy); the container carries the
        // sub-tile scroll. This is also correct across a looping map's seam,
        // where a per-tile adjustX() would place the wrapped tile on the far
        // side of the screen.
        g.x = Math.round(-(dx - ox) * tw);
        g.y = Math.round(-(dy - oy) * th);

        // Passability is not a property of the tilemap alone: checkPassage
        // consults tile events too (allTiles = tileEventsXy + layeredTiles), so
        // a door that switches page or slides aside changes it with the camera
        // perfectly still. The generation counter covers page switches, and the
        // tile-event positions cover movement.
        // The look sliders have to be in the key too, or dragging one would
        // move nothing until the camera happened to cross a tile boundary.
        var gridA = alpha('grid'), regionA = alpha('region'), dot = dotSize();
        var key = $gameMap.mapId() + ':' + ox + ':' + oy + ':' +
            (c.showPassability ? 1 : 0) + (c.showRegions ? 1 : 0) + ':' +
            refreshGen + ':' + $gameMap.tilesetId() + ':' + tileEventKey() + ':' +
            gridA + ':' + regionA + ':' + dot;
        if (key === root._gridKey) return;
        root._gridKey = key;

        g.clear();
        var wide = Math.ceil(Graphics.width / tw) + 2;
        var tall = Math.ceil(Graphics.height / th) + 2;
        for (var ry = 0; ry < tall; ry++) {
            for (var rx = 0; rx < wide; rx++) {
                var mx = $gameMap.roundX(ox + rx), my = $gameMap.roundY(oy + ry);
                if (!$gameMap.isValid(mx, my)) continue;
                var sx = rx * tw, sy = ry * th;
                if (c.showRegions) {
                    var rid = $gameMap.regionId(mx, my);
                    if (rid) {
                        // Hue derived from the id so distinct regions read as
                        // distinct without a number on every tile.
                        g.beginFill(regionColour(rid), regionA);
                        g.drawRect(sx, sy, tw, th);
                        g.endFill();
                    }
                }
                if (c.showPassability) {
                    var open = 0;
                    if ($gameMap.isPassable(mx, my, 2)) open++;
                    if ($gameMap.isPassable(mx, my, 4)) open++;
                    if ($gameMap.isPassable(mx, my, 6)) open++;
                    if ($gameMap.isPassable(mx, my, 8)) open++;
                    var col = open === 4 ? 0x5fa463 : open === 0 ? 0xd1495b : 0xd19a3c;
                    // Fully-open tiles are the boring majority, so they stay a
                    // third lighter than the ones worth noticing.
                    g.beginFill(col, open === 4 ? gridA * 0.65 : gridA);
                    g.drawRect(sx + (tw - dot) / 2, sy + (th - dot) / 2, dot, dot);
                    g.endFill();
                }
            }
        }
    }

    /* A throw in here would be a throw per frame, so it is caught locally and
       the overlay switches itself off rather than filling the log at 60Hz. */
    var drawFails = 0, reportedFail = false;

    function updateOverlay(root) {
        if (!root) return;
        var c = cfg();
        var on = !!c.on && alive();
        root.visible = on;
        if (!on) return;
        try {
            drawOverlay(root, c);
            // Decay rather than reset: a fault that throws on some frames and
            // not others would otherwise oscillate 1→0→1 forever, leaving the
            // overlay drawing half a frame each time with nothing in the log.
            if (drawFails) drawFails--;
        } catch (e) {
            var msg = (e && e.message) ? e.message : String(e);
            if (!reportedFail) {
                reportedFail = true;
                $.log('err', 'event overlay draw failed — ' + msg);
            }
            if (++drawFails >= 6) {
                root.visible = false;
                $.store.cfgSet('events.on', false);
                U.setActive('event overlay', false);
                U.toast({ title: 'OVERLAY OFF', msg: 'drawing kept failing — ' + msg, severity: 'warn' });
                $.log('err', 'event overlay switched off after repeated draw failures');
                drawFails = 0;
            }
        }
    }

    /** Test/recovery hook: forget the "already reported" latch. */
    E.resetDrawGuard = function () { drawFails = 0; reportedFail = false; };

    function drawOverlay(root, c) {
        var g = root.gfx;
        g.clear();

        var tw = $gameMap.tileWidth(), th = $gameMap.tileHeight();
        var used = Object.create(null);
        var selId = (selectedMap === $gameMap.mapId()) ? selectedId : 0;
        // Read the look settings once per frame, not once per event.
        var fillA = alpha('fill'), lineA = alpha('line'), transferA = alpha('transfer');
        var labelA = alpha('label'), edgeA = alpha('edge'), lw = lineWidth();

        updateGrid(root, c, tw, th);

        /* --- one rect per event --- */
        var evs = $gameMap.events();
        for (var i = 0; i < evs.length; i++) {
            var ev = evs[i];
            var t = E.trigger(ev);
            if (t < 0 && !c.showInactive) continue;    // no active page
            var spec = TRIGGERS[t] || NO_PAGE;
            // The tile the event occupies, in screen pixels. NOT derived from
            // screenX()/screenY(): screenY() is the sprite's baseline, which is
            // shifted up 6px for any non-object character and further by
            // jumpHeight() mid-jump, so a rectangle built from it straddles the
            // tile boundary and flies off during a Jump move route. scrolledX/Y
            // are what screenX/screenY are themselves built from.
            var x = ev.scrolledX() * tw;
            var y = ev.scrolledY() * th;
            var sel = ev.eventId() === selId;

            // A black keyline just outside the box. Alpha alone cannot fix
            // "blends into the background", because the background is not one
            // colour: a pale blue outline vanishes on sand and a dark one
            // vanishes at night. A dark edge against the bright fill gives the
            // box a boundary that survives either.
            if (edgeA > 0) {
                g.lineStyle(1, 0x000000, edgeA);
                g.drawRect(x - 0.5, y - 0.5, tw + 1, th + 1);
                g.lineStyle(0);
            }

            // The selected event is drawn a step stronger than the setting, so
            // it still stands out when the sliders are turned right down.
            g.lineStyle(sel ? lw + 1 : lw, spec.colour, sel ? Math.min(1, lineA + 0.25) : lineA);
            g.beginFill(spec.colour, sel ? Math.min(1, fillA + 0.18) : fillA);
            g.drawRect(x + lw / 2, y + lw / 2, tw - lw, th - lw);
            g.endFill();
            g.lineStyle(0);

            if (c.showTransfers && transferA > 0 && E.transfersOf(ev).length) {
                g.lineStyle(1, 0x35e0e8, transferA);
                g.drawRect(x + 3.5, y + 3.5, tw - 7, th - 7);
                g.lineStyle(0);
            }

            if (c.showLabels && labelA > 0) {
                // The label text only changes when the active page does, so it
                // is keyed on that rather than rebuilt (and thrown away) at
                // 60Hz for every event on the map.
                var s = labelFor(root, ev, ev._pageIndex);
                if (s) {
                    s.visible = true;
                    s.alpha = labelA;
                    s.x = x;
                    s.y = y - 14;
                    used[ev.eventId()] = true;
                }
            }
        }

        // Hide labels whose event is gone or filtered out this frame. The id
        // list is cached and only rebuilt when a label is added.
        var ids = root._labelIds;
        for (var k = 0; k < ids.length; k++) {
            if (!used[ids[k]]) root._labelBy[ids[k]].visible = false;
        }
    }

    function regionColour(id) {
        // Deterministic, well-spread hue per region id.
        var hue = (id * 47) % 360;
        return hslToHex(hue, 0.65, 0.55);
    }
    function hslToHex(hDeg, s, l) {
        var c = (1 - Math.abs(2 * l - 1)) * s;
        var hp = hDeg / 60;
        var x = c * (1 - Math.abs((hp % 2) - 1));
        var r = 0, g2 = 0, b = 0;
        if (hp < 1) { r = c; g2 = x; }
        else if (hp < 2) { r = x; g2 = c; }
        else if (hp < 3) { g2 = c; b = x; }
        else if (hp < 4) { g2 = x; b = c; }
        else if (hp < 5) { r = x; b = c; }
        else { r = c; b = x; }
        var m = l - c / 2;
        return (Math.round((r + m) * 255) << 16) | (Math.round((g2 + m) * 255) << 8) | Math.round((b + m) * 255);
    }

    /* --------------------------------------------------------------- hooks */

    /**
     * Where the overlay goes in the spriteset's child list.
     *
     * INVARIANT: a debug overlay must never be drawn over a screen fade or a
     * screen flash. When the game fades to black — a transfer, a cutscene, a
     * game over — the black is the picture, and rectangles floating on top of
     * it are not a diagnostic, they are a rendering bug that looks like one of
     * ours.
     *
     * The two engines put those screen sprites in different places, so the
     * position is FEATURE-DETECTED rather than branched on a version:
     *
     *   · Where the spriteset's own createScreenSprites adds _flashSprite and
     *     _fadeSprite as children, appending makes the overlay the last child
     *     and therefore the topmost — above both. So it is inserted at the
     *     index of the first screen sprite instead, which leaves it above the
     *     pictures and the timer and below the fade.
     *   · Where the screen effect is a filter on the spriteset itself rather
     *     than a child, there is nothing to sit under: appending is correct,
     *     and the overlay is tinted along with everything else, which is what
     *     a viewer would expect.
     *
     * Asking the object what children it has covers both, and also covers a
     * plugin that has added its own screen sprites under either name.
     */
    function attachIndex(spriteset) {
        return $.safe(function () {
            var kids = spriteset.children || [];
            var best = -1;
            [spriteset._flashSprite, spriteset._fadeSprite].forEach(function (s) {
                if (!s) return;
                var i = kids.indexOf(s);
                if (i > -1 && (best === -1 || i < best)) best = i;
            });
            return best;
        }, 'overlay attach index', -1);
    }

    $.install('Spriteset_Map.createUpperLayer',
        typeof Spriteset_Map !== 'undefined' ? Spriteset_Map.prototype : null, 'createUpperLayer',
        function (original) {
            return function () {
                original.apply(this, arguments);
                $.safe(function () {
                    // Above the tilemap, characters and pictures; still inside
                    // the spriteset, so below the window layer — and below the
                    // screen fade/flash where those are children of it.
                    layer = makeOverlay();
                    if (!layer) return;
                    var at = attachIndex(this);
                    if (at >= 0) this.addChildAt(layer, at);
                    else this.addChild(layer);
                }.bind(this), 'attach event overlay');
            };
        });

    $.install('Spriteset_Map.update.overlay',
        typeof Spriteset_Map !== 'undefined' ? Spriteset_Map.prototype : null, 'update',
        function (original) {
            return function () {
                original.apply(this, arguments);
                $.safe(function () { updateOverlay(layer); }, 'update event overlay');
            };
        });

    /**
     * One click → one selection. Returns true when the click was consumed and
     * the map's own touch-to-walk must not also see it.
     *
     * A click on an event is always consumed — that is the whole feature. A
     * click on empty ground is only consumed while the GigaHack window is
     * open, because then the player is frozen anyway and there is nothing to
     * take away; with the window closed, ordinary click-to-walk keeps working
     * and only events are intercepted.
     */
    function pickAt(cx, cy, menuOpen) {
        var mx = $gameMap.canvasToMapX(cx);
        var my = $gameMap.canvasToMapY(cy);
        var hits = $gameMap.eventsXy(mx, my);
        if (hits.length) {
            E.select(hits[0].eventId());
            var d = hits[0].event();
            U.toast({
                title: 'EVENT ' + hits[0].eventId(),
                msg: ((d && d.name) || '(unnamed)') + ' — open the Events tab',
                severity: 'ok'
            });
            return true;
        }
        if (!menuOpen) return false;
        E.select(0);
        $.log('info', 'tile ' + mx + ',' + my + ' · region ' + $gameMap.regionId(mx, my) +
            ' · passable ' + [2, 4, 6, 8].filter(function (dir) {
                return $gameMap.isPassable(mx, my, dir);
            }).length + '/4');
        return true;
    }

    /* Click-to-inspect.
     *
     * Hooked on updateDestination rather than the more obvious
     * processMapTouch, because processMapTouch only runs when isMapTouchOk() —
     * i.e. $gamePlayer.canMove() — is true, and GigaHack's own freeze hook
     * makes canMove() false for as long as the overlay is open. Hooking the
     * caller means picking works with the menu open, which is when it is most
     * useful.
     *
     * That also means this runs in states the engine deliberately excludes
     * from map touch: mid-message, mid-cutscene, during a transfer. Those are
     * screened out below rather than swallowed, because in a game this
     * dialogue-heavy every advance-the-text click would otherwise raise a
     * toast. TouchInput.clear() is NOT called: it wipes the physical mouse
     * state the engine needs for hold-to-fast-forward and for drag gestures.
     * Returning before the original is enough — nothing queues a destination.
     *
     * Clicks that land on the overlay itself never reach here: the shell stops
     * them on its host, below the document-level listener TouchInput installs.
     */
    $.install('Scene_Map.updateDestination',
        typeof Scene_Map !== 'undefined' ? Scene_Map.prototype : null, 'updateDestination',
        function (original) {
            return function () {
                var c = cfg();
                if (c.on && c.pick && typeof TouchInput !== 'undefined' &&
                    TouchInput.isTriggered && TouchInput.isTriggered() && pickable(this)) {
                    var handled = $.safe(function () {
                        return pickAt(TouchInput.x, TouchInput.y, !!U.isOpen && U.isOpen());
                    }, 'map pick', false);
                    if (handled) return;   // do not also walk there
                }
                return original.apply(this, arguments);
            };
        });

    /** The scene states where a map click means "a map click" and nothing else. */
    function pickable(scene) {
        return $.safe(function () {
            if (scene.isActive && !scene.isActive()) return false;
            if (typeof $gameMessage !== 'undefined' && $gameMessage.isBusy && $gameMessage.isBusy()) return false;
            if ($gameMap.isEventRunning && $gameMap.isEventRunning()) return false;
            if (typeof SceneManager !== 'undefined' && SceneManager.isSceneChanging &&
                SceneManager.isSceneChanging()) return false;
            return true;
        }, 'pickable', false);
    }

    // The selection is scoped to the map it was made on. Event ids repeat
    // across maps, so an unscoped id would silently re-point at an unrelated
    // event after a transfer — and "force run this page" would then run it.
    E.select = function (id) {
        selectedId = id || 0;
        selectedMap = selectedId ? $.safe(function () { return $gameMap.mapId(); }, 'map id', 0) : 0;
        $.emit('event:select', selectedId);
    };
    E.selected = function () {
        if (!selectedId || !alive()) return null;
        if ($gameMap.mapId() !== selectedMap) return null;
        return E.list().filter(function (e) { return e.eventId() === selectedId; })[0] || null;
    };
    E.available = function () {
        return !!($.hooks['Spriteset_Map.createUpperLayer'] &&
            $.hooks['Spriteset_Map.createUpperLayer'].installed);
    };

    /* =====================================================================
       PART 3 — TAB
       ===================================================================== */
    var ROW_H = 17;

    /* Selecting an event from the map has to reach whichever Events sub-tab is
       currently built. One module-level subscription, re-pointed by each build,
       rather than a fresh $.on per rebuild — those would accumulate for the
       life of the session and every one of them would fire. */
    var onSelect = null;
    $.on('event:select', function () {
        if (!onSelect) return;
        // The Events panels live on the World tab now. Checked by SUB as
        // well as by tab: World also carries Variables, Teleport and Gallery,
        // and refreshing an events panel that is not the one on screen would
        // rebuild DOM nobody is looking at on every map click.
        if (!$.cfg.ui || $.cfg.ui.tab !== 'world') return;
        var sub = ($.cfg.ui.sub || {}).world;
        if (sub !== 'Events' && sub !== 'Commands') return;
        $.safe(onSelect, 'events refresh on select');
    });

    function buildEvents() {
        // Dropped first so an early return below cannot leave the previous
        // build's handler pointing at DOM that no longer exists.
        onSelect = null;
        if (!E.available()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('div', { class: 'mm-todo-ms', text: 'UNAVAILABLE' }),
                    h('b', { text: 'event overlay disabled' }),
                    h('div', { text: 'Spriteset_Map.createUpperLayer was not found in this build' })));
        }
        if (!alive()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'no map loaded' }),
                    h('div', { text: 'enter a map, then reopen this tab' })));
        }

        var q = '';
        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 16px' },
                { label: 'id', w: '0 0 40px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'x,y', w: '0 0 58px', cls: 'mm-td-num' },
                { label: 'trigger', w: '0 0 96px' },
                { label: 'pg', w: '0 0 40px', cls: 'mm-td-num' }
            ],
            empty: 'no events on this map',
            render: function (i) {
                var spec = TRIGGERS[i.trigger] || { name: i.pageIndex < 0 ? 'no page' : '?', colour: 0x5c616b };
                return [
                    h('i', {
                        class: 'mm-dotmark',
                        style: 'background:#' + ('000000' + spec.colour.toString(16)).slice(-6)
                    }),
                    String(i.id),
                    h('span', { text: i.name || '—' }),
                    i.x + ',' + i.y,
                    h('span', { class: 'mm-sub', text: spec.name }),
                    (i.pageIndex >= 0 ? (i.pageIndex + 1) : '—') + '/' + i.pageCount
                ];
            },
            onRow: function (tr, i) {
                if (i.id === selectedId) tr.classList.add('mm-on');
                if (i.erased) tr.style.opacity = '.45';
                tr.style.cursor = 'pointer';
                tr.setAttribute('data-mm-tip', 'Event ' + i.id + '|' +
                    (i.name || '(unnamed)') + (i.transfers.length ? ' · has a transfer' : ''));
                tr.addEventListener('click', function () { E.select(i.id); });
            }
        });

        function rows() {
            return E.list().map(E.info).filter(Boolean).filter(function (i) {
                if (!q) return true;
                return String(i.id).indexOf(q) > -1 || (i.name || '').toLowerCase().indexOf(q) > -1;
            });
        }

        // The left column is split: the legend and the look sliders are static,
        // the inspector below them is rebuilt whenever the selection or a
        // self-switch changes. Rebuilding the whole column would tear down a
        // slider mid-drag.
        var left = h('div', { class: 'mm-col mm-col-narrow' });
        // .mm-stack, not an inline gap: flex gap needs Chromium 84 and the
        // floor is 66, so the UI module spaces these with margins instead.
        var insp = h('div', { class: 'mm-stack' });
        U.add(left, [legend(), lookPanel(), insp]);

        function refresh() {
            var keep = left.scrollTop;
            U.clear(insp);
            U.add(insp, inspector(refresh));
            left.scrollTop = keep;
            table.mm.refresh();
        }
        function repaint() { table.mm.paint(rows()); }
        repaint();
        refresh();

        // Clicking an event on the map has to land here too, not only in the
        // list — otherwise the panel keeps showing whatever was selected before
        // and you have to leave the tab and come back.
        onSelect = function () { refresh(); repaint(); };

        /* Positions change as events walk and a page index changes when a
           switch flips, so both are in the signal — they are both columns.
           What the signal is NOT is rows(): E.list().map(E.info) allocates a
           row object and scans a page for transfer commands per event, and an
           unconditional tickHooks.push did exactly that 86 times a minute,
           including while the overlay was closed, because the shell's clock
           has no visibility test of its own. U.live holds on both. */
        function listStamp() {
            var evs = E.list(), s = '' + evs.length, i, ev;
            for (i = 0; i < evs.length; i++) {
                ev = evs[i];
                s += '|' + ev.eventId() + ',' + ev.x + ',' + ev.y + ',' +
                    ev._pageIndex + (ev._erased ? ',x' : '');
            }
            return s;
        }
        U.live(listStamp, repaint, {
            name: 'event list', within: table,
            when: function () { return !table.mm.isScrolling(); }
        });

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({ placeholder: 'search events…', onInput: function (v) { q = v.trim(); repaint(); } }),
            W.chip({
                label: 'overlay', value: !!cfg().on,
                onChange: function (v) { $.store.cfgSet('events.on', v); U.setActive('event overlay', v); }
            }),
            W.chip({
                label: 'labels', value: cfg().showLabels !== false,
                onChange: function (v) { $.store.cfgSet('events.showLabels', v); }
            }),
            W.chip({
                label: 'passability', value: !!cfg().showPassability,
                onChange: function (v) { $.store.cfgSet('events.showPassability', v); }
            }),
            W.chip({
                label: 'regions', value: !!cfg().showRegions,
                onChange: function (v) { $.store.cfgSet('events.showRegions', v); }
            }),
            W.chip({
                label: 'transfers', value: !!cfg().showTransfers,
                onChange: function (v) { $.store.cfgSet('events.showTransfers', v); }
            }),
            W.chip({
                label: 'inactive', value: !!cfg().showInactive,
                tip: 'Inactive|Also outline events with no active page, in grey.',
                onChange: function (v) { $.store.cfgSet('events.showInactive', v); }
            }),
            W.chip({
                label: 'click to pick', value: cfg().pick !== false,
                tip: 'Pick|Clicking the map selects an event instead of walking there.',
                onChange: function (v) { $.store.cfgSet('events.pick', v); }
            }));

        var group = W.group('Events · map ' + $gameMap.mapId(), [toolbar, table], { grow: true });

        return h('div', { class: 'mm-body' }, left, h('div', { class: 'mm-col' }, group));
    }

    /* --------------------------------------------------------------- legend */
    function legend() {
        return W.group('Legend', TRIGGERS.map(function (t) {
            return h('div', { class: 'mm-legend', style: 'padding:1px 2px' },
                h('i', { style: 'background:#' + ('000000' + t.colour.toString(16)).slice(-6) }),
                h('span', { text: t.name }));
        }).concat([
            h('div', { class: 'mm-legend', style: 'padding:1px 2px' },
                h('i', { style: 'background:none;border-color:#35e0e8' }),
                h('span', { text: 'contains a transfer' }))
        ]), { tag: 'trigger' });
    }

    /* ----------------------------------------------------------- look panel
       One slider per layer rather than a single master, because they sit on
       completely different backgrounds: a region tint covers whole tiles of
       artwork, an event outline is a 1px line over whatever happens to be
       behind it, and the strength that makes one readable washes the other
       out. Every change is live — the overlay redraws on the next frame, and
       the grid's cache key carries these values so a drag is visible while
       the camera stands still.
       -------------------------------------------------------------------- */
    var LOOK = [
        ['fill', 'box fill', 'Box fill|Interior of each event rectangle. Raise it to spot events over busy artwork; drop it to see the map underneath.'],
        ['line', 'box outline', 'Box outline|The rectangle border. This is the one to raise first — a line reads at a much lower strength than a fill.'],
        ['edge', 'dark edge', 'Dark edge|A black keyline just outside the box.'],
        ['label', 'labels', 'Labels|The id / name / page text above each box.'],
        ['transfer', 'transfer mark', 'Transfer mark|The cyan inner outline on events that contain a Transfer Player.'],
        ['grid', 'passability', 'Passability|The per-tile dots. Fully-open tiles are drawn a ' +
                                    'third lighter.'],
        ['region', 'region tint', 'Region tint|Whole-tile colour wash.']
    ];

    function lookPanel() {
        var rows = LOOK.map(function (spec) {
            return W.row(spec[1], W.slider({
                value: Math.round(alpha(spec[0]) * 100), min: 0, max: 100, unit: '%', width: '104px',
                label: spec[1], _ungated: true,
                onChange: function (v) { $.store.cfgSet('events.alpha.' + spec[0], v / 100); }
            }), { tip: spec[2] });
        });

        rows.push(W.row('outline width', W.slider({
            value: lineWidth(), min: 1, max: 4, step: 1, unit: 'px', width: '104px',
            label: 'outline width', _ungated: true,
            onChange: function (v) { $.store.cfgSet('events.lineWidth', v); }
        }), {  }));

        rows.push(W.row('dot size', W.slider({
            value: dotSize(), min: 4, max: 24, step: 1, unit: 'px', width: '104px',
            label: 'dot size', _ungated: true,
            onChange: function (v) { $.store.cfgSet('events.dotSize', v); }
        }), { tip: 'Dot size|The passability marker on each tile.' }));

        rows.push(W.button({
            label: 'reset to defaults', wide: true, _ungated: true,
            onClick: function () {
                var d = $.store.defaults.events;
                $.cfg.events.alpha = $.clone(d.alpha);
                $.cfg.events.lineWidth = d.lineWidth;
                $.cfg.events.dotSize = d.dotSize;
                $.store.saveSettings();
                U.rerender();
            }
        }));

        return W.group('Overlay look', rows, { tag: 'live', collapsed: true });
    }

    /* ------------------------------------------------------------ inspector */
    function inspector(refresh) {
        var ev = E.selected();
        var out = [];

        if (!ev) {
            out.push(W.group('Inspector', [
                h('div', { class: 'mm-empty', style: 'white-space:normal', text: 'pick an event from the list, or click one on the map' })
            ]));
            return out;
        }

        var info = E.info(ev);
        out.push(W.group('Event ' + info.id, [
            kvRow('Name', info.name || '—'),
            kvRow('Position', info.x + ',' + info.y),
            kvRow('Page', info.pageIndex >= 0 ? (info.pageIndex + 1) + ' of ' + info.pageCount : 'none active'),
            kvRow('Trigger', (TRIGGERS[info.trigger] || {}).name || '—'),
            info.erased ? kvRow('Erased', 'yes') : null,
            info.transfers.length ? kvRow('Transfers', info.transfers.map(function (t) {
                return t.direct ? 'map ' + t.mapId + ' @ ' + t.x + ',' + t.y : 'by variable';
            }).join(', ')) : null
        ], { tag: 'live' }));

        out.push(W.group('Self-switches', ['A', 'B', 'C', 'D'].map(function (L) {
            return W.row(L, W.checkbox({
                value: $.safe(function () { return $gameSelfSwitches.value([$gameMap.mapId(), info.id, L]); }, 'ss', false),
                label: 'Self-switch ' + L,
                onChange: function (on) {
                    $.vars.setSelfSwitch($gameMap.mapId(), info.id, L, on);
                    $.safe(function () { ev.refresh(); }, 'refresh');
                    refresh();
                }
            }));
        }).concat([
            W.button({
                label: 'reset A–D', wide: true, variant: 'danger', mutates: true,
                tip: 'Reset|This is what re-opens a looted chest.',
                onClick: function () {
                    var n = E.resetSelfSwitches(ev);
                    U.toast({ title: 'RESET', msg: n + ' self-switch(es) cleared', severity: 'ok' });
                    refresh();
                }
            })
        ]), { tag: 'per event' }));

        // Say why up front rather than only on the click — "already running"
        // after a two-click confirm is a worse way to learn it.
        var why = E.whyNotRunnable(ev);
        out.push(W.group('Actions', [
            W.button({
                label: 'force run this page', wide: true, variant: 'danger', mutates: true,
                disabled: !!why, confirmLabel: 'run it? (irreversible)',
                tip: why
                    ? 'Force run|Not available: ' + why + '.'
                    : 'Force run|May set switches, transfer you, or start a battle. The save is ' +
                      'backed up first.',
                onClick: function () { if (E.forceRun(ev)) U.setOpen(false); }
            }),
            why ? h('div', {
                class: 'mm-sub', style: 'padding:1px 2px;white-space:normal;color:var(--mm-warn)',
                text: 'unavailable — ' + why
            }) : null,
            W.button({
                label: 'move player here', wide: true, mutates: true,
                onClick: function () { E.walkTo(ev); refresh(); }
            }),
            W.button({
                label: 'bring it here', wide: true, mutates: true,
                tip: 'Bring it|Also stops any move route it was mid-way through.',
                onClick: function () { E.bringHere(ev); refresh(); }
            }),
        ]));

        return out;
    }

    function kvRow(label, value) {
        return h('div', { class: 'mm-row' },
            h('div', { class: 'mm-lab', text: label }),
            // Unbounded: an event name, a note tag, a joined list. The edge is
            // allowed to shrink and break, or it pushes the label out and is
            // then clipped by the column, and neither half can be read.
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall',
                text: String(value)
            }));
    }

    /* ------------------------------------------------------------- Commands */
    function buildCommands() {
        var ev = E.selected();
        // Everything on this sub-tab is derived from which event is selected —
        // the command list, the page dropdown, the conditions, the note — so a
        // new selection means rebuilding it rather than patching it. The shell
        // restores scroll offsets across a rebuild, so nothing is lost.
        onSelect = function () { U.rerender(); };

        if (!alive()) {
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' }, h('b', { text: 'no map loaded' })));
        }
        if (!ev) {
            /* A selection can become valid again without anybody clicking
               anything: it is scoped to the map it was made on, so walking
               back through the door restores it. Without this the panel is a
               dead end — it says "pick one" about an event that is selected,
               on the map it was selected on, until something else rebuilds the
               tab. Clicking one still arrives through event:select above; this
               is only the case where nothing was clicked. */
            U.live(function () { return E.selected() ? 'selected' : 'none'; },
                function () { U.rerender(); },
                { name: 'event commands (nothing selected)' });
            return h('div', { class: 'mm-body' },
                h('div', { class: 'mm-todo' },
                    h('b', { text: 'no event selected' }),
                    h('div', { text: 'pick one on the Events sub-tab, or click one on the map' })));
        }

        var info = E.info(ev);
        var pageIndex = info.pageIndex >= 0 ? info.pageIndex : 0;

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '#', w: '0 0 40px', cls: 'mm-td-num' },
                { label: 'code', w: '0 0 46px', cls: 'mm-td-num' },
                { label: 'command', w: '1 1 0' }
            ],
            empty: 'this page has no commands',
            render: function (r) {
                return [
                    String(r.i),
                    String(r.code),
                    h('span', {
                        class: r.code === 355 || r.code === 655 ? 'mm-mono' : '',
                        style: 'padding-left:' + (r.indent * 10) + 'px;overflow:hidden;text-overflow:ellipsis',
                        text: r.text
                    })
                ];
            },
            onRow: function (tr, r) {
                if (r.code === 108 || r.code === 408) tr.style.color = 'var(--mm-text-dim)';
                if (r.code === 111 || r.code === 411 || r.code === 412) tr.style.color = 'var(--mm-info)';
                if (r.code === 121 || r.code === 122 || r.code === 123) tr.style.color = 'var(--mm-ok)';
                if (r.code === 201) tr.style.color = 'var(--mm-inspect)';
                tr.setAttribute('data-mm-tip', 'code ' + r.code + '|' +
                    JSON.stringify(r.raw.parameters || []).slice(0, 180));
            }
        });

        var pages = [];
        for (var i = 0; i < info.pageCount; i++) pages.push('page ' + (i + 1));
        var shown = pageIndex;
        function repaint() { table.mm.paint(E.decode(ev, shown)); }
        repaint();

        // .mm-stack-tight is the 1px version of the same margin idiom.
        var condBox = h('div', { class: 'mm-stack-tight' });
        function paintConditions() {
            U.clear(condBox);
            U.add(condBox, E.conditions(ev, shown).map(function (c) {
                return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:1px 2px', text: '· ' + c });
            }));
        }
        paintConditions();

        function activeText(ix) { return 'active page: ' + (ix >= 0 ? ix + 1 : 'none'); }
        var activeEl = h('span', { class: 'mm-sub', text: activeText(info.pageIndex) });

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.dropdown({
                options: pages, value: pages[shown] || pages[0], width: '96px', _ungated: true,
                onChange: function (v) { shown = pages.indexOf(v); repaint(); paintConditions(); }
            }),
            activeEl);

        var posRow = kvRow('Position', info.x + ',' + info.y);

        /* Three things on this panel are the game's and not the page data's:
           which page the engine has chosen to run, where the event is standing,
           and the "(now N)" the variable condition carries. The command list
           itself is page data and does not move — and `shown` is the page the
           USER picked, so a live repaint never changes it. Switching the panel
           to the newly active page would take away the page they were reading
           the moment a switch flipped.

           BOTH halves re-ask E.selected() first, and neither trusts `ev`.
           E.selected() is map-scoped on purpose (event ids repeat across maps)
           but this hook is not: after a transfer the captured Game_Event is no
           longer in $gameMap._events, so nothing updates it — while
           Game_Event.prototype.event() is $dataMap.events[id], which is now
           the NEW map's data. Painting from it put the old map's position and
           page index beside the new map's page conditions, live "(now N)"
           readouts included, and presented all three as current. A rebuild is
           the right answer because everything on the panel is derived from the
           selection; buildCommands then says "no event selected", which is
           true. Same shape as Party's `P.selected() !== a` and Quest's
           `live.eventId() !== builtFor`. */
        var builtFor = ev;
        U.live(function () {
            if (E.selected() !== builtFor) return 'the selection is gone';
            var live = E.info(ev);
            if (!live) return '';
            return live.pageIndex + ':' + live.x + ',' + live.y + ':' +
                E.conditions(ev, shown).join('|');
        }, function () {
            if (E.selected() !== builtFor) { U.rerender(); return; }
            var live = E.info(ev);
            if (!live) return;
            activeEl.textContent = activeText(live.pageIndex);
            posRow.lastChild.textContent = live.x + ',' + live.y;
            paintConditions();
        }, { name: 'event commands', within: condBox });

        return cols({ narrow: true, items: [
            W.group('Event ' + info.id, [
                kvRow('Name', info.name || '—'),
                posRow,
                kvRow('Pages', String(info.pageCount))
            ]),
            W.group('Page conditions', [condBox], { tag: 'page ' + (shown + 1) }),
            W.group('Note', [
                h('div', {
                    class: 'mm-sub mm-selectable', style: 'white-space:pre-wrap;padding:2px',
                    text: info.note || '(none)'
                })
            ], { collapsed: !info.note })
        ] }, [
            W.group('Command list', [toolbar, table], { grow: true, tag: 'event ' + info.id })
        ]);
    }

    /* =====================================================================
       PART 4 — CROSS-MAP SEARCH

       "Which events, anywhere in this game, touch switch 42?"

       The engine cannot answer it at all. It loads exactly one map at a time
       and keeps no record of the others, so the only honest answers available
       from live data are "this map" and "I do not know". The boot index reads
       every data/MapNNN.json once and records the switch, variable and
       self-switch ids each event page references, which turns the question
       into a lookup.

       Two rules make it safe to act on:

         1. THE INDEX IS FOR FINDING, NEVER AUTHORITY. Every hit is a
            CANDIDATE. The map is re-resolved against live $dataMapInfos
            before it is shown, and where the hit is on the map the player is
            standing on, the event itself is re-read from $gameMap — so a row
            that says 12,7 is a row the game agrees with, and one the index is
            wrong about is marked rather than trusted.
         2. When the index cannot answer, its own reason is shown. That string
            is written for the user already, and an empty list with no reason
            reads as "nothing uses it", which is the one wrong answer this
            panel must never give.
       ===================================================================== */
    var TYPES = ['switch', 'variable', 'self-switch'];
    var LETTERS = ['A', 'B', 'C', 'D'];
    // Survives a panel rebuild: the shell rebuilds tabs on any rerender, and a
    // search that cleared itself every time the overlay repainted would be
    // unusable.
    var find = { type: 'switch', id: 1, letter: 'A', ran: false };

    function findKey() { return find.type === 'self-switch' ? find.letter : Math.floor(find.id) || 0; }

    /** The name the live database gives the thing being searched for. */
    function subjectName() {
        if (find.type === 'self-switch') return 'self-switch ' + find.letter;
        var id = findKey();
        var name = find.type === 'switch' ? swName(id) : varName(id);
        return (find.type === 'switch' ? 'switch ' : 'variable ') + id + (name ? ' "' + name + '"' : '');
    }

    /**
     * Candidates for "every event that touches this", re-resolved against
     * live data. Returns the index's own {candidates, complete, why} shape.
     */
    E.findTouching = function (type, key) {
        if (!$.index || !$.index.findEventsTouching) {
            return {
                candidates: [], complete: false,
                why: 'the index module is not installed, so only the loaded map can be searched.'
            };
        }
        var kind = type === 'self-switch' ? 'selfswitch' : type;
        var r = $.safe(function () { return $.index.findEventsTouching(kind, key); },
            'index.findEventsTouching', null);
        if (!r) return { candidates: [], complete: false, why: 'the search threw — see the log.' };

        var here = $.safe(function () { return $gameMap ? $gameMap.mapId() : 0; }, 'map id', 0);
        var live = (r.candidates || []).map(function (c) {
            var info = $.safe(function () {
                return (typeof $dataMapInfos !== 'undefined' && $dataMapInfos && $dataMapInfos[c.mapId]) || null;
            }, 'map info', null);
            var row = {
                mapId: c.mapId,
                mapName: info ? (info.name || c.mapName) : c.mapName,
                stale: !info,
                eventId: c.eventId, eventName: c.eventName,
                x: c.x, y: c.y, moved: false, gone: false, here: c.mapId === here && !!here
            };
            // On the loaded map the game itself is the authority, so use it:
            // an event that has been moved, erased or spawned since the index
            // was built is reported as it actually is.
            if (row.here) {
                var ev = $.safe(function () { return $gameMap.event(c.eventId); }, 'live event', null);
                if (!ev) { row.gone = true; }
                else {
                    if (ev.x !== row.x || ev.y !== row.y) row.moved = true;
                    row.x = ev.x; row.y = ev.y;
                    var d = $.safe(function () { return ev.event(); }, 'event data', null);
                    if (d && d.name) row.eventName = d.name;
                }
            }
            return row;
        });
        return { candidates: live, complete: !!r.complete, why: r.why || '' };
    };

    /**
      * Go to a hit.
      *
      * Through the Map module, so it inherits the save backup, the teleport
      * history and the "can I teleport right now" check — none of which
      * belongs to this module. It lands on the event's OWN tile, which is
      * what "take me to it" has to mean; that will set off a touch-triggered
      * event on arrival, and Movement → Ghost is the switch that stops it.
      */
    E.goTo = function (row) {
        if (!$.map || !$.map.teleport) {
            U.toast({ title: 'NO TELEPORT', msg: 'the Map module did not load', severity: 'warn' });
            return false;
        }
        if (row.gone) {
            U.toast({ title: 'NOT THERE', msg: 'that event is not on the map any more', severity: 'warn' });
            return false;
        }
        return $.map.teleport(row.mapId, row.x, row.y, 0, 0);
    };

    function buildFind() {
        var rows = [], summary = null, note = null;

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: 'map', w: '1 1 0' },
                { label: '#', w: '0 0 42px', cls: 'mm-td-num' },
                { label: 'event', w: '1 1 0' },
                { label: 'x,y', w: '0 0 58px', cls: 'mm-td-num' },
                { label: '', w: '0 0 76px' }
            ],
            empty: 'nothing searched for yet',
            render: function (r) {
                return [
                    h('span', { text: r.mapName || ('map ' + r.mapId) }),
                    String(r.eventId),
                    h('span', { text: r.eventName || '(unnamed)' }),
                    r.gone ? '—' : (r.x + ',' + r.y),
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'go', mini: true, variant: 'danger', mutates: true,
                            disabled: !$.map || !$.map.teleport || r.gone,
                            tip: !$.map || !$.map.teleport
                                ? 'Go|Not available: the Teleport module did not load.'
                                : 'Go|Teleports onto the event\'s tile, backing the save up ' +
                                  'first. A touch-triggered event fires on arrival — ' +
                                  'Movement → Ghost stops that.',
                            onClick: function () { if (E.goTo(r)) U.setOpen(false); }
                        }))
                ];
            },
            onRow: function (tr, r) {
                if (r.here) tr.classList.add('mm-on');
                if (r.stale || r.gone) tr.style.opacity = '.55';
                tr.setAttribute('data-mm-tip', (r.mapName || ('map ' + r.mapId)) + '|map ' + r.mapId +
                    ', event ' + r.eventId + ' "' + (r.eventName || '') + '"' +
                    (r.gone ? ' — the index lists it, but the loaded map has no such event, so the index is out of date.'
                        : ' at ' + r.x + ',' + r.y) +
                    (r.moved ? ' (it has moved since the index was built; these are the live coordinates)' : '') +
                    (r.here ? ' — this is the map you are on.' : '') +
                    (r.stale ? ' — this map is no longer in the database, so the index is out of date. Rebuild it in Debug → Index.' : ''));
                if (r.here && !r.gone) {
                    tr.style.cursor = 'pointer';
                    // Already here: selecting is more useful than teleporting,
                    // and it puts the event in the inspector on the next tab.
                    tr.addEventListener('click', function () {
                        E.select(r.eventId);
                        U.toast({ title: 'SELECTED', msg: 'event ' + r.eventId + ' — see Events', severity: 'ok' });
                    });
                }
            }
        });

        function repaint() {
            table.mm.paint(rows);
        }

        function run() {
            var key = findKey();
            var r = E.findTouching(find.type, key);
            rows = r.candidates;
            find.ran = true;
            var stale = rows.filter(function (x) { return x.stale || x.gone; }).length;
            summary.textContent = r.candidates.length
                ? r.candidates.length + ' event(s) on ' +
                  countMaps(rows) + ' map(s)' + (stale ? ' · ' + stale + ' stale' : '')
                : (r.complete ? 'no event anywhere references it' : 'no answer');
            note.textContent = r.complete ? '' : r.why;
            note.style.display = r.complete ? 'none' : '';
            repaint();
        }

        function countMaps(list) {
            var seen = Object.create(null), n = 0;
            list.forEach(function (r) { if (!seen[r.mapId]) { seen[r.mapId] = true; n++; } });
            return n;
        }

        summary = h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' });
        note = h('div', {
            class: 'mm-sub',
            style: 'display:none;padding:2px;white-space:normal;color:var(--mm-warn)'
        });

        var keyRow = find.type === 'self-switch'
            ? W.row('Channel', W.dropdown({
                options: LETTERS, value: find.letter, width: '90px', _ungated: true,
                onChange: function (v) { find.letter = v; run(); }
            }))
            : W.row('Id', W.number({
                value: findKey(), min: 0, max: 99999, wide: true, _ungated: true,
                onChange: function (v) { find.id = v; run(); }
            }));

        var left = [
            W.group('Find events that touch', [
                W.row('Kind', W.dropdown({
                    options: TYPES, value: find.type, width: '110px', _ungated: true,
                    tip: 'Kind|Switch and variable are searched by id, self-switch by channel A–D.',
                    onChange: function (v) { find.type = v; U.rerender(); }
                })),
                keyRow,
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', style: 'white-space:normal', text: subjectName() })),
                W.button({
                    label: 'search', wide: true, _ungated: true,
                    onClick: function () { run(); }
                }),
                summary,
                note
            ], { tag: 'index' }),

            W.group('What this is', [
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'The engine only sees the map you are on. This reads the boot index, ' +
                    'which walked every map file once.'),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Rows the game no longer agrees with are dimmed. Rebuild the index from ' +
                    'Debug → Index.'),
                $.index ? W.button({
                    label: 'rebuild the index', wide: true, _ungated: true,
                    onClick: function () { $.safe(function () { $.index.rebuild(); }, 'index rebuild'); run(); }
                }) : null
            ], { tag: 'candidates', collapsed: true })
        ];

        // A search that was run before this rebuild is re-run rather than
        // remembered, so the rows are always resolved against data as it is
        // now — the panel must never show a hit the game has since lost.
        if (find.ran) run(); else summary.textContent = 'pick a kind and an id, then press search';

        return cols({ narrow: true, items: left }, [
            W.group('Hits', [table], { grow: true, tag: find.ran ? rows.length + '' : '—' })
        ]);
    }

    /* -------------------------------------------------------- registration */
    U.panel('world', 'Events', function () { return buildEvents(); }, 90);
    U.panel('world', 'Commands', function () { return buildCommands(); }, 100);
    U.panel('world', 'Find', function () { return buildFind(); }, 110);

    // Keep the HUD badge honest about the overlay being live.
    $.on('mounted', function () { U.setActive('event overlay', !!cfg().on); });
    if (U.getHost()) U.setActive('event overlay', !!cfg().on);

    $.store.unsafeAtBoot('events.on',
        'the overlay paints into the running map and would be found already on after a crash');

    $.api.findEvents = function (type, key) { return E.findTouching(type || 'switch', key); };

    $.log('ok', 'event overlay ready');
    $.log($.index && $.index.findEventsTouching ? 'info' : 'warn',
        'cross-map event search: ' + ($.index && $.index.findEventsTouching
            ? 'available through the index'
            : 'unavailable — the Index module did not load, so only the current map can be listed'));

})(window.GigaHack);
