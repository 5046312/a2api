import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';

const modelCostSettingsKey = 'modelCostDefaults';

export type ModelCostItem = {
  model: string;
  unitCost: number | null;
};

export type ModelCostGroup = {
  provider: string;
  label: string;
  models: ModelCostItem[];
};

export type ModelCostDefaults = {
  currency: 'USD';
  groups: ModelCostGroup[];
};

export const modelCostItemSchema = z.object({
  model: z.string().trim().min(1),
  unitCost: z.number().min(0).nullable().optional()
});

export const modelCostGroupSchema = z.object({
  provider: z.string().trim().min(1),
  label: z.string().trim().min(1),
  models: z.array(modelCostItemSchema).default([])
});

export const modelCostDefaultsPayloadSchema = z.object({
  groups: z.array(modelCostGroupSchema).default([])
});

type ModelCostGroupInput = z.infer<typeof modelCostGroupSchema>;

// 默认目录来自 sub2api 模型白名单和本地价格快照；价格缺失时保留空值，避免编造成本。
const defaultModelCostGroups: ModelCostGroup[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    models: [
      { model: 'codex-auto-review', unitCost: 17.5 },
      { model: 'gpt-4.1', unitCost: 5 },
      { model: 'gpt-4o', unitCost: 6.25 },
      { model: 'gpt-4o-audio-preview', unitCost: 6.25 },
      { model: 'gpt-4o-mini', unitCost: 0.375 },
      { model: 'gpt-4o-realtime-preview', unitCost: 12.5 },
      { model: 'gpt-5.3-codex', unitCost: 7.875 },
      { model: 'gpt-5.3-codex-spark', unitCost: 7.875 },
      { model: 'gpt-5.4', unitCost: 8.75 },
      { model: 'gpt-5.4-2026-03-05', unitCost: 8.75 },
      { model: 'gpt-5.4-mini', unitCost: 2.625 },
      { model: 'gpt-5.5', unitCost: 17.5 },
      { model: 'gpt-5.2', unitCost: 7.875 },
      { model: 'gpt-5.2-2025-12-11', unitCost: 7.875 },
      { model: 'gpt-5.2-chat-latest', unitCost: 7.875 },
      { model: 'gpt-5.2-pro', unitCost: 94.5 },
      { model: 'gpt-5.2-pro-2025-12-11', unitCost: 94.5 },
      { model: 'gpt-image-1', unitCost: null },
      { model: 'gpt-image-1.5', unitCost: 7.5 },
      { model: 'gpt-image-2', unitCost: 7.5 },
      { model: 'o1', unitCost: null },
      { model: 'o3', unitCost: 5 }
    ]
  },
  {
    provider: 'claude',
    label: 'Claude',
    models: [
      { model: 'claude-3-5-haiku-20241022', unitCost: null },
      { model: 'claude-3-5-sonnet-20240620', unitCost: null },
      { model: 'claude-3-5-sonnet-20241022', unitCost: null },
      { model: 'claude-3-7-sonnet-20250219', unitCost: 9 },
      { model: 'claude-fable-5', unitCost: null },
      { model: 'claude-haiku-4-5', unitCost: 3 },
      { model: 'claude-haiku-4-5-20251001', unitCost: 3 },
      { model: 'claude-opus-4-20250514', unitCost: 45 },
      { model: 'claude-opus-4-1-20250805', unitCost: 45 },
      { model: 'claude-opus-4-5-20251101', unitCost: 15 },
      { model: 'claude-opus-4-8', unitCost: 15 },
      { model: 'claude-opus-4-7', unitCost: 15 },
      { model: 'claude-opus-4-6', unitCost: 15 },
      { model: 'claude-sonnet-4-20250514', unitCost: 9 },
      { model: 'claude-sonnet-4-5', unitCost: 9 },
      { model: 'claude-sonnet-4-5-20250929', unitCost: 9 },
      { model: 'claude-sonnet-4-6', unitCost: 9 }
    ]
  },
  {
    provider: 'gemini',
    label: 'Gemini',
    models: [
      { model: 'gemini-2.0-flash', unitCost: 0.25 },
      { model: 'gemini-2.5-flash', unitCost: 1.4 },
      { model: 'gemini-2.5-flash-image', unitCost: 1.4 },
      { model: 'gemini-2.5-flash-lite', unitCost: 0.25 },
      { model: 'gemini-2.5-pro', unitCost: 5.625 },
      { model: 'gemini-3.1-flash-image', unitCost: 1.75 },
      { model: 'gemini-3.1-pro-high', unitCost: 7 },
      { model: 'gemini-3.1-pro-low', unitCost: 7 },
      { model: 'gemini-3-flash', unitCost: 1.75 },
      { model: 'gemini-3-flash-preview', unitCost: 1.75 },
      { model: 'gemini-3-pro-preview', unitCost: 7 },
      { model: 'gemini-3.5-flash', unitCost: 5.25 }
    ]
  }
];

export function listModelCostDefaults(): ModelCostDefaults {
  const row = db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, modelCostSettingsKey))
    .get();
  if (!row?.value) return defaultModelCostDefaultsSnapshot();

  try {
    const parsed = modelCostDefaultsPayloadSchema.safeParse(JSON.parse(row.value) as unknown);
    if (!parsed.success) return defaultModelCostDefaultsSnapshot();
    return { currency: 'USD', groups: normalizeModelCostGroups(parsed.data.groups) };
  } catch {
    return defaultModelCostDefaultsSnapshot();
  }
}

export function updateModelCostDefaults(groups: ModelCostGroupInput[]): ModelCostDefaults {
  const normalized = normalizeModelCostGroups(groups);
  db.insert(schema.settings)
    .values({ key: modelCostSettingsKey, value: JSON.stringify({ groups: normalized }) })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: JSON.stringify({ groups: normalized }) }
    })
    .run();
  return { currency: 'USD', groups: normalized };
}

export function getDefaultModelCostMap(): Map<string, number | null> {
  const costMap = new Map<string, number | null>();
  for (const group of listModelCostDefaults().groups) {
    for (const item of group.models) {
      costMap.set(item.model.toLowerCase(), item.unitCost);
    }
  }
  return costMap;
}

function defaultModelCostDefaultsSnapshot(): ModelCostDefaults {
  return { currency: 'USD', groups: normalizeModelCostGroups(defaultModelCostGroups) };
}

function normalizeModelCostGroups(groups: ModelCostGroupInput[]): ModelCostGroup[] {
  return groups
    .map((group) => {
      const modelsByName = new Map<string, ModelCostItem>();
      for (const item of group.models) {
        const model = item.model.trim();
        if (!model) continue;
        modelsByName.set(model.toLowerCase(), {
          model,
          unitCost: normalizeUnitCost(item.unitCost)
        });
      }
      return {
        provider: group.provider.trim(),
        label: group.label.trim(),
        models: Array.from(modelsByName.values()).sort((left, right) => left.model.localeCompare(right.model))
      };
    })
    .filter((group) => group.provider && group.label);
}

function normalizeUnitCost(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}
