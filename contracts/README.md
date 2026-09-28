# contracts — Tầng Blockchain của SolarP2P

Smart contract (Solidity, Hardhat) và backend oracle nối Firebase với blockchain.
Folder này không sửa gì trong `frontend/`; nó đọc và ghi đúng các nhánh Firebase mà frontend đang dùng.

```
ESP32 / simulate.mjs ──► Firebase ◄──────────────── frontend (React)
                           │  ▲                         │ đọc: sensor_data_history, ai_analytics,
                           │  │                         │      market, transactions
               đọc sensor, │  │ ghi transactions,       │ ghi: market/bids|asks (khi đặt lệnh)
               market      ▼  │ status "filled"
                     backend/oracle.js
                           │  submitOffer / submitBid          (lệnh tự động từ dữ liệu node IoT)
                           │  submitManualOffer / submitManualBid (lệnh người dùng đặt trên web)
                           │  matchOrders                      (hết phiên)
                           ▼
          P2PEnergyMarket (Sepolia) ── mintReward ──► SolarToken (SLR)

backend/oracle.js ── MQTT p2p/smart_contract: TRADE_SUCCESS ──► ESP32 (relay lưới P2P đóng 2 giây)
```

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `contracts/P2PEnergyMarket.sol` | Ký quỹ ETH, nhận lệnh, phiên đấu giá, khớp lệnh |
| `contracts/SolarToken.sol` | Token thưởng **SLR** (ERC-20, 3 decimals), trùng tên trang My Wallet |
| `contracts/DeviceRegistry.sol` | Ánh xạ ví với thiết bị IoT |
| `backend/oracle.js` | Vòng lặp oracle (`npm run oracle`) |
| `backend/firebase.js` | Đọc/ghi Firebase qua REST API |
| `backend/sensor.js` | Đọc bản ghi ESP32 (`blockchainV2.ino`): thời điểm đo từ `metadata.timestamp` hoặc push key |
| `backend/mqtt.js` | Gửi `TRADE_SUCCESS` cho ESP32 qua MQTT khi node có giao dịch khớp |
| `backend/energy.js` | Tích phân công suất ra Wh, hash dữ liệu cảm biến |
| `backend/orders.js` | Đọc lệnh `market/bids`, `market/asks` |
| `backend/sync.js` | Tạo bản ghi `transactions` theo schema `Transactions.jsx` |
| `backend/forecast.js` | Chỗ nối mô hình AI (hiện là mô hình cơ sở naive persistence) |
| `scripts/deploy.js` | Deploy, ghi `deployments/<mạng>.json` (địa chỉ + ABI + tham số) |
| `scripts/verify.js` | Verify source code trên Etherscan |
| `scripts/demo.js` | Demo nhanh với dữ liệu cố định |
| `scripts/local-buyer.js` | Chỉ cho demo local: giả lập người mua |
| `test/` | Test contract và test xử lý dữ liệu backend |

## Đồng bộ với frontend và Firebase

