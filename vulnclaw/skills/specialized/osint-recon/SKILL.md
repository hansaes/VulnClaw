---
name: osint-recon
description: OSINT 开源情报收集知识库 — 四维信息收集模型（服务器→网站→域名→人员），维度四（人员信息）条件触发
routing:
  phases: [recon]
  task_types: [osint, recon]
---

# OSINT 开源情报收集知识库

针对信息收集/侦察/社会工程场景的实战知识库，提供**四维信息收集模型**（服务器信息 → 网站信息 → 域名信息 → 人员信息），以及具体的工具使用方法和数据提取技巧。

**与 `recon` Skill 的区别**：
- `recon` → 技术层面侦察（端口扫描、DNS、目录枚举）— 基础版
- `osint-recon` → 全维度侦察（服务器 + 网站 + 域名 + 人员/社会工程）— 深度版

## 核心原则

1. **四维度全覆盖** — 服务器/网站/域名三个维度始终执行，人员维度按条件触发
2. **从页面提取一切可提取的信息** — 不只看 HTTP 头，还要看 HTML 内容、JS 文件、注释
3. **先被动后主动** — 先看响应头、DNS、WHOIS（被动），再做端口扫描/目录枚举（主动）
4. **维度完成度自检** — 每轮检查哪些维度已完成 ✅，哪些未完成 ❌，全部完成后才允许 [DONE]
5. **外部链接即线索** — 页面上的每个外部链接都可能是信息来源
6. **结构化输出** — 所有发现汇总为 Markdown 报告

## 四维信息收集模型

### 维度一：服务器信息
| 检查项 | 工具/方法 | 说明 |
|--------|----------|------|
| 开放端口 & 服务版本 | MCP nmap / `python_execute` + socket | 全端口扫描或常见端口（21/22/80/443/3306/6379/8080/8443） |
| 真实 IP 探测 | DNS 历史记录 / 全局 Ping / 邮件头提取 | CDN 后的源站 IP — SecurityTrails/DNSHistory/全局Ping |
| 操作系统指纹 | TTL 推断 + nmap OS 检测 | Linux TTL≈64, Windows TTL≈128, Unix TTL≈255 |
| 中间件版本 | 响应头 Server + 错误页 + 特征文件 | Apache/Nginx/IIS/Tomcat 版本识别 |
| 数据库识别 | 端口探测 + 错误信息 + 特征行为 | MySQL(3306)/Redis(6379)/MongoDB(27017)/MSSQL(1433) |

### 维度二：网站信息
| 检查项 | 工具/方法 | 说明 |
|--------|----------|------|
| 网站架构 | 响应头 + 页面特征 + JS 库 | OS + 中间件 + 数据库 + 语言 + 框架 → 完整技术栈 |
| Web 指纹 | `fetch` + 响应特征匹配 | CMS 类型、前端框架、JS 库、模板引擎 |
| WAF 检测 | wafw00f 逻辑 + 响应特征 | 拦截页面/特殊响应头/异常状态码 |
| 敏感目录 & 敏感文件 | `python_execute` + 常见路径字典 | /admin /backup /config /api /robots.txt /sitemap.xml |
| 源码泄露 | 检查常见泄露路径 | .git/.svn/.DS_Store/.env/web.config/备份文件(.bak/.swp/.old) |
| 旁站查询 | 同 IP 反查域名 | 站长工具/微步在线/crt.sh 同 IP 查询 |
| C 段查询 | 同网段存活主机扫描 | nmap -sn 扫描 /24 网段 |

### 维度三：域名信息
| 检查项 | 工具/方法 | 说明 |
|--------|----------|------|
| WHOIS 注册信息 | `python_execute` + whois API/命令 | 注册人/注册商/NS 服务器/注册日期/到期日期 |
| ICP 备案信息 | 工信部备案查询 API | 仅中国大陆域名需查，境外域名无备案 |
| 子域名发现 | crt.sh + 爆破 + 搜索引擎 + DNS 区域传送 | 多方法交叉验证，确保覆盖全面 |
| DNS 记录全量 | `python_execute` + dnspython/socket | A/CNAME/MX/TXT/NS/SPF/SOA 全量查询 |
| 证书透明度日志 | crt.sh / Censys / certspotter | 发现历史证书、子域名、关联域名 |

### 维度四：人员信息 ⚡ 条件触发
**⚠️ 此维度仅在以下条件之一满足时才执行：**
- 用户命令中明确提及"社会工程/社工/人员信息/作者追踪/人物画像"等
- 目标网站有明确作者信息（meta author、about 页面、联系方式）

