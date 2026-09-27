import React, { useState, useEffect } from 'react';
import TopBar from '../components/TopBar';
import { db, onValue, ref } from '../firebase';
import { ExternalLink, Search, Download, ArrowUpRight, ArrowDownLeft, RefreshCw, CheckCircle, Clock, XCircle } from 'lucide-react';

const FALLBACK_TXS = [
  { hash: '0x3a4b9c1d2e5f...8a0b', type: 'buy',  label: 'Mua điện P2P',      amount: '145 kWh',  value: '-0.0572 ETH', fee: '0.0003 ETH', block: 18_420_312, time: '2026-09-27 09:15:02', status: 'success', from: '0x1234...5678', to: '0xABCD...EF01' },
  { hash: '0x8f2e4a0b1c3d...9e7f', type: 'sell', label: 'Bán điện P2P',      amount: '220 kWh',  value: '+0.0568 ETH', fee: '0.0004 ETH', block: 18_420_280, time: '2026-09-27 08:53:41', status: 'success', from: '0xABCD...EF01', to: '0x8888...1234' },
  { hash: '0x1c9d3b2a4e6f...0d1e', type: 'buy',  label: 'Mua điện P2P',      amount: '80 kWh',   value: '-0.0460 ETH', fee: '0.0002 ETH', block: 18_420_155, time: '2026-09-27 08:33:10', status: 'success', from: '0x1234...5678', to: '0x3344...AABB' },
  { hash: '0xfe2d8c1a3b9e...6c4f', type: 'sell', label: 'Bán điện P2P',      amount: '310 kWh',  value: '+0.1740 ETH', fee: '0.0005 ETH', block: 18_420_030, time: '2026-09-27 08:12:55', status: 'success', from: '0xABCD...EF01', to: '0x5566...7788' },
  { hash: '0x5b3e7f9a2c1d...4b8e', type: 'buy',  label: 'Mua điện P2P',      amount: '60 kWh',   value: '-0.0348 ETH', fee: '0.0002 ETH', block: 18_419_992, time: '2026-09-27 07:52:20', status: 'pending', from: '0x1234...5678', to: '0x9900...CCDD' },
  { hash: '0xa1b2c3d4e5f6...7890', type: 'transfer', label: 'Nhận ETH',      amount: '--',       value: '+0.5 ETH',   fee: '0.0001 ETH', block: 18_419_800, time: '2026-09-26 22:10:00', status: 'success', from: '0xDEAD...BEEF', to: '0xABCD...EF01' },
  { hash: '0x2c4e6a8d0f1b...3d5e', type: 'sell', label: 'Bán điện P2P',      amount: '180 kWh',  value: '+0.1044 ETH', fee: '0.0004 ETH', block: 18_419_550, time: '2026-09-26 19:05:33', status: 'failed',  from: '0xABCD...EF01', to: '0x7788...AABB' },
  { hash: '0x0e2f4d6c8a0b...2e4f', type: 'buy',  label: 'Đấu giá thắng',     amount: '500 kWh',  value: '-0.2875 ETH', fee: '0.0008 ETH', block: 18_419_400, time: '2026-09-26 16:44:18', status: 'success', from: '0x1234...5678', to: '0xCCDD...EEFF' },
];

const STATUS_ICON = {
  success: <CheckCircle size={14} />,
  pending: <Clock size={14} />,
  failed:  <XCircle size={14} />,
};

const TYPE_ICON = {
  buy:      <ArrowDownLeft size={14} color="var(--primary)" />,
  sell:     <ArrowUpRight size={14} color="var(--danger)" />,
  transfer: <RefreshCw size={14} color="var(--secondary)" />,
};

