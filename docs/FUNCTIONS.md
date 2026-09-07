# GigaHack MV/MZ — what it can do

The complete list. Organised the way the menu is: six tabs, each with its
panels, each panel with its controls. Where a control can be unavailable, this
says what makes it unavailable and what the mod says instead.

Four panels are conditional and only appear on games that have the thing they
are for: **World → Gallery**, **World → Quests**, **Player → Encounters** and
**Game → Achievements**. Each section says what the test is. **Game → History**
is always there — it used to be conditional too, and stopped being so when
GigaHack started recording a history of its own rather than borrowing the
game's.

Every other panel is always registered, including the ones that cannot do
anything on a particular build. That is the point: a panel that says which hook
failed and what it would have done is worth more than a panel that is not
there, because the second one is indistinguishable from a mod that was never
installed.

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

### Loadouts

A kit is one actor's class, level, skills, parameter bonuses and one entry per
equip slot, saved under a name and put back later. The order it goes back in is
the whole of the difficulty, because the engine's own methods undo each other
when they run in the wrong one: `changeClass` re-derives the level from the new
class's exp, so a level written first is thrown away by it; levelling up learns
the new class's own learnings on the way, so a skill list written before the
level is a list the level then adds to; `canEquip` is a property of the class
and every `refresh()` calls `releaseUnequippableItems`, so gear restored under
the old class is traded back into the party bag the moment the class moves; and
adding a parameter bonus refreshes too. So the sequence is class, level,
skills, equipment, bonuses — always, in one pass — and the panel prints it
under the apply button rather than leaving it as something the mod happens to
do.

Every refusal is worked out **before anything is written**, and the difference
table is that computation rather than a report of what happened afterwards.
`changeEquip`'s two guards are joined by `&&` and the left one has side
effects: it has already given the old item back to the party and taken the new
one out of it by the time the slot-type comparison runs. A mismatched type
therefore leaves the party both holding the old item and wearing it, with the
new one destroyed, and nothing throws and nothing returns false. So the type is
tested here first and the write is never attempted, which is also why the
difference table costs nothing to look at.

| Control | What it does | Unavailable when |
|---|---|---|
| Party list | Every member with level and slot count. The selection is shared with the other Player sub-panels, so picking someone here and switching to Equip keeps the same actor. | — |
| Slots | This actor's own `equipSlots()`, read live: how many, each slot's type name in order, and whether the class dual-wields. Nothing here assumes a count, an order, or that two actors agree. | — |
| Name + save this kit | Records class, level, skills, parameter bonuses and one row per slot from the selected actor. | Blank name, a name already taken, or the kit limit reached. Each prints which, and nothing is ever replaced silently. |
| Saved kits table | Name — editable in place, which renames it — the actor and class it came from, its level and slot count, and apply / overwrite / delete per row. Kits recorded from the selected actor are highlighted. | "apply" is disabled on a kit recording more slots than the selected actor has, naming both counts. |
| What to apply | Five toggles: class, level, skills, parameter bonuses, equipment. | — |
| Provide a missing item | Gives the party one copy before the slot is written, because `changeEquip` trades out of the party bag. | An item locked in the Items panel is still refused, and says which lock and where to release it. With the inventory module absent it says that instead. |
| Force the slot | Calls `forceChangeEquip` instead, which skips the ownership trade and a locked slot. It does not skip a slot-type mismatch or a missing row, and those still refuse. | — |
| Difference from *actor* | Every row that would change: class, level, skills as +*n* −*n*, each slot with its icon and what it holds now, and each parameter bonus — each carrying the refusal that row would hit. Reads "nothing would change" when it would not. | — |
| apply *kit* to *actor* | Runs the five steps in order. One undo entry for the whole call. | No kit picked, every "what to apply" toggle off, or the kit records more slots than the actor has — each states which. |
| Copy the selected kit as JSON / add the pasted kit | Moves a kit between installs. Import keeps the ids as they are. | Copy needs a selected kit. Import prints why it was refused: not JSON, no name, no slot list, the name is taken, or the limit is reached. |

"Force the slot" does less than its name suggests and the panel says so next to
it. `forceChangeEquip` sets the slot and then calls
`releaseUnequippableItems(true)` in the same call, so it walks past party
ownership and a **locked** slot and past nothing else — a **sealed** equip
type, or a weapon or armor type the actor's traits do not grant, is stripped
again before the method returns. There is no durable write that beats
`canEquip`; setting the slot by hand is undone by the next refresh. So a slot
the engine took back is reported as **released** rather than as applied, and
the panel names what was released, from which slot, and whether it went back
into the bag. The observer that attributes those is an alias on
`releaseUnequippableItems` that changes nothing; where it could not be
installed the panel says so, and a kit may then finish with fewer slots filled
than it recorded with the difference table as the only report of it.

What one slot can refuse with, all of it computed with no writes:

| Reason | What it means |
|---|---|
| wrong slot type | The recorded item is not this slot's equip type. Named as both types, because the trade would run before the comparison. |
| not owned | The party is not carrying it. The refusal names the two settings that would get past it. |
| slot sealed | A trait seals this equip type on this actor. Forcing sets it and empties it again in the same call, so forcing is not offered as a way through. |
| cannot equip | No trait grants this actor the item's type. Said by **weapon or armor type name** and the class's name, not as a bare no. |
| no such slot | The kit records more slots than this actor has. The extra ones are dropped and named rather than written somewhere they do not exist. |
| id gone | The recorded id has no row in the loaded database now. The kit kept the name it was saved under as a tombstone, so the row is named, and every other slot still applies. |
| released | Forced, set, and emptied again by the engine inside the same call. |
| did not stick | The write was made and read back different. Marks `party.equip` degraded, with "try again" next to it. |

A **locked** slot is not a refusal at all — `changeEquip` does not consult the
lock, so the write lands — but the difference table says the slot is locked
anyway, because the game's own equip menu will refuse to move it afterwards.

Kits live in `kits.json` in GigaHack's own store, not in the save and not in
the settings file, so they follow the install rather than the playthrough,
which is what makes "put that actor back the way they were" survive a load.
Slots are recorded as ids with the name kept beside each one, because `$data*`
is rebuilt from the project files at every launch and the Forge can add and
scrub rows underneath a stored kit. An apply is a single undo entry, and
undoing it puts each slot back the way that slot was written — a slot the apply
forced is forced back, one it traded is traded back — so the party bag comes
back with it. Applying the same kit to the actor it came from moves nothing: a
slot already holding the wanted record is skipped before ownership is asked
about at all.

Two things are worth knowing about what a kit is *not*. Parameter bonuses are
the manual offset only: equipment and everything else contributing through
`paramPlus` is outside it, and the offset is cleared before the kit's own
numbers go on, so a kit recording a zero really removes a bonus that is there.
And a kit is not a snapshot of an actor — states, HP, MP, TP and everything the
Identity panel writes are not in it. A level above the actor's own cap is
clamped, and the report gives both the number recorded and the number that
stuck rather than the one that was asked for.

In read-only mode an apply writes nothing at all and the message names the
action that was refused and where to turn the gate off; saving, renaming,
deleting and importing are refused the same way. The panel itself is always
registered, so the tab never changes shape under you — what degrades is the
body: without the party module it says so and points at Debug → Environment,
before a game it says to start or load one, and with an empty party it points
at Player → Stats.

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

### Route

A run timer needs a clock, and the only honest one is the engine's own frame
count: it is what the play time is derived from, what the engine writes into a
save, and what a player recognises. GigaHack's own frame count is not a
candidate — it starts at zero when the mod loads, so it ignores a forty-hour
save, and it deliberately keeps ticking while the mod holds the game, so a run
timed with it would be longer than the run.

Where that clock ticks is a property of the build, and it is measured rather than
assumed. One engine advances it inside the logical step; the other advances it
inside the draw, which sits in the same function but outside the part the pause
gate is allowed to hold. Every consequence follows from that one placement — does
holding the game stop the run, does a logical step the engine caught up without
drawing count, does time spent entering a scene count — and nothing here decides
it by engine name. The panel prints the ratio of engine ticks to logical steps
sampled over a rolling window, and the verdict for "while the game is held" as
the measurement it is, beside what the pause gate that actually installed
implies. Where the two disagree it says so, and the measurement is what the run
uses.

The engine's frame count is also writable, and this mod writes it: editing the
play time sets it outright, and loading a save teleports it to that save's
recorded frame. Watching for a load hook would catch one of those and miss the
other, so the clock is watched for a jump instead. The anchor moves with the
jump — a jump nobody played never lands in the elapsed time — and the run is
marked rather than quietly corrected. A load from before the run started makes
the subtraction negative, so that run is voided with the reason: a minus sign in
a run timer is a bug report waiting to happen.

| Control | What it does |
|---|---|
| Elapsed | Frames since the anchor, as a clock. Repainted about four times a second, not sixty. |
| Engine clock / Game time | The raw frame count, and what the game will write into a save. |
| Clock per step | The measured ratio in words: one tick per logical step, or a build that ticks the clock when it **draws** and therefore does not count steps the engine caught up inside one frame, or more than one thing advancing the clock. |
| State | not started / running / finished / voided, with whatever marked it — the speed multiplier was on, the clock jumped this many frames — and why a voided run is void. |
| Splits table | Number, label (editable in place), the condition in words, the time this run reached it, the best run's time for it, and the difference. A ± with no best behind it reads "—" and says which, rather than implying a tie. Reorder and delete per row; the delete says the best keeps its time. |

**Clock** carries the source, both measurements as sentences, and **Shown as** —
centiseconds, whole seconds or engine frames. A split is recorded in frames and
converted only for display, so the number the engine actually counted is still
reachable. The group also warns while the speed multiplier is on, because those
times are not comparable to a run at 1×, and prints the last clock jump with the
reason it was given.

**Route** and **Add a split**:

| Control | What it does | Unavailable when |
|---|---|---|
| Route | Which of this project's routes is live. | No routes yet; the panel says to name one below. |
| New / new route / duplicate / delete this route | Duplicating mints **new split ids**, so the copy does not share the original's best times and editing one does not silently move the other's. | — |
| On | `a switch turns on`, `a switch turns off`, `a variable reaches a value`, `a map loads`. A battle and the real-time timer are trigger conditions, not splits. | `a map loads` is dropped where its hook did not install, with the reason. |
| Switch / Variable / Map id, Test, Value | The same conditions as Debug → Triggers, bounded by the loaded database. | The database has not loaded; the id box says there is no range to pick from. |
| Label | Optional. The condition in words is used where it is blank. | — |
| add the split | — | This route already splits on that condition, and two splits on one condition would both fire on the same edge. Stated under the button. |

Anything those four cannot describe is reachable from a snippet:
`GigaHack.api.split("name")` records a split by label, and a label with no split
of its own appends one rather than being dropped.

**The run**:

| Control | What it does | Unavailable when |
|---|---|---|
| Start on a new game | Anchored in the one function a new game begins in on both engines, which runs **before the first map is set up** — so a route whose first split is the starting map is still reachable. | That hook did not install. The reason names the function and points at "start the run now" or at making the first split the starting map. |
| Start the run on a load | Off by default, and the row says why: a load sets the engine clock to that save's play time. | — |
| start the run now / stop the run | — | Stop is disabled with nothing running. |
| re-anchor to now | Keeps the route and clears this run's split times. | — |
| void this run | Marks the run unusable. Nothing stored is deleted. | — |

**Best run** and **Editing the route** are one rule stated twice, because it is
the rule people otherwise find out about the hard way. The best run is keyed by
each split's own id, minted once and never reused, and nothing rewrites it as a
side effect: renaming a split keeps its time, reordering keeps every one of them,
deleting one **leaves its time on disk** and the panel counts how many stored
times no longer have a split, and adding one stops the **total** being comparable
— which it says — while every per-split comparison that still has a match keeps
working. Clearing the best is its own confirmed action and nothing else does it;
"keep the best, stop comparing totals" is the other half of that offer. The group
also reports how many splits matched by id, and flags a route recorded when the
project's switch or variable tables were a different size, giving both sizes —
loaded and flagged, never discarded. "save this run as the best" is disabled
until the run reaches its last split, since there is no total to compare before
that, and a new best is saved automatically unless that is turned off.

**Danger** names the key this project's runs are filed under and offers to forget
every one of them. Runs are stored per project because a mod-loader layout gives
two projects one data directory, and the key comes from the profile rather than
from the folder.

The whole panel is replaced by a stated reason where there is no readable engine
frame count: there is no game clock to split against, and a wall clock would
measure your afternoon rather than the run.

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

### Watchpoints

World → Recent polls the two `_data` arrays once a frame and can tell you that a
variable moved. It can never tell you who moved it: by the time a frame boundary
arrives the interpreter has run on to the next command and the answer is gone. A
watchpoint is standing on the stack at the moment of the write instead. The three
`setValue` methods are aliased, and `Game_Interpreter.executeCommand` — which is
on the stack for the whole duration of a command, a Script command that calls
`setValue` by hand included — pushes the interpreter that is running, so "who is
doing this" is readable from inside the write itself. Nothing is reconstructed
afterwards from a frame counter or from whatever happens to be running when the
panel repaints, which is why a hit is still right after the interpreter has moved
on. A hit keeps ids and strings only, never the interpreter: retaining one would
pin its whole command list and, through the child chain, several more.

With nothing armed and nothing subscribed the three aliases do one boolean test
and a tail call. `executeCommand` is the hottest function in either engine — its
own runaway guard allows a hundred thousand calls in a single frame before it
gives up — and projects do write hundreds of variables a frame from parallel
processes, so an idle watch has to cost nothing rather than nearly nothing.

| Control | What it does |
|---|---|
| Watch a | Variable, switch or self-switch. |
| Search + candidate chips | By id or name. Index-backed where the index can answer, falling back to the live database, and printing the reason where neither can — on the title screen it says the database is not loaded yet and to reopen the tab. |
| Event / Letter | Self-switches only: an event on this map, and A, B, C, D or `any`. The key is built the way the engine coerces its own — map, event, letter — so the watchpoint matches the writes the game actually makes. A map with no events says so instead of offering an empty dropdown. |
| Fires on | `any change`, `any write`, `becomes`, `rises above`, `falls below`, `leaves a range`. The threshold conditions are edge-triggered: they fire on the crossing, not on every write that stays past it. |
| Value / Range low / Range high | Operands, shown only for the conditions that take them. |
| Pause the game on a hit | Holds the game on the next frame — see below. Disabled with the reason where pause could not be installed on this build. |
| Remove itself after the first hit | Disarms the watchpoint once it has fired. |
| add watchpoint | Arming writes nothing to the game. A second watchpoint on the same target with the same condition is refused, because it would double every row rather than tell you anything twice. |
| Watchpoints armed | The master switch. Off, the three aliases return the original call and nothing else. |
| Log every hit | A line in the log drawer per hit, queued to the next frame rather than written from inside the interpreter's own loop. |
| Capture a JS stack when no event did it | One `Error` object per unattributed write, so a write nothing on the stack explains can still be traced. Off by default. |
| resume the game | Clears the hold a hit turned on. Disabled when nothing is held. |
| clear hits | Empties the hit list; the watchpoints stay armed. |
| Armed table | On/off, target, name, condition, hit count and the frame of the last one, with a remove button per row. |
| Hits table | Frame, target, `from` → `to`, who wrote it, and the command that was on. |
| all / events only / unattributed | Filters over the hits. |
| copy what is shown | The listed hits as plain text. |
| find events that touch this | The cross-map index query for the selected hit's target. Says so where the Index module did not load and only this map could have been searched. |

