import { fetchRichVehicleData } from "../server/sws";
import fs from "fs";

async function run() {
    console.log("Fetching Haynes (SWS) data for LX62UCB...");
    const data = await fetchRichVehicleData("LX62UCB", false);
    fs.writeFileSync("sws_test_lx62ucb.json", JSON.stringify(data, null, 2));
    console.log("Done.");
}

run();
