/**
 * Monorepo detection module.
 * Identifies monorepo structures (Lerna, Yarn Workspaces, pnpm Workspaces, Rush)
 * and locates sub-packages within them.
 */

import * as path from 'path';
import * as fs from 'fs';
import { MonorepoPackage, AliasMapping } from '../types';
import { resolveAliasMap, readTsConfigPaths, readCommonConfigAliases } from './configReader';

/**
 * Detects if the given root path is a monorepo and returns all sub-packages.
 *
 * @param rootPath - The workspace root path
 * @returns Array of MonorepoPackage found, or empty array if not a monorepo
 */
export function detectMonorepoPackages(rootPath: string): MonorepoPackage[] {
  const workspaceDirs = getWorkspacePatterns(rootPath);

  if (workspaceDirs.length === 0) {
    return [];
  }

  const packages: MonorepoPackage[] = [];

  for (const pattern of workspaceDirs) {
    const dirs = resolveGlobDirs(rootPath, pattern);
    for (const dir of dirs) {
      const pkg = loadPackageInfo(dir);
      if (pkg) {
        packages.push(pkg);
      }
    }
  }

  return packages;
}

/**
 * Reads workspace patterns from package.json (Yarn/npm workspaces),
 * pnpm-workspace.yaml, or lerna.json.
 *
 * @param rootPath - The workspace root path
 * @returns Array of glob patterns for workspace packages
 */
function getWorkspacePatterns(rootPath: string): string[] {
  // Check package.json workspaces field
  const packageJsonPath = path.join(rootPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (Array.isArray(pkg.workspaces)) {
        return pkg.workspaces;
      }
      if (pkg.workspaces?.packages && Array.isArray(pkg.workspaces.packages)) {
        return pkg.workspaces.packages;
      }
    } catch {
      // ignore parse errors
    }
  }

  // Check pnpm-workspace.yaml
  const pnpmWorkspacePath = path.join(rootPath, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWorkspacePath)) {
    try {
      const content = fs.readFileSync(pnpmWorkspacePath, 'utf-8');
      // Simple YAML parsing for packages array
      const matches = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)*)/);
      if (matches) {
        return matches[1]
          .split('\n')
          .map(line => line.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
          .filter(Boolean);
      }
    } catch {
      // ignore parse errors
    }
  }

  // Check lerna.json
  const lernaPath = path.join(rootPath, 'lerna.json');
  if (fs.existsSync(lernaPath)) {
    try {
      const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf-8'));
      if (Array.isArray(lerna.packages)) {
        return lerna.packages;
      }
    } catch {
      // ignore parse errors
    }
  }

  return [];
}

/**
 * Resolves glob-like directory patterns to actual directory paths.
 * Supports simple patterns like "packages/*" and "apps/*".
 *
 * @param rootPath - The base path to resolve from
 * @param pattern - The glob pattern (e.g. "packages/*")
 * @returns Array of absolute directory paths matching the pattern
 */
function resolveGlobDirs(rootPath: string, pattern: string): string[] {
  // Handle simple glob: packages/* -> list all dirs under packages/
  if (pattern.endsWith('/*') || pattern.endsWith('/**')) {
    const baseDir = path.join(rootPath, pattern.replace(/\/\*+$/, ''));
    if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
      return [];
    }
    return fs.readdirSync(baseDir)
      .map(name => path.join(baseDir, name))
      .filter(p => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
  }

  // Non-glob pattern: treat as a direct directory
  const dirPath = path.join(rootPath, pattern);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    return [dirPath];
  }

  return [];
}

/**
 * Loads package info for a given directory if it contains a package.json.
 * Also resolves alias mappings for the package.
 *
 * @param dirPath - Absolute path to a potential package directory
 * @returns MonorepoPackage if valid, undefined otherwise
 */
function loadPackageInfo(dirPath: string): MonorepoPackage | undefined {
  const packageJsonPath = path.join(dirPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const aliases = resolvePackageAliases(dirPath);

    return {
      name: pkg.name || path.basename(dirPath),
      rootPath: dirPath,
      aliases,
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolves alias mappings for a specific package directory.
 * Checks tsconfig/jsconfig paths and common config files.
 *
 * @param packageRoot - The package root directory
 * @returns Array of AliasMapping for this package
 */
function resolvePackageAliases(packageRoot: string): AliasMapping[] {
  // Try tsconfig/jsconfig paths first
  const tsAliases = readTsConfigPaths(packageRoot);
  if (tsAliases.length > 0) {
    return tsAliases;
  }

  // Try common config files (vue.config.js, vite.config.ts, etc.)
  const configAliases = readCommonConfigAliases(packageRoot);
  if (configAliases.length > 0) {
    return configAliases;
  }

  // Default: map '@' to 'src' if src directory exists
  const srcDir = path.join(packageRoot, 'src');
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    return [{ alias: '@', path: srcDir }];
  }

  return [];
}

/**
 * Finds which monorepo package a given file belongs to.
 *
 * @param filePath - Absolute path of the file
 * @param packages - Array of detected monorepo packages
 * @returns The MonorepoPackage that contains the file, or undefined
 */
export function findPackageForFile(
  filePath: string,
  packages: MonorepoPackage[]
): MonorepoPackage | undefined {
  // Sort by path length descending so that more specific packages match first
  const sorted = [...packages].sort((a, b) => b.rootPath.length - a.rootPath.length);
  return sorted.find(pkg => filePath.startsWith(pkg.rootPath + path.sep));
}
