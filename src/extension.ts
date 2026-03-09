/**
 * Extension entry point.
 * Activates the File Jump extension by registering the DefinitionProvider
 * for supported languages.
 */

import * as vscode from 'vscode';
import { FileJumpDefinitionProvider } from './providers/definitionProvider';

/**
 * Supported language identifiers for which the DefinitionProvider will be registered.
 */
const SUPPORTED_LANGUAGES: vscode.DocumentSelector = [
  { scheme: 'file', language: 'javascript' },
  { scheme: 'file', language: 'typescript' },
  { scheme: 'file', language: 'javascriptreact' },
  { scheme: 'file', language: 'typescriptreact' },
  { scheme: 'file', language: 'vue' },
  { scheme: 'file', language: 'css' },
  { scheme: 'file', language: 'scss' },
  { scheme: 'file', language: 'less' },
];

/**
 * Called by VSCode when the extension is activated.
 * Registers the FileJumpDefinitionProvider for all supported languages.
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new FileJumpDefinitionProvider();

  const disposable = vscode.languages.registerDefinitionProvider(
    SUPPORTED_LANGUAGES,
    provider
  );

  context.subscriptions.push(disposable);

  console.log('[File Jump] Extension activated');
}

/**
 * Called by VSCode when the extension is deactivated.
 */
export function deactivate(): void {
  console.log('[File Jump] Extension deactivated');
}
