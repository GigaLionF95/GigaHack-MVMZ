/* =============================================================================
   GigaHack MV/MZ — what happens to everything else when the data directory moves

   Answering the storage question repoints $.paths.dataDir while the game is
   running. The store itself needs nothing: every read and write resolves the
   directory at call time. What needs telling are the modules that read a file
   ONCE, at load, and only ever write it back afterwards — their in-memory copy
   belongs to the folder that was just left, and their next write puts it over a
   file in the new one that the user has never seen.

   These checks are about that silent overwrite, and about the two things the
   cascade deliberately does NOT do.

   The disk model and the __mkDisk / __live helpers are built by checks/paths.js,
   which runs first (the directory is walked in sorted order).
   ========================================================================== */
'use strict';

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev;

  const ready = await ev(() => typeof window.__mkDisk === 'function');
  if (!ready) {
    check('the disk model from checks/paths.js is available to checks/relocate.js', false,
      'window.__mkDisk is missing — paths.js did not run or did not publish it');
    return;
  }

  /* =======================================================================
     THE OVERWRITE THE RELOAD PREVENTS
     ==================================================================== */
  const bookmarks = await ev(() => {
    const G = window.GigaHack;
    const savedCfg = G.cfg;
    /* Two different bookmark files in two different folders. The one beside the
       game is what this session loaded; the one in the shared folder is what
       somebody left there in an earlier session, and it is the one that must
       survive the move. */
    const m = window.__mkDisk({
      '/disk/GameOne/gigahack-userdata/bookmarks.json':
        JSON.stringify({ places: [{ name: 'beside the game', mapId: 1, x: 1, y: 1 }],
                         vars: [11], switches: [] }),
      '/Users/p/Library/Application Support/GigaHack/gameone/bookmarks.json':
        JSON.stringify({ places: [{ name: 'in the shared folder', mapId: 2, x: 2, y: 2 }],
                         vars: [22], switches: [] })
    });
    const restore = window.__live('GameOne');
    const out = {};
    try {
      G.map.reloadBookmarks();
      G.vars.reloadMarks();
      out.before = G.map.bookmarks().map(b => b.name);
      out.beforeVars = G.vars.marked ? G.vars.marked('var') : null;

      /* The move itself, exactly as granting does it. */
      G.relocateData('/Users/p/Library/Application Support/GigaHack/gameone', 'a check');

      out.after = G.map.bookmarks().map(b => b.name);
      /* And the write that used to be the silent overwrite. */
      G.map.addBookmark('added after the move');
      const written = JSON.parse(m.peek('/Users/p/Library/Application Support/GigaHack/gameone/bookmarks.json') || '{}');
      out.written = (written.places || []).map(p => p.name);
      out.oldUntouched = JSON.parse(m.peek('/disk/GameOne/gigahack-userdata/bookmarks.json') || '{}')
        .places.map(p => p.name);
    } finally {
      restore();
      G.cfg = savedCfg;
      G.map.reloadBookmarks();
      G.vars.reloadMarks();
    }
    return out;
  });
  check('a data directory that moves takes the bookmark list with it — the new folder\'s own list is read, not the old one kept',
    bookmarks.before && bookmarks.before[0] === 'beside the game' &&
    bookmarks.after && bookmarks.after[0] === 'in the shared folder',
    JSON.stringify(bookmarks));
  check('and the first pin added afterwards does not write the old folder\'s list over the new folder\'s file',
    bookmarks.written && bookmarks.written.length === 2 &&
    bookmarks.written.indexOf('in the shared folder') > -1 &&
    bookmarks.written.indexOf('added after the move') > -1 &&
    bookmarks.written.indexOf('beside the game') === -1 &&
    bookmarks.oldUntouched && bookmarks.oldUntouched[0] === 'beside the game',
    JSON.stringify(bookmarks));

  /* =======================================================================
     THE TWO THINGS THE CASCADE DOES NOT DO
     ==================================================================== */
  const cascade = await ev(() => {
    const G = window.GigaHack;
    const savedCfg = G.cfg;
    window.__mkDisk();
    const restore = window.__live('GameOne');
    const out = { reloadedSettings: 0, rebuilt: 0, persisted: 0 };
    const realLoad = G.store.loadSettings;
    const realRebuild = G.index.rebuild;
    const realPersist = G.index.persist;
    G.store.loadSettings = function () { out.reloadedSettings++; return realLoad.apply(this, arguments); };
    G.index.rebuild = function () { out.rebuilt++; return realRebuild.apply(this, arguments); };
    G.index.persist = function () { out.persisted++; return realPersist.apply(this, arguments); };
    try {
      G.relocateData('/Users/p/Library/Application Support/GigaHack/gameone', 'a check');
      out.log = G.logHistory().slice(-6).map(e => e.msg).join(' | ');
    } finally {
      G.store.loadSettings = realLoad;
      G.index.rebuild = realRebuild;
      G.index.persist = realPersist;
      restore();
      G.cfg = savedCfg;
    }
    return out;
  });
  /* Settings: whoever moved the directory has already dealt with them, and a
     second read here races the write that is still debounced — it reloads the
     defaults over the top of it and then persists THOSE. */
  check('the move does not re-read the settings, because the storage layer has already dealt with them',
    cascade.reloadedSettings === 0, JSON.stringify(cascade));
  /* The index describes the game's database, which has not moved. A rebuild
     would answer "incomplete" to every query for as long as it ran, which reads
     as a broken index rather than a busy one. */
  check('the move re-persists the index rather than rebuilding it, because the game\'s database has not changed',
    cascade.rebuilt === 0 && cascade.persisted === 1, JSON.stringify(cascade));
  check('and it says out loud where the data now is and what it re-read from there',
    /data directory is now/.test(cascade.log || '') && /re-read/.test(cascade.log || ''),
    (cascade.log || '').slice(0, 160));

  /* =======================================================================
     BACKUPS FOLLOW THE DATA DIRECTORY
     ==================================================================== */
  const backups = await ev(() => {
    const G = window.GigaHack;
    window.__mkDisk();
    const restore = window.__live('GameOne');
    const out = { at: G.backup.dir() };
    try {
      /* A stale cached backupsDir is what resolvePaths left behind before the
         move. It still resolves, still exists and is still writable, which is
         exactly why preferring it would be invisible. */
      G.paths.backupsDir = '/disk/GameOne/gigahack-userdata/backups';
      G.paths.dataDir = '/Users/p/Library/Application Support/GigaHack/gameone';
      out.afterMove = G.backup.dir();
    } finally {
      restore();
    }
    return out;
  });
  check('backups follow the data directory rather than a path cached before it moved',
    /gigahack-userdata\/backups$/.test(backups.at || '') &&
    backups.afterMove === '/Users/p/Library/Application Support/GigaHack/gameone/backups',
    JSON.stringify(backups));

  /* =======================================================================
     THE BROWSER BACKEND IS PER GAME TOO

     NW.js keeps one storage area per APP, and two RPG Maker games whose
     package.json carries the same name — the default, and common — share it.
     Keyed on the file name alone, the second game read the first game's
     settings and every write from either overwrote the other's.
     ==================================================================== */
  const lsKeys = await ev(() => {
    const G = window.GigaHack, S = G.store;
    const savedMode = G.paths.mode, savedId = G.paths.gameId;
    const out = {};
    const wrote = [];
    try {
      G.paths.mode = 'localStorage';
      G.paths.gameId = 'alpha-1111';
      S.write('probe.json', { who: 'alpha' }, true);
      G.paths.gameId = 'beta-2222';
      out.betaSeesNothing = S.read('probe.json', null);
      S.write('probe.json', { who: 'beta' }, true);
      G.paths.gameId = 'alpha-1111';
      out.alphaStillItsOwn = (S.read('probe.json', null) || {}).who;

      /* The upgrade: a key written before this existed carries no game. It is
         adopted once, by whichever game reads first, and then it is gone. */
      localStorage.removeItem('gigahack:alpha-1111:legacy.json');
      localStorage.setItem('gigahack:legacy.json', JSON.stringify({ who: 'from 2.1.0' }));
      out.adopted = (S.read('legacy.json', null) || {}).who;
      out.legacyGone = localStorage.getItem('gigahack:legacy.json') === null;
      out.adoptedUnderTheGame =
        JSON.parse(localStorage.getItem('gigahack:alpha-1111:legacy.json') || '{}').who;
      wrote.push('gigahack:alpha-1111:probe.json', 'gigahack:beta-2222:probe.json',
        'gigahack:alpha-1111:legacy.json');
    } finally {
      wrote.forEach(k => localStorage.removeItem(k));
      localStorage.removeItem('gigahack:legacy.json');
      G.paths.mode = savedMode;
      G.paths.gameId = savedId;
    }
    return out;
  });
  check('in a build with no filesystem two games do not share one settings key, because the storage area itself is shared',
    lsKeys.betaSeesNothing === null && lsKeys.alphaStillItsOwn === 'alpha',
    JSON.stringify(lsKeys));
  check('and a key written before this was keyed is adopted once into this game rather than left to be fought over',
    lsKeys.adopted === 'from 2.1.0' && lsKeys.legacyGone === true &&
    lsKeys.adoptedUnderTheGame === 'from 2.1.0', JSON.stringify(lsKeys));

  /* =======================================================================
     WHERE THE FILES LIVE IS NOT A PREFERENCE
     ==================================================================== */
  const profileStorage = await ev(() => {
    const G = window.GigaHack, S = G.store;
    const before = JSON.stringify(G.cfg.storage);
    const out = {};
    try {
      /* Set directly rather than through setShared(), which refuses while the
         shared folder has not been allowed — the point here is the profile, not
         the gate in front of it. */
      S.cfgSet('storage.share.behaviour', false);
      out.off = G.cfg.storage.share.behaviour;
      S.saveProfile('a check');
      const text = S.exportProfile('a check') || '';
      out.inProfile = /"storage"/.test(text);
      out.hasSomething = /"behaviour"/.test(text) && text.length > 40;
      /* Somebody else's answer, arriving inside something people hand each
         other. Applying it must not change which file this game reads from. */
      S.cfgSet('storage.share.behaviour', true);
      S.applyProfile('a check');
      out.afterApply = G.cfg.storage.share.behaviour;
    } finally {
      S.deleteProfile('a check');
      G.cfg.storage = JSON.parse(before);
      S.saveSettings();
    }
    return out;
  });
  check('a settings profile carries no answer about where files live, so handing one to somebody cannot move their settings',
    profileStorage.inProfile === false && profileStorage.hasSomething === true,
    JSON.stringify(profileStorage));
  check('and applying one leaves this machine\'s sharing exactly as it found it',
    profileStorage.off === false && profileStorage.afterApply === true,
    JSON.stringify(profileStorage));

  /* =======================================================================
     A HOOK THAT REBUILDS THE TAB MUST NOT SILENCE THE HOOKS AFTER IT

     A live panel that finds the thing it was drawing has gone asks for a tab
     rebuild, and renderTab empties the hook list with `length = 0`. Iterated
     live, every hook registered after that one was skipped for that tick —
     silently, and only on the ticks where a rebuild happened, which is the
     hardest kind of intermittent to attribute.
     ==================================================================== */
  await ev(() => {
    const G = window.GigaHack, host = G.ui.getHost();
    G.ui.setOpen(true);
    window.__reentrant = { first: 0, second: 0 };
    // Registered after every panel's own hooks, and driven by the SHELL's own
    // 700ms clock rather than by a copy of its loop written here — a check that
    // reimplements the loop it is testing proves nothing about the loop.
    host.tickHooks.push(function () { window.__reentrant.first++; host.tickHooks.length = 0; });
    host.tickHooks.push(function () { window.__reentrant.second++; });
  });
  await ctx.page.waitForTimeout(900);
  const reentrant = await ev(() => {
    const out = window.__reentrant;
    window.GigaHack.ui.rerender();      // put the panel's own hooks back
    window.GigaHack.ui.setOpen(false);
    return out;
  });
  check('a tick hook that clears the hook list does not take the hooks after it down with it, ' +
    'because the shell drives its own clock over a copy',
    reentrant.first === 1 && reentrant.second === 1, JSON.stringify(reentrant));

  /* =======================================================================
     THE LOG COUNT, WHICH A LIVE PANEL ASKS FOR TWICE A SECOND
     ==================================================================== */
  const logCount = await ev(() => {
    const G = window.GigaHack;
    const before = G.logCount();
    G.log('info', 'a line written by a check');
    return { before: before, after: G.logCount(), history: G.logHistory().length,
             isFunction: typeof G.logCount === 'function' };
  });
  check('the log ring can be counted without copying it, which is what a panel polling it every 700ms needs',
    logCount.isFunction === true && logCount.after === logCount.before + 1 &&
    logCount.after === logCount.history, JSON.stringify(logCount));

  /* =======================================================================
     THE CLIPBOARD IS ASKED, NOT REMEMBERED
     ==================================================================== */
  const clip = await ev(() => {
    const G = window.GigaHack;
    const real = G.caps.clipboard();
    const saved = navigator.clipboard;
    let forced;
    try {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      forced = G.caps.clipboard();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: saved, configurable: true });
    }
    return { real: real, forced: forced, back: G.caps.clipboard().read === real.read };
  });
  check('the clipboard is a capability asked at call time, not a snapshot taken at boot',
    clip.forced.read === false && clip.back === true &&
    /nw\.Clipboard is absent/.test(clip.forced.why) && /secure context/.test(clip.forced.why),
    JSON.stringify(clip));

  /* =======================================================================
     A ROW WHOSE PATH IS MISSING KEEPS ITS LABEL

     Found by looking at a screenshot, not by a check: "In use now" came out as
     "In use n…" while the three-line reason beside it read perfectly. The
     sidebar sweep in run.js only scans narrow columns and never saw it.
     ==================================================================== */
  const pathRow = await ev(() => {
    const G = window.GigaHack, W = G.ui.w;
    const host = G.ui.getHost();
    const box = document.createElement('div');
    box.style.width = '300px';
    host.root.appendChild(box);
    const why = 'there is no directory in localStorage mode — no Node filesystem — this is a ' +
      'browser or web-deployed build; anything that reads the game folder is unavailable here.';
    const row = W.pathRow('In use now', null, { why: why });
    box.appendChild(row);
    const lab = box.querySelector('.mm-lab');
    const out = {
      clipped: lab.scrollWidth > lab.clientWidth + 1,
      width: lab.clientWidth,
      whyOnItsOwnLine: box.textContent.indexOf(why) > -1 &&
        box.querySelector('.mm-row').textContent.indexOf(why) === -1
    };
    box.remove();
    return out;
  });
  check('a path row with no path keeps its label whole and puts the reason on its own line, where it has the width',
    pathRow.clipped === false && pathRow.width > 60 && pathRow.whyOnItsOwnLine === true,
    JSON.stringify(pathRow));

  /* =======================================================================
     FOR HUMAN REVIEW

     The suite compares no pixels — a full-viewport differ reddens every shot on
     any layout shift — so these exist to be looked at. The three panels this
     release adds, plus the card, which is the only thing GigaHack draws that a
     person sees without having opened the menu.
     ==================================================================== */
  const shots = [
    ['settings', 'Storage', 'panel-storage'],
    ['settings', 'Addons', 'panel-addons'],
    ['debug', 'Addons', 'panel-addons-debug']
  ];
  for (const [tab, sub, name] of shots) {
    await ev((s) => {
      const G = window.GigaHack;
      G.ui.setOpen(true);
      G.cfg.ui.tab = s.tab;
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub[s.tab] = s.sub;
      G.ui.rerender();
    }, { tab: tab, sub: sub });
    const drew = await ev(() =>
      (document.querySelector('#mm-root .mm-body') || {}).textContent || '');
    check('the ' + tab + ' → ' + sub + ' panel draws something worth photographing',
      drew.length > 60, drew.slice(0, 60));
    await ctx.shot(name);
  }

  /* The card refuses to appear where there is no filesystem, which the harness
     is — there is nothing outside the game folder to reach and so no question
     worth putting. So the shot is taken with a disk under it, and the refusal
     is worth asserting on the way past. */
  const card = await ev(() => {
    const G = window.GigaHack;
    const moot = G.ui.showStorageCard();
    window.__mkDisk();
    window.__cardRestore = window.__live('GameOne');
    G.ui.setOpen(false);
    if (G.ui.toasts) G.ui.toasts();
    const host = G.ui.getHost();
    if (host && host.toasts) while (host.toasts.firstChild) host.toasts.removeChild(host.toasts.firstChild);
    const shown = G.ui.showStorageCard();
    return { moot: moot, shown: shown, open: G.ui.isStorageCardOpen() };
  });
  check('the card does not ask a question that has no meaning on a build with no filesystem',
    card.moot.shown === false && /filesystem|browser|web-deployed/i.test(card.moot.why || ''),
    JSON.stringify(card.moot));
  check('and it does appear on a build that has one, with no answer yet on record',
    card.shown.shown === true && card.open === true, JSON.stringify(card));
  await ctx.shot('storage-card');
  await ev(() => {
    window.GigaHack.ui.hideStorageCard();
    if (window.__cardRestore) { window.__cardRestore(); window.__cardRestore = null; }
  });
};
