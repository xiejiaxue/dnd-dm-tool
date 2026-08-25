import { describe, expect, it } from 'vitest';
import { DEFAULT_TOKEN_SIZE } from '../../shared/types';
import {
  activeScene,
  activeCampaign,
  addScene,
  applyOperation,
  createInitialRoomState,
  createSceneFolder,
  deleteSceneFolder,
  ensurePlayerToken,
  moveSceneToFolder,
  normalizeLegacyPlayerTokenSizes,
  projectRoomState,
  renameSceneFolder,
  type RoomActor,
} from '../src/domain';
import { authorizeOperation } from '../src/board/operation-authorization';
import { projectPatchOperations } from '../src/board/patch-projection';
import { normalizeCampaignNpcs, normalizeLegacyMapFog, normalizeSceneFolders, removeRetiredAutoRoomData } from '../src/board/state-normalization';

const host: RoomActor = { userId: 'host-user', memberId: 'host-member', role: 'host', accessEpoch: 1 };
const player: RoomActor = { userId: 'viewer-user', memberId: 'viewer-member', role: 'player', accessEpoch: 1 };

describe('room operation patches', () => {
  it('migrates legacy NPC archives into faction folders and individual records once', () => {
    const state = createInitialRoomState('NPC migration', 'Dragon Heist');
    const campaign = activeCampaign(state);
    campaign.npcs = [{
      id: 'npc-others', name: '其他成员', aliases: [], role: '珊娜萨公会', location: '', status: 'active',
      notesMarkdown: '## 泽姆克 Zemk\n**身份**：灰矮人守卫\n\n## 希尔加 Sylgar\n**身份**：宠物鱼',
      sourceFile: '01-珊娜萨公会/14-其他成员.md', updatedAt: 0,
    }];
    expect(normalizeCampaignNpcs(campaign)).toBe(true);
    expect(campaign.npcs).toHaveLength(2);
    expect(campaign.npcs?.find(npc => npc.name === '泽姆克')).toMatchObject({ faction: '珊娜萨公会', groupPath: ['珊娜萨公会'] });
    expect(campaign.npcs?.find(npc => npc.name === '希尔加')?.statReference).toMatchObject({ kind: 'compendium', entryId: 'MM__Quipper' });
    expect(normalizeCampaignNpcs(campaign)).toBe(false);
  });

  it('merges legacy NPC section records and relinks placed tokens', () => {
    const state = createInitialRoomState('Legacy sections', 'Dragon Heist');
    const campaign = activeCampaign(state);
    const scene = activeScene(state);
    campaign.npcs = [
      {
        id: 'profile', name: '人物档案', aliases: [], role: '曼松的亲信', location: '', status: 'active',
        faction: '散塔林会', groupPath: ['散塔林会', '曼松', '阿贡·焰火'], notesMarkdown: '**身份**：曼松的亲信', sourceFile: '散塔林会/曼松/阿贡·焰火.md#人物档案', updatedAt: 0,
      },
      {
        id: 'background', name: '背景', aliases: [], role: '', location: '', status: 'active',
        faction: '散塔林会', groupPath: ['散塔林会', '曼松', '阿贡·焰火'], notesMarkdown: '负责烟火生意。', sourceFile: '散塔林会/曼松/阿贡·焰火.md#背景', updatedAt: 0,
      },
      {
        id: 'rules', name: '规则资料', aliases: [], role: '', location: '', status: 'active',
        faction: '散塔林会', groupPath: ['散塔林会', '曼松', '阿贡·焰火'], notesMarkdown: '| 护甲等级 | 15 |\n| 生命值 | 44 |', sourceFile: '散塔林会/曼松/阿贡·焰火.md#规则资料', updatedAt: 0,
      },
    ];
    scene.tokens.push({
      id: 'agorn-token', kind: 'npc', name: '背景', entryId: 'npc:background',
      x: 100, y: 100, size: 100, avatar: '', color: '#0ea5e9',
    });

    expect(normalizeCampaignNpcs(campaign, [scene])).toBe(true);
    expect(campaign.npcs).toHaveLength(1);
    expect(campaign.npcs?.[0]).toMatchObject({ name: '阿贡·焰火', groupPath: ['散塔林会'] });
    expect(scene.tokens[0]).toMatchObject({ name: '阿贡·焰火', entryId: `npc:${campaign.npcs?.[0].id}` });
    expect(normalizeCampaignNpcs(campaign, [scene])).toBe(false);
  });

  it('removes retired generated room data while preserving manual walls', () => {
    const state = createInitialRoomState('Retired rooms', 'Retired rooms campaign');
    const scene = activeScene(state);
    scene.walls.push(
      { id: 'manual-wall', p1: [0, 0], p2: [50, 0] },
      { id: 'generated-wall', p1: [0, 50], p2: [200, 50], source: 'auto' } as typeof scene.walls[number] & { source: 'auto' },
    );
    (scene as typeof scene & { roomRegions?: unknown }).roomRegions = [
      { id: 'old-room', name: '入口', cellRuns: [[0, 4]] },
    ];

    expect(removeRetiredAutoRoomData(state)).toBe(true);
    expect(scene.walls).toEqual([{ id: 'manual-wall', p1: [0, 0], p2: [50, 0] }]);
    expect(scene).not.toHaveProperty('roomRegions');
    expect(removeRetiredAutoRoomData(state)).toBe(false);
  });

  it('migrates scaled legacy fog into stable map-relative coordinates', () => {
    const state = createInitialRoomState('Scaled fog', 'Scaled fog campaign');
    const scene = activeScene(state);
    scene.mapImage = '/api/rooms/scaled-fog/assets/map';
    scene.mapSize = [200, 100];
    scene.mapScale = 0.5;
    scene.fog = [true, false];
    delete scene.fogVersion;

    expect(normalizeLegacyMapFog(scene)).toBe(true);
    expect(scene.fogVersion).toBe(2);
    expect(scene.fog).toEqual([
      true, true, false, false,
      true, true, false, false,
    ]);
    expect(normalizeLegacyMapFog(scene)).toBe(false);
  });

  it('creates, renames, moves, and safely deletes campaign scene folders', () => {
    const state = createInitialRoomState('Chapter table', 'Chapter campaign');
    const firstSceneId = state.currentSceneId;
    const secondScene = addScene(state, '第二张地图');
    const chapter = createSceneFolder(state, '第一章');

    moveSceneToFolder(state, firstSceneId, chapter.id);
    moveSceneToFolder(state, secondScene.id, chapter.id);
    renameSceneFolder(state, chapter.id, '第一章：好友有难');
    expect(activeCampaign(state)).toMatchObject({
      sceneFolders: [{ id: chapter.id, name: '第一章：好友有难' }],
      sceneFolderAssignments: {
        [firstSceneId]: chapter.id,
        [secondScene.id]: chapter.id,
      },
    });
    expect(() => createSceneFolder(state, '第一章：好友有难')).toThrow('同名场景文件夹已存在');

    deleteSceneFolder(state, chapter.id);
    expect(activeCampaign(state).sceneFolders).toEqual([]);
    expect(activeCampaign(state).sceneFolderAssignments).toEqual({});
    expect(activeCampaign(state).sceneIds).toEqual([firstSceneId, secondScene.id]);
  });

  it('groups an existing Dragon Heist room by chapter exactly once', () => {
    const state = createInitialRoomState('Dragon Heist', 'Dragon Heist');
    const campaign = activeCampaign(state);
    campaign.templateId = 'waterdeep-dragon-heist';
    activeScene(state).name = '第1章 好友有难 · 散塔林会藏身处';
    const chapterTwo = addScene(state, '第2章 巨魔颅巷 · 酒馆');
    delete campaign.sceneFolders;
    delete campaign.sceneFolderAssignments;
    delete campaign.sceneFoldersInitialized;

    expect(normalizeSceneFolders(state, campaign)).toBe(true);
    const normalizedCampaign = activeCampaign(state);
    expect(normalizedCampaign.sceneFolders?.map(folder => folder.name)).toEqual(['第1章 好友有难', '第2章 巨魔颅巷']);
    expect(normalizedCampaign.sceneFolderAssignments?.[state.currentSceneId]).toBe(normalizedCampaign.sceneFolders?.[0].id);
    expect(normalizedCampaign.sceneFolderAssignments?.[chapterTwo.id]).toBe(normalizedCampaign.sceneFolders?.[1].id);
    expect(normalizeSceneFolders(state, normalizedCampaign)).toBe(false);

    // A DM can intentionally delete every folder without migration recreating it.
    normalizedCampaign.sceneFolders = [];
    normalizedCampaign.sceneFolderAssignments = {};
    expect(normalizeSceneFolders(state, normalizedCampaign)).toBe(false);
    expect(normalizedCampaign.sceneFolders).toEqual([]);
  });

  it('uses one default size for new players and upgrades legacy player tokens', () => {
    const state = createInitialRoomState('Token size table', 'Token size campaign');
    const scene = activeScene(state);
    scene.players.push({
      id: 'legacy-player', kind: 'player', name: 'Legacy', entryId: null,
      x: 10, y: 20, size: 48, avatar: '', color: '#fff', sessionId: 'legacy-user',
    });

    expect(normalizeLegacyPlayerTokenSizes(state)).toEqual([
      expect.objectContaining({ id: 'legacy-player', size: DEFAULT_TOKEN_SIZE }),
    ]);
    expect(ensurePlayerToken(state, player)).toBe(true);
    expect(scene.players.find((token) => token.sessionId === player.userId)).toMatchObject({
      size: DEFAULT_TOKEN_SIZE,
    });
  });

  it('accepts same-origin compendium portraits for monster tokens but rejects remote assets', () => {
    const state = createInitialRoomState('Token table', 'Token campaign');
    const browserOperation = {
      op: 'addToken',
      token: {
        id: 'browser-token',
        kind: 'monster',
        name: '地精',
        entryId: 'MM__Goblin',
        x: 700,
        y: 500,
        size: 100,
        avatar: '/api/token/MM__Goblin',
        color: '#fff',
      },
    };

    const authorized = authorizeOperation(browserOperation, state, host);
    expect(authorized).toMatchObject({
      op: 'addToken',
      token: { name: '地精', entryId: 'MM__Goblin', avatar: '/api/token/MM__Goblin' },
    });

    expect(() => authorizeOperation({
      ...browserOperation,
      token: { ...browserOperation.token, avatar: 'https://tracker.example/goblin.png' },
    }, state, host)).toThrow('素材必须引用本站资料库或当前房间的私有素材');
  });

  it('keeps common board edits small while redacting another player identity', () => {
    const state = createInitialRoomState('Patch table', 'Patch campaign');
    const scene = activeScene(state);
    scene.players.push({
      id: 'other-player', kind: 'player', name: 'Other', entryId: null,
      x: 10, y: 20, size: 48, avatar: '', color: '#fff', sessionId: 'other-user',
    });
    const operation = {
      op: 'updatePlayer' as const,
      tokenId: 'other-player',
      patch: { name: 'Renamed', size: DEFAULT_TOKEN_SIZE, sessionId: 'other-user' },
    };
    applyOperation(state, operation);

    expect(projectPatchOperations(state, [operation], player)).toEqual([{
      op: 'updatePlayer', tokenId: 'other-player', patch: { name: 'Renamed', size: DEFAULT_TOKEN_SIZE, sessionId: null },
    }]);
    expect(projectPatchOperations(state, [{ op: 'updateMapScale', mapScale: 1.25 }], host)).toEqual([
      { op: 'updateMapScale', mapScale: 1.25 },
    ]);
  });

  it('authorizes and projects pixel-precise fog reveal boxes for moderators only', () => {
    const state = createInitialRoomState('Fog box table', 'Fog box campaign');
    const authorized = authorizeOperation({
      op: 'revealFogRect',
      rect: { x: 12.5, y: 27.25, w: 83.75, h: 46.5 },
    }, state, host);

    expect(authorized).toEqual({ op: 'revealFogRect', rect: { x: 12.5, y: 27.25, w: 83.75, h: 46.5 } });
    if (authorized.op !== 'revealFogRect') throw new Error('expected fog rectangle operation');
    applyOperation(state, authorized);
    expect(activeScene(state).fogReveals).toEqual([authorized.rect]);
    expect(projectPatchOperations(state, [authorized], player)).toEqual([authorized]);
    expect(() => authorizeOperation(authorized, state, player)).toThrow('当前身份不能执行此操作');
    expect(() => authorizeOperation({
      op: 'revealFogRect', rect: { x: 1590, y: 20, w: 20, h: 20 },
    }, state, host)).toThrow('迷雾框选区域超出地图范围');
  });

  it('does not send DM-only encounter changes to player patches and falls back only for generated initiative entries', () => {
    const state = createInitialRoomState('Patch table', 'Patch campaign');
    const addEnemy = { op: 'addEnemy' as const, entryId: 'MM__Goblin', nameZh: '地精' };
    applyOperation(state, addEnemy);
    expect(projectPatchOperations(state, [addEnemy], player)).toEqual([]);
    expect(projectPatchOperations(state, [{ op: 'advanceTurn' }], host)).toEqual([{ op: 'advanceTurn' }]);
    expect(projectPatchOperations(state, [{ op: 'addToInitiative', name: 'Goblin', value: 12, source: 'dm', tokenId: null }], host)).toBeNull();
  });

  it('authorizes campaign NPC archives and NPC map tokens for moderators only', () => {
    const state = createInitialRoomState('NPC table', 'NPC campaign');
    const upsert = authorizeOperation({
      op: 'upsertNpc',
      npc: {
        id: 'npc-joe', name: '老乔', aliases: ['乔老板'], role: '酒馆老板', location: '跃马旅店',
        status: 'active', notesMarkdown: '知道一条密道。', sourceFile: 'npc.md', updatedAt: 1,
      },
    }, state, host);
    applyOperation(state, upsert);

    expect(state.campaigns[state.currentCampaignId].npcs).toEqual([
      expect.objectContaining({ id: 'npc-joe', name: '老乔', updatedAt: expect.any(Number) }),
    ]);
    expect(projectPatchOperations(state, [upsert], host)).toEqual([upsert]);
    expect(projectPatchOperations(state, [upsert], player)).toEqual([]);
    expect(() => authorizeOperation(upsert, state, player)).toThrow('当前身份不能执行此操作');

    const addToken = authorizeOperation({
      op: 'addToken',
      token: {
        id: 'temporary', kind: 'npc', name: '老乔', entryId: 'npc:npc-joe',
        x: 100, y: 100, size: 100, avatar: '', color: '#0ea5e9',
      },
    }, state, host);
    expect(addToken).toMatchObject({ op: 'addToken', token: { kind: 'npc', entryId: 'npc:npc-joe' } });
    applyOperation(state, addToken);
    const secondToken = authorizeOperation({
      op: 'addToken',
      token: {
        id: 'temporary-two', kind: 'npc', name: '老乔', entryId: 'npc:npc-joe',
        x: 220, y: 100, size: 100, avatar: '', color: '#0ea5e9',
      },
    }, state, host);
    applyOperation(state, secondToken);
    expect(activeScene(state).tokens.map(token => token.number)).toEqual([1, 2]);
    expect(projectRoomState(state, player).campaign.npcs).toEqual([]);
  });

  it('rerolls a monster by token id instead of duplicating its initiative entry', () => {
    const state = createInitialRoomState('Initiative table', 'Initiative campaign');
    applyOperation(state, { op: 'addToInitiative', name: '地精 #1', value: 17, source: 'dm', tokenId: 'goblin-1' });
    const existingId = activeScene(state).initiative[0].id;

    applyOperation(state, { op: 'addToInitiative', name: '地精 #1', value: 8, source: 'dm', tokenId: 'goblin-1' });

    expect(activeScene(state).initiative).toEqual([
      expect.objectContaining({ id: existingId, tokenId: 'goblin-1', value: 8 }),
    ]);
  });

  it('keeps monster tokens and linked initiative entries synchronized in both delete directions', () => {
    const state = createInitialRoomState('Linked encounter', 'Linked campaign');
    const scene = activeScene(state);
    scene.tokens.push(
      { id: 'goblin-1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 100, y: 100, size: 100, avatar: '', color: '#fff' },
      { id: 'goblin-2', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 220, y: 100, size: 100, avatar: '', color: '#fff' },
    );
    applyOperation(state, { op: 'addToInitiative', name: '地精 #1', value: 15, source: 'dm', tokenId: 'goblin-1' });
    applyOperation(state, { op: 'addToInitiative', name: '地精 #2', value: 12, source: 'dm', tokenId: 'goblin-2' });

    applyOperation(state, { op: 'removeToken', tokenId: 'goblin-1' });
    expect(scene.tokens.map(token => token.id)).toEqual(['goblin-2']);
    expect(scene.initiative.map(entry => entry.tokenId)).toEqual(['goblin-2']);

    const secondInitiativeId = scene.initiative[0].id;
    applyOperation(state, { op: 'removeFromInitiative', entryId: secondInitiativeId });
    expect(scene.tokens).toEqual([]);
    expect(scene.initiative).toEqual([]);
  });

  it('does not remove a monster for an unlinked manual initiative entry', () => {
    const state = createInitialRoomState('Manual initiative', 'Manual campaign');
    const scene = activeScene(state);
    scene.tokens.push({ id: 'goblin', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 100, y: 100, size: 100, avatar: '', color: '#fff' });
    applyOperation(state, { op: 'addToInitiative', name: '环境效果', value: 20, source: 'dm', tokenId: null });
    applyOperation(state, { op: 'removeFromInitiative', entryId: scene.initiative[0].id });
    expect(scene.tokens.map(token => token.id)).toEqual(['goblin']);
  });

  it('keeps NPC tokens and linked initiative entries synchronized in both delete directions', () => {
    const state = createInitialRoomState('NPC initiative', 'NPC campaign');
    const scene = activeScene(state);
    scene.tokens.push({
      id: 'npc-token', kind: 'npc', name: '老乔', entryId: 'npc:npc-joe',
      x: 100, y: 100, size: 100, avatar: '', color: '#0ea5e9',
    });
    applyOperation(state, { op: 'addToInitiative', name: '老乔', value: 11, source: 'dm', tokenId: 'npc-token' });
    applyOperation(state, { op: 'removeFromInitiative', entryId: scene.initiative[0].id });
    expect(scene.tokens).toEqual([]);
    expect(scene.initiative).toEqual([]);
  });
});