**Who** is one of four answers and never a guess. An event names its map, its
event id and both names; a child interpreter names the common event it is
running *and* the event that called it, which is knowable only from the parent's
Call Common Event command because the child itself carries no record of it.
GigaHack's own writes are labelled as GigaHack's, so a cheat of your own is
never reported as an event that did it. A write with no interpreter on the stack
is reported as coming from the engine or a plugin — that is the honest answer,
and it is given rather than attributed to whatever ran last.

**Hits coalesce per watchpoint per frame.** A parallel process that writes every
frame — a play timer, a step counter — would otherwise produce sixty rows a
second, and so would a frozen variable GigaHack itself re-asserts. One row per
frame, carrying a count, keeps the list readable and still says how many writes
there really were.

**The hold is one frame late, and the panel says so** rather than implying the
command was caught in the act. Nothing here gates the engine: pause is the Hooks
module's job and already the one place that knows the frame loop cannot be
wrapped on every build, so a hit queues a request and the mod's own frame tail
acts on it. Opening the overlay or writing a setting from inside
`Game_Variables.setValue` would run DOM work inside the interpreter's while-loop,
mid-frame. What a hit turns on is the ordinary "pause while this menu is open"
setting — a setting you did not touch, which is why the toast says so and the
panel carries the button that clears it again.

The watchpoints themselves survive a launch; the hits they recorded do not.
Pause-on-hit is one of the settings deliberately never restored, however it was
left, and a persisted watchpoint arrives with its own pause flag cleared for the
same reason: a game held before the overlay that would release it exists is
indistinguishable from a hang.

**Where the writer cannot be named**, the panel says which of two things
happened rather than showing a blank column. Where the interpreter alias is not
the function GigaHack installed — a plugin replaced the event interpreter, or the
hook was removed from Debug → Hooks — a "Who wrote it?" group carries the
reason and every row reads "unattributed". Where a plugin subclassed the
interpreter and overrode `executeCommand` on the subclass, the prototype alias is
shadowed for that instance only; its writes read unattributed too, and Debug →
Interpreters marks the row. In both cases the watchpoints still fire and still
say what changed.

**The whole panel is replaced by a stated reason** where none of the three
`setValue` aliases could be installed, naming each one's cause, pointing at
Debug → Hooks, and saying that World → Recent still polls once a frame and will
still tell you *what* changed. A self-switch hit reports that whether the write
stuck is unknown rather than that it stuck: nothing in GigaHack routes a
self-switch write through the write verifier, so there is no answer to give.

### Since Save

The engine keeps no record of what it changed. A cutscene sets nine switches,
spends gold, moves the party and hands control back, and nothing anywhere says
which nine. A save file is the one place the whole world is already written
down at a known moment, so "what has moved since I last saved?" is a diff, and
the baseline is taken where the engine already stops to write everything down.

The baseline is a **snapshot**: every field read out by name into a plain
record whose size is the project's variable count plus a fixed set. It is never
a copy of the world. Both engines' JSON encoder writes its class marker onto
the object it is handed rather than onto a copy, and the two do not agree about
cleaning it off afterwards — so a "snapshot" taken with the engine's own
stringify or deep copy mutates `$gameSystem`, `$gameParty` and everything under
them. A panel that only looks is not allowed to do that, so nothing here
serialises anything.

The baseline moves by itself at every save, every load and every new game. The
save-side one is taken **before** the engine writes, because the save contents
are assembled inside that call — what is anchored is exactly the state the file
is about to receive. The load-side one is taken **after**, from the globals the
load has just installed, so "since save" after loading a slot means "since the
state in that slot"; anchoring before would read the blanked globals the engine
put there a moment earlier. The anchor lives in memory only and is gone at
relaunch, which the panel says rather than leaving as a gap: a five-thousand
entry array written to disk on every save would be churn for something that is
meaningless the moment the process restarts.

| Control | What it does |
|---|---|
| Summary | How many changes, across how many sections, since the anchor it names and how long ago that was taken. Where there is no anchor, this line is the reason there is none. |
| Search | Name, id, before, after, kind or the row's own note. |
| Sort | `by id`, `by kind`, `by size of change`. Every one is a total order — `sort` is not stable on the browser floor this targets, and two rows that compare equal would come back in an order nothing decided, which is a table that reshuffles as you read it. |
| Diff table | Id, which section the row came from, name, before, after. Virtual, because the row count is the project's and not ours: five thousand variables and five thousand switches can all differ at once. |
| go | Opens the row in its own panel with the filter already set to that id. Only kinds that have a panel get the button — one that lands nowhere is worse than none. |
| revert | Writes the baseline value back through the same verified write the Variables panel uses. Variables and switches only. Degraded marks `vars.set` / `switches.set`. |
| copy diff | Everything currently listed, as text, on the clipboard. Where there is no clipboard it says so and the rows stay selectable. |

Sidebar:

| Group | What it holds |
|---|---|
| Anchor | When it was taken and by what, which slot, the playtime at that moment, and whether the engine confirmed the file was actually written — "waiting on the engine's answer" until it does, and the engine's own failure text where it did not. Plus "anchor here", which writes nothing to the game, and "clear anchor". |
| Automatic | Re-anchor at every save, load and new game; also re-anchor when the autosave slot is written; hide variables and switches the project never named. |
| Compare | One chip per section: variables, switches, self-switches, gold, items and equipment counts, the party roster, actors, map and position, and save count, playtime and build. |
| Not compared | Every hole in the coverage, listed rather than left for you to find. |
| Now | What the live snapshot is holding right now — variables and switches read, self-switches set, actors captured, playtime. |

The autosave chip is the one that has to be asked as a capability. Where a
build has an autosave slot, the engine writes it from a scene's own update,
mid-scene and unprompted — an unguarded baseline would re-anchor during the
very cutscene this panel exists to explain, and the diff would come back empty
for a reason nothing on screen accounts for. So it is off by default and the
toggle is only live on a build that has such a slot.

**What the rows say about themselves.** A variable holding a list or an object
is recorded as capped text, not as the reference: keeping the reference would
alias the baseline to the live object, so editing the array in place would
silently move the anchor with it and a real change would become invisible, and
one variable holding a large structure would make the record unbounded. Those
rows say they were compared as text and cannot be reverted. An id past the end
of what this project defines is kept and marked rather than dropped — a state
written by a build with more variables than this one carries them, and dropping
them hides a real difference. Self-switches diff by **presence**, because
setting one off deletes the key: the record holds only the ones that are on.
A self-switch row names its map and event resolved live, and a key whose map is
not the loaded one can only name the map, because no other map's events exist
right now. A row saying a whole section changed shape sorts first and is drawn
in the warning colour: it changes what every row under it is worth.

The panel is registered on every build, so its sub-tab never vanishes; each way
it cannot run is a body that says so.

| What is unavailable | What it says |
|---|---|
| The whole panel, before a game exists | "no game world yet — start or load a game, then reopen this tab". |
| The table, with no anchor | "there is no anchor yet — press 'anchor here'", and the summary line carries which of four reasons it is: there is no game world; the save hook was skipped, with the hook's own reason; automatic anchoring is off and none was placed by hand; or nothing has been saved, loaded or started since GigaHack loaded. |
| Re-anchor at every save | Greyed, with the save hook's skipped reason, and a pointer to "anchor here" as the way to place one by hand. |
| Re-anchor on the autosave slot | Greyed where this build has no autosave slot, saying nothing writes to slot 0 behind your back — so there is nothing to guard against. |
| Clear anchor | Greyed when there is no anchor to clear. |
| A Compare chip | Replaced by a dead label carrying its reason where the anchor was taken before that section could be read, or where the anchor stopped at the actor cap — `snapshot.actorMax` in the settings file raises it. |
| revert | Greyed, with the reason on a hoverable wrapper, where the variables module did not load and there is no verified write to revert through; where the value is outside what this project defines or is a list; or where that control's writes are not sticking, in which case the panel also carries the degraded note and its "try again". |
| copy diff | Greyed when nothing is listed. |

Where something has replaced the engine's save after GigaHack wrapped it, the
Automatic group warns that the next save may not move the anchor, and points at
Debug → Hooks for what is patched.

**Not compared**, said in the panel: the screen — tint, weather, shake, zoom
and the picture slots; the timer; event pages, move routes and running
interpreters; the message queue and the troop, neither of which the engine puts
in a save at all; variables holding a list or an object, which are text rather
than field by field; actors past the cap; and anything a plugin added to the
save, which Debug → Compare lists by name.

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

### Blocked

Why is this event not doing anything. `meetsConditions` returns one boolean for
all six of a page's stored conditions and records nothing about which of them
failed, so the only way to say which is to evaluate the six again — and that
means this panel's answer can disagree with the engine's. The disagreement is
not hidden: it is the single best available signal that something outside the
six stored fields is deciding pages, a note-tag condition or a replaced page
test, so both answers are reported and neither is insisted on. Two further
things the engine does silently are stated here rather than left to be
discovered. It takes the **highest-numbered** page whose conditions are met, so
"every condition on this page is met" and "this page runs" are different
statements and a fully satisfied page can be permanently shadowed by a later
one; a report that only listed unmet conditions would give the wrong answer for
it. And an **erased** event has no page at all, which is a different state from
"no page qualifies" and arrives at the same answer by a different route.

| Control | What it does | Unavailable when |
|---|---|---|
| Event | Every event on the loaded map, by id and name. Picking one selects it for the map overlay too, and the overlay's selection picks it here. | — |
| Page | Which page's box is open. An event with eight pages gets a chooser rather than eight open boxes. | — |
| select on the map / open this event in Commands | Hands the selection to the overlay, or jumps to the decoded command list for this event. | The Events module did not load; the reason is in the tooltip. |
| move player here | Puts you on the event's tile. The tooltip says a touch trigger then fires. | Same. |
| Cross-check | Whether the engine's active page and the six stored conditions agree. Where they do not, it names both in words and says something is deciding pages these fields do not describe. | — |
| Pages | One box per page, tagged and with a line in words: active, met but shadowed by page *n*, blocked by *x* of *y* conditions, or erased. | — |
| Condition row | The stored condition, the value now and the value needed, coloured by whether it is met. | — |
| set it | Writes exactly what the condition needs, through the same controls World → Variables and World → Switches use, so the write is verified and undoable. Degraded marks `vars.set` / `switches.set`. | Item and actor conditions get a disabled button with the reason and, beside it, the panel that does satisfy it — Items → Items, or Player → Identity. |
| who sets this | Everything in the project that reads or writes this switch, variable or self-switch letter. | — |
| only the conditions that are unmet | On by default. Turning it off lists the met ones too. | — |
| show the pages that already run | The running page is hidden by default, because it is not the one you came here about. | — |
| re-check now | Re-reads every condition. | — |
| What this cannot see | Collapsed. Says that six fields are all a page stores, that a plugin can add conditions through note tags or replace the page test outright, and which plugin suites this build recognises. | — |

Each of the six is evaluated exactly as the engine evaluates it, and the
exactnesses are what the rows say out loud. The variable test is `>=`, so the
one-click fix writes exactly the value named — one past it overshoots and one
below never satisfies it. The self-switch key is built from the **event's own**
map id and not from the map you are standing on: an event spawned from another
map's data carries a different one, and a key built from the current map then
addresses an entirely different self-switch, so the row says when the two
differ. That switch is read through the engine's own accessor, so a value stored
as `1` rather than `true` reads as the engine reads it — and the row still names
the raw value it found, because the engine coerces and a plugin that replaced
the accessor may not. The item test asks for one in the bag with equipment
excluded, so a copy worn in an equip slot does not count; the row says which of
the two it is rather than only that the item is missing, because that is the
case a player hits and blames on the menu. The party test is read live and never
cached across a scene change, since some frameworks redefine it to mean the
battle members while a battle is running.

**Who sets this** is a join rather than an index lookup. The boot index walked
map events and nothing else, so an answer built on it alone silently misses
every common event in the game — which reads as "nothing sets it". The loaded
map, the common events and the troop pages are scanned live and are always
available; the other maps come from the index as candidates. Under every such
table is a line saying what each of the four halves could see, whether or not it
found anything, because an empty list with no reason attached is the one wrong
answer these panels must never give. A row on the map you are already standing
on carries live coordinates and selects the event instead of teleporting to it.

The panel says "no map loaded" on the title screen, and on a map with no events
points at World → Teleport. While it is the panel on screen its value cells are
rewritten on a clock; the panel itself is rebuilt only when the **shape** of the
report changes — a page went active, a page appeared or vanished from this view,
the event was erased — rather than several times a second for a number that
moved by one. With the overlay closed or another sub-tab showing, the refresh
does nothing at all.

### Common

The Forge can run a common event it made and copy one of the game's into its
editor; there was no way to look at, gate or run one the game shipped. Two
engine facts shape the panel. Only a **parallel** common event is instantiated
by the map — an autorun one runs on the map's own interpreter and appears in no
live list — so "there is an object for it" and "its gate switch is on" are two
facts from two sources, and they are labelled as such rather than merged into
one word. And the reservation shape differs between builds: one holds a single
reserved id, where a second reservation overwrites the first with no error at
all; another holds a queue and appends. Which of the two this is, is probed from
the accessor the build has and never from which engine it is, and the panel says
which it found — on the single-slot shape a second run would otherwise discard
the first silently.

| Control | What it does | Unavailable when |
|---|---|---|
| Search | Id, name, or the text of the decoded commands, so a common event nobody named is still findable by what it says. | — |
| Trigger | any / called only / autorun / parallel. | — |
| only the ones whose gate switch is on | — | No common event in this project has a trigger at all; the tooltip says so. |
| hide the ones with no commands | On by default. An empty row is a slot the editor left behind. | — |
| Common events table | Id, name, trigger, gate and command count. A row with no commands is dimmed; one the Forge wrote is marked. | — |
| Gate switch (readout) | The switch, its name and its state — or "none — it is called, never triggered", or "unset (0) — the editor never picked one, which is why it never fires". | — |
| gate switch (toggle) | Writes it through the same control World → Switches uses, so it is verified and leaves one undo entry. Degraded marks `switches.set`. | Called-only, or the gate left unset. Both are dimmed with the reason, and the write is re-checked on click: writing switch 0 is a write to nothing that reads back as a success. |
| Live object | Whether a parallel one has an interpreter, is parked, or has no object — and, for the other two triggers, that only a parallel one gets one. | — |
| Run this session | How many explicit calls have passed through the counter. | The counter is not installed; the row says "not counted" with the reason. |
| run it now | Reserves it through the engine's own path and reads back that the engine accepted the reservation, because one it did not accept looks exactly like one it did. Confirmed, backed up first, and irreversible — it can set switches, transfer you or start a battle. | Disabled with the reason stated up front, listed below. |
| who calls this | Every call to this common event in the common events, the troop pages and the loaded map, each with the command it sits at. | — |
| open in the Forge editor | Switches the Forge to common events so the row can be copied into a draft. | The Forge module did not load. |
| Commands | The decoded command list, indented as the event is, through the same decoder the event inspector uses, so an unknown code reads identically in both. | Where the Events module did not load the rows are raw codes, and the panel says that is why. |

