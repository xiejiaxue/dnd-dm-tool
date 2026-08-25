export const MAP_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
export const MAX_MAP_BYTES = 10 * 1024 * 1024;

const MAP_IMAGE_TYPES = new Set(MAP_IMAGE_ACCEPT.split(','));

export interface MapFileMetadata {
  type: string;
  size: number;
}

export function validateMapFile(file: MapFileMetadata): string | null {
  if (!MAP_IMAGE_TYPES.has(file.type)) {
    return '仅支持 JPEG、PNG、WebP 或 AVIF 格式的地图图片。';
  }
  if (file.size <= 0 || file.size > MAX_MAP_BYTES) {
    return '地图图片必须大于 0 且小于 10 MiB。';
  }
  return null;
}
