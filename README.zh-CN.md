# SpriteSplit

[English](README.md) | **中文**

SpriteSplit 是一款桌面工具，用于清理不符合严格间距或对齐规则的 AI 生成精灵图集。它通过 PNG 透明度检测独立的非透明区域，允许你可视地修正和整理边界框，可选择通过 AI 生成资产描述进行丰富，并导出结构化元数据和裁剪后的精灵图。

## 特色

- 专为不规则 AI 生成的精灵图集设计，而不仅仅是整齐排列的图集
- 通过透明度连通区域检测精灵图候选区域
- 可选择仅导出元数据，或元数据加裁剪图
- 保存原始图像生成 prompt，用于编目和 AI 命名上下文
- 支持手动修正：框创建、拖拽、调整大小、排序和命名
- AI 描述生成为可选功能，且支持可插拔的 AI 提供商

## 技术栈

- `Tauri 2`
- `React + TypeScript + Vite`
- `Python + Pillow + NumPy`

## v1 功能范围

- 通过桌面应用导入 PNG
- 基于透明度阈值的精灵区域检测
- 按行或列优先排序
- 可视化编辑精灵边界框
- 撤销和重做历史
- JSON 和 CSV 导出
- 可选的裁剪 PNG 导出
- 可选的标准化画布导出
- OpenAI 兼容的视觉端点集成，用于生成描述

## 项目结构

```text
src/                 React UI 和编辑器逻辑
src-tauri/           Tauri 壳层和命令桥接
python/              Python 图像分析、导出和 AI 核心
python_tests/        Python 单元测试
```

## 环境要求

- Node.js 20+
- Rust 工具链（用于 Tauri 构建）
- Python 3.10+

应用按以下顺序查找 Python：

1. `SPRITESPLIT_PYTHON` 环境变量
2. `./.venv/Scripts/python.exe`
3. `./.venv/bin/python`
4. Codex 捆绑运行时路径（如果存在）
5. `python3.13`, `python3.12`, `python3.11`, `python3.10`, `python3`, `python`
6. `py -3`

如果机器上没有 Python，请在启动 `tauri dev` 前显式设置 `SPRITESPLIT_PYTHON`。

## 开发

安装前端依赖：

```bash
npm install
```

运行桌面应用：

```bash
npm run tauri:dev
```

仅构建前端：

```bash
npm run build
```

前端代码检查：

```bash
npm run lint
```

运行 Python 测试：

```bash
npm run test:python
```

## AI 提供商说明

首个版本针对 OpenAI 兼容的 chat-completions 视觉端点。你需要提供：

- 基础 URL
- API 密钥
- 模型名称
- 图集 prompt
- 精灵图 prompt

描述通过源图像哈希、边界框、prompt 和模型设置进行缓存，以减少重复调用。

## 导出内容

导出可包含：

- `spritesplit-project.json`
- `spritesplit-sprites.csv`
- `crops/*.png`

每个精灵图记录包含：

- `id`
- `index`
- `bbox`
- `center`
- `area`
- `name`
- `description`
- `aiDescription`
- `tags`
- `group`
- `cropPath`

## 许可证

MIT。详见 [LICENSE](./LICENSE)。
