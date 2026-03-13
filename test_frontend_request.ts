import 'dotenv/config';
import { getAppSetting } from './server/db.js';
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

    // Now testing the backend TRPC logic itself
    // Simulate what the server does:
    const apiHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://omnipart.eurocarparts.com",
        "Referer": "https://omnipart.eurocarparts.com/",
        "Authorization": `Bearer ${clean}`
    };

    // Step 1: Set the session context if VRM was provided
    console.log("Setting VRM via API...");
    await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        apiHeaders,
        JSON.stringify({ vrm: "RE16 RWP", saveToCache: false })
    );

    // Free text search mapped to vehicle (what we do when isCustomSearch = true)
    let categorySlug = "Brake Discs"; // what the UI passes via `sub.name` as `customValue` mapped to `categorySlug`!
    let vehicleId = "4204369";

    const urlKeywords = encodeURIComponent(categorySlug || "");
    const searchUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${urlKeywords}&vehicleId=${vehicleId || ""}`;
    console.log("CURLING:", searchUrl);
    
    const searchData = await crawlWithCurl("GET", searchUrl, apiHeaders);
    const baseProducts = searchData.products || [];
    
    console.log("FOUND PRODS:", baseProducts.length);
}
run().catch(console.error);
