let csrfToken = '';
export function setCsrf(value: string) {
  csrfToken = value;
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export const post = (path: string, body: any = {}) =>
  api(path, { method: 'POST', body: JSON.stringify(body) });
export const put = (path: string, body: any) =>
  api(path, { method: 'PUT', body: JSON.stringify(body) });
export function query(input: Record<string, any>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) if (v !== '' && v != null) params.set(k, String(v));
  return params.toString();
}
