
async function testVrmLookupCamel() {
    console.log("Testing VRM_Lookup with camelCase APIKey...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";

    const body = new URLSearchParams({
        ACTION: 'GET_INITIAL_SUBJECTS',
        VRM: vrm,
        APIKey: apiKey
    });

    const response = await fetch("https://www.sws-solutions.co.uk/API-V4/VRM_Lookup.php", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'GarageManagerPro/1.0'
        },
        body: body
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Text:", text);
}

testVrmLookupCamel().catch(console.error);
