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
    
    // So `brake-pad` worked dynamically. What happens if we do BOTH URL methods but with `brake disc` human term?
    // And actually send `isCustom=true` but with the human readable `sub.name` instead of `sub.slug` because `sub.name` like "Brake Pads" 
    // mapped to search works perfectly without having to rely on the ID matching backend buggy behavior.
    console.log("WAIT 2s..");
    await new Promise(r => setTimeout(r, 2000));
    
    // Setting context!
    await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        headers,
        JSON.stringify({ vrm: "RE16 RWP", saveToCache: false })
    );

    const searches = [
       "Brake Pads", "Brake Pad Wear Sensors", "Brake Discs", "Brake Callipers", "Cabin Filter", "Alternator", "Starter Motor", "Headlight Bulb"
    ];
    
    console.log("TESTING ALL SUB NODES AS SEARCHES!!");
    for(const search of searches) {
         let prm = encodeURIComponent(search);
         const res = await crawlWithCurl("GET", `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${prm}&vehicleId=4204369`, headers);
         console.log(search, "=>", res?.products?.length, "products. First item?", res?.products?.[0]?.description);
         await new Promise(r => setTimeout(r, 500));
    }
}
run().catch(console.error);
