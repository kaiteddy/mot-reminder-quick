import { crawlWithCurl } from './server/routers/omnipart';

async function run() {
    try {
        const slug = "brake-disc";
        console.log(`Testing category lookup for: ${slug}`);
        
        const catUrl = `https://api.omnipart.eurocarparts.com/storefront/categories/${slug}`;
        
        // Use auto token
        const { getAppSetting } = await import('./server/db');
        const dbToken = await getAppSetting('omnipart_jwt_token');
        let authHeader = "";
        if (dbToken && typeof dbToken === 'string') {
            if (dbToken.startsWith("COOKIE_JAR:")) {
                const cookieH = dbToken.substring(11).trim();
                let match = cookieH.match(/bearer=(eyJ[^;]+)/i);
                if (match) authHeader = `Bearer ${match[1]}`;
            } else {
                let clean = dbToken.replace(/^["']|["']$/g, '').trim().replace(/[\n\r]| /g, '');
                const lc = clean.toLowerCase();
                if (lc.startsWith("authorization:bearer")) clean = clean.substring(20);
                else if (lc.startsWith("bearer")) clean = clean.substring(6);
                authHeader = `Bearer ${clean}`;
            }
        }
        
        const apiHeaders: Record<string, string> = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
            "Content-Type": "application/json",
        };
        if (authHeader) apiHeaders["Authorization"] = authHeader;
        
        const cookieJar = `/tmp/test_cat.txt`;
        
        console.log("Establishing session...");
        await crawlWithCurl("GET", "https://omnipart.eurocarparts.com/", apiHeaders, null, cookieJar, false);
        
        console.log("Setting vehicle RF67NRO...");
        const vrmRes = await crawlWithCurl("POST", "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm", apiHeaders, JSON.stringify({ vrm: "RF67NRO", saveToCache: false }), cookieJar);
        console.log("VRM RES:", vrmRes.vehicleDetails?.Make);

        console.log("Fetching precise category...");
        const catData = await crawlWithCurl("GET", catUrl, apiHeaders, null, cookieJar);
        
        const rawId = catData['@id'] || catData.id;
        if (!rawId) {
            console.log("NO CATEGORY ID FOUND!");
            return;
        }

        const parts = rawId.split('/');
        const categoryId = parts[parts.length - 1];
        console.log("Determined Category ID:", categoryId);

        console.log("Fetching vehicle specific products...");
        const specUrl = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${categoryId}?`;
        const baseResData = await crawlWithCurl("GET", specUrl, apiHeaders, null, cookieJar);
        
        const member = baseResData['hydra:member'];
        console.log("hydra:member count:", member?.length);

        const products = member?.[0]?.products || {};
        console.log("found nested products object keys:", Object.keys(products).length);
        console.log("Number of SKUS:", Object.values(products).flatMap(x => Object.values(x as any)).length);
        
    } catch (e: any) {
        console.error("ERROR:", e.message);
    }
}

run();
