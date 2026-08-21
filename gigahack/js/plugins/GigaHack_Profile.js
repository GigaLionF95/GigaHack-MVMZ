//=============================================================================
// GigaHack MV/MZ
// 03 · profile.js — everything that is true of ONE game, in one place
//-----------------------------------------------------------------------------
// A profile answers questions the engine cannot: which variables are the ones
// this game's player actually cares about, what its section-header convention
// looks like, whether it has a Steam app id, which of its own plugins expose
// state worth surfacing.
//
// THE IMPORTANT PART: a profile is never required. Every value below has a
// default computed from the loaded database, and the mod is fully functional
// with no profile at all. A profile makes a game nicer; it never makes it
// possible. If you are reading this because GigaHack does not know about your
// game — it does not need to.
//
// Resolution is lazy. Mod plugins are set up during DataManager.loadDatabase,
// which is BEFORE $dataSystem exists, so nothing here may touch $data* at load
// time. resolve() runs on first access after boot, and again if the database
// is reloaded.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — per-game profiles
 * @author gigahack
 * @help GigaHack_Profile.js — requires Core, Caps, Store
 *
 * To write a profile for your game, drop a file in gigahack/profiles/ that
 * calls GigaHack.profile.register(). See profiles/README.md.
 */

(function ($) {
    'use strict';
    if (!$) { console.error('[GigaHack] core missing — profile not installed'); return; }

    var P = $.profile = {};
    var registered = [];
    var resolved = null;

    /* =====================================================================
       1. The shape of a profile
       Every field is optional. Anything absent is computed.
       ===================================================================== */
    var SHAPE = {
        id: 'string — a short stable key, e.g. "ska"',
        name: 'string — human name shown in the About panel',
        match: 'function(ctx) -> boolean — ctx has {title, engine, version, counts}',
        quickVars: 'array of variable NAMES to pin in the sidebar (resolved by name, not id)',
        sectionPattern: 'RegExp matching a variable/switch name that is a section header',
        galleryFilter: 'RegExp matching section titles worth offering in the Gallery panel',
        forgeBase: 'object of {kind: number} overriding the computed id bases',
        forgeExtraFields: 'object of {kind: {field: default}} merged into blank rows',
        steamAppId: 'number',
        steamHints: 'object of {ACHIEVEMENT_API_NAME: "how you get it"}',
        adapters: 'object of optional feature adapters — see §5',
        notes: 'array of strings shown in the About panel'
    };
    P.shape = SHAPE;

    /* =====================================================================
       2. Registration
       ===================================================================== */
    P.register = function (profile) {
        if (!profile || !profile.id) {
            $.log('warn', 'profile registration ignored: no id');
            return false;
        }
        if (registered.some(function (p) { return p.id === profile.id; })) {
            $.log('warn', 'profile "' + profile.id + '" registered twice — the first one wins');
            return false;
        }
        registered.push(profile);
        $.log('info', 'profile available: ' + profile.id + (profile.name ? ' (' + profile.name + ')' : ''));
        return true;
    };

    P.list = function () { return registered.slice(); };

    /* =====================================================================
       3. Computed defaults — the generic game profile
       These are the values a game gets when nobody has written a profile for
       it. Each is derived from data the engine has already loaded.
       ===================================================================== */

    function dataReady() {
        return typeof $dataSystem !== 'undefined' && !!$dataSystem &&
               typeof $dataItems !== 'undefined' && !!$dataItems;
    }

    function counts() {
        function len(a) { return (a && a.length) ? a.length : 0; }
        return {
            items:    len(typeof $dataItems !== 'undefined' && $dataItems),
            weapons:  len(typeof $dataWeapons !== 'undefined' && $dataWeapons),
            armors:   len(typeof $dataArmors !== 'undefined' && $dataArmors),
            skills:   len(typeof $dataSkills !== 'undefined' && $dataSkills),
            states:   len(typeof $dataStates !== 'undefined' && $dataStates),
            actors:   len(typeof $dataActors !== 'undefined' && $dataActors),
            classes:  len(typeof $dataClasses !== 'undefined' && $dataClasses),
            enemies:  len(typeof $dataEnemies !== 'undefined' && $dataEnemies),
            troops:   len(typeof $dataTroops !== 'undefined' && $dataTroops),
            common:   len(typeof $dataCommonEvents !== 'undefined' && $dataCommonEvents),
            maps:     len(typeof $dataMapInfos !== 'undefined' && $dataMapInfos),
            variables: (typeof $dataSystem !== 'undefined' && $dataSystem && $dataSystem.variables) ? $dataSystem.variables.length : 0,
            switches:  (typeof $dataSystem !== 'undefined' && $dataSystem && $dataSystem.switches) ? $dataSystem.switches.length : 0
        };
    }

    /* --- Forge id bases --------------------------------------------------
       The 1.x code shipped fixed bases (1001 for most kinds, 2001 for skills)
       read off one game's data files. That is wrong in both directions: on a
       bigger game the base collides with the game's own content, and on a
       smaller one it wastes nothing but misleads.
       Compute from the data instead: round up past the highest existing id,
       with a margin so a game patch that adds content does not land on top of
       an already-forged row. The resolved base is persisted by Forge so ids
       stay stable even if the game later grows.
       ------------------------------------------------------------------ */
    var BASE_MARGIN = 200;      // room for the game to grow before we collide
    var BASE_ROUND  = 1000;     // round bases to a readable number

    function computeBase(arrLen) {
        var need = (arrLen || 0) + BASE_MARGIN;
        var base = Math.ceil(need / BASE_ROUND) * BASE_ROUND;
        return Math.max(BASE_ROUND, base) + 1;   // 1001, 2001, 3001, …
    }

    function defaultForgeBases() {
        var c = counts();
        return {
            item:   computeBase(c.items),
            weapon: computeBase(c.weapons),
            armor:  computeBase(c.armors),
            skill:  computeBase(c.skills),
            state:  computeBase(c.states),
            actor:  computeBase(c.actors),
            klass:  computeBase(c.classes),
            enemy:  computeBase(c.enemies),
            troop:  computeBase(c.troops),
            common: computeBase(c.common)
        };
    }

    /* --- section headers -------------------------------------------------
       The "-- Section" convention is widespread in RPG Maker projects but is
       not universal and is not an engine feature. Detect it: if a meaningful
       fraction of named variables or switches start with the marker, the game
       uses the convention. If not, everything lands in one "Ungrouped"
       section and the panel still works.
       ------------------------------------------------------------------ */
    var DEFAULT_SECTION = /^\s*--+\s*/;

    function detectSectionPattern() {
        return $.safe(function () {
            if (!dataReady() || !$dataSystem.variables) return DEFAULT_SECTION;
            var candidates = [
                { re: /^\s*--+\s*/,  hits: 0 },
                { re: /^\s*==+\s*/,  hits: 0 },
                { re: /^\s*##+\s*/,  hits: 0 },
                { re: /^\s*\[.*\]\s*$/, hits: 0 }
            ];
            var named = 0, lists = [$dataSystem.variables, $dataSystem.switches];
            lists.forEach(function (list) {
                (list || []).forEach(function (n) {
                    if (!n) return;
                    named++;
                    candidates.forEach(function (c) { if (c.re.test(n)) c.hits++; });
                });
            });
            if (!named) return DEFAULT_SECTION;
            var best = candidates.slice().sort(function (a, b) { return b.hits - a.hits; })[0];
            // Require a real signal: at least three headers and at least 1%
            // of named entries. One variable called "--" is not a convention.
            if (best.hits >= 3 && best.hits / named >= 0.01) return best.re;
            return null;   // null means "this game has no section convention"
        }, 'detectSectionPattern', DEFAULT_SECTION);
    }

    /* --- quick variables -------------------------------------------------
       With no profile there is no way to know which variables matter. Rather
       than guess from names — which would be an English-language assumption
       about a game that may not be in English — fall back to what the USER
       has told us matters: their own pinned and frozen variables. That list
       starts empty and fills as they work, which is the honest behaviour.
       ------------------------------------------------------------------ */
    function defaultQuickVars() { return []; }

    /* --- hotkeys ---------------------------------------------------------
       1.x shipped defaults chosen by hand from one game's free-letter set.
       Derive them instead: read Input.keyMapper, subtract everything the
       engine and the game's plugins have claimed, and take the first free
       key from a preference order. Falls back to the historical defaults
       when keyMapper is unreadable.
       ------------------------------------------------------------------ */
    var PREFERRED = {
        toggle:    ['KeyN', 'KeyG', 'KeyU', 'KeyY', 'F1', 'F10'],
        quickSave: ['KeyP', 'KeyT', 'F6', 'F1'],
        quickLoad: ['KeyO', 'KeyR', 'F9', 'F2'],
        noclip:    ['KeyV', 'KeyY', 'KeyU', 'F3'],
        speed:     ['KeyF', 'KeyG', 'KeyT', 'F4'],
        pause:     ['KeyY', 'KeyU', 'KeyG', 'F11']
    };

    /* Keys the engine itself owns on both MV and MZ, by KeyboardEvent.code. */
    var ENGINE_KEYS = ['F2', 'F3', 'F4', 'F5', 'F8', 'F9', 'F12',
        'Enter', 'Escape', 'Space', 'Tab', 'ShiftLeft', 'ShiftRight',
        'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'PageUp', 'PageDown', 'Insert', 'KeyQ', 'KeyW', 'KeyX', 'KeyZ'];

    /* Map a legacy keyCode (what Input.keyMapper is keyed by) to a code
       string, for the letters and function keys we care about. */
    function codeForKeyCode(kc) {
        if (kc >= 65 && kc <= 90) return 'Key' + String.fromCharCode(kc);
        if (kc >= 112 && kc <= 123) return 'F' + (kc - 111);
        if (kc >= 48 && kc <= 57) return 'Digit' + (kc - 48);
        return null;
    }

    function claimedKeys() {
        return $.safe(function () {
            var taken = {};
            ENGINE_KEYS.forEach(function (c) { taken[c] = 'the engine'; });
            if (typeof Input !== 'undefined' && Input.keyMapper) {
                Object.keys(Input.keyMapper).forEach(function (kc) {
                    var code = codeForKeyCode(parseInt(kc, 10));
                    if (code && !taken[code]) taken[code] = 'Input.keyMapper → "' + Input.keyMapper[kc] + '"';
                });
            }
            return taken;
        }, 'claimedKeys', {});
    }

    function defaultHotkeys() {
        var taken = claimedKeys();
        var out = {}, used = {};
        Object.keys(PREFERRED).forEach(function (action) {
            var list = PREFERRED[action], pick = null;
            for (var i = 0; i < list.length; i++) {
                if (!taken[list[i]] && !used[list[i]]) { pick = list[i]; break; }
            }
            if (!pick) {
                // Everything preferred is claimed. Take the first preference
                // anyway and let the clash detector say so out loud, rather
                // than silently shipping no hotkey at all.
                pick = list[0];
                $.log('warn', 'hotkey "' + action + '": every preferred key is already claimed (' +
                    list[0] + ' by ' + (taken[list[0]] || 'another action') + '). Bound anyway — rebind it in Settings.');
            }
            used[pick] = true;
            out[action] = pick;
        });
        return out;
    }
    P.defaultHotkeys = defaultHotkeys;
    P.claimedKeys = claimedKeys;

    /* =====================================================================
       4. Resolution
       ===================================================================== */
    function buildDefault() {
        var c = counts();
        var title = $.safe(function () {
            return (dataReady() && $dataSystem.gameTitle) ? String($dataSystem.gameTitle) : null;
        }, 'game title', null);

        return {
            id: 'generic',
            name: title || 'this game',
            generic: true,
            quickVars: defaultQuickVars(),
            sectionPattern: detectSectionPattern(),
            galleryFilter: null,          // null = offer every section
            forgeBase: defaultForgeBases(),
            forgeExtraFields: {},
            steamAppId: null,
            steamHints: {},
            adapters: {},
            notes: [],
            counts: c,
            title: title
        };
    }

    P.resolve = function (force) {
        if (resolved && !force) return resolved;
        if (!dataReady()) {
            // Never cache a profile built before the database loaded.
            return buildDefault();
        }

        var base = buildDefault();
        var ctx = {
            title: base.title,
            engine: $.caps.engine,
            version: $.caps.engineVersion,
            counts: base.counts,
            plugins: $.safe(function () {
                return (typeof $plugins !== 'undefined' && $plugins)
                    ? $plugins.map(function (p) { return String(p.name || ''); }) : [];
            }, 'plugin names', [])
        };

        var hit = null;
        for (var i = 0; i < registered.length; i++) {
            var p = registered[i];
            var ok = $.safe(function () {
                return typeof p.match === 'function' ? !!p.match(ctx) : false;
            }, 'profile match: ' + p.id, false);
            if (ok) { hit = p; break; }
        }

        if (!hit) {
            resolved = base;
            $.log('info', 'no profile matched "' + (base.title || 'this game') +
                '" — using computed defaults (Forge ids from ' + base.forgeBase.item +
                ', section headers ' + (base.sectionPattern ? 'detected' : 'not used by this game') + ')');
            $.gameTitle = base.title;
            return resolved;
        }

        // A profile's values override the computed ones; anything it omits
        // stays computed. This is why a profile can be three lines long.
        //
        // The merge is explicit rather than one blanket deepMerge, because the
        // two kinds of field behave differently and conflating them was a real
        // bug, not a theoretical one:
        //
        //   * TABLE fields (forgeBase, forgeExtraFields, steamHints) deep-merge,
        //     so a profile that pins one Forge id base leaves the other nine
        //     computed.
        //   * VALUE fields (sectionPattern, galleryFilter, adapters, quickVars)
        //     are taken whole. sectionPattern is a RegExp and adapters is an
        //     object of functions; walking either produces a plain object that
        //     is truthy and has none of its methods, so the failure lands at
        //     the eventual .test() or .read() call rather than here.
        //
        //   A profile that OMITS a value field must keep the computed one. The
        //   earlier version restored it only when the profile supplied it, so
        //   every matched profile without a sectionPattern got {} and every
        //   caller of isSectionHeader() threw.
        resolved = $.clone(base);
        resolved.id = hit.id;
        resolved.name = hit.name || base.name;
        resolved.generic = false;

        ['forgeBase', 'forgeExtraFields', 'steamHints'].forEach(function (k) {
            if (hit[k] !== undefined && hit[k] !== null) resolved[k] = $.deepMerge(base[k], hit[k]);
        });
        ['quickVars', 'quickVarsTitle', 'sectionPattern', 'galleryFilter', 'adapters',
         'steamAppId', 'steamStats', 'gameOptions', 'notes'].forEach(function (k) {
            if (hit[k] !== undefined) resolved[k] = hit[k];
        });

        $.gameTitle = base.title;
        $.log('ok', 'profile: ' + resolved.id + ' (' + resolved.name + ')');
        return resolved;
    };

    /* The accessor every module uses. Always returns an object. */
    P.active = function () { return resolve_(); };

    function resolve_() {
        if (resolved) return resolved;
        return P.resolve();
    }

    /* Convenience: P.get('sectionPattern', fallback) */
    P.get = function (key, fallback) {
        var p = resolve_();
        var v = p ? p[key] : undefined;
        return (v === undefined || v === null) ? fallback : v;
    };

    /* Section-header predicate — the one place the convention is decided.
       1.x had three independent copies of `name.slice(0,2) === '--'`. */
    P.isSectionHeader = function (name) {
        if (!name) return false;
        var re = P.get('sectionPattern', null);
        if (!re) return false;
        return re.test(String(name));
    };

    P.sectionTitle = function (name) {
        var re = P.get('sectionPattern', null);
        if (!re || !name) return String(name || '');
        return String(name).replace(re, '').trim();
    };

    /* =====================================================================
       5. Adapters
       A profile may supply small objects that teach GigaHack about one of the
       game's own plugins. Each is entirely optional; the feature that uses it
       checks for it and simply does not offer the panel when it is absent.

       Known adapter slots:
         backlog  — { available(), read(), clear(), max(), setMax(n), open() }
         ironman  — { enabled(), slot(), relax(on) }
         steam    — { available(), why(), get(name), set(name), clear(name),
                      stat(id), setStat(id,v), store() }
         modLoader— { updateURL(url) }
       ===================================================================== */
    P.adapter = function (slot) {
        var a = P.get('adapters', {});
        return (a && a[slot]) ? a[slot] : null;
    };

    /* =====================================================================
       6. Re-resolve when the database is reloaded
       Some dev-tools plugins reload $data* at runtime. A profile resolved
       against the old data would keep stale counts and stale Forge bases.
       ===================================================================== */
    $.install('DataManager.onLoad (profile)',
        typeof DataManager !== 'undefined' ? DataManager : null, 'onLoad',
        function (original) {
            return function (object) {
                var r = original.apply(this, arguments);
                if (object === (typeof $dataSystem !== 'undefined' ? $dataSystem : null)) {
                    $.safe(function () { P.resolve(true); }, 'profile re-resolve');
                }
                return r;
            };
        }, 'DataManager.onLoad not found — the profile will resolve on first use instead');

})(window.GigaHack);
