// Bản ghi cảm biến do ESP32 (blockchainV2.ino) ghi lên Firebase mỗi 15 giây, cùng logic contracts/backend/sensor.js:
// { metadata: { sample_id, timestamp: "YYYY-MM-DD HH:MM:SS" giờ VN | "N/A" },
//   electrical: { v_solar V, i_solar mA, p_solar W, v_load V, i_load mA, p_load W },
//   environment: { irradiance W/m², temp_panel °C, temp_ambient °C } }

export const SAMPLE_SECONDS = 15;
// Bản ghi mới nhất cũ hơn khoảng này thì coi ESP32 là offline (bằng NODE_STALE_SECONDS của backend)
export const STALE_SECONDS = 60;

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

/** Thời điểm Firebase nhận bản ghi (giây), giải mã từ push key 20 ký tự */
function pushKeyTime(key) {
  if (typeof key !== 'string' || key.length !== 20) return null;
  let ms = 0;
  for (const ch of key.slice(0, 8)) {
    const idx = PUSH_CHARS.indexOf(ch);
    if (idx < 0) return null;
    ms = ms * 64 + idx;
  }
  return Math.floor(ms / 1000);
}

/** Thời điểm đo (giây Unix): metadata.timestamp giờ VN, ESP32 chưa đồng bộ NTP ("N/A") thì lấy từ push key */
export function readingTime(key, record) {
  const value = record?.metadata?.timestamp;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    const ms = Date.parse(`${value.replace(' ', 'T')}+07:00`);
    if (!Number.isNaN(ms)) return ms / 1000;
  }
  return pushKeyTime(key);
}

/** Snapshot của sensor_data_history -> mảng { key, time, ...record } sắp theo thời điểm đo */
export function readingsFromSnapshot(snap) {
  const readings = [];
  snap.forEach(child => {
    const time = readingTime(child.key, child.val());
    if (time !== null) readings.push({ key: child.key, time, ...child.val() });
  });
  return readings.sort((a, b) => a.time - b.time);
}

/** Cùng ngưỡng hiển thị trên LCD của ESP32: dư > 0.05 W là SELL, thiếu > 0.05 W là BUY */
export function tradeState(surplusW) {
  if (surplusW > 0.05) return 'SELL';
  if (surplusW < -0.05) return 'BUY';
  return 'BAL';
}
