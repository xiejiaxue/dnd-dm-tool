import Icon from './Icon';
export default function TavernNavigation({ active = false, campaign = false }: { active?: boolean; campaign?: boolean }) {
  return <a href={campaign ? `/tavern?campaign=${encodeURIComponent(location.pathname.split('/')[2] ?? '')}` : '/tavern'} className={campaign ? 'campaign-music-link' : `rail-destination ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><Icon name="tavern" /><span>酒馆经营</span>{!campaign && <span className="nav-index">06</span>}</a>;
}
