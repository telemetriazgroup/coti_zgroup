import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { App } from './App';
import './index.css';

(function initTheme() {
  try {
    const t = localStorage.getItem('zgroup-theme');
    document.documentElement.setAttribute('data-theme', t === 'light' || t === 'dark' ? t : 'dark');
  } catch {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
