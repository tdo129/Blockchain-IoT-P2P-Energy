/**
 * simulate.mjs — Mô phỏng ESP32 (blockchainV2.ino) đẩy dữ liệu cảm biến lên Firebase Realtime Database
 * Chạy: node simulate.mjs            (chỉ dùng khi ESP32 thật KHÔNG chạy, vì ghi vào cùng nhánh dữ liệu)
 *
 * Giống hệt ESP32, mỗi 15 giây:
 *   POST sensor_data_history          ← lịch sử vĩnh viễn (push key)
 *   PUT  sensor_data_recent/record_N  ← bộ đệm 10 mẫu gần nhất cho AI, N = (sample_id - 1) % 10
 * Cùng JSON: { metadata, electrical, environment } (xem blockchainV2.ino, TaskMQTT)
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, push } from 'firebase/database';

// ── Firebase Init ─────────────────────────────────────────────────────────
const DATABASE_URL = 'https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app/';
const firebaseConfig = {
  databaseURL: DATABASE_URL,
  projectId: 'blockchain-6d10b',
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

const SAMPLE_SECONDS = 15; // ESP32: if (now - lastMsg > 15000)
const RECENT_SIZE    = 10; // ESP32: (sample_id - 1) % 10

// ── Helpers ───────────────────────────────────────────────────────────────
function rand(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

/** "YYYY-MM-DD HH:MM:SS" theo giờ Việt Nam, như strftime sau configTime(UTC+7) của ESP32 */
function vnTimestamp(date = new Date()) {
  return new Date(date.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

let sampleId = 1; // ESP32 đếm lại từ 1 mỗi lần khởi động

/** Số đo cùng thang với mô hình phần cứng: tấm pin nhỏ ~4.4 V, tải 5 V */
function generateSensorData() {
  // INA219 0x40 — nguồn phát
  const v_solar = rand(4.2, 4.6, 2);        // V
  const i_solar = rand(100, 220, 1);        // mA
  const p_solar = +(v_solar * i_solar / 1000).toFixed(2); // W
  // INA219 0x41 — tải tiêu thụ (quạt/LED qua relay 1)
  const v_load  = rand(4.95, 5.2, 2);       // V
  const i_load  = rand(0, 90, 1);           // mA
  const p_load  = +(v_load * i_load / 1000).toFixed(2);   // W

  return {
    metadata: { sample_id: sampleId, timestamp: vnTimestamp() },
    electrical: { v_solar, i_solar, p_solar, v_load, i_load, p_load },
    environment: {
      irradiance:   +((p_solar / 3.0) * 1000).toFixed(1), // ESP32 ước tính từ công suất phát, tấm 3 W
      temp_panel:   rand(42, 47, 1),                      // DS18B20
      temp_ambient: rand(34, 40, 1),                      // DHT11
    },
  };
}

/** Đẩy một bản ghi lên Firebase, giống TaskMQTT của ESP32 */
async function pushData() {
  const data = generateSensorData();
  const recentIndex = (sampleId - 1) % RECENT_SIZE;

  try {
    // 1. Lịch sử dữ liệu vĩnh viễn (POST)
    await push(ref(db, 'sensor_data_history'), data);
    // 2. Bộ đệm 10 mẫu gần nhất cho AI (PUT xoay vòng)
    await set(ref(db, `sensor_data_recent/record_${recentIndex}`), data);

    const surplus = +(data.electrical.p_solar - data.electrical.p_load).toFixed(2);
    const state = surplus > 0.05 ? 'SELL' : surplus < -0.05 ? 'BUY' : 'BAL';
    console.log(
      `[${data.metadata.timestamp}] ✅ #${sampleId} → record_${recentIndex}` +
      ` | Ps: ${data.electrical.p_solar}W | Pl: ${data.electrical.p_load}W | Pdu: ${surplus}W ${state}`
    );
    sampleId++;
  } catch (err) {
    console.error('❌ Firebase push error:', err.message);
  }
}

// ── Seed initial market orders ────────────────────────────────────────────
async function seedMarketOrders() {
  const bids = Array.from({ length: 6 }, (_, i) => ({
    type:      'bid',
    price_ETH: parseFloat((0.055 - i * 0.002).toFixed(4)),
    amount_kWh: rand(50, 300, 1),
    addr:      `0x${Math.random().toString(16).slice(2, 10)}`,
    timestamp: Math.floor(Date.now() / 1000) - i * 60,
    status:    'open',
  }));
  const asks = Array.from({ length: 6 }, (_, i) => ({
    type:      'ask',
    price_ETH: parseFloat((0.058 + i * 0.002).toFixed(4)),
    amount_kWh: rand(30, 250, 1),
    addr:      `0x${Math.random().toString(16).slice(2, 10)}`,
    timestamp: Math.floor(Date.now() / 1000) - i * 45,
    status:    'open',
  }));

  try {
    await set(ref(db, 'market/bids'), bids);
    await set(ref(db, 'market/asks'), asks);
    console.log('[SEED] ✅ Market orders seeded');
  } catch (err) {
    console.error('[SEED] ❌ Market seed error:', err.message);
  }
}

// ── Seed transactions ─────────────────────────────────────────────────────
async function seedTransactions() {
  const txs = [
    { hash: '0x3a4b9c1d2e5f8a0b', type: 'buy',  amount_kWh: 145, value_ETH: -0.0572, status: 'success', timestamp: Math.floor(Date.now()/1000) - 300,  block: 18420312 },
    { hash: '0x8f2e4a0b1c3d9e7f', type: 'sell', amount_kWh: 220, value_ETH: +0.0568, status: 'success', timestamp: Math.floor(Date.now()/1000) - 900,  block: 18420280 },
    { hash: '0x1c9d3b2a4e6f0d1e', type: 'buy',  amount_kWh: 80,  value_ETH: -0.0460, status: 'success', timestamp: Math.floor(Date.now()/1000) - 1800, block: 18420155 },
    { hash: '0xfe2d8c1a3b9e6c4f', type: 'sell', amount_kWh: 310, value_ETH: +0.1740, status: 'success', timestamp: Math.floor(Date.now()/1000) - 2700, block: 18420030 },
    { hash: '0x5b3e7f9a2c1d4b8e', type: 'buy',  amount_kWh: 60,  value_ETH: -0.0348, status: 'pending', timestamp: Math.floor(Date.now()/1000) - 3600, block: 18419992 },
  ];
  try {
    await set(ref(db, 'transactions'), txs);
    console.log('[SEED] ✅ Transactions seeded');
  } catch (err) {
    console.error('[SEED] ❌ Tx seed error:', err.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
console.log('🌞 SolarP2P ESP32 Simulator Starting...');
console.log(`📡 Firebase: ${DATABASE_URL}`);
console.log(`⏱  Interval: ${SAMPLE_SECONDS} seconds (giống blockchainV2.ino)`);
console.log('⚠️  Chỉ chạy khi ESP32 thật đang tắt: cả hai cùng ghi sensor_data_history / sensor_data_recent\n');

// Dữ liệu market/transactions giả chỉ tạo khi chạy `node simulate.mjs --seed`.
// Mặc định KHÔNG ghi đè: market/bids|asks là lệnh thật người dùng đặt trên web,
// transactions là giao dịch thật backend ghi sau khi smart contract khớp lệnh.
if (process.argv.includes('--seed')) {
  await seedMarketOrders();
  await seedTransactions();
  setInterval(seedMarketOrders, 20000);
}

// Push đầu tiên ngay lập tức, sau đó push mỗi 15 giây
await pushData();
setInterval(pushData, SAMPLE_SECONDS * 1000);
