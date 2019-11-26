import { async, pipe, range, throwError, timer, zip } from 'rxjs';
import { map, mergeMap, retryWhen, switchAll } from 'rxjs/operators';

function retryWithDelayOrError(errors, maxRetries) {
  return zip(
    range(1, maxRetries + 1),
    errors,
    (i, e) => {
      return { attempts: i, error: e };
    }
  ).pipe(
    mergeMap(({attempts, error}) => {
      return (attempts <= maxRetries) ? timer(attempts * 1000) : throwError(error);
    })
  );
}

export function guaranteedThrottle(time, scheduler = async) {
  return pipe(
    map((x) => timer(time, scheduler).pipe(map(() => x))),
    switchAll()
  );
}

export function retryAtIntervals(maxRetries = 3) {
  return pipe(
    retryWhen((errors) => retryWithDelayOrError(errors, maxRetries))
  );
}
