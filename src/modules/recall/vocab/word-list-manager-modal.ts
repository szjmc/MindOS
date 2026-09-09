import { App, Modal, Notice, setIcon } from "obsidian";
import {
  WordList,
  WordListUserConfig,
  VocabReviewMode,
} from "../../../core/types";
import {
  VOCAB_REVIEW_MODE_LABELS,
} from "../../../core/constants";
import { WordListStore } from "./word-list-store";
import { RecallVocabGenerator } from "../generators/recall-vocab-generator";
import { RecallCardStore } from "../core/recall-card-store";

export class WordListManagerModal extends Modal {
  constructor(
    app: App,
    private wordListStore: WordListStore,
    private vocabGenerator: RecallVocabGenerator,
    private cardStore: RecallCardStore,
    private onChange: () => void,
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-vocab-manager-modal");

    contentEl.createEl("h2", { text: "📚 词库管理" });

    await this.renderLists();
  }

  private async renderLists() {
    const { contentEl } = this;
    contentEl.findAll(".mindos-vocab-list-wrap").forEach((el) => el.remove());

    const wrap = contentEl.createDiv({ cls: "mindos-vocab-list-wrap" });

    const lists = await this.wordListStore.getAllLists();
    const allCards = await this.cardStore.getAllCards("vocab");

    // 工具栏
    const toolbar = wrap.createDiv({ cls: "mindos-vocab-toolbar" });

    const importBtn = toolbar.createEl("button", { cls: "mindos-btn" });
    setIcon(importBtn.createSpan(), "upload");
    importBtn.createSpan({ text: " 导入自定义词库" });
    importBtn.onclick = () => this.openImporter();

    // 词库列表
    const listEl = wrap.createDiv({ cls: "mindos-vocab-lists" });

    for (const wl of lists) {
      await this.renderListItem(listEl, wl, allCards);
    }
  }

