/* =============================================================================
   GigaHack test harness — stubs/x-audio-mz.js
   AUDIO: the MZ-ONLY surface. Modelled on MZ rmmz_core.js and
   rmmz_managers.js (MZ 1.9.0), cited file:line on every group.

   Loaded immediately after engine-mz.js, which is loaded after x-audio.js.
   Everything shared — the AudioManager fields, the four volume accessors,
   replay/isCurrent/updateCurrent, the four fade methods, stopAll, saveBgm,
   saveBgs, makeEmptyAudioObject, updateBufferParameters,
   the WebAudio constructor and its six identical members, SoundManager's two
   system-sound methods, and the fake audio graph — is in x-audio.js and is NOT
   repeated here. This file is only what MZ does differently.

   Bodies are written from what the engine DOES, not from how it writes it: a
   switch may be a lookup here, a temporary may be gone, a table may stand in
   for a run of assignments. The engine's ES6 has no place on the harness's ES5
   floor anyway (no const/let, arrow, for..of or spread), and where the engine
   uses a method with no ES5 equivalent (Array.prototype.find) the substitution
   is called out. What does NOT move: names, values, call order, return values,
   and which engine a definition belongs to. Where a body is deliberately
   awkward the awkwardness is behaviour and is kept; the comment says why.

   One name here is NOT the engine's: mzRampGain, a file-local function that
   says once what the four gain fades all do. It is a plain function and is
   deliberately not a member of WebAudio, so nothing probing the class can
   mistake it for engine surface.

   THE MZ-ONLY THINGS THAT MATTER MOST:
     · cleanupSe. MV has no such method — see the note on playSe below; it is
       the SE difference a panel has to work around.
     · stopBgm/stopBgs/stopMe/stopSe call buffer.destroy(). MV calls .stop(),
       and destroy() does not exist there at all.
     · WebAudio.prototype.destroy and WebAudio.prototype.retry are MZ-only.
       throwLoadError hands the retry function out inside a thrown ARRAY, which
       is how MZ offers a "retry" button where MV offers a dead game.
     · There is NO AudioManager.masterVolume, NO shouldUseHtml5Audio, NO
       Html5Audio, NO Decrypter and NO canPlayOgg/canPlayM4a on WebAudio.
       Deliberately not defined: their absence is a capability probe's answer.
     · Encryption is a "_" appended to the url, not a changed extension.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Utils — the audio-relevant members MZ added and MV never had, plus the two
   MZ needs that core.js does not define.
   ---------------------------------------------------------------------- */

/* rmmz_core.js:251. MV's (rpg_core.js:217) is the same shape with IEMobile
   still in the alternation. Read by WebAudio._shouldMuteOnHide; MZ's
   audioFileExt does NOT read it, MV's does. */
Utils.isMobileDevice = function () {
  var r = /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/i;
  return !!navigator.userAgent.match(r);
};

/* rmmz_core.js:285 — MZ-only, and WebAudio._startLoading branches on it:
   file:// gets XHR, http(s):// gets fetch. MV always uses XHR. The harness
   runs over http, so the fetch branch is the live one; both are recorded. */
Utils.isLocal = function () {
  return window.location.href.startsWith('file:');
};

/* rmmz_core.js:339 — MZ-only. MV's codec probe lives on WebAudio
   (canPlayOgg/canPlayM4a, rpg_core.js:7727/:7741) and feeds audioFileExt.
   MZ's feeds only _shouldUseDecoder: if the browser cannot play ogg, MZ falls
   back to a bundled VorbisDecoder rather than to a different file. */
Utils.canPlayOgg = function () {
  if (!Utils._audioElement) {
    Utils._audioElement = document.createElement('audio');
  }
  return !!(
    Utils._audioElement &&
    Utils._audioElement.canPlayType('audio/ogg; codecs="vorbis"')
  );
};

/* rmmz_core.js:370 — MZ-only, and the difference is the '/'. MV's createBuffer
   uses encodeURIComponent, which escapes the slash, so a BGM in a subfolder
   resolves on MZ and 404s on MV. */
Utils.encodeURI = function (str) {
  return encodeURIComponent(str).replace(/%2F/g, '/');
};

/* rmmz_core.js:414 / :431 / :440 — MZ-only. MV has Decrypter.hasEncryptedImages
   and Decrypter.hasEncryptedAudio as plain FIELDS; MZ made them FUNCTIONS on
   Utils over private backing fields, so a probe written for one engine reads
   the other as "a truthy function" or "undefined is not a function". The
   backing fields start undefined, not false — setEncryptionInfo is what boots
   them, and nothing else writes them. */
Utils._hasEncryptedImages = false;
Utils._hasEncryptedAudio = false;
Utils._encryptionKey = '';
Utils.setEncryptionInfo = function (hasImages, hasAudio, key) {
  // [Note] This function is implemented for module independence.
  this._hasEncryptedImages = hasImages;
  this._hasEncryptedAudio = hasAudio;
  this._encryptionKey = key;
};
Utils.hasEncryptedImages = function () {
  return this._hasEncryptedImages;
};
Utils.hasEncryptedAudio = function () {
  return this._hasEncryptedAudio;
};

/* =========================================================================
   WebAudio — the MZ statics.
   ====================================================================== */

/* rmmz_core.js:4699 — takes NO argument and is NOT idempotent: every call
   throws away the context and builds a new one. MV's (rpg_core.js:7707) takes
   a noAudio flag, guards on _initialized, and is called lazily from the
   constructor. MZ's is called once, from SceneManager.initAudio
   (rmmz_managers.js:1962) — so on MZ a WebAudio constructed before that has a
   null _context and silently never loads, with no error anywhere. See the
   explicit call at the bottom of this file. */
