import { useMemo } from 'react';
import { Group, Shape } from 'react-konva';
import type { Scene } from '../../types';
import type { RoomViewRole } from '../../ws';
import { coveredFogRects } from './geometry';

const FOG_COLOR: Record<RoomViewRole, string> = {
  dm: 'rgba(245,158,11,0.35)',
  player: '#0f1115',
  spectator: '#0f1115',
};

/** Cosmetic fog projection, memoized independently from token rendering. */
export default function FogOverlay({ scene, role, mapScale = scene.mapScale ?? 1 }: { scene: Scene; role: RoomViewRole; mapScale?: number }) {
  return useMemo(() => {
    const color = FOG_COLOR[role];
    const width = scene.mapImage ? scene.mapSize[0] : scene.playArea.w;
    const height = scene.mapImage ? scene.mapSize[1] : scene.playArea.h;
    const scale = scene.mapImage ? mapScale : 1;
    const covered = coveredFogRects(scene);
    return (
      <Group listening={false} scaleX={scale} scaleY={scale} clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
        <Shape
          fill={color}
          listening={false}
          sceneFunc={(context, shape) => {
            context.beginPath();
            for (const rect of covered) context.rect(rect.x, rect.y, rect.w, rect.h);
            context.fillShape(shape);
          }}
        />
      </Group>
    );
  }, [scene.fog, scene.fogReveals, scene.mapImage, scene.mapSize, scene.playArea, role, mapScale]);
}
