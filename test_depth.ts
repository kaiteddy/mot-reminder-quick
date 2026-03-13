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

    const url = "https://api.omnipart.eurocarparts.com/storefront/categories/brake-pad";
    const data = await crawlWithCurl("GET", url, headers);
    console.log("BRAKE PAD CATEGORY RESULT:", data.name, !!data.children, data['@id']);
    
    // Now try fetching the products directly
    const parts = data['@id'].split('/');
    const catId = parts[parts.length - 1];
    
    const url2 = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${catId}?`;
    console.log("Trying to fetch products for catID...", catId);
    
    // need to set context manually on the API first before vehicle-specific-products will work, 
    // but the test is just to see if the ID maps, which we know it does from backend logic
}
run().catch(console.error);
