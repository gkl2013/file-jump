/**
 * VSCode DefinitionProvider implementation.
 * This is the main entry point for Ctrl/Cmd+Click file jump functionality.
 * Registers as a DefinitionProvider to intercept "Go to Definition" requests
 * and resolve alias import paths to actual file locations.
 *
 * Enhanced features inspired by WebStorm's navigation:
 * - Multi-line import/export resolution
 * - CSS ~ prefix (node_modules) resolution
 * - Absolute path (/) imports resolution
 * - Sass/SCSS partial (_filename) resolution
 * - Vue/Svelte component tag resolution
 * - package.json "main"/"module" entry resolution
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig, resolveAliasMap, readWebpackAliases, readTsConfigPaths, readCommonConfigAliases } from '../utils/configReader';
import { getImportContextAtPosition, getVueComponentImportPath } from '../utils/importParser';
import { resolveAliasPath, resolveRelativePath, resolveAbsoluteImport, tryResolveFile } from '../resolvers/aliasResolver';
import { detectMonorepoPackages, findPackageForFile } from '../utils/monorepoDetector';
import { AliasMapping, MonorepoPackage, FileJumpConfig } from '../types';

/** Source of an alias mapping. */
enum AliasSource {
  /** From tsconfig.json / jsconfig.json paths — VSCode built-in TS service handles these */
  TsConfig = 'tsconfig',
  /** From webpack config, vite config, user settings, etc. — built-in service does NOT handle */
  External = 'external',
}

/** JS/TS extensions that VSCode's built-in service can handle. */
const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/** An AliasMapping tagged with its source. */
interface TaggedAlias extends AliasMapping {
  source: AliasSource;
}

/**
 * Provides definition locations for alias import paths.
 * Implements vscode.DefinitionProvider to enable Ctrl/Cmd+Click jump.
 */
export class FileJumpDefinitionProvider implements vscode.DefinitionProvider {
  private cachedAliases: TaggedAlias[] = [];
  private cachedMonorepoPackages: MonorepoPackage[] = [];
  private lastRefreshTime = 0;
  private readonly CACHE_TTL_MS = 10000; // 10 seconds
  /** Set of alias prefixes that came from tsconfig/jsconfig (built-in TS service handles these) */
  private tsConfigAliasKeys = new Set<string>();

  /**
   * Called by VSCode when the user Ctrl/Cmd+Clicks on a token.
   * Resolves the import path under the cursor to a file location.
   *
   * Handles scenarios where VSCode's built-in service falls short:
   * 1. Alias paths (e.g. '@/...', '~/...') pointing to non-JS/TS files
   * 2. Relative paths ('./...', '../...') that omit non-JS extensions (e.g. .vue)
   * 3. Absolute paths ('/src/...') relative to workspace root
   * 4. CSS ~ prefix imports for node_modules
   * 5. Sass/SCSS partials with _ prefix
   * 6. Bare module specifiers with entry point resolution
   * Bare module specifiers ('lodash') are skipped unless they have resolvable entry points.
   */
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | undefined> {
    const config = getConfig();

    // Extract the import path at cursor position
    const importContext = getImportContextAtPosition(document, position);

    // If no import statement found, try Vue/Svelte component tag resolution
    if (!importContext) {
      return this.resolveComponentTag(document, position, config);
    }

    let { importPath } = importContext;

    // Get the workspace root (needed for most resolution strategies)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const rootPath = workspaceFolder?.uri.fsPath;

    // Handle CSS/SCSS ~ prefix: strip ~ and resolve from node_modules
    if (importPath.startsWith('~')) {
      return this.resolveTildeImport(importPath, document, config, rootPath);
    }

    // Handle relative paths ('./...', '../...')
    if (importPath.startsWith('.')) {
      return this.resolveRelativeImport(importPath, document.uri.fsPath, config);
    }

    // Handle absolute paths ('/src/...')
    if (importPath.startsWith('/')) {
      return this.resolveAbsolutePathImport(importPath, config, rootPath);
    }

    // Everything else is either an alias path or a bare module specifier
    if (!rootPath) {
      return undefined;
    }

    // Refresh alias cache BEFORE checking bare module specifier
    await this.refreshAliases(rootPath, config);

    // Skip node_modules imports (bare specifiers without @ alias)
    if (this.isBareModuleSpecifier(importPath, config)) {
      // Even for bare specifiers, try to resolve the package entry point
      return this.resolvePackageEntryPoint(importPath, rootPath, config);
    }

    // Determine which aliases to use based on the current file's location
    const aliases = this.getAliasesForFile(document.uri.fsPath, rootPath, config);

    // Try alias resolution
    const result = resolveAliasPath(importPath, aliases, config);

    if (!result) {
      return undefined;
    }

    // De-duplicate: only skip when BOTH conditions are true:
    //   1. The resolved file is a JS/TS file (built-in TS service can parse it)
    //   2. The matched alias came from tsconfig/jsconfig paths (built-in TS service knows this alias)
    // If the alias came from webpack/vite/user-settings, built-in TS doesn't know it,
    // so we MUST provide the definition ourselves even for JS/TS files.
    const resolvedExt = path.extname(result.filePath).toLowerCase();
    if (JS_EXTENSIONS.has(resolvedExt) && this.isAliasCoveredByTsConfig(importPath)) {
      return undefined;
    }

    const targetUri = vscode.Uri.file(result.filePath);
    return new vscode.Location(targetUri, new vscode.Position(0, 0));
  }

