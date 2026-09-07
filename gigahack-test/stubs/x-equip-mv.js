/* =============================================================================
   GigaHack test harness — stubs/x-equip-mv.js
   EQUIPMENT, PARTY INVENTORY and the SHOP — the DIVERGENT MV surface.
   Copied from /root/work/mv/js/rpg_*.js (RPG Maker MV 1.6.1).

   STOCK ENGINE ONLY. Loaded IMMEDIATELY AFTER engine-mv.js, so it may reach
   everything core.js, x-equip.js and engine-mv.js define — in particular
   Array.prototype.contains (engine-mv.js:394), which is an MV ENGINE
   EXTENSION and not a language feature. Four of the five one-line members
   below exist in this file for no reason other than that word.

   The MV/MZ splits modelled here:
     1. isEquipWtypeOk / isEquipAtypeOk / isEquipTypeLocked / isEquipTypeSealed
        and hasWeapon / hasArmor / isEquipped / isAnyMemberEquipped —
        MV .contains, MZ .includes.
     2. Game_Party.hasItem — MV carries an extra `includeEquip === undefined`
        default line that MZ deleted.
     3. Game_Party.maxItems — MV DECLARES the item parameter, MZ commented it
        out, so the two disagree on Function.length.
     4. Game_Actor.traitObjects — MV concats a new array, MZ pushes into the
        one it was given.
     5. Every shop and title window takes POSITIONAL geometry here; on MZ they
        take a Rectangle from a *WindowRect() method. Window_ShopBuy is the
        sharp end: on MV the goods arrive in the CONSTRUCTOR.
     6. Scene_Title centres its background sprites itself and never scales
        them; MZ moved centerSprite up to Scene_Base and added scaleSprite.
   ========================================================================== */

/* -------------------------------------------------------------------------
   The four equip permission tests — rpg_objects.js:2522-2536.

   `.contains` is MV's own Array extension (rpg_core.js:120, polyfilled in
   engine-mv.js:394). Writing these four with .includes would still pass every
   check in a modern browser and would erase the fact that MV's engine depends
   on a method it defines itself — the exact class of assumption that makes a
   mod work in the harness and die on a real MV game whose plugin stack has
   frozen Array.prototype.
   ---------------------------------------------------------------------- */
Game_BattlerBase.prototype.isEquipWtypeOk = function (wtypeId) {      /* :2522 */
  return this.traitsSet(Game_BattlerBase.TRAIT_EQUIP_WTYPE).contains(wtypeId);
};
Game_BattlerBase.prototype.isEquipAtypeOk = function (atypeId) {      /* :2526 */
  return this.traitsSet(Game_BattlerBase.TRAIT_EQUIP_ATYPE).contains(atypeId);
};
Game_BattlerBase.prototype.isEquipTypeLocked = function (etypeId) {   /* :2530 */
  return this.traitsSet(Game_BattlerBase.TRAIT_EQUIP_LOCK).contains(etypeId);
};
Game_BattlerBase.prototype.isEquipTypeSealed = function (etypeId) {   /* :2534 */
  return this.traitsSet(Game_BattlerBase.TRAIT_EQUIP_SEAL).contains(etypeId);
};

/* -------------------------------------------------------------------------
   Game_Actor — the MV halves.
   ---------------------------------------------------------------------- */
/* rpg_objects.js:3616 / :3620 / :3662 — three more .contains sites. */
Game_Actor.prototype.hasWeapon = function (weapon) {
  return this.weapons().contains(weapon);
};
Game_Actor.prototype.hasArmor = function (armor) {
  return this.armors().contains(armor);
};
Game_Actor.prototype.isEquipped = function (item) {
  return this.equips().contains(item);
};

