import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import TopBar from '../components/TopBar';
import { useWeb3 } from '../context/Web3Context';
import { db, onValue, ref, push } from '../firebase';
import {
  ETHERSCAN_URL, getSepoliaProvider, getContracts, getSignerContracts, orderCostWei, recordTransaction,
} from '../contracts';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { TrendingUp, Zap, RefreshCw, CheckCircle, Cpu } from 'lucide-react';

// ── Mock Data ─────────────────────────────────────────────────────────────────
function genPriceHistory() {
  let p = 0.056;
  return Array.from({ length: 20 }, (_, i) => {
    p = +(p + (Math.random() - 0.48) * 0.002).toFixed(5);
    return { index: i, price: p };
  });
}

const aiSuggest = {
  action: 'SELL',
  price: '0.0575',
  confidence: '91%',
  reason: 'Sản lượng dư thừa dự kiến tăng 18% trong 2h tới. Giá thị trường đang ở đỉnh cục bộ.',
};

// Lệnh trên Firebase -> dòng sổ lệnh. Bỏ lệnh đã khớp ("filled") và lệnh có địa chỉ ví không hợp lệ (không lên chain được)
function toOrderRows(raw, type) {
  const prefix = type === 'bid' ? 'B' : 'A';
  return Object.entries(raw || {})
    .filter(([, o]) => o && o.status === 'open' && ethers.isAddress(o.addr || ''))
    .map(([key, o]) => ({
      id: `${prefix}-${key}`, type,
      price: o.price_ETH, amount: o.amount_kWh,
      total: +(o.price_ETH * o.amount_kWh).toFixed(6),
      addr: o.source === 'iot' ? '⚡ IoT Node' : `${o.addr.slice(0, 8)}...${o.addr.slice(-4)}`,
    }))
    // Mua: giá cao nhất lên đầu; Bán: giá thấp nhất lên đầu (dùng cho Mid Price / Spread)
    .sort((a, b) => (type === 'bid' ? b.price - a.price : a.price - b.price));
}

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function EnergyMarket() {
  const { isConnected, connect, account, refreshBalance } = useWeb3();
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const [trades, setTrades] = useState([]);
  const [session, setSession] = useState(null); // { id, deadline } đọc từ contract
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [priceHistory, setPriceHistory] = useState(genPriceHistory);
  const [orderType, setOrderType] = useState('buy');
  const [price, setPrice] = useState('0.0575');
  const [amount, setAmount] = useState('');
  const [toast, setToast] = useState(null);

  // ── Phiên đấu giá hiện tại trên smart contract ─────────────────────────
  const loadSession = useCallback(async () => {
    const provider = await getSepoliaProvider();
    if (!provider) return setSession(null);
    const { market } = getContracts(provider);
    const [id, deadline] = await Promise.all([market.currentSession(), market.sessionDeadline()]);
    setSession({ id: Number(id), deadline: Number(deadline) });
  }, []);

  useEffect(() => {
    loadSession().catch(console.error);
    const sessionId = setInterval(() => loadSession().catch(console.error), 5000);
    const clockId = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { clearInterval(sessionId); clearInterval(clockId); };
  }, [loadSession, isConnected]);

  // ── Firebase listeners ──────────────────────────────────────────────────
  useEffect(() => {
    const unsubBids = onValue(ref(db, 'market/bids'), snap => setBids(toOrderRows(snap.val(), 'bid')));
    const unsubAsks = onValue(ref(db, 'market/asks'), snap => setAsks(toOrderRows(snap.val(), 'ask')));

    // Kết quả khớp lệnh on-chain do backend ghi: mỗi lần khớp có 1 bản ghi "sell" kèm số phiên
    const unsubTrades = onValue(ref(db, 'transactions'), snap => {
      const rows = Object.values(snap.val() || {})
        .filter(tx => tx && tx.type === 'sell' && tx.session != null)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);
      setTrades(rows);
    });

    // Evolve price chart locally
    const priceId = setInterval(() => {
      setPriceHistory(prev => {
        const last = prev[prev.length - 1].price;
        const next = +(last + (Math.random() - 0.48) * 0.002).toFixed(5);
        return [...prev.slice(1), { index: Date.now(), price: next }];
      });
    }, 4000);

    return () => { unsubBids(); unsubAsks(); unsubTrades(); clearInterval(priceId); };
  }, []);

  const showToast = (msg, type = 'success', ms = 3000) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), ms);
  };

  const handleOrder = async () => {
    if (!isConnected) { connect(); return; }
    if (!amount || isNaN(+amount) || +amount <= 0) {
      showToast('Nhập số lượng hợp lệ', 'error'); return;
    }
    if (!price || isNaN(+price) || +price <= 0) {
      showToast('Nhập giá hợp lệ', 'error'); return;
    }

    try {
      // Lệnh mua: contract trừ tiền từ ETH ký quỹ khi khớp, nên nạp đủ trước khi đặt lệnh
      if (orderType === 'buy') {
        const { market } = await getSignerContracts();
        const cost = orderCostWei(price, amount);
        const deposited = await market.balances(account);
        if (deposited < cost) {
          const missing = cost - deposited;
          showToast(`⏳ Ký quỹ còn thiếu ${ethers.formatEther(missing)} ETH. Xác nhận nạp trong MetaMask...`, 'info', 60000);
          const tx = await market.deposit({ value: missing });
          showToast('⏳ Đang chờ giao dịch nạp ký quỹ vào block...', 'info', 60000);
          const receipt = await tx.wait();
          await recordTransaction(receipt, {
            type: 'transfer',
            value_ETH: -Number(ethers.formatEther(missing)),
            addr: account,
            note: 'Nạp ký quỹ vào sàn',
          });
          refreshBalance().catch(console.error);
        }
      }

      // Backend oracle đọc lệnh này và gửi lên smart contract (submitManualBid / submitManualOffer)
      await push(ref(db, `market/${orderType === 'buy' ? 'bids' : 'asks'}`), {
        type: orderType === 'buy' ? 'bid' : 'ask',
        price_ETH: parseFloat(price),
        amount_kWh: parseFloat(amount),
        addr: account,
        status: 'open',
        timestamp: Math.floor(Date.now() / 1000),
      });

      showToast(
        `✅ Đã đặt lệnh ${orderType === 'buy' ? 'MUA' : 'BÁN'} ${amount} kWh @ ${price} ETH. ` +
        `Lệnh sẽ được đưa lên smart contract và khớp khi hết phiên${session ? ` #${session.id}` : ''}.`,
        'success', 6000
      );
    } catch (e) {
      console.error(e);
      showToast('❌ Lỗi: ' + (e.shortMessage || e.reason || e.message), 'error', 6000);
    }
    setAmount('');
  };

  const midPrice = bids.length && asks.length ? ((+bids[0].price + +asks[0].price) / 2).toFixed(5) : '--';
  const spread   = bids.length && asks.length ? (asks[0].price - bids[0].price).toFixed(5) : '--';
  const secondsLeft = session ? session.deadline - now : null;

  const toastColor = toast?.type === 'success' ? '#10b981' : toast?.type === 'info' ? '#3b82f6' : '#ef4444';

  return (
    <div className="page-enter">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 999,
          background: `${toastColor}26`,
          border: `1px solid ${toastColor}`,
          color: toastColor,
          borderRadius: 12, padding: '0.875rem 1.25rem',
          backdropFilter: 'blur(12px)',
          animation: 'fadeInUp 0.3s ease',
          maxWidth: 380, fontSize: '0.9rem', fontWeight: 500,
        }}>
          {toast.msg}
        </div>
      )}

      <TopBar title="⚡ Energy Market" subtitle="Đấu giá P2P thời gian thực trên Blockchain" />

      {/* Mid price bar */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Mid Price</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff' }}>{midPrice} <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>ETH/kWh</span></div>
        </div>
        <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Spread</div><div style={{ color: 'var(--accent)', fontWeight: 600 }}>{spread} ETH</div></div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Phiên đấu giá</div>
          <div style={{ color: 'var(--primary)', fontWeight: 600 }}>{session ? `#${session.id}` : '--'}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>Khớp lệnh sau</div>
          <div style={{ color: 'var(--secondary)', fontWeight: 600 }}>
            {secondsLeft === null ? 'Kết nối MetaMask (Sepolia)' : secondsLeft > 0 ? formatCountdown(secondsLeft) : 'Đang khớp lệnh...'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--primary)', fontSize: '0.85rem' }}>
          <div className="dot green" />Live Matching Engine
        </div>
      </div>

      {/* ── Main Market Grid ── */}
      <div className="market-grid" style={{ marginBottom: '1.25rem' }}>
        {/* Order Book */}
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><TrendingUp size={18} color="var(--primary)" /> Order Book</div>
            <button onClick={() => loadSession().catch(console.error)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          {/* Asks */}
          <div style={{ marginBottom: 8 }}>
            <div className="order-header">
              <span>Price (ETH)</span><span>Volume (kWh)</span><span>Total (ETH)</span><span>Seller</span>
            </div>
            <div className="order-book">
              {asks.slice().reverse().map(o => (
                <div key={o.id} className="order-row ask">
                  <span className="order-price">{o.price}</span>
                  <span className="order-col">{o.amount}</span>
                  <span className="order-col">{o.total}</span>
                  <span className="order-col font-mono" style={{ fontSize: '0.75rem' }}>{o.addr}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Spread indicator */}
          <div style={{ textAlign: 'center', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, margin: '0.5rem 0', fontSize: '0.85rem' }}>
            <span style={{ color: '#fff', fontWeight: 700 }}>{midPrice} ETH/kWh</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>Spread: {spread}</span>
          </div>

          {/* Bids */}
          <div>
            <div className="order-book">
              {bids.map(o => (
                <div key={o.id} className="order-row bid">
                  <span className="order-price">{o.price}</span>
                  <span className="order-col">{o.amount}</span>
                  <span className="order-col">{o.total}</span>
                  <span className="order-col font-mono" style={{ fontSize: '0.75rem' }}>{o.addr}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Place Order + AI */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* AI Suggestion */}
          <div className="card" style={{ borderColor: 'rgba(139,92,246,0.3)', boxShadow: '0 0 20px rgba(139,92,246,0.08)' }}>
            <div className="ai-badge"><Cpu size={12} /> AI Gợi ý Lệnh Tối Ưu</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ef4444' }}>{aiSuggest.action}</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff' }}>{aiSuggest.price} ETH/kWh</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--purple)' }}>Confidence: {aiSuggest.confidence}</div>
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6, background: 'rgba(139,92,246,0.06)', borderRadius: 8, padding: '0.75rem' }}>
              {aiSuggest.reason}
            </div>
          </div>

          {/* Place Order Form */}
          <div className="card">
            <div className="chart-title">
              <div className="chart-title-left"><Zap size={18} color="var(--accent)" /> Đặt Lệnh</div>
            </div>

            <div className="form-tabs">
              <button className={`tab-btn ${orderType === 'buy' ? 'active-buy' : ''}`} onClick={() => setOrderType('buy')}>
                🟢 Mua điện (BID)
              </button>
              <button className={`tab-btn ${orderType === 'sell' ? 'active-sell' : ''}`} onClick={() => setOrderType('sell')}>
                🔴 Bán điện (ASK)
              </button>
            </div>

            <div className="order-form">
              <div className="form-group">
                <label className="form-label">Giá (ETH/kWh)</label>
                <input className="form-input" type="number" step="0.0001"
                  value={price} onChange={e => setPrice(e.target.value)}
                  placeholder="0.0575" />
              </div>
              <div className="form-group">
                <label className="form-label">Số lượng (kWh)</label>
                <input className="form-input" type="number" min="0.001" step="0.001"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="Nhập số kWh muốn giao dịch" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                <span>Tổng ước tính:</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>
                  {amount && price ? `${(+price * +amount).toFixed(6)} ETH` : '--'}
                </span>
              </div>
              {orderType === 'buy' && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                  Nếu ETH ký quỹ trên sàn chưa đủ, MetaMask sẽ hỏi nạp phần còn thiếu vào smart contract.
                </div>
              )}
              <button className={`submit-btn ${orderType}`} onClick={handleOrder}>
                {isConnected
                  ? (orderType === 'buy' ? '✅ Gửi lệnh MUA lên Smart Contract' : '✅ Gửi lệnh BÁN lên Smart Contract')
                  : '🔗 Kết nối MetaMask để giao dịch'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom: Price Chart + Recent Trades ── */}
      <div className="grid-7-5">
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><TrendingUp size={18} color="var(--secondary)" /> Biểu Đồ Giá Điện P2P</div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={priceHistory} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis hide />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: 'rgba(10,15,25,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}
                formatter={v => [`${v} ETH/kWh`, 'Price']}
                labelFormatter={() => ''}
              />
              <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><CheckCircle size={18} color="var(--primary)" /> Khớp Lệnh Gần Nhất</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {trades.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}>
                Chưa có lệnh nào được khớp trên smart contract.
              </div>
            )}
            {trades.map((t, i) => (
              <a key={`${t.hash}-${i}`} href={`${ETHERSCAN_URL}/tx/${t.hash}`} target="_blank" rel="noreferrer"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{t.price_ETH}</span>
                <span style={{ color: 'var(--text-sub)', fontSize: '0.85rem' }}>{t.amount_kWh} kWh</span>
                <span className="badge success">Phiên #{t.session}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {new Date(t.timestamp * 1000).toLocaleTimeString('vi-VN')}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
