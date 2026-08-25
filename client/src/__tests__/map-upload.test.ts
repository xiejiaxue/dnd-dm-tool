import { describe, expect, it } from 'vitest';
import { MAX_MAP_BYTES, validateMapFile } from '../features/map-upload/validation';

describe('map upload validation', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])('accepts %s', type => {
    expect(validateMapFile({ type, size: 1024 })).toBeNull();
  });

  it('rejects unsupported image types before sending a request', () => {
    expect(validateMapFile({ type: 'image/gif', size: 1024 })).toContain('仅支持');
  });

  it('rejects empty and oversized maps', () => {
    expect(validateMapFile({ type: 'image/png', size: 0 })).toContain('10 MiB');
    expect(validateMapFile({ type: 'image/png', size: MAX_MAP_BYTES + 1 })).toContain('10 MiB');
  });
});
