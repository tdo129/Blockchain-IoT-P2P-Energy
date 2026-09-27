import React, { createContext, useContext, useState, useCallback } from 'react';
import { ethers } from 'ethers';

const Web3Context = createContext(null);

export function Web3Provider({ children }) {
  const [account, setAccount] = useState('');
  const [balance, setBalance] = useState('');
  const [network, setNetwork] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert('Vui lòng cài MetaMask để sử dụng ứng dụng này!');
      return;
    }
    setIsConnecting(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const acc = accounts[0];

      // Đảm bảo ở mạng Sepolia (Chain ID: 11155111 / 0xaa36a7)
      const networkData = await provider.getNetwork();
      if (networkData.chainId !== 11155111n) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0xaa36a7' }],
          });
        } catch (switchError) {
          console.error("Failed to switch to Sepolia", switchError);
          alert('Vui lòng chuyển mạng MetaMask sang Sepolia để sử dụng!');
        }
      }

      // Lấy provider mới sau khi (có thể) chuyển mạng
      const updatedProvider = new ethers.BrowserProvider(window.ethereum);
      const bal = await updatedProvider.getBalance(acc);
      const net = await updatedProvider.getNetwork();
      
      setAccount(acc);
      setBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
      setNetwork(net.name === 'unknown' ? `Chain ${net.chainId}` : net.name);
      setIsConnected(true);
    } catch (err) {
      console.error('Wallet connection error:', err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount('');
    setBalance('');
    setNetwork('');
    setIsConnected(false);
  }, []);

  const shortAddr = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : '';

  return (
    <Web3Context.Provider value={{ account, balance, network, isConnected, isConnecting, connect, disconnect, shortAddr }}>
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  return useContext(Web3Context);
}
