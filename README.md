# GigaHack MV/MZ

A mod, cheat and debug menu for RPG Maker games. It installs into any RPG Maker
MV or MZ game as an ordinary set of plugins, opens over the game as a DOM
overlay, and edits the running game through the engine's own public API.

It works on any MV 1.6+ or MZ 1.0+ game. Nothing in it is written for a
particular title: ids are discovered from the loaded database, engine
differences are asked for as capabilities rather than read off a version
string, and everything a game can be that the mod cannot handle is reported by
name rather than left to fail quietly.

35 plugin files, about 51,100 lines, six tabs, 62 panels. MIT licensed; see
[`NOTICE.md`](NOTICE.md). RPG Maker is a product of Gotcha Gotcha Games and
KADOKAWA — this is an unofficial, unaffiliated tool.

---

## Install

Three entry points, one per platform. Each does the same thing.

| Platform | Run |
|---|---|
| macOS | `install/gigahack-install.command` (double-click) |
| Windows | `install/gigahack-install.bat` (double-click) |
| Linux | `install/gigahack-install.sh` |

With no arguments the installer looks for RPG Maker games in the current
folder and its parent, including `www/` web-deploy layouts and macOS
`.app/Contents/Resources/app.nw` bundles, and offers what it finds. Pass a
path to skip discovery. A folder counts as a game when it holds `index.html`,
`js/plugins.js` and `js/plugins/` together, and the engine is read from which
core file is present (`js/rpg_core.js` for MV, `js/rmmz_core.js` for MZ).

It touches exactly three things:

- `js/plugins/GigaHack_*.js` — the module files named in `manifest.json`, copied in, mode 644.
- `js/plugins.js` — one entry per module appended at the end, between marker comments.
- `js/plugins.js.gigahack-backup` — a copy of the original, written once on
  the first install and never overwritten afterwards.

Nothing else is written, ever.

**It edits `js/plugins.js`, and it has to.** Every GigaHack hook is an alias:
it saves the engine's original method and calls it. A plugin that loads after
GigaHack wraps GigaHack's alias, sits between the caller and everything the
mod does, and can intercept or undo it. Being the last entry in `js/plugins.js`
is what makes GigaHack's aliases the outermost ones. The installer appends
rather than prepends for that reason, and the mod re-checks at runtime —
Debug → Compatibility names every plugin that loaded after it, and prints the
file to move the entries back to when a game update has rewritten the list.

Other flags:

```sh
./gigahack-install.sh --verify     # check an install, change nothing
./gigahack-install.sh --dry-run    # print what would change
./gigahack-install.sh --uninstall  # remove the module files, restore plugins.js
```

`--uninstall` deletes those module files and copies the backup back over
`js/plugins.js` byte for byte, then deletes the backup. Where no backup
survives it strips the marked block instead, including the comma that
separated it — a bare comma there is a legal array literal with a hole in it,
and PluginManager throws on the `undefined` during boot.

The Windows `.bat` is a two-line launcher for `gigahack-install.ps1` with
`-ExecutionPolicy Bypass` applied to that one invocation; it changes nothing on
the machine, and without it the default policy refuses a downloaded `.ps1` and
closes the window with no message.

---

## What it does

Six tabs. This is the summary; `docs/FUNCTIONS.md` is the complete list, panel
by panel and control by control.

**Player** — noclip, ghost-past-events, move speed, player opacity, a one-slot
position mark and recall, game speed with frame stepping, per-actor level, EXP,
HP/MP/TP, a decomposed parameter editor, skills, states, equipment, name,
nickname, profile and the three image slots, plus god mode, free skill costs
and a damage multiplier. A whole kit — class, level, skills, parameter bonuses
and every equipment slot — saves under a name and goes back in one click, as one
undo entry rather than eight. Splits driven by the game's own state turn a run
timer into something that knows what the game is doing. Random encounters get
their own panel on games that have them.

