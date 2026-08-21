# GigaHack MV/MZ — what it can do

The complete list. Organised the way the menu is: six tabs, each with its
panels, each panel with its controls. Where a control can be unavailable, this
says what makes it unavailable and what the mod says instead.

Four panels are conditional and only appear on games that have the thing they
are for: **World → Gallery**, **Player → Encounters**, **Game → Backlog** and
**Game → Achievements**. Each section says what the test is.

---

## How to read this

Three things are worth knowing before the list, because they show up on nearly
every control.

**A greyed control with a named reason is a feature, not a gap.** When
something cannot work on this build, the mod shows the control, disables it,
and prints the reason next to it. "The font control does nothing" is a bug
report nobody can act on; "this build has no single place where the main font
is decided, so the font overrides would have to be applied per window and are
off instead" is one they can.

**A degraded control is marked, not disabled.** Every mutating control writes,
reads back and compares. When a write does not stick, the panel says so, names
the likely culprit from the recognised-plugin table, and marks that control
degraded for the session — but leaves it usable, because the cause may have
gone away (a plugin's own state changed, a reload) and the only way to find out
is to let you press it again. Every degraded control carries a "try again"
button that clears the mark so the next write is re-tested from scratch.

**Three global guards apply everywhere**, all under Settings → Behaviour:

| Guard | What it does |
|---|---|
| Read-only mode | Refuses every write to game state. Viewers, tables and overlays stay live. Controls the gate will actually refuse are dimmed; ones that still work are not. |
| Confirm dangerous actions | Danger-styled buttons arm on the first click and fire on the second, showing what they are about to do. They disarm after 2.6 seconds. |
| Back up the save first | Copies the save files before teleports, forced events, forged-troop battles and bulk edits. |

A separate **undo stack** covers simple edits — variables, switches,
self-switches, bulk range writes, gold, item counts, actor parameters, level,
EXP, HP/MP/TP, skills, states, equipment, party membership, enemy HP and
parameters, event position, playtime, save count, backlog size, and applying or
deleting a settings profile. Teleports, forced events, class changes, Forge
injections, kills and bulk inventory actions are irreversible and say so; the
save backup is the way back from those.

Some settings are **deliberately not restored at launch**, however they were
left: the event overlay (`events.on`) and the enemy bars (`battle.bars.on`).
Both paint into the running game, and finding one already on after a crash is
worse than losing the setting.

---

## Getting in and out

### Hotkeys

Bound at the DOM in the capture phase, matched against `KeyboardEvent.code`.
GigaHack never adds an entry to `Input.keyMapper` — games commonly ship
rebinding menus that enumerate that map and present whatever they find as one
of the game's own controls, and a rebind pass there could hand our key away.
All of these are rebindable under Settings → Hotkeys.

| Bind | Default | What it does |
|---|---|---|
| Toggle menu | `N` | Opens and closes the window. Cannot be cleared — it is the only way back in. |
| Watch panel | `M` | Shows or hides the floating watch panel. Works with the menu closed. |
| Panic hide | `Delete` | Hides the window, the watch panel and every toast instantly. |
| Quick save | `Y` | Writes the quick-save slot immediately, mid-cutscene included. |
| Quick load | unbound | Reloads the quick-save slot. Unbound on purpose: a mis-hit discards everything since. |
| Noclip | `V` | Walk through walls and events. |
| Ghost | unbound | Stop setting off touch events. Unbound: a stray press changes how the map behaves. |
| God mode | `G` | Party HP never drops below 1. |
| Force an encounter | `F` | The next step starts a fight. Only registered on games with encounters. |
| Random encounters | unbound | Toggles them off and on. |
| Mark this position | unbound | Overwrites the single quick position slot. |
| Recall the marked position | unbound | Teleports back to it. Unbound: a stray press moves you. |
| Run snippet *(one per saved snippet)* | unbound | Runs a console snippet by name. |

**Escape** closes the topmost popup, then the menu, and is left to the game
when GigaHack is closed. Escape inside one of GigaHack's own text fields leaves
the field and goes no further.

The defaults above are the **fallback**. On first run they are derived: the mod
reads `Input.keyMapper`, subtracts everything the engine and the game's own
plugins have already claimed, and takes the first free key from a preference
order. A bind whose fallback letter is taken ships unbound and logs why, rather
than fighting the game for a key. Only binds the settings file has never
mentioned may move — a key you chose is yours, including one you deliberately
cleared. Where `Input.keyMapper` cannot be read at all, the derivation is
skipped and the fallback letters stand, with a warning saying so.

Rebinding refuses a key one of GigaHack's own binds already holds, because the
keydown handler returns on the first match and a second bind on the same key is
not ambiguous, it is dead. Binding a key the *game* claims is allowed, and
warns once: GigaHack sees the key first, so what is lost is the game's action
on it.

### The window

| Control | What it does |
|---|---|
| Tab strip | Six tabs. Falls back to icons only when the window is too narrow for a legible label; the label moves into the tooltip. |
| Sub-tab strip | The panels of the current tab. Which tab and sub-tab you were on is remembered between sessions, as is each panel's scroll position. |
| Pin | Keeps the window in place while the game runs. |
| Opacity | Cycles 100 / 80 / 55 %. |
| Close | Hides the window; the toggle key brings it back. |
| Drag / resize | Titlebar drags, the corner grip resizes. Position and size are remembered. |
| Log drawer | Collapsible strip at the bottom of the window carrying GigaHack's own log. Open-at-start is a setting. |
| Footer | Toggle and watch keys, FPS, current map and coordinates, and the count of active cheats. |

The overlay is click-through everywhere it is transparent, so the game canvas
still receives input where no widget is drawn.

### The watch panel

A small floating box, draggable, shown with its own hotkey and independent of
the main window. It shows pinned variables and switches when anything is
pinned, and otherwise falls back to map id, player x,y, gold, party size and
current scene. Providers are registered by priority and the first non-empty one
wins, so pinning something replaces the fallback readout automatically.

### The active-cheats HUD

A corner list of everything currently switched on — god mode, free costs,
damage multiplier, enemy bars, event overlay, noclip, auto-advance, turbo,
recording, read-only, paused. Toggleable under Settings → Interface.

---

## Player

### Movement

| Control | What it does | Unavailable when |
|---|---|---|
| Noclip | Walls, events and anything a plugin has made impassable stop mattering. The map edge still does — walking off it would put every tile lookup out of bounds. | — |
| Ghost past events | Touching an event no longer sets it off. The action button still works, so you can still talk to people deliberately. | — |
| Override move speed | Enables the speed slider. | `Game_CharacterBase.realMoveSpeed` could not be hooked; the reason is printed. |
| Speed (1–10) | The engine moves 2^speed/256 tiles per frame, so this is exponential: 4 walks, 5 dashes, 8 is a whole tile per frame — fast enough to outrun the map scroll and skip tiles that would have triggered something. | Override off. |
| Always dash | Writes the game's own `ConfigManager.alwaysDash`, the same switch as its Options menu. GigaHack keeps no second copy. | `ConfigManager.alwaysDash` not found in this build; the panel says so. |
| Player opacity | 0–100 %. Saved with the character, so a save made while invisible stays invisible. | — |
| Reset to fully visible | Restores opacity and transparency. | — |
| Here | Current map id, name and coordinates. | — |
| Mark / Recall | One position slot, overwritten each time. Named places live in World → Places. | Recall is disabled with nothing marked. |
| Override game speed | Runs the engine's game logic more or less often. | The engine could not be gated safely; `P.speedyWhy()` prints the reason. |
| Speed (0.25×–8×) | Everything scales with it — animations, message timing, the encounter counter. Drawing does not: the screen is still painted once per real frame. | Override off, or unavailable. |
| Frame step 1 / 10 / 60 | Runs exactly that many steps of the engine's game logic — input, scene change, scene update — pause or no pause. Drawing is left to the engine, so the step appears on the next painted frame. | `$.step` is absent, i.e. the Hooks module did not load. |
| Pause while this menu is open | The same switch as Settings → Behaviour. | Pause could not be installed; the panel prints what the Hooks module says it could and could not gate. |

Pause on MV never touches `SceneManager.updateMain`. MV's `updateMain` renders
and re-arms its own animation frame from inside itself, so a wrapper that
returns early ends the loop permanently and one that calls the original N times
schedules N frames that each schedule N more. The capability layer detects
which shape this engine has, and pause gates `updateScene`, `changeScene` and
`updateInputData` instead, leaving `renderScene` and `requestUpdate` alone on
every path including the paused one.

### Stats

The actor list on the left is every party member with a live/dead dot and
level; clicking one selects it for all five Player sub-panels. Below it,
**Membership** offers every actor not currently in the party, an "add to party"
button, "remove selected" (replaced by a note on the last member), and a read-back of the
follower line-up on the map so a membership change that did not reach the map
is visible here rather than only in the game.

| Control | What it does | Unavailable when |
|---|---|---|
| Level | Written by moving EXP to the level's threshold, not by `changeLevel`. | Degraded marks `party.exp`. The max is read from `maxLevel()` per actor; where that reports 0 the panel says the game treats it as "no cap" and explains why `changeLevel` cannot be used. |
| EXP | Written with `changeExp`, which moves the level to match. Writing the exp field directly would leave the two disagreeing. Shows the next level's threshold. | Degraded marks `party.exp`. |
| HP / MP / TP | Editable, each with its live maximum next to it. | — |
| Heal / Revive / Heal party | — | — |
| Parameter rows (8) | Each parameter is shown decomposed: **base**, **manual**, **other**, **clamp**, **final**. Manual and final are both editable. | Degraded marks `party.param`. |
| Reset params to base | Clears `_paramPlus` only. Equipment and anything else contributing through `paramPlus` stays, which is what the "other" column is for. | — |
| Raise the ceiling | Session-only `paramMax` raise, composed rather than competing: it returns the larger of the game's own ceiling and yours, so nothing is ever lowered. | The game's `paramMax` could not be hooked; `P.capWhy()` prints the reason. |
| Ceiling | The value the raise uses. Default 9999. | The raise is off or unavailable. |

The decomposition exists because a parameter is not stored anywhere. On both
engines `param()` is recomputed on every read as
`round(clamp((base + plus) × rate × buffRate, min, max))`, and the only durable
write surface is `_paramPlus`. A value above the clamp is discarded on the very
next read — there is no write that makes it stick — so the ceiling is a column
of its own, read live per parameter, and a row at its ceiling is flagged. When
a write is refused for that reason the panel offers to raise the ceiling to the
number you asked for and redo the write, rather than printing a value nobody
asked for.

### Skills

- Searchable list of every skill in the database, with a "known" filter and a
  learn/forget checkbox per row. Icons and descriptions come from the database.
- **Class** group: current class, a dropdown of every class, and "change
  class". Marked irreversible — it rebuilds level and skills from the new class
  curve and gets no undo entry.

### States

- Searchable list of every state, with an on/off checkbox per row.
- **Active** group: the actor's current states, each with "remove", plus "clear
  all states".
- A state the actor resists or has sealed will refuse to apply, with a toast
  saying so.

### Equip

- Slot list on the left, one row per equip slot with its type name and what is
  in it. Clicking a slot filters the right-hand list to what fits it.
- Searchable candidate list showing each item's parameter deltas, with "equip".
- "Unequip this slot".
- You do not need to own the item, and slot seals are ignored.

### Identity

| Control | What it does | Unavailable when |
|---|---|---|
| Name | The same call the engine's own "Change Name" command makes. Saved with the game. Enter commits. | — |
| Nickname | Same. | — |
| Profile | Two-line free text; committed when the box loses focus. The status window draws two lines, more are stored but not shown. | — |
| Face file + index | Index 0–7: a face sheet is 4 across and 2 down. | — |
| Map sprite file + index | The player is refreshed immediately, so a change to the lead actor shows on the map now. Index is ignored on a sheet whose name starts with `$`. | — |
| Battler file | Side-view only; a front-view battle never draws it. | — |
| Back to the database | Resets name, nickname, profile and all three images. | The actor has no row in `$dataActors`, which the panel states. |
| Rescan the image folders | Clears the cached folder listing. | — |

Each image field is a **dropdown when the folder could be read and a free text
box when it could not**, so a browser build costs discoverability and nothing
else — both paths write the same string. Each field is tagged "edited" when it
differs from the database row. All four images live on the actor and therefore
in the save, which is why every one of them has a reset next to it: an actor
wearing a sprite that no longer exists renders as a blank square with no clue
why.

### Survival

The same three controls as Game → Actions, reading the same state — registered
twice rather than duplicated, because they are things you reach for while
playing rather than while looking at a troop. See **Game → Actions** for the
detail.

### Encounters *(only where the game has random encounters)*

Registered when the boot index finds a non-empty encounter list on at least one
map. Where there is no index — a browser build, an encrypted deploy, no
filesystem — the question cannot be answered for the whole game, so it falls
back to the only map the engine will tell us about, re-checks on every map
load, and the panel says which of the two answers it is showing.

A game whose fights are all started by events cannot produce a random encounter
at all: with an empty encounter list `makeEncounterTroopId` finds a weight sum
of zero, `$dataTroops[0]` is null and `executeEncounter` bails. Controls for
disabling, rescaling or forcing something the engine will never do are not a
harmless extra, so on such a game there is no panel and no hotkeys.

| Control | What it does |
|---|---|
| Turn them off | `canEncounter` returns false — the same lever the "Change Encounter" event command pulls — *and* `executeEncounter` is gated, because `canEncounter` only stops the counter running down and does nothing about a counter already at zero. |
| Override the rate | Enables the rate slider. Disabled while encounters are off. |
| Rate (0–400 %) | Scales how fast the step counter runs down. |
| Steps to the next | Live readout, updated on the mod's own frame tick so it stays correct under a game-speed multiplier. |
| Force one | Starts an encounter now. |
| Re-roll the count | Rolls a new step counter. |
| Troop id | 0 leaves the map's own table alone. Anything else replaces every random encounter on every map with that troop, and the panel warns that it has. An id no troop uses is called out in red and the map's own table is used instead. |
| This map | Map name and id, encounter step, whether encounters are enabled, whether the party blocks them, and how many maps elsewhere have tables (or that this is not knowable here). |
| Troops here | The current map's encounter list with each entry's weight. |

---

## World

### Variables / Switches

Two panels with the same shape. Rows are grouped into collapsible sections when
the project's names use a header convention; a project with no convention gets
a single "Ungrouped" section rather than an empty panel.

| Control | What it does |
|---|---|
| Search | By name or id. Backed by the index where it can answer; where it cannot, the linear scan does the same job and the index's own reason is printed above the table. |
| `named` filter | Hide entries the project never named. |
| `non-zero` / `enabled` filter | Only entries with a value. |
| `changed` filter | Only rows the monitor has seen change this session. |
| `pinned` filter | Only pinned rows. |
| Clear filters | Filters persist between sessions, so this is how you get back to everything. |
| Expand all / Collapse all | Section state persists. |
| Value cell / ON checkbox | Editable in place. Degraded marks `vars.set` / `switches.set`. |
| ★ pin | Sends the row to the watch panel and the sidebar. |
| ❄ freeze | Holds the value against the game: the monitor writes it back whenever anything changes it. Session-only. Where the write-back itself does not hold — something rewrites it every frame — it says so once, naming what it can. Editing a frozen row moves the freeze to the new value. |
| ⌕ where is it used | Lists every event on every map that reads or writes it, from the index. Rows the loaded database no longer agrees with are marked stale with a pointer to Debug → Index. |

The panel states the three things the engine does silently, in the panel where
you type them: numbers are floored on the way in so a fraction truncates; text
and lists are stored exactly as typed, because nothing in the engine requires a
variable to hold a number; and ids outside `1–n` are ignored by the engine with
no error, no exception and no return value.

Sidebar:

| Group | What it holds |
|---|---|
| Quick vars | Variables pinned by name in the game's profile, plus anything you have pinned or frozen. Each is an editable box. Empty state tells you how to fill it. |
| Frozen | Everything currently frozen, with "release" per row and "release all". |
| Snapshot | When the last baseline was taken, "take snapshot", and "show diff" which jumps to Recent in diff mode. |
| Where it is used | The result of the last ⌕. |

### Scan

A value scanner for finding the variable behind a number you can see in the
game. Only numbers are comparable — anything that is not a finite number is
never a candidate for a numeric test, because `'12' > 5` and `[] === 0` would
put junk in the list.

| Control | What it does |
|---|---|
| Looking at | Variables or switches. Changing it starts a new search. |
| Test (first pass) | `equals`, `greater than`, `less than`, `between`, `not zero`, `anything`. Switches: `on`, `off`, `anything`. |
| Test (narrowing) | `equals`, `increased`, `decreased`, `changed`, `unchanged`, `increased by`, `decreased by`, `greater than`, `less than`. Switches: `on`, `off`, `changed`, `unchanged`. |
| Value / From / To | Operands, shown only for the tests that need them. |
| First scan / Narrow the search | Runs one round. The first considers every id; later rounds only re-test survivors. |
| Start over | Clears the candidate set. |
| Candidates | Surviving ids with live values, editable in place, each with a pin button. Display is capped at 400 rows; the candidate set itself stays whole, so a scan still at 900 narrows correctly on the next round. |

### Bulk

| Control | What it does |
|---|---|
| Kind | Variables or switches. |
| From / To | The id range, bounded to what the project actually has. |
| Set to | A number, or off/ON. |
| Set *n* | Writes the whole range. Confirms first, naming the range and the value. |
| What will change | Preview table of the range with current values, first 200 rows. |

The whole batch is one entry on the undo stack, so it comes back in one step.
Ids outside the valid range are skipped rather than written, because the engine
would ignore those writes.

### Recent

The change monitor, which runs whether or not the overlay is open — that is the
point of it. Do the thing in the game, open this panel, and the variable
responsible is at the top.

| Control | What it does |
|---|---|
| Live changes | Newest first, one row per variable, with `from` → `to`, how long ago, and a pin button. Rows flash briefly when they change. |
| Snapshot diff | Everything that differs from the snapshot taken in the Variables sidebar. |
| Clear | Empties the list. |

### Self

Self-switches for the current map only — the only map whose events exist right
now, which the panel says.

| Control | What it does |
|---|---|
| Filter events | By id or name. |
| `set only` | Only events with at least one self-switch set. |
| A B C D checkboxes | One per event, per channel. |
| Reset | Clears A–D for that event. This is what re-opens a used chest. |

The table also shows each event's position and which page is currently active.

### Teleport

| Control | What it does |
|---|---|
| Map tree | Every map in the project, nested by parent, collapsible, with the current map marked "here" and the selection marked "target". Search is index-backed with a linear fallback and a printed reason. |
| Expand / Collapse / Reveal current | Reveal opens every ancestor of the current map and selects it. |
| Landing: safe / exact | "safe" searches the target map for a tile you can actually stand on; "exact" uses the numbers verbatim. |
| X / Y | Target coordinates. Editing either switches the mode to exact. |
| Facing | keep / down / left / right / up. |
| Fade | black / white / none. |
| Teleport | Backs the save up first, then goes. No undo. |
| Here | Current map and position, and "bookmark this spot". |
| History | The last few jumps, with a one-click "back to …". |

Safe landing probes the **target** map, which is not the loaded one, so the
engine's passability code cannot be called against it directly —
`Game_Map.tileId` reads the global `$dataMap`, and that is whichever map you
are standing on. The probe borrows `Game_Map.prototype` onto a bare object and
swaps `$dataMap` for the duration of one synchronous search. That is
deliberate: plugins commonly replace `checkPassage` or `isPassable` outright,
changing how ☆ tiles, region flags and per-tile note tags behave, so a
hand-written copy of the engine's rules would be wrong on exactly the games
that need it most. Borrowing the live prototype makes the probe follow whatever
rules are actually installed.

Teleport refuses with a stated reason where it cannot work — the panel prints
"Cannot teleport: …" above a disabled button rather than letting you find out
by pressing it.

### Places

Named bookmarks, stored in their own file.

| Control | What it does |
|---|---|
| Name + bookmark current spot | Names are optional; unnamed ones take the map name. |
| Bookmarks table | Name, map, coordinates, "go" and "delete" per row. |

### Events

The event overlay is the one part of GigaHack that draws into the PixiJS scene
rather than the DOM. It is added to `Spriteset_Map` in an alias of
`createUpperLayer`, so it sits above the tilemap, characters and pictures but
below the window layer, and it is recreated with the spriteset on every map
transfer.

| Control | What it does |
|---|---|
| Search events | By id or name. |
| `overlay` | Draws the overlay. Off at every launch, whatever the setting says. |
| `labels` | id / name / page text above each box. |
| `passability` | Per-tile dots. Fully-open tiles are drawn a third lighter than blocked ones. |
| `regions` | Whole-tile region tint. |
| `transfers` | Cyan inner outline on events containing a Transfer Player command. |
| `inactive` | Also outline events whose page conditions are all unmet, in grey. |
| `click to pick` | Clicking the map selects an event instead of walking there. |
| Event list | Id, name, position, trigger (colour-coded) and which page of how many is active. Erased events are dimmed. Refreshed as the player walks. |
| Legend | One row per trigger type plus "contains a transfer". |

**Overlay look** — seven independent strength sliders plus two size sliders,
because the layers sit on completely different backgrounds and the strength
that makes one readable washes another out:

| Slider | Range | What it controls |
|---|---|---|
| box fill | 0–100 % | Interior of each event rectangle. |
| box outline | 0–100 % | The rectangle border — the one to raise first. |
| dark edge | 0–100 % | Black keyline just outside the box; what makes it readable on a bright map. |
| labels | 0–100 % | The text above each box. |
| transfer mark | 0–100 % | The cyan inner outline. |
| passability | 0–100 % | The per-tile dots. |
| region tint | 0–100 % | The whole-tile wash; usually wants the lowest setting. |
| outline width | 1–4 px | Thicker reads from further away than brighter does. |
| dot size | 4–24 px | At 24 px it fills most of the tile. |

Plus "reset to defaults".

**Inspector** (left column, rebuilt on selection change):

| Control | What it does |
|---|---|
| Event readout | Name, position, active page of how many, trigger, erased state, and any transfer targets — direct ones by map and coordinates, indirect ones as "by variable". |
| Self-switches A–D | Checkboxes, plus "reset A–D". |
| Force run this page | Starts the active page as if you had triggered it. May set switches, transfer you or start a battle. Backs the save up first. **Disabled with the reason stated up front** where it cannot run — "already running" after a two-click confirm is a worse way to learn it. |
| Move player here | Walks the player to the event. |
| Bring it here | Puts the event on your tile with `locate()`, which also stops any move route it was mid-way through — otherwise it slides back on the next frame. |

The whole panel is unavailable, with that stated, when
`Spriteset_Map.createUpperLayer` was not found in this build.

### Commands

The selected event's command list, decoded.

| Control | What it does |
|---|---|
| Page dropdown | Any page, not only the active one; the active page is named next to it. |
| Command list | Index, code and a decoded description, indented as the event is. Comments, conditionals, switch/variable writes and transfers are colour-coded. Each row's tooltip carries its raw parameters. |
| Page conditions | The selected page's conditions, in words. |
| Note | The event's note field, if it has one. |

It says "no event selected" with a pointer to the Events sub-tab when nothing
is picked, rather than showing an empty list.

### Find

"Which events, anywhere in this game, touch switch 42?" The engine cannot
answer it at all — it loads one map at a time and keeps no record of the others
— so this reads the boot index, which walked every map file once.

| Control | What it does |
|---|---|
| Kind | Switch, variable or self-switch. Switch and variable are searched by id; self-switch by channel A–D, because that is what an event page actually references. |
| Id / Channel | The thing to look for. Shows the name it resolves to. |
| Search | Runs the query. |
| Hits | Map, event id, event name and position, with "go" per row. |
| Rebuild the index | Same action as Debug → Index. |

Every hit is a **candidate**, re-resolved against live data before it is shown.
Rows the game no longer agrees with are dimmed and say which kind of
disagreement it is: the event has moved since the index was built (live
coordinates are shown), the loaded map has no such event (the index is out of
date), or the map is no longer in the database at all. A row on the map you are
already standing on selects the event instead of teleporting to it. "Go"
teleports onto the event's own tile and warns that a touch-triggered event will
fire on arrival, with Movement → Ghost named as the way to stop that. A search
that was run before a panel rebuild is re-run rather than remembered, so the
rows are always resolved against data as it is now.

### Gallery *(only where the project's switch names use a section convention)*

RPG Maker has no "gallery" object to unlock. What a project with a gallery has
instead is a run of switches under a header and a menu that draws whatever
those switches say is on, so a gallery unlock is a bulk switch write. Sections
are discovered from the project's own switch names using the convention the
profile detected — `--`, `==`, `##` and `[bracket]` forms are recognised by
counting how many named variables and switches match.

The panel is not registered at all when the project uses no convention, or uses
one only in its variables. World → Bulk sets a range of ids directly and is the
right tool there; the log says which of the two situations it is.

| Control | What it does |
|---|---|
| Filter | Matched against the section **title**, never against ids, because ids move between versions and titles do not. A game profile may supply one; typing your own replaces it. |
| Clear the filter | Lists every section the project has. |
| Collections table | One row per section: title, a progress bar, unlocked/total, and "all"/"none" per row. |
| Everything listed | Unlocked count and percentage across the listed sections, "unlock everything listed" and "lock everything listed", both confirmed. |
| List the sections the filter hides too | Only offered when a filter is active. Turning it on prints a warning: a project keeps its own state in switches too — quest stages, flags an event checks before it will run — and setting those in bulk can leave a quest somewhere its events do not expect. |
| Amount (0–100 %) | Partial unlock. |
| Unlock *n* of "…" | Applies the percentage to the selected section. |
| Apply to everything listed | Applies it to every listed section. |
| Selected | The section's title, switch range, named count and unlocked count, plus "open it in Switches" which jumps to the Switches panel filtered to named entries. |

A partial unlock takes the **first** n, not a random n, so the same percentage
always unlocks the same things. Each section runs from its header to the switch
before the next header — not to the last named switch — because projects leave
gaps for content they have not written yet, and stopping at the last named one
would silently exclude anything a patch drops into the gap. Unnamed slots
inside a range are skipped as the gaps they are. The whole write goes through
one bulk call, so a collection comes back in one undo step and the log gets one
line rather than four hundred.

---

## Items

### Items / Weapons / Armors

Three panels with the same shape.

| Control | What it does |
|---|---|
| Search | By name or id, index-backed with a linear fallback and a printed reason. |
| `owned` / `locked` filters | — |
| Type dropdown | The item types this project actually uses, discovered from the data. Only shown when there is more than one. |
| Row | Icon, id, name, type, price, count, **cap**, lock and buttons. Descriptions are in the tooltip. |
| have | Editable count. Degraded marks `inv.items`. |
| cap | This item's own `maxItems`, read **live, per item, immediately before every write** — never cached and never assumed to be 99. Reads `?` when `maxItems` did not return a number. |
| Lock | The game stops being able to change this count — a consumable cannot be used up and a shop cannot take it. You still can. Session-only; not written into the save. |
| − / +1 / +10 / max | max fills the stack to this game's own cap for this item. |

Sidebar:

| Group | What it holds |
|---|---|
| Gold | Current, this game's cap, an editable box with no upper bound, +1k / +10k / to the cap, and a lock. |
| Locks | How many are held, and "release every lock". |
| Stack size | "Raise maxItems" and a limit box. The raise never lowers anything: it returns the larger of the game's own answer and yours. Session-only — the database is rebuilt from the project files at every launch. Prints why it is unavailable where it is. |
| Bulk | "Fill every *kind* to its own cap" — each entry goes to **its own** `maxItems`, read per item, because one number for all of them would be clamped differently by every item on a game that caps them individually — and "clear all *kind*s". Neither is undoable. |

Both engines clamp on the way in, in the same two places, and neither reports
it: `gainItem` clamps to `maxItems(item)` and `gainGold` clamps to `maxGold()`.
Nothing throws and nothing returns false; the number simply is not the one that
was asked for. Both ceilings are also commonly replaced outright by framework
plugins. So when a cap refuses a value, **the panel offers to raise the cap and
says which one, what it is now, and what it will become**, rather than leaving a
control that looks like it worked. Two mechanisms are used together because
which one works depends on what is installed: the per-item stack field on the
data object, which a framework `maxItems` reads on every call and therefore
honours immediately, and GigaHack's own `maxItems` hook. Writing the container
or `_gold` directly bypasses the clamp entirely, and is used only after the
public API has demonstrably refused the value — at which point the UI says the
value was forced past the game's own cap.

### Gold

| Control | What it does |
|---|---|
| Current / This game's cap | The cap is read live: a framework plugin commonly replaces `maxGold` with its own parameter. Reads "unreadable" where it could not be read. |
| Set to | No upper bound on the box, on purpose — asking for more than the cap is how the offer to raise it appears. Degraded marks `inv.gold`. |
| +1k / +10k / to the cap | "to the cap" is disabled when the cap could not be read. |
| +100 / +1000 / +10000 / +100000 | — |
| zero | — |
| Totals | Per kind: how many distinct entries are carried and how many units. |

### Forge

One panel for ten `$data*` arrays: items, weapons, armors, skills, states,
actors, classes, enemies, troops and common events. The **Kind** dropdown
switches between them and each keeps its own draft, so switching away and back
does not lose what you were editing.

**Editor** — the field groups shown depend on the kind:

| Kind | Groups |
|---|---|
| Item | Identity + description, Use (scope, occasion, consumable, …), Damage, Effects, Icon, Note |
| Weapon / Armor | Identity + description, Equipment (type, price, …), Parameters, Traits, Icon, Note |
| Skill | Identity + description, Use, Damage, Battle text, Effects, Icon, Note |
| State | Identity, Removal (timing, conditions), Messages (`%1` = name), Traits, Icon, Note |
| Actor | Identity, Class & level, Images, Traits |
| Class | Identity, Growth (eight level-1 values, grown linearly to 99), Traits |
| Enemy | Identity (name, battler, hue), Parameters (flat), Rewards (EXP, gold), Traits |
| Troop | Identity, Members (up to 8) |
| Common event | Identity (name, trigger, switch), Steps |

Effects and traits are edited as rows: a type dropdown, a data control that is
a dropdown for short lists and a number box with a live name readout for the
long ones (states, skills, common events — a dropdown of a thousand entries is
not a control), and one or two value boxes. Out-of-range values from an import
are clamped and written back rather than left showing one number while the
record holds another.

The **common-event palette** is nine commands, not a full event editor: Show
text, Set a switch, Set a variable, Change gold, Change items, Change HP,
Transfer player, Call a common event, and Script. Each is a single command
whose parameter shape is stable, and together they cover "give me X", "set the
world to Y" and "run whatever I type". Steps are derived from the draft's
command list rather than stored beside it.

The **icon picker** is a windowed grid over the project's IconSet with a jump-
to-index box.

**Output**:

| Control | What it does |
|---|---|
| Forge it / Save changes | Allocates the next custom id and writes the definition into the live database, or rewrites an existing id in place. The id never changes, so saves holding it stay valid. Degraded marks `forge.write`. |
| New | Clears the editor. Nothing already forged is touched. |
| Duplicate as new / Revert | Revert reloads the entry from the library, discarding unsaved edits. |
| +1 to party / +10 | Items, weapons and armors. |
| Add to the party | Actors. |
| Fight it now | Troops. Refused mid-battle: `BattleManager.setup` on top of a running battle leaves the previous troop's members in `$gameTroop`. |
| Run it now | Common events, through `reserveCommonEvent` — the engine's own path, picked up by whichever interpreter is free. A hand-built interpreter runs outside the map's update and its waits never tick. |
| Teach it / Forget | Skills, on a chosen party member. |
| Apply it / Lift | States. |
| Change class to it | Classes. |
| Purge id *n* completely | Frees the slot instead of leaving a stub. Says how many references the id currently has, and that any save still holding it has the reference dropped on load. |

Enemies get a sentence instead of a button: an enemy is fought through a troop,
so forge one on the troop side and put the id in it.

**Preview** renders the draft as the game will see it — icon, name, id (or the
id it would be allocated), and the derived lines.

**Library** — every record of this kind, with "edit" and "remove" per row and a
"show retired" chip. Removing leaves a **tombstone** at the same index rather
than deleting: an old save that still holds the id finds *something* rather than
`undefined`, which is a crash in every item window in the engine. A tombstone
can be restored. Records the database has not taken are listed with why —
outside the range this install allocates, or at an id the game itself now
occupies.

**Id ranges**:

| Row | What it says |
|---|---|
| Range | The ids this install allocates for this kind. The lower bound sits above everything the game ships; the upper bound is a guard against one mistyped digit padding the data array with millions of nulls. |
| Base from | "the library file" or "this database". |
| Next id | The next id this kind would hand out. 0 means the range is spent. |
| Drift warning | Shown when the recorded and computed bases differ, saying which is which and whether ids between them may now belong to the game. |
| Migrate *kind* to *n* | Moves every record of this kind to the new base, keeping its offset. Confirmed, and stated plainly: **ids change**, and a save still holding an old id loses that reference on load. Every move is logged. |

Nothing here is a literal. A base is derived from the loaded database — highest
id plus a margin, rounded — and then **recorded in the library file**, so on
every later launch the recorded value wins and ids stay put even if the game is
patched and grows. The base this database would compute now is still worked
out, so the two can be compared; a drift is reported and a migration is offered,
never applied behind your back. "Custom" means membership in the loaded
library, never `id >= base` — a threshold test is a claim about a number rather
than about a row, and on any game whose own arrays reach past the base, every
stock row above it would answer yes and the Forge would offer to edit and
delete content the game owns.

**Browse the game's own** — a searchable list of this kind's stock rows, with
"copy", which loads one into the editor as a new draft. The original is
untouched and the copy gets an id of its own.

**Library file** — where the file is, how many entries are live and retired,
"copy export" and "import pasted". Imported ids are kept as they are, so saves
that reference them stay valid; an id this install cannot allocate is kept too
and listed under Id ranges, never renumbered and never dropped.

---

## Game

### Enemies

Live, from the running battle — not from the database. Says so and offers to
catch up by itself when you walk into an encounter with the panel open.

| Control | What it does |
|---|---|
| Troop table | Index, name, HP, MP and "kill" per row. Hidden and dead enemies are dimmed and labelled. Tooltip carries enemy id, EXP and gold. Repainted on a clock, because enemy HP moves every action. |
| Enemy readout | Id, HP, MP, EXP, gold, on-screen state and current states. |
| Set HP | Undoable while the battle lasts. Setting it to 0 is a kill, not an edit — it takes a save backup and cannot be undone, because it can end the fight. |
| Parameters (8) | Editable, each with **this build's live ceiling** in a column of its own. Written onto this battler's own offset, so nothing follows the save into the next encounter. Degraded marks `battle.params`. |
| Back to the database values | Clears the edits on this battler. The enemy database is untouched, so the next one of these is normal. |
| Force an action | Skill dropdown and "make it act now". The engine picks the target. Disabled with a reason where it cannot run. |
| Weaknesses | Element rates that are not 100 %, colour-coded. |
| State rates | Non-standard rates and immunities, top 24. |
| Drops | Each drop with its chance, and whether the drop rate is doubled. |
| Note | The enemy's note field, if it has one. |

When a parameter write is refused by the ceiling, the panel says so for **that
battler only** and offers to raise the ceiling to the value you asked for and
redo the write. Raising is delegated to the Party module, which hooks `paramMax`
where the game actually defines it — which may be a subclass that shadows the
base — and composes rather than competes. With that module absent the ceiling
is still read and shown, and the offer is simply not made.

### Actions

**This battle**:

| Control | What it does |
|---|---|
| Instant win | Kills every enemy and lets the game end the battle itself, so EXP, gold, drops and the victory autosave all still happen. Backed up first. Disabled outside a battle. |
| Instant lose | Drops the party and lets the game's own defeat handling decide what that means — it may be a game over, or a scripted revive. Backed up first. |

Neither forces the battle phase. A game may replace the end-of-battle tests
outright; calling `processVictory()` would skip everything the game's own
`checkBattleEnd` does and leave the fight half-finished.

**Survival** (also on Player → Survival):

| Control | What it does | Unavailable when |
|---|---|---|
| God mode | Party HP never drops below 1 and instant-death is ignored. Two hooks, because HP reaches zero by two routes — the ordinary damage funnel and a death state applied directly. Turn it **off** for scripted fights you are meant to lose: with it on they can be neither won nor lost. | The hooks could not be installed; the reason is printed. |
| Free skill costs | Skills cost no MP or TP, and none are greyed out for being unaffordable. Party only. | Same. |
| Multiply the damage you deal | Only what the party deals, and only when the number is damage — a heal comes out of the same call as a negative, and scaling that would make every potion a full restore. | — |
| Damage (0–100×) | — | Multiplier off. |
| Heal party to full | Full HP, MP and states cleared, for every member. | — |

Both survival flags are **toggles, not guarantees**, and the panel says so: a
plugin that reaches HP or a skill cost by a route outside the engine's own
paths is not covered, and that is unknowable from inside the mod.

**Enemy bars**:

| Control | What it does |
|---|---|
| HP/MP bars over enemies | Drawn into the battle scene above each enemy, below the HUD. Off at every launch, whatever the setting says. |
| Path | Which drawing path was used and why, and which gauge facilities this build has. "The bars do not look like the game's own gauges" then has an answer on screen. |
| Show MP bar / Show HP numbers / Show enemy name / Keep bars on dead enemies | — |
| backdrop / HP bar / MP bar / numbers | 0–100 % strength sliders. The backdrop is what keeps a bar readable over a bright battleback. |
| bar height | 2–20 px. |
| lift | 0–120 px above the top of the enemy graphic. Raise it if a tall sprite's bars overlap the HUD. |
| width | 0 follows each enemy's own sprite width; anything else is a fixed width for every enemy. |
| reset to defaults | Keeps the on/off state. |

The bars are hand-drawn PIXI primitives on purpose: one engine has a gauge
sprite class and the other has a window method that paints into a contents
bitmap, neither exists on the other, and the sprite one additionally needs
window internals the other engine does not have. It also survives a renderer
that is not WebGL. Where the scene could not be hooked at all, the toggle is
disabled with the reason.

**Start a troop**:

| Control | What it does |
|---|---|
| Search | By troop id, name or member names. |
| `can escape` / `can lose` | With "can lose" off, losing goes to the game-over screen instead of returning to the map. |
| start | Begins the fight the way the engine's own Battle Processing command does — no preemptive or surprise roll. Only from the map, and not while an event or message is running. |

### Message

**The game's own options** — GigaHack surfaces the text options the game
already has rather than building a second set that would fight it over the same
text. Which options those are is a property of the game: the profile may
declare them, and otherwise every boolean on `ConfigManager` the engine did not
put there is, by definition, one this game added. Each row writes through the
game's own config, so the mod and the Options menu agree in both directions,
and the rows re-read themselves while the panel is open so one that goes stale
is corrected rather than left lying. A build that added none gets a sentence
saying so.

**Auto & turbo** — what neither engine has, and is therefore built here:

| Control | What it does |
|---|---|
| Auto-advance | Pages turn themselves after a delay. Always stops at a choice, a number prompt or an item prompt. |
| delay (0.1–10 s) | — |
| Hold to turbo | While the key is held, text renders instantly and pages turn themselves. Releases at every choice. |
| turbo key | Default left Ctrl. Matched on `KeyboardEvent.code`, so it never enters the game's rebindable key map. |

All four are disabled together, with the reason, where the message window could
not be hooked.

**Right now** — a live readout: whether a message is on screen, whether you are
at a choice (and accelerators are being held), whether the turbo key is down,
and whether message skip is allowed, blocked, or not a concept on this build.

**Say something**:

| Control | What it does |
|---|---|
| Speaker | Optional name box. The field says "no name box on this build" and disables itself on engines that have no such concept, rather than silently dropping what was typed. |
| Message text | Up to four lines — the engine's own page height. Control codes work. Lines past the fourth are dropped here rather than silently lost inside the window, and the toast says how many. |
| Show it | Queued through `$gameMessage`, so it looks and behaves like an event's own text. Disabled with the reason where it cannot run: a message is already on screen, messages only show on the map, or there is no `$gameMessage`. |

**Appearance**:

| Control | What it does | Unavailable when |
|---|---|---|
| Override the font size | 12–48. | This build has no single place where the main font is decided; the reason is printed. |
| Override the font | Put **in front of** the game's own stack rather than instead of it, so a face that fails to load falls back to what the game shipped with rather than to the browser default. | Same. |
| Override the text colour | | This build has no single place where the normal text colour is decided; the reason is printed. |
| In force / Font hook / Colour hook | Names the colour currently in use and the exact method each override landed on. | — |

On the engine whose text colour is a per-window accessor, the override is
installed at the one point the engine's own colour reset calls, so it reaches
every stock window — but a window that asks for colour index 0 directly still
bypasses it, and the panel says so.

### Backlog *(only where the game declares a backlog adapter)*

A backlog is not an engine feature. `Game_Message` is core and generic; keeping
a scrollback of what has been said is a plugin, and a different one on every
game that has it. So the whole panel is a front end for the profile's `backlog`
adapter, and with no adapter it is not registered — an empty panel offering to
search a log that does not exist is worse than no panel.

| Control | What it does |
|---|---|
| Search the backlog | By line text or speaker. |
| Open in game | The game's own backlog window, opened the way the game opens it. Disabled where the adapter offers no scene. |
| Copy all | Everything currently listed, to the clipboard. |
| Lines | Numbered, with the speaker as a coloured prefix rather than a column of its own. |
| Lines kept | How many the game currently holds. |
| Speaker split | Which colour index marks a speaker header — **detected, not assumed**. Where nothing convincing turns up there is no split, which is worth saying because it explains why every line reads as unattributed. |
| Limit | How many lines the game keeps. Lowering it trims the oldest immediately, and the tooltip says whether this game's backlog can put them back. |
| Clear the backlog | Confirmed where the adapter offers no restore, and undoable where it does. |

### Achievements *(only where a Steam binding is present)*

Nothing in this module knows any game's achievements, app id or stats. All
three are discovered, in order:

1. **The API itself** — a binding that can enumerate is authoritative. It is
   the same list the store page shows, in the same order, and reading it
   requires no knowledge of the game whatsoever.
2. **The game's own event data** — where there is no enumeration call, the
   event commands that are loaded are walked for a plugin command whose name
   mentions an achievement, and the names it passes are kept. Both the MZ and
   MV command shapes are read. A scan sees only what is loaded, so the count
   grows as a session goes on, and rows found this way are labelled as guesses.
3. **The profile** — anything listed in `steamHints` is offered too, with a
   note saying how it is earned.

The app id comes from `steam_appid.txt` in the game folder, then from the
profile, and is otherwise shown as unknown. It is never a literal: a wrong app
id is the one mistake here that reaches Steam's servers, attributing one game's
unlocks to another.

**No binding anywhere means no panel.** A binding that is present but not ready
does get one, because "start the game through Steam" is something you can act
on, and the panel is where that sentence lives — with a row per probe saying
what it looked for and what stopped it.

| Control | What it does |
|---|---|
| Filter | By api name or title. |
| Table | Title, api name, which of the three sources found it, and locked/unlocked. |
| unlock / clear | Per row. Only shown where the binding actually supports them. |
| On Steam | App id and where it was read from, which binding is in use, how many achievements are known, and how they were discovered. |
| Look again | Re-probes for a binding and re-reads the event data loaded now. |
| Unlock every achievement / Clear every achievement | Warns that this is visible on your public profile and that Steam has no undo beyond clearing them again. |
| Refresh from Steam | Re-reads the unlocked states. |
| Stats | One box per stat the game's profile declared, with its goal and which achievement it counts toward. The API enumerates achievements but not the counters behind them, so this group exists only where a profile declared some. |

---

## Debug

### Environment

The paste-into-a-bug-report panel.

| Group | What it holds |
|---|---|
| Engine capabilities | The whole capability table: engine and version, renderer and PIXI version, Chromium version, host, filesystem (with the reason when absent), canvas id, whether `ColorManager` and `Sprite_Gauge` exist, whether plugin commands are registered or dispatched, save format and whether it is async, resolved save directory, whether `updateMain` is safe to gate, whether CSS `gap` and `clamp()` are supported, and whether `requestIdleCallback` exists. Every "no" carries its reason. |
| Copy the environment report | Engine, capabilities and resolved paths as plain text, on the clipboard. |
| Environment | Which persistence backend is in use and whether it is a fallback, the platform, the detected delivery layout, and whether Node APIs are available. |
| Resolved paths | Every directory the mod resolved, plus "copy paths" and "test write" — the latter actually writes a file and reports the resolved path or the failure. |
| Engine | Game title, mod version, variable and switch counts, current scene, and "refresh". Reads "loading…" where the panel was built before the database. |
| Save files | Save folder and where slot 1 would be, resolved through `StorageManager` so it follows the game's own external-save-directory option. |
| Renderer | Which of the features the overlay's design assumes this build actually supports, with a count of what is missing and a pointer to start here if any UI looks wrong. |
| Notes | Anything the path resolver recorded. |

Delivery is **discovered, not assumed**: the same files run from the game's own
plugins folder, from a web-deploy `www` folder, or from a mod loader's folder,
and the panel names which without hardcoding any of them.

### Hooks

Every alias GigaHack installed, with a dot per row: installed or skipped. A
skipped row carries the reason in its tooltip. Installed hooks get an
**unpatch** button, which succeeds only when no other plugin has patched on top
of ours — and says so when it cannot.

### Plugins

Two tables.

**GigaHack modules** — what this build expects against what is on disk and what
actually ran, as four columns: listed in `plugins.js` (enabled / disabled /
no), file present, file readable, and ran. Notes below it distinguish:

- **missing** — expected by this build and never registered;
- **locked** — on disk and unreadable by this process, with the `chmod` that
  fixes it. `existsSync` needs only directory permission, so presence, size and
  checksum all report fine while every read fails;
- **name-claimed** — the engine keeps one flat list of plugin names for the
  whole game and skips a second claim on a name, with no error. GigaHack reads
  those off disk and runs them itself;
- **unknown** — a `GigaHack_*.js` in the plugins folder that is not part of
  this version, almost always left over from an older install and safe to
  delete;
- **absent** — no file and no plugin entry, so those features are absent rather
  than broken.

Plus the detected delivery, the plugins directory, the mod manifest where one
exists, and "copy the whole report".

**Loaded plugins** — every entry in `$plugins` with its enabled state and
description, filterable, plus a collapsed list of compatibility warnings
pointing at the Compatibility sub-tab.

### Compatibility

Four questions, in the order they earn their keep.

| Group | What it answers |
|---|---|
| Load order | Whether GigaHack's aliases are the outermost ones. Names every plugin that loaded after it, and where they are not last, prints the file to move the entries to the end of — named from **this** install rather than a path that happens to be right on one of the three layouts. |
| Recognised plugin suites | Each suite found, the plugin names that matched, the named consequence, and which mod controls it makes unreliable. "No recognised plugin suite is loaded" is a good answer. |
| Degraded controls | Every control that has failed a write-back this session, with the reason, and "clear and try again" — worth doing after changing a plugin setting that was the cause. |
| Live self-tests | Run and results. |

The **self-tests** run against the running game, not a harness: they set a
sentinel and read it back, gain an item and count it. Every test restores what
it touched, and what they learn is what greys a control before you find out the
hard way. They are refused in read-only mode, because that is what read-only
means. The ten tests are:

1. variables can be written and read back
2. switches can be toggled and read back
3. items can be gained and removed — an item already at the game's stack cap is
   reported as a cap, not a failure
4. gold can be changed — same
5. actor parameters are readable, and their ceiling is known — reports the live
   ceilings for MHP, MMP and the rest
6. states can be applied and cleared
7. the save directory is resolvable and readable
8. GigaHack loads after every other plugin
9. no plugin has patched on top of GigaHack's hooks
10. no plugin name collides with a GigaHack module

Recognised frameworks, and what each is flagged for:

| Suite | Flagged as affecting |
|---|---|
| Yanfly Core Engine | parameters, gold cap, item stack caps — overwrites `maxGold`, `maxItems` and `paramMax` outright, no alias |
| Yanfly plugin suite (`YEP_*`) | nothing directly — but many YEP files version-gate their own bodies, so a method may not exist even though the file defines it |
| VisuStella MZ (`VisuMZ_*`) | actor parameters, EXP, enemy parameters |
| SumRndmDde Super Tools Engine | hotkeys — claims F12, but only in a playtest launch |
| SumRndmDde HUD Maker | nothing; draws in PIXI, not the DOM |
| CircularJSON save encoder | save parsing — backups copy bytes and are unaffected |
| aggressive image cache clearing | overlay icons — any bitmap held across a map change must be re-fetched |
| fast-forward plugin | timing |
| save location override | backups — GigaHack resolves save paths through `StorageManager` at call time, so backups follow the redirect |
| Moghunter (`MOG_*`) | nothing; in-scene overlays may be drawn under its layers |
| Olivia / Atelier Irina (`Olivia_*`) | nothing |

### Index

| Group | What it holds |
|---|---|
| Status | Phase (idle / building / ready / failed / disabled), progress and current stage, when it was built, and whether this session loaded a cache or built it. Errors are printed. |
| Refresh / Rebuild index | Rebuild throws the cache away and reads the database again. Nothing in the game is touched — the index is a lookup table, never authority. |
| Contents | What the index holds, by count. |
| Notes | Every stage that could not run, and why. Each of these is the string a panel shows when its query comes back incomplete, so a short result list is never silently short. |
| Build cost | Milliseconds per stage, slowest first, with the total. |
| Benchmark | The same question asked with the index and without it, back to back. This is what justifies a stage or retires it: a stage whose saving cannot be measured here is build time spent for nothing. |

### Saves

| Control | What it does |
|---|---|
| Quick slot | Which slot the quick hotkeys point at. Defaults to the last slot, so quick-saving never lands on one you use normally. |
| Save now / Load it | Works mid-cutscene. Overwriting an occupied slot takes a backup first. Says when the game's own save menu does not list the chosen slot — it is a real file, reachable only from here or the hotkey. |
| Save files table | Slot, timestamp, playtime, and save / load / "make this the quick slot" per row. The quick slot is starred. |
| Save anywhere | Makes the engine's "is saving allowed" test always true, so the in-game save menu works during cutscenes, under a restricted save mode, and where the game disabled saving on purpose. Says so when this build has no such test to override. |
| Slot gate | Where the engine has a per-slot enable test, "save anywhere" lifts that too and every slot becomes selectable. Where the engine has no such test — MV does not — the panel says the concept is not used by this build rather than showing a control that does nothing. |
| Ignore the reload penalty | Only built where the game declares an `ironman` adapter. Some save modes arm a flag on load and act on it when the next map finishes loading; this clears it before it is read. Session-only and off by default: it is the game's own design being overridden. |
| State | Whether saving is enabled, whether the restricted mode is on (and in which slot), whether an event is running, the resolved save directory, the save extension, and the slot gate's status. |

Saving outside the save scene is not `DataManager.saveGame`'s job alone —
marking the session's savefile id and calling `onBeforeSave()` are the scene's
work, and `onAfterLoad()` runs from the load scene's `terminate()`, i.e. after
the scene it belongs to has been left. Quick save and quick load sequence all
of that by hand, in order. The write itself is called as found at call time,
never cached or reimplemented, because replacing `DataManager.saveGame` outright
with no alias is a thing plugins do.

### Transfer

| Control | What it does | Unavailable when |
|---|---|---|
| Playtime hours / minutes | Playtime is derived from `Graphics.frameCount`, with a copy in `Game_System` that a load puts back — both are written, or the change reverts the next time you load. Undoable. | — |
| Save count | Undoable. | — |
| Export a slot | Copies the slot file into `exports/`, **byte for byte**. | No save files yet. |
| Import into a slot | Copies a file from `imports/` over a slot, backing up whatever was there. This is the one action here that destroys a save, and it says so. Names the extension this engine uses, because telling you to drop the wrong one is worse than saying nothing. | No files waiting. |
| Exports on disk | What is in the export folder. | — |

The whole panel is unavailable, with the reason, where there is no filesystem.
Saves are never parsed: plugins commonly extend what goes into a save, so a
save is bytes rather than JSON we understand, and anything that parsed and
rewrote one would drop the sections it had not heard of. After an import the
panel says whether the save menu's index could be retitled in place — one
engine allows a read-modify-write there and the other does not — so a menu
still showing the old title has an explanation.

### Console

**Assume there are no devtools.** A game packaged with the release flavour of
NW.js has no devtools API at all; a browser deploy can be worse. So this
behaves like the only console the game has.

| Control | What it does |
|---|---|
| Evaluate | Multi-line editor. **Ctrl+Enter** runs, **Tab** completes at the caret, **Alt+↑/↓** walks history. |
| Completion strip | Up to 24 matches, clickable. Recomputed on click rather than taken from the painted list, because the editor may have been typed into since. |
| Save as snippet | Names it from the first line. |
| Clear output | — |
| Output | Results formatted rather than dumped, with `›` for input and `‹` for results. Follows the tail unless you scroll up. |
| Snippets | Every saved snippet with run / edit / delete. Each can take a hotkey under Settings → Hotkeys. |
| Recording | Every GigaHack action that has an API entry point is written down as the JavaScript that would repeat it — not keystrokes, which replay nothing reliable in a game with async loads and its own RNG. The tape is shown live, can be saved as a snippet, or thrown away. |
| History | The last 12 lines, clickable back into the editor, plus "clear history". Survives a relaunch. |
| Reference | Every `GigaHack.api.*` name plus the services, written as they must be typed. |
| Capture console.log | Routes `console.log/warn/error` into the output pane while your code runs. The real console still gets them. |

Errors are displayed rather than allowed to reach the game loop.

### Log

| Control | What it does |
|---|---|
| Search the log | — |
| info / ok / warn / err chips | Level filters. |
| Log table | Time, level and message, colour-coded. |
| Uncaught errors | Every uncaught error and unhandled rejection caught this session, with its location and a click-to-expand stack. Plus "clear". |
| Breakdown | Count per level, and "copy what is shown" — the filtered view as plain text, on the clipboard. |

### Backups

| Control | What it does |
|---|---|
| Saves on disk | The resolved save folder, how many files, and the newest. |
| Backups | The backup folder, how many are kept, and "back up now". |
| Restore | Every backup with its timestamp, reason and file count, and "restore" per row. Restoring copies the files back over your live saves and backs the current state up first. |

Backups copy bytes with `copyFileSync` and never parse. The engine's own `.bak`
siblings are part of the snapshot: a restore that ignored them would put a save
back and leave a newer sibling next to it, which then resurrects the state the
restore was undoing. Backups are content-addressed by a cheap fingerprint, so
"back up before every teleport" does not mean copying every file every time.

The panel is replaced by a stated reason where backups are off — most often no
filesystem — and adds that dangerous actions will still run, they just will not
be protected.

---

## Settings

### Interface

| Control | What it does |
|---|---|
| Accent preset | Five swatches: blue-violet, cyan, green, orange, pink. |
| Custom accent | Any colour. The five derived accent shades are recomputed in JavaScript, because `color-mix()` is far above the browser floor. |
| Cycle the accent colour | Runs the accent through the spectrum. Repaints one CSS variable and nothing else — the game is untouched. Off at every launch, whatever this says. |
| Cycle speed | 0.2×–6×. |
| UI scale | 0.75×–1.5×. Re-measures the tab strip, since scaling changes its usable width without resizing anything. |
| Opacity | 30–100 %. |
| Show FPS in footer | — |
| Show active-cheats HUD | — |
| Reset window position | Returns both the window and the watch panel to their defaults. |
| Watch panel | Show or hide it; the row carries its hotkey. |
| Log drawer open at start | — |
| About | Build version, engine and version, and the detected delivery. |

### Behaviour

| Control | What it does |
|---|---|
| Read-only mode | Blocks every write to game state. Viewers, tables and overlays stay live. |
| Confirm dangerous actions | Danger-styled buttons arm on the first click and fire on the second. |
| Back up the save before dangerous actions | Copies the save into the backup folder before teleports, forced events and bulk edits. |
| Backups to keep | 1–200. |
| Undo — stack depth, undo last action, clear | Simple edits only. Teleports, forced events, class changes and Forge injections are irreversible; the save backup is the way back. |
| Pause game while the menu is open | Disabled with a reason where the engine could not be gated safely. The tooltip carries what the Hooks module says it actually holds on this build, rather than describing one engine's frame loop. |
| Swallow game input while open | Blocks keyboard input from reaching the game and freezes the player. |
| Log every write | — |
| Test toasts / Raise test error | Proves the notification and error-containment paths work. |

### Hotkeys

| Group | What it holds |
|---|---|
| GigaHack hotkeys | Toggle menu, watch panel, panic hide. The menu key cannot be cleared. |
| Feature hotkeys | Every bind contributed by a feature module, plus one row per saved console snippet. A module that is not installed contributes no dead key. Unbound by default where an accidental press would cost you something. |
| Keys this game already uses | `Input.keyMapper`, read live: every letter the game maps and what it maps to, plus the letters it leaves free. |
| Everything already claimed | The engine's own reservations plus the game's, which is the list the defaults were derived from — the answer to "why did it not choose that key". |

### Profiles

A settings profile is a whole snapshot of GigaHack's settings under a name,
kept in its own file so losing `settings.json` does not take the profiles with
it. Appearance, behaviour, hotkeys and every feature flag travel together.

| Control | What it does |
|---|---|
| Name + save as a profile | Enter saves. Saving over an existing name replaces it. |
| Profiles table | Name, when it was saved, and "apply" per row. |
| Apply it / Delete it | Both are on the undo stack. |
| Export | Copies the selected profile to the clipboard as JSON. |
| Import what is pasted | Reads a pasted profile, reporting why it was refused where it was. |

Applying is deliberately not a merge: the stored profile is merged over the
**defaults**, so applying the same profile twice always lands in the same
place. Settings that paint into the running game are stripped on apply and the
toast names which — a profile saved with the event overlay on would otherwise
switch it on from a file.

---

## The console API

Everything below is reachable from the Console panel or from DevTools. Write it
as `GigaHack.` — that is the global; the `$` used inside the source files is a
closure parameter and does not exist in the scope the console evaluates in.
`window.ModMenu` is kept as a read-only alias of the same object.

### `GigaHack.api.*`

**Overlay**

| Call | What it does |
|---|---|
| `open()` / `close()` / `toggle()` | The menu window. |
| `watch(on)` | The watch panel. |
| `apply(o)` | Applies a settings object. |
| `readonly(on)` | Read-only mode. |

**Diagnostics**

| Call | What it does |
|---|---|
| `diagnose()` | Everything a bug report needs, in one **read-only** call: engine, host, layout, the capability table, profile, load order, recognised frameworks, degraded controls and index status. Deliberately read-only — the self-test writes into the running game, so it stays behind its own name. |
| `caps()` | The capability table, and prints it. |
| `paths()` | Resolved directories and platform flags. |
| `hooks()` | Every alias, installed or skipped, with reasons. |
| `plugins()` | The `$plugins` report. |
| `cfg()` | The live settings object. |
| `log()` | The log buffer. |
| `errors()` | Uncaught errors caught this session. |
| `profile()` | The resolved profile. |
| `loadOrder()` | Whether GigaHack's aliases are outermost, and what loaded after. |
| `frameworks()` | Recognised plugin suites and the named consequence of each. |
| `selfTest(ids)` | The live self-tests. **These write to the running game.** |
| `help()` | Prints every API name. |

**Index**

| Call | What it does |
|---|---|
| `index()` | Status, counts, timings, notes. |
| `reindex()` | Rebuilds it. |
| `eventsTouching(kind, id)` | Every event that reads or writes a switch, variable or self-switch. |
| `findEvents(type, key)` | The same query through the Events module. |

**Game state**

| Call | What it does |
|---|---|
| `noclip(v)` / `speed(v)` | Getters with no argument, setters with one. |
| `step(n)` | Runs n steps of game logic. |
| `encounters(v)` / `encounterProbe()` | Random encounters, and what the probe concluded. |
| `unlockAll(pct)` / `gallery()` / `gallerySections()` | Gallery bulk unlock and its totals. |
| `quickSave()` / `quickLoad()` / `saveTo(id)` / `loadFrom(id)` | Save slots. |
| `exportSlot(id)` | Copies a slot into `exports/`. |
| `playtime(secs)` | Getter with no argument, setter with one. |
| `steam()` / `achievements()` | The Steam environment and the discovered list. |

**Forge**

| Call | What it does |
|---|---|
| `forge()` | The whole library. |
| `forgeInject()` | Writes the library into the live database. |
| `forgeScrub()` | Drops references to ids the database no longer has. |
| `forgeRecruit(id)` | Puts a forged actor in the party. |
| `forgeRun(id)` | Runs a forged common event. |

**Console**

| Call | What it does |
|---|---|
| `eval(src)` | Evaluates as the Console panel does. |
| `snippets()` | The snippet library. |

Every API function is wrapped once at load so the **recorder** can write down
the JavaScript that would repeat it; the tape is only appended to while
recording is on. A module that registers late is picked up lazily.

### The services

The same objects every panel is built on. On a game nobody has written a
profile for, these *are* the toolkit.

```
GigaHack.caps.report()              engine + capability table, with reasons
GigaHack.caps.reportText()          the same thing as pasteable text
GigaHack.profile.active()           what is known about this game
GigaHack.compat.frameworks()        plugin suites, and what each one breaks
GigaHack.compat.selfTest()          live write tests — these WRITE to the game
GigaHack.compat.loadOrder()         are our aliases outermost, and why not
GigaHack.index.status()             what the index holds, and what it skipped
GigaHack.index.findEventsTouching('switch', 42)
GigaHack.index.findVar(q) / findSwitch(q) / findMap(q) / findAsset(q)
```

Every index query returns `{candidates, complete, why}` — candidates only,
never authority. Resolve each one against live `$data*` / `$game*` before using
it, and where `complete` is false, `why` is a sentence already written for the
user.

### Starter snippets

Seven ship with the mod. They are **seeded, not written**: the snippet file is
only created once you save or delete something, so a default you deleted stays
deleted and one you left alone is refreshed with the mod. Each is written out
rather than hidden behind an API call, so they double as documentation of the
services — read one, edit it, run it.

| Snippet | What it asks |
|---|---|
| what engine and capabilities am I on | Prints the whole capability table with the reason for everything missing. |
| what does GigaHack know about this game | Which profile matched (or that the defaults are computed), the detected section convention, the Forge id bases, and the database counts. |
| which plugins is GigaHack worried about | Recognised suites with the named consequence of each. Empty is a good answer. |
| what actually works on this build | Runs the live self-tests and returns only the results that are not a clean pass. Writes sentinels — run it on a save you do not mind touching. |
| what is the index holding | Index status, warning each note — every note is a stage that could not run, and why. |
| find every event that touches this switch | The cross-map query, with the `complete` check written in. |
| find a switch or variable by name | Index search over both, with the `complete` check written in. |

---

## What makes a control unavailable

Every reason the mod will give you, and where it comes from.

| Reason | Meaning |
|---|---|
| *"the … module did not load"* | One of the 26 files is missing, unreadable or name-collided. Debug → Plugins says which and what to do. |
| *"no game running" / "database not loaded yet"* | The panel needs `$game*` or `$data*` and you are on the title screen. |
| *"no map loaded"* | The panel is per-map. |
| *"start a fight, then open this tab"* | Enemy data is live, not from the database. |
| *"…was not found in this build"* | A named engine method the feature needs does not exist here. The hook is recorded as skipped with that reason and Debug → Hooks lists it. |
| *"this build has no single place where … is decided"* | The feature would have to be applied per window; it is off rather than applied to some and not others. |
| *"not a concept on this build"* | The engines genuinely differ — a per-slot save enable test, a message name box, a message-skip flag. Not an error. |
| *"writes … are not sticking"* | A write-and-verify failed. The likely culprit is named, and "try again" clears the mark. |
| *"the cap stopped that" / "the ceiling stopped that"* | The value was clamped. The offer to raise the limit and redo the write is attached. |
| *"the index module is not installed" / "searching the long way instead"* | Search fell back to a linear scan. Slower, same answers. |
| *"the index is out of date"* | A candidate no longer matches live data. Rebuild it in Debug → Index. |
| *"save paths unavailable" / "no filesystem here"* | A browser or web deploy. Backups, transfer, the index's filesystem stages and the image pickers are off. |
| *"clipboard blocked / unavailable"* | `file://` is not a secure context and there is no NW.js clipboard. The text is selectable in place, or written to the log. |
| *"present but NOT READABLE by the game"* | File permissions. The `chmod` is printed. |
| *"GigaHack is listed but NOT LAST"* | A later plugin wraps our hooks. The file to move the entries to the end of is named. |
