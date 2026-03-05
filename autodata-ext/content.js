setTimeout(() => {
    // Collect LocalStorage keys
    const pendoAccountId = localStorage.getItem("_pendo_accountId.8b60a77c-c2de-46b1-522a-52cb6c522d99");
    const pendoSessionId = localStorage.getItem("_pendo_sessionId.8b60a77c-c2de-46b1-522a-52cb6c522d99");
    const awswaf = localStorage.getItem("awswaf_session_storage");
    const nrbaSession = localStorage.getItem("NRBA_SESSION");

    // Collect ALL raw cookies (Crucial for the actual 'adw_session' auth)
    const rawCookies = document.cookie;

    if (awswaf || rawCookies) {
        const payload = {
            pendoAccountId,
            pendoSessionId,
            awswaf,
            nrbaSession,
            rawCookies,
            timestamp: new Date().toISOString()
        };

        console.log("Found Autodata tokens & cookies! Sending to backend...", payload);

        chrome.runtime.sendMessage({
            action: "SEND_TOKENS",
            data: payload
        });
    }
}, 3000);
