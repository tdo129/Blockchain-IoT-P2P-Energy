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
  firebaseUrl: (env.FIREBASE_URL || "https://p2p-solar-energy-default-rtdb.firebaseio.com").replace(/\/$/, ""),
  nodeId: env.NODE_ID || "node_01",

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

  pollSeconds: Number(env.POLL_SECONDS || 5),
  // Hai bản ghi cách nhau quá khoảng này thì coi là mất dữ liệu, không tích phân qua khoảng trống
  maxGapSeconds: Number(env.MAX_GAP_SECONDS || 30),
  // Node không gửi tín hiệu quá khoảng này thì coi là offline
  nodeStaleSeconds: Number(env.NODE_STALE_SECONDS || 60),

  stateFile: path.join(ROOT, "backend", "state.json"),
  deploymentsDir: path.join(ROOT, "deployments"),
};
