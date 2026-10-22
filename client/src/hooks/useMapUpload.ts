import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { connection } from '../ws';
import { uploadImage } from '../upload';

export function useMapUpload(setInviteMessage: (message: string) => void) {
  const [uploadingMap, setUploadingMap] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mapUploadGeneration = useRef(0);
  const mapPreviewCleanup = useRef<(() => void) | null>(null);
  const mapPreviewUrl = useRef<string | null>(null);

  const clearMapPreview = () => {
    mapPreviewCleanup.current?.();
    mapPreviewCleanup.current = null;
    if (mapPreviewUrl.current) URL.revokeObjectURL(mapPreviewUrl.current);
    mapPreviewUrl.current = null;
  };

  useEffect(() => () => { clearMapPreview(); }, []);

  const onMapPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const uploadGeneration = ++mapUploadGeneration.current;
    clearMapPreview();
    setUploadingMap(true);
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      const dimensions = await new Promise<[number, number]>((resolve, reject) => {
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(new Error('无法读取地图图片'));
        image.src = previewUrl;
      });
      if (uploadGeneration !== mapUploadGeneration.current) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      const [width, height] = dimensions;
      const operation = {
        op: 'updateMap' as const,
        mapImage: previewUrl,
        mapSize: [width, height] as [number, number],
        playArea: { x: 0, y: 0, w: width, h: height },
      };
      mapPreviewUrl.current = previewUrl;
      mapPreviewCleanup.current = connection.previewOps([operation]);

      const url = await uploadImage(file, 'map');
      if (uploadGeneration !== mapUploadGeneration.current) return;
      // Publish only the R2 URL to other members; the blob preview never
      // leaves this browser and disappears as soon as the durable op is sent.
      clearMapPreview();
      connection.sendOps([{ ...operation, mapImage: url }]);
    } catch (error) {
      if (uploadGeneration === mapUploadGeneration.current) {
        const ownsPreview = mapPreviewUrl.current === previewUrl;
        clearMapPreview();
        if (!ownsPreview) URL.revokeObjectURL(previewUrl);
        setInviteMessage(error instanceof Error ? `上传失败：${error.message}` : '上传失败');
      }
    } finally {
      if (uploadGeneration === mapUploadGeneration.current) setUploadingMap(false);
    }
  };

  return { uploadingMap, fileRef, onMapPicked };
}
