// Backend oracle: Firebase <-> P2PEnergyMarket
//  - Đầu phiên: dữ liệu đo của ESP32 (sensor_data_history) -> điện năng -> dự báo -> submitOffer/submitBid
//    (AI báo bất thường trong ai_analytics/latest thì không tự bán)
//  - Trong phiên: lệnh người dùng đặt trên frontend (market/asks, market/bids) -> submitManualOffer/submitManualBid
//  - Hết phiên: matchOrders -> ghi kết quả vào `transactions`, đổi status lệnh đã khớp hết thành "filled",
//    node có giao dịch khớp thì gửi TRADE_SUCCESS qua MQTT để ESP32 đóng relay lưới P2P
// Chạy: npm run oracle   (cần deploy trước, xem README)
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const cfg = require("./config");
const { createFirebaseClient } = require("./firebase");
const { integrateEnergy, hashRecords } = require("./energy");
const { ethToWei, parseMarketOrders } = require("./orders");
const { MODEL_ID, forecastNextSession } = require("./forecast");
const { buildTradeRecords } = require("./sync");
const { TRADE_SUCCESS, nodeTraded, createEsp32Notifier } = require("./mqtt");
const { evaluateAiGate } = require("./aiGate");

/** RPC URL của Alchemy/Infura chứa API key ở path (…/v2/<key>): chỉ in host, che phần còn lại */
function maskRpcUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.length > 1 || u.search || u.username ? `${u.protocol}//${u.host}/***` : u.origin;
  } catch {
    return "***";
  }
}
const rpcLabel = maskRpcUrl(cfg.rpcUrl);

// Mọi dòng log đều thay RPC URL đầy đủ bằng bản đã che, kể cả khi URL nằm trong thông báo lỗi của ethers
const redact = (arg) => (typeof arg === "string" ? arg.replaceAll(cfg.rpcUrl, rpcLabel) : arg);
const log = (...args) => console.log(`[${new Date().toLocaleTimeString("vi-VN")}]`, ...args.map(redact));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowSeconds = () => Math.floor(Date.now() / 1000);
const fmtEth = (wei) => `${ethers.formatEther(wei)} ETH`;
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString("vi-VN");

