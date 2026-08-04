export default function InitiativePanel() {
  return (
    <div className="h-14 border-b border-zinc-700/60 bg-zinc-900 flex items-center px-2 gap-2 text-sm text-zinc-400">
      <span className="text-zinc-500 shrink-0">先攻</span>
      <span className="px-2 py-0.5 rounded bg-zinc-700 text-white">哥布林 <span className="text-amber-400">18</span></span>
      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">阿拉贡 <span className="text-zinc-500">15</span></span>
      <button className="ml-auto px-2 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30">⏭ 下一回合</button>
    </div>
  );
}