export default function Transactions() {
  const [allTxs, setAllTxs]   = useState(FALLBACK_TXS);
  const [filter, setFilter]   = useState('all');
  const [search, setSearch]   = useState('');

  // ── Firebase listener ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onValue(ref(db, 'transactions'), snap => {
      if (!snap.exists()) return;
      const raw = snap.val();
      const arr = Array.isArray(raw) ? raw : Object.values(raw);
      const mapped = arr.map((tx, i) => ({
        hash:   tx.hash || `0x${Math.random().toString(16).slice(2, 18)}`,
        type:   tx.type || 'buy',
        label:  tx.type === 'sell' ? 'Bán điện P2P' : tx.type === 'transfer' ? 'Chuyển ETH' : 'Mua điện P2P',
        amount: tx.amount_kWh ? `${tx.amount_kWh} kWh` : '--',
        value:  tx.value_ETH  ? `${tx.value_ETH > 0 ? '+' : ''}${tx.value_ETH} ETH` : '--',
        fee:    '0.0003 ETH',
        block:  tx.block || 18_420_000 + i,
        time:   tx.timestamp
          ? new Date(tx.timestamp * 1000).toLocaleString('vi-VN')
          : '--',
        status: tx.status || 'success',
      }));
      setAllTxs(mapped.reverse()); // newest first
    });
    return () => unsub();
  }, []);

  const filtered = allTxs.filter(tx => {
    const matchType   = filter === 'all' || tx.type === filter;
    const matchSearch = !search ||
      tx.hash.toLowerCase().includes(search.toLowerCase()) ||
      tx.label.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const stats = {
    total:   allTxs.length,
    success: allTxs.filter(t => t.status === 'success').length,
    pending: allTxs.filter(t => t.status === 'pending').length,
    failed:  allTxs.filter(t => t.status === 'failed').length,
  };

  return (
    <div className="page-enter">
      <TopBar title="📋 Transactions" subtitle="Lịch sử giao dịch On-chain · Etherscan truy vết" />

      {/* ── Summary Cards ── */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="card stat-card green">
          <div className="stat-label"><div className="stat-icon green"><CheckCircle size={16} /></div> Thành Công</div>
          <div className="stat-value green">{stats.success}</div>
        </div>
        <div className="card stat-card amber">
          <div className="stat-label"><div className="stat-icon amber"><Clock size={16} /></div> Đang Chờ</div>
          <div className="stat-value amber">{stats.pending}</div>
        </div>
        <div className="card stat-card purple">
          <div className="stat-label"><div className="stat-icon purple"><RefreshCw size={16} /></div> Tổng Giao Dịch</div>
          <div className="stat-value purple">{stats.total}</div>
        </div>
        <div className="card stat-card blue">
          <div className="stat-label"><div className="stat-icon blue"><ArrowUpRight size={16} /></div> Tổng Volume</div>
          <div className="stat-value blue">1,495<span className="stat-unit"> kWh</span></div>
        </div>
      </div>

      {/* ── Filter & Search Bar ── */}
      <div className="filters-bar">
        {['all', 'buy', 'sell', 'transfer'].map(f => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? '🔍 Tất cả' : f === 'buy' ? '🟢 Mua' : f === 'sell' ? '🔴 Bán' : '🔵 Chuyển'}
          </button>
        ))}
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            className="search-input"
            style={{ paddingLeft: '2.25rem', width: '100%' }}
            placeholder="Tìm theo Tx Hash hoặc loại giao dịch..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '0.45rem 1rem',
          borderRadius: 9999, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
          color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
        }}>
          <Download size={14} /> Xuất CSV
        </button>
      </div>

      {/* ── Transaction Table ── */}
      <div className="card">
        <div className="tx-table-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Tx Hash</th>
                <th>Loại</th>
                <th>Số Lượng</th>
                <th>Giá Trị</th>
                <th>Phí Gas</th>
                <th>Block</th>
                <th>Thời Gian</th>
                <th>Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    Không tìm thấy giao dịch nào
                  </td>
                </tr>
              ) : filtered.map(tx => {
                const shortHash = tx.hash.length > 25 ? `${tx.hash.slice(0, 8)}...${tx.hash.slice(-6)}` : tx.hash;
                return (
                <tr key={tx.hash}>
                  <td>
                    <a
                      className="tx-hash-link"
                      href={`https://sepolia.etherscan.io/tx/${tx.hash}`}
                      target="_blank" rel="noreferrer"
                    >
                      {shortHash} <ExternalLink size={12} />
                    </a>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {TYPE_ICON[tx.type]}
                      <span className={`badge ${tx.type}`}>{tx.label}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text)' }}>{tx.amount}</td>
                  <td>
                    <span style={{
                      fontWeight: 600,
                      color: tx.value.startsWith('+') ? 'var(--primary)' : tx.value.startsWith('-') ? 'var(--danger)' : 'var(--text)',
                    }}>
                      {tx.value}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{tx.fee}</td>
                  <td>
                    <a
                      className="tx-hash-link"
                      href={`https://sepolia.etherscan.io/block/${tx.block}`}
                      target="_blank" rel="noreferrer"
                      style={{ fontSize: '0.8rem' }}
                    >
                      #{tx.block.toLocaleString()}
                    </a>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{tx.time}</td>
                  <td>
                    <span className={`badge ${tx.status}`}>
                      {STATUS_ICON[tx.status]} {tx.status === 'success' ? 'Thành công' : tx.status === 'pending' ? 'Đang xử lý' : 'Thất bại'}
                    </span>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>

        {/* Pagination placeholder */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Hiển thị {filtered.length} / {allTxs.length} giao dịch</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[1, 2, 3].map(p => (
              <button key={p} style={{
                width: 32, height: 32, borderRadius: 8,
                background: p === 1 ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.04)',
                border: p === 1 ? '1px solid rgba(16,185,129,0.4)' : '1px solid var(--border)',
                color: p === 1 ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
              }}>{p}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Etherscan note ── */}
      <div style={{
        marginTop: '1.25rem', padding: '0.875rem 1.25rem',
        background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
        borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10,
        fontSize: '0.85rem', color: 'var(--text-muted)',
      }}>
        <ExternalLink size={16} color="var(--secondary)" />
        Tất cả giao dịch được truy vết On-chain qua&nbsp;
        <a href="https://sepolia.etherscan.io" target="_blank" rel="noreferrer" style={{ color: 'var(--secondary)', fontWeight: 600 }}>
          Sepolia Etherscan
        </a>
        . Nhấn vào Tx Hash để xem chi tiết đầy đủ.
      </div>
    </div>
  );
}
