export type DocumentMutationAction = 'created' | 'updated' | 'deleted';

export interface CommittedDocumentMutation {
  action: DocumentMutationAction;
  documentType: string;
  documentId: string | null;
  path: string;
  value: unknown;
}

type Listener = (mutation: CommittedDocumentMutation) => void;

const listeners = new Set<Listener>();

/**
 * Keeps the HTTP client independent from the extension registry while still
 * exposing successful document transactions to the tabletop shell.
 */
export function subscribeDocumentMutations(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishDocumentMutation(url: string, method: string | undefined, value: unknown): void {
  const mutation = classifyDocumentMutation(url, method, value);
  if (!mutation) return;
  for (const listener of listeners) {
    try { listener(mutation); }
    catch (error) { console.warn('[extensions] document mutation listener failed', error); }
  }
}

export function classifyDocumentMutation(url: string, method: string | undefined, value: unknown): CommittedDocumentMutation | null {
  const action = mutationAction(method);
  if (!action) return null;
  const path = url.split(/[?#]/u, 1)[0] ?? url;
  const segments = path.split('/').filter(Boolean).map(segment => decodeURIComponentSafely(segment));
  const roomIndex = segments.findIndex((segment, index) => segment === 'rooms' && index > 0);
  if (roomIndex < 0 || segments.length <= roomIndex + 2) return null;
  const resource = segments[roomIndex + 2];
  const tail = segments.slice(roomIndex + 3);
  let documentType: string | null = null;
  let documentId: string | null = tail[0] ?? idFromValue(value);

  if (resource === 'actors' && tail[1] !== 'claim') documentType = 'actor';
  else if (resource === 'journals') {
    if (tail[1] === 'pages') {
      documentType = 'journalPage';
      documentId = tail[2] ?? idFromValue(value);
    } else documentType = 'journal';
  } else if (resource === 'macros' && tail[0] !== 'hotbar') documentType = 'macro';
  else if (resource === 'tools') documentType = ({
    items: 'item',
    'roll-tables': 'rollTable',
    playlists: 'playlist',
    'encounter-presets': 'encounterPreset',
  } as Record<string, string>)[tail[0] ?? ''] ?? null;
  else if (resource === 'folders' && tail[0]) {
    documentType = `${tail[0]}Folder`;
    documentId = tail[1] ?? idFromValue(value);
  }

  return documentType ? { action, documentType, documentId, path, value } : null;
}

function mutationAction(method: string | undefined): DocumentMutationAction | null {
  if (method?.toUpperCase() === 'POST') return 'created';
  if (method?.toUpperCase() === 'PATCH') return 'updated';
  if (method?.toUpperCase() === 'DELETE') return 'deleted';
  return null;
}

function idFromValue(value: unknown): string | null {
  return value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
    ? (value as { id: string }).id
    : null;
}

function decodeURIComponentSafely(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}