**World** — variables and switches with a live change monitor, freeze, pinning
and a snapshot diff; a value scanner that narrows by "increased"/"decreased"
across rounds; bulk range writes; self-switches per event; a map tree with
safe-landing teleport and named bookmarks; an in-scene event overlay with an
inspector and command-list decoder; and a cross-map search for every event in
the game that touches a given switch, variable or self-switch. Watchpoints go
one step further and name the map and the event that made a write, which the
engine keeps no record of. A save-anchored baseline answers "what did that
cutscene actually do to my state". For a stuck game there is Blocked, which
lists every unmet page condition on an event and names every event anywhere
that could set it; the project's own common events, readable and runnable; and
a searchable dump of every line of text the game can show. Games whose switch
names use a section-header convention also get a Gallery panel for bulk unlocks
by collection, and objectives reconstructed from the project's own flag naming.

**Items** — items, weapons and armors with live per-item stack caps, gold with
its live cap, per-entry locks that refuse the game's own `gainItem`, and the
Forge: an editor that writes custom rows into ten `$data*` arrays at computed,
stable ids. A shop opener builds a goods list from anything in the database and
pushes the game's own shop scene with it.

**Game** — a live enemy inspector with editable HP and parameters, weaknesses,
state rates and drops; instant win and instant lose that go through the game's
own end-of-battle handling; a troop picker; HP/MP bars over enemies;
auto-advance, hold-to-turbo and message injection; font and text-colour
overrides; a searchable history of everything that has been said, recorded by
GigaHack itself so it works on any game, with the choices made and where each
line was said. Games with a backlog of their own can show that instead, and
games with a Steam binding get an achievements panel. Everything `$gameScreen`
holds — tint, weather, zoom, shake, brightness and all hundred picture slots —
is visible and writable, which is how a screen a crashed cutscene left black
gets unstuck. The audio the project ships can be auditioned folder by folder,
and its image folders browsed, previewed and animated frame by frame.

**Debug** — environment and capability report, installed hooks, loaded plugins
and their parameters, compatibility, index status, save slots, save file
transfer and a read-only diff between two of them, backups, an embedded
JavaScript console and the log. Plus what the engine will not tell you itself:
every running interpreter and the five named reasons a game freezes; a
chronological journal of every change the mod made, with whether it stuck and
undo-back-to-here; every random roll with the caller that asked for it, and a
seeded generator so a drop can be rolled again; triggers that run a saved
snippet when the game reaches a state; clean screenshots with the overlay
hidden; and what this build costs to run, per frame hook.

**Settings** — appearance, read-only mode, confirmation and backup guards,
GigaHack's own hotkeys, the game's own key map — editable for games that ship no
rebinding, and refusing any edit that would leave no way back to a menu — and
named settings profiles that can be exported and imported as JSON.

---

## How it adapts to your game

Four mechanisms, each with its own section in `docs/FUNCTIONS.md`.

**The capability table.** `GigaHack.caps` is probed once at load: engine, PIXI
version, Chromium version, whether there is a filesystem, which save extension
this is, whether `SceneManager.updateMain` is safe to gate, whether `gap` and
`clamp()` are available in CSS, and so on. Every entry that answers "no"
carries the reason with it. Nothing in the mod branches on
`Utils.RPGMAKER_VERSION` — a version string is a proxy for a capability, and it
is wrong the moment a plugin adds or removes the thing you actually care about.
Debug → Environment prints the whole table.

**Profiles.** A profile is per-game knowledge the engine cannot supply: which
variables to pin by name, a Gallery filter, a Steam app id, or an adapter that
teaches GigaHack about a feature one of the game's own plugins provides. A
profile is never required and never makes a game possible that would otherwise
be unsupported — every field has a value computed from the loaded database, and
a useful profile can be five lines long. One ships in `gigahack/profiles/`, for
Star Knightess Aura; the installer does not add profiles automatically, because
a profile is a claim about one specific game and installing it on the wrong one
fails quietly. See `gigahack/profiles/README.md`.

