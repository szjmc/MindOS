import {
  setIcon,
  Notice,
  MarkdownRenderer,
  Component,
  Modal,
} from "obsidian";
import type MindOSPlugin from "../../../main";
import {
  RecallCard,
  RecallScenario,
  RecallCardStatus,
  CardManagerFilter,
} from "../../core/types";
import { RECALL_SCENARIO_META } from "../../core/constants";
import { RecallCardEditorModal } from "./recall-card-editor-modal";

export class RecallCardManagerView {
  private mdComponent: Component;
  private searchInputEl: HTMLInputElement | null = null;
  private isComposing = false;

  // ✅ 关键修复 1：用本地变量缓存卡片，不依赖 store 中转
  private localCards: RecallCard[] = [];
  private isLoading = false;

  constructor(private plugin: MindOSPlugin) {
    this.mdComponent = new Component();
  }

  unload() {
    this.mdComponent.unload();
  }

  async render(parent: HTMLElement) {
    // 焦点保护
    const activeEl = document.activeElement as HTMLElement | null;
    let savedFocus: { value: string; selStart: number; selEnd: number } | null = null;
    if (activeEl === this.searchInputEl && this.searchInputEl) {
      savedFocus = {
        value: this.searchInputEl.value,
        selStart: this.searchInputEl.selectionStart ?? 0,
        selEnd: this.searchInputEl.selectionEnd ?? 0,
      };
    }
    this.searchInputEl = null;

    // ✅ 关键修复 2：先渲染骨架（避免空白）+ 异步加载
    this.renderHeader(parent);
    this.renderToolbar(parent);

    // 占位区域
    const statsContainer = parent.createDiv({ cls: "mindos-recall-manager-stats-container" });
    const listContainer = parent.createDiv({ cls: "mindos-recall-manager-list-container" });

    // 显示加载中
    if (this.isLoading) {
      const loading = listContainer.createDiv({ cls: "mindos-search-loading" });
      const li = loading.createSpan({ cls: "mindos-search-loading-icon" });
      setIcon(li, "loader-2");
      loading.createSpan({ text: "加载卡片中..." });
    } else {
      // 直接用本地缓存渲染（不触发 loadCards）
      this.renderStats(statsContainer);
      this.renderCardList(listContainer);
    }

    // 焦点恢复
    if (savedFocus && this.searchInputEl) {
      requestAnimationFrame(() => {
        if (this.searchInputEl) {
          this.searchInputEl.value = savedFocus!.value;
          this.searchInputEl.focus();
          try {
            this.searchInputEl.setSelectionRange(savedFocus!.selStart, savedFocus!.selEnd);
          } catch {}
        }
      });
    }

    // ✅ 关键修复 3：异步加载（不在 render 同步路径里）
    if (!this.isLoading && this.localCards.length === 0) {
      this.loadCardsAsync(statsContainer, listContainer);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ✅ 异步加载卡片（独立流程，不触发 store emit）
  // ════════════════════════════════════════════════════════════
  private async loadCardsAsync(statsContainer: HTMLElement, listContainer: HTMLElement) {
    if (this.isLoading) return;  // 防重入
    this.isLoading = true;

    try {
      const state = this.plugin.recallStore.getState();
      const allCards = await this.plugin.recallCardStore.getAllCards(state.managerScenario);
      this.localCards = this.filterCards(allCards, state.managerFilter);

      // ✅ 直接更新 DOM，不触发 store
      statsContainer.empty();
      listContainer.empty();
      this.renderStats(statsContainer);
      this.renderCardList(listContainer);
    } catch (e) {
      listContainer.empty();
      const err = listContainer.createDiv({ cls: "mindos-search-error" });
      err.setText(`加载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * ✅ 强制刷新（外部数据变更后调用）
   */
  async refreshFromExternal() {
    this.localCards = [];
    this.isLoading = false;
    // 触发一次 store emit（让 view 重新 render）
    this.plugin.recallStore.setManagerSelectedIdsClear();
  }

  // ════════════════════════════════════════════════════════════
  // 过滤
  // ════════════════════════════════════════════════════════════
  private filterCards(cards: RecallCard[], filter: CardManagerFilter): RecallCard[] {
    let result = [...cards];

    const q = filter.searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((c) => {
        return c.front.toLowerCase().includes(q)
          || c.back.toLowerCase().includes(q)
          || (c.tags ?? []).some((t) => t.toLowerCase().includes(q));
      });
    }

    if (filter.statusFilter !== "all") {
      result = result.filter((c) => c.status === filter.statusFilter);
    }

    if (filter.tagFilter) {
      result = result.filter((c) => (c.tags ?? []).includes(filter.tagFilter));
    }

    result.sort((a, b) => {
      switch (filter.sortBy) {
        case "updated_desc":
          return b.updatedAt.localeCompare(a.updatedAt);
        case "created_desc":
          return b.createdAt.localeCompare(a.createdAt);
        case "next_review":
          return (a.srs.nextReview || "9999").localeCompare(b.srs.nextReview || "9999");
        case "alpha":
          return a.front.localeCompare(b.front, "zh-Hans-CN");
        default:
          return 0;
      }
    });

    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 头部
  // ════════════════════════════════════════════════════════════
  private renderHeader(parent: HTMLElement) {
    const state = this.plugin.recallStore.getState();
    const meta = RECALL_SCENARIO_META[state.managerScenario];

    const head = parent.createDiv({ cls: "mindos-recall-manager-head" });

    const left = head.createDiv({ cls: "mindos-recall-manager-head-left" });

    const backBtn = left.createEl("button", { cls: "mindos-icon-btn" });
    setIcon(backBtn, "arrow-left");
    backBtn.setAttribute("title", "返回场景主页");
    backBtn.onclick = () => {
      // ✅ 关键：返回时清空本地缓存
      this.localCards = [];
      this.plugin.recallStore.setViewMode("scenario_home");
    };

    const titleWrap = left.createDiv({ cls: "mindos-recall-manager-title-wrap" });
    const ic = titleWrap.createSpan({ cls: "mindos-recall-manager-title-icon" });
    setIcon(ic, meta?.icon ?? "brain");
    titleWrap.createSpan({
      cls: "mindos-recall-manager-title",
      text: `${meta?.label ?? state.managerScenario} 卡片管理`,
    });

    const right = head.createDiv({ cls: "mindos-recall-manager-head-right" });

    // 场景切换下拉
    const scenarioSelect = right.createEl("select", { cls: "mindos-recall-manager-scenario-select" });
    for (const [key, m] of Object.entries(RECALL_SCENARIO_META)) {
      const opt = scenarioSelect.createEl("option", { value: key, text: m.label });
      if (key === state.managerScenario) opt.selected = true;
    }
    scenarioSelect.onchange = () => {
      // ✅ 关键：切换场景时清空本地缓存
      this.localCards = [];
      this.plugin.recallStore.setManagerScenario(scenarioSelect.value as RecallScenario);
    };

    const newBtn = right.createEl("button", { cls: "mindos-btn is-primary" });
    setIcon(newBtn.createSpan(), "plus");
    newBtn.createSpan({ text: " 新建卡片" });
    newBtn.onclick = () => this.openEditor("create");
  }

  // ════════════════════════════════════════════════════════════
  // 工具栏
  // ════════════════════════════════════════════════════════════
  private renderToolbar(parent: HTMLElement) {
    const state = this.plugin.recallStore.getState();
    const filter = state.managerFilter;

    const bar = parent.createDiv({ cls: "mindos-recall-manager-toolbar" });

    // 搜索框
    const searchWrap = bar.createDiv({ cls: "mindos-recall-manager-search" });
    const si = searchWrap.createSpan({ cls: "mindos-recall-manager-search-icon" });
    setIcon(si, "search");
    const input = searchWrap.createEl("input", {
      type: "text",
      cls: "mindos-recall-manager-search-input",
    });
    input.placeholder = "搜索正面/背面/标签...";
    input.value = filter.searchQuery;
    this.searchInputEl = input;

    let searchDebounce: number | null = null;
    input.addEventListener("compositionstart", () => { this.isComposing = true; });
    input.addEventListener("compositionend", () => {
      this.isComposing = false;
      this.scheduleSearchUpdate(input.value, searchDebounce, (t) => searchDebounce = t);
    });
    input.addEventListener("input", () => {
      if (this.isComposing) return;
      this.scheduleSearchUpdate(input.value, searchDebounce, (t) => searchDebounce = t);
    });

    // 状态过滤
    const statusSelect = bar.createEl("select", { cls: "mindos-recall-manager-select" });
    const statuses: Array<{ value: CardManagerFilter["statusFilter"]; label: string }> = [
      { value: "all", label: "全部状态" },
      { value: "new", label: "🆕 新卡片" },
      { value: "learning", label: "📖 学习中" },
      { value: "review", label: "🔄 复习中" },
      { value: "mastered", label: "✅ 已掌握" },
      { value: "suspended", label: "⏸ 已暂停" },
    ];
    for (const s of statuses) {
      const opt = statusSelect.createEl("option", { value: s.value, text: s.label });
      if (filter.statusFilter === s.value) opt.selected = true;
    }
    statusSelect.onchange = () => {
      this.localCards = [];  // ✅ 清缓存
      this.plugin.recallStore.setManagerFilter({
        statusFilter: statusSelect.value as any,
      });
    };

    // 标签过滤
    const allTags = this.collectAllTags();
    if (allTags.length > 0) {
      const tagSelect = bar.createEl("select", { cls: "mindos-recall-manager-select" });
      tagSelect.createEl("option", { value: "", text: "全部标签" });
      for (const t of allTags) {
        const opt = tagSelect.createEl("option", { value: t, text: `#${t}` });
        if (filter.tagFilter === t) opt.selected = true;
      }
      tagSelect.onchange = () => {
        this.localCards = [];  // ✅ 清缓存
        this.plugin.recallStore.setManagerFilter({
          tagFilter: tagSelect.value,
        });
      };
    }

    // 排序
    const sortSelect = bar.createEl("select", { cls: "mindos-recall-manager-select" });
    const sorts: Array<{ value: CardManagerFilter["sortBy"]; label: string }> = [
      { value: "updated_desc", label: "🕐 最近更新" },
      { value: "created_desc", label: "✨ 最新创建" },
      { value: "next_review", label: "📅 即将复习" },
      { value: "alpha", label: "🔤 字母顺序" },
    ];
    for (const s of sorts) {
      const opt = sortSelect.createEl("option", { value: s.value, text: s.label });
      if (filter.sortBy === s.value) opt.selected = true;
    }
    sortSelect.onchange = () => {
      this.localCards = [];  // ✅ 清缓存
      this.plugin.recallStore.setManagerFilter({
        sortBy: sortSelect.value as any,
      });
    };
  }

  /**
   * ✅ 防抖搜索（避免每次按键都重新加载卡片）
   */
  private scheduleSearchUpdate(
    value: string,
    currentDebounce: number | null,
    setDebounce: (t: number | null) => void,
  ) {
    if (currentDebounce) window.clearTimeout(currentDebounce);

    const t = window.setTimeout(() => {
      setDebounce(null);
      this.localCards = [];  // 清缓存
      this.plugin.recallStore.setManagerFilter({ searchQuery: value });
    }, 300);

    setDebounce(t);
  }

  private collectAllTags(): string[] {
    const set = new Set<string>();
    for (const c of this.localCards) {
      for (const t of (c.tags ?? [])) {
        if (t) set.add(t);
      }
    }
    return Array.from(set).sort();
  }

  // ════════════════════════════════════════════════════════════
  // 统计行
  // ════════════════════════════════════════════════════════════
  private renderStats(parent: HTMLElement) {
    const state = this.plugin.recallStore.getState();
    const cards = this.localCards;
    const selectedCount = state.managerSelectedIds.size;

    const newCount = cards.filter((c) => c.status === "new").length;
    const dueCount = cards.filter((c) => {
      if (c.status === "suspended" || c.status === "new") return false;
      const today = new Date().toISOString().substring(0, 10);
      return c.srs.nextReview <= today;
    }).length;
    const masteredCount = cards.filter((c) => c.status === "mastered").length;

    const stats = parent.createDiv({ cls: "mindos-recall-manager-stats" });

    const left = stats.createDiv({ cls: "mindos-recall-manager-stats-left" });
    left.createSpan({
      cls: "mindos-recall-manager-stats-total",
      text: `共 ${cards.length} 张`,
    });
    if (newCount > 0) {
      left.createSpan({
        cls: "mindos-recall-manager-stats-chip is-new",
        text: `🆕 ${newCount}`,
      });
    }
    if (dueCount > 0) {
      left.createSpan({
        cls: "mindos-recall-manager-stats-chip is-due",
        text: `⏰ ${dueCount}`,
      });
    }
    if (masteredCount > 0) {
      left.createSpan({
        cls: "mindos-recall-manager-stats-chip is-mastered",
        text: `✅ ${masteredCount}`,
      });
    }

    if (selectedCount > 0) {
      const right = stats.createDiv({ cls: "mindos-recall-manager-stats-right" });
      right.createSpan({
        cls: "mindos-recall-manager-stats-selected",
        text: `已选 ${selectedCount}`,
      });

      const suspendBtn = right.createEl("button", { cls: "mindos-btn" });
      setIcon(suspendBtn.createSpan(), "pause");
      suspendBtn.createSpan({ text: " 暂停" });
      suspendBtn.onclick = () => this.batchSuspend();

      const resumeBtn = right.createEl("button", { cls: "mindos-btn" });
      setIcon(resumeBtn.createSpan(), "play");
      resumeBtn.createSpan({ text: " 恢复" });
      resumeBtn.onclick = () => this.batchResume();

      const delBtn = right.createEl("button", { cls: "mindos-btn is-danger-text" });
      setIcon(delBtn.createSpan(), "trash-2");
      delBtn.createSpan({ text: " 删除" });
      delBtn.onclick = () => this.batchDelete();

      const clearBtn = right.createEl("button", { cls: "mindos-btn" });
      setIcon(clearBtn.createSpan(), "x");
      clearBtn.createSpan({ text: " 取消选择" });
      clearBtn.onclick = () => {
        this.plugin.recallStore.clearSelectedCards();
      };
    }
  }

  // ════════════════════════════════════════════════════════════
  // 卡片列表
  // ════════════════════════════════════════════════════════════
  private renderCardList(parent: HTMLElement) {
    const cards = this.localCards;

    if (cards.length === 0) {
      const empty = parent.createDiv({ cls: "mindos-recall-manager-empty" });
      const ic = empty.createSpan({ cls: "mindos-recall-manager-empty-icon" });
      setIcon(ic, "inbox");
      empty.createDiv({ cls: "mindos-recall-manager-empty-text", text: "暂无符合条件的卡片" });
      const newBtn = empty.createEl("button", { cls: "mindos-btn is-primary" });
      setIcon(newBtn.createSpan(), "plus");
      newBtn.createSpan({ text: " 新建第一张卡片" });
      newBtn.onclick = () => this.openEditor("create");
      return;
    }

    const list = parent.createDiv({ cls: "mindos-recall-manager-list" });
    for (const card of cards) {
      this.renderCardItem(list, card);
    }
  }

  private renderCardItem(parent: HTMLElement, card: RecallCard) {
    const state = this.plugin.recallStore.getState();
    const isSelected = state.managerSelectedIds.has(card.id);

    const item = parent.createDiv({
      cls: `mindos-recall-manager-item${isSelected ? " is-selected" : ""}`,
    });

    // 选择框
    const checkboxWrap = item.createDiv({ cls: "mindos-recall-manager-item-checkbox" });
    const checkbox = checkboxWrap.createEl("input");
    checkbox.type = "checkbox";
    checkbox.checked = isSelected;
    checkbox.onclick = (e) => {
      e.stopPropagation();
      this.plugin.recallStore.toggleSelectCard(card.id);
    };

    // 主体
    const body = item.createDiv({ cls: "mindos-recall-manager-item-body" });

    const head = body.createDiv({ cls: "mindos-recall-manager-item-head" });
    head.createSpan({
      cls: `mindos-recall-manager-status-badge status-${card.status}`,
      text: this.statusLabel(card.status),
    });

    if (card.tags && card.tags.length > 0) {
      const tagsEl = head.createDiv({ cls: "mindos-recall-manager-item-tags" });
      for (const t of card.tags.slice(0, 4)) {
        tagsEl.createSpan({
          cls: "mindos-recall-manager-tag",
          text: `#${t}`,
        });
      }
      if (card.tags.length > 4) {
        tagsEl.createSpan({
          cls: "mindos-recall-manager-tag",
          text: `+${card.tags.length - 4}`,
        });
      }
    }

    const timeEl = head.createSpan({ cls: "mindos-recall-manager-item-time" });
    timeEl.setText(this.formatRelativeTime(card.updatedAt));

    const frontEl = body.createDiv({ cls: "mindos-recall-manager-item-front" });
    frontEl.setText(this.truncate(card.front, 80));

    const backEl = body.createDiv({ cls: "mindos-recall-manager-item-back" });
    backEl.setText("→ " + this.truncate(this.stripMarkdown(card.back), 100));

    const meta = body.createDiv({ cls: "mindos-recall-manager-item-meta" });
    if (card.stats.totalReviews > 0) {
      const acc = Math.round((card.stats.correctCount / card.stats.totalReviews) * 100);
      meta.createSpan({ text: `📊 ${card.stats.totalReviews} 次复习 · 正确率 ${acc}%` });
    }
    if (card.srs.nextReview) {
      const days = this.daysUntil(card.srs.nextReview);
      if (days >= 0) {
        meta.createSpan({ text: ` · 📅 ${days === 0 ? "今天" : `${days} 天后`}复习` });
      }
    }
    if (card.sourcePath) {
      const sourceSpan = meta.createSpan();
      sourceSpan.createSpan({ text: " · " });
      const link = sourceSpan.createSpan({
        cls: "mindos-recall-manager-source-link",
        text: `📎 ${this.shortenPath(card.sourcePath)}`,
      });
      link.onclick = (e) => {
        e.stopPropagation();
        this.plugin.openFile(card.sourcePath!);
      };
    }

    const ops = item.createDiv({ cls: "mindos-recall-manager-item-ops" });

    const previewBtn = ops.createEl("button", { cls: "mindos-mini-btn" });
    setIcon(previewBtn, "eye");
    previewBtn.setAttribute("title", "预览");
    previewBtn.onclick = (e) => {
      e.stopPropagation();
      this.previewCard(card);
    };

    const editBtn = ops.createEl("button", { cls: "mindos-mini-btn" });
    setIcon(editBtn, "pencil");
    editBtn.setAttribute("title", "编辑");
    editBtn.onclick = (e) => {
      e.stopPropagation();
      this.openEditor("edit", card);
    };

    const delBtn = ops.createEl("button", { cls: "mindos-mini-btn is-danger" });
    setIcon(delBtn, "trash-2");
    delBtn.setAttribute("title", "删除");
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`确定删除卡片「${this.truncate(card.front, 30)}」？`)) return;
      await this.plugin.recallCardStore.deleteCard(card.scenario, card.id);
      new Notice("✅ 已删除");
      this.localCards = this.localCards.filter((c) => c.id !== card.id);
      // ✅ 直接更新 DOM，不触发 store
      const state = this.plugin.recallStore.getState();
      this.plugin.recallStore.setSelectedScenario(state.selectedScenario);
    };

