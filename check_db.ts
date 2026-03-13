import 'dotenv/config';
import { getAppSetting } from './server/db.ts';
async function run() {
    console.log("Checking DB...");
    const token = await getAppSetting('omnipart_jwt_token');
    console.log("Token:", token ? token.substring(0,30) + "..." : "NONE");
    process.exit(0);
}
run();
