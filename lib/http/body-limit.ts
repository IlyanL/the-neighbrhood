/**
 * Content-Length is attacker-controlled and optional — a chunked request omits it entirely —
 * so this is a cheap first line of defense, not a guarantee. It exists so a request that is
 * honest about being huge gets turned away before a route handler buffers the whole thing into
 * memory with `request.json()`/`request.formData()`, which have no size limit of their own in
 * the App Router. Anything that lies about or omits the header still has to be caught by the
 * handler's own post-read validation (e.g. `validateClassroomFile`).
 */
export function isBodyTooLarge(request: Request, maxBytes: number): boolean {
  const header = request.headers.get("content-length");
  if (!header) return false;
  const length = Number(header);
  return Number.isFinite(length) && length > maxBytes;
}

/** Generous enough for every JSON route in this app — the biggest legitimate payload is a chat
 *  message capped at 4,000 characters. Anything past this is either a mistake or an attacker
 *  handing us megabytes to parse for no reason. */
export const JSON_BODY_MAX_BYTES = 100 * 1024;
