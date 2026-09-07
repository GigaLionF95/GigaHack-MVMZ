# GigaHack MV/MZ — port brief

Read this before touching any module. It is the contract every ported file
follows. Where it conflicts with what the 1.x source does, this document wins.

---

## 0. What changed, in one paragraph

GigaHack 1.x was a mod menu for one MZ game, delivered through that game's own
mod loader. 2.0 is the same menu for **any MV or MZ game**, delivered by
appending one entry to `js/plugins.js`. Nothing may assume the engine version,
the install layout, the game's content, or which other plugins are present.
Where a thing genuinely cannot be known generically, it moves into a **game
profile**; where it cannot work at all on some target, the mod **says what is
missing** rather than misbehaving quietly.

---

## 1. The five services you build on

These load before every feature module. Use them; do not reimplement them.

### `$.caps` — engine facts

```js
$.caps.engine            // 'MV' | 'MZ' | 'unknown'
$.caps.engineVersion     // string, for the boot report ONLY
$.caps.isMV / isMZ
$.caps.colorManager      // MZ has ColorManager; MV does not
$.caps.spriteGauge       // MZ has Sprite_Gauge; MV draws into window contents
$.caps.saveExt           // '.rpgsave' | '.rmmzsave'
$.caps.saveIsAsync       // MZ returns a Promise; MV a boolean
$.caps.updateMainIsReentrant   // see §3 — the fatal one
$.caps.fs, $.caps.fsWhy  // filesystem, and why not when absent
$.caps.cssGap, $.caps.cssClamp
$.caps.canvasId          // 'GameCanvas' on MV, 'gameCanvas' on MZ
$.caps.tileEventsKey     // 'tileEvents' on MV, '_tileEvents' on MZ
```

**Never branch on `$.caps.engineVersion`.** Ask for the capability. A version
string is a proxy that goes wrong the moment a plugin adds or removes the thing
you actually care about — which, on a modded game, is most of the time.

### `$.eng` — engine adapters

Thin functions that do the same job on both engines. Prefer these over any
direct engine call that appears in the delta table:

```js
$.eng.saveDir()                   // resolved through StorageManager, at call time
$.eng.savePath(id)                // id<0 config, 0 global, >0 a slot
$.eng.savefileInfo(id)            // caches MV's expensive per-call re-read
$.eng.updateGlobalInfo(fn)        // read-modify-write where the engine allows it
$.eng.saveGame(id, cb)            // cb(ok, err) exactly once, both engines
$.eng.loadGame(id, cb)            // same
$.eng.markSavefileId(id)          // no-op on MV instead of throwing
$.eng.normalColor(), $.eng.normalColorTarget()
$.eng.fontTarget()                // {face:{owner,method,label}, size:{...}}
$.eng.iconWidth(), $.eng.iconHeight()
$.eng.tileEvents()
$.eng.contentsSprite(win), $.eng.isWindowFurniture(win, child)
$.eng.fps()
```

### `$.profile` — per-game knowledge

```js
$.profile.active()                    // always an object, never null
$.profile.get(key, fallback)
$.profile.isSectionHeader(name)       // the ONE place the '--' convention lives
$.profile.sectionTitle(name)
$.profile.adapter('backlog'|'ironman'|'steam'|'modLoader')  // null when absent
$.profile.defaultHotkeys()            // derived from Input.keyMapper
$.profile.claimedKeys()               // {code: 'who claimed it'}
```

Fields worth knowing: `quickVars` (names, not ids), `forgeBase` (computed from
`max id + 1`, overridable), `forgeExtraFields`, `galleryFilter`, `steamAppId`,
`steamHints`, `notes`.

### `$.compat` — surviving other plugins

```js
$.compat.verify(control, write, read, want)   // → {ok, got, want, culprits, message}
$.compat.isDegraded(control), $.compat.degradedWhy(control)
$.compat.frameworks()             // recognised suites + their named consequences
$.compat.likelyCulprits(control)
$.compat.loadOrder()              // {known, last, after[], why}
$.compat.selfTest([ids])
```

