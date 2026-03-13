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
    const headers = { 
        "Authorization": `Bearer ${clean}`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://omnipart.eurocarparts.com",
        "Referer": "https://omnipart.eurocarparts.com/"
    };

    // Note: The previous call didn't get parts. I noticed the site itself calls /storefront/search instead of vehicle-specific products sometimes! Let's check when passing categoryslug to the search endpoint.
    console.log("Checking /storefront/search for brake discs...");
    
    // Using vehicleId for RE16 RWP (got from ui testing earlier if known, otherwise we re-fetch)
    const vrmRes = await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        headers,
        JSON.stringify({ vrm: "RE16 RWP", saveToCache: false })
    );

    const vid = vrmRes.vehicleId || "";
    
    // Instead of querying by ID, let's query the generic search endpoint using the sub-category slug!
    // Often modern SPA frontends just dump query parameters into a search endpoint
    const specUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=brake-disc&vehicleId=${vid}`; 
    const sr = await crawlWithCurl("GET", specUrl, headers);
    
    console.log("search results keys:", Object.keys(sr));
    if (sr.products) {
        console.log("Product counts:", sr.products.length);
        if (sr.products.length > 0) {
            console.log("first item sku:", sr.products[0].sku);
        }
    }

}
run().catch(console.error);
