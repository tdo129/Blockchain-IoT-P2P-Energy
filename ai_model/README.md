# ai_model — Tầng AI (xử lý & tối ưu)

Mô hình **LSTM dự báo công suất điện mặt trời** từ dữ liệu thời tiết, cùng bản **lượng tử hoá INT8** để chạy nhẹ
trên thiết bị biên (Raspberry Pi). Kết quả suy luận được ghi lên Firebase (`ai_analytics`), rồi backend oracle
dùng làm **chốt chặn** trước khi đưa lệnh tự động của node lên smart contract.

```
ai_model/
├── blockchain.ipynb        # Notebook: tiền xử lý → huấn luyện → lượng tử hoá INT8 → đánh giá → xuất tham số chuẩn hoá
├── solar_lstm.pth          # Trọng số Float32 (state_dict, ~211 KB)
├── solar_lstm_int8.pth     # Trọng số INT8 sau quantize_dynamic (state_dict, ~62 KB)
└── requirements.txt        # Thư viện Python để chạy lại notebook
```

## 1. Kiến trúc mô hình

**Dữ liệu huấn luyện:** Kaggle *Solar Power Generation Data* (anikannal), nhà máy số 1:
`Plant_1_Generation_Data.csv` ghép với `Plant_1_Weather_Sensor_Data.csv` theo `DATE_TIME`, gom theo mốc 15 phút
(cộng `DC_POWER` của các inverter, lấy trung bình dữ liệu thời tiết), còn **3157 mốc**.

| | Nội dung |
|---|---|
| Đầu vào (3 đặc trưng) | `AMBIENT_TEMPERATURE` (°C), `MODULE_TEMPERATURE` (°C), `IRRADIATION` (kW/m²) |
| Đầu ra | `DC_POWER` (W) ở mốc kế tiếp |
| Chuẩn hoá | `MinMaxScaler` riêng cho X và y |
| Cửa sổ | `SEQ_LENGTH = 10` mốc liên tiếp (10 × 15 phút = 2,5 giờ) → dự báo mốc thứ 11 |
| Chia tập | 80% đầu làm train, 20% cuối làm test (giữ thứ tự thời gian) |

```
x (batch, 10, 3) ──► LSTM(input=3, hidden=64, layers=2, dropout=0.2) ──► h cuối (batch, 64)
                 ──► Linear(64→32) ──► ReLU ──► Linear(32→1) ──► DC_POWER đã chuẩn hoá
```

Huấn luyện: `SmoothL1Loss(beta=0.01)`, `AdamW(lr=1e-3, weight_decay=1e-4)`, `CosineAnnealingLR`, 50 epoch, batch 32.

**Lượng tử hoá (Edge AI):** `torch.quantization.quantize_dynamic(model, {nn.LSTM, nn.Linear}, dtype=torch.qint8)`.

## 2. Kết quả (lấy từ output đã lưu trong notebook)

| Chỉ số trên tập test | Float32 | INT8 |
|---|---|---|
| Thời gian suy luận toàn tập test | 138,20 ms | **35,70 ms** (nhanh hơn ~3,9 lần) |
| MSE (trên giá trị chuẩn hoá) | 0,005258 | 0,005261 |
| R² | 92,94% | **92,94%** |
| Dung lượng file | ~211 KB | **~62 KB** (nhỏ hơn ~3,4 lần) |

R² trên tập train ổn định ở khoảng 92,6% từ epoch 10 đến 50. Bản INT8 giữ nguyên độ chính xác mà nhẹ và nhanh
hơn nhiều, phù hợp chạy trên Raspberry Pi.

Tham số chuẩn hoá cần nạp khi suy luận (cell cuối của notebook):
```python
X_min = [20.398504866666663, 18.140415466666663, 0.0]   # AMBIENT_TEMPERATURE, MODULE_TEMPERATURE, IRRADIATION
X_max = [35.25248613333334, 65.54571366666664, 1.2216518466666668]
y_min = 0.0
y_max = 298937.78571                                     # W, công suất DC cả nhà máy
```

## 3. Luồng dữ liệu trong hệ thống

```
ESP32 ──PUT──► Firebase sensor_data_recent/record_0..9   (10 mẫu gần nhất = đúng SEQ_LENGTH của mô hình)
                        │
                        ▼  dịch vụ suy luận trên Raspberry Pi (dùng solar_lstm_int8.pth)
                 temp_ambient → AMBIENT_TEMPERATURE, temp_panel → MODULE_TEMPERATURE,
                 irradiance (W/m²) / 1000 → IRRADIATION (kW/m²)
                        │
                        ▼
        Firebase ai_analytics/latest  +  ai_analytics/history/<push key>
                        │
          ┌─────────────┴──────────────┐
          ▼                            ▼
 frontend Overview:               contracts/backend/aiGate.js (oracle):
 khung "AI Analytics"             AI báo bất thường → node KHÔNG tự bán điện phiên đó;
                                  bản ghi AI được gộp vào dataHash đưa lên smart contract
```

