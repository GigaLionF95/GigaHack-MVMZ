/* =============================================================================
   GigaHack test harness — stubs/x-audio.js
   AUDIO: everything that is IDENTICAL on RPG Maker MV 1.6.1 and MZ 1.9.0.

   Modelled on the shipped engine source, file:line on every group.
   Line references: MV = MV rpg_*.js, MZ = MZ rmmz_*.js.
   A single reference means the two engines are byte-identical there.

   Loaded immediately after core.js. core.js ships a one-method placeholder
   `var AudioManager = { stopAll: function () { } };` (core.js:264) — this file
   fills that same object in rather than rebinding it, so anything that already
   captured the reference keeps working. Everything referenced here is either
   defined by core.js or defined below; nothing is guarded, so a missing
   dependency throws at load rather than degrading into a passing test.

   WHAT IS DELIBERATELY NOT HERE, because the two engines disagree and the
   disagreement is the point (see x-audio-mv.js / x-audio-mz.js):
     playBgm / playBgs / playMe / playSe — the folder argument to createBuffer
       is 'bgm' on MV and 'bgm/' on MZ, and MV's playBgm has an encrypted-audio
       branch MZ does not.
     stopBgm / stopBgs / stopMe / stopSe / cleanupSe — MV calls buffer.stop(),
       MZ calls buffer.destroy(), and cleanupSe is MZ-only.
     createBuffer / audioFileExt / checkErrors — different bodies entirely.
     playStaticSe / loadStaticSe / isStaticSe — MV keys the static cache on
       buffer._reservedSeName, MZ on buffer.name.
     Everything on WebAudio except the six members below.
   ========================================================================== */

/* -------------------------------------------------------------------------
   A FAKE AUDIO GRAPH.

   WebAudio must not need a real AudioContext — the harness browser would give
   us one, but a suspended context, a decode that never resolves and a clock we
   cannot advance turn every audio assertion into a race. So the CONTEXT is
   faked and everything the engine does with it is real: the node graph is
   built with the engine's own call order, every gain ramp is recorded, and
   currentTime advances off window.__clock, which core.js's __raf.flush() moves
   by exactly one frame. seek() therefore returns a number that moves when the
   game runs and stands still when it does not.

   What is NOT modelled: decodeAudioData (both engines' load paths are replaced
   below), the ogg/m4a loop-comment readers (_readOgg/_readMp4/_readMetaData),
   and VorbisDecoder. __audioLoop lets a test inject the loop points those
   readers would have produced, so the engine's own loop arithmetic still runs.
   ---------------------------------------------------------------------- */
function FakeAudioParam(value) {
  this.value = value;
  this.events = [];          /* every scheduled change, in order */
}
FakeAudioParam.prototype.setValueAtTime = function (value, time) {
  this.value = value; this.events.push(['set', value, time]); return this;
};
FakeAudioParam.prototype.linearRampToValueAtTime = function (value, time) {
  this.rampTo = value; this.rampEnd = time; this.events.push(['ramp', value, time]); return this;
};
FakeAudioParam.prototype.cancelScheduledValues = function (time) {
  this.events.push(['cancel', time]); return this;
};

function FakeAudioNode(kind) {
  this.kind = kind;
  this.connected = [];
  this.started = null; this.stopped = null;
  this.gain = new FakeAudioParam(1);
  this.playbackRate = new FakeAudioParam(1);
  this.buffer = null;
  this.loop = false; this.loopStart = 0; this.loopEnd = 0;
  this.panningModel = ''; this.position = null;
  this.onended = null;
}
FakeAudioNode.prototype.connect = function (node) { this.connected.push(node); return node; };
FakeAudioNode.prototype.disconnect = function () { this.connected.length = 0; };
FakeAudioNode.prototype.start = function (when, offset, duration) {
  this.started = { when: when, offset: offset, duration: duration };
};
FakeAudioNode.prototype.stop = function (when) { this.stopped = { when: when }; };
FakeAudioNode.prototype.setPosition = function (x, y, z) { this.position = [x, y, z]; };

