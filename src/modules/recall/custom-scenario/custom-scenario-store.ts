import { App, normalizePath, TFile } from "obsidian";
import {
  CustomScenario,
  CustomFieldDef,
  RecallCard,
  CustomCardMetadata,
} from "../../../core/types";
import {
  FILE_CUSTOM_SCENARIOS,
  CUSTOM_SCENARIO_TEMPLATES,
} from "../../../core/constants";
import { generateUID, nowISOString, vaultSave } from "../../../core/utils";
import { SRSEngine } from "../core/srs-engine";

/**
 * 自定义场景存储
 *
 * 数据：_system/recall/custom-scenarios.json
 * 卡片：_system/recall/cards/custom/{scenarioId}/{cardId}.json (沿用 RecallCardStore)
 */
export class CustomScenarioStore {
  private cache: Map<string, CustomScenario> = new Map();
  private loaded = false;
  private srsEngine: SRSEngine;

  constructor(
    private app: App,
    private getBaseFolder: () => string,
  ) {
    this.srsEngine = new SRSEngine("sm2");
  }

  private path(rel: string): string {
    return normalizePath(`${this.getBaseFolder()}/${rel}`);
  }

  // ════════════════════════════════════════════════════════════
  // 初始化
  // ════════════════════════════════════════════════════════════
  async initialize(): Promise<void> {
    await this.loadAll();
  }

  // ════════════════════════════════════════════════════════════
  // CRUD
  // ════════════════════════════════════════════════════════════
  async loadAll(): Promise<CustomScenario[]> {
    const filePath = this.path(FILE_CUSTOM_SCENARIOS);
    const f = this.app.vault.getAbstractFileByPath(filePath);

    this.cache.clear();

    if (f instanceof TFile) {
      try {
        const content = await this.app.vault.read(f);
        const list = JSON.parse(content) as CustomScenario[];
        for (const sc of list) {
          if (sc.id && sc.name) {
            this.cache.set(sc.id, sc);
          }
        }
      } catch {
        // 损坏，忽略
      }
    }

    this.loaded = true;
    return Array.from(this.cache.values());
  }

