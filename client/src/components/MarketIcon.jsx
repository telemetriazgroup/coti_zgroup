import React from 'react';

/** Bandera de Perú (nacional) o globo (internacional). */
export function MarketIcon({ market, size = 18, className = '' }) {
  const intl = String(market || '').toUpperCase() === 'INTERNACIONAL';
  const title = intl ? 'Mercado internacional' : 'Mercado nacional (Perú)';
  return (
    <span
      className={`market-icon${intl ? ' market-icon--world' : ' market-icon--pe'} ${className}`.trim()}
      title={title}
      aria-label={title}
    >
      {intl ? <WorldGlyph size={size} /> : <PeruFlagGlyph size={size} />}
    </span>
  );
}

function PeruFlagGlyph({ size }) {
  const w = Math.round((size * 22) / 16);
  const h = Math.round((size * 14) / 16);
  return (
    <svg width={w} height={h} viewBox="0 0 9 6" aria-hidden className="market-icon__flag">
      <rect width="3" height="6" fill="#D91023" />
      <rect x="3" width="3" height="6" fill="#FFFFFF" />
      <rect x="6" width="3" height="6" fill="#D91023" />
    </svg>
  );
}

function WorldGlyph({ size }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z" />
    </svg>
  );
}
