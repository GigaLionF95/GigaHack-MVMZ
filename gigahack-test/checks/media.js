/* =============================================================================
   GigaHack MV/MZ — checks for GigaHack_Media.

   Three areas, and the same rule in each: the check has to fail if the
   behaviour is reverted. Where a build genuinely lacks the thing, the check
   ASSERTS the absence against the engine rather than skipping.

   Every check leaves the game as it found it — the volumes, the audio that was
   playing, the settings, the image cache, the shot list and the virtual
   filesystem all go back.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page, shot = ctx.shot;
  var IS_MV = ctx.IS_MV, IS_MZ = ctx.IS_MZ, MODDED = ctx.MODDED;

  /* =======================================================================
     WIRING
     ==================================================================== */
  const wiring = await ev(() => {
    const G = window.GigaHack;
    const hookNames = ['playBgm', 'playBgs', 'playMe', 'playSe', 'checkErrors'];
    return {
      service: !!(G.media && G.media.audio && G.media.assets && G.media.capture),
      hooks: hookNames.map(m => {
        const hk = G.hooks['AudioManager.' + m];
        return { m, installed: !!(hk && hk.installed), reason: (hk && hk.reason) || '' };
      }),
      game: G.ui.panelNames('game'),
      debug: G.ui.panelNames('debug'),
      caps: G.media.caps()
    };
  });

  check('media publishes its three services under one namespace',
    wiring.service, JSON.stringify(Object.keys(wiring)));

  check('all five audio aliases install on a stock build',
    wiring.hooks.every(x => x.installed),
    wiring.hooks.filter(x => !x.installed).map(x => x.m + ': ' + x.reason).join('; '));

  /* The reasons are only observable when the target is absent, so the ones the
     module WOULD give are asserted against its source: a hook whose reason
     does not name its own target is a hook whose failure nobody can act on. */
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'gigahack', 'js', 'plugins', 'GigaHack_Media.js'), 'utf8');
  const installReasons = ['playBgm', 'playBgs', 'playMe', 'playSe', 'checkErrors'].map(m => {
    const at = src.indexOf("'AudioManager." + m + "'");
    const body = at < 0 ? '' : src.slice(at, at + 1600);
    const stated = body.indexOf('AudioManager.' + m + ' not found') > -1;
    return { m, stated };
  });
  check('every audio alias that could not install names its own target in the reason it records',
    installReasons.every(r => r.stated),
    installReasons.filter(r => !r.stated).map(r => r.m).join(', '));

  check('media registers Audio then Assets at the end of the game tab',
    wiring.game.indexOf('Audio') > -1 && wiring.game.indexOf('Assets') > -1 &&
    wiring.game.indexOf('Audio') < wiring.game.indexOf('Assets') &&
    wiring.game.indexOf('Assets') === wiring.game.length - 1,
    wiring.game.join(', '));

  check('media registers Capture on the debug tab between the log panels and Backups',
    wiring.debug.indexOf('Capture') > wiring.debug.indexOf('Log') &&
    wiring.debug.indexOf('Capture') < wiring.debug.indexOf('Backups'),
    wiring.debug.join(', '));

  check('no panel name is registered twice on the tabs media joins',
    new Set(wiring.game).size === wiring.game.length &&
    new Set(wiring.debug).size === wiring.debug.length,
    wiring.game.length + '/' + wiring.debug.length);

  /* =======================================================================
     THE ENGINE PROBES

     Each of these is asserted against the engine's own surface, not against a
     version, and each must be true on exactly the build that has the thing.
     ==================================================================== */
  const probes = await ev(() => ({
    mod: window.GigaHack.media.caps(),
    engine: {
      masterVolume: AudioManager.masterVolume !== undefined,
      encodeURI: typeof Utils.encodeURI === 'function',
      bitmapDestroy: typeof Bitmap.prototype.destroy === 'function',
      checkErrors: typeof AudioManager.checkErrors === 'function',
      snap: typeof SceneManager.snap === 'function'
    }
  }));
  check('the master-volume probe answers what this build\'s AudioManager actually has',
    probes.mod.audioMasterVolume === probes.engine.masterVolume &&
    probes.mod.audioMasterVolume === IS_MV,
    'mod=' + probes.mod.audioMasterVolume + ' engine=' + probes.engine.masterVolume);

  check('the subfolder probe tests the encoder\'s behaviour and answers yes exactly where the separator survives',
    probes.mod.assetSubfolders === probes.engine.encodeURI &&
    probes.mod.assetSubfolders === IS_MZ,
    'mod=' + probes.mod.assetSubfolders);

  check('the bitmap-destroy probe answers yes exactly on the build that has one',
    probes.mod.bitmapDestroy === probes.engine.bitmapDestroy &&
    probes.mod.bitmapDestroy === IS_MZ,
    'mod=' + probes.mod.bitmapDestroy);

  /* =======================================================================
     VOLUMES
     ==================================================================== */
  const vol = await ev(() => {
    const G = window.GigaHack, A = G.media.audio;
    const keep = {
      bgm: ConfigManager.bgmVolume, bgs: ConfigManager.bgsVolume,
      me: ConfigManager.meVolume, se: ConfigManager.seVolume
    };
    const out = {};

    /* live, not a copy */
    const first = A.volumes().bgm;
    ConfigManager.bgmVolume = 42;
    out.live = { first, second: A.volumes().bgm };

    /* audible per move, written once on release */
    const saves0 = window.__configSaves || 0;
    A.setVolume('bgm', 10, false);
    const heard1 = AudioManager._bgmVolume;
    A.setVolume('bgm', 20, false);
    const heard2 = AudioManager._bgmVolume;
    A.setVolume('bgm', 30, false);
    const savesDuring = (window.__configSaves || 0) - saves0;
    const commit = A.setVolume('bgm', 30, true);
    out.drag = {
      heard1, heard2, savesDuring,
      savesAfter: (window.__configSaves || 0) - saves0,
      commitOk: commit.ok, stored: AudioManager._bgmVolume
    };

    /* a write that does not stick */
    const desc = Object.getOwnPropertyDescriptor(ConfigManager, 'bgmVolume');
    Object.defineProperty(ConfigManager, 'bgmVolume', {
      get: function () { return 55; }, set: function () { }, configurable: true
    });
    const bad = A.setVolume('bgm', 7, true);
    out.stuck = {
      ok: bad.ok, why: bad.why,
      degraded: G.compat.isDegraded('media.volume'),
      degradedWhy: G.compat.degradedWhy('media.volume')
    };
    Object.defineProperty(ConfigManager, 'bgmVolume', desc);
    G.compat.clearDegraded('media.volume');

    /* master volume, and its absence */
    out.master = { available: A.masterAvailable(), value: A.volumes().master };

    ConfigManager.bgmVolume = keep.bgm;
    ConfigManager.bgsVolume = keep.bgs;
    ConfigManager.meVolume = keep.me;
    ConfigManager.seVolume = keep.se;
    return out;
  });

  check('the volume rows read the game\'s own config live, so a change made elsewhere shows without a rebuild',
    vol.live.second === 42 && vol.live.first !== 42, JSON.stringify(vol.live));

  check('moving a volume slider is heard on every move and writes the config file once, on release',
    vol.drag.heard1 === 10 && vol.drag.heard2 === 20 &&
    vol.drag.savesDuring === 0 && vol.drag.savesAfter === 1 && vol.drag.commitOk,
    JSON.stringify(vol.drag));

  check('a volume write that does not stick reports what it read back and greys the control',
    vol.stuck.ok === false && /read back 55/.test(vol.stuck.why) && vol.stuck.degraded === true,
    JSON.stringify(vol.stuck).slice(0, 200));

  check('the master volume is offered exactly on the build whose AudioManager has one',
    vol.master.available === IS_MV && (IS_MV ? typeof vol.master.value === 'number' : vol.master.value === null),
    JSON.stringify(vol.master));

  /* =======================================================================
     LISTING — with no filesystem, and with one
     ==================================================================== */
  /* Two rungs below the folder, and the list has to say which one it is
     standing on. The index is emptied for the second half so both are reached
     deterministically rather than depending on whether some earlier check
     happened to have built one. */
  const noFs = await ev(() => {
    const G = window.GigaHack, A = G.media.audio;
    const withIndex = A.list('audio/bgm');
    const assetsWithIndex = G.media.assets.list('img/characters', { recursive: true });
    const realFind = G.index.findAsset;
    G.index.findAsset = function () { return { candidates: [], complete: false, why: 'emptied' }; };
    const withoutIndex = A.list('audio/bgm');
    const assetsWithout = G.media.assets.list('img/characters', { recursive: true });
    G.index.findAsset = realFind;
    return {
      indexed: { source: withIndex.source, why: withIndex.why, n: withIndex.rows.length },
      bare: { source: withoutIndex.source, why: withoutIndex.why, n: withoutIndex.rows.length },
      assetsIndexed: assetsWithIndex.source,
      assetsBare: { source: assetsWithout.source, why: assetsWithout.why },
      db: A.databaseNames().length
    };
  });
  check('with no filesystem the audio list falls back to the boot index and says the index cannot tell a folder from a track',
    noFs.indexed.source === 'index' && /boot index/.test(noFs.indexed.why) &&
    /cannot tell a folder from a track/.test(noFs.indexed.why),
    noFs.indexed.source + ' — ' + noFs.indexed.why.slice(0, 110));

  check('with neither a filesystem nor an index the audio list names the precondition that failed and shows what the database names, labelled',
    noFs.bare.source === 'database' && /no folder listing here/.test(noFs.bare.why) &&
    /filesystem|Node/.test(noFs.bare.why) && noFs.bare.n > 0 && noFs.bare.n <= noFs.db,
    noFs.bare.source + ' — ' + noFs.bare.why.slice(0, 110));

  check('the image list degrades down the same two rungs and never claims to have read the folder',
    noFs.assetsIndexed !== 'folder' && noFs.assetsBare.source === 'database' &&
    /no folder listing here/.test(noFs.assetsBare.why),
    noFs.assetsIndexed + ' / ' + noFs.assetsBare.source);

  const fsList = await ev(() => {
    const G = window.GigaHack, A = G.media.audio;
    window.__mountVirtualFs();
    const l = A.list('audio/bgm');
    const rows = {};
    l.rows.forEach(r => { rows[r.name] = { dir: !!r.dir, playable: !!r.playable, why: r.why, sub: r.sub }; });
    const assets = G.media.assets.list('img/characters', { recursive: true });
    const arows = {};
    assets.rows.forEach(r => { arows[r.name] = { dir: !!r.dir, sign: r.sign }; });
    const out = {
      source: l.source, rows, n: l.rows.length,
      assetSource: assets.source, arows,
      encoded: {
        plain: G.media.assets.encodedUrl('img/characters', 'Actor1'),
        sub: G.media.assets.encodedUrl('img/characters', 'pack1/Hero')
      },
      audioUrl: A.url('bgm', 'pack1/Overture')
    };
    window.__unmountVirtualFs();
    return out;
  });

  check('a subfolder is listed as a folder and is never offered as a playable name',
    fsList.rows['pack1'] && fsList.rows['pack1'].dir === true &&
    fsList.rows['pack1'].playable === false && /folder, not a track/.test(fsList.rows['pack1'].why),
    JSON.stringify(fsList.rows['pack1']));

  check('the folder walk lists the track inside a subfolder that a one-level listing cannot see',
    !!fsList.rows['pack1/Overture'] && fsList.rows['pack1/Overture'].dir === false &&
    fsList.rows['pack1/Overture'].sub === 'pack1',
    Object.keys(fsList.rows).join(', '));

  check('a track inside a subfolder is playable exactly on the build whose url encoder keeps the separator',
    fsList.rows['pack1/Overture'].playable === IS_MZ &&
    (IS_MZ || /escapes the separator/.test(fsList.rows['pack1/Overture'].why)),
    'playable=' + fsList.rows['pack1/Overture'].playable + ' why=' + fsList.rows['pack1/Overture'].why);

  check('the url the panel shows is the one the engine will build, separator and all',
    fsList.encoded.plain === 'img/characters/Actor1.png' &&
    fsList.encoded.sub === (IS_MZ ? 'img/characters/pack1/Hero.png' : 'img/characters/pack1%2FHero.png') &&
    fsList.audioUrl === (IS_MZ ? 'audio/bgm/pack1/Overture.ogg' : 'audio/bgm/pack1%2FOverture.ogg'),
    fsList.encoded.sub + ' | ' + fsList.audioUrl);

  check('an encrypted spelling of an image is listed once, under the name the project uses',
    !!fsList.arows['Actor3'] && !fsList.arows['Actor3.rpgmvp'],
    Object.keys(fsList.arows).join(', '));

  /* =======================================================================
     AUDITIONING
     ==================================================================== */
  const audition = await ev(() => {
    const G = window.GigaHack, A = G.media.audio;
    window.__mountVirtualFs();
    window.__audioReset();
    A.clearRecent();
    const out = {};

    /* refused before the engine is asked */
    const loads0 = window.__audioLoads.length;
    const missing = A.play('bgm', 'NotOnDisk');
    out.refused = { ok: missing.ok, why: missing.why, asked: window.__audioLoads.length - loads0 };

    /* the same effect twice with no frame between */
    window.__audioLoads.length = 0;
    A.play('se', 'Cursor1');
    A.play('se', 'Cursor1');
    out.twice = { loads: window.__audioLoads.slice(), frame: Graphics.frameCount };

    /* a failed audition is swept before the engine's own error check runs */
    window.__audioMissing['Battle1'] = 1;
    A.play('bgm', 'Battle1');
    out.errored = !!(AudioManager._bgmBuffer && AudioManager._bgmBuffer.isError());
    let threw = null;
    try { AudioManager.checkErrors(); } catch (e) { threw = String(e); }
    out.swept = {
      threw, bufferGone: !AudioManager._bgmBuffer,
      failures: A.failures().length, named: (A.failures()[0] || {}).url
    };

    /* a game-side failure still throws */
    AudioManager.playBgm({ name: 'Battle1', volume: 90, pitch: 100, pan: 0 }, 0);
    let threw2 = null;
    try { AudioManager.checkErrors(); } catch (e) { threw2 = String(e); }
    out.gameSide = { threw: threw2 };

    delete window.__audioMissing['Battle1'];
    window.__audioReset();
    A.clearRecent();
    A.clearFailures();
    window.__unmountVirtualFs();
    return out;
  });

  check('auditioning a name with no file behind it is refused before the engine is asked, and the message names the path',
    audition.refused.ok === false && audition.refused.asked === 0 &&
    /audio\/bgm\/NotOnDisk\.ogg/.test(audition.refused.why),
    JSON.stringify(audition.refused));

  check('auditioning the same sound effect twice with no frame between plays it twice, because the audition stops the queue first',
    audition.twice.loads.length === 2 &&
    audition.twice.loads[0] === audition.twice.loads[1],
    JSON.stringify(audition.twice));

  check('an audition buffer that reports an error is stopped and dropped before the engine\'s own error check runs',
    audition.errored === true && audition.swept.threw === null &&
    audition.swept.bufferGone === true && audition.swept.failures === 1 &&
    /Battle1/.test(audition.swept.named || ''),
    JSON.stringify(audition.swept));

  check('a game-side audio load error still throws, because the sweep only touches buffers this module started',
    audition.gameSide.threw !== null && /Battle1/.test(audition.gameSide.threw),
    JSON.stringify(audition.gameSide).slice(0, 160));

  /* An audition is a write like any other, so it goes through the same
     verifier: a plugin that intercepts playback to enforce its own music is
     exactly what a play button that looks like it worked would hide. */
  const verified = await ev(() => {
    const G = window.GigaHack, A = G.media.audio;
    window.__mountVirtualFs();
    window.__audioReset();
    A.clearRecent();

    const good = A.play('bgm', 'Field1');
    const cleanAfterGood = !G.compat.isDegraded('media.play');

    /* a build that refuses to play anything */
    const realPlay = AudioManager.playBgm;
    AudioManager.playBgm = function () { };
    const blocked = A.play('bgm', 'Title');
    AudioManager.playBgm = realPlay;
    const out = {
      good: { ok: good.ok, why: good.why }, cleanAfterGood,
      blocked: { ok: blocked.ok, why: blocked.why },
      degraded: G.compat.isDegraded('media.play'),
      degradedWhy: G.compat.degradedWhy('media.play')
    };
    G.compat.clearDegraded('media.play');
    window.__audioReset();
    A.clearRecent();
    A.clearFailures();
    A.restore();
    window.__unmountVirtualFs();
    return out;
  });

  check('an audition is verified against what the manager reports playing, and a clean one is not marked degraded',
    verified.good.ok === true && verified.good.why === '' && verified.cleanAfterGood === true,
    JSON.stringify(verified.good));

  check('an audition the build silently refuses is reported as not having stuck, and the play controls are greyed',
    verified.blocked.ok === false && verified.degraded === true &&
    /media\.play/.test(verified.degradedWhy),
    JSON.stringify(verified.blocked).slice(0, 180));

  /* =======================================================================
     THE RECENT RING
     ==================================================================== */
  const ring = await ev(() => {
    const G = window.GigaHack, A = G.media.audio;
    window.__mountVirtualFs();
    window.__audioReset();
    A.clearRecent();

    AudioManager.playBgm({ name: 'Field1', volume: 90, pitch: 100, pan: 0 }, 0);
    A.play('bgm', 'Title');
    const rows = A.recent(0).map(r => r.kind + ':' + r.name + ':' + r.source + ':' + r.count);

    /* the game's own menu sounds take a different call and are not listed */
    const before = A.recentCount();
    SoundManager.playSystemSound(0);
    const afterSystem = A.recentCount();

    /* repeats collapse */
    A.clearRecent();
    A.play('se', 'Cursor1');
    A.play('se', 'Cursor1');
    A.play('se', 'Cursor1');
    const collapsed = A.recent(0).map(r => r.name + '×' + r.count);

    window.__audioReset();
    A.clearRecent();
    A.clearFailures();
    A.restore();
    window.__unmountVirtualFs();
    return { rows, before, afterSystem, collapsed, staticBuffers: AudioManager._staticBuffers.length };
  });

  check('the recent list labels what the game played and what the panel auditioned differently',
    ring.rows.length === 2 &&
    ring.rows[0] === 'bgm:Title:audition:1' && ring.rows[1] === 'bgm:Field1:game:1',
    ring.rows.join(' | '));

  check('the game\'s own menu sounds are absent from the recent list, because they take a different call',
    ring.afterSystem === ring.before, ring.before + ' -> ' + ring.afterSystem);

  check('repeats of one effect inside four frames collapse into a single counted row',
    ring.collapsed.length === 1 && ring.collapsed[0] === 'Cursor1×3',
    ring.collapsed.join(' | '));

  /* =======================================================================
     PUTTING IT BACK
     ==================================================================== */
  const restore = await ev(() => {
    const G = window.GigaHack, A = G.media.audio;
    window.__mountVirtualFs();
    window.__audioReset();
    A.clearRecent();
    const out = {};

    /* the watchdog: the panel stamps, then stops stamping */
    AudioManager.playBgm({ name: 'Field1', volume: 90, pitch: 100, pan: 0 }, 0);
    AudioManager.playBgs({ name: 'Town1', volume: 90, pitch: 100, pan: 0 }, 0);
    A.play('bgm', 'Title');
    out.duringAudition = AudioManager._currentBgm.name;
    out.saved = !!A.saved();
    A.heartbeat();
    window.__raf.reset(); SceneManager.requestUpdate();
    for (var i = 0; i < 14; i++) window.__raf.flush();
    out.afterLeave = {
      bgm: AudioManager._currentBgm && AudioManager._currentBgm.name,
      bgs: AudioManager._currentBgs && AudioManager._currentBgs.name,
      saved: !!A.saved()
    };

    /* what restore says about a musical effect */
    A.play('bgm', 'Title');
    out.result = A.restore();

    /* The same NAME, a different position. The game is twelve seconds into a
       track, an audition takes the music somewhere else, and then the same
       track is auditioned again — which starts it from zero. Putting it back
       now compares equal by name and, without the stop, would re-apply the
       volume and leave the music at the wrong place. */
    window.__audioReset();
    AudioManager.playBgm({ name: 'Field1', volume: 90, pitch: 100, pan: 0 }, 0);
    AudioManager._bgmBuffer.seek = function () { return 12; };
    A.play('bgm', 'Title');                  /* saves Field1 at 12 */
    A.play('bgm', 'Field1');                 /* the same name again, from zero */
    AudioManager._bgmBuffer.seek = function () { return 0; };
    out.savedPos = A.saved().bgm.pos;
    out.sameName = !!AudioManager.isCurrentBgm(A.saved().bgm);
    out.beforeRestore = AudioManager._currentBgm.pos;
    A.restore();
    out.afterRestore = AudioManager._currentBgm.pos;

    window.__audioReset();
    A.clearRecent();
    A.clearFailures();
    window.__unmountVirtualFs();
    return out;
  });

  check('leaving the panel puts back the music and the ambience the game was playing',
    restore.duringAudition === 'Title' && restore.saved === true &&
    restore.afterLeave.bgm === 'Field1' && restore.afterLeave.bgs === 'Town1' &&
    restore.afterLeave.saved === false,
    JSON.stringify(restore.afterLeave));

  check('putting it back says a musical effect cannot be, rather than reporting a success it did not have',
    restore.result && restore.result.bgm === true && restore.result.me === 'cannot',
    JSON.stringify(restore.result));

  check('putting back a track the engine calls "the same one" seeks to where it was, rather than being skipped on the name match',
    restore.savedPos === 12 && restore.sameName === true &&
    restore.beforeRestore === 0 && restore.afterRestore === 12,
    JSON.stringify({ saved: restore.savedPos, sameName: restore.sameName, before: restore.beforeRestore, after: restore.afterRestore }));

  /* =======================================================================
     SHEETS
     ==================================================================== */
  const sheets = await ev(() => {
    const AS = window.GigaHack.media.assets;
    const big = { width: 144, height: 192 }, wide = { width: 576, height: 384 };
    const out = {
      gate: AS.grid('img/characters', '!$Gate1', big),
      dollar: AS.grid('img/characters', '$Big1', big),
      plain: AS.grid('img/characters', 'Actor1', wide),
      door: AS.grid('img/characters', '!Door1', wide)
    };
    /* what the ENGINE says, not what the name looks like: the predicate is
       replaced and the grid must follow it. */
    const realBig = ImageManager.isBigCharacter;
    ImageManager.isBigCharacter = function (n) { return n === 'Actor1'; };
    out.engineSaysBig = AS.grid('img/characters', 'Actor1', wide).big;
    out.engineSaysNotBig = AS.grid('img/characters', '$Big1', big).big;
    ImageManager.isBigCharacter = realBig;

    /* and with no predicate at all */
    delete ImageManager.isBigCharacter;
    const G2 = window.GigaHack;
    out.noPredicate = AS.grid('img/characters', '$Big1', big);
    ImageManager.isBigCharacter = realBig;

    /* the walk, against the engine's own number */
    const c = Object.create(Game_CharacterBase.prototype);
    out.walk = [];
    for (var s = 1; s <= 6; s++) {
      c._moveSpeed = s;
      c._dashing = false;
      out.walk.push({ s, mine: AS.walk(s).waitFrames, engine: c.animationWait() });
    }
    out.columns = AS.walk(4).columns;

    /* faces follow the engine's own size */
    const faceBefore = AS.grid('img/faces', 'Actor1', { width: 576, height: 288 });
    let restoreFace;
    if (typeof ImageManager.getFaceSize === 'function') {
      $dataSystem.faceSize = 96;
      restoreFace = function () { delete $dataSystem.faceSize; };
    } else {
      const keep = Window_Base._faceWidth, keepH = Window_Base._faceHeight;
      Window_Base._faceWidth = 96; Window_Base._faceHeight = 96;
      restoreFace = function () { Window_Base._faceWidth = keep; Window_Base._faceHeight = keepH; };
    }
    const faceAfter = AS.grid('img/faces', 'Actor1', { width: 576, height: 288 });
    restoreFace();
    out.face = { before: faceBefore, after: faceAfter, back: AS.grid('img/faces', 'Actor1', { width: 576, height: 288 }) };

    /* the frame arithmetic */
    out.rects = {
      bigDown0: AS.frameRect(out.gate, 0, 2, 0),
      plainChar5Left1: AS.frameRect(out.plain, 5, 4, 1)
    };
    return out;
  });

  check('a sheet whose leading sign run contains "$" is one character, including the one whose first character is "!"',
    sheets.gate.big === true && sheets.gate.characters === 1 && sheets.gate.cols === 3 &&
    sheets.dollar.big === true && sheets.plain.big === false && sheets.plain.characters === 8,
    'gate=' + sheets.gate.big + ' dollar=' + sheets.dollar.big + ' plain=' + sheets.plain.big);

  check('the frame grid follows the engine\'s own big-character test, not a reading of the name',
    sheets.engineSaysBig === true && sheets.engineSaysNotBig === false,
    'engineSaysBig=' + sheets.engineSaysBig + ' engineSaysNotBig=' + sheets.engineSaysNotBig);

  check('with no big-character test on the build the layout is marked a guess rather than shown as a fact',
    sheets.noPredicate.provisional === true && sheets.gate.provisional === false,
    'noPredicate=' + sheets.noPredicate.provisional);

  check('a "!" sheet reports the flat anchor and a plain one reports the six-pixel lift',
    sheets.door.object === true && sheets.plain.object === false && sheets.gate.object === true,
    'door=' + sheets.door.object + ' plain=' + sheets.plain.object + ' gate=' + sheets.gate.object);

  check('the walk cycle holds each column for the number the engine\'s own animationWait returns',
    sheets.walk.every(w => w.mine === w.engine) && sheets.walk[3].mine === 15,
    sheets.walk.map(w => w.s + ':' + w.mine + '/' + w.engine).join(' '));

  check('the walk cycle steps its columns 0, 1, 2, 1',
    sheets.columns.join(',') === '0,1,2,1', sheets.columns.join(','));

  check('the face grid is four across and follows the engine\'s own face size rather than a hardcoded 144',
    sheets.face.before.cols === 4 && sheets.face.before.frameW === 144 &&
    sheets.face.after.frameW === 96 && sheets.face.after.frameH === 96 &&
    sheets.face.back.frameW === 144,
    JSON.stringify({ before: sheets.face.before.frameW, after: sheets.face.after.frameW, back: sheets.face.back.frameW }));

  check('the frame rectangle blocks a plain sheet four across and three wide, and starts a "$" sheet at the origin',
    sheets.rects.bigDown0.sx === 0 && sheets.rects.bigDown0.sy === 0 &&
    sheets.rects.plainChar5Left1.sx === (1 % 4) * 3 * 48 + 48 &&
    sheets.rects.plainChar5Left1.sy === (Math.floor(5 / 4) * 4 + 1) * 48,
    JSON.stringify(sheets.rects));

  /* =======================================================================
     A SHEET THAT WILL NOT LOAD

     The severe one on the image side: an errored bitmap left in the cache
     makes the engine's own readiness test throw on one build, and the scene's
     readiness test calls it — so one failed preview breaks every later scene
     change until the entry is gone. The bitmap is evicted BY IDENTITY, which
     is why the check plants it under a key nothing would compute.
     ==================================================================== */
  const failed = await ev(() => {
    const G = window.GigaHack, AS = G.media.assets;
    const bad = Object.create(Bitmap.prototype);
    if (bad.initialize) bad.initialize();
    bad._url = 'img/characters/Broken.png';
    bad._loadingState = 'error';
    bad.width = 0; bad.height = 0;

    /* a key nothing would rebuild from the folder and the name */
    const KEY = 'some/other/spelling/of/the/url:0';
    if (ImageManager._cache) ImageManager._cache[KEY] = bad;
    if (ImageManager._imageCache && ImageManager._imageCache._items) {
      ImageManager._imageCache._items[KEY] = { bitmap: bad, key: KEY, touch: Date.now() };
    }
    let readyThrewBefore = false;
    try { ImageManager.isReady(); } catch (e) { readyThrewBefore = true; }

    const realLoad = ImageManager.loadBitmap;
    ImageManager.loadBitmap = function () { return bad; };
    let out = null;
    AS.sheet('img/characters', 'Broken', o => { out = o; });
    ImageManager.loadBitmap = realLoad;

    const stillCached =
      !!(ImageManager._cache && ImageManager._cache[KEY]) ||
      !!(ImageManager._imageCache && ImageManager._imageCache._items &&
        ImageManager._imageCache._items[KEY]);
    let readyThrewAfter = false;
    try { ImageManager.isReady(); } catch (e) { readyThrewAfter = true; }

    if (ImageManager._cache) delete ImageManager._cache[KEY];
    if (ImageManager._imageCache && ImageManager._imageCache._items) {
      delete ImageManager._imageCache._items[KEY];
    }
    return { result: out, stillCached, readyThrewBefore, readyThrewAfter };
  });

  check('a sheet that will not load is reported as a failure rather than left loading for ever',
    failed.result && failed.result.error === true && /did not load/.test(failed.result.why),
    JSON.stringify(failed.result).slice(0, 160));

  check('a failed sheet is dropped from the image cache by identity, under whatever key it was filed at',
    failed.stillCached === false && /dropped from the image cache/.test(failed.result.why),
    'stillCached=' + failed.stillCached);

  check('the engine\'s own readiness test stops throwing once the failed sheet is evicted, exactly where it threw',
    failed.readyThrewBefore === IS_MZ && failed.readyThrewAfter === false,
    'before=' + failed.readyThrewBefore + ' after=' + failed.readyThrewAfter);

  /* =======================================================================
     CAPTURE
     ==================================================================== */
  const cap = await ev(() => {
    const G = window.GigaHack, C = G.media.capture;
    const out = {};
    C.clear();

    out.size = C.size();
    out.canvasEl = (function () {
      const el = document.getElementById(G.caps.canvasId);
      return el ? { w: el.width, h: el.height } : null;
    })();

    /* nothing registered */
    out.excludedEmpty = C.excluded().length;

    /* with no filesystem: a burst is refused, a single shot is not */
    const refused = C.burst({ n: 3, everyFrames: 1 });
    const single = C.shoot();
    out.noFs = {
      burstOk: refused.ok, burstWhy: refused.why,
      shotOk: single.ok, hasBytes: !!single.bytes, path: single.path,
      gameW: single.gameW, gameH: single.gameH, w: single.w, source: single.source,
      destroyed: single.destroyed,
      lastHasImage: !!(C.last() && C.last().dataUrl)
    };
    C.clear();
    return out;
  });

  check('the shot size is the game\'s own resolution, which is not the size of the window\'s canvas',
    cap.size.w === 816 && cap.size.h === 624 && cap.canvasEl.w !== cap.size.w,
    JSON.stringify({ game: cap.size, canvas: cap.canvasEl }));

  check('a shot reports the game\'s own resolution whatever the pixels came from',
    cap.noFs.shotOk === true && cap.noFs.gameW === cap.size.w && cap.noFs.gameH === cap.size.h,
    JSON.stringify(cap.noFs).slice(0, 200));

  check('with no filesystem a burst is refused and names what is missing, and a single shot is still offered as an image',
    cap.noFs.burstOk === false && /somewhere to write/.test(cap.noFs.burstWhy) &&
    cap.noFs.shotOk === true && cap.noFs.hasBytes === true &&
    cap.noFs.path === null && cap.noFs.lastHasImage === true,
    JSON.stringify({ burstWhy: cap.noFs.burstWhy.slice(0, 80), path: cap.noFs.path }));

  check('a snapped bitmap is released through the engine\'s own destroy exactly on the build that has one',
    cap.noFs.destroyed === IS_MZ, 'destroyed=' + cap.noFs.destroyed);

  check('nothing is registered as in-scene drawing, and the module reports that rather than claiming to have hidden something',
    cap.excludedEmpty === 0, String(cap.excludedEmpty));

  /* hide / snap / restore, including when the snapshot throws */
  const hiding = await ev(() => {
    const G = window.GigaHack, C = G.media.capture;
    const node = window.__modLayer;
    const seen = [];
    const realSnap = SceneManager.snap;
    SceneManager.snap = function () { seen.push(node.visible); return realSnap.apply(this, arguments); };
    const off = C.exclude('probe layer', function () { return node; });
    const registered = C.excluded();
    C.shoot();
    const afterOk = node.visible;

    SceneManager.snap = function () {
      seen.push(node.visible);
      throw new Error('deliberate test error — the snapshot is made to fail here');
    };
    let threw = false, stillShot = false;
    try { stillShot = C.shoot().ok; } catch (e) { threw = true; }
    const afterThrow = node.visible;

    SceneManager.snap = realSnap;
    off();
    C.clear();
    return {
      seen, afterOk, afterThrow, threw, stillShot,
      registered: registered.map(r => r.label + ':' + r.present),
      nowRegistered: C.excluded().length
    };
  });

  check('the shot hides every in-scene drawing that registered itself and shows it again afterwards',
    hiding.seen[0] === false && hiding.afterOk === true &&
    hiding.registered.join(',') === 'probe layer:true',
    JSON.stringify(hiding).slice(0, 180));

  check('an in-scene drawing is shown again even when the snapshot itself throws, and the shot still lands',
    hiding.seen[1] === false && hiding.afterThrow === true && hiding.threw === false &&
    hiding.stillShot === true,
    'duringThrow=' + hiding.seen[1] + ' after=' + hiding.afterThrow + ' shot=' + hiding.stillShot);

  check('unregistering an in-scene drawing removes it, so a module that unloads is not still named',
    hiding.nowRegistered === 0, String(hiding.nowRegistered));

  /* with a filesystem: real bytes, and a bounded burst */
  const written = await ev(() => {
    const G = window.GigaHack, C = G.media.capture;
    window.__mountVirtualFs();
    C.clear();
    const one = C.shoot();
    const body = window.__vfs.files[one.path];
    const out = {
      dir: C.dir(), path: one.path,
      isString: typeof body === 'string',
      bytes: body ? body.length : 0,
      signature: one.bytes ? Array.prototype.slice.call(one.bytes, 0, 8).join(',') : ''
    };
    C.clear();

    const started = C.burst({ n: 3, everyFrames: 2 });
    window.__raf.reset(); SceneManager.requestUpdate();
    for (var i = 0; i < 8; i++) window.__raf.flush();
    const rows = C.shots();
    out.burst = {
      started: started.ok,
      n: rows.length,
      withBytes: rows.filter(r => r.hasBytes).length,
      newestHasBytes: rows.length ? rows[rows.length - 1].hasBytes : false,
      allWritten: rows.every(r => !!r.file),
      peakLive: C.peakLive(),
      running: C.running().on
    };
    C.clear();
    C.stopBurst();
    window.__unmountVirtualFs();
    return out;
  });

  check('the written screenshot is PNG bytes, not a string of them',
    written.isString === false && written.bytes > 100 &&
    written.signature === '137,80,78,71,13,10,26,10',
    JSON.stringify({ isString: written.isString, bytes: written.bytes, sig: written.signature }));

  check('a burst writes every shot and keeps only the newest one\'s bytes',
    written.burst.started === true && written.burst.n === 3 &&
    written.burst.allWritten === true && written.burst.withBytes === 1 &&
    written.burst.newestHasBytes === true && written.burst.running === false,
    JSON.stringify(written.burst));

  check('a burst never has more than one full-screen bitmap alive at a time',
    written.burst.peakLive === 1, String(written.burst.peakLive));

  /* =======================================================================
     WHAT THE PANELS SAY

     Three sentences that must survive an edit, because each of them is the
     whole answer to a question the panel would otherwise leave open.
     ==================================================================== */
  const said = await ev(() => {
    const G = window.GigaHack;
    const keepTab = G.cfg.ui.tab;
    const keepSub = JSON.parse(JSON.stringify(G.cfg.ui.sub || {}));
    const wasOpen = G.ui.isOpen();
    function panelText(tab, name) {
      G.ui.setOpen(true);
      G.cfg.ui.tab = tab;
      if (!G.cfg.ui.sub) G.cfg.ui.sub = {};
      G.cfg.ui.sub[tab] = name;
      G.ui.rerender();
      return G.ui.getHost().root.textContent || '';
    }
    const out = {};
    out.audio = panelText('game', 'Audio');
    out.assets = panelText('game', 'Assets');
    out.capture = panelText('debug', 'Capture');
    G.cfg.ui.tab = keepTab;
    G.cfg.ui.sub = keepSub;
    G.ui.setOpen(wasOpen);
    G.ui.rerender();
    return {
      audioNamesStaticPath: /playStaticSe/.test(out.audio),
      audioNamesMeLimit: /An ME cannot be put back/.test(out.audio),
      audioNamesCounts: /two different numbers/.test(out.audio),
      assetsNamesSource: /this folder, read now|the boot index|the database only/.test(out.assets),
      captureNamesDomLayer: /browser layer over the canvas/.test(out.capture),
      captureNamesSnapScope: /renders the display tree only/.test(out.capture),
      audioLen: out.audio.length, captureLen: out.capture.length
    };
  });

  check('the recent list names the call the game\'s own menu sounds take instead of leaving the gap unexplained',
    said.audioNamesStaticPath && said.audioNamesMeLimit,
    JSON.stringify(said));

  check('the folder panel says the boot index\'s count and its own are two different numbers',
    said.audioNamesCounts, String(said.audioNamesCounts));

  check('with nothing registered the capture panel says the menu is a browser layer the snapshot never sees',
    said.captureNamesDomLayer && said.captureNamesSnapScope,
    JSON.stringify(said));

  check('the assets panel names where its list of names came from',
    said.assetsNamesSource, String(said.assetsNamesSource));

  /* =======================================================================
     LEFT AS FOUND
     ==================================================================== */
  const clean = await ev(() => {
    const G = window.GigaHack, A = G.media.audio;
    return {
      fs: G.caps.fs,
      shots: G.media.capture.shots().length,
      burst: G.media.capture.running().on,
      recent: A.recentCount(),
      failures: A.failures().length,
      saved: !!A.saved(),
      degraded: ['media.volume', 'media.play', 'media.master']
        .filter(c => G.compat.isDegraded(c)),
      bgm: AudioManager._currentBgm && AudioManager._currentBgm.name,
      volumes: A.volumes(),
      excluded: G.media.capture.excluded().length
    };
  });
  check('the media checks leave the game, the settings and the filesystem as they found them',
    clean.fs === false && clean.shots === 0 && clean.burst === false &&
    clean.recent === 0 && clean.failures === 0 && clean.saved === false &&
    clean.degraded.length === 0 && clean.excluded === 0 &&
    clean.volumes.bgm === 100 && clean.volumes.se === 100,
    JSON.stringify(clean));

  await shot('media-audio');
};
