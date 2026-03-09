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
import { resolveAliasPath, resolveRelativePath } from '../resolvers/aliasResolver';
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

    // Skip node_modules imports (bare specifiers without @ alias)
    if (this.isBareModuleSpecifier(importPath, config)) {
      return undefined;
    }

    // Get the workspace root
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    const rootPath = workspaceFolder.uri.fsPath;

    // Refresh alias cache if needed
    await this.refreshAliases(rootPath, config);

    // Determine which aliases to use based on the current file's location
    const aliases = this.getAliasesForFile(document.uri.fsPath, rootPath, config);

    // Try to resolve the import path
    let result = resolveAliasPath(importPath, aliases, config);

    // If alias resolution failed, try relative path resolution
    if (!result && importPath.startsWith('.')) {
      result = resolveRelativePath(importPath, document.uri.fsPath, config);
    }

    if (result) {
      const targetUri = vscode.Uri.file(result.filePath);
      return new vscode.Location(targetUri, new vscode.Position(0, 0));
    }

    return undefined;
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
