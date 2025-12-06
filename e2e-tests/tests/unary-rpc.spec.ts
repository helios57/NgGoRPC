import { test, expect } from '@playwright/test';

/**
 * Unary RPC Test Suite
 * 
 * Goal: Verify unary RPC calls (request-response pattern) work correctly.
 * Tests the SayHello method which sends a single request and receives a single response.
 */

test.describe('Unary RPC (SayHello)', () => {
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

  test('should successfully call SayHello with default name', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing SayHello with default name');
    
    // Verify default value is "World"
    const defaultName = await nameInput.inputValue();
    expect(defaultName).toBe('World');
    
    // Click Say Hello button
    await sayHelloBtn.click();
    
    // Wait for response
    await expect(greetingResponse).toBeVisible({ timeout: 5000 });
    
    // Verify response message
    const responseText = await greetingResponse.textContent();
    expect(responseText).toBe('Hello, World!');
    
    console.log(`[DEBUG_LOG] ✓ Received response: ${responseText}`);
  });

  test('should successfully call SayHello with custom name', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing SayHello with custom name');
    
    // Clear and enter custom name
    await nameInput.clear();
    await nameInput.fill('Angular');
    
    // Click Say Hello button
    await sayHelloBtn.click();
    
    // Wait for response
    await expect(greetingResponse).toBeVisible({ timeout: 5000 });
    
    // Verify response message
    const responseText = await greetingResponse.textContent();
    expect(responseText).toBe('Hello, Angular!');
    
    console.log(`[DEBUG_LOG] ✓ Received response: ${responseText}`);
  });

  test('should handle multiple sequential unary calls', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing multiple sequential unary calls');
    
    // First call
    await nameInput.clear();
    await nameInput.fill('Alice');
    await sayHelloBtn.click();
    await expect(greetingResponse).toContainText('Hello, Alice!', { timeout: 5000 });
    console.log('[DEBUG_LOG] ✓ First call completed');
    
    // Second call
    await nameInput.clear();
    await nameInput.fill('Bob');
    await sayHelloBtn.click();
    await expect(greetingResponse).toContainText('Hello, Bob!', { timeout: 5000 });
    console.log('[DEBUG_LOG] ✓ Second call completed');
    
    // Third call
    await nameInput.clear();
    await nameInput.fill('Charlie');
    await sayHelloBtn.click();
    await expect(greetingResponse).toContainText('Hello, Charlie!', { timeout: 5000 });
    console.log('[DEBUG_LOG] ✓ Third call completed');
    
    console.log('[DEBUG_LOG] ✓ All sequential calls completed successfully');
  });

  test('should handle empty name gracefully', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing SayHello with empty name');
    
    // Clear name input
    await nameInput.clear();
    
    // Click Say Hello button
    await sayHelloBtn.click();
    
    // Wait for response (should still work with empty string)
    await expect(greetingResponse).toBeVisible({ timeout: 5000 });
    
    // Verify response message (server should handle empty name)
    const responseText = await greetingResponse.textContent();
    expect(responseText).toBe('Hello, !');
    
    console.log(`[DEBUG_LOG] ✓ Empty name handled: ${responseText}`);
  });

  test('should handle special characters in name', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing SayHello with special characters');
    
    const specialName = 'Test-User_123!@#';
    await nameInput.clear();
    await nameInput.fill(specialName);
    
    // Click Say Hello button
    await sayHelloBtn.click();
    
    // Wait for response
    await expect(greetingResponse).toBeVisible({ timeout: 5000 });
    
    // Verify response message
    const responseText = await greetingResponse.textContent();
    expect(responseText).toBe(`Hello, ${specialName}!`);
    
    console.log(`[DEBUG_LOG] ✓ Special characters handled: ${responseText}`);
  });
});
