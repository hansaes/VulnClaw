---
name: evidence-first
description: Evidence-First 证据链方法论 — 漏洞发现必须走 Signal→Hypothesis→Controlled Test→Differential Evidence→Impact→Finding 链路，confidence 分级与报告闸门
routing:
  phases: [vuln_discovery, exploitation, reporting]
  task_types: [pentest, bugbounty]
  vulnerability_classes: [sqli, xss, ssrf, idor, rce, file_upload, business_logic, auth_bypass]
---

# Evidence-First 证据链方法论

> 综合自 src-6k `Evidence-First` 测试策略、src-hunter 黑盒证据纪律、Black-cat 假设驱动框架、
> bug-reaper（MIT）的 finding 五要素与对抗式复核标准。
> 核心原则：**每个漏洞结论 = 一段可复现的流量 + 一段可观察的副作用证据**。没有这两段，不是漏洞，是猜测。
> 延伸原则：**一个确认的 P2，胜过二十个理论上的 P5**——少而准，胜过多而虚。

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

## 三、Finding 五要素（报告准入）

每条 finding 必须同时满足以下五项，缺一即降级或丢弃：

1. **攻击者可控输入**——输入点真正由攻击者控制，无需已有的高权限会话或服务端配合
2. **到达危险 sink**——完整追踪 `输入 → 入口点 → [各校验/编码/防御点] → 危险 sink`，链上任何一处被防御中和即断裂
3. **绕过所有防御**——框架默认防护（参数化查询、自动转义、CSRF token）、WAF、ORM 默认行为，逐一确认未生效或已被绕过
4. **真实影响**——攻击者具体获得了什么（数据/权限/执行），不是"理论上可以"
5. **可用 PoC**——可复现的请求或步骤，他人按步骤能重现

**信任边界**：有效 finding 必须跨越至少一条信任边界——未认证→已认证数据、普通用户→他人数据、
用户输入→服务端执行、外部→内网、低权限角色→管理功能。**没有跨越信任边界 → 影响可忽略 → 丢弃。**

入口点清单（确认可控性）：URL 参数、POST Body、HTTP 头、路径段、文件上传（文件名/内容/MIME）、
WebSocket 消息、Cookie、GraphQL 变量。

攻击者前置条件必须显式声明：无需认证 / 需有效账号 / 需特定角色 / 需受害者交互（可能性多大）。
前置条件过高 → 降级；现实中不可能 → 丢弃。

## 四、差分证据对照表（每类至少 3 包）

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

## 五、黑盒幻觉对照表（常见误报）

| 幻觉类型 | 典型表现 | 真实情况 |
|---------|---------|---------|
| 响应特征幻觉 | 看到 500 + "syntax error" 就报 SQLi | 可能只是参数类型不匹配 |
| 延时幻觉 | sleep(5) 后变慢就说时间盲注 | 可能是网络抖动/限流，需多次对照 |
| 回显幻觉 | 输入的 payload 被回显就说 XSS | 可能在 textarea/已转义/text/plain 上下文 |
| 报错幻觉 | 错误页提到 /var/www/html 就说路径泄露 | 可能本来就是公开文档 |
| 猜版本幻觉 | 看到 Server: nginx/1.x 就报 CVE | 没有任何 PoC 验证 |
| 内部 IP 幻觉 | DNSLog 收到一条记录就说 SSRF | 可能是浏览器预读/第三方扫描 |
| 资产幻觉 | "我以为是该公司的资产" | 资产不在 scope，提交即违规 |

## 六、副作用证据标准（代码执行类必须）

| 漏洞类型 | 合格的副作用证据 |
|---------|----------------|
| RCE | DNSLog / HTTP 外带回显 / 文件创建并读回 / 命令输出 |
| SSRF | 内网响应正文 / 元数据 token / 外部 callback 服务器日志 |
| 任意文件读 | 目标文件实际内容（/etc/passwd 含 root: 行 / 配置含真实数据库地址） |
| 文件上传 | 上传后访问文件，得到非 404 响应 |
| SQLi | 实际数据：version()、current_database()、admin hash 前缀 |
| XSS | 可执行证明 + 回调（DNSLog / XSS Hunter 平台收到 callback） |

**红线**：拖库 / 删数据 / 改密码 / 留 shell 一律禁止。证据取到"足以证明能做"即停。

## 七、假设驱动状态机（Black-cat）

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

## 八、复现率要求

| 漏洞等级 | 最小复现率 | 复现次数 |
|---------|-----------|---------|
| P0 RCE / 鉴权绕过 | 100% | ≥3 次，间隔 1h+ |
| P1 SQLi / IDOR | 95%+ | ≥3 次 |
| P1 逻辑 / 越权 | 90%+ | ≥5 次（不同账号/不同时间） |
| P2 / 时间盲注 | 80%+ | ≥5 次，附延时差统计 |
| 竞态条件 | N 次中稳定命中 | ≥5 次，给出脚本 |

复现率不到 → 在报告里**主动说明**（如"5 次测试中 4 次成功"），不虚报 100%。

