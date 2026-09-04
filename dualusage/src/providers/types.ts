import { ProviderId, ProviderSnapshot } from "../domain/types";

export interface FetchContext {
  claudePath: string;
  codexHome: string;
  chatgptSource: "auto" | "api" | "rollout";
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  fetch(ctx: FetchContext): Promise<ProviderSnapshot>;
}
