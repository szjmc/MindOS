import { App, normalizePath, TFile, TFolder } from "obsidian";
import { JDAnalysis } from "../../../core/types";
import { DIR_RECALL_INTERVIEW } from "../../../core/constants";
import { generateUID, nowISOString, vaultSave } from "../../../core/utils";

/**
 * 面试 JD 分析存储管理
 *
 * 存储路径：_system/recall/interview/jd-{id}.json
 */
export class InterviewStore {
  private cache: Map<string, JDAnalysis> = new Map();
  private loaded = false;

  constructor(
    private app: App,
    private getBaseFolder: () => string,
  ) {}

  private path(rel: string): string {
    return normalizePath(`${this.getBaseFolder()}/${rel}`);
  }

  async initialize(): Promise<void> {
    await this.ensureFolder(this.path(DIR_RECALL_INTERVIEW));
    await this.loadAll();
  }

  // ════════════════════════════════════════════════════════════
  // CRUD
  // ════════════════════════════════════════════════════════════
  async loadAll(): Promise<JDAnalysis[]> {
    const folderPath = this.path(DIR_RECALL_INTERVIEW);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    this.cache.clear();

    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "json" && child.name.startsWith("jd-")) {
          try {
            const content = await this.app.vault.read(child);
            const jd = JSON.parse(content) as JDAnalysis;
            if (jd.id && jd.position) {
              this.cache.set(jd.id, jd);
            }
          } catch {
            // 跳过损坏文件
          }
        }
      }
    }

    this.loaded = true;
    return Array.from(this.cache.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async getAll(): Promise<JDAnalysis[]> {
    if (!this.loaded) await this.loadAll();
    return Array.from(this.cache.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async getById(id: string): Promise<JDAnalysis | null> {
    if (!this.loaded) await this.loadAll();
    return this.cache.get(id) ?? null;
  }

  async create(partial: Partial<JDAnalysis>): Promise<JDAnalysis> {
    const id = `jd_${generateUID()}`;
    const jd: JDAnalysis = {
      id,
      position: partial.position ?? "未命名职位",
      company: partial.company,
      level: partial.level,
      location: partial.location,
      salary: partial.salary,
      rawText: partial.rawText ?? "",
      description: partial.description ?? "",
      responsibilities: partial.responsibilities ?? [],
      requirements: partial.requirements ?? [],
      skills: partial.skills ?? [],
      niceToHave: partial.niceToHave ?? [],
      gapAnalysis: partial.gapAnalysis,
      questions: partial.questions ?? [],
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };

    await this.save(jd);
    return jd;
  }

  async save(jd: JDAnalysis): Promise<void> {
    jd.updatedAt = nowISOString();
    this.cache.set(jd.id, jd);

    const filePath = this.path(`${DIR_RECALL_INTERVIEW}/${jd.id}.json`);
    const content = JSON.stringify(jd, null, 2);
    await vaultSave(this.app, filePath, content);
  }

  async delete(id: string): Promise<void> {
    const jd = this.cache.get(id);
    if (!jd) return;

    this.cache.delete(id);

    const filePath = this.path(`${DIR_RECALL_INTERVIEW}/${id}.json`);
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) {
      await this.app.vault.delete(f);
    }
  }

  async rename(id: string, newPosition: string): Promise<void> {
    const jd = await this.getById(id);
    if (!jd) return;
    jd.position = newPosition.trim() || "未命名职位";
    await this.save(jd);
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