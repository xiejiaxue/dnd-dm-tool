import { useEffect, useState } from 'react';
import { api, type PublicSiteConfig } from '../api';

const ICP_URL = 'https://beian.miit.gov.cn/';
const PSB_URL = 'https://beian.mps.gov.cn/#/query/webSearch?code=11010802049213';

/** Renders nothing unless the Worker explicitly exposes a filing value. */
export default function FilingFooter() {
  const [config, setConfig] = useState<PublicSiteConfig | null>(null);

  useEffect(() => {
    let active = true;
    void api.publicConfig().then(
      value => { if (active) setConfig(value); },
      () => { /* Legal notices remain hidden if the public config is unavailable. */ },
    );
    return () => { active = false; };
  }, []);

  if (!config?.icpFiling && !config?.publicSecurityFiling) return null;

  return (
    <footer className="shrink-0 border-t border-line bg-paper px-4 py-2 text-center text-xs text-muted" role="contentinfo">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {config.icpFiling && (
          <a href={ICP_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
            {config.icpFiling}
          </a>
        )}
        {config.publicSecurityFiling && (
          <a href={PSB_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
            {config.publicSecurityFiling}
          </a>
        )}
      </div>
    </footer>
  );
}