function loadDeployment() {
  const file = path.join(cfg.deploymentsDir, `${cfg.network}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Không thấy ${file}. Hãy chạy: npx hardhat run scripts/deploy.js --network ${cfg.network}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Trạng thái lưu ra file để khởi động lại không gửi trùng lệnh
function loadState(marketAddress) {
  try {
    const state = JSON.parse(fs.readFileSync(cfg.stateFile, "utf8"));
    if (state.marketAddress === marketAddress) return state;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return { marketAddress, nodeOrderSession: 0, handledOrders: [], openOrders: {} };
}

function saveState(state) {
  fs.writeFileSync(cfg.stateFile, JSON.stringify(state, null, 2));
}

function parseEvents(contract, receipt, name) {
  return receipt.logs
    .map((l) => {
      try {
        return contract.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.name === name);
}

async function main() {
  const firebase = createFirebaseClient(cfg.firebaseUrl);
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const deployment = loadDeployment();

  if (cfg.network !== "localhost" && (!cfg.oraclePrivateKey || !cfg.nodeWallet)) {
    throw new Error("Chạy ngoài localhost cần ORACLE_PRIVATE_KEY và NODE_WALLET trong .env");
  }
  const signer = cfg.oraclePrivateKey
    ? new ethers.Wallet(cfg.oraclePrivateKey, provider)
    : await provider.getSigner(1);
  const market = new ethers.Contract(deployment.P2PEnergyMarket.address, deployment.P2PEnergyMarket.abi, signer);

  const oracleAddress = await signer.getAddress();
  if ((await market.oracle()) !== oracleAddress) {
    throw new Error(`Ví ${oracleAddress} không phải oracle của contract (${await market.oracle()})`);
  }

  const modelHash = ethers.id(MODEL_ID);
  if (!(await market.approvedModels(modelHash))) {
    throw new Error(`Mô hình "${MODEL_ID}" chưa được duyệt trên contract. Owner cần gọi setModelApproved(${modelHash}, true)`);
  }

  const nodeWallet = cfg.nodeWallet || (await (await provider.getSigner(2)).getAddress());
  const sessionDuration = Number(await market.sessionDuration());
  // Đủ bản ghi phủ một phiên (ESP32 gửi 15 giây / bản ghi, lấy dư theo mức 2 giây / bản ghi)
  const historyLimit = Math.min(Math.ceil(sessionDuration / 2) + 20, 5000);

  log("=== BACKEND ORACLE P2P ENERGY ===");
  log(`Firebase        : ${cfg.firebaseUrl} (${cfg.firebaseWrite ? "đọc + ghi kết quả" : "chỉ đọc"})`);
  log(`Mạng            : ${cfg.network} (${rpcLabel})`);
  log(`Market contract : ${deployment.P2PEnergyMarket.address}`);
  log(`Oracle          : ${oracleAddress}`);
  log(`Node ${cfg.nodeId} thuộc ví: ${nodeWallet}`);
  log(`Dữ liệu IoT     : sensor_data_history (ESP32), công suất x${cfg.powerScale}`);
  log(`Chốt chặn AI    : ${cfg.aiGate ? `ai_analytics/latest, mẫu AI lệch tối đa ${cfg.aiMaxLagSeconds} giây` : "tắt (AI_GATE=false)"}`);
  log(`Lệnh ESP32      :${cfg.mqttUrl ? `MQTT ${cfg.mqttUrl} topic ${cfg.mqttTopic}` : "tắt (MQTT_URL rỗng)"}`);
  log(`Mô hình dự báo  : ${MODEL_ID} (${modelHash})`);
  log(`Độ dài phiên    : ${sessionDuration} giây`);

  const state = loadState(deployment.P2PEnergyMarket.address);
  const esp32 = createEsp32Notifier({ url: cfg.mqttUrl, topic: cfg.mqttTopic }, log);
  const ctx = { firebase, market, modelHash, nodeWallet, sessionDuration, historyLimit, state, esp32, notes: {} };
  let waitingLogged = 0;

  for (;;) {
    try {
      const session = Number(await market.currentSession());
      const deadline = Number(await market.sessionDeadline());

      if (nowSeconds() < deadline) {
        if (state.nodeOrderSession !== session) {
          log(`--- PHIÊN ${session} (đóng lúc ${fmtTime(deadline)}) ---`);
          await submitNodeOrder(ctx, session);
          state.nodeOrderSession = session; // mỗi phiên chỉ gửi một lệnh tự động cho node
          saveState(state);
        }
        await syncWebOrders(ctx, session);
        if (waitingLogged !== session) {
          log(`Phiên ${session}: chờ đến ${fmtTime(deadline)} để khớp lệnh...`);
          waitingLogged = session;
        }
      } else {
        await settleSession(ctx, session);
      }
    } catch (err) {
      log("LỖI:", err.shortMessage || err.message);
    }
    await sleep(cfg.pollSeconds * 1000);
  }
}

/** Ghi log một lần cho mỗi (phiên, khóa) để vòng lặp 5 giây không in lặp lại */
function logOnce(ctx, session, key, message) {
  if (ctx.notes[key] === session) return;
  ctx.notes[key] = session;
  log(message);
}

/** Lệnh tự động từ node IoT: lịch sử đo -> tích phân điện năng -> dự báo -> submitOffer/submitBid */
async function submitNodeOrder({ firebase, market, modelHash, nodeWallet, sessionDuration, historyLimit }, session) {
  const history = await firebase.getLatestReadings(historyLimit);
  const now = nowSeconds();

  // ESP32 không ghi trạng thái online riêng: node còn sống nếu bản ghi mới nhất đủ mới
  const latest = history.at(-1);
  if (!latest || now - latest.timestamp > cfg.nodeStaleSeconds) {
    const lastSeen = latest ? fmtTime(latest.timestamp) : "chưa có dữ liệu";
    log(`[IoT] ESP32 offline hoặc mất tín hiệu (bản ghi cuối: ${lastSeen}), bỏ qua lệnh tự động phiên này`);
    return;
  }
  const { electrical: e = {}, environment: env = {}, metadata = {} } = latest;
  log(
    `[IoT] ESP32 online, mẫu #${metadata.sample_id} lúc ${metadata.timestamp} | ` +
      `phát ${e.v_solar} V ${e.i_solar} mA ${e.p_solar} W | tải ${e.v_load} V ${e.i_load} mA ${e.p_load} W | ` +
      `tấm pin ${env.temp_panel} °C, môi trường ${env.temp_ambient} °C, ${env.irradiance} W/m²`
  );

  const measured = integrateEnergy(history, now - sessionDuration, now, cfg.maxGapSeconds, cfg.powerScale);
  if (measured.records.length < 2) {
    log(`[IoT] Không đủ dữ liệu đo trong ${sessionDuration} giây qua, bỏ qua lệnh tự động`);
    return;
  }
  log(
    `[IoT] ${measured.records.length} bản ghi, phủ ${measured.coveredSeconds} giây: ` +
      `phát ${measured.generationWh} Wh, tiêu thụ ${measured.consumptionWh} Wh (công suất x${cfg.powerScale})`
  );

  const forecast = await forecastNextSession({ measured });
  log(`[DỰ BÁO] Phiên tới: phát ${forecast.generationWh} Wh, tiêu thụ ${forecast.consumptionWh} Wh`);

  const gate = await checkAiGate(firebase, latest.timestamp);
  // Bản ghi AI chỉ vào dataHash khi chốt chặn thực sự dựa vào nó (ok/anomaly), để on-chain chứng minh được AI đã báo gì
  const aiUsed = gate.status === "ok" || gate.status === "anomaly" ? gate.record : undefined;
  const dataHash = hashRecords(cfg.nodeId, measured.records, aiUsed);
  log(`[DỰ BÁO] dataHash = ${dataHash}${aiUsed ? " (gồm bản ghi AI)" : ""}`);

  const wantsToSell = forecast.generationWh > forecast.consumptionWh;
  if (wantsToSell && gate.status === "anomaly") {
    log(`[AI]  Không tự bán ${forecast.generationWh - forecast.consumptionWh} Wh phiên này: ${gate.reason}`);
    return;
  }

  let tx;
  let order;
  if (wantsToSell) {
    const price = ethToWei(cfg.nodeAskPriceEth);
    tx = await market.submitOffer(nodeWallet, forecast.generationWh, forecast.consumptionWh, price, dataHash, modelHash);
    order = { side: "asks", type: "ask", energyWh: forecast.generationWh - forecast.consumptionWh, priceEth: cfg.nodeAskPriceEth };
    log(`[CHAIN] submitOffer: bán ${order.energyWh} Wh, sàn ${cfg.nodeAskPriceEth} ETH/kWh`);
  } else if (forecast.consumptionWh > forecast.generationWh) {
    const price = ethToWei(cfg.nodeBidPriceEth);
    tx = await market.submitBid(nodeWallet, forecast.generationWh, forecast.consumptionWh, price, dataHash, modelHash);
    order = { side: "bids", type: "bid", energyWh: forecast.consumptionWh - forecast.generationWh, priceEth: cfg.nodeBidPriceEth };
    log(`[CHAIN] submitBid: mua ${order.energyWh} Wh, trần ${cfg.nodeBidPriceEth} ETH/kWh`);
  } else {
    log("[CHAIN] Dự báo cân bằng, không gửi lệnh");
    return;
  }
  await tx.wait();
  log(`[CHAIN] tx ${tx.hash}`);

  if (cfg.firebaseWrite) {
    try {
      await publishNodeOrder(firebase, { ...order, nodeWallet, session, hash: tx.hash });
    } catch (err) {
      log("[FIREBASE] Không ghi được lệnh node vào market:", err.message);
    }
  }
}

