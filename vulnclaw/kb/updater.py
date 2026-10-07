"""VulnClaw Knowledge Updater — update and seed the knowledge base."""

from __future__ import annotations

from vulnclaw.kb.store import KnowledgeStore


def seed_knowledge_base(store: KnowledgeStore) -> None:
    """Seed the knowledge base with initial data.

    This populates the KB with essential security knowledge for MVP.
    """
    # ── CVE Entries ──────────────────────────────────────────────

    cves = [
        {
            "id": "CVE-2026-21858",
            "title": "n8n Arbitrary File Read via Public Form",
            "description": "n8n versions >= 1.65.0 and < 1.121.0 allow unauthenticated "
            "arbitrary file read through public form submission endpoints when "
            "a workflow contains a Form Ending node returning a binary file.",
            "severity": "Critical",
            "affected": "n8n >= 1.65.0, < 1.121.0",
            "tags": ["n8n", "file-read", "rce", "critical"],
            "exploitation_steps": [
                "Identify a public form path on the n8n instance",
                "Send POST request with forged files object containing filepath",
                "Read server files including /etc/passwd, config, database",
                "Extract encryption key from config",
                "Use extracted credentials to login",
                "Create malicious workflow with expression injection for RCE",
            ],
            "remediation": "Upgrade to n8n >= 1.121.0",
        },
        {
            "id": "CVE-2025-68613",
            "title": "n8n Authenticated Expression Injection RCE",
            "description": "Authenticated expression injection in n8n allows RCE via "
            "malicious workflow expressions.",
            "severity": "Critical",
            "affected": "n8n >= 0.211.0, < 1.120.4",
            "tags": ["n8n", "rce", "expression-injection", "critical"],
            "exploitation_steps": [
                "Login with valid credentials",
                "Create a workflow with manualTrigger + set node",
                "Insert expression payload: ={{ (function(){...execSync(cmd)...})() }}",
                "Run the workflow",
                "Read execution result for command output",
            ],
            "remediation": "Upgrade to n8n >= 1.120.4 or 1.121.1",
        },
    ]

    for cve in cves:
        existing = store.get_entry("cve", cve["id"])
        if not existing:
            store.add_entry("cve", cve["id"], cve)

    # ── Technique Entries ────────────────────────────────────────

    techniques = [
        {
            "id": "sqli-bypass",
            "title": "SQL 注入绕过技巧",
            "description": "绕过 WAF 的 SQL 注入 payload 构造方法",
            "tags": ["sqli", "waf-bypass", "web"],
            "bypass_methods": [
                "大小写混合: SeLeCt",
                "内联注释: S/*!ELECT*/",
                "双重编码: %2565",
                "等价函数: GROUP_CONCAT 替代 concat_ws",
            ],
        },
        {
            "id": "sqli-one-pass-playbook",
            "title": "SQL 注入一命通关实战速查",
            "description": "基于 fushuling 公开文章二次整理的 SQL 注入手工验证、sqlmap 加速、tamper/WAF 绕过与证据记录流程。",
            "source": {
                "title": "SQL注入一命通关!",
                "url": "https://fushuling.com/index.php/2023/04/07/sql%E6%B3%A8%E5%85%A5%E4%B8%80%E5%91%BD%E9%80%9A%E5%85%B3/",
                "published": "2023-04-07",
            },
            "tags": [
                "sqli",
                "sqlmap",
                "tamper",
                "waf-bypass",
                "ctf-web",
                "evidence",
            ],
            "workflow": [
                "先定位真实输入面：HTML 表单、GET/POST 参数、XHR/API、Cookie 或 HTTP 头。",
                "建立 baseline，再用 true/false、报错、延迟或 union 回显验证是否进入 SQL 语义层。",
                "联合查询按列数、回显位、库名、表名、列名、数据推进；无回显时切换布尔/时间盲注。",
                "过滤明显时按被拦截 token 选择最小绕过：空白、注释、编码、比较符、关键字形态或自定义 tamper。",
                "手工确认参数和响应差异后，再使用 sqlmap 加速枚举或数据提取。",
            ],
            "tool_guidance": [
                "单次请求用 fetch。",
                "payload 批量对比用 http_probe_batch。",
                "盲注循环、复杂编码或响应解析再用 python_execute。",
                "发现明确表单或 id 参数时优先测试该入口，不要先做无意义目录扫描。",
            ],
            "evidence_required": [
                "URL、HTTP 方法、参数名、baseline 响应摘要。",
                "true/false、error/time 或 union 回显差异。",
                "状态码、长度、hash、关键 body 片段或响应时间。",
                "最终 flag/敏感数据必须逐字来自工具输出。",
            ],
            "reference_file": "vulnclaw/skills/specialized/secknowledge-skill/references/web-sqli-fushuling-one-pass.md",
        },
        {
            "id": "rce-bypass-php",
            "title": "PHP 命令执行绕过技巧",
            "description": "绕过 PHP WAF 的命令执行 payload 构造",
            "tags": ["rce", "waf-bypass", "php", "web"],
            "bypass_methods": [
                "Base64编码函数名: $f=base64_decode('c3lzdGVt');$f('id');",
                "字符串拼接: $f='sys'.'tem';$f('id');",
                "拆分路径: '/va'.'r/ww'.'w/ht'.'ml'",
                "反转字符串: $f=strrev('metsys');$f('id');",
            ],
        },
        {
            "id": "xss-bypass",
            "title": "XSS 绕过技巧",
            "description": "绕过 WAF/XSS 过滤器的 payload 构造",
            "tags": ["xss", "waf-bypass", "web"],
            "bypass_methods": [
                "事件处理器: <img src=x onerror=alert(1)>",
                "SVG 标签: <svg onload=alert(1)>",
                "HTML实体编码",
                "Unicode 编码",
            ],
        },
        {
            "id": "cmd-injection-bypass",
            "title": "命令注入绕过技巧",
            "description": "绕过命令注入过滤的方法",
            "tags": ["command-injection", "waf-bypass", "web"],
            "bypass_methods": [
                "换行符: id\\nwhoami",
                "管道符: id|whoami",
                "变量拼接: a=i;b=d;$a$b",
                "通配符: /bin/ca? /etc/pas?d",
            ],
        },
        {
            "id": "evidence-first-methodology",
            "title": "Evidence-First 证据链方法论",
            "description": "漏洞发现必须走 Signal→Hypothesis→Controlled Test→Differential Evidence→Impact→Finding 链路；confidence 分级 confirmed/high/medium/suspected/rejected，正式报告只允许 confirmed。",
            "tags": ["methodology", "evidence", "verification", "web"],
            "method": [
                "每个漏洞结论 = 一段可复现的流量 + 一段可观察的副作用证据",
                "差分证据：SQLi盲(真延时+假条件+基线)/IDOR(自己200+他人200+不存在404)/越权(403+200+绕过200)/SSRF(拒绝+允许+外带)",
                "进入验证模式先假设是误报，直到独立证据证伪",
                "验证即 PoC 合并：验证动作本身就是最小 PoC 时直接记为 reproduction 证据",
                "复现率：P0 100%(≥3次)/P1 95%+(≥3次)/逻辑漏洞 90%+(≥5次)，不足如实说明",
            ],
            "anti_patterns": [
                "看到 500+syntax error 就报 SQLi（可能只是类型不匹配）",
                "单次延时差异报时间盲注（需多次对照排除抖动）",
                "输入回显当成 XSS（可能在 textarea/已转义上下文）",
                "没有 PoC 的理论漏洞",
            ],
        },
        {
            "id": "bughunter-report-patterns",
            "title": "BugBounty 报告模式（24 类漏洞）",
            "description": "基于 681 份已披露 HackerOne 报告提炼的漏洞模式：每类漏洞的标准测试入口、差分验证法与报告要点。",
            "tags": ["bugbounty", "report", "methodology", "web"],
            "patterns": [
                "IDOR：双账号对照（A 读 B 资源 200 + B 读自己 200 + 不存在资源 404），仅取 1 条脱敏样本",
                "SSRF：内网拒绝基线 + 内网允许 + DNSLog 外带三段证据",
                "XSS：确认可执行上下文（弹窗/DNSLog 回调），不只看回显",
                "逻辑漏洞：正常流程 vs 篡改流程 + 真实副作用（订单/状态真的变了）",
                "报告标题格式：[等级][条件][类型] 端点 - 一句话",
            ],
        },
        {
            "id": "wooyun-sqli-stats",
            "title": "WooYun SQL 注入统计方法论",
            "description": "基于 27732 个 SQL 注入案例统计：高频注入参数、注入点 URL 模式、数据库指纹判断流程。",
            "tags": ["sqli", "statistics", "web"],
            "method": [
                "优先测试高频注入参数（id、search、keyword、page 类参数命中率最高）",
                "高危 URL 模式：列表/详情页、搜索功能、管理后台、API 接口",
                "数据库指纹：报错信息 → 函数差异 → 版本特征，自动化判断流程",
                "注入按栈和差分面选探针，禁止对每个 path 机械喷单引号",
            ],
        },
        {
            "id": "osint-arsenal",
            "title": "OSINT 探测弹药库",
            "description": "高价值探测路径：Swagger/GraphQL 发现、常开高危路径、JS 端点提取正则、子域名接管指纹、云存储桶排列。",
            "tags": ["osint", "recon", "web"],
            "method": [
                "API 文档：swagger.json/ui、api-docs、v2/v3 api-docs、graphql/graphiql（introspection 无鉴权=HIGH）",
                "常开路径：/.git/config、/.env、/actuator/env、/actuator/heapdump、/phpinfo.php、/server-status",
                "JS 端点提取三级正则：通用引号路径 → API 特征路径 → 全限定 URL",
                "子域名接管：CNAME 指向 github.io/herokuapp/s3 等 + 特征响应判定",
                "云存储桶：前缀 backup-/assets-/static-/dev-/prod- × 后缀 -backup/-bak/-old 排列探测",
            ],
        },
        {
            "id": "xbow-deterministic-validation",
            "title": "XBOW 架构：AI 探索 + 确定性验证分离",
            "description": "登顶 HackerOne 美国榜的自主黑客架构：Coordinator→Discovery→Solver→Validator，漏洞成立与否由非 AI 代码裁决，零误报的关键设计。",
            "tags": ["methodology", "architecture", "validation", "agent-design"],
            "method": [
                "分层架构：Coordinator 做攻击面测绘与策略分配；Discovery agents 用 headless 浏览器等工具收集端点；Solver 是专项 AI 渗透手（一个 solver 只盯一类漏洞/一个端点）；Validator 只收证据、用确定性代码复验",
                "AI 只负责探索与提假设（'这个框架应该有 x/y/z 端点'），漏洞是否成立由非 AI 验证逻辑裁定——概率性推理不做最终裁决",
                "每个 solver 跑在隔离的攻击机（一次性 Linux 容器），防目标反制；harness 标配：headless 浏览器、InteractSH 外带服务器、payload 托管",
                "报告只收录被实际利用代码确认的 finding，每份带可复现 PoC——理论风险不进报告",
            ],
            "anti_patterns": [
                "让 LLM 自己判定'这是不是漏洞'（概率性裁决=误报源头）",
                "探索与验证混在同一个 agent 循环里不做分离",
                "solver 共用一台机器跑所有目标（被反制会连锅端）",
            ],
        },
        {
            "id": "autonomous-agent-safety",
            "title": "自主渗透 Agent 的工程教训",
            "description": "四版自主渗透 Agent 迭代结论：AI 擅长编排不擅长新颖利用；状态管理是 force multiplier；危险命令护栏；输出截断。",
            "tags": ["agent-design", "safety", "architecture"],
            "method": [
                "AI 的强项是编排：选下一个工具、解析结构化输出、按结果定下一步——这是模式匹配，LLM 做得和资深渗透手一样好",
                "AI 的弱项是新颖利用：链三个 finding、给怪异 edge case 手搓 payload、从异常报错嗅出深层问题——需要人类直觉",
                "状态管理是 force multiplier：凭证库、进度追踪器、证据收集器把 agent 从'花哨终端补全'变成能扛完整 engagement 的系统——这是人类不擅长、机器擅长的部分",
                "危险命令护栏：fork 炸弹、rm -rf /、写 /dev/sd*、flush 防火墙、关机等模式命中即暂停等人审批；CI/一次性环境可用 --auto-approve 绕过",
                "输出截断防 context 爆炸：单条工具输出上限（如 15k 字符），对话历史上限（如 60 条）自动裁剪",
            ],
            "anti_patterns": [
                "指望 agent 自发想出 novel exploit chain（它只会试标准手法）",
                "无状态：每轮都重新发现已知的凭证和进度",
                "不截断工具输出导致 context 撑爆后胡言乱语",
            ],
        },
        {
            "id": "ai-slop-triage-crisis",
            "title": "AI 垃圾报告危机：为什么证据闸门是生死线",
            "description": "PentestEval 数据 + curl 关闭 9 万美元赏金计划事件：未验证的 AI finding 正在摧毁 triage 信任，严格证据闸门不是洁癖是生存需求。",
            "tags": ["methodology", "evidence", "triage"],
            "method": [
                "数据：9 个主流 LLM 在 346 个任务上端到端成功率约 31%；专用自主系统在 CVE-Bench one-day 场景仅 2.5%，配上 sqlmap 等趁手工具提到约 13%——工具链比模型更重要",
                "curl 2026 年 1 月关闭 6 年 9 万美元赏金计划：约 5% 提交是真漏洞，约 20% 有 AI 生成痕迹——'看似合理的一派胡言'让 triage 不可持续",
                "长链条是断裂点：多跳 AD/Entra 路径（委派滥用、跨租户信任、ADCS 链）上，一个错误假设级联，agent 不会恢复只会接着编",
                "业务逻辑漏洞需要理解客户的钱：模型不知道'这个保险系统里 broker 能给已解约客户调账'——那是对话、组织架构和直觉",
                "结论：发出去的每条 finding 都是在消耗 triage 信任额度；evidence-first 的 confirmed 闸门直接对应这个现实",
            ],
            "anti_patterns": [
                "把未验证的 AI 输出批量提交（等于 DDoS 客户的修复团队还要收费）",
                "用'13% 成功率'包装成'完成了一次渗透测试'（那只是 lead generator）",
                "在长链条中间步骤靠模型'脑补'推进",
            ],
        },
        {
            "id": "theoretical-bug-kill-list",
            "title": "理论漏洞处决清单",
            "description": "'攻击者现在、零异常操作、造成真实伤害'三问不过即处决；常见理论 bug 模式与处决理由速查。",
            "tags": ["methodology", "triage", "false-positive"],
            "method": [
                "终极三问：攻击者能否在'现在'对'未做任何异常操作'的真实用户造成真实伤害（盗钱/泄 PII/接管账号/代码执行）？任一 NO 即停，不写不继续",
                "'Could theoretically allow…'=不可利用=不是漏洞；'攻击者集齐 X/Y/Z 条件可以…'=前置太多；'实现错了但无实际影响'=错而无害=不是漏洞",
                "死代码里的 bug=不可达=不是漏洞；无 secret 的 source map=无影响；纯 DNS 回调的 SSRF=要数据外带或内网访问才算；单独的开放重定向=要 ATO 或 OAuth 链",
                "'以后可能组成链'=先把链搭出来再报告，不搭出来就是理论",
                "必须证明真实伤害，'可能'不是漏洞，证出来或丢掉",
            ],
            "anti_patterns": [
                "'理论上可以'写成 finding",
                "把'以后能用在链里'的单点当独立漏洞报",
                "前置条件堆三四个还觉得是 High",
            ],
        },
        {
            "id": "opsec-noise-tagging",
            "title": "OPSEC 噪声分级",
            "description": "每条命令打噪声标签：QUIET（被动）/MODERATE（常规主动）/LOUD（触发 IDS/WAF/SOC），按从静到响执行，默认限速。",
            "tags": ["opsec", "methodology", "recon"],
            "method": [
                "QUIET=被动：DNS、WHOIS、证书透明度、robots.txt/sitemap——随便做",
                "MODERATE=主动但常见：TCP connect 扫描、HTTP 请求、banner 抓取——常规操作",
                "LOUD=触发告警：漏洞扫描、爆破、激进枚举、默认 NSE 之外的脚本——最后用、限速、用前确认",
                "规则：永远从最安静的开始；默认限速；证据存时间戳文件；绝不把不可信输出 pipe 进 shell（|bash/|sh/eval/反引号）",
                "授权场景下也要分级：WAPT 和红队对噪声的容忍度完全不同",
            ],
        },
        {
            "id": "iterative-hunt-discipline",
            "title": "迭代狩猎纪律",
            "description": "非线性 pipeline：每轮执行后问'最有意思的发现是什么'，低信号路径早杀，记录未完成的攻击面以便下轮续上。",
            "tags": ["methodology", "hunting", "bugbounty"],
            "method": [
                "pipeline 是迭代的不是线性的：Phase N 执行→学到了什么/什么意外/哪里死胡同→转向最有希望的线→Phase N+1 深入",
                "每轮 recon/测试后停一下问：'我刚发现的最有意思的东西是什么？'——答案决定下一轮方向",
                "低信号路径早杀：目标返回清一色 403、所有端点同尺寸同页面——别硬刚，pivot",
                "维护'没做完的攻击清单'：下轮直接续上，不用重新扫描",
                "路上发现的新技巧（探针命令、工具怪癖、指纹 trick）在出 context 前存成 skill 更新或 reference 文件",
                "VDP（无奖金）场景 ROI 不同：选干净低风险的 finding、能完整枚举的免认证目标、练可迁移技术（API/OAuth/SSRF）而非一次性 CMS 利用",
            ],
        },
    ]

    for tech in techniques:
        existing = store.get_entry("techniques", tech["id"])
        if not existing:
            store.add_entry("techniques", tech["id"], tech)

    # ── Tool Guides ──────────────────────────────────────────────

    tools = [
        {
            "id": "nmap",
            "title": "Nmap 端口扫描速查",
            "description": "Nmap 常用扫描命令和参数",
            "tags": ["nmap", "recon", "scanning"],
            "commands": [
                "nmap -sV -sC -p- TARGET    # 全端口扫描+版本探测",
                "nmap -sS -TOP_PORTS 1000 TARGET   # SYN扫描Top1000端口",
                "nmap --script vuln TARGET   # 漏洞扫描脚本",
                "nmap -sU -TOP_PORTS 100 TARGET     # UDP扫描",
            ],
        },
        {
            "id": "burp",
            "title": "Burp Suite 工作流",
            "description": "Burp Suite 渗透测试工作流",
            "tags": ["burp", "proxy", "web"],
            "workflow": [
                "配置浏览器代理 → Burp",
                "浏览目标站点，收集请求",
                "分析请求中的参数和端点",
                "使用 Intruder 进行模糊测试",
                "使用 Repeater 手动验证漏洞",
            ],
        },
    ]

    for tool in tools:
        existing = store.get_entry("tools", tool["id"])
        if not existing:
            store.add_entry("tools", tool["id"], tool)
