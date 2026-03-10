/**
 * VSCode DefinitionProvider implementation.
 * This is the main entry point for Ctrl/Cmd+Click file jump functionality.
 * Registers as a DefinitionProvider to intercept "Go to Definition" requests
 * and resolve alias import paths to actual file locations.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig, resolveAliasMap, readWebpackAliases, readTsConfigPaths, readCommonConfigAliases } from '../utils/configReader';
import { getImportContextAtPosition } from '../utils/importParser';
import { resolveAliasPath } from '../resolvers/aliasResolver';
import { detectMonorepoPackages, findPackageForFile } from '../utils/monorepoDetector';
import { AliasMapping, MonorepoPackage, FileJumpConfig } from '../types';

/**
 * Provides definition locations for alias import paths.
 * Implements vscode.DefinitionProvider to enable Ctrl/Cmd+Click jump.
 */
export class FileJumpDefinitionProvider implements vscode.DefinitionProvider {
  private cachedAliases: AliasMapping[] = [];
  private cachedMonorepoPackages: MonorepoPackage[] = [];
  private lastRefreshTime = 0;
  private readonly CACHE_TTL_MS = 10000; // 10 seconds

  /**
   * Called by VSCode when the user Ctrl/Cmd+Clicks on a token.
   * Resolves the import path under the cursor to a file location.
   *
   * IMPORTANT: Only handles alias paths (e.g. '@/...', '~/...').
   * Relative paths ('./...', '../...') and bare module specifiers ('lodash')
   * are left to VSCode's built-in TS/JS language service to avoid duplicate definitions.
   */
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | undefined> {
    const config = getConfig();

    // Extract the import path at cursor position
    const importContext = getImportContextAtPosition(document, position);
    if (!importContext) {
      return undefined;
    }

    const { importPath } = importContext;

    // Skip relative paths — VSCode built-in service already handles these.
    // Processing them here would produce duplicate definitions.
    if (importPath.startsWith('.') || importPath.startsWith('/')) {
      return undefined;
    }

    // Get the workspace root
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    const rootPath = workspaceFolder.uri.fsPath;

    // IMPORTANT: Refresh alias cache BEFORE checking bare module specifier,
    // because isBareModuleSpecifier relies on cachedAliases being populated.
    // If we check before refreshing, all alias paths would be incorrectly
    // treated as bare module specifiers on first load (when cache is empty).
    await this.refreshAliases(rootPath, config);

    // Skip node_modules imports (bare specifiers without @ alias)
    if (this.isBareModuleSpecifier(importPath, config)) {
      return undefined;
    }

    // Determine which aliases to use based on the current file's location
    const aliases = this.getAliasesForFile(document.uri.fsPath, rootPath, config);

    // Only try alias resolution — this is the only scenario where
    // VSCode's built-in service cannot resolve the path
    const result = resolveAliasPath(importPath, aliases, config);

    if (!result) {
      return undefined;
    }

    // De-duplicate strategy:
    // VSCode's built-in TS/JS language service (with tsconfig paths) can resolve
    // alias paths for JS/TS file types on its own — including extension completion
    // for .ts, .tsx, .js, .jsx and index file resolution.
    // We only need to intervene for file types the built-in service does NOT handle,
    // such as .vue, .css, .scss, .less, .json, etc.
    // If the resolved file has a JS/TS extension, skip to avoid duplicate definitions.
    const jsExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
    const resolvedExt = path.extname(result.filePath).toLowerCase();
    if (jsExtensions.has(resolvedExt)) {
      // Built-in TS/JS service can handle this, skip to avoid duplicates
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
    rootPath: string,
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
   * Checks if the import path is a bare module specifier (i.e., a node_modules package).
   * Returns true for things like 'lodash', 'vue', 'element-ui/lib/button'.
   * Returns false for alias paths like '@/components' or '~/utils'.
   */
  private isBareModuleSpecifier(importPath: string, config: FileJumpConfig): boolean {
    // Relative paths are not bare specifiers
    if (importPath.startsWith('.') || importPath.startsWith('/')) {
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
   * Refreshes the alias cache if it has expired.
   * Gathers aliases from all configured sources:
   * 1. User-defined alias map (settings)
   * 2. Webpack config file
   * 3. tsconfig.json/jsconfig.json paths
   * 4. Common config files (vue.config.js, vite.config.ts, etc.)
   * 5. Monorepo sub-packages
   */
  private async refreshAliases(rootPath: string, config: FileJumpConfig): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefreshTime < this.CACHE_TTL_MS) {
      return;
    }

    this.lastRefreshTime = now;
    const aliases: AliasMapping[] = [];

    // 1. User-defined aliases from settings
    const userAliases = resolveAliasMap(config.aliasMap, rootPath);
    aliases.push(...userAliases);

    // 2. Webpack config aliases
    if (config.webpackConfigPath) {
      const webpackPath = path.resolve(rootPath, config.webpackConfigPath);
      const webpackAliases = readWebpackAliases(webpackPath, rootPath);
      aliases.push(...webpackAliases);
    }

    // 3. tsconfig/jsconfig paths
    const tsAliases = readTsConfigPaths(rootPath);
    aliases.push(...tsAliases);

    // 4. Common config files
    const configAliases = readCommonConfigAliases(rootPath);
    aliases.push(...configAliases);

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
function deduplicateAliases(aliases: AliasMapping[]): AliasMapping[] {
  const seen = new Set<string>();
  return aliases.filter(a => {
    if (seen.has(a.alias)) {
      return false;
    }
    seen.add(a.alias);
    return true;
  });
}
