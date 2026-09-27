const { ethers } = require("ethers");

const power = (value) => Math.max(0, Number(value) || 0);

/**
 * Tính điện năng phát/tiêu thụ trong cửa sổ [fromTs, toTs] bằng cách tích phân công suất theo thời gian
 * (quy tắc hình thang). Không dùng dien_nang_*_kWh vì dữ liệu hiện tại không cộng dồn.
 */
function integrateEnergy(records, fromTs, toTs, maxGapSeconds) {
  const inWindow = records
    .filter((r) => r.timestamp >= fromTs && r.timestamp <= toTs)
    .sort((a, b) => a.timestamp - b.timestamp);

  let generationJ = 0;
  let consumptionJ = 0;
  let coveredSeconds = 0;

  for (let i = 1; i < inWindow.length; i++) {
    const prev = inWindow[i - 1];
    const cur = inWindow[i];
    const dt = cur.timestamp - prev.timestamp;
    if (dt <= 0 || dt > maxGapSeconds) continue;

    generationJ += ((power(prev.nguon_phat?.cong_suat_W) + power(cur.nguon_phat?.cong_suat_W)) / 2) * dt;
    consumptionJ += ((power(prev.tai_tieu_thu?.cong_suat_W) + power(cur.tai_tieu_thu?.cong_suat_W)) / 2) * dt;
    coveredSeconds += dt;
  }

  return {
    records: inWindow,
    generationWh: Math.round(generationJ / 3600),
    consumptionWh: Math.round(consumptionJ / 3600),
    coveredSeconds,
  };
}

/** JSON với khóa sắp xếp cố định, để cùng một dữ liệu luôn cho cùng một hash */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** dataHash đưa lên chain: keccak256 của đúng các bản ghi Firebase đã dùng để tính điện năng */
function hashRecords(nodeId, records) {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalJson({ nodeId, records })));
}

module.exports = { integrateEnergy, canonicalJson, hashRecords };
