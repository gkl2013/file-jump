/**
 * Configuration reader module.
 * Reads alias configuration from VSCode settings and webpack config files.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileJumpConfig, AliasMapping } from '../types';

/**
 * Reads the FileJump configuration from VSCode workspace settings.
 */
export function getConfig(): FileJumpConfig {
  const config = vscode.workspace.getConfiguration('fileJump');
  return {
    aliasMap: config.get<Record<string, string>>('aliasMap', {}),
    webpackConfigPath: config.get<string>('webpackConfigPath', ''),
    vueExtension: config.get<boolean>('vueExtension', true),
    autoDetectMonorepo: config.get<boolean>('autoDetectMonorepo', true),
    extensions: config.get<string[]>('extensions', [
      '.ts', '.tsx', '.js', '.jsx', '.vue', '.json', '.css', '.scss', '.less',
    ]),
  };
}

/**
 * Resolves alias mappings from the user-defined aliasMap setting.
 * Converts relative paths in the alias map to absolute paths based on the given root.
 *
 * @param aliasMap - The alias map from settings, e.g. { "@": "src" }
 * @param rootPath - The workspace or package root path to resolve relative paths against
 * @returns Array of resolved AliasMapping objects
 */
export function resolveAliasMap(
  aliasMap: Record<string, string>,
  rootPath: string
): AliasMapping[] {
  return Object.entries(aliasMap).map(([alias, relativePath]) => ({
    alias,
    path: path.isAbsolute(relativePath)
      ? relativePath
      : path.resolve(rootPath, relativePath),
  }));
}

/**
 * Attempts to read webpack config and extract resolve.alias.
 * Supports basic static analysis of webpack config (does not execute the config).
 *
 * @param configPath - Absolute path to the webpack config file
 * @param rootPath - The workspace root path for resolving relative alias paths
 * @returns Array of AliasMapping extracted from webpack config, or empty array on failure
 */
export function readWebpackAliases(
  configPath: string,
  rootPath: string
): AliasMapping[] {
  try {
    if (!fs.existsSync(configPath)) {
      return [];
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const aliases: AliasMapping[] = [];

    // Match resolve.alias patterns like:
    //   resolve: { alias: { '@': path.resolve(__dirname, 'src') } }
    //   '@': resolve('src')
    //   '@components': path.join(__dirname, 'src/components')
    const aliasBlockRegex = /alias\s*:\s*\{([^}]*)\}/s;
    const aliasBlockMatch = content.match(aliasBlockRegex);

    if (aliasBlockMatch) {
      const aliasBlock = aliasBlockMatch[1];

      // Match each alias entry: 'key': value or "key": value
      const entryRegex = /['"]([^'"]+)['"]\s*:\s*(?:path\.(?:resolve|join)\s*\([^)]*,\s*['"]([^'"]+)['"]\s*\)|resolve\s*\(\s*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])/g;
      let match: RegExpExecArray | null;

      while ((match = entryRegex.exec(aliasBlock)) !== null) {
        const alias = match[1];
        const resolvedPath = match[2] || match[3] || match[4];
        if (alias && resolvedPath) {
          aliases.push({
            alias,
            path: path.isAbsolute(resolvedPath)
              ? resolvedPath
              : path.resolve(rootPath, resolvedPath),
          });
        }
      }
    }

    return aliases;
  } catch (error) {
    console.warn(`[File Jump] Failed to read webpack config at ${configPath}:`, error);
    return [];
  }
}

/**
 * Attempts to read aliases from common config files (vue.config.js, vite.config.ts, etc.).
 * This is a best-effort static analysis approach.
 *
 * @param rootPath - The workspace or package root path
 * @returns Array of AliasMapping found in config files
 */
export function readCommonConfigAliases(rootPath: string): AliasMapping[] {
  const configFiles = [
    'vue.config.js',
    'vue.config.ts',
    'vite.config.js',
    'vite.config.ts',
    'webpack.config.js',
    'webpack.config.ts',
  ];

  for (const configFile of configFiles) {
    const configPath = path.join(rootPath, configFile);
    if (fs.existsSync(configPath)) {
      const aliases = readWebpackAliases(configPath, rootPath);
      if (aliases.length > 0) {
        return aliases;
      }
    }
  }

  return [];
}

/**
 * Attempts to read aliases from tsconfig.json / jsconfig.json paths.
 * Maps compilerOptions.paths entries to alias mappings.
 *
 * @param rootPath - The workspace or package root path
 * @returns Array of AliasMapping derived from paths config
 */
export function readTsConfigPaths(rootPath: string): AliasMapping[] {
  const configFiles = ['tsconfig.json', 'jsconfig.json'];

  for (const configFile of configFiles) {
    const configPath = path.join(rootPath, configFile);
    if (!fs.existsSync(configPath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      // Remove comments (simple approach for JSON with comments)
      const cleanContent = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const config = JSON.parse(cleanContent);

      const paths = config?.compilerOptions?.paths;
      const baseUrl = config?.compilerOptions?.baseUrl || '.';
      const basePath = path.resolve(rootPath, baseUrl);

      if (!paths) {
        continue;
      }

      const aliases: AliasMapping[] = [];

      for (const [pattern, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets) || targets.length === 0) {
          continue;
        }

        // Convert path pattern like "@/*" -> alias "@"
        const alias = pattern.replace(/\/\*$/, '');
        const targetPath = (targets[0] as string).replace(/\/\*$/, '');

        aliases.push({
          alias,
          path: path.resolve(basePath, targetPath),
        });
      }

      if (aliases.length > 0) {
        return aliases;
      }
    } catch (error) {
      console.warn(`[File Jump] Failed to parse ${configPath}:`, error);
    }
  }

  return [];
}