  /**
   * Determines the applicable aliases for a file, considering monorepo context.
   * If the file belongs to a monorepo sub-package, uses that package's aliases;
   * otherwise uses the workspace-level aliases.
   */
  private getAliasesForFile(
    filePath: string,
    _rootPath: string,
    config: FileJumpConfig
  ): AliasMapping[] {
    if (config.autoDetectMonorepo && this.cachedMonorepoPackages.length > 0) {
      const pkg = findPackageForFile(filePath, this.cachedMonorepoPackages);
      if (pkg && pkg.aliases.length > 0) {
        return pkg.aliases;
      }
    }
    return this.cachedAliases;
  }

  /**
   * Checks whether the import path's matching alias was defined in tsconfig/jsconfig.
   * If true, VSCode's built-in TypeScript service can resolve it natively,
   * so we should avoid providing a duplicate definition for JS/TS files.
   */
  private isAliasCoveredByTsConfig(importPath: string): boolean {
    for (const key of this.tsConfigAliasKeys) {
      if (importPath === key || importPath.startsWith(key + '/')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if the import path is a bare module specifier (i.e., a node_modules package).
   * Returns true for things like 'lodash', 'vue', 'element-ui/lib/button'.
   * Returns false for alias paths like '@/components' or '~/utils'.
   */
  private isBareModuleSpecifier(importPath: string, config: FileJumpConfig): boolean {
    if (importPath.startsWith('.') || importPath.startsWith('/') || importPath.startsWith('~')) {
      return false;
    }

    // Check if it starts with any known alias
    const allAliases = [
      ...this.cachedAliases,
      ...this.cachedMonorepoPackages.flatMap(pkg => pkg.aliases),
    ];

    for (const alias of allAliases) {
      if (importPath === alias.alias || importPath.startsWith(alias.alias + '/')) {
        return false;
      }
    }

    // Check against user-defined alias map keys
    const aliasKeys = Object.keys(config.aliasMap);
    for (const key of aliasKeys) {
      if (importPath === key || importPath.startsWith(key + '/')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Resolves CSS/SCSS ~ prefix imports.
   * The ~ prefix indicates a node_modules import in webpack/sass-loader.
   * e.g. ~normalize.css → node_modules/normalize.css
   *      ~@/styles/variables → alias resolution (strip ~)
   */
  private resolveTildeImport(
    importPath: string,
    document: vscode.TextDocument,
    config: FileJumpConfig,
    rootPath: string | undefined
  ): vscode.Location | undefined {
    // Strip the leading ~
    const stripped = importPath.slice(1);

    // If it starts with an alias character after ~, try alias resolution
    if (rootPath) {
      // Must refresh aliases synchronously; for ~ paths we do a best-effort resolve
      const aliases = this.cachedAliases.length > 0
        ? this.getAliasesForFile(document.uri.fsPath, rootPath, config)
        : [];

      if (aliases.length > 0) {
        const result = resolveAliasPath(stripped, aliases, config);
        if (result) {
          const targetUri = vscode.Uri.file(result.filePath);
          return new vscode.Location(targetUri, new vscode.Position(0, 0));
        }
      }

      // Try as node_modules import
      const nodeModulesPath = path.join(rootPath, 'node_modules', stripped);
      const resolved = tryResolveFile(nodeModulesPath, config);
      if (resolved) {
        const targetUri = vscode.Uri.file(resolved.filePath);
        return new vscode.Location(targetUri, new vscode.Position(0, 0));
      }

      // Try resolving package entry point
      return this.resolvePackageEntryPoint(stripped, rootPath, config);
    }

    return undefined;
  }

  /**
   * Resolves a Vue/Svelte component tag in template to its source file.
   * When the cursor is on a component tag (e.g. <MyComponent> or <my-component>),
   * finds the corresponding import in <script> and resolves it.
   */
  private async resolveComponentTag(
    document: vscode.TextDocument,
    position: vscode.Position,
    config: FileJumpConfig
  ): Promise<vscode.Definition | undefined> {
    // Only for .vue and .svelte files
    const fileName = document.fileName;
    if (!fileName.endsWith('.vue') && !fileName.endsWith('.svelte')) {
      return undefined;
    }

    const importPath = getVueComponentImportPath(document, position);
    if (!importPath) {
      return undefined;
    }

    // For relative paths, resolve directly since built-in may not handle .vue
    if (importPath.startsWith('.') || importPath.startsWith('/')) {
      const currentDir = path.dirname(document.fileName);
      const absolutePath = importPath.startsWith('/')
        ? path.join(vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath || '', importPath)
        : path.resolve(currentDir, importPath);
      const resolved = tryResolveFile(absolutePath, config);
      if (resolved) {
        const targetUri = vscode.Uri.file(resolved.filePath);
        return new vscode.Location(targetUri, new vscode.Position(0, 0));
      }
      return undefined;
    }

    // Get the workspace root
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    const rootPath = workspaceFolder.uri.fsPath;

    await this.refreshAliases(rootPath, config);

    if (this.isBareModuleSpecifier(importPath, config)) {
      return undefined;
    }

    const aliases = this.getAliasesForFile(document.uri.fsPath, rootPath, config);
    const result = resolveAliasPath(importPath, aliases, config);

    if (!result) {
      return undefined;
    }

    const targetUri = vscode.Uri.file(result.filePath);
    return new vscode.Location(targetUri, new vscode.Position(0, 0));
  }

  /**
   * Resolves a relative import path with extension completion.
   * Only returns a result when the resolved file is NOT a JS/TS file,
   * since VSCode's built-in service already handles JS/TS relative imports.
   * This covers the case where .vue/.scss/.less etc. extensions are omitted.
   */
  private resolveRelativeImport(
    importPath: string,
    currentFilePath: string,
    config: FileJumpConfig
  ): vscode.Location | undefined {
    const result = resolveRelativePath(importPath, currentFilePath, config);
    if (!result) {
      return undefined;
    }

    // Only intervene for non-JS/TS files to avoid duplicate definitions
    const resolvedExt = path.extname(result.filePath).toLowerCase();
    if (JS_EXTENSIONS.has(resolvedExt)) {
      return undefined;
    }

    const targetUri = vscode.Uri.file(result.filePath);
    return new vscode.Location(targetUri, new vscode.Position(0, 0));
  }

  /**
   * Resolves absolute path imports (starting with '/').
   * Treats '/' as relative to workspace root.
   */
  private resolveAbsolutePathImport(
    importPath: string,
    config: FileJumpConfig,
    rootPath: string | undefined
  ): vscode.Location | undefined {
    if (!rootPath) {
      return undefined;
    }

    const result = resolveAbsoluteImport(importPath, rootPath, config);
    if (!result) {
      return undefined;
    }

    // Only intervene for non-JS/TS files to avoid duplicate definitions
    const resolvedExt = path.extname(result.filePath).toLowerCase();
    if (JS_EXTENSIONS.has(resolvedExt)) {
      return undefined;
    }

    const targetUri = vscode.Uri.file(result.filePath);
    return new vscode.Location(targetUri, new vscode.Position(0, 0));
  }

  /**
   * Resolves a bare module specifier to its package entry point.
   * Reads the package.json of the npm package to find the main/module/types entry.
   * This enables Ctrl+Click on package names like 'lodash', 'vue', etc.
   *
   * WebStorm resolves these via its own index; we achieve similar by reading package.json.
   */
  private resolvePackageEntryPoint(
    importPath: string,
    rootPath: string,
    config: FileJumpConfig
  ): vscode.Location | undefined {
    // Extract the package name (handle scoped packages like @vue/reactivity)
    const parts = importPath.split('/');
    let pkgName: string;
    let subPath: string;

    if (importPath.startsWith('@') && parts.length >= 2) {
      pkgName = parts[0] + '/' + parts[1];
      subPath = parts.slice(2).join('/');
    } else {
      pkgName = parts[0];
      subPath = parts.slice(1).join('/');
    }

    const pkgDir = path.join(rootPath, 'node_modules', pkgName);
    if (!isDirectory(pkgDir)) {
      return undefined;
    }

    // If there's a subpath, resolve it directly
    if (subPath) {
      const subPathAbs = path.join(pkgDir, subPath);
      const resolved = tryResolveFile(subPathAbs, config);
      if (resolved) {
        const targetUri = vscode.Uri.file(resolved.filePath);
        return new vscode.Location(targetUri, new vscode.Position(0, 0));
      }
      return undefined;
    }

    // Read package.json to find entry point
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!isFile(pkgJsonPath)) {
      return undefined;
    }

    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

      // Priority: module > main > types > typings (similar to WebStorm resolution order)
      const entryFields = ['module', 'main', 'types', 'typings'];
      for (const field of entryFields) {
        const entry = pkgJson[field];
        if (typeof entry === 'string') {
          const entryPath = path.join(pkgDir, entry);
          const resolved = tryResolveFile(entryPath, config);
          if (resolved) {
            const targetUri = vscode.Uri.file(resolved.filePath);
            return new vscode.Location(targetUri, new vscode.Position(0, 0));
          }
        }
      }

      // Fallback: try index file in package root
      const resolved = tryResolveFile(path.join(pkgDir, 'index'), config);
      if (resolved) {
        const targetUri = vscode.Uri.file(resolved.filePath);
        return new vscode.Location(targetUri, new vscode.Position(0, 0));
      }
    } catch {
      // Ignore JSON parse errors
    }

    return undefined;
  }

  /**
   * Refreshes the alias cache if it has expired.
   * Gathers aliases from all configured sources:
   * 1. User-defined alias map (settings)
   * 2. Webpack config file
   * 3. tsconfig.json/jsconfig.json paths (with extends support)
   * 4. Common config files (vue.config.js, vite.config.ts, etc.)
   * 5. Monorepo sub-packages
   */
  private async refreshAliases(rootPath: string, config: FileJumpConfig): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefreshTime < this.CACHE_TTL_MS) {
      return;
    }

    this.lastRefreshTime = now;
    const aliases: TaggedAlias[] = [];
    this.tsConfigAliasKeys = new Set<string>();

    // 1. User-defined aliases from settings (external — built-in TS doesn't know these)
    const userAliases = resolveAliasMap(config.aliasMap, rootPath);
    aliases.push(...userAliases.map(a => ({ ...a, source: AliasSource.External })));

    // 2. Webpack config aliases (external)
    if (config.webpackConfigPath) {
      const webpackPath = path.resolve(rootPath, config.webpackConfigPath);
      const webpackAliases = readWebpackAliases(webpackPath, rootPath);
      aliases.push(...webpackAliases.map(a => ({ ...a, source: AliasSource.External })));
    }

    // 3. tsconfig/jsconfig paths (built-in TS service handles these)
    const tsAliases = readTsConfigPaths(rootPath);
    for (const a of tsAliases) {
      aliases.push({ ...a, source: AliasSource.TsConfig });
      this.tsConfigAliasKeys.add(a.alias);
    }

    // 4. Common config files — vite/vue/webpack (external)
    const configAliases = readCommonConfigAliases(rootPath);
    aliases.push(...configAliases.map(a => ({ ...a, source: AliasSource.External })));

    // De-duplicate: keep the first occurrence of each alias
    this.cachedAliases = deduplicateAliases(aliases);

    // 5. Detect monorepo packages
    if (config.autoDetectMonorepo) {
      this.cachedMonorepoPackages = detectMonorepoPackages(rootPath);
    }
  }
}

/**
 * De-duplicates aliases by keeping the first mapping for each alias prefix.
 */
function deduplicateAliases(aliases: TaggedAlias[]): TaggedAlias[] {
  const seen = new Set<string>();
  return aliases.filter(a => {
    if (seen.has(a.alias)) {
      return false;
    }
    seen.add(a.alias);
    return true;
  });
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
