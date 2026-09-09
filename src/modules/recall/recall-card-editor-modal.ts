import { App, Modal, Notice, setIcon } from "obsidian";
import {
  RecallCard,
  RecallScenario,
  RecallCardStatus,
} from "../../core/types";
import { RecallCardStore } from "./recall-card-store";
import { SRSEngine } from "./srs-engine";
import { generateUID, nowISOString } from "../../core/utils";

export type EditorMode = "create" | "edit";

export class RecallCardEditorModal extends Modal {
  private card: RecallCard;
  private mode: EditorMode;
  private scenario: RecallScenario;
  private cardStore: RecallCardStore;
  private srsEngine: SRSEngine;
  private onSaved: (card: RecallCard) => void;

  // 表单元素
  private frontInput!: HTMLTextAreaElement;
  private backInput!: HTMLTextAreaElement;
  private hintsInput!: HTMLTextAreaElement;
  private examplesInput!: HTMLTextAreaElement;
  private tagsInput!: HTMLInputElement;
  private statusSelect!: HTMLSelectElement;

  constructor(
    app: App,
    cardStore: RecallCardStore,
    srsEngine: SRSEngine,
    options: {
      mode: EditorMode;
      scenario: RecallScenario;
      card?: RecallCard;
      onSaved: (card: RecallCard) => void;
    },
  ) {
    super(app);
    this.cardStore = cardStore;
    this.srsEngine = srsEngine;
    this.mode = options.mode;
    this.scenario = options.scenario;
    this.onSaved = options.onSaved;

    if (options.card) {
      this.card = JSON.parse(JSON.stringify(options.card));
    } else {
      this.card = this.createBlankCard();
    }
  }

