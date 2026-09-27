const { expect } = require("chai");
const { ethers } = require("ethers");
const { integrateEnergy, canonicalJson, hashRecords } = require("../backend/energy");
const { ethToWei, kwhToWh, parseMarketOrders } = require("../backend/orders");
const { buildTradeRecords } = require("../backend/sync");

// Bản ghi cùng cấu trúc lich_su_do trên Firebase
const reading = (timestamp, genW, loadW) => ({
  key: `-key${timestamp}`,
  timestamp,
  nguon_phat: { cong_suat_W: genW, dien_ap_V: 22, dong_dien_A: genW / 22, dien_nang_san_xuat_kWh: 12 },
  tai_tieu_thu: { cong_suat_W: loadW, dien_ap_V: 12.5, dong_dien_A: loadW / 12.5, dien_nang_tieu_thu_kWh: 7 },
});

describe("Backend - tính điện năng từ dữ liệu cảm biến", function () {
  it("tích phân công suất không đổi: 360 W trong 10 giây = 1 Wh", function () {
    const records = [0, 5, 10].map((t) => reading(1000 + t, 360, 180));
    const r = integrateEnergy(records, 1000, 1010, 30);
    expect(r.generationWh).to.equal(1);
    expect(r.consumptionWh).to.equal(1); // 180 W × 10 s = 0.5 Wh, làm tròn lên 1
    expect(r.coveredSeconds).to.equal(10);
  });

  it("dùng quy tắc hình thang khi công suất thay đổi", function () {
    // (0 + 7200)/2 W × 10 s = 36000 J = 10 Wh
    const r = integrateEnergy([reading(1000, 0, 0), reading(1010, 7200, 0)], 1000, 1010, 30);
    expect(r.generationWh).to.equal(10);
  });

  it("chỉ lấy bản ghi trong cửa sổ thời gian", function () {
    const records = [reading(900, 3600, 0), reading(1000, 3600, 0), reading(1100, 3600, 0)];
    const r = integrateEnergy(records, 950, 1200, 200);
    expect(r.records.map((x) => x.timestamp)).to.deep.equal([1000, 1100]);
    expect(r.generationWh).to.equal(100); // 3600 W × 100 s
  });

  it("không tích phân qua khoảng mất dữ liệu dài hơn maxGap", function () {
    const records = [reading(1000, 3600, 0), reading(1005, 3600, 0), reading(1600, 3600, 0)];
    const r = integrateEnergy(records, 1000, 1600, 30);
    expect(r.coveredSeconds).to.equal(5);
    expect(r.generationWh).to.equal(5);
  });

  it("coi công suất âm hoặc thiếu là 0", function () {
    const bad = { key: "x", timestamp: 1010, nguon_phat: { cong_suat_W: -50 }, tai_tieu_thu: {} };
    const r = integrateEnergy([reading(1000, 0, 0), bad], 1000, 1010, 30);
    expect(r.generationWh).to.equal(0);
    expect(r.consumptionWh).to.equal(0);
  });
});

