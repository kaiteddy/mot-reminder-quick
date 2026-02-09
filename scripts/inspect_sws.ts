
import { fetchRichVehicleData } from "../server/sws";

async function test() {
    const vrm = "S31STK";
    console.log(`Testing SWS for ${vrm}...`);
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";
    const url = `https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php?APIKey=${apiKey}&ACTION=GET_INITIAL_SUBJECTS&VRM=${vrm}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'Garage Assistant/4.0'
        }
    });

    const text = await response.text();
    console.log("Response text length:", text.length);
    const data = JSON.parse(text);
    console.log("Full Data:", JSON.stringify(data, null, 2));
}

test().catch(console.error);
