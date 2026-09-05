# Algo Sync Workspace

Algo Sync 是一个只在指定 VS Code 工作空间中启用的本地刷题工具。它连接浏览器（edge）中的在线评测 IDE 与本地 VS Code，让题面、代码、语言切换、提交和评测结果可以通过同一套工作流完成。
这个库主要为懒人打造，懒得复制粘贴写完的代码。使用这个需要一定的命令行基础，也算是给终端人的福利吧。

## 这个工作空间能做什么

### 自动建立本地题目目录

浏览器进入受支持网站的题目 IDE 后，工具会读取题号、题名、题面、当前语言和编辑器代码，并创建对应目录：

```text
luogu/
└─ P1002-过河卒/
   ├─ P1002-过河卒.cpp
   └─ 题目.md
```

左侧编辑组只保留当前题目的 `题目.md` 和题面预览，代码文件显示在右侧。切换语言时，同一道题的 `.cpp`、`.py`、`.java` 等文件共用一个题目目录。

### 在本地与网页之间同步代码

- 在 VS Code 保存当前代码文件时，代码会写入浏览器当前连接的同一道题、同一种语言的编辑器。
- 普通保存只同步代码，不会提交。
- 已存在的本地代码文件不会因为重新打开题目而被自动覆盖。
- `题目.md` 的自动生成区域会更新；生成标记之外的个人内容会保留。

### 使用终端管理刷题流程

- `acm fetch <题号>`：在专用浏览器标签页中打开题目并进入可编辑页面。
- `acm remote`：查看浏览器扩展当前识别到的远端题目，并确认哪一道题处于活动状态。
- `acm switch <语言>`：同时切换网页语言和本地代码文件。
- `acm refresh`：把当前语言的网页代码和本地文件恢复为初始模板。
- `acm push`：提交本地当前代码，并在终端等待评测结果。
- `edge refresh` / `chrome refresh`：刷新对应浏览器的当前页面。
- `acm clean <站点>`：清理一个完整的算法网站目录。

### 支持的网站和语言

| 网站 | 支持的页面 |
| --- | --- |
| 洛谷 | `www.luogu.com.cn/problem/*` |
| 牛客 ACM | `ac.nowcoder.com/acm/problem/*` |
| 力扣 | `leetcode.cn/problems/*` |
自动同步支持 C++、C、Python、Java、JavaScript、Go 和 Rust。终端语言切换命令支持 `python`、`python3`、`java`、`cpp`、`c++` 和 `c`。

## 使用前需要安装什么

以下命令以 Windows PowerShell 为例。

### 1. 安装基础软件

需要：

- Node.js 20 或更新版本；
- VS Code 1.100 或更新版本；
- Edge；
- Git（只有需要克隆或维护仓库时才必需）。

可以使用 Windows Package Manager 安装：

```powershell
winget install --exact --id OpenJS.NodeJS.LTS
winget install --exact --id Microsoft.VisualStudioCode
winget install --exact --id Git.Git
```

Windows 10/11 通常已经包含 Edge。如果需要 Chrome：

```powershell
winget install --exact --id Google.Chrome
```

安装完成后重新打开终端并检查：

```powershell
node --version
npm.cmd --version
code.cmd --version
```

`node --version` 应为 `v20` 或更高版本。

### 2. 安装项目依赖并构建

进入本仓库根目录：

```powershell
Set-Location C:\Users\lenovo\Desktop\acm
npm.cmd install
npm.cmd run build
npm.cmd run package:vscode
npm.cmd run install:cli
```

这些命令会：

1. 下载项目依赖；
2. 构建浏览器扩展、命令行工具和 VS Code 扩展；
3. 在 `dist/algo-sync-vscode.vsix` 生成 VS Code 安装包；
4. 安装 `acm`、`edge` 和 `chrome` 命令行启动器。

在 macOS 或 Linux 中使用 `npm` 代替 `npm.cmd`。

### 3. 安装 VS Code 扩展

先安装 Markdown Preview Enhanced，再安装本项目生成的 VSIX：

```powershell
code.cmd --install-extension shd101wyy.markdown-preview-enhanced
code.cmd --install-extension .\dist\algo-sync-vscode.vsix --force
```

也可以在 VS Code 中执行 `Extensions: Install from VSIX...`，然后选择 `dist/algo-sync-vscode.vsix`。

安装或更新 VSIX 后，执行 `Developer: Reload Window`。

### 4. 加载浏览器扩展

1. Edge 打开 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展”。
4. 选择本仓库的 `packages/browser-extension/dist` 目录。

浏览器扩展代码更新后，必须在扩展管理页点击“重新加载”，并刷新已经打开的题目页面；只重新构建文件不会更新浏览器里正在运行的旧扩展。