    body.onclick = () => this.previewCard(card);
  }

  // ════════════════════════════════════════════════════════════
  // 操作
  // ════════════════════════════════════════════════════════════
  private openEditor(mode: "create" | "edit", card?: RecallCard) {
    const state = this.plugin.recallStore.getState();
    const modal = new RecallCardEditorModal(
      this.plugin.app,
      this.plugin.recallCardStore,
      this.plugin.srsEngine,
      {
        mode,
        scenario: state.managerScenario,
        card,
        onSaved: async () => {
          this.localCards = [];  // 清缓存
          this.plugin.recallStore.setSelectedScenario(state.selectedScenario);
        },
      },
    );
    modal.open();
  }

  private async previewCard(card: RecallCard) {
    new RecallCardPreviewModal(this.plugin, card).open();
  }

  private async batchSuspend() {
    const state = this.plugin.recallStore.getState();
    const ids = Array.from(state.managerSelectedIds);
    if (!confirm(`确定暂停 ${ids.length} 张卡片？`)) return;

    for (const id of ids) {
      await this.plugin.recallCardStore.suspendCard(state.managerScenario, id);
    }
    new Notice(`✅ 已暂停 ${ids.length} 张`);
    this.localCards = [];
    this.plugin.recallStore.clearSelectedCards();
  }

  private async batchResume() {
    const state = this.plugin.recallStore.getState();
    const ids = Array.from(state.managerSelectedIds);

    for (const id of ids) {
      const card = await this.plugin.recallCardStore.getCard(state.managerScenario, id);
      if (card && card.status === "suspended") {
        card.status = card.srs.repetitions > 0 ? "review" : "new";
        await this.plugin.recallCardStore.saveCard(card);
      }
    }
    new Notice(`✅ 已恢复 ${ids.length} 张`);
    this.localCards = [];
    this.plugin.recallStore.clearSelectedCards();
  }

  private async batchDelete() {
    const state = this.plugin.recallStore.getState();
    const ids = Array.from(state.managerSelectedIds);
    if (!confirm(`确定删除 ${ids.length} 张卡片？该操作不可恢复！`)) return;

    for (const id of ids) {
      await this.plugin.recallCardStore.deleteCard(state.managerScenario, id);
    }
    new Notice(`✅ 已删除 ${ids.length} 张`);
    this.localCards = [];
    this.plugin.recallStore.clearSelectedCards();
  }

  // ════════════════════════════════════════════════════════════
  // 辅助
  // ════════════════════════════════════════════════════════════
  private statusLabel(status: RecallCardStatus): string {
    return ({
      new: "🆕 新",
      learning: "📖 学",
      review: "🔄 复",
      mastered: "✅ 掌",
      suspended: "⏸ 停",
    } as any)[status] ?? status;
  }

  private truncate(text: string, len: number): string {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= len) return clean;
    return clean.substring(0, len) + "…";
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, "[代码]")
      .replace(/`[^`]*`/g, "[代码]")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^#+\s/gm, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
      .replace(/\n/g, " ");
  }

  private formatRelativeTime(iso: string): string {
    const d = new Date(iso.replace(" ", "T"));
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}天前`;
    return iso.substring(0, 10);
  }

  private daysUntil(dateStr: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }

  private shortenPath(path: string): string {
    const parts = path.split("/");
    if (parts.length <= 2) return path;
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
}

