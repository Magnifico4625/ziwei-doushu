/**
 * Regression suite verifying:
 * 1. Per-call `brightnessSchool` isolation in `generateChart` (concurrent/alternating QS vs XD2 without mutating global state).
 * 2. Cache/pair key school isolation (`cacheKey` / `pairKey`) paired with school-agnostic `entitlementKey` / `canonicalPairEntitlementKey`.
 * 3. Helper propagation (`analyzeChartSummary`, `generateFreeLifePalaceReading`, `analyzeSynastry`, `buildChartPromptPayload`, `detectPatterns`).
 * 4. Explicit `referenceDate` / `referenceYear` support for deterministic active DaXian computation.
 * 5. Calibration & calendar policy parity across the 3 reference 1990 charts from the v4.0-13d pilot (including known `split` `isLeapMonth: false` quirk on 1990-07-21).
 * 6. HTTP validation, cache isolation (`QS` vs `XD2`), and cross-school billing entitlement on `POST /api/chart`, `/api/billing/checkout`, `/api/billing/webhook`, and `/api/interpret`.
 */

import assert from 'node:assert/strict';
import { POST as billingCheckoutPOST } from '../../app/api/billing/checkout/route';
import { POST as chartPOST } from '../../app/api/chart/route';
import { POST as interpretPOST } from '../../app/api/interpret/route';
import { POST as webhookPOST } from '../../app/api/billing/webhook/route';
import {
  DATASET_BRIGHTNESS_SCHOOL,
  DATASET_LEAP_MONTH_POLICY,
  generateChart,
  generateDatasetChart,
  setBrightnessSchool,
} from '../../lib/ziwei/algorithm';
import {
  analyzeChartSummary,
  buildChartPromptPayload,
  getChartCacheKey,
  getChartEntitlementKey,
  normalizeEntitlementKey,
} from '../../lib/ziwei/chart-analyzer';
import { BRANCHES } from '../../lib/ziwei/constants';
import { generateFreeLifePalaceReading } from '../../lib/ziwei/db-analysis';
import { analyzeSynastry } from '../../lib/ziwei/heming';
import { resetServerConfigForTests } from '../../lib/server/env';
import { signWebhookSignature } from '../../lib/server/access-token';
import { resetInMemoryDbForTests } from '../../lib/server/db';
import {
  canonicalPairEntitlementKey,
  canonicalPairKey,
  resetMemoryCacheForTests,
} from '../../lib/server/cache';
import { setLlmStreamAdapterForTests } from '../../lib/server/llm';
import { resetMemoryRateLimiterForTests } from '../../lib/server/rate-limit';
import { formToBirthInfo } from '../../lib/ziwei/share';
import type { BirthInfo, ZiweiChart } from '../../lib/ziwei/types';

function makeJsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function findStarInPalace(chart: ZiweiChart, palaceName: string, starName: string) {
  const palace = chart.palaces.find((p) => p.name === palaceName);
  assert.ok(palace, `Palace ${palaceName} must exist`);
  const star = palace.stars.find((s) => s.name === starName);
  assert.ok(star, `Star ${starName} must exist in ${palaceName}`);
  return star;
}

