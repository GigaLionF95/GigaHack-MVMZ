# GigaHack MV/MZ 2.2.0

A mod menu for **any RPG Maker MV or MZ game**.

GigaHack 1.0 was a menu for one game, delivered through that game's own mod
loader. This is a separate project: the same menu, rebuilt so that nothing
assumes the engine version, the install layout, the game's content, or which
other plugins are present. Where something genuinely cannot be known
generically it moves into an optional per-game profile; where something cannot
work at all on a given target, the mod says what is missing rather than
misbehaving quietly.

2.2.0 opens the menu up: a game nobody wrote it for can now have a panel
written for it by whoever plays that game, and the mod finally asks before it
keeps anything outside the game's own folder.

## Install

Download the archive for your platform, unpack it, and run the installer from
inside it:

| Platform | Run |
|---|---|
| macOS | double-click `gigahack-install.command` |
| Windows | double-click `gigahack-install.bat` |
| Linux | `./gigahack-install.sh` |

With no arguments it finds every MV/MZ game under the current folder and its
parent. To be explicit, pass the path to the folder holding `index.html` — on
macOS that is usually inside the app bundle, at
`YourGame.app/Contents/Resources/app.nw`.

It writes exactly three things and nothing else:

- `js/plugins/GigaHack_*.js` — 36 new files
- `js/plugins.js` — 36 entries appended **at the end**
- `js/plugins.js.gigahack-backup` — the original, kept

`--uninstall` restores that file byte for byte. `--verify` checks an install
without changing anything. `--dry-run` shows what would change.

The entries go at the end because every GigaHack alias has to be outermost: a
plugin loading after us wraps our hooks and can undo what the menu does. The
mod re-checks this at runtime and says so when a game update has changed it.

**Upgrading** is the same install. Both installers find their own block by a
version-agnostic marker, so the existing block is replaced rather than joined by
a second one, and your `settings.json` is migrated forward.

Two things to know when upgrading from 2.1.0. One new module file appears
beside the thirty-five (`--uninstall` removes all of them). And **GigaHack now
asks where to keep its own files**, having chosen for you until now: until the
question is answered it reads and writes only beside the game, so an existing
`settings.json` in the application-data folder is not lost but is not read
either — answer *use the shared folder* and it is picked up again exactly as it
was. Nothing is moved or deleted on either answer.

## What is new in 2.2.0

**Addons — plugins for GigaHack, written by whoever plays the game.** GigaHack
works on any game without knowing anything about it, and that is also its
ceiling: it cannot know that this game's variable 412 is the affection score.
An addon is a JavaScript file that does know.

An addon adds panels on any of the six tabs, hotkeys that appear in Settings
beside the mod's own, console calls, and a game profile; it subscribes to the
map changing, a battle starting, a line being said, a save being loaded; and it
gets its own settings file. Bring one in by pasting it, from the clipboard, from
a link, from a file, or by dropping it in the addons folder.

Every source ends at the same review, which shows what actually arrived — its
header, its size, its fingerprint, and for a link the host it came from —
**before anything runs**. Nothing is enabled by being imported. A link is never
re-fetched on its own; "check the source again" reports changed, unchanged or
unreachable and still installs nothing. An addon that throws is stopped, named,
and given its line number, and one that was loading when the game last stopped
is quarantined and says so. Holding the panic-hide key at boot skips all of
them.

Two things an addon does that cannot be undone are said in the panel rather
than left to be discovered: an engine alias stays installed for the life of the
process (disabling makes it a pass-through, because pulling a wrapper out of a
chain something else has aliased on top of is not safe), and a game profile
applies from the next launch, because profile resolution is settled once. And
it is not a sandbox: an addon is arbitrary JavaScript with the game's
privileges, exactly like any RPG Maker plugin, and the import review says so.

**GigaHack asks where to keep its own files, once per game.** Its settings, its
addons, its save backups and its console snippets go either beside the game or
in a folder of its own in this account's application-data directory. Up to
2.1.0 it chose the second without asking.

