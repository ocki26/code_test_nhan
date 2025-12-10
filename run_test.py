import os
import shutil
import random
import subprocess
import time
import json
from playwright.sync_api import sync_playwright

# ==============================================================================
# 1. CẤU HÌNH ĐƯỜNG DẪN
# ==============================================================================
CHROME_PATH = r"D:\chromium\src\out\Release\chrome.exe"

# ==============================================================================
# 2. HÀM HỖ TRỢ
# ==============================================================================
def kill_chrome():
    try: subprocess.run("taskkill /F /IM chrome.exe /T", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except: pass

def print_header(title):
    print(f"\n{'+' + '='*88 + '+'}")
    print(f"| {title:^86} |")
    print(f"{'+' + '='*88 + '+'}")
    print(f"| {'METRIC':<25} | {'EXPECTED':<25} | {'DETECTED':<32} |")
    print(f"|{'-'*27}|{'-'*27}|{'-'*34}|")

def log_row(metric, config_val, detected_val):
    conf_str = str(config_val)
    det_str = str(detected_val)
    if len(conf_str) > 24: conf_str = conf_str[:21] + "..."
    if len(det_str) > 31: det_str = det_str[:28] + "..."
    print(f"| {metric:<25} | {conf_str:<25} | {det_str:<32} |")

# ==============================================================================
# 3. SCRIPT JS (Kiểm tra phía DOM)
# ==============================================================================
JS_INSPECTOR = """
async () => {
    const info = {};
    try {
        if (navigator.userAgentData) {
            info.brands = navigator.userAgentData.brands.map(b => b.brand + " v" + b.version).join(", ");
            info.mobile = navigator.userAgentData.mobile;
            info.platform = navigator.userAgentData.platform;
            
            const hints = await navigator.userAgentData.getHighEntropyValues([
                "platformVersion", "architecture", "bitness", "model"
            ]);
            info.platformVersion = hints.platformVersion;
            info.architecture = hints.architecture;
        } else {
            info.brands = "Not Supported";
        }
    } catch(e) { info.brands = "Error"; }
    return info;
}
"""

# ==============================================================================
# 4. CHƯƠNG TRÌNH CHÍNH
# ==============================================================================
def run_test():
    kill_chrome()
    
    # --- CẤU HÌNH TEST (PC / WINDOWS) ---
    # Mục tiêu: Fake thành Windows 10, Chrome 120
    # (Dù máy thật của bạn có thể là Windows 11 hoặc Chrome 133)
    
    fake_config = {
        # 1. User Agent String (Phải khớp với thông tin bên dưới)
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        
        # 2. Client Hints (Quan trọng)
        "brands": [
            {"brand": "Google Chrome", "version": "124"}, # Đổi thành 124
            {"brand": "Chromium", "version": "124"},
            {"brand": "Not-A.Brand", "version": "24"}
        ],
        "mobile": False,           # PC
        "platform": "macOS",       # Đổi thành macOS
        "platformVersion": "14.4.1", # Phiên bản MacOS Sonoma
        "architecture": "x86",     # Chip Intel (hoặc "arm" nếu là M1/M2)
        "bitness": "64",
        "model": "",               # PC thường để trống
        "uaFullVersion": "124.0.6367.60", # Fake full version
        
        # 3. Hardware Noise (Đổi số khác để Hash thay đổi)
        "canvas_noise": 1.000999,  # Đổi số này
        "client_rects_noise": 2.15, # Đổi số này
        "webgl_vendor": "Apple",
        "webgl_renderer": "Apple M2",
        "webaudio_noise": 20.0
    }

    arg_switch = f'--ruyi={json.dumps(fake_config, separators=(",", ":"))}'
    user_data_dir = os.path.abspath(f"./temp_test_profile_{random.randint(1000,9999)}")
    
    print(f"\n>>> KHỞI ĐỘNG CHROMIUM (Fake Windows PC - Chrome 120)...")

    with sync_playwright() as p:
        try:
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

            # --- BẮT HEADER REQUEST ---
            # Biến lưu header gửi đi để kiểm tra
            sent_headers = {}

            def handle_request(request):
                # Chỉ bắt header của request chính (document)
                if request.resource_type == "document":
                    # Lưu lại các header bắt đầu bằng sec-ch-ua
                    for k, v in request.headers.items():
                        if k.lower().startswith("sec-ch-ua"):
                            sent_headers[k.lower()] = v

            page.on("request", handle_request)

            # Vào trang test
            print("[*] Đang truy cập BrowserLeaks...")
            try: page.goto("https://pixelscan.net/fingerprint-check", timeout=60000)
            except: pass
            
            time.sleep(3)

            # Lấy thông tin JS
            js_data = page.evaluate(JS_INSPECTOR)

            # --- IN BÁO CÁO KIỂM TRA ---
            
            # 1. Kiểm tra HTTP Headers (Giai đoạn 3 - File user_agent_utils.cc)
            print_header("GIAI ĐOẠN 3: HTTP HEADERS (Sent to Server)")
            
            # Header: Sec-CH-UA-Platform
            h_plat = sent_headers.get("sec-ch-ua-platform", "Not Sent").replace('"', '')
            log_row("Header: Platform", fake_config['platform'], h_plat)
            
            # Header: Sec-CH-UA-Mobile
            h_mob = sent_headers.get("sec-ch-ua-mobile", "Not Sent")
            expected_mob = "?1" if fake_config['mobile'] else "?0"
            log_row("Header: Mobile", expected_mob, h_mob)
            
            # Header: Sec-CH-UA (Brands)
            h_brands = sent_headers.get("sec-ch-ua", "Not Sent")
            log_row("Header: Brands", "Chrome v120...", h_brands)

            # 2. Kiểm tra JavaScript DOM (Giai đoạn 2 - File navigator_ua_data.cc)
            print_header("GIAI ĐOẠN 2: JAVASCRIPT DOM (navigator.*)")
            log_row("JS: Platform", fake_config['platform'], js_data['platform'])
            log_row("JS: Mobile", str(fake_config['mobile']), str(js_data['mobile']))
            log_row("JS: Brands", "Chrome v120...", js_data['brands'])

            # 3. Kết luận
            print(f"{'+' + '='*88 + '+'}\n")
            
            headers_ok = (fake_config['platform'] in h_plat) and (expected_mob == h_mob)
            js_ok = (fake_config['platform'] == js_data['platform'])
            
            if headers_ok and js_ok:
                print("✅ THÀNH CÔNG RỰC RỠ: HTTP Headers và JS đều đã bị Fake đồng bộ!")
            elif js_ok and not headers_ok:
                print("⚠️ CẢNH BÁO: JS đã Fake được, nhưng Headers vẫn lộ thông tin thật (Lỗi user_agent_utils.cc).")
            else:
                print("❌ THẤT BẠI: Chưa fake được thông tin nào.")

            print("\n[*] Giữ trình duyệt 120s...")
            time.sleep(120)

        except Exception as e:
            print(f"[!] Lỗi: {e}")
        finally:
            if os.path.exists(user_data_dir):
                try: shutil.rmtree(user_data_dir)
                except: pass

if __name__ == "__main__":
    run_test()