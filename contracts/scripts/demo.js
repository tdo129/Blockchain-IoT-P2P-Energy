// scripts/demo.js
// Mô phỏng nhanh toàn luồng với dữ liệu CỐ ĐỊNH (không đọc Firebase): IoT -> AI -> Blockchain
// Chạy: npx hardhat run scripts/demo.js
// Muốn chạy với dữ liệu Firebase thật, dùng backend: node backend/oracle.js (xem README)
const hre = require("hardhat");
const { ethers } = hre;
const { hashRecords } = require("../backend/energy");

const ETH = (amount) => ethers.parseEther(amount.toString());
const fmtEth = (wei) => `${ethers.formatEther(wei)} ETH`;
const fmtSLR = (raw) => `${ethers.formatUnits(raw, 3)} SLR`;

const MODEL_ID = "naive-persistence-v1";

// sensor   = bản ghi đo (cùng cấu trúc lich_su_do trên Firebase), chỉ hash được đưa lên chain
// forecast = điện năng dự báo cho phiên tới
// priceEth = giá giới hạn (ETH/kWh): giá sàn nếu bán, giá trần nếu mua
const households = [
  {
    name: "Hộ A",
    sensor: { nguon_phat: { dien_ap_V: 23.4, dong_dien_A: 7.8, cong_suat_W: 182.5 }, tai_tieu_thu: { dien_ap_V: 12.5, dong_dien_A: 10.4, cong_suat_W: 130.0 }, timestamp: 1790000000 },
    forecast: { generationWh: 1800, consumptionWh: 1300 },
    priceEth: "0.05",
  },
  {
    name: "Hộ B",
    sensor: { nguon_phat: { dien_ap_V: 22.9, dong_dien_A: 5.2, cong_suat_W: 119.1 }, tai_tieu_thu: { dien_ap_V: 12.8, dong_dien_A: 7.0, cong_suat_W: 89.6 }, timestamp: 1790000000 },
    forecast: { generationWh: 1200, consumptionWh: 900 },
    priceEth: "0.055",
  },
  {
    name: "Hộ C",
    sensor: { nguon_phat: { dien_ap_V: 21.8, dong_dien_A: 1.8, cong_suat_W: 39.2 }, tai_tieu_thu: { dien_ap_V: 12.3, dong_dien_A: 8.1, cong_suat_W: 99.6 }, timestamp: 1790000000 },
    forecast: { generationWh: 400, consumptionWh: 1000 },
    priceEth: "0.07",
  },
  {
    name: "Hộ D",
    sensor: { nguon_phat: { dien_ap_V: 20.9, dong_dien_A: 1.2, cong_suat_W: 25.1 }, tai_tieu_thu: { dien_ap_V: 12.1, dong_dien_A: 4.1, cong_suat_W: 49.6 }, timestamp: 1790000000 },
    forecast: { generationWh: 250, consumptionWh: 500 },
    priceEth: "0.045",
  },
];

const line = () => console.log("--------------------------------------------------");

function parseEvents(contract, receipt, name) {
  return receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.name === name);
}

