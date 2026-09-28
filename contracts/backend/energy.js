const { ethers } = require("ethers");

const power = (value) => Math.max(0, Number(value) || 0);

/**
 * Tính điện năng phát/tiêu thụ trong cửa sổ [fromTs, toTs] bằng cách tích phân công suất theo thời gian
 * (quy tắc hình thang). ESP32 chỉ gửi công suất tức thời electrical.p_solar / p_load (W), không gửi điện năng cộng dồn.
 * powerScale: hệ số quy đổi công suất mô hình thu nhỏ ra công suất hộ gia đình (xem POWER_SCALE trong config.js).
 */
function integrateEnergy(records, fromTs, toTs, maxGapSeconds, powerScale = 1) {
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

    generationJ += ((power(prev.electrical?.p_solar) + power(cur.electrical?.p_solar)) / 2) * powerScale * dt;
    consumptionJ += ((power(prev.electrical?.p_load) + power(cur.electrical?.p_load)) / 2) * powerScale * dt;
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

/**
 * dataHash đưa lên chain: keccak256 của đúng các bản ghi Firebase đã dùng để tính điện năng,
 * kèm bản ghi ai_analytics/latest nếu chốt chặn AI đã dùng nó để quyết định.
 */
function hashRecords(nodeId, records, ai) {
  const payload = ai ? { nodeId, records, ai } : { nodeId, records };
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalJson(payload)));
}

module.exports = { integrateEnergy, canonicalJson, hashRecords };
