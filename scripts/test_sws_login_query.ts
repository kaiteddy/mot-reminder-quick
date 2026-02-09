
async function testLoginQuery() {
    console.log("Testing Login on Query endpoint...");
    const url = "https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php?APIKey=C94A0F3F12E88DB916C008B069E34F65&ACTION=login&username=GarageAssistantGA4&password=HGu76XT5sI1L0XgH816X72F34R991Zd_4g";

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
            'User-Agent': 'Garage Assistant/4.0'
        }
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Response:", text);
}

testLoginQuery().catch(console.error);
