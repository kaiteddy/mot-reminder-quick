function updateUI() {
    chrome.storage.local.get(['status', 'lastSync', 'tokenPreview'], (data) => {
        const dot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        const tokenText = document.getElementById('tokenText');
        const timeText = document.getElementById('timeText');
        
        if (data.status === 'connected') {
            dot.className = 'dot connected';
            statusText.innerText = 'Connected: Local CRM Online';
            if (data.tokenPreview) tokenText.innerText = data.tokenPreview;
            if (data.lastSync) timeText.innerText = new Date(data.lastSync).toLocaleString();
        } else if (data.status === 'disconnected') {
            dot.className = 'dot';
            statusText.innerText = 'Disconnected: Local CRM Offline';
            if (data.tokenPreview) tokenText.innerText = data.tokenPreview;
            if (data.lastSync) timeText.innerText = new Date(data.lastSync).toLocaleString();
        }
    });
}

// Initial draw
updateUI();

// Polling for live status
setInterval(updateUI, 1000);
