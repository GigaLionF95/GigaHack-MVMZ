//=============================================================================
// GigaHack MV/MZ
// 11 · inv.js — items, weapons, armors, gold
//-----------------------------------------------------------------------------
// Every write goes through the public Game_Party API so the engine's own
// bookkeeping (container cleanup, equipment discard, map refresh) still
// happens, and every write is read back through $.compat.verify.
//
// THE CAPS ARE THE WHOLE STORY HERE. Both engines clamp on the way in, in the
// same two places, and neither reports it:
//
//   Game_Party.gainItem → container[id] = clamp(0, this.maxItems(item))
//   Game_Party.gainGold → this._gold    = clamp(0, this.maxGold())
//
// Nothing throws, nothing returns false; the number simply is not the one that
// was asked for. Both ceilings are also commonly REPLACED outright (not
// aliased) by framework plugins — maxItems re-read per item from a field on
// the data object, maxGold raised to a plugin parameter — so a cap is read
// live, per item, immediately before every write, and shown next to the
// control. It is never cached and never assumed to be 99.
//
// When a cap refuses a value, the panel offers to RAISE THE CAP and says so.
// Two mechanisms are used together because which one works depends on what is
// installed: the per-item stack field on the data object, which a framework
// maxItems reads on every call and therefore honours immediately; and this
// module's own maxItems hook, which only ever raises. Writing $gameParty._gold
// or the item container directly bypasses the clamp entirely — that is the
// last resort, used only after the public API has demonstrably refused the
// value, and the UI says the value was forced past the game's own cap.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — inventory and gold
 * @author gigahack
 * @help GigaHack_Inv.js — requires Core, Caps, Store, UI, Shell, Hooks, Tabs,
 * Compat, Index
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.tab) { console.error('[GigaHack] shell missing — inv not installed'); return; }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols, clear = U.clear;

    /* =====================================================================
       SERVICES
       Compat and Index load before this module by manifest; a partial install
       still must not throw. Each shim has the surface of the real service and
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
       made inert: the cause may have gone away — a cap raised, a plugin's own
       state changed — and the only way to find out is to let the user try. */
    function degradeNote(control) {
        if (!degraded(control)) return null;
        return h('div', { class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px' },
            h('b', { text: 'writes here are not sticking. ' }),
            degradedWhy(control) + ' ',
            W.button({
                label: 'try again', mini: true, _ungated: true,
                tip: 'Try again|Re-tests on the next write; nothing is rewritten now.',
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
    var I = $.inv = {};

    var KINDS = {
        item: { data: function () { return $dataItems; }, label: 'Items' },
        weapon: { data: function () { return $dataWeapons; }, label: 'Weapons' },
        armor: { data: function () { return $dataArmors; }, label: 'Armors' }
    };

    function alive() {
        return typeof $gameParty !== 'undefined' && $gameParty &&
            typeof $dataItems !== 'undefined' && $dataItems;
    }
    I.alive = alive;

    I.list = function (kind) {
        if (!alive()) return [];
        var arr = $.safe(KINDS[kind].data, 'data ' + kind, null);
        if (!arr) return [];
        return arr.filter(function (o) { return o && o.name; });
    };

    I.count = function (item) {
        return $.safe(function () { return $gameParty.numItems(item); }, 'numItems', 0);
    };

    /**
     * A cheap "has anything the party carries moved" probe, for a panel that
     * has to decide whether to repaint.
     *
     * It reads the three containers directly rather than counting over the
     * database, because the containers hold one entry per STACK OWNED — tens
     * of them — while the database runs to four figures on a large game, and a
     * signal that walked the database once a tick would cost more than the
     * repaint it exists to avoid.
     *
     * A rolling hash rather than a sum: a sum cannot tell "one potion used" and
     * "one elixir found" in the same tick apart from nothing happening at all,
     * which is the one answer that leaves a wrong number on screen. Not a
     * checksum and not called one — a collision leaves a count stale until the
     * next change, and the counts move constantly.
     */
    I.revision = function () {
        return $.safe(function () {
            var hash = $gameParty.gold() | 0;
            var boxes = [$gameParty._items, $gameParty._weapons, $gameParty._armors];
            for (var b = 0; b < boxes.length; b++) {
                var box = boxes[b];
                hash = (hash * 33 + 7) | 0;
                if (!box) continue;
                for (var id in box) {
                    if (!Object.prototype.hasOwnProperty.call(box, id)) continue;
                    hash = (hash * 33 + (+id || 0)) | 0;
                    hash = (hash * 33 + (box[id] | 0)) | 0;
                }
            }
            return hash;
        }, 'inventory revision', 0);
    };

    /* =====================================================================
       CAPS
       Read live, per item, immediately before the write that depends on them.
       A cached cap is wrong the moment the user raises one, and an assumed cap
       is wrong on any game whose framework replaced maxItems or maxGold.
       ===================================================================== */

    /** This game's stack ceiling for ONE item, or null when it is unreadable. */
    I.stackCap = function (item) {
        if (!alive() || !item) return null;
        return $.safe(function () {
            var n = $gameParty.maxItems(item);
            return (typeof n === 'number' && isFinite(n)) ? n : null;
        }, 'maxItems', null);
    };

    /** Kept for callers that only want a number. */
    I.maxStack = function (item) {
        var n = I.stackCap(item);
        return n === null ? 99 : n;
    };

    I.goldCap = function () {
        if (!alive()) return null;
        return $.safe(function () {
            var n = $gameParty.maxGold();
            return (typeof n === 'number' && isFinite(n)) ? n : null;
        }, 'maxGold', null);
    };

    /* The most recent write result, so a panel that only got a boolean back
       can still offer to raise the cap that refused it. */
    I.lastResult = null;

    /**
     * The container write, WITHOUT the clamp.
     *
     * gainItem is the only path that keeps the party's containers canonical:
     * it deletes a zeroed entry, discards equipped copies when a count goes
     * negative, and asks the map to refresh so event page conditions
     * re-evaluate. Writing the container directly skips all of that, so it is
     * used only after the public API has demonstrably refused the value — and
     * the map refresh is re-issued by hand.
     */
    function forceCount(item, n) {
        return $.safe(function () {
            var c = null;
            if (typeof $gameParty.itemContainer === 'function') c = $gameParty.itemContainer(item);
            if (!c) {
                c = DataManager.isWeapon(item) ? $gameParty._weapons
                    : DataManager.isArmor(item) ? $gameParty._armors
                    : DataManager.isItem(item) ? $gameParty._items : null;
            }
            if (!c) return false;
            if (n <= 0) delete c[item.id]; else c[item.id] = n;
            if (typeof $gameMap !== 'undefined' && $gameMap && $gameMap.requestRefresh) $gameMap.requestRefresh();
            return true;
        }, 'force item count', false);
    }

    /**
     * One item write, verified. `opts` is {quiet, force, label}.
     * Returns { ok, before, after, want, cap, clamped, forced }.
     *
     * `clamped` distinguishes the game saying no from a compatibility problem:
     * the count landing exactly on the cap after asking for more is the game's
     * own documented behaviour and the user can raise it. Anything else that
     * ate the write is what $.compat.verify has already named.
     */
    function applyCount(item, want, opts) {
        opts = opts || {};
        var before = I.count(item);
        var cap = I.stackCap(item);
        var r = verify('inv.items',
            function () { I.withoutLocks(function () { $gameParty.gainItem(item, want - I.count(item), false); }); },
            function () { return I.count(item); },
            want);

        var after = I.count(item);
        var clamped = !r.ok && cap !== null && want > cap && after === cap;
        var forced = false;

        if (!r.ok && opts.force) {
            r = verify('inv.items',
                function () { forceCount(item, want); },
                function () { return I.count(item); },
                want);
            after = I.count(item);
            forced = r.ok;
            if (forced) {
                $.log('warn', '"' + item.name + '" forced to ' + want + ', past this game\'s own stack cap of ' +
                    cap + '. The container holds it now, but the cap is still ' + cap + ': the next time ' +
                    'anything calls gainItem on this item the engine will clamp it back. Raise the cap to keep it.');
            }
        }

        if (!opts.quiet && after !== before) {
            $.undo.push('item "' + item.name + '" ' + before + ' → ' + after, function () {
                I.withoutLocks(function () { $gameParty.gainItem(item, before - I.count(item), false); });
            });
        }
        if (!opts.quiet) {
            if (r.ok) $.log('ok', item.name + ': ' + before + ' → ' + after + (forced ? ' (forced past the cap)' : ''));
            else if (clamped) $.log('warn', item.name + ': asked for ' + want + ', this game caps the stack at ' +
                cap + ' and that is what stuck. Raise the cap in the Stack size panel to go higher.');
            else $.log('warn', item.name + ': asked for ' + want + ', got ' + after + '. ' + r.message);
        }

        var out = {
            kind: 'items', ok: r.ok, before: before, after: after, want: want,
            cap: cap, clamped: clamped, forced: forced, item: item, message: r.message
        };
        I.lastResult = out;
        return out;
    }
    I.applyCount = applyCount;

    /** Set an absolute count. Uses gainItem so containers stay canonical. */
    I.setCount = function (item, n, quiet, force) {
        if (!alive() || !item) return { ok: false, clamped: false, why: 'no item' };
        if (!quiet && !$.allowWrite('Changing "' + item.name + '"')) {
            return { ok: false, clamped: false, blocked: true, why: 'read-only' };
        }
        return applyCount(item, Math.max(0, Math.floor(n)), { quiet: quiet, force: force });
    };

    /** Relative change. Returns a plain boolean — other modules call this. */
    I.give = function (item, n) {
        if (!alive() || !item) return false;
        if (!$.allowWrite((n >= 0 ? 'Giving ' : 'Taking ') + Math.abs(n) + ' × ' + item.name)) return false;
        return applyCount(item, Math.max(0, I.count(item) + Math.floor(n)), {}).ok;
    };

    /* -------------------------------------------------------- raising caps
       Two mechanisms, applied together, because which one has any effect
       depends on what is installed:

         1. The per-item stack field on the data object. A framework maxItems
            re-reads it on every call, so the new ceiling is live immediately —
            no refresh, no reload. On a stock engine maxItems ignores it and
            this does nothing but is harmless.
         2. This module's own maxItems hook, which only ever RAISES (see below).
            That is what covers a stock engine, whose maxItems is a constant.

       $data* is rebuilt from the project files at every boot and is not part
       of a save, so a raised cap lasts for the session only. The panel says so.
       ------------------------------------------------------------------ */
    var CAP_FIELD = 'maxItem';

    I.raiseStackCap = function (item, n) {
        if (!alive() || !item) return { ok: false, why: 'no item' };
        if (!$.allowWrite('Raising the stack cap for "' + item.name + '"')) return { ok: false, why: 'read-only' };
        var before = I.stackCap(item);
        var want = Math.max(1, Math.floor(n));

        $.safe(function () { item[CAP_FIELD] = want; }, 'per-item stack cap');

        var cfg = $.cfg.inv || {};
        if (!cfg.maxItemsOverride || (Number(cfg.maxItems) || 0) < want) {
            $.store.cfgSet('inv.maxItems', Math.max(want, Number(cfg.maxItems) || 0));
            $.store.cfgSet('inv.maxItemsOverride', true);
        }

        var after = I.stackCap(item);
        var ok = after !== null && after >= want;
        $.log(ok ? 'ok' : 'warn', 'stack cap for "' + item.name + '": ' + before + ' → ' + after +
            (ok ? '' : ' — the cap did not move. ' + I.overrideWhy()));
        return { ok: ok, before: before, cap: after, want: want };
    };

    I.raiseGoldCap = function (n) {
        if (!alive()) return { ok: false, why: 'no party' };
        if (!$.allowWrite('Raising the gold cap')) return { ok: false, why: 'read-only' };
        var before = I.goldCap();
        var want = Math.max(1, Math.floor(n));
        $.store.cfgSet('inv.maxGold', want);
        $.store.cfgSet('inv.maxGoldOverride', true);
        var after = I.goldCap();
        var ok = after !== null && after >= want;
        $.log(ok ? 'ok' : 'warn', 'gold cap: ' + before + ' → ' + after +
            (ok ? '' : ' — the cap did not move. ' + I.overrideWhy('gold')));
        return { ok: ok, before: before, cap: after, want: want };
    };

    /* ------------------------------------------------------------- gold */
    I.gold = function () { return $.safe(function () { return $gameParty.gold(); }, 'gold', 0); };

    /**
     * Absolute gold. Returns the same result shape as applyCount.
     * gainGold clamps to maxGold; _gold is the field it writes, so writing it
     * directly is the same store without the clamp. That is the forced path
     * and it is only taken after the public one has failed.
     */
    I.setGold = function (v, force) {
        if (!alive()) return { ok: false, clamped: false, why: 'no party' };
        if (!$.allowWrite('Setting gold')) return { ok: false, clamped: false, blocked: true, why: 'read-only' };
        var before = I.gold();
        var want = Math.max(0, Math.floor(v));
        var cap = I.goldCap();

        var r = verify('inv.gold',
            function () { I.withoutLocks(function () { $gameParty.gainGold(want - I.gold()); }); },
            function () { return I.gold(); },
            want);
        var after = I.gold();
        var clamped = !r.ok && cap !== null && want > cap && after === cap;
        var forced = false;

        if (!r.ok && force) {
            r = verify('inv.gold',
                function () { $.safe(function () { $gameParty._gold = want; }, 'force gold'); },
                function () { return I.gold(); },
                want);
            after = I.gold();
            forced = r.ok;
            if (forced) {
                $.log('warn', 'gold forced to ' + want + ', past this game\'s own cap of ' + cap +
                    '. The party holds it now, but the cap is still ' + cap + ': the next time anything ' +
                    'gains or spends gold the engine will clamp it back. Raise the cap to keep it.');
            }
        }

        if (after !== before) {
            $.undo.push('gold ' + before + ' → ' + after, function () {
                I.withoutLocks(function () { $gameParty.gainGold(before - $gameParty.gold()); });
            });
        }
        if (r.ok) $.log('ok', 'gold: ' + before + ' → ' + after + (forced ? ' (forced past the cap)' : ''));
        else if (clamped) $.log('warn', 'gold: asked for ' + want + ', this game caps gold at ' + cap +
            ' and that is what stuck. Raise the cap to go higher.');
        else $.log('warn', 'gold: asked for ' + want + ', got ' + after + '. ' + r.message);

        var out = {
            kind: 'gold', ok: r.ok, before: before, after: after, want: want,
            cap: cap, clamped: clamped, forced: forced, message: r.message
        };
        I.lastResult = out;
        return out;
    };

    /** Bulk fill. Irreversible in practice, so it is a two-click danger action. */
    I.giveAll = function (kind, n) {
        if (!alive()) return 0;
        var list = I.list(kind), touched = 0, capped = 0, unknown = 0;
        list.forEach(function (o) {
            // Per item, because the ceiling is per item on any game whose
            // maxItems reads the data object. An unreadable ceiling is skipped
            // rather than guessed: gainItem would clamp against whatever
            // maxItems returned, and a non-number there corrupts the count.
            var cap = I.stackCap(o);
            if (cap === null) { unknown++; return; }
            var want = Math.min(n, cap);
            if (want < n) capped++;
            if (applyCount(o, want, { quiet: true }).ok) touched++;
        });
        $.log('warn', 'filled ' + touched + ' ' + kind + ' entries' +
            (capped ? ' — ' + capped + ' of them stop at their own stack cap' : '') +
            (unknown ? '; skipped ' + unknown + ' whose maxItems did not return a number' : ''));
        return touched;
    };

    I.clear = function (kind) {
        if (!alive()) return 0;
        var list = I.list(kind), touched = 0;
        list.forEach(function (o) { if (I.count(o) > 0) { applyCount(o, 0, { quiet: true }); touched++; } });
        $.log('warn', 'cleared ' + touched + ' ' + kind + ' stacks');
        return touched;
    };

    /* -------------------------------------------------- the cap overrides
       Both hooks COMPOSE rather than compete: with the override off they
       return exactly what the game returns, and with it on they return the
       LARGER of the two. A game — or a framework plugin — whose own ceiling is
       higher than ours keeps it, and nothing is ever lowered by GigaHack being
       installed. That is also what makes the hook survive a plugin that
       replaces maxItems outright: ours calls whatever is underneath it, so a
       later replacement is only a problem if it patches ON TOP of us, which
       Compat's alias-integrity check reports and I.overrideBypassed() detects.
       ------------------------------------------------------------------ */
    $.install('Game_Party.maxItems',
        typeof Game_Party !== 'undefined' ? Game_Party.prototype : null, 'maxItems',
        function (original) {
            return function (item) {
                var mine = original.apply(this, arguments);
                var cfg = $.cfg.inv || {};
                if (!cfg.maxItemsOverride) return mine;
                var want = Number(cfg.maxItems) || 0;
                return (typeof mine === 'number' && mine > want) ? mine : want;
            };
        },
        'Game_Party.maxItems is missing, so stack caps cannot be raised on this game');

    $.install('Game_Party.maxGold',
        typeof Game_Party !== 'undefined' ? Game_Party.prototype : null, 'maxGold',
        function (original) {
            return function () {
                var mine = original.apply(this, arguments);
                var cfg = $.cfg.inv || {};
                if (!cfg.maxGoldOverride) return mine;
                var want = Number(cfg.maxGold) || 0;
                return (typeof mine === 'number' && mine > want) ? mine : want;
            };
        },
        'Game_Party.maxGold is missing, so the gold cap cannot be raised on this game');


    /* =====================================================================
       ITEM COUNT LOCK

       The same idea as a frozen variable, and it needs the same machinery: the
       game changes item counts through Game_Party.gainItem, so the lock is a
       hook on that rather than a per-frame comparison. A frame-based lock
       would let a consumed item flicker to n-1 and back, and anything the game
       did in between would see the wrong number.

       Gold is included because "I keep losing money to this shop" is the same
       complaint. It hooks the two methods that move gold, not the same one.
       ===================================================================== */
    var locks = { item: {}, weapon: {}, armor: {}, gold: false };

    function keyOf(o) {
        if (!o) return null;
        var kind = DataManager.isWeapon(o) ? 'weapon' : DataManager.isArmor(o) ? 'armor' :
            DataManager.isItem(o) ? 'item' : null;
        return kind ? { kind: kind, id: o.id } : null;
    }

    I.isLocked = function (o) {
        var k = keyOf(o);
        return !!(k && locks[k.kind][k.id]);
    };

    I.lock = function (o, on) {
        var k = keyOf(o);
        if (!k) return false;
        if (!$.allowWrite('lock ' + (o.name || 'item'))) return false;
        if (on) locks[k.kind][k.id] = true; else delete locks[k.kind][k.id];
        $.log('info', (on ? 'locked ' : 'unlocked ') + (o.name || k.kind + ' ' + k.id));
        syncLockBadge();
        return true;
    };

    I.lockedCount = function () {
        return Object.keys(locks.item).length + Object.keys(locks.weapon).length +
            Object.keys(locks.armor).length + (locks.gold ? 1 : 0);
    };

    I.lockedList = function () {
        var out = [];
        ['item', 'weapon', 'armor'].forEach(function (kind) {
            Object.keys(locks[kind]).forEach(function (id) { out.push({ kind: kind, id: Number(id) }); });
        });
        return out;
    };

    I.clearLocks = function () {
        locks = { item: {}, weapon: {}, armor: {}, gold: false };
        syncLockBadge();
        $.log('info', 'all item locks released');
        return true;
    };

    I.goldLocked = function () { return !!locks.gold; };
    I.lockGold = function (on) {
        if (!$.allowWrite('lock gold')) return false;
        locks.gold = !!on;
        $.log('info', 'gold ' + (on ? 'locked' : 'unlocked'));
        syncLockBadge();
        return true;
    };

    function syncLockBadge() {
        U.setActive('items locked', I.lockedCount() > 0);
    }

    /**
     * Every item count change in the engine goes through gainItem — losing one
     * is gainItem(-1). Refusing the call outright is what makes the lock hold
     * against a shop, a consumable and an event alike.
     *
     * GigaHack's own writes go through I.setCount, which calls gainItem too, so
     * the lock has to be bypassable from here or the panel would refuse to
     * edit the very thing it just locked. `bypass` is that door, and it is
     * closed again in a finally so a throw cannot leave it open.
     */
    var bypass = false;
    I.withoutLocks = function (fn) {
        bypass = true;
        try { return fn(); } finally { bypass = false; }
    };

    $.install('Game_Party.gainItem (lock)',
        typeof Game_Party !== 'undefined' ? Game_Party.prototype : null, 'gainItem',
        function (original) {
            return function (item, amount, includeEquip) {
                if (!bypass && amount !== 0 && I.isLocked(item)) return;
                return original.apply(this, arguments);
            };
        });

    $.install('Game_Party.gainGold (lock)',
        typeof Game_Party !== 'undefined' ? Game_Party.prototype : null, 'gainGold',
        function (original) {
            return function (amount) {
                if (!bypass && locks.gold && amount !== 0) return;
                return original.apply(this, arguments);
            };
        });

    // loseGold is NOT just gainGold(-n) in MZ — Game_Party.loseGold calls
    // gainGold(-n), but a plugin that replaced one and not the other would
    // slip past. Hooking both costs nothing and closes that.
    $.install('Game_Party.loseGold (lock)',
        typeof Game_Party !== 'undefined' ? Game_Party.prototype : null, 'loseGold',
        function (original) {
            return function (amount) {
                if (!bypass && locks.gold && amount !== 0) return;
                return original.apply(this, arguments);
            };
        });

    /* ------------------------------------------------- override integrity
       Three different answers, and the UI needs all three: the hook was never
       installed (the method was not there to hook); the hook is installed and
       live; the hook is installed but something REPLACED the method after us,
       so raising a cap here now does nothing at all. The third is the one that
       looks like a bug in this menu and is not.
       ------------------------------------------------------------------ */
    function hookOf(which) {
        return $.hooks[which === 'gold' ? 'Game_Party.maxGold' : 'Game_Party.maxItems'] || null;
    }

    I.overrideAvailable = function (which) {
        var hk = hookOf(which);
        return !!(hk && hk.installed && !I.overrideBypassed(which));
    };

    I.overrideBypassed = function (which) {
        var hk = hookOf(which);
        if (!hk || !hk.installed || !hk.owner) return false;
        return hk.owner[hk.method] !== hk.patched;
    };

    I.overrideWhy = function (which) {
        var hk = hookOf(which);
        var name = which === 'gold' ? 'Game_Party.maxGold' : 'Game_Party.maxItems';
        if (!hk || !hk.installed) {
            return name + ' was not there to hook (' + ((hk && hk.reason) || 'not found') +
                '), so the cap cannot be raised from here.';
        }
        if (I.overrideBypassed(which)) {
            return name + ' is no longer the function GigaHack installed — a plugin that loads after ' +
                'GigaHack replaced it, so the raise never runs. Re-run the installer to move the GigaHack ' +
                'entry back to the end of js/plugins.js, or use Debug → Hooks to inspect it.';
        }
        return '';
    };

    /* =====================================================================
       SEARCH
       The index answers "which ids match this text" without walking every
       name, and is never authority: each candidate is re-resolved against the
       live database row before it is shown. When it cannot answer, the linear
       filter still can — the only cost is time — so its reason is shown and
       nothing else changes.
       ===================================================================== */
    var INDEX_KIND = { item: 'items', weapon: 'weapons', armor: 'armors' };

    function searchIds(kind, q) {
        var out = { ids: null, count: 0, why: '' };
        if (!q) return out;
        if (!$.index || !$.index.findByName) {
            out.why = 'the index module is not installed — searching the long way instead.';
            return out;
        }
        var r = $.safe(function () { return $.index.findByName(INDEX_KIND[kind], q); }, 'index search', null);
        if (!r) { out.why = 'the index query threw — searching the long way instead.'; return out; }
        if (!r.complete) { out.why = r.why; return out; }    // linear fallback, with the reason shown

        var arr = $.safe(KINDS[kind].data, 'data ' + kind, null) || [];
        var ids = Object.create(null), n = 0;
        (r.candidates || []).forEach(function (c) {
            if (!c || !(c.id > 0) || c.id >= arr.length) return;      // the index is ahead of this database
            var row = arr[c.id];
            if (!row || !row.name) return;                            // the row has gone
            if (String(row.name).toLowerCase().indexOf(q) === -1 && String(c.id).indexOf(q) === -1) return;
            if (!ids[c.id]) { ids[c.id] = true; n++; }
        });
        out.ids = ids; out.count = n;
        return out;
    }

    /* =====================================================================
       PART 2 — TAB
       ===================================================================== */
    var ROW_H = 17;

    function typeLabel(kind, o) {
        if (kind === 'item') return o.itypeId === 2 ? 'key' : 'item';
        if (kind === 'weapon') {
            return $.safe(function () { return $dataSystem.weaponTypes[o.wtypeId] || 'weapon'; }, 'wtype', 'weapon');
        }
        return $.safe(function () { return $dataSystem.equipTypes[o.etypeId] || 'armor'; }, 'etype', 'armor');
    }

    /* The most recent value a cap refused, so the panel can offer to raise
       THAT cap to THAT number instead of making the user guess. Cleared when
       it is taken up or dismissed. */
    var capOffer = null;      // {kind:'items'|'gold', item, want, cap}

    function noteRefusal(r) {
        if (r && r.clamped) capOffer = { kind: r.kind, item: r.item || null, want: r.want, cap: r.cap };
        return r;
    }

    function buildKind(kind) {
        var q = '', ownedOnly = false, lockedOnly = false, type = 'all';
        var searchWhy = '';

        var types = ['all'].concat(function () {
            var set = {}, out = [];
            I.list(kind).forEach(function (o) {
                var t = typeLabel(kind, o);
                if (!set[t]) { set[t] = 1; out.push(t); }
            });
            return out.sort();
        }());

        function rows() {
            // One index query per repaint, not one per row.
            var found = q ? searchIds(kind, q) : { ids: null, why: '' };
            searchWhy = found.why;
            return I.list(kind).filter(function (o) {
                if (ownedOnly && I.count(o) <= 0) return false;
                if (lockedOnly && !I.isLocked(o)) return false;
                if (type !== 'all' && typeLabel(kind, o) !== type) return false;
                if (q) {
                    if (found.ids) { if (!found.ids[o.id]) return false; }      // the index resolved it
                    else if (String(o.id).indexOf(q) === -1 && o.name.toLowerCase().indexOf(q) === -1) return false;
                }
                return true;
            });
        }

        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'id', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'type', w: '0 0 74px', cls: 'mm-td-num' },
                { label: 'price', w: '0 0 60px', cls: 'mm-td-num' },
                { label: 'have', w: '0 0 52px', cls: 'mm-td-val' },
                { label: 'cap', w: '0 0 46px', cls: 'mm-td-num' },
                { label: '', w: '0 0 26px' },
                { label: '', w: '0 0 128px' }
            ],
            empty: 'no matches',
            render: function (o) {
                // The ceiling is read per item, live, because that is how any
                // maxItems that reads the data object behaves.
                var cap = I.stackCap(o);
                return [
                    U.icon(o.iconIndex),
                    String(o.id),
                    h('span', { text: o.name }),
                    typeLabel(kind, o),
                    String(o.price == null ? '—' : o.price),
                    degradeMark(W.editCell(I.count(o), function (v) {
                        settle(I.setCount(o, parseInt(v, 10) || 0));
                    }), 'inv.items'),
                    h('span', {
                        class: 'mm-sub mm-mono',
                        text: cap === null ? '?' : String(cap),
                        tip: cap === null
                            ? 'Stack cap|maxItems returned no number for this item.'
                            : 'Stack cap|gainItem clamps this item to ' + cap + '. Ask for more and the panel ' +
                              'offers to raise it.'
                    }),
                    W.button({
                        label: I.isLocked(o) ? '■' : '□', mini: true,
                        tip: 'Lock|The game cannot change this count. You still can.',
                        onClick: function () { I.lock(o, !I.isLocked(o)); repaint(); U.rerender(); }
                    }),
                    h('div', { class: 'mm-cellbtns' },
                        W.button({ label: '−', mini: true, mutates: true, onClick: function () { I.give(o, -1); settle(I.lastResult); } }),
                        W.button({ label: '+1', mini: true, mutates: true, onClick: function () { I.give(o, 1); settle(I.lastResult); } }),
                        W.button({ label: '+10', mini: true, mutates: true, onClick: function () { I.give(o, 10); settle(I.lastResult); } }),
                        W.button({
                            label: 'max', mini: true, mutates: true,
                            tip: 'Max|Fills to this item\'s own cap.',
                            onClick: function () { settle(I.setCount(o, I.maxStack(o))); }
                        }))
                ];
            },
            onRow: function (tr, o) {
                if (I.count(o) > 0) tr.style.color = 'var(--mm-text-hi)';
                if (I.isLocked(o)) tr.style.color = 'var(--mm-accent)';
                var d = (o.description || '').split('\n')[0];
                tr.setAttribute('data-mm-tip', o.name + '|' + (d || 'no description'));
            }
        });

        var tag = h('span', { class: 'mm-group-tag' });
        /* Two live notices above the table: the index's reason when a search
           could not use it, and the compat module's reason when writes are not
           sticking. Repainted rather than built once, so a failure that happens
           with the panel open is visible without reopening it. */
        var whyEl = h('div', {
            class: 'mm-sub',
            style: 'padding:2px 6px;white-space:normal;color:var(--mm-warn);display:none'
        });
        var degradeHost = h('div', {});

        function repaint() {
            var r = rows();
            tag.textContent = r.length + ' / ' + I.list(kind).length;
            whyEl.textContent = searchWhy || '';
            whyEl.style.display = searchWhy ? '' : 'none';
            clear(degradeHost);
            var note = degradeNote('inv.items');
            if (note) degradeHost.appendChild(note);
            table.mm.paint(r);
        }

        /* After any write: a value the cap refused becomes an offer in the
           sidebar, which needs a full rerender; anything else just repaints. */
        function settle(r) {
            noteRefusal(r);
            if (r && r.clamped) U.rerender(); else repaint();
        }
        repaint();

        /* The "have" column is the party's count, and the game changes it every
           time an item is used, bought, sold or handed over by an event. With
           the "owned" chip on, the row SET moves with it too, which is why the
           whole list is repainted rather than the cells: the table is virtual,
           so a paint keeps the scroll position.

           within: the table. Its "have" cells become live inputs on a click and
           repainting one mid-edit takes the keystrokes with it — but the search
           box above is not in the thing being repainted, and a list that froze
           because its own filter held the caret is not what "hold" means. */
        U.live(I.revision, repaint, {
            name: kind + ' counts',
            within: table,
            when: function () { return !table.mm.isScrolling(); }
        });

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.search({
                placeholder: 'search ' + I.list(kind).length + ' ' + kind + 's…',
                onInput: function (v) { q = v.trim(); repaint(); }
            }),
            W.chip({ label: 'owned', value: false, onChange: function (v) { ownedOnly = v; repaint(); } }),
            W.chip({ label: 'locked', value: false, onChange: function (v) { lockedOnly = v; repaint(); } }),
            types.length > 2 ? W.dropdown({
                options: types, value: 'all', width: '104px', _ungated: true,
                onChange: function (v) { type = v; repaint(); }
            }) : null);

        var group = W.group(KINDS[kind].label, [toolbar, degradeHost, whyEl, table], { grow: true });
        group.mm.head.appendChild(tag);

        return cols({ narrow: true, items: sidebar(kind, repaint) }, [group]);
    }

    /* ------------------------------------------------------- the cap offers
       A cap that refused a value is not a failure to hide, and it is not a
       reason to disable the control either. It is a question with an answer:
       raise the cap to the number that was asked for, redo the write, and read
       it back. The offer says which cap, what it is now, and what it will be.
       ------------------------------------------------------------------ */
    function stackOffer() {
        if (!capOffer || capOffer.kind !== 'items' || !capOffer.item) return null;
        var o = capOffer, ok = I.overrideAvailable();
        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
            h('b', { text: 'the cap stopped that. ' }),
            'You asked for ' + o.want + ' × "' + o.item.name + '". This game caps that stack at ' +
            o.cap + ', so ' + o.cap + ' is what stuck. ',
            W.button({
                label: 'raise the cap to ' + o.want + ' and set it', wide: true, mutates: true,
                disabled: !ok,
                tip: 'Raise the cap|Session-only: the database reloads from the project files at ' +
                    'every launch.',
                onClick: function () {
                    var raised = I.raiseStackCap(o.item, o.want);
                    // force:true is the last resort, and only reachable here —
                    // after the public path has already been refused once.
                    var set = I.setCount(o.item, o.want, false, true);
                    capOffer = null;
                    U.toast({
                        title: !set.ok ? 'STILL CAPPED' : set.forced ? 'FORCED PAST THE CAP' : 'CAP RAISED',
                        msg: !set.ok
                            ? 'the cap did not move — ' + (I.overrideWhy() || set.message)
                            : set.forced
                                ? '"' + o.item.name + '" holds ' + set.after + ', but the cap is still ' +
                                  raised.cap + ': this was written straight into the party\'s container, ' +
                                  'past the game\'s own clamp. The next gainItem on it clamps it back.'
                                : '"' + o.item.name + '" cap ' + o.cap + ' → ' + raised.cap +
                                  ', count ' + set.after,
                        severity: set.ok && !set.forced ? 'ok' : 'warn'
                    });
                    U.rerender();
                }
            }),
            ok ? null : h('div', { style: 'padding-top:2px' }, I.overrideWhy()),
            W.button({
                label: 'leave it', mini: true, _ungated: true,
                onClick: function () { capOffer = null; U.rerender(); }
            }));
    }

    function goldOffer() {
        if (!capOffer || capOffer.kind !== 'gold') return null;
        var o = capOffer, ok = I.overrideAvailable('gold');
        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
            h('b', { text: 'the cap stopped that. ' }),
            'You asked for ' + o.want + ' gold. This game caps gold at ' + o.cap + ', so ' + o.cap +
            ' is what stuck. ',
            W.button({
                label: 'raise the cap to ' + o.want + ' and set it', wide: true, mutates: true,
                disabled: !ok,
                tip: 'Raise the cap|Session-only, and stored in GigaHack\'s settings, not in the ' +
                    'save.',
                onClick: function () {
                    var raised = I.raiseGoldCap(o.want);
                    var set = I.setGold(o.want, true);
                    capOffer = null;
                    U.toast({
                        title: !set.ok ? 'STILL CAPPED' : set.forced ? 'FORCED PAST THE CAP' : 'CAP RAISED',
                        msg: !set.ok
                            ? 'the cap did not move — ' + (I.overrideWhy('gold') || set.message)
                            : set.forced
                                ? 'the party holds ' + set.after + ', but the cap is still ' + raised.cap +
                                  ': this was written straight into the gold field, past the game\'s own ' +
                                  'clamp. The next gain or purchase clamps it back.'
                                : 'gold cap ' + o.cap + ' → ' + raised.cap + ', gold ' + set.after,
                        severity: set.ok && !set.forced ? 'ok' : 'warn'
                    });
                    U.rerender();
                }
            }),
            ok ? null : h('div', { style: 'padding-top:2px' }, I.overrideWhy('gold')),
            W.button({
                label: 'leave it', mini: true, _ungated: true,
                onClick: function () { capOffer = null; U.rerender(); }
            }));
    }

    /** The gold block, shared by the sidebar and the Gold sub-tab. */
    function goldRows(step) {
        var cap = I.goldCap();

        /* Gold moves on every sale, every battle and every event that hands
           some over, so the readout is live — and only the readout. The box
           under it is seeded from the same number and is what somebody types
           into; rewriting that from a clock would take a half-typed amount
           away. This runs for the Gold panel and for the sidebar of the three
           item panels, because both are built from here. */
        var currentEl = h('div', { class: 'mm-edge mm-mono mm-hi', text: String(I.gold()) });
        var currentRow = h('div', { class: 'mm-row' },
            h('div', { class: 'mm-lab', text: 'Current' }),
            currentEl);
        U.live(I.gold, function () { currentEl.textContent = String(I.gold()); },
            { name: 'gold', within: currentRow });

        return [
            currentRow,
            h('div', { class: 'mm-row', 'data-mm-tip': 'Cap|gainGold clamps to maxGold, ' +
                'read live — a plugin may replace it.' },
                h('div', { class: 'mm-lab', text: 'This game\'s cap' }),
                h('div', {
                    class: 'mm-edge mm-mono mm-sub',
                    text: cap === null ? 'unreadable' : String(cap)
                })),
            // No upper bound on the box on purpose: asking for more than the
            // cap is how the offer to raise it appears. A box that refused the
            // number would hide the very thing the user needs to know.
            W.row('Set to', degradeMark(W.number({
                value: I.gold(), min: 0, step: step || 1000, wide: true, label: 'Gold',
                onChange: function (v) { noteRefusal(I.setGold(v)); U.rerender(); }
            }), 'inv.gold')),
            h('div', { class: 'mm-inline', style: 'padding:2px' },
                W.button({ label: '+1k', mutates: true, onClick: function () { noteRefusal(I.setGold(I.gold() + 1000)); U.rerender(); } }),
                W.button({ label: '+10k', mutates: true, onClick: function () { noteRefusal(I.setGold(I.gold() + 10000)); U.rerender(); } }),
                W.button({
                    label: cap === null ? 'to the cap' : 'to the cap (' + cap + ')',
                    mutates: true, disabled: cap === null,
                    onClick: function () { noteRefusal(I.setGold(cap)); U.rerender(); }
                })),
            degradeNote('inv.gold'),
            goldOffer()
        ];
    }

    function sidebar(kind, repaint) {
        var out = [];
        var goldCap = I.goldCap();

        out.push(W.group('Gold', goldRows(1000).concat([
            W.toggleRow('Lock the gold', {
                value: I.goldLocked(), keybind: false,
                tip: 'Lock|Shops, rewards and events bounce off. You can still set it here.',
                onChange: function (v) { I.lockGold(v); U.rerender(); }
            })
        ]), { tag: I.goldLocked() ? 'locked' : 'cap ' + (goldCap === null ? '?' : goldCap) }));

        out.push(W.group('Locks', [
            h('div', { class: 'mm-row' },
                h('div', { class: 'mm-lab', text: 'Held' }),
                h('div', { class: 'mm-edge mm-mono ' + (I.lockedCount() ? 'mm-hi' : 'mm-sub'), text: String(I.lockedCount()) })),
            W.button({
                label: 'release every lock', wide: true, _ungated: true,
                disabled: !I.lockedCount(),
                onClick: function () { I.clearLocks(); U.rerender(); }
            }),
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Locks last for the session — they are not written into the save.')
        ], { tag: I.lockedCount() ? 'active' : 'none', collapsed: !I.lockedCount() }));

        out.push(W.group('Stack size', [
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'gainItem clamps every count to maxItems(item), and says nothing when it does. ' +
                'This raise never lowers anything: it returns the larger of the game\'s own answer and ' +
                'the limit below, so a game whose cap is already higher keeps it. It lasts for this ' +
                'session — the database is rebuilt from the project files at every launch.'),
            W.toggleRow('Raise maxItems', {
                value: !!($.cfg.inv || {}).maxItemsOverride,
                _ungated: true,
                tip: 'maxItems|The ceiling gainItem clamps to.',
                onChange: function (v) { $.store.cfgSet('inv.maxItemsOverride', v); U.rerender(); }
            }),
            W.row('Limit', W.number({
                value: ($.cfg.inv || {}).maxItems || 999, min: 1, step: 100, wide: true,
                _ungated: true,
                disabled: !($.cfg.inv || {}).maxItemsOverride,
                onChange: function (v) { $.store.cfgSet('inv.maxItems', v); }
            })),
            stackOffer(),
            I.overrideAvailable() ? null : h('div', {
                class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px',
                text: I.overrideWhy()
            })
        ], { tag: I.overrideAvailable() ? 'raising' : 'unavailable' }));

        out.push(W.group('Bulk', [
            W.button({
                label: 'fill every ' + kind + ' to its own cap', wide: true, variant: 'danger', mutates: true,
                confirmLabel: 'fill inventory?',
                onClick: function () {
                    if (!$.allowWrite('Bulk filling the inventory')) return;
                    // Infinity, deliberately: giveAll clamps each entry to
                    // that entry's own live cap rather than to a literal.
                    var n = I.giveAll(kind, Infinity);
                    U.toast({ title: 'FILLED', msg: n + ' ' + kind + ' entries filled to their caps', severity: 'warn' });
                    repaint();
                }
            }),
            W.button({
                label: 'clear all ' + kind + 's', wide: true, variant: 'danger', mutates: true,
                confirmLabel: 'really clear?',
                onClick: function () {
                    if (!$.allowWrite('Clearing the inventory')) return;
                    var n = I.clear(kind);
                    U.toast({ title: 'CLEARED', msg: n + ' ' + kind + ' stacks emptied', severity: 'warn' });
                    repaint();
                }
            }),
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Bulk actions are not undoable.')
        ], { tag: 'danger' }));

        return out;
    }

    /* ------------------------------------------------------------ Gold sub */
    function buildGold() {
        var cap = I.goldCap();

        /* One row per kind, counting what the party actually carries. This is
           the one readout here that costs a walk over the whole database, so
           it is done in the paint and never in the signal: I.revision() reads
           the party's own containers, which hold one entry per stack owned. */
        var totalCells = [];
        function totalsRow(kind, label) {
            var cell = h('div', { class: 'mm-edge mm-mono mm-sub', text: totalsText(kind) });
            totalCells.push({ kind: kind, el: cell });
            return h('div', { class: 'mm-row' }, h('div', { class: 'mm-lab', text: label }), cell);
        }
        function totalsText(kind) {
            var owned = I.list(kind).filter(function (o) { return I.count(o) > 0; });
            var units = owned.reduce(function (n, o) { return n + I.count(o); }, 0);
            return owned.length + ' kinds · ' + units + ' units';
        }
        var totalsGroup = W.group('Totals', [
            totalsRow('item', 'Items'),
            totalsRow('weapon', 'Weapons'),
            totalsRow('armor', 'Armors')
        ], { tag: 'carried' });

        U.live(I.revision, function () {
            for (var i = 0; i < totalCells.length; i++) {
                totalCells[i].el.textContent = totalsText(totalCells[i].kind);
            }
        }, { name: 'carried totals', within: totalsGroup });

        return cols([
            W.group('Gold', goldRows(1).concat([
                h('div', { class: 'mm-sep' }),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    [100, 1000, 10000, 100000].map(function (n) {
                        return W.button({
                            label: '+' + n, mutates: true,
                            onClick: function () { noteRefusal(I.setGold(I.gold() + n)); U.rerender(); }
                        });
                    })),
                h('div', { class: 'mm-inline', style: 'padding:2px' },
                    W.button({ label: 'zero', variant: 'danger', mutates: true, onClick: function () { I.setGold(0); U.rerender(); } })),
                h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'Anything above the cap does not stick until the cap is raised.')
            ]), { tag: 'cap ' + (cap === null ? '?' : cap) })
        ], [totalsGroup]);
    }

    /* -------------------------------------------------------- registration */
    function noParty() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'no party yet' }),
                h('div', { text: 'start or load a game, then reopen this tab' })));
    }
    function held(fn) { return function () { return I.alive() ? fn() : noParty(); }; }

    U.panel('items', 'Items', held(function () { return buildKind('item'); }), 10);
    U.panel('items', 'Weapons', held(function () { return buildKind('weapon'); }), 20);
    U.panel('items', 'Armors', held(function () { return buildKind('armor'); }), 30);
    U.panel('items', 'Gold', held(buildGold), 40);

    $.log('ok', 'inventory ready — caps read live per item, every write verified');

})(window.GigaHack);
