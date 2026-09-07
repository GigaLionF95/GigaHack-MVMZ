/* =============================================================================
   GigaHack test harness — stubs/x-equip-mz.js
   EQUIPMENT, PARTY INVENTORY and the SHOP — the DIVERGENT MZ surface.
   Copied from /root/work/mz/js/rmmz_*.js (RPG Maker MZ 1.9.0).

   STOCK ENGINE ONLY. Loaded IMMEDIATELY AFTER engine-mz.js, so it may reach
   core.js, x-equip.js and engine-mz.js. It may NOT use Array.prototype
   .contains: that is an MV engine extension and MZ does not ship it — the
   native .includes below is the whole reason four of these one-line members
   are duplicated out of the shared file.

   The MZ side of each split modelled here, mirroring x-equip-mv.js:
     1. .includes where MV writes .contains, in seven places.
     2. Game_Party.hasItem — the `includeEquip === undefined` default line MV
        opens with was DELETED here.
     3. Game_Party.maxItems — MZ commented the parameter out, so its arity is
        0. core.js:971 already carries exactly that shape, so this file
        deliberately defines nothing for it (see below).
     4. Game_Actor.traitObjects — MZ PUSHES into the array the base handed it;
        MV rebinds a concat.
     5. TRAIT_ATTACK_SKILL = 35 exists here and nowhere on MV.
     6. Every window takes a Rectangle from a *WindowRect() method, and
        Window_ShopBuy receives its goods AFTER construction via setupGoods —
        a seam MV does not have.
     7. Scene_Base grew centerSprite and scaleSprite, which on MV live on
        Scene_Title and (scaleSprite) not at all.
   ========================================================================== */

/* -------------------------------------------------------------------------
   TRAIT_ATTACK_SKILL — rmmz_objects.js:2401. Slots into the gap MV leaves
   after TRAIT_ATTACK_TIMES = 34. Anything rendering a trait table by constant
   name has a hole here on MV and a name here.
   ---------------------------------------------------------------------- */
Game_BattlerBase.TRAIT_ATTACK_SKILL = 35;

/* -------------------------------------------------------------------------
   The four equip permission tests — rmmz_objects.js:2962-2976.
   Native .includes. See x-equip-mv.js for why these four are not shared.
   ---------------------------------------------------------------------- */
Game_BattlerBase.prototype.isEquipWtypeOk = function (wtypeId) {      /* :2962 */
  return this.traitsSet(Game_BattlerBase.TRAIT_EQUIP_WTYPE).includes(wtypeId);
};
Game_BattlerBase.prototype.isEquipAtypeOk = function (atypeId) {      /* :2966 */
  return this.traitsSet(Game_BattlerBase.TRAIT_EQUIP_ATYPE).includes(atypeId);
};
Game_BattlerBase.prototype.isEquipTypeLocked = function (etypeId) {   /* :2970 */
  return this.traitsSet(Game_BattlerBase.TRAIT_EQUIP_LOCK).includes(etypeId);
};
Game_BattlerBase.prototype.isEquipTypeSealed = function (etypeId) {   /* :2974 */
  return this.traitsSet(Game_BattlerBase.TRAIT_EQUIP_SEAL).includes(etypeId);
};

/* -------------------------------------------------------------------------
   Game_Actor — the MZ halves.
   ---------------------------------------------------------------------- */
/* rmmz_objects.js:4254 / :4258 / :4302 — three more .includes sites. */
Game_Actor.prototype.hasWeapon = function (weapon) {
  return this.weapons().includes(weapon);
};
Game_Actor.prototype.hasArmor = function (armor) {
  return this.armors().includes(armor);
};
Game_Actor.prototype.isEquipped = function (item) {
  return this.equips().includes(item);
};

/* traitObjects — rmmz_objects.js:4453. MZ PUSHES the actor and class records
   into the array the base returned and then walks equips() with for..of. MV
   (rpg :3807) rebinds `objects` to a concat instead. The contents and the
   order match — states, actor, class, equipment — but the MZ version mutates
   the array Game_BattlerBase.traitObjects handed back, so anything that
   returned a CACHED array from a hooked traitObjects would find its cache
   growing on MZ and untouched on MV.

   The engine writes `Game_Battler.prototype.traitObjects.call(this)`. Neither
   engine's Game_Battler overrides traitObjects (grep both sources: zero
   hits), so that resolves to Game_BattlerBase's, which is what is called here
   — the harness has no Game_Battler class. The for..of is spelled as an ES5
   index loop; nothing else changed. */
