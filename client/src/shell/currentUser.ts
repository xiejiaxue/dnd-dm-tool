import { api, type CurrentUser } from '../api';

let pending: Promise<CurrentUser> | undefined;

/**
 * One identity request per page load. The first visit mints the guest cookie,
 * so the rail and the lobby must share it instead of racing two requests.
 */
export function currentUser(refresh = false): Promise<CurrentUser> {
  if (refresh || !pending) {
    pending = api.me().catch(error => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}
