// Đọc/ghi Firebase Realtime Database qua REST API (rules hiện cho phép đọc/ghi công khai, xem frontend/FIREBASE_SETUP.md)
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
    /** Trạng thái node IoT: online, last_seen, temp_C, irradiance_Wm2, ... */
    getNode: (nodeId) => get(`iot_nodes/${nodeId}`),

    /**
     * N bản ghi lịch sử mới nhất, sắp theo thời gian.
     * Lọc theo $key vì push key của Firebase tăng theo thời gian;
     * lọc theo "timestamp" bị từ chối do database chưa khai báo .indexOn.
     */
    getLatestHistory: async (limit) => {
      const data = await get("lich_su_do", { orderBy: '"$key"', limitToLast: String(limit) });
      return Object.entries(data || {})
        .map(([key, record]) => ({ key, ...record }))
        .sort((a, b) => a.timestamp - b.timestamp);
    },

    /** Sổ lệnh người dùng đặt trên web: { asks, bids } (mảng do simulate.mjs ghi, hoặc object push key do frontend ghi) */
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
