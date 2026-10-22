import { describe, expect, it, vi } from 'vitest';
import { ExtensionRegistry } from '../extensions/registry';
import { rollFormula } from '../extensions/core';
import { emitCommittedOperationHooks } from '../extensions/board-hooks';
import { classifyDocumentMutation } from '../extensions/mutation-events';

describe('extension registry', () => {
  it('requires command namespaces and prevents duplicate registration', () => {
    const registry = new ExtensionRegistry();
    registry.registerExtension({ id: 'sample', title: 'Sample', version: '1', requiredCore: '*' }, api => {
      api.command({ id: 'sample.run', title: 'Run', capability: 'board.read', parse: args => args, execute: () => undefined });
    });
    expect(registry.getCommand('sample.run')?.title).toBe('Run');
    expect(() => registry.registerExtension({ id: 'sample', title: 'Again', version: '1', requiredCore: '*' }, () => undefined)).toThrow();
  });

  it('mounts standalone plugin pages by route and prevents path collisions', () => {
    const registry = new ExtensionRegistry();
    const Page = () => null;
    registry.registerExtension({ id: 'character-sheet', title: 'Character', version: '1', requiredCore: '*' }, api => {
      api.standalonePage({
        id: 'character-sheet.page', path: '/characters', label: '角色卡', description: '个人角色卡', order: 20, component: Page,
      });
    });
    expect(registry.standalonePageForPath('/characters')).toMatchObject({ id: 'character-sheet.page', component: Page });
    expect(() => registry.registerExtension({ id: 'collision', title: 'Collision', version: '1', requiredCore: '*' }, api => {
      api.standalonePage({
        id: 'collision.page', path: '/characters', label: '冲突', description: '', order: 30, component: Page,
      });
    })).toThrow('already registered');
  });

  it('checks capabilities before executing stored macros', async () => {
    const registry = new ExtensionRegistry();
    const execute = vi.fn();
    registry.registerExtension({ id: 'gm-tools', title: 'GM', version: '1', requiredCore: '*' }, api => {
      api.command({ id: 'gm-tools.reveal', title: 'Reveal', capability: 'board.write', parse: args => args, execute });
    });
    const context = {
      roomRole: 'player', sceneId: 's1', sendOps: vi.fn(), roll: vi.fn(), notify: vi.fn(),
    };
    await expect(registry.execute({ commandId: 'gm-tools.reveal', args: {} }, context)).rejects.toThrow('权限');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rolls a declarative dice formula deterministically', () => {
    expect(rollFormula('2d6+3', () => 0)).toEqual({ formula: '2d6+3', rolls: [1, 1], modifier: 3, total: 5 });
  });

  it('emits lifecycle hooks for committed board operations', async () => {
    const registry = new ExtensionRegistry();
    const created = vi.fn();
    const turn = vi.fn();
    registry.registerExtension({ id: 'observer', title: 'Observer', version: '1', requiredCore: '*' }, api => {
      api.hook('tokenCreated', created);
      api.hook('turnChanged', turn);
    });
    await emitCommittedOperationHooks(registry, [
      { op: 'addToken', token: { id: 't1', kind: 'monster', name: 'Goblin', entryId: null, actorId: null, x: 1, y: 2, size: 1, avatar: '', color: '#fff' } },
      { op: 'nextTurn' },
    ], { roomSlug: 'room', sceneId: 'scene', revision: 2 });
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ sceneId: 'scene', token: expect.objectContaining({ id: 't1' }) }));
    expect(turn).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
  });

  it('classifies successful document mutations without treating claims or hotbars as documents', () => {
    expect(classifyDocumentMutation('/api/rooms/demo/actors', 'POST', { id: 'a1' })).toMatchObject({ action: 'created', documentType: 'actor', documentId: 'a1' });
    expect(classifyDocumentMutation('/api/rooms/demo/journals/j1/pages/p1', 'PATCH', { id: 'p1' })).toMatchObject({ action: 'updated', documentType: 'journalPage', documentId: 'p1' });
    expect(classifyDocumentMutation('/api/rooms/demo/actors/a1/claim', 'POST', {})).toBeNull();
    expect(classifyDocumentMutation('/api/rooms/demo/macros/hotbar/1', 'PATCH', {})).toBeNull();
  });

  it('isolates a failing extension hook from the remaining listeners', async () => {
    const registry = new ExtensionRegistry();
    const afterFailure = vi.fn();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registry.registerExtension({ id: 'faulty', title: 'Faulty', version: '1', requiredCore: '*' }, api => {
      api.hook('ready', () => { throw new Error('extension failure'); });
    });
    registry.registerExtension({ id: 'healthy', title: 'Healthy', version: '1', requiredCore: '*' }, api => {
      api.hook('ready', afterFailure);
    });
    await expect(registry.emit('ready', {})).resolves.toBeUndefined();
    expect(afterFailure).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith('[extensions] ready hook failed', expect.any(Error));
    warning.mockRestore();
  });
});
