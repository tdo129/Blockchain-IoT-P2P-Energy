/**
 * Bản ghi cảm biến do ESP32 (blockchainV2.ino) ghi lên Firebase, 15 giây một lần:
 *   sensor_data_history/<push key>  (POST, lưu vĩnh viễn)
 *   sensor_data_recent/record_0..9  (PUT xoay vòng 10 mẫu gần nhất cho AI)
 * {
 *   metadata:    { sample_id, timestamp: "YYYY-MM-DD HH:MM:SS" (giờ Việt Nam) hoặc "N/A" khi chưa đồng bộ NTP },
 *   electrical:  { v_solar (V), i_solar (mA), p_solar (W), v_load (V), i_load (mA), p_load (W) },
 *   environment: { irradiance (W/m², ước tính từ p_solar), temp_panel (°C), temp_ambient (°C) }
 * }
 */

const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

/** Thời điểm Firebase nhận bản ghi (giây), giải mã từ 8 ký tự đầu của push key (luôn dài 20 ký tự) */
function pushKeyTime(key) {
  if (typeof key !== "string" || key.length !== 20) return null;
  let ms = 0;
  for (const ch of key.slice(0, 8)) {
    const idx = PUSH_CHARS.indexOf(ch);
    if (idx < 0) return null;
    ms = ms * 64 + idx;
  }
  return Math.floor(ms / 1000);
}

/** "2026-09-28 15:03:14" theo giờ Việt Nam (ESP32 cấu hình NTP UTC+7) -> giây Unix */
function parseDeviceTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value.replace(" ", "T")}+07:00`);
  return Number.isNaN(ms) ? null : ms / 1000;
}

/**
 * Thời điểm đo của bản ghi (giây Unix). Dùng metadata.timestamp của thiết bị;
 * sample_id không dùng được vì đếm lại từ 1 mỗi lần ESP32 khởi động lại.
 * Thiết bị chưa đồng bộ NTP ("N/A") thì lấy thời điểm Firebase nhận từ push key.
 */
function readingTime(key, record) {
  return parseDeviceTime(record?.metadata?.timestamp) ?? pushKeyTime(key);
}

/** { key, timestamp, metadata, electrical, environment }; timestamp = null nếu không xác định được */
function normalizeReading(key, record) {
  return { key, timestamp: readingTime(key, record), ...record };
}

module.exports = { pushKeyTime, parseDeviceTime, readingTime, normalizeReading };
