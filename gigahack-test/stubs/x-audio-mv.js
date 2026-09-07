/* =============================================================================
   GigaHack test harness — stubs/x-audio-mv.js
   AUDIO: the MV-ONLY surface. Modelled on MV rpg_core.js and
   rpg_managers.js (MV 1.6.1).

   Loaded immediately after engine-mv.js, which is loaded after x-audio.js.
   Everything shared — the AudioManager fields, the four volume accessors,
   replay/isCurrent/updateCurrent, the four fade methods, stopAll, saveBgm,
   saveBgs, makeEmptyAudioObject, updateBufferParameters,
   the WebAudio constructor and its six identical members, SoundManager's two
   system-sound methods, and the fake audio graph — is in x-audio.js and is NOT
   repeated here. This file is only what MV does differently.

   THE MV-ONLY THINGS THAT MATTER MOST:
     · AudioManager._masterVolume / masterVolume. MZ has no master volume at
       all. A panel offering one is offering an MV-only control.
     · stopBgm/stopBgs/stopMe/stopSe call buffer.stop(). MZ calls .destroy(),
       which does not exist here. A panel that calls destroy() on MV throws.
     · There is no cleanupSe on MV. MV prunes finished SE buffers at the TOP of
       playSe, so _seBuffers only ever shrinks when a new sound starts — the
       list a panel reads is stale by exactly one sound, permanently, and stays
       stale forever once the game goes quiet.
     · Decrypter, Html5Audio, canPlayOgg/canPlayM4a and shouldUseHtml5Audio all
       exist here and nowhere in MZ.
     · There is NO WebAudio.prototype.destroy and NO WebAudio.prototype.retry.
       Deliberately not defined: their absence is a capability probe's answer.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Utils.isMobileDevice — rpg_core.js:217. MZ's (rmmz_core.js:251) is the same
   shape with IEMobile dropped from the alternation. Both audio paths read it:
   audioFileExt picks .m4a on mobile (MZ's audioFileExt is a constant ".ogg"),
   and WebAudio._shouldMuteOnHide is mobile-only.
   ---------------------------------------------------------------------- */
Utils.isMobileDevice = function () {
  var r = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  return !!navigator.userAgent.match(r);
};

/* -------------------------------------------------------------------------
   Graphics.setVideoVolume — rpg_core.js:2169. MV-only, and it is called from
   AudioManager's masterVolume setter, so it must exist before that setter can
   run. MZ's equivalent is Video.setVolume (rmmz_core.js:5578) on a separate
   Video class, and nothing in MZ's AudioManager calls it — video volume and
   audio volume are wired together on MV and not on MZ.
   ---------------------------------------------------------------------- */
Graphics.setVideoVolume = function (value) {
  this._videoVolume = value;
  if (this._video) {
    this._video.volume = this._videoVolume;
  }
};

/* =========================================================================
   Decrypter — rpg_core.js:9149. MV-only as a class; MZ folded the same job
   into Utils (see x-audio-mz.js).

   Only the audio-relevant members are defined here: the two hasEncrypted*
   flags, the constants extToEncryptExt and the loaders read, and
   extToEncryptExt itself. decryptImg / decryptArrayBuffer / createBlobUrl /
   cutArrayHeader belong to the image and crypto surfaces and are left to
   whoever models those — defining them here would fight another stub.
   ====================================================================== */
function Decrypter() {
  throw new Error('This is a static class');
}

/* rpg_core.js:9153-9164. Both flags default FALSE and are set from
   $dataSystem.hasEncryptedImages/hasEncryptedAudio at boot, so a harness that
   never boots the data files reads "not encrypted" — which is why a test for
   the encrypted path has to set them by hand. */
Decrypter.hasEncryptedImages = false;
Decrypter.hasEncryptedAudio = false;
Decrypter._requestImgFile = [];
Decrypter._headerlength = 16;
Decrypter._xhrOk = 400;
Decrypter._encryptionKey = '';
Decrypter._ignoreList = [
  'img/system/Window.png'
];
Decrypter.SIGNATURE = '5250474d56000000';
Decrypter.VER = '000301';
Decrypter.REMAIN = '0000000000';

/* rpg_core.js:9166. */
Decrypter.checkImgIgnore = function (url) {
  for (var cnt = 0; cnt < this._ignoreList.length; cnt++) {
    if (url === this._ignoreList[cnt]) return true;
  }
  return false;
};

/* rpg_core.js:9253 — behaviour kept exactly, awkward parts included, because the awkward
   parts are the behaviour.

   `var encryptedExt = ext;` then reassigned in every branch including the
   else; the else branch assigns ext WITHOUT a leading dot while the three real
   branches include one; and the return slices at `url.lastIndexOf(ext) - 1`,
   which searches for the extension as a SUBSTRING ANYWHERE in the url. A file
   under audio/bgm/ogg-theme.ogg finds the LAST 'ogg' correctly, but the -1
   arithmetic means a url whose extension is not found at all slices at -1 and
   silently drops its last character.

   MZ replaced this whole scheme with a single appended "_"
   (WebAudio.prototype._realUrl, rmmz_core.js:5102). That is the single biggest
   audio difference between the engines: the encrypted filename on disk is
   Theme.rpgmvo on MV and Theme.ogg_ on MZ. */
Decrypter.extToEncryptExt = function (url) {
  var ext = url.split('.').pop();
  var encryptedExt = ext;

  if (ext === 'ogg') encryptedExt = '.rpgmvo';
  else if (ext === 'm4a') encryptedExt = '.rpgmvm';
  else if (ext === 'png') encryptedExt = '.rpgmvp';
  else encryptedExt = ext;

  return url.slice(0, url.lastIndexOf(ext) - 1) + encryptedExt;
};

/* rpg_core.js:9265 — splits the key into byte pairs. Unguarded: a project with
   no encryptionKey throws here. */
Decrypter.readEncryptionkey = function () {
  this._encryptionKey = $dataSystem.encryptionKey.split(/(.{2})/).filter(Boolean);
};

/* rpg_core.js:9199 — SHAPE ONLY. The engine's body is an XHR whose onload
   runs `if (this.status < Decrypter._xhrOk)`, decryptArrayBuffer, createBlobUrl
   and finally AudioManager.createDecryptBuffer(url, bgm, pos). Left out: the
   XMLHttpRequest, the XOR pass over the first 16 bytes, and
   window.URL.createObjectURL — none of which the harness can do without a real
   encrypted file, and none of which change the call order. What is kept is the
   part that matters: the request is recorded (so the .rpgmvo url is
   observable) and createDecryptBuffer is the thing that gets called, with a
   blob: url standing in for the real object url. */
Decrypter.decryptHTML5Audio = function (url, bgm, pos) {
  window.__audioLoads.push(url);
  window.__audioDecrypted = (window.__audioDecrypted || []).concat([url]);
  AudioManager.createDecryptBuffer('blob:' + url, bgm, pos);
};

