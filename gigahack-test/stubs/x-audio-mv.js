/* =============================================================================
   GigaHack test harness — stubs/x-audio-mv.js
   AUDIO: the MV-ONLY surface. Copied from /root/work/mv/js/rpg_core.js and
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

/* rpg_core.js:9253 — VERBATIM, awkward parts included, because the awkward
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

/* rpg_core.js:7894 / :7909 — reach WebAudio._context.currentTime directly.
   MZ's go through WebAudio._currentTime(), which returns 0 when the context is
   null; MV's would throw. The bodies are otherwise the same. */
WebAudio._fadeIn = function (duration) {
  if (this._masterGainNode) {
    var gain = this._masterGainNode.gain;
    var currentTime = WebAudio._context.currentTime;
    gain.setValueAtTime(0, currentTime);
    gain.linearRampToValueAtTime(this._masterVolume, currentTime + duration);
  }
};
WebAudio._fadeOut = function (duration) {
  if (this._masterGainNode) {
    var gain = this._masterGainNode.gain;
    var currentTime = WebAudio._context.currentTime;
    gain.setValueAtTime(this._masterVolume, currentTime);
    gain.linearRampToValueAtTime(0, currentTime + duration);
  }
};

/* =========================================================================
   WebAudio — the MV instance.
   ====================================================================== */

/* rpg_core.js:7678 — VERBATIM, including the ordering wart: _load(url) runs
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
  this._buffer = null;
  this._sourceNode = null;
  this._gainNode = null;
  this._pannerNode = null;
  this._totalTime = 0;
  this._sampleRate = 0;
  this._loopStart = 0;
  this._loopLength = 0;
  this._startTime = 0;
  this._volume = 1;
  this._pitch = 1;
  this._pan = 0;
  this._endTimer = null;
  this._loadListeners = [];
  this._stopListeners = [];
  this._hasError = false;
  this._autoPlay = false;
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
      var gain = this._gainNode.gain;
      var currentTime = WebAudio._context.currentTime;
      gain.setValueAtTime(0, currentTime);
      gain.linearRampToValueAtTime(this._volume, currentTime + duration);
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
    var gain = this._gainNode.gain;
    var currentTime = WebAudio._context.currentTime;
    gain.setValueAtTime(this._volume, currentTime);
    gain.linearRampToValueAtTime(0, currentTime + duration);
  }
  this._autoPlay = false;
};

/* rpg_core.js:8124 — the wrap loop uses _loopStart/_loopLength (SECONDS after
   _onXhrLoad divides them by the sample rate). MZ keeps the raw sample values
   in _loopStart/_loopLength and the seconds in _loopStartTime/_loopLengthTime,
   and seek() reads the *Time pair. Same arithmetic, different field names —
   read the wrong pair and a saved BGM position is off by the sample rate. */
WebAudio.prototype.seek = function () {
  if (WebAudio._context) {
    var pos = (WebAudio._context.currentTime - this._startTime) * this._pitch;
    if (this._loopLength > 0) {
      while (pos >= this._loopStart + this._loopLength) {
        pos -= this._loopLength;
      }
    }
    return pos;
  } else {
    return 0;
  }
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
  var buffer = window.__audioFakeBuffer();
  this._buffer = buffer;
  this._totalTime = buffer.duration;
  if (this._loopLength > 0 && this._sampleRate > 0) {
    this._loopStart /= this._sampleRate;
    this._loopLength /= this._sampleRate;
  } else {
    this._loopStart = 0;
    this._loopLength = this._totalTime;
  }
  this._onLoad();
};

/* rpg_core.js:8208 — VERBATIM including the engine's own broken indentation on
   the wrap loop. ONE source node, started at offset; MZ splits the buffer into
   chunks and starts a node per chunk (rmmz_core.js:5271). _startTime is set
   AFTER start() on MV and BEFORE the node work on MZ. */
WebAudio.prototype._startPlaying = function (loop, offset) {
  if (this._loopLength > 0) {
    while (offset >= this._loopStart + this._loopLength) {
      offset -= this._loopLength;
    }
  }
  this._removeEndTimer();
  this._removeNodes();
  this._createNodes();
  this._connectNodes();
  this._sourceNode.loop = loop;
  this._sourceNode.start(0, offset);
  this._startTime = WebAudio._context.currentTime - offset / this._pitch;
  this._createEndTimer();
};

/* rpg_core.js:8228 / :8246 — MV builds all three nodes then connects them in a
   second pass. MZ creates panner first, connects it to the master gain inside
   its own creator, then gain, then sources (rmmz_core.js:5359-5390) — the
   graph is the same, the construction order is not. */
