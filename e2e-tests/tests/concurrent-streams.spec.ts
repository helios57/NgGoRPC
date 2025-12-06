import { test, expect } from '@playwright/test';

/**
 * Concurrent Streams Test Suite
 * 
 * Goal: Verify that multiple streams can run simultaneously over the same WebSocket connection.
 * This tests the library's multiplexing capability - a key feature of the protocol.
 */

test.describe('Concurrent Streams', () => {
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

  test('should run two streams concurrently and independently', async ({ page }) => {
    const stream1Counter = page.locator('#stream1Counter');
    const stream2Counter = page.locator('#stream2Counter');
    const startStream1Btn = page.locator('#startStream1Btn');
    const startStream2Btn = page.locator('#startStream2Btn');
    const stopStream1Btn = page.locator('#stopStream1Btn');
    const stopStream2Btn = page.locator('#stopStream2Btn');
    
    console.log('[DEBUG_LOG] Starting concurrent streams test');
    
    // Start both streams
    await startStream1Btn.click();
    await startStream2Btn.click();
    
    // Wait for both to start receiving data
    await page.waitForTimeout(500);
    
    // Verify both streams are incrementing
    const stream1Count1 = parseInt(await stream1Counter.textContent() || '0');
    const stream2Count1 = parseInt(await stream2Counter.textContent() || '0');
    
    expect(stream1Count1).toBeGreaterThan(0);
    expect(stream2Count1).toBeGreaterThan(0);
    
    console.log(`[DEBUG_LOG] Stream 1: ${stream1Count1}, Stream 2: ${stream2Count1}`);
    
    // Wait more and verify both continue incrementing
    await page.waitForTimeout(500);
    
    const stream1Count2 = parseInt(await stream1Counter.textContent() || '0');
    const stream2Count2 = parseInt(await stream2Counter.textContent() || '0');
    
    expect(stream1Count2).toBeGreaterThan(stream1Count1);
    expect(stream2Count2).toBeGreaterThan(stream2Count1);
    
    console.log(`[DEBUG_LOG] Stream 1: ${stream1Count2}, Stream 2: ${stream2Count2}`);
    console.log('[DEBUG_LOG] ✓ Both streams running concurrently');
    
    // Cleanup
    await stopStream1Btn.click();
    await stopStream2Btn.click();
  });

  test('should stop one stream while other continues', async ({ page }) => {
    const stream1Counter = page.locator('#stream1Counter');
    const stream2Counter = page.locator('#stream2Counter');
    const startStream1Btn = page.locator('#startStream1Btn');
    const startStream2Btn = page.locator('#startStream2Btn');
    const stopStream1Btn = page.locator('#stopStream1Btn');
    const stopStream2Btn = page.locator('#stopStream2Btn');
    
    console.log('[DEBUG_LOG] Testing independent stream lifecycle');
    
    // Start both streams
    await startStream1Btn.click();
    await startStream2Btn.click();
    await page.waitForTimeout(500);
    
    // Verify both are running
    const stream1Count1 = parseInt(await stream1Counter.textContent() || '0');
    const stream2Count1 = parseInt(await stream2Counter.textContent() || '0');
    expect(stream1Count1).toBeGreaterThan(0);
    expect(stream2Count1).toBeGreaterThan(0);
    console.log(`[DEBUG_LOG] Both streams started: S1=${stream1Count1}, S2=${stream2Count1}`);
    
    // Stop stream 1
    await stopStream1Btn.click();
    await page.waitForTimeout(300);
    
    const stream1Stopped = parseInt(await stream1Counter.textContent() || '0');
    const stream2AfterStop1 = parseInt(await stream2Counter.textContent() || '0');
    
    console.log(`[DEBUG_LOG] After stopping S1: S1=${stream1Stopped}, S2=${stream2AfterStop1}`);
    
    // Verify stream 2 continues while stream 1 stopped
    await page.waitForTimeout(500);
    
    const stream1StillStopped = parseInt(await stream1Counter.textContent() || '0');
    const stream2Continued = parseInt(await stream2Counter.textContent() || '0');
    
    // Stream 1 should not have changed
    expect(stream1StillStopped).toBe(stream1Stopped);
    
    // Stream 2 should have continued incrementing
    expect(stream2Continued).toBeGreaterThan(stream2AfterStop1);
    
    console.log(`[DEBUG_LOG] ✓ Stream 1 stopped (${stream1StillStopped}), Stream 2 continued (${stream2Continued})`);
    
    // Cleanup
    await stopStream2Btn.click();
  });

  test('should handle starting streams at different times', async ({ page }) => {
    const stream1Counter = page.locator('#stream1Counter');
    const stream2Counter = page.locator('#stream2Counter');
    const startStream1Btn = page.locator('#startStream1Btn');
    const startStream2Btn = page.locator('#startStream2Btn');
    const stopStream1Btn = page.locator('#stopStream1Btn');
    const stopStream2Btn = page.locator('#stopStream2Btn');
    
    console.log('[DEBUG_LOG] Testing staggered stream starts');
    
    // Start stream 1 first
    await startStream1Btn.click();
    await page.waitForTimeout(500);
    
    const stream1Count1 = parseInt(await stream1Counter.textContent() || '0');
    const stream2Count1 = parseInt(await stream2Counter.textContent() || '0');
    
    expect(stream1Count1).toBeGreaterThan(0);
    expect(stream2Count1).toBe(0); // Stream 2 not started yet
    
    console.log(`[DEBUG_LOG] After S1 start: S1=${stream1Count1}, S2=${stream2Count1}`);
    
    // Now start stream 2
    await startStream2Btn.click();
    await page.waitForTimeout(500);
    
    const stream1Count2 = parseInt(await stream1Counter.textContent() || '0');
    const stream2Count2 = parseInt(await stream2Counter.textContent() || '0');
    
    expect(stream1Count2).toBeGreaterThan(stream1Count1);
    expect(stream2Count2).toBeGreaterThan(0);
    
    console.log(`[DEBUG_LOG] After S2 start: S1=${stream1Count2}, S2=${stream2Count2}`);
    console.log('[DEBUG_LOG] ✓ Staggered starts working correctly');
    
    // Cleanup
    await stopStream1Btn.click();
    await stopStream2Btn.click();
  });

  test('should handle restarting stopped stream while other runs', async ({ page }) => {
    const stream1Counter = page.locator('#stream1Counter');
    const stream2Counter = page.locator('#stream2Counter');
    const startStream1Btn = page.locator('#startStream1Btn');
    const startStream2Btn = page.locator('#startStream2Btn');
    const stopStream1Btn = page.locator('#stopStream1Btn');
    const stopStream2Btn = page.locator('#stopStream2Btn');
    
    console.log('[DEBUG_LOG] Testing stream restart while other runs');
    
    // Start both streams
    await startStream1Btn.click();
    await startStream2Btn.click();
    await page.waitForTimeout(500);
    
    // Stop stream 1
    await stopStream1Btn.click();
    await page.waitForTimeout(300);
    
    const stream1Stopped = parseInt(await stream1Counter.textContent() || '0');
    console.log(`[DEBUG_LOG] Stream 1 stopped at: ${stream1Stopped}`);
    
    // Restart stream 1
    await startStream1Btn.click();
    await page.waitForTimeout(500);
    
    const stream1Restarted = parseInt(await stream1Counter.textContent() || '0');
    const stream2Running = parseInt(await stream2Counter.textContent() || '0');
    
    // Stream 1 should have incremented from where it left off
    expect(stream1Restarted).toBeGreaterThan(stream1Stopped);
    
    // Stream 2 should still be running
    expect(stream2Running).toBeGreaterThan(0);
    
    console.log(`[DEBUG_LOG] ✓ Stream 1 restarted (${stream1Restarted}), Stream 2 still running (${stream2Running})`);
    
    // Cleanup
    await stopStream1Btn.click();
    await stopStream2Btn.click();
  });

  test('should handle multiple stop/start cycles on both streams', async ({ page }) => {
    const stream1Counter = page.locator('#stream1Counter');
    const stream2Counter = page.locator('#stream2Counter');
    const startStream1Btn = page.locator('#startStream1Btn');
    const startStream2Btn = page.locator('#startStream2Btn');
    const stopStream1Btn = page.locator('#stopStream1Btn');
    const stopStream2Btn = page.locator('#stopStream2Btn');
    
    console.log('[DEBUG_LOG] Testing multiple cycles on both streams');
    
    // Cycle 1: Start both
    await startStream1Btn.click();
    await startStream2Btn.click();
    await page.waitForTimeout(300);
    
    const cycle1S1 = parseInt(await stream1Counter.textContent() || '0');
    const cycle1S2 = parseInt(await stream2Counter.textContent() || '0');
    expect(cycle1S1).toBeGreaterThan(0);
    expect(cycle1S2).toBeGreaterThan(0);
    console.log(`[DEBUG_LOG] Cycle 1: S1=${cycle1S1}, S2=${cycle1S2}`);
    
    // Stop both
    await stopStream1Btn.click();
    await stopStream2Btn.click();
    await page.waitForTimeout(200);
    
    // Cycle 2: Start both again
    await startStream1Btn.click();
    await startStream2Btn.click();
    await page.waitForTimeout(300);
    
    const cycle2S1 = parseInt(await stream1Counter.textContent() || '0');
    const cycle2S2 = parseInt(await stream2Counter.textContent() || '0');
    expect(cycle2S1).toBeGreaterThan(cycle1S1);
    expect(cycle2S2).toBeGreaterThan(cycle1S2);
    console.log(`[DEBUG_LOG] Cycle 2: S1=${cycle2S1}, S2=${cycle2S2}`);
    
    // Stop both
    await stopStream1Btn.click();
    await stopStream2Btn.click();
    await page.waitForTimeout(200);
    
    // Cycle 3: Start both one more time
    await startStream1Btn.click();
    await startStream2Btn.click();
    await page.waitForTimeout(300);
    
    const cycle3S1 = parseInt(await stream1Counter.textContent() || '0');
    const cycle3S2 = parseInt(await stream2Counter.textContent() || '0');
    expect(cycle3S1).toBeGreaterThan(cycle2S1);
    expect(cycle3S2).toBeGreaterThan(cycle2S2);
    console.log(`[DEBUG_LOG] Cycle 3: S1=${cycle3S1}, S2=${cycle3S2}`);
    
    console.log('[DEBUG_LOG] ✓ Multiple cycles completed successfully');
    
    // Cleanup
    await stopStream1Btn.click();
    await stopStream2Btn.click();
  });

  test('should maintain separate stream counters', async ({ page }) => {
    const stream1Counter = page.locator('#stream1Counter');
    const stream2Counter = page.locator('#stream2Counter');
    const startStream1Btn = page.locator('#startStream1Btn');
    const startStream2Btn = page.locator('#startStream2Btn');
    const stopStream1Btn = page.locator('#stopStream1Btn');
    const stopStream2Btn = page.locator('#stopStream2Btn');
    
    console.log('[DEBUG_LOG] Testing stream isolation');
    
    // Start both streams
    await startStream1Btn.click();
    await startStream2Btn.click();
    await page.waitForTimeout(500);
    
    // Get counts
    const stream1Count = parseInt(await stream1Counter.textContent() || '0');
    const stream2Count = parseInt(await stream2Counter.textContent() || '0');
    
    // Both should be > 0 (both running)
    expect(stream1Count).toBeGreaterThan(0);
    expect(stream2Count).toBeGreaterThan(0);
    
    // They should be similar (both started at roughly same time and tick at same rate)
    // But not identical (different stream IDs, slight timing differences)
    const countDifference = Math.abs(stream1Count - stream2Count);
    expect(countDifference).toBeLessThan(10); // Should be close but not exact
    
    console.log(`[DEBUG_LOG] ✓ Stream counters are independent: S1=${stream1Count}, S2=${stream2Count}, diff=${countDifference}`);
    
    // Cleanup
    await stopStream1Btn.click();
    await stopStream2Btn.click();
  });
});
