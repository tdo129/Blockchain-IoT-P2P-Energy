// Kiểm tra .env trước khi deploy Sepolia: RPC URL, Etherscan API key, các ví. Không in private key.
// Chạy: npm run check:sepolia
const { ethers } = require("ethers");

try {
  process.loadEnvFile(".env");
} catch (err) {
  if (err.code !== "ENOENT") throw err;
  console.log("Chưa có file .env. Chạy: Copy-Item .env.example .env");
  process.exit(1);
}

const SEPOLIA_CHAIN_ID = 11155111n;
const env = process.env;
let failed = false;
const ok = (msg) => console.log(`  OK   ${msg}`);
const bad = (msg) => {
  failed = true;
  console.log(`  LỖI  ${msg}`);
};

async function checkRpc() {
  console.log("1. RPC_URL");
  if (!env.RPC_URL) return bad("chưa điền RPC_URL"), null;
  const provider = new ethers.JsonRpcProvider(env.RPC_URL, undefined, { staticNetwork: true });
  try {
    const { chainId } = await provider.getNetwork();
    if (chainId !== SEPOLIA_CHAIN_ID) {
      bad(`RPC trỏ tới chainId ${chainId}, không phải Sepolia (11155111)`);
    } else {
      ok(`kết nối được Sepolia, block mới nhất #${await provider.getBlockNumber()}`);
      return provider;
    }
  } catch (err) {
    bad(`không kết nối được: ${err.shortMessage || err.message}`);
  }
  provider.destroy();
  return null;
}

async function checkEtherscan() {
  console.log("2. ETHERSCAN_API_KEY");
  if (!env.ETHERSCAN_API_KEY) return bad("chưa điền ETHERSCAN_API_KEY");
  const url = new URL("https://api.etherscan.io/v2/api");
  url.search = new URLSearchParams({
    chainid: String(SEPOLIA_CHAIN_ID),
    module: "proxy",
    action: "eth_blockNumber",
    apikey: env.ETHERSCAN_API_KEY,
  });
  try {
    const data = await (await fetch(url)).json();
    if (typeof data.result === "string" && data.result.startsWith("0x")) ok("key hợp lệ với Sepolia");
    else bad(`Etherscan từ chối: ${data.result || data.message}`);
  } catch (err) {
    bad(`không gọi được Etherscan: ${err.message}`);
  }
}

async function checkWallets(provider) {
  console.log("3. Ví");
  if (env.NETWORK !== "sepolia") bad(`NETWORK đang là "${env.NETWORK || ""}", cần đặt NETWORK=sepolia`);
  else ok("NETWORK=sepolia");

  // Mức tối thiểu theo giá gas hiện tại: deploy ~2.54M gas (x2 dự phòng), oracle ~0.45M gas/phiên x 20 phiên
  const feeData = provider ? await provider.getFeeData() : null;
  const gasPrice = feeData ? feeData.maxFeePerGas ?? feeData.gasPrice : 0n;
  if (provider) console.log(`  (giá gas hiện tại ${ethers.formatUnits(gasPrice, "gwei")} gwei)`);
  for (const [name, key, minWei] of [
    ["DEPLOYER_PRIVATE_KEY", env.DEPLOYER_PRIVATE_KEY, 2_541_210n * 2n * gasPrice],
    ["ORACLE_PRIVATE_KEY", env.ORACLE_PRIVATE_KEY, 450_000n * 20n * gasPrice],
  ]) {
    if (!key) {
      bad(`chưa điền ${name}`);
      continue;
    }
    if (ethers.isAddress(key)) {
      bad(`${name} đang là địa chỉ ví (0x + 40 ký tự). Cần private key 64 ký tự: MetaMask -> Chi tiết tài khoản -> Khóa riêng tư`);
      continue;
    }
    let address;
    try {
      address = new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`).address;
    } catch {
      bad(`${name} không phải private key hợp lệ`);
      continue;
    }
    if (!provider) {
      ok(`${name} -> ${address}`);
      continue;
    }
    const balance = await provider.getBalance(address);
    const text = `${name} -> ${address}: ${ethers.formatEther(balance)} Sepolia ETH`;
    if (balance < minWei) bad(`${text} (nên có ít nhất ${ethers.formatEther(minWei)})`);
    else ok(text);
  }

  if (!env.NODE_WALLET) bad("chưa điền NODE_WALLET");
  else if (!ethers.isAddress(env.NODE_WALLET)) bad(`NODE_WALLET không phải địa chỉ ví hợp lệ: ${env.NODE_WALLET}`);
  else ok(`NODE_WALLET = ${ethers.getAddress(env.NODE_WALLET)}`);
}

(async () => {
  const provider = await checkRpc();
  await checkEtherscan();
  await checkWallets(provider);
  provider?.destroy();
  console.log(failed ? "\nCòn lỗi, sửa .env rồi chạy lại." : "\nSẵn sàng: npm run deploy:sepolia");
  process.exitCode = failed ? 1 : 0;
})();
