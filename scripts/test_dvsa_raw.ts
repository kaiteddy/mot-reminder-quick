import "dotenv/config";

async function testDVSA() {
    const apiKey = process.env.DVSA_API_KEY;
    const clientId = process.env.DVSA_CLIENT_ID;
    const clientSecret = process.env.DVSA_CLIENT_SECRET;
    const scope = process.env.DVSA_SCOPE_URL;
    const tokenUrl = process.env.DVSA_TOKEN_URL;

    console.log("Testing DVSA OAuth...");

    const params = new URLSearchParams({
        client_id: clientId || "",
        client_secret: clientSecret || "",
        scope: scope || "",
        grant_type: "client_credentials",
    });

    const tokenResponse = await fetch(tokenUrl || "", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
    });

    if (!tokenResponse.ok) {
        console.error("Token Fail:", await tokenResponse.text());
        return;
    }

    const tokenData = await tokenResponse.json();
    console.log("Token received.");

    const reg = "AV06BPE";
    // Trying the TAPI endpoint
    const url = `https://tapi.dvsa.gov.uk/mot-history/v1/trade/vehicles?registration=${reg}`;
    console.log(`Calling MOT History TAPI for ${reg}...`);

    const response = await fetch(url,
        {
            headers: {
                "Authorization": `Bearer ${tokenData.access_token}`,
                "x-api-key": apiKey || "",
                "Accept": "application/json+v6",
            },
        }
    );

    if (response.ok) {
        console.log("DVSA Success!");
        console.log(JSON.stringify(await response.json(), null, 2));
    } else {
        console.error(`DVSA Fail: ${response.status} ${response.statusText}`);
        console.error(await response.text());
    }
}

testDVSA().catch(console.error);
