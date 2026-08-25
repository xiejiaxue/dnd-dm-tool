import { describe, expect, it } from 'vitest';
import { groupCampaignScenes } from '../features/campaign/CampaignSceneLibrary';

describe('campaign scene folders', () => {
  it('keeps folder order and puts missing or stale assignments in ungrouped', () => {
    expect(groupCampaignScenes(
      ['scene-1', 'scene-2', 'scene-3', 'scene-4'],
      [{ id: 'chapter-1', name: '第一章' }, { id: 'chapter-2', name: '第二章' }],
      { 'scene-1': 'chapter-1', 'scene-2': 'chapter-2', 'scene-3': 'deleted-folder' },
    )).toEqual([
      { folder: { id: 'chapter-1', name: '第一章' }, sceneIds: ['scene-1'] },
      { folder: { id: 'chapter-2', name: '第二章' }, sceneIds: ['scene-2'] },
      { folder: null, sceneIds: ['scene-3', 'scene-4'] },
    ]);
  });
});
