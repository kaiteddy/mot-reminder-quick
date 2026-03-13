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
        console.log("Failed to parse JSON. Raw output:", stdout.slice(0, 200));
        throw e;
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

    // try storefront/search?keywords=Air%20Conditioning
    try {
        const data1 = await crawlWithCurl("GET", "https://api.omnipart.eurocarparts.com/storefront/search?keywords=Air%20Conditioning", headers);
        console.log("SEARCH 'Air Conditioning' products length: ", data1.products?.length || 0);
    } catch(e:any) {}

    // try storefront/categories/air-conditioning
    try {
        const data2 = await crawlWithCurl("GET", "https://api.omnipart.eurocarparts.com/storefront/categories/air-conditioning", headers);
        console.log("CATEGORY 'air-conditioning' children length: ", data2.children?.length || 0);
    } catch(e:any) {}
    
    // try storefront/search?keywords=Braking
    try {
        const data3 = await crawlWithCurl("GET", "https://api.omnipart.eurocarparts.com/storefront/search?keywords=Braking", headers);
        console.log("SEARCH 'Braking' products length: ", data3.products?.length || 0);
    } catch(e:any) {}
}
run().catch(console.error);
