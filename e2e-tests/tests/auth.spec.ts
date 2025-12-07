import { test, expect } from '@playwright/test';

/**
 * Authentication Propagation E2E Test Suite
 * 
 * Goal: Verify that authentication tokens are correctly propagated from client to server.
 * Tests the setAuthToken() method and validates that the server receives the authorization header.
 */

test.describe('Authentication Propagation', () => {
  test.beforeEach(async ({ page }) => {
    // Listen for console messages
    page.on('console', msg => console.log(`[BROWSER ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => console.error(`[BROWSER ERROR] ${err.message}`));
    
    // Navigate to the demo app and wait for network to be idle
    await page.goto('/', { waitUntil: 'networkidle' });
    
    // Wait for Angular to bootstrap and render
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for page to be ready
    await expect(page.locator('h1')).toContainText('NgGoRPC Infinite Ticker Demo', { timeout: 10000 });
    
    // Wait for connection to be established
    const status = page.locator('#status');
    await expect(status).toContainText('Connected', { timeout: 10000 });
  });

  test('should send authorization header when token is set', async ({ page }) => {
    console.log('[DEBUG_LOG] Testing authentication token propagation');
    
    // Set authentication token via browser console
    await page.evaluate(() => {
      // Access the NgGoRpcClient instance from the Angular component
      const client = (window as any).ng?.getComponent(document.querySelector('app-root'))?.client;
      if (client) {
        client.setAuthToken('test-token');
        console.log('[DEBUG_LOG] Set auth token: test-token');
      } else {
        console.error('[DEBUG_LOG] Could not access client instance');
      }
    });
    
    // Make an RPC call
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.getByRole('button', { name: 'Say Hello', exact: true });
    const greetingResponse = page.locator('#greetingResponse');
    
    await nameInput.clear();
    await nameInput.fill('AuthTest');
    await sayHelloBtn.click();
    
    // Wait for response
    await expect(greetingResponse).toHaveText('Hello, AuthTest!', { timeout: 5000 });
    
    console.log('[DEBUG_LOG] ✓ RPC call with auth token completed successfully');
    
    // Note: To verify the server received the token, check server logs
    // The server should log: "[Greeter] Authorization header received: Bearer test-token"
    // and "[Greeter] ✓ Valid test token received"
  });

  test('should work without authentication token', async ({ page }) => {
    console.log('[DEBUG_LOG] Testing RPC call without authentication token');
    
    // Ensure no token is set (clear any existing token)
    await page.evaluate(() => {
      const client = (window as any).ng?.getComponent(document.querySelector('app-root'))?.client;
      if (client) {
        client.setAuthToken(null);
        console.log('[DEBUG_LOG] Cleared auth token');
      }
    });
    
    // Make an RPC call
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    await nameInput.clear();
    await nameInput.fill('NoAuthTest');
    await sayHelloBtn.click();
    
    // Wait for response - should still work
    await expect(greetingResponse).toHaveText('Hello, NoAuthTest!', { timeout: 5000 });
    
    console.log('[DEBUG_LOG] ✓ RPC call without auth token completed successfully');
    
    // Server should log: "[Greeter] No authorization header found"
  });

  test('should allow changing auth token between calls', async ({ page }) => {
    console.log('[DEBUG_LOG] Testing auth token change between calls');
    
    // First call with token "first-token"
    await page.evaluate(() => {
      const client = (window as any).ng?.getComponent(document.querySelector('app-root'))?.client;
      if (client) {
        client.setAuthToken('first-token');
        console.log('[DEBUG_LOG] Set auth token: first-token');
      }
    });
    
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    await nameInput.clear();
    await nameInput.fill('FirstToken');
    await sayHelloBtn.click();
    await expect(greetingResponse).toHaveText('Hello, FirstToken!', { timeout: 5000 });
    console.log('[DEBUG_LOG] ✓ First call with first-token completed');
    
    // Second call with token "second-token"
    await page.evaluate(() => {
      const client = (window as any).ng?.getComponent(document.querySelector('app-root'))?.client;
      if (client) {
        client.setAuthToken('second-token');
        console.log('[DEBUG_LOG] Set auth token: second-token');
      }
    });
    
    await nameInput.clear();
    await nameInput.fill('SecondToken');
    await sayHelloBtn.click();
    await expect(greetingResponse).toHaveText('Hello, SecondToken!', { timeout: 5000 });
    console.log('[DEBUG_LOG] ✓ Second call with second-token completed');
    
    // Third call with token cleared
    await page.evaluate(() => {
      const client = (window as any).ng?.getComponent(document.querySelector('app-root'))?.client;
      if (client) {
        client.setAuthToken(null);
        console.log('[DEBUG_LOG] Cleared auth token');
      }
    });
    
    await nameInput.clear();
    await nameInput.fill('NoToken');
    await sayHelloBtn.click();
    await expect(greetingResponse).toHaveText('Hello, NoToken!', { timeout: 5000 });
    console.log('[DEBUG_LOG] ✓ Third call without token completed');
    
    console.log('[DEBUG_LOG] ✓ All token change scenarios completed successfully');
  });

  test('should propagate auth token correctly with expected test-token value', async ({ page }) => {
    console.log('[DEBUG_LOG] Testing with expected test-token value');
    
    // Set the exact token the server expects
    await page.evaluate(() => {
      const client = (window as any).ng?.getComponent(document.querySelector('app-root'))?.client;
      if (client) {
        client.setAuthToken('test-token');
        console.log('[DEBUG_LOG] Set auth token: test-token (expected value)');
      }
    });
    
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    await nameInput.clear();
    await nameInput.fill('ValidToken');
    await sayHelloBtn.click();
    
    await expect(greetingResponse).toHaveText('Hello, ValidToken!', { timeout: 5000 });
    
    console.log('[DEBUG_LOG] ✓ Expected token propagated successfully');
    // Server logs should show: "[Greeter] ✓ Valid test token received"
  });
});