**不应该做社工的情况**：普通企业官网无个人作者 / 用户只要求"扫描目标" / 目标是 IP/内网地址

| 追踪方向 | 方法 | 说明 |
|----------|------|------|
| 作者标识提取 | 页面 meta author、about 页面 | 用户名、昵称、邮箱 |
| GitHub 追踪 | `fetch` + GitHub API | 仓库、语言偏好、贡献记录、邮箱 |
| 社交媒体 | 从页面提取链接 → 访问 | B站、微博、知乎、Twitter、LinkedIn |
| 跨平台关联 | 用用户名/邮箱搜索其他平台 | 相同 ID 跨平台搜索 |
| 历史提交 | GitHub commits → 提交邮箱 | 关联其他项目和身份 |
| 泄露检测 | GitHub 历史代码搜索 | .env、config、密钥泄露 |

## First-Pass 工作流

1. **访问目标** → `fetch` 获取首页，提取 HTTP 头 + HTML 内容
2. **维度一：服务器信息** → 端口扫描、真实 IP、OS 指纹、中间件/数据库识别
3. **维度二：网站信息** → Web 指纹、WAF 检测、敏感目录/源码泄露、旁站/C段
4. **维度三：域名信息** → WHOIS、ICP 备案、子域名、DNS 记录、证书透明度
5. **维度四（条件触发）** → 提取作者信息、跨平台追踪、信息汇总
6. **维度完成度自检** → 确认每个维度至少做过一轮检查
7. **汇总报告** → 生成 Markdown 格式侦察报告

## 场景路由

| 场景 | 参考文档 | 核心内容 |
|------|---------|---------|
| 服务器信息收集 | `server-recon.md` | 端口扫描、真实 IP、OS 指纹、中间件/数据库识别 |
| 网站信息收集 | `website-recon.md` | 架构/指纹/WAF/敏感目录/源码泄露/旁站/C段 |
| Web 指纹识别 | `web-fingerprinting.md` | 框架检测、版本识别、技术栈推断 |
| 作者追踪方法 | `author-tracking.md` | 从页面提取作者 → 跨平台追踪 → 信息汇总 |
| OSINT 工具使用 | `osint-toolkit.md` | crt.sh、GitHub API、搜索引擎 dork、旁站/C段/ICP |
| 社会工程信息汇总 | `social-engineering-intel.md` | 人物画像、关系网络、信息交叉验证 |
| 侦察报告模板 | `recon-report-template.md` | 标准 Markdown 报告格式（四维度） |

## ⭐ 常用提取代码片段

### 从 HTML 提取所有外部链接
```python
import re
html = "..."  # fetch 获取的 HTML
links = re.findall(r'href=["\'](https?://[^"\']+)["\']', html)
for link in set(links):
    print(link)
```

### 从 HTML 提取作者信息
```python
import re
# meta author
author = re.findall(r'<meta\s+name=["\']author["\']\s+content=["\']([^"\']+)["\']', html)
# about 页面链接
about_links = re.findall(r'href=["\']([^"\']*(?:about|me|contact)[^"\']*)["\']', html, re.I)
```

### 查询 crt.sh 子域名
```python
import requests
domain = "example.com"
r = requests.get(f"https://crt.sh/?q=%.{domain}&output=json")
if r.status_code == 200:
    for entry in r.json():
        print(entry['name_value'])
```

### GitHub 用户信息
```python
import requests
username = "target_user"
r = requests.get(f"https://api.github.com/users/{username}")
if r.status_code == 200:
    data = r.json()
    print(f"Name: {data.get('name')}")
    print(f"Bio: {data.get('bio')}")
    print(f"Email: {data.get('email')}")
    print(f"Blog: {data.get('blog')}")
    print(f"Location: {data.get('location')}")
    print(f"Company: {data.get('company')}")
```

### WAF 检测（响应特征法）
```python
import requests
url = "https://target.com"
# 正常请求
r1 = requests.get(url)
# 触发 WAF 的请求（带攻击特征）
r2 = requests.get(url + "/?id=1' OR 1=1--")
# 对比响应
if r1.status_code != r2.status_code or len(r1.text) != len(r2.text):
    print("[!] 可能存在 WAF")
    print(f"正常状态码: {r1.status_code}, 攻击状态码: {r2.status_code}")
```

### 旁站查询（同 IP 反查域名）
```python
import requests
ip = "1.2.3.4"
# 使用 chinaz API 或其他反查接口
# 也可以通过 crt.sh 查询同 IP 的证书
r = requests.get(f"https://crt.sh/?q={ip}&output=json")
```

---

## 附：高价值探测弹药库（Claude-OSINT offensive-osint 精华）