/* The three members both engines touch on the context object itself:
   currentTime (MV reads WebAudio._context.currentTime directly, MZ goes
   through WebAudio._currentTime()), destination, and the three factories. */
window.__makeAudioContext = function () {
  return {
    state: 'running',
    get currentTime() { return window.__clock / 1000; },
    destination: new FakeAudioNode('destination'),
    createGain: function () { return new FakeAudioNode('gain'); },
    createPanner: function () { return new FakeAudioNode('panner'); },
    createBufferSource: function () { return new FakeAudioNode('source'); },
    resume: function () { this.state = 'running'; return { then: function (f) { f(); } }; }
  };
};

/* -------------------------------------------------------------------------
   THE LOADING SEAM.

   Both engines fetch audio over the network and both treat "the file is not
   there" as a state the buffer carries rather than an exception at the call
   site — which is why a wrong extension, a wrong folder or an encryption
   mismatch shows up much later, as silence plus one flag. That whole shape is
   preserved; only the transport is faked.

     __audioLoads   every url a buffer actually asked for, in order, AFTER the
                    engine's own encryption rewrite. The single most useful
                    audio observable: it is what proves .ogg vs .m4a,
                    encodeURIComponent vs Utils.encodeURI, and 'bgm/' vs 'bgm'.
     __audioExists  function(url) -> boolean. Point it at the fixture file
                    table to make a missing file really fail to load.
     __audioAsync   true holds every load at "not ready" until __audioSettle()
                    runs. This is the only way to reach the deferred branch of
                    WebAudio.play(), where play() registers a load listener
                    instead of playing — the branch a mod that plays a sound
                    the instant it is created actually takes.
     __audioLoop    {start, length, sampleRate} standing in for what
                    _readLoopComments would have parsed out of the file.
     __audioDuration  what the decoded buffer claims, in seconds.
   ---------------------------------------------------------------------- */
window.__audioLoads = [];
window.__audioPending = [];
window.__audioAsync = false;
window.__audioDuration = 6;
window.__audioLoop = null;
window.__audioExists = function () { return true; };
window.__audioSettle = function () {
  var batch = window.__audioPending;
  window.__audioPending = [];
  for (var i = 0; i < batch.length; i++) {
    try { batch[i](); } catch (e) { window.__errors.push('audio settle: ' + e.message); }
  }
  return batch.length;
};
/* A buffer's decoded state, assembled the way the engine's decode callback
   assembles it. Called by each engine's own _load replacement, which then runs
   that engine's own field assignments — the shapes differ (_buffer vs
   _buffers, _loopStart vs _loopStartTime) so the assignment stays over there. */
window.__audioFakeBuffer = function () {
  return { duration: window.__audioDuration, sampleRate: 44100 };
};
window.__audioReset = function () {
  AudioManager.stopAll();
  AudioManager._staticBuffers = [];
  AudioManager._currentBgm = null;
  AudioManager._currentBgs = null;
  window.__audioLoads = [];
  window.__audioPending = [];
  window.__audioAsync = false;
  window.__audioLoop = null;
};

/* -------------------------------------------------------------------------
   Utils.isMobileDevice. Both engines have it and BOTH audio paths go through
   it — MV's audioFileExt picks .m4a on mobile, and _shouldMuteOnHide is a
   mobile-only behaviour on both. The regexes are NOT identical (MV lists
   IEMobile, MZ dropped it), so the function itself is defined per engine;
   this note is here so the next reader does not add a shared copy.
   MV rpg_core.js:217 / MZ rmmz_core.js:251.
   ---------------------------------------------------------------------- */

/* =========================================================================
   WebAudio — the shared surface.

   The constructor shape is the same on both (`this.initialize.apply(this,
   arguments)` on MV rpg_core.js:7670, `this.initialize(...arguments)` on MZ
   rmmz_core.js:4684 — same semantics, and ES5 here forces apply either way).
   prototype.initialize itself differs and lives per engine.
   ====================================================================== */
