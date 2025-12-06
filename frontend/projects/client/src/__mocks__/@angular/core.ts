/**
 * Mock for @angular/core to use in Jest tests
 */

export function Injectable() {
  return function<T>(target: T): T {
    return target;
  };
}

export class NgZone {
  runOutsideAngular<T>(fn: () => T): T {
    return fn();
  }

  run<T>(fn: () => T): T {
    return fn();
  }
}

export interface Signal<T> {
  (): T;
}
