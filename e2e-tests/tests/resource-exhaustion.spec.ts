import { test, expect } from '@playwright/test';

/**
 * Resource Exhaustion (DoS Protection) E2E Test Suite
 * 
 * Goal: Verify that the system handles resource exhaustion scenarios gracefully.
 * Tests concurrent stream limits and ensures proper error handling when limits are exceeded.
 * 
 * Note: The default gRPC stream limit is typically 100 concurrent streams per connection.
 * This test attempts to open 105 streams to verify proper handling of the limit.
 */

test.describe('Resource Exhaustion Protection', () => {
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

  test('should handle many concurrent streams (stress test with 50 streams)', async ({ page }) => {
    console.log('[DEBUG_LOG] Testing 50 concurrent streams');
    
    const numStreams = 50;
    const streamCounters: any[] = [];
    
    // Start 50 concurrent InfiniteTicker streams via browser code
    const result = await page.evaluate(async (count) => {
      const component = (window as any).appComponent;
      if (!component) {
        return { success: false, error: 'Component not found' };
      }
      
      const streams: any[] = [];
      const counters: number[] = [];
      let errors = 0;
      
      try {
        for (let i = 0; i < count; i++) {
          const transport = component.createTransport();
          
          // Get GreeterDefinition from the window (exposed by the demo app)
          const GreeterDefinition = (window as any).GreeterDefinition;
          if (!GreeterDefinition) {
            return { success: false, error: 'GreeterDefinition not found' };
          }
          
          // Start InfiniteTicker stream using the new typed API
          const observable = transport.request(
            GreeterDefinition,
            GreeterDefinition.methods.infiniteTicker
          );
          
          counters[i] = 0;
          
          const subscription = observable.subscribe({
            next: (data: any) => {
              counters[i]++;
            },
            error: (err: any) => {
              console.error(`[DEBUG_LOG] Stream ${i} error:`, err);
              errors++;
            },
            complete: () => {
              console.log(`[DEBUG_LOG] Stream ${i} completed`);
            }
          });
          
          streams.push(subscription);
        }
        
        // Let streams run for a bit
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Count how many streams are receiving data
        const activeStreams = counters.filter(c => c > 0).length;
        
        // Cleanup
        streams.forEach(s => s.unsubscribe());
        
        return {
          success: true,
          totalStreams: count,
          activeStreams,
          errors,
          counters: counters.slice(0, 10) // Return first 10 for debugging
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }, numStreams);
    
    console.log(`[DEBUG_LOG] Result:`, JSON.stringify(result, null, 2));
    
    expect(result.success).toBe(true);
    expect(result.activeStreams).toBeGreaterThan(40); // At least 80% should be active
    
    console.log(`[DEBUG_LOG] ✓ Successfully handled ${result.activeStreams}/${numStreams} concurrent streams`);
  });

  test('should handle extreme concurrent stream load (100 streams)', async ({ page }) => {
    console.log('[DEBUG_LOG] Testing 100 concurrent streams (near limit)');
    
    const numStreams = 100;
    
    const result = await page.evaluate(async (count) => {
      const component = (window as any).appComponent;
      if (!component) {
        return { success: false, error: 'Component not found' };
      }
      
      const GreeterDefinition = (window as any).GreeterDefinition;
      if (!GreeterDefinition) {
        return { success: false, error: 'GreeterDefinition not found' };
      }
      
      const streams: any[] = [];
      const counters: number[] = [];
      let errors = 0;
      let errorMessages: string[] = [];
      
      try {
        for (let i = 0; i < count; i++) {
          try {
            const transport = component.createTransport();
            
            // Start InfiniteTicker stream using the new typed API
            const observable = transport.request(
              GreeterDefinition,
              GreeterDefinition.methods.infiniteTicker
            );
            
            counters[i] = 0;
            
            const subscription = observable.subscribe({
              next: (data: any) => {
                counters[i]++;
              },
              error: (err: any) => {
                errors++;
                errorMessages.push(`Stream ${i}: ${err.message || err}`);
              },
              complete: () => {}
            });
            
            streams.push(subscription);
          } catch (err: any) {
            errors++;
            errorMessages.push(`Stream ${i} creation: ${err.message}`);
          }
        }
        
        // Let streams run
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const activeStreams = counters.filter(c => c > 0).length;
        
        // Cleanup
        streams.forEach(s => {
          try {
            s.unsubscribe();
          } catch (e) {
            // Ignore cleanup errors
          }
        });
        
        return {
          success: true,
          totalStreams: count,
          activeStreams,
          errors,
          errorMessages: errorMessages.slice(0, 5) // First 5 errors
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }, numStreams);
    
    console.log(`[DEBUG_LOG] Result:`, JSON.stringify(result, null, 2));
    
    expect(result.success).toBe(true);
    
    // We expect most streams to work, but some may fail due to resource limits
    // At least 70% should be functional
    expect(result.activeStreams).toBeGreaterThan(70);
    
    console.log(`[DEBUG_LOG] ✓ Handled ${result.activeStreams}/${numStreams} streams with ${result.errors} errors`);
    
    if (result.errors > 0) {
      console.log(`[DEBUG_LOG] Sample errors:`, result.errorMessages);
    }
  });

  test('should gracefully handle exceeding stream limits (105 streams)', async ({ page }) => {
    console.log('[DEBUG_LOG] Testing 105 concurrent streams (exceeding typical limit)');
    
    const numStreams = 105;
    
    const result = await page.evaluate(async (count) => {
      const component = (window as any).appComponent;
      if (!component) {
        return { success: false, error: 'Component not found' };
      }
      
      const GreeterDefinition = (window as any).GreeterDefinition;
      if (!GreeterDefinition) {
        return { success: false, error: 'GreeterDefinition not found' };
      }
      
      const streams: any[] = [];
      const counters: number[] = [];
      let errors = 0;
      let errorMessages: string[] = [];
      let resourceExhaustedErrors = 0;
      
      try {
        for (let i = 0; i < count; i++) {
          try {
            const transport = component.createTransport();
            
            const observable = transport.request(
              GreeterDefinition,
              GreeterDefinition.methods.infiniteTicker
            );
            
            counters[i] = 0;
            
            const subscription = observable.subscribe({
              next: (data: any) => {
                counters[i]++;
              },
              error: (err: any) => {
                errors++;
                const errMsg = err.message || String(err);
                errorMessages.push(`Stream ${i}: ${errMsg}`);
                
                // Check for resource exhaustion indicators
                if (errMsg.includes('RESOURCE_EXHAUSTED') || 
                    errMsg.includes('too many') || 
                    errMsg.includes('limit')) {
                  resourceExhaustedErrors++;
                }
              },
              complete: () => {}
            });
            
            streams.push(subscription);
          } catch (err: any) {
            errors++;
            const errMsg = err.message || String(err);
            errorMessages.push(`Stream ${i} creation: ${errMsg}`);
            
            if (errMsg.includes('RESOURCE_EXHAUSTED') || 
                errMsg.includes('too many') || 
                errMsg.includes('limit')) {
              resourceExhaustedErrors++;
            }
          }
          
          // Small delay between stream creations to avoid overwhelming the system
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        
        // Let streams run
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const activeStreams = counters.filter(c => c > 0).length;
        
        // Cleanup
        streams.forEach(s => {
          try {
            s.unsubscribe();
          } catch (e) {}
        });
        
        return {
          success: true,
          totalStreams: count,
          activeStreams,
          errors,
          resourceExhaustedErrors,
          errorMessages: errorMessages.slice(0, 10) // First 10 errors
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }, numStreams);
    
    console.log(`[DEBUG_LOG] Result:`, JSON.stringify(result, null, 2));
    
    expect(result.success).toBe(true);
    
    // We expect some errors when exceeding limits
    // At least 60% should work, and we should see some errors
    expect(result.activeStreams).toBeGreaterThan(60);
    
    console.log(`[DEBUG_LOG] ✓ Handled ${result.activeStreams}/${numStreams} streams`);
    console.log(`[DEBUG_LOG] Total errors: ${result.errors}, Resource exhausted errors: ${result.resourceExhaustedErrors}`);
    
    if (result.errors > 0) {
      console.log(`[DEBUG_LOG] Sample errors:`, result.errorMessages);
    }
    
    // The system should gracefully handle the overload
    // Either by allowing all streams (if limit is high enough) or by rejecting some with proper errors
    expect(result.activeStreams + result.errors).toBe(numStreams);
  });

  test('should recover after resource exhaustion', async ({ page }) => {
    console.log('[DEBUG_LOG] Testing recovery after resource exhaustion');
    
    // First, create many streams
    await page.evaluate(async () => {
      const component = (window as any).appComponent;
      if (!component) return;
      
      const GreeterDefinition = (window as any).GreeterDefinition;
      if (!GreeterDefinition) return;
      
      const streams: any[] = [];
      
      // Create 50 streams
      for (let i = 0; i < 50; i++) {
        try {
          const transport = component.createTransport();
          const observable = transport.request(
            GreeterDefinition,
            GreeterDefinition.methods.infiniteTicker
          );
          const subscription = observable.subscribe({});
          streams.push(subscription);
        } catch (err) {
          console.error('Error creating stream:', err);
        }
      }
      
      // Store streams for cleanup
      (window as any).testStreams = streams;
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    });
    
    console.log('[DEBUG_LOG] Created initial stream load');
    
    // Now cleanup
    await page.evaluate(() => {
      const streams = (window as any).testStreams || [];
      streams.forEach((s: any) => {
        try {
          s.unsubscribe();
        } catch (e) {}
      });
      (window as any).testStreams = [];
    });
    
    console.log('[DEBUG_LOG] Cleaned up streams');
    
    // Wait a bit for cleanup
    await page.waitForTimeout(500);
    
    // Now verify we can make a simple RPC call
    const nameInput = page.locator('#greetingNameInput');
    const sayHelloBtn = page.locator('#sayHelloBtn');
    const greetingResponse = page.locator('#greetingResponse');
    
    await nameInput.clear();
    await nameInput.fill('RecoveryTest');
    await sayHelloBtn.click();
    
    await expect(greetingResponse).toHaveText('Hello, RecoveryTest!', { timeout: 5000 });
    
    console.log('[DEBUG_LOG] ✓ System recovered successfully after resource exhaustion');
  });
});
