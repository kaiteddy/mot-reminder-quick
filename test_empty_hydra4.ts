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

    console.log("Setting VRM search context...");
    await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        headers,
        JSON.stringify({ vrm: "RE16 RWP", saveToCache: false })
    );

    // ECP frontend recently updated! It looks like they might just pass vehicle attributes using URL parameters instead of only session state.
    // Try passing category slug via the keyword parameter again but with `&productCategory=brake-disc`
    const specUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=brake-disc&vehicleId=4204369`; 
    const sr = await crawlWithCurl("GET", specUrl, headers);
    
    console.log("Product counts:", sr?.products?.length);

    console.log("Testing vehicle-specific-products exact URL formatting from previous logs");
    const testUrl = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/192?&vehicleId=4204369`;
    const spec = await crawlWithCurl("GET", testUrl, headers);
    
    if (spec.error) console.log("Failed fetching specific:", spec.raw);
    else if (spec['hydra:member']) console.log("Has member:", spec['hydra:member'].length);
    else console.log("Specific response:", Object.keys(spec));

}
run().catch(console.error);