WebAudio.initialize = function () {
  this._context = null;
  this._masterGainNode = null;
  this._masterVolume = 1;
  this._createContext();
  this._createMasterGainNode();
  this._setupEventHandlers();
  return !!this._context;
};

/* rmmz_core.js:4728 — MZ-ONLY, and it is the reason MZ survives a null
   context where MV throws: every read of the clock goes through here and gets
   0 instead of a TypeError. MV reads WebAudio._context.currentTime directly in
   six places. */
WebAudio._currentTime = function () {
  return this._context ? this._context.currentTime : 0;
};

/* rmmz_core.js:4714 — delegates to _resetVolume. MV inlines the same
   setValueAtTime (rpg_core.js:7755) and has no _resetVolume. */
WebAudio.setMasterVolume = function (value) {
  this._masterVolume = value;
  this._resetVolume();
};

/* rmmz_core.js:4719 — the engine reads window.AudioContext ||
   window.webkitAudioContext and swallows the throw. The harness substitutes
   the fake context from x-audio.js; the try/catch shape is kept because "no
   context" is a state the rest of the class branches on. */
WebAudio._createContext = function () {
  try {
    this._context = window.__makeAudioContext();
  } catch (e) {
    this._context = null;
  }
};

/* rmmz_core.js:4732 — MZ calls _resetVolume() where MV inlines a
   setValueAtTime with the context's own currentTime (rpg_core.js:7797). */
WebAudio._createMasterGainNode = function () {
  var context = this._context;
  if (context) {
    this._masterGainNode = context.createGain();
    this._resetVolume();
    this._masterGainNode.connect(context.destination);
  }
};

/* rmmz_core.js:4741 — FOUR listeners, all on `document`. MV binds five
   (rpg_core.js:7811): it keeps a separate touchstart handler for the iOS
   unlock hack that MZ dropped. */
WebAudio._setupEventHandlers = function () {
  var onUserGesture = this._onUserGesture.bind(this);
  var onVisibilityChange = this._onVisibilityChange.bind(this);
  document.addEventListener('keydown', onUserGesture);
  document.addEventListener('mousedown', onUserGesture);
  document.addEventListener('touchend', onUserGesture);
  document.addEventListener('visibilitychange', onVisibilityChange);
};

/* rmmz_core.js:4750 — MZ-only name for MV's _onTouchStart, and it does LESS:
   it resumes a suspended context and stops. MV additionally starts a throwaway
   buffer source to unlock iOS and latches _unlocked. */
WebAudio._onUserGesture = function () {
  var context = this._context;
  if (context && context.state === 'suspended') {
    context.resume();
  }
};

/* rmmz_core.js:4771 — fades back in over 1s; MV over 0.5s (rpg_core.js:7873).
   _onHide and _onVisibilityChange are identical and live in x-audio.js. */
WebAudio._onShow = function () {
  if (this._shouldMuteOnHide()) {
    this._fadeIn(1);
  }
};

/* rmmz_core.js:4777 — MZ exempts an installed home-screen web app
   (navigator.standalone); MV mutes every mobile device unconditionally
   (rpg_core.js:7884). */
WebAudio._shouldMuteOnHide = function () {
  return Utils.isMobileDevice() && !window.navigator.standalone;
};

/* rmmz_core.js:4781 — MZ-ONLY. MV re-asserts the master gain inline inside
   setMasterVolume and has no equivalent method. */
WebAudio._resetVolume = function () {
  if (this._masterGainNode) {
    var gain = this._masterGainNode.gain;
    var volume = this._masterVolume;
    var currentTime = this._currentTime();
    gain.setValueAtTime(volume, currentTime);
  }
};

/* Every fade in MZ's audio graph is the same pair of calls: pin `from` at the
   clock's now, then slide to `to` over `duration` seconds. Four of them appear
   below — master fade in/out here, buffer fade in/out further down — and the
   only thing MZ-specific about any of them is which clock they read.
   WebAudio._currentTime() answers 0 rather than throwing when there is no
   context, so an MZ fade against a dead context is silent where MV's is a
   TypeError; stating that once is the point of this function.

   HARNESS-LOCAL. Not an engine name, not part of the modelled surface, and
   deliberately not hung off WebAudio — nothing should be able to find it by
   probing the class. */
function mzRampGain(param, from, to, duration) {
  var now = WebAudio._currentTime();
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(to, now + duration);
}

/* rmmz_core.js:4790 / :4800 — the master ramps. MV runs the same two calls off
   WebAudio._context.currentTime read directly, which throws with a null
   context; these go quiet instead. */
WebAudio._fadeIn = function (duration) {
  if (this._masterGainNode) {
    mzRampGain(this._masterGainNode.gain, 0, this._masterVolume, duration);
  }
};
WebAudio._fadeOut = function (duration) {
  if (this._masterGainNode) {
    mzRampGain(this._masterGainNode.gain, this._masterVolume, 0, duration);
  }
};

/* =========================================================================
   WebAudio — the MZ instance.
   ====================================================================== */

/* rmmz_core.js:4688 — three lines, and _url is assigned BEFORE loading starts.
   MV assigns it AFTER (rpg_core.js:7678), so an MV buffer that fails
   synchronously reports an undefined url. MZ also has no ResourceHandler
   loader hookup and no lazy WebAudio.initialize() call. */
WebAudio.prototype.initialize = function (url) {
  this.clear();
  this._url = url;
  this._startLoading();
};

