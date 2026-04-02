# Alias File Jump - VSCode Extension

WebStorm 级别的文件跳转插件。支持按住 Ctrl/Cmd 点击快速跳转别名路径、相对路径、绝对路径、npm 包入口等，覆盖前端开发中几乎所有的文件引用场景。

## 功能特性

### 核心跳转能力

- **别名路径跳转**：支持 `@`、`~` 等 webpack/vite 别名路径的 Ctrl/Cmd+Click 跳转
- **自动读取配置**：自动从 `tsconfig.json`（含递归 `extends` 继承）、`jsconfig.json`、`vue.config.js`、`vite.config.ts`、`webpack.config.js` 等配置文件中读取别名
- **后缀补全**：引入路径未带 `.vue`、`.scss`、`.less`、`.sass` 等后缀也能正确跳转
- **Monorepo 支持**：自动检测 Yarn Workspaces、pnpm Workspaces、Lerna 等 monorepo 结构，在子项目内正确解析别名
- **自定义别名**：可在 VSCode 设置中手动配置别名映射

### WebStorm 级别增强

- **多行 import 支持**：支持跨多行的 `import { ... } from '...'` 语句跳转
- **Re-export 支持**：`export { ... } from '...'` 和 `export * from '...'` 跳转
- **绝对路径 import**：`/src/components/...` 开头的路径相对于 workspace 根目录解析
- **CSS `~` 前缀**：`@import '~normalize.css'` 等 webpack sass-loader 风格从 node_modules 解析
- **Sass/SCSS partial**：自动查找 `_variables.scss`、`_index.scss` 等 Sass partial 文件
- **Sass `@use`/`@forward`**：支持 Dart Sass 的 `@use` 和 `@forward` 语法跳转
- **CSS `url()` 引用**：`background: url('@/assets/bg.png')` 路径跳转
- **npm 包入口解析**：Ctrl+Click 包名（如 `lodash`）跳转到包的 main/module 入口文件
- **npm 包子路径**：`element-ui/lib/button` 等带子路径的包引用跳转
- **`require.resolve()`**：`require.resolve('@/utils/helper')` 跳转
- **tsconfig `extends` 递归继承**：支持 `extends: "./tsconfig.base.json"` 多级链式继承的 paths 合并
- **Vite 数组式 alias**：支持 Vite 的 `[{ find: '@', replacement: '...' }]` 配置格式

### 语言与框架支持

- **JavaScript / TypeScript**：JS/TS/JSX/TSX，含动态 `import()` 和 `require()`
- **Vue**：`.vue` 文件中 import 路径、`<template>` 组件标签（PascalCase 和 kebab-case）、`<script src>`、`<style src>`
- **Svelte**：`.svelte` 文件中 import 路径和组件标签
- **CSS / SCSS / Less / Sass**：`@import`、`@use`、`@forward`、`url()`
- **HTML**：`<script src>`、`<link href>` 引用
- **JSON / JSONC**：路径字符串引用

## 配置

在 VSCode 设置中配置：

```json
{
  "fileJump.aliasMap": {
    "@": "src",
    "~": "src"
  },
  "fileJump.webpackConfigPath": "webpack.config.js",
  "fileJump.vueExtension": true,
  "fileJump.autoDetectMonorepo": true,
  "fileJump.extensions": [
    ".ts", ".tsx", ".js", ".jsx", ".vue", ".json",
    ".css", ".scss", ".less", ".sass", ".styl",
    ".svelte", ".mjs", ".cjs"
  ]
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `fileJump.aliasMap` | object | `{}` | 自定义别名映射，如 `{ "@": "src" }` |
| `fileJump.webpackConfigPath` | string | `""` | webpack 配置文件路径（相对于工作区根目录） |
| `fileJump.vueExtension` | boolean | `true` | 是否自动尝试补全 .vue 后缀 |
| `fileJump.autoDetectMonorepo` | boolean | `true` | 是否自动检测 monorepo 子项目 |
| `fileJump.extensions` | string[] | 见上方 | 尝试补全的文件后缀列表（按优先级排列） |

## 别名来源优先级

插件按以下优先级加载别名配置（先到先得，同名别名不会被覆盖）：

1. **用户设置** — `fileJump.aliasMap` 中手动配置的别名
2. **Webpack 配置** — `fileJump.webpackConfigPath` 指定的配置文件
3. **tsconfig/jsconfig** — `compilerOptions.paths`（支持 `extends` 继承链）
4. **常见配置文件** — `vite.config.ts`、`vue.config.js`、`webpack.config.js` 等
5. **Monorepo 子包** — 每个子包独立解析自己的别名

## License

MIT
