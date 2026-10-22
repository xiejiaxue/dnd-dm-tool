import type { ReactNode } from 'react';

const shapes = {
  grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
  dice: <path d="m12 2 9 6v9l-9 5-9-5V8l9-6Zm0 0L7 15h10L12 2ZM3 8l4 7 5 7 5-7 4-7M3 17l4-2m10 0 4 2"/>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  plus: <path d="M12 4v16M4 12h16"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/></>,
  refresh: <path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>,
  select: <path d="m5 3 14 10-7 1-3 7-4-18Z"/>,
  wall: <><rect x="3" y="4" width="18" height="16"/><path d="M3 10h18M3 15h18M9 4v6m6 0v5m-6 0v5"/></>,
  erase: <path d="m4 13 8-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-7 8H9l-5-4a3 3 0 0 1 0-4Zm4-4 10 9M9 20h12"/>,
  map: <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>,
} satisfies Record<string, ReactNode>;
export type IconName = keyof typeof shapes;
export default function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

export function DiceArtwork() {
  return <div className="hero-art" aria-hidden="true"><span className="art-coordinate">FIG. 01 — THE POSSIBILITIES</span><svg viewBox="0 0 320 260" fill="none"><circle cx="160" cy="130" r="100" stroke="currentColor" strokeOpacity=".22"/><path d="M20 130h280M160 10v240" stroke="currentColor" strokeOpacity=".15"/><path d="m160 28 90 55v98l-90 52-90-52V83l90-55Z" fill="#ba3526" stroke="#ba3526" strokeWidth="2"/><path d="m160 28-54 135h108L160 28ZM70 83l36 80 54 70 54-70 36-80M70 181l36-18m108 0 36 18" stroke="#f6f5f0" strokeWidth="1.5"/><text x="160" y="141" fill="#fcfbf8" fontSize="36" fontFamily="Helvetica, Arial, sans-serif" textAnchor="middle">20</text></svg><span className="art-caption">无限世界，一张游戏桌。<span>ROLL / PLAY / REPEAT</span></span></div>;
}
