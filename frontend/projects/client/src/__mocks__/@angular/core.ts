/**
 * Mock for @angular/core to use in Jest tests
 */

export function Injectable() {
  return function(target: any) {
    return target;
  };
}

export class NgZone {
  runOutsideAngular(fn: Function) {
    return fn();
  }

  run(fn: Function) {
    return fn();
  }
}

export interface Signal<T> {
  (): T;
}
