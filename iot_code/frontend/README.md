# frontend — Dashboard Web3 (React + Vite)

Giao diện thời gian thực cho người dùng: xem số đo ESP32 và kết quả AI, đặt lệnh mua/bán điện, nạp/rút ETH ký quỹ
qua **MetaMask**, và truy vết mọi giao dịch trên **Sepolia Etherscan**. Bản chạy trên mạng được deploy ở Vercel.

```
iot_code/frontend/
├── src/
│   ├── main.jsx, App.jsx        # Router: /, /market, /wallet, /transactions
│   ├── context/Web3Context.jsx  # Kết nối MetaMask, bắt buộc mạng Sepolia (tự đề nghị chuyển mạng)
│   ├── contracts.js             # Địa chỉ + ABI contract, provider/signer, ghi giao dịch nạp/rút vào Firebase
│   ├── deployments/sepolia.json # Bản copy từ contracts/deployments (npm run deploy:sepolia tự ghi)
│   ├── firebase.js              # Cấu hình Firebase + các nhánh dữ liệu dùng chung (refs)
│   ├── sensor.js                # Đọc bản ghi ESP32: thời điểm đo, trạng thái SELL/BUY/BAL như LCD
│   ├── components/              # Sidebar, TopBar
│   └── pages/                   # Overview, EnergyMarket, MyWallet, Transactions
├── vercel.json                  # Rewrite mọi đường dẫn về index.html (React Router trên Vercel)
└── vite.config.js
```

## 1. Kiến trúc

Frontend **không có server riêng**: trình duyệt nói chuyện trực tiếp với 2 nơi.

```
                 ┌──────────── Trình duyệt (React) ────────────┐
Firebase SDK ◄───┤ firebase.js: lắng nghe realtime (onValue)    │
 (blockchain-6d10b)│   sensor_data_history, ai_analytics/latest,  │
                 │   market/bids|asks, transactions             │
                 │                                              │
MetaMask ◄───────┤ contracts.js + ethers.js v6                  │──► Sepolia: P2PEnergyMarket, SolarToken
 (window.ethereum)│   đọc: currentSession, sessionDeadline,      │
                 │         balances, balanceOf                  │
                 │   ghi: deposit, withdraw (người dùng ký)     │
                 └──────────────────────────────────────────────┘
```

Người dùng **không gọi thẳng hàm đặt lệnh** của contract (chỉ ví oracle được gọi). Lệnh được ghi vào Firebase,
rồi backend oracle đưa lên chain; nhờ vậy người dùng chỉ ký giao dịch khi nạp/rút tiền.

## 2. Các trang và luồng dữ liệu

| Trang | Đọc | Ghi / giao dịch |
|---|---|---|
| **Overview** `/` | 15 bản ghi mới nhất `sensor_data_history` (biểu đồ, số đo 2 INA219, nhiệt độ, bức xạ, Online/Offline theo tuổi bản ghi ≤ 60 giây); `ai_analytics/latest` (khung AI Analytics); `transactions` (số lần khớp trong ngày) | — |
| **Energy Market** `/market` | `market/bids`, `market/asks` (sổ lệnh); `currentSession()`, `sessionDeadline()` (đếm ngược phiên); `transactions` (khớp gần nhất) | Đặt lệnh: nếu là lệnh **mua** và ký quỹ thiếu → MetaMask gọi `deposit()` phần còn thiếu → `push` lệnh `{type, price_ETH, amount_kWh, addr, status: "open", timestamp}` vào `market/bids` hoặc `market/asks` |
| **My Wallet** `/wallet` | Số dư ETH ví, ký quỹ `balances(ví)`, SLR `balanceOf(ví)`, 5 giao dịch gần nhất của ví trong `transactions` | Nạp / Rút ETH: `deposit()` / `withdraw()` qua MetaMask, rồi ghi bản ghi vào `transactions` |
| **Transactions** `/transactions` | `transactions` (lọc Mua / Bán / Chuyển, tìm theo hash), đếm theo trạng thái | — ; mỗi dòng có link `sepolia.etherscan.io/tx/<hash>` |

Luồng một lệnh mua đầy đủ:
```
Người dùng bấm "Đặt lệnh MUA" ─► (thiếu ký quỹ) MetaMask ký deposit() ─► lệnh vào Firebase market/bids
  ─► oracle đọc trong ≤ 5 giây ─► submitManualBid trên contract ─► hết phiên: matchOrders
  ─► oracle ghi transactions + status "filled" ─► Energy Market / Transactions / My Wallet tự cập nhật
```

Đơn vị trên giao diện: giá **ETH/kWh**, lượng **kWh**; oracle tự đổi sang wei/kWh và Wh khi đưa lên contract.

## 3. Cách chạy

Cần Node.js 20.19+ (yêu cầu của Vite 8) và tiện ích **MetaMask** trên trình duyệt, đặt mạng **Sepolia**,
ví có ít Sepolia ETH (lấy từ faucet) để nạp ký quỹ.

### 3.1. Chạy trên máy
```bash
cd iot_code/frontend
npm install
npm run dev          # http://localhost:5173
```
Không cần file `.env`: cấu hình Firebase nằm trong `src/firebase.js`, địa chỉ contract trong
`src/deployments/sepolia.json`. Muốn dữ liệu thay đổi thì cần ESP32 (hoặc giả lập ở `iot_code/simulator`) và
backend oracle (`contracts`) đang chạy.

### 3.2. Build và deploy lên Vercel
```bash
npm run build        # xuất ra dist/
npm run preview      # xem thử bản build
```
Cài đặt project trên Vercel: **Root Directory `iot_code/frontend`**, Framework **Vite**, Build `npm run build`,
Output `dist`, Node.js 22.x, không cần biến môi trường. Mỗi lần push lên `main`, Vercel tự build lại.
Chỉ deploy qua GitHub (không chạy thêm `vercel --prod` từ máy) để hai cách deploy không đè nhau.

### 3.3. Kiểm tra nhanh sau khi deploy
1. **Overview** có dữ liệu ESP32, khung AI Analytics có dữ liệu, không lỗi trắng.
2. Kết nối MetaMask: **Energy Market** hiện số phiên của contract `0x2319…A612` và đồng hồ đếm ngược.
3. Đặt thử lệnh mua 0,02 kWh: log oracle hiện `[WEB] Nhận lệnh MUA ...` trong khoảng 5 giây.

### 3.4. Thêm token SLR vào MetaMask
MetaMask (mạng Sepolia) → *Import tokens* → *Custom token* → địa chỉ
`0x3bd3A251021d781Fa6B37d5B97B6A91fd779FDa6`, Symbol `SLR`, Decimals `3`.

## 4. Lưu ý
- Khung **"AI Gợi ý Lệnh Tối Ưu"** và biểu đồ giá trên trang Energy Market đang là **dữ liệu minh hoạ** viết cứng
  trong code, chưa lấy từ AI. Dữ liệu AI thật nằm ở khung *AI Analytics* của trang Overview.
- Trang **Transactions** hiện một danh sách giao dịch mẫu khi nhánh `transactions` trên Firebase còn trống, và cột phí gas đang là giá trị cố định `0.0003 ETH`; phí thật xem trên Etherscan.
- Firebase đang để rules đọc/ghi công khai cho demo; cấu trúc dữ liệu xem ở [README gốc](../../README.md#4-cơ-sở-dữ-liệu-firebase).
