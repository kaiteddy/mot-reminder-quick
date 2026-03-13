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
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Origin": "https://omnipart.eurocarparts.com",
        "Referer": "https://omnipart.eurocarparts.com/"
    };
    console.log("WAIT 2s for stealth");
    await new Promise(r => setTimeout(r, 2000));

    console.log("Setting VRM search context...");
    const cr = await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        headers,
        JSON.stringify({ vrm: "RE16 RWP", saveToCache: false })
    );

    const vid = cr.vehicleId;
    console.log("Vid:", vid);

    const catUrl = "https://api.omnipart.eurocarparts.com/storefront/categories/brake-disc";
    const data = await crawlWithCurl("GET", catUrl, headers);
    
    let rawId = data?.['@id'] || data?.id;
    let catId = "192";
    if (rawId) {
        const parts = rawId.split('/');
        catId = parts[parts.length - 1];
    }
    console.log("catID:", catId);

    // ECP also has a "products" search endpoint natively that handles categories, let's see which structure they use
    // https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/192?
    const specUrl = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${catId}?`;
    const specData = await crawlWithCurl("GET", specUrl, headers);
    
    if (specData.error) {
        console.log("IT REJECTED THE SPECIFIC PRODUCTS REQUEST WITH CLOUDFLARE OR ERROR:", specData.raw);
    } else {
        console.log("IT ALLOWED IT, KEYS:", Object.keys(specData));
        if (specData['hydra:member'] && specData['hydra:member'].length) {
            console.log("Has member[0] products?", !!specData['hydra:member'][0].products);
        }
    }
}
run().catch(console.error);
