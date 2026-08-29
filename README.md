# Algo Sync Workspace

一个只在指定 VS Code 工作空间中启用的刷题代码同步工具。进入受支持网站的代码编辑器后，它会创建或打开本地题目文件；在 VS Code 保存当前文件时，再把代码写回当前浏览器题目。

## 支持范围

- 洛谷：`www.luogu.com.cn/problem/*`
- 牛客 ACM：`ac.nowcoder.com/acm/problem/*`
- 牛客练习题：`www.nowcoder.com/practice/*`
- 力扣中国站：`leetcode.cn/problems/*`
- 信息学奥赛一本通：`ybt.ssoier.cn` 的题目与提交页面
- 语言：C++、C、Python、Java、JavaScript、Go、Rust

`biteketang.com` 是课程分享页面，不属于在线评测 IDE，因此不会注入扩展。

## 首次安装

需要 Node.js 20 或更新版本，以及 VS Code 1.100 或更新版本。

在仓库根目录运行：

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run package:vscode
```

随后安装两端扩展：

1. 在 VS Code 中执行 `Extensions: Install from VSIX...`，选择 `dist/algo-sync-vscode.vsix`。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，选择“加载已解压的扩展”，指向 `packages/browser-extension/dist`。
4. Chrome 和 Edge 可以加载同一个目录；固定的 manifest 公钥会使扩展 ID 保持一致。

所有命令和配置均使用仓库相对路径。克隆到其他目录后重新运行上述命令即可。

## 使用方法

1. 使用 VS Code 打开 `acm.code-workspace`，或直接打开包含 `.algo-sync.json` 的仓库根目录。
2. 浏览器扩展徽标显示 `ON`，VS Code 状态栏显示 `Algo Sync`，表示两端已连接。
3. 在受支持网站进入真正包含代码编辑器的 IDE/提交页面。只浏览题面不会创建文件。
4. 第一次进入某题时，网页语言会切换为配置的默认语言 `cpp`，并以网页编辑器当前代码创建文件，例如 `luogu/P1002-过河卒.cpp`。
5. 如果同一题同一语言的文件已存在，只会打开它；本地和网页内容都不会被自动覆盖。
6. 在网页中手动切换到其他受支持语言后，会创建或打开同题的对应文件。
7. 在 VS Code 保存文件时，只有“最近激活的浏览器 IDE 标签页 + 同一题目 + 同一语言”完全匹配的文件才会同步。使用“全部保存”不会更新其他题目。

关闭该工作空间后，浏览器扩展会进入休眠状态：不会创建文件、读取代码或自动切换网页语言。

## 文件和配置

`.algo-sync.json` 的默认内容：

```json
{
  "enabled": true,
  "port": 27121,
  "solutionRoot": ".",
  "defaultLanguage": "cpp",
  "siteDirectories": {
    "luogu": "luogu",
    "nowcoder": "nowcoder",
    "leetcode": "leetcode",
    "ybt": "ybt"
  }
}
```

- `solutionRoot` 和各站点目录必须是工作区内的相对路径；绝对路径和 `..` 会退回安全默认值。
- 端口允许设置为 `27121` 至 `27130`。浏览器扩展会在这个范围内发现唯一活动工作空间。
- 文件名中的 Windows 非法字符会替换为 `-`。查找已有文件时以站点、题号和扩展名为准，因此题名变化不会重复创建。

## 状态与排错

- 浏览器徽标 `--`：没有打开启用同步的工作空间，或 VS Code 扩展尚未安装。
- 浏览器徽标 `ON`：已连接。
- 浏览器徽标 `!`：协议或同步错误，可点击 VS Code 状态栏或运行 `Algo Sync: Show Status` 查看原因。
- 若端口已被另一个工作空间占用，VS Code 会明确报错；首版只允许一个活动同步工作空间。
- 网站升级可能改变编辑器 DOM。适配器找不到编辑器时不会创建或覆盖文件，可在仓库提交对应站点和题目 URL 的 issue。
- 扩展只更新编辑器内容，不会自动运行、提交、抓取题面或测试数据。

## 安全与隐私

- VS Code 服务仅监听 `127.0.0.1`，不接受局域网或公网连接。
- 服务只接受固定浏览器扩展 ID 的 Origin，并校验协议版本、站点、语言、URL 和消息长度。
- 浏览器扩展只申请上述四类评测站权限，没有 `<all_urls>` 权限。
- 代码仅在本机浏览器与 VS Code 之间传输，没有云端服务。

## 开发与验证

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
npm.cmd run package:vscode
```

修改浏览器端后，在 Chrome/Edge 扩展管理页点击“重新加载”。修改 VS Code 端后，重新生成并安装 VSIX。
