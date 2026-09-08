/* =============================================================================
   GigaHack MV/MZ — the storage question on screen, and three panels made live

   Two halves, and they fail in opposite directions.

   The CARD is the only thing in this mod that puts a question to the player,
   and every way of getting it wrong is quiet: a card that appears when the
   answer is already given, a card that records an answer nobody chose, a card
   whose two paths are shortened to the half that says nothing, a card that
   cannot be got rid of. So these checks drive it the way a person does — show
   it, read what it says, click each of the three answers in turn, and look at
   what ended up on the disk — rather than asserting on the functions behind
   it, which checks/paths.js already covers.

   The LIVE panels fail the other way: they show something true once and go on
   showing it. A check that only reads a panel after building it cannot tell a
   live readout from a frozen one, so each of these changes the thing behind
   the panel, runs the clock by hand, and reads the same node again.

   State discipline: every swap of $.paths / $.env is restored inside the check
   that made it, $.cfg is put back by reference after anything that reloads or
   re-merges settings, SceneManager._scene and $.index.status are put back in
   the same block that replaced them, and the last block restores the tab, the
   sub-tab and the open state and asserts the environment is where the rest of
   the suite left it. The move report kept by the Storage panel is cleared by
   the same 'paths:changed' event the mod itself uses, because a report naming
   two directories that are no longer in use is worse than no report.
   ========================================================================== */
'use strict';

const path = require('path');

