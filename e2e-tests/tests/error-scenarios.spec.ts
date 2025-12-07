import { test, expect } from '@playwright/test';

/**
 * Error Scenarios Test Suite
 * 
 * Goal: Verify the library handles error conditions gracefully.
 * Tests invalid method calls, network disruptions, and other error conditions.
 */

test.describe('Error Scenarios', () => {
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

  test('should maintain connection after error in one stream', async ({ page }) => {
    const stream1Counter = page.locator('#stream1Counter');
    const startStream1Btn = page.locator('#startStream1Btn');
    const stopStream1Btn = page.locator('#stopStream1Btn');
    const status = page.locator('#status');
    
    console.log('[DEBUG_LOG] Testing error isolation between streams');
    
    // Start a valid stream
    await startStream1Btn.click();
    await page.waitForTimeout(500);
    
    const initialCount = parseInt(await stream1Counter.textContent() || '0');
    expect(initialCount).toBeGreaterThan(0);
    console.log(`[DEBUG_LOG] Stream 1 started: ${initialCount}`);
    
    // Inject code to call invalid method (this should error but not affect existing stream)
    await page.evaluate(async () => {
      try {
        const appElement = document.querySelector('app-root');
        const component = (appElement as any).__ngContext__?.[8];
        const transport = component?.transport;
        
        if (transport) {
          const requestData = new Uint8Array([]);
          transport.request('greeter.Greeter', 'InvalidMethod', requestData)
            .subscribe({
              error: (err: Error) => console.log('[DEBUG_LOG] Expected error:', err.message)
            });
        }
      } catch (err) {
        console.log('[DEBUG_LOG] Error calling invalid method:', err);
      }
    });
    
    // Wait a bit
    await page.waitForTimeout(500);
    
    // Verify stream 1 is still running
    const laterCount = parseInt(await stream1Counter.textContent() || '0');
    expect(laterCount).toBeGreaterThan(initialCount);
    
    // Connection should still be active
    await expect(status).toContainText('Connected');
    
    console.log(`[DEBUG_LOG] ✓ Stream 1 continued after error: ${initialCount} -> ${laterCount}`);
    
    // Cleanup
    await stopStream1Btn.click();
  });

  test('should handle rapid successive calls without error', async ({ page }) => {
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing rapid successive unary calls');
    
    // Make 5 rapid calls
    for (let i = 1; i <= 5; i++) {
      await nameInput.clear();
      await nameInput.fill(`User${i}`);
      await sayHelloBtn.click();
      // Small delay between calls
      await page.waitForTimeout(50);
    }
    
    // Wait for last response
    await page.waitForTimeout(1000);
    
    // Should have received the last response
    await expect(greetingResponse).toBeVisible();
    const responseText = await greetingResponse.textContent();
    expect(responseText).toContain('Hello, User5!');
    
    console.log(`[DEBUG_LOG] ✓ Rapid calls handled: ${responseText}`);
  });

  test('should handle stream cancellation during active transmission', async ({ page }) => {
    const counter = page.locator('#counter');
    const startBtn = page.locator('#startBtn');
    const stopBtn = page.locator('#stopBtn');
    const status = page.locator('#status');
    
    console.log('[DEBUG_LOG] Testing stream cancellation during transmission');
    
    // Start ticker
    await startBtn.click();
    await page.waitForTimeout(200);
    
    const count1 = parseInt(await counter.textContent() || '0');
    expect(count1).toBeGreaterThan(0);
    console.log(`[DEBUG_LOG] Stream started: ${count1}`);
    
    // Immediately stop (while messages are in flight)
    await stopBtn.click();
    
    // Wait a bit
    await page.waitForTimeout(500);
    
    const count2 = parseInt(await counter.textContent() || '0');
    
    // Counter should have stopped (or increased very little due to buffered messages)
    expect(Math.abs(count2 - count1)).toBeLessThan(3);
    
    // Connection should still be active
    await expect(status).toContainText('Connected');
    
    console.log(`[DEBUG_LOG] ✓ Stream cancelled cleanly: ${count1} -> ${count2}`);
  });

  test('should handle concurrent unary and streaming calls', async ({ page }) => {
    const counter = page.locator('#counter');
    const startBtn = page.locator('#startBtn');
    const stopBtn = page.locator('#stopBtn');
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    console.log('[DEBUG_LOG] Testing concurrent unary and streaming');
    
    // Start streaming
    await startBtn.click();
    await page.waitForTimeout(300);
    
    const streamCount1 = parseInt(await counter.textContent() || '0');
    expect(streamCount1).toBeGreaterThan(0);
    console.log(`[DEBUG_LOG] Stream started: ${streamCount1}`);
    
    // Make unary call while stream is running
    await nameInput.clear();
    await nameInput.fill('Concurrent');
    await sayHelloBtn.click();
    await expect(greetingResponse).toContainText('Hello, Concurrent!', { timeout: 5000 });
    console.log('[DEBUG_LOG] ✓ Unary call succeeded during streaming');
    
    // Verify stream is still running
    await page.waitForTimeout(300);
    const streamCount2 = parseInt(await counter.textContent() || '0');
    expect(streamCount2).toBeGreaterThan(streamCount1);
    
    console.log(`[DEBUG_LOG] ✓ Stream still running: ${streamCount1} -> ${streamCount2}`);
    
    // Cleanup
    await stopBtn.click();
  });
});
