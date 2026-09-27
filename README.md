# 🌞 P2P Solar Energy Trading Dashboard

Dự án Hệ thống quản lý và giao dịch năng lượng mặt trời P2P (P2P Energy Trading) dựa trên công nghệ **Blockchain (Web3)**, **IoT**, và **AI**.

## 📌 Tính năng chính

- 📊 **Dashboard Thời Gian Thực**: Lấy dữ liệu trực tiếp từ Firebase (công suất, điện áp, dòng điện).
- 🔗 **Web3 & MetaMask**: Tích hợp ví MetaMask để thực hiện và xác nhận giao dịch P2P qua mạng Sepolia.
- 🌍 **Truy vết On-chain (Etherscan)**: Lịch sử mọi giao dịch mua bán điện được băm (hash) và lưu lại vĩnh viễn trên chuỗi khối, có thể tra cứu qua Sepolia Etherscan.
- 📱 **Responsive UI**: Giao diện thiết kế theo phong cách Glassmorphism hiện đại (Dark mode).

## 🚀 Công nghệ sử dụng

- **Frontend**: React.js (Vite), Tailwind CSS (hoặc custom CSS hiện đại), Recharts, Lucide-react.
- **Blockchain**: ethers.js v6, Mạng thử nghiệm Sepolia, Ví MetaMask.
- **Backend / Database**: Firebase Realtime Database (Lưu trữ trạng thái các thiết bị IoT và lịch sử giao dịch).
- **Phần cứng (IoT Simulator)**: Node.js mô phỏng tín hiệu MQTT/HTTP từ ESP32/Raspberry Pi.

## 📂 Cấu trúc dự án

```
Blockchain-IoT-P2P-Energy/
├── frontend/                   # Mã nguồn ứng dụng Web React
│   ├── src/                    
│   │   ├── components/         # Các UI component tái sử dụng (TopBar, Sidebar)
│   │   ├── context/            # Web3Context quản lý kết nối MetaMask
│   │   ├── pages/              # Các trang chính (Overview, EnergyMarket, Transactions, MyWallet)
│   │   ├── contracts.js        # Kết nối smart contract (địa chỉ + ABI từ contracts/deployments)
│   │   └── firebase.js         # Cấu hình Firebase
│   ├── FIREBASE_SETUP.md       # Hướng dẫn setup Firebase
│   ├── simulate.mjs            # Script mô phỏng IoT gửi dữ liệu lên Firebase
│   └── package.json            # Các thư viện phụ thuộc
├── contracts/                  # Tầng Blockchain (xem contracts/README.md)
│   ├── contracts/              # Smart contract Solidity: P2PEnergyMarket, SolarToken (SLR), DeviceRegistry
│   ├── backend/                # Backend oracle: Firebase <-> smart contract
│   ├── scripts/                # Deploy, verify Etherscan, demo
│   ├── test/                   # Test Hardhat
│   └── deployments/sepolia.json# Địa chỉ + ABI contract đã deploy trên Sepolia
└── README.md                   # Thông tin dự án
```

## ⛓️ Tầng Blockchain

- **P2PEnergyMarket**: sàn đấu giá theo phiên. Người mua nạp ETH ký quỹ, hết phiên contract khớp lệnh,
  chuyển ETH cho người bán và thưởng token **SLR** (1 SLR / kWh bán được).
- **Backend oracle** (`contracts/backend/oracle.js`): đọc dữ liệu cảm biến trên Firebase để tạo lệnh bán tự động
  cho node IoT (kèm hash dữ liệu làm bằng chứng), chuyển lệnh người dùng đặt trên web lên contract,
  gọi `matchOrders` khi hết phiên và ghi kết quả (hash giao dịch thật) vào Firebase `transactions`.
- **Frontend**: nút Nạp/Rút ETH gọi `deposit()` / `withdraw()`, trang Energy Market đọc phiên đấu giá từ contract,
  đặt lệnh mua tự nạp phần ký quỹ còn thiếu, trang Transactions truy vết trên Sepolia Etherscan.

## 🛠️ Hướng dẫn cài đặt và chạy thử

### 1. Cài đặt thư viện
```bash
cd frontend
npm install
```

### 2. Khởi chạy Dashboard (Web App)
```bash
npm run dev
```
Trình duyệt sẽ mở tại `http://localhost:5174` (hoặc cổng tương tự).

### 3. Khởi chạy Mô phỏng IoT phần cứng
Mở một terminal khác và chạy script đẩy dữ liệu cảm biến:
```bash
cd frontend
npm run simulate
```
Dữ liệu sẽ được đẩy liên tục lên Firebase mỗi 5 giây, giao diện Web sẽ tự động cập nhật biểu đồ và sổ lệnh thị trường.
Thêm `-- --seed` (`npm run simulate -- --seed`) nếu muốn tạo sổ lệnh và giao dịch mẫu (sẽ ghi đè dữ liệu thật).

### 4. Khởi chạy Backend Oracle (nối Firebase với smart contract)
```bash
cd contracts
npm install
npm run oracle
```
Cần file `contracts/.env` (tạo từ `.env.example`, không commit). Hướng dẫn deploy và cấu hình chi tiết: [contracts/README.md](contracts/README.md).

## 🔗 Liên kết quan trọng
- **Mạng thử nghiệm (Testnet)**: Sepolia
- **Trình khám phá chuỗi (Explorer)**: [Sepolia Etherscan](https://sepolia.etherscan.io/)
- **P2PEnergyMarket**: [0x5E80aE85c9047EC0bC7a986d7E756A758981E308](https://sepolia.etherscan.io/address/0x5E80aE85c9047EC0bC7a986d7E756A758981E308)
- **SolarToken (SLR)**: [0xDb40539F50B3468CBa609Be9352b5F595E77445B](https://sepolia.etherscan.io/address/0xDb40539F50B3468CBa609Be9352b5F595E77445B)
- **DeviceRegistry**: [0x424ece2b487a41c7DB91AbFF3e4c95DD2D493dD9](https://sepolia.etherscan.io/address/0x424ece2b487a41c7DB91AbFF3e4c95DD2D493dD9)

---
*Dự án Đồ án môn học - Quản lý và giao dịch năng lượng P2P*
