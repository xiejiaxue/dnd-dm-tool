import { useEffect, useState } from "react";
import { api } from "../api";
export default function CampaignMembers({
  role,
  onClose,
}: {
  role: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<
      Awaited<ReturnType<typeof api.campaignMembers>>
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setMembers(await api.campaignMembers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await api.removeMember(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除失败");
    } finally {
      setBusy(false);
    }
  };
  const labels: Record<string, string> = {
    owner: "主持人",
    dm: "DM",
    assistant_dm: "协作 DM",
    player: "玩家",
    spectator: "旁观者",
  };
  return (
    <section className="campaign-members-panel" aria-label="战役名册">
      <header>
        <h2>战役名册</h2>
        <button onClick={() => void load()}>刷新</button>
        <button aria-label="关闭名册" onClick={onClose}>
          ×
        </button>
      </header>
      {members.map((member) => (
        <div className="campaign-member" key={member.id}>
          <span>
            <strong>{member.name}</strong>
            <small>
              {labels[member.role]}
              {member.status === "removed" ? " · 已移除" : ""}
            </small>
          </span>
          {member.status === "active" &&
            member.role !== "owner" &&
            (role === "host" ||
              ["player", "spectator"].includes(member.role)) && (
              <button disabled={busy} onClick={() => void remove(member.id)}>
                移除
              </button>
            )}
        </div>
      ))}
      {error && (
        <p className="tool-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
