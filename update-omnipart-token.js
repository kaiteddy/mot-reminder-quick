import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

async function run() {
    console.log("=========================================");
    console.log("   Omnipart Automated Token Harvester");
    console.log("=========================================\n");
    console.log("Booting up invisible stealth drone to bypass ECP Firewalls...");

    // We can run entirely headless using the new Chrome Headless mode that mimics a real display buffer
    const browser = await puppeteer.launch({ 
        headless: false, // "new" headless mode often bypasses Cloudflare automatically
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--start-maximized',
            '--disable-blink-features=AutomationControlled'
        ] 
    });
    const page = await browser.newPage();
    
    // Set realistic Viewport & User-Agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
    });

    let harvestedToken = null;

    // Listen to all network requests to catch the Bearer token as soon as it's sent!
    page.on('request', async request => {
        try {
            const url = request.url();
            const headers = request.headers();
            const auth = headers['authorization'];
            if (auth && auth.toLowerCase().startsWith('bearer ey')) {
                const token = auth.substring(7).trim();
                if (token.length > 50 && !harvestedToken) {
                    let isTradeToken = false;
                    try {
                        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                        // Real ECP accounts always have an email address as their username, while guests get a UUID
                        if (payload.username && payload.username.includes('@') && !payload.guest_user) {
                            isTradeToken = true;
                        }
                    } catch(e) {}
                    
                    if (isTradeToken) {
                        harvestedToken = token;
                        console.log("\n✅ SUCCESS! Intercepted active JWT Token from network traffic!");
                    }
                }
            }
        } catch(e) {}
    });

    page.on('response', async response => {
        try {
            const headers = response.headers();
            const setCookie = headers['set-cookie'] || '';
            if (setCookie.includes('eyJ')) {
                const result = setCookie.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
                if (result && !harvestedToken) {
                    let isTradeToken = false;
                    try {
                        const payload = JSON.parse(Buffer.from(result[0].split('.')[1], 'base64').toString());
                        if (payload.username && payload.username.includes('@') && !payload.guest_user) {
                            isTradeToken = true;
                        }
                    } catch(e) {}
                    
                    if (isTradeToken) {
                        harvestedToken = result[0];
                        console.log("\n✅ SUCCESS! Intercepted token from Set-Cookie header!");
                    }
                }
            }
        } catch(e) {}
    });

    try {
        await page.goto('https://omnipart.eurocarparts.com/', { waitUntil: 'networkidle2' });
        console.log("Navigated to Euro Car Parts!");
        console.log("Locating the sign in button...");
        
        // Wait for cookie banner
        try {
            await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 3000 });
            await page.click('#onetrust-accept-btn-handler');
            await new Promise(r => setTimeout(r, 1000));
        } catch(e) {}
        
        await page.waitForSelector('a[href="/account/login"]');
        await page.click('a[href="/account/login"]');
        
        console.log("\nInjecting stealth credentials securely...");
        
        const emailSelector = 'input#email';
        const passSelector = 'input#password';
        
        await page.waitForSelector(emailSelector, { timeout: 10000 });
        
        // Type like a slow deliberate human (Stealth bypass)
        await page.type(emailSelector, 'eli@elimotors.co.uk', { delay: 110 });
        await new Promise(r => setTimeout(r, 450));
        await page.type(passSelector, 'Rutstein8029', { delay: 90 });
        await new Promise(r => setTimeout(r, 700));
        
        // Force the invisible recaptcha / trigger standard login process by clicking submit directly
        // We use evaluate since puppeteer click sometimes holds hovering flags
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const submitBtn = buttons.find(b => b.textContent && b.textContent.toLowerCase().includes('sign in'));
            if (submitBtn) submitBtn.click();
        });

        console.log("Submitting login form directly... Tracking API layer...");

        // Wait up to 3 minutes for the token to arrive from the auto-login.
        // It might be blocked by Cloudflare turnstile/captcha — giving user time to solve it in the visual window.
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 1500));
            
            if (harvestedToken) {
                break;
            }
            
            // Re-harvest LocalStorage internally since we're in Puppeteer
            try {
                const lsRaw = await page.evaluate(() => JSON.stringify(window.localStorage));
                const ls = JSON.parse(lsRaw || "{}");
                for (let key in ls) {
                    if (ls[key] && ls[key].includes('eyJ')) {
                        const match = ls[key].match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
                        if (match && !harvestedToken) {
                            try {
                                const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64').toString());
                                if (payload.username && payload.username.includes('@') && !payload.guest_user) {
                                    harvestedToken = match[0];
                                    console.log("\n✅ SUCCESS! Token extracted instantly from raw local storage!");
                                    break;
                                }
                            } catch(e) {}
                        }
                    }
                }
            } catch(e) {}
            
            // Check cookies internally
            try {
                const cookies = await page.cookies();
                for (let c of cookies) {
                    if (c.value.includes('eyJ')) {
                        const result = c.value.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
                        if (result && !harvestedToken) {
                            try {
                                const payload = JSON.parse(Buffer.from(result[0].split('.')[1], 'base64').toString());
                                if (payload.username && payload.username.includes('@') && !payload.guest_user) {
                                    harvestedToken = result[0];
                                    console.log("\n✅ SUCCESS! Token discovered floating in stealth session cookies!");
                                    break;
                                }
                            } catch(e) {}
                        }
                    }
                }
            } catch(e) {}
            
            try {
                const url = page.url();
                if (!url.includes('login') && !harvestedToken && i > 5) {
                    // Let's actually navigate the page to trigger an API call correctly
                    await page.click('a[href="/store/basket"]').catch(e=>e);
                    await new Promise(r => setTimeout(r, 2000));
                    await page.goto('https://omnipart.eurocarparts.com/omnihub').catch(e=>e);
                }
            } catch(e) {}
        }

        if (!harvestedToken) {
            console.error("\n❌ Timeout window closed. Did you successfully log in?");
        } else {
            console.log("Token Preview:", harvestedToken.substring(0, 30) + "...");
            console.log("Injecting token securely into your database...");
            
            try {
                // We use your already-running local MOT Server to save it securely so we don't crash Node modules!
                const res = await fetch("http://localhost:3000/api/webhooks/omnipart", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: harvestedToken })
                });
                
                if (res.ok) {
                    console.log("\n✅ Done! The MOT Check app will immediately begin using this fresh token in the background.");
                    console.log("You can close this window now. Run this script again whenever your token expires.");
                } else {
                    console.error("\n❌ Warning: The MOT App server might be offline, could not save token correctly. Start the MOT App (npm run dev) first!");
                }
            } catch (err) {
                 console.error("Warning: Could not save token correctly.", err.message);
            }
        }
    } catch (e) {
        console.error("An error occurred during harvest:", e.message);
    } finally {
        await browser.close();
    }
}

run();
