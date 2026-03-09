/**
 * Alias path resolver module.
 * Core resolution logic: converts alias import paths to absolute file paths.
 * Handles alias expansion, extension completion, index file resolution, and Vue extension fallback.
 */

import * as path from 'path';
import * as fs from 'fs';
import { AliasMapping, ResolveResult, FileJumpConfig } from '../types';

/**
 * Resolves an aliased import path to an absolute file path.
 *
 * Resolution strategy (in order):
 * 1. Match the longest alias prefix
 * 2. Replace alias with its mapped path
 * 3. Try exact path
 * 4. Try path with each configured extension appended
 * 5. Try path/index with each extension
 * 6. If vueExtension enabled, additionally try .vue extension
 *
 * @param importPath - The import path from source code, e.g. '@/components/Header'
 * @param aliases - Array of alias mappings to try
 * @param config - Extension configuration
 * @returns ResolveResult if resolved, undefined otherwise
 */
export function resolveAliasPath(
  importPath: string,
  aliases: AliasMapping[],
  config: FileJumpConfig
): ResolveResult | undefined {
  // Find the best matching alias (longest prefix match)
  const matchedAlias = findMatchingAlias(importPath, aliases);
  if (!matchedAlias) {
    return undefined;
  }

  // Replace alias prefix with actual path
  const remainingPath = importPath.slice(matchedAlias.alias.length);
  const strippedPath = remainingPath.startsWith('/') ? remainingPath.slice(1) : remainingPath;
  const absolutePath = path.join(matchedAlias.path, strippedPath);

  // Try to resolve the file
  const resolved = tryResolveFile(absolutePath, config);
  if (resolved) {
    return {
      filePath: resolved,
      originalImport: importPath,
    };
  }

  return undefined;
}

/**
 * Finds the longest matching alias for an import path.
 *
 * @param importPath - The import path to match
 * @param aliases - Available alias mappings
 * @returns The best matching AliasMapping, or undefined
 */
export function findMatchingAlias(
  importPath: string,
  aliases: AliasMapping[]
): AliasMapping | undefined {
  let bestMatch: AliasMapping | undefined;
  let longestLength = 0;

  for (const alias of aliases) {
    // Check if the import starts with this alias
    if (
      importPath === alias.alias ||
      importPath.startsWith(alias.alias + '/')
    ) {
      if (alias.alias.length > longestLength) {
        longestLength = alias.alias.length;
        bestMatch = alias;
      }
    }
  }

  return bestMatch;
}

/**
 * Attempts to resolve a file path by trying exact match, various extensions,
 * and index files.
 *
 * @param absolutePath - The absolute path to resolve (without extension)
 * @param config - Extension configuration
 * @returns Resolved absolute file path, or undefined
 */
export function tryResolveFile(
  absolutePath: string,
  config: FileJumpConfig
): string | undefined {
  // 1. Exact path exists as a file
  if (isFile(absolutePath)) {
    return absolutePath;
  }

  // 2. Try with each configured extension
  for (const ext of config.extensions) {
    const withExt = absolutePath + ext;
    if (isFile(withExt)) {
      return withExt;
    }
  }

  // 3. Try as directory with index file
  if (isDirectory(absolutePath)) {
    for (const ext of config.extensions) {
      const indexPath = path.join(absolutePath, 'index' + ext);
      if (isFile(indexPath)) {
        return indexPath;
      }
    }
  }

  return undefined;
}

/**
 * Resolves a relative import path (non-alias) with extension completion.
 *
 * @param importPath - The relative import path
 * @param currentFilePath - The absolute path of the file containing the import
 * @param config - Extension configuration
 * @returns Resolved absolute file path, or undefined
 */
export function resolveRelativePath(
  importPath: string,
  currentFilePath: string,
  config: FileJumpConfig
): ResolveResult | undefined {
  if (!importPath.startsWith('.')) {
    return undefined;
  }

  const currentDir = path.dirname(currentFilePath);
  const absolutePath = path.resolve(currentDir, importPath);

  const resolved = tryResolveFile(absolutePath, config);
  if (resolved) {
    return {
      filePath: resolved,
      originalImport: importPath,
    };
  }

  return undefined;
}

/**
 * Checks if a path points to a file.
 */
function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Checks if a path points to a directory.
 */
function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}