/* rmmz_core.js:4813 — TWENTY-THREE fields against MV's twenty, and the overlap
   is not clean:
     MZ-only: _data _fetchedSize _fetchedData _buffers _sourceNodes _loop
              _loopStartTime _loopLengthTime _lastUpdateTime _isLoaded
              _isError _isPlaying _decoder
     MV-only: _buffer _sourceNode _hasError _autoPlay
   _buffers/_sourceNodes are ARRAYS because MZ decodes a stream in chunks and
   runs one source node per chunk. Anything reading a buffer's state has to
   know which engine's field set it is looking at — `buffer._buffer` is
   undefined on MZ and `buffer._buffers` is undefined on MV.

   Written here as the table it is. The field NAMES, their starting VALUES and
   their ORDER are all interface — the order because this runs before anything
   else touches a fresh WebAudio, so it is the property-creation order every
   instance is enumerated in — so the table is what the engine says and the
   loop is what the engine does with it. Two things the table has to say that
   a list of assignments says implicitly:
     · a list-valued field is written `newList` and CALLED, because each buffer
       must own its arrays. One shared array and every buffer in the game would
       push its decoded chunks onto the same list.
     · `_loop` starts at the NUMBER 0, not false. play(loop) overwrites it with
       whatever it was handed and everything downstream reads it as a flag, so
       the start value is only ever seen on a buffer that has not played yet —
       where `!buffer._loop` is true but `buffer._loop === false` is not. */
WebAudio.prototype.clear = (function () {
  var newList = function () { return []; };
  var initialState = {
    _data: null,
    _fetchedSize: 0,
    _fetchedData: newList,
    _buffers: newList,
    _sourceNodes: newList,
    _gainNode: null,
    _pannerNode: null,
    _totalTime: 0,
    _sampleRate: 0,
    _loop: 0,
    _loopStart: 0,
    _loopLength: 0,
    _loopStartTime: 0,
    _loopLengthTime: 0,
    _startTime: 0,
    _volume: 1,
    _pitch: 1,
    _pan: 0,
    _endTimer: null,
    _loadListeners: newList,
    _stopListeners: newList,
    _lastUpdateTime: 0,
    _isLoaded: false,
    _isError: false,
    _isPlaying: false,
    _decoder: null
  };
  var fields = Object.keys(initialState);
  return function () {
    this.stop();
    for (var i = 0; i < fields.length; i++) {
      var start = initialState[fields[i]];
      this[fields[i]] = start === newList ? newList() : start;
    }
  };
})();

/* rmmz_core.js:4863 / :4885. `url` and `pan` are identical on both engines and
   live in x-audio.js; these two are not.
   volume: MZ goes through WebAudio._currentTime(), MV reads
   WebAudio._context.currentTime.
   pitch: MZ re-plays with `this._loop`, a field it owns; MV reads the flag
   back off the live source node. */
Object.defineProperty(WebAudio.prototype, 'volume', {
  get: function () { return this._volume; },
  set: function (value) {
    this._volume = value;
    if (this._gainNode) {
      this._gainNode.gain.setValueAtTime(
        this._volume,
        WebAudio._currentTime()
      );
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
        this.play(this._loop, 0);
      }
    }
  },
  configurable: true
});

/* rmmz_core.js:4922 / :4931 / :4940. isReady is a LENGTH test on an array;
   isError and isPlaying read explicit flags. MV derives all three from object
   truthiness (rpg_core.js:8020/:8030/:8040), and that is the split that
   decides SE lifetime: an MZ buffer reports isPlaying TRUE from the moment
   play() is called, before it has loaded and after its nodes are gone, so
   cleanupSe's `!buffer.isPlaying()` only ever catches buffers that were
   explicitly stopped. MV's isPlaying goes false on its own when the end timer
   removes the node — which is why MV's playSe filter actually prunes and MZ
   needs cleanupSe. */
WebAudio.prototype.isReady = function () {
  return this._buffers && this._buffers.length > 0;
};
WebAudio.prototype.isError = function () {
  return this._isError;
};
WebAudio.prototype.isPlaying = function () {
  return this._isPlaying;
};

/* rmmz_core.js:4950 — note the two differences from MV (rpg_core.js:8051):
   `this._loop = loop` is recorded FIRST, and `this._isPlaying = true` is set
   at the END on EVERY path, including the not-ready one. There is no _autoPlay
   guard, so a queued load listener replays unconditionally — stop() cancels it
   by emptying _loadListeners instead. */
WebAudio.prototype.play = function (loop, offset) {
  this._loop = loop;
  if (this.isReady()) {
    offset = offset || 0;
    this._startPlaying(offset);
  } else if (WebAudio._context) {
    var self = this;
    this.addLoadListener(function () { self.play(loop, offset); });
  }
  this._isPlaying = true;
};

/* rmmz_core.js:4964 — clears _loadListeners, which MV does not
   (rpg_core.js:8070). That is how MZ cancels a pending auto-play without an
   _autoPlay flag. Stop listeners are shifted and run in both. */
WebAudio.prototype.stop = function () {
  this._isPlaying = false;
  this._removeEndTimer();
  this._removeNodes();
  /* Emptying this is the whole of MZ's auto-play cancellation. */
  this._loadListeners = [];
  /* Drained off the live field, never off a saved reference: a stop listener
     that reaches destroy() -> clear() -> stop() replaces the list underneath
     this loop, and the next test has to see the replacement. AudioManager's ME
     listener is exactly that path. */
  while (this._stopListeners && this._stopListeners.length > 0) {
    this._stopListeners.shift()();
  }
};

/* rmmz_core.js:4980 — MZ-ONLY, and the one every AudioManager stop* method
   calls. It runs clear(), which runs stop() and then wipes the decoded
   buffers, the url-independent state and the listeners. MV has NOTHING here:
   calling destroy() on an MV buffer is a TypeError, and calling stop() on MZ
   where the engine would destroy leaks the decoded audio. */
