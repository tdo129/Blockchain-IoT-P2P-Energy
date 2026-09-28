const { expect } = require("chai");
const { ethers } = require("ethers");
const { integrateEnergy, canonicalJson, hashRecords } = require("../backend/energy");
const { ethToWei, kwhToWh, parseMarketOrders } = require("../backend/orders");
const { buildTradeRecords } = require("../backend/sync");
const { pushKeyTime, parseDeviceTime, normalizeReading } = require("../backend/sensor");
const { nodeTraded } = require("../backend/mqtt");

// Bản ghi cùng cấu trúc ESP32 (blockchainV2.ino) ghi vào sensor_data_history, sau normalizeReading
const reading = (timestamp, genW, loadW) => ({
  key: `-key${timestamp}`,
  timestamp,
  metadata: { sample_id: timestamp - 999, timestamp: "2026-09-28 15:03:14" },
  electrical: { v_solar: 4.5, i_solar: (genW / 4.5) * 1000, p_solar: genW, v_load: 5, i_load: (loadW / 5) * 1000, p_load: loadW },
  environment: { irradiance: (genW / 3) * 1000, temp_panel: 45.7, temp_ambient: 37.4 },
});

describe("Backend - đọc bản ghi ESP32 trên Firebase", function () {
  it("đọc metadata.timestamp theo giờ Việt Nam (UTC+7)", function () {
    expect(parseDeviceTime("2026-09-28 15:03:14")).to.equal(Date.UTC(2026, 8, 28, 8, 3, 14) / 1000);
    expect(parseDeviceTime("N/A")).to.equal(null);
  });

  it("giải mã thời điểm Firebase nhận bản ghi từ push key", function () {
    // Push key thật trong sensor_data_history, Firebase nhận lúc 15:03:25 giờ Việt Nam
    expect(pushKeyTime("-P2b1ZP77h-rqhJ0yVLK")).to.equal(Date.UTC(2026, 8, 28, 8, 3, 25) / 1000);
    expect(pushKeyTime("record_0")).to.equal(null);
  });

  it("ESP32 chưa đồng bộ NTP (timestamp N/A) thì lấy thời điểm từ push key", function () {
    const record = { metadata: { sample_id: 1, timestamp: "N/A" }, electrical: { p_solar: 0.9, p_load: 0.3 } };
    const r = normalizeReading("-P2b1ZP77h-rqhJ0yVLK", record);
    expect(r.timestamp).to.equal(pushKeyTime("-P2b1ZP77h-rqhJ0yVLK"));
    expect(r.electrical).to.deep.equal(record.electrical);
  });
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
    // ESP32 có lúc đo ra dòng tải âm nhỏ (i_load -0.2 mA)
    const bad = { key: "x", timestamp: 1010, electrical: { p_solar: -50 } };
    const r = integrateEnergy([reading(1000, 0, 0), bad], 1000, 1010, 30);
    expect(r.generationWh).to.equal(0);
    expect(r.consumptionWh).to.equal(0);
  });

  it("nhân công suất mô hình với powerScale", function () {
    // 0.9 W phát, 0.36 W tải trong 600 giây: 0.15 Wh và 0.06 Wh, làm tròn về 0 nếu không quy đổi
    const records = [0, 300, 600].map((t) => reading(1000 + t, 0.9, 0.36));
    expect(integrateEnergy(records, 1000, 1600, 300).generationWh).to.equal(0);
    const r = integrateEnergy(records, 1000, 1600, 300, 1000);
    expect(r.generationWh).to.equal(150);
    expect(r.consumptionWh).to.equal(60);
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
    tampered[1].electrical.p_solar = 111;
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

describe("Backend - gửi TRADE_SUCCESS cho ESP32 qua MQTT", function () {
  const node = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const user = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const other = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
  const match = (seller, buyer) => ({ args: { seller, buyer } });

  it("gửi khi node là người bán hoặc người mua, không phân biệt chữ hoa/thường của NODE_WALLET", function () {
    expect(nodeTraded([match(node, user)], node.toLowerCase())).to.equal(true);
    expect(nodeTraded([match(user, node)], node)).to.equal(true);
  });

  it("không gửi khi phiên không có cặp khớp hoặc chỉ người dùng khác khớp với nhau", function () {
    expect(nodeTraded([], node)).to.equal(false);
    expect(nodeTraded([match(user, other)], node)).to.equal(false);
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
