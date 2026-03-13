import 'dotenv/config';
import { getAppSetting } from './server/db.ts';

async function crawlWithCurl(method: string, url: string, headers: Record<string, string>, bodyStr: string | null = null) {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    let cmd = `curl -s -X ${method} '${url}'`;
    for (const [k, v] of Object.entries(headers)) {
        cmd += ` -H '${k}: ${v.replace(/'/g, "")}'`;
    }
    
    if (bodyStr) {
        cmd += ` --data '${bodyStr.replace(/'/g, "")}'`;
    }
    
    cmd += " -k";
    const { stdout } = await execAsync(cmd);
    return JSON.parse(stdout);
}

async function run() {
    const rawToken = await getAppSetting('omnipart_jwt_token');
    
    let clean = rawToken as string;
    let authHeader = "";

    clean = clean.replace(/^["']|["']$/g, '').trim();
    clean = clean.replace(/[\n\r]| /g, '');
    authHeader = `Bearer ${clean}`;

    const apiHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Origin": "https://omnipart.eurocarparts.com",
        "Referer": "https://omnipart.eurocarparts.com/",
        "Authorization": authHeader
    };

    const vrmRes = await crawlWithCurl(
        "POST",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
        apiHeaders,
        JSON.stringify({ vrm: "NG57YXT", saveToCache: false })
    );

    const resData = await crawlWithCurl(
        "GET",
        "https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/196?",
        apiHeaders
    );
    
    if (resData['hydra:member']) {
        const prods = resData['hydra:member'][0].products;
        let p;
        for (const base in prods) {
            for (const sub in prods[base]) {
                p = prods[base][sub];
                break;
            }
            break;
        }
        console.log("Product from vehicle-specific:", JSON.stringify(p, null, 2));

        const priceResData = await crawlWithCurl(
            "GET",
            `https://api.omnipart.eurocarparts.com/products/product-information?skus[]=${p.sku}`,
            apiHeaders
        );
        console.log("Product from product-information:", JSON.stringify(priceResData['hydra:member']?.[0] || priceResData, null, 2));

    }
}
run();
