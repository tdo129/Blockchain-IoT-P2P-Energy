// Đọc/ghi Firebase Realtime Database qua REST API (rules hiện cho phép đọc/ghi công khai, xem mục 4 của README gốc)
const { normalizeReading } = require("./sensor");

async function request(baseUrl, method, path, { query = {}, body } = {}) {
  const params = new URLSearchParams(query).toString();
  const url = `${baseUrl}/${path}.json${params ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || (data && data.error)) {
    throw new Error(`Firebase ${method} /${path} lỗi: ${data && data.error ? data.error : res.status}`);
  }
  return data;
}

function createFirebaseClient(baseUrl) {
  const get = (path, query) => request(baseUrl, "GET", path, { query });

  return {
    /**
     * N bản ghi cảm biến mới nhất ESP32 POST vào sensor_data_history, sắp theo thời điểm đo.
     * Lọc theo $key vì push key do Firebase sinh tăng theo thời gian nhận
     * (metadata.timestamp là chuỗi nên không dùng orderBy được, và database cũng chưa khai báo .indexOn).
     * Không đọc sensor_data_recent: bộ đệm xoay vòng theo sample_id bị lẫn mẫu cũ khi ESP32 khởi động lại.
     */
    getLatestReadings: async (limit) => {
      const data = await get("sensor_data_history", { orderBy: '"$key"', limitToLast: String(limit) });
      return Object.entries(data || {})
        .map(([key, record]) => normalizeReading(key, record))
        .filter((r) => r.timestamp !== null)
        .sort((a, b) => a.timestamp - b.timestamp);
    },

    /** Kết quả mới nhất của mô hình AI (đọc sensor_data_recent): status, anomaly_detected, predicted_power_w, ... */
    getAiLatest: () => get("ai_analytics/latest"),

    /** Sổ lệnh người dùng đặt trên web: { asks, bids } (mảng do iot_code/simulator/simulate.mjs --seed ghi, hoặc object push key do frontend ghi) */
    getMarket: async () => (await get("market")) || {},

    /** Tương đương push() của Firebase SDK mà frontend dùng */
    push: (path, value) => request(baseUrl, "POST", path, { body: value }),

    /** Cập nhật một phần, tương đương update() */
    update: (path, value) => request(baseUrl, "PATCH", path, { body: value }),

    /** Ghi đè cả nút, tương đương set() */
    set: (path, value) => request(baseUrl, "PUT", path, { body: value }),

    /** Xóa nút, tương đương remove() */
    remove: (path) => request(baseUrl, "DELETE", path),
  };
}

module.exports = { createFirebaseClient };
