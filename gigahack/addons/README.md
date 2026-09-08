# Addons

An addon is a JavaScript file **you** supply. GigaHack lists it before it runs
it, runs it only when you switch it on, and takes back everything it registered
when you switch it off — with two exceptions that are named below rather than
left for you to discover.

They are called addons and not plugins because "plugin" already means one of the
*game's* own plugins in this menu: Debug → Plugins lists those, the
compatibility panel reasons about them, and the installer edits `js/plugins.js`.
One word, one meaning.

**This is not a sandbox.** An addon runs with the game's privileges, exactly
like any plugin the game itself loads, and nothing here can make that untrue.
What GigaHack does do: nothing runs until you enable it, you see the whole
source before you add it, a link is never fetched again on its own, and an addon
that throws is stopped and named with its line number. Import an addon the way
you would run a script somebody handed you — because that is what it is.

---

## The shortest possible one

```js
/*:
 * @gigahack-addon
 * @id hello
 */
GigaHack.addon(function (api) {
    api.log('ok', 'hello');
});
```

Press **start from a template** in Settings → Addons for the full one; it goes
onto the clipboard and into the paste box in the same click, so you can paste it
straight back in and watch it work before you change a line of it.

---

## The file has two halves, and the split is the point

```js
/*:
 * @gigahack-addon
 * @id town-gold
 * @name Town gold
 * @version 1.0.0
 * @author someone
 * @game /a title pattern/i
 * @needs vars, screen
 * @help One line, or many, shown in the addon's row.
 * Everything up to the next @key or the end of the block is help.
 */
GigaHack.addon(function (api) {
    /* … the body … */
});
```

**The header is read without running anything.** It is parsed with a regular
expression, the same way the engine reads a plugin's own annotation block, so
the list can show what a file *claims* — its name, what game it says it is for,
what it needs — before a single line of it has executed.

| key | what it is for |
|---|---|
| `@gigahack-addon` | marks the block. Without it the block is only read if it starts `/*:` and carries at least one `@key`. |
| `@id` | the identity, on every route in — the review, the folder, the shared library. Absent, it is taken from the file name. Either way it is cleaned to `a-z0-9-` (see *a hotkey id may not contain a dot*, below), so `town.gold.js` is listed as `town-gold` and the file keeps its own name. Two files claiming one id is a named conflict and the second is refused with the first one's path in the message. |
| `@name` | what the row says. Absent, the id. |
| `@version` `@author` | shown in the row, checked by nothing. |
| `@game` | a title pattern this addon says it is for. **Nothing checks it against the running game** — it is what the file says about itself, and the panel labels it that way. |
| `@needs` | module keys the body will ask for with `api.need()`. Advisory. |
| `@help` | greedy to the next `@key` or the end of the block, so a paragraph survives. |

A file with **no header** is listed as claiming nothing. It is never refused for
that.

**The id is not the file name.** The id is what the addon is listed, enabled and
keyed on — it goes into `hotkeys.<id>` and into `addon-<id>.json`, so it is
cleaned. The file name is only where the bytes are, and it is kept verbatim.
Where the two differ the row says so, and renaming the file does not orphan the
addon's enablement or its saved data.

**The body runs only when the addon is enabled**, through
`new Function('GigaHack', 'addon', src + '//# sourceURL=gigahack-addon:<id>')`.
The `sourceURL` is why an error in your addon says `gigahack-addon:town-gold:14`
instead of `VM123:1`, and why the panel can print the line.

Both spellings work — `GigaHack.addon(setup)` and the `addon` argument the
wrapper is given are the same function. A file that calls neither is reported as
"loaded, registered nothing", out loud; it is not treated as success.

---

## What `api` gives you

