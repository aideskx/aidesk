# 同包文件锁工件

此目录只承载 `goal-file-lock.mjs` 的原生系统锁，不保存请求或用户数据。Node-API v8 封装由调用它的同一 Node 进程持有；进程退出时由操作系统释放。它不启动常驻进程，不下载或编译代码，不按时间或 PID 删除锁。

当前源码候选包含 `darwin-arm64`、`darwin-x64`、`win32-x64`。工件与包内 C 源的 SHA-256 由同目录 `artifact.json` 固定，构建和实际受测运行时见 `provenance.json`。本机编译先固定 C 字节，再生成二进制；开发命令为 `node tooling/build-goal-file-lock.mjs --out .cache/goal-file-lock-prototype/<新候选>`，只能在源码仓库显式执行，Plugin 调用不会运行此命令。新增 x64 工件来自准确私有 CI 候选，构建与逐项核验归[构建说明](../../../../../tooling/goal-file-lock-build.md)；源码集成没有改变已安装的 `0.3.2+codex.20260921074540`。

| 范围 | 当前证据 |
| --- | --- |
| Mac arm64，Node 24.20.0 | 同一工件 12 项真实进程测试通过 |
| Mac arm64，Node 20.20.2 | 同一工件 12 项真实进程测试通过 |
| Windows x64、Mac x64，Node 20.20.2／24.20.0 | 私有 CI 35583868049 的准确 binary，在每个 runtime 各通过12项锁及31项同包Hook；已核同次两证据包并纳入源码包 |
| 普通 Codex 宿主加载、断电恢复 | 尚未由这些测试证明 |

内核锁覆盖同进程竞争、双进程竞争、首次并发创建、暂停不抢占、强杀和异常释放。稳定 `.lock` 文件保留；遗留目录、不明文件及原请求不自动删除。缺工件或校验失败时不使用无锁后备路径，也不把本机失败解释为业务取消。

当前 `goal-plugin-request.mjs` 的 `withGoalStore` 已通过同包默认 loader 持有账号目录的系统锁，覆盖原件、调用关联、首次回执和网络读取摘要的读写。实际观察的恢复根保持原值；只在检查过的账号目录上解析系统路径别名（如 Mac 的 `/var`），再打开稳定锁文件。纯机械 `prepare` 和无关工具不加载或获取本机恢复锁。

2026-09-21 的 Mac arm64 Node 24.20.0 与 Node 20.20.2 各通过同一组 31 项 Hook 测试（`goal-plugin-file-lock` 3、`goal-plugin-hook` 14、`goal-plugin-manifest` 2、`goal-task-hook` 5、`goal-network-hook` 7，均位于 `tooling/plugin-regression/*.node.mjs`）。新增反例在真实同包 Hook 子进程持锁、已保存首次回执且尚未移动归档目录时暂停并强杀，然后以原操作号对账，核原请求和首次回执字节保持不变。任务恢复不再授权创建；网络原号只恢复受理元数据。测试子进程有独立等待截止与清理；仍未证明真实宿主或断电结果。初次接线的 Mac 系统路径别名拒绝已在上述目录解析处修复并复测。

这关闭了当前 Mac 本地新锁被强杀后持续 `BUSY` 的缺口。曾由目录锁产生的未知 `.lock` 目录仍拒绝并保全，需要单独确认归属及停止所有者后处理；本轮不自动删除或接管。缺平台工件、锁占用或锁校验失败会说明本机恢复暂不可用，保留未知业务原号，原生 Codex 工作可继续。

Windows 工件依赖 Node 导出的 `uv_get_osfhandle` 及标准 Windows／MSVC 运行库；准确导入项列在其 `provenance.json`。CI 运行器通过不能证明普通宿主 DLL 可用性，尚不能据此宣布 Windows Plugin 端到端可用，也不增加用户手动安装运行库的产品要求。

Windows 首次 Hook CI 暴露请求目录 fsync 的 `EPERM`，现仅在 Windows 跳过 Node 不支持的目录同步；普通文件同步、原件校验和锁保持，普通文件 fsync 失败反例仍拒绝。修复后的同次 CI 中，Windows binary 为 `2a29cbc8d3fdd58af77ae1d9a782aa344af1d8562e9229efe9d594e414aa933d`；它与上次同C源码的binary摘要不同，因此本包采用本次确经31项Hook验证的准确工件，不能把源码相同当作二进制相同。Mac x64 binary 摘要保持，来源补入本次Hook证据。两个平台的旧来源在版本历史和当前provenance的previousPackagedArtifact保留；本次未更新已安装Plugin。

当前所有者为目标业务 Plugin 维护者，总控集成。进入条件是准确平台工件、摘要和相应运行时验证齐备；三种平台工件均已进入源码候选，普通宿主和实际安装仍须按准确候选验证。首个公开候选前或 2026-09-28（先到为准）复审平台覆盖与恢复；安装和发布状态另以本轮验收记录为准。
