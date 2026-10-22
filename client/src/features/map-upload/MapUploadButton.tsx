import { useMapUpload } from './MapUploadProvider';

interface Props {
  variant?: 'topbar' | 'toolbar';
  active?: boolean;
}

export default function MapUploadButton({ variant = 'topbar', active = false }: Props) {
  const { openPicker, uploading } = useMapUpload();
  if (variant === 'toolbar') {
    return (
      <button
        title={uploading ? '正在上传地图' : '上传地图'}
        aria-label={uploading ? '正在上传地图' : '上传地图'}
        onClick={openPicker}
        disabled={uploading}
        className={`w-9 h-9 rounded-md flex items-center justify-center text-lg disabled:opacity-50 ${active ? 'bg-amber-600/30 text-amber-400' : 'hover:bg-zinc-700 text-zinc-300'}`}
      >{uploading ? '…' : '🗺'}</button>
    );
  }

  return (
    <button
      onClick={openPicker}
      disabled={uploading}
      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 whitespace-nowrap"
      title="上传地图底图"
    >{uploading ? '上传地图…' : '上传地图'}</button>
  );
}