function WebAudio() {
  this.initialize.apply(this, arguments);
}

/* url getter — MV rpg_core.js:7950 / MZ rmmz_core.js:4850. Byte-identical,
   and READ-ONLY on both: AudioManager.checkErrors reports webAudio.url, so a
   stub with a plain writable field would let a test set the url it wanted to
   see reported. */
Object.defineProperty(WebAudio.prototype, 'url', {
  get: function () { return this._url; },
  configurable: true
});

/* pan — MV rpg_core.js:8003 / MZ rmmz_core.js:4906. Identical: the setter
   stores and calls _updatePanner, which is a no-op until a panner node exists.
   updateBufferParameters writes volume, pitch and pan in that order, so pan
   lands on a buffer that has not been played yet and is applied at play time. */
Object.defineProperty(WebAudio.prototype, 'pan', {
  get: function () { return this._pan; },
  set: function (value) { this._pan = value; this._updatePanner(); },
  configurable: true
});

/* MV rpg_core.js:8144 / MZ rmmz_core.js:5041 — byte-identical. */
WebAudio.prototype.addLoadListener = function (listner) {
  this._loadListeners.push(listner);
};
/* MV rpg_core.js:8154 / MZ rmmz_core.js:5050 — byte-identical. AudioManager
   .playMe hangs stopMe off this one, which is how a ME hands the BGM back. */
WebAudio.prototype.addStopListener = function (listner) {
  this._stopListeners.push(listner);
};

/* MV rpg_core.js:8306 / MZ rmmz_core.js:5423 — byte-identical, and it SHIFTS
   rather than iterating, so a listener that re-registers itself does not spin. */
WebAudio.prototype._onLoad = function () {
  while (this._loadListeners.length > 0) {
    var listner = this._loadListeners.shift();
    listner();
  }
};

/* MV rpg_core.js:8294 / MZ rmmz_core.js:5415 — byte-identical. */
WebAudio.prototype._updatePanner = function () {
  if (this._pannerNode) {
    var x = this._pan;
    var z = 1 - Math.abs(x);
    this._pannerNode.setPosition(x, 0, z);
  }
};

/* MV rpg_core.js:8283 / MZ rmmz_core.js:5408 — byte-identical. */
WebAudio.prototype._removeEndTimer = function () {
  if (this._endTimer) {
    clearTimeout(this._endTimer);
    this._endTimer = null;
  }
};

/* WebAudio._onVisibilityChange / _onHide — MV rpg_core.js:7849 / :7862,
   MZ rmmz_core.js:4757 / :4765. Byte-identical. _onShow is NOT identical
   (MV fades in over 0.5s, MZ over 1s) and neither is _shouldMuteOnHide
   (MZ ands in !window.navigator.standalone); both live per engine. */
WebAudio._onVisibilityChange = function () {
  if (document.visibilityState === 'hidden') {
    this._onHide();
  } else {
    this._onShow();
  }
};
WebAudio._onHide = function () {
  if (this._shouldMuteOnHide()) {
    this._fadeOut(1);
  }
};

/* =========================================================================
   AudioManager — the shared fields.

   MV rpg_managers.js:1104-1118 / MZ rmmz_managers.js:1107-1119. The lists are
   the same except for two MV-only fields (_masterVolume, _blobUrl), which are
   in x-audio-mv.js. _seBuffers and _staticBuffers are the two that matter to a
   panel: _seBuffers is churn, _staticBuffers is a cache that is never emptied
   by anything the engine calls.

   NOT redefined here: ConfigManager's bgmVolume/bgsVolume/meVolume/seVolume,
   which are a different class and a different owner. AudioManager's own
   accessors below are the sink those write into.
   ====================================================================== */