/* traitObjects — rpg_objects.js:3807. MV builds the list by CONCAT: it
   rebinds `objects` to a new array holding the actor record and the class
   record, then pushes each non-null equip onto that. MZ (rmmz :4453) pushes
   the two records into the array it was handed and iterates with for..of.
   Same contents, different allocation — and the order is the same on both:
   states first (from the base), then actor, then class, then equipment. That
   order is what decides which duplicate trait a Pi/Sum reduction meets first.

   The engine writes `Game_Battler.prototype.traitObjects.call(this)`. Neither
   engine's Game_Battler overrides traitObjects (grep both sources: zero
   hits), so that call resolves to Game_BattlerBase's, which is what is called
   here — the harness has no Game_Battler class. */
Game_Actor.prototype.traitObjects = function () {
  var objects = Game_BattlerBase.prototype.traitObjects.call(this);
  objects = objects.concat([this.actor(), this.currentClass()]);
  var equips = this.equips();
  for (var i = 0; i < equips.length; i++) {
    var item = equips[i];
    if (item) {
      objects.push(item);
    }
  }
  return objects;
};

/* -------------------------------------------------------------------------
   Game_Party — the MV halves.
   ---------------------------------------------------------------------- */
/* hasItem — rpg_objects.js:4972. MV opens with a DEFAULTING LINE that MZ
   deleted outright:
       if (includeEquip === undefined) { includeEquip = false; }
   Behaviourally it changes nothing — undefined is already falsy at the `else
   if` — but it is the only textual difference between the two bodies, and it
   is the kind of line a mod that reimplements hasItem tends to drop. Kept
   because a diff of this stub against MZ's should show exactly what a diff of
   the two engines shows, and nothing else. */
Game_Party.prototype.hasItem = function (item, includeEquip) {
  if (includeEquip === undefined) {
    includeEquip = false;
  }
  if (this.numItems(item) > 0) {
    return true;
  } else if (includeEquip && this.isAnyMemberEquipped(item)) {
    return true;
  } else {
    return false;
  }
};

/* isAnyMemberEquipped — rpg_objects.js:4985. .contains again, and note it
   walks members() — the BATTLE party on MV when in battle — not
   allMembers(), so a reserve member's gear does not count as owned. */
Game_Party.prototype.isAnyMemberEquipped = function (item) {
  return this.members().some(function (actor) {
    return actor.equips().contains(item);
  });
};

/* maxItems — rpg_objects.js:4964. MV DECLARES the parameter and ignores it;
   MZ commented it out (`function(/*item*\/)`), so Game_Party.prototype
   .maxItems.length is 1 here and 0 there. core.js:971 carries the arity-0
   form, which is MZ's shape, so MV restates it to get its own arity back.
   Anything that probes a stock method's arity to decide whether a plugin has
   replaced it reads a different number on the two engines for a method
   NEITHER engine has changed. */
Game_Party.prototype.maxItems = function (item) {
  return 99;
};

/* -------------------------------------------------------------------------
   Scene_Base — the MV halves of the two members Scene_Title reaches.
   ---------------------------------------------------------------------- */
/* createWindowLayer — rpg_scenes.js:158. MV computes a centring offset from
   Graphics.width/boxWidth and MOVES the layer with move(x, y, w, h); the
   layer therefore has a size. MZ (rmmz :76) only sets x and y and never gives
   the layer dimensions at all. A mod that measures the window layer to place
   an overlay gets a rectangle here and a point there. */
Scene_Base.prototype.createWindowLayer = function () {
  var width = Graphics.boxWidth;
  var height = Graphics.boxHeight;
  var x = (Graphics.width - width) / 2;
  var y = (Graphics.height - height) / 2;
  this._windowLayer = {
    x: x, y: y, width: width, height: height, children: [],
    move: function (mx, my, mw, mh) { this.x = mx; this.y = my; this.width = mw; this.height = mh; },
    addChild: function (c) { this.children.push(c); return c; }
  };
  this._windowLayer.move(x, y, width, height);
  this.addChild(this._windowLayer);
};

/* startFadeIn — rpg_scenes.js:189. MV drives a real ScreenSprite child
   (createFadeSprite at :221 ADDS IT TO THE SCENE, so it is in this.children
   and a later addChild lands above it). MZ (rmmz :87) keeps _fadeWhite and
   _fadeOpacity as plain fields and paints with a colour filter — no child at
   all. That is why an overlay parented to the scene is under the fade on MV
   and unaffected by it on MZ. */
