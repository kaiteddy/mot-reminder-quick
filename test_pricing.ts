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
    
    // Setting context!
    await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        headers,
        JSON.stringify({ vrm: "RE16 RWP", saveToCache: false })
    );

    let prm = encodeURIComponent("Brake Discs");
    const res = await crawlWithCurl("GET", `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${prm}&vehicleId=4204369`, headers);
    
    // products is an object acting like an array:
    const baseProducts = Object.values(res.products || {}).slice(0, 3) as any;
    const skus = baseProducts.map((p: any) => p.sku);
    console.log("SKUS TO LOOKUP:", skus);
    
    const queryParams = skus.map((s: string) => `skus[]=${s}`).join('&');
    const priceUrl = `https://api.omnipart.eurocarparts.com/products/product-information?${queryParams}`;
    console.log("PRICE URL:", priceUrl);
    
    const priceRes = await crawlWithCurl("GET", priceUrl, headers);
    
    console.log("PRICE KEYS:", Object.keys(priceRes));
    if (priceRes.error) {
        console.log("ERROR OUTPUT:", priceRes.raw.slice(0, 500));
    } else {
        const mem = priceRes['hydra:member'] || [];
        console.log("PRICING MEM LENGTH:", mem.length);
        if (mem.length) {
            console.log("First pricing price:", mem[0].price);
            console.log("First pricing stock:", mem[0].stock);
        }
    }
}
run().catch(console.error);
