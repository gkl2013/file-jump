/**
 * Core type definitions for the File Jump extension.
 */

/**
 * Represents a single alias mapping: alias prefix -> filesystem path.
 * Example: { alias: '@', path: '/project/src' }
 */
export interface AliasMapping {
  /** The alias prefix, e.g. '@', '~', '@components' */
  alias: string;
  /** The absolute filesystem path this alias maps to */
  path: string;
}

/**
 * Configuration for the File Jump extension, derived from VSCode settings.
 */
export interface FileJumpConfig {
  /** User-defined alias map from settings, e.g. { "@": "src" } */
  aliasMap: Record<string, string>;
  /** Path to webpack config file (relative to workspace root) */
  webpackConfigPath: string;
  /** Whether to auto-try .vue extension */
  vueExtension: boolean;
  /** Whether to auto-detect monorepo sub-projects */
  autoDetectMonorepo: boolean;
  /** List of file extensions to try (in priority order) */
  extensions: string[];
}

/**
 * Represents a detected monorepo sub-project (package).
 */
export interface MonorepoPackage {
  /** Package name from package.json */
  name: string;
  /** Absolute path to the package root directory */
  rootPath: string;
  /** Resolved alias mappings specific to this package */
  aliases: AliasMapping[];
}

/**
 * Result of resolving an import path.
 */
export interface ResolveResult {
  /** The resolved absolute file path */
  filePath: string;
  /** The original import string that was resolved */
  originalImport: string;
  /**
   * Whether the file was resolved by appending an extension or using an index file.
   * true = VSCode built-in service likely cannot resolve this (e.g. .vue suffix omitted)
   * false = exact path matched, built-in service might also resolve it
   */
  extensionAppended: boolean;
}

/**
 * Context information about the import statement under the cursor.
 */
export interface ImportContext {
  /** The full import path string, e.g. '@/components/Header' */
  importPath: string;
  /** Start position of the import path in the document */
  startOffset: number;
  /** End position of the import path in the document */
  endOffset: number;
  /** The line number where the import is found */
  line: number;
}