Scene_Base.prototype.createFadeSprite = function (white) {
  if (!this._fadeSprite) {
    this._fadeSprite = { opacity: 0, white: false };
    this.addChild(this._fadeSprite);
  }
  this._fadeSprite.white = !!white;
};
Scene_Base.prototype.startFadeIn = function (duration, white) {
  this.createFadeSprite(white);
  this._fadeSign = 1;
  this._fadeDuration = duration || 30;
  this._fadeSprite.opacity = 255;
};

/* snapForBackground — rpg_managers.js:2117. MV snaps and BLURS, and never
   frees the previous bitmap. MZ (rmmz :2251) destroys the old one first and
   does not blur. Two differences in three lines: MV leaks, MZ does not; MV's
   menu backdrop is blurred, MZ's is sharp. */
SceneManager.snapForBackground = function () {
  this._backgroundBitmap = this.snap();
  this._backgroundBitmap.blur = function () { this._blurred = true; };
  this._backgroundBitmap.blur();
  window.__snapsForBackground = (window.__snapsForBackground || 0) + 1;
};

/* ImageManager.loadTitle1 / loadTitle2 — rpg_managers.js:851 / :855. MV takes
   (filename, hue) and forwards a `smooth` flag; MZ takes (filename) alone.
   The arity is the observable: a mod that wraps loadTitle1 and forwards only
   its first argument silently drops the hue on MV. */
ImageManager.loadTitle1 = function (filename, hue) {
  return { _dir: 'img/titles1/', _name: filename, _hue: hue, width: 816, height: 624,
    isReady: function () { return true; } };
};
ImageManager.loadTitle2 = function (filename, hue) {
  return { _dir: 'img/titles2/', _name: filename, _hue: hue, width: 816, height: 624,
    isReady: function () { return true; } };
};

/* -------------------------------------------------------------------------
   Scene_Title — the MV halves. rpg_scenes.js:443-506.
   ---------------------------------------------------------------------- */
/* start — :443. MV centres the two background sprites and stops there. MZ
   calls adjustBackground(), which SCALES them up to cover the screen before
   centring, so undersized title art letterboxes on MV and fills on MZ. */
Scene_Title.prototype.start = function () {
  this._active = true;
  SceneManager.clearStack();
  this.centerSprite(this._backSprite1);
  this.centerSprite(this._backSprite2);
  this.playTitleMusic();
  this.startFadeIn(this.fadeSpeed(), false);
  window.__titleStarts = (window.__titleStarts || 0) + 1;
};

/* centerSprite — :494. On MV this lives on SCENE_TITLE. MZ moved it up to
   Scene_Base (rmmz :168) and added scaleSprite beside it, so on MZ every
   scene has it and on MV only the title does. A mod that calls
   scene.centerSprite from anywhere else works on one engine only. */
Scene_Title.prototype.centerSprite = function (sprite) {
  sprite.x = Graphics.width / 2;
  sprite.y = Graphics.height / 2;
  sprite.anchor = sprite.anchor || { x: 0, y: 0 };
  sprite.anchor.x = 0.5;
  sprite.anchor.y = 0.5;
};

/* terminate — :463. MV snaps the background and LEAVES the title bitmap
   alive. MZ (rmmz :529) additionally destroys _gameTitleSprite.bitmap, which
   is why anything holding that bitmap across a title exit is a dangling
   reference on MZ and merely stale on MV. */
Scene_Title.prototype.terminate = function () {
  SceneManager.snapForBackground();
};

/* drawGameTitle — :483. MV never touches fontFace: the bitmap keeps the
   engine default (engine-mv.js:90 — 'GameFont'). MZ (rmmz :558) sets
   `bitmap.fontFace = $gameSystem.mainFontFace()` FIRST, and $gameSystem
   .mainFontFace does not exist on MV at all. This is the seam a global font
   override reaches on MZ and cannot reach here. */
