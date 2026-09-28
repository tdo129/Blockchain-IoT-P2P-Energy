import React, { useState, useEffect } from 'react';
import TopBar from '../components/TopBar';
import { refs, onValue } from '../firebase';
import { readingsFromSnapshot, tradeState, SAMPLE_SECONDS, STALE_SECONDS } from '../sensor';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import { Sun, Zap, Battery, TrendingUp, Wifi, Cpu, Cloud, Thermometer } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────
const CHART_POINTS = 15; // 15 bản ghi × 15 giây ≈ 4 phút gần nhất

const fmtClock = (seconds) =>
  new Date(seconds * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const fmt = (value, digits = 2) => (value === undefined || value === null ? '--' : Number(value).toFixed(digits));

// Trạng thái giao dịch theo cùng ngưỡng LCD của ESP32
const TRADE_LABEL = {
  SELL: { text: 'SELL · Sẵn sàng bán P2P', className: 'up' },
  BUY:  { text: 'BUY · Thiếu điện, cần mua', className: 'down' },
  BAL:  { text: 'BAL · Cân bằng', className: '' },
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(10,15,25,0.97)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10, padding: '0.75rem 1rem',
    }}>
      <p style={{ color: '#94a3b8', marginBottom: 6, fontSize: '0.8rem' }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, fontSize: '0.875rem', fontWeight: 600 }}>
          {p.name}: {p.value} W
        </p>
      ))}
    </div>
  );
};

