
import { SWS_CONFIG } from "./server/sws";

async function testLogin() {
    console.log("Testing Login...");
    const body = new URLSearchParams();
    body.append('APIKey', "C94A0F3F12E88DB916C008B069E34F65");
    body.append('ACTION', 'login');
    body.append('username', 'GarageAssistantGA4');
    body.append('password', 'HGu76XT5sI1L0XgH816X72F34R991Zd_4g');

    const response = await fetch("https://www.sws-solutions.co.uk/API-V4/TechnicalData_Module.php", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'Garage Assistant/4.0'
        },
        body: body
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Response:", text);
}

testLogin().catch(console.error);