/* =========================================================================
   WebAudio — the MV statics.
   ====================================================================== */

/* rpg_core.js:7674 — MV-only, and it decides whether every buffer gets a
   ResourceHandler retry loader. It is evaluated ONCE at script load against
   the global object. This harness ships no ResourceHandler stub, so it comes
   out TRUE and the retry path below is skipped — the same as a standalone
   rpg_core.js. If a loader stub ever lands before this file, the branch turns
   itself back on with no edit here, which is why it is copied rather than
   hard-coded. MZ has no _standAlone and no ResourceHandler at all. */
WebAudio._standAlone = (function (top) {
  return !top.ResourceHandler;
})(this);

/* rpg_core.js:7693-7697. MZ has _context/_masterGainNode/_masterVolume too but
   assigns them INSIDE WebAudio.initialize (rmmz_core.js:4699), and has no
   _initialized and no _unlocked. */
WebAudio._masterVolume = 1;
WebAudio._context = null;
WebAudio._masterGainNode = null;
WebAudio._initialized = false;
WebAudio._unlocked = false;

/* rpg_core.js:7707 — takes a noAudio flag and is IDEMPOTENT via _initialized.
   MZ's takes no argument and is not idempotent. The consequence is the one
   that bites a harness: on MV the constructor self-initialises on first use
   (see prototype.initialize below), so a WebAudio built before
   SceneManager.initAudio still works. On MZ it does not — a buffer created
   before initAudio has a null context and silently never loads. */
WebAudio.initialize = function (noAudio) {
  if (!this._initialized) {
    if (!noAudio) {
      this._createContext();
      this._detectCodecs();
      this._createMasterGainNode();
      this._setupEventHandlers();
    }
    this._initialized = true;
  }
  return !!this._context;
};

/* rpg_core.js:7727 / :7741 — MV-ONLY. MZ has Utils.canPlayOgg
   (rmmz_core.js:339) and no m4a probe at all, because MZ ships ogg only.
   Both lazily initialise, which is how audioFileExt can be called before
   anything has been played. */
WebAudio.canPlayOgg = function () {
  if (!this._initialized) {
    this.initialize();
  }
  return !!this._canPlayOgg;
};
WebAudio.canPlayM4a = function () {
  if (!this._initialized) {
    this.initialize();
  }
  return !!this._canPlayM4a;
};

/* rpg_core.js:7755. MZ's (rmmz_core.js:4714) delegates to _resetVolume, which
   MV does not have. Note MV reaches this._context.currentTime WITHOUT a null
   check inside the gain branch — safe only because _masterGainNode is null
   whenever _context is. */
WebAudio.setMasterVolume = function (value) {
  this._masterVolume = value;
  if (this._masterGainNode) {
    this._masterGainNode.gain.setValueAtTime(this._masterVolume, this._context.currentTime);
  }
};

/* rpg_core.js:7767 — the engine tries AudioContext then webkitAudioContext and
   swallows the throw. The harness substitutes the fake context from x-audio.js
   so seek() and every gain ramp are inspectable; the try/catch shape is kept
   because "no context" is a state the rest of the class branches on. */
WebAudio._createContext = function () {
  try {
    this._context = window.__makeAudioContext();
  } catch (e) {
    this._context = null;
  }
};

/* rpg_core.js:7784 — MV-only. Real canPlayType against a real <audio>, which
   the harness browser answers honestly: this is what decides .ogg vs .m4a. */
WebAudio._detectCodecs = function () {
  var audio = document.createElement('audio');
  if (audio.canPlayType) {
    this._canPlayOgg = audio.canPlayType('audio/ogg');
    this._canPlayM4a = audio.canPlayType('audio/mp4');
  }
};

/* rpg_core.js:7797. */
WebAudio._createMasterGainNode = function () {
  var context = WebAudio._context;
  if (context) {
    this._masterGainNode = context.createGain();
    this._masterGainNode.gain.setValueAtTime(this._masterVolume, context.currentTime);
    this._masterGainNode.connect(context.destination);
  }
};

/* rpg_core.js:7811 — MV binds FIVE listeners (keydown/mousedown/touchend
   through a resume wrapper, plus touchstart and visibilitychange). MZ binds
   four (rmmz_core.js:4741) and routes the first three through _onUserGesture.
   Copied for the count and the targets: both engines listen on `document`. */
WebAudio._setupEventHandlers = function () {
  var resumeHandler = function () {
    var context = WebAudio._context;
    if (context && context.state === 'suspended' && typeof context.resume === 'function') {
      context.resume().then(function () {
        WebAudio._onTouchStart();
      });
    } else {
      WebAudio._onTouchStart();
    }
  };
  document.addEventListener('keydown', resumeHandler);
  document.addEventListener('mousedown', resumeHandler);
  document.addEventListener('touchend', resumeHandler);
  document.addEventListener('touchstart', this._onTouchStart.bind(this));
  document.addEventListener('visibilitychange', this._onVisibilityChange.bind(this));
};

/* rpg_core.js:7834 — the iOS unlock. MV-only; MZ's _onUserGesture just resumes
   a suspended context (rmmz_core.js:4750) and has no _unlocked flag. */
WebAudio._onTouchStart = function () {
  var context = WebAudio._context;
  if (context && !this._unlocked) {
    // Unlock Web Audio on iOS
    var node = context.createBufferSource();
    node.start(0);
    this._unlocked = true;
  }
};

/* rpg_core.js:7873 — MV fades back in over 0.5s; MZ over 1s
   (rmmz_core.js:4771). _onHide and _onVisibilityChange are identical and live
   in x-audio.js. */
WebAudio._onShow = function () {
  if (this._shouldMuteOnHide()) {
    this._fadeIn(0.5);
  }
};

/* rpg_core.js:7884 — MV mutes on hide for every mobile device. MZ
   (rmmz_core.js:4777) adds `&& !window.navigator.standalone`, so an
   installed-to-home-screen web app keeps playing on MZ and goes silent on MV. */
WebAudio._shouldMuteOnHide = function () {
  return Utils.isMobileDevice();
};

/* NOT AN ENGINE SYMBOL — the linear gain ramp MV spells out FOUR times over:
   at rpg_core.js:7894 and :7909 across the master node, and at :8088 and :8109
   across a buffer's own. Named here so the four readings are visibly one
   gesture, pinned to one instant: `from` is stamped at that instant and `to`
   is scheduled `duration` seconds past it.

   The instant comes from WebAudio._context.currentTime with NO null check,
   because that is what every one of the four copies does — the guard they
   share is on the NODE, never on the context, so a ramp asked for while the
   context is missing throws right here. MZ's equivalents read
   WebAudio._currentTime(), which answers 0 instead of throwing. */
function mvRampGain(node, from, to, duration) {
  var gain = node.gain;
  var currentTime = WebAudio._context.currentTime;
  gain.setValueAtTime(from, currentTime);
  gain.linearRampToValueAtTime(to, currentTime + duration);
}

