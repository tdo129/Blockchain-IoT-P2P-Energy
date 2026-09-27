require("@nomicfoundation/hardhat-toolbox");

try {
  process.loadEnvFile(".env");
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

const networks = {};
// Chỉ khai báo Sepolia khi .env có RPC_URL (Alchemy/Infura) và NETWORK=sepolia
if (process.env.NETWORK === "sepolia" && process.env.RPC_URL) {
  networks.sepolia = {
    url: process.env.RPC_URL,
    chainId: 11155111, // trùng chainId frontend yêu cầu trong Web3Context.jsx
    accounts: [process.env.DEPLOYER_PRIVATE_KEY, process.env.ORACLE_PRIVATE_KEY].filter(Boolean),
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks,
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
};
