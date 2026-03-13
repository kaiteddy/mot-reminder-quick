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
    
    // Test the node we click, like brake discs
    const url = "https://api.omnipart.eurocarparts.com/storefront/categories/brake-disc";
    const data = await crawlWithCurl("GET", url, headers);
    
    console.log("CATEGORY NAME:", data?.name);
    console.log("CHILDREN?", Array.isArray(data?.children) ? data?.children?.map((c: any) => c.categoryName) : 'NO CHILDREN');
    
    // Now if it has NO children, but it IS a category leaf, we should be using its @id
    console.log("@id:", data['@id']);

    if (data['@id']) {
        const parts = data['@id'].split('/');
        const categoryId = parts[parts.length - 1];
        
        console.log("TESTING GET PRODUCTS ON CATID:", categoryId);
        
        const url2 = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${categoryId}?`;
        const pagedata = await crawlWithCurl("GET", url2, headers);
        
        console.log("Product data response keys:", Object.keys(pagedata));
        if (pagedata['hydra:member']) {
            console.log("hydra:member length:", pagedata['hydra:member'].length);
        } else {
            console.log(pagedata);
        }
    }
}
run().catch(console.error);
