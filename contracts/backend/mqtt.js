// Gửi lệnh xuống ESP32 qua MQTT. ESP32 (blockchainV2.ino, mqttCallback) subscribe topic p2p/smart_contract:
//   TRADE_SUCCESS  -> đóng relay 2 (lưới P2P) trong 2 giây, LCD hiện "P2P!"
//   CUT_POWER / RESTORE_POWER -> ngắt / mở lại relay 1 (tải nội bộ), backend chưa dùng
const mqtt = require("mqtt");
const { ethers } = require("ethers");

const TRADE_SUCCESS = "TRADE_SUCCESS";

/** Có cặp khớp nào mà ví của node là người bán hoặc người mua không */
function nodeTraded(matched, nodeWallet) {
  const node = ethers.getAddress(nodeWallet);
  return matched.some(({ args }) => ethers.getAddress(args.seller) === node || ethers.getAddress(args.buyer) === node);
}

/**
 * Kết nối broker một lần, tự nối lại khi rớt mạng. Lỗi MQTT chỉ ghi log, không làm dừng oracle:
 * giao dịch on-chain vẫn là nguồn sự thật, relay chỉ là phần hiển thị vật lý.
 * url rỗng thì tắt MQTT.
 */
function createEsp32Notifier({ url, topic }, log) {
  if (!url) {
    return { enabled: false, send: async () => false };
  }

  const client = mqtt.connect(url, {
    clientId: `p2p-oracle-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });
  let lastError = "";
  client.on("connect", () => {
    lastError = "";
    log(`[MQTT] Đã kết nối ${url}`);
  });
  client.on("error", (err) => {
    if (err.message === lastError) return; // broker không tới được thì mqtt báo lỗi mỗi lần thử lại
    lastError = err.message;
    log(`[MQTT] Lỗi: ${err.message}`);
  });

  // Kết nối broker công cộng có thể mất vài giây (lúc oracle vừa khởi động hoặc đang nối lại)
  const waitConnected = (timeoutMs) =>
    new Promise((resolve) => {
      if (client.connected) return resolve(true);
      const done = (ok) => {
        clearTimeout(timer);
        client.off("connect", onConnect);
        resolve(ok);
      };
      const onConnect = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      client.on("connect", onConnect);
    });

  return {
    enabled: true,
    async send(message) {
      if (!(await waitConnected(15000))) {
        log(`[MQTT] Không kết nối được ${url} sau 15 giây, bỏ qua ${message}`);
        return false;
      }
      try {
        // Không retain: tin nhắn giữ lại trên broker sẽ làm relay đóng lại mỗi lần ESP32 kết nối lại
        await client.publishAsync(topic, message, { qos: 0, retain: false });
        log(`[MQTT] Gửi ${message} -> ${topic}`);
        return true;
      } catch (err) {
        log(`[MQTT] Gửi ${message} lỗi: ${err.message}`);
        return false;
      }
    },
  };
}

module.exports = { TRADE_SUCCESS, nodeTraded, createEsp32Notifier };
