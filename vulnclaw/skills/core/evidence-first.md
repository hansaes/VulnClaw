---
name: evidence-first
description: Evidence-First 证据链方法论 — 漏洞发现必须走 Signal→Hypothesis→Controlled Test→Differential Evidence→Impact→Finding 链路，confidence 分级与报告闸门
routing:
  phases: [vuln_discovery, exploitation, reporting]
  task_types: [pentest, bugbounty]
  vulnerability_classes: [sqli, xss, ssrf, idor, rce, file_upload, business_logic, auth_bypass]
---

# Evidence-First 证据链方法论

> 综合自 src-6k `Evidence-First` 测试策略、src-hunter 黑盒证据纪律、Black-cat 假设驱动框架。
> 核心原则：**每个漏洞结论 = 一段可复现的流量 + 一段可观察的副作用证据**。没有这两段，不是漏洞，是猜测。

## 一、证据链路（必须走完）

```
Signal → Hypothesis → Controlled Test → Differential Evidence → Impact → Finding
```

| 环节 | 含义 | 输出 |
|------|------|------|
| Signal | 异常信号（报错回显、延时、行为差异） | 记录原始响应 |
| Hypothesis | 明确假设"此处存在 X 类型漏洞，因为 Y" | 一句话假设 |
| Controlled Test | 受控测试：构造最小 PoC，只改一个变量 | 可复现的请求 |
| Differential Evidence | 差分证据： baseline vs 探针对照，证明行为偏离预期 | 对照组流量 |
| Impact | 影响证明：在目标上实际发生的事情 | 副作用证据 |
| Finding | 结论：仅当证据闭环才写成 Finding | 带 confidence 的结论 |

**Finding 必备字段**：
```yaml
type: authorization            # 漏洞类型
target: https://example.com/api # 完整目标
prerequisite: session-a         # 前置条件
request: request-or-file        # PoC 请求（可复现）
control_request: baseline       # 对照组请求
observed_difference: 具体的字段/状态码/行为差异
security_boundary_broken: user-or-tenant-boundary
impact: verified-impact         # 已验证的影响
confidence: confirmed           # 见下表
```

## 二、confidence 分级与报告闸门

| 等级 | 含义 | 能否进报告 |
|------|------|-----------|
| confirmed | 独立证据闭环：复现流量 + 副作用证据 + 差分对照 | ✅ 正式报告只允许此级 |
| high | 差分证据充分，副作用证据间接 | ⏳ pending，需补证据 |
| medium | 单点证据，无对照组 | ⏳ pending |
| suspected | 仅有 Signal，无受控测试 | ❌ 不写成漏洞 |
| rejected | 已证伪 | ❌ 归档 |

**硬闸门**：正式报告只允许 `confirmed`；其余进入 pending/rejected。**未确认的线索不得写成漏洞。**

## 三、差分证据对照表（每类至少 3 包）

漏洞 = 行为偏离预期，证明偏离需要"对照组"：

| 测试 | 对照组（缺一不可） |
|------|-------------------|
| **SQLi（盲）** | 真条件包（5s 延时）+ 假条件包（即时返回）+ baseline 干净包 |
| **IDOR** | 自己资源 200 + 他人资源 200（含他人数据）+ 不存在资源 404 |
| **越权** | 普通用户被拒 403 + 管理员通过 200 + 普通用户绕过 200（关键证据） |
| **逻辑漏洞** | 正常流程响应 + 篡改流程响应 + 篡改后的真实副作用（如订单真的生成了） |
| **SSRF** | 内网 IP 拒绝（参考基线）+ 内网 IP 允许（漏洞）+ 外网回连（DNSLog） |
| **XSS** | 输入回显位置确认 + 转义/过滤绕过 + 可执行证明（弹窗/DNSLog 回调） |

**基线请求与探针请求必须可对照**：记录状态码、条数、主体、租户、时间差或回显差异。
空列表、报错、超时**不能**直接等同于登录墙或漏洞。

## 四、黑盒幻觉对照表（常见误报）

