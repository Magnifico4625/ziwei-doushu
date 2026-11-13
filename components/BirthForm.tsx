'use client';
import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BirthInfo } from '@/lib/ziwei/types';
import { daysInGregorianMonth, isValidGregorianDate } from '@/lib/ziwei/gregorian-date';
import { SHICHEN } from '@/lib/ziwei/constants';
import {
  BIRTH_FORM_YEAR_MAX,
  BIRTH_FORM_YEAR_MIN,
  chinaDstNoteForForm,
  formToBirthInfo,
  lateZiNoteForChart,
  resolveFormTimeZone,
  resolveFormTrueSolarTime,
  resolveFormUtcOffsetMinutes,
  subtractOneClockHour,
} from '@/lib/ziwei/share';
import {
  classifyZoneLocalTime,
  DEFAULT_UTC_OFFSET_MINUTES,
  formatUtcOffsetLabel,
  standardMeridianDegrees,
  type ZoneLocalTimeKind,
} from '@/lib/ziwei/true-solar-time';
import { useTheme } from '@/components/ThemeProvider';
import { PROVINCES } from '@/lib/ziwei/cities';

export interface BirthFormState {
  name: string;
  year: string;
  month: string;
  day: string;
  clockHour: string;
  clockMinute: string;
  unknownTime: boolean;
  province: string;
  city: string;
  longitude: number;
  utcOffsetMinutes?: number;
  timeZone?: string;
  gender: 'male' | 'female';
}

interface BirthFormProps {
  onSubmit: (info: BirthInfo) => void;
  loading?: boolean;
  initialData?: Partial<BirthFormState>;
  onFormSave?: (data: BirthFormState) => void;
  /** 隐藏内部「立即起盘」按钮（合盘等场景由父级统一触发） */
  hideSubmit?: boolean;
}

const SHICHEN_NAMES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

const UTC_OFFSET_OPTIONS: readonly number[] = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -270, -240, -210, -180, -120, -60,
  0,
  60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840,
];

/** 检查公历日期是否真实存在（不用 Date 顺延结果）。 */
function isValidDate(y: number, m: number, d: number): boolean {
  return isValidGregorianDate(y, m, d);
}

