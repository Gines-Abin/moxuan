// 生成历史的本地用量聚合，用于展示 Token 趋势与模型分布。
import type { GenerationRecord } from '../models';
import { localDayKey } from './stats';

export interface UsageDayBucket {
  day: string;
  label: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageModelBucket {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageSummary {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  days: UsageDayBucket[];
  models: UsageModelBucket[];
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** 汇总最近 N 个自然日的生成记录；缺失日期补零，日期按本地时区计算。 */
export function summarizeUsage(
  records: GenerationRecord[],
  options: { days?: number; today?: Date } = {},
): UsageSummary {
  const days = Math.max(1, Math.floor(options.days ?? 7));
  const today = startOfDay(options.today ?? new Date());
  const start = new Date(today);
  start.setDate(start.getDate() - days + 1);

  const dayBuckets = new Map<string, UsageDayBucket>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const key = localDayKey(date);
    dayBuckets.set(key, {
      day: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  }

  const startKey = localDayKey(start);
  const endKey = localDayKey(today);
  const modelBuckets = new Map<string, UsageModelBucket>();
  const summary: UsageSummary = {
    calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, days: [], models: [],
  };

  for (const record of records) {
    const dayKey = localDayKey(record.createdAt);
    if (!dayKey || dayKey < startKey || dayKey > endKey) continue;
    const day = dayBuckets.get(dayKey);
    if (!day) continue;

    const promptTokens = Math.max(0, record.promptTokens ?? 0);
    const completionTokens = Math.max(0, record.completionTokens ?? 0);
    const totalTokens = promptTokens + completionTokens;
    const modelName = record.model?.trim() || '未知模型';

    day.calls += 1;
    day.promptTokens += promptTokens;
    day.completionTokens += completionTokens;
    day.totalTokens += totalTokens;

    const model = modelBuckets.get(modelName) ?? {
      model: modelName, calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0,
    };
    model.calls += 1;
    model.promptTokens += promptTokens;
    model.completionTokens += completionTokens;
    model.totalTokens += totalTokens;
    modelBuckets.set(modelName, model);

    summary.calls += 1;
    summary.promptTokens += promptTokens;
    summary.completionTokens += completionTokens;
    summary.totalTokens += totalTokens;
  }

  summary.days = [...dayBuckets.values()];
  summary.models = [...modelBuckets.values()].sort((left, right) => (
    right.totalTokens - left.totalTokens || left.model.localeCompare(right.model, 'zh-CN')
  ));
  return summary;
}
