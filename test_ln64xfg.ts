import { getMOTHistory, getLatestMOTExpiry } from "./server/motApi";
import { getVehicleDetails } from "./server/dvlaApi";

async function testLookup() {
  const registration = "LN64XFG";
  
  console.log(`\n=== Testing ${registration} ===\n`);
  
  // Test DVLA API
  console.log("DVLA API:");
  try {
    const dvlaData = await getVehicleDetails(registration);
    console.log(JSON.stringify(dvlaData, null, 2));
  } catch (error: any) {
    console.error("DVLA Error:", error.message);
  }
  
  // Test MOT API
  console.log("\nMOT API:");
  try {
    const motData = await getMOTHistory(registration);
    console.log("MOT Data:", JSON.stringify(motData, null, 2));
    
    if (motData) {
      const expiry = getLatestMOTExpiry(motData);
      console.log("\nMOT Expiry:", expiry);
    }
  } catch (error: any) {
    console.error("MOT Error:", error.message);
  }
}

testLookup();
