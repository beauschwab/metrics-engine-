/**
 * A view in a URL (ADR-69): `#/grid?v=<base64url JSON>`. The default view
 * writes no parameter, so a clean link stays clean; anything else is the
 * validated JSON, compact, base64url so it survives a hash and a chat
 * message. Reading refuses what does not parse, with the issues, rather
 * than rendering a view that is almost the one linked (ADR-44).
 */

import { defaultView, safeParseView, type ViewState } from '../grid/viewState';

export const VIEW_PARAM = 'v';

const toBase64Url = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/** The parameter for a view, or null when the view is the default. */
export function viewToParam(view: ViewState): string | null {
  const json = JSON.stringify(view);
  return json === JSON.stringify(defaultView()) ? null : toBase64Url(json);
}

export type ViewFromParam = { ok: true; view: ViewState } | { ok: false; issues: string[] };

export function viewFromParam(param: string): ViewFromParam {
  let json: unknown;
  try {
    json = JSON.parse(fromBase64Url(param));
  } catch {
    return { ok: false, issues: ['$: the view parameter is not base64url JSON'] };
  }
  return safeParseView(json);
}

/** `#/grid?v=…` → the view it carries, or null when it carries none. */
export function readViewFromHash(hash: string): ViewFromParam | null {
  const q = hash.indexOf('?');
  if (q < 0) return null;
  const param = new URLSearchParams(hash.slice(q + 1)).get(VIEW_PARAM);
  return param === null ? null : viewFromParam(param);
}

/** The hash with the view written into it, on the same route. */
export function writeViewToHash(hash: string, view: ViewState): string {
  const q = hash.indexOf('?');
  const route = q < 0 ? hash : hash.slice(0, q);
  const params = new URLSearchParams(q < 0 ? '' : hash.slice(q + 1));
  const param = viewToParam(view);
  if (param === null) params.delete(VIEW_PARAM);
  else params.set(VIEW_PARAM, param);
  const qs = params.toString();
  return qs ? `${route}?${qs}` : route;
}