## 九、高 ROI 速查（任何目标先花 10 分钟）

深入单类漏洞前，先跑这几个——产出确认 finding 的速度最快：

1. **双账号 IDOR**：A、B 两个账号，对每个 `GET /api/*/[id]` 端点，用 B 的会话换 A 的资源 ID。返回他人数据 → 直接 High
2. **密码重置 token 复用**：申请重置链接，用一次，再用一次。第二次仍有效 → 鉴权绕过
3. **响应中的 role 字段**：自己的 profile 接口若返回 `role/admin/isAdmin`，尝试在 PUT/PATCH 里带上——批量赋值 → 提权
4. **dev/staging 环境**：`staging.`/`dev.` 解析成功就并行测一遍——同代码，更少控制
5. **GraphQL introspection**：`{ __schema { types { name } } }` 能通 → 拿到全量未公开 API 面

## 十、对抗式复核（提交前扮演 triager，目标是打回这份报告）

### 攻击者可控性质疑
- [ ] 输入真的由攻击者控制，还是需要已有的特权会话？
- [ ] 触发影响是否需要换用另一个用户的会话？
- [ ] "可控"是否只在服务端/admin 侧成立？→ 不干净则 **丢弃**

### 防御性质疑
- [ ] 框架是否默认自动转义/参数化？
- [ ] 常见 WAF 配置是否会拦这类 payload？
- [ ] ORM 是否默认预编译？输出层编码是否在输入校验之外另有一层？→ 有可信防御且未被绕过则 **丢弃或标 Theoretical**

### 现实质疑
- [ ] 该漏洞类是否在目标平台常见拒收（self-XSS、缺安全头、无 bypass 的限流、未确认适用性的版本 CVE）？
- [ ] 利用是否要求只有合法授权用户才有的 admin/owner 权限？
- [ ] 影响是否只限攻击者自己（self-impact）？→ 是则 **丢弃**

### 平台 triage 模拟
- **HackerOne**：Accept = 真实安全边界被违反 + 具体攻击者收益 + 清晰 PoC；缺 PoC/影响不清 → Needs Clarification；已知排除类/self-only/纯理论 → N/A
- **Bugcrowd**：P1 = RCE/接管环境/批量 ATO；P2 = 存储 XSS→ATO、内网 SSRF、有数据外带的 SQLi；P3 = 有限 IDOR、需交互的反射 XSS；P4 = 有敏感度的信息泄露；达不到 Medium 线 → P5/拒收
- **Intigriti**：Valid = 可完整复现 + 攻击者获得未授权访问；Duplicate = 同类端点检查是否已有相同模式

### 降级规则（不丢弃，但降 severity）
- 影响真实但需非平凡的受害者交互 → 降 1 级
- 多个低危原语组合 → 未证明链条前上限 Medium
- IDOR 暴露非敏感数据（ID、公开元数据）→ Low 或丢弃
- 仅管理员面板的 XSS 且用户可信 → 上限 Medium
- SQLi 确认但数据库用户只读 → Critical 降级

**输出 5 个确认的 P2/P3，胜过 50 个"疑似"**。若无 finding 通过全部过滤，如实写：
> "经 triage 未发现可报告漏洞。曾考虑并排除的项：[逐项列出 + 排除原因]。"
> 这是正确的诚实结果，不是失败。

## 十一、Scope 边界（赏金/授权场景）

- `*.target.com` 通配通常**不含**裸域 `target.com` 本身；`sub.app.target.com` 这类嵌套子域默认**在内**，除非明确排除——动手前以 program 规则为准
- 资产不在 scope → 提交即违规，见"资产幻觉"

## 十二、报告自检清单（提交前逐项过）

- [ ] 标题格式：`[等级][条件][类型] 端点 - 一句话`
- [ ] 资产在授权 scope 内（含通配边界确认）
- [ ] 复现步骤逐条编号，含完整 HTTP 请求包（方法+URL+Header+Body 一字不漏）
- [ ] 至少 1 张响应截图 + 1 张 URL 可见的截图
- [ ] 副作用证据（外带/数据/文件）
- [ ] 差分对照组完整（baseline vs 探针）
- [ ] 至少 3 次复现成功（或如实说明复现率）
- [ ] CVSS vector + 影响段
- [ ] 修复建议（具体可操作）
- [ ] 未对生产数据造成不可逆影响，PII 已脱敏
- [ ] 已过"对抗式复核"第十节，无可打回项

## 十三、反模式（出现即打回）

```
❌ "可能存在 SQL 注入，建议进一步验证。"
❌ "推测后端用了 MySQL，从而有时间盲注。"
❌ "由于 Header 里有 X-Powered-By: PHP，可能是反序列化漏洞。"
❌ "我没有 PoC，但理论上可以..."
❌ 把自己输入的回显当成 XSS 证据
❌ 用单次延时差异报时间盲注（无多次对照）
❌ 缺安全头 / 无 PoC 的点击劫持 / self-XSS 直接写成 finding
```
