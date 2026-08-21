//=============================================================================
// GigaHack MV/MZ
// 13 · backup.js — automatic save backups
//-----------------------------------------------------------------------------
// THE OPAQUE-BYTES POLICY. A save is copied verbatim with fs.copyFileSync and
// is never parsed. That is not laziness, it is the only correct choice:
// plugins commonly extend DataManager.makeSaveContents, so a save carries
// sections this mod has never heard of, and anything that parsed and
// re-serialised one would silently drop whichever of them it did not know
// about. It is doubly true where a plugin has replaced JsonEx with an encoder
// of its own — a save whose references are written as paths cannot be read by
// plain JSON.parse at all — and the two engines do not even share an on-disk
// encoding. Bytes in, bytes out, no opinions.
//
// THE PATHS ARE ASKED FOR AT CALL TIME, never reconstructed. $.eng.saveDir()
// and $.eng.savePath(id) resolve through StorageManager on every call, and
// $.caps.saveExt gives the extension for this engine. Both engines derive the
// save folder from the running process, and a plugin aliasing that resolution
// to relocate saves elsewhere is common on both — so a module that built
// <gameRoot>/save by hand would back up an empty folder and report success.
//
// THE STOCK .bak SIBLINGS ARE PART OF THE SNAPSHOT. A save can have a sibling
// with the same name plus ".bak" written by the engine's own save pipeline,
// and a failed write can restore from it. A restore that ignored them puts a
// save back and leaves a newer sibling next to it, which then resurrects the
// state the restore was undoing — so they are copied in, restored, and any
// sibling the snapshot does not contain is removed rather than left behind.
//
// Backups are content-addressed by a cheap fingerprint, so "back up before
// every teleport" does not mean "copy 20 files every teleport" — teleporting
// does not write saves, so the second one in a row is a no-op.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — automatic save backups
 * @author gigahack
 * @help GigaHack_Backup.js — requires Core, Caps, Store, UI
 */

