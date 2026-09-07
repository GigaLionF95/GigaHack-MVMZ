# gigahack-test

The automated test suite for GigaHack MV/MZ. Headless Chromium, no game required,
**three engines from one set of stubs**.

```sh
npm install            # playwright, once
npm run lint           # the build lint (26 files)
npm test               # stock RPG Maker MZ 1.9.0
npm run test:mv        # stock RPG Maker MV 1.6.1
npm run test:mv-modded # MV plus a modelled third-party plugin stack
npm run test:all       # lint + all three
```

Exit code is the contract: 0 clean, 1 any failure. Failures print as
`FAIL  <name>   [<detail>]`. Names are free-text sentences about behaviour,
because a failure line is the whole bug report.

Each engine writes screenshots to `shots-<engine>/`, so an MV run never
overwrites the MZ shots and a visual regression is attributable to one of them.

---

## What is in here

| File | What it is |
|---|---|
| `harness.html` | Thin shell: canvas, stub tags, plugin tags — **MZ** |
| `harness-mv.html` | The same shell — **MV** |
| `harness-mv-modded.html` | The same shell — **MV + a modelled plugin stack** |
| `stubs/core.js` | Everything identical on both engines |
| `stubs/engine-mz.js` | The divergent MZ surface |
| `stubs/engine-mv.js` | The divergent MV surface |
| `stubs/plugins-mv.js` | A modelled third-party plugin stack |
| `stubs/fixtures.js` | `$data*`, `$game*`, the scene fixture, and a virtual filesystem |
| `run.js` | The Playwright driver and every assertion |
| `lint.js` | The build lint: alias discipline, CSS floor, JS floor, game coupling |

There is no build step and no test framework. `run.js` boots one of the three
shells in headless Chromium, pokes at `window.GigaHack`, and asserts.

### Load order is explicit, and that is the point

```
stubs/core.js → stubs/engine-{mv,mz}.js → [stubs/plugins-mv.js] → stubs/fixtures.js → the 26 plugin tags → __engineBoot()
```

The 1.x harness was one 1377-line file, and it was order- and
hoisting-sensitive by construction: an assignment to `ImageManager.loadCharacter`
placed above `var ImageManager` saw the hoisted `undefined` and was silently
skipped, which left the sprite turntable permanently on its "loading…"
fallback. Splitting the file is worth doing for MV, and spelling the order out
is worth doing regardless.

---

## The harness is a claim about the engine, not a convenience

This is the single most important thing to understand before editing it.

Every stub is a behavioural MODEL written from the shipped engine source — MV
1.6.1's `rpg_*.js` and MZ 1.9.0's `rmmz_*.js`, which live inside any game folder
you already have — and annotated with the file and line it was learned from, so
any of it can be checked against a real build rather than trusted. The engine's
INTERFACE is reproduced exactly, because names, constants, data tables, call
order and return values are fact rather than expression; its implementation is
not, and no engine source is redistributed here. See `stubs/README.md`.
**Where a stub simplifies,
the simplification is the bug it will hide.** Eleven real defects got through
the 1.x suite precisely because the harness was politer than the engine, and
every one of them is still true:

- **`Sprite_Battler`'s anchor is `(0.5, 1)`** — `x` is the horizontal centre and
  `y` is the *feet*. A stub that treated them as a top-left corner would have
  passed a bar-placement test for bars drawn on the enemy's shoes.
- **MZ windows build their skin from sprites *deeper* than their contents**
  (`_container → _backSprite → TilingSprite`, `_clientArea → _cursorSprite → 9
  sprites`). The first harness modelled windows flat, so a hit test ranked by
  depth passed there and would have returned a piece of the border on every
  window in the real game. (MV's tree really *is* flat — that is now a
  difference the harness models, not a simplification it makes.)
- **`Game_Actor` inherits `setHp` through the prototype chain.** The first
  harness *copied* those methods onto each subclass, so god-mode hooks patched
  an object nobody called — and every god-mode test passed against a harness
  that did not behave like the engine.
