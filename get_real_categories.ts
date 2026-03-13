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

    const tops = [
        "air-conditioning", "belts-and-chains", "braking", "bulbs", "cables", 
        "clutch-and-transmission", "cooling-and-heating", "electrical-and-ignition", "engine-parts",
        "exhaust-and-turbo", "fuel-and-engine-management", "lubricants-and-fluids", "service-parts",
        "steering", "suspension", "wiper-blades"
    ];

    const results: any[] = [];

    for (const slug of tops) {
        try {
            const url = `https://api.omnipart.eurocarparts.com/storefront/categories/${slug}`;
            const res = await crawlWithCurl("GET", url, headers);
            
            if (res.children) {
                for (const child of res.children) {
                    if (child.children) {
                        for (const sub of child.children) {
                            results.push({ name: sub.categoryName, slug: sub.categorySlug, top: slug });
                        }
                    } else if (child.categoryName) {
                        results.push({ name: child.categoryName, slug: child.categorySlug, top: slug });
                    }
                }
            }
        } catch(e:any) {}
    }
    
    console.log(JSON.stringify(results));
}
run().catch(console.error);
