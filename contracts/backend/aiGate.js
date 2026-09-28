/**
 * Chốt chặn AI cho lệnh tự động của node, dựa trên ai_analytics/latest mà mô hình AI ghi:
 *   { predicted_power_w, actual_power_w, power_difference_w, anomaly_detected,
 *     status: "OPTIMAL" | "FAULT_DETECTED", sample_id, timestamp (giờ đo của mẫu AI xét), inferred_at, ... }
 *
 * Kết quả:
 *   ok       AI xét mẫu gần với dữ liệu ESP32 mới nhất và báo bình thường
 *   anomaly  AI báo bất thường: không bán điện (số đo có thể sai do tấm pin lỗi), vẫn cho mua
 *   stale    AI xét mẫu quá cũ so với ESP32 (AI ngừng chạy, hoặc chọn nhầm mẫu cũ sau khi ESP32 khởi động lại)
 *   missing  Không có / không đọc được ai_analytics/latest
 * stale và missing: không chặn, oracle quay về lệnh tự động như khi chưa có AI.
 */
const { parseDeviceTime } = require("./sensor");

function evaluateAiGate(ai, latestReadingTs, maxLagSeconds) {
  if (!ai || typeof ai !== "object") {
    return { status: "missing", reason: "không có ai_analytics/latest" };
  }

  // So thời điểm của mẫu AI đã xét (không phải lúc suy luận) với mẫu ESP32 mới nhất:
  // AI chạy đều nhưng xét nhầm mẫu cũ thì kết quả cũng không nói gì về tấm pin lúc này
  const aiTs = parseDeviceTime(ai.timestamp);
  if (aiTs === null) {
    return { status: "stale", reason: `thời điểm mẫu AI không hợp lệ (${ai.timestamp})`, record: ai };
  }
  const lagSeconds = Math.round(latestReadingTs - aiTs);
  if (lagSeconds > maxLagSeconds) {
    return {
      status: "stale",
      reason: `AI xét mẫu lúc ${ai.timestamp}, cũ hơn dữ liệu ESP32 ${lagSeconds} giây (> ${maxLagSeconds})`,
      record: ai,
      lagSeconds,
    };
  }

  if (ai.anomaly_detected === true || ai.status === "FAULT_DETECTED") {
    return {
      status: "anomaly",
      reason: `AI báo ${ai.status}: dự đoán ${ai.predicted_power_w} W, thực tế ${ai.actual_power_w} W`,
      record: ai,
      lagSeconds,
    };
  }
  return { status: "ok", reason: `AI báo ${ai.status}`, record: ai, lagSeconds };
}

module.exports = { evaluateAiGate };
