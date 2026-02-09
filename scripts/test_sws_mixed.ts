
async function testMixedCase() {
    console.log("Testing Mixed Case on TechnicalData_Module.php...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";

    const body = new URLSearchParams();
    body.append('APIKey', apiKey);
    body.append('action', 'summary');
    body.append('vrm', vrm);

    const response = await fetch("https://www.sws-solutions.co.uk/API-V4/TechnicalData_Module.php", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'GarageManager-Pro/1.0'
        },
        body: body
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Text:", text.substring(0, 500));
}

testMixedCase().catch(console.error);
