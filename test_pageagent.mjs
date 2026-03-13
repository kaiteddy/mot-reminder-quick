(async () => {
    try {
        const { PageAgent } = await import('@alibaba/page-agent');
        console.log("Found PageAgent.");
    } catch(e) {
        console.log("PageAgent not installed.");
    }
})();
