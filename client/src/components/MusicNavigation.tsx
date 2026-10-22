import Icon from './Icon';
export default function MusicNavigation({ campaign = false, active = false }: { campaign?: boolean; active?: boolean }) {
  return <a href="/music" className={campaign ? 'campaign-music-link' : `rail-destination ${active ? 'active' : ''}`} aria-label="配乐" aria-current={active ? 'page' : undefined}><Icon name="music" /><span>配乐</span>{!campaign && <span className="nav-index">05</span>}</a>;
}