(function ($) {
    'use strict';
    if (!$) { console.error('[GigaHack] core missing — backup not installed'); return; }

    var B = $.backup = {};
    var BAK = '.bak';
    var lastFingerprint = null;

    function fs() { return $.env.fs; }
    function pathMod() { return $.env.path; }

    /* The extension is an engine fact, asked for rather than written down.
       Reading it through $.caps at call time also means a harness that sets up
       capabilities after this module loads still gets the right answer. */
    function saveExt() {
        return ($.caps && $.caps.saveExt) || '';
    }

    /* Resolved through StorageManager on EVERY call, never cached and never
       rebuilt from the game root. Both engines compute the folder from the
       running process, and relocating it by aliasing that resolution is common
       on both — a cached or hand-built path would quietly back up nothing. */
    B.saveDir = function () {
        return ($.eng && $.eng.saveDir) ? $.eng.saveDir() : null;
    };

    /** The file the engine would use for a slot: id < 0 config, 0 global, > 0 a slot. */
    B.fileFor = function (id) {
        return ($.eng && $.eng.savePath) ? $.eng.savePath(id) : null;
    };

    B.available = function () {
        return $.paths.mode === 'fs' && !!fs() && !!pathMod() &&
            !!($.caps && $.caps.fs) && !!B.saveDir();
    };

    /**
     * Why not, in the user's terms. Every caller shows this instead of
     * offering a button that would fail: with no filesystem there is nothing a
     * backup could be written to, and saying so once is worth more than a
     * control that throws when pressed.
     */
    B.reason = function () {
        if (!$.caps || !$.eng) {
            return 'the capability layer did not load, so neither the save folder nor the save file ' +
                'extension can be resolved. Backups are off rather than guessed at.';
        }
        if (!$.caps.fs) {
            return $.caps.fsWhy || 'there is no filesystem here, so save backups are unavailable.';
        }
        if (!fs() || !pathMod()) return 'Node\'s fs and path modules are not reachable from this build, ' +
            'so nothing can be copied.';
        if ($.paths.mode !== 'fs') {
            return 'GigaHack\'s own storage is in ' + $.paths.mode + ' mode, so there is no folder to ' +
                'write backups into.';
        }
        if (typeof StorageManager === 'undefined') {
            return 'StorageManager is not available, so the save folder cannot be resolved.';
        }
        if (!B.saveDir()) {
            return 'StorageManager did not return a save directory on this engine, so there is nothing to ' +
                'back up. That is the resolution the game itself uses, so saving is probably broken too.';
        }
        return null;
    };

    B.dir = function () {
        if ($.paths.backupsDir) return $.paths.backupsDir;
        if (!$.paths.dataDir || !pathMod()) return null;
        return pathMod().join($.paths.dataDir, 'backups');
    };

    /**
     * Is this one of the files the snapshot is about?
     *
     * Both the save itself and its stock ".bak" sibling count. Missing the
     * sibling is what makes a restore reversible by accident: the engine can
     * restore from it after a failed write, so a stale one next to a
     * freshly-restored save can put the old state straight back.
     */
    function isSaveName(name) {
        var ext = saveExt();
        if (!ext) return false;
        var n = String(name);
        return n.slice(-ext.length) === ext ||
               n.slice(-(ext.length + BAK.length)) === ext + BAK;
    }
    B.isSaveName = isSaveName;

    /** Save files currently on disk, newest first — siblings included. */
    B.saveFiles = function () {
        return $.safe(function () {
            var dir = B.saveDir();
            if (!dir || !fs().existsSync(dir)) return [];
            return fs().readdirSync(dir)
                .filter(isSaveName)
                .map(function (n) {
                    var st = fs().statSync(pathMod().join(dir, n));
                    return { name: n, size: st.size, mtimeMs: st.mtimeMs };
                })
                .sort(function (a, b) { return b.mtimeMs - a.mtimeMs; });
        }, 'list save files', []) || [];
    };

    /** Cheap identity for the whole save directory. */
    function fingerprint(files) {
        return files.map(function (f) {
            return f.name + ':' + f.size + ':' + Math.round(f.mtimeMs);
        }).sort().join('|');
    }

    function rmDirRecursive(dir) {
        // fs.rmSync needs Node 14.14 and fs.rmdirSync's recursive option is
        // deprecated in newer Node. Doing it by hand works on every Node an
        // engine build of either generation ships with, and a backup folder is
        // one level deep.
        return $.safe(function () {
            if (!fs().existsSync(dir)) return true;
            fs().readdirSync(dir).forEach(function (n) {
                var p = pathMod().join(dir, n);
                if (fs().statSync(p).isDirectory()) rmDirRecursive(p);
                else fs().unlinkSync(p);
            });
            fs().rmdirSync(dir);
            return true;
        }, 'remove ' + dir, false);
    }

    /**
     * Take a backup. Returns
     *   { created:true, entry }        a new snapshot was written
     *   { created:false, skipped:'unchanged' | 'disabled' | 'unavailable' | 'empty' }
     */
    B.make = function (reason, force) {
        if (!B.available()) return { created: false, skipped: 'unavailable', why: B.reason() };
        if (!saveExt()) {
            return {
                created: false, skipped: 'unavailable',
                why: 'the engine could not be identified, so GigaHack does not know what a save file is ' +
                     'called here and will not guess at which files to copy.'
            };
        }

        var files = B.saveFiles();
        if (!files.length) return { created: false, skipped: 'empty' };

        var fp = fingerprint(files);
        if (!force && fp === lastFingerprint) {
            return { created: false, skipped: 'unchanged' };
        }
        // A previous run's newest backup counts too, so a fresh launch that
        // changes nothing does not immediately make a duplicate.
        if (!force && lastFingerprint === null) {
            var newest = B.list()[0];
            if (newest && newest.fingerprint === fp) {
                lastFingerprint = fp;
                return { created: false, skipped: 'unchanged' };
            }
        }

        return $.safe(function () {
            var root = B.dir();
            var stamp = $.stamp();
            var slug = String(reason || 'manual').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
            // $.stamp() has second resolution, so two backups inside the same
            // second would land in the same folder and the second would
            // overwrite the first. Suffix until the name is free.
            var base = pathMod().join(root, stamp + '_' + (slug || 'manual'));
            var dir = base, n = 1;
            while (fs().existsSync(dir) && n < 100) { n++; dir = base + '-' + n; }
            fs().mkdirSync(dir, { recursive: true });

            var srcDir = B.saveDir(), copied = [];
            files.forEach(function (f) {
                fs().copyFileSync(pathMod().join(srcDir, f.name), pathMod().join(dir, f.name));
                copied.push(f.name);
            });

            var meta = {
                at: new Date().toISOString(),
                reason: reason || 'manual',
                files: copied,
                fingerprint: fp,
                gigahack: $.version,
                // Recorded, not relied on: a snapshot taken from a relocated
                // save folder should say where it came from, and a restore
                // still resolves the destination fresh.
                savedFrom: srcDir,
                engine: ($.caps && $.caps.engine) || 'unknown',
                ext: saveExt()
            };
            fs().writeFileSync(pathMod().join(dir, 'gigahack-backup.json'), JSON.stringify(meta, null, 2), 'utf8');

            lastFingerprint = fp;
            $.log('ok', 'save backup (' + meta.reason + '): ' + copied.length + ' file(s) → ' + dir);
            B.prune();
            return { created: true, entry: B.describe(dir, meta) };
        }, 'backup', { created: false, skipped: 'error' });
    };

    B.describe = function (dir, meta) {
        return {
            dir: dir,
            name: pathMod().basename(dir),
            at: meta.at, reason: meta.reason,
            files: meta.files || [],
            fingerprint: meta.fingerprint || ''
        };
    };

    /** Newest first. */
    B.list = function () {
        return $.safe(function () {
            var root = B.dir();
            if (!root || !fs().existsSync(root)) return [];
            return fs().readdirSync(root).map(function (n) {
                var dir = pathMod().join(root, n);
                if (!fs().statSync(dir).isDirectory()) return null;
                var metaFile = pathMod().join(dir, 'gigahack-backup.json');
                var meta = fs().existsSync(metaFile)
                    ? JSON.parse(fs().readFileSync(metaFile, 'utf8'))
                    : { at: '', reason: 'unknown', files: [] };
                return B.describe(dir, meta);
            }).filter(Boolean).sort(function (a, b) { return a.name < b.name ? 1 : -1; });
        }, 'list backups', []) || [];
    };

    B.prune = function (keep) {
        keep = keep || $.store.cfgGet('behaviour.backupKeep', 20);
        return $.safe(function () {
            var all = B.list();
            if (all.length <= keep) return 0;
            var doomed = all.slice(keep);
            doomed.forEach(function (e) { rmDirRecursive(e.dir); });
            $.log('info', 'pruned ' + doomed.length + ' old backup(s), keeping ' + keep);
            return doomed.length;
        }, 'prune backups', 0);
    };

    /**
     * Copy a backup's files back over the live saves. Takes a safety backup of
     * the current state first, so restoring is itself recoverable.
     */
    B.restore = function (entry) {
        if (!B.available()) {
            $.log('warn', 'restore unavailable — ' + B.reason());
            return false;
        }
        if (!$.allowWrite('Restoring a save backup')) return false;
        return $.safe(function () {
            B.make('pre-restore', true);
            // Resolved again here rather than taken from the snapshot: the
            // folder may have moved since it was written, and the live one is
            // the one the game will read.
            var dstDir = B.saveDir();
            fs().mkdirSync(dstDir, { recursive: true });
            var names = entry.files || [];
            var n = 0;
            names.forEach(function (name) {
                var src = pathMod().join(entry.dir, name);
                if (!fs().existsSync(src)) return;
                fs().copyFileSync(src, pathMod().join(dstDir, name));
                n++;
            });

            /* Any ".bak" sibling in the live folder that this snapshot did not
               carry was written AFTER it. Left in place, the engine can restore
               from it the next time a save write fails and put back exactly the
               state this restore was undoing — so it goes. */
            var stale = 0;
            $.safe(function () {
                fs().readdirSync(dstDir).forEach(function (name) {
                    if (String(name).slice(-BAK.length) !== BAK) return;
                    if (!isSaveName(name)) return;
                    if (names.indexOf(name) > -1) return;
                    $.safe(function () {
                        fs().unlinkSync(pathMod().join(dstDir, name));
                        stale++;
                    }, 'remove stale sibling ' + name);
                });
            }, 'scan for stale siblings');

            lastFingerprint = null;   // the directory just changed under us
            $.log('warn', 'restored ' + n + ' save file(s) from ' + entry.name + ' → ' + dstDir +
                (stale ? '; removed ' + stale + ' newer .bak sibling(s) that could have undone it' : ''));
            return n;
        }, 'restore backup', false);
    };

    /**
     * The gate every dangerous action calls. Honours
     * behaviour.backupBeforeDanger and never blocks the action — a backup that
     * cannot be taken is reported, not fatal.
     */
    B.guard = function (reason) {
        if (!$.store.cfgGet('behaviour.backupBeforeDanger', true)) {
            return { created: false, skipped: 'disabled' };
        }
        var r = B.make(reason);
        if (r.skipped === 'unavailable') {
            $.log('warn', 'no save backup before "' + reason + '" — ' + (r.why || 'unavailable'));
        }
        return r;
    };

    if (B.available()) {
        $.log('ok', 'backups ready → ' + B.dir() + ' (saves: ' + B.saveDir() + ', ' + saveExt() +
            ' plus any ' + saveExt() + BAK + ' siblings)');
    } else {
        // Loudly, and once: every caller checks available() and shows reason(),
        // so no button is offered that would fail.
        $.log('warn', 'save backups are unavailable — ' + B.reason());
    }

})(window.GigaHack);
