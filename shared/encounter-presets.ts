/** A keyed encounter on one module map: who, how many, where (normalised to the map image) and when. */
export interface PresetEncounter {
  key: string; entryId: string; name: string; section: string; region: string;
  quantity: string; count: number | null; hp: number | null; initiativeBonus: number | null;
  condition: string; source: string; position: number[] | null; automatic: boolean;
  /** Starting HP when below the card's maximum, such as a captive found at 1 HP. */
  currentHp?: number;
  /** Token width in grid squares relative to a medium creature (tiny 0.5, large 2). */
  tokenScale?: number;
}
export interface PresetArea { key: string; name: string; text: string }
export interface PresetScene {
  key: string; name: string; chapter: string;
  map: { assetId: string; width: number; height: number; mapScale: number };
  encounters: PresetEncounter[]; notes: string;
  /** Pixel width of a medium token on this map; when absent the size follows the map width. */
  tokenSize?: number;
  /** Keyed room notes for the DM, in map order. */
  areas?: PresetArea[];
}