/** Đọc ai_analytics/latest và đánh giá; lỗi đọc Firebase coi như không có AI, không làm hỏng lệnh tự động */
async function checkAiGate(firebase, latestReadingTs) {
  if (!cfg.aiGate) return { status: "off" };
  let ai;
  try {
    ai = await firebase.getAiLatest();
  } catch (err) {
    log(`[AI]  Không đọc được ai_analytics/latest (${err.message}), bỏ qua chốt chặn AI`);
    return { status: "missing" };
  }
  const gate = evaluateAiGate(ai, latestReadingTs, cfg.aiMaxLagSeconds);
  if (gate.status === "ok") log(`[AI]  ${gate.reason} (mẫu #${ai.sample_id}, lệch ${gate.lagSeconds} giây so với ESP32)`);
  else if (gate.status === "anomaly") log(`[AI]  CẢNH BÁO ${gate.reason} (mẫu #${ai.sample_id})`);
  else log(`[AI]  Bỏ qua chốt chặn AI: ${gate.reason}. Lệnh tự động dựa trên số đo như khi chưa có AI`);
  return gate;
}

const nodeOrderKey = () => `iot_${cfg.nodeId}`;

/** Hiện lệnh tự động của node trên sổ lệnh frontend (market/asks hoặc market/bids), cùng schema lệnh người dùng */
async function publishNodeOrder(firebase, { side, type, energyWh, priceEth, nodeWallet, session, hash }) {
  const other = side === "asks" ? "bids" : "asks";
  await firebase.set(`market/${side}/${nodeOrderKey()}`, {
    type,
    price_ETH: Number(priceEth),
    amount_kWh: energyWh / 1000,
    addr: nodeWallet,
    status: "open",
    timestamp: nowSeconds(),
    source: "iot",
    session,
    hash,
  });
  await firebase.remove(`market/${other}/${nodeOrderKey()}`);
  log(`[FIREBASE] Hiện lệnh node trên market/${side}/${nodeOrderKey()}`);
}

