#!/usr/bin/env node
/*
 * GigaHack MV/MZ — live verification against a real installed game.
 *
 * Runs on the machine the game is installed on, with node and nothing else.
 * It loads the REAL engine core, the REAL plugins.js, and the REAL data files
 * of an installed game, then loads GigaHack's own modules on top and reports
 * what the mod concluded about that game.
 *
 * This is deliberately NOT the browser harness. The harness proves the mod is
 * internally consistent against faithful stubs; this proves the mod agrees
 * with a specific game's actual files. When the two disagree, the harness is
 * the thing to suspect first.
 *
 * Usage:  node verify-live.js <game folder> [<game folder> ...]
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var roots = process.argv.slice(2);
if (!roots.length) {
    console.error('usage: node verify-live.js <game folder> [...]');
    console.error('the game folder is the one holding index.html next to js/');
    process.exit(1);
}

/* -------------------------------------------------------------------------
   A DOM shim just large enough for the modules to load.

   It is deliberately thin. Anything the mod needs that is missing shows up as
   a load failure with a stack, which is the answer we want — a shim that
   politely absorbs everything would report success against a mod that cannot
   run.
   ---------------------------------------------------------------------- */
function makeElement(tag) {
    var el = {
        tagName: String(tag || 'div').toUpperCase(),
        /* A plain object is not enough: the overlay sets custom properties
           through style.setProperty, and without it the mount throws and the
           report says "GigaHack is inert" — which is the shim's fault, not
           the mod's, and reads identically to a real failure. */
        style: {
            setProperty: function (k, v) { this[k] = v; },
            getPropertyValue: function (k) { return this[k] === undefined ? '' : String(this[k]); },
            removeProperty: function (k) { var v = this[k]; delete this[k]; return v; },
            cssText: ''
        },
        dataset: {}, children: [], childNodes: [],
        classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
        attributes: {},
        appendChild: function (c) { this.children.push(c); this.childNodes.push(c); c.parentNode = this; return c; },
        insertBefore: function (c) { return this.appendChild(c); },
        removeChild: function (c) { var i = this.children.indexOf(c); if (i > -1) { this.children.splice(i, 1); this.childNodes.splice(i, 1); } return c; },
        remove: function () { if (this.parentNode) this.parentNode.removeChild(this); },
        setAttribute: function (k, v) { this.attributes[k] = String(v); if (k === 'style') this.style.cssText = String(v); },
        getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
        removeAttribute: function (k) { delete this.attributes[k]; },
        addEventListener: function () {}, removeEventListener: function () {},
        querySelector: function () { return null; }, querySelectorAll: function () { return []; },
        getBoundingClientRect: function () { return { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }; },
        focus: function () {}, blur: function () {}, click: function () {},
        /* A canvas with no getContext makes the engine throw partway through
           its own manager file, and half its classes then never exist — which
           reads as "the mod could not hook them" rather than "the shim is
           thin". Enough of a 2D context that construction succeeds. */
        getContext: function () {
            return {
                fillRect: function () {}, clearRect: function () {}, strokeRect: function () {},
                drawImage: function () {}, fillText: function () {}, strokeText: function () {},
                measureText: function () { return { width: 0 }; },
                save: function () {}, restore: function () {}, translate: function () {},
                scale: function () {}, rotate: function () {}, transform: function () {},
                setTransform: function () {}, beginPath: function () {}, closePath: function () {},
                moveTo: function () {}, lineTo: function () {}, arc: function () {},
                rect: function () {}, fill: function () {}, stroke: function () {}, clip: function () {},
                createLinearGradient: function () { return { addColorStop: function () {} }; },
                createRadialGradient: function () { return { addColorStop: function () {} }; },
                getImageData: function () { return { data: [0, 0, 0, 0] }; },
                putImageData: function () {}, createImageData: function () { return { data: [] }; },
                globalAlpha: 1, globalCompositeOperation: 'source-over',
                fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: 'left',
                textBaseline: 'alphabetic', shadowBlur: 0, shadowColor: '', imageSmoothingEnabled: true
            };
        },
        toDataURL: function () { return 'data:,'; },
        width: 816, height: 624,
        scrollIntoView: function () {},
        innerHTML: '', textContent: '', value: '',
        scrollTop: 0, scrollLeft: 0, scrollHeight: 600, scrollWidth: 800,
        offsetWidth: 800, offsetHeight: 600, clientWidth: 800, clientHeight: 600
    };
    return el;
}