The answer is written **beside the game**, never in the shared folder, so it
cannot travel: copy GigaHack into a second game and it asks again there. That
is structural rather than a promise — a file beside one game cannot reach
another — and it is what the check suite pins. Until it is answered, nothing
outside the game folder is read, written, probed or created; the write probe
that picks a directory *creates* the directory it tests, so it is now pointed
only at candidates the answer allows.

Answer yes and settings, hotkeys and the look of the menu can be shared between
games from one file, per section, with the game that last wrote each one named.
Hotkey sharing is off by default and says why: a hotkey default is derived from
the keys *this* game leaves free, so a shared bind is applied only where the
game has not claimed the key, and every skip is listed with its claimant.

**Panels that show live state now show it live.** Thirty-one panels were frozen
at the moment they were built — Player → Movement disagreed with the mod's own
footer within a second of walking. They repaint from a cheap change signal
through one helper that holds the rules: never while the menu is closed, never
while a cell inside the thing is being edited, never with a dropdown open over
it, never mid-scroll — and a hold does not consume the change, so the repaint
happens on the first free tick rather than being lost. The dialogue history
follows the tail when you are at the bottom and leaves you exactly where you
are when you are not.

**The recorded history updates while it is open.** Its change signal is what the
buffer holds rather than how much has ever been said: clearing it empties the
buffer without moving the total, and a panel watching the total would have gone
on showing lines that are gone.

### Defects fixed in 2.2.0

- **A raw NUL byte in one module file** made it "data" to every text tool on the
  machine. `grep` skipped it in silence — not an error, an empty result — and
  the panel count in the docs was two short because of it. Same separator, now
  spelled as an escape.
- **The installer left temp files in game folders.** A run killed between
  writing one and cleaning up left a 137KB `plugins.js.gigahack-tmp10` and three
  empty `.err` files behind, and nothing ever looked: the engine reads
  `plugins.js` and nothing else, so the game behaved perfectly. There is now a
  trap on INT and TERM, `--verify` names any leftovers and the command that
  removes them, and `--uninstall` takes them with it.
- **Two games in a browser build shared one settings key.** NW.js keeps one
  storage area per app, and two RPG Maker games whose `package.json` carries the
  same name — the default — share it. Keys are per game now; an unkeyed key
  from an older build is adopted once and then gone.
- **A settings profile carried the storage answer.** Handing somebody a profile
  could change which folder their settings came from. Profiles no longer carry
  it, and applying one leaves this machine's answer alone.
- **Backups followed a path cached before the data directory moved** — a stale
  path that still resolves, still exists and is still writable, which is the
  invisible kind.
- **A row with no path lost its label.** "In use now" came out as "In use n…"
  while the three-line reason beside it read perfectly; the reason now goes
  under the row, where it has the width. The sweep that was supposed to catch
  this only scanned narrow columns and had a threshold it slipped under.

## What 2.1.0 brought

**Nine new modules, twenty-two new panels**, bringing the menu to 68. Four of them publish services the
rest build on — `$.watch`, `$.journal`, `$.interp`, `$.rng` and `$.snap`.

*Answering questions the engine cannot.* **Watchpoints** name the map and the
event that wrote a variable, captured at the moment of the write, because by
the time a poller notices the value moved the writer is long gone.
**Interpreters** shows every running interpreter, the command each is on and
what it is waiting for, with five named reasons a game freezes. **Blocked**
lists every unmet page condition on an event with the value now beside the
value needed, and names every event anywhere in the game that could set it —
joining the condition decoder to the cross-map index, which had never been
done. **Journal** is a chronological record of every change the mod made, with
whether it stuck and undo-back-to-here.

*Getting unstuck.* **Screen** exposes everything `$gameScreen` holds — tint,
weather, zoom, shake, brightness, all hundred picture slots — because a tint a
crashed cutscene never cleared is one of the most common ways an RPG Maker game
becomes unplayable and the engine offers no way out. **Common** reads and runs
the project's own common events. **Since Save** takes a baseline at every save,
so "what did that cutscene do to my state" is one panel away, and **Compare**
diffs two save slots without loading either.

