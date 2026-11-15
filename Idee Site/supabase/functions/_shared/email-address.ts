/** A single delivery-safe email contract for booking input and mail rendering.
 * Existing stored contacts are not rewritten by this validator. */
export function isMailAddress(value: unknown): value is string {
  return typeof value === 'string'
    && new TextEncoder().encode(value).byteLength <= 254
    && /^[^\s@<>\u0000-\u001f\u007f-\u009f]+@[^\s@<>\u0000-\u001f\u007f-\u009f]+\.[^\s@<>\u0000-\u001f\u007f-\u009f]+$/.test(value);
}
