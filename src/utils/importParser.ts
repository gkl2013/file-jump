/**
 * Import statement parser module.
 * Extracts import path information from the text at the cursor position.
 * Supports multi-line imports, re-exports, CSS @use/@forward, url(),
 * HTML script/link references, and Vue template component tag resolution.
 */

import * as vscode from 'vscode';
import { ImportContext } from '../types';

/**
 * Single-line import pattern definitions.
 * Each regex must have exactly one capture group for the import path.
 */
const SINGLE_LINE_PATTERNS: RegExp[] = [
  // ES module: import ... from 'path' (single-line)
  /(?:import\s+(?:[\w{}\s,*]+\s+from\s+)?['"])([^'"]+)['"]/g,
  // Re-export: export ... from 'path' / export { x } from 'path'
  /(?:export\s+(?:[\w{}\s,*]+\s+from\s+)?['"])([^'"]+)['"]/g,
  // Dynamic import: import('path')
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CommonJS require: require('path')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // require.resolve('path')
  /require\.resolve\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CSS @import: @import 'path' or @import url('path')
  /@import\s+(?:url\s*\(\s*)?['"]([^'"]+)['"]\s*\)?/g,
  // Sass/SCSS @use: @use 'path' or @use 'path' as *
  /@use\s+['"]([^'"]+)['"]/g,
  // Sass/SCSS @forward: @forward 'path'
  /@forward\s+['"]([^'"]+)['"]/g,
  // CSS url() references: url('path') or url("path")
  /url\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // Vue/Svelte/HTML src attribute: src="path"
  /src\s*=\s*['"]([^'"]+)['"]/g,
  // HTML link href for stylesheets: href="path"
  /href\s*=\s*['"]([^'"]+)['"]/g,
];

/**
 * Extracts the import path from the document at the given cursor position.
 * Supports both single-line and multi-line import/export statements.
 *
 * @param document - The VSCode text document
 * @param position - The cursor position
 * @returns ImportContext if an import path is found at the cursor, undefined otherwise
 */
export function getImportContextAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): ImportContext | undefined {
  // First try single-line match on the current line
  const singleLineResult = matchSingleLine(document, position);
  if (singleLineResult) {
    return singleLineResult;
  }

  // Then try multi-line import/export match
  return matchMultiLine(document, position);
}

/**
 * Tries to match import path on a single line.
 */
function matchSingleLine(
  document: vscode.TextDocument,
  position: vscode.Position
): ImportContext | undefined {
  const lineText = document.lineAt(position.line).text;

  for (const pattern of SINGLE_LINE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(lineText)) !== null) {
      const importPath = match[1];
      const pathStartInMatch = match[0].lastIndexOf(importPath);
      const startOffset = match.index + pathStartInMatch;
      const endOffset = startOffset + importPath.length;

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
 * Handles multi-line import/export statements.
 * When the cursor is on a line that is part of a multi-line import like:
 *   import {
 *     Foo,
 *     Bar
 *   } from '@/components'
 * the path string is on the last line, but the user may click on any line.
 */
function matchMultiLine(
  document: vscode.TextDocument,
  position: vscode.Position
): ImportContext | undefined {
  const lineText = document.lineAt(position.line).text.trim();

  // If the current line itself has a 'from' clause with a path, try to extract it
  const fromLinePattern = /from\s+['"]([^'"]+)['"]/;
  const directMatch = lineText.match(fromLinePattern);
  if (directMatch) {
    const fullLine = document.lineAt(position.line).text;
    const idx = fullLine.indexOf(directMatch[1]);
    if (idx >= 0) {
      return {
        importPath: directMatch[1],
        startOffset: idx,
        endOffset: idx + directMatch[1].length,
        line: position.line,
      };
    }
  }

  // Check if the cursor is inside a multi-line import/export block.
  // Look backwards for `import` or `export` keyword, and forwards for `from '...'`.
  const maxLookback = 20;
  const maxLookForward = 20;

  let importStartLine = -1;

  // Search backwards for the opening import/export keyword
  for (let i = position.line; i >= Math.max(0, position.line - maxLookback); i--) {
    const text = document.lineAt(i).text.trim();
    if (/^(?:import|export)\s/.test(text)) {
      importStartLine = i;
      break;
    }
    // Stop if we hit a line that doesn't look like part of an import
    if (i < position.line && !text.startsWith('{') && !text.startsWith('}') &&
        !text.startsWith(',') && !text.endsWith(',') && !text.startsWith('//') &&
        !/^[\w*]+/.test(text) && !text.startsWith('*')) {
      break;
    }
  }

  if (importStartLine < 0) {
    return undefined;
  }

  // Search forwards for the `from '...'` line
  const totalLines = document.lineCount;
  for (let i = position.line; i <= Math.min(totalLines - 1, position.line + maxLookForward); i++) {
    const text = document.lineAt(i).text;
    const fromMatch = text.match(/from\s+['"]([^'"]+)['"]/);
    if (fromMatch) {
      const importPath = fromMatch[1];
      const idx = text.indexOf(importPath);
      return {
        importPath,
        startOffset: idx,
        endOffset: idx + importPath.length,
        line: i,
      };
    }
    // Also check for closing semicolon / end of statement without `from`
    if (/[;]/.test(text) && !text.includes('from')) {
      break;
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
  for (const pattern of SINGLE_LINE_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(lineText);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Checks if the cursor is on a Vue/Svelte component tag name in template.
 * Supports both PascalCase (`<MyComponent>`) and kebab-case (`<my-component>`) tags.
 *
 * @param document - The VSCode text document (must be a .vue or .svelte file)
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
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*)\b/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(lineText)) !== null) {
    const tagName = match[1];

    // Skip native HTML/SVG tags
    const isPascalCase = /^[A-Z]/.test(tagName);
    const isKebabCase = tagName.includes('-');
    if (!isPascalCase && !isKebabCase) {
      continue;
    }
    if (NATIVE_HTML_TAGS.has(tagName.toLowerCase())) {
      continue;
    }

    // Calculate the position of the tag name
    const prefix = match[0].slice(0, match[0].indexOf(tagName));
    const tagStart = match.index + prefix.length;
    const tagEnd = tagStart + tagName.length;

    if (position.character >= tagStart && position.character <= tagEnd) {
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
 * Searches the <script> section of a Vue/Svelte SFC for the import statement
 * that corresponds to a given component tag name.
 *
 * Matches by:
 * - Exact name (PascalCase or kebab-case)
 * - PascalCase ↔ kebab-case conversion
 *
 * @param document - The Vue/Svelte document
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
  const candidates = new Set([pascalName, kebabName, tagName]);

  // Pattern to match: import XYZ from 'path' (default import)
  // Also matches: import { XYZ } from 'path' (named import)
  // Also matches: import { Something as XYZ } from 'path' (renamed import)
  // Uses [\s\S] to handle multi-line imports
  const importRegex = /import\s+(?:(?:\{[\s\S]*?\}|\*\s+as\s+\w+|(\w+))(?:\s*,\s*(?:\{[\s\S]*?\}|\*\s+as\s+\w+))?\s+from\s+)['"]([^'"]+)['"]/g;

  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(text)) !== null) {
    const fullMatch = importMatch[0];
    const defaultImport = importMatch[1];
    const importPath = importMatch[2];

    // Check default import name
    if (defaultImport && candidates.has(defaultImport)) {
      return importPath;
    }

    // Check named imports: import { Foo, Bar as Baz } from '...'
    const namedImportsMatch = fullMatch.match(/\{([\s\S]*?)\}/);
    if (namedImportsMatch) {
      const namedImports = namedImportsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const named of namedImports) {
        // Handle "Original as Alias" format
        const asMatch = named.match(/(\w+)\s+as\s+(\w+)/);
        const importedName = asMatch ? asMatch[2] : named.trim();
        if (candidates.has(importedName)) {
          return importPath;
        }
      }
    }
  }

  return undefined;
}

/**
 * HTML native tags that should NOT be treated as components.
 */
const NATIVE_HTML_TAGS = new Set([
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