**Every mutating control routes its write through `$.compat.verify`.** Control
keys currently in use: `vars.set`, `switches.set`, `inv.gold`, `inv.items`,
`party.param`, `party.exp`, `party.equip`, `party.class`, `party.skills`,
`battle.states`, `battle.params`, `forge.write`, `shop.open`, `media.volume`,
`media.play`, `media.master`, `keys.map`, `keys.pad`, `screen.tone`,
`screen.brightness`, `screen.flash`, `screen.shake`, `screen.zoom`,
`screen.weather`, `screen.picture`, `screen.window`, `plugin.param`,
`build.frameHook`.
A key no quirk in `$.compat`'s table claims gets the honest "no loaded plugin is
known to touch this" rather than a guess, which is the right answer until
somebody has actually watched a suite break it.
When `isDegraded(control)` is true, the panel greys the control and shows
`degradedWhy(control)` as the reason — it does not hide it, and it does not
pretend it worked.

### `$.index` — finding things fast

```js
$.index.status()                       // {phase, progress, stage, timings, notes, counts}
$.index.findByName(kind, q), findVar(q), findSwitch(q), findMap(q), findAsset(q)
$.index.findEventsTouching('switch'|'variable'|'selfswitch', id)
$.index.rebuild()
```

Every query returns `{candidates, complete, why}`. **The index is for finding,
never authority.** Resolve each candidate against live `$data*` / `$game*`
before displaying or changing anything. When `complete` is false, show `why` —
that string is already written for the user.

---

## 2. Style rules (unchanged from 1.x, and the reason it is diagnosable)

1. **Every risky call goes through `$.safe(fn, label, fallback)`.** Failures log
   once and return the fallback.
2. **Every engine alias goes through `$.install(label, owner, method, factory, reason)`.**
   Never `X.prototype.y = function` without saving the original. The build lints
   for this and fails on a violation.
3. **When something cannot work, name it, name why, and where possible name the
   command that fixes it.** A greyed control with a reason beats a working-looking
   control that does nothing.
4. **A missing target is not an error.** `$.install` records `installed:false`
   with a reason; the dependent feature checks and degrades.
5. No new dependency on load order between feature modules beyond what the
   manifest already guarantees.

---

## 3. The MV rules that will bite you

### 3.1 `SceneManager.updateMain` is fatal to wrap on MV

MV's `updateMain` ends with `this.renderScene(); this.requestUpdate();` — the
`requestAnimationFrame` chain perpetuates itself from *inside* the function.

- Returning early from a wrapper **terminates the loop permanently**. The game
  hard-hangs and cannot be un-paused; only a reload recovers it.
- Calling the original N times schedules N rAF callbacks, each of which
  schedules N more. **Exponential runaway** within a second.

MZ drives its loop from PIXI's ticker instead, so there `updateMain` is a plain
"do one logical step" that is safe to skip or repeat.

**Rule:** do not wrap `updateMain` unless `$.caps.updateMainIsReentrant`. Pause
and game-speed gate `SceneManager.updateScene` + `changeScene` +
`updateInputData` instead, leaving `renderScene` and `requestUpdate` alone on
every path — including the paused one.

### 3.2 The rest of the delta

