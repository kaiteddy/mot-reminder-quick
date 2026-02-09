
async function testJsonPost() {
    console.log("Testing JSON POST on TechnicalData_Module.php...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";

    const body = JSON.stringify({
        APIKey: apiKey,
        ACTION: 'summary',
        VRM: vrm
    });

    const response = await fetch("https://www.sws-solutions.co.uk/API-V4/TechnicalData_Module.php", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'GarageManagerPro/1.0'
        },
        body: body
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Text:", text);
}

testJsonPost().catch(console.error);