WebAudio.prototype.destroy = function () {
  this._destroyDecoder();
  this.clear();
};

/* rmmz_core.js:4990 — the else is UNCONDITIONAL. MV's is
   `else if (this._autoPlay)` (rpg_core.js:8088), so a fadeIn queued against a
   loading buffer that is not auto-playing survives on MZ and is dropped on MV.
   AudioManager.replayBgm calls playBgm then fadeIn, which is exactly that. */
WebAudio.prototype.fadeIn = function (duration) {
  if (this.isReady()) {
    if (this._gainNode) {
      mzRampGain(this._gainNode.gain, 0, this._volume, duration);
    }
  } else {
    var self = this;
    this.addLoadListener(function () { self.fadeIn(duration); });
  }
};

/* rmmz_core.js:5008 — clears _isPlaying AND _loadListeners; MV clears
   _autoPlay only (rpg_core.js:8109). Either way the nodes keep running: a
   faded-out buffer is still connected and still audible until the ramp lands.
   On MZ it also now reports isPlaying() false while still making sound, which
   is precisely what makes cleanupSe destroy it. */
WebAudio.prototype.fadeOut = function (duration) {
  if (this._gainNode) {
    mzRampGain(this._gainNode.gain, this._volume, 0, duration);
  }
  /* The ramp is left running. Only the flag and the queued auto-play go, which
     is what leaves the buffer audible and isPlaying() false at the same time. */
  this._isPlaying = false;
  this._loadListeners = [];
};

/* rmmz_core.js:5022 — same arithmetic as MV (rpg_core.js:8124) over a
   DIFFERENT PAIR of fields: _loopStartTime/_loopLengthTime (seconds) here,
   _loopStart/_loopLength (converted in place to seconds) there. On MZ
   _loopStart/_loopLength stay in SAMPLES, so reading them as seconds is off by
   the sample rate — 44100x. AudioManager.saveBgm's `pos` comes through here. */
WebAudio.prototype.seek = function () {
  if (!WebAudio._context) {
    return 0;
  }
  var pos = (WebAudio._currentTime() - this._startTime) * this._pitch;
  /* Wall-clock elapsed is unbounded; a looping stream's position is not, so
     whole loops are taken back off until the position is inside the window
     again. A zero-length window is not a loop and is left alone — which is
     also the guard that stops this spinning. */
  var loopEnd = this._loopStartTime + this._loopLengthTime;
  while (this._loopLengthTime > 0 && pos >= loopEnd) {
    pos -= this._loopLengthTime;
  }
  return pos;
};

/* rmmz_core.js:5057 — MZ-ONLY. This is the function throwLoadError binds and
   hands out inside the thrown array, so MZ's load-error screen can offer
   "Retry" and MV's cannot. Note it re-plays with the REMEMBERED _loop, so a
   retry of a BGM keeps looping and a retry of an SE does not. */
WebAudio.prototype.retry = function () {
  this._startLoading();
  if (this._isPlaying) {
    this.play(this._loop, 0);
  }
};

/* rmmz_core.js:5064 — the TRANSPORT is faked; everything around it is MZ's:
     · _realUrl() applies the encryption suffix, and THAT url is recorded;
     · the isLocal() branch really decides XHR vs fetch, and which one ran is
       recorded — the two have different failure modes in the engine
       (_onXhrLoad checks status < 400, _onFetch checks response.ok);
     · _isError and _isLoaded are reset BEFORE the load, and _lastUpdateTime is
       backdated by 0.5s so the first progressive update passes its own gate;
     · the decoder is destroyed and conditionally rebuilt, in that order.
   Left out: XMLHttpRequest, fetch, the chunked reader (_onFetchProcess /
   _concatenateFetchedData / _updateBufferOnFetch), _readableBuffer's
   decryption, _readLoopComments and decodeAudioData. */
WebAudio.prototype._startLoading = function () {
  if (WebAudio._context) {
    var url = this._realUrl();
    if (Utils.isLocal()) {
      window.__audioFetchMode = 'xhr';
    } else {
      window.__audioFetchMode = 'fetch';
    }
    window.__audioLoads.push(url);
    var currentTime = WebAudio._currentTime();
    this._lastUpdateTime = currentTime - 0.5;
    this._isError = false;
    this._isLoaded = false;
    this._destroyDecoder();
    if (this._shouldUseDecoder()) {
      this._createDecoder();
    }
    var self = this;
    var settle = function () {
      if (window.__audioExists(url)) {
        self._isLoaded = true;
        self._onDecode(window.__audioFakeBuffer());
      } else {
        self._onError();
      }
    };
    if (window.__audioAsync) window.__audioPending.push(settle);
    else settle();
  }
};

/* rmmz_core.js:5083 / :5087 / :5095 — MZ-ONLY. VorbisDecoder is an optional
   bundled script; `typeof VorbisDecoder === "function"` is false in the
   harness, so _shouldUseDecoder answers false and the single-buffer path runs.
   MV has no software fallback at all — it picks .m4a instead. */
WebAudio.prototype._shouldUseDecoder = function () {
  return !Utils.canPlayOgg() && typeof VorbisDecoder === 'function';
};
WebAudio.prototype._createDecoder = function () {
  this._decoder = new VorbisDecoder(
    WebAudio._context,
    this._onDecode.bind(this),
    this._onError.bind(this)
  );
};
WebAudio.prototype._destroyDecoder = function () {
  if (this._decoder) {
    this._decoder.destroy();
    this._decoder = null;
  }
};

/* rmmz_core.js:5102 — THE encryption difference, one line long. MZ appends an
   UNDERSCORE to the whole url: audio/bgm/Theme.ogg_ . MV rewrites the
   EXTENSION: audio/bgm/Theme.rpgmvo (Decrypter.extToEncryptExt,
   rpg_core.js:9253). Same project, different filenames on disk, and the probe
   that decides is a function here and a field there. */
