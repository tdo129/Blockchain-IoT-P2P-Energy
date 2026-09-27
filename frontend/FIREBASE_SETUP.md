# 🔧 Hướng dẫn cấu hình Firebase Realtime Database

## 1. Mở Firebase Console

Truy cập: https://console.firebase.google.com/project/p2p-solar-energy/database

---

## 2. Cấu hình Database Rules (BẮT BUỘC)

Vào tab **Rules** và đặt:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> ⚠️ Rules này dùng cho **môi trường demo/mô phỏng**.
> Khi deploy thực tế, cần thêm Authentication.

---

## 3. Lấy Firebase Config thực (nếu cần Auth sau này)

Vào: **Project Settings → General → Your apps → Web app**

Thay vào `src/firebase.js`:
```js
const firebaseConfig = {
  apiKey:        "AIzaSy...",       // ← Lấy từ console
  authDomain:    "p2p-solar-energy.firebaseapp.com",
  databaseURL:   "https://p2p-solar-energy-default-rtdb.firebaseio.com/",
  projectId:     "p2p-solar-energy",
  storageBucket: "p2p-solar-energy.appspot.com",
  messagingSenderId: "...",
  appId:         "1:...:web:..."
};
```

---

## 4. Cấu trúc dữ liệu trên Firebase

```
p2p-solar-energy-default-rtdb/
├── tram_hien_tai/               ← Đọc realtime (Overview page) (Ghi đè)
│   ├── nguon_phat/
│   │   ├── dien_ap_V
│   │   ├── dong_dien_A
│   │   ├── cong_suat_W
│   │   └── dien_nang_san_xuat_kWh
│   ├── tai_tieu_thu/
│   │   ├── dien_ap_V
│   │   ├── dong_dien_A
│   │   ├── cong_suat_W
│   │   └── dien_nang_tieu_thu_kWh
│   └── timestamp
│
├── lich_su_do/                  ← Append data để train AI (Ghi nối tiếp)
│   └── <push_id>/...
│
├── iot_nodes/                   ← 6 nodes (Overview IoT grid)
│   ├── node_01/ { id, location, online, output_kW, voltage_V, current_A, temp_C }
│   └── ...
│
├── market/                      ← Energy Market page
│   ├── bids/ [ { price_ETH, amount_kWh, addr, timestamp, status } ]
│   └── asks/ [ { price_ETH, amount_kWh, addr, timestamp, status } ]
│
└── transactions/                ← Transactions page
    └── [ { hash, type, amount_kWh, value_ETH, block, timestamp, status } ]
```

---

## 5. Chạy hệ thống

### Terminal 1 — Web App
```bash
cd frontend
npm run dev
# → http://localhost:5174
```

### Terminal 2 — IoT Simulator (đẩy data lên Firebase mỗi 5s)
```bash
cd frontend
npm run simulate
```

---

## 6. Luồng dữ liệu

```
simulate.mjs (Node.js)
    │
    ├─ tram_hien_tai    ──→ Overview: Stats + Chart realtime
    ├─ iot_nodes        ──→ Overview: IoT Node grid
    ├─ market/bids|asks ──→ EnergyMarket: Order book live
    └─ transactions     ──→ Transactions: Tx history table
```
