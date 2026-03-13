import 'dotenv/config';
import { getAppSetting } from './server/db.js';
import { omnipartRouter } from './server/routers/omnipart.js';

// We can bypass trpc and just call the raw logic if it was exported, but it's part of a router. 
// Just re-import it? No, we can just run a quick script that calls `crawlWithCurl`.
// But wait, what if the `categorySlug` is causing 0 products?

import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

async function crawlWithCurl(method: string, url: string, headers: Record<string, string>, body?: string) {
    let curlCmd = `curl -s -X ${method} "${url}"`;
    for (const [k, v] of Object.entries(headers)) {
        curlCmd += ` -H "${k}: ${v.replace(/"/g, '\\"')}"`;
    }
    if (body) {
        curlCmd += ` -d '${body.replace(/'/g, "'\\''")}'`;
    }
    const { stdout } = await execPromise(curlCmd);
    try {
        return JSON.parse(stdout);
    } catch(e) {
        return { error: 'parse_failed', raw: stdout.slice(0, 500) };
    }
}

async function run() {
    const token = await getAppSetting('omnipart_jwt_token') as string;
    let clean = token.replace(/^["']|["']$/g, '').trim().replace(/[\n\r]| /g, '');
    const apiHeaders = { 
        "Authorization": `Bearer ${clean}`,
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Origin": "https://omnipart.eurocarparts.com",
        "Referer": "https://omnipart.eurocarparts.com/"
    };
    
    // TRPC literally does this:
    const categorySlug = "Brake Discs";  // or "ABS Sensors", "Spark Plugs" 
    const isCustomSearch = true;
    const vehicleId = "4204369"; // RE16 RWP

    if (isCustomSearch) {
        const urlKeywords = encodeURIComponent(categorySlug || "");
        const searchUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${urlKeywords}&vehicleId=${vehicleId || ""}`;
        console.log("FETCHING:", searchUrl);
        const searchData = await crawlWithCurl("GET", searchUrl, apiHeaders);
        console.log("PRODUCTS RETURNED:", searchData?.products?.length);
    }
}
run().catch(console.error);