- **`convertEscapeCharacters` rewrites every backslash to `\x1b` before a
  backlog stores it.** A harness that stored backslashes let an escape stripper
  that matched on backslashes pass, and show raw `c[14]` codes in the game.
- **`DataManager.isItem` is an identity test** — `$dataItems.includes(item)`,
  not `item.id === …`. An id comparison would let the Forge hand the party a
  detached copy of a definition and still pass, while the real engine files it
  under no container at all.
- **`Game_Actor._equips` holds `Game_Item` objects**, `{_dataClass, _itemId}`,
  not the data objects themselves. Storing the raw objects hides every code
  path that reads an equip slot *by id* — which is exactly what the Forge's
  scrub does when a save outlives its definitions.
- **`Game_Party.items()` maps ids straight through `$dataItems` with no
  guard.** That is what makes an unresolvable id a crash rather than a gap, and
  it is the reason the tombstone design exists at all.
- **`DataManager.createGameObjects` replaces every `$game*` global**, and
  `loadGame` calls it *before* `extractSaveContents`. A stub that only made a
  new `$gameTemp` hid the entire hazard quick load has to survive.
- **`Game_System.onBeforeSave` / `setSavefileId` are the scene's job, not
  `saveGame`'s**, and `onAfterLoad` runs from `Scene_Load.terminate()` — after
  the scene is already being left. A stub that folded either into save/load
  hides the whole reason quick save has to sequence them by hand.
- **`Game_Followers` differs between the engines** — MV has `forEach`, MZ has
  `data()` — and `Game_Follower.update` copies the player's opacity and
  transparency every frame. A stub with a convenient `forEach` on both engines
  let a call ship that threw on every pointermove of the opacity slider.
- **An event fires on contact through three prototypes**, not one:
  `Game_Player.checkEventTriggerTouch`, `Game_Player.checkEventTriggerHere`
  (from `updateNonmoving`, after every step) and
  `Game_Event.checkEventTriggerTouch`. A harness with only the first let a
  "ghost" mode pass while two of the three doors stayed open.
- **`ImageManager` has a real IconSet.** It used to be `{}`, so the
  decode-to-data-URL path was dead and every icon in every screenshot was a
  grey placeholder. The stub is a 512×800 canvas — 400 icons — because the
  Forge's picker is four hundred cells and its cost is why that grid is
  windowed.

Two more were added when the harness went dual-engine, and both were found by
this suite failing:

- **MZ's `StorageManager.saveObject` serialises.** Storing the live object by
  reference made every save a snapshot of the future: mutate the world, load,
  and the "restored" value was the mutated one.
- **`$gameMessage` is a real class, not an object literal.** `createGameObjects`
  rebuilds each `$game*` global by calling its constructor, so a literal is
  replaced by `null` on the first load — and every capability that probes
  `$gameMessage` then reads as absent for a reason that has nothing to do with
  the engine. Its MZ-only members go on the **prototype** for the same reason.

So: when you add a stub, open the engine file and copy the real thing,
awkward parts included. When a test passes and the game disagrees, suspect the
harness first.

---

## Stock engine, not one game

`engine-mv.js` and `engine-mz.js` are **stock**. That is a change from 1.x,
which was faithful to one specific MZ game's build:
`Scene_File.isSavefileEnabled` came from that game's ironman plugin,
`DataManager.saveGame`'s Promise shape was that plugin's replacement, and
`metaArray` came from a third. All three read as engine facts and were not.

2.0 targets arbitrary games, so anything that was really a plugin's behaviour
either moved into `stubs/plugins-mv.js` or was dropped. `stubs/fixtures.js` is
a generic project: a detected `-- Section` convention, unround table sizes, and
gaps left unnamed on purpose, because a real project leaves room for later
additions and a section's range must not stop at its last named entry.

### `stubs/plugins-mv.js` — the modelled stack

Seven behaviours, each the smallest thing that reproduces what the compat layer
has to survive:

1. a framework that **overwrites without aliasing** — `maxGold`, `maxItems`
   (per-item, from note tags read in `Scene_Boot.start`), and `paramMax`
   lowered below the engine's own ceiling;
2. a fast-forward plugin that runs `Scene_Map.update` **five times a frame**;
3. an image-cache plugin that calls `ImageManager.clear()` on every map
   transfer and destroys the base textures with it;
4. a save-location plugin that redirects `StorageManager.localFileDirectoryPath`
   somewhere else entirely;
5. a serialiser plugin that replaces `JsonEx` with a circular-reference encoder
   whose output plain `JSON.parse` reads **without throwing** and hands back
   the wrong shape;
6. two plugins that claim a letter each in `Input.keyMapper` — precisely the
   two GigaHack would otherwise pick first;
7. a plugin that recomputes a parameter on read and is **deliberately not in
   the quirks table**, so the "nothing I recognise is responsible" branch is
   covered too.

The stubs are named for what they do. The one place a real name appears is the
entry each adds to `$plugins`, and that is deliberate: `$.compat` fingerprints
plugins *by name*, so a stack registered under invented names would exercise
the matcher against nothing and every culprit-naming check would pass
vacuously.

---

## The frame loop, and why it is countable

MV's `SceneManager.updateMain` ends with

```js
this.renderScene();
this.requestUpdate();     // requestAnimationFrame(this.update.bind(this))
```

so the animation-frame chain perpetuates itself from *inside* the function.
A wrapper that returns early does not pause the game, it **ends** it; a wrapper
that calls the original N times schedules N frames that each schedule N more.

`stubs/core.js` therefore routes `requestUpdate` through a **countable rAF
queue** (`window.__raf`). `__raf.flush()` is one real animation frame: it takes
the pending callbacks, clears the queue, advances a controllable clock by
exactly 1/60s, and runs them — so callbacks scheduled *during* the flush land
in the new queue, exactly as the browser does. "How many animation frames are
pending" is the single observable that separates a correct pause from a hard
hang and a correct 8× from exponential runaway, and a real `rAF` cannot be
counted.

MZ drives its loop from PIXI's ticker instead, so its `updateMain` is a plain
"do one logical step". The MZ stub keeps the re-arm on `SceneManager.update`
rather than inside `updateMain`, because that placement *is* the structural
difference and putting it anywhere else would make the two engines untestably
alike.

---

## Chromium 66

MV 1.6 ships NW.js 0.29 = **Chromium 66**, and older MV is worse. (1.x targeted
Chromium 85; this is the same machinery retargeted, and the floor is nineteen
versions lower.) This suite runs a modern Chromium, so an unsupported feature
would pass here and collapse the overlay in the game. Three checks exist purely
for that:

- a static scan of the generated stylesheet against a Chromium-66 deny list,
- the same scan over all plugin JS,
- a **simulation** — every declaration Chromium 66 would discard is stripped
  from the live stylesheet and the overlay re-measured.

`gap` is on the deny list even though Chromium 66 knows the property: it
shipped for **grid** in 66 and for **flex** in 84, and the overlay's rows and
columns are flex. A gap there is silently nothing, which is the worst kind of
unsupported.

---

## Prove a check can fail

A check that passes against a broken build is worse than no check. Before
trusting a new one, break the thing it covers and watch it go red.

Four fixes in this tree have been mutation-verified that way, and the numbers
are the reason to believe the checks:

| Revert | What failed |
|---|---|
| `caps.updateMainIsReentrant` forced true on MV (1.x behaviour) | **19 checks** — with pause engaged: 0 renders and **0 pending animation frames**, i.e. the loop is dead; un-pausing changes nothing; the 1.x speed hook reaches 512 pending by frame 3 |
| `$.clone`'s RegExp pass-through removed | **3 checks** — a matched profile that omits `sectionPattern` gets `{}`, and `isSectionHeader()` throws `re.test is not a function` |
| `$.compat.bootCheck()` moved back before `wireIndex()`/`wireSelfTest()` | **3 checks** — a clean install reports four of GigaHack's own hooks as over-patched |