WebAudio.prototype._realUrl = function () {
  return this._url + (Utils.hasEncryptedAudio() ? '_' : '');
};

/* rmmz_core.js:5158 — sets the flag and drops the data; it does NOT throw and
   does NOT clear the url. MV's failure path is a bare `this._hasError = true`
   inside an xhr.onerror (rpg_core.js:8175) with no node teardown at all. */
WebAudio.prototype._onError = function () {
  if (this._sourceNodes.length > 0) {
    this._stopSourceNode();
  }
  this._data = null;
  this._isError = true;
};

/* rmmz_core.js:5231 — the decode callback, in the engine's own field order.
   Note it PUSHES onto _buffers and ACCUMULATES _totalTime (one call per stream
   chunk), resetting both first only when the decoder is not in use. The loop
   conversion writes the *Time pair and LEAVES _loopStart/_loopLength in
   samples — the opposite of MV, which divides them in place
   (rpg_core.js:8184). __audioLoop stands in for what _readLoopComments would
   have parsed out of the ogg. */
WebAudio.prototype._onDecode = function (buffer) {
  if (window.__audioLoop) {
    this._loopStart = window.__audioLoop.start;
    this._loopLength = window.__audioLoop.length;
    this._sampleRate = window.__audioLoop.sampleRate;
  }
  /* One call per chunk while the software decoder streams; one call for the
     whole file otherwise. Only the streaming case accumulates — without the
     decoder each decode REPLACES the buffer list and the running total, so
     re-loading a url does not double its length. */
  if (!this._shouldUseDecoder()) {
    this._buffers = [];
    this._totalTime = 0;
  }
  this._buffers.push(buffer);
  this._totalTime += buffer.duration;
  /* _loopStart/_loopLength are SAMPLE counts and are LEFT that way; the
     seconds pair beside them is what playback reads, and both halves of the
     conversion need a sample rate to divide by. With no usable loop comments
     the loop is the whole stream, which for a chunked one grows with it. */
  var haveLoopPoints = this._loopLength > 0 && this._sampleRate > 0;
  this._loopStartTime = haveLoopPoints
    ? this._loopStart / this._sampleRate
    : 0;
  this._loopLengthTime = haveLoopPoints
    ? this._loopLength / this._sampleRate
    : this._totalTime;
  if (this._sourceNodes.length > 0) {
    this._refreshSourceNode();
  }
  this._onLoad();
};

/* rmmz_core.js:5251 — SHAPE. The engine branches on _shouldUseDecoder to
   refresh either the newest chunk or all of them, then re-arms the end timer
   if still playing. With the decoder path unreachable here only the else side
   can run; the call order and the _isPlaying gates are the engine's. */
WebAudio.prototype._refreshSourceNode = function () {
  if (this._shouldUseDecoder()) {
    /* Streaming: every chunk before the one that just arrived already has a
       node of its own and is still sounding, so nothing is stopped and only
       the newest chunk is given a node. */
    var newest = this._buffers.length - 1;
    this._createSourceNode(newest);
    if (this._isPlaying) {
      this._startSourceNode(newest);
    }
  } else {
    /* Whole-file decode: _onDecode threw the buffer list away, so the nodes
       hanging off the old one are stale. Out they go, and the graph is rebuilt
       from the list that replaced it. */
    this._stopSourceNode();
    this._createAllSourceNodes();
    if (this._isPlaying) {
      this._startAllSourceNodes();
    }
  }
  /* Either way _totalTime has moved under the end timer, which was armed
     against the old one. A buffer that is not playing has no timer to re-arm
     — and _createEndTimer would arm one against a _startTime from last time. */
  if (!this._isPlaying) {
    return;
  }
  this._removeEndTimer();
  this._createEndTimer();
};

/* rmmz_core.js:5271 — _startTime is computed FIRST here and LAST on MV
   (rpg_core.js:8208), which matters because _startSourceNode calls seek(), and
   seek() reads _startTime. Node construction is panner, gain, sources — MV
   builds all three then connects them in a second pass. */
WebAudio.prototype._startPlaying = function (offset) {
  /* The same wrap seek() applies on the way out, applied here on the way in:
     a saved BGM position from deep inside a loop names a point in the window,
     not a point on an ever-growing timeline. */
  var loopEnd = this._loopStartTime + this._loopLengthTime;
  while (this._loopLengthTime > 0 && offset >= loopEnd) {
    offset -= this._loopLengthTime;
  }
  /* _startTime is fixed BEFORE a single node exists, because _startSourceNode
     calls seek() and seek() reads _startTime. */
  this._startTime = WebAudio._currentTime() - offset / this._pitch;
  this._removeEndTimer();
  this._removeNodes();
  this._createPannerNode();
  this._createGainNode();
  this._createAllSourceNodes();
  this._startAllSourceNodes();
  this._createEndTimer();
};

WebAudio.prototype._startAllSourceNodes = function () {
  for (var i = 0; i < this._sourceNodes.length; i++) {
    this._startSourceNode(i);
  }
};

/* rmmz_core.js:5293 — SHAPE, not the full body. The engine's is ~50 lines of
   chunk arithmetic that schedules each decoded chunk at its own `when` and
   `offset`, wraps them around the loop points, shortens the last chunk to the
   loop end, and (decoder path only) re-arms itself from sourceNode.onended.
   Left out because it only ever matters when _buffers holds MORE THAN ONE
   chunk, which requires the real progressive fetch. What is kept is what a
   single-chunk buffer does and what an observer can check: the chunk offsets
   are summed the same way, `when`/`offset` come from seek() against the chunk
   window, and start() is called only when `when >= currentTime`.
   MV has no analogue at all — one node, `start(0, offset)`.

   TWO of the engine's locals are dead on this path and are not reproduced:
   its `duration` (clipped to the loop end) is only ever passed to start() by
   the decoder branch, and its trailing `chunkStart += ...` writes a local
   nothing reads afterwards. Both are pure arithmetic over locals, so dropping
   them is invisible; what start() is called with is not touched. */
