/**
 * Unit tests for monorepoDetector module.
 */

import { findPackageForFile } from '../utils/monorepoDetector';
import { MonorepoPackage } from '../types';
import * as path from 'path';

describe('findPackageForFile', () => {
  const packages: MonorepoPackage[] = [
    {
      name: '@myapp/web',
      rootPath: '/project/packages/web',
      aliases: [{ alias: '@', path: '/project/packages/web/src' }],
    },
    {
      name: '@myapp/admin',
      rootPath: '/project/packages/admin',
      aliases: [{ alias: '@', path: '/project/packages/admin/src' }],
    },
    {
      name: '@myapp/shared',
      rootPath: '/project/packages/shared',
      aliases: [{ alias: '@', path: '/project/packages/shared/src' }],
    },
  ];

  it('should find correct package for a file', () => {
    const result = findPackageForFile(
      `/project/packages/web${path.sep}src/views/Home.vue`,
      packages
    );
    expect(result?.name).toBe('@myapp/web');
  });

  it('should find correct package for admin file', () => {
    const result = findPackageForFile(
      `/project/packages/admin${path.sep}src/components/Header.vue`,
      packages
    );
    expect(result?.name).toBe('@myapp/admin');
  });

  it('should return undefined for files not in any package', () => {
    const result = findPackageForFile(
      '/project/scripts/build.js',
      packages
    );
    expect(result).toBeUndefined();
  });
});
