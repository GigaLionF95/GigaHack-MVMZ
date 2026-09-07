//=============================================================================
// GigaHack MV/MZ
// 28 · media.js — the audio the game ships, its image folders, and screenshots
//-----------------------------------------------------------------------------
// A NAME IS NOT A FILE. Everything in this module exists because the engine
// stores a NAME and builds a URL from it later, and the two builds do not
// build the same URL. One escapes the path separator when it encodes the name
// and the other preserves it, so a track that lives in a subfolder is playable
// on one build and simply not found on the other — with no error either way,
// because a missing audio file is silent until something asks. The encoder is
// therefore PROBED for its behaviour ('a/b' in, 'a/b' out?) and never inferred
// from a version, and a row that cannot resolve says so in the row.
//
// A BAD NAME IS NOT A SILENT FAILURE EVERYWHERE. On some builds the running
// scene calls AudioManager.checkErrors() every frame, and that function THROWS
// for any buffer reporting an error — so auditioning a name with nothing
// behind it drops the game onto the engine's own load-error screen on the very
// next frame. Other builds define the same function and never call it, so the
// identical mistake is invisible. Two defences, both needed: the file is
// verified before the engine is asked, and the error check is wrapped to sweep
// ONLY the buffers this module started, by identity, within a bounded number of
// frames of the audition that created them. A game-side load failure still
// throws exactly as it did — hiding a real one would be worse than the bug.
//
// THE IMAGE SIDE HAS THE SAME SHAPE AND IS WORSE. On some builds
// ImageManager.isReady() throws for any errored bitmap still in the cache, the
// scene's own readiness test calls it, and the errored bitmap stays cached — so
// ONE failed preview permanently breaks every later scene transition. A failed
// sheet is evicted BY IDENTITY, walking whichever cache shape this build has,
// because the two builds spell the cache key differently and rebuilding the key
// is how an eviction misses.
//
// ASK THE ENGINE WHAT A SHEET IS. The '$' and '!' filename conventions are a
// leading sign RUN, not a first character: a real shipped sheet is named
// '!$Gate1', which is both flat-anchored and single-character, and every
// implementation that tests charAt(0) gets one of the two wrong. The engine
// already has the predicate; this module calls it, shows what the ENGINE
// concluded, and where the predicate is absent says the layout below is a guess
// rather than presenting it as a fact.
//
// NOTHING HERE HOLDS A BITMAP. An aggressive image-cache plugin pulls a held
// bitmap out from under a mod on a map change and nothing reserves it, so the
// preview holds the data URL and re-requests the sheet on demand.
//
// A BURST THAT KEEPS ITS SHOTS IS THE UNBOUNDED-MEMORY FAILURE. One full-screen
// bitmap is alive at a time, bytes are converted, written and released, and
// where there is nowhere to write a burst is REFUSED rather than buffered.
//
// THE OVERLAY IS NOT IN THE SHOT. The menu is a DOM sibling of the game canvas
// and the engine's snapshot renders the display tree only, so "hide the overlay
// for the screenshot" is exclusively about what GigaHack draws INSIDE the scene.
// Those register themselves through $.media.capture.exclude(); until one does,
// the panel says the shot contains no mod drawing and why, instead of claiming
// to have hidden something.
//
// THERE IS NO PANEL-LEAVE CALLBACK. Rendering a tab simply clears the host's
// per-frame hooks, so putting the game's music back when you leave is a
// watchdog: the panel stamps a heartbeat while it is on screen and a permanent
// per-frame hook restores once that stamp goes stale. One mechanism covers a
// tab change, a sub-tab change and closing the overlay alike.
//
// FIVE CAPABILITIES ARE PROBED HERE THAT BELONG IN THE CAPABILITY TABLE. A
// feature module must not grow $.caps or $.eng, so they are computed locally,
// named in Debug → Environment terms in the panels, and listed in the handoff
// for the integrator to move: a master volume that exists on one build only, an
// encoder that preserves the separator, the presence of a scene snapshot, the
// presence of the audio error check, and whether a bitmap can be destroyed.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — the audio the game ships, its image folders, and screenshots
 * @author gigahack
 * @help GigaHack_Media.js — requires Core, Caps, Store, Profile, UI, Shell,
 * Hooks, Tabs, Compat, Index
 */

