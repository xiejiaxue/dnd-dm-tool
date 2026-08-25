interface ImageCacheRecord {
  image: HTMLImageElement;
  promise: Promise<HTMLImageElement>;
  ready: boolean;
  lastUsed: number;
}

const records = new Map<string, ImageCacheRecord>();
const MAX_DECODED_PIXELS = 16_000_000;
const MAX_ENTRIES = 64;
const LOAD_TIMEOUT_MS = 30_000;
let useClock = 0;

/** Return an already decoded image without starting a network request. */
export function decodedImage(url: string): HTMLImageElement | null {
  const record = records.get(url);
  if (!record?.ready) return null;
  touch(record);
  return record.image;
}

/**
 * Share both the HTTP request and browser decode between preloading and the
 * eventual React/Konva render. The small LRU keeps nearby maps hot without
 * retaining every large map a long-running campaign has ever opened.
 */
export function loadDecodedImage(url: string): Promise<HTMLImageElement> {
  const existing = records.get(url);
  if (existing) {
    touch(existing);
    return existing.promise;
  }

  const image = new Image();
  image.decoding = 'async';
  const record = {
    image,
    promise: Promise.resolve(image),
    ready: false,
    lastUsed: ++useClock,
  } satisfies ImageCacheRecord;

  record.promise = new Promise<HTMLImageElement>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => fail(new Error(`图片加载超时：${url}`)), LOAD_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (records.get(url) === record) records.delete(url);
      reject(error);
    };
    image.onerror = () => fail(new Error(`无法加载图片：${url}`));
    image.onload = async () => {
      if (settled) return;
      // onload means the bytes are available; decode() moves the expensive
      // bitmap decode ahead of a scene switch when the browser supports it.
      try { await image.decode?.(); } catch { /* A loaded image is still usable. */ }
      if (settled) return;
      settled = true;
      cleanup();
      record.ready = true;
      touch(record);
      trimCache(url);
      resolve(image);
    };
    image.src = url;
  });
  records.set(url, record);
  return record.promise;
}

/** Warm an image but never surface an unhandled rejection to event handlers. */
export async function preloadDecodedImage(url: string): Promise<void> {
  await loadDecodedImage(url);
}

/**
 * Keep the old scene visible while a clicked map is warming, but cap the wait
 * so a missing image never blocks scene control indefinitely.
 */
export async function waitForDecodedImage(url: string, maximumWaitMs = 5_000): Promise<void> {
  if (decodedImage(url)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    loadDecodedImage(url).then(() => undefined),
    new Promise<void>(resolve => { timer = setTimeout(resolve, maximumWaitMs); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function touch(record: ImageCacheRecord): void {
  record.lastUsed = ++useClock;
}

function trimCache(protectedUrl: string): void {
  const ready = [...records.entries()]
    .filter((entry): entry is [string, ImageCacheRecord] => entry[1].ready)
    .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
  let pixels = ready.reduce((total, [, record]) => total + imagePixels(record.image), 0);
  let count = records.size;
  for (const [url, record] of ready) {
    if (pixels <= MAX_DECODED_PIXELS && count <= MAX_ENTRIES) break;
    if (url === protectedUrl) continue;
    records.delete(url);
    pixels -= imagePixels(record.image);
    count -= 1;
  }
}

function imagePixels(image: HTMLImageElement): number {
  return Math.max(1, image.naturalWidth) * Math.max(1, image.naturalHeight);
}
