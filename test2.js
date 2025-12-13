const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");

// ==============================================================================
// 1. CẤU HÌNH CƠ BẢN
// ==============================================================================
const CHROME_PATH = String.raw`D:\chromium\src\out\Release\chrome.exe`;
const RAW_PROXY = "149.19.197.146:17188:muaproxy693a2a80171cc:nr0ub0rxvyubr03f";

const BUILD_VERSION = "124.0.6367.207";
const MAJOR_VERSION = "124";

// --- HÀM PARSE PROXY ---
function parseProxyConfig(raw) {
  const parts = raw.split(":");
  if (parts.length === 4) {
    const [ip, port, user, pwd] = parts;
    return {
      ip,
      port,
      user,
      pwd,
      checkUrl: `http://${encodeURIComponent(user)}:${encodeURIComponent(
        pwd
      )}@${ip}:${port}`,
    };
  }
  return null;
}
const PROXY_CONF = parseProxyConfig(RAW_PROXY);

// ==============================================================================
// 2. TẠO EXTENSION AUTH
// ==============================================================================
function createProxyAuthExtension(host, port, user, pass) {
  const pluginDir = path.resolve("./proxy_auth_plugin");
  if (fs.existsSync(pluginDir))
    fs.rmSync(pluginDir, { recursive: true, force: true });
  fs.mkdirSync(pluginDir);

  const manifest = {
    manifest_version: 3,
    name: "Ruyi Auth",
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

  const backgroundJs = `
        const config = {
            mode: "fixed_servers",
            rules: {
                singleProxy: { scheme: "http", host: "${host}", port: parseInt(${port}) },
                bypassList: ["localhost", "127.0.0.1"]
            }
        };
        chrome.proxy.settings.set({value: config, scope: 'regular'}, function() {});
        chrome.webRequest.onAuthRequired.addListener(
            (details) => ({ authCredentials: { username: "${user}", password: "${pass}" } }),
            {urls: ["<all_urls>"]}, ["blocking"]
        );
        chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: 'disable_non_proxied_udp' });
    `;

  fs.writeFileSync(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  fs.writeFileSync(path.join(pluginDir, "background.js"), backgroundJs);
  return pluginDir;
}

// ==============================================================================
// 3. CHECK IP & GEO
// ==============================================================================
async function getProxyInfo(proxyUrl) {
  console.log(`[*] Checking Proxy IP...`);
  const agent = new HttpsProxyAgent(proxyUrl);
  try {
    const resp = await axios.get("http://ip-api.com/json", {
      httpsAgent: agent,
      httpAgent: agent,
      timeout: 20000,
    });
    if (resp.status === 200) {
      console.log(
        `    [OK] IP: ${resp.data.query} | Timezone: ${resp.data.timezone}`
      );
      return {
        ip: resp.data.query,
        timezone: resp.data.timezone,
        lat: resp.data.lat,
        lon: resp.data.lon,
      };
    }
  } catch (e) {
    console.log(`    [ERR Check IP] ${e.message}`);
  }
  // Fallback an toàn
  return {
    ip: "127.0.0.1",
    timezone: "America/Denver",
    lat: 37.7749,
    lon: -122.4194,
  };
}

// ==============================================================================
// 4. LOGIC CHÍNH
// ==============================================================================
async function run() {
  if (!PROXY_CONF) return;

  // Lấy thông tin Proxy thật
  const {
    ip: realIp,
    timezone: realTimezone,
    lat: realLat,
    lon: realLon,
  } = await getProxyInfo(PROXY_CONF.checkUrl);

  // [FIX SPOOF LOCATION 1]: Đồng bộ giờ Node.js với Proxy để tránh Playwright leak giờ hệ thống
  process.env.TZ = realTimezone;

  const randomId = Math.floor(Math.random() * 99999);
  const userDataDir = path.resolve(`./ruyi_profile_${randomId}`);
  const extensionPath = createProxyAuthExtension(
    PROXY_CONF.ip,
    PROXY_CONF.port,
    PROXY_CONF.user,
    PROXY_CONF.pwd
  );

  // --- [ĐÃ RESTORE LẠI RUYI CONFIG ĐẦY ĐỦ CỦA BẠN] ---
  const ruyiConfig = {
    // Navigator
    uaFullVersion: BUILD_VERSION,
    ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${BUILD_VERSION} Safari/537.36`,
    brands: [
      { brand: "Chromium", version: MAJOR_VERSION },
      { brand: "Google Chrome", version: MAJOR_VERSION },
      { brand: "Not-A.Brand", version: "99" },
    ],
    platform: "Windows",
    platformVersion: "15.0.0",
    architecture: "x86",
    bitness: "64",
    mobile: false,
    language: "en-US,en",

    // Hardware
    cpu: 16,
    memory: 8,
    devicePixelRatio: 1,

    // Screen
    screen_width: 1920,
    screen_height: 1080,
    screen_availWidth: 1920,
    screen_availHeight: 1040,
    screen_colorDepth: 24,
    screen_pixelDepth: 24,

    // WebGL
    webgl_vendor: "Google Inc. (NVIDIA)",
    webgl_renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    webgl_max_texture_size: 16384,
    webgl_max_cube_map_texture_size: 16384,
    webgl_max_render_buffer: 16384,
    webgl_max_viewport_dims: 16384,
    webgl_max_vertex_texture_image_units: 32,
    webgl_max_texture_image_units: 32,

    // WebRTC & Noise
    webrtc_public_ip: realIp,
    noise_seed: 99999 + randomId,
    client_rects_noise: true,
    audio_noise: true,

    // Misc
    dnt: "1",
    battery_level: 0.95,
    battery_charging: true,
    webdriver: false,
  };

  const launchArgs = [
    `--ruyi=${JSON.stringify(ruyiConfig)}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,

    // [Language & Timezone Flags]
    `--timezone-override=${realTimezone}`,
    `--lang=en-US`,

    // [Fix DNS Leak]
    `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`,
    `--disable-async-dns`,
    `--disable-features=DnsOverHttps,DnsOverHttpsUpgrade`,

    // [WebRTC]
    `--disable-webrtc-multiple-routes`,
    `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`,

    // [Anti-Detect UI]
    "--no-first-run",
    "--disable-blink-features=AutomationControlled",
    "--disable-site-isolation-trials",
    "--force-color-profile=srgb",
  ];

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROME_PATH,
      headless: false,
      args: launchArgs,

      // [FIX MÀN HÌNH 4800x2700]
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,

      // [FIX LANGUAGE MISMATCH]
      locale: "en-US",

      // [QUAN TRỌNG] Ghi đè Header để loại bỏ 'vi', 'fr'
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },

      // [FIX BROWSER VERSION MISMATCH - CLIENT HINTS]
      userAgent: ruyiConfig.ua,
      userAgentMetadata: {
        brands: [
          { brand: "Chromium", version: MAJOR_VERSION },
          { brand: "Google Chrome", version: MAJOR_VERSION },
          { brand: "Not-A.Brand", version: "99" },
        ],
        fullVersion: BUILD_VERSION,
        platform: "Windows",
        platformVersion: "15.0.0",
        architecture: "x86",
        bitness: "64",
        mobile: false,
        model: "",
      },

      timezoneId: realTimezone,
      permissions: ["geolocation"],
      geolocation: { latitude: realLat, longitude: realLon },
      ignoreDefaultArgs: ["--enable-automation"],
    });

    // --- SCRIPT QUAN TRỌNG: FIX TIMEZONE SPOOFED & INTL ---
    // Truyền realTimezone vào hàm để script trong browser dùng được
    await context.addInitScript((targetTimezone) => {
      // 1. [FIX LANGUAGE - JS LEVEL]
      // Xóa sạch 'vi', 'fr' khỏi navigator
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      Object.defineProperty(navigator, "language", { get: () => "en-US" });

      // 2. [FIX TIMEZONE SPOOFED - INTL API]
      // Bắt buộc tất cả các hàm định dạng ngày tháng phải dùng Timezone của Proxy
      // Kể cả khi trang web không yêu cầu timezone, ta vẫn ép vào.
      const originalDateTimeFormat = Intl.DateTimeFormat;

      window.Intl.DateTimeFormat = function (locales, options) {
        // Mẹo: Merge option timeZone vào để ép trình duyệt tính toán theo giờ Proxy
        // thay vì giờ hệ thống.
        const newOptions = { ...options, timeZone: targetTimezone };
        return new originalDateTimeFormat("en-US", newOptions);
      };
      window.Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;
      window.Intl.DateTimeFormat.supportedLocalesOf =
        originalDateTimeFormat.supportedLocalesOf;

      // Override NumberFormat (Tiền tệ)
      const originalNumberFormat = Intl.NumberFormat;
      window.Intl.NumberFormat = function (locales, options) {
        return new originalNumberFormat("en-US", options);
      };
      window.Intl.NumberFormat.prototype = originalNumberFormat.prototype;

      // 3. Cleanup Automation
      try {
        delete Object.getPrototypeOf(navigator).webdriver;
      } catch (e) {}
    }, realTimezone); // <-- Truyền timezone vào đây

    const page = await context.newPage();
    console.log("[*] Opening Pixelscan...");
    await page.goto("https://pixelscan.net/");

    await new Promise(() => {});
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

if (require.main === module) {
  run();
}