**Run this session** counts explicit *Call Common Event* commands only, and the
panel says so next to the number: an autorun or parallel one never passes
through the counter, so a 0 there does not mean it never ran. Where the counter
is absent the row reads "not counted" with a reason, and the two absences take
two different sentences — the engine method was never there, or the alias was
removed in Debug → Hooks — because reporting the first for the second sends you
looking for a missing method that is sitting right there.

**run it now** decides its refusal before anything is spent, since the backup
copies the save directory synchronously and must not be paid for a call that
then refuses. It is disabled, with the reason on screen, when: the common event
has no commands; there is no common event with that id; this build has neither
reservation accessor, so nothing here can run one; it is parallel and its gate
switch is on, so the engine is already running it every frame; it is autorun and
its gate switch is on, so the map's own interpreter already has it; or this
build holds one reservation at a time and one is already pending. Starting one
the engine is already driving runs the same command list on two interpreters at
once, and every gold, item and variable change in it then applies twice.

**Who calls this** is a live scan, and says under itself that events on other
maps are not covered: the boot index records the switches and variables an event
touches, not the common events it calls. The panel is replaced by a line saying
the common event list is not loaded yet on the title screen.

### Quests *(only where the project's own flag names group into chains or sections)*

Nothing in either engine records a quest. What a project with quests has instead
is a run of switches its author named and a menu that reads them, so this panel
is **inference over the project's own switch and variable names**. It says that
before it says anything else, and every group carries the sentence saying what
it was inferred from. Two rules, both derived from the project's own names and
never from a word list — an English one matched nothing on a non-English project
once already. A **stem** is a name whose last token is a number and whose
remaining tokens are shared with others; two shared leading tokens are required,
and that requirement is the whole rule, because a one-token stem groups `sw_1` …
`sw_1100` into one meaningless quest of a thousand members. A project naming its
flags `q1 q2 q3` is then missed, which is the right side to fail on: this
degrades to nothing rather than to a guess. A **section** is a run under a
section header, using the convention the profile detected for this project — the
same one World → Gallery uses, kept in one place rather than copied a fourth
time. With both on, chains claim their ids first and a section lists only what no
chain took, or a chain would appear twice, once as itself and once buried inside
its section.

| Control | What it does | Unavailable when |
|---|---|---|
| Filter | By group title. | — |
| Group by | section headers / shared name stems / both. | "section headers" is offered and disabled where this project uses no section-header convention, which the panel states rather than dropping the option and leaving a hole. |
| Smallest (2–10) | How many named members a run needs before it counts as a group. Re-infers on change. | — |
| show the finished ones | — | — |
| re-infer | Reads the names again. | — |
| Group box | Title, done of total, and the evidence line saying what this group was inferred from — how many names, which stem or which header, and what was left out. | — |
| Step row | One per member: a checkbox for a switch, an editable value for a variable. Both write through the same controls World → Switches and World → Variables use. Degraded marks `switches.set` / `vars.set`. | — |
| who sets it | The same join the Blocked panel uses — the loaded map, common events and troop pages live, other maps as index candidates, with a line saying what each half could see. | — |
| Counter | A non-ordinal name sharing the chain's stem, read as the progress counter the project wrote beside it, with its live value. | Only shown where the project wrote one. |
| Next | Which step is next, and the event that appears to set it, by name and map and coordinates, with "go". | "go" needs a hit on a map and the Teleport module; otherwise the line still names what it found, or says nothing in this project appears to set it. |
| advance one step | Sets the next step. Confirmed. | Refuses a variable step and says why: nothing in the names states what value it should reach, so World → Variables sets it directly. |
| complete this one | Switches on every switch step in the group in **one** bulk write, so the group comes back in one undo step and the log gets one line rather than one of each per step. Confirmed. | The group has no switch steps. A note names the variable steps this does not cover. |

A section rule with nothing else in it groups every run under every header, and
on a project that names its thousand spare flags `sw_1` … `sw_1100` that is
thirty-five "quests" of forty-five members each with the two real chains buried
among them. The signal that separates them is in the names and needs no word
list either: a leading token shared by a **quarter** of everything the project
named is not a name, it is the placeholder the editor wrote. Flags named that
way carry no information, so they are not read as steps, a section left with
nothing else is not a group, and the panel names the placeholder in words and
how much of the project uses it — World → Bulk sets a range of those directly.
On a project that genuinely names its flags no token reaches the share and
nothing is excluded.

Steps are ordered by the number at the **end of the name** and not by id: a
project that inserted step 3 late gave it a higher id than step 4, and id order
then tells the story backwards.

**Where nothing groups there is no panel**, and the log carries the reason: the
switch and variable names could not be read; the project leaves too much of them
blank, with the fraction and the floor it fell below; no run sits under a section
header or shares a two-token stem with an ordinal tail; or the only groups found
have fewer members than the smallest-group setting. Every one of those ends with
the same sentence, because two panels do the same job without the guess — World
→ Switches lists every flag raw, and World → Find answers which event sets one.
The answer "nothing to group" is not treated as final, so a plugin that reloads
the database gets a fresh answer out of it rather than a stale one.

### Script

Every line this project can show the player, with the scope of the answer
attached to each source. Two things it must never imply. Only a text **state**
is converted, so what an event command stores is raw: a `\V[5]` in this list is
a reference the game resolves later and not what the player sees, and the detail
box says so whenever the stored string still carries an escape code. And the
half that covers the maps you are not standing on is a **second walk of the same
files the boot index read** — the index records which switches and variables an
event touches, not what it says — so it is never started at boot, it is chunked
through idle time on the same budget the index uses, it is cancellable, and it
is cached against the same fingerprint, so a patched game does not read its old
answer back.

| Control | What it does | Unavailable when |
|---|---|---|
| Search | Any word, matched against the line and against where it was found. Kept across a rebuild, so the box always shows the query that is filtering the list. | — |
| messages / choices / scrolling / descriptions / terms / comments | Which kinds are listed. Comments are off by default and the chip says why: those codes are never shown to the player. | — |
| Scope | everything / this map / common events / troop pages / database / other maps. | "other maps" with nothing behind it yet says so and names the state of the scan rather than showing an empty list. |
| strip the message codes | Strips escape codes, including the invisible control-character form — stripping only the backslash form leaves a line reading `c[14]Name:` with nothing to explain it. | The Text module did not load. |
| Max rows (100–50000) | How many rows are drawn. | — |
| copy the visible rows | Where, kind and text for everything currently listed, to the clipboard. | — |
| State | not scanned yet / scanning *n* of *m* with a percentage / ready, with the file and line counts / not searched, with the reason. | — |
| scan every map file | Starts the second walk. Starting it twice runs one walk, not two. | No filesystem, or no map files found under the game root; the reason is printed and the button is dimmed. |
| cancel | Stops the walk and keeps nothing — half a cross-map answer presented as a whole one is worse than no answer. | Only offered while scanning. |
| forget the scan | Throws the result away. | Nothing has been scanned. |
| Scope of this answer | One row per source — the loaded map, common events, troop pages, database rows, system terms, other maps — each either complete or carrying the reason it is not. | — |
| Lines table | Where, kind and text, each cell elided in place with the whole line on the row's tooltip. Clicking a row opens it. | — |
| go / pick | A row on the map you are standing on selects that event; a row on another map teleports to it. | Dimmed with the reason on a common event, a troop page or a database row, and where the Teleport module did not load. |
| The line | The full text of the selected row, with the note about stored escape codes where it carries any, and the note that scrolling text is never stored converted. | Says "click a row to read the whole line" with nothing picked. |

What each source contributes is decided by what that source actually holds
rather than by symmetry. A speaker row is emitted only where the build stored a
name on the message command, because presenting an absent field as an empty one
is a claim about the build. State text is read from its four message fields and
not from a description, because a state has none on either engine and reading
one would dump an empty row per state. The terms list skips the nulls the editor
leaves where a command was removed, which would otherwise print `null` as a line
of the game's script. Choices contribute a row per choice and a row per branch
label the player sees, cancel included.

A row dropped by the cap is announced — "stopped at *n* rows of *m*" — rather
than left as a short list presented as a whole one. A hit in a map file the map
tree has no row for is dimmed and marked rather than shown under a name it does
not have; a half-deleted map looks exactly like that. A file that could not be
read or is not valid JSON becomes a per-file note on the scan, not a failed
scan. The panel says the database is not loaded yet on the title screen.

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

### Shop

There is no shop object in either engine. A shop is an event command: Shop
Processing collects its rows into a goods array, pushes `Scene_Shop` and then
prepares that scene with the array, and that is the whole of it. So the honest
artefact is a goods list plus the same two steps in the same order —
`prepareNextScene` reads the scene the push has just constructed, so preparing
first throws. A goods row is `[type, id, priceType, price]` on both engines,
with priceType 0 meaning "read the item's own price" and 1 meaning "use the
number in the row". This panel builds that array and hands it to the engine's
own scene; it does not draw a shop, and it does not touch the project's own
shop events.

The engine's own buy window drops a row whose id does not resolve, with a bare
`if (item)`, and the shop simply opens shorter — no error, no gap where the row
was. So every row is re-resolved against the live database before the scene is
pushed, and the ones that would go are counted and named here instead. That is
not a hypothetical: `$data*` is rebuilt from the project files at every launch
and the Forge adds and retires rows underneath a saved draft, so a list that
opened correctly last session can be short this one.

| Control | What it does |
|---|---|
| Kind | Items, weapons or armors — which database the picker lists. |
| Search | By id or name, index-backed with a linear fallback and a printed reason. Every candidate is re-resolved against the live row; the index is never authority. |
| `owned only` | Only rows the party is carrying. |
| Picker row | Icon, id, name, type, the database price, how many you have, and "add" — which reads "added" for a row already in the list. The pool is the Items module's own list, so a database the Forge has extended is in it without a second scan that would disagree with the Items panel. |
| Goods list | One row per goods entry: kind, id, name, price, and ↑ ↓ × per row. A row whose id no longer resolves is marked, kept under the name it was added with, and its tooltip says it would be dropped. A duplicate is flagged rather than removed — the shop shows it twice, which may be what you meant. |
| Price cell | Editable. A row using the database price shows it greyed; clicking that cell turns it into an override starting at the same number, and clearing an override puts the row back to priceType 0. |
| Rows / Would be dropped / Duplicated | Live counts over the draft. A row asking for the database price whose item has none is called out, because the shop would be handed 0 rather than an undefined price. |
| Clear the list | Confirms. Edits GigaHack's own draft, not the game. |
| New rows use | The database price, a fixed amount, or a percentage of the database price. This decides only what a **newly added** row gets; every row stays editable in the list. |
| Purchase only | The second argument to prepare. With selling left on, the engine pays `floor(price / 2)` — the buy price is the only one a goods row carries. |
| Close the menu when it opens | Whether the overlay gets out of the way. |
| Open the shop | Confirms, backs the save up first, then pushes and prepares, in that order. |
| What a shop is | How many rows the last shop this game opened carried and whether it was this one, plus "capture those rows" — which replaces the draft with what that shop was built from. |

"Open the shop" is disabled with the reason stated, rather than failing after a
confirm. Every one of these is a reason the **engine** would refuse or the
result would be thrown away, not a preference of this menu:

| Reason | What it means |
|---|---|
| no party yet | Start or load a game, then reopen this tab. |
| this build has no `Scene_Shop` | A plugin removed or renamed the shop scene, so there is nothing to push. The goods list is still kept and still editable. |
| not from a battle | The engine's own Shop Processing command refuses this too, and a purchase made here would be rolled back with the battle. |
| not from the title | A new game is already set up there, so the shop would spend gold that is thrown away the moment a game is started or loaded. |
| a scene change is already pending | Pushing now would replace it and leave the stack one entry deeper than the scenes actually visited. |
| a message is on screen / an event is running | Dismiss it, or wait for it to finish. |
| add something to the list first | The list is empty. |
| none of these ids resolves | The shop would open empty. |

Not a refusal, but printed next to the button anyway: away from the map,
closing the shop returns you to the scene you opened it from rather than to the
game.

`Scene_Shop.prepare` is aliased as an observer that changes nothing, because it
is the only moment a shop's goods exist as data anywhere. It serves twice: it
is the read-back that proves our own goods reached the scene, and it is what
turns any shop the game itself opens into a draft you can edit and reopen.
Where it could not be installed the panel says so and does not offer to
capture. A push that constructs no scene is reported rather than dereferenced —
`push` calls `goto` and `goto` is what builds the next scene, so a missing one
means something has replaced one of them, and the panel says that instead of
claiming the shop opened.

The draft lives in `shop.json` in GigaHack's own store rather than in the save,
and the panel says when the list in front of you was read back from there
rather than built this session. Opening is refused in read-only mode, and marks
`shop.open` degraded when the goods do not reach the scene, with "try again"
next to it. The panel is always registered so the tab never changes shape under
you; what degrades is the body, which names the inventory module and points at
Debug → Environment when the pickers have no list to draw from, and says to
start or load a game when there is no party yet.

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

### History

Everything that has been said this session, searchable. On most games there is
no backlog to borrow — `Game_Message` is core and generic, but keeping a
scrollback of what has been said is a plugin, and a different one on every game
that has one — so GigaHack records its own.

There are two possible sources and the panel always names the one it is
showing. Where the game has no backlog of its own there is only one, and no
selector.

| Source | What it is |
|---|---|
| **recorded here** | A ring buffer GigaHack fills from the message window as pages play. Works on any game, holds the choices made and where each line was said, and lives only in memory. |
| **the game's own** | The profile's `backlog` adapter — offered only where the game declares one. It is saved into the savefile, so it usually holds far more than a session, and it is what the game's own backlog scene shows. |

With no stored preference the game's own is preferred where it exists and has
something in it, because ours starts empty at every launch.

**Where the recording comes from.** `Window_Message.startMessage` is the one
point on both engines where a page has been assembled and not yet drawn, and
every message reaches it — the interpreter's, a plugin's, a script call's.
GigaHack loads last, so its alias sits outside any message plugin's and still
sees the page where the whole method was replaced. It listens **after** the
original runs, not before: `\V[5]` is resolved by the engine exactly once,
inside that call, and a recorder that captures first stores the reference
instead of the number — which is then unrecoverable, because the variable has
moved on. Where there is no message window the fallback listens to
`Game_Message` itself; that path sees no substitution, so it runs only when the
window could not be hooked, and the panel says which of the two is live.

