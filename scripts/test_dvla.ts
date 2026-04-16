import "dotenv/config";
import { getVehicleDetails } from "../server/dvlaApi";

async function main() {
    console.log("Checking DVLA vehicle enquiries API");
    const reg = "LX62UCB";
    const data = await getVehicleDetails(reg);
    console.log(JSON.stringify(data, null, 2));
}

main();
