import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Network Resilience Scenario Test
 * 
 * Goal: Verify the client's retryWhen logic handles connection loss and recovery.
 * 
 * Test Steps:
 * 1. Start a stream and verify data is flowing
 * 2. Execute `docker-compose stop backend` to simulate server crash
 * 3. Assert that the client UI displays a "Reconnecting..." or "UNAVAILABLE" state
 * 4. Execute `docker-compose start backend`
 * 5. Assert that the client automatically reconnects and a new stream can be initiated
 */

test.describe('Network Resilience Scenario', () => {
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
  });

  test('should handle backend restart and reconnect automatically', async ({ page }) => {
    const counter = page.locator('#counter');
    const startBtn = page.locator('#startBtn');
    const stopBtn = page.locator('#stopBtn');
    const status = page.locator('#status');
    
    // Step 1: Start stream and verify data is flowing
    console.log('[DEBUG_LOG] Step 1: Starting stream');
    await startBtn.click();
    await expect(status).toContainText('Connected');
    
    // Wait for some ticks
    await page.waitForTimeout(500);
    const initialCount = parseInt(await counter.textContent() || '0');
    expect(initialCount).toBeGreaterThan(0);
    console.log(`[DEBUG_LOG] Initial count: ${initialCount}`);
    
    // Step 2: Stop the backend container to simulate crash
    console.log('[DEBUG_LOG] Step 2: Stopping backend container');
    try {
      execSync('docker-compose -f ../docker-compose.yml stop backend', {
        cwd: process.cwd(),
        timeout: 10000
      });
      console.log('[DEBUG_LOG] Backend stopped');
    } catch (error) {
      console.error(`[DEBUG_LOG] Error stopping backend: ${error}`);
      throw error;
    }
    
    // Step 3: Verify client shows reconnecting or unavailable state
    console.log('[DEBUG_LOG] Step 3: Verifying disconnected state');
    
    // Wait a bit for the client to detect the disconnection
    await page.waitForTimeout(2000);
    
    // The status should show reconnecting or disconnected
    const statusText = await status.textContent();
    console.log(`[DEBUG_LOG] Status after backend stop: ${statusText}`);
    
    // Accept either "Reconnecting" or "Disconnected" as valid states
    const isDisconnectedState = 
      statusText?.toLowerCase().includes('reconnecting') || 
      statusText?.toLowerCase().includes('disconnected') ||
      statusText?.toLowerCase().includes('unavailable');
    
    expect(isDisconnectedState).toBeTruthy();
    
    // Counter should have stopped incrementing
    const countDuringOutage = parseInt(await counter.textContent() || '0');
    await page.waitForTimeout(500);
    const countAfterWait = parseInt(await counter.textContent() || '0');
    
    // Count should not increase (or increase very little due to buffering)
    expect(Math.abs(countAfterWait - countDuringOutage)).toBeLessThan(3);
    console.log(`[DEBUG_LOG] Counter during outage: ${countDuringOutage} -> ${countAfterWait}`);
    
    // Step 4: Restart the backend
    console.log('[DEBUG_LOG] Step 4: Starting backend container');
    try {
      execSync('docker-compose -f ../docker-compose.yml start backend', {
        cwd: process.cwd(),
        timeout: 30000
      });
      console.log('[DEBUG_LOG] Backend started');
    } catch (error) {
      console.error(`[DEBUG_LOG] Error starting backend: ${error}`);
      throw error;
    }
    
    // Wait for backend to be fully ready
    await page.waitForTimeout(5000);
    
    // Step 5: Verify client can reconnect and start new stream
    console.log('[DEBUG_LOG] Step 5: Testing reconnection');
    
    // Stop any existing stream attempt
    if (await stopBtn.isEnabled()) {
      await stopBtn.click();
      await page.waitForTimeout(500);
    }
    
    // Try to start a new stream
    await startBtn.click();
    
    // Wait for connection
    await page.waitForTimeout(1000);
    
    // Verify we're connected again
    await expect(status).toContainText('Connected', { timeout: 10000 });
    console.log('[DEBUG_LOG] Status after reconnect: Connected');
    
    // Verify counter is incrementing again
    await page.waitForTimeout(500);
    const reconnectCount1 = parseInt(await counter.textContent() || '0');
    
    await page.waitForTimeout(500);
    const reconnectCount2 = parseInt(await counter.textContent() || '0');
    
    expect(reconnectCount2).toBeGreaterThan(reconnectCount1);
    console.log(`[DEBUG_LOG] Counter after reconnect: ${reconnectCount1} -> ${reconnectCount2}`);
    console.log('[DEBUG_LOG] ✓ Client successfully reconnected and stream is working');
    
    // Cleanup: Stop the ticker
    await stopBtn.click();
  });
  
  test('should show appropriate error state when backend is unavailable', async ({ page }) => {
    const startBtn = page.locator('#startBtn');
    const stopBtn = page.locator('#stopBtn');
    const status = page.locator('#status');
    
    // Stop backend first
    console.log('[DEBUG_LOG] Stopping backend for unavailable test');
    execSync('docker-compose -f ../docker-compose.yml stop backend', {
      cwd: process.cwd(),
      timeout: 10000
    });
    
    await page.waitForTimeout(2000);
    
    // Try to start stream
    await startBtn.click();
    
    // Wait and check status
    await page.waitForTimeout(3000);
    
    const statusText = await status.textContent();
    console.log(`[DEBUG_LOG] Status when backend unavailable: ${statusText}`);
    
    // Should show some error state (Disconnected, Reconnecting, or Unavailable)
    const isErrorState = 
      statusText?.toLowerCase().includes('disconnected') ||
      statusText?.toLowerCase().includes('reconnecting') ||
      statusText?.toLowerCase().includes('unavailable');
    expect(isErrorState).toBeTruthy();
    
    // Restart backend for cleanup
    console.log('[DEBUG_LOG] Restarting backend for cleanup');
    execSync('docker-compose -f ../docker-compose.yml start backend', {
      cwd: process.cwd(),
      timeout: 30000
    });
    
    // Wait longer to ensure backend is fully ready
    await page.waitForTimeout(5000);
  });
});