The suite also carries its own mutation *inside* it. On `--engine=mv` it
rebuilds the 1.x pause and speed hooks in a sandbox around the engine's real
`updateMain` and asserts that they fail: 0 pending callbacks for pause, and
8 → 64 → 512 for speed. The sandbox keeps its **own clock**, because MV's
`updateMain` drives a time accumulator and a sandbox sharing the live clock
would advance time the real `SceneManager` never consumed — the next real frame
would then catch up by running its inner loop a dozen times, and the
measurement after it would be meaningless.

Other traps this suite has already fallen into, kept as warnings:

- **A probe that captures a DOM node before the handler that rebuilds it** then
  reads values off the detached copy.
- **An ordering check that wraps the prototype a second time** measures its own
  wrapper. The way to ask "did this run first?" is to ask the code it wrapped —
  `Scene_Boot.start` reports what it could see through `__bootProbe`.
- **A wall-clock threshold** is either flaky or so loose it never fires. Count
  nodes, not milliseconds.
- **Anything deferred to the next task has to be measured after a wait.** A
  synchronous read sees a grid that has not filled in yet.
- **Tests inherit state.** Set the world up explicitly rather than assuming what
  ran before you left it.
- **A check whose fixture cannot fail proves nothing** — a tombstone test
  against an entry with no effects and no price passed against a stub that
  changed nothing at all.

---

## Real input, not synthetic events

The hotkey checks drive `page.keyboard.press()` rather than dispatching
`keydown`, and the scroll checks drive `page.mouse.wheel()`.

That distinction found the runaway-scroll bug that survived three rounds of
fixes: Chromium's scroll anchoring only engages under genuine scrolling, so
every synthetic test written before it was blind to it. Five 100px wheel ticks
travelled **11563px**. If you are testing input behaviour, use the input device.

The toggle hotkey is **derived**, not `KeyN`: `$.profile.defaultHotkeys()` reads
`Input.keyMapper`, subtracts what the engine and this game's plugins have
claimed, and takes the first free key from a preference order. On
`--engine=mv-modded` two plugins claim `N` and `P`, and the defaults move to
`G` and `T`. The suite asks for the key rather than pressing one.

---

## The virtual filesystem

The harness is a browser build, so `$.caps.fs` is false and every module that
reads the game folder degrades with a reason — which is itself worth asserting.
But the index's two most valuable stages (cross-map events, assets) exist only
when there *is* a filesystem, and a suite that never runs them never tests what
the index was built for.

So both worlds are available. `__mountVirtualFs()` gives the mod a game folder
with five `data/MapNNN.json` files; `__unmountVirtualFs()` takes it away again
and the degraded path is re-checked. Nothing is installed by default.

Map 5 and map 12 each reference switch 141 from a **different command shape** —
a Control Switches command and a page condition — so "find every event that
touches switch 141" has to cross files *and* cross command shapes to answer
correctly. A list-only scan finds one of the two and looks like it works.

---

## Adding a check

1. Extend `stubs/core.js` (if both engines agree) or `stubs/engine-*.js` (if
   they do not) with the surface the module touches — copied from the engine
   source, including the awkward parts, with the file:line in a comment.
2. Add the assertion to `run.js`. Prefer asserting against values the engine
   itself computes over hard-coded numbers, so a wrong assumption fails rather
   than agreeing with itself.
3. Gate anything engine-specific on `IS_MV` / `IS_MZ` / `MODDED`, and prefer a
   *symmetrical* assertion — `X is present exactly on MZ` says more than two
   one-sided checks and cannot rot on one engine while passing on the other.
4. Run all three: `npm run test:all`.
5. Break the thing it covers and watch it go red.

Use `SAVE_EXT` rather than an extension literal, and `$.cfg.hotkeys.*` rather
than a key literal. Both were per-game constants in 1.x and are capabilities
now.
