// @ts-nocheck

import { testConnection } from "../autodataApi";
import { getAppSetting } from "../db";

async function run() {
  const accountId = await getAppSetting("autodata_tokens").then(res => (res as any)?.pendoAccountId ? JSON.parse((res as any).pendoAccountId).value : null);
  const sessionString = await getAppSetting("autodata_full_session");
  const session = sessionString ? JSON.parse(sessionString) : null;
  if (!session || !(session as any).awswaf) {
    console.log("No valid session found in database with awswaf cookie.");
    return;
  }
  
  const tokens = session;
  const awswaf = (tokens as any).awswaf;
  
  try {
    const res = await fetch(`https://workshop.autodata-group.com/api/customer/${accountId}/vehicles/MERCEDES-BENZ/model/C-CLASS/vrm/WX67WSO`, {
        headers: {
            "accept": "application/json",
            "cookie": `aws-waf-token=${awswaf};`
        }
    });

    const data = await res.json();
    console.log("Live Autodata API response:");
    console.dir(data, { depth: null });
    
    if (data && data.href) {
        console.log(`\nSuccessfully located vehicle API endpoint:\n${data.href}`);
        console.log(`\nNext step: Query this endpoint to get the manufacturer service schedules.`);
    } else {
        // Try falling back to analyzing the root API for endpoint hints
        const htmlRes = await fetch(`https://workshop.autodata-group.com/`, { headers: { cookie: `aws-waf-token=${awswaf};` }});
        const html = await htmlRes.text();
        const apiMatches = html.match(/\/api\/[^"']+/g);
        if (apiMatches) {
            const unique = Array.from(new Set(apiMatches));
            console.log("Found hidden API endpoints in the application code:", unique.slice(0, 10));
        }
    }

  } catch (e) {
    console.error("Failed to query live Autodata:", e);
  }
}

run();
