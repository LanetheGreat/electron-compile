import fs from 'fs';
import { Observable, Subscription } from 'rxjs';
import { publish, refCount } from 'rxjs/operators';
import LRU from 'lru-cache';

export function watchPathDirect(directory) {
  return Observable.create((subj) => {
    let dead = false;

    const watcher = fs.watch(directory, {}, (eventType, fileName) => {
      if (dead) return;
      subj.next({eventType, fileName});
    });

    watcher.on('error', (e) => {
      dead = true;
      subj.error(e);
    });

    return new Subscription(() => { if (!dead) { watcher.close(); } });
  });
}

const pathCache = new LRU({ length: 256 });
export function watchPath(directory) {
  let ret = pathCache.get(directory);
  if (ret) return ret;

  ret = watchPathDirect(directory).pipe(publish(), refCount());
  pathCache.set(directory, ret);
  return ret;
}