/* rpg_core.js:7894 / :7909 — the master pair, both guarded on the master node
   and both ramping between silence and _masterVolume. */
WebAudio._fadeIn = function (duration) {
  if (this._masterGainNode) {
    mvRampGain(this._masterGainNode, 0, this._masterVolume, duration);
  }
};
WebAudio._fadeOut = function (duration) {
  if (this._masterGainNode) {
    mvRampGain(this._masterGainNode, this._masterVolume, 0, duration);
  }
};

/* =========================================================================
   WebAudio — the MV instance.
   ====================================================================== */

/* rpg_core.js:7678 — behaviour kept exactly, including the ordering wart: _load(url) runs
   BEFORE `this._url = url`. On a synchronous failure the buffer therefore has
   _hasError true and _url still undefined, and AudioManager.checkWebAudioError
   reports "Failed to load: undefined". MZ assigns _url first
   (rmmz_core.js:4688) and does not have this problem. */
WebAudio.prototype.initialize = function (url) {
  if (!WebAudio._initialized) {
    WebAudio.initialize();
  }
  this.clear();

  if (!WebAudio._standAlone) {
    this._loader = ResourceHandler.createLoader(url, this._load.bind(this, url), function () {
      this._hasError = true;
    }.bind(this));
  }
  this._load(url);
  this._url = url;
};

/* rpg_core.js:7923 — TWENTY fields, and they are not MZ's twenty-three.
   MV has _buffer (one) / _sourceNode (one) / _hasError / _autoPlay.
   MZ has _buffers (an array) / _sourceNodes (an array) / _isError / _isPlaying
   / _isLoaded / _data / _fetchedSize / _fetchedData / _loop / _loopStartTime /
   _loopLengthTime / _lastUpdateTime / _decoder — and NO _autoPlay.
   Anything reading a buffer's state has to know which set it is looking at. */
WebAudio.prototype.clear = function () {
  this.stop();
  var self = this;
  /* Grouped by the value each field resets to, which is also what each group
     IS: the four live graph handles, the five numbers the decode and the start
     of playback fill in, the playback parameters, the end timer, the two
     listener queues, the two flags isError() and play() read back. The order
     of the writes is the engine's, so a freshly cleared buffer enumerates its
     own properties in the same order MV does. */
  function resetAll(fields, value) {
    fields.split(' ').forEach(function (name) { self[name] = value; });
  }
  resetAll('_buffer _sourceNode _gainNode _pannerNode', null);
  resetAll('_totalTime _sampleRate _loopStart _loopLength _startTime', 0);
  resetAll('_volume _pitch', 1);
  resetAll('_pan', 0);
  resetAll('_endTimer', null);
  /* Written out rather than folded into a group: each buffer needs its OWN
     pair of arrays, and a shared literal in a table would hand every buffer
     the same two. */
  this._loadListeners = [];
  this._stopListeners = [];
  resetAll('_hasError _autoPlay', false);
};

/* rpg_core.js:7963 / :7982. `url` and `pan` are identical on both engines and
   live in x-audio.js; these two are not.
   volume: MV reads WebAudio._context.currentTime, MZ WebAudio._currentTime().
   pitch: MV re-plays with `this._sourceNode.loop`, MZ with `this._loop` — MV
   reads the loop flag back off the live node, so a pitch change on a buffer
   whose node was swapped picks up whatever that node says. */
Object.defineProperty(WebAudio.prototype, 'volume', {
  get: function () { return this._volume; },
  set: function (value) {
    this._volume = value;
    if (this._gainNode) {
      this._gainNode.gain.setValueAtTime(this._volume, WebAudio._context.currentTime);
    }
  },
  configurable: true
});
Object.defineProperty(WebAudio.prototype, 'pitch', {
  get: function () { return this._pitch; },
  set: function (value) {
    if (this._pitch !== value) {
      this._pitch = value;
      if (this.isPlaying()) {
        this.play(this._sourceNode.loop, 0);
      }
    }
  },
  configurable: true
});

/* rpg_core.js:8020 / :8030 / :8040. All three are DERIVED on MV — isPlaying is
   `!!this._sourceNode`, so a buffer whose node was removed reads as stopped
   with no flag involved. MZ carries explicit _isLoaded/_isError/_isPlaying
   booleans and isPlaying can be true while no node exists (during a load).
   AudioManager.stopMe and MV's playSe both branch on isPlaying(), so this is
   the difference that decides which SE buffers survive. */
WebAudio.prototype.isReady = function () {
  return !!this._buffer;
};
WebAudio.prototype.isError = function () {
  return this._hasError;
};
WebAudio.prototype.isPlaying = function () {
  return !!this._sourceNode;
};

/* rpg_core.js:8051 — the deferred branch sets _autoPlay and re-enters play()
   from the load listener, guarded by _autoPlay so a stop() in between cancels
   it. MZ has no _autoPlay: it sets _isPlaying = true unconditionally at the
   END of play(), so an MZ buffer reports "playing" before it has loaded. */
WebAudio.prototype.play = function (loop, offset) {
  if (this.isReady()) {
    offset = offset || 0;
    this._startPlaying(loop, offset);
  } else if (WebAudio._context) {
    this._autoPlay = true;
    this.addLoadListener(function () {
      if (this._autoPlay) {
        this.play(loop, offset);
      }
    }.bind(this));
  }
};

/* rpg_core.js:8070. MV does NOT clear _loadListeners here; MZ does
   (rmmz_core.js:4964). On MV a stopped-then-reloaded buffer still holds every
   listener it ever queued — they just no-op because _autoPlay is false. */
WebAudio.prototype.stop = function () {
  this._autoPlay = false;
  this._removeEndTimer();
  this._removeNodes();
  if (this._stopListeners) {
    while (this._stopListeners.length > 0) {
      var listner = this._stopListeners.shift();
      listner();
    }
  }
};

/* rpg_core.js:8088 — the else branch is `else if (this._autoPlay)`, so a
   fadeIn on a buffer that is loading but NOT auto-playing is dropped on the
   floor. MZ's else is unconditional (rmmz_core.js:4990). AudioManager.
   replayBgm calls playBgm then fadeIn, which is exactly that ordering. */
WebAudio.prototype.fadeIn = function (duration) {
  if (this.isReady()) {
    if (this._gainNode) {
      mvRampGain(this._gainNode, 0, this._volume, duration);
    }
  } else if (this._autoPlay) {
    this.addLoadListener(function () {
      this.fadeIn(duration);
    }.bind(this));
  }
};

/* rpg_core.js:8109. MV clears _autoPlay; MZ clears _isPlaying AND
   _loadListeners. Either way the buffer keeps ramping and keeps its nodes —
   fadeOut never stops anything. */
WebAudio.prototype.fadeOut = function (duration) {
  if (this._gainNode) {
    mvRampGain(this._gainNode, this._volume, 0, duration);
  }
  this._autoPlay = false;
};