export default function Overview() {
  // Các bản ghi mới nhất ESP32 ghi vào sensor_data_history
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ai, setAi] = useState(null);
  const [txToday, setTxToday] = useState(null);
  // Đồng hồ để trạng thái Online/Offline tự đổi khi ESP32 ngừng gửi
  const [now, setNow] = useState(() => Date.now() / 1000);

  // ── Firebase listeners ─────────────────────────────────────────────────
  useEffect(() => {
    // 1. Dữ liệu cảm biến ESP32
    const unsubHistory = onValue(refs.sensorHistory(CHART_POINTS), snap => {
      setReadings(readingsFromSnapshot(snap));
      setLoading(false);
    });

    // 2. Kết quả mô hình AI
    const unsubAi = onValue(refs.aiLatest(), snap => setAi(snap.val()));

    // 3. Số giao dịch trong ngày (mỗi lần khớp có 2 bản ghi bán/mua cùng hash)
    const unsubTx = onValue(refs.transactions(), snap => {
      const startOfDay = new Date().setHours(0, 0, 0, 0) / 1000;
      const hashes = new Set();
      snap.forEach(child => {
        const tx = child.val();
        if (Number(tx?.timestamp) >= startOfDay) hashes.add(tx.hash);
      });
      setTxToday(hashes.size);
    });

    const timer = setInterval(() => setNow(Date.now() / 1000), 5000);

    return () => {
      unsubHistory();
      unsubAi();
      unsubTx();
      clearInterval(timer);
    };
  }, []);

  const latest = readings.at(-1);
  const e      = latest?.electrical  ?? {};
  const env    = latest?.environment ?? {};
  const prodW  = Number(e.p_solar ?? 0);
  const consW  = Number(e.p_load  ?? 0);
  const surpW  = prodW - consW;
  const trade  = TRADE_LABEL[tradeState(surpW)];
  const online = Boolean(latest) && now - latest.time <= STALE_SECONDS;
  const waiting = loading || !latest;

  const chartData = readings.map(r => {
    const p = Number(r.electrical?.p_solar ?? 0);
    const l = Number(r.electrical?.p_load ?? 0);
    return { time: fmtClock(r.time), production: p, consumption: l, surplus: Math.max(0, +(p - l).toFixed(2)) };
  });

  return (
    <div className="page-enter">
      <TopBar title="☀️ Overview" subtitle="Real-time P2P Solar Energy Dashboard · Firebase Live" />

      {/* Firebase Live indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.25rem' }}>
        <div className="dot green" />
        <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Firebase Realtime Database</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>· ESP32 gửi mỗi {SAMPLE_SECONDS} giây (sensor_data_history)</span>
        {latest && (
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Last update: {fmtClock(latest.time)}
          </span>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="card stat-card green animate-delay-1">
          <div className="stat-label"><div className="stat-icon green"><Sun size={16} /></div>Công suất nguồn phát</div>
          {waiting
            ? <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>{loading ? 'Đang kết nối...' : 'Chưa có dữ liệu'}</div>
            : <>
                <div className="stat-value green">{fmt(prodW)}<span className="stat-unit"> W</span></div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {fmt(e.v_solar)} V · {fmt(e.i_solar, 1)} mA · INA219 nguồn phát
                </div>
              </>
          }
        </div>

        <div className="card stat-card blue animate-delay-2">
          <div className="stat-label"><div className="stat-icon blue"><Zap size={16} /></div>Công suất tiêu thụ</div>
          {waiting
            ? <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>{loading ? 'Đang kết nối...' : 'Chưa có dữ liệu'}</div>
            : <>
                <div className="stat-value blue">{fmt(consW)}<span className="stat-unit"> W</span></div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {fmt(e.v_load)} V · {fmt(e.i_load, 1)} mA · INA219 tải tiêu thụ
                </div>
              </>
          }
        </div>

        <div className="card stat-card amber animate-delay-3">
          <div className="stat-label"><div className="stat-icon amber"><Battery size={16} /></div>Điện dư thừa P2P</div>
          {waiting
            ? <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>{loading ? 'Đang kết nối...' : 'Chưa có dữ liệu'}</div>
            : <>
                <div className="stat-value amber">{surpW >= 0 ? '+' : ''}{surpW.toFixed(2)}<span className="stat-unit"> W</span></div>
                <div className={`stat-change ${trade.className}`}>{trade.text}</div>
              </>
          }
        </div>

        <div className="card stat-card purple animate-delay-4">
          <div className="stat-label"><div className="stat-icon purple"><TrendingUp size={16} /></div>Tx hôm nay</div>
          <div className="stat-value purple">{txToday ?? '--'}<span className="stat-unit"> tx</span></div>
          <div className="stat-change">Lần khớp lệnh on-chain</div>
        </div>
      </div>

      {/* ── Chart + AI ── */}
      <div className="grid-7-5" style={{ marginBottom: '1.5rem' }}>
        {/* Area Chart */}
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left">
              <TrendingUp size={18} color="var(--primary)" />
              Công suất thời gian thực (W) — từ Firebase
            </div>
            <div className="legend">
              <span><span className="legend-dot" style={{ background: '#10b981' }} />Nguồn phát</span>
              <span><span className="legend-dot" style={{ background: '#3b82f6' }} />Tiêu thụ</span>
              <span><span className="legend-dot" style={{ background: '#f59e0b' }} />Dư thừa</span>
            </div>
          </div>
          {chartData.length === 0
            ? <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Chờ dữ liệu từ Firebase...
              </div>
            : <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gProd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gCons" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gSurp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#475569" tick={{ fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="production"  name="Nguồn phát" stroke="#10b981" strokeWidth={2} fill="url(#gProd)" />
                  <Area type="monotone" dataKey="consumption" name="Tiêu thụ"   stroke="#3b82f6" strokeWidth={2} fill="url(#gCons)" />
                  <Area type="monotone" dataKey="surplus"     name="Dư thừa"    stroke="#f59e0b" strokeWidth={2} fill="url(#gSurp)" />
                </AreaChart>
              </ResponsiveContainer>
          }
        </div>

        {/* AI Analytics — mô hình AI đọc sensor_data_recent, ghi ai_analytics/latest */}
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><Cpu size={18} color="var(--purple)" /> AI Analytics</div>
          </div>
          {!ai
            ? <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chưa có kết quả từ mô hình AI (ai_analytics/latest)</div>
            : <>
                <div className="ai-badge" style={ai.anomaly_detected ? { color: 'var(--danger)' } : undefined}>
                  <Cpu size={12} /> {ai.status} · {ai.anomaly_detected ? 'Phát hiện bất thường' : 'Hoạt động bình thường'}
                </div>
                <div className="prediction-list">
                  {[
                    { label: 'Công suất dự đoán',  sub: 'predicted_power_w',      value: `${fmt(ai.predicted_power_w)} W` },
                    { label: 'Công suất thực tế',  sub: 'actual_power_w',         value: `${fmt(ai.actual_power_w)} W` },
                    { label: 'Chênh lệch',         sub: 'power_difference_w',     value: `${fmt(ai.power_difference_w)} W` },
                    { label: 'Độ bám dự đoán',     sub: 'tracking_accuracy_pct',  value: `${fmt(ai.tracking_accuracy_pct, 1)} %` },
                  ].map(p => (
                    <div key={p.label} className="pred-item">
                      <div>
                        <div className="pred-time">{p.label}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{p.sub}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="pred-val">{p.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                  Mẫu #{ai.sample_id} lúc {ai.timestamp} · suy luận lúc {ai.inferred_at ?? ai.inferred_time}
                </div>
              </>
          }
        </div>
      </div>

      {/* ── IoT Node + Môi trường ── */}
      <div className="grid-7-5">
        {/* ESP32 — số đo điện của 2 cảm biến INA219 */}
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><Wifi size={18} color="var(--secondary)" /> IoT Node (ESP32 · Firebase)</div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: online ? 'var(--primary)' : 'var(--danger)' }}>
              {online ? <div className="dot green" /> : <div className="dot" style={{ background: 'var(--danger)' }} />}
              {online ? 'Online' : 'Offline'}
            </span>
          </div>

          {(() => {
            const metrics = [
              { label: 'Điện áp phát',   value: fmt(e.v_solar),    unit: 'V',  icon: Zap,     color: 'var(--primary)' },
              { label: 'Dòng phát',      value: fmt(e.i_solar, 1), unit: 'mA', icon: Zap,     color: 'var(--secondary)' },
              { label: 'Công suất phát', value: fmt(e.p_solar),    unit: 'W',  icon: Sun,     color: 'var(--accent)' },
              { label: 'Điện áp tải',    value: fmt(e.v_load),     unit: 'V',  icon: Zap,     color: 'var(--primary)' },
              { label: 'Dòng tải',       value: fmt(e.i_load, 1),  unit: 'mA', icon: Zap,     color: 'var(--secondary)' },
              { label: 'Công suất tải',  value: fmt(e.p_load),     unit: 'W',  icon: Battery, color: 'var(--purple)' },
            ];
            return (
              <>
                {/* Node header card */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '1rem',
                  background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
                  borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem',
                }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 12,
                    background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 20px var(--primary-glow)',
                  }}>
                    <Wifi size={24} color="#fff" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>ESP32 · ESP_P2P</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Solar Panel · mẫu #{latest?.metadata?.sample_id ?? '--'}
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last seen</div>
                    <div style={{ fontSize: '0.85rem', color: online ? 'var(--primary)' : 'var(--danger)' }}>
                      {latest ? fmtClock(latest.time) : 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Metrics grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                  {metrics.map(m => (
                    <div key={m.label} style={{
                      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '0.875rem',
                      display: 'flex', flexDirection: 'column', gap: 4,
                      transition: 'border-color 0.3s',
                    }}>
                      <m.icon size={16} color={m.color} />
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 2 }}>{m.label}</div>
                      <div style={{ fontWeight: 700, fontSize: '1.1rem', color: m.color }}>
                        {m.value}<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 2 }}>{m.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* Môi trường: DHT11, DS18B20 và bức xạ ESP32 ước tính từ công suất phát */}
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><Cloud size={18} color="var(--secondary)" /> Điều Kiện Môi Trường</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {[
              { label: 'Nhiệt độ môi trường', value: `${fmt(env.temp_ambient, 1)} °C`, icon: Thermometer },
              { label: 'Nhiệt độ tấm pin',    value: `${fmt(env.temp_panel, 1)} °C`,   icon: Thermometer },
              { label: 'Bức xạ (ước tính)',   value: `${fmt(env.irradiance, 0)} W/m²`, icon: Sun },
              { label: 'Trạng thái LCD',      value: latest ? tradeState(surpW) : '--', icon: Zap },
            ].map(w => (
              <div key={w.label} style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '1rem',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <w.icon size={20} color="var(--secondary)" />
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 4 }}>{w.label}</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{w.value}</div>
              </div>
            ))}
          </div>
          {/* Mini bar chart */}
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              Công suất nguồn phát (W) — Firebase history
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={chartData.slice(-8)} barSize={12}>
                <Bar dataKey="production" fill="#10b981" radius={[4, 4, 0, 0]} opacity={0.8} />
                <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 9 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