  private createBlankCard(): RecallCard {
    return {
      id: `${this.scenario}_${generateUID()}`,
      scenario: this.scenario,
      front: "",
      back: "",
      hints: [],
      examples: [],
      metadata: {},
      tags: [this.scenario],
      status: "new",
      srs: this.srsEngine.createInitialSRS(),
      stats: {
        totalReviews: 0,
        correctCount: 0,
        wrongCount: 0,
        avgResponseTimeMs: 0,
        streak: 0,
      },
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-recall-editor-modal");

    // 标题
    const titleEl = contentEl.createEl("h2", {
      text: this.mode === "create" ? "✨ 新建卡片" : "✏️ 编辑卡片",
    });
    titleEl.style.marginTop = "0";

    // 场景标签
    const scenarioRow = contentEl.createDiv({ cls: "mindos-editor-scenario-row" });
    scenarioRow.createSpan({ text: "📂 场景：" });
    scenarioRow.createSpan({
      cls: "mindos-editor-scenario-tag",
      text: this.scenario,
    });

    // 表单
    const form = contentEl.createDiv({ cls: "mindos-editor-form" });

    // 正面
    this.makeField(form, "🎯 正面（问题）", true, () => {
      this.frontInput = form.createEl("textarea", { cls: "mindos-editor-textarea" });
      this.frontInput.value = this.card.front;
      this.frontInput.placeholder = "在此输入问题，支持 Markdown";
      this.frontInput.rows = 3;
      return this.frontInput;
    });

    // 背面
    this.makeField(form, "✅ 背面（答案）", true, () => {
      this.backInput = form.createEl("textarea", { cls: "mindos-editor-textarea" });
      this.backInput.value = this.card.back;
      this.backInput.placeholder = "在此输入答案，支持 Markdown / 代码块 / 表格";
      this.backInput.rows = 6;
      return this.backInput;
    });

    // 提示
    this.makeField(form, "💡 提示（每行一条，可选）", false, () => {
      this.hintsInput = form.createEl("textarea", { cls: "mindos-editor-textarea" });
      this.hintsInput.value = (this.card.hints ?? []).join("\n");
      this.hintsInput.placeholder = "提示帮助回忆，每行一条\n例如：以 chmod 开头\n例如：注意权限位顺序";
      this.hintsInput.rows = 2;
      return this.hintsInput;
    });

    // 示例
    this.makeField(form, "📝 示例（每行一条，可选）", false, () => {
      this.examplesInput = form.createEl("textarea", { cls: "mindos-editor-textarea" });
      this.examplesInput.value = (this.card.examples ?? []).join("\n");
      this.examplesInput.placeholder = "示例帮助理解，每行一条";
      this.examplesInput.rows = 2;
      return this.examplesInput;
    });

    // 标签
    this.makeField(form, "🏷 标签（逗号分隔）", false, () => {
      this.tagsInput = form.createEl("input", {
        type: "text",
        cls: "mindos-editor-input",
      });
      this.tagsInput.value = (this.card.tags ?? []).join(", ");
      this.tagsInput.placeholder = "例如：linux, 命令行, 文件权限";
      return this.tagsInput as any;
    });

    // 状态
    this.makeField(form, "📊 状态", false, () => {
      this.statusSelect = form.createEl("select", { cls: "mindos-editor-select" });
      const statuses: Array<{ value: RecallCardStatus; label: string }> = [
        { value: "new", label: "🆕 新卡片" },
        { value: "learning", label: "📖 学习中" },
        { value: "review", label: "🔄 复习中" },
        { value: "mastered", label: "✅ 已掌握" },
        { value: "suspended", label: "⏸ 已暂停" },
      ];
      for (const s of statuses) {
        const opt = this.statusSelect.createEl("option", {
          value: s.value,
          text: s.label,
        });
        if (this.card.status === s.value) opt.selected = true;
      }
      return this.statusSelect as any;
    });

    // SRS 信息（只读，仅编辑时显示）
    if (this.mode === "edit" && this.card.srs.repetitions > 0) {
      const srsInfo = form.createDiv({ cls: "mindos-editor-srs-info" });
      srsInfo.createDiv({ cls: "mindos-editor-srs-label", text: "📈 复习数据（只读）" });
      const grid = srsInfo.createDiv({ cls: "mindos-editor-srs-grid" });
      this.makeSrsItem(grid, "复习次数", String(this.card.stats.totalReviews));
      this.makeSrsItem(grid, "正确次数", String(this.card.stats.correctCount));
      this.makeSrsItem(grid, "下次复习", this.card.srs.nextReview || "—");
      this.makeSrsItem(grid, "间隔", `${this.card.srs.interval} 天`);
      this.makeSrsItem(grid, "易度因子", this.card.srs.easeFactor.toFixed(2));
      this.makeSrsItem(grid, "连胜", String(this.card.stats.streak));
    }

    // 按钮
    const btnRow = contentEl.createDiv({ cls: "mindos-editor-btn-row" });

    if (this.mode === "edit") {
      const resetBtn = btnRow.createEl("button", { cls: "mindos-btn is-danger-text" });
      setIcon(resetBtn.createSpan(), "rotate-ccw");
      resetBtn.createSpan({ text: " 重置进度" });
      resetBtn.onclick = () => {
        if (!confirm("确定重置该卡片的复习进度？该操作不可撤销。")) return;
        this.card.srs = this.srsEngine.createInitialSRS();
        this.card.stats = {
          totalReviews: 0,
          correctCount: 0,
          wrongCount: 0,
          avgResponseTimeMs: 0,
          streak: 0,
        };
        this.card.status = "new";
        new Notice("✅ 已重置进度");
        this.onOpen();
      };
    }

    btnRow.createDiv({ cls: "mindos-editor-btn-spacer" });

    const cancelBtn = btnRow.createEl("button", { cls: "mindos-btn" });
    cancelBtn.setText("取消");
    cancelBtn.onclick = () => this.close();

    const saveBtn = btnRow.createEl("button", { cls: "mindos-btn is-primary" });
    setIcon(saveBtn.createSpan(), "save");
    saveBtn.createSpan({ text: this.mode === "create" ? " 创建" : " 保存" });
    saveBtn.onclick = () => this.handleSave();

    // 自动聚焦
    setTimeout(() => this.frontInput.focus(), 50);
  }

  private makeField(
    parent: HTMLElement,
    label: string,
    required: boolean,
    builder: () => HTMLElement,
  ) {
    const wrap = parent.createDiv({ cls: "mindos-editor-field" });
    const labelEl = wrap.createDiv({ cls: "mindos-editor-label" });
    labelEl.createSpan({ text: label });
    if (required) {
      labelEl.createSpan({ cls: "mindos-editor-required", text: " *" });
    }
    builder();
  }

  private makeSrsItem(parent: HTMLElement, label: string, value: string) {
    const item = parent.createDiv({ cls: "mindos-editor-srs-item" });
    item.createDiv({ cls: "mindos-editor-srs-item-label", text: label });
    item.createDiv({ cls: "mindos-editor-srs-item-value", text: value });
  }

  private async handleSave() {
    const front = this.frontInput.value.trim();
    const back = this.backInput.value.trim();

    if (!front) {
      new Notice("⚠️ 请填写正面（问题）");
      this.frontInput.focus();
      return;
    }
    if (!back) {
      new Notice("⚠️ 请填写背面（答案）");
      this.backInput.focus();
      return;
    }

    this.card.front = front;
    this.card.back = back;
    this.card.hints = this.hintsInput.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    this.card.examples = this.examplesInput.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    this.card.tags = this.tagsInput.value
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    this.card.status = this.statusSelect.value as RecallCardStatus;
    this.card.updatedAt = nowISOString();

    try {
      await this.cardStore.saveCard(this.card);
      new Notice(this.mode === "create" ? "✅ 卡片已创建" : "✅ 卡片已保存");
      this.onSaved(this.card);
      this.close();
    } catch (e) {
      new Notice(`❌ 保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}