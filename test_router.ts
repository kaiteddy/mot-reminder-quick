import 'dotenv/config';
import { omnipartRouter } from './server/routers/omnipart.js';

async function run() {
    try {
        const caller = omnipartRouter.createCaller({});
        // call the exact logic
        const result = await caller.getPartsInfo({
             vehicleId: "4204369",
             vrm: "RE16 RWP",
             categorySlug: "Brake Discs",
             isCustomSearch: true,
             token: "auto"
        });
        console.log("PRODUCTS SIZE:", result.products?.length);

    } catch (e) {
        console.error("RPC Error:", e);
    }
}
run();
