import os
import shutil
import random
import subprocess
import time
import json
from playwright.sync_api import sync_playwright

# ==============================================================================
# 1. CẤU HÌNH & ĐƯỜNG DẪN
# ==============================================================================
CHROME_PATH = r"D:\chromium\src\out\Release\chrome.exe"

# Cấu hình giả lập (Fake Profile)
RUYI_CONFIG = {
    # --- 1. Navigator & Identity ---
    "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "uaFullVersion": "131.0.6778.86", # Fake version
    "dnt": "1",
    "webdriver": False,
    "lang": "en-US",
    
    # --- 2. Client Hints (Header & JS) ---
    "brands": [
        {"brand": "Google Chrome", "version": "131"},
        {"brand": "Chromium", "version": "131"},
        {"brand": "Not=A?Brand", "version": "99"}
    ],
    "mobile": False,
    "platform": "Windows",
    "platformVersion": "15.0.0",
    "architecture": "x86",
    "bitness": "64",
    "model": "",

    # --- 3. Hardware Basic ---
    "cpu": 16,
    "memory": 8.0, # Chuẩn Chrome (chỉ hiện 0.25, 0.5, 1, 2, 4, 8)
    "screen_width": 2560, "screen_height": 1440, "pixel_depth": 24,

    # --- 4. GPU Fingerprint (WebGL & WebGPU) ---
    "webgl_vendor": "Google Inc. (NVIDIA)", 
    "webgl_renderer": "ANGLE (NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    
    # --- 5. Noise (Quan trọng) ---
     # 2. Noise cực nhỏ (Để qua mặt thuật toán AI của Pixelscan)
    "canvas_noise": 1.0000001,    # Rất nhỏ
    "client_rects_noise": 0.0001, # Rất nhỏ
    "webaudio_noise": 0.0001,     # Rất nhỏ

    # --- 6. Network & Battery ---
    "net_downlink": 9.5,
    "battery_level": 0.69,
    "battery_charging": False,
    
    # --- 7. Location ---
    # "time_zone": "Asia/Bangkok", # Hoặc Asia/Tokyo
    # "webrtc_ip": "192.168.1.105"
}

# ==============================================================================
# 2. SCRIPT JAVASCRIPT THÁM TỬ
# ==============================================================================
JS_INSPECTOR = """
async () => {
    const info = {};

    // 1. Canvas Fingerprint (Test độ nhạy Noise)
    try {
        const c = document.createElement('canvas');
        c.width = 200; c.height = 50;
        const ctx = c.getContext('2d');
        ctx.fillStyle = "#f60"; ctx.fillRect(10,10,100,30);
        ctx.fillStyle = "#069"; ctx.fillText("Ruyi Browser V4", 10, 40);
        info.canvas_sig = c.toDataURL().slice(-30); // Lấy đuôi hash
    } catch(e) { info.canvas_sig = "Error"; }

    // 2. Hardware Noise
    try {
        const div = document.createElement('div');
        div.style.width = '100px'; document.body.appendChild(div);
        info.rect_width = div.getBoundingClientRect().width;
        document.body.removeChild(div);
    } catch(e) {}

    // 3. WebGL
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        info.webgl_ren = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    } catch(e) {}

    // 4. Basic Info
    info.cpu = navigator.hardwareConcurrency;
    info.memory = navigator.deviceMemory;
    info.webdriver = navigator.webdriver;
    
    // 5. Client Hints
    try {
        if (navigator.userAgentData) {
            info.brands = navigator.userAgentData.brands.map(b => b.brand + " v" + b.version).join(", ");
            info.platform = navigator.userAgentData.platform;
        }
    } catch(e) {}

    // 6. Battery & Net
    try { const b = await navigator.getBattery(); info.bat = b.level; info.charge = b.charging; } catch(e) {}
    try { if(navigator.connection) info.downlink = navigator.connection.downlink; } catch(e) {}

    return info;
}
"""

