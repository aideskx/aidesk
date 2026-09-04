# AI书桌 Plugin 技术预发布

这是 AI书桌 Plugin 的 PUBLIC Git-backed 技术预发布分发仓，不是 AI书桌私有源码仓，也不是 OpenAI 公共 Plugin Directory。

当前发布 `aidesk-runtime` 0.1.1 最小入口。它在真实宿主加载后显示入口已加载、版本标记和当前可用/暂不提供的边界；不包含账号、家庭、儿童、学习者资料、真实教学、学习事实、MCP、OAuth 或后台自动更新能力。

普通用户可以直接向 Codex 发送一句话：

> 从 https://github.com/aiepgpt-glitch/aidesk-plugin 安装 AI书桌 Plugin，安装完成后新建任务并打开 AI书桌。

Codex 会在宿主支持的范围内使用 marketplace add 和 plugin add 等管理步骤完成安装；这句话不是对所有宿主界面或安装链路一致性的承诺。

本次 V1 技术预发布对应不可移动标签 `aidesk-runtime-v0.1.1`。此前的 `aidesk-runtime-v0.1.0` 仍保留为回退锚点。该仓不承诺 Windows、MacBook、自动更新、静默更新、失败恢复或完整产品能力已经在所有环境成立。

V1 `packageDigest` 为 `5923b7a6b3280e4138822346c433d58140e5540b035b74e804b6e571c6cd0b5c`；它和本文件中的 `SHA256SUMS` 仅作为项目审计记录，不代表 Codex 会自动验证该摘要。