| Control | What it does |
|---|---|
| Search | Line text or speaker, over a form folded once per record rather than per keystroke. |
| everything / dialogue / answers | Answers are the choices, numbers and items you picked. |
| copy | Everything currently listed, to the clipboard. |
| export | The same, to `history.json` beside the settings file. |
| Record what is said | Off from now on; what is already recorded stays. |
| Listening to | Which of the two seams is live. |
| Speaker from | The name box, a detected `Name:` convention, or nothing — see below. |
| Pages kept | And how many have rolled off the front, rather than losing them quietly. |
| Keep (50–5000) | Pages held in memory. Each stored string is capped too, and a truncated one says so: entry count alone is not a memory bound. |
| Read a "Name:" opener as a speaker | Turns the convention off. |
| clear the history | Undoable — nothing outside the buffer is touched. |
| Not recorded | Every hole in the coverage, named. |

**The speaker.** Three sources, none of them assumed. MZ hands over a name box
and an MV plugin that adds one adds the same method, so it is feature-detected
rather than asked of the engine. Failing that, a great many games open a page
with a short line naming who is talking, ending in a colon — but one page
reading `Warning:` above `the bridge is out` is a label, not a convention, and
treating it as one deletes the word from the history. So the rule is
**detected**: it applies only once at least three pages agree and they are at
least a fifth of the pages recorded. Failing both, there is no split and every
line is listed as it was said.

**What is not recorded**, listed in the panel rather than left as a gap: the
battle log, which keeps its own lines and never touches `Game_Message`; any
window a plugin draws from its own text buffer; and anything said before
GigaHack loaded.

A new game or a loaded save does not wipe the history — the line before the
break is often exactly what you reloaded to re-read — it marks the break and
carries on. A page the mod itself queued from **Say something** is labelled as
one, so what the game said stays distinguishable from what you made it say.

**Where the game has its own backlog**, that source keeps the controls it
always had: the lines it holds, which colour index marks a speaker header
(detected, not assumed), a limit whose tooltip says whether this game can put
trimmed lines back, a clear that is confirmed where there is no restore, and
"open in game" where the adapter offers a scene.

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

### Screen

Every animated field on `Game_Screen` is a **pair** — a value and a target — and
`update()` walks the value toward the target once per logical step. Writing
`_tone` on its own is undone within `_toneDuration` frames with nothing in any
log, and the same is true of the zoom scale, the weather power and all five
animated picture fields. So every write here sets value *and* target *and*
duration together, or goes through the engine's own timed call with a duration,
and there is exactly one function per field that does it. Two further facts
shape the rest of the panel. Nothing in the engine ever clears the tint or the
weather by itself: `clear()` runs only when the object is built, and the
start-of-battle reset clears the fade, the flash, the shake, the zoom and the
battle picture range while deliberately leaving the tone and the weather alone —
which is why a stuck tint survives a fight and a stuck zoom does not. And a
black screen has **four independent causes, of which `$gameScreen` can see only
two**: the tint, the brightness, the scene's own fade, and a picture covering
the screen. Reporting "the tint is clear" while the screen is black is the
silent failure this panel exists to prevent, so the diagnosis covers all four
and names which mechanism each belongs to.

**Right now** — the live readout, repainted on its own clock, each row writing
only when its own text changed:

| Row | What it shows |
|---|---|
| Tint | The four numbers, with a swatch of a mid-grey wearing them. |
| Walking to | The target and the frames left, shown only while a walk is running. Says "held — not moving" while the game is paused, because the walk runs from `Game_Screen.update` and that does not run on the paused path. |
| Brightness | 0–255, flagged when fully dark. |
| Scene fade | The scene's own fade opacity. The tooltip names the field it was read from. |
| Flash | Alpha and the frames left; the colour is in the Flash group. |
| Shake | The live offset in pixels and the frames left. |
| Zoom | Scale and centre. |
| Weather | Type and power. |
| Pictures | Occupied slots of the total. |

**Is something stuck?** names every field holding a non-default value with no
duration left to move it — the tint, the brightness, the scene fade, a picture
that could be covering the screen, the weather, the shake offset, the zoom, and
a flash colour left behind with no duration. Each entry says what it found, what
in the engine leaves it that way, and the control or the console call that fixes
it. Empty is a **positive** answer, "nothing on `$gameScreen` looks stuck", and
it is only safe to give because the line under it says what none of this can
see: a picture covering the screen, the scene's own fade, or a plugin's own
overlay. The picture test is deliberately narrow — full opacity, normal blend,
the untranslated origin, and a top-left at or before the screen origin — because
a looser one would report every legitimate full-screen background as a fault,
and a diagnosis that cries wolf is worse than none.

**Escape hatches**, kept above the diagnosis rather than below it, because the
diagnosis is several paragraphs exactly when the button must not have been
pushed off the bottom of the sidebar:

| Control | What it does | Unavailable when |
|---|---|---|
| Unstick everything | Clears the tint, brightness, flash, shake, zoom and weather, clears the scene fade, and switches all three holds off — leaving one armed means the next frame puts back what you just cleared, which reads as the button not working. One undo entry, and it is the command the diagnosis names. Also on its own rebindable hotkey, and as `GigaHack.api.unstick()`. | — |
| Clear the scene fade | A one-frame fade **in**, which is the only way out: the scene owns this value and no event command touches it. | No scene is running, or the scene has no `startFadeIn` because something replaced `Scene_Base`. The reason is printed, and adds that reloading the map rebuilds the scene. |
| Log every write | The same switch as the Screen log panel. | — |

The effect groups:

| Control | What it does | Unavailable when |
|---|---|---|
| Tint: Red / Green / Blue / Grey | −255 to 255, grey 0 to 255. The drag only repaints the swatch and the **write is on release**: each write is a verify plus a journal entry plus a drift watch, and one per pointer move is none of those things. | Degraded marks `screen.tone`. |
| Over (tint) | Frames; 0 applies at once. | — |
| Presets | The engine editor's own five — normal, dark, sepia, sunset, night — not any game's. The one matching the live tone is lit. | — |
| Apply / clear the tint | — | Degraded marks `screen.tone`. |
| Brightness | 0–255. There is no engine setter for the brightness itself, only the two fades, so writing it zeroes both fade durations as well — otherwise an in-flight fade walks it straight back. | Degraded marks `screen.brightness`. |
| Fade out / fade in, over *n* frames | The engine's own calls. | `startFadeOut` or `startFadeIn` is not a function on this build; each is named separately. |
| Flash colour / strength / frames / flash | Strength is the alpha. | Degraded marks `screen.flash`. |
| Flash stop | — | Nothing is flashing, which the group also says in words. |
| Shake power / speed (0–9), frames, shake | — | Degraded marks `screen.shake`. |
| Shake stop | Writes the **offset** to zero as well as the duration. | — |
| Zoom scale (0.1–4×), X, Y, Over | X and Y are bounded to the drawing surface. | Degraded marks `screen.zoom`. |
| Zoom apply / reset | An instant zoom is written with `setZoom` and the target after it: `startZoom` with a duration of 0 sets the target and the duration and never touches the scale, so the engine's own instant zoom does nothing at all, and leaving the target unwritten makes the next timed zoom ease from a value nobody set. | — |
| Centre on the player | Puts the zoom centre on the player's screen position. | No map is loaded, so there is no player position to centre on. |
| Weather type | The engine's four, plus whatever the live value is when it is not one of them. | — |
| Or by name | Free text. Neither engine validates the string — the weather update copies whatever the field holds straight onto the sprite — so a weather plugin can define as many names as it likes and no panel can enumerate them. The honest offer is the engine's four, the current value whatever it is, and a box. | — |
| Power (0–9) / Over / apply / stop | The engine draws power × 10 particles. | Degraded marks `screen.weather`. |

**A shake at power zero never settles.** `updateShake` moves the offset by
power × speed × direction ÷ 10 and only snaps it back to zero on the frame the
sign would flip. At power 0 the delta is 0, the sign never flips, the duration
counts past zero, and the screen keeps whatever offset it had — permanently, and
across saves. Clearing the duration alone, which is how a shake is usually
stopped, does not move it back. That is why "stop" writes the offset too, and
why the group says so in place rather than leaving it to be discovered.

**Weather in a battle** is written but not drawn: the engine's own weather
command refuses to run in a battle and the battle spriteset has no weather
sprite at all, so the panel says the change will appear when you are back on the
map rather than letting the control look broken. On the map, a spriteset with no
weather sprite is reported as replaced rather than as working, and the readout is
then what `$gameScreen` holds and not necessarily what is on screen.

**Holds.** Three fields can be held: the tone, the weather and the zoom. A hold
does two things and a caller cannot arm one without the other. It re-asserts the
value once per logical step **after** the engine has walked it — asserting first
lets `update()` move it on the same frame and the hold looks as though it half
works — and it overrides the engine's own start call from inside the alias, so
an event's attempt is recorded as overridden rather than silently lost. Turning
a hold on captures the value that is live now, so it never snaps the screen to a
state you did not ask for. Where the matching alias could not be installed, the
hold still puts the value back on the next frame, one frame late, and the panel
says the attempt will not be recorded. All three are **forced off at every
launch** and stripped out of a settings profile when one is applied: a saved
"hold the tone black" would re-assert from the boot screen, before the overlay
that could switch it off exists, and is indistinguishable from a crash.

**The drift watch.** Write-and-read-back is a same-tick check, and a plugin that
recomputes a field inside `Game_Screen.update` passes it and reverts one frame
later. So every instant write here also arms a watch for a few frames. When the
value moves back, the diagnosis says how many frames later it happened and names
the Screen log entry that arrived in between — or, where nothing was recorded,
says that whatever changed it does not go through the engine's own start
functions and writes the fields directly. Without that second half a "verified"
write is a lie.

Where `Game_Screen.startTint` is missing — something replaced the object without
keeping it — the tint controls write the three fields directly and the panel says
so; the readout is unaffected. The same applies where `Array.prototype.clone` is
gone: it is the engine's own extension and both the tint and the flash calls use
it, so those two controls bypass them rather than throwing from inside the
engine at a stack frame nobody would connect to the control they clicked.

A collapsed **where the screen state lives** group names, for this build rather
than for an engine, what actually draws the tint, the brightness and the flash.
Those three are probed off the **live spriteset**, never derived from the engine
name: one engine picks between a colour filter and a child sprite at boot
depending on the renderer, so naming the mechanism from the engine is wrong on
one of its two paths. The group also carries the field the scene fade was read
from, the two lists of what a battle clears and what it deliberately does not,
and the answer to what the engine clears otherwise, which is nothing.

The whole panel is replaced by "no game running" on the title screen: every
value on it lives on `$gameScreen`, which the engine builds when a game starts.

### Pictures

Every picture slot is read through `picture(n)`, never held. `realPictureId`
adds `maxPictures()` to the id while a battle is running, so slot 1 on the map
and slot 1 in a fight are different objects in different array positions, and the
panel always says which of the two ranges it is reading. Nothing keeps a
`Game_Picture` reference across a repaint either: `$gameScreen` is replaced
wholesale when a save is loaded, so a held reference points at a dead object and
shows the wrong picture with no symptom at all. The target trap that shapes the
Screen panel applies here five times over — position, scale and opacity each
have a target beside the value — so every edit writes the target with the value
and zeroes the duration, or a picture edited mid-move snaps to somewhere neither
value ever was.

| Control | What it does | Unavailable when |
|---|---|---|
| Slots | How many slots this build has, and where the number came from. `maxPictures()` is asked of the live object on every call, because one engine returns a literal and the other reads the project's own setting, and a plugin can raise it or take it away at any time. | Where there is no `maxPictures()` the count is 100 and the row says it is assuming. |
| In use / Showing something | Two questions with two answers: a slot can hold a picture with an empty name, which draws nothing and is still occupied. | — |
| Reading | Which id range the table is showing, with the range written out. | — |
| Sprites built | How many picture sprites the spriteset actually made. They are created once, when the scene is built, so a slot above this number is stored and never drawn. | The spriteset's picture container could not be read; the row is left out rather than guessed at. |
| Filter by name, and in use / showing something / all | The dropdown's choice is remembered between sessions. | — |
| Show thumbnails | Adds a preview column to the table. Bitmaps are re-fetched on every repaint and never cached, because a cache-clearing plugin can destroy the one we are holding. | `ImageManager.loadPicture` is not a function on this build. |
| Erase every picture | Both ranges, under one undo entry, with a confirm. | `erasePicture` is not a function, or `$gameScreen` has no `_pictures` array on this build; either way the slots can still be read. |
| Slot table | One row per slot: number, name, origin, position, scale, opacity, blend mode, and the frames left on a move in flight. Name, position, scale and opacity are editable in place, each writing its target and zeroing the duration; the × erases the slot. Unoccupied rows are dimmed, and a row in the battle range carries its array index in the tooltip. | Degraded marks `screen.picture`, which every write on this panel shares. |

**Selected slot** — the editor for one row:

| Control | What it does | Unavailable when |
|---|---|---|
| Name + apply | Writes the name and nothing else. The sprite compares its own cached name and reloads on the next frame by itself, so no sprite has to be touched from here. | The slot holds no picture, which is said rather than left to fail. |
| File | The path this name resolves to. Shortened from the middle when the row is too narrow, copyable in full, and the row's own label stays readable beside it. | The slot has no name, so nothing is drawn — which is what the row says. |
| in the index / not in the index / the index cannot say | Whether the asset index lists the file. The third is a **different answer** from the second and is never rendered as "the file is missing"; the index's own reason is printed verbatim underneath. | — |
| Check it | Loads the name through the engine and reports **one frame later** whether the bitmap came back — a cache miss is asynchronous, and the answer on the same tick is "not yet" for every file, present or absent. | The slot has no name, or `ImageManager.loadPicture` is absent. |
| Origin / Blend / Angle | Upper left or centre; normal, add, multiply or screen. | — |
| Move to x · y · frames, then move | A timed move goes through the engine's own call with **ten arguments always**: the tenth is an easing type on a build that has one and is ignored on a build that does not, which is the only safe way to call one function with two arities. The panel prints which of the two this build is, so it never claims an easing that was not applied. | — |
| Erase this slot | — | — |
| Show a picture here | Shows a name from the picture folder in this slot, keeping its current position and origin. | `showPicture` is not a function on this build; or the slot is above the sprites the spriteset built, which is refused with that number and the note that leaving and re-entering the map rebuilds them. |
| Its tone | Four sliders, collapsed by default. A slot with no tone yet says the first change creates one. | — |

An erase is undone by putting back a copy made with **the engine's own deep
copy**, which is the only safe one: a serialiser plugin can replace it, and a
plain JSON round trip succeeds and hands back an object that answers every field,
has no prototype, and then throws from inside the engine's picture update on the
next frame at a stack frame nothing connects to the erase. Where that copy is
unavailable the erase still works and the log says it could not be undone.

"Erase every picture" clears **both** ranges under one undo entry. The engine's
own erase cannot reach both by itself — it routes every id through the battle
shift, so outside a battle it can only ever touch the map half — so the current
range goes through the engine's function and the other half is nulled directly,
which is what that function does anyway: it writes null rather than deleting, so
the array keeps its length and the picture update still visits the slot.

The whole panel is replaced by "no game running" on the title screen. Where
`$gameScreen.picture` is not a function — something replaced `Game_Screen`
without keeping it — the panel says the slots are not readable here, and adds
that the tint, weather and zoom controls on the Screen tab still work.

