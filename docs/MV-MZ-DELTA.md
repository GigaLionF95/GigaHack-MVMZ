I have everything I need. Here is the report.

---

# MV 1.6.1 ↔ MZ 1.9.0 API delta — scoped to GigaHack

Engine sources: `MV rpg_*.js` (MV 1.6.1, PIXI 4.5.4) and `MZ rmmz_*.js` (MZ 1.9.0, PIXI 5). Mod: `gigahack/js/plugins/*.js`.

**Hook inventory:** exactly **43** `$.install(...)` sites across 10 files. `$.install` (`gigahack/js/plugins/GigaHack_Core.js:112`) resolves `typeof owner[method] === 'function'` through the prototype chain and shadows with an own property, so prototype-inherited targets (`Spriteset_Map.createUpperLayer`) install correctly on both engines, and a missing target degrades to `{installed:false}` rather than throwing. Of the 43, **39 install cleanly on MV**, **4 silently skip**, and **2 of the 39 are semantically fatal on MV** (§C.1).

The mod calls **no** `PluginManager.registerCommand`, no `@command`/`@arg` annotations, and touches Effekseer only in a comment (`GigaHack_Hooks.js:81`). All 23 files carry `@target MZ` (harmless on MV — MV's annotation parser ignores unknown tags).

---

## A. Missing in MV 1.6.1

### A.1 `ColorManager` — entire static class absent
`MZ rmmz_managers.js:1746`. No MV counterpart; MV puts every colour accessor on `Window_Base.prototype`.

- Mod use: `GigaHack_Text.js:728` (`colourAvailable`), `GigaHack_Text.js:764-771` (hook, already carries the fallback reason string `'ColorManager.normalColor not found'`).
- MZ: `ColorManager.normalColor = function() { return this.textColor(0); }` (`rmmz_managers.js:1760`), `ColorManager.textColor = function(n)` (`:1754`) reading `this._windowskin.getPixel(px, py)`.
- **MV equivalent:** `Window_Base.prototype.normalColor = function()` (`MV rpg_windows.js:179`) and `Window_Base.prototype.textColor = function(n)` (`:173`), which read `this.windowskin.getPixel(px, py)` — per-window, not global. The pixel arithmetic is byte-identical (`96 + (n%8)*12 + 6` / `144 + floor(n/8)*12 + 6`).
- **Port note:** the mod's "override normal text colour globally" feature has no single choke point in MV. Hooking `Window_Base.prototype.normalColor` reaches every stock window, but MV windows that call `textColor(0)` directly bypass it, and `Window_Base.prototype.resetTextColor` (`rpg_windows.js:104`) calls `this.normalColor()`, so hooking `normalColor` is still the best single point.
- Full MZ→MV map for the ColorManager methods the mod could want: `normalColor`→`Window_Base.prototype.normalColor` (:179), `systemColor`→(:183), `crisisColor`→(:187), `deathColor`→(:191), `gaugeBackColor`→(:195), `powerUpColor`→(:219), `powerDownColor`→(:223), `pendingColor`→(:239), `hpColor(actor)`→(:472), `mpColor(actor)`→(:482), `tpColor(actor)`→(:486). MZ's `ColorManager.outlineColor` (`:1877`) has **no MV equivalent** — MV has no `changeOutlineColor`; outline colour lives only on `Bitmap.outlineColor`.

### A.2 `Game_System.prototype.mainFontSize` / `mainFontFace` — absent
`MZ rmmz_objects.js:408` and `:400`.

- Mod use: `GigaHack_Text.js:723-725` (feature probe), `GigaHack_Text.js:740-748` and `:750-762` (the two hooks).
- **MV equivalents (exact signatures):**
  - `Window_Base.prototype.standardFontFace = function()` — `MV rpg_windows.js:39`, returns `'SimHei, Heiti TC, sans-serif'` / `'Dotum, AppleGothic, sans-serif'` / `'GameFont'`.
  - `Window_Base.prototype.standardFontSize = function()` — `rpg_windows.js:49`, returns `28`.
- The consumer differs too: MV `Window_Base.prototype.resetFontSettings` (`rpg_windows.js:99`) reads `this.standardFontFace()/standardFontSize()`; MZ's (`rmmz_windows.js:115`) reads `$gameSystem.mainFontFace()/mainFontSize()`. The mod's own comment at `GigaHack_Text.js:733-738` explains it deliberately hooks the Game_System accessor to avoid the per-draw `resetFontSettings` path — on MV that choice is unavailable and `Window_Base.prototype.standardFontFace/standardFontSize` are the only single-point hooks (still one call per `createContents`, not per draw call — `resetFontSettings` runs from `createContents` and from `drawTextEx`).
- Related MZ-only siblings the port may trip over: `Game_System.prototype.numberFontFace` (`rmmz_objects.js:404`), `windowPadding` (`:412`), `windowOpacity`. MV constants: `Window_Base.prototype.standardPadding = function(){return 18;}` (`rpg_windows.js:53`), `standardBackOpacity = function(){return 192;}` (`:61`), `textPadding = function(){return 6;}` (`:57`).

### A.3 `Game_System.prototype.setSavefileId` — absent — **unguarded, breaks quick save**
`MZ rmmz_objects.js:303` (`setSavefileId(savefileId)`); getter `savefileId()` at `:299`.

- Mod use: `GigaHack_Save.js:135`, inside the `$.safe` block that also calls `onBeforeSave()` and `DataManager.saveGame(id)`.
- **There is no MV equivalent.** MV has no per-session savefile id on `Game_System`; the nearest thing is `DataManager._lastAccessedId` (set inside `saveGameWithoutRescue`, `MV rpg_managers.js:379`) with reader `DataManager.lastAccessedSavefileId()` (`:359`).
- **Consequence on MV:** the call throws, `$.safe` returns the `null` fallback, and the mod reports `'quick save failed — saveGame threw'` — **`DataManager.saveGame` is never reached and no save is written**. This is the single highest-priority fix in the port.

### A.4 `Scene_File.prototype.isSavefileEnabled` — absent
`MZ rmmz_scenes.js:2276`: `Scene_File.prototype.isSavefileEnabled = function(savefileId) { return this._listWindow.isEnabled(savefileId); };`

- Mod use: `GigaHack_Save.js:307-319` (hook, needed for "save anywhere" to lift ironman's slot restriction).
- MV `Scene_File.prototype` has no such member (full list: `MV rpg_scenes.js:1621-1680`). MV's `Window_SavefileList` also has **no** `isEnabled` (full list `MV rpg_windows.js:2797-2879`); slot enablement simply does not exist — `Window_Selectable.prototype.isCurrentItemEnabled = function() { return true; }` (`rpg_windows.js:1247`) is never overridden by the savefile list, and `Window_SavefileList.prototype.drawItem` (`rpg_windows.js:2822`) only *dims* invalid entries via `changePaintOpacity(valid)`.
- MZ side for reference: `Window_SavefileList.prototype.isEnabled = function(savefileId)` at `MZ rmmz_windows.js:3177`.
- **Port note:** on MV the hook is a no-op concept. Whatever the target game's ironman plugin overrides in MV (likely `Window_SavefileList.prototype.drawItem` or `Scene_Save.prototype.onSavefileOk`, `rpg_scenes.js:1711`) is what must be hooked instead. `$.install` will record `installed:false` and log a warning, so nothing crashes.
- Related naming drift: MV `Scene_File.prototype.firstSavefileIndex()` (`rpg_scenes.js:1676`) vs MZ `Scene_File.prototype.firstSavefileId()` (`rmmz_scenes.js:2329`); MV `Window_SavefileList.prototype.setMode(mode)` (1 arg, `rpg_windows.js:2805`) vs MZ `setMode(mode, autosave)` (2 args, `rmmz_windows.js:3139`). MV's `Scene_File.prototype.mode()` (`rpg_scenes.js:1664`), which the mod's hook body calls, **does** exist.

### A.5 `DataManager.savefileInfo(savefileId)` — renamed
`MZ rmmz_managers.js:335`: `return globalInfo[savefileId] ? globalInfo[savefileId] : null;` (reads the cached `this._globalInfo`).

- Mod use: `GigaHack_Save.js:56` (`S.info`), which feeds `S.slots()` (`:60-72`), the save panel, and the overwrite-confirm at `:132`.
- **MV equivalent:** `DataManager.loadSavefileInfo = function(savefileId)` — `MV rpg_managers.js:360`:
  ```
  var globalInfo = this.loadGlobalInfo();
  return (globalInfo && globalInfo[savefileId]) ? globalInfo[savefileId] : null;
  ```
  Note it re-reads and re-parses the whole global file on **every** call — calling it 20× per panel repaint (which `S.slots()` does) is a synchronous LZString decompress ×20. Cache it.

### A.6 `DataManager._globalInfo` — absent
`MZ rmmz_managers.js:44` (`DataManager._globalInfo = null;`), populated asynchronously in `loadGlobalInfo` (`:64-73`).

- Mod use: `GigaHack_Save.js:652` (marks an imported slot's title). The surrounding comment (`:641-651`) documents the MZ async hazard.
- **MV equivalent:** there is no cached field. `DataManager.loadGlobalInfo()` (`MV rpg_managers.js:241`) **returns** the array synchronously, and `DataManager.saveGlobalInfo(info)` (`:262`) takes it as an argument (MZ's `saveGlobalInfo()` takes none, `rmmz_managers.js:86`). On MV the import path can and should do a real read-modify-write: `var gi = DataManager.loadGlobalInfo(); gi[id].title += ' (imported)'; DataManager.saveGlobalInfo(gi);` — which is *better* than what the mod can do on MZ.

### A.7 `DataManager.makeSavename(savefileId)` — absent
`MZ rmmz_managers.js:365`: `return "file%1".format(savefileId);`

- Mod use: `GigaHack_Hooks.js:214`, inside `$.saves.fileFor`.
- **MV:** no name/path split exists. MV's `StorageManager.localFilePath(savefileId)` (`MV rpg_managers.js:762`) does the id→filename mapping itself, including the special cases: `savefileId < 0` → `'config.rpgsave'`, `=== 0` → `'global.rpgsave'`, else `'file%1.rpgsave'.format(savefileId)`.

### A.8 `StorageManager.fileDirectoryPath()` / `StorageManager.filePath(saveName)` — renamed
`MZ rmmz_managers.js:762` and `:768`.

- Mod use: `GigaHack_Backup.js:42` and `:52` (backup availability + source dir), `GigaHack_Hooks.js:206`, `:210`, `:214`, `GigaHack_Save.js:476` (diagnostics panel).
- **MV equivalents (exact):**
  - `StorageManager.localFileDirectoryPath = function() { var path = require('path'); var base = path.dirname(process.mainModule.filename); return path.join(base, 'save/'); };` — `MV rpg_managers.js:755`
  - `StorageManager.localFilePath = function(savefileId) {...}` — `rpg_managers.js:762` (takes a **numeric id**, not a save name — see A.7).
- MZ's bodies for comparison: `fileDirectoryPath` is identical modulo `const`; `filePath = function(saveName) { return this.fileDirectoryPath() + saveName + ".rmmzsave"; }`.
- **Port note:** the reason the mod routes through `StorageManager` at all (a third-party plugin relocating saves to `%LOCALAPPDATA%`) applies equally on MV — keep the indirection, just point it at `localFileDirectoryPath`.

### A.9 `ImageManager.iconWidth` / `iconHeight` — absent (already defensively handled)
`MZ rmmz_managers.js:863` and `:870` (`Object.defineProperty` getters over `ImageManager.getIconSize()`, `:891`).

- Mod use: `GigaHack_Forge.js:1233` (`ImageManager.iconWidth || 32`), `GigaHack_UI.js:784` (`ImageManager.iconWidth || 32`). Both already fall back to 32.
- **MV equivalent:** the constants `Window_Base._iconWidth = 32;` / `Window_Base._iconHeight = 32;` — `MV rpg_windows.js:30-31`. Fixed at 32 in MV; MZ made them data-driven, hence the getters.
- No action strictly required, but for correctness on MV read `Window_Base._iconWidth`.

### A.10 `Window.prototype._innerChildren`, `addInnerChild`, `_clientArea`, `_contentsSprite` — absent
MZ: `_innerChildren` initialised at `MZ rmmz_core.js:3514`, `_contentsSprite` at `:3521`, `addInnerChild` at `:3946` (`this._innerChildren.push(child); return this._clientArea.addChild(child);`), `_clientArea` created at `:4013`.

- Mod use: `GigaHack_Inspect.js:183` and `:189` (`node._contentsSprite`), `GigaHack_Inspect.js:273` (`win._innerChildren` in `partOfWindow`).
- **MV equivalents:** `Window.prototype._createAllParts` (`MV rpg_core.js:6623-6642`) builds a flat structure:
  - `_windowSpriteContainer` (a `PIXI.Container`) holding `_windowBackSprite`, `_windowFrameSprite`
  - direct children of the window: `_windowCursorSprite`, `_windowContentsSprite`, `_downArrowSprite`, `_upArrowSprite`, `_windowPauseSignSprite`
  - `Window.prototype.addChildToBack(child)` at `MV rpg_core.js:6602` (also present in MZ at `rmmz_core.js:3935`) — used by MV's `Window_Base` for `_dimmerSprite` (`rpg_windows.js:641`) and `Window_Message`'s back sprite (`rpg_windows.js:4781`).
  - **There is no MV `_innerChildren` concept at all.** Every child of an MV window is window furniture, so `partOfWindow()` can simply `return true` on MV.
  - `bitmapOf()` must read `node._windowContentsSprite` on MV (`rpg_core.js:6284`) instead of `node._contentsSprite`.
- The Inspect hit-test rationale in the mod's comment (`GigaHack_Inspect.js:248-256` — "`_container > _backSprite > TilingSprite` and `_clientArea > _cursorSprite > 9 sprites` sit a level below `_contentsSprite`") is MZ-specific; MV's structure is one level shallower, so the smallest-area-wins ranking still works but the depth reasoning changes.

### A.11 `Sprite_Gauge`, `Sprite_Name` — classes absent
`MZ rmmz_sprites.js:2099` and `:2468`. MV has neither (`grep '^function Sprite_Gauge('` on `MV rpg_sprites.js` → nothing).

- Mod use: comments only (`GigaHack_Inspect.js:177`, `:264`, `:517`). No code path breaks.
- **MV equivalent:** HP/MP/TP/EXP are drawn straight into the window's `contents` bitmap by `Window_Base.prototype.drawGauge(x, y, width, rate, color1, color2)` (`MV rpg_windows.js:465`) and `drawActorHp(actor, x, y, width)` (`:551`). See §C.6.
- **Net effect on MV:** the Inspect text recorder gets *simpler* — every number in a window lands in that window's own `contents` bitmap, so the bitmap-based lookup at `GigaHack_Inspect.js:182-185` collapses to `node._windowContentsSprite.bitmap`.

### A.12 `Graphics._fpsCounter` — absent
`MZ rmmz_core.js:488`, created at `:911` (`new Graphics.FPSCounter()`), class at `:1064`, `this.fps` field at `:1074`.

- Mod use: `GigaHack_Shell.js:303-305` (already `null`-guarded — the FPS readout degrades to `'—'`).
- **MV equivalent:** `Graphics._fpsMeter` — `MV rpg_core.js:1752`, created at `:2623` as `new FPSMeter({graph:1, decimals:0, theme:'transparent', toggleOn:null})`. **Unverified:** `js/libs/fpsmeter.js` is not in the extracted tree, so I cannot confirm from source that the FPSMeter instance exposes a `.fps` property. Treat `Graphics._fpsMeter.fps` as a guess and keep the existing null-guard.
- Also MZ-only: `Graphics._switchFPSCounter` (`rmmz_core.js:979`) vs MV `Graphics._switchFPSMeter` (`rpg_core.js:2871`). The F2/F3/F4 key handling in `Graphics._onKeyDown` is otherwise identical (MV `rpg_core.js:2831-2848`, MZ `rmmz_core.js:960-977`).

### A.13 `Graphics.app`, `Graphics.effekseer`, `Graphics.setTickHandler`, `Graphics.startGameLoop` — absent
MZ: `Object.defineProperty(Graphics, "app")` at `MZ rmmz_core.js:536`; `"effekseer"` at `:550`; `setTickHandler` at `:562`; `startGameLoop` at `:569`; `_createEffekseerContext` at `:1044`; ticker wiring at `:1033` (`this._app.ticker.add(this._onTick, this)`).

- Mod use: none directly (only the comment at `GigaHack_Hooks.js:81`). Listed because the whole game-loop shape depends on it — see §C.1.
- **MV equivalent:** `Graphics._renderer` (a raw `PIXI.WebGLRenderer`/`CanvasRenderer`, `MV rpg_core.js:2579`), no `PIXI.Application`, no ticker; the loop is `SceneManager.requestUpdate()` → `requestAnimationFrame` (`MV rpg_managers.js:1894-1898`). No Effekseer at all in MV.

### A.14 `$gameMap._tileEvents` — renamed (public → private)
`MZ rmmz_objects.js:6506`: `this._tileEvents = this.events().filter(event => event.isTile());`

- Mod use: `GigaHack_Events.js:479` (`tileEventKey()` — will throw/return `'0'` harmlessly since it null-checks), and `GigaHack_Map.js:188` (`probe._tileEvents = []` on a synthetic `Object.create(Game_Map.prototype)` used for the safe-landing search).
- **MV equivalent:** `Game_Map.prototype.refreshTileEvents = function() { this.tileEvents = this.events().filter(...) }` — `MV rpg_objects.js:5820-5824`. It is the **public** `this.tileEvents`, consumed by `Game_Map.prototype.tileEventsXy` (`:5838`).
- `GigaHack_Map.js:188` is the one that matters: the probe object must set `probe.tileEvents = []` on MV or `isPassable` → `checkPassage` → `tileEventsXy` will dereference `undefined.filter`.

### A.15 `$gameParty.hiddenBattleMembers()` — absent (guarded)
`MZ rmmz_objects.js` (`Game_Party.prototype.hiddenBattleMembers`). Mod use: `GigaHack_Battle.js:377`, already written as `$gameParty.hiddenBattleMembers ? ... : 0`. Returns `0` on MV, which is the safe answer. No MV equivalent; MV's escape/hidden-member accounting differs.

### A.16 `$gameSystem.isMessageSkipEnabled()` — absent (guarded)
`MZ rmmz_objects.js`. Mod use: `GigaHack_Text.js:85-86`, fully guarded, falls back to `false`. No MV equivalent.

### A.17 `$gameMessage.setSpeakerName(name)` / `speakerName()` — absent (guarded)
MZ `MZ rmmz_objects.js:576` and `:508`. Mod use: `GigaHack_Text.js:707` (`if (opts.speaker && $gameMessage.setSpeakerName)`). MV has no name-box concept; `setFaceImage` / `setBackground` / `setPositionType` / `add` all exist in MV with identical signatures (`rpg_objects.js:425`, `:430`, `:434`, `:421`).

### A.18 MZ-only classes/managers the mod does **not** use, listed to close the question
`EffectManager` (`rmmz_managers.js:1027`), `FontManager` (`:787`), `Scene_Message` (`rmmz_scenes.js:627`), `Window_StatusBase` (`rmmz_windows.js:1677`), `Sprite_Clickable` (`rmmz_sprites.js:10`), `Sprite_Battleback` (`:1767`), `PluginManager.registerCommand`/`callCommand` (`rmmz_managers.js:3159`/`:3164`), `Utils.extractFileName`/`encodeURI`/`escapeHtml`/`canUseWebGL`/`canUseIndexedDB` (`rmmz_core.js:380`/`:370`/`:390`/`:294`/`:326`), `Scene_Base.isAutosaveEnabled`/`executeAutosave` (`rmmz_scenes.js:226`/`:235`), `Game_System.isAutosaveEnabled` (`rmmz_objects.js:223`), `SceneManager.updateEffekseer`/`updateFrameCount`/`isGameActive`/`reloadGame`/`showDevTools`/`catchNormalError`/`catchLoadError`/`catchUnknownError`. **None are referenced by the mod** — no porting work needed.

`Rectangle` exists in **both** (MV `rpg_core.js:661` as a `PIXI.Rectangle` subclass; MZ `rmmz_core.js:1158`), but only MZ's has `pad()` and only MZ's window constructors take one (`Window_Base.prototype.initialize` throws `"Argument must be a Rectangle"` at `rmmz_windows.js:41-43`). The mod constructs no engine windows, so this does not bite.

---

## B. Present in MV, missing in MZ

Only a handful, and the mod already knows about one of them.

1. **`Game_Followers.prototype.forEach(callback, thisObject)`** — `MV rpg_objects.js:8102`, plus `reverseEach(callback, thisObject)` at `:8106`. MZ replaced them with `data()` (`MZ rmmz_objects.js:8815`) and `reverseData()` (`:8819`). The mod's comment at `GigaHack_Player.js:202-205` documents having been bitten by exactly this. On MV, `$gamePlayer.followers().forEach(...)` **works** — an MV port could restore the per-follower opacity path if wanted, though the mod's reasoning (followers re-inherit from the player every frame) holds on both engines.

2. **`Window_Base.prototype.drawGauge(x, y, width, rate, color1, color2)`** — `MV rpg_windows.js:465`. Removed entirely in MZ (`grep 'drawGauge' MZ rmmz_*.js` matches only `Sprite_Gauge.prototype.drawGauge`, `rmmz_sprites.js:2387`). Not used by the mod — GigaHack draws its own HP bars with `PIXI.Graphics` (`GigaHack_Battle.js:532-544`) — but it is the MV-native way to render a gauge into a window's contents if the port ever wants one.

3. **`StorageManager.backup` / `backupExists` / `cleanBackup` / `restoreBackup`** — `MV rpg_managers.js:603`, `:624`, `:632`, `:646`. MZ has no engine-level save backup. On MV, `DataManager.saveGame` (`rpg_managers.js:337`) calls `StorageManager.backup(savefileId)` before every write and `restoreBackup` on failure. This is directly relevant to the mod's backup module — see §D.4.

4. **`ImageManager` reservation system** — `reserveSystem/reserveBitmap/reserveNormalBitmap/releaseReservation/setDefaultReservationId` (`MV rpg_managers.js:960`, `:976`, `:987`, `:994`, `:998`), backed by `CacheMap.prototype.update` (`MV rpg_core.js:455`) and `Scene_Base.prototype.attachReservation/detachReservation`. MZ deleted all of it. **Hazard:** an MV bitmap the mod holds a reference to (e.g. the `IconSet` bitmap at `GigaHack_UI.js:780`) can be purged out from under it if nothing holds a reservation. On MV the icon-sheet extraction should either be done once at boot or take a reservation.

5. **`ResourceHandler`** — MV-only; referenced from `Input._onKeyDown` (see §C.4). MZ replaced it with the `["LoadError", url, retry]` throw + `SceneManager.catchLoadError` path (`MZ rmmz_managers.js:2083`).

6. **`Graphics._upperCanvas`** (`id="UpperCanvas"`, z-index 3, `MV rpg_core.js:2526-2543`), `Graphics._modeBox` (z-index 9, `:2632`), `Graphics.isWebGL()` (`:1898`), `Graphics.setLoadingImage` (`:1946`) — all MV-only. See §E.

---

## C. Same name, different behaviour — the dangerous list

### C.1 `SceneManager.updateMain` — **CRITICAL. Both mod hooks are fatal on MV.**

The mod hooks this **twice**: `GigaHack_Hooks.js:69-90` (pause) and `GigaHack_Player.js:280-311` (game speed).

**MZ** — `MZ rmmz_managers.js:2102-2108`:
```
2102  SceneManager.updateMain = function() {
2103      this.updateFrameCount();
2104      this.updateInputData();
2105      this.updateEffekseer();
2106      this.changeScene();
2107      this.updateScene();
2108  };
```
Rendering is **not** here. It lives in `Graphics._onTick` (`rmmz_core.js:808-817`), which calls `this._tickHandler(deltaTime)` → `SceneManager.update(deltaTime)` (`rmmz_managers.js:1982`) → `updateMain()` × `determineRepeatNumber(deltaTime)` (`:1993`), and then `this._app.render()` independently. The loop is PIXI's ticker (`rmmz_core.js:1033`).

**MV** — `MV rpg_managers.js:1975-1994`:
```
1975  SceneManager.updateMain = function() {
1976      if (Utils.isMobileSafari()) {
1977          this.changeScene();
1978          this.updateScene();
1979      } else {
1980          var newTime = this._getTimeInMsWithoutMobileSafari();
1981          var fTime = (newTime - this._currentTime) / 1000;
1982          if (fTime > 0.25) fTime = 0.25;
1983          this._currentTime = newTime;
1984          this._accumulator += fTime;
1985          while (this._accumulator >= this._deltaTime) {
1986              this.updateInputData();
1987              this.changeScene();
1988              this.updateScene();
1989              this._accumulator -= this._deltaTime;
1990          }
1991      }
1992      this.renderScene();
1993      this.requestUpdate();
1994  };
```

Two structural differences with catastrophic consequences:

- **`renderScene()` is inside `updateMain` on MV** (`:1992`; `SceneManager.renderScene` at `:2034` → `Graphics.render(this._scene)` at `rpg_core.js:1871`). The pause hook's stated contract — `GigaHack_Hooks.js:65-66`: *"Pausing skips the whole main update (input, effekseer, scene) but leaves rendering alone, so the last frame stays on screen"* — is **false on MV**. Nothing renders while paused.
- **`requestUpdate()` is inside `updateMain` on MV** (`:1993`; `SceneManager.requestUpdate` at `:1894` → `requestAnimationFrame(this.update.bind(this))`). MV's loop is self-perpetuating from inside `updateMain`.
  - **Pause hook (`GigaHack_Hooks.js:78-84`) returns before the original** → `requestUpdate()` never runs → **the rAF chain terminates permanently**. The game hard-hangs and un-pausing does nothing, because nothing calls `updateMain` any more. Unrecoverable without a reload.
  - **Speed hook (`GigaHack_Player.js:308`) calls the original `runs` times in a loop** → `runs` calls to `requestUpdate()` → `runs` rAF callbacks scheduled for the next frame, each of which schedules `runs` more. **Exponential runaway**, plus `runs` full renders per frame. At the mod's `MAX_SPEED = 8` (`GigaHack_Player.js:284`) this is a hang within a second or two.
  - The sub-1× branch (`GigaHack_Player.js:295-307`) `return`s without calling the original at all → same permanent-freeze as the pause hook.
  - `P.step()` (`GigaHack_Player.js:331`) drives frames through the same hook and inherits the same failure.

**Port shape for MV:** the hook must be split. Pause and speed belong on `SceneManager.updateScene` (`MV rpg_managers.js:2021`) + `SceneManager.changeScene` (`:2000`) + `SceneManager.updateInputData` (`:1970`), leaving `renderScene`/`requestUpdate` untouched; or wrap `updateMain` but always run `this.renderScene(); this.requestUpdate();` on every path including the paused one. Note the mod's own note at `GigaHack_Hooks.js:76-78` — that `Scene_Boot.isReady` is polled from `changeScene` inside `updateMain` — applies to MV too.

Also different: MZ increments the play clock in `SceneManager.updateFrameCount` (`rmmz_managers.js:2110`, `Graphics.frameCount++`); **MV increments it inside `Graphics.render`** (`MV rpg_core.js:1888`). So on MV, "pause" also stops the playtime clock as a side effect of stopping rendering — arguably desirable, but it is a different mechanism from the one the mod's comments assume.

### C.2 `SceneManager.initialize` / `run` — different order, different membership

**MV** — `MV rpg_managers.js:1810-1818`:
```
1810  SceneManager.initialize = function() {
1811      this.initGraphics();
1812      this.checkFileAccess();
1813      this.initAudio();
1814      this.initInput();
1815      this.initNwjs();
1816      this.checkPluginErrors();
1817      this.setupErrorHandlers();
1818  };
```
**MZ** — `MZ rmmz_managers.js:1926-1934`:
```
1926  SceneManager.initialize = function() {
1927      this.checkBrowser();
1928      this.checkPluginErrors();
1929      this.initGraphics();
1930      this.initAudio();
1931      this.initVideo();
1932      this.initInput();
1933      this.setupEventHandlers();
1934  };
```
Relevant to the mod's `GigaHack_Hooks.js:539-548` reasoning about `PluginManager._errorUrls` being inspected exactly once: on **MZ** `checkPluginErrors()` runs *before* `initGraphics()`; on **MV** it runs *after*, and after `checkFileAccess()`. The mod's claim ("only ever inspected once, in `SceneManager.initialize()`, long before any mod plugin is requested") holds on both, but the position in the sequence differs. `SceneManager.checkPluginErrors` is MV `:1885`, MZ `:1951` (MZ delegates to `PluginManager.checkErrors()`).

`run` also differs: MV ends with `this.requestUpdate()` (`:1804`), MZ with `Graphics.startGameLoop()` (`:1921`).

MV-only: `initNwjs`, `checkFileAccess`, `setupErrorHandlers`, `preferableRendererType`, `shouldUseCanvasRenderer`, `checkWebGL`, `tickStart`, `tickEnd`, `updateManagers`, `renderScene`, `requestUpdate`, `onSceneLoading`, `isCurrentSceneStarted`, `_sceneStarted`, `_stopped`, `_screenWidth/_screenHeight/_boxWidth/_boxHeight` (816/624, `rpg_managers.js:1792-1795`), `_deltaTime`, `_accumulator`.
MZ-only: `checkBrowser`, `initVideo`, `setupEventHandlers`, `determineRepeatNumber`, `updateFrameCount`, `updateEffekseer`, `isGameActive`, `onSceneTerminate`, `onBeforeSceneStart`, `onReject`, `onUnload`, `reloadGame`, `showDevTools`, `_previousScene`, `_smoothDeltaTime`, `_elapsedTime`.

Identical: `_scene`, `_nextScene`, `_stack`, `_exiting`, `_previousClass`, `_backgroundBitmap`, `goto` (MV `:2074` / MZ `:2208` — byte-identical), `push` (MV `:2083` / MZ `:2217` — byte-identical), `isSceneChanging` (MV `:2054` / MZ `:2192` — `return this._exiting || !!this._nextScene;` in both), `updateInputData` (MV `:1970` / MZ `:2114` — `Input.update(); TouchInput.update();` in both). All the mod's uses of these (`GigaHack_Save.js:198`, `:233`, `GigaHack_Battle.js:498`, `GigaHack_Events.js:784`, `GigaHack_Player.js:304`, `GigaHack_Text.js:212`) are safe.

`SceneManager.updateScene` itself differs (MV `:2021` uses `_sceneStarted` + `isCurrentSceneStarted()`; MZ `:2143` uses `this._scene.isStarted()` and gates on `isGameActive()` i.e. `document.hasFocus()`). The mod does not hook it, but an MV port that moves the pause hook there needs to know MV has no focus gate.

### C.3 `SceneManager.catchException`

**MV** `MV rpg_managers.js:1951-1960`: two branches (`Error` → `Graphics.printError(e.name, e.message)`; else → `printError('UnknownError', e)`), then `AudioManager.stopAll(); this.stop();`.
**MZ** `MZ rmmz_managers.js:2066-2075`: three branches dispatching to `catchNormalError` (`:2077`, passes `e` as a third arg to `printError`), `catchLoadError` (`:2083`, handles the `["LoadError", url, retry]` array shape and offers a retry button), `catchUnknownError` (`:2097`); `stop()` at the end.
Also: `Graphics.printError(name, message)` in MV (`rpg_core.js:2029`) vs `printError(name, message, error)` in MZ. The mod does not hook or call either; listed because the prompt asked and because a port that wants to surface engine errors in the overlay must handle both shapes.

### C.4 `Input._onKeyDown` and `Input._shouldPreventDefault`

**MV** `MV rpg_core.js:3236-3248`:
```
3236  Input._onKeyDown = function(event) {
3237      if (this._shouldPreventDefault(event.keyCode)) { event.preventDefault(); }
3238      if (event.keyCode === 144) { this.clear(); }        // Numlock
3239      var buttonName = this.keyMapper[event.keyCode];
3240      if (ResourceHandler.exists() && buttonName === 'ok') {
3241          ResourceHandler.retry();
3242      } else if (buttonName) {
3243          this._currentState[buttonName] = true;
3244      }
3245  };
```
**MZ** `MZ rmmz_core.js:5886-5898`: same, **minus** the `ResourceHandler` branch — plain `if (buttonName) { this._currentState[buttonName] = true; }`.

`_shouldPreventDefault`: **MV** (`rpg_core.js:3255-3268`) prevents 8, 33, 34, 37, 38, 39, 40. **MZ** (`rmmz_core.js:5901-5913`) prevents the same **plus keyCode 9 (Tab)**. Relevant to the overlay: on MV, Tab is not `preventDefault`ed by the engine, so browser focus traversal will fire inside the mod's DOM widgets unless the mod stops it itself.

`Input.keyMapper` is **byte-identical** between the two (MV `rpg_core.js:3002-3027`, MZ `rmmz_core.js:5683-5708`): 24 entries, `{9:tab, 13:ok, 16:shift, 17:control, 18:control, 27:escape, 32:ok, 33:pageup, 34:pagedown, 37:left, 38:up, 39:right, 40:down, 45:escape, 81:pageup, 87:pagedown, 88:escape, 90:ok, 96:escape, 98:down, 100:left, 102:right, 104:up, 120:debug}`. The mod's keyMapper diagnostics (`GigaHack_Tabs.js:959-966`) and its "we bind on `KeyboardEvent.code`, independent of keyMapper" design (`GigaHack_Store.js:311-312`) port unchanged.

`Input.clear` (MV `:3055` / MZ `:5731`) and `Input.update` (MV `:3073` / MZ `:5747`) differ only by MZ's `_virtualButton` (added to `clear`, and a block at the end of `update`). `Input._previousState`, which `GigaHack_Player.js:299-301` relies on, is snapshotted identically inside `update()` on both. `Input._setupEventHandlers` binds `keydown`/`keyup` on `document` (bubble) and `blur` on `window` in **both** (MV `:3224`, MZ `:5880`) — so the mod's capture-phase window listener and host-level bubble `stopPropagation` (`GigaHack_Shell.js:616-649`) work identically.

### C.5 `TouchInput` — internal state rewritten, public surface compatible

**MV** `MV rpg_core.js:3487-3507` (`clear`): flat `_triggered/_cancelled/_moved/_released/_wheelX/_wheelY` plus a parallel `_events` object; `update` (`:3515`) copies `_events` → the flat fields.
**MZ** `MZ rmmz_core.js:6057-6070` (`clear`): `_newState`/`_currentState` objects from `_createNewState()`, plus `_clicked`, `_triggerX`, `_triggerY`; `update` (`:6075`) swaps them and computes `_clicked = released && !_moved`.

Public accessors the mod uses are the same shape: `TouchInput.x` (MV `:3649` / MZ `:6207`, both `return this._x`), `TouchInput.y` (MV `:3663` / MZ `:6221`), `TouchInput.isTriggered()`, `TouchInput.clear()`. `wheelX`/`wheelY` differ internally (MV `this._wheelX`, MZ `this._currentState.wheelX`) but read the same. Mod uses at `GigaHack_Events.js:768-770` and `GigaHack_Shell.js:439` are safe.

Event binding: both bind on `document`. MV additionally binds `pointerdown` (`rpg_core.js:3699`) which MZ dropped; MZ additionally binds `blur` on `window` (`rmmz_core.js:6264`) which MV lacks. MV's `wheel`/`touchstart`/`touchmove` use `isSupportPassive ? {passive:false} : false`; MZ always passes `{passive:false}`.

**Caveat for MV:** `TouchInput._onLeftButtonDown` filters through `Graphics.isInsideCanvas(x, y)` on both (MV `rpg_core.js:2221`, MZ `rmmz_core.js:6280`), so an overlay click that reaches `document` is only swallowed by the game if it lands inside the canvas rect — identical on both.

### C.6 `Window_Base.prototype.drawGauge` — MV-only (see §B.2)

**MV** `MV rpg_windows.js:465-470`:
```
465  Window_Base.prototype.drawGauge = function(x, y, width, rate, color1, color2) {
466      var fillW = Math.floor(width * rate);
467      var gaugeY = y + this.lineHeight() - 8;
468      this.contents.fillRect(x, gaugeY, width, 6, this.gaugeBackColor());
469      this.contents.gradientFillRect(x, gaugeY, fillW, 6, color1, color2);
470  };
```
**MZ**: no such method on any window. The nearest is `Sprite_Gauge.prototype.drawGaugeRect = function(x, y, width, height)` (`MZ rmmz_sprites.js:2395`), on a sprite added via `addInnerChild`. Not used by the mod either way.

### C.7 `Window_Base` metrics and padding — a different model entirely

| | MV (`MV rpg_windows.js`) | MZ (`MZ rmmz_windows.js`) |
|---|---|---|
| `lineHeight()` | `:35` → `36` | `:46` → `36` (same) |
| padding | `standardPadding()` `:53` → `18`; `updatePadding()` `:68` → `this.padding = this.standardPadding()` | no `standardPadding`; `updatePadding()` `:72` → `this.padding = $gameSystem.windowPadding()` |
| item padding | `textPadding()` `:57` → `6` | `itemPadding()` `:58` → `8` |
| back opacity | `standardBackOpacity()` `:61` → `192` | `$gameSystem.windowOpacity()` via `updateBackOpacity()` `:76` |
| `contentsWidth()` | `:77` → `this.width - this.standardPadding()*2` | `:107` → `this.innerWidth` |
| `contentsHeight()` | `:81` → `this.height - this.standardPadding()*2` | `:111` → `this.innerHeight` |
| `fittingHeight(n)` | `:85` → `n*lineHeight() + standardPadding()*2` | `:80` → `n*itemHeight() + $gameSystem.windowPadding()*2` |
| `createContents()` | `:93` — one `contents` bitmap | `:88` — `destroyContents()` first, then **two** bitmaps: `contents` **and** `contentsBack` |
| `resetFontSettings()` | `:99` — `standardFontFace()/standardFontSize()`, `resetTextColor()` | `:115` — `$gameSystem.mainFontFace()/mainFontSize()`, `resetTextColor()` **+ `changeOutlineColor(ColorManager.outlineColor())`** |

MZ-only on `Window_Base`: `itemWidth`, `itemHeight`, `itemPadding`, `baseTextRect`, `destroyContents`, `contentsBack`, `innerWidth`/`innerHeight`. MV-only: `standardFontFace`, `standardFontSize`, `standardPadding`, `textPadding`, `standardBackOpacity`, `itemRectForText`.

The mod does not construct or subclass engine windows, so this only matters for the Inspect module's geometry assumptions (`GigaHack_Inspect.js:329-333` — "a `Window_Selectable`'s contents bitmap is one row TALLER than its client area") and for §A.2.

### C.8 `Window._updateContents` — bitmap→screen mapping differs, breaks Inspect run mapping

**MZ** `MZ rmmz_core.js:4226-4231`:
```
4226  Window.prototype._updateContents = function() {
4227      const bitmap = this._contentsSprite.bitmap;
4228      if (bitmap) {
4229          this._contentsSprite.setFrame(0, 0, bitmap.width, bitmap.height);
4230      }
4231  };
```
Scroll is applied on the parent: `Window.prototype._updateClientArea` (`:4183-4193`) does `this._clientArea.x = pad - this.origin.x; this._clientArea.y = pad - this.origin.y;`. So a bitmap coordinate maps to screen **directly** through `_contentsSprite.worldTransform` — which is exactly what `GigaHack_Inspect.js:302-314` (`runToScreen`) assumes.

**MV** `MV rpg_core.js:6828-6837`:
```
6828  Window.prototype._updateContents = function() {
6829      var w = this._width - this._padding * 2;
6830      var h = this._height - this._padding * 2;
6831      if (w > 0 && h > 0) {
6832          this._windowContentsSprite.setFrame(this.origin.x, this.origin.y, w, h);
6833          this._windowContentsSprite.visible = this.isOpen();
```
with `Window.prototype._refreshContents` (`:6763-6765`) doing `this._windowContentsSprite.move(this.padding, this.padding)`. Scroll is baked into the **sprite's frame origin**, not its transform. A bitmap point `(bx, by)` therefore lands at sprite-local `(bx - origin.x, by - origin.y)`.

**Consequence:** `runToScreen` is correct on MV only while `origin` is `(0,0)`. Any scrolled `Window_Selectable` (item lists, save lists, long menus — the exact windows the Inspect tool is most useful on) will report text-run rectangles offset by the scroll amount. Fix: subtract `win.origin` before applying the transform on MV.

### C.9 `Game_BattlerBase.prototype.param` — MZ inserts a floor at zero

**MV** `MV rpg_objects.js:2450-2456`:
```
2450  Game_BattlerBase.prototype.param = function(paramId) {
2451      var value = this.paramBase(paramId) + this.paramPlus(paramId);
2452      value *= this.paramRate(paramId) * this.paramBuffRate(paramId);
2453      var maxValue = this.paramMax(paramId);
2454      var minValue = this.paramMin(paramId);
2455      return Math.round(value.clamp(minValue, maxValue));
2456  };
```
**MZ** `MZ rmmz_objects.js:2883-2891`:
```
2883  Game_BattlerBase.prototype.param = function(paramId) {
2884      const value =
2885          this.paramBasePlus(paramId) *
2886          this.paramRate(paramId) *
2887          this.paramBuffRate(paramId);
2888      const maxValue = this.paramMax(paramId);
2889      const minValue = this.paramMin(paramId);
2890      return Math.round(value.clamp(minValue, maxValue));
2891  };
```
with `Game_BattlerBase.prototype.paramBasePlus = function(paramId) { return Math.max(0, this.paramBase(paramId) + this.paramPlus(paramId)); }` — `MZ rmmz_objects.js:2859-2861`. **`paramBasePlus` does not exist in MV** (`grep -c paramBasePlus MV rpg_objects.js` → 0).

Also different: `paramMax`/`paramMin`.
- **MV** `rpg_objects.js:2432-2440`: `paramMax` returns `999999` (MHP), `9999` (MMP), `999` (others); `paramMin` (`:2424`) returns `0` for MMP, **`1`** for everything else.
- **MZ** `rmmz_objects.js:2871-2873`: `paramMax` returns `Infinity` for everything; `paramMin` (`:2863`) returns `1` for MHP, **`0`** for everything else.

**Impact on the mod:** `GigaHack_Battle.js:1195-1232` (`setEnemyParam`) computes `enemy._paramPlus[paramId] = want - enemy.paramBase(paramId)` and then reads back `enemy.param(paramId)`. On MV, that read-back is clamped to **999** for atk/def/mat/mdf/agi/luk instead of `Infinity`, so any request above 999 silently caps, and the undo record at `GigaHack_Battle.js:1213` will print a value the user didn't ask for. The party equivalent, `GigaHack_Party.js:13` — which documents the formula as `final = round(clamp((paramBase + paramPlus) * paramRate * paramBuffRate))` — is the **MV** formula, not MZ's; on MZ the `max(0, …)` floor applies first.

`Game_Actor.prototype.paramBase(paramId)` itself is **identical** in both — `return this.currentClass().params[paramId][this._level];` (MV `rpg_objects.js:3843-3845`, MZ `rmmz_objects.js:4480-4482`), both **without a bounds guard**, which is exactly what `GigaHack_Forge.js:204` and `:243` warn about. That reasoning ports verbatim. `Game_Actor.prototype.paramPlus` is semantically identical (MV `:3847`, MZ `:4484` — same equipment sum, different loop syntax). `paramRate`, `paramBuffRate`, `addParam`, `refresh` are all byte-identical.

### C.10 `DataManager.saveGame` / `loadGame` — **sync boolean (MV) vs Promise (MZ)**

**MV** `MV rpg_managers.js:337-358`:
```
337  DataManager.saveGame = function(savefileId) {
338      try {
339          StorageManager.backup(savefileId);
340          return this.saveGameWithoutRescue(savefileId);
341      } catch (e) {
342          console.error(e);
343          try {
344              StorageManager.remove(savefileId);
345              StorageManager.restoreBackup(savefileId);
346          } catch (e2) { }
347          return false;
348      }
349  };
352  DataManager.loadGame = function(savefileId) {
353      try {
354          return this.loadGameWithoutRescue(savefileId);
355      } catch (e) {
356          console.error(e);
357          return false;
358      }
359  };
```
**MZ** `MZ rmmz_managers.js:345-363`:
```
345  DataManager.saveGame = function(savefileId) {
346      const contents = this.makeSaveContents();
347      const saveName = this.makeSavename(savefileId);
348      return StorageManager.saveObject(saveName, contents).then(() => {
349          this._globalInfo[savefileId] = this.makeSavefileInfo();
350          this.saveGlobalInfo();
351          return 0;
352      });
353  };
355  DataManager.loadGame = function(savefileId) {
356      const saveName = this.makeSavename(savefileId);
357      return StorageManager.loadObject(saveName).then(contents => {
358          this.createGameObjects();
359          this.extractSaveContents(contents);
360          this.correctDataErrors();
361          return 0;
362      });
363  };
```

MV's `saveGameWithoutRescue(savefileId)` (`:370`) and `loadGameWithoutRescue(savefileId)` (`:383`) are MV-only; MZ has no `*WithoutRescue` pair (its try/catch equivalent is the Promise `.catch` chain in the calling scene). MV's `loadGameWithoutRescue` also gates on `this.isThisGameFile(savefileId)` (`:385`) — a check MZ dropped entirely — and returns `false` (not an exception) when the slot is not this game's.

**Impact — two separate bugs in the mod on MV:**

1. `S.loadFrom` (`GigaHack_Save.js:218-224`): `promise` is `true`/`false`, `typeof promise.then !== 'function'` → the mod logs `'quick load failed — loadGame threw'` and returns. But `loadGame` **already succeeded and already replaced every global** (via `createGameObjects()` + `extractSaveContents()`). The follow-up block at `:229-241` — `playLoad`, `fadeOutAll`, `reloadMapIfUpdated`, `SceneManager.goto(Scene_Map)`, `onAfterLoad()` — never runs. The result is precisely the failure mode the mod documents at `GigaHack_Save.js:88-94`: fresh globals under a stale live scene, and `Spriteset_Map` reading `$dataTilesets[$gameMap.tileset()]` on the next frame. The `restoreGlobals(before)` safety net at `:255` is in the `.catch`, which never runs either.

2. `S.saveTo` (`GigaHack_Save.js:139-148`): the `!promise` branch. When MV's `saveGame` returns `false` (a genuine write failure), `promise === false`, so `promise === null` is **false**, so the mod logs `'ok'` and calls `done(id, true)` — a "SAVED" toast and a save sound for a save that did not happen. (Moot today because §A.3 makes the call throw first, but it must be fixed alongside.)

**Port shape:** normalise at the boundary. `var r = DataManager.saveGame(id); return (r && typeof r.then === 'function') ? r : (r ? Promise.resolve(0) : Promise.reject(new Error('saveGame returned false')));` and the same for `loadGame`. Then all the existing `.then`/`.catch` logic works on both engines unchanged.

### C.11 `DataManager.makeSaveContents` / `extractSaveContents` — identical

`makeSaveContents` (MV `rpg_managers.js:430-444`, MZ `rmmz_managers.js:389-403`) writes the same ten keys — `system, screen, timer, switches, variables, selfSwitches, actors, party, map, player` — in the same order, with the same "no `$gameTemp`, `$gameMessage`, `$gameTroop`" comment. `extractSaveContents` (MV `:446-457`, MZ `:405-416`) reads the same ten. The mod's hook (`GigaHack_Forge.js:951`) and its "seven plugins extend `makeSaveContents`, so treat saves as opaque bytes" rationale (`GigaHack_Backup.js:5-10`) port verbatim.

`makeSavefileInfo` differs by exactly one field: MV adds `info.globalId = this._globalId` (`rpg_managers.js:421`), used by `isThisGameFile` (`:266-279`) in web-storage mode. MZ has no `_globalId`. Everything else (`title`, `characters`, `faces`, `playtime`, `timestamp`) matches. `S.slots()` (`GigaHack_Save.js:60-72`) reads only fields present in both.

### C.12 `StorageManager.*` — completely rewritten

**MV** (`MV rpg_managers.js:571-777`, 24 members) — **synchronous**, id-keyed:
`save(savefileId, json)` `:571` · `load(savefileId) → string` `:579` · `exists(savefileId)` `:587` · `remove(savefileId)` `:595` · `backup(savefileId)` `:603` · `backupExists` `:624` · `cleanBackup` `:632` · `restoreBackup` `:646` · `isLocalMode()` `:669` · `saveToLocalFile(savefileId, json)` `:673` · `loadFromLocalFile(savefileId)` `:684` · `loadFromLocalBackupFile` `:694` · `localFileBackupExists` `:704` · `localFileExists` `:709` · `removeLocalFile` `:714` · `saveToWebStorage(savefileId, json)` `:722` · `loadFromWebStorage` `:728` · `loadFromWebStorageBackup` `:734` · `webStorageBackupExists` `:740` · `webStorageExists` `:745` · `removeWebStorage` `:750` · `localFileDirectoryPath()` `:755` · `localFilePath(savefileId)` `:762` · `webStorageKey(savefileId)` `:774`.

**MZ** (`MZ rmmz_managers.js:542-782`, 32 members) — **Promise-based**, name-keyed:
`_forageKeys`/`_forageKeysUpdated` `:542-543` · `isLocalMode()` `:545` · `saveObject(saveName, object) → Promise` `:549` · `loadObject(saveName) → Promise` `:555` · `objectToJson` `:561` · `jsonToObject` `:572` · `jsonToZip` `:583` · `zipToJson` `:597` · `saveZip` `:612` · `loadZip` `:620` · `exists(saveName)` `:628` · `remove(saveName)` `:636` · `saveToLocalFile(saveName, zip)` `:644` · `loadFromLocalFile` `:668` · `localFileExists` `:680` · `removeLocalFile` `:685` · `saveToForage`/`loadFromForage`/`forageExists`/`removeForage`/`updateForageKeys`/`forageKeysUpdated` `:689-723` · `fsMkdir`/`fsRename`/`fsUnlink`/`fsReadFile`/`fsWriteFile` `:727-760` · `fileDirectoryPath()` `:762` · `filePath(saveName)` `:768` · `forageKey(saveName)` `:773` · `forageTestKey()` `:778`.

Only `isLocalMode()` (`return Utils.isNwjs();` in both), `exists`, `remove`, `saveToLocalFile`, `loadFromLocalFile`, `localFileExists`, `removeLocalFile` share names — and every one of them changed its parameter from a **numeric savefileId** to a **string saveName**, and (for the local-file pair) from sync to Promise. Treat the whole class as new API.

Compression: MV **LZString base64** (`StorageManager.saveToLocalFile`, `rpg_managers.js:673-683`: `LZString.compressToBase64(json)`); MZ **pako deflate, level 1, `{to:"string"}`** (`StorageManager.jsonToZip`, `rmmz_managers.js:583-596`), with a `console.warn("Save data is too big.")` above 50000 bytes vs MV's `console.warn('Save data too big!')` above 200000 characters of **uncompressed** JSON (`rpg_managers.js:371-373`).
Non-NW.js fallback: MV **`localStorage`** (`saveToWebStorage`, `:722`), MZ **localForage/IndexedDB** (`saveToForage`, `:689`).

### C.13 `ConfigManager.load` / `save` — sync vs Promise

MV `:511-527`: `StorageManager.load(-1)` → `JSON.parse` → `applyData` (synchronous, returns nothing); `save` → `StorageManager.save(-1, JSON.stringify(this.makeData()))`.
MZ `:476-489`: `StorageManager.loadObject("config").then(...)`, sets `this._isLoaded = true` in the chain; `save` → `StorageManager.saveObject("config", this.makeData())`.

Mod uses `ConfigManager.save()` (4 call sites via `GigaHack_Text.js` `writeConfig`) and reads `ConfigManager.alwaysDash` / `instantText` / `skipUnseen`. `alwaysDash` exists in both (MV `:468`, MZ `:431`); `instantText` and `skipUnseen` exist in **neither** — they are third-party plugin fields, which the mod already probes for (`GigaHack_Text.js:75-81`). `ConfigManager.save()` is fire-and-forget on both, so the mod's usage is safe; it just isn't awaitable on MZ and *is* effectively synchronous on MV.

### C.14 `Graphics` — `_canvas` in both, `_app` MZ-only; `boxWidth` getter vs plain field

- `Graphics._canvas` exists in **both** (MV `rpg_core.js:1746`, created at `:2474`; MZ `rmmz_core.js:487`, created at `:882`). The mod's `GigaHack_Inspect.js:551` works on both — but see §E.1 for the id-case fallback bug.
- `Graphics._realScale` exists in both (MV `:1742`, MZ `:484`). `GigaHack_Inspect.js:556-558` deliberately measures the element instead — correct on both.
- `Graphics.width`/`height`: MV `Object.defineProperty` getter/setter over `_width`/`_height` (`rpg_core.js:2242`, `:2262`); MZ likewise (`rmmz_core.js:743`, `:762`). Same behaviour.
- `Graphics.boxWidth`/`boxHeight`: **MV** getter/setter over `_boxWidth`/`_boxHeight` (`rpg_core.js:2282`, `:2299`); **MZ** plain instance fields assigned in `Graphics.initialize()` (`rmmz_core.js:509`, `:517`) and reassigned in `Scene_Boot.prototype.adjustBoxSize` (`rmmz_scenes.js:357-362`). Readable/writable on both; only MV's setter is a no-op pass-through, only MZ's is a raw field.
- Screen size origin: **MV** hard-codes `SceneManager._screenWidth = 816 / _screenHeight = 624 / _boxWidth = 816 / _boxHeight = 624` (`rpg_managers.js:1792-1795`) and passes them to `Graphics.initialize(width, height, type)` (`rpg_core.js:1734`). **MZ** calls `Graphics.initialize()` with **no arguments** (`rmmz_core.js:480`, sets `_width = _height = 0`) and resizes later from `$dataSystem.advanced` in `Scene_Boot.prototype.resizeScreen` (`rmmz_scenes.js:348-355`). Relevant because the mod hooks `Scene_Boot.prototype.start` (`GigaHack_Forge.js:941`) — on MZ, `resizeScreen()` runs *inside* the original at `rmmz_scenes.js:337`; MV's `Scene_Boot.start` (`rpg_scenes.js:391-407`) has no such call. The mod's hook runs after the original in both, so it is unaffected, but a port must not assume `Graphics.width` is settled before `start`.
- `Graphics.frameCount`: MV declares it at module scope (`rpg_core.js:1798`, available the moment `rpg_core.js` parses); MZ assigns it inside `initialize()` (`rmmz_core.js:501`). Both are writable — `GigaHack_Save.js:516` works on both.

### C.15 `Bitmap.prototype.drawText` / `clearRect` — same arity, different baseline and different dirty mechanism

**`drawText(text, x, y, maxWidth, lineHeight, align)` — same 6 params in both.**
- **MV** `MV rpg_core.js:1331-1357`: wrapped in `if (text !== undefined)`; baseline `var ty = y + lineHeight - (lineHeight - this.fontSize * 0.7) / 2;` (line 1336); ends with `this._setDirty();`.
- **MZ** `MZ rmmz_core.js:1661-1685`: no `undefined` guard; baseline `let ty = Math.round(y + lineHeight / 2 + this.fontSize * 0.35);` (line 1668); ends with `this._baseTexture.update();`.

The mod's recorder comment at `GigaHack_Inspect.js:91-92` — *"The baseline is `y + lineHeight/2 + fontSize*0.35`"* — is the MZ formula. MV places glyphs lower relative to the nominal row; the recorded rect (which starts at `y` and is `max(lineHeight, fontSize*1.2)` tall, `GigaHack_Inspect.js:90-93`) still contains the glyphs on MV, so the hit-test degrades gracefully. Worth updating the comment and, ideally, the height heuristic.

**`clearRect(x, y, width, height)`** — MV `rpg_core.js:1227-1230` (`this._context.clearRect(...)` + `_setDirty()`), MZ `rmmz_core.js:1547-1550` (`this.context.clearRect(...)` + `this._baseTexture.update()`). Identical arity and semantics; `Bitmap.prototype.clear()` is `clearRect(0,0,w,h)` in both (MV `:1237`, MZ `:1555`), so the mod's "one alias catches both" claim (`GigaHack_Inspect.js:107-108`) holds.

**Bitmap defaults differ** (relevant to `GigaHack_Battle.js:558-562` and `GigaHack_Events.js:437-442`, which set them explicitly anyway):

| | MV (`rpg_core.js`) | MZ (`rmmz_core.js`) |
|---|---|---|
| `fontFace` | `'GameFont'` `:855` | `"sans-serif"` `:1203` |
| `fontSize` | `28` `:863` | `16` `:1210` |
| `textColor` | `'#ffffff'` `:879` | `"#ffffff"` `:1231` |
| `outlineColor` | `'rgba(0, 0, 0, 0.5)'` `:887` | same `:1238` |
| `outlineWidth` | `4` `:895` | `3` `:1245` |

`Bitmap.prototype.canvas` and `.context` accessors exist in both (MV `:1011`/`:1024`, MZ `:1354`/`:1348`), and `isReady()` is byte-identical (MV `:955`, MZ `:1292`). `GigaHack_UI.js:781-782` (`bmp.isReady()` then `bmp.canvas.toDataURL(...)`) works on both — subject to the MV cache-purge hazard in §B.4.

### C.16 `Spriteset_Base` layer construction — the mod's overlay lands in a different z-position

**MV** `MV rpg_sprites.js:2123-2142`:
```
2128      this.createLowerLayer();
2129      this.createToneChanger();
2130      this.createUpperLayer();
...
2138  Spriteset_Base.prototype.createUpperLayer = function() {
2139      this.createPictures();
2140      this.createTimer();
2141      this.createScreenSprites();     // adds _flashSprite, _fadeSprite as CHILDREN (:2200-2205)
2142  };
```
**MZ** `MZ rmmz_sprites.js:3128-3155`:
```
3132      this.createLowerLayer();
3133      this.createUpperLayer();
...
3151  Spriteset_Base.prototype.createUpperLayer = function() {
3152      this.createPictures();
3153      this.createTimer();
3154      this.createOverallFilters();    // sets this.filters, adds NO children (:3198-3202)
3155  };
```

The mod appends its layer **after** the original in `GigaHack_Events.js:686-697`. Consequences:
- **MV:** the overlay becomes the last child, i.e. **above `_flashSprite` and `_fadeSprite`**. Screen flashes and fade-to-black will not cover the debug overlay. Fix: `addChildAt(layer, this.children.indexOf(this._flashSprite))`.
- **MZ:** `createOverallFilters` sets `this.filters = [new ColorFilter()]` on the spriteset itself, so the mod's layer **is** subject to the overall brightness/flash filter (`updateOverallFilters`, `rmmz_sprites.js:3209-3213`). On MV the tone filter is applied to `_baseSprite`, not the spriteset (`createWebGLToneChanger`, `rpg_sprites.js:2168-2175`), so the overlay is **not** tinted on MV.
- **MV WebGL clipping:** `createWebGLToneChanger` also sets `this._baseSprite.filterArea = new Rectangle(-48, -48, Graphics.width + 96, Graphics.height + 96)`. That is on `_baseSprite`, not the spriteset, so the mod's layer is unaffected — but the `_battleField` bars (`GigaHack_Battle.js:697`) *are* children of `_baseSprite`'s subtree and will be clipped to that 48px-margin rect on MV in WebGL mode.
- **MV canvas mode:** `createCanvasToneChanger` (`rpg_sprites.js:2177-2180`) adds a `ToneSprite` child to the spriteset — one more sibling the overlay stacks above.

`Spriteset_Map.prototype.update` (MV `:2274` / MZ `:3378`) and `Spriteset_Battle.prototype.update` (MV `:2451` / MZ `:3623`) differ only by MZ's extra `updateAnimations()`/`updateBalloons()` calls. `Spriteset_Battle.prototype.createLowerLayer` builds `_battleField` in both (MV `:2462`, MZ `:3611`) and `_enemySprites` in both — the mod's `self._battleField.addChild(bars)` and `self._enemySprites` reads are safe. One difference: MV `this._battleField.setFrame(x, y, width, height)` (`:2463`) vs MZ `setFrame(0, 0, width, height)` with `this._battleField.y = y - this.battleFieldOffsetY()` (`:3612-3614`). Since the mod positions bars relative to sprites that are *also* `_battleField` children, this cancels out.

### C.17 PIXI 4 vs PIXI 5 — what actually touches the mod

The mod's total PIXI surface is `PIXI.Container` and `PIXI.Graphics` (11 constructor calls: `GigaHack_Events.js:411-418`, `GigaHack_Battle.js:534-537`), plus `new Point(...)` (`GigaHack_Inspect.js:308-309`) and `node.getBounds(true)` (`GigaHack_Inspect.js:238`).

- `PIXI.Container` / `PIXI.Graphics` / `Graphics.lineStyle/beginFill/drawRect/clear`: API-compatible across v4→v5 for everything the mod uses.
- `Point`: subclassed in MV (`rpg_core.js:621-628`, `Object.create(PIXI.Point.prototype)`), plain in MZ (`rmmz_core.js:1136`). `worldTransform.apply(point)` behaves the same.
- `getBounds(skipUpdate)`: **neither engine overrides `getBounds` or `calculateBounds`** (grep on both trees returns nothing). So the mod is calling PIXI's own implementation. PIXI 4.5.4's `DisplayObject.getBounds(skipUpdate, rect)` accepts the `skipUpdate` flag — **I could not verify this from source**, since `js/libs/pixi.js` is not in the extracted tree. Flag it for a runtime check on MV; the cached-bounds optimisation rationale at `GigaHack_Inspect.js:232-236` depends on it.
- **`_texture`**: MV's `Sprite.prototype.initialize` builds `new PIXI.Texture(new PIXI.BaseTexture())` per sprite (`rpg_core.js:3954-3957`); MZ shares one `Sprite._emptyBaseTexture` (`rmmz_core.js:1859-1865`). MV also carries `Sprite.voidFilter = new PIXI.filters.VoidFilter()` (`rpg_core.js:3952`) — `VoidFilter` was **removed in PIXI 5** (replaced by `AlphaFilter`, which is what MZ's `Window._createClientArea` uses at `rmmz_core.js:4014`). The mod touches neither.
- **`filters`**: MZ sets `filters` on `Window._clientArea` (`rmmz_core.js:4014`) and on `Spriteset_Base` (`rmmz_sprites.js:3199`); MV sets it on `Spriteset_Base._baseSprite` (`rpg_sprites.js:2173`). See §C.16.
- **`addChild` ordering**: the only ordering the mod depends on is "append after the original", covered in §C.16.
- MV's renderer can be **Canvas**, not WebGL (`SceneManager.preferableRendererType`, `rpg_managers.js:1834`; `Graphics.isWebGL()`, `rpg_core.js:1898`). MZ is WebGL-only (`SceneManager.checkBrowser` throws if `!Utils.canUseWebGL()`, `rmmz_managers.js:1937-1939`). `PIXI.Graphics` renders in canvas mode too, so the mod's overlays survive, but any assumption of WebGL is invalid on MV.

### C.18 `PluginManager.setup` — filename handling

**MV** `MV rpg_managers.js:2806-2814`: `if (plugin.status && !this._scripts.contains(plugin.name)) { this.setParameters(plugin.name, ...); this.loadScript(plugin.name + '.js'); this._scripts.push(plugin.name); }` — `_scripts` holds names **without** `.js`, `loadScript` **appends** `.js`, path prefix is `PluginManager._path = 'js/plugins/'` (`:2801`).
**MZ** `MZ rmmz_managers.js:3109-3118`: `const pluginName = Utils.extractFileName(plugin.name); ... this.loadScript(plugin.name);` — `_scripts` holds the **basename** (so `mods/Foo/Bar` registers as `Bar`), `loadScript` builds the URL via `makeUrl` (`:3144`, `"js/plugins/" + Utils.encodeURI(filename) + ".js"`), and there is no `_path`.

The mod reads `PluginManager._scripts` at `GigaHack_Hooks.js:290-291` (`indexOf(base)`), `:457-458`, and its whole "one flat namespace, a second claim on a name is silently dropped" analysis (`GigaHack_Hooks.js:519-545`). **That analysis holds on both engines** — MV's `contains` check is the same guard. But MV's `_scripts` entries come from the *full* `plugin.name` (which in MV is always a bare name anyway, since MV's plugin manager has no subfolder support), while MZ's are `Utils.extractFileName`'d. For an MV port, `indexOf(base)` remains correct.
MZ-only: `PluginManager._commands` (`:3107`), `registerCommand` (`:3159`), `callCommand` (`:3164`), `makeUrl` (`:3144`), `throwLoadError` (`:3155`). MV-only: `PluginManager._path` (`:2801`). `_errorUrls`, `_parameters`, `parameters`, `setParameters`, `onError`, `checkErrors` are equivalent.

### C.19 `Scene_Boot.prototype.start` — MZ added branches

**MV** `MV rpg_scenes.js:391-407`: battle-test / event-test / else (`checkPlayerLocation(); setupNewGame(); goto(Scene_Title); Window_TitleCommand.initCommandPosition();`), then `updateDocumentTitle()`.
**MZ** `MZ rmmz_scenes.js:321-339`: battle-test / event-test / **`DataManager.isTitleSkip()`** / else → **`this.startNormalGame()`**, then **`this.resizeScreen()`**, then `updateDocumentTitle()`.

The mod's hook (`GigaHack_Forge.js:941-949`) runs *after* the original in both, so it is safe. `DataManager.isTitleSkip` and `Scene_Boot.prototype.startNormalGame`/`resizeScreen`/`adjustBoxSize`/`adjustWindow`/`screenScale` are MZ-only; `Window_TitleCommand.initCommandPosition` is MV-only.

### C.20 `Game_Message`, `Game_Interpreter`, `BattleManager` — the command codes agree; the interpreter's own fields do not

- **`Game_Message`**: everything the mod calls exists in both with identical signatures except `setSpeakerName` (§A.17). `add(text)` MV `:421` / MZ `:572`; `setFaceImage(faceName, faceIndex)` MV `:425` / MZ `:580`; `setBackground(background)` MV `:430` / MZ `:585`; `setPositionType(positionType)` MV `:434` / MZ `:589`; `isBusy()` MV `:495` / MZ `:650`; `isChoice`/`isNumberInput`/`isItemChoice` present in both.
- **`Game_Interpreter`**: referenced only in comments (`GigaHack_Events.js:224`, `GigaHack_Forge.js:189`, `:324`, `:1686`, `:1966`). The `{code:0}` terminator requirement holds on both. The event-command codes the mod renders and forges — 108/408 (comment), 111/411/412 (conditional), 121/122/123 (switch/var/self-switch), 201 (transfer), 355/655 (script) at `GigaHack_Events.js:1145-1155`, and every effect/trait code table at `GigaHack_Forge.js:1018-1049` — are **identical** between MV and MZ. Note MZ code **357** (Plugin Command MZ) has no MV equivalent, and MV code **356** (Plugin Command MV) has no MZ handler — neither is emitted by the mod. Live code execution goes through `$gameTemp.reserveCommonEvent(id)` (`GigaHack_Forge.js:1693`), present in both — but see the correction below.

  **Correction, from writing the harness stubs against both shipped sources.**
  "Materially compatible" is true of the event-command CODES above and false of
  the interpreter's own fields, which is what a panel that reads the class sees:

  | Thing | MV | MZ |
  |---|---|---|
  | `executeCommand` | sets `this._params`, calls `command<code>()` with no arguments | no `_params` field at all; passes `command.parameters` as the argument |
  | `clear` keeps | `this._character`, a resolved object | `this._characterId`, a number re-resolved through `character()` each frame |
  | `setup` preloads via | the **static** `Game_Interpreter.requestImages(list)`, which recurses into referenced common events | the **instance** `this.loadImages()`, capped at the first 200 commands, codes 101 and 231 only, never following a common event |
  | reserved common event | `$gameTemp` holds **one** id; a second reserve overwrites it silently, and `retrieveCommonEvent` does not exist | a queue; a second reserve appends, and a miss returns false |
  | `setupReservedCommonEvent` | does not null-test, so a reserved id with no data throws | null-tests and returns false, consuming the bad id silently |
  | `command101` | wrapped in `if (!$gameMessage.isBusy())`, bumps `_index` by hand, returns **false** | early `return false` guard, no manual bump, returns **true**; also sets a speaker name from a fifth parameter MV has no field for |
  | `command122` Random | its own loop with an early `return`, so nothing else sees randomness | one loop for all five operands plus a `typeof value === 'number'` guard MV does not need |
  | `Game_Map.autorunCommonEvents()` | **absent** — the filter is inlined in `setupAutorunCommonEvent` | present, so the candidate list can be overridden without touching the switch test |

  Anything reading `_params`, `_character` or `retrieveCommonEvent` is reading a
  field that exists on exactly one engine. Feature-detect, as everywhere else.
- **`BattleManager`**: every member the mod touches exists in both with the same signature — `setup(troopId, canEscape, canLose)` MV `:2144` / MZ `:2276`; `forceAction(battler)` MV `:2592` / MZ `:2874`; `checkBattleEnd()` MV `:2614` / MZ `:2897`; `processVictory()` MV `:2638` / MZ `:2921`; `invokeAction(subject, target)` MV `:2538` / MZ `:2817`. The `startAction`/`endAction` restructuring the prompt asks about exists in both (MV `:2511`/`:2533`, MZ `:2786`/`:2808`) and the mod does not touch either. **One real difference:** `BattleManager._phase` sentinel values — MV initialises to `'init'` on setup (`rpg_managers.js:2154`) and nulls to `null` (`:2710`); MZ uses `""` on both ends (`rmmz_managers.js:2286`, `:3012`). `GigaHack_Battle.js:269` tests `if (!BattleManager._phase) return;` — both `null` and `""` are falsy, and both are `undefined` before the first battle, so this is safe. `BattleManager.updateTurn` gained a `timeActive` parameter in MZ (`:2655`) — unused by the mod.

### C.21 `Scene_Map.updateCallMenu`, `Game_Player.canMove`, and the rest of the movement/encounter hooks — byte-identical

Verified identical bodies (modulo `var`→`const`/`let` and formatting), so 33 of the 43 hooks port with **zero changes**:

`Scene_Map.prototype.updateCallMenu` (MV `rpg_scenes.js:773` / MZ `rmmz_scenes.js:1057`) · `Scene_Map.prototype.updateDestination` (`:678`/`:915`) · `Scene_Map.prototype.onMapLoaded` (`:567`/`:783`) · `Game_Player.prototype.canMove` (MV `rpg_objects.js:7640` / MZ `rmmz_objects.js:8342`) · `executeEncounter` (`:7598`/`:8297`) · `canEncounter` (`:7862`/`:8565`) · `encounterProgressValue` (`:7867`/`:8575`) · `makeEncounterTroopId` (`:7572`/`:8269`) · `checkEventTriggerHere` (`:7878`/`:8586`) · `checkEventTriggerTouch` (`:7900`/`:8608`) · `Game_Event.prototype.checkEventTriggerTouch` (`:8721`/`:9438`) · `Game_CharacterBase.prototype.canPass` (`:6391`/`:7085`) · `realMoveSpeed` (`:6364`/`:7058`) · `Game_BattlerBase.prototype.setHp` (`:2591`/`:3033`) · `die` (`:2319`/`:2768`) · `paySkillCost` (`:2769`/`:3217`) · `canPaySkillCost` (`:2765`/`:3210`) · `Game_Action.prototype.makeDamageValue` (`:1668`/`:1937`) · `Game_Party.prototype.maxItems` (`:4964`/`:5619`) · `gainItem` (`:4991`/`:5641`) · `gainGold` (`:4939`/`:5594`) · `loseGold` (`:4943`/`:5598`) · `Game_Map.prototype.refresh` (`:5809`/`:6494`) · `Game_System.prototype.isSaveEnabled` (`:117`/`:231`) · `onBeforeSave` (`:229`/`:351`) · `onAfterLoad` (`:237`/`:359`) · `playtimeText` (`:247`/`:369`) · `DataManager.createGameObjects` (MV `rpg_managers.js:200` / MZ `rmmz_managers.js:241`) · `extractSaveContents` (`:446`/`:405`) · all four `Window_Message` hooks: `startPause` (MV `rpg_windows.js:4561` / MZ `rmmz_windows.js:5173`), `updateWait` (`:4361`/`:4915`), `updateShowFast` (`:4472`/`:5067`), `isTriggered` (`:4457`/`:5044`).

Also identical and used by the mod: every `$gameMap`/`$gameParty`/`$gamePlayer`/`$gameSwitches`/`$gameVariables`/`$gameSelfSwitches`/`$gameTroop`/`$gameActors` method in the 97-member usage list except the four flagged in §A; every `Game_Actor`/`Game_Enemy`/`Game_Battler` method in the 50-member list (`actorId`, `changeClass`, `changeLevel`, `clearParamPlus`, `learnSkill`, `forgetSkill`, `forceChangeEquip`, `setFaceImage`, `setCharacterImage`, `setBattlerImage`, `recoverAll`, `addState`, `removeState`, `stateRate`, `elementRate`, `dropItemRate`, `nextLevelExp`, `maxLevel`, `equipSlots`, `equips`, …) — all present in both with matching arity. `Scene_Base.prototype.fadeOutAll` (MV `rpg_scenes.js:299` / MZ `rmmz_scenes.js:144`) and `isActive` (`:77`/`:32`) are identical; `startFadeOut(duration, white)` has the same signature in both, though MV drives a `ScreenSprite` (`:206-211`) and MZ a colour filter (`:95-101`).

---

## D. Save data

### D.1 Location — identical logic, identical result
Both derive the directory the same way, from the NW.js entry module:

MV `MV rpg_managers.js:755-760`:
```
755  StorageManager.localFileDirectoryPath = function() {
756      var path = require('path');
758      var base = path.dirname(process.mainModule.filename);
759      return path.join(base, 'save/');
760  };
```
MZ `MZ rmmz_managers.js:762-766`: same body, `const`, `"save/"`.

So `<game root>/save/` on both, and both are equally susceptible to a plugin aliasing the function (which is why the mod resolves it at call time — `GigaHack_Backup.js:12-14`; that reasoning ports unchanged).

### D.2 File names

| slot | MV 1.6.1 | MZ 1.9.0 |
|---|---|---|
| config | `config.rpgsave` | `config.rmmzsave` |
| global index | `global.rpgsave` | `global.rmmzsave` |
| autosave (slot 0) | *n/a* | `file0.rmmzsave` |
| manual slots | `file1.rpgsave` … `file20.rpgsave` | `file1.rmmzsave` … `file19.rmmzsave` |
| per-slot backup | `file1.rpgsave.bak`, `global.rpgsave.bak`, `config.rpgsave.bak` | *n/a* |

MV mapping: `StorageManager.localFilePath(savefileId)` (`rpg_managers.js:762-773`) — `savefileId < 0` → `config.rpgsave`; `=== 0` → `global.rpgsave`; else `'file%1.rpgsave'.format(savefileId)`. Backups append `".bak"` (`StorageManager.backup`, `:603-621`).
MZ mapping: `DataManager.makeSavename(savefileId)` (`rmmz_managers.js:365-367`) → `"file%1".format(savefileId)`, then `StorageManager.filePath(saveName)` (`:768-771`) → `fileDirectoryPath() + saveName + ".rmmzsave"`. Config and global use the literal save names `"config"` (`rmmz_managers.js:487`) and `"global"` (`:87`).

Slot range: MV's savefile list runs indices `0..maxSavefiles()-1` mapped to ids `index + 1`, i.e. **1..20** (`Window_SavefileList.prototype.maxItems` `rpg_windows.js:2809`, `drawItem` `:2823` `var id = index + 1`). MZ's runs ids `index + (autosave ? 0 : 1)` over `maxSavefiles() - (autosave ? 0 : 1)` items, i.e. **1..19 plus autosave 0** (`rmmz_windows.js:3145-3175`). `DataManager.maxSavefiles()` returns `20` in both (MV `:333`, MZ `:331`). The mod's `for (i = 1; i <= S.maxSlots(); i++)` (`GigaHack_Save.js:60`) is exactly right for MV and slightly over-wide for MZ.

### D.3 Encoding

**MV** — `StorageManager.saveToLocalFile` (`MV rpg_managers.js:673-683`):
```
673  StorageManager.saveToLocalFile = function(savefileId, json) {
674      var data = LZString.compressToBase64(json);
...
683  };
```
and `loadFromLocalFile` (`:684-693`) reads `{encoding:'utf8'}` then `LZString.decompressFromBase64(data)`. **On-disk format: UTF-8 text, LZString base64.** JSON is produced by `JsonEx.stringify(this.makeSaveContents())` in `saveGameWithoutRescue` (`:371`). Size warning fires above **200000** uncompressed characters (`:372`).

**MZ** — the pipeline is `objectToJson` → `jsonToZip` → `saveZip`:
```
583  StorageManager.jsonToZip = function(json) {
...
586          const zip = pako.deflate(json, { to: "string", level: 1 });
587          if (zip.length >= 50000) { console.warn("Save data is too big."); }
```
(`MZ rmmz_managers.js:583-596`), written by `saveToLocalFile` (`:644`) and read back via `zipToJson` → `pako.inflate(zip, {to:"string"})` (`:597-611`). **On-disk format: pako/zlib deflate, level 1, serialised as a binary string.** Size warning fires above **50000** *compressed* bytes.

Non-NW.js fallback: **MV** `localStorage`, keys from `StorageManager.webStorageKey(savefileId)` (`rpg_managers.js:774-782`) — `'RPG Config'` / `'RPG Global'` / `'RPG File%1'`, with `+ "bak"` suffixes for backups. **MZ** localForage/IndexedDB, keys from `StorageManager.forageKey(saveName)` (`rmmz_managers.js:773-776`) — `"rmmzsave." + $dataSystem.advanced.gameId + "." + saveName`, plus a probe key `"rmmzsave.test"` (`:778`).

### D.4 What the mod's backup/transfer module must change

`GigaHack_Backup.js` and `GigaHack_Save.js` treat saves as **opaque bytes** and copy with `fs.copyFileSync` (`GigaHack_Backup.js:5-10`, `GigaHack_Save.js:566-569`). That design is engine-agnostic and is the right call on MV too. Concrete changes:

1. **`SAVE_EXT`** — `GigaHack_Backup.js:33` (`var SAVE_EXT = '.rmmzsave';`) and `GigaHack_Save.js:545` (same literal). Change to `'.rpgsave'` on MV, or derive it: `Utils.RPGMAKER_NAME === 'MV' ? '.rpgsave' : '.rmmzsave'` (`Utils.RPGMAKER_NAME` is `'MV'` at `MV rpg_core.js:173` and `'MZ'` at `MZ rmmz_core.js:187` — the cleanest runtime discriminator available).
2. **`StorageManager.fileDirectoryPath()` → `localFileDirectoryPath()`** — `GigaHack_Backup.js:42`, `:52`, `GigaHack_Hooks.js:210`, `GigaHack_Save.js:476`.
3. **`StorageManager.filePath(DataManager.makeSavename(id))` → `StorageManager.localFilePath(id)`** — `GigaHack_Hooks.js:214`. The MV form takes the numeric id directly.
4. **`.bak` sidecars.** `B.saveFiles()` filters on `name.slice(-SAVE_EXT.length) === SAVE_EXT` (`GigaHack_Backup.js:66`). On MV, `file1.rpgsave.bak` does **not** match, so backups exclude the sidecars — which is probably fine, but `B.restore()` (`:201-219`) copies only the files listed in the snapshot's manifest, leaving stale `.bak` files next to restored saves. Since MV's `DataManager.saveGame` (`rpg_managers.js:337-349`) calls `StorageManager.restoreBackup(savefileId)` on any write failure, a stale `.bak` could resurrect a pre-restore save. **Recommendation for MV: after `B.restore()`, delete the matching `.bak` files** (`StorageManager.cleanBackup(savefileId)`, `rpg_managers.js:632-641`, or a direct `fs.unlinkSync`).
5. **Global index refresh after import.** `GigaHack_Save.js:641-655` can only cosmetically retitle the cached `DataManager._globalInfo` on MZ. On MV, do the real thing (§A.6).
6. **Fingerprinting** (`GigaHack_Backup.js:76-80`, name + size + mtime) is format-independent and needs no change.

---

## E. DOM / overlay surface

The mod's host is `<div id="gigahack-host">` created at `GigaHack_Shell.js:682` and appended to `document.body` at `:726`, styled from a stylesheet rule at `GigaHack_UI.js:609`:
```
#gigahack-host{position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100%;z-index:2147483000;pointer-events:none}
```

### E.1 Canvas element id — **case differs; the mod's fallback lookup breaks on MV**

- **MV** `MV rpg_core.js:2474-2479`: `this._canvas.id = 'GameCanvas';`
- **MZ** `MZ rmmz_core.js:882-886`: `this._canvas.id = "gameCanvas";`

`GigaHack_Inspect.js:551-552` does:
```
551  var c = (typeof Graphics !== 'undefined' && Graphics._canvas) ||
552      document.getElementById('gameCanvas');
```
`Graphics._canvas` exists on both, so the primary path works — but `getElementById` is case-sensitive, so the fallback is dead on MV. Low severity, trivial fix. The comment at `GigaHack_UI.js:608` ("above `#gameCanvas` (z-index 1)") is also MZ-specific wording.

`Graphics._updateCanvas` sets `zIndex = 1` in both (MV `rpg_core.js:2489`, MZ `rmmz_core.js:891`), and `Graphics._centerElement` is byte-identical (MV `:2700-2712`, MZ `:914-925`): `position:absolute; margin:auto; top/left/right/bottom:0;` with pixel width/height. The Inspect module's element-measured scaling (`GigaHack_Inspect.js:556-558`) is correct on both.

### E.2 Full DOM z-index stack

**MV** (all set as **inline** styles):
| element | id | z-index | source |
|---|---|---|---|
| canvas | `GameCanvas` | 1 | `rpg_core.js:2489` |
| video | `GameVideo` | 2 | `:2517` |
| upper canvas | `UpperCanvas` | 3 | `:2541` |
| mode box | `modeTextBack` | 9 | `:2641` |
| error printer | `ErrorPrinter` | 99 | `:2465` |

**MZ**:
| element | id | z-index | source |
|---|---|---|---|
| canvas | `gameCanvas` | 1 | `rmmz_core.js:891` |
| video | `gameVideo` | 2 | `:5595` |
| error printer | `errorPrinter` | *(none in JS — from index.html CSS)* | `:867-872` |
| loading spinner | `loadingSpinner` | *(none in JS)* | `:900-907` |

`2147483000` clears everything on both. Note MV's `UpperCanvas` (z 3) is a real element the mod's overlay sits above — it carries MV's loading image (`Graphics._paintUpperCanvas`, `rpg_core.js:2560-2572`), which MZ replaced with the `loadingSpinner` div.

### E.3 **`Graphics._modifyExistingElements` — MV-only inline-z-index clobber**

`MV rpg_core.js:2433-2439`, called from `Graphics.initialize` at `:1767`:
```
2433  Graphics._modifyExistingElements = function() {
2434      var elements = document.getElementsByTagName('*');
2435      for (var i = 0; i < elements.length; i++) {
2436          if (elements[i].style.zIndex > 0) {
2437              elements[i].style.zIndex = 0;
2438          }
2439      }
2440  };
```
MZ has **no** such function (grep: zero matches in `rmmz_core.js`).

**Does this hit the mod?** It reads `element.style.zIndex` — the **inline** style only. The mod's host gets its z-index from a `<style>` rule, so `element.style.zIndex` is `""` and `"" > 0` is `false`. **The overlay survives.** But:

- The **fallback path** at `GigaHack_Shell.js:734-738` sets `host.setAttribute('style', '...z-index:2147483000;...')` **inline**. If that path ever fires before `Graphics.initialize()`, MV will zero it and the overlay disappears behind the canvas.
- Timing depends on how the mod is loaded. Under the game's own mod loader (during `DataManager.loadDatabase` inside `Scene_Boot.create`, per `GigaHack_Boot.js:5-9`), `Graphics.initialize()` has already run — no exposure. Under a **vanilla MV `js/plugins.js` install**, plugin scripts execute at parse time and `document.body` already exists, so `GigaHack_Boot.js:71-72` mounts the overlay **before** `window.onload → SceneManager.run(Scene_Boot) → initGraphics → Graphics.initialize()` (`MV main.js:5-9`). That is the exposed case.
- **Recommendation:** never set an inline z-index on the host; keep it in the stylesheet, and if the fallback must set inline styles, omit `z-index` from the inline string.

### E.4 **`Graphics._disableTextSelection` — MV-only, disables selection document-wide**

`MV rpg_core.js:2718-2724`, called from `Graphics.initialize` at `:1770`:
```
2718  Graphics._disableTextSelection = function() {
2719      var body = document.body;
2720      body.style.userSelect = 'none';
2721      body.style.webkitUserSelect = 'none';
2722      body.style.msUserSelect = 'none';
2723      body.style.mozUserSelect = 'none';
2724  };
```
**MZ does not do this at all** (grep on `rmmz_core.js`: zero matches).

`user-select:none` is inherited, so on MV the entire overlay becomes unselectable by default. The mod already sets `user-select:text` on two selectors — `.mm-log` (`GigaHack_UI.js:647`) and `.mm-selectable` (`:649`) — and those descendant rules beat the inherited body value, so the console output and log drawer stay selectable. Everything else the user might want to copy (the Vars tab, the plugin report at `GigaHack_Hooks.js:500-513`, the diagnostics kv rows) will not be. **Recommendation for MV: add `#gigahack-host{user-select:text}` or `#mm-root{-webkit-user-select:text;user-select:text}` and opt *out* selectively.** `<input>`/`<textarea>` remain editable regardless in Chromium, so the Console tab is unaffected.

### E.5 Context menu

`Graphics._disableContextMenu` exists in **both** and is functionally identical — MV `MV rpg_core.js:2731-2737`, MZ `MZ rmmz_core.js:927-933`. Both iterate `document.body.getElementsByTagName('*')` **once** at `Graphics.initialize` time and assign `oncontextmenu`. Elements created **later** (the whole overlay) are untouched on both engines, so the mod's own `contextmenu` handling (`GigaHack_Shell.js:644`) works identically. On MV, if the overlay mounts before `Graphics.initialize` (§E.3), its then-existing children **will** get `oncontextmenu = () => false` stamped on them — a real MV-only difference, though the mod stops `contextmenu` at the host anyway.

### E.6 Input event plumbing — same on both

All game-level listeners are attached to `document` in the **bubble** phase on both engines:
- `Input._setupEventHandlers`: `keydown`, `keyup` on `document`; `blur` on `window` — MV `rpg_core.js:3224-3228`, MZ `rmmz_core.js:5880-5884`. Identical.
- `TouchInput._setupEventHandlers`: `mousedown`/`mousemove`/`mouseup`/`wheel`/`touchstart`/`touchmove`/`touchend`/`touchcancel` on `document` — MV `rpg_core.js:3689-3700` (plus `pointerdown`), MZ `rmmz_core.js:6254-6265` (plus `blur` on `window`).
- `Graphics._setupEventHandlers`: MV `rpg_core.js:2808-2814` binds `resize` (window) + `keydown`, `keydown`, `mousedown`, `touchend` (document); MZ `rmmz_core.js:951-954` binds `resize` (window) + `keydown` (document).

The mod's two-tier strategy — capture-phase `keydown` on `window` for its own hotkeys (`GigaHack_Shell.js:561-630`), bubble-phase `stopPropagation` on the host for everything originating inside the UI (`GigaHack_Shell.js:641-649`) — is **correct on both**. The comment at `GigaHack_Shell.js:620` ("MZ binds `Input._onKeyDown` on `document` in the bubble phase") is equally true of MV.

One MV-only nuance: MV does **not** `preventDefault` Tab (§C.4), so Tab inside the overlay will move browser focus on MV where it does not on MZ.

### E.7 Not verifiable from these sources

Neither `index.html` nor its stylesheet is present in either extracted tree, so I cannot compare the two engines' base CSS (body margin/overflow, `#errorPrinter` z-index, the MZ loading-spinner rules, or MV's `fpsmeter` CSS). Everything above is derived from the engine JS only.

---

## Summary — port priority

| # | Item | Severity | Where |
|---|---|---|---|
| 1 | `SceneManager.updateMain` contains `renderScene()` + `requestUpdate()` on MV — pause hook hard-hangs the game, speed hook causes exponential rAF runaway | **Fatal** | `GigaHack_Hooks.js:69`, `GigaHack_Player.js:280` |
| 2 | `$gameSystem.setSavefileId` absent → quick save never reaches `DataManager.saveGame` | **Fatal** | `GigaHack_Save.js:135` |
| 3 | `DataManager.loadGame` returns boolean, not Promise → post-load scene sequence skipped, globals swapped under a live scene | **Fatal** | `GigaHack_Save.js:218` |
| 4 | `DataManager.saveGame` returning `false` reported as success | High | `GigaHack_Save.js:139-148` |
| 5 | Save file extension `.rmmzsave` → `.rpgsave`; `fileDirectoryPath`/`filePath`/`makeSavename` renamed | High | `GigaHack_Backup.js:33,42,52`; `GigaHack_Hooks.js:206,210,214`; `GigaHack_Save.js:476,545` |
| 6 | `DataManager.savefileInfo` → `loadSavefileInfo` (and it re-parses the global file per call) | High | `GigaHack_Save.js:56` |
| 7 | `$gameMap._tileEvents` → `tileEvents` — the Map probe object will throw | High | `GigaHack_Map.js:188`, `GigaHack_Events.js:479` |
| 8 | MV `body{user-select:none}` makes most overlay text uncopyable | Medium | `GigaHack_UI.js:647-649` |
| 9 | Inspect: `_contentsSprite`→`_windowContentsSprite`, no `_innerChildren`, scroll baked into the sprite frame | Medium | `GigaHack_Inspect.js:183,189,273,302-314` |
| 10 | `ColorManager` / `Game_System.mainFont*` / `Scene_File.isSavefileEnabled` absent — 4 hooks skip cleanly, 3 features silently vanish | Medium | `GigaHack_Text.js:723,740,750,764`; `GigaHack_Save.js:307` |
| 11 | Spriteset overlay renders above MV's fade/flash sprites; battle bars clipped by MV's WebGL `filterArea` | Low | `GigaHack_Events.js:686`, `GigaHack_Battle.js:688` |
| 12 | `param()` clamps at 999 on MV (vs `Infinity` on MZ); no `paramBasePlus` | Low | `GigaHack_Battle.js:1195-1232` |
| 13 | `Graphics._fpsCounter` → `_fpsMeter` (already null-guarded; `.fps` unverified) | Low | `GigaHack_Shell.js:303` |
| 14 | `getElementById('gameCanvas')` fallback dead on MV (`GameCanvas`) | Low | `GigaHack_Inspect.js:552` |
| 15 | MV `ImageManager` reservation cache can purge the held `IconSet` bitmap | Low | `GigaHack_UI.js:780`, `GigaHack_Forge.js:1231` |
| 16 | Inline z-index in the overlay size-fallback would be zeroed by MV's `_modifyExistingElements` | Low | `GigaHack_Shell.js:736` |