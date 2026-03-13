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

    const tops = [
        "air-conditioning", "belts-and-chains", "braking", "bulbs", "cables", 
        "clutch-and-transmission", "cooling-and-heating", "electrical-and-ignition", "engine-parts",
        "exhaust-and-turbo", "fuel-and-engine-management", "lubricants-and-fluids", "service-parts",
        "steering", "suspension", "wiper-blades"
    ];

    const allSubcats: any[] = [];

    for(const t of tops) {
        const url = `https://api.omnipart.eurocarparts.com/storefront/categories/${t}`;
        const data = await crawlWithCurl("GET", url, headers);
        if (data && data.children) {
            data.children.forEach((c:any) => {
                 if (c.children) {
                     c.children.forEach((sub:any) => {
                         allSubcats.push({
                            topLevelSlug: t,
                            topLevelTitle: data.name,
                            subgroupTitle: c.categoryName,
                            name: sub.categoryName,
                            slug: sub.categorySlug,
                            image: sub.thumbNail
                         });
                     });
                 }
            });
        }
    }

    console.log(JSON.stringify(allSubcats));
}
run().catch(console.error);
