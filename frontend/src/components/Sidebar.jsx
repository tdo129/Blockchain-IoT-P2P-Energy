import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Wallet, List, Sun, Wifi } from 'lucide-react';
import { useWeb3 } from '../context/Web3Context';

const navItems = [
  { to: '/',           icon: LayoutDashboard, label: 'Overview',       badge: null },
  { to: '/market',     icon: TrendingUp,      label: 'Energy Market',  badge: 'Live' },
  { to: '/wallet',     icon: Wallet,          label: 'My Wallet',      badge: null },
  { to: '/transactions', icon: List,          label: 'Transactions',   badge: null },
];

export default function Sidebar() {
  const location = useLocation();
  const { isConnected, network } = useWeb3();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-icon">
          <Sun size={20} color="#fff" />
        </div>
        <div className="logo-text">
          <span className="logo-title">SolarP2P</span>
          <span className="logo-sub">Energy Exchange</span>
        </div>
      </div>

      {/* Nav */}
      <span className="nav-section-label">Navigation</span>
      {navItems.map(({ to, icon: Icon, label, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <Icon size={18} />
          {label}
          {badge && <span className="nav-badge">{badge}</span>}
        </NavLink>
      ))}

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="network-badge">
          <div className={`dot ${isConnected ? 'green' : ''}`} />
          {isConnected ? network || 'Connected' : 'Not Connected'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.25rem' }}>
          <Wifi size={14} color="var(--text-muted)" />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            IoT: 6 Nodes Online
          </span>
        </div>
      </div>
    </aside>
  );
}
