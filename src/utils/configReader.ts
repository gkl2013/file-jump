/**
 * Configuration reader module.
 * Reads alias configuration from VSCode settings, webpack/vite config files,
 * and tsconfig/jsconfig with recursive extends support.
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
      '.ts', '.tsx', '.js', '.jsx', '.vue', '.json',
      '.css', '.scss', '.less', '.sass', '.styl',
      '.svelte', '.mjs', '.cjs',
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
 * Reads aliases from Vite config files.
 * Handles both simple alias objects and array-style resolve.alias.
 *
 * @param configPath - Absolute path to the vite config file
 * @param rootPath - The workspace root path
 * @returns Array of AliasMapping
 */
function readViteAliases(configPath: string, rootPath: string): AliasMapping[] {
  try {
    if (!fs.existsSync(configPath)) {
      return [];
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const aliases: AliasMapping[] = [];

    // Strategy 1: Match object-style alias: { '@': path.resolve(...) }
    const webpackAliases = readWebpackAliases(configPath, rootPath);
    if (webpackAliases.length > 0) {
      return webpackAliases;
    }

    // Strategy 2: Match array-style alias used in Vite:
    //   resolve: { alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }] }
    //   resolve: { alias: [{ find: /^~/, replacement: '' }] }
    const aliasArrayRegex = /alias\s*:\s*\[([\s\S]*?)\]/;
    const arrayMatch = content.match(aliasArrayRegex);
    if (arrayMatch) {
      const arrayContent = arrayMatch[1];
      // Match each { find: '...', replacement: '...' } or { find: '...', replacement: resolve('...') }
      const entryRegex = /find\s*:\s*['"]([^'"]+)['"][\s\S]*?replacement\s*:\s*(?:path\.(?:resolve|join)\s*\([^)]*,\s*['"]([^'"]+)['"]\s*\)|(?:file)?(?:URL)?(?:toPath)?\s*\(\s*['"]([^'"]+)['"]\s*\)|resolve\s*\(\s*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])/g;
      let match: RegExpExecArray | null;

      while ((match = entryRegex.exec(arrayContent)) !== null) {
        const alias = match[1];
        const resolvedPath = match[2] || match[3] || match[4] || match[5];
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
    console.warn(`[File Jump] Failed to read vite config at ${configPath}:`, error);
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
  // Vite config files — use enhanced Vite parser
  const viteConfigs = [
    'vite.config.js',
    'vite.config.ts',
    'vite.config.mjs',
    'vite.config.mts',
  ];

  for (const configFile of viteConfigs) {
    const configPath = path.join(rootPath, configFile);
    if (fs.existsSync(configPath)) {
      const aliases = readViteAliases(configPath, rootPath);
      if (aliases.length > 0) {
        return aliases;
      }
    }
  }

  // Vue/Webpack config files — use webpack alias parser
  const otherConfigs = [
    'vue.config.js',
    'vue.config.ts',
    'webpack.config.js',
    'webpack.config.ts',
  ];

  for (const configFile of otherConfigs) {
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
 * Reads and parses a JSON file with comments (JSONC).
 * Removes both single-line (//) and multi-line comments before parsing.
 *
 * @param filePath - Absolute path to the JSON/JSONC file
 * @returns Parsed JSON object, or undefined on failure
 */
function readJsonc(filePath: string): any {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Remove trailing commas before } or ]
    const cleanContent = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleanContent);
  } catch {
    return undefined;
  }
}

/**
 * Resolves the path to an extended tsconfig file.
 * Handles both relative paths and node_modules packages.
 *
 * @param extendsValue - The "extends" string from tsconfig
 * @param configDir - The directory containing the current tsconfig
 * @returns Absolute path to the extended config file, or undefined
 */
function resolveExtendsPath(extendsValue: string, configDir: string): string | undefined {
  // Relative path
  if (extendsValue.startsWith('.') || extendsValue.startsWith('/')) {
    const resolved = path.resolve(configDir, extendsValue);
    // Try exact path, then with .json extension
    for (const candidate of [resolved, resolved + '.json']) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  // Node module path (e.g. "@tsconfig/node20/tsconfig.json" or "tsconfig-paths/tsconfig")
  const nodeModulesDir = path.join(configDir, 'node_modules');
  const candidates = [
    path.join(nodeModulesDir, extendsValue),
    path.join(nodeModulesDir, extendsValue + '.json'),
    path.join(nodeModulesDir, extendsValue, 'tsconfig.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Recursively reads tsconfig/jsconfig paths, handling the "extends" chain.
 * Merges paths from parent configs, with child paths taking priority.
 *
 * @param configPath - Absolute path to the tsconfig/jsconfig file
 * @param rootPath - The workspace root path
 * @param visited - Set of already-visited config paths to prevent circular references
 * @returns Object with merged paths and resolved baseUrl
 */
function readTsConfigWithExtends(
  configPath: string,
  rootPath: string,
  visited: Set<string> = new Set()
): { paths: Record<string, string[]>; baseUrl: string; basePath: string } | undefined {
  if (visited.has(configPath) || !fs.existsSync(configPath)) {
    return undefined;
  }
  visited.add(configPath);

  const config = readJsonc(configPath);
  if (!config) {
    return undefined;
  }

  const configDir = path.dirname(configPath);
  let mergedPaths: Record<string, string[]> = {};
  let baseUrl = config?.compilerOptions?.baseUrl || '.';

  // First, resolve the parent config if "extends" is present
  if (config.extends) {
    const extendsValues = Array.isArray(config.extends) ? config.extends : [config.extends];
    for (const extendsValue of extendsValues) {
      const parentPath = resolveExtendsPath(extendsValue, configDir);
      if (parentPath) {
        const parentResult = readTsConfigWithExtends(parentPath, rootPath, visited);
        if (parentResult?.paths) {
          mergedPaths = { ...mergedPaths, ...parentResult.paths };
        }
        // Inherit baseUrl from parent if not defined locally
        if (!config?.compilerOptions?.baseUrl && parentResult?.baseUrl) {
          baseUrl = parentResult.baseUrl;
        }
      }
    }
  }

  // Child paths override parent paths
  const childPaths = config?.compilerOptions?.paths;
  if (childPaths) {
    mergedPaths = { ...mergedPaths, ...childPaths };
  }

  const basePath = path.resolve(configDir, baseUrl);

  return { paths: mergedPaths, baseUrl, basePath };
}

/**
 * Attempts to read aliases from tsconfig.json / jsconfig.json paths.
 * Supports recursive "extends" inheritance.
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
      const result = readTsConfigWithExtends(configPath, rootPath);
      if (!result || !result.paths || Object.keys(result.paths).length === 0) {
        continue;
      }

      const aliases: AliasMapping[] = [];

      for (const [pattern, targets] of Object.entries(result.paths)) {
        if (!Array.isArray(targets) || targets.length === 0) {
          continue;
        }

        // Convert path pattern like "@/*" -> alias "@"
        const alias = pattern.replace(/\/\*$/, '');
        const targetPath = (targets[0] as string).replace(/\/\*$/, '');

        aliases.push({
          alias,
          path: path.resolve(result.basePath, targetPath),
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