// ════════════════════════════════════════════════════════════
// 卡片预览弹窗
// ════════════════════════════════════════════════════════════
class RecallCardPreviewModal extends Modal {
  private mdComponent: Component;

  constructor(private plugin: MindOSPlugin, private card: RecallCard) {
    super(plugin.app);
    this.mdComponent = new Component();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-recall-preview-modal");

    contentEl.createEl("h3", { text: "🔍 卡片预览" });

    const frontWrap = contentEl.createDiv({ cls: "mindos-recall-preview-section" });
    frontWrap.createDiv({ cls: "mindos-recall-preview-label", text: "🎯 正面" });
    const frontEl = frontWrap.createDiv({ cls: "mindos-recall-preview-content" });
    try {
      MarkdownRenderer.render(this.plugin.app, this.card.front, frontEl, "", this.mdComponent);
    } catch {
      frontEl.setText(this.card.front);
    }

    if (this.card.hints && this.card.hints.length > 0) {
      const hintWrap = contentEl.createDiv({ cls: "mindos-recall-preview-section" });
      hintWrap.createDiv({ cls: "mindos-recall-preview-label", text: "💡 提示" });
      const hintEl = hintWrap.createDiv({ cls: "mindos-recall-preview-content" });
      for (const h of this.card.hints) {
        hintEl.createDiv({ text: `· ${h}` });
      }
    }

    const backWrap = contentEl.createDiv({ cls: "mindos-recall-preview-section" });
    backWrap.createDiv({ cls: "mindos-recall-preview-label", text: "✅ 背面" });
    const backEl = backWrap.createDiv({ cls: "mindos-recall-preview-content" });
    try {
      MarkdownRenderer.render(this.plugin.app, this.card.back, backEl, "", this.mdComponent);
    } catch {
      backEl.setText(this.card.back);
    }

    if (this.card.examples && this.card.examples.length > 0) {
      const exWrap = contentEl.createDiv({ cls: "mindos-recall-preview-section" });
      exWrap.createDiv({ cls: "mindos-recall-preview-label", text: "📝 示例" });
      const exEl = exWrap.createDiv({ cls: "mindos-recall-preview-content" });
      for (const ex of this.card.examples) {
        const exItem = exEl.createDiv({ cls: "mindos-recall-preview-example" });
        try {
          MarkdownRenderer.render(this.plugin.app, ex, exItem, "", this.mdComponent);
        } catch {
          exItem.setText(ex);
        }
      }
    }

    const btnRow = contentEl.createDiv({ cls: "mindos-recall-preview-btn-row" });
    const closeBtn = btnRow.createEl("button", { cls: "mindos-btn is-primary" });
    closeBtn.setText("关闭");
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.mdComponent.unload();
    this.contentEl.empty();
  }
}