### Screen log

Every write that went through the engine's own `start*` functions, with who was
running when it happened. The aliases sit on `Game_Screen` rather than on the
interpreter's command handlers, because an event command is only one of the
callers: a plugin or a script call reaches the same functions and, on a modded
game, is most of the traffic. Ten are installed — tint, weather, shake, flash,
fade out, fade in, timed zoom, instant zoom, show picture, erase picture — and
both zoom entry points are hooked, because the instant one is the one a plugin
actually uses and hooking the timed one alone would log the zooms that do nothing
and miss the ones that work. What no alias can see is a plugin writing the
private fields directly, and the panel says so rather than implying the list is
complete.

Attribution is the other half. Each entry names the **deepest running**
interpreter, not the one that called it: a common event that called another runs
its callee's list on a child, and naming the caller there is confidently wrong,
which is worse than saying nothing. A called common event carries event id 0, so
it is identified by its command list rather than by an id it does not have. Only
a child that is actually running is descended into, because the engine drops a
stopped child on its *next* visit and a finished one would otherwise be named as
the writer. With nothing running, the entry says a script call or a plugin did
it rather than blaming the last event.

| Control | What it does |
|---|---|
| Record screen writes | The same switch as the Screen tab. Off means no entry and no interpreter probe. |
| Keep (20–2000) | The ring is memory-only; nothing survives a relaunch. Bounded on purpose — a parallel event calling the flash sixty times a second turns an unbounded diagnostic into the leak. |
| Show | Which of the seven kinds are listed: tint, fade, flash, shake, zoom, weather, picture. Filters the list only; every kind is recorded either way. |
| Filter | Free text over the formatted arguments and the caller. |
| Clear the log | Also clears the drift reports, because every one of them names a log entry by number and a number that is no longer in the log is worse than no report at all. |
| Copy the log | Everything currently listed, to the clipboard. Says so where there is no clipboard. |
| Recorded / Kept / Dropped | Three numbers, never one: once the ring saturates, "kept" stops moving and only "recorded" says anything is still happening. |
| Writes table | Record number, our frame, kind, the arguments in words, and who wrote it. The number is the **record's**, never the row position, since a filter renumbers positions and two rows then look like the same one. A call a hold overrode is marked as held. |
| → | Selects the event that made the write and goes to it. The recorded id is re-resolved against the live map first, and says so where the event is no longer there. |

The **→** is disabled with the reason in the tooltip: the Events module is not
installed, no event was running when this was written, or that event is on
another map.

**This entry** — the detail for a selected row:

| Row | What it holds |
|---|---|
| Kind, record number, our frame, engine frame, wall clock | Two clocks on purpose: ours orders and dedupes, the engine's is the one a player recognises. The engine frame reads "not readable on this build" where it is. |
| From, map, event, common event, command index | The attribution above, spelled out. |
| Raw arguments | As recorded. Every array is **copied**, never referenced: the caller owns its array and the engine's own functions clone it, so a stored reference would be walked out from under the log by the next frame. |
| Tint / brightness / shake / zoom / weather | What each was before this write, and what it is now. |
| Put the screen back to before this write | Restores the scalar state that was live before the entry, as one undo entry. **Pictures are not restored** and the button says so — the log stores numbers, not images. |

Reverting is refused with a stated reason where it cannot work: the entry has
rolled off the end of the log, or it carries no snapshot because `$gameScreen`
could not be read when it was recorded, or read-only mode is on.

**What is not recorded** is listed in the panel rather than left as a hole: a
plugin writing `_tone` directly without going through the engine's own call; the
scene fade, which is not a `$gameScreen` write at all and is read live on the
Screen tab instead; a picture already up and moving, since an alias on the move
would fill the ring by itself, so a move made from the mod is one entry when it
starts and its remaining duration is shown live on the Pictures tab; "erase every
picture", which records one summary entry rather than one per slot; and "unstick
everything", which writes six fields at once and is left out because the undo
stack already holds what it replaced.

The panel is replaced by "no game running" on the title screen. Where none of the
ten aliases could be installed, the sidebar leads with "nothing can be recorded"
and points at Debug → Hooks, which lists each one and the reason it was skipped.
Every skipped alias names what is lost rather than going quiet — a shake that is
not logged means a screen left permanently offset cannot be traced to the call
that did it, and a fade-in that is not logged means the log cannot tell a
fade-out that was never answered from one that was.

### Audio

A name is not a file. Everything in this panel is shaped by the fact that the
engine stores a **name** and builds the url from it later, and the two builds do
not build the same url: one escapes the path separator when it encodes the name
and the other preserves it, so a track that lives in a subfolder is playable on
one build and simply not found on the other — with no error either way, because
a missing audio file is silent until something asks for it. The encoder is
therefore probed for its behaviour (`'a/b'` in, `'a/b'` out?) rather than
inferred from a version, and a row that cannot resolve carries the reason in the
row.

A bad name is not a harmless mistake everywhere either. Where the running scene
calls the audio manager's own error check every frame — and that function throws
for any buffer reporting an error — auditioning a name with nothing behind it
drops the game onto the engine's load-error screen on the very next frame; where
the same function is defined and never called, the identical mistake is
invisible. Two defences are used together: the file is verified on disk before
the engine is asked at all, and the error check is wrapped to sweep only the
buffers this panel started, by identity, within a bounded number of frames of
the audition that created them. A game-side load failure still throws exactly as
it did — hiding a real one would be worse than the bug.

**Playing now**:

| Control | What it does |
|---|---|
| BGM / BGS | Name and position in seconds, repainted on a clock rather than every frame. |
| ME | The name where this build's audio buffers carry one, and otherwise "playing" with the reason there is no name to show. |
| SE voices / Static buffers | How many effect voices are live, and how many static buffers are held — one per distinct system sound, never freed. |
| stop BGM / BGS / ME / every SE | One per kind. Disabled where this build has no such call, which the row names: nothing here can stop it and the game's own options are the only lever left. |
| kill everything | Music, ambience, jingles and effects. Confirmed. |

**The game's own volumes** — each row writes through the game's own config, so
the mod and the Options menu agree in both directions, and every number is read
live rather than from a copy: a volume something else moved shows here without a
rebuild.

| Control | What it does |
|---|---|
| BGM / BGS / ME / SE | 0–100 %. Heard on every move of the slider, because the setter forwards to the audio manager; the config file is written once, on release. Disabled where this build's config object has no such volume — it has been replaced, and the game's own options menu is then the only way. Degraded marks `media.volume`. |
| Master | Offered only where this build's audio manager has one, and it drives video volume too. Where there is none the panel says the four above are all there is, rather than showing a fifth slider that does nothing. Degraded marks `media.master`. |
| Audio file extension / Encrypted | Both asked of the engine at the moment they are shown, never assumed. |

**The folder** — every name a folder can offer, with the reason attached to each
one that cannot be played.

| Control | What it does |
|---|---|
| Folder | The four audio folders, plus "what the database names" — the names the project's own data files carry, which is a different list in both directions: it names tracks the folder may not have, and misses every track the project never referenced. |
| Search | By name. |
| `subfolders` | Include the tracks one level down. Only offered where the listing actually has a subfolder in it. |
| Row | Name, where it came from, and play / stop. A folder row gets no controls at all — "stop" beside a folder is a question the row cannot be asked. Its tooltip carries the exact url the engine will build for that name, or the reason the row is not playable. |
| play | Auditions the name. Read-only mode refuses it like any other write, and it is verified like one: what the manager reports playing is read back and compared, so a plugin enforcing its own music is reported rather than hidden behind a button that looked like it worked. Degraded marks `media.play`. |
| forget those | Clears the list of auditions the sweep caught. |

Four reasons make a row unplayable and each is printed on the row: it is a
folder; it is a name inside a subfolder on a build whose encoder escapes the
separator, so it can be listed but not requested by name; it is a name the
project's data carries with no file behind it, in which case the path that was
tried and where the name came from are both named; or it is a name nothing here
can verify on a build with no audio error check, which is refused rather than
risked. The count shown here and the boot index's count for the same folder are
two different numbers on a project that uses subfolders — the index reads one
level and strips extensions, so directory names look exactly like tracks to it —
and the panel says so rather than leaving the discrepancy to be discovered.
Where there is no filesystem there is no folder listing at all: the list falls
back to the boot index and then to what the database names, and always says
which of the three it is showing.

**Recent** — what has actually been played, recorded whether or not the overlay
is open.

| Control | What it does |
|---|---|
| Recent table | Newest first: kind, name, the frame it happened on, and whether the game played it or this panel auditioned it. Repeats of one name inside four frames collapse into a single counted row — one attack animation firing the same effect three times is noise, not information. |
| include sound effects | Off leaves music, ambience and jingles. |
| copy | The listed rows, to the clipboard. |

Every row is recorded **after** the engine's own call, so what is listed is what
the engine accepted rather than what it was asked for: a repeat of the track
already playing short-circuits inside the manager, and which side of that branch
the "current" record is updated on differs between builds. **What is not
listed** is stated in the panel rather than left as a gap: the game's own menu
sounds — cursor, ok, cancel, buzzer — reach the audio manager by a different
call, and they fire several times a second and would drown everything else.
Where one of the four recorders could not be installed the panel names which one
and points at Debug → Hooks for the reason it was skipped.

**When you leave**:

| Control | What it does |
|---|---|
| Put back what was playing | Restores the music and the ambience the game had before the first audition. |
| put it back now | Does it immediately. Disabled with nothing saved, which the row says. |

There is no panel-leave callback to hang this on — rendering a tab clears the
per-frame hooks and nothing announces the departure — so it is a watchdog: the
panel stamps a heartbeat while it is on screen and a permanent per-frame hook
restores once that stamp goes stale. One mechanism covers a tab change, a
sub-tab change and closing the overlay alike. It arms only once the panel has
been on screen since the audition, so an audition made from the console is not
undone a fraction of a second later by a panel nobody opened. The engine's own
replay compares the **name** alone, so a track that is still the same name at a
different position is stopped first; without that, "put it back" re-applies the
volume, leaves the music exactly where the audition left it, and looks like a
broken button. A musical effect cannot be put back at all — the engine records
no saved one and no position for one anywhere — and the panel says so rather
than reporting a success it did not have, adding that the engine restarts the
background music by itself when one ends.

### Assets

The image folders the game ships, and what the engine thinks each sheet is. The
`$` and `!` filename conventions are a leading sign **run**, not a first
character: a sheet named `!$Gate1` is both flat-anchored and single-character,
and every implementation that tests only the first character gets one of the two
wrong. The engine already has the predicate, so this panel calls it and shows
what the engine concluded; where the predicate is absent the layout is still the
most useful guess available, but it is marked as a guess and the panel says why,
because a wrong grid presented as a fact is worse than a right one presented as
uncertain. Nothing here holds a bitmap, either — an aggressive image-cache
plugin pulls a held bitmap out from under a mod on a map change and nothing
reserves it — so the preview keeps the pixels it was given and re-requests the
sheet on demand.

A sheet that will not load is the dangerous case. Where the engine's readiness
test throws for an errored bitmap still in the cache, and the scene's own
readiness test calls it, one failed preview breaks every later scene transition
until that entry is gone. A failed sheet is therefore evicted **by identity**,
walking whichever cache shape this build keeps, rather than by rebuilding the
key: the two builds spell the key differently and one of them wraps the bitmap in
a record, and a rebuilt key is how an eviction misses. Noticing the failure at
all needs the same care — on both builds the error path sets the loading state
and never calls the listeners, so a load listener would wait for ever — and the
state is polled for a bounded number of frames instead, then given up on with a
message.

| Control | What it does |
|---|---|
| Folder | The eleven image folders the engine ships with. |
| Search | By name. |
| look inside subfolders | One level, and exactly one: a directory below that is skipped rather than half-listed. Disabled where there is no filesystem. |
| Source | Which of the three lists is on screen — this folder read now, the boot index, or the database only — with what the last two cannot know. |
| Encrypted | Asked of the engine, then of the decrypter, then of what the database declares. |
| read the folder again | Drops the cached listing and the loaded sheet. Disabled where there is no filesystem. |
| Names | Name, which subfolder it came from, its sign run, and "show". A folder row is labelled as one and has nothing to show. |

**This sheet**:

| Row | What it says |
|---|---|
| Will ask for | The exact url the engine will build for this name, separator and all. |
| Size | The sheet's own dimensions, or that it did not load. |
| Sign | The leading run, not the first character. |
| Grid | For a character sheet, how many characters and the block layout the engine's own big-character test concluded — marked as a guess where this build has no such test. For a face sheet, eight faces four across at this build's own face size rather than a fixed number. Everything else is not a sheet and is shown whole. |
| Anchor | Whether the engine treats this sheet as flat on the tile or lifted six pixels. |

**Walk cycle** — only on the character folder, because it is the only one whose
frames mean anything in sequence.

| Control | What it does |
|---|---|
| Character (0–7) | Which of the eight blocks. Disabled on a single-character sheet, which holds one and therefore has no index. |
| Facing | down / left / right / up. |
| animate | Steps the cycle in place. |
| Speed (1–6) | The panel prints the arithmetic rather than the result alone: (9 − speed) × 3 frames per column, which is what the engine's own animation wait returns for that speed. |
| Columns | 0, 1, 2, 1 — the pattern counter runs 0..3 and the third value maps back onto the middle column. |
| Zoom (1–4×) | Nearest-neighbour, so a small sprite stays a small sprite instead of being smoothed. |

**Preview** shows the whole sheet, and for a character sheet the twelve frames of
the selected character — four facings by three columns — cut with the same
arithmetic the engine's own sprite uses, cited rather than invented. The
animation runs off GigaHack's own frame hook rather than the engine's clock, so
the cycle keeps stepping while the game is held, which is when anyone is
actually looking at it.

Four things can go wrong between picking a name and seeing it, and the panel says
which: the image loader could not be reached or refused the name; the file did
not load, with the number of cache entries dropped so it cannot poison the next
scene change; the engine reports the sheet ready and gives it no size, which is
nothing wrong with the file; or the browser refused to read pixels back, which is
a preview failure rather than a file failure and says so. Where there is no
filesystem the folder cannot be read at all, and the list falls back to the boot
index — which reads one level and cannot tell a folder from a sheet — and then
to the names the database itself carries for that folder, each labelled.

This panel reads. Nothing here writes to the game or to disk: the sheet an actor
actually wears is set in **Player → Identity**, and the sounds are in
**Game → Audio**.

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

### Parameters

What every plugin in this game was handed at load, and — where it can be
honestly claimed — what changing one of those values would still reach. The
engine hands each plugin its own object out of one table, once, and most
plugins read it exactly once, at load, into their own variables. Editing here
changes the table the engine keeps; a plugin that already copied a value out of
it never looks again and cannot be reached from anywhere. The one piece of
evidence that exists is a read counted through the engine's own parameter
reader — and because GigaHack loads after every other plugin has done its
load-time read, any read counted here happened *after* load. That single fact
is what lets a row claim an edit takes effect, and it is why a count of zero
reads as **not seen** and never as "reads once". The limit is stated at the top
of the panel, above the first row, rather than in a tooltip on a control that
already looks like it worked.

