
        const config = {
            mode: "fixed_servers",
            rules: {
                singleProxy: {
                    scheme: "http", 
                    host: "206.125.175.49",
                    port: parseInt(27415)
                },
                bypassList: ["localhost"]
            }
        };

        // Ép Chrome nhận config proxy
        chrome.proxy.settings.set({value: config, scope: 'regular'}, function() {});

        // Xử lý Auth
        chrome.webRequest.onAuthRequired.addListener(
            function(details) {
                return {
                    authCredentials: {
                        username: "muaproxy693a2a40d61d8",
                        password: "ladautflufljlrki"
                    }
                };
            },
            {urls: ["<all_urls>"]},
            ["blocking"]
        );
    