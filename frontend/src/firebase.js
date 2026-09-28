// Firebase configuration cho dự án P2P Solar Energy Trading
// Database URL: https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app/
// Cùng database mà ESP32 (blockchainV2.ino) ghi dữ liệu cảm biến và backend oracle ghi kết quả khớp lệnh.
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getDatabase, ref, set, onValue, push, get, serverTimestamp,
  query, orderByKey, limitToLast,
} from 'firebase/database';

// Minimal config cho Realtime Database (public rules, không cần Auth)
// Database ở region asia-southeast1 nên bắt buộc có databaseURL đầy đủ, không suy ra từ projectId được.
const firebaseConfig = {
  apiKey:        'AIzaSyD-placeholder-not-needed-for-public-rtdb',
  authDomain:    'blockchain-6d10b.firebaseapp.com',
  databaseURL:   'https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app/',
  projectId:     'blockchain-6d10b',
  appId:         '1:000000000000:web:placeholder000000',
};

// Guard: tránh duplicate-app lỗi khi Vite HMR reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getDatabase(app);

// ── Path refs ────────────────────────────────────────────────────────────────
export const refs = {
  // ESP32 POST mỗi 15 giây (push key tăng theo thời gian): lấy N bản ghi mới nhất
  sensorHistory: (limit) => query(ref(db, 'sensor_data_history'), orderByKey(), limitToLast(limit)),
  // ESP32 PUT xoay vòng record_0..record_9 cho mô hình AI
  sensorRecent:  () => ref(db, 'sensor_data_recent'),
  // Kết quả mô hình AI (đọc sensor_data_recent) ghi vào
  aiLatest:      () => ref(db, 'ai_analytics/latest'),
  marketBids:    () => ref(db, 'market/bids'),
  marketAsks:    () => ref(db, 'market/asks'),
  transactions:  () => ref(db, 'transactions'),
};

// ── Re-export helpers ────────────────────────────────────────────────────────
export { ref, set, onValue, push, get, serverTimestamp };
