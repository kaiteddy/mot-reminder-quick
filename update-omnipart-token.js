import { chromium } from 'playwright';

async function run() {
    console.log("=========================================");
    console.log("   Omnipart Automated Token Harvester");
    console.log("=========================================\n");
    console.log("Booting up headless browser to bypass ECP Firewalls...");

    const browser = await chromium.launch({ headless: false }); // Needs to be false to bypass Cloudflare
    const page = await browser.newPage();
    
    // Set realistic User-Agent
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8'
    });

    let harvestedToken = null;

    // Listen to all network requests to catch the Bearer token as soon as it's sent!
    page.on('request', async request => {
        try {
            const url = request.url();
            const headers = await request.allHeaders();
            const auth = headers['authorization'];
            if (auth && auth.toLowerCase().startsWith('bearer ey')) {
                const token = auth.substring(7).trim();
                // A valid JWT is reasonably long
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
            const headers = await response.allHeaders();
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
        await page.goto('https://omnipart.eurocarparts.com/');
        console.log("Navigated to Euro Car Parts!");
        console.log("Locating the sign in button...");
        
        // Wait for cookie banner
        try {
            const cookieBtn = await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 3000 });
            if (cookieBtn) await cookieBtn.click();
        } catch(e) {}
        
        await page.click('a[href="/account/login"]');
        
        console.log("\nLogging in automatically with your credentials...");
        
        const emailSelector = 'input#email';
        const passSelector = 'input#password';
        
        await page.waitForSelector(emailSelector, { timeout: 10000 });
        
        await page.type(emailSelector, 'eli@elimotors.co.uk', { delay: 50 });
        await page.type(passSelector, 'Rutstein8029', { delay: 50 });
        
        console.log("\n⚠️ Please complete the 'I'm not a robot' CAPTCHA and manually click 'Sign In'!");
        console.log("Waiting for the JWT Token to appear in your session... (Timeout is 3 minutes)");

        // Wait up to 3 minutes for the user to log in and the token to be captured
        for (let i = 0; i < 90; i++) {
            await page.waitForTimeout(2000);
            
            if (harvestedToken) {
                break;
            }
            
            // Scan ALL localStorage and sessionStorage keys for JWTs
            try {
                const lsRaw = await page.evaluate(() => JSON.stringify(localStorage));
                const ls = JSON.parse(lsRaw || "{}");
                for (let key in ls) {
                    if (ls[key] && ls[key].includes('eyJ')) {
                        const match = ls[key].match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
                        if (match && !harvestedToken) {
                            let isTradeToken = false;
                            try {
                                const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64').toString());
                                if (payload.username && payload.username.includes('@') && !payload.guest_user) {
                                    isTradeToken = true;
                                }
                            } catch(e) {}
                            
                            if (isTradeToken) {
                                harvestedToken = match[0];
                                console.log("\n✅ SUCCESS! Found Token hidden in browser storage under key: " + key);
                                break;
                            }
                        }
                    }
                }
            } catch(e) {}
            
            // Check cookies!
            try {
                const cookies = await page.context().cookies();
                for (let c of cookies) {
                    if (c.value.includes('eyJ')) {
                        const result = c.value.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
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
                                console.log("\n✅ SUCCESS! Found token hidden inside a session cookie!");
                                break;
                            }
                        }
                    }
                }
            } catch(e) {}
            
            // If we are logged in but haven't made an API call yet, let's force an API call by going to the dashboard
            try {
                const url = page.url();
                if (!url.includes('login') && !harvestedToken && i > 5) {
                    console.log("Looks like we logged in! Please wait, browsing to force token generation...");
                    
                    // Let's actually navigate the page to trigger an API call correctly
                    await page.click('a[href="/store/basket"]').catch(e=>e);
                    await page.waitForTimeout(2000);
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
