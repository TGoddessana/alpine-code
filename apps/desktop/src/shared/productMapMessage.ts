const OPEN = '\n\n<alpine-product-map-context>\n';
const CLOSE = '\n</alpine-product-map-context>';

/** Keep the human request readable while retaining the exact agent context in a disclosure. */
export function productMapMessage(text: string): { request: string; context: string } | null {
  const at = text.indexOf(OPEN);
  if (at <= 0 || !text.endsWith(CLOSE)) return null;
  return { request: text.slice(0, at), context: text.slice(at + OPEN.length, -CLOSE.length) };
}
