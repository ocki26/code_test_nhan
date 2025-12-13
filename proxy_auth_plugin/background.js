
        const config = {
            mode: "fixed_servers",
            rules: {
                singleProxy: { scheme: "http", host: "149.19.197.146", port: parseInt(17188) },
                bypassList: ["localhost", "127.0.0.1"]
            }
        };
        chrome.proxy.settings.set({value: config, scope: 'regular'}, function() {});
        chrome.webRequest.onAuthRequired.addListener(
            (details) => ({ authCredentials: { username: "muaproxy693a2a80171cc", password: "nr0ub0rxvyubr03f" } }),
            {urls: ["<all_urls>"]}, ["blocking"]
        );
        chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: 'disable_non_proxied_udp' });
    