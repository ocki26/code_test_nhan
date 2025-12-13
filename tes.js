const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");

// ==============================================================================
// 1. CẤU HÌNH
// ==============================================================================
// Đường dẫn đến file chrome.exe bạn vừa build xong (trong thư mục out/Release)
const CHROME_PATH = String.raw`D:\chromium\src\out\Release\chrome.exe`;

// Định dạng: IP:PORT:USER:PASS
const RAW_PROXY = "149.19.197.146:17188:muaproxy693a2a80171cc:nr0ub0rxvyubr03f";

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
      // URL Proxy để check IP
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
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
  fs.mkdirSync(pluginDir);

  const manifest = {
    manifest_version: 3,
    name: "Ruyi Proxy Auth",
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

  // Background Script: Force HTTP Proxy và Auth
  const backgroundJs = `
        const config = {
            mode: "fixed_servers",
            rules: {
                singleProxy: {
                    scheme: "http", 
                    host: "${host}",
                    port: parseInt(${port})
                },
                bypassList: ["localhost", "127.0.0.1"]
            }
        };

        // 1. Set Proxy Config
        chrome.proxy.settings.set({value: config, scope: 'regular'}, function() {});

        // 2. Auto Auth
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
        
        // 3. Block WebRTC Leak (Phòng hờ nếu C++ chưa chặn hết)
        chrome.privacy.network.webRTCIPHandlingPolicy.set({
            value: 'disable_non_proxied_udp'
        });
    `;

  fs.writeFileSync(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  fs.writeFileSync(path.join(pluginDir, "background.js"), backgroundJs);

  return pluginDir;
}

// ==============================================================================
// 3. CHECK IP (ĐỂ LẤY IP CHO WEBRTC SPOOF)
// ==============================================================================
async function getProxyInfo(proxyUrl) {
  console.log(`[*] Checking Proxy IP...`);
  const agent = new HttpsProxyAgent(proxyUrl);
  const axiosConfig = {
    httpsAgent: agent,
    httpAgent: agent,
    timeout: 20000,
    validateStatus: () => true,
  };

  try {
    const resp = await axios.get("http://ip-api.com/json", axiosConfig);
    if (resp.status === 200) {
      console.log(
        `    [OK] IP: ${resp.data.query} | Geo: ${resp.data.country} | Timezone: ${resp.data.timezone}`
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
    console.error("❌ Proxy Config Invalid!");
    return;
  }

  // 1. Lấy thông tin IP thật của Proxy
  let { ip: realIp, timezone: realTimezone } = await getProxyInfo(
    PROXY_CONF.checkUrl
  );

  if (!realIp) {
    console.log("⚠️ Không lấy được IP Proxy, WebRTC Spoof có thể bị lệch!");
    realIp = "1.1.1.1"; // Fallback tạm
    realTimezone = "Asia/Ho_Chi_Minh";
  }

  // 2. Tạo User Data Dir ngẫu nhiên
  const randomId = Math.floor(Math.random() * 99999);
  const userDataDir = path.resolve(`./ruyi_profile_${randomId}`);
  console.log(`[*] Profile Dir: ${userDataDir}`);

  // 3. Tạo Extension Auth
  const extensionPath = createProxyAuthExtension(
    PROXY_CONF.ip,
    PROXY_CONF.port,
    PROXY_CONF.user,
    PROXY_CONF.pwd
  );

  // 4. CẤU HÌNH FINGERPRINT (JSON này sẽ được C++ đọc)
  // Các key này phải KHỚP với key bạn đã code trong C++ (JSONReader)
  const ruyiConfig = {
    // --- Navigator ---
    uaFullVersion: "124.0.6367.207",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    brands: [
      { brand: "Chromium", version: "124" },
      { brand: "Google Chrome", version: "124" },
      { brand: "Not-A.Brand", version: "99" },
    ],
    platform: "Windows",
    platformVersion: "15.0.0",
    architecture: "x86",
    bitness: "64",
    mobile: false,
    language: "en-US", // Cần thiết cho Intl spoofing

    // --- Hardware ---
    cpu: 16,
    memory: 8, // 8GB
    devicePixelRatio: 1,

    // --- Screen ---
    screen_width: 1920,
    screen_height: 1080,
    screen_availWidth: 1920,
    screen_availHeight: 1040,
    screen_colorDepth: 24,
    screen_pixelDepth: 24,

    // --- WebGL Spoofing (Quan trọng cho C10) ---
    // Lưu ý: Vendor gốc của WebGL không nên fake ở tham số 0x1F00/0x1F01.
    // Chỉ fake ở UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
    webgl_vendor: "Google Inc. (NVIDIA)",
    webgl_renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",

    // WebGL Caps
    webgl_max_texture_size: 16384,
    webgl_max_cube_map_texture_size: 16384,
    webgl_max_render_buffer: 16384,
    webgl_max_viewport_dims: 16384,
    webgl_max_vertex_texture_image_units: 32,
    webgl_max_texture_image_units: 32,

    // --- WebRTC (Quan trọng cho C4) ---
    webrtc_public_ip: realIp, // Inject IP đã check được từ axios

    // --- Noise (Quan trọng cho C14) ---
    noise_seed: 99999 + randomId, // Seed ngẫu nhiên mỗi lần chạy để khác biệt giữa các profile
    client_rects_noise: true,
    audio_noise: true,

    // --- Misc ---
    dnt: "1",
    battery_level: 0.95,
    battery_charging: true,
    webdriver: false, // Tắt cờ webdriver
  };

  // 5. CÁC CỜ KHỞI ĐỘNG (LAUNCH FLAGS)
  const launchArgs = [
    // Truyền config JSON vào switch --ruyi
    `--ruyi=${JSON.stringify(ruyiConfig)}`,

    // Extension Proxy
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,

    // Timezone
    `--timezone-override=${realTimezone}`,

    // *** QUAN TRỌNG: FIX C4 NETWORK & DNS LEAK ***
    // Dù C++ đã có, thêm ở đây để chắc chắn 100%
    `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`,

    // *** QUAN TRỌNG: FIX WEBRTC LEAK IP LAN ***
    `--disable-webrtc-multiple-routes`,
    `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`,

    // Anti-Detect Flags cơ bản
    "--no-first-run",
    "--disable-infobars",
    "--disable-blink-features=AutomationControlled",
    "--disable-site-isolation-trials",
    "--disable-features=IsolateOrigins,site-per-process",
    "--process-per-site",

    // Tắt các tính năng rác
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
  ];

  try {
    console.log(`[*] Đang khởi động Ruyi Browser...`);
    console.log(`    --> Chrome Path: ${CHROME_PATH}`);

    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROME_PATH,
      headless: false,
      args: launchArgs,
      viewport: null, // Để browser tự quyết định size theo window
      locale: "en-US",
      timezoneId: realTimezone,
      ignoreDefaultArgs: [
        "--enable-automation",
        "--enable-blink-features=IdleDetection",
      ], // Tránh bị detect automation
    });

    const page =
      context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    console.log("[*] Đang truy cập BrowserScan...");
    await page.goto("https://www.browserscan.net/", {
      waitUntil: "domcontentloaded",
    });

    // Mở thêm Whoer để đối chứng
    const page2 = await context.newPage();
    await page2.goto("https://whoer.net/", { waitUntil: "domcontentloaded" });

    console.log("\n✅ Browser đã mở. Giữ nguyên cửa sổ để kiểm tra.");
    console.log(
      "👉 Hãy kiểm tra mục 'IP Address' và 'WebRTC' trên BrowserScan xem có trùng nhau không."
    );

    // Giữ process sống
    await new Promise(() => {});
  } catch (e) {
    console.log(`\n❌ LỖI: ${e.message}`);
    console.log(
      "Gợi ý: Kiểm tra đường dẫn CHROME_PATH có đúng file chrome.exe vừa build không?"
    );
  }
}

if (require.main === module) {
  run();
}
