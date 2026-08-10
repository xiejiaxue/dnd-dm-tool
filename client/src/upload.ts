import { api } from './api';

// Upload a local image (map or token) to the current room's private asset
// route. The Worker authorizes the request from its HttpOnly session cookie.
export async function uploadImage(file: File, kind: 'map' | 'token'): Promise<string> {
  const asset = await api.uploadAsset(file, kind);
  return asset.url;
}
