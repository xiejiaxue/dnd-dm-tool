// Dragon Heist faction quest chains, built from the DM's local knowledge base by
// scripts/build-faction-quests.ts. DM-only: served through a moderator module
// route, never bundled into the public client.

export interface QuestSection {
  heading: string;
  /** Lightweight Markdown (paragraphs, bold, quotes, lists, tables, ### headings); links removed. */
  markdown: string;
}

export interface QuestField { label: string; text: string }

/** One row of a quest card's 检定 table. */
export interface QuestCheck {
  situation: string;
  /** Ability (skill) or save, as written, e.g. 智力（调查）. */
  check: string;
  /** Usually a number; may read 13／16 or 对抗 for contested rolls. */
  dc: string;
  success: string;
  failure: string;
}

/** One row of a quest card's 战斗 table. */
export interface QuestEnemy {
  name: string;
  count: number;
  /** As written: 1/2, 3, or — for scenery without a stat block. */
  cr: string;
  /** Compendium or Waterdeep NPC id, when the creature has a stat card to place. */
  entryId?: string;
  notes: string;
}

export interface QuestEncounter {
  title: string;
  enemies: QuestEnemy[];
}

export interface FactionQuest {
  /** Stable across rebuilds: `<factionId>:<code>`; keys the campaign's progress record. */
  id: string;
  /** As printed in the notes, e.g. H1, C3, B6. */
  code: string;
  title: string;
  /** Columns of the quest table (goal, reward, follow-ups…), labelled as in the notes. */
  fields: QuestField[];
  /** Quest card text before its tables: briefing, scene, options. */
  body?: string;
  /** Quest card text after its tables: adjustments, rewards, failure. */
  outcome?: string;
  /** Suggested character level for four characters. */
  level?: number;
  checks?: QuestCheck[];
  encounters?: QuestEncounter[];
}

export interface FactionChain {
  id: string;
  kind: 'faction' | 'ally';
  name: string;
  tagline: string;
  /** Contact person and approach, from the index table. */
  contact?: string;
  /** What the faction wants. */
  goal?: string;
  /** Faction name used by the Waterdeep NPC catalogue, to list related NPCs. */
  npcFaction?: string;
  /** Lead-in notes printed under the title. */
  notes: string[];
  /** How to read the quest cards (level baseline, DC policy). */
  questNote?: string;
  quests: FactionQuest[];
  /** Everything else (how to make contact, boundaries, sources), in note order. */
  sections: QuestSection[];
}

export interface FactionQuestBook {
  title: string;
  /** Shared rules, conflict table, pacing and the DM record template. */
  overview: QuestSection[];
  chains: FactionChain[];
}

export const QUEST_STATUSES = ['open', 'active', 'done', 'failed'] as const;
export type QuestStatus = typeof QUEST_STATUSES[number];
export const QUEST_STATUS_LABELS: Record<QuestStatus, string> = { open: '未接', active: '进行中', done: '已完成', failed: '失败' };
/** Limit for a faction's DM note (contact log, promises, deadlines). */
export const FACTION_NOTE_LIMIT = 4_000;

type Tracking = { questProgress?: Record<string, QuestStatus>; factionNotes?: Record<string, string> };
type TrackingOp = { op: 'setQuestStatus'; questId: string; status: QuestStatus } | { op: 'setFactionNote'; factionId: string; note: string };

/**
 * The campaign's quest tracking after one DM edit, without mutating the input.
 * Shared by the room and the optimistic client so both agree. Default values
 * ('open', an empty note) are removed rather than stored.
 */
export function applyCampaignTracking(campaign: Tracking, op: TrackingOp): Tracking {
  if (op.op === 'setQuestStatus') {
    const { [op.questId]: _previous, ...rest } = campaign.questProgress ?? {};
    return { questProgress: op.status === 'open' ? rest : { ...rest, [op.questId]: op.status } };
  }
  const { [op.factionId]: _previous, ...rest } = campaign.factionNotes ?? {};
  const note = op.note.trim() ? op.note : '';
  return { factionNotes: note ? { ...rest, [op.factionId]: note } : rest };
}