WebAudio.prototype._createNodes = function () {
  var context = WebAudio._context;
  this._sourceNode = context.createBufferSource();
  this._sourceNode.buffer = this._buffer;
  this._sourceNode.loopStart = this._loopStart;
  this._sourceNode.loopEnd = this._loopStart + this._loopLength;
  this._sourceNode.playbackRate.setValueAtTime(this._pitch, context.currentTime);
  this._gainNode = context.createGain();
  this._gainNode.gain.setValueAtTime(this._volume, context.currentTime);
  this._pannerNode = context.createPanner();
  this._pannerNode.panningModel = 'equalpower';
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

/* rpg_core.js:8625. */
Html5Audio.clear = function () {
  this.stop();
  this._volume = 1;
  this._loadListeners = [];
  this._hasError = false;
  this._autoPlay = false;
  this._isLoading = false;
  this._buffered = false;
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
   pitch or pan. The `.bind(this)` on the getter is the engine's. */
Object.defineProperty(Html5Audio, 'url', {
  get: function () {
    return Html5Audio._url;
  },
  configurable: true
});
Object.defineProperty(Html5Audio, 'volume', {
  get: function () {
    return Html5Audio._volume;
  }.bind(this),
  set: function (value) {
    Html5Audio._volume = value;
    if (Html5Audio._audioElement) {
      Html5Audio._audioElement.volume = this._volume;
    }
  },
  configurable: true
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

/* rpg_core.js:8722 / :8747 / :8799 / :8814 / :8824 / :8839 / :8857. */
Html5Audio.play = function (loop, offset) {
  if (this.isReady()) {
    offset = offset || 0;
    this._startPlaying(loop, offset);
  } else if (Html5Audio._audioElement) {
    this._autoPlay = true;
    this.addLoadListener(function () {
      if (this._autoPlay) {
        this.play(loop, offset);
        if (this._gainTweenInterval) {
          clearInterval(this._gainTweenInterval);
          this._gainTweenInterval = null;
        }
      }
    }.bind(this));
    if (!this._isLoading) this._load(this._url);
  }
};
/* Note _tweenInterval here vs _gainTweenInterval everywhere else — the engine
   really does check a field that is never assigned, so this branch is dead.
   Kept verbatim. */
Html5Audio.stop = function () {
  if (this._audioElement) this._audioElement.pause();
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
  if (this.isReady()) {
    if (this._audioElement) {
      this._tweenTargetGain = this._volume;
      this._tweenGain = 0;
      this._startGainTween(duration);
    }
  } else if (this._autoPlay) {
    this.addLoadListener(function () {
      this.fadeIn(duration);
    }.bind(this));
  }
};
Html5Audio.fadeOut = function (duration) {
  if (this._audioElement) {
    this._tweenTargetGain = 0;
    this._tweenGain = this._volume;
    this._startGainTween(duration);
  }
};
Html5Audio._startGainTween = function (duration) {
  this._audioElement.volume = this._tweenGain;
  if (this._gainTweenInterval) {
    clearInterval(this._gainTweenInterval);
    this._gainTweenInterval = null;
  }
  this._tweenGainStep = (this._tweenTargetGain - this._tweenGain) / (60 * duration);
  this._gainTweenInterval = setInterval(function () {
    Html5Audio._applyTweenValue(Html5Audio._tweenTargetGain);
  }, 1000 / 60);
};
Html5Audio._applyTweenValue = function (volume) {
  Html5Audio._tweenGain += Html5Audio._tweenGainStep;
  if (Html5Audio._tweenGain < 0 && Html5Audio._tweenGainStep < 0) {
    Html5Audio._tweenGain = 0;
  }
  else if (Html5Audio._tweenGain > volume && Html5Audio._tweenGainStep > 0) {
    Html5Audio._tweenGain = volume;
  }

  if (Math.abs(Html5Audio._tweenTargetGain - Html5Audio._tweenGain) < 0.01) {
    Html5Audio._tweenGain = Html5Audio._tweenTargetGain;
    clearInterval(Html5Audio._gainTweenInterval);
    Html5Audio._gainTweenInterval = null;
  }

  Html5Audio._audioElement.volume = Html5Audio._tweenGain;
};
Html5Audio.seek = function () {
  if (this._audioElement) {
    return this._audioElement.currentTime;
  } else {
    return 0;
  }
};
Html5Audio.addLoadListener = function (listner) {
  this._loadListeners.push(listner);
};
Html5Audio._load = function (url) {
  if (this._audioElement) {
    this._isLoading = true;
    this._audioElement.src = url;
    window.__audioLoads.push(url);
    this._buffered = !!window.__audioExists(url);
    this._audioElement.load();
  }
};
Html5Audio._startPlaying = function (loop, offset) {
  this._audioElement.loop = loop;
  if (this._gainTweenInterval) {
    clearInterval(this._gainTweenInterval);
    this._gainTweenInterval = null;
  }
  if (this._audioElement) {
    this._audioElement.volume = this._volume;
    this._audioElement.currentTime = offset;
    this._audioElement.play();
  }
};
Html5Audio._onLoad = function () {
  this._isLoading = false;
  while (this._loadListeners.length > 0) {
    var listener = this._loadListeners.shift();
    listener();
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
      if (Decrypter.hasEncryptedAudio && this.shouldUseHtml5Audio()) {
        this.playEncryptedBgm(bgm, pos);
      }
      else {
        this._bgmBuffer = this.createBuffer('bgm', bgm.name);
        this.updateBgmParameters(bgm);
        if (!this._meBuffer) {
          this._bgmBuffer.play(true, pos || 0);
        }
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
  this._blobUrl = url;
  this._bgmBuffer = this.createBuffer('bgm', bgm.name);
  this.updateBgmParameters(bgm);
  if (!this._meBuffer) {
    this._bgmBuffer.play(true, pos || 0);
  }
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
    this.updateBgsParameters(bgs);
  } else {
    this.stopBgs();
    if (bgs.name) {
      this._bgsBuffer = this.createBuffer('bgs', bgs.name);
      this.updateBgsParameters(bgs);
      this._bgsBuffer.play(true, pos || 0);
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
AudioManager.playStaticSe = function (se) {
  if (se.name) {
    this.loadStaticSe(se);
    for (var i = 0; i < this._staticBuffers.length; i++) {
      var buffer = this._staticBuffers[i];
      if (buffer._reservedSeName === se.name) {
        buffer.stop();
        this.updateSeParameters(buffer, se);
        buffer.play(false);
        break;
      }
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
  for (var i = 0; i < this._staticBuffers.length; i++) {
    var buffer = this._staticBuffers[i];
    if (buffer._reservedSeName === se.name) {
      return true;
    }
  }
  return false;
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
