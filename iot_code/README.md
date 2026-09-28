# iot_code — Tầng IoT (thu thập & thực thi) và giao diện người dùng

Mã nguồn nạp phần cứng ESP32, bộ giả lập cùng định dạng dữ liệu, và dashboard web hiển thị dữ liệu IoT
(chi tiết dashboard: [frontend/README.md](frontend/README.md)). Đây là điểm đầu của luồng
**IoT → AI → Smart Contract**: đo điện năng thực tế của tấm pin mặt trời và tải, đẩy lên Firebase, và nhận lệnh
từ smart contract (qua backend oracle) để điều khiển relay.

```
iot_code/
├── blockchainV2/
│   └── blockchainV2.ino   # Firmware ESP32 (thư mục trùng tên file .ino theo yêu cầu của Arduino IDE)
├── simulator/
│   └── simulate.mjs       # Giả lập ESP32 khi không có phần cứng (cùng JSON, cùng chu kỳ 15 giây)
└── frontend/              # Dashboard Web3 React: số đo ESP32, AI, đặt lệnh, MetaMask, Etherscan (deploy Vercel)
```

## 1. Kiến trúc phần cứng

```
                ┌───────────────────── ESP32 ─────────────────────┐
Tấm pin ──► INA219 0x40 (nguồn phát Ps) ─┐                          │
Tải     ──► INA219 0x41 (tải tiêu thụ Pl)┼─ I2C ──┐                 │
DHT11  (GPIO 14): nhiệt độ/độ ẩm môi trường       │  TaskSensor 500 ms ──► biến toàn cục (mutex)
DS18B20 (GPIO 27): nhiệt độ tấm pin               │                 │        │
LCD 16x2 I2C 0x27 ◄──────────────────────────────┘  TaskDisplay 500 ms ◄─┤  (Ps, Pl, Pdu, SELL/BUY/BAL)
Relay 1 (GPIO 4, kích LOW): tải nội bộ ◄─┐                          │        │
Relay 2 (GPIO 25, kích LOW): lưới P2P  ◄─┴── lệnh MQTT ── TaskMQTT 15 s ◄──┘  ──► Firebase (HTTPS) + MQTT
                └───────────────────────────────────────────────────┘
```

| Linh kiện | Chân / địa chỉ | Vai trò |
|---|---|---|
| INA219 #1 | I2C `0x40` | Điện áp `v_solar` (V), dòng `i_solar` (mA), công suất `p_solar` (W) của tấm pin |
| INA219 #2 | I2C `0x41` | Điện áp `v_load`, dòng `i_load`, công suất `p_load` của tải |
| DHT11 | GPIO 14 | Nhiệt độ môi trường `temp_ambient` |
| DS18B20 | GPIO 27 (OneWire) | Nhiệt độ tấm pin `temp_panel` |
| LCD 16x2 | I2C `0x27` | Dòng 1: `Ps` `Pl`; dòng 2: `Pdu` và trạng thái `SELL` / `BUY` / `BAL`, `P2P!` khi khớp lệnh |
| Relay 1 | GPIO 4 (LOW = đóng) | Tải nội bộ (quạt/LED), lệnh `CUT_POWER` / `RESTORE_POWER` |
| Relay 2 | GPIO 25 (LOW = đóng) | Nối lưới P2P (bán điện), đóng 2 giây khi nhận `TRADE_SUCCESS` |

Firmware chạy 3 task FreeRTOS, dùng chung dữ liệu qua `dataMutex`:
- **TaskSensor** (core 1, 500 ms): đọc 2 INA219, DHT11, DS18B20; tính `Pdu = Ps − Pl`.
- **TaskDisplay** (core 1, 500 ms): cập nhật LCD, đóng relay 2 trong 2 giây khi có `TRADE_SUCCESS`.
  Ngưỡng hiển thị: `Pdu > 0.05 W` là SELL, `Pdu < −0.05 W` là BUY, còn lại BAL.
- **TaskMQTT** (core 0): giữ kết nối MQTT, mỗi 15 giây đóng gói JSON và gửi đi.

## 2. Luồng dữ liệu

**Đi lên (thiết bị → hệ thống)**, mỗi 15 giây:

| Kênh | Đích | Cách ghi |
|---|---|---|
| HTTPS | `sensor_data_history.json` | `POST`: lưu vĩnh viễn, Firebase sinh push key tăng theo thời gian |
| HTTPS | `sensor_data_recent/record_N.json` | `PUT`: bộ đệm xoay vòng 10 mẫu, `N = (sample_id − 1) % 10`, cho mô hình AI |
| MQTT | topic `p2p/sensor_data` | Cùng JSON, để theo dõi realtime |

