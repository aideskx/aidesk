# AI书桌 Plugin · 1.1.6 本地审阅候选

AI书桌在 Codex 中帮助用户澄清本人目标、衔接独立目标任务、记录必要进展与成果，并按本人意愿分享和继续工作。

本地候选版本：`1.1.6+codex.20261002120609`，状态 `local_isolated_candidate`；未稳定发布，禁止推送公开 main。准确源码 c8e355605da0ecc810746301cec66c89c509777c 的 Windows CI 37004971302 已通过34项原生IO、8项退出等待和9项入口fixture，均零失败／跳过，沿准确随包normal运行、未重编；真实Windows桌面仍未验。 Mac 原1.1.5入口证据不自动升级为本候选实际安装、连接或新界面验证。当前树只准备这一完整候选包及配套元数据；旧公开1.0.10恢复点保留在 Git 历史。

## 本次变化

1.1.6 本地待验候选：修复目标任务接续的可选 contextId 声明与实现不一致；自然业务验收仍需新样本。

本机 STDIO 工具使用 `node` 加同包相对参数启动，并转发正常 `CODEX_HOME`。只读更新检查只测量当前加载包并比对公开发行，不启动宿主 CLI、不证明安装或来源 current；获准的 prepare/apply 仍沿官方宿主命令。任务执行沿真实 Hook、来源与原号关联。安装成功、连接已刷新、任务真实创建、此刻入口可访问和目标成果成立分别判定。未知结果保留原号对账，不另派任务或自动重试；没有入口依据时不以 URI 代替可见事实。

## 安装与验收范围

本候选只供 root 在已授权的 Mac 宿主 home 沿 Codex 官方本地 marketplace 机制受控安装核验，不是面向用户的稳定更新。认证与信任沿宿主正常流程，不读复制凭据或绕过权限；本地候选的只读包检查可报告 loaded_ahead，其安装与来源 verified 字段保持 false；这不是官方 main current，不伪装来源或升级连接。官网：[aideskx.com](https://aideskx.com)。

Exact c8e35560 source: Mac offline 608/608 (350 current plus 258 historical fixtures); Ubuntu 22.04 and 24.04 each 349/349; Windows strict bundled normal 34 native plus 8 waiter plus 9 metadata fixtures. Zero failures/skips. No actual desktop/login/natural-business acceptance is inferred from CI.

包发布不等于完整自然目标链、桌面界面、第二宿主或社区开放全部通过。最低支持版本保持 `1.0.5+codex.20261001120032`。本地候选 marketplace 与官方 Git 来源分别记录，不伪装来源来制造更新 current。

## 完整性与恢复

包含 39 个文件；manifest 与 MCP 版本头一致，包摘要包含 Git 文件模式：

`84ded52cb5c40a4178c4240cf6ab29232d0171164a48bbc4ad4c0e285b3f329a`

`release.json`、完整 Plugin、marketplace、README 和 `SHA256SUMS` 同一提交交付；校验和覆盖除自身外的 42 个文件。`publishedAt` 仅为候选元数据生成字段，没有实际推送。release.json 沿既有发行工具的固定 stable 字段合同生成，仅用于本地同包校验，该字段不代表这个实验候选已通过稳定准入。

上一公开恢复点 `7840dbe3928ee8b72ee4edafeb974f950f9b2c22` 对应 `1.0.10+codex.20261002022547`，摘要 `67fb270beeaa358223f841f0ab1d10e2215ab022836d27bdb215100dff20e55c`。该旧版仍有已观察到的自然入口来源检查 unknown 限制；它不是全功能通过的恢复版本。恢复完整旧包与元数据，不回退服务数据、不替换整份宿主配置或认证、不重放未知操作。