Scene_Title.prototype.drawGameTitle = function () {
  var x = 20;
  var y = Graphics.height / 4;
  var maxWidth = Graphics.width - x * 2;
  var text = $dataSystem.gameTitle;
  this._gameTitleSprite.bitmap.outlineColor = 'black';
  this._gameTitleSprite.bitmap.outlineWidth = 8;
  this._gameTitleSprite.bitmap.fontSize = 72;
  this._gameTitleSprite.bitmap.drawText(text, x, y, maxWidth, 48, 'center');
};

/* createCommandWindow — :501. MV constructs Window_TitleCommand with NO
   arguments — the window sizes and places itself. MZ builds a Rectangle from
   $dataSystem.titleCommandWindow.offsetX/offsetY and calls setBackgroundType
   with .background, three data fields MV's $dataSystem does not have. */
Scene_Title.prototype.createCommandWindow = function () {
  this._commandWindow = new Window_TitleCommand();
  this._commandWindow.setHandler('newGame', this.commandNewGame.bind(this));
  this._commandWindow.setHandler('continue', this.commandContinue.bind(this));
  this._commandWindow.setHandler('options', this.commandOptions.bind(this));
  this.addWindow(this._commandWindow);
};

/* -------------------------------------------------------------------------
   Scene_Shop — the MV halves. rpg_scenes.js:1862-1951.

   __menuBaseCreate stands in for `Scene_MenuBase.prototype.create.call(this)`
   for the reason given in x-equip.js's Scene_Shop header. MV's Scene_MenuBase
   .create (rpg_scenes.js:909) is: super, createBackground, updateActor,
   createWindowLayer — three calls. MZ's adds a fourth, createButtons.

   The eight non-buy create* methods build RECORDER objects rather than the
   real Window_Gold / Window_ShopCommand / Window_ShopNumber /
   Window_ShopStatus / Window_ItemCategory / Window_ShopSell / Window_Base
   instances, because those classes belong to the window area and not to this
   file. What IS modelled exactly is the constructor ARGUMENT SHAPE, because
   that is the MV/MZ difference: every one of them takes positional geometry
   here and a Rectangle on MZ, and each recorder records the arguments it was
   given under `ctorArgs` so a check can assert which calling convention the
   scene used. The geometry arithmetic itself is copied from the source.
   ---------------------------------------------------------------------- */
function __shopWin(name, ctorArgs) {
  return {
    _class: name, ctorArgs: ctorArgs, x: 0, y: 0, width: 0, height: 0,
    visible: true, active: true, _handlers: {},
    hide: function () { this.visible = false; },
    show: function () { this.visible = true; },
    activate: function () { this.active = true; },
    deactivate: function () { this.active = false; },
    setHandler: function (s, m) { this._handlers[s] = m; },
    setHelpWindow: function (w) { this._helpWindow = w; },
    setItemWindow: function (w) { this._itemWindow = w; },
    needsSelection: function () { return true; },
    value: function () { return $gameParty.gold(); },
    currencyUnit: function () { return 'G'; },
    currentSymbol: function () { return this._symbol || null; },
    setItem: function (it) { this._item = it; }
  };
}

Scene_Shop.prototype.__menuBaseCreate = function () {     /* rpg_scenes.js:909 */
  this.createBackground();
  this.updateActor();
  this.createWindowLayer();
};
/* createBackground — rpg_scenes.js:924. MV parents ONE sprite holding the
   already-blurred snap (snapForBackground blurred it) and does nothing else.
   MZ (rmmz :1248) attaches a live PIXI.filters.BlurFilter to the sprite and
   calls setBackgroundOpacity(192) — so on MZ the blur is a render-time filter
   that a mod can remove, and on MV it is baked into the bitmap and cannot be. */
Scene_Shop.prototype.createBackground = function () {
  this._backgroundSprite = new Sprite();
  this._backgroundSprite.bitmap = SceneManager.backgroundBitmap();
  this.addChild(this._backgroundSprite);
};
Scene_Shop.prototype.updateActor = function () {          /* rpg_scenes.js:920 */
  this._actor = $gameParty.menuActor();
};
SceneManager.backgroundBitmap = function () { return this._backgroundBitmap || null; };

