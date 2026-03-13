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
    
    // I noticed they used categories=false in one of their API calls on their page
    // What if we try to navigate the exact CATEGORY endpoint again without ID using SLUG directly? 
    // And see what is returned:
    const slug = "brake-disc";
    const specUrl = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${slug}?`; 
    const sr = await crawlWithCurl("GET", specUrl, headers);
    
    console.log("Keys when passing SLUG directly to vehicle-specific-products:", Object.keys(sr));
    if (sr['hydra:member']) {
         console.log("hydra:member count:", sr['hydra:member'].length);
         if(sr['hydra:member'].length) {
              console.log("Products?", !!sr['hydra:member'][0].products);
         }
    } else {
         console.log("Did not work with slug. Returned", Object.keys(sr));
    }
}
run().catch(console.error);
