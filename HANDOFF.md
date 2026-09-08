# GigaHack MV/MZ — handoff

**Read this first. It is written for a session with no memory of building it.**

The project is done and tested. This is what it is, what is true of it that you
would otherwise relearn the hard way, and what is left.

---

## 1. What it is

A mod menu for any RPG Maker MV or MZ game. 36 modules, ~58,400 lines, six
tabs, 71 panels. Descended from GigaHack 1.0, which worked on exactly one MZ
game and is a separate, frozen repo (`GigaLionF95/GigaHack-SKA`).

Delivered by appending one entry per module to the game's own `js/plugins.js`.
**The count is written down in exactly one place** — `gigahack/manifest.json`.
The installer reads it, the browser suite reads it, and `test-installers.sh`
counts it. It used to be a literal 26 in ten places, and every one of those was
somewhere a newly added module could be silently missing from without a single
check going red.

Modules 25–33 were added after 2.0 shipped and are the second half of the
codebase by line count: Trace, Snapshot, Quest, Media, Screen, Auto, Kit, Keys,
Build. Four of them publish services of their own — see §2. Module 34, Addons,
came with 2.2 and loads last of the feature modules: an addon may use any of
them and none of them may depend on it.

## 2. The services everything is built on

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

And with 2.2:

| Service | What it answers |
|---|---|
| `$.net` | is there a way to fetch something here, and which one — the only network access in the mod |
| `$.addons` | what somebody else's code has added, and whether it is running |
| `$.paths` | where the mod's own files go, which of the three locations, and who said so |

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

**A TAR HEADER PUBLISHES THE BUILD ACCOUNT'S NAME, AND NO FILE SCAN FINDS IT.**
`tar` stamps the owner into every member header, and `tar tvzf` prints it on the
first line without extracting anything — so an archive built on a personal
machine hands that account name to everyone who downloads it. Scrubbing the
working tree does nothing, because the leak is metadata rather than content: it
went out with 2.0.0's two `.tar.gz` assets and 126 copies of the name were
sitting in one of them. `build-release.sh` now neutralises ownership (bsdtar and
GNU tar spell it differently, both are handled) AND fails the build if any
header still carries a name. Zip stores no owner and needs nothing.

The guard itself is the second lesson. Written first as
`tar tvzf | awk '{print $2}'`, it read the LINK COUNT — which is 0 on every
entry of every archive — so it passed on the very archive that had 126 copies
of the name in it. Fields 3 and 4 are the owner and group. A check that cannot
fail is worse than no check, so mutation-verify a guard against something known
to be bad before believing it: this one is now checked both ways, against a
dirty archive and a clean one.

The 2.0.0 assets were repaired in place rather than rebuilt: their PUBLISHED
bytes were re-tarred with ownership zeroed and everything else — names, modes,
mtimes, order, content — carried across, then proved unchanged by extracting
both and diffing the trees. Rebuilding from the tag would have changed the
archive for a dozen reasons unrelated to the leak.

**THE STUBS ARE MODELS, NOT COPIES, AND THAT IS A LICENCE QUESTION AS WELL AS A
STYLE ONE.** The engines' JavaScript belongs to their publisher and is licensed
for the games you make with the editor, not for redistribution in a public MIT
repository. Reproduce the INTERFACE exactly — names, constants, data tables,
call order, return values, because those are fact and there is no other correct
way to state them — and write the IMPLEMENTATION from what you understand of the
behaviour rather than transcribing it. There is a measuring tool: it folds
comments, whitespace and var/let/const and reports every contiguous run shared
with the engine, with line numbers. The tree went from a 365-token copy of one
command dispatcher down to 121 tokens, all of it in two data tables. Keep it
there, and keep the file:line citations — provenance stays stated; it is the
copy that goes. See `NOTICE.md` and `gigahack-test/stubs/README.md`.

**READ A REAL ENGINE, NOT YOUR MEMORY.** Both engines' sources ship inside any
game folder you have, and they are the only trustworthy thing to learn from:

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

**THE WRITE PROBE CREATES THE DIRECTORY IT TESTS.** `isWritable()` in Core is
`mkdirSync` + write + unlink, and it runs for every candidate at Core load. Up
to 2.1.0 that meant the application-data folder existed before any UI could ask
about it — the mod had already done the thing it now asks permission for. A
capability probe that has a side effect is not a probe. Nothing under
`$.paths.sharedRoot` may be touched, including `existsSync`, unless
`$.paths.consent === 'granted'`.

