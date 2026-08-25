import { useEffect, useState } from 'react';
import { decodedImage, loadDecodedImage } from './features/assets/imageCache';

export function useImage(url: string | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  const cached = url ? decodedImage(url) : null;
  const current = url && loaded?.url === url ? loaded.image : cached;

  useEffect(() => {
    if (!url) { setLoaded(null); return; }
    let active = true;
    loadDecodedImage(url)
      .then(image => { if (active) setLoaded({ url, image }); })
      .catch(() => { if (active) setLoaded(null); });
    return () => { active = false; };
  }, [url]);

  // Never render the preceding scene's image under the new scene's tokens and
  // fog while the next URL is loading.
  return current;
}