module.exports = async function (ctx) {
  const check = ctx.check, ev = ctx.ev, page = ctx.page;

  /* The model installs one global and is not in any harness HTML: the default
     harness is an honest browser build and run.js asserts that it is. */
  await page.addScriptTag({ path: path.resolve(__dirname, '..', 'stubs', 'x-node.js') });

  /* Every helper here is namespaced to this file. Check files are discovered
     by directory listing, and one that leans on a neighbour's page globals
     fails for a reason that has nothing to do with what it is checking. */
  await ev(() => {
    const G = window.GigaHack;
    window.__su = {
      disk: null,

      /** One disk, two games, one shared root. Rebuilt per scenario. */
      mk: function (extra) {
        const files = {
          '/disk/CardOne/index.html': '<html></html>',
          '/disk/CardOne/js/plugins/GigaHack_Core.js': '// core',
          '/disk/CardTwo/index.html': '<html></html>',
          '/disk/CardTwo/js/plugins/GigaHack_Core.js': '// core',
          '/disk/CardThree/index.html': '<html></html>',
          '/disk/CardThree/js/plugins/GigaHack_Core.js': '// core'
        };
        Object.keys(extra || {}).forEach(function (k) { files[k] = extra[k]; });
        window.__su.disk = window.__nodeModel({
          platform: 'darwin', home: '/Users/p',
          mainModule: '/disk/CardOne/index.html',
          files: files
        });
        return window.__su.disk;
      },

      /** Make `game` the live install. Returns the restore function. */
      live: function (game) {
        const m = window.__su.disk;
        m.proc.mainModule.filename = '/disk/' + game + '/index.html';
        const p = G.pathsFor(m, { selfUrl: 'file:///disk/' + game + '/js/plugins/GigaHack_Core.js' });
        return G.usePaths(p, m);
      },

      /** The card, or null. */
      card: function () { return document.querySelector('#mm-root .mm-ask'); },

      /** A button under `root` whose label contains `label`. */
      btn: function (root, label) {
        const all = root ? root.querySelectorAll('button') : [];
        for (let i = 0; i < all.length; i++) {
          if ((all[i].textContent || '').indexOf(label) > -1) return all[i];
        }
        return null;
      },

      /** Every full path value on the card, as U.w.path kept them. */
      paths: function (root) {
        const out = [];
        const all = root ? root.querySelectorAll('.mm-path') : [];
        for (let i = 0; i < all.length; i++) out.push(all[i].getAttribute('title'));
        return out;
      },

      /** Render one panel and hand back the content box it was built into.
          The content box and not the whole overlay: the log drawer replays
          every line the mod has logged, and a check that searched the overlay
          for the words a panel is supposed to print would find them in the log
          instead and pass on a panel that printed nothing. */
      panel: function (tab, sub) {
        G.ui.setOpen(true);
        G.cfg.ui.tab = tab;
        G.cfg.ui.sub = G.cfg.ui.sub || {};
        G.cfg.ui.sub[tab] = sub;
        G.ui.rerender();
        return window.__su.content();
      },

      content: function () { return document.querySelector('#mm-root .mm-win > .mm-body'); },

      /** The .mm-row element carrying this label, so a repaint can be proved
          to have written into the same node rather than built a new one. */
      row: function (root, label) {
        const rows = root.querySelectorAll('.mm-row');
        for (let i = 0; i < rows.length; i++) {
          const lab = rows[i].querySelector('.mm-lab');
          if (lab && lab.textContent === label) return rows[i];
        }
        return null;
      },

      /** Run the 700ms clock once, by hand. */
      tick: function () {
        const host = G.ui.getHost();
        host.tickHooks.slice().forEach(function (fn) { fn(1); });
      },

      /** The text of one row, found by its label. */
      rowValue: function (root, label) {
        const rows = root.querySelectorAll('.mm-row');
        for (let i = 0; i < rows.length; i++) {
          const lab = rows[i].querySelector('.mm-lab');
          if (lab && lab.textContent === label) {
            const edge = rows[i].querySelector('.mm-edge');
            return edge ? edge.textContent : '';
          }
        }
        return null;
      }
    };
  });

  const opening = await ev(() => ({
    tab: window.GigaHack.cfg.ui.tab,
    sub: JSON.parse(JSON.stringify(window.GigaHack.cfg.ui.sub || {})),
    open: window.GigaHack.ui.isOpen(),
    mode: window.GigaHack.paths.mode,
    capsFs: window.GigaHack.caps.fs,
    contentFound: !!window.__su.content()
  }));
  check('the checks below read the panel body itself, not the overlay around it',
    opening.contentFound === true, String(opening.contentFound));

  /* =======================================================================
     THE CARD — WHEN IT APPEARS AND WHEN IT DOES NOT
     ==================================================================== */
  const notHere = await ev(() => {
    const G = window.GigaHack;
    const r = G.ui.askStorage();
    const s = G.ui.showStorageCard();
    return { asked: r.shown, why: r.why, shown: s.shown, showWhy: s.why, card: !!window.__su.card() };
  });
  check('a build with no filesystem is never asked where to put files it cannot write, and the refusal is a sentence',
    notHere.asked === false && notHere.shown === false && notHere.card === false &&
    /nothing outside the game folder to reach/.test(notHere.why) && notHere.showWhy === notHere.why,
    notHere.why);

  const first = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    window.__su.mk();
    const restore = window.__su.live('CardOne');
    U.setOpen(false);
    const r = U.askStorage();
    const el = window.__su.card();
    const host = U.getHost();
    const out = {
      shown: r.shown,
      onScreen: !!el,
      inRoot: !!el && el.parentNode === host.root,
      insideWindow: !!el && !!el.closest('.mm-win'),
      float: !!el && el.classList.contains('mm-float'),
      menuOpen: U.isOpen(),
      paused: !!host.active.paused,
      localDir: G.paths.localDir,
      sharedDir: G.paths.sharedDir,
      paths: window.__su.paths(el),
      text: el ? el.textContent : '',
      buttons: {
        grant: !!window.__su.btn(el, 'Use the shared folder'),
        decline: !!window.__su.btn(el, 'Keep everything beside the game'),
        later: !!window.__su.btn(el, 'Ask again next launch')
      },
      /* Nothing outside the game folder may have been touched by putting the
         question, which is the whole claim the question is about. */
      touchedShared: window.__su.disk.touched('/Users/p/Library/Application Support/GigaHack').length
    };
    U.hideStorageCard();
    restore();
    return out;
  });
  check('the first launch of a game with no answer puts the question on screen without opening the menu',
    first.shown === true && first.onScreen === true && first.inRoot === true &&
    first.insideWindow === false && first.float === true && first.menuOpen === false &&
    first.paused === false, JSON.stringify({ shown: first.shown, inRoot: first.inRoot, open: first.menuOpen }));
  check('it offers exactly three answers, and the third one is an answer',
    first.buttons.grant && first.buttons.decline && first.buttons.later,
    JSON.stringify(first.buttons));
  check('it names both absolute paths in full, so what is being agreed to can be read before agreeing to it',
    first.paths.indexOf(first.localDir) > -1 && first.paths.indexOf(first.sharedDir) > -1 &&
    first.localDir !== first.sharedDir,
    JSON.stringify(first.paths));
  check('it says the answer is per game and cannot travel to another game on this machine',
    /once per game/.test(first.text) && /any other game/.test(first.text),
    first.text.slice(0, 60));
  check('and putting the question touches nothing outside the game folder',
    first.touchedShared === 0, first.touchedShared + ' call(s)');

  /* =======================================================================
     THE THREE ANSWERS, CLICKED
     ==================================================================== */
  const granted = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const m = window.__su.mk();
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    U.showStorageCard();
    const el = window.__su.card();
    window.__su.btn(el, 'Use the shared folder').click();
    const rec = G.consentRecord();
    const out = {
      consent: G.paths.consent,
      dataDir: G.paths.dataDir,
      sharedDir: G.paths.sharedDir,
      cardGone: !window.__su.card(),
      answer: rec && rec.answer,
      /* Beside the game, never in the shared folder. */
      recordedIn: rec && rec._where,
      localHasIt: m.has('/disk/CardOne/gigahack-userdata/consent.json'),
      sharedHasIt: m.has('/Users/p/Library/Application Support/GigaHack/cardone/consent.json')
    };
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('the shared-folder answer is recorded beside the game and the data directory moves to the shared folder',
    granted.consent === 'granted' && granted.answer === 'granted' &&
    granted.dataDir === granted.sharedDir && granted.cardGone === true,
    JSON.stringify({ consent: granted.consent, dataDir: granted.dataDir }));
  check('and the answer itself is written beside the game rather than in the folder it is about',
    granted.localHasIt === true && granted.sharedHasIt === false &&
    granted.recordedIn.indexOf('/disk/CardOne/') === 0, granted.recordedIn);

  const declined = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const m = window.__su.mk();
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    U.showStorageCard();
    window.__su.btn(window.__su.card(), 'Keep everything beside the game').click();
    const out = {
      consent: G.paths.consent,
      dataDir: G.paths.dataDir,
      localDir: G.paths.localDir,
      cardGone: !window.__su.card(),
      /* The whole claim of "no": not one call under the shared root. */
      touchedShared: m.touched('/Users/p/Library/Application Support/GigaHack').length
    };
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('the beside-the-game answer keeps the data where it is and reads nothing outside the game folder',
    declined.consent === 'declined' && declined.dataDir === declined.localDir &&
    declined.cardGone === true && declined.touchedShared === 0,
    JSON.stringify(declined));

  const later = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    window.__su.mk();
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    U.showStorageCard();
    window.__su.btn(window.__su.card(), 'Ask again next launch').click();
    const askAgain = U.askStorage();
    const reopen = U.showStorageCard();
    const out = {
      consent: G.paths.consent,
      deferred: G.consentDeferred(),
      asked: (G.consentRecord() || {}).asked,
      cardGone: !!askAgain && askAgain.shown === false,
      why: askAgain.why,
      /* Still re-openable by hand: "not this launch" is not "never again". */
      reopened: reopen.shown === true && !!window.__su.card()
    };
    U.hideStorageCard();
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('"ask again next launch" leaves the answer unasked, counts the asking, and does not ask twice in one launch',
    later.consent === 'unasked' && later.deferred === true && later.asked === 1 &&
    later.cardGone === true && /next launch/.test(later.why), JSON.stringify(later));
  check('and Settings can still put the question back on screen in the same launch',
    later.reopened === true, String(later.reopened));

  const dismissed = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const m = window.__su.mk();
    /* Its own game: "ask me again next launch" is remembered for the launch,
       and the block above has already said it for CardOne. */
    const restore = window.__su.live('CardThree');
    U.showStorageCard();
    const up = !!window.__su.card();
    U.panicHide();
    const out = {
      up: up,
      gone: !window.__su.card(),
      open: U.isStorageCardOpen(),
      /* Nothing was recorded by walking away from it. */
      record: G.consentRecord(),
      consent: G.paths.consent,
      deferred: G.consentDeferred(),
      /* Beside the game a write probe is expected and needs no permission.
         Outside it, nothing at all. */
      wroteOutside: m.touched('/Users/p/Library/Application Support/GigaHack')
        .filter(function (e) { return /write|mkdir|unlink/.test(e.op); }).length,
      asksAgain: U.askStorage().shown
    };
    U.hideStorageCard();
    restore();
    return out;
  });
  check('the panic-hide key takes the card off screen like everything else GigaHack draws',
    dismissed.up === true && dismissed.gone === true && dismissed.open === false,
    JSON.stringify({ up: dismissed.up, gone: dismissed.gone }));
  check('dismissing the card records nothing, so the answer is still unasked and the question comes back',
    dismissed.record === null && dismissed.consent === 'unasked' &&
    dismissed.deferred === false && dismissed.wroteOutside === 0 &&
    dismissed.asksAgain === true, JSON.stringify(dismissed));

  const notSwallowed = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    window.__su.mk();
    const restore = window.__su.live('CardOne');
    U.setOpen(false);
    U.showStorageCard();
    let reached = 0;
    const spy = function () { reached++; };
    document.addEventListener('keydown', spy);
    /* On the body, which is where a keystroke the player made arrives: an
       event dispatched on window alone has a propagation path of one node and
       would prove nothing about what reaches the game. */
    const e = new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    document.removeEventListener('keydown', spy);
    const out = {
      reached: reached,
      cardUp: !!window.__su.card(),
      menuOpen: U.isOpen(),
      defaultPrevented: e.defaultPrevented
    };
    U.hideStorageCard();
    restore();
    return out;
  });
  check('the card does not take the game\'s own keyboard away while it waits for an answer',
    notSwallowed.cardUp === true && notSwallowed.menuOpen === false &&
    notSwallowed.reached === 1 && notSwallowed.defaultPrevented === false,
    JSON.stringify(notSwallowed));

  const secondGame = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const m = window.__su.mk();
    const savedCfg = G.cfg;
    let restore = window.__su.live('CardOne');
    U.showStorageCard();
    window.__su.btn(window.__su.card(), 'Use the shared folder').click();
    const one = { consent: G.paths.consent, dir: G.paths.dataDir };
    G.store.flush();
    restore();

    restore = window.__su.live('CardTwo');
    const asks = U.askStorage();
    const two = {
      consent: G.paths.consent,
      shown: asks.shown,
      /* The second game's own shared folder was never created for it. */
      sharedDir: G.paths.sharedDir,
      madeForTwo: m.list(G.paths.sharedDir).length
    };
    U.hideStorageCard();
    restore();
    G.cfg = savedCfg;
    return { one: one, two: two };
  });
  check('granting in one game leaves the next game still asking, with nothing made for it under the shared root',
    secondGame.one.consent === 'granted' && secondGame.two.consent === 'unasked' &&
    secondGame.two.shown === true && secondGame.two.madeForTwo === 0,
    JSON.stringify(secondGame));

  /* =======================================================================
     SETTINGS → STORAGE
     ==================================================================== */
  const placed = await ev(() => window.GigaHack.ui.panelNames('settings'));
  /* The claim is that Storage is there and sits after Profiles — not that it is
     LAST, which is a claim about every panel anyone adds to this tab from now
     on. The same over-tight assertion was in checks/keys.js and went red the
     moment a second Settings panel arrived in the same release. */
  check('Settings gains a Storage panel, which is the panel every refusal in the mod names',
    placed.indexOf('Storage') > placed.indexOf('Profiles') && placed.indexOf('Profiles') > -1,
    placed.join(','));

  const mootPanel = await ev(() => {
    const root = window.__su.panel('settings', 'Storage');
    const here = window.__su.btn(root, 'open this folder');
    const shared = window.__su.btn(root, 'open the shared folder');
    const toShared = window.__su.btn(root, 'copy everything to the shared folder');
    return {
      text: root.textContent,
      hereDisabled: !!here && here.classList.contains('mm-dis'),
      hereWhy: here ? here.getAttribute('data-mm-tip') : '',
      sharedDisabled: !!shared && shared.classList.contains('mm-dis'),
      sharedWhy: shared ? shared.getAttribute('data-mm-tip') : '',
      moveDisabled: !!toShared && toShared.classList.contains('mm-dis'),
      moveWhy: toShared ? toShared.getAttribute('data-mm-tip') : ''
    };
  });
  check('with no filesystem the panel exists and every control on it is greyed with its own reason, not one shared one',
    /no filesystem/.test(mootPanel.text) && mootPanel.hereDisabled === true &&
    mootPanel.sharedDisabled === true && mootPanel.moveDisabled === true &&
    /no directory to open in localStorage mode/.test(mootPanel.hereWhy) &&
    /until the answer is yes/.test(mootPanel.sharedWhy) &&
    /no directories to move anything between/.test(mootPanel.moveWhy) &&
    mootPanel.hereWhy !== mootPanel.sharedWhy,
    mootPanel.hereWhy.slice(0, 60) + ' | ' + mootPanel.sharedWhy.slice(0, 60));
  const declaredHere = await ev(() => {
    const G = window.GigaHack;
    const root = window.__su.panel('settings', 'Storage');
    const text = root.textContent;
    return G.store.files().filter(function (f) { return text.indexOf(f.name) < 0; }).map(function (f) { return f.name; });
  });
  check('every file the store declares it owns is named in the "what this folder holds" table',
    declaredHere.length === 0, declaredHere.join(', ') || 'all listed');

  const answered = await ev(() => {
    const G = window.GigaHack;
    window.__su.mk();
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    G.store.declineStorage();
    const root = window.__su.panel('settings', 'Storage');
    const rec = G.consentRecord();
    const out = {
      answer: window.__su.rowValue(root, 'Answer'),
      given: window.__su.rowValue(root, 'Given'),
      at: rec.at,
      asked: window.__su.rowValue(root, 'Times asked'),
      paths: window.__su.paths(root),
      localDir: G.paths.localDir,
      sharedDir: G.paths.sharedDir,
      recordedIn: rec._where,
      /* The shared folder is computed and printed and still not touched. */
      touchedShared: window.__su.disk.touched('/Users/p/Library/Application Support/GigaHack').length,
      notInUse: /computed but never touched/.test(root.textContent),
      /* Which of the two answers is in force, read off the buttons: two
         unmarked buttons read as a choice nobody has made. */
      marked: (function () {
        const out = [];
        ['Use the shared folder', 'Keep everything beside the game'].forEach(function (l) {
          const b = window.__su.btn(root, l);
          if (b && b.classList.contains('mm-on')) out.push(l);
        });
        return out;
      })(),
      /* A directory that genuinely exists, on a build whose desktop shell has
         no showItemInFolder. The refusal has to name the missing call rather
         than the missing folder. */
      revealDisabled: (function () {
        const b = window.__su.btn(root, 'open this folder');
        return !!b && b.classList.contains('mm-dis');
      })(),
      revealWhy: (function () {
        const b = window.__su.btn(root, 'open this folder');
        return b ? b.getAttribute('data-mm-tip') : '';
      })()
    };
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('the panel says what the answer is, when it was given and where it was written down',
    /refused/.test(answered.answer) && answered.given === answered.at &&
    answered.asked === '1' && answered.paths.indexOf(answered.recordedIn) > -1,
    JSON.stringify({ answer: answered.answer, given: answered.given, asked: answered.asked }));
  check('the answer in force is marked on the button that gave it, so two buttons do not read as an open question',
    answered.marked.join(',') === 'Keep everything beside the game', answered.marked.join(',') || 'neither');
  check('where the desktop shell cannot open a folder, the button says which call is missing rather than which folder',
    answered.revealDisabled === true && /does not offer showItemInFolder/.test(answered.revealWhy),
    answered.revealWhy.slice(0, 90));
  check('it prints both locations whatever the answer is, and touches neither of them to do it',
    answered.paths.indexOf(answered.localDir) > -1 && answered.paths.indexOf(answered.sharedDir) > -1 &&
    answered.touchedShared === 0 && answered.notInUse === true,
    JSON.stringify({ shared: answered.sharedDir, touched: answered.touchedShared }));

  /* ---------------------------------------------------------- migration */
  const moved = await ev(() => {
    const G = window.GigaHack;
    const m = window.__su.mk({
      '/disk/CardOne/gigahack-userdata/snippets.json': '["beside the game"]',
      '/disk/CardOne/gigahack-userdata/kits.json': '["a loadout"]',
      '/Users/p/Library/Application Support/GigaHack/cardone/snippets.json': '["already there"]'
    });
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    G.store.flush();
    G.setConsent('granted');

    const root = window.__su.panel('settings', 'Storage');
    window.__su.btn(root, 'copy everything to the shared folder').click();

    const after = window.__su.content();
    const out = {
      /* The report itself, row by row. Reading the panel's prose instead would
         pass on a panel that printed the explanation and no report: the
         sentence about keeping what the destination has is always there. */
      report: (function () {
        const rows = after.querySelectorAll('.mm-tr'), out = [];
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('.mm-cell');
          if (cells.length < 2) continue;
          const state = cells[0].textContent;
          if (state !== 'copied' && state !== 'kept' && state !== 'failed') continue;
          out.push(cells[1].textContent + ':' + state);
        }
        return out;
      })(),
      copiedKits: m.peek('/Users/p/Library/Application Support/GigaHack/cardone/kits.json'),
      sourceKitsStill: m.peek('/disk/CardOne/gigahack-userdata/kits.json'),
      destSnippets: m.peek('/Users/p/Library/Application Support/GigaHack/cardone/snippets.json'),
      sourceSnippets: m.peek('/disk/CardOne/gigahack-userdata/snippets.json'),
      consentTravelled: m.has('/Users/p/Library/Application Support/GigaHack/cardone/consent.json')
    };

    /* The old copy: a separate act, on a danger button, so two clicks. */
    const drop = window.__su.btn(after, 'remove the old copy');
    drop.click(); drop.click();
    out.afterDrop = {
      sourceKits: m.peek('/disk/CardOne/gigahack-userdata/kits.json'),
      destKits: m.peek('/Users/p/Library/Application Support/GigaHack/cardone/kits.json'),
      sourceSnippets: m.peek('/disk/CardOne/gigahack-userdata/snippets.json')
    };

    /* And once the answer moves the directories the report names, the report
       goes with them. */
    G.store.declineStorage();
    const back = window.__su.content();
    out.reportAfterAnswer = (function () {
      const rows = back.querySelectorAll('.mm-tr'), list = [];
      for (let i = 0; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll('.mm-cell');
        if (cells.length && (cells[0].textContent === 'copied' || cells[0].textContent === 'kept')) {
          list.push(cells[1].textContent + ':' + cells[0].textContent);
        }
      }
      return list;
    })();

    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('the move copies what the destination does not have and keeps what it does, saying which per file',
    moved.copiedKits === '["a loadout"]' && moved.destSnippets === '["already there"]' &&
    moved.report.indexOf('kits.json:copied') > -1 &&
    moved.report.indexOf('snippets.json:kept') > -1 &&
    moved.report.indexOf('consent.json:kept') > -1,
    moved.report.join(', '));
  check('it deletes nothing, and the answer itself never travels to the folder it is about',
    moved.sourceKitsStill === '["a loadout"]' && moved.sourceSnippets === '["beside the game"]' &&
    moved.consentTravelled === false, JSON.stringify({
      kits: moved.sourceKitsStill, consent: moved.consentTravelled
    }));
  check('a move report is dropped when the answer changes, so it never names two directories nothing goes to any more',
    moved.reportAfterAnswer.length === 0, moved.reportAfterAnswer.join(', ') || 'dropped');
  check('removing the old copy is a separate act and touches only the files it can see a copy of',
    moved.afterDrop.sourceKits === null && moved.afterDrop.destKits === '["a loadout"]' &&
    moved.afterDrop.sourceSnippets === '["beside the game"]', JSON.stringify(moved.afterDrop));

  /* BOTH MOVE BUTTONS ANSWER TO THE SAME ANSWER.
     The consent clause used to be folded into the "to the shared folder"
     button alone, so with the question unanswered the panel offered a live,
     ungreyed "copy everything back beside the game" whose tooltip named the
     shared path — and one click read and copied the whole file list out of it.
     The store refuses that now too (checks/paths.js), and a control that runs
     and is refused is not the same thing as a control that says why it cannot
     run: this is the panel half, so it asserts on the greying and the reason,
     which is what the reader sees before clicking anything. */
  const backButton = await ev(() => {
    const G = window.GigaHack;
    const SHARED_ROOT = '/Users/p/Library/Application Support/GigaHack';
    const m = window.__su.mk({
      [SHARED_ROOT + '/cardone/snippets.json']: '["another install left this"]'
    });
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');    /* unasked */
    const root = window.__su.panel('settings', 'Storage');
    const back = window.__su.btn(root, 'copy everything back beside the game');
    const to = window.__su.btn(root, 'copy everything to the shared folder');
    m.reset();
    if (back) back.click();
    const out = {
      consent: G.paths.consent,
      backDisabled: !!back && back.classList.contains('mm-dis'),
      backWhy: back ? back.getAttribute('data-mm-tip') : '',
      toDisabled: !!to && to.classList.contains('mm-dis'),
      touchedShared: m.touched(SHARED_ROOT).map(e => e.op + ' ' + e.path),
      arrived: m.has('/disk/CardOne/gigahack-userdata/snippets.json')
    };
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('with the question unanswered BOTH directions of the move are greyed, because copying back out of the ' +
    'shared folder reads it — and the reason says so rather than naming the missing directory',
    backButton.consent === 'unasked' && backButton.backDisabled === true &&
    backButton.toDisabled === true && /has not been given \(unasked\)/.test(backButton.backWhy) &&
    /reads it/.test(backButton.backWhy),
    (backButton.backWhy || 'no tooltip').slice(0, 140));
  check('and pressing it anyway copies nothing and touches nothing under the shared root',
    backButton.touchedShared.length === 0 && backButton.arrived === false,
    backButton.touchedShared.join(', ') || 'no calls');

  /* WHAT AN ADOPTED SETTINGS FILE LOOKS LIKE.
     grantStorage replaces $.cfg wholesale with the shared folder's file, and
     $.cfg is not the menu: accent, scale and opacity are custom properties on
     the host and read-only is a class on it. Nothing re-read them — the only
     repaint in the sequence is Boot's rerender on 'paths:changed', which fires
     from inside $.setConsent BEFORE the adopt and writes none of the four. So
     read-only could come on with no badge and every mutating control would
     then refuse with a toast the panel gave no standing reason for. */
  const adoptedLook = await ev(() => {
    const G = window.GigaHack, U = G.ui;
    const host = U.getHost();
    const wasLook = {
      accent: G.cfg.ui.accent, scale: G.cfg.ui.scale,
      opacity: G.cfg.ui.opacity, readonly: !!G.cfg.behaviour.readonly
    };
    const SHARED_ROOT = '/Users/p/Library/Application Support/GigaHack';
    window.__su.mk({
      '/disk/CardOne/gigahack-userdata/settings.json': JSON.stringify({
        _schema: 5, ui: { accent: '#00aa00', scale: 1 }, behaviour: { readonly: false }
      }),
      /* What 2.1.0 left there, or what a hand-restored backup put back. */
      [SHARED_ROOT + '/cardone/settings.json']: JSON.stringify({
        _schema: 5, ui: { accent: '#aa0000', scale: 1.4 }, behaviour: { readonly: true }
      })
    });
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    G.store.loadSettings();
    /* At the moment of granting, the overlay is wearing the game's OWN
       settings — so put it in that state rather than inheriting whatever the
       check before this one left on the host. A check whose starting state
       comes from its neighbour proves nothing about either. */
    U.apply({
      accent: G.cfg.ui.accent, scale: G.cfg.ui.scale,
      opacity: G.cfg.ui.opacity, readonly: !!G.cfg.behaviour.readonly
    });
    const before = {
      accent: host.root.style.getPropertyValue('--mm-accent'),
      scale: host.root.style.getPropertyValue('--mm-scale'),
      ro: host.root.classList.contains('mm-ro'),
      cfgAccent: G.cfg.ui.accent
    };
    const r = G.store.grantStorage();
    const after = {
      cfgAccent: G.cfg.ui.accent, cfgScale: G.cfg.ui.scale, readOnly: G.isReadOnly(),
      accent: host.root.style.getPropertyValue('--mm-accent'),
      scale: host.root.style.getPropertyValue('--mm-scale'),
      ro: host.root.classList.contains('mm-ro'),
      adopted: r.adopted, applied: (r.applied || []).slice(), why: r.why || ''
    };
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    /* The overlay is shared with every check after this one. */
    U.apply(wasLook);
    return { before: before, after: after };
  });
  check('an adopted settings file is on screen, not only in $.cfg: the accent and the scale the grant took on are ' +
    'what the overlay is wearing afterwards',
    adoptedLook.before.accent === '#00aa00' && adoptedLook.after.adopted === true &&
    adoptedLook.after.cfgAccent === '#aa0000' && adoptedLook.after.accent === '#aa0000' &&
    adoptedLook.after.cfgScale === 1.4 && adoptedLook.after.scale === '1.4',
    JSON.stringify(adoptedLook.after).slice(0, 200));
  check('and read-only arriving with an adopted file turns the badge on and is named in what the answer reports, ' +
    'rather than being a refusal with no standing reason',
    adoptedLook.before.ro === false && adoptedLook.after.readOnly === true &&
    adoptedLook.after.ro === true &&
    adoptedLook.after.applied.join(' | ').indexOf('read-only mode, which is now ON') > -1 &&
    /repainted to match/.test(adoptedLook.after.why),
    adoptedLook.after.applied.join(' | ') + ' — ' + adoptedLook.after.why.slice(0, 120));

  /* ------------------------------------------------- shared between games */
  const writer = await ev(() => {
    const G = window.GigaHack;
    window.__su.mk({
      /* What another game left in the cross-game file, and what this game has
         beside it. Both are needed: with no per-game file the grant seeds the
         shared one from this game and this game becomes the last writer, which
         is correct behaviour and the wrong scenario for this check. */
      '/Users/p/Library/Application Support/GigaHack/_shared/settings.json': JSON.stringify({
        sections: { ui: { accent: '#123456' } },
        writers: {
          ui: { game: 'Another Game', gameKey: 'another', at: '2026-01-01T00:00:00.000Z', version: '2.2.0' }
        }
      }),
      '/Users/p/Library/Application Support/GigaHack/cardone/settings.json':
        JSON.stringify({ _schema: 5, ui: { scale: 1 } })
    });
    const savedCfg = G.cfg;
    /* Granting adopts a settings file and PUTS IT ON SCREEN, which outlives
       $.cfg being restored by reference: the accent is a custom property on
       the host and read-only is a class on it. */
    const wasLook = {
      accent: G.cfg.ui.accent, scale: G.cfg.ui.scale,
      opacity: G.cfg.ui.opacity, readonly: !!G.cfg.behaviour.readonly
    };
    const restore = window.__su.live('CardOne');
    G.store.grantStorage();
    const root = window.__su.panel('settings', 'Storage');
    const out = {
      text: root.textContent,
      wroteIt: (G.store.sharedWriters().ui || {}).game,
      adoptedAccent: G.cfg.ui.accent,
      /* Read off the panel, not off the store: a row per section, each showing
         the state the store reports for it. */
      rows: (function () {
        const out = [];
        const rows = root.querySelectorAll('.mm-cbrow');
        for (let i = 0; i < rows.length; i++) {
          const lab = rows[i].querySelector('.mm-lab');
          const box = rows[i].querySelector('.mm-check');
          out.push((lab ? lab.textContent.split(' ')[0] : '?') + ':' + (box && box.classList.contains('mm-on')));
        }
        return out;
      })()
    };
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    G.ui.apply(wasLook);
    return out;
  });
  /* The attribution is the row's own sub-label — 'from <game>' beside the section
     name — rather than a sentence under it. Same claim, one copy of it. */
  check('the panel names which game last wrote each shared section, because a setting nobody here changed is otherwise unattributable',
    writer.wroteIt === 'Another Game' && /from Another Game/.test(writer.text) &&
    writer.adoptedAccent === '#123456', writer.wroteIt + ' / ' + writer.adoptedAccent);
  check('and it offers a row per shareable section, with appearance and behaviour on and hotkeys off',
    writer.rows.join(',') === 'ui:true,behaviour:true,hotkeys:false', writer.rows.join(','));

  const claimedBind = await ev(() => {
    const G = window.GigaHack;
    const claimed = G.profile.claimedKeys();
    const claimedCode = Object.keys(claimed)[0] || null;
    const freeCode = ['F13', 'F14', 'F15'].filter(function (c) { return !claimed[c]; })[0] || null;
    window.__su.mk({
      '/Users/p/Library/Application Support/GigaHack/_shared/settings.json': JSON.stringify({
        sections: { hotkeys: { godMode: claimedCode, noclip: freeCode } },
        writers: {
          hotkeys: { game: 'Another Game', gameKey: 'another', at: '2026-01-01T00:00:00.000Z', version: '2.2.0' }
        }
      })
    });
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    G.setConsent('granted');
    G.store.setShared('hotkeys', true);
    const rep = G.store.sharedHotkeyReport();
    const root = window.__su.panel('settings', 'Storage');
    const out = {
      text: root.textContent,
      claimedCode: claimedCode, freeCode: freeCode,
      claimant: claimed[claimedCode],
      skipped: rep ? rep.skipped.map(function (s) { return s.id + ':' + s.code + ':' + s.claimedBy; }) : [],
      applied: rep ? rep.applied.map(function (a) { return a.id + ':' + a.code; }) : [],
      godKept: G.cfg.hotkeys.godMode,
      noclipTook: G.cfg.hotkeys.noclip
    };
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return out;
  });
  check('a shared bind on a key this game has claimed is not applied, and the panel names the claimant',
    claimedBind.skipped.length === 1 &&
    claimedBind.skipped[0] === 'godMode:' + claimedBind.claimedCode + ':' + claimedBind.claimant &&
    claimedBind.godKept !== claimedBind.claimedCode &&
    /not taken/.test(claimedBind.text) && /this game claims it/.test(claimedBind.text),
    claimedBind.skipped.join(' | '));
  check('and a shared bind on a key this game leaves free is taken, and the panel says where it came from',
    claimedBind.applied.indexOf('noclip:' + claimedBind.freeCode) > -1 &&
    claimedBind.noclipTook === claimedBind.freeCode &&
    /from the shared set/.test(claimedBind.text), claimedBind.applied.join(','));

  /* =======================================================================
     THREE PANELS THAT WERE FROZEN

     Each one changes the thing behind the panel and runs the clock by hand.
     Reading the panel once would pass on a frozen panel too, which is the
     whole reason these are here.
     ==================================================================== */
  const envLive = await ev(() => {
    const G = window.GigaHack;
    const root = window.__su.panel('debug', 'Environment');
    const wasScene = SceneManager._scene;
    const wasSystem = window.$dataSystem;
    const sceneRow = window.__su.row(root, 'Scene');
    const before = {
      scene: window.__su.rowValue(root, 'Scene'),
      vars: window.__su.rowValue(root, 'Variables')
    };

    function Scene_CheckOnly() { }
    SceneManager._scene = new Scene_CheckOnly();
    /* The other half of the same defect: a tab built during boot reads
       "loading…" into these rows and, until now, went on reading it for the
       rest of the session because nothing asked again. */
    window.$dataSystem = { gameTitle: 'A Later Title', variables: new Array(9), switches: new Array(5) };
    window.__su.tick();

    const after = {
      scene: window.__su.rowValue(root, 'Scene'),
      game: window.__su.rowValue(root, 'Game'),
      vars: window.__su.rowValue(root, 'Variables'),
      /* The same node, written into — not a panel rebuilt around it, which
         would have taken every expanded group and armed button with it. */
      sameNode: window.__su.row(window.__su.content(), 'Scene') === sceneRow,
      stillMounted: document.body.contains(sceneRow)
    };

    SceneManager._scene = wasScene;
    window.$dataSystem = wasSystem;
    window.__su.tick();
    return {
      before: before, after: after,
      restored: window.__su.rowValue(root, 'Scene'),
      wasName: wasScene.constructor.name
    };
  });
  check('the Environment panel follows the scene it has always claimed was live',
    envLive.before.scene !== 'Scene_CheckOnly' && envLive.after.scene === 'Scene_CheckOnly' &&
    envLive.restored === envLive.wasName,
    envLive.before.scene + ' → ' + envLive.after.scene + ' → ' + envLive.restored);
  check('and a row that read "loading…" because the tab was built during boot stops reading it',
    envLive.after.game === 'A Later Title' && envLive.after.vars === '8' &&
    envLive.before.vars !== '8', envLive.before.vars + ' → ' + envLive.after.vars);
  check('the repaint writes into the rows the builder made, rather than rebuilding the panel around them',
    envLive.after.sameNode === true && envLive.after.stillMounted === true,
    JSON.stringify({ same: envLive.after.sameNode, mounted: envLive.after.stillMounted }));

  const indexLive = await ev(() => {
    const G = window.GigaHack;
    const X = G.index;
    const real = X.status;
    let phase = 'building', progress = 0.25, stage = 'maps', notes = [];
    X.status = function () {
      return {
        phase: phase, progress: progress, stage: stage, built: null, fromCache: false,
        timings: [], notes: notes.slice(), error: null, counts: { maps: 3 }
      };
    };
    const root = window.__su.panel('debug', 'Index');
    const phaseRow = window.__su.row(root, 'Phase');
    const before = {
      phase: window.__su.rowValue(root, 'Phase'),
      progress: window.__su.rowValue(root, 'Progress'),
      refresh: !!window.__su.btn(root, 'refresh'),
      rebuild: !!window.__su.btn(root, 'Rebuild index')
    };
    phase = 'ready'; progress = 1; stage = ''; notes = ['one map would not parse'];
    window.__su.tick();
    const after = {
      phase: window.__su.rowValue(root, 'Phase'),
      progress: window.__su.rowValue(root, 'Progress'),
      notes: root.textContent.indexOf('one map would not parse') > -1,
      sameNode: window.__su.row(window.__su.content(), 'Phase') === phaseRow
    };
    X.status = real;
    window.__su.tick();
    return { before: before, after: after };
  });
  check('the Index panel follows the build it is watching instead of offering a button labelled refresh',
    indexLive.before.phase === 'building' && indexLive.before.progress.indexOf('25%') === 0 &&
    indexLive.after.phase === 'ready' && indexLive.after.progress.indexOf('100%') === 0 &&
    indexLive.before.refresh === false && indexLive.before.rebuild === true,
    JSON.stringify(indexLive));
  check('and a note that arrives after the panel was built appears without the panel being rebuilt around it',
    indexLive.after.notes === true && indexLive.after.sameNode === true,
    JSON.stringify(indexLive.after));

  const backupsLive = await ev(() => {
    const G = window.GigaHack;
    const wasFs = G.caps.fs;
    const meta = JSON.stringify({ at: '2026-01-01T00:00:00.000Z', reason: 'teleport', files: ['x.rmmzsave'] });
    const m = window.__su.mk({
      '/disk/CardOne/gigahack-userdata/backups/2026-01-01-000000/gigahack-backup.json': meta
    });
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    /* $.caps.fs is settled at boot from the real environment; the injected one
       arrived afterwards, and B.available() asks the capability rather than
       the module. Put back below. */
    G.caps.fs = true;
    const available = G.backup.available();
    const root = window.__su.panel('debug', 'Backups');
    const before = {
      rows: root.querySelectorAll('.mm-tr').length,
      tag: root.textContent.indexOf('teleport') > -1
    };
    /* What another panel does before a dangerous action, while this one is open. */
    m.add('/disk/CardOne/gigahack-userdata/backups/2026-01-02-000000/gigahack-backup.json',
      JSON.stringify({ at: '2026-01-02T00:00:00.000Z', reason: 'instant win', files: ['x.rmmzsave'] }));
    window.__su.tick();
    const after = {
      rows: root.querySelectorAll('.mm-tr').length,
      hasNew: root.textContent.indexOf('instant win') > -1
    };
    G.caps.fs = wasFs;
    restore();
    G.cfg = savedCfg;
    return { available: available, before: before, after: after };
  });
  check('the Backups panel notices a backup another panel took while it was open',
    backupsLive.available === true && backupsLive.before.rows === 1 &&
    backupsLive.before.tag === true && backupsLive.after.rows === 2 &&
    backupsLive.after.hasNew === true, JSON.stringify(backupsLive));

  /* A SAVE WRITTEN OVER A SLOT THAT ALREADY HAD ONE.
     The signal was the sorted list of file NAMES in two directories, and the
     row it feeds — "Newest", which is B.saveFiles() sorted by mtime — changes
     when no name does: an autosave, or an event saving to an occupied slot,
     adds and removes nothing. The signal was byte-identical, the hook returned
     at once, and a row under a group tagged 'live' went on naming the wrong
     file for as long as the panel stayed open.

     Driven against the fs model as it is: it advances a file's modification
     time on every write, so "written over" is a state the model can actually
     be put into. It could not when this was first written — every file carried
     one constant mtime — and the check wrapped statSync to carry a time of its
     own, which proved the panel against a test double rather than against the
     model. The model was fixed instead. Everything here is the production
     panel and the production signal. */
  const rewrittenSave = await ev(() => {
    const G = window.GigaHack;
    const wasFs = G.caps.fs;
    const m = window.__su.mk();
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    G.caps.fs = true;

    /* The save directory is the engine's, not the mod's: asked for at call
       time rather than reconstructed, so the check asks for it too. */
    const dir = String(G.backup.saveDir() || '').replace(/\/$/, '');
    const ext = G.caps.saveExt;
    const one = dir + '/file1' + ext, two = dir + '/file2' + ext;
    m.add(one, 'SLOT-ONE');
    m.add(two, 'SLOT-TWO');               /* written second, so it is the newest */

    const root = window.__su.panel('debug', 'Backups');
    const before = {
      files: window.__su.rowValue(root, 'Files'),
      newest: window.__su.rowValue(root, 'Newest')
    };

    /* The game saves over slot one — an autosave, or an event saving to a slot
       that already has a file. No name arrives and none goes away. */
    m.add(one, 'SLOT-ONE-REWRITTEN');
    window.__su.tick();
    const after = {
      files: window.__su.rowValue(root, 'Files'),
      newest: window.__su.rowValue(root, 'Newest')
    };

    G.caps.fs = wasFs;
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return { before: before, after: after, one: 'file1' + ext, two: 'file2' + ext };
  });
  check('the Backups panel sees a save written OVER an existing slot, which adds and removes no file name at all: ' +
    '"Newest" follows the write instead of naming the file it displaced',
    rewrittenSave.before.files === '2' && rewrittenSave.before.newest === rewrittenSave.two &&
    rewrittenSave.after.files === '2' && rewrittenSave.after.newest === rewrittenSave.one,
    rewrittenSave.before.newest + ' → ' + rewrittenSave.after.newest +
    ' (expected ' + rewrittenSave.one + ')');

  /* AN ARMED "restore" IS A TWO-CLICK CONTRACT, AND THE PAINT REBUILDS ROWS.
     A backup taken by any other panel between the two clicks would replace the
     armed button with a fresh unarmed one, so the second click landed on
     nothing and the user got a random sub-700ms slice of the 2600ms window.
     Trace → Journal holds off for exactly this; this one did not. */
  const armedRestore = await ev(() => {
    const G = window.GigaHack;
    const wasFs = G.caps.fs;
    const m = window.__su.mk({
      '/disk/CardOne/gigahack-userdata/backups/2026-01-01-000000/gigahack-backup.json':
        JSON.stringify({ at: '2026-01-01T00:00:00.000Z', reason: 'teleport', files: ['x.rmmzsave'] })
    });
    const savedCfg = G.cfg;
    const restore = window.__su.live('CardOne');
    G.caps.fs = true;
    const root = window.__su.panel('debug', 'Backups');
    const table = root.querySelector('.mm-table') || root;
    const arm = window.__su.btn(table, 'restore');
    arm.click();                                   /* first click: arms */
    const armedNow = !!table.querySelector('.mm-armed');

    /* What another panel does before a dangerous action, mid-confirm. */
    m.add('/disk/CardOne/gigahack-userdata/backups/2026-01-02-000000/gigahack-backup.json',
      JSON.stringify({ at: '2026-01-02T00:00:00.000Z', reason: 'instant win', files: ['x.rmmzsave'] }));
    window.__su.tick();
    /* Re-queried after the tick: a detached node keeps the classes it was
       wearing, so holding the old one would answer about a button that is no
       longer on screen. */
    const held = {
      stillArmed: !!table.querySelector('.mm-armed'),
      label: (table.querySelector('.mm-armed') || {}).textContent || '',
      rows: table.querySelectorAll('.mm-tr').length
    };

    /* Let the arm lapse — mmButton does this on a 2600ms timer, and a check
       that waits for it is a check that sleeps. The hold does not CONSUME the
       signal, so the repaint it deferred must arrive on the next tick. */
    const armedEl = table.querySelector('.mm-armed');
    if (armedEl) armedEl.classList.remove('mm-armed');
    window.__su.tick();
    const after = {
      rows: table.querySelectorAll('.mm-tr').length,
      hasNew: root.textContent.indexOf('instant win') > -1
    };

    G.caps.fs = wasFs;
    G.store.flush();
    restore();
    G.cfg = savedCfg;
    return { armedNow: armedNow, held: held, after: after };
  });
  check('a backup taken by another panel while "restore" is armed does not disarm it under the reader\'s cursor',
    armedRestore.armedNow === true && armedRestore.held.stillArmed === true &&
    armedRestore.held.rows === 1 && /overwrite saves\?/.test(armedRestore.held.label),
    JSON.stringify(armedRestore.held));
  check('and the repaint it held onto arrives on the first tick after the arm lapses, rather than being lost with ' +
    'the tick that landed during it',
    armedRestore.after.rows === 2 && armedRestore.after.hasNew === true,
    JSON.stringify(armedRestore.after));

  /* =======================================================================
     PUT EVERYTHING BACK
     ==================================================================== */
  const restored = await ev((was) => {
    const G = window.GigaHack;
    /* The move report names two directories, and they are not the ones in use
       any more. This is the event the mod itself uses to say so. */
    G.emit('paths:changed', { was: null, now: G.paths.dataDir, why: 'the checks put the environment back' });
    G.ui.hideStorageCard();
    G.cfg.ui.tab = was.tab;
    G.cfg.ui.sub = was.sub;
    G.ui.setOpen(was.open);
    G.ui.rerender();
    return {
      mode: G.paths.mode,
      consent: G.paths.consent,
      nwjs: G.env.nwjs,
      fs: G.env.fs,
      capsFs: G.caps.fs,
      card: !!window.__su.card(),
      tab: G.cfg.ui.tab,
      scene: typeof SceneManager._scene,
      indexStatus: typeof G.index.status() === 'object'
    };
  }, opening);
  check('the environment, the paths and the overlay are where the rest of the suite left them',
    restored.mode === opening.mode && restored.consent === 'moot' && restored.nwjs === false &&
    restored.fs === null && restored.capsFs === opening.capsFs && restored.card === false &&
    restored.tab === opening.tab && restored.indexStatus === true,
    JSON.stringify(restored));
};
