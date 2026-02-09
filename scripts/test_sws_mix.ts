
async function testMix() {
    console.log("Testing Mix Style (Query + Basic Auth)...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";

    const url = `https://www.sws-solutions.co.uk/API-V4/TechnicalData_Module.php?APIKey=${apiKey}&ACTION=summary&VRM=${vrm}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'GarageManager-Pro/1.0'
        }
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Text:", text.substring(0, 500));
}

testMix().catch(console.error);