async function main() {
  const [deployer, oracle, ...rest] = await ethers.getSigners();
  households.forEach((h, i) => (h.wallet = rest[i]));

  console.log("BƯỚC 1: DEPLOY HỆ THỐNG HỢP ĐỒNG");
  line();
  const token = await (await ethers.getContractFactory("SolarToken")).deploy(0);
  await token.waitForDeployment();
  const SESSION_DURATION = 600;
  const market = await (await ethers.getContractFactory("P2PEnergyMarket")).deploy(
    await token.getAddress(),
    oracle.address,
    SESSION_DURATION
  );
  await market.waitForDeployment();
  await (await token.transferOwnership(await market.getAddress())).wait();
  const modelHash = ethers.id(MODEL_ID);
  await (await market.setModelApproved(modelHash, true)).wait();
  console.log("SolarToken (thưởng) :", await token.getAddress());
  console.log("P2PEnergyMarket     :", await market.getAddress());
  console.log(`Mô hình được duyệt  : "${MODEL_ID}"\n`);

  console.log("BƯỚC 2: DỮ LIỆU IOT + DỰ BÁO AI -> BACKEND CHUẨN BỊ LỆNH");
  line();
  for (const h of households) {
    h.dataHash = hashRecords(h.name, [h.sensor]);
    h.netWh = h.forecast.generationWh - h.forecast.consumptionWh;
    h.role = h.netWh > 0 ? "BÁN" : "MUA";
    console.log(
      `${h.name}: phát ${h.forecast.generationWh} Wh, tiêu thụ ${h.forecast.consumptionWh} Wh -> ${h.role} ` +
        `${Math.abs(h.netWh)} Wh, giá ${h.role === "BÁN" ? "sàn" : "trần"} ${h.priceEth} ETH/kWh`
    );
  }
  console.log("");

  console.log("BƯỚC 3: HỘ MUA NẠP ETH KÝ QUỸ (trên web: qua MetaMask)");
  line();
  for (const h of households.filter((x) => x.role === "MUA")) {
    await (await market.connect(h.wallet).deposit({ value: ETH("0.1") })).wait();
    console.log(`${h.name} nạp 0.1 ETH vào contract`);
  }
  console.log("");

  console.log("BƯỚC 4: ORACLE GỬI LỆNH LÊN SMART CONTRACT");
  line();
  for (const h of households) {
    const args = [h.wallet.address, h.forecast.generationWh, h.forecast.consumptionWh, ETH(h.priceEth), h.dataHash, modelHash];
    const tx = h.role === "BÁN" ? await market.connect(oracle).submitOffer(...args) : await market.connect(oracle).submitBid(...args);
    const receipt = await tx.wait();
    const [placed] = parseEvents(market, receipt, h.role === "BÁN" ? "OfferSubmitted" : "BidSubmitted");
    console.log(`[${h.role}] ${h.name}: contract tự tính lượng = ${placed.args.energyWh} Wh (tx ${tx.hash.slice(0, 12)}...)`);
  }
  console.log("");

  console.log("BƯỚC 5: CHỜ PHIÊN ĐẤU GIÁ ĐÓNG (tua thời gian trên mạng ảo)");
  line();
  await ethers.provider.send("evm_increaseTime", [SESSION_DURATION + 1]);
  await ethers.provider.send("evm_mine");
  console.log(`Đã tua ${SESSION_DURATION + 1} giây -> phiên 1 đã đóng.\n`);

  console.log("BƯỚC 6: KHỚP LỆNH VÀ THANH TOÁN ETH");
  line();
  const receipt = await (await market.connect(oracle).matchOrders()).wait();
  const nameOf = (addr) => households.find((h) => h.wallet.address === addr).name;
  const matched = parseEvents(market, receipt, "Matched");
  for (const { args } of matched) {
    console.log(
      `[PHIÊN ${args.sessionId}] ${nameOf(args.seller)} bán cho ${nameOf(args.buyer)}: ${args.energyWh} Wh ` +
        `x ${fmtEth(args.clearingPricePerKWh)}/kWh = ${fmtEth(args.totalCost)}`
    );
  }
  for (const { args } of parseEvents(market, receipt, "BidRejected")) {
    console.log(`[BỊ LOẠI] ${nameOf(args.buyer)} cần ${fmtEth(args.requiredCost)}: ${args.reason}`);
  }
  if (matched.length === 0) console.log("Không có lệnh nào khớp.");
  console.log("");

  console.log("BƯỚC 7: SỐ DƯ SAU KHI KHỚP LỆNH (đọc on-chain)");
  line();
  for (const h of households) {
    console.log(
      `${h.name}: ký quỹ ${fmtEth(await market.balances(h.wallet.address))}, thưởng ${fmtSLR(await token.balanceOf(h.wallet.address))}`
    );
  }

  const seller = households[0];
  const earned = await market.balances(seller.wallet.address);
  await (await market.connect(seller.wallet).withdraw(earned)).wait();
  console.log(`\n${seller.name} rút ${fmtEth(earned)} tiền bán điện về ví MetaMask.`);
  console.log("Phiên đấu giá kế tiếp đã tự động mở:", (await market.currentSession()).toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