| Thing | MZ | MV | Use |
|---|---|---|---|
| save extension | `.rmmzsave` | `.rpgsave` | `$.caps.saveExt` |
| save dir | `StorageManager.fileDirectoryPath()` | `localFileDirectoryPath()` | `$.eng.saveDir()` |
| save path | `filePath(makeSavename(id))` | `localFilePath(id)` | `$.eng.savePath(id)` |
| save/load | Promise | boolean (`false` = failure!) | `$.eng.saveGame/loadGame` |
| slot info | `DataManager.savefileInfo(id)` | `loadSavefileInfo(id)`, re-reads every call | `$.eng.savefileInfo(id)` |
| session save id | `$gameSystem.setSavefileId(id)` | **absent — throws** | `$.eng.markSavefileId(id)` |
| slot enablement | `Scene_File.isSavefileEnabled` | absent entirely | check `$.caps.savefileEnabled` |
| text colour | `ColorManager.normalColor()` | `Window_Base.prototype.normalColor` | `$.eng.normalColor()` / `normalColorTarget()` |
| main font | `$gameSystem.mainFontFace/Size` | `Window_Base.standardFontFace/Size` | `$.eng.fontTarget()` |
| icon size | `ImageManager.iconWidth` | `Window_Base._iconWidth` (32) | `$.eng.iconWidth()` |
| window contents | `_contentsSprite` | `_windowContentsSprite` | `$.eng.contentsSprite(win)` |
| inner children | `_innerChildren` / `_clientArea` | **no such concept** | `$.eng.isWindowFurniture()` |
| gauges | `Sprite_Gauge` | `Window_Base.prototype.drawGauge` | `$.caps.spriteGauge` |
| tile events | `$gameMap._tileEvents` | `$gameMap.tileEvents` | `$.eng.tileEvents()` |
| canvas id | `gameCanvas` | `GameCanvas` | `$.caps.canvasId` |
| fps | `Graphics._fpsCounter.fps` | `Graphics._fpsMeter.fps` | `$.eng.fps()` |
| followers | no `forEach` | **has** `forEach` | feature-detect both |
| param floor | `param()` has no upper cap | clamps at `paramMax` | read the cap, raise before writing |

### 3.3 DOM, on MV only

- `Graphics._modifyExistingElements` walks the whole document at boot and zeroes
  **every positive inline z-index**. Mount the overlay after boot and re-assert
  z-index (`$.caps.zIndexClobber` says when).
- `Graphics._disableTextSelection` sets `user-select: none` on the body, so
  overlay text is not selectable unless we opt back in
  (`$.caps.textSelectionBlocked`).
- Canvas z-index is 1, video 2, upper canvas 3, FPS 9, error printer 99. Use
  4–8, or ≥100 to sit above error output.

---

## 4. The CSS floor

MV 1.6 ships NW.js 0.29 = **Chromium 66**; older MV is worse. The overlay
stylesheet must work there.

- **`gap` in flex containers** needs Chrome 84 → use margins.
  Idiom: `.row > * + * { margin-left: 8px }`, `.col > * + * { margin-top: 8px }`.
- **`min()` / `max()` / `clamp()`** need Chrome 79 → use fixed values, or a
  media query where a real range is needed.
- Safe on the floor and used freely: custom properties `var(--x)` (49),
  `position: sticky` (56), `:focus-within` (60), flexbox itself, `calc()`.
- Do not introduce: `:is()`, `:where()`, `aspect-ratio`, `inset`, logical
  properties, `gap` in grid *or* flex, container queries, `:has()`.

The test suite fails the build on any of the above appearing in the stylesheet.

---

## 5. Decoupling rules

1. **No hardcoded ids of any kind.** Not items, not switches, not variables, not
   maps, not achievements. If a feature needs one, it comes from the profile or
   is discovered from the loaded database at boot.
2. **Forge id bases are computed**, never literal. `$.profile.get('forgeBase')`
   returns `{kind: base}` derived from `max id + margin`, rounded. `isCustom`
   tests **membership in the loaded library**, never `id >= base` — a threshold
   test misreports stock rows on any game bigger than the one it was tuned for.
3. **The section-header convention lives in exactly one place**:
   `$.profile.isSectionHeader()`. There were three independent copies of
   `name.slice(0,2) === '--'`; there is now one, it is a detected pattern, and a
   game with no convention gets a single "Ungrouped" section rather than an
   empty panel.
4. **Hotkey defaults are derived** from `Input.keyMapper` at first run, not
   chosen from one game's free letters.
