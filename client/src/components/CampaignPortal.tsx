import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  type CampaignCharacterSummary,
  type CampaignBootstrap,
} from "../api";
interface Props {
  room: CampaignBootstrap;
  onReady: () => Promise<void>;
  onLeave: () => void;
}
export default function CampaignPortal({ room, onReady, onLeave }: Props) {
  const [characters, setCharacters] = useState<CampaignCharacterSummary[] | null>(null);
  // Kept as text so clearing the field does not turn into NaN mid-edit.
  const [name, setName] = useState(""),
    [color, setColor] = useState("#ba3526"),
    [hp, setHp] = useState("10");
  const maxHp = Number(hp);
  const hpValid = Number.isInteger(maxHp) && maxHp >= 1 && maxHp <= 9999;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void api
      .characters(room.campaign.id!)
      .then(setCharacters)
      .catch((e) => {
        setCharacters([]);
        setError(e instanceof Error ? e.message : "读取角色失败");
      });
  }, [room.campaign.id]);
  const select = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await onReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !hpValid) return;
    void select(async () => {
      const c = await api.createCharacter({
        campaignId: room.campaign.id!,
        name: name.trim(),
        color,
        maxHp,
      });
      await api.selectCharacter(room.campaign.id!, c.id);
    });
  };
  return (
    <main className="campaign-portal h-full overflow-auto p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="portal-heading mb-7 flex items-center justify-between gap-4">
          <div>
            <span className="eyebrow">CHARACTER / 角色</span>
            <h1 className="mt-2 text-2xl font-semibold">
              {room.campaign.name}
            </h1>
          </div>
          <button className="button-secondary" onClick={onLeave}>
            返回大厅
          </button>
        </header>
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-4 text-lg font-semibold">选择角色</h2>
            <div className="grid gap-3">
              {characters === null && <p className="supporting" role="status">正在读取角色…</p>}
              {characters?.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  className="campaign-card border p-4 text-left"
                  onClick={() =>
                    void select(() =>
                      api.selectCharacter(room.campaign.id!, c.id),
                    )
                  }
                >
                  <span
                    className="inline-block mr-3 h-3 w-3"
                    style={{ background: c.color }}
                  />
                  {c.name}
                  <span className="float-right text-sm text-zinc-500">
                    HP {c.maxHp}
                  </span>
                </button>
              ))}
              {characters?.length === 0 && <p className="supporting">还没有角色，在右侧新建一个</p>}
            </div>
          </section>
          <form onSubmit={create} className="campaign-character-form">
            <h2>新建角色</h2>
            <label>
              角色名称
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="character-basics">
              <label>
                颜色
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </label>
              <label>
                最大 HP
                <input
                  type="number"
                  required
                  min="1"
                  max="9999"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                  aria-invalid={!hpValid}
                />
              </label>
            </div>
            <button className="button-primary" disabled={busy || !name.trim() || !hpValid}>
              {busy ? "进入中…" : "创建并进入"}
            </button>
          </form>
        </div>
        {error && (
          <p className="tool-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
