import { describe, expect, it } from 'vitest';
import { getPublicSiteConfig } from '../src/public-config';

describe('public runtime configuration', () => {
  it('exposes only non-empty, bounded filing values', () => {
    expect(getPublicSiteConfig({
      PUBLIC_ICP_FILING: '京ICP备2025135198号-2',
      PUBLIC_PSB_FILING: '京公网安备11010802049213号',
    } as unknown as Env)).toEqual({
      icpFiling: '京ICP备2025135198号-2',
      publicSecurityFiling: '京公网安备11010802049213号',
    });
    expect(getPublicSiteConfig({ PUBLIC_ICP_FILING: '  ' } as unknown as Env)).toEqual({});
    expect(getPublicSiteConfig({ PUBLIC_PSB_FILING: 'x'.repeat(121) } as unknown as Env)).toEqual({});
  });
});
