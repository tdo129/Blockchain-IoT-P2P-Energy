# contracts — Tầng Blockchain của SolarP2P

Smart contract (Solidity, Hardhat) và backend oracle nối Firebase với blockchain.
Folder này không sửa gì trong `frontend/`; nó đọc và ghi đúng các nhánh Firebase mà frontend đang dùng.

```
ESP32 / simulate.mjs ──► Firebase ◄──────────────── frontend (React)
                           │  ▲                         │ đọc: tram_hien_tai, iot_nodes,
                           │  │                         │      market, transactions
               đọc sensor, │  │ ghi transactions,       │ ghi: market/bids|asks (khi đặt lệnh)
               market      ▼  │ status "filled"
                     backend/oracle.js
                           │  submitOffer / submitBid          (lệnh tự động từ dữ liệu node IoT)
                           │  submitManualOffer / submitManualBid (lệnh người dùng đặt trên web)
                           │  matchOrders                      (hết phiên)
                           ▼
          P2PEnergyMarket (Sepolia) ── mintReward ──► SolarToken (SLR)
```

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `contracts/P2PEnergyMarket.sol` | Ký quỹ ETH, nhận lệnh, phiên đấu giá, khớp lệnh |
| `contracts/SolarToken.sol` | Token thưởng **SLR** (ERC-20, 3 decimals), trùng tên trang My Wallet |
| `contracts/DeviceRegistry.sol` | Ánh xạ ví với thiết bị IoT |
| `backend/oracle.js` | Vòng lặp oracle (`npm run oracle`) |
| `backend/firebase.js` | Đọc/ghi Firebase qua REST API |
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
| Sổ lệnh | Backend ghi lệnh tự động của node vào `market/asks/iot_node_01` (`source: "iot"`), gỡ khi hết phiên |
| `iot_nodes/node_01`, `lich_su_do` | Lệnh tự động của node: kiểm tra online, tích phân `cong_suat_W` |

Frontend lấy địa chỉ + ABI từ `deployments/sepolia.json` (xem `frontend/src/contracts.js`), nên deploy lại
thì frontend tự dùng contract mới; nhớ commit file này.

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
3. `npm run deploy:sepolia` — ghi `deployments/sepolia.json`.
4. `npm run verify:sepolia`
5. `npm run oracle` — để chạy liên tục trong suốt buổi demo.

Không commit `.env`. Nên commit `deployments/sepolia.json` để frontend lấy địa chỉ và ABI.
