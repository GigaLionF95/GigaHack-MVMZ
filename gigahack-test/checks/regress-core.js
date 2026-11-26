/* =============================================================================
   GigaHack test harness — checks/regress-core.js
   Regressions for the core review: backups, save import, the store's reads,
   the data-directory cascade and the self-test's side effects.

   Each block below is one bug that shipped, driven the way it was found, and
   asserted on the outcome the player would have seen — not on the shape of the
   fix. Where a check needs a filesystem it uses the in-memory Node model that
   checks/paths.js publishes (window.__mkDisk / window.__live); every check
   builds its own disk, swaps the paths in, and puts them back in a finally.

   State discipline: $.paths, $.env, $.cfg, $.caps.fs, the engine's save-index
   functions and every in-memory list a data-directory move reloads are put back
   before each block returns. The cascade is re-run against the restored paths
   where a block moved the directory, so no module is left holding a list read
   from a disk that no longer exists.
   ========================================================================== */
'use strict';

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev;

  const ready = await ev(() => typeof window.__mkDisk === 'function' && typeof window.__live === 'function');
  if (!ready) {
    check('the disk model from checks/paths.js is available to checks/regress-core.js', false,
      'window.__mkDisk / __live are missing — paths.js did not run or did not publish them');
    return;
  }

  /* =======================================================================
     $.mkdirp — an existing folder is success, a missing parent is created
     ==================================================================== */
  const mk = await ev(() => {
    const G = window.GigaHack;
    const m = window.__mkDisk({ '/disk/MkTest/a-file': 'x' });
    const out = {};
    try {
      out.made = G.mkdirp('/disk/MkTest/one/two/three', m.fs, m.path);
      out.nested = ['/disk/MkTest/one', '/disk/MkTest/one/two', '/disk/MkTest/one/two/three']
        .every(d => m.has(d));
      out.again = G.mkdirp('/disk/MkTest/one/two/three', m.fs, m.path);
      out.existingTop = G.mkdirp('/disk/MkTest', m.fs, m.path);
      try { G.mkdirp('/disk/MkTest/a-file', m.fs, m.path); out.fileThrew = false; }
      catch (e) { out.fileThrew = e.code || e.message; }
    } catch (e) { out.error = e.message; }
    return out;
  });
  check('$.mkdirp creates every missing parent, and says it did',
    mk.made === true && mk.nested === true, JSON.stringify(mk));
  check('and an existing folder — nested or top-level — is success rather than EEXIST',
    mk.again === false && mk.existingTop === false && !mk.error, JSON.stringify(mk));
  check('while a FILE where a folder was asked for is still refused',
    mk.fileThrew === 'ENOTDIR', JSON.stringify(mk));

  /* =======================================================================
     WHOLE-FILE WRITES GO THROUGH A TEMPORARY FILE AND A RENAME

     A truncating write that is interrupted leaves a file that parses as
     neither version. The write now lands beside the target and is renamed
     over it — and where Windows refuses the rename because another program
     holds the file open, it falls back to the direct write it used to be.
     ==================================================================== */
  const atomic = await ev(() => {
    const G = window.GigaHack;
    const dir = '/disk/GameOne/gigahack-userdata';
    const m = window.__mkDisk({ [dir + '/atomic-probe.json']: '{"v":"old"}' });
    const restore = window.__live('GameOne');
    const realRename = m.fs.renameSync;
    const out = {};
    try {
      m.reset();
      out.ok = G.store.write('atomic-probe.json', { v: 'new' }, true);
      out.content = JSON.parse(m.peek(dir + '/atomic-probe.json') || '{}').v;
      out.viaTmp = m.log().some(e => e.op === 'writeFileSync' && /atomic-probe\.json\.tmp-/.test(e.path));
      out.tmpLeft = m.list(dir).filter(f => /\.tmp-/.test(f));

      /* The file is open in another program: the rename is refused. */
      m.fs.renameSync = function () { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; };
      const logBefore = G.logHistory().length;
      out.okLocked = G.store.write('atomic-probe.json', { v: 'newer' }, true);
      out.contentLocked = JSON.parse(m.peek(dir + '/atomic-probe.json') || '{}').v;
      out.tmpLeftLocked = m.list(dir).filter(f => /\.tmp-/.test(f));
      const said = G.logHistory().slice(logBefore).filter(e => /in one step/.test(e.msg));
      out.saidAt = said.map(e => e.level);
      out.failed = G.store.hasFailed('atomic-probe.json');
    } catch (e) { out.error = e.message; } finally {
      m.fs.renameSync = realRename;
      G.store.retry('atomic-probe.json');
      restore();
    }
    return out;
  });
  check('a store write goes through a temporary file beside the target and leaves none behind',
    atomic.ok === true && atomic.content === 'new' && atomic.viaTmp === true &&
    atomic.tmpLeft && atomic.tmpLeft.length === 0 && !atomic.error, JSON.stringify(atomic));
  check('and a rename refused with EPERM (the file open elsewhere) falls back to a direct write, said at info',
    atomic.okLocked === true && atomic.contentLocked === 'newer' &&
    atomic.tmpLeftLocked && atomic.tmpLeftLocked.length === 0 &&
    atomic.saidAt && atomic.saidAt.length === 1 && atomic.saidAt[0] === 'info' && atomic.failed === false,
    JSON.stringify(atomic));

  /* =======================================================================
     RESTORING THE OLDEST BACKUP WHEN THE RING IS FULL

     The safety backup a restore takes first used to prune the ring, and the
     oldest entry — the one being restored — was what the prune took. Every
     file then failed its existence test and "RESTORED 0 file(s)" was shown
     over a backup that had been deleted.
     ==================================================================== */
  const oldest = await ev(() => {
    const G = window.GigaHack;
    const savedCfg = G.cfg, wasFs = G.caps.fs;
    const m = window.__mkDisk();
    const restore = window.__live('GameOne');
    const out = {};
    try {
      G.caps.fs = true;
      G.cfg = Object.assign({}, savedCfg, {
        behaviour: Object.assign({}, savedCfg.behaviour, { backupKeep: 3, readonly: false })
      });
      const ext = G.caps.saveExt;
      const saveDir = String(G.backup.saveDir() || '').replace(/\/$/, '');
      const root = G.backup.dir();
      for (let i = 1; i <= 3; i++) {
        const dir = root + '/2020010' + i + '-000000_manual';
        m.add(dir + '/file1' + ext, 'OLD-' + i);
        m.add(dir + '/gigahack-backup.json', JSON.stringify({
          at: '2020-01-0' + i + 'T00:00:00.000Z', reason: 'manual', files: ['file1' + ext]
        }));
      }
      m.add(saveDir + '/file1' + ext, 'LIVE');
      const list = G.backup.list();
      out.before = list.length;
      const entry = list[list.length - 1];
      out.entry = entry.name;
      out.n = G.backup.restore(entry);
      out.live = m.peek(saveDir + '/file1' + ext);
      out.entryKept = m.has(entry.dir + '/file1' + ext) && m.peek(entry.dir + '/file1' + ext) === 'OLD-1';
      out.after = G.backup.list().length;
      out.preRestore = G.backup.list().some(e => e.reason === 'pre-restore');
    } catch (e) { out.error = e.message; } finally {
      G.caps.fs = wasFs;
      restore();
      G.cfg = savedCfg;
    }
    return out;
  });
  check('restoring the OLDEST backup of a full ring puts its files back instead of pruning it first',
    oldest.before === 3 && oldest.entry === '20200101-000000_manual' && oldest.n === 1 &&
    oldest.live === 'OLD-1' && !oldest.error, JSON.stringify(oldest));
  check('and the backup that was restored is still there afterwards, beside the safety backup it took',
    oldest.entryKept === true && oldest.preRestore === true && oldest.after === 4, JSON.stringify(oldest));

  /* =======================================================================
     ONE UNREADABLE BACKUP DESCRIPTION DOES NOT HIDE THE OTHERS
     ==================================================================== */
  const corruptMeta = await ev(() => {
    const G = window.GigaHack;
    const wasFs = G.caps.fs;
    const m = window.__mkDisk();
    const restore = window.__live('GameOne');
    const out = {};
    try {
      G.caps.fs = true;
      const ext = G.caps.saveExt;
      const root = G.backup.dir();
      m.add(root + '/20200101-000000_teleport/file1' + ext, 'A');
      m.add(root + '/20200101-000000_teleport/gigahack-backup.json',
        JSON.stringify({ at: '2020-01-01T00:00:00.000Z', reason: 'teleport', files: ['file1' + ext] }));
      m.add(root + '/20200102-000000_manual/file2' + ext, 'B');
      m.add(root + '/20200102-000000_manual/gigahack-backup.json', '{"at": "2020-01-02T00:0');
      const list = G.backup.list();
      out.n = list.length;
      out.good = list.filter(e => e.reason === 'teleport').length;
      const bad = list.filter(e => e.name === '20200102-000000_manual')[0] || null;
      out.badReason = bad && bad.reason;
      out.badFiles = bad && bad.files;
    } catch (e) { out.error = e.message; } finally {
      G.caps.fs = wasFs;
      restore();
    }
    return out;
  });
  check('a truncated gigahack-backup.json no longer empties the whole backup list',
    corruptMeta.n === 2 && corruptMeta.good === 1 && !corruptMeta.error, JSON.stringify(corruptMeta));
  check('and the unreadable one is listed from the save files it actually holds, marked unreadable',
    corruptMeta.badReason === 'unreadable' && Array.isArray(corruptMeta.badFiles) &&
    corruptMeta.badFiles.length === 1 && /^file2\./.test(corruptMeta.badFiles[0]), JSON.stringify(corruptMeta));

  /* =======================================================================
     IMPORTING INTO AN EMPTY SLOT MAKES THE SLOT LOADABLE

     Both engines gate loading on the slot's index entry, and an import into
     an empty slot created none — the file was there and nothing could reach
     it. The engine's index write is captured rather than performed, so the
     harness's own save index is not changed.
     ==================================================================== */
  const imported = await ev(() => {
    const G = window.GigaHack, S = G.saveTools;
    const wasFs = G.caps.fs, savedCfg = G.cfg;
    const m = window.__mkDisk();
    const restore = window.__live('GameOne');
    const realSaveGI = DataManager.saveGlobalInfo;
    const hadGI = Object.prototype.hasOwnProperty.call(DataManager, '_globalInfo');
    const realGI = DataManager._globalInfo;
    const out = {};
    try {
      G.caps.fs = true;
      G.cfg = Object.assign({}, savedCfg, { behaviour: Object.assign({}, savedCfg.behaviour, { readonly: false }) });
      if (Array.isArray(realGI)) DataManager._globalInfo = realGI.slice();
      G.eng.invalidateSaveInfo();
      let id = 0;
      for (let i = S.maxSlots(); i >= 1; i--) { if (!S.info(i)) { id = i; break; } }
      out.slot = id;
      let wrote = null;
      DataManager.saveGlobalInfo = function (gi) {
        const arr = gi || DataManager._globalInfo || [];
        wrote = arr[id] ? JSON.parse(JSON.stringify(arr[id])) : null;
      };
      const ext = G.caps.saveExt;
      m.add(S.importDir() + '/brought-in' + ext, 'IMPORTED-BYTES');
      const r = S.importInto('brought-in' + ext, id);
      out.ok = r.ok; out.replaced = r.replaced; out.error = r.error || null;
      out.entry = wrote;
      out.bytes = m.peek(G.eng.savePath(id));
    } catch (e) { out.threw = e.message; } finally {
      DataManager.saveGlobalInfo = realSaveGI;
      if (hadGI) DataManager._globalInfo = realGI;
      G.eng.invalidateSaveInfo();
      G.caps.fs = wasFs;
      restore();
      G.cfg = savedCfg;
    }
    return out;
  });
  check('a save imported into an EMPTY slot gets an index entry, so the slot can be loaded at all',
    imported.slot > 0 && imported.ok === true && imported.replaced === false &&
    imported.bytes === 'IMPORTED-BYTES' &&
    !!imported.entry && /\(imported\)$/.test(imported.entry.title || '') && !imported.threw,
    JSON.stringify(imported));

  /* =======================================================================
     AN UNPARSEABLE profiles.json IS SET ASIDE, NOT WRITTEN OVER
     ==================================================================== */
  const profiles = await ev(() => {
    const G = window.GigaHack;
    const savedCfg = G.cfg;
    const dir = '/disk/GameOne/gigahack-userdata';
    const broken = '{"_schema": 1, "profiles": {"the one I spent an hour on": {"ui": {"accen';
    const m = window.__mkDisk({ [dir + '/profiles.json']: broken });
    const restore = window.__live('GameOne');
    const out = {};
    try {
      G.cfg = Object.assign({}, savedCfg, { behaviour: Object.assign({}, savedCfg.behaviour, { readonly: false }) });
      out.saved = G.store.saveProfile('after the crash', '2026-01-01T00:00:00.000Z');
      const aside = m.list(dir).filter(f => /\/profiles\.json\.corrupt-/.test(f));
      out.aside = aside.length;
      out.asideIntact = aside.length === 1 && m.peek(aside[0]) === broken;
      out.now = Object.keys((JSON.parse(m.peek(dir + '/profiles.json') || '{}').profiles) || {});
      out.failed = G.store.hasFailed('profiles.json');
    } catch (e) { out.error = e.message; } finally {
      G.store.flush();
      restore();
      G.cfg = savedCfg;
    }
    return out;
  });
  check('a profiles.json that does not parse is kept aside, byte for byte, before the next save writes the file',
    profiles.saved === 'after the crash' && profiles.aside === 1 && profiles.asideIntact === true &&
    !profiles.error, JSON.stringify(profiles));
  check('and the save that follows still works, into a fresh file',
    profiles.now && profiles.now.length === 1 && profiles.now[0] === 'after the crash' &&
    profiles.failed === false, JSON.stringify(profiles));

  /* =======================================================================
     A DATA-DIRECTORY MOVE RE-READS THE AUTOMATION TRIGGERS
     ==================================================================== */
  const auto = await ev(() => {
    const G = window.GigaHack;
    const savedCfg = G.cfg;
    const local = '/disk/GameOne/gigahack-userdata/auto-triggers.json';
    const shared = '/Users/p/Library/Application Support/GigaHack/gameone/auto-triggers.json';
    const file = name => JSON.stringify({ _schema: 1, seq: 2, triggers: [{
      id: 't1', name: name, when: { kind: 'switch', id: 1, value: true }, snippet: '1', on: false
    }] });
    const m = window.__mkDisk({ [local]: file('beside the game'), [shared]: file('in the shared folder') });
    const restore = window.__live('GameOne');
    const out = {};
    if (!G.auto || !G.auto.reload) return { absent: true };
    try {
      G.cfg = Object.assign({}, savedCfg, { behaviour: Object.assign({}, savedCfg.behaviour, { readonly: false }) });
      G.auto.reload();
      out.before = G.auto.triggers().map(t => t.name);
      G.relocateData('/Users/p/Library/Application Support/GigaHack/gameone', 'a check');
      out.after = G.auto.triggers().map(t => t.name);
      G.auto.addTrigger({ name: 'added after the move', when: { kind: 'switch', id: 1, value: true },
        snippet: '1', on: false });
      G.store.flush();
      out.written = (JSON.parse(m.peek(shared) || '{}').triggers || []).map(t => t.name);
      out.localUntouched = (JSON.parse(m.peek(local) || '{}').triggers || []).map(t => t.name);
    } catch (e) { out.error = e.message; } finally {
      G.store.flush();
      restore();
      G.cfg = savedCfg;
      /* The cascade read every module's list from the model disk; run it again
         against the restored paths so none of them is left holding those. */
      G.emit('paths:changed', { was: null, now: G.paths.dataDir, why: 'regress-core cleanup' });
    }
    return out;
  });
  if (auto.absent) {
    check('the automation module is present for the data-directory reload check', false, 'GigaHack.auto missing');
  } else {
    check('a data-directory move re-reads the automation triggers from the folder now in use',
      auto.before && auto.before[0] === 'beside the game' &&
      auto.after && auto.after.length === 1 && auto.after[0] === 'in the shared folder' && !auto.error,
      JSON.stringify(auto));
    check('and the next trigger write keeps the new folder\'s triggers rather than the old folder\'s',
      auto.written && auto.written.indexOf('in the shared folder') > -1 &&
      auto.written.indexOf('added after the move') > -1 && auto.written.indexOf('beside the game') === -1 &&
      auto.localUntouched && auto.localUntouched[0] === 'beside the game', JSON.stringify(auto));
  }

  /* =======================================================================
     THE SELF-TEST LEAVES THE ACTOR AND THE BAG AS IT FOUND THEM

     refresh() after addState / addParam is not neutral in a real game: a
     max-HP state clamps HP, an equip seal trades gear into the bag. The
     actor's refresh is made to do both for the duration, which is what a
     database with such a state does to the stock engine.
     ==================================================================== */
  const selfTest = await ev(() => {
    const G = window.GigaHack;
    const a = $gameActors && $gameActors.actor(1);
    if (!a || !$gameParty) return { absent: true };
    const realStates = $dataStates;
    const lastRun = G.compat.lastRun;
    const had = Object.prototype.hasOwnProperty.call(a, 'refresh');
    const realRefresh = a.refresh;
    const snap = () => JSON.stringify({ hp: a._hp, mp: a._mp, states: a._states, plus: a._paramPlus,
      items: $gameParty._items, weapons: $gameParty._weapons, armors: $gameParty._armors });
    const out = {};
    try {
      /* No trait-less state, so the test has to take one that has traits. */
      $dataStates = realStates.map(s => s ? Object.assign({}, s, {
        traits: [{ code: 21, dataId: 0, value: 0.5 }]
      }) : s);
      out.before = snap();
      a.refresh = function () {
        realRefresh.apply(this, arguments);
        this._hp = Math.max(1, Math.floor(this._hp / 2));
        $gameParty._items = Object.assign({}, $gameParty._items, { 1: ($gameParty._items[1] || 0) + 1 });
      };
      out.results = G.compat.selfTest(['states', 'params']).map(r => r.id + ':' + r.state);
      out.after = snap();
    } catch (e) { out.error = e.message; } finally {
      if (had) a.refresh = realRefresh; else delete a.refresh;
      $dataStates = realStates;
      G.compat.lastRun = lastRun;
    }
    return out;
  });
  if (selfTest.absent) {
    check('an actor and a party exist for the self-test side-effect check', false, 'no actor 1 / $gameParty');
  } else {
    check('the states and params self-tests put the actor\'s HP, states, params and the party\'s bag back exactly',
      selfTest.before === selfTest.after && !selfTest.error,
      JSON.stringify({ results: selfTest.results, error: selfTest.error,
        before: (selfTest.before || '').slice(0, 160), after: (selfTest.after || '').slice(0, 160) }));
  }
};
