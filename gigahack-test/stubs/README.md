# The engine stubs, and where their knowledge comes from

These files model RPG Maker MV and MZ so the browser suite can run the real mod
against something that behaves like the engines. They are the most important
files in the harness and the easiest to get quietly wrong: a stub that is more
convenient than the engine turns every check that touches it into a check of
the harness's imagination.

## What they are

**Behavioural models, written from the engines, not copies of them.** Each block
carries the file and line it was learned from — `MV rpg_objects.js:5548 / MZ
rmmz_objects.js:6228` — so the next reader can go and confirm it. That citation
is there to make the model checkable, not to imply the code came across.

The engine's **interface** is reproduced exactly, because it is fact rather than
expression and there is no other correct way to write it:

- every class, method and property name, private ones included — `_waitMode`,
  `_pageIndex`, `_commonEventQueue`
- every constant and every data table — `Input.keyMapper`'s 24 entries, the
  `Game_BattlerBase.TRAIT_*` numbers, `paramMax`'s ceilings
- the order of observable effects, every return value, and every early return

The engine's **implementation** is not. Where a body is modelled here it is
written from an understanding of what the engine does, in whatever shape makes
that clearest — which is often not the shape the engine uses, because a stub
that explains *why* the behaviour is what it is has done more than a copy would.

Where a body is too large to be useful in full, the comment says what was left
out and why. Where a body is deliberately awkward, the awkwardness is modelled
and the comment says it is load-bearing.

## What is deliberately faithful, including the awkward parts

The discipline is: **copy the awkwardness, not the code**. A convenient stub
hides the bug it was written to catch. Some that earned their keep:

- `PluginManager.setup` drops a second claim on a name with no error at all, and
  the dedup key differs between the engines. A stub without that hid the exact
  bug it existed to find, for days.
- `Utils` is a function that throws, not an object. A `typeof x === 'object'`
  test in the mod failed silently on every real game while the suite stayed
  green, because the stub was an object literal.
- `Game_Map._events` is sparse and indexed by event id. A dense one made
  `event(1)` return the second event.
- `JsonEx` marks the object it serialises **in place**, and only one of the two
  engines cleans those marks off afterwards.
- `Game_Screen.startTint` sets a *target* that `update` walks toward. A stub
  that applied it instantly would hide the stutter the mod's hold code avoids.

## What is not here

**No engine source is redistributed.** RPG Maker's own JavaScript ships with the
editor and is licensed for the games you make with it; it is not in this
repository and is not needed to run the suite. To confirm a stub against the
engine, read the engine files inside any game folder you already have — MV keeps
them at `<game>/www/js/rpg_*.js` and MZ at `<game>/js/rmmz_*.js`, and on a
packaged macOS build both sit under `Game.app/Contents/Resources/app.nw/`.

Neither is any game's data, art or audio. `fixtures.js` builds a synthetic
project — generic names, invented maps, a modelled third-party plugin stack —
so that nothing here depends on owning a particular game.

## Layout

| File | Models |
|---|---|
| `core.js` | what both engines agree on |
| `engine-mz.js` / `engine-mv.js` | what only one of them has, or has differently |
| `x-<area>.js` | shared surface added per area — interpreter, screen, audio, images, input, equipment |
| `x-<area>-mv.js` / `x-<area>-mz.js` | that area's engine differences |
| `plugins-mv.js` | a modelled third-party plugin stack, for the `mv-modded` run |
| `fixtures.js` | the data, the scene, and the `window.__*` drivers a check uses |

Load order is `core` → the shared `x-*` → the engine file → that engine's `x-*`
→ `plugins-mv` (modded run only) → `fixtures`. A file that is a floor another
should override loads before it; `x-misc.js` says so in its own header, and got
that wrong once by being wired last.
