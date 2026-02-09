
async function testTSBQuery() {
    console.log("Testing TSB on TechnicalData_Query.php...");
    const vrm = "LN64XFG";
    const apiKey = "C94A0F3F12E88DB916C008B069E34F65";
    const url = `https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php?APIKey=${apiKey}&ACTION=TSB&VRM=${vrm}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'Garage Assistant/4.0'
        }
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Length:", text.length);
    console.log("Text:", text.substring(0, 1000));
}

testTSBQuery().catch(console.error);
