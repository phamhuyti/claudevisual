import { restoreFromBackup, writeSettingsField, WriteUndoInfo } from "../../config/config-writer";
import { readEffectiveValue, resolveSettingsPaths } from "../../config/settings-paths";
import { SETTINGS_FIELDS, SettingsFieldDef } from "../../config/settings-schema";
import {
  areHooksInstalled,
  detectStatusLine,
  GlobalStateLike,
  installHooks,
  installStatusLineDirect,
  restoreOriginalStatusLine,
  uninstallHooks,
  wrapStatusLine,
} from "../../hooks/installer";
import type {
  FieldViewModel,
  InitMessage,
  ToggleMessage,
  UndoMessage,
  UndoResultMessage,
  WebviewToHostMessage,
  WriteFieldMessage,
  WriteResultMessage,
} from "./messages";

/** Undo handle for exactly one prior write per field — `handleUndo` reverts
 *  via this and nothing else (config-writer.ts's `restoreFromBackup`),
 *  matching json-merge.ts's "backup is the single source of truth" contract
 *  when a backup exists, or the keyPath+contentHash-guarded key removal when
 *  it doesn't (see `restoreFromBackup`'s doc comment). A second write to the
 *  same field before Undo simply replaces this entry — there is no
 *  multi-level undo stack, out of scope for v1 per the phase spec. Only ever
 *  set for calls that actually wrote something (see `rememberWrite` below) —
 *  a no-op toggle/restore must never leave behind an Undo entry that could
 *  later be "reverted" against nothing. */
type PendingUndo = WriteUndoInfo;

/**
 * Host-side controller for the dashboard's config-editing form: builds the
 * effective-value view model for `panel.ts`'s `init` message, and routes
 * every `write-field`/`toggle`/`undo` message from the webview to
 * `config-writer.ts` (scalar fields) or the Phase 3/4 `installer.ts` APIs
 * (the two action-toggle fields) — never duplicating either's write logic.
 * Deliberately `vscode`-free (constructor takes plain paths/`GlobalStateLike`,
 * matching installer.ts's own host-independent style) so it stays unit-testable.
 */
export class ConfigFormController {
  private readonly lastWrite = new Map<string, PendingUndo>();

  constructor(
    private readonly extensionPath: string,
    private readonly globalState: GlobalStateLike,
    private workspaceRoot: string | undefined
  ) {}

  setWorkspaceRoot(root: string | undefined): void {
    this.workspaceRoot = root;
  }

  async buildInitMessage(): Promise<InitMessage> {
    const paths = resolveSettingsPaths(this.workspaceRoot);
    const fields: FieldViewModel[] = [];

    for (const field of SETTINGS_FIELDS) {
      if (field.keyPath) {
        const effective = await readEffectiveValue(paths, field.keyPath);
        fields.push({ field, effectiveValue: effective.value, effectiveScope: effective.scope });
      } else if (field.id === "hooksInstalled") {
        const toggleOn = await areHooksInstalled();
        fields.push({ field, effectiveValue: undefined, effectiveScope: undefined, toggleOn });
      } else if (field.id === "statusLineWrapped") {
        const detection = await detectStatusLine();
        fields.push({
          field,
          effectiveValue: undefined,
          effectiveScope: undefined,
          toggleOn: detection.kind === "already-wrapped",
        });
      }
    }

    return { type: "init", fields, hasProjectScope: paths.project !== undefined };
  }

  async handleMessage(message: WebviewToHostMessage): Promise<WriteResultMessage | UndoResultMessage | undefined> {
    switch (message.type) {
      case "write-field":
        return this.handleWriteField(message);
      case "toggle":
        return this.handleToggle(message);
      case "undo":
        return this.handleUndo(message);
      default:
        return undefined;
    }
  }

  private async handleWriteField(message: WriteFieldMessage): Promise<WriteResultMessage> {
    const field = SETTINGS_FIELDS.find((f) => f.id === message.fieldId);
    if (!field || !field.keyPath) {
      return { type: "write-result", fieldId: message.fieldId, ok: false, error: "unknown field" };
    }
    if (message.scope !== "global" && message.scope !== "project") {
      return { type: "write-result", fieldId: field.id, ok: false, error: "unknown scope" };
    }
    const validationError = validateFieldValue(field, message.value);
    if (validationError) {
      return { type: "write-result", fieldId: field.id, ok: false, error: validationError };
    }
    try {
      const result = await writeSettingsField(
        field.id,
        field.keyPath,
        message.scope,
        message.value,
        this.workspaceRoot
      );
      this.rememberWrite(field.id, result);
      return {
        type: "write-result",
        fieldId: field.id,
        ok: true,
        before: result.previousValue,
        after: result.newValue,
        scope: result.scope,
      };
    } catch (err) {
      return { type: "write-result", fieldId: field.id, ok: false, error: describeError(err) };
    }
  }

