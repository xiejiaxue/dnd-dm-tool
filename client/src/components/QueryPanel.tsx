export default function QueryPanel() {
  return (
    <aside className="w-80 border-l border-zinc-700/60 bg-zinc-900 flex flex-col text-sm">
      <div className="p-2 border-b border-zinc-800 flex gap-2">
        <input placeholder="搜索怪物 / 法术…" className="flex-1 bg-zinc-800 rounded px-2 py-1 outline-none" />
      </div>
      <div className="p-2 text-zinc-500 text-xs">搜索「地精」试试（接入数据后可用）</div>
    </aside>
  );
}
