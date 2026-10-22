import { useEffect, useRef } from 'react';
import { useScene } from '../../ws';
import { useActionLog } from '../action-log/ActionLogContext';

interface EncounterMarker {
  id: string;
  status: string;
  round: number;
  turn: number | null;
}

/** Records the authoritative encounter lifecycle without coupling the combat
 * tracker UI to persistence. A local marker also prevents reconnect renders
 * from producing duplicate history entries. */
export default function EncounterEventLogger({ roomSlug }: { roomSlug: string }) {
  const { role, encounter } = useScene();
  const { record } = useActionLog();
  const writing = useRef(false);

  useEffect(() => {
    if (role !== 'dm' || !encounter || writing.current) return;
    const key = `dndboard:encounter-marker:${roomSlug}`;
    const current: EncounterMarker = { id: encounter.id, status: encounter.status, round: encounter.round, turn: encounter.turn };
    const previous = readMarker(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(current));
    if (!previous || previous.id !== current.id) return;

    let label = '';
    if (previous.status !== current.status) {
      if (current.status === 'active') label = `战斗开始：${encounter.name}`;
      if (current.status === 'ended') label = `战斗结束：${encounter.name}`;
    } else if (current.status === 'active' && previous.round !== current.round) {
      label = `进入第 ${current.round} 轮`;
    } else if (current.status === 'active' && previous.turn !== current.turn) {
      const active = current.turn == null ? null : encounter.combatants[current.turn];
      if (active) label = `第 ${current.round} 轮：${active.name} 的行动`;
    }
    if (!label) return;

    writing.current = true;
    void record('encounter', label, {
      encounterId: encounter.id,
      status: encounter.status,
      round: encounter.round,
      turn: encounter.turn,
    }).catch(() => {}).finally(() => { writing.current = false; });
  }, [encounter, record, role, roomSlug]);
  return null;
}

function readMarker(value: string | null): EncounterMarker | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<EncounterMarker>;
    if (typeof parsed.id !== 'string' || typeof parsed.status !== 'string' || !Number.isFinite(parsed.round)) return null;
    return { id: parsed.id, status: parsed.status, round: parsed.round!, turn: typeof parsed.turn === 'number' ? parsed.turn : null };
  } catch {
    return null;
  }
}