AudioManager._bgmVolume = 100;
AudioManager._bgsVolume = 100;
AudioManager._meVolume = 100;
AudioManager._seVolume = 100;
AudioManager._currentBgm = null;
AudioManager._currentBgs = null;
AudioManager._bgmBuffer = null;
AudioManager._bgsBuffer = null;
AudioManager._meBuffer = null;
AudioManager._seBuffers = [];
AudioManager._staticBuffers = [];
AudioManager._replayFadeTime = 0.5;
AudioManager._path = 'audio/';

/* The four volume accessors — MV rpg_managers.js:1132/:1143/:1154/:1165,
   MZ rmmz_managers.js:1121/:1132/:1143/:1154. Byte-identical on both, and all
   four are `configurable: true`, which is exactly why a mod can redefine them.

   Two things a convenient stub would flatten and both are traps:
     · meVolume's setter reads this._currentMe — a field NOTHING ever assigns
       on either engine. updateMeParameters(undefined) therefore falls through
       updateBufferParameters' `if (buffer && audio)` and the running ME does
       not change volume. That is the engine's behaviour, bug and all.
     · seVolume's setter does NOT update anything. SE volume applies to the
       NEXT sound played, never to the ones already in _seBuffers.
   ====================================================================== */
Object.defineProperty(AudioManager, 'bgmVolume', {
  get: function () { return this._bgmVolume; },
  set: function (value) { this._bgmVolume = value; this.updateBgmParameters(this._currentBgm); },
  configurable: true
});
Object.defineProperty(AudioManager, 'bgsVolume', {
  get: function () { return this._bgsVolume; },
  set: function (value) { this._bgsVolume = value; this.updateBgsParameters(this._currentBgs); },
  configurable: true
});
Object.defineProperty(AudioManager, 'meVolume', {
  get: function () { return this._meVolume; },
  set: function (value) { this._meVolume = value; this.updateMeParameters(this._currentMe); },
  configurable: true
});
Object.defineProperty(AudioManager, 'seVolume', {
  get: function () { return this._seVolume; },
  set: function (value) { this._seVolume = value; },
  configurable: true
});

/* replayBgm / replayBgs — MV rpg_managers.js:1213 / :1278,
   MZ rmmz_managers.js:1180 / :1248. Byte-identical.
   Note the order: playBgm FIRST, fadeIn SECOND. The fade is applied to a
   buffer that is already playing, and only if playBgm actually produced one —
   which it does not when bgm.name is ''. */
AudioManager.replayBgm = function (bgm) {
  if (this.isCurrentBgm(bgm)) {
    this.updateBgmParameters(bgm);
  } else {
    this.playBgm(bgm, bgm.pos);
    if (this._bgmBuffer) {
      this._bgmBuffer.fadeIn(this._replayFadeTime);
    }
  }
};
AudioManager.replayBgs = function (bgs) {
  if (this.isCurrentBgs(bgs)) {
    this.updateBgsParameters(bgs);
  } else {
    this.playBgs(bgs, bgs.pos);
    if (this._bgsBuffer) {
      this._bgsBuffer.fadeIn(this._replayFadeTime);
    }
  }
};

/* isCurrentBgm / isCurrentBgs — MV rpg_managers.js:1224 / :1289,
   MZ rmmz_managers.js:1191 / :1259. Identical (MZ only reformats).
   They compare NAME ONLY. Two requests for the same file at different volumes
   are "the same bgm", so playBgm takes the update branch and never restarts —
   which is why changing volume through playBgm works and changing the file
   through it restarts from zero. Note also it returns the _currentBgm OBJECT
   (truthy), not a boolean. */
AudioManager.isCurrentBgm = function (bgm) {
  return (this._currentBgm && this._bgmBuffer &&
    this._currentBgm.name === bgm.name);
};
AudioManager.isCurrentBgs = function (bgs) {
  return (this._currentBgs && this._bgsBuffer &&
    this._currentBgs.name === bgs.name);
};