/** Lệnh node chỉ sống trong một phiên, hết phiên thì gỡ khỏi sổ lệnh */
async function clearNodeOrder(firebase) {
  await firebase.remove(`market/asks/${nodeOrderKey()}`);
  await firebase.remove(`market/bids/${nodeOrderKey()}`);
}

/**
 * Lệnh người dùng đặt trên frontend (EnergyMarket.jsx push vào market/bids|asks).
 * Lệnh còn "open" được giữ qua nhiều phiên: phiên nào chưa khớp hết thì phiên sau gửi lại phần còn lại.
 */
async function syncWebOrders(ctx, session) {
  const { firebase, market, state } = ctx;
  const { valid, invalid } = parseMarketOrders(await firebase.getMarket());
  const current = new Map(valid.map((o) => [o.key, o]));
  const handled = new Set(state.handledOrders);

  if (invalid.length > 0) {
    logOnce(ctx, session, "invalid", `[WEB] Bỏ qua ${invalid.length} lệnh không hợp lệ, ví dụ ${invalid[0].where}: ${invalid[0].reason}`);
  }

  for (const o of valid) {
    if (handled.has(o.key)) continue;
    state.openOrders[o.key] = {
      key: o.key,
      side: o.side,
      addr: o.addr,
      remainingWh: o.energyWh,
      priceWei: o.priceWei.toString(),
      session: 0,
      onchainId: null,
    };
    state.handledOrders.push(o.key);
    log(`[WEB] Nhận lệnh ${o.side === "ask" ? "BÁN" : "MUA"} ${o.energyWh} Wh @ ${fmtEth(o.priceWei)}/kWh từ ${o.addr} (${o.where})`);
  }

  for (const key of Object.keys(state.openOrders)) {
    if (!current.has(key)) {
      log(`[WEB] Lệnh ${key} không còn "open" trên Firebase, ngừng đưa lên chain`);
      delete state.openOrders[key];
    }
  }
  saveState(state);

  for (const o of Object.values(state.openOrders)) {
    if (o.session === session) continue;
    const price = BigInt(o.priceWei);

    if (o.side === "bid") {
      const needed = (BigInt(o.remainingWh) * price) / 1000n;
      const deposit = await market.balances(o.addr);
      if (deposit < needed) {
        logOnce(ctx, session, `deposit:${o.key}`, `[WEB] Chưa gửi lệnh mua của ${o.addr}: ký quỹ ${fmtEth(deposit)} < cần ${fmtEth(needed)}`);
        continue;
      }
    }

    const tx =
      o.side === "ask"
        ? await market.submitManualOffer(o.addr, o.remainingWh, price)
        : await market.submitManualBid(o.addr, o.remainingWh, price);
    const receipt = await tx.wait();
    const [placed] = parseEvents(market, receipt, o.side === "ask" ? "OfferSubmitted" : "BidSubmitted");
    o.session = session;
    o.onchainId = Number(o.side === "ask" ? placed.args.offerId : placed.args.bidId);
    saveState(state);
    log(`[CHAIN] ${o.side === "ask" ? "submitManualOffer" : "submitManualBid"} ${o.remainingWh} Wh từ ${o.addr} (tx ${tx.hash})`);
  }
}

