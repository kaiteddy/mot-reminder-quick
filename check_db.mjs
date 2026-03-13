import { getAppSetting } from './server/db.ts';
async function run() {
    const token = await getAppSetting('omnipart_jwt_token');
    console.log("Current Token:", token ? token.substring(0, 30) + "..." : "NONE");
}
run();
