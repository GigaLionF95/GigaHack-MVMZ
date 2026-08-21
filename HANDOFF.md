# GigaHack MV/MZ — handoff

**Read this first. It is written for a session with no memory of building it.**

The project is done and tested. This is what it is, what is true of it that you
would otherwise relearn the hard way, and what is left.

---

## 1. What it is

A mod menu for any RPG Maker MV or MZ game. 26 modules, ~28,700 lines, six
tabs. Descended from GigaHack 1.0, which worked on exactly one MZ game and is a
separate, frozen repo (`GigaLionF95/GigaHack-SKA`).

Delivered by appending 26 entries to the game's own `js/plugins.js`.

## 2. The five services everything is built on

Do not reimplement these; use them.

| Service | What it answers |
|---|---|
| `$.caps` | what this engine build can do — never what version it is |
| `$.eng` | one function that does the same job on both engines |
| `$.profile` | what is true of THIS game; always non-null, mostly computed |
| `$.compat` | did that write stick, who broke it, are we still outermost |
| `$.index` | where is it — candidates only, never authority |

`docs/PORT-BRIEF.md` is the full contract and it wins over what any module
does. Read it before touching a module.

## 3. Facts you must not relearn

**MV's `SceneManager.updateMain` cannot be wrapped.** It ends with
`renderScene()` and `requestUpdate()` — the animation-frame chain perpetuates
itself from inside the function. Return early and the loop terminates
permanently: the game hard-hangs and cannot be un-paused. Call the original N
times and each frame schedules N more, each of which schedules N more. MZ is
safe because PIXI's ticker drives its loop. `$.caps.updateMainIsReentrant`
gates this and `$.pause` / `$.step()` already solve it — delegate rather than
writing a second mechanism.

**`Utils` is a function, not an object.** Both engines declare
`function Utils() { throw new Error('This is a static class'); }`. A
`typeof Utils === 'object'` test is false on every real game. It was in two
places, it silently failed everywhere, and the harness could not see it because
the stub was an object literal. The stub is now a function and two checks pin
it. **Test for usability, not for a type name.**

**A hole in `$plugins` is a red screen from a file that looks fine.**
`[{"A"},,{"B"}]` is a legal array literal with an undefined slot;
PluginManager reads `plugin.name` off it and throws during boot. The installer
must drop the separating comma when it removes its own block, and does. There
is a check for it.

**A file the game cannot read is invisible, not broken.** An existence check
needs only directory permission, so presence, size and checksum all report fine
while every read fails and the module silently is not there. The installer
forces 644 and verification opens every file rather than stat-ing it.

**`PluginManager.setup` drops a second claim on a name with no error at all** —
and the dedup KEY differs: MZ uses the basename, MV the full entry. Both are
checked.

**Paths have spaces in them.** `for t in $TARGETS` word-splits on the default
IFS, so "A New Dawn 5.3.2 mac" became three targets, each confidently reported
as "not a game folder" while the real one was never tried. Found on the first
real device run, not in any synthetic test. There is a regression test now.

**The section-header convention is detected, not assumed.** A New Dawn uses
none; Star Knightess uses `--`. Both are handled by one predicate,
`$.profile.isSectionHeader`. There were three independent copies of
`name.slice(0,2) === '--'` in 1.0.

**Forge id bases are computed and persisted.** `roundUp(1000, count + 200) + 1`
per kind. They independently reproduced 1.0's hand-tuned 1001/2001 for Star
Knightess. `isCustom` tests library membership, never `id >= base` — a
threshold test misreports the game's own rows on any larger game.

## 4. Running everything

```sh
node gigahack-test/lint.js               # 27 files, four rules
cd gigahack-test && node run.js          # 360 checks, stock MZ
node run.js --engine=mv                  # 371, stock MV
node run.js --engine=mv-modded           # 400, MV + a modelled plugin stack
./test-installers.sh                     # 101 checks over nine plugins.js shapes
./build-release.sh                       # everything, then installs FROM the archive
node gigahack-test/verify-live.js <game> # against a real installed game
```

`verify-live.js` is the one worth knowing about. It loads a real game's engine,
`plugins.js` and data files, loads GigaHack on top, and reports what the mod
concluded — which profile matched, what it computed, every hook that installed
or was skipped and why. It found the `Utils` bug that three test suites missed.

**Test discipline, unchanged and still the reason this is diagnosable:**
- Every fix gets a check that **fails when the fix is reverted**. Mutation-verify or it does not count.
- Harness stubs are copied verbatim from the engine, awkward parts included.
- **When a test passes but the game disagrees, suspect the harness first.**

## 5. What is left

Nothing is broken. These are the honest gaps.

1. **The Windows installer has never been executed.** `gigahack-install.ps1`
   was written and reviewed against the shell version, and four defects were
   found and fixed by review — but no PowerShell interpreter was available to
   run it. It is the highest-risk file in the repo. Run it on a Windows machine
   before telling anyone it works.

2. **Neither game has actually been launched with the mod installed.** Both
   verify clean offline: engine files load, all 26 modules load, hooks install
   (52/53 on MV, 49/49 on MZ). What has not been observed is the overlay
   drawing on a real canvas, the hotkeys firing through a real `Input`, or the
   MV stylesheet rendering on real Chromium 66. Launch both and open the menu.

3. **No visual baseline.** The suite writes `shots-<engine>/*.png` for human
   review and compares nothing. That was a deliberate call — a full-viewport
   pixel differ reddens all nineteen shots on any layout shift, and font
   rasterisation differs by platform. If you add one, scope it tightly.

4. **Some settings have no UI.** `battle.bars.gap`, `console.historyMax`. They
   are read and work; they are only reachable by editing the settings file.
   Either surface them or say in the docs that they are file-only.

5. **Two panels register at the same sort order** (Events' Find and Gallery,
   both 110). Their relative position depends on `Array#sort` tie-breaking,
   which on Chromium 66 was only stable below a length threshold the World tab
   exceeds. Harmless, but give one of them a different number.

## 6. The style, and why it is the whole point

Every failure in 1.0 that cost days was a *silent* one: a file that existed but
could not be read, a plugin skipped without an error, a hook that never
installed. 2.0 adds a class of its own — a cheat that writes a value the game
recomputes away, on a game with forty other plugins.

The answer was never cleverness. It was making the mod say what it found. A
control that greys itself and names the plugin responsible is worth more than a
control that looks like it works. When something cannot work, name it, name
why, and where possible name the command that fixes it.

Keep that.
