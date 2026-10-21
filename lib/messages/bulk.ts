export const MAX_BULK_MESSAGES = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validRoomId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export function validBulkMessageIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_BULK_MESSAGES
    && value.every(validRoomId) && new Set(value).size === value.length;
}
