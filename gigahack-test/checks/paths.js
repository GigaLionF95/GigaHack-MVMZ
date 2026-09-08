/* =============================================================================
   GigaHack MV/MZ — path resolution, the storage answer, and $.net

   The claim these checks exist for is a NEGATIVE one: nothing outside the game
   folder is read, written, probed or created until the player has said yes.
   A negative claim about side effects cannot be checked by looking at the
   result, because the result of "we did not create it" and "we created it and
   something else removed it" are the same empty directory. So the checks run
   the production resolver against a filesystem that records every call it is
   given, and assert on the calls.

   The disk carries TWO game folders on one shared root, because the whole
   point of the design is that answering in one game does not answer for the
   other, and two separate disks would make that true by construction rather
   than by design.

   State discipline: every swap of $.paths / $.env is restored inside the check
   that made it, $.cfg is put back by reference after anything that reloads
   settings, and the last block asserts that all three are where the rest of
   the suite left them. The suite reads $.paths.mode after this file runs.
   ========================================================================== */
'use strict';

const path = require('path');

module.exports = async function (ctx) {
  const check = ctx.check, ev = ctx.ev, page = ctx.page;

  const SHARED = '/Users/p/Library/Application Support/GigaHack';
  const ONE_LOCAL = '/disk/GameOne/gigahack-userdata';
  const TWO_LOCAL = '/disk/GameTwo/gigahack-userdata';

  /* The model is not in any harness HTML on purpose: the default harness is an
     honest browser build and several checks in run.js assert that it is. It is
     injected here, for this file, and it installs one global and nothing else. */
  await page.addScriptTag({ path: path.resolve(__dirname, '..', 'stubs', 'x-node.js') });

  /* Answering the storage question can ADOPT a settings file, and an adopted
     file is put on screen: the accent, scale and opacity are custom properties
     on the host and read-only is a class on it, none of which travel back with
     `G.cfg = savedCfg`. This file changes no DOM of its own, so the look is
     taken once here and put back once at the end — and asserted there, because
     a leak from this file would land in whichever check file runs next and
     look like that file's bug. */
  const look = await ev(() => {
    const G = window.GigaHack;
    return {
      accent: G.cfg.ui.accent, scale: G.cfg.ui.scale,
      opacity: G.cfg.ui.opacity, readonly: !!G.cfg.behaviour.readonly
    };
  });

  const stub = await ev(() => ({
    present: typeof window.__nodeModel === 'function',
    envStillBrowser: window.GigaHack.env.nwjs === false && window.GigaHack.env.fs === null,
    pathsStillBrowser: window.GigaHack.paths.mode === 'localStorage'
  }));
  check('the in-memory Node model loads without installing itself into the mod',
    stub.present && stub.envStillBrowser && stub.pathsStillBrowser, JSON.stringify(stub));

  /* One disk, two games, one shared root. Rebuilt per scenario so that a check
     never inherits another check's directories. */
  await ev(() => {
    const G = window.GigaHack;
    window.__disk = null;
    window.__mkDisk = function (extra) {
      const files = {
        '/disk/GameOne/index.html': '<html></html>',
        '/disk/GameOne/js/plugins/GigaHack_Core.js': '// core',
        '/disk/GameTwo/index.html': '<html></html>',
        '/disk/GameTwo/js/plugins/GigaHack_Core.js': '// core'
      };
      Object.keys(extra || {}).forEach(function (k) { files[k] = extra[k]; });
      window.__disk = window.__nodeModel({
        platform: 'darwin', home: '/Users/p',
        mainModule: '/disk/GameOne/index.html',
        files: files
      });
      return window.__disk;
    };
    /* Which game is asking. The script URL is the anchor the resolver walks up
       from, and process.mainModule is the engine's own opinion of the root;
       both move together or the resolver rightly says they disagree. */
    window.__resolve = function (game, opts) {
      const m = window.__disk;
      m.proc.mainModule.filename = '/disk/' + game + '/index.html';
      const o = { selfUrl: 'file:///disk/' + game + '/js/plugins/GigaHack_Core.js' };
      Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; });
      return G.pathsFor(m, o);
    };
    window.__live = function (game, opts) {
      return G.usePaths(window.__resolve(game, opts), window.__disk);
    };
  });

  /* =======================================================================
     WITH NOTHING INJECTED, NOTHING CHANGES
     ==================================================================== */
  const production = await ev(() => {
    const G = window.GigaHack;
    const before = JSON.stringify(G.paths);
    const liveObject = G.paths;
    const again = G.pathsFor(G.env);
    return {
      /* Object identity, not equal contents: a resolver that quietly installed
         its answer would produce a new object with the same fields in it, and
         a content comparison would call that unchanged. */
      liveUnchanged: G.paths === liveObject && JSON.stringify(G.paths) === before,
      mode: again.mode,
      consent: again.consent,
      why: again.consentWhy,
      keptNote: (again.notes || []).some(n => /Node APIs unavailable/.test(n)),
      recomputeHidden: Object.keys(G.paths).indexOf('recompute') < 0 &&
        typeof G.paths.recompute === 'function'
    };
  });
  check('resolving the paths again with nothing injected returns the same answer and leaves $.paths alone',
    production.liveUnchanged && production.mode === 'localStorage' && production.keptNote,
    JSON.stringify(production));
  check('a build with no filesystem is not asked a question it could not act on',
    production.consent === 'moot' && /nothing outside the game folder to reach/.test(production.why),
    production.consent + ' — ' + production.why);
  check('the recompute seam is on $.paths without being part of it, so the boot report can still carry it whole',
    production.recomputeHidden === true, JSON.stringify(Object.keys(production)));

  const recompute = await ev(() => {
    const G = window.GigaHack;
    const was = G.paths;
    window.__mkDisk();
    const p = G.paths.recompute(window.__disk, {
      selfUrl: 'file:///disk/GameOne/js/plugins/GigaHack_Core.js'
    });
    const out = {
      installed: G.paths === p,
      dataDir: G.paths.dataDir,
      stillHasSeam: typeof G.paths.recompute === 'function'
    };
    G.usePaths(was);
    out.back = G.paths === was && G.paths.mode === 'localStorage';
    return out;
  });
  check('recompute re-resolves and installs the answer, and the seam is still there on what it installed',
    recompute.installed === true && recompute.dataDir === ONE_LOCAL &&
    recompute.stillHasSeam === true && recompute.back === true, JSON.stringify(recompute));

  /* =======================================================================
     A GRANTED GAME LANDS EXACTLY WHERE 2.1.0 PUT IT
     ==================================================================== */
  const granted = await ev(() => {
    window.__mkDisk();
    const p = window.__resolve('GameOne', { consent: 'granted' });
    return {
      dataDir: p.dataDir, mode: p.mode, layout: p.layout, key: p.gameKey,
      local: p.localDir, shared: p.sharedDir, common: p.sharedCommonDir, root: p.sharedRoot,
      backups: p.backupsDir, fallbackUsed: p.fallbackUsed, outside: p.outsideGameFolder
    };
  });
  check('a granted game on macOS resolves to Application Support/GigaHack/<key>, byte for byte where 2.1.0 put it',
    granted.dataDir === SHARED + '/gameone' && granted.mode === 'fs' && granted.layout === 'plain',
    JSON.stringify(granted));
  check('the backups directory moves with the data directory rather than being left behind',
    granted.backups === SHARED + '/gameone/backups', granted.backups);
  check('all three locations are named: beside the game, this game\'s shared folder, and the cross-game one',
    granted.local === ONE_LOCAL && granted.shared === SHARED + '/gameone' &&
    granted.common === SHARED + '/_shared', JSON.stringify(granted));
  check('"fallback" still means only that the preferred candidate was unwritable, and a separate field ' +
    'says we are outside the game folder',
    granted.fallbackUsed === false && granted.outside === true,
    'fallbackUsed=' + granted.fallbackUsed + ' outsideGameFolder=' + granted.outside);

  const win = await ev(() => {
    const m = window.__nodeModel({
      platform: 'win32', home: '/c/Users/p', mainModule: '/disk/GameOne/index.html',
      env: { LOCALAPPDATA: '/c/Users/p/AppData/Local' },
      files: { '/disk/GameOne/index.html': '<html></html>',
        '/disk/GameOne/js/plugins/GigaHack_Core.js': '// core' }
    });
    return window.GigaHack.pathsFor(m, {
      selfUrl: 'file:///disk/GameOne/js/plugins/GigaHack_Core.js', consent: 'granted'
    }).dataDir;
  });
  check('a granted game on Windows resolves under %LOCALAPPDATA%, read off the host process rather than guessed',
    win === '/c/Users/p/AppData/Local/GigaHack/gameone', win);

  /* =======================================================================
     UNASKED AND DECLINED TOUCH NOTHING OUTSIDE THE GAME FOLDER
     ==================================================================== */
  const unasked = await ev(() => {
    const m = window.__mkDisk();
    m.reset();
    const p = window.__resolve('GameOne');
    return {
      consent: p.consent, from: p.consentFrom, why: p.consentWhy,
      dataDir: p.dataDir, mode: p.mode, sharedNamed: !!p.sharedDir,
      touched: m.touched('/Users/p/Library/Application Support/GigaHack').map(e => e.op + ' ' + e.path),
      onDisk: m.list('/Users/p/Library/Application Support/GigaHack'),
      localMade: m.has('/disk/GameOne/gigahack-userdata')
    };
  });
  check('with no answer on record the question is unasked, and settings go beside the game',
    unasked.consent === 'unasked' && unasked.from === null &&
    unasked.dataDir === ONE_LOCAL && unasked.mode === 'fs', JSON.stringify(unasked).slice(0, 200));
  check('nothing under the shared root is read, written, probed or created while the answer is unasked',
    unasked.touched.length === 0 && unasked.onDisk.length === 0,
    JSON.stringify(unasked.touched.concat(unasked.onDisk)).slice(0, 300));
  check('the shared locations are still computed while unasked, because a card that cannot name the path ' +
    'is not asking anything',
    unasked.sharedNamed === true && /nothing outside the game folder is read, written or created/.test(unasked.why),
    unasked.why);
  check('the game folder IS created while unasked, because the mod is already installed there',
    unasked.localMade === true, String(unasked.localMade));

  const declined = await ev(() => {
    const G = window.GigaHack;
    const m = window.__mkDisk();
    const restore = window.__live('GameOne');
    const r = G.setConsent('declined');
    m.reset();
    const again = window.__resolve('GameOne');
    const out = {
      answered: r.answer, where: r.where, dataDir: G.paths.dataDir,
      record: m.peek('/disk/GameOne/gigahack-userdata/consent.json'),
      touchedShared: m.touched('/Users/p/Library/Application Support/GigaHack').length,
      sharedOnDisk: m.list('/Users/p/Library/Application Support/GigaHack').length,
      reread: again.consent, rereadFrom: again.consentFrom, rereadDir: again.dataDir
    };
    restore();
    return out;
  });
  check('declining is recorded beside the game and keeps everything there',
    declined.answered === 'declined' && declined.where === ONE_LOCAL + '/consent.json' &&
    declined.dataDir === ONE_LOCAL, JSON.stringify(declined).slice(0, 200));
  check('nothing under the shared root is touched while the answer is declined',
    declined.touchedShared === 0 && declined.sharedOnDisk === 0,
    declined.touchedShared + ' calls, ' + declined.sharedOnDisk + ' entries');
  check('a declined answer survives a relaunch and is read back from beside the game, not from the shared folder',
    declined.reread === 'declined' && declined.rereadFrom === 'file' && declined.rereadDir === ONE_LOCAL,
    JSON.stringify({ a: declined.reread, from: declined.rereadFrom }));

  /* =======================================================================
     THE PER-GAME GUARANTEE — two games, one shared root
     ==================================================================== */
  const twoGames = await ev(() => {
    const G = window.GigaHack;
    const m = window.__mkDisk();
    const ROOT = '/Users/p/Library/Application Support/GigaHack';

    let restore = window.__live('GameOne');
    const oneBefore = G.paths.consent;
    const grant = G.setConsent('granted');
    const oneDir = G.paths.dataDir;
    restore();

    /* Game two, on the same disk, the very next thing that happens. */
    m.reset();
    const two = window.__resolve('GameTwo');

    let record = null;
    try { record = JSON.parse(m.peek('/disk/GameOne/gigahack-userdata/consent.json')); } catch (e) { record = null; }

    return {
      oneBefore: oneBefore, oneAfter: grant.answer, oneDir: oneDir,
      oneRecord: record,
      twoConsent: two.consent, twoDir: two.dataDir, twoShared: two.sharedDir,
      twoTouchedShared: m.touched(ROOT).map(e => e.op + ' ' + e.path),
      twoTouchedItsShared: m.touched(ROOT + '/gametwo').length,
      sharedOnDisk: m.list(ROOT),
      answerInSharedFolder: m.list(ROOT).filter(f => /consent\.json$/.test(f))
    };
  });
  check('granting in one game moves that game to the shared folder',
    twoGames.oneBefore === 'unasked' && twoGames.oneAfter === 'granted' &&
    twoGames.oneDir === SHARED + '/gameone', JSON.stringify(twoGames).slice(0, 200));
  check('granting in one game leaves a second game on the same machine unasked',
    twoGames.twoConsent === 'unasked' && twoGames.twoDir === TWO_LOCAL,
    twoGames.twoConsent + ' → ' + twoGames.twoDir);
  check('and nothing under the shared root is created, probed or even read for that second game',
    twoGames.twoTouchedShared.length === 0 && twoGames.twoTouchedItsShared === 0,
    JSON.stringify(twoGames.twoTouchedShared).slice(0, 300));
  check('the shared root holds a folder for the game that answered and for no other',
    twoGames.sharedOnDisk.indexOf(SHARED + '/gameone') > -1 &&
    twoGames.sharedOnDisk.indexOf(SHARED + '/gametwo') < 0,
    JSON.stringify(twoGames.sharedOnDisk));
  check('the answer is written beside the game and never into the shared folder, so it cannot reach another game',
    twoGames.answerInSharedFolder.length === 0 && !!twoGames.oneRecord &&
    twoGames.oneRecord.answer === 'granted' && twoGames.oneRecord.gameKey === 'gameone' &&
    twoGames.oneRecord.gameRoot === '/disk/GameOne' && twoGames.oneRecord.asked === 1,
    JSON.stringify(twoGames.oneRecord));

  const relaunch = await ev(() => {
    const G = window.GigaHack;
    const m = window.__disk;   /* the same disk the grant above wrote to */
    m.reset();
    const p = window.__resolve('GameOne');
    return {
      consent: p.consent, from: p.consentFrom, asked: p.consentAsked, dataDir: p.dataDir,
      readTheAnswerFrom: m.log().filter(e => /consent\.json$/.test(e.path)).map(e => e.op + ' ' + e.path)
    };
  });
  check('the answer survives a relaunch, and the file it is read from is the one beside the game',
    relaunch.consent === 'granted' && relaunch.from === 'file' && relaunch.asked === 1 &&
    relaunch.dataDir === SHARED + '/gameone' &&
    relaunch.readTheAnswerFrom.every(l => l.indexOf(ONE_LOCAL) > -1),
    JSON.stringify(relaunch));

  /* COPYING THE GAME, which is not the same as copying the mod.
     The per-game guarantee holds structurally for the mod — a file beside one
     game cannot reach another — and did not hold for the ordinary act of
     duplicating an install to keep a vanilla copy beside a modded one, because
     the answer file is inside the folder being copied. $.setConsent has always
     stamped gameKey and gameRoot into the record; nothing read them, so the
     copy resolved 'granted' from the original's yes and created a shared folder
     under a key the record itself says is not its own. */
  const copiedGame = await ev(() => {
    const G = window.GigaHack;
    const m = window.__mkDisk();
    const restore = window.__live('GameOne');
    G.setConsent('granted');
    const record = m.peek('/disk/GameOne/gigahack-userdata/consent.json');
    restore();

    /* The player copies the whole game folder. consent.json comes with it. */
    m.add('/disk/GameTwo/gigahack-userdata/consent.json', record);
    m.reset();
    const p = window.__resolve('GameTwo');
    return {
      record: JSON.parse(record || '{}'),
      consent: p.consent, from: p.consentFrom, dataDir: p.dataDir,
      touchedShared: m.touched('/Users/p/Library/Application Support/GigaHack')
        .map(e => e.op + ' ' + e.path),
      madeForTwo: m.list('/Users/p/Library/Application Support/GigaHack/gametwo').length,
      note: (p.notes || []).filter(n => /not this game's answer/.test(n))[0] || ''
    };
  });
  check('a duplicated game folder does not inherit the original\'s answer: the record names the game it was given ' +
    'for, and a record that names another game is not this game\'s answer',
    copiedGame.record.gameRoot === '/disk/GameOne' && copiedGame.record.gameKey === 'gameone' &&
    copiedGame.consent === 'unasked' && copiedGame.from === null && copiedGame.dataDir === TWO_LOCAL,
    JSON.stringify({ consent: copiedGame.consent, from: copiedGame.from, dataDir: copiedGame.dataDir }));
  check('and nothing is created, probed or read under the shared root for the copy, with a note naming both roots',
    copiedGame.touchedShared.length === 0 && copiedGame.madeForTwo === 0 &&
    copiedGame.note.indexOf('/disk/GameOne') > -1 && copiedGame.note.indexOf('/disk/GameTwo') > -1,
    copiedGame.note.slice(0, 160) || copiedGame.touchedShared.join(', '));

  /* =======================================================================
     THE TWO IDENTITIES, AND THE ONE COLLISION WORTH NAMING
     ==================================================================== */
  const identity = await ev(() => {
    const G = window.GigaHack;
    const m = window.__nodeModel({
      platform: 'linux', home: '/home/p', mainModule: '/disk/v1/Game/index.html',
      files: {
        '/disk/v1/Game/index.html': '<html></html>',
        '/disk/v1/Game/js/plugins/GigaHack_Core.js': '//',
        '/disk/v2/Game/index.html': '<html></html>',
        '/disk/v2/Game/js/plugins/GigaHack_Core.js': '//',
        '/disk/_shared/index.html': '<html></html>',
        '/disk/_shared/js/plugins/GigaHack_Core.js': '//'
      }
    });
    function at(dir) {
      m.proc.mainModule.filename = dir + '/index.html';
      return G.pathsFor(m, { selfUrl: 'file://' + dir + '/js/plugins/GigaHack_Core.js', probe: false });
    }
    const a = at('/disk/v1/Game'), b = at('/disk/v2/Game'), c = at('/disk/_shared');
    return {
      aKey: a.gameKey, bKey: b.gameKey, aId: a.gameId, bId: b.gameId,
      cKey: c.gameKey, cShared: c.sharedDir, cCommon: c.sharedCommonDir,
      cNote: (c.notes || []).join(' | '),
      linuxRoot: a.sharedRoot,
      inspectionNote: (a.notes || []).some(n => /without probing anything/.test(n)),
      inspectionMade: m.list('/home/p').length
    };
  });
  check('two copies of one game in identically-named folders share a storage key and are told apart by gameId',
    identity.aKey === identity.bKey && identity.aId !== identity.bId &&
    /^game-[0-9a-f]{8}$/.test(identity.aId), JSON.stringify(identity).slice(0, 200));
  check('a game whose folder is named "_shared" is given a different key so it cannot merge with the cross-game area',
    identity.cKey === '_shared-game' && identity.cShared !== identity.cCommon &&
    /cross-game area uses/.test(identity.cNote), identity.cKey + ' vs ' + identity.cCommon);
  check('the shared root on a system that is neither macOS nor Windows is ~/.local/share',
    identity.linuxRoot === '/home/p/.local/share/GigaHack', identity.linuxRoot);
  check('a resolution asked not to probe creates nothing at all and says that is what it did',
    identity.inspectionNote === true && identity.inspectionMade === 0,
    identity.inspectionNote + ' / ' + identity.inspectionMade + ' entries under the home directory');

  /* =======================================================================
     WHEN NEITHER PLACE WILL TAKE IT, BOTH HALVES OF THE REASON ARE SAID
     ==================================================================== */
  const degraded = await ev(() => {
    const m = window.__nodeModel({
      platform: 'darwin', home: '/Users/p', mainModule: '/disk/GameOne/index.html',
      files: { '/disk/GameOne/index.html': '<html></html>',
        '/disk/GameOne/js/plugins/GigaHack_Core.js': '//' },
      readonly: ['/disk/GameOne']
    });
    const p = window.GigaHack.pathsFor(m, { selfUrl: 'file:///disk/GameOne/js/plugins/GigaHack_Core.js' });
    return {
      mode: p.mode, consent: p.consent, notes: (p.notes || []).join(' | '),
      touchedShared: m.touched('/Users/p/Library/Application Support/GigaHack').length
    };
  });
  check('a read-only game folder with the question unanswered degrades, and the note names BOTH causes and the ' +
    'panel that fixes one of them',
    degraded.mode === 'localStorage' && /not writable/.test(degraded.notes) &&
    /has not been given \(unasked\)/.test(degraded.notes) && /Settings → Storage/.test(degraded.notes),
    degraded.notes.slice(0, 240));
  check('and it still does not reach for the shared folder to rescue itself',
    degraded.touchedShared === 0, String(degraded.touchedShared));

  /* =======================================================================
     MIGRATION — copies, keeps, never deletes
     ==================================================================== */
  const moved = await ev(() => {
    const G = window.GigaHack;
    const m = window.__mkDisk({
      '/disk/GameOne/gigahack-userdata/settings.json': '{"_schema":5,"ui":{"accent":"#111111"}}',
      '/disk/GameOne/gigahack-userdata/snippets.json': '{"snippets":[]}',
      '/disk/GameOne/gigahack-userdata/consent.json': JSON.stringify({ answer: 'granted', asked: 1 }),
      '/disk/GameOne/gigahack-userdata/backups/2024_slot1/gigahack-backup.json': '{"slot":1}',
      '/disk/GameOne/gigahack-userdata/backups/2024_slot1/file1.rmmzsave': 'bytes',
      '/Users/p/Library/Application Support/GigaHack/gameone/settings.json': '{"_schema":5,"ui":{"accent":"#999999"}}'
    });
    const restore = window.__live('GameOne');
    const r = G.store.moveTo('shared');
    const after = {
      ok: r.ok, to: r.to, from: r.from,
      copied: r.copied.map(c => c.name).sort(),
      kept: r.kept.map(k => k.name).sort(),
      keptWhy: r.kept.reduce((o, k) => { o[k.name] = k.why; return o; }, {}),
      failed: r.failed.length,
      /* the destination's own settings.json is untouched */
      destSettings: m.peek('/Users/p/Library/Application Support/GigaHack/gameone/settings.json'),
      /* and every source file is still exactly where it was */
      sourceKept: ['settings.json', 'snippets.json', 'consent.json'].every(n =>
        m.has('/disk/GameOne/gigahack-userdata/' + n)),
      sourceBackup: m.has('/disk/GameOne/gigahack-userdata/backups/2024_slot1/file1.rmmzsave'),
      destBackup: m.peek('/Users/p/Library/Application Support/GigaHack/gameone/backups/2024_slot1/file1.rmmzsave'),
      answerNotCarried: !m.has('/Users/p/Library/Application Support/GigaHack/gameone/consent.json')
    };
    const dropped = G.store.dropSource(r);
    after.dropped = dropped.removed.slice().sort();
    after.answerStillLocal = m.has('/disk/GameOne/gigahack-userdata/consent.json');
    after.destStillThere = m.has('/Users/p/Library/Application Support/GigaHack/gameone/snippets.json');
    restore();
    return after;
  });
  check('a move copies what the destination does not have and keeps what it does, per file',
    moved.ok === true && moved.copied.indexOf('snippets.json') > -1 &&
    moved.copied.indexOf('backups') > -1 && moved.kept.indexOf('settings.json') > -1 &&
    moved.failed === 0, JSON.stringify({ copied: moved.copied, kept: moved.kept }));
  check('a file the destination already has is kept, unmerged, and the skip is stated rather than silent',
    moved.destSettings === '{"_schema":5,"ui":{"accent":"#999999"}}' &&
    /already has one and it is kept/.test(moved.keptWhy['settings.json'] || ''),
    (moved.keptWhy['settings.json'] || '').slice(0, 90));
  check('a directory is copied through, not skipped for being a directory',
    moved.destBackup === 'bytes', String(moved.destBackup));
  check('the storage answer is not carried into the shared folder, and the reason names the guarantee it would break',
    moved.answerNotCarried === true && /could reach another game/.test(moved.keptWhy['consent.json'] || ''),
    (moved.keptWhy['consent.json'] || '').slice(0, 90));
  check('a move deletes nothing from the source',
    moved.sourceKept === true && moved.sourceBackup === true,
    'files=' + moved.sourceKept + ' backup=' + moved.sourceBackup);
  check('removing the old copy is a separate act, takes only the files that were verifiably copied, and leaves ' +
    'the answer beside the game',
    moved.dropped.indexOf('/disk/GameOne/gigahack-userdata/snippets.json') > -1 &&
    moved.dropped.indexOf('/disk/GameOne/gigahack-userdata/settings.json') < 0 &&
    moved.answerStillLocal === true && moved.destStillThere === true,
    JSON.stringify(moved.dropped));

  const movedBack = await ev(() => {
    const G = window.GigaHack;
    const m = window.__mkDisk({
      '/disk/GameOne/gigahack-userdata/consent.json': JSON.stringify({ answer: 'granted', asked: 1 }),
      '/Users/p/Library/Application Support/GigaHack/gameone/snippets.json': '{"snippets":["x"]}'
    });
    const restore = window.__live('GameOne');
    const r = G.store.moveTo('local');
    const out = {
      ok: r.ok, from: r.from, to: r.to,
      copied: r.copied.map(c => c.name),
      arrived: m.peek('/disk/GameOne/gigahack-userdata/snippets.json'),
      sourceKept: m.has('/Users/p/Library/Application Support/GigaHack/gameone/snippets.json')
    };
    restore();
    return out;
  });
  check('the move runs in both directions, and coming back is the same copy-and-keep it was going out',
    movedBack.ok === true && movedBack.from === SHARED + '/gameone' && movedBack.to === ONE_LOCAL &&
    movedBack.copied.indexOf('snippets.json') > -1 && movedBack.arrived === '{"snippets":["x"]}' &&
    movedBack.sourceKept === true, JSON.stringify(movedBack));

  const refused = await ev(() => {
    const G = window.GigaHack;
    window.__mkDisk();
    const restore = window.__live('GameOne');   /* unasked */
    const r = G.store.moveTo('shared');
    const out = { ok: r.ok, why: r.why, copied: r.copied.length, consent: G.paths.consent };
    restore();
    return out;
  });
  check('a move into the shared folder is refused while the question is unanswered, and the refusal names the panel',
    refused.ok === false && refused.copied === 0 && /Settings → Storage/.test(refused.why),
    refused.why);

  /* THE OTHER DIRECTION, which is the one that reads.
     The gate used to sit inside the `target === 'shared'` branch, so
     moveTo('local') set out.from = sharedDir unconditionally and the whole file
     list was existsSync-ed, statSync-ed and copyFileSync-read out of a folder
     nobody had agreed to — with store.dropSource, which unlinks there, offered
     underneath it. The assertion is on the recorded CALLS and not on the
     resulting directory: "we did not read it" and "we read it and copied
     nothing" leave the same disk behind. */
  const refusedBack = await ev(() => {
    const G = window.GigaHack;
    const SHARED_ROOT = '/Users/p/Library/Application Support/GigaHack';
    const m = window.__mkDisk({
      /* What 2.1.0 left, or what another install with the same folder name did. */
      [SHARED_ROOT + '/gameone/settings.json']: '{"_schema":5,"ui":{"accent":"#aa0000"}}',
      [SHARED_ROOT + '/gameone/snippets.json']: '["another install left this"]'
    });
    const restore = window.__live('GameOne');   /* unasked */
    m.reset();
    const r = G.store.moveTo('local');
    const out = {
      ok: r.ok, why: r.why, copied: r.copied.length, consent: G.paths.consent,
      touchedShared: m.touched(SHARED_ROOT).map(e => e.op + ' ' + e.path),
      arrived: m.has('/disk/GameOne/gigahack-userdata/snippets.json')
    };
    /* And the half that deletes refuses too, handed a result that names files
       inside the shared folder — a result object outlives the answer that
       produced it. */
    m.add('/disk/GameOne/gigahack-userdata/snippets.json', '["copied while it was allowed"]');
    m.reset();
    const drop = G.store.dropSource({
      from: SHARED_ROOT + '/gameone',
      pairs: [{ from: SHARED_ROOT + '/gameone/snippets.json',
        to: '/disk/GameOne/gigahack-userdata/snippets.json' }]
    });
    out.dropped = drop.removed.length;
    out.dropWhy = drop.why;
    out.dropTouched = m.touched(SHARED_ROOT).length;
    out.sourceStillThere = m.has(SHARED_ROOT + '/gameone/snippets.json');
    restore();
    return out;
  });
  check('a move OUT of the shared folder is refused by the same answer, because reading that folder is the act the ' +
    'question is about — and nothing under the shared root is touched to find that out',
    refusedBack.ok === false && refusedBack.copied === 0 && refusedBack.arrived === false &&
    refusedBack.touchedShared.length === 0 && refusedBack.consent === 'unasked' &&
    /Settings → Storage/.test(refusedBack.why),
    refusedBack.touchedShared.join(', ') || refusedBack.why.slice(0, 120));
  check('and "remove the old copy" refuses to unlink inside the shared folder while the answer is not yes',
    refusedBack.dropped === 0 && refusedBack.sourceStillThere === true &&
    refusedBack.dropTouched === 0 && /answer for this game/.test(refusedBack.dropWhy),
    refusedBack.dropWhy.slice(0, 120));

  /* A DESTINATION DIRECTORY THAT HOLDS SOME OF THE SOURCE'S FILES.
     The top-level existsSync short-circuit treated `backups` the same way it
     treats a file, so copyTree — which owns the per-child keep/copy merge —
     was never entered once the destination had a directory of that name. The
     whole tree read as "kept", the source-only files were never copied and
     appeared in no row, and every later attempt said the same thing: a
     half-finished migration that was permanently un-completable and read as
     done, for save backups. */
  const partialDir = await ev(() => {
    const G = window.GigaHack;
    const SHARED_ROOT = '/Users/p/Library/Application Support/GigaHack';
    const m = window.__mkDisk({
      '/disk/GameOne/gigahack-userdata/consent.json': JSON.stringify({ answer: 'granted', asked: 1 }),
      '/disk/GameOne/gigahack-userdata/backups/slotA/a.rmmzsave': 'AAA',
      '/disk/GameOne/gigahack-userdata/backups/slotA/b.rmmzsave': 'BBB',
      /* The destination has been here before and has one of the two. */
      [SHARED_ROOT + '/gameone/backups/slotA/a.rmmzsave']: 'DEST-A'
    });
    const restore = window.__live('GameOne');
    const r = G.store.moveTo('shared');
    const out = {
      ok: r.ok, complete: r.complete,
      copied: r.copied.map(c => c.name),
      keptNames: r.kept.map(k => k.name),
      destA: m.peek(SHARED_ROOT + '/gameone/backups/slotA/a.rmmzsave'),
      destB: m.peek(SHARED_ROOT + '/gameone/backups/slotA/b.rmmzsave'),
      sourceB: m.peek('/disk/GameOne/gigahack-userdata/backups/slotA/b.rmmzsave')
    };
    restore();
    return out;
  });
  check('a destination directory that already holds SOME of the source\'s files does not hide the rest — the walk ' +
    'goes on per child, and the one that was there is not merged over',
    partialDir.ok === true && partialDir.destB === 'BBB' && partialDir.destA === 'DEST-A' &&
    partialDir.sourceB === 'BBB', JSON.stringify({
      arrived: partialDir.destB, kept: partialDir.destA, source: partialDir.sourceB
    }));
  check('and every nested skip is a report row named by its path inside the directory, rather than collected and ' +
    'thrown away',
    partialDir.keptNames.indexOf('backups/slotA/a.rmmzsave') > -1,
    partialDir.keptNames.join(', ') || 'no kept rows at all');

  /* The walk is bounded and says so; the REPORT has to be bounded too. Running
     a migration a second time over a full backups folder means every file is
     already at the destination, and a table with four thousand rows in it is
     not something anybody reads. The count in the summarising row is exact —
     a rounded "many more" would be the same kind of unanswerable as no row. */
  const keptCap = await ev(() => {
    const G = window.GigaHack;
    const SHARED_ROOT = '/Users/p/Library/Application Support/GigaHack';
    const files = {
      '/disk/GameOne/gigahack-userdata/consent.json': JSON.stringify({ answer: 'granted', asked: 1 })
    };
    /* 45 already at the destination, and one that is not. */
    for (let i = 0; i < 45; i++) {
      files['/disk/GameOne/gigahack-userdata/backups/slotA/f' + i + '.rmmzsave'] = 'body';
      files[SHARED_ROOT + '/gameone/backups/slotA/f' + i + '.rmmzsave'] = 'body';
    }
    files['/disk/GameOne/gigahack-userdata/backups/slotA/new.rmmzsave'] = 'NEW';
    const m = window.__mkDisk(files);
    const restore = window.__live('GameOne');
    const r = G.store.moveTo('shared');
    const nested = r.kept.filter(k => k.at.indexOf(SHARED_ROOT + '/gameone/backups') === 0);
    const out = {
      named: nested.filter(k => /\.rmmzsave$/.test(k.name)).length,
      summary: (nested.filter(k => /more file\(s\)/.test(k.why))[0] || {}).why || '',
      arrived: m.peek(SHARED_ROOT + '/gameone/backups/slotA/new.rmmzsave')
    };
    restore();
    return out;
  });
  check('a report over a directory the destination already has in full is bounded, says exactly how many rows it ' +
    'stands for, and still copies the one file that was missing',
    keptCap.named === 40 && /^5 more file\(s\)/.test(keptCap.summary) &&
    /nothing was deleted/.test(keptCap.summary) && keptCap.arrived === 'NEW',
    keptCap.named + ' named — ' + keptCap.summary.slice(0, 90));

  /* =======================================================================
     SETTINGS SHARED BETWEEN GAMES
     ==================================================================== */
  const shared = await ev(() => {
    const G = window.GigaHack;
    const S = G.store;
    /* Granted, so this game's own settings file is the one in ITS folder under
       the shared root; the cross-game file is the one beside it in _shared. */
    const m = window.__mkDisk({
      '/Users/p/Library/Application Support/GigaHack/gameone/settings.json':
        JSON.stringify({ _schema: 5, ui: { accent: '#111111', scale: 1 } }),
      '/disk/GameOne/gigahack-userdata/consent.json': JSON.stringify({ answer: 'granted', asked: 1 }),
      '/Users/p/Library/Application Support/GigaHack/_shared/settings.json': JSON.stringify({
        _schema: 1,
        sections: { ui: { accent: '#abcdef' } },
        writers: { ui: { game: 'the other game', gameKey: 'gametwo', at: '2024-01-01T00:00:00.000Z' } }
      })
    });
    const savedCfg = G.cfg;
    const restore = window.__live('GameOne');

    S.loadSettings();
    const applied = G.cfg.ui.accent;
    const writer = (S.sharedSections().filter(s => s.section === 'ui')[0] || {}).wroteIt;
    const available = S.sharedAvailable();

    /* An edit made while a section is shared belongs to the shared set, and
       this game's own file must not move under it. */
    S.cfgSet('ui.accent', '#222222');
    S.flush();
    const perGameWhileShared = m.peek('/Users/p/Library/Application Support/GigaHack/gameone/settings.json');
    const commonAfterEdit = m.peek('/Users/p/Library/Application Support/GigaHack/_shared/settings.json');

    /* A save that changes nothing must not rewrite the shared file, or the
       "who last wrote this" row answers "whichever game you opened last". */
    const countWrites = () => m.log().filter(e => e.op === 'writeFileSync' &&
      e.path === '/Users/p/Library/Application Support/GigaHack/_shared/settings.json').length;
    const writesBefore = countWrites();
    S.saveSettings();
    S.flush();
    const writesAfter = countWrites();

    /* Turning it off gives this game back what its own file has been holding. */
    const off = S.setShared('ui', false);
    const afterOff = G.cfg.ui.accent;
    const commonAfterOff = m.peek('/Users/p/Library/Application Support/GigaHack/_shared/settings.json');

    /* And it is still what the game had at the NEXT launch, which is the half
       that only the per-game file can answer for. */
    S.flush();
    S.loadSettings();
    const afterReload = G.cfg.ui.accent;

    S.flush();
    restore();
    G.cfg = savedCfg;
    return {
      available: available, applied: applied, writer: writer, afterOff: afterOff,
      afterReload: afterReload, offWhy: off.why,
      perGameKeptItsOwn: /"accent": ?"#111111"/.test(perGameWhileShared || ''),
      sharedTookTheEdit: /"accent": ?"#222222"/.test(commonAfterEdit || ''),
      writesBefore: writesBefore, writesAfter: writesAfter,
      sharedNamesThisGame: /"gameKey": ?"gameone"/.test(commonAfterEdit || ''),
      commonUntouchedByTurningOff: /"accent": ?"#222222"/.test(commonAfterOff || '')
    };
  });
  check('a shared section is applied over the per-game one once the answer is granted',
    shared.available === true && shared.applied === '#abcdef', shared.applied);
  check('the panel can say which game last wrote a shared section, because "I did not change that" needs an answer',
    !!shared.writer && shared.writer.game === 'the other game', JSON.stringify(shared.writer));
  check('an edit made while a section is shared goes to the shared file, stamped with the game that made it',
    shared.sharedTookTheEdit === true && shared.sharedNamesThisGame === true,
    'edit=' + shared.sharedTookTheEdit + ' stamped=' + shared.sharedNamesThisGame);
  check('a save that changes nothing does not rewrite the shared file, so the stamp names the game that ' +
    'changed the section rather than the one opened last',
    shared.writesBefore >= 1 && shared.writesAfter === shared.writesBefore,
    shared.writesBefore + ' → ' + shared.writesAfter);
  check('and the per-game file keeps this game\'s own value for that section the whole time it is shared',
    shared.perGameKeptItsOwn === true, String(shared.perGameKeptItsOwn));
  check('turning sharing off restores exactly what the game had, at this launch and at the next one, and ' +
    'leaves the shared copy alone',
    shared.afterOff === '#111111' && shared.afterReload === '#111111' &&
    shared.commonUntouchedByTurningOff === true,
    shared.afterOff + ' / ' + shared.afterReload + ' — ' + shared.offWhy.slice(0, 70));

  /* AN EDIT MADE WHILE A SECTION WAS UNSHARED, AND THEN SHARING TURNED ON.
     ownSections was captured once per loadSettings and nowhere else, so it
     held the LOAD-TIME value while every edit went to $.cfg and to the
     per-game file. Turning sharing on made the next perGameSnapshot write that
     stale value back over the per-game file, and turning sharing off restored
     it — the edit gone from memory and from disk, under a panel saying "this
     game's own is still in its settings file and comes back if you turn this
     off". Both of the panel's sentences were false at that point. */
  const editThenShare = await ev(() => {
    const G = window.GigaHack;
    const S = G.store;
    const SHARED_ROOT = '/Users/p/Library/Application Support/GigaHack';
    const m = window.__mkDisk({
      [SHARED_ROOT + '/gameone/settings.json']: JSON.stringify({
        _schema: 5, storage: { share: { ui: false } }, ui: { accent: '#111111' }
      }),
      '/disk/GameOne/gigahack-userdata/consent.json': JSON.stringify({ answer: 'granted', asked: 1 }),
      [SHARED_ROOT + '/_shared/settings.json']: JSON.stringify({
        _schema: 1, sections: { ui: { accent: '#abcdef' } }, writers: {}
      })
    });
    const savedCfg = G.cfg;
    const restore = window.__live('GameOne');
    S.loadSettings();
    const atLoad = G.cfg.ui.accent;                 /* #111111 — sharing is off */

    S.cfgSet('ui.accent', '#222222');
    S.flush();
    const perGameAfterEdit = m.peek(SHARED_ROOT + '/gameone/settings.json');

    const on = S.setShared('ui', true);
    S.flush();
    const adopted = G.cfg.ui.accent;                /* #abcdef, from the shared set */
    const perGameWhileShared = m.peek(SHARED_ROOT + '/gameone/settings.json');

    const off = S.setShared('ui', false);
    S.flush();
    const afterOff = G.cfg.ui.accent;
    S.loadSettings();
    const afterReload = G.cfg.ui.accent;

    const out = {
      atLoad: atLoad, adopted: adopted, afterOff: afterOff, afterReload: afterReload,
      editLanded: /"accent": ?"#222222"/.test(perGameAfterEdit || ''),
      editSurvivedSharing: /"accent": ?"#222222"/.test(perGameWhileShared || ''),
      wroteTheLoadTimeValue: /"accent": ?"#111111"/.test(perGameWhileShared || ''),
      offWhy: off.why, onAdopted: on.adopted
    };
    S.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('an edit made while a section was NOT shared is what the per-game file keeps when sharing is turned on — ' +
    'the game\'s own value stops being live at that moment, not at the last load',
    editThenShare.atLoad === '#111111' && editThenShare.editLanded === true &&
    editThenShare.onAdopted === true && editThenShare.adopted === '#abcdef' &&
    editThenShare.editSurvivedSharing === true && editThenShare.wroteTheLoadTimeValue === false,
    JSON.stringify({ adopted: editThenShare.adopted, kept: editThenShare.editSurvivedSharing }));
  check('and turning sharing off gives that edit back, at this launch and at the next one, exactly as the panel ' +
    'says it will',
    editThenShare.afterOff === '#222222' && editThenShare.afterReload === '#222222',
    editThenShare.afterOff + ' / ' + editThenShare.afterReload + ' — ' +
    (editThenShare.offWhy || '').slice(0, 70));

  const hotkeys = await ev(() => {
    const G = window.GigaHack;
    const S = G.store;
    /* One key this game has claimed, and one it has not, both read from the
       game rather than chosen: a literal would be right on one game only. */
    const claimed = G.profile.claimedKeys();
    const takenCode = Object.keys(claimed)[0];
    let freeCode = null;
    'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').forEach(function (c) {
      if (!freeCode && !claimed['Key' + c]) freeCode = 'Key' + c;
    });
    const m = window.__mkDisk({
      '/Users/p/Library/Application Support/GigaHack/gameone/settings.json': JSON.stringify({
        _schema: 5, storage: { share: { hotkeys: true } }, hotkeys: { toggleMenu: 'KeyM' }
      }),
      '/disk/GameOne/gigahack-userdata/consent.json': JSON.stringify({ answer: 'granted', asked: 1 }),
      '/Users/p/Library/Application Support/GigaHack/_shared/settings.json': JSON.stringify({
        _schema: 1,
        sections: { hotkeys: { quickSave: takenCode, panicHide: freeCode } },
        writers: { hotkeys: { game: 'the other game', gameKey: 'gametwo' } }
      })
    });
    const savedCfg = G.cfg;
    const restore = window.__live('GameOne');
    S.loadSettings();
    const rep = S.applySharedHotkeys(true);
    const out = {
      takenCode: takenCode, freeCode: freeCode,
      applied: rep.applied.slice(), skipped: rep.skipped.slice(),
      reason: rep.reason, wroteIt: rep.wroteIt,
      liveFree: G.cfg.hotkeys.panicHide, liveTaken: G.cfg.hotkeys.quickSave
    };
    S.flush();
    restore();
    G.cfg = savedCfg;
    S.applySharedHotkeys(true);   /* settle again against the real environment */
    return out;
  });
  check('a hotkey shared from another game is applied where this game leaves the key free',
    hotkeys.applied.some(a => a.id === 'panicHide' && a.code === hotkeys.freeCode) &&
    hotkeys.liveFree === hotkeys.freeCode, JSON.stringify(hotkeys.applied));
  check('a hotkey shared from another game is NOT applied where this game claims the key, and the claimant is named',
    hotkeys.skipped.some(s => s.id === 'quickSave' && s.code === hotkeys.takenCode && s.claimedBy.length > 3) &&
    hotkeys.liveTaken !== hotkeys.takenCode, JSON.stringify(hotkeys.skipped));

  const shareDefaults = await ev(() => {
    const S = window.GigaHack.store;
    const d = S.defaults.storage.share;
    return {
      ui: d.ui, behaviour: d.behaviour, hotkeys: d.hotkeys,
      offWhy: S.sharedWhy(),
      available: S.sharedAvailable(),
      sections: S.sharedSections().map(s => s.section)
    };
  });
  check('appearance and behaviour are shared by default and hotkeys are not, because a free key here is a ' +
    'claimed key there',
    shareDefaults.ui === true && shareDefaults.behaviour === true && shareDefaults.hotkeys === false,
    JSON.stringify(shareDefaults));
  check('with no shared area the panel gets a sentence rather than a missing feature',
    shareDefaults.available === false && shareDefaults.offWhy.length > 30 &&
    /filesystem/.test(shareDefaults.offWhy), shareDefaults.offWhy.slice(0, 90));

  /* =======================================================================
     UPGRADING FROM A BUILD THAT NEVER ASKED (§2.5)
     ==================================================================== */
  const adopt = await ev(() => {
    const G = window.GigaHack;
    const S = G.store;
    const m = window.__mkDisk({
      /* What 2.1.0 left behind, written without anybody being asked. */
      '/Users/p/Library/Application Support/GigaHack/gameone/settings.json':
        JSON.stringify({ _schema: 5, ui: { accent: '#aa0000' } }),
      /* And what accumulated beside the game while the answer was unasked. */
      '/disk/GameOne/gigahack-userdata/settings.json':
        JSON.stringify({ _schema: 5, ui: { accent: '#00aa00' } })
    });
    const savedCfg = G.cfg;
    const restore = window.__live('GameOne');
    S.loadSettings();
    const beforeGrant = { accent: G.cfg.ui.accent, dataDir: G.paths.dataDir, consent: G.paths.consent };
    const lookedBeforeAnswering = m.touched('/Users/p/Library/Application Support/GigaHack').length;

    const r = S.grantStorage();
    const out = {
      lookedBeforeAnswering: lookedBeforeAnswering,
      beforeGrant: beforeGrant,
      adopted: r.adopted, why: r.why, accent: G.cfg.ui.accent, dataDir: G.paths.dataDir,
      localStillThere: m.peek('/disk/GameOne/gigahack-userdata/settings.json'),
      namesBoth: r.why.indexOf('/Users/p/Library/Application Support/GigaHack/gameone') > -1 &&
        r.why.indexOf('/disk/GameOne/gigahack-userdata') > -1
    };
    S.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('an upgrade does not look in the shared folder to find out whether there is something there, ' +
    'because that read is the thing being asked about',
    adopt.lookedBeforeAnswering === 0 && adopt.beforeGrant.consent === 'unasked' &&
    adopt.beforeGrant.accent === '#00aa00', JSON.stringify(adopt.beforeGrant));
  check('on grant, settings already in the shared folder are adopted rather than overwritten with what ' +
    'accumulated beside the game',
    adopt.adopted === true && adopt.accent === '#aa0000' && adopt.dataDir === SHARED + '/gameone',
    adopt.accent + ' at ' + adopt.dataDir);
  check('and the copy beside the game is left where it is, with both paths named in the reason',
    adopt.localStillThere === '{"_schema":5,"ui":{"accent":"#00aa00"}}' && adopt.namesBoth === true,
    adopt.why.slice(0, 140));

  const seed = await ev(() => {
    const G = window.GigaHack;
    const S = G.store;
    const m = window.__mkDisk({
      '/disk/GameOne/gigahack-userdata/settings.json':
        JSON.stringify({ _schema: 5, ui: { accent: '#00aa00' } })
    });
    const savedCfg = G.cfg;
    const restore = window.__live('GameOne');
    S.loadSettings();
    const r = S.grantStorage();
    const out = {
      adopted: r.adopted, why: r.why,
      seeded: m.peek('/Users/p/Library/Application Support/GigaHack/gameone/settings.json'),
      accent: G.cfg.ui.accent
    };
    S.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('on grant with nothing already in the shared folder, this game\'s settings are written into it and said so',
    seed.adopted === false && /had no settings of its own/.test(seed.why) &&
    /#00aa00/.test(seed.seeded || '') && seed.accent === '#00aa00',
    (seed.seeded || 'nothing written').slice(0, 80));

  /* CHANGING YOUR MIND, which moves the directory in the other direction.
     Granting adopts the shared settings into $.cfg. Declining used to be a
     bare $.setConsent('declined'): dataDir went back beside the game while
     $.cfg still held the SHARED folder's settings, and Boot's 'paths:changed'
     cascade deliberately does not re-read settings — "whoever moved the
     directory has already dealt with them", which only granting did. So the
     next act as ordinary as switching a tab wrote the shared folder's settings
     over the game's own file, with no log line, no toast and no note. */
  const declineAfterGrant = await ev(() => {
    const G = window.GigaHack;
    const S = G.store;
    const SHARED_ROOT = '/Users/p/Library/Application Support/GigaHack';
    const m = window.__mkDisk({
      '/disk/GameOne/gigahack-userdata/settings.json':
        JSON.stringify({ _schema: 5, ui: { accent: '#00aa00' } }),
      [SHARED_ROOT + '/gameone/settings.json']:
        JSON.stringify({ _schema: 5, ui: { accent: '#aa0000' } })
    });
    const savedCfg = G.cfg;
    const restore = window.__live('GameOne');
    S.loadSettings();
    const beside = G.cfg.ui.accent;                       /* #00aa00 */

    S.grantStorage();
    const granted = { accent: G.cfg.ui.accent, dataDir: G.paths.dataDir };
    const localBefore = m.peek('/disk/GameOne/gigahack-userdata/settings.json');

    const d = S.declineStorage();
    const declined = {
      accent: G.cfg.ui.accent, dataDir: G.paths.dataDir,
      adopted: d.adopted, moved: d.moved, why: d.why || ''
    };

    /* The next ordinary act. Switching a tab persists ui.tab. */
    S.cfgSet('ui.tab', 'debug');
    S.flush();

    const out = {
      beside: beside, granted: granted, declined: declined, localBefore: localBefore,
      localAfter: m.peek('/disk/GameOne/gigahack-userdata/settings.json'),
      sharedAfter: m.peek(SHARED_ROOT + '/gameone/settings.json')
    };
    S.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('declining after granting hands the game back its OWN settings file rather than leaving the shared ' +
    'folder\'s in $.cfg for the next write to put over it',
    declineAfterGrant.beside === '#00aa00' && declineAfterGrant.granted.accent === '#aa0000' &&
    declineAfterGrant.declined.accent === '#00aa00' && declineAfterGrant.declined.dataDir === ONE_LOCAL &&
    /"accent": ?"#00aa00"/.test(declineAfterGrant.localAfter || ''),
    'local ' + (declineAfterGrant.localBefore || '') + ' → ' + (declineAfterGrant.localAfter || ''));
  check('and the shared folder\'s own copy is left exactly as it was, with the answer saying which of the two ' +
    'files is now in use and naming both',
    /"accent": ?"#aa0000"/.test(declineAfterGrant.sharedAfter || '') &&
    declineAfterGrant.declined.moved === true && declineAfterGrant.declined.adopted === true &&
    declineAfterGrant.declined.why.indexOf(ONE_LOCAL) > -1 &&
    declineAfterGrant.declined.why.indexOf(SHARED + '/gameone') > -1,
    declineAfterGrant.declined.why.slice(0, 160));

  const defer = await ev(() => {
    const G = window.GigaHack;
    window.__mkDisk();
    const restore = window.__live('GameOne');
    const first = G.consentDeferred();
    const r = G.store.deferStorage();
    const out = {
      first: first, answer: r.answer, deferredNow: G.consentDeferred(),
      asked: (G.consentRecord() || {}).asked,
      dataDir: G.paths.dataDir
    };
    restore();
    return out;
  });
  check('"ask me again next launch" leaves the answer unasked, counts the asking, and hides the card for this ' +
    'launch only',
    defer.first === false && defer.answer === 'unasked' && defer.deferredNow === true &&
    defer.asked === 1 && defer.dataDir === ONE_LOCAL, JSON.stringify(defer));

  const relocated = await ev(() => {
    const G = window.GigaHack;
    window.__mkDisk();
    const restore = window.__live('GameOne');
    const before = { data: G.paths.dataDir, backups: G.paths.backupsDir };
    const r = G.relocateData('/disk/GameOne/elsewhere', 'a check asked it to');
    const after = {
      ok: r.ok, was: r.was, data: G.paths.dataDir, backups: G.paths.backupsDir,
      mode: G.paths.mode, outside: G.paths.outsideGameFolder,
      before: before,
      note: (G.paths.notes || []).some(n => /moved to \/disk\/GameOne\/elsewhere/.test(n))
    };
    restore();
    return after;
  });
  check('repointing the data directory moves the backups directory and the mode with it, or the one thing a ' +
    'player cannot regenerate keeps going to the abandoned folder',
    relocated.ok === true && relocated.data === '/disk/GameOne/elsewhere' &&
    relocated.backups === '/disk/GameOne/elsewhere/backups' && relocated.mode === 'fs' &&
    relocated.outside === false && relocated.note === true, JSON.stringify(relocated));

  /* =======================================================================
     THE FILE LIST
     ==================================================================== */
  const files = await ev(() => {
    const S = window.GigaHack.store;
    const list = S.files();
    const by = {};
    list.forEach(f => { by[f.name] = f; });
    S.declareFile('addon-demo.json', 'a module declaring its own file');
    return {
      names: list.map(f => f.name),
      consentIsLocal: !!(by['consent.json'] && by['consent.json'].local),
      modulesIsTransient: !!(by['modules.json'] && by['modules.json'].transient),
      backupsIsDir: !!(by.backups && by.backups.dir),
      shotsDerived: !!(by.shots && by.shots.from === 'media.capture.dir'),
      declared: S.files().some(f => f.name === 'addon-demo.json')
    };
  });
  check('the store enumerates what it owns in one place, marking the answer as local and the caches as rebuilt',
    files.consentIsLocal && files.modulesIsTransient && files.backupsIsDir && files.shotsDerived,
    JSON.stringify(files).slice(0, 200));
  check('a module can declare a file of its own rather than the list being edited for it',
    files.declared === true, String(files.declared));

  /* =======================================================================
     $.net — the transport chooser and its test hook
     ==================================================================== */
  const net = await ev(() => {
    const G = window.GigaHack;
    const real = G.net.transport();
    const seen = [];
    const restore = G.net._use(function (url, done) {
      seen.push(url);
      done(null, { status: 200, body: '// an addon', via: 'fake' });
    });
    let got = null;
    G.net.get('https://example.invalid/a.js', function (err, res) { got = { err: !!err, res: res }; });
    const namedWhileInjected = G.net.transport().id;
    restore();
    return {
      id: real.id, why: real.why, missing: real.missing.map(x => x.id),
      missingWhy: real.missing.map(x => x.why),
      asked: seen, got: got, namedWhileInjected: namedWhileInjected,
      backAgain: G.net.transport().id
    };
  });
  check('the transport is chosen by feature detection and named, and the absent ones are named with what they cost',
    (net.id === 'fetch' || net.id === 'xhr' || net.id === 'node-https') && net.why.length > 40 &&
    net.missing.indexOf('node-https') > -1 &&
    net.missingWhy.every(w => w.length > 40), net.id + ' — missing: ' + net.missing.join(','));
  check('a check can replace the transport, drive it, and put the real chooser back',
    net.asked.length === 1 && net.got && net.got.err === false && net.got.res.body === '// an addon' &&
    net.namedWhileInjected === 'injected' && net.backAgain === net.id,
    JSON.stringify({ injected: net.namedWhileInjected, back: net.backAgain }));

  const netTimeout = await ev(() => {
    const G = window.GigaHack;
    return new Promise(function (resolve) {
      const restore = G.net._use(function () { /* never answers */ });
      let calls = 0, first = null;
      G.net.get('https://example.invalid/slow.js', function (err) {
        calls++;
        if (!first) first = (err && err.message) || '';
      }, { timeoutMs: 20 });
      setTimeout(function () { restore(); resolve({ calls: calls, message: first }); }, 90);
    });
  });
  check('a transport that never answers becomes a timeout with the URL and the budget in it, called exactly once',
    netTimeout.calls === 1 && /within 20ms/.test(netTimeout.message) &&
    /example\.invalid/.test(netTimeout.message), JSON.stringify(netTimeout));

  /* =======================================================================
     LEAVE IT AS IT WAS FOUND
     ==================================================================== */
  const restored = await ev((was) => {
    const G = window.GigaHack;
    /* Put the overlay back before reading it: an adopted look is on the host,
       not in $.cfg, so restoring $.cfg by reference does not undo it. */
    G.ui.apply(was);
    const root = G.ui.getHost().root;
    return {
      mode: G.paths.mode, consent: G.paths.consent, dataDir: G.paths.dataDir,
      envFs: G.env.fs, envNwjs: G.env.nwjs,
      accent: G.cfg.ui.accent, cfgHasStorage: !!(G.cfg.storage && G.cfg.storage.share),
      sharedAvailable: G.store.sharedAvailable(),
      failedNone: !G.store.hasFailed('settings.json'),
      hostAccent: root.style.getPropertyValue('--mm-accent'),
      hostScale: root.style.getPropertyValue('--mm-scale'),
      hostReadOnly: root.classList.contains('mm-ro')
    };
  }, look);
  check('the path checks leave $.paths, $.env and $.cfg exactly as the rest of the suite expects them',
    restored.mode === 'localStorage' && restored.consent === 'moot' && restored.dataDir === null &&
    restored.envFs === null && restored.envNwjs === false && restored.sharedAvailable === false &&
    restored.cfgHasStorage === true && restored.failedNone === true,
    JSON.stringify(restored));
  check('and the overlay itself, which an adopted settings file writes to and $.cfg does not travel back with',
    restored.hostAccent === look.accent && restored.hostScale === String(look.scale) &&
    restored.hostReadOnly === look.readonly,
    JSON.stringify({ accent: restored.hostAccent, scale: restored.hostScale, ro: restored.hostReadOnly }));
};