  private async renderListItem(
    parent: HTMLElement,
    wl: WordList,
    allCards: any[],
  ) {
    const item = parent.createDiv({ cls: "mindos-vocab-list-item" });

    // 头部
    const head = item.createDiv({ cls: "mindos-vocab-list-head" });

    const coverEl = head.createDiv({ cls: "mindos-vocab-list-cover" });
    coverEl.setText(wl.cover ?? "📚");

    const titleWrap = head.createDiv({ cls: "mindos-vocab-list-title-wrap" });
    const titleRow = titleWrap.createDiv({ cls: "mindos-vocab-list-title-row" });
    titleRow.createSpan({
      cls: "mindos-vocab-list-title",
      text: wl.name,
    });
    if (wl.source === "builtin") {
      titleRow.createSpan({
        cls: "mindos-vocab-list-badge",
        text: "内置",
      });
    } else if (wl.source === "custom") {
      titleRow.createSpan({
        cls: "mindos-vocab-list-badge is-custom",
        text: "自定义",
      });
    }

    if (wl.description) {
      titleWrap.createDiv({
        cls: "mindos-vocab-list-desc",
        text: wl.description,
      });
    }

    // 进度
    const progress = await this.wordListStore.getProgress(wl.id, allCards);
    const config = wl.config!;

    const stats = item.createDiv({ cls: "mindos-vocab-list-stats" });

    this.makeStatChip(stats, "📚", `共 ${wl.totalWords} 词`);
    this.makeStatChip(stats, "📖", `已学 ${progress.startedWords}`, "is-info");
    this.makeStatChip(stats, "✅", `掌握 ${progress.masteredWords}`, "is-success");

    // 进度条
    const progressBarWrap = item.createDiv({ cls: "mindos-vocab-progress-wrap" });
    const progressBar = progressBarWrap.createDiv({ cls: "mindos-vocab-progress-bar" });
    const pct = wl.totalWords > 0 ? (progress.startedWords / wl.totalWords) * 100 : 0;
    const fill = progressBar.createDiv({ cls: "mindos-vocab-progress-fill" });
    fill.style.width = `${pct}%`;
    progressBarWrap.createDiv({
      cls: "mindos-vocab-progress-text",
      text: `${pct.toFixed(1)}% · 起始 index: ${config.startIndex}`,
    });

    // 配置区
    const configWrap = item.createDiv({ cls: "mindos-vocab-list-config" });

    // 启用开关
    const enableRow = configWrap.createDiv({ cls: "mindos-vocab-config-row" });
    enableRow.createSpan({ text: "启用：" });
    const enableCheck = enableRow.createEl("input");
    enableCheck.type = "checkbox";
    enableCheck.checked = config.enabled;
    enableCheck.onchange = async () => {
      await this.wordListStore.updateListConfig(wl.id, {
        enabled: enableCheck.checked,
      });
      this.onChange();
    };

    // 每日新词
    const newPerDayRow = configWrap.createDiv({ cls: "mindos-vocab-config-row" });
    newPerDayRow.createSpan({ text: "每日新词：" });
    const newPerDayInput = newPerDayRow.createEl("input");
    newPerDayInput.type = "number";
    newPerDayInput.min = "1";
    newPerDayInput.max = "100";
    newPerDayInput.value = String(config.newPerDay);
    newPerDayInput.onchange = async () => {
      const n = parseInt(newPerDayInput.value);
      if (Number.isFinite(n) && n > 0) {
        await this.wordListStore.updateListConfig(wl.id, { newPerDay: n });
      }
    };

    // 复习模式
    const modeRow = configWrap.createDiv({ cls: "mindos-vocab-config-row" });
    modeRow.createSpan({ text: "复习模式：" });
    const modeSelect = modeRow.createEl("select");
    for (const [val, label] of Object.entries(VOCAB_REVIEW_MODE_LABELS)) {
      const opt = modeSelect.createEl("option", { value: val, text: label });
      if (config.reviewMode === val) opt.selected = true;
    }
    modeSelect.onchange = async () => {
      await this.wordListStore.updateListConfig(wl.id, {
        reviewMode: modeSelect.value as VocabReviewMode,
      });
    };

    // 操作按钮
    const ops = item.createDiv({ cls: "mindos-vocab-list-ops" });

    const genBtn = ops.createEl("button", { cls: "mindos-btn is-primary" });
    setIcon(genBtn.createSpan(), "sparkles");
    genBtn.createSpan({ text: ` 学习 ${config.newPerDay} 个新词` });
    genBtn.onclick = () => this.handleGenerate(wl);

    const entries = await this.wordListStore.getEntries(wl.id);
    if (entries.length < wl.totalWords) {
      const expandBtn = ops.createEl("button", { cls: "mindos-btn" });
      setIcon(expandBtn.createSpan(), "plus-square");
      expandBtn.createSpan({
        text: ` 扩展 (当前 ${entries.length}/${wl.totalWords})`,
      });
      expandBtn.onclick = () => this.handleExpand(wl);
    }

    if (wl.source !== "builtin") {
      const delBtn = ops.createEl("button", { cls: "mindos-btn is-danger-text" });
      setIcon(delBtn.createSpan(), "trash-2");
      delBtn.createSpan({ text: " 删除" });
      delBtn.onclick = async () => {
        if (!confirm(`确定删除词库「${wl.name}」？该操作不可恢复！`)) return;
        await this.wordListStore.deleteList(wl.id);
        new Notice("✅ 已删除");
        await this.renderLists();
        this.onChange();
      };
    }

    // 重置进度
    if (config.startIndex > 0) {
      const resetBtn = ops.createEl("button", { cls: "mindos-btn" });
      setIcon(resetBtn.createSpan(), "rotate-ccw");
      resetBtn.createSpan({ text: " 重置进度" });
      resetBtn.onclick = async () => {
        if (!confirm("确定重置该词库的学习进度？已生成的卡片不会删除。")) return;
        await this.wordListStore.updateListConfig(wl.id, {
          startIndex: 0,
          totalLearned: 0,
        });
        new Notice("✅ 已重置进度");
        await this.renderLists();
      };
    }
  }

  private makeStatChip(parent: HTMLElement, icon: string, text: string, cls: string = "") {
    const chip = parent.createDiv({ cls: `mindos-vocab-stat-chip ${cls}` });
    chip.createSpan({ text: `${icon} ${text}` });
  }

