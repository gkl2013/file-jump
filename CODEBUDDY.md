# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Project Overview

**File Jump** 是一个 VSCode 插件，核心功能是通过 `Ctrl/Cmd+Click` 实现别名路径（webpack alias、自定义 alias）的快速跳转。插件以 `DefinitionProvider` 注册到 VSCode，拦截 "Go to Definition" 请求，将别名路径解析为实际文件路径。

关键场景：
- **Vue 项目**：引入路径省略 `.vue` 后缀时仍能正确跳转（如 `import Header from '@/components/Header'`）
- **Monorepo（单仓）项目**：自动检测子项目，在对应子项目内解析别名（如 `packages/web` 和 `packages/admin` 各自有独立的 `@` 别名映射）
- **多种别名来源**：自动读取 `tsconfig.json`/`jsconfig.json` paths、`vue.config.js`、`vite.config.ts`、`webpack.config.js` 及用户手动配置

## Commands

### 编译构建
```bash
npm run compile     # 一次性 TypeScript 编译，输出到 out/
npm run watch       # 监听模式编译，开发时使用
```

### 运行测试
```bash
npm test                              # 运行所有测试
npm test -- --testPathPattern=alias   # 运行匹配名称的测试文件
npx jest src/__tests__/importParser.test.ts  # 运行单个测试文件
npm run test:watch                    # 监听模式运行测试
npm run test:coverage                 # 生成覆盖率报告
```

### 代码检查与打包
```bash
npm run lint        # ESLint 检查 src 目录下的 TypeScript 文件
npm run package     # 使用 vsce 打包为 .vsix 文件
```

### 调试插件
在 VSCode 中按 `F5` 启动 Extension Host 调试（配置在 `.vscode/launch.json`）。

## Architecture

### 核心数据流

```
用户 Ctrl/Cmd+Click
  → VSCode 调用 DefinitionProvider.provideDefinition()
    → importParser 解析光标处 import 路径
    → 判断是否为 bare module (node_modules 包) → 是则跳过
    → refreshAliases() 加载/缓存别名（10秒 TTL）
    → getAliasesForFile() 根据 monorepo 上下文选择正确的别名集
    → aliasResolver 将别名路径解析为绝对文件路径
    → 返回 vscode.Location 实现跳转
```

### 模块职责

**`src/extension.ts`** — 插件入口点。`activate()` 将 `FileJumpDefinitionProvider` 注册到 8 种语言（JS/TS/JSX/TSX/Vue/CSS/SCSS/LESS），`deactivate()` 做清理。不包含业务逻辑。

**`src/types.ts`** — 所有共享类型定义。核心类型：
- `AliasMapping`：别名前缀到文件系统路径的映射
- `FileJumpConfig`：从 VSCode 设置读取的配置
- `MonorepoPackage`：monorepo 子项目信息，含包名、根路径、别名列表
- `ImportContext`：光标处 import 语句的解析结果（路径字符串、偏移量、行号）
- `ResolveResult`：解析后的绝对路径及原始 import 字符串

**`src/providers/definitionProvider.ts`** — 核心协调器，实现 `vscode.DefinitionProvider` 接口。职责：
1. 从 `importParser` 获取光标处的 import 路径
2. 过滤 bare module specifier（避免干扰 node_modules 包的跳转）
3. 管理别名缓存（`cachedAliases` 和 `cachedMonorepoPackages`，带 10 秒 TTL）
4. 调用 `refreshAliases()` 从 5 个来源聚合别名：用户设置 → webpack 配置 → tsconfig paths → 通用配置文件 → monorepo 子包
5. 通过 `getAliasesForFile()` 判断当前文件所在的 monorepo 子包，使用对应子包的别名（而非全局别名）
6. 调用 `aliasResolver` 解析路径，先尝试别名解析、再尝试相对路径解析

**`src/resolvers/aliasResolver.ts`** — 路径解析引擎。核心函数：
- `findMatchingAlias()`：最长前缀匹配算法，确保 `@components/Button` 匹配 `@components` 而非 `@`
- `resolveAliasPath()`：替换别名前缀 → 拼接绝对路径 → 调用 `tryResolveFile()`
- `tryResolveFile()`：文件解析策略链——精确路径 → 逐个尝试后缀（`.ts`、`.vue` 等） → 目录下 `index.*` 文件。这是 Vue 文件省略后缀能跳转的关键
- `resolveRelativePath()`：处理 `./` 和 `../` 开头的相对路径

**`src/utils/configReader.ts`** — 配置读取层。从多种来源提取别名：
- `getConfig()`：从 VSCode `workspace.getConfiguration('fileJump')` 读取用户设置
- `resolveAliasMap()`：将用户设置中的相对路径转为绝对路径
- `readWebpackAliases()`：正则静态分析 webpack 配置文件中的 `resolve.alias`（不执行 JS）
- `readTsConfigPaths()`：解析 `tsconfig.json`/`jsconfig.json` 的 `compilerOptions.paths`，处理 `@/*: ['src/*']` 格式
- `readCommonConfigAliases()`：遍历 `vue.config.js`、`vite.config.ts` 等常见配置文件

**`src/utils/monorepoDetector.ts`** — Monorepo 感知模块。职责：
- `detectMonorepoPackages()`：检测 monorepo 结构，支持 `package.json` workspaces、`pnpm-workspace.yaml`、`lerna.json`
- `getWorkspacePatterns()`：从配置文件中提取 workspace glob 模式（如 `packages/*`）
- `resolveGlobDirs()`：将 glob 模式展开为实际目录列表
- `loadPackageInfo()`：加载子包的 `package.json` 并解析其别名
- `findPackageForFile()`：根据文件路径判断属于哪个子包（最长路径前缀匹配）

**`src/utils/importParser.ts`** — Import 语句解析器。使用 5 组正则匹配光标所在行的 import 路径：
- ES module `import ... from 'path'`
- Dynamic `import('path')`
- CommonJS `require('path')`
- CSS `@import 'path'`
- Vue `src="path"` 属性
函数 `getImportContextAtPosition()` 会验证光标字符位置是否落在路径字符串范围内。

### 测试结构

测试位于 `src/__tests__/`，使用 Jest + ts-jest。`src/__mocks__/vscode.ts` 提供 VSCode API 的轻量 mock（Uri、Position、Range、workspace 等），使核心逻辑可以在 Node.js 环境中测试而无需启动 Extension Host。`jest.config.js` 中通过 `moduleNameMapper` 将 `vscode` 模块映射到 mock 文件。

### VSCode 插件配置

`package.json` 中的 `contributes.configuration` 定义了 5 个用户可配置项（`fileJump.*`），`activationEvents` 使插件在打开支持的语言文件时延迟激活。插件入口为编译后的 `out/extension.js`。

### 关键设计决策

1. **静态分析而非执行**：读取 webpack/vite 配置时使用正则匹配而非 `require()` 执行，避免副作用和安全风险
2. **缓存 + TTL**：别名缓存 10 秒自动刷新，平衡性能与配置变更响应
3. **最长前缀匹配**：别名匹配使用贪心算法，确保 `@components` 优先于 `@`
4. **后缀补全优先级**：`extensions` 数组的顺序决定了文件后缀尝试的优先级，`.vue` 默认在列表中
