/**
 * v3.0 样本里不存在的公历日期：审计生成网格，并清洗已下载的样本文件。
 *
 * 数据集约 33 GB，不在本仓库。不带参数时只复算发布口径的条数：
 *
 *   npx tsx scripts/dataset/clean-v3-samples.ts
 *
 * 已解开的目录或 JSONL（每行一条，含 birthInfo）可以滤掉非法公历日期。
 * 合法的 3 月 1 日、3 月 2 日会留下。农历三十和闰月不参与判断。
 *
 *   npx tsx scripts/dataset/clean-v3-samples.ts --input ./samples --output ./samples-clean
 *   npx tsx scripts/dataset/clean-v3-samples.ts --input ./samples.jsonl --output ./clean.jsonl
 *
 * 只给 --input 时统计会删多少，不写文件。
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { auditV3SampleGrid, classifyDeclaredSampleDate } from '../../lib/ziwei/sample-dates';

export interface FileCleanStats {
  before: number;
  removed: number;
  kept: number;
  unrecognized: number;
  errors: string[];
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} needs a path`);
  }
  return value;
}

function birthInfoOf(value: unknown): { year?: unknown; month?: unknown; day?: unknown } | null {
  if (!value || typeof value !== 'object' || !('birthInfo' in value)) return null;
  const info = (value as { birthInfo?: unknown }).birthInfo;
  if (!info || typeof info !== 'object') return null;
  return info as { year?: unknown; month?: unknown; day?: unknown };
}

/** JSONL 行里的 filename，和目录模式的文件名一样，只在没有公历 birthInfo 时当后备。 */
function filenameOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('filename' in value)) return undefined;
  const name = (value as { filename?: unknown }).filename;
  return typeof name === 'string' ? name : undefined;
}

async function walkJson(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walkJson(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) found.push(full);
  }
  return found;
}

function assertOutputOutsideInput(inputPath: string, outputPath: string): void {
  const rel = path.relative(path.resolve(inputPath), path.resolve(outputPath));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error('output path must be outside the input path');
  }
}

export async function cleanSampleDirectory(inputDir: string, outputDir?: string): Promise<FileCleanStats> {
  if (outputDir) assertOutputOutsideInput(inputDir, outputDir);
  const files = await walkJson(inputDir);
  const stats: FileCleanStats = { before: files.length, removed: 0, kept: 0, unrecognized: 0, errors: [] };
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      stats.errors.push(`${file}: ${(error as Error).message}`);
      continue;
    }
    const { decision } = classifyDeclaredSampleDate({
      birthInfo: birthInfoOf(parsed),
      filename: file,
    });
    if (decision === 'drop') {
      stats.removed += 1;
      continue;
    }
    if (decision === 'unrecognized') stats.unrecognized += 1;
    else stats.kept += 1;
    if (!outputDir) continue;
    const target = path.join(outputDir, path.relative(inputDir, file));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
  }
  return stats;
}

export async function cleanSampleJsonl(inputFile: string, outputFile?: string): Promise<FileCleanStats> {
  if (outputFile) assertOutputOutsideInput(inputFile, outputFile);
  const stats: FileCleanStats = { before: 0, removed: 0, kept: 0, unrecognized: 0, errors: [] };
  if (outputFile) await mkdir(path.dirname(outputFile), { recursive: true });
  const sink = outputFile ? createWriteStream(outputFile) : null;
  let pending = '';
  let lineNumber = 0;

  const takeLine = (text: string, ending: '\n' | '\r\n' | '') => {
    lineNumber += 1;
    const raw = text + ending;
    if (!text.trim()) {
      sink?.write(raw);
      return;
    }
    stats.before += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      stats.errors.push(`line ${lineNumber}: ${reason}`);
      sink?.write(raw);
      return;
    }
    const { decision } = classifyDeclaredSampleDate({
      birthInfo: birthInfoOf(parsed),
      filename: filenameOf(parsed),
    });
    if (decision === 'drop') {
      stats.removed += 1;
      return;
    }
    if (decision === 'unrecognized') stats.unrecognized += 1;
    else stats.kept += 1;
    sink?.write(raw);
  };

  const stream = createReadStream(inputFile);
  for await (const chunk of stream) {
    pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newlineAt = pending.indexOf('\n');
    while (newlineAt !== -1) {
      let text = pending.slice(0, newlineAt);
      pending = pending.slice(newlineAt + 1);
      let ending: '\n' | '\r\n' = '\n';
      if (text.endsWith('\r')) {
        text = text.slice(0, -1);
        ending = '\r\n';
      }
      takeLine(text, ending);
      newlineAt = pending.indexOf('\n');
    }
  }
  if (pending.length > 0) takeLine(pending, '');

  if (sink) {
    await new Promise<void>((resolve, reject) => {
      sink.end(() => resolve());
      sink.on('error', reject);
    });
  }
  return stats;
}

function printGrid(): void {
  const audit = auditV3SampleGrid();
  console.log(JSON.stringify({ grid: audit }));
}

async function main(): Promise<void> {
  printGrid();
  const input = readFlag('--input');
  const output = readFlag('--output');
  if (!input) return;
  const inputStat = await stat(input);
  const stats = inputStat.isDirectory()
    ? await cleanSampleDirectory(input, output)
    : await cleanSampleJsonl(input, output);
  for (const message of stats.errors) console.error(message);
  console.log(JSON.stringify({ files: stats }));
  if (stats.errors.length) process.exitCode = 1;
}

const isDirectRun = process.argv[1] != null && (
  process.argv[1].endsWith('clean-v3-samples.ts')
  || process.argv[1].endsWith('clean-v3-samples.js')
);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
