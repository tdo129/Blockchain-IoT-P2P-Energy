import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import TopBar from '../components/TopBar';
import { useWeb3 } from '../context/Web3Context';
import { db, onValue, ref } from '../firebase';
import {
  ETHERSCAN_URL, MARKET_ADDRESS, TOKEN_ADDRESS,
  getSepoliaProvider, getContracts, getSignerContracts, recordTransaction,
} from '../contracts';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Send, ExternalLink, Copy, ShieldCheck } from 'lucide-react';

const actions = [
  { icon: ArrowDownToLine, label: 'Nạp ETH', mode: 'deposit' },
  { icon: ArrowUpFromLine, label: 'Rút ETH', mode: 'withdraw' },
  { icon: Send,            label: 'Gửi Token' },
  { icon: RefreshCw,       label: 'Swap' },
];

const ACTIVITY_STYLE = {
  sell:     { icon: '⚡', label: 'Bán điện P2P', color: 'var(--primary)' },
  buy:      { icon: '🛒', label: 'Mua điện P2P', color: 'var(--danger)' },
  transfer: { icon: '🔄', label: 'Chuyển ETH',   color: 'var(--accent)' },
};

function timeAgo(ts) {
  const minutes = Math.round((Date.now() / 1000 - ts) / 60);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  return new Date(ts * 1000).toLocaleString('vi-VN');
}

