chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SEND_TOKENS") {
        // Here we send it to your local dev app.
        // For production, change to: https://your-production-url.com/api/webhooks/autodata
        fetch("http://localhost:3000/api/webhooks/autodata", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(message.data)
        })
            .then(res => res.json())
            .then(data => console.log("Tokens securely saved on backend!", data))
            .catch(err => console.error("Failed to sync tokens:", err));
    }
});
