import { DND5E_CHARACTER_SHEET_PLUGIN_MANIFEST } from '../../types';
import { extensionRegistry } from '../../extensions/registry';
import CharacterSheetPage from './CharacterSheetPage';
import CharacterImportSection from './CharacterImportSection';

let registered = false;

export function registerDnd5eCharacterSheetPlugin(): void {
  if (registered) return;
  registered = true;
  const manifest = DND5E_CHARACTER_SHEET_PLUGIN_MANIFEST;
  extensionRegistry.registerExtension({
    id: manifest.id,
    title: manifest.title,
    version: manifest.version,
    requiredCore: manifest.requiredCore,
  }, api => {
    api.standalonePage({
      id: `${manifest.id}.characters`,
      path: manifest.standalonePath,
      label: '创建 / 管理角色卡',
      description: '不进入房间，独立创建自己的 D&D 5e 玩家角色。',
      order: 10,
      component: CharacterSheetPage,
    });
    api.actorDirectorySection({
      id: `${manifest.id}.room-import`,
      order: 10,
      component: CharacterImportSection,
    });
  });
}