async function settleSession(ctx, session) {
  const { market, state } = ctx;
  let receipt;
  try {
    receipt = await (await market.matchOrders()).wait();
  } catch (err) {
    if ((err.shortMessage || err.message).includes("Session still open")) return; // đồng hồ chain chưa tới deadline
    throw err;
  }

  const matched = parseEvents(market, receipt, "Matched");
  const rejected = parseEvents(market, receipt, "BidRejected");
  log(`[CHAIN] matchOrders phiên ${session} (tx ${receipt.hash}): ${matched.length} cặp khớp, ${rejected.length} lệnh mua bị loại`);

  const openBy = (side, id) =>
    Object.values(state.openOrders).find((o) => o.side === side && o.session === session && o.onchainId === Number(id));

  for (const { args } of matched) {
    log(`        ${args.seller} -> ${args.buyer}: ${args.energyWh} Wh x ${fmtEth(args.clearingPricePerKWh)}/kWh = ${fmtEth(args.totalCost)}`);
    for (const o of [openBy("ask", args.offerId), openBy("bid", args.bidId)]) {
      if (o) o.remainingWh -= Number(args.energyWh);
    }
  }
  for (const { args } of rejected) {
    log(`        Loại ${args.buyer}: cần ${fmtEth(args.requiredCost)} (${args.reason})`);
  }

  const filled = Object.values(state.openOrders).filter((o) => o.remainingWh <= 0);
  for (const o of filled) delete state.openOrders[o.key];
  saveState(state);

  // Một tin cho cả phiên dù node khớp nhiều cặp: ESP32 chỉ cần một lần đóng relay
  if (nodeTraded(matched, ctx.nodeWallet)) await ctx.esp32.send(TRADE_SUCCESS);

  if (!cfg.firebaseWrite) return;
  try {
    await clearNodeOrder(ctx.firebase);
    if (matched.length > 0) await writeResultsToFirebase(ctx, receipt, matched, filled);
  } catch (err) {
    log("[FIREBASE] Ghi kết quả lỗi (giao dịch on-chain vẫn thành công):", err.message);
  }
}

async function writeResultsToFirebase({ firebase }, receipt, matched, filled) {
  const block = await receipt.getBlock();
  let records = 0;
  for (const { args } of matched) {
    const trade = {
      hash: receipt.hash,
      block: receipt.blockNumber,
      timestamp: block.timestamp,
      sessionId: args.sessionId,
      seller: args.seller,
      buyer: args.buyer,
      energyWh: args.energyWh,
      pricePerKWh: args.clearingPricePerKWh,
      totalCost: args.totalCost,
    };
    for (const record of buildTradeRecords(trade)) {
      await firebase.push("transactions", record);
      records++;
    }
  }

  // Tìm lại vị trí hiện tại của lệnh (mảng có thể bị đánh lại chỉ số); lệnh đã bị xóa thì không ghi để không tạo bản ghi rỗng
  const { valid } = parseMarketOrders(await firebase.getMarket());
  const whereByKey = new Map(valid.map((o) => [o.key, o.where]));
  let updated = 0;
  for (const o of filled) {
    const where = whereByKey.get(o.key);
    if (!where) continue;
    await firebase.update(where, { status: "filled" });
    updated++;
  }
  log(`[FIREBASE] Đã ghi ${records} bản ghi vào transactions, đổi ${updated} lệnh sang "filled"`);
}

main().catch((err) => {
  const message = err.shortMessage || err.message;
  log("Backend dừng:", message);
  if (message.includes("ECONNREFUSED")) log(`Không kết nối được ${rpcLabel}. Đã chạy \`npx hardhat node\` chưa?`);
  process.exit(1); // provider của ethers tự thử kết nối lại mãi nếu không thoát hẳn
});
