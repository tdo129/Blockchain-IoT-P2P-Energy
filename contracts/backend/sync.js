const { ethers } = require("ethers");

const eth = (wei) => Number(ethers.formatEther(wei));

/**
 * Một lần khớp lệnh on-chain -> 2 bản ghi cho nhánh `transactions`, theo schema frontend/src/pages/Transactions.jsx:
 * { hash, type: "buy" | "sell", amount_kWh, value_ETH (âm = bị trừ, dương = nhận), block, timestamp, status }.
 * Người mua và người bán mỗi bên một bản ghi, cùng hash của giao dịch matchOrders.
 * Các trường thêm (addr, counterparty, price_ETH, session) frontend chưa đọc nhưng giúp truy vết.
 */
function buildTradeRecords({ hash, block, timestamp, sessionId, seller, buyer, energyWh, pricePerKWh, totalCost }) {
  const common = {
    hash,
    block: Number(block),
    timestamp: Number(timestamp),
    status: "success",
    amount_kWh: Number(energyWh) / 1000,
    price_ETH: eth(pricePerKWh),
    session: Number(sessionId),
  };
  return [
    { ...common, type: "sell", value_ETH: eth(totalCost), addr: seller, counterparty: buyer },
    { ...common, type: "buy", value_ETH: -eth(totalCost), addr: buyer, counterparty: seller },
  ];
}

module.exports = { buildTradeRecords };