| call | what it does | undone by disable |
|---|---|---|
| `api.id` `api.name` `api.version` | the identity this addon is listed under | — |
| `api.panel(tab, name, build, order)` | a panel on one of the six tabs — `player`, `world`, `items`, `game`, `debug`, `settings` — under a name that tab does not already use | **yes** — taken off and the tab rebuilt |
| `api.hotkey({id, label, help, when, run})` | a bind, in Settings → Hotkeys like any other | **yes** |
| `api.command(name, fn, help)` | `GigaHack.api.<name>()`, listed by `GigaHack.api.help()` | **yes** |
| `api.on(event, fn)` | `frame`, `tick`, `map`, `battle`, `message`, `save`, `load`, `menu` | **yes** |
| `api.profile(def)` | a game profile | **no** — see below |
| `api.hook(name, owner, method, factory, reason)` | an engine alias | **no** — see below |
| `api.store` | `read(key, fallback)`, `write(key, v)`, `save(key, v)` (debounced), `remove(key)`, `all()`, `file()` — in this addon's own file | — |
| `api.game` | guarded state: every write read back and reported | — |
| `api.need(key)` | a module's namespace, or `null` and the reason in the log | — |
| `api.log(level, msg)` `api.toast(o)` | the mod's logger and toaster | — |
| `api.w` `api.h` `api.cols` `api.kv` | the widget kit the rest of the menu is built from | — |
| `api.caps` `api.eng` | what this engine build can do, and the MV/MZ adapters | — |
| `api.compat` | write-verify, degradation, load order | — |
| `api.profileOf()` | the resolved game profile | — |
| `api.watch` `api.journal` `api.interp` `api.rng` `api.snap` | the Trace and Snapshot services, `null` where the module did not load | — |

Debug → Addons renders this same table from the same data the api object is
built against, so the reference in the menu cannot drift from the object.

### The two that cannot be undone

**An engine alias.** `$.install` keeps an `unpatch` that refuses when something
else has aliased on top — which is correct, because forcing it would silently
discard the other plugin's work. So an addon's alias is installed **once**,
permanently, as a wrapper that consults the addon's enabled flag and otherwise
calls straight through. Disabling is real and immediate: the wrapper stops doing
anything the same instant. Nothing is left half-hooked and no chain is ever
broken. The row shows the count, and switching the addon back on makes the same
wrapper live again rather than installing a second one.

If your alias lands on a method GigaHack already hooks, the panel warns you: the
hook underneath yours will read as over-patched and the `aliases` self-test will
fail until the baseline is retaken. Debug → Addons has the button, and it says
what retaking it erases.

**A profile.** Profile resolution is memoised at the first read after boot, and
four things downstream have already read it by the time an addon can register
one. So a profile from an addon **applies from the next launch**. The panel says
so, and offers a re-resolve with the four things it does *not* move named beside
it: derived hotkey defaults, the Gallery panel's decision, the Forge id bases
already written to its library, and any section cache.

### Events are noticed, not intercepted

None of the eight is an engine alias. This module loads last, so an alias here
would sit on top of the one another module already holds on the same method and
take away *that* module's removal from Debug → Hooks. Every event is read off a
frame hook instead:

| event | when it fires | payload |
|---|---|---|
| `frame` | every frame the mod ticks | the mod's frame count |
| `tick` | about every 700ms | the same count |
| `map` | the map id changed | the new map id |
| `battle` | a battle started | the troop id |
| `message` | a page was said | the **converted** text, from the mod's own recorder |
| `save` | a save landed | the slot id, where the engine will say |
| `load` | the game objects were replaced | `{fresh, saves}` — `fresh` is a new game |
| `menu` | the overlay opened or closed | `true` or `false` |

`message` needs `GigaHack_Text`; Debug → Addons says so where it is missing
rather than leaving the subscription silently dead.

**A handler that throws is stopped and named.** `frame` runs on the frame clock,
so a handler that throws on every call would write a log line per frame and
overwrite the whole log ring in about a minute — and the log is the first thing a
bug report carries. The first throw is logged with its line, the rest are counted
on the addon's row, and after eight the *subscription* is dropped and that is said
once. The addon itself stays enabled: one dead handler is not a reason to take
its panels away, and **read it again** re-subscribes it.

### Writing to the game

