import { useEffect, useState } from 'react';

export function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const image = new Image();
    image.src = url;
    image.onload = () => setImg(image);
    image.onerror = () => setImg(null);
    return () => { image.onload = null; image.onerror = null; };
  }, [url]);
  return img;
}
