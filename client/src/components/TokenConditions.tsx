import { CONDITIONS, conditionInfo, setConditionRounds, toggleCondition, type ConditionId, type TokenCondition } from '../../../shared/conditions';

const ROUND_CHOICES = [1, 2, 3, 5, 10, 100];

interface Props {
  conditions: TokenCondition[] | undefined;
  onChange: (conditions: TokenCondition[]) => void;
}

/** Conditions on the selected token: each with its remaining rounds, plus a picker for the rest. */
export default function TokenConditions({ conditions = [], onChange }: Props) {
  const absent = CONDITIONS.filter(condition => !conditions.some(active => active.id === condition.id));
  return <div className="token-conditions" role="group" aria-label="状态">
    {conditions.map(condition => {
      const info = conditionInfo(condition.id);
      if (!info) return null;
      return <span key={condition.id} className="token-condition-chip" style={{ borderColor: info.color }}>
        <i style={{ background: info.color }} aria-hidden="true">{info.badge}</i>
        {info.label}
        <select aria-label={`${info.label}持续轮数`} title="在该棋子回合开始时减一轮，到 0 自动解除"
          value={condition.rounds ?? ''} onChange={event => onChange(setConditionRounds(conditions, condition.id, event.target.value ? Number(event.target.value) : undefined))}>
          <option value="">持续</option>
          {[...new Set([...ROUND_CHOICES, ...(condition.rounds ? [condition.rounds] : [])])].sort((a, b) => a - b).map(rounds => <option key={rounds} value={rounds}>{rounds} 轮</option>)}
        </select>
        <button type="button" aria-label={`解除${info.label}`} onClick={() => onChange(toggleCondition(conditions, condition.id))}>✕</button>
      </span>;
    })}
    {absent.length > 0 && <select className="token-condition-add" aria-label="添加状态" value="" onChange={event => { if (event.target.value) onChange(toggleCondition(conditions, event.target.value as ConditionId)); }}>
      <option value="">＋ 状态</option>
      {absent.map(condition => <option key={condition.id} value={condition.id}>{condition.label}</option>)}
    </select>}
  </div>;
}
