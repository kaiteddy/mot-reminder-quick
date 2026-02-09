
import { fetchRichVehicleData } from "../server/sws";

async function test() {
    const vrm = "KN62BHO";
    console.log(`Testing SWS for ${vrm}...`);
    const data = await fetchRichVehicleData(vrm);
    if (data.raw) {
        console.log("SubjectsByGroup Keys:", Object.keys(data.raw.subjectsByGroup || {}));
        const lubricantsGroup = data.raw.subjectsByGroup?.["LUBRICANTS"];
        if (lubricantsGroup) {
            console.log("Lubricants Group:", JSON.stringify(lubricantsGroup, null, 2));
        } else {
            console.log("No Lubricants Group found in subjectsByGroup");
        }
    } else {
        console.log("No data returned");
    }
}

test().catch(console.error);