```js
var r = api.game.setVar(7, 100);
//  → { ok, got, want, culprits, message }
```

`setVar`, `setSwitch` and `setGold` route through the same write-and-read-back
path the rest of the menu uses, honour read-only mode, and push an undo entry.
An addon that ignores the result is at least visible in the change journal.

`culprits` and `message` are what `$.compat` produced for that write — the loaded
plugins known to touch that control, and the sentence naming them — not a
stand-in. Where the write was refused before anything read it back, the message
says that instead of naming anyone.

You can still reach `$gameVariables` directly. This is a mod menu, not a
sandbox, and pretending otherwise would be the dishonest option — but a write
that goes around `api.game` is a write nothing can tell you did not stick.

---

## Where they live

```
<dataDir>/addons/*.js          this game's addons
<dataDir>/addons.json          which of them are on, in THIS game
<sharedCommonDir>/addons/*.js  the library, when you have allowed the shared folder
```

The library is shared between games. **Enablement is per game.** One
machine-wide "on" is not what anybody means when they switch something on in one
game.

**Removal is not per game.** There is one copy of a library addon, so removing it
deletes the file every game on this machine reads. The row says which folder an
addon is kept in before you get to the button, the confirm on the button reads
*delete the shared copy?* rather than *delete the file?*, and the message
afterwards says the other games have lost it. From the console — where there is
no confirm at all — the consequence has to be typed:
`GigaHack.addons.remove('<id>', { shared: true })`. Without the flag it is
refused, with the shared path in the reason.

On a build with no filesystem — a browser or web deploy — an addon is kept in
the settings store under the same name and the folder scan is replaced by the
index. Importing and enabling still work; there is simply no folder to drop a
file into, and the panel says so.

`Settings → Addons` prints both absolute paths, and the reason when one of them
is not available.

---

## Bringing one in

Every source ends in the same place: a **review** that shows the whole source,
its size, its fingerprint and the header it claims, before anything runs.

| source | needs |
|---|---|
| paste | nothing — it is always available |
| clipboard | `nw.Clipboard` under a desktop build, or `navigator.clipboard.readText`. The panel names whichever of the two is missing. |
| link | a transport. The panel names the host and the transport **before** the request, because it is your machine that makes it. |
| file | a filesystem, and a path this process can actually read |
| folder | a filesystem |

Rules that do not bend:

- **Nothing imported is enabled.** It lands switched off with its source
  recorded. Enabling is a separate, deliberate act.
- **A link is never re-fetched on its own.** "Check the source again" is a
  button; it reports *changed*, *unchanged* or *unreachable* and still installs
  nothing.
- A response that is not JavaScript is refused **by inspection**, with its first
  line quoted — an HTML error page arriving with a cheerful 200 is the common
  case.
- A file that does not parse is refused with its line. Compiling to find that
  out never calls it.
- There is a size ceiling and the message carries the number.

---

## When one breaks the game

- **A crash guard** writes the name of the addon about to be evaluated and
  clears it after. If that file is still there at the next launch, that addon is
  quarantined and not run, and the panel says "this was loading when the game
  last stopped". Nothing there can tell whether it was the cause — switching it
  on again is how you find out.
- **Safe mode** skips every addon for one launch. There is a switch in the panel
  that survives the relaunch and then clears itself, and holding the panic-hide
  key while the game starts does the same thing. The switch is the reliable one:
  a held key is only seen if the browser has delivered a keystroke by the time
  addons load. A safe-mode launch still *applies* a quarantine the marker was
  holding — it is the launch you reach for when an addon has hung the game, so
  it is the one the quarantine has to survive.
- An addon that was skipped is not an addon that was quarantined, and the panel
  does not report one as the other: it says which of the two happened by reading
  the addon's own row.
- One addon's failure never touches another. Each is compiled, set up and torn
  down on its own.
- Everything is in Debug → Addons: load order, timings, what each one
  registered, what threw and on which line.

---

## A worked example

This is the file the **start from a template** button hands you. It registers
one of everything that can be taken back again.

