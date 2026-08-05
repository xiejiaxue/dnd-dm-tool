import fs from 'node:fs';
import path from 'node:path';
import { Campaign } from './types';
import { createCampaign } from './campaign';

export class CampaignNotFoundError extends Error {
  constructor(id: string) {
    super(`campaign not found: ${id}`);
    this.name = 'CampaignNotFoundError';
  }
}

export class CampaignStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`invalid campaign id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<{ id: string; name: string }[]> {
    const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
    const out: { id: string; name: string }[] = [];
    for (const f of files) {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Campaign;
        out.push({ id: c.id, name: c.name });
      } catch { /* 忽略损坏文件 */ }
    }
    return out;
  }

  async all(): Promise<Campaign[]> {
    const out: Campaign[] = [];
    for (const { id } of await this.list()) {
      try { out.push(await this.get(id)); } catch { /* skip */ }
    }
    return out;
  }

  async create(name: string): Promise<Campaign> {
    const c = createCampaign(name);
    this.save(c);
    return c;
  }

  async get(id: string): Promise<Campaign> {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as Campaign;
    } catch {
      throw new CampaignNotFoundError(id);
    }
  }

  save(campaign: Campaign): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(campaign.id), JSON.stringify(campaign, null, 2));
  }

  async delete(id: string): Promise<void> {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  // Move a scene into this campaign, removing it from every other campaign.
  async assignScene(campaignId: string, sceneId: string): Promise<void> {
    for (const c of await this.all()) {
      if (c.id === campaignId) {
        if (!c.sceneIds.includes(sceneId)) c.sceneIds.push(sceneId);
      } else {
        c.sceneIds = c.sceneIds.filter(id => id !== sceneId);
      }
      this.save(c);
    }
  }
}
