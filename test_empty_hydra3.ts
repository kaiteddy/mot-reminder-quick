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

    console.log("Checking /storefront/search instead with human keywords...");
    
    // Instead of querying by ID, let's query the generic search endpoint using the sub-category slug!
    // ECP UI usually converts visually to a text search instead of relying on exact mapped IDs 
    const vrmRes = await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        headers,
        JSON.stringify({ vrm: "RE16 RWP", saveToCache: false })
    );

    const vid = vrmRes.vehicleId || "";

    // What if we just search 'brake discs'?
    const specUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=brake%20discs&vehicleId=${vid}`; 
    const sr = await crawlWithCurl("GET", specUrl, headers);
    
    console.log("Product counts:", sr?.products?.length);

    const specUrl2 = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=brake%20disc&vehicleId=${vid}`; 
    const sr2 = await crawlWithCurl("GET", specUrl2, headers);
    
    console.log("Product counts singular:", sr2?.products?.length);
    
    // And try what happens we search the categorySlug using the `storefront/search` mapped exactly like the text was entered?
    const specUrl3 = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=brake-disc&vehicleId=${vid}`; 
    const sr3 = await crawlWithCurl("GET", specUrl3, headers);
    
    console.log("Product counts slug:", sr3?.products?.length);


}
run().catch(console.error);