  // ════════════════════════════════════════════════════════════
  // 生成卡片
  // ════════════════════════════════════════════════════════════
  private async handleGenerate(wl: WordList) {
    const config = wl.config!;
    const entries = await this.wordListStore.getEntries(wl.id);

    if (entries.length === 0) {
      new Notice(`⚠️ 词库「${wl.name}」暂无词条，请先点击「扩展」用 AI 生成`, 4000);
      return;
    }

    const remaining = entries.length - config.startIndex;
    if (remaining <= 0) {
      new Notice("🎉 该词库已学完所有词条！可点击「扩展」继续添加");
      return;
    }

    const actualCount = Math.min(config.newPerDay, remaining);
    if (!confirm(`将为「${wl.name}」生成 ${actualCount} 个新词的复习卡片，继续？`)) {
      return;
    }

    // 进度提示
    const notice = new Notice(`生成中... 0/${actualCount}`, 0);

    try {
      const result = await this.vocabGenerator.generate(
        {
          wordListId: wl.id,
          count: actualCount,
          reviewMode: config.reviewMode,
          generateExtraWithAI: false,
        },
        (p) => {
          notice.setMessage(`生成中... ${p.done}/${p.total} (${p.currentWord})`);
        },
      );

      notice.hide();
      new Notice(`✅ 生成完成：${result.newCards} 张卡片`);
      await this.renderLists();
      this.onChange();
    } catch (e) {
      notice.hide();
      new Notice(`❌ 生成失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 扩展词库
  // ════════════════════════════════════════════════════════════
  private async handleExpand(wl: WordList) {
    const targetCount = parseInt(prompt(`扩展词库「${wl.name}」到多少词？（当前 ${(await this.wordListStore.getEntries(wl.id)).length}）`, "200") || "0");
    if (!Number.isFinite(targetCount) || targetCount <= 0) return;

    const existing = await this.wordListStore.getEntries(wl.id);
    const addCount = targetCount - existing.length;
    if (addCount <= 0) {
      new Notice("无需扩展");
      return;
    }

    const notice = new Notice(`AI 扩展中... 0/${addCount}`, 0);

    try {
      const result = await this.vocabGenerator.expandWordList(
        wl.id,
        addCount,
        (done, total) => {
          notice.setMessage(`AI 扩展中... ${done}/${total}`);
        },
      );

      notice.hide();
      new Notice(`✅ 扩展完成：新增 ${result.added} 词`);
      await this.renderLists();
    } catch (e) {
      notice.hide();
      new Notice(`❌ 扩展失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 导入自定义词库
  // ════════════════════════════════════════════════════════════
  private openImporter() {
    new VocabImporterModal(
      this.app,
      this.wordListStore,
      async () => {
        await this.renderLists();
        this.onChange();
      },
    ).open();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════
// 自定义词库导入弹窗
// ════════════════════════════════════════════════════════════
class VocabImporterModal extends Modal {
  constructor(
    app: App,
    private wordListStore: WordListStore,
    private onImported: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-vocab-importer-modal");

    contentEl.createEl("h3", { text: "📥 导入自定义词库" });

    // 名称
    const nameWrap = contentEl.createDiv({ cls: "mindos-importer-field" });
    nameWrap.createDiv({ text: "词库名称：" });
    const nameInput = nameWrap.createEl("input", {
      type: "text",
      cls: "mindos-importer-input",
    });
    nameInput.placeholder = "例如：我的工作高频词";

    // 格式选择
    const formatWrap = contentEl.createDiv({ cls: "mindos-importer-field" });
    formatWrap.createDiv({ text: "格式：" });
    const formatSelect = formatWrap.createEl("select", { cls: "mindos-importer-select" });
    formatSelect.createEl("option", { value: "txt", text: "TXT (每行: 单词,释义)" });
    formatSelect.createEl("option", { value: "csv", text: "CSV (word,definition,phonetic,pos,example_en,example_cn)" });

    // 内容
    const contentWrap = contentEl.createDiv({ cls: "mindos-importer-field" });
    contentWrap.createDiv({ text: "粘贴词库内容：" });
    const textarea = contentWrap.createEl("textarea", { cls: "mindos-importer-textarea" });
    textarea.rows = 12;
    textarea.placeholder = "TXT 格式示例：\nabandon, 放弃\nability, 能力\n...";

    // 示例切换
    formatSelect.onchange = () => {
      if (formatSelect.value === "csv") {
        textarea.placeholder = `CSV 格式示例：\nword,definition,phonetic,partOfSpeech,example_en,example_cn\nabandon,"放弃,抛弃",/əˈbændən/,v.,He abandoned his car.,他抛弃了汽车。`;
      } else {
        textarea.placeholder = "TXT 格式示例：\nabandon, 放弃\nability, 能力\n...";
      }
    };

    // 按钮
    const btnRow = contentEl.createDiv({ cls: "mindos-importer-btn-row" });
    const cancelBtn = btnRow.createEl("button", { cls: "mindos-btn" });
    cancelBtn.setText("取消");
    cancelBtn.onclick = () => this.close();

    const importBtn = btnRow.createEl("button", { cls: "mindos-btn is-primary" });
    setIcon(importBtn.createSpan(), "upload");
    importBtn.createSpan({ text: " 导入" });
    importBtn.onclick = async () => {
      const name = nameInput.value.trim();
      const content = textarea.value.trim();

      if (!name) { new Notice("⚠️ 请填写词库名称"); return; }
      if (!content) { new Notice("⚠️ 请粘贴词库内容"); return; }

      try {
        let wl: WordList;
        if (formatSelect.value === "csv") {
          wl = await this.wordListStore.importFromCSV(name, content);
        } else {
          wl = await this.wordListStore.importFromTXT(name, content);
        }
        new Notice(`✅ 导入成功：${wl.name}（${wl.totalWords} 词）`);
        this.onImported();
        this.close();
      } catch (e) {
        new Notice(`❌ 导入失败：${e instanceof Error ? e.message : String(e)}`);
      }
    };

    setTimeout(() => nameInput.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}