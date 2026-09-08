# Writing a game profile

**You almost certainly do not need one.** GigaHack works on any MV or MZ game
with no profile at all — it computes the Forge id bases from the loaded
database, detects the section-header convention if the game has one, derives
its hotkeys from the keys the game's own plugins have already claimed, and
enumerates Steam achievements from the platform API. A profile adds knowledge
the *engine cannot supply*; it never makes a game possible that would otherwise
be unsupported.

Write one when you want:

- specific variables pinned in the sidebar, by name
- a Gallery filter that separates player-facing unlocks from the game's own
  state machine
- a Steam app id, or the accumulating stats behind an achievement
- GigaHack to reach a feature one of the game's own plugins provides — a
  message backlog, an ironman mode, a mod loader

## Installing one

Drop the file in `js/plugins/` and add an entry to `js/plugins.js` **after**
`GigaHack_Profile` and **before** `GigaHack_Boot`.

The installer does not add profiles automatically, deliberately. A profile is a
claim about one specific game; installing one on the wrong game would pin
variables that do not exist and filter a Gallery by the wrong vocabulary, and
both fail quietly.

## Or register one from an addon

The above is how you ship a profile *with* a game. Somebody adding one to a game
they already have does not have to edit `js/plugins.js` or write anything into
the game's own folder: an addon can register a profile at runtime.

```js
/*:
 * @gigahack-addon
 * @id my-game-profile
 * @name My Game — profile
 */
GigaHack.addon(function (api) {
    api.profile({
        id: 'my-game',
        name: 'My Game',
        match: function (ctx) { return /my game/i.test(ctx.title || ''); },
        quickVars: ['gold_multiplier', 'story_flag']
    });
});
```

`api.profile(def)` takes exactly the object described below and hands it to
`$.profile.register`, so the shape, the matching rules and the fields worth
omitting are all the same. Import it through **Settings → Addons**, which shows
you the whole source before it runs anything; `gigahack/addons/README.md` covers
the format and the import routes. If `GigaHack_Profile` did not load, the call
says so in the log and returns `false` rather than appearing to work.

**A profile registered this way applies from the NEXT launch.** Profile
resolution is settled once, at the first access after boot, and re-resolving
mid-session changes answers other modules have already read and latched:
derived hotkey defaults, the Gallery panel's decision about whether to register
at all, the Forge id bases already written into its library, and any cached
section ranges. So the addon registers the profile, the panel says out loud that
it is registered and not yet in effect, and it is picked up the next time the
game starts. Settings → Addons offers a re-resolve anyway, with those four
named beside it as the things it does not move.

Switching the addon off does not unregister the profile, for the same reason —
it simply is not registered at all at the next launch, because the body that
registers it does not run.

## The shape

Every field is optional. Anything you omit stays computed — which is why a
useful profile can be five lines long.

```js
(function ($) {
    'use strict';
    if (!$ || !$.profile) return;

    $.profile.register({
        id: 'my-game',
        name: 'My Game',

        match: function (ctx) {
            // ctx = { title, engine, version, counts, plugins }
            return /my game/i.test(ctx.title || '');
        },

        quickVars: ['gold_multiplier', 'story_flag'],   // by NAME, never by id
        quickVarsTitle: 'Progress',

        galleryFilter: /unlock|scene|ending/i,          // null = offer everything
        sectionPattern: /^\s*==+\s*/,                   // omit unless detection is wrong

        forgeBase: { item: 5001 },                      // omit unless you must pin
        forgeExtraFields: { skill: { myPluginField: 0 } },

        steamAppId: 123456,
        steamStats: [{ id: 'KILLS', goal: 100, of: 'SLAYER' }],

        adapters: { /* see below */ },
        notes: ['anything a user should know about what this profile claims']
    });
})(window.GigaHack);
```

## Matching

`match(ctx)` receives:

| field | what it is |
|---|---|
| `title` | `$dataSystem.gameTitle` |
| `engine` | `'MV'` or `'MZ'` |
| `version` | the engine version string |
| `counts` | `{items, weapons, armors, skills, states, actors, classes, enemies, troops, common, maps, variables, switches}` |
| `plugins` | the names in `$plugins` |

Match on the **title first**, and on database shape as a fallback so a retitled
or translated build still matches.

Do **not** match on the engine version, the plugin list, or a checksum. All
three change with every patch, and a profile that stops matching after an
update fails silently — the player just sees their pinned variables disappear
with no message.

## Fields worth omitting

Two fields are usually a mistake to set:

**`forgeBase`** — pinning it freezes today's numbers against a future patch that
adds content, which is the exact failure the computation exists to avoid. The
default is `roundUp(1000, count + 200) + 1` per kind, and the resolved base is
persisted into the Forge library so ids stay stable even if the game later
grows. Pin it only to match ids a previous install already wrote.

**`sectionPattern`** — the detector finds `--`, `==`, `##` and `[bracket]`
conventions by counting how many named variables and switches match. Setting it
by hand only matters if detection is wrong on your game, and if it is wrong on
your game it is probably wrong on many, which is a bug worth reporting rather
than working around one game at a time.

## Adapters

An adapter teaches GigaHack about one feature the game's own plugins provide.
Every method must feature-detect and return `false` when its plugin is absent,
so a build without it does not get a panel that cannot work.

### `backlog`

```
available()          -> boolean
read()               -> array of message lines
restore(lines)       -> boolean   (optional; without it, clear has no undo)
clear()              -> boolean
max()                -> number
setMax(n)            -> boolean
open()               -> boolean   (push the game's own backlog scene)
speakerColor()       -> number    (optional; the \c[n] index that marks a
                                   speaker header. Omit and it is detected)
```

### `ironman`

```
name()               -> string    (optional; what the game calls the mode)
enabled()            -> boolean
slot()               -> number or null
relax(on)            -> boolean   (lift the reload penalty for this session)
marks(info)          -> boolean   (optional; does this savefile row show the mark)
```

### `steam`

```
available()          -> boolean
why()                -> string    (which precondition failed, when unavailable)
get(name)            -> boolean
set(name)            -> boolean
clear(name)          -> boolean
stat(id)             -> number
setStat(id, v)       -> boolean
store()              -> boolean
stats()              -> array     (optional; same shape as steamStats)
```

Only needed when the game reaches Steam through something the module cannot
find by shape. It probes for a generic `greenworks` binding first, and for any
global carrying an unlock call, before falling back to this.

### `modLoader`

```
updateURL(url)       -> string
```

For games shipping a mod loader that rewrites asset URLs. Anything GigaHack
loads by URL goes through this, or it reads the unmodded original.

### `gameOptions`

```
list()               -> array of { key, label }
```

`ConfigManager` keys worth surfacing in the Text panel. Without it, every
boolean on `ConfigManager` outside the engine's stock set is discovered
automatically, which is usually enough.

## Checking your profile

```sh
node gigahack-test/verify-live.js /path/to/the/game
```

It loads the game's real engine, real `plugins.js` and real data files, then
loads GigaHack on top and prints which profile matched, what it resolved, and
every hook that installed or was skipped and why. If your profile did not
match, the report says so and shows the computed defaults it fell back to.

The build lint (`node gigahack-test/lint.js`) checks the profiles directory too
— with the coupling rule switched off, because a profile is the one place game
knowledge is *supposed* to live.
