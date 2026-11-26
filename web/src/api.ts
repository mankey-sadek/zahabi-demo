// Thin API client. The shop is never sent by the client: it lives in the token.

export type Session = { kind: 'shop'; token: string; tenantName: string; userName: string } | { kind: 'platform'; token: string };

const KEY = 'zahabi-demo-session';

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(`/api/v2${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('، ') : data?.message ?? 'حصل خطأ';
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export const money = (egp: number) => `${egp.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
export const grams = (g: number) => `${g.toLocaleString('ar-EG', { maximumFractionDigits: 3 })} جم`;
export const when = (iso: string) => new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
