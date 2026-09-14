# AI书桌 Plugin 技术预发布

这是 AI书桌 Plugin 的 PUBLIC Git-backed 技术预发布分发仓，不是 AI书桌私有源码仓，也不是 OpenAI 公共 Plugin Directory。

当前发布 `aidesk-runtime` `0.3.1+codex.20260914045055`，包含同一 Plugin 的入口 Skill 和 MCP 连接声明，MCP 目标为 `https://aideskx.com/mcp`。真实宿主中的入口、认证启动和受限账号状态读取已在本机开发范围验证；教学功能、真实儿童数据和跨设备兼容不属于本次发布承诺。

普通用户可以直接向 Codex 发送下面这句话：

> 从GitHub安装Codex插件 `aideskx/aidesk`

这句话明确指定从 GitHub 安装 Codex 插件，并只保留唯一的仓库坐标，没有放入网址；安装完成后，再新建任务并发送“打开AI书桌”。

Codex 会在宿主支持的范围内使用 marketplace add 和 plugin add 等管理步骤完成安装；这句话不是对所有宿主界面或安装链路一致性的承诺。

本次技术预发布对应工件版本 `0.3.1+codex.20260914045055`。上一可用 `0.1.1` 与 `0.1.0` 标签仍保留为历史回退锚点；本仓不承诺 Windows、MacBook、后台自动安装、静默安装、失败恢复或完整产品能力已经在所有环境成立。

本次工件 `packageDigest` 为 `f89ffb823dcacd9496a1899f5133836b0125b81fb6629dcbb0c80132ea7eeb57`。`SHA256SUMS` 保存三个插件文件及 `release.json` 的文件摘要；摘要用于项目审计，不代表 Codex 宿主会自动验证它。

打开AI书桌时，入口会通过同一 MCP 检查本仓 `release.json` 中的稳定版本。插件包自动携带版本号；普通新版提示后继续，检查暂不可用时继续登录。服务缓存公开版本最多五分钟，不在每轮聊天重复检查，也不在关闭 Codex 后后台轮询。现有旧包需先用上方同一句话更新一次。

发现新版不代表已安装。用户确认更新后仍由 Codex 的插件安装流程处理，完成后新建任务再打开AI书桌。`release.json` 与完整插件包在同一 Git 提交交付；版本头只用于版本提示，不能代替账号认证或包完整性检查。
