# GigaHack MV/MZ 2.0.0

A mod menu for **any RPG Maker MV or MZ game**.

GigaHack 1.0 was a menu for one game, delivered through that game's own mod
loader. This is a separate project: the same menu, rebuilt so that nothing
assumes the engine version, the install layout, the game's content, or which
other plugins are present. Where something genuinely cannot be known
generically it moves into an optional per-game profile; where something cannot
work at all on a given target, the mod says what is missing rather than
misbehaving quietly.

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

- `js/plugins/GigaHack_*.js` — 26 new files
- `js/plugins.js` — 26 entries appended **at the end**
- `js/plugins.js.gigahack-backup` — the original, kept

`--uninstall` restores that file byte for byte. `--verify` checks an install
without changing anything. `--dry-run` shows what would change.

The entries go at the end because every GigaHack alias has to be outermost: a
plugin loading after us wraps our hooks and can undo what the menu does. The
mod re-checks this at runtime and says so when a game update has changed it.

## What is new since 1.0

**Runs on MV.** MV 1.6+ as well as MZ 1.0+. This turned out to be more than a
porting exercise — two of the mod's hooks were not merely broken on MV but
fatal. MV's `SceneManager.updateMain` contains `renderScene()` and
`requestUpdate()`, so the animation-frame chain perpetuates itself from inside
the function: the pause hook's early return terminated the loop permanently and
hard-hung the game, and the speed hook's repeated call scheduled an
exponentially growing pile of frames. Both now gate the per-step functions
instead, and the capability table refuses to let anything wrap `updateMain`
where it is not safe to.

**A capability table instead of version checks.** At boot the mod probes what
this build can actually do — `ColorManager`, `Sprite_Gauge`, the save format,
the window internals, the CSS floor, whether there is a filesystem — and every
panel asks a capability rather than a version. A version string is a proxy that
goes wrong the moment a plugin adds or removes the thing you care about, which
on a modded game is most of the time. Debug → Environment shows the whole table
and is meant to be pasted into a bug report.

**Per-game profiles, none of them required.** The Forge's id bases are computed
from the loaded database and persisted, so they cannot collide with a game's
own content (they independently reproduced 1.0's hand-tuned numbers for Star
Knightess). Section-header conventions are detected. Hotkey defaults are
derived from the keys the game's own plugins have already claimed. A profile
adds knowledge the engine cannot supply — which variables matter, a Steam app
id, how to reach a feature one of the game's plugins provides — and a useful
one can be five lines. See `profiles/README.md`.

**A boot index.** Built in the background, never blocking boot, chunked through
idle time. It indexes database names, variables and switches, the map tree,
asset folders, and — the expensive one — every event on every map, which
unlocks "find every event that touches switch 42", a question the engine cannot
answer because it loads one map at a time. The governing rule is that **the
index is for finding, never authority**: every read and write still goes to the
live game objects, and a query returns candidates the caller re-resolves. That
one constraint removes the entire "the cache said X, the game had Y" bug class.
Debug → Index shows what each stage cost and can benchmark indexed against
unindexed, so a stage that does not earn its place can be retired on evidence.

**A plugin-compatibility layer.** Every mutating control writes and then reads
back; when the value does not stick, the mod names the likely culprit from the
loaded plugin list, says what it did, and marks that control degraded with a
visible reason instead of pretending it worked. It recognises the big plugin
suites and attaches real consequences, snapshots the identity of every method
it hooks so it can tell you when something patched on top, checks its own load
order, and ships ten live self-tests that run against the running game rather
than a harness.

**Gone:** the Inspect module (shipped disabled in 1.0 and depended on MZ-only
window internals). **Rebuilt:** Steam now enumerates achievements from the
platform API instead of carrying a table of one game's 51, which means it works
on games nobody has written a profile for. **Enabled:** random encounter
control, which 1.0 shipped off because one game had no encounters; it now
probes at boot and hides itself only when the game really has none.

## Testing

| Suite | Checks |
|---|---|
| Stock MZ 1.9 | 360 |
| Stock MV 1.6 | 371 |
| MV with a modelled third-party plugin stack | 400 |
| Installer, against nine `plugins.js` shapes | 101 |
| Build lint over all 27 files | — |

The harness stubs are copied from the shipped engine source and annotated with
the line they came from, including the awkward parts. That discipline earned
its keep again this release: the 1.0 harness stubbed `Utils` as an object
literal, but both engines declare it as `function Utils() { throw ... }` — so a
`typeof Utils === 'object'` test in the mod silently failed on every real game
while every harness check passed. The stub is now a function, and two checks
pin it.

Verified live against two real games: **A New Dawn 5.3.2** (MV 1.6.1, 56
enabled plugins — 52 of 53 hooks install, the one skip being a method MV does
not have, and it says so) and **Star Knightess Aura** (MZ 1.9.0, 142 plugins —
49 of 49). `verify-live.js` ships in the archive and runs that check on your own
install.

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

MIT licensed.
