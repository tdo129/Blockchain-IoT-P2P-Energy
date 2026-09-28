import React from 'react';
import { Wallet, ChevronDown, Bell } from 'lucide-react';
import { useWeb3 } from '../context/Web3Context';

export default function TopBar({ title, subtitle }) {
  const { isConnected, shortAddr, balance, connect, disconnect, isConnecting } = useWeb3();

  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* Notification bell */}
        <button
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', cursor: 'pointer', transition: 'all 0.3s',
          }}
          title="Notifications"
          onClick={() => {}}
        >
          <Bell size={18} />
        </button>

        {/* Wallet Button */}
        {isConnected ? (
          <button className="wallet-btn connected" onClick={disconnect}>
            <div className="dot green" />
            <span>{balance} ETH</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>|</span>
            <span>{shortAddr}</span>
            <ChevronDown size={14} />
          </button>
        ) : (
          <button className="wallet-btn disconnected" onClick={connect} disabled={isConnecting}>
            <Wallet size={18} />
            {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
          </button>
        )}
      </div>
    </div>
  );
}
