/**
 * Test helper: swap `vscode.workspace.getConfiguration` for a stub backed by a
 * plain map of user-set values. `inspect()` reports those values as globalValue
 * (or in the scope given via `scopes`), so settings.ts migration logic sees them
 * exactly as VS Code would report a user-set key.
 */
const vscode = require("vscode");

export interface ConfigStubOptions {
  /** Values as the user set them (key without the `dualusage.` prefix). */
  values?: Record<string, unknown>;
  /** Per-key scope for `inspect()`; defaults to "global". */
  scopes?: Record<string, "global" | "workspace" | "workspaceFolder">;
}

export interface ConfigStubHandle {
  /** Every `update(key, value, target)` call made through the stub. */
  updates: Array<{ key: string; value: unknown; target: unknown }>;
  /** Mutate the backing values (e.g. between polls). */
  values: Record<string, unknown>;
  scopes: Record<string, "global" | "workspace" | "workspaceFolder">;
  restore(): void;
}

export function installConfigStub(opts: ConfigStubOptions = {}): ConfigStubHandle {
  const values: Record<string, unknown> = { ...(opts.values ?? {}) };
  const scopes = { ...(opts.scopes ?? {}) };
  const updates: ConfigStubHandle["updates"] = [];
  const prev = vscode.workspace.getConfiguration;

  vscode.workspace.getConfiguration = () => ({
    get: (key: string, def: unknown) => (key in values ? values[key] : def),
    inspect: (key: string) => {
      if (!(key in values)) {
        return { key };
      }
      const scope = scopes[key] ?? "global";
      return {
        key,
        globalValue: scope === "global" ? values[key] : undefined,
        workspaceValue: scope === "workspace" ? values[key] : undefined,
        workspaceFolderValue: scope === "workspaceFolder" ? values[key] : undefined,
      };
    },
    update: async (key: string, value: unknown, target: unknown) => {
      updates.push({ key, value, target });
      if (value === undefined) {
        delete values[key];
        delete scopes[key];
      } else {
        values[key] = value;
        scopes[key] =
          target === vscode.ConfigurationTarget.Workspace
            ? "workspace"
            : target === vscode.ConfigurationTarget.WorkspaceFolder
              ? "workspaceFolder"
              : "global";
      }
    },
  });

  return {
    updates,
    values,
    scopes,
    restore: () => {
      vscode.workspace.getConfiguration = prev;
    },
  };
}

export const ALL_PROVIDERS_ENABLED = {
  "providers.claude.enabled": true,
  "providers.chatgpt.enabled": true,
  "providers.cursor.enabled": true,
};
