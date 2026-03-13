import 'dotenv/config';
import { appRouter } from './server/routers/_app.js';
import { getAppSetting } from './server/db.js';

async function run() {
    console.log("Starting test_router...");
    try {
        const token = await getAppSetting('omnipart_jwt_token') as string;
        let clean = token ? token.replace(/^["']|["']$/g, '').trim().replace(/[\n\r]| /g, '') : "auto";
        
        const caller = appRouter.createCaller({});
        // call the exact logic
        const result = await caller.omnipart.lookupParts({
             vehicleId: "4204369",
             vrm: "RE16 RWP",
             categorySlug: "Brake Discs",
             isCustomSearch: true,
             token: clean
        });

        console.log("PRODUCTS SIZE:", result.products?.length);
        if (result.products && result.products.length > 0) {
             console.log("First product:", JSON.stringify(result.products[0]).slice(0, 200));
        } else {
             console.log("FULL RAW RESULT:", JSON.stringify(result).slice(0, 1000));
        }

    } catch (e) {
        console.error("RPC Error:", e);
    }
}
run();