**The boot index.** A background pass over the project's map files, built
chunked through `requestIdleCallback` so it never blocks boot. It answers
questions the engine cannot — the engine loads one map at a time and keeps no
record of the others — but it is only ever a source of candidates, never
authority: every hit is re-resolved against live `$data*` before it is shown or
acted on. Every query returns `{candidates, complete, why}`, and a query that
could not see everything says so in the panel rather than returning a short
list that looks complete.

**The compatibility layer.** Every mutating control writes, reads back, and
compares. A write that did not stick is reported once, the likely culprit is
named from a table of recognised plugin frameworks, and the control is marked
degraded for the session — marked, not disabled, because the cause may have
gone away and the only way to find out is to let you try again. The same layer
checks load order, snapshots the identity of every method GigaHack hooks so it
can tell you when something re-aliased on top, and runs live self-tests against
the running game.

---

## When something does not work

The mod is built so that anything it cannot do says so by name. There are four
places to look, in this order.

**Debug → Environment** is the paste-into-a-bug-report artefact. One button
copies engine, host, renderer, the whole capability table with a reason on
every "no", and the resolved paths, as plain text. A screenshot of a panel
loses the long "why" strings; this does not, and it needs neither a writable
disk nor a working overlay renderer to be useful. From the console it is
`GigaHack.caps.reportText()`, and `GigaHack.api.diagnose()` returns the same
material plus load order, recognised frameworks, the degraded list and index
status as one object.

**Debug → Compatibility** answers four questions. Are GigaHack's aliases the
outermost ones, and if not, which plugins loaded after it and which file to
move the entries to the end of. Which recognised plugin suites are present,
and the named consequence of each. What has failed a write-back this session,
and why. And what the game says right now when the self-tests actually try:
each one writes a sentinel and reads it back, and restores what it touched.

**Debug → Index** says what the index holds, what each build stage cost, and —
under Notes — every stage that could not run and why. Those note strings are
the same ones a panel shows when a search comes back incomplete.

**Debug → Plugins** lists every module this build expects against what is on
disk and what actually ran, as four separate yes/no columns. It distinguishes a
file that is missing from a file that is present but unreadable by the game
process — `existsSync` needs only directory permission, so a mode-600 file
reports present, sized and checksummed while every read fails and the module
silently does not exist. Where that happens it prints the `chmod` that fixes
it.

Offline, without launching the game:

```sh
node gigahack-test/verify-live.js /path/to/the/game
```

This loads the game's real engine core, its real `plugins.js` and its real data
files under Node, loads GigaHack on top, and prints which profile matched, what
it resolved, and every hook that installed or was skipped with the reason. It
is the tool for "the menu does not open at all", where nothing inside the game
can report anything.

---

## Building and testing

There is no build step. The plugin files are the deliverable.

```sh
cd gigahack-test
npm install                # playwright, once

npm run lint               # build lint, 35 modules + 1 shipped profile
npm test                   # stock MZ 1.9.0        — 970 checks
npm run test:mv            # stock MV 1.6.1        — 981 checks
npm run test:mv-modded     # MV + modelled plugins — 1010 checks
npm run test:all           # lint plus all three
```

```sh
./test-installers.sh       # 113 installer checks
```

Exit code is the contract: 0 clean, 1 any failure. The three engine runs share
one set of stubs and differ only in which engine surface is loaded; the modded
run adds a stack of seven modelled third-party plugins — a framework that
overwrites `maxGold`, `maxItems` and `paramMax` without aliasing, a
fast-forward plugin, an image-cache plugin, a save-location redirect, a
circular-reference save encoder, two plugins that claim the letters GigaHack
would otherwise pick for its hotkeys, and one deliberately absent from the
quirks table so the "nothing I recognise is responsible" branch is covered too.