### 5. 验证安装

```powershell
acm --version
```

当前版本应输出：

```text
1.0.4
```

## 第一次连接

### 1. 打开正确的 VS Code 工作空间

在仓库根目录运行：

```powershell
code.cmd .\acm.code-workspace
```

也可以直接用 VS Code 打开包含 `.algo-sync.json` 的仓库根目录。只有这个工作空间打开并启用时，浏览器扩展才会同步代码。

### 2. 确认两端已经连接

- VS Code 状态栏显示 `Algo Sync`；
- 浏览器扩展徽标显示 `ON`；
- 浏览器已经打开受支持网站的真实 IDE/代码编辑页面。

只打开题面但没有进入代码编辑模式时，扩展可能不会创建本地文件。洛谷使用 `acm fetch` 时会直接进入 `#ide` 模式。

### 3. 检查远端题目

```powershell
acm remote
```

输出中的 `*` 表示当前活动的远端题目，例如：

```text
Edge 远程题目（2）：
* luogu/P1002/cpp · 过河卒
  https://www.luogu.com.cn/problem/P1002
- leetcode/34/python · 在排序数组中查找元素的第一个和最后一个位置
  https://leetcode.cn/problems/find-first-and-last-position-of-element-in-sorted-array/
```

执行 `acm push`、`acm refresh` 或 `acm switch` 前，必须确认带 `*` 的记录符合以下四项：

1. 网站正确；
2. 题号正确；
3. 语言正确；
4. URL 确实是准备操作的题目。

如果活动题目不正确，不要继续提交或恢复。先运行 `acm fetch <题号>`，等待页面加载，再次运行 `acm remote` 确认。

## 使用说明

所有命令都应在本工作空间根目录、对应站点目录或当前题目目录中运行。不要在另一个同名仓库或无 `.algo-sync.json` 的目录中运行。

### 打开题目：`acm fetch`

```powershell
acm fetch P1001
acm fetch NC233601
acm fetch LC1
```

支持的题号格式：

- 洛谷：`P`、`B`、`U`、`T`、`CF`、`AT_`、`SP`、`UVA` 开头的规定格式；
- 牛客：仅 `NC+数字`；
- 力扣：仅 `LC+数字`。

`fetch` 使用一个带内部标记的专用浏览器标签页：

- 第一次调用会创建标签页；
- 后续调用复用同一个标签页并切换网址；
- 浏览器没有运行时会尝试启动上次连接的 Edge/Chrome；
- 正常情况下不会把浏览器窗口移动到桌面最前方；
- 页面加载完成后会自动生成题面和默认 C++ 文件。

打开后必须确认：

```powershell
acm remote
```

### 编辑和保存

在右侧代码文件中编辑，正常保存即可同步到网页编辑器。同步要求以下内容全部一致：

- 最近激活的浏览器 IDE 标签页；
- 网站和题号；
- 网页当前语言；
- VS Code 当前代码文件。

如果其中任意一项不一致，工具会拒绝写入，避免把代码覆盖到别的题目。使用“全部保存”也不会把其他题目的文件写入当前网页。

### 查看远端连接：`acm remote`

```powershell
acm remote
```

建议在以下操作前都运行一次：

- 提交前；
- 恢复模板前；
- 切换语言前；
- 同时打开多个题目或多个浏览器时；
- 刚执行 `fetch`、浏览器刷新或扩展重新加载后。

不要只根据 VS Code 当前打开的文件判断远端题目；真正的操作目标以 `acm remote` 中带 `*` 的记录为准。

### 切换语言：`acm switch`

```powershell
acm switch python
acm switch python3
acm switch java
acm switch cpp
acm switch c++
acm switch c
```

命令会切换活动题目的网页语言，并创建或打开相应的本地文件。`python` 和 `python3` 都选择 Python 3；`c++` 等价于 `cpp`。

切换完成后建议再次检查：

```powershell
acm remote
```

如果网站不支持该语言、菜单没有加载完成或远端题目不正确，命令会返回错误，不应继续提交。

### 恢复初始模板：`acm refresh`

```powershell
acm remote
acm refresh
```

`refresh` 会同时替换：

- 浏览器当前题目、当前语言的代码；
- 对应的本地代码文件。

> 这是覆盖操作。运行前必须核对 `acm remote`，并自行备份仍需保留的代码。

工具只使用首次创建文件时保存的可信初始模板，不会把上次提交代码猜成模板。旧文件没有可信模板快照时，命令会报错并拒绝覆盖。

