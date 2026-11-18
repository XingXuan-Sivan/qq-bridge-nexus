# 如何发布到你自己的 GitHub 仓库与 Release

> 本仓库**不会**自动推送到任何地方。以下步骤由你（仓库所有者）手动执行。示例仓库名 `XingXuan-Sivan/qq-bridge-nexus`。

## 1. 发布前检查（在仓库根目录）

```powershell
npm ci
npm run test:audit                 # Windows 上应全部通过（132/132）；macOS / Linux 上 test-console-encoding.mjs 是 Windows 专用，会跳过
npm run test:console-ui            # 控制台离线回归（56/56）
node scripts/test-console-static.mjs
npm run verify:repo                # 105 通过 / 0 失败
npm run verify:artifacts           # 产物与仓库里的 patch 一致
npm run privacy-scan               # 上游的隐私扫描：不应出现真实 QQ 号、本机路径、令牌
git status --short                 # 确认没有 config.json / state/ / node_modules / audio/ 被跟踪
```

> 门禁只扫**已入库与待提交的文件**，扫不进 git 历史。发布前另把工作区里不打算发布的
> 本地素材（人格/提示词副本、截图、日志、`*.bak`）删掉或确认已在 `.gitignore` 里 —— 一旦推上去就只能靠改写历史才提得干净。

`privacy-scan` 支持本机专用规则文件 `scripts/privacy-rules.json`（不入库，参照 `scripts/privacy-rules.example.json`），
建议把你自己的 QQ 号、群号、用户名、盘符路径写进去再跑一次。

## 2. 推送源码

分支约定：功能在 `feat/*` 上做，验完先 `--ff-only` 合进 `dev`（集成分支，不发布），再从 `dev` 合进 `main`。
`main` 与 `dev` 同点后才打标签 —— 这样 Release 的 Source zip 与仓库当前树一致。

```powershell
git remote add origin https://github.com/XingXuan-Sivan/qq-bridge-nexus.git   # 已经设置过 origin 就跳过这一行
git push -u origin main
```

标签不带 `v` 前缀（历史标签是 `0.1.0` / `0.1.1` / `0.2.0` / `0.2.1`），打附注标签并推送：

```powershell
# 先确认 docs/release/RELEASE_NOTES_v<版本>.md 已提交
git tag -a 0.3.0 -m "qq-bridge-nexus 0.3.0"
git push origin main dev 0.3.0
```

> 不要向上游 `Derpyu520/qq-bridge` 推送；如需回馈上游，请在你的仓库里另开分支，通过 Pull Request 提交。

## 3. 生成 Release ZIP

```powershell
npm run release:zip
```

产物在**仓库外、与仓库同级**的 `release/` 文件夹（`<仓库>/../release/`，没有会自动创建；历次版本的包都放在这里，不占仓库目录）：
`qq-bridge-nexus-v<版本>.zip` 与 `qq-bridge-nexus-v<版本>.zip.sha256`。要放到别处：`node scripts/build-release.mjs --out <目录>`。
还没 `git add` 的新文件也要打进去时加 `--include-untracked`。
脚本只打包 `git ls-files` 列出的已跟踪文件（因此天然排除 `.gitignore` 里的 `config.json`、`state/`、`node_modules/` 等），
并在打包前做一次敏感文件检查（发现 `config.json`、`state/`、`*.log`、TOTP 秘密等会直接失败）。
不在 git 仓库里运行时，脚本退回到内置的排除清单。

## 4. 创建 GitHub Release

网页：仓库 → Releases → Draft a new release → 选择标签 `<版本>`（例如 `0.3.0`，不带 `v`）→ 标题 `<版本> - <主题>`（例如 `0.3.0 - 平台分离 / 控制台重排`）→
正文粘贴 `docs/release/RELEASE_NOTES_v<版本>.md` 的内容 → 上传 `../release/` 下这个版本的两个文件 → Publish。

或用 GitHub CLI：

```powershell
gh release create 0.3.0 ../release/qq-bridge-nexus-v0.3.0.zip ../release/qq-bridge-nexus-v0.3.0.zip.sha256 `
  --repo XingXuan-Sivan/qq-bridge-nexus --title "0.3.0 - 平台分离 / 控制台重排" --notes-file docs/release/RELEASE_NOTES_v0.3.0.md
```

**不要**把 SnowLuma 的安装包、`node_modules`、你的 `config.json` 或 `state/` 作为 Release 附件上传。

## 5. 发布后

部署时把仓库地址 https://github.com/XingXuan-Sivan/qq-bridge-nexus 和 `docs/DSH_DEPLOYMENT.md` 交给 DSH agent 即可。