WebAudio.prototype._startSourceNode = function (index) {
  var sourceNode = this._sourceNodes[index];
  var chunkLength = sourceNode.buffer.duration;
  var pitch = this._pitch;
  var seekPos = this.seek();          /* seek() first: it reads the clock too */
  var currentTime = WebAudio._currentTime();
  var loopStart = this._loopStartTime;
  var loopLength = this._loopLengthTime;

  /* Where this chunk sits in the concatenated stream. Summed forwards, chunk
     by chunk, which is also how _onDecode grew _totalTime. */
  var chunkStart = 0;
  var earlier = 0;
  while (earlier < index) {
    chunkStart += this._buffers[earlier].duration;
    earlier++;
  }

  /* The clock reading at which stream position `pos` comes round, given that
     position seekPos is playing now and time runs at `pitch`. */
  function arrivalOf(pos) {
    return currentTime + (pos - seekPos) / pitch;
  }

  var when;
  var offset;
  if (seekPos >= chunkStart && seekPos < chunkStart + chunkLength - 0.01) {
    /* The playhead is inside this chunk already — start now, that far in.
       The 10ms is what stops a chunk we are all but past being started for
       the sliver of itself that is left. */
    when = currentTime;
    offset = seekPos - chunkStart;
  } else {
    when = arrivalOf(chunkStart);
    offset = 0;
    if (this._loop) {
      /* Its turn has been and gone (10ms of slack again): it comes round
         once more one loop from now. */
      if (when < currentTime - 0.01) {
        when += loopLength / pitch;
      }
      /* The playhead is at or past the loop start while the chunk begins
         before it, so playback will re-enter this chunk AT the loop start
         rather than at its own beginning. `skipped` is the head of the chunk
         that will never be heard again, and it comes off both the wait and
         the buffer offset. */
      var skipped = loopStart - chunkStart;
      if (seekPos >= loopStart && skipped > 0) {
        when += skipped / pitch;
        offset = skipped;
      }
    }
  }

  /* Two ways a chunk earns no node of its own this time round: its moment is
     already behind us, or the loop skip above pushed the offset off the end of
     the buffer. Either way it is left silent rather than started late. */
  if (when >= currentTime && offset < chunkLength) {
    sourceNode.start(when, offset);
  }
};

/* rmmz_core.js:5348 — swallows InvalidStateError per node. MV's _removeNodes
   calls stop(0) on its single node with no try (rpg_core.js:8256). */
WebAudio.prototype._stopSourceNode = function () {
  for (var i = 0; i < this._sourceNodes.length; i++) {
    var sourceNode = this._sourceNodes[i];
    try {
      sourceNode.onended = null;
      sourceNode.stop();
    } catch (e) {
      // Ignore InvalidStateError
    }
  }
};

/* rmmz_core.js:5359 / :5366 / :5373 / :5379 — MZ connects each node to its
   parent AS IT CREATES IT (panner->master, gain->panner, source->gain), so the
   graph is live from the first node. MV builds all three and connects them in
   a separate _connectNodes pass. Note _createSourceNode's
   `sourceNode.loop = this._loop && this._isLoaded` — a chunk that arrived
   before the stream finished does NOT loop; MV sets loop unconditionally. */
WebAudio.prototype._createPannerNode = function () {
  this._pannerNode = WebAudio._context.createPanner();
  this._pannerNode.panningModel = 'equalpower';
  this._pannerNode.connect(WebAudio._masterGainNode);
  this._updatePanner();
};
WebAudio.prototype._createGainNode = function () {
  var currentTime = WebAudio._currentTime();
  this._gainNode = WebAudio._context.createGain();
  this._gainNode.gain.setValueAtTime(this._volume, currentTime);
  this._gainNode.connect(this._pannerNode);
};
WebAudio.prototype._createAllSourceNodes = function () {
  for (var i = 0; i < this._buffers.length; i++) {
    this._createSourceNode(i);
  }
};
WebAudio.prototype._createSourceNode = function (index) {
  var sourceNode = WebAudio._context.createBufferSource();
  var currentTime = WebAudio._currentTime();
  var loopStart = this._loopStartTime;
  sourceNode.buffer = this._buffers[index];
  /* Not `this._loop` alone: a chunk decoded while the stream was still
     arriving must not loop on itself. MV sets loop unconditionally. */
  sourceNode.loop = this._loop && this._isLoaded;
  sourceNode.loopStart = loopStart;
  sourceNode.loopEnd = loopStart + this._loopLengthTime;
  sourceNode.playbackRate.setValueAtTime(this._pitch, currentTime);
  sourceNode.connect(this._gainNode);
  this._sourceNodes[index] = sourceNode;
};

/* rmmz_core.js:5391 — empties the array and does NOT touch _isPlaying. MV's
   nulls _sourceNode, which flips isPlaying() to false as a side effect
   (rpg_core.js:8256). */
WebAudio.prototype._removeNodes = function () {
  if (this._sourceNodes && this._sourceNodes.length > 0) {
    this._stopSourceNode();
    this._sourceNodes = [];
    this._gainNode = null;
    this._pannerNode = null;
  }
};

/* rmmz_core.js:5400 — gated on `!this._loop` (the remembered field); MV gates
   on the live node's own loop flag (rpg_core.js:8269). */
