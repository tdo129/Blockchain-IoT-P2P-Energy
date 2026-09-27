/**
 * Chỗ nối tầng AI. Hiện dùng mô hình cơ sở "naive persistence":
 * dự báo phiên tới = điện năng đo được trong phiên vừa qua.
 * Khi nhóm AI có mô hình (Regression/LSTM), thay thân hàm này bằng lời gọi mô hình
 * và đổi MODEL_ID (cả khi deploy, để contract duyệt đúng mô hình).
 */
const MODEL_ID = process.env.MODEL_ID || "naive-persistence-v1";

async function forecastNextSession({ measured }) {
  return {
    generationWh: measured.generationWh,
    consumptionWh: measured.consumptionWh,
  };
}

module.exports = { MODEL_ID, forecastNextSession };
