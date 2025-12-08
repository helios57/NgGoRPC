import { test, expect } from '@playwright/test';

test('should handle large metadata (15KB)', async ({ page }) => {
    // Navigate and wait for connection
    await page.goto('/', {waitUntil: 'networkidle'});
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#status')).toContainText('Connected', {timeout: 10000});

    const result: any = await page.evaluate(async () => {
        const component = (window as any).appComponent;
        const GreeterDefinition = (window as any).GreeterDefinition;
        
        if (!component || !GreeterDefinition) {
            return { success: false, error: 'Component or GreeterDefinition not found' };
        }

        // Create large metadata (15KB) - Protocol limit is 16KB for HEADERS frame
        const largeValue = 'M'.repeat(15 * 1024); 
        const metadata = { 'large-key': largeValue };

        const transport = component.createTransport();
        const observable = transport.request(
            GreeterDefinition,
            GreeterDefinition.methods.sayHello,
            { name: 'MetadataTester' },
            metadata
        );

        return new Promise((resolve) => {
            observable.subscribe({
                next: (res: any) => resolve({ success: true, response: res }),
                error: (err: any) => resolve({ success: false, error: err.message || String(err) }),
                complete: () => {}
            });
        });
    });

    if (!result.success) {
        console.log('Metadata test failed with error:', result.error);
    }

    expect(result.success).toBe(true);
    expect(result.response.message).toBe('Hello, MetadataTester!');
});