describe("Backend - hash dữ liệu", function () {
  it("JSON chuẩn hóa không phụ thuộc thứ tự khóa", function () {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).to.equal(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("cùng dữ liệu cho cùng hash, sửa một số liệu thì hash đổi", function () {
    const records = [reading(1000, 100, 50), reading(1005, 110, 55)];
    const h1 = hashRecords("node_01", records);
    expect(hashRecords("node_01", JSON.parse(JSON.stringify(records)))).to.equal(h1);

    const tampered = JSON.parse(JSON.stringify(records));
    tampered[1].nguon_phat.cong_suat_W = 111;
    expect(hashRecords("node_01", tampered)).to.not.equal(h1);
  });
});

describe("Backend - đọc lệnh từ market trên Firebase", function () {
  const addr = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";

  it("đổi đơn vị ETH -> wei và kWh -> Wh", function () {
    expect(ethToWei(0.058)).to.equal(ethers.parseEther("0.058"));
    expect(ethToWei(1e-7)).to.equal(ethers.parseEther("0.0000001"));
    expect(kwhToWh(224.2)).to.equal(224200);
  });

  it("chuyển lệnh hợp lệ thành lệnh cho contract", function () {
    const market = {
      asks: [{ addr, amount_kWh: 0.5, price_ETH: 0.058, status: "open", timestamp: 1, type: "ask" }],
      bids: [{ addr, amount_kWh: 0.2, price_ETH: 0.06, status: "open", timestamp: 2, type: "bid" }],
    };
    const { valid, invalid } = parseMarketOrders(market);
    expect(invalid).to.have.length(0);
    expect(valid).to.have.length(2);
    expect(valid[0]).to.include({ side: "ask", energyWh: 500, addr: ethers.getAddress(addr) });
    expect(valid[0].priceWei).to.equal(ethers.parseEther("0.058"));
    expect(valid[1]).to.include({ side: "bid", energyWh: 200 });
  });

  it("nhận lệnh do frontend push (push key, địa chỉ MetaMask chữ thường)", function () {
    // Cùng cấu trúc EnergyMarket.jsx ghi khi bấm "Gửi lệnh MUA"
    const market = {
      bids: {
        "-OaBcPushKey": { type: "bid", price_ETH: 0.0575, amount_kWh: 2, addr, status: "open", timestamp: 1790000000 },
      },
    };
    const { valid, invalid } = parseMarketOrders(market);
    expect(invalid).to.have.length(0);
    expect(valid[0]).to.include({ side: "bid", energyWh: 2000, where: "market/bids/-OaBcPushKey" });
    expect(valid[0].priceWei).to.equal(ethers.parseEther("0.0575"));
  });

  it("không chuyển tiếp lại lệnh node IoT mà backend tự ghi để hiển thị", function () {
    const market = {
      asks: { iot_node_01: { type: "ask", price_ETH: 0.05, amount_kWh: 0.002, addr, status: "open", timestamp: 1, source: "iot" } },
    };
    const { valid, invalid } = parseMarketOrders(market);
    expect(valid).to.have.length(0);
    expect(invalid).to.have.length(0);
  });

  it("bỏ qua lệnh đã khớp và báo lệnh có địa chỉ ví sai như dữ liệu hiện tại", function () {
    const market = {
      asks: [
        { addr: "0x5b8b46f7", amount_kWh: 224.2, price_ETH: 0.058, status: "open", timestamp: 1, type: "ask" },
        { addr, amount_kWh: 1, price_ETH: 0.05, status: "filled", timestamp: 2, type: "ask" },
      ],
      bids: { "-pushKey": { addr, amount_kWh: 0, price_ETH: 0.05, status: "open", timestamp: 3, type: "bid" } },
    };
    const { valid, invalid } = parseMarketOrders(market);
    expect(valid).to.have.length(0);
    expect(invalid.map((o) => o.where)).to.deep.equal(["market/asks/0", "market/bids/-pushKey"]);
    expect(invalid[0].reason).to.contain("địa chỉ ví không hợp lệ");
  });
});

describe("Backend - bản ghi transactions cho frontend", function () {
  const seller = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const buyer = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const hash = `0x${"ab".repeat(32)}`;

  const records = buildTradeRecords({
    hash,
    block: 6543210n,
    timestamp: 1790482500,
    sessionId: 3n,
    seller,
    buyer,
    energyWh: 2000n,
    pricePerKWh: ethers.parseEther("0.06"),
    totalCost: ethers.parseEther("0.12"),
  });

  it("mỗi lần khớp tạo một bản ghi bán (+ETH) cho người bán và một bản ghi mua (-ETH) cho người mua", function () {
    expect(records.map((r) => [r.type, r.value_ETH, r.addr])).to.deep.equal([
      ["sell", 0.12, seller],
      ["buy", -0.12, buyer],
    ]);
  });

  it("đủ các trường Transactions.jsx đọc, đúng kiểu dữ liệu", function () {
    for (const r of records) {
      expect(r).to.include({ hash, block: 6543210, timestamp: 1790482500, status: "success", amount_kWh: 2 });
      expect(r.hash).to.match(/^0x[0-9a-f]{64}$/); // link sepolia.etherscan.io/tx/<hash> hợp lệ
      expect(Number.isInteger(r.block)).to.equal(true); // frontend gọi tx.block.toLocaleString()
    }
  });
});