| Frontend / Firebase | Tầng blockchain |
|---|---|
| Mạng Sepolia, chainId 11155111 (`Web3Context.jsx`) | Mạng `sepolia` trong `hardhat.config.js` |
| Giá `price_ETH` (ETH/kWh), lượng `amount_kWh` | Contract dùng wei/kWh và Wh; backend tự đổi đơn vị |
| Đặt lệnh: `push` vào `market/bids|asks` với địa chỉ MetaMask | Backend chuyển tiếp lên chain; lệnh `open` được giữ qua các phiên đến khi khớp hết |
| `status: open / filled` | Khớp hết thì backend đổi thành `filled` |
| `transactions`: `hash, type, amount_kWh, value_ETH, block, timestamp, status` | Mỗi lần khớp ghi 2 bản ghi (người bán `sell` +ETH, người mua `buy` −ETH) với hash thật của `matchOrders` |
| Token "SLR – Solar Token" (My Wallet) | `SolarToken` symbol `SLR`; My Wallet đọc `balanceOf` |
| Nút "Nạp ETH", "Rút ETH" (My Wallet) | Gọi `deposit()`, `withdraw()`; My Wallet đọc `balances()` |
| Đặt lệnh mua (Energy Market) | Thiếu ký quỹ thì frontend gọi `deposit()` phần còn thiếu trước khi ghi lệnh |
| Phiên đấu giá (Energy Market) | Frontend đọc `currentSession()`, `sessionDeadline()` để đếm ngược |
| ESP32 subscribe MQTT `p2p/smart_contract` (`blockchainV2.ino`) | Hết phiên, nếu ví node (`NODE_WALLET`) là người bán hoặc người mua trong một cặp khớp, backend gửi `TRADE_SUCCESS` (một lần mỗi phiên, không retain). `MQTT_URL=` rỗng để tắt |
| Sổ lệnh | Backend ghi lệnh tự động của node vào `market/asks/iot_node_01` (`source: "iot"`), gỡ khi hết phiên |
| `sensor_data_history` (ESP32 POST mỗi 15 giây) | Lệnh tự động của node: bản ghi mới nhất quá `NODE_STALE_SECONDS` thì coi là offline; tích phân `electrical.p_solar` / `p_load` × `POWER_SCALE` ra Wh |

Frontend lấy địa chỉ + ABI từ bản copy `frontend/src/deployments/sepolia.json` (xem `frontend/src/contracts.js`),
vì Vercel chỉ build folder `frontend`. `npm run deploy:sepolia` ghi cả `deployments/sepolia.json` và bản copy đó,
nên deploy lại thì frontend tự dùng contract mới; nhớ commit cả hai file.

Mô hình phần cứng chỉ phát khoảng 1 W, một phiên 10 phút chưa tới 1 Wh nên contract (tính theo Wh nguyên) sẽ
không nhận lệnh nào. Backend nhân công suất đo được với `POWER_SCALE` (mặc định 1000: 1 W trên mô hình ứng với
1 kW của hộ gia đình) trước khi tính điện năng; `dataHash` vẫn là hash của đúng bản ghi gốc trên Firebase.

Backend chỉ ghi Firebase khi chạy trên Sepolia (hoặc đặt `FIREBASE_WRITE=true`): frontend tạo link
`sepolia.etherscan.io/tx/<hash>`, nên hash của mạng local sẽ là link hỏng.

## Đơn vị

| Đại lượng | Đơn vị trong contract |
|---|---|
| Điện năng | Wh (số nguyên) = `amount_kWh × 1000` |
| Giá | wei/kWh |
| Tiền phải trả | `energyWh × giá / 1000` (wei) |
| Thưởng | 1 SLR cho mỗi kWh bán được |

## Chạy local

```bash
npm install
npm test
npm run demo
```

Với dữ liệu Firebase thật (backend chỉ đọc Firebase khi chạy local):

```bash
npm run node                                   # terminal 1
SESSION_DURATION=120 npm run deploy:local      # terminal 2
npm run oracle                                 # terminal 2
npx hardhat run scripts/local-buyer.js --network localhost   # terminal 3, trong lúc phiên đang mở
```

PowerShell: `$env:SESSION_DURATION=120; npm run deploy:local`

## Deploy lên Sepolia

1. Sao chép `.env.example` thành `.env`, điền `NETWORK=sepolia`, `RPC_URL`, `DEPLOYER_PRIVATE_KEY`,
   `ORACLE_PRIVATE_KEY`, `NODE_WALLET`, `ETHERSCAN_API_KEY`. Ví deploy và ví oracle cần Sepolia ETH.
2. `npm run check:sepolia` — kiểm tra RPC URL, Etherscan API key, ví và số dư trước khi deploy.
3. `npm run deploy:sepolia` — ghi `deployments/sepolia.json` và bản copy `../frontend/src/deployments/sepolia.json`.
4. `npm run verify:sepolia`
5. `npm run oracle` — để chạy liên tục trong suốt buổi demo.

Không commit `.env`. Nên commit `deployments/sepolia.json` và `frontend/src/deployments/sepolia.json` để backend và frontend (kể cả bản trên Vercel) lấy địa chỉ và ABI.
