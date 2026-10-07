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
