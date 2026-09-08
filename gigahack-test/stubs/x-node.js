/* =============================================================================
   An in-memory Node, for the checks that are about WHERE the mod writes.

   Every other stub in this directory models RPG Maker. This one models Node —
   `fs`, `path`, `os` and the two fields of `process` that path resolution
   reads — so that `GigaHack_Core.js`'s real `resolvePaths()` can be run against
   a filesystem a check can watch.

   It exists because of one claim that cannot be tested any other way: nothing
   outside the game folder is read, written, probed or created until the player
   has said yes. The mod's own writability probe CREATES the directory it tests
   (Core.js `isWritable`), so "we did not touch it" is a statement about calls,
   not about outcomes, and the only way to check a statement about calls is to
   record them. `model.touched(prefix)` is that record.

   PROVENANCE. Unlike its neighbours this file models no engine and copies from
   none. What it reproduces is the Node API surface the mod actually calls:

     fs   existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync,
          readdirSync, statSync            (the seven the brief names)
          copyFileSync, renameSync, accessSync, constants.R_OK
                                           (the four Backup, Save and the
                                            settings migration also reach for)
     path sep, join, dirname, basename, extname, resolve, relative
     os   homedir
     proc platform, env, mainModule.filename

   Behaviour follows the real thing where it matters and says so where it does
   not:

     · a missing file throws with `code: 'ENOENT'`, because `store.read` and
       `Hooks.sourceOf` both rely on existence being tested, not caught;
     · `mkdirSync` is recursive whatever the options say, which is how every
       call in the mod uses it;
     · `writeFileSync` stores a binary payload uncoerced. `String(bytes)` turns
       eight PNG bytes into "137,80,78,71,13,10,26,10" — the write succeeds,
       the size looks plausible, and the file is garbage. The harness's other
       filesystem (fixtures.js) has the same rule for the same reason;
     · `readonly` prefixes refuse `mkdirSync` and `writeFileSync` with EACCES,
       which is the only way to reach the degraded-persistence branch;
     · paths are POSIX throughout, including for `platform: 'win32'`. The
       Windows model here is about WHICH directory is chosen (%LOCALAPPDATA%),
       not about how a path is spelled, and pretending to model backslashes
       while joining with '/' would be a worse lie than declaring this one.

   NOT INSTALLED BY DEFAULT. This file publishes exactly one global,
   `window.__nodeModel`, and touches nothing else: no `$.env`, no `$.paths`, no
   `$.caps`. The default harness stays an honest browser build, which several
   checks in run.js assert. A check that wants this hands the model to
   `GigaHack.usePaths(p, model)` and restores in the same check.
   ========================================================================== */
