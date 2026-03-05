setTimeout(() => {
    // Collect the keys from localStorage
    const pendoAccountId = localStorage.getItem("_pendo_accountId.8b60a77c-c2de-46b1-522a-52cb6c522d99");
    const pendoSessionId = localStorage.getItem("_pendo_sessionId.8b60a77c-c2de-46b1-522a-52cb6c522d99");
    const awswaf = localStorage.getItem("awswaf_session_storage");
    const nrbaSession = localStorage.getItem("NRBA_SESSION");

    if (awswaf || pendoSessionId) {
        const payload = {
            pendoAccountId,
            pendoSessionId,
            awswaf,
            nrbaSession,
            timestamp: new Date().toISOString()
        };

        console.log("Found Autodata tokens! Sending to local server...", payload);

        // Send to background script which can bypass CORS
        chrome.runtime.sendMessage({
            action: "SEND_TOKENS",
            data: payload
        });
    }
}, 3000);