| Control | What it does |
|---|---|
| What an edit can and cannot do | The first group on the panel, before a single row: what an in-place edit reaches, what it cannot, that the value shown is the one the engine holds, and that nothing is written to the plugin list on disk. |
| Search | Over entry name, parameter name and value. |
| Filter | `all`, `edited`, `seen re-reading`, `not registered`, `off in the plugin list`. |
| `show entries with no parameters` | An entry that declares none contributes no row otherwise, and "it is not in the table" and "it has nothing to configure" are different answers. |
| Parameter table | Plugin, parameter, value, reads and effect, one row per parameter. Virtual, and not optionally — the row count is the project's, and a hundred entries with sixty parameters each is four figures. |
| value | Editable in place where the edit can land. Committed as text, verbatim. Degraded marks `plugin.param`. |
| reads | How many times that entry has been seen asking the engine for its parameters since this module loaded. |
| effect | One of `live`, `not seen`, `off`, `not registered`, `name taken`. The tooltip carries the sentence for that row. |
| Scope | Entries, how many carry parameters, how many the engine registered, how many are off, how many claimed a name twice, the total parameter count, and whether the read counter is installed. An empty slot in the plugin list — a hand-edited list really does carry one — is counted and named rather than thrown on. |
| Session edits | Every edit made this session with "revert" per row, plus "revert every edit" and "copy the edits as JSON". Revert writes back the exact string that was there, not whatever the last edit left. |
| Selected entry | The raw entry as the plugin list spells it, the registration key and how it was resolved, the effect with its reason, the description, and the whole parameter object as JSON with "copy". |

Every parameter value is a string. The editor writes numbers, booleans, lists
and whole structures as quoted text and the consumer does its own `Number()`,
`=== 'true'` or `JSON.parse` over it, so a commit here is the text verbatim: a
number written where JSON text was breaks the consumer somewhere far from here,
or worse, is caught and replaced by a default with no message. An edit that
would leave a JSON-text parameter unparseable is refused and names the
parameter it would have broken. The write **mutates the object the engine
already holds** rather than replacing it — a plugin that captured that object
at load reads a mutation and would never see a new one — and the game's own
plugin list is mirrored, because the two diverge the moment one is written
without the other. The registration key is asked of the engine's table, never
derived: an entry in a subfolder is registered under the whole entry on one
build and under the part after the last slash on the other, both lower-cased,
so the key is resolved by probing for each in turn.

| Reason a value is a readout rather than an editor | What the row says |
|---|---|
| The entry is off in the game plugin list | The engine never registered its parameters, so an edit here would go nowhere. The declared values are still shown, dimmed. |
| Another entry claimed the same name | The engine keeps the first claim and drops the second with no error at all. Both rows are shown, and the second names the index of the one the engine kept, because these values belong to that one. |
| The entry carries no parameters | The engine holds the name with nothing under it, and its reader hands back a fresh empty object for it forever — writing into that is a write into a throwaway. |
| The engine parameter table is not reachable | Nothing here can be edited, and the values shown are what the engine was handed rather than what any plugin is using. |
| Read-only mode | The edit is refused, naming the parameter and the entry it refused. |

A row can only ever say **live** where the read counter is installed; where it
is not, the panel says so once, at the top, and every row reads `not seen` for
the same reason. An edit whose entry is later re-registered wholesale — some
loaders and reload plugins re-run the whole setup — is reported as discarded,
with the frame it happened on, rather than left showing as applied. An edit
lasts until the game is relaunched. The whole panel is replaced by a stated
reason where the game plugin list cannot be read at all, since then no plugin
can be asked what it is configured to do.

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

### Compare

Two save files, or a save file and the running game, side by side. The engine
offers exactly one way to look inside a save — load it — and loading is what
destroys the state you were trying to explain, so this panel opens a slot
without loading it. Nothing here is installed into `$game*`: reading a file is
not loading it. The panel never writes, deletes or retitles a slot either, and
says so in its own group rather than leaving it to be trusted.

There are two ways a build can offer a save for reading and the panel probes
for the one it has rather than asking a version. One storage layer is
name-keyed and answers with a promise; the other is id-keyed and answers
synchronously with a string that then goes through the decoder. Whichever it
is, it is called **as found**: plugins commonly alias the storage layer to
relocate a save and replace the encoder to re-encode one, so neither is cached
and neither is reimplemented. Whether a slot holds anything is asked of the
data manager's own numeric-id test, not of the storage layer's existence
check — that one has the same name on both engines and a different parameter
type, so calling it with an id reports an empty save folder on a game full of
saves.

The record built from a slot is the same bounded snapshot the Since Save panel
takes of the live game, which is why the diff never has to know which side it
is looking at. Nothing calls a method on anything that came out of a file. The
decoder revives a class by looking its name up on the window, and where the
class is not in this build the lookup is undefined: no prototype is applied,
nothing is logged, no error is raised, and the object arrives as plain data
with every field intact — the first method call on it then throws somewhere far
away from the read. So gold is read as a field and never as `gold()`, a level
is a field and never a method, and a section whose class is missing is
**reported** as having arrived as plain data rather than skipped, because every
field it stored is still there and still worth comparing.

| Control | What it does |
|---|---|
| Sides table | One row per side you can pick: "live now", "the anchor" from Since Save, and every save slot this build has. Columns are the slot number, an A chip, a B chip, the project's own title for the slot and its playtime. Five columns and not six: a project's title for a slot is unbounded, and a timestamp column beside it squeezes the one thing you pick a slot by down to nothing — so the timestamp is on the row's tooltip and in that side's own group. The list is built with the engine's slot index cache dropped first, since that cache is keyed on a frame counter that stops advancing while the mod holds the game, and a save made a moment ago would otherwise still read as an empty slot. |
| A / B chips | Pick the two sides. A row that cannot be a side shows a dot carrying the reason instead of a chip, rather than a chip that picks nothing. |
| compare | Opens whichever of the two sides is a file and diffs them. |
| swap | Exchanges A and B, so a diff read the wrong way round does not need re-picking. |
| re-read | Drops what was read and opens the files again. |
| Search / Sort | The same filter and the same three orders as Since Save. |
| Differences | The diff table: id, section, name, before, after. "go" opens a row in its own panel where one exists. There is no revert here — the B side is a file as often as it is the running game, and a file is not something a value can be written back into. |
| copy diff | Everything currently listed, as text, on the clipboard. |
| Summary | Both sides with their playtimes, the change count, and how much play sits between them. |
| Storage | The resolved save folder, the save extension, which of the two read shapes this build has in words, and how many slots it offers. |
| Side A / Side B | Everything known about that side. |

Two clocks answer two questions and are not mixed. How much the player played
between two states is the frame count each state carries; how long ago an
anchor was taken is wall clock. Playtimes on this panel are counted in frames,
and rows that show one say so.

**Each side's own group** carries which side it is, the project's title for it,
when it was saved, its playtime, how many times it has been saved and which
build of the project wrote it — then one row per engine section saying how that
section arrived: read, plain data, or not in the file at all. Below that,
everything else the file carries. The ten top-level sections are the engine's;
plugins commonly extend what goes into a save, and comparing only the ten while
saying nothing about the rest is the silent failure this whole project exists
to prevent, so every other key is listed by name and marked **not compared**. A
file with nothing outside the ten says that too.

Three things are said before a side's ids are believed. A slot written by a
different build of the project — a different title or a different project
version — is flagged, because the same variable id can mean a different thing
there. A slot the engine itself does not recognise as this project's save is
flagged as well, with the note that this is a guard on the engine's *load*
path and not on reading, so the file was still read. And a state holding more
self-switches or more actors than the caps allow says how many it holds and
which setting raises the cap, rather than quietly comparing a prefix.

The panel holds one anchor and at most two read sides. The parsed contents of a
large save is the whole game state, so it is dropped in the same statement its
snapshot is taken in, and anything that is not one of the two sides being
compared is dropped before a read starts — a session that has opened ten slots
is still holding two.

| What is unavailable | What it says |
|---|---|
| The whole panel | Where the storage layer offers neither read shape, the panel names both of the ones it looked for, points at Debug → Environment for what was found, and states that nothing on it can run. No table is built. |
| The anchor row | Not pickable until one exists, saying that World → Since Save is what takes one. |
| An empty slot | Dimmed, with "this slot is empty" on the row and in place of its pick chips. |
| compare | Greyed, with the reason on a hoverable wrapper: a side has not been picked for A or for B, or A and B are the same side. |
| re-read | Greyed while a read is already running. |
| Save folder | Where the storage layer returns no save directory, the row says the file behind a slot cannot be named, and that reading still goes through the storage layer — which is what the game itself uses. |
| A side that could not be read | The reason is printed next to the actions and in that side's own group: the slot is empty, it is not a slot this build has, the file could not be turned into a snapshot with a pointer to the log, the read failed with the engine's own message, or the storage layer answered with something other than a promise — which means something has replaced it with a different shape. |

A disabled control takes no pointer events, so every reason above sits on a
wrapper that can actually be hovered; a greyed button whose tooltip cannot be
read says nothing at all.

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

### Journal

Everything GigaHack itself has changed this session, in one chronological list,
with the evidence attached. It is fed by two things that know nothing about it:
the undo stack, which says a reversible edit happened and what it was, and the
write verifier, which says what a write wanted, what it got, and who is likely
responsible where the two differ. Both are aliased from here, so every reversible
edit and every verified write anywhere in the mod lands in this list without
either service growing a dependency on the panel. A verify and the undo entry
that followed it are one row, not two; a verify that no undo entry followed
becomes its own row rather than being dropped, because a write that could not be
made reversible still happened.

"Undo to here" is exact because the journal keeps a mirror of the undo stack by
position rather than by arithmetic. The stack is capped and drops its oldest
entry on overflow, so "pushes so far minus the current depth" is right only until
something is popped. A row whose entry has fallen off the stack refuses and says
how many edits have been made since; a row whose stack was cleared says that
instead; a row still on the stack says how many entries will come off with it,
before you press anything.

| Control | What it does |
|---|---|
| Journal table | Row number, frame, what changed, `before`, `after`, whether it stuck, and which control made the write. |
| stuck | `✓` it stuck, `✗` it did not, `—` it was not verified. A `✗` whose control is marked degraded carries that reason in its tooltip. |
| all / did not stick / reversible | Filters. "did not stick" is the one to reach for after a control has been marked degraded. |
| copy what is shown | The listed rows as plain text, with the control key and the stuck verdict on each. |
| undo to here | Pops exactly the entries made after that row, and no more. Confirms, naming the count. Disabled with the reason where the row can no longer be reached. |
| This session | Writes recorded, how many did not stick, how many are still reversible, the live undo depth, and the frame of the oldest row still kept. |
| undo the last change | The top of the undo stack, named next to the button. Disabled on an empty stack. |
| undo everything back to the start of the session | Confirms with the count. Stops the moment the stack says there is nothing left, rather than filling the log with one line per attempt. |

Undoing is itself journaled, so the list still reads as what happened rather than
as what the state now is: an undo adds its own row, the row it reversed is marked
undone, and asking to undo back to it again is refused. Clearing the undo stack
marks every affected row irreversible instead of deleting it — the record of the
change is still worth having once the way back is gone.

**What the journal does not see**, listed in the panel rather than left as a gap:
writes the game makes itself, which are World → Recent's and World →
Watchpoints' question rather than this one's; teleports, forced event runs and
Forge injections, which are deliberately not reversible and rely on the save
backup instead; anything written before this module loaded; and the compatibility
self-test's own writes, which are real rows and carry their control key so they
can be told apart from yours.

The whole panel is replaced by a stated reason where neither feed could be
installed, with Debug → Hooks named for the two aliases that failed. Where only
one is missing the panel still builds and says which: without the undo feed
nothing here can be reverted, and without the verify feed whether a write stuck
is unknown rather than assumed — the column header reads `—` instead of `stuck`.

### Interpreters

A read-only view of every interpreter that exists right now, and a named answer
to "the game is stuck and I do not know why". Event commands run from a
`Game_Interpreter`, and there is never only one: the map has its own, every
parallel event has its own, every parallel common event has its own, the troop
has one in battle, and a Call Common Event runs a child hanging off whichever
interpreter called it. Nothing in either engine will tell you which of them is
running, what command it is sitting on, or what it is waiting for. The sharpest
case is the engine's own runaway guard: an interpreter that runs a hundred
thousand commands in one frame is stopped, silently, every frame, for ever, and
nothing anywhere reports it — which is why it is reported here.

The command a row is on is read from the interpreter's own list and index, never
from the field one engine fills in before calling its handler and the other does
not define at all; reading that shows a blank command on one engine with no error
anywhere. The same care applies to waits, where the character being waited for is
kept on a different field per engine and both are answered for.

| Control | What it does |
|---|---|
| Running table | One row per interpreter, children indented under their parent: depth, where it belongs, whether it is running, index of total, the command it is on, and its wait. |
| not aliased | A chip on any interpreter whose `executeCommand` is not the function GigaHack aliased — something subclassed it, so its writes read as unattributed in World → Watchpoints. Nothing else can detect this: the prototype method is still ours. |
| select | Picks a row for the inspector and the command list. |
| follow the game | Repaints the table and the command list on a clock while you watch, and pauses that while either is being scrolled. |
| Command list | The selected interpreter's whole list, decoded, with a marker on the command it is on. |
| Right now | Whether the map interpreter is running and for which event, how many events are starting, the message state, whether the scene is changing, both frame clocks, and how many interpreters are running of how many exist. |
| `$gameMap.isEventRunning()` | Shown next to the map interpreter's own answer. On both engines the engine's version is "the interpreter is running, or an event is starting"; where the two disagree and nothing is starting, something has replaced it, and the row is flagged rather than one answer being picked quietly. |
| If the game is stuck | Zero to five diagnoses, each naming the cause, the detail and the panel that releases it. |
| Not running | Every parallel common event on this map that has no interpreter, with the switch that governs it and whether that switch is on — or that its gate switch was never picked in the editor, so it can never fire. |
| Selected | Where, depth, map, event, index of total, current command, wait mode, wait frames, and the whole child chain. |
| release this wait | Clears the wait count and the wait mode, exactly as the engine does when a wait ends. Confirms. Disabled when the selected interpreter is not waiting. |

**The two clocks answer different questions.** GigaHack's own frame counter keeps
ticking while the mod holds the game; the engine's is the one a player
recognises, and on one engine it stops. Ordering and per-frame coalescing use
ours, and the engine's is shown as a label.

**A diagnosis names a panel, never a plugin.** Which plugin put the game in this
state is not knowable from here; the way out is. An autorun page whose conditions
still hold restarts every frame and the player never gets a frame back, so the
fix is World → Switches, or World → Self for a self-switch. An interpreter
waiting on the message window with nothing answering it points at Game → Message.
A wait on a move route, an animation or a balloon points at Player → Movement. A
wait count in the thousands is reported in seconds as well as frames. And when
nothing is holding the game the group says so, rather than offering a
speculative cause.

