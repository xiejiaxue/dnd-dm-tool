// Upload a local image (map or token) to the server and return its URL.
export async function uploadImage(file: File, kind: 'map' | 'token'): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/upload/${kind}`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('upload failed');
  const b = await res.json();
  return b.url as string;
}
