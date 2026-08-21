//=============================================================================
// GigaHack MV/MZ
// 16 · battle.js — survival flags, enemy inspector, combat control
//-----------------------------------------------------------------------------
// THE BATTLE STACK IS THE MOST HEAVILY REPLACED PART OF ANY MODDED GAME, and
// everything in this file is built around that rather than against it.
//
//   · A GAME MAY REPLACE THE END-OF-BATTLE TESTS. So "instant win" does NOT
//     call processVictory(). It kills the troop and lets the game's own
//     checkBattleEnd notice, because that is what awards EXP, gold and drops,
//     triggers whatever autosave the game does on victory, and runs any
//     endBattle work a plugin has added. Forcing the phase would skip every one
//     of those and leave the fight half-finished.
//
//   · A GAME MAY ALIAS processDefeat, so instant lose cannot assume a game
//     over. Dropping the party states the loss and lets the game's own defeat
//     policy decide what that means — which may be a game over, or may be a
//     scripted revive. Nothing here reads a switch or a variable to find out.
//
//   · A GAME MAY MOVE DAMAGE OFF THE PATHS THE SURVIVAL FLAGS GUARD. HP reaches
//     zero by two routes — the ordinary damage funnel through setHp, and an
//     instant-death state that calls die() directly and never touches it — so
//     both are guarded. A cost path that does not go through paySkillCost would
//     still escape the free-cost flag, and a damage path that writes HP without
//     setHp would still escape god mode. That is unknowable from inside the
//     mod, so both are TOGGLES, NOT GUARANTEES, and the panel says so.
//
//   · THE SAME NUMBER IS NOT WRITABLE ON BOTH ENGINES. param() is recomputed
//     and re-clamped on every read, and the two engines ship different
//     ceilings: one has no upper bound in the same place, the other clamps hard
//     at a finite per-parameter maximum. So the enemy parameter controls read
//     the ceiling live, show it, and refuse a value above it with an offer to
//     raise it — rather than writing a number that is discarded on the next
//     read while the panel claims success.
//
//   · THE HP/MP BARS ARE HAND-DRAWN ON PURPOSE. One engine has a gauge sprite
//     class and the other has a window method that paints into a contents
//     bitmap; neither exists on the other, and the sprite one additionally
//     needs window internals the other engine does not have. A single layer of
//     PIXI primitives is the only path that behaves identically on both, and
//     barsPath() reports which engine facilities were found either way. It also
//     survives a renderer that is not WebGL, which one engine can be.
//
// Every mutating control routes its write through $.compat.verify and reports
// which plugin most likely ate it when the read-back disagrees.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — battle tools
 * @author gigahack
 * @help GigaHack_Battle.js — requires Core, Caps, Store, UI, Shell, Hooks,
 * Tabs, Compat, Backup
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab || !$.backup) {
        console.error('[GigaHack] dependency missing — battle not installed');
        if ($ && $.log) $.log('warn', 'battle tools skipped — they need the shell and the backup module');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;
    var B = $.battle = {};

    function cfg() { return $.cfg.battle || {}; }

    /* =====================================================================
       SERVICES
       Compat loads before this module by manifest; a partial install still
       must not throw. The shim has the surface of the real service and
       degrades to the honest answer.

       Control keys used here: `battle.params` for a parameter write, and
       `battle.states` for "did the death state actually take" — a plugin that
       has aliased refresh or the death handling can leave an enemy on zero HP
       and still alive, which turns instant win into a fight that never ends.
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
       own state changed — and the only way to find out is to let the user try
       again. */
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
       PART 1 — STATE
       ===================================================================== */
    B.inBattle = function () {
        return $.safe(function () {
            return typeof $gameParty !== 'undefined' && !!$gameParty && $gameParty.inBattle();
        }, 'in battle', false);
    };

    B.troopAlive = function () {
        return $.safe(function () {
            return typeof $gameTroop !== 'undefined' && !!$gameTroop && !!$gameTroop.members;
        }, 'troop alive', false);
    };

    B.enemies = function () {
        return $.safe(function () { return $gameTroop.members() || []; }, 'enemies', []) || [];
    };

    B.actors = function () {
        return $.safe(function () { return $gameParty.members() || []; }, 'party', []) || [];
    };

    /** Everything the Enemies panel shows. Read-only; nothing here mutates. */
    B.info = function (e) {
        return $.safe(function () {
            var d = e.enemy();
            return {
                index: e.index(), enemyId: e.enemyId(), name: e.name(),
                base: d ? d.name : '?',
                hp: e.hp, mhp: e.mhp, mp: e.mp, mmp: e.mmp, tp: e.tp,
                // isDead() is isAppeared() && isDeathStateAffected(), so a
                // not-yet-appeared enemy is NEITHER alive nor dead. Reporting
                // only those two would draw a hidden second-phase boss as a
                // live combatant at full HP.
                alive: e.isAlive(), dead: e.isDead(), hidden: !e.isAppeared(),
                params: [0, 1, 2, 3, 4, 5, 6, 7].map(function (p) { return e.param(p); }),
                exp: e.exp(), gold: e.gold(),
                states: e.states().filter(Boolean).map(function (s) { return s.name; }),
                note: (d && d.note) || ''
            };
        }, 'enemy info', null);
    };

    /**
     * Element and state rates, but only the ones that are not 100%. A list of
     * thirty "1.00" rows hides the two that matter.
     */
    B.rates = function (e) {
        return $.safe(function () {
            var out = { elements: [], states: [] };
            var names = ($dataSystem && $dataSystem.elements) || [];
            for (var i = 1; i < names.length; i++) {
                if (!names[i]) continue;
                var r = e.elementRate(i);
                if (Math.abs(r - 1) > 0.001) out.elements.push({ name: names[i], rate: r });
            }
            for (var s = 1; s < ($dataStates || []).length; s++) {
                var st = $dataStates[s];
                if (!st || !st.name) continue;
                if (e.isStateResist(s)) { out.states.push({ name: st.name, rate: 0, immune: true }); continue; }
                var sr = e.stateRate(s);
                if (Math.abs(sr - 1) > 0.001) out.states.push({ name: st.name, rate: sr, immune: false });
            }
            out.elements.sort(function (a, b) { return b.rate - a.rate; });
            out.states.sort(function (a, b) { return a.rate - b.rate; });
            return out;
        }, 'rates', { elements: [], states: [] });
    };

    /**
     * Drops with their real odds. `denominator` is what the editor calls
     * "1/N", and Game_Enemy.dropItemRate doubles the effective chance when the
     * party has the Drop Item Double trait — so the number shown is what will
     * actually happen, not what the database says in isolation.
     */
    B.drops = function (e) {
        return $.safe(function () {
            var d = e.enemy();
            if (!d || !d.dropItems) return [];
            var mult = e.dropItemRate();
            var out = [];
            d.dropItems.forEach(function (di) {
                if (!di || di.kind <= 0) return;
                var obj = e.itemObject(di.kind, di.dataId);
                if (!obj) return;
                out.push({
                    name: obj.name, iconIndex: obj.iconIndex,
                    kind: di.kind === 1 ? 'item' : di.kind === 2 ? 'weapon' : 'armor',
                    denominator: di.denominator,
                    chance: Math.min(1, mult / di.denominator),
                    doubled: mult > 1
                });
            });
            return out;
        }, 'drops', []) || [];
    };

    /* =====================================================================
       PART 2 — SURVIVAL FLAGS
       Two hooks, because HP reaches zero by two different routes: every
       ordinary damage path funnels through setHp, but an instant-death state
       calls die() directly from addNewState and never touches it. Guarding
       only one leaves a hole you would find at the worst moment.
       ===================================================================== */
    function protectedBattler(b) {
        if (!cfg().god) return false;
        return !!(b && typeof b.isActor === 'function' && b.isActor());
    }

    $.install('Game_BattlerBase.setHp.god',
        typeof Game_BattlerBase !== 'undefined' ? Game_BattlerBase.prototype : null, 'setHp',
        function (original) {
            return function (hp) {
                if (protectedBattler(this) && hp < 1) hp = 1;
                return original.call(this, hp);
            };
        });

    $.install('Game_BattlerBase.die.god',
        typeof Game_BattlerBase !== 'undefined' ? Game_BattlerBase.prototype : null, 'die',
        function (original) {
            return function () {
                // Swallowed rather than clamped: die() also clears states and
                // buffs, and a protected actor should keep both.
                if (protectedBattler(this)) return;
                return original.apply(this, arguments);
            };
        });

    function freeCosts(b) {
        if (!cfg().freeCost) return false;
        return !!(b && typeof b.isActor === 'function' && b.isActor());
    }

    $.install('Game_BattlerBase.paySkillCost.free',
        typeof Game_BattlerBase !== 'undefined' ? Game_BattlerBase.prototype : null, 'paySkillCost',
        function (original) {
            return function (skill) {
                if (freeCosts(this)) return;
                return original.apply(this, arguments);
            };
        });

    $.install('Game_BattlerBase.canPaySkillCost.free',
        typeof Game_BattlerBase !== 'undefined' ? Game_BattlerBase.prototype : null, 'canPaySkillCost',
        function (original) {
            return function (skill) {
                if (freeCosts(this)) return true;
                return original.apply(this, arguments);
            };
        });

    /** Which of the survival hooks actually took, and why any did not. */
    B.hookState = function () {
        return ['Game_BattlerBase.setHp.god', 'Game_BattlerBase.die.god',
            'Game_BattlerBase.paySkillCost.free', 'Game_BattlerBase.canPaySkillCost.free']
            .map(function (n) {
                var hk = $.hooks[n] || { name: n, installed: false, reason: 'never registered' };
                return { name: n, installed: !!hk.installed, reason: hk.reason || '' };
            });
    };

    B.godAvailable = function () { return B.whyUnavailable('god') === null; };
    B.freeAvailable = function () { return B.whyUnavailable('free') === null; };

    /** Why a flag is unavailable, or null when it is fine. */
    B.whyUnavailable = function (which) {
        var names = which === 'god'
            ? ['Game_BattlerBase.setHp.god', 'Game_BattlerBase.die.god']
            : ['Game_BattlerBase.paySkillCost.free', 'Game_BattlerBase.canPaySkillCost.free'];
        for (var i = 0; i < names.length; i++) {
            var hk = $.hooks[names[i]];
            if (!hk || !hk.installed) {
                return (hk && hk.reason) || (names[i].split('.')[1] + ' was not found in this build');
            }
        }
        return null;
    };

    /* =====================================================================
       PART 3 — COMBAT CONTROL
       Everything here is irreversible mid-battle, so each takes a save backup
       and refuses with a stated reason rather than half-acting.
       ===================================================================== */

    /**
     * Common guard: in battle, allowed to write, backed up — in that order.
     * A backup copies the whole save directory and prunes the oldest, so every
     * "is there anything to do here" test has to happen BEFORE this is called,
     * never after. Refusing with a backup already spent is a silent cost.
     */
    function danger(label, reason) {
        if (!B.inBattle()) return { ok: false, why: 'no battle is running' };
        if (!$.allowWrite(label)) return { ok: false, why: 'read-only mode' };
        var b = $.backup.guard(reason);
        if (b.created) U.toast({ title: 'SAVE BACKED UP', msg: b.entry.name, severity: 'ok' });
        return { ok: true, backup: b };
    }

    /**
     * Ask the game to notice the battle is over.
     *
     * checkBattleEnd is only reached from updateEvent, which runs in the
     * "start", "turn" and "turnEnd" phases — never while input is being taken.
     * In a turn-based fight the whole time a command window is up the phase IS
     * input, which is exactly when someone opens the overlay mid-fight. Without
     * this nudge, instant win kills the troop and then nothing happens until
     * the player has issued a command for every actor.
     *
     * It calls the game's OWN checkBattleEnd, whatever that has become, so
     * rewards, any victory autosave and any endBattle work all still run.
     *
     * The phase guard is deliberately a falsy test rather than a comparison:
     * the two engines use different sentinels for "no battle" — one a null and
     * one an empty string — and both are undefined before the first fight. All
     * three are falsy, which is the only property this needs.
     */
    function nudgeBattleEnd() {
        $.safe(function () {
            if (typeof BattleManager === 'undefined' || !BattleManager.checkBattleEnd) return;
            if (!BattleManager._phase) return;
            BattleManager.checkBattleEnd();
        }, 'end-of-battle nudge');
    }

    /**
     * Kill one enemy the way the engine does: HP to zero, then refresh, which
     * adds the death state through Game_Battler.refresh. performCollapse gives
     * it the sprite treatment so it does not simply vanish.
     */
    B.killEnemy = function (e) {
        // Checked before the backup, not after.
        if (!e) return false;
        if (!B.inBattle()) { U.toast({ title: 'CANNOT', msg: 'no battle is running', severity: 'warn' }); return false; }
        if ($.safe(function () { return e.isDead(); }, 'is dead', false)) {
            U.toast({ title: 'ALREADY DOWN', msg: e.name() + ' is already dead', severity: 'info' });
            return false;
        }
        var g = danger('Killing an enemy', 'kill enemy');
        if (!g.ok) { U.toast({ title: 'CANNOT', msg: g.why, severity: 'warn' }); return false; }

        /* Verified, because zero HP is not the same fact as "dead". The death
           state is applied by refresh(), and a plugin that has aliased refresh
           or the death handling can leave a battler on zero HP and still alive
           — at which point instant win kills the troop and the fight never
           ends. The read-back turns that into a named message instead. */
        var r = verify('battle.states',
            function () {
                e.setHp(0);
                e.refresh();
                if (e.performCollapse) e.performCollapse();
            },
            function () { return $.safe(function () { return e.isDead(); }, 'is dead', false); },
            true);

        if (!r.ok) {
            $.log('warn', e.name() + ' was set to 0 HP but did not register as dead. ' + r.message);
            U.toast({
                title: 'STILL STANDING', severity: 'warn',
                msg: e.name() + ' is on 0 HP but the game has not registered the death'
            });
        } else {
            $.log('warn', 'killed enemy ' + e.name() + ' (irreversible)');
        }
        nudgeBattleEnd();
        return r.ok;
    };

    B.setEnemyHp = function (e, value) {
        if (!e || !B.inBattle()) return false;
        var v = $.safe(function () {
            return Math.max(0, Math.min(e.mhp, Math.floor(value)));
        }, 'clamp hp', null);
        if (v === null) return false;
        // Zero is not an edit, it is a kill: it can end the battle, and there
        // is no undoing that. Route it through the path that takes a backup.
        if (v === 0) return B.killEnemy(e);
        if (!$.allowWrite('Setting enemy HP')) return false;
        return $.safe(function () {
            var before = e.hp, troop = $gameTroop, idx = e.index();
            e.setHp(v);
            e.refresh();
            $.undo.push('enemy ' + e.name() + ' HP ' + before + ' → ' + v, function () {
                // The troop is rebuilt on every battle, so an entry that
                // outlives this one would mutate a detached object and report
                // success. Check identity before touching anything.
                if (!B.inBattle() || $gameTroop !== troop || $gameTroop.members()[idx] !== e) {
                    $.log('warn', 'undo skipped — that battle is over');
                    return;
                }
                e.setHp(before);
                e.refresh();
            });
            return true;
        }, 'set enemy hp', false);
    };

    /**
     * Instant win. Deliberately NOT BattleManager.processVictory().
     *
     * A game may have replaced checkBattleEnd, and its version is what triggers
     * whatever it does on victory — the autosave, the endBattle bookkeeping,
     * the reward pipeline. Killing the troop and letting the game notice keeps
     * EXP, gold and drops intact; forcing the phase would skip all of it.
     */
    B.instantWin = function () {
        if (!B.inBattle()) { U.toast({ title: 'CANNOT WIN', msg: 'no battle is running', severity: 'warn' }); return false; }
        // Count the work before spending a backup on it. Hidden enemies are
        // skipped: they are not on screen, contribute nothing to rewards, and
        // collapsing one plays a sound effect for a sprite nobody can see.
        var targets = B.enemies().filter(function (e) {
            return $.safe(function () { return e.isAppeared() && !e.isDead(); }, 'targetable', false);
        });
        if (!targets.length) {
            U.toast({ title: 'NOTHING TO DO', msg: 'every enemy is already down', severity: 'info' });
            return false;
        }
        var g = danger('Ending the battle in a win', 'instant win');
        if (!g.ok) { U.toast({ title: 'CANNOT WIN', msg: g.why, severity: 'warn' }); return false; }
        /* One verify for the whole sweep rather than one per enemy: the
           question is "did the troop actually go down", and a per-enemy report
           would say the same thing up to eight times. */
        var r = verify('battle.states',
            function () {
                for (var i = 0; i < targets.length; i++) {
                    $.safe(function () {
                        targets[i].setHp(0);
                        targets[i].refresh();
                        if (targets[i].performCollapse) targets[i].performCollapse();
                    }, 'drop enemy');
                }
            },
            function () {
                return targets.filter(function (t) {
                    return $.safe(function () { return !t.isDead(); }, 'is dead', false);
                }).length;
            },
            0);

        if (r.ok) {
            $.log('warn', 'instant win — killed ' + targets.length +
                ' enemies; the game ends the battle itself, so rewards and any autosave still run');
        } else {
            $.log('warn', 'instant win dropped ' + targets.length + ' enemies but ' + r.got +
                ' did not register as dead, so the battle may not end. ' + r.message);
            U.toast({
                title: 'STILL STANDING', severity: 'warn',
                msg: r.got + ' enemy(s) are on 0 HP but not registered dead'
            });
        }
        nudgeBattleEnd();
        return r.ok;
    };

    /**
     * Instant lose.
     *
     * A game may alias processDefeat with a whole revival and game-over policy
     * of its own, so instant lose CANNOT ASSUME A GAME OVER. It drops the party
     * and lets that policy decide what a loss means — which may be a game over,
     * or may be a scripted revive. Nothing here reads a switch or a variable to
     * predict which; the game is the only thing that knows.
     */
    B.instantLose = function () {
        if (!B.inBattle()) { U.toast({ title: 'CANNOT LOSE', msg: 'no battle is running', severity: 'warn' }); return false; }

        /* Where the engine HAS a hidden-battle-member concept, "everyone
           visible is down" and "the party escaped" are the same state, and the
           escape test is checked BEFORE defeat. So with a member hidden —
           which any summon or reserve mechanic does — dropping the visible
           party reads as fleeing, the defeat branch never runs, and the game's
           own loss policy is skipped entirely. Refuse rather than quietly
           produce the wrong ending.

           The other engine has no such concept and no such accessor: the
           feature detection answers 0, the ambiguity cannot arise there, and
           this guard is correctly inert. */
        var hidden = $.safe(function () {
            return $gameParty.hiddenBattleMembers ? $gameParty.hiddenBattleMembers().length : 0;
        }, 'hidden members', 0);
        if (hidden) {
            U.toast({
                title: 'CANNOT LOSE', severity: 'warn',
                msg: hidden + ' battle member(s) are hidden — this would register as an escape, not a defeat'
            });
            return false;
        }

        var targets = B.actors().filter(function (a) {
            return $.safe(function () { return !a.isDead(); }, 'targetable', false);
        });
        if (!targets.length) {
            U.toast({ title: 'NOTHING TO DO', msg: 'the party is already down', severity: 'info' });
            return false;
        }

        var g = danger('Ending the battle in a loss', 'instant lose');
        if (!g.ok) { U.toast({ title: 'CANNOT LOSE', msg: g.why, severity: 'warn' }); return false; }

        return $.safe(function () {
            // God mode is suspended for the drop rather than being a reason to
            // refuse. Someone stuck in a scripted-defeat fight with god mode
            // left on has no other way out: the fight cannot be won, cannot be
            // fled, and the one control that would free them was the one
            // refusing. It is restored immediately afterwards.
            var wasGod = !!cfg().god;
            if (wasGod) $.cfg.battle.god = false;
            try {
                for (var i = 0; i < targets.length; i++) {
                    targets[i].setHp(0);
                    targets[i].refresh();
                }
            } finally {
                if (wasGod) $.cfg.battle.god = true;
            }
            $.log('warn', 'instant lose — dropped ' + targets.length + ' party members' +
                (wasGod ? ' (god mode suspended for the drop, then restored)' : '') +
                '; the game\'s own defeat handling decides whether that is a game over or a revive');
            nudgeBattleEnd();
            return true;
        }, 'instant lose', false);
    };

    /** Full heal for the party — the safe counterpart to the two above. */
    B.healParty = function () {
        if (!$.allowWrite('Healing the party')) return false;
        return $.safe(function () {
            var list = B.actors(), n = 0;
            for (var i = 0; i < list.length; i++) {
                list[i].recoverAll();
                n++;
            }
            $.log('ok', 'healed ' + n + ' party members');
            return n;
        }, 'heal party', 0);
    };

    /* ---------------------------------------------------------- troop list */
    B.troops = function () {
        return $.safe(function () {
            var out = [];
            for (var i = 1; i < ($dataTroops || []).length; i++) {
                var t = $dataTroops[i];
                if (!t) continue;
                var members = (t.members || []).filter(function (m) {
                    return m && $dataEnemies[m.enemyId];
                });
                out.push({
                    id: i, name: t.name || ('Troop ' + i),
                    count: members.length,
                    who: members.slice(0, 4).map(function (m) {
                        return $dataEnemies[m.enemyId].name;
                    }).join(', ') + (members.length > 4 ? ' …' : '')
                });
            }
            return out;
        }, 'troops', []) || [];
    };

    /**
     * Start a specific troop, along the same path the engine's own "Battle
     * Processing" event command uses (command301) rather than the random
     * encounter path — no preemptive/surprise roll, which is what you want
     * when testing a fight.
     */
    B.forceTroop = function (troopId, canEscape, canLose) {
        if (B.inBattle()) {
            U.toast({ title: 'ALREADY IN BATTLE', msg: 'finish this one first', severity: 'warn' });
            return false;
        }
        if (!$.allowWrite('Starting a battle')) return false;
        var why = $.safe(function () {
            if (typeof $dataTroops === 'undefined' || !$dataTroops[troopId]) return 'troop ' + troopId + ' does not exist';
            if (typeof Scene_Battle === 'undefined') return 'Scene_Battle is missing from this build';
            // Only the map scene can start a battle. BattleManager.setup nulls
            // _mapBgm/_mapBgs, and they are only refilled by Scene_Map.stop ->
            // launchBattle -> saveBgmAndBgs, which runs on the OUTGOING scene.
            // Launching from the menu therefore leaves the map music dead
            // until the next transfer, and pops back to a stale scene.
            if (typeof Scene_Map !== 'undefined' && typeof SceneManager !== 'undefined' &&
                !(SceneManager._scene instanceof Scene_Map)) {
                return 'battles can only be started from the map';
            }
            if (typeof $gameMap !== 'undefined' && $gameMap.isEventRunning && $gameMap.isEventRunning()) {
                return 'an event is running';
            }
            if (typeof $gameMessage !== 'undefined' && $gameMessage.isBusy && $gameMessage.isBusy()) {
                return 'a message is on screen';
            }
            return null;
        }, 'troop preflight', 'the check itself failed');
        if (why) { U.toast({ title: 'CANNOT START', msg: why, severity: 'warn' }); return false; }

        var b = $.backup.guard('force battle');
        if (b.created) U.toast({ title: 'SAVE BACKED UP', msg: b.entry.name, severity: 'ok' });

        return $.safe(function () {
            BattleManager.setup(troopId, canEscape !== false, canLose === true);
            if ($gamePlayer && $gamePlayer.makeEncounterCount) $gamePlayer.makeEncounterCount();
            SceneManager.push(Scene_Battle);
            $.log('warn', 'forced troop ' + troopId + ' — ' +
                (($dataTroops[troopId] && $dataTroops[troopId].name) || '') + ' (irreversible)');
            U.setOpen(false);
            return true;
        }, 'force troop', false);
    };

    /* =====================================================================
       PART 3b — HP/MP BARS OVER THE ENEMIES
       The one part of this module that draws into the rendered scene instead
       of the DOM. The layer is added to the battle spriteset's _battleField,
       not to the spriteset itself, because that is the container enemy sprites
       live in — so sprite.x / sprite.y can be used directly with no transform
       maths, and the bars track shakes, knockback and collapse animations for
       free. A battler sprite's anchor is (0.5, 1) on both engines, so sprite.y
       is the FEET and sprite.y - sprite.height is the top of the graphic.

       WHY HAND-DRAWN, ON BOTH ENGINES. Each engine has its own way to render a
       gauge and neither exists on the other: one has a gauge SPRITE class that
       is attached through window internals the other engine does not have at
       all, and the other has a window METHOD that paints into a window's
       contents bitmap — which is no use here, because these bars are not in a
       window. A single layer of PIXI primitives is the only path that behaves
       the same on both, so that is the path, and barsPath() reports which
       engine facilities were found either way rather than leaving the choice
       unexplained.

       IT MUST ALSO SURVIVE A NON-WEBGL RENDERER. One of the two engines can
       fall back to a canvas renderer; PIXI's own primitives draw in both modes,
       which a filter- or shader-based bar would not.

       CLIPPING, ON ONE ENGINE, IN WEBGL MODE. That engine's tone changer sets
       a filter area on the sprite the battlefield hangs under, sized to the
       screen plus a fixed margin. Anything inside the battlefield is therefore
       clipped to that region — so a bar lifted far above a tall enemy can leave
       it and simply not draw, with no error. The other engine filters the
       spriteset instead and does not clip this layer. Rather than detect which,
       the bar block is kept inside the field: a bar that would sit above the
       top edge is pinned to it. That is correct on both engines, and on both it
       replaces "the bars vanished" with "the bars are at the top".
       ===================================================================== */
    var bars = null;                 // current overlay (one per spriteset)

    /* What the engine offers for gauges, for the report only — never branched
       on. Both answers lead to the same hand-drawn path; the point is to say
       WHICH engine this is in the words of what it has. */
    function gaugeFacility() {
        if ($.caps.spriteGauge) return 'a gauge sprite class';
        if ($.caps.drawGauge) return 'a window gauge-drawing method';
        return 'neither a gauge sprite nor a window gauge method';
    }

    var BAR_FALLBACK = { back: 0.72, hp: 1, mp: 1, text: 1 };
    function barCfg() { return cfg().bars || {}; }
    function barOn() { return !!barCfg().on; }
    function barAlpha(k) {
        var a = barCfg().alpha, v = a ? a[k] : undefined;
        if (typeof v !== 'number' || v !== v) return BAR_FALLBACK[k];
        return v < 0 ? 0 : v > 1 ? 1 : v;
    }
    function barNum(k, dflt, lo, hi) {
        var v = barCfg()[k];
        if (typeof v !== 'number' || v !== v) return dflt;
        return v < lo ? lo : v > hi ? hi : v;
    }

    function makeBars() {
        return $.safe(function () {
            if (typeof PIXI === 'undefined' || !PIXI.Container || !PIXI.Graphics) return null;
            var root = new PIXI.Container();
            root.gfx = new PIXI.Graphics();
            root.labels = new PIXI.Container();
            root.addChild(root.gfx);
            root.addChild(root.labels);
            root._textBy = Object.create(null);
            root._ids = [];
            return root;
        }, 'create bars', null);
    }

    var canText = (typeof Sprite !== 'undefined' && typeof Bitmap !== 'undefined');

    /**
     * The game's own main font, or null.
     *
     * Asked for through the same adapter the text module hooks: the accessor
     * lives on a different object on each engine, and both are readable without
     * a window instance. It is only used to make the bar labels look like the
     * game rather than like whichever default that engine's Bitmap happens to
     * ship with — see below.
     */
    function mainFontFace() {
        return $.safe(function () {
            var t = $.eng.fontTarget();
            if (!t || !t.face || !t.face.owner) return null;
            var fn = t.face.owner[t.face.method];
            if (typeof fn !== 'function') return null;
            var v = fn.call(typeof $gameSystem !== 'undefined' ? $gameSystem : null);
            return (typeof v === 'string' && v) ? v : null;
        }, 'main font face', null);
    }

    /**
     * A cached one-line label sprite.
     *
     * EVERY Bitmap text property is set explicitly and none is inherited. The
     * two engines ship different defaults for the font face, the size and even
     * the outline width, so a label that relied on any of them would be a
     * different size and a different typeface depending on which engine it ran
     * on, for no reason anybody asked for. The glyph baseline also differs
     * slightly between them; at this size the difference is under a pixel and
     * the label is centred in its own bitmap either way.
     */
    function textFor(root, key, str, width) {
        if (!canText) return null;
        var s = root._textBy[key];
        if (!s) {
            s = new Sprite();
            s.bitmap = new Bitmap(Math.max(64, width), 16);
            root.labels.addChild(s);
            root._textBy[key] = s;
            root._ids.push(key);
        }
        if (s._str === str) return s;
        s._str = str;
        var b = s.bitmap;
        b.clear();
        var face = mainFontFace();
        if (face) b.fontFace = face;
        b.fontSize = 12;
        b.textColor = '#ffffff';
        b.outlineColor = 'rgba(0,0,0,0.9)';
        b.outlineWidth = 4;
        b.drawText(str, 0, 0, b.width, 16, 'center');
        return s;
    }

    /* Room for the label that sits above the bars, so pinning the block to the
       top edge does not push the text off it. */
    var TOP_MARGIN = 16;

    /** Green above 50%, amber above 25%, red below — the usual reading. */
    function hpColour(ratio) {
        return ratio > 0.5 ? 0x5fa463 : ratio > 0.25 ? 0xd19a3c : 0xd1495b;
    }

    var barFails = 0, barReported = false;

    function updateBars(root, sprites) {
        if (!root) return;
        var want = barOn() && B.inBattle();
        root.visible = want;
        if (!want) return;
        try {
            drawBars(root, sprites || []);
            if (barFails) barFails--;
        } catch (e) {
            var msg = (e && e.message) ? e.message : String(e);
            if (!barReported) { barReported = true; $.log('err', 'enemy bars failed — ' + msg); }
            if (++barFails >= 6) {
                root.visible = false;
                $.store.cfgSet('battle.bars.on', false);
                U.setActive('enemy bars', false);
                U.toast({ title: 'BARS OFF', msg: 'drawing kept failing — ' + msg, severity: 'warn' });
                barFails = 0;
            }
        }
    }

    function drawBars(root, sprites) {
        var g = root.gfx;
        g.clear();

        var showMp = barCfg().mp !== false;
        var showVals = barCfg().values !== false;
        var showName = !!barCfg().name;
        var hgt = barNum('height', 6, 2, 20);
        var gap = barNum('gap', 2, 0, 12);
        var lift = barNum('offset', 8, 0, 120);
        var fixed = barNum('width', 0, 0, 400);
        var aBack = barAlpha('back'), aHp = barAlpha('hp'), aMp = barAlpha('mp'), aText = barAlpha('text');
        var used = Object.create(null);

        for (var i = 0; i < sprites.length; i++) {
            var sp = sprites[i];
            if (!sp || sp.visible === false) continue;
            var e = sp._enemy || sp._battler;
            if (!e || typeof e.isAppeared !== 'function') continue;
            if (!e.isAppeared()) continue;                 // not on screen yet
            if (e.isDead() && !barCfg().showDead) continue;

            // Before the battler graphic loads, width/height are 0 and the bar
            // would sit in the top-left corner of the field.
            var sw = sp.width || 0, sh = sp.height || 0;
            if (!(sw > 0) || !(sh > 0)) continue;

            var w = fixed > 0 ? fixed : Math.max(40, Math.min(220, Math.round(sw * 0.8)));
            var x = Math.round(sp.x - w / 2);
            var y = Math.round(sp.y - sh - lift - hgt);
            var rows = 1 + ((showMp && e.mmp > 0) ? 1 : 0);
            y -= (rows - 1) * (hgt + gap);

            /* Keep the whole block — bars plus the label above them — inside
               the field. On one engine, in WebGL mode, the battlefield sits
               under a filter area sized to the screen plus a fixed margin, and
               anything drawn outside it is clipped away with no error: a large
               lift over a tall sprite would simply produce no bars. Pinning to
               the top edge is correct on both engines, and turns "the bars
               disappeared" into "the bars are at the top". */
            if (y < TOP_MARGIN) y = TOP_MARGIN;

            var hpRatio = e.mhp > 0 ? Math.max(0, Math.min(1, e.hp / e.mhp)) : 0;

            if (aBack > 0) {
                g.beginFill(0x000000, aBack);
                g.drawRect(x - 1, y - 1, w + 2, hgt + 2);
                g.endFill();
            }
            if (aHp > 0) {
                g.beginFill(0x1a1c20, aHp);
                g.drawRect(x, y, w, hgt);
                g.endFill();
                g.beginFill(hpColour(hpRatio), aHp);
                g.drawRect(x, y, Math.round(w * hpRatio), hgt);
                g.endFill();
            }

            var yy = y + hgt + gap;
            if (showMp && e.mmp > 0 && aMp > 0) {
                var mpRatio = Math.max(0, Math.min(1, e.mp / e.mmp));
                if (aBack > 0) {
                    g.beginFill(0x000000, aBack);
                    g.drawRect(x - 1, yy - 1, w + 2, hgt + 2);
                    g.endFill();
                }
                g.beginFill(0x1a1c20, aMp);
                g.drawRect(x, yy, w, hgt);
                g.endFill();
                g.beginFill(0x5b8bb5, aMp);
                g.drawRect(x, yy, Math.round(w * mpRatio), hgt);
                g.endFill();
                yy += hgt + gap;
            }

            if ((showVals || showName) && aText > 0) {
                var parts = [];
                if (showName) parts.push(e.name());
                if (showVals) parts.push(e.hp + '/' + e.mhp);
                var key = 'e' + i;
                var t = textFor(root, key, parts.join('  '), Math.max(64, w));
                if (t) {
                    t.visible = true;
                    t.alpha = aText;
                    t.x = Math.round(sp.x - t.bitmap.width / 2);
                    t.y = y - 16;
                    used[key] = true;
                }
            }
        }

        for (var k = 0; k < root._ids.length; k++) {
            if (!used[root._ids[k]]) root._textBy[root._ids[k]].visible = false;
        }
    }

    /* createLowerLayer is where the battlefield and the enemy sprites are
       built, so the layer is attached right after it — above every battler,
       still inside the spriteset and therefore below the battle HUD windows.
       Both engines build both of those there, and both position the field
       differently; since the bars are positioned relative to sprites that are
       ALSO children of the field, that difference cancels out.

       The typeof guard is not defensive dressing: a game may not have a battle
       scene reachable at all, and $.install then records the skip with a reason
       that barsWhy() reads back to the panel. */
    $.install('Spriteset_Battle.createLowerLayer.bars',
        typeof Spriteset_Battle !== 'undefined' ? Spriteset_Battle.prototype : null, 'createLowerLayer',
        function (original) {
            return function () {
                original.apply(this, arguments);
                var self = this;
                $.safe(function () {
                    bars = makeBars();
                    if (bars && self._battleField) self._battleField.addChild(bars);
                }, 'attach enemy bars');
            };
        });

    $.install('Spriteset_Battle.update.bars',
        typeof Spriteset_Battle !== 'undefined' ? Spriteset_Battle.prototype : null, 'update',
        function (original) {
            return function () {
                original.apply(this, arguments);
                var self = this;
                $.safe(function () { updateBars(bars, self._enemySprites); }, 'update enemy bars');
            };
        });

    B.barsAvailable = function () {
        var a = $.hooks['Spriteset_Battle.createLowerLayer.bars'];
        var b = $.hooks['Spriteset_Battle.update.bars'];
        return !!(a && a.installed && b && b.installed) && B.barsPath().ok;
    };
    B.barsWhy = function () {
        var a = $.hooks['Spriteset_Battle.createLowerLayer.bars'];
        if (!a || !a.installed) return (a && a.reason) || 'this build has no battle spriteset to draw into';
        var b = $.hooks['Spriteset_Battle.update.bars'];
        if (!b || !b.installed) return (b && b.reason) || 'the battle spriteset\'s update could not be hooked';
        var path = B.barsPath();
        return path.ok ? null : path.why;
    };

    /**
     * Which drawing path the bars are on, and why that one.
     *
     * Reported rather than branched on. Both engines end up here, and the value
     * of saying so is that "the bars look different from the game's own gauges"
     * has an answer, and that a build with no PIXI primitives at all is named
     * instead of silently drawing nothing.
     */
    B.barsPath = function () {
        var hasPixi = typeof PIXI !== 'undefined' && !!PIXI.Container && !!PIXI.Graphics;
        if (!hasPixi) {
            return {
                ok: false, id: 'none', label: 'unavailable',
                engine: gaugeFacility(),
                why: 'this build exposes no drawable primitives to build an in-scene layer from, so the ' +
                     'enemy bars cannot be drawn at all.'
            };
        }
        return {
            ok: true, id: 'graphics',
            label: 'hand-drawn into the battle scene',
            engine: gaugeFacility(),
            text: canText ? 'with cached label bitmaps' : 'without labels — no bitmap text in this build',
            why: 'this build has ' + gaugeFacility() + '. Neither of the two engine gauge facilities exists ' +
                 'on both engines, and one of them additionally needs window internals that only one engine ' +
                 'has — so a single layer of drawing primitives, which behaves identically everywhere and ' +
                 'draws even where the renderer is not WebGL, is the path the bars use on every build.'
        };
    };
    /** Test hook. */
    B._barsLayer = function () { return bars; };
    B._resetBarGuard = function () { barFails = 0; barReported = false; };

    /* =====================================================================
       PART 4 — TAB
       ===================================================================== */
    var ROW_H = 17;
    var selected = -1;

    function pct(v) { return Math.round(v * 100) + '%'; }

    /**
     * The one kind of inline text worth keeping: a control that is switched
     * off needs its reason on screen, because you cannot hover a thing you
     * have already decided is broken. Everything else lives in a tooltip.
     */
    function unavailable(why) {
        return h('div', {
            class: 'mm-sub', style: 'padding:0 2px 4px;white-space:normal;color:var(--mm-warn)',
            text: 'unavailable — ' + why
        });
    }

    function notInBattle(what) {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'no battle is running' }),
                h('div', { text: what })));
    }

    /* ------------------------------------------------------------- Enemies */
    function buildEnemies() {
        if (!B.inBattle()) {
            // Walk into an encounter with this tab open and it should catch
            // up by itself rather than sitting on "no battle" until you
            // switch tabs and back.
            var idleHost = U.getHost();
            if (idleHost) {
                idleHost.tickHooks.push(function () {
                    if (!U.isOpen || !U.isOpen()) return;
                    if (B.inBattle()) U.rerender();
                });
            }
            return notInBattle('start a fight, then open this tab — enemy stats are live, not from the database');
        }

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '#', w: '0 0 26px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'hp', w: '0 0 96px', cls: 'mm-td-num' },
                { label: 'mp', w: '0 0 66px', cls: 'mm-td-num' },
                { label: '', w: '0 0 58px' }
            ],
            empty: 'no enemies in this troop',
            render: function (i) {
                return [
                    String(i.index + 1),
                    h('span', {
                        text: i.name + (i.hidden ? ' (hidden)' : ''),
                        style: (i.dead || i.hidden) ? 'opacity:.5' : null
                    }),
                    i.hp + '/' + i.mhp,
                    i.mmp ? (i.mp + '/' + i.mmp) : '—',
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'kill', mini: true, variant: 'danger', mutates: true,
                            disabled: i.dead || i.hidden,
                            // Repainted either way: a kill that did not
                            // register still moved the enemy's HP to zero, and
                            // the row has to show that rather than the value it
                            // had before the attempt.
                            onClick: function () { B.killEnemy(byIndex(i.index)); repaintAll(); }
                        }))
                ];
            },
            onRow: function (tr, i) {
                if (i.index === selected) tr.classList.add('mm-on');
                tr.style.cursor = 'pointer';
                tr.setAttribute('data-mm-tip', i.name + '|enemy #' + i.enemyId +
                    ' · ' + i.exp + ' EXP · ' + i.gold + ' gold' +
                    (i.hidden ? ' · not on screen yet' : ''));
                tr.addEventListener('click', function () { selected = i.index; repaintAll(); });
            }
        });

        function byIndex(ix) { return B.enemies()[ix] || null; }
        function rows() { return B.enemies().map(B.info).filter(Boolean); }

        var left = h('div', { class: 'mm-col mm-col-narrow' });
        function repaintAll() {
            var keep = left.scrollTop;
            U.clear(left);
            U.add(left, enemyPanel(repaintAll));
            left.scrollTop = keep;
            table.mm.paint(rows());
        }
        repaintAll();

        // Enemy HP moves every action, so the table is repainted on a clock —
        // but ONLY the table. Rebuilding the left panel here would replace
        // every widget in it four times a minute: a two-click danger button
        // could never reach its second click, a number field would lose focus
        // and the text being typed into it, and every group the user expanded
        // would snap shut, because collapse state lives on the DOM node.
        var host = U.getHost();
        if (host) {
            host.tickHooks.push(function () {
                if (!U.isOpen || !U.isOpen()) return;    // nothing to paint into
                if (table.mm.isScrolling()) return;
                table.mm.paint(rows());
            });
        }

        return h('div', { class: 'mm-body' }, left,
            h('div', { class: 'mm-col' },
                W.group('Troop · ' + ($.safe(function () {
                    var t = $gameTroop.troop(); return t ? t.name : '?';
                }, 'troop name', '?')), [table], { grow: true })));
    }

    function enemyPanel(refresh) {
        var list = B.enemies();
        var e = list[selected];
        var out = [];

        if (!e) {
            out.push(W.group('Enemy', [
                h('div', { class: 'mm-empty', style: 'white-space:normal',
                    text: 'pick an enemy from the list' })
            ]));
            return out;
        }

        var i = B.info(e);
        if (!i) return out;

        out.push(W.group(i.name, [
            kv('Enemy ID', i.enemyId),
            kv('HP', i.hp + ' / ' + i.mhp),
            i.mmp ? kv('MP', i.mp + ' / ' + i.mmp) : null,
            kv('EXP', i.exp),
            kv('Gold', i.gold),
            i.hidden ? kv('On screen', 'no — not appeared yet') : null,
            i.states.length ? kv('States', i.states.join(', ')) : null,
            W.row('Set HP', W.number({
                value: i.hp, min: 0, max: i.mhp, wide: true, label: 'Enemy HP',
                disabled: i.hidden,
                onChange: function (v) { B.setEnemyHp(e, v); refresh(); }
            }), { tip: 'Set HP|Undoable while this battle lasts. Setting it to 0 is a kill, not an edit — ' +
                'it takes a save backup and cannot be undone, because it can end the fight.' })
        ], { tag: 'live' }));

        var p = i.params;
        /* Editable, not a readout — and the CEILING is a column of its own
           rather than a footnote. A parameter is recomputed and re-clamped on
           every read, so a value above the ceiling is discarded before it is
           ever shown; the two engines ship different ceilings, and plugins
           replace them on both. Showing the live clamp next to the number it
           limits is the difference between a control that looks broken and one
           that explains itself. Written onto this battler's own offset, so
           nothing here follows the save into the next encounter. */
        var COL_CAP = 74;
        var paramRows = [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) {
            var cap = B.paramCap(e, n);
            var atCap = cap.max !== null && p[n] >= cap.max;
            var field = W.number({
                value: p[n],
                min: (cap.min === null || cap.min < 0) ? 0 : cap.min,
                // An unbounded ceiling is not a number a spinner can hold, so
                // the field keeps a large finite bound and the clamp column
                // carries the truth.
                max: (cap.max !== null && isFinite(cap.max)) ? cap.max : 999999,
                wide: true, label: 'enemy ' + B.paramName(n),
                onChange: function (v) { B.setEnemyParam(e, n, v); refresh(); }
            });
            degradeMark(field, 'battle.params');
            return W.row(B.paramName(n), [
                field,
                h('span', {
                    class: 'mm-sub mm-mono',
                    style: 'display:inline-block;text-align:right;width:' + COL_CAP + 'px' +
                        (atCap ? ';color:var(--mm-warn)' : ''),
                    text: B.capText(cap)
                })
            ], { tip: B.paramName(n) + '|Recomputed and re-clamped on every read. The second column is this ' +
                    'build\'s live ceiling for this parameter — a value above it is thrown away before you ' +
                    'see it, so it is shown rather than discovered.' });
        });

        paramRows.push(capOffer(e, refresh));
        paramRows.push(degradeNote('battle.params'));
        paramRows.push(W.button({
            label: 'back to the database values', wide: true, mutates: true,
            onClick: function () { B.resetEnemyParams(e); refresh(); }
        }));
        paramRows.push(h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
            'Edited on this battler only — the enemy database is untouched, so the next one of these is normal.'));

        out.push(W.group('Parameters', paramRows, { collapsed: true, tag: 'clamp' }));

        // Force an action out of this enemy, or out of a party member at it.
        var forceWhy = B.forceWhy();
        var skills = B.actionSkills();
        var pick = { id: skills.length ? skills[0].id : 1 };
        out.push(W.group('Force an action', [
            skills.length ? W.row('Skill', W.dropdown({
                options: skills.slice(0, 400).map(function (sk) { return sk.id + ' · ' + sk.name; }),
                value: skills[0].id + ' · ' + skills[0].name, width: '150px', _ungated: true,
                onChange: function (v) { pick.id = parseInt(v, 10) || 1; }
            })) : h('div', { class: 'mm-empty', text: 'no skills in the database' }),
            W.button({
                label: 'make it act now', wide: true, mutates: true, disabled: !!forceWhy,
                tip: 'Force|The engine picks the target. A fixed index into a troop that has since lost ' +
                    'members points at nothing and the action is silently dropped.',
                onClick: function () { B.forceAction(e, pick.id, -1); U.rerender(); }
            }),
            forceWhy ? unavailable(forceWhy) : null
        ], { tag: forceWhy ? 'unavailable' : 'this turn', collapsed: true }));

        var r = B.rates(e);
        out.push(W.group('Weaknesses', r.elements.length
            ? r.elements.map(function (x) {
                return kv(x.name, pct(x.rate), x.rate > 1 ? 'var(--mm-danger)' : 'var(--mm-ok)');
            })
            : [h('div', { class: 'mm-sub', style: 'padding:2px', text: 'takes normal damage from everything' })],
            { tag: 'element' }));

        out.push(W.group('State rates', r.states.length
            ? r.states.slice(0, 24).map(function (x) {
                return kv(x.name, x.immune ? 'immune' : pct(x.rate),
                    x.immune || x.rate < 1 ? 'var(--mm-danger)' : 'var(--mm-ok)');
            })
            : [h('div', { class: 'mm-sub', style: 'padding:2px', text: 'no unusual state rates' })],
            { collapsed: true, tag: r.states.length > 24 ? 'top 24' : '' }));

        var drops = B.drops(e);
        out.push(W.group('Drops', drops.length
            ? drops.map(function (d) {
                return kv(d.name, pct(d.chance) + (d.doubled ? ' ×2' : ''),
                    d.chance >= 0.5 ? 'var(--mm-ok)' : null);
            })
            : [h('div', { class: 'mm-sub', style: 'padding:2px', text: 'drops nothing' })],
            { tag: drops.length && drops[0].doubled ? 'doubled' : '' }));

        if (i.note) {
            out.push(W.group('Note', [
                h('div', { class: 'mm-sub mm-selectable',
                    style: 'white-space:pre-wrap;padding:2px', text: i.note })
            ], { collapsed: true }));
        }
        return out;
    }

    /**
     * "The ceiling stopped that" — with the one control that fixes it.
     *
     * Shown only after a write this panel actually refused, and only for the
     * battler it was refused on, so it cannot linger next to an unrelated
     * enemy. Raising is delegated to the module that owns the ceiling hook;
     * where that module is absent the offer is disabled with the reason
     * attached rather than removed, because the refusal still needs explaining.
     */
    function capOffer(enemy, refresh) {
        var r = B.lastParamResult;
        if (!r || !r.capped || r.enemy !== enemy) return null;
        var can = B.capAvailable();
        var why = B.capWhy();
        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
            h('b', { text: 'the ceiling stopped that. ' }),
            B.paramName(r.id) + ' is capped at ' + r.cap + ' on this build, and the value is recomputed and ' +
            're-clamped on every read — so no write puts ' + r.want + ' there until the ceiling moves. ',
            W.button({
                label: 'raise the ceiling to ' + r.want + ' and set it', wide: true, mutates: true,
                disabled: !can,
                tip: 'Raise|Session-only, and it never lowers anything: the raise returns the larger of the ' +
                    'game\'s own ceiling and this one. The value is then written again and read back.',
                onClick: function () {
                    var raised = B.raiseParamCap(r.want);
                    var ok = B.setEnemyParam(enemy, r.id, r.want);
                    U.toast({
                        title: ok ? 'CEILING RAISED' : 'STILL CAPPED',
                        msg: ok
                            ? B.paramName(r.id) + ' ceiling ' + r.cap + ' → ' + (raised.cap == null ? '?' : raised.cap)
                            : 'the ceiling did not move — ' + (why || raised.why || 'the raise did not take'),
                        severity: ok ? 'ok' : 'warn'
                    });
                    if (ok) B.lastParamResult = null;
                    refresh();
                }
            }),
            can ? null : h('div', { style: 'padding-top:2px', text: why }),
            W.button({
                label: 'leave it', mini: true, _ungated: true,
                onClick: function () { B.lastParamResult = null; refresh(); }
            }));
    }

    function kv(label, value, colour) {
        return h('div', { class: 'mm-row' },
            h('div', { class: 'mm-lab', text: String(label) }),
            h('div', {
                class: 'mm-edge mm-mono mm-sub',
                style: 'white-space:normal;text-align:right' + (colour ? ';color:' + colour : ''),
                text: String(value)
            }));
    }

    /* ------------------------------------------------------------- Actions */
    /**
     * The Survival group, built on demand so both tabs get a live one.
     *
     * Returned rather than cached: these controls read their own state at
     * build time, and a node handed to two panels would be re-parented by
     * whichever rendered second, leaving the other tab with an empty column.
     */
    function survivalGroup() {
        var godWhy = B.whyUnavailable('god');
        var freeWhy = B.whyUnavailable('free');
        return W.group('Survival', [
            W.toggleRow('God mode', W.ungated({
                value: !!cfg().god, disabled: !!godWhy,
                tip: 'God mode|Party HP never drops below 1 and instant-death is ignored. Two hooks, ' +
                    'because HP reaches zero by two routes — ordinary damage and a death state applied ' +
                    'directly — but a plugin that writes HP without going through either would still get ' +
                    'past it. A toggle, not a guarantee. ' +
                    'Turn it OFF for scripted fights you are meant to lose — with it on they can be ' +
                    'neither won nor lost.',
                onChange: function (v) {
                    $.store.cfgSet('battle.god', v);
                    U.setActive('god mode', v);
                }
            })),
            godWhy ? unavailable(godWhy) : null,
            W.toggleRow('Free skill costs', W.ungated({
                value: !!cfg().freeCost, disabled: !!freeWhy,
                tip: 'Free skill costs|Skills cost no MP or TP, and none are greyed out for being ' +
                    'unaffordable. Party only. A cost a plugin charges outside the engine\'s own ' +
                    'pay-cost path is not covered — a toggle, not a guarantee.',
                onChange: function (v) {
                    $.store.cfgSet('battle.freeCost', v);
                    U.setActive('free costs', v);
                }
            })),
            freeWhy ? unavailable(freeWhy) : null,
            h('div', { class: 'mm-sep' }),
            W.toggleRow('Multiply the damage you deal', W.ungated({
                value: B.damageMultiplierOn(),
                tip: 'Damage ×|Only what the party deals, and only when the number is damage — a heal comes out ' +
                    'of the same call as a negative, and scaling that would make every potion a full restore.',
                onChange: function (v) {
                    $.store.cfgSet('battle.damageMultOn', v);
                    U.setActive('damage ×', v);
                    U.rerender();
                }
            })),
            W.row('Damage', W.slider({
                value: B.damageMultiplier(), min: 0, max: 100, step: 0.5, width: '116px',
                label: 'damage multiplier', _ungated: true, disabled: !B.damageMultiplierOn(),
                onChange: function (v) { $.store.cfgSet('battle.damageMult', v); }
            }), { sub: '×' }),
            W.button({
                label: 'heal party to full', wide: true, mutates: true,
                tip: 'Heal|Full HP, MP and states cleared, for every party member.',
                onClick: function () {
                    var n = B.healParty();
                    if (n) U.toast({ title: 'HEALED', msg: n + ' party members', severity: 'ok' });
                }
            })
        ], { tag: 'flags' });
    }

    /** Survival on its own, for the Player tab. */
    function buildSurvival() {
        return cols({ narrow: true, items: [survivalGroup()] }, [
            W.group('What these do', [
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal;line-height:1.7' },
                    'The same three controls that live on Game → Actions, reading the same state. ' +
                    'God mode and free costs only matter once a battle is running; the damage multiplier ' +
                    'scales what the party deals and leaves healing alone. All three guard the engine\'s ' +
                    'own paths — a plugin that reaches HP or a skill cost by another route is not covered, ' +
                    'which is why these are toggles rather than promises.')
            ], { tag: 'note' })
        ]);
    }


    function buildActions() {
        var inBattle = B.inBattle();
        var survival = survivalGroup();

        var combat = W.group('This battle', [
            W.button({
                label: 'instant win', wide: true, variant: 'danger', mutates: true,
                disabled: !inBattle, confirmLabel: 'end it? (irreversible)',
                tip: 'Instant win|Kills every enemy and lets the game end the battle itself, so EXP, gold, drops and the victory autosave all still happen. The save is backed up first.',
                onClick: function () { if (B.instantWin()) U.setOpen(false); }
            }),
            W.button({
                label: 'instant lose', wide: true, variant: 'danger', mutates: true,
                disabled: !inBattle, confirmLabel: 'lose on purpose?',
                tip: 'Instant lose|Drops the party and lets the game\'s own defeat handling decide what that means — it may be a game over, or a scripted revive. Backed up first.',
                onClick: function () { if (B.instantLose()) U.setOpen(false); }
            }),
        ], { tag: inBattle ? 'live' : 'no battle' });

        return cols({ narrow: true, items: [barsPanel(), survival, combat] }, [troopPanel()]);
    }

    /* ------------------------------------------------------------ bar panel */
    var BAR_SLIDERS = [
        ['back', 'backdrop', 'Backdrop|The dark plate behind each bar. This is what keeps a bar readable over a bright battleback.'],
        ['hp', 'HP bar', 'HP bar|Green above 50%, amber above 25%, red below.'],
        ['mp', 'MP bar', 'MP bar|Only drawn for enemies that actually have MP.'],
        ['text', 'numbers', 'Numbers|The name and HP text above each bar. It has a black outline, so it stays readable well below full strength.']
    ];

    function barsPanel() {
        var why = B.barsWhy();
        var path = B.barsPath();
        var rows = [
            W.toggleRow('HP/MP bars over enemies', W.ungated({
                value: barOn(), disabled: !!why,
                tip: 'Enemy bars|Drawn into the battle scene above each enemy, below the HUD.',
                onChange: function (v) {
                    $.store.cfgSet('battle.bars.on', v);
                    U.setActive('enemy bars', v);
                }
            })),
            why ? unavailable(why) : null,
            // Which path, and why that one. "The bars do not look like the
            // game's own gauges" then has an answer on screen instead of in
            // someone's head.
            path.ok ? h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Path: ' + path.label + (path.text ? ', ' + path.text : '') + '. This build has ' +
                path.engine + '.') : null
        ];

        if (!why) {
            rows.push(W.toggleRow('Show MP bar', W.ungated({
                value: barCfg().mp !== false,
                onChange: function (v) { $.store.cfgSet('battle.bars.mp', v); }
            })));
            rows.push(W.toggleRow('Show HP numbers', W.ungated({
                value: barCfg().values !== false,
                onChange: function (v) { $.store.cfgSet('battle.bars.values', v); }
            })));
            rows.push(W.toggleRow('Show enemy name', W.ungated({
                value: !!barCfg().name,
                onChange: function (v) { $.store.cfgSet('battle.bars.name', v); }
            })));
            rows.push(W.toggleRow('Keep bars on dead enemies', W.ungated({
                value: !!barCfg().showDead,
                onChange: function (v) { $.store.cfgSet('battle.bars.showDead', v); }
            })));

            rows.push(h('div', { class: 'mm-sep' }));
            BAR_SLIDERS.forEach(function (spec) {
                rows.push(W.row(spec[1], W.slider({
                    value: Math.round(barAlpha(spec[0]) * 100), min: 0, max: 100,
                    unit: '%', width: '104px', label: spec[1], _ungated: true,
                    onChange: function (v) { $.store.cfgSet('battle.bars.alpha.' + spec[0], v / 100); }
                }), { tip: spec[2] }));
            });
            rows.push(W.row('bar height', W.slider({
                value: barNum('height', 6, 2, 20), min: 2, max: 20, step: 1, unit: 'px',
                width: '104px', label: 'bar height', _ungated: true,
                onChange: function (v) { $.store.cfgSet('battle.bars.height', v); }
            })));
            rows.push(W.row('lift', W.slider({
                value: barNum('offset', 8, 0, 120), min: 0, max: 120, step: 1, unit: 'px',
                width: '104px', label: 'lift', _ungated: true,
                onChange: function (v) { $.store.cfgSet('battle.bars.offset', v); }
            }), { tip: 'Lift|How far above the top of the enemy graphic the bars sit. Raise it if a tall sprite\'s bars overlap the HUD.' }));
            rows.push(W.row('width', W.slider({
                value: barNum('width', 0, 0, 400), min: 0, max: 400, step: 10, unit: 'px',
                width: '104px', label: 'width', _ungated: true,
                onChange: function (v) { $.store.cfgSet('battle.bars.width', v); }
            }), { tip: 'Width|0 follows each enemy\'s own sprite width, which is usually what you want. Anything else is a fixed width for every enemy.' }));
            rows.push(W.button({
                label: 'reset to defaults', wide: true, _ungated: true,
                onClick: function () {
                    var d = $.store.defaults.battle.bars;
                    var keepOn = $.cfg.battle.bars.on;
                    $.cfg.battle.bars = $.clone(d);
                    $.cfg.battle.bars.on = keepOn;
                    $.store.saveSettings();
                    U.rerender();
                }
            }));
        }

        return W.group('Enemy bars', rows, { tag: 'in-scene' });
    }

    /* -------------------------------------------------------- troop picker */
    function troopPanel() {
        var q = '';
        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: 'id', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'troop', w: '1 1 0' },
                { label: 'n', w: '0 0 30px', cls: 'mm-td-num' },
                { label: '', w: '0 0 46px' }
            ],
            empty: 'no troops in this project',
            render: function (t) {
                return [
                    String(t.id),
                    h('span', { text: t.name }),
                    String(t.count),
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'start', mini: true, variant: 'danger', mutates: true,
                            tip: 'Start|Begins this fight the way the engine\'s own Battle Processing ' +
                                'command does — no preemptive or surprise roll. Only from the map, and ' +
                                'not while an event or message is running.',
                            onClick: function () { B.forceTroop(t.id, escape_.mm.get(), lose_.mm.get()); }
                        }))
                ];
            },
            onRow: function (tr, t) {
                tr.setAttribute('data-mm-tip', t.name + '|' + (t.who || 'empty troop'));
            }
        });

        var all = B.troops();
        function repaint() {
            table.mm.paint(all.filter(function (t) {
                if (!q) return true;
                return String(t.id).indexOf(q) > -1 ||
                    t.name.toLowerCase().indexOf(q) > -1 ||
                    (t.who || '').toLowerCase().indexOf(q) > -1;
            }));
        }

        var escape_ = W.chip({ label: 'can escape', value: true, _ungated: true });
        var lose_ = W.chip({ label: 'can lose', value: false, _ungated: true,
            tip: 'Can lose|When off, losing goes to the game-over screen instead of returning to the map.' });

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({
                placeholder: 'search ' + all.length + ' troops…',
                onInput: function (v) { q = v.trim(); repaint(); }
            }), escape_, lose_);
        repaint();

        return W.group('Start a troop', [toolbar, table], { grow: true });
    }

    /* -------------------------------------------------------- registration */

    /* =====================================================================
       ENEMY PARAMETERS, DAMAGE MULTIPLIER, FORCED ACTION
       ===================================================================== */

    /* ---------------------------------------------------- the param ceiling
       A parameter is not stored anywhere. param() is RECOMPUTED on every read:

           round(clamp((base + plus) x rate x buffRate, min, max))

       (one engine applies a floor at zero to base + plus before the rate and
       the other does not — that changes the arithmetic, not what is writable),
       and THE CLAMP IS WHAT DECIDES WHETHER THE CHEAT WORKS AT ALL. A value
       above the ceiling is discarded on the very next read; there is no write
       that makes it stick.

       The two engines do not agree on that ceiling. One has no upper bound in
       this place at all, the other clamps hard at a finite per-parameter
       maximum that differs between HP, MP and the rest — so a request of 5000
       attack silently becomes a much smaller number there, and the old code
       would have printed a value nobody asked for. Framework plugins replace
       the ceiling outright on both. So it is read LIVE, per parameter, per
       battler, and never assumed or cached.

       RAISING it is the party module's job: it hooks paramMax wherever the game
       actually DEFINES it — which may be a subclass that shadows the base — and
       composes rather than competes, returning the larger of the game's value
       and its own so nothing is ever lowered. This module reuses that instead
       of installing a second hook, which would apply twice. With that module
       absent the ceiling is still read and shown, and the offer to raise it is
       simply not made.
       ------------------------------------------------------------------ */
    B.paramCap = function (battler, id) {
        if ($.party && $.party.paramCap) return $.party.paramCap(battler, id);
        return $.safe(function () {
            var max = battler.paramMax(id), min = battler.paramMin(id);
            return {
                max: (typeof max === 'number' && !isNaN(max)) ? max : null,
                min: (typeof min === 'number' && !isNaN(min)) ? min : null
            };
        }, 'paramCap p' + id, { max: null, min: null });
    };

    /* One engine ships an unbounded ceiling and the other three different
       finite numbers, so the clamp is rendered rather than printed raw. */
    B.capText = function (cap) {
        if ($.party && $.party.capText) return $.party.capText(cap);
        if (!cap || cap.max === null) return '?';
        var lo = cap.min === null ? '' : cap.min + '–';
        return lo + (cap.max === Infinity ? '∞' : cap.max);
    };

    B.capAvailable = function () {
        return !!($.party && $.party.capAvailable && $.party.capAvailable());
    };
    B.capWhy = function () {
        if (!$.party || !$.party.raiseParamCap) {
            return 'the party module did not load, and the parameter ceiling is raised there — so there is ' +
                'no raise to offer here. The ceiling itself is still read live and shown.';
        }
        return ($.party.capWhy && $.party.capWhy()) || '';
    };
    B.raiseParamCap = function (n) {
        if (!B.capAvailable()) return { ok: false, why: B.capWhy() };
        return $.party.raiseParamCap(n);
    };

    /* The most recent write a ceiling refused, so the panel can offer to raise
       THAT ceiling rather than making the user guess which one. */
    B.lastParamResult = null;

    function plusOf(battler, id) {
        return $.safe(function () {
            return (battler._paramPlus && battler._paramPlus[id]) || 0;
        }, 'paramPlus', 0);
    }

    /**
     * Enemy parameters, edited on the BATTLER and not in the database.
     *
     * addParam moves the battler's own offset, which is per-battler and
     * per-battle. Writing the database row would change every future encounter
     * with that enemy for the rest of the save — a different feature with a
     * much longer blast radius and no way to undo it from here.
     *
     * The write goes through addParam rather than a raw offset assignment: it
     * is the engine's own public path, it exists with the same signature on
     * both engines, and it calls refresh(), which re-clamps HP and MP against a
     * maximum that may have just moved. It takes a DELTA, so the offset is SET
     * rather than accumulated — dragging a slider would otherwise walk the
     * value away from the number under the cursor.
     *
     * WHAT IS VERIFIED is the offset, not the displayed parameter. The offset
     * is the only thing this write controls; the displayed number is that
     * offset put through a trait rate and a clamp, and an integer offset cannot
     * always land on an exact target through a fractional rate. Verifying the
     * offset marks the control degraded when a plugin is eating the write —
     * which is a compatibility failure worth naming — and never for arithmetic
     * that was always going to round.
     */
    B.setEnemyParam = function (enemy, paramId, value) {
        if (!enemy || !enemy.addParam) return false;
        if (!$.allowWrite('enemy parameter')) return false;

        var want = Math.max(0, Math.round(Number(value) || 0));
        var cap = B.paramCap(enemy, paramId);

        /* Refused BEFORE anything is written. No value of the offset can
           produce a number above the ceiling, so writing one and reading it
           back would spend the attempt only to report a number nobody asked
           for. The panel offers to raise the ceiling instead. */
        if (cap.max !== null && want > cap.max) {
            var refused = {
                ok: false, capped: true, want: want, cap: cap.max,
                enemy: enemy, id: paramId,
                message: P_NAMES(paramId) + ' is capped at ' + cap.max + ' on this build. param() is ' +
                    'recomputed and re-clamped on every read, so no write puts ' + want + ' there until ' +
                    'the ceiling moves.'
            };
            $.log('warn', enemy.name() + ': ' + refused.message);
            B.lastParamResult = refused;
            return false;
        }

        var before = $.safe(function () { return enemy.param(paramId); }, 'param', 0);
        var beforePlus = plusOf(enemy, paramId);
        var base = $.safe(function () { return enemy.paramBase(paramId); }, 'paramBase', 0);
        var rate = $.safe(function () {
            return enemy.paramRate(paramId) * enemy.paramBuffRate(paramId);
        }, 'paramRate', 1) || 1;

        // Invert the engine's own arithmetic once. Exact where the rate is 1,
        // and the closest an integer offset can get otherwise.
        var wantPlus = Math.round(want / rate) - base;

        var r = verify('battle.params',
            function () {
                $.safe(function () {
                    enemy.addParam(paramId, wantPlus - plusOf(enemy, paramId));
                }, 'addParam');
            },
            function () { return plusOf(enemy, paramId); },
            wantPlus);

        var settled = $.safe(function () { return enemy.param(paramId); }, 'param', before);

        if (plusOf(enemy, paramId) !== beforePlus) {
            $.undo.push('enemy ' + enemy.name() + ' ' + P_NAMES(paramId) + ' ' + before + ' → ' + settled,
                // Back to the PREVIOUS offset, not to zero: the offset is not
                // GigaHack's alone, and a plugin buff or a permanent-boost
                // effect living in it would be wiped by undoing an unrelated
                // edit.
                function () {
                    $.safe(function () {
                        enemy.addParam(paramId, beforePlus - plusOf(enemy, paramId));
                    }, 'undo enemy param');
                });
        }

        var atCap = cap.max !== null && settled >= cap.max;
        if (!r.ok) {
            $.log('warn', enemy.name() + ' ' + P_NAMES(paramId) + ' did not stick. ' + r.message);
        } else if (settled !== want) {
            $.log('info', enemy.name() + ' ' + P_NAMES(paramId) + ': asked for ' + want + ', settled on ' +
                settled + '. A trait rate cannot always land on an exact number with an integer offset, ' +
                'and the value is re-clamped to ' + B.capText(cap) + ' on every read.');
        } else {
            $.log('ok', enemy.name() + ' ' + P_NAMES(paramId) + ' = ' + settled +
                (atCap ? ' — which is this build\'s ceiling, so anything above it is discarded.' : ''));
        }

        B.lastParamResult = {
            ok: r.ok && settled === want, capped: false, want: want, got: settled,
            cap: cap.max, atCap: atCap, enemy: enemy, id: paramId, message: r.message
        };
        return r.ok;
    };

    function P_NAMES(id) {
        return $.safe(function () { return TextManager.param(id); }, 'param name', 'p' + id) || ('p' + id);
    }
    B.paramName = P_NAMES;

    /**
     * Back to the database values.
     *
     * clearParamPlus() is the engine's own public path and exists with the same
     * behaviour on both engines; refresh() afterwards re-clamps HP and MP
     * against maximums that have just moved back down.
     */
    B.resetEnemyParams = function (enemy) {
        if (!enemy) return false;
        if (!$.allowWrite('reset enemy parameters')) return false;
        return $.safe(function () {
            if (typeof enemy.clearParamPlus === 'function') enemy.clearParamPlus();
            else if (enemy._paramPlus) {
                for (var i = 0; i < enemy._paramPlus.length; i++) enemy._paramPlus[i] = 0;
            } else return false;
            enemy.refresh();
            B.lastParamResult = null;
            return true;
        }, 'reset enemy params', false);
    };

    /* ------------------------------------------------------ damage multiplier */

    var DMG_MIN = 0, DMG_MAX = 100;

    B.damageMultiplier = function () {
        // `|| 1` would turn the slider's own minimum into ×1, so a deliberate
        // zero read as "unchanged" while the panel said 0.
        var v = Number($.store.cfgGet('battle.damageMult', 1));
        return isFinite(v) ? $.clamp(v, DMG_MIN, DMG_MAX) : 1;
    };
    B.damageMultiplierOn = function () {
        return !!$.store.cfgGet('battle.damageMultOn', false);
    };

    /**
     * Multiply damage the PARTY deals.
     *
     * Hooked on makeDamageValue rather than on executeDamage: executeDamage is
     * also where recovery, drain and HP costs land, and multiplying those turns
     * a heal into an execution. makeDamageValue is only ever the number an
     * action produces, and its sign already says which way it goes.
     *
     * Healing is deliberately excluded: a negative value out of
     * makeDamageValue IS a heal, and scaling it by 20 alongside the damage
     * would make every potion a full restore without anyone asking for it.
     */
    $.install('Game_Action.makeDamageValue (multiplier)',
        typeof Game_Action !== 'undefined' ? Game_Action.prototype : null, 'makeDamageValue',
        function (original) {
            return function (target, critical) {
                var value = original.apply(this, arguments);
                if (!B.damageMultiplierOn()) return value;
                return $.safe(function () {
                    var subject = this.subject && this.subject();
                    if (!subject || !subject.isActor || !subject.isActor()) return value;
                    if (!(value > 0)) return value;      // a heal is not damage
                    return Math.round(value * B.damageMultiplier());
                }.bind(this), 'damage multiplier', value);
            };
        });

    /* ---------------------------------------------------------- force action */

    B.canForceAction = function () {
        return B.inBattle() && typeof BattleManager !== 'undefined' &&
            typeof BattleManager.forceAction === 'function';
    };

    B.forceWhy = function () {
        if (!B.inBattle()) return 'no battle is running';
        if (typeof BattleManager === 'undefined' || typeof BattleManager.forceAction !== 'function') {
            return 'BattleManager.forceAction is not available in this build';
        }
        return null;
    };

    /**
     * Make a battler use a skill right now.
     *
     * forceAction(skillId, targetIndex) with -1 lets the engine pick a target,
     * which is the only safe default: a fixed index into a troop that has since
     * lost members points at nothing, and the action is silently dropped.
     */
    B.forceAction = function (battler, skillId, targetIndex) {
        if (!B.canForceAction()) return false;
        if (!battler || !battler.forceAction) return false;
        if (!$.allowWrite('force an action')) return false;
        return $.safe(function () {
            battler.forceAction(Math.round(skillId) || 1, targetIndex == null ? -1 : targetIndex);
            BattleManager.forceAction(battler);
            $.log('ok', battler.name() + ' forced to use skill ' + skillId);
            return true;
        }, 'force action', false);
    };

    B.actionSkills = function () {
        return $.safe(function () {
            return $dataSkills.filter(function (sk) { return sk && sk.name; })
                .map(function (sk) { return { id: sk.id, name: sk.name }; });
        }, 'skills', []) || [];
    };

    U.panel('game', 'Enemies', function () { return buildEnemies(); }, 10);
    U.panel('game', 'Actions', function () { return buildActions(); }, 20);

    /**
     * Survival on the Player tab as well.
     *
     * God mode, free costs and the damage multiplier are things you reach for
     * while playing, not while looking at a troop — but they belong to the
     * battle system and their state lives here, so the panel is REGISTERED
     * twice rather than duplicated. One builder, two places, no second copy of
     * the state to drift.
     */
    U.panel('player', 'Survival', function () { return buildSurvival(); }, 70);

    function paintBadges() {
        U.setActive('god mode', !!cfg().god);
        U.setActive('free costs', !!cfg().freeCost);
        U.setActive('enemy bars', barOn());
    }
    $.on('mounted', paintBadges);
    if (U.getHost()) paintBadges();

    $.store.unsafeAtBoot('battle.bars.on',
        'the bars paint over the enemies and would be found already on after a crash');

    $.log('ok', 'battle tools ready — enemy bars ' +
        (B.barsAvailable() ? B.barsPath().label : 'unavailable (' + B.barsWhy() + ')') +
        ', parameter ceiling ' + (B.capAvailable() ? 'raisable' : 'read-only here'));

})(window.GigaHack);