async function main(): Promise<void> {
  // ── 1) Per-call brightnessSchool isolation (no global cross-talk) ─────────
  setBrightnessSchool('ZZ');
  try {
    const birth1990Jan1: BirthInfo = { year: 1990, month: 1, day: 1, hour: 0, gender: 'male' };

    // Interleaved / Promise.all generation of QS vs XD2 even while global is ZZ
    const [chartQs, chartXd2, chartDefault, chartXd2Second] = await Promise.all([
      Promise.resolve().then(() => generateChart(birth1990Jan1, { brightnessSchool: 'QS' })),
      Promise.resolve().then(() => generateChart(birth1990Jan1, { brightnessSchool: 'XD2' })),
      Promise.resolve().then(() => generateChart(birth1990Jan1, { brightnessSchool: 'default' })),
      Promise.resolve().then(() => generateDatasetChart(birth1990Jan1)),
    ]);

    assert.equal(chartQs.brightnessSchool, 'QS');
    assert.equal(chartDefault.brightnessSchool, 'QS');
    assert.equal(chartXd2.brightnessSchool, 'XD2');
    assert.equal(chartXd2Second.brightnessSchool, 'XD2');
    assert.equal(chartQs.leapMonthPolicy, 'split');
    assert.equal(chartXd2.leapMonthPolicy, DATASET_LEAP_MONTH_POLICY);

    // Ensure global ZZ was NOT read when explicit school was passed, AND was NOT mutated
    const chartGlobalZz = generateChart(birth1990Jan1);
    assert.equal(chartGlobalZz.brightnessSchool, 'ZZ');

    // Cache keys isolate the per-call school while entitlement keys remain school-agnostic
    assert.equal(getChartCacheKey(chartQs), 'ziwei:v1:1990-01-01:0:male:default:split');
    assert.equal(getChartCacheKey(chartDefault), 'ziwei:v1:1990-01-01:0:male:default:split');
    assert.equal(getChartCacheKey(chartXd2), 'ziwei:v1:1990-01-01:0:male:XD2:split');
    assert.equal(getChartEntitlementKey(chartQs), 'ziwei:v1:1990-01-01:0:male:default:split');
    assert.equal(getChartEntitlementKey(chartXd2), 'ziwei:v1:1990-01-01:0:male:default:split');
    assert.equal(
      normalizeEntitlementKey('ziwei:v1:1990-01-01:0:male:XD2:split:y2026'),
      'ziwei:v1:1990-01-01:0:male:default:split',
    );
    assert.notEqual(
      normalizeEntitlementKey('ziwei:v1:1990-01-01:0:male:XD2:split:other'),
      'ziwei:v1:1990-01-01:0:male:default:split',
    );
    assert.notEqual(getChartCacheKey(chartQs), getChartCacheKey(chartXd2));

    // Verify XD2 vs QS brightness differences on real stars of 1990-01-01-0-male
    assert.equal(findStarInPalace(chartXd2, '父母', '太阴').brightnessRaw, '陷');
    assert.equal(findStarInPalace(chartQs, '父母', '太阴').brightnessRaw, '旺');
    assert.equal(findStarInPalace(chartXd2, '福德', '贪狼').brightnessRaw, '旺');
    assert.equal(findStarInPalace(chartQs, '福德', '贪狼').brightnessRaw, '利');
    assert.equal(findStarInPalace(chartXd2, '迁移', '廉贞').brightnessRaw, '庙');
    assert.equal(findStarInPalace(chartQs, '迁移', '廉贞').brightnessRaw, '利');

    // Downstream helpers inherit per-call chart brightness & school keys
    const summaryXd2 = analyzeChartSummary(chartXd2);
    const summaryQs = analyzeChartSummary(chartQs);
    assert.equal(summaryXd2.cacheKey, 'ziwei:v1:1990-01-01:0:male:XD2:split');
    assert.equal(summaryQs.cacheKey, 'ziwei:v1:1990-01-01:0:male:default:split');

    const promptXd2 = buildChartPromptPayload(chartXd2);
    assert.ok(promptXd2.palaces.some((p) => p.name === '父母' && p.stars.some((s) => s.includes('太阴(陷)'))));
    const promptQs = buildChartPromptPayload(chartQs);
    assert.ok(promptQs.palaces.some((p) => p.name === '父母' && p.stars.some((s) => s.includes('太阴(旺)'))));

    const female1990: BirthInfo = { year: 1990, month: 1, day: 26, hour: 6, gender: 'female' };
    const femaleXd2 = generateDatasetChart(female1990);
    const femaleQs = generateChart(female1990, { brightnessSchool: 'QS' });
    const pairXd2 = canonicalPairKey(chartXd2, femaleXd2, 2026);
    const pairQs = canonicalPairKey(chartQs, femaleQs, 2026);
    assert.notEqual(pairXd2, pairQs);
    assert.equal(
      canonicalPairEntitlementKey(chartXd2, femaleXd2),
      canonicalPairEntitlementKey(chartQs, femaleQs),
    );
    const synXd2 = analyzeSynastry(chartXd2, femaleXd2, { targetYear: 2026 });
    assert.ok(synXd2.score >= 0 && synXd2.score <= 100);
  } finally {
    setBrightnessSchool('default');
  }

  // ── 2) Deterministic referenceDate / referenceYear for DaXian ────────────
  {
    const birth: BirthInfo = { year: 1990, month: 1, day: 1, hour: 0, gender: 'male' };
    const chart2020 = generateDatasetChart(birth, { referenceDate: '2020-06-15' });
    const chart2026 = generateDatasetChart(birth, { referenceYear: 2026 });
    const chart2031 = generateDatasetChart(birth, { referenceDate: '2031-06-15' });

    assert.equal(chart2020.currentAge, 32);
    assert.equal(chart2020.daXians[chart2020.currentDaXianIndex]?.palaceName, '子女');
    assert.equal(chart2026.currentAge, 38);
    assert.equal(chart2026.daXians[chart2026.currentDaXianIndex]?.palaceName, '子女');
    assert.equal(chart2031.currentAge, 43);
    assert.equal(chart2031.daXians[chart2031.currentDaXianIndex]?.palaceName, '财帛');
  }

  // ── 3) Calibration across all 3 pilot 1990 charts & leap-month policy ─────
  {
    assert.equal(DATASET_BRIGHTNESS_SCHOOL, 'XD2');
    assert.equal(DATASET_LEAP_MONTH_POLICY, 'split');

    // Sample A: 1990-01-01-0-male (pinned with explicit referenceYear so active DaXian is deterministic)
    const c1 = generateDatasetChart(
      { year: 1990, month: 1, day: 1, hour: 0, gender: 'male' },
      { referenceYear: 2026 },
    );
    assert.equal(c1.currentAge, 38);
    assert.equal(c1.daXians[c1.currentDaXianIndex]?.palaceName, '子女');
    assert.equal(BRANCHES[c1.mingGongBranch], '丑');
    assert.equal(BRANCHES[c1.shenGongBranch], '丑');
    assert.equal(c1.wuxingJuName, '水二局');
    assert.equal(c1.mingZhu, '巨门');
    assert.equal(c1.shenZhu, '天机');
    assert.deepEqual(c1.lunarInfo.fourPillars, ['己巳', '丙子', '丙寅', '戊子']);
    assert.equal(findStarInPalace(c1, '命宫', '天府').brightnessRaw, '庙');
    assert.equal(findStarInPalace(c1, '夫妻', '武曲').siHua, '禄');
    assert.equal(findStarInPalace(c1, '福德', '贪狼').siHua, '权');
    assert.equal(findStarInPalace(c1, '仆役', '天梁').siHua, '科');
    assert.equal(findStarInPalace(c1, '田宅', '文曲').siHua, '忌');

    // Sample B: 1990-01-26-6-female
    const c2 = generateDatasetChart(
      { year: 1990, month: 1, day: 26, hour: 6, gender: 'female' },
      { referenceYear: 2026 },
    );
    assert.equal(BRANCHES[c2.mingGongBranch], '未');
    assert.equal(BRANCHES[c2.shenGongBranch], '未');
    assert.equal(c2.wuxingJuName, '土五局');
    assert.equal(findStarInPalace(c2, '命宫', '紫微').brightnessRaw, '庙');
    assert.equal(findStarInPalace(c2, '命宫', '破军').brightnessRaw, '庙');
    assert.equal(findStarInPalace(c2, '官禄', '廉贞').brightnessRaw, '陷');
    assert.equal(findStarInPalace(c2, '官禄', '贪狼').brightnessRaw, '陷');
    assert.equal(c2.palaces.find((p) => p.name === '夫妻')?.isEmpty, true);
    assert.deepEqual(c2.palaces.find((p) => p.name === '夫妻')?.borrowedStars, ['廉贞', '贪狼']);

    // Sample C: 1990-07-21-11-male (last day of 1990 leap 5th month)
    // Known pilot split quirk: split (day > 15) advances effective month to 6 and reports
    // isLeapMonth: false, yet produces the exact empty 命宫[申] + 禄存 + 擎羊/陀罗 flanking
    // documented in v4.0-13d; origin-month keeps isLeapMonth: true and moves 命宫 to [未].
    const c3Split = generateDatasetChart(
      { year: 1990, month: 7, day: 21, hour: 11, gender: 'male' },
      { referenceYear: 2026 },
    );
    const c3Next = generateChart(
      { year: 1990, month: 7, day: 21, hour: 11, gender: 'male' },
      { brightnessSchool: 'XD2', leapMonth: 'next-month', referenceYear: 2026 },
    );
    const c3Origin = generateChart(
      { year: 1990, month: 7, day: 21, hour: 11, gender: 'male' },
      { brightnessSchool: 'XD2', leapMonth: 'origin-month', referenceYear: 2026 },
    );
    assert.equal(c3Split.lunarInfo.lunarMonth, 6);
    assert.equal(c3Split.lunarInfo.lunarDay, 29);
    assert.equal(c3Split.lunarInfo.isLeapMonth, false);
    assert.equal(BRANCHES[c3Split.mingGongBranch], '申');
    assert.equal(c3Split.palaces.find((p) => p.name === '命宫')?.isEmpty, true);
    assert.equal(findStarInPalace(c3Split, '命宫', '禄存').name, '禄存');
    assert.equal(BRANCHES[c3Split.palaces.find((p) => p.name === '父母')?.branch ?? -1], '酉');
    assert.equal(findStarInPalace(c3Split, '父母', '擎羊').name, '擎羊');
    assert.equal(BRANCHES[c3Split.palaces.find((p) => p.name === '兄弟')?.branch ?? -1], '未');
    assert.equal(findStarInPalace(c3Split, '兄弟', '陀罗').name, '陀罗');
    assert.equal(c3Split.mingGongBranch, c3Next.mingGongBranch);

    assert.equal(c3Origin.lunarInfo.isLeapMonth, true);
    assert.equal(BRANCHES[c3Origin.mingGongBranch], '未');
    assert.equal(c3Origin.palaces.find((p) => p.name === '命宫')?.isEmpty, false);

    // Late-Zi (23:xx) civil clock rule maps to next solarDate + hour 0, preserving calendar alignment
    const lateZiBirth = formToBirthInfo({
      name: 'Test',
      year: '1989',
      month: '12',
      day: '31',
      clockHour: '23',
      clockMinute: '30',
      unknownTime: false,
      province: '',
      city: '',
      longitude: 120,
      gender: 'male',
    });
    assert.deepEqual(
      { year: lateZiBirth.year, month: lateZiBirth.month, day: lateZiBirth.day, hour: lateZiBirth.hour },
      { year: 1990, month: 1, day: 1, hour: 0 },
    );
    const c1FromLateZi = generateDatasetChart(lateZiBirth, { referenceYear: 2026 });
    assert.equal(getChartCacheKey(c1FromLateZi), getChartCacheKey(c1));

    // Verify Free Life Palace helper reacts to different star brightnesses from XD2 vs QS
    const emptyMingBirth: BirthInfo = { year: 1990, month: 5, day: 15, hour: 4, gender: 'male' };
    const freeReadingXd2 = generateFreeLifePalaceReading(
      generateDatasetChart(emptyMingBirth),
      'ru',
    );
    assert.equal(freeReadingXd2.lang, 'ru');
    assert.ok(freeReadingXd2.paragraphs.length >= 2);
  }

  // ── 4) HTTP POST /api/chart & /api/interpret school validation + isolation ─
  const prevSecret = process.env.ACCESS_TOKEN_SECRET;
  const prevWebhook = process.env.PAYWALL_WEBHOOK_SECRET;
  const prevPaywall = process.env.AI_PAYWALL_MODE;
  const prevDb = process.env.DATABASE_URL;
  const prevRedis = process.env.REDIS_URL;
  const prevProvider = process.env.AI_PROVIDER;
  const prevDeepseekKey = process.env.DEEPSEEK_API_KEY;

  process.env.ACCESS_TOKEN_SECRET = 'dataset-school-access-secret-32bytes';
  process.env.PAYWALL_WEBHOOK_SECRET = 'dataset-school-webhook-secret-32bytes';
  process.env.AI_PAYWALL_MODE = 'strict';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'dataset-school-deepseek-placeholder';
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;
  resetServerConfigForTests();
  resetInMemoryDbForTests();
  resetMemoryCacheForTests();
  resetMemoryRateLimiterForTests();

  try {
    const birth = { year: 1990, month: 1, day: 1, hour: 0, gender: 'male' as const };

    // Reject invalid brightnessSchool / leapMonthPolicy / referenceDate -> 400
    for (const badBody of [
      { birthInfo: birth, brightnessSchool: 'INVALID_SCHOOL' },
      { birthInfo: birth, leapMonthPolicy: 'bad-policy' },
      { birthInfo: birth, referenceDate: '2026-02-30' },
      { birthInfo: birth, referenceYear: 99 },
    ]) {
      const res = await chartPOST(makeJsonRequest('http://localhost/api/chart', badBody));
      assert.equal(res.status, 400, `Expected 400 for ${JSON.stringify(badBody)}`);
    }

    // Parallel POST /api/chart calls: default(QS) vs XD2 never pollute each other
    const [resDefault, resXd2] = await Promise.all([
      chartPOST(
        makeJsonRequest('http://localhost/api/chart', {
          birthInfo: birth,
          lang: 'ru',
          referenceDate: '2031-06-15',
        }),
      ),
      chartPOST(
        makeJsonRequest('http://localhost/api/chart', {
          birthInfo: birth,
          lang: 'ru',
          brightnessSchool: 'XD2',
          referenceDate: '2031-06-15',
        }),
      ),
    ]);

    assert.equal(resDefault.status, 200);
    assert.equal(resXd2.status, 200);

    const jsonDefault = (await resDefault.json()) as {
      brightnessSchool: string;
      leapMonthPolicy: string;
      cacheKey: string;
      entitlementKey: string;
      chart: ZiweiChart;
    };
    const jsonXd2 = (await resXd2.json()) as {
      brightnessSchool: string;
      leapMonthPolicy: string;
      cacheKey: string;
      entitlementKey: string;
      chart: ZiweiChart;
    };

    assert.equal(jsonDefault.brightnessSchool, 'QS');
    assert.equal(jsonDefault.chart.brightnessSchool, 'QS');
    assert.equal(jsonDefault.cacheKey, 'ziwei:v1:1990-01-01:0:male:default:split');
    assert.equal(jsonDefault.entitlementKey, 'ziwei:v1:1990-01-01:0:male:default:split');
    assert.equal(jsonDefault.chart.currentAge, 43);

    assert.equal(jsonXd2.brightnessSchool, 'XD2');
    assert.equal(jsonXd2.chart.brightnessSchool, 'XD2');
    assert.equal(jsonXd2.cacheKey, 'ziwei:v1:1990-01-01:0:male:XD2:split');
    // Entitlement stays school-agnostic so switching schools never triggers 402
    assert.equal(jsonXd2.entitlementKey, 'ziwei:v1:1990-01-01:0:male:default:split');
    assert.equal(jsonXd2.chart.currentAge, 43);
    assert.equal(findStarInPalace(jsonXd2.chart, '父母', '太阴').brightnessRaw, '陷');
    assert.equal(findStarInPalace(jsonDefault.chart, '父母', '太阴').brightnessRaw, '旺');

    // Checkout even with an :XD2: cacheKey normalizes entitlementKey to :default:
    const checkoutRes = await billingCheckoutPOST(
      makeJsonRequest('http://localhost/api/billing/checkout', {
        scope: 'interpret',
        targetKey: `${jsonXd2.cacheKey}:y2026`,
        amountMinor: 1000,
        currency: 'RUB',
      }),
    );
    assert.equal(checkoutRes.status, 201);
    const checkoutJson = (await checkoutRes.json()) as { orderId: string; targetKey: string };
    assert.equal(checkoutJson.targetKey, 'ziwei:v1:1990-01-01:0:male:default:split');

    const whBody = JSON.stringify({
      eventId: 'evt-school-agnostic-1',
      orderId: checkoutJson.orderId,
      scope: 'interpret',
      targetKey: jsonDefault.entitlementKey,
      amountMinor: 1000,
      status: 'paid',
    });
    const whRes = await webhookPOST(
      new Request('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': `sha256=${signWebhookSignature(whBody, process.env.PAYWALL_WEBHOOK_SECRET)}`,
        },
        body: whBody,
      }),
    );
    assert.equal(whRes.status, 200);
    const { accessToken } = (await whRes.json()) as { accessToken: string };

    let llmCalls = 0;
    setLlmStreamAdapterForTests(async function* () {
      llmCalls += 1;
      yield `STREAM-CALL-${llmCalls}`;
    });

    const interpretMessages = [{ role: 'user', content: 'Разбор карты' }];

    // Same accessToken unlocks BOTH default(QS) and XD2 without 402
    const qsRes1 = await interpretPOST(
      makeJsonRequest(
        'http://localhost/api/interpret',
        { chart: jsonDefault.chart, messages: interpretMessages, lang: 'ru' },
        { Authorization: `Bearer ${accessToken}` },
      ),
    );
    assert.equal(qsRes1.status, 200);
    assert.equal(qsRes1.headers.get('x-cache'), 'MISS');
    const qsBody1 = await qsRes1.text();
    assert.ok(qsBody1.includes('STREAM-CALL-1'));

    // Switching to XD2 must NOT read/overwrite QS cache; it stays authorized (200) and misses into :XD2: cache
    const xd2Res1 = await interpretPOST(
      makeJsonRequest(
        'http://localhost/api/interpret',
        { chart: jsonXd2.chart, messages: interpretMessages, lang: 'ru' },
        { Authorization: `Bearer ${accessToken}` },
      ),
    );
    assert.equal(xd2Res1.status, 200);
    assert.equal(xd2Res1.headers.get('x-cache'), 'MISS');
    const xd2Body1 = await xd2Res1.text();
    assert.ok(xd2Body1.includes('STREAM-CALL-2'));

    // Re-querying QS still hits its own isolated QS cache
    const qsRes2 = await interpretPOST(
      makeJsonRequest(
        'http://localhost/api/interpret',
        { chart: jsonDefault.chart, messages: interpretMessages, lang: 'ru' },
        { Authorization: `Bearer ${accessToken}` },
      ),
    );
    assert.equal(qsRes2.status, 200);
    assert.equal(qsRes2.headers.get('x-cache'), 'HIT');
    const qsBody2 = await qsRes2.text();
    assert.ok(qsBody2.includes('STREAM-CALL-1'));
    assert.ok(!qsBody2.includes('STREAM-CALL-2'));

    // Re-querying XD2 hits its own isolated XD2 cache
    const xd2Res2 = await interpretPOST(
      makeJsonRequest(
        'http://localhost/api/interpret',
        { chart: jsonXd2.chart, messages: interpretMessages, lang: 'ru' },
        { Authorization: `Bearer ${accessToken}` },
      ),
    );
    assert.equal(xd2Res2.status, 200);
    assert.equal(xd2Res2.headers.get('x-cache'), 'HIT');
    const xd2Body2 = await xd2Res2.text();
    assert.ok(xd2Body2.includes('STREAM-CALL-2'));
    assert.equal(llmCalls, 2);
  } finally {
    setLlmStreamAdapterForTests(null);
    process.env.ACCESS_TOKEN_SECRET = prevSecret;
    process.env.PAYWALL_WEBHOOK_SECRET = prevWebhook;
    process.env.AI_PAYWALL_MODE = prevPaywall;
    if (prevProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = prevProvider;
    if (prevDeepseekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevDeepseekKey;
    if (prevDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
    resetServerConfigForTests();
  }

  console.log('✅ Per-call brightnessSchool (XD2/QS), referenceDate DaXian, and 1990 dataset calibration regression passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
