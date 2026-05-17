import { ItemView, WorkspaceLeaf, Notice, setIcon, MarkdownRenderer, Component } from "obsidian";
import type MindOSPlugin from "../../../main";
import {
  VIEW_TYPE_MINDOS,
  PLUGIN_VERSION,
  PLUGIN_NAME,
  TAB_LABELS,
  PAGE_TYPE_LABELS,
} from "../../core/constants";
import {
  RetrieveTab,
  SearchMode,
  PageSearchResult,
  ChatMessage,
  ChatSession,
  ChatCitation,
} from "../../core/types";
import { TokenEstimator } from "./token-estimator";

export class MindOSRetrieveView extends ItemView {
  private taskUnsub: (() => void) | null = null;
  private retrieveUnsub: (() => void) | null = null;
  private recallUnsub: (() => void) | null = null;
  private mdComponent: Component;

  // ✅ 持久化 DOM 引用，避免重渲染时丢失焦点
  private searchInputEl: HTMLInputElement | null = null;
  private chatInputEl: HTMLTextAreaElement | null = null;
  private chatScrollEl: HTMLElement | null = null;

  // ✅ 输入框防抖
  private searchInputDebounce: number | null = null;
  private isComposing = false;

  // ✅ 历史对话折叠状态
  private sessionListCollapsed = false;

  constructor(leaf: WorkspaceLeaf, private plugin: MindOSPlugin) {
    super(leaf);
    this.mdComponent = new Component();
  }

  getViewType(): string { return VIEW_TYPE_MINDOS; }
  getDisplayText(): string { return PLUGIN_NAME; }
  getIcon(): string { return "brain-circuit"; }

  async onOpen() {
    this.taskUnsub = this.plugin.taskStore.subscribe(() => this.render());
    this.retrieveUnsub = this.plugin.retrieveStore.subscribe(() => this.render());
    this.recallUnsub = this.plugin.recallStore.subscribe(() => this.render());
    await this.plugin.refreshQuota();
    await this.plugin.loadChatSessions();
    this.render();
  }

  async onClose() {
    this.taskUnsub?.();
    this.retrieveUnsub?.();
    this.recallUnsub?.();
    this.mdComponent.unload();
  }

