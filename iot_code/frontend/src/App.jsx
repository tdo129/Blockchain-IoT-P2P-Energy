import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Web3Provider } from './context/Web3Context';
import Sidebar from './components/Sidebar';
import Overview from './pages/Overview';
import EnergyMarket from './pages/EnergyMarket';
import MyWallet from './pages/MyWallet';
import Transactions from './pages/Transactions';
import './index.css';

export default function App() {
  return (
    <Web3Provider>
      <BrowserRouter>
        <div className="app-shell">
          <Sidebar />
          <main className="main-content">
            <Routes>
              <Route path="/"             element={<Overview />} />
              <Route path="/market"       element={<EnergyMarket />} />
              <Route path="/wallet"       element={<MyWallet />} />
              <Route path="/transactions" element={<Transactions />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </Web3Provider>
  );
}
