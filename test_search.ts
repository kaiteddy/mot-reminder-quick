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
        console.log("Failed to parse JSON. Raw output:", stdout.slice(0, 500));
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

    try {
        const urlKeywords = encodeURIComponent("Air Conditioning");
        const searchUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${urlKeywords}&vehicleId=53130`;
        const data1 = await crawlWithCurl("GET", searchUrl, headers);
        console.log("data1.products isArray: ", Array.isArray(data1.products));
        if (Array.isArray(data1.products)) {
            console.log("products array length:", data1.products.length);
            console.log("first item:", data1.products[0]);
        } else {
            console.log("type of products:", typeof data1.products);
        }
    } catch(e:any) {
        console.error(e);
    }
}
run().catch(console.error);