WebAudio.prototype._createEndTimer = function () {
  /* Nothing to time with no nodes, and a looping buffer has no end. The
     nodes are tested first because that is the order the engine short-circuits
     in, and _sourceNodes is the one of the two that can be absent. */
  if (this._sourceNodes.length === 0 || this._loop) {
    return;
  }
  var playTime = this._totalTime / this._pitch;
  var remaining = this._startTime + playTime - WebAudio._currentTime();
  this._endTimer = setTimeout(this.stop.bind(this), remaining * 1000);
};

/* =========================================================================
   AudioManager — the divergent bodies.

   MZ has NO _masterVolume, NO _blobUrl, NO masterVolume accessor, NO
   playEncryptedBgm, NO createDecryptBuffer and NO shouldUseHtml5Audio.
   Deliberately not defined.
   ====================================================================== */

/* rmmz_managers.js:1164 — the folder carries its OWN TRAILING SLASH ("bgm/"),
   because MZ's createBuffer concatenates it directly. MV passes 'bgm' and its
   createBuffer inserts the slash (rpg_managers.js:1175/:1464). Anything that
   calls createBuffer by hand has to pass a different string per engine.
   MZ also has no encrypted-audio branch here — encryption is handled far
   downstream, in WebAudio.prototype._realUrl. */
AudioManager.playBgm = function (bgm, pos) {
  if (this.isCurrentBgm(bgm)) {
    this.updateBgmParameters(bgm);
  } else {
    this.stopBgm();
    if (bgm.name) {
      this._bgmBuffer = this.createBuffer('bgm/', bgm.name);
      this.updateBgmParameters(bgm);
      if (!this._meBuffer) {
        this._bgmBuffer.play(true, pos || 0);
      }
    }
  }
  this.updateCurrentBgm(bgm, pos);
};

/* rmmz_managers.js:1213 / :1281 / :1326 — buffer.destroy(). MV calls
   buffer.stop() in all three (rpg_managers.js:1243 / :1308 / :1353), and
   destroy() does not exist on an MV buffer. This is the single most portable-
   looking line in the whole audio surface and it throws on the other engine.
   stopMe's tail is byte-identical apart from that one call. */
AudioManager.stopBgm = function () {
  if (this._bgmBuffer) {
    this._bgmBuffer.destroy();
    this._bgmBuffer = null;
    this._currentBgm = null;
  }
};
AudioManager.stopBgs = function () {
  if (this._bgsBuffer) {
    this._bgsBuffer.destroy();
    this._bgsBuffer = null;
    this._currentBgs = null;
  }
};
AudioManager.stopMe = function () {
  if (this._meBuffer) {
    this._meBuffer.destroy();
    this._meBuffer = null;
    if (
      this._bgmBuffer &&
      this._currentBgm &&
      !this._bgmBuffer.isPlaying()
    ) {
      this._bgmBuffer.play(true, this._currentBgm.pos);
      this._bgmBuffer.fadeIn(this._replayFadeTime);
    }
  }
};

/* rmmz_managers.js:1234 — folder 'bgs/'. */
AudioManager.playBgs = function (bgs, pos) {
  if (this.isCurrentBgs(bgs)) {
    this.updateBgsParameters(bgs);
  } else {
    this.stopBgs();
    if (bgs.name) {
      this._bgsBuffer = this.createBuffer('bgs/', bgs.name);
      this.updateBgsParameters(bgs);
      this._bgsBuffer.play(true, pos || 0);
    }
  }
  this.updateCurrentBgs(bgs, pos);
};

/* rmmz_managers.js:1302 — folder 'me/'; otherwise MV's body exactly. */
AudioManager.playMe = function (me) {
  this.stopMe();
  if (me.name) {
    if (this._bgmBuffer && this._currentBgm) {
      this._currentBgm.pos = this._bgmBuffer.seek();
      this._bgmBuffer.stop();
    }
    this._meBuffer = this.createBuffer('me/', me.name);
    this.updateMeParameters(me);
    this._meBuffer.play(false);
    this._meBuffer.addStopListener(this.stopMe.bind(this));
  }
};

/* rmmz_managers.js:1341 — THE SE CLEANUP DIFFERENCE, MZ side, and it is two
   differences in one function:

   1. THE SAME-FRAME DUPLICATE GUARD. MZ refuses to play a sound whose name is
      already in _seBuffers with buffer.frameCount === Graphics.frameCount, and
      it returns EARLY — no buffer, no sound, no entry. MV has nothing of the
      kind (rpg_managers.js:1364): ten calls in one frame make ten buffers and
      ten overlapping plays. Anything that fires SE in a loop behaves
      differently on the two engines with identical code, and on MZ the guard
      is keyed on Graphics.frameCount — which the mod's own speed and pause
      hooks move. Freeze the frame counter and MZ plays each sound ONCE, ever.
   2. THE CLEANUP CALL. MZ pushes the new buffer and then calls cleanupSe,
      which DESTROYS the finished ones. MV filters at the top of playSe and
      never frees anything.

   The engine uses Array.prototype.find for the duplicate test; the ES5 filter
   below asks the same question. */
AudioManager.playSe = function (se) {
  if (se.name) {
    // [Note] Do not play the same sound in the same frame.
    var latestBuffers = this._seBuffers.filter(function (buffer) {
      return buffer.frameCount === Graphics.frameCount;
    });
    var sameName = latestBuffers.filter(function (buffer) {
      return buffer.name === se.name;
    });
    if (sameName.length > 0) {
      return;
    }
    var buffer = this.createBuffer('se/', se.name);
    this.updateSeParameters(buffer, se);
    buffer.play(false);
    this._seBuffers.push(buffer);
    this.cleanupSe();
  }
};

