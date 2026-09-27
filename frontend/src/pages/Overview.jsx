import React, { useState, useEffect, useRef } from 'react';
import TopBar from '../components/TopBar';
import { db, refs, onValue, ref } from '../firebase';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import { Sun, Zap, Battery, TrendingUp, Wifi, Cpu, Cloud, Wind, Thermometer, Droplets } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────
function rand(a, b, d = 2) { return +(a + Math.random() * (b - a)).toFixed(d); }

const aiPreds = [
  { time: 'Next 1h',  prod: '5.8 kWh',  cons: '2.9 kWh', conf: '94%' },
  { time: 'Next 3h',  prod: '14.2 kWh', cons: '8.7 kWh', conf: '89%' },
  { time: 'Next 6h',  prod: '24.5 kWh', cons: '16.2 kWh', conf: '82%' },
  { time: 'Next 12h', prod: '38.1 kWh', cons: '27.4 kWh', conf: '75%' },
];

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
  // Latest sensor reading from Firebase
  const [sensor, setSensor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState([]);
  const [txCount, setTxCount] = useState(47);

  // Chart history (keep last 15 readings)
  const [chartData, setChartData] = useState([]);
  const chartRef = useRef([]);

  // ── Firebase listeners ─────────────────────────────────────────────────
  useEffect(() => {
    // 1. Listen sensor/latest
    const unsubLatest = onValue(refs.sensorLatest(), snap => {
      if (!snap.exists()) return;
      const data = snap.val();
      setSensor(data);
      setLoading(false);

      // Append to chart (keep last 15)
      const label = new Date(data.timestamp * 1000)
        .toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const entry = {
        time:        label,
        production:  data.nguon_phat?.cong_suat_W ?? 0,
        consumption: data.tai_tieu_thu?.cong_suat_W ?? 0,
        surplus:     Math.max(0, (data.nguon_phat?.cong_suat_W ?? 0) - (data.tai_tieu_thu?.cong_suat_W ?? 0)),
      };
      chartRef.current = [...chartRef.current.slice(-14), entry];
      setChartData([...chartRef.current]);

      // Bump tx counter occasionally
      setTxCount(n => n + (Math.random() > 0.7 ? 1 : 0));
    });

    // 2. Listen iot_nodes
    const unsubNodes = onValue(refs.nodes(), snap => {
      if (!snap.exists()) return;
      const raw = snap.val();
      setNodes(Object.values(raw));
    });

    return () => {
      unsubLatest();
      unsubNodes();
    };
  }, []);

  // Fallback values
  const nguon = sensor?.nguon_phat   ?? {};
  const tai   = sensor?.tai_tieu_thu ?? {};
  const prodW = nguon.cong_suat_W    ?? 0;
  const consW = tai.cong_suat_W      ?? 0;
  const surpW = Math.max(0, prodW - consW);

  return (
    <div className="page-enter">
      <TopBar title="☀️ Overview" subtitle="Real-time P2P Solar Energy Dashboard · Firebase Live" />

      {/* Firebase Live indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.25rem' }}>
        <div className="dot green" />
        <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Firebase Realtime Database</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>· Cập nhật mỗi 5 giây từ IoT Simulator</span>
        {sensor?.timestamp && (
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Last update: {new Date(sensor.timestamp * 1000).toLocaleTimeString('vi-VN')}
          </span>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="card stat-card green animate-delay-1">
          <div className="stat-label"><div className="stat-icon green"><Sun size={16} /></div>Công suất nguồn phát</div>
          {loading
            ? <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Đang kết nối...</div>
            : <>
                <div className="stat-value green">{prodW}<span className="stat-unit"> W</span></div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {nguon.dien_ap_V}V · {nguon.dong_dien_A}A · {nguon.dien_nang_san_xuat_kWh} kWh/ngày
                </div>
              </>
          }
        </div>

        <div className="card stat-card blue animate-delay-2">
          <div className="stat-label"><div className="stat-icon blue"><Zap size={16} /></div>Công suất tiêu thụ</div>
          {loading
            ? <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Đang kết nối...</div>
            : <>
                <div className="stat-value blue">{consW}<span className="stat-unit"> W</span></div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {tai.dien_ap_V}V · {tai.dong_dien_A}A · {tai.dien_nang_tieu_thu_kWh} kWh/ngày
                </div>
              </>
          }
        </div>

        <div className="card stat-card amber animate-delay-3">
          <div className="stat-label"><div className="stat-icon amber"><Battery size={16} /></div>Điện dư thừa P2P</div>
          {loading
            ? <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Đang kết nối...</div>
            : <>
                <div className="stat-value amber">+{surpW.toFixed(2)}<span className="stat-unit"> W</span></div>
                <div className="stat-change up">Sẵn sàng bán P2P</div>
              </>
          }
        </div>

        <div className="card stat-card purple animate-delay-4">
          <div className="stat-label"><div className="stat-icon purple"><TrendingUp size={16} /></div>Tx hôm nay</div>
          <div className="stat-value purple">{txCount}<span className="stat-unit"> tx</span></div>
          <div className="stat-change up">↑ 12% so với hôm qua</div>
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

        {/* AI Predictions */}
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><Cpu size={18} color="var(--purple)" /> AI Forecast (LSTM)</div>
          </div>
          <div className="ai-badge"><Cpu size={12} /> Mô hình LSTM · Độ chính xác 89%</div>
          <div className="prediction-list">
            {aiPreds.map(p => (
              <div key={p.time} className="pred-item">
                <div>
                  <div className="pred-time">{p.time}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    <span className="text-green">↑ {p.prod}</span> / <span className="text-red">↓ {p.cons}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="pred-val">{p.conf}</div>
                  <div className="pred-conf">confidence</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── IoT Node + Weather ── */}
      <div className="grid-7-5">
        {/* Single IoT Node — chi tiết đầy đủ */}
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><Wifi size={18} color="var(--secondary)" /> IoT Node (ESP32 · MQTT)</div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--primary)' }}>
              <div className="dot green" /> Online
            </span>
          </div>

          {(() => {
            const node = nodes[0];
            const fallback = {
              id: 'Node-01', location: 'Solar Panel', online: true,
              output_kW: '--', voltage_V: '--', current_A: '--',
              temp_C: '--', humidity: '--', irradiance_Wm2: '--',
            };
            const n = node || fallback;
            const metrics = [
              { label: 'Điện áp (V)',         value: n.voltage_V,       unit: 'V',    icon: Zap,         color: 'var(--primary)' },
              { label: 'Dòng điện (A)',        value: n.current_A,       unit: 'A',    icon: Zap,         color: 'var(--secondary)' },
              { label: 'Công suất (kW)',       value: n.output_kW,       unit: 'kW',   icon: Sun,         color: 'var(--accent)' },
              { label: 'Nhiệt độ module',      value: n.temp_C,          unit: '°C',   icon: Thermometer, color: 'var(--danger)' },
              { label: 'Độ ẩm',               value: n.humidity,        unit: '%',    icon: Droplets,    color: 'var(--purple)' },
              { label: 'Bức xạ mặt trời',     value: n.irradiance_Wm2, unit: 'W/m²', icon: Sun,         color: 'var(--amber)' },
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
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{n.id}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{n.location}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last seen</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--primary)' }}>
                      {n.last_seen ? new Date(n.last_seen * 1000).toLocaleTimeString('vi-VN') : 'N/A'}
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

        {/* Weather + mini chart */}
        <div className="card">
          <div className="chart-title">
            <div className="chart-title-left"><Cloud size={18} color="var(--secondary)" /> Điều Kiện Thời Tiết</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {[
              { label: 'Nhiệt độ',      value: '32°C',     icon: Sun  },
              { label: 'Mây che phủ',   value: '15%',      icon: Cloud },
              { label: 'Tốc độ gió',    value: '12 km/h',  icon: Wind },
              { label: 'UV Index',      value: '8 / High', icon: Zap  },
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
