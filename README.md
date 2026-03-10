# Alias File Jump - VSCode Extension

一个 VSCode 插件，支持按住 Ctrl/Cmd 点击快速跳转 webpack 别名路径、自定义别名路径，同时支持 Vue 文件省略 `.vue` 后缀跳转，以及 monorepo（单仓）子项目内别名跳转。

## 功能特性

- **别名路径跳转**：支持 `@`、`~` 等 webpack/vite 别名路径的 Ctrl/Cmd+Click 跳转
- **自动读取配置**：自动从 `tsconfig.json`、`jsconfig.json`、`vue.config.js`、`vite.config.ts`、`webpack.config.js` 等配置文件中读取别名
- **Vue 后缀补全**：在 Vue 项目中，引入路径未带 `.vue` 后缀也能正确跳转
- **Monorepo 支持**：自动检测 Yarn Workspaces、pnpm Workspaces、Lerna 等 monorepo 结构，在子项目内正确解析别名
- **多语言支持**：支持 JS/TS/JSX/TSX/Vue/CSS/SCSS/LESS 文件中的 import 跳转
- **自定义别名**：可在 VSCode 设置中手动配置别名映射

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
  "fileJump.extensions": [".ts", ".tsx", ".js", ".jsx", ".vue", ".json", ".css", ".scss", ".less"]
}
```

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式编译
npm run watch

# 运行测试
npm test

# 代码检查
npm run lint

# 打包插件
npm run package
```

## 调试

1. 在 VSCode 中打开此项目
2. 按 `F5` 启动调试，会打开一个扩展开发宿主窗口
3. 在宿主窗口中打开一个含有别名路径的项目进行测试

## License

MIT