/* rmmz_managers.js:1362 — MZ-ONLY. No MV equivalent exists, so a panel that
   wants "drop the finished SE" has to do it by hand on MV — and the MV
   equivalent is NOT this body, because MV buffers must be stop()ed, not
   destroy()ed, and MV's isPlaying goes false on its own where MZ's does not.

   Note the loop destroys and the filter then re-reads isPlaying(): destroy()
   runs clear() which runs stop() which sets _isPlaying false, so a buffer
   destroyed in the first pass is also dropped by the second. The order is
   load-bearing; reversing it would destroy nothing. */
AudioManager.cleanupSe = function () {
  for (var i = 0; i < this._seBuffers.length; i++) {
    if (!this._seBuffers[i].isPlaying()) {
      this._seBuffers[i].destroy();
    }
  }
  this._seBuffers = this._seBuffers.filter(function (buffer) {
    return buffer.isPlaying();
  });
};

/* rmmz_managers.js:1371 — destroy(), where MV uses stop() and forEach
   (rpg_managers.js:1380). */
AudioManager.stopSe = function () {
  for (var i = 0; i < this._seBuffers.length; i++) {
    this._seBuffers[i].destroy();
  }
  this._seBuffers = [];
};

/* rmmz_managers.js:1378 / :1392 / :1399 — keyed on buffer.name, which MZ's
   createBuffer assigns. MV keys on buffer._reservedSeName, a field it attaches
   inside loadStaticSe (rpg_managers.js:1402), and MV's loadStaticSe
   additionally pushes the url into Html5Audio. Same cache, two different keys
   and two different populate paths. Neither engine ever empties
   _staticBuffers. */
AudioManager.playStaticSe = function (se) {
  if (se.name) {
    this.loadStaticSe(se);
    for (var i = 0; i < this._staticBuffers.length; i++) {
      var buffer = this._staticBuffers[i];
      if (buffer.name === se.name) {
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
    var buffer = this.createBuffer('se/', se.name);
    this._staticBuffers.push(buffer);
  }
};
AudioManager.isStaticSe = function (se) {
  for (var i = 0; i < this._staticBuffers.length; i++) {
    var buffer = this._staticBuffers[i];
    if (buffer.name === se.name) {
      return true;
    }
  }
  return false;
};

/* rmmz_managers.js:1449 — three differences from MV (rpg_managers.js:1464):
   the folder arrives WITH its slash, the name goes through Utils.encodeURI
   (which preserves '/', so subfolders work), and the buffer is TAGGED with
   `name` and `frameCount`. Those two tags are what playSe's duplicate guard
   and playStaticSe's lookup read — MV sets neither, and stamps
   _reservedSeName instead, later, only for static SE.
   MZ always returns a fresh WebAudio; MV can return the Html5Audio singleton. */
AudioManager.createBuffer = function (folder, name) {
  var ext = this.audioFileExt();
  /* folder carries its own trailing slash and Utils.encodeURI leaves '/'
     alone, so nothing here inserts or escapes a separator. */
  var base = this._path + folder + Utils.encodeURI(name);
  var buffer = new WebAudio(base + ext);
  /* The two tags MV never sets: playSe's duplicate guard reads frameCount,
     playStaticSe's lookup reads name. */
  buffer.name = name;
  buffer.frameCount = Graphics.frameCount;
  return buffer;
};

/* rmmz_managers.js:1466 — a CONSTANT. MV chooses between .ogg and .m4a based
   on WebAudio.canPlayOgg() and Utils.isMobileDevice() (rpg_managers.js:1484).
   MZ dropped m4a entirely and falls back to a software Vorbis decoder instead,
   so an MZ project ships one audio file per sound and an MV project ships two. */
AudioManager.audioFileExt = function () {
  return '.ogg';
};

/* rmmz_managers.js:1470 / :1481 — MZ collects every buffer into one array
   (spread in the engine, concat here) and throws an ARRAY
   ["LoadError", url, retry] carrying a bound retry function. MV throws a real
   Error with a message string and no way back (rpg_managers.js:1498 / :1510).
   SceneManager.catchLoadError destructures the array; a catch block written
   for MV's Error reads `.message` off an Array and gets undefined. */
AudioManager.checkErrors = function () {
  var buffers = [this._bgmBuffer, this._bgsBuffer, this._meBuffer];
  buffers = buffers.concat(this._seBuffers);
  buffers = buffers.concat(this._staticBuffers);
  for (var i = 0; i < buffers.length; i++) {
    var buffer = buffers[i];
    if (buffer && buffer.isError()) {
      this.throwLoadError(buffer);
    }
  }
};
AudioManager.throwLoadError = function (webAudio) {
  var retry = webAudio.retry.bind(webAudio);
  throw ['LoadError', webAudio.url, retry];
};

/* -------------------------------------------------------------------------
   SceneManager.initAudio (rmmz_managers.js:1962, called from initialize at
   :1930) is what runs WebAudio.initialize() in a real boot, and the harness's
   __engineBoot does not model initAudio. x-audio-mv.js ends with the same
   line for the same reason.

   The engine difference this does NOT paper over, and which matters more here
   than on MV: MZ's WebAudio does not self-initialise. Nothing in the class
   calls WebAudio.initialize() lazily, so a buffer constructed before initAudio
   has a null _context, never loads, never errors, and reports isReady() false
   forever with no diagnostic anywhere. MV's constructor covers that case
   itself (rpg_core.js:7678). MZ's initialize is also NOT idempotent — calling
   it twice throws away a live context and every node hanging off it.
   ---------------------------------------------------------------------- */
WebAudio.initialize();
