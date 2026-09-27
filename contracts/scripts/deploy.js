const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { MODEL_ID } = require("../backend/forecast");

async function main() {
  const { ethers } = hre;
  const [deployer, oracle] = await ethers.getSigners();
  const oracleAddress = process.env.ORACLE_ADDRESS || oracle?.address;
  if (!oracleAddress) throw new Error("Thiếu ví oracle: đặt ORACLE_ADDRESS hoặc ORACLE_PRIVATE_KEY trong .env");
  const sessionDuration = Number(process.env.SESSION_DURATION || 600);

  console.log("Mạng           :", hre.network.name);
  console.log("Ví deploy      :", deployer.address, `(${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH)`);
  console.log("Ví oracle      :", oracleAddress);
  console.log("Độ dài phiên   :", sessionDuration, "giây\n");

  let totalGas = 0n;
  const track = async (label, receiptPromise) => {
    const receipt = await receiptPromise;
    totalGas += receipt.gasUsed;
    console.log(`${label.padEnd(34)} gas ${receipt.gasUsed.toString().padStart(9)}  tx ${receipt.hash}`);
    return receipt;
  };
  const deploy = async (name, args) => {
    const contract = await (await ethers.getContractFactory(name)).deploy(...args);
    await track(`Deploy ${name}`, contract.deploymentTransaction().wait());
    return { contract, args };
  };

  // 1. Token thưởng SLR: không mint sẵn, chỉ Market mint khi có người bán điện thành công
  const token = await deploy("SolarToken", [0]);
  // 2. DeviceRegistry
  const registry = await deploy("DeviceRegistry", []);
  // 3. P2PEnergyMarket
  const market = await deploy("P2PEnergyMarket", [await token.contract.getAddress(), oracleAddress, sessionDuration]);
  const marketAddress = await market.contract.getAddress();

  // 4. Market làm owner của token để mint thưởng
  await track("SolarToken.transferOwnership", (await token.contract.transferOwnership(marketAddress)).wait());
  // 5. Duyệt mô hình dự báo mà backend dùng
  const modelHash = ethers.id(MODEL_ID);
  await track("P2PEnergyMarket.setModelApproved", (await market.contract.setModelApproved(modelHash, true)).wait());
  console.log(`${"Tổng gas".padEnd(34)} gas ${totalGas.toString().padStart(9)}`);

  const entry = async (name, { contract, args }) => ({
    address: await contract.getAddress(),
    args: args.map(String),
    abi: (await hre.artifacts.readArtifact(name)).abi,
  });
  const deployment = {
    network: hre.network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    oracle: oracleAddress,
    modelId: MODEL_ID,
    modelHash,
    sessionDuration,
    SolarToken: await entry("SolarToken", token),
    DeviceRegistry: await entry("DeviceRegistry", registry),
    P2PEnergyMarket: await entry("P2PEnergyMarket", market),
  };

  console.log("\n=== ĐỊA CHỈ CONTRACT ===");
  console.log("SolarToken     :", deployment.SolarToken.address);
  console.log("DeviceRegistry :", deployment.DeviceRegistry.address);
  console.log("P2PEnergyMarket:", deployment.P2PEnergyMarket.address);
  if (hre.network.name === "sepolia") {
    console.log(`Etherscan      : https://sepolia.etherscan.io/address/${deployment.P2PEnergyMarket.address}`);
  }

  // Mạng "hardhat" mất ngay khi script kết thúc nên không ghi file
  if (hre.network.name !== "hardhat") {
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${hre.network.name}.json`);
    fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
    console.log(`\nĐã ghi ${path.relative(process.cwd(), file)} (địa chỉ + ABI cho backend và frontend)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
