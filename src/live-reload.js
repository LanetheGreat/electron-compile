import FileChangedCache from './file-change-cache';
import {watchPath} from './pathwatcher-rx';
import { defer, from, EMPTY } from 'rxjs';
import { catchError, filter, map, mergeMap, switchMap, timeout } from 'rxjs/operators';

import {guaranteedThrottle} from './custom-operators';

export function enableLiveReload(options={}) {
  let { strategy } = options;

  if (process.type !== 'browser' || !global.globalCompilerHost) throw new Error("Call this from the browser process, right after initializing electron-compile");

  switch(strategy) {
  case 'react-hmr':
    enableReactHMR();
    break;
  case 'naive':
  default:
    enableLiveReloadNaive();
  }
}

let BrowserWindow;
if (process.type === 'browser') {
  BrowserWindow = require('electron').BrowserWindow;
}

function reloadAllWindows() {
  let ret = BrowserWindow.getAllWindows().map(wnd => {
    if (!wnd.isVisible()) return Promise.resolve(true);

    return new Promise((res) => {
      wnd.webContents.reloadIgnoringCache();
      wnd.once('ready-to-show', () => res(true));
    });
  });

  return Promise.all(ret);
}

function enableLiveReloadNaive() {
  let filesWeCareAbout = global.globalCompilerHost.listenToCompileEvents().pipe(
    filter(x => !FileChangedCache.isInNodeModules(x.filePath))
  );

  let weShouldReload = filesWeCareAbout.pipe(
    mergeMap(x => watchPath(x.filePath).pipe(map(() => x))),
    guaranteedThrottle(1*1000)
  );

  return weShouldReload.pipe(
    switchMap(
      () => defer(
        () => from(reloadAllWindows()).pipe(
          timeout(5*1000),
          catchError(() => EMPTY)
        )
      )
    )
  ).subscribe(() => console.log("Reloaded all windows!"));
}

function triggerHMRInRenderers() {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('__electron-compile__HMR');
  });

  return Promise.resolve(true);
}

function enableReactHMR() {
  global.__electron_compile_hmr_enabled__ = true;

  let filesWeCareAbout = global.globalCompilerHost.listenToCompileEvents().pipe(
    filter(x => !FileChangedCache.isInNodeModules(x.filePath))
  );

  let weShouldReload = filesWeCareAbout.pipe(
    mergeMap(x => watchPath(x.filePath).pipe(map(() => x))),
    guaranteedThrottle(1*1000)
  );

  return weShouldReload.pipe(
    switchMap(
      () => defer(
        () => from(triggerHMRInRenderers()).pipe(catchError(() => EMPTY))
      )
    )
  ).subscribe(() => console.log("HMR sent to all windows!"));
}
