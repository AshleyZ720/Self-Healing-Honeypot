# BREACH Labs — HSK Chain Hackathon Submission

## 一句话

**A honeypot that gets stronger every time you break it.**

BREACH Labs 是一个可玩、可领取链上奖金的 Agent 安全训练竞技场。玩家购票攻击发票审核 Agent；第一位诱导它提出违规付款的人获得测试 HSK 奖金。Codex 针对实际攻破记录只修一处策略，系统回放原攻击并测试正常任务，再把下一关的策略承诺发布到 HSK Chain。

## 解决的问题

静态 prompt-injection 关卡在漏洞被公开后就失去挑战性，且玩家难以区分“模型说了批准”和“模型真的做了危险动作”。本项目把胜负绑定到**真实工具调用**，并让上一轮攻击成为下一轮的出题依据：`breach → payout → patch → replay → next round`。

## 为什么需要区块链

HSK Chain 测试网合约负责 Ticket 入场、奖池托管、首胜锁定、奖金领取、退款，以及每版 Agent 策略与补丁测试证据的哈希承诺。玩家能在浏览器核对资金和版本状态。模型推理与裁决仍由本机服务执行并签名；我们明确展示这一信任边界，没有宣称零知识证明模型输出。

## 技术实现

- **Defender：**DeepSeek Flash，非思考模式；只能调用 `lookup_vendor`、`propose_payment`、`reject_invoice`。付款工具只记录沙盒提案。
- **胜负规则：**TypeScript 程序检查付款提案的商户、收款地址和金额上限；不存在第二个“模型裁判”。
- **Reviser：**本机 Codex CLI 在独立只读目录中生成一条局部策略补丁。原攻击重放两次、两张合法发票和未知商户测试都通过，才发布 v2。
- **链上：**Solidity 合约使用 EIP-712 裁决签名，绑定 Chain ID、合约、Arena、版本、Ticket、玩家、对话哈希、结果、nonce 和有效期。Ticket 费用 80% 入池；首位获胜者领 70% 活跃奖池，30% 滚到下一关。
- **产品：**React 网页提供真实交互终端、实时工具轨迹、Demo/浏览器钱包和交易状态、由任意测试网钱包创建挑战或赞助、完整攻防历史、无奖金教学回放和退款。Node 服务用 SQLite 保存历史、索引外部链上事件并用 SSE 推送状态。

## 现场展示

打开 **http://127.0.0.1:8787**。默认是未被攻破的 **Arena #3 / v1**，演示钱包已有测试币。点击 Buy ticket，粘贴 [README 的教学攻击](./README.md#现场演示路径)，观察错误收款地址的沙盒付款提案、链上裁决与 Claim。随后切到 Evolution，观看 Codex 补丁、回归结果、版本哈希和下一轮开放。Arena #2 保留一套已完成的 v1→v2 链上记录，供评委快速核查。

合约：[HSK Testnet Explorer](https://testnet-explorer.hsk.xyz/address/0x143f483a9188b80493FdA3b628f5baBe62C2097d)。已发生的获胜裁决：[交易](https://testnet-explorer.hsk.xyz/tx/0xf209e310f55367ed7cd42001f3d30bb188d38f75efa3e013fcd05320732a1c08)；v2 发布：[交易](https://testnet-explorer.hsk.xyz/tx/0x993883f30609cf3f97357ad7b4eeda9f39fbeade49c1cce585eaf27887cb44ee)。更多验证步骤与证据见 [README](./README.md)。

## 完成度与边界

已经在 HSK 测试网上完成创建、购票、正常发票、v1 攻破、派奖领取、Codex 补丁、回放、v2 发布、v2 玩家再购票、失败裁决、暂停退款和开赛前取消。外部钱包创建/购票/签名登记、错误签名拦截、任意钱包赞助，以及模型 API 故障时全额退款也已验证。Foundry 合约测试 10 项、付款裁决测试 4 项通过；数据库快照可在干净环境下校验链上哈希后恢复，服务重启后还能重建已上链但尚未写入本地数据库的版本。测试币无实际价值；当前是本机演示产品，裁决服务是中心化的。