Game_Actor.prototype.traitObjects = function () {
  var objects = Game_BattlerBase.prototype.traitObjects.call(this);
  objects.push(this.actor(), this.currentClass());
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
   Game_Party — the MZ halves.
   ---------------------------------------------------------------------- */
/* hasItem — rmmz_objects.js:5627. MZ DROPPED MV's opening
       if (includeEquip === undefined) { includeEquip = false; }
   and starts straight at the numItems test. Same answer either way; the
   deletion is the only textual difference between the two bodies, and it is
   modelled so a diff of these two files shows exactly what a diff of the two
   engines shows. */
Game_Party.prototype.hasItem = function (item, includeEquip) {
  if (this.numItems(item) > 0) {
    return true;
  } else if (includeEquip && this.isAnyMemberEquipped(item)) {
    return true;
  } else {
    return false;
  }
};

/* isAnyMemberEquipped — rmmz_objects.js:5637. .includes, and members() again
   rather than allMembers(). */
Game_Party.prototype.isAnyMemberEquipped = function (item) {
  return this.members().some(function (actor) {
    return actor.equips().includes(item);
  });
};

/* maxItems — rmmz_objects.js:5619. DELIBERATELY NOT DEFINED HERE.
   MZ's signature is `function(/* item *\/)` — the parameter is commented out,
   so Game_Party.prototype.maxItems.length is 0. core.js:971 already declares
   it with no parameter, which is MZ's exact shape, and redefining it would
   add nothing. MV's version DOES declare the parameter and so restates it in
   x-equip-mv.js to recover arity 1. The pair of engines disagree on
   Function.length for a method neither of them has changed in behaviour. */

/* menuActor — rmmz_objects.js:5703. .includes, with the same silent fallback
   to members()[0] when _menuActorId names nobody in the party. Modelled
   because Scene_MenuBase.updateActor is the first thing Scene_Shop.create()
   reaches. */
Game_Party.prototype.menuActor = function () {
  var actor = $gameActors.actor(this._menuActorId);
  if (!this.members().includes(actor)) {
    actor = this.members()[0];
  }
  return actor;
};

/* -------------------------------------------------------------------------
   Scene_Base — the MZ halves, plus the layout helpers MZ's rect methods need.
   ---------------------------------------------------------------------- */
/* createWindowLayer — rmmz_scenes.js:76. MZ sets only x and y and never gives
   the layer a width or a height; MV (rpg :158) calls move(x, y, w, h) and the
   layer has a size. Measuring the window layer therefore yields a rectangle
   on MV and a bare point here. */
Scene_Base.prototype.createWindowLayer = function () {
  this._windowLayer = {
    x: (Graphics.width - Graphics.boxWidth) / 2,
    y: (Graphics.height - Graphics.boxHeight) / 2,
    children: [],
    addChild: function (c) { this.children.push(c); return c; }
  };
  this.addChild(this._windowLayer);
};

/* startFadeIn — rmmz_scenes.js:87. NO fade sprite: MZ keeps _fadeWhite and
   _fadeOpacity as plain fields and paints the fade with a colour filter over
   the whole scene. MV (rpg :189) creates a ScreenSprite and ADDS IT AS A
   CHILD, so on MV the fade is a sibling an overlay can be placed above and
   here it is not a child at all. */
Scene_Base.prototype.startFadeIn = function (duration, white) {
  this._fadeSign = 1;
  this._fadeDuration = duration || 30;
  this._fadeWhite = white;
  this._fadeOpacity = 255;
};

/* scaleSprite / centerSprite — rmmz_scenes.js:160 / :168. Both on SCENE_BASE
   here, so every MZ scene has them. MV has centerSprite on Scene_Title only
   (rpg :494) and no scaleSprite anywhere — undersized title art letterboxes
   on MV and is scaled up to cover on MZ. Math.max(ratioX, ratioY, 1.0) never
   scales DOWN: oversized art stays oversized on both. */
Scene_Base.prototype.scaleSprite = function (sprite) {
  var ratioX = Graphics.width / sprite.bitmap.width;
  var ratioY = Graphics.height / sprite.bitmap.height;
  var scale = Math.max(ratioX, ratioY, 1.0);
  sprite.scale = sprite.scale || { x: 1, y: 1 };
  sprite.scale.x = scale;
  sprite.scale.y = scale;
};
Scene_Base.prototype.centerSprite = function (sprite) {
  sprite.x = Graphics.width / 2;
  sprite.y = Graphics.height / 2;
  sprite.anchor = sprite.anchor || { x: 0, y: 0 };
  sprite.anchor.x = 0.5;
  sprite.anchor.y = 0.5;
};

/* The layout arithmetic every MZ *WindowRect() hangs off. MV has NONE of
   this: its windows are given positional geometry computed inline in each
   create* method, so there is no shared vocabulary for a mod to override.
   rmmz_scenes.js — calcWindowHeight :212, mainCommandWidth :187,
   isBottomButtonMode :179, buttonAreaTop :191, buttonAreaBottom :199,
   buttonAreaHeight :203; Scene_MenuBase — isBottomHelpMode (Scene_Base :175),
   helpAreaTop :1204, helpAreaBottom :1214, helpAreaHeight :1218,
   mainAreaTop :1222, mainAreaBottom :1232, mainAreaHeight :1236.

   calcWindowHeight really routes through Window_Selectable.fittingHeight or
   Window_Base.fittingHeight (rmmz_windows.js:80), which are
   `numLines * itemHeight() + $gameSystem.windowPadding() * 2`. Those two
   classes belong to the window area, so the arithmetic is inlined here with
   the stock numbers it resolves to: windowPadding 12 (rmmz_objects.js:412),
   Window_Base.itemHeight 36 (rmmz_windows.js:54 -> lineHeight), and
   Window_Selectable.itemHeight 44 (:895 — lineHeight + 8). The `selectable`
   flag is NOT cosmetic: it is an 8px-per-line difference. */
Scene_Base.prototype.calcWindowHeight = function (numLines, selectable) {
  if (selectable) {
    return numLines * 44 + 24;
  } else {
    return numLines * 36 + 24;
  }
};
Scene_Base.prototype.mainCommandWidth = function () { return 240; };
Scene_Base.prototype.isBottomButtonMode = function () { return false; };
Scene_Base.prototype.isBottomHelpMode = function () { return true; };
Scene_Base.prototype.buttonAreaHeight = function () { return 52; };
Scene_Base.prototype.buttonAreaTop = function () {
  if (this.isBottomButtonMode()) {
    return Graphics.boxHeight - this.buttonAreaHeight();
  } else {
    return 0;
  }
};
Scene_Base.prototype.buttonAreaBottom = function () {
  return this.buttonAreaTop() + this.buttonAreaHeight();
};

/* snapForBackground — rmmz_managers.js:2251. MZ DESTROYS the previous
   background bitmap before taking a new one, and does not blur (the blur is
   the live filter Scene_MenuBase.createBackground attaches instead). MV
   (rpg :2117) blurs the snap and leaks the old one. Two differences in three
   lines, in opposite directions. */
SceneManager.snapForBackground = function () {
  if (this._backgroundBitmap) {
    this._backgroundBitmap.destroy();
  }
  this._backgroundBitmap = this.snap();
  window.__snapsForBackground = (window.__snapsForBackground || 0) + 1;
};
SceneManager.backgroundBitmap = function () { return this._backgroundBitmap || null; };

/* ImageManager.loadTitle1 / loadTitle2 — rmmz_managers.js:955 / :959. ONE
   parameter. MV's take (filename, hue) and forward a smooth flag as well, so
   the two disagree on arity for a call the title scene makes twice. */
ImageManager.loadTitle1 = function (filename) {
  return { _dir: 'img/titles1/', _name: filename, width: 1280, height: 720,
    isReady: function () { return true; }, destroy: function () { this._destroyed = true; } };
};
ImageManager.loadTitle2 = function (filename) {
  return { _dir: 'img/titles2/', _name: filename, width: 1280, height: 720,
    isReady: function () { return true; }, destroy: function () { this._destroyed = true; } };
};

/* -------------------------------------------------------------------------
   Scene_Title — the MZ halves. rmmz_scenes.js:507-597.
   ---------------------------------------------------------------------- */
/* start — :507. adjustBackground() where MV centres inline. */
Scene_Title.prototype.start = function () {
  this._active = true;
  SceneManager.clearStack();
  this.adjustBackground();
  this.playTitleMusic();
  this.startFadeIn(this.fadeSpeed(), false);
  window.__titleStarts = (window.__titleStarts || 0) + 1;
};
/* adjustBackground — :571. MZ-ONLY: scale first, then centre, both sprites.
   MV has no such method and never scales. */
Scene_Title.prototype.adjustBackground = function () {
  this.scaleSprite(this._backSprite1);
  this.scaleSprite(this._backSprite2);
  this.centerSprite(this._backSprite1);
  this.centerSprite(this._backSprite2);
};

/* terminate — :529. MZ additionally DESTROYS the title bitmap after snapping,
   guarded on _gameTitleSprite existing. MV (rpg :463) leaves it alive, so a
   reference held across a title exit is dangling here and merely stale there. */
Scene_Title.prototype.terminate = function () {
  SceneManager.snapForBackground();
  if (this._gameTitleSprite) {
    this._gameTitleSprite.bitmap.destroy();
  }
};

/* drawGameTitle — :558. The FIRST line of the MZ body sets
   `bitmap.fontFace = $gameSystem.mainFontFace()`. MV never touches fontFace
   at all and $gameSystem.mainFontFace does not exist there (engine-mz.js
   defines it; MV has neither mainFontFace nor mainFontSize). This is the seam
   a global font override reaches on MZ and cannot reach on MV. MZ also hoists
   the bitmap into a local first, which is why a plugin that swaps
   _gameTitleSprite.bitmap mid-method changes nothing here and everything on
   MV, where each line re-reads the sprite. */
Scene_Title.prototype.drawGameTitle = function () {
  var x = 20;
  var y = Graphics.height / 4;
  var maxWidth = Graphics.width - x * 2;
  var text = $dataSystem.gameTitle;
  var bitmap = this._gameTitleSprite.bitmap;
  bitmap.fontFace = $gameSystem.mainFontFace();
  bitmap.outlineColor = 'black';
  bitmap.outlineWidth = 8;
  bitmap.fontSize = 72;
  bitmap.drawText(text, x, y, maxWidth, 48, 'center');
};

/* createCommandWindow / commandWindowRect — :578 / :589. Three $dataSystem
   fields MV's database does not have: titleCommandWindow.background,
   .offsetX and .offsetY. The rect is computed here and handed to the
   constructor; MV constructs the window with no arguments and lets it place
   itself. */
Scene_Title.prototype.createCommandWindow = function () {
  var background = $dataSystem.titleCommandWindow.background;
  var rect = this.commandWindowRect();
  this._commandWindow = new Window_TitleCommand(rect);
  this._commandWindow.setBackgroundType(background);
  this._commandWindow.setHandler('newGame', this.commandNewGame.bind(this));
  this._commandWindow.setHandler('continue', this.commandContinue.bind(this));
  this._commandWindow.setHandler('options', this.commandOptions.bind(this));
  this.addWindow(this._commandWindow);
};
Scene_Title.prototype.commandWindowRect = function () {
  var offsetX = $dataSystem.titleCommandWindow.offsetX;
  var offsetY = $dataSystem.titleCommandWindow.offsetY;
  var ww = this.mainCommandWidth();
  var wh = this.calcWindowHeight(3, true);
  var wx = (Graphics.boxWidth - ww) / 2 + offsetX;
  var wy = Graphics.boxHeight - wh - 96 + offsetY;
  return new Rectangle(wx, wy, ww, wh);
};

/* -------------------------------------------------------------------------
   Scene_Shop — the MZ halves. rmmz_scenes.js:2544-2703.

   __menuBaseCreate stands in for `Scene_MenuBase.prototype.create.call(this)`
   for the reason given in x-equip.js's Scene_Shop header. MZ's Scene_MenuBase
   .create (rmmz :1191) is FOUR calls — super, createBackground, updateActor,
   createWindowLayer, createButtons — where MV's is three. createButtons is
   gated on ConfigManager.touchUI, a setting MV's ConfigManager does not have,
   so the MZ shop has cancel and page buttons in the scene's child list that
   the MV shop never has.

   The eight non-buy create* methods build RECORDER objects rather than the
   real window classes, which belong to the window area. What IS modelled
   exactly is that every one of them takes A RECTANGLE from a *WindowRect()
   method — the MV/MZ calling-convention split — and every rect method's
   arithmetic is copied from the source, because those are the numbers a
   layout-editing mod reads back.
   ---------------------------------------------------------------------- */
function __shopWinMZ(name, rect) {
  return {
    _class: name, ctorArgs: [rect],
    x: rect ? rect.x : 0, y: rect ? rect.y : 0,
    width: rect ? rect.width : 0, height: rect ? rect.height : 0,
    visible: true, active: true, _handlers: {},
    hide: function () { this.visible = false; },
    show: function () { this.visible = true; },
    activate: function () { this.active = true; },
    deactivate: function () { this.active = false; },
    setHandler: function (s, m) { this._handlers[s] = m; },
    setHelpWindow: function (w) { this._helpWindow = w; },
    setItemWindow: function (w) { this._itemWindow = w; },
    setPurchaseOnly: function (v) { this._purchaseOnly = v; },
    setBackgroundType: function (t) { this._backgroundType = t; },
    needsSelection: function () { return true; },
    value: function () { return $gameParty.gold(); },
    currencyUnit: function () { return 'G'; },
    currentSymbol: function () { return this._symbol || null; },
    setItem: function (it) { this._item = it; }
  };
}

Scene_Shop.prototype.__menuBaseCreate = function () {     /* rmmz_scenes.js:1191 */
  this.createBackground();
  this.updateActor();
  this.createWindowLayer();
  this.createButtons();
};
/* createBackground — rmmz :1248. A LIVE PIXI.filters.BlurFilter on the
   background sprite plus setBackgroundOpacity(192). MV (rpg :924) parents a
   plain sprite holding an already-blurred snap. The blur is removable here
   and baked in there. PIXI.filters is not modelled in core.js's PIXI surface,
   so the filter is recorded as a marker object rather than constructed. */
Scene_Shop.prototype.createBackground = function () {
  this._backgroundFilter = { _class: 'PIXI.filters.BlurFilter' };
  this._backgroundSprite = new Sprite();
  this._backgroundSprite.bitmap = SceneManager.backgroundBitmap();
  this._backgroundSprite.filters = [this._backgroundFilter];
  this.addChild(this._backgroundSprite);
  this.setBackgroundOpacity(192);
};
Scene_Shop.prototype.setBackgroundOpacity = function (opacity) {
  this._backgroundSprite.opacity = opacity;
};
Scene_Shop.prototype.updateActor = function () {          /* rmmz :1244 */
  this._actor = $gameParty.menuActor();
};
/* createButtons — rmmz :1275. MZ-ONLY, and gated on ConfigManager.touchUI,
   which core.js's ConfigManager (:1007) does not define — the field is absent
   on MV's ConfigManager too, so `undefined` here is the honest answer and no
   buttons are made. Left ungated for exactly that reason. */
Scene_Shop.prototype.createButtons = function () {
  if (ConfigManager.touchUI) {
    this._cancelButton = { _class: 'Sprite_Button', _type: 'cancel' };
    this.addChild(this._cancelButton);
  }
  window.__shopButtonPasses = (window.__shopButtonPasses || 0) + 1;
};

/* createHelpWindow / helpWindowRect — Scene_MenuBase, rmmz :1261 / :1267.
   A Rectangle, and its height is calcWindowHeight(2, FALSE) — the help window
   is the one shop window measured with Window_Base's 36px line rather than
   Window_Selectable's 44px. MV passes nothing and the window defaults itself. */
Scene_Shop.prototype.helpAreaHeight = function () { return this.calcWindowHeight(2, false); };
Scene_Shop.prototype.helpAreaTop = function () {
  if (this.isBottomHelpMode()) {
    return this.mainAreaBottom();
  } else if (this.isBottomButtonMode()) {
    return 0;
  } else {
    return this.buttonAreaBottom();
  }
};
Scene_Shop.prototype.helpAreaBottom = function () { return this.helpAreaTop() + this.helpAreaHeight(); };
Scene_Shop.prototype.mainAreaTop = function () {
  if (!this.isBottomHelpMode()) {
    return this.helpAreaBottom();
  } else if (this.isBottomButtonMode()) {
    return 0;
  } else {
    return this.buttonAreaBottom();
  }
};
Scene_Shop.prototype.mainAreaBottom = function () { return this.mainAreaTop() + this.mainAreaHeight(); };
Scene_Shop.prototype.mainAreaHeight = function () {
  return Graphics.boxHeight - this.buttonAreaHeight() - this.helpAreaHeight();
};
Scene_Shop.prototype.createHelpWindow = function () {
  var rect = this.helpWindowRect();
  this._helpWindow = __shopWinMZ('Window_Help', rect);
  this.addWindow(this._helpWindow);
};
Scene_Shop.prototype.helpWindowRect = function () {
  return new Rectangle(0, this.helpAreaTop(), Graphics.boxWidth, this.helpAreaHeight());
};

Scene_Shop.prototype.createGoldWindow = function () {     /* :2557 */
  var rect = this.goldWindowRect();
  this._goldWindow = __shopWinMZ('Window_Gold', rect);
  this.addWindow(this._goldWindow);
};
Scene_Shop.prototype.goldWindowRect = function () {       /* :2563 */
  var ww = this.mainCommandWidth();
  var wh = this.calcWindowHeight(1, true);
  var wx = Graphics.boxWidth - ww;
  var wy = this.mainAreaTop();
  return new Rectangle(wx, wy, ww, wh);
};

/* :2571 — purchaseOnly is set with setPurchaseOnly AFTER construction, where
   MV passes it as the second constructor argument. A mod that flips
   _purchaseOnly between prepare() and create() therefore reaches the window
   on MZ and not on MV. Note MZ also re-assigns .y after the rect already
   placed it — redundant in stock, kept because it is what the engine does. */
Scene_Shop.prototype.createCommandWindow = function () {
  var rect = this.commandWindowRect();
  this._commandWindow = __shopWinMZ('Window_ShopCommand', rect);
  this._commandWindow.setPurchaseOnly(this._purchaseOnly);
  this._commandWindow.y = this.mainAreaTop();
  this._commandWindow.setHandler('buy', this.commandBuy.bind(this));
  this._commandWindow.setHandler('sell', this.commandSell.bind(this));
  this._commandWindow.setHandler('cancel', this.popScene.bind(this));
  this.addWindow(this._commandWindow);
};
Scene_Shop.prototype.commandWindowRect = function () {    /* :2582 */
  var wx = 0;
  var wy = this.mainAreaTop();
  var ww = this._goldWindow.x;
  var wh = this.calcWindowHeight(1, true);
  return new Rectangle(wx, wy, ww, wh);
};

Scene_Shop.prototype.createDummyWindow = function () {    /* :2590 */
  var rect = this.dummyWindowRect();
  this._dummyWindow = __shopWinMZ('Window_Base', rect);
  this.addWindow(this._dummyWindow);
};
Scene_Shop.prototype.dummyWindowRect = function () {      /* :2596 */
  var wx = 0;
  var wy = this._commandWindow.y + this._commandWindow.height;
  var ww = Graphics.boxWidth;
  var wh = this.mainAreaHeight() - this._commandWindow.height;
  return new Rectangle(wx, wy, ww, wh);
};

Scene_Shop.prototype.createNumberWindow = function () {   /* :2604 */
  var rect = this.numberWindowRect();
  this._numberWindow = __shopWinMZ('Window_ShopNumber', rect);
  this._numberWindow.hide();
  this._numberWindow.setHandler('ok', this.onNumberOk.bind(this));
  this._numberWindow.setHandler('cancel', this.onNumberCancel.bind(this));
  this.addWindow(this._numberWindow);
};
Scene_Shop.prototype.numberWindowRect = function () {     /* :2613 */
  var wx = 0;
  var wy = this._dummyWindow.y;
  var ww = Graphics.boxWidth - this.statusWidth();
  var wh = this._dummyWindow.height;
  return new Rectangle(wx, wy, ww, wh);
};

Scene_Shop.prototype.createStatusWindow = function () {   /* :2621 */
  var rect = this.statusWindowRect();
  this._statusWindow = __shopWinMZ('Window_ShopStatus', rect);
  this._statusWindow.hide();
  this.addWindow(this._statusWindow);
};
Scene_Shop.prototype.statusWindowRect = function () {     /* :2628 */
  var ww = this.statusWidth();
  var wh = this._dummyWindow.height;
  var wx = Graphics.boxWidth - ww;
  var wy = this._dummyWindow.y;
  return new Rectangle(wx, wy, ww, wh);
};
/* statusWidth — :2701. A flat 352. MV derives the same split from the number
   window's WIDTH instead, so on MV the two panes are coupled and here they
   are not. */
Scene_Shop.prototype.statusWidth = function () { return 352; };

/* createBuyWindow — :2636. THE MV/MZ SPLIT. The window is constructed from a
   Rectangle with NO goods, and setupGoods(this._goods) is a SEPARATE CALL on
   the next line. That gap is a real seam: on MZ a live buy window can be
   re-stocked at any time by calling setupGoods again, and a mod that filters
   the list can alias setupGoods instead of makeItemList. MV has neither —
   there the goods arrive as the fourth constructor argument and makeItemList
   has already run before createBuyWindow's first line returns. */
Scene_Shop.prototype.createBuyWindow = function () {
  var rect = this.buyWindowRect();
  this._buyWindow = new Window_ShopBuy(rect);
  this._buyWindow.setupGoods(this._goods);
  this._buyWindow.setHelpWindow(this._helpWindow);
  this._buyWindow.setStatusWindow(this._statusWindow);
  this._buyWindow.hide();
  this._buyWindow.setHandler('ok', this.onBuyOk.bind(this));
  this._buyWindow.setHandler('cancel', this.onBuyCancel.bind(this));
  this.addWindow(this._buyWindow);
};
Scene_Shop.prototype.buyWindowRect = function () {        /* :2648 */
  var wx = 0;
  var wy = this._dummyWindow.y;
  var ww = Graphics.boxWidth - this.statusWidth();
  var wh = this._dummyWindow.height;
  return new Rectangle(wx, wy, ww, wh);
};

Scene_Shop.prototype.createCategoryWindow = function () { /* :2656 */
  var rect = this.categoryWindowRect();
  this._categoryWindow = __shopWinMZ('Window_ItemCategory', rect);
  this._categoryWindow.setHelpWindow(this._helpWindow);
  this._categoryWindow.hide();
  this._categoryWindow.deactivate();
  this._categoryWindow.setHandler('ok', this.onCategoryOk.bind(this));
  this._categoryWindow.setHandler('cancel', this.onCategoryCancel.bind(this));
  this.addWindow(this._categoryWindow);
};
Scene_Shop.prototype.categoryWindowRect = function () {   /* :2667 */
  var wx = 0;
  var wy = this._dummyWindow.y;
  var ww = Graphics.boxWidth;
  var wh = this.calcWindowHeight(1, true);
  return new Rectangle(wx, wy, ww, wh);
};

/* createSellWindow — :2675. MZ ends with a resize MV does not have: when the
   category window needsSelection() is false, the sell window ABSORBS the
   category window's height. So on MZ the sell list's geometry depends on how
   many item categories the project uses, and on MV it never does. */
Scene_Shop.prototype.createSellWindow = function () {
  var rect = this.sellWindowRect();
  this._sellWindow = __shopWinMZ('Window_ShopSell', rect);
  this._sellWindow.setHelpWindow(this._helpWindow);
  this._sellWindow.hide();
  this._sellWindow.setHandler('ok', this.onSellOk.bind(this));
  this._sellWindow.setHandler('cancel', this.onSellCancel.bind(this));
  this._categoryWindow.setItemWindow(this._sellWindow);
  this.addWindow(this._sellWindow);
  if (!this._categoryWindow.needsSelection()) {
    this._sellWindow.y -= this._categoryWindow.height;
    this._sellWindow.height += this._categoryWindow.height;
  }
};
Scene_Shop.prototype.sellWindowRect = function () {       /* :2690 */
  var wx = 0;
  var wy = this._categoryWindow.y + this._categoryWindow.height;
  var ww = Graphics.boxWidth;
  var wh = this.mainAreaHeight() - this._commandWindow.height - this._categoryWindow.height;
  return new Rectangle(wx, wy, ww, wh);
};

/* The handlers create() binds. Bodies trimmed to recorders for the reason
   given in x-equip-mv.js — they are window plumbing and change no field a
   caller reads. rmmz :2705-2811. */
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
   Window_ShopBuy — the MZ halves. rmmz_windows.js:3278-3365.
   ---------------------------------------------------------------------- */
/* initialize — :3278. ONE argument, a Rectangle, and it sets _money and
   NOTHING ELSE. There is no _shopGoods, no _data, no _price and no selection
   until setupGoods runs, so a buy window that is constructed and never
   stocked answers maxItems() === 1 (the `this._data ? ... : 1` fallback) and
   throws in price() on the first _data.indexOf. MV cannot reach that state. */
Window_ShopBuy.prototype.initialize = function (rect) {
  this.x = rect.x; this.y = rect.y;
  this.width = rect.width; this.height = rect.height;
  this._width = rect.width;
  this._index = -1;
  this.visible = true;
  this.active = true;
  this._money = 0;
};
/* setupGoods — :3283. MZ-ONLY. This is where the goods, the refresh and the
   select(0) that MV performs inside its constructor actually happen, and it
   can be called again on a live window. */
Window_ShopBuy.prototype.setupGoods = function (shopGoods) {
  this._shopGoods = shopGoods;
  this.refresh();
  this.select(0);
};
/* item / itemAt — :3293 / :3297. MZ routes through itemAt, which returns NULL
   for a negative index and for an absent _data. MV's item() is a bare
   `this._data[this.index()]` and answers undefined in both cases — so the
   same unselected window hands back null here and undefined there. */
Window_ShopBuy.prototype.item = function () {
  return this.itemAt(this.index());
};
Window_ShopBuy.prototype.itemAt = function (index) {
  return this._data && index >= 0 ? this._data[index] : null;
};
/* refresh — :3320. MZ delegates the redraw to Window_Selectable's refresh
   after makeItemList; MV performs createContents + drawAllItems itself. One
   more layer here for a plugin to sit in. The delegated call is spelled as
   the two steps it resolves to, because Window_Selectable is not this file's. */
Window_ShopBuy.prototype.refresh = function () {
  this.makeItemList();
  this.createContents();
  this.drawAllItems();
};
/* makeItemList — :3325. Same two lockstep arrays and the same
   `goods[2] === 0 ? item.price : goods[3]` pricing rule as MV, but the type
   switch is FACTORED OUT into goodsToItem — a per-row hook point MV does not
   offer. The for..of is spelled as an ES5 index loop. */
Window_ShopBuy.prototype.makeItemList = function () {
  this._data = [];
  this._price = [];
  for (var i = 0; i < this._shopGoods.length; i++) {
    var goods = this._shopGoods[i];
    var item = this.goodsToItem(goods);
    if (item) {
      this._data.push(item);
      this._price.push(goods[2] === 0 ? item.price : goods[3]);
    }
  }
  window.__shopItemLists = (window.__shopItemLists || 0) + 1;
};
/* goodsToItem — :3337. MZ-ONLY. goods[0] 0/1/2 selects the container and
   anything else returns null, which is what makes an unknown row vanish
   rather than throw. */
Window_ShopBuy.prototype.goodsToItem = function (goods) {
  switch (goods[0]) {
    case 0:
      return $dataItems[goods[1]];
    case 1:
      return $dataWeapons[goods[1]];
    case 2:
      return $dataArmors[goods[1]];
    default:
      return null;
  }
};
/* priceWidth — :3363. A METHOD here; MV hard-codes 96 as a local inside
   drawItem, so only MZ lets a plugin widen the price column. */
Window_ShopBuy.prototype.priceWidth = function () { return 96; };
/* drawItem — :3350. Reads the item through itemAt and the width through
   priceWidth(). Trimmed to the two draw calls; the geometry has no reader in
   this harness. */
Window_ShopBuy.prototype.drawItem = function (index) {
  var item = this.itemAt(index);
  var price = this.price(item);
  var priceWidth = this.priceWidth();
  var nameWidth = this.width - priceWidth;
  this.changePaintOpacity(this.isEnabled(item));
  this.drawItemName(item, 0, 0, nameWidth);
  this.drawText(price, 0, 0, priceWidth, 'right');
  this.changePaintOpacity(true);
};
