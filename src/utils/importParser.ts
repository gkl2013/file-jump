/**
 * Import statement parser module.
 * Extracts import path information from the text at the cursor position.
 * Also supports Vue template component tag resolution.
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

/**
 * Checks if the cursor is on a Vue component tag name in template.
 * Supports both PascalCase (`<MyComponent>`) and kebab-case (`<my-component>`) tags.
 *
 * @param document - The VSCode text document (must be a .vue file)
 * @param position - The cursor position
 * @returns The import path of the component if found, undefined otherwise
 */
export function getVueComponentImportPath(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const lineText = document.lineAt(position.line).text;

  // Match opening or self-closing component tags: <ComponentName or <component-name
  // Also matches closing tags: </ComponentName> or </component-name>
  // PascalCase: starts with uppercase, e.g. <MyComponent>
  // kebab-case: contains a hyphen, e.g. <my-component> (HTML native tags don't have hyphens)
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*)\b/g;
  let match: RegExpExecArray | null;

  // HTML native tags that should NOT be treated as components
  const nativeHtmlTags = new Set([
    'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio',
    'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button',
    'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
    'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
    'em', 'embed',
    'fieldset', 'figcaption', 'figure', 'footer', 'form',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
    'i', 'iframe', 'img', 'input', 'ins',
    'kbd',
    'label', 'legend', 'li', 'link',
    'main', 'map', 'mark', 'menu', 'meta', 'meter',
    'nav', 'noscript',
    'object', 'ol', 'optgroup', 'option', 'output',
    'p', 'param', 'picture', 'pre', 'progress',
    'q',
    'rp', 'rt', 'ruby',
    's', 'samp', 'script', 'section', 'select', 'slot', 'small', 'source', 'span',
    'strong', 'style', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead',
    'time', 'title', 'tr', 'track',
    'u', 'ul',
    'var', 'video',
    'wbr',
    // SVG common tags
    'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'g', 'defs', 'use', 'symbol', 'clippath', 'mask',
  ]);

  while ((match = tagPattern.exec(lineText)) !== null) {
    const tagName = match[1];

    // Skip native HTML/SVG tags:
    // - A component is either PascalCase (starts with uppercase) or kebab-case (contains hyphen)
    // - Lowercase single-word tags without hyphens are native HTML tags
    const isPascalCase = /^[A-Z]/.test(tagName);
    const isKebabCase = tagName.includes('-');
    if (!isPascalCase && !isKebabCase) {
      continue;
    }
    // Also skip if it happens to be in the native tags set
    if (nativeHtmlTags.has(tagName.toLowerCase())) {
      continue;
    }

    // Calculate the position of the tag name (after `<` or `</`)
    const prefix = match[0].slice(0, match[0].indexOf(tagName));
    const tagStart = match.index + prefix.length;
    const tagEnd = tagStart + tagName.length;

    if (position.character >= tagStart && position.character <= tagEnd) {
      // Found: cursor is on this component tag name
      // Now search the <script> section for the corresponding import
      return findImportPathForComponent(document, tagName);
    }
  }

  return undefined;
}

/**
 * Converts a kebab-case tag name to PascalCase.
 * e.g. "my-component" -> "MyComponent"
 */
function kebabToPascal(name: string): string {
  return name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Converts a PascalCase name to kebab-case.
 * e.g. "MyComponent" -> "my-component"
 */
function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Searches the <script> section of a Vue SFC for the import statement
 * that corresponds to a given component tag name.
 *
 * Matches by:
 * - Exact name (PascalCase or kebab-case)
 * - PascalCase ↔ kebab-case conversion
 *
 * @param document - The Vue document
 * @param tagName - The component tag name (PascalCase or kebab-case)
 * @returns The import path if found, undefined otherwise
 */
function findImportPathForComponent(
  document: vscode.TextDocument,
  tagName: string
): string | undefined {
  const text = document.getText();

  // Generate both PascalCase and kebab-case variants for matching
  const pascalName = tagName.includes('-') ? kebabToPascal(tagName) : tagName;
  const kebabName = pascalToKebab(pascalName);

  // Possible imported names to search for
  const candidates = new Set([pascalName, kebabName, tagName]);

  // Pattern to match: import XYZ from 'path' (default import)
  // Also matches: import { XYZ } from 'path' (named import)
  // Also matches: import { Something as XYZ } from 'path' (renamed import)
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|(\w+))(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?\s+from\s+)['"]([^'"]+)['"]/g;

  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(text)) !== null) {
    const fullMatch = importMatch[0];
    const defaultImport = importMatch[1];  // default import name
    const importPath = importMatch[2];

    // Check default import name
    if (defaultImport && candidates.has(defaultImport)) {
      return importPath;
    }

    // Check named imports: import { Foo, Bar as Baz } from '...'
    const namedImportsMatch = fullMatch.match(/\{([^}]+)\}/);
    if (namedImportsMatch) {
      const namedImports = namedImportsMatch[1].split(',').map(s => s.trim());
      for (const named of namedImports) {
        // Handle "Original as Alias" format
        const asMatch = named.match(/(\w+)\s+as\s+(\w+)/);
        const importedName = asMatch ? asMatch[2] : named;
        if (candidates.has(importedName)) {
          return importPath;
        }
      }
    }
  }

  return undefined;
}
