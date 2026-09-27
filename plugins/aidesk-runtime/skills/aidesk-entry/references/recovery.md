# 请求原件、未知结果与恢复

本说明与同包入口`SKILL.md`共同使用，不是独立Skill。脚本路径均以 `SKILL.md` 所在目录为基准；其中`../../scripts/…`相对入口目录解析，不以本文件所在目录为基准。转入其他场景或出现未知／恢复分支时，按入口路由补读对应同包说明。

## 原号、原合同与恢复根

恢复使用同一helper：`pending --subject <原账号> --data-root <Hook实际给出的恢复根>`只读有界待同步摘要；`operation --subject <原账号> --data-root <同一恢复根> --operation-id <原号>`生成对账参数；确需按原内容重发才用相同参数的`retry`。返回的工具和完整`input`用于当前实际MCP调用，helper不代调服务。完整原件及新版本化薄索引按其原合同生成查询；旧草稿及旧目标删除的无版本薄索引产生于各自v2出现之前，helper可按各自唯一的v1恢复查询；新的目标或网络删除原件和薄索引始终保留实际合同版本，不随当前目录升级。旧服务受理薄索引缺少原合同、无法区分v1／v2时保留未知，不猜版本或改号。缺失原件时不得retry，只有找回同号同摘要的完整原件才继续原内容恢复。缺失原件或恢复根时保留已知原号与未知结果，不改正文换号；不扫描其他账号、宿主私有状态或旧正文寻找替代。

旧未决原件保留原字节，只沿当前本人原范围的准确旧合同有界恢复；不为恢复重新选择成员、创建旧start/mode或复制普通正文。缺少可靠恢复接口时保全并说明未确认，不删除、改归属或伪升级。

正常写入仍用入口核心的prepare／Pre／MCP／Post协议；本说明与相关业务说明一起使用。目标定稿、发布、分享默认和任务原号按goals的准确合同核对；删除或删除取消同时沿data-rights保留对象、代际、快照、墓碑及本机清理范围。旧合成范围的全文和投影原件限制沿legacy-network；不能以恢复抹去这些业务差异。

## 社区互动的未知结果

互动结果未知沿`interaction_operation`的原号和完整请求摘要核对。not_found不是终态；erased表示该原件已被清理，只保留薄事实，不重放。按准确目标或关系删除预览与原删除回执核本机清理，不能仅凭erased宣称所有副本已删。

## 评论的未知结果与停止未确认发表

结果未知沿原helper `operation --subject <原账号> --data-root <Hook实际根> --operation-id <原号>`生成`comment_operation`，用原operationId及完整请求摘要对账。not_found不是取消或重派许可；erased只证明服务原件已擦除，不从历史回执拼回正文。用户要停止尚未确认的发表评论时，用helper `cancel --subject <原账号> --data-root <Hook实际根> --operation-id <原号>`恢复完整原请求交给`comment_cancel`。只有真实cancelled回执才证明阻止同号迟到发表；若已recorded，说明已保存，不能声称撤回成功。没有完整原件时不编造缺失文字或新原号，继续薄查询。重新明确发表需要新的意图和原件；这与删除已保存评论的数据取消流程不同。

## 通知原号与设置恢复

通知写入仍由原helper prepare生成一次原号；未知用`operation --subject <原账号> --data-root <实际恢复根> --operation-id <原号>`生成notification_operation，按同原号和完整摘要核对。completed只证明对应标读或设置事实；not_found不是取消，erased只证明准确通知或设置代的原件已清除。此合同没有cancel工具，取消尚未发送请求、关闭主动提醒和取消数据删除分别处理，不编造通知取消回执。

## 社区举报原号恢复

结果未知沿原helper `operation --subject <原账号> --data-root <实际恢复根> --operation-id <原号>`生成report_operation，用同原号和完整摘要对账；not_found不是终态，不换号重复举报。此合同没有report_cancel。erased只证明本人准确原件已擦除，不能重放或宣称本机副本已清。
