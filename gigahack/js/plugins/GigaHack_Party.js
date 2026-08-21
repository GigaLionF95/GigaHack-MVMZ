//=============================================================================
// GigaHack MV/MZ
// 12 · party.js — actors, params, skills, states, equipment
//-----------------------------------------------------------------------------
// The param panel is deliberately a decomposition rather than a single editable
// number, because a parameter is not stored anywhere. On both engines param()
// is RECOMPUTED ON EVERY READ:
//
//   final = round(clamp((paramBase + paramPlus) * paramRate * paramBuffRate,
//                       paramMin, paramMax))
//
// (MZ applies a max(0, paramBase + paramPlus) floor before the rate and MV does
// not. That changes the arithmetic, not what is writable.)
//
// paramPlus is _paramPlus — the only durable write surface, moved by addParam —
// plus equipment, plus whatever any plugin contributes by aliasing paramPlus.
// So "reset params to base" cannot mean "make this number small again"; it can
// only clear the manual offset GigaHack itself wrote. Showing base / manual /
// other / rate / clamp / final makes that honest instead of surprising.
//
//   paramPlus = _paramPlus[id]  +  equipment and anything else that alters it
//                ^ "manual"        ^--------------- "other" ---------------^
//
// THE CLAMP IS WHAT DECIDES WHETHER A CHEAT WORKS AT ALL. A value above
// paramMax is thrown away on the very next read — there is no write that makes
// it stick — so the ceiling is read live, shown per parameter, and offered for
// raising rather than left as a control that appears to work. Stock ceilings
// differ between the two engines, and framework plugins routinely replace
// paramMax outright on both, so nothing here assumes one.
//
// Level and EXP have the same shape of problem: maxLevel() is read rather than
// assumed to be 99, and a setup that reports 0 there means "no cap" — which the
// engine's own changeLevel would clamp every level down to.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — party, params, skills, states, equipment
 * @author gigahack
 * @help GigaHack_Party.js — requires Core, Caps, Store, UI, Shell, Hooks,
 * Tabs, Compat
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — party not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols, clear = U.clear;

    /* =====================================================================
       SERVICES
       Compat loads before this module by manifest; a partial install still
       must not throw. The shim has the surface of the real service and
       degrades to the honest answer.
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
       made inert: the cause may have gone away — a ceiling raised, a plugin's
       own state changed — and the only way to find out is to let the user
       try again. */
    function degradeNote(control) {
        if (!degraded(control)) return null;
        return h('div', { class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px' },
            h('b', { text: 'writes here are not sticking. ' }),
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
       PART 1 — MODEL
       ===================================================================== */
    var P = $.party = {};
    var PARAM_N = 8;

    function alive() {
        return typeof $gameParty !== 'undefined' && $gameParty &&
            typeof $gameActors !== 'undefined' && $gameActors &&
            typeof $dataActors !== 'undefined' && $dataActors;
    }
    P.alive = alive;

    P.members = function () {
        return $.safe(function () { return $gameParty.allMembers().filter(Boolean); }, 'allMembers', []) || [];
    };

    P.selected = function () {
        var list = P.members();
        if (!list.length) return null;
        var id = $.store.cfgGet('party.actorId', 0);
        for (var i = 0; i < list.length; i++) if (list[i].actorId() === id) return list[i];
        return list[0];
    };
    P.select = function (actor) { $.store.cfgSet('party.actorId', actor ? actor.actorId() : 0); };

    P.paramName = function (id) {
        return $.safe(function () { return TextManager.param(id); }, 'param name', 'p' + id) || ('p' + id);
    };

    function manualOf(actor, id) {
        return $.safe(function () { return (actor._paramPlus && actor._paramPlus[id]) || 0; }, 'paramPlus', 0);
    }

    /* ------------------------------------------------------- the param cap
       Read live, per parameter, per battler. Both engines ship different
       ceilings out of the box, and a framework plugin replacing paramMax
       outright is the common case rather than the exception — so this is never
       cached and never assumed.
       ------------------------------------------------------------------ */
    P.paramCap = function (battler, id) {
        return $.safe(function () {
            var max = battler.paramMax(id), min = battler.paramMin(id);
            return {
                max: (typeof max === 'number' && !isNaN(max)) ? max : null,
                min: (typeof min === 'number' && !isNaN(min)) ? min : null
            };
        }, 'paramCap p' + id, { max: null, min: null });
    };

    /* One engine ships Infinity as its stock ceiling for every parameter and
       the other ships three different finite numbers, so the clamp is rendered
       rather than printed raw — "0–Infinity" is noise where "0–∞" is a fact. */
    P.capText = function (cap) {
        if (!cap || cap.max === null) return '?';
        var lo = cap.min === null ? '' : cap.min + '–';
        return lo + (cap.max === Infinity ? '∞' : cap.max);
    };

    /** The six numbers behind one displayed stat, including its ceiling. */
    P.decompose = function (actor, id) {
        return $.safe(function () {
            var manual = manualOf(actor, id);
            var plus = actor.paramPlus(id);
            var rate = actor.paramRate(id) * actor.paramBuffRate(id);
            var cap = P.paramCap(actor, id);
            var final = actor.param(id);
            // What the parameter WOULD be with no ceiling. paramBasePlus is
            // MZ's floor-at-zero step and does not exist on MV, so it is
            // feature-detected rather than reimplemented — the point of this
            // number is to be the engine's own arithmetic minus the clamp.
            var basePlus = (typeof actor.paramBasePlus === 'function')
                ? actor.paramBasePlus(id)
                : (actor.paramBase(id) + plus);
            return {
                base: actor.paramBase(id),
                manual: manual,
                other: plus - manual,      // equipment plus anything else that alters paramPlus
                rate: rate,
                min: cap.min, max: cap.max,
                uncapped: Math.round(basePlus * rate),
                // At the ceiling, every further point of "manual" is discarded
                // on the next read. That is worth marking, not just showing.
                atCap: cap.max !== null && final >= cap.max,
                final: final
            };
        }, 'decompose p' + id,
            { base: 0, manual: 0, other: 0, rate: 1, min: null, max: null, uncapped: 0, atCap: false, final: 0 });
    };

    /* The most recent parameter/level write a ceiling refused, so the panel can
       offer to raise THAT ceiling rather than making the user guess. */
    P.lastResult = null;

    /**
     * Move the manual offset — the only durable parameter write there is.
     *
     * addParam rather than a direct _paramPlus write: it is the engine's own
     * public path and it calls refresh(), which re-clamps HP and MP against a
     * maximum that may have just moved. A direct write leaves an actor sitting
     * above a maximum that no longer exists until something else refreshes.
     */
    P.setManual = function (actor, id, value) {
        if (!$.allowWrite('Changing ' + P.paramName(id))) return { ok: false, blocked: true };
        var before = manualOf(actor, id);
        var want = Math.floor(value);
        var r = verify('party.param',
            function () {
                $.safe(function () { actor.addParam(id, want - manualOf(actor, id)); }, 'addParam');
            },
            function () { return manualOf(actor, id); },
            want);
        var after = manualOf(actor, id);
        if (after !== before) {
            $.undo.push(actor.name() + ' ' + P.paramName(id) + ' bonus ' + before + ' → ' + after, function () {
                $.safe(function () { actor.addParam(id, before - manualOf(actor, id)); }, 'undo addParam');
            });
        }
        var d = P.decompose(actor, id);
        if (r.ok) {
            $.log('ok', actor.name() + ' ' + P.paramName(id) + ' bonus: ' + before + ' → ' + after +
                (d.atCap ? ' — but ' + P.paramName(id) + ' is at this game\'s ceiling of ' + d.max +
                    ', so the extra is discarded on every read.' : ''));
        } else {
            $.log('warn', actor.name() + ' ' + P.paramName(id) + ' bonus did not stick. ' + r.message);
        }
        var out = {
            kind: 'param', ok: r.ok, before: before, after: after, want: want,
            cap: d.max, atCap: d.atCap, uncapped: d.uncapped, actor: actor, id: id, message: r.message
        };
        P.lastResult = out;
        return out;
    };

    /**
     * Solve for the manual offset that lands param(id) on `target`.
     *
     * param() rounds, applies a trait rate and clamps, so this inverts the
     * formula once and then converges by measurement — cheaper and far more
     * reliable than trusting the algebra against however many plugins have
     * aliased paramPlus.
     *
     * A target above the ceiling is refused BEFORE any of that: no value of
     * _paramPlus can produce it, so a loop would spend six probes proving it
     * and then report a number nobody asked for. The panel offers to raise the
     * ceiling instead.
     */
    P.setTarget = function (actor, id, target) {
        if (!$.allowWrite('Setting ' + P.paramName(id))) return { ok: false, blocked: true };
        var cap = P.paramCap(actor, id);
        var want = Math.floor(target);

        if (cap.max !== null && want > cap.max) {
            var refused = {
                kind: 'param', ok: false, capped: true, want: want, cap: cap.max,
                actor: actor, id: id, after: $.safe(function () { return actor.param(id); }, 'param', 0),
                message: P.paramName(id) + ' is capped at ' + cap.max + ' on this game. param() re-clamps ' +
                    'on every read, so no write can put ' + want + ' there until the ceiling moves.'
            };
            $.log('warn', actor.name() + ' ' + refused.message);
            P.lastResult = refused;
            return refused;
        }

        var before = manualOf(actor, id);
        var solved = $.safe(function () {
            var d = P.decompose(actor, id);
            var rate = d.rate || 1;
            var best = null, bestErr = Infinity;

            function probe(plus) {
                // addParam, not a raw _paramPlus write: it refreshes, which is
                // what makes the next param() read meaningful.
                actor.addParam(id, plus - manualOf(actor, id));
                var got = actor.param(id);
                var err = Math.abs(got - want);
                // Keep the closest candidate. With a fractional trait rate the
                // exact target is often unreachable with an integer offset, and
                // a naive loop oscillates between the two neighbours and stops
                // on whichever one it happened to be holding.
                if (err < bestErr) { bestErr = err; best = plus; }
                return got;
            }

            probe(Math.round(want / rate - d.base - d.other));
            for (var i = 0; i < 6 && bestErr > 0; i++) {
                var diff = want - actor.param(id);
                var step = diff / rate;
                var next = manualOf(actor, id) +
                    (step > 0 ? Math.max(1, Math.round(step)) : Math.min(-1, Math.round(step)));
                probe(next);
            }
            return best;
        }, 'setTarget solve', null);

        if (solved === null) {
            $.safe(function () { actor.addParam(id, before - manualOf(actor, id)); }, 'restore paramPlus');
            P.lastResult = { kind: 'param', ok: false, want: want, actor: actor, id: id, message: 'the solve threw' };
            return P.lastResult;
        }

        // The solve leaves the actor holding its last probe, which is not
        // necessarily the best one. Applying the winner IS the real write, so
        // that is the one that goes through verify and gets read back.
        var r = verify('party.param',
            function () {
                $.safe(function () { actor.addParam(id, solved - manualOf(actor, id)); }, 'settle paramPlus');
            },
            function () { return $.safe(function () { return actor.param(id); }, 'param', null); },
            want);
        var settled = $.safe(function () { return actor.param(id); }, 'param', 0);

        if (manualOf(actor, id) !== before) {
            $.undo.push(actor.name() + ' ' + P.paramName(id) + ' → ' + settled, function () {
                $.safe(function () { actor.addParam(id, before - manualOf(actor, id)); }, 'undo setTarget');
            });
        }
        if (settled !== want) {
            $.log('warn', actor.name() + ' ' + P.paramName(id) + ': asked for ' + want + ', settled on ' +
                settled + '. A trait rate cannot always land on an exact number with an integer offset, ' +
                'and the value is re-clamped to ' + P.capText(cap) + ' on every read.');
        } else {
            $.log('ok', actor.name() + ' ' + P.paramName(id) + ' = ' + settled);
        }
        var out = {
            kind: 'param', ok: r.ok && settled === want, capped: false, want: want, got: settled,
            cap: cap.max, actor: actor, id: id, message: r.message
        };
        P.lastResult = out;
        return out;
    };

    /* ---------------------------------------------------- raising the cap
       paramMax is hooked wherever it is actually DEFINED. A framework commonly
       defines it on a subclass, which shadows the base method entirely, so
       hooking only Game_BattlerBase would raise nothing and look like a broken
       control. The hook composes rather than competes: with the raise off it
       returns exactly what the game returns, and with it on it returns the
       LARGER of the two — a game whose own ceiling is higher keeps it, and
       nothing is ever lowered by GigaHack being installed.
       ------------------------------------------------------------------ */
    function capOwners() {
        return [
            ['Game_BattlerBase', typeof Game_BattlerBase !== 'undefined' ? Game_BattlerBase : null],
            ['Game_Actor', typeof Game_Actor !== 'undefined' ? Game_Actor : null],
            ['Game_Enemy', typeof Game_Enemy !== 'undefined' ? Game_Enemy : null]
        ];
    }

    var capHooks = [];

    capOwners().forEach(function (pair) {
        var klass = pair[1];
        if (!klass || !klass.prototype) return;
        // Only where the method is OWN, never inherited: hooking an inherited
        // one would install a second copy on the subclass and apply twice.
        if (!Object.prototype.hasOwnProperty.call(klass.prototype, 'paramMax')) return;
        var label = pair[0] + '.paramMax';
        var ok = $.install(label, klass.prototype, 'paramMax', function (original) {
            return function (paramId) {
                var mine = original.apply(this, arguments);
                var cfg = $.cfg.party || {};
                if (!cfg.paramMaxOverride) return mine;
                var want = Number(cfg.paramMax) || 0;
                return (typeof mine === 'number' && mine > want) ? mine : want;
            };
        }, pair[0] + '.paramMax is not defined on this game');
        if (ok) capHooks.push(label);
    });

    /** '' when raising works; otherwise the reason, in the user's terms. */
    P.capWhy = function () {
        if (!capHooks.length) {
            return 'no paramMax was found to hook, so parameter ceilings cannot be raised on this game.';
        }
        var replaced = [], shadow = [];
        capHooks.forEach(function (label) {
            var hk = $.hooks[label];
            if (hk && hk.installed && hk.owner && hk.owner[hk.method] !== hk.patched) replaced.push(label);
        });
        capOwners().forEach(function (pair) {
            var klass = pair[1];
            if (!klass || !klass.prototype) return;
            if (capHooks.indexOf(pair[0] + '.paramMax') > -1) return;
            if (Object.prototype.hasOwnProperty.call(klass.prototype, 'paramMax')) shadow.push(pair[0]);
        });
        if (replaced.length) {
            return replaced.join(', ') + ' is no longer the function GigaHack installed — a plugin that ' +
                'loads after GigaHack replaced it, so the raise never runs. Re-run the installer so the ' +
                'GigaHack entry is last in js/plugins.js.';
        }
        if (shadow.length) {
            return shadow.join(' and ') + ' defines its own paramMax, which shadows the one GigaHack ' +
                'raised — that ceiling is still in force for those battlers. It was defined after ' +
                'GigaHack loaded; moving the GigaHack entry to the end of js/plugins.js fixes it.';
        }
        return '';
    };
    P.capAvailable = function () { return capHooks.length > 0 && !P.capWhy(); };

    P.raiseParamCap = function (n) {
        if (!$.allowWrite('Raising the parameter ceiling')) return { ok: false, why: 'read-only' };
        var want = Math.max(1, Math.floor(n));
        var sample = P.selected();
        var before = sample ? P.paramCap(sample, 2).max : null;
        $.store.cfgSet('party.paramMax', want);
        $.store.cfgSet('party.paramMaxOverride', true);
        var after = sample ? P.paramCap(sample, 2).max : null;
        var ok = after !== null && after >= want;
        $.log(ok ? 'ok' : 'warn', 'parameter ceiling: ' + before + ' → ' + after +
            (ok ? ' (this session only — it lives in GigaHack\'s settings, not in the save)'
                : ' — the ceiling did not move. ' + P.capWhy()));
        return { ok: ok, before: before, cap: after, want: want };
    };

    /** An actor with inflated params restores to clean values. */
    P.resetParams = function (actor) {
        if (!$.allowWrite('Resetting ' + actor.name() + "'s params")) return false;
        var before = ((actor._paramPlus || []).slice)
            ? actor._paramPlus.slice() : [0, 0, 0, 0, 0, 0, 0, 0];
        $.safe(function () { actor.clearParamPlus(); actor.refresh(); }, 'clearParamPlus');
        $.undo.push(actor.name() + ' param bonuses restored', function () {
            // addParam per parameter rather than writing the array: it is the
            // public path and it refreshes, so a restored maximum is applied
            // to the actor's current HP and MP straight away.
            $.safe(function () {
                for (var i = 0; i < PARAM_N; i++) actor.addParam(i, (before[i] || 0) - manualOf(actor, i));
            }, 'undo resetParams');
        });
        $.log('ok', actor.name() + ': manual param bonuses cleared. Equipment and any plugin that ' +
            'contributes through paramPlus are untouched — see the "other" column for what is left.');
        return true;
    };

    /* -------------------------------------------------------- level and exp
       maxLevel() is READ, never assumed to be 99. A setup that reports 0 there
       means "no cap" — and the engine's own changeLevel clamps to it, which
       would clamp EVERY level to 0. So an uncapped game is levelled by writing
       the exp for the level instead, which asks for the same thing without
       going through that clamp.
       ------------------------------------------------------------------ */
    P.maxLevel = function (actor) {
        var n = $.safe(function () { return actor.maxLevel(); }, 'maxLevel', 99);
        if (typeof n !== 'number' || !isFinite(n) || n <= 0) {
            return { cap: null, uncapped: true, raw: n };
        }
        return { cap: n, uncapped: false, raw: n };
    };

    P.setLevel = function (actor, level) {
        if (!$.allowWrite('Changing level')) return { ok: false, blocked: true };
        var ml = P.maxLevel(actor);
        var want = Math.max(1, Math.floor(level));

        if (!ml.uncapped && want > ml.cap) {
            var refused = {
                kind: 'level', ok: false, capped: true, want: want, cap: ml.cap, actor: actor,
                after: actor.level,
                why: actor.name() + ' is capped at level ' + ml.cap + ' on this game, and changeLevel ' +
                    'clamps to that cap — so level ' + want + ' cannot be written until the cap moves.'
            };
            refused.message = refused.why;
            $.log('warn', refused.why);
            P.lastResult = refused;
            return refused;
        }

        var before = actor.level;
        var beforeExp = $.safe(function () { return actor.currentExp(); }, 'currentExp', null);
        var r = verify('party.exp',
            function () {
                $.safe(function () {
                    // changeLevel clamps to maxLevel(), so on a game reporting
                    // no cap it would clamp every level down to that number.
                    // Writing the exp for the level asks for the same thing
                    // without going through the clamp.
                    if (ml.uncapped) actor.changeExp(actor.expForLevel(want), false);
                    else actor.changeLevel(want, false);
                }, 'set level');
            },
            function () { return actor.level; },
            want);

        if (!r.ok && ml.uncapped) {
            /* The engine's level-up loop tests level >= maxLevel(), so a
               maxLevel of 0 means it never runs: neither path can move the
               level, and the exp write that just happened would leave exp and
               level disagreeing. Put it back and say what would work. */
            if (beforeExp !== null) $.safe(function () { actor.changeExp(beforeExp, false); }, 'restore exp');
            var stuck = {
                kind: 'level', ok: false, capped: true, want: want, cap: ml.raw, actor: actor,
                after: actor.level, uncapped: true,
                why: 'this game reports a maximum level of ' + ml.raw + ' for ' + actor.name() +
                    '. The engine treats that as "already at maximum" — its level-up loop tests ' +
                    'level against maxLevel() — so neither writing EXP nor changeLevel can move the ' +
                    'level, and changeLevel would clamp it to ' + ml.raw + ' outright. Levels are ' +
                    'managed outside the engine\'s own path here; setting a real cap on the actor\'s ' +
                    'database row puts this control back in play.'
            };
            stuck.message = stuck.why;
            $.log('warn', stuck.why);
            P.lastResult = stuck;
            return stuck;
        }

        if (actor.level !== before) {
            $.undo.push(actor.name() + ' level ' + before + ' → ' + actor.level, function () {
                $.safe(function () {
                    if (ml.uncapped) actor.changeExp(actor.expForLevel(before), false);
                    else actor.changeLevel(before, false);
                }, 'undo level');
            });
        }
        $.log(r.ok ? 'ok' : 'warn', actor.name() + ' level: ' + before + ' → ' + actor.level +
            (r.ok ? (ml.uncapped ? ' (this game reports no level cap, so the level was set by writing exp)' : '')
                  : ' — asked for ' + want + '. ' + r.message));
        P.lastResult = {
            kind: 'level', ok: r.ok, before: before, after: actor.level, want: want,
            cap: ml.cap, actor: actor, message: r.message
        };
        return P.lastResult;
    };

    /**
     * The level ceiling lives on the actor's own database row and maxLevel()
     * reads it live, so writing it takes effect on the very next call — the
     * same mechanism as a per-item stack field. The actor database is rebuilt
     * from the project files at every launch and is not part of a save, so
     * this lasts for the session and the panel says so.
     */
    P.raiseLevelCap = function (actor, n) {
        if (!$.allowWrite('Raising the level cap')) return { ok: false, why: 'read-only' };
        var db = P.dbActor(actor);
        if (!db) {
            return {
                ok: false,
                why: 'this actor has no row in the actor database, so there is no level cap to raise.'
            };
        }
        var want = Math.max(1, Math.floor(n));
        var before = P.maxLevel(actor);
        $.safe(function () { db.maxLevel = want; }, 'raise level cap');
        var after = P.maxLevel(actor);
        var ok = after.uncapped || (after.cap !== null && after.cap >= want);
        $.log(ok ? 'ok' : 'warn', actor.name() + ' level cap: ' + before.raw + ' → ' + after.raw +
            (ok ? ' (this session only — the database is rebuilt at every launch)'
                : ' — maxLevel() did not follow the database row, so something is computing it instead.'));
        return { ok: ok, before: before.cap, cap: after.cap, want: want };
    };

    /**
     * EXP within the current class.
     *
     * changeExp is the public path: it levels the actor up or down to match,
     * and recomputes everything derived from the level. Writing _exp directly
     * leaves level and exp disagreeing, which shows up much later as an actor
     * who cannot level again.
     */
    P.setExp = function (actor, exp) {
        if (!$.allowWrite('Changing EXP')) return { ok: false, blocked: true };
        var before = $.safe(function () { return actor.currentExp(); }, 'currentExp', 0);
        var want = Math.max(0, Math.floor(exp));
        var r = verify('party.exp',
            function () { $.safe(function () { actor.changeExp(want, false); }, 'changeExp'); },
            function () { return $.safe(function () { return actor.currentExp(); }, 'currentExp', null); },
            want);
        var after = $.safe(function () { return actor.currentExp(); }, 'currentExp', 0);
        if (after !== before) {
            $.undo.push(actor.name() + ' exp ' + before + ' → ' + after, function () {
                $.safe(function () { actor.changeExp(before, false); }, 'undo changeExp');
            });
        }
        $.log(r.ok ? 'ok' : 'warn', actor.name() + ' exp: ' + before + ' → ' + after +
            (r.ok ? ' (level ' + actor.level + ')'
                  : ' — asked for ' + want + '. ' + r.message + ' A level cap holds exp down too: ' +
                    'the engine stops adding levels at maxLevel and some setups clamp the exp with it.'));
        P.lastResult = {
            kind: 'exp', ok: r.ok, before: before, after: after, want: want, actor: actor, message: r.message
        };
        return P.lastResult;
    };

    P.setVital = function (actor, which, v) {
        if (!$.allowWrite('Changing ' + which.toUpperCase())) return false;
        var get = { hp: 'hp', mp: 'mp', tp: 'tp' }[which];
        var before = actor[get];
        $.safe(function () {
            if (which === 'hp') actor.setHp(v);
            else if (which === 'mp') actor.setMp(v);
            else actor.setTp(v);
        }, 'set ' + which);
        $.undo.push(actor.name() + ' ' + which + ' ' + before + ' → ' + actor[get], function () {
            if (which === 'hp') actor.setHp(before);
            else if (which === 'mp') actor.setMp(before);
            else actor.setTp(before);
        });
        return true;
    };

    P.heal = function (actor) {
        if (!$.allowWrite('Healing ' + actor.name())) return false;
        $.safe(function () { actor.recoverAll(); }, 'recoverAll');
        $.log('ok', actor.name() + ' fully healed');
        return true;
    };

    P.healAll = function () {
        if (!$.allowWrite('Healing the party')) return false;
        P.members().forEach(function (a) { $.safe(function () { a.recoverAll(); }, 'recoverAll'); });
        $.log('ok', 'party fully healed');
        return true;
    };

    P.revive = function (actor) {
        if (!$.allowWrite('Reviving ' + actor.name())) return false;
        $.safe(function () {
            var death = actor.deathStateId ? actor.deathStateId() : 1;
            actor.removeState(death);
            if (actor.hp <= 0) actor.setHp(actor.mhp);
        }, 'revive');
        $.log('ok', actor.name() + ' revived');
        return true;
    };

    P.addState = function (actor, stateId) {
        if (!$.allowWrite('Applying a state')) return false;
        var name = $.safe(function () { return $dataStates[stateId].name; }, 'state name', '#' + stateId);
        $.safe(function () { actor.addState(stateId); }, 'addState');
        var took = $.safe(function () { return actor.isStateAffected(stateId); }, 'isStateAffected', false);
        if (!took) {
            $.log('warn', actor.name() + ' resisted "' + name + '" (immune, sealed, or already dead)');
            U.toast({ title: 'RESISTED', msg: actor.name() + ' would not take "' + name + '"', severity: 'warn' });
            return false;
        }
        $.undo.push(actor.name() + ' + state "' + name + '"', function () { actor.removeState(stateId); });
        $.log('ok', actor.name() + ' + "' + name + '"');
        return true;
    };

    P.removeState = function (actor, stateId) {
        if (!$.allowWrite('Removing a state')) return false;
        $.safe(function () { actor.removeState(stateId); }, 'removeState');
        $.undo.push(actor.name() + ' − state #' + stateId, function () { actor.addState(stateId); });
        return true;
    };

    P.clearStates = function (actor) {
        if (!$.allowWrite('Clearing states')) return false;
        $.safe(function () { actor.clearStates(); actor.refresh(); }, 'clearStates');
        $.log('ok', actor.name() + ': states cleared');
        return true;
    };

    P.setSkill = function (actor, skillId, learn) {
        if (!$.allowWrite((learn ? 'Learning' : 'Forgetting') + ' a skill')) return false;
        var name = $.safe(function () { return $dataSkills[skillId].name; }, 'skill name', '#' + skillId);
        $.safe(function () { if (learn) actor.learnSkill(skillId); else actor.forgetSkill(skillId); }, 'skill');
        $.undo.push(actor.name() + (learn ? ' learned ' : ' forgot ') + '"' + name + '"', function () {
            if (learn) actor.forgetSkill(skillId); else actor.learnSkill(skillId);
        });
        $.log('ok', actor.name() + (learn ? ' learned ' : ' forgot ') + '"' + name + '"');
        return true;
    };

    P.changeClass = function (actor, classId, keepExp) {
        // Irreversible in practice — changeClass rebuilds level and skills from
        // the new class curve, so it is marked as such in the UI rather than
        // pretending an undo entry would restore the actor.
        if (!$.allowWrite('Changing class')) return false;
        var name = $.safe(function () { return $dataClasses[classId].name; }, 'class name', '#' + classId);
        $.safe(function () { actor.changeClass(classId, !!keepExp); }, 'changeClass');
        $.log('warn', actor.name() + ' → class "' + name + '" (irreversible)');
        return true;
    };

    /** forceChangeEquip, not changeEquip: the latter requires the party to own
     *  the item and silently no-ops otherwise, which reads as a broken button. */
    P.equip = function (actor, slotId, item) {
        if (!$.allowWrite('Changing equipment')) return false;
        var before = $.safe(function () { return actor.equips()[slotId]; }, 'equips', null);
        $.safe(function () { actor.forceChangeEquip(slotId, item); }, 'forceChangeEquip');
        $.undo.push(actor.name() + ' slot ' + slotId + ' → ' + (item ? item.name : 'empty'), function () {
            actor.forceChangeEquip(slotId, before);
        });
        $.log('ok', actor.name() + ' slot ' + slotId + ': ' + (item ? item.name : 'empty'));
        return true;
    };

    /* ---------------------------------------------------------- followers
       Game_Followers exposes its members differently on the two engines: one
       has forEach()/reverseEach(), the other has data()/reverseData()/
       follower(i). BOTH shapes are feature-detected here, and neither is
       assumed to be absent — an earlier version asserted that forEach could
       not exist, which is true on exactly one of the two engines.

       Always returns a plain array, so no caller has to learn which shape it
       is standing on.
       ------------------------------------------------------------------ */
    P.followers = function () {
        return $.safe(function () {
            if (typeof $gamePlayer === 'undefined' || !$gamePlayer || !$gamePlayer.followers) return [];
            var fs = $gamePlayer.followers();
            if (!fs) return [];
            var out = [];
            if (typeof fs.data === 'function') {
                (fs.data() || []).forEach(function (f) { if (f) out.push(f); });
                return out;
            }
            if (typeof fs.forEach === 'function') {
                fs.forEach(function (f) { if (f) out.push(f); });
                return out;
            }
            if (typeof fs.follower === 'function') {
                var n = $.safe(function () { return $gameParty.maxBattleMembers(); }, 'maxBattleMembers', 4) || 4;
                for (var i = 0; i < n; i++) { var f = fs.follower(i); if (f) out.push(f); }
                return out;
            }
            if (fs._data && fs._data.length) {
                fs._data.forEach(function (f) { if (f) out.push(f); });
            }
            return out;
        }, 'followers', []) || [];
    };

    /** What the map is actually drawing behind the player, and for whom. */
    P.followerReport = function () {
        var list = P.followers();
        return list.map(function (f, i) {
            var actor = $.safe(function () { return f.actor(); }, 'follower actor', null);
            return {
                index: i,
                name: actor ? actor.name() : '(none)',
                visible: $.safe(function () { return f.isVisible ? f.isVisible() : !f.isTransparent(); },
                    'follower visible', true)
            };
        });
    };

    /* The map's follower line-up is rebuilt from the party, but only when the
       player is refreshed. Without this the conga line keeps showing the actor
       who just left until something else happens to refresh it, which reads as
       "removing them did not work". */
    function refreshFollowers() {
        $.safe(function () {
            if (typeof $gamePlayer !== 'undefined' && $gamePlayer && $gamePlayer.refresh) $gamePlayer.refresh();
        }, 'refresh followers');
    }

    P.addMember = function (actorId) {
        if (!$.allowWrite('Adding a party member')) return false;
        $.safe(function () { $gameParty.addActor(actorId); }, 'addActor');
        refreshFollowers();
        $.undo.push('party + actor ' + actorId, function () {
            $gameParty.removeActor(actorId); refreshFollowers();
        });
        return true;
    };
    P.removeMember = function (actorId) {
        if (!$.allowWrite('Removing a party member')) return false;
        $.safe(function () { $gameParty.removeActor(actorId); }, 'removeActor');
        refreshFollowers();
        $.undo.push('party − actor ' + actorId, function () {
            $gameParty.addActor(actorId); refreshFollowers();
        });
        return true;
    };

    /* =====================================================================
       PART 2 — TAB
       ===================================================================== */
    var ROW_H = 17;

    function actorList(onPick) {
        var sel = P.selected();
        var rows = P.members().map(function (a) {
            var on = sel && a.actorId() === sel.actorId();
            var row = h('button', { class: 'mm-tree-row' + (on ? ' mm-on' : '') },
                h('i', { class: 'mm-dotmark', style: 'background:' + (a.isDead() ? 'var(--mm-danger)' : 'var(--mm-ok)') }),
                h('span', { style: 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis', text: a.name() }),
                h('span', { class: 'mm-sub mm-mono', text: 'L' + a.level }));
            row.addEventListener('click', function () { P.select(a); onPick(); });
            return row;
        });
        if (!rows.length) rows = [h('div', { class: 'mm-empty', text: 'party is empty' })];
        return W.group('Party', rows, { tag: P.members().length + '' });
    }

    function membership() {
        var candidates = $.safe(function () {
            var inParty = {};
            P.members().forEach(function (a) { inParty[a.actorId()] = 1; });
            return $dataActors.filter(function (a) { return a && a.name && !inParty[a.id]; })
                .map(function (a) { return a.id + ' · ' + a.name; });
        }, 'actor candidates', []) || [];

        var pick = candidates.length ? candidates[0] : null;
        return W.group('Membership', [
            candidates.length ? W.row('Add', W.dropdown({
                options: candidates, value: pick, width: '112px', _ungated: true,
                onChange: function (v) { pick = v; }
            })) : h('div', { class: 'mm-empty', text: 'every actor is in the party' }),
            candidates.length ? W.button({
                label: 'add to party', wide: true, mutates: true,
                onClick: function () {
                    if (!pick) return;
                    P.addMember(parseInt(pick, 10));
                    U.rerender();
                }
            }) : null,
            h('div', { class: 'mm-sep' }),
            P.members().length > 1 ? W.button({
                label: 'remove selected', wide: true, variant: 'danger', mutates: true,
                onClick: function () {
                    var a = P.selected();
                    if (!a) return;
                    P.removeMember(a.actorId());
                    U.rerender();
                }
            }) : h('div', { class: 'mm-sub', style: 'padding:2px', text: 'last member cannot be removed here' }),
            h('div', { class: 'mm-sep' }),
            // Proof the change reached the map: the follower line-up is read
            // back through the adapter, whichever shape this engine's
            // Game_Followers has.
            h('div', { class: 'mm-row', 'data-mm-tip': 'Followers|Read back from Game_Followers after every ' +
                'membership change, so a line-up that did not update is visible here rather than only on the map.' },
                h('div', { class: 'mm-lab', text: 'On the map' }),
                h('div', {
                    class: 'mm-edge mm-mono mm-sub',
                    text: (function () {
                        var f = P.followerReport();
                        if (!f.length) return 'no followers';
                        return f.map(function (x) { return x.name + (x.visible ? '' : ' (hidden)'); }).join(', ');
                    }())
                }))
        ], { tag: candidates.length + ' available', collapsed: true });
    }


    /* =====================================================================
       PART 1b — IDENTITY
       Name, nickname, profile and the four image slots. All four images are
       stored on the actor and therefore in the SAVE, which is why every one of
       them has a "back to the database" next to it: an actor wearing a sprite
       that no longer exists renders as a blank square with no clue why.
       ===================================================================== */

    /** The database record behind an actor, or null if it has gone. */
    P.dbActor = function (actor) {
        if (!actor) return null;
        return $.safe(function () { return $dataActors[actor.actorId()] || null; }, 'dbActor', null);
    };

    P.identity = function (actor) {
        if (!actor) return null;
        return $.safe(function () {
            return {
                name: actor.name(),
                nickname: actor.nickname(),
                profile: actor.profile(),
                faceName: actor._faceName, faceIndex: actor._faceIndex,
                characterName: actor._characterName, characterIndex: actor._characterIndex,
                battlerName: actor._battlerName
            };
        }, 'identity', null);
    };

    /**
     * setName and friends exist on Game_Actor in MZ, and are what the engine's
     * own "Change Name" event command calls — so nothing here reaches past the
     * public surface into the private fields.
     */
    P.setName = function (actor, v) {
        if (!actor || !$.allowWrite('actor name')) return false;
        return $.safe(function () {
            actor.setName(String(v == null ? '' : v));
            $.log('info', 'actor ' + actor.actorId() + ' renamed to "' + actor.name() + '"');
            return true;
        }, 'set name', false);
    };

    P.setNickname = function (actor, v) {
        if (!actor || !$.allowWrite('actor nickname')) return false;
        return $.safe(function () { actor.setNickname(String(v == null ? '' : v)); return true; }, 'set nickname', false);
    };

    P.setProfile = function (actor, v) {
        if (!actor || !$.allowWrite('actor profile')) return false;
        return $.safe(function () { actor.setProfile(String(v == null ? '' : v)); return true; }, 'set profile', false);
    };

    /**
     * Image slots.
     *
     * The character sprite needs $gamePlayer.refresh() afterwards or the map
     * keeps drawing the old one until something else happens to refresh it —
     * which reads as "the setting did not take". The face and the battler are
     * re-read when their window next draws, so they need nothing.
     */
    P.setFace = function (actor, name, index) {
        if (!actor || !$.allowWrite('actor face')) return false;
        return $.safe(function () {
            actor.setFaceImage(String(name == null ? '' : name), $.clamp(Math.round(index) || 0, 0, 7));
            return true;
        }, 'set face', false);
    };

    P.setSprite = function (actor, name, index) {
        if (!actor || !$.allowWrite('actor sprite')) return false;
        return $.safe(function () {
            actor.setCharacterImage(String(name == null ? '' : name), $.clamp(Math.round(index) || 0, 0, 7));
            if (typeof $gamePlayer !== 'undefined' && $gamePlayer && $gamePlayer.refresh) $gamePlayer.refresh();
            return true;
        }, 'set sprite', false);
    };

    P.setBattler = function (actor, name) {
        if (!actor || !$.allowWrite('actor battler')) return false;
        if (typeof Game_Actor === 'undefined' || !Game_Actor.prototype.setBattlerImage) return false;
        return $.safe(function () { actor.setBattlerImage(String(name == null ? '' : name)); return true; }, 'set battler', false);
    };

    /** Put every identity field back to what the database says. */
    P.resetIdentity = function (actor) {
        var db = P.dbActor(actor);
        if (!actor || !db || !$.allowWrite('reset actor identity')) return false;
        return $.safe(function () {
            actor.setName(db.name || '');
            actor.setNickname(db.nickname || '');
            actor.setProfile(db.profile || '');
            actor.setFaceImage(db.faceName || '', db.faceIndex || 0);
            actor.setCharacterImage(db.characterName || '', db.characterIndex || 0);
            if (actor.setBattlerImage) actor.setBattlerImage(db.battlerName || '');
            if (typeof $gamePlayer !== 'undefined' && $gamePlayer && $gamePlayer.refresh) $gamePlayer.refresh();
            $.log('ok', 'actor ' + actor.actorId() + ' identity reset to the database');
            return true;
        }, 'reset identity', false);
    };

    /**
     * Image files on disk, so the two name fields can be a list rather than a
     * spelling test. Degrades to an empty list without a filesystem, and the
     * panel falls back to a free-text field when it is empty — a name typed by
     * hand still works, which is the point.
     */
    var imgCache = {};
    P.images = function (folder, fresh) {
        if (!fresh && imgCache[folder]) return imgCache[folder];
        var out = [];
        if ($.paths.mode === 'fs' && $.env.fs && $.env.path && $.paths.gameRoot) {
            out = $.safe(function () {
                var dir = $.env.path.join($.paths.gameRoot, 'img', folder);
                return $.env.fs.readdirSync(dir)
                    .filter(function (n) { return /\.(png|webp)$/i.test(n); })
                    .map(function (n) { return n.replace(/\.(png|webp)$/i, ''); })
                    .sort(function (a, b) {
                        var x = a.toLowerCase(), y = b.toLowerCase();
                        return x < y ? -1 : x > y ? 1 : 0;
                    });
            }, 'scan img/' + folder, []);
        }
        imgCache[folder] = out;
        return out;
    };
    P.clearImageCache = function () { imgCache = {}; };

    /* --------------------------------------------------------- Identity tab */
    /* ------------------------------------------------------- the cap offers
       A ceiling that refused a value is not a failure to hide, and it is not a
       reason to disable the control either. It is a question with an answer:
       raise that ceiling to the number that was asked for, redo the write, and
       read it back. The offer names the ceiling, what it is now and what it
       would become — and where raising cannot work on this game, it says why
       instead of showing a button that would do nothing.
       ------------------------------------------------------------------ */
    var capOffer = null;      // {kind:'param'|'level', actor, id, want, cap}

    function settleParam(r) {
        if (r && r.kind === 'param' && (r.capped || r.atCap)) {
            capOffer = {
                kind: 'param', actor: r.actor, id: r.id, cap: r.cap,
                // A refused target asks for exactly what it asked for; a bonus
                // that landed on the ceiling asks for what it WOULD have been.
                want: r.capped ? r.want : Math.max(r.uncapped || 0, (r.cap || 0) + 1)
            };
        } else if (r && r.kind === 'level' && r.capped) {
            capOffer = { kind: 'level', actor: r.actor, cap: r.cap, want: r.want, why: r.why || '' };
        } else if (r && r.ok) {
            capOffer = null;
        }
        U.rerender();
    }

    function offerNote(kind) {
        if (!capOffer || capOffer.kind !== kind) return null;
        var o = capOffer;
        var isParam = kind === 'param';
        var can = isParam ? P.capAvailable() : !!P.dbActor(o.actor);
        var why = isParam ? P.capWhy()
            : 'this actor has no row in the actor database, so its level cap cannot be raised.';
        var what = isParam ? P.paramName(o.id) : 'the level';

        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
            h('b', { text: 'the ceiling stopped that. ' }),
            isParam
                ? what + ' is capped at ' + o.cap + ' on this game, and param() is recomputed and ' +
                  're-clamped on every read — so no write puts ' + o.want + ' there until the ceiling moves. '
                // The level path writes its own explanation, because "capped at
                // 0" needs more words than "capped at 99" does.
                : (o.why || (o.actor.name() + ' is capped at level ' + o.cap + ' on this game.')) + ' ',
            W.button({
                label: 'raise the ceiling to ' + o.want + ' and set it', wide: true, mutates: true,
                disabled: !can,
                tip: 'Raise|Session-only. ' + (isParam
                    ? 'Turns on GigaHack\'s own paramMax raise, which never lowers anything, then writes the ' +
                      'value again and reads it back.'
                    : 'Writes the level cap on the actor\'s database row, which maxLevel() reads live, then ' +
                      'sets the level again and reads it back.'),
                onClick: function () {
                    var raised = isParam ? P.raiseParamCap(o.want) : P.raiseLevelCap(o.actor, o.want);
                    var set = isParam ? P.setTarget(o.actor, o.id, o.want) : P.setLevel(o.actor, o.want);
                    capOffer = null;
                    U.toast({
                        title: set.ok ? 'CEILING RAISED' : 'STILL CAPPED',
                        msg: set.ok
                            ? what + ' ceiling ' + o.cap + ' → ' + raised.cap + ', value ' +
                              (isParam ? set.got : set.after)
                            : 'the ceiling did not move — ' + (why || raised.why || set.message),
                        severity: set.ok ? 'ok' : 'warn'
                    });
                    U.rerender();
                }
            }),
            can ? null : h('div', { style: 'padding-top:2px' }, why),
            W.button({
                label: 'leave it', mini: true, _ungated: true,
                onClick: function () { capOffer = null; U.rerender(); }
            }));
    }

    /* --------------------------------------------------------------- Stats */
    function buildStats() {
        var a = P.selected();
        if (!a) return emptyParty();

        var vitals = [
            ['hp', a.hp, a.mhp], ['mp', a.mp, a.mmp],
            ['tp', a.tp, $.safe(function () { return a.maxTp(); }, 'maxTp', 100)]
        ].map(function (v) {
            return W.row(v[0].toUpperCase(), [
                W.number({
                    value: Math.floor(v[1]), min: 0, max: Math.max(1, Math.floor(v[2])), wide: true,
                    label: v[0].toUpperCase(),
                    onChange: function (n) { P.setVital(a, v[0], n); U.rerender(); }
                }),
                h('span', { class: 'mm-sub mm-mono', text: '/ ' + Math.floor(v[2]) })
            ]);
        });

        // Column widths are shared between the header and every body row.
        // A .mm-num with a wide input is 13 + 56 + 13 + 2px border = 84px; the
        // header has to be told that rather than guessing, or the labels drift
        // out of line with the controls they name.
        var COL = { base: 44, manual: 84, other: 44, cap: 78, final: 84 };
        function colSpan(w, text, cls) {
            return h('span', {
                class: cls || 'mm-sub mm-mono',
                style: 'flex:0 0 ' + w + 'px;width:' + w + 'px;text-align:right',
                text: text
            });
        }

        var paramRows = [];
        paramRows.push(h('div', { class: 'mm-row', style: 'min-height:14px' },
            h('div', { class: 'mm-lab mm-sub', text: 'stat' }),
            h('div', { class: 'mm-edge mm-sub mm-mono' },
                colSpan(COL.base, 'base'),
                colSpan(COL.manual, 'manual'),
                colSpan(COL.other, 'other'),
                colSpan(COL.cap, 'clamp'),
                colSpan(COL.final, 'final'))));

        for (var i = 0; i < PARAM_N; i++) (function (id) {
            var d = P.decompose(a, id);
            // No upper bound on either box on purpose: asking for more than the
            // ceiling is how the offer to raise it appears, and a box that
            // silently refused the number would hide the very thing the user
            // needs to be told.
            var manual = W.number({
                value: d.manual, min: -999999, wide: true, label: P.paramName(id),
                onChange: function (v) { settleParam(P.setManual(a, id, v)); }
            });
            var final = W.number({
                value: d.final, min: 0, wide: true, label: P.paramName(id),
                onChange: function (v) { settleParam(P.setTarget(a, id, v)); }
            });
            degradeMark(manual, 'party.param');
            degradeMark(final, 'party.param');
            manual.style.flex = '0 0 ' + COL.manual + 'px';
            final.style.flex = '0 0 ' + COL.final + 'px';

            // The clamp is a row in the decomposition, not a footnote: it is
            // the number that decides whether any of the others matter.
            var capText = P.capText(d);
            var capCell = colSpan(COL.cap, capText, 'mm-sub mm-mono');
            if (d.atCap) {
                capCell.style.color = 'var(--mm-warn)';
                capCell.textContent = capText + ' ●';
            }

            paramRows.push(h('div', {
                class: 'mm-row',
                'data-mm-tip': P.paramName(id) + '|(base ' + d.base + ' + manual ' + d.manual +
                    ' + other ' + d.other + ')' +
                    (Math.abs(d.rate - 1) > 0.001 ? ' × ' + d.rate.toFixed(2) : '') +
                    ' = ' + d.uncapped + ', clamped to ' + capText + ' = ' + d.final +
                    (d.atCap ? '. At the ceiling: every further point is discarded on the next read, ' +
                        'because param() is recomputed and re-clamped every time it is read.' : '')
            },
                h('div', { class: 'mm-lab', text: P.paramName(id) }),
                h('div', { class: 'mm-edge' },
                    colSpan(COL.base, String(d.base)),
                    manual,
                    colSpan(COL.other, (d.other >= 0 ? '+' : '') + d.other),
                    capCell,
                    final)));
        })(i);

        var ml = P.maxLevel(a);
        var lvl = W.number({
            value: a.level, min: 1, max: ml.uncapped ? undefined : ml.cap,
            wide: true, label: 'Level',
            onChange: function (v) { settleParam(P.setLevel(a, v)); }
        });
        degradeMark(lvl, 'party.exp');

        var exp = W.number({
            value: $.safe(function () { return a.currentExp(); }, 'exp', 0), min: 0, wide: true, label: 'EXP',
            onChange: function (v) { settleParam(P.setExp(a, v)); }
        });
        degradeMark(exp, 'party.exp');

        return cols({ narrow: true, items: [actorList(U.rerender), membership()] }, [
            W.group(a.name() + ' · ' + $.safe(function () { return a.currentClass().name; }, 'class', '?'), [
                W.row('Level', lvl, {
                    sub: ml.uncapped ? 'no cap' : 'max ' + ml.cap,
                    tip: 'Level|' + (ml.uncapped
                        ? 'maxLevel() reports ' + ml.raw + ' on this game, which its own setup treats as ' +
                          '"no cap". The engine\'s changeLevel clamps to maxLevel, so it would clamp every ' +
                          'level to that number — GigaHack writes the exp for the level instead.'
                        : 'maxLevel() is ' + ml.cap + ' here, read from the actor rather than assumed. ' +
                          'changeLevel clamps to it, so a higher level cannot be written at all.')
                }),
                W.row('EXP', [
                    exp,
                    h('span', {
                        class: 'mm-sub mm-mono',
                        text: '→ ' + $.safe(function () { return a.isMaxLevel() ? 'max' : a.nextLevelExp(); }, 'next', '?')
                    })
                ], { tip: 'EXP|Written with changeExp, which moves the level to match. Writing the exp field ' +
                        'directly would leave level and exp disagreeing.' }),
                degradeNote('party.exp'),
                offerNote('level'),
                h('div', { class: 'mm-sep' })
            ].concat(vitals).concat([
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({ label: 'heal', mutates: true, onClick: function () { P.heal(a); U.rerender(); } }),
                    W.button({ label: 'revive', mutates: true, onClick: function () { P.revive(a); U.rerender(); } }),
                    W.button({ label: 'heal party', mutates: true, onClick: function () { P.healAll(); U.rerender(); } }))
            ]), { tag: 'actor ' + a.actorId() }),

            W.group('Parameters', paramRows.concat([
                h('div', { class: 'mm-sep' }),
                degradeNote('party.param'),
                offerNote('param'),
                W.button({
                    label: 'reset params to base', wide: true, variant: 'danger', mutates: true,
                    confirmLabel: 'clear manual bonuses?',
                    tip: 'Reset|Clears _paramPlus only. Equipment and anything else contributing through ' +
                        'paramPlus stays — see the "other" column.',
                    onClick: function () { P.resetParams(a); U.rerender(); }
                }),
                W.toggleRow('Raise the ceiling', {
                    value: !!($.cfg.party || {}).paramMaxOverride,
                    _ungated: true,
                    disabled: !P.capAvailable(),
                    sub: (function () {
                        var d0 = P.decompose(a, 2);
                        return d0.max === null ? 'unreadable' : 'now ' + d0.max;
                    }()),
                    tip: 'paramMax|param() re-clamps on every read, so a value above the ceiling is thrown ' +
                        'away no matter how it was written. This raise never lowers anything: it returns the ' +
                        'larger of the game\'s own ceiling and the limit below. Session-only — it lives in ' +
                        'GigaHack\'s settings, not in the save.',
                    onChange: function (v) { $.store.cfgSet('party.paramMaxOverride', v); U.rerender(); }
                }),
                W.row('Ceiling', W.number({
                    value: ($.cfg.party || {}).paramMax || 9999, min: 1, step: 100, wide: true,
                    _ungated: true,
                    disabled: !($.cfg.party || {}).paramMaxOverride || !P.capAvailable(),
                    onChange: function (v) { $.store.cfgSet('party.paramMax', v); }
                })),
                P.capAvailable() ? null : h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: P.capWhy()
                }),
                h('div', {
                    class: 'mm-sub', style: 'padding:2px;white-space:normal',
                    tip: 'Decomposition|"other" is equipment plus anything else that alters paramPlus. ' +
                        'Nothing here can tell you which plugin contributed which part of it — only that ' +
                        'the engine added it and that clearing the manual column will not remove it.'
                }, 'final = clamp((base + manual + other) × rate, clamp)')
            ]), { tag: '_paramPlus + clamp' })
        ]);
    }

    function emptyParty() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'no party yet' }),
                h('div', { text: 'start or load a game, then reopen this tab' })));
    }

    /* -------------------------------------------------------------- Skills */
    function buildSkills() {
        var a = P.selected();
        if (!a) return emptyParty();
        var q = '', learnedOnly = false;

        function rows() {
            return $.safe(function () {
                return $dataSkills.filter(function (s) {
                    if (!s || !s.name) return false;
                    if (learnedOnly && !a.isLearnedSkill(s.id)) return false;
                    if (q && String(s.id).indexOf(q) === -1 && s.name.toLowerCase().indexOf(q) === -1) return false;
                    return true;
                });
            }, 'skill list', []) || [];
        }

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'id', w: '0 0 48px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'known', w: '0 0 54px' }
            ],
            empty: 'no matches',
            render: function (s) {
                return [
                    U.icon(s.iconIndex), String(s.id), h('span', { text: s.name }),
                    W.checkbox({
                        value: a.isLearnedSkill(s.id), label: 'Skill "' + s.name + '"',
                        onChange: function (on) { P.setSkill(a, s.id, on); repaint(); }
                    })
                ];
            },
            onRow: function (tr, s) {
                if (a.isLearnedSkill(s.id)) tr.style.color = 'var(--mm-text-hi)';
                tr.setAttribute('data-mm-tip', s.name + '|' + ((s.description || '').split('\n')[0] || 'no description'));
            }
        });
        function repaint() { table.mm.paint(rows()); }
        repaint();

        var classes = $.safe(function () {
            return $dataClasses.filter(function (c) { return c && c.name; })
                .map(function (c) { return c.id + ' · ' + c.name; });
        }, 'classes', []) || [];
        var pickClass = null;

        return cols({ narrow: true, items: [
            actorList(U.rerender),
            W.group('Class', [
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Current' }),
                    h('div', { class: 'mm-edge mm-mono mm-hi', text: $.safe(function () { return a.currentClass().name; }, 'class', '?') })),
                W.row('Change to', W.dropdown({
                    options: classes, value: classes[0], width: '112px', _ungated: true,
                    onChange: function (v) { pickClass = v; }
                })),
                W.button({
                    label: 'change class', wide: true, variant: 'danger', mutates: true,
                    confirmLabel: 'irreversible — sure?',
                    tip: 'Class change|Rebuilds level and skills from the new class curve. Not undoable — back up the save first.',
                    onClick: function () {
                        var v = pickClass || classes[0];
                        if (!v) return;
                        P.changeClass(a, parseInt(v, 10), true);
                        U.rerender();
                    }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal', text: 'Irreversible — no undo entry.' })
            ], { tag: 'irreversible' })
        ] }, [
            W.group('Skills · ' + a.name(), [
                h('div', { class: 'mm-toolbar' },
                    W.search({ placeholder: 'search skills…', onInput: function (v) { q = v.trim(); repaint(); } }),
                    W.chip({ label: 'known', value: false, onChange: function (v) { learnedOnly = v; repaint(); } })),
                table
            ], { grow: true, tag: $.safe(function () { return a._skills.length + ' learned'; }, 'learned', '') })
        ]);
    }

    /* -------------------------------------------------------------- States */
    function buildStates() {
        var a = P.selected();
        if (!a) return emptyParty();
        var q = '';

        var current = $.safe(function () { return a.states(); }, 'states', []) || [];
        var currentRows = current.length ? current.map(function (s) {
            return W.row(s.name, W.button({
                label: 'remove', mutates: true,
                onClick: function () { P.removeState(a, s.id); U.rerender(); }
            }), { sub: '#' + s.id });
        }) : [h('div', { class: 'mm-empty', text: 'no states' })];

        function rows() {
            return $.safe(function () {
                return $dataStates.filter(function (s) {
                    if (!s || !s.name) return false;
                    if (q && String(s.id).indexOf(q) === -1 && s.name.toLowerCase().indexOf(q) === -1) return false;
                    return true;
                });
            }, 'state list', []) || [];
        }

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'id', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'on', w: '0 0 54px' }
            ],
            empty: 'no matches',
            render: function (s) {
                return [
                    U.icon(s.iconIndex), String(s.id), h('span', { text: s.name }),
                    W.checkbox({
                        value: a.isStateAffected(s.id), label: 'State "' + s.name + '"',
                        onChange: function (on) {
                            if (on) P.addState(a, s.id); else P.removeState(a, s.id);
                            U.rerender();
                        }
                    })
                ];
            },
            onRow: function (tr, s) {
                if (a.isStateAffected(s.id)) tr.style.color = 'var(--mm-text-hi)';
            }
        });
        function repaint() { table.mm.paint(rows()); }
        repaint();

        return cols({ narrow: true, items: [
            actorList(U.rerender),
            W.group('Active', currentRows.concat([
                h('div', { class: 'mm-sep' }),
                W.button({
                    label: 'clear all states', wide: true, variant: 'danger', mutates: true,
                    onClick: function () { P.clearStates(a); U.rerender(); }
                })
            ]), { tag: current.length + '' })
        ] }, [
            W.group('All states', [
                h('div', { class: 'mm-toolbar' },
                    W.search({ placeholder: 'search states…', onInput: function (v) { q = v.trim(); repaint(); } })),
                table,
                h('div', { class: 'mm-sub', style: 'padding:4px 6px;white-space:normal' },
                    'A state the actor resists or has sealed will refuse to apply, with a toast saying so.')
            ], { grow: true })
        ]);
    }

    /* --------------------------------------------------------------- Equip */
    var equipSlot = 0;

    function buildEquip() {
        var a = P.selected();
        if (!a) return emptyParty();
        var q = '';

        var slots = $.safe(function () { return a.equipSlots(); }, 'equipSlots', []) || [];
        var equipped = $.safe(function () { return a.equips(); }, 'equips', []) || [];
        if (equipSlot >= slots.length) equipSlot = 0;

        var slotRows = slots.map(function (etypeId, i) {
            var item = equipped[i];
            var name = $.safe(function () { return $dataSystem.equipTypes[etypeId]; }, 'etype', 'slot') || ('slot ' + i);
            var row = h('button', { class: 'mm-tree-row' + (i === equipSlot ? ' mm-on' : '') },
                U.icon(item ? item.iconIndex : -1),
                h('span', { style: 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis', text: name }),
                h('span', { class: 'mm-sub mm-mono', text: item ? item.name : '—' }));
            row.addEventListener('click', function () { equipSlot = i; U.rerender(); });
            return row;
        });
        if (!slotRows.length) slotRows = [h('div', { class: 'mm-empty', text: 'no equip slots' })];

        var wantType = slots[equipSlot];
        function candidates() {
            return $.safe(function () {
                var pool = [];
                if (wantType === 1) pool = $dataWeapons;
                else pool = $dataArmors;
                return pool.filter(function (o) {
                    if (!o || !o.name) return false;
                    if (o.etypeId !== wantType) return false;
                    if (q && String(o.id).indexOf(q) === -1 && o.name.toLowerCase().indexOf(q) === -1) return false;
                    return true;
                });
            }, 'equip candidates', []) || [];
        }

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'id', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'params', w: '0 0 150px', cls: 'mm-td-num' },
                { label: '', w: '0 0 54px' }
            ],
            empty: 'nothing fits this slot',
            render: function (o) {
                var ps = (o.params || []).map(function (v, i) {
                    return v ? P.paramName(i).slice(0, 3) + (v > 0 ? '+' : '') + v : null;
                }).filter(Boolean).join(' ');
                return [
                    U.icon(o.iconIndex), String(o.id), h('span', { text: o.name }),
                    h('span', { class: 'mm-sub', text: ps || '—' }),
                    W.button({
                        label: 'equip', mini: true, mutates: true,
                        onClick: function () { P.equip(a, equipSlot, o); U.rerender(); }
                    })
                ];
            },
            onRow: function (tr, o) {
                if (equipped[equipSlot] && equipped[equipSlot].id === o.id &&
                    ((wantType === 1) === (o.wtypeId !== undefined))) tr.classList.add('mm-on');
            }
        });
        function repaint() { table.mm.paint(candidates()); }
        repaint();

        return cols({ narrow: true, items: [
            actorList(U.rerender),
            W.group('Slots', slotRows, { tag: slots.length + '' }),
            W.group('Slot actions', [
                W.button({
                    label: 'unequip this slot', wide: true, mutates: true,
                    onClick: function () { P.equip(a, equipSlot, null); U.rerender(); }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'You do not need to own the item, and slot seals are ignored.')
            ])
        ] }, [
            W.group('Fits ' + ($.safe(function () { return $dataSystem.equipTypes[wantType]; }, 'etype', 'slot') || 'slot'), [
                h('div', { class: 'mm-toolbar' },
                    W.search({ placeholder: 'search equipment…', onInput: function (v) { q = v.trim(); repaint(); } })),
                table
            ], { grow: true })
        ]);
    }


    /* ------------------------------------------------------------ Identity */

    /**
     * A name field that is a dropdown when the folder could be read and a free
     * text box when it could not. Both paths write the same string, so a
     * missing filesystem costs discoverability and nothing else.
     */
    function imageField(folder, value, onPick) {
        var files = P.images(folder);
        if (!files.length) {
            return W.text({
                value: value || '', mono: true, width: '150px',
                placeholder: 'img/' + folder + '/…',
                onEnter: onPick
            });
        }
        var opts = ['(none)'].concat(files);
        var cur = value && files.indexOf(value) > -1 ? value : '(none)';
        return W.dropdown({
            options: opts, value: cur, width: '150px', label: folder + ' image',
            onChange: function (v) { onPick(v === '(none)' ? '' : v); }
        });
    }

    function buildIdentity() {
        var a = P.selected();
        if (!a) return emptyParty();
        var id = P.identity(a) || {};
        var db = P.dbActor(a);

        function changed(field, live) {
            if (!db) return false;
            return String(db[field] == null ? '' : db[field]) !== String(live == null ? '' : live);
        }

        function dbTag(field, live) {
            return changed(field, live) ? 'edited' : null;
        }

        var left = [
            actorList(U.rerender),
            W.group('Name', [
                W.row('Name', W.text({
                    value: id.name || '', width: '150px', label: 'actor name',
                    onEnter: function (v) { P.setName(a, v); U.rerender(); }
                }), { sub: dbTag('name', id.name), tip: 'Name|Enter commits. This is the same call the engine’s own ' +
                        '"Change Name" command makes, and it is saved with the game.' }),
                W.row('Nickname', W.text({
                    value: id.nickname || '', width: '150px', label: 'actor nickname',
                    onEnter: function (v) { P.setNickname(a, v); U.rerender(); }
                }), { sub: dbTag('nickname', id.nickname) }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Windows already drawn keep the old text until they refresh.')
            ], { tag: 'actor ' + a.actorId() }),

            W.group('Profile', [
                W.textarea({
                    value: id.profile || '', rows: 3, label: 'actor profile',
                    placeholder: 'two lines, as the status window draws it',
                    onCommit: function (v) { P.setProfile(a, v); }
                }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Committed when the box loses focus. The status window draws two lines; more are stored but not shown.')
            ], { tag: dbTag('profile', id.profile) || 'database' })
        ];

        var right = [
            W.group('Face', [
                W.row('File', imageField('faces', id.faceName, function (v) {
                    P.setFace(a, v, id.faceIndex || 0); U.rerender();
                }), { sub: dbTag('faceName', id.faceName) }),
                W.row('Index', W.number({
                    value: id.faceIndex || 0, min: 0, max: 7, label: 'face index',
                    onChange: function (v) { P.setFace(a, id.faceName || '', v); }
                }), { tip: 'Index|A face sheet is 4 across and 2 down, so 0-7 picks one of the eight.' })
            ], { tag: 'img/faces' }),

            W.group('Map sprite', [
                W.row('File', imageField('characters', id.characterName, function (v) {
                    P.setSprite(a, v, id.characterIndex || 0); U.rerender();
                }), { sub: dbTag('characterName', id.characterName) }),
                W.row('Index', W.number({
                    value: id.characterIndex || 0, min: 0, max: 7, label: 'sprite index',
                    onChange: function (v) { P.setSprite(a, id.characterName || '', v); }
                }), { tip: 'Index|Ignored on a sheet whose name starts with $ — those hold one character.' }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'The player is refreshed straight away, so a change to the lead actor shows on the map now.')
            ], { tag: 'img/characters' }),

            W.group('Battler', [
                W.row('File', imageField('sv_actors', id.battlerName, function (v) {
                    P.setBattler(a, v); U.rerender();
                }), { sub: dbTag('battlerName', id.battlerName) }),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Side-view only. A front-view battle never draws it.')
            ], { tag: 'img/sv_actors', collapsed: true }),

            W.group('Reset', [
                W.button({
                    label: 'back to the database', wide: true, mutates: true,
                    disabled: !db,
                    confirm: true, confirmLabel: 'reset name, nickname, profile and all three images?',
                    onClick: function () { P.resetIdentity(a); U.rerender(); }
                }),
                W.button({
                    label: 'rescan the image folders', wide: true, _ungated: true,
                    onClick: function () { P.clearImageCache(); U.rerender(); }
                }),
                db ? null : h('div', {
                    class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                    text: 'This actor has no row in $dataActors, so there is nothing to reset to.'
                })
            ])
        ];

        return cols(left, right);
    }

    /* -------------------------------------------------------- registration */
    /**
     * Five sub-tabs on the shared Player tab rather than a tab of its own.
     * The alive() guard moves onto each panel: it used to live in the tab's
     * build, and there is no longer one tab to put it in.
     */
    function guarded(fn) {
        return function () { return P.alive() ? fn() : emptyParty(); };
    }
    U.actorPanel('Stats', guarded(buildStats), 20);
    U.actorPanel('Skills', guarded(buildSkills), 30);
    U.actorPanel('States', guarded(buildStates), 40);
    U.actorPanel('Equip', guarded(buildEquip), 50);
    U.actorPanel('Identity', guarded(buildIdentity), 60);

    $.log('ok', 'party ready — parameter ceilings read live, every write verified');

})(window.GigaHack);
