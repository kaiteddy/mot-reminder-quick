import "dotenv/config";
import { getAppSetting } from "../server/db";

async function run() {
  const result = await getAppSetting('autodata_tokens');
  if (result) {
    if (result.rawCookies) {
      console.log("YES! We successfully harvested rawCookies!");
      console.log("Cookie preview:", result.rawCookies.substring(0, 100) + "...");
    } else {
      console.log("Tokens exist, but NO rawCookies found yet. Make sure you reloaded the extension and refreshed the Autodata tab!");
    }
  } else {
    console.log("NO TOKENS FOUND IN DB.");
  }
  process.exit(0);
}
run();
