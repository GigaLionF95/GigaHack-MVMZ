//=============================================================================
// GigaHack MV/MZ
// 31 · kit.js — equipment loadouts, and an ad-hoc shop
//-----------------------------------------------------------------------------
// TWO FEATURES, AND BOTH OF THEM ARE ABOUT SAYING NO BEFORE WRITING.
//
// A LOADOUT IS A SEQUENCE, NOT A SET OF FIELDS. Party writes one field at a
// time and deliberately does not order them; a kit has to, because the engine's
// own methods undo each other when they run in the wrong order:
//
//   class  changeClass re-derives the level from the NEW class's exp, so a
//          level written first is thrown away by it.
//   level  changeExp's level-up loop calls levelUp(), which learns the new
//          class's own learnings on the way up — so a skill list written
//          before the level is a list the level then adds to.
//   skills only now, when nothing else will add to them.
//   equip  after the class, because canEquip() is a property of the class and
//          Game_Actor.refresh() calls releaseUnequippableItems(false) on EVERY
//          refresh — gear restored under the old class is silently traded back
//          into the party bag the moment the class moves.
//   params last. addParam refreshes, and a refresh releases; anything that
//          survived the equip step survives this one, and nothing that did not
//          would have survived anyway.
//
// applyOrder() exports that sequence because it is a load-bearing fact rather
// than an implementation detail, and it is the thing the tests assert on.
//
// changeEquip's TWO GATES ARE JOINED BY && AND THE LEFT ONE HAS SIDE EFFECTS.
// It reads:
//
//   if (this.tradeItemWithParty(item, this.equips()[slotId]) &&
//       (!item || this.equipSlots()[slotId] === item.etypeId)) { ...set... }
//
// tradeItemWithParty has ALREADY given the old item back to the party and taken
// the new one out of it by the time the etype comparison runs. A mismatched
// etype therefore leaves the party holding the old item AND wearing it, with
// the new one destroyed, and nothing throws or returns false. So this module
// tests the etype ITSELF, before ever calling changeEquip. That is stock
// behaviour on both engines and it is the reason the difference table computes
// every refusal with no writes at all.
//
// forceChangeEquip DOES NOT FORCE. It sets the slot and then calls
// releaseUnequippableItems(true) in the same call, so it bypasses party
// ownership and a LOCKED slot — and nothing else. A SEALED equip type, or a
// weapon/armor type the actor's traits do not grant, is stripped again before
// the method returns. There is no durable write that beats canEquip: writing
// _equips[i].setObject(item) by hand is undone by the next refresh. So the
// force toggle says exactly that, and a slot the engine took back is reported
// as released rather than as applied.
//
// equipSlots() IS READ LIVE, ALWAYS. On a stock project it happens to be
// $dataSystem.equipTypes.length - 1 for every actor, which makes a hard-coded
// five look correct on a clean game and wrong on every game with an equip-slot
// plugin. Dual wield changes the second slot's TYPE without changing the count,
// so a length test alone does not catch it either. Nothing here assumes a
// count, an order, or that two actors agree.
//
// THERE IS NO SHOP OBJECT IN EITHER ENGINE. A shop is an event command:
// Shop Processing collects its 302/605 rows into a goods array and then does
//
//   if (!$gameParty.inBattle()) {
//       SceneManager.push(Scene_Shop);
//       SceneManager.prepareNextScene(goods, purchaseOnly);
//   }
//
// and that is the whole of it. So the honest artefact is a goods list plus that
// same two-step, in that order — prepareNextScene reads the scene the push has
// just constructed, and preparing first throws. A goods row is [type, id,
// priceType, price] on both engines, priceType 0 meaning "read the item's own
// price". The engine's own buy window drops a row whose id does not resolve
// with a bare `if (item)` and the shop simply opens shorter, so every row is
// re-resolved against the live database and the dropped ones are named here
// rather than left to the engine's silence.
//
// KITS AND THE GOODS DRAFT LIVE IN GIGAHACK'S OWN STORE, not in the save and
// not in settings.json. They follow the install rather than the playthrough,
// which is what makes "put that actor back the way they were" survive a load.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — equipment loadouts and an ad-hoc shop
 * @author gigahack
 * @help GigaHack_Kit.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat, Index, Inv, Party
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — kit not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;

    var K = $.kit = {};
    var S = K.shop = {};

    var KIT_FILE = 'kits.json';
    var SHOP_FILE = 'shop.json';
    var ROW_H = 17;
    var PARAM_N = 8;

    /* =====================================================================
       PART 0 — SETTINGS

       This module owns no entry in Store's DEFAULTS table, so every key it
       reads carries its own default here and nowhere else. One table, read
       through one accessor: a default that lived at the read site would be
       written down five times and disagree with itself on the sixth.
       ===================================================================== */
    var DEFAULTS = {
        'loadout.applyClass': true,
        'loadout.applyLevel': true,
        'loadout.applySkills': true,
        'loadout.applyParams': true,
        'loadout.applyEquip': true,
        'loadout.provideMissing': false,
        'loadout.force': false,
        'loadout.max': 40,
        'shop.purchaseOnly': false,
        'shop.priceMode': 'database',
        'shop.priceValue': 100,
        'shop.closeOnOpen': true,
        'shop.kind': 'item'
    };
    /** The dotted keys and defaults this module reads, for the settings panel
     *  and for anyone auditing what is stored where. */
    K.settingDefaults = function () { return $.clone(DEFAULTS); };

    function get(key) {
        var v = $.safe(function () { return $.store.cfgGet('kit.' + key, undefined); },
            'cfg kit.' + key, undefined);
        return (v === undefined || v === null) ? DEFAULTS[key] : v;
    }
    function set(key, v) { return $.store.cfgSet('kit.' + key, v); }
    function bool(key) { return !!get(key); }
    function num(key, lo, hi) {
        var v = Number(get(key));
        if (typeof v !== 'number' || v !== v || !isFinite(v)) v = DEFAULTS[key];
        return v < lo ? lo : v > hi ? hi : v;
    }
    function pick(key, allowed) {
        var v = String(get(key));
        return allowed.indexOf(v) > -1 ? v : DEFAULTS[key];
    }

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
       made inert: the cause may have gone away — a class changed, a plugin's
       own state moved — and the only way to find out is to let the user try. */
    function degradeNote(control) {
        if (!degraded(control)) return null;
        return h('div', { class: 'mm-sub', style: 'color:var(--mm-warn);white-space:normal;padding:2px' },
            h('b', { text: 'writes here are not sticking. ' }),
            degradedWhy(control) + ' ',
            W.button({
                label: 'try again', mini: true, _ungated: true,
                tip: 'Try again|Clears the mark; the next write is re-tested.',
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
       PART 1 — THE EQUIPMENT FACTS

       Everything below reads the actor and the database live. No count, no
       slot order and no name is cached: $data* is rebuilt at every launch and
       the Forge adds and scrubs rows underneath a saved kit.
       ===================================================================== */
    function alive() {
        return typeof $gameParty !== 'undefined' && $gameParty &&
            typeof $dataSystem !== 'undefined' && $dataSystem &&
            typeof $dataWeapons !== 'undefined' && $dataWeapons;
    }
    K.alive = alive;

    function slotsOf(actor) {
        return $.safe(function () { return actor.equipSlots() || []; }, 'equipSlots', []) || [];
    }
    function equipsOf(actor) {
        return $.safe(function () { return actor.equips() || []; }, 'equips', []) || [];
    }
    K.slots = slotsOf;

    function etypeName(id) {
        return $.safe(function () {
            return ($dataSystem.equipTypes && $dataSystem.equipTypes[id]) || ('slot type ' + id);
        }, 'equipTypes', 'slot type ' + id);
    }
    function wtypeName(id) {
        return $.safe(function () {
            return ($dataSystem.weaponTypes && $dataSystem.weaponTypes[id]) || ('weapon type ' + id);
        }, 'weaponTypes', 'weapon type ' + id);
    }
    function atypeName(id) {
        return $.safe(function () {
            return ($dataSystem.armorTypes && $dataSystem.armorTypes[id]) || ('armor type ' + id);
        }, 'armorTypes', 'armor type ' + id);
    }
    function className(id) {
        return $.safe(function () {
            return ($dataClasses[id] && $dataClasses[id].name) || ('class ' + id);
        }, 'class name', 'class ' + id);
    }
    function paramName(id) {
        if ($.party && $.party.paramName) return $.party.paramName(id);
        return $.safe(function () { return TextManager.param(id); }, 'param name', 'p' + id) || ('p' + id);
    }

    /* Which container a data object lives in, asked of DataManager rather than
       inferred from its fields — an object forged as a plain record and never
       filed under $dataWeapons has a wtypeId and is still not a weapon, and
       canEquip agrees with DataManager, not with the field. */
    function kindOf(o) {
        return $.safe(function () {
            if (DataManager.isWeapon(o)) return 'weapon';
            if (DataManager.isArmor(o)) return 'armor';
            if (DataManager.isItem(o)) return 'item';
            return null;
        }, 'kindOf', null);
    }
    K.kindOf = kindOf;

    function resolve(kind, id) {
        return $.safe(function () {
            if (!(id > 0)) return null;
            if (kind === 'weapon') return $dataWeapons[id] || null;
            if (kind === 'armor') return $dataArmors[id] || null;
            if (kind === 'item') return $dataItems[id] || null;
            return null;
        }, 'resolve ' + kind + ' ' + id, null);
    }
    K.resolve = resolve;

    function owns(item) {
        // hasItem with ONE argument, exactly as tradeItemWithParty calls it:
        // includeEquip defaults false, so a copy on another actor's body does
        // not count and re-applying a kit to its own actor needs the identical
        // slot skipped rather than the ownership test relaxed.
        return $.safe(function () { return !!$gameParty.hasItem(item); }, 'hasItem', false);
    }
    function sealed(actor, etypeId) {
        return $.safe(function () { return !!actor.isEquipTypeSealed(etypeId); }, 'isEquipTypeSealed', false);
    }
    function locked(actor, etypeId) {
        return $.safe(function () { return !!actor.isEquipTypeLocked(etypeId); }, 'isEquipTypeLocked', false);
    }
    function canEquip(actor, item) {
        return $.safe(function () { return !!actor.canEquip(item); }, 'canEquip', false);
    }

    /** Why canEquip said no, by TYPE NAME rather than as a bare refusal. */
    function typeWhy(actor, item) {
        var k = kindOf(item);
        if (k === 'weapon') {
            return className(actor._classId) + ' cannot use ' + wtypeName(item.wtypeId) +
                ' weapons — no equip-weapon-type trait on this actor grants it.';
        }
        if (k === 'armor') {
            return className(actor._classId) + ' cannot wear ' + atypeName(item.atypeId) +
                ' armor — no equip-armor-type trait on this actor grants it.';
        }
        return 'this row is neither a weapon nor an armor in the loaded database, so canEquip ' +
            'answers false for it whatever fields it carries.';
    }

    /**
     * Everything that would stop one slot, computed with NO writes.
     * Returns null, or { code, why }. This is the sole source of both the
     * difference table's last column and the per-row unavailable reasons, so a
     * refusal shown there is never a surprise at apply time.
     */
    K.refusal = function (actor, slots, slotId, item, opts) {
        opts = opts || {};
        if (slotId >= slots.length) {
            return {
                code: 'no such slot',
                why: 'this kit records ' + (slotId + 1) + ' slots and ' + actor.name() + ' has ' +
                    slots.length + '. equipSlots() is per actor and is read live, so the extra ' +
                    'slots are dropped rather than written somewhere they do not exist.'
            };
        }
        if (!item) return null;                       // clearing a slot is always allowed
        var etype = slots[slotId];
        if (item.etypeId !== etype) {
            return {
                code: 'wrong slot type',
                why: 'this slot takes ' + etypeName(etype) + ' and "' + item.name + '" is ' +
                    etypeName(item.etypeId) + '. changeEquip trades the item through the party ' +
                    'BEFORE it compares the types, so calling it here would take the new item out of ' +
                    'the bag and leave the old one both in the bag and in the slot. The write is ' +
                    'refused instead of made.'
            };
        }
        if (sealed(actor, etype)) {
            return {
                code: 'slot sealed',
                why: 'a trait seals ' + etypeName(etype) + ' on ' + actor.name() +
                    '. releaseUnequippableItems empties a sealed slot, and forceChangeEquip calls it ' +
                    'in the same breath — so forcing this slot sets it and empties it again before ' +
                    'the method returns.'
            };
        }
        if (!canEquip(actor, item)) {
            return { code: 'cannot equip', why: typeWhy(actor, item) };
        }
        if (!owns(item) && !opts.force) {
            return {
                code: 'not owned',
                why: 'the party is not carrying "' + item.name + '". changeEquip trades from the ' +
                    'party bag, so an item nobody owns cannot be equipped. "provide a missing item" ' +
                    'gives one first; "force the slot" skips the trade entirely.'
            };
        }
        return null;
    };

    /* =====================================================================
       PART 2 — HOOKS

       Three observers. None of them changes what the engine does; each exists
       because the method underneath reports nothing at all, and a loadout that
       half-applied with no explanation is indistinguishable from a bug in this
       menu.
       ===================================================================== */

    /* 1. Scene_Shop.prepare — the only moment a shop's goods exist as data.
          There is no shop object anywhere in either engine, so this is both
          the read-back that verify('shop.open') needs and the way every shop
          the game itself opens becomes an editable draft. */
    K.lastShop = null;
    var pendingGoods = null;      // identity marker: is the prepare we see ours?

    $.install('Scene_Shop.prepare (goods observer)',
        typeof Scene_Shop !== 'undefined' ? Scene_Shop.prototype : null, 'prepare',
        function (original) {
            return function (goods, purchaseOnly) {
                var out = original.apply(this, arguments);
                $.safe(function () {
                    var copy = [];
                    if (goods && goods.length) {
                        for (var i = 0; i < goods.length; i++) {
                            copy.push(goods[i] && goods[i].slice ? goods[i].slice() : goods[i]);
                        }
                    }
                    K.lastShop = {
                        goods: copy,
                        purchaseOnly: !!purchaseOnly,
                        ours: goods === pendingGoods,
                        frame: $.frameCount,
                        at: Date.now()
                    };
                }, 'record shop goods');
                return out;
            };
        },
        'Scene_Shop.prototype.prepare is absent — this build has no shop scene, or a plugin ' +
        'replaced it under another name. The shop opener is disabled and says so, and shops the ' +
        'game opens itself cannot be captured.');

    /* 2. Game_Actor.changeEquip — returns nothing at all. It either takes the
          setObject branch or silently does not, and a read of equips()
          afterwards cannot tell "the engine's own guard refused it" from
          "something after us undid it on the next refresh". Recording both
          sides is what turns a failed verify into a sentence. It also puts the
          one write path this module depends on into $.hooks, so a plugin that
          replaces changeEquip after GigaHack loaded is reported by
          Compat's alias integrity instead of being invisible. */
    K.lastEquip = null;
    K.equipCalls = 0;

    $.install('Game_Actor.changeEquip (kit)',
        typeof Game_Actor !== 'undefined' ? Game_Actor.prototype : null, 'changeEquip',
        function (original) {
            return function (slotId, item) {
                var self = this;
                var before = $.safe(function () {
                    return (self._equips && self._equips[slotId]) ? self._equips[slotId].object() : null;
                }, 'changeEquip before', null);
                var out = original.apply(this, arguments);
                $.safe(function () {
                    var after = (self._equips && self._equips[slotId]) ? self._equips[slotId].object() : null;
                    K.equipCalls++;
                    K.lastEquip = {
                        actorId: self.actorId ? self.actorId() : 0,
                        slotId: slotId,
                        want: item ? item.name : '(empty)',
                        wantId: item ? item.id : 0,
                        before: before ? before.name : '(empty)',
                        after: after ? after.name : '(empty)',
                        applied: after === (item || null)
                    };
                }, 'record changeEquip');
                return out;
            };
        },
        'Game_Actor.prototype.changeEquip is absent — a plugin has replaced the equipment API. ' +
        'Kit falls back to forceChangeEquip for every slot, and says on each row that the engine\'s ' +
        'own ownership and slot-type rules are no longer being run.');

    /* 3. Game_Actor.releaseUnequippableItems — the method that makes a
          half-applied loadout look like a bug in this menu. refresh() calls it
          on every refresh and forceChangeEquip calls it immediately after
          setting a slot, so a class change or an impossible force silently
          empties slots and (when forcing is false) trades the items back into
          the bag. Nothing logs it and nothing throws.

          It rides on one of the hottest methods in the engine, so the unarmed
          path is a single boolean test and nothing else — no allocation, no
          $.safe, no equips() call. The arming flag is cleared in a finally, so
          a throw during an apply cannot leave it on for the session. */
    var releaseWatch = null;

    $.install('Game_Actor.releaseUnequippableItems (kit)',
        typeof Game_Actor !== 'undefined' ? Game_Actor.prototype : null, 'releaseUnequippableItems',
        function (original) {
            return function (forcing) {
                if (!releaseWatch || releaseWatch.actor !== this) return original.apply(this, arguments);
                var self = this, rep = releaseWatch;
                var before = $.safe(function () { return self.equips().slice(); }, 'release before', null);
                var out = original.apply(this, arguments);
                $.safe(function () {
                    if (!before) return;
                    var after = self.equips(), slots = self.equipSlots();
                    for (var i = 0; i < before.length; i++) {
                        if (before[i] && after[i] !== before[i]) {
                            rep.released.push({
                                slotId: i,
                                slot: etypeName(slots[i]),
                                name: before[i].name,
                                tradedBack: !forcing
                            });
                        }
                    }
                }, 'release diff');
                return out;
            };
        },
        'Game_Actor.prototype.releaseUnequippableItems is absent, so slots the engine empties ' +
        'during an apply cannot be attributed. A kit may finish with fewer slots filled than it ' +
        'recorded; the difference table after the apply is then the only report of it.');

    K.releaseWatched = function () {
        var hk = $.hooks['Game_Actor.releaseUnequippableItems (kit)'];
        return !!(hk && hk.installed);
    };

    /* =====================================================================
       PART 3 — KITS
       ===================================================================== */
    var kits = null;

    function validKit(k) {
        return !!(k && typeof k === 'object' && typeof k.name === 'string' && k.name &&
            Object.prototype.toString.call(k.slots) === '[object Array]');
    }

    function all() {
        if (kits) return kits;
        var raw = $.store.read(KIT_FILE, null);
        var rows = (raw && Object.prototype.toString.call(raw.kits) === '[object Array]') ? raw.kits : [];
        var dropped = 0;
        kits = [];
        for (var i = 0; i < rows.length; i++) {
            if (validKit(rows[i])) kits.push(rows[i]); else dropped++;
        }
        if (dropped) {
            $.log('warn', KIT_FILE + ': dropped ' + dropped + ' row(s) with no name or no slot list. ' +
                'A kit without either cannot be applied or found again.');
        }
        return kits;
    }
    function persist() { $.store.write(KIT_FILE, { kits: all() }, true); }

    /** Re-read both files from the store. Exposed for the settings panel's
     *  "reload from disk" and so a check can prove persistence is real. */
    K.reload = function () { kits = null; draft = null; draftNames = null; return { kits: all().length, goods: goods().length }; };
    K.file = function () { return KIT_FILE; };
    K.max = function () { return num('loadout.max', 1, 500); };

    K.list = function () { return $.clone(all()); };
    K.get = function (name) {
        var rows = all();
        for (var i = 0; i < rows.length; i++) if (rows[i].name === name) return rows[i];
        return null;
    };

    /**
     * Everything about one actor that a kit restores.
     *
     * ids, never data objects: $data* is rebuilt at every launch and the Forge
     * can add and scrub rows under a stored kit. The NAME of every recorded id
     * is kept beside it as a tombstone, so a row whose id has gone can still
     * say what it was instead of showing a number.
     */
    K.capture = function (actor) {
        if (!actor) return null;
        return $.safe(function () {
            var slots = slotsOf(actor), eq = equipsOf(actor), out = [];
            for (var i = 0; i < slots.length; i++) {
                var o = eq[i] || null;
                out.push({
                    etypeId: slots[i],
                    kind: o ? kindOf(o) : null,
                    id: o ? o.id : 0,
                    name: o ? o.name : ''
                });
            }
            return {
                name: '',
                at: Date.now(),
                frame: $.frameCount,
                actorId: actor.actorId(),
                actorName: actor.name(),
                classId: actor._classId,
                className: className(actor._classId),
                level: actor.level,
                dualWield: $.safe(function () { return !!actor.isDualWield(); }, 'isDualWield', false),
                skills: (actor._skills || []).slice(),
                paramPlus: (actor._paramPlus || []).slice(),
                slots: out
            };
        }, 'capture kit', null);
    };

    K.save = function (actor, name) {
        if (!$.allowWrite('Saving a kit')) {
            return { ok: false, why: 'read-only mode is on, so saving a kit was refused. ' +
                'Settings → Behaviour turns it off.' };
        }
        var want = String(name == null ? '' : name).replace(/^\s+|\s+$/g, '');
        if (!want) return { ok: false, why: 'a kit needs a name — the name is how you get it back.' };
        if (K.get(want)) {
            return { ok: false, why: 'a kit called "' + want + '" already exists — rename it or delete ' +
                'the old one. Nothing is replaced silently.' };
        }
        var cap = K.max();
        if (all().length >= cap) {
            return { ok: false, why: 'this build keeps at most ' + cap + ' kits so the store file stays ' +
                'small; delete one first.' };
        }
        var kit = K.capture(actor);
        if (!kit) return { ok: false, why: 'the actor could not be read, so there is nothing to save.' };
        kit.name = want;
        all().push(kit);
        persist();
        $.log('ok', 'kit "' + want + '" saved from ' + kit.actorName + ' — ' + kit.slots.length +
            ' slot(s), ' + kit.skills.length + ' skill(s). Kits live in ' + KIT_FILE +
            ', not in the save, so they follow the install rather than the playthrough.');
        return { ok: true, kit: kit };
    };

    K.remove = function (name) {
        if (!$.allowWrite('Deleting a kit')) return false;
        var rows = all();
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].name === name) {
                rows.splice(i, 1);
                persist();
                $.log('warn', 'kit "' + name + '" deleted');
                return true;
            }
        }
        return false;
    };

    K.rename = function (from, to) {
        if (!$.allowWrite('Renaming a kit')) return { ok: false, why: 'read-only' };
        var want = String(to == null ? '' : to).replace(/^\s+|\s+$/g, '');
        if (!want) return { ok: false, why: 'a kit needs a name — the name is how you get it back.' };
        if (want !== from && K.get(want)) {
            return { ok: false, why: 'a kit called "' + want + '" already exists.' };
        }
        var k = K.get(from);
        if (!k) return { ok: false, why: 'there is no kit called "' + from + '" any more.' };
        k.name = want;
        persist();
        return { ok: true };
    };

    /* ------------------------------------------------------------- the diff
       Computed with NO writes. Every row carries the refusal that slot would
       hit, so the table is a preview of the apply and not a summary of it. */
    K.diff = function (actor, kit) {
        if (!actor || !kit) return [];
        return $.safe(function () {
            var rows = [];
            var slots = slotsOf(actor), eq = equipsOf(actor);
            var opts = liveOpts();

            if (kit.classId && kit.classId !== actor._classId) {
                rows.push({
                    what: 'class', label: 'Class', index: -1,
                    now: className(actor._classId), want: className(kit.classId),
                    refusal: '', why: 'changeClass re-derives the level from the new class\'s own exp, ' +
                        'so the level moves with it.'
                });
            }
            if (kit.level && kit.level !== actor.level) {
                var ml = maxLevelOf(actor);
                var over = !ml.uncapped && ml.cap !== null && kit.level > ml.cap;
                rows.push({
                    what: 'level', label: 'Level', index: -1,
                    now: String(actor.level), want: String(kit.level),
                    refusal: over ? 'above the cap' : '',
                    why: over ? actor.name() + ' is capped at level ' + ml.cap + ' here, so ' + ml.cap +
                        ' is what would be written.' : ''
                });
            }
            var learn = 0, forget = 0, i;
            var have = (actor._skills || []);
            for (i = 0; i < kit.skills.length; i++) if (have.indexOf(kit.skills[i]) < 0) learn++;
            for (i = 0; i < have.length; i++) if (kit.skills.indexOf(have[i]) < 0) forget++;
            if (learn || forget) {
                rows.push({
                    what: 'skills', label: 'Skills', index: -1,
                    now: have.length + ' learned',
                    want: (learn ? '+' + learn : '') + (learn && forget ? ' ' : '') + (forget ? '−' + forget : ''),
                    refusal: '', why: ''
                });
            }
            for (i = 0; i < kit.slots.length; i++) {
                var rec = kit.slots[i];
                var item = rec.id ? resolve(rec.kind, rec.id) : null;
                var nowItem = eq[i] || null;
                var gone = rec.id > 0 && !item;
                if (!gone && nowItem === item) continue;
                var ref = gone
                    ? { code: 'id gone', why: '"' + (rec.name || rec.kind + ' ' + rec.id) + '" was ' +
                        rec.kind + ' ' + rec.id + ' when this kit was saved and the loaded database has ' +
                        'no such row now. The name is the tombstone this kit kept; every other slot ' +
                        'still applies.' }
                    : K.refusal(actor, slots, i, item, opts);
                rows.push({
                    what: 'slot', index: i,
                    label: i < slots.length ? etypeName(slots[i]) : 'slot ' + (i + 1),
                    now: nowItem ? nowItem.name : '—',
                    want: item ? item.name : (rec.id ? rec.name || ('#' + rec.id) : '—'),
                    icon: item ? item.iconIndex : (nowItem ? nowItem.iconIndex : -1),
                    refusal: ref ? ref.code : '',
                    why: ref ? ref.why : '',
                    note: (i < slots.length && locked(actor, slots[i]))
                        ? 'this slot is locked by a trait. The game\'s own equip menu refuses it; ' +
                          'changeEquip does not consult the lock, so this write still lands.'
                        : ''
                });
            }
            for (i = 0; i < PARAM_N; i++) {
                var mine = (actor._paramPlus && actor._paramPlus[i]) || 0;
                var theirs = (kit.paramPlus && kit.paramPlus[i]) || 0;
                if (mine === theirs) continue;
                rows.push({
                    what: 'param', index: i, label: paramName(i),
                    now: String(mine), want: String(theirs), refusal: '',
                    why: 'the manual bonus only — equipment and anything else that alters paramPlus ' +
                        'is not part of a kit.'
                });
            }
            return rows;
        }, 'kit diff', []) || [];
    };

    /* ----------------------------------------------------------- the writes */
    function liveOpts(over) {
        var o = {
            applyClass: bool('loadout.applyClass'),
            applyLevel: bool('loadout.applyLevel'),
            applySkills: bool('loadout.applySkills'),
            applyParams: bool('loadout.applyParams'),
            applyEquip: bool('loadout.applyEquip'),
            provide: bool('loadout.provideMissing'),
            force: bool('loadout.force')
        };
        if (over) { for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) o[k] = over[k]; }
        return o;
    }
    K.options = liveOpts;

    function maxLevelOf(actor) {
        if ($.party && $.party.maxLevel) return $.party.maxLevel(actor);
        var n = $.safe(function () { return actor.maxLevel(); }, 'maxLevel', 99);
        if (typeof n !== 'number' || !isFinite(n) || n <= 0) return { cap: null, uncapped: true, raw: n };
        return { cap: n, uncapped: false, raw: n };
    }

    /** Give the party one copy, honouring the Items panel's own locks. */
    function provideOne(item, report) {
        if (!$.inv || !$.inv.give) {
            return { ok: false, why: 'the inventory module did not load, so a missing item cannot be ' +
                'provided. Debug → Environment lists which modules ran.' };
        }
        if ($.inv.isLocked && $.inv.isLocked(item)) {
            return { ok: false, why: '"' + item.name + '" is locked in the Items panel, and a locked ' +
                'count cannot be changed. Release the lock there, or turn "provide a missing item" off ' +
                'and "force the slot" on.' };
        }
        var gave = $.inv.give(item, 1);
        if (!gave || !owns(item)) {
            return { ok: false, why: 'giving one "' + item.name + '" did not stick, so the trade that ' +
                'changeEquip performs would still refuse the slot.' };
        }
        if (report) report.created.push(item.name);
        return { ok: true };
    }

    /**
     * The single verified equipment write, reused by apply and by the panel.
     * Returns { ok, forced, skipped, refusal, why, before, after }.
     */
    K.equipOne = function (actor, slotId, item, opts, report) {
        opts = opts || {};
        var slots = slotsOf(actor);
        var out = {
            ok: false, forced: false, skipped: false, refusal: '', why: '',
            slotId: slotId, slot: slotId < slots.length ? etypeName(slots[slotId]) : 'slot ' + (slotId + 1),
            before: equipsOf(actor)[slotId] || null, after: null, name: item ? item.name : '(empty)'
        };

        /* Identity, not id. equips() hands back the data OBJECT, the Forge can
           rebuild $data* under a stored kit, and hasItem is false for what the
           actor is already wearing — so a slot that already holds the wanted
           record has to be skipped before ownership is ever asked about, or
           re-applying a kit to its own actor refuses every slot. */
        if (out.before === (item || null)) {
            out.ok = true; out.skipped = true; out.after = out.before;
            return out;
        }

        /* The RAW refusal, asked without the force exemption. K.refusal takes
           opts so the difference table can show "force would get past this",
           but the write cannot: turning force on does not make changeEquip
           stop trading with the party, it only decides which method is called.
           Asking the forgiving question here would send an unowned item down
           the changeEquip path, where the trade refuses it in silence. */
        var ref = K.refusal(actor, slots, slotId, item, {});
        if (ref && ref.code === 'not owned' && opts.provide) {
            var made = provideOne(item, report);
            if (made.ok) ref = K.refusal(actor, slots, slotId, item, {});
            else ref = { code: 'not owned', why: made.why };
        }

        var forcing = false;
        if (ref) {
            if (!opts.force) { out.refusal = ref.code; out.why = ref.why; return out; }
            // force skips the party trade and walks past a LOCKED slot. It does
            // not skip an etype mismatch (which would be an unwritable slot) or
            // a missing row, so those still refuse.
            if (ref.code === 'no such slot' || ref.code === 'wrong slot type' || ref.code === 'id gone') {
                out.refusal = ref.code; out.why = ref.why; return out;
            }
            forcing = true;
            out.why = ref.why;
        }

        var r = verify('party.equip',
            function () {
                $.safe(function () {
                    if (forcing) actor.forceChangeEquip(slotId, item || null);
                    else actor.changeEquip(slotId, item || null);
                }, forcing ? 'forceChangeEquip' : 'changeEquip');
            },
            function () { return equipsOf(actor)[slotId] || null; },
            item || null);

        out.after = equipsOf(actor)[slotId] || null;
        out.forced = forcing;
        out.ok = out.after === (item || null);
        if (!out.ok) {
            out.refusal = forcing ? 'released' : 'did not stick';
            out.why = forcing
                ? 'the slot was set and the engine emptied it again inside the same call — ' +
                  'forceChangeEquip runs releaseUnequippableItems(true) immediately after setObject. ' +
                  (out.why || 'canEquip refuses this item for this actor.')
                : (r.message || 'changeEquip returned without setting the slot.');
        }
        return out;
    };

    K.applyOrder = function () { return ['class', 'level', 'skills', 'equip', 'params']; };

    /**
     * Restore an actor to a captured state without touching the undo stack,
     * the read-only gate or compat's degraded marks. This is a rollback, not a
     * user edit — it puts each slot back the way that slot was written, so a
     * slot the apply forced is forced back and a slot it traded is traded back.
     */
    function rollback(actor, before, plan) {
        $.safe(function () {
            if (before.classId !== actor._classId) actor.changeClass(before.classId, true);
            var ml = maxLevelOf(actor);
            if (ml.uncapped) actor.changeExp(actor.expForLevel(before.level), false);
            else actor.changeLevel(before.level, false);

            var have = (actor._skills || []).slice(), i;
            for (i = 0; i < have.length; i++) if (before.skills.indexOf(have[i]) < 0) actor.forgetSkill(have[i]);
            for (i = 0; i < before.skills.length; i++) actor.learnSkill(before.skills[i]);

            var slots = slotsOf(actor);
            for (i = 0; i < before.slots.length && i < slots.length; i++) {
                var rec = before.slots[i];
                var item = rec.id ? resolve(rec.kind, rec.id) : null;
                var cur = equipsOf(actor)[i] || null;
                if (cur === item) continue;
                var forced = plan && plan[i];
                if (!forced && (!item || slots[i] === item.etypeId) && (!item || owns(item))) {
                    actor.changeEquip(i, item);
                } else {
                    actor.forceChangeEquip(i, item);
                }
            }

            actor.clearParamPlus();
            for (i = 0; i < PARAM_N; i++) {
                var v = (before.paramPlus && before.paramPlus[i]) || 0;
                if (v) actor.addParam(i, v);
            }
            actor.refresh();
        }, 'kit rollback');
    }

    /**
     * Apply one kit. ONE undo entry for the whole call, never one per slot.
     *
     * Order is class, level, skills, equipment, parameter bonuses — see the
     * header, and applyOrder(), which the tests assert on rather than on a
     * copy of the array.
     */
    K.apply = function (actor, kit, over) {
        var report = {
            ok: false, blocked: false, actor: actor, kit: kit && kit.name,
            steps: [], refused: [], released: [], created: [], dropped: [], message: ''
        };
        if (!actor || !kit) { report.message = 'no actor or no kit.'; return report; }
        if (!$.allowWrite('Applying the kit "' + kit.name + '"')) {
            report.blocked = true;
            report.message = 'read-only mode is on, so applying "' + kit.name + '" was refused and ' +
                'nothing was written. Settings → Behaviour turns it off.';
            $.log('warn', report.message);
            return report;
        }
        var opts = liveOpts(over);
        if (!opts.applyClass && !opts.applyLevel && !opts.applySkills && !opts.applyEquip && !opts.applyParams) {
            report.message = 'nothing is selected to apply — every "what to apply" toggle is off.';
            return report;
        }

        var before = K.capture(actor);
        var plan = {};
        report.actor = actor;
        /* Armed only for the duration of this call, and only for THIS actor:
           refresh() is one of the hottest methods in the engine and a flag
           left on would make every refresh in the session allocate two
           equips() arrays. The finally below is what guarantees that. */
        releaseWatch = { actor: actor, released: report.released };
        try {
            /* 1. CLASS. First, because it re-derives the level and decides
                  which items canEquip will accept for the rest of the run. */
            if (opts.applyClass && kit.classId && kit.classId !== actor._classId) {
                var wasClass = actor._classId;
                var rc = verify('party.class',
                    function () { $.safe(function () { actor.changeClass(kit.classId, true); }, 'changeClass'); },
                    function () { return actor._classId; },
                    kit.classId);
                report.steps.push({
                    what: 'class', ok: rc.ok, from: className(wasClass), to: className(kit.classId),
                    message: rc.message
                });
                if (!rc.ok) report.refused.push({ what: 'class', why: rc.message });
            }

            /* 2. LEVEL. After the class, because changeClass has just moved it. */
            if (opts.applyLevel && kit.level) {
                var ml = maxLevelOf(actor);
                var want = Math.max(1, Math.floor(kit.level));
                var clamped = false;
                if (!ml.uncapped && ml.cap !== null && want > ml.cap) { want = ml.cap; clamped = true; }
                var rl = verify('party.exp',
                    function () {
                        $.safe(function () {
                            // changeLevel clamps to maxLevel(), so a game that
                            // reports no cap would have every level clamped to
                            // that number. Writing the exp for the level asks
                            // for the same thing without going through it.
                            if (ml.uncapped) actor.changeExp(actor.expForLevel(want), false);
                            else actor.changeLevel(want, false);
                        }, 'set level');
                    },
                    function () { return actor.level; },
                    want);
                report.steps.push({
                    what: 'level', ok: rl.ok, want: Math.floor(kit.level), got: actor.level,
                    cap: ml.cap, clamped: clamped,
                    message: clamped
                        ? 'the kit was recorded at level ' + Math.floor(kit.level) + ' and ' +
                          actor.name() + ' is capped at ' + ml.cap + ' here, so ' + actor.level +
                          ' is the level that stuck.'
                        : rl.message
                });
                if (clamped) report.refused.push({ what: 'level', why: report.steps[report.steps.length - 1].message });
            }

            /* 3. SKILLS. After the level, because levelUp() learns the class's
                  own learnings on the way up — a list written first is a list
                  the level then adds to. */
            if (opts.applySkills && kit.skills) {
                var target = kit.skills.slice().sort(function (a, b) { return a - b; });
                var learned = 0, forgot = 0;
                var rs = verify('party.skills',
                    function () {
                        $.safe(function () {
                            var have = (actor._skills || []).slice(), j;
                            for (j = 0; j < have.length; j++) {
                                if (target.indexOf(have[j]) < 0) { actor.forgetSkill(have[j]); forgot++; }
                            }
                            for (j = 0; j < target.length; j++) {
                                if (!actor.isLearnedSkill(target[j])) { actor.learnSkill(target[j]); learned++; }
                            }
                        }, 'restore skills');
                    },
                    function () {
                        return (actor._skills || []).slice().sort(function (a, b) { return a - b; }).join(',');
                    },
                    target.join(','));
                report.steps.push({
                    what: 'skills', ok: rs.ok, learned: learned, forgot: forgot, message: rs.message
                });
                if (!rs.ok) report.refused.push({ what: 'skills', why: rs.message });
            }

            /* 4. EQUIPMENT. After the class, so canEquip is the class the kit
                  was recorded for rather than the one being left behind. */
            if (opts.applyEquip && kit.slots) {
                var slots = slotsOf(actor);
                var moved = 0;
                for (var i = 0; i < kit.slots.length; i++) {
                    var rec = kit.slots[i];
                    if (i >= slots.length) {
                        report.dropped.push({
                            slotId: i, name: rec.name || '(empty)',
                            why: 'this kit records ' + kit.slots.length + ' slots and ' + actor.name() +
                                ' has ' + slots.length + '. Slot ' + (i + 1) + ' has nowhere to go.'
                        });
                        continue;
                    }
                    var item = rec.id ? resolve(rec.kind, rec.id) : null;
                    if (rec.id > 0 && !item) {
                        report.refused.push({
                            what: 'slot', slotId: i, slot: etypeName(slots[i]),
                            name: rec.name || (rec.kind + ' ' + rec.id), code: 'id gone',
                            why: '"' + (rec.name || (rec.kind + ' ' + rec.id)) + '" was ' + rec.kind +
                                ' ' + rec.id + ' when this kit was saved and the loaded database has no ' +
                                'such row now. Every other slot still applies.'
                        });
                        continue;
                    }
                    var r = K.equipOne(actor, i, item, opts, report);
                    if (r.forced) plan[i] = true;
                    if (r.ok && !r.skipped) moved++;
                    if (!r.ok) {
                        report.refused.push({
                            what: 'slot', slotId: i, slot: r.slot, name: r.name,
                            code: r.refusal, why: r.why
                        });
                    }
                }
                report.steps.push({ what: 'equip', ok: !report.refused.length, moved: moved, slots: slots.length });
            }

            /* 5. PARAMETER BONUSES. The manual offset is CLEARED first: a kit
                  recording a zero has to remove a bonus that is there, and
                  adding a difference would leave it. */
            if (opts.applyParams && kit.paramPlus) {
                var wantPlus = [];
                for (var p = 0; p < PARAM_N; p++) wantPlus.push((kit.paramPlus[p] || 0));
                var rp = verify('party.param',
                    function () {
                        $.safe(function () {
                            actor.clearParamPlus();
                            for (var q = 0; q < PARAM_N; q++) if (wantPlus[q]) actor.addParam(q, wantPlus[q]);
                            actor.refresh();
                        }, 'restore paramPlus');
                    },
                    function () { return (actor._paramPlus || []).slice(0, PARAM_N).join(','); },
                    wantPlus.join(','));
                report.steps.push({ what: 'params', ok: rp.ok, message: rp.message });
                if (!rp.ok) report.refused.push({ what: 'params', why: rp.message });
            }
        } finally {
            releaseWatch = null;
        }

        report.ok = !report.refused.length && !report.dropped.length;
        report.message = 'kit "' + kit.name + '" → ' + actor.name() + ': ' +
            report.steps.length + ' step(s)' +
            (report.created.length ? ', ' + report.created.length + ' item(s) provided' : '') +
            (report.released.length ? ', ' + report.released.length + ' slot(s) released by the engine' : '') +
            (report.dropped.length ? ', ' + report.dropped.length + ' slot(s) dropped' : '') +
            (report.refused.length ? ', ' + report.refused.length + ' refused' : '');

        $.undo.push('kit "' + kit.name + '" applied to ' + before.actorName, function () {
            rollback(actor, before, plan);
        });

        $.log(report.ok ? 'ok' : 'warn', report.message +
            (report.refused.length ? ' — ' + report.refused[0].why : ''));
        K.lastReport = report;
        return report;
    };
    K.lastReport = null;

    /* ------------------------------------------------------ export / import */
    K.exportKit = function (name) {
        var k = K.get(name);
        return k ? JSON.stringify(k, null, 2) : '';
    };

    K.importKit = function (text) {
        var parsed = $.safe(function () { return JSON.parse(String(text)); }, 'parse kit', null);
        if (!parsed || typeof parsed !== 'object') {
            return { ok: false, why: 'that is not JSON. Paste the whole object a "copy this kit" ' +
                'button produced, braces included.' };
        }
        if (typeof parsed.name !== 'string' || !parsed.name) {
            return { ok: false, why: 'the pasted kit has no "name" field, and the name is how a kit is ' +
                'found again.' };
        }
        if (Object.prototype.toString.call(parsed.slots) !== '[object Array]') {
            return { ok: false, why: 'the pasted kit has no "slots" array, so there is no equipment ' +
                'to restore and nothing to compare an actor against.' };
        }
        if (!$.allowWrite('Importing a kit')) return { ok: false, why: 'read-only' };
        if (K.get(parsed.name)) {
            return { ok: false, why: 'a kit called "' + parsed.name + '" already exists — rename the ' +
                'pasted one or delete the old one.' };
        }
        if (all().length >= K.max()) {
            return { ok: false, why: 'this build keeps at most ' + K.max() + ' kits; delete one first.' };
        }
        // Missing optional fields are filled rather than trusted: a kit written
        // by an older build has no paramPlus, and an undefined there would go
        // into addParam as NaN.
        if (Object.prototype.toString.call(parsed.skills) !== '[object Array]') parsed.skills = [];
        if (Object.prototype.toString.call(parsed.paramPlus) !== '[object Array]') parsed.paramPlus = [];
        all().push(parsed);
        persist();
        $.log('ok', 'kit "' + parsed.name + '" imported');
        return { ok: true, kit: parsed };
    };

    /* =====================================================================
       PART 4 — THE SHOP

       A goods row is [type, id, priceType, price] and that is the whole
       contract. The draft is GigaHack's own file, so it survives a launch and
       is shown as something found rather than something just built.
       ===================================================================== */
    var draft = null;
    var draftNames = null;

    function goodRow(g) {
        return !!(g && g.length >= 2 && typeof g[0] === 'number' && g[0] >= 0 && g[0] <= 2 &&
            typeof g[1] === 'number' && g[1] > 0);
    }
    function normRow(g) {
        return [g[0], g[1], typeof g[2] === 'number' ? g[2] : 0, typeof g[3] === 'number' ? g[3] : 0];
    }
    function goods() {
        if (draft) return draft;
        var raw = $.store.read(SHOP_FILE, null);
        var rows = (raw && Object.prototype.toString.call(raw.goods) === '[object Array]') ? raw.goods : [];
        draft = [];
        draftNames = (raw && raw.names && typeof raw.names === 'object') ? raw.names : {};
        for (var i = 0; i < rows.length; i++) if (goodRow(rows[i])) draft.push(normRow(rows[i]));
        S.fromDisk = !!(raw && rows.length);
        return draft;
    }
    function saveGoods() { $.store.write(SHOP_FILE, { goods: goods(), names: draftNames || {} }, true); }
    function nameKey(type, id) { return type + ':' + id; }

    S.file = function () { return SHOP_FILE; };
    S.fromDisk = false;
    S.goods = function () { return goods(); };
    S.count = function () { return goods().length; };

    var TYPE_KIND = ['item', 'weapon', 'armor'];
    function typeOf(item) {
        var k = kindOf(item);
        var i = TYPE_KIND.indexOf(k);
        return i < 0 ? 0 : i;
    }

    function priceFor(item) {
        var mode = pick('shop.priceMode', ['database', 'fixed', 'percent']);
        var db = (item && typeof item.price === 'number') ? item.price : null;
        if (mode === 'fixed') return { type: 1, value: Math.max(0, Math.floor(num('shop.priceValue', 0, 99999999))) };
        if (mode === 'percent') {
            // A row the Forge created can have no price at all, and
            // `goods[2] === 0 ? item.price : goods[3]` would then put undefined
            // into the shop. Default to 0 and say the row had none.
            var base = db === null ? 0 : db;
            return { type: 1, value: Math.max(0, Math.floor(base * num('shop.priceValue', 0, 99999999) / 100)) };
        }
        return { type: 0, value: 0 };
    }

    S.add = function (item) {
        if (!item) return false;
        var p = priceFor(item);
        var row = [typeOf(item), item.id, p.type, p.value];
        goods().push(row);
        if (!draftNames) draftNames = {};
        draftNames[nameKey(row[0], row[1])] = item.name;
        saveGoods();
        return true;
    };
    S.removeAt = function (i) {
        var g = goods();
        if (i < 0 || i >= g.length) return false;
        g.splice(i, 1); saveGoods(); return true;
    };
    S.moveAt = function (i, delta) {
        var g = goods(), j = i + delta;
        if (i < 0 || i >= g.length || j < 0 || j >= g.length) return false;
        var tmp = g[i]; g[i] = g[j]; g[j] = tmp;
        saveGoods(); return true;
    };
    S.clear = function () { draft = []; draftNames = {}; saveGoods(); return true; };
    S.has = function (item) {
        if (!item) return false;
        var t = typeOf(item), g = goods();
        for (var i = 0; i < g.length; i++) if (g[i][0] === t && g[i][1] === item.id) return true;
        return false;
    };

    /** null means priceType 0 — "read the item's own price". */
    S.setPrice = function (i, value) {
        var g = goods();
        if (i < 0 || i >= g.length) return false;
        if (value === null || value === undefined || value === '' || value === '-') {
            g[i][2] = 0; g[i][3] = 0;
        } else {
            var n = Math.max(0, Math.floor(Number(value)));
            if (!isFinite(n) || n !== n) return false;
            g[i][2] = 1; g[i][3] = n;
        }
        saveGoods();
        return true;
    };

    /** The price the engine's own buy window would show for one row. */
    S.rowPrice = function (row, item) {
        if (row[2] === 0) return (item && typeof item.price === 'number') ? item.price : null;
        return row[3];
    };

    /**
     * Every row re-resolved against the live database, because $data* is
     * rebuilt at every boot and the Forge can add and scrub rows underneath a
     * saved draft. Window_ShopBuy.makeItemList drops an unresolvable row with a
     * bare `if (item)` and the shop simply opens shorter — so the drop happens
     * here, with a name, before the scene is ever pushed.
     */
    S.resolve = function () {
        var out = { rows: [], dropped: [], duplicates: [], noPrice: [] };
        var g = goods(), seen = {};
        for (var i = 0; i < g.length; i++) {
            var row = g[i];
            var kind = TYPE_KIND[row[0]];
            var item = resolve(kind, row[1]);
            var saved = (draftNames && draftNames[nameKey(row[0], row[1])]) || (kind + ' ' + row[1]);
            if (!item) {
                out.dropped.push({
                    index: i, good: row, name: saved,
                    why: 'no ' + kind + ' with id ' + row[1] + ' in the loaded database. The engine\'s ' +
                        'own buy window drops this row without a word, so it is dropped here and named.'
                });
                continue;
            }
            var key = nameKey(row[0], row[1]);
            if (seen[key]) out.duplicates.push(i); else seen[key] = true;
            if (row[2] === 0 && typeof item.price !== 'number') {
                out.noPrice.push({ index: i, name: item.name });
            }
            out.rows.push({ index: i, good: row, item: item, price: S.rowPrice(row, item) });
        }
        return out;
    };

    S.available = function () { return typeof Scene_Shop === 'function'; };

    /**
     * null when the shop can open; otherwise the sentence to print. Every one
     * of these is the reason the ENGINE would fail or the player would lose the
     * result, not a preference of this menu.
     */
    S.canOpen = function () {
        if (!alive() || typeof $gameParty === 'undefined' || !$gameParty) {
            return 'no party yet — start or load a game, then reopen this tab.';
        }
        if (!S.available()) {
            return 'this build has no Scene_Shop — a plugin removed or renamed the shop scene, so ' +
                'there is nothing to push. The goods list below is still saved.';
        }
        if ($.safe(function () { return $gameParty.inBattle(); }, 'inBattle', false)) {
            return 'not from a battle — the engine\'s own Shop Processing command refuses this too ' +
                '($gameParty.inBattle()), and a purchase made here would be rolled back with the battle.';
        }
        if (typeof SceneManager === 'undefined' || !SceneManager._scene) {
            return 'no scene is running yet, so there is nothing to push a shop on top of.';
        }
        if (typeof Scene_Title === 'function' && SceneManager._scene instanceof Scene_Title) {
            return 'not from the title — a new game is already set up here, so the shop would spend ' +
                'gold that is thrown away the moment a game is started or loaded.';
        }
        if ($.safe(function () { return SceneManager.isSceneChanging(); }, 'isSceneChanging', false)) {
            return 'a scene change is already pending — pushing now would replace it and leave the ' +
                'stack one entry deeper than the scenes actually visited.';
        }
        if (typeof $gameMessage !== 'undefined' && $gameMessage &&
            $.safe(function () { return $gameMessage.isBusy(); }, 'isBusy', false)) {
            return 'a message is on screen — dismiss it first.';
        }
        if (typeof $gameMap !== 'undefined' && $gameMap &&
            $.safe(function () { return $gameMap.isEventRunning(); }, 'isEventRunning', false)) {
            return 'an event is running — wait for it to finish.';
        }
        if (!goods().length) return 'add something to the list first.';
        if (!S.resolve().rows.length) {
            return 'none of these ids resolves in the loaded database, so the shop would open empty.';
        }
        return null;
    };

    /** Not a refusal — the shop still opens, and this is what happens next. */
    S.warning = function () {
        if (typeof SceneManager === 'undefined' || !SceneManager._scene) return '';
        if (typeof Scene_Map === 'function' && SceneManager._scene instanceof Scene_Map) return '';
        return 'you are not on the map, so closing the shop returns you here rather than to the game.';
    };

    function goodsSig(list) {
        if (!list || !list.length) return '';
        var out = [];
        for (var i = 0; i < list.length; i++) out.push(list[i].join(','));
        return out.join(';');
    }

    S.lastShop = function () {
        if (K.lastShop) return K.lastShop;
        var hk = $.hooks['Scene_Shop.prepare (goods observer)'];
        return (hk && hk.installed) ? null : { why: hk ? hk.reason : 'the goods observer is not installed.' };
    };
    S.captureLast = function () {
        var last = K.lastShop;
        if (!last || !last.goods || !last.goods.length) return { ok: false, why: 'no shop has been opened yet.' };
        draft = [];
        draftNames = draftNames || {};
        for (var i = 0; i < last.goods.length; i++) {
            if (!goodRow(last.goods[i])) continue;
            var row = normRow(last.goods[i]);
            draft.push(row);
            var item = resolve(TYPE_KIND[row[0]], row[1]);
            if (item) draftNames[nameKey(row[0], row[1])] = item.name;
        }
        saveGoods();
        $.log('ok', 'captured ' + draft.length + ' goods row(s) from the last shop this game opened');
        return { ok: true, rows: draft.length };
    };

    /**
     * push, THEN prepare. prepareNextScene does `this._nextScene.prepare(...)`,
     * and _nextScene does not exist until goto constructs it inside push — so
     * the order is the mechanism, not a style choice, and a push that did not
     * construct a scene is reported rather than dereferenced.
     */
    S.open = function () {
        if (!$.allowWrite('Opening a shop')) return false;
        var why = S.canOpen();
        if (why) {
            $.log('warn', 'the shop did not open — ' + why);
            U.toast({ title: 'NOT OPENED', msg: why, severity: 'warn' });
            return false;
        }
        var r = S.resolve();
        var list = [];
        for (var i = 0; i < r.rows.length; i++) list.push(r.rows[i].good.slice());
        if (r.dropped.length) {
            var names = [];
            for (var d = 0; d < r.dropped.length; d++) names.push('"' + r.dropped[d].name + '"');
            $.log('warn', 'dropped ' + r.dropped.length + ' goods row(s) before opening: ' +
                names.join(', ') + ' — no such row in the loaded database. The engine\'s own buy ' +
                'window would have dropped them without a word.');
        }
        if ($.backup && $.backup.guard) $.safe(function () { $.backup.guard('open a shop'); }, 'backup guard');

        var purchaseOnly = bool('shop.purchaseOnly');
        pendingGoods = list;
        var pushWhy = '';
        var vr = verify('shop.open',
            function () {
                $.safe(function () {
                    SceneManager.push(Scene_Shop);
                    var next = SceneManager._nextScene;
                    if (!next || typeof next.prepare !== 'function') {
                        pushWhy = 'SceneManager.push did not leave a scene for prepareNextScene to ' +
                            'prepare. push calls goto, and goto is what constructs the next scene — ' +
                            'something has replaced one of them, so the goods never reached a shop. ' +
                            'Debug → Hooks lists what GigaHack installed; a plugin that replaced these ' +
                            'is not in that list.';
                        return;
                    }
                    SceneManager.prepareNextScene(list, purchaseOnly);
                }, 'open shop');
            },
            function () {
                var next = (typeof SceneManager !== 'undefined') ? SceneManager._nextScene : null;
                if (next && next._goods) return goodsSig(next._goods);
                if (K.lastShop && K.lastShop.ours) return goodsSig(K.lastShop.goods);
                return '';
            },
            goodsSig(list));
        pendingGoods = null;

        if (!vr.ok) {
            $.log('warn', 'the shop was asked for but its goods did not reach the scene. ' +
                (pushWhy || vr.message));
            U.toast({ title: 'SHOP NOT PREPARED', msg: pushWhy || vr.message, severity: 'warn' });
            return false;
        }
        $.log('ok', 'shop opened with ' + list.length + ' row(s)' +
            (purchaseOnly ? ', buy only' : ', buy and sell at half price') +
            (r.dropped.length ? ' (' + r.dropped.length + ' dropped)' : ''));
        if (bool('shop.closeOnOpen')) U.setOpen(false);
        return true;
    };

    /* The picker pool, taken from the inventory module rather than from a
       second walk of $data* — a database the Forge has extended is already in
       that list, and a second scan would disagree with the Items panel. */
    S.pool = function (kind, q) {
        var list = ($.inv && $.inv.list) ? $.inv.list(kind) : [];
        var found = q ? searchIds(kind, q) : { ids: null, why: '' };
        S.searchWhy = found.why;
        if (!q) return list;
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var o = list[i];
            if (found.ids) { if (found.ids[o.id]) out.push(o); }
            else if (String(o.id).indexOf(q) > -1 || o.name.toLowerCase().indexOf(q) > -1) out.push(o);
        }
        return out;
    };
    S.searchWhy = '';

    /* The index answers "which ids match this text" without walking every name,
       and is never authority: each candidate is re-resolved against the live
       row. When it cannot answer completely, the linear filter still can — the
       only cost is time — so its reason is shown and nothing else changes. */
    var INDEX_KIND = { item: 'items', weapon: 'weapons', armor: 'armors' };
    function searchIds(kind, q) {
        var out = { ids: null, why: '' };
        if (!q) return out;
        if (!$.index || !$.index.findByName) {
            out.why = 'the index module is not installed — searching the long way instead.';
            return out;
        }
        var r = $.safe(function () { return $.index.findByName(INDEX_KIND[kind], q); }, 'index search', null);
        if (!r) { out.why = 'the index query threw — searching the long way instead.'; return out; }
        if (!r.complete) { out.why = r.why; return out; }
        var ids = Object.create(null), cands = r.candidates || [];
        for (var i = 0; i < cands.length; i++) {
            var c = cands[i];
            if (!c || !(c.id > 0)) continue;
            var row = resolve(kind, c.id);
            if (!row || !row.name) continue;
            if (String(row.name).toLowerCase().indexOf(q) === -1 && String(c.id).indexOf(q) === -1) continue;
            ids[c.id] = true;
        }
        out.ids = ids;
        return out;
    }

    /* =====================================================================
       PART 5 — THE LOADOUTS PANEL
       ===================================================================== */
    function noModule(what, name) {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'the ' + name + ' module did not load' }),
                h('div', { style: 'white-space:normal', text: what })));
    }
    function noParty() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'no party yet' }),
                h('div', { text: 'start or load a game, then reopen this tab' })));
    }
    function emptyParty() {
        return h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('b', { text: 'the party is empty' }),
                h('div', { text: 'add a member on Player → Stats first' })));
    }

    /* The party list is repeated here rather than reached for: Party.js keeps
       its own actorList private, and the fourteen lines below are cheaper than
       a cross-module dependency on a function nobody exported. The SELECTION is
       shared through cfg 'party.actorId', which is deliberate — picking an
       actor here and switching to Player → Equip keeps the same one — so it is
       always moved with $.party.select and never by writing the key. */
    function actorList() {
        var sel = $.party.selected();
        var members = $.party.members();
        var rows = [];
        for (var i = 0; i < members.length; i++) {
            (function (a) {
                var on = sel && a.actorId() === sel.actorId();
                var row = h('button', { class: 'mm-tree-row' + (on ? ' mm-on' : '') },
                    h('span', {
                        style: 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis',
                        text: a.name()
                    }),
                    h('span', { class: 'mm-sub mm-mono', text: 'L' + a.level + ' · ' + slotsOf(a).length }));
                row.addEventListener('click', function () { $.party.select(a); U.rerender(); });
                rows.push(row);
            })(members[i]);
        }
        if (!rows.length) rows = [h('div', { class: 'mm-empty', text: 'party is empty' })];
        return W.group('Party', rows, { tag: members.length + '' });
    }

    var newName = '';
    var picked = null;         // the selected kit's name

    function selectedKit() {
        if (!picked) return null;
        return K.get(picked);
    }

    function saveGroup(actor) {
        var full = all().length >= K.max();
        var dupe = !!K.get(newName.replace(/^\s+|\s+$/g, ''));
        var blank = !newName.replace(/^\s+|\s+$/g, '');
        var why = full
            ? 'this build keeps at most ' + K.max() + ' kits so the store file stays small; delete one first.'
            : blank ? 'a kit needs a name — the name is how you get it back.'
                : dupe ? 'a kit called "' + newName + '" already exists — rename it or delete the old one.'
                    : '';
        return W.group('Save', [
            W.row('Name', W.text({
                value: newName, width: '128px', label: 'kit name', placeholder: 'kit name',
                onInput: function (v) { newName = v; },
                onEnter: function (v) { newName = v; doSave(actor); }
            })),
            W.button({
                label: 'save this kit', wide: true, mutates: true, disabled: !!why,
                tip: 'Save|Class, level, skills, parameter bonuses and one entry per equip slot.',
                onClick: function () { doSave(actor); }
            }),
            why ? h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)', text: why }) : null,
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Kits live in ' + KIT_FILE + ' — GigaHack\'s own store, not the save — so they follow ' +
                'the install rather than the playthrough.')
        ], { tag: all().length + ' / ' + K.max() });
    }

    function doSave(actor) {
        var r = K.save(actor, newName);
        if (!r.ok) {
            U.toast({ title: 'NOT SAVED', msg: r.why, severity: 'warn' });
            return;
        }
        picked = r.kit.name;
        newName = '';
        U.toast({ title: 'KIT SAVED', msg: '"' + r.kit.name + '" — ' + r.kit.slots.length + ' slots', severity: 'ok' });
        U.rerender();
    }

    function applyGroup() {
        function t(key, label, sub, tip) {
            return W.toggleRow(label, {
                value: bool('loadout.' + key), _ungated: true, sub: sub, tip: tip,
                onChange: function (v) { set('loadout.' + key, v); U.rerender(); }
            });
        }
        return W.group('What to apply', [
            t('applyClass', 'Class', null,
                'Class|Changes the level too — changeClass re-derives it from the new class exp.'),
            t('applyLevel', 'Level'),
            t('applySkills', 'Skills'),
            t('applyParams', 'Parameter bonuses', null,
                'Bonuses|_paramPlus only. Equipment is not part of this.'),
            t('applyEquip', 'Equipment')
        ]);
    }

    function refuseGroup() {
        return W.group('When a slot refuses', [
            W.toggleRow('Provide a missing item', {
                value: bool('loadout.provideMissing'), _ungated: true,
                sub: 'changeEquip trades from the party bag',
                tip: 'Provide|Gives one copy first. A locked item is still refused.',
                onChange: function (v) { set('loadout.provideMissing', v); U.rerender(); }
            }),
            W.toggleRow('Force the slot', {
                value: bool('loadout.force'), _ungated: true,
                sub: 'skips the ownership trade only',
                tip: 'Force|Does not skip the type match or the actor\'s equip traits.',
                onChange: function (v) { set('loadout.force', v); U.rerender(); }
            }),
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'forceChangeEquip ignores party ownership and a LOCKED slot; it does not ignore a ' +
                'SEALED slot or a weapon or armor type this actor cannot equip. It calls ' +
                'releaseUnequippableItems in the same breath, so those two are stripped again before ' +
                'it returns — and this panel reports them as released, not as applied.'),
            K.releaseWatched() ? null : h('div', {
                class: 'mm-sub', style: 'padding:2px;white-space:normal;color:var(--mm-warn)',
                text: ($.hooks['Game_Actor.releaseUnequippableItems (kit)'] || {}).reason ||
                    'the release observer is not installed.'
            })
        ], { tag: bool('loadout.force') ? 'forcing' : null });
    }

    function kitsTable(actor) {
        var rows = all();
        var table = W.table({
            rowH: ROW_H,
            cols: [
                { label: 'name', w: '1 1 0' },
                { label: 'from', w: '0 0 88px' },
                { label: 'class', w: '0 0 88px' },
                { label: 'L', w: '0 0 34px', cls: 'mm-td-num' },
                { label: 'slots', w: '0 0 42px', cls: 'mm-td-num' },
                { label: '', w: '0 0 176px' }
            ],
            empty: 'no kits yet — pick an actor and use "save this kit"',
            render: function (k) {
                var slots = slotsOf(actor);
                var tooMany = bool('loadout.applyEquip') && k.slots.length > slots.length;
                return [
                    W.editCell(k.name, function (v) {
                        var r = K.rename(k.name, v);
                        if (!r.ok) U.toast({ title: 'NOT RENAMED', msg: r.why, severity: 'warn' });
                        else { if (picked === k.name) picked = v; }
                        U.rerender();
                    }, 'mm-td-val'),
                    h('span', { class: 'mm-sub', text: k.actorName || '?' }),
                    h('span', { class: 'mm-sub', text: k.className || '?' }),
                    String(k.level || '?'),
                    String(k.slots.length),
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: 'apply', mini: true, mutates: true, disabled: tooMany,
                            tip: tooMany
                                ? 'Too many slots|Kit has ' + k.slots.length + ', ' + actor.name() +
                                  ' has ' + slots.length + '.'
                                : null,
                            onClick: function () { picked = k.name; runApply(actor, k); }
                        }),
                        W.button({
                            label: 'overwrite', mini: true, variant: 'danger', mutates: true,
                            confirmLabel: 'replace "' + k.name + '"?',
                            tip: 'Overwrite|Re-records this kit from the selected actor. No undo.',
                            onClick: function () {
                                if (!$.allowWrite('Overwriting a kit')) return;
                                var fresh = K.capture(actor);
                                if (!fresh) return;
                                fresh.name = k.name;
                                var list = all();
                                for (var i = 0; i < list.length; i++) if (list[i].name === k.name) list[i] = fresh;
                                persist();
                                $.log('warn', 'kit "' + k.name + '" re-recorded from ' + fresh.actorName);
                                U.rerender();
                            }
                        }),
                        W.button({
                            label: 'delete', mini: true, variant: 'danger',
                            confirmLabel: 'delete "' + k.name + '"?',
                            onClick: function () {
                                K.remove(k.name);
                                if (picked === k.name) picked = null;
                                U.rerender();
                            }
                        }))
                ];
            },
            onRow: function (tr, k) {
                if (picked === k.name) tr.classList.add('mm-on');
                else if (k.actorId === actor.actorId()) tr.style.color = 'var(--mm-text-hi)';
                tr.addEventListener('click', function () { picked = k.name; U.rerender(); });
                tr.setAttribute('data-mm-tip', k.name + '|from ' + (k.actorName || '?') + ', ' +
                    k.slots.length + ' slot(s), ' + (k.skills || []).length + ' skill(s)' +
                    (k.dualWield ? ', dual wield' : ''));
            }
        });
        table.mm.paint(rows);
        return table;
    }

    function runApply(actor, kit) {
        var rep = K.apply(actor, kit);
        U.toast({
            title: rep.blocked ? 'READ-ONLY' : rep.ok ? 'KIT APPLIED' : 'PARTLY APPLIED',
            msg: rep.blocked ? rep.message : rep.message,
            severity: rep.ok ? 'ok' : 'warn'
        });
        U.rerender();
    }

    function diffTable(actor, kit) {
        var rows = K.diff(actor, kit);
        var table = W.table({
            rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'what', w: '0 0 104px' },
                { label: 'now', w: '1 1 0' },
                { label: 'kit', w: '1 1 0' },
                { label: '', w: '0 0 100px' }
            ],
            empty: 'nothing would change',
            render: function (r) {
                return [
                    U.icon(r.icon === undefined ? -1 : r.icon),
                    h('span', { class: 'mm-sub', text: r.label }),
                    h('span', { text: r.now }),
                    h('span', { class: r.refusal ? 'mm-sub' : '', text: r.want }),
                    h('span', {
                        class: 'mm-sub',
                        style: r.refusal ? 'color:var(--mm-warn)' : null,
                        text: r.refusal || (r.note ? 'locked' : '')
                    })
                ];
            },
            onRow: function (tr, r) {
                var tip = r.why || r.note || '';
                if (r.note && r.why) tip = r.why + ' ' + r.note;
                tr.setAttribute('data-mm-tip', (r.refusal || r.label) + '|' + (tip || 'nothing stands in the way'));
                if (r.refusal) tr.style.color = 'var(--mm-warn)';
            }
        });
        table.mm.paint(rows);
        return table;
    }

    function lastReportRows() {
        var rep = K.lastReport;
        if (!rep || !rep.actor) return null;
        var out = [];
        if (rep.released.length) {
            var names = [];
            for (var i = 0; i < rep.released.length; i++) {
                names.push(rep.released[i].slot + ' (' + rep.released[i].name + ')' +
                    (rep.released[i].tradedBack ? ', traded back to the party' : ''));
            }
            out.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
                h('b', { text: 'the engine emptied ' + rep.released.length + ' slot(s) during that apply. ' }),
                'releaseUnequippableItems took back ' + names.join('; ') +
                '. That is the engine\'s own rule, not a failed write — the actor cannot hold them.'));
        }
        if (rep.created.length) {
            out.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px' },
                'provided ' + rep.created.length + ' item(s): ' + rep.created.join(', ') + '.'));
        }
        if (rep.dropped.length) {
            out.push(h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)' },
                rep.dropped[0].why));
        }
        return out.length ? out : null;
    }

    function pasteGroup() {
        var text = '';
        return W.group('Move a kit', [
            W.button({
                label: 'copy the selected kit as JSON', wide: true, _ungated: true,
                disabled: !selectedKit(),
                onClick: function () {
                    var k = selectedKit();
                    if (!k) return;
                    U.copyText(K.exportKit(k.name));
                    U.toast({ title: 'COPIED', msg: '"' + k.name + '" is on the clipboard', severity: 'ok' });
                }
            }),
            W.textarea({
                rows: 3, mono: true, placeholder: 'paste a kit here', label: 'kit JSON',
                _ungated: true,
                onCommit: function (v) { text = v; }
            }),
            W.button({
                label: 'add the pasted kit', wide: true, mutates: true,
                onClick: function () {
                    var r = K.importKit(text);
                    U.toast({
                        title: r.ok ? 'KIT ADDED' : 'NOT ADDED',
                        msg: r.ok ? '"' + r.kit.name + '"' : r.why,
                        severity: r.ok ? 'ok' : 'warn'
                    });
                    if (r.ok) picked = r.kit.name;
                    U.rerender();
                }
            })
        ], { collapsed: true, tag: 'JSON' });
    }

    function buildLoadouts() {
        if (!$.party || !$.party.alive) {
            return noModule('There is no actor to save a kit from. Debug → Environment lists which ' +
                'modules ran and which did not.', 'party');
        }
        if (!$.party.alive()) return noParty();
        var actor = $.party.selected();
        if (!actor) return emptyParty();

        var kit = selectedKit();
        var slots = slotsOf(actor);
        var opts = liveOpts();
        var nothingOn = !opts.applyClass && !opts.applyLevel && !opts.applySkills &&
            !opts.applyEquip && !opts.applyParams;
        var tooMany = kit && opts.applyEquip && kit.slots.length > slots.length;

        var applyWhy = !kit ? 'pick a kit in the table first.'
            : nothingOn ? 'nothing is selected to apply — every "what to apply" toggle is off.'
                : tooMany ? 'this kit records ' + kit.slots.length + ' slots and ' + actor.name() +
                    ' has ' + slots.length + '. The extra slots are named in the difference table ' +
                    'and would be dropped.'
                    : '';

        var main = [
            W.group('Saved kits', [kitsTable(actor)], { grow: true, tag: all().length + '' })
        ];
        var diffChildren = [diffTable(actor, kit)];
        var extra = lastReportRows();
        if (extra) for (var e = 0; e < extra.length; e++) diffChildren.push(extra[e]);
        diffChildren.push(h('div', { class: 'mm-sep' }));
        diffChildren.push(W.button({
            label: kit ? 'apply "' + kit.name + '" to ' + actor.name() : 'apply this kit',
            wide: true, variant: 'prime', mutates: true, disabled: !!applyWhy,
            tip: 'Apply|Class, then level, then skills, then equipment, then bonuses. One undo entry.',
            onClick: function () { if (kit) runApply(actor, kit); }
        }));
        if (applyWhy) {
            diffChildren.push(h('div', {
                class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)', text: applyWhy
            }));
        }
        diffChildren.push(h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
            'The order is class, level, skills, equipment, bonuses — changeClass re-derives the level ' +
            'and levelling learns the new class\'s own skills, so any other order undoes itself.'));
        main.push(W.group('Difference from ' + actor.name(), diffChildren,
            { tag: kit ? kit.name : 'no kit' }));

        return cols({ narrow: true, items: [
            actorList(),
            h('div', { class: 'mm-row', 'data-mm-tip': 'Slots|equipSlots() is read live, per actor.' },
                h('div', { class: 'mm-lab', text: 'Slots' }),
                h('div', { class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub' },
                    slots.length + ' · ' + (function () {
                        var names = [];
                        for (var i = 0; i < slots.length; i++) names.push(etypeName(slots[i]));
                        return names.join(', ');
                    }()) + ($.safe(function () { return actor.isDualWield(); }, 'isDualWield', false)
                        ? ' (dual wield)' : ''))),
            saveGroup(actor),
            applyGroup(),
            refuseGroup(),
            pasteGroup(),
            degradeNote('party.equip'),
            degradeNote('party.param')
        ] }, main);
    }

    /* =====================================================================
       PART 6 — THE SHOP PANEL
       ===================================================================== */
    var shopQuery = '';
    var ownedOnly = false;

    function shopKind() { return pick('shop.kind', ['item', 'weapon', 'armor']); }

    function pickerTable() {
        var kind = shopKind();
        var table = W.table({
            virtual: true, rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'id', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'type', w: '0 0 74px' },
                { label: 'price', w: '0 0 62px', cls: 'mm-td-num' },
                { label: 'have', w: '0 0 46px', cls: 'mm-td-num' },
                { label: '', w: '0 0 46px' }
            ],
            empty: 'no matches',
            render: function (o) {
                var inList = S.has(o);
                return [
                    U.icon(o.iconIndex),
                    String(o.id),
                    h('span', { text: o.name }),
                    h('span', { class: 'mm-sub', text: typeLabel(kind, o) }),
                    String(o.price == null ? '—' : o.price),
                    String(($.inv && $.inv.count) ? $.inv.count(o) : 0),
                    W.button({
                        label: inList ? 'added' : 'add', mini: true, _ungated: true, disabled: inList,
                        onClick: function () { S.add(o); U.rerender(); }
                    })
                ];
            },
            onRow: function (tr, o) {
                if (S.has(o)) tr.classList.add('mm-on');
                var d = (o.description || '').split('\n')[0];
                tr.setAttribute('data-mm-tip', o.name + '|' + (d || 'no description'));
            }
        });
        function repaint() {
            var pool = S.pool(kind, shopQuery);
            if (ownedOnly && $.inv && $.inv.count) {
                var out = [];
                for (var i = 0; i < pool.length; i++) if ($.inv.count(pool[i]) > 0) out.push(pool[i]);
                pool = out;
            }
            table.mm.paint(pool);
        }
        repaint();
        table.mm.repaint = repaint;
        return table;
    }

    function typeLabel(kind, o) {
        if (kind === 'item') return o.itypeId === 2 ? 'key' : 'item';
        if (kind === 'weapon') return wtypeName(o.wtypeId);
        return etypeName(o.etypeId);
    }

    function goodsTable() {
        var r = S.resolve();
        var byIndex = {};
        for (var i = 0; i < r.rows.length; i++) byIndex[r.rows[i].index] = r.rows[i];
        var dropped = {};
        for (var d = 0; d < r.dropped.length; d++) dropped[r.dropped[d].index] = r.dropped[d];
        var dupes = {};
        for (var u = 0; u < r.duplicates.length; u++) dupes[r.duplicates[u]] = true;

        var list = [];
        var g = goods();
        for (var k = 0; k < g.length; k++) list.push({ index: k, good: g[k] });

        var table = W.table({
            rowH: ROW_H,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'kind', w: '0 0 58px' },
                { label: 'id', w: '0 0 44px', cls: 'mm-td-num' },
                { label: 'name', w: '1 1 0' },
                { label: 'price', w: '0 0 78px', cls: 'mm-td-val' },
                { label: '', w: '0 0 96px' }
            ],
            empty: 'nothing in the list yet',
            render: function (row) {
                var res = byIndex[row.index];
                var gone = dropped[row.index];
                var item = res ? res.item : null;
                var priceCell;
                if (row.good[2] === 0) {
                    priceCell = h('span', {
                        class: 'mm-sub mm-mono', style: 'cursor:text',
                        text: item && typeof item.price === 'number' ? String(item.price) : '—',
                        tip: item && typeof item.price === 'number'
                            ? 'From the database|priceType 0 tells the shop to read the item\'s own price.'
                            : 'No database price|This row has none, so the shop would be handed 0.'
                    });
                    priceCell.addEventListener('click', function () {
                        S.setPrice(row.index, item && item.price ? item.price : 0);
                        U.rerender();
                    });
                } else {
                    priceCell = W.editCell(row.good[3], function (v) {
                        S.setPrice(row.index, v === '' || v === '-' ? null : v);
                        U.rerender();
                    });
                }
                return [
                    U.icon(item ? item.iconIndex : -1),
                    h('span', { class: 'mm-sub', text: TYPE_KIND[row.good[0]] }),
                    String(row.good[1]),
                    h('span', {
                        class: gone ? 'mm-sub' : '',
                        style: gone ? 'color:var(--mm-warn)' : null,
                        text: item ? item.name : (gone ? gone.name : '?')
                    }),
                    priceCell,
                    h('div', { class: 'mm-cellbtns' },
                        W.button({
                            label: '↑', mini: true, _ungated: true, disabled: row.index === 0,
                            onClick: function () { S.moveAt(row.index, -1); U.rerender(); }
                        }),
                        W.button({
                            label: '↓', mini: true, _ungated: true, disabled: row.index === g.length - 1,
                            onClick: function () { S.moveAt(row.index, 1); U.rerender(); }
                        }),
                        W.button({
                            label: '×', mini: true, variant: 'danger', _ungated: true,
                            onClick: function () { S.removeAt(row.index); U.rerender(); }
                        }))
                ];
            },
            onRow: function (tr, row) {
                var gone = dropped[row.index];
                if (gone) {
                    tr.setAttribute('data-mm-tip', 'Dropped|' + gone.why);
                } else if (dupes[row.index]) {
                    tr.setAttribute('data-mm-tip', 'Duplicate|The same row is already in this list. ' +
                        'The shop shows it twice.');
                    tr.style.color = 'var(--mm-warn)';
                } else {
                    tr.setAttribute('data-mm-tip', 'Goods row|[' + row.good.join(', ') +
                        '] — type, id, priceType, price.');
                }
            }
        });
        table.mm.paint(list);
        return table;
    }

    function priceGroup() {
        var mode = pick('shop.priceMode', ['database', 'fixed', 'percent']);
        var LABELS = ['database price', 'fixed', 'percent of database'];
        var VALUES = ['database', 'fixed', 'percent'];
        return W.group('Prices', [
            W.row('New rows use', W.dropdown({
                options: LABELS, value: LABELS[VALUES.indexOf(mode)], width: '104px', _ungated: true,
                label: 'price mode',
                onChange: function (v) { set('shop.priceMode', VALUES[LABELS.indexOf(v)]); U.rerender(); }
            })),
            mode === 'database' ? null : W.row(mode === 'fixed' ? 'Gold' : 'Percent', W.number({
                value: num('shop.priceValue', 0, 99999999), min: 0, max: 99999999, wide: true,
                _ungated: true, label: 'price value',
                onChange: function (v) { set('shop.priceValue', v); U.rerender(); }
            })),
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'priceType 0 tells the shop to read the item\'s own price; priceType 1 tells it to use ' +
                'the number in the row. This only decides what a NEWLY added row gets — every row is ' +
                'editable in the list.')
        ]);
    }

    function openGroup() {
        var why = S.canOpen();
        var warn = why ? '' : S.warning();
        return W.group('Open', [
            W.button({
                label: 'open the shop', wide: true, variant: 'danger', mutates: true, disabled: !!why,
                confirmLabel: 'open a shop now?',
                tip: 'Open|SceneManager.push(Scene_Shop) then prepareNextScene, in that order.',
                onClick: function () { S.open(); }
            }),
            why ? h('div', {
                class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)', text: why
            }) : null,
            warn ? h('div', {
                class: 'mm-sub', style: 'white-space:normal;padding:2px;color:var(--mm-warn)', text: warn
            }) : null,
            W.toggleRow('Purchase only', {
                value: bool('shop.purchaseOnly'), _ungated: true,
                sub: 'the second argument to prepare',
                tip: 'Selling|With selling on the engine pays floor(price / 2).',
                onChange: function (v) { set('shop.purchaseOnly', v); U.rerender(); }
            }),
            W.toggleRow('Close the menu when it opens', {
                value: bool('shop.closeOnOpen'), _ungated: true,
                onChange: function (v) { set('shop.closeOnOpen', v); }
            }),
            degradeNote('shop.open')
        ], { tag: why ? 'blocked' : 'ready' });
    }

    function aboutGroup() {
        var last = K.lastShop;
        var hk = $.hooks['Scene_Shop.prepare (goods observer)'];
        var watching = !!(hk && hk.installed);
        return W.group('What a shop is', [
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'RPG Maker has no shop object. A shop is an event command, so there is nothing on disk ' +
                'to edit — this builds the same goods list that command carries and hands it to the ' +
                'engine\'s own scene.'),
            h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                'Goods rows are [type, id, priceType, price] on both engines.'),
            watching
                ? h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    last
                        ? 'the last shop this game opened had ' + last.goods.length + ' row(s)' +
                          (last.ours ? ', and it was this one' : '')
                        : 'no shop has been opened yet this session.')
                : h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal;color:var(--mm-warn)',
                    text: (hk && hk.reason) || 'the goods observer is not installed.' }),
            (watching && last && last.goods.length) ? W.button({
                label: 'capture those ' + last.goods.length + ' row(s)', wide: true, _ungated: true,
                tip: 'Capture|Replaces the draft below with what that shop carried.',
                onClick: function () {
                    var r = S.captureLast();
                    if (!r.ok) U.toast({ title: 'NOTHING TO CAPTURE', msg: r.why, severity: 'warn' });
                    U.rerender();
                }
            }) : null
        ], { collapsed: true, tag: watching ? 'observing' : 'blind' });
    }

    function buildShop() {
        if (!$.inv || !$.inv.alive) {
            return noModule('The item pickers are built from the inventory module\'s own lists, so ' +
                'there is nothing to choose from. Debug → Environment lists which modules ran.', 'inventory');
        }
        if (!$.inv.alive()) return noParty();

        var r = S.resolve();
        var kind = shopKind();
        var KINDS = ['item', 'weapon', 'armor'];
        var KIND_LABELS = ['Items', 'Weapons', 'Armors'];

        var picker = pickerTable();
        var toolbar = h('div', { class: 'mm-toolbar' },
            W.dropdown({
                options: KIND_LABELS, value: KIND_LABELS[KINDS.indexOf(kind)], width: '92px',
                _ungated: true, label: 'database',
                onChange: function (v) { set('shop.kind', KINDS[KIND_LABELS.indexOf(v)]); U.rerender(); }
            }),
            W.search({
                placeholder: 'search…',
                onInput: function (v) { shopQuery = v.trim().toLowerCase(); picker.mm.repaint(); }
            }),
            W.chip({
                label: 'owned only', value: ownedOnly,
                onChange: function (v) { ownedOnly = v; picker.mm.repaint(); }
            }));

        var whyEl = S.searchWhy ? h('div', {
            class: 'mm-sub', style: 'padding:2px 6px;white-space:normal;color:var(--mm-warn)',
            text: S.searchWhy
        }) : null;

        return cols({ narrow: true, items: [
            W.group('Goods', [
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Rows' }),
                    h('div', { class: 'mm-edge mm-mono mm-hi', text: String(goods().length) })),
                h('div', { class: 'mm-row', 'data-mm-tip': 'Dropped|Resolved against the live database ' +
                    'before the scene is pushed.' },
                    h('div', { class: 'mm-lab', text: 'Would be dropped' }),
                    h('div', {
                        class: 'mm-edge mm-mono ' + (r.dropped.length ? 'mm-hi' : 'mm-sub'),
                        text: String(r.dropped.length)
                    })),
                h('div', { class: 'mm-row' },
                    h('div', { class: 'mm-lab', text: 'Duplicated' }),
                    h('div', { class: 'mm-edge mm-mono mm-sub', text: String(r.duplicates.length) })),
                r.noPrice.length ? h('div', {
                    class: 'mm-sub', style: 'padding:2px;white-space:normal;color:var(--mm-warn)',
                    text: r.noPrice.length + ' row(s) ask for the database price and their row has none, ' +
                        'so the shop is handed 0 rather than an undefined price.'
                }) : null,
                W.button({
                    label: 'clear the list', wide: true, variant: 'danger', _ungated: true,
                    disabled: !goods().length, confirmLabel: 'empty the goods list?',
                    tip: 'Clear|Edits GigaHack\'s own draft, not the game.',
                    onClick: function () { S.clear(); U.rerender(); }
                }),
                S.fromDisk ? h('div', { class: 'mm-sub', style: 'padding:2px;white-space:normal' },
                    'This draft was read back from ' + SHOP_FILE + ' — it is what a previous session ' +
                    'left, not something this panel has just built.') : null
            ], { tag: SHOP_FILE }),
            priceGroup(),
            openGroup(),
            aboutGroup()
        ] }, [
            W.group('Add from the database', [toolbar, whyEl, picker], { grow: true }),
            W.group('Goods list', [goodsTable()], { tag: goods().length + '' })
        ]);
    }

    /* =====================================================================
       REGISTRATION

       Both panels register unconditionally: a tab whose shape depends on which
       modules loaded is a tab that quietly changes under the user. The BODY of
       each is what degrades, and it names the module it needed.
       ===================================================================== */
    U.panel('player', 'Loadouts', function () { return buildLoadouts(); }, 55);
    U.panel('items', 'Shop', function () { return buildShop(); }, 60);

    /* Console API. The ordering rule and the preflight are the value here, so
       anything that wants "put this actor back" or "open a shop with these
       goods" calls these rather than growing a second copy of either. */
    $.api.kits = function () { return K.list(); };
    $.api.kitSave = function (name) {
        var a = ($.party && $.party.selected) ? $.party.selected() : null;
        return a ? K.save(a, name) : { ok: false, why: 'no actor selected' };
    };
    $.api.kitApply = function (name, actorId) {
        var a = null;
        if (actorId && typeof $gameActors !== 'undefined') a = $gameActors.actor(actorId);
        if (!a && $.party && $.party.selected) a = $.party.selected();
        return K.apply(a, K.get(name));
    };
    $.api.shop = function () { return S.open(); };

    $.log('ok', 'kit ready — ' + all().length + ' saved kit(s), ' + goods().length +
        ' goods row(s); slot counts read live and every equipment write verified' +
        (S.available() ? '' : ' (no Scene_Shop on this build, so the shop cannot be opened)'));

})(window.GigaHack);
