// CHỈ DÙNG CHO DEMO LOCAL: giả lập một người dùng nạp ETH và đặt lệnh mua trên web.
// Cần vì market/bids trên Firebase hiện có địa chỉ ví không hợp lệ nên không có người mua thật.
// Chạy trong phiên đang mở: npx hardhat run scripts/local-buyer.js --network localhost
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  const { P2PEnergyMarket } = JSON.parse(fs.readFileSync(file, "utf8"));
  const marketAddress = P2PEnergyMarket.address;

  const signers = await hre.ethers.getSigners();
  const oracle = signers[1];
  const buyer = signers[3];
  const market = await hre.ethers.getContractAt("P2PEnergyMarket", marketAddress);

  const depositEth = process.env.BUYER_DEPOSIT_ETH || "0.01";
  const energyWh = Number(process.env.BUYER_WH || 20);
  const priceEth = process.env.BUYER_PRICE_ETH || "0.07";

  await (await market.connect(buyer).deposit({ value: hre.ethers.parseEther(depositEth) })).wait();
  console.log(`Người mua ${buyer.address} nạp ${depositEth} ETH vào ký quỹ`);

  // Thay cho bước: người dùng bấm "Đặt lệnh mua" trên web -> backend chuyển tiếp lên chain
  await (await market.connect(oracle).submitManualBid(buyer.address, energyWh, hre.ethers.parseEther(priceEth))).wait();
  console.log(`Đã đặt lệnh mua ${energyWh} Wh, giá trần ${priceEth} ETH/kWh ở phiên ${await market.currentSession()}`);
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