*Everything else.* **Quests** reconstructs objectives from the project's own
flag naming and says what it inferred from. **Script** dumps every line of text
the game can show, searchable, with a jump to the event that says it. **Audio**
auditions the whole sound tree; **Assets** browses the image folders and
animates a walk cycle. **Capture** takes a clean screenshot with the overlay
hidden. **Triggers** runs a saved snippet when the game reaches a state;
**Route** drives splits off switches and variables rather than off a stopwatch.
**Loadouts** saves a character's whole kit and puts it back as one undo entry.
**Shop** opens the game's own shop scene with a goods list you build. **Game
Keys** edits the key map for games that ship no rebinding, and refuses any edit
that would leave no way back to a menu. **RNG** records every roll with the
caller that asked for it and can seed the generator, with the four things
seeding costs stated on the panel. **Parameters** reads every plugin's
configuration; **Performance** says what this build costs to run, per frame
hook.

**A dialogue history that works on any game.** The Backlog panel used to appear
only where the game shipped a backlog plugin of its own, which is almost never.
GigaHack now records one: every message page, every choice made, every number
and item answered, with the map and the play time. It listens *after* the
message window resolves the page, because `\V[5]` is substituted exactly once
and capturing before that stores the reference instead of the number — which is
then unrecoverable. The speaker is detected, never assumed: a name box where
the build has one, otherwise a short `Name:` opener, and only once enough pages
agree, so one page reading `Warning:` does not lose the word.

**Long values stopped breaking the layout.** A row's right-hand side does not
shrink, which is right for a button and wrong for a path — an absolute path
pushed the label out of the row and was then clipped, so neither half could be
read. Seven copies of the same helper had it. There is now a path widget that
elides from the middle by measurement, keeps the whole value on the element for
the tooltip and the clipboard, and offers a copy button; and the same bug
arriving from the other side — a control squeezing its own label down to
`Fir...` — is now measured across every label in every sidebar.

**Control copy was cut back.** 178 tooltips and notes were shortened or
removed. What was never removed is any statement of why something cannot work,
is destructive, is session-only or cannot be undone: 27 proposed cuts were
refused on exactly that ground.

### Defects fixed in 2.1.0

Five were in the harness, and each one made a new panel untestable or, worse,
testable and wrong:

- `$gameMap._events` was a dense array where both engines build a sparse one
  indexed by event id, so `event(1)` returned the second event
- map events never ran `initMembers` or received a `_mapId`, so no event had a
  trigger or an interpreter and every self-switch key read `undefined,1,A`
- `JsonEx` copied instead of marking in place and stripped the class tag,
  hiding that one engine cleans those marks off after `stringify` and the other
  leaves them on the live object permanently
- `Game_Actor.refresh` skipped `releaseUnequippableItems`, which is the entire
  mechanism behind a class change stripping gear the new class cannot hold
- `maxLevel` returned a constant instead of the actor's own row

Five were in the mod:

- a disabled control was greyed but still ran its handler when clicked in code
- a remembered sub-tab was stored under a tab id that stopped existing when
  eleven tabs became six, so one button had been a silent no-op since
- the log ring held 400 entries and silently pushed the boot report out of
  itself — and that report is the thing a bug report pastes
- `onFrame` kept no record of the function its caller handed over, so removing
  a hook that had been wrapped for timing would have quietly missed
- the clipboard helper let a rejected write become an unhandled rejection

**A correction to the documentation.** Writing 550 engine stubs by copying from
both shipped engine sources disputed a line in the delta table:
`Game_Interpreter` was recorded as "materially compatible", which is true of
the event-command codes and false of the interpreter's own fields. `_params`
exists on one engine only; one keeps a resolved character object and the other
an id; one holds a single reserved common event and the other a queue;
`autorunCommonEvents` exists on one and not the other. Eight divergences, now
written down.

