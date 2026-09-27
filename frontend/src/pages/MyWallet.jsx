import React from 'react';
import TopBar from '../components/TopBar';
import { useWeb3 } from '../context/Web3Context';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Send, ExternalLink, Copy, ShieldCheck } from 'lucide-react';

const tokens = [
  { symbol: 'ETH',   name: 'Ethereum',        amount: '1.2450', usd: '$3,210.15',  color: '#627EEA', bg: 'rgba(98,126,234,0.15)' },
  { symbol: 'SLR',   name: 'Solar Token',      amount: '4,580',  usd: '$229.00',    color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  { symbol: 'MATIC', name: 'Polygon MATIC',    amount: '850',    usd: '$680.00',    color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
];

const activity = [
  { icon: '⚡', label: 'Bán điện P2P',   amount: '+0.05 ETH',  color: 'var(--primary)',   time: '2 phút trước',  status: 'success' },
  { icon: '🛒', label: 'Mua điện P2P',   amount: '-0.032 ETH', color: 'var(--danger)',    time: '18 phút trước', status: 'success' },
  { icon: '🏆', label: 'Thưởng SLR',     amount: '+120 SLR',   color: 'var(--purple)',    time: '1 giờ trước',   status: 'success' },
  { icon: '⚡', label: 'Bán điện P2P',   amount: '+0.072 ETH', color: 'var(--primary)',   time: '3 giờ trước',   status: 'success' },
  { icon: '🔄', label: 'Swap ETH→SLR',   amount: '0.2 ETH',    color: 'var(--accent)',    time: '5 giờ trước',   status: 'success' },
];

const actions = [
  { icon: ArrowDownToLine, label: 'Nạp ETH' },
  { icon: ArrowUpFromLine, label: 'Rút ETH' },
  { icon: Send,            label: 'Gửi Token' },
  { icon: RefreshCw,       label: 'Swap' },
];

export default function MyWallet() {
  const { isConnected, connect, account, balance, network, shortAddr } = useWeb3();

  const copyAddress = () => {
    if (account) navigator.clipboard.writeText(account);
  };

  if (!isConnected) {
    return (
      <div className="page-enter">
        <TopBar title="💳 My Wallet" subtitle="Quản lý tài sản và Token năng lượng" />
        <div className="card" style={{ textAlign: 'center', padding: '4rem', marginTop: '2rem' }}>
          <Wallet size={64} color="var(--text-muted)" style={{ margin: '0 auto 1.5rem' }} />
          <h2 style={{ marginBottom: 8, color: 'var(--text)' }}>Chưa kết nối ví</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
            Kết nối MetaMask để xem số dư và quản lý tài sản của bạn.
          </p>
          <button className="wallet-btn disconnected" style={{ margin: '0 auto', padding: '0.75rem 2rem' }} onClick={connect}>
            <Wallet size={20} />
            Kết nối MetaMask
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <TopBar title="💳 My Wallet" subtitle="Quản lý tài sản và Token năng lượng" />

      {/* ── Hero ── */}
      <div className="wallet-hero">
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          Total Portfolio Value
        </div>
        <div className="eth-balance">{balance} ETH</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>≈ $3,210.15 USD</div>

        <div className="wallet-address-display">
          {account}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginTop: 4 }}>
          <button onClick={copyAddress} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
            borderRadius: 9999, padding: '0.35rem 0.875rem', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', cursor: 'pointer',
          }}>
            <Copy size={13} /> Sao chép địa chỉ
          </button>
          <a
            href={`https://sepolia.etherscan.io/address/${account}`}
            target="_blank" rel="noreferrer"
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
              borderRadius: 9999, padding: '0.35rem 0.875rem', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem',
            }}>
            <ExternalLink size={13} /> Xem trên Etherscan
          </a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: 12 }}>
          <span className="badge success"><ShieldCheck size={11} /> {network || 'Sepolia'}</span>
          <span style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--primary)', padding: '0.15rem 0.6rem', borderRadius: 9999, fontSize: '0.75rem', fontWeight: 600 }}>
            EVM Compatible
          </span>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem 2rem' }}>
        <div className="action-buttons">
          {actions.map(({ icon: Icon, label }) => (
            <button key={label} className="action-btn">
              <div className="action-btn-icon"><Icon size={18} /></div>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Token Balances ── */}
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.8rem' }}>
        Token & Assets
      </h3>
      <div className="token-grid" style={{ marginBottom: '1.5rem' }}>
        {tokens.map(tok => (
          <div key={tok.symbol} className="token-card">
            <div className="token-icon" style={{ background: tok.bg, color: tok.color }}>
              {tok.symbol.slice(0, 2)}
            </div>
            <div className="token-name">{tok.name}</div>
            <div className="token-amount" style={{ color: tok.color }}>{tok.amount}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 2 }}>{tok.usd}</div>
          </div>
        ))}
      </div>

      {/* ── Recent Activity ── */}
      <div className="card">
        <div className="chart-title" style={{ marginBottom: '1rem' }}>
          <div className="chart-title-left">📋 Hoạt Động Gần Đây</div>
          <span style={{ fontSize: '0.8rem', color: 'var(--secondary)', cursor: 'pointer' }}>Xem tất cả →</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {activity.map((a, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)',
              borderRadius: 10, transition: 'background 0.3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                }}>{a.icon}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.label}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{a.time}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: a.color }}>{a.amount}</div>
                <span className="badge success" style={{ fontSize: '0.7rem' }}>✓ Confirmed</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
