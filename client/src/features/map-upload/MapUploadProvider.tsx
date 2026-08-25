import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { api } from '../../api';
import { connection } from '../../ws';
import { MAP_IMAGE_ACCEPT, validateMapFile } from './validation';

interface MapUploadContextValue {
  openPicker: () => void;
  uploading: boolean;
}

const MapUploadContext = createContext<MapUploadContextValue | null>(null);

export function useMapUpload(): MapUploadContextValue {
  const value = useContext(MapUploadContext);
  if (!value) throw new Error('useMapUpload must be used inside MapUploadProvider');
  return value;
}

export function MapUploadProvider({ children }: { children: ReactNode }) {
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadGeneration = useRef(0);
  const previewCleanup = useRef<(() => void) | null>(null);
  const previewUrl = useRef<string | null>(null);

  const clearPreview = useCallback(() => {
    previewCleanup.current?.();
    previewCleanup.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  }, []);

  useEffect(() => clearPreview, [clearPreview]);

  const openPicker = useCallback(() => {
    if (uploading) return;
    setNotice(null);
    fileRef.current?.click();
  }, [uploading]);

  const onFilePicked = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const validationError = validateMapFile(file);
    if (validationError) {
      setNotice(validationError);
      return;
    }

    const generation = ++uploadGeneration.current;
    clearPreview();
    setUploading(true);
    const localUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      const [width, height] = await new Promise<[number, number]>((resolve, reject) => {
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(new Error('无法读取地图图片'));
        image.src = localUrl;
      });
      if (generation !== uploadGeneration.current) {
        URL.revokeObjectURL(localUrl);
        return;
      }

      previewUrl.current = localUrl;
      previewCleanup.current = connection.previewOps([{
        op: 'updateMap',
        mapImage: localUrl,
        mapSize: [width, height],
        playArea: { x: 0, y: 0, w: width, h: height },
      }]);

      await api.uploadMap(file, width, height);
      if (generation !== uploadGeneration.current) return;
      clearPreview();
      setNotice(`地图已上传并同步（${width} × ${height}）。`);
    } catch (error) {
      if (generation === uploadGeneration.current) {
        const ownsPreview = previewUrl.current === localUrl;
        clearPreview();
        if (!ownsPreview) URL.revokeObjectURL(localUrl);
        setNotice(error instanceof Error ? `上传失败：${error.message}` : '上传失败');
      }
    } finally {
      if (generation === uploadGeneration.current) setUploading(false);
    }
  }, [clearPreview]);

  const value = useMemo(() => ({ openPicker, uploading }), [openPicker, uploading]);

  return (
    <MapUploadContext.Provider value={value}>
      {children}
      <input
        ref={fileRef}
        type="file"
        accept={MAP_IMAGE_ACCEPT}
        className="hidden"
        aria-label="选择地图图片"
        onChange={onFilePicked}
      />
      {notice && (
        <div className="fixed top-14 right-3 z-50 max-w-md rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-xl text-zinc-200">
          <button onClick={() => setNotice(null)} className="float-right ml-3 text-zinc-500 hover:text-white" aria-label="关闭地图提示">✕</button>
          {notice}
        </div>
      )}
    </MapUploadContext.Provider>
  );
}
