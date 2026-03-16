import 'dotenv/config';
import { crawlWithCurl } from './server/routers/omnipart.ts';

async function run() {
    try {
        const { getAppSetting } = await import('./server/db.ts');
        const dbToken = await getAppSetting('omnipart_jwt_token');
        let authHeader = "";
        let cookieHeader = "";
        if (dbToken && typeof dbToken === 'string') {
            if (dbToken.startsWith("COOKIE_JAR:")) {
                cookieHeader = dbToken.substring(11).trim();
                let match = cookieHeader.match(/bearer=(eyJ[^;]+)/i);
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
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": "https://omnipart.eurocarparts.com",
            "Referer": "https://omnipart.eurocarparts.com/"
        };
        if (authHeader) apiHeaders["Authorization"] = authHeader;
        if (cookieHeader) apiHeaders["Cookie"] = cookieHeader;
        
        const cookieJar = `/tmp/test_search.txt`;
        const slug = "brake-disc";
        const vehicleId = "148810"; // RF67NRO Kuga
        
        console.log("Establishing session...");
        await crawlWithCurl("GET", "https://omnipart.eurocarparts.com/", apiHeaders, null, cookieJar, false);
        await crawlWithCurl("POST", "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm", apiHeaders, JSON.stringify({ vrm: "RF67NRO", saveToCache: true }), cookieJar);

        apiHeaders["Accept"] = "application/ld+json";
        
        console.log("TRYING /storefront/vehicle-specific-products/192");
        const specUrl1 = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/192`;
        const res1 = await crawlWithCurl("GET", specUrl1, apiHeaders, null, cookieJar, false);
        console.log("1:", res1.substring(0, 500));
        
    } catch (e: any) {
        console.error("ERROR:", e.message);
    }
}
run();