5. **No plugin is named in code.** Recognising `YEP_`/`VisuMZ_`/`SRD_` belongs in
   `$.compat`'s quirks table, which produces user-facing text. A comment may
   explain *why* a design is defensive, but state it as an invariant ("some
   plugins process note tags in `Scene_Boot.start`"), not as a fact about one
   game ("artifact.js does its note tags there").
6. **No display string names a game or an edition.** Anything the user sees that
   refers to the game reads it from `$dataSystem.gameTitle` via
   `$.profile.active().name`.
7. **Delivery is discovered, not assumed.** `$.paths.layout` is `plain`, `www`,
   or `modloader`. Nothing may hardcode `mods/GigaHack`, count directory levels,
   or require a mod loader to exist.

---

## 6. Module manifest and load order

Order matters; later files depend on earlier ones.

```
00 Core       namespace, safe, install, log, layout + paths
01 Caps       engine detection, capability table, $.eng adapters
02 Store      settings, undo, backups, fs → localStorage → memory
03 Profile    per-game knowledge, computed defaults
04 UI         design system, primitives, mmTable
05 Shell      overlay host, hotkeys, log drawer
06 Hooks      every engine alias
07 Tabs       tab/panel registry, Debug panels
08 Compat     load order, self-tests, write-verify, alias integrity, quirks
09 Index      boot index and cache
10 Vars       variables and switches
11 Inv        inventory and gold
12 Party      party and parameters
13 Backup     save backups
14 Map        teleport and maps
15 Events     event overlay and inspector
16 Battle     battle tools
17 Text       message speed, auto-advance, dialogue history (recorded, plus
              the game's own backlog where a profile adapter supplies one)
18 Forge      custom items, skills, states
19 Player     movement, game speed
20 Encounters random encounter control — ENABLED, probes for encounters at boot
21 Gallery    switch-section bulk unlock — registers only when a section
              convention was detected
22 Steam      achievements, driven by the greenworks API, no table
23 Save       save anywhere, quick save/load
24 Console    JS console, snippets, log inspector
25 Trace      watchpoints, the change journal, running interpreters, RNG
              — publishes $.watch, $.journal, $.interp, $.rng
26 Snapshot   what changed since the save, and between two saves
              — publishes $.snap
27 Quest      why an event is locked, common events, objectives, script dump
28 Media      the audio the game ships, its image folders, screenshots
29 Screen     tint, weather, zoom, shake, the picture slots, and the game's
              own windows made transparent or hidden
30 Auto       run something when the game reaches a state; run splits
              — consumes $.watch
31 Kit        equipment loadouts, an ad-hoc shop
32 Keys       the key map the game itself reads
33 Build      what this build costs to run, how its plugins are configured
34 Boot       bootstrap, boot report, index kick-off, self-test
```

The count is not written down anywhere it could go stale: `gigahack/manifest.json`
is the one list, the installer reads it, the browser suite reads it, and
`test-installers.sh` counts it. It used to be a literal 26 in ten places, every
one of which was somewhere a newly added module could be missing from without a
single check going red.

`Inspect` is deleted. It shipped disabled in 1.x with "did not work as
intended", and its MZ-only window-internals dependency (`_innerChildren`,
`_clientArea`, `_contentsSprite`) is the single largest MV rewrite in the
codebase for a feature nobody used.

---

## 7. Definition of done for a ported module

- [ ] `node --check` passes.
- [ ] No `X.prototype.y = function` without `$.install`.
- [ ] No literal content ids; no game or edition name in any string.
- [ ] Every entry in the delta table (§3.2) that the module touches goes through
      `$.caps` or `$.eng`.
- [ ] Every mutating control routes through `$.compat.verify` and honours
      `isDegraded`.
- [ ] Every feature that can be absent checks a capability and states the reason
      when it is.
- [ ] The header comment explains invariants, not one game's plugin list.
- [ ] `@target MZ` is kept (MV ignores unknown annotations) and the `@help`
      names the modules it requires.
