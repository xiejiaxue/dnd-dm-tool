export function renderMarkup(s: string): string {
  return s
    .replace(/\{@([a-z]+)\s+([^}]+)\}/g, (_m, _tag, inner: string) => inner.split('|')[0])
    .replace(/\{\{([^}]+)\}\}/g, '$1');
}
