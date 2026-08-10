export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message }, requestId }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error(JSON.stringify({ event: 'request_failed', requestId, message }));
  return json({ error: { code: 'INTERNAL', message: '服务器暂时无法处理请求' }, requestId }, { status: 500 });
}

export function requestId(request: Request): string {
  return request.headers.get('cf-ray') ?? crypto.randomUUID();
}

export async function readJsonObject(request: Request, maximumBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求必须是 JSON 对象');
  }
  if (!isRecord(value)) throw new HttpError(400, 'INVALID_JSON', '请求必须是 JSON 对象');
  return value;
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) throw new HttpError(403, 'ORIGIN_DENIED', '缺少可信来源');
  let claimed: URL;
  let target: URL;
  try {
    claimed = new URL(origin);
    target = new URL(request.url);
  } catch {
    throw new HttpError(403, 'ORIGIN_DENIED', '来源不受信任');
  }
  if (claimed.origin === target.origin) return;

  // Vite's development proxy intentionally uses :5173 while Wrangler listens
  // on :8787. Permit only a same-host localhost pair; production stays exact.
  const localHost = (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  if (localHost(claimed.hostname) && claimed.hostname === target.hostname && target.protocol === 'http:') return;
  throw new HttpError(403, 'ORIGIN_DENIED', '来源不受信任');
}

export function routeParts(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

export function nonEmptyText(value: unknown, label: string, maximumLength = 120): string {
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_INPUT', `${label}无效`);
  const text = value.trim();
  if (text.length === 0 || text.length > maximumLength) throw new HttpError(400, 'INVALID_INPUT', `${label}长度无效`);
  return text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function withSetCookie(response: Response, cookie: string | undefined): Response {
  // A route such as logout may intentionally clear the cookie. Never append a
  // newly-created session after that explicit response cookie.
  if (!cookie || response.headers.has('set-cookie')) return response;
  const headers = new Headers(response.headers);
  headers.append('set-cookie', cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
