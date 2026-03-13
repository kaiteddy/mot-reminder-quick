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
    let cookieHeader = "";

    if (clean.startsWith("COOKIE_JAR:")) {
        cookieHeader = clean.substring(11).trim();
        let match = cookieHeader.match(/bearer=(eyJ[^;]+)/i);
        if (match) authHeader = `Bearer ${match[1]}`;
    } else {
        clean = clean.replace(/^["']|["']$/g, '').trim();
        clean = clean.replace(/[\n\r]| /g, '');
        
        const lowerClean = clean.toLowerCase();
        if (lowerClean.startsWith("authorization:bearer")) {
            clean = clean.substring(20);
        } else if (lowerClean.startsWith("bearer")) {
            clean = clean.substring(6);
        }
        authHeader = `Bearer ${clean}`;
    }
    
    const apiHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Origin": "https://omnipart.eurocarparts.com",
        "Referer": "https://omnipart.eurocarparts.com/"
    };
    if (authHeader) apiHeaders["Authorization"] = authHeader;
    if (cookieHeader) apiHeaders["Cookie"] = cookieHeader;

    console.log("Setting vehicle session via vehicle ID 78165...");
    try {
        const vIdRes = await crawlWithCurl(
            "POST",
            "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vehicle-id",
            apiHeaders,
            JSON.stringify({ vehicleId: 78165, saveToCache: false })
        );
        console.log("Response:", vIdRes);
    } catch(e) {
        console.log("Error:", e);
    }
}
run();