/* menuActor — rpg_objects.js:5053. .contains once more, and the fallback is
   the important half: an unset or stale _menuActorId does not throw, it
   silently becomes members()[0]. MZ (rmmz :5703) is the same body with
   .includes. Modelled because Scene_MenuBase.updateActor is the first thing
   Scene_Shop.create() reaches. */
Game_Party.prototype.menuActor = function () {
  var actor = $gameActors.actor(this._menuActorId);
  if (!this.members().contains(actor)) {
    actor = this.members()[0];
  }
  return actor;
};

/* createHelpWindow — Scene_MenuBase, rpg_scenes.js:934. `new Window_Help()`
   with no arguments: the help window is ONE line tall by default and sits at
   0,0. MZ (rmmz :1261) hands it a Rectangle from helpWindowRect(). Note the
   MV help window's HEIGHT is then read by createGoldWindow below, so the shop
   layout hangs off a default nobody passed. */
Scene_Shop.prototype.createHelpWindow = function () {
  this._helpWindow = __shopWin('Window_Help', []);
  this._helpWindow.height = 108;                 /* Window_Help.fittingHeight(2) */
  this.addWindow(this._helpWindow);
};

Scene_Shop.prototype.createGoldWindow = function () {     /* :1875 */
  this._goldWindow = __shopWin('Window_Gold', [0, this._helpWindow.height]);
  this._goldWindow.width = 240;
  this._goldWindow.x = Graphics.boxWidth - this._goldWindow.width;
  this._goldWindow.y = this._helpWindow.height;
  this.addWindow(this._goldWindow);
};

/* :1881 — the command window is sized by the GOLD WINDOW'S X, and
   purchaseOnly is a CONSTRUCTOR argument. On MZ it is set afterwards with
   setPurchaseOnly(), so a mod that flips purchaseOnly after create() has an
   effect there and none here. */
Scene_Shop.prototype.createCommandWindow = function () {
  this._commandWindow = __shopWin('Window_ShopCommand', [this._goldWindow.x, this._purchaseOnly]);
  this._commandWindow.width = this._goldWindow.x;
  this._commandWindow.height = 72;
  this._commandWindow.y = this._helpWindow.height;
  this._commandWindow.setHandler('buy', this.commandBuy.bind(this));
  this._commandWindow.setHandler('sell', this.commandSell.bind(this));
  this._commandWindow.setHandler('cancel', this.popScene.bind(this));
  this.addWindow(this._commandWindow);
};

Scene_Shop.prototype.createDummyWindow = function () {    /* :1890 */
  var wy = this._commandWindow.y + this._commandWindow.height;
  var wh = Graphics.boxHeight - wy;
  this._dummyWindow = __shopWin('Window_Base', [0, wy, Graphics.boxWidth, wh]);
  this._dummyWindow.y = wy;
  this._dummyWindow.height = wh;
  this._dummyWindow.width = Graphics.boxWidth;
  this.addWindow(this._dummyWindow);
};

Scene_Shop.prototype.createNumberWindow = function () {   /* :1897 */
  var wy = this._dummyWindow.y;
  var wh = this._dummyWindow.height;
  this._numberWindow = __shopWin('Window_ShopNumber', [0, wy, wh]);
  this._numberWindow.y = wy;
  this._numberWindow.height = wh;
  this._numberWindow.width = Graphics.boxWidth - 352;
  this._numberWindow.hide();
  this._numberWindow.setHandler('ok', this.onNumberOk.bind(this));
  this._numberWindow.setHandler('cancel', this.onNumberCancel.bind(this));
  this.addWindow(this._numberWindow);
};

/* :1907 — the status window's X is the NUMBER WINDOW'S WIDTH, so MV derives
   the split from a window it built two calls ago. MZ asks statusWidth()
   (a flat 352) instead. */