function buildSandbox(gameRoot, selfUrl) {
    var byId = {};
    var doc = {
        readyState: 'complete',
        head: makeElement('head'),
        body: makeElement('body'),
        documentElement: makeElement('html'),
        currentScript: { src: selfUrl },
        createElement: makeElement,
        createElementNS: function (ns, tag) { return makeElement(tag); },
        createTextNode: function (t) { return { nodeType: 3, textContent: String(t) }; },
        createDocumentFragment: function () { return makeElement('fragment'); },
        getElementById: function (id) { return byId[id] || null; },
        getElementsByTagName: function () { return []; },
        querySelector: function () { return null; },
        querySelectorAll: function () { return []; },
        addEventListener: function () {}, removeEventListener: function () {},
        hasFocus: function () { return true; }
    };

    var storage = {};
    var sandbox = {
        console: console,
        document: doc,
        navigator: { userAgent: 'Mozilla/5.0 (verify-live) Chrome/66.0.0.0 Safari/537.36', language: 'en' },
        location: { href: 'file://' + gameRoot + '/index.html', search: '', protocol: 'file:' },
        localStorage: {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
            setItem: function (k, v) { storage[k] = String(v); },
            removeItem: function (k) { delete storage[k]; },
            clear: function () { storage = {}; }
        },
        setTimeout: setTimeout, clearTimeout: clearTimeout,
        setInterval: setInterval, clearInterval: clearInterval,
        requestAnimationFrame: function (fn) { return setTimeout(function () { fn(Date.now()); }, 16); },
        cancelAnimationFrame: clearTimeout,
        CSS: { supports: function () { return false; } },   // the Chromium 66 floor: nothing modern
        performance: { now: function () { return Date.now(); } },
        alert: function () {}, prompt: function () { return null; }, confirm: function () { return false; },
        require: require, process: process, Buffer: Buffer,
        __dirname: gameRoot,
        /* Deliberately NOT passing the host's String, Array, Object and so
           on. vm.createContext gives the context its own realm with its own
           prototypes; handing in the host's means the engine defines
           String.prototype.format on the HOST prototype while every string
           literal created inside the vm uses the context's. The symptom is
           `"file%1".format is not a function` from deep inside the save path,
           which reads as a mod bug and is not one. */
        encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    /* Modules that bind hotkeys or watch the page add listeners on `window`
       itself. Without these three the module throws on load and reports as a
       load failure, which reads as a mod bug rather than a shim gap. */
    sandbox.addEventListener = function () {};
    sandbox.removeEventListener = function () {};
    sandbox.dispatchEvent = function () { return true; };
    sandbox.getComputedStyle = function () {
        return { getPropertyValue: function () { return ''; } };
    };
    sandbox.innerWidth = 816;
    sandbox.innerHeight = 624;
    sandbox.devicePixelRatio = 1;
    return sandbox;
}

/* -------------------------------------------------------------------------
   Load a game
   ---------------------------------------------------------------------- */
function detect(root) {
    if (fs.existsSync(path.join(root, 'js', 'rmmz_core.js'))) return 'MZ';
    if (fs.existsSync(path.join(root, 'js', 'rpg_core.js'))) return 'MV';
    return null;
}

function readJSON(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function verify(root) {
    var out = { root: root, ok: false, notes: [], errors: [] };
    var engine = detect(root);
    if (!engine) { out.errors.push('no js/rpg_core.js or js/rmmz_core.js — not an MV or MZ game'); return out; }
    out.engine = engine;

    var dataDir = fs.existsSync(path.join(root, 'data')) ? path.join(root, 'data') : path.join(root, 'www', 'data');
    var jsDir = path.join(root, 'js');
    var selfUrl = 'file://' + path.join(jsDir, 'plugins', 'GigaHack_Core.js');
    var sb = buildSandbox(root, selfUrl);
    var ctx = vm.createContext(sb);

    /* ---------------------------------------------------------------
       Load the game's REAL engine.

       This is the difference between "the 26 modules parse" and "the mod
       works on this game". With the real engine source files in the sandbox,
       every $.install target is the actual method the game will run, so a
       hook that reports installed here really would install, and one that
       reports skipped really is absent on this build.

       The engine files need a PIXI object at load time and never one that
       does anything, because nothing is rendered. A stub is enough — and
       when it is not, the file throws and we say which one, rather than
       reporting a clean run against an engine that was never there.
       -------------------------------------------------------------- */
    /* Every PIXI symbol both engines reference, stubbed. The list was taken
       from the engine sources rather than guessed — `grep -o "PIXI\.[A-Za-z]*"`
       over rmmz_*.js and rpg_*.js — because a missing one does not fail
       politely: the engine file throws partway through and half its classes
       never exist, which then reads as "the mod could not hook them". */
    var PIXI_CLASSES = ['DisplayObject', 'Container', 'Sprite', 'Graphics', 'Text',
        'Texture', 'BaseTexture', 'RenderTexture', 'BaseRenderTexture', 'Rectangle',
        'Point', 'ObservablePoint', 'Matrix', 'Transform', 'TransformStatic',
        'Filter', 'Shader', 'Program', 'Geometry', 'Buffer', 'State',
        'ObjectRenderer', 'Renderer', 'CanvasRenderer', 'WebGLRenderer',
        'Application', 'Ticker', 'TilingSprite'];
    vm.runInContext(
        'var PIXI = { VERSION: ' + JSON.stringify(engine === 'MZ' ? '5.3.12' : '4.5.4') + ' };' +
        PIXI_CLASSES.map(function (c) {
            return 'PIXI.' + c + ' = function () {}; PIXI.' + c + '.prototype = {' +
                   ' destroy: function () {}, updateTransform: function () {},' +
                   ' addChild: function (c) { return c; }, removeChild: function (c) { return c; },' +
                   ' render: function () {}, flush: function () {}, initialize: function () {} };';
        }).join('') +
        'PIXI.Container.prototype = Object.create(PIXI.DisplayObject.prototype);' +
        'PIXI.Sprite.prototype = Object.create(PIXI.Container.prototype);' +
        'PIXI.Graphics.prototype = Object.create(PIXI.Container.prototype);' +
        'PIXI.TilingSprite.prototype = Object.create(PIXI.Sprite.prototype);' +
        'PIXI.Text.prototype = Object.create(PIXI.Sprite.prototype);' +
        'PIXI.Texture.from = function () { return new PIXI.Texture(); };' +
        'PIXI.BaseTexture.from = function () { return new PIXI.BaseTexture(); };' +
        'PIXI.RenderTexture.create = function () { return new PIXI.RenderTexture(); };' +
        'PIXI.settings = { SCALE_MODE: 0, GC_MODE: 0, PRECISION_FRAGMENT: "mediump",' +
        '                  RESOLUTION: 1, ROUND_PIXELS: false, MIPMAP_TEXTURES: 0,' +
        '                  FILTER_RESOLUTION: 1, SPRITE_MAX_TEXTURES: 16 };' +
        'PIXI.SCALE_MODES = { NEAREST: 0, LINEAR: 1 };' +
        'PIXI.SCALE = PIXI.SCALE_MODES;' +
        'PIXI.GC_MODES = { AUTO: 0, MANUAL: 1 }; PIXI.GC = PIXI.GC_MODES;' +
        'PIXI.MIPMAP_MODES = { OFF: 0, POW2: 1 };' +
        'PIXI.PRECISION = { LOW: "lowp", MEDIUM: "mediump", HIGH: "highp" };' +
        'PIXI.BLEND_MODES = { NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3 };' +
        'PIXI.BLEND = PIXI.BLEND_MODES; PIXI.blendModes = PIXI.BLEND_MODES;' +
        'PIXI.RENDERER_TYPE = { UNKNOWN: 0, WEBGL: 1, CANVAS: 2 }; PIXI.RENDERER = PIXI.RENDERER_TYPE;' +
        'PIXI.TYPES = { UNSIGNED_BYTE: 5121, FLOAT: 5126 };' +
        'PIXI.DRAW_MODES = { TRIANGLES: 4, TRIANGLE_STRIP: 5 };' +
        'PIXI.utils = { skipHello: function () {}, sayHello: function () {},' +
        '               TextureCache: {}, BaseTextureCache: {},' +
        '               clearTextureCache: function () {}, destroyTextureCache: function () {},' +
        '               isWebGLSupported: function () { return false; },' +
        '               premultiplyTint: function () { return 0; },' +
        '               rgb2hex: function () { return 0; }, hex2rgb: function () { return [0,0,0]; } };' +
        'PIXI.dontSayHello = true;' +
        'PIXI.filters = { VoidFilter: function () {}, AlphaFilter: function () {},' +
        '                 BlurFilter: function () {}, ColorMatrixFilter: function () {} };' +
        'PIXI.extras = { PictureSprite: function () {}, PictureTilingSprite: function () {},' +
        '                TilingSprite: function () {}, AnimatedSprite: function () {} };' +
        'PIXI.extras.PictureSprite.prototype = Object.create(PIXI.Sprite.prototype);' +
        'PIXI.extras.TilingSprite.prototype = Object.create(PIXI.Sprite.prototype);' +
        'PIXI.extras.PictureTilingSprite.prototype = Object.create(PIXI.extras.TilingSprite.prototype);' +
        'PIXI.filters.ColorMatrixFilter.prototype = Object.create(PIXI.Filter.prototype);' +
        'PIXI.filters.VoidFilter.prototype = Object.create(PIXI.Filter.prototype);' +
        'PIXI.particles = {}; PIXI.loaders = {};' +
        'PIXI.glCore = { GLTexture: function () {}, VertexArrayObject: function () {},' +
        '                GLBuffer: function () {}, GLShader: function () {} };' +
        'PIXI.glCore.GLTexture.prototype = { upload: function () {}, bind: function () {} };' +
        'PIXI.tilemap = { Constant: {}, TileRenderer: function () {}, CompositeRectTileLayer: function () {},' +
        '                 RectTileLayer: function () {} };' +
        'PIXI.autoDetectRenderer = function () { return { plugins: {}, gl: null, view: null,' +
        '    render: function () {}, resize: function () {}, destroy: function () {} }; };' +
        'PIXI.Renderer.registerPlugin = function () {};' +
        'PIXI.CanvasRenderer.registerPlugin = function () {};' +
        'PIXI.WebGLRenderer.registerPlugin = function () {};' +
        'PIXI.Application.registerPlugin = function () {};' +
        'PIXI.Ticker.shared = { add: function () {}, remove: function () {}, start: function () {}, stop: function () {} };' +
        'var Effekseer = { initRuntime: function (a, b) { if (b) b(); } }; var effekseer = Effekseer;' +
        'var LZString = { compressToBase64: function (s) { return s; },' +
        '                 decompressFromBase64: function (s) { return s; } };' +
        'var nw = { App: { argv: [], dataPath: ' + JSON.stringify(path.join(root, 'save')) + ' } };',
        ctx);

    var ENGINE_FILES = engine === 'MZ'
        ? ['rmmz_core.js', 'rmmz_managers.js', 'rmmz_objects.js', 'rmmz_scenes.js', 'rmmz_sprites.js', 'rmmz_windows.js']
        : ['rpg_core.js', 'rpg_managers.js', 'rpg_objects.js', 'rpg_scenes.js', 'rpg_sprites.js', 'rpg_windows.js'];

    out.engineLoaded = [];
    out.engineFailed = [];
    ENGINE_FILES.forEach(function (f) {
        var fp = path.join(jsDir, f);
        if (!fs.existsSync(fp)) { out.engineFailed.push(f + ': missing'); return; }
        try {
            vm.runInContext(fs.readFileSync(fp, 'utf8'), ctx, { filename: fp });
            out.engineLoaded.push(f);
        } catch (e) {
            out.engineFailed.push(f + ': ' + e.message);
        }
    });

    /* Utils.isNwjs must answer true or the mod concludes it is in a browser
       and disables everything that touches the filesystem. The real engine
       decides this from the presence of `process`, which the sandbox has, but
       pin it so the answer does not depend on how node was started. */
    vm.runInContext(
        'if (typeof Utils === "undefined") { Utils = {}; }' +
        'Utils.isNwjs = function () { return true; };' +
        'Utils.isOptionValid = function () { return false; };' +
        'Utils.isMobileDevice = function () { return false; };', ctx);

    /* If the engine did not load at all, fall back to the Utils values read
       out of the core file, so the capability table still has an engine name
       and the report says what happened rather than reporting "unknown". */
    if (!out.engineLoaded.length) {
        var coreSrc = fs.readFileSync(path.join(jsDir, engine === 'MZ' ? 'rmmz_core.js' : 'rpg_core.js'), 'utf8');
        var nameM = /RPGMAKER_NAME\s*=\s*["']([^"']+)["']/.exec(coreSrc);
        var verM  = /RPGMAKER_VERSION\s*=\s*["']([^"']+)["']/.exec(coreSrc);
        vm.runInContext(
            'Utils.RPGMAKER_NAME = ' + JSON.stringify(nameM ? nameM[1] : engine) + ';' +
            'Utils.RPGMAKER_VERSION = ' + JSON.stringify(verM ? verM[1] : 'unknown') + ';', ctx);
    }

    /* The game's real plugin list. */
    var pluginsSrc = fs.readFileSync(path.join(jsDir, 'plugins.js'), 'utf8');
    try { vm.runInContext(pluginsSrc, ctx); }
    catch (e) { out.errors.push('js/plugins.js does not parse: ' + e.message); return out; }
    out.pluginCount = sb.$plugins ? sb.$plugins.length : 0;
    out.pluginsEnabled = sb.$plugins ? sb.$plugins.filter(function (p) { return p && p.status; }).length : 0;
    out.holes = sb.$plugins ? sb.$plugins.filter(function (p) { return !p || !p.name; }).length : 0;

    /* A PluginManager faithful to this engine's dedup rule, because that rule
       is the whole reason a module can be listed, present, readable and still
       silently absent. MZ dedups on the basename; MV on the full entry.
       Only needed when the real engine did not load. */
    if (!out.engineLoaded.length) vm.runInContext(
        'var PluginManager = { _scripts: [], _errorUrls: [], _parameters: {},' +
        '  setParameters: function (n, p) { this._parameters[String(n).toLowerCase()] = p; },' +
        '  parameters: function (n) { return this._parameters[String(n).toLowerCase()] || {}; },' +
        '  key: function (n) { return ' + (engine === 'MZ' ? 'String(n).split("/").pop()' : 'String(n)') + '; },' +
        '  setup: function (list) { for (var i = 0; i < list.length; i++) { var p = list[i];' +
        '    if (!p || !p.status) continue; var k = this.key(p.name);' +
        '    if (this._scripts.indexOf(k) >= 0) continue;' +
        '    this.setParameters(k, p.parameters); this._scripts.push(k); } } };', ctx);

    /* The game's real data. Enough for the profile and the index to have
       something true to say. */
    var sys = readJSON(path.join(dataDir, 'System.json'), null);
    if (!sys) { out.errors.push('could not read data/System.json'); return out; }
    var files = [
        ['$dataSystem', sys],
        ['$dataItems', readJSON(path.join(dataDir, 'Items.json'), [])],
        ['$dataWeapons', readJSON(path.join(dataDir, 'Weapons.json'), [])],
        ['$dataArmors', readJSON(path.join(dataDir, 'Armors.json'), [])],
        ['$dataSkills', readJSON(path.join(dataDir, 'Skills.json'), [])],
        ['$dataStates', readJSON(path.join(dataDir, 'States.json'), [])],
        ['$dataActors', readJSON(path.join(dataDir, 'Actors.json'), [])],
        ['$dataClasses', readJSON(path.join(dataDir, 'Classes.json'), [])],
        ['$dataEnemies', readJSON(path.join(dataDir, 'Enemies.json'), [])],
        ['$dataTroops', readJSON(path.join(dataDir, 'Troops.json'), [])],
        ['$dataCommonEvents', readJSON(path.join(dataDir, 'CommonEvents.json'), [])],
        ['$dataMapInfos', readJSON(path.join(dataDir, 'MapInfos.json'), [])]
    ];
    files.forEach(function (pair) {
        sb[pair[0]] = pair[1];
    });
    if (!out.engineLoaded.length) {
        vm.runInContext('var DataManager = { onLoad: function () {} };', ctx);
        vm.runInContext('var Input = { keyMapper: {} };', ctx);
    }

    /* Load GigaHack, in manifest order, exactly as PluginManager would. */
    var manifest = readJSON(path.join(root, 'gigahack-manifest.json'), null);
    var mods;
    if (manifest && manifest.modules) {
        mods = manifest.modules.map(function (m) { return m.name; });
    } else {
        // Fall back to the order recorded in plugins.js, which the installer
        // wrote. Never alphabetical: that loads Boot before Core.
        mods = (sb.$plugins || []).filter(function (p) { return p && /^GigaHack_/.test(p.name); })
                                  .map(function (p) { return p.name; });
    }
    out.modulesListed = mods.length;

    var loaded = 0, failed = [];
    mods.forEach(function (m) {
        var f = path.join(jsDir, 'plugins', m + '.js');
        if (!fs.existsSync(f)) { failed.push(m + ': file missing'); return; }
        var src;
        try { src = fs.readFileSync(f, 'utf8'); }
        catch (e) {
            // The failure with no symptom: an existence check needs only
            // directory permission, so presence and size report fine while
            // every read fails and the module silently is not there.
            failed.push(m + ': present but NOT READABLE (' + e.code + ')');
            return;
        }
        sb.document.currentScript = { src: 'file://' + f };
        try { vm.runInContext(src, ctx, { filename: f }); loaded++; }
        catch (e) { failed.push(m + ': threw on load — ' + e.message); }
    });
    out.modulesLoaded = loaded;
    out.modulesFailed = failed;

    var G = sb.GigaHack;
    if (!G) { out.errors.push('window.GigaHack was never created — Core did not run'); return out; }

    out.version = G.version;
    out.caps = G.caps ? {
        engine: G.caps.engine, version: G.caps.engineVersion,
        colorManager: G.caps.colorManager, spriteGauge: G.caps.spriteGauge,
        saveExt: G.caps.saveExt, updateMainIsReentrant: G.caps.updateMainIsReentrant,
        canvasId: G.caps.canvasId, tileEventsKey: G.caps.tileEventsKey,
        cssGap: G.caps.cssGap, cssClamp: G.caps.cssClamp
    } : null;

    if (G.profile) {
        var p = null;
        try { p = G.profile.resolve(true); } catch (e) { out.errors.push('profile.resolve threw: ' + e.message); }
        if (p) {
            out.profile = {
                id: p.id, name: p.name, generic: p.generic,
                sectionPattern: p.sectionPattern ? String(p.sectionPattern) : null,
                forgeBase: p.forgeBase,
                counts: p.counts
            };
            // The bug this exists to catch: a matched profile that omits
            // sectionPattern once produced {} — truthy, no .test — and every
            // caller threw.
            try { G.profile.isSectionHeader('-- Test'); out.notes.push('isSectionHeader is callable'); }
            catch (e) { out.errors.push('isSectionHeader threw: ' + e.message); }
        }
    }

    if (G.compat) {
        try {
            var lo = G.compat.loadOrder();
            out.loadOrder = { known: lo.known, last: lo.last, after: lo.after.length, why: lo.why };
        } catch (e) { out.errors.push('compat.loadOrder threw: ' + e.message); }
        try {
            out.frameworks = G.compat.frameworks().map(function (f) {
                return { name: f.name, plugins: f.plugins.length, affects: f.affects };
            });
        } catch (e) { out.errors.push('compat.frameworks threw: ' + e.message); }
    }

    out.hooks = G.hookList ? {
        total: G.hookList().length,
        installed: G.hookList().filter(function (h) { return h.installed; }).length,
        skipped: G.hookList().filter(function (h) { return !h.installed; })
                              .map(function (h) { return h.name + ' — ' + h.reason; })
    } : null;

    out.log = G.logHistory ? G.logHistory().filter(function (e) { return e.level === 'err'; })
                                           .map(function (e) { return e.msg; }) : [];

    out.ok = out.errors.length === 0 && loaded === mods.length && out.holes === 0;
    return out;
}

/* -------------------------------------------------------------------------
   Report
   ---------------------------------------------------------------------- */
var allOk = true;
roots.forEach(function (root) {
    var r = verify(path.resolve(root));
    console.log('');
    console.log('=========================================================');
    console.log(r.root);
    console.log('=========================================================');
    if (r.errors.length) { r.errors.forEach(function (e) { console.log('  ERROR  ' + e); }); }
    console.log('  engine              ' + (r.caps ? r.caps.engine + ' ' + r.caps.version : r.engine || '?'));
    console.log('  GigaHack            ' + (r.version || 'did not load'));
    console.log('  plugins.js          ' + r.pluginCount + ' entries, ' + r.pluginsEnabled +
                ' enabled, ' + r.holes + ' holes');
    if (r.engineLoaded) {
        console.log('  engine files        ' + r.engineLoaded.length + '/' +
                    (r.engineLoaded.length + r.engineFailed.length) + ' loaded' +
                    (r.engineLoaded.length ? '' : '  (running against a shim, so hook counts are not meaningful)'));
        (r.engineFailed || []).forEach(function (f) { console.log('    engine FAILED  ' + f); });
    }
    console.log('  modules             ' + r.modulesLoaded + '/' + r.modulesListed + ' loaded');
    (r.modulesFailed || []).forEach(function (f) { console.log('    FAILED  ' + f); });
    if (r.caps) {
        console.log('  capabilities        ColorManager=' + r.caps.colorManager +
                    ' Sprite_Gauge=' + r.caps.spriteGauge +
                    ' saveExt=' + r.caps.saveExt);
        console.log('                      updateMain re-entrant=' + r.caps.updateMainIsReentrant +
                    ' canvas=' + r.caps.canvasId + ' tileEvents=' + r.caps.tileEventsKey);
    }
    if (r.profile) {
        console.log('  profile             ' + r.profile.id + ' (' + r.profile.name + ')' +
                    (r.profile.generic ? ' [computed defaults]' : ''));
        console.log('  section headers     ' + (r.profile.sectionPattern || 'this game uses no convention'));
        console.log('  forge id bases      item=' + r.profile.forgeBase.item +
                    ' skill=' + r.profile.forgeBase.skill +
                    ' state=' + r.profile.forgeBase.state);
        console.log('  database            ' + r.profile.counts.items + ' items, ' +
                    r.profile.counts.skills + ' skills, ' + r.profile.counts.maps + ' maps, ' +
                    r.profile.counts.variables + ' variables, ' + r.profile.counts.switches + ' switches');
    }
    if (r.loadOrder) {
        console.log('  load order          ' + (r.loadOrder.last ? 'GigaHack is last' :
                    r.loadOrder.after + ' plugin(s) load after it'));
    }
    if (r.frameworks && r.frameworks.length) {
        console.log('  recognised plugins  ');
        r.frameworks.forEach(function (f) {
            console.log('                      ' + f.name + ' (' + f.plugins + ' file(s))' +
                        (f.affects.length ? ' affects: ' + f.affects.join(', ') : ''));
        });
    }
    if (r.hooks) {
        console.log('  hooks               ' + r.hooks.installed + '/' + r.hooks.total + ' installed');
        r.hooks.skipped.forEach(function (s) { console.log('    skipped  ' + s); });
    }
    if (r.log && r.log.length) {
        console.log('  errors logged       ' + r.log.length);
        r.log.slice(0, 10).forEach(function (m) { console.log('    ' + m); });
    }
    console.log('');
    console.log('  ' + (r.ok ? 'OK' : 'PROBLEMS FOUND'));
    if (!r.ok) allOk = false;
});

console.log('');
process.exit(allOk ? 0 : 1);
