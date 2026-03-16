import 'dotenv/config';
import { chromium } from 'playwright';
    console.log("Starting browser...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let interceptedTokens: string[] = [];
    
    // Log all requests from omnipart api
    page.on('request', request => {
        if (request.url().includes('api.omnipart') || request.url().includes('vehicle-specific-products')) {
            console.log(`[REQUEST] ${request.method()} ${request.url()}`);
            console.log('HEADERS:', JSON.stringify(request.headers(), null, 2));
            const data = request.postData();
            if (data) console.log('POSTDATA:', data);
        }
    });

    page.on('response', async response => {
        if (response.url().includes('api.omnipart') && !response.url().includes('/search')) {
            console.log(`[RESPONSE] ${response.status()} ${response.url()}`);
            if (response.url().includes('vehicle-specific-products')) {
                 try {
                     const text = await response.text();
                     console.log(`[RESPONSE BODY] ${text.substring(0, 500)}`);
                 } catch(e) {}
            }
        }
    });

    console.log("Navigating to Omnipart...");
    await page.goto('https://omnipart.eurocarparts.com/');
    await page.waitForTimeout(3000); // Wait for load

    // We can't actually log in easily without ReCaptcha passing, but maybe we can just do a guest vehicle search?
    // Let's use an existing valid token from the DB!
    const { getAppSetting } = await import('./server/db');
    const dbTokenStr = await getAppSetting('omnipart_jwt_token');
    
    if (dbTokenStr && dbTokenStr.includes('eyJ')) {
        let actualToken = dbTokenStr;
        if (dbTokenStr.startsWith('COOKIE_JAR:')) {
            const m = dbTokenStr.match(/bearer=(eyJ[^;]+)/i);
            if (m) actualToken = m[1];
        } else {
             actualToken = dbTokenStr.replace(/^Bearer /i, '').trim();
        }
        console.log("Got token from DB. Injeecting it to session storage...");
        
        await page.evaluate((token) => {
            sessionStorage.setItem('token', token);
        }, actualToken);
        
        console.log("Reloading explicitly...");    
        await page.reload();
        await page.waitForTimeout(5000);
        
        console.log("Trying to enter VRM...");
        try {
            await page.fill('input[name="vrm"]', 'RF67NRO');
        } catch(e) {
            console.log("Fallback input selector:", JSON.stringify(e.message));
            try {
                 await page.fill('.vrm-input', 'RF67NRO');
            } catch(e2) {}
        }
        await page.click('button:has-text("Search")');
        await page.waitForTimeout(3000);
        
        console.log("Trying to click Braking...");
        try {
            await page.click('text="Braking"');
        } catch(e) {
            console.log("Couldn't click Braking", e.message);
        }
        await page.waitForTimeout(2000);

        console.log("Trying to click Brake Discs...");
        try {
            await page.click('text="Brake Disc"');
            await page.waitForTimeout(5000);
        } catch(e) {
            console.log("Couldn't click Brake Disc", e.message);
        }
    } else {
        console.log("No valid token in DB to test with.");
    }

    await browser.close();