**`fallbackUsed` does not mean "we left the game folder".** It is `i > 0` —
"the first candidate for this layout was not writable" — and on a plain install
candidate zero WAS the shared folder, so it read false while writing outside the
game. `outsideGameFolder` is the field that means what the other one's name
suggests. A boolean whose name is a summary of an implementation detail will be
read as its plain-English meaning by everyone including the person who wrote it.

**NW.js KEEPS ONE STORAGE AREA PER APP, NOT PER GAME.** Two RPG Maker games
whose `package.json` carries the same name — which is the default, and common —
share `localStorage`. Keyed on the file name alone, the second game read the
first game's settings and every write from either overwrote the other's. Every
key that must not cross games carries `$.paths.gameId`, which is the folder name
plus a hash of the absolute path: two games in identically-named folders are a
real case and `gameKey` alone does not separate them.

**A RAW NUL BYTE MAKES A SOURCE FILE INVISIBLE TO EVERY TEXT TOOL.** One module
used `'\x00'` as a key separator, typed as the byte rather than as an escape.
`file` called it "data", `grep` skipped it in silence — not an error, an empty
result — and the panel count in three documents was two short for a release
because of it. Same separator, spelled as an escape. If a tool returns nothing
about a file, check that the tool can read it before believing the answer.

**A MODULE THAT LOADS LAST MUST NOT CASUALLY ALIAS A METHOD ANOTHER MODULE
ALREADY ALIASES.** `$.install`'s `unpatch` refuses when it is no longer the
outermost wrapper, which is correct — and it means the last module to wrap a
method takes away every inner module's ability to remove its own hook from
Debug → Hooks. Addons wanted five aliases and would have silently frozen Auto's,
Text's and Snapshot's. It notices the same events from the frame hook instead,
one frame late, and says so. `checks/auto.js` is the test that catches this.

**A REPAINT SIGNAL MUST NEVER BE A RING BUFFER'S LENGTH, AND USUALLY NOT ITS
TOTAL EITHER.** Once the ring is full — the steady state, not the empty one
anybody tests — the length is pinned and a row rolling off looks like nothing
happening. The total is worse in the other direction: `clear()` empties the
buffer without moving it, so a panel keyed on the total goes on showing lines
that are gone. Carry a revision counter bumped by every path that changes what
the buffer HOLDS, and pin it with a check that clears while the panel is open.

**`table.mm.isScrolling()` IS PERMANENTLY FALSE ON A PLAIN TABLE.** The only
writer of `scrolledAt` is a scroll listener installed inside `if (virtual)`.
Used as a guard on a non-virtual table it reads as protection and does nothing.
Only the virtual paint preserves `scrollTop`; the plain one empties the body and
the browser clamps the offset to zero with it.

**`W.group`'s `mm.tag(text)` is a no-op unless the group was BUILT with a
non-empty tag.** `mmGroup` only creates the `.mm-group-tag` span when
`opts.tag` is truthy, so a group whose tag is sometimes absent can never be
filled in live. Every live group passes a tag, even an empty-looking one.

**`U.now()` IS A WALL-CLOCK STRING FOR THE LOG DRAWER, NOT A CLOCK.** It returns
`'12:34:56'`. Subtracting two of them is `NaN`, which is what a timings column
printed until a screenshot showed it.

**A READING TAKEN FROM THE DATABASE MUST NOT ASK THE SAVE.** The quest
objectives are inferred from the project's own switch and variable NAMES, which
exist from the title screen; whether each step is done is a question about the
game objects, and those do not exist until a new game or a load has built them.
Asking anyway threw once per step — 1,383 identical lines in the log at boot on
a project with a thousand named switches, which is a third of the ring and the
boot report with it. `$.safe` did its job and that is exactly the problem: it
logs on every call, so a guard that belongs before the call cannot be replaced
by one around it. Found by `verify-live.js` against a real game; no harness in
the suite has a title screen.

**A CHECK THAT PINS A WHOLE TAB STRIP CANNOT SURVIVE A NEW PANEL.** Two separate
assertions compared the Settings sub-tab list to an exact string, and both went
red the moment this release added a panel — a failure that says nothing about
the thing the check was named for. Assert the adjacency or the membership the
check's own name claims, not the whole list.

