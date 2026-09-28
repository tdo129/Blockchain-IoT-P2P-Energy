# contracts — Tầng Blockchain (xác thực & điều phối)

Dự án Hardhat gồm **3 smart contract Solidity** triển khai trên Sepolia và **backend oracle** (Node.js + ethers.js)
nối Firebase / AI / IoT với blockchain: đưa lệnh lên contract, đóng phiên đấu giá, ghi kết quả khớp lệnh về
Firebase và báo cho ESP32 qua MQTT.

```
contracts/
├── contracts/                 # Mã nguồn Solidity
│   ├── P2PEnergyMarket.sol    # Ký quỹ ETH, phiên đấu giá, nhận lệnh, khớp lệnh, thanh toán, thưởng
│   ├── SolarToken.sol         # Token thưởng SLR (ERC-20, 3 decimals), chỉ Market mint được
│   └── DeviceRegistry.sol     # Ánh xạ ví hộ gia đình ↔ mã thiết bị IoT
├── backend/                   # Backend oracle (npm run oracle)
│   ├── oracle.js              # Vòng lặp chính: 5 giây kiểm tra một lần
│   ├── config.js              # Đọc .env, giá trị mặc định
│   ├── firebase.js            # Đọc/ghi Firebase qua REST API
│   ├── sensor.js              # Chuẩn hoá bản ghi ESP32 (thời điểm đo từ metadata.timestamp / push key)
│   ├── energy.js              # Tích phân công suất → Wh, dataHash (keccak256)
│   ├── forecast.js            # Dự báo phiên tới (mô hình cơ sở naive-persistence-v1)
│   ├── aiGate.js              # Chốt chặn AI từ ai_analytics/latest
│   ├── orders.js              # Đọc & kiểm tra lệnh web market/bids|asks
│   ├── sync.js                # Tạo bản ghi transactions cho frontend
│   └── mqtt.js                # Gửi TRADE_SUCCESS xuống ESP32
├── scripts/                   # deploy.js, verify.js, check-env.js, demo.js, local-buyer.js
├── test/                      # market.test.js (25 test contract), backend.test.js (25 test backend)
├── deployments/sepolia.json   # Địa chỉ + ABI + tham số bản deploy Sepolia (backend đọc)
├── hardhat.config.js
└── .env.example               # Mẫu cấu hình (sao chép thành .env, KHÔNG commit .env)
```

## 1. Kiến trúc smart contract

### 1.1. `P2PEnergyMarket` — sàn đấu giá theo phiên (Market-based Bidding)

| Thành phần | Mô tả |
|---|---|
| Quyền | `owner` (ví deploy): duyệt mô hình AI `setModelApproved`, đổi oracle `setOracle`. `oracle` (ví backend): gửi lệnh, gọi `matchOrders`. Người dùng: `deposit` / `withdraw` |
| Ký quỹ | `balances[address]` (wei). Người mua nạp trước; khi khớp, tiền chuyển từ người mua sang người bán **ngay trong contract**; người bán tự `withdraw` (có `nonReentrant`) |
| Lệnh tự động (IoT/AI) | `submitOffer` / `submitBid(ví, phátWh, tiêuThụWh, giá, dataHash, modelHash)`. Contract **tự tính lượng** = chênh lệch phát − tiêu thụ, bắt buộc `modelHash` đã duyệt và `dataHash ≠ 0`, phát event `ForecastRecorded` làm bằng chứng dữ liệu |
| Lệnh thủ công (web) | `submitManualOffer` / `submitManualBid(ví, Wh, giá)`: oracle chuyển tiếp lệnh người dùng đặt trên web |
| Phiên | `currentSession`, `sessionDeadline`, `sessionDuration` (300 giây trên Sepolia). Lệnh chỉ nhận khi phiên còn mở |
| Khớp lệnh | `matchOrders()` sau hạn chót: duyệt lệnh bán theo thứ tự gửi, ghép với lệnh mua đầu tiên có giá trần ≥ giá sàn; **giá chốt = (sàn + trần) / 2**; khớp một phần được; người mua thiếu ký quỹ bị loại (`BidRejected`) thay vì làm kẹt phiên; cuối hàm **tự mở phiên mới** |
| Thưởng | Mỗi cặp khớp mint `energyWh × 1` đơn vị SLR (= 1 SLR / kWh) cho người bán |
| Event | `Deposited`, `Withdrawn`, `SessionOpened`, `ForecastRecorded`, `OfferSubmitted`, `BidSubmitted`, `Matched`, `BidRejected`, `ModelApprovalChanged` |

