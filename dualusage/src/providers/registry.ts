import { DualUsageSettings } from "../domain/types";
import { ClaudeAdapter } from "./claude/adapter";
import { ChatgptAdapter } from "./chatgpt/adapter";
import { ProviderAdapter } from "./types";

export function createAdapters(settings: DualUsageSettings): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [];
  if (settings.claudeEnabled) {
    adapters.push(new ClaudeAdapter());
  }
  if (settings.chatgptEnabled) {
    adapters.push(new ChatgptAdapter());
  }
  return adapters;
}
