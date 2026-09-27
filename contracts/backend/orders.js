const { ethers } = require("ethers");

/** ETH (số thực trong Firebase) -> wei. Tránh dạng 1e-7 mà parseEther không đọc được. */
function ethToWei(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Giá ETH không hợp lệ: ${value}`);
  const text = /e/i.test(String(n)) ? n.toFixed(18) : String(n);
  return ethers.parseEther(text);
}

/** kWh (số thực trong Firebase) -> Wh (số nguyên dùng trong contract) */
const kwhToWh = (value) => Math.round(Number(value) * 1000);

/**
 * Chuyển market/asks và market/bids thành lệnh gửi lên contract.
 * Chỉ lấy lệnh status = "open". Lệnh có địa chỉ ví sai hoặc số liệu sai được trả về trong `invalid`.
 */
function parseMarketOrders(market) {
  const valid = [];
  const invalid = [];

  for (const [side, list] of [
    ["ask", market?.asks],
    ["bid", market?.bids],
  ]) {
    for (const [index, order] of Object.entries(list || {})) {
      if (!order || order.status !== "open") continue;
      // Lệnh tự động của node IoT do chính backend ghi để hiển thị, đã có trên chain
      if (order.source === "iot") continue;

      const key = `${side}:${order.addr}:${order.timestamp}`;
      const where = `market/${side}s/${index}`;

      if (!ethers.isAddress(order.addr)) {
        invalid.push({ key, where, reason: `địa chỉ ví không hợp lệ (${order.addr})` });
        continue;
      }
      const energyWh = kwhToWh(order.amount_kWh);
      if (!(energyWh > 0)) {
        invalid.push({ key, where, reason: `amount_kWh không hợp lệ (${order.amount_kWh})` });
        continue;
      }
      let priceWei;
      try {
        priceWei = ethToWei(order.price_ETH);
      } catch (err) {
        invalid.push({ key, where, reason: err.message });
        continue;
      }

      valid.push({ key, where, side, addr: ethers.getAddress(order.addr), energyWh, priceWei });
    }
  }

  return { valid, invalid };
}

module.exports = { ethToWei, kwhToWh, parseMarketOrders };