/* updateBgmParameters / updateBgsParameters / updateMeParameters /
   updateSeParameters — MV rpg_managers.js:1229 / :1294 / :1343 / :1376,
   MZ rmmz_managers.js:1199 / :1267 / :1316 / :1358. Byte-identical.
   Only the SE one takes the buffer as an argument: there is no single "current
   SE" to update, which is the same reason seVolume's setter does nothing. */
AudioManager.updateBgmParameters = function (bgm) {
  this.updateBufferParameters(this._bgmBuffer, this._bgmVolume, bgm);
};
AudioManager.updateBgsParameters = function (bgs) {
  this.updateBufferParameters(this._bgsBuffer, this._bgsVolume, bgs);
};
AudioManager.updateMeParameters = function (me) {
  this.updateBufferParameters(this._meBuffer, this._meVolume, me);
};
AudioManager.updateSeParameters = function (buffer, se) {
  this.updateBufferParameters(buffer, this._seVolume, se);
};

/* updateCurrentBgm / updateCurrentBgs — MV rpg_managers.js:1233 / :1298,
   MZ rmmz_managers.js:1203 / :1271. Byte-identical.
   It builds a NEW five-key object rather than storing the caller's, so
   _currentBgm is never the same reference as the $dataMap.bgm the caller
   passed, and `pos` is the argument — undefined when playBgm was called with
   one argument. saveBgm then writes that undefined straight into the save. */
AudioManager.updateCurrentBgm = function (bgm, pos) {
  this._currentBgm = {
    name: bgm.name,
    volume: bgm.volume,
    pitch: bgm.pitch,
    pan: bgm.pan,
    pos: pos
  };
};
AudioManager.updateCurrentBgs = function (bgs, pos) {
  this._currentBgs = {
    name: bgs.name,
    volume: bgs.volume,
    pitch: bgs.pitch,
    pan: bgs.pan,
    pos: pos
  };
};

/* fadeOutBgm / fadeInBgm / fadeOutBgs / fadeInBgs / fadeOutMe —
   MV rpg_managers.js:1251 / :1258 / :1316 / :1323 / :1347,
   MZ rmmz_managers.js:1221 / :1228 / :1289 / :1296 / :1320. Byte-identical.

   fadeOutBgm NULLS _currentBgm while LEAVING _bgmBuffer alive and still
   playing out its ramp. That is the state a "what is playing right now" panel
   has to survive: the sound is audible and the manager says nothing is on.
   fadeOutMe does not null anything — the stop listener installed by playMe is
   what eventually runs stopMe. */
AudioManager.fadeOutBgm = function (duration) {
  if (this._bgmBuffer && this._currentBgm) {
    this._bgmBuffer.fadeOut(duration);
    this._currentBgm = null;
  }
};
AudioManager.fadeInBgm = function (duration) {
  if (this._bgmBuffer && this._currentBgm) {
    this._bgmBuffer.fadeIn(duration);
  }
};
AudioManager.fadeOutBgs = function (duration) {
  if (this._bgsBuffer && this._currentBgs) {
    this._bgsBuffer.fadeOut(duration);
    this._currentBgs = null;
  }
};
AudioManager.fadeInBgs = function (duration) {
  if (this._bgsBuffer && this._currentBgs) {
    this._bgsBuffer.fadeIn(duration);
  }
};
AudioManager.fadeOutMe = function (duration) {
  if (this._meBuffer) {
    this._meBuffer.fadeOut(duration);
  }
};

/* stopAll — MV rpg_managers.js:1423 / MZ rmmz_managers.js:1408. Byte-identical,
   AND the ORDER MATTERS: ME first. stopMe's tail restarts the BGM it
   interrupted, so calling stopBgm first would be immediately undone.
   This REPLACES core.js:264's empty placeholder; the four callees below it are
   per engine, so this is the shared method whose behaviour differs by engine.
   SceneManager.catchException calls it on both (MV :1958 / MZ :1975). */
