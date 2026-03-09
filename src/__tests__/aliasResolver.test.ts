/**
 * Unit tests for aliasResolver module.
 */

import * as path from 'path';
import * as fs from 'fs';
import { resolveAliasPath, findMatchingAlias, tryResolveFile } from '../resolvers/aliasResolver';
import { AliasMapping, FileJumpConfig } from '../types';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

const defaultConfig: FileJumpConfig = {
  aliasMap: {},
  webpackConfigPath: '',
  vueExtension: true,
  autoDetectMonorepo: true,
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'],
};

describe('findMatchingAlias', () => {
  const aliases: AliasMapping[] = [
    { alias: '@', path: '/project/src' },
    { alias: '@components', path: '/project/src/components' },
    { alias: '~', path: '/project/src' },
  ];

  it('should match exact alias', () => {
    const result = findMatchingAlias('@', aliases);
    expect(result?.alias).toBe('@');
  });

  it('should match alias with path', () => {
    const result = findMatchingAlias('@/utils/helper', aliases);
    expect(result?.alias).toBe('@');
  });

  it('should prefer longest matching alias', () => {
    const result = findMatchingAlias('@components/Button', aliases);
    expect(result?.alias).toBe('@components');
    expect(result?.path).toBe('/project/src/components');
  });

  it('should return undefined for non-matching path', () => {
    const result = findMatchingAlias('lodash', aliases);
    expect(result).toBeUndefined();
  });

  it('should match tilde alias', () => {
    const result = findMatchingAlias('~/views/Home', aliases);
    expect(result?.alias).toBe('~');
  });
});

describe('tryResolveFile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should resolve exact file path', () => {
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (p === '/project/src/utils/helper.ts') {
        return { isFile: () => true, isDirectory: () => false } as fs.Stats;
      }
      throw new Error('ENOENT');
    });

    const result = tryResolveFile('/project/src/utils/helper.ts', defaultConfig);
    expect(result).toBe('/project/src/utils/helper.ts');
  });

  it('should resolve by trying extensions', () => {
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (p === '/project/src/utils/helper.ts') {
        return { isFile: () => true, isDirectory: () => false } as fs.Stats;
      }
      throw new Error('ENOENT');
    });

    const result = tryResolveFile('/project/src/utils/helper', defaultConfig);
    expect(result).toBe('/project/src/utils/helper.ts');
  });

  it('should resolve index file in directory', () => {
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (p === '/project/src/components') {
        return { isFile: () => false, isDirectory: () => true } as fs.Stats;
      }
      if (p === '/project/src/components/index.ts') {
        return { isFile: () => true, isDirectory: () => false } as fs.Stats;
      }
      throw new Error('ENOENT');
    });

    const result = tryResolveFile('/project/src/components', defaultConfig);
    expect(result).toBe('/project/src/components/index.ts');
  });

  it('should resolve .vue extension when enabled', () => {
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (p === '/project/src/views/Home.vue') {
        return { isFile: () => true, isDirectory: () => false } as fs.Stats;
      }
      throw new Error('ENOENT');
    });

    const result = tryResolveFile('/project/src/views/Home', defaultConfig);
    expect(result).toBe('/project/src/views/Home.vue');
  });

  it('should return undefined when file not found', () => {
    mockFs.statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = tryResolveFile('/project/src/nonexistent', defaultConfig);
    expect(result).toBeUndefined();
  });
});

describe('resolveAliasPath', () => {
  const aliases: AliasMapping[] = [
    { alias: '@', path: '/project/src' },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should resolve alias path to file', () => {
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (p === '/project/src/utils/helper.ts') {
        return { isFile: () => true, isDirectory: () => false } as fs.Stats;
      }
      throw new Error('ENOENT');
    });

    const result = resolveAliasPath('@/utils/helper', aliases, defaultConfig);
    expect(result?.filePath).toBe('/project/src/utils/helper.ts');
    expect(result?.originalImport).toBe('@/utils/helper');
  });

  it('should return undefined for non-alias path', () => {
    const result = resolveAliasPath('lodash', aliases, defaultConfig);
    expect(result).toBeUndefined();
  });
});
