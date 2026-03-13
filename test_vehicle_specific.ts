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
    
    // We already identified a vehicle recently in this session (the user did)
    // So if the JWT token is still active, maybe we can fetch vehicle-specific products
    // We are testing what GET /storefront/categories/brake-disc returns and how we fetch parts from it
    
    const url = "https://api.omnipart.eurocarparts.com/storefront/categories/brake-disc";
    const data = await crawlWithCurl("GET", url, headers);
    
    console.log("CATEGORY RESULTS:");
    console.log(JSON.stringify(data, null, 2));

}
run().catch(console.error);
