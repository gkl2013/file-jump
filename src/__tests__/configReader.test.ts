/**
 * Unit tests for configReader module.
 */

import * as path from 'path';
import * as fs from 'fs';
import { resolveAliasMap, readTsConfigPaths } from '../utils/configReader';

jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('resolveAliasMap', () => {
  it('should resolve relative paths against rootPath', () => {
    const result = resolveAliasMap({ '@': 'src', '~': 'src/assets' }, '/project');
    expect(result).toEqual([
      { alias: '@', path: path.resolve('/project', 'src') },
      { alias: '~', path: path.resolve('/project', 'src/assets') },
    ]);
  });

  it('should keep absolute paths as-is', () => {
    const result = resolveAliasMap({ '@': '/absolute/path/src' }, '/project');
    expect(result).toEqual([
      { alias: '@', path: '/absolute/path/src' },
    ]);
  });

  it('should return empty array for empty map', () => {
    const result = resolveAliasMap({}, '/project');
    expect(result).toEqual([]);
  });
});

describe('readTsConfigPaths', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should read paths from tsconfig.json', () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      return p === path.join('/project', 'tsconfig.json');
    });

    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (p === path.join('/project', 'tsconfig.json')) {
        return JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@/*': ['src/*'],
              '@components/*': ['src/components/*'],
            },
          },
        });
      }
      throw new Error('ENOENT');
    });

    const result = readTsConfigPaths('/project');
    expect(result).toEqual([
      { alias: '@', path: path.resolve('/project', 'src') },
      { alias: '@components', path: path.resolve('/project', 'src/components') },
    ]);
  });

  it('should return empty array when no config found', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = readTsConfigPaths('/project');
    expect(result).toEqual([]);
  });
});
