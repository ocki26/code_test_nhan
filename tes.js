const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");

// ==============================================================================
// 1. CẤU HÌNH
// ==============================================================================
const CHROME_PATH = String.raw`E:\chrome\My_browserr\chrome.exe`;
const RAW_PROXY = "206.125.175.49:27415:muaproxy693a2a40d61d8:ladautflufljlrki";

// --- HÀM PARSE PROXY (HTTP MODE) ---
function parseProxyConfig(raw) {
  const parts = raw.split(":");
  if (parts.length === 4) {
    const [ip, port, user, pwd] = parts;

    return {
      ip,
      port,
      user,
      pwd,
      // URL Proxy dạng HTTP
      pwServer: `http://${ip}:${port}`,
      // URL Check IP (cho axios)
      checkUrl: `http://${user}:${pwd}@${ip}:${port}`,
    };
  }
  return null;
}

const PROXY_CONF = parseProxyConfig(RAW_PROXY);

// ==============================================================================
// 2. TẠO EXTENSION XỬ LÝ AUTH (HTTP SCHEME)
// ==============================================================================
function createProxyAuthExtension(host, port, user, pass) {
  const pluginDir = path.resolve("./proxy_auth_plugin");
  if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir);

  const manifest = {
    manifest_version: 3,
    name: "Proxy Auth Helper",
    version: "1.0.0",
    permissions: [
      "proxy",
      "tabs",
      "unlimitedStorage",
      "storage",
      "<all_urls>",
      "webRequest",
      "webRequestAuthProvider",
    ],
    host_permissions: ["<all_urls>"],
    background: { service_worker: "background.js" },
  };

  // Background Script: Chú ý scheme là "http"
  const backgroundJs = `
        const config = {
            mode: "fixed_servers",
            rules: {
                singleProxy: {
                    scheme: "http", 
                    host: "${host}",
                    port: parseInt(${port})
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
                        username: "${user}",
                        password: "${pass}"
                    }
                };
            },
            {urls: ["<all_urls>"]},
            ["blocking"]
        );
    `;

  fs.writeFileSync(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  fs.writeFileSync(path.join(pluginDir, "background.js"), backgroundJs);

  return pluginDir;
}

// ==============================================================================
// 3. CHECK IP
// ==============================================================================
async function getProxyInfo(proxyUrl) {
  console.log(`[*] Checking Proxy: ${proxyUrl.split("@")[1] || proxyUrl}...`);

  // Dùng HttpsProxyAgent cho kết nối HTTP Proxy
  const agent = new HttpsProxyAgent(proxyUrl);

  const axiosConfig = {
    httpsAgent: agent,
    httpAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
  };

  try {
    const resp = await axios.get("http://ip-api.com/json", axiosConfig);
    if (resp.status === 200) {
      console.log(
        `    [OK] IP: ${resp.data.query} | Timezone: ${resp.data.timezone} | Country: ${resp.data.country}`
      );
      return { ip: resp.data.query, timezone: resp.data.timezone };
    }
  } catch (e) {
    console.log(`    [ERR Check IP] ${e.message}`);
  }
  return { ip: null, timezone: null };
}

// ==============================================================================
// 4. LOGIC CHÍNH
// ==============================================================================
async function run() {
  if (!PROXY_CONF) {
    console.error("❌ Cấu hình Proxy sai định dạng (IP:PORT:USER:PASS)");
    return;
  }

  // Check IP
  let { ip: realIp, timezone: realTimezone } = await getProxyInfo(
    PROXY_CONF.checkUrl
  );

  if (!realIp) {
    console.log("[!!!] Proxy timeout/lỗi, thử IP mặc định...");
    realIp = "127.0.0.1";
    realTimezone = "Asia/Ho_Chi_Minh";
  }

  const randomId = Math.floor(Math.random() * 8999 + 1000);
  const userDataDir = path.resolve(`./ruyi_live_${randomId}`);

  // Tạo Extension
  console.log("[*] Đang tạo Extension (HTTP Mode)...");
  const extensionPath = createProxyAuthExtension(
    PROXY_CONF.ip,
    PROXY_CONF.port,
    PROXY_CONF.user,
    PROXY_CONF.pwd
  );

  // --- FULL CONFIG RUYI ---
  const ruyiConfig = {
    uaFullVersion: "142.0.7444.177",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    brands: [
      { brand: "Chromium", version: "142" },
      { brand: "Google Chrome", version: "142" },
      { brand: "Not_A Brand", version: "24" },
    ],

    platform: "Windows",
    legacy_platform: "Win32",
    platformVersion: "15.0.0",
    architecture: "x86",
    bitness: "64",
    mobile: false,

    cpu: 16,
    memory: 8.0,
    screen_width: 1920,
    screen_height: 1080,
    screen_availWidth: 1920,
    screen_availHeight: 1040,
    screen_colorDepth: 24,
    screen_pixelDepth: 24,
    devicePixelRatio: 1.0,

    webgl_vendor: "Google Inc. (NVIDIA)",
    webgl_renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    webgl_max_texture_size: 16384,
    webgl_max_cube_map_texture_size: 16384,
    webgl_max_render_buffer: 16384,
    webgl_max_viewport_dims: 16384,
    webgl_max_vertex_texture_image_units: 32,
    webgl_max_texture_image_units: 32,

    webrtc_public_ip: realIp, // Inject IP đã check được
    net_downlink: 10.0,
    net_rtt: 50,
    dnt: "1",
    noise_seed: 12345,
    battery_level: 1.0,
    battery_charging: true,
  };

  const launchArgs = [
    `--ruyi=${JSON.stringify(ruyiConfig)}`,
    "--no-first-run",
    "--disable-infobars",
    "--disable-blink-features=AutomationControlled",
    `--timezone-override=${realTimezone}`,

    // Load Extension
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,

    // Các cờ tối ưu
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--disable-site-isolation-trials",
    "--disable-features=IsolateOrigins,site-per-process",
    "--process-per-site",
  ];

  try {
    console.log(`[*] Mở Browser...`);

    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROME_PATH,
      headless: false,
      args: launchArgs,
      viewport: null,
      locale: "en-US",
      timezoneId: realTimezone,
      ignoreDefaultArgs: ["--enable-automation"],
    });

    const page1 =
      context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    console.log("[*] Tab 1: Browserscan...");
    await page1.goto("https://www.browserscan.net/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("[*] Tab 2: Whoer...");
    const page2 = await context.newPage();
    await page2.goto("https://whoer.net/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("\n>>> DONE. GIỮ CỬA SỔ TRONG 1 GIỜ <<<");
    await new Promise((resolve) => setTimeout(resolve, 3600000));
  } catch (e) {
    console.log(`\n[CRASH] ${e.message}`);
  }
}

if (require.main === module) {
  run();
}
