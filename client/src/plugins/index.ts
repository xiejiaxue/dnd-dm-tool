import { registerDnd5eCharacterSheetPlugin } from './dnd5e-character-sheet';

/** Compile-time installation list. Core startup does not know plugin details. */
export function registerInstalledPlugins(): void {
  registerDnd5eCharacterSheetPlugin();
}