AudioManager.stopAll = function () {
  this.stopMe();
  this.stopBgm();
  this.stopBgs();
  this.stopSe();
};

/* saveBgm / saveBgs / makeEmptyAudioObject — MV rpg_managers.js:1430 / :1445 /
   :1460, MZ rmmz_managers.js:1415 / :1430 / :1445. Byte-identical.

   `pos` is re-read from the LIVE buffer via seek(), not from _currentBgm.pos —
   so a save taken while the BGM plays records where it actually is, and a save
   taken after fadeOutBgm (which nulled _currentBgm but left the buffer)
   records the EMPTY object, not the fading track. That asymmetry is what a
   save-state audio readout has to render.
   makeEmptyAudioObject has THREE keys — no pan, no pos — so a round trip
   through it drops both. */
AudioManager.saveBgm = function () {
  if (this._currentBgm) {
    var bgm = this._currentBgm;
    return {
      name: bgm.name,
      volume: bgm.volume,
      pitch: bgm.pitch,
      pan: bgm.pan,
      pos: this._bgmBuffer ? this._bgmBuffer.seek() : 0
    };
  } else {
    return this.makeEmptyAudioObject();
  }
};
AudioManager.saveBgs = function () {
  if (this._currentBgs) {
    var bgs = this._currentBgs;
    return {
      name: bgs.name,
      volume: bgs.volume,
      pitch: bgs.pitch,
      pan: bgs.pan,
      pos: this._bgsBuffer ? this._bgsBuffer.seek() : 0
    };
  } else {
    return this.makeEmptyAudioObject();
  }
};
AudioManager.makeEmptyAudioObject = function () {
  return { name: '', volume: 0, pitch: 0 };
};

/* updateBufferParameters — MV rpg_managers.js:1476 / MZ rmmz_managers.js:1458.
   Byte-identical apart from MZ's added parentheses.

   The three divisors are the whole reason a volume readout is confusing:
   volume is a 0-100 config times a 0-100 audio value over 10000, so the gain
   node sees 0..1; pitch and pan are /100. `audio.volume || 0` means a volume of
   0 and a MISSING volume are the same thing, and the `if (buffer && audio)`
   guard is why meVolume's setter silently does nothing. */
AudioManager.updateBufferParameters = function (buffer, configVolume, audio) {
  if (buffer && audio) {
    buffer.volume = configVolume * (audio.volume || 0) / 10000;
    buffer.pitch = (audio.pitch || 0) / 100;
    buffer.pan = (audio.pan || 0) / 100;
  }
};

/* =========================================================================
   SoundManager.loadSystemSound / playSystemSound —
   MV rpg_managers.js:1532 / :1538, MZ rmmz_managers.js:1502 / :1508.
   BYTE-IDENTICAL on both engines, including the `if ($dataSystem)` guard and
   the UNGUARDED `$dataSystem.sounds[n]` inside it. A project whose System.json
   has no sounds array throws here, not at the call site.

   Added to core.js:258's SoundManager rather than replacing it. Two honest
   notes about that object, neither of which this file changes:
     · The real SoundManager is `function SoundManager() { throw ... }` on both
       engines (MV rpg_managers.js:1521 / MZ rmmz_managers.js:1491), a static
       CLASS, not an object literal — the same shape trap core.js:71-78
       documents for Utils. Anything testing `typeof SoundManager` is testing
       the harness, not the engine.
     · core.js's playSave/playLoad/playBuzzer/playOk are counters. The engine's
       are one line each — `this.playSystemSound(n)` — so they route through
       the two below and out to AudioManager.playStaticSe. A test that wants
       that chain must call playSystemSound directly.
   ====================================================================== */
SoundManager.loadSystemSound = function (n) {
  if ($dataSystem) {
    AudioManager.loadStaticSe($dataSystem.sounds[n]);
  }
};
SoundManager.playSystemSound = function (n) {
  if ($dataSystem) {
    AudioManager.playStaticSe($dataSystem.sounds[n]);
  }
};
