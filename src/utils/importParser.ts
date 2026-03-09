/**
 * Import statement parser module.
 * Extracts import path information from the text at the cursor position.
 */

import * as vscode from 'vscode';
import { ImportContext } from '../types';

/**
 * Regular expressions for matching import/require statements across various syntaxes.
 */
const IMPORT_PATTERNS: RegExp[] = [
  // ES module: import ... from 'path'
  /(?:import\s+(?:[\w{}\s,*]+\s+from\s+)?['"])([^'"]+)['"]/g,
  // Dynamic import: import('path')
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CommonJS require: require('path')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CSS @import: @import 'path' or @import url('path')
  /@import\s+(?:url\s*\(\s*)?['"]([^'"]+)['"]\s*\)?/g,
  // Vue style src: src="path"
  /src\s*=\s*['"]([^'"]+)['"]/g,
];

/**
 * Extracts the import path from the document at the given cursor position.
 * Scans the current line using various import pattern regexes.
 *
 * @param document - The VSCode text document
 * @param position - The cursor position
 * @returns ImportContext if an import path is found at the cursor, undefined otherwise
 */
export function getImportContextAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): ImportContext | undefined {
  const line = document.lineAt(position.line);
  const lineText = line.text;

  for (const pattern of IMPORT_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(lineText)) !== null) {
      const importPath = match[1];
      // The import path starts after the opening quote
      const pathStartInMatch = match[0].lastIndexOf(importPath);
      const startOffset = match.index + pathStartInMatch;
      const endOffset = startOffset + importPath.length;

      // Check if cursor is within the import path
      if (position.character >= startOffset && position.character <= endOffset) {
        return {
          importPath,
          startOffset,
          endOffset,
          line: position.line,
        };
      }
    }
  }

  return undefined;
}

/**
 * Extracts just the import path string from a line of text.
 * Useful for simple path extraction without position tracking.
 *
 * @param lineText - A single line of text
 * @returns The import path if found, undefined otherwise
 */
export function extractImportPath(lineText: string): string | undefined {
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(lineText);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}