Scene_Shop.prototype.createStatusWindow = function () {
  var wx = this._numberWindow.width;
  var wy = this._dummyWindow.y;
  var ww = Graphics.boxWidth - wx;
  var wh = this._dummyWindow.height;
  this._statusWindow = __shopWin('Window_ShopStatus', [wx, wy, ww, wh]);
  this._statusWindow.x = wx; this._statusWindow.y = wy;
  this._statusWindow.width = ww; this._statusWindow.height = wh;
  this._statusWindow.hide();
  this.addWindow(this._statusWindow);
};

/* createBuyWindow — :1917. THE MV/MZ SPLIT. MV passes this._goods as the
   FOURTH CONSTRUCTOR ARGUMENT, so Window_ShopBuy.initialize stores them and
   calls refresh() -> makeItemList() before this line returns. There is no
   moment at which a live buy window exists without its goods, and a mod that
   wants to filter the list must alias makeItemList — aliasing create and
   editing _shopGoods afterwards is already too late for the first refresh.
   MZ builds the window from a Rectangle and calls setupGoods() on the next
   line, which is a seam MV simply does not have. */
Scene_Shop.prototype.createBuyWindow = function () {
  var wy = this._dummyWindow.y;
  var wh = this._dummyWindow.height;
  this._buyWindow = new Window_ShopBuy(0, wy, wh, this._goods);
  this._buyWindow.setHelpWindow(this._helpWindow);
  this._buyWindow.setStatusWindow(this._statusWindow);
  this._buyWindow.hide();
  this._buyWindow.setHandler('ok', this.onBuyOk.bind(this));
  this._buyWindow.setHandler('cancel', this.onBuyCancel.bind(this));
  this.addWindow(this._buyWindow);
};

Scene_Shop.prototype.createCategoryWindow = function () { /* :1929 */
  this._categoryWindow = __shopWin('Window_ItemCategory', []);
  this._categoryWindow.height = 72;
  this._categoryWindow.setHelpWindow(this._helpWindow);
  this._categoryWindow.y = this._dummyWindow.y;
  this._categoryWindow.hide();
  this._categoryWindow.deactivate();
  this._categoryWindow.setHandler('ok', this.onCategoryOk.bind(this));
  this._categoryWindow.setHandler('cancel', this.onCategoryCancel.bind(this));
  this.addWindow(this._categoryWindow);
};

Scene_Shop.prototype.createSellWindow = function () {     /* :1940 */
  var wy = this._categoryWindow.y + this._categoryWindow.height;
  var wh = Graphics.boxHeight - wy;
  this._sellWindow = __shopWin('Window_ShopSell', [0, wy, Graphics.boxWidth, wh]);
  this._sellWindow.y = wy; this._sellWindow.height = wh;
  this._sellWindow.width = Graphics.boxWidth;
  this._sellWindow.setHelpWindow(this._helpWindow);
  this._sellWindow.hide();
  this._sellWindow.setHandler('ok', this.onSellOk.bind(this));
  this._sellWindow.setHandler('cancel', this.onSellCancel.bind(this));
  this._categoryWindow.setItemWindow(this._sellWindow);
  this.addWindow(this._sellWindow);
};

/* The eight handlers create() binds. Bodies trimmed to recorders — they are
   window plumbing (activate/select/show/hide sequences) and none of them
   changes a field a caller reads. Named and bound anyway, because create()
   binds them and an unbound name would throw at create time rather than at
   the moment a real check would notice. MV :1952-2048. */
Scene_Shop.prototype.commandBuy = function () { window.__shopBuy = (window.__shopBuy || 0) + 1; };
Scene_Shop.prototype.commandSell = function () { window.__shopSell = (window.__shopSell || 0) + 1; };
Scene_Shop.prototype.onBuyOk = function () { this._item = this._buyWindow.item(); };
Scene_Shop.prototype.onBuyCancel = function () { this._item = null; };
Scene_Shop.prototype.onCategoryOk = function () { };
Scene_Shop.prototype.onCategoryCancel = function () { };
Scene_Shop.prototype.onSellOk = function () { };
Scene_Shop.prototype.onSellCancel = function () { };
Scene_Shop.prototype.onNumberOk = function () { };
Scene_Shop.prototype.onNumberCancel = function () { };
Scene_Shop.prototype.activateBuyWindow = function () { this._buyWindow.activate(); };
Scene_Shop.prototype.activateSellWindow = function () { this._sellWindow.activate(); };

