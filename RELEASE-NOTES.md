# GigaHack MV/MZ 2.1.0

A mod menu for **any RPG Maker MV or MZ game**.

GigaHack 1.0 was a menu for one game, delivered through that game's own mod
loader. This is a separate project: the same menu, rebuilt so that nothing
assumes the engine version, the install layout, the game's content, or which
other plugins are present. Where something genuinely cannot be known
generically it moves into an optional per-game profile; where something cannot
work at all on a given target, the mod says what is missing rather than
misbehaving quietly.

2.1.0 adds twenty-one features across nine modules, roughly doubling the
codebase, and fixes ten defects — five of them in the test harness, which had
been quietly telling the suite things about the engines that were not true.

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

- `js/plugins/GigaHack_*.js` — 35 new files
- `js/plugins.js` — 35 entries appended **at the end**
- `js/plugins.js.gigahack-backup` — the original, kept

`--uninstall` restores that file byte for byte. `--verify` checks an install
without changing anything. `--dry-run` shows what would change.

The entries go at the end because every GigaHack alias has to be outermost: a
plugin loading after us wraps our hooks and can undo what the menu does. The
mod re-checks this at runtime and says so when a game update has changed it.

**Upgrading from 2.0.0** is the same install. Both installers find their own
block by a version-agnostic marker, so the 26-entry block is replaced rather
than joined by a second one, and your `settings.json` is migrated forward. The
one thing to know is that nine new module files appear beside the old
twenty-six; `--uninstall` removes all of them.

## What is new in 2.1.0

**Nine new modules, twenty-two new panels**, bringing the menu to 67. Four of them publish services the
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

### Defects fixed

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
| Stock MZ 1.9 | 970 |
| Stock MV 1.6 | 981 |
| MV with a modelled third-party plugin stack | 1010 |
| Installer, against nine `plugins.js` shapes | 113 |
| Build lint over all 36 files | — |

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
