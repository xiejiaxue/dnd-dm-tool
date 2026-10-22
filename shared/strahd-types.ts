export interface StrahdEncounter {
  key: string; entryId: string; name: string; section: string; region: string;
  quantity: string; count: number | null; hp: number | null; initiativeBonus: number | null;
  condition: string; source: string; position: number[] | null; automatic: boolean;
}
export interface StrahdScene {
  key: string; name: string; chapter: string;
  map: { assetId: string; width: number; height: number; mapScale: number };
  encounters: StrahdEncounter[]; notes: string;
}
