import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('decoded image cache', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares one request and decode between preload and board rendering', async () => {
    let imageCount = 0;
    let decodeCount = 0;
    class FakeImage {
      decoding = 'auto';
      complete = true;
      naturalWidth = 1200;
      naturalHeight = 800;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() { imageCount += 1; }
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      async decode() { decodeCount += 1; }
    }
    vi.stubGlobal('Image', FakeImage);

    const { decodedImage, loadDecodedImage, preloadDecodedImage } = await import('../features/assets/imageCache');
    const first = loadDecodedImage('/api/maps/chapter-1');
    const second = loadDecodedImage('/api/maps/chapter-1');
    expect(second).toBe(first);

    await preloadDecodedImage('/api/maps/chapter-1');
    const image = await first;
    expect(imageCount).toBe(1);
    expect(decodeCount).toBe(1);
    expect(decodedImage('/api/maps/chapter-1')).toBe(image);
  });
});
