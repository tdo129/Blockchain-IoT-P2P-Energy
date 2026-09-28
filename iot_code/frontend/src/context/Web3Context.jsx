import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';

const Web3Context = createContext(null);

export function Web3Provider({ children }) {
  const [account, setAccount] = useState('');
  const [balance, setBalance] = useState('');
  const [network, setNetwork] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Đọc số dư ETH + tên mạng của một địa chỉ
  const loadWallet = useCallback(async (acc) => {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const bal = await provider.getBalance(acc);
    const net = await provider.getNetwork();
    setBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
    setNetwork(net.name === 'unknown' ? `Chain ${net.chainId}` : net.name);
  }, []);

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
      await loadWallet(acc);
      setAccount(acc);
      setIsConnected(true);
    } catch (err) {
      console.error('Wallet connection error:', err);
    } finally {
      setIsConnecting(false);
    }
  }, [loadWallet]);

  const disconnect = useCallback(() => {
    setAccount('');
    setBalance('');
    setNetwork('');
    setIsConnected(false);
  }, []);

  /** Gọi lại sau khi nạp/rút ETH để cập nhật số dư trên TopBar và My Wallet */
  const refreshBalance = useCallback(async () => {
    if (account) await loadWallet(account);
  }, [account, loadWallet]);

  // Đổi tài khoản trong MetaMask (vd. từ ví Buyer sang ví Node) thì cập nhật theo; đổi mạng thì tải lại trang
  useEffect(() => {
    if (!window.ethereum?.on || !isConnected) return;
    const onAccountsChanged = (accounts) => {
      if (accounts.length === 0) return disconnect();
      setAccount(accounts[0]);
      loadWallet(accounts[0]).catch(console.error);
    };
    const onChainChanged = () => window.location.reload();
    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', onChainChanged);
    };
  }, [isConnected, disconnect, loadWallet]);

  const shortAddr = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : '';

  return (
    <Web3Context.Provider value={{ account, balance, network, isConnected, isConnecting, connect, disconnect, shortAddr, refreshBalance }}>
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  return useContext(Web3Context);
}
