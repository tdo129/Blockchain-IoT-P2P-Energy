// Verify source code 3 contract trên Etherscan để ai cũng đọc được code và gọi deposit()/withdraw() qua tab "Write Contract"
// Chạy: npm run verify:sepolia   (cần ETHERSCAN_API_KEY trong .env)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));

  for (const name of ["SolarToken", "DeviceRegistry", "P2PEnergyMarket"]) {
    const { address, args } = deployment[name];
    console.log(`Verify ${name} tại ${address}...`);
    try {
      await hre.run("verify:verify", { address, constructorArguments: args });
    } catch (err) {
      if (!/already verified/i.test(err.message)) throw err;
      console.log("  đã verify từ trước");
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
