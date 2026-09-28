# 🌞 SolarP2P — Hệ thống quản lý và giao dịch năng lượng mặt trời P2P

Đồ án cuối kỳ học phần **Cơ sở Blockchain và Ứng dụng**, *Đề tài 1: P2P Energy Trading*. Hệ thống CPS tích hợp
3 tầng: **IoT** (ESP32 đo điện năng thật của tấm pin và tải) → **AI** (LSTM INT8 dự báo công suất, phát hiện bất
thường) → **Blockchain** (smart contract trên Sepolia mở phiên đấu giá, khớp lệnh, thanh toán ETH và thưởng token SLR).

- **Web demo:** https://frontend-silk-two-98.vercel.app
- **Smart contract (Sepolia):** [P2PEnergyMarket `0x2319…A612`](https://sepolia.etherscan.io/address/0x23194c35B6de99b3b50A2ee07B817E3bE89cA612#code)

## 1. Cấu trúc repository

Theo mục 5.2 của *Hướng dẫn đồ án cuối kỳ*:

```
Blockchain-IoT-P2P-Energy/
├── README.md            # File này: tổng quan, cài đặt, cấu hình, các bước chạy demo
├── contracts/           # Smart contract Solidity (Hardhat) + backend oracle ethers.js  → contracts/README.md
├── ai_model/            # Notebook huấn luyện LSTM + trọng số Float32 / INT8            → ai_model/README.md
├── iot_code/            # Tầng IoT và giao diện người dùng                               → iot_code/README.md
│   ├── blockchainV2/    # Firmware ESP32 (Arduino)
│   ├── simulator/       # Bộ giả lập ESP32 cùng định dạng dữ liệu
│   └── frontend/        # Dashboard Web3 React (MetaMask, Etherscan), deploy Vercel    → iot_code/frontend/README.md
└── Report_NhomXX.pdf    # Báo cáo kỹ thuật chính thức (nhóm bổ sung, đổi XX thành số nhóm)
```

| Yêu cầu | Thư mục |
|---|---|
| `/contracts`: mã nguồn Smart Contracts | `contracts/contracts/*.sol`; kèm backend oracle ở `contracts/backend` vì dùng chung ABI, địa chỉ deploy và bộ test |
| `/ai_model`: mã nguồn huấn luyện và file trọng số | `ai_model/blockchain.ipynb`, `solar_lstm.pth`, `solar_lstm_int8.pth` |
| `/iot_code`: mã nguồn giả lập hoặc nạp phần cứng | `iot_code/blockchainV2/blockchainV2.ino` (nạp ESP32), `iot_code/simulator/simulate.mjs` (giả lập); kèm dashboard `iot_code/frontend` hiển thị dữ liệu IoT |

## 2. Kiến trúc CPS

```
┌──────────────── TẦNG IoT (iot_code) ────────────────┐
│ ESP32: 2×INA219 (Ps, Pl), DHT11, DS18B20, LCD, 2 relay│
└───────┬───────────────────────────────▲─────────────┘
        │ HTTPS mỗi 15 s                 │ MQTT p2p/smart_contract: TRADE_SUCCESS
        ▼                                │ (broker.hivemq.com)
┌──────────────── Firebase Realtime Database (blockchain-6d10b) ────────────────┐
│ sensor_data_history · sensor_data_recent · ai_analytics · market · transactions│
└──┬──────────────────┬───────────────────────────┬───────────────────▲─────────┘
   │ 10 mẫu gần nhất  │ dữ liệu đo + kết quả AI    │ lệnh web          │ kết quả khớp lệnh
   ▼                  ▼                            │                   │
┌─ TẦNG AI ──────┐  ┌─ Backend oracle (contracts/backend, ethers.js) ──┴───────────┐
│ LSTM INT8      │  │ tích phân công suất → Wh → dự báo → chốt chặn AI → dataHash │
│ (ai_model)     │─►│ đưa lệnh web lên chain · hết phiên gọi matchOrders          │
│ ai_analytics   │  └────────────────────────────┬─────────────────────────────────┘
└────────────────┘                               │ submitOffer/Bid, submitManual*, matchOrders
                                                 ▼
┌──────────────── TẦNG BLOCKCHAIN (contracts) — Sepolia ─────────────────┐
│ P2PEnergyMarket: ký quỹ ETH, phiên đấu giá, khớp lệnh, thanh toán       │
│ SolarToken (SLR): thưởng 1 SLR/kWh bán được · DeviceRegistry            │
└───────────────────────────────▲────────────────────────────────────────┘
                                │ deposit / withdraw, đọc phiên & số dư (MetaMask)
┌──────────────── Dashboard Web3 (frontend) ─────────────────────────────┐
│ Overview · Energy Market · My Wallet · Transactions (link Etherscan)    │
└────────────────────────────────────────────────────────────────────────┘
```

| Tầng | Công nghệ | Vai trò |
|---|---|---|
| IoT | ESP32, INA219, DHT11, DS18B20, FreeRTOS, HTTPS, MQTT | Đo điện áp/dòng/công suất phát và tiêu thụ, nhiệt độ; thực thi lệnh relay |
| AI | PyTorch LSTM, lượng tử hoá INT8 | Dự báo công suất từ thời tiết (R² 92,94%), phát hiện bất thường |
| Blockchain | Solidity 0.8.24, OpenZeppelin, Hardhat, Sepolia | Minh bạch dữ liệu (dataHash), tự động đấu giá, thanh toán, thưởng token |
| Kết nối | ethers.js v6, Firebase REST/SDK, MetaMask | Oracle backend và dashboard web |

## 3. Luồng dữ liệu end-to-end của một phiên đấu giá (5 phút)

1. **IoT:** ESP32 gửi một mẫu mỗi 15 giây vào `sensor_data_history` và `sensor_data_recent`.
2. **AI:** mô hình đọc 10 mẫu gần nhất, ghi `ai_analytics/latest` (công suất dự đoán, `anomaly_detected`, `status`).
3. **Mở phiên:** phiên mới tự mở ngay khi phiên trước được khớp (hoặc lúc deploy với phiên 1).
4. **Lệnh tự động của node:** đầu phiên, oracle kiểm tra ESP32 online, tích phân công suất 5 phút vừa qua ra Wh,
   dự báo phiên tới, qua chốt chặn AI, rồi gọi `submitOffer` (dư điện → bán) hoặc `submitBid` (thiếu → mua) kèm
   `dataHash` của đúng dữ liệu đã dùng và `modelHash` của mô hình đã được duyệt.
5. **Lệnh người dùng:** trên web, người mua nạp ETH ký quỹ bằng MetaMask và đặt lệnh (ghi vào `market`); oracle đưa
   lên contract bằng `submitManualBid` / `submitManualOffer` trong vòng 5 giây.
6. **Khớp lệnh:** hết giờ, oracle gọi `matchOrders`. Contract ghép lệnh bán với lệnh mua có giá trần ≥ giá sàn,
   giá chốt = trung bình hai giá, chuyển ETH ký quỹ từ người mua sang người bán, mint SLR cho người bán, mở phiên mới.
7. **Phản hồi:** oracle ghi kết quả vào `transactions` (hash giao dịch thật), đổi lệnh đã khớp sang `filled`, gửi
   `TRADE_SUCCESS` qua MQTT → ESP32 đóng relay lưới P2P 2 giây, LCD hiện `P2P!`. Web tự cập nhật; người bán rút ETH ở My Wallet.

## 4. Cơ sở dữ liệu Firebase

URL: `https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app` (dùng chung cho mọi tầng).

```
├── sensor_data_history/<push key>      ESP32 POST mỗi 15 s, lưu vĩnh viễn
│     metadata {sample_id, timestamp "YYYY-MM-DD HH:MM:SS" giờ VN | "N/A"}
│     electrical {v_solar V, i_solar mA, p_solar W, v_load V, i_load mA, p_load W}
│     environment {irradiance W/m², temp_panel °C, temp_ambient °C}
├── sensor_data_recent/record_0..9      ESP32 PUT xoay vòng 10 mẫu gần nhất (cùng JSON), đầu vào của AI
├── ai_analytics/latest, history/...    AI ghi: predicted_power_w, actual_power_w, anomaly_detected, status, ...
├── market/bids | asks/<push key>       Web ghi lệnh {type, price_ETH, amount_kWh, addr, status, timestamp};
│                  iot_node_01          oracle ghi lệnh tự động của node (source: "iot")
└── transactions/<push key>             Oracle ghi kết quả khớp {hash, type sell|buy, amount_kWh, value_ETH, block,
                                        timestamp, status, addr}; web ghi nạp/rút ETH
```

Rules phải cho phép đọc/ghi (demo đang để công khai: `{"rules": {".read": true, ".write": true}}`). Khi dùng thật cần
thêm Firebase Authentication.

## 5. Cài đặt và cấu hình môi trường

| Công cụ | Dùng cho |
|---|---|
| Node.js 20.19+ (khuyên dùng 22 hoặc 24) | `contracts` (Hardhat, oracle), `iot_code/frontend`, bộ giả lập IoT |
| Tiện ích MetaMask, mạng Sepolia, ít Sepolia ETH (faucet) | Đặt lệnh, nạp/rút ký quỹ |
| Arduino IDE 2.x + board ESP32 | Nạp firmware (chỉ khi dùng phần cứng thật) |
| Python 3.10+ / Kaggle | Huấn luyện lại mô hình AI (không bắt buộc để chạy demo) |

```bash
git clone https://github.com/tdo129/Blockchain-IoT-P2P-Energy
cd Blockchain-IoT-P2P-Energy
cd contracts; npm install; cd ..
cd iot_code/frontend; npm install; cd ../..
```

Tạo `contracts/.env` từ `contracts/.env.example`, điền `NETWORK=sepolia`, `RPC_URL` (Alchemy/Infura),
`ORACLE_PRIVATE_KEY`, `NODE_WALLET` (chi tiết tất cả biến: [contracts/README.md](contracts/README.md#4-cấu-hình-env)).
**Không commit file `.env`.** Frontend không cần cấu hình.

## 6. Các bước chạy demo

Contract đã được deploy sẵn trên Sepolia, không cần deploy lại.

1. **Kiểm thử smart contract và backend** (50 test):
   ```bash
   cd contracts; npm test
   ```
2. **Nguồn dữ liệu IoT:** bật ESP32 (xem [iot_code/README.md](iot_code/README.md)). Nếu không có phần cứng, chạy giả lập
   (chỉ khi ESP32 đang tắt):
   ```bash
   node iot_code/simulator/simulate.mjs
   ```
3. **Tầng AI:** bật dịch vụ suy luận ghi `ai_analytics` (xem [ai_model/README.md](ai_model/README.md)). Nếu AI không chạy,
   oracle tự bỏ qua chốt chặn AI và vẫn hoạt động.
4. **Backend oracle** (chạy suốt buổi demo, chỉ một máy chạy):
   ```bash
   cd contracts; npm run check:sepolia; npm run oracle
   ```
5. **Dashboard:** mở https://frontend-silk-two-98.vercel.app (hoặc chạy trên máy: `cd iot_code/frontend; npm run dev`).
   - *Overview*: số đo ESP32 thời gian thực, trạng thái Online, kết quả AI.
   - *Energy Market*: kết nối MetaMask (Sepolia), xem số phiên + đếm ngược, đặt lệnh mua nhỏ (ví dụ 0,02 kWh).
   - Theo dõi log oracle: `[WEB] Nhận lệnh ...` → hết phiên `[CHAIN] matchOrders ... cặp khớp` → `[MQTT] Gửi TRADE_SUCCESS`.
   - *Transactions*: giao dịch mới kèm link Etherscan; *My Wallet*: ký quỹ, số dư SLR, rút ETH.
6. **Kiểm chứng on-chain:** mở giao dịch trên Etherscan, xem event `ForecastRecorded` (dataHash, modelHash) và `Matched`.

Chạy toàn bộ trên chain local (không cần Sepolia ETH): xem [contracts/README.md](contracts/README.md#54-chạy-trên-chain-local-hardhat-với-dữ-liệu-esp32-thật).

## 7. Đối chiếu yêu cầu đồ án

| Yêu cầu | Đáp ứng |
|---|---|
| Luồng End-to-End IoT → AI → Smart Contract | ESP32 → Firebase → AI (chốt chặn) + oracle → `P2PEnergyMarket` → MQTT về ESP32 |
| Smart contract on-chain | Solidity, triển khai và verify trên Sepolia, 25 test contract |
| Kết nối Backend/Frontend bằng ethers.js | Oracle (`contracts/backend`) và dashboard (`iot_code/frontend`) đều dùng ethers.js v6 |
| Sáng tạo: Edge AI / INT8 | Lượng tử hoá INT8: nhanh ~3,9 lần, nhỏ ~3,4 lần, giữ nguyên R² 92,94% |
| Sáng tạo: phần cứng IoT thật | ESP32 với cảm biến và relay thật, nhận lệnh từ smart contract |
| Sáng tạo: giao diện Web3 | Dashboard thời gian thực, MetaMask, truy vết giao dịch qua Etherscan |

## 8. Liên kết
- Sepolia Etherscan: [P2PEnergyMarket](https://sepolia.etherscan.io/address/0x23194c35B6de99b3b50A2ee07B817E3bE89cA612#code) ·
  [SolarToken (SLR)](https://sepolia.etherscan.io/address/0x3bd3A251021d781Fa6B37d5B97B6A91fd779FDa6#code) ·
  [DeviceRegistry](https://sepolia.etherscan.io/address/0xd91b0144388FAd8f341C4F1376Ad6ad15741b1DE#code)
- Dataset huấn luyện AI: Kaggle *Solar Power Generation Data* (anikannal)

---
*Đồ án môn học Cơ sở Blockchain và Ứng dụng — GVHD: Huỳnh Thế Thiện*
