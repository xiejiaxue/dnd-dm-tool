export default function TopBar() {
  return (
    <header className="h-11 flex items-center gap-3 px-3 border-b border-zinc-700/60 bg-zinc-900 text-sm">
      <span className="font-semibold">⚙ DM 追踪</span>
      <span className="text-zinc-500">场景「默认场景」</span>
      <div className="ml-auto flex items-center gap-3 text-zinc-400">
        <span>玩家在线: <span className="text-emerald-400">0</span></span>
        <span>口令: 未设置</span>
      </div>
    </header>
  );
}