(function ($) {
    'use strict';
    if (!$ || !$.ui || !$.ui.panel) {
        console.error('[GigaHack] shell missing — media not installed');
        return;
    }

    var U = $.ui, W = U.w;
    var h = U.h, cols = U.cols;
    var M = $.media = {};

    /* =====================================================================
       SETTINGS

       Nothing here is in the store's own defaults — this module owns these
       keys and reads them with a local helper that supplies the default when
       the key is absent, so a settings file written before this module
       existed behaves exactly like one written after it.
       ===================================================================== */
    function all() { return $.cfg.media || {}; }
    function grp(name) {
        var g = all()[name];
        return (g && typeof g === 'object') ? g : {};
    }
    function sBool(group, key, dflt) {
        var v = grp(group)[key];
        return typeof v === 'boolean' ? v : dflt;
    }
    function sNum(group, key, dflt, lo, hi) {
        var v = grp(group)[key];
        if (typeof v !== 'number' || v !== v) return dflt;
        return v < lo ? lo : (v > hi ? hi : v);
    }
    function sStr(group, key, dflt, allowed) {
        var v = grp(group)[key];
        if (typeof v !== 'string') return dflt;
        if (allowed && allowed.indexOf(v) < 0) return dflt;
        return v;
    }
    function put(dotted, value) { return $.store.cfgSet('media.' + dotted, value); }

    /* =====================================================================
       PART 0 — THE ENGINE SURFACE

       Five capability probes and six adapters. Every one is a BEHAVIOUR test
       or a feature test; not one of them asks what version this is. They
       belong in the capability table and are computed here only because a
       feature module may not grow it — the handoff names each one.
       ===================================================================== */

    /* Asked at the moment they are needed, never cached at load.
       A capability read once at boot is a version string wearing a better
       name: a plugin that loads after this file, or one that swaps a manager
       method at run time, changes every one of these answers, and the panel
       that cached the boot answer is then confidently wrong.

       The separator probe is the important one. What matters is not which
       engine is running but whether the name survives the encoder the engine
       will actually use, because that is what decides whether a track inside a
       subfolder can be requested by name at all — so it is a test of the
       encoder's output, not of its presence. */
    var CAP = {
        masterVolume: function () {
            return typeof AudioManager !== 'undefined' && AudioManager.masterVolume !== undefined;
        },
        subfolders: function () {
            return $.safe(function () {
                return typeof Utils !== 'undefined' && typeof Utils.encodeURI === 'function' &&
                    Utils.encodeURI('a/b') === 'a/b';
            }, 'media cap subfolders', false);
        },
        sceneSnap: function () {
            return typeof SceneManager !== 'undefined' && typeof SceneManager.snap === 'function';
        },
        audioErrorCheck: function () {
            return typeof AudioManager !== 'undefined' && typeof AudioManager.checkErrors === 'function';
        },
        bitmapDestroy: function () {
            return typeof Bitmap !== 'undefined' && !!Bitmap.prototype &&
                typeof Bitmap.prototype.destroy === 'function';
        },
        bigCharacterTest: function () {
            return typeof ImageManager !== 'undefined' &&
                typeof ImageManager.isBigCharacter === 'function';
        }
    };
    M.caps = function () {
        return {
            audioMasterVolume: CAP.masterVolume(),
            assetSubfolders: CAP.subfolders(),
            sceneSnap: CAP.sceneSnap(),
            audioErrorCheck: CAP.audioErrorCheck(),
            bitmapDestroy: CAP.bitmapDestroy(),
            bigCharacterTest: CAP.bigCharacterTest()
        };
    };

    /** The extension the engine will append. Asked, never assumed. */
    function audioExt() {
        return $.safe(function () {
            if (typeof AudioManager !== 'undefined' && typeof AudioManager.audioFileExt === 'function') {
                return AudioManager.audioFileExt();
            }
            return '.ogg';
        }, 'media audioExt', '.ogg');
    }

    /** The exact string the engine will put in the url for this name. */
    function encodeName(name) {
        return $.safe(function () {
            if (typeof Utils !== 'undefined' && typeof Utils.encodeURI === 'function') {
                return Utils.encodeURI(String(name));
            }
            return encodeURIComponent(String(name));
        }, 'media encodeName', String(name));
    }

    /* Three different builds answer "is this deploy encrypted" through three
       different objects, and a project that says yes in its data may still be
       running unencrypted until boot copies the flag across. Ask each in turn
       and fall back to what the database declares. */
    function encFlag(which) {
        return $.safe(function () {
            var m = which === 'audio' ? 'hasEncryptedAudio' : 'hasEncryptedImages';
            if (typeof Utils !== 'undefined' && typeof Utils[m] === 'function') return !!Utils[m]();
            if (typeof Decrypter !== 'undefined' && Decrypter && Decrypter[m] !== undefined) return !!Decrypter[m];
            if (typeof $dataSystem !== 'undefined' && $dataSystem) return !!$dataSystem[m];
            return false;
        }, 'media encrypted ' + which, false);
    }

    /* Written exactly like the icon-size adapter it sits beside in spirit: one
       manager property, then one window constant, then the stock number. */
    function faceWidth() {
        return $.safe(function () {
            if (typeof ImageManager !== 'undefined' && ImageManager.faceWidth) return ImageManager.faceWidth;
            if (typeof Window_Base !== 'undefined' && Window_Base._faceWidth) return Window_Base._faceWidth;
            return 144;
        }, 'media faceWidth', 144);
    }
    function faceHeight() {
        return $.safe(function () {
            if (typeof ImageManager !== 'undefined' && ImageManager.faceHeight) return ImageManager.faceHeight;
            if (typeof Window_Base !== 'undefined' && Window_Base._faceHeight) return Window_Base._faceHeight;
            return 144;
        }, 'media faceHeight', 144);
    }

    /** The engine's own screenshot. Never the DOM — see the header. */
    function snapBitmap() {
        return $.safe(function () {
            if (typeof SceneManager !== 'undefined' && typeof SceneManager.snap === 'function') {
                return SceneManager.snap();
            }
            if (typeof Bitmap !== 'undefined' && typeof Bitmap.snap === 'function') {
                return Bitmap.snap(SceneManager && SceneManager._scene);
            }
            return null;
        }, 'media snap', null);
    }

    /** True when the engine had a destroy and it ran. False is not an error. */
    function destroyBitmap(bmp) {
        if (!bmp || !CAP.bitmapDestroy()) return false;
        return $.safe(function () { bmp.destroy(); return true; }, 'media destroy bitmap', false);
    }

    function frameNow() {
        return (typeof Graphics !== 'undefined' && Graphics.frameCount) || 0;
    }

    /* A canvas of zero width answers toDataURL with the six characters
       "data:," rather than raising, so a size check that only asked "did I get
       a string back" writes an empty file and calls it a screenshot. Anything
       shorter than a PNG header is not an image. */
    function usableDataUrl(u) {
        return typeof u === 'string' && u.indexOf('data:image/') === 0 && u.length > 64;
    }

    /**
     * The pixels of a bitmap, or null.
     *
     * A bitmap's canvas is lazy on both builds and one of them will happily
     * build a placeholder-sized one for a bitmap that has no image behind it —
     * so the canvas is only trusted when it is the size the bitmap claims to
     * be. Without that test a one-pixel canvas is exported as a screenshot,
     * the file is written, its size looks plausible and the image is not there.
     */
    function bitmapPixels(bmp, w, hh) {
        if (!bmp || !w || !hh) return null;
        var url = $.safe(function () {
            var cv = bmp.canvas;
            if (!cv || !cv.toDataURL) return null;
            if (cv.width !== w || cv.height !== hh) return null;
            return cv.toDataURL('image/png');
        }, 'media read pixels', null);
        return usableDataUrl(url) ? url : null;
    }

    /* =====================================================================
       PART 1 — AUDIO
       ===================================================================== */

    var A = M.audio = {};

    var AUDIO_DIRS = ['audio/bgm', 'audio/bgs', 'audio/me', 'audio/se'];
    var DATABASE_SOURCE = 'what the database names';
    var KIND_OF = { 'audio/bgm': 'bgm', 'audio/bgs': 'bgs', 'audio/me': 'me', 'audio/se': 'se' };

    /* An encrypted deploy renames the file and keeps the stem, so the stem is
       what a name search has to compare. The list is the one the boot index
       already strips by, kept in step deliberately: two different strip lists
       would make the two counts disagree for a reason that is not the one the
       panel explains. */
    var AUDIO_EXTS = /\.(ogg_|m4a_|rpgmvo|rpgmvm|ogg|m4a)$/i;
    var IMAGE_EXTS = /\.(png_|rpgmvp|png)$/i;

    var RING = [];                 // newest first
    var DEDUPE_FRAMES = 4;
    var auditioning = 0;           // > 0 only inside our own play() call
    var started = [];              // buffers this module created, by identity
    var STARTED_FRAMES = 300;      // how long a buffer stays ours to sweep
    var failures = [];             // auditions the sweep caught, newest first
    var savedState = null;         // what the game was playing before we touched it
    var armed = false;             // the panel has been on screen since the audition
    var heartbeat = 0;
    var STALE_FRAMES = 8;

    /* Read once and refreshed on a settings change rather than per call: the
       SE recorder runs several times a second and must not walk $.cfg. */
    var logSe = true, ringCap = 200, restoreOnLeave = true;
    function refreshAudioCfg() {
        logSe = sBool('audio', 'logSe', true);
        ringCap = sNum('audio', 'recent', 200, 20, 2000);
        restoreOnLeave = sBool('audio', 'restoreOnLeave', true);
        if (RING.length > ringCap) RING.length = ringCap;
    }
    refreshAudioCfg();
    $.on('cfg', refreshAudioCfg);

    /**
     * One row in the ring.
     *
     * Recorded AFTER the original, so what is recorded is what the engine
     * actually accepted: a repeat of the track already playing short-circuits
     * inside the manager, and which side of that branch the "current" record
     * is updated on differs between the builds.
     *
     * The dedupe path allocates nothing. A single attack animation fires the
     * same effect three times in three frames and three identical rows are
     * noise, not information.
     */
    function record(kind, name, obj) {
        var f = frameNow();
        var src = auditioning > 0 ? 'audition' : 'game';
        var top = RING[0];
        if (top && top.kind === kind && top.name === name && top.source === src &&
            (f - top.frame) <= DEDUPE_FRAMES) {
            top.count++;
            top.frame = f;
            top.at = Date.now();
            return top;
        }
        RING.unshift({
            kind: kind, name: name, frame: f, at: Date.now(), source: src, count: 1,
            volume: obj && obj.volume, pitch: obj && obj.pitch, pan: obj && obj.pan
        });
        if (RING.length > ringCap) RING.length = ringCap;
        return RING[0];
    }

    /* ------------------------------------------------------ what is playing */

    function bufferName(buf) {
        /* One build stamps the name onto the buffer it creates and the other
           does not, so this is feature-detected off the buffer rather than off
           the engine — a plugin that replaces the buffer factory changes the
           answer on either build. */
        if (!buf) return null;
        return (typeof buf.name === 'string' && buf.name) ? buf.name : null;
    }

    function seekOf(buf) {
        if (!buf || typeof buf.seek !== 'function') return null;
        return $.safe(function () { return buf.seek(); }, 'media seek', null);
    }

    A.now = function () {
        return $.safe(function () {
            if (typeof AudioManager === 'undefined') return null;
            var bgm = AudioManager._currentBgm, bgs = AudioManager._currentBgs;
            var me = AudioManager._meBuffer;
            return {
                bgm: (bgm && bgm.name) ? { name: bgm.name, pos: seekOf(AudioManager._bgmBuffer) } : null,
                bgs: (bgs && bgs.name) ? { name: bgs.name, pos: seekOf(AudioManager._bgsBuffer) } : null,
                me: me ? { name: bufferName(me) } : null,
                seVoices: (AudioManager._seBuffers || []).length,
                staticBuffers: (AudioManager._staticBuffers || []).length
            };
        }, 'media now', null);
    };

    A.recent = function (n) {
        return n ? RING.slice(0, n) : RING.slice();
    };
    A.recentCount = function () { return RING.length; };
    A.clearRecent = function () { var n = RING.length; RING.length = 0; return n; };
    A.failures = function () { return failures.slice(); };
    A.clearFailures = function () { var n = failures.length; failures.length = 0; return n; };

    /* ------------------------------------------------------------ the files */

    function gameRoot() {
        return $.safe(function () {
            var fs = $.env.fs, path = $.env.path, base = $.paths.gameRoot;
            if (!fs || !path || !base) return null;
            /* A www/ deploy keeps the media under www/, and the boot index
               already resolves it the same way; doing it differently here is
               how two counts of the same folder end up disagreeing. */
            if (!fs.existsSync(path.join(base, 'img')) && fs.existsSync(path.join(base, 'www', 'img'))) {
                return path.join(base, 'www');
            }
            return base;
        }, 'media game root', null);
    }

    var WALK_CAP = 4000;

    /**
     * Media's own bounded folder walk.
     *
     * The boot index reads ONE level of each folder and strips the extension,
     * so on a project that organises its media into subfolders the index's
     * list contains DIRECTORY names that look exactly like tracks and misses
     * every real track inside them. This walk marks a directory as a directory
     * and descends exactly one level, which is why the two counts differ and
     * why the panel says which number is which.
     */
    function walkFolder(rel, recursive) {
        return $.safe(function () {
            var fs = $.env.fs, path = $.env.path, base = gameRoot();
            if (!fs || !path || !base) return null;
            var dir = path.join(base, rel.split('/').join(path.sep));
            if (!fs.existsSync(dir)) return { rows: [], complete: true, why: '' };
            var rows = [], seen = {}, truncated = false;
            var names = fs.readdirSync(dir);
            var i, j;
            for (i = 0; i < names.length; i++) {
                if (rows.length >= WALK_CAP) { truncated = true; break; }
                var n = names[i];
                if (n.charAt(0) === '.') continue;
                var full = path.join(dir, n);
                var isDir = $.safe(function () { return fs.statSync(full).isDirectory(); }, 'media stat', false);
                if (isDir) {
                    rows.push({ name: n, dir: true, sub: '', source: 'folder' });
                    if (!recursive) continue;
                    var inner = $.safe(function () { return fs.readdirSync(full); }, 'media readdir', []) || [];
                    for (j = 0; j < inner.length; j++) {
                        if (rows.length >= WALK_CAP) { truncated = true; break; }
                        if (inner[j].charAt(0) === '.') continue;
                        var innerFull = path.join(full, inner[j]);
                        var innerIsDir = $.safe(function () {
                            return fs.statSync(innerFull).isDirectory();
                        }, 'media stat', false);
                        if (innerIsDir) continue;   // exactly one level, and it is stated
                        var st = stem(inner[j], rel);
                        if (!st) continue;
                        var key = n + '/' + st;
                        if (seen[key]) continue;
                        seen[key] = 1;
                        rows.push({ name: key, dir: false, sub: n, source: 'folder' });
                    }
                    continue;
                }
                var s = stem(n, rel);
                if (!s || seen[s]) continue;
                seen[s] = 1;
                rows.push({ name: s, dir: false, sub: '', source: 'folder' });
            }
            return {
                rows: rows, complete: !truncated,
                why: truncated ? 'this folder holds more than ' + WALK_CAP + ' entries; the rest are not listed.' : ''
            };
        }, 'media walk ' + rel, null);
    }

    function stem(fileName, rel) {
        var re = rel.indexOf('audio/') === 0 ? AUDIO_EXTS : IMAGE_EXTS;
        if (!re.test(fileName)) return '';
        return fileName.replace(re, '');
    }

    /** Whether a real file stands behind this name, and which path was tried. */
    function verify(rel, name) {
        var out = { known: false, ok: false, path: '', why: '' };
        var fs = $.env.fs, path = $.env.path, base = gameRoot();
        if (!fs || !path || !base) {
            out.why = 'no filesystem here — ' + ($.caps.fsWhy || 'this build exposes no Node APIs') +
                ' Nothing on disk can be checked before the engine is asked.';
            return out;
        }
        out.known = true;
        var ext = rel.indexOf('audio/') === 0 ? audioExt() : '.png';
        var parts = String(name).split('/');
        var target = path.join(base, rel.split('/').join(path.sep));
        for (var i = 0; i < parts.length; i++) target = path.join(target, parts[i]);
        out.path = target + ext;
        var candidates = [out.path, target + ext + '_'];
        /* An encrypted deploy renames rather than moves, and the renaming is
           spelled differently on the two builds. Both spellings are tried and
           the path reported is the plain one, because that is the name the
           project actually carries. */
        candidates.push(target + '.rpgmvo', target + '.rpgmvm', target + '.rpgmvp');
        for (var c = 0; c < candidates.length; c++) {
            if ($.safe(function () { return fs.existsSync(candidates[c]); }, 'media exists', false)) {
                out.ok = true;
                return out;
            }
        }
        out.why = 'no file at ' + out.path;
        return out;
    }
    A.verify = verify;

    /**
     * Every name this folder can offer, and for each one why it is or is not
     * playable. Candidates only: the row is resolved against the engine at the
     * moment it is asked to play, never here.
     */
    A.list = function (folder) {
        return $.safe(function () {
            if (folder === DATABASE_SOURCE) {
                var db = A.databaseNames();
                return {
                    rows: db.map(function (r) {
                        return decorate({ name: r.name, dir: false, sub: '', source: 'database', where: r.where }, r.folder);
                    }),
                    complete: true, source: 'database',
                    why: 'these are the names the project\'s own data files carry, not a folder listing.'
                };
            }
            var rel = AUDIO_DIRS.indexOf(folder) > -1 ? folder : AUDIO_DIRS[0];
            var walked = walkFolder(rel, sBool('audio', 'subfolders', true));
            if (walked) {
                return {
                    rows: walked.rows.map(function (r) { return decorate(r, rel); }),
                    complete: walked.complete, source: 'folder', why: walked.why
                };
            }
            /* No filesystem. The boot index cannot have listed the folder
               either — it needs the same filesystem — so the only list left is
               the one the database carries, and the panel is told to say so. */
            var idx = indexRows(rel);
            if (idx) {
                return {
                    rows: idx.map(function (r) { return decorate(r, rel); }),
                    complete: false, source: 'index',
                    why: 'from the boot index, which reads one level and strips extensions — ' +
                        'it cannot tell a folder from a track.'
                };
            }
            var names = A.databaseNames().filter(function (r) { return r.folder === rel; });
            return {
                rows: names.map(function (r) {
                    return decorate({ name: r.name, dir: false, sub: '', source: 'database', where: r.where }, rel);
                }),
                complete: false, source: 'database',
                why: 'no folder listing here — ' + ($.caps.fsWhy || 'no filesystem') +
                    ' — showing what the database names instead.'
            };
        }, 'media audio list', { rows: [], complete: false, source: 'none', why: 'the folder could not be read.' });
    };

    function indexRows(rel) {
        return $.safe(function () {
            if (!$.index || !$.index.findAsset) return null;
            var r = $.index.findAsset('', 4000);
            if (!r || !r.candidates || !r.candidates.length) return null;
            var out = [];
            r.candidates.forEach(function (c) {
                if (c.folder !== rel) return;
                out.push({ name: c.name, dir: false, sub: '', source: 'index' });
            });
            return out.length ? out : null;
        }, 'media index rows', null);
    }

    /** A row carries its own reason for not being playable. */
    function decorate(row, rel) {
        row.folder = rel;
        row.kind = KIND_OF[rel] || 'bgm';
        if (row.dir) {
            row.playable = false;
            row.why = 'a folder, not a track';
            return row;
        }
        if (String(row.name).indexOf('/') > -1 && !CAP.subfolders()) {
            row.playable = false;
            row.why = 'this build escapes the separator when it builds the url, so a track ' +
                'inside a subfolder cannot be requested by name here';
            return row;
        }
        if (row.source === 'folder') { row.playable = true; row.why = ''; return row; }
        var v = verify(rel, row.name);
        if (v.known && !v.ok) {
            row.playable = false;
            row.why = v.why + ' — the name came from ' +
                (row.source === 'index' ? 'the boot index, which strips extensions and cannot tell a folder from a track'
                    : 'the project\'s data, not from the folder');
            return row;
        }
        if (!v.known && !CAP.audioErrorCheck()) {
            row.playable = false;
            row.why = 'nothing can verify this name here and this build has no audio error check, ' +
                'so a name with no file behind it could not be caught';
            return row;
        }
        row.playable = true;
        row.why = '';
        return row;
    }

    /* ---------------------------------------------------------- auditioning */

    function audioObject(name) {
        return { name: String(name), volume: 90, pitch: 100, pan: 0 };
    }

    /**
     * What the manager says is playing for one kind, as a name.
     *
     * '' is nothing. '?' is "a buffer is playing and this build will not say
     * what it is" — some builds stamp the name onto the buffer they create and
     * some do not, and that is feature-detected off the buffer rather than off
     * the engine. The comparator below treats '?' as agreement for a start and
     * as disagreement for a stop, which is the only reading of it that is true
     * in both directions.
     */
    function playingName(kind) {
        return $.safe(function () {
            if (kind === 'bgm') return (AudioManager._currentBgm && AudioManager._currentBgm.name) || '';
            if (kind === 'bgs') return (AudioManager._currentBgs && AudioManager._currentBgs.name) || '';
            var list = AudioManager._seBuffers || [];
            var buf = kind === 'me' ? AudioManager._meBuffer : list[list.length - 1];
            if (!buf) return '';
            var n = bufferName(buf);
            return n === null ? '?' : n;
        }, 'media playing name', '');
    }
    function nameAgrees(got, want) {
        if (got === want) return true;
        return want !== '' && got === '?';
    }
    function playbackState() {
        return ['bgm', 'bgs', 'me', 'se'].map(playingName).join('|');
    }

    function saveIfFirst() {
        if (savedState) return;
        savedState = $.safe(function () {
            return {
                bgm: AudioManager.saveBgm ? AudioManager.saveBgm() : null,
                bgs: AudioManager.saveBgs ? AudioManager.saveBgs() : null,
                at: frameNow()
            };
        }, 'media save audio', null);
    }

    function trackBuffer(kind) {
        $.safe(function () {
            var buf = null;
            if (kind === 'bgm') buf = AudioManager._bgmBuffer;
            else if (kind === 'bgs') buf = AudioManager._bgsBuffer;
            else if (kind === 'me') buf = AudioManager._meBuffer;
            else {
                var list = AudioManager._seBuffers || [];
                buf = list.length ? list[list.length - 1] : null;
            }
            if (buf) started.push({ buffer: buf, kind: kind, at: $.frameCount || 0 });
        }, 'media track buffer');
    }

    /**
     * Audition one name.
     *
     * Refuses before the engine is asked where the file can be shown not to
     * exist, because on some builds asking is what breaks the game. Stops the
     * effect queue before any effect: one build refuses a second play of the
     * same name in the same frame, and while the game is held every audition
     * IS the same frame — so without the stop the second press does nothing
     * for a reason nobody could see.
     */
    A.play = function (kind, name, opts) {
        opts = opts || {};
        if (typeof AudioManager === 'undefined') {
            return { ok: false, why: 'this build has no audio manager to ask.' };
        }
        if (!name) return { ok: false, why: 'no name given.' };
        var rel = 'audio/' + kind;
        var v = verify(rel, name);
        if (v.known && !v.ok) {
            return { ok: false, why: v.why + ' — nothing was played.' };
        }
        if (!v.known && !CAP.audioErrorCheck()) {
            return {
                ok: false,
                why: 'this name could not be verified (' + v.why + ') and this build has no ' +
                    'AudioManager.checkErrors to intercept a failed load, so it is refused ' +
                    'rather than risked.'
            };
        }
        if (!$.allowWrite('Auditioning "' + name + '"')) return { ok: false, why: 'read-only mode.' };

        var fn = kind === 'bgm' ? 'playBgm' : kind === 'bgs' ? 'playBgs' : kind === 'me' ? 'playMe' : 'playSe';
        if (typeof AudioManager[fn] !== 'function') {
            return { ok: false, why: 'AudioManager.' + fn + ' was not found on this build.' };
        }
        saveIfFirst();
        var obj = audioObject(name);
        /* Through $.compat.verify like every other mutating control: a plugin
           that intercepts playback to enforce its own music is exactly the
           thing this reports, and a play button that looks like it worked is
           worse than one that says the write did not stick. */
        var r = $.compat.verify('media.play', function () {
            if (kind === 'se' && typeof AudioManager.stopSe === 'function') AudioManager.stopSe();
            auditioning++;
            try {
                if (kind === 'bgm' || kind === 'bgs') AudioManager[fn](obj, opts.pos || 0);
                else AudioManager[fn](obj);
            } finally {
                auditioning--;
            }
            trackBuffer(kind);
        }, function () {
            return playingName(kind);
        }, String(name), nameAgrees);
        return { ok: r.ok, why: r.message };
    };

    A.stop = function (kind) {
        var fn = kind === 'bgm' ? 'stopBgm' : kind === 'bgs' ? 'stopBgs' : kind === 'me' ? 'stopMe' : 'stopSe';
        if (typeof AudioManager === 'undefined' || typeof AudioManager[fn] !== 'function') return false;
        if (!$.allowWrite('Stopping the ' + kind)) return false;
        var r = $.compat.verify('media.play', function () {
            AudioManager[fn]();
        }, function () {
            return playingName(kind);
        }, '', nameAgrees);
        return r.ok;
    };

    A.stopAll = function () {
        if (typeof AudioManager === 'undefined' || typeof AudioManager.stopAll !== 'function') return false;
        if (!$.allowWrite('Stopping every sound')) return false;
        var r = $.compat.verify('media.play', function () {
            AudioManager.stopAll();
        }, playbackState, '|||');
        return r.ok;
    };

    A.playDegraded = function () { return $.compat.isDegraded('media.play'); };
    A.playDegradedWhy = function () { return $.compat.degradedWhy('media.play'); };

    A.canStop = function (kind) {
        var fn = kind === 'bgm' ? 'stopBgm' : kind === 'bgs' ? 'stopBgs' : kind === 'me' ? 'stopMe' :
            kind === 'all' ? 'stopAll' : 'stopSe';
        return typeof AudioManager !== 'undefined' && typeof AudioManager[fn] === 'function';
    };
    A.stopWhy = function (kind) {
        var fn = kind === 'bgm' ? 'stopBgm' : kind === 'bgs' ? 'stopBgs' : kind === 'me' ? 'stopMe' :
            kind === 'all' ? 'stopAll' : 'stopSe';
        return 'AudioManager.' + fn + ' was not found on this build — nothing here can stop it; ' +
            'the game\'s own options are the only lever left.';
    };

    /* --------------------------------------------------------- the sweep */

    /**
     * Stop and forget any buffer THIS MODULE started that reports an error.
     *
     * Scoped by identity and by age. A buffer the game created is never
     * touched, so a genuine game-side load failure still reaches the engine's
     * own handler exactly as it did — which is the whole reason this is a
     * sweep of a recorded list rather than a catch around the error check.
     */
    function sweep() {
        if (typeof AudioManager === 'undefined') return 0;
        var caught = 0, now = $.frameCount || 0;
        for (var i = started.length - 1; i >= 0; i--) {
            var e = started[i];
            if (now - e.at > STARTED_FRAMES) { started.splice(i, 1); continue; }
            var b = e.buffer;
            if (!b || typeof b.isError !== 'function') continue;
            var bad = $.safe(function () { return b.isError(); }, 'media isError', false);
            if (!bad) continue;
            started.splice(i, 1);
            dropBuffer(e.kind, b);
            caught++;
            var url = (b && b.url) || '';
            failures.unshift({ kind: e.kind, url: url, at: Date.now(), frame: frameNow() });
            if (failures.length > 20) failures.length = 20;
            /* Once per failed buffer, never per frame: the buffer is removed
               from the list in the same pass, so this cannot repeat. */
            $.log('warn', 'the audition of ' + (url || 'a track') + ' failed to load; it was stopped ' +
                'before the engine\'s own error check ran.');
        }
        return caught;
    }
    A.sweep = sweep;

    /* The manager's own stop functions are the only supported way to release a
       buffer — one build stops it and the other destroys it, and destroy does
       not exist on both. The effect queue is the exception: its stop clears
       every voice including the game's, so exactly the one errored buffer is
       taken out of the list and stopped. */
    function dropBuffer(kind, b) {
        $.safe(function () {
            if (kind === 'bgm' && AudioManager._bgmBuffer === b) { AudioManager.stopBgm(); return; }
            if (kind === 'bgs' && AudioManager._bgsBuffer === b) { AudioManager.stopBgs(); return; }
            if (kind === 'me' && AudioManager._meBuffer === b) { AudioManager.stopMe(); return; }
            var list = AudioManager._seBuffers || [];
            var i = list.indexOf(b);
            if (i > -1) list.splice(i, 1);
            if (typeof b.stop === 'function') b.stop();
        }, 'media drop buffer');
    }

    /* ------------------------------------------------------- putting it back */

    A.saved = function () { return savedState ? { bgm: savedState.bgm, bgs: savedState.bgs } : null; };

    /**
     * Put back what the game was playing.
     *
     * The engine's replay compares only the NAME, so replaying the track that
     * is still playing from a different position silently does nothing but
     * re-apply the volume. Where the name matches and the position has moved,
     * it is stopped first — otherwise "put it back" leaves the music exactly
     * where the audition left it and looks like a broken button.
     *
     * A musical effect genuinely cannot be put back: the engine records no
     * saved one and no position for it anywhere.
     */
    A.restore = function () {
        if (!savedState) return null;
        var s = savedState;
        savedState = null;
        armed = false;
        var out = { bgm: false, bgs: false, me: 'cannot' };
        $.safe(function () {
            if (s.bgm) {
                if (s.bgm.name) {
                    var same = AudioManager.isCurrentBgm && AudioManager.isCurrentBgm(s.bgm);
                    var pos = seekOf(AudioManager._bgmBuffer);
                    if (same && pos !== null && Math.abs(pos - (s.bgm.pos || 0)) > 0.5) AudioManager.stopBgm();
                    AudioManager.replayBgm(s.bgm);
                } else if (AudioManager.stopBgm) {
                    AudioManager.stopBgm();
                }
                out.bgm = true;
            }
            if (s.bgs) {
                if (s.bgs.name) {
                    var sameB = AudioManager.isCurrentBgs && AudioManager.isCurrentBgs(s.bgs);
                    var posB = seekOf(AudioManager._bgsBuffer);
                    if (sameB && posB !== null && Math.abs(posB - (s.bgs.pos || 0)) > 0.5) AudioManager.stopBgs();
                    AudioManager.replayBgs(s.bgs);
                } else if (AudioManager.stopBgs) {
                    AudioManager.stopBgs();
                }
                out.bgs = true;
            }
        }, 'media restore');
        return out;
    };

    /** The panel's "I am still on screen" stamp. The watchdog reads it. */
    A.heartbeat = function () { heartbeat = $.frameCount || 0; armed = true; };

    /* There is no panel-leave callback in the shell, so this is the mechanism.
       It arms only once the panel has been on screen since the audition, which
       is what keeps an audition made from somewhere else (the console, another
       module) from being undone a second and a half later by a panel nobody
       opened. */
    $.onFrame('media restore watchdog', function () {
        if (!savedState || !armed || !restoreOnLeave) return;
        if (($.frameCount || 0) - heartbeat <= STALE_FRAMES) return;
        A.restore();
    });
    $.on('overlay', function (open) {
        if (!open && savedState && armed && restoreOnLeave) A.restore();
    });

    /* ------------------------------------------------------------ volumes */

    var VOL_KINDS = ['bgm', 'bgs', 'me', 'se'];

    A.volumeAvailable = function (kind) {
        return typeof ConfigManager !== 'undefined' && ConfigManager &&
            ConfigManager[kind + 'Volume'] !== undefined;
    };
    A.volumeWhy = function (kind) {
        return 'this build\'s ConfigManager has no ' + kind + 'Volume — the options object has been ' +
            'replaced; use the game\'s own options menu.';
    };

    /* Read live off ConfigManager, never from a copy: the whole point of
       writing through the game's own config is that the two agree, and a
       cached number would make the mod disagree with the options menu the
       moment anything else moved a volume. */
    A.volumes = function () {
        return $.safe(function () {
            var out = { master: null };
            VOL_KINDS.forEach(function (k) {
                out[k] = A.volumeAvailable(k) ? ConfigManager[k + 'Volume'] : null;
            });
            if (CAP.masterVolume()) out.master = AudioManager.masterVolume;
            return out;
        }, 'media volumes', { bgm: null, bgs: null, me: null, se: null, master: null });
    };

    /**
     * commit false is audible-only — the setter forwards to the audio manager,
     * which is why a drag is heard on every move. commit true is the file
     * write, and it happens once, on release.
     */
    A.setVolume = function (kind, value, commit) {
        if (!A.volumeAvailable(kind)) return { ok: false, why: A.volumeWhy(kind) };
        if (!$.allowWrite('The ' + kind + ' volume')) return { ok: false, why: 'read-only mode.' };
        var v = Math.round(value);
        if (!commit) {
            $.safe(function () { ConfigManager[kind + 'Volume'] = v; }, 'media volume ' + kind);
            return { ok: true, why: '' };
        }
        var r = $.compat.verify('media.volume', function () {
            ConfigManager[kind + 'Volume'] = v;
            if (ConfigManager.save) {
                var p = ConfigManager.save();
                if (p && typeof p.then === 'function') {
                    p.then(null, function (e) {
                        $.log('warn', 'the ' + kind + ' volume was changed but the config file could ' +
                            'not be written — ' + ((e && e.message) || e));
                    });
                }
            }
        }, function () {
            return ConfigManager[kind + 'Volume'];
        }, v);
        return { ok: r.ok, why: r.message };
    };

    A.masterAvailable = function () { return CAP.masterVolume(); };
    A.setMaster = function (value) {
        if (!CAP.masterVolume()) return { ok: false, why: 'this build has no master volume.' };
        if (!$.allowWrite('The master volume')) return { ok: false, why: 'read-only mode.' };
        var v = Math.round(value) / 100;
        var r = $.compat.verify('media.master', function () {
            AudioManager.masterVolume = v;
        }, function () {
            return AudioManager.masterVolume;
        }, v, function (a, b) { return Math.abs(a - b) < 0.005; });
        return { ok: r.ok, why: r.message };
    };

    A.ext = audioExt;
    A.encrypted = function () { return encFlag('audio'); };
    A.url = function (kind, name) {
        var base = $.safe(function () { return AudioManager._path || 'audio/'; }, 'media audio path', 'audio/');
        return base + kind + '/' + encodeName(name) + audioExt();
    };

    /**
     * Every audio name the project's own data carries.
     *
     * This is the only list that exists at all where there is no filesystem,
     * and it is a different list from a folder listing in both directions: it
     * names tracks the folder may not have and misses every track the project
     * never referenced.
     */
    A.databaseNames = function () {
        return $.safe(function () {
            var out = [];
            function push(rec, folder, where) {
                if (!rec || !rec.name) return;
                out.push({ name: rec.name, folder: folder, where: where, kind: KIND_OF[folder] });
            }
            var S = typeof $dataSystem !== 'undefined' ? $dataSystem : null;
            if (S) {
                push(S.titleBgm, 'audio/bgm', 'title');
                push(S.battleBgm, 'audio/bgm', 'battle');
                push(S.victoryMe, 'audio/me', 'victory');
                push(S.defeatMe, 'audio/me', 'defeat');
                push(S.gameoverMe, 'audio/me', 'game over');
                ['boat', 'ship', 'airship'].forEach(function (v) {
                    if (S[v] && S[v].bgm) push(S[v].bgm, 'audio/bgm', v);
                });
                (S.sounds || []).forEach(function (s, i) {
                    push(s, 'audio/se', 'system sound ' + i);
                });
            }
            var Mp = typeof $dataMap !== 'undefined' ? $dataMap : null;
            if (Mp) {
                push(Mp.bgm, 'audio/bgm', 'this map');
                push(Mp.bgs, 'audio/bgs', 'this map');
            }
            var seen = {}, uniq = [];
            out.forEach(function (r) {
                var k = r.folder + '/' + r.name;
                if (seen[k]) return;
                seen[k] = 1;
                uniq.push(r);
            });
            return uniq;
        }, 'media database names', []);
    };

    /* =====================================================================
       PART 2 — ASSETS
       ===================================================================== */

    var AS = M.assets = {};

    var IMG_DIRS = ['img/characters', 'img/faces', 'img/pictures', 'img/battlebacks1',
        'img/battlebacks2', 'img/enemies', 'img/sv_actors', 'img/sv_enemies',
        'img/tilesets', 'img/titles1', 'img/system'];
    AS.folders = function () { return IMG_DIRS.slice(); };

    AS.list = function (folder, opts) {
        opts = opts || {};
        return $.safe(function () {
            var rel = IMG_DIRS.indexOf(folder) > -1 ? folder : IMG_DIRS[0];
            var walked = walkFolder(rel, !!opts.recursive);
            if (walked) {
                return {
                    rows: walked.rows.map(function (r) { return signOf(r); }),
                    complete: walked.complete, source: 'folder', why: walked.why
                };
            }
            var idx = indexRows(rel);
            if (idx) {
                return {
                    rows: idx.map(function (r) { return signOf(r); }),
                    complete: false, source: 'index',
                    why: 'from the boot index, which reads one level and cannot tell a folder from a sheet.'
                };
            }
            var db = databaseImages(rel);
            return {
                rows: db.map(function (r) { return signOf(r); }),
                complete: false, source: 'database',
                why: 'no folder listing here — ' + ($.caps.fsWhy || 'no filesystem') +
                    ' — the names below are the ones the database carries for this folder.'
            };
        }, 'media asset list', { rows: [], complete: false, source: 'none', why: 'the folder could not be read.' });
    };

    /* The sign is shown as the engine reads it: a leading RUN, not a first
       character. What the run MEANS is asked of the engine below; this is only
       what to print in the column. */
    function signOf(row) {
        var m = /^[!$]+/.exec(String(row.name).split('/').pop());
        row.sign = m ? m[0] : '';
        return row;
    }

    function databaseImages(rel) {
        return $.safe(function () {
            var out = [], seen = {};
            function push(name) {
                if (!name || seen[name]) return;
                seen[name] = 1;
                out.push({ name: name, dir: false, sub: '', source: 'database' });
            }
            if (rel === 'img/characters' || rel === 'img/faces') {
                var actors = typeof $dataActors !== 'undefined' ? ($dataActors || []) : [];
                actors.forEach(function (a) {
                    if (!a) return;
                    push(rel === 'img/faces' ? a.faceName : a.characterName);
                });
            }
            if (rel === 'img/enemies' || rel === 'img/sv_enemies') {
                var enemies = typeof $dataEnemies !== 'undefined' ? ($dataEnemies || []) : [];
                enemies.forEach(function (e) { if (e) push(e.battlerName); });
            }
            if (rel === 'img/titles1' && typeof $dataSystem !== 'undefined' && $dataSystem) {
                push($dataSystem.title1Name);
            }
            return out;
        }, 'media database images', []) || [];
    }

    /**
     * What layout this sheet has, decided by the ENGINE.
     *
     * The single-character convention is a sign RUN and one build strips a
     * subfolder from the name before testing it while the other does not, so
     * the same name is a single-character sheet on one and not on the other.
     * Where the engine's own predicate is missing the layout is still shown —
     * it is the only useful guess — but it is MARKED as a guess and the panel
     * says so, because a wrong grid presented as a fact is worse than a right
     * one presented as uncertain.
     */
    AS.grid = function (folder, name, bmp) {
        var w = (bmp && bmp.width) || 0, hgt = (bmp && bmp.height) || 0;
        if (folder === 'img/faces') {
            return {
                kind: 'face', big: false, object: false, provisional: false,
                cols: 4, rows: 2, characters: 8,
                frameW: faceWidth(), frameH: faceHeight(), w: w, h: hgt
            };
        }
        if (folder !== 'img/characters') {
            return {
                kind: 'whole', big: false, object: false, provisional: false,
                cols: 1, rows: 1, characters: 1, frameW: w, frameH: hgt, w: w, h: hgt
            };
        }
        var provisional = !CAP.bigCharacterTest();
        var big = provisional
            ? /^[!$]*\$/.test(String(name))
            : !!$.safe(function () { return ImageManager.isBigCharacter(name); }, 'media isBigCharacter', false);
        var object = (typeof ImageManager !== 'undefined' && typeof ImageManager.isObjectCharacter === 'function')
            ? !!$.safe(function () { return ImageManager.isObjectCharacter(name); }, 'media isObjectCharacter', false)
            : /^[!$]*!/.test(String(name));
        var cw = big ? 3 : 12, ch = big ? 4 : 8;
        return {
            kind: 'character', big: big, object: object, provisional: provisional,
            cols: cw, rows: ch, characters: big ? 1 : 8,
            frameW: cw ? Math.floor(w / cw) : 0, frameH: ch ? Math.floor(hgt / ch) : 0,
            w: w, h: hgt
        };
    };

    /* The arithmetic is the sprite's own, copied and cited rather than
       invented: a single-character sheet starts at block 0,0 and every other
       one blocks out four across by two down, with the facing selecting the
       row inside the block. */
    AS.frameRect = function (grid, charIndex, direction, pattern) {
        var fw = grid.frameW, fh = grid.frameH;
        if (grid.kind === 'face') {
            var i = charIndex % 8;
            return { sx: (i % 4) * fw, sy: Math.floor(i / 4) * fh, sw: fw, sh: fh };
        }
        if (grid.kind !== 'character') return { sx: 0, sy: 0, sw: grid.w, sh: grid.h };
        var blockX = grid.big ? 0 : (charIndex % 4) * 3;
        var blockY = grid.big ? 0 : Math.floor(charIndex / 4) * 4;
        var py = (direction - 2) / 2;
        return { sx: (blockX + pattern) * fw, sy: (blockY + py) * fh, sw: fw, sh: fh };
    };

    /* The column order and the hold are the character's own, not a guess at
       what looks right: the pattern counter runs 0..3 and the third value maps
       back onto the middle column, and the hold is the engine's animation wait
       for that move speed. A check compares this against the engine's own
       function so the copy cannot drift. */
    AS.walk = function (speed) {
        var s = Math.round(speed);
        if (s < 1) s = 1;
        if (s > 6) s = 6;
        return { columns: [0, 1, 2, 1], waitFrames: (9 - s) * 3, speed: s };
    };

    AS.encodedUrl = function (folder, name) {
        return folder + '/' + encodeName(name) + '.png';
    };
    AS.encrypted = function () { return encFlag('images'); };
    AS.faceSize = function () { return { w: faceWidth(), h: faceHeight() }; };

    /**
     * Drop a bitmap out of whichever image cache this build keeps, by
     * IDENTITY.
     *
     * Rebuilding the cache key is how an eviction misses: the two builds spell
     * the key differently and one of them wraps the bitmap in a record. An
     * errored bitmap left in the cache is not a cosmetic problem — on the
     * build whose readiness test throws for one, every later scene transition
     * fails until it is gone.
     */
    function evict(bmp) {
        return $.safe(function () {
            var n = 0, k, url;
            if (typeof ImageManager === 'undefined') return 0;
            var flat = ['_cache', '_system'];
            for (var i = 0; i < flat.length; i++) {
                var c = ImageManager[flat[i]];
                if (!c || typeof c !== 'object') continue;
                for (url in c) {
                    if (!Object.prototype.hasOwnProperty.call(c, url)) continue;
                    if (c[url] === bmp) { delete c[url]; n++; }
                }
            }
            var ic = ImageManager._imageCache;
            if (ic && ic._items) {
                for (k in ic._items) {
                    if (!Object.prototype.hasOwnProperty.call(ic._items, k)) continue;
                    var it = ic._items[k];
                    if (it === bmp || (it && it.bitmap === bmp)) { delete ic._items[k]; n++; }
                }
            }
            return n;
        }, 'media evict bitmap', 0);
    }
    AS.evict = evict;

    var POLL_FRAMES = 300;

    /**
     * Load a sheet and hand back its pixels as a data URL.
     *
     * A load listener is not enough on either build: the error path only sets
     * the loading state and never calls the listeners, so a missing file waits
     * for ever. The state is polled for a bounded number of frames and then
     * given up on with a message.
     */
    AS.sheet = function (folder, name, cb) {
        var cancelled = false, fn = null, waited = 0;
        var bmp = $.safe(function () {
            if (typeof ImageManager === 'undefined' || !ImageManager.loadBitmap) return null;
            /* The trailing slash is what the engine's own loaders pass on both
               builds; the two extra arguments are ignored where the signature
               takes two. */
            return ImageManager.loadBitmap(folder + '/', name, 0, true);
        }, 'media load sheet', null);
        if (!bmp) {
            cb({
                error: true, dataUrl: null, w: 0, h: 0,
                why: 'the engine\'s image loader could not be reached or refused this name; the log ' +
                    'carries the message it gave.'
            });
            return function () { };
        }
        function finish(out) {
            if (fn) $.offFrame(fn);
            if (!cancelled) cb(out);
        }
        function settle() {
            if (cancelled) return true;
            if (bmp.isError && bmp.isError()) {
                var n = evict(bmp);
                finish({
                    error: true, bmp: null, dataUrl: null, w: 0, h: 0,
                    why: 'the file did not load — the entry has been dropped from the image cache (' +
                        n + ' removed) so it does not poison the next scene change.'
                });
                return true;
            }
            if (bmp.isReady && bmp.isReady()) { finish(pixels(bmp)); return true; }
            return false;
        }
        if (settle()) return function () { };
        fn = $.onFrame('media sheet ' + folder + '/' + name, function () {
            waited++;
            if (settle()) return;
            if (waited > POLL_FRAMES) {
                finish({
                    error: true, bmp: null, dataUrl: null, w: 0, h: 0,
                    why: POLL_FRAMES + ' frames passed and the engine still reports neither ready nor ' +
                        'failed for it; the preview was given up on.'
                });
            }
        });
        return function () { cancelled = true; if (fn) $.offFrame(fn); };
    };

    /* Pixels come back as a data URL and the bitmap is not kept — see the
       header. Reading pixels back can be refused by the browser on a canvas it
       considers tainted; that is a preview failure, not a file failure, and it
       is reported as exactly that. */
    function pixels(bmp) {
        var w = bmp.width || 0, hh = bmp.height || 0;
        if (!w || !hh) {
            return {
                error: false, dataUrl: null, w: w, h: hh,
                why: 'the engine reports this sheet as ready and gives it no size, so there are no ' +
                    'pixels to show. Nothing is wrong with the file.'
            };
        }
        var url = bitmapPixels(bmp, w, hh);
        if (!url) {
            return {
                error: false, dataUrl: null, w: w, h: hh,
                why: 'the browser refused to read pixels back from this image. The file is there; ' +
                    'only the preview is unavailable.'
            };
        }
        return { error: false, dataUrl: url, w: w, h: hh, why: '' };
    }

    /* =====================================================================
       PART 3 — CAPTURE
       ===================================================================== */

    var C = M.capture = {};

    var excludes = [];      // {label, get}
    var shots = [];         // newest last
    var shotN = 0;
    var burst = null;       // {n, every, done, fn}
    /* How many full-screen bitmaps this module had alive at once, ever. A
       burst that holds its shots is the unbounded-memory failure this module
       is written to avoid, and a number is the only way to prove it did not
       happen. */
    var live = 0, peakLive = 0;

    /**
     * Register something GigaHack draws INSIDE the scene so a shot can leave
     * it out.
     *
     * The overlay itself is never in a shot — it is a browser layer over the
     * canvas and the engine's snapshot renders the display tree only. The two
     * things that ARE in the tree belong to other modules, so they register
     * themselves rather than being named here; until one does, the panel says
     * plainly that nothing is registered.
     */
    C.exclude = function (label, getNode) {
        var entry = { label: String(label), get: getNode };
        excludes.push(entry);
        return function () {
            var i = excludes.indexOf(entry);
            if (i > -1) excludes.splice(i, 1);
        };
    };
    C.excluded = function () {
        return excludes.map(function (e) {
            var node = $.safe(function () { return e.get(); }, 'media exclude ' + e.label, null);
            return { label: e.label, present: !!node };
        });
    };

    C.size = function () {
        return {
            w: (typeof Graphics !== 'undefined' && Graphics.width) || 0,
            h: (typeof Graphics !== 'undefined' && Graphics.height) || 0
        };
    };

    C.dir = function () {
        return $.safe(function () {
            if (!$.caps.fs || !$.env.path || !$.paths.dataDir) return null;
            return $.env.path.join($.paths.dataDir, sStr('capture', 'dir', 'shots'));
        }, 'media capture dir', null);
    };

    C.encode = function (dataUrl) {
        return $.safe(function () {
            var s = String(dataUrl);
            var i = s.indexOf(',');
            if (i < 0) return null;
            var bin = atob(s.slice(i + 1));
            var out = new Uint8Array(bin.length);
            for (var k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
            return out;
        }, 'media encode png', null);
    };

    function stamp() {
        var d = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
            p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    C.nextName = function () {
        return sStr('capture', 'namePrefix', 'shot') + '-' + stamp() + '-' +
            ('00' + (shotN + 1)).slice(-3) + '.png';
    };

    /* Hide, snap, restore — inside ONE synchronous try/finally, and never
       through the settings store. The owning modules re-show their own layers
       from their per-frame update, so a hide that is not undone in the same
       call is undone for us a frame later and the shot is not clean anyway;
       and persisting the hidden state would fire the badge machinery and leave
       the layer off after the shot. */
    function withHidden(fn) {
        if (!sBool('capture', 'hideOverlays', true) || !excludes.length) return fn();
        var hidden = [];
        $.safe(function () {
            for (var i = 0; i < excludes.length; i++) {
                var node = $.safe(function () { return excludes[i].get(); }, 'media exclude node', null);
                if (!node || node.visible === false) continue;
                node.visible = false;
                hidden.push(node);
            }
        }, 'media hide overlays');
        try {
            return fn();
        } finally {
            for (var k = 0; k < hidden.length; k++) hidden[k].visible = true;
        }
    }

    function canvasFallback() {
        return $.safe(function () {
            var el = document.getElementById($.caps.canvasId);
            return (el && el.toDataURL) ? el : null;
        }, 'media canvas fallback', null);
    }

    C.available = function () { return CAP.sceneSnap() || !!canvasFallback(); };
    C.unavailableWhy = function () {
        return 'neither the engine\'s scene snapshot nor a game canvas is reachable on this build, ' +
            'so there is nothing to photograph.';
    };

    /**
     * One shot.
     *
     * The dimensions are the GAME's resolution, whichever size the window is,
     * because they come from the snapshot the engine makes of its own stage.
     * Where that bitmap exposes no readable canvas the pixels come from the
     * game canvas element instead, and the row says so rather than pretending
     * the two are the same thing.
     */
    C.shoot = function (opts) {
        opts = opts || {};
        if (!C.available()) return { ok: false, why: C.unavailableWhy(), path: null, bytes: null };
        var size = C.size();
        var bmp = withHidden(function () { return snapBitmap(); });
        if (bmp) { live++; if (live > peakLive) peakLive = live; }
        /* The engine's own snapshot is of the GAME's stage, so its dimensions
           are the game's resolution whatever size the window is. They are kept
           apart from the dimensions of the image that actually came out,
           because those two are not always the same thing and a row that
           conflated them would be quietly wrong. */
        var gameW = (bmp && bmp.width) || size.w, gameH = (bmp && bmp.height) || size.h;
        var w = gameW, hh = gameH;
        var source = bmp ? 'scene' : 'canvas';
        var url = bitmapPixels(bmp, gameW, gameH);
        var note = '';
        if (!url) {
            var el = canvasFallback();
            if (el) {
                url = $.safe(function () { return el.toDataURL('image/png'); }, 'media canvas pixels', null);
                if (!usableDataUrl(url)) url = null;
                source = 'canvas';
                w = el.width; hh = el.height;
                note = 'the engine\'s snapshot gave no readable canvas here, so the pixels came from ' +
                    'the game canvas element (' + el.width + ' × ' + el.height + ')' +
                    ((el.width !== gameW || el.height !== gameH)
                        ? ', which is not the game\'s own ' + gameW + ' × ' + gameH + '.' : '.');
            }
        }
        /* Released before anything else is done with the bytes, so a burst
           never holds two. Where the engine has no destroy it is dropped and
           the panel says which of the two happened. */
        var destroyed = destroyBitmap(bmp);
        bmp = null;
        if (live > 0) live--;
        if (!url) {
            return {
                ok: false, path: null, bytes: null, w: w, h: hh, gameW: gameW, gameH: gameH,
                why: 'the pixels could not be read back on this build; the shot has dimensions but no image.'
            };
        }
        var bytes = C.encode(url);
        var file = null, why = note;
        var dir = C.dir();
        if (dir && bytes) {
            var name = C.nextName();
            var written = $.safe(function () {
                $.env.fs.mkdirSync(dir, { recursive: true });
                var p = $.env.path.join(dir, name);
                $.env.fs.writeFileSync(p, bytes);
                return p;
            }, 'media write shot', null);
            if (written) file = written;
            else why = (why ? why + ' ' : '') + 'the file could not be written; the log names the path.';
        } else if (!dir) {
            why = (why ? why + ' ' : '') + 'there is no filesystem here (' +
                ($.caps.fsWhy || 'no Node APIs') + '), so this shot exists only in memory.';
        }
        /* Only the newest shot keeps its bytes. Older rows keep the path, and
           where there is no path they keep nothing — which is the honest cost
           of not holding a screen's worth of pixels per row. */
        for (var i = 0; i < shots.length; i++) { shots[i].bytes = null; shots[i].dataUrl = null; }
        shotN++;
        var row = {
            n: shotN, file: file, bytes: bytes, dataUrl: url, at: Date.now(),
            w: w, h: hh, gameW: gameW, gameH: gameH, source: source, destroyed: destroyed,
            size: bytes ? bytes.length : 0, why: why
        };
        shots.push(row);
        if (shots.length > 200) shots.shift();
        return {
            ok: true, path: file, bytes: bytes, blobUrl: url, w: w, h: hh,
            gameW: gameW, gameH: gameH, source: source, destroyed: destroyed, why: why
        };
    };

    C.shots = function () {
        return shots.map(function (s) {
            return {
                n: s.n, file: s.file, at: s.at, w: s.w, h: s.h,
                gameW: s.gameW, gameH: s.gameH, size: s.size, destroyed: s.destroyed,
                source: s.source, why: s.why, hasBytes: !!s.bytes
            };
        });
    };
    C.last = function () { return shots.length ? shots[shots.length - 1] : null; };
    C.clear = function () { var n = shots.length; shots.length = 0; return n; };
    C.peakLive = function () { return peakLive; };

    C.burstAvailable = function () { return !!C.dir(); };
    C.burstWhy = function () {
        return 'a burst needs somewhere to write — ' + ($.caps.fsWhy || 'no Node APIs here') +
            ' A single shot is still offered as an image you can save.';
    };

    /**
     * A run of shots, driven off GigaHack's own frame counter so it keeps
     * firing while the game is held. Refused where there is nowhere to write:
     * buffering a screen's worth of pixels per frame in RAM is the failure
     * this is written to avoid, not a fallback.
     */
    C.burst = function (opts) {
        opts = opts || {};
        if (burst) return { ok: false, why: 'a burst is already running.' };
        if (!C.burstAvailable()) return { ok: false, why: C.burstWhy() };
        if (!C.available()) return { ok: false, why: C.unavailableWhy() };
        var n = Math.round(opts.n || sNum('capture', 'burst', 8, 2, 60));
        var every = Math.round(opts.everyFrames || sNum('capture', 'every', 6, 1, 60));
        if (n < 2) n = 2;
        if (every < 1) every = 1;
        var wait = 0;
        burst = { total: n, done: 0, every: every, fn: null };
        burst.fn = $.onFrame('media burst', function () {
            if (!burst) return;
            wait++;
            if (wait < burst.every) return;
            wait = 0;
            C.shoot();
            burst.done++;
            if (burst.done >= burst.total) C.stopBurst();
        });
        return { ok: true, why: '' };
    };
    C.stopBurst = function () {
        if (!burst) return 0;
        var done = burst.done;
        if (burst.fn) $.offFrame(burst.fn);
        burst = null;
        return done;
    };
    C.running = function () {
        return burst ? { on: true, done: burst.done, total: burst.total }
            : { on: false, done: 0, total: 0 };
    };

    /* The scene transform is flattened by the engine's own snapshot on both
       builds. It heals on the next render, and GigaHack renders on every path
       including the held one — but a stopped loop renders nothing, so a shot
       taken there can leave the scene flat until the loop runs again. */
    C.stoppedWarning = function () {
        return $.safe(function () {
            return !!(typeof SceneManager !== 'undefined' && SceneManager._stopped);
        }, 'media scene stopped', false);
    };

    /* =====================================================================
       PART 4 — HOOKS

       Four recorders and one guard. Every one records AFTER the original, so
       what is recorded is what the engine accepted rather than what it was
       asked for, and every one is skipped with a stated reason where its
       target is absent — the panel then says which part of the list is
       missing instead of showing a gap that looks like silence.
       ===================================================================== */

    function recorder(kind) {
        return function (original) {
            return function (obj, pos) {
                original.call(this, obj, pos);
                if (!obj || !obj.name) return;
                /* Never $.log from here: one of these runs several times a
                   second and a log line per call is the failure this project
                   catalogues. */
                record(kind, obj.name, obj);
            };
        };
    }

    $.install('AudioManager.playBgm', typeof AudioManager !== 'undefined' ? AudioManager : null,
        'playBgm', recorder('bgm'),
        'AudioManager.playBgm not found — the recent list will not show background music, and the ' +
        'Audio panel says so rather than showing an empty list that looks like silence.');

    $.install('AudioManager.playBgs', typeof AudioManager !== 'undefined' ? AudioManager : null,
        'playBgs', recorder('bgs'),
        'AudioManager.playBgs not found — the recent list will not show ambience, which is the one ' +
        'kind with no visible source in the game at all.');

    $.install('AudioManager.playMe', typeof AudioManager !== 'undefined' ? AudioManager : null,
        'playMe', recorder('me'),
        'AudioManager.playMe not found — the recent list will not show victory, defeat or game-over ' +
        'jingles, and those are the ones already gone by the time anyone asks what they were.');

    $.install('AudioManager.playSe', typeof AudioManager !== 'undefined' ? AudioManager : null,
        'playSe', function (original) {
            return function (se) {
                original.call(this, se);
                if (!logSe || !se || !se.name) return;
                record('se', se.name, se);
            };
        },
        'AudioManager.playSe not found — sound effects will not be listed; the panel says the recent ' +
        'list covers music only.');

    /**
     * The severe one.
     *
     * On some builds the running scene calls this every frame and it THROWS
     * for any buffer in error, so an audition of a name with no file behind it
     * becomes the engine's load-error screen on the next frame. The sweep runs
     * BEFORE the original and touches only buffers this module started, by
     * identity, within a bounded number of frames — so a genuine game-side
     * load failure still throws exactly as it did.
     */
    $.install('AudioManager.checkErrors', typeof AudioManager !== 'undefined' ? AudioManager : null,
        'checkErrors', function (original) {
            return function () {
                $.safe(sweep, 'media audio sweep');
                return original.apply(this, arguments);
            };
        },
        'AudioManager.checkErrors not found — GigaHack cannot intercept a failed audition here, so ' +
        'auditions are restricted to names it has verified on disk and an unverifiable one is refused.');

    /* =====================================================================
       PART 5 — PANELS
       ===================================================================== */

    function kv(label, value, tip) {
        return h('div', { class: 'mm-row', tip: tip || null },
            h('div', { class: 'mm-lab', text: String(label) }),
            /* An unbounded value on the right — a track name with a subfolder
               in it, a joined list, a path — has to be allowed to shrink and
               wrap, or it pushes the label out of the row and is then clipped
               and neither half can be read. */
            h('div', {
                class: 'mm-edge mm-edge--shrink mm-edge--wrap mm-mono mm-sub mm-breakall',
                text: String(value)
            }));
    }

    function sub(text) {
        return h('div', { class: 'mm-sub', style: 'white-space:normal;padding:2px 2px 4px', text: text });
    }

    function warn(text) {
        return h('div', {
            class: 'mm-sub', style: 'white-space:normal;padding:2px 2px 4px;color:var(--mm-warn)',
            text: text
        });
    }

    /* A named gap, inside a group rather than instead of a panel. U.todo
       returns a whole panel body, which is the right shape for "this panel has
       nothing" and the wrong one for "this group's source is not the good
       one". */
    function gap(title, lines) {
        return h('div', { class: 'mm-todo' },
            h('b', { text: title }),
            h('div', { style: 'text-align:center;line-height:1.7' },
                (lines || []).map(function (l) {
                    return l ? h('div', { style: 'white-space:normal', text: l }) : null;
                })));
    }

    function empty(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* -------------------------------------------------------------- Audio */

    var audioQ = '';

    function buildAudio() {
        var host = U.getHost();
        var folder = sStr('audio', 'folder', AUDIO_DIRS[0], AUDIO_DIRS.concat([DATABASE_SOURCE]));
        var listing = A.list(folder);
        var degraded = $.compat.isDegraded('media.volume');
        var playDegraded = A.playDegraded();

        /* ---------------------------------------------------- playing now */
        var live = h('div', {});
        function paintLive() {
            var n = A.now();
            empty(live);
            if (!n) {
                live.appendChild(warn('this build has no audio manager to ask.'));
                return;
            }
            live.appendChild(kv('BGM', n.bgm
                ? n.bgm.name + (n.bgm.pos !== null ? '  ·  ' + n.bgm.pos.toFixed(1) + 's' : '')
                : '—'));
            live.appendChild(kv('BGS', n.bgs
                ? n.bgs.name + (n.bgs.pos !== null ? '  ·  ' + n.bgs.pos.toFixed(1) + 's' : '')
                : '—'));
            live.appendChild(kv('ME', n.me
                ? (n.me.name || 'playing — this build\'s audio buffers carry no name')
                : '—'));
            live.appendChild(kv('SE voices', n.seVoices));
            live.appendChild(kv('Static buffers', n.staticBuffers,
                'Static buffers|One per distinct system sound. Never freed.'));
        }
        paintLive();

        function stopButton(kind, label) {
            return W.button({
                label: label, mini: true, wide: true, mutates: true,
                disabled: !A.canStop(kind) || playDegraded,
                tip: !A.canStop(kind) ? 'Missing|' + A.stopWhy(kind)
                    : playDegraded ? 'Not sticking|Something is putting the sound back.' : null,
                onClick: function () { A.stop(kind); paintLive(); }
            });
        }

        var playingNow = W.group('Playing now', [
            live,
            stopButton('bgm', 'stop BGM'),
            stopButton('bgs', 'stop BGS'),
            stopButton('me', 'stop ME'),
            stopButton('se', 'stop every SE'),
            W.button({
                label: 'kill everything', wide: true, variant: 'danger', confirm: true,
                disabled: !A.canStop('all') || playDegraded,
                tip: A.canStop('all') ? 'Kill|Stops music, ambience, jingles and effects.'
                    : 'Missing|' + A.stopWhy('all'),
                onClick: function () { A.stopAll(); paintLive(); }
            }),
            playDegraded ? warn(A.playDegradedWhy()) : null
        ], { tag: 'live' });

        /* -------------------------------------------------------- volumes */
        var vols = A.volumes();
        /* The row label is the kind alone — the group title already says these
           are volumes, and a narrow sidebar clips "BGM volume" to "BGM volu…",
           which is a label that has lost the only word it needed. */
        var volRows = VOL_KINDS.map(function (k) {
            var have = A.volumeAvailable(k);
            var label = k.toUpperCase() + ' volume';
            return W.row(k.toUpperCase(), W.slider({
                min: 0, max: 100, step: 1, unit: '%', width: '116px', label: label,
                value: have ? vols[k] : 0, disabled: !have || degraded,
                onChange: function (v) { A.setVolume(k, v, false); },
                onCommit: function (v) {
                    var r = A.setVolume(k, v, true);
                    if (!r.ok && r.why) {
                        U.toast({ title: 'DID NOT STICK', msg: 'the panel now says what it read back', severity: 'warn' });
                        U.rerender();
                    }
                }
            }), {
                tip: !have ? 'Missing|' + A.volumeWhy(k)
                    : degraded ? 'Degraded|' + $.compat.degradedWhy('media.volume')
                        : 'Heard at once|Written to the config file on release.'
            });
        });
        if (A.masterAvailable()) {
            var masterBad = $.compat.isDegraded('media.master');
            volRows.push(W.row('Master', W.slider({
                min: 0, max: 100, step: 1, unit: '%', width: '116px', label: 'Master volume',
                value: Math.round((vols.master || 0) * 100), disabled: masterBad,
                onCommit: function (v) { A.setMaster(v); U.rerender(); }
            }), {
                tip: masterBad ? 'Degraded|' + $.compat.degradedWhy('media.master')
                    : 'Master|This build only. Also drives video volume.'
            }));
            if (masterBad) volRows.push(warn($.compat.degradedWhy('media.master')));
        } else {
            volRows.push(sub('this build has no master volume — the four above are all there is.'));
        }
        volRows.push(kv('Audio file extension', A.ext()));
        volRows.push(kv('Encrypted', A.encrypted() ? 'yes' : 'no'));
        if (degraded) volRows.push(warn($.compat.degradedWhy('media.volume')));

        var volumes = W.group('The game\'s own volumes', volRows, { tag: 'ConfigManager' });

        /* ------------------------------------------------------- on leave */
        var saved = A.saved();
        var onLeave = W.group('When you leave', [
            W.toggleRow('Put back what was playing', {
                value: restoreOnLeave, _ungated: true, sub: 'BGM and BGS only',
                onChange: function (v) { put('audio.restoreOnLeave', !!v); U.rerender(); }
            }),
            warn('An ME cannot be put back: the engine records no saved ME and no position for one, ' +
                'so auditioning over a playing ME loses it — but the engine restarts the BGM by ' +
                'itself when an ME ends.'),
            W.button({
                label: 'put it back now', wide: true, mutates: true, disabled: !saved,
                tip: saved ? null : 'Nothing saved|No audition has replaced the game\'s music yet.',
                onClick: function () { A.restore(); U.rerender(); }
            })
        ]);

        /* -------------------------------------------------------- browser */
        var table = W.table({
            virtual: true, rowH: 17,
            cols: [
                { label: '', w: '0 0 22px' },
                { label: 'name', w: '1 1 0' },
                { label: 'where', w: '0 0 110px' },
                { label: '', w: '0 0 150px' }
            ],
            empty: listing.source === 'folder' ? 'no matches' : 'nothing to list',
            render: function (r) {
                return [
                    h('span', { class: 'mm-sub', text: r.dir ? '▸' : '' }),
                    h('span', { class: 'mm-mono', text: r.name }),
                    h('span', { class: 'mm-sub', text: r.where || r.sub || (r.dir ? 'folder' : '') }),
                    /* A directory gets no controls at all rather than a
                       greyed pair: "stop" beside a folder is a question the
                       row cannot be asked. */
                    r.dir ? h('span', {}) : h('div', { class: 'mm-inline' },
                        W.button({
                            label: 'play', mini: true, mutates: true,
                            disabled: !r.playable || playDegraded,
                            onClick: function () {
                                var res = A.play(r.kind, r.name);
                                U.toast(res.ok
                                    ? { title: 'PLAYING', msg: r.name, severity: 'ok', ms: 1400 }
                                    : { title: 'NOT PLAYED', msg: res.why, severity: 'warn' });
                                U.rerender();
                            }
                        }),
                        W.button({
                            label: 'stop', mini: true, mutates: true,
                            disabled: !A.canStop(r.kind) || playDegraded,
                            onClick: function () { A.stop(r.kind); paintLive(); }
                        }))
                ];
            },
            onRow: function (tr, r) {
                if (r.why) tr.setAttribute('data-mm-tip', 'Not playable|' + r.why);
                else tr.setAttribute('data-mm-tip', r.name + '|' + A.url(r.kind, r.name));
            }
        });
        function rows() {
            var out = listing.rows;
            if (!audioQ) return out;
            return out.filter(function (r) { return r.name.toLowerCase().indexOf(audioQ) > -1; });
        }
        table.mm.paint(rows());

        var toolbar = h('div', { class: 'mm-toolbar' },
            W.dropdown({
                options: AUDIO_DIRS.concat([DATABASE_SOURCE]), value: folder, width: '150px', _ungated: true,
                onChange: function (v) { put('audio.folder', v); U.rerender(); }
            }),
            W.search({
                placeholder: 'search names…', value: audioQ,
                onInput: function (v) { audioQ = v.trim(); table.mm.paint(rows()); }
            }),
            hasSubfolder(listing.rows) ? W.chip({
                label: 'subfolders', value: sBool('audio', 'subfolders', true),
                tip: 'Subfolders|Include the tracks one level down.',
                onChange: function (v) { put('audio.subfolders', !!v); U.rerender(); }
            }) : null);

        var browserBody = [toolbar];
        if (listing.source !== 'folder') {
            browserBody.push(gap('no folder listing here', [listing.why]));
        }
        browserBody.push(table);
        if (listing.source === 'folder' && !CAP.subfolders() && hasSubfolder(listing.rows)) {
            browserBody.push(warn('this build escapes the separator when it builds a url, so the ' +
                'tracks inside a subfolder are listed but cannot be requested by name.'));
        }
        browserBody.push(sub('the boot index reads one level of each folder and strips extensions, so ' +
            'its count for this folder and the ' + listing.rows.length + ' listed here are two ' +
            'different numbers on a project that uses subfolders.'));
        if (failures.length) {
            browserBody.push(warn(failures.length + ' audition' + (failures.length === 1 ? '' : 's') +
                ' failed to load and were stopped before the engine\'s error check ran — newest: ' +
                (failures[0].url || 'unnamed')));
            browserBody.push(W.button({
                label: 'forget those', mini: true, _ungated: true,
                onClick: function () { A.clearFailures(); U.rerender(); }
            }));
        }

        var browser = W.group('Folder', browserBody, { grow: true, tag: String(listing.rows.length) });

        /* --------------------------------------------------------- recent */
        var recentRows = A.recent(0);
        var recentTable = W.table({
            virtual: true, rowH: 17,
            cols: [
                { label: 'kind', w: '0 0 44px' },
                { label: 'name', w: '1 1 0' },
                { label: 'frame', w: '0 0 74px', cls: 'mm-td-num' },
                { label: '', w: '0 0 68px' }
            ],
            empty: 'nothing played yet',
            render: function (r) {
                return [
                    h('span', { class: 'mm-sub', text: r.kind }),
                    h('span', { class: 'mm-mono', text: r.name + (r.count > 1 ? '  ×' + r.count : '') }),
                    String(r.frame),
                    h('span', { class: 'mm-sub', text: r.source })
                ];
            }
        });
        recentTable.mm.paint(recentRows);

        var recent = W.group('Recent', [
            recentTable,
            W.toggleRow('include sound effects', {
                value: logSe, _ungated: true,
                onChange: function (v) { put('audio.logSe', !!v); U.rerender(); }
            }),
            sub('the game\'s own menu sounds (cursor, ok, cancel, buzzer) go through ' +
                'SoundManager.playSystemSound → AudioManager.playStaticSe, which is a different call ' +
                'and is not listed — it fires several times a second and would drown everything else.'),
            missingRecorders(),
            W.button({
                label: 'copy', mini: true, _ungated: true,
                onClick: function () {
                    var text = recentRows.map(function (r) {
                        return r.kind + '\t' + r.name + '\t' + r.frame + '\t' + r.source;
                    }).join('\n');
                    U.toast(U.copyText(text)
                        ? { title: 'COPIED', msg: recentRows.length + ' rows', severity: 'ok' }
                        : { title: 'NO CLIPBOARD', msg: 'this build offers none', severity: 'warn' });
                }
            })
        ], { collapsed: true, tag: String(recentRows.length) });

        /* The panel's heartbeat, and the live rows. Repainted every eighth
           frame: "what is playing" changes on a scene boundary, not per frame,
           and repainting five rows sixty times a second is a cost with no
           corresponding information. */
        if (host && host.fastHooks) {
            host.fastHooks.push(function (n) {
                A.heartbeat();
                if (n % 8) return;
                paintLive();
            });
        }

        return cols({ narrow: true, items: [playingNow, volumes, onLeave] }, [browser, recent]);
    }

    function hasSubfolder(rows) {
        for (var i = 0; i < rows.length; i++) if (rows[i].dir || rows[i].sub) return true;
        return false;
    }

    function missingRecorders() {
        var missing = [];
        ['playBgm', 'playBgs', 'playMe', 'playSe'].forEach(function (m) {
            var hk = $.hooks['AudioManager.' + m];
            if (hk && !hk.installed) missing.push(m + ' (' + hk.reason + ')');
        });
        if (!missing.length) return null;
        return warn('not recorded: ' + missing.join('; ') +
            ' — Debug → Hooks lists every alias and why each one was skipped.');
    }

    /* ------------------------------------------------------------- Assets */

    var assetQ = '', selected = null, sheetCache = null, cancelSheet = null;

    function buildAssets() {
        var host = U.getHost();
        var folder = sStr('assets', 'folder', IMG_DIRS[0], IMG_DIRS);
        var listing = AS.list(folder, { recursive: sBool('assets', 'recursive', true) });

        if (selected && selected.folder !== folder) selected = null;

        /* --------------------------------------------------------- source */
        var sourceLabel = listing.source === 'folder' ? 'this folder, read now'
            : listing.source === 'index' ? 'the boot index' : 'the database only';

        var folderGroup = W.group('Folder', [
            W.dropdown({
                options: IMG_DIRS, value: folder, width: '150px', _ungated: true,
                onChange: function (v) { put('assets.folder', v); selected = null; U.rerender(); }
            }),
            W.search({
                placeholder: 'search names…', value: assetQ,
                onInput: function (v) { assetQ = v.trim(); repaint(); }
            }),
            W.toggleRow('look inside subfolders', {
                value: sBool('assets', 'recursive', true), _ungated: true, sub: 'one level',
                disabled: !$.caps.fs,
                tip: $.caps.fs ? null : 'No filesystem|' + ($.caps.fsWhy || 'no Node APIs here'),
                onChange: function (v) { put('assets.recursive', !!v); U.rerender(); }
            }),
            kv('Source', sourceLabel),
            kv('Encrypted', AS.encrypted() ? 'yes' : 'no'),
            W.button({
                label: 'read the folder again', wide: true, mini: true, _ungated: true,
                disabled: !$.caps.fs,
                tip: $.caps.fs ? null : 'No filesystem|' + ($.caps.fsWhy || 'no Node APIs here'),
                onClick: function () { sheetCache = null; U.rerender(); }
            })
        ], { tag: String(listing.rows.length) });

        /* ---------------------------------------------------- this sheet */
        var grid = null, sheetGroup;
        if (!selected) {
            sheetGroup = W.group('This sheet', [sub('nothing selected — pick a name on the right.')]);
        } else {
            grid = AS.grid(folder, selected.name,
                sheetCache ? { width: sheetCache.w, height: sheetCache.h } : null);
            var rows = [
                W.pathRow('Will ask for', AS.encodedUrl(folder, selected.name), {
                    why: 'no name selected'
                }),
                kv('Size', sheetCache
                    ? (sheetCache.error ? 'did not load' : (sheetCache.w + ' × ' + sheetCache.h))
                    : 'still loading'),
                kv('Sign', selected.sign || '—',
                    'Sign|A run at the start of the name, not one character.')
            ];
            if (grid.kind === 'character') {
                rows.push(kv('Grid', grid.provisional
                    ? 'the engine\'s own big-character test is not on this build, so this layout is a guess'
                    : (grid.characters + ' character' + (grid.characters === 1 ? '' : 's') + ' · ' +
                        grid.cols + ' × ' + grid.rows)));
                rows.push(kv('Anchor', grid.object ? 'flat on the tile (shiftY 0)' : 'lifted 6px (shiftY 6)'));
            } else if (grid.kind === 'face') {
                rows.push(kv('Grid', '8 faces · 4 × 2 of ' + grid.frameW + '×' + grid.frameH));
            } else {
                rows.push(kv('Grid', 'not a sheet — shown whole'));
            }
            if (grid.provisional) {
                rows.push(warn('ImageManager.isBigCharacter is absent on this build, so the layout ' +
                    'above is read off the name rather than from the engine.'));
            }
            sheetGroup = W.group('This sheet', rows, { tag: selected.name });
        }

        /* -------------------------------------------------------- walking */
        var walkGroup = null;
        if (folder === 'img/characters') {
            var speed = sNum('assets', 'speed', 4, 1, 6);
            var wk = AS.walk(speed);
            walkGroup = W.group('Walk cycle', [
                W.row('Character', W.number({
                    value: sNum('assets', 'charIndex', 0, 0, 7), min: 0, max: 7, _ungated: true,
                    disabled: !!(grid && grid.big),
                    onChange: function (v) { put('assets.charIndex', v); U.rerender(); }
                }), {
                    tip: (grid && grid.big)
                        ? 'One character|A "$" sheet holds one, so there is no index.' : null
                }),
                W.row('Facing', W.dropdown({
                    options: ['down', 'left', 'right', 'up'],
                    value: dirName(sNum('assets', 'direction', 2, 2, 8)), width: '92px', _ungated: true,
                    onChange: function (v) { put('assets.direction', dirValue(v)); U.rerender(); }
                })),
                W.toggleRow('animate', {
                    value: sBool('assets', 'animate', false), _ungated: true,
                    onChange: function (v) { put('assets.animate', !!v); U.rerender(); }
                }),
                W.row('Speed', W.slider({
                    min: 1, max: 6, step: 1, value: speed, width: '104px', _ungated: true,
                    onChange: function (v) { put('assets.speed', v); U.rerender(); }
                })),
                /* The formula, on its own line rather than beside the label:
                   it is the whole reason the number is what it is, and a
                   sidebar clips a suffix long before it clips a line. */
                sub('(9 − ' + wk.speed + ') × 3 = ' + wk.waitFrames + ' frames per column, which is ' +
                    'what the engine\'s own animation wait returns for this speed.'),
                kv('Columns', wk.columns.join(', '),
                    'Columns|The pattern counter runs 0..3 and 3 maps back to 1.'),
                W.row('Zoom', W.slider({
                    min: 1, max: 4, step: 1, value: sNum('assets', 'zoom', 2, 1, 4), width: '104px',
                    _ungated: true,
                    onChange: function (v) { put('assets.zoom', v); U.rerender(); }
                }))
            ]);
        }

        /* ----------------------------------------------------------- list */
        var table = W.table({
            virtual: true, rowH: 17,
            cols: [
                { label: 'name', w: '1 1 0' },
                { label: 'where', w: '0 0 110px' },
                { label: 'sign', w: '0 0 46px' },
                { label: '', w: '0 0 60px' }
            ],
            empty: 'no matches',
            render: function (r) {
                return [
                    h('span', { class: 'mm-mono', text: r.name }),
                    h('span', { class: 'mm-sub', text: r.sub || '' }),
                    h('span', { class: 'mm-sub', text: r.dir ? 'folder' : (r.sign || '') }),
                    r.dir ? h('span', { class: 'mm-sub', text: '' }) : W.button({
                        label: 'show', mini: true, _ungated: true,
                        onClick: function () { select(folder, r); }
                    })
                ];
            },
            onRow: function (tr, r) {
                if (r.dir) tr.setAttribute('data-mm-tip', 'Folder|Not a sheet; its contents are listed below it.');
            }
        });
        function listRows() {
            if (!assetQ) return listing.rows;
            return listing.rows.filter(function (r) { return r.name.toLowerCase().indexOf(assetQ) > -1; });
        }
        function repaint() { table.mm.paint(listRows()); }
        repaint();

        var listBody = [];
        if (listing.source !== 'folder') {
            listBody.push(gap('no folder listing here', [listing.why]));
        }
        listBody.push(table);
        var list = W.group('Names', listBody, { tag: String(listing.rows.length) });

        /* -------------------------------------------------------- preview */
        var preview = W.group('Preview', [buildPreview(folder, grid, host)], { grow: true });

        var side = [folderGroup, sheetGroup];
        if (walkGroup) side.push(walkGroup);
        return cols({ narrow: true, items: side }, [list, preview]);
    }

    function dirName(v) { return v === 4 ? 'left' : v === 6 ? 'right' : v === 8 ? 'up' : 'down'; }
    function dirValue(n) { return n === 'left' ? 4 : n === 'right' ? 6 : n === 'up' ? 8 : 2; }

    function select(folder, row) {
        if (row.dir) return;
        selected = { folder: folder, name: row.name, sign: row.sign };
        sheetCache = null;
        if (cancelSheet) cancelSheet();
        /* A load that completes inside the call — a cache hit, which is the
           common case — must not rebuild the panel twice: the second rebuild
           would throw away the DOM the first one is still constructing. */
        var inside = true;
        cancelSheet = AS.sheet(folder, row.name, function (out) {
            sheetCache = out;
            if (!inside) U.rerender();
        });
        inside = false;
        U.rerender();
    }

    function buildPreview(folder, grid, host) {
        if (!selected) return sub('pick a name on the right to see it.');
        if (!sheetCache) return sub('loading…');
        if (sheetCache.error) return gap('the file did not load', [sheetCache.why]);
        if (!sheetCache.dataUrl) return gap('the sheet cannot be read', [sheetCache.why]);

        var zoom = sNum('assets', 'zoom', 2, 1, 4);
        var box = h('div', {});
        var img = new Image();
        var whole = h('canvas', {});
        whole.width = sheetCache.w * zoom;
        whole.height = sheetCache.h * zoom;
        whole.style.cssText = 'image-rendering:pixelated;max-width:100%;display:block;margin-bottom:8px';
        box.appendChild(whole);

        var frames = h('div', { class: 'mm-inline', style: 'flex-wrap:wrap' });
        var strip = [];
        if (grid && grid.kind === 'character' && grid.frameW > 0) {
            var idx = sNum('assets', 'charIndex', 0, 0, 7);
            var dirs = [2, 4, 6, 8];
            for (var d = 0; d < dirs.length; d++) {
                for (var p = 0; p < 3; p++) {
                    var cv = h('canvas', {});
                    cv.width = grid.frameW * zoom;
                    cv.height = grid.frameH * zoom;
                    cv.style.cssText = 'image-rendering:pixelated;margin:0 4px 4px 0';
                    strip.push({ el: cv, rect: AS.frameRect(grid, idx, dirs[d], p) });
                    frames.appendChild(cv);
                }
            }
            box.appendChild(frames);
        }

        var anim = null, animRect = null;
        if (grid && grid.kind === 'character' && sBool('assets', 'animate', false) && grid.frameW > 0) {
            anim = h('canvas', {});
            anim.width = grid.frameW * zoom;
            anim.height = grid.frameH * zoom;
            anim.style.cssText = 'image-rendering:pixelated;border:1px solid var(--mm-line)';
            box.appendChild(h('div', { style: 'margin-top:6px' }, anim));
        }

        img.onload = function () {
            $.safe(function () {
                var g = whole.getContext('2d');
                g.imageSmoothingEnabled = false;
                g.drawImage(img, 0, 0, whole.width, whole.height);
                for (var i = 0; i < strip.length; i++) {
                    var r = strip[i].rect, c = strip[i].el.getContext('2d');
                    c.imageSmoothingEnabled = false;
                    c.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, strip[i].el.width, strip[i].el.height);
                }
                paintAnim(0);
            }, 'media draw preview');
        };
        img.src = sheetCache.dataUrl;

        function paintAnim(col) {
            if (!anim) return;
            var idx2 = sNum('assets', 'charIndex', 0, 0, 7);
            animRect = AS.frameRect(grid, idx2, sNum('assets', 'direction', 2, 2, 8), col);
            $.safe(function () {
                var c = anim.getContext('2d');
                c.imageSmoothingEnabled = false;
                c.clearRect(0, 0, anim.width, anim.height);
                c.drawImage(img, animRect.sx, animRect.sy, animRect.sw, animRect.sh,
                    0, 0, anim.width, anim.height);
            }, 'media draw walk frame');
        }

        /* Driven off GigaHack's own frame hook rather than the engine's clock,
           so the cycle keeps stepping while the game is held — which is when
           anyone is actually looking at it. */
        if (anim && host && host.fastHooks) {
            var wk = AS.walk(sNum('assets', 'speed', 4, 1, 6));
            var step = 0, held = 0;
            host.fastHooks.push(function () {
                held++;
                if (held < wk.waitFrames) return;
                held = 0;
                step = (step + 1) % wk.columns.length;
                paintAnim(wk.columns[step]);
            });
        }
        return box;
    }

    /* ------------------------------------------------------------ Capture */

    function buildCapture() {
        var host = U.getHost();
        var ex = C.excluded();
        var size = C.size();
        var run = C.running();

        var shotGroup = W.group('Shot', [
            W.button({
                label: 'take one', variant: 'prime', wide: true, _ungated: true,
                disabled: !C.available(),
                tip: C.available()
                    ? 'Read-only safe|A screenshot changes nothing in the game.'
                    : 'Missing|' + C.unavailableWhy(),
                onClick: function () {
                    var r = C.shoot();
                    U.toast(r.ok
                        ? { title: 'CAPTURED', msg: (r.path || 'in memory only'), severity: 'ok' }
                        : { title: 'NOT CAPTURED', msg: r.why, severity: 'warn' });
                    U.rerender();
                }
            }),
            W.toggleRow('leave the mod\'s drawing out', {
                value: sBool('capture', 'hideOverlays', true), _ungated: true,
                sub: ex.length + ' registered', disabled: !ex.length,
                tip: ex.length ? null
                    : 'Nothing registered|The menu is a browser layer the snapshot never sees.',
                onChange: function (v) { put('capture.hideOverlays', !!v); U.rerender(); }
            }),
            kv('Size', size.w + ' × ' + size.h, 'Size|The game\'s own resolution, whatever the window is.'),
            kv('Excludes', ex.length ? ex.map(function (e) {
                return e.label + (e.present ? '' : ' (not in the scene now)');
            }).join(', ') : '—'),
            ex.length ? null : sub('no module has registered an in-scene drawing. The menu itself is a ' +
                'browser layer over the canvas and was never in the shot; the engine\'s snapshot ' +
                'renders the display tree only.'),
            C.stoppedWarning() ? warn('the scene loop is stopped, so the flattened stage transform the ' +
                'snapshot leaves behind will not heal until it runs again.') : null
        ], { tag: C.available() ? 'ready' : 'unavailable' });

        var burstGroup = W.group('Burst', [
            W.row('Shots', W.number({
                value: sNum('capture', 'burst', 8, 2, 60), min: 2, max: 60, _ungated: true,
                onChange: function (v) { put('capture.burst', v); }
            })),
            W.row('Every N frames', W.number({
                value: sNum('capture', 'every', 6, 1, 60), min: 1, max: 60, _ungated: true,
                onChange: function (v) { put('capture.every', v); }
            }), { tip: 'Frames|GigaHack\'s own counter, so it fires while the game is held.' }),
            run.on ? kv('Progress', run.done + ' / ' + run.total) : null,
            run.on ? W.button({
                label: 'stop', wide: true, _ungated: true,
                onClick: function () { C.stopBurst(); U.rerender(); }
            }) : W.button({
                label: 'start the burst', wide: true, variant: 'prime', _ungated: true,
                disabled: !C.burstAvailable(),
                tip: C.burstAvailable() ? null : 'No filesystem|' + C.burstWhy(),
                onClick: function () {
                    var r = C.burst();
                    if (!r.ok) U.toast({ title: 'NOT STARTED', msg: r.why, severity: 'warn' });
                    U.rerender();
                }
            }),
            C.burstAvailable() ? null : warn(C.burstWhy())
        ], { tag: run.on ? 'running' : 'idle' });

        var whereGroup = W.group('Where', [
            U.w.pathRow('Folder', C.dir(), { why: $.caps.fsWhy || 'no filesystem on this build' }),
            W.row('Prefix', W.text({
                value: sStr('capture', 'namePrefix', 'shot'), width: '120px',
                onInput: function (v) { put('capture.namePrefix', v); }
            })),
            kv('Next', C.nextName()),
            W.button({
                label: 'show it in the file manager', wide: true, mini: true, _ungated: true,
                disabled: !revealAvailable(),
                tip: revealAvailable() ? null
                    : 'No shell|There is no shell to ask here; the path above has a copy button.',
                onClick: function () { reveal(C.dir()); }
            })
        ]);

        /* ----------------------------------------------------- the session */
        var rows = C.shots().slice().reverse();
        var table = W.table({
            cols: [
                { label: '#', w: '0 0 34px', cls: 'mm-td-num' },
                { label: 'file', w: '1 1 0' },
                { label: 'bytes', w: '0 0 74px', cls: 'mm-td-num' },
                /* Wide enough for both controls side by side: stacked, the
                   upper one is clipped by the row it shares. */
                { label: '', w: '0 0 104px' }
            ],
            empty: 'nothing captured yet',
            render: function (r) {
                return [
                    String(r.n),
                    h('span', { class: 'mm-mono mm-breakall', text: r.file || '(memory only)' }),
                    String(r.size || 0),
                    h('div', { class: 'mm-inline' },
                        r.file ? W.button({
                            label: 'copy', mini: true, _ungated: true,
                            tip: 'Copy|The whole path, not the shortened one.',
                            onClick: function () {
                                U.toast(U.copyText(r.file)
                                    ? { title: 'COPIED', msg: 'on the clipboard', severity: 'ok', ms: 1400 }
                                    : { title: 'NO CLIPBOARD', msg: 'this build offers none', severity: 'warn' });
                            }
                        }) : null,
                        r.hasBytes ? saveLink() : null)
                ];
            },
            onRow: function (tr, r) {
                if (r.why) tr.setAttribute('data-mm-tip', 'Shot ' + r.n + '|' + r.why);
            }
        });
        table.mm.paint(rows);

        var session = W.group('This session', [
            table,
            sub('only the newest shot keeps its bytes; older rows keep the path.'),
            W.button({
                label: 'forget the list', mini: true, _ungated: true, disabled: !rows.length,
                tip: 'Forget|Clears these rows. Files already written stay.',
                onClick: function () { C.clear(); U.rerender(); }
            })
        ], { grow: true, tag: String(rows.length) });

        var last = C.last();
        var lastBody;
        if (!last) {
            lastBody = sub('nothing captured yet.');
        } else if (!last.file && !C.dir()) {
            lastBody = h('div', {},
                gap('nothing was written', [
                    'there is no filesystem here (' + ($.caps.fsWhy || 'no Node APIs') + '), so this ' +
                    'shot exists only in memory — save it now or it goes when the panel rebuilds.',
                    previewNote(last)
                ]),
                shotImage(last));
        } else {
            lastBody = h('div', {},
                shotImage(last),
                sub(previewNote(last)));
        }
        var lastGroup = W.group('The last shot', [lastBody]);

        if (host && host.fastHooks && run.on) {
            host.fastHooks.push(function (n) {
                if (n % 15) return;
                var r = C.running();
                if (!r.on) U.rerender();
            });
        }

        return cols({ narrow: true, items: [shotGroup, burstGroup, whereGroup] }, [session, lastGroup]);

        function saveLink() {
            var l = C.last();
            if (!l || !l.dataUrl) return null;
            /* A real anchor rather than a button: the browser writes the file
               and nothing here has to hold the bytes a second time. */
            return h('a', {
                class: 'mm-btn mm-btn-mini', href: l.dataUrl, download: 'shot-' + l.n + '.png',
                text: 'save', tip: 'Save|Only the newest shot still holds its bytes.'
            });
        }
    }

    function previewNote(shot) {
        var release = shot.destroyed
            ? 'the snapped bitmap was released through the engine\'s own destroy.'
            : 'this build has no Bitmap destroy, so the snapped bitmap is dropped rather than released.';
        if (shot.source === 'canvas') {
            return 'the pixels came from the game canvas element at ' + shot.w + ' × ' + shot.h +
                '; the game\'s own resolution is ' + shot.gameW + ' × ' + shot.gameH + '. ' + release;
        }
        return 'the game\'s own resolution, ' + shot.gameW + ' × ' + shot.gameH + '. ' + release;
    }

    function shotImage(shot) {
        if (!shot.dataUrl) return sub('the bytes for this shot were released; only the path is kept.');
        var img = h('img', { src: shot.dataUrl, style: 'max-width:320px;display:block;border:1px solid var(--mm-line)' });
        return img;
    }

    function revealAvailable() {
        return $.safe(function () {
            return !!($.env.nwjs && typeof nw !== 'undefined' && nw.Shell &&
                typeof nw.Shell.showItemInFolder === 'function' && C.dir());
        }, 'media reveal available', false);
    }
    function reveal(path) {
        if (!path) return false;
        return $.safe(function () { nw.Shell.showItemInFolder(path); return true; }, 'media reveal', false);
    }

    /* =====================================================================
       REGISTRATION
       ===================================================================== */
    U.panel('game', 'Audio', function () { return buildAudio(); }, 80);
    U.panel('game', 'Assets', function () { return buildAssets(); }, 90);
    U.debugPanel('Capture', function () { return buildCapture(); }, 78);

    $.log('ok', 'media ready — ' + (CAP.subfolders() ? 'subfoldered names resolve' : 'subfoldered names do not resolve') +
        ', ' + (CAP.audioErrorCheck() ? 'audio error check wrapped' : 'no audio error check to wrap') +
        ', ' + (CAP.sceneSnap() ? 'scene snapshot available' : 'no scene snapshot'));

})(window.GigaHack);