/** 时区切换日的非拦截提示。偏移规则见 `resolveTimeZoneOffsetMinutes`。 */
function zoneTransitionHint(kind: ZoneLocalTimeKind | undefined): string {
  switch (kind) {
    case undefined:
    case 'regular':
      return '';
    case 'gap':
      return '该时刻在此时区不存在（夏令时拨快会跳过这一小时），不拦截起盘。';
    case 'overlap':
      return '该时刻在此时区出现了两次（夏令时拨回），不拦截起盘。';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** 下拉框里只放这个公历月真正有的日子。年份未选时，2 月最多到 29，绝不到 30。 */
function selectableDayCount(year: number, month: number): number {
  if (month === 2 && !year) return 29;
  if (year && month >= 1 && month <= 12) return daysInGregorianMonth(year, month);
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

export default function BirthForm({ onSubmit, loading, initialData, onFormSave, hideSubmit }: BirthFormProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [form, setForm] = useState<BirthFormState>({
    name: initialData?.name ?? '',
    year: initialData?.year ?? '',
    month: initialData?.month ?? '',
    day: initialData?.day ?? '',
    clockHour: initialData?.clockHour ?? '8',
    clockMinute: initialData?.clockMinute ?? '0',
    unknownTime: initialData?.unknownTime ?? false,
    province: initialData?.province ?? '',
    city: initialData?.city ?? '',
    longitude: initialData?.longitude ?? 120,
    utcOffsetMinutes: initialData?.utcOffsetMinutes,
    timeZone: initialData?.timeZone,
    gender: initialData?.gender ?? 'male',
  });

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // 切换日提示依赖 Intl，服务端 ICU 与浏览器可能不一致。水合完成后再显示，避免文本对不上。
  const [zoneHintMounted, setZoneHintMounted] = useState(false);

  // 表单状态变化时实时同步给父级（合盘等场景下父级靠这个收集双方数据）
  useEffect(() => {
    onFormSave?.({ ...form });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  useEffect(() => {
    setZoneHintMounted(true);
  }, []);

  const cityList = useMemo(() => {
    const prov = PROVINCES.find(p => p.name === form.province);
    return prov ? prov.cities : [];
  }, [form.province]);

  const solarPreview = useMemo(() => {
    if (form.unknownTime) return null;
    return resolveFormTrueSolarTime(form);
  }, [form]);

  const branch = solarPreview ? solarPreview.branch : 0;
  const resolvedTzId = resolveFormTimeZone(form);
  const tzOffsetMin = solarPreview
    ? solarPreview.utcOffsetMinutes
    : (resolveFormUtcOffsetMinutes(form) ?? DEFAULT_UTC_OFFSET_MINUTES);
  const standardMeridian = standardMeridianDegrees(tzOffsetMin);
  const offsetMin = solarPreview
    ? Math.round(solarPreview.totalCorrectionMinutes)
    : Math.round((form.longitude - standardMeridian) * 4);
  const longitudeLabel = form.longitude >= 0
    ? `经度 ${form.longitude.toFixed(1)}°E`
    : `经度 ${Math.abs(form.longitude).toFixed(1)}°W`;
  const tzLabel = tzOffsetMin !== DEFAULT_UTC_OFFSET_MINUTES || resolvedTzId
    ? ` · ${formatUtcOffsetLabel(tzOffsetMin)}`
    : '';
  const selectedTzValue = form.utcOffsetMinutes !== undefined && (!resolvedTzId || form.timeZone === '')
    ? String(form.utcOffsetMinutes)
    : '';
  const shichenInfo = SHICHEN[branch];

  // ─── 校验逻辑 ─────────────────────────────────────────
  const y = parseInt(form.year) || 0;
  const m = parseInt(form.month) || 0;
  const d = parseInt(form.day) || 0;

  const errors = {
    year: !form.year ? '请选择出生年份'
      : y < BIRTH_FORM_YEAR_MIN || y > BIRTH_FORM_YEAR_MAX ? `年份范围：${BIRTH_FORM_YEAR_MIN}–${BIRTH_FORM_YEAR_MAX}`
      : '',
    month: !form.month ? '请选择月份' : '',
    day: !form.day ? '请选择日期'
      : form.year && form.month && !isValidDate(y, m, d) ? `${m}月没有${d}日`
      : '',
  };
  const hasError = Object.values(errors).some(Boolean);

  // ─── 完成度（用于进度条） ────────────────────────────
  const steps = [
    !!form.year && !!form.month && !!form.day && !errors.year && !errors.month && !errors.day,
    !!form.province && !!form.city,
    form.unknownTime || (!!form.clockHour && !!form.clockMinute),
    true, // 性别有默认值
  ];
  const completedSteps = steps.filter(Boolean).length;

  // ─── Summary chip：全部必填完成后显示 ───────────────────
  const showSummary = steps[0] && steps[2] && !hasError;
  const lateZiNote = showSummary ? lateZiNoteForChart(formToBirthInfo(form)) : '';
  const chinaDstNote = !hasError ? chinaDstNoteForForm(form) : '';
  const clockHourNum = parseInt(form.clockHour, 10) || 0;
  const clockMinuteNum = parseInt(form.clockMinute, 10) || 0;
  const zoneLocalKind = !form.unknownTime && resolvedTzId && isValidDate(y, m, d)
    ? classifyZoneLocalTime(resolvedTzId, y, m, d, clockHourNum, clockMinuteNum)
    : undefined;
  const zoneTransitionNote = zoneHintMounted ? zoneTransitionHint(zoneLocalKind) : '';
  const dstSubtractBlocked = Boolean(chinaDstNote)
    && y === BIRTH_FORM_YEAR_MIN
    && m === 1
    && d === 1
    && clockHourNum === 0;
  const summaryText = showSummary
    ? [
        `${y}年${m}月${d}日`,
        form.city || (form.province ? form.province : ''),
        form.unknownTime ? '时辰不详' : `${SHICHEN_NAMES[branch]}时`,
        form.gender === 'male' ? '男' : '女',
      ].filter(Boolean).join(' · ')
    : '';

  const handleProvince = (prov: string) => {
    const provData = PROVINCES.find(p => p.name === prov);
    const firstCity = provData?.cities[0];
    setForm({
      ...form,
      province: prov,
      city: firstCity?.name || '',
      longitude: firstCity?.longitude ?? standardMeridianDegrees(DEFAULT_UTC_OFFSET_MINUTES),
      utcOffsetMinutes: undefined,
      timeZone: firstCity?.timeZone,
    });
  };

  const handleCity = (cityName: string) => {
    const prov = PROVINCES.find(p => p.name === form.province);
    const cityData = prov?.cities.find(c => c.name === cityName);
    setForm({
      ...form,
      city: cityName,
      longitude: cityData?.longitude ?? standardMeridianDegrees(DEFAULT_UTC_OFFSET_MINUTES),
      utcOffsetMinutes: undefined,
      timeZone: cityData?.timeZone,
    });
  };

  const handleTimezoneChange = (rawValue: string) => {
    if (rawValue === '') {
      const cityData = form.province && form.city
        ? PROVINCES.find(p => p.name === form.province)?.cities.find(c => c.name === form.city)
        : undefined;
      // 回到「自动」只恢复城市时区，不改经度。手填经度只在重新选择城市时写回。
      setForm({
        ...form,
        utcOffsetMinutes: undefined,
        timeZone: cityData?.timeZone,
      });
      return;
    }
    const nextTz = parseInt(rawValue, 10);
    if (!Number.isFinite(nextTz)) return;
    const syncLongitude = !form.province && !form.city
      ? standardMeridianDegrees(nextTz)
      : form.longitude;
    setForm({
      ...form,
      utcOffsetMinutes: nextTz,
      timeZone: '',
      longitude: syncLongitude,
    });
  };

  const handleSubtractDstHour = () => {
    const next = subtractOneClockHour(y, m, d, clockHourNum);
    if (!next) return;
    const clearAutoOffset = selectedTzValue === '' ? { utcOffsetMinutes: undefined } : {};
    if (next.year === y && next.month === m && next.day === d) {
      setForm({ ...form, ...clearAutoOffset, clockHour: String(next.hour) });
      return;
    }
    setForm({
      ...form,
      ...clearAutoOffset,
      year: String(next.year),
      month: String(next.month),
      day: String(next.day),
      clockHour: String(next.hour),
    });
  };

  const updateDateTimeField = (patch: Partial<Pick<BirthFormState, 'year' | 'month' | 'day' | 'clockHour' | 'clockMinute'>>) => {
    setForm(prev => ({
      ...prev,
      ...patch,
      ...(selectedTzValue === '' ? { utcOffsetMinutes: undefined } : {}),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setTouched({ year: true, month: true, day: true });
    if (hasError) return;
    onFormSave?.({ ...form });
    // 排盘与分享链接都走 formToBirthInfo：先拒绝不存在的公历日。
    // 填了出生地或时区时按真太阳时和晚子时规则决定排盘日；没填地点时，才是钟表 23:00–23:59 进次日。
    onSubmit(formToBirthInfo(form));
  };

  // ─── 样式变量 ────────────────────────────────────────────
  const bg = isDark ? 'rgba(8,16,40,0.85)' : 'rgba(255,255,255,0.92)';
  const border = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(200,160,60,0.2)';
  // 暗色模式标签提亮：从 rgba(74,112,144,1) → rgba(180,200,225,0.9)
  const labelClr = isDark ? 'rgba(180,200,225,0.9)' : 'rgba(120,80,10,0.55)';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,252,240,0.8)';
  const inputBorder = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(200,160,60,0.25)';
  // 输入文字提亮：从 #c8d8f0 → #e8eef8
  const inputClr = isDark ? '#e8eef8' : '#2a1a00';
  const focusBorder = isDark ? 'rgba(212,168,67,0.5)' : 'rgba(180,120,20,0.5)';
  const errorClr = isDark ? '#f87171' : '#dc2626';
  const panelBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,250,235,0.7)';
  const panelBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(200,160,60,0.2)';
  const goldText = isDark ? '#d4a843' : '#7a5008';
  const summaryBg = isDark ? 'rgba(37,99,235,0.12)' : 'rgba(37,99,235,0.07)';
  const summaryBorder = isDark ? 'rgba(37,99,235,0.35)' : 'rgba(37,99,235,0.25)';
  const summaryClr = isDark ? 'rgba(147,197,253,0.9)' : 'rgba(37,99,235,0.85)';

  const inputStyle = {
    background: inputBg,
    border: `1px solid ${inputBorder}`,
    color: inputClr,
    borderRadius: '14px',
    padding: '10px 14px',
    fontSize: '13px',
    width: '100%',
    outline: 'none',
    transition: 'border-color 0.2s',
  } as React.CSSProperties;

  const errorInputStyle = { ...inputStyle, borderColor: errorClr };
  const compactLocationInputStyle = {
    ...inputStyle,
    padding: '10px 10px',
    fontSize: '12px',
    minWidth: 0,
  } as React.CSSProperties;

  function FieldError({ msg }: { msg: string }) {
    return (
      <AnimatePresence>
        {msg && (
          <motion.p
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ color: errorClr, fontSize: '11px', marginTop: '4px' }}
          >
            ✕ {msg}
          </motion.p>
        )}
      </AnimatePresence>
    );
  }

  const showErr = (field: string) => touched[field] || submitAttempted;

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{ background: bg, border: `1px solid ${border}`, borderRadius: '24px', padding: '28px clamp(12px, 3vw, 28px)', backdropFilter: 'blur(20px)', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}
    >
      {/* 标题 */}
      <h3 style={{ color: goldText, fontSize: '12px', letterSpacing: '0.4em', textAlign: 'center', marginBottom: '20px', fontWeight: 500 }}>
        ── 输入生辰八字 ──
      </h3>

      {/* ── 进度条 ── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px' }}>
        {steps.map((done, i) => (
          <motion.div
            key={i}
            animate={{ background: done ? (isDark ? '#d4a843' : '#b07820') : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(200,160,60,0.15)') }}
            transition={{ duration: 0.3 }}
            style={{ flex: 1, height: '2px', borderRadius: '2px' }}
          />
        ))}
      </div>

      {/* ── 姓名 ── */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '11px', color: labelClr, marginBottom: '6px', letterSpacing: '0.05em' }}>姓名（可选）</label>
        <input
          type="text"
          placeholder="请输入姓名"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          style={inputStyle}
          onFocus={e => { e.target.style.borderColor = focusBorder; }}
          onBlur={e => { e.target.style.borderColor = inputBorder; }}
        />
      </div>

      {/* ── 出生日期 ── */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '11px', color: labelClr, marginBottom: '6px', letterSpacing: '0.05em' }}>出生日期（公历）</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <div>
            <select
              value={form.year}
              onChange={e => { updateDateTimeField({ year: e.target.value }); setTouched(t => ({ ...t, year: true })); }}
              style={showErr('year') && errors.year ? errorInputStyle : inputStyle}
              required
            >
              <option value="">年份</option>
              {Array.from({ length: BIRTH_FORM_YEAR_MAX - BIRTH_FORM_YEAR_MIN + 1 }, (_, i) => BIRTH_FORM_YEAR_MAX - i).map(yr => (
                <option key={yr} value={String(yr)}>{yr}</option>
              ))}
            </select>
            <FieldError msg={showErr('year') ? errors.year : ''} />
          </div>
          <div>
            <select
              value={form.month}
              onChange={e => { updateDateTimeField({ month: e.target.value }); setTouched(t => ({ ...t, month: true })); }}
              style={showErr('month') && errors.month ? errorInputStyle : inputStyle}
              required
            >
              <option value="">月份</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(mo => (
                <option key={mo} value={String(mo)}>{mo} 月</option>
              ))}
            </select>
            <FieldError msg={showErr('month') ? errors.month : ''} />
          </div>
          <div>
            <select
              value={form.day}
              onChange={e => { updateDateTimeField({ day: e.target.value }); setTouched(t => ({ ...t, day: true })); }}
              style={showErr('day') && errors.day ? errorInputStyle : inputStyle}
              required
            >
              <option value="">日期</option>
              {Array.from({ length: selectableDayCount(y, m) }, (_, i) => i + 1).map(dy => (
                <option key={dy} value={String(dy)}>{dy} 日</option>
              ))}
            </select>
            <FieldError msg={showErr('day') ? errors.day : ''} />
          </div>
        </div>
      </div>

      {/* ── 出生地点 ── */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '11px', color: labelClr, marginBottom: '6px', letterSpacing: '0.05em' }}>出生地点（用于真太阳时校正）</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <select
            value={form.province}
            onChange={e => handleProvince(e.target.value)}
            style={inputStyle}
            onFocus={e => { e.target.style.borderColor = focusBorder; }}
            onBlur={e => { e.target.style.borderColor = inputBorder; }}
          >
            <option value="">省份 / 直辖市</option>
            {PROVINCES.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          <select
            value={form.city}
            onChange={e => handleCity(e.target.value)}
            disabled={!form.province}
            style={{ ...inputStyle, opacity: form.province ? 1 : 0.45 }}
            onFocus={e => { e.target.style.borderColor = focusBorder; }}
            onBlur={e => { e.target.style.borderColor = inputBorder; }}
          >
            <option value="">{form.province ? '城市' : '先选省份'}</option>
            {cityList.map(c => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: '8px', marginTop: '8px' }}>
          <select
            aria-label="出生时区"
            value={selectedTzValue}
            onChange={e => handleTimezoneChange(e.target.value)}
            style={compactLocationInputStyle}
            onFocus={e => { e.target.style.borderColor = focusBorder; }}
            onBlur={e => { e.target.style.borderColor = inputBorder; }}
          >
            <option value="">
              自动 ({formatUtcOffsetLabel(tzOffsetMin)})
            </option>
            {selectedTzValue !== '' && !UTC_OFFSET_OPTIONS.includes(Number(selectedTzValue)) && (
              <option value={selectedTzValue}>
                {formatUtcOffsetLabel(Number(selectedTzValue))}
              </option>
            )}
            {UTC_OFFSET_OPTIONS.map(mins => (
              <option key={mins} value={String(mins)}>
                {formatUtcOffsetLabel(mins)}
              </option>
            ))}
          </select>
          <input
            type="number"
            aria-label="出生地经度"
            step="0.1"
            min="-180"
            max="180"
            value={Number.isFinite(form.longitude) ? form.longitude : 120}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (Number.isFinite(val) && val >= -180 && val <= 180) {
                setForm({ ...form, longitude: val });
              }
            }}
            placeholder="经度（东正西负）"
            style={compactLocationInputStyle}
            onFocus={e => { e.target.style.borderColor = focusBorder; }}
            onBlur={e => { e.target.style.borderColor = inputBorder; }}
          />
        </div>
        <AnimatePresence mode="wait">
          {form.province || selectedTzValue !== '' || form.longitude !== DEFAULT_UTC_OFFSET_MINUTES / 4 ? (
            <motion.p
              key="location-info"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ fontSize: '10px', color: isDark ? 'rgba(180,210,235,0.85)' : 'rgba(100,70,10,0.5)', marginTop: '5px' }}
            >
              {form.city || form.province || '自定义坐标'} · {longitudeLabel}{tzLabel} · 时差 {offsetMin > 0 ? '+' : ''}{offsetMin} 分钟
            </motion.p>
          ) : (
            <motion.p
              key="location-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ fontSize: '10px', color: isDark ? 'rgba(165,185,210,0.7)' : 'rgba(140,100,20,0.45)', marginTop: '5px' }}
            >
              * 倪海厦批命用真太阳时，建议填写出生地以自动校正时辰
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ── 出生时间 ── */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '11px', color: labelClr, marginBottom: '6px', letterSpacing: '0.05em' }}>
          {tzOffsetMin !== DEFAULT_UTC_OFFSET_MINUTES
            ? `出生时间（当地时间 ${formatUtcOffsetLabel(tzOffsetMin)}）`
            : '出生时间（北京时间）'}
        </label>
        <div style={{ borderRadius: '14px', padding: '12px', background: panelBg, border: `1px solid ${panelBorder}`, opacity: form.unknownTime ? 0.45 : 1, pointerEvents: form.unknownTime ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <select
              value={form.clockHour}
              onChange={e => updateDateTimeField({ clockHour: e.target.value })}
              style={inputStyle}
            >
              {Array.from({ length: 24 }, (_, i) => i).map(h => (
                <option key={h} value={String(h)}>{h.toString().padStart(2, '0')} 时</option>
              ))}
            </select>
            <select
              value={form.clockMinute}
              onChange={e => updateDateTimeField({ clockMinute: e.target.value })}
              style={inputStyle}
            >
              {Array.from({ length: 60 }, (_, i) => i).map(min => (
                <option key={min} value={String(min)}>{min.toString().padStart(2, '0')} 分</option>
              ))}
            </select>
          </div>
          {/* 真太阳时结果 */}
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: '10px', color: isDark ? 'rgba(170,195,220,0.75)' : 'rgba(140,100,20,0.5)' }}>真太阳时 → </span>
            <span style={{ fontSize: '15px', color: goldText, fontWeight: 600, letterSpacing: '0.08em' }}>
              {SHICHEN_NAMES[branch]}时
            </span>
            {shichenInfo && (
              <span style={{ fontSize: '10px', color: isDark ? 'rgba(170,195,220,0.75)' : 'rgba(140,100,20,0.5)', marginLeft: '4px' }}>
                （{shichenInfo.range}）
              </span>
            )}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.unknownTime}
            onChange={e => setForm({ ...form, unknownTime: e.target.checked })}
            style={{ width: '14px', height: '14px', borderRadius: '4px', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '10px', color: isDark ? 'rgba(165,185,210,0.7)' : 'rgba(140,100,20,0.45)' }}>
            不知道出生时间，以子时（23:00–01:00）起盘
          </span>
        </label>
        {zoneTransitionNote && (
          <p style={{ fontSize: '10px', lineHeight: 1.5, marginTop: '6px', marginBottom: 0, color: isDark ? 'rgba(165,185,210,0.75)' : 'rgba(140,100,20,0.55)' }}>
            {zoneTransitionNote}
          </p>
        )}
        <AnimatePresence>
          {chinaDstNote && (
            <motion.div
              initial={{ opacity: 0, y: -4, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -4, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                marginTop: '8px',
                padding: '8px 12px',
                borderRadius: '12px',
                border: `1px solid ${isDark ? 'rgba(212,168,67,0.38)' : 'rgba(180,120,20,0.35)'}`,
                background: isDark ? 'rgba(212,168,67,0.08)' : 'rgba(255,248,225,0.9)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '8px',
                maxWidth: '100%',
                minWidth: 0,
              }}
            >
              <span style={{ flex: '1 1 12rem', minWidth: 0, fontSize: '11px', lineHeight: 1.5, color: goldText }}>
                ⚠ {chinaDstNote}
              </span>
              <button
                type="button"
                onClick={handleSubtractDstHour}
                disabled={dstSubtractBlocked}
                style={{
                  flex: '0 0 auto',
                  whiteSpace: 'nowrap',
                  minHeight: '44px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  border: `1px solid ${isDark ? 'rgba(212,168,67,0.5)' : 'rgba(180,120,20,0.45)'}`,
                  background: isDark ? 'rgba(212,168,67,0.16)' : 'rgba(255,238,195,0.9)',
                  color: goldText,
                  cursor: dstSubtractBlocked ? 'not-allowed' : 'pointer',
                  opacity: dstSubtractBlocked ? 0.45 : 1,
                }}
              >
                减 1 小时
              </button>
              {dstSubtractBlocked && (
                <span style={{ flex: '1 1 100%', fontSize: '11px', lineHeight: 1.5, color: goldText }}>
                  已是最早可排盘时刻（{BIRTH_FORM_YEAR_MIN}年1月1日 0时），无法再减。
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── 性别 ── */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '11px', color: labelClr, marginBottom: '6px', letterSpacing: '0.05em' }}>性别</label>
        <div style={{ display: 'flex', gap: '10px' }}>
          {(['male', 'female'] as const).map(g => {
            const active = form.gender === g;
            const isMale = g === 'male';
            const accent = isMale ? '37,99,235' : '225,29,72';
            return (
              <motion.button
                key={g}
                type="button"
                onClick={() => setForm({ ...form, gender: g })}
                whileTap={{ scale: 0.97 }}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: '14px',
                  fontSize: '13px',
                  fontWeight: 500,
                  border: `1px solid ${active ? `rgba(${accent},0.6)` : inputBorder}`,
                  background: active ? `rgba(${accent},0.08)` : inputBg,
                  color: active ? `rgba(${accent},0.9)` : (isDark ? 'rgba(190,205,225,0.7)' : 'rgba(100,80,40,0.4)'),
                  transition: 'all 0.2s',
                  cursor: 'pointer',
                }}
              >
                {isMale ? '♂ 男' : '♀ 女'}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ── 确认信息 Summary Chip ── */}
      <AnimatePresence>
        {showSummary && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto', marginBottom: 12 }}
            exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <div style={{
              background: summaryBg,
              border: `1px solid ${summaryBorder}`,
              borderRadius: '12px',
              padding: '9px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: summaryClr }}>✓</span>
                <span style={{ fontSize: '11px', color: summaryClr, letterSpacing: '0.03em', flex: 1 }}>
                  {summaryText}
                </span>
              </div>
              {lateZiNote && (
                <span style={{ fontSize: '11px', color: summaryClr, letterSpacing: '0.02em', lineHeight: 1.45, paddingLeft: '20px' }}>
                  {lateZiNote}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 提交按钮 ── */}
      {!hideSubmit && <motion.button
        type="submit"
        disabled={loading}
        whileHover={loading ? {} : { scale: 1.01 }}
        whileTap={loading ? {} : { scale: 0.98 }}
        style={{
          width: '100%',
          padding: '14px',
          borderRadius: '16px',
          fontSize: '13px',
          fontWeight: 600,
          letterSpacing: '0.15em',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          background: loading
            ? (isDark ? 'rgba(212,168,67,0.15)' : 'rgba(180,120,20,0.15)')
            : (isDark
              ? 'linear-gradient(135deg, rgba(180,130,40,0.9), rgba(240,200,80,0.9))'
              : 'linear-gradient(135deg, #9a6210, #c88020)'),
          color: loading ? (isDark ? 'rgba(212,168,67,0.4)' : 'rgba(120,80,10,0.4)') : (isDark ? '#08080a' : '#fff8e8'),
          boxShadow: loading ? 'none' : (isDark ? '0 4px 20px rgba(212,168,67,0.2)' : '0 4px 16px rgba(140,100,20,0.25)'),
          transition: 'all 0.2s',
        }}
      >
        {loading ? (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }}
            />
            紫微起盘中…
          </span>
        ) : '立即起盘 · 解命运密码'}
      </motion.button>}
    </motion.form>
  );
}
