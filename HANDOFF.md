# GigaHack MV/MZ — handoff

**Read this first. It is written for a session with no memory of building it.**

The project is done and tested. This is what it is, what is true of it that you
would otherwise relearn the hard way, and what is left.

---

## 1. What it is

A mod menu for any RPG Maker MV or MZ game. 35 modules, ~51,100 lines, six
tabs, 62 panels. Descended from GigaHack 1.0, which worked on exactly one MZ
game and is a separate, frozen repo (`GigaLionF95/GigaHack-SKA`).

Delivered by appending one entry per module to the game's own `js/plugins.js`.
**The count is written down in exactly one place** — `gigahack/manifest.json`.
The installer reads it, the browser suite reads it, and `test-installers.sh`
counts it. It used to be a literal 26 in ten places, and every one of those was
somewhere a newly added module could be silently missing from without a single
check going red.

Modules 25–33 were added after 2.0 shipped and are the second half of the
codebase by line count: Trace, Snapshot, Quest, Media, Screen, Auto, Kit, Keys,
Build. Four of them publish services of their own — see §2.

## 2. The five services everything is built on

Do not reimplement these; use them.

| Service | What it answers |
|---|---|
| `$.caps` | what this engine build can do — never what version it is |
| `$.eng` | one function that does the same job on both engines |
| `$.profile` | what is true of THIS game; always non-null, mostly computed |
| `$.compat` | did that write stick, who broke it, are we still outermost |
| `$.index` | where is it — candidates only, never authority |

Added with modules 25 and 26, and used the same way:

| Service | What it answers |
|---|---|
| `$.watch` | who wrote that — the map, the event and the command, captured at write time |
| `$.journal` | what has GigaHack changed this session, did it stick, and undo back to here |
| `$.interp` | what is running right now, and the named reasons the game is stuck |
| `$.rng` | which rolls happened and who asked; and a seeded generator, with its costs stated |
| `$.snap` | a bounded picture of the game state, and the difference between two |

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

**macOS ships BSD awk, and it is not GNU awk.** The installer passed its
28-line entries block through `awk -v`, which gawk accepts and BSD awk rejects
outright — `newline in string ... at source line 1`, exit 2. All 101 installer
checks passed in a Linux container and every single one failed on the
maintainer's Mac. Data goes into awk as a FILE, read with `NR == FNR`, never
through `-v`. The suite now re-runs a full install cycle under every awk on the
machine and statically forbids `awk -v` in the installer; `apt-get install
original-awk` gets you the BSD awk to test against. macOS also ships bash 3.2,
so no `mapfile`, no `declare -A`, no `${var,,}`.

**Every game has a js/plugins folder, so it cannot identify the payload.**
Both installers used to locate their own files by testing for `js/plugins`
beside the script. Copy the installer into a game — which is the obvious thing
to do — and it adopted the GAME's plugins folder as its payload, backed up
plugins.js, and only then discovered it had nothing to install. The payload is
identified by `manifest.json` next to `js/plugins/GigaHack_Core.js`, which is
unambiguously ours, and nothing is written until that resolves.

**cmd.exe cannot cd into a UNC path.** A Parallels or VMware share of the host
drive is `\\Mac\Home\...`, and cmd prints "UNC paths are not supported.
Defaulting to Windows directory" before a line has run. The .bat uses
`pushd`/`popd`, which maps the share to a temporary drive letter.

**Paths have spaces in them.** `for t in $TARGETS` word-splits on the default
IFS, so "A New Dawn 5.3.2 mac" became three targets, each confidently reported
as "not a game folder" while the real one was never tried. Found on the first
real device run, not in any synthetic test. There is a regression test now.

**The section-header convention is detected, not assumed.** A New Dawn uses
none; Star Knightess uses `--`. Both are handled by one predicate,
`$.profile.isSectionHeader`. There were three independent copies of
`name.slice(0,2) === '--'` in 1.0.

**A recorder must capture AFTER the original, not before.** `\V[5]` is a
variable reference and the engine resolves it exactly once, inside
`Window_Message.startMessage`, into the text state. The dialogue history hooks
that method; capturing before the original runs stores the reference instead of
the number, and the number is then gone for good, because the variable has moved
on by the time anyone reads the log back. `plain()` then deletes the reference
too, so the line reads "you have  gold" and nothing anywhere says why. Capture
after, and read the converted string off the window that was just filled —
`_textState.text`, or `_text` on MV's scrolling-text window. Two checks pin it
and reverting the order fails seven.