/* NOT AN ENGINE SYMBOL — the wrap MV writes out twice, once in seek
   (rpg_core.js:8124) and once at the top of _startPlaying (rpg_core.js:8208),
   in both cases over _loopStart/_loopLength. Named here so the two readings
   are visibly the same arithmetic.

   Repeated subtraction rather than a modulo, because the loop region begins at
   _loopStart and not at zero; a _loopLength that is zero or negative means
   "not a looping track" and the value passes straight through. */
function mvWrapIntoLoopRegion(value, loopStart, loopLength) {
  while (loopLength > 0 && value >= loopStart + loopLength) {
    value -= loopLength;
  }
  return value;
}

/* rpg_core.js:8124 — the pair wrapped against is _loopStart/_loopLength, which
   hold SECONDS on MV (_onXhrLoad divides them by the sample rate). MZ keeps the
   raw sample counts under those two names and the seconds under
   _loopStartTime/_loopLengthTime, and its seek() reads the *Time pair. Same
   arithmetic, different field names — read the wrong pair on the wrong engine
   and a saved BGM position is out by a factor of the sample rate. */
WebAudio.prototype.seek = function () {
  if (!WebAudio._context) {
    return 0;
  }
  var elapsed = (WebAudio._context.currentTime - this._startTime) * this._pitch;
  return mvWrapIntoLoopRegion(elapsed, this._loopStart, this._loopLength);
};

/* rpg_core.js:8163 — _load is XHR + decodeAudioData in the engine. The
   TRANSPORT is faked; everything around it is MV's:
     · the url really goes through Decrypter.extToEncryptExt when
       hasEncryptedAudio is set, and that rewritten url is what gets recorded;
     · failure sets _hasError and NOTHING ELSE — MV does not throw here, which
       is why a missing file is silent until checkErrors runs a frame later;
     · with no context, nothing happens at all.
   Left out: XMLHttpRequest, the _loader retry hook (unreachable while
   _standAlone is true), and decodeAudioData. */
WebAudio.prototype._load = function (url) {
  if (WebAudio._context) {
    if (Decrypter.hasEncryptedAudio) url = Decrypter.extToEncryptExt(url);
    window.__audioLoads.push(url);
    var self = this;
    var settle = function () {
      if (window.__audioExists(url)) self._onFakeDecode();
      else self._hasError = true;
    };
    if (window.__audioAsync) window.__audioPending.push(settle);
    else settle();
  }
};

/* NOT AN ENGINE SYMBOL — it is the tail of _onXhrLoad (rpg_core.js:8184), the
   part inside decodeAudioData's callback, split out so the fake transport can
   call it. The field assignments and their order are the engine's, including
   the division that turns _loopStart/_loopLength from SAMPLES into SECONDS and
   the else branch that makes the whole track the loop. __audioLoop stands in
   for what _readOgg/_readMp4 would have parsed. */
WebAudio.prototype._onFakeDecode = function () {
  if (window.__audioLoop) {
    this._loopStart = window.__audioLoop.start;
    this._loopLength = window.__audioLoop.length;
    this._sampleRate = window.__audioLoop.sampleRate;
  }
  this._buffer = window.__audioFakeBuffer();
  this._totalTime = this._buffer.duration;
  /* Samples to seconds, and it is all-or-nothing: a track that named a loop
     region AND a sample rate gets both of its numbers divided down, and a
     track that named neither is handed the whole file as its loop region
     starting at zero. There is no half-converted state. */
  var rate = this._sampleRate;
  var parsedLoop = this._loopLength > 0 && rate > 0;
  this._loopStart = parsedLoop ? this._loopStart / rate : 0;
  this._loopLength = parsedLoop ? this._loopLength / rate : this._totalTime;
  this._onLoad();
};

/* rpg_core.js:8208 — ONE source node, started at the wrapped offset; MZ splits
   the buffer into chunks and starts a node per chunk (rmmz_core.js:5271).
   _startTime is derived from the SAME wrapped offset, and it is written AFTER
   start() on MV where MZ writes it before any node work. */
WebAudio.prototype._startPlaying = function (loop, offset) {
  offset = mvWrapIntoLoopRegion(offset, this._loopStart, this._loopLength);
  this._removeEndTimer();
  this._removeNodes();
  this._createNodes();
  this._connectNodes();
  var node = this._sourceNode;
  node.loop = loop;
  node.start(0, offset);
  /* Not "now": the clock is wound BACK by however far into the track the
     offset is, pitch-scaled, so seek() can read the position straight off it. */
  this._startTime = WebAudio._context.currentTime - offset / this._pitch;
  this._createEndTimer();
};

/* rpg_core.js:8228 / :8246 — MV builds all three nodes then connects them in a
   second pass. MZ creates panner first, connects it to the master gain inside
   its own creator, then gain, then sources (rmmz_core.js:5359-5390) — the
   graph is the same, the construction order is not. */
WebAudio.prototype._createNodes = function () {
  var context = WebAudio._context;
  /* One instant for both scheduled writes. The engine reads currentTime twice,
     a statement apart; nothing can move the clock between them. */
  var now = context.currentTime;

  /* The source carries the decoded buffer and the loop region, which it wants
     in SECONDS and as a start/end pair — the class stores a start/LENGTH pair,
     so the end is derived here and nowhere else. */
  var source = context.createBufferSource();
  source.buffer = this._buffer;
  source.loopStart = this._loopStart;
  source.loopEnd = this._loopStart + this._loopLength;
  source.playbackRate.setValueAtTime(this._pitch, now);
  this._sourceNode = source;

  /* Volume and pan ride on their own nodes, so the buffer's current values are
     stamped onto fresh nodes every time playback restarts. */
  var gainNode = context.createGain();
  gainNode.gain.setValueAtTime(this._volume, now);
  this._gainNode = gainNode;

  var panner = context.createPanner();
  panner.panningModel = 'equalpower';
  this._pannerNode = panner;

  /* Reads _pannerNode back off `this`, so it has to come after the assignment
     above rather than take the local. */
  this._updatePanner();
};
WebAudio.prototype._connectNodes = function () {
  this._sourceNode.connect(this._gainNode);
  this._gainNode.connect(this._pannerNode);
  this._pannerNode.connect(WebAudio._masterGainNode);
};

/* rpg_core.js:8256 — nulls all three, so isPlaying() (which reads
   _sourceNode) flips to false as a SIDE EFFECT. MZ's _removeNodes empties an
   array and does not touch _isPlaying at all (rmmz_core.js:5391). */
WebAudio.prototype._removeNodes = function () {
  if (this._sourceNode) {
    this._sourceNode.stop(0);
    this._sourceNode = null;
    this._gainNode = null;
    this._pannerNode = null;
  }
};

/* rpg_core.js:8269 — a real setTimeout that calls stop(), which is how a
   non-looping buffer eventually fires its stop listeners. This is the timer
   that hands the BGM back after a ME finishes. MZ's is the same idea gated on
   `!this._loop` instead of the node's loop flag (rmmz_core.js:5400). */
