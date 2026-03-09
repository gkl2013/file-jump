/**
 * Unit tests for importParser module.
 */

import { extractImportPath } from '../utils/importParser';

describe('extractImportPath', () => {
  it('should extract ES module default import', () => {
    expect(extractImportPath("import App from '@/App'")).toBe('@/App');
  });

  it('should extract ES module named import', () => {
    expect(extractImportPath("import { helper } from '@/utils/helper'")).toBe('@/utils/helper');
  });

  it('should extract ES module namespace import', () => {
    expect(extractImportPath("import * as utils from '@/utils'")).toBe('@/utils');
  });

  it('should extract bare import (side-effect)', () => {
    expect(extractImportPath("import '@/styles/main.css'")).toBe('@/styles/main.css');
  });

  it('should extract dynamic import', () => {
    expect(extractImportPath("const mod = import('@/views/Home')")).toBe('@/views/Home');
  });

  it('should extract require call', () => {
    expect(extractImportPath("const helper = require('@/utils/helper')")).toBe('@/utils/helper');
  });

  it('should extract CSS @import', () => {
    expect(extractImportPath("@import '~@/styles/variables.scss'")).toBe('~@/styles/variables.scss');
  });

  it('should extract relative import', () => {
    expect(extractImportPath("import Header from './components/Header'")).toBe('./components/Header');
  });

  it('should return undefined for non-import line', () => {
    expect(extractImportPath('const x = 42;')).toBeUndefined();
  });

  it('should handle double quotes', () => {
    expect(extractImportPath('import App from "@/App"')).toBe('@/App');
  });
});
