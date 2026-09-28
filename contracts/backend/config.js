const path = require("path");

const ROOT = path.join(__dirname, "..");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

const env = process.env;
const network = env.NETWORK || "localhost";

module.exports = {
  root: ROOT,
  // Cùng database mà ESP32 (blockchainV2.ino) ghi sensor_data_history / sensor_data_recent
  firebaseUrl: (env.FIREBASE_URL || "https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, ""),
  nodeId: env.NODE_ID || "node_01",
  // Mô hình phần cứng chỉ phát ~1 W: một phiên 10 phút chưa tới 1 Wh, contract (tính theo Wh nguyên) sẽ không có lệnh nào.
  // Công suất đo được nhân hệ số này trước khi tính điện năng: mặc định 1 W trên mô hình ứng với 1 kW của hộ gia đình.
  // Đặt 1 để dùng đúng số đo.
  powerScale: Number(env.POWER_SCALE || 1000),

  network,
  // Ghi kết quả khớp lệnh vào `transactions` và đổi status lệnh thành "filled".
  // Mặc định chỉ bật trên Sepolia: frontend tạo link sepolia.etherscan.io từ hash, hash của mạng local sẽ là link hỏng.
  firebaseWrite: env.FIREBASE_WRITE ? env.FIREBASE_WRITE === "true" : network === "sepolia",
  rpcUrl: env.RPC_URL || "http://127.0.0.1:8545",
  // Để trống khi chạy với `npx hardhat node`: backend dùng tài khoản #1 (oracle) của node local
  oraclePrivateKey: env.ORACLE_PRIVATE_KEY || "",
  // Ví của hộ sở hữu node IoT. Để trống khi chạy local: dùng tài khoản #2 của node local
  nodeWallet: env.NODE_WALLET || "",

  // Giá giới hạn của hộ sở hữu node (ETH/kWh): giá sàn khi bán, giá trần khi mua
  nodeAskPriceEth: env.NODE_ASK_PRICE_ETH || "0.05",
  nodeBidPriceEth: env.NODE_BID_PRICE_ETH || "0.07",

  // Chốt chặn AI (ai_analytics/latest): AI báo bất thường thì node không tự bán điện. AI_GATE=false để tắt.
  aiGate: env.AI_GATE !== "false",
  // Mẫu AI xét cũ hơn dữ liệu ESP32 mới nhất quá khoảng này thì bỏ qua AI (coi như không có)
  aiMaxLagSeconds: Number(env.AI_MAX_LAG_SECONDS || 120),

  // Broker và topic ESP32 (blockchainV2.ino) subscribe để nhận TRADE_SUCCESS. Đặt MQTT_URL= (rỗng) để tắt.
  mqttUrl: env.MQTT_URL ?? "mqtt://broker.hivemq.com:1883",
  mqttTopic: env.MQTT_TOPIC || "p2p/smart_contract",

  pollSeconds: Number(env.POLL_SECONDS || 5),
  // Hai bản ghi cách nhau quá khoảng này thì coi là mất dữ liệu, không tích phân qua khoảng trống.
  // ESP32 gửi mỗi 15 giây: 45 giây cho phép lỡ một mẫu.
  maxGapSeconds: Number(env.MAX_GAP_SECONDS || 45),
  // Bản ghi mới nhất cũ hơn khoảng này thì coi node là offline (ESP32 gửi mỗi 15 giây)
  nodeStaleSeconds: Number(env.NODE_STALE_SECONDS || 60),

  stateFile: path.join(ROOT, "backend", "state.json"),
  deploymentsDir: path.join(ROOT, "deployments"),
};