**COPY THE STUBS FROM A REAL ENGINE, NOT FROM MEMORY.** Both engines' sources
ship inside any game folder you have, and they are the only trustworthy source:

```
MV 1.6  <game>/www/js/rpg_core.js rpg_managers.js rpg_objects.js
                  rpg_scenes.js rpg_sprites.js rpg_windows.js
MZ 1.9  <game>/js/rmmz_core.js rmmz_managers.js rmmz_objects.js
                  rmmz_scenes.js rmmz_sprites.js rmmz_windows.js
```

On a packaged macOS build those sit under `Game.app/Contents/Resources/app.nw/`.
69,000 lines between the two. The harness stubs are only worth what their fidelity
is worth, and a stub written from memory is a harness that lies — which is the
one failure mode this suite cannot catch, because it is the thing doing the
catching. Every stub under `gigahack-test/stubs/x-*.js` cites the file and line
it was copied from; keep that up. Writing the 550-symbol batch from these
sources surfaced eight interpreter differences that `docs/MV-MZ-DELTA.md` had
recorded as "materially compatible" — see the correction under §C.20.

**A cache keyed on a ring buffer's LENGTH stops invalidating the moment the ring
fills.** Once the history holds its maximum, `rec.length` is pinned there and
never changes again — so the speaker-convention detector, keyed on it, froze at
whatever it had concluded when the buffer saturated, which is the normal steady
state and not the empty one anyone tests. Key on the total ever recorded
instead. The same shape was in `speakerIndex` for the adapter path, whose log is
also capped. And a memo compared against that cache must ASK the cache first:
`view()` tested `r._vc === conventionCache.on` before anything refreshed
`conventionCache`, so turning the convention off left every row that had already
been read back still split, and the toggle looked broken.

**Only a text state is converted; `_text` is raw.** `Window_ScrollText` keeps
the unconverted page on `_text` on both engines — conversion happens later,
inside the draw, and is never stored — so reading it as though it were converted
presents a live `\V[n]` reference as a resolved value. Scrolling lines carry no
converted copy, and the panel says so rather than passing the raw form off.

**`$.frameCount` is not play time.** It is GigaHack's own counter: it starts at
zero when the mod loads, so it ignores a forty-hour save, and it deliberately
keeps ticking while the mod holds the game (Hooks calls `$.frame()` on the
paused path so the overlay keeps updating). Two clocks are needed and they
answer different questions — ours orders and dedupes, `Graphics.frameCount` is
what a player recognises.

**A row dropped for having no text makes the list disagree with the count.** A
page of nothing but control codes — an icon, a pause — strips to an empty string,
and skipping it left "Pages kept" saying one thing and the list showing another,
with no gap to notice because the number beside each line was its position
rather than its id. Keep the row, say what it was, and number rows by record.

**A frame counter is the wrong clock for "is this the same page".** The engine's
own `Graphics.frameCount` advances in different places on the two engines and
stops entirely while the mod holds the game, so a dedupe keyed on it either
misses a repeat or merges two real lines. What actually distinguishes "the same
page started twice" from "the same line said twice" is whether the page was
closed in between, and `Game_Message.clear` is where that happens.

**A row's right-hand side is `flex:0 0 auto`, and a path is one unbreakable
token.** `.mm-edge` never shrinks — correct for a button, fatal for a string: an
absolute path pushes the label out of the row and is then clipped by the
column's `overflow-x:hidden`, so neither half can be read. Seven independent
copies of the same `kv()` helper had it. The fix is an opt-in `.mm-edge--shrink`
(the edge itself must stay rigid for controls), `word-wrap:break-word` inherited
from the root (NOT `overflow-wrap:anywhere` — Chromium 80, and the floor is 66),
and `U.w.path` / `U.w.pathRow`, which elide from the MIDDLE by measurement
because `text-overflow` keeps the head and the head of a path says nothing. The
`direction:rtl` trick does not work: a leading `/` is bidi-neutral, so it puts
the ellipsis at the front and still clips the tail. Middle-ellipsis is measured,
so it is refit from the three drag handlers that change a width.

**Forge id bases are computed and persisted.** `roundUp(1000, count + 200) + 1`
per kind. They independently reproduced 1.0's hand-tuned 1001/2001 for Star
Knightess. `isCustom` tests library membership, never `id >= base` — a
threshold test misreports the game's own rows on any larger game.

## 4. Running everything

The browser suite needs Playwright and its Chromium, which a fresh clone does
not have:

```sh
cd gigahack-test && npm install && npx playwright install chromium
```

