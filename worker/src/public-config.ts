/**
 * Public runtime configuration deliberately lives in the Worker, rather than
 * in Vite's build-time environment.  That lets one immutable client build be
 * deployed with different public-facing legal notices, while keeping secrets
 * out of both the bundle and this endpoint.
 */
export interface PublicSiteConfig {
  icpFiling?: string;
  publicSecurityFiling?: string;
}

type EnvWithPublicSiteConfig = Env & {
  PUBLIC_ICP_FILING?: unknown;
  PUBLIC_PSB_FILING?: unknown;
};

const MAX_FILING_LENGTH = 120;

function publicText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_FILING_LENGTH ? normalized : undefined;
}

export function getPublicSiteConfig(env: Env): PublicSiteConfig {
  const runtime = env as EnvWithPublicSiteConfig;
  const icpFiling = publicText(runtime.PUBLIC_ICP_FILING);
  const publicSecurityFiling = publicText(runtime.PUBLIC_PSB_FILING);
  return {
    ...(icpFiling ? { icpFiling } : {}),
    ...(publicSecurityFiling ? { publicSecurityFiling } : {}),
  };
}