WebAudio.prototype._createEndTimer = function () {
  if (this._sourceNode && !this._sourceNode.loop) {
    var endTime = this._startTime + this._totalTime / this._pitch;
    var delay = endTime - WebAudio._context.currentTime;
    this._endTimer = setTimeout(function () {
      this.stop();
    }.bind(this), delay * 1000);
  }
};

/* =========================================================================
   Html5Audio — rpg_core.js:8468. MV-ONLY, deleted outright in MZ.

   Modelled because AudioManager.createBuffer can RETURN IT, and it is a static
   class: every BGM would share ONE object. Stock MV 1.6.1 never gets there
   (shouldUseHtml5Audio returns false), but a plugin that flips that is a real
   thing, and the resulting "the second BGM steals the first one's state" is
   exactly the bug a harness should be able to reproduce.

   Two more MV-only facts kept here: Html5Audio defines `volume` but NOT
   `pitch` and NOT `pan`, so updateBufferParameters' writes to those two land
   as plain own properties nothing reads — pitch and pan are silently ignored
   on the html5 path. And the `volume` getter carries a pointless `.bind(this)`
   in the source; it is preserved.

   The <audio> element itself is faked: a real one would need a real file. Left
   out for that reason: _setupEventHandlers, the loadeddata/error/ended
   handlers, the gain tween interval, and _onTouchStart.
   ====================================================================== */
function Html5Audio() {
  throw new Error('This is a static class');
}

/* rpg_core.js:8472-8479. */
Html5Audio._initialized = false;
Html5Audio._unlocked = false;
Html5Audio._audioElement = null;
Html5Audio._gainTweenInterval = null;
Html5Audio._tweenGain = 0;
Html5Audio._tweenTargetGain = 0;
Html5Audio._tweenGainStep = 0;
Html5Audio._staticSePath = null;

/* rpg_core.js:8507 — the fake element carries only what the class reads back:
   paused, volume, currentTime, loop, src. */
Html5Audio.initialize = function () {
  if (!this._initialized) {
    if (!this._audioElement) {
      try {
        this._audioElement = {
          paused: true, volume: 1, currentTime: 0, loop: false, src: '',
          load: function () { Html5Audio._onLoad(); },
          play: function () { this.paused = false; },
          pause: function () { this.paused = true; }
        };
      } catch (e) {
        this._audioElement = null;
      }
    }
    this._initialized = true;
  }
  return !!this._audioElement;
};

/* rpg_core.js:8488 — note it revokes the PREVIOUS object url when audio is
   encrypted, which is the only cleanup this class ever does. */
Html5Audio.setup = function (url) {
  if (!this._initialized) {
    this.initialize();
  }
  this.clear();

  if (Decrypter.hasEncryptedAudio && this._audioElement.src) {
    window.__audioRevoked = (window.__audioRevoked || []).concat([this._audioElement.src]);
  }
  this._url = url;
};

/* rpg_core.js:8625. Note what clear does NOT touch: _url, _staticSePath and
   the <audio> element itself all survive it, which is how the singleton hands
   the previous track's identity to the next one. */
Html5Audio.clear = function () {
  this.stop();
  this._volume = 1;
  this._loadListeners = [];
  var self = this;
  /* The four state flags, in the engine's write order. Every one of them is
     false-by-default, which is why the whole tail is one sweep. */
  ['_hasError', '_autoPlay', '_isLoading', '_buffered'].forEach(function (flag) {
    self[flag] = false;
  });
};

/* rpg_core.js:8641 — the one member AudioManager.loadStaticSe calls, and the
   reason MV's loadStaticSe is longer than MZ's. Note the initialize+clear pair
   runs ONLY when not yet initialised, so the second static SE does not clear. */
Html5Audio.setStaticSe = function (url) {
  if (!this._initialized) {
    this.initialize();
    this.clear();
  }
  this._staticSePath = url;
};

/* rpg_core.js:8655 / :8668 — url read-only, volume read/write, and NOTHING for
   pitch or pan, so updateBufferParameters' writes to those two land as plain
   own properties nobody reads. Both accessors reach for the STATIC field, not
   for `this`, which is the whole reason two BGMs on this path share one volume.

   Declared as one defineProperties so the pair reads as the class's entire
   public surface; the engine spells it as two calls, in this order, and
   omitting `enumerable` leaves both non-enumerable either way.

   The `.bind(this)` on the volume getter is the engine's own and is kept: the
   getter body never mentions `this`, so the binding is inert, but it is what a
   probe reading the descriptor back gets handed. */
Object.defineProperties(Html5Audio, {
  url: {
    get: function () {
      return Html5Audio._url;
    },
    configurable: true
  },
  volume: {
    get: function () {
      return Html5Audio._volume;
    }.bind(this),
    set: function (value) {
      Html5Audio._volume = value;
      /* Written back through `this`, unlike every other read in the pair.
         Identical while the setter is reached as Html5Audio.volume = x, which
         is the only route the engine ever takes to it. */
      var element = Html5Audio._audioElement;
      if (element) {
        element.volume = this._volume;
      }
    },
    configurable: true
  }
});

/* rpg_core.js:8688 / :8699 / :8710. isPlaying dereferences _audioElement with
   NO null check — Html5Audio.isPlaying() before initialize() throws. */
Html5Audio.isReady = function () {
  return this._buffered;
};
Html5Audio.isError = function () {
  return this._hasError;
};
Html5Audio.isPlaying = function () {
  return !this._audioElement.paused;
};

/* NOT AN ENGINE SYMBOL — the guarded "kill whatever tween is running" that MV
   writes out three times: inside play's load listener (rpg_core.js:8730), at
   the top of _startGainTween (:8873) and at the top of _startPlaying (:8836).
   All three are guarded, so cancelling with no tween in flight does nothing.
   _applyTweenValue has a FOURTH copy that is deliberately NOT routed through
   here, because that one is unguarded — see the note there. */
function mvHtml5CancelGainTween(owner) {
  if (owner._gainTweenInterval) {
    clearInterval(owner._gainTweenInterval);
    owner._gainTweenInterval = null;
  }
}

/* rpg_core.js:8722 / :8747 / :8799 / :8814 / :8824 / :8839 / :8857. */
Html5Audio.play = function (loop, offset) {
  if (this.isReady()) {
    this._startPlaying(loop, offset || 0);
    return;
  }
  if (!Html5Audio._audioElement) {
    return;
  }
  /* Deferred: remember the intent, replay it from the load listener, and only
     then start the load — and only if one is not already running, so a second
     play() during a load queues a listener without re-fetching. */
  this._autoPlay = true;
  var self = this;
  this.addLoadListener(function () {
    /* Re-checked at load time, so a stop() in the meantime cancels the play
       rather than surprising the player with it. */
    if (!self._autoPlay) {
      return;
    }
    self.play(loop, offset);
    mvHtml5CancelGainTween(self);
  });
  if (!this._isLoading) {
    this._load(this._url);
  }
};
/* Note _tweenInterval here against _gainTweenInterval everywhere else — the
   engine really does test a field nothing ever assigns, so in stock MV the
   branch is unreachable. Its BEHAVIOUR is kept anyway, including the
   _audioElement dereference on the last line that no `if` covers: set the
   field by hand and a null element throws here exactly as MV would. */
