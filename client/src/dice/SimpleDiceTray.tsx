import { DiceFaces } from './DiceSymbol';
import type { DiceResult } from './rules';

// Fit each complete silhouette and its label inside the six tray edges.
function layout(count: number) {
  let best = { size: 0, positions: [] as { x: number; y: number }[] };
  for (let columns = 1; columns <= Math.min(6, count); columns++) {
    const rows = Math.ceil(count / columns);
    const positions = Array.from({ length: count }, (_, i) => {
      const row = Math.floor(i / columns);
      const rowCount = Math.min(columns, count - row * columns);
      return { x: (i % columns - (rowCount - 1) / 2) * 1.2, y: (row - (rows - 1) / 2) * 1.4 - .1 };
    });
    let extent = 0;
    for (const p of positions) for (let edge = 0; edge < 6; edge++) {
      const angle = (edge + .5) * Math.PI / 3;
      for (const dx of [-.5, .5]) for (const dy of [-.5, .8]) {
        extent = Math.max(extent, (p.x + dx) * Math.cos(angle) + (p.y + dy) * Math.sin(angle));
      }
    }
    const size = Math.min(136, 230 / extent);
    if (size > best.size) best = { size, positions };
  }
  return best;
}

export default function SimpleDiceTray({ results }: { results?: DiceResult[] }) {
  const dice = results ?? [];
  const { size, positions } = layout(dice.length);
  return <svg className="simple-roll-art" viewBox="0 0 640 560" role="img" aria-label={dice.length ? `${dice.length} 颗骰子的结果：${dice.map(die => `d${die.sides} 为 ${die.value}`).join('，')}` : '深色六边形骰盘，等待投掷'}>
    <path fill="#181f1c" d="M20 284 170 24H470L620 284 470 544H170Z" />
    <path fill="#424d46" d="M20 278 170 18H470L620 278 470 538H170Z" />
    <path fill="#29312d" d="M31 278 175 28H465L609 278 465 528H175Z" />
    {dice.length ? dice.map((die, index) => {
      const p = positions[index];
      const x = 320 + p.x * size, y = 278 + p.y * size;
      return <g key={index} className="flat-die" data-sides={die.sides} data-value={die.value}>
        <title>{`d${die.sides}：${die.value}${die.components ? `（${String(die.components[0]).padStart(2, '0')} + ${die.components[1]}）` : ''}`}</title>
        <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / 100})`}>
          <DiceFaces sides={die.sides} value={die.value} />
        </g>
        <text className="flat-die-label" x={x} y={y + size * .7} fontSize={Math.max(15, size * .17)}>{`d${die.sides}`}</text>
      </g>;
    }) : <g>
      <g transform="translate(273 196) scale(.94)" className="flat-die-empty"><DiceFaces sides={20} variant="outline" /></g>
      <text className="flat-die-label" x="320" y="322" fontSize="17">等待投掷</text>
    </g>}
  </svg>;
}
