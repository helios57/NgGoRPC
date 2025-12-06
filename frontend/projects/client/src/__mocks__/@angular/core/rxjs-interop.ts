/**
 * Mock for @angular/core/rxjs-interop to use in Jest tests
 */

import { Observable } from 'rxjs';
import { Signal } from '@angular/core';

export interface ToSignalOptions<T> {
  initialValue?: T;
  requireSync?: boolean;
  injector?: any;
}

/**
 * Mock implementation of toSignal that converts an Observable to a Signal
 * For testing purposes, this returns a simple function that returns undefined
 */
export function toSignal<T>(
  source: Observable<T>,
  options?: ToSignalOptions<T>
): Signal<T | undefined> {
  // Simple mock that returns a function (Signal interface)
  let value: T | undefined = options?.initialValue;

  // Subscribe to the observable to capture the last value
  source.subscribe({
    next: (v) => { value = v; },
    error: () => { value = undefined; },
    complete: () => {}
  });

  return (() => value) as Signal<T | undefined>;
}
