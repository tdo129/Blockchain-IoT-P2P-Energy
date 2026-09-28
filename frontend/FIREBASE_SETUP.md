# 🔧 Hướng dẫn cấu hình Firebase Realtime Database

## 1. Mở Firebase Console

Truy cập: https://console.firebase.google.com/project/blockchain-6d10b/database

Database URL (region asia-southeast1, dùng chung cho ESP32, frontend và backend oracle):
`https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app/`

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
  authDomain:    "blockchain-6d10b.firebaseapp.com",
  databaseURL:   "https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId:     "blockchain-6d10b",
  messagingSenderId: "...",
  appId:         "1:...:web:..."
};
```

---

## 4. Cấu trúc dữ liệu trên Firebase

```
blockchain-6d10b-default-rtdb/
├── sensor_data_history/          ← ESP32 POST mỗi 15 giây (lịch sử vĩnh viễn, push key)
│   └── <push_id>/
│       ├── metadata/    { sample_id, timestamp: "YYYY-MM-DD HH:MM:SS" (giờ VN) | "N/A" }
│       ├── electrical/  { v_solar V, i_solar mA, p_solar W, v_load V, i_load mA, p_load W }
│       └── environment/ { irradiance W/m² (ước tính), temp_panel °C, temp_ambient °C }
│
├── sensor_data_recent/           ← ESP32 PUT xoay vòng 10 mẫu gần nhất cho AI
│   └── record_0 … record_9       (record_N = (sample_id - 1) % 10, cùng JSON như trên)
│
├── ai_analytics/                 ← Mô hình AI ghi (đọc sensor_data_recent)
│   ├── latest/  { predicted_power_w, actual_power_w, power_difference_w, status, anomaly_detected, ... }
│   └── history/<push_id>/...
│
├── market/                       ← Energy Market page (frontend ghi, backend đọc)
│   ├── bids/ { <push_id>: { type, price_ETH, amount_kWh, addr, timestamp, status } }
│   └── asks/ { <push_id>: {...}, iot_node_01: { ..., source: "iot" } ← backend ghi lệnh tự động của node }
│
└── transactions/                 ← Transactions page (backend ghi sau matchOrders, frontend ghi nạp/rút)
    └── <push_id>/ { hash, type, amount_kWh, value_ETH, block, timestamp, status, addr }
```

Lưu ý:
- `sample_id` đếm lại từ 1 mỗi khi ESP32 khởi động lại, nên `sensor_data_recent` có thể lẫn mẫu cũ.
  Frontend và backend lấy dữ liệu mới nhất từ `sensor_data_history` (sắp theo push key), thời điểm đo lấy từ
  `metadata.timestamp`; nếu là `"N/A"` (chưa đồng bộ NTP) thì lấy thời điểm Firebase nhận từ push key.
- Rules phải cho phép ghi `market` và `transactions` (frontend đặt lệnh, backend ghi kết quả khớp lệnh).

---

## 5. Chạy hệ thống

### Terminal 1 — Web App
```bash
cd frontend
npm run dev
# → http://localhost:5174
```

### Terminal 2 — Nguồn dữ liệu cảm biến
- Dùng ESP32 thật: nạp `blockchainV2.ino`, kết nối WiFi qua điểm phát `ESP_P2P`.
- Không có ESP32: chạy mô phỏng cùng định dạng (chỉ khi ESP32 thật đang tắt, vì ghi vào cùng nhánh):
```bash
cd frontend
npm run simulate
```

---

## 6. Luồng dữ liệu

```
ESP32 blockchainV2.ino (hoặc simulate.mjs), mỗi 15 giây
    ├─ POST sensor_data_history ──→ Overview: Stats + Chart + IoT Node + Môi trường
    │                          └──→ backend oracle: tích phân công suất → lệnh tự động lên smart contract
    └─ PUT  sensor_data_recent  ──→ mô hình AI ──→ ai_analytics/latest ──→ Overview: AI Analytics

frontend ── market/bids|asks ──→ backend oracle ──→ P2PEnergyMarket (Sepolia)
backend oracle ── transactions ──→ Transactions, My Wallet, Overview (Tx hôm nay)
```
