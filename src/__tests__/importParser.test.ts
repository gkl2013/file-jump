/**
 * Unit tests for importParser module.
 */

import { extractImportPath, getVueComponentImportPath } from '../utils/importParser';

function mockPosition(line: number, character: number): any {
  return { line, character };
}

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

describe('getVueComponentImportPath', () => {
  function createMockDocument(content: string, fileName = 'test.vue') {
    const lines = content.split('\n');
    return {
      fileName,
      getText: () => content,
      lineAt: (line: number) => ({
        text: lines[line] || '',
        lineNumber: line,
      }),
      uri: { fsPath: fileName },
    } as any;
  }

  it('should resolve PascalCase component tag to import path', () => {
    const doc = createMockDocument(
      `<template>
  <MyComponent />
</template>
<script>
import MyComponent from '@/components/MyComponent.vue'
</script>`
    );
    // Cursor on "MyComponent" (line 1, column 3 is the start of "M")
    const result = getVueComponentImportPath(doc, mockPosition(1, 4));
    expect(result).toBe('@/components/MyComponent.vue');
  });

  it('should resolve kebab-case component tag to PascalCase import', () => {
    const doc = createMockDocument(
      `<template>
  <my-component />
</template>
<script>
import MyComponent from '@/components/MyComponent.vue'
</script>`
    );
    // Cursor on "my-component"
    const result = getVueComponentImportPath(doc, mockPosition(1, 5));
    expect(result).toBe('@/components/MyComponent.vue');
  });

  it('should resolve closing tag', () => {
    const doc = createMockDocument(
      `<template>
  <MyComponent>content</MyComponent>
</template>
<script>
import MyComponent from '@/components/MyComponent.vue'
</script>`
    );
    // Cursor on closing "</MyComponent>"
    const result = getVueComponentImportPath(doc, mockPosition(1, 25));
    expect(result).toBe('@/components/MyComponent.vue');
  });

  it('should resolve named import component', () => {
    const doc = createMockDocument(
      `<template>
  <MyDialog />
</template>
<script>
import { MyDialog } from '@/components/dialogs'
</script>`
    );
    const result = getVueComponentImportPath(doc, mockPosition(1, 5));
    expect(result).toBe('@/components/dialogs');
  });

  it('should resolve aliased named import', () => {
    const doc = createMockDocument(
      `<template>
  <CustomButton />
</template>
<script>
import { ElButton as CustomButton } from 'element-ui'
</script>`
    );
    const result = getVueComponentImportPath(doc, mockPosition(1, 5));
    expect(result).toBe('element-ui');
  });

  it('should return undefined for non-component HTML tags', () => {
    const doc = createMockDocument(
      `<template>
  <div>hello</div>
</template>
<script>
import MyComponent from '@/components/MyComponent.vue'
</script>`
    );
    // "div" starts with lowercase, not a component
    const result = getVueComponentImportPath(doc, mockPosition(1, 4));
    expect(result).toBeUndefined();
  });

  it('should return undefined for non-vue files', () => {
    const doc = createMockDocument(
      `<template>
  <MyComponent />
</template>`,
      'test.ts'
    );
    const result = getVueComponentImportPath(doc, mockPosition(1, 5));
    expect(result).toBeUndefined();
  });

  it('should return undefined when component has no matching import', () => {
    const doc = createMockDocument(
      `<template>
  <UnknownComponent />
</template>
<script>
import MyComponent from '@/components/MyComponent.vue'
</script>`
    );
    const result = getVueComponentImportPath(doc, mockPosition(1, 5));
    expect(result).toBeUndefined();
  });

  it('should handle script setup with import', () => {
    const doc = createMockDocument(
      `<template>
  <HeaderNav />
</template>
<script setup>
import HeaderNav from '@/components/HeaderNav.vue'
</script>`
    );
    const result = getVueComponentImportPath(doc, mockPosition(1, 5));
    expect(result).toBe('@/components/HeaderNav.vue');
  });

  it('should resolve relative import path', () => {
    const doc = createMockDocument(
      `<template>
  <SideBar />
</template>
<script>
import SideBar from './SideBar.vue'
</script>`
    );
    const result = getVueComponentImportPath(doc, mockPosition(1, 5));
    expect(result).toBe('./SideBar.vue');
  });
});