Bản ghi mà dịch vụ suy luận ghi vào `ai_analytics/latest`:

| Trường | Ý nghĩa |
|---|---|
| `predicted_power_w` / `actual_power_w` | Công suất mô hình dự đoán / công suất đo thật (W) |
| `power_difference_w`, `relative_error_pct`, `tracking_accuracy_pct` | Độ lệch giữa dự đoán và thực tế |
| `anomaly_detected`, `status` | `true` / `FAULT_DETECTED` khi lệch quá ngưỡng, ngược lại `OPTIMAL` |
| `sample_id`, `timestamp` | Mẫu ESP32 mà mô hình đã xét |
| `inferred_at` | Thời điểm chạy suy luận |

Backend oracle chỉ tin kết quả AI nếu mẫu AI xét lệch dữ liệu ESP32 mới nhất không quá `AI_MAX_LAG_SECONDS`
(mặc định 120 giây). Xem [`contracts/backend/aiGate.js`](../contracts/backend/aiGate.js).

## 4. Cách chạy

### 4.1. Huấn luyện lại (notebook)
Notebook viết cho **Kaggle** (GPU miễn phí, dataset có sẵn):
1. Tạo notebook trên Kaggle, *Add Input* → dataset **anikannal/solar-power-generation-data**, upload `blockchain.ipynb`.
2. *Run All*. File trọng số được ghi vào `/kaggle/working/` (`solar_lstm.pth`, `solar_lstm_int8.pth`).
3. Tải 2 file `.pth` về, thay vào thư mục `ai_model/`.

Chạy trên máy cá nhân:
```bash
cd ai_model
pip install -r requirements.txt
jupyter notebook blockchain.ipynb
```
Tải dataset từ Kaggle về máy, rồi sửa các đường dẫn `/kaggle/input/...` và `/kaggle/working/...` trong notebook
thành đường dẫn trên máy.

### 4.2. Nạp mô hình INT8 để suy luận
```python
import torch, torch.nn as nn
# Khai báo lại class SolarLSTM giống cell 2 của notebook
model = SolarLSTM(input_size=3, hidden_size=64, num_layers=2, dropout_prob=0.0)
model = torch.quantization.quantize_dynamic(model, {nn.LSTM, nn.Linear}, dtype=torch.qint8)
model.load_state_dict(torch.load("ai_model/solar_lstm_int8.pth", map_location="cpu", weights_only=False))
model.eval()

# x: tensor (1, 10, 3) gồm 10 mẫu liên tiếp, đã chuẩn hoá bằng X_min / X_max ở trên
with torch.no_grad():
    power_w = model(x).item() * (y_max - y_min) + y_min
```

## 5. Hạn chế đã biết (cần xử lý trước khi dùng AI để quyết định lượng mua bán)
- **Chưa có mã dịch vụ suy luận trong repo.** Chương trình đọc `sensor_data_recent` và ghi `ai_analytics` đang
  chạy riêng trên Raspberry Pi. Nên đưa vào `ai_model/inference/` để nộp bài đủ luồng.
- **Lệch thang đo:** mô hình học trên nhà máy tới ~299 kW, còn tấm pin của mô hình phần cứng chỉ ~1 W. Phải quy
  đổi đầu ra (hoặc huấn luyện lại trên dữ liệu ESP32); nếu không sẽ dự đoán kiểu 748 W trong khi thực tế 2,5 W,
  và báo `FAULT_DETECTED` sai.
- **Lệch nhịp thời gian:** mô hình học trên mốc 15 phút, còn ESP32 gửi mỗi 15 giây, nên 10 mẫu trong
  `sensor_data_recent` chỉ phủ 2,5 phút thay vì 2,5 giờ.
- **Chọn mẫu theo `sample_id`:** sau khi ESP32 khởi động lại, mẫu có `sample_id` lớn nhất trong
  `sensor_data_recent` là mẫu cũ. Cần chọn theo `metadata.timestamp`.
- Mô hình chỉ dự báo **sản lượng**, chưa dự báo **nhu cầu tiêu thụ**. Hiện backend dự báo phiên tới bằng mô hình
  cơ sở `naive-persistence-v1` từ số đo ESP32.
