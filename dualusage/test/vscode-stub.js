// Minimal vscode stub so unit tests can import modules that pull in log.ts / orchestrator.
// Tests that need different behaviour patch the exported object in before()/after().
class EventEmitter {
  constructor() {
    this._listeners = [];
  }
  get event() {
    return (listener) => {
      this._listeners.push(listener);
      return {
        dispose: () => {
          this._listeners = this._listeners.filter((l) => l !== listener);
        },
      };
    };
  }
  fire(data) {
    for (const l of [...this._listeners]) {
      try {
        l(data);
      } catch (err) {
        // Mirror VS Code: a throwing listener never breaks the emitter.
        (module.exports.__listenerErrors ??= []).push(err);
      }
    }
  }
  dispose() {
    this._listeners = [];
  }
}

module.exports = {
  window: {
    createOutputChannel: () => ({
      appendLine: () => undefined,
      dispose: () => undefined,
    }),
    createStatusBarItem: () => ({
      text: "",
      tooltip: undefined,
      backgroundColor: undefined,
      command: undefined,
      name: "",
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    }),
    registerWebviewViewProvider: () => ({ dispose: () => undefined }),
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showQuickPick: async () => undefined,
    onDidChangeWindowState: () => ({ dispose: () => undefined }),
    state: { focused: true },
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key, def) => def,
      inspect: () => undefined,
      update: async () => undefined,
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
  },
  commands: {
    registerCommand: () => ({ dispose: () => undefined }),
    executeCommand: async () => undefined,
  },
  env: {
    openExternal: async () => true,
  },
  Uri: {
    file: (p) => ({ fsPath: p, toString: () => `file://${p}` }),
    parse: (s) => ({ toString: () => s }),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  StatusBarAlignment: { Right: 2, Left: 1 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  MarkdownString: class MarkdownString {
    constructor(value) {
      this.value = value;
    }
  },
  EventEmitter,
  Disposable: { from: (...items) => ({ dispose: () => items.forEach((d) => d.dispose?.()) }) },
};
