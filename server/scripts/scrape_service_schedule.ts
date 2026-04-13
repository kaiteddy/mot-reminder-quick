// @ts-nocheck

import { getAppSetting } from "../db";

async function run() {
  const sessionString = await getAppSetting("autodata_full_session");
  const session = sessionString ? JSON.parse(sessionString) : null;
  
  if (!session || !(session as any).awswaf) {
    console.log("No active AWS WAF session token found.");
    return;
  }
  
  const tokens = session;
  const awswaf = (tokens as any).awswaf;
  
  let cookieHeader = `aws-waf-token=${awswaf};`;
  
  if ((tokens as any).rawCookies) {
      const match = (tokens as any).rawCookies.match(/SSESS[a-zA-Z0-9]+=[^;]+/);
      if (match) {
          cookieHeader += ` ${match[0]};`;
      }
  }

  try {
    console.log("Querying Autodata Service Schedules for WX67 WSO...");
    // Target a generic or root endpoint to see metadata
    const url = "https://workshop.autodata-group.com/api/widgets/service-schedules?vehicle_id=113063"; 
    
    const res = await fetch(url, {
        headers: {
            "accept": "application/json, text/plain, */*",
            "cookie": cookieHeader,
            "x-requested-with": "XMLHttpRequest"
        }
    });

    if (res.status === 403) {
        console.error("403 Forbidden. Your AWS WAF cookie might have expired or requires a CAPTCHA solve.");
        return;
    }

    const text = await res.text();
    console.log(`Response Status: ${res.status}`);
    try {
        const json = JSON.parse(text);
        console.dir(json, { depth: null });
    } catch {
        console.log("Raw Response:\n", text.slice(0, 1000) + (text.length > 1000 ? "..." : ""));
    }

  } catch (e) {
    console.error("Failed:", e);
  }
}

run();
