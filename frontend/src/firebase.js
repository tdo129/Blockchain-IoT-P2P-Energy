// Firebase configuration cho dự án P2P Solar Energy Trading
// Database URL: https://p2p-solar-energy-default-rtdb.firebaseio.com/
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getDatabase, ref, set, onValue, push, get, serverTimestamp
} from 'firebase/database';

// Minimal config cho Realtime Database (public rules, không cần Auth)
// Firebase Console → Realtime Database → Rules:
//   { "rules": { ".read": true, ".write": true } }
const firebaseConfig = {
  apiKey:        'AIzaSyD-placeholder-not-needed-for-public-rtdb',
  authDomain:    'p2p-solar-energy.firebaseapp.com',
  databaseURL:   'https://p2p-solar-energy-default-rtdb.firebaseio.com/',
  projectId:     'p2p-solar-energy',
  storageBucket: 'p2p-solar-energy.appspot.com',
  appId:         '1:000000000000:web:placeholder000000',
};

// Guard: tránh duplicate-app lỗi khi Vite HMR reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getDatabase(app);

// ── Path refs ────────────────────────────────────────────────────────────────
export const refs = {
  sensorLatest:  () => ref(db, 'tram_hien_tai'),
  sensorHistory: () => ref(db, 'lich_su_do'),
  marketBids:    () => ref(db, 'market/bids'),
  marketAsks:    () => ref(db, 'market/asks'),
  orders:        () => ref(db, 'orders'),
  trades:        () => ref(db, 'trades'),
  nodes:         () => ref(db, 'iot_nodes'),
  transactions:  () => ref(db, 'transactions'),
};

// ── Re-export helpers ────────────────────────────────────────────────────────
export { ref, set, onValue, push, get, serverTimestamp };