**THE SHELL'S HOOK LISTS ARE ITERATED OVER A COPY, AND THAT IS LOAD-BEARING.**
A live panel that finds the thing it was drawing has gone asks for a tab
rebuild, and `renderTab` empties both hook arrays with `length = 0`. Iterated
live, every hook registered after that one was skipped for that tick — silently,
and only on the ticks where a rebuild happened, which is the hardest kind of
intermittent to attribute. Both loops slice first. The check drives the shell's
own 700ms clock rather than a copy of the loop written in the check, because a
check that reimplements the thing it is testing proves nothing about it.

**A DOM NODE KEEPS THE CLASSES IT WAS WEARING WHEN IT WAS DETACHED.** A check
that holds a node across a repaint and then asks whether it is still armed gets
"yes" about a button that is no longer on screen. Re-query after the tick. And
`U.setOpen(true)` rebuilds the tab, so closing and reopening the overlay to
prove a live repaint proves nothing at all.

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
cd gigahack-test && node run.js          # 1271 checks, stock MZ
node run.js --engine=mv                  # 1285, stock MV
node run.js --engine=mv-modded           # 1314, MV + a modelled plugin stack
./test-installers.sh                     # 121 checks over nine plugins.js shapes
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

2. **Neither game has actually been LAUNCHED with the mod installed.** The
   offline verification is current as of 2.2.0 and clean on both: A New Dawn
   (MV 1.6.1, 76 plugin entries) reports 36/36 modules and 98/101 hooks, Star
   Knightess Aura (MZ 1.9.0, 178 entries) 36/36 and 95/97, every skip named,
   the storage answer `unasked` and the data directory beside the game with
   nothing created under Application Support. It is worth re-running after any
   change — it found a defect no harness could (see §3, the quest steps). What
   has never been observed at all is the overlay drawing on a real canvas, the
   hotkeys firing through a real `Input`, or the MV stylesheet rendering on real
   Chromium 66. Launch both and open the menu. Two of the new modules matter most here because they are the
   only ones that touch something a harness cannot model honestly: **Media →
   Capture** writes a PNG through NW.js and its "show in folder" button has
   never run against a real shell, and **Keys** rewrites `Input.keyMapper`,
   which is the one edit that can leave a player unable to reach a menu. Its
   refusal rule is checked; the refusal has never been felt.

3. **No visual baseline.** The suite writes `shots-<engine>/*.png` for human
   review and compares nothing. That was a deliberate call — a full-viewport
   pixel differ reddens all twenty-seven shots on any layout shift, and font
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

8. **`$.net`'s three real transports have never run.** The harness has no `nw`,
   no `require` and is served from `file://`, so `node-https` and its redirect
   following, the `fetch` body read and the XHR error path are unexercised code.
   The chooser's SELECTION is checked and every network check drives an injected
   transport, which is the honest limit of a suite with no network in it. Treat
   the transports as unproven and be suspicious of them first when an import
   from a link misbehaves on a real game.

9. **The in-memory Node model is POSIX-only, including under `platform:
   'win32'`.** The Windows path check proves `%LOCALAPPDATA%` is read off the
   host process and used, not that a Windows path is spelled correctly. A
   backslash or drive-letter bug in `keyFromPath`, `isInside` or `urlToFsPath`
   would go straight through it. The model also cannot make `accessSync` fail
   for permissions — only ENOENT — so "existence is not readability", which is
   §3's oldest lesson, is untested against it.

10. **Addons load when the overlay mounts, which on MV can be seconds after
    boot.** That is the earliest moment a held key can have reached the page,
    which is what safe mode needs, and it is stated in the module — but it means
    an addon's alias is not installed for the first few seconds of a real MV
    game, and nobody has measured how many. The shared addon library is barely
    exercised at all: only its refused state is checked, because building a
    granted-consent fixture on the fake disk was more appetite than the day had.

11. **The addon panel's two layout decisions are not pinned by any named
    check** — the review jumping to the top of the column when something is
    staged, and the decision buttons sitting above the source rather than below
    the fold. Both were found by looking at screenshots. A future edit can undo
    either and only the global "every panel renders" sweep would notice.

12. **`store.moveTo`'s limits are stated and not driven.** The tree copy caps at
    4000 files and four directories deep and produces a truncation reason; no
    check reaches either. `store.dropSource` leaves empty directories behind on
    purpose and nothing removes them.

13. **A 2.1.0 settings file written by a NEWER schema is not adopted, it is
    discarded** — existing `loadSettings` behaviour, and adopting one on grant
    would then hand the player defaults with nothing saying why. The adoption
    path is checked for the same-schema case only.

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