Html5Audio.stop = function () {
  var element = this._audioElement;
  if (element) {
    element.pause();
  }
  this._autoPlay = false;
  if (this._tweenInterval) {
    clearInterval(this._tweenInterval);
    this._tweenInterval = null;
    this._audioElement.volume = 0;
  }
};
/* rpg_core.js:8764 / :8785 / :8871 / :8889 — the fade pair and the setInterval
   tween behind it. Modelled because AudioManager.fadeOutBgm / fadeInBgm /
   replayBgm call fadeOut/fadeIn on whatever createBuffer returned, and on the
   html5 path that is THIS object — without them the fade methods would be a
   TypeError instead of MV's behaviour. Note this is a real timer at 60Hz over
   the fake element's volume, not a Web Audio ramp: the html5 path fades in
   software and cannot be scheduled ahead. */
Html5Audio.fadeIn = function (duration) {
  if (!this.isReady()) {
    /* Deferred only for a buffer that is ALREADY auto-playing. A fade-in asked
       for on an idle, unloaded buffer is dropped on the floor — the same shape
       as WebAudio.prototype.fadeIn's else-if, and the reason replayBgm's
       playBgm-then-fadeIn ordering matters. */
    if (this._autoPlay) {
      var self = this;
      this.addLoadListener(function () { self.fadeIn(duration); });
    }
    return;
  }
  if (this._audioElement) {
    this._tweenTargetGain = this._volume;   /* rising TO the set volume ... */
    this._tweenGain = 0;                    /* ... from silence.            */
    this._startGainTween(duration);
  }
};
Html5Audio.fadeOut = function (duration) {
  /* No isReady() on this side: a fade-out on a buffer that has not loaded yet
     still starts a tween over the element's volume. */
  if (!this._audioElement) {
    return;
  }
  this._tweenTargetGain = 0;                /* falling TO silence ...       */
  this._tweenGain = this._volume;           /* ... from the set volume.     */
  this._startGainTween(duration);
};
Html5Audio._startGainTween = function (duration) {
  /* Unguarded on purpose: reaching a tween with no element is MV throwing. */
  this._audioElement.volume = this._tweenGain;
  mvHtml5CancelGainTween(this);
  /* One step per frame at 60Hz for `duration` seconds. A duration of 0 makes
     the step infinite, which the first tick clamps straight onto the target —
     an instant fade rather than a division error. */
  var frames = 60 * duration;
  this._tweenGainStep = (this._tweenTargetGain - this._tweenGain) / frames;
  this._gainTweenInterval = setInterval(function () {
    Html5Audio._applyTweenValue(Html5Audio._tweenTargetGain);
  }, 1000 / 60);
};
Html5Audio._applyTweenValue = function (volume) {
  var step = Html5Audio._tweenGainStep;
  var gain = Html5Audio._tweenGain + step;
  /* Clamped only in the direction of travel: a falling tween is floored at 0,
     a rising one capped at `volume` — the CALLER's ceiling, which the interval
     fills in with _tweenTargetGain and which is not necessarily _volume. */
  if (gain < 0 && step < 0) {
    gain = 0;
  } else if (gain > volume && step > 0) {
    gain = volume;
  }
  Html5Audio._tweenGain = gain;
  /* Within a hundredth of the target counts as arrived: snap exactly onto it
     and stop the timer. This cancel is the engine's UNGUARDED one and is
     written out rather than routed through mvHtml5CancelGainTween, because it
     runs whether or not there is an interval id in the field. */
  if (Math.abs(Html5Audio._tweenTargetGain - gain) < 0.01) {
    Html5Audio._tweenGain = Html5Audio._tweenTargetGain;
    clearInterval(Html5Audio._gainTweenInterval);
    Html5Audio._gainTweenInterval = null;
  }
  /* The snapped value, not the clamped one — the two differ on the last tick. */
  Html5Audio._audioElement.volume = Html5Audio._tweenGain;
};
/* Guarded, unlike isPlaying() right above it: with no element the position is
   reported as the start of the track rather than thrown over. */
Html5Audio.seek = function () {
  return this._audioElement ? this._audioElement.currentTime : 0;
};
Html5Audio.addLoadListener = function (listner) {
  this._loadListeners.push(listner);
};
Html5Audio._load = function (url) {
  var element = this._audioElement;
  if (!element) {
    return;
  }
  this._isLoading = true;
  element.src = url;
  window.__audioLoads.push(url);
  /* The fake transport: the fixture table answers for the network, and the
     element's load() is what drains the listener queue through _onLoad. */
  this._buffered = !!window.__audioExists(url);
  element.load();
};
Html5Audio._startPlaying = function (loop, offset) {
  /* Line one dereferences the element with no guard, and three lines later the
     engine tests it — by then the test cannot fail, so it is decoration. Both
     halves are kept: starting playback with no element still throws here. */
  this._audioElement.loop = loop;
  /* Playing again cancels a fade in progress, so the new start is at full
     volume rather than wherever the last tween had got to. */
  mvHtml5CancelGainTween(this);
  var element = this._audioElement;
  if (element) {
    element.volume = this._volume;
    element.currentTime = offset;
    element.play();
  }
};
Html5Audio._onLoad = function () {
  this._isLoading = false;
  /* Drained by shifting, and the queue is re-read every turn rather than
     snapshotted: a listener that queues another listener — or replaces the
     array wholesale by calling clear() — is honoured by this same loop. */
  while (this._loadListeners.length > 0) {
    this._loadListeners.shift()();
  }
};

/* =========================================================================
   AudioManager — the MV-only fields and the divergent bodies.
   ====================================================================== */

/* rpg_managers.js:1104 / :1118 — MV-ONLY. MZ has neither.
   _masterVolume is 0..1 (every other volume field is 0..100), and _blobUrl is
   a one-slot cache for the last decrypted BGM that is NEVER cleared. */
AudioManager._masterVolume = 1;
AudioManager._blobUrl = null;

/* rpg_managers.js:1120 — MV-ONLY, and the only volume accessor that reaches
   outside AudioManager: it drives BOTH WebAudio's master gain and the video
   element. MZ has no master volume, so a port has to fake one by scaling the
   four category volumes, which is not the same thing (it does not touch
   video, and it is destructive to the values the config saves). */
Object.defineProperty(AudioManager, 'masterVolume', {
  get: function () {
    return this._masterVolume;
  },
  set: function (value) {
    this._masterVolume = value;
    WebAudio.setMasterVolume(this._masterVolume);
    Graphics.setVideoVolume(this._masterVolume);
  },
  configurable: true
});

