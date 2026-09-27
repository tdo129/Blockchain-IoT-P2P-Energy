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
│   │   └── firebase.js         # Cấu hình Firebase
│   ├── FIREBASE_SETUP.md       # Hướng dẫn setup Firebase
│   ├── simulate.mjs            # Script mô phỏng IoT gửi dữ liệu lên Firebase
│   └── package.json            # Các thư viện phụ thuộc
└── README.md                   # Thông tin dự án
```

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

## 🔗 Liên kết quan trọng
- **Mạng thử nghiệm (Testnet)**: Sepolia
- **Trình khám phá chuỗi (Explorer)**: [Sepolia Etherscan](https://sepolia.etherscan.io/)

---
*Dự án Đồ án môn học - Quản lý và giao dịch năng lượng P2P*
