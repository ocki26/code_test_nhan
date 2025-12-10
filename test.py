import os
import shutil
import random
import subprocess
import time
import json
import requests
from playwright.sync_api import sync_playwright

# ==============================================================================
# 1. CẤU HÌNH
# ==============================================================================
CHROME_PATH = r"E:\chrome\My_browserr\chrome.exe"
RAW_PROXY = "103.187.5.219:8097:heocl3wLW4:tihCgNpZ"

# --- HÀM PARSE PROXY ---
def parse_proxy_config(raw):
    parts = raw.split(':')
    if len(parts) == 4:
        ip, port, user, pwd = parts
        # Config cho Playwright
        pw_config = {
            "server": f"http://{ip}:{port}", # Thử đổi thành socks5:// nếu HTTP không chạy
            "username": user,
            "password": pwd
        }
        # URL cho Requests
        req_url = f"http://{user}:{pwd}@{ip}:{port}"
        return pw_config, req_url
    return None, None

PW_PROXY, REQ_URL = parse_proxy_config(RAW_PROXY)

# ==============================================================================
# 2. CHECK IP (Đa luồng API)
# ==============================================================================
def get_proxy_info(proxy_url):
    print(f"[*] Checking Proxy: {proxy_url.split('@')[1] if '@' in proxy_url else proxy_url}...")
    
    proxies = {"http": proxy_url, "https": proxy_url}
    
    # Danh sách các API để thử (nếu cái này chết thì thử cái kia)
    apis = [
        ("http://ip-api.com/json", "timezone"), # Ưu tiên 1: Lấy được cả Timezone
        ("https://api.ipify.org?format=json", None), # Ưu tiên 2: Chỉ lấy IP
    ]

    for url, tz_key in apis:
        try:
            print(f"    -> Thử kết nối: {url}")
            resp = requests.get(url, proxies=proxies, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                ip = data.get('query') or data.get('ip')
                
                # Timezone logic
                timezone = "Asia/Ho_Chi_Minh" # Mặc định
                if tz_key and tz_key in data:
                    timezone = data[tz_key]
                
                print(f"    [OK] IP: {ip} | Timezone: {timezone}")
                return ip, timezone
            else:
                print(f"    [FAIL] Status code: {resp.status_code}")
        except Exception as e:
            print(f"    [ERR] {str(e)[:50]}...")
            
    return None, None

# Lấy thông tin
real_ip, real_timezone = get_proxy_info(REQ_URL)

if not real_ip:
    print("\n[!!!] PROXY CHẾT HOẶC KHÔNG KẾT NỐI ĐƯỢC INTERNET [!!!]")
    # Vẫn chạy browser để bạn debug bằng mắt, nhưng dùng IP Loopback
    real_ip = "127.0.0.1"
    real_timezone = "Asia/Ho_Chi_Minh"
else:
    print(f"\n[OK] Proxy Sống. Cấu hình Browser theo IP: {real_ip}")

# ==============================================================================
# 3. CẤU HÌNH BROWSER
# ==============================================================================
RUYI_CONFIG = {
    "uaFullVersion": "142.0.7444.177", 
    "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "brands": [{"brand": "Chromium", "version": "142"}, {"brand": "Google Chrome", "version": "142"}, {"brand": "Not_A Brand", "version": "24"}],
    
    "platform": "Windows",
    "legacy_platform": "Win32",
    "platformVersion": "15.0.0",
    "architecture": "x86",
    "bitness": "64",
    "mobile": False,

    "cpu": 16,
    "memory": 8.0, 
    "screen_width": 1920, "screen_height": 1080,
    "screen_availWidth": 1920, "screen_availHeight": 1040,
    "screen_colorDepth": 24, "screen_pixelDepth": 24, "devicePixelRatio": 1.0,

    "webgl_vendor": "Google Inc. (NVIDIA)",
    "webgl_renderer": "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "webgl_max_texture_size": 16384, "webgl_max_cube_map_texture_size": 16384,
    "webgl_max_render_buffer": 16384, "webgl_max_viewport_dims": 16384,
    "webgl_max_vertex_texture_image_units": 32, "webgl_max_texture_image_units": 32,

    # --- INJECT IP PROXY VÀO CORE ---
    "webrtc_public_ip": real_ip, 
    
    "net_downlink": 10.0, "net_rtt": 50,
    "dnt": "1",            
    "noise_seed": 12345, 
    "battery_level": 1.0, "battery_charging": True
}

def run():
    try: subprocess.run("taskkill /F /IM chrome.exe /T", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except: pass

    user_data_dir = os.path.abspath(f"./ruyi_live_{random.randint(1000,9999)}")
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
            print(f"[*] Mở Browser với Proxy: {PW_PROXY['server']}")
            browser = p.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                executable_path=CHROME_PATH,
                headless=False,
                args=launch_args,
                viewport=None,
                proxy=PW_PROXY, # Nạp proxy đã tách user/pass
                locale="en-US",
                timezone_id=real_timezone,
                ignore_default_args=["--enable-automation"]
            )
            
            page = browser.pages[0] if browser.pages else browser.new_page()
            
            # Tăng timeout lên 2 phút vì proxy có thể chậm
            page.set_default_timeout(12000000)

            print("[*] Vào BrowserScan...")
            page.goto("https://www.browserscan.net/")
            
            print("[*] Vào Whoer...")
            p2 = browser.new_page()
            p2.goto("https://whoer.net/")

            print("\n>>> DONE. GIỮ CỬA SỔ TRONG 1 GIỜ <<<")
            time.sleep(360000)

        except Exception as e:
            print(f"\n[CRASH] Lỗi khi chạy Browser: {e}")
            print("Mẹo: Nếu Browser tắt ngay lập tức, có thể Proxy Auth thất bại.")

if __name__ == "__main__":
    run()