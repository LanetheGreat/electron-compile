import mimeTypes from '@paulcbetts/mime-types';
import path from 'path';
import url from 'url';

let HMR = false;
let electron = null;

const d = require('debug')('@lanethegreat/electron-compile:require-hook');

function URLtoLocal(URL) {

  const ext = URL.searchParams.get('_useExt');
  let localPath = process.platform === 'win32'
    ? URL.pathname.slice(1)
    : URL.pathname;

  if (ext) {
    localPath = path.format({
      ...path.parse(localPath),
      ext: `.${ext}`,
      base: undefined
    });
  }

  return path.normalize(localPath);
}

/**
 * Initializes the hook used for triggering file compilation on files in
 * development mode. Should only be used inside a render process with HMR
 * enabled.
 *
 * @param  {CompilerHost} compilerHost  The compiler host to use for compilation.
 */
export function hookHotModuleReloader(compilerHost) {
  window.__hot = [];
  electron = require('electron');
  HMR = electron.remote.getGlobal('__electron_compile_hmr_enabled__');

  if (HMR) {
    electron.ipcRenderer.on('__electron-compile__HMR', (event, modifiedFile) => {
      d("Got HMR signal!");

      // Reset the module cache
      let cache = require('module')._cache;
      let toEject = Object.keys(cache).filter(x => x && !x.match(/[\\/](node_modules|.*\.asar)[\\/]/i));
      toEject.forEach(x => {
        d(`Removing node module entry for ${x}`);
        delete cache[x];
      });

      // Recompile the detected top-level import file, if it isn't going to be compiled by require() later on.
      let filePath = path.resolve(modifiedFile);
      if (!(filePath in toEject)) {
        const hashInfo = compilerHost.compileSync(filePath);
        const normPath = path.normalize(filePath);
        
        // Check each script/link tag in the document to update their URL's and trigger live file reloads.
        for(let element of document.querySelectorAll('script, link[rel=stylesheet]')) {
          const parsedURL = new url.URL(element.src || element.href);
          const localPath = URLtoLocal(parsedURL);

          // Found a matching file so update it's URL with a new source file hash.
          if (localPath === normPath) {
            parsedURL.searchParams.set('hash', hashInfo.codeHash);

            if (element.src) {
              element.src = parsedURL.toString();
            } else {
              element.href = parsedURL.toString();
            }
          }
        }
      }

      window.__hot.forEach(fn => fn());
    });
  }
}

/**
 * Initializes the node.js hook that allows us to intercept files loaded by
 * node.js and rewrite them. This method along with {@link initializeProtocolHook}
 * are the top-level methods that electron-compile actually uses to intercept
 * code that Electron loads.
 *
 * @param  {CompilerHost} compilerHost  The compiler host to use for compilation.
 * @param  {boolean} isProduction  Decides whether to use the read-only production 
 *                                 compiler cache or development compiler cache.
 */
export function registerRequireExtension(compilerHost, isProduction) {
  if (HMR) {
    try {
      require('module').prototype.hot = {
        accept: (cb) => window.__hot.push(cb)
      };

      require('react-hot-loader/patch');
    } catch (e) {
      console.error(`Couldn't require react-hot-loader/patch, you need to add react-hot-loader as a dependency! ${e.message}`);
    }
  }

  let mimeTypeList = isProduction ?
    Object.keys(compilerHost.mimeTypesToRegister) :
    Object.keys(compilerHost.compilersByMimeType);

  mimeTypeList.forEach((mimeType) => {
    let ext = mimeTypes.extension(mimeType);

    require.extensions[`.${ext}`] = (module, filename) => {
      let {code} = compilerHost.compileSync(filename);

      if (code === null) {
        console.error(`null code returned for "${filename}".  Please raise an issue on 'electron-compile' with the contents of this file.`);
      }

      module._compile(code, filename);
    };
  });
}

export default {
  hookHotModuleReloader,
  registerRequireExtension
};