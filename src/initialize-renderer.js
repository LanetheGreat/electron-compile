import CompilerHost from './compiler-host';

// NB: These are duped in protocol-hook so we can save startup time, make
// sure to run both!
const magicGlobalForRootCacheDir = '__electron_compile_root_cache_dir';
const magicGlobalForAppRootDir = '__electron_compile_app_root_dir';

const d = require('debug')('@lanethegreat/electron-compile:initialize-renderer');

let rendererInitialized = false;

/**
 * Called by our rigged script file at the top of every HTML file to set up
 * the same compilers as the browser process that created us
 *
 * @private
 */
export function initializeRendererProcess(readOnlyMode) {
  if (rendererInitialized) return;

  let rootCacheDir = require('electron').remote.getGlobal(magicGlobalForRootCacheDir);
  let appRoot = require('electron').remote.getGlobal(magicGlobalForAppRootDir);
  let compilerHost = null;

  // NB: This has to be synchronous because we need to block HTML parsing
  // until we're set up
  if (readOnlyMode) {
    d(`Setting up electron-compile in precompiled mode with cache dir: ${rootCacheDir}`);

    // NB: React cares SUPER HARD about this, and this is the earliest place
    // we can set it up to ensure React picks it up correctly
    process.env.NODE_ENV = 'production';
    compilerHost = CompilerHost.createReadonlyFromConfigurationSync(rootCacheDir, appRoot);
  } else {
    d(`Setting up electron-compile in development mode with cache dir: ${rootCacheDir}`);
    const { createCompilers } = require('./config-parser');
    const compilersByMimeType = createCompilers();

    compilerHost = CompilerHost.createFromConfigurationSync(rootCacheDir, appRoot, compilersByMimeType);
  }

  require('./x-require');
  const { hookHotModuleReloader, registerRequireExtension } = require('./require-hook');
  hookHotModuleReloader(compilerHost);
  registerRequireExtension(compilerHost, readOnlyMode);
  rendererInitialized = true;
}
