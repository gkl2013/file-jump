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

  it('should handle tsconfig.json with comments', () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      return p === path.join('/project', 'tsconfig.json');
    });

    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (p === path.join('/project', 'tsconfig.json')) {
        return `{
          // This is a comment
          "compilerOptions": {
            "baseUrl": ".",
            /* block comment */
            "paths": {
              "@/*": ["src/*"]
            }
          }
        }`;
      }
      throw new Error('ENOENT');
    });

    const result = readTsConfigPaths('/project');
    expect(result).toEqual([
      { alias: '@', path: path.resolve('/project', 'src') },
    ]);
  });

  it('should handle tsconfig.json with trailing commas', () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      return p === path.join('/project', 'tsconfig.json');
    });

    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (p === path.join('/project', 'tsconfig.json')) {
        return `{
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "@/*": ["src/*"],
            },
          },
        }`;
      }
      throw new Error('ENOENT');
    });

    const result = readTsConfigPaths('/project');
    expect(result).toEqual([
      { alias: '@', path: path.resolve('/project', 'src') },
    ]);
  });

  it('should read paths from extended tsconfig', () => {
    const baseTsconfigPath = path.join('/project', 'tsconfig.base.json');
    const tsconfigPath = path.join('/project', 'tsconfig.json');

    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      return p === tsconfigPath || p === baseTsconfigPath;
    });

    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (p === tsconfigPath) {
        return JSON.stringify({
          extends: './tsconfig.base.json',
          compilerOptions: {
            // No paths here — should inherit from base
          },
        });
      }
      if (p === baseTsconfigPath) {
        return JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@/*': ['src/*'],
              '@utils/*': ['src/utils/*'],
            },
          },
        });
      }
      throw new Error('ENOENT');
    });

    const result = readTsConfigPaths('/project');
    expect(result).toEqual([
      { alias: '@', path: path.resolve('/project', 'src') },
      { alias: '@utils', path: path.resolve('/project', 'src/utils') },
    ]);
  });

  it('should override parent paths with child paths', () => {
    const baseTsconfigPath = path.join('/project', 'tsconfig.base.json');
    const tsconfigPath = path.join('/project', 'tsconfig.json');

    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      return p === tsconfigPath || p === baseTsconfigPath;
    });

    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (p === tsconfigPath) {
        return JSON.stringify({
          extends: './tsconfig.base.json',
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@/*': ['lib/*'],  // override parent
            },
          },
        });
      }
      if (p === baseTsconfigPath) {
        return JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@/*': ['src/*'],
              '@utils/*': ['src/utils/*'],
            },
          },
        });
      }
      throw new Error('ENOENT');
    });

    const result = readTsConfigPaths('/project');
    expect(result).toContainEqual({ alias: '@', path: path.resolve('/project', 'lib') });
    expect(result).toContainEqual({ alias: '@utils', path: path.resolve('/project', 'src/utils') });
  });
});