> 对每个存活 Web 应用都跑一遍，便宜且高信号。

### A. API 文档发现路径

**Swagger / OpenAPI**（无鉴权可达 = HIGH）：
```
swagger.json  swagger.yaml  swagger/v1/swagger.json  swagger-ui.html  swagger-ui/
api-docs  api-docs.json  api/swagger  api/swagger.json  api/swagger-ui.html
v2/api-docs  v3/api-docs  openapi.json  openapi.yaml  docs  redoc
api/docs  api/documentation  .well-known/openapi
```

**GraphQL**（introspection 无鉴权返回 schema = HIGH）：
```
graphql  graphiql  api/graphql  v1/graphql  gql  altair  playground
api/query  graphql/console  api/v1/graphql
```
标准 introspection POST body：
```json
{"operationName":"IntrospectionQuery","query":"query IntrospectionQuery { __schema { types { name kind fields { name } } } }"}
```
注意：即使 introspection 被禁，field-suggestion（"did you mean"）也可反推部分 schema。

### B. 常开高危路径检查（15 个必查）

| 路径 | 发现 | 严重度 | 判定 |
|------|------|--------|------|
| `/.git/config` | Git 仓库泄露 | CRITICAL | 响应含 `[core]` / `repositoryformatversion` |
| `/.git/HEAD` | Git HEAD 泄露 | HIGH | 响应匹配 `^ref:\s` |
| `/.env` | 环境变量泄露 | CRITICAL | 多行匹配 `^\s*[A-Z_][A-Z0-9_]*\s*=` |
| `/server-status` | Apache 状态页 | MEDIUM | 含 `Apache Server Status` |
| `/phpinfo.php`、`/info.php` | phpinfo 泄露 | HIGH | 含 `PHP Version` |
| `/actuator/env` | Spring Boot env | CRITICAL | 含 `propertySources` |
| `/actuator/heapdump` | Spring Boot 堆转储 | CRITICAL | HPROF 魔数 / 大二进制下载 |
| `/_cat/indices` | ES 未授权 | HIGH | 返回索引列表 |
| `/manager/html` | Tomcat 管理页 | HIGH | 含 `Tomcat Web Application Manager` |
| `/.DS_Store` | macOS 元文件 | LOW | 字节签名 `\x00\x00\x00\x01Bud1` |

### C. JS 端点提取（三级正则）

对每个 JS 文件和 sourcemap 按序执行：

**Tier 1 — 通用引号路径**（高召回， downstream 过滤）：
```regex
['"](/[A-Za-z0-9_\-./{}\[\]?=&%:]+)['"`]
```

**Tier 2 — API 特征路径**（在 Tier 1 结果上过滤）：
```regex
['"`](/(?:api|graphql|gql|v\d+|swagger|openapi|rest|services|internal|admin|auth|oauth|user|users|account|accounts|search|export|upload|file|files|download|webhook|hooks|callback)/[A-Za-z0-9_\-./{}\[\]?=&%:]+)['"`]
```

**Tier 3 — 全限定 URL**：
```regex
\bhttps?://[A-Za-z0-9.\-]+\.[A-Za-z]{2,}(?::\d+)?[/A-Za-z0-9_\-./{}\[\]?=&%:#]*
```

去重键：`(method, 归一化路径模板)`，模板把 `/123/` 替换为 `/{id}/`。

### D. 子域名接管指纹（CNAME 目标 + 可接管响应特征）

| 服务商 | CNAME 模式 | 接管特征响应 |
|--------|-----------|-------------|
| GitHub Pages | `*.github.io` | `There isn't a GitHub Pages site here.` |
| Heroku | `*.herokuapp.com` | `No such app` |
| AWS S3 | `*.s3*.amazonaws.com` | `NoSuchBucket` |
| AWS CloudFront | `*.cloudfront.net` | `Bad request` + X-Amz 错误头 |
| Azure | `*.azurewebsites.net` / `*.blob.core.windows.net` | 各产品 404 特征 |
| Shopify | `shops.myshopify.com` | `Sorry, this shop is currently unavailable.` |
| WordPress | `*.wordpress.com` | `Do you want to register *.wordpress.com?` |
| Tumblr | `*.tumblr.com` | `Whatever you were looking for doesn't currently exist.` |

### E. 云存储桶排列

前缀：`(空)`、`backup-`、`assets-`、`static-`、`dev-`、`prod-`
后缀：`(空)`、`-backup`、`-assets`、`-static`、`-dev`、`-prod`、`-bak`、`-old`
组合 `{前缀}{域名关键词}{后缀}` 逐一探测，记录可列举（listable）的桶。
