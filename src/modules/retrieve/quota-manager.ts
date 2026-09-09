import { App, normalizePath, TFile } from "obsidian";
import { FILE_QUOTA, DIR_SYSTEM } from "../../core/constants";
import { QuotaState } from "../../core/types";
import { vaultSave } from "../../core/utils";
import { TokenEstimator } from "./token-estimator";

export class QuotaManager {
  private state: QuotaState | null = null;

  constructor(
    private app: App,
    private getBaseFolder: () => string,
    private getDailyLimit: () => number,
  ) {}

  private path(rel: string): string {
    return normalizePath(`${this.getBaseFolder()}/${rel}`);
  }

  async load(): Promise<QuotaState> {
    if (this.state) return this.state;

    const f = this.app.vault.getAbstractFileByPath(this.path(FILE_QUOTA));
    if (f instanceof TFile) {
      try {
        const content = await this.app.vault.read(f);
        this.state = JSON.parse(content);
        this.checkDailyReset();
        return this.state!;
      } catch {
        // 解析失败，重置
      }
    }

    this.state = this.defaultState();
    await this.save();
    return this.state;
  }

  // ✅ 关键修复：公开的获取当前状态方法
  async getCurrentState(): Promise<QuotaState> {
    return await this.load();
  }

  async save(): Promise<void> {
    if (!this.state) return;
    await this.ensureFolder(this.path(DIR_SYSTEM));
    const content = JSON.stringify(this.state, null, 2);
    const path = this.path(FILE_QUOTA);
    await vaultSave(this.app, path, content);
  }

  /** 检查并执行跨日重置 */
  private checkDailyReset() {
    if (!this.state) return;
    const today = new Date().toISOString().substring(0, 10);
    if (this.state.lastResetDate !== today) {
      if (this.state.todayUsedTokens > 0) {
        this.state.history.unshift({
          date: this.state.lastResetDate,
          tokens: this.state.todayUsedTokens,
          costCny: this.state.todayUsedCostCny,
        });
        this.state.history = this.state.history.slice(0, 30);
      }
      this.state.todayUsedTokens = 0;
      this.state.todayUsedCostCny = 0;
      this.state.lastResetDate = today;
    }
  }

  private HIGH_USE_THRESHOLD = 0.8; // 80%使用量时警告

  /** 检查是否能消费 tokens（不实际消费）*/
  async canConsume(tokens: number): Promise<{ allowed: boolean; reason?: string; remaining: number }> {
    const s = await this.load();
    const limit = this.getDailyLimit();

    if (limit <= 0) {
      return { allowed: true, remaining: Infinity };
    }
    
    const remaining = limit - s.todayUsedTokens;
    
    // 检查单次操作是否超过每日限额的一半（防止一次性用完所有配额）
    const maxSingleOperation = limit * 0.5;
    if (tokens > maxSingleOperation) {
      return {
        allowed: false,
        reason: `单次操作超出限额 ${TokenEstimator.formatTokens(Math.round(maxSingleOperation))}，本次需 ${TokenEstimator.formatTokens(tokens)}。可调整「每日 Token 上限」或分批操作。`,
        remaining,
      };
    }

    if (tokens > remaining) {
      return {
        allowed: false,
        reason: `配额不足：今日剩余 ${TokenEstimator.formatTokens(remaining)}，本次需 ${TokenEstimator.formatTokens(tokens)}`,
        remaining,
      };
    }

    // 检查是否接近限额
    const usageRatio = (s.todayUsedTokens + tokens) / limit;
    if (usageRatio > this.HIGH_USE_THRESHOLD) {
      // 虽然允许，但可以记录警告
      console.warn(`⚠️ 配额使用量已接近 ${Math.round(usageRatio * 100)}%`);
    }

    return { allowed: true, remaining };
  }

  /** 实际消费 tokens */
  async consume(tokens: number, costCny: number): Promise<void> {
    const s = await this.load();
    s.todayUsedTokens += tokens;
    s.todayUsedCostCny += costCny;
    s.dailyLimitTokens = this.getDailyLimit();
    await this.save();
  }

  async getStatus(): Promise<{
    used: number;
    limit: number;
    remaining: number;
    cost: number;
    pct: number;
  }> {
    const s = await this.load();
    const limit = this.getDailyLimit();
    const remaining = limit > 0 ? Math.max(0, limit - s.todayUsedTokens) : Infinity;
    const pct = limit > 0 ? (s.todayUsedTokens / limit) * 100 : 0;
    return {
      used: s.todayUsedTokens,
      limit,
      remaining,
      cost: s.todayUsedCostCny,
      pct,
    };
  }

  async getHistory(): Promise<Array<{ date: string; tokens: number; costCny: number }>> {
    const s = await this.load();
    return [...s.history];
  }

  async reset(): Promise<void> {
    this.state = this.defaultState();
    await this.save();
  }

  private defaultState(): QuotaState {
    return {
      dailyLimitTokens: this.getDailyLimit(),
      todayUsedTokens: 0,
      todayUsedCostCny: 0,
      history: [],
      lastResetDate: new Date().toISOString().substring(0, 10),
    };
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