/* -------------------------------------------------------------------------
   Window_ShopBuy — the MV halves. rpg_windows.js:2926-3004.
   ---------------------------------------------------------------------- */
/* initialize — :2926. FOUR positional arguments and the goods among them:
   (x, y, HEIGHT, shopGoods). The width is not a parameter at all — the window
   asks windowWidth() for a hard-coded 456 — so a 1280-wide MV project gets
   the same 456px buy list as an 816-wide one. Then refresh() and select(0)
   run INSIDE the constructor, so _data and _price are populated and the
   cursor is on row 0 before anyone can touch the instance. */
Window_ShopBuy.prototype.initialize = function (x, y, height, shopGoods) {
  var width = this.windowWidth();
  this.x = x; this.y = y; this.width = width; this.height = height;
  this._width = width;
  this._index = -1;
  this._shopGoods = shopGoods;
  this._money = 0;
  this.visible = true;
  this.active = true;
  this.refresh();
  this.select(0);
};
Window_ShopBuy.prototype.windowWidth = function () {      /* :2935 */
  return 456;
};
/* item — :2943. A bare `this._data[this.index()]`, with no bounds test: index
   -1 yields undefined and index 0 on an empty list yields undefined too. MZ
   routes through itemAt(), which returns null for a negative index — so the
   same empty shop hands back undefined here and null there. */
Window_ShopBuy.prototype.item = function () {
  return this._data[this.index()];
};
/* refresh — :2965. MV drives the three steps itself. MZ's calls
   Window_Selectable.prototype.refresh after makeItemList, which is one more
   layer a plugin can be sitting in. */
Window_ShopBuy.prototype.refresh = function () {
  this.makeItemList();
  this.createContents();
  this.drawAllItems();
};
/* makeItemList — :2971. The switch is INLINE here; MZ factored it out into
   goodsToItem(goods), which is a hook point MV does not offer — on MV the
   only way to reinterpret a goods row is to replace this whole method.

   Both rebuild _data and _price from scratch, drop any row whose lookup
   returns falsy (so a goods row naming a deleted id vanishes silently rather
   than throwing), and price the row as `goods[2] === 0 ? item.price :
   goods[3]`. goods[2] is the price TYPE, goods[3] the override. Note the two
   arrays are kept in lockstep by position, which is why price() has to search
   _data by identity to index _price. */
Window_ShopBuy.prototype.makeItemList = function () {
  this._data = [];
  this._price = [];
  this._shopGoods.forEach(function (goods) {
    var item = null;
    switch (goods[0]) {
      case 0:
        item = $dataItems[goods[1]];
        break;
      case 1:
        item = $dataWeapons[goods[1]];
        break;
      case 2:
        item = $dataArmors[goods[1]];
        break;
    }
    if (item) {
      this._data.push(item);
      this._price.push(goods[2] === 0 ? item.price : goods[3]);
    }
  }, this);
  window.__shopItemLists = (window.__shopItemLists || 0) + 1;
};
/* drawItem — :2994. MV shrinks the row by textPadding() and hard-codes
   priceWidth at 96 as a local; MZ reads a priceWidth() METHOD and uses
   itemLineRect. Trimmed to the two draw calls, since the geometry has no
   reader in this harness. */
Window_ShopBuy.prototype.drawItem = function (index) {
  var item = this._data[index];
  var priceWidth = 96;
  this.changePaintOpacity(this.isEnabled(item));
  this.drawItemName(item, 0, 0, this.width - priceWidth);
  this.drawText(this.price(item), 0, 0, priceWidth, 'right');
  this.changePaintOpacity(true);
};
