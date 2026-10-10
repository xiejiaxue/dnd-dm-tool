import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  type CurrentUser,
  type CampaignSummary,
  type CampaignModuleSummary,
} from "./api";
import Icon from "./components/Icon";
interface Props {
  inviteError?: string | null;
  onOpenCampaign: (slug: string) => void;
}
export default function Lobby({ inviteError, onOpenCampaign }: Props) {
  const [me, setMe] = useState<CurrentUser | null>(null),
    [campaigns, setCampaigns] = useState<CampaignSummary[]>([]),
    [modules, setModules] = useState<CampaignModuleSummary[]>([]);
  const [name, setName] = useState(""),
    [moduleId, setModuleId] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null),
    pageRef = useRef<HTMLDivElement>(null);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const user = await api.me();
      const [list, templates] = await Promise.all([
        api.campaignList(archived),
        api.modules(),
      ]);
      setMe(user);
      setCampaigns(list);
      setModules(templates);
      setModuleId((current) =>
        templates.some((m) => m.id === current)
          ? current
          : templates[0]?.id || "",
      );
      setName((current) => current || templates[0]?.name || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [archived]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const campaign = await api.createCampaign(
        name.trim(),
        moduleId || undefined,
      );
      onOpenCampaign(campaign.slug);
    } catch (e) {
      await load();
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };
  const archive = async (c: CampaignSummary) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await (archived
        ? api.restoreCampaign(c.slug)
        : api.archiveCampaign(c.slug));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: CampaignSummary) => {
    if (
      busy ||
      !window.confirm(`删除战役「${c.name}」？删除后将不再显示在大厅。`)
    )
      return;
    setBusy(true);
    try {
      await api.deleteCampaign(c.slug);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };
  const focusCreate = () => {
    nameRef.current?.scrollIntoView({ block: "center" });
    nameRef.current?.focus({ preventScroll: true });
    nameRef.current?.select();
  };
  const visible = campaigns.filter(
    (c) =>
      (filter === "all" ||
        (filter === "host" ? c.role === "host" : c.role !== "host")) &&
      `${c.name} ${c.moduleName || ""}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className="swiss-lobby">
      <a className="skip-link" href="#campaign-directory">
        跳转到战役列表
      </a>
      <aside className="navigation-rail">
        <button
          className="brand-mark"
          onClick={() => pageRef.current?.scrollTo({ top: 0 })}
          aria-label="DM 追踪首页"
        >
          <span className="brand-symbol">
            <Icon name="dice" />
          </span>
          <span>
            DM<span className="brand-second">追踪</span>
          </span>
        </button>
        <div className="nav-caption">工具 / TOOLS</div>
        <nav aria-label="主导航">
          <button className="rail-destination active" aria-current="page">
            <Icon name="grid" />
            <span>我的桌团</span>
            <span className="nav-index">01</span>
          </button>
          <a className="rail-destination" href="/calculator">
            <Icon name="calculator" />
            <span>临时计算器</span>
            <span className="nav-index">02</span>
          </a>
          <a className="rail-destination" href="/characters">
            <Icon name="users" />
            <span>角色卡</span>
            <span className="nav-index">03</span>
          </a>
          <a className="rail-destination" href="/dice">
            <Icon name="dice" />
            <span>掷骰</span>
            <span className="nav-index">04</span>
          </a>
        </nav>
        <div className="rail-account">
          <span className="avatar">
            <Icon name="users" />
          </span>
          <div>
            <strong>{me?.displayName || "访客"}</strong>
            <small>{loading ? "正在加载…" : "本机访客身份"}</small>
          </div>
        </div>
      </aside>
      <div className="lobby-scroll" ref={pageRef}>
        <header className="app-topbar">
          <span>
            DM 追踪 <span className="breadcrumb-divider">/</span>
            <strong>我的桌团</strong>
          </span>
        </header>
        <main className="lobby-main">
          <section className="utility-heading">
            <div>
              <span className="eyebrow">01 / CAMPAIGNS</span>
              <h1>我的桌团</h1>
            </div>
            <div className="hero-actions">
              <a className="button-secondary" href="/dice">
                掷骰
              </a>
              <a className="button-secondary" href="/characters">
                开卡
              </a>
              <button className="button-primary" onClick={focusCreate}>
                <Icon name="plus" />
                新战役
              </button>
            </div>
          </section>
          {(inviteError || error) && (
            <div className="lobby-error" role="alert">
              <span>{inviteError || error}</span>
              <button onClick={() => void load()} disabled={loading}>
                重试
              </button>
            </div>
          )}
          <div className="lobby-layout">
            <section id="campaign-directory" aria-label="战役列表">
              <div className="section-title">
                <span className="section-number">01</span>
                <h2>{archived ? "已归档" : "战役"}</h2>
                <span className="count" role="status">
                  {visible.length}
                </span>
                <button
                  className="refresh-button"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <Icon name="refresh" />
                  刷新
                </button>
              </div>
              <label className="search-field">
                <Icon name="search" />
                <input
                  aria-label="搜索战役"
                  type="search"
                  placeholder="战役名称或模组"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="room-filters" aria-label="筛选战役">
                {[
                  ["all", "全部"],
                  ["host", "我主持的"],
                  ["joined", "我参加的"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    className={filter === value ? "selected" : ""}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className={`archive-filter ${archived ? "selected" : ""}`}
                  aria-pressed={archived}
                  onClick={() => setArchived(!archived)}
                >
                  已归档
                </button>
              </div>
              {loading ? (
                <div className="empty-state" role="status">
                  正在加载战役…
                </div>
              ) : visible.length ? (
                <div className="room-grid">
                  {visible.map((c) => (
                    <article className="room-card" key={c.id}>
                      <div className="room-card-top">
                        <span className="visibility">
                          <span />
                          {c.role === "host"
                            ? "主持人"
                            : c.role === "spectator"
                              ? "旁观者"
                              : "参与者"}
                        </span>
                      </div>
                      <h3>{c.name}</h3>
                      <p>{c.moduleName || "空白冒险"}</p>
                      <footer>
                        {c.role === "host" && (
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() => void archive(c)}
                          >
                            {archived ? "恢复" : "归档"}
                          </button>
                        )}
                        {archived && c.role === "host" && (
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() => void remove(c)}
                          >
                            删除
                          </button>
                        )}
                        {!archived && (
                          <a
                            className="room-enter"
                            href={`/c/${encodeURIComponent(c.slug)}`}
                            onClick={(e) => {
                              if (
                                e.metaKey ||
                                e.ctrlKey ||
                                e.shiftKey ||
                                e.altKey
                              )
                                return;
                              e.preventDefault();
                              onOpenCampaign(c.slug);
                            }}
                          >
                            继续战役
                            <Icon name="arrow" />
                          </a>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Icon name="grid" />
                  <h3>{query ? "没有匹配战役" : "暂无战役"}</h3>
                </div>
              )}
            </section>
            <aside className="create-room">
              <div className="create-heading">
                <span className="eyebrow">NEW CAMPAIGN</span>
                <Icon name="plus" />
              </div>
              <h2>新战役</h2>
              <form onSubmit={create}>
                {modules.length > 1 && (
                  <div className="campaign-create-field">
                    <label htmlFor="campaign-module">模组</label>
                    <select
                      id="campaign-module"
                      value={moduleId}
                      onChange={(e) => {
                        const chosen = modules.find(
                          (m) => m.id === e.target.value,
                        );
                        if (
                          !name.trim() ||
                          name === modules.find((m) => m.id === moduleId)?.name
                        )
                          setName(chosen?.name || "");
                        setModuleId(e.target.value);
                      }}
                    >
                      {modules.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="campaign-create-field">
                  <label htmlFor="campaign-name">战役名称</label>
                  <input
                    id="campaign-name"
                    ref={nameRef}
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <button
                  className="button-primary"
                  type="submit"
                  disabled={busy || loading || !name.trim() || !moduleId}
                >
                  {busy ? "创建中…" : "创建并进入"}
                  <Icon name="arrow" />
                </button>
              </form>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