  private async handleToggle(message: ToggleMessage): Promise<WriteResultMessage> {
    try {
      if (message.fieldId === "hooksInstalled") {
        return await this.toggleHooks(message.enable);
      }
      if (message.fieldId === "statusLineWrapped") {
        return await this.toggleStatusLine(message.enable);
      }
      return { type: "write-result", fieldId: message.fieldId, ok: false, error: "unknown toggle field" };
    } catch (err) {
      return { type: "write-result", fieldId: message.fieldId, ok: false, error: describeError(err) };
    }
  }

  private async toggleHooks(enable: boolean): Promise<WriteResultMessage> {
    const fieldId = "hooksInstalled";
    if (enable) {
      const result = await installHooks(this.extensionPath);
      this.rememberWrite(fieldId, result);
      return { type: "write-result", fieldId, ok: true, before: false, after: true, scope: "global" };
    }
    const result = await uninstallHooks();
    this.rememberWrite(fieldId, result);
    return { type: "write-result", fieldId, ok: true, before: true, after: false, scope: "global" };
  }

  private async toggleStatusLine(enable: boolean): Promise<WriteResultMessage> {
    const fieldId = "statusLineWrapped";
    if (enable) {
      const detection = await detectStatusLine();
      const result =
        detection.kind === "empty"
          ? await installStatusLineDirect(this.extensionPath, this.globalState)
          : await wrapStatusLine(this.extensionPath, this.globalState);
      this.rememberWrite(fieldId, result);
      return { type: "write-result", fieldId, ok: true, before: false, after: true, scope: "global" };
    }
    const result = await restoreOriginalStatusLine(this.globalState);
    this.rememberWrite(fieldId, result);
    return { type: "write-result", fieldId, ok: result.restored, before: true, after: false, scope: "global" };
  }

  /** Records the pending-undo entry for one field's write — but only when
   *  `result.contentHash` is defined, i.e. a write actually happened.
   *  Several installer.ts calls (an already-current hooks/statusline toggle,
   *  a `restoreOriginalStatusLine` with nothing stored) are legitimate
   *  no-ops that never call `mergeJsonFile`; registering an Undo entry for
   *  one of those would let a later Undo click revert a write that never
   *  occurred — for a field with no prior real write, that risks deleting
   *  the whole file via the `backupPath === undefined` path in
   *  `restoreFromBackup`. */
  private rememberWrite(
    fieldId: string,
    result: { settingsPath: string; backupPath: string | undefined; keyPath: string; contentHash: string | undefined }
  ): void {
    if (result.contentHash === undefined) {
      return;
    }
    this.lastWrite.set(fieldId, {
      settingsPath: result.settingsPath,
      backupPath: result.backupPath,
      keyPath: result.keyPath,
      contentHash: result.contentHash,
    });
  }

  private async handleUndo(message: UndoMessage): Promise<UndoResultMessage> {
    const pending = this.lastWrite.get(message.fieldId);
    if (!pending) {
      return { type: "undo-result", fieldId: message.fieldId, ok: false, error: "nothing to undo for this field" };
    }
    try {
      await restoreFromBackup(pending);
      this.lastWrite.delete(message.fieldId);
      return { type: "undo-result", fieldId: message.fieldId, ok: true };
    } catch (err) {
      return { type: "undo-result", fieldId: message.fieldId, ok: false, error: describeError(err) };
    }
  }
}

/** Host-side gate on webview-supplied values before they reach settings.json:
 *  the form only ever produces strings (`<input>`/`<select>` values), and a
 *  select field's value must be one of its schema-declared options — anything
 *  else means the message didn't come from the form as rendered. */
function validateFieldValue(field: SettingsFieldDef, value: unknown): string | undefined {
  if (typeof value !== "string") {
    return "value must be a string";
  }
  if (field.kind === "select" && field.options && !field.options.some((opt) => opt.value === value)) {
    return `"${value}" is not an allowed value for ${field.label}`;
  }
  return undefined;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