Firebase: `https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app`

```json
{
  "metadata":    { "sample_id": 13, "timestamp": "2026-09-28 15:19:31" },
  "electrical":  { "v_solar": 4.09, "i_solar": 10.7, "p_solar": 0.04, "v_load": 5.08, "i_load": -0.2, "p_load": 0.0 },
  "environment": { "irradiance": 14.0, "temp_panel": 37.4, "temp_ambient": 34.6 }
}
```

- `timestamp` là giờ Việt Nam (NTP `pool.ntp.org`, UTC+7); là `"N/A"` khi chưa đồng bộ NTP.
- `sample_id` **đếm lại từ 1 mỗi lần ESP32 khởi động**, nên `sensor_data_recent` có thể lẫn mẫu cũ.
  Backend và frontend lấy mẫu mới nhất từ `sensor_data_history` và sắp theo thời điểm đo, không theo `sample_id`.
- `irradiance` không đo trực tiếp mà ước tính: `p_solar / 3 W × 1000 W/m²` (tấm pin 3 W ở 1000 W/m²).

**Đi xuống (smart contract → thiết bị)**: ESP32 subscribe MQTT topic `p2p/smart_contract` trên `broker.hivemq.com:1883`.

| Lệnh | Ai gửi | ESP32 làm gì |
|---|---|---|
| `TRADE_SUCCESS` | Backend oracle, khi hết phiên mà ví node có cặp lệnh khớp trên `P2PEnergyMarket` | Đóng relay 2 (lưới P2P) 2 giây, LCD hiện `P2P!` |
| `CUT_POWER` | (chưa dùng) | Ngắt relay 1 |
| `RESTORE_POWER` | (chưa dùng) | Đóng lại relay 1 |

Xem phía gửi ở [`contracts/backend/mqtt.js`](../contracts/backend/mqtt.js).

## 3. Cách chạy

### 3.1. Nạp firmware lên ESP32
1. Cài Arduino IDE 2.x, thêm board ESP32: *File → Preferences → Additional boards manager URLs*:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`, rồi cài gói **esp32** trong *Boards Manager*.
2. Cài thư viện trong *Library Manager*:

   | Thư viện | Dùng cho |
   |---|---|
   | WiFiManager (tzapu) | Cấu hình WiFi qua điểm phát `ESP_P2P` |
   | Adafruit INA219 | 2 cảm biến dòng/áp |
   | LiquidCrystal I2C | LCD 16x2 |
   | PubSubClient | MQTT |
   | DHT sensor library (Adafruit) | DHT11 |
   | OneWire, DallasTemperature | DS18B20 |

3. Mở `iot_code/blockchainV2/blockchainV2.ino`, chọn board **ESP32 Dev Module** và cổng COM, bấm **Upload**.
4. Lần đầu chạy, LCD hiện `Bat WiFi tren DT`: dùng điện thoại kết nối WiFi **`ESP_P2P`**, chọn mạng WiFi nhà và
   nhập mật khẩu. ESP32 tự nhớ cho các lần sau.
5. Mở *Serial Monitor* (115200 baud): mỗi 15 giây in JSON và `-> Firebase OK | History: 200 | Recent(Vi tri N): 200`.

### 3.2. Chạy giả lập (khi không có phần cứng)
Chỉ chạy khi **ESP32 thật đang tắt**, vì cả hai ghi vào cùng `sensor_data_history` / `sensor_data_recent`.
Cần Node.js 18+, không cần `npm install`.

```bash
node iot_code/simulator/simulate.mjs            # gửi mỗi 15 giây, Ctrl+C để dừng
node iot_code/simulator/simulate.mjs --once     # gửi 1 mẫu rồi thoát (kiểm tra kết nối)
node iot_code/simulator/simulate.mjs --seed     # thêm sổ lệnh + giao dịch giả (GHI ĐÈ market, transactions)
```

Số liệu giả lập cùng thang với mô hình thật: tấm pin khoảng 4,2–4,6 V / 100–220 mA, tải 5 V / 0–90 mA.
Lệnh giả của `--seed` có địa chỉ ví không hợp lệ nên backend oracle bỏ qua, không đưa lên chain.

### 3.3. Kiểm tra dữ liệu đã lên Firebase
```bash
curl "https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app/sensor_data_history.json?orderBy=%22\$key%22&limitToLast=1"
```
Hoặc mở trang **Overview** của frontend: khung *IoT Node* hiện `Online` và số đo mới nhất.
