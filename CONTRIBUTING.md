# 参与贡献 / Contributing

欢迎提问题、提修复、提建议。先说清项目边界与开发口径：

- 本仓库已升级为完整可用的**紫微斗数排盘引擎 + 商业化后端基础设施**：
  - 核心排盘与确定性分析位于 `lib/ziwei/`（真太阳时、海外/俄/独联体城市与 IANA 历史时区、`i18n.ts` 三语字典、`db-analysis.ts` 零 LLM 免费 `命宫` 解读、`paywall-teasers.ts` 付费钩子、`heming.ts` 确定性合盘、`chart-analyzer.ts` 缓存键与痛点提取，已移除 `patterns.ts` / `famous.ts` 的 `server-only` 并清理全部非商用 `CC BY-NC-SA 4.0` 运行时文本）。
  - 后端路线与存储基础设施位于 `app/api/`、`lib/server/` 与 `db/schema.sql`，提供 `/api/health`、零 LLM `/api/chart`、完整支付闭环 `/api/billing/{checkout,order,webhook}`、`ALLOWED_ORIGINS` CORS 跨域支持、以及支持 `'ru' | 'zh' | 'en'` 与 `AI_PAYWALL_MODE=strict` 守卫的 `/api/interpret` 和 `/api/heming` SSE 接口（详见 [API 文档](./docs/API.md)）。
- **仍然不在开源范围内的部分**：线上专有的 13 主题完整商业断语库（`lib/ziwei/db-analysis.ts` 中的 `STAR_DB` 保持置空占位）、商业版完整前端界面、真实商户支付密钥与线上用户体系。

## 提问题

- **怎么用、想交流**：去 [讨论区](https://github.com/Magnifico4625/ziwei-doushu/discussions)（或上游讨论区 [Renhuai123/ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu/discussions)）。
- **觉得盘排得不对**：用「排盘结果疑问」模板，附上公历出生日期、几点几分、出生地或经度、性别、本项目的结果，以及你拿来对照的结果。只写「不准」无法定位。
  - 辅星亮度、闰月归属、晚子时是否换日，各流派本来就不同，引擎里做成了可切换的口径；这类差异不算 bug，但欢迎指出。
- **程序报错、页面异常**：用「程序问题」模板，写清复现步骤和报错。

请不要在 issue 里贴手机号、验证码、私钥或未经本人同意的他人生辰信息。

## 提交代码

```bash
npm ci               # 按 package-lock.json 安装
npm run typecheck    # TypeScript 全量严格检查
npm test             # 运行全部 20 条回归测试（含三语 i18n / 支付闭环 / 商用合规 / 排盘精度）
npm run build        # Next.js 生产构建验证
```

- 一个 PR 只做一件事，说明里写清改了什么、为什么。
- **改排盘口径或后端协议的**：附上依据并在 `scripts/regression/` 增补回归测试、登记到 `package.json` 的 `test` 脚本；涉及 API 变更请同步更新 [`docs/API.md`](./docs/API.md)。
- **商用合规红线**：不得向 `lib/ziwei/*`、`lib/server/*` 或 `app/api/*` 引入 `CC BY-NC-SA 4.0` 原话引文（`ni_quote` / `docs/tianji-ziwei/`）、`server-only` 或任何 `: any` 类型；提交前确保无真实密钥进入仓库。

## 许可

提交即表示你同意贡献内容按对应协议发布：

- 代码（`lib/`、`app/`、`components/`、`db/`，运行时零 `CC BY-NC-SA 4.0` 文本）：[MIT](./LICENSE)
- 样本数据集：[CC BY 4.0](./DATASET-LICENSE)
- 独立语料归档目录 `docs/tianji-ziwei/`：[CC BY-NC-SA 4.0](./docs/tianji-ziwei/LICENSE.md)，不许商用

---

**English.** Issues and PRs are welcome.

- **Scope:** This repository now ships both the headless Zi Wei Dou Shu charting & analysis engine (`lib/ziwei/` — including true solar time, historical IANA/DST city zones, `ru`/`zh`/`en` localization in `i18n.ts`, Zero-LLM `命宫` free tier in `db-analysis.ts`, `paywall-teasers.ts`, deterministic synastry in `heming.ts`, and `server-only`-free modules) and the full Next.js backend infrastructure (`app/api/`, `lib/server/`, `db/schema.sql`: `/api/health`, Zero-LLM `/api/chart`, `/api/billing/{checkout,order,webhook}`, `ALLOWED_ORIGINS` CORS, and paywall-guarded multilingual SSE `/api/interpret` & `/api/heming` endpoints; see [`docs/API.md`](./docs/API.md)).
- **Excluded by design:** Only the proprietary 13-topic bulk interpretation database (`STAR_DB` in `lib/ziwei/db-analysis.ts` remains intentionally empty), production commercial frontend UI, merchant secrets, and user account data stay outside this repo.
- **Submitting PRs:** Run `npm ci`, `npm run typecheck`, `npm test` (20 suites), and `npm run build` before opening a PR. Keep runtime code strictly typed (zero `any`), free of `CC BY-NC-SA 4.0` lecture quotes (`docs/tianji-ziwei/` / `ni_quote`), and free of real credentials. Chart rule or API changes must include regression tests under `scripts/regression/` and keep [`docs/API.md`](./docs/API.md) accurate.
