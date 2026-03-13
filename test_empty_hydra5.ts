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
    
    // In our original fix when it was working (before we properly mapped the deep hierarchy), 
    // it was just doing:
    // const searchUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=brake-pad&vehicleId=4204369`;
    // const searchData = await crawlWithCurl("GET", searchUrl, headers);
    // AND IT WORKED! BUT wait, why wouldn't "brake-disc" work?
    const specUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=brake-pad&vehicleId=4204369`; 
    const sr = await crawlWithCurl("GET", specUrl, headers);
    console.log("BRAKE PAD products mapped dynamically?", sr.products ? sr.products.length : 0);
    
    // Test a bunch of mapped EXACT category names on the search endpoint using their human UI name, NOT their SLUG!
    // E.g. when you type "Brake Discs" in ECP search bar!
    const testNames = ["Brake Discs", "Brake Pads", "Air Filter", "Cabin Filter"];
    for(const t of testNames) {
         let prm = encodeURIComponent(t);
         const res = await crawlWithCurl("GET", `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${prm}&vehicleId=4204369`, headers);
         console.log(t, "->", res.products ? res.products.length : "NO PRODUCTS, keys=" + Object.keys(res));
    }
}
run().catch(console.error);
