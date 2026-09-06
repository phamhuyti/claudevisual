import { ProviderId } from "./types";

/** Deep links to each provider's usage / billing page (easy to update). */
export const USAGE_PAGE_URLS: Record<ProviderId, string> = {
  claude: "https://claude.ai/settings/usage",
  // The URL the Codex CLI itself prints for "up-to-date rate limits and credits".
  chatgpt: "https://chatgpt.com/codex/settings/usage",
  cursor: "https://www.cursor.com/dashboard?tab=usage",
};

export function usagePageUrl(id: ProviderId): string {
  return USAGE_PAGE_URLS[id];
}
