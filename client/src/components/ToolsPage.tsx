import MusicBar from './MusicBar';
import MusicNavigation from './MusicNavigation';
import TavernNavigation from './TavernNavigation';
import TavernGame from './TavernGame';
import CharacterWorkshop from './CharacterWorkshop';
import QuickCalculator from './QuickCalculator';
import Icon from './Icon';
import DiceRoller from './DiceRoller';

export default function ToolsPage({ page }: { page: 'calculator' | 'characters' | 'dice' | 'music' | 'tavern' }) {
  return <div className="swiss-tools">
    <a className="skip-link" href="#tool-main">跳转到主要内容</a>
    <aside className="navigation-rail">
      <a className="brand-mark" href="/" aria-label="DM 追踪首页"><span className="brand-symbol"><Icon name="dice" /></span><span>DM<span className="brand-second">追踪</span></span></a>
      <div className="nav-caption">工具 / TOOLS</div>
      <nav aria-label="主导航">
        <a className="rail-destination" href="/"><Icon name="grid" /><span>我的桌团</span><span className="nav-index">01</span></a>
        <a className={`rail-destination ${page === 'calculator' ? 'active' : ''}`} aria-current={page === 'calculator' ? 'page' : undefined} href="/calculator"><Icon name="calculator" /><span className="nav-name-wide">临时计算器</span><span className="nav-name-short">计算器</span><span className="nav-index">02</span></a>
        <a className={`rail-destination ${page === 'characters' ? 'active' : ''}`} aria-current={page === 'characters' ? 'page' : undefined} href="/characters"><Icon name="users" /><span>角色卡</span><span className="nav-index">03</span></a>
        <a className={`rail-destination ${page === 'dice' ? 'active' : ''}`} aria-current={page === 'dice' ? 'page' : undefined} href="/dice"><Icon name="dice" /><span>掷骰</span><span className="nav-index">04</span></a>
        <MusicNavigation active={page === 'music'} />
        <TavernNavigation active={page === 'tavern'} />
      </nav>
    </aside>
    <main id="tool-main" className="tool-main" tabIndex={-1}>
      {page === 'tavern' ? <TavernGame /> : page === 'music' ? <MusicBar /> : page === 'dice' ? <DiceRoller /> : page === 'calculator' ? <QuickCalculator /> : <CharacterWorkshop />}
    </main>
  </div>;
}
