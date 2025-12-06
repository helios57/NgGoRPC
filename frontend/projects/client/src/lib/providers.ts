import { makeEnvironmentProviders, NgZone, PLATFORM_ID, inject, InjectionToken } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NgGoRpcClient, NgGoRpcConfig } from './client';

/**
 * Injection token for NgGoRpcClient
 */
export const NG_GO_RPC_CLIENT = new InjectionToken<NgGoRpcClient>('NG_GO_RPC_CLIENT');

/**
 * Injection token for NgGoRpcConfig
 */
export const NG_GO_RPC_CONFIG = new InjectionToken<NgGoRpcConfig>('NG_GO_RPC_CONFIG');

/**
 * Factory function to create NgGoRpcClient instance
 * @internal
 */
function createNgGoRpcClient(): NgGoRpcClient {
  const ngZone = inject(NgZone);
  const config = inject(NG_GO_RPC_CONFIG, { optional: true });
  return new NgGoRpcClient(ngZone, config ?? undefined);
}

/**
 * Provides NgGoRPC client with dependency injection support.
 *
 * This function uses Angular's makeEnvironmentProviders to configure
 * the NgGoRPC client in your application. The client is automatically
 * instantiated with the correct NgZone and optional configuration.
 *
 * SSR Safe: The provider can be used in Server-Side Rendering environments
 * without issues. WebSocket connections should only be initiated in the browser.
 *
 * @param config Optional configuration for the NgGoRPC client
 * @returns Environment providers for NgGoRPC
 *
 * @example
 * ```typescript
 * // In your app.config.ts or main.ts
 * import { provideNgGoRpc } from '@nggorpc/client';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideNgGoRpc({
 *       pingInterval: 30000,
 *       baseReconnectDelay: 1000,
 *       maxReconnectDelay: 30000,
 *       enableLogging: true
 *     }),
 *     // ... other providers
 *   ]
 * };
 * ```
 *
 * @example
 * ```typescript
 * // In your component or service
 * import { inject } from '@angular/core';
 * import { NG_GO_RPC_CLIENT } from '@nggorpc/client';
 *
 * export class MyComponent {
 *   private client = inject(NG_GO_RPC_CLIENT);
 *
 *   ngOnInit() {
 *     this.client.connect('ws://localhost:8080');
 *   }
 * }
 * ```
 */
export function provideNgGoRpc(config?: NgGoRpcConfig) {
  return makeEnvironmentProviders([
    config ? { provide: NG_GO_RPC_CONFIG, useValue: config } : [],
    {
      provide: NG_GO_RPC_CLIENT,
      useFactory: createNgGoRpcClient
    }
  ]);
}