(function () {
    'use strict';

    function enoent(op, p) {
        var e = new Error('ENOENT: no such file or directory, ' + op + " '" + p + "'");
        e.code = 'ENOENT';
        return e;
    }
    function eacces(op, p) {
        var e = new Error('EACCES: permission denied, ' + op + " '" + p + "'");
        e.code = 'EACCES';
        return e;
    }

    /**
     * Build a model.
     *
     *   __nodeModel({
     *     platform: 'darwin' | 'win32' | 'linux',   default 'darwin'
     *     home:     '/Users/p',                     default '/home/p'
     *     mainModule: '/disk/game/index.html',      what process.mainModule says
     *     env:      { LOCALAPPDATA: '...' },        process.env
     *     files:    { '/disk/game/index.html': '<html>' },
     *     dirs:     ['/disk/game/js/plugins'],
     *     readonly: ['/disk/game']                  prefixes that refuse writes
     *   })
     *
     * Returns an object shaped like the one Core's detectEnv() builds —
     * {nwjs, fs, path, os, proc, platform, mac, win, linux} — with the model's
     * own inspection surface hung off it: log(), touched(), reset(), exists(),
     * read(), list(), add(), mkdir(), readonly().
     */
    window.__nodeModel = function (spec) {
        spec = spec || {};

        var files = {};        // absolute path -> contents
        var dirs = {};         // absolute path -> true
        var mtimes = {};       // absolute path -> the tick it was last written
        var readonly = [];     // prefixes that refuse to be written into
        var log = [];          // every call, in order: {op, path}

        var platform = spec.platform || 'darwin';
        var home = spec.home || '/home/p';

        var path = {
            sep: '/',
            join: function () {
                var parts = Array.prototype.slice.call(arguments).filter(function (p) {
                    return p !== undefined && p !== null && p !== '';
                });
                return parts.join('/').replace(/\/+/g, '/').replace(/(.)\/$/, '$1') || '/';
            },
            dirname: function (p) { return String(p).replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'; },
            basename: function (p) { return String(p).replace(/\/+$/, '').split('/').pop(); },
            extname: function (p) { var m = /\.[^./]*$/.exec(String(p)); return m ? m[0] : ''; },
            resolve: function (p) { return String(p).replace(/(.)\/+$/, '$1'); },
            relative: function (from, to) {
                var f = path.resolve(from), t = path.resolve(to);
                if (f === t) return '';
                return t.indexOf(f + '/') === 0 ? t.slice(f.length + 1) : t;
            }
        };

        function note(op, p) { log.push({ op: op, path: String(p) }); }

        function addDir(p) {
            var parts = String(p).split('/'), cur = '', i;
            for (i = 0; i < parts.length; i++) {
                cur = i === 0 ? parts[0] : cur + '/' + parts[i];
                if (cur) dirs[cur] = true;
            }
        }
        /* Modification times advance, and they advance on every write.

           They used to be one constant for every file, which made the model
           silent about the one question a real filesystem is asked here: has
           this file been WRITTEN OVER. A save rewritten in place keeps its
           name, and often its length — a slot overwritten at the same point in
           the game is the ordinary case — so a signal built on names and sizes
           cannot see it, and a model that hands out a fixed mtime cannot see
           the signal failing either. The clock is a counter rather than a real
           one so a run is reproducible and two writes are never in the same
           millisecond, and it starts where the old constant was so nothing
           reading an absolute value has to change. */
        var clock = 1700000000000;
        function addFile(p, contents) {
            p = path.resolve(p);
            addDir(path.dirname(p));
            files[p] = contents;
            mtimes[p] = ++clock;
        }
        function refuses(p) {
            p = path.resolve(p);
            for (var i = 0; i < readonly.length; i++) {
                if (p === readonly[i] || p.indexOf(readonly[i] + '/') === 0) return true;
            }
            return false;
        }

        var fs = {
            constants: { R_OK: 4 },

            existsSync: function (p) {
                p = path.resolve(p);
                note('existsSync', p);
                return files[p] !== undefined || !!dirs[p];
            },
            readFileSync: function (p) {
                p = path.resolve(p);
                note('readFileSync', p);
                if (files[p] === undefined) throw enoent('open', p);
                return files[p];
            },
            /* NOT String(data): a capture writes PNG bytes and coercing a
               Uint8Array to a string produces a file that passes every size
               check and is unreadable. Only genuine strings are coerced, which
               is what the real fs does. */
            writeFileSync: function (p, data) {
                p = path.resolve(p);
                note('writeFileSync', p);
                if (refuses(p)) throw eacces('open', p);
                var binary = data && typeof data === 'object' && typeof data.length === 'number';
                addFile(p, binary ? data : String(data));
            },
            mkdirSync: function (p) {
                p = path.resolve(p);
                note('mkdirSync', p);
                if (refuses(p)) throw eacces('mkdir', p);
                addDir(p);
            },
            unlinkSync: function (p) {
                p = path.resolve(p);
                note('unlinkSync', p);
                if (files[p] === undefined) throw enoent('unlink', p);
                if (refuses(p)) throw eacces('unlink', p);
                delete files[p];
            },
            /* Logged as the two calls it is — a read of the source and a write
               of the destination — so that "was anything under this prefix
               touched" has one shape of answer and not two. */
            copyFileSync: function (a, b) {
                var from = path.resolve(a), to = path.resolve(b);
                note('copyFileSync:read', from);
                note('copyFileSync:write', to);
                if (files[from] === undefined) throw enoent('copyfile', from);
                if (refuses(to)) throw eacces('copyfile', to);
                addFile(to, files[from]);
            },
            renameSync: function (a, b) { fs.copyFileSync(a, b); fs.unlinkSync(a); },
            accessSync: function (p) {
                p = path.resolve(p);
                note('accessSync', p);
                if (files[p] === undefined && !dirs[p]) throw enoent('access', p);
            },
            statSync: function (p) {
                p = path.resolve(p);
                note('statSync', p);
                if (files[p] !== undefined) {
                    return {
                        size: files[p].length, mtimeMs: mtimes[p] || clock,
                        isDirectory: function () { return false; },
                        isFile: function () { return true; }
                    };
                }
                if (dirs[p]) {
                    return {
                        size: 0, mtimeMs: mtimes[p] || clock,
                        isDirectory: function () { return true; },
                        isFile: function () { return false; }
                    };
                }
                throw enoent('stat', p);
            },
            readdirSync: function (p) {
                p = path.resolve(p);
                note('readdirSync', p);
                if (!dirs[p]) throw enoent('scandir', p);
                var out = {}, prefix = p === '/' ? '/' : p + '/';
                Object.keys(files).concat(Object.keys(dirs)).forEach(function (f) {
                    if (f.indexOf(prefix) !== 0) return;
                    var rest = f.slice(prefix.length);
                    if (!rest) return;
                    out[rest.split('/')[0]] = true;
                });
                return Object.keys(out);
            }
        };

        var proc = {
            platform: platform,
            env: spec.env || {},
            mainModule: { filename: spec.mainModule || (home + '/game/index.html') }
        };

        var model = {
            /* The $.env shape, exactly as Core's detectEnv() builds it. */
            nwjs: true,
            fs: fs,
            path: path,
            os: { homedir: function () { return home; } },
            proc: proc,
            platform: platform,
            mac: platform === 'darwin',
            win: platform === 'win32',
            linux: platform === 'linux',

            /* ---- the model's own surface, for assertions ---- */

            /** Every filesystem call this model has seen, in order. */
            log: function () { return log.slice(); },
            /** Only the calls that named a path at or under `prefix`. */
            touched: function (prefix) {
                prefix = path.resolve(prefix);
                return log.filter(function (e) {
                    return e.path === prefix || e.path.indexOf(prefix + '/') === 0;
                });
            },
            /** Forget the calls so far. The disk itself is untouched. */
            reset: function () { log = []; return true; },
            /** Does this path exist, without recording a call. */
            has: function (p) { p = path.resolve(p); return files[p] !== undefined || !!dirs[p]; },
            /** Read without recording a call. */
            peek: function (p) { p = path.resolve(p); return files[p] === undefined ? null : files[p]; },
            /** Every file and directory at or under `prefix`, without recording. */
            list: function (prefix) {
                prefix = path.resolve(prefix);
                return Object.keys(files).concat(Object.keys(dirs)).filter(function (f) {
                    return f === prefix || f.indexOf(prefix + '/') === 0;
                }).sort();
            },
            /** Put a file on the disk without recording a call. */
            add: function (p, contents) { addFile(p, contents === undefined ? 'x' : contents); return model; },
            /** Put a directory on the disk without recording a call. */
            mkdir: function (p) { addDir(path.resolve(p)); return model; },
            /** Refuse writes at or under this prefix. */
            readonly: function (p) { readonly.push(path.resolve(p)); return model; }
        };

        (spec.dirs || []).forEach(function (d) { addDir(path.resolve(d)); });
        Object.keys(spec.files || {}).forEach(function (f) { addFile(f, spec.files[f]); });
        (spec.readonly || []).forEach(function (d) { readonly.push(path.resolve(d)); });

        return model;
    };
})();
