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

    // Need to set vehicle context again first to trace exact hydra object returned from vehicle-specific-products if we fail to resolve to any products
    console.log("Setting VRM search context...");
    await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        headers,
        JSON.stringify({ vrm: "RE16 RWP", saveToCache: false })
    );

    const specUrl = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/192`; // brake disc
    const baseResData = await crawlWithCurl("GET", specUrl, headers);
    
    console.log("hydra keys:", Object.keys(baseResData));
    if (baseResData['hydra:member']) {
      console.log("hydra:member length", baseResData['hydra:member'].length);
      console.log("member keys:", Object.keys(baseResData['hydra:member'][0] || {}));
      console.log("Has products?", !!baseResData['hydra:member'][0]?.products);
      if (baseResData['hydra:member'][0]?.products) {
         console.log(JSON.stringify(baseResData['hydra:member'][0]?.products).slice(0, 200));
      }
    } else {
        console.log("hydra:member missing entirely?");
    }

}
run().catch(console.error);
