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

## License

MIT
