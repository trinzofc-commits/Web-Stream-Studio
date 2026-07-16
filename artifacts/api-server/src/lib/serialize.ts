/**
 * Serializes a DB row (or array of rows) through JSON to convert Date objects
 * to ISO strings before Zod validation.
 */
export function serialize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}
