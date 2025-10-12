import { URL } from 'node:url';

export function buildLink(baseUrl, token, param = 'token') {
  const u = new URL(baseUrl);
  u.searchParams.set(param, token);
  return u.toString();
}
export function extractTokenFromUrl(url, param = 'token') {
  const u = new URL(url);
  return u.searchParams.get(param);
}