```js
/*:
 * @gigahack-addon
 * @id hello-addon
 * @name Hello, addon
 * @version 1.0.0
 * @author you
 * @needs vars
 * @help A worked example. It adds a panel, a hotkey, a console call and
 * one event listener — and every one of those goes away again when you
 * switch it off. Edit it, paste it back in, and it replaces this one.
 */
GigaHack.addon(function (api) {

    var W = api.w;

    /* A panel, on any of the six tabs. Removed again on disable. */
    api.panel('world', 'Hello', function () {
        var opened = api.store.read('opened', 0) + 1;
        api.store.write('opened', opened);
        return api.cols([
            W.group('This addon', [
                api.kv('id', api.id),
                api.kv('opened', opened + ' time(s) this install'),
                api.kv('gold', api.game.gold()),
                W.button({
                    label: 'say hello in the log', wide: true, _ungated: true,
                    onClick: function () { api.log('ok', 'hello'); }
                })
            ], { tag: api.version })
        ]);
    }, 165);

    /* A bind. It appears in Settings -> Hotkeys unbound; give it a key. */
    api.hotkey({
        id: 'hello',
        label: 'Say hello',
        help: 'Shows a toast. Bind it in Settings -> Hotkeys.',
        run: function () {
            api.toast({ title: 'HELLO', msg: api.id, severity: 'ok' });
        }
    });

    /* GigaHack.api.hello() in the console tab, listed by api.help(). */
    api.command('hello', function () {
        return { addon: api.id, gold: api.game.gold() };
    }, 'What this addon can see, as an object.');

    /* Every write is read back through the same verify the menu uses. */
    api.command('helloSetVar', function (id, value) {
        return api.game.setVar(id, value);
    }, 'Set a variable and report whether it stuck.');

    /* frame, tick, map, battle, message, save, load, menu. */
    api.on('map', function (mapId) {
        api.log('info', 'entered map ' + mapId);
    });
});
```

The test suite imports exactly this source, commits it, enables it, renders the
panel it registered and reads values out of it. If the template ever stops being
a working addon, a named check goes red.

---

## Things that will bite you

- **A hotkey starts unbound.** `api.hotkey` puts a row in Settings → Hotkeys
  with no key on it, because the settings defaults have never heard of your id.
  The log says so once. Bind it there, or write the code yourself and ask
  `GigaHack.ui.hotkeyClash(code)` first — the keydown handler returns on the
  first match, so a duplicate bind is not ambiguous, it is dead.
- **A hotkey id may not contain a dot.** Ids become part of the dotted settings
  path `hotkeys.<id>`, and a dot writes a nested object nothing can ever match —
  the binding UI shows a key and pressing it does nothing. Colons are fine; the
  id you pass is cleaned to `a-z0-9-` and namespaced under `addon:<your id>:`,
  and *your addon's own id* is cleaned the same way whichever route it came in
  by, so a file called `town.gold.js` cannot produce one.
- **A console name that is taken is refused**, with a free one suggested. Around
  seventy are already in use.
- **A panel name that tab already uses is refused too**, for a harder reason:
  registering a panel *replaces* by name and disabling *removes* by name, so a
  panel called `Hooks` on the debug tab would not add one, it would take
  GigaHack's own away — and switching your addon off would then delete it for the
  rest of the session. The refusal names the tab and suggests
  `<name> (<your id>)`.
- **Pick a panel order no other panel on that tab uses.** Two panels sharing one
  order sort unpredictably.
- **Re-importing over a running addon stops it first.** The new file lands
  switched off, and "off" means off: the previous version's panel, hotkey,
  console name and event subscriptions are gone before the new source is
  written down.
- **Your panel's `build` runs on every render.** Do the expensive part once,
  outside it, and keep a reference.
- **A panel that shows something the game changes should repaint itself.** Use
  `GigaHack.ui.live(signal, paint)` rather than a rerender: a rerender throws the
  DOM away and takes the reader's scroll, focus and half-typed search with it.
