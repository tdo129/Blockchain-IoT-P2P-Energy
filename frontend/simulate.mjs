/**
 * simulate.mjs — Mô phỏng dữ liệu IoT đẩy lên Firebase Realtime Database
 * Chạy: node simulate.mjs
 *
 * Tương đương logic Python:
 *   nguon_phat: điện áp/dòng điện/công suất nguồn mặt trời
 *   tai_tieu_thu: điện áp/dòng điện/công suất tải tiêu thụ
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, push } from 'firebase/database';

// ── Firebase Init ─────────────────────────────────────────────────────────
const firebaseConfig = {
  databaseURL: 'https://p2p-solar-energy-default-rtdb.firebaseio.com/',
  projectId: 'p2p-solar-energy',
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ── Helpers ───────────────────────────────────────────────────────────────
function rand(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

/** Mô phỏng giá trị cảm biến giống ESP32/Raspberry Pi */
function generateSensorData() {
  // Nguồn phát (Pin mặt trời)
  const dien_ap_nguon  = rand(18.5, 24.5, 2);   // V — điện áp hở mạch panel
  const dong_dien_nguon = rand(2.0, 8.5, 3);     // A — dòng phát thực tế
  const cong_suat_nguon = parseFloat((dien_ap_nguon * dong_dien_nguon).toFixed(2)); // W

  // Tải tiêu thụ
  const dien_ap_tai    = rand(11.5, 13.8, 2);    // V — điện áp DC tải
  const dong_dien_tai  = rand(1.0, 6.0, 3);      // A — dòng tiêu thụ
  const cong_suat_tai  = parseFloat((dien_ap_tai * dong_dien_tai).toFixed(2)); // W

  return {
    nguon_phat: {
      dien_ap_V:               dien_ap_nguon,
      dong_dien_A:             dong_dien_nguon,
      cong_suat_W:             cong_suat_nguon,
      dien_nang_san_xuat_kWh:  rand(10.0, 15.0, 2),
    },
    tai_tieu_thu: {
      dien_ap_V:               dien_ap_tai,
      dong_dien_A:             dong_dien_tai,
      cong_suat_W:             cong_suat_tai,
      dien_nang_tieu_thu_kWh:  rand(5.0, 10.0, 2),
    },
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/** Sinh dữ liệu 1 IoT node (ESP32/Raspberry Pi thực tế) */
function generateIotNodes() {
  const dien_ap  = rand(18.5, 24.5, 1);
  const dong_dien = rand(1.5, 8.0, 2);
  return {
    node_01: {
      id:        'Node-01',
      location:  'Solar Panel',
      online:    true,
      output_kW: parseFloat((dien_ap * dong_dien / 1000).toFixed(3)),
      voltage_V: dien_ap,
      current_A: dong_dien,
      temp_C:    rand(28, 55, 1),
      humidity:  rand(40, 85, 1),
      irradiance_Wm2: rand(400, 1000, 0),
      last_seen: Math.floor(Date.now() / 1000),
    },
  };
}

/** Đẩy một bản ghi lên Firebase */
async function pushData() {
  const data     = generateSensorData();
  const nodes    = generateIotNodes();
  const nowMs    = Date.now();

  try {
    // 1. Ghi latest (luôn ghi đè — web app đọc path này)
    await set(ref(db, 'tram_hien_tai'), data);

    // 2. Ghi vào history (append — để vẽ chart và train AI)
    const histRef = ref(db, 'lich_su_do');
    await push(histRef, data);

    // 3. Ghi IoT nodes
    await set(ref(db, 'iot_nodes'), nodes);

    const surplus = parseFloat(
      (data.nguon_phat.cong_suat_W - data.tai_tieu_thu.cong_suat_W).toFixed(2)
    );
    console.log(
      `[${new Date().toISOString()}] ✅ Pushed  |` +
      ` Nguồn: ${data.nguon_phat.cong_suat_W}W` +
      ` | Tải: ${data.tai_tieu_thu.cong_suat_W}W` +
      ` | Dư thừa: ${surplus}W`
    );
  } catch (err) {
    console.error('❌ Firebase push error:', err.message);
  }
}

// ── Seed initial market orders ────────────────────────────────────────────
async function seedMarketOrders() {
  const ordersRef = ref(db, 'orders');
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
console.log('🌞 SolarP2P IoT Simulator Starting...');
console.log('📡 Firebase: https://p2p-solar-energy-default-rtdb.firebaseio.com/');
console.log('⏱  Interval: 5 seconds\n');

// Push đầu tiên ngay lập tức + seed data
await seedMarketOrders();
await seedTransactions();
await pushData();

// Sau đó push mỗi 5 giây
setInterval(pushData, 5000);
// Refresh market orders mỗi 20 giây
setInterval(seedMarketOrders, 20000);