`build-release.sh` checks for both before it runs the suite and prints that
command when they are missing. It did not, at first — a missing dev dependency
came out as the single word `FAILED` with nothing after it, which is the exact
class of defect this project exists to prevent, committed by its own build
script. `./build-release.sh --fast` and `./publish.sh --fast` skip the browser
suite knowingly; the lint, manifest, parse and installer checks still run.

```sh
node gigahack-test/lint.js               # 36 files, four rules
cd gigahack-test && node run.js          # 970 checks, stock MZ
node run.js --engine=mv                  # 981, stock MV
node run.js --engine=mv-modded           # 1010, MV + a modelled plugin stack
./test-installers.sh                     # 113 checks over nine plugins.js shapes
./build-release.sh                       # everything, then installs FROM the archive
node gigahack-test/verify-live.js <game> # against a real installed game
```

A module's own checks live in `gigahack-test/checks/<module>.js`, one file per
feature module, discovered automatically. Each is handed the same context
`run.js` builds — the same `check()`, the same `ev()`, the same engine flags —
so a check written there is indistinguishable from one written in `run.js`, and
a file that throws costs ONE check rather than taking the run down. That last
part is deliberate: a broken new feature must not hide the state of everything
else.

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

1. **The Windows installer is now covered, but only on PowerShell 7.** It
   shipped once without ever being executed and the first person to run it hit
   two defects at once. The suite now runs it — install, verify, idempotence,
   uninstall, and the copied-into-a-game refusal — wherever a PowerShell
   exists, and says so loudly where none does. But `gigahack-install.bat`
   launches `powershell`, which on Windows is **5.1**, and the suite here runs
   7.4. The constructs used are 5.1-safe by review, not by execution. Running
   it once on a real Windows box would close that gap.

2. **Neither game has actually been launched with the mod installed, and the
   offline verification is now nine modules out of date.** The 26/26 and
   52/53-hook figures were measured before modules 25–33 existed; re-run
   `verify-live.js` against both games. What has never been observed at all is
   the overlay drawing on a real canvas, the hotkeys firing through a real
   `Input`, or the MV stylesheet rendering on real Chromium 66. Launch both and
   open the menu. Two of the new modules matter most here because they are the
   only ones that touch something a harness cannot model honestly: **Media →
   Capture** writes a PNG through NW.js and its "show in folder" button has
   never run against a real shell, and **Keys** rewrites `Input.keyMapper`,
   which is the one edit that can leave a player unable to reach a menu. Its
   refusal rule is checked; the refusal has never been felt.

3. **No visual baseline.** The suite writes `shots-<engine>/*.png` for human
   review and compares nothing. That was a deliberate call — a full-viewport
   pixel differ reddens all nineteen shots on any layout shift, and font
   rasterisation differs by platform. If you add one, scope it tightly.

4. **Some settings have no UI.** `battle.bars.gap`, `console.historyMax`, and a
   handful of the new nodes' tuning keys. They are read and work; they are only
   reachable by editing the settings file. Either surface them or say in the
   docs that they are file-only.

5. **The dialogue history is memory-only and unbounded in one direction that
   is not the count.** The buffer holds 500 pages by default and each stored
   string is capped at 4000 characters, so the bytes are bounded — but nothing
   persists across a launch except an explicit export, and the battle log is
   still not captured at all (it keeps its own lines and never touches
   `Game_Message`). Both are stated in the panel's "Not recorded" group rather
   than left as gaps. `Window_BattleLog.addText` is the hook if it is ever
   wanted; it is extremely chatty and would need its own kind and its own share
   of the buffer.

6. **The nine new modules have never met a real game between them.** Every one
   is checked against faithful stubs and every check names an invariant, but a
   stub is only ever as good as the reading behind it, and three of these lean
   on engine surface nothing had exercised before: the interpreter's own
   fields, `AudioManager`'s buffer lifecycle, and `Bitmap`'s canvas. The stubs
   are copied from the shipped sources and cite file and line, which is the best
   a harness can do — it is not the same as having been run.

7. **Two things the modules asked for and did not get, both because the file was
   shared and being edited by somebody else at the time.** `plugins-mv.js`
   should gain a plugin that overwrites `Game_Event.prototype.meetsConditions`
   without aliasing (so Blocked's "the engine runs page N; the six stored
   conditions say page M" cross-check has a real culprit rather than a
   simulated one), and one that replaces `Game_Actor.prototype.equipSlots` with
   a shorter list for one class (so Loadouts' "never assume five slots" is
   exercised rather than reasoned about). Both are modelled inside the check
   files today, which tests the module and not the discovery.

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