**The module count is no longer written down anywhere it can go stale.** It was
a literal 26 in ten places across two test suites, and every one of those was
somewhere a newly added module could be missing without a check going red.
`manifest.json` is the one list and everything reads it.

## What 2.0.0 brought

**Runs on MV.** MV 1.6+ as well as MZ 1.0+. Two of the mod's hooks were not
merely broken on MV but fatal: MV's `SceneManager.updateMain` contains
`renderScene()` and `requestUpdate()`, so the animation-frame chain perpetuates
itself from inside the function — the pause hook's early return terminated the
loop permanently and hard-hung the game, and the speed hook's repeated call
scheduled an exponentially growing pile of frames. Both gate the per-step
functions instead, and the capability table refuses to let anything wrap
`updateMain` where it is not safe to.

**A capability table instead of version checks.** At boot the mod probes what
this build can actually do and every panel asks a capability rather than a
version. Debug → Environment shows the whole table and is meant to be pasted
into a bug report.

**Per-game profiles, none of them required.** The Forge's id bases are computed
from the loaded database and persisted, so they cannot collide with a game's
own content. Section-header conventions are detected. Hotkey defaults are
derived from the keys the game's own plugins have already claimed. A useful
profile can be five lines — see `profiles/README.md`.

**A boot index.** Built in the background, never blocking boot. The governing
rule is that **the index is for finding, never authority**: every read and
write still goes to the live game objects, and a query returns candidates the
caller re-resolves.

**A plugin-compatibility layer.** Every mutating control writes and then reads
back; when the value does not stick, the mod names the likely culprit from the
loaded plugin list and marks that control degraded with a visible reason
instead of pretending it worked.

## Testing

| Suite | Checks |
|---|---|
| Stock MZ 1.9 | 1271 |
| Stock MV 1.6 | 1285 |
| MV with a modelled third-party plugin stack | 1314 |
| Installer, against nine `plugins.js` shapes | 121 |
| Build lint over all 37 files | — |

The harness stubs are copied from the shipped engine source and annotated with
the line they came from, including the awkward parts. That discipline earned
its keep again this release: 550 symbols copied that way found eight engine
divergences the project had recorded as compatible, and five places where the
harness had been describing an engine it does not have.

A module's checks live beside it in `gigahack-test/checks/<module>.js`, handed
the same context the runner builds, so a check written there is
indistinguishable from one written in the runner — and a file that throws costs
one check rather than taking the run down.

**Not verified live.** 2.0.0 was checked against two real games — **A New Dawn
5.3.2** (MV 1.6.1) and **Star Knightess Aura** (MZ 1.9.0) — and those figures
were measured before these nine modules existed. `verify-live.js` ships in the
archive and runs that check on your own install; running it is worth doing
before trusting this release on a save you care about. Two of the new panels
touch things a harness cannot model honestly: **Capture** writes a PNG through
NW.js, and **Game Keys** rewrites `Input.keyMapper` — its refusal rule is
checked, but the refusal has never been felt on a real keyboard.

## Compatibility

MV 1.6+ and MZ 1.0+. MV 1.6 ships NW.js 0.29 on Chromium 66, which is the floor
the overlay's stylesheet is written to — no `gap`, no `clamp()`, nothing past
that line, and the build lint fails on a violation. Older MV is progressively
worse and is not supported.

Browser and web-deployed builds work, with everything that needs a filesystem
unavailable and saying which precondition failed.

## Relationship to GigaHack 1.0

[GigaHack-SKA](https://github.com/GigaLionF95/GigaHack-SKA) is unchanged and
still works. It is Star Knightess only. This project is separate and does not
replace it; if you play that game and are happy with 1.0, there is no reason to
move.

MIT licensed; see [`NOTICE.md`](NOTICE.md) for what that covers. RPG Maker is a
product of Gotcha Gotcha Games and KADOKAWA, and this is an unofficial,
unaffiliated tool that redistributes none of their engine source.
