
import { fetchRichVehicleData } from "../server/sws";

async function testSubjects() {
    const vrm = "LN64XFG";
    console.log(`Testing Subjects for ${vrm}...`);
    const data = await fetchRichVehicleData(vrm);
    if (data.raw && data.raw["0"] && data.raw["0"].TechnicalData) {
        const subjects = data.raw["0"].TechnicalData.subjects;
        console.log("Subjects Type:", typeof subjects);
        console.log("Subjects Content:", JSON.stringify(subjects));
    }
}

testSubjects().catch(console.error);
