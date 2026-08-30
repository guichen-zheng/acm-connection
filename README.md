# Algo Sync Workspace

一个只在指定 VS Code 工作空间中启用的刷题代码同步工具。进入受支持网站的代码编辑器后，它会为每道题建立独立目录，把题面保存为 Markdown，并创建或打开当前语言的代码文件；保存当前代码文件时，再把代码写回当前浏览器题目。

## 支持范围

- 洛谷：`www.luogu.com.cn/problem/*`
- 牛客 ACM：`ac.nowcoder.com/acm/problem/*`
- 牛客练习题：`www.nowcoder.com/practice/*`
- 力扣中国站：`leetcode.cn/problems/*`
- 信息学奥赛一本通：`ybt.ssoier.cn` 的题目与提交页面
- 语言：C++、C、Python、Java、JavaScript、Go、Rust

`biteketang.com` 是课程分享页面，不属于在线评测 IDE，因此不会注入扩展。

## 首次安装

需要 Node.js 20 或更新版本，以及 VS Code 1.100 或更新版本。VSIX 声明了 `shd101wyy.markdown-preview-enhanced` 为扩展依赖；联网安装时 VS Code 会自动补齐该依赖。

在仓库根目录运行：

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run package:vscode
npm.cmd run install:cli
```

随后安装两端扩展：

1. 在 VS Code 中执行 `Extensions: Install from VSIX...`，选择 `dist/algo-sync-vscode.vsix`。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，选择“加载已解压的扩展”，指向 `packages/browser-extension/dist`。
4. Chrome 和 Edge 可以加载同一个目录；固定的 manifest 公钥会使扩展 ID 保持一致。
5. 重新打开终端，运行 `acm --version`；输出 `0.4.0` 表示命令行工具安装完成。`acm` 由 npm 生成跨平台启动器，可在 PowerShell、CMD 和 Bash 中使用。

所有命令和配置均使用仓库相对路径。克隆到其他目录后重新运行上述命令即可。

## 使用方法

1. 使用 VS Code 打开 `acm.code-workspace`，或直接打开包含 `.algo-sync.json` 的仓库根目录。
2. 浏览器扩展徽标显示 `ON`，VS Code 状态栏显示 `Algo Sync`，表示两端已连接。
3. 在受支持网站进入真正包含代码编辑器的 IDE/提交页面。只浏览题面不会创建文件。
4. 第一次进入某题时，网页语言会切换为配置的默认语言 `cpp`，并建立题目目录、题面和代码，例如：

   ```text
   luogu/
   └─ P1002-过河卒/
      ├─ P1002-过河卒.cpp
      └─ 题目.md
   ```
5. 如果同一题同一语言的文件已存在，只会打开它；本地和网页内容都不会被自动覆盖。
6. 在网页中手动切换到其他受支持语言后，会在同一题目目录中创建或打开 `.py`、`.java` 等对应文件。
7. 在 VS Code 保存文件时，只有“最近激活的浏览器 IDE 标签页 + 同一题目 + 同一语言”完全匹配的文件才会同步。使用“全部保存”不会更新其他题目。
8. 扩展默认在左侧打开 `题目.md` 的 VS Code 原生 Markdown 预览，在右侧打开代码。关闭预览后可运行 `Algo Sync: Show Problem Statement` 重新打开。

### 命令行提交

保持 VS Code 工作空间和浏览器中的目标题目页面打开，在仓库根目录、站点目录或当前题目目录运行：

```text
acm push
```

CLI 会读取 VS Code 中当前题目代码（包括尚未落盘但仍在编辑器中的内容），再次校验终端目录、浏览器题目和语言完全匹配，然后把代码写入网页并点击提交。终端会依次显示“准备”“已提交”“评测”，最后显示 Accepted、Wrong Answer、编译错误等网站返回的结果。通过时退出码为 `0`，未通过、超时或连接错误时退出码为 `1`。

命令不会绕过登录、验证码或网站自身的提交限制。如果网页弹出验证码，需先在浏览器中处理后重新运行。评测期间不要关闭对应标签页；对于提交后跳转到记录页的网站，扩展会在新页面继续读取结果。

题面预览直接调用 Markdown Preview Enhanced，并使用 `github-light.css` 白色主题。如果它尚未安装，安装 Algo Sync 时 VS Code 会一并安装。

`题目.md` 中的 `algo-sync:generated` 标记区由扩展自动更新。扩展不再添加“个人笔记”标题；标记区外已有的任何内容仍不会被覆盖。已有且没有标记的 Markdown 文件也会完整保留，并在其前方添加独立的自动题面区。

关闭该工作空间后，浏览器扩展会进入休眠状态：不会创建文件、读取代码或自动切换网页语言。

## 文件和配置

`.algo-sync.json` 的默认内容：

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

- `solutionRoot` 和各站点目录必须是工作区内的相对路径；绝对路径和 `..` 会退回安全默认值。
- `statementPreview` 为 `true` 时自动打开 VS Code 原生 Markdown 预览；设为 `false` 后仍会生成和更新 `题目.md`，并可用命令手动预览。
- 端口允许设置为 `27121` 至 `27130`。浏览器扩展会在这个范围内发现唯一活动工作空间。
- 目录名和文件名中的 Windows 非法字符会替换为 `-`。查找已有目录时以站点和题号为准，因此题名变化不会重复创建；同一题的七种语言文件共用一个目录。

## 状态与排错

- 浏览器徽标 `--`：没有打开启用同步的工作空间，或 VS Code 扩展尚未安装。
- 浏览器徽标 `ON`：已连接。
- 浏览器徽标 `!`：协议或同步错误，可点击 VS Code 状态栏或运行 `Algo Sync: Show Status` 查看原因。
- 若端口已被另一个工作空间占用，VS Code 会明确报错；首版只允许一个活动同步工作空间。
- 网站升级可能改变编辑器 DOM。适配器找不到编辑器时不会创建或覆盖文件，可在仓库提交对应站点和题目 URL 的 issue。
- 普通保存只更新网页编辑器，不会提交；只有用户明确运行 `acm push` 才会点击提交。示例仅作为 `题目.md` 的一部分显示，不会写入测试文件。

## 安全与隐私

- VS Code 服务仅监听 `127.0.0.1`，不接受局域网或公网连接。
- 服务只接受固定浏览器扩展 ID 或本机 `acm` CLI 的专用 Origin，并校验协议版本、站点、语言、URL、活动文件和消息长度。
- 浏览器扩展只申请上述四类评测站权限，没有 `<all_urls>` 权限。
- 代码和转换后的当前题面仅在本机浏览器与 VS Code 之间传输，没有云端服务。
- HTML 题面转换为 Markdown 时会丢弃脚本、表单和嵌入页面，只保留安全的 HTTP(S) 链接和图片；预览由 VS Code 内置 Markdown 预览器提供。

## 开发与验证

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
npm.cmd run package:vscode
```

修改浏览器端后，在 Chrome/Edge 扩展管理页点击“重新加载”。修改 VS Code 端后，重新生成并安装 VSIX。