/* NOT AN ENGINE SYMBOL — "install a BGM buffer and start it, unless a ME is
   holding the channel". MV writes this out twice, once at the bottom of
   playBgm (rpg_managers.js:1175) and once inside createDecryptBuffer (:1203),
   which the engine chose to duplicate rather than share; naming it once makes
   it visible that the encrypted route lands on the SAME three steps.

   The ME guard is the interesting one: during a ME the buffer is built,
   retuned and left silent, and stopMe is what eventually starts it. The
   retune has to sit between the assignment and the start, because
   updateBgmParameters reads _bgmBuffer back off the manager. */
function mvInstallBgmBuffer(self, bgm, pos) {
  self._bgmBuffer = self.createBuffer('bgm', bgm.name);
  self.updateBgmParameters(bgm);
  if (!self._meBuffer) {
    self._bgmBuffer.play(true, pos || 0);
  }
}

/* rpg_managers.js:1175 — MV's playBgm has an ENCRYPTED-AUDIO BRANCH that MZ
   does not, and passes the folder WITHOUT a trailing slash. Everything else
   matches MZ (rmmz_managers.js:1164), including the `if (!this._meBuffer)`
   that makes playBgm during a ME set up the buffer and deliberately not start
   it — stopMe is what starts it later. */
AudioManager.playBgm = function (bgm, pos) {
  if (this.isCurrentBgm(bgm)) {
    this.updateBgmParameters(bgm);
  } else {
    this.stopBgm();
    if (bgm.name) {
      /* BOTH conditions, and shouldUseHtml5Audio is hard-false on stock MV —
         so the encrypted detour below is unreachable until a mod reopens it. */
      var viaHtml5 = Decrypter.hasEncryptedAudio && this.shouldUseHtml5Audio();
      if (viaHtml5) {
        this.playEncryptedBgm(bgm, pos);
      } else {
        mvInstallBgmBuffer(this, bgm, pos);
      }
    }
  }
  this.updateCurrentBgm(bgm, pos);
};

/* rpg_managers.js:1196 / :1203 — MV-ONLY, both of them. Note that
   playEncryptedBgm builds the url with encodeURIComponent (MZ uses
   Utils.encodeURI, which leaves '/' alone — so a BGM in a SUBFOLDER works on
   MZ and is mangled on MV), and that createDecryptBuffer repeats playBgm's
   tail rather than sharing it. */
AudioManager.playEncryptedBgm = function (bgm, pos) {
  var ext = this.audioFileExt();
  var url = this._path + 'bgm/' + encodeURIComponent(bgm.name) + ext;
  url = Decrypter.extToEncryptExt(url);
  Decrypter.decryptHTML5Audio(url, bgm, pos);
};
AudioManager.createDecryptBuffer = function (url, bgm, pos) {
  /* The one-slot blob cache, written before the buffer is built because
     createBuffer reads it back to decide what Html5Audio.setup gets. */
  this._blobUrl = url;
  mvInstallBgmBuffer(this, bgm, pos);
  this.updateCurrentBgm(bgm, pos);
};

/* rpg_managers.js:1243 / :1308 / :1353 — buffer.stop(). MZ calls
   buffer.destroy() in all three (rmmz_managers.js:1213 / :1281 / :1326).
   stop() leaves the buffer's loaded data and its listeners in place; destroy()
   runs clear(), which drops the decoded buffers. Consequence for a panel: on
   MV a stopped BGM buffer can be inspected afterwards, on MZ it is empty. */
AudioManager.stopBgm = function () {
  if (this._bgmBuffer) {
    this._bgmBuffer.stop();
    this._bgmBuffer = null;
    this._currentBgm = null;
  }
};
AudioManager.stopBgs = function () {
  if (this._bgsBuffer) {
    this._bgsBuffer.stop();
    this._bgsBuffer = null;
    this._currentBgs = null;
  }
};
AudioManager.stopMe = function () {
  if (this._meBuffer) {
    this._meBuffer.stop();
    this._meBuffer = null;
    if (this._bgmBuffer && this._currentBgm && !this._bgmBuffer.isPlaying()) {
      this._bgmBuffer.play(true, this._currentBgm.pos);
      this._bgmBuffer.fadeIn(this._replayFadeTime);
    }
  }
};

/* rpg_managers.js:1264 — folder 'bgs', no encryption branch. */
AudioManager.playBgs = function (bgs, pos) {
  if (this.isCurrentBgs(bgs)) {
    /* Same track already running: retune it in place, never restart it. */
    this.updateBgsParameters(bgs);
  } else {
    this.stopBgs();
    if (bgs.name) {
      var buffer = this.createBuffer('bgs', bgs.name);
      /* Published before the retune, which reads _bgsBuffer off the manager
         rather than taking it as an argument. No ME guard here — a BGS starts
         immediately whatever else is playing. */
      this._bgsBuffer = buffer;
      this.updateBgsParameters(bgs);
      buffer.play(true, pos || 0);
    }
  }
  this.updateCurrentBgs(bgs, pos);
};

/* rpg_managers.js:1329 — identical to MZ's (rmmz_managers.js:1302) except the
   folder string. It steals the BGM's seek() into _currentBgm.pos before
   stopping it, which is the only place that field is ever written to something
   other than the playBgm argument. */
AudioManager.playMe = function (me) {
  this.stopMe();
  if (me.name) {
    if (this._bgmBuffer && this._currentBgm) {
      this._currentBgm.pos = this._bgmBuffer.seek();
      this._bgmBuffer.stop();
    }
    this._meBuffer = this.createBuffer('me', me.name);
    this.updateMeParameters(me);
    this._meBuffer.play(false);
    this._meBuffer.addStopListener(this.stopMe.bind(this));
  }
};

/* rpg_managers.js:1364 — THE SE CLEANUP DIFFERENCE, MV side.

   MV prunes at the TOP of playSe, keeping only buffers that are still playing,
   and it does NOT free the pruned ones — they are dropped on the floor for the
   GC. There is no cleanupSe. Two consequences a panel has to work around:
     · _seBuffers is only ever pruned when a NEW sound starts. Read it in a
       quiet moment and it lists sounds that finished long ago; nothing will
       ever shorten it until the next playSe.
     · MV has no same-frame duplicate guard. Ten calls in one frame make ten
       buffers and ten simultaneous plays. MZ refuses the 2nd through 10th
       (rmmz_managers.js:1341), so an "SE spam" feature behaves differently on
       the two engines with identical code.
   Also: MV pushes AFTER play(), MZ pushes then cleans up. */
AudioManager.playSe = function (se) {
  if (se.name) {
    this._seBuffers = this._seBuffers.filter(function (audio) {
      return audio.isPlaying();
    });
    var buffer = this.createBuffer('se', se.name);
    this.updateSeParameters(buffer, se);
    buffer.play(false);
    this._seBuffers.push(buffer);
  }
};