  async getAll(): Promise<CustomScenario[]> {
    if (!this.loaded) await this.loadAll();
    return Array.from(this.cache.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  async getById(id: string): Promise<CustomScenario | null> {
    if (!this.loaded) await this.loadAll();
    return this.cache.get(id) ?? null;
  }

  async create(partial: Partial<CustomScenario>): Promise<CustomScenario> {
    const id = `custom_${generateUID()}`;
    const sc: CustomScenario = {
      id,
      name: partial.name ?? "未命名场景",
      description: partial.description ?? "",
      cover: partial.cover ?? "🎲",
      fields: partial.fields ?? [],
      frontTemplate: partial.frontTemplate ?? "",
      backTemplate: partial.backTemplate ?? "",
      hintsTemplate: partial.hintsTemplate,
      aiEnabled: partial.aiEnabled ?? false,
      aiSystemPrompt: partial.aiSystemPrompt,
      aiUserPromptTemplate: partial.aiUserPromptTemplate,
      tags: partial.tags ?? [],
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };

    this.cache.set(id, sc);
    await this.persist();
    return sc;
  }

  async update(sc: CustomScenario): Promise<void> {
    sc.updatedAt = nowISOString();
    this.cache.set(sc.id, sc);
    await this.persist();
  }

  async delete(id: string): Promise<void> {
    this.cache.delete(id);
    await this.persist();
  }

  async createFromTemplate(presetKey: string): Promise<CustomScenario> {
    const tpl = CUSTOM_SCENARIO_TEMPLATES.find((t) => t.presetKey === presetKey);
    if (!tpl) throw new Error(`模板不存在：${presetKey}`);

    return await this.create({
      name: tpl.name,
      description: tpl.description,
      cover: tpl.cover,
      fields: tpl.fields ? JSON.parse(JSON.stringify(tpl.fields)) : [],
      frontTemplate: tpl.frontTemplate,
      backTemplate: tpl.backTemplate,
      hintsTemplate: tpl.hintsTemplate,
      aiEnabled: tpl.aiEnabled ?? false,
      aiSystemPrompt: tpl.aiSystemPrompt,
      aiUserPromptTemplate: tpl.aiUserPromptTemplate,
      tags: tpl.tags ?? [],
    });
  }

  // ════════════════════════════════════════════════════════════
  // 持久化
  // ════════════════════════════════════════════════════════════
  private async persist(): Promise<void> {
    const filePath = this.path(FILE_CUSTOM_SCENARIOS);
    await this.ensureFolder(this.path("_系统数据/复习"));
    const content = JSON.stringify(Array.from(this.cache.values()), null, 2);
    await vaultSave(this.app, filePath, content);
  }

  // ════════════════════════════════════════════════════════════
  // 模板渲染：从字段值生成卡片
  // ════════════════════════════════════════════════════════════
  /**
   * 根据场景定义 + 字段值，生成一张 RecallCard
   */
  buildCard(scenario: CustomScenario, fieldValues: Record<string, any>): RecallCard {
    const id = `custom_${scenario.id}_${generateUID()}`;

    const front = this.renderTemplate(scenario.frontTemplate, fieldValues);
    const back = this.renderTemplate(scenario.backTemplate, fieldValues);
    const hints = scenario.hintsTemplate
      ? [this.renderTemplate(scenario.hintsTemplate, fieldValues)].filter(Boolean)
      : [];

    const meta: CustomCardMetadata = {
      scenarioId: scenario.id,
      fieldValues,
    };

    return {
      id,
      scenario: "custom" as any,
      front,
      back,
      hints,
      examples: [],
      metadata: meta,
      sourcePath: undefined,
      sourceSection: `${scenario.cover ?? "🎲"} ${scenario.name}`,
      srs: this.srsEngine.createInitialSRS(),
      stats: {
        totalReviews: 0,
        correctCount: 0,
        wrongCount: 0,
        avgResponseTimeMs: 0,
        streak: 0,
      },
      tags: ["custom", scenario.id, ...(scenario.tags ?? [])].filter(Boolean),
      status: "new",
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };
  }

  /**
   * 模板渲染：替换 {{key}} 占位符
   * 支持 {{key.slice(0,3)}} 等简单方法调用
   */
  renderTemplate(template: string, values: Record<string, any>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
      try {
        const trimmed = expr.trim();

        // 支持简单方法调用：{{key.slice(0,1)}}
        const methodMatch = trimmed.match(/^(\w+)\.(\w+)\(([^)]*)\)$/);
        if (methodMatch) {
          const [, key, method, argsStr] = methodMatch;
          const val = String(values[key] ?? "");
          if (method === "slice") {
            const args = argsStr.split(",").map((a) => parseInt(a.trim()));
            return val.slice(args[0] ?? 0, args[1]);
          }
          if (method === "toUpperCase") return val.toUpperCase();
          if (method === "toLowerCase") return val.toLowerCase();
          return val;
        }

        // 普通字段
        const val = values[trimmed];
        if (val === undefined || val === null) return "";
        if (Array.isArray(val)) return val.join(", ");
        return String(val);
      } catch {
        return "";
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  // 字段验证
  // ════════════════════════════════════════════════════════════
  validateFieldValues(
    scenario: CustomScenario,
    values: Record<string, any>,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const field of scenario.fields) {
      if (field.required) {
        const val = values[field.key];
        if (val === undefined || val === null || String(val).trim() === "") {
          errors.push(`字段「${field.label}」必填`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ════════════════════════════════════════════════════════════
  // 工具
  // ════════════════════════════════════════════════════════════
  invalidateCache() {
    this.cache.clear();
    this.loaded = false;
  }

  private async ensureFolder(p: string) {
    const path = normalizePath(p);
    if (await this.app.vault.adapter.exists(path)) return;
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(cur))) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (e: any) {
          if (!e?.message?.includes?.("already exists")) throw e;
        }
      }
    }
  }
}