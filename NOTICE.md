# Notices

## What the MIT licence covers

`LICENSE` covers the code in this repository: the mod under `gigahack/`, the
installers under `install/`, the test harness under `gigahack-test/`, the build
and publish scripts, and the documentation.

## Trademarks and the engine

RPG Maker is a product of Gotcha Gotcha Games Inc. and KADOKAWA CORPORATION.
This project is an unofficial, unaffiliated modification tool. It is not
endorsed by, associated with, or supported by either company, and no
endorsement is implied by naming their product, which is named only to say what
this tool works with.

**No RPG Maker engine source is redistributed here.** The engine's own
JavaScript — `rpg_*.js` on MV, `rmmz_*.js` on MZ — ships with the editor and
with every game built by it, and is licensed by its owners for that use. It is
not in this repository, is not in any release archive, and is not needed to run
anything here.

## The test harness stubs

`gigahack-test/stubs/` models the two engines so the suite can run the real mod
against something that behaves like them. Those files are **behavioural models
written from the engines**, not copies of them, and each block cites the engine
file and line it was learned from so a reader can go and confirm it against a
build they already own.

Where the engine's **interface** appears it is reproduced exactly, because it
is fact rather than expression and there is no other correct way to state it:
class, method and property names; constants and data tables such as the
key-code map and the trait identifiers; the order of observable effects; and
return values. Where the engine's **implementation** is modelled, it is written
from an understanding of the behaviour rather than transcribed, and often in a
shape the engine does not use — a stub that explains why a behaviour is what it
is has done more than a copy would.

`gigahack-test/stubs/README.md` sets out where that line falls and why.

## Game data

Nothing here contains any game's data, art, audio or scripts.
`gigahack-test/stubs/fixtures.js` builds a synthetic project — generic names,
invented maps, a modelled third-party plugin stack — so that nothing in the
suite depends on owning a particular game.

`gigahack/profiles/` holds optional per-game profiles. A profile records only
what is true of a game's own structure — which variables are worth pinning, how
its switch names are grouped, how to reach a feature one of its plugins
provides — and carries none of its content.