Releasing a wait touches neither the command list nor the index. What it cannot
do is finish the thing being waited for — a move route still running, a message
still open — so the commands after the wait may run earlier than the event
expects, and the panel says that before you press it. There is no stop button for
a parallel page: the engine sets the same list up again on the next frame, and
what stops it is the page condition, or for a common event the switch that
governs it.

The whole panel is replaced by a stated reason where there is no game world yet,
and by a different one on a build with no `Game_Interpreter` at all — both
engines define it and no ordinary plugin removes it, so that answer says it is
worth reporting rather than working around.

### RNG

Neither engine has a generator of its own. Every roll in both — damage variance,
drops, encounters, and also weather, animations and particles — goes through
`Math.random`, and the one wrapper either engine ships around it reads it at call
time rather than holding a reference, so that single function is the only point
at which a roll can be recorded or replaced. It is also the host's own function,
shared with everything else on the page, which is why the alias here is installed
**on demand and removed again** the moment neither recording nor seeding wants
it: a mod menu nobody is using leaves `Math.random` exactly as it found it, and
releasing puts back the precise function that was taken.

| Control | What it does |
|---|---|
| Record rolls | Installs the alias and starts a log of every roll with its value, its frame and who asked for it. |
| Sample | Record one roll in *n*. The counts stay exact either way — sampling thins the table, not the tally. |
| Capture call sites | One `Error` object per recorded roll, to attribute a roll to a line rather than to an event. Leave it off unless you are hunting a specific roll. |
| rolls this session / last frame / recorded / distinct call sites | The tally, including the rolls sampling skipped. |
| clear | Empties the rolls and the call-site table. |
| rolls / call sites | Two views of the same recording. Rolls is newest first with the value, the writer and the site; call sites groups by site with a count, a share of the total, the last frame it fired and one sample value. |
| copy what is shown | The current view as plain text. |
| Seed the generator | Replaces `Math.random` with a named 32-bit generator, so the same seed replays the same sequence on either engine and either platform. |
| Seed | 0 to 2147483647. |
| restart the sequence | Puts the generator back to the start of the seed. Disabled when nothing is seeded. |
| release | Restores the host's own function and turns recording off with it. Disabled when neither is on. |
| numbers drawn | How far into the seeded sequence you are. |
| What seeding costs | The four caveats below, shown expanded while anything is seeded. |

**Who rolled it** is the same answer World → Watchpoints gives, written by the
same code: a roll made from inside an event command carries the map and event
that asked for it, and one made with no interpreter on the stack is reported as
coming from the engine or a plugin. Nothing in the recorder or the writer lookup
draws a number of its own, so watching the rolls does not change them.

**What seeding costs is stated before anything is switched on**, not after.
Anything that took a reference to `Math.random` before it was replaced keeps the
real one; those rolls stay random and never appear here. Seeding reaches every
roll in the game rather than the ones you care about, so a seeded run looks
subtly stiller than a real one — weather, animation timing and particles are all
downstream of the same call. The sequence advances on every roll, which means
re-rolling one drop means the same save, the same seed and the same actions in
the same order. And seeding is off every time the game starts, whatever the
settings file says: a seeded generator that survived a launch would be a silent,
invisible change to every roll in the game.

**Recording switches itself off past a per-frame cap** rather than stalling the
frame, says in the log how many rolls tripped it, and names this panel as where
to turn it back on. Some scenes roll thousands of times a frame and recording
every one of those costs more than the answer is worth.

Both toggles are disabled with the reason where `Math.random` is not a function
on this host — that should be impossible, and the panel says so too. Where
something had already replaced `Math.random` before GigaHack loaded, the panel
warns that seeding replaces *that* one and releasing puts *that* one back, not
the browser's. Where something replaced it after GigaHack did, release refuses
rather than removing someone else's alias with ours, and points at Debug → Hooks.
With recording off, the table says which function `Math.random` currently is
instead of leaving an empty list unexplained.

### Triggers

Neither engine can run code when the game reaches a state. An event page can, but
that means editing the game, and the state you want to react to is usually the
one you are still looking for. A trigger is a schedule over a snippet already in
the console library — not a second language — so most of this panel is the
machinery that keeps a schedule from becoming a hazard.

There is one live source of switch and variable edges and this panel does not
install it. The watchpoint module already aliases the three `setValue` methods
and publishes every write it observes; a second alias on the same methods would
double every edge and hide the first one's absence. So this subscribes to it, and
where it cannot see the writes, polls instead — once per logical step, and only
the ids an armed condition actually names, because walking four figures of
variables every step for two armed triggers is a cost nobody asked for. Which of
the two is running is on screen, with the blind spot that source has.

A trigger fires **synchronously, inside the command that made the write**. That
is what "run something when the game reaches a state" means, and it is the only
way a cascade can be counted on one stack. What is deferred to the next frame is
the log line and the toast, because the interpreter's while-loop is not a place
to do DOM work.

| Control | What it does |
|---|---|
| Search / `armed` `off` `errored` | Over the trigger's name, its snippet's name and the condition in words. |
| Trigger table | On, name (editable in place), when, runs, last fire, and either what the snippet returned or the message it threw. A row that switched itself off carries its stated reason in the tooltip. |
| on | Arming one **clears its stated reason** and re-arms it: re-arming is how you find out whether the cause has gone. |
| ▶ | Fires it now, by hand. Disabled where the snippet was deleted, with that as the reason. |
| − | Deletes the trigger. |
| Last fire | Which trigger, at which engine frame, what it returned, the message where it threw, and the last refusal. Says so where the trigger list could not be written and will not survive the session, naming Debug → Environment for the directory it tried. |

A fire while this panel is open repaints the table **in place** rather than
rebuilding the tab, so a name half-typed into the box on the right is not taken
away by something the game did.

**New trigger** — six conditions, each of them an observed edge rather than a
poll of a value:

| Control | What it does | Unavailable when |
|---|---|---|
| When | `a switch turns on`, `a switch turns off`, `a variable reaches a value`, `a map loads`, `a battle starts`, `every N seconds`. | A source whose hook did not install is **dropped from the list**, with the reason and the function that was missing printed under it. |
| Switch / Variable / Map id | Bounded by what this project actually has, computed from the loaded database rather than written down. | The database has not loaded; the panel says there is no id range to pick from. A map id is still accepted, and is named where the map module is present. |
| Test | `reaches`, `passes above`, `drops below`, `equals`, `changes to anything else`. Every one is an edge: a value already past the number does not fire, only crossing it does. | Not a variable condition. |
| Value | The number the test is against. | The test is `changes to anything else`. |
| Every | 1–600 **real** seconds. The game speed multiplier changes how many logical steps happen in a second, so a timer counted in frames would fire four times as often at 4×, which is not what "every thirty seconds" means to anybody. | Not the timer condition. |
| Snippet | The console library, by name. | The library is empty; the panel names Debug → Console → "save as snippet" rather than handing over a dropdown with no options. |
| Name | Optional. The condition in words is used where it is blank. | — |
| add the trigger | — | No snippet is picked, or the condition names an id this project does not have. Both are stated under the button. |

**Safety** — each of these exists because of something projects do routinely:

| Control | What it does |
|---|---|
| Fires a second, max | Over the ceiling the trigger is **switched off, not throttled**, and the reason says how many times it fired. A parallel process writing one variable every step is the commonest thing in a project and is what makes a naive watch fire forever; throttling would leave it half-firing forever instead. |
| Cascade depth | How deep one trigger may set off the next. At the ceiling the refusal names the whole chain in the order it ran, because two triggers writing each other's condition is a fact about the pair rather than about either one. |
| Disable a trigger that throws | On, it is switched off and keeps the thrown message as its stated reason. Off, it stays armed and is rate-limited to one fire a second, so a throwing trigger on a busy switch does not run sixty times before anyone reads the message. |
| Run while the game is held | Off by default. Disabled where pause is unavailable on this build, with what the pause gate says as the reason. |
| Toast when one fires | — |
| re-arm every disabled trigger | Clears every stated reason at once. |

A trigger whose snippet writes the very thing that trigger watches fires once and
its own write is ignored, and the refusal says so. The snippet is resolved **by
id at the moment it fires**, never cached as code: renaming one does not orphan
the trigger, and deleting one leaves the trigger listed and switched off with
that as its reason instead of running nothing. What a snippet returned is
truncated before it is written down, and says how much was kept — a trigger
returning the whole item database would otherwise put a megabyte per fire into
the settings directory. Triggers, their fire counts and their stated reasons all
survive a relaunch, so one that switched itself off comes back off, still saying
why.

**Watch source** names which of the two sources is live, what it detects, what it
cannot see — a write made straight into the `_data` array without going through
`setValue` (nothing in either engine does that; a plugin can), or, when polling,
a value set and cleared inside one logical step — and which functions the frame
hook rides on.

**Writes** is the obligation this module has in the other direction. It writes no
game state of its own: every write is the snippet's, so there is nothing here for
the write-and-read-back check to answer for and no control of its own to mark
degraded. What the group does instead is list every GigaHack control whose writes
have been refused this session, with the reason and a "try again" per row, beside
the triggers whose snippets will otherwise appear to do nothing.

The whole panel is replaced by a stated reason where the console module did not
load: a trigger runs a saved snippet by id, and without a library there is
nothing to run.

### Capture

The overlay is not in the shot. The menu is a browser layer sitting beside the
game canvas and the engine's own snapshot renders the display tree only, so
"hide the overlay for the screenshot" is exclusively about what GigaHack draws
**inside** the scene. Those drawings register themselves rather than being named
here, and until one does the panel says the shot contains no mod drawing and
why, instead of claiming to have hidden something. The other invariant is
memory: a burst that keeps its shots is the unbounded-memory failure this panel
is written to avoid, so exactly one full-screen bitmap is alive at a time — the
bytes are converted, written and released — and where there is nowhere to write,
a burst is refused rather than buffered. A single shot is still offered there, as
an image you can save.

| Control | What it does |
|---|---|
| take one | One frame, through the engine's own snapshot. It changes nothing in the game, so read-only mode does not gate it. Disabled where neither the engine's scene snapshot nor a game canvas is reachable — there is then nothing to photograph, and the group says so. |
| leave the mod's drawing out | Hides every registered in-scene drawing for the shot and shows it again afterwards, inside one synchronous try/finally, so a layer comes back even where the snapshot itself throws. Disabled with nothing registered, and the reason is that the menu is a browser layer the snapshot never sees. |
| Size | The game's own resolution, whatever size the window is. |
| Excludes | What has registered, and whether each one is in the scene right now. |
| Shots (2–60) / Every N frames (1–60) | A burst's length and spacing. The spacing is counted on GigaHack's own frame counter, so it keeps firing while the game is held. |
| start the burst / stop | Refused where there is nowhere to write, naming what is missing, and refused while one is already running. |
| Folder / Prefix / Next | Where shots go, what they are called, and the next filename exactly. |
| show it in the file manager | Disabled where there is no shell to ask; the path has a copy button either way. |
| This session | Every shot: number, file, size in bytes, "copy" for the whole path, and "save" for the one that still holds its bytes. |
| forget the list | Clears the rows. Files already written stay. |
| The last shot | The image, plus where its pixels came from and how the bitmap was released. |

Two sets of dimensions are reported and never conflated. The engine's snapshot is
of the game's **stage**, so its size is the game's resolution whatever size the
window is; where that bitmap exposes no readable canvas the pixels come from the
game canvas element instead, and the row says so and names both sizes rather than
pretending the two are the same thing. A canvas of zero width answers a pixel
read with six characters rather than raising, so a result shorter than a PNG
header can be is not accepted as an image — the shot then has dimensions and no
image, and says exactly that. The snapped bitmap is released through the engine's
own destroy where this build has one and dropped where it does not, and the last
shot says which of the two happened.

Only the newest shot keeps its bytes. Older rows keep the path, and where there
is no path they keep nothing, which is the honest cost of not holding a screen's
worth of pixels per row. Where there is no filesystem a shot exists only in
memory and the panel says so next to the image: save it now or it goes when the
panel rebuilds. Where the write itself failed, the log names the path.

One warning appears only when it applies: the scene transform is flattened by the
engine's own snapshot on both builds. It heals on the next render, and GigaHack
renders on every path including the held one — but a stopped scene loop renders
nothing, so a shot taken there can leave the scene flat until the loop runs
again.

What is in the shot is what the game drew into its own scene. A video the game is
playing is a browser element over the canvas rather than a member of the display
tree, so it is outside the snapshot for the same reason the menu is, and neither
is captured here.

### Performance

What one frame is spending its time on, and what the overlay itself costs. The
headline figure is measured by wrapping GigaHack's own per-frame entry point —
one clock read either side, the original called exactly once, no early return
on any path. Nothing here goes near the engine's own main loop: on one build
that function perpetuates its own animation-frame chain from inside itself, so
a wrapper that returns early ends the loop for good and one that calls the
original twice doubles the chain every frame. The mod already has one safe gate
for that, and this panel measures at it. A clock reading is also quantised —
the browser clamps its high-resolution timer, and coarser again under some
isolation settings — so a single per-frame hook costs less than one step and
one frame's reading would be either zero or a whole step. Every figure here is
therefore a **total accumulated over a counted number of frames, plus a mean**,
and never one frame's number.

The three counters at the top are three different questions, and none of them
is called "the frame rate" on its own. The renderer's own meter, the mod's
logical-step counter — which deliberately keeps ticking while the mod is
holding the game — and the engine's frame count, which is advanced from a
different place on each build. Steps below fps means the step loop skipped
work; above it means it caught several steps up inside one rendered frame.