| 幻觉类型 | 典型表现 | 真实情况 |
|---------|---------|---------|
| 响应特征幻觉 | 看到 500 + "syntax error" 就报 SQLi | 可能只是参数类型不匹配 |
| 延时幻觉 | sleep(5) 后变慢就说时间盲注 | 可能是网络抖动/限流，需多次对照 |
| 回显幻觉 | 输入的 payload 被回显就说 XSS | 可能在 textarea/已转义/text/plain 上下文 |
| 报错幻觉 | 错误页提到 /var/www/html 就说路径泄露 | 可能本来就是公开文档 |
| 猜版本幻觉 | 看到 Server: nginx/1.x 就报 CVE | 没有任何 PoC 验证 |
| 内部 IP 幻觉 | DNSLog 收到一条记录就说 SSRF | 可能是浏览器预读/第三方扫描 |
| 资产幻觉 | "我以为是该公司的资产" | 资产不在 scope，提交即违规 |

## 五、副作用证据标准（代码执行类必须）

| 漏洞类型 | 合格的副作用证据 |
|---------|----------------|
| RCE | DNSLog / HTTP 外带回显 / 文件创建并读回 / 命令输出 |
| SSRF | 内网响应正文 / 元数据 token / 外部 callback 服务器日志 |
| 任意文件读 | 目标文件实际内容（/etc/passwd 含 root: 行 / 配置含真实数据库地址） |
| 文件上传 | 上传后访问文件，得到非 404 响应 |
| SQLi | 实际数据：version()、current_database()、admin hash 前缀 |
| XSS | 可执行证明 + 回调（DNSLog / XSS Hunter 平台收到 callback） |

**红线**：拖库 / 删数据 / 改密码 / 留 shell 一律禁止。证据取到"足以证明能做"即停。

## 六、假设驱动状态机（Black-cat）

不要走单向流水线，允许回溯：

```
RECON ⇄ ENUMERATE ⇄ VALIDATE
```

- **RECON**：发现新信号 → 提出假设（Hypothesis）
- **ENUMERATE**：围绕假设收集证据，缩小范围
- **VALIDATE**：进入验证模式——**先假设是误报，直到独立证据证伪这个假设**
- 新发现可回溯重启早期阶段；被证伪的假设标记 rejected 并归档，不删除

**验证即 PoC 合并**：当验证动作本身就是最小 PoC 时，VALIDATE 与 EXPLOIT 合并，
产出直接记为 reproduction 证据，不再要求先写完整利用链。

## 七、复现率要求

| 漏洞等级 | 最小复现率 | 复现次数 |
|---------|-----------|---------|
| P0 RCE / 鉴权绕过 | 100% | ≥3 次，间隔 1h+ |
| P1 SQLi / IDOR | 95%+ | ≥3 次 |
| P1 逻辑 / 越权 | 90%+ | ≥5 次（不同账号/不同时间） |
| P2 / 时间盲注 | 80%+ | ≥5 次，附延时差统计 |
| 竞态条件 | N 次中稳定命中 | ≥5 次，给出脚本 |

复现率不到 → 在报告里**主动说明**（如"5 次测试中 4 次成功"），不虚报 100%。

## 八、报告自检清单（提交前逐项过）

- [ ] 标题格式：`[等级][条件][类型] 端点 - 一句话`
- [ ] 资产在授权 scope 内
- [ ] 复现步骤逐条编号，含完整 HTTP 请求包（方法+URL+Header+Body 一字不漏）
- [ ] 至少 1 张响应截图 + 1 张 URL 可见的截图
- [ ] 副作用证据（外带/数据/文件）
- [ ] 差分对照组完整（baseline vs 探针）
- [ ] 至少 3 次复现成功（或如实说明复现率）
- [ ] CVSS vector + 影响段
- [ ] 修复建议（具体可操作）
- [ ] 未对生产数据造成不可逆影响，PII 已脱敏

## 九、反模式（出现即打回）

```
❌ "可能存在 SQL 注入，建议进一步验证。"
❌ "推测后端用了 MySQL，从而有时间盲注。"
❌ "由于 Header 里有 X-Powered-By: PHP，可能是反序列化漏洞。"
❌ "我没有 PoC，但理论上可以..."
❌ 把自己输入的回显当成 XSS 证据
❌ 用单次延时差异报时间盲注（无多次对照）
```
