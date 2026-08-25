import { useEffect, useState } from 'react';
import { api } from '../../api';

export interface SceneCatalogEntry {
  name: string;
  unlocked: boolean;
  mapImage: string | null;
  folderId: string | null;
}

/** Keeps the campaign's scene identifiers separate from their HTTP metadata. */
export function useSceneCatalog(sceneIds: readonly string[]) {
  const [scenes, setScenes] = useState<Record<string, SceneCatalogEntry>>({});
  const sceneKey = sceneIds.join('\u0000');

  useEffect(() => {
    let active = true;
    api.scenes()
      .then((list) => {
        if (!active) return;
        setScenes(Object.fromEntries(list.map((scene) => [scene.id, {
          name: scene.name,
          unlocked: scene.unlocked,
          mapImage: scene.mapImage,
          folderId: scene.folderId,
        }])));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [sceneKey]);

  return scenes;
}
