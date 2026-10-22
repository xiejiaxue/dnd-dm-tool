import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import type { StandalonePageProps } from '../../extensions/registry';
import {
  defaultEnabledCharacterRuleSourceIds,
  deriveDnd5eCharacter,
  emptyDnd5eCharacterSheet,
  recalculateDnd5eCharacterSheet,
  type CharacterRuleCatalog,
  type Dnd5eCharacterSheet,
  type PersonalCharacter,
} from '../../types';
import { characterSheetApi } from './api';
import CharacterSheetEditor from './CharacterSheetEditor';
import { setRuleSource } from './model';

export default function CharacterSheetPage({ onExit }: StandalonePageProps) {
  const [catalog, setCatalog] = useState<CharacterRuleCatalog | null>(null);
  const [characters, setCharacters] = useState<PersonalCharacter[]>([]);
  const [selectedId, setSelectedId] = useState('new');
  const [sheet, setSheet] = useState<Dnd5eCharacterSheet>(() => emptyDnd5eCharacterSheet());
  const [color, setColor] = useState('#38a169');
  const [busy, setBusy] = useState(true);
  const [liveBusy, setLiveBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const liveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const liveRevisionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([characterSheetApi.rules(), characterSheetApi.characters(), api.me()])
      .then(([rules, saved, me]) => {
        if (cancelled) return;
        setCatalog(rules);
        setCharacters(saved);
        if (saved[0]) selectCharacter(saved[0], rules, setSelectedId, setSheet, setColor);
        else {
          const blank = emptyDnd5eCharacterSheet('', defaultEnabledCharacterRuleSourceIds(rules.sources));
          setSheet({ ...blank, identity: { ...blank.identity, playerName: me.displayName ?? '' } });
        }
      })
      .catch(cause => setError(message(cause)))
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);

  const normalizedSheet = useMemo(
    () => catalog ? recalculateDnd5eCharacterSheet(sheet, catalog) : sheet,
    [catalog, sheet],
  );
  const derived = useMemo(
    () => catalog ? deriveDnd5eCharacter(normalizedSheet, catalog) : null,
    [catalog, normalizedSheet],
  );
  const enabledSources = useMemo(() => new Set(sheet.rules.enabledSources), [sheet.rules.enabledSources]);

  const changeSheet = (next: Dnd5eCharacterSheet) => {
    setSheet(catalog ? recalculateDnd5eCharacterSheet(next, catalog) : next);
    setNotice('');
  };

  const newCharacter = () => {
    setSelectedId('new');
    setSheet(emptyDnd5eCharacterSheet('', catalog ? defaultEnabledCharacterRuleSourceIds(catalog.sources) : undefined));
    setColor('#38a169');
    setError('');
    setNotice('');
  };

  const save = async (input = sheet) => {
    if (!catalog) return;
    const next = recalculateDnd5eCharacterSheet(input, catalog);
    const name = next.identity.characterName.trim();
    if (!name) { setError('请填写角色名称'); return; }
    const result = deriveDnd5eCharacter(next, catalog);
    if (!result.pointBuyValid) { setError('属性购点超过 27 点，请先调整基础属性'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = selectedId === 'new'
        ? await characterSheetApi.createCharacter({ name, color, sheet: next })
        : await characterSheetApi.updateCharacter(selectedId, { name, color, sheet: next });
      setCharacters(current => [saved, ...current.filter(character => character.id !== saved.id)]);
      selectCharacter(saved, catalog, setSelectedId, setSheet, setColor);
      setNotice('角色卡已保存，所有派生数据已重新计算');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  const applyLiveChange = (next: Dnd5eCharacterSheet) => {
    const prepared = catalog ? recalculateDnd5eCharacterSheet(next, catalog) : next;
    setSheet(prepared);
    setNotice('');
    if (!catalog || selectedId === 'new') return;
    const characterId = selectedId;
    const revision = ++liveRevisionRef.current;
    setLiveBusy(true);
    liveQueueRef.current = liveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await characterSheetApi.updateCharacter(characterId, {
          name: prepared.identity.characterName.trim(),
          color,
          sheet: prepared,
        });
        setCharacters(current => [saved, ...current.filter(character => character.id !== saved.id)]);
      })
      .catch(cause => setError(message(cause)))
      .finally(() => { if (liveRevisionRef.current === revision) setLiveBusy(false); });
  };

  const remove = async () => {
    if (selectedId === 'new' || !confirm(`确定删除“${sheet.identity.characterName}”吗？`)) return;
    setBusy(true);
    try {
      await characterSheetApi.deleteCharacter(selectedId);
      const remaining = characters.filter(character => character.id !== selectedId);
      setCharacters(remaining);
      if (remaining[0] && catalog) selectCharacter(remaining[0], catalog, setSelectedId, setSheet, setColor);
      else newCharacter();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  if (busy && !catalog) return <LoadingPage onExit={onExit} />;

  return (
    <main className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 py-3 sm:px-6">
        <button type="button" onClick={onExit} className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" title="返回首页">返回</button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">D&D 5e 自动角色卡</h1>
          <p className="truncate text-xs text-zinc-500">27 点购点 · 规则自动派生 · 现场游玩状态</p>
        </div>
        {liveBusy && <span className="text-xs text-zinc-500">同步中…</span>}
        {selectedId !== 'new' && <button type="button" onClick={() => void remove()} disabled={busy || liveBusy} className="rounded-md px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-40">删除</button>}
        <button type="button" onClick={() => void save()} disabled={busy || liveBusy || !sheet.identity.characterName.trim()} className="rounded-md bg-amber-500/15 px-4 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-500/25 disabled:opacity-40">{busy ? '保存中…' : '保存角色卡'}</button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-zinc-800 bg-zinc-900/60 p-3 md:w-64 md:border-b-0 md:border-r">
          <button type="button" onClick={newCharacter} className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-300 hover:bg-amber-500/20">新建角色卡</button>
          <div className="mt-3 max-h-36 space-y-1 overflow-y-auto md:max-h-[calc(100vh-24rem)]">
            {characters.map(character => (
              <button key={character.id} type="button" onClick={() => catalog && selectCharacter(character, catalog, setSelectedId, setSheet, setColor)} className={`w-full rounded-lg border px-3 py-2 text-left ${selectedId === character.id ? 'border-amber-500/50 bg-amber-500/10' : 'border-transparent hover:bg-zinc-800'}`}>
                <span className="block truncate text-sm font-medium">{character.name}</span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{character.sheet.advancement.race?.name ?? '未选种族'} · {character.sheet.advancement.class?.name ?? '未选职业'} {character.sheet.advancement.level}级</span>
              </button>
            ))}
          </div>

          {catalog && (
            <fieldset className="mt-5 border-t border-zinc-800 pt-4">
              <legend className="text-xs font-medium text-zinc-300">允许的扩展规则</legend>
              <p className="mt-1 text-[10px] leading-4 text-zinc-600">取消来源会清理该来源的角色选项、法术和物品引用。</p>
              <div className="mt-2 space-y-1">
                {catalog.sources.map(source => (
                  <label key={source.id} title={source.description} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-zinc-800/70">
                    <input type="checkbox" className="mt-0.5 accent-amber-500" checked={source.core || enabledSources.has(source.id)} disabled={source.core} onChange={event => changeSheet(setRuleSource(sheet, source.id, event.target.checked))} />
                    <span className="min-w-0"><span className="block text-zinc-300">{source.name}</span><span className="text-[10px] text-zinc-600">{source.abbreviation}{source.core ? ' · 基础规则' : ''}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 sm:p-6">
            {(error || notice) && <div role={error ? 'alert' : 'status'} className={`mb-4 rounded-lg border px-4 py-2 text-sm ${error ? 'border-red-500/30 bg-red-950/30 text-red-300' : 'border-emerald-500/20 bg-emerald-950/20 text-emerald-300'}`}>{error || notice}</div>}
            {catalog && derived && <CharacterSheetEditor catalog={catalog} sheet={normalizedSheet} derived={derived} color={color} onColor={setColor} onChange={changeSheet} onLiveChange={applyLiveChange} />}
            <footer className="mt-8 border-t border-zinc-800 pt-4 text-[11px] leading-5 text-zinc-600">
              计算基线参考官方 D&D 5e 角色卡及 PHB 2014。规则索引来源：<a href={catalog?.sourceUrl ?? 'https://5echm.kagangtuya.top/'} target="_blank" rel="noreferrer" className="text-zinc-400 underline hover:text-zinc-200">{catalog?.sourceName ?? 'DND5E 不全书'}</a>。自定义覆盖会在对应字段明确标记。
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}

function selectCharacter(
  character: PersonalCharacter,
  catalog: CharacterRuleCatalog,
  setId: (id: string) => void,
  setSheet: (sheet: Dnd5eCharacterSheet) => void,
  setColor: (color: string) => void,
) {
  setId(character.id);
  setSheet(recalculateDnd5eCharacterSheet(structuredClone(character.sheet), catalog));
  setColor(character.color);
}

function LoadingPage({ onExit }: StandalonePageProps) {
  return <main className="grid h-full place-items-center bg-zinc-950 text-zinc-400"><div className="text-center"><p>正在载入角色卡插件…</p><button type="button" onClick={onExit} className="mt-3 text-sm underline">返回首页</button></div></main>;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '角色卡操作失败';
}
