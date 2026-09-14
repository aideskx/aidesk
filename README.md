# AI书桌 Plugin 技术预发布

这是 AI书桌 Plugin 的 PUBLIC Git-backed 技术预发布分发仓，不是 AI书桌私有源码仓，也不是 OpenAI 公共 Plugin Directory。

当前发布 `aidesk-runtime` `0.3.0+codex.20260913211526`，包含同一 Plugin 的入口 Skill 和 MCP 连接声明，MCP 目标为 `https://aideskx.com/mcp`。真实宿主中的入口、认证启动和受限账号状态读取已在本机开发范围验证；教学功能、真实儿童数据和跨设备兼容不属于本次发布承诺。

普通用户可以直接向 Codex 发送下面这句话：

> 请使用 Codex 的插件安装功能，从 GitHub 仓库 `aideskx/aidesk` 安装并启用 AI书桌插件，仅限这个仓库。

这句话保留了唯一的 GitHub 仓库坐标，没有放入网址；即使当前对话没有项目上下文，也能把安装目标限定到本仓库。安装完成后，再新建任务并发送“打开AI书桌”。这条口令已在低版本模型、无项目上下文和无既有安装的干净环境中实际验证。

Codex 会在宿主支持的范围内使用 marketplace add 和 plugin add 等管理步骤完成安装；这句话不是对所有宿主界面或安装链路一致性的承诺。

本次技术预发布对应工件版本 `0.3.0+codex.20260913211526`。上一可用 `0.1.1` 与 `0.1.0` 标签仍保留为历史回退锚点；本仓不承诺 Windows、MacBook、自动更新、静默更新、失败恢复或完整产品能力已经在所有环境成立。

本次工件 `packageDigest` 为 `4723d7b4c2a13c89b9564f399fa375f898dbcdc876384fa4e7697865a44a0ede`。`SHA256SUMS` 保存三项公开工件的文件摘要；摘要用于项目审计，不代表 Codex 宿主会自动验证它。
