import type { ToolDocumentType } from '../../types';
export interface ToolTarget { type: ToolDocumentType; id?: string; }
type Listener = (target: ToolTarget) => void;
const listeners = new Set<Listener>();
let pending: ToolTarget | null = null;
export function openToolDocument(target: ToolTarget): void { pending = target; for (const listener of listeners) listener(target); }
export function subscribeToolNavigation(listener: Listener): () => void { listeners.add(listener); if (pending) listener(pending); return () => listeners.delete(listener); }