The stubs are behavioural models written from the engines and annotated with
the file and line each was learned from, so any of them can be checked against
a real build. No engine source is redistributed — see
[`gigahack-test/stubs/README.md`](gigahack-test/stubs/README.md) for what is
reproduced exactly and why, and what is not, and [`NOTICE.md`](NOTICE.md) for
what the licence covers and what it does not.

The lint enforces the rules the codebase is held to: no prototype assignment
that does not go through `$.install`, no CSS or JS above the Chromium 66 floor,
and no game-specific coupling outside `gigahack/profiles/`. The installer suite
parses the resulting `plugins.js` rather than grepping it — a malformed one is
a red screen on next launch, or worse, a game that boots normally with the menu
silently absent.

Verified live against two real games:

- **A New Dawn 5.3.2** (MV 1.6.1, 66 plugin entries, 56 enabled) — all six
  engine files load, 26/26 modules, 52/53 hooks install (measured before the
  nine modules added after 2.0; both games are due a re-run). The one skip is
  `Scene_File.isSavefileEnabled`, which does not exist on MV; the mod records
  it as skipped with that reason, and the Saves panel says the per-slot
  restriction is not something this build has.
- **Star Knightess Aura** (MZ 1.9.0, 168 plugin entries) — 26/26 modules,
  49/49 hooks.

On A New Dawn the compatibility layer independently recognised nine plugin
frameworks, including Yanfly Core Engine (flagged as affecting parameters, gold
and item caps), a CircularJSON save encoder, an aggressive image-cache plugin,
a fast-forward plugin, and two save-location overrides — none of which it was
told about. The computed Forge id bases on Star Knightess came out at item 1001
and skill 2001, reproducing the hand-tuned values the 1.x version used for that
game without being given them.

---

## Compatibility

RPG Maker MV 1.6 and later, and MZ 1.0 and later.

**The CSS floor is Chromium 66.** MV 1.6 ships NW.js 0.29, which is Chromium
66; older MV is worse. An unsupported CSS value is not a soft failure — it
invalidates the whole declaration, and for a custom property it invalidates
every rule that reads it, so the overlay collapses rather than degrading. The
stylesheet therefore uses margins instead of flex `gap` (Chromium 84), fixed
values instead of `min()`/`max()`/`clamp()` (79), and derives its accent shades
in JavaScript instead of `color-mix()` (111). `:is()`, `:where()`,
`aspect-ratio`, `inset`, logical properties and `:has()` are not used at all.
The test suite fails the build if any of them appears.

**Browser and web deploys work**, with everything filesystem-dependent degraded
and stated. Settings fall back from JSON files on disk to `localStorage` to an
in-memory map, and Debug → Environment says which one is in use. Save backups,
save export and import, the index's cross-map and asset stages, and the image
pickers that enumerate `img/` folders all need a filesystem; each reports its
absence with a reason rather than appearing and doing nothing.

**Other plugins.** GigaHack has been run against games carrying 168 plugin
entries. Nothing it does replaces an engine method outright; every hook is an
alias, and every one is listed in Debug → Hooks with an unpatch button where
removal is safe. It never adds an entry to `Input.keyMapper` — games commonly
ship key-rebinding menus that enumerate that map and present whatever they find
as one of the game's own controls — so its hotkeys are bound at the DOM in the
capture phase and stay entirely separate from the game's.

---

## Relationship to GigaHack 1.0

GigaHack 1.0 is a separate repository. It was an MZ-only menu for one game,
Star Knightess Aura, delivered through that game's own mod loader, and it
assumed that game's engine version, install layout, content ids and plugin
list throughout.

This is a rewrite, not a port with a compatibility layer. Everything that was a
constant about one game is now derived, detected or computed: Forge id bases
from the loaded database, hotkey defaults from the keys the running game leaves
free, the section-header convention from the project's own names, Steam
achievements from the platform API, and delivery layout from where the script
finds itself. Where knowledge genuinely cannot be computed it moves into an
optional profile.

1.0 remains available and is frozen. It is not upgraded to by this installer,
and the two do not share a settings file.
