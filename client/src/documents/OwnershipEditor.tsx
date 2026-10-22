import type { RoomMemberSummary } from '../api';
import type { DocumentOwnership, DocumentOwnershipLevel } from '../types';

interface Props {
  ownership: DocumentOwnership;
  members: RoomMemberSummary[];
  disabled?: boolean;
  onChange(next: DocumentOwnership): void;
}

const LEVELS: DocumentOwnershipLevel[] = ['none', 'limited', 'observer', 'owner'];

export default function OwnershipEditor({ ownership, members, disabled = false, onChange }: Props) {
  const playerMembers = members.filter(member => member.role === 'player' || member.role === 'spectator');
  return (
    <details className="mt-2 rounded border border-zinc-800 bg-zinc-950/30 px-2 py-1.5">
      <summary className="cursor-pointer select-none text-[11px] text-zinc-400">文档权限</summary>
      <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
        默认
        <PermissionSelect value={ownership.default} disabled={disabled} onChange={defaultLevel => onChange({ ...ownership, default: defaultLevel })} />
      </label>
      <div className="mt-1 space-y-1 border-t border-zinc-800/70 pt-1">
        {playerMembers.map(member => (
          <label key={member.userId} className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="min-w-0 flex-1 truncate">{member.displayName} · {member.role}</span>
            <PermissionSelect
              value={ownership.users[member.userId] ?? ownership.default}
              inherited={ownership.users[member.userId] === undefined}
              disabled={disabled}
              onChange={level => {
                const users = { ...ownership.users };
                if (level === ownership.default) delete users[member.userId];
                else users[member.userId] = level;
                onChange({ ...ownership, users });
              }}
            />
          </label>
        ))}
        {playerMembers.length === 0 && <p className="py-1 text-[10px] text-zinc-600">还没有玩家加入房间。</p>}
      </div>
      <p className="mt-1 text-[10px] leading-4 text-zinc-600">与默认值相同会清除个人覆盖；主持人始终拥有 Owner。</p>
    </details>
  );
}

function PermissionSelect({
  value,
  inherited = false,
  disabled,
  onChange,
}: {
  value: DocumentOwnershipLevel;
  inherited?: boolean;
  disabled?: boolean;
  onChange(value: DocumentOwnershipLevel): void;
}) {
  return (
    <select value={value} disabled={disabled} onChange={event => onChange(event.target.value as DocumentOwnershipLevel)}
      className="ml-auto rounded bg-zinc-800 px-2 py-1 text-zinc-300 disabled:opacity-50">
      {LEVELS.map(level => <option key={level} value={level}>{level}{inherited && level === value ? '（默认）' : ''}</option>)}
    </select>
  );
}
