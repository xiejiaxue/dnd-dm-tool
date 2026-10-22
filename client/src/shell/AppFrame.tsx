import { Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { CurrentUser } from '../api';
import Icon from '../components/Icon';
import FilingFooter from '../components/FilingFooter';
import ErrorBoundary from './ErrorBoundary';
import { currentUser } from './currentUser';
import { navigate, shellPageFor, type ShellPage, type ToolPage } from './navigation';
import { DESTINATIONS, prefetchTool, toolComponents } from './tools';

/** Same-origin rail/lobby links switch pages in place instead of reloading. */
function interceptShellLink(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element).closest('a');
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || !shellPageFor(url.pathname)) return;
  event.preventDefault();
  navigate(`${url.pathname}${url.search}`);
}

function NavigationRail({ page }: { page: ShellPage }) {
  const [me, setMe] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let active = true;
    currentUser().then(user => { if (active) setMe(user); }, () => {});
    return () => { active = false; };
  }, []);

  return (
    <aside className="navigation-rail">
      <a className="brand-mark" href="/" aria-label="DM 追踪首页">
        <span className="brand-symbol"><Icon name="dice" /></span>
        <span>DM<span className="brand-second">追踪</span></span>
      </a>
      <div className="nav-caption">工具 / TOOLS</div>
      <nav aria-label="主导航">
        {DESTINATIONS.map((destination, index) => (
          <a
            key={destination.page}
            href={destination.href}
            className={`rail-destination ${page === destination.page ? 'active' : ''}`}
            aria-current={page === destination.page ? 'page' : undefined}
            onPointerEnter={() => prefetchTool(destination.page)}
            onFocus={() => prefetchTool(destination.page)}
          >
            <Icon name={destination.icon} />
            {destination.shortLabel
              ? <><span className="nav-name-wide">{destination.label}</span><span className="nav-name-short">{destination.shortLabel}</span></>
              : <span>{destination.label}</span>}
            <span className="nav-index">{String(index + 1).padStart(2, '0')}</span>
          </a>
        ))}
      </nav>
      <div className="rail-account">
        <span className="avatar"><Icon name="users" /></span>
        <div>
          <strong>{me?.displayName || '访客'}</strong>
          <small>{me ? '本机访客身份' : '正在加载…'}</small>
        </div>
      </div>
    </aside>
  );
}

/** Shown while a tool chunk downloads, so the page header never goes blank. */
function ToolPlaceholder({ page }: { page: ToolPage }) {
  const destination = DESTINATIONS.find(candidate => candidate.page === page)!;
  return (
    <div className="tool-placeholder" role="status" aria-live="polite">
      <header className="tool-heading">
        <div><span className="eyebrow">{destination.eyebrow}</span><h1>{destination.label}</h1></div>
        <span className="tool-status">载入中…</span>
      </header>
      <div className="tool-placeholder-body" aria-hidden="true"><span /><span /><span /></div>
    </div>
  );
}

function ToolView({ page }: { page: ToolPage }) {
  const Tool = toolComponents[page];
  return <Suspense fallback={<ToolPlaceholder page={page} />}><Tool /></Suspense>;
}

/**
 * One persistent frame for the lobby and every standalone tool. The rail stays
 * mounted while pages change; music keeps playing after its first visit.
 */
export default function AppFrame({ page, lobby }: { page: ShellPage; lobby: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  const [musicVisited, setMusicVisited] = useState(page === 'music');

  useEffect(() => {
    if (page === 'music') setMusicVisited(true);
    mainRef.current?.scrollTo({ top: 0 });
    const destination = DESTINATIONS.find(candidate => candidate.page === page);
    document.title = destination && page !== 'home' ? `${destination.label} · DM 追踪` : 'DM 追踪';
  }, [page]);

  return (
    <div className="swiss-tools" data-page={page} onClick={interceptShellLink}>
      <a className="skip-link" href="#tool-main">跳转到主要内容</a>
      <NavigationRail page={page} />
      <main id="tool-main" ref={mainRef} className={`tool-main ${page === 'home' ? 'is-lobby' : ''}`} tabIndex={-1}>
        <ErrorBoundary key={page}>
          {page === 'home' ? lobby : page !== 'music' && <ToolView page={page} />}
        </ErrorBoundary>
        {musicVisited && (
          <div hidden={page !== 'music'}>
            <ErrorBoundary><ToolView page="music" /></ErrorBoundary>
          </div>
        )}
        <FilingFooter />
      </main>
    </div>
  );
}
