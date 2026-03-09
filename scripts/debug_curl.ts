import "dotenv/config";
import { execSync } from "child_process";
import { getAppSetting } from "../server/db";

async function run() {
  const session = await getAppSetting("autodata_tokens");
  const cookieParts = session.rawCookies.split(';').map((c: string) => c.trim());
  const uniqueCookies = new Map();
  for (const part of cookieParts) {
    if (!part) continue;
    const splitIndex = part.indexOf('=');
    if (splitIndex === -1) continue;
    uniqueCookies.set(part.substring(0, splitIndex), part.substring(splitIndex + 1));
  }

  const cleanCookies = Array.from(uniqueCookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const cmd = `curl -i -s "https://workshop.autodata-group.com/w2/api/user?v=5c1542c252dd2c6f7e257b2dd19f2c09390a570f&language=en-gb" \\
  -H "authority: workshop.autodata-group.com" \\
  -H "accept: application/json" \\
  -H "accept-language: en-GB,en-US;q=0.9,en;q=0.8" \\
  -H "cookie: ${cleanCookies}" \\
  -H "referer: https://workshop.autodata-group.com/w2/engine-oil/TOY43021%3Fvrm%3DRE71VOD" \\
  -H 'sec-ch-ua: "Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"' \\
  -H "sec-ch-ua-mobile: ?0" \\
  -H 'sec-ch-ua-platform: "macOS"' \\
  -H "sec-fetch-dest: empty" \\
  -H "sec-fetch-mode: cors" \\
  -H "sec-fetch-site: same-origin" \\
  -H "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36" \\
  -H "xhr-request-from: workshop"`;

  try {
    const output = execSync(cmd, { shell: "/bin/bash", stdio: "pipe" });
    console.log("Output:\n", output.toString());
  } catch (err: any) {
  }
  process.exit(0);
}
run();