**Đơn vị:** điện năng là Wh (số nguyên, = `amount_kWh × 1000`), giá là wei/kWh, tiền phải trả =
`energyWh × giá / 1000` (wei).

### 1.2. `SolarToken` (SLR)
ERC-20 (OpenZeppelin), **3 decimals** nên 1 Wh = 0,001 SLR. Deploy với nguồn cung 0, rồi chuyển owner sang
Market: chỉ Market gọi được `mintReward`, không ai khác tạo ra SLR được.

### 1.3. `DeviceRegistry`
Owner gọi `registerDevice(ví, deviceId)` để ghi ví nào sở hữu thiết bị IoT nào. Hiện chưa nối với Market
(hướng phát triển: chỉ ví đã đăng ký thiết bị mới được bán).

### 1.4. Bản deploy hiện tại (Sepolia, chainId 11155111)
| Contract | Địa chỉ (đã verify trên Etherscan) |
|---|---|
| P2PEnergyMarket | [`0x23194c35B6de99b3b50A2ee07B817E3bE89cA612`](https://sepolia.etherscan.io/address/0x23194c35B6de99b3b50A2ee07B817E3bE89cA612#code) |
| SolarToken (SLR) | [`0x3bd3A251021d781Fa6B37d5B97B6A91fd779FDa6`](https://sepolia.etherscan.io/address/0x3bd3A251021d781Fa6B37d5B97B6A91fd779FDa6#code) |
| DeviceRegistry | [`0xd91b0144388FAd8f341C4F1376Ad6ad15741b1DE`](https://sepolia.etherscan.io/address/0xd91b0144388FAd8f341C4F1376Ad6ad15741b1DE#code) |

## 2. Kiến trúc backend oracle

Contract không tự đọc được dữ liệu ngoài chain, nên oracle là cầu nối duy nhất. Vòng lặp trong `oracle.js`
chạy mỗi `POLL_SECONDS` (5 giây):

```
┌─ Phiên còn mở? ─── có ──► (1) Đầu phiên, một lần: lệnh tự động của node
│                           (2) Mỗi vòng: đồng bộ lệnh web
└──────────────── hết hạn ► (3) matchOrders → ghi kết quả → báo ESP32 → phiên mới
```

**(1) Lệnh tự động của node ESP32**
1. Đọc `sensor_data_history` (Firebase). Bản ghi mới nhất cũ hơn `NODE_STALE_SECONDS` (60 giây) thì node
   offline, bỏ qua phiên này.
2. Tích phân hình thang `electrical.p_solar` / `p_load` trong `sessionDuration` giây vừa qua, bỏ qua khoảng mất
   dữ liệu dài hơn `MAX_GAP_SECONDS` (45 giây), nhân `POWER_SCALE` (1000) để quy đổi mô hình ~1 W ra hộ gia đình, ra Wh.
3. `forecast.js` dự báo phiên tới (hiện: bằng đúng số vừa đo).
4. `aiGate.js` đọc `ai_analytics/latest`: AI báo `anomaly_detected` / `FAULT_DETECTED` thì **không tự bán**
   (vẫn cho mua); kết quả AI cũ hơn dữ liệu ESP32 quá `AI_MAX_LAG_SECONDS` hoặc không có thì bỏ qua AI.
5. `dataHash = keccak256(các bản ghi ESP32 đã dùng [+ bản ghi AI])`, gửi `submitOffer` (dư: bán, giá sàn
   `NODE_ASK_PRICE_ETH`) hoặc `submitBid` (thiếu: mua, giá trần `NODE_BID_PRICE_ETH`).
6. Ghi lệnh đó vào `market/asks|bids/iot_node_01` (`source: "iot"`) để hiện trên sổ lệnh web.

**(2) Lệnh web:** đọc `market/bids|asks` có `status: "open"`, đổi `amount_kWh` → Wh, `price_ETH` → wei, gọi
`submitManualOffer` / `submitManualBid`. Lệnh mua chỉ gửi khi ký quỹ đủ. Lệnh chưa khớp hết được gửi lại phần còn
lại ở các phiên sau. Trạng thái lưu trong `backend/state.json` để khởi động lại không gửi trùng.

**(3) Hết phiên:** gọi `matchOrders`, đọc event `Matched` / `BidRejected`, rồi:
- ghi 2 bản ghi vào `transactions` cho mỗi cặp khớp (người bán `sell` +ETH, người mua `buy` −ETH, hash giao dịch thật);
- đổi lệnh web đã khớp hết sang `status: "filled"`, gỡ lệnh node khỏi sổ lệnh;
- nếu ví node (`NODE_WALLET`) có trong một cặp khớp: gửi `TRADE_SUCCESS` tới MQTT `p2p/smart_contract`
  (ESP32 đóng relay lưới P2P 2 giây).

Oracle chỉ ghi Firebase khi `NETWORK=sepolia` (hoặc `FIREBASE_WRITE=true`), vì frontend tạo link Etherscan từ hash.

## 3. Luồng dữ liệu

```
ESP32 (iot_code) ──POST 15s──► Firebase sensor_data_history ──┐
ESP32 ──PUT──► sensor_data_recent ──► AI (ai_model) ──► ai_analytics/latest ──┤
Web (frontend) ──push lệnh──► market/bids|asks ───────────────┤
                                                              ▼
                                                   backend/oracle.js (ethers.js)
                                                              │ submitOffer/Bid, submitManual*, matchOrders
                                                              ▼
                                   P2PEnergyMarket (Sepolia) ── mintReward ──► SolarToken (SLR)
                                                              │ event Matched
                        ┌─────────────────────────────────────┼──────────────────────────┐
                        ▼                                     ▼                          ▼
     Firebase transactions, status "filled"      MQTT TRADE_SUCCESS → ESP32        Etherscan (tx hash)
                        │
                        ▼
      frontend: Transactions, My Wallet, Overview; MetaMask gọi deposit / withdraw trực tiếp
```

Frontend đọc địa chỉ + ABI từ bản copy `iot_code/frontend/src/deployments/sepolia.json` (Vercel chỉ build thư mục
`iot_code/frontend`). `npm run deploy:sepolia` ghi cả hai bản; nhớ commit cả hai file.

## 4. Cấu hình (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `NETWORK`, `RPC_URL` | `localhost`, `http://127.0.0.1:8545` | Mạng và RPC (Sepolia: URL Alchemy/Infura) |
| `DEPLOYER_PRIVATE_KEY` | | Ví deploy, cũng là owner contract |
| `ORACLE_PRIVATE_KEY` | | Ví oracle, trả gas cho mọi lệnh và `matchOrders` |
| `NODE_WALLET` | | Ví hộ sở hữu ESP32, nhận tiền bán điện và SLR |
| `ETHERSCAN_API_KEY` | | Verify contract |
| `FIREBASE_URL` | `https://blockchain-6d10b-...firebasedatabase.app` | Database dùng chung với ESP32, AI, frontend |
| `SESSION_DURATION` | `600` | Độ dài phiên khi deploy (bản Sepolia hiện tại: 300) |
| `NODE_ASK_PRICE_ETH` / `NODE_BID_PRICE_ETH` | `0.05` / `0.07` | Giá sàn khi node bán / giá trần khi node mua (ETH/kWh) |
| `POWER_SCALE` | `1000` | Hệ số quy đổi công suất mô hình ra hộ gia đình |
| `AI_GATE`, `AI_MAX_LAG_SECONDS` | `true`, `120` | Bật chốt chặn AI, độ lệch tối đa giữa mẫu AI và mẫu ESP32 |
| `MQTT_URL`, `MQTT_TOPIC` | `mqtt://broker.hivemq.com:1883`, `p2p/smart_contract` | Kênh lệnh xuống ESP32; `MQTT_URL=` rỗng để tắt |
| `POLL_SECONDS`, `MAX_GAP_SECONDS`, `NODE_STALE_SECONDS` | `5`, `45`, `60` | Nhịp vòng lặp, ngưỡng mất dữ liệu, ngưỡng offline |

## 5. Cách chạy

Cần Node.js 20+. Mọi lệnh chạy trong thư mục `contracts`.

### 5.1. Cài đặt và kiểm thử
```bash
npm install
npm test          # 50 test: 25 cho contract (Hardhat network), 25 cho xử lý dữ liệu backend
npm run demo      # demo nhanh toàn luồng với dữ liệu cố định, không cần Firebase/ví
```

### 5.2. Chạy oracle với contract trên Sepolia (dùng khi demo)
```bash
Copy-Item .env.example .env        # lần đầu, rồi điền NETWORK=sepolia, RPC_URL, ORACLE_PRIVATE_KEY, NODE_WALLET
npm run check:sepolia              # kiểm tra RPC, ví, số dư (không in private key)
npm run oracle                     # chạy suốt buổi demo, Ctrl+C để dừng
```
Log khởi động đúng có `Firebase: https://blockchain-6d10b-...` `(đọc + ghi kết quả)`, `Mạng: sepolia`,
`Chốt chặn AI: ...` và `[MQTT] Đã kết nối ...`. **Chỉ chạy một oracle tại một thời điểm.**

### 5.3. Deploy lại lên Sepolia (chỉ khi sửa contract)
Cần thêm `DEPLOYER_PRIVATE_KEY`, `ETHERSCAN_API_KEY`; ví deploy và ví oracle cần Sepolia ETH.
```bash
npm run deploy:sepolia     # ghi deployments/sepolia.json + ../iot_code/frontend/src/deployments/sepolia.json
npm run verify:sepolia     # công khai mã nguồn trên Etherscan
```
Deploy lại tạo contract mới: số phiên đếm lại từ 1, ký quỹ và SLR cũ nằm lại ở contract cũ, phải import lại SLR
trong MetaMask. Commit cả hai file `sepolia.json` để frontend (Vercel) dùng contract mới.

### 5.4. Chạy trên chain local (Hardhat) với dữ liệu ESP32 thật
Oracle local chỉ đọc Firebase, không ghi. Sao lưu `backend/state.json` trước vì oracle local ghi đè file này.

```bash
Copy-Item backend/state.json backend/state.sepolia.bak
```
```bash
npx hardhat node                                                     # terminal 1
```
```bash
$env:NETWORK="localhost"; $env:RPC_URL="http://127.0.0.1:8545"; $env:SESSION_DURATION="120"; npm run deploy:local
```
Cùng terminal 2 (tài khoản #1 và #2 mặc định của Hardhat, key công khai chỉ dùng cho local):
```bash
$env:ORACLE_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; $env:NODE_WALLET="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; npm run oracle
```
Terminal 3, trong lúc phiên đang mở, giả lập một người mua nạp ký quỹ và đặt lệnh:
```bash
$env:NETWORK="localhost"; npx hardhat run scripts/local-buyer.js --network localhost
```
Xong thì khôi phục trạng thái Sepolia:
```bash
Copy-Item backend/state.sepolia.bak backend/state.json -Force
```
