const axios = require("axios");
const { SocksProxyAgent } = require("socks-proxy-agent");

const PROXY_STR =
  "socks5://muaproxy693a2a40d61d8:ladautflufljlrki@206.125.175.49:27415";

async function testProxy() {
  console.log("Đang kiểm tra proxy...");

  const agent = new SocksProxyAgent(PROXY_STR);

  try {
    const res = await axios.get("https://api.myip.com", {
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 15000,
    });

    console.log("✅ Proxy hoạt động OK:");
    console.log(res.data);
  } catch (err) {
    console.log("❌ Proxy lỗi hoặc API chặn Proxy");
    console.log("Message:", err.message);
    console.log("Code:", err.code);
  }
}

testProxy();
