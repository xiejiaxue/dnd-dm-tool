type Listener = () => void;

const listeners = new Set<Listener>();

/** Opens the macro directory without coupling the board hotbar to QueryPanel state. */
export function openMacroLibrary(): void {
  for (const listener of listeners) listener();
}

export function subscribeMacroLibraryNavigation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