  // ════════════════════════════════════════════════════════════
  // 主渲染入口
  //
  // ✅ 关键修复：保留输入框焦点和光标位置
  // ════════════════════════════════════════════════════════════
  render() {
    // ── 保存焦点状态 ──
    const activeEl = document.activeElement as HTMLElement | null;
    let savedFocus: { type: "search" | "chat"; selectionStart: number; selectionEnd: number; value: string } | null = null;

    if (activeEl === this.searchInputEl && this.searchInputEl) {
      savedFocus = {
        type: "search",
        selectionStart: this.searchInputEl.selectionStart ?? 0,
        selectionEnd: this.searchInputEl.selectionEnd ?? 0,
        value: this.searchInputEl.value,
      };
    } else if (activeEl === this.chatInputEl && this.chatInputEl) {
      savedFocus = {
        type: "chat",
        selectionStart: this.chatInputEl.selectionStart ?? 0,
        selectionEnd: this.chatInputEl.selectionEnd ?? 0,
        value: this.chatInputEl.value,
      };
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-root");
    contentEl.style.height = "100%";
    contentEl.style.overflow = "hidden";
    contentEl.style.padding = "0";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";

    // ✅ 重置 DOM 引用，render 中会重新赋值
    this.searchInputEl = null;
    this.chatInputEl = null;

    const wrap = contentEl.createDiv({ cls: "mindos-task-center" });

    this.renderTopBar(wrap);
    this.renderTabBar(wrap);

    const tab = this.plugin.retrieveStore.getState().currentTab;
    if (tab === "capture") {
      this.renderCaptureTab(wrap);
    } else if (tab === "search") {
      this.renderSearchTab(wrap);
    } else if (tab === "chat") {
      this.renderChatTab(wrap);
    } else if (tab === "recall") {
      this.renderRecallTab(wrap);
    }

    // ── 恢复焦点 ──
    if (savedFocus) {
      requestAnimationFrame(() => {
        const targetEl = savedFocus!.type === "search" ? this.searchInputEl : this.chatInputEl;
        if (targetEl) {
          targetEl.value = savedFocus!.value;
          targetEl.focus();
          try {
            targetEl.setSelectionRange(savedFocus!.selectionStart, savedFocus!.selectionEnd);
          } catch {}
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 顶部栏
  // ════════════════════════════════════════════════════════════
  private renderTopBar(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: "mindos-topbar" });

    const left = bar.createDiv({ cls: "mindos-topbar-left" });
    const titleWrap = left.createDiv({ cls: "mindos-brand" });
    const iconEl = titleWrap.createSpan({ cls: "mindos-brand-icon" });
    setIcon(iconEl, "brain-circuit");
    titleWrap.createSpan({ cls: "mindos-brand-text", text: PLUGIN_NAME });
    titleWrap.createSpan({ cls: "mindos-version-tag", text: `v${PLUGIN_VERSION}` });

    const right = bar.createDiv({ cls: "mindos-topbar-right" });
    this.makeIconBtn(right, "settings", "设置", () => {
      // @ts-ignore
      this.plugin.app.setting.open();
      // @ts-ignore
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
    });
  }

  private makeIconBtn(parent: HTMLElement, icon: string, tooltip: string, onClick: () => void) {
    const btn = parent.createEl("button", { cls: "mindos-icon-btn" });
    btn.setAttribute("aria-label", tooltip);
    btn.setAttribute("title", tooltip);
    setIcon(btn, icon);
    btn.onclick = onClick;
    return btn;
  }

  // ════════════════════════════════════════════════════════════
  // Tab 栏
  // ════════════════════════════════════════════════════════════
  private renderTabBar(parent: HTMLElement) {
    const tabs = parent.createDiv({ cls: "mindos-tab-bar" });
    const current = this.plugin.retrieveStore.getState().currentTab;

    for (const [key, info] of Object.entries(TAB_LABELS)) {
      const btn = tabs.createDiv({
        cls: `mindos-tab-btn ${current === key ? "is-active" : ""}`,
      });
      const ic = btn.createSpan({ cls: "mindos-tab-btn-icon" });
      setIcon(ic, info.icon);
      btn.createSpan({ cls: "mindos-tab-btn-label", text: info.label });
      btn.onclick = () => {
        this.plugin.retrieveStore.setTab(key as RetrieveTab);
        this.plugin.saveCurrentTab(key as RetrieveTab);
      };
    }
  }

  // ════════════════════════════════════════════════════════════
  // 采集 Tab
  // ════════════════════════════════════════════════════════════
  private renderCaptureTab(parent: HTMLElement) {
    if (this.plugin.renderCaptureTab) {
      this.plugin.renderCaptureTab(parent);
    } else {
      const empty = parent.createDiv({ cls: "mindos-empty" });
      empty.setText("采集 Tab 待集成");
    }
  }

  // ════════════════════════════════════════════════════════════
  // 复习 Tab
  // ════════════════════════════════════════════════════════════
  private renderRecallTab(parent: HTMLElement) {
    if (this.plugin.renderRecallTab) {
      this.plugin.renderRecallTab(parent);
    } else {
      parent.createDiv({ cls: "mindos-empty", text: "Recall 模块加载中..." });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 检索 Tab
  // ════════════════════════════════════════════════════════════
  private renderSearchTab(parent: HTMLElement) {
    const state = this.plugin.retrieveStore.getState();

    this.renderIndexStatusCard(parent);
    this.renderQuotaCard(parent);

    const searchWrap = parent.createDiv({ cls: "mindos-search-wrap" });
    const inputRow = searchWrap.createDiv({ cls: "mindos-search-input-row" });

    const searchIcon = inputRow.createSpan({ cls: "mindos-search-icon" });
    setIcon(searchIcon, "search");

    const input = inputRow.createEl("input", { cls: "mindos-search-input", type: "text" });
    input.placeholder = "输入自然语言查询，例如：怎么改 Linux 文件权限";
    input.value = state.searchQuery;

    // ✅ 缓存引用（焦点恢复用）
    this.searchInputEl = input;

    // ✅ IME 输入兼容
    input.addEventListener("compositionstart", () => { this.isComposing = true; });
    input.addEventListener("compositionend", () => {
      this.isComposing = false;
      // 中文输入完成后同步一次
      this.scheduleSearchInputSync(input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !this.isComposing) {
        e.preventDefault();
        // 立即同步 + 触发搜索
        if (this.searchInputDebounce) {
          window.clearTimeout(this.searchInputDebounce);
          this.searchInputDebounce = null;
        }
        this.doSearch(input.value);
      }
    });

    // ✅ 关键修复：防抖 + 不直接触发 render
    input.addEventListener("input", () => {
      if (this.isComposing) return; // IME 输入中不处理
      this.scheduleSearchInputSync(input.value);
    });

    const goBtn = inputRow.createEl("button", { cls: "mindos-search-go-btn" });
    setIcon(goBtn.createSpan(), "arrow-right");
    goBtn.onclick = () => this.doSearch(input.value);

    // 搜索选项
    const optionsRow = searchWrap.createDiv({ cls: "mindos-search-options" });
    const modeWrap = optionsRow.createDiv({ cls: "mindos-search-mode-toggle" });
    modeWrap.createSpan({ cls: "mindos-mode-label", text: "聚合：" });

    const pageBtn = modeWrap.createEl("button", {
      cls: `mindos-mode-btn ${state.searchMode === "page" ? "is-active" : ""}`,
      text: "📄 按页面",
    });
    pageBtn.onclick = () => {
      this.plugin.retrieveStore.setSearchMode("page");
      if (state.searchQuery) this.doSearch(state.searchQuery);
    };

    const chunkBtn = modeWrap.createEl("button", {
      cls: `mindos-mode-btn ${state.searchMode === "chunk" ? "is-active" : ""}`,
      text: "🔍 按片段",
    });
    chunkBtn.onclick = () => {
      this.plugin.retrieveStore.setSearchMode("chunk");
      if (state.searchQuery) this.doSearch(state.searchQuery);
    };

    optionsRow.createSpan({
      cls: "mindos-search-tip",
      text: `Top ${this.plugin.settings.searchTopK}`,
    });

    // 状态显示
    if (state.isSearching) {
      const loading = parent.createDiv({ cls: "mindos-search-loading" });
      const li = loading.createSpan({ cls: "mindos-search-loading-icon" });
      setIcon(li, "loader-2");
      loading.createSpan({ text: "正在检索..." });
    }

    if (state.searchError) {
      const err = parent.createDiv({ cls: "mindos-search-error" });
      const ei = err.createSpan({ cls: "mindos-search-error-icon" });
      setIcon(ei, "alert-circle");
      err.createSpan({ text: state.searchError });
    }

    if (state.searchResults.length > 0) {
      this.renderSearchResults(parent, state.searchResults, state.searchMode);
    } else if (state.searchQuery && !state.isSearching && !state.searchError) {
      const empty = parent.createDiv({ cls: "mindos-empty" });
      empty.setText("未找到相关结果");
    } else if (!state.searchQuery && !state.isSearching) {
      this.renderSearchHints(parent);
    }
  }

  /**
   * ✅ 防抖：延迟同步搜索框输入到 store（避免高频 render）
   */
  private scheduleSearchInputSync(value: string) {
    if (this.searchInputDebounce) {
      window.clearTimeout(this.searchInputDebounce);
    }
    this.searchInputDebounce = window.setTimeout(() => {
      this.searchInputDebounce = null;
      // 静默更新 state，不触发完整渲染（query 变化不影响 UI）
      // 直接修改 state 字段，不调用 setSearchQuery 那种触发订阅的方法
      this.plugin.retrieveStore.getState().searchQuery = value;
    }, 300);
  }

  private async doSearch(rawQuery: string) {
    const query = (rawQuery ?? "").trim();
    if (!query) {
      this.plugin.retrieveStore.setSearchResults([]);
      return;
    }
    // 立即同步 query 值（避免被防抖延迟覆盖）
    this.plugin.retrieveStore.getState().searchQuery = query;
    this.plugin.retrieveStore.setSearching(true);
    this.plugin.retrieveStore.setSearchResults([]);

    try {
      const results = await this.plugin.semanticSearch.search(query, {
        topK: this.plugin.settings.searchTopK,
        minScore: this.plugin.settings.searchMinScore,
        mode: this.plugin.retrieveStore.getState().searchMode,
      });
      this.plugin.retrieveStore.setSearchResults(results);
      this.plugin.retrieveStore.setSearching(false);
      await this.plugin.refreshQuota();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.plugin.retrieveStore.setSearchError(msg);
    }
  }

  private renderSearchResults(parent: HTMLElement, results: PageSearchResult[], mode: SearchMode) {
    const header = parent.createDiv({ cls: "mindos-search-results-header" });
    header.createSpan({ cls: "mindos-search-results-count", text: `${results.length} 条结果` });

    const list = parent.createDiv({ cls: "mindos-search-results-list" });
    for (const r of results) {
      this.renderSearchResultItem(list, r, mode);
    }
  }

  private renderSearchResultItem(parent: HTMLElement, r: PageSearchResult, mode: SearchMode) {
    const item = parent.createDiv({ cls: "mindos-search-result-item" });

    const head = item.createDiv({ cls: "mindos-search-result-head" });
    const typeIcon = head.createSpan({ cls: "mindos-search-result-type-icon" });
    setIcon(typeIcon, this.getFileTypeIcon(r.fileType));

    const titleEl = head.createSpan({ cls: "mindos-search-result-title", text: r.fileTitle });
    titleEl.onclick = () => this.plugin.openFile(r.path);

    head.createSpan({
      cls: "mindos-search-result-type",
      text: PAGE_TYPE_LABELS[r.fileType] ?? r.fileType,
    });

    head.createSpan({
      cls: `mindos-search-result-score ${this.scoreToClass(r.topScore)}`,
      text: `${(r.topScore * 100).toFixed(1)}%`,
    });

    const pathEl = item.createDiv({ cls: "mindos-search-result-path" });
    pathEl.setText(r.path);
    pathEl.onclick = () => this.plugin.openFile(r.path);

    if (mode === "page") {
      const preview = item.createDiv({ cls: "mindos-search-result-preview" });
      preview.setText(r.bestPreview);

      if (r.matchedChunks.length > 1) {
        const sections = item.createDiv({ cls: "mindos-search-result-sections" });
        const si = sections.createSpan({ cls: "mindos-search-sections-icon" });
        setIcon(si, "list");
        sections.createSpan({
          cls: "mindos-search-sections-label",
          text: `命中 ${r.matchedChunks.length} 个章节：`,
        });
        for (const ch of r.matchedChunks.slice(0, 5)) {
          const tag = sections.createSpan({ cls: "mindos-search-section-tag" });
          tag.setText(`${ch.chunk.section} (${(ch.score * 100).toFixed(0)}%)`);
          tag.onclick = () => this.plugin.openFile(r.path);
        }
      }
    } else {
      const ch = r.matchedChunks[0];
      const sectionInfo = item.createDiv({ cls: "mindos-search-result-section-info" });
      sectionInfo.createSpan({ cls: "mindos-search-section-tag", text: ch.chunk.section });

      const preview = item.createDiv({ cls: "mindos-search-result-preview chunk-mode" });
      preview.setText(this.makeChunkPreview(ch.chunk.text));
    }

    const ops = item.createDiv({ cls: "mindos-search-result-ops" });

    const openBtn = ops.createEl("button", { cls: "mindos-mini-action-btn" });
    setIcon(openBtn.createSpan(), "external-link");
    openBtn.createSpan({ text: "打开" });
    openBtn.onclick = () => this.plugin.openFile(r.path);

    const askBtn = ops.createEl("button", { cls: "mindos-mini-action-btn" });
    setIcon(askBtn.createSpan(), "message-square");
    askBtn.createSpan({ text: "基于此问答" });
    askBtn.onclick = () => this.startChatWithContext(r);
  }

  private async startChatWithContext(r: PageSearchResult) {
    const session = await this.plugin.createNewChatSession(`关于：${r.fileTitle}`);
    this.plugin.retrieveStore.setCurrentSessionId(session.id);
    this.plugin.retrieveStore.setTab("chat");
    this.plugin.saveCurrentTab("chat");
    setTimeout(() => {
      if (this.chatInputEl) {
        this.chatInputEl.value = `请基于 [[${r.fileTitle}]] 回答：`;
        this.chatInputEl.focus();
        this.chatInputEl.setSelectionRange(this.chatInputEl.value.length, this.chatInputEl.value.length);
      }
    }, 100);
  }

  private renderSearchHints(parent: HTMLElement) {
    const hints = parent.createDiv({ cls: "mindos-search-hints" });
    hints.createDiv({ cls: "mindos-search-hints-title", text: "💡 试试这些查询" });

    const examples = [
      "怎么改 Linux 文件权限",
      "K8s 和 Docker 的区别",
      "Python 性能优化技巧",
      "如何写好周报",
      "我学过的网络知识",
    ];

    const list = hints.createDiv({ cls: "mindos-search-hints-list" });
    for (const ex of examples) {
      const tag = list.createDiv({ cls: "mindos-search-hint-tag" });
      tag.setText(ex);
      tag.onclick = () => {
        if (this.searchInputEl) this.searchInputEl.value = ex;
        this.doSearch(ex);
      };
    }
  }

  // ════════════════════════════════════════════════════════════
  // 索引状态卡 + 配额卡
  // ════════════════════════════════════════════════════════════
  private renderIndexStatusCard(parent: HTMLElement) {
    const card = parent.createDiv({ cls: "mindos-index-card" });

    const head = card.createDiv({ cls: "mindos-index-card-head" });
    const ic = head.createSpan({ cls: "mindos-index-card-icon" });
    setIcon(ic, "database");
    head.createSpan({ cls: "mindos-index-card-title", text: "向量索引" });

    const body = card.createDiv({ cls: "mindos-index-card-body" });
    body.createSpan({ cls: "mindos-index-loading", text: "加载中..." });

    this.plugin.embeddingManager.getStatus().then((status) => {
      body.empty();

      if (status.indexed === 0) {
        body.createDiv({
          cls: "mindos-index-empty",
          text: "⚠️ 向量索引为空，请先点击下方「全量索引」",
        });
      } else {
        const stats = body.createDiv({ cls: "mindos-index-stats" });
        stats.createSpan({ cls: "mindos-index-stat", text: `📚 ${status.pages} 页` });
        stats.createSpan({ cls: "mindos-index-stat", text: `🧩 ${status.indexed} 片段` });
        stats.createSpan({ cls: "mindos-index-stat", text: `🤖 ${status.model || "?"}` });
        stats.createSpan({ cls: "mindos-index-stat", text: `📐 ${status.dim}D` });
        if (status.pending > 0) {
          stats.createSpan({ cls: "mindos-index-stat is-pending", text: `⏳ ${status.pending} 待处理` });
        }
      }

      const progress = this.plugin.retrieveStore.getState().vectorizeProgress;
      if (progress.status === "running") {
        const pwrap = body.createDiv({ cls: "mindos-vectorize-progress" });
        const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
        const bar = pwrap.createDiv({ cls: "mindos-vp-bar" });
        bar.createDiv({ cls: "mindos-vp-bar-fill" }).style.width = `${pct}%`;
        pwrap.createDiv({
          cls: "mindos-vp-text",
          text: `向量化中 ${progress.done}/${progress.total}（${pct}%）${progress.currentFile ? " · " + this.shortenPath(progress.currentFile) : ""}`,
        });
        if (progress.actualTokens > 0) {
          pwrap.createDiv({
            cls: "mindos-vp-tokens",
            text: `已用 ${TokenEstimator.formatTokens(progress.actualTokens)} tokens`,
          });
        }
      }

      const ops = body.createDiv({ cls: "mindos-index-ops" });

      const checkBtn = ops.createEl("button", { cls: "mindos-btn" });
      setIcon(checkBtn.createSpan(), "search-check");
      checkBtn.createSpan({ text: " 检查待同步" });
      checkBtn.onclick = async () => {
        const r = await this.plugin.embeddingManager.checkPendingSync();
        const total = r.toAdd + r.toUpdate;
        if (total === 0 && r.toRemove === 0) {
          new Notice("✅ 索引已是最新");
        } else {
          new Notice(
            `📊 待新增: ${r.toAdd} / 待更新: ${r.toUpdate} / 待删除: ${r.toRemove}\n预计 ${TokenEstimator.formatTokens(r.estimatedTokens)} tokens`,
            5000,
          );
        }
      };

      const syncBtn = ops.createEl("button", { cls: "mindos-btn is-primary" });
      setIcon(syncBtn.createSpan(), "refresh-cw");
      syncBtn.createSpan({ text: " 增量同步" });
      syncBtn.onclick = async () => {
        const r = await this.plugin.embeddingManager.syncIncremental();
        new Notice(r.message);
        this.render();
      };

      const fullBtn = ops.createEl("button", { cls: "mindos-btn" });
      setIcon(fullBtn.createSpan(), "rotate-ccw");
      fullBtn.createSpan({ text: " 全量索引" });
      fullBtn.onclick = async () => {
        if (!confirm("全量索引会清空所有现有向量并重新计算，确定继续？")) return;
        const r = await this.plugin.embeddingManager.vectorizeAll();
        new Notice(r.message);
        this.render();
      };

      const clearBtn = ops.createEl("button", { cls: "mindos-btn is-danger-text" });
      setIcon(clearBtn.createSpan(), "trash-2");
      clearBtn.createSpan({ text: " 清空" });
      clearBtn.onclick = async () => {
        if (!confirm("确定清空所有向量索引？")) return;
        await this.plugin.embeddingManager.clearAll();
        new Notice("✅ 已清空");
        this.render();
      };
    });
  }

  private renderQuotaCard(parent: HTMLElement) {
    const card = parent.createDiv({ cls: "mindos-quota-card" });
    const quota = this.plugin.retrieveStore.getState().quota;
    const limit = this.plugin.settings.dailyTokenLimit;

    const head = card.createDiv({ cls: "mindos-quota-head" });
    const ic = head.createSpan({ cls: "mindos-quota-icon" });
    setIcon(ic, "wallet");
    head.createSpan({ cls: "mindos-quota-title", text: "今日配额" });

    if (limit > 0) {
      const pct = Math.min(100, (quota.todayUsedTokens / limit) * 100);
      const bar = card.createDiv({ cls: "mindos-quota-bar" });
      const fill = bar.createDiv({ cls: "mindos-quota-bar-fill" });
      fill.style.width = `${pct}%`;
      if (pct >= 80) fill.addClass("is-warning");
      if (pct >= 95) fill.addClass("is-danger");
    }

    const text = card.createDiv({ cls: "mindos-quota-text" });
    if (limit > 0) {
      text.createSpan({
        cls: "mindos-quota-used",
        text: `${TokenEstimator.formatTokens(quota.todayUsedTokens)} / ${TokenEstimator.formatTokens(limit)} tokens`,
      });
    } else {
      text.createSpan({
        cls: "mindos-quota-used",
        text: `${TokenEstimator.formatTokens(quota.todayUsedTokens)} tokens（无上限）`,
      });
    }
    text.createSpan({
      cls: "mindos-quota-cost",
      text: ` · ${TokenEstimator.formatCost(quota.todayUsedCostCny)}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // 问答 Tab
  // ════════════════════════════════════════════════════════════
  private renderChatTab(parent: HTMLElement) {
    const state = this.plugin.retrieveStore.getState();

    this.renderSessionBar(parent);

    const main = parent.createDiv({ cls: "mindos-chat-main" });

    // ✅ 历史对话面板可折叠
    if (!this.sessionListCollapsed) {
      this.renderSessionList(main);
    } else {
      this.renderSessionListCollapsed(main);
    }

    const chatArea = main.createDiv({ cls: "mindos-chat-area" });

    const session = state.sessions.find((s) => s.id === state.currentSessionId);
    if (!session) {
      this.renderChatEmpty(chatArea);
    } else {
      this.renderChatBody(chatArea, session);
    }

    this.renderChatInput(parent);
  }

  private renderSessionBar(parent: HTMLElement) {
    const state = this.plugin.retrieveStore.getState();
    const session = state.sessions.find((s) => s.id === state.currentSessionId);

    const bar = parent.createDiv({ cls: "mindos-session-bar" });

    // ✅ 折叠/展开按钮（左侧紧贴）
    const toggleBtn = bar.createEl("button", { cls: "mindos-icon-btn mindos-session-toggle" });
    setIcon(toggleBtn, this.sessionListCollapsed ? "panel-left-open" : "panel-left-close");
    toggleBtn.setAttribute(
      "title",
      this.sessionListCollapsed
        ? `展开对话历史 (${state.sessions.length})`
        : "折叠对话历史",
    );
    toggleBtn.onclick = () => {
      this.sessionListCollapsed = !this.sessionListCollapsed;
      this.render();
    };

    const titleWrap = bar.createDiv({ cls: "mindos-session-title-wrap" });
    if (session) {
      const ti = titleWrap.createSpan({ cls: "mindos-session-title-icon" });
      setIcon(ti, "message-square");
      const title = titleWrap.createSpan({
        cls: "mindos-session-title",
        text: session.title,
      });
      title.onclick = () => this.promptRenameSession(session);
      titleWrap.createSpan({
        cls: "mindos-session-meta",
        text: `${session.messages.length} 条消息`,
      });
    } else {
      titleWrap.createSpan({
        cls: "mindos-session-title",
        text: "未选择会话",
      });
    }

    const ops = bar.createDiv({ cls: "mindos-session-ops" });

    const newBtn = ops.createEl("button", { cls: "mindos-btn is-primary" });
    setIcon(newBtn.createSpan(), "plus");
    newBtn.createSpan({ text: " 新对话" });
    newBtn.onclick = async () => {
      const s = await this.plugin.createNewChatSession();
      this.plugin.retrieveStore.setCurrentSessionId(s.id);
      setTimeout(() => this.chatInputEl?.focus(), 100);
    };

    if (session && session.messages.length > 0) {
      const exportBtn = ops.createEl("button", { cls: "mindos-btn" });
      setIcon(exportBtn.createSpan(), "download");
      exportBtn.createSpan({ text: " 导出" });
      exportBtn.onclick = async () => {
        try {
          const path = await this.plugin.exportChatSession(session.id);
          new Notice(`✅ 已导出：${path}`);
          await this.plugin.openFile(path);
        } catch (e) {
          new Notice(`❌ 导出失败：${e}`);
        }
      };

      const delBtn = ops.createEl("button", { cls: "mindos-btn is-danger-text" });
      setIcon(delBtn.createSpan(), "trash-2");
      delBtn.createSpan({ text: " 删除" });
      delBtn.onclick = async () => {
        if (!confirm(`确定删除会话「${session.title}」？`)) return;
        await this.plugin.deleteChatSession(session.id);
        new Notice("✅ 已删除");
      };
    }
  }
  private renderSessionList(parent: HTMLElement) {
    const state = this.plugin.retrieveStore.getState();
    const list = parent.createDiv({ cls: "mindos-session-list" });

    list.createDiv({ cls: "mindos-session-list-title", text: "💬 对话历史" });

    if (state.sessions.length === 0) {
      list.createDiv({ cls: "mindos-empty", text: "暂无对话" });
      return;
    }

    const scroll = list.createDiv({ cls: "mindos-session-list-scroll" });
    for (const s of state.sessions) {
      const item = scroll.createDiv({
        cls: `mindos-session-item ${s.id === state.currentSessionId ? "is-active" : ""}`,
      });
      item.createDiv({
        cls: "mindos-session-item-title",
        text: s.title,
      });
      const meta = item.createDiv({ cls: "mindos-session-item-meta" });
      meta.createSpan({ text: `${s.messages.length} 条` });
      meta.createSpan({ text: " · " });
      meta.createSpan({ text: this.formatRelativeTime(s.updatedAt) });

      item.onclick = () => {
        this.plugin.retrieveStore.setCurrentSessionId(s.id);
      };
    }
  }

  /**
   * ✅ 折叠状态的历史列表（细窄版）
   */
  private renderSessionListCollapsed(parent: HTMLElement) {
    const state = this.plugin.retrieveStore.getState();
    const list = parent.createDiv({ cls: "mindos-session-list is-collapsed" });

    if (state.sessions.length === 0) return;

    const scroll = list.createDiv({ cls: "mindos-session-list-scroll" });
    for (const s of state.sessions.slice(0, 8)) {
      const item = scroll.createDiv({
        cls: `mindos-session-item-mini ${s.id === state.currentSessionId ? "is-active" : ""}`,
      });
      item.setAttribute("title", s.title);
      const ic = item.createSpan();
      setIcon(ic, "message-square");
      item.onclick = () => {
        this.plugin.retrieveStore.setCurrentSessionId(s.id);
      };
    }
  }

  private renderChatEmpty(parent: HTMLElement) {
    const empty = parent.createDiv({ cls: "mindos-chat-empty" });
    const ic = empty.createSpan({ cls: "mindos-chat-empty-icon" });
    setIcon(ic, "message-square-plus");
    empty.createDiv({ cls: "mindos-chat-empty-title", text: "开始一段新对话" });
    empty.createDiv({
      cls: "mindos-chat-empty-desc",
      text: "MindOS 将基于你的 Wiki 知识库回答问题",
    });

    const examples = empty.createDiv({ cls: "mindos-chat-empty-examples" });
    const exList = [
      "我的 Wiki 中关于 Linux 的内容有哪些？",
      "总结一下我对 K8s 的理解",
      "我学过哪些设计模式？",
      "帮我对比 Docker 和 Podman",
    ];
    for (const ex of exList) {
      const t = examples.createDiv({ cls: "mindos-chat-empty-example" });
      t.setText(ex);
      t.onclick = async () => {
        const session = await this.plugin.createNewChatSession();
        this.plugin.retrieveStore.setCurrentSessionId(session.id);
        setTimeout(() => {
          if (this.chatInputEl) {
            this.chatInputEl.value = ex;
            this.submitChat();
          }
        }, 100);
      };
    }
  }

  private renderChatBody(parent: HTMLElement, session: ChatSession) {
    const scroll = parent.createDiv({ cls: "mindos-chat-scroll" });
    this.chatScrollEl = scroll;

    console.log("[MindOS View] renderChatBody", {
      sessionId: session.id,
      messageCount: session.messages?.length ?? 0,
      messages: (session.messages ?? []).map(m => ({
        id: m.id,
        role: m.role,
        contentLen: m.content?.length ?? 0,
      })),
    });

    if (!session.messages || session.messages.length === 0) {
      const empty = scroll.createDiv({ cls: "mindos-empty" });
      empty.setText("空对话，开始提问吧");
      // 即使没有消息，也要显示流式内容
      this.appendStreamingIfAny(scroll);
      return;
    }

    // ✅ 不再做去重，直接渲染（去重那段代码可能误伤）
    for (const msg of session.messages) {
      this.renderChatMessage(scroll, msg);
    }

    this.appendStreamingIfAny(scroll);

    const state = this.plugin.retrieveStore.getState();
    if (state.chatError) {
      const err = scroll.createDiv({ cls: "mindos-chat-error" });
      const ei = err.createSpan({ cls: "mindos-chat-error-icon" });
      setIcon(ei, "alert-circle");
      err.createSpan({ text: state.chatError });
    }

    requestAnimationFrame(() => {
      if (this.chatScrollEl) {
        this.chatScrollEl.scrollTop = this.chatScrollEl.scrollHeight;
      }
    });
  }

  /**
   * ✅ 新增辅助：渲染流式内容（如果有）
   */
  private appendStreamingIfAny(scroll: HTMLElement) {
    const state = this.plugin.retrieveStore.getState();
    if (state.isChatting && state.chatStreamingContent) {
      this.renderChatMessage(scroll, {
        id: "_streaming",
        role: "assistant",
        content: state.chatStreamingContent + " ▌",
        createdAt: "",
      });
    }
  }

  private renderChatMessage(parent: HTMLElement, msg: ChatMessage) {
    const item = parent.createDiv({
      cls: `mindos-chat-msg role-${msg.role}`,
    });

    const head = item.createDiv({ cls: "mindos-chat-msg-head" });
    const ic = head.createSpan({ cls: "mindos-chat-msg-icon" });
    setIcon(ic, msg.role === "user" ? "user" : "bot");
    head.createSpan({
      cls: "mindos-chat-msg-role",
      text: msg.role === "user" ? "你" : "MindOS",
    });

    if (msg.tokens) {
      head.createSpan({
        cls: "mindos-chat-msg-tokens",
        text: `${TokenEstimator.formatTokens(msg.tokens)} tokens`,
      });
    }

    const body = item.createDiv({ cls: "mindos-chat-msg-body" });
    try {
      MarkdownRenderer.render(
        this.plugin.app,
        msg.content,
        body,
        "",
        this.mdComponent,
      );
    } catch {
      body.setText(msg.content);
    }

    if (msg.citations && msg.citations.length > 0) {
      this.renderCitations(item, msg.citations);
    }
  }

  private renderCitations(parent: HTMLElement, citations: ChatCitation[]) {
    const wrap = parent.createDiv({ cls: "mindos-chat-citations" });
    const head = wrap.createDiv({ cls: "mindos-chat-citations-head" });
    const ci = head.createSpan({ cls: "mindos-chat-citations-icon" });
    setIcon(ci, "link");
    head.createSpan({
      cls: "mindos-chat-citations-title",
      text: `📎 引用 (${citations.length})`,
    });

    const list = wrap.createDiv({ cls: "mindos-chat-citations-list" });
    for (const c of citations) {
      const item = list.createDiv({ cls: "mindos-citation-item" });

      const titleRow = item.createDiv({ cls: "mindos-citation-title-row" });
      const titleEl = titleRow.createSpan({
        cls: "mindos-citation-title",
        text: c.fileTitle,
      });
      titleEl.onclick = () => this.plugin.openFile(c.path);

      titleRow.createSpan({
        cls: "mindos-citation-section",
        text: c.section,
      });

      titleRow.createSpan({
        cls: `mindos-citation-score ${this.scoreToClass(c.score)}`,
        text: `${(c.score * 100).toFixed(0)}%`,
      });

      const preview = item.createDiv({ cls: "mindos-citation-preview" });
      preview.setText(c.preview);
    }
  }

  private renderChatInput(parent: HTMLElement) {
    const state = this.plugin.retrieveStore.getState();
    const wrap = parent.createDiv({ cls: "mindos-chat-input-wrap" });

    const inputRow = wrap.createDiv({ cls: "mindos-chat-input-row" });

    const textarea = inputRow.createEl("textarea", { cls: "mindos-chat-input" });
    textarea.placeholder = state.isChatting
      ? "MindOS 正在回答..."
      : "提问 Wiki（Enter 发送，Shift+Enter 换行）";
    textarea.disabled = state.isChatting;

    // ✅ 缓存引用（焦点恢复用）
    this.chatInputEl = textarea;

    // ✅ IME 输入兼容
    textarea.addEventListener("compositionstart", () => { this.isComposing = true; });
    textarea.addEventListener("compositionend", () => { this.isComposing = false; });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !this.isComposing) {
        e.preventDefault();
        this.submitChat();
      }
    });

    textarea.addEventListener("input", () => {
      // ✅ 仅调整高度，不更新 store（store 不需要保存输入中的草稿）
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
    });

    const btnCol = inputRow.createDiv({ cls: "mindos-chat-input-btns" });

    if (state.isChatting) {
      const stopBtn = btnCol.createEl("button", { cls: "mindos-chat-stop-btn" });
      setIcon(stopBtn.createSpan(), "square");
      stopBtn.createSpan({ text: " 停止" });
      stopBtn.onclick = () => this.plugin.ragChat.abort();
    } else {
      const sendBtn = btnCol.createEl("button", { cls: "mindos-chat-send-btn" });
      setIcon(sendBtn.createSpan(), "send");
      sendBtn.onclick = () => this.submitChat();
    }
  }

  private async submitChat() {
    if (!this.chatInputEl) return;
    const text = this.chatInputEl.value.trim();
    if (!text) return;

    const state = this.plugin.retrieveStore.getState();
    if (state.isChatting) return;

    let session = state.sessions.find((s) => s.id === state.currentSessionId);
    if (!session) {
      session = await this.plugin.createNewChatSession();
      this.plugin.retrieveStore.setCurrentSessionId(session.id);
    }

    this.chatInputEl.value = "";
    this.chatInputEl.style.height = "auto";

    await this.plugin.askChat(session, text);
  }

  private async promptRenameSession(session: ChatSession) {
    const newTitle = prompt("重命名会话：", session.title);
    if (newTitle && newTitle.trim()) {
      await this.plugin.renameChatSession(session.id, newTitle.trim());
    }
  }

  // ════════════════════════════════════════════════════════════
  // 辅助
  // ════════════════════════════════════════════════════════════
  private getFileTypeIcon(type: string): string {
    const map: Record<string, string> = {
      entity: "user",
      concept: "lightbulb",
      topic: "book-open",
      comparison: "git-compare",
      overview: "map",
      raw: "file-text",
    };
    return map[type] ?? "file";
  }

  private scoreToClass(score: number): string {
    if (score >= 0.85) return "is-excellent";
    if (score >= 0.7) return "is-good";
    if (score >= 0.5) return "is-medium";
    return "is-low";
  }

  private shortenPath(path: string): string {
    const parts = path.split("/");
    if (parts.length <= 2) return path;
    return `…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }

  private makeChunkPreview(text: string): string {
    const lines = text.split("\n");
    if (lines[0] && /^#{1,6}\s+/.test(lines[0])) lines.shift();
    return lines.join("\n").substring(0, 400);
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
}