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
    return JSON.parse(stdout);
}

(async () => {
    try {
        const token = await getAppSetting('omnipart_jwt_token');
        const clean = token.replace(/^["']|["']$/g, '').trim().replace(/[\n\r]| /g, '');
        const authHeader = `Bearer ${clean}`;
        
        const apiHeaders = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://omnipart.eurocarparts.com",
            "Referer": "https://omnipart.eurocarparts.com/",
            "Authorization": authHeader
        };

        console.log("Fetching /categories/air-conditioning");
        const res = await crawlWithCurl("GET", "https://api.omnipart.eurocarparts.com/storefront/categories/air-conditioning", apiHeaders);
        console.log(JSON.stringify(res, null, 2));

        if (res['@id']) {
            const parts = res['@id'].split('/');
            const catId = parts[parts.length - 1];
            console.log("Cat ID:", catId);
            
            console.log("Fetching vehicle-specific products");
            const prod = await crawlWithCurl("GET", `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${catId}?`, apiHeaders);
            console.log(JSON.stringify(prod['hydra:member']?.[0]?.products ? "Has Products" : prod, null, 2));
            
            if (res.children) {
                console.log("Has children:", res.children.length);
            }
        }
    } catch(e) {
        console.error(e);
    }
})();
