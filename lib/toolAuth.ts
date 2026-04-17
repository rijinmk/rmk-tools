/** httpOnly cookie set after successful POST /api/tools/unlock */
export const TOOL_UNLOCK_COOKIE = "rmk_tools_unlock";
export const TOOL_UNLOCK_COOKIE_VALUE = "1";

export function isToolUnlocked(cookieValue: string | undefined): boolean {
  return cookieValue === TOOL_UNLOCK_COOKIE_VALUE;
}
