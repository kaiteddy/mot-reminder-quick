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
        throw e;
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

    try {
        const url = "https://api.omnipart.eurocarparts.com/storefront/categories/air-conditioning";
        const res = await crawlWithCurl("GET", url, headers);
        console.log("Children of Air Conditioning:");
        res.children.forEach(c => console.log(c.slug, c.name, "hasChild:", !!c.children?.length));
        
        console.log("Let's fetch the first child");
        const url2 = "https://api.omnipart.eurocarparts.com/" + res.children[0]['@id'];
        const res2 = await crawlWithCurl("GET", url2, headers);
        console.log("First child name:", res2.name);
        console.log("Children of first child:", res2.children ? res2.children.map(c => c.name) : []);
    } catch(e:any) {
        console.error(e);
    }
}
run().catch(console.error);
