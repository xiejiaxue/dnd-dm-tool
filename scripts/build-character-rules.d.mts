export interface GeneratedCharacterRuleOption {
  id: string;
  kind: 'race' | 'class' | 'subclass' | 'background' | 'feat' | 'spell';
  name: string;
  nameEn: string;
  source: string;
  level?: number;
  parentName?: string;
  classNames?: string[];
  bookFile?: string;
}

export interface GeneratedCharacterRuleCatalog {
  schemaVersion: 1;
  generatedAt: number;
  sourceName: string;
  sourceUrl: string;
  sources: Array<{ id: string; abbreviation: string; name: string; core: boolean; description: string }>;
  options: GeneratedCharacterRuleOption[];
}

export function buildCharacterRuleCatalog(databaseDirectory?: string, outputFile?: string): GeneratedCharacterRuleCatalog;
