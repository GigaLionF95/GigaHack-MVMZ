//=============================================================================
// GigaHack MV/MZ
// 18 · forge.js — custom items, weapons, armors, skills, states, actors,
//      classes, enemies, troops and common events
//-----------------------------------------------------------------------------
// Definitions live in the library file and are written straight into the
// $data* arrays at fixed indices above the game's own content. They are NOT
// appended: appending derives the id from the array length, so an id moves the
// moment the game ships one more row — and a save holding the old id then
// points at a different object. Fixed indices are what makes the save-compat
// rule ("a custom id, once handed out, always means that thing") possible at
// all.
//
// WHERE THE INDICES COME FROM. Nothing here is a literal. Each kind's base is
// derived from the loaded database — highest id plus a margin, rounded — which
// is $.profile's job, and the resolved value is then RECORDED IN THE LIBRARY
// FILE. On every later launch the recorded base wins, so ids stay put even if
// the game is patched and grows. The base this database would compute now is
// still worked out, so the two can be compared: a drift is reported and a
// migration offered, never applied behind the player's back.
//
// WHAT "CUSTOM" MEANS. Membership in the loaded library, never `id >= base`.
// A threshold test is a claim about a number rather than about a row: on any
// game whose own arrays reach past the base, every stock row above it answers
// yes, and the Forge would offer to edit and delete content the game owns.
//
// The two consequences that shape the rest of this file:
//   · an id is never reused. Deleting leaves a tombstone at the same index, so
//     an old save that still holds the id finds *something* rather than
//     `undefined`, which is a crash in every item window in the engine.
//   · injection has to happen before the game's own boot-time processing, and
//     has to survive a save being loaded. Both are handled by hooks below.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — the Forge: custom database rows, on MV and MZ
 * @author gigahack
 * @help GigaHack_Forge.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat, Index, Inv, Party
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — forge not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols, clear = U.clear, add = U.add;

    /* =====================================================================
       SERVICES
       Compat, Profile and Index load before this module by manifest; a partial
       install still must not throw. Each shim has the surface of the real
       service and degrades to the honest answer rather than to a guess.
       ===================================================================== */
    function verify(control, write, read, want, compare) {
        if ($.compat && $.compat.verify) return $.compat.verify(control, write, read, want, compare);
        $.safe(write, 'write ' + control);
        var got = $.safe(read, 'read ' + control, undefined);
        var ok = compare ? compare(got, want) : got === want;
        return {
            ok: ok, got: got, want: want, culprits: [],
            message: ok ? '' : 'wrote ' + JSON.stringify(want) + ' and read back ' + JSON.stringify(got) +
                '. The compatibility module is not installed, so nothing can be named as the cause.'
        };
    }
    function degraded(control) { return !!($.compat && $.compat.isDegraded && $.compat.isDegraded(control)); }
    function degradedWhy(control) { return ($.compat && $.compat.degradedWhy && $.compat.degradedWhy(control)) || ''; }

    /* A control whose writes do not stick is MARKED, never hidden and never
       made inert: the cause may have gone away — a plugin's own state changed,
       a reload — and the only way to find out is to let the user try. */
    function degradeNote(control) {
        if (!degraded(control)) return null;
        return h('div', { class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px' },
            h('b', { text: 'writes into the database are not sticking. ' }),
            degradedWhy(control) + ' ',
            W.button({
                label: 'try again', mini: true, _ungated: true,
                tip: 'Try again|Clears the mark so the next write is re-tested.',
                onClick: function () {
                    if ($.compat && $.compat.clearDegraded) $.compat.clearDegraded(control);
                    U.rerender();
                }
            }));
    }
    function degradeMark(el, control) {
        if (!el || !degraded(control)) return el;
        el.style.opacity = '0.55';
        el.setAttribute('data-mm-tip', 'Not sticking|' + degradedWhy(control));
        return el;
    }

    /* =====================================================================
       PART 0 — STYLES
       Appended to the design system's second stylesheet before the shell
       mounts (Boot loads after this file, and Boot is what calls mount()).
       If the sheet is already live — a reload, or a test poking at it — the
       rules are pushed into the mounted element too.
       ===================================================================== */
    var FORGE_CSS = [
        // A fixed height, not a max-height: the grid is windowed, so its own
        // content height is only ever a screenful and the scroller has to keep
        // its size from the spacers instead. overflow-anchor is off here and on
        // the children for the reason the README's defect table gives — Chromium
        // compensates scrollTop for DOM changes above the offset, which is what
        // a virtual list does on every scroll event, and the two feed each other.
        '#mm-root .mm-forge-icons{height:132px;overflow:auto;overflow-anchor:none;',
        '  background:var(--mm-bg-sunken);box-shadow:var(--mm-inset);padding:3px}',
        '#mm-root .mm-forge-icons>*{overflow-anchor:none}',
        // No justify-content:center. Centred overflow is unreachable — scrollLeft
        // cannot go negative — so narrowing the window hid the leftmost icons
        // with no way to scroll back to them. The column count is measured
        // instead, so the grid never overflows sideways in the first place.
        // justify-content stays at the default. Centring is done with an
        // explicit width and auto margins instead, because auto margins
        // resolve to zero when there is no free space — so if the measurement
        // is ever wrong the grid falls back to a normal scrollable overflow
        // from the left, rather than an overflow nobody can reach.
        //
        // FLOOR: this was a CSS grid with a 2px gap. Grid picked that up in
        // Chromium 66 and flex not until 84, and the older two-word spelling
        // reads the same to anything linting for it — so it is flex-wrap with
        // the spacing carried on the cells, the conversion the design system
        // already made for its own icon grid. A '> * + *' margin cannot be used
        // here because this container WRAPS, and that rule opens no gap between
        // wrapped rows. The cell keeps a fixed width rather than the percentage
        // used there: a cell is one icon, and the windowing arithmetic below
        // counts in whole pitches of 16 + 2.
        '#mm-root .mm-forge-icons-grid{display:flex;flex-wrap:wrap;margin:0 auto}',
        '#mm-root .mm-forge-icons-grid button{width:16px;height:16px;padding:0;border:0;background:transparent;',
        '  display:block;cursor:pointer;box-shadow:0 0 0 1px #1f2126;margin-right:2px;margin-bottom:2px}',
        '#mm-root .mm-forge-icons-grid button:hover{box-shadow:0 0 0 1px #6a6f78}',
        '#mm-root .mm-forge-icons-grid button.mm-on{box-shadow:0 0 0 1px var(--mm-accent)}',
        '#mm-root .mm-forge-icons .mm-icon,#mm-root .mm-forge-icons .mm-icocell{pointer-events:none}',
        // FLOOR, again: the three stacks below spaced their children with
        // 'gap', which needs Chromium 84. Each one now uses the design system's
        // own idiom — '> * + *' with a LONG-HAND margin, because a 'margin'
        // shorthand on the same selector would wipe the sibling rules that
        // follow it. None of these three wrap, so '+' is enough.
        '#mm-root .mm-forge-card{background:var(--mm-bg-sunken);box-shadow:var(--mm-inset);',
        '  padding:5px 6px;display:flex;flex-direction:column}',
        '#mm-root .mm-forge-card>*+*{margin-top:4px}',
        '#mm-root .mm-forge-desc{font-size:var(--mm-fs-sm);color:var(--mm-text);white-space:pre-wrap;',
        '  word-break:break-word;line-height:1.45;min-height:14px}',
        '#mm-root .mm-forge-fx{display:flex;flex-direction:column}',
        '#mm-root .mm-forge-fx>*+*{margin-top:1px}',
        '#mm-root .mm-forge-fxrow{display:flex;align-items:center;padding:1px 2px}',
        '#mm-root .mm-forge-fxrow>*+*{margin-left:var(--mm-sp-2)}',
        '#mm-root .mm-forge-fxrow>.mm-dd{flex:1 1 auto;min-width:0}',
        '#mm-root .mm-forge-dead{color:var(--mm-text-dim);font-style:italic}',
        '#mm-root .mm-forge-badge{font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);',
        '  letter-spacing:var(--mm-track);text-transform:uppercase;color:var(--mm-text-dim)}'
    ].join('\n');

    U.CSS2 = (U.CSS2 || '') + '\n' + FORGE_CSS;
    (function pushLive() {
        var live = document.getElementById('gigahack-style');
        if (live) live.textContent += '\n' + FORGE_CSS;
    })();

    /* =====================================================================
       PART 1 — MODEL
       ===================================================================== */
    var F = $.forge = {};

    var FILE = 'items.json';
    var SCHEMA = 2;

    /**
     * The ten kinds. Every one of them is a plain database row the engine
     * reads the same way. `klass` rather than `class` because the latter is a
     * reserved word and this file is strict mode — the key would parse,
     * `d.class` would not.
     *
     * There is no `start` here. Where a kind's ids begin is not a property of
     * the kind, it is a property of the GAME, and it is resolved below.
     */
    var KINDS = {
        item: { label: 'Item', arr: function () { return typeof $dataItems !== 'undefined' ? $dataItems : null; }, plural: 'items', index: 'items' },
        weapon: { label: 'Weapon', arr: function () { return typeof $dataWeapons !== 'undefined' ? $dataWeapons : null; }, plural: 'weapons', index: 'weapons' },
        armor: { label: 'Armor', arr: function () { return typeof $dataArmors !== 'undefined' ? $dataArmors : null; }, plural: 'armors', index: 'armors' },
        skill: { label: 'Skill', arr: function () { return typeof $dataSkills !== 'undefined' ? $dataSkills : null; }, plural: 'skills', index: 'skills' },
        state: { label: 'State', arr: function () { return typeof $dataStates !== 'undefined' ? $dataStates : null; }, plural: 'states', index: 'states' },
        actor: { label: 'Actor', arr: function () { return typeof $dataActors !== 'undefined' ? $dataActors : null; }, plural: 'actors', index: 'actors' },
        klass: { label: 'Class', arr: function () { return typeof $dataClasses !== 'undefined' ? $dataClasses : null; }, plural: 'classes', index: 'classes' },
        enemy: { label: 'Enemy', arr: function () { return typeof $dataEnemies !== 'undefined' ? $dataEnemies : null; }, plural: 'enemies', index: 'enemies' },
        troop: { label: 'Troop', arr: function () { return typeof $dataTroops !== 'undefined' ? $dataTroops : null; }, plural: 'troops', index: 'troops' },
        common: { label: 'Common event', arr: function () { return typeof $dataCommonEvents !== 'undefined' ? $dataCommonEvents : null; }, plural: 'common events', index: 'common' }
    };
    var KIND_IDS = ['item', 'weapon', 'armor', 'skill', 'state', 'actor', 'klass', 'enemy', 'troop', 'common'];
    F.KINDS = KINDS;
    F.kindIds = function () { return KIND_IDS.slice(); };

    /* =====================================================================
       ID BASES

       A base is the first id a kind may allocate. It has to sit above
       everything the game itself ships, and it has to STAY where it was once
       an id has been handed out, because a save that holds the id means that
       thing by it forever.

       Those two requirements pull in opposite directions the moment the game
       is patched and grows, so they are answered by two different numbers:

         COMPUTED — what this database would put the base at right now.
                    $.profile derives it (highest id + a margin, rounded) and a
                    profile may override any kind. Not knowable until the
                    database has loaded, which is AFTER this file runs.
         RECORDED — what the library file says the base was when its ids were
                    handed out. Needs no database, travels with the file, and
                    WINS wherever it exists.

       The two are compared once the database is up. A difference is reported,
       and a migration is offered; it is never applied on its own, because
       moving an id silently is the one failure this whole module is built to
       avoid.
       ===================================================================== */

    var BASE_ROUND = 1000;      // the unit bases are rounded to
    var BASE_MARGIN = 200;      // head-room for the game to grow into
    var SPAN_UNITS = 9;         // rounding units of allocation window, at least

    /**
     * How far above its base a kind may allocate.
     *
     * A guard, not a budget: `put()` pads the data array with nulls up to the
     * id it is writing, so one mistyped digit in a shared library file (id
     * 99999999) would otherwise push ninety-nine million entries into the
     * array and hang the game at boot, on every launch, until someone deleted
     * the file by hand.
     *
     * It is expressed RELATIVE TO THE BASE rather than as a second fixed
     * number, so a large project is not held to a smaller window than a small
     * one: nine rounding units of head-room, or the base itself, whichever is
     * the larger.
     */
    function spanFor(base) {
        return Math.max(BASE_ROUND * SPAN_UNITS, (base | 0) - 1);
    }

    /* The library file exactly as it was read. Kept because the bases recorded
       inside it have to be answerable before the library is normalised — and
       because normalisation cannot happen at all until they are. */
    var rawSrc = null;
    var rawSeen = false;

    var BASES = null;           // {kind: base}, once resolvable
    var BASE_SOURCE = '';       // 'recorded' | 'computed'
    var baseDrift = [];         // [{kind, recorded, computed, collides}]

    function dbReady() {
        return typeof $dataItems !== 'undefined' && !!$dataItems &&
               typeof $dataSystem !== 'undefined' && !!$dataSystem;
    }

    /* The same derivation $.profile uses, present only for the case where the
       profile module is not installed at all. */
    function localBase(arr) {
        var need = ((arr && arr.length) || 0) + BASE_MARGIN;
        return Math.max(BASE_ROUND, Math.ceil(need / BASE_ROUND) * BASE_ROUND) + 1;
    }

    /** What this database would put the bases at right now. Null before it loads. */
    function computedBases() {
        if (!dbReady()) return null;
        var from = $.safe(function () {
            return ($.profile && $.profile.get) ? $.profile.get('forgeBase', null) : null;
        }, 'forge bases from profile', null);
        var out = {};
        KIND_IDS.forEach(function (k) {
            var v = from ? Math.floor(Number(from[k])) : NaN;
            if (!isFinite(v) || v < 1) v = localBase(KINDS[k].arr());
            out[k] = v;
        });
        return out;
    }

    /** What the library file says. Wins where it exists, and needs no database. */
    function recordedBases(raw) {
        if (!raw || !raw._bases || typeof raw._bases !== 'object') return null;
        var out = {}, got = 0, missing = [];
        KIND_IDS.forEach(function (k) {
            var v = Math.floor(Number(raw._bases[k]));
            if (isFinite(v) && v >= 1) { out[k] = v; got++; } else missing.push(k);
        });
        if (!got) return null;
        if (missing.length) {
            // A partially recorded set — an older library, or a hand edit. The
            // kinds that ARE recorded still win; the rest need the database,
            // so the whole answer waits rather than half of it being guessed.
            var comp = computedBases();
            if (!comp) return null;
            missing.forEach(function (k) { out[k] = comp[k]; });
            $.log('warn', FILE + ' records no id base for ' + missing.join(', ') +
                ' — those kinds take the computed base, and the value is written back on the next save.');
        }
        return out;
    }

    function ensureBases() {
        if (BASES) return BASES;
        var rec = recordedBases(rawSrc);
        if (rec) { BASES = rec; BASE_SOURCE = 'recorded'; return BASES; }
        var comp = computedBases();
        if (!comp) return null;          // before boot, with nothing recorded to go on
        BASES = comp; BASE_SOURCE = 'computed';
        return BASES;
    }

    /** The first id this kind may allocate, or 0 while that cannot be known. */
    F.base = function (kind) {
        var b = ensureBases();
        return (b && b[kind]) ? b[kind] : 0;
    };
    /** One past the last id this kind may allocate, or 0 when the base is not known. */
    F.ceiling = function (kind) {
        var b = F.base(kind);
        return b ? b + spanFor(b) : 0;
    };
    F.maxId = function (kind) {
        var c = F.ceiling(kind);
        return c ? c - 1 : 0;
    };
    F.bases = function () { return $.clone(ensureBases() || {}); };
    F.baseSource = function () { return BASE_SOURCE; };
    F.baseDrift = function () { return baseDrift.slice(); };

    /** Why there is no base yet, in words the panel can show. */
    F.baseWhy = function () {
        if (ensureBases()) return '';
        return 'the id bases are not resolved yet: the library records none, and the database has not ' +
               'loaded, so there is nothing to compute them from.';
    };

    /** Human range text for one kind. */
    F.rangeText = function (kind) {
        var b = F.base(kind);
        if (!b) return 'not allocated yet';
        return b + '–' + (F.ceiling(kind) - 1);
    };

    /**
     * Compare what the library recorded against what this database would
     * compute now.
     *
     * Only the upward direction is dangerous: the game having grown past a
     * recorded base means ids inside the window may now belong to the game,
     * and `put()` will refuse to write there — correctly, but the user needs
     * to be told why their entries stopped appearing. Downward drift wastes
     * space and nothing else.
     */
    F.checkBases = function () {
        baseDrift = [];
        if (BASE_SOURCE !== 'recorded' || !BASES) return baseDrift;
        var comp = computedBases();
        if (!comp) return baseDrift;
        KIND_IDS.forEach(function (k) {
            if (comp[k] === BASES[k]) return;
            baseDrift.push({
                kind: k, recorded: BASES[k], computed: comp[k],
                collides: comp[k] > BASES[k]
            });
        });
        if (baseDrift.length) {
            var bad = baseDrift.filter(function (d) { return d.collides; });
            $.log(bad.length ? 'warn' : 'info',
                'forge: ' + baseDrift.length + ' recorded id base(s) differ from what this database would ' +
                'compute now — ' + baseDrift.map(function (d) {
                    return KINDS[d.kind].plural + ' ' + d.recorded + ' → ' + d.computed;
                }).join(', ') + '. ' + (bad.length
                    ? 'The game has grown past ' + bad.length + ' of them, so ids there may now belong to the ' +
                      'game and new rows in that window will be refused. Forge → Id ranges can migrate them.'
                    : 'Nothing is at risk — the recorded bases simply sit higher than they need to.'));
        }
        return baseDrift;
    };

    /* ------------------------------------------------------------ templates
       A blank row, field for field, in the shape BOTH editors write and BOTH
       engines read. A missing field is not a cosmetic problem: the window and
       action code reads most of these without a guard.

       Nothing that only one engine has appears here. Every field below was
       checked against both engine sources; the only asymmetries the ten kinds
       have are the extended action scopes and one trait code, and both are
       gated on a capability where they are offered rather than written into
       the blank row. `releaseByDamage` is kept because both editors emit it
       and neither engine reads it — dropping it would make a forged row differ
       from an editor-written one for no gain.

       ANYTHING A PLUGIN ADDS BELONGS IN THE PROFILE, not here. 1.x carried one
       game's `messageType` on skills and states; it is not a stock field on
       either engine, and a stock game must never be handed it. Extra fields
       now come from $.profile's `forgeExtraFields` and are merged in by
       blank() below.
       --------------------------------------------------------------------- */
    function blankDamage(type, element) {
        return { critical: false, elementId: element, formula: '0', type: type, variance: 20 };
    }

    var TEMPLATES = {
        item: function () {
            return {
                id: 0, animationId: 0, consumable: true, damage: blankDamage(0, 0),
                description: '', effects: [], hitType: 0, iconIndex: 176, itypeId: 1,
                name: '', note: '', occasion: 0, price: 0, repeats: 1, scope: 7,
                speed: 0, successRate: 100, tpGain: 0
            };
        },
        weapon: function () {
            return {
                id: 0, animationId: 0, description: '', etypeId: 1, traits: [],
                iconIndex: 97, name: '', note: '', params: [0, 0, 0, 0, 0, 0, 0, 0],
                price: 0, wtypeId: 1
            };
        },
        armor: function () {
            return {
                id: 0, atypeId: 1, description: '', etypeId: 2, traits: [],
                iconIndex: 135, name: '', note: '', params: [0, 0, 0, 0, 0, 0, 0, 0],
                price: 0
            };
        },
        skill: function () {
            return {
                id: 0, animationId: -1, damage: blankDamage(0, -1), description: '',
                effects: [], hitType: 0, iconIndex: 76, message1: '', message2: '',
                mpCost: 0, name: '', note: '', occasion: 0, repeats: 1,
                requiredWtypeId1: 0, requiredWtypeId2: 0, scope: 1, speed: 0,
                stypeId: 1, successRate: 100, tpCost: 0, tpGain: 0
            };
        },
        state: function () {
            return {
                id: 0, autoRemovalTiming: 1, chanceByDamage: 100, iconIndex: 0,
                maxTurns: 5, message1: '', message2: '', message3: '', message4: '',
                minTurns: 3, motion: 0, name: '', note: '', overlay: 0, priority: 50,
                releaseByDamage: false, removeAtBattleEnd: false, removeByDamage: false,
                removeByRestriction: false, removeByWalking: false, restriction: 0,
                stepsToRemove: 100, traits: []
            };
        }
        ,
        /* -----------------------------------------------------------------
           Actors, classes, enemies and troops are the same shape of thing the
           first five are: rows the engine reads without a guard. Common
           events are the outlier — their `list` is a program, and it must end
           with the {code:0} terminator or Game_Interpreter runs off the end of
           the array and the game hangs on a blank frame.
        ------------------------------------------------------------------- */
        actor: function () {
            return {
                id: 0, battlerName: '', characterIndex: 0, characterName: '', classId: 1,
                equips: [0, 0, 0, 0, 0], faceIndex: 0, faceName: '', traits: [],
                initialLevel: 1, maxLevel: 99, name: '', nickname: '', note: '', profile: ''
            };
        },
        klass: function () {
            return {
                id: 0, expParams: [30, 20, 30, 30], traits: [{ code: 23, dataId: 0, value: 1 }],
                learnings: [], name: '', note: '',
                // Both engines store an 8 x 100 curve, and a blank one still
                // has to BE 8 x 100: Game_Actor.paramBase indexes
                // params[id][level] with no bounds guard on either engine, so
                // a short row reads undefined and turns the whole stat block
                // to NaN on the first draw.
                params: buildCurve([400, 80, 30, 30, 30, 30, 30, 30])
            };
        },
        enemy: function () {
            return {
                id: 0, actions: [{ conditionParam1: 0, conditionParam2: 0, conditionType: 0, rating: 5, skillId: 1 }],
                battlerHue: 0, battlerName: '', dropItems: [
                    { dataId: 1, denominator: 1, kind: 0 },
                    { dataId: 1, denominator: 1, kind: 0 },
                    { dataId: 1, denominator: 1, kind: 0 }
                ],
                exp: 0, traits: [], gold: 0, name: '', note: '',
                params: [100, 0, 10, 10, 10, 10, 10, 10]
            };
        },
        troop: function () {
            return {
                id: 0, members: [], name: '',
                // A troop with no pages is legal and is what the editor writes
                // for a blank one; BattleManager only walks pages that exist.
                pages: [{ conditions: { actorHp: 50, actorId: 1, actorValid: false, enemyHp: 50, enemyIndex: 0, enemyValid: false, switchId: 1, switchValid: false, turnA: 0, turnB: 0, turnEnding: false, turnValid: false }, list: [{ code: 0, indent: 0, parameters: [] }], span: 0 }]
            };
        },
        common: function () {
            return {
                id: 0, list: [{ code: 0, indent: 0, parameters: [] }],
                name: '', switchId: 1, trigger: 0
            };
        }
    };

    /**
     * An 8 x 100 parameter curve from eight level-1 values.
     *
     * Linear, deliberately: the editor's own curves are hand-drawn and there
     * is no honest way to guess one. What matters is that the ARRAY IS THE
     * RIGHT SHAPE — Game_Actor.paramBase does params[id][level] with no guard,
     * so a row shorter than maxLevel+1 reads undefined and every stat the
     * actor has becomes NaN on the first window that draws it.
     */
    function buildCurve(base) {
        var out = [];
        for (var p = 0; p < 8; p++) {
            var row = [], b = Number(base[p]) || 1;
            for (var lv = 0; lv <= 99; lv++) {
                row.push(Math.max(1, Math.round(b * (1 + (lv - 1) * 0.12))));
            }
            out.push(row);
        }
        return out;
    }
    F.buildCurve = buildCurve;

    /**
     * A blank row for `kind`, with whatever the profile says this game's
     * plugins also expect on it.
     *
     * `forgeExtraFields` is `{kind: {field: default}}`. A stock MV or MZ game
     * has none and gets exactly the engine's own shape; a game whose plugins
     * read an extra field declares it once, in its profile, and every blank
     * row and every repair carries it from then on.
     */
    function extraFields(kind) {
        return $.safe(function () {
            var all = ($.profile && $.profile.get) ? $.profile.get('forgeExtraFields', null) : null;
            var mine = (all && typeof all === 'object') ? all[kind] : null;
            return (mine && typeof mine === 'object' && !Array.isArray(mine)) ? mine : null;
        }, 'forge extra fields', null);
    }

    function blank(kind) {
        if (!TEMPLATES[kind]) return null;
        var row = TEMPLATES[kind]();
        var extra = extraFields(kind);
        if (extra) {
            Object.keys(extra).forEach(function (key) {
                // The template wins on a name clash: an engine field is not a
                // profile's to redefine, and silently shadowing one is how a
                // row stops being a row the engine can read.
                if (row[key] === undefined) row[key] = $.clone(extra[key]);
            });
        }
        // A default icon index is a position on THIS game's sheet, and sheets
        // differ. Clamped against the measured count where there is one —
        // deliberately not by calling iconCount(), which would fetch the sheet
        // through ImageManager, and this runs during plugin setup where that
        // is a side effect nobody asked for. Before the sheet has been
        // measured the default stands; the picker widens its own range to
        // include whatever the draft holds either way.
        if (row.iconIndex != null && iconTotal && row.iconIndex >= iconTotal) row.iconIndex = 0;
        return row;
    }
    F.blank = blank;
    F.template = function (kind) { return blank(kind); };

    /* --------------------------------------------------------------- library
       { _schema, entries: { item: [rec], weapon: [], … } }
       rec = { id, tombstone, created, modified, data }
       --------------------------------------------------------------------- */
    var lib = null;

    function emptyLib() {
        var e = {}, n = {}, b = ensureBases();
        KIND_IDS.forEach(function (k) { e[k] = []; n[k] = (b && b[k]) ? b[k] : 0; });
        // `next` is a high-water mark, and it is the only thing that makes
        // "an id is never re-issued" true across launches. Deriving the next id
        // from the records alone works until something removes the highest one
        // — a purge, or a corrupt record dropped on load — after which the data
        // array is back to its shipped length on the next boot and the id is
        // handed out again, to a different thing, while old saves still point
        // at it. The mark only ever moves up.
        //
        // `_bases` is the other half of that promise, and the half 1.x did not
        // have: it pins where the ids came from, so a game that grows between
        // launches cannot move them.
        return { _schema: SCHEMA, _bases: b ? $.clone(b) : null, next: n, entries: e };
    }

    /**
     * Anything on disk is user-editable, and a hand-edited items.json that
     * loses one array must not take the whole Forge down with it. Every field
     * is re-derived rather than trusted, and a record that cannot be repaired
     * is dropped with a log line rather than silently kept in a broken shape.
     */
    /**
     * Put a record's arrays back into the shape the engine indexes without a
     * guard. Runs on BOTH paths — loading a hand-edited file and committing an
     * edit — because a shape that is only repaired on load is a shape the
     * running game does not have until the next launch, and the window that
     * reads it draws long before then.
     */
    function repairShape(kind, data) {
        if (!data || typeof data !== 'object') return data;
        var tpl = blank(kind);
        if (!tpl) return data;

        // deepMerge replaces arrays wholesale, so a short params list survives
        // the merge and every param above its length reads undefined — which
        // turns the wearer's whole stat block to NaN.
        //
        // A class's params are NOT eight numbers, they are eight rows of a
        // hundred. Running the numeric repair over one turns Number([...])
        // into NaN and flattens the curve to zero, so they repair separately.
        if (kind === 'klass') {
            var rows = Array.isArray(data.params) ? data.params : [];
            var fixed = [];
            for (var ri = 0; ri < 8; ri++) {
                var row = Array.isArray(rows[ri]) ? rows[ri] : [];
                var fill = Number(row[row.length - 1]) || Number(row[0]) || 1;
                var outRow = [];
                for (var lv = 0; lv <= 99; lv++) outRow.push(Number(row[lv]) || fill);
                fixed.push(outRow);
            }
            data.params = fixed;
        } else if (tpl.params) {
            var p = Array.isArray(data.params) ? data.params : [];
            data.params = [];
            for (var pi = 0; pi < 8; pi++) data.params[pi] = Number(p[pi]) || 0;
        }

        // A command list that has lost its {code:0} terminator makes
        // Game_Interpreter run off the end of the array: the game stops on a
        // blank frame with nothing in the log.
        if (kind === 'common') {
            data.list = Array.isArray(data.list) ? data.list : [];
            var last = data.list[data.list.length - 1];
            if (!last || last.code !== 0) data.list.push({ code: 0, indent: 0, parameters: [] });
        }
        if (kind === 'troop') {
            if (!Array.isArray(data.members)) data.members = [];
            if (!Array.isArray(data.pages) || !data.pages.length) data.pages = tpl.pages;
        }
        if (kind === 'enemy') {
            if (!Array.isArray(data.actions)) data.actions = tpl.actions;
            if (!Array.isArray(data.dropItems)) data.dropItems = tpl.dropItems;
        }
        if (kind === 'actor' && !Array.isArray(data.equips)) data.equips = tpl.equips;
        if (tpl.learnings && !Array.isArray(data.learnings)) data.learnings = [];
        return data;
    }
    F.repairShape = repairShape;

    /* What the last load threw away, and what it kept but could not place.
       Both are shown in the panel; neither is ever a silent event. */
    F.dropped = [];      // [{kind, id, why}] — the record was unusable
    F.stranded = [];     // [{kind, id, name, base, ceiling}] — kept, not injected

    function normalise(raw) {
        F.dropped = [];
        F.stranded = [];
        var out = emptyLib();
        if (!raw || typeof raw !== 'object') return out;
        if (raw._schema && raw._schema > SCHEMA) {
            $.log('warn', FILE + ' was written by a newer GigaHack (schema ' + raw._schema +
                ' > ' + SCHEMA + ') — refusing to load it rather than half-applying it');
            return out;
        }
        var src = raw.entries || {};
        var marks = raw.next || {};
        var dropped = F.dropped, stranded = F.stranded;

        KIND_IDS.forEach(function (kind) {
            var base = F.base(kind), ceiling = F.ceiling(kind);
            var tpl = blank(kind);
            var list = Array.isArray(src[kind]) ? src[kind] : [];
            var seen = {};
            list.forEach(function (rec, i) {
                if (!rec || typeof rec !== 'object') {
                    dropped.push({ kind: kind, id: null, why: 'entry ' + i + ' is not an object' });
                    return;
                }
                var id = Math.floor(Number(rec.id));
                if (!isFinite(id)) {
                    dropped.push({ kind: kind, id: null, why: 'its id (' + JSON.stringify(rec.id) + ') is not a number' });
                    return;
                }
                if (seen[id]) {
                    dropped.push({ kind: kind, id: id, why: 'a second record claims the same id' });
                    return;
                }
                // `data` has to be a plain object before anything is written to
                // it: under 'use strict', assigning a property to a string is a
                // TypeError, and this function runs at file scope during load.
                if (!rec.data || typeof rec.data !== 'object' || Array.isArray(rec.data)) {
                    dropped.push({ kind: kind, id: id, why: 'it carries no definition object' });
                    return;
                }
                seen[id] = 1;
                var data = $.deepMerge(tpl, rec.data);
                data.id = id;
                repairShape(kind, data);
                ['effects', 'traits'].forEach(function (key) {
                    if (tpl[key] && !Array.isArray(data[key])) data[key] = [];
                });

                // OUT OF RANGE IS NOT A REASON TO DISCARD. A library written
                // against another install — or against this one before the game
                // grew — holds ids this range does not cover. 1.x dropped those
                // records on the floor, so a library authored on a big game
                // vanished on load with one aggregate line in the log. They are
                // kept here and listed in the panel. What they are NOT is
                // injected: an id below the base is an id the game owns, and
                // writing there would replace real content everywhere it is
                // referenced.
                var out_ = !base || id < base || id >= ceiling;
                out.entries[kind].push({
                    id: id,
                    tombstone: !!rec.tombstone,
                    outOfRange: out_,
                    created: rec.created || 0,
                    modified: rec.modified || 0,
                    data: data
                });
                if (out_) {
                    stranded.push({
                        kind: kind, id: id, name: String(data.name || ''),
                        base: base, ceiling: ceiling
                    });
                }
            });
            out.entries[kind].sort(function (a, b) { return a.id - b.id; });

            var mark = Math.floor(Number(marks[kind]));
            if (!isFinite(mark) || mark < base) mark = base;
            out.entries[kind].forEach(function (r) { if (!r.outOfRange && r.id >= mark) mark = r.id + 1; });
            out.next[kind] = base ? Math.min(mark, ceiling) : 0;
        });

        // Say what happened, per record. An aggregate count tells the user
        // something went wrong and nothing about what to do next.
        dropped.forEach(function (d) {
            $.log('warn', FILE + ': dropped a ' + KINDS[d.kind].label.toLowerCase() +
                (d.id == null ? '' : ' with id ' + d.id) + ' — ' + d.why);
        });
        if (stranded.length) {
            $.log('warn', FILE + ': ' + stranded.length + ' record(s) hold ids outside the range this ' +
                'install allocates, so they are kept but NOT written into the database — those ids belong ' +
                'to the game here. ' + stranded.slice(0, 6).map(function (t) {
                    return KINDS[t.kind].label.toLowerCase() + ' ' + t.id + ' "' + (t.name || 'unnamed') +
                        '" (this install allocates ' + (t.base ? t.base + '–' + (t.ceiling - 1) : 'nothing yet') + ')';
                }).join('; ') + (stranded.length > 6 ? ' …' : '') +
                ' — Forge → Id ranges lists them and can migrate the range.');
        }
        return out;
    }

    /**
     * True when the library file is present but did not come back as usable JSON.
     *
     * store.read swallows a parse failure and returns the fallback, so a
     * truncated file — a crash mid-write is enough — is indistinguishable from
     * "no library yet". That distinction matters more here than anywhere else
     * in the mod: an empty library plus a save full of custom ids is exactly
     * the shape scrub() reads as "delete all of this". Refusing to scrub is the
     * only safe answer, and the player gets told why.
     */
    F.unreadable = false;

    F.load = function () {
        var raw = $.safe(function () { return $.store.read(FILE, null); }, 'forge read', null);
        F.unreadable = (raw === null || typeof raw !== 'object') && $.store.exists(FILE);
        if (F.unreadable) {
            $.log('err', FILE + ' exists but could not be read as JSON — the Forge is running empty, ' +
                'and it will NOT remove forged items from any save you load. Fix or delete the file.');
        }
        rawSrc = (raw && typeof raw === 'object') ? raw : null;
        rawSeen = true;
        // Re-reading the file re-opens the base question: the bases that answer
        // it are the ones written in THIS file.
        lib = null; BASES = null; BASE_SOURCE = ''; baseDrift = [];
        return F.lib();
    };

    /**
     * The library, built on first use.
     *
     * It cannot be built at load time. This file runs while the plugin list is
     * being set up, which is before the database exists, and a library with no
     * recorded bases has nowhere to put its ids until then. So: a library that
     * records its own bases normalises immediately, on any engine, with no
     * database at all; one that does not waits, and until it does this returns
     * a provisional empty library that is deliberately NOT cached.
     */
    F.lib = function () {
        if (lib) return lib;
        if (!rawSeen) {
            $.safe(F.load, 'forge library load');
            if (lib) return lib;
        }
        var built = $.safe(function () { return normalise(rawSrc); }, 'forge normalise', null) || emptyLib();
        if (ensureBases()) lib = built;
        return built;
    };

    /**
     * What actually goes in the file.
     *
     * The resolved bases travel WITH the library. That is the whole of the
     * stability promise: the next launch reads where the ids start from here,
     * not from an array whose length may have changed since.
     *
     * `outOfRange` and `blocked` do NOT travel. They are answers about this
     * install's database, recomputed on every load, and freezing a local
     * verdict into a file that gets carried to another install is how the
     * verdict outlives the reason for it.
     */
    function fileShape() {
        var l = F.lib();
        var b = ensureBases();
        if (b) l._bases = $.clone(b);
        var out = { _schema: SCHEMA, _bases: l._bases || null, next: l.next, entries: {} };
        KIND_IDS.forEach(function (k) {
            out.entries[k] = (l.entries[k] || []).map(function (r) {
                return {
                    id: r.id, tombstone: !!r.tombstone,
                    created: r.created || 0, modified: r.modified || 0, data: r.data
                };
            });
        });
        return out;
    }

    F.save = function () {
        $.store.write(FILE, fileShape());
        return true;
    };

    F.records = function (kind) {
        return F.lib().entries[kind] ? F.lib().entries[kind].slice() : [];
    };

    /* "Live" means a row that is actually in the database right now: not
       retired, and not one of the two ways a record can fail to get there. */
    F.live = function (kind) {
        return F.records(kind).filter(function (r) {
            return !r.tombstone && !r.outOfRange && !r.blocked;
        });
    };

    /**
     * Records the library holds that are not in the database, and why.
     *
     * Two distinct states, because they need two different answers:
     *   outOfRange — the id is outside the window this install allocates, so it
     *                was never even attempted. Re-forge it, or migrate.
     *   blocked    — the id is inside the window, but the game itself now has a
     *                row there. Only a migration can help.
     */
    F.unplaced = function (kind) {
        return F.records(kind).filter(function (r) { return !!(r.outOfRange || r.blocked); });
    };
    F.stray = function (kind) {
        return F.records(kind).filter(function (r) { return !!r.outOfRange; });
    };

    F.record = function (kind, id) {
        var list = F.lib().entries[kind] || [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    };

    F.count = function () {
        var n = { live: 0, dead: 0, stranded: 0, blocked: 0 };
        KIND_IDS.forEach(function (k) {
            F.records(k).forEach(function (r) {
                if (r.outOfRange) n.stranded++;
                else if (r.blocked) n.blocked++;
                else if (r.tombstone) n.dead++;
                else n.live++;
            });
        });
        return n;
    };

    /* ------------------------------------------------------------------ ids
       Never below the resolved base, never below what the data array already
       occupies (so a patched game that grew its own data cannot be
       overwritten), and never an id this library has handed out before — which
       includes tombstones, and is the whole point of keeping them.
       --------------------------------------------------------------------- */
    F.nextId = function (kind) {
        var k = KINDS[kind];
        if (!k) return 0;
        var base = F.base(kind);
        if (!base) return 0;                          // no base yet: allocate nothing
        var ceiling = F.ceiling(kind);
        var id = Math.max(base, Math.floor(F.lib().next[kind]) || base);
        var arr = k.arr();
        if (arr && arr.length > id) id = arr.length;
        F.records(kind).forEach(function (r) { if (!r.outOfRange && r.id >= id) id = r.id + 1; });
        return id >= ceiling ? 0 : id;                // 0 = the range is spent
    };

    /**
     * Is this id one of ours?
     *
     * MEMBERSHIP IN THE LOADED LIBRARY, and nothing else.
     *
     * 1.x asked `id >= base`, which is a claim about a number rather than
     * about a row. On any game whose own arrays reach past the base — and the
     * base is only ever a guess about how far a game will grow — every stock
     * row above it answers yes, and the Forge cheerfully offers to edit and
     * delete content that belongs to the game. There is no threshold that is
     * safe here, because the question is not "is this id high" but "did we
     * make this".
     *
     * Membership alone is still not quite enough, and the difference is not
     * academic: a library whose base is now inside the game's own content has
     * records for ids the game owns. The database gets the last word — a row
     * that exists and is not one of ours means the id is not ours, whatever
     * the library says. A row that is absent is still ours; it simply has not
     * been written yet.
     */
    F.isCustom = function (kind, id) {
        var rec = F.record(kind, id);
        if (!rec || rec.outOfRange) return false;
        var arr = KINDS[kind] && KINDS[kind].arr();
        if (!arr) return true;                     // nothing to contradict the library
        var row = arr[id];
        return !row || !!row.gigahackForged;
    };

    /* ------------------------------------------------------------ injection */
    var injected = {};      // kind -> the array we last wrote into
    var baseChecked = false;
    var said = {};          // 'kind:id' -> already reported as blocked, this session

    /* The compat control key every database write is verified under. */
    var WRITE = 'forge.write';

    function metadata(obj) {
        // The engine only runs extractMetadata from DataManager.onLoad — the
        // same function on both engines — and it has long since fired by the
        // time anything gets forged. Without this, `obj.meta` is undefined,
        // and any plugin that reads a note tag expects `meta` on every row it
        // is handed. A forged row has to be a row like any other.
        //
        // extractMetadata is also how `note` becomes anything at all: a forged
        // note tag that is never parsed is a field the game cannot see.
        $.safe(function () {
            if (typeof DataManager !== 'undefined' && DataManager.extractMetadata) {
                DataManager.extractMetadata(obj);
            } else { obj.meta = {}; }
        }, 'extractMetadata', null);
        if (!obj.meta) obj.meta = {};
        return obj;
    }
    F.metadata = metadata;

    /**
     * Write one record into its $data array at its own id.
     *
     * Holes are filled with null rather than left as holes: `$data*[0]` is
     * already null in every RPG Maker project, so every loop over a $data*
     * array is written to survive a null — but a hole reads as `undefined`
     * through `for…of`, and some plugins iterate `$data*` that way.
     *
     * The write itself goes through $.compat.verify. Writing an index of a
     * global array looks like the one thing that cannot fail, and it is not:
     * a plugin that rebuilds a $data* array, or replaces it with a proxy, or
     * re-runs its own boot-time construction, leaves the row we wrote gone
     * with nothing thrown. Read it back and say so.
     */
    function put(kind, rec) {
        var arr = KINDS[kind].arr();
        if (!arr) return false;

        var base = F.base(kind), ceiling = F.ceiling(kind);
        if (!base) {
            $.log('err', 'forge: cannot place ' + KINDS[kind].label.toLowerCase() + ' ' + rec.id +
                ' — ' + F.baseWhy());
            return false;
        }
        rec.blocked = false;
        if (rec.id < base || rec.id >= ceiling) {
            // Not an error to be swallowed and not a record to be thrown away:
            // it is a record this install cannot place, and it stays marked as
            // such so the panel can list it and offer the migration.
            //
            // Said once per record, on the transition. inject() runs again on
            // every database reload, and a line per record per pass would bury
            // the one that matters.
            var already = !!rec.outOfRange;
            rec.outOfRange = true;
            if (!already) {
                $.log('warn', 'forge: ' + KINDS[kind].label.toLowerCase() + ' id ' + rec.id +
                    ' is outside the range this install allocates (' + base + '–' + (ceiling - 1) + '), so it ' +
                    'is NOT written into the database — that id belongs to the game here. Forge → Id ranges ' +
                    'can migrate the range, or re-forge the entry at a new id.');
            }
            return false;
        }
        rec.outOfRange = false;

        // Allocation checks the array length, but that was a different array on
        // a different launch. If the game shipped a patch that grew its own
        // data past this id, the slot now belongs to the game, and overwriting
        // it would silently replace a real item everywhere it is referenced.
        var sitting = arr[rec.id];
        if (sitting && !sitting.gigahackForged) {
            rec.blocked = true;
            if (!said[kind + ':' + rec.id]) {
                said[kind + ':' + rec.id] = true;
                $.log('err', 'forge: id ' + rec.id + ' now belongs to the game ("' + (sitting.name || '?') +
                    '") — refusing to overwrite it. The game has grown into this range since the id was ' +
                    'handed out; Forge → Id ranges can migrate it, or re-forge the entry at a new id.');
            }
            return false;
        }
        delete said[kind + ':' + rec.id];
        while (arr.length <= rec.id) arr.push(null);
        var obj = $.clone(rec.data);
        obj.id = rec.id;
        if (rec.tombstone) {
            // A tombstone still has to be a usable object: an old save may hold
            // the id in an inventory container or an equip slot, and every item
            // window in the engine reads `.name` and `.iconIndex` unguarded.
            obj.name = obj.name ? '(removed) ' + obj.name : '(removed)';
            obj.description = 'This entry was removed in the GigaHack Forge.';
            obj.price = 0;
            if (obj.effects) obj.effects = [];
            if (obj.traits) obj.traits = [];
            if (obj.params) obj.params = [0, 0, 0, 0, 0, 0, 0, 0];
            obj.gigahackTombstone = true;
        }
        obj.gigahackForged = true;
        metadata(obj);

        var r = verify(WRITE, function () {
            arr[rec.id] = obj;
        }, function () {
            var live = arr[rec.id];
            return live === obj ? 'the forged row'
                : live ? 'a different row ("' + (live.name || 'unnamed') + '")'
                    : 'nothing';
        }, 'the forged row');
        return !!r.ok;
    }

    /** (Re)write every record into the live data arrays. */
    F.inject = function (quiet) {
        var n = 0, missing = [], blocked = 0;
        KIND_IDS.forEach(function (kind) {
            var arr = KINDS[kind].arr();
            if (!arr) { if (F.records(kind).length) missing.push(kind); return; }
            F.records(kind).forEach(function (rec) {
                if (put(kind, rec)) n++; else if (rec.outOfRange || rec.blocked) blocked++;
            });
            injected[kind] = arr;
        });
        if (missing.length) {
            $.log('warn', 'forge: no $data array yet for ' + missing.join(', ') + ' — will retry');
        }
        if (n && !quiet) $.log('ok', 'forge: injected ' + n + ' custom definition(s)' +
            (blocked ? ' · ' + blocked + ' left unplaced, outside this install\'s range' : ''));
        // The bases can only be compared once there is a database to compare
        // them against, which is true by the time anything is injected.
        if (!baseChecked && dbReady()) {
            baseChecked = true;
            $.safe(F.checkBases, 'forge base drift');
            // Report here rather than only from the boot hook: the hook may
            // not have installed, and the numbers are worth stating either way.
            $.safe(function () { if (F.report) F.report(); }, 'forge report');
        }
        return n;
    };

    /**
     * Cheap guard.
     *
     * The database is loaded once per launch — but a dev-tools plugin may
     * reload it at runtime, and a reloaded array is a DIFFERENT OBJECT with
     * our indices gone. So hold identity, not a reference: comparing costs
     * nothing, and re-reading every record does not happen unless it changed.
     */
    F.ensure = function () {
        var stale = false;
        KIND_IDS.forEach(function (kind) {
            var arr = KINDS[kind].arr();
            if (!arr) return;
            if (injected[kind] !== arr) { stale = true; return; }
            var recs = F.lib().entries[kind];
            for (var i = 0; i < recs.length; i++) {
                if (recs[i].outOfRange || recs[i].blocked) continue;   // never written, never stale
                var o = arr[recs[i].id];
                if (!o || !o.gigahackForged) { stale = true; return; }
            }
        });
        if (stale) F.inject(true);
        return stale;
    };

    /* --------------------------------------------------------------- scrub
       A save can outlive its definitions: the library deleted, hand-edited, or
       carried to another install. Every reference the save holds that resolves
       to nothing here is dropped on load, loudly. Without this the first item
       window the player opens reads `.name` off undefined and takes the game
       down.
       --------------------------------------------------------------------- */

    /**
     * An id this save holds that resolves to nothing.
     *
     * Deliberately NOT `isCustom`, which asks whether the library has a record
     * — and the case that matters most is the one where it does not: a library
     * deleted, or a save carried to an install that never had it. Two ways in,
     * and both are safe:
     *
     *   · the library HAS a record for the id, and the row is missing, so the
     *     definition never made it into the database; or
     *   · the row is missing AND the id sits at or above this kind's base — a
     *     window no shipped row can occupy, because the base is derived to sit
     *     above the array's own length.
     *
     * The conjunction is what makes the second clause safe where the 1.x
     * `id >= base` test was not: if the game later grows past the base, its
     * rows at those ids EXIST, so "the row is missing" is false and nothing
     * the game owns is ever touched.
     */
    function unknown(kind, id) {
        var arr = KINDS[kind] && KINDS[kind].arr();
        if (!arr) return false;                 // no database loaded — say nothing
        if (arr[id]) return false;              // it resolves; not our business
        if (F.record(kind, id)) return true;    // we have a definition and it is not in there
        var base = F.base(kind);
        return !!base && id >= base;
    }

    F.scrub = function () {
        var dropped = [];
        if (F.unreadable) {
            $.log('warn', 'forge: skipping the scrub — ' + FILE + ' could not be read, so "this id has no ' +
                'definition" would be a lie about every forged id in the save');
            return dropped;
        }
        $.safe(function () {
            if (typeof $gameParty === 'undefined' || !$gameParty) return;

            [['_items', 'item'], ['_weapons', 'weapon'], ['_armors', 'armor']].forEach(function (p) {
                var box = $gameParty[p[0]];
                if (!box) return;
                Object.keys(box).forEach(function (key) {
                    var id = Number(key);
                    if (unknown(p[1], id)) { delete box[key]; dropped.push(p[1] + ' ' + id + ' (inventory)'); }
                });
            });

            // A forged ACTOR is referenced by the party roster and by
            // $gameActors' own cache; a forged CLASS by whichever actor is
            // wearing it. Both take the game down the same way a missing item
            // does — Game_Actor.currentClass().params is read without a guard
            // on the first status window that draws.
            if ($gameParty._actors) {
                for (var ai = $gameParty._actors.length - 1; ai >= 0; ai--) {
                    var aid = $gameParty._actors[ai];
                    if (unknown('actor', aid)) {
                        $gameParty._actors.splice(ai, 1);
                        dropped.push('actor ' + aid + ' (party)');
                    }
                }
            }

            var actors = ($gameActors && $gameActors._data) || [];
            actors.forEach(function (actor, idx) {
                if (!actor) return;
                if (unknown('actor', idx)) {
                    actors[idx] = null;
                    dropped.push('actor ' + idx + ' (cache)');
                    return;
                }
                if (actor._classId && unknown('klass', actor._classId)) {
                    dropped.push('class ' + actor._classId + ' (' + $.safe(function () { return actor.name(); }, 'name', '?') + ')');
                    // Class 1 always exists in a shipped project; leaving the
                    // dangling id would be worse than an actor of the wrong
                    // class, which is at least playable.
                    actor._classId = 1;
                }
                if (actor._skills) {
                    for (var i = actor._skills.length - 1; i >= 0; i--) {
                        if (unknown('skill', actor._skills[i])) {
                            dropped.push('skill ' + actor._skills[i] + ' (' + $.safe(function () { return actor.name(); }, 'name', '?') + ')');
                            actor._skills.splice(i, 1);
                        }
                    }
                }
                if (actor._states) {
                    for (var j = actor._states.length - 1; j >= 0; j--) {
                        var sid = actor._states[j];
                        if (unknown('state', sid)) {
                            dropped.push('state ' + sid);
                            actor._states.splice(j, 1);
                            if (actor._stateTurns) delete actor._stateTurns[sid];
                        }
                    }
                }
                if (actor._equips) {
                    actor._equips.forEach(function (slot) {
                        if (!slot || !slot._itemId) return;
                        var kind = slot._dataClass === 'weapon' ? 'weapon' : slot._dataClass === 'armor' ? 'armor' : null;
                        if (kind && unknown(kind, slot._itemId)) {
                            dropped.push(kind + ' ' + slot._itemId + ' (equipped)');
                            slot._dataClass = '';
                            slot._itemId = 0;
                        }
                    });
                }
            });
        }, 'forge scrub');

        if (dropped.length) {
            $.log('warn', 'forge: dropped ' + dropped.length + ' reference(s) to definitions this install does not have — ' +
                dropped.slice(0, 6).join(', ') + (dropped.length > 6 ? ' …' : ''));
            if (U.toast) {
                U.toast({
                    title: 'FORGE',
                    msg: dropped.length + ' forged item(s) in this save have no definition here. They were removed so the game can run.',
                    severity: 'warn', ms: 6000
                });
            }
        }
        return dropped;
    };

    /* ---------------------------------------------------------------- CRUD */

    /** Validate a draft. Returns an array of human-readable problems. */
    F.validate = function (kind, data) {
        var bad = [];
        if (!data || typeof data !== 'object') return ['no definition'];
        if (!String(data.name || '').trim()) bad.push('a name is required');
        if (String(data.name || '').length > 60) bad.push('name is longer than 60 characters');
        if (data.damage && String(data.damage.formula || '').trim() === '') bad.push('the damage formula cannot be empty (use 0)');
        if (kind === 'state') {
            if (data.minTurns > data.maxTurns) bad.push('minimum turns is above maximum turns');
        }
        return bad;
    };

    /**
     * Commit a draft. `id` null creates and allocates; otherwise the existing
     * record is replaced in place, keeping its id — that is the contract the
     * save file depends on.
     */
    F.commit = function (kind, data, id) {
        if (!KINDS[kind]) return null;
        if (!$.allowWrite(id == null ? 'Forging a new ' + kind : 'Updating a forged ' + kind)) return null;
        var bad = F.validate(kind, data);
        if (bad.length) {
            U.toast({ title: 'NOT FORGED', msg: bad[0], severity: 'err' });
            return null;
        }
        if (!KINDS[kind].arr()) {
            U.toast({ title: 'NOT FORGED', msg: 'the game database is not loaded yet', severity: 'err' });
            return null;
        }

        var now = Date.now();
        var rec = id == null ? null : F.record(kind, id);
        // "Save changes" against a record that has since gone — purged, or
        // dropped when a hand-edited library was reloaded — must not quietly
        // become "create a new one at a new id" while the button still says
        // save. That is how a save's reference ends up on a different thing.
        if (id != null && !rec) {
            U.toast({ title: 'NOT SAVED', msg: 'id ' + id + ' is no longer in the library — use "new" instead', severity: 'err' });
            return null;
        }
        var fresh = !rec;
        if (!rec) {
            var newId = F.nextId(kind);
            if (!newId) {
                U.toast({
                    title: 'NOT FORGED',
                    msg: F.base(kind)
                        ? 'the custom id range for ' + KINDS[kind].plural + ' (' + F.rangeText(kind) + ') is full'
                        : F.baseWhy(),
                    severity: 'err'
                });
                return null;
            }
            rec = { id: newId, tombstone: false, outOfRange: false, created: now, modified: now, data: null };
            F.lib().entries[kind].push(rec);
        }
        rec.tombstone = false;
        rec.modified = now;
        rec.data = repairShape(kind, $.clone(data));
        rec.data.id = rec.id;
        if (!put(kind, rec)) {
            if (fresh) F.lib().entries[kind].pop();
            U.toast({
                title: 'NOT FORGED',
                msg: rec.outOfRange
                    ? 'id ' + rec.id + ' is outside this install\'s range (' + F.rangeText(kind) + ')'
                    : degraded(WRITE)
                        ? 'the write did not stick — ' + degradedWhy(WRITE)
                        : 'that id could not be written — see the log',
                severity: 'err'
            });
            return null;
        }
        // Move the high-water mark before anything can remove this record.
        if (F.lib().next[kind] <= rec.id) F.lib().next[kind] = rec.id + 1;
        injected[kind] = KINDS[kind].arr();
        F.save();
        $.log('ok', 'forge: ' + (fresh ? 'created ' : 'updated ') + kind + ' #' + rec.id + ' "' + rec.data.name + '"');
        return rec;
    };

    /** Retire an entry: the id keeps resolving, to a harmless stub. */
    F.retire = function (kind, id) {
        var rec = F.record(kind, id);
        if (!rec) return false;
        if (!$.allowWrite('Removing a forged ' + kind)) return false;
        rec.tombstone = true;
        rec.modified = Date.now();
        put(kind, rec);
        F.save();
        $.log('warn', 'forge: retired ' + kind + ' #' + id + ' — the id still resolves, to a stub');
        return true;
    };

    F.restore = function (kind, id) {
        var rec = F.record(kind, id);
        if (!rec || !rec.tombstone) return false;
        if (!$.allowWrite('Restoring a forged ' + kind)) return false;
        rec.tombstone = false;
        rec.modified = Date.now();
        put(kind, rec);
        F.save();
        $.log('ok', 'forge: restored ' + kind + ' #' + id);
        return true;
    };

    /**
     * Really remove it — the record goes, and the data array slot is nulled.
     * The id is still never re-issued (nextId only ever moves forward past the
     * data array's length), but any save that holds it now has a dangling
     * reference, which scrub() will drop on load.
     */
    F.purge = function (kind, id) {
        var list = F.lib().entries[kind] || [];
        var i = -1;
        for (var n = 0; n < list.length; n++) if (list[n].id === id) { i = n; break; }
        if (i < 0) return false;
        if (!$.allowWrite('Purging a forged ' + kind)) return false;
        list.splice(i, 1);
        var arr = KINDS[kind].arr();
        if (arr && arr[id] && arr[id].gigahackForged) arr[id] = null;
        // The running game still holds the id — in an inventory container, a
        // skill list, an equip slot. Game_Party.items() maps ids straight
        // through $dataItems with no guard, so leaving them would put a null in
        // the middle of the party's item list for the rest of the session.
        // scrub() is the function for this; it just has to run now rather than
        // waiting for the next save load.
        F.scrub();
        F.save();
        $.log('warn', 'forge: purged ' + kind + ' #' + id + ' — the id is retired, not recycled');
        return true;
    };

    /**
     * Move a kind's records from the base recorded in the library to the one
     * this database computes now, keeping each record's offset.
     *
     * IDS CHANGE. That is the one thing the rest of this module exists to
     * avoid doing on its own, so it happens only when asked for, it is planned
     * in full before anything moves, and it says what moved. Every save that
     * still holds an old id has that reference dropped by scrub() the next
     * time it loads — which is the honest outcome, and better than a save
     * quietly resolving an old id to whatever the game now keeps there.
     */
    F.migrateBases = function (kinds) {
        if (!$.allowWrite('Migrating forged id ranges')) return null;
        var drift = F.checkBases();
        if (!drift.length) return { moved: [], refused: [], why: 'the recorded bases already match' };

        var wanted = {};
        (kinds && kinds.length ? kinds : drift.map(function (d) { return d.kind; }))
            .forEach(function (k) { wanted[k] = 1; });

        var moved = [], refused = [];
        drift.forEach(function (d) {
            if (!wanted[d.kind]) return;
            var kind = d.kind, arr = KINDS[kind].arr();
            if (!arr) { refused.push(KINDS[kind].plural + ': the database array is not loaded'); return; }

            var newBase = d.computed, ceiling = newBase + spanFor(newBase);
            var list = F.lib().entries[kind] || [];

            // Plan the whole kind first. A refusal halfway through would leave
            // some ids moved and some not, which is worse than not moving any.
            var plan = [], i, rec, to, sitting;
            for (i = 0; i < list.length; i++) {
                rec = list[i];
                to = newBase + (rec.id - d.recorded);
                if (to < newBase || to >= ceiling) {
                    refused.push(KINDS[kind].plural + ' ' + rec.id + ' → ' + to + ': outside the new range');
                    return;
                }
                sitting = arr[to];
                if (sitting && !sitting.gigahackForged) {
                    refused.push(KINDS[kind].plural + ' ' + rec.id + ' → ' + to + ': "' +
                        (sitting.name || 'a row the game owns') + '" already lives there');
                    return;
                }
                plan.push({ rec: rec, to: to });
            }

            $.safe(function () {
                // Clear the slots we own before writing the new ones, or a move
                // of one slot could null out the row it just wrote.
                plan.forEach(function (p) {
                    var old = arr[p.rec.id];
                    if (old && old.gigahackForged) arr[p.rec.id] = null;
                });
                plan.forEach(function (p) {
                    moved.push(KINDS[kind].label.toLowerCase() + ' ' + p.rec.id + ' → ' + p.to +
                        ' ("' + ((p.rec.data && p.rec.data.name) || 'unnamed') + '")');
                    p.rec.id = p.to;
                    if (p.rec.data) p.rec.data.id = p.to;
                    p.rec.outOfRange = false;
                    p.rec.blocked = false;
                });
                list.sort(function (a, b) { return a.id - b.id; });

                BASES[kind] = newBase;
                var mark = newBase;
                list.forEach(function (r) { if (r.id >= mark) mark = r.id + 1; });
                F.lib().next[kind] = Math.min(mark, ceiling);
            }, 'forge migrate ' + kind);
        });

        F.inject(true);
        F.save();
        F.scrub();
        baseChecked = false;
        F.checkBases();

        moved.forEach(function (m) { $.log('ok', 'forge: migrated ' + m); });
        refused.forEach(function (r) { $.log('warn', 'forge: did not migrate ' + r); });
        $.log(refused.length ? 'warn' : 'ok', 'forge: migrated ' + moved.length + ' id(s)' +
            (refused.length ? ', refused ' + refused.length : '') +
            '. Saves that hold the old ids lose those references when they load — the log above lists every move.');
        return { moved: moved, refused: refused, why: '' };
    };

    /** How many places currently reference this id. Shown before a purge. */
    F.usage = function (kind, id) {
        return $.safe(function () {
            var n = 0;
            if (typeof $gameParty === 'undefined' || !$gameParty) return 0;
            if (kind === 'item' || kind === 'weapon' || kind === 'armor') {
                var box = $gameParty['_' + KINDS[kind].plural];
                if (box && box[id]) n += box[id];
            }
            if (kind === 'actor' && $gameParty._actors && $gameParty._actors.indexOf(id) > -1) n++;
            var actors = ($gameActors && $gameActors._data) || [];
            actors.forEach(function (a) {
                if (!a) return;
                if (kind === 'klass' && a._classId === id) n++;
                if (kind === 'skill' && a._skills && a._skills.indexOf(id) > -1) n++;
                if (kind === 'state' && a._states && a._states.indexOf(id) > -1) n++;
                if ((kind === 'weapon' || kind === 'armor') && a._equips) {
                    a._equips.forEach(function (s) {
                        if (s && s._itemId === id && s._dataClass === kind) n++;
                    });
                }
            });
            return n;
        }, 'forge usage', 0);
    };

    /* ---------------------------------------------------------- applying it */

    /**
     * The live row for a forged id — ours, or nothing.
     *
     * The ownership check is not decoration. An id can resolve to a row that
     * belongs to the game: a recorded base sits where the game has since grown
     * into, `put()` refuses to overwrite it, and the id now points at real
     * content. Returning that row here would hand the game's own item to the
     * party under the forged entry's name, and every "try it out" button in
     * the panel would light up for it.
     */
    F.object = function (kind, id) {
        var arr = KINDS[kind] && KINDS[kind].arr();
        var row = arr ? arr[id] : null;
        return (row && row.gigahackForged) ? row : null;
    };

    /**
     * Hand a forged item to the party. Goes through the inventory module so
     * the engine's own bookkeeping runs — and, importantly, passes the object that
     * actually lives in the data array: DataManager.isItem() is an identity
     * test — an identity search of $dataItems on either engine — so a copy of
     * the row would land nowhere.
     */
    F.give = function (kind, id, n) {
        var obj = F.object(kind, id);
        if (!obj) return false;
        if (typeof $gameParty === 'undefined' || !$gameParty) {
            U.toast({ title: 'NO PARTY', msg: 'start or load a game first', severity: 'warn' });
            return false;
        }
        if ($.inv && $.inv.give) return $.inv.give(obj, n == null ? 1 : n);
        if (!$.allowWrite('Giving ' + obj.name)) return false;
        $gameParty.gainItem(obj, n == null ? 1 : n, false);
        return true;
    };

    /** Teach a forged skill. Routed through the party module so the undo
        stack and the read-only gate behave the same as everywhere else. */
    F.teach = function (actor, skillId, learn) {
        if (!actor) return false;
        if (!F.object('skill', skillId)) return false;
        if ($.party && $.party.setSkill) return $.party.setSkill(actor, skillId, learn !== false);
        return $.safe(function () {
            if (!$.allowWrite('Teaching a forged skill')) return false;
            if (learn === false) actor.forgetSkill(skillId); else actor.learnSkill(skillId);
            return true;
        }, 'forge teach', false);
    };

    /** Apply or lift a forged state on one actor. */
    F.afflict = function (actor, stateId, on) {
        if (!actor) return false;
        if (!F.object('state', stateId)) return false;
        if ($.party && $.party.addState) {
            return on === false ? $.party.removeState(actor, stateId) : $.party.addState(actor, stateId);
        }
        return $.safe(function () {
            if (!$.allowWrite('Applying a forged state')) return false;
            if (on === false) actor.removeState(stateId); else actor.addState(stateId);
            return true;
        }, 'forge state', false);
    };

    /* ------------------------------------------------------------ transport */
    F.exportJson = function () {
        return JSON.stringify(fileShape(), null, 2);
    };

    /**
     * Merge a library from text. Ids are honoured, not re-allocated: an import
     * is how you move forged content between installs, and re-numbering it
     * would break every save that referenced the original ids.
     */
    F.importJson = function (text) {
        var parsed = $.safe(function () { return JSON.parse(text); }, 'forge import', null);
        if (!parsed) { U.toast({ title: 'IMPORT FAILED', msg: 'that is not valid JSON', severity: 'err' }); return 0; }
        if (!$.allowWrite('Importing forged definitions')) return 0;
        // normalise() reports what it dropped and what it could not place, and
        // it judges the incoming ids against THIS install's ranges — which is
        // the whole question an import raises. Snapshot the verdict before the
        // next load overwrites it.
        var incoming = normalise(parsed);
        var stranded = F.stranded.slice(), threwOut = F.dropped.slice();
        var added = 0, replaced = 0, collisions = [];
        KIND_IDS.forEach(function (kind) {
            incoming.entries[kind].forEach(function (rec) {
                var existing = F.record(kind, rec.id);
                if (existing) {
                    // Honouring the incoming id is the point of an import, but
                    // a collision means a save somewhere already means
                    // something else by this id. Name both, loudly.
                    if (existing.data.name !== rec.data.name) {
                        collisions.push(kind + ' ' + rec.id + ': "' + existing.data.name + '" → "' + rec.data.name + '"');
                    }
                    existing.data = rec.data;
                    existing.tombstone = rec.tombstone;
                    existing.outOfRange = rec.outOfRange;
                    existing.modified = Date.now();
                    replaced++;
                } else {
                    F.lib().entries[kind].push(rec);
                    added++;
                }
                if (!rec.outOfRange && F.lib().next[kind] <= rec.id) F.lib().next[kind] = rec.id + 1;
            });
            F.lib().entries[kind].sort(function (a, b) { return a.id - b.id; });
        });
        collisions.forEach(function (c) { $.log('warn', 'forge: import replaced ' + c); });
        F.inject(true);
        F.save();
        $.log('ok', 'forge: imported ' + added + ' new and ' + replaced + ' replaced definition(s)' +
            (stranded.length ? ' · ' + stranded.length + ' of them hold ids this install cannot place' : '') +
            (threwOut.length ? ' · ' + threwOut.length + ' were unusable' : ''));
        var notes = [];
        if (collisions.length) notes.push(collisions.length + ' now mean something different');
        if (stranded.length) notes.push(stranded.length + ' outside this install\'s ranges');
        if (threwOut.length) notes.push(threwOut.length + ' unusable');
        U.toast({
            title: 'IMPORTED',
            msg: added + ' new · ' + replaced + ' replaced' +
                (notes.length ? ' · ' + notes.join(' · ') + ' — see the log' : ''),
            severity: notes.length ? 'warn' : 'ok'
        });
        return added + replaced;
    };

    /* ---------------------------------------------------------------- hooks */

    /**
     * The boot report, once the bases are real.
     *
     * It cannot be logged at load time: this file runs before the database
     * exists, so at that point there is neither a library to count nor a base
     * to print. Anything that says otherwise at load time is printing a
     * placeholder, which is what 1.x did.
     */
    var reported = false;
    F.report = function () {
        if (reported) return;
        reported = true;
        var n = F.count();
        $.log('ok', 'forge ready — ' + n.live + ' live definition(s) across ' + KIND_IDS.length + ' kinds' +
            (n.dead ? ', ' + n.dead + ' retired' : '') +
            (n.stranded ? ', ' + n.stranded + ' unplaceable' : '') +
            '. Id bases (' + (BASE_SOURCE || 'unresolved') + '): ' +
            KIND_IDS.map(function (k) { return KINDS[k].plural + ' ' + (F.base(k) || '—'); }).join(', '));
    };

    // GigaHack is installed last, so this alias is the outermost one on the
    // chain and its body runs BEFORE every Scene_Boot.start the game
    // installed. That is deliberate, and it is why the hook is here rather
    // than anywhere later: some plugins process their note tags in
    // Scene_Boot.start, so a forged row has to already exist when it runs, or
    // it is the one row in the database they never see.
    $.install('Scene_Boot.start (forge inject)',
        typeof Scene_Boot !== 'undefined' ? Scene_Boot.prototype : null, 'start',
        function (original) {
            return function () {
                $.safe(function () { F.inject(); F.report(); }, 'forge boot inject');
                return original.apply(this, arguments);
            };
        },
        'Scene_Boot.prototype.start not found — forged rows are injected on first use instead, which is ' +
        'after any boot-time note-tag processing has already run');

    // A loaded save may reference ids this install cannot resolve.
    $.install('DataManager.extractSaveContents (forge scrub)',
        typeof DataManager !== 'undefined' ? DataManager : null, 'extractSaveContents',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                $.safe(function () { F.ensure(); F.scrub(); }, 'forge on load');
                return r;
            };
        },
        'DataManager.extractSaveContents not found — a save holding ids this install cannot resolve will ' +
        'not be cleaned up on load');

    $.safe(F.load, 'forge library load');

    /* =====================================================================
       PART 2 — VOCABULARY

       Every effect and trait code below exists, with the same meaning, on both
       engines — checked against both sets of constants, not remembered. Two
       things do not, and both are asked for rather than assumed:

         · action scopes 12, 13 and 14 are additions. The older engine's
           Game_Action resolves scopes 0–11 only, so an item forged with one of
           the three would target nobody there and do nothing, silently.
         · trait code 35 ("attack skill") is an addition. Where it is absent
           the normal attack is a fixed skill id and the trait is inert.

       Both are detected from the engine that is actually running, never from a
       version string: a plugin that adds either is as good as an engine that
       ships it, and a version check would call that a lie.
       ===================================================================== */

    /* Scopes 12–14 exist iff the engine resolves them. isForEveryone is the
       function that was added alongside them and is the honest probe for it. */
    var EXTENDED_SCOPES = $.safe(function () {
        return !!($.caps && $.caps._hasFn)
            ? $.caps._hasFn('Game_Action.prototype.isForEveryone')
            : (typeof Game_Action !== 'undefined' &&
               typeof Game_Action.prototype.isForEveryone === 'function');
    }, 'probe extended scopes', false);

    /* Trait 35 is honoured iff the constant that names it exists. */
    var TRAIT_ATTACK_SKILL = $.safe(function () {
        return typeof Game_BattlerBase !== 'undefined' &&
            Game_BattlerBase.TRAIT_ATTACK_SKILL != null;
    }, 'probe attack-skill trait', false);

    var SCOPES = [
        [0, 'none'], [1, 'one enemy'], [2, 'all enemies'], [3, 'random enemy ×1'],
        [4, 'random enemies ×2'], [5, 'random enemies ×3'], [6, 'random enemies ×4'],
        [7, 'one ally'], [8, 'all allies'], [9, 'one ally (dead)'], [10, 'all allies (dead)'],
        [11, 'the user']
    ].concat(EXTENDED_SCOPES ? [
        [12, 'one ally (dead or alive)'], [13, 'all allies (dead or alive)'],
        [14, 'everyone']
    ] : []);
    var OCCASIONS = [[0, 'always'], [1, 'battle only'], [2, 'menu only'], [3, 'never']];
    var HIT_TYPES = [[0, 'certain hit'], [1, 'physical'], [2, 'magical']];
    var DMG_TYPES = [[0, 'none'], [1, 'HP damage'], [2, 'MP damage'], [3, 'HP recover'],
        [4, 'MP recover'], [5, 'HP drain'], [6, 'MP drain']];
    var ITYPES = [[1, 'regular item'], [2, 'key item'], [3, 'hidden item A'], [4, 'hidden item B']];
    var RESTRICTIONS = [[0, 'none'], [1, 'attack an enemy'], [2, 'attack anyone'],
        [3, 'attack an ally'], [4, 'cannot move']];
    var REMOVAL = [[0, 'none'], [1, 'action end'], [2, 'turn end']];
    var MOTIONS = [[0, 'normal'], [1, 'abnormal'], [2, 'sleep'], [3, 'dead']];

    var XPARAMS = ['hit rate', 'evasion', 'critical', 'crit evade', 'magic evade', 'magic reflect',
        'counter', 'HP regen', 'MP regen', 'TP regen'];
    var SPARAMS = ['target rate', 'guard effect', 'recovery', 'pharmacology', 'MP cost rate',
        'TP charge rate', 'phys damage', 'magic damage', 'floor damage', 'exp rate'];
    var FLAGS = ['auto battle', 'guard', 'substitute', 'preserve TP'];
    var COLLAPSE = ['normal', 'boss', 'instant', 'not disappear'];
    var ABILITIES = ['encounter half', 'encounter none', 'cancel surprise', 'raise preemptive',
        'gold double', 'drop item double'];
    var SLOT_TYPES = ['normal', 'dual wield'];

    function paramNames() {
        return $.safe(function () { return $dataSystem.terms.params.slice(0, 8); }, 'params',
            ['Max HP', 'Max MP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK']) ||
            ['Max HP', 'Max MP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'];
    }
    function sysList(key, fallbackWord) {
        var list = $.safe(function () { return $dataSystem[key]; }, 'sys ' + key, null);
        if (!Array.isArray(list) || !list.length) return ['', fallbackWord + ' 1'];
        return list;
    }

    /**
     * The `data` field of an effect or trait is a different thing for every
     * code. Rather than one generic number box that means nothing, each code
     * declares what its dataId picks from and what its value means.
     *   pick: 'param'|'xparam'|'sparam'|'element'|'state'|'skill'|'stype'
     *         |'wtype'|'atype'|'etype'|'flag'|'collapse'|'ability'|'slot'
     *         |'commonEvent'|null
     *   v1 / value: { label, min, max, step, pct }
     */
    var EFFECTS = [
        { code: 11, label: 'recover HP', pick: null, v1: { label: '% max HP', pct: true, min: -100, max: 100 }, v2: { label: 'flat', min: -9999, max: 9999 } },
        { code: 12, label: 'recover MP', pick: null, v1: { label: '% max MP', pct: true, min: -100, max: 100 }, v2: { label: 'flat', min: -9999, max: 9999 } },
        { code: 13, label: 'gain TP', pick: null, v1: { label: 'TP', min: 0, max: 100 } },
        { code: 21, label: 'add state', pick: 'state', v1: { label: 'chance', pct: true, min: 0, max: 100, def: 1 } },
        { code: 22, label: 'remove state', pick: 'state', v1: { label: 'chance', pct: true, min: 0, max: 100, def: 1 } },
        { code: 31, label: 'add buff', pick: 'param', v1: { label: 'turns', min: 1, max: 99, def: 1 } },
        { code: 32, label: 'add debuff', pick: 'param', v1: { label: 'turns', min: 1, max: 99, def: 1 } },
        { code: 33, label: 'remove buff', pick: 'param' },
        { code: 34, label: 'remove debuff', pick: 'param' },
        { code: 41, label: 'special (escape)', pick: null },
        { code: 42, label: 'grow parameter', pick: 'param', v1: { label: 'amount', min: -999, max: 999 } },
        { code: 43, label: 'learn skill', pick: 'skill' },
        { code: 44, label: 'common event', pick: 'commonEvent' }
    ];

    var TRAITS = [
        { code: 21, label: 'parameter ×', pick: 'param', value: { label: 'rate', pct: true, min: 0, max: 1000, def: 1 } },
        { code: 22, label: 'ex-parameter +', pick: 'xparam', value: { label: 'plus', pct: true, min: -500, max: 500 } },
        { code: 23, label: 'sp-parameter ×', pick: 'sparam', value: { label: 'rate', pct: true, min: 0, max: 1000, def: 1 } },
        { code: 11, label: 'element rate', pick: 'element', value: { label: 'rate', pct: true, min: 0, max: 1000, def: 1 } },
        { code: 12, label: 'debuff rate', pick: 'param', value: { label: 'rate', pct: true, min: 0, max: 1000, def: 1 } },
        { code: 13, label: 'state rate', pick: 'state', value: { label: 'rate', pct: true, min: 0, max: 1000, def: 1 } },
        { code: 14, label: 'state immunity', pick: 'state' },
        { code: 31, label: 'attack element', pick: 'element' },
        { code: 32, label: 'attack state', pick: 'state', value: { label: 'chance', pct: true, min: 0, max: 100 } },
        { code: 33, label: 'attack speed +', pick: null, value: { label: 'plus', min: -1000, max: 1000 } },
        { code: 34, label: 'attack times +', pick: null, value: { label: 'plus', min: -9, max: 9 } },
        { code: 41, label: 'add skill type', pick: 'stype' },
        { code: 42, label: 'seal skill type', pick: 'stype' },
        { code: 43, label: 'add skill', pick: 'skill' },
        { code: 44, label: 'seal skill', pick: 'skill' },
        { code: 51, label: 'equip weapon type', pick: 'wtype' },
        { code: 52, label: 'equip armor type', pick: 'atype' },
        { code: 53, label: 'lock equip slot', pick: 'etype' },
        { code: 54, label: 'seal equip slot', pick: 'etype' },
        { code: 55, label: 'slot type', pick: 'slot' },
        { code: 61, label: 'extra action', pick: null, value: { label: 'chance', pct: true, min: 0, max: 100 } },
        { code: 62, label: 'special flag', pick: 'flag' },
        { code: 63, label: 'collapse type', pick: 'collapse' },
        { code: 64, label: 'party ability', pick: 'ability' }
    ];

    /* Offered only where the engine reads it. A control that writes a code
       nothing consumes is a control that does nothing, which is worse than a
       control that is not there. */
    if (TRAIT_ATTACK_SKILL) {
        TRAITS.splice(11, 0, { code: 35, label: 'attack skill', pick: 'skill' });
    }

    /**
     * The neutral value for a rule's number box.
     *
     * It cannot be derived from `pct`: a percentage is 100% when it means a
     * rate (parameter ×, element rate) and 0% when it means a bonus or a
     * chance (ex-parameter +, extra action). Defaulting every percentage to 1
     * gives a new "extra action" trait a guaranteed extra turn, every turn.
     * And it cannot be 0 either — a box with min 1 would show 1 while the
     * record held 0, and mmNumber clamps its display without firing onChange,
     * so the two would disagree silently. Each descriptor says what it means.
     */
    function neutral(desc) {
        if (!desc) return 0;
        if (desc.def != null) return desc.def;
        if (desc.min != null && desc.min > 0) return desc.pct ? desc.min / 100 : desc.min;
        return 0;
    }

    function bySpec(list, code) {
        for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
        return null;
    }

    /** Names for a `pick` kind, as [id, label] pairs, or null for free ids. */
    function pickList(pick) {
        switch (pick) {
            case 'param': return paramNames().map(function (n, i) { return [i, n]; });
            case 'xparam': return XPARAMS.map(function (n, i) { return [i, n]; });
            case 'sparam': return SPARAMS.map(function (n, i) { return [i, n]; });
            case 'flag': return FLAGS.map(function (n, i) { return [i, n]; });
            case 'collapse': return COLLAPSE.map(function (n, i) { return [i, n]; });
            case 'ability': return ABILITIES.map(function (n, i) { return [i, n]; });
            case 'slot': return SLOT_TYPES.map(function (n, i) { return [i, n]; });
            case 'element': return sysList('elements', 'element').map(function (n, i) { return [i, n || '(none)']; });
            case 'etype': return sysList('equipTypes', 'slot').map(function (n, i) { return [i, n || '(none)']; });
            case 'wtype': return sysList('weaponTypes', 'weapon').map(function (n, i) { return [i, n || '(none)']; });
            case 'atype': return sysList('armorTypes', 'armor').map(function (n, i) { return [i, n || '(none)']; });
            case 'stype': return sysList('skillTypes', 'type').map(function (n, i) { return [i, n || '(none)']; });
            default: return null;      // state / skill / commonEvent — too many to list
        }
    }

    /** Display name for a free-form id. */
    function pickName(pick, id) {
        return $.safe(function () {
            if (pick === 'state') return id === 0 ? 'normal attack' : ($dataStates[id] || {}).name || '#' + id;
            if (pick === 'skill') return ($dataSkills[id] || {}).name || '#' + id;
            if (pick === 'commonEvent') return ($dataCommonEvents && $dataCommonEvents[id] ? $dataCommonEvents[id].name : '') || '#' + id;
            var list = pickList(pick);
            if (!list) return '#' + id;
            for (var i = 0; i < list.length; i++) if (list[i][0] === id) return list[i][1];
            return '#' + id;
        }, 'pickName', '#' + id);
    }

    function pickMax(pick) {
        return $.safe(function () {
            if (pick === 'state') return $dataStates.length - 1;
            if (pick === 'skill') return $dataSkills.length - 1;
            // 0, not a number read off some game's data files: with no
            // $dataCommonEvents there is no id that can be picked, and a
            // non-zero ceiling would offer ids that resolve to nothing.
            if (pick === 'commonEvent') return $dataCommonEvents ? $dataCommonEvents.length - 1 : 0;
            return 9999;
        }, 'pickMax', 9999);
    }

    /** One-line human reading of an effect or a trait, used by the preview. */
    F.describeEffect = function (e) {
        var spec = bySpec(EFFECTS, e.code);
        if (!spec) return 'effect ' + e.code;
        var out = spec.label;
        if (spec.pick) out += ' · ' + pickName(spec.pick, e.dataId);
        if (spec.v1) out += ' · ' + (spec.v1.pct ? Math.round(e.value1 * 100) + '%' : e.value1);
        if (spec.v2 && e.value2) out += ' + ' + e.value2;
        return out;
    };

    F.describeTrait = function (t) {
        var spec = bySpec(TRAITS, t.code);
        if (!spec) return 'trait ' + t.code;
        var out = spec.label;
        if (spec.pick) out += ' · ' + pickName(spec.pick, t.dataId);
        if (spec.value) out += ' · ' + (spec.value.pct ? Math.round(t.value * 100) + '%' : t.value);
        return out;
    };

    /* =====================================================================
       PART 3 — TAB
       ===================================================================== */

    // Drafts live at module scope, not inside build(), so switching tabs and
    // coming back does not throw away half-typed work. `id` null means "this
    // will be a new entry"; a number means "editing that record in place".
    var drafts = {};
    var subKind = { Forge: 'item' };
    var repaint = function () { };      // rebound on every build

    function draft(kind) {
        if (!drafts[kind]) drafts[kind] = { id: null, data: blank(kind) };
        return drafts[kind];
    }
    F.draft = draft;

    function getPath(o, path) {
        var parts = path.split('.'), node = o;
        for (var i = 0; i < parts.length; i++) {
            if (node === null || node === undefined) return undefined;
            node = node[parts[i]];
        }
        return node;
    }
    function setPath(o, path, v) {
        var parts = path.split('.'), node = o;
        for (var i = 0; i < parts.length - 1; i++) {
            if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
            node = node[parts[i]];
        }
        node[parts[parts.length - 1]] = v;
    }

    /* ------------------------------------------------------------ field rows
       The draft is GigaHack's own scratch space, not game state, so editing it
       is never gated — the read-only gate belongs on the commit, which is
       where something actually reaches the game. Marking these controls would
       dim half the tab and misrepresent what read-only mode does.
       --------------------------------------------------------------------- */
    function rText(d, path, label, opts) {
        opts = opts || {};
        return W.row(label, W.text({
            value: String(getPath(d.data, path) == null ? '' : getPath(d.data, path)),
            width: opts.width || '154px', mono: opts.mono, placeholder: opts.placeholder,
            onInput: function (v) { setPath(d.data, path, v); repaint(); }
        }), { tip: opts.tip });
    }

    function rNum(d, path, label, opts) {
        opts = opts || {};
        return W.row(label, W.number({
            value: Number(getPath(d.data, path)) || 0,
            min: opts.min == null ? 0 : opts.min, max: opts.max == null ? 9999 : opts.max,
            step: opts.step || 1, wide: opts.wide !== false, _ungated: true,
            onChange: function (v) { setPath(d.data, path, v); repaint(); }
        }), { tip: opts.tip, sub: opts.sub });
    }

    function rBool(d, path, label, opts) {
        opts = opts || {};
        return W.toggleRow(label, {
            value: !!getPath(d.data, path), keybind: false, _ungated: true, tip: opts.tip,
            onChange: function (v) { setPath(d.data, path, v); repaint(); }
        });
    }

    function rEnum(d, path, label, table, opts) {
        opts = opts || {};
        var cur = getPath(d.data, path);
        var known = false;
        table.forEach(function (p) { if (p[0] === cur) known = true; });

        // A draft can hold a value this engine's table does not list — an
        // import from a game running the other engine is enough, and an action
        // scope is the case that actually happens. Showing the first entry
        // instead would leave the box saying one thing while the record held
        // another, silently, which is the failure mode the number controls in
        // this file already go out of their way to avoid. Name it instead, and
        // let the user pick something this engine can act on.
        var rows = table;
        if (!known && cur != null) {
            rows = table.concat([[cur, '#' + cur + ' — not supported here']]);
        }
        var labels = rows.map(function (p) { return p[1]; });
        var curLabel = labels[0];
        rows.forEach(function (p) { if (p[0] === cur) curLabel = p[1]; });

        return W.row(label, W.dropdown({
            options: labels, value: curLabel, width: opts.width || '134px', _ungated: true,
            onChange: function (v) {
                rows.forEach(function (p) { if (p[1] === v) setPath(d.data, path, p[0]); });
                if (opts.rebuild) U.rerender(); else repaint();
            }
        }), { tip: opts.tip });
    }

    /* --------------------------------------------------------- icon picker */
    /**
     * How many icons this game's IconSet actually holds.
     *
     * Measured, never assumed: sheet sizes differ between the two engines'
     * stock projects and again in any game that extends one, and the icon
     * source size differs too — which is why it is asked of $.eng rather than
     * of ImageManager, whose iconWidth/iconHeight exist on only one engine.
     *
     * WHAT IS CACHED HERE IS THE COUNT, NEVER THE BITMAP. Some games clear
     * ImageManager on every map transfer, and clearing it destroys the base
     * texture behind any Bitmap still being held: the object survives, the
     * pixels do not, and reading width or height off it later yields zero. So
     * the Bitmap is re-fetched from ImageManager on every attempt and dropped
     * again as soon as the two numbers are out of it — the same shape the
     * design system uses for the icon sheet itself, which caches the finished
     * CSS rule and never the Bitmap.
     */
    var FALLBACK_ICONS = 256;   // enough rows to draw before the sheet decodes
    var iconTotal = 0;          // the measured count — a number, never a Bitmap

    function iconCount() {
        if (iconTotal) return iconTotal;
        var n = $.safe(function () {
            if (typeof ImageManager === 'undefined' || !ImageManager.loadSystem) return 0;
            var bmp = ImageManager.loadSystem('IconSet');
            if (!bmp || !bmp.width || !bmp.height) return 0;
            var iw = $.eng.iconWidth(), ih = $.eng.iconHeight();
            if (!iw || !ih) return 0;
            return Math.floor(bmp.width / iw) * Math.floor(bmp.height / ih);
        }, 'iconCount', 0);
        // Falling back means the grid still works before the sheet has
        // decoded, rather than rendering nothing; the real number replaces it
        // as soon as there is one.
        if (n) iconTotal = n;
        return n || FALLBACK_ICONS;
    }
    F.iconCount = iconCount;

    /**
     * The icon sheet, windowed.
     *
     * A sheet of a few hundred icons costs a few milliseconds of DOM to build
     * and, far worse, ten times that in layout for the background tiles —
     * every time the tab is opened, on top of a game rendering at 60fps. It
     * reads as a freeze, because it is one. Only the rows in view are built,
     * with spacers above and below carrying the rest of the height, so the
     * cost is a screenful (about 128 cells) no matter how large the sheet is,
     * and a game that ships a much larger one is no slower here than one that
     * ships the stock sheet.
     */
    function iconPicker(d) {
        var CELL = 16, SPACE = 2, PITCH = CELL + SPACE, PAD = 3;
        // The sheet may not have decoded yet, in which case iconCount() falls
        // back to the stock 256. A draft already pointing at icon 400 must not
        // end up with a grid that cannot show it and a number box that clamps
        // the draft down to 255 on the first click of a stepper.
        var total = Math.max(iconCount(), Math.floor(d.data.iconIndex) + 1);

        var padTop = h('div'), padBot = h('div');
        var grid = h('div', { class: 'mm-forge-icons-grid' });
        var scroller = h('div', { class: 'mm-forge-icons' }, padTop, grid, padBot);
        var readout = h('span', { class: 'mm-forge-badge' });
        var jump = null;

        var cols = 16, rows = 1, from = -1, to = -1;

        function cell(index) {
            var b = h('button', { type: 'button', 'data-mm-i': String(index), tip: 'Icon|index ' + index },
                U.icon(index));
            if (index === d.data.iconIndex) b.className = 'mm-on';
            b.addEventListener('click', function () { select(index, false); });
            return b;
        }

        function mark() {
            Array.prototype.forEach.call(grid.children, function (b) {
                b.classList.toggle('mm-on', Number(b.getAttribute('data-mm-i')) === d.data.iconIndex);
            });
            readout.textContent = 'icon ' + d.data.iconIndex + ' of ' + total;
        }

        /** Recompute the column count from the width we actually have. */
        function measure() {
            var w = scroller.clientWidth || 0;
            var usable = Math.max(CELL, w - PAD * 2);
            // No '+ SPACE' here: with the spacing on the cells, the last cell in
            // a row carries its margin too, and a row that assumed otherwise
            // would wrap one cell early at every width.
            var fit = Math.floor(usable / PITCH);
            // Capped at 16 so the grid keeps the sheet's own row layout while
            // there is room for it, and reflows below that rather than clipping.
            cols = Math.max(1, Math.min(16, fit || 1));
            rows = Math.ceil(total / cols);
            // The cells wrap rather than sitting in grid tracks (see the
            // stylesheet: flex 'gap' is past the floor), so the row count is
            // set by the container's width. Each cell occupies one whole pitch
            // — its own 16px plus the 2px margin that replaced the gap,
            // including the last one in a row — so a container of exactly
            // cols × PITCH fits cols cells and no more.
            grid.style.width = (cols * PITCH) + 'px';
        }

        function paint(force) {
            var view = scroller.clientHeight || 132;
            var first = Math.max(0, Math.floor(scroller.scrollTop / PITCH) - 1);
            var last = Math.min(rows, first + Math.ceil(view / PITCH) + 2);
            // A scroll inside the rendered window rebuilds nothing.
            if (!force && first === from && last === to) return;
            from = first; to = last;
            clear(grid);
            for (var r = first; r < last; r++) {
                for (var c = 0; c < cols; c++) {
                    var index = r * cols + c;
                    if (index >= total) break;
                    grid.appendChild(cell(index));
                }
            }
            padTop.style.height = (first * PITCH) + 'px';
            padBot.style.height = Math.max(0, (rows - last) * PITCH) + 'px';
        }

        /**
         * Give the scroller its full height before anything is rendered into
         * it. Without this, the first scrollTo lands on a container whose
         * content is still zero-height, the browser clamps the offset to 0,
         * and the picker opens at icon 0 however far down the selection is.
         */
        function sizeSpacers() {
            padTop.style.height = '0px';
            padBot.style.height = (rows * PITCH) + 'px';
            from = to = -1;
        }

        function scrollTo(index) {
            var row = Math.floor(index / cols);
            var view = scroller.clientHeight || 132;
            var want = row * PITCH - Math.floor(view / 2) + CELL;
            scroller.scrollTop = Math.max(0, Math.min(rows * PITCH - view, want));
        }

        function select(index, move) {
            d.data.iconIndex = index;
            if (jump) jump.mm.set(index, true);
            if (move) { scrollTo(index); paint(); }
            mark();
            repaint();
        }

        scroller.addEventListener('scroll', function () { paint(); mark(); });

        jump = W.number({
            value: d.data.iconIndex, min: 0, max: Math.max(0, total - 1), wide: true, _ungated: true,
            onChange: function (v) { select(v, true); }
        });

        // Nothing is built until the scroller is in the document and has a
        // width to measure. That also means opening the tab costs nothing here
        // — the rows arrive on the next task, which is what killed the hitch.
        setTimeout(function () {
            if (!scroller.parentNode) return;
            // Measured twice on purpose. The first pass runs against a
            // scroller with no content and therefore no vertical scrollbar;
            // sizing the spacers makes it overflow, the 6px scrollbar appears
            // and takes real layout width, and a column count worked out
            // before that is one too many.
            measure();
            sizeSpacers();
            measure();
            sizeSpacers();
            scrollTo(d.data.iconIndex);
            paint(true);
            mark();
        }, 0);

        mark();

        return W.group('Icon', [
            scroller,
            W.row('Index', jump),
            h('div', { class: 'mm-inline', style: 'padding:2px' }, readout)
        ], { tag: 'IconSet' });
    }

    /* ------------------------------------------------------- effect / trait */
    function dataControl(spec, row, key) {
        if (!spec.pick) return null;
        var list = pickList(spec.pick);
        if (list) {
            var labels = list.map(function (p) { return p[1]; });
            var cur = labels[0];
            list.forEach(function (p) { if (p[0] === row[key]) cur = p[1]; });
            return W.dropdown({
                options: labels, value: cur, width: '112px', _ungated: true,
                onChange: function (v) {
                    list.forEach(function (p) { if (p[1] === v) row[key] = p[0]; });
                    repaint();
                }
            });
        }
        // Free id (state / skill / common event): a number box plus the name it
        // resolves to. These three lists are as long as the game makes them,
        // and a dropdown of a thousand entries is not a control.
        var name = h('span', { class: 'mm-sub mm-mono', style: 'flex:1 1 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' });
        function paintName() { name.textContent = pickName(spec.pick, row[key]); }
        paintName();
        var num = W.number({
            value: row[key] || 0, min: 0, max: pickMax(spec.pick), wide: true, _ungated: true,
            onChange: function (v) { row[key] = v; paintName(); repaint(); }
        });
        return [num, name];
    }

    function valueControl(desc, row, key) {
        if (!desc) return null;
        var min = desc.min == null ? 0 : desc.min, max = desc.max == null ? 999 : desc.max;
        var shown = desc.pct ? Math.round((row[key] || 0) * 100) : (row[key] || 0);
        // mmNumber clamps what it displays and does NOT fire onChange for it,
        // so an out-of-range value — from an import, or from a code switch —
        // would leave the box showing one number and the record holding
        // another. Clamp here instead, and write it back.
        var fixed = $.clamp(shown, min, max);
        if (fixed !== shown) row[key] = desc.pct ? fixed / 100 : fixed;
        return W.number({
            value: fixed, min: min, max: max,
            step: desc.step || 1, wide: true, _ungated: true,
            tip: desc.label,
            onChange: function (v) { row[key] = desc.pct ? v / 100 : v; repaint(); }
        });
    }

    /**
     * One editable list of effects (items and skills) or traits (weapons,
     * armors and states). Both are `{code, dataId, value…}` rows against a
     * fixed vocabulary, so one builder covers them.
     */
    function ruleList(d, which) {
        var isFx = which === 'effects';
        var specs = isFx ? EFFECTS : TRAITS;
        var listNode = h('div', { class: 'mm-forge-fx' });

        function rows() { return d.data[which] || (d.data[which] = []); }

        function paint() {
            clear(listNode);
            var list = rows();
            if (!list.length) {
                listNode.appendChild(h('div', { class: 'mm-empty', text: isFx ? 'no effects' : 'no traits' }));
            }
            list.forEach(function (row, i) {
                var spec = bySpec(specs, row.code) || specs[0];
                var labels = specs.map(function (s) { return s.label; });
                var kids = [
                    W.dropdown({
                        options: labels, value: spec.label, _ungated: true,
                        onChange: function (v) {
                            specs.forEach(function (s) {
                                if (s.label !== v) return;
                                row.code = s.code;
                                row.dataId = 0;
                                if (isFx) { row.value1 = neutral(s.v1); row.value2 = neutral(s.v2); }
                                else { row.value = neutral(s.value); }
                            });
                            paint(); repaint();
                        }
                    })
                ];
                var dc = dataControl(spec, row, 'dataId');
                if (dc) kids = kids.concat(dc);
                if (isFx) {
                    var v1 = valueControl(spec.v1, row, 'value1'); if (v1) kids.push(v1);
                    var v2 = valueControl(spec.v2, row, 'value2'); if (v2) kids.push(v2);
                } else {
                    var v = valueControl(spec.value, row, 'value'); if (v) kids.push(v);
                }
                kids.push(W.button({
                    label: '−', mini: true, _ungated: true,
                    tip: 'Remove|drop this ' + (isFx ? 'effect' : 'trait'),
                    onClick: function () { rows().splice(i, 1); paint(); repaint(); }
                }));
                listNode.appendChild(h('div', { class: 'mm-forge-fxrow' }, kids));
            });
            if (group && group.mm) group.mm.tag(list.length + ' rows');
        }
        var group = null;
        paint();

        group = W.group(isFx ? 'Effects' : 'Traits', [
            listNode,
            h('div', { class: 'mm-inline', style: 'padding:3px 2px' },
                W.button({
                    label: '+ add ' + (isFx ? 'effect' : 'trait'), wide: true, _ungated: true,
                    onClick: function () {
                        var s = specs[0];
                        rows().push(isFx
                            ? { code: s.code, dataId: 0, value1: neutral(s.v1), value2: neutral(s.v2) }
                            : { code: s.code, dataId: 0, value: neutral(s.value) });
                        paint(); repaint();
                    }
                }))
        ], { tag: rows().length + ' rows' });
        return group;
    }

    /* ------------------------------------------------------------- preview */
    function previewCard(d, kind) {
        var card = h('div', { class: 'mm-forge-card' });

        function line(text) { return h('div', { class: 'mm-sub mm-mono' }, text); }

        function paint() {
            clear(card);
            var data = d.data;
            var next = F.nextId(kind);
            var idText = d.id != null ? 'id ' + d.id
                : next ? 'new · id ' + next
                    : F.base(kind) ? 'new · no id left in ' + F.rangeText(kind)
                        : 'new · no id range yet';

            add(card, [
                h('div', { class: 'mm-inline' },
                    U.icon(data.iconIndex),
                    h('div', { style: 'flex:1 1 0;min-width:0' },
                        h('div', {
                            class: 'mm-hi',
                            style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                            text: data.name || '(unnamed)'
                        }),
                        h('div', { class: 'mm-forge-badge', text: KINDS[kind].label.toLowerCase() + ' · ' + idText })))
            ]);

            if (kind !== 'state') {
                card.appendChild(h('div', { class: 'mm-forge-desc', text: data.description || '' }));
            }

            card.appendChild(h('div', { class: 'mm-sep' }));

            if (kind === 'item') {
                card.appendChild(line(labelOf(ITYPES, data.itypeId) + ' · ' + data.price + 'g · ' +
                    (data.consumable ? 'consumable' : 'reusable')));
                card.appendChild(line(labelOf(SCOPES, data.scope) + ' · ' + labelOf(OCCASIONS, data.occasion)));
            } else if (kind === 'weapon' || kind === 'armor') {
                var names = paramNames();
                var bumped = [];
                (data.params || []).forEach(function (v, i) { if (v) bumped.push(names[i] + ' ' + (v > 0 ? '+' : '') + v); });
                card.appendChild(line(data.price + 'g · ' + pickName('etype', data.etypeId) + ' · ' +
                    (kind === 'weapon' ? pickName('wtype', data.wtypeId) : pickName('atype', data.atypeId))));
                card.appendChild(line(bumped.length ? bumped.join(' · ') : 'no parameter changes'));
            } else if (kind === 'skill') {
                card.appendChild(line(pickName('stype', data.stypeId) + ' · ' + data.mpCost + ' MP · ' + data.tpCost + ' TP'));
                card.appendChild(line(labelOf(SCOPES, data.scope) + ' · ' + labelOf(OCCASIONS, data.occasion)));
            } else if (kind === 'state') {
                card.appendChild(line(labelOf(RESTRICTIONS, data.restriction) + ' · priority ' + data.priority));
                card.appendChild(line(labelOf(REMOVAL, data.autoRemovalTiming) +
                    (data.autoRemovalTiming ? ' · ' + data.minTurns + '–' + data.maxTurns + ' turns' : '')));
            }

            var rules = kind === 'item' || kind === 'skill' ? data.effects : data.traits;
            var describe = kind === 'item' || kind === 'skill' ? F.describeEffect : F.describeTrait;
            if (rules && rules.length) {
                card.appendChild(h('div', { class: 'mm-sep' }));
                rules.forEach(function (r) {
                    card.appendChild(h('div', { class: 'mm-legend' },
                        h('i', { style: 'background:var(--mm-accent);border:0' }),
                        h('span', { class: 'mm-mono', text: describe(r) })));
                });
            }

            if (data.damage && data.damage.type) {
                card.appendChild(h('div', { class: 'mm-sep' }));
                card.appendChild(line(labelOf(DMG_TYPES, data.damage.type) + ' = ' + data.damage.formula +
                    ' ±' + data.damage.variance + '%'));
            }

            var bad = F.validate(kind, data);
            if (bad.length) {
                card.appendChild(h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding-top:2px',
                    text: bad.join(' · ')
                }));
            }
        }

        paint();
        return { node: card, paint: paint };
    }

    function labelOf(table, v) {
        for (var i = 0; i < table.length; i++) if (table[i][0] === v) return table[i][1];
        return String(v);
    }

    /* ------------------------------------------------------------- library */
    function libraryGroup(kind, load) {
        var showDead = false;

        function rows() {
            return F.records(kind).filter(function (r) { return showDead || !r.tombstone; });
        }

        var table = W.table({
            rowH: 17,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'id', w: '0 0 46px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: '', w: '0 0 96px' }
            ],
            empty: 'nothing forged yet',
            render: function (r) {
                // The row the game actually has, not the record — they differ
                // for exactly the entries worth noticing.
                var obj = F.object(kind, r.id);
                var shown = (obj && obj.gigahackForged) ? obj : r.data;
                return [
                    U.icon(shown.iconIndex),
                    String(r.id),
                    h('span', {
                        class: (r.outOfRange || r.blocked || r.tombstone) ? 'mm-forge-dead' : '',
                        text: (shown.name || '(unnamed)') +
                            (r.outOfRange ? '  — out of range' : r.blocked ? '  — id taken by the game' : '')
                    }),
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'edit', mini: true, _ungated: true,
                            onClick: function () { load(r); }
                        }),
                        r.tombstone
                            ? W.button({
                                label: 'restore', mini: true, mutates: true,
                                onClick: function () { if (F.restore(kind, r.id)) U.rerender(); }
                            })
                            : W.button({
                                label: 'remove', mini: true, mutates: true,
                                tip: 'Remove|The id still resolves, to a stub, so old saves still ' +
                                    'load.',
                                onClick: function () { if (F.retire(kind, r.id)) U.rerender(); }
                            }))
                ];
            },
            onRow: function (tr, r) {
                tr.setAttribute('data-mm-tip', (r.data.name || 'unnamed') + '|' +
                    (r.outOfRange
                        ? 'id ' + r.id + ' is outside the range this install allocates (' + F.rangeText(kind) +
                          '), so it is kept but never written into the database.'
                        : r.blocked
                            ? 'id ' + r.id + ' now holds one of the game\'s own rows, so this definition is ' +
                              'kept but not written — overwriting it would replace real content.'
                            : r.tombstone
                                ? 'retired — the id still resolves to a stub'
                                : 'forged ' + KINDS[kind].label.toLowerCase()));
            }
        });

        function refresh() { table.mm.paint(rows()); }
        refresh();

        var unplaced = F.unplaced(kind).length;
        var group = W.group('Library', [
            h('div', { class: 'mm-toolbar' },
                W.chip({
                    label: 'show retired', value: false,
                    onChange: function (v) { showDead = v; refresh(); }
                })),
            table,
            unplaced ? h('div', {
                class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                text: unplaced + ' of these are in the library but not in the database. Kept, ' +
                    'not discarded — Id ranges, below, says which and why.'
            }) : null
        ], { tag: F.live(kind).length + ' live' + (unplaced ? ' · ' + unplaced + ' unplaced' : '') });
        group.mm.refreshLibrary = refresh;
        return group;
    }

    /* -------------------------------------------------------------- output */

    /* ----------------------------------------------------- apply actions */

    /** Put a forged actor in the party. */
    F.recruit = function (id) {
        if (!F.object('actor', id)) return false;
        if (!$.allowWrite('recruit forged actor ' + id)) return false;
        return $.safe(function () {
            $gameParty.addActor(id);
            $.log('ok', 'forged actor ' + id + ' joined the party');
            return true;
        }, 'recruit', false);
    };

    /** Move an actor onto a forged class. */
    F.reclass = function (actor, classId) {
        if (!actor || !F.object('klass', classId)) return false;
        if (!$.party || !$.party.changeClass) return false;
        return $.party.changeClass(actor, classId, true);
    };

    /**
     * Start a battle with a forged troop.
     *
     * BattleManager.setup wants a troop the engine can find, so the definition
     * has to be injected first — which it is, or `forged` would be false and
     * the button disabled. Refused mid-battle: setup on top of a running one
     * leaves the previous troop's members in $gameTroop.
     */
    F.fight = function (id) {
        if (!F.object('troop', id)) return false;
        if ($.battle && $.battle.inBattle && $.battle.inBattle()) {
            U.toast({ title: 'ALREADY FIGHTING', msg: 'finish this battle first', severity: 'warn' });
            return false;
        }
        if ($.battle && $.battle.forceTroop) return $.battle.forceTroop(id);
        return false;
    };

    /**
     * Run a forged common event now.
     *
     * reserveCommonEvent is the engine's own path and it is picked up by
     * whichever interpreter is free, which is why this does not build one by
     * hand: a hand-built Game_Interpreter runs outside the map's own update
     * and its waits never tick.
     */
    F.runCommon = function (id) {
        if (!F.object('common', id)) return false;
        if (!$.allowWrite('run forged common event ' + id)) return false;
        return $.safe(function () {
            if (typeof $gameTemp === 'undefined' || !$gameTemp || !$gameTemp.reserveCommonEvent) return false;
            $gameTemp.reserveCommonEvent(id);
            $.log('ok', 'forged common event ' + id + ' queued');
            U.toast({ title: 'QUEUED', msg: 'runs on the next map frame', severity: 'ok', ms: 1600 });
            return true;
        }, 'run common event', false);
    };

    function outputGroup(kind, d, after) {
        var actors = $.safe(function () { return ($.party && $.party.members ? $.party.members() : []) || []; }, 'members', []) || [];
        var target = { actor: actors[0] || null };

        var kids = [];

        kids.push(degradeNote(WRITE));
        kids.push(h('div', { class: 'mm-inline', style: 'padding:2px' },
            degradeMark(W.button({
                label: d.id == null ? 'forge it' : 'save changes',
                variant: 'prime', wide: true, mutates: true,
                tip: d.id == null
                    ? 'Forge|Takes the next custom id and writes into the live database.'
                    : 'Save|Rewrites this id in place, so saves holding it stay valid.',
                onClick: function () {
                    var wasNew = d.id == null;
                    var rec = F.commit(kind, d.data, d.id);
                    if (!rec) return;
                    d.id = rec.id;
                    U.toast({
                        title: wasNew ? 'FORGED' : 'SAVED',
                        msg: rec.data.name + ' → $data' + KINDS[kind].plural.charAt(0).toUpperCase() +
                            KINDS[kind].plural.slice(1) + '[' + rec.id + ']',
                        severity: 'ok'
                    });
                    after();
                }
            }), WRITE),
            W.button({
                label: 'new', wide: true, _ungated: true,
                tip: 'New|Clears the editor. Nothing already forged is touched.',
                onClick: function () { drafts[kind] = { id: null, data: blank(kind) }; U.rerender(); }
            })));

        if (d.id != null) {
            kids.push(h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'duplicate as new', wide: true, _ungated: true,
                    onClick: function () {
                        var copy = $.clone(d.data);
                        copy.name = copy.name + ' copy';
                        drafts[kind] = { id: null, data: copy };
                        U.rerender();
                    }
                }),
                W.button({
                    label: 'revert', wide: true, _ungated: true,
                    tip: 'Revert|Discards unsaved edits and reloads from the library.',
                    onClick: function () {
                        var rec = F.record(kind, d.id);
                        if (rec) drafts[kind] = { id: rec.id, data: $.clone(rec.data) };
                        U.rerender();
                    }
                })));
        }

        // Try it out. Only meaningful once a definition actually exists in the
        // data array — before that there is nothing to hand over.
        var forged = d.id != null && !!F.object(kind, d.id);
        if (kind === 'item' || kind === 'weapon' || kind === 'armor') {
            kids.push(h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: '+1 to party', wide: true, mutates: true, disabled: !forged,
                    onClick: function () { if (F.give(kind, d.id, 1)) U.rerender(); }
                }),
                W.button({
                    label: '+10', wide: true, mutates: true, disabled: !forged,
                    onClick: function () { if (F.give(kind, d.id, 10)) U.rerender(); }
                })));
        } else if (kind === 'actor') {
            kids.push(W.button({
                label: 'add to the party', wide: true, mutates: true, disabled: !forged,
                onClick: function () { if (F.recruit(d.id)) U.rerender(); }
            }));
        } else if (kind === 'troop') {
            kids.push(W.button({
                label: 'fight it now', wide: true, mutates: true, disabled: !forged,
                onClick: function () { F.fight(d.id); }
            }));
        } else if (kind === 'common') {
            kids.push(W.button({
                label: 'run it now', wide: true, mutates: true, disabled: !forged,
                onClick: function () { F.runCommon(d.id); }
            }));
        } else if (kind === 'enemy') {
            kids.push(h('div', {
                class: 'mm-sub', style: 'padding:2px;white-space:normal',
                text: 'An enemy is fought through a troop. Switch Kind to "troop" and put this ' +
                    'id in a member.'
            }));
        } else if (!actors.length) {
            kids.push(h('div', {
                class: 'mm-sub', style: 'padding:2px;white-space:normal',
                text: 'Start or load a game to try this on somebody. Forging itself works without one.'
            }));
        } else {
            // Dropdown options are identified by their text, so two actors
            // with the same displayed name would collapse into one entry that
            // always targets the later of the two.
            var raw = actors.map(function (a) { return $.safe(function () { return a.name(); }, 'name', '?'); });
            var names = raw.map(function (n, i) {
                var dupe = raw.filter(function (m) { return m === n; }).length > 1;
                return dupe ? n + ' #' + $.safe(function () { return actors[i].actorId(); }, 'id', i) : n;
            });
            kids.push(W.row('Target', W.dropdown({
                options: names, value: names[0], width: '112px', _ungated: true,
                onChange: function (v) {
                    actors.forEach(function (a, i) { if (names[i] === v) target.actor = a; });
                }
            })));
            kids.push(h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: kind === 'klass' ? 'change class to it' : kind === 'skill' ? 'teach it' : 'apply it',
                    wide: true, mutates: true, disabled: !forged,
                    onClick: function () {
                        var ok = kind === 'klass'
                            ? F.reclass(target.actor, d.id)
                            : kind === 'skill'
                                ? F.teach(target.actor, d.id, true)
                                : F.afflict(target.actor, d.id, true);
                        if (ok) U.rerender();
                    }
                }),
                kind === 'klass' ? null : W.button({
                    label: kind === 'skill' ? 'forget' : 'lift', wide: true, mutates: true, disabled: !forged,
                    onClick: function () {
                        var ok = kind === 'skill'
                            ? F.teach(target.actor, d.id, false)
                            : F.afflict(target.actor, d.id, false);
                        if (ok) U.rerender();
                    }
                })));
        }

        if (d.id != null) {
            kids.push(h('div', { class: 'mm-sep' }));
            kids.push(W.button({
                label: 'purge id ' + d.id + ' completely', wide: true, variant: 'danger',
                confirmLabel: 'purge — saves may break?',
                tip: 'Purge|Frees the slot instead of leaving a stub. Saves holding this id lose ' +
                    'the reference.',
                onClick: function () {
                    var used = F.usage(kind, d.id);
                    if (F.purge(kind, d.id)) {
                        U.toast({
                            title: 'PURGED',
                            msg: used ? 'id ' + d.id + ' was referenced ' + used + '× — those references are now dangling' :
                                'id ' + d.id + ' was not referenced anywhere',
                            severity: used ? 'warn' : 'ok'
                        });
                        drafts[kind] = { id: null, data: blank(kind) };
                        U.rerender();
                    }
                }
            }));
        }

        return W.group('Output', kids, { tag: d.id == null ? 'new' : '#' + d.id });
    }

    /* ------------------------------------------------------- field groups */
    function descRows(d, lines) {
        // The editor's description box is two lines on both engines; the data
        // field is one string with a newline in it. Two inputs are honest
        // about that shape, and a text input cannot hold a newline anyway.
        var parts = String(d.data.description || '').split('\n');
        function set(i, v) {
            var l = String(d.data.description || '').split('\n');
            while (l.length < 2) l.push('');
            l[i] = v;
            // Trailing empties are dropped so an untouched second line does not
            // leave a stray newline — but anything past line 2 is kept, because
            // an imported description may legitimately have more lines than
            // the editor's own box can produce.
            while (l.length > 1 && l[l.length - 1] === '') l.pop();
            d.data.description = l.join('\n');
            repaint();
        }
        var out = [];
        for (var i = 0; i < (lines || 2); i++) (function (i) {
            out.push(W.row(i === 0 ? 'Description' : '', W.text({
                value: parts[i] || '', width: '154px',
                placeholder: i === 0 ? 'shown in the item window' : 'second line',
                onInput: function (v) { set(i, v); }
            })));
        })(i);
        return out;
    }

    function paramGroup(d) {
        var names = paramNames();
        return W.group('Parameters', names.map(function (n, i) {
            return rNum(d, 'params.' + i, n, { min: -9999, max: 9999, step: 1 });
        }), { tag: 'equipped bonus', collapsed: true });
    }

    function damageGroup(d) {
        return W.group('Damage', [
            rEnum(d, 'damage.type', 'Type', DMG_TYPES),
            rEnum(d, 'damage.elementId', 'Element',
                [[-1, 'normal attack'], [0, 'none']].concat(
                    sysList('elements', 'element').map(function (n, i) { return [i, n || '(none)']; }).slice(1))),
            rText(d, 'damage.formula', 'Formula', { mono: true, tip: 'Formula|Evaluated by the engine with a = user, b = target, v = $gameVariables.' }),
            rNum(d, 'damage.variance', 'Variance %', { min: 0, max: 100 }),
            rBool(d, 'damage.critical', 'Can crit')
        ], { tag: 'Game_Action', collapsed: true });
    }

    function noteGroup(d) {
        return W.group('Note', [
            W.row('Note', W.text({
                value: d.data.note || '', mono: true, width: '154px',
                placeholder: '<tag:value>',
                onInput: function (v) { d.data.note = v; repaint(); }
            })),
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Game plugins that read notes at boot only pick this up from the next launch.')
        ], { tag: 'meta', collapsed: true });
    }

    /* --------------------------------------------------------- field groups */

    var TRIGGERS = [[0, 'none'], [1, 'autorun'], [2, 'parallel']];

    /**
     * The command palette for a forged common event.
     *
     * Not a full event editor — that is the RPG Maker editor's job and it is
     * enormous. These nine are the ones worth having as a cheat: each one is a
     * single command whose parameter shape is stable across MZ versions, and
     * together they cover "give me X", "set the world to Y" and "run whatever
     * I type". Anything more exotic is what the Script command is for.
     */
    var CMDS = [
        { code: 401, label: 'Show text', fields: [['text', 'str', 'Text']],
          build: function (v) { return [{ code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] }, { code: 401, indent: 0, parameters: [String(v.text || '')] }]; },
          describe: function (v) { return 'say "' + (v.text || '') + '"'; } },
        { code: 121, label: 'Set a switch', fields: [['id', 'num', 'Switch'], ['on', 'bool', 'On']],
          build: function (v) { return [{ code: 121, indent: 0, parameters: [v.id | 0, v.id | 0, v.on ? 0 : 1] }]; },
          describe: function (v) { return 'switch ' + (v.id | 0) + ' → ' + (v.on ? 'ON' : 'off'); } },
        { code: 122, label: 'Set a variable', fields: [['id', 'num', 'Variable'], ['value', 'num', 'Value']],
          build: function (v) { return [{ code: 122, indent: 0, parameters: [v.id | 0, v.id | 0, 0, 0, v.value | 0] }]; },
          describe: function (v) { return 'variable ' + (v.id | 0) + ' = ' + (v.value | 0); } },
        { code: 125, label: 'Change gold', fields: [['value', 'num', 'Amount']],
          build: function (v) { return [{ code: 125, indent: 0, parameters: [(v.value | 0) < 0 ? 1 : 0, 0, Math.abs(v.value | 0)] }]; },
          describe: function (v) { return ((v.value | 0) < 0 ? 'lose ' : 'gain ') + Math.abs(v.value | 0) + ' gold'; } },
        { code: 126, label: 'Change items', fields: [['id', 'num', 'Item id'], ['value', 'num', 'Amount']],
          build: function (v) { return [{ code: 126, indent: 0, parameters: [v.id | 0, (v.value | 0) < 0 ? 1 : 0, 0, Math.abs(v.value | 0), false] }]; },
          describe: function (v) { return ((v.value | 0) < 0 ? 'take ' : 'give ') + Math.abs(v.value | 0) + ' × item ' + (v.id | 0); } },
        { code: 311, label: 'Change HP', fields: [['id', 'num', 'Actor id'], ['value', 'num', 'Amount']],
          build: function (v) { return [{ code: 311, indent: 0, parameters: [0, v.id | 0, (v.value | 0) < 0 ? 1 : 0, 0, Math.abs(v.value | 0), false] }]; },
          describe: function (v) { return 'actor ' + (v.id | 0) + ' HP ' + ((v.value | 0) < 0 ? '−' : '+') + Math.abs(v.value | 0); } },
        { code: 201, label: 'Transfer player', fields: [['id', 'num', 'Map id'], ['x', 'num', 'X'], ['y', 'num', 'Y']],
          build: function (v) { return [{ code: 201, indent: 0, parameters: [0, v.id | 0, v.x | 0, v.y | 0, 0, 0] }]; },
          describe: function (v) { return 'go to map ' + (v.id | 0) + ' @ ' + (v.x | 0) + ',' + (v.y | 0); } },
        { code: 117, label: 'Call a common event', fields: [['id', 'num', 'Common event id']],
          build: function (v) { return [{ code: 117, indent: 0, parameters: [v.id | 0] }]; },
          describe: function (v) { return 'call common event ' + (v.id | 0); } },
        { code: 355, label: 'Script', fields: [['text', 'str', 'JavaScript']],
          build: function (v) { return [{ code: 355, indent: 0, parameters: [String(v.text || '')] }]; },
          describe: function (v) { return 'script: ' + String(v.text || '').slice(0, 40); } }
    ];
    F.commands = function () { return CMDS.slice(); };

    /**
     * Rebuild a common event's list from a set of steps.
     *
     * The {code:0} terminator is appended here rather than being one of the
     * steps, because Game_Interpreter walks the array until it finds one and
     * runs off the end without it — a hang on a blank frame with nothing in
     * the log.
     */
    F.buildCommands = function (steps) {
        var list = [];
        (steps || []).forEach(function (st) {
            var def = null;
            CMDS.forEach(function (c) { if (c.code === st.code) def = c; });
            if (!def) return;
            $.safe(function () { def.build(st.values || {}).forEach(function (c) { list.push(c); }); }, 'build command');
        });
        list.push({ code: 0, indent: 0, parameters: [] });
        return list;
    };

    F.describeCommand = function (st) {
        var def = null;
        CMDS.forEach(function (c) { if (c.code === st.code) def = c; });
        return def ? def.describe(st.values || {}) : 'unknown command';
    };

    /**
     * Steps are DERIVED from the draft's list, not stored beside it.
     *
     * The first version kept them in a map keyed by draft id, which is a key
     * that CHANGES: committing a new event moves it from `'draft'` to the
     * allocated id, and loading one from the library moves it to that record's
     * id. Either way the panel then read a different, empty array — so a
     * freshly forged event showed "0 steps", and the first edit after that
     * rebuilt `list` from nothing and wrote the truncated program over the
     * record. Anything reconstructible has to be reconstructed.
     */
    function stepsFrom(list) {
        var steps = [];
        if (!Array.isArray(list)) return steps;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c || !c.code) continue;
            var p = c.parameters || [];
            switch (c.code) {
                // 101 opens a text block and 401 carries the line; the builder
                // always writes them as a pair, so the 401 is the step and the
                // 101 is skipped.
                case 401: steps.push({ code: 401, values: { text: String(p[0] == null ? '' : p[0]) } }); break;
                case 121: steps.push({ code: 121, values: { id: p[0] | 0, on: p[2] === 0 } }); break;
                case 122: steps.push({ code: 122, values: { id: p[0] | 0, value: p[4] | 0 } }); break;
                case 125: steps.push({ code: 125, values: { value: (p[0] === 1 ? -1 : 1) * (p[2] | 0) } }); break;
                case 126: steps.push({ code: 126, values: { id: p[0] | 0, value: (p[1] === 1 ? -1 : 1) * (p[3] | 0) } }); break;
                case 311: steps.push({ code: 311, values: { id: p[1] | 0, value: (p[2] === 1 ? -1 : 1) * (p[4] | 0) } }); break;
                case 201: steps.push({ code: 201, values: { id: p[1] | 0, x: p[2] | 0, y: p[3] | 0 } }); break;
                case 117: steps.push({ code: 117, values: { id: p[0] | 0 } }); break;
                case 355: steps.push({ code: 355, values: { text: String(p[0] == null ? '' : p[0]) } }); break;
                default: break;   // a command the palette does not own is left alone
            }
        }
        return steps;
    }
    F.stepsFrom = stepsFrom;

    /**
     * True when the list holds something the palette cannot represent.
     *
     * Rebuilding from the steps would silently drop it, so the editor says so
     * and refuses to rebuild rather than quietly deleting a program someone
     * pasted in.
     */
    function hasForeignCommands(list) {
        if (!Array.isArray(list)) return false;
        var owned = { 101: 1, 401: 1, 121: 1, 122: 1, 125: 1, 126: 1, 311: 1, 201: 1, 117: 1, 355: 1, 0: 1 };
        for (var i = 0; i < list.length; i++) {
            if (list[i] && !owned[list[i].code]) return true;
        }
        return false;
    }
    F.hasForeignCommands = hasForeignCommands;


    /* ------------------------------------------------------ field helpers */

    function paramLabels() {
        var out = [];
        for (var i = 0; i < 8; i++) {
            out.push($.safe(function () { return TextManager.param(i); }, 'param', 'p' + i) || ('p' + i));
        }
        return out;
    }

    /**
     * A class curve is edited as its eight level-1 values and regrown from
     * them. Editing 800 numbers individually is not an interface, and the
     * shape is what actually has to be right.
     */
    function curveRows(d) {
        var names = paramLabels();
        return names.map(function (nm, i) {
            var row = Array.isArray(d.data.params) && Array.isArray(d.data.params[i]) ? d.data.params[i] : [];
            var base = Number(row[1]) || Number(row[0]) || 1;
            return W.row(nm, W.number({
                value: base, min: 1, max: 99999, wide: true, _ungated: true,
                onChange: function (v) {
                    var seed = [];
                    for (var k = 0; k < 8; k++) {
                        var r = d.data.params[k] || [];
                        seed.push(k === i ? v : (Number(r[1]) || Number(r[0]) || 1));
                    }
                    d.data.params = F.buildCurve(seed);
                    repaint();
                }
            }), { sub: 'lv1' });
        });
    }

    function enemyParamRows(d) {
        var names = paramLabels();
        return names.map(function (nm, i) {
            return W.row(nm, W.number({
                value: Number((d.data.params || [])[i]) || 0, min: 0, max: 999999, wide: true, _ungated: true,
                onChange: function (v) {
                    if (!Array.isArray(d.data.params)) d.data.params = [0, 0, 0, 0, 0, 0, 0, 0];
                    d.data.params[i] = v; repaint();
                }
            }));
        });
    }

    /**
     * Troop members.
     *
     * x/y are screen coordinates and default to something visible rather than
     * 0,0 — a troop whose members all sit in the top-left corner looks like
     * the battle failed to build.
     */
    function troopMembers(d) {
        if (!Array.isArray(d.data.members)) d.data.members = [];
        var rows = d.data.members.map(function (m, i) {
            return h('div', { class: 'mm-inline', style: 'padding:1px 2px' },
                W.number({
                    value: m.enemyId || 1, min: 1, max: 9999, _ungated: true,
                    onChange: function (v) { m.enemyId = v; repaint(); }
                }),
                W.number({
                    value: m.x || 0, min: 0, max: 2000, _ungated: true,
                    onChange: function (v) { m.x = v; repaint(); }
                }),
                W.number({
                    value: m.y || 0, min: 0, max: 2000, _ungated: true,
                    onChange: function (v) { m.y = v; repaint(); }
                }),
                W.button({
                    label: '−', mini: true, _ungated: true,
                    onClick: function () { d.data.members.splice(i, 1); U.rerender(); }
                }));
        });
        rows.push(W.button({
            label: '+ add a member', wide: true, _ungated: true,
            disabled: d.data.members.length >= 8,
            onClick: function () {
                var n = d.data.members.length;
                d.data.members.push({ enemyId: 1, x: 200 + n * 120, y: 300, hidden: false });
                U.rerender();
            }
        }));
        rows.push(h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
            'enemy id · x · y, in screen pixels. Eight is what the default battle layout can show.'));
        return W.group('Members', rows, { tag: d.data.members.length + ' / 8' });
    }

    /**
     * The common-event command builder.
     *
     * `list` is rebuilt from the steps on every edit rather than being patched
     * in place, so the program the engine would run is always exactly what the
     * steps say — there is no state where the two disagree.
     */
    function commandBuilder(d) {
        var foreign = hasForeignCommands(d.data.list);
        var steps = stepsFrom(d.data.list);
        var pickLabel = CMDS[0].label;

        function sync() { d.data.list = F.buildCommands(steps); repaint(); }

        if (foreign) {
            return W.group('Steps', [
                h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: 'This event holds commands the nine-command palette cannot represent, so editing it ' +
                        'here would silently drop them. Its list is left exactly as it is.'
                }),
                h('div', { class: 'mm-pre', text: (d.data.list || []).map(function (c) { return c.code; }).join(', ') })
            ], { tag: 'read-only' });
        }

        var rows = steps.map(function (st, i) {
            var def = null;
            CMDS.forEach(function (c) { if (c.code === st.code) def = c; });
            if (!def) return null;
            var fields = def.fields.map(function (f) {
                var key = f[0], type = f[1], label = f[2];
                if (type === 'bool') {
                    return W.toggleRow(label, {
                        value: !!st.values[key], keybind: false, _ungated: true,
                        onChange: function (v) { st.values[key] = v; sync(); }
                    });
                }
                if (type === 'str') {
                    return W.row(label, W.text({
                        value: String(st.values[key] || ''), width: '140px', mono: type === 'str' && key === 'text',
                        onInput: function (v) { st.values[key] = v; sync(); }
                    }));
                }
                return W.row(label, W.number({
                    value: Number(st.values[key]) || 0, min: -999999, max: 999999, wide: true, _ungated: true,
                    onChange: function (v) { st.values[key] = v; sync(); }
                }));
            });
            return W.group((i + 1) + '. ' + def.label, fields.concat([
                W.button({
                    label: 'remove this step', wide: true, _ungated: true,
                    onClick: function () { steps.splice(i, 1); sync(); U.rerender(); }
                })
            ]), { tag: F.describeCommand(st), collapsed: true });
        }).filter(Boolean);

        rows.push(h('div', { class: 'mm-inline', style: 'padding:2px' },
            W.dropdown({
                options: CMDS.map(function (c) { return c.label; }),
                value: pickLabel, width: '150px', _ungated: true,
                onChange: function (v) { pickLabel = v; }
            }),
            W.button({
                label: '+ add', _ungated: true,
                onClick: function () {
                    var def = null;
                    CMDS.forEach(function (c) { if (c.label === pickLabel) def = c; });
                    if (!def) def = CMDS[0];
                    steps.push({ code: def.code, values: {} });
                    sync(); U.rerender();
                }
            })));
        rows.push(h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
            'Nine commands, not the whole editor. Script covers everything else.'));

        return W.group('Steps', rows, { tag: steps.length + ' step' + (steps.length === 1 ? '' : 's') });
    }

    function fieldGroups(kind, d) {
        var g = [];
        if (kind === 'actor') {
            g.push(W.group('Identity', [
                rText(d, 'name', 'Name'),
                rText(d, 'nickname', 'Nickname'),
                rText(d, 'profile', 'Profile', { placeholder: 'two lines' })
            ], { tag: '$dataActors' }));
            g.push(W.group('Class & level', [
                rNum(d, 'classId', 'Class id', { min: 1, max: 9999, tip: 'Class|Any class id, including one forged here.' }),
                rNum(d, 'initialLevel', 'Start level', { min: 1, max: 99 }),
                rNum(d, 'maxLevel', 'Max level', { min: 1, max: 99 })
            ]));
            g.push(W.group('Images', [
                rText(d, 'faceName', 'Face', { mono: true, placeholder: 'img/faces/…' }),
                rNum(d, 'faceIndex', 'Face index', { min: 0, max: 7 }),
                rText(d, 'characterName', 'Sprite', { mono: true, placeholder: 'img/characters/…' }),
                rNum(d, 'characterIndex', 'Sprite index', { min: 0, max: 7 }),
                rText(d, 'battlerName', 'Battler', { mono: true, placeholder: 'img/sv_actors/…' })
            ], { collapsed: true }));
            return g;
        }
        if (kind === 'klass') {
            g.push(W.group('Identity', [rText(d, 'name', 'Name')], { tag: '$dataClasses' }));
            g.push(W.group('Growth', [
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'The eight level-1 values below are grown linearly to level 99. The curve has to be ' +
                    '8 × 100 whatever the numbers are — paramBase indexes it without a guard.'),
                h('div', { class: 'mm-sep' })
            ].concat(curveRows(d)), { tag: '8 × 100' }));
            return g;
        }
        if (kind === 'enemy') {
            g.push(W.group('Identity', [
                rText(d, 'name', 'Name'),
                rText(d, 'battlerName', 'Battler', { mono: true, placeholder: 'img/enemies/…' }),
                rNum(d, 'battlerHue', 'Hue', { min: 0, max: 360 })
            ], { tag: '$dataEnemies' }));
            g.push(W.group('Parameters', enemyParamRows(d), { tag: 'flat' }));
            g.push(W.group('Rewards', [
                rNum(d, 'exp', 'EXP', { max: 999999, step: 10 }),
                rNum(d, 'gold', 'Gold', { max: 999999, step: 10 })
            ]));
            return g;
        }
        if (kind === 'troop') {
            g.push(W.group('Identity', [rText(d, 'name', 'Name')], { tag: '$dataTroops' }));
            g.push(troopMembers(d));
            return g;
        }
        if (kind === 'common') {
            g.push(W.group('Identity', [
                rText(d, 'name', 'Name'),
                rEnum(d, 'trigger', 'Trigger', TRIGGERS, { rebuild: true,
                    tip: 'Trigger|"none" runs only when called. Autorun and parallel need the ' +
                        'switch below.' }),
                d.data.trigger ? rNum(d, 'switchId', 'Switch', { min: 1, max: 9999 }) : null
            ], { tag: '$dataCommonEvents' }));
            g.push(commandBuilder(d));
            return g;
        }
        if (kind === 'item') {
            g.push(W.group('Identity', [rText(d, 'name', 'Name')].concat(descRows(d)), { tag: '$dataItems' }));
            g.push(W.group('Use', [
                rEnum(d, 'itypeId', 'Type', ITYPES),
                rBool(d, 'consumable', 'Consumable'),
                rNum(d, 'price', 'Price', { max: 999999, step: 10 }),
                rEnum(d, 'scope', 'Scope', SCOPES),
                rEnum(d, 'occasion', 'Occasion', OCCASIONS),
                rEnum(d, 'hitType', 'Hit type', HIT_TYPES),
                rNum(d, 'successRate', 'Success %', { max: 100 }),
                rNum(d, 'repeats', 'Repeats', { min: 1, max: 9 }),
                rNum(d, 'speed', 'Speed', { min: -2000, max: 2000, step: 10 }),
                rNum(d, 'tpGain', 'TP gain', { max: 100 }),
                rNum(d, 'animationId', 'Animation', { min: -1, max: 999 })
            ], { tag: 'Game_Action' }));
            g.push(damageGroup(d));
            g.push(noteGroup(d));
        } else if (kind === 'weapon' || kind === 'armor') {
            g.push(W.group('Identity', [rText(d, 'name', 'Name')].concat(descRows(d, 1)), { tag: '$data' + (kind === 'weapon' ? 'Weapons' : 'Armors') }));
            g.push(W.group('Equipment', [
                kind === 'weapon'
                    ? rEnum(d, 'wtypeId', 'Weapon type', sysList('weaponTypes', 'weapon').map(function (n, i) { return [i, n || '(none)']; }))
                    : rEnum(d, 'atypeId', 'Armor type', sysList('armorTypes', 'armor').map(function (n, i) { return [i, n || '(none)']; })),
                rEnum(d, 'etypeId', 'Slot', sysList('equipTypes', 'slot').map(function (n, i) { return [i, n || '(none)']; })),
                rNum(d, 'price', 'Price', { max: 999999, step: 10 })
            ].concat(kind === 'weapon' ? [rNum(d, 'animationId', 'Animation', { min: -1, max: 999 })] : []),
                { tag: 'equip' }));
            g.push(paramGroup(d));
            g.push(noteGroup(d));
        } else if (kind === 'skill') {
            g.push(W.group('Identity', [rText(d, 'name', 'Name')].concat(descRows(d)), { tag: '$dataSkills' }));
            g.push(W.group('Use', [
                rEnum(d, 'stypeId', 'Skill type', sysList('skillTypes', 'type').map(function (n, i) { return [i, n || '(none)']; })),
                rNum(d, 'mpCost', 'MP cost', { max: 9999 }),
                rNum(d, 'tpCost', 'TP cost', { max: 100 }),
                rEnum(d, 'scope', 'Scope', SCOPES),
                rEnum(d, 'occasion', 'Occasion', OCCASIONS),
                rEnum(d, 'hitType', 'Hit type', HIT_TYPES),
                rNum(d, 'successRate', 'Success %', { max: 100 }),
                rNum(d, 'repeats', 'Repeats', { min: 1, max: 9 }),
                rNum(d, 'speed', 'Speed', { min: -2000, max: 2000, step: 10 }),
                rNum(d, 'tpGain', 'TP gain', { max: 100 }),
                rNum(d, 'animationId', 'Animation', { min: -1, max: 999 })
            ], { tag: 'Game_Action' }));
            g.push(damageGroup(d));
            g.push(W.group('Battle text', [
                rText(d, 'message1', 'Line 1', { placeholder: '%1 uses …' }),
                rText(d, 'message2', 'Line 2'),
                rEnum(d, 'requiredWtypeId1', 'Needs weapon',
                    sysList('weaponTypes', 'weapon').map(function (n, i) { return [i, n || 'any']; })),
                rEnum(d, 'requiredWtypeId2', 'or weapon',
                    sysList('weaponTypes', 'weapon').map(function (n, i) { return [i, n || 'any']; }))
            ], { tag: 'Window_BattleLog', collapsed: true }));
            g.push(noteGroup(d));
        } else if (kind === 'state') {
            g.push(W.group('Identity', [
                rText(d, 'name', 'Name'),
                rEnum(d, 'restriction', 'Restriction', RESTRICTIONS),
                rNum(d, 'priority', 'Priority', { max: 100 }),
                rEnum(d, 'motion', 'Motion', MOTIONS),
                rNum(d, 'overlay', 'Overlay', { max: 15 })
            ], { tag: '$dataStates' }));
            g.push(W.group('Removal', [
                rEnum(d, 'autoRemovalTiming', 'Auto-removal', REMOVAL),
                rNum(d, 'minTurns', 'Min turns', { min: 1, max: 999 }),
                rNum(d, 'maxTurns', 'Max turns', { min: 1, max: 999 }),
                rBool(d, 'removeAtBattleEnd', 'At battle end'),
                rBool(d, 'removeByRestriction', 'By restriction'),
                rBool(d, 'removeByDamage', 'By damage'),
                rNum(d, 'chanceByDamage', 'Damage chance %', { max: 100 }),
                rBool(d, 'removeByWalking', 'By walking'),
                rNum(d, 'stepsToRemove', 'Steps', { min: 1, max: 9999 })
            ], { tag: 'timing' }));
            g.push(W.group('Messages', [
                rText(d, 'message1', 'Actor gains'),
                rText(d, 'message2', 'Enemy gains'),
                rText(d, 'message3', 'Still affected'),
                rText(d, 'message4', 'Removed')
            ], { tag: '%1 = name', collapsed: true }));
            g.push(noteGroup(d));
        }
        return g;
    }

    /* ----------------------------------------------------------- transport */
    function transportGroup() {
        var box = null;
        var n = F.count();
        return W.group('Library file', [
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'Entries' }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: n.live + ' live · ' + n.dead + ' retired' })),
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'File' }),
                W.path($.store.path(FILE), { fallback: FILE })),
            W.row('Paste', box = W.text({
                mono: true, width: '154px', placeholder: 'paste exported JSON here'
            })),
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({
                    label: 'copy export', wide: true, _ungated: true,
                    onClick: function () {
                        var json = F.exportJson();
                        var ok = $.safe(function () {
                            // nw.Clipboard first: the game is served from
                            // file://, which is not a secure context, and
                            // navigator.clipboard is gated behind one.
                            if (typeof nw !== 'undefined' && nw.Clipboard) {
                                nw.Clipboard.get().set(json, 'text');
                                return true;
                            }
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                                navigator.clipboard.writeText(json);
                                return true;
                            }
                            return false;
                        }, 'clipboard', false);
                        $.log(ok ? 'ok' : 'info', ok ? 'forge: library copied to the clipboard'
                            : 'forge: clipboard unavailable — the library is at ' + ($.store.path(FILE) || FILE));
                        U.toast({
                            title: ok ? 'COPIED' : 'CLIPBOARD BLOCKED',
                            msg: ok ? json.length + ' bytes of JSON' : 'open ' + FILE + ' directly instead',
                            severity: ok ? 'ok' : 'warn'
                        });
                    }
                }),
                W.button({
                    label: 'import pasted', wide: true, mutates: true,
                    onClick: function () {
                        var text = box.mm.get();
                        if (!text) { U.toast({ title: 'NOTHING TO IMPORT', msg: 'paste JSON into the box first', severity: 'warn' }); return; }
                        if (F.importJson(text)) U.rerender();
                    }
                })),
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Imported ids are kept as they are, never renumbered. Ones this install cannot ' +
                'allocate are listed under Id ranges.')
        ], { tag: FILE, collapsed: true });
    }

    /* ------------------------------------------------------------ id ranges
       Where this kind's ids come from, whether the library and the database
       still agree about it, and what to do when they do not.
       --------------------------------------------------------------------- */
    function rangeGroup(kind) {
        var kids = [];
        var base = F.base(kind);
        var drift = F.baseDrift();
        var mine = null;
        drift.forEach(function (dr) { if (dr.kind === kind) mine = dr; });

        function kv(label, value, tip) {
            var row = h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: label }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: value }));
            if (tip) row.setAttribute('data-mm-tip', tip);
            return row;
        }

        if (!base) {
            kids.push(h('div', {
                class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                text: F.baseWhy()
            }));
            return W.group('Id ranges', kids, { tag: 'unresolved' });
        }

        kids.push(kv('Range', F.rangeText(kind),
            'Range|Ids this install allocates for ' + KINDS[kind].plural + '. The lower bound sits above ' +
            'everything the game itself ships; the upper one is a guard against a mistyped id padding the ' +
            'data array with millions of nulls.'));
        kids.push(kv('Base from', F.baseSource() === 'recorded'
            ? 'the library file'
            : 'this database',
            'Base|Recorded on the first forge and wins from then on, so ids survive a ' +
            'game patch.'));
        kids.push(kv('Next id', String(F.nextId(kind) || 0),
            'Next|0 means the range is spent.'));

        if (mine) {
            kids.push(h('div', {
                class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
                h('b', { text: mine.collides
                    ? 'the game has grown past this range. '
                    : 'this range sits higher than it needs to. ' }),
                'The library records ' + mine.recorded + '; this database would compute ' + mine.computed + '. ' +
                (mine.collides
                    ? 'Ids between the two may now belong to the game, and rows written there are refused ' +
                      'rather than overwriting real content.'
                    : 'Nothing is at risk — the ids simply start further up than they would today.')));
            kids.push(W.button({
                label: 'migrate ' + KINDS[kind].plural + ' to ' + mine.computed,
                wide: true, variant: 'danger',
                confirmLabel: 'move every id — saves may break?',
                tip: 'Migrate|IDS CHANGE: a save holding an old id loses that reference. Every ' +
                    'move is logged.',
                onClick: function () {
                    var r = F.migrateBases([kind]);
                    if (!r) return;
                    U.toast({
                        title: r.moved.length ? 'MIGRATED' : 'NOT MIGRATED',
                        msg: r.moved.length
                            ? r.moved.length + ' id(s) moved — the log lists every one'
                            : (r.refused[0] || r.why || 'nothing moved'),
                        severity: r.refused.length ? 'warn' : 'ok'
                    });
                    U.rerender();
                }
            }));
        }

        var unplaced = F.unplaced(kind);
        if (unplaced.length) {
            var outs = unplaced.filter(function (r) { return r.outOfRange; }).length;
            var takes = unplaced.length - outs;
            kids.push(h('div', { class: 'mm-sep' }));
            kids.push(h('div', {
                class: 'mm-sub', style: 'white-space:normal;padding:2px',
                text: unplaced.length + ' record(s) are in the library but not in the database. Nothing was ' +
                    'discarded. ' +
                    (outs ? outs + ' hold ids outside this range — an id below the base belongs to the game ' +
                        'here, so writing there would replace real content; load one and forge it again to ' +
                        'give it an id this install can allocate. ' : '') +
                    (takes ? takes + ' hold ids the game itself now occupies, which only a migration can ' +
                        'move. ' : '')
            }));
            unplaced.slice(0, 8).forEach(function (r) {
                kids.push(kv('#' + r.id, (r.data && r.data.name) || '(unnamed)',
                    'Unplaced|' + (r.outOfRange ? 'outside ' + F.rangeText(kind)
                        : 'the game owns the row at this id')));
            });
            if (unplaced.length > 8) {
                kids.push(h('div', { class: 'mm-sub', style: 'padding:2px', text: '… and ' + (unplaced.length - 8) + ' more' }));
            }
        }

        if (F.dropped.length) {
            kids.push(h('div', { class: 'mm-sep' }));
            kids.push(h('div', {
                class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)',
                text: F.dropped.length + ' record(s) could not be read at all and were dropped. The log names ' +
                    'each one and why.'
            }));
        }

        return W.group('Id ranges', kids, {
            tag: mine ? 'drifted' : F.baseSource(),
            collapsed: !mine && !unplaced.length && !F.dropped.length
        });
    }

    /* ---------------------------------------------------------- browse
       Searching the game's OWN rows of this kind, so a forged entry can start
       from one that already works rather than from a blank.

       $.index answers "which ids match this text" without walking every name.
       It is never authority: every candidate is re-resolved against the live
       $data* array before it is shown, because the index is a snapshot and the
       array is not. When it cannot answer, its reason is shown and the linear
       scan does the same job more slowly.
       --------------------------------------------------------------------- */
    function browseGroup(kind, load) {
        var q = '', why = '';

        // Re-read on every pass rather than captured once: a dev-tools plugin
        // that reloads the database hands back a different array, and a held
        // reference would keep answering from the old one.
        function data() { return KINDS[kind].arr() || []; }

        function resolveCandidates(list) {
            var arr = data(), out = [];
            (list || []).forEach(function (c) {
                if (!c || !(c.id > 0) || c.id >= arr.length) return;   // the index is ahead of this database
                var row = arr[c.id];
                if (!row) return;                                      // the row has gone
                var name = String(row.name == null ? '' : row.name).toLowerCase();
                if (q && name.indexOf(q) === -1 && String(c.id).indexOf(q) === -1) return;
                out.push(row);
            });
            return out;
        }

        function linear() {
            var arr = data(), out = [];
            for (var i = 1; i < arr.length && out.length < 200; i++) {
                var row = arr[i];
                if (!row) continue;
                var name = String(row.name == null ? '' : row.name).toLowerCase();
                if (q && name.indexOf(q) === -1 && String(i).indexOf(q) === -1) continue;
                out.push(row);
            }
            return out;
        }

        function rows() {
            why = '';
            if (!data().length) {
                why = 'the ' + KINDS[kind].plural + ' array is not loaded.';
                return [];
            }
            if (!$.index || !$.index.findByName) {
                why = 'the index module is not installed — searching the long way instead.';
                return linear();
            }
            var r = $.safe(function () {
                return $.index.findByName(KINDS[kind].index, q, 200);
            }, 'forge index search', null);
            if (!r) { why = 'the index query threw — searching the long way instead.'; return linear(); }
            if (!r.complete) { why = r.why; return linear(); }
            return resolveCandidates(r.candidates);
        }

        var table = W.table({
            virtual: true, rowH: 17,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'id', w: '0 0 46px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: '', w: '0 0 58px' }
            ],
            empty: 'no matches',
            render: function (row) {
                var ours = F.isCustom(kind, row.id);
                return [
                    U.icon(row.iconIndex),
                    String(row.id),
                    h('span', { text: (row.name || '(unnamed)') + (ours ? '  · forged' : '') }),
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'copy', mini: true, _ungated: true,
                            tip: 'Copy|A new draft with an id of its own. The original is ' +
                                'untouched.',
                            onClick: function () { load(row); }
                        }))
                ];
            },
            onRow: function (tr, row) {
                tr.setAttribute('data-mm-tip', (row.name || 'unnamed') + '|' +
                    (F.isCustom(kind, row.id)
                        ? 'forged here — the library has a record for id ' + row.id
                        : 'the game\'s own ' + KINDS[kind].label.toLowerCase() + ', id ' + row.id));
            }
        });

        var note = h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' });
        function refresh() {
            table.mm.paint(rows());
            note.textContent = why;
            note.style.display = why ? '' : 'none';
            note.style.color = why ? 'var(--mm-warn)' : '';
        }
        refresh();

        return W.group('Browse ' + KINDS[kind].plural, [
            h('div', { class: 'mm-toolbar' },
                W.search({
                    placeholder: 'search ' + KINDS[kind].plural + '…', value: '',
                    onInput: function (v) { q = v; refresh(); }
                })),
            table,
            note
        ], { tag: 'the game\'s own', collapsed: true });
    }

    /**
     * Turn one of the game's own rows into a new draft.
     *
     * Merged onto a blank so the draft has every field this install's rows are
     * expected to carry, and stripped of everything that identifies the
     * original: its id, our own injection markers, and the parsed note cache,
     * which is rebuilt when the copy is written.
     */
    function copyIntoDraft(kind, row) {
        var data = $.deepMerge(blank(kind), $.clone(row));
        data.id = 0;
        delete data.meta;
        delete data.gigahackForged;
        delete data.gigahackTombstone;
        if (data.name) data.name = String(data.name) + ' copy';
        return repairShape(kind, data);
    }

    /* --------------------------------------------------------------- build */
    // What the kind picker offers, in the order it offers it.
    var PICK = [
        ['item', 'item'], ['weapon', 'weapon'], ['armor', 'armor'],
        ['skill', 'skill'], ['state', 'state'],
        ['actor', 'actor'], ['klass', 'class'],
        ['enemy', 'enemy'], ['troop', 'troop'], ['common', 'common event']
    ];

    function build(sub) {
        var kind = subKind[sub] || 'item';
        if (!KINDS[kind]) kind = 'item';

        F.ensure();

        var d = draft(kind);
        var preview = previewCard(d, kind);
        var libGroup = libraryGroup(kind, function (rec) {
            drafts[kind] = { id: rec.id, data: $.clone(rec.data) };
            U.rerender();
        });

        repaint = function () {
            $.safe(function () {
                preview.paint();
                libGroup.mm.tag(F.live(kind).length + ' live');
            }, 'forge repaint');
        };

        var left = [];
        var labels = PICK.map(function (p) { return p[1]; });
        var current = 'item';
        PICK.forEach(function (p) { if (p[0] === kind) current = p[1]; });
        left.push(W.group('Forging', [
            W.row('Kind', W.dropdown({
                options: labels, value: current, width: '124px', _ungated: true,
                tip: 'Kind|Each kind keeps its own draft, so switching away and back loses ' +
                    'nothing.',
                onChange: function (v) {
                    PICK.forEach(function (p) { if (p[1] === v) subKind[sub] = p[0]; });
                    U.rerender();
                }
            })),
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                F.live(kind).length + ' forged · ids ' + F.rangeText(kind) +
                (F.baseSource() ? ' (' + F.baseSource() + ')' : '')),
            degradeNote(WRITE)
        ], { tag: KINDS[kind].plural }));
        left = left.concat(fieldGroups(kind, d));
        // Actors, classes, enemies, troops and common events have no
        // iconIndex; offering a picker that writes a field nothing reads would
        // be a control that does nothing.
        if (blank(kind).iconIndex != null) left.push(iconPicker(d));

        var right = [];
        // Troops and common events have neither list; the others take traits,
        // and items and skills take effects instead.
        var shape = blank(kind);
        if (shape.effects) right.push(ruleList(d, 'effects'));
        else if (shape.traits) right.push(ruleList(d, 'traits'));
        right.push(W.group('Preview', [preview.node], { tag: 'as the game sees it' }));
        right.push(outputGroup(kind, d, function () { U.rerender(); }));
        right.push(libGroup);
        right.push(rangeGroup(kind));
        right.push(browseGroup(kind, function (row) {
            drafts[kind] = { id: null, data: copyIntoDraft(kind, row) };
            U.rerender();
        }));
        right.push(transportGroup());

        return cols(left, right);
    }

    /**
     * Which kind the single Forge panel is pointed at.
     *
     * Public because it is now the only way to reach nine of the ten editors —
     * with six sub-tabs there was a sub name per kind and the shell's own
     * sub-tab state was the selector; with one panel the selector is this.
     */
    F.kind = function (k) {
        if (k && KINDS[k]) { subKind.Forge = k; if (U.isOpen && U.isOpen()) U.rerender(); }
        return subKind.Forge || 'item';
    };

    // One panel for all ten kinds. Six sub-tabs that each held one or two
    // arrays made the Items tab unreadable once the inventory panels joined
    // it; the kind picker was already there for the multi-array ones, so it
    // simply covers everything now.
    U.panel('items', 'Forge', function () { return build('Forge'); }, 50,
        function () { return subKind.Forge || 'item'; });

    /* ------------------------------------------------------------ console */
    $.api.forge = function () { return F.lib(); };
    $.api.forgeInject = function () { return F.inject(); };
    $.api.forgeScrub = function () { return F.scrub(); };

    $.api.forgeRecruit = function (id) { return F.recruit(id); };
    $.api.forgeRun = function (id) { return F.runCommon(id); };

    // Nothing about the library or its id bases can be stated yet — this file
    // runs while the plugin list is being set up, which is before the database
    // exists. F.report() says the real numbers once Scene_Boot.start has run.
    $.log('info', 'forge registered across ' + KIND_IDS.length + ' kinds — the library and its id bases ' +
        'are resolved when the database loads');

})(window.GigaHack);