/* rpg_managers.js:1380 — forEach + stop(). MZ uses for..of + destroy()
   (rmmz_managers.js:1371). Both then reassign the array to []. */
AudioManager.stopSe = function () {
  this._seBuffers.forEach(function (buffer) {
    buffer.stop();
  });
  this._seBuffers = [];
};

/* rpg_managers.js:1387 / :1402 / :1413 — the static SE cache, keyed on
   buffer._reservedSeName. MZ keys on buffer.name, a field its createBuffer
   assigns (rmmz_managers.js:1449); MV's createBuffer assigns no name at all,
   so the extra field exists only here.
   loadStaticSe also has the Html5Audio side-channel, which MZ deleted with the
   class. Neither engine ever empties _staticBuffers: it grows once per unique
   system sound and stays. */
/* NOT AN ENGINE SYMBOL — the linear scan over _staticBuffers that MV spells
   out twice, in playStaticSe (rpg_managers.js:1387) and again in isStaticSe
   (:1413). Both walk front to back and both stop at the FIRST match, which is
   what makes a duplicate reservation unreachable rather than an error.

   The key is _reservedSeName, a field MV's createBuffer never sets — only
   loadStaticSe does. So a buffer that reached _staticBuffers by any other
   route matches nothing and, having no such property, compares undefined
   against the name without throwing. Handing back the buffer rather than a
   flag lets isStaticSe ask "is there one" and playStaticSe act on it. */
function mvFindStaticSeBuffer(self, name) {
  var buffers = self._staticBuffers;
  for (var i = 0; i < buffers.length; i++) {
    if (buffers[i]._reservedSeName === name) {
      return buffers[i];
    }
  }
  return null;
}

AudioManager.playStaticSe = function (se) {
  if (se.name) {
    /* Loads on first use only — after this the buffer is certain to be there
       unless something else emptied the cache mid-call. */
    this.loadStaticSe(se);
    var buffer = mvFindStaticSeBuffer(this, se.name);
    if (buffer) {
      /* Restarted from scratch, so the same system sound retriggers instead of
         layering the way playSe's throwaway buffers do. */
      buffer.stop();
      this.updateSeParameters(buffer, se);
      buffer.play(false);
    }
  }
};
AudioManager.loadStaticSe = function (se) {
  if (se.name && !this.isStaticSe(se)) {
    var buffer = this.createBuffer('se', se.name);
    buffer._reservedSeName = se.name;
    this._staticBuffers.push(buffer);
    if (this.shouldUseHtml5Audio()) {
      Html5Audio.setStaticSe(buffer._url);
    }
  }
};
AudioManager.isStaticSe = function (se) {
  return !!mvFindStaticSeBuffer(this, se.name);
};

/* rpg_managers.js:1464 — MV builds `path + folder + '/' + name + ext` (the
   SLASH is here) with encodeURIComponent, may return the Html5Audio SINGLETON
   for bgm, and sets NO name and NO frameCount on the buffer. MZ's
   (rmmz_managers.js:1449) takes the folder WITH its slash, uses
   Utils.encodeURI, always returns a fresh WebAudio, and tags it with
   `buffer.name = name; buffer.frameCount = Graphics.frameCount;` — the two
   fields its same-frame SE guard and its static-SE lookup depend on.

   encodeURIComponent vs Utils.encodeURI is the whole subfolder story: MV turns
   'boss/theme' into 'boss%2Ftheme', MZ leaves the slash. */
AudioManager.createBuffer = function (folder, name) {
  var ext = this.audioFileExt();
  var url = this._path + folder + '/' + encodeURIComponent(name) + ext;
  if (this.shouldUseHtml5Audio() && folder === 'bgm') {
    if (this._blobUrl) Html5Audio.setup(this._blobUrl);
    else Html5Audio.setup(url);
    return Html5Audio;
  } else {
    return new WebAudio(url);
  }
};

/* rpg_managers.js:1484 — MV CHOOSES. MZ's is `return ".ogg";` and nothing
   else (rmmz_managers.js:1466), because MZ dropped m4a. So the same project
   folder is read as Theme.m4a on an MV phone and Theme.ogg everywhere on MZ. */
AudioManager.audioFileExt = function () {
  if (WebAudio.canPlayOgg() && !Utils.isMobileDevice()) {
    return '.ogg';
  } else {
    return '.m4a';
  }
};

/* rpg_managers.js:1492 — MV-ONLY, and it is dead code that still ships:
   the comment explains the android/no-encrypt case was deliberately abandoned
   and the function hard-returns false. Copied verbatim, mangled comment run-on
   and stray leading space included, because a mod that probes for this
   function finds it and gets false — while playBgm still branches on it. */
AudioManager.shouldUseHtml5Audio = function () {
  // The only case where we wanted html5audio was android/ no encrypt
  // Atsuma-ru asked to force webaudio there too, so just return false for ALL    // return Utils.isAndroidChrome() && !Decrypter.hasEncryptedAudio;
  return false;
};

/* rpg_managers.js:1498 / :1510 — MV walks the three singles then both arrays
   with `.bind(this)` on each forEach, and THROWS A REAL Error carrying the
   url. MZ builds one array with spread and throws an ARRAY
   ["LoadError", url, retry] (rmmz_managers.js:1470 / :1481) which its
   SceneManager.catchLoadError destructures into a retry button. Anything
   catching audio load failures has to handle both an Error and a 3-tuple, and
   only the MZ one is recoverable. */
AudioManager.checkErrors = function () {
  this.checkWebAudioError(this._bgmBuffer);
  this.checkWebAudioError(this._bgsBuffer);
  this.checkWebAudioError(this._meBuffer);
  this._seBuffers.forEach(function (buffer) {
    this.checkWebAudioError(buffer);
  }.bind(this));
  this._staticBuffers.forEach(function (buffer) {
    this.checkWebAudioError(buffer);
  }.bind(this));
};
AudioManager.checkWebAudioError = function (webAudio) {
  if (webAudio && webAudio.isError()) {
    throw new Error('Failed to load: ' + webAudio.url);
  }
};

/* -------------------------------------------------------------------------
   SceneManager.initAudio (rpg_managers.js:1860, called from initialize at
   :1813) is what runs WebAudio.initialize() in a real boot, and the harness's
   __engineBoot does not model initAudio. Run here so _masterGainNode exists
   before the first buffer does — otherwise `AudioManager.masterVolume = x`
   set before any sound has played would silently skip its own gain write, and
   that silence would be the harness's, not MV's.

   The engine difference this does NOT paper over: MV's initialize is
   idempotent (guarded on _initialized) and self-triggers from the WebAudio
   constructor, so a second call is free and a buffer built before boot still
   works. MZ's is neither — see the matching note at the end of x-audio-mz.js.
   ---------------------------------------------------------------------- */
WebAudio.initialize();
