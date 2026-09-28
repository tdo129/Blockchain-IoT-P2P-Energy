// Kết nối frontend với smart contract trên Sepolia.
// Địa chỉ + ABI đọc từ bản copy trong frontend (Vercel chỉ build folder frontend, không đọc được ../contracts).
// `npm run deploy:sepolia` (folder contracts) ghi cả contracts/deployments/sepolia.json và bản copy này.
import { ethers } from 'ethers';
import deployment from './deployments/sepolia.json';
import { db, ref, push } from './firebase';

export const SEPOLIA_CHAIN_ID = 11155111n;
export const ETHERSCAN_URL = 'https://sepolia.etherscan.io';
export const MARKET_ADDRESS = deployment.P2PEnergyMarket.address;
export const TOKEN_ADDRESS = deployment.SolarToken.address;

/** Provider MetaMask; null nếu chưa cài MetaMask hoặc MetaMask không ở mạng Sepolia */
export async function getSepoliaProvider() {
  if (!window.ethereum) return null;
  const provider = new ethers.BrowserProvider(window.ethereum);
  const { chainId } = await provider.getNetwork();
  return chainId === SEPOLIA_CHAIN_ID ? provider : null;
}

/** P2PEnergyMarket + SolarToken, gắn với provider (chỉ đọc) hoặc signer (gửi giao dịch) */
export function getContracts(runner) {
  return {
    market: new ethers.Contract(MARKET_ADDRESS, deployment.P2PEnergyMarket.abi, runner),
    token: new ethers.Contract(TOKEN_ADDRESS, deployment.SolarToken.abi, runner),
  };
}

export async function getSignerContracts() {
  const provider = await getSepoliaProvider();
  if (!provider) throw new Error('Vui lòng chuyển MetaMask sang mạng Sepolia');
  return getContracts(await provider.getSigner());
}

/** Tiền phải trả (wei) cho lệnh, cùng công thức contract: energyWh × giá(wei/kWh) / 1000 */
export function orderCostWei(priceEth, amountKWh) {
  const energyWh = BigInt(Math.round(Number(amountKWh) * 1000));
  return (energyWh * ethers.parseEther(String(priceEth))) / 1000n;
}

/** Ghi giao dịch on-chain (nạp/rút ký quỹ) vào `transactions` để trang Transactions và My Wallet hiển thị */
export async function recordTransaction(receipt, { type, value_ETH, addr, note }) {
  const block = await receipt.getBlock();
  await push(ref(db, 'transactions'), {
    hash: receipt.hash,
    type,
    value_ETH,
    block: receipt.blockNumber,
    timestamp: block.timestamp,
    status: receipt.status === 1 ? 'success' : 'failed',
    addr,
    note,
  });
}