# ==============================================================================
# 3. HÀM CHẠY TEST
# ==============================================================================
def print_section(title):
    print(f"\n{'+' + '='*98 + '+'}")
    print(f"| {title:^96} |")
    print(f"{'+' + '='*98 + '+'}")
    print(f"| {'ITEM':<20} | {'EXPECTED (CONFIG)':<35} | {'DETECTED (ACTUAL)':<35} | {'STATUS':<6} |")
    print(f"|{'-'*22}|{'-'*37}|{'-'*37}|{'-'*8}|")

def log_row(item, expected, actual, check_mode="exact"):
    status = "❓"
    try:
        if check_mode == "exact":
            if str(expected) == str(actual): status = "✅ OK"
            else: status = "❌ FAIL"
        elif check_mode == "contains":
            if str(expected).lower() in str(actual).lower().replace('"', ''): status = "✅ OK"
            else: status = "❌ FAIL"
        elif check_mode == "number_approx":
            if abs(float(expected) - float(actual)) < 0.01: status = "✅ OK"
            else: status = "❌ FAIL"
        elif check_mode == "rects_check":
            if abs((100.0 + float(expected)) - float(actual)) < 0.01: status = "✅ OK"
            else: status = "❌ FAIL"
    except: status = "❌ FAIL"

    print(f"| {item:<20} | {str(expected)[:35]:<35} | {str(actual)[:35]:<35} | {status:<6} |")

def run_test():
    try: subprocess.run("taskkill /F /IM chrome.exe /T", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except: pass

    arg_switch = f'--ruyi={json.dumps(RUYI_CONFIG, separators=(",", ":"))}'
    user_data_dir = os.path.abspath(f"./v4_profile_{random.randint(1000,9999)}")

    print(f"\n>>> TEST V4: KIỂM TRA CANVAS & HARDWARE...")
    print(f"    Canvas Noise: {RUYI_CONFIG['canvas_noise']}")

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            executable_path=CHROME_PATH,
            headless=False,
            args=[
                arg_switch,
                '--no-first-run',
                '--disable-blink-features=AutomationControlled'
            ],
            viewport=None
        )
        page = browser.pages[0]
        
        captured_headers = {}
        page.on("request", lambda r: [captured_headers.update({k.lower(): v}) for k, v in r.headers.items() if k.lower().startswith("sec-ch-ua") and r.resource_type == "document"])

        try: page.goto("https://abrahamjuliot.github.io/creepjs/", timeout=60000)
        except: pass
        time.sleep(2)
        js_data = page.evaluate(JS_INSPECTOR)

        # --- BÁO CÁO ---
        print_section("1. FINGERPRINT & NOISE")
        log_row("Client Rects", RUYI_CONFIG['client_rects_noise'], js_data.get('rect_width'), "rects_check")
        # Canvas Hash: Hãy nhìn vào giá trị này. Chạy lần sau đổi noise, giá trị này PHẢI đổi.
        print(f"| {'Canvas Hash':<20} | {'(Check manual)':<35} | {str(js_data.get('canvas_sig')):<35} | INFO   |")
        
        print_section("2. HARDWARE INFO")
        log_row("WebGL", RUYI_CONFIG['webgl_renderer'], js_data.get('webgl_ren'), "exact")
        log_row("CPU", RUYI_CONFIG['cpu'], js_data.get('cpu'), "exact")
        log_row("Memory", RUYI_CONFIG['memory'], js_data.get('memory'), "number_approx")
        log_row("Battery", RUYI_CONFIG['battery_level'], js_data.get('bat'), "number_approx")
        log_row("Downlink", RUYI_CONFIG['net_downlink'], js_data.get('downlink'), "number_approx")

        print_section("3. HEADER & IDENTITY")
        h_plat = captured_headers.get("sec-ch-ua-platform", "MISSING")
        log_row("Header: Platform", RUYI_CONFIG['platform'], h_plat, "contains")
        log_row("JS: Platform", RUYI_CONFIG['platform'], js_data.get('platform'), "exact")
        log_row("Header: Brands", "131", captured_headers.get("sec-ch-ua", "MISSING"), "contains")

        print(f"{'+' + '='*98 + '+'}\n")
        print("[*] Test xong. Giữ trình duyệt 120s...")
        time.sleep(120)

if __name__ == "__main__":
    run_test()