export default function MyWallet() {
  const { isConnected, connect, account, balance, network, refreshBalance } = useWeb3();

  // ── Số dư đọc từ smart contract ──────────────────────────────────────────
  const [escrow, setEscrow] = useState(null);   // ETH ký quỹ trong P2PEnergyMarket (wei)
  const [slr, setSlr] = useState(null);         // token thưởng SLR (đơn vị nhỏ nhất, 3 decimals)
  const [chainError, setChainError] = useState('');
  const [activity, setActivity] = useState([]);

  // ── Form nạp/rút ─────────────────────────────────────────────────────────
  const [mode, setMode] = useState(null);       // 'deposit' | 'withdraw' | null
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);   // { type: 'info' | 'success' | 'error', msg }

  const loadOnchain = useCallback(async () => {
    if (!account) return;
    const provider = await getSepoliaProvider();
    if (!provider) {
      setChainError('MetaMask chưa ở mạng Sepolia, không đọc được số dư trên contract.');
      return;
    }
    const { market, token } = getContracts(provider);
    const [deposit, reward] = await Promise.all([market.balances(account), token.balanceOf(account)]);
    setEscrow(deposit);
    setSlr(reward);
    setChainError('');
  }, [account]);

  useEffect(() => {
    loadOnchain().catch(err => setChainError(err.shortMessage || err.message));
  }, [loadOnchain]);

  // Hoạt động của đúng ví này: giao dịch khớp lệnh do backend ghi + nạp/rút do trang này ghi
  useEffect(() => {
    if (!account) return;
    const unsub = onValue(ref(db, 'transactions'), snap => {
      const raw = snap.val() || {};
      const mine = Object.values(raw)
        .filter(tx => tx && tx.addr && tx.addr.toLowerCase() === account.toLowerCase())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);
      setActivity(mine);
    });
    return () => unsub();
  }, [account]);

  const copyAddress = () => {
    if (account) navigator.clipboard.writeText(account);
  };

  const openForm = (next) => {
    if (!next) return;
    setMode(next);
    setAmount('');
    setStatus(null);
  };

  const submit = async () => {
    if (!amount || isNaN(+amount) || +amount <= 0) {
      setStatus({ type: 'error', msg: 'Nhập số ETH hợp lệ' });
      return;
    }
    const value = ethers.parseEther(amount);
    if (mode === 'withdraw' && escrow !== null && value > escrow) {
      setStatus({ type: 'error', msg: `Chỉ rút được tối đa ${ethers.formatEther(escrow)} ETH` });
      return;
    }
    setBusy(true);
    try {
      const { market } = await getSignerContracts();
      setStatus({ type: 'info', msg: '⏳ Xác nhận giao dịch trong MetaMask...' });
      const tx = mode === 'deposit' ? await market.deposit({ value }) : await market.withdraw(value);
      setStatus({ type: 'info', msg: '⏳ Đang chờ giao dịch được đưa vào block...' });
      const receipt = await tx.wait();
      await recordTransaction(receipt, {
        type: 'transfer',
        value_ETH: mode === 'deposit' ? -Number(amount) : Number(amount),
        addr: account,
        note: mode === 'deposit' ? 'Nạp ký quỹ vào sàn' : 'Rút ký quỹ về ví',
      });
      await Promise.all([loadOnchain(), refreshBalance()]);
      setStatus({ type: 'success', msg: `✅ Đã ${mode === 'deposit' ? 'nạp' : 'rút'} ${amount} ETH. Tx: ${receipt.hash.slice(0, 10)}...` });
      setAmount('');
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: '❌ ' + (err.shortMessage || err.reason || err.message) });
    } finally {
      setBusy(false);
    }
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

  const fmtEscrow = escrow === null ? '--' : ethers.formatEther(escrow);
  const tokens = [
    { symbol: 'ETH', name: 'ETH trong ví MetaMask', amount: balance, note: network || 'Sepolia', color: '#627EEA', bg: 'rgba(98,126,234,0.15)',
      link: `${ETHERSCAN_URL}/address/${account}` },
    { symbol: 'ESC', name: 'ETH ký quỹ trên sàn', amount: fmtEscrow, note: 'Dùng để trả tiền mua điện', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',
      link: `${ETHERSCAN_URL}/address/${MARKET_ADDRESS}` },
    { symbol: 'SLR', name: 'Solar Token (thưởng)', amount: slr === null ? '--' : ethers.formatUnits(slr, 3), note: '1 SLR / kWh bán được', color: '#10b981', bg: 'rgba(16,185,129,0.15)',
      link: `${ETHERSCAN_URL}/token/${TOKEN_ADDRESS}?a=${account}` },
  ];

  const statusColor = status?.type === 'success' ? '#10b981' : status?.type === 'error' ? '#ef4444' : 'var(--secondary)';

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
            href={`${ETHERSCAN_URL}/address/${account}`}
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
          {actions.map(({ icon: Icon, label, mode: actionMode }) => (
            <button key={label} className="action-btn" onClick={() => openForm(actionMode)}>
              <div className="action-btn-icon"><Icon size={18} /></div>
              {label}
            </button>
          ))}
        </div>

        {/* Form nạp/rút ký quỹ: gọi deposit() / withdraw() của P2PEnergyMarket */}
        {mode && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {mode === 'deposit' ? 'Nạp ETH ký quỹ vào sàn' : 'Rút ETH ký quỹ về ví'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>
              {mode === 'deposit'
                ? 'Ký quỹ dùng để trả tiền khi lệnh mua điện của bạn được khớp.'
                : `Tiền bán điện và ký quỹ chưa dùng. Hiện có ${fmtEscrow} ETH.`}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="form-input" type="number" step="0.001" min="0" placeholder="Số ETH"
                value={amount} onChange={e => setAmount(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              {mode === 'withdraw' && escrow !== null && (
                <button className="filter-btn" onClick={() => setAmount(ethers.formatEther(escrow))}>Tối đa</button>
              )}
              <button className={`submit-btn ${mode === 'deposit' ? 'buy' : 'sell'}`} style={{ width: 'auto', padding: '0.7rem 1.5rem' }}
                onClick={submit} disabled={busy}>
                {busy ? 'Đang xử lý...' : mode === 'deposit' ? 'Nạp' : 'Rút'}
              </button>
              <button className="filter-btn" onClick={() => setMode(null)} disabled={busy}>Hủy</button>
            </div>
            {status && <div style={{ marginTop: 10, fontSize: '0.85rem', color: statusColor }}>{status.msg}</div>}
          </div>
        )}
      </div>

      {/* ── Token Balances ── */}
      <h3 style={{ fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.8rem' }}>
        Token & Assets
      </h3>
      {chainError && (
        <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{chainError}</div>
      )}
      <div className="token-grid" style={{ marginBottom: '1.5rem' }}>
        {tokens.map(tok => (
          <a key={tok.symbol} className="token-card" href={tok.link} target="_blank" rel="noreferrer">
            <div className="token-icon" style={{ background: tok.bg, color: tok.color }}>
              {tok.symbol.slice(0, 2)}
            </div>
            <div className="token-name">{tok.name}</div>
            <div className="token-amount" style={{ color: tok.color }}>{tok.amount}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 2 }}>{tok.note}</div>
          </a>
        ))}
      </div>

      {/* ── Recent Activity ── */}
      <div className="card">
        <div className="chart-title" style={{ marginBottom: '1rem' }}>
          <div className="chart-title-left">📋 Hoạt Động Gần Đây</div>
          <a href={`${ETHERSCAN_URL}/address/${account}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--secondary)' }}>
            Xem tất cả →
          </a>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {activity.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.75rem 1rem' }}>
              Chưa có giao dịch nào của ví này.
            </div>
          )}
          {activity.map((a, i) => {
            const style = ACTIVITY_STYLE[a.type] || ACTIVITY_STYLE.transfer;
            const value = a.value_ETH ? `${a.value_ETH > 0 ? '+' : ''}${a.value_ETH} ETH` : '--';
            return (
              <a key={`${a.hash}-${i}`} href={`${ETHERSCAN_URL}/tx/${a.hash}`} target="_blank" rel="noreferrer" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)',
                borderRadius: 10, transition: 'background 0.3s', color: 'inherit',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                  }}>{style.icon}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {a.note || style.label}{a.amount_kWh ? ` · ${a.amount_kWh} kWh` : ''}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{timeAgo(a.timestamp)}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: style.color }}>{value}</div>
                  <span className={`badge ${a.status || 'success'}`} style={{ fontSize: '0.7rem' }}>
                    {a.status === 'failed' ? '✗ Failed' : '✓ Confirmed'}
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
