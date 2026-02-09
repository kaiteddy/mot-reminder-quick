
import { SWS_CONFIG } from "./server/sws";

async function testTechnicalData() {
    console.log("Testing TECHNICALDATA action...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";
    const url = `https://www.sws-solutions.co.uk/API-V4/TechnicalData_Module.php?APIKey=${apiKey}&ACTION=TECHNICALDATA&VRM=${vrm}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc='
        }
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Length:", text.length);
    console.log("Preview:", text.substring(0, 1000));
}

testTechnicalData().catch(console.error);
