import { test, expect } from '@playwright/test';

/**
 * Large Payload E2E Test Suite
 * 
 * Goal: Verify that the transport handles large payloads correctly (3MB).
 * Tests that large strings can be sent and received without fragmentation issues.
 */

test.describe('Large Payload Handling', () => {
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

  test('should handle 3MB payload in SayHello request and response', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing SayHello with 3MB payload');
    
    // Create a ~3MB string (3 * 1024 * 1024 = 3,145,728 bytes)
    const sizeInBytes = 3 * 1024 * 1024;
    const largeString = 'A'.repeat(sizeInBytes);
    
    console.log(`[DEBUG_LOG] Created large string of ${largeString.length} characters (~${(largeString.length / 1024 / 1024).toFixed(2)} MB)`);
    
    // Clear and enter the large string
    await nameInput.clear();
    await nameInput.fill(largeString);
    
    console.log('[DEBUG_LOG] Filled input with large string');
    
    // Click Say Hello button
    await sayHelloBtn.click();
    
    console.log('[DEBUG_LOG] Clicked Say Hello button, waiting for response...');
    
    // Wait for response with increased timeout (large payload may take longer)
    // The response should be "Hello, " + largeString + "!"
    const expectedResponse = `Hello, ${largeString}!`;
    
    // Wait for the response to appear (with generous timeout for large payload processing)
    await expect(greetingResponse).not.toBeEmpty({ timeout: 60000 });
    
    // Get the actual response
    const actualResponse = await greetingResponse.textContent();
    
    console.log(`[DEBUG_LOG] Received response of length: ${actualResponse?.length || 0}`);
    
    // Verify the response contains our large string
    expect(actualResponse).toBe(expectedResponse);
    
    console.log(`[DEBUG_LOG] ✓ Large payload test passed! Response length: ${actualResponse?.length} characters`);
  });

  test('should handle 1MB payload without issues', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing SayHello with 1MB payload');
    
    // Create a ~1MB string
    const sizeInBytes = 1 * 1024 * 1024;
    const largeString = 'B'.repeat(sizeInBytes);
    
    console.log(`[DEBUG_LOG] Created string of ${largeString.length} characters (~${(largeString.length / 1024 / 1024).toFixed(2)} MB)`);
    
    // Clear and enter the string
    await nameInput.clear();
    await nameInput.fill(largeString);
    
    // Click Say Hello button
    await sayHelloBtn.click();
    
    console.log('[DEBUG_LOG] Waiting for response...');
    
    // Wait for response
    const expectedResponse = `Hello, ${largeString}!`;
    await expect(greetingResponse).not.toBeEmpty({ timeout: 40000 });
    
    const actualResponse = await greetingResponse.textContent();
    expect(actualResponse).toBe(expectedResponse);
    
    console.log(`[DEBUG_LOG] ✓ 1MB payload test passed! Response length: ${actualResponse?.length} characters`);
  });

  test('should handle multiple large payload calls sequentially', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing multiple sequential large payload calls');
    
    // First large call: 500KB
    const size1 = 500 * 1024;
    const string1 = 'X'.repeat(size1);
    await nameInput.clear();
    await nameInput.fill(string1);
    await sayHelloBtn.click();
    await expect(greetingResponse).toHaveText(`Hello, ${string1}!`, { timeout: 30000 });
    console.log('[DEBUG_LOG] ✓ First 500KB call completed');
    
    // Second large call: 750KB
    const size2 = 750 * 1024;
    const string2 = 'Y'.repeat(size2);
    await nameInput.clear();
    await nameInput.fill(string2);
    await sayHelloBtn.click();
    await expect(greetingResponse).toHaveText(`Hello, ${string2}!`, { timeout: 30000 });
    console.log('[DEBUG_LOG] ✓ Second 750KB call completed');
    
    // Third large call: 1MB
    const size3 = 1024 * 1024;
    const string3 = 'Z'.repeat(size3);
    await nameInput.clear();
    await nameInput.fill(string3);
    await sayHelloBtn.click();
    await expect(greetingResponse).toHaveText(`Hello, ${string3}!`, { timeout: 30000 });
    console.log('[DEBUG_LOG] ✓ Third 1MB call completed');
    
    console.log('[DEBUG_LOG] ✓ All sequential large payload calls completed successfully');
  });
});
