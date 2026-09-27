import React, { useState, useEffect } from 'react';
import TopBar from '../components/TopBar';
import { useWeb3 } from '../context/Web3Context';
import { db, onValue, ref, push } from '../firebase';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { TrendingUp, Zap, RefreshCw, CheckCircle, Cpu } from 'lucide-react';

// ── Mock Data ─────────────────────────────────────────────────────────────────
function r(a, b) { return +(a + Math.random() * (b - a)).toFixed(3); }

function genPriceHistory() {
  let p = 0.056;
  return Array.from({ length: 20 }, (_, i) => {
    p = +(p + (Math.random() - 0.48) * 0.002).toFixed(5);
    return { index: i, price: p };
  });
}

const recentTrades = [
  { price: 0.0572, amount: 145, side: 'buy',  time: '12:34:05' },
  { price: 0.0568, amount: 220, side: 'sell', time: '12:33:41' },
  { price: 0.0575, amount: 80,  side: 'buy',  time: '12:33:10' },
  { price: 0.0562, amount: 310, side: 'sell', time: '12:32:55' },
  { price: 0.0580, amount: 60,  side: 'buy',  time: '12:32:20' },
];

const aiSuggest = {
  action: 'SELL',
  price: '0.0575',
  confidence: '91%',
  reason: 'Sản lượng dư thừa dự kiến tăng 18% trong 2h tới. Giá thị trường đang ở đỉnh cục bộ.',
};

export default function EnergyMarket() {
  const { isConnected, connect, account } = useWeb3();
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const [priceHistory, setPriceHistory] = useState(genPriceHistory);
  const [orderType, setOrderType] = useState('buy');
  const [price, setPrice] = useState('0.0575');
  const [amount, setAmount] = useState('');
  const [toast, setToast] = useState(null);

  // ── Firebase listeners ──────────────────────────────────────────────────
  useEffect(() => {
    // Listen market/bids
    const unsubBids = onValue(ref(db, 'market/bids'), snap => {
      if (!snap.exists()) return;
      const raw = snap.val();
      const arr = Array.isArray(raw) ? raw : Object.values(raw);
      setBids(arr.map((o, i) => ({
        id: `B${i}`, type: 'bid',
        price: o.price_ETH, amount: o.amount_kWh,
        total: +(o.price_ETH * o.amount_kWh).toFixed(4),
        addr: o.addr ? `${o.addr.slice(0,8)}...${o.addr.slice(-4)}` : '0x????',
        time: o.timestamp ? `${Math.round((Date.now()/1000 - o.timestamp)/60)}m ago` : '--',
      })));
    });

    // Listen market/asks
    const unsubAsks = onValue(ref(db, 'market/asks'), snap => {
      if (!snap.exists()) return;
      const raw = snap.val();
      const arr = Array.isArray(raw) ? raw : Object.values(raw);
      setAsks(arr.map((o, i) => ({
        id: `A${i}`, type: 'ask',
        price: o.price_ETH, amount: o.amount_kWh,
        total: +(o.price_ETH * o.amount_kWh).toFixed(4),
        addr: o.addr ? `${o.addr.slice(0,8)}...${o.addr.slice(-4)}` : '0x????',
        time: o.timestamp ? `${Math.round((Date.now()/1000 - o.timestamp)/60)}m ago` : '--',
      })));
    });

    // Evolve price chart locally
    const priceId = setInterval(() => {
      setPriceHistory(prev => {
        const last = prev[prev.length - 1].price;
        const next = +(last + (Math.random() - 0.48) * 0.002).toFixed(5);
        return [...prev.slice(1), { index: Date.now(), price: next }];
      });
    }, 4000);

    return () => { unsubBids(); unsubAsks(); clearInterval(priceId); };
  }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleOrder = async () => {
    if (!isConnected) { connect(); return; }
    if (!amount || isNaN(+amount) || +amount <= 0) {
      showToast('Nhập số lượng hợp lệ', 'error'); return;
    }
    
    try {
      showToast('⏳ Đang chờ xác nhận từ MetaMask...', 'info');
      // Tạo giao dịch On-chain thực tế qua MetaMask (gửi 0 ETH để lấy Tx Hash trên Sepolia)
      if (!window.ethereum) throw new Error("Không tìm thấy MetaMask");
      
      const { ethers } = await import('ethers');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      const tx = await signer.sendTransaction({
        to: account,
        value: 0 // Gửi 0 ETH làm dummy transaction mô phỏng gọi Smart Contract
      });
      
      showToast('⏳ Đang chờ xác nhận giao dịch trên mạng lưới (Block)...', 'info');
      await tx.wait(); // Đợi tx được đưa vào block

      const timestamp = Math.floor(Date.now() / 1000);

      // 1. Push lệnh lên Firebase Market
      await push(ref(db, `market/${orderType === 'buy' ? 'bids' : 'asks'}`), {
        type: orderType === 'buy' ? 'bid' : 'ask',
        price_ETH: parseFloat(price),
        amount_kWh: parseFloat(amount),
        addr: account,
        status: 'open',
        timestamp: timestamp,
      });

      // 2. Push giao dịch vào Transactions để theo dõi qua Etherscan
      await push(ref(db, 'transactions'), {
        hash: tx.hash,
        type: orderType === 'buy' ? 'buy' : 'sell',
        amount_kWh: parseFloat(amount),
        value_ETH: orderType === 'buy' ? -parseFloat(price) : parseFloat(price),
        timestamp: timestamp,
        status: 'success'
      });

      showToast(
        `✅ Lệnh ${orderType === 'buy' ? 'MUA' : 'BÁN'} ${amount} kWh @ ${price} ETH đã thành công! Hash: ${tx.hash.slice(0,10)}...`,
        'success'
      );
    } catch (e) {
      console.error(e);
      showToast('❌ Lỗi: ' + (e.reason || e.message), 'error');
    }
    setAmount('');
  };

  const midPrice = ((+bids[0]?.price + +asks[0]?.price) / 2).toFixed(5);
  const spread   = (asks[0]?.price - bids[0]?.price).toFixed(5);

  return (
    <div className="page-enter">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 999,
          background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
          color: toast.type === 'success' ? '#10b981' : '#ef4444',
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
        <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>24h Volume</div><div style={{ color: 'var(--primary)', fontWeight: 600 }}>14,820 kWh</div></div>
        <div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>24h Trades</div><div style={{ color: 'var(--secondary)', fontWeight: 600 }}>312 tx</div></div>
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
            <button onClick={() => { setBids(genBids()); setAsks(genAsks()); }}
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
                <input className="form-input" type="number" min="1"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="Nhập số kWh muốn giao dịch" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                <span>Tổng ước tính:</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>
                  {amount && price ? `${(+price * +amount).toFixed(6)} ETH` : '--'}
                </span>
              </div>
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
            {recentTrades.map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                <span style={{ color: t.side === 'buy' ? 'var(--primary)' : 'var(--danger)', fontWeight: 600 }}>{t.price}</span>
                <span style={{ color: 'var(--text-sub)', fontSize: '0.85rem' }}>{t.amount} kWh</span>
                <span className={`badge ${t.side}`}>{t.side.toUpperCase()}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
