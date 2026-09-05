// Minimal vscode stub so unit tests can import modules that pull in log.ts / orchestrator.
module.exports = {
  window: {
    createOutputChannel: () => ({
      appendLine: () => undefined,
      dispose: () => undefined,
    }),
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    onDidChangeWindowState: () => ({ dispose: () => undefined }),
    state: { focused: true },
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key, def) => def,
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
  },
  Uri: { file: (p) => ({ fsPath: p }) },
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
  EventEmitter: class EventEmitter {
    constructor() {
      this._listeners = [];
    }
    get event() {
      return (listener) => {
        this._listeners.push(listener);
        return { dispose: () => undefined };
      };
    }
    fire(data) {
      for (const l of this._listeners) {
        l(data);
      }
    }
    dispose() {
      this._listeners = [];
    }
  },
  Disposable: { from: (...items) => ({ dispose: () => items.forEach((d) => d.dispose?.()) }) },
};
