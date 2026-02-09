
import { fetchRichVehicleData } from "../server/sws";

async function test() {
    const vrm = "LN64XFG";
    console.log(`Testing SWS for ${vrm}...`);
    const data = await fetchRichVehicleData(vrm);
    console.log("Full Data:", JSON.stringify(data, null, 2));
}

test().catch(console.error);
