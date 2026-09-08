/* =============================================================================
   GigaHack MV/MZ — GigaHack_Addons.js

   An addon is somebody else's JavaScript, so almost every claim this module
   makes is a NEGATIVE one: the body did not run while the header was read,
   nothing was enabled by being imported, the thing that was refused was not
   installed, the addon that threw did not take the next one with it. A
   negative claim cannot be checked by looking at the result — "we did not run
   it" and "we ran it and it did nothing" leave the same empty room — so every
   fixture below leaves a mark on `window` when its body runs, and the checks
   assert on the mark.

   The end-to-end one is the template. The check imports the source the panel's
   own button hands the user, commits it, enables it, renders the panel it
   registered and reads text out of it, through the real code path with no
   short cuts. If the template stops being a working addon this file goes red.

   State discipline: this file sorts FIRST in the checks directory, so
   everything it leaves behind is inherited by every other check file and by
   run.js's own global sweeps. Every addon it imports is removed, every $.api
   name it adds is gone, the tab and sub-tab are put back, the undo stack is
   drained to the baseline, the injected transport and paths are restored in
   the same block that swapped them, and the last block asserts all of it.

   The one thing it deliberately leaves behind is an engine alias, because that
   is the behaviour under test: an addon's alias cannot be removed once it is
   installed, so the check proves it became a pass-through instead.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function (ctx) {
  var check = ctx.check, ev = ctx.ev, page = ctx.page;

  const MODULE = path.resolve(__dirname, '..', '..', 'gigahack', 'js', 'plugins', 'GigaHack_Addons.js');
  const SRC = fs.readFileSync(MODULE, 'utf8');

  /* ---------------------------------------------------------------- fixtures
     Every one of these is a real addon file, header and all, and every body
     that is supposed to run says so on `window`. The line the thrower throws
     on is counted from the first line of the file, which is what the panel
     claims to print. */
  const FIX = {
    /* @gigahack-addon on line 2; the body would set __ranHeaderProbe. */
    header: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id header-probe',
      ' * @name Header Probe',
      ' * @version 9.9.9',
      ' * @author nobody at all',
      ' * @game /a title pattern/i',
      ' * @needs vars, screen',
      ' * @help First line of help.',
      ' * Second line of help.',
      ' */',
      'window.__ranHeaderProbe = true;',
      'GigaHack.addon(function (api) { window.__setupHeaderProbe = true; });'
    ].join('\n'),

    /* No annotation block at all — listed, not refused. */
    bare: [
      '/* just an ordinary comment, no annotations */',
      'window.__ranBare = true;',
      'GigaHack.addon(function (api) { api.command(\'bareProbe\', function () { return 1; }); });'
    ].join('\n'),

    /* Throws from setup, on line 8 of the file. */
    thrower: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id thrower',
      ' * @name Thrower',
      ' */',
      'GigaHack.addon(function (api) {',
      '    window.__throwerRan = true;',
      '    throw new Error(\'deliberate test error from an addon\');',
      '});'
    ].join('\n'),

    /* Loads immediately after the thrower and must be unaffected. */
    survivor: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id zz-survivor',
      ' * @name Survivor',
      ' */',
      'GigaHack.addon(function (api) {',
      '    window.__survivorRan = true;',
      '    api.command(\'survivorProbe\', function () { return \'alive\'; });',
      '});'
    ].join('\n'),

    /* Registers one of everything that can be taken back, plus one alias and
       one profile that cannot. isDashing is aliased because nothing else in
       the mod hooks it, so the addon's wrapper is the outermost one and the
       pass-through is observable. */
    everything: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id everything',
      ' * @name Everything',
      ' * @version 1.2.3',
      ' */',
      'GigaHack.addon(function (api) {',
      '    api.panel(\'world\', \'Everything\', function () {',
      '        return api.cols([api.w.group(\'Everything\', [api.kv(\'id\', api.id)])]);',
      '    }, 168);',
      '    api.hotkey({ id: \'go\', label: \'Everything: go\', run: function () { window.__everythingKey = true; } });',
      '    api.command(\'everythingProbe\', function () { return \'here\'; }, \'a probe\');',
      '    api.on(\'map\', function (id) { window.__everythingMap = id; });',
      '    api.hook(\'Game_Player.isDashing\', Game_Player.prototype, \'isDashing\',',
      '        function (original) { return function () { window.__dashWrapped = true; return true; }; },',
      '        \'Game_Player.prototype.isDashing is absent on this build\');',
      '    api.profile({ id: \'addon-check-profile\', name: \'From an addon\', match: function () { return false; } });',
      '});'
    ].join('\n'),

    /* Registers nothing at all. */
    inert: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id inert',
      ' * @name Inert',
      ' */',
      'window.__inertRan = true;'
    ].join('\n'),

    /* Would set a marker if it were ever run. Used for quarantine and safe mode. */
    quarantine: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id quarantine-me',
      ' * @name Quarantine me',
      ' */',
      'GigaHack.addon(function (api) { window.__quarantineRan = true; });'
    ].join('\n'),

    /* Two versions of one addon, for re-importing over a running one. Each
       registers the same three things, and the console call answers with its
       own version, so "which of the two is live" is a question with an
       answer rather than an inference. */
    liveV1: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id probe-live',
      ' * @name Probe Live',
      ' * @version 1.0.0',
      ' */',
      'GigaHack.addon(function (api) {',
      '    api.panel(\'world\', \'Probe Live\', function () {',
      '        return api.cols([api.w.group(\'Probe Live\', [api.kv(\'v\', \'v1\')])]);',
      '    }, 169);',
      '    api.hotkey({ id: \'go\', label: \'Probe Live: go\', run: function () {} });',
      '    api.command(\'probeLive\', function () { return \'v1\'; });',
      '    api.on(\'map\', function () { window.__probeLiveMap = (window.__probeLiveMap || 0) + 1; });',
      '});'
    ].join('\n'),

    liveV2: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id probe-live',
      ' * @name Probe Live',
      ' * @version 2.0.0',
      ' */',
      'GigaHack.addon(function (api) {',
      '    api.panel(\'world\', \'Probe Live\', function () {',
      '        return api.cols([api.w.group(\'Probe Live\', [api.kv(\'v\', \'v2\')])]);',
      '    }, 169);',
      '    api.hotkey({ id: \'go\', label: \'Probe Live: go\', run: function () {} });',
      '    api.command(\'probeLive\', function () { return \'v2\'; });',
      '    api.on(\'map\', function () { window.__probeLiveMap = (window.__probeLiveMap || 0) + 1; });',
      '});'
    ].join('\n'),

    /* Registers a panel under a name the settings tab already uses — the
       worst case, because "Addons" is the panel that switches it off — and
       one under a name of its own, so a refusal can be told from a failure. */
    thief: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id panel-thief',
      ' * @name Panel Thief',
      ' */',
      'GigaHack.addon(function (api) {',
      '    window.__thiefTook = api.panel(\'settings\', \'Addons\', function () {',
      '        return api.cols([api.w.group(\'Taken\', [api.kv(\'id\', api.id)])]);',
      '    }, 60);',
      '    window.__thiefOwn = api.panel(\'settings\', \'Panel Thief\', function () {',
      '        return api.cols([api.w.group(\'Own\', [api.kv(\'id\', api.id)])]);',
      '    }, 61);',
      '});'
    ].join('\n'),

    /* An event handler that throws every time it is called. The throw is on
       line 9 of the file, which is what the row claims to print. */
    badHandler: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id bad-handler',
      ' * @name Bad handler',
      ' */',
      'GigaHack.addon(function (api) {',
      '    api.on(\'frame\', function () {',
      '        window.__badHandlerCalls = (window.__badHandlerCalls || 0) + 1;',
      '        throw new Error(\'deliberate test error from a handler\');',
      '    });',
      '});'
    ].join('\n'),

    /* Hands its api.game out, so the guarded-write result can be read from
       the outside without a console name per method. */
    gameProbe: [
      '/*:',
      ' * @gigahack-addon',
      ' * @id game-probe',
      ' * @name Game probe',
      ' */',
      'GigaHack.addon(function (api) {',
      '    window.__gameApi = api.game;',
      '    api.command(\'gameProbe\', function () { return api.id; });',
      '});'
    ].join('\n'),

    /* An HTML error page, which is what a link that has gone wrong sends. */
    html: '<!DOCTYPE html>\n<html><head><title>404 Not Found</title></head>\n<body>nope</body></html>',

    /* Valid-looking but does not parse: line 3 is the offender. */
    broken: [
      '/*: @gigahack-addon @id broken */',
      'GigaHack.addon(function (api) {',
      '    var x = ;',
      '});'
    ].join('\n')
  };

  /* The overlay is driven the way a person drives it. */
  async function panelText(tab, sub) {
    await ev((o) => {
      const G = window.GigaHack;
      G.ui.setOpen(true);
      G.cfg.ui.tab = o.tab;
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub[o.tab] = o.sub;
      G.ui.rerender();
    }, { tab: tab, sub: sub });
    return await ev(() => {
      const b = document.querySelector('#mm-root .mm-body');
      return b ? b.textContent : '';
    });
  }

  const undoBase = await ev(() => window.GigaHack.undo.size());

  const before = await ev(() => {
    const G = window.GigaHack;
    return {
      undo: G.undo.size(),
      tab: G.cfg.ui.tab,
      sub: JSON.stringify(G.cfg.ui.sub || {}),
      open: G.ui.isOpen(),
      api: Object.keys(G.api).sort().join(','),
      world: G.ui.panelNames('world').join(','),
      hotkeys: G.ui.hotkeyList().length,
      frameHooks: G.frameHooks().map(e => e.name).sort().join(' | '),
      pathsMode: G.paths.mode,
      envFs: G.env.fs
    };
  });

  await ev((f) => { window.__FIX = f; }, FIX);

  /* =======================================================================
     WHERE IT SITS
     ==================================================================== */
  const placed = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const s = U.panelNames('settings'), d = U.panelNames('debug');
    return {
      settings: s, debug: d,
      settingsAt: s.indexOf('Addons'), debugAt: d.indexOf('Addons'),
      lastOnSettings: s[s.length - 1] === 'Addons',
      afterBackups: d.indexOf('Addons') > d.indexOf('Backups'),
      marker: typeof G.addons,
      inModuleReport: G.moduleReport().rows.map(r => r.name).indexOf('GigaHack_Addons')
    };
  });
  check('the module publishes $.addons and puts itself in the module report between Build and Boot, ' +
    'so a build missing the file is a named row rather than a silence',
    placed.marker === 'object' && placed.inModuleReport > -1,
    JSON.stringify({ marker: placed.marker, at: placed.inModuleReport }));
  check('both panels register at the tail of their tab, where no other panel names a neighbour',
    placed.settingsAt > -1 && placed.debugAt > -1 && placed.lastOnSettings && placed.afterBackups,
    JSON.stringify({ settings: placed.settings, debug: placed.debug }));

  /* =======================================================================
     1. THE HEADER IS READ WITHOUT RUNNING ANYTHING

     The claim is negative, so the fixture leaves a mark when its body runs
     and the check asserts the mark is absent.
     ==================================================================== */
  const hd = await ev(() => {
    const A = window.GigaHack.addons;
    window.__ranHeaderProbe = false;
    window.__setupHeaderProbe = false;
    const h = A.header(window.__FIX.header);
    return {
      h: h,
      bodyRan: window.__ranHeaderProbe === true,
      setupRan: window.__setupHeaderProbe === true
    };
  });
  check('an addon header is parsed without executing the body',
    hd.h.has === true && hd.h.id === 'header-probe' && hd.h.name === 'Header Probe' &&
    hd.h.version === '9.9.9' && hd.h.author === 'nobody at all' &&
    hd.h.game === '/a title pattern/i' &&
    hd.h.needs.join(',') === 'vars,screen' &&
    hd.bodyRan === false && hd.setupRan === false,
    JSON.stringify({ header: hd.h, bodyRan: hd.bodyRan }));
  check('and @help is greedy to the end of the block, so a paragraph survives being an annotation',
    /First line of help\.\nSecond line of help\./.test(hd.h.help), JSON.stringify(hd.h.help));

  const bare = await ev(() => {
    const A = window.GigaHack.addons;
    window.__ranBare = false;
    const h = A.header(window.__FIX.bare);
    const staged = A.stage({ text: window.__FIX.bare, from: 'paste', name: 'bare-one' });
    const out = { h: h, staged: staged, ran: window.__ranBare === true };
    A.discard();
    return out;
  });
  check('a file with no header claims nothing and is not refused for it — the id comes from the name ' +
    'it was given instead',
    bare.h.has === false && /no header/.test(bare.h.why) &&
    bare.staged.ok === true && bare.staged.id === 'bare-one' && bare.ran === false,
    JSON.stringify({ why: bare.h.why, staged: bare.staged.id, ran: bare.ran }));

  /* =======================================================================
     2. IMPORT AND REVIEW
     ==================================================================== */
  const review = await ev(() => {
    const A = window.GigaHack.addons;
    window.__ranHeaderProbe = false;
    const staged = A.stage({ text: window.__FIX.header, from: 'paste' });
    const s = A.staged();
    const out = {
      staged: staged,
      keptText: s ? s.text === window.__FIX.header : false,
      size: s ? s.size : -1,
      digest: s ? s.digest : '',
      first: s ? s.first : '',
      ranWhileStaged: window.__ranHeaderProbe === true,
      listedWhileStaged: A.list().map(r => r.id).join(',')
    };
    const committed = A.commit();
    const rec = A.get('header-probe');
    out.committed = committed;
    out.enabledByImport = rec ? rec.enabled : null;
    out.stateAfterImport = rec ? rec.state : null;
    out.ranAfterImport = window.__ranHeaderProbe === true;
    out.sourceRecorded = rec ? rec.source : null;
    out.stagedCleared = A.staged() === null;
    return out;
  });
  check('the review shows the whole source, its size and its fingerprint, and nothing has run at that point',
    review.staged.ok === true && review.keptText === true &&
    review.size === FIX.header.length && /^[0-9a-f]{8}$/.test(review.digest) &&
    review.ranWhileStaged === false && review.listedWhileStaged.indexOf('header-probe') < 0,
    JSON.stringify({ size: review.size, digest: review.digest, ran: review.ranWhileStaged }));
  check('nothing imported is enabled by that act — it lands switched off, with its source recorded, ' +
    'and its body still has not run',
    review.committed.ok === true && review.committed.enabled === false &&
    review.enabledByImport === false && review.stateAfterImport === 'listed' &&
    review.ranAfterImport === false && review.sourceRecorded === 'paste' &&
    review.stagedCleared === true,
    JSON.stringify(review.committed) + ' ' + JSON.stringify({ enabled: review.enabledByImport, ran: review.ranAfterImport }));

  const clash = await ev(() => {
    const A = window.GigaHack.addons;
    const r = A.stage({ text: window.__FIX.header, from: 'paste' });
    A.discard();
    return { r: r, at: A.pathOf('header-probe') };
  });
  check('a second file claiming an id that is taken is refused, and the message names where the first ' +
    'one is so it can be found',
    clash.r.ok === false && clash.r.id === 'header-probe' &&
    clash.r.why.indexOf(clash.at) > -1,
    JSON.stringify(clash));

  const tooBig = await ev(() => {
    const A = window.GigaHack.addons;
    let big = 'GigaHack.addon(function (api) {});\n';
    while (big.length < 300000) big += '// padding padding padding padding padding padding\n';
    const r = A.stage({ text: big, from: 'paste', name: 'too-big' });
    A.discard();
    return { r: r, len: big.length };
  });
  check('a source over the ceiling is refused with both numbers in the message, so the ceiling is not ' +
    'a mystery the user has to guess at',
    tooBig.r.ok === false && tooBig.r.why.indexOf(String(tooBig.len)) > -1 &&
    tooBig.r.why.indexOf('262144') > -1,
    JSON.stringify(tooBig.r).slice(0, 260));

  const bad = await ev(() => {
    const A = window.GigaHack.addons;
    const r = A.stage({ text: window.__FIX.broken, from: 'paste', name: 'broken' });
    A.discard();
    return { r: r, listed: A.list().map(x => x.id).join(',') };
  });
  check('a file that does not parse is refused at the review with its line, and compiling it to find ' +
    'that out never calls it',
    bad.r.ok === false && /does not parse/.test(bad.r.why) &&
    bad.listed.indexOf('broken') < 0,
    JSON.stringify(bad.r).slice(0, 240));

  /* --- the link, through the injected transport ------------------------- */
  const link = await ev(async () => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    function once(fn) {
      return new Promise(function (resolve) { fn(resolve); });
    }

    /* An HTML error page with a 200, which is the common case and the one a
       status check alone would wave through. */
    let restore = G.net._use(function (url, done) {
      done(null, { status: 200, body: window.__FIX.html, via: 'injected', url: url });
    });
    out.html = await once(function (r) { A.importLink('https://example.invalid/a.js', r); });
    out.htmlStaged = A.staged() !== null;
    restore();

    /* A 404 that also sends a page. */
    restore = G.net._use(function (url, done) {
      done(null, { status: 404, body: 'Not Found\nnothing here', via: 'injected', url: url });
    });
    out.notFound = await once(function (r) { A.importLink('https://example.invalid/b.js', r); });
    restore();

    /* A redirect the transport already followed: what is recorded must be
       where it ENDED, not where it was pointed. */
    restore = G.net._use(function (url, done) {
      done(null, { status: 200, body: window.__FIX.quarantine, via: 'injected',
        url: 'https://elsewhere.invalid/moved/quarantine-me.js' });
    });
    out.redirect = await once(function (r) { A.importLink('https://example.invalid/c.js', r); });
    out.redirectHost = A.staged() ? A.staged().host : null;
    out.redirectUrl = A.staged() ? A.staged().url : null;
    A.discard();
    restore();

    /* Over the ceiling, from the far end. */
    restore = G.net._use(function (url, done) {
      let big = '// x\n';
      while (big.length < 300000) big += '// padding padding padding padding\n';
      done(null, { status: 200, body: big, via: 'injected', url: url });
    });
    out.big = await once(function (r) { A.importLink('https://example.invalid/d.js', r); });
    restore();

    /* Never answers. The timeout is the module's, not the transport's. */
    G.store.cfgSet('addons.fetchTimeoutMs', 40);
    restore = G.net._use(function () { /* silence */ });
    out.timeout = await once(function (r) { A.importLink('https://example.invalid/e.js', r); });
    restore();
    G.store.cfgSet('addons.fetchTimeoutMs', 20000);

    /* No transport at all. */
    restore = G.net._use(function (url, done) { done(new Error('no transport'), null); });
    out.noScheme = await once(function (r) { A.importLink('ftp://example.invalid/f.js', r); });
    restore();

    out.describe = A.describeLink('https://example.invalid/g.js');
    out.describeNonHttp = A.describeLink('file:///tmp/x.js');
    out.listed = A.list().map(x => x.id).join(',');
    return out;
  });
  check('an import from a link that returns HTML is refused with the first line quoted, and nothing ' +
    'is put on review',
    link.html.ok === false && /markup, not JavaScript/.test(link.html.why) &&
    link.html.why.indexOf('<!DOCTYPE html>') > -1 && link.htmlStaged === false,
    JSON.stringify(link.html).slice(0, 240));
  check('a 404 names the host, the status and the first line of whatever it sent instead',
    link.notFound.ok === false && /example\.invalid/.test(link.notFound.why) &&
    /404/.test(link.notFound.why) && /Not Found/.test(link.notFound.why),
    JSON.stringify(link.notFound).slice(0, 240));
  check('a redirect is recorded where it ended rather than where it was pointed, so the host on the ' +
    'review is the host that actually answered',
    link.redirect.ok === true && link.redirectHost === 'elsewhere.invalid' &&
    /moved/.test(String(link.redirectUrl)),
    JSON.stringify({ host: link.redirectHost, url: link.redirectUrl }));
  check('a body over the ceiling from the far end is refused with the number, before it is looked at',
    link.big.ok === false && /262144/.test(link.big.why), JSON.stringify(link.big).slice(0, 200));
  check('a transport that never answers is a refusal that says so, not a button that stays pressed',
    link.timeout.ok === false && /no answer from/.test(link.timeout.why),
    JSON.stringify(link.timeout).slice(0, 200));
  check('only http and https are fetched, and the refusal names the source that does read a local file',
    link.noScheme.ok === false && /only http and https/.test(link.noScheme.why) &&
    /file source/.test(link.describeNonHttp),
    JSON.stringify(link.noScheme).slice(0, 200));
  check('the panel names the host and the transport before a request is sent, because it is the ' +
    'player\'s machine that makes it',
    /example\.invalid/.test(link.describe) &&
    /(node-https|fetch|xhr|no transport)/.test(link.describe),
    link.describe.slice(0, 200));
  check('and none of the six refused fetches left anything in the list',
    link.listed.split(',').filter(x => x && x !== 'header-probe').length === 0, link.listed);

  const recheck = await ev(async () => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    function once(fn) { return new Promise(function (resolve) { fn(resolve); }); }

    /* Give the listed addon a link to have come from. */
    let restore = G.net._use(function (url, done) {
      done(null, { status: 200, body: window.__FIX.quarantine, via: 'injected', url: url });
    });
    await once(function (r) { A.importLink('https://example.invalid/quarantine-me.js', r); });
    A.commit();
    restore();

    restore = G.net._use(function (url, done) {
      done(null, { status: 200, body: window.__FIX.quarantine, via: 'injected', url: url });
    });
    out.same = await once(function (r) { A.recheck('quarantine-me', r); });
    restore();

    restore = G.net._use(function (url, done) {
      done(null, { status: 200, body: window.__FIX.quarantine + '\n// changed', via: 'injected', url: url });
    });
    out.changed = await once(function (r) { A.recheck('quarantine-me', r); });
    restore();

    restore = G.net._use(function (url, done) { done(new Error('the host is not there'), null); });
    out.gone = await once(function (r) { A.recheck('quarantine-me', r); });
    restore();

    out.stillOff = A.get('quarantine-me').enabled === false;
    /* The digest of the copy that is HERE, after being told the source moved.
       "Still switched off" is not enough on its own: a re-check that quietly
       replaced the file would have left it switched off too. */
    out.digestAfter = A.get('quarantine-me').digest;
    out.digestOfOriginal = A.digest(window.__FIX.quarantine);
    A.discard();
    return out;
  });
  check('"check the source again" answers unchanged, changed or unreachable and installs nothing on ' +
    'any of the three — the copy here is byte-identical afterwards',
    recheck.same.state === 'unchanged' && recheck.changed.state === 'changed' &&
    recheck.gone.state === 'unreachable' && recheck.stillOff === true &&
    recheck.digestAfter === recheck.digestOfOriginal,
    JSON.stringify({ same: recheck.same.state, changed: recheck.changed.state,
      gone: recheck.gone.state, digest: recheck.digestAfter, was: recheck.digestOfOriginal }));

  /* =======================================================================
     3. RUNNING ONE — THE TEMPLATE, END TO END
     ==================================================================== */
  const tpl = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    out.source = A.template();
    out.staged = A.stage({ text: out.source, from: 'template' });
    out.committed = A.commit();
    out.offAfterImport = A.get('hello-addon').enabled === false;
    out.panelBeforeEnable = G.ui.panelNames('world').indexOf('Hello');
    out.enabled = A.enable('hello-addon');
    out.panelAfterEnable = G.ui.panelNames('world').indexOf('Hello');
    out.command = typeof G.api.hello === 'function' ? G.api.hello() : null;
    out.hotkeys = G.ui.hotkeyList().map(d => d.id).filter(i => i.indexOf('addon:hello-addon:') === 0);
    out.help = G.api.help().filter(l => /hello/i.test(l));
    return out;
  });
  check('the template the panel hands the user is a working addon: imported, committed and enabled ' +
    'through the real path, it registers a panel, a hotkey and two console calls',
    tpl.staged.ok === true && tpl.committed.ok === true && tpl.offAfterImport === true &&
    tpl.panelBeforeEnable === -1 && tpl.panelAfterEnable > -1 &&
    tpl.enabled.ok === true && tpl.hotkeys.length === 1 && tpl.help.length === 2,
    JSON.stringify({ enabled: tpl.enabled, panel: tpl.panelAfterEnable, keys: tpl.hotkeys }));
  check('and its console call answers with real state read through the api it was handed',
    !!tpl.command && tpl.command.addon === 'hello-addon' && typeof tpl.command.gold === 'number',
    JSON.stringify(tpl.command));

  const timing = await ev(() => {
    const r = window.GigaHack.addons.get('hello-addon');
    return { ms: r.ms, type: typeof r.ms, finite: isFinite(r.ms) };
  });
  check('and how long it took is a number Debug → Addons can print, not the difference between two ' +
    'wall clocks',
    timing.type === 'number' && timing.finite === true && timing.ms >= 0,
    JSON.stringify(timing));

  const tplPanel = await panelText('world', 'Hello');
  check('and the panel it registered renders, with the addon\'s own values in it',
    tplPanel.indexOf('hello-addon') > -1 && /opened/.test(tplPanel) && /gold/.test(tplPanel) &&
    tplPanel.trim().length > 20,
    tplPanel.slice(0, 160));

  const tplWrite = await ev(() => {
    const G = window.GigaHack;
    const r = G.api.helloSetVar(7, 4242);
    return { r: r, read: $gameVariables.value(7) };
  });
  check('a write an addon makes through api.game is read back and reported the way every other write ' +
    'in the menu is',
    tplWrite.r && tplWrite.r.ok === true && tplWrite.r.got === 4242 && tplWrite.read === 4242 &&
    Object.prototype.hasOwnProperty.call(tplWrite.r, 'culprits'),
    JSON.stringify(tplWrite));
  await ev(() => { window.GigaHack.undo.pop(); });

  /* A write that STICKS proves the happy half. The half that matters is a
     write that does not: `culprits` and `message` are two of the five fields
     the api table advertises, and on the path taken whenever GigaHack_Vars is
     loaded — which is almost always — they used to be an empty array and a
     canned sentence, while $.compat had already named a plugin one call
     deeper and written the reason. A plugin that eats the write is simulated
     by shadowing the setter on the live object, which is what a badly behaved
     plugin's alias amounts to from here. */
  const guarded = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    A.stage({ text: window.__FIX.gameProbe, from: 'paste' }); A.commit();
    A.enable('game-probe');
    const api = window.__gameApi;

    const realSet = $gameVariables.setValue;
    $gameVariables.setValue = function () { };
    let v;
    try { v = api.setVar(9, 777); } finally { delete $gameVariables.setValue; }
    out.varRestored = $gameVariables.setValue === realSet;
    out.varRes = { ok: v.ok, got: v.got, want: v.want, message: v.message };
    out.varCulprits = v.culprits.map(c => c.id).join(',');
    out.compatMessage = G.compat.degradedWhy('vars.set');
    out.compatCulprits = G.compat.likelyCulprits('vars.set').map(c => c.id).join(',');
    G.compat.clearDegraded('vars.set');

    const realGain = $gameParty.gainGold;
    const goldBefore = $gameParty.gold();
    $gameParty.gainGold = function () { };
    let g;
    try { g = api.setGold(goldBefore + 4321); } finally { delete $gameParty.gainGold; }
    out.goldRestored = $gameParty.gainGold === realGain;
    out.goldRes = { ok: g.ok, got: g.got, want: g.want, message: g.message };
    out.goldUnchanged = $gameParty.gold() === goldBefore;
    G.compat.clearDegraded('inv.gold');

    A.remove('game-probe');
    delete window.__gameApi;
    return out;
  });
  check('a write api.game could not make reports what $.compat named, not an empty culprit list and a ' +
    'stand-in sentence — the addon that prints res.culprits is told what the log was told',
    guarded.varRes.ok === false && guarded.varRes.got !== 777 && guarded.varRes.want === 777 &&
    guarded.varRes.message.length > 0 &&
    guarded.varRes.message === guarded.compatMessage &&
    /read back/.test(guarded.varRes.message) &&
    guarded.varCulprits === guarded.compatCulprits &&
    guarded.varRestored === true,
    JSON.stringify({ res: guarded.varRes, culprits: guarded.varCulprits,
      compat: guarded.compatCulprits }).slice(0, 300));
  check('and setGold reports the write it did not make: its module hands back a result object, so the ' +
    'truthiness of it was never the answer',
    guarded.goldRes.ok === false && guarded.goldUnchanged === true &&
    guarded.goldRes.message.length > 0 && guarded.goldRestored === true,
    JSON.stringify(guarded.goldRes).slice(0, 260));

  /* =======================================================================
     RE-IMPORTING OVER ONE THAT IS RUNNING

     "Check the source again" reports changed and stages the new text with
     replace:true, and the button under it says "add it, switched off". The
     record it lands on is the one v1's registrations are hanging from.
     ==================================================================== */
  const reimport = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    A.stage({ text: window.__FIX.liveV1, from: 'paste' }); A.commit();
    A.enable('probe-live');
    out.v1 = {
      command: typeof G.api.probeLive === 'function' ? G.api.probeLive() : null,
      hotkey: G.ui.hotkeyList().some(d => d.id === 'addon:probe-live:go'),
      panel: G.ui.panelNames('world').indexOf('Probe Live') > -1
    };

    const staged = A.stage({ text: window.__FIX.liveV2, from: 'link',
      url: 'https://example.invalid/probe-live.js', replace: true });
    const committed = A.commit();
    out.staged = staged.ok;
    out.committed = committed.ok;
    out.offAfterImport = A.get('probe-live').enabled === false;
    out.afterImport = {
      command: typeof G.api.probeLive === 'function' ? G.api.probeLive() : null,
      hotkey: G.ui.hotkeyList().some(d => d.id === 'addon:probe-live:go'),
      panel: G.ui.panelNames('world').indexOf('Probe Live') > -1
    };

    window.__probeLiveMap = 0;
    A.enable('probe-live');
    A._fire('map', 1);
    const rec = A.get('probe-live');
    out.after = {
      command: G.api.probeLive(),
      hotkeys: G.ui.hotkeyList().filter(d => d.id === 'addon:probe-live:go').length,
      panels: G.ui.panelNames('world').filter(n => n === 'Probe Live').length,
      events: rec.reg.events.length,
      fired: window.__probeLiveMap
    };
    A.remove('probe-live');
    return out;
  });
  check('importing over an addon that is running takes the running one down first, so the row that ' +
    'reads "off" is telling the truth: its hotkey and its console call are gone with it',
    reimport.v1.command === 'v1' && reimport.v1.hotkey === true && reimport.v1.panel === true &&
    reimport.committed === true && reimport.offAfterImport === true &&
    reimport.afterImport.command === null && reimport.afterImport.hotkey === false &&
    reimport.afterImport.panel === false,
    JSON.stringify({ v1: reimport.v1, after: reimport.afterImport }));
  check('and switching the new one on registers one of each rather than a second set, so one event ' +
    'fires the handler once',
    reimport.after.command === 'v2' && reimport.after.hotkeys === 1 &&
    reimport.after.panels === 1 && reimport.after.events === 1 && reimport.after.fired === 1,
    JSON.stringify(reimport.after));

  /* =======================================================================
     A PANEL NAME IS NOT FREE JUST BECAUSE REGISTERING SUCCEEDS

     U.panel replaces by name and teardown removes by name, so an addon
     naming a panel the tab already has does not add one — it takes one.
     ==================================================================== */
  const thief = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const before = G.ui.panelNames('settings').slice();
    A.stage({ text: window.__FIX.thief, from: 'paste' }); A.commit();
    window.__thiefTook = 'not called';
    window.__thiefOwn = 'not called';
    const logMark = G.logHistory().length;
    const enabled = A.enable('panel-thief');
    const out = {
      before: before,
      enabled: enabled.ok,
      took: window.__thiefTook,
      own: window.__thiefOwn,
      registered: A.get('panel-thief').registered,
      onEnable: G.ui.panelNames('settings').slice(),
      log: G.logHistory().slice(logMark).map(e => e.msg).join(' | ')
    };
    A.disable('panel-thief');
    out.onDisable = G.ui.panelNames('settings').slice();
    A.remove('panel-thief');
    out.onRemove = G.ui.panelNames('settings').slice();
    return out;
  });
  check('an addon cannot register a panel under a name its tab already uses, and the refusal names ' +
    'the tab, the name and a free one — the way a taken console name is already refused',
    thief.took === null && thief.own === 'Panel Thief' && thief.registered === 1 &&
    /already has a panel called "Addons"/.test(thief.log) &&
    /"Addons \(panel-thief\)" is free/.test(thief.log),
    JSON.stringify({ took: thief.took, own: thief.own, log: thief.log.slice(-220) }));
  check('so GigaHack\'s own Addons panel is still there while the addon is on, and is still there ' +
    'after it has been switched off — which is where it used to be deleted',
    thief.onEnable.indexOf('Addons') > -1 && thief.onDisable.indexOf('Addons') > -1 &&
    thief.onRemove.join(',') === thief.before.join(','),
    JSON.stringify({ enable: thief.onEnable, disable: thief.onDisable }));

  /* =======================================================================
     AN EVENT HANDLER THAT THROWS IS STOPPED AND NAMED

     `frame` runs on the frame clock, and $.safe logs on every call. Its own
     protection was the flood: one broken handler overwrote the whole log
     ring, and the log is what a bug report carries.
     ==================================================================== */
  const handler = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    A.stage({ text: window.__FIX.badHandler, from: 'paste' }); A.commit();
    A.enable('bad-handler');
    window.__badHandlerCalls = 0;
    const logBefore = G.logHistory().length;
    for (let i = 0; i < 200; i++) A._fire('frame', i);
    const rec = A.get('bad-handler');
    return {
      calls: window.__badHandlerCalls,
      logLines: G.logHistory().length - logBefore,
      evt: rec.eventThrow ? rec.eventThrow.evt : null,
      line: rec.eventThrow ? rec.eventThrow.line : null,
      count: rec.eventThrow ? rec.eventThrow.count : 0,
      stopped: rec.eventThrow ? rec.eventThrow.stopped : false,
      message: rec.eventThrow ? rec.eventThrow.message : '',
      state: rec.state,
      enabled: rec.enabled,
      row: A.list().filter(r => r.id === 'bad-handler')[0].eventThrow,
      bias: A.lineBias()
    };
  });
  check('an addon whose event handler throws is stopped after a stated number of throws and named ' +
    'with its line, rather than being called sixty times a second forever',
    handler.calls === 8 && handler.count === 8 && handler.stopped === true &&
    handler.evt === 'frame' && handler.line === 9 &&
    /deliberate test error from a handler/.test(handler.message) &&
    handler.enabled === true && handler.state === 'loaded',
    JSON.stringify({ calls: handler.calls, line: handler.line, bias: handler.bias,
      stopped: handler.stopped }));
  check('and the log carries two lines about it and not two hundred — the ring the bug report is cut ' +
    'from is still holding everything else',
    handler.logLines <= 4 && handler.logLines >= 1, String(handler.logLines) + ' log line(s)');
  check('and A.list() carries it, so the panel stops calling that addon healthy',
    !!handler.row && handler.row.evt === 'frame' && handler.row.stopped === true,
    JSON.stringify(handler.row));

  const threwPanel = await panelText('debug', 'Addons');
  check('Debug → Addons names the handler that threw instead of printing "Nothing has thrown"',
    /bad-handler: on\("frame"\)/.test(threwPanel) && !/Nothing has thrown/.test(threwPanel),
    threwPanel.indexOf('bad-handler') > -1 ? 'named' : threwPanel.slice(0, 200));

  await ev(() => { window.GigaHack.addons.remove('bad-handler'); });

  /* =======================================================================
     4. ONE FAILURE IS ONE FAILURE
     ==================================================================== */
  const crash = await ev(() => {
    const A = window.GigaHack.addons;
    window.__throwerRan = false;
    window.__survivorRan = false;
    A.stage({ text: window.__FIX.thrower, from: 'paste' }); A.commit();
    A.stage({ text: window.__FIX.survivor, from: 'paste' }); A.commit();
    const a = A.enable('thrower');
    const b = A.enable('zz-survivor');
    const rec = A.get('thrower');
    return {
      a: a, b: b,
      throwerRan: window.__throwerRan === true,
      survivorRan: window.__survivorRan === true,
      state: rec.state, enabled: rec.enabled, line: rec.line, error: rec.error,
      survivorCommand: typeof window.GigaHack.api.survivorProbe === 'function',
      bias: A.lineBias()
    };
  });
  check('an addon that throws is disabled, keeps its line number, and does not stop the next addon loading',
    crash.a.ok === false && crash.state === 'failed' && crash.enabled === false &&
    crash.line === 8 && /deliberate test error from an addon/.test(crash.error) &&
    crash.throwerRan === true && crash.survivorRan === true &&
    crash.b.ok === true && crash.survivorCommand === true,
    JSON.stringify({ line: crash.line, bias: crash.bias, error: crash.error, b: crash.b }));

  /* The panel switches one on at a time. The load pass runs them one after
     another, which is the case where a throw can take the rest of the list
     with it — and the addon that throws is the one that was fine last launch,
     so it is still switched on in the index when the pass reaches it. */
  const pass = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const idx = G.store.read('addons.json', {});
    idx['thrower'].enabled = true;
    G.store.write('addons.json', idx, true);
    window.__throwerRan = false;
    window.__survivorRan = false;
    A.load('with a thrower switched on in the index');
    return {
      order: A.list().map(r => r.id).join(','),
      thrower: A.get('thrower').state,
      throwerLine: A.get('thrower').line,
      survivor: A.get('zz-survivor').state,
      survivorCommand: typeof G.api.survivorProbe === 'function',
      ranBoth: window.__throwerRan === true && window.__survivorRan === true
    };
  });
  check('and every addon after it in the load pass still loads — one failure is one failure, not the ' +
    'end of the list',
    pass.thrower === 'failed' && pass.throwerLine === 8 &&
    pass.survivor === 'loaded' && pass.survivorCommand === true && pass.ranBoth === true &&
    pass.order.indexOf('thrower') < pass.order.indexOf('zz-survivor'),
    JSON.stringify(pass));

  const inert = await ev(() => {
    const A = window.GigaHack.addons;
    window.__inertRan = false;
    A.stage({ text: window.__FIX.inert, from: 'paste' }); A.commit();
    const r = A.enable('inert');
    const rec = A.get('inert');
    return { r: r, ran: window.__inertRan === true, state: rec.state, registered: rec.registered };
  });
  check('an addon that loads and registers nothing is said out loud as inert rather than counted as ' +
    'a success',
    inert.r.ok === true && inert.ran === true && inert.state === 'inert',
    JSON.stringify(inert));

  /* =======================================================================
     5. WHAT DISABLE TAKES BACK, AND WHAT IT CANNOT
     ==================================================================== */
  const revoke = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    A.stage({ text: window.__FIX.everything, from: 'paste' }); A.commit();
    out.enable = A.enable('everything');

    const dashBefore = Game_Player.prototype.isDashing;
    out.on = {
      panel: G.ui.panelNames('world').indexOf('Everything') > -1,
      hotkey: G.ui.hotkeyList().some(d => d.id === 'addon:everything:go'),
      command: typeof G.api.everythingProbe === 'function',
      hookInstalled: !!(G.hooks['Game_Player.isDashing (addon:everything)'] &&
        G.hooks['Game_Player.isDashing (addon:everything)'].installed),
      profileListed: G.profile.list().some(p => p.id === 'addon-check-profile')
    };
    /* The alias is live: the addon's replacement answers, not the original. */
    window.__dashWrapped = false;
    out.on.dashing = $gamePlayer.isDashing();
    out.on.dashWrapped = window.__dashWrapped === true;

    /* The event subscription fires. */
    window.__everythingMap = null;
    A._fire('map', 4242);
    out.on.event = window.__everythingMap === 4242;

    const off = A.disable('everything');
    out.off = {
      result: off,
      panel: G.ui.panelNames('world').indexOf('Everything') > -1,
      hotkey: G.ui.hotkeyList().some(d => d.id === 'addon:everything:go'),
      command: typeof G.api.everythingProbe === 'function',
      hookStillInstalled: !!(G.hooks['Game_Player.isDashing (addon:everything)'] &&
        G.hooks['Game_Player.isDashing (addon:everything)'].installed),
      /* Still the wrapper, and still the outermost function on the method. */
      stillTheWrapper: Game_Player.prototype.isDashing === dashBefore,
      profileStillListed: G.profile.list().some(p => p.id === 'addon-check-profile')
    };
    window.__dashWrapped = false;
    window.__everythingMap = null;
    A._fire('map', 99);
    out.off.event = window.__everythingMap === null;
    /* Calling it is the whole assertion. A flag that was never given the
       chance to be set proves nothing at all, and a pass-through that is never
       driven is a claim rather than a check. */
    out.off.dashing = $gamePlayer.isDashing();
    out.off.dashWrapped = window.__dashWrapped === true;

    /* And back on: the same wrapper starts answering again without a second
       install, which is the whole reason it is a wrapper. */
    A.enable('everything');
    window.__dashWrapped = false;
    $gamePlayer.isDashing();
    out.again = {
      dashWrapped: window.__dashWrapped === true,
      hookCount: Object.keys(G.hooks).filter(n => n.indexOf('(addon:everything)') > -1).length,
      stillTheWrapper: Game_Player.prototype.isDashing === dashBefore
    };
    A.disable('everything');
    return out;
  });
  check('disabling an addon removes its panel, its hotkey, its console call and its event subscriptions',
    revoke.on.panel && revoke.on.hotkey && revoke.on.command && revoke.on.event &&
    revoke.off.panel === false && revoke.off.hotkey === false &&
    revoke.off.command === false && revoke.off.event === true,
    JSON.stringify({ on: revoke.on, off: revoke.off }));
  check('and leaves its alias installed as a pass-through — the wrapper is still the outermost ' +
    'function on the method, and calling the method now reaches the original',
    revoke.on.hookInstalled === true && revoke.on.dashWrapped === true &&
    revoke.on.dashing === true &&
    revoke.off.hookStillInstalled === true && revoke.off.stillTheWrapper === true &&
    revoke.off.dashWrapped === false && revoke.off.dashing !== true,
    JSON.stringify(revoke.off));
  check('so switching it back on makes the same wrapper live again rather than installing a second one',
    revoke.again.dashWrapped === true && revoke.again.hookCount === 1 &&
    revoke.again.stillTheWrapper === true,
    JSON.stringify(revoke.again));
  check('a profile an addon registers cannot be taken back either, and stays listed after the addon ' +
    'is switched off',
    revoke.on.profileListed === true && revoke.off.profileStillListed === true,
    JSON.stringify({ on: revoke.on.profileListed, off: revoke.off.profileStillListed }));

  const says = await panelText('settings', 'Addons');
  check('the panel says which two things a disable cannot take back, and why, where the addon that ' +
    'did them is selected',
    /alias cannot be pulled out of a chain/.test(says) || /pass-through/.test(says),
    says.slice(0, 200));
  check('and the reasons are in the panel rather than only in a comment',
    SRC.indexOf('they stay installed until a ') > -1 &&
    SRC.indexOf('A profile applies from the NEXT launch.') > -1);

  /* =======================================================================
     6. THE CRASH GUARD AND SAFE MODE
     ==================================================================== */
  const guard = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    /* What the marker holds while an addon is being evaluated. It is written
       before and cleared after, so the only way to see it is from inside. */
    window.__markerSeen = null;
    A.stage({
      text: '/*:\n * @gigahack-addon\n * @id marker-probe\n */\n' +
        'GigaHack.addon(function (api) { window.__markerSeen = GigaHack.store.read("addons-loading.json", null); });',
      from: 'paste'
    });
    A.commit();
    A.enable('marker-probe');
    out.duringLoad = window.__markerSeen;
    out.afterLoad = G.store.read('addons-loading.json', null);
    A.remove('marker-probe');
    return out;
  });
  check('the crash guard names the addon that is being evaluated while it is being evaluated, and ' +
    'the marker is gone once it has returned',
    guard.duringLoad && guard.duringLoad.id === 'marker-probe' && guard.afterLoad === null,
    JSON.stringify(guard));

  /* Switching one on by hand is one door into evaluate(). The load pass is the
     other, and it is the one that runs while the game is starting — which is
     the only time a crash can leave a marker worth reading. */
  const guardPass = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    A.stage({
      text: '/*:\n * @gigahack-addon\n * @id marker-pass\n */\n' +
        'GigaHack.addon(function (api) { window.__markerPass = ' +
        'GigaHack.store.read("addons-loading.json", null); });',
      from: 'paste'
    });
    A.commit();
    A.enable('marker-pass');
    window.__markerPass = null;
    A.load('a whole pass');
    const out = {
      during: window.__markerPass,
      after: G.store.read('addons-loading.json', null)
    };
    A.remove('marker-pass');
    return out;
  });
  check('and the load pass writes it for every addon it evaluates, which is the pass a crash actually ' +
    'happens during',
    guardPass.during && guardPass.during.id === 'marker-pass' && guardPass.after === null,
    JSON.stringify(guardPass));

  const quar = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    window.__quarantineRan = false;
    A.enable('quarantine-me');
    out.runsNormally = window.__quarantineRan === true;

    /* Leave the marker behind the way a game that stopped mid-load would. */
    window.__quarantineRan = false;
    G.store.write('addons-loading.json', { id: 'quarantine-me', at: 'pretend' }, true);
    A.load('after a pretend crash');
    const rec = A.get('quarantine-me');
    out.ranAfterCrash = window.__quarantineRan === true;
    out.state = rec.state;
    out.enabled = rec.enabled;
    out.named = A.quarantinedId();
    out.markerCleared = G.store.read('addons-loading.json', null) === null;
    /* The others still loaded. */
    out.othersLoaded = A.list().filter(r => r.state === 'loaded').map(r => r.id).join(',');
    return out;
  });
  check('an addon quarantined by the crash marker is named and not run, while everything else loads ' +
    'as normal',
    quar.runsNormally === true && quar.ranAfterCrash === false &&
    quar.state === 'quarantined' && quar.enabled === false &&
    quar.named === 'quarantine-me' && quar.markerCleared === true &&
    quar.othersLoaded.indexOf('hello-addon') > -1,
    JSON.stringify(quar));

  const quarPanel = await panelText('settings', 'Addons');
  check('and the panel says it was loading when the game last stopped, rather than showing it as ' +
    'simply switched off',
    /loading when the game last stopped/.test(quarPanel), quarPanel.length > 20 ? 'panel built' : quarPanel);

  const safe = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    A.armSafeMode(true);
    out.armed = A.safeModeArmed();
    window.__quarantineRan = false;
    const beforeCommands = typeof G.api.hello === 'function';
    A.load('safe mode check');
    out.beforeCommands = beforeCommands;
    out.afterCommands = typeof G.api.hello === 'function';
    out.states = A.list().map(r => r.id + '=' + r.state).join(',');
    out.reason = A.safeModeReason();
    out.disarmedItself = A.safeModeArmed() === false;
    /* And the next pass is normal again. */
    A.load('back to normal');
    out.backOn = typeof G.api.hello === 'function';
    out.reasonCleared = A.safeModeReason() === '';
    return out;
  });
  check('safe mode skips every addon for one launch, says which reason skipped them, and clears ' +
    'itself so the launch after is normal',
    safe.armed === true && safe.beforeCommands === true && safe.afterCommands === false &&
    /=skipped/.test(safe.states) && /switch was on/.test(safe.reason) &&
    safe.disarmedItself === true && safe.backOn === true && safe.reasonCleared === true,
    JSON.stringify(safe).slice(0, 300));

  const heldKey = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const key = A.safeModeKey();
    A._setHeld(key, true);
    A.load('held key check');
    const out = {
      key: key,
      reason: A.safeModeReason(),
      commands: typeof G.api.hello === 'function'
    };
    A._setHeld(key, false);
    A.load('key released');
    out.backOn = typeof G.api.hello === 'function';
    return out;
  });
  check('and holding the panic-hide key while addons load does the same thing, and names the key it saw',
    /held while addons loaded/.test(heldKey.reason) && heldKey.commands === false &&
    heldKey.backOn === true,
    JSON.stringify(heldKey));

  /* The two guards meeting. The documented recovery from an addon that hangs
     the game is "skip every addon next launch" — so the launch that has to
     carry the quarantine through is the one that runs nothing, and it is the
     one that used to eat the marker and leave enabled:true behind it. Three
     launches, because the defect only shows on the third. */
  const safeQuar = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    window.__quarantineRan = false;
    A.enable('quarantine-me');
    out.backOn = A.get('quarantine-me').enabled === true && window.__quarantineRan === true;

    /* Launch 2: the marker from the hang is there, and so is the switch. */
    G.store.write('addons-loading.json', { id: 'quarantine-me', at: 'pretend' }, true);
    A.armSafeMode(true);
    window.__quarantineRan = false;
    A.load('safe mode over a crash marker');
    const rec = A.get('quarantine-me');
    out.ranInSafeMode = window.__quarantineRan === true;
    out.state = rec.state;
    out.enabled = rec.enabled;
    out.persisted = !!((G.store.read('addons.json', {})['quarantine-me'] || {}).enabled);
    out.markerCleared = G.store.read('addons-loading.json', null) === null;
    out.othersSkipped = A.list().filter(r => r.state === 'skipped').length > 0;

    /* Launch 3: an ordinary one. The addon that hung the game must still not
       run, which is the whole point of the marker. */
    window.__quarantineRan = false;
    A.load('the launch after safe mode');
    out.ranNextLaunch = window.__quarantineRan === true;
    out.stateNextLaunch = A.get('quarantine-me').state;
    return out;
  });
  check('safe mode applies the quarantine instead of consuming it: the addon that was loading when ' +
    'the game stopped is switched off in the index, and the launch after safe mode still does not run it',
    safeQuar.backOn === true && safeQuar.ranInSafeMode === false &&
    safeQuar.state === 'quarantined' && safeQuar.enabled === false &&
    safeQuar.persisted === false && safeQuar.markerCleared === true &&
    safeQuar.othersSkipped === true &&
    safeQuar.ranNextLaunch === false && safeQuar.stateNextLaunch === 'listed',
    JSON.stringify(safeQuar));

  /* And a safe-mode launch with NO marker, which is the ordinary shape of it:
     the name the marker gave earlier is still on the panel, and the panel has
     to say what is true of the record now rather than repeating it. */
  const skipped = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    G.store.remove('addons-loading.json');
    A.enable('quarantine-me');
    A.armSafeMode(true);
    A.load('safe mode with nothing to quarantine');
    return {
      reason: A.safeModeReason(),
      state: A.get('quarantine-me').state,
      named: A.quarantinedId()
    };
  });
  const safePanel = await panelText('settings', 'Addons');
  check('and the panel reads the record rather than the name the marker gave, so an addon that was ' +
    'skipped is not reported as one that was quarantined',
    skipped.state === 'skipped' && skipped.named === 'quarantine-me' &&
    /every addon was skipped/.test(safePanel) &&
    /the quarantine is not still in force/.test(safePanel) &&
    !/is quarantined and has not been run this launch/.test(safePanel),
    JSON.stringify(skipped));

  /* The other half of the same variable: it has to describe THIS pass. The
     player reads the reason, fixes the file, switches it back on and then
     presses "rescan the folder", which is a load pass like any other. */
  const rescanQuar = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    A.enable('quarantine-me');
    G.store.write('addons-loading.json', { id: 'quarantine-me', at: 'pretend' }, true);
    A.load('a second pretend crash');
    out.quarantined = A.get('quarantine-me').state === 'quarantined';

    window.__quarantineRan = false;
    const on = A.enable('quarantine-me');
    out.switchedOn = on.ok === true && window.__quarantineRan === true;

    const logMark = G.logHistory().length;
    window.__quarantineRan = false;
    out.rescan = A.rescan();
    const rec = A.get('quarantine-me');
    out.after = { state: rec.state, enabled: rec.enabled, ran: window.__quarantineRan === true };
    out.saidItAgain = /was loading when the game last stopped/.test(
      G.logHistory().slice(logMark).map(e => e.msg).join(' | '));
    out.stillNamed = A.quarantinedId();
    return out;
  });
  /* 'inert' and not 'loaded' because this fixture registers nothing — what
     matters is that it RAN and is still on, which "quarantined" is neither. */
  check('a rescan after the addon has been repaired and switched back on leaves it on: the quarantine ' +
    'describes the pass that read the marker, not every pass for the rest of the session',
    rescanQuar.quarantined === true && rescanQuar.switchedOn === true &&
    rescanQuar.after.state === 'inert' && rescanQuar.after.enabled === true &&
    rescanQuar.after.ran === true && rescanQuar.saidItAgain === false,
    JSON.stringify(rescanQuar));
  check('while the name it gave stays on the panel, because "it was loading when the game last ' +
    'stopped" is still true of this launch',
    rescanQuar.stillNamed === 'quarantine-me', String(rescanQuar.stillNamed));

  /* The thrower has been through several load passes by now. It is switched
     off and carrying the error it threw with it, which is a different claim
     from "it threw a second ago" and has to read like one. Driven by clicking
     the row, because selecting one is what a person does. */
  const stale = await ev(() => {
    const G = window.GigaHack;
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'settings';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.settings = 'Addons';
    G.ui.rerender();
    const rows = document.querySelectorAll('#mm-root .mm-tbody .mm-tr');
    let clicked = false;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf('thrower') > -1 &&
          rows[i].textContent.indexOf('zz-survivor') < 0) {
        rows[i].click();
        clicked = true;
        break;
      }
    }
    const rec = G.addons.get('thrower');
    return {
      clicked: clicked,
      state: rec.state,
      hasError: !!rec.error,
      text: document.querySelector('#mm-root .mm-body').textContent
    };
  });
  check('an error an addon threw on an earlier launch is shown as one, not as something that has just ' +
    'happened',
    stale.clicked === true && stale.state === 'listed' && stale.hasError === true &&
    /The last time this ran it stopped/.test(stale.text) &&
    /deliberate test error from an addon/.test(stale.text),
    JSON.stringify({ clicked: stale.clicked, state: stale.state, hasError: stale.hasError }));

  /* =======================================================================
     7. THE API SURFACE IS GENERATED, NOT TRANSCRIBED
     ==================================================================== */
  const surface = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    /* Reach the real api object the factory builds, by having an addon hand
       its own keys back. Nothing else can see it. */
    window.__apiKeys = null;
    A.stage({
      text: '/*:\n * @gigahack-addon\n * @id api-probe\n */\n' +
        'GigaHack.addon(function (api) { window.__apiKeys = Object.keys(api); ' +
        'api.command("apiProbe", function () { return 1; }); });',
      from: 'paste'
    });
    A.commit();
    A.enable('api-probe');
    const keys = window.__apiKeys || [];
    const doc = A.apiSurface().map(r => r.call).join(' ');
    const undocumented = keys.filter(k => doc.indexOf('api.' + k) < 0);
    const documented = [];
    A.apiSurface().forEach(r => {
      const m = r.call.match(/api\.[A-Za-z]+/g) || [];
      m.forEach(x => documented.push(x.slice(4)));
    });
    const missing = documented.filter(k => keys.indexOf(k) < 0);
    A.remove('api-probe');
    return { keys: keys, undocumented: undocumented, missing: missing, rows: A.apiSurface().length };
  });
  check('the API reference is generated from the same table the api object is built against, so every ' +
    'call an addon is handed is documented and nothing documented is absent',
    surface.keys.length > 10 && surface.undocumented.length === 0 && surface.missing.length === 0,
    JSON.stringify({ undocumented: surface.undocumented, missing: surface.missing, keys: surface.keys.length }));

  const events = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    window.__eventProbe = [];
    A.stage({
      text: '/*:\n * @gigahack-addon\n * @id event-probe\n */\n' +
        'GigaHack.addon(function (api) {\n' +
        '    window.__eventProbe.push(["known", api.on("map", function (id) { window.__probeMap = id; })]);\n' +
        '    window.__eventProbe.push(["unknown", api.on("onMapLoaded", function () { window.__probeBogus = true; })]);\n' +
        '});',
      from: 'paste'
    });
    A.commit();
    A.enable('event-probe');
    const rec = A.get('event-probe');
    window.__probeMap = null;
    window.__probeBogus = false;
    A._fire('map', 7);
    A._fire('onMapLoaded', 1);
    const out = {
      known: window.__eventProbe[0] && window.__eventProbe[0][1] !== null,
      unknown: window.__eventProbe[1] ? window.__eventProbe[1][1] : 'no call',
      registered: rec.registered,          /* the raw count, not the sentence */
      mapFired: window.__probeMap === 7,
      bogusFired: window.__probeBogus === true,
      names: A.events().map(e => e.id),
      log: G.logHistory().slice(-14).map(e => e.msg).join(' | ')
    };
    A.remove('event-probe');
    return out;
  });
  check('an addon that subscribes to an event that does not exist is told so, with the eight that do ' +
    'named, and nothing is registered for it',
    events.known === true && events.unknown === null && events.mapFired === true &&
    events.bogusFired === false && events.names.length === 8 &&
    /there is no "onMapLoaded" event/.test(events.log) &&
    /frame, tick, map, battle, message, save, load, menu/.test(events.log) &&
    events.registered === 1,
    JSON.stringify({ unknown: events.unknown, registered: events.registered, names: events.names.length }));

  const debugPanel = await panelText('debug', 'Addons');
  check('Debug → Addons shows the load order, the timings, what each addon registered and the API ' +
    'surface, all in one place',
    /Load order and timings/.test(debugPanel) && /The API an addon is handed/.test(debugPanel) &&
    /hello-addon/.test(debugPanel) && /api\.panel/.test(debugPanel) &&
    debugPanel.trim().length > 20,
    debugPanel.slice(0, 140));
  check('and it names the transport it has for a link and the clipboard it has for a paste, or says ' +
    'which one is missing',
    /network transport/.test(debugPanel) && /clipboard read/.test(debugPanel),
    debugPanel.length > 20 ? 'panel built' : debugPanel);

  const clip = await ev(() => {
    const A = window.GigaHack.addons;
    const real = A.clipboard();
    /* With neither API present the refusal has to name both halves, because
       "no clipboard" alone does not tell anyone what to do instead. */
    const savedNav = navigator.clipboard;
    let forced;
    try {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      forced = A.clipboard();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: savedNav, configurable: true });
    }
    return { real: real, forced: forced, back: A.clipboard().available === real.available };
  });
  check('where the clipboard cannot be read the refusal names both of the two APIs it looked for and ' +
    'points at the paste box instead',
    clip.forced.available === false && /nw\.Clipboard/.test(clip.forced.why) &&
    /navigator\.clipboard\.readText/.test(clip.forced.why) && /paste/i.test(clip.forced.why) &&
    clip.back === true,
    JSON.stringify(clip.forced).slice(0, 260));

  /* =======================================================================
     8. THE PANEL IS LIVE
     ==================================================================== */
  const live = await ev(async () => {
    const G = window.GigaHack, A = G.addons;
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'settings';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.settings = 'Addons';
    G.ui.rerender();
    const rowsNow = () => document.querySelectorAll('#mm-root .mm-tbody .mm-tr').length;
    const out = { before: rowsNow() };

    /* Something else changes the registry while the panel is open. The
       rebuild is held back on purpose for the length of the change, because
       a rebuild would repaint the list by accident and prove nothing: what is
       under test is that the panel catches up WITHOUT one, since a rebuild
       takes the reader's scroll and selection with it. */
    const tbody = document.querySelector('#mm-root .mm-tbody');
    const realRerender = G.ui.rerender;
    G.ui.rerender = function () { };
    try {
      A.stage({ text: window.__FIX.bare, from: 'paste', name: 'live-probe' });
      A.commit();
      out.beforeTick = rowsNow();
      const host = G.ui.getHost();
      host.tickHooks.forEach(fn => fn(1));
      out.afterTick = rowsNow();
      out.sameTbody = document.querySelector('#mm-root .mm-tbody') === tbody;
      A.remove('live-probe');
      out.beforeSecondTick = rowsNow();
      host.tickHooks.forEach(fn => fn(2));
      out.afterRemove = rowsNow();
    } finally {
      G.ui.rerender = realRerender;
    }
    return out;
  });
  check('the list repaints itself when something else changes it while the panel is open, without ' +
    'rebuilding the panel out from under the reader',
    live.beforeTick === live.before && live.afterTick === live.before + 1 &&
    live.beforeSecondTick === live.before + 1 && live.afterRemove === live.before &&
    live.sameTbody === true,
    JSON.stringify(live));

  /* Which row you are on. The class the renderer set appeared exactly once in
     the whole tree — on the line that set it — so the detail group changed and
     the list gave no sign of where the reader was. Asserted against the parsed
     CSSOM rather than by grep, because "the class is on the element" and "the
     class paints something" are different claims and only one of them matters. */
  const picked = await ev(() => {
    const G = window.GigaHack;
    G.ui.setOpen(true);
    G.cfg.ui.tab = 'settings';
    G.cfg.ui.sub = G.cfg.ui.sub || {};
    G.cfg.ui.sub.settings = 'Addons';
    G.ui.rerender();
    const rows = document.querySelectorAll('#mm-root .mm-tbody .mm-tr');
    let clicked = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf('hello-addon') > -1) { rows[i].click(); clicked = i; break; }
    }
    /* Re-queried after the click, because the click rerenders and a node kept
       across a rebuild is wearing the classes it had when it was detached. */
    const after = document.querySelectorAll('#mm-root .mm-tbody .mm-tr');
    let onCount = 0, onText = '';
    for (let i = 0; i < after.length; i++) {
      if (after[i].classList.contains('mm-on')) { onCount++; onText = after[i].textContent; }
    }
    let hasOnRule = false, hasSelRule = false;
    for (let s = 0; s < document.styleSheets.length; s++) {
      let rules = null;
      try { rules = document.styleSheets[s].cssRules; } catch (e) { rules = null; }
      if (!rules) continue;
      for (let r = 0; r < rules.length; r++) {
        const sel = rules[r].selectorText || '';
        if (sel.indexOf('.mm-tr.mm-on') > -1) hasOnRule = true;
        if (sel.indexOf('mm-tr-sel') > -1) hasSelRule = true;
      }
    }
    return {
      clicked: clicked, onCount: onCount, onText: onText,
      hasOnRule: hasOnRule, hasSelRule: hasSelRule,
      unstyled: document.querySelectorAll('#mm-root .mm-tr-sel').length
    };
  });
  check('the selected addon row is marked with the class the stylesheet actually paints, so clicking ' +
    'a row shows which row you are on',
    picked.clicked > -1 && picked.onCount === 1 &&
    picked.onText.indexOf('hello-addon') > -1 &&
    picked.hasOnRule === true && picked.hasSelRule === false && picked.unstyled === 0,
    JSON.stringify(picked));

  /* isScrolling() is hard-wired false on a plain table: its only writer is a
     listener installed inside the virtual branch. Both addon tables gated a
     repaint on it, so the guard read as protection and was none. Driven by
     dispatching the gesture, which is the only thing that can tell the two
     apart from outside. */
  const scrollGuard = await ev(() => {
    const G = window.GigaHack;
    function tableOn(tab, sub) {
      G.ui.setOpen(true);
      G.cfg.ui.tab = tab;
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub[tab] = sub;
      G.ui.rerender();
      const body = document.querySelector('#mm-root .mm-tbody');
      return body ? body.parentNode : null;
    }
    const out = {};
    let t = tableOn('settings', 'Addons');
    out.settingsFound = !!(t && t.mm);
    out.settingsBefore = t.mm.isScrolling();
    t.mm.body.dispatchEvent(new Event('scroll'));
    out.settingsAfter = t.mm.isScrolling();
    t = tableOn('debug', 'Addons');
    out.debugFound = !!(t && t.mm);
    out.debugBefore = t.mm.isScrolling();
    t.mm.body.dispatchEvent(new Event('scroll'));
    out.debugAfter = t.mm.isScrolling();
    return out;
  });
  check('and both addon tables are the kind isScrolling() can answer about, so the guard on their ' +
    'repaints reads true mid-gesture instead of false for ever',
    scrollGuard.settingsFound === true && scrollGuard.debugFound === true &&
    scrollGuard.settingsBefore === false && scrollGuard.settingsAfter === true &&
    scrollGuard.debugBefore === false && scrollGuard.debugAfter === true,
    JSON.stringify(scrollGuard));

  /* =======================================================================
     9. ON A REAL FILESYSTEM

     The default harness is an honest browser build, so this is the only block
     that has a disk at all. It swaps $.paths and $.env for an in-memory Node
     and puts both back in this block, because everything after here reads
     $.paths.mode.
     ==================================================================== */
  await page.addScriptTag({ path: path.resolve(__dirname, '..', 'stubs', 'x-node.js') });

  const disk = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    const model = window.__nodeModel({
      platform: 'darwin', home: '/Users/p',
      mainModule: '/disk/GameOne/index.html',
      files: {
        '/disk/GameOne/index.html': '<html></html>',
        '/disk/GameOne/js/plugins/GigaHack_Core.js': '// core',
        /* Somebody dropped a file into the folder by hand. */
        '/disk/GameOne/gigahack-userdata/addons/dropped-in.js':
          '/*:\n * @gigahack-addon\n * @id dropped-in\n * @name Dropped In\n */\n' +
          'GigaHack.addon(function (api) { window.__droppedRan = true; });'
      }
    });
    const paths = G.pathsFor(model, { selfUrl: 'file:///disk/GameOne/js/plugins/GigaHack_Core.js' });
    const restore = G.usePaths(paths, model);
    try {
      out.mode = G.paths.mode;
      out.consent = G.paths.consent;
      out.dir = A.dir();
      out.library = A.libraryDir();
      out.libraryWhy = A.libraryWhy();

      model.reset();
      window.__droppedRan = false;
      A.load('on the fake disk');
      out.listed = A.list().map(r => r.id).join(',');
      out.droppedOff = A.get('dropped-in') ? A.get('dropped-in').enabled === false : null;
      out.droppedRan = window.__droppedRan === true;
      out.headerRead = A.get('dropped-in') ? A.get('dropped-in').name : null;

      /* An import writes a real file into the folder, and the folder scan
         finds it on the next pass. */
      A.stage({ text: window.__FIX.quarantine, from: 'paste' });
      const committed = A.commit();
      out.wrote = committed.at;
      out.onDisk = model.has('/disk/GameOne/gigahack-userdata/addons/quarantine-me.js');
      out.contents = String(model.peek('/disk/GameOne/gigahack-userdata/addons/quarantine-me.js') || '')
        .indexOf('@gigahack-addon') > -1;

      /* NOTHING under the shared root, at any point, because the answer to
         the storage question is 'unasked'. */
      out.sharedTouched = model.touched('/Users/p/Library/Application Support/GigaHack').length;
      out.sharedExists = model.has('/Users/p/Library/Application Support/GigaHack');

      /* Removing it takes the file with it. */
      A.remove('quarantine-me');
      out.goneFromDisk = model.has('/disk/GameOne/gigahack-userdata/addons/quarantine-me.js') === false;
    } finally {
      restore();
    }
    out.restoredMode = G.paths.mode;
    return out;
  });
  check('on a real filesystem the folder is scanned, a file dropped in by hand is listed with its ' +
    'header read and switched off, and its body has not run',
    disk.mode === 'fs' && /gigahack-userdata\/addons$/.test(String(disk.dir)) &&
    disk.listed.indexOf('dropped-in') > -1 && disk.droppedOff === true &&
    disk.droppedRan === false && disk.headerRead === 'Dropped In',
    JSON.stringify({ dir: disk.dir, listed: disk.listed, ran: disk.droppedRan, name: disk.headerRead }));
  check('an import writes a real .js file into that folder and removing the addon takes the file with it',
    disk.onDisk === true && disk.contents === true && disk.goneFromDisk === true &&
    /addons\/quarantine-me\.js$/.test(String(disk.wrote)),
    JSON.stringify({ wrote: disk.wrote, onDisk: disk.onDisk, gone: disk.goneFromDisk }));
  check('and nothing under the shared root is read, written, probed or created while the storage ' +
    'answer is unasked — the cross-game library says why it is not there instead',
    disk.consent === 'unasked' && disk.sharedTouched === 0 && disk.sharedExists === false &&
    disk.library === null && disk.libraryWhy.length > 20,
    JSON.stringify({ touched: disk.sharedTouched, exists: disk.sharedExists, why: disk.libraryWhy.slice(0, 90) }));
  check('and the swap is put back, so the rest of the suite still runs on the browser build it asserts',
    disk.restoredMode === 'localStorage', disk.restoredMode);

  /* ------------------------------------------------- who a file says it is
     The folder is one of the two install-by-hand routes, and it was the one
     that resolved identity differently from every other: the raw basename,
     never cleaned, and @id read and thrown away. */
  const ids = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    const DIR = '/disk/GameTwo/gigahack-userdata/addons/';
    const files = {
      '/disk/GameTwo/index.html': '<html></html>',
      '/disk/GameTwo/js/plugins/GigaHack_Core.js': '// core'
    };
    /* A dot in the file name and no @id at all. */
    files[DIR + 'town.gold.js'] =
      '/*:\n * @gigahack-addon\n * @name Town gold\n */\n' +
      'GigaHack.addon(function (api) { api.hotkey({ id: \'go\', label: \'go\', run: function () {} }); });';
    /* A file name nothing would choose as an id, and an @id that says so. */
    files[DIR + 'My Addon (v2).js'] =
      '/*:\n * @gigahack-addon\n * @id my-addon\n * @name Mine\n */\n' +
      'GigaHack.addon(function (api) { window.__myAddonRan = true; });';
    /* Two files, one @id. */
    files[DIR + 'dupe-a.js'] = '/*:\n * @gigahack-addon\n * @id dupe\n * @name First\n */\n';
    files[DIR + 'dupe-b.js'] = '/*:\n * @gigahack-addon\n * @id dupe\n * @name Second\n */\n';

    const model = window.__nodeModel({
      platform: 'darwin', home: '/Users/p',
      mainModule: '/disk/GameTwo/index.html', files: files
    });
    const paths = G.pathsFor(model, { selfUrl: 'file:///disk/GameTwo/js/plugins/GigaHack_Core.js' });
    const restore = G.usePaths(paths, model);
    const logMark = G.logHistory().length;
    try {
      window.__myAddonRan = false;
      A.load('identity resolution');
      out.listed = A.list().map(r => r.id).sort().join(',');
      const gold = A.get('town-gold');
      out.goldFile = gold ? gold.file : null;
      out.goldReadable = gold ? gold.src !== null : false;
      out.goldName = gold ? gold.name : null;
      out.enabledGold = A.enable('town-gold').ok;
      out.goldHotkeys = G.ui.hotkeyList().map(d => d.id)
        .filter(i => i.indexOf('town') > -1).join(',');
      /* The whole point of cleanId: this is the path Settings → Hotkeys writes
         to, and cfgSet descends on every dot in it. */
      out.goldDotted = out.goldHotkeys.indexOf('.') > -1;
      A.disable('town-gold');

      const mine = A.get('my-addon');
      out.mineName = mine ? mine.name : null;
      out.mineFile = mine ? mine.file : null;
      const dupe = A.get('dupe');
      out.dupeName = dupe ? dupe.name : null;
      out.dupeCount = A.list().filter(r => r.id === 'dupe').length;
      out.log = G.logHistory().slice(logMark).map(e => e.msg).join(' | ');
      A.list().forEach(r => A.remove(r.id));
    } finally {
      restore();
    }
    return out;
  });
  check('an id the folder scan discovered goes through cleanId, so a dot in a file name cannot become ' +
    'a hotkey id the settings path splits and the keydown handler can never match',
    /(^|,)town-gold(,|$)/.test(ids.listed) && ids.goldFile === 'town.gold' &&
    ids.goldReadable === true && ids.goldName === 'Town gold' && ids.enabledGold === true &&
    ids.goldHotkeys === 'addon:town-gold:go' && ids.goldDotted === false,
    JSON.stringify({ listed: ids.listed, file: ids.goldFile, keys: ids.goldHotkeys }));
  check('and @id is the identity on the folder route too, not only through the review — the file name ' +
    'is where the bytes are and nothing else',
    /(^|,)my-addon(,|$)/.test(ids.listed) && ids.mineName === 'Mine' &&
    ids.mineFile === 'My Addon (v2)',
    JSON.stringify({ listed: ids.listed, name: ids.mineName, file: ids.mineFile }));
  /* And the other direction of the same rule: editing @id in a file that is
     already listed re-keys the row rather than adding a second one beside it,
     because two rows reading one file are two runnable copies of it. */
  const rekey = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    const DIR = '/disk/GameFour/gigahack-userdata/addons/';
    const V1 = '/*:\n * @gigahack-addon\n * @id first-name\n * @name Renamed\n */\n' +
      'GigaHack.addon(function (api) { window.__renamedRan = true; });';
    const files = {
      '/disk/GameFour/index.html': '<html></html>',
      '/disk/GameFour/js/plugins/GigaHack_Core.js': '// core'
    };
    files[DIR + 'thing.js'] = V1;
    const model = window.__nodeModel({
      platform: 'darwin', home: '/Users/p',
      mainModule: '/disk/GameFour/index.html', files: files
    });
    const paths = G.pathsFor(model, { selfUrl: 'file:///disk/GameFour/js/plugins/GigaHack_Core.js' });
    const restore = G.usePaths(paths, model);
    try {
      A.load('before the rename');
      A.enable('first-name');
      A.get('first-name');
      G.store.write('addon-first-name.json', { kept: 'some state' }, true);
      out.before = A.list().map(r => r.id).join(',');
      out.onBefore = A.get('first-name').enabled;

      /* The player edits one line of the header. */
      model.add(DIR + 'thing.js', V1.replace('first-name', 'second-name'));
      A.load('after the rename');
      out.after = A.list().map(r => r.id).join(',');
      const rec = A.get('second-name');
      out.file = rec ? rec.file : null;
      out.stillOn = rec ? rec.enabled : null;
      out.dataMoved = JSON.stringify(G.store.read('addon-second-name.json', null));
      out.oldDataGone = G.store.read('addon-first-name.json', null) === null;
      A.list().forEach(r => A.remove(r.id));
      G.store.remove('addon-second-name.json');
    } finally {
      restore();
    }
    return out;
  });
  check('editing @id in a file that is already listed re-keys its row instead of leaving a second row ' +
    'reading the same file, and its enablement and its own data come with it',
    rekey.before === 'first-name' && rekey.onBefore === true &&
    rekey.after === 'second-name' && rekey.file === 'thing' && rekey.stillOn === true &&
    rekey.dataMoved === '{"kept":"some state"}' && rekey.oldDataGone === true,
    JSON.stringify(rekey));

  check('so two files in the folder claiming one @id are the named conflict the README promises, with ' +
    'the first one\'s path in the message and the second one not listed',
    ids.dupeCount === 1 && ids.dupeName === 'First' &&
    /two files claim the addon id "dupe"/.test(ids.log) &&
    ids.log.indexOf('dupe-a.js') > -1 && ids.log.indexOf('dupe-b.js') > -1,
    ids.log.slice(-260));

  /* ------------------------------------------------------- the shared copy
     Enablement is per game because one machine-wide "on" is not what anybody
     means. Removal is the destructive direction of the same argument, and it
     is the direction nothing said anything about. */
  const library = await ev(() => {
    const G = window.GigaHack, A = G.addons;
    const out = {};
    const SHARED = '/Users/p/Library/Application Support/GigaHack/_shared/addons/shared-one.js';
    const files = {
      '/disk/GameThree/index.html': '<html></html>',
      '/disk/GameThree/js/plugins/GigaHack_Core.js': '// core'
    };
    files[SHARED] = '/*:\n * @gigahack-addon\n * @id shared-one\n * @name Shared One\n */\n' +
      'GigaHack.addon(function (api) { window.__sharedRan = true; });';
    const model = window.__nodeModel({
      platform: 'darwin', home: '/Users/p',
      mainModule: '/disk/GameThree/index.html', files: files
    });
    const paths = G.pathsFor(model, {
      selfUrl: 'file:///disk/GameThree/js/plugins/GigaHack_Core.js', consent: 'granted'
    });
    const restore = G.usePaths(paths, model);
    try {
      A.load('a granted game with a library');
      out.consent = G.paths.consent;
      out.libraryDir = A.libraryDir();
      const rec = A.get('shared-one');
      out.scope = rec ? rec.scope : null;

      /* The panel, before the button is pressed. */
      G.ui.setOpen(true);
      G.cfg.ui.tab = 'settings';
      G.cfg.ui.sub = G.cfg.ui.sub || {};
      G.cfg.ui.sub.settings = 'Addons';
      G.ui.rerender();
      const body = document.querySelector('#mm-root .mm-body');
      out.detail = body ? body.textContent : '';
      let btn = null;
      const all = body ? body.querySelectorAll('button') : [];
      for (let i = 0; i < all.length; i++) {
        if ((all[i].textContent || '').indexOf('remove it') > -1) { btn = all[i]; break; }
      }
      out.foundButton = !!btn;
      if (btn) { btn.click(); out.armLabel = btn.textContent; btn.mm.disarm(); }

      out.refused = A.remove('shared-one');
      out.stillOnDisk = model.has(SHARED);
      out.stillListed = !!A.get('shared-one');
      out.deleted = A.remove('shared-one', { shared: true });
      out.goneFromDisk = model.has(SHARED) === false;
      A.list().forEach(r => A.remove(r.id, { shared: true }));
    } finally {
      restore();
    }
    G.ui.rerender();
    return out;
  });
  check('"remove it" on a library addon does not quietly delete the copy every game on the machine ' +
    'reads: it is refused, and the refusal names the shared path and the call that means it',
    library.consent === 'granted' && library.scope === 'library' &&
    library.refused.ok === false && library.stillOnDisk === true && library.stillListed === true &&
    /every game on this machine/.test(library.refused.why) &&
    library.refused.why.indexOf('_shared/addons/shared-one.js') > -1 &&
    /shared: true/.test(library.refused.why),
    JSON.stringify(library.refused).slice(0, 300));
  check('and the panel says which copy is going before the file goes — in the row above the button ' +
    'and in the confirm on it, not in the toast afterwards',
    library.foundButton === true && /delete the shared copy\?/.test(String(library.armLabel)) &&
    /one copy, read by every game on this machine/.test(library.detail),
    JSON.stringify({ arm: library.armLabel, kept: /kept in/.test(library.detail) }));
  check('and the deliberate removal says what it did, so the toast is more than "REMOVED"',
    library.deleted.ok === true && library.goneFromDisk === true &&
    /every game on this machine has lost it/.test(library.deleted.why),
    JSON.stringify(library.deleted));

  /* =======================================================================
     10. IT IS NOT A SANDBOX, AND IT SAYS SO ONCE
     ==================================================================== */
  const honest = await ev(() => {
    const A = window.GigaHack.addons;
    A.stage({ text: window.__FIX.bare, from: 'paste', name: 'sandbox-probe' });
    return { staged: true };
  });
  const reviewText = await panelText('settings', 'Addons');
  await ev(() => { window.GigaHack.addons.discard(); });
  check('the review says plainly that this is not a sandbox, at the moment the decision is being made',
    honest.staged && /Nothing here sandboxes it/.test(reviewText) &&
    /anything the game can/.test(reviewText),
    reviewText.length > 20 ? 'review built' : reviewText);
  check('and it is said exactly once in the whole module, at the import review',
    (SRC.match(/Nothing here sandboxes it/g) || []).length === 1 &&
    SRC.indexOf('NOT_A_SANDBOX') > -1);

  /* =======================================================================
     PUT IT BACK
     ==================================================================== */
  const restored = await ev((b) => {
    const G = window.GigaHack, A = G.addons;
    A.list().forEach(r => A.remove(r.id));
    G.store.remove('addons.json');
    G.store.remove('addons-loading.json');
    G.store.cfgSet('addons.safeMode', false);
    G.store.cfgSet('addons.fetchTimeoutMs', 20000);
    while (G.undo.size() > b.undo) G.undo.pop();
    G.cfg.ui.tab = b.tab;
    G.cfg.ui.sub = JSON.parse(b.sub);
    G.ui.setOpen(b.open);
    G.ui.rerender();
    return {
      addons: A.list().length,
      api: Object.keys(G.api).sort().join(',') === b.api,
      world: G.ui.panelNames('world').join(',') === b.world,
      settingsStillHasAddons: G.ui.panelNames('settings').indexOf('Addons') > -1,
      hotkeys: G.ui.hotkeyList().length === b.hotkeys,
      frameHooks: G.frameHooks().map(e => e.name).sort().join(' | ') === b.frameHooks,
      pathsMode: G.paths.mode === b.pathsMode,
      envFs: G.env.fs === b.envFs,
      undo: G.undo.size() - b.undo,
      tab: G.cfg.ui.tab === b.tab,
      transportBack: G.net.transport().id !== 'injected',
      /* The aliases the addons installed are the one thing that stays, by
         design, and they are pass-throughs now. */
      addonAliases: Object.keys(G.hooks).filter(n => n.indexOf('(addon:') > -1)
    };
  }, before);
  check('the check file leaves nothing behind: no addon, no console name, no panel, no hotkey, no ' +
    'frame hook, no injected transport, and $.paths back on the browser build',
    restored.addons === 0 && restored.api && restored.world && restored.hotkeys &&
    restored.frameHooks && restored.pathsMode && restored.envFs && restored.undo === 0 &&
    restored.tab && restored.transportBack && restored.settingsStillHasAddons,
    JSON.stringify(restored));
  check('and the one thing it cannot put back is the alias, which is exactly what this module says ' +
    'about an alias',
    restored.addonAliases.length === 1 &&
    restored.addonAliases[0].indexOf('(addon:everything)') > -1,
    JSON.stringify(restored.addonAliases));
};
