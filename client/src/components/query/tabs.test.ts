import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Campaign, IndexEntry, Scene } from '../../types';
import { connection } from '../../ws';
import { setPending } from '../../pending';
import CampaignTab from './CampaignTab';
import CompendiumTab from './CompendiumTab';
import FavoritesTab from './FavoritesTab';
import SearchControls from './SearchControls';
import type { useCompendiumSearch } from './useCompendiumSearch';
import type { useSceneDirectory } from './useSceneDirectory';

vi.mock('../../ws', () => ({ connection: { sendOps: vi.fn(), sendControl: vi.fn() } }));
vi.mock('../../pending', () => ({ setPending: vi.fn() }));
const scene = { playArea: { x: 100, y: 200, w: 800, h: 600 }, tokens: [{ entryId: 'goblin' }, { entryId: 'goblin' }] } as unknown as Scene;
const campaign = { enemies: [{ entryId: 'goblin', nameZh: '哥布林' }], sceneIds: ['locked', 'open'] } as Campaign;
const record = { id: 'goblin', type: 'monster', nameZh: '哥布林', nameEn: 'Goblin', source: 'MM', cr: '1/4' } as IndexEntry;
function search() { return { q: 'goblin', type: 'all', results: [record], resultSource: 'local', setQ: vi.fn(), setType: vi.fn() } as ReturnType<typeof useCompendiumSearch>; }
function directory() { return { sceneNames: { locked: { name: '密室', unlocked: false }, open: { name: '营地', unlocked: true } }, unlockedScenes: ['open'], preview: null, openPreview: vi.fn(), closePreview: vi.fn() } as unknown as ReturnType<typeof useSceneDirectory>; }
type Element = ReactElement<Record<string, any>>;
function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
function text(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (isValidElement<Record<string, any>>(tree)) return text(tree.props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
function button(tree: ReactNode, match: string) {
  const result = elements(tree).find(e => e.type === 'button' && (e.props.title === match || text(e.props.children) === match));
  expect(result, `button ${match}`).toBeDefined(); return result!;
}
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(1234); });
afterEach(() => { vi.useRealTimers(); });

describe('CompendiumTab and SearchControls', () => {
  it('keeps search/type inputs wired to the shared search state', () => {
    const state = search(), tree = SearchControls(state), nodes = elements(tree);
    nodes.find(e => e.type === 'input')!.props.onChange({ target: { value: 'shield' } });
    nodes.find(e => e.type === 'select')!.props.onChange({ target: { value: 'spell' } });
    expect(state.setQ).toHaveBeenCalledWith('shield'); expect(state.setType).toHaveBeenCalledWith('spell');
  });
  it('opens details, spawns a monster with unchanged coordinates/payload and adds it to the library', () => {
    const setDetail = vi.fn(); const tree = CompendiumTab({ scene, campaign: null, role: 'dm', search: search(), setDetail });
    elements(tree).find(e => e.type === 'button' && text(e.props.children).includes('Goblin'))!.props.onClick();
    expect(setDetail).toHaveBeenCalledWith(record);
    button(tree, '添加到场景').props.onClick();
    expect(connection.sendOps).toHaveBeenLastCalledWith([{ op: 'addToken', token: { id: 't1234-2', kind: 'monster', hidden: true, name: '哥布林', entryId: 'goblin', x: 600, y: 400, size: 100, avatar: '/api/token/goblin', color: '#fff' } }]);
    button(tree, '加入战役库').props.onClick();
    expect(connection.sendOps).toHaveBeenLastCalledWith([{ op: 'addEnemy', entryId: 'goblin', nameZh: '哥布林' }]);
  });
  it('disables existing library entries and keeps monster actions hidden from players', () => {
    const props = { scene, campaign, search: search(), setDetail: vi.fn() };
    const dm = CompendiumTab({ ...props, role: 'dm' }); expect(button(dm, '加入战役库').props.disabled).toBe(true);
    const player = renderToStaticMarkup(CompendiumTab({ ...props, role: 'player' }));
    expect(player).not.toContain('添加到场景'); expect(player).not.toContain('加入战役库');
  });
  it('preserves the online attribution, unavailable banner and empty-state rules', () => {
    const props = { scene, campaign, role: 'player' as const, setDetail: vi.fn() };
    const online = renderToStaticMarkup(CompendiumTab({ ...props, search: { ...search(), resultSource: 'online' } }));
    expect(online).toContain('CC BY-NC-SA 4.0');
    const unavailable = renderToStaticMarkup(CompendiumTab({ ...props, search: { ...search(), resultSource: 'unavailable', results: [] } }));
    expect(unavailable).toContain('在线资料暂时不可用'); expect(unavailable).not.toContain('无结果');
    expect(renderToStaticMarkup(CompendiumTab({ ...props, search: { ...search(), results: [] } }))).toContain('无结果');
  });
});

