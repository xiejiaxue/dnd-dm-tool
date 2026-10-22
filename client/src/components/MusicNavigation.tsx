import Icon from './Icon';
export default function MusicNavigation({ campaign = false, active = false }: { campaign?: boolean; active?: boolean }) {
  return <a href="/music" target={campaign ? "_blank" : undefined} rel={campaign ? "noreferrer" : undefined} title={campaign ? "在新标签页打开配乐，桌面保持连接" : undefined} className={campaign ? 'campaign-music-link' : `rail-destination ${active ? 'active' : ''}`} aria-label="配乐" aria-current={active ? 'page' : undefined}><Icon name="music" /><span>配乐</span>{!campaign && <span className="nav-index">05</span>}</a>;
}
