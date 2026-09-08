//=============================================================================
// GigaHack MV/MZ
// 22 · steam.js — Steam achievements, discovered rather than tabulated
//-----------------------------------------------------------------------------
// Nothing in this file knows any game's achievements, app id or stats. All
// three are discovered, and the order matters, because the three sources are
// not equally good:
//
//   1. THE API ITSELF. A Steam binding that can enumerate — a count plus an
//      index accessor, or a names array — is authoritative. It is the same
//      list the store page shows, in the same order, and reading it requires
//      no knowledge of the game whatsoever. This is the only source that is
//      complete, so it is asked first and it wins.
//   2. THE GAME'S OWN EVENT DATA. Where there is no enumeration call, walk the
//      event commands that are loaded for a plugin command whose name mentions
//      an achievement, and keep the names it passes. MZ spells that command as
//      code 357 with an argument object; MV as code 356 with the raw line as
//      typed, so both are read. A scan sees only what is LOADED — the common
//      events, the troops and the current map — so the count grows as a
//      session goes on, and rows found this way are labelled as the guesses
//      they are.
//   3. THE PROFILE. Anything a game profile lists in `steamHints` is offered
//      as well, which is how a name that appears in neither of the above still
//      gets a row, with a note saying how it is earned.
//
// The app id comes from steam_appid.txt in the game folder when there is one,
// then from the profile, and is otherwise shown as unknown. It is never a
// literal here: a wrong app id is the one mistake in this module that reaches
// Steam's servers, attributing one game's unlocks to another.
//
// The API is reached through an adapter that probes the profile's own 'steam'
// adapter, then a greenworks binding, then any other loaded object that
// feature-detects as one. Every probe records WHICH precondition failed, so
// "not reachable" always arrives with the reason attached.
//
// When no probe finds anything at all, NO PANEL IS REGISTERED. A panel whose
// every control is inert is worse than a missing one: it looks like it worked.
// When a binding IS found but is not ready — Steam not running, API not
// initialised — the panel is registered and names which, because that is a
// state the player can do something about.
//
// Nothing here writes to the game. Unlocking is a Steam-side operation.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — Steam achievements
 * @author gigahack
 * @help GigaHack_Steam.js — requires Core, Caps, UI, Shell and Tabs. Profile is
 * used for the app id, the hints and an optional adapter where a game has one.
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) { console.error('[GigaHack] shell missing — steam not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    var S = $.steam = {};

    /* =====================================================================
       PART 0 — THE APP ID

       Steam attributes an unlock to an app id. A binding knows its own once it
       is initialised; before that the only thing that carries it is
       steam_appid.txt, which is exactly what that file exists for. Read it
       where it is, ask the profile when it is absent, and say "unknown" rather
       than inventing one.
       ===================================================================== */
    var appIdCache = null;

    function readAppIdFile() {
        return $.safe(function () {
            if (!$.caps.fs || !$.paths.gameRoot) return null;
            var fs = $.env.fs, path = $.env.path;
            // Three candidates, because the install layout is discovered and
            // never assumed: the game root, a www/ deploy inside it, and one
            // level up, where a packaged build keeps its executable.
            var tries = [
                path.join($.paths.gameRoot, 'steam_appid.txt'),
                path.join($.paths.gameRoot, 'www', 'steam_appid.txt'),
                path.join(path.dirname($.paths.gameRoot), 'steam_appid.txt')
            ];
            for (var i = 0; i < tries.length; i++) {
                try {
                    if (!fs.existsSync(tries[i])) continue;
                    var raw = String(fs.readFileSync(tries[i], 'utf8') || '').trim();
                    if (/^\d+$/.test(raw)) return { id: raw, from: 'steam_appid.txt', where: tries[i], why: '' };
                } catch (e) { /* try the next */ }
            }
            return null;
        }, 'read steam_appid.txt', null);
    }

    S.appId = function (again) {
        if (appIdCache && !again) return appIdCache;
        appIdCache = readAppIdFile();
        if (appIdCache) return appIdCache;
        var fromProfile = $.safe(function () {
            var v = $.profile ? $.profile.get('steamAppId', null) : null;
            return (v === null || v === undefined || String(v) === '') ? null : String(v).trim();
        }, 'profile steamAppId', null);
        appIdCache = fromProfile
            ? { id: fromProfile, from: 'the game profile', where: '', why: '' }
            : {
                id: null, from: '', where: '',
                why: $.caps.fs
                    ? 'there is no steam_appid.txt under ' + ($.paths.gameRoot || 'the game folder') +
                      ', and no profile names one'
                    : 'the app id is read from a file in the game folder, and ' + $.caps.fsWhy
            };
        return appIdCache;
    };

    /* =====================================================================
       PART 1 — IS THERE A STEAM API, AND IS IT READY

       Three probes, in order, each recording WHICH precondition failed.
       Collapsing them into one boolean is how "it does nothing and I do not
       know why" happens, so nothing is collapsed until the last line.

         1. the game profile's own 'steam' adapter — a build whose Steam plugin
            is shaped like nothing below can be taught in a few lines;
         2. a greenworks binding, which is what an RPG Maker game ships when it
            ships Steam support at all;
         3. anything else with the right shape: an object carrying a call that
            unlocks an achievement, found by looking rather than by name. No
            plugin is named here — the probe reports what it found by shape.
       ===================================================================== */

    /** The first of `names` that is callable on `obj`, or null. */
    function fnOf(obj, names) {
        for (var i = 0; i < names.length; i++) {
            if (obj && typeof obj[names[i]] === 'function') return names[i];
        }
        return null;
    }

    var UNLOCK_CALLS = ['activateAchievement', 'unlockAchievement', 'setAchievement', 'awardAchievement'];

    /**
     * Call a binding method that may answer in any of the three shapes these
     * things come in: a plain return value, a promise, or success/error
     * callbacks. Callbacks are passed every time — a function that takes one
     * argument ignores the extra two — so all three are covered without
     * guessing from arity, which a native binding reports as 0 anyway.
     * `done` runs at most once, with true/false, or null for "no answer".
     */
    function call1(obj, method, arg, done) {
        var answered = false;
        function settle(v) { if (answered) return; answered = true; if (done) done(v); }
        var ok = $.safe(function () {
            var r = obj[method](arg,
                function (v) { settle(v === undefined ? true : !!v); },
                function () { settle(null); });
            if (r && typeof r.then === 'function') {
                r.then(function (v) { settle(v === undefined ? true : !!v); }, function () { settle(null); });
            } else if (typeof r === 'boolean') {
                settle(r);
            }
            return true;
        }, 'steam ' + method + ' ' + arg, false);
        if (!ok) settle(null);
        return ok;
    }

    /**
     * Normalise whatever was found into one shape. Every capability is
     * optional except unlocking: what an adapter cannot do, the panel does not
     * offer, rather than offering it and failing.
     */
    function makeApi(label, obj, m) {
        var api = {
            name: label,
            obj: obj,
            can: {
                unlock: !!m.activate,
                clear: !!m.clear,
                read: !!m.get,
                enumerate: !!(m.allNames || (m.count && m.nameAt)),
                stats: !!(m.statInt && m.setStat)
            }
        };
        api.activate = m.activate ? function (id, done) { return call1(obj, m.activate, id, done); } : null;
        api.clear = m.clear ? function (id, done) { return call1(obj, m.clear, id, done); } : null;
        api.get = m.get ? function (id, done) { return call1(obj, m.get, id, done); } : null;

        api.names = api.can.enumerate ? function () {
            return $.safe(function () {
                var out = [], i;
                if (m.allNames) {
                    var arr = obj[m.allNames]() || [];
                    for (i = 0; i < arr.length; i++) if (arr[i]) out.push(String(arr[i]));
                    return out;
                }
                var n = Number(obj[m.count]()) || 0;
                for (i = 0; i < n; i++) {
                    var nm = obj[m.nameAt](i);
                    if (nm) out.push(String(nm));
                }
                return out;
            }, 'enumerate achievements', []) || [];
        } : null;

        api.title = m.display ? function (id) {
            return $.safe(function () { return String(obj[m.display](id) || ''); }, 'achievement title', '') || '';
        } : null;

        api.statInt = m.statInt ? function (id) {
            return $.safe(function () { return Number(obj[m.statInt](id)) || 0; }, 'steam stat ' + id, 0);
        } : null;

        // storeStats is the call that commits a stat write, and some bindings
        // require the callbacks. Two no-ops cost nothing and a missing
        // argument throws.
        api.store = m.store ? function () {
            return $.safe(function () {
                obj[m.store](function () { }, function () { });
                return true;
            }, 'steam storeStats', false);
        } : null;

        api.setStat = m.setStat ? function (id, v) {
            return $.safe(function () {
                obj[m.setStat](id, Number(v) || 0);
                if (api.store) api.store();
                return true;
            }, 'steam setStat ' + id, false);
        } : null;

        return api;
    }

    /** Shared by probes 2 and 3: describe an object by what it can do. */
    function bindingFrom(probeName, obj, label) {
        var m = {
            activate: fnOf(obj, UNLOCK_CALLS),
            clear: fnOf(obj, ['clearAchievement', 'lockAchievement', 'resetAchievement']),
            get: fnOf(obj, ['getAchievement', 'isAchievementUnlocked', 'readAchievement']),
            allNames: fnOf(obj, ['getAchievementNames', 'achievementNames']),
            count: fnOf(obj, ['getNumberOfAchievements', 'achievementCount']),
            nameAt: fnOf(obj, ['getAchievementName', 'achievementNameAt']),
            display: fnOf(obj, ['getAchievementDisplayName']),
            statInt: fnOf(obj, ['getStatInt', 'getStat']),
            setStat: fnOf(obj, ['setStatInt', 'setStat']),
            store: fnOf(obj, ['storeStats', 'store'])
        };
        if (!m.activate) {
            return { name: probeName, obj: obj, found: false, ready: false,
                why: 'nothing on ' + label + ' unlocks an achievement' };
        }

        // The preconditions, asked in the order they fail in practice.
        var running = fnOf(obj, ['isSteamRunning', 'isRunning']);
        if (running) {
            var live = $.safe(function () { return !!obj[running](); }, 'steam ' + running, null);
            if (live === null) {
                return { name: probeName, obj: obj, found: true, ready: false,
                    why: label + ' is loaded but ' + running + '() threw, which is what an uninitialised ' +
                        'binding does: the game was not started through Steam' +
                        (S.appId().id ? '' : ', and there is no steam_appid.txt to stand in for that') };
            }
            if (!live) {
                return { name: probeName, obj: obj, found: true, ready: false,
                    why: 'Steam is not running, so ' + label + ' has nothing to talk to' };
            }
        }
        return { name: probeName, obj: obj, found: true, ready: true, why: '', api: makeApi(label, obj, m) };
    }

    /* --- probe 1: the game profile -------------------------------------- */
    function probeProfile() {
        var ad = $.safe(function () {
            return $.profile ? $.profile.adapter('steam') : null;
        }, 'profile steam adapter', null);
        if (!ad) {
            return { name: 'game profile adapter', found: false, ready: false,
                why: 'no profile for this game supplies a Steam adapter — and none is needed when a binding below answers' };
        }
        var stated = (typeof ad.why === 'function')
            ? ($.safe(function () { return String(ad.why() || ''); }, 'steam adapter why', '') || '') : '';
        var ready = (typeof ad.available === 'function')
            ? $.safe(function () { return !!ad.available(); }, 'steam adapter available', false) : true;
        if (!ready) {
            return { name: 'game profile adapter', obj: ad, found: true, ready: false,
                why: stated || 'the profile adapter reports that Steam is not available here' };
        }
        // A profile adapter is written to the slot's documented names; the
        // aliases are accepted so a three-line adapter does not have to be
        // renamed to be understood.
        var m = {
            activate: fnOf(ad, ['set'].concat(UNLOCK_CALLS)),
            clear: fnOf(ad, ['clear', 'lock', 'clearAchievement']),
            get: fnOf(ad, ['get', 'read', 'getAchievement']),
            allNames: fnOf(ad, ['list', 'names', 'achievements']),
            count: null,
            nameAt: null,
            display: fnOf(ad, ['title', 'displayName']),
            statInt: fnOf(ad, ['stat', 'getStat', 'getStatInt']),
            setStat: fnOf(ad, ['setStat', 'setStatInt']),
            store: fnOf(ad, ['store', 'storeStats'])
        };
        if (!m.activate) {
            return { name: 'game profile adapter', obj: ad, found: true, ready: false,
                why: 'the profile adapter has no call that unlocks an achievement' };
        }
        return { name: 'game profile adapter', obj: ad, found: true, ready: true, why: '',
            api: makeApi('the game profile’s Steam adapter', ad, m) };
    }

    /* --- probe 2: a greenworks binding -----------------------------------
       greenworks is the node binding an RPG Maker Steam build ships. It is
       feature-detected rather than trusted: forks and shims of it are common
       and a build may expose only part of it. */
    function probeGreenworks() {
        var gw = $.safe(function () {
            return (typeof greenworks !== 'undefined' && greenworks) ? greenworks : null;
        }, 'greenworks global', null);
        if (!gw) {
            return { name: 'greenworks', found: false, ready: false,
                why: 'no greenworks binding is loaded' +
                    ($.caps.nwjs ? '' : ' — and this is a browser build, which cannot load one') };
        }
        return bindingFrom('greenworks', gw, 'greenworks');
    }

    /* --- probe 3: anything else with the shape ---------------------------
       A build may wrap its binding in an object of its own. Rather than name
       plugins, look for the shape: a global, or one object one level inside a
       global, carrying a call that unlocks an achievement. Bounded, guarded
       and run once — a property on `window` can throw simply for being read.
       ------------------------------------------------------------------ */
    function probeShim(skip) {
        var hit = $.safe(function () {
            var keys = Object.keys(window);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (!k || k.charAt(0) === '$' || /^(webkit|moz|ms|on)/.test(k)) continue;
                var v = null;
                try { v = window[k]; } catch (e) { continue; }
                if (!v || v === window || skip.indexOf(v) > -1) continue;
                if (typeof v !== 'object' && typeof v !== 'function') continue;
                if (v.nodeType) continue;
                if (fnOf(v, UNLOCK_CALLS)) return { obj: v, label: k };

                var inner = [];
                try { inner = Object.keys(v); } catch (e) { continue; }
                if (inner.length > 40) continue;      // a namespace, not a database
                for (var j = 0; j < inner.length; j++) {
                    var c = null;
                    try { c = v[inner[j]]; } catch (e) { continue; }
                    if (!c || skip.indexOf(c) > -1) continue;
                    if (typeof c !== 'object' && typeof c !== 'function') continue;
                    if (c.nodeType) continue;
                    if (fnOf(c, UNLOCK_CALLS)) return { obj: c, label: k + '.' + inner[j] };
                }
            }
            return null;
        }, 'probe globals for a Steam binding', null);

        if (!hit) {
            return { name: 'any other binding', found: false, ready: false,
                why: 'no other loaded object exposes a call that unlocks an achievement' };
        }
        return bindingFrom('any other binding', hit.obj, hit.label);
    }

    var env = null;

    /**
     * The whole answer, in one object: which probe answered, what it can do,
     * and — when nothing answered — every reason, in the order they were
     * found. `found` and `usable` are deliberately separate: "there is no
     * Steam here at all" and "there is Steam here and it is not ready" are
     * different situations with different answers.
     */
    S.env = function (again) {
        if (env && !again) return env;
        var tried = [], api = null, skip = [];

        function run(fn) {
            var r = $.safe(fn, 'steam probe', null) ||
                { name: 'probe', found: false, ready: false, why: 'the probe itself threw — see the log' };
            tried.push(r);
            if (r.obj) skip.push(r.obj);
            if (!api && r.api) api = r.api;
        }
        run(probeProfile);
        run(probeGreenworks);
        run(function () { return probeShim(skip); });

        var found = false, reasons = [];
        tried.forEach(function (t) {
            if (!t.found) return;
            found = true;
            if (!t.api && t.why) reasons.push(t.why);
        });

        env = {
            api: api,
            usable: !!api,
            found: found,
            name: api ? api.name : '',
            can: api ? api.can : { unlock: false, clear: false, read: false, enumerate: false, stats: false },
            tried: tried,
            appId: S.appId(),
            why: api ? ''
                : reasons.length ? reasons.join('; ')
                    : 'this build ships no Steam integration: none of the three probes found anything ' +
                      'that can unlock an achievement.'
        };
        return env;
    };

    /* =====================================================================
       PART 2 — THE LIST
       ===================================================================== */

    /** What the profile knows about how each one is earned. Never required. */
    function hints() {
        return $.safe(function () {
            var v = $.profile ? $.profile.get('steamHints', {}) : {};
            return (v && typeof v === 'object') ? v : {};
        }, 'profile steamHints', {}) || {};
    }

    /**
     * Stats a profile has declared, as [{id, goal, of}].
     *
     * Two places, because a profile has two: a `stats()` call on its steam
     * adapter, or a plain `steamStats` field. Empty when it declares neither,
     * and the Stats group is simply not rendered — an integer stat is a
     * game-specific quantity that cannot be discovered from the API, which
     * enumerates achievements but not the counters behind them.
     */
    function stats() {
        return $.safe(function () {
            var ad = $.profile ? $.profile.adapter('steam') : null;
            var list = (ad && typeof ad.stats === 'function') ? ad.stats()
                : ($.profile ? $.profile.get('steamStats', []) : []);
            if (!list || !list.length) return [];
            var out = [];
            for (var i = 0; i < list.length; i++) {
                var s = list[i];
                if (typeof s === 'string') { out.push({ id: s, goal: 0, of: '' }); continue; }
                if (!s || !s.id) continue;
                out.push({ id: String(s.id), goal: Number(s.goal) || 0, of: String(s.of || '') });
            }
            return out;
        }, 'profile steam stats', []) || [];
    }

    /* --- source 1: the API enumerates itself ----------------------------- */
    function fromApi(api) {
        if (!api || !api.names) return [];
        return api.names();
    }

    /* --- source 2: the game's own event data -----------------------------
       An achievement name reaches Steam through a plugin command, and the two
       engines spell that command differently:

         MZ, code 357: [pluginName, command, label, {args}]
         MV, code 356: ['the whole command line, as typed']

       Neither engine reserves a vocabulary for achievements, so the match is
       on the command TEXT — a command whose name mentions one — and the value
       taken is whichever argument is shaped like an API name. That is a
       heuristic and it is labelled as one: rows found this way are marked
       "event", and an enumerated list wins over them wherever there is one.

       Only loaded data can be walked. The cross-map index does not record
       plugin-command arguments, so this sees the common events, the troops and
       the map the player is standing on — which is why the count grows as a
       session goes on rather than being complete at boot.
       ------------------------------------------------------------------ */
    var ACHIEVE_WORD = /achiev/i;
    var API_NAME = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;
    var NOT_A_NAME = /^(true|false|null|undefined|on|off|yes|no|unlock|lock|clear|set|get|add|show|hide)$/i;

    function nameLike(v) {
        var s = String(v == null ? '' : v).trim();
        if (!API_NAME.test(s) || NOT_A_NAME.test(s) || ACHIEVE_WORD.test(s)) return null;
        return s;
    }

    function walk(list, found) {
        if (!list || !list.length) return;
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c || !c.parameters) continue;

            if (c.code === 357) {
                var p = c.parameters;
                var head = String(p[0] || '') + ' ' + String(p[1] || '') + ' ' + String(p[2] || '');
                if (!ACHIEVE_WORD.test(head)) continue;
                var args = p[3];
                if (!args || typeof args !== 'object') continue;
                var keys = Object.keys(args);
                // Where an argument is NAMED for the thing, trust the name and
                // read only those; otherwise take every argument that looks
                // like an API name.
                var named = keys.filter(function (k) { return /achiev|api|name|id/i.test(k); });
                (named.length ? named : keys).forEach(function (k) {
                    var n = nameLike(args[k]);
                    if (n) found[n] = true;
                });
                continue;
            }

            if (c.code === 356) {
                var line = String(c.parameters[0] || '');
                if (!ACHIEVE_WORD.test(line)) continue;
                var parts = line.split(/\s+/);
                var strong = [], last = null, t;
                for (t = 1; t < parts.length; t++) {
                    var n2 = nameLike(parts[t]);
                    if (!n2) continue;
                    last = n2;
                    // An UPPER_SNAKE token is the Steam convention and is taken
                    // outright; anything else is only taken when the line
                    // offered nothing better, and then only its last argument.
                    if (/^[A-Z][A-Z0-9_]*$/.test(n2)) strong.push(n2);
                }
                if (strong.length) { for (t = 0; t < strong.length; t++) found[strong[t]] = true; }
                else if (last && parts.length > 2) found[last] = true;
            }
        }
    }

    function scanLists() {
        var found = {};
        $.safe(function () {
            if (typeof $dataCommonEvents !== 'undefined' && $dataCommonEvents) {
                $dataCommonEvents.forEach(function (ce) { if (ce) walk(ce.list, found); });
            }
            if (typeof $dataTroops !== 'undefined' && $dataTroops) {
                $dataTroops.forEach(function (t) {
                    if (t && t.pages) t.pages.forEach(function (pg) { walk(pg.list, found); });
                });
            }
            if (typeof $dataMap !== 'undefined' && $dataMap && $dataMap.events) {
                $dataMap.events.forEach(function (ev) {
                    if (ev && ev.pages) ev.pages.forEach(function (pg) { walk(pg.list, found); });
                });
            }
        }, 'scan achievements');
        return Object.keys(found);
    }

    /** Prettify an API name. STOLEN_VALOR → "Stolen Valor". */
    function pretty(id) {
        return String(id).split('_').map(function (w) {
            if (/^\d+$/.test(w)) return w;
            return w.charAt(0) + w.slice(1).toLowerCase();
        }).join(' ');
    }

    var listCache = null;
    var listStats = { steam: 0, event: 0, profile: 0 };

    S.list = function (rescan) {
        if (listCache && !rescan) return listCache;
        var e = S.env();
        var hint = hints();
        var byId = {}, order = [];
        listStats = { steam: 0, event: 0, profile: 0 };

        function addAll(ids, source) {
            (ids || []).forEach(function (raw) {
                var id = String(raw || '').trim();
                if (!id || byId[id]) return;
                var title = '';
                if (e.api && e.api.title) title = e.api.title(id);
                byId[id] = {
                    id: id,
                    title: title || pretty(id),
                    source: source,
                    how: hint[id] ? String(hint[id]) : ''
                };
                order.push(id);
                listStats[source]++;
            });
        }

        // Enumerated first, and in the API's own order: that order is the one
        // the store page uses, and re-sorting it would throw away information
        // no other source has.
        addAll(fromApi(e.api), 'steam');
        addAll(scanLists().sort(), 'event');
        addAll(Object.keys(hint).sort(), 'profile');

        listCache = order.map(function (id) { return byId[id]; });
        revision++;                     // the discovered list itself is on screen
        return listCache;
    };

    S.count = function () { return S.list().length; };
    S.discovery = function () { return $.clone ? $.clone(listStats) : listStats; };

    /** One sentence naming where the list came from, for the panel and the log. */
    S.discoveryText = function () {
        S.list();
        var parts = [];
        if (listStats.steam) parts.push(listStats.steam + ' enumerated from ' + (S.env().name || 'the Steam API'));
        if (listStats.event) parts.push(listStats.event + ' found in this project’s event data');
        if (listStats.profile) parts.push(listStats.profile + ' named by the game profile');
        if (!parts.length) return 'Nothing has been discovered yet.';
        return parts.join(', ') + '.';
    };

    /* =====================================================================
       PART 3 — READING AND WRITING STEAM

       Every call goes through the adapter chosen in PART 1, so nothing below
       knows which binding it is talking to or what shape that binding's
       callbacks have. A capability the adapter does not have is not called:
       the panel does not offer it in the first place.
       ===================================================================== */

    var achieved = {};      // id → true | false | undefined (not yet asked)
    var polling = false;

    /* One integer, moved by every path that changes what the panel is showing:
       an answer arriving from Steam, a write of ours, and the discovered list
       growing. Neither the size of `achieved` nor the number unlocked can do
       this job — a refresh that turns one answer from unlocked to locked
       leaves both exactly where they were. */
    var revision = 0;

    /**
     * A cheap "has anything the Achievements panel shows changed" probe.
     *
     * It cannot see the GAME unlocking an achievement through its own plugin:
     * that call goes straight to the binding and never passes through here, so
     * the row still says what the last read said. "Look again" on the panel is
     * what re-asks Steam, and it says so.
     */
    S.revision = function () { return revision; };

    S.stateOf = function (id) { return achieved[id]; };
    S.known = function () { return Object.keys(achieved).length; };

    S.unlockedCount = function () {
        var n = 0;
        for (var k in achieved) if (achieved[k]) n++;
        return n;
    };

    /**
     * Ask Steam about every achievement, then repaint ONCE.
     *
     * One rerender at the end rather than one per answer: a repaint per row of
     * a table with a hundred rows is a visible stutter for no extra
     * information. Every answer settles exactly once — including the ones that
     * never arrive, which is what the guard in call1() is for.
     */
    S.refresh = function (then) {
        var e = S.env();
        if (!e.usable || !e.api.get || polling) { if (then) then(); return false; }
        var list = S.list(), left = list.length;
        if (!left) { if (then) then(); return false; }
        polling = true;
        function done() {
            if (--left > 0) return;
            polling = false;
            if (then) then();
            if ($.ui && $.ui.rerender) $.safe(function () { $.ui.rerender(); }, 'steam rerender');
        }
        list.forEach(function (a) {
            e.api.get(a.id, function (is) {
                if (achieved[a.id] !== ((is === null) ? undefined : !!is)) revision++;
                achieved[a.id] = (is === null) ? undefined : !!is;
                done();
            });
        });
        return true;
    };

    /**
     * Read back what we just wrote.
     *
     * Steam silently ignores a name it does not know for this app id, which
     * looks exactly like success from the caller's side. Where the adapter can
     * read, ask again and say so when the answer disagrees — the same
     * write-and-verify the game-side controls use, against the only authority
     * there is for this one.
     */
    function verifyWrite(id, want) {
        var e = S.env();
        if (!e.usable || !e.api.get) return;
        e.api.get(id, function (is) {
            if (is === null) return;                  // no answer is not a failure
            if (achieved[id] !== !!is) revision++;
            achieved[id] = !!is;
            if (!!is === !!want) return;
            $.log('warn', 'steam: "' + id + '" still reads back as ' + (is ? 'unlocked' : 'locked') +
                ' after asking Steam to ' + (want ? 'unlock' : 'clear') + ' it. Steam ignores a name it does ' +
                'not know for this app id' + (e.appId.id ? ' (' + e.appId.id + ')' : ' — and this build has no app id') + '.');
        });
    }

    /**
     * The read-back is taken from inside the write's OWN answer, never
     * straight after the call: a binding that reports asynchronously has not
     * committed anything yet at the moment activate() returns, and a read
     * taken there would report a failure that is only a race. A binding that
     * answers nothing at all is simply not verified — silence is not evidence.
     */
    function afterWrite(id, want) {
        return function (answered) {
            if (answered === null) {
                $.log('warn', 'steam: the binding reported an error while trying to ' +
                    (want ? 'unlock' : 'clear') + ' "' + id + '".');
                return;
            }
            verifyWrite(id, want);
        };
    }

    S.unlock = function (id) {
        var e = S.env();
        if (!e.usable || !e.api.activate) return false;
        var ok = e.api.activate(id, afterWrite(id, true));
        if (!ok) return false;
        achieved[id] = true;
        revision++;
        $.log('ok', 'steam achievement unlocked: ' + id);
        return true;
    };

    S.lock = function (id) {
        var e = S.env();
        if (!e.usable || !e.api.clear) return false;
        var ok = e.api.clear(id, afterWrite(id, false));
        if (!ok) return false;
        achieved[id] = false;
        revision++;
        $.log('ok', 'steam achievement cleared: ' + id);
        return true;
    };

    /**
     * All of them, in one log line.
     *
     * A log entry per achievement would push everything else out of the
     * drawer, so the individual calls are made quietly and the count is
     * reported once. The read-back is skipped here for the same reason: one
     * refresh afterwards answers for the whole set.
     */
    S.setAll = function (on) {
        var e = S.env();
        if (!e.usable) return 0;
        var fn = on ? e.api.activate : e.api.clear;
        if (!fn) {
            $.log('warn', 'steam: ' + e.name + ' has no call that ' + (on ? 'unlocks' : 'clears') + ' an achievement');
            return 0;
        }
        var list = S.list(), n = 0;
        list.forEach(function (a) {
            if (!fn(a.id)) return;
            achieved[a.id] = !!on;
            revision++;
            n++;
        });
        $.log(n ? 'ok' : 'warn', (on ? 'unlocked ' : 'cleared ') + n + ' of ' + list.length + ' steam achievements');
        S.refresh();
        return n;
    };

    S.stat = function (id) {
        var e = S.env();
        if (!e.usable || !e.api.statInt) return 0;
        return e.api.statInt(id);
    };

    S.setStat = function (id, value) {
        var e = S.env();
        if (!e.usable || !e.api.setStat) return false;
        var ok = e.api.setStat(id, value);
        if (ok) $.log('ok', 'steam stat ' + id + ' = ' + value);
        return ok;
    };

    /* =====================================================================
       PART 4 — THE PANEL
       ===================================================================== */

    /**
     * Shown when a binding was FOUND but is not ready.
     *
     * Not when none was found at all — in that case no panel is registered, so
     * there is nothing to put this in. Every probe gets a row saying what it
     * looked for and what stopped it, because "Steam does nothing" with no
     * reason attached is the failure this whole module is arranged to avoid.
     */
    function unavailable(e) {
        var rows = [
            h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
                'A Steam binding is loaded here, but it cannot be used right now. The controls are hidden ' +
                'rather than shown doing nothing.'),
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'Reason' }),
                h('div', { class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-sub', text: e.why }))
        ];
        e.tried.forEach(function (t) {
            rows.push(h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab mm-mono', text: t.name }),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-sub',
                    text: t.api ? 'ready' : (t.found ? 'present — ' + t.why : t.why)
                })));
        });
        rows.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
            'This is what the session discovered. Unlock and clear appear only where Steam is reachable.'));
        return W.group('Steam is not reachable right now', rows, { tag: 'read-only' });
    }

    function build() {
        var e = S.env();
        var list = S.list();
        var st = stats();
        var acts = e.usable && (e.can.unlock || e.can.clear);
        var q = '';

        var table = W.table({
            virtual: true,
            key: 'steam',
            cols: [
                { label: 'achievement', w: '1 1 0' },
                { label: 'api name', w: '0 0 168px' },
                { label: 'from', w: '0 0 54px' },
                { label: 'state', w: '0 0 62px' }
            ].concat(acts ? [{ label: '', w: '0 0 128px' }] : []),
            empty: list.length ? 'nothing matched' : 'nothing discovered yet',
            render: function (a) {
                var s = achieved[a.id];
                var row = [
                    h('span', { class: 'mm-cell', text: a.title }),
                    h('span', { class: 'mm-cell mm-mono mm-sub mm-selectable', text: a.id }),
                    h('span', { class: 'mm-cell mm-sub', text: a.source }),
                    s === undefined
                        ? h('span', { class: 'mm-sub', text: (e.usable && e.can.read) ? '…' : '—' })
                        : h('span', { style: 'color:var(--mm-' + (s ? 'ok' : 'text-dim') + ')', text: s ? 'unlocked' : 'locked' })
                ];
                if (acts) {
                    row.push(h('div', { class: 'mm-inline' },
                        e.can.unlock ? W.button({
                            label: 'unlock', mini: true, mutates: true,
                            onClick: function () { S.unlock(a.id); U.rerender(); }
                        }) : null,
                        e.can.clear ? W.button({
                            label: 'clear', mini: true, mutates: true,
                            onClick: function () { S.lock(a.id); U.rerender(); }
                        }) : null));
                }
                return row;
            },
            onRow: function (tr, a) {
                var tip = a.how ? a.how : (a.source === 'event'
                    ? 'the name an event command passes to Steam'
                    : a.source === 'steam' ? 'enumerated from the Steam API' : 'named by the game profile');
                tr.setAttribute('data-mm-tip', a.title + '|' + tip);
            }
        });
        function paint() {
            var t = q.toLowerCase();
            list = S.list();
            table.mm.paint(list.filter(function (a) {
                return !t || a.id.toLowerCase().indexOf(t) > -1 || a.title.toLowerCase().indexOf(t) > -1;
            }));
        }
        paint();

        function countTag() {
            return (e.usable && e.can.read)
                ? S.unlockedCount() + ' / ' + list.length + ' unlocked'
                : list.length + ' discovered';
        }

        var achGroup = W.group('Achievements', [
            h('div', { class: 'mm-toolbar' }, W.search({
                placeholder: 'filter ' + list.length + ' achievements…',
                onInput: function (v) { q = v; paint(); }
            })),
            table
        ], { grow: true, tag: countTag() });

        /* Steam answers a refresh one achievement at a time and the answers
           arrive long after the panel was drawn, so a state column built once
           says "…" for as long as the panel is open. The count beside the group
           title is repainted with the rows, because a list and a total that
           disagree is the defect this project keeps a scar for.

           within: the table. The filter box above it is not in the thing being
           repainted, and a list that stopped taking answers because somebody
           left the caret in the filter would be worse than the staleness. */
        U.live(S.revision, function () {
            paint();
            achGroup.mm.tag(countTag());
        }, {
            name: 'steam achievements',
            within: table,
            when: function () { return !table.mm.isScrolling(); }
        });

        var left = [achGroup];

        var right = [];
        if (!e.usable) right.push(unavailable(e));

        right.push(W.group('On Steam', [
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'App ID' }),
                h('div', {
                    class: 'mm-edge mm-mono mm-sub mm-selectable',
                    text: e.appId.id ? e.appId.id : 'unknown'
                })),
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'read from' }),
                // The "why" sentence names the folder it looked in, so it holds
                // a path and cannot be left in a non-shrinking edge.
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-sub',
                    text: e.appId.id ? e.appId.from : e.appId.why
                })),
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'Binding' }),
                h('div', {
                    class: 'mm-edge mm-edge--shrink mm-path mm-mono mm-sub',
                    text: e.usable ? e.name : 'none in use', title: e.usable ? e.name : null
                })),
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'Discovered' }),
                h('div', { class: 'mm-edge mm-mono mm-sub', text: list.length + ' achievements' })),
            h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' }, S.discoveryText()),
            S.discovery().event ? h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                'An event scan sees only loaded data, so “event” rows accumulate as you play.') : null,
            W.button({
                label: 'look again', wide: true, _ungated: true,
                tip: 'Rescan|Re-probes for a binding and re-reads the loaded event data.',
                onClick: function () { S.recheck('asked from the panel'); S.list(true); S.refresh(); U.rerender(); }
            })
        ], { tag: 'info', collapsed: true }));

        if (e.usable && acts) {
            right.push(W.group('All at once', [
                e.can.unlock ? W.button({
                    label: 'unlock every achievement', wide: true, variant: 'danger',
                    tip: 'Unlock all|Fires all ' + list.length + ' at Steam. Visible on your public Steam ' +
                        'profile; the only undo is clearing them again.',
                    onClick: function () { S.setAll(true); U.rerender(); }
                }) : null,
                e.can.clear ? W.button({
                    label: 'clear every achievement', wide: true, variant: 'danger',
                    tip: 'Clear all|Removes all ' + list.length + ' from your Steam profile, not just here.',
                    onClick: function () { S.setAll(false); U.rerender(); }
                }) : null,
                e.can.read ? W.button({
                    label: 'refresh from Steam', wide: true, _ungated: true,
                    onClick: function () { S.refresh(); }
                }) : null
            ], { tag: 'careful' }));
        }

        // Stats are a game-specific quantity: the API enumerates achievements
        // but not the counters behind them, so this group exists only when the
        // game's profile declared some.
        if (e.usable && e.can.stats && st.length) {
            right.push(W.group('Stats', st.map(function (s) {
                return W.row(s.id, W.number({
                    value: S.stat(s.id), min: 0, max: 999999, width: '96px',
                    tip: s.id + '|' + (s.of ? 'Counts toward ' + s.of + (s.goal ? ' at ' + s.goal : '') + '. ' : '') +
                        'Unlocks when it passes its threshold.',
                    onChange: function (v) { S.setStat(s.id, v); }
                }), { sub: s.goal ? '/ ' + s.goal : '' });
            }), { tag: st.length + ' declared' }));
        }

        return cols(left, right);
    }

    /* =====================================================================
       PART 5 — REGISTRATION

       No binding anywhere means no panel. A binding that is present but not
       ready DOES get one, because "start the game through Steam" is something
       the player can act on, and the panel is where that sentence lives.
       ===================================================================== */
    var registered = false;

    function register(e) {
        if (registered) return true;
        if (!e.found) return false;
        U.panel('game', 'Achievements', build, 50);
        registered = true;
        return true;
    }

    /**
     * A game's Steam plugin usually initialises its binding during boot, which
     * is after every plugin FILE has loaded — so a probe at load time can
     * honestly report "nothing there" about a build that has it. Ask again at
     * the first moment the database is certainly loaded, and again whenever a
     * game world is built, and register then if the answer changed.
     */
    S.recheck = function (why) {
        var e = S.env(true);
        if (e.found && !registered) {
            register(e);
            $.log('ok', 'steam: a binding appeared after load (' + why + ') — the Achievements panel is now available');
            S.list(true);
            if (e.usable) $.safe(function () { S.refresh(); }, 'steam refresh after recheck');
            $.safe(function () { U.rerender(); }, 'steam rerender after recheck');
        }
        return e;
    };

    $.install('Scene_Boot.start (steam)',
        typeof Scene_Boot !== 'undefined' ? Scene_Boot.prototype : null, 'start',
        function (original) {
            return function () {
                var r = original.apply(this, arguments);
                $.safe(function () { S.recheck('the boot scene started'); }, 'steam recheck at boot');
                return r;
            };
        },
        'Scene_Boot.start not found — Steam is probed at load and again when a game world is built');

    $.on('gameobjects', function () {
        // The database may have been reloaded with it; the list is cheap to
        // rebuild and the scan can only have grown.
        listCache = null;
        S.recheck('a game world was built');
    });

    $.api.steam = function () { return S.env(); };
    $.api.achievements = function () { return S.list(); };

    var first = S.env();
    register(first);

    // Asked once, quietly. Where Steam is not reachable this returns
    // immediately and logs nothing, which is the correct amount of noise for a
    // feature that is not there.
    $.safe(function () { S.refresh(); }, 'steam first refresh');

    if (first.usable) {
        $.log('ok', 'steam ready via ' + first.name + ' — ' + S.discoveryText());
    } else if (first.found) {
        $.log('warn', 'steam: a binding is present but not usable — ' + first.why);
    } else {
        $.log('info', 'steam: no binding found, so no Achievements panel is registered (' + first.why + ')');
    }

})(window.GigaHack);
