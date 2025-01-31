import url from 'url';
import fs from 'fs';
import mime from '@paulcbetts/mime-types';
import LRU from 'lru-cache';

const magicWords = "__magic__file__to__help__electron__compile.js";

// NB: These are duped in initialize-renderer so we can save startup time, make
// sure to run both!
const magicGlobalForRootCacheDir = '__electron_compile_root_cache_dir';
const magicGlobalForAppRootDir = '__electron_compile_app_root_dir';

const d = require('debug')('@lanethegreat/electron-compile:protocol-hook');

let protocol = null;

const mapStatCache = new LRU({length: 512});
function doesMapFileExist(filePath) {
  let ret = mapStatCache.get(filePath);
  if (ret !== undefined) return Promise.resolve(ret);

  return new Promise((res) => {
    fs.lstat(filePath, (err, s) => {
      let failed = (err || !s);

      mapStatCache.set(filePath, !failed);
      res(!failed);
    });
  });
}

/**
 * Adds our script header to the top of all HTML files
 *
 * @private
 */
export function rigHtmlDocumentToInitializeElectronCompile(doc) {
  let lines = doc.split("\n");
  let replacement = `<head><script src="${magicWords}"></script>`;
  let replacedHead = false;

  for (let i=0; i < lines.length; i++) {
    if (!lines[i].match(/<head>/i)) continue;

    lines[i] = (lines[i]).replace(/<head>/i, replacement);
    replacedHead = true;
    break;
  }

  if (!replacedHead) {
    replacement = `<html$1><head><script src="${magicWords}"></script></head>`;
    for (let i=0; i < lines.length; i++) {
      if (!lines[i].match(/<html/i)) continue;

      lines[i] = (lines[i]).replace(/<html([^>]+)>/i, replacement);
      break;
    }
  }

  return lines.join("\n");
}

function requestFileJob(filePath, finish) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      if (err.errno === 34) {
        finish(-6); // net::ERR_FILE_NOT_FOUND
        return;
      } else {
        finish(-2); // net::FAILED
        return;
      }
    }

    finish({
      data: buf,
      mimeType: mime.lookup(filePath) || 'text/plain'
    });
  });
}

const bypassCheckers = [];

/**
 * Adds a function that will be called on electron-compile's protocol hook
 * used to intercept file requests.  Use this to bypass electron-compile
 * entirely for certain URI's.
 * 
 * @param {Function} bypassChecker Function that will be called with the file path to determine whether to bypass or not
 */
export function addBypassChecker(bypassChecker) {
  bypassCheckers.push(bypassChecker);
}

/**
 * Initializes the protocol hook on file: that allows us to intercept files
 * loaded by Chromium and rewrite them. This method along with
 * {@link registerRequireExtension} are the top-level methods that electron-compile
 * actually uses to intercept code that Electron loads.
 *
 * @param  {CompilerHost} compilerHost  The compiler host to use for compilation.
 */
export function initializeProtocolHook(compilerHost) {
  protocol = protocol || require('electron').protocol;

  global[magicGlobalForRootCacheDir] = compilerHost.rootCacheDir;
  global[magicGlobalForAppRootDir] = compilerHost.appRoot;

  const electronCompileSetupCode = `if (window.require) require('@lanethegreat/electron-compile/lib/initialize-renderer').initializeRendererProcess(${compilerHost.readOnlyMode});`;

  protocol.interceptBufferProtocol('file', async function(request, finish) {
    let uri = url.parse(request.url, true);

    d(`Intercepting url ${request.url}`);
    if (request.url.indexOf(magicWords) > -1) {
      finish({
        mimeType: 'application/javascript',
        data: Buffer.from(electronCompileSetupCode, 'utf8')
      });

      return;
    }

    // This is a protocol-relative URL that has gone pear-shaped in Electron,
    // let's rewrite it
    if (uri.host && uri.host.length > 1) {
      //let newUri = request.url.replace(/^file:/, "https:");
      // TODO: Jump off this bridge later
      d(`TODO: Found bogus protocol-relative URL, can't fix it up!!`);
      finish(-2);
      return;
    }

    let filePath = decodeURIComponent(uri.pathname);

    // Check if requested .css files need to be transpiled from another source file.
    // Electron (or the V8 engine) does not permit loading of stylesheet files ending in
    // anything other than '.css'
    if (uri.query && uri.query['_useExt']) {
      filePath = filePath.replace(/\.css$/i, `.${uri.query['_useExt']}`);
    }

    // NB: pathname has a leading '/' on Win32 for some reason
    if (process.platform === 'win32') {
      filePath = filePath.slice(1);
    }

    // NB: Special-case files coming from atom.asar or node_modules
    if (filePath.match(/[/\\](atom|electron).asar/) || filePath.match(/[/\\](node_modules|bower_components)/)) {
      // NBs on NBs: If we're loading an HTML file from node_modules, we still have
      // to do the HTML document rigging
      if (filePath.match(/\.html?$/i)) {
        let riggedContents = null;
        fs.readFile(filePath, 'utf8', (err, contents) => {
          if (err) {
            if (err.errno === 34) {
              finish(-6); // net::ERR_FILE_NOT_FOUND
              return;
            } else {
              finish(-2); // net::FAILED
              return;
            }
          }

          riggedContents = rigHtmlDocumentToInitializeElectronCompile(contents);
          finish({ data: Buffer.from(riggedContents), mimeType: 'text/html' });
          return;
        });

        return;
      }

      requestFileJob(filePath, finish);
      return;
    }

    // NB: Chromium will somehow decide that external source map references
    // aren't relative to the file that was loaded for node.js modules, but
    // relative to the HTML file. Since we can't really figure out what the
    // real path is, we just need to squelch it.
    if (filePath.match(/\.map$/i) && !(await doesMapFileExist(filePath))) {
      finish({ data: Buffer.from("", 'utf8'), mimeType: 'text/plain' });
      return;
    }

    for (const bypassChecker of bypassCheckers) {
      if (bypassChecker(filePath)) {
        d('bypassing compilers for:', filePath);
        requestFileJob(filePath, finish);
        return;
      }
    }

    try {
      let result = await compilerHost.compile(filePath);

      if (result.mimeType === 'text/html') {
        result.code = rigHtmlDocumentToInitializeElectronCompile(result.code);
      }

      if (result.binaryData || result.code instanceof Buffer) {
        finish({ data: result.binaryData || result.code, mimeType: result.mimeType });
        return;
      } else {
        finish({ data: Buffer.from(result.code), mimeType: result.mimeType });
        return;
      }
    } catch (e) {
      let err = `Failed to compile ${filePath}: ${e.message}\n${e.stack}`;
      d(err);

      if (e.errno === 34 /*ENOENT*/) {
        finish(-6); // net::ERR_FILE_NOT_FOUND
        return;
      }

      finish({ mimeType: 'text/plain', data: Buffer.from(err) });
      return;
    }
  });
}