| Control | What it does | Unavailable when |
|---|---|---|
| engine fps | The renderer's own meter, read through the capability adapter rather than by name. | This build exposes no frame-rate counter — a plugin that replaces the renderer takes it away and there is nothing to read instead. Reported as unavailable with that reason, not as zero. |
| logical steps/s | The mod's own step counter, per second of wall time. | — |
| engine frames/s | The engine's frame count, per second of wall time. | — |
| used / total / limit / growth since the baseline | Heap usage in megabytes, with a bar against the limit. A rising number is not proof of a leak: the collector runs when it chooses, and the figure is bucketed by the browser. | The measurement is an extension to the timing API that some builds and deployments do not carry. Nothing in the game can measure the heap without it and no setting turns it on, so the group is replaced by that sentence. |
| reset the growth baseline | Moves the zero point for the growth figure to now. | Same. |
| Scene graph | Scene name as the build reports it, node count, max depth, and how many of those are windows, sprites, containers and other. | No scene is running yet — the graph is walked from the scene the engine currently has. |
| recount | Walks it again. Counted on demand, never per frame. | — |
| Texture caches | Five caches, each listed by name with its entry count and an estimated byte figure. | A cache this build does not have is listed **as absent, by name** — a probe dropped from the list would read as "nothing cached" on every game. |
| cache flushes since load | How many times the image cache has been cleared, so a count that drops between two looks has something beside it saying why. | The image cache has no clear on this build; the figure reads `?` with that reason. |
| Series | `frame rate`, `logical steps`, `heap`. | The heap series is dropped from the list with the reason, rather than plotting a line of nothing. |
| Interval | 0.5 / 1 / 2 / 5 s. | — |
| clear history / span / min / median / max | The chart's own readouts. The first sample carries no rate: a rate needs two readings and an interval between them. | — |
| time each hook | Times every hook in the frame loop's list individually. Costs two more clock reads per hook per frame while it is on, which is why it is behind a toggle and off by default. | This build's frame loop does not publish its per-frame list, so nothing here can name what inside a frame is costing the time. The toggle disables itself with that reason and the table says the same. |
| Hook table | Hook, calls, total ms, mean µs and share of the measured total, worst first. A hook whose mean is over the budget is coloured. | Timing off: the table says so and names how many hooks the list holds either way. |
| remove | Takes that hook out of the frame loop. Verified by asking the loop whether the name is still there, which is what catches one that refuses to come out. | — |
| frame total | Frames counted, mean and worst. Measured whether or not per-hook timing is on, because it is taken at the entry point rather than inside it. | The per-frame entry point is absent, i.e. the Hooks module did not load — then nothing is driving per-frame work and there is no frame cost to measure. |
| budget | 0.1–16.7 ms. The line above which a hook's mean is coloured. | — |
| Overlay cost | Whether the overlay is mounted and open, how many DOM nodes are under it, and how many per-frame and 700 ms hooks it owns. Closed, its own per-frame hook returns on its first line. | — |
| copy the performance report | Every figure and every reason as plain text. A screenshot loses the long "why" strings and needs a working renderer; this needs neither. | — |

A texture byte figure is an **estimate and says so**. Neither engine tracks how
much texture memory it holds, so width times height times four over the bitmaps
this build lets us see is the best answer available, and presenting it as a
measurement would be the more useful-looking lie. Two of the five caches exist
on only one engine each — a flat image cache on one, a byte-budgeted one on the
other — and which is present is decided by probing for the cache, never by
asking which engine this is.

The scene graph is walked downward through children only, never through
`parent`, and stops at a node cap and a depth cap that are both settings: an
uncapped walk over a display list a plugin has made cyclic is an infinite loop
inside a panel repaint, which is indistinguishable from the game hanging. When
a cap is hit the number is reported as a floor rather than as a total. The
graph's shape differs between builds — a deep window tree with a client area on
one, a flat one on the other — so nothing here compares a node count against a
constant, and the scene name is printed as found rather than replaced with a
friendlier invented one, because some plugin suites are identifier-obfuscated.

The chart is sampled on a **wall clock** from inside a per-frame hook, so a
build running its logical steps at several times real speed still plots one
point per interval and a build that stopped stepping leaves a gap rather than a
flat line. That sampler is registered in the frame loop's own list rather than
driven from the frame-cost wrapper, so its cost appears in the table it fills —
a cost this panel hid from its own table would be the one cost it must not
hide. Turning per-hook timing off restores each hook's own function, so nothing
is left wrapped. Removal keeps working while a hook is wrapped because the
frame loop's registry records the function its owner handed over beside the one
that actually runs, and removes on either — so no module has to know it was
wrapped, and nothing has to alias the remover to translate. A hook
that throws is removed by the frame loop itself, with a log line naming it, and
is then simply not in the table.

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

### Game Keys

Every other panel writes a number into a save. This one writes the table the
engine consults to decide whether a key means "confirm", and a mistake here has
no in-game way to report itself: the menu that would fix it is reached with the
keys that stopped working. So the panel is built around one question — after
this change, is there still a way back? — and the guard that answers it asks the
engine rather than a list of names. Both engines answer `isPressed('cancel')`
for a press of `escape`, through `Input._isEscapeCompatible`, while the stock
keyboard table binds `escape` four times and binds `cancel` and `menu` never; a
test looking for the literal string `cancel` would therefore declare every stock
game already broken and then refuse every edit asked of it. The comparison is
against the map the game **shipped with**, not against an absolute list, because
on a game whose plugins renamed the actions there may be no `ok` at all — the
rule is "do not make unreachable something the shipped map could reach", and
where the shipped map already had no way back the panel says so plainly instead
of pretending to protect one. Nothing here asks which engine this is: every
two-engine difference in this area is a presence test on `Input` itself.

This is not Settings → Hotkeys. That panel binds GigaHack's own keys at the DOM
and never adds an entry to `Input.keyMapper`; this one edits the map the game
reads. The panel is registered on every build, including the ones it cannot edit
— a Settings sub-tab that vanishes reads as a broken install, and on exactly
that build the one useful thing here is the sentence saying why.

| Control | What it does | Unavailable when |
|---|---|---|
| This map | Keys bound and how many distinct actions they reach, whether the live map still matches what GigaHack set, when the shipped snapshot was taken, whether a map is saved for this game, and where it is saved. | — |
| Restore what the game shipped with | Puts back the object read at plugin load, key for key, with nothing added and nothing left behind. Keyboard and pad go back as **one** undo entry, so undoing never leaves the keyboard back and the pad restored. Gated by read-only mode and by nothing else — not by the way-back guard, not by a degraded control, not by the menu-key precondition. A way back with preconditions is not one. | `Input.keyMapper` was unreadable when GigaHack loaded, so there is nothing to put back. The button says that. |
| Restore the map as it was at the first frame | Offered only where the two snapshots differ. Both are offered because only one of them is the map you actually saw. | The two snapshots agree, or the first frame has not happened yet. |
| Forget the saved map | Removes the record and stops keeping one. | Nothing is saved for this game. |
| Keep this map for this game | Writes the map to `keys.json` on every change. | No writable directory was found; the reason the path resolver recorded is printed and nothing can be kept past this launch. |
| Re-apply it after the game rewrites it | Puts your map back each time a hook sees the game overwrite it. | Neither attribution hook could be installed. Both reasons are printed, plus "a rewrite can be noticed but not undone on this build". A plugin that aliased one of them on top of ours is called out too, with Debug → Compatibility named. |
| Watch for the game rewriting it | Compares the live map against the baseline on a frame tick and toasts once per change. | — |
| The way back | One row per action the guard protects — `ok`, plus every action the engine says `escape` also satisfies — with the keys that reach it, or "through escape: …", or **NOT REACHABLE** in red. Below them, GigaHack's own menu key. | — |
| Keyboard table | One row per bound key: printable name, the number the engine reads, the action, and unbind. The action cell is a dropdown of the names the maps actually use, plus "(other…)", which turns the cell into a field so a name no map currently carries can still be typed. Rows on a key GigaHack has taken are coloured and say what the game loses on it. | The map is unreadable, there is no load snapshot, GigaHack's menu key is unbound, or the control is degraded. The first that applies is printed above the table and greys every cell in it. |
| Add a key | "press a key…" arms a one-shot capture for six seconds; the number box and action dropdown do the same job by hand. | Only "bind" follows the table. Capture, the number box and the dropdown never grey — typing a number is the route that always works. |
| Gamepad table | The same shape over button indices, collapsed by default. | `Input.gamepadMapper` is not present, which the group states and which leaves the keyboard map unaffected. |
| Read a button | Polls the connected pads for six seconds and takes the first button pressed. | There is no gamepad API on this build, or no pad is connected. Either way it names the index field as the way in. |
| What changed | Appears only while the live map differs from the baseline: every key that differs as `was → now`, and what caused it. | — |
| Put my map back | Re-applies the map GigaHack last set, through the same guard as every other write. | GigaHack has not set a map this session. |
| Keep the game's version | Takes the live map as the new baseline. Changes nothing in the game. | — |

**Every write goes down one path**, and the path is deliberate. The maps are
mutated in place: a plugin that took `var km = Input.keyMapper` at load keeps
writing through that object forever, so assigning a fresh one makes every later
change invisible in both directions with nothing anywhere reporting a problem.
`Input.clear()` runs after every applied change, because a key held across a
rebind releases into the *new* action and leaves the old one latched true for
the rest of the session — one clear costs a dropped keypress, not clearing costs
a stuck direction nobody can explain. Asking for the map that is already there
is not a write at all: no verify, no clear, no log line and above all no undo
entry, so a restore pressed twice cannot push your real change off the stack.
Each applied change is one undo entry, and each is verified by reading the map
back; where the write does not stick the table is greyed with the named culprit
and a "try again" beside it. Emptying the keyboard map is refused outright —
that leaves the game unplayable and this panel unreachable — while emptying the
pad map is allowed and described as turning the controller off.

**Two snapshots, because the first is not necessarily what shipped.** The map is
read when this file loads and again at the first frame; anything later in the
plugin list, plus the boot scene and the config load, runs in between and can
stamp its own layout on top. Where the two differ the panel says so and offers
both. A rewrite that happens later is *attributed* where it can be: one hook
sits after the game's own configuration is applied and one after its options
screen closes, and each names what it saw — "the game applied its own
configuration", "the game's own options screen was closed", or "no GigaHack hook
saw it happen" when only the frame watch caught it. The watch never repaints the
panel; a rerender from a timer would destroy every open dropdown and half-typed
field under the cursor, so it toasts and lets the next build re-read.

**The map is not a setting.** Settings profiles carry the whole of GigaHack's
configuration between games, and a key map that arrived from a different game is
a file nobody asked for. Only the three preferences above travel that way; the
map itself is per-game data, stamped with the game it was written for and
refused when the stamp is somebody else's — the panel names that game rather
than showing the record as this game's.

**A key number is what the engine reads; the position on the keyboard is
something else.** They are not a bijection: on a non-US layout the key printed Q
sends the code for a different position and the number follows the layout, so
capture records both from one real event and the observed pair wins over the
built-in table. Numbers with no layout-independent name — punctuation, above
all — are printed as their number rather than guessed at, because a wrong label
on the key you are hunting for is worse than no label. Pad buttons are named by
the standard controller layout both engines' own tables are written in; a pad
that reports a different mapping sends different indices for the same physical
buttons, and the panel says so.

**Not covered.** Capture will not take Escape or any key GigaHack has bound —
the overlay acts on those first and would close this panel before the capture
saw them — so the number field is the only route to key 27, and it always works.
Nothing here changes what the game *does* with an action: this maps key numbers
to action names, and whether the game responds to a name is the game's business.
An action reached by a plugin that reads the keyboard outside `Input` is not in
the map and cannot be protected by the guard. And where the engine's own
escape-compatibility predicate is missing, the guard falls back to assuming the
pair both engines ship, says which two names it assumed, and says it once — a
plugin that added a third is not protected.

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

**Tracing**

| Call | What it does |
|---|---|
| `watchpoint(spec)` | Arms a watchpoint on a variable, switch or self-switch. Returns its id, or nothing where the spec named no target or one is already armed on it. |
| `journal()` | Every row of the change journal, with what each write wanted, what it got and whether it stuck. |
| `interpreters()` | Every interpreter that exists right now, with the command each is on and what it is waiting for. |
| `triggers()` | Every trigger as stored: its condition, its snippet, its run count and its stated reason. |
| `trigger(id)` | Fires one by id, through the same cascade, re-entry and rate guards a game-driven fire goes through. |

`GigaHack.api.watch(on)` is the floating watch panel and has nothing to do with
`GigaHack.watch`, the watchpoint service. The names collided because Boot
claimed `api.watch` first and loads later, so the watchpoint entry point is
`api.watchpoint`.

**Snapshots and diffs**

| Call | What it does |
|---|---|
| `anchor()` | Takes a baseline of the live game now and makes it the anchor. Writes nothing to the game. Returns the snapshot. |
| `sinceSave()` | Every difference between the anchor and the live game, as rows. An empty array where there is no anchor. |
| `readSlot(id, done)` | Reads one save slot as a snapshot **without loading it**. `done(snapshot, why)` fires exactly once whichever read shape this build has; `snapshot` is null and `why` is a written sentence where it could not be read. |

**Events and text**

| Call | What it does |
|---|---|
| `blocked(id)` | Which page the engine runs, which page the six stored conditions give, whether the two agree, and every page's conditions decoded with the value now beside the value needed. With no argument it answers for the selected event. |
| `commons()` | Every common event with its trigger, gate switch and whether it is on, whether a live object exists, command and text-line counts, and the explicit-call count — `null` where the counter is not installed. |
| `quests()` | The inferred quest groups, each with its steps, its progress and the sentence saying what it was inferred from. Empty where nothing groups. |
| `script(q)` | The script search: matching lines, how many matched, whether the cap truncated the list, and the scope of every source behind the answer. |

**Screen**

| Call | What it does |
|---|---|
| `unstick(opts)` | Clears the tint, brightness, flash, shake, zoom and weather, clears the scene fade, and switches off all three screen holds. Returns what it cleared and what it skipped, each skip with a reason. `{only:[...]}` limits it to named ids; `{sceneFade:false}` leaves the scene fade alone. One undo entry. |
| `screen()` | The whole screen state as plain numbers and arrays. |
| `screenDiagnose()` | What looks stuck: each entry says what it found, what in the engine leaves it that way, and the fix. Empty is a positive answer. |
| `screenLog(n)` | The last n screen writes, newest first; 20 by default. |
| `erasePictures()` | Erases every picture slot across both the map and the battle range, under one undo entry. |

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
GigaHack.watch.list() / hits() / context()      armed watchpoints, hits, and who is writing now
GigaHack.watch.available() / attributable()    can anything be watched, and can the writer be named
GigaHack.journal.rows() / canUndoTo(seq) / undoTo(seq)
GigaHack.journal.feeds() / blindSpots()        which feeds are live, and what is not recorded
GigaHack.interp.all() / summary() / diagnose() what is running, and why the game is stuck
GigaHack.interp.releaseWait(interp)            clears a wait mode and count, nothing else
GigaHack.rng.watch(on) / setSeeded(on) / seed(n) / release()
GigaHack.rng.rolls() / sites() / count() / caveats()
GigaHack.snap.take({origin:'live'})            a bounded snapshot — reads values, never serialises
GigaHack.snap.diff(a, b)                       every difference between two snapshots, as rows
GigaHack.snap.fromSlot(id, done)               one slot, read and NOT loaded; done fires once
GigaHack.snap.sections() / notCompared()       what the diff walks, and every hole in the coverage
GigaHack.quest.sourcesOf('switch', 42)         who sets it — a live scan joined to the index
GigaHack.quest.whyNotRunnable(id)              why a common event cannot be run from here
GigaHack.media.audio.now() / list(folder) / play(kind, name) / restore()
GigaHack.media.assets.grid(folder, name, bmp)  what layout this sheet has, decided by the engine
GigaHack.media.capture.shoot() / burst(o) / exclude(label, getNode)
GigaHack.screen.state() / diagnose() / hold(which, on) / pictures()
GigaHack.auto.triggers() / addTrigger(t) / source()
GigaHack.auto.route.start() / mark(label) / elapsed() / best(id)
GigaHack.auto.clock()                          the engine clock, MEASURED, not derived from the gate
GigaHack.kit.loadouts() / save(actorId, name) / apply(id)
GigaHack.keys.report() / set(code, action) / restore()
GigaHack.build.perf.hookCosts() / params.rows()
GigaHack.trace.report()                        the nine aliases this module installs, with reasons
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
