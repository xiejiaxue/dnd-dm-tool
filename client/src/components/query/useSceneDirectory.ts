import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { Campaign, Scene } from '../../types';

export function useSceneDirectory(sceneIds: Campaign['sceneIds'] | undefined) {
  const [sceneNames, setSceneNames] = useState<Record<string, { name: string; unlocked: boolean }>>({});
  useEffect(() => {
    api.scenes().then(list => setSceneNames(Object.fromEntries(list.map(s => [s.id, { name: s.name, unlocked: s.unlocked }])))).catch(() => {});
  }, [sceneIds]);
  const [preview, setPreview] = useState<Scene | null>(null);
  const unlockedScenes = (sceneIds ?? []).filter(sid => sceneNames[sid]?.unlocked ?? false);
  const openPreview = (sid: string) => api.scene(sid).then(setPreview).catch(() => {});
  const closePreview = () => setPreview(null);

  return { sceneNames, unlockedScenes, preview, openPreview, closePreview };
}