洛谷标签页如果已经退出 IDE 模式，命令会先确认题号一致，再让原标签页返回 `#ide`，等待编辑器重新连接后执行恢复；不会为此新建标签页或把浏览器窗口置顶。

### 提交并等待评测：`acm push`

推荐流程：

```powershell
acm remote
acm push
```

确认带 `*` 的网站、题号和语言全部正确后再执行 `push`。CLI 会再次校验终端目录、本地文件和远端题目是否匹配，然后：

1. 读取 VS Code 中当前代码，包括尚未落盘但仍在编辑器中的内容；
2. 写入网页编辑器；
3. 点击网站提交按钮；
4. 等待并显示 Accepted、Wrong Answer、TLE、MLE、RE、CE 等结果；
5. 在支持的网站上显示测试点状态、耗时和内存。

评测通过时退出码为 `0`；未通过、连接失败或等待超时时退出码为 `1`。

提交期间不要关闭题目标签页。如果网站确实要求验证码，终端会显示黄色提示，并可能激活浏览器供用户完成验证。工具不会绕过登录、验证码或网站提交限制。

### 刷新浏览器页面

```powershell
edge refresh
chrome refresh
```

命令只刷新对应浏览器当前连接的页面，不应改变浏览器窗口在桌面上的前后顺序。浏览器必须已经加载 Algo Sync 扩展并连接到当前工作空间。

刷新后运行 `acm remote`，确认扩展重新识别了正确题目。

### 清理站点目录：`acm clean`

```powershell
acm clean luogu
acm clean nowcoder
acm clean leetcode
acm clean ybt
acm clean "*"
```

> `clean` 会立即永久删除配置中对应的整个站点目录及其题目文件。执行前请确认已提交到 Git 或已经备份。

只允许传入完整站点名或 `*`。以下内部路径会被拒绝：

```powershell
acm clean luogu/P1001
```

在 Bash 中必须给 `*` 加引号，避免被 shell 展开。工作空间中的其他文件不会被删除。

## 重要注意事项

1. **操作目标以 `acm remote` 为准。** VS Code 当前显示的文件不一定等于浏览器当前活动题目。
2. **保存不等于提交。** 只有明确运行 `acm push` 才会点击提交按钮。
3. **`refresh` 会覆盖代码。** 它会同时修改网页和本地文件。
4. **`clean` 会永久删除整个站点目录。** 命令没有逐题清理功能。
5. **不要同时启用多个 Algo Sync 工作空间。** 默认只应有一个工作空间监听端口。
6. **浏览器扩展更新后要重新加载。** 重新构建但不在扩展管理页点击“重新加载”时，浏览器仍运行旧代码。
7. **VS Code 扩展更新后要重装 VSIX 并重新加载窗口。**
8. **切换题目或语言后等待页面加载完成。** 随后使用 `acm remote` 再次确认。
9.  **关闭工作空间后同步会休眠。** 浏览器扩展不会继续读取、创建或覆盖本地文件。

## 文件和配置

默认 `.algo-sync.json`：

```json
{
  "enabled": true,
  "port": 27121,
  "solutionRoot": ".",
  "defaultLanguage": "cpp",
  "statementPreview": true,
  "siteDirectories": {
    "luogu": "luogu",
    "nowcoder": "nowcoder",
    "leetcode": "leetcode",
    "ybt": "ybt"
  }
}
```

- `enabled`：是否启用当前工作空间。
- `port`：本地连接端口，只允许 `27121` 至 `27130`。
- `solutionRoot`：题目目录根路径，必须是工作空间内的相对路径。
- `defaultLanguage`：首次打开题目时使用的默认语言。
- `statementPreview`：是否自动打开题面预览。
- `siteDirectories`：各网站对应的本地目录。

绝对路径、包含 `..` 的路径和工作空间外路径会退回安全默认值。目录名和文件名中的 Windows 非法字符会替换为 `-`。

## 状态与故障排查

### 浏览器扩展徽标

- `ON`：已经连接当前 VS Code 工作空间；
- `--`：没有连接，通常是工作空间未打开、VS Code 扩展未启动或端口不一致；
- `!`：发生协议或同步错误。



### 页面打开但本地文件没有生成

- 等待题目和编辑器加载完成；
- 确认浏览器扩展徽标为 `ON`；
- 运行 `edge refresh`；
- 再运行 `acm remote`；
- 洛谷确认 URL 已进入 `#ide`，牛客和力扣确认代码编辑器已经显示。

## 不足
- 该项目仍有一些bug由于一些原因无法修复，比如对于牛客网上特殊符号的识别仍然可能不准确，导致本地md文件出现看不懂的情况。
- 如发现其他问题或有建议请联系`guichen2830532983@gmail.com`。
