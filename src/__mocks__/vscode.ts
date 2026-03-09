/**
 * VSCode API mock for unit testing.
 * Provides minimal stubs for the vscode module so tests can run outside the extension host.
 */

export class Uri {
  static file(filePath: string): Uri {
    return new Uri(filePath);
  }

  static parse(value: string): Uri {
    return new Uri(value);
  }

  readonly scheme: string = 'file';
  readonly path: string;
  readonly fsPath: string;

  constructor(filePath: string) {
    this.path = filePath;
    this.fsPath = filePath;
  }

  with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(change.path || this.path);
  }

  toString(): string {
    return `file://${this.path}`;
  }
}

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  constructor(
    startOrStartLine: Position | number,
    endOrStartCharacter: Position | number,
    endLine?: number,
    endCharacter?: number
  ) {
    if (typeof startOrStartLine === 'number') {
      this.start = new Position(startOrStartLine, endOrStartCharacter as number);
      this.end = new Position(endLine!, endCharacter!);
    } else {
      this.start = startOrStartLine;
      this.end = endOrStartCharacter as Position;
    }
  }
}

export class Location {
  constructor(public uri: Uri, public range: Range | Position) {}
}

export enum DefinitionLink {}

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
  }),
  workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>,
  getWorkspaceFolder: (uri: Uri) => undefined as { uri: Uri; name: string; index: number } | undefined,
  findFiles: async () => [] as Uri[],
  fs: {
    stat: async () => ({ type: 1 }),
  },
};

export const window = {
  showErrorMessage: (message: string) => {},
  showInformationMessage: (message: string) => {},
};

export const languages = {
  registerDefinitionProvider: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
};

export class CancellationTokenSource {
  token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
  cancel() {}
  dispose() {}
}

export class Disposable {
  static from(...disposables: { dispose: () => unknown }[]): Disposable {
    return new Disposable(() => disposables.forEach(d => d.dispose()));
  }
  constructor(private callOnDispose: () => unknown) {}
  dispose() { this.callOnDispose(); }
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}
