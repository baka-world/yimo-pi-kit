# Troubleshooting / FAQ

Common issues when installing and using `yimo-pi-kit`, collected from real setups (including mixed Windows + WSL environments).

## 1. `pi` 命令输出 `3`，`pi install` 只输出 `3` 且不创建 `~/.pi/agent`

**原因**：npm 上的包名 `pi` 被一个圆周率数字玩具包占用（`pi@2.0.5`，功能是打印 π 的数字，所以 `pi` 输出 `3`）。真正 Pi 的包名是 **`@earendil-works/pi-coding-agent`**。

**确认**：

```bash
npm view pi          # 若显示 "Going deeper inside of the PI number." → 你装错了
which pi
pi --version         # 真 Pi 显示 0.84.0；假包输出 3
```

**修复**：

```bash
npm uninstall -g pi
npm install -g @earendil-works/pi-coding-agent@0.84.0
pi --version         # 现在应显示 0.84.0
```

## 2. `uvx is required for the code-review-graph MCP server`

**原因**：`setup-code-review` 会通过运行它的 `node` 进程的 `PATH` 查找 `uvx`。在 Windows + WSL 混合环境里，Windows 的 `node` 看不到 WSL 的 `~/.local/bin/uvx`，反之亦然。

**确认**：

```bash
which node
type -a uvx
echo $PATH           # 看 node 和 uvx 是否在同一侧（都在 Windows 或都在 WSL）
```

**修复**：让运行 CLI 的 `node` 与 `uvx` 属于同一套环境。

- Windows Pi → 给 Windows 装 uv：`winget install astral-sh.uv`
- WSL Pi → 给 WSL 装 uv：`curl -LsSf https://astral.sh/uv/install.sh | sh`
- 或把 `uvx` 所在目录显式加进 PATH 后再跑 setup

> 注意：**运行时**不依赖 PATH。setup 已把 `uvx`/`python`/`git`/`node` 的绝对路径写进 MCP 配置并固定到子进程环境，只有一次性 setup 需要它们能在 PATH 里找到。

## 3. Windows 与 WSL 混用（`CMD.EXE … UNC 路径不受支持` 警告）

**原因**：WSL 默认把 Windows 的 PATH 也合并进来（interop）。当在 WSL 终端里运行 `pi`/`node`/`npm`，可能实际命中 Windows 版本；Windows npm 被以 WSL 的 UNC 路径（`\\wsl.localhost\...`）作为工作目录启动时，CMD.EXE 就会打印这条警告。

**确认**：

```bash
type -a pi node npm uvx   # 看每个命令命中哪些路径
file "$(command -v pi)"   # 若是 PE32/Windows → Windows 版
echo $PATH                # 是否包含 /mnt/c/... 的 Windows 路径
```

**修复**（彻底隔离，二选一）：

- 方案 A：`/etc/wsl.conf` 关闭 PATH 合并，然后 `wsl --shutdown` 重启：

  ```ini
  [interop]
  enabled = true
  appendWindowsPath = false
  ```

- 方案 B：不重启 WSL，在 `~/.bashrc` 过滤 Windows 路径：

  ```bash
  export PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/c/' | paste -sd:)"
  ```

**重要规则**：启动 MCP 服务器的是 Pi，所以 setup 解析出的 `uvx`/`python`/`git`/`node` 必须与 Pi **同一个操作系统**。跨系统路径无法混用。

## 4. `Cannot find module '.../scripts/cli.mjs'`

**原因**：`node ./scripts/cli.mjs` 只在 Git 克隆目录里存在。用 npm/Git 安装的包，CLI 在 Pi 的 agent 目录下，不在你的当前目录。

**修复**（推荐按顺序）：

1. 在 Pi 里运行 `/kit graph`——它会把解析好的完整 setup 命令放进编辑器（已带 `!` 前缀，可直接回车执行）；
2. 或直接调用：
   ```bash
   node ~/.pi/agent/npm/node_modules/yimo-pi-kit/scripts/cli.mjs setup-code-review
   ```
3. 或使用包自带的 bin：
   ```bash
   ~/.pi/agent/npm/node_modules/.bin/yimo-pi-kit setup-code-review
   ```

Windows 下把 `~` 换成实际 agent 路径（如 `C:\Users\yimo\.pi\agent`）。

## 5. Node.js 版本过低（v20）

**原因**：Pi `0.84.0` 和本包都要求 **Node.js >= 22.19.0**。

**确认**：

```bash
node -v
```

**修复**：用 nvm 安装并切换到 22+：

```bash
nvm install 22
nvm use 22
```

## 6. 首次 `build-graph` 下载几百 MB

**原因**：第一次启动 code-review MCP 时，`uvx` 会解析并安装 pinned wheel 及其依赖（约 76 个 Python 包，含 Tree-sitter 语言包）。

**说明**：这是文档中已声明的一次性行为，之后走本地私有 uv 缓存（`$PI_CODING_AGENT_DIR/cache/yimo-pi-kit/code-review-graph/uv/`）。该缓存可能增长到数百 MB，属预期。只有首次解析需要访问 PyPI。

## 7. `/kit doctor` 显示 code-review 为 "optional; run setup-code-review"

**原因**：可选集成尚未启用，这是**正常状态**，不是故障。

**修复**：按 README 的 [Local code-review graph](code-review-graph.md) 章节，审查后运行 `setup-code-review`。自定义 MCP 定义会被原样保留，`--force` 才会覆盖。

## 8. 想让 kit 自动更新（不固定版本）

Pi 默认把带版本号的 npm 包（如 `npm:yimo-pi-kit@0.3.1`）当作**固定引用**，`pi update --extensions` 会跳过它；升级必须显式 `pi install npm:yimo-pi-kit@<新版本>`。

想要自动更新，去掉版本号改成浮动引用：

```bash
pi install npm:yimo-pi-kit      # settings 变为 "npm:yimo-pi-kit"，并立即装到最新版
pi update --extensions          # 之后自动拉最新版
```

**代价**：不再固定版本，未来任何新版本（含未经你审阅的）都会被自动安装。回到固定版本随时可以：

```bash
pi install npm:yimo-pi-kit@0.3.1
```