describe('FavoritesTab', () => {
  it('uses resolved names for details and deletes without opening the detail drawer', () => {
    const setDetail = vi.fn(), stopPropagation = vi.fn();
    const tree = FavoritesTab({ favorites: [{ type: 'spell', entryId: 'shield' }], favNames: { shield: '护盾术' }, role: 'player', setDetail });
    elements(tree).find(e => e.type === 'button' && text(e.props.children).includes('护盾术'))!.props.onClick();
    expect(setDetail).toHaveBeenCalledWith({ type: 'spell', id: 'shield', nameZh: '护盾术' }); setDetail.mockClear();
    button(tree, '✕').props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce(); expect(setDetail).not.toHaveBeenCalled();
    expect(connection.sendOps).toHaveBeenCalledWith([{ op: 'removeFavorite', type: 'spell', entryId: 'shield' }]);
  });
  it('keeps ID fallback and hides deletion for spectators', () => {
    const html = renderToStaticMarkup(FavoritesTab({ favorites: [{ type: 'spell', entryId: 'missing' }], favNames: {}, role: 'spectator', setDetail: vi.fn() }));
    expect(html).toContain('missing'); expect(html).not.toContain('✕');
  });
});

describe('CampaignTab', () => {
  it('keeps DM pick-up and removal, with one scene-management entry outside the library', () => {
    const tree = CampaignTab({ scene, campaign, role: 'dm', directory: directory() });
    button(tree, '拿起放置').props.onClick(); expect(setPending).toHaveBeenCalledWith({ kind: 'monster', name: '哥布林', entryId: 'goblin', avatar: '/api/token/goblin', color: '#fff' });
    button(tree, '移出战役库').props.onClick(); expect(connection.sendOps).toHaveBeenLastCalledWith([{ op: 'removeEnemy', entryId: 'goblin' }]);
    expect(renderToStaticMarkup(tree)).not.toContain('密室');
    expect(renderToStaticMarkup(tree)).not.toContain('一键放入当前场景');
    expect(connection.sendControl).not.toHaveBeenCalled();
  });
  it('shows only unlocked player scenes and opens a preview without switching the live scene', () => {
    const data = directory(), tree = CampaignTab({ scene, campaign, role: 'player', directory: data });
    const html = renderToStaticMarkup(tree); expect(html).toContain('营地'); expect(html).not.toContain('密室'); expect(html).not.toContain('哥布林');
    button(tree, '营地').props.onClick(); expect(data.openPreview).toHaveBeenCalledWith('open');
    expect(connection.sendControl).not.toHaveBeenCalled(); expect(connection.sendOps).not.toHaveBeenCalled();
  });
  it('preserves preview map, numbered tokens, players and the back button', () => {
    const data = directory(); data.preview = { name: '营地', mapImage: '/map.png', tokens: [{ id: 'monster', name: '哥布林', number: 2 }], players: [{ id: 'player', name: '莱拉' }] } as unknown as Scene;
    const tree = CampaignTab({ scene, campaign, role: 'player', directory: data });
    const html = renderToStaticMarkup(tree); expect(html).toContain('只读预览'); expect(html).toContain('/map.png'); expect(html).toContain('哥布林 #2'); expect(html).toContain('莱拉（玩家）');
    button(tree, '←').props.onClick(); expect(data.closePreview).toHaveBeenCalledOnce();
  });
});
