import "dotenv/config";
import { getAppSetting } from "../server/db";

async function test() {
  const session = await getAppSetting("autodata_tokens");
  console.log("rawCookies length:", session?.rawCookies?.length);
  console.log("rawCookies:", session?.rawCookies);
  process.exit(0);
}
test();
