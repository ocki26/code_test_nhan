import os
import shutil
import random
import subprocess
import time
import json
import requests
from playwright.sync_api import sync_playwright

# ==============================================================================
# 1. CẤU HÌNH CƠ BẢN
# ==============================================================================
CHROME_PATH = r"D:\chromium\src\out\Release\chrome.exe" 

# --- TẮT PROXY (ĐỂ None ĐỂ DÙNG MẠNG THẬT) ---
PW_PROXY = None 

# ==============================================================================
# 2. CHECK IP & TIMEZONE (ĐỂ NẠP VÀO GIẢ LẬP)
# ==============================================================================
def get_ip_info():
    print(f"[*] Đang lấy thông tin IP mạng gốc (Direct)...")
    
    # Không dùng proxy cho requests
    proxies = None 

    # Danh sách API check IP
    apis = [
        ("http://ip-api.com/json", "timezone"), 
        ("https://api.ipify.org?format=json", None), 
    ]

    for url, tz_key in apis:
        try:
            # Timeout 10s cho nhanh
            resp = requests.get(url, proxies=proxies, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                ip = data.get('query') or data.get('ip')
                
                timezone = "Asia/Ho_Chi_Minh" # Mặc định nếu API không trả về
                if tz_key and tz_key in data:
                    timezone = data[tz_key]
                
                print(f"    [OK] IP: {ip} | Timezone: {timezone}")
                return ip, timezone
        except Exception as e:
            print(f"    [SKIP] Lỗi kết nối API: {e}")
            
    # Fallback nếu mất mạng hoàn toàn
    return "127.0.0.1", "Asia/Ho_Chi_Minh" 

# Lấy thông tin IP hiện tại
real_ip, real_timezone = get_ip_info()

# ==============================================================================
# 3. CẤU HÌNH FULL RUYI (ĐẦY ĐỦ THÔNG SỐ)
# ==============================================================================
RUYI_CONFIG = {
    # --- Browser Version Info ---
    "uaFullVersion": "142.0.7444.177", 
    "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "brands": [
        {"brand": "Chromium", "version": "142"},
        {"brand": "Google Chrome", "version": "142"},
        {"brand": "Not_A Brand", "version": "24"}
    ],
    
    # --- Platform Info ---
    "platform": "Windows",
    "legacy_platform": "Win32",
    "platformVersion": "15.0.0",
    "architecture": "x86",
    "bitness": "64",
    "mobile": False,

    # --- Hardware Info ---
    "cpu": 16,
    "memory": 8.0, 
    "screen_width": 1920, "screen_height": 1080,
    "screen_availWidth": 1920, "screen_availHeight": 1040,
    "screen_colorDepth": 24, "screen_pixelDepth": 24, "devicePixelRatio": 1.0,

    # --- WebGL Fingerprint ---
    "webgl_vendor": "Google Inc. (NVIDIA)",
    "webgl_renderer": "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "webgl_max_texture_size": 16384, 
    "webgl_max_cube_map_texture_size": 16384,
    "webgl_max_render_buffer": 16384, 
    "webgl_max_viewport_dims": 16384,
    "webgl_max_vertex_texture_image_units": 32, 
    "webgl_max_texture_image_units": 32,

    # --- Network & WebRTC (Inject IP thật vào đây) ---
    "webrtc_public_ip": real_ip, 
    "net_downlink": 10.0, 
    "net_rtt": 50,
    
    # --- Others ---
    "dnt": "1",            
    "noise_seed": 12345, 
    "battery_level": 1.0, 
    "battery_charging": True
}

# ==============================================================================
# 4. HÀM CHẠY CHÍNH
# ==============================================================================
def run():
    # --- TẮT TASKKILL (Để không tắt Chrome cũ của bạn) ---
    # try: subprocess.run("taskkill /F /IM chrome.exe /T", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # except: pass

    # Tạo folder profile ngẫu nhiên để không bị trùng cache
    user_data_dir = os.path.abspath(f"./ruyi_live_{random.randint(1000,9999)}")
    
    # Chuyển config sang JSON string để nạp vào tham số
    json_config = json.dumps(RUYI_CONFIG, separators=(",", ":"))

    launch_args = [
        f'--ruyi={json_config}',
        '--no-first-run',
        '--disable-infobars',
        '--disable-features=DnsOverHttps', 
        '--disable-async-dns',
        '--force-webrtc-ip-handling-policy=default_public_interface_only',
        '--device-memory=8', 
        '--disable-blink-features=AutomationControlled', 
        '--lang=en-US',
        f'--timezone-override={real_timezone}',
    ]

    with sync_playwright() as p:
        try:
            print(f"[*] Khởi động Browser (Direct Connection)...")
            browser = p.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                executable_path=CHROME_PATH,
                headless=False,
                args=launch_args,
                viewport=None, # Maximize cửa sổ
                
                proxy=None, # <--- QUAN TRỌNG: Không dùng Proxy
                
                locale="en-US",
                timezone_id=real_timezone,
                ignore_default_args=["--enable-automation"]
            )
            
            # Lấy page đầu tiên
            page = browser.pages[0] if browser.pages else browser.new_page()
            
            # Set timeout chung là 60s
            page.set_default_timeout(60000)

            # --- MỞ CÁC TAB (Dùng wait_until='commit' để load nhanh) ---
            
            print("[1] Vào BrowserScan...")
            page.goto("https://www.browserscan.net/", wait_until="commit", timeout=60000)
            
            print("[2] Vào PixelScan...")
            p2 = browser.new_page()
            p2.goto("https://pixelscan.net/fingerprint-check", wait_until="commit", timeout=60000)
            
            print("[3] Vào BrowserLeaks IP...")
            p3 = browser.new_page()
            p3.goto("https://browserleaks.com/ip", wait_until="commit", timeout=60000)
            
            print("[4] Vào AmiUnique...")
            p4 = browser.new_page()
            p4.goto("https://amiunique.org/fingerprint", wait_until="commit", timeout=60000)
            
            print("\n>>> ĐÃ XONG. GIỮ CỬA SỔ TRONG 1 GIỜ... <<<")
            time.sleep(360000) # 1 giờ

        except Exception as e:
            print(f"\n[CRASH] Lỗi: {e}")
            print("Lưu ý: Nếu lỗi 'side-by-side', hãy kiểm tra lại folder My_browserr có đủ file Manifest chưa.")

if __name__ == "__main__":
    run()