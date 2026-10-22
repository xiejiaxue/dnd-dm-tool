/**
 * Decorative arcane sigil for the lobby banner. Pure markup: every motion is a
 * CSS transform/opacity animation on its own layer, so it costs no JS frames
 * and stops entirely under prefers-reduced-motion.
 */
const ticks = Array.from({ length: 48 }, (_, i) => i);
const runes = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ'];

export default function HeroOrnament() {
  return (
    <div className="hero-ornament" aria-hidden="true">
      <span className="sigil-glow" />
      <div className="sigil-ring sigil-outer">
        <svg viewBox="0 0 200 200" fill="none">
          <circle cx="100" cy="100" r="97" stroke="currentColor" strokeOpacity=".5" />
          <circle cx="100" cy="100" r="86" stroke="currentColor" strokeOpacity=".28" strokeDasharray="2 5" />
          {ticks.map(i => (
            <line key={i} x1="100" y1="4" x2="100" y2={i % 4 === 0 ? 14 : 9} stroke="currentColor" strokeOpacity={i % 4 === 0 ? 0.7 : 0.35} transform={`rotate(${i * 7.5} 100 100)`} />
          ))}
          {runes.map((r, i) => (
            <text key={r} x="100" y="27" fontSize="9" fill="currentColor" fillOpacity=".55" textAnchor="middle" transform={`rotate(${i * 30 + 15} 100 100)`}>{r}</text>
          ))}
        </svg>
      </div>
      <div className="sigil-ring sigil-inner">
        <svg viewBox="0 0 200 200" fill="none">
          <circle cx="100" cy="100" r="62" stroke="currentColor" strokeOpacity=".45" />
          <path d="M100 38 153.7 131H46.3Z M100 162 46.3 69h107.4Z" stroke="currentColor" strokeOpacity=".32" />
        </svg>
      </div>
      <svg className="sigil-die" viewBox="0 0 120 120" fill="none">
        <path d="m60 8 45 26v52l-45 26-45-26V34Z" fill="url(#hero-die-fill)" stroke="#e7c873" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M60 8 33 75h54L60 8ZM15 34l18 41 27 37 27-37 18-41M15 86l18-11m54 0 18 11" stroke="#f6e3ad" strokeOpacity=".75" strokeWidth="1.1" strokeLinejoin="round" />
        <text x="60" y="64" fill="#fff6dc" fontSize="17" fontWeight="600" textAnchor="middle" fontFamily="Georgia, serif">20</text>
        <defs>
          <linearGradient id="hero-die-fill" x1="20" y1="10" x2="100" y2="110" gradientUnits="userSpaceOnUse">
            <stop stopColor="#c6463a" />
            <stop offset="1" stopColor="#6e1c17" />
          </linearGradient>
        </defs>
      </svg>
      {Array.from({ length: 8 }, (_, i) => <span key={i} className="ember" />)}
    </div>
  );
}
