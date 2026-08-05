import { Campaign } from './types';
import { newId } from './scene';

export function createCampaign(name: string): Campaign {
  return {
    id: newId('campaign'),
    name,
    sceneIds: [],
    enemies: [],
  };
}
