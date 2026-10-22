import { describe, expect, it } from 'vitest';
import { DEFAULT_TOKEN_SIZE } from '../../shared/types';
import {
  activeScene,
  activeCampaign,
  addScene,
  applyOperation,
  createInitialRoomState,
  currentEncounter,
  createSceneFolder,
  deleteSceneFolder,
  ensurePlayerToken,
  moveSceneToFolder,
  normalizeLegacyPlayerTokenSizes,
  projectRoomState,
  renameSceneFolder,
  updateSceneConfiguration,
  type RoomActor,
} from '../src/domain';
import { authorizeOperation } from '../src/board/operation-authorization';
import { projectPatchOperations } from '../src/board/patch-projection';
import { normalizeCampaignNpcs, normalizeEncounters, normalizeLegacyMapFog, normalizeSceneFolders, normalizeVisibilityState, removeRetiredAutoRoomData } from '../src/board/state-normalization';

const host: RoomActor = { userId: 'host-user', memberId: 'host-member', role: 'host', accessEpoch: 1 };
const player: RoomActor = { userId: 'viewer-user', memberId: 'viewer-member', role: 'player', accessEpoch: 1 };
const platformReader: RoomActor = {
  userId: 'platform-owner', memberId: 'platform-owner:platform-owner', role: 'spectator', accessEpoch: 1, platformOwner: true,
};

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

  it('updates wall Placeables and restores an exact fog snapshot', () => {
    const state = createInitialRoomState('Undo table', 'Undo campaign');
    const scene = activeScene(state);
    scene.walls.push({ id: 'wall-1', p1: [0, 0], p2: [50, 0] });
    const move = authorizeOperation({ op: 'updateWall', wallId: 'wall-1', patch: { p1: [20, 30], p2: [80, 30] } }, state, host);
    applyOperation(state, move);
    expect(scene.walls[0]).toEqual({ id: 'wall-1', p1: [20, 30], p2: [80, 30] });
    expect(projectPatchOperations(state, [move], player)).toEqual([move]);

    const restore = authorizeOperation({
      op: 'restoreFog', fog: [true, false, true], fogReveals: [{ x: 5, y: 6, w: 7, h: 8 }],
    }, state, host);
    applyOperation(state, restore);
    expect(scene.fog).toEqual([true, false, true]);
    expect(scene.fogReveals).toEqual([{ x: 5, y: 6, w: 7, h: 8 }]);
    expect(projectPatchOperations(state, [restore], player)).toEqual([restore]);
    expect(() => authorizeOperation(restore, state, player)).toThrow('当前身份不能执行此操作');
  });

  it('clears optional Token HP through the undo patch contract', () => {
    const state = createInitialRoomState('HP undo table', 'HP undo campaign');
    const scene = activeScene(state);
    scene.tokens.push({
      id: 'token-no-hp', kind: 'npc', name: 'Guide', entryId: null,
      x: 10, y: 20, size: 100, avatar: '', color: '#fff', hp: { current: 8, max: 8 },
    });
    const operation = authorizeOperation({ op: 'updateToken', tokenId: 'token-no-hp', patch: { hp: null } }, state, host);
    applyOperation(state, operation);
    expect(scene.tokens[0].hp).toBeUndefined();
  });

  it('updates every supported scene configuration field without activating it', () => {
    const state = createInitialRoomState('Config table', 'Config campaign');
    const originalSceneId = state.currentSceneId;
    const configured = addScene(state, '待配置');

    updateSceneConfiguration(state, configured.id, {
      name: '剧院', unlocked: false, mapScale: 1.5,
      grid: { size: 70, color: '#abcdef', offset: [4, 8], snap: false },
      playArea: { x: 10, y: 20, w: 900, h: 700 },
      initialView: { x: 100, y: 200, scale: 0.75 },
    });

    expect(state.currentSceneId).toBe(originalSceneId);
    expect(state.scenes[configured.id]).toMatchObject({
      name: '剧院', unlocked: false, mapScale: 1.5,
      grid: { size: 70, color: '#abcdef', offset: [4, 8], snap: false },
      playArea: { x: 10, y: 20, w: 900, h: 700 },
      initialView: { x: 100, y: 200, scale: 0.75 },
    });
  });

  it('does not send DM-only encounter changes to player patches and falls back only for generated initiative entries', () => {
    const state = createInitialRoomState('Patch table', 'Patch campaign');
    const addEnemy = { op: 'addEnemy' as const, entryId: 'MM__Goblin', nameZh: '地精' };
    applyOperation(state, addEnemy);
    expect(projectPatchOperations(state, [addEnemy], player)).toBeNull();
    expect(projectPatchOperations(state, [{ op: 'advanceTurn' }], host)).toBeNull();
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
    expect(projectPatchOperations(state, [upsert], player)).toBeNull();
    expect(projectPatchOperations(state, [upsert], platformReader)).toEqual([upsert]);
    expect(() => authorizeOperation(upsert, state, player)).toThrow('当前身份不能执行此操作');
    expect(() => authorizeOperation(upsert, state, platformReader)).toThrow('当前身份不能执行此操作');

    const addToken = authorizeOperation({
      op: 'addToken',
      token: {
        id: 'temporary', kind: 'npc', actorId: 'actor-old-joe', name: '老乔', entryId: 'npc:npc-joe',
        x: 100, y: 100, size: 100, avatar: '', color: '#0ea5e9',
      },
    }, state, host);
    expect(addToken).toMatchObject({ op: 'addToken', token: { kind: 'npc', actorId: 'actor-old-joe', entryId: 'npc:npc-joe' } });
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
    const actorPlayer = authorizeOperation({
      op: 'addPlayer',
      player: {
        id: 'actor-player-token', kind: 'player', actorId: 'actor-hero', name: '英雄', entryId: null,
        x: 340, y: 100, size: 100, avatar: '', color: '#38a169', sessionId: null,
      },
    }, state, host);
    expect(actorPlayer).toMatchObject({ op: 'addPlayer', player: { actorId: 'actor-hero', sessionId: null } });
    expect(projectRoomState(state, player).campaign.npcs).toEqual([]);
    expect(projectRoomState(state, platformReader)).toMatchObject({
      role: 'player',
      campaign: { npcs: [expect.objectContaining({ id: 'npc-joe' })] },
      viewer: { roomRole: 'spectator', canManage: false, canReadAll: true },
    });
  });

  it('enforces token, NPC document, HP, and combatant visibility in the server projection', () => {
    const state = createInitialRoomState('Secret table', 'Secret campaign');
    const scene = activeScene(state);
    const campaign = activeCampaign(state);
    campaign.npcs = [
      {
        id: 'npc-private', name: '幕后人', aliases: ['秘密别名'], role: '真正首领', location: '密室', status: 'active',
        faction: '秘密阵营', groupPath: ['秘密阵营'], statReference: { kind: 'custom' },
        notesMarkdown: '主持人秘密：他才是凶手。', playerAccess: 'none', publicDescription: '', sourceFile: 'private.md', updatedAt: 1,
      },
      {
        id: 'npc-limited', name: '旅店老板', aliases: ['秘密线人'], role: '密探', location: '地下室', status: 'missing',
        faction: '竖琴手', groupPath: ['竖琴手'], statReference: { kind: 'compendium', entryId: 'MM__Spy', nameZh: '间谍', nameEn: 'Spy' },
        notesMarkdown: '主持人秘密：正在调查反派。', playerAccess: 'limited', publicDescription: '玩家认识的一位热心老板。', sourceFile: 'limited.md', updatedAt: 2,
      },
      {
        id: 'npc-observer', name: '城卫队长', aliases: [], role: '隐藏身份', location: '秘密地点', status: 'dead',
        faction: '领主联盟', groupPath: ['领主联盟'], statReference: { kind: 'compendium', entryId: 'MM__Veteran', nameZh: '老兵', nameEn: 'Veteran' },
        notesMarkdown: '主持人秘密：受到威胁。', playerAccess: 'observer', publicDescription: '穿着城卫制服，态度严肃。', sourceFile: 'observer.md', updatedAt: 3,
      },
    ];
    scene.tokens = [
      {
        id: 'hidden-token', kind: 'monster', name: '夺心魔', entryId: 'MM__Mind Flayer', x: 100, y: 100, size: 100,
        avatar: '/api/token/MM__Mind Flayer', color: '#fff', hidden: true, hp: { current: 71, max: 71 },
      },
      {
        id: 'alias-token', kind: 'monster', name: '曼松', entryId: 'MM__Archmage', x: 200, y: 100, size: 100,
        avatar: '/api/token/MM__Archmage', color: '#fff', publicName: '蒙面法师', hpVisibility: 'bar', hp: { current: 50, max: 100 },
      },
      {
        id: 'unknown-token', kind: 'npc', name: '幕后人', entryId: 'npc:npc-private', x: 300, y: 100, size: 100,
        avatar: '', color: '#fff', hpVisibility: 'none', hp: { current: 99, max: 99 },
      },
    ];
    state.encounters.encounter = {
      id: 'encounter', sceneId: scene.id, name: '秘密遭遇', status: 'active', round: 2, turn: 0, createdAt: 1, endedAt: null,
      combatants: [
        { id: 'hidden-entry', name: '夺心魔', value: 20, source: 'dm', sessionId: null, tokenId: 'hidden-token', active: true },
        { id: 'alias-entry', name: '曼松', value: 18, source: 'dm', sessionId: null, tokenId: 'alias-token', active: false },
        { id: 'manual-secret', name: '巢穴行动', value: 10, source: 'dm', sessionId: null, tokenId: null, active: false, hidden: true },
      ],
    };
    state.currentEncounterId = 'encounter';

    const projected = projectRoomState(state, player);
    expect(projected.scene.tokens.map(token => token.id)).toEqual(['alias-token', 'unknown-token']);
    expect(projected.scene.tokens[0]).toMatchObject({ name: '蒙面法师', entryId: null, hpRatio: 50, hpVisibility: 'bar' });
    expect(projected.scene.tokens[0]).not.toHaveProperty('hp');
    expect(projected.scene.tokens[1]).toMatchObject({ entryId: null, hpVisibility: 'none' });
    expect(projected.scene.tokens[1]).not.toHaveProperty('hp');
    expect(projected.campaign.npcs).toEqual([
      expect.objectContaining({ id: 'npc-limited', notesMarkdown: '玩家认识的一位热心老板。', role: '', location: '', faction: '公开人物', statReference: undefined }),
      expect.objectContaining({ id: 'npc-observer', notesMarkdown: '穿着城卫制服，态度严肃。', role: '', location: '', faction: '公开人物', statReference: expect.objectContaining({ entryId: 'MM__Veteran' }) }),
    ]);
    expect(JSON.stringify(projected)).not.toContain('主持人秘密');
    expect(JSON.stringify(projected)).not.toContain('秘密别名');
    expect(projected.encounter).toMatchObject({ round: 2, turn: null });
    expect(projected.encounter?.combatants).toEqual([
      expect.objectContaining({ id: 'alias-entry', name: '蒙面法师', tokenId: 'alias-token' }),
    ]);

    expect(projectRoomState(state, host).scene.tokens.map(token => token.id)).toContain('hidden-token');
    expect(projectRoomState(state, host).encounter?.combatants).toHaveLength(3);
    expect(projectRoomState(state, platformReader).encounter?.combatants).toHaveLength(3);
  });

  it('authorizes visibility controls and falls back to role-aware snapshots for player clients', () => {
    const state = createInitialRoomState('Visibility ops', 'Visibility campaign');
    const added = authorizeOperation({
      op: 'addToken',
      token: {
        id: 'browser-id', kind: 'monster', name: '真正名称', entryId: 'MM__Goblin', x: 100, y: 100, size: 100,
        avatar: '/api/token/MM__Goblin', color: '#fff', hidden: true, publicName: '小型生物', hpVisibility: 'bar',
      },
    }, state, host);
    expect(added).toMatchObject({ token: { hidden: true, publicName: '小型生物', hpVisibility: 'bar' } });
    applyOperation(state, added);
    expect(projectPatchOperations(state, [added], player)).toEqual([]);

    const tokenId = activeScene(state).tokens[0].id;
    const reveal = authorizeOperation({ op: 'updateToken', tokenId, patch: { hidden: false } }, state, host);
    applyOperation(state, reveal);
    expect(projectPatchOperations(state, [reveal], player)).toBeNull();

    applyOperation(state, { op: 'addToInitiative', name: '真正名称', value: 12, source: 'dm', tokenId });
    const entryId = currentEncounter(state)!.combatants[0].id;
    const hideCombatant = authorizeOperation({ op: 'setCombatantHidden', entryId, hidden: true }, state, host);
    applyOperation(state, hideCombatant);
    expect(currentEncounter(state)?.combatants[0].hidden).toBe(true);
    expect(projectPatchOperations(state, [hideCombatant], player)).toBeNull();
    expect(() => authorizeOperation(hideCombatant, state, player)).toThrow('当前身份不能执行此操作');
  });

  it('removes malformed persisted visibility fields without changing legacy defaults', () => {
    const state = createInitialRoomState('Legacy visibility', 'Legacy visibility campaign');
    const scene = activeScene(state);
    scene.tokens.push({
      id: 'legacy', kind: 'monster', name: 'Legacy', entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#fff',
    });
    Object.assign(scene.tokens[0], { hidden: 'yes', hpVisibility: 'all', hpRatio: 99, publicName: '  Alias  ' });
    activeCampaign(state).npcs = [{
      id: 'legacy-npc', name: 'Legacy NPC', aliases: [], role: '', location: '', status: 'active', notesMarkdown: '',
      sourceFile: null, updatedAt: 0,
    }];
    Object.assign(activeCampaign(state).npcs![0], { playerAccess: 'everyone', publicDescription: 123 });

    expect(normalizeVisibilityState(state)).toBe(true);
    expect(scene.tokens[0]).toMatchObject({ publicName: 'Alias' });
    expect(scene.tokens[0]).not.toHaveProperty('hidden');
    expect(scene.tokens[0]).not.toHaveProperty('hpVisibility');
    expect(scene.tokens[0]).not.toHaveProperty('hpRatio');
    expect(activeCampaign(state).npcs![0]).not.toHaveProperty('playerAccess');
    expect(activeCampaign(state).npcs![0]).not.toHaveProperty('publicDescription');
    expect(projectRoomState(state, player).scene.tokens.map(token => token.id)).toEqual(['legacy']);
    expect(projectRoomState(state, player).campaign.npcs).toEqual([]);
  });

  it('migrates a legacy scene initiative queue into an independent encounter once', () => {
    const state = createInitialRoomState('Legacy combat', 'Legacy campaign');
    const scene = activeScene(state);
    scene.initiative = [
      { id: 'legacy-first', name: '先行者', value: 18, source: 'dm', sessionId: null, tokenId: 'token-1', active: true },
      { id: 'legacy-second', name: '后行者', value: 10, source: 'player', sessionId: 'player-user', tokenId: 'token-2', active: false },
    ];
    delete (state as Partial<typeof state>).encounters;
    delete (state as Partial<typeof state>).currentEncounterId;

    expect(normalizeEncounters(state)).toBe(true);
    expect(scene.initiative).toEqual([]);
    expect(currentEncounter(state)).toMatchObject({ status: 'active', round: 1, turn: 0 });
    expect(currentEncounter(state)?.combatants.map(entry => entry.id)).toEqual(['legacy-first', 'legacy-second']);
    expect(projectRoomState(state, host).scene.initiative.map(entry => entry.id)).toEqual(['legacy-first', 'legacy-second']);
    expect(normalizeEncounters(state)).toBe(false);
  });

  it('tracks encounter lifecycle, rounds, and turns independently from the map', () => {
    const state = createInitialRoomState('Round table', 'Round campaign');
    applyOperation(state, { op: 'addToInitiative', name: '游侠', value: 18, source: 'dm', tokenId: 'ranger' });
    applyOperation(state, { op: 'addToInitiative', name: '地精', value: 12, source: 'dm', tokenId: 'goblin' });
    const firstEncounterId = currentEncounter(state)!.id;
    expect(currentEncounter(state)).toMatchObject({ status: 'setup', round: 0, turn: null });

    applyOperation(state, { op: 'startEncounter' });
    expect(currentEncounter(state)).toMatchObject({ status: 'active', round: 1, turn: 0 });
    expect(currentEncounter(state)?.combatants.map(entry => entry.active)).toEqual([true, false]);

    applyOperation(state, { op: 'nextTurn' });
    expect(currentEncounter(state)).toMatchObject({ round: 1, turn: 1 });
    applyOperation(state, { op: 'nextTurn' });
    expect(currentEncounter(state)).toMatchObject({ round: 2, turn: 0 });
    applyOperation(state, { op: 'previousTurn' });
    expect(currentEncounter(state)).toMatchObject({ round: 1, turn: 1 });
    applyOperation(state, { op: 'nextRound' });
    expect(currentEncounter(state)).toMatchObject({ round: 2, turn: 0 });
    applyOperation(state, { op: 'previousRound' });
    expect(currentEncounter(state)).toMatchObject({ round: 1, turn: 1 });

    applyOperation(state, { op: 'endEncounter' });
    expect(currentEncounter(state)).toMatchObject({ status: 'ended', round: 1, turn: null, endedAt: expect.any(Number) });
    expect(currentEncounter(state)?.combatants.every(entry => !entry.active)).toBe(true);
    applyOperation(state, { op: 'createEncounter' });
    expect(currentEncounter(state)).toMatchObject({ status: 'setup', round: 0, turn: null, combatants: [] });
    expect(currentEncounter(state)?.id).not.toBe(firstEncounterId);
  });

  it('duplicates an ended encounter while preserving groups and resetting tactical state', () => {
    const state = createInitialRoomState('Repeat combat', 'Repeat campaign');
    applyOperation(state, { op: 'addToInitiative', name: '北门守卫', value: 14, source: 'dm', tokenId: 'guard' });
    const entry = currentEncounter(state)!.combatants[0];
    applyOperation(state, { op: 'updateCombatant', entryId: entry.id, patch: { group: '北门', turnState: 'ready', defeated: true } });
    const originalId = currentEncounter(state)!.id;
    applyOperation(state, { op: 'endEncounter' });
    applyOperation(state, { op: 'duplicateEncounter' });

    expect(currentEncounter(state)).toMatchObject({ status: 'setup', round: 0, turn: null });
    expect(currentEncounter(state)!.id).not.toBe(originalId);
    expect(currentEncounter(state)!.combatants).toEqual([
      expect.objectContaining({ name: '北门守卫', group: '北门', turnState: 'normal', defeated: false, active: false }),
    ]);
    expect(currentEncounter(state)!.combatants[0].id).not.toBe(entry.id);
  });

  it('rerolls a monster by token id instead of duplicating its initiative entry', () => {
    const state = createInitialRoomState('Initiative table', 'Initiative campaign');
    applyOperation(state, { op: 'addToInitiative', name: '地精 #1', value: 17, source: 'dm', tokenId: 'goblin-1' });
    const existingId = currentEncounter(state)!.combatants[0].id;

    applyOperation(state, { op: 'addToInitiative', name: '地精 #1', value: 8, source: 'dm', tokenId: 'goblin-1' });

    expect(currentEncounter(state)?.combatants).toEqual([
      expect.objectContaining({ id: existingId, tokenId: 'goblin-1', value: 8 }),
    ]);
  });

  it('keeps monster tokens and encounter combatants independent in both delete directions', () => {
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
    expect(currentEncounter(state)?.combatants.map(entry => entry.tokenId)).toEqual([null, 'goblin-2']);

    const secondInitiativeId = currentEncounter(state)!.combatants.find(entry => entry.tokenId === 'goblin-2')!.id;
    applyOperation(state, { op: 'removeFromInitiative', entryId: secondInitiativeId });
    expect(scene.tokens.map(token => token.id)).toEqual(['goblin-2']);
    expect(currentEncounter(state)?.combatants).toEqual([
      expect.objectContaining({ tokenId: null, name: '地精 #1' }),
    ]);
  });

  it('does not remove a monster for an unlinked manual initiative entry', () => {
    const state = createInitialRoomState('Manual initiative', 'Manual campaign');
    const scene = activeScene(state);
    scene.tokens.push({ id: 'goblin', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 100, y: 100, size: 100, avatar: '', color: '#fff' });
    applyOperation(state, { op: 'addToInitiative', name: '环境效果', value: 20, source: 'dm', tokenId: null });
    applyOperation(state, { op: 'removeFromInitiative', entryId: currentEncounter(state)!.combatants[0].id });
    expect(scene.tokens.map(token => token.id)).toEqual(['goblin']);
  });

  it('removes an NPC from combat without deleting its map token', () => {
    const state = createInitialRoomState('NPC initiative', 'NPC campaign');
    const scene = activeScene(state);
    scene.tokens.push({
      id: 'npc-token', kind: 'npc', name: '老乔', entryId: 'npc:npc-joe',
      x: 100, y: 100, size: 100, avatar: '', color: '#0ea5e9',
    });
    applyOperation(state, { op: 'addToInitiative', name: '老乔', value: 11, source: 'dm', tokenId: 'npc-token' });
    applyOperation(state, { op: 'removeFromInitiative', entryId: currentEncounter(state)!.combatants[0].id });
    expect(scene.tokens.map(token => token.id)).toEqual(['npc-token']);
    expect(currentEncounter(state)?.combatants).toEqual([]);
  });

  it('synchronizes defeated markers, skips defeated combatants, and ticks round durations', () => {
    const state = createInitialRoomState('Status encounter', 'Status campaign');
    const scene = activeScene(state);
    scene.tokens.push(
      { id: 'fighter', kind: 'monster', name: '斗士', entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#fff', conditions: [{ id: 'stunned', remainingRounds: 2 }] },
      { id: 'fallen', kind: 'monster', name: '倒下者', entryId: null, x: 100, y: 0, size: 100, avatar: '', color: '#fff' },
    );
    scene.players.push({
      id: 'hero', kind: 'player', name: '英雄', entryId: null, x: 200, y: 0, size: 100,
      avatar: '', color: '#38a169', sessionId: player.userId,
    });
    applyOperation(state, { op: 'addToInitiative', name: '斗士', value: 20, source: 'dm', tokenId: 'fighter' });
    applyOperation(state, { op: 'addToInitiative', name: '倒下者', value: 15, source: 'dm', tokenId: 'fallen' });
    applyOperation(state, { op: 'submitInitiative', name: '英雄', value: 10, tokenId: 'hero', sessionId: player.userId });
    const fallen = currentEncounter(state)!.combatants.find(entry => entry.tokenId === 'fallen')!;

    applyOperation(state, { op: 'updateCombatant', entryId: fallen.id, patch: { defeated: true } });
    expect(scene.tokens.find(token => token.id === 'fallen')?.conditions).toContainEqual({ id: 'dead', remainingRounds: null });
    applyOperation(state, { op: 'startEncounter' });
    applyOperation(state, { op: 'nextTurn' });
    expect(currentEncounter(state)?.combatants[currentEncounter(state)!.turn!]).toMatchObject({ tokenId: 'hero' });
    expect(authorizeOperation({ op: 'endMyTurn' }, state, player)).toEqual({ op: 'endMyTurn' });

    applyOperation(state, { op: 'endMyTurn' });
    expect(currentEncounter(state)).toMatchObject({ round: 2 });
    expect(scene.tokens.find(token => token.id === 'fighter')?.conditions).toEqual([{ id: 'stunned', remainingRounds: 1 }]);
    expect(currentEncounter(state)?.combatants[currentEncounter(state)!.turn!]).toMatchObject({ tokenId: 'fighter' });
    expect(() => authorizeOperation({ op: 'endMyTurn' }, state, player)).toThrow('现在不是你的行动');

    applyOperation(state, { op: 'updateToken', tokenId: 'fallen', patch: { conditions: [] } });
    expect(currentEncounter(state)?.combatants.find(entry => entry.tokenId === 'fallen')?.defeated).toBe(false);
  });
});
