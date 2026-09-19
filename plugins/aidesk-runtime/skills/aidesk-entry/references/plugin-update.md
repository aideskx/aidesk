# 官方更新执行与结果处理

本参考只在入口判定需要更新或允许本地补查后读取。下列原文中的“本 Skill 路径”仍指 `aidesk-entry/SKILL.md` 所在目录；`../../scripts/update.mjs` 相对此目录解析，不相对此参考文件解析。仅当下列原结果分支允许继续、且用户本次不是只检查时，才回到入口规定的账号与上下文步骤；失败、需要刷新连接或 required 停止等情况继续按对应原分支处理。

### 执行一次官方更新

更新程序为本 Skill 所属已安装包的 `../../scripts/update.mjs`，按实际 Skill 路径解析绝对路径，不从其他来源下载脚本。它只读取官方公开发布信息、调用官方 Codex Plugin CLI，并校验磁盘文件；不处理账号、OAuth、学习者或教学数据。

1. 本轮只读补查程序已经返回 `host.nodePath`、`host.codexPath` 时，直接复用这两个已验证路径，不重复发现。否则使用宿主提供的 `load_workspace_dependencies` 取得已有 Node 路径。没有该工具时，可发现并验证现有 Node（至少 20），不自动安装运行时。
2. 尚无本轮已验证 CLI 时，找到并用 `--version`、`plugin --help` 验证当前宿主的 Codex CLI。优先宿主已明确给出的可执行路径；PATH 结果只是候选。本机已实测 macOS 的 `/Applications/ChatGPT.app/Contents/Resources/codex`，其他平台应使用实际查到并核实的路径，不猜 WindowsApps 版本目录，不把另一套 CLI 当成当前宿主。
3. 使用宿主正常命令工具，以参数数组或正确的 shell 引号运行：`<Node绝对路径> <已安装包内update.mjs绝对路径> --codex <已核实CLI绝对路径> --apply`。只检查或暂不更新改用 `--check`。只启动一次，等待该次命令结束；它可能需要两分钟，期间可简短报告正在安装。不得并发启动、卸载旧插件、手改配置或重复添加 marketplace。
4. 程序只更新 `aidesk-runtime@aidesk`，固定来源 `aideskx/aidesk`，拒绝来源冲突、禁用、固定到其他 ref 或会影响其他已安装插件的情况。它内置有限重试、安装后读回、摘要核验，以及条件满足时一次缓存修复；不要再在外层循环重装。

### 按真实结果继续

- `current`：磁盘版本与官方摘要一致；仍以本次 MCP 的 `installedVersion` 判断当前连接是否已加载。`ahead`：保留较新的本机版本。
- `installed_pending_activation`：新版文件已安装并核验，再调用一次 `aidesk_check_plugin_update`。仅当实际返回的 `installedVersion` 与安装结果一致，才说“已更新并生效”。否则说明“新版已安装，当前连接尚未刷新”，先让用户新建对话打开；仍旧时再重启 Codex。不自行重启用户应用，也不虚构已刷新。
- `update_available`：本次为只检查，报告可用版本，不安装。
- `failed_unchanged`：仅表示已核实旧包仍完整。说明更新未完成；若 `required=false` 可继续本次已有 MCP 使用，`required=true` 则停止依赖旧版本的操作，不能说更新成功。
- `installed_unverified`、`installation_unknown`：安装结果尚未可靠核实，停止依赖该更新的操作，不声称旧版完好或新版已生效，不反复安装。
- `check_unavailable`、`host_unavailable`、`blocked`、`busy` 或工具不可用：简短说明具体停点，不把网络失败说成最新版。若服务没有明确判定必须更新，可继续已可调用的账号流程；没有 MCP 则如实说明尚未打开。

没有可靠 CLI、Node 或宿主不允许执行时，明确自动安装未完成，保留人工恢复指令“从GitHub安装Codex插件 aideskx/aidesk”。不可把给出这句话算作完成自动更新。任何更新状态都不能代替身份或权限检查。
