import {
  setIcon,
  MarkdownRenderer,
  Component,
  Notice,
} from "obsidian";
import type MindOSPlugin from "../../../main";
import {
  RecallCard,
  RecallScenario,
  RecallRating,
  RecallSession,
} from "../../core/types";
import {
  RECALL_SCENARIO_META,
} from "../../core/constants";

export class RecallView {
  private mdComponent: Component;
  private cardStartTime = 0;
  private answerInputEl: HTMLTextAreaElement | null = null;
  private answerInputCache = "";  // 缓存当前题答案输入
  private isComposing = false;
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
  // v0.7 TTS 自动朗读
  private lastAutoSpokenCardId = "";   // 防止同一张卡重复自动朗读
  private isSpeaking = false;          // 朗读中标志（用于 UI 反馈）

  constructor(private plugin: MindOSPlugin) {
    this.mdComponent = new Component();
  }

  unload() {
    this.mdComponent.unload();
    this.removeKeyboardListener();
  }

  // ════════════════════════════════════════════════════════════
  // 主渲染入口
  // ════════════════════════════════════════════════════════════
  render(parent: HTMLElement) {
    const state = this.plugin.recallStore.getState();

    // ✅ 修改：面试场景特殊路由（含模拟面试子状态）
    if (
      state.selectedScenario === "interview" &&
      !state.currentSession &&
      state.viewMode !== "card_manager"
    ) {
      // 检查是否在模拟面试中
      if (this.plugin.mockInterviewView.isInSession() ||
          (this.plugin.mockInterviewView as any).state?.finishedAt) {
        this.plugin.mockInterviewView.render(parent);
      } else {
        this.plugin.interviewView.render(parent);
      }
      return;
    }

    if (state.currentSession && state.currentCard) {
      this.attachKeyboardListener();
    } else {
      this.removeKeyboardListener();
    }

    const activeEl = document.activeElement as HTMLElement | null;
    let savedAnswer: { selectionStart: number; selectionEnd: number; value: string } | null = null;
    if (activeEl === this.answerInputEl && this.answerInputEl) {
      savedAnswer = {
        selectionStart: this.answerInputEl.selectionStart ?? 0,
        selectionEnd: this.answerInputEl.selectionEnd ?? 0,
        value: this.answerInputEl.value,
      };
    }

    this.answerInputEl = null;

    // ✅ v0.6.5 新增：根据 viewMode 路由到不同界面
    if (state.viewMode === "card_manager") {
      this.plugin.cardManagerView.render(parent);
    } else if (state.currentSession && state.currentCard) {
      this.renderReviewSession(parent);
    } else if (state.currentSession && !state.currentCard) {
      this.renderSessionSummary(parent);
    } else {
      this.renderScenarioHome(parent);
    }

    if (savedAnswer && this.answerInputEl) {
      requestAnimationFrame(() => {
        if (this.answerInputEl) {
          this.answerInputEl.value = savedAnswer!.value;
          this.answerInputEl.focus();
          try {
            this.answerInputEl.setSelectionRange(savedAnswer!.selectionStart, savedAnswer!.selectionEnd);
          } catch {}
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 键盘快捷键
  // ════════════════════════════════════════════════════════════
  private attachKeyboardListener() {
    if (this.keyboardHandler) return;

    this.keyboardHandler = (e: KeyboardEvent) => {
      const state = this.plugin.recallStore.getState();
      if (!state.currentCard) return;

      // 输入法组合中，不处理快捷键
      if (e.isComposing || this.isComposing) return;

      const target = e.target as HTMLElement | null;
      const inEditable = this.isEditableTarget(target);

      // ✅ 在输入框/可编辑区域中：
      // - 允许正常输入
      // - 仅保留 Ctrl+Enter 翻转
      if (inEditable) {
        if (
          target === this.answerInputEl &&
          e.key === "Enter" &&
          (e.ctrlKey || e.metaKey) &&
          !state.isFlipped
        ) {
          e.preventDefault();
          this.flipCard();
        }
        return;
      }

      // ✅ 非输入态：处理快捷键
      if (!state.isFlipped) {
        // vocab 场景自定义朗读快捷键
        if (state.currentCard.scenario === "vocab") {
          const hk1 = (this.plugin.settings.recallVocabTTSHotkey ?? "Shift+Space").trim();
          const hk2 = (this.plugin.settings.recallVocabTTSHotkeyAlt ?? "Alt+S").trim();

          if (
            (hk1 && this.matchHotkey(e, hk1)) ||
            (hk2 && this.matchHotkey(e, hk2))
          ) {
            e.preventDefault();
            e.stopPropagation();
            this.speakCurrentVocab(state.currentCard);
            return;
          }
        }

        // ✅ autoSpeak 开启后：
        // 仅在“非输入态”下，Space = 重读，Enter = 翻转
        if (
          state.currentCard.scenario === "vocab" &&
          this.plugin.settings.recallVocabAutoSpeak
        ) {
          if (e.code === "Space") {
            e.preventDefault();
            e.stopPropagation();
            this.speakCurrentVocab(state.currentCard);
            return;
          }

          if (e.code === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            this.flipCard();
            return;
          }
        }

        // 默认行为：Space / Enter 翻转
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.flipCard();
          return;
        }
      } else {
        // 已翻转：1/2/3/4 评分
        if (e.key === "1") {
          e.preventDefault();
          this.submitRating(state.currentCard, 1);
        } else if (e.key === "2") {
          e.preventDefault();
          this.submitRating(state.currentCard, 2);
        } else if (e.key === "3") {
          e.preventDefault();
          this.submitRating(state.currentCard, 3);
        } else if (e.key === "4") {
          e.preventDefault();
          this.submitRating(state.currentCard, 4);
        }
      }
    };

    // ✅ 不用 capture=true，避免过早截获输入事件
    window.addEventListener("keydown", this.keyboardHandler);
  }
  private removeKeyboardListener() {
    if (this.keyboardHandler) {
      window.removeEventListener("keydown", this.keyboardHandler);
      this.keyboardHandler = null;
    }
  }

  private flipCard() {
    // 缓存答案
    if (this.answerInputEl) {
      this.answerInputCache = this.answerInputEl.value;
    }
    this.plugin.recallStore.flipCard();
  }

  // ════════════════════════════════════════════════════════════
  // 场景主页
  // ════════════════════════════════════════════════════════════
  private renderScenarioHome(parent: HTMLElement) {
    // ✅ 新增：场景主页顶部工具栏
    this.renderHomeToolbar(parent);

    this.renderTodayBanner(parent);

    const grid = parent.createDiv({ cls: "mindos-recall-scenario-grid" });

    const scenarios = Object.entries(RECALL_SCENARIO_META) as Array<
      [RecallScenario, typeof RECALL_SCENARIO_META[string]]
    >;

    for (const [scenario, meta] of scenarios) {
      this.renderScenarioCard(grid, scenario, meta, parent);
    }

    this.renderWikiGenSection(parent);
  }

  /**
   * ✅ 新增：场景主页顶部工具栏（含「管理卡片」入口）
   */
  private renderHomeToolbar(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: "mindos-recall-home-toolbar" });

    bar.createDiv({ cls: "mindos-recall-home-toolbar-spacer" });

    // ✅ 新增：数据看板按钮
    const dashboardBtn = bar.createEl("button", { cls: "mindos-btn" });
    setIcon(dashboardBtn.createSpan(), "bar-chart-3");
    dashboardBtn.createSpan({ text: " 数据看板" });
    dashboardBtn.onclick = () => this.openDashboard();

    const manageBtn = bar.createEl("button", { cls: "mindos-btn" });
    setIcon(manageBtn.createSpan(), "list");
    manageBtn.createSpan({ text: " 管理卡片" });
    manageBtn.onclick = () => {
      this.plugin.recallStore.setManagerScenario("wiki");
      this.plugin.recallStore.setViewMode("card_manager");
    };
  }

  private renderTodayBanner(parent: HTMLElement) {
    const state = this.plugin.recallStore.getState();
    const stats = state.todayStats;

    const banner = parent.createDiv({ cls: "mindos-recall-today-banner" });

    const left = banner.createDiv({ cls: "mindos-recall-today-left" });
    const titleRow = left.createDiv({ cls: "mindos-recall-today-title-row" });
    const ic = titleRow.createSpan({ cls: "mindos-recall-today-icon" });
    setIcon(ic, "calendar-check");
    titleRow.createSpan({ cls: "mindos-recall-today-title", text: "今日复习" });

    if (stats && stats.totalReviewed > 0) {
      const acc = stats.totalReviewed > 0
        ? Math.round((stats.correctCount / stats.totalReviewed) * 100)
        : 0;
      const timeStr = this.formatDuration(stats.timeSpentMs);

      const statRow = left.createDiv({ cls: "mindos-recall-today-stats" });
      this.makeStatChip(statRow, "check-circle", `${stats.totalReviewed} 张`, "已复习");
      this.makeStatChip(statRow, "target", `${acc}%`, "正确率");
      this.makeStatChip(statRow, "clock", timeStr, "用时");
      if (stats.newCards > 0) {
        this.makeStatChip(statRow, "sparkles", `${stats.newCards} 张`, "新卡片");
      }
    } else {
      left.createDiv({
        cls: "mindos-recall-today-empty",
        text: "今天还没有复习，开始吧 🎯",
      });
    }

    const right = banner.createDiv({ cls: "mindos-recall-today-right" });
    if (stats && stats.totalReviewed > 0) {
      const streak = right.createDiv({ cls: "mindos-recall-streak" });
      setIcon(streak.createSpan(), "flame");
      streak.createSpan({ text: " 继续保持！" });
    }
  }

  private makeStatChip(
    parent: HTMLElement,
    icon: string,
    value: string,
    label: string,
  ) {
    const chip = parent.createDiv({ cls: "mindos-recall-stat-chip" });
    const ic = chip.createSpan({ cls: "mindos-recall-stat-chip-icon" });
    setIcon(ic, icon);
    chip.createSpan({ cls: "mindos-recall-stat-chip-value", text: value });
    chip.createSpan({ cls: "mindos-recall-stat-chip-label", text: label });
  }

  private renderScenarioCard(
    parent: HTMLElement,
    scenario: RecallScenario,
    meta: typeof RECALL_SCENARIO_META[string],
    rootParent: HTMLElement,
  ) {
    const card = parent.createDiv({ cls: "mindos-recall-scenario-card" });

    const loading = card.createDiv({ cls: "mindos-recall-scenario-loading" });
    const li = loading.createSpan();
    setIcon(li, "loader-2");
    loading.createSpan({ text: " 加载中..." });

    this.plugin.recallCardStore.getScenarioStats(scenario).then((stats) => {
      card.empty();

      const head = card.createDiv({ cls: "mindos-recall-scenario-head" });
      const iconWrap = head.createDiv({ cls: "mindos-recall-scenario-icon-wrap" });
      setIcon(iconWrap.createSpan(), meta.icon);
      head.createDiv({ cls: "mindos-recall-scenario-label", text: meta.label });

      if (stats.dueCount > 0) {
        head.createDiv({
          cls: "mindos-recall-scenario-due-badge",
          text: String(stats.dueCount),
        });
      }

      card.createDiv({
        cls: "mindos-recall-scenario-desc",
        text: meta.description,
      });

      const statRow = card.createDiv({ cls: "mindos-recall-scenario-stats" });
      if (stats.total === 0) {
        statRow.createSpan({
          cls: "mindos-recall-scenario-no-cards",
          text: "暂无卡片",
        });
      } else {
        statRow.createSpan({
          cls: "mindos-recall-scenario-stat",
          text: `📚 ${stats.total} 张`,
        });
        if (stats.newCount > 0) {
          statRow.createSpan({
            cls: "mindos-recall-scenario-stat is-new",
            text: `✨ ${stats.newCount} 新`,
          });
        }
        if (stats.dueCount > 0) {
          statRow.createSpan({
            cls: "mindos-recall-scenario-stat is-due",
            text: `⏰ ${stats.dueCount} 待复习`,
          });
        }
        if (stats.masteredCount > 0) {
          statRow.createSpan({
            cls: "mindos-recall-scenario-stat is-mastered",
            text: `✅ ${stats.masteredCount} 已掌握`,
          });
        }
      }

      const btnRow = card.createDiv({ cls: "mindos-recall-scenario-btns" });

      if (stats.dueCount > 0 || stats.newCount > 0) {
        const startBtn = btnRow.createEl("button", {
          cls: "mindos-btn is-primary",
        });
        setIcon(startBtn.createSpan(), "play");
        startBtn.createSpan({
          text: ` 开始复习 (${stats.dueCount + stats.newCount})`,
        });
        startBtn.onclick = () => this.startSession(scenario);
      } else if (stats.total > 0) {
        const doneEl = btnRow.createDiv({ cls: "mindos-recall-all-done" });
        setIcon(doneEl.createSpan(), "party-popper");
        doneEl.createSpan({ text: " 今日已完成！" });
      }

      if (scenario === "wiki") {
        const genBtn = btnRow.createEl("button", { cls: "mindos-btn" });
        setIcon(genBtn.createSpan(), "sparkles");
        genBtn.createSpan({ text: " 生成卡片" });
        genBtn.onclick = (e) => {
          e.stopPropagation();
          this.toggleWikiGenPanel(rootParent);
        };
      }
            // ✅ 新增：命令行场景的「生成卡片」按钮
      if (scenario === "command") {
        const genBtn = btnRow.createEl("button", { cls: "mindos-btn" });
        setIcon(genBtn.createSpan(), "sparkles");
        genBtn.createSpan({ text: " 生成卡片" });
        genBtn.onclick = (e) => {
          e.stopPropagation();
          this.toggleCommandGenPanel(rootParent);
        };
      }

            // ✅ 新增：单词场景的「词库管理」按钮
      if (scenario === "vocab") {
        const wlBtn = btnRow.createEl("button", { cls: "mindos-btn" });
        setIcon(wlBtn.createSpan(), "book-open-check");
        wlBtn.createSpan({ text: " 词库管理" });
        wlBtn.onclick = (e) => {
          e.stopPropagation();
          this.openWordListManager();
        };
      }

            // ✅ 新增：每个场景卡片都有「管理」按钮
      if (stats.total > 0) {
        const mgrBtn = btnRow.createEl("button", { cls: "mindos-btn" });
        setIcon(mgrBtn.createSpan(), "list");
        mgrBtn.createSpan({ text: " 管理" });
        mgrBtn.onclick = (e) => {
          e.stopPropagation();
          this.plugin.recallStore.setManagerScenario(scenario);
          this.plugin.recallStore.setViewMode("card_manager");
        };
      }

            // ✅ 新增：概念场景的「生成卡片」按钮
      if (scenario === "concept") {
        const genBtn = btnRow.createEl("button", { cls: "mindos-btn" });
        setIcon(genBtn.createSpan(), "sparkles");
        genBtn.createSpan({ text: " 生成卡片" });
        genBtn.onclick = (e) => {
          e.stopPropagation();
          this.openConceptGenerator();
        };
      }

      // ✅ 新增：多语言场景的「添加短语」按钮
      if (scenario === "phrase") {
        const addBtn = btnRow.createEl("button", { cls: "mindos-btn" });
        setIcon(addBtn.createSpan(), "plus-circle");
        addBtn.createSpan({ text: " 添加短语" });
        addBtn.onclick = (e) => {
          e.stopPropagation();
          this.openPhraseGenerator();
        };
      }

            // ✅ 新增：面试场景特殊入口（点击直接进入面试主面板）
      if (scenario === "interview") {
        const enterBtn = btnRow.createEl("button", { cls: "mindos-btn" });
        setIcon(enterBtn.createSpan(), "briefcase");
        enterBtn.createSpan({ text: " 进入面试助手" });
        enterBtn.onclick = (e) => {
          e.stopPropagation();
          this.plugin.recallStore.setSelectedScenario("interview");
          // 触发 render
          this.plugin.recallStore.reset();
          this.plugin.recallStore.setSelectedScenario("interview");
        };
      }

            // ✅ 新增：自定义场景的「场景管理」按钮
      if (scenario === "custom") {
        const mgmtBtn = btnRow.createEl("button", { cls: "mindos-btn" });
        setIcon(mgmtBtn.createSpan(), "settings-2");
        mgmtBtn.createSpan({ text: " 场景管理" });
        mgmtBtn.onclick = (e) => {
          e.stopPropagation();
          this.openCustomScenarioManager();
        };
      }
    }).catch(() => {
      card.empty();
      card.createDiv({
        cls: "mindos-recall-scenario-error",
        text: "加载失败",
      });
    });
  }

  private renderWikiGenSection(parent: HTMLElement) {
    const sec = parent.createDiv({ cls: "mindos-recall-wiki-gen-hint" });
    const ic = sec.createSpan({ cls: "mindos-recall-wiki-gen-icon" });
    setIcon(ic, "lightbulb");
    sec.createSpan({
      cls: "mindos-recall-wiki-gen-text",
      text: "💡 点击 Wiki 复习卡片中的「生成卡片」，自动从你的知识库生成复习题",
    });
  }

  // ════════════════════════════════════════════════════════════
  // Wiki 生成面板（内嵌版）
  // ════════════════════════════════════════════════════════════
  private toggleWikiGenPanel(parent: HTMLElement) {
    const existing = parent.querySelector(".mindos-recall-gen-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.showWikiGenPanel(parent);
  }

  private showWikiGenPanel(parent: HTMLElement) {
    const panel = parent.createDiv({ cls: "mindos-recall-gen-panel is-inline" });

    const head = panel.createDiv({ cls: "mindos-recall-gen-panel-head" });
    const hi = head.createSpan();
    setIcon(hi, "sparkles");
    head.createSpan({ text: " 生成 Wiki 复习卡片" });
    const closeBtn = head.createEl("button", { cls: "mindos-icon-btn" });
    setIcon(closeBtn, "x");
    closeBtn.onclick = () => panel.remove();

    const opts = panel.createDiv({ cls: "mindos-recall-gen-opts" });

    const maxRow = opts.createDiv({ cls: "mindos-recall-gen-opt-row" });
    maxRow.createSpan({ text: "每页最多生成：" });
    const maxSelect = maxRow.createEl("select", { cls: "mindos-recall-gen-select" });
    [1, 2, 3, 5].forEach((n) => {
      const opt = maxSelect.createEl("option", { value: String(n), text: `${n} 张` });
      if (n === 3) opt.selected = true;
    });

    const onlyNewRow = opts.createDiv({ cls: "mindos-recall-gen-opt-row" });
    onlyNewRow.createSpan({ text: "跳过已有卡片的页面：" });
    const onlyNewCheck = onlyNewRow.createEl("input");
    onlyNewCheck.type = "checkbox";
    onlyNewCheck.checked = true;

    const progressWrap = panel.createDiv({ cls: "mindos-recall-gen-progress" });
    progressWrap.style.display = "none";

    const progressBar = progressWrap.createDiv({ cls: "mindos-vp-bar" });
    const progressFill = progressBar.createDiv({ cls: "mindos-vp-bar-fill" });
    const progressText = progressWrap.createDiv({ cls: "mindos-vp-text" });

    const btnRow = panel.createDiv({ cls: "mindos-recall-gen-btn-row" });
    const genBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(genBtn.createSpan(), "sparkles");
    genBtn.createSpan({ text: " 开始生成" });

    genBtn.onclick = async () => {
      genBtn.disabled = true;
      progressWrap.style.display = "block";
      this.plugin.recallStore.setGenerating(true);

      try {
        await this.plugin.recallWikiGenerator.generateFromWiki(
          {
            maxCardsPerPage: parseInt(maxSelect.value),
            onlyNewPages: onlyNewCheck.checked,
          },
          (p) => {
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            progressFill.style.width = `${pct}%`;
            progressText.setText(
              `${p.done}/${p.total} 页面 · 已生成 ${p.newCards} 张卡片${p.currentFile ? " · " + this.shortenPath(p.currentFile) : ""}`,
            );
          },
        );

        this.plugin.recallStore.setGenerating(false);
        new Notice("✅ Wiki 卡片生成完成！");
        panel.remove();
        // 触发刷新
        const todayStats = await this.plugin.recallCardStore.getTodayStats();
        this.plugin.recallStore.setTodayStats(todayStats);

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.plugin.recallStore.setGenerating(false, msg);
        new Notice(`❌ 生成失败：${msg}`);
        genBtn.disabled = false;
      }
    };
  }

    // ════════════════════════════════════════════════════════════
  // 命令行生成面板
  // ════════════════════════════════════════════════════════════
  private toggleCommandGenPanel(parent: HTMLElement) {
    const existing = parent.querySelector(".mindos-recall-gen-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.showCommandGenPanel(parent);
  }

  private showCommandGenPanel(parent: HTMLElement) {
    const panel = parent.createDiv({ cls: "mindos-recall-gen-panel is-inline" });

    const head = panel.createDiv({ cls: "mindos-recall-gen-panel-head" });
    const hi = head.createSpan();
    setIcon(hi, "terminal");
    head.createSpan({ text: " 生成命令行复习卡片" });
    const closeBtn = head.createEl("button", { cls: "mindos-icon-btn" });
    setIcon(closeBtn, "x");
    closeBtn.onclick = () => panel.remove();

    const opts = panel.createDiv({ cls: "mindos-recall-gen-opts" });

    // 数据源选择
    const sourceRow = opts.createDiv({ cls: "mindos-recall-gen-opt-row" });
    sourceRow.createSpan({ text: "数据源：" });
    const sourceSelect = sourceRow.createEl("select", { cls: "mindos-recall-gen-select" });
    [
      { value: "both", label: "📚 内置库 + Wiki 扫描" },
      { value: "builtin", label: "📦 仅内置命令库（50+ 常用）" },
      { value: "wiki", label: "🔍 仅扫描 Wiki 中的代码块" },
    ].forEach((s) => {
      const opt = sourceSelect.createEl("option", { value: s.value, text: s.label });
      if (s.value === "both") opt.selected = true;
    });

    // Wiki 每页最多生成
    const maxRow = opts.createDiv({ cls: "mindos-recall-gen-opt-row" });
    maxRow.createSpan({ text: "Wiki 每页最多：" });
    const maxSelect = maxRow.createEl("select", { cls: "mindos-recall-gen-select" });
    [3, 5, 8, 10].forEach((n) => {
      const opt = maxSelect.createEl("option", { value: String(n), text: `${n} 张` });
      if (n === 5) opt.selected = true;
    });

    // 跳过已有
    const onlyNewRow = opts.createDiv({ cls: "mindos-recall-gen-opt-row" });
    onlyNewRow.createSpan({ text: "跳过已生成的页面：" });
    const onlyNewCheck = onlyNewRow.createEl("input");
    onlyNewCheck.type = "checkbox";
    onlyNewCheck.checked = true;

    // 进度条
    const progressWrap = panel.createDiv({ cls: "mindos-recall-gen-progress" });
    progressWrap.style.display = "none";

    const progressBar = progressWrap.createDiv({ cls: "mindos-vp-bar" });
    const progressFill = progressBar.createDiv({ cls: "mindos-vp-bar-fill" });
    const progressText = progressWrap.createDiv({ cls: "mindos-vp-text" });

    // 按钮
    const btnRow = panel.createDiv({ cls: "mindos-recall-gen-btn-row" });
    const genBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(genBtn.createSpan(), "sparkles");
    genBtn.createSpan({ text: " 开始生成" });

    genBtn.onclick = async () => {
      genBtn.disabled = true;
      progressWrap.style.display = "block";
      this.plugin.recallStore.setGenerating(true);

      try {
        const result = await this.plugin.recallCommandGenerator.generate(
          {
            source: sourceSelect.value as any,
            maxCardsPerPage: parseInt(maxSelect.value),
            onlyNewPages: onlyNewCheck.checked,
          },
          (p) => {
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 100;
            progressFill.style.width = `${pct}%`;
            progressText.setText(
              p.total > 0
                ? `${p.done}/${p.total} 文件 · 已生成 ${p.newCards} 张${p.currentFile ? " · " + this.shortenPath(p.currentFile) : ""}`
                : `已生成 ${p.newCards} 张`,
            );
          },
        );

        this.plugin.recallStore.setGenerating(false);
        new Notice(`✅ 命令行卡片生成完成：${result.newCards} 张`);
        panel.remove();

        const todayStats = await this.plugin.recallCardStore.getTodayStats();
        this.plugin.recallStore.setTodayStats(todayStats);

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.plugin.recallStore.setGenerating(false, msg);
        new Notice(`❌ 生成失败：${msg}`);
        genBtn.disabled = false;
      }
    };
  }

  // ════════════════════════════════════════════════════════════
  // 开始复习会话
  // ════════════════════════════════════════════════════════════
  private async startSession(scenario: RecallScenario) {
    try {
      const dueCards = await this.plugin.recallCardStore.getDueCards(scenario, {
        newLimit: this.plugin.settings.recallNewCardsPerDay ?? 20,
        reviewLimit: this.plugin.settings.recallReviewLimit ?? 100,
        includeNew: true,
      });

      if (dueCards.length === 0) {
        new Notice("今日没有待复习的卡片 🎉");
        return;
      }

      const newCards = dueCards.filter((c) => c.status === "new");
      const reviewCards = dueCards.filter((c) => c.status !== "new");
      this.shuffleArray(reviewCards);
      const orderedCards = [...newCards, ...reviewCards];

      const session = await this.plugin.recallCardStore.createSession(
        scenario,
        orderedCards.map((c) => c.id),
      );

      // ✅ 用毫秒时间戳记录开始时间
      session.startedAt = new Date().toISOString();
      await this.plugin.recallCardStore.updateSession(session);

      this.plugin.recallStore.startSession(session);
      this.plugin.recallStore.setCurrentCard(orderedCards[0], 0);
      this.cardStartTime = Date.now();
      // v0.7 自动朗读第一张卡
      this.autoSpeakCard(orderedCards[0]);
      this.answerInputCache = "";

      this.plugin.currentRecallCards = orderedCards;

    } catch (e) {
      new Notice(`❌ 启动复习失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 复习会话界面
  // ════════════════════════════════════════════════════════════
  private renderReviewSession(parent: HTMLElement) {
    const state = this.plugin.recallStore.getState();
    const session = state.currentSession!;
    const card = state.currentCard!;

    this.renderSessionProgress(parent, session);
    this.renderCard(parent, card, state.isFlipped);

    if (!state.isFlipped) {
      this.renderAnswerInputArea(parent, card);
      this.renderFlipArea(parent);
    } else {
      this.renderRatingArea(parent, card);
    }

    const exitRow = parent.createDiv({ cls: "mindos-recall-exit-row" });
    const exitBtn = exitRow.createEl("button", { cls: "mindos-btn" });
    setIcon(exitBtn.createSpan(), "log-out");
    exitBtn.createSpan({ text: " 结束本次复习" });
    exitBtn.onclick = () => {
      if (confirm("确定结束复习？当前进度将被保存。")) {
        this.plugin.recallStore.finishSession();
        this.plugin.currentRecallCards = [];
        this.removeKeyboardListener();
      }
    };
  }

  private renderSessionProgress(parent: HTMLElement, session: RecallSession) {
    const wrap = parent.createDiv({ cls: "mindos-recall-session-progress" });

    const info = wrap.createDiv({ cls: "mindos-recall-session-info" });
    const scenarioMeta = RECALL_SCENARIO_META[session.scenario];
    const ic = info.createSpan();
    setIcon(ic, scenarioMeta?.icon ?? "brain");
    info.createSpan({
      cls: "mindos-recall-session-label",
      text: ` ${scenarioMeta?.label ?? session.scenario}`,
    });
    info.createSpan({
      cls: "mindos-recall-session-count",
      text: `${session.doneCards} / ${session.totalCards}`,
    });

    const bar = wrap.createDiv({ cls: "mindos-recall-progress-bar" });
    const pct = session.totalCards > 0
      ? (session.doneCards / session.totalCards) * 100
      : 0;
    bar.createDiv({
      cls: "mindos-recall-progress-fill",
    }).style.width = `${pct}%`;

    const right = wrap.createDiv({ cls: "mindos-recall-session-right" });
    if (session.doneCards > 0) {
      const acc = Math.round((session.correctCards / session.doneCards) * 100);
      right.createSpan({
        cls: "mindos-recall-session-acc",
        text: `正确率 ${acc}%`,
      });
    }
  }

  private renderCard(parent: HTMLElement, card: RecallCard, isFlipped: boolean) {
    const cardEl = parent.createDiv({ cls: "mindos-recall-card" });

    if (card.status === "new") {
      const newBadge = cardEl.createDiv({ cls: "mindos-recall-card-new-badge" });
      setIcon(newBadge.createSpan(), "sparkles");
      newBadge.createSpan({ text: " 新卡片" });
    }

    if (card.sourcePath) {
      const source = cardEl.createDiv({ cls: "mindos-recall-card-source" });
      const si = source.createSpan();
      setIcon(si, "file-text");
      const pathSpan = source.createSpan({
        cls: "mindos-recall-card-source-path",
        text: this.shortenPath(card.sourcePath),
      });
      pathSpan.onclick = () => this.plugin.openFile(card.sourcePath!);
      if (card.sourceSection) {
        source.createSpan({ text: " › " });
        source.createSpan({ text: card.sourceSection });
      }
    }

    // v0.7 TTS：vocab 场景朗读按钮（仅未翻转时展示）— 防重复
    if (!isFlipped && card.scenario === "vocab") {
      // ✅ 防重复：如果已经渲染过工具栏，就不再创建
      if (!cardEl.querySelector(".mindos-recall-card-tools")) {
        const tools = cardEl.createDiv({ cls: "mindos-recall-card-tools" });

        const speakBtn = tools.createEl("button", { cls: "mindos-btn mindos-recall-tts-btn" });
        setIcon(speakBtn.createSpan(), "volume-2");
        speakBtn.createSpan({ text: " 朗读" });
        speakBtn.onclick = () => this.speakCurrentVocab(card);

        const hint = tools.createDiv({ cls: "mindos-recall-tts-hint" });
        hint.setText(this.getVocabTTSHotkeyHint());
      }
    }

    const frontEl = cardEl.createDiv({ cls: "mindos-recall-card-front" });

      // ✅ vocab 正面：隐藏单词本身，用 DOM 遮罩替代（稳定好看，不依赖 Markdown）
    if (!isFlipped && card.scenario === "vocab") {
      const mask = frontEl.createDiv({ cls: "mindos-vocab-mask" });
      mask.createDiv({ cls: "mindos-vocab-mask-dots", text: "•••" });
      mask.createDiv({ cls: "mindos-vocab-mask-sub", text: "单词已隐藏，回忆后再翻转" });

      // 可选：如果你希望正面还显示“释义/题干”，可以在这里追加
      // 但目前你的提示（词性/音标）已经在 hints 区域，所以这里先不加，保持干净。
    } else {
      // 非 vocab 或已翻转：正常渲染 front
      try {
        MarkdownRenderer.render(
          this.plugin.app,
          card.front,
          frontEl,
          "",
          this.mdComponent,
        );
      } catch {
        frontEl.setText(card.front);
      }
    }

    if (!isFlipped && card.hints && card.hints.length > 0) {
      const hintsEl = cardEl.createDiv({ cls: "mindos-recall-card-hints" });
      hintsEl.createDiv({ cls: "mindos-recall-hints-label", text: "💡 提示" });
      for (const hint of card.hints) {
        hintsEl.createDiv({ cls: "mindos-recall-hint-item", text: hint });
      }
    }

    if (isFlipped) {
      cardEl.createDiv({ cls: "mindos-recall-card-divider" });

      // ✅ 显示用户输入的答案对比
      if (this.answerInputCache) {
        const userAnswerWrap = cardEl.createDiv({ cls: "mindos-recall-user-answer" });
        const uHead = userAnswerWrap.createDiv({ cls: "mindos-recall-user-answer-head" });
        setIcon(uHead.createSpan(), "user");
        uHead.createSpan({ text: " 你的答案" });
        const uBody = userAnswerWrap.createDiv({ cls: "mindos-recall-user-answer-body" });
        uBody.setText(this.answerInputCache);
      }

      const standardWrap = cardEl.createDiv({ cls: "mindos-recall-card-standard-wrap" });
      const sHead = standardWrap.createDiv({ cls: "mindos-recall-card-standard-head" });
      setIcon(sHead.createSpan(), "check-circle");
      sHead.createSpan({ text: " 标准答案" });

      const backEl = standardWrap.createDiv({ cls: "mindos-recall-card-back" });
      try {
        MarkdownRenderer.render(
          this.plugin.app,
          card.back,
          backEl,
          "",
          this.mdComponent,
        );
      } catch {
        backEl.setText(card.back);
      }

      if (card.examples && card.examples.length > 0) {
        const exEl = cardEl.createDiv({ cls: "mindos-recall-card-examples" });
        exEl.createDiv({ cls: "mindos-recall-examples-label", text: "📝 示例" });
        for (const ex of card.examples) {
          const exItem = exEl.createDiv({ cls: "mindos-recall-example-item" });
          try {
            MarkdownRenderer.render(
              this.plugin.app, ex, exItem, "", this.mdComponent,
            );
          } catch {
            exItem.setText(ex);
          }
        }
      }
    }
  }

  /**
   * ✅ v0.6.5 优化：根据场景调整答题区域
   */
  private renderAnswerInputArea(parent: HTMLElement, card: RecallCard) {
    const wrap = parent.createDiv({ cls: "mindos-recall-answer-input-area" });

    const labelRow = wrap.createDiv({ cls: "mindos-recall-answer-label-row" });
    const ic = labelRow.createSpan();

    // ✅ 根据场景调整提示文案
    if (card.scenario === "command") {
      setIcon(ic, "terminal");
      labelRow.createSpan({ text: " 输入命令（可选，验证后自动判分）" });
    } else if (card.scenario === "vocab") {
      setIcon(ic, "type");
      labelRow.createSpan({ text: " 输入单词（可选）" });
    } else {
      setIcon(ic, "edit-3");
      labelRow.createSpan({ text: " 写下你的答案（可选）" });
    }

    labelRow.createSpan({
      cls: "mindos-recall-answer-shortcut-hint",
      text: "Ctrl+Enter 翻转",
    });

    const textarea = wrap.createEl("textarea", { cls: "mindos-recall-answer-input" });
    if (card.scenario === "command") {
      textarea.placeholder = "在此输入命令，例如：git commit -m \"...\"";
      textarea.style.fontFamily = "var(--font-monospace)";
    } else {
      textarea.placeholder = "在此回忆并写下你的答案...（不写也可以直接翻转）";
    }
    textarea.value = this.answerInputCache;
    this.answerInputEl = textarea;

    textarea.addEventListener("compositionstart", () => { this.isComposing = true; });
    textarea.addEventListener("compositionend", () => { this.isComposing = false; });

    textarea.addEventListener("input", () => {
      this.answerInputCache = textarea.value;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    });

    setTimeout(() => textarea.focus(), 50);
  }
  
  private renderFlipArea(parent: HTMLElement) {
    const area = parent.createDiv({ cls: "mindos-recall-flip-area" });

    const flipBtn = area.createEl("button", { cls: "mindos-recall-flip-btn" });
    setIcon(flipBtn.createSpan(), "eye");
    flipBtn.createSpan({ text: " 查看答案" });
    flipBtn.onclick = () => this.flipCard();

    // v0.7：根据场景和 autoSpeak 状态动态显示提示
    const state = this.plugin.recallStore.getState();
    const isVocabAutoSpeak =
      state.currentCard?.scenario === "vocab" &&
      this.plugin.settings.recallVocabAutoSpeak;

    const hintText = isVocabAutoSpeak
      ? "💡 Space 重读 · Enter 翻转 · Ctrl+Enter 提交答案"
      : "💡 快捷键：空格翻转 · Ctrl+Enter 提交答案";

    area.createDiv({ cls: "mindos-recall-flip-hint", text: hintText });
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const el = target instanceof HTMLElement ? target : null;
    if (!el) return false;

    if (el === this.answerInputEl) return true;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
    if (el.isContentEditable) return true;

    return !!el.closest("input, textarea, [contenteditable='true'], .cm-content");
  }

  private renderRatingArea(parent: HTMLElement, card: RecallCard) {
    const area = parent.createDiv({ cls: "mindos-recall-rating-area" });

    area.createDiv({
      cls: "mindos-recall-rating-label",
      text: "你掌握得怎么样？（按 1/2/3/4 快速评分）",
    });

    const btns = area.createDiv({ cls: "mindos-recall-rating-btns" });

    const ratings: Array<{
      rating: RecallRating;
      label: string;
      sublabel: string;
      cls: string;
      icon: string;
      key: string;
    }> = [
      { rating: 1, label: "完全不会", sublabel: "重来",  cls: "is-again", icon: "refresh-ccw", key: "1" },
      { rating: 2, label: "有点难",   sublabel: "Hard",  cls: "is-hard",  icon: "frown",       key: "2" },
      { rating: 3, label: "还不错",   sublabel: "Good",  cls: "is-good",  icon: "smile",       key: "3" },
      { rating: 4, label: "太简单",   sublabel: "Easy",  cls: "is-easy",  icon: "laugh",       key: "4" },
    ];

    for (const r of ratings) {
      const btn = btns.createEl("button", {
        cls: `mindos-recall-rating-btn ${r.cls}`,
      });
      const ic = btn.createSpan({ cls: "mindos-recall-rating-btn-icon" });
      setIcon(ic, r.icon);
      btn.createDiv({ cls: "mindos-recall-rating-btn-label", text: r.label });
      btn.createDiv({ cls: "mindos-recall-rating-btn-sublabel", text: r.sublabel });
      btn.createDiv({ cls: "mindos-recall-rating-btn-key", text: r.key });

      btn.onclick = () => this.submitRating(card, r.rating);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 提交评分
  // ════════════════════════════════════════════════════════════
  private async submitRating(card: RecallCard, rating: RecallRating) {
    const responseTimeMs = Date.now() - this.cardStartTime;
    const state = this.plugin.recallStore.getState();
    const session = state.currentSession!;

    const srsResult = this.plugin.srsEngine.review(card.srs, rating);

    await this.plugin.recallCardStore.updateAfterReview(
      card,
      srsResult.newSRS,
      rating,
      responseTimeMs,
    );

    await this.plugin.recallCardStore.recordReview(
      card.scenario,
      rating >= 3,
      card.status === "new",
      responseTimeMs,
    );

    const todayStats = await this.plugin.recallCardStore.getTodayStats();
    this.plugin.recallStore.setTodayStats(todayStats);

    this.plugin.recallStore.advanceSession({
      cardId: card.id,
      rating,
      responseTimeMs,
    });

    const updatedSession = this.plugin.recallStore.getState().currentSession!;
    await this.plugin.recallCardStore.updateSession(updatedSession);

    new Notice(srsResult.message, 1500);

    // 清空答案缓存，加载下一题
    this.answerInputCache = "";
    await this.loadNextCard(session, rating, card);
  }

  private async loadNextCard(
    session: RecallSession,
    lastRating: RecallRating,
    lastCard: RecallCard,
  ) {
    const cards = this.plugin.currentRecallCards;
    const state = this.plugin.recallStore.getState();
    const nextIndex = state.currentCardIndex + 1;

    if (lastRating === 1) {
      const remaining = cards.slice(nextIndex);
      const updatedCards = [...remaining, lastCard];
      this.plugin.currentRecallCards = updatedCards;

      if (updatedCards.length > 0) {
        this.plugin.recallStore.setCurrentCard(updatedCards[0], nextIndex);
        this.cardStartTime = Date.now();
                // Again 分支
        if (updatedCards.length > 0) {
          this.plugin.recallStore.setCurrentCard(updatedCards[0], nextIndex);
          this.cardStartTime = Date.now();
          this.autoSpeakCard(updatedCards[0]);  // ✅ 新增
        }
      } else {
        this.plugin.recallStore.finishSession();
      }
      return;
    }

    if (nextIndex < cards.length) {
      const nextCard = cards[nextIndex];
      this.plugin.recallStore.setCurrentCard(nextCard, nextIndex);
      this.cardStartTime = Date.now();
            // 正常推进分支
      if (nextIndex < cards.length) {
        const nextCard = cards[nextIndex];
        this.plugin.recallStore.setCurrentCard(nextCard, nextIndex);
        this.cardStartTime = Date.now();
        this.autoSpeakCard(nextCard);  // ✅ 新增
      }
    } else {
      this.plugin.recallStore.finishSession();
    }
  }

  // ════════════════════════════════════════════════════════════
  // 会话总结
  // ════════════════════════════════════════════════════════════
  private renderSessionSummary(parent: HTMLElement) {
    const state = this.plugin.recallStore.getState();
    const session = state.currentSession!;

    const wrap = parent.createDiv({ cls: "mindos-recall-summary" });

    const titleRow = wrap.createDiv({ cls: "mindos-recall-summary-title-row" });
    const ic = titleRow.createSpan();
    setIcon(ic, "party-popper");
    titleRow.createSpan({
      cls: "mindos-recall-summary-title",
      text: " 本次复习完成！",
    });

    const stats = wrap.createDiv({ cls: "mindos-recall-summary-stats" });
    const acc = session.doneCards > 0
      ? Math.round((session.correctCards / session.doneCards) * 100)
      : 0;

    // ✅ 关键修复：用时使用毫秒精确计算
    let durationMs = 0;
    if (session.finishedAt && session.startedAt) {
      try {
        const start = new Date(session.startedAt.replace(" ", "T")).getTime();
        const end = new Date(session.finishedAt.replace(" ", "T")).getTime();
        durationMs = Math.max(0, end - start);
      } catch {
        durationMs = 0;
      }
    }

    // 备用：从 results 累加每次响应时间
    if (durationMs === 0 && session.results.length > 0) {
      durationMs = session.results.reduce((sum, r) => sum + (r.responseTimeMs || 0), 0);
    }

    const timeStr = this.formatDuration(durationMs);

    this.makeSummaryStat(stats, "check-circle", String(session.doneCards), "已复习");
    this.makeSummaryStat(stats, "target", `${acc}%`, "正确率");
    this.makeSummaryStat(stats, "clock", timeStr, "用时");
    this.makeSummaryStat(
      stats,
      "trending-up",
      String(session.correctCards),
      "答对",
    );

    const dist = wrap.createDiv({ cls: "mindos-recall-summary-dist" });
    dist.createDiv({
      cls: "mindos-recall-summary-dist-label",
      text: "评分分布",
    });

    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of session.results) {
      ratingCounts[r.rating]++;
    }

    const distBar = dist.createDiv({ cls: "mindos-recall-dist-bar" });
    const colors = { 1: "is-again", 2: "is-hard", 3: "is-good", 4: "is-easy" };
    const labels = { 1: "重来", 2: "难", 3: "好", 4: "易" };

    for (const r of [1, 2, 3, 4] as RecallRating[]) {
      const count = ratingCounts[r];
      if (count === 0) continue;
      const pct = (count / session.doneCards) * 100;
      const seg = distBar.createDiv({
        cls: `mindos-recall-dist-seg ${colors[r]}`,
      });
      seg.style.width = `${pct}%`;
      seg.setAttribute("title", `${labels[r]}: ${count} 张`);
    }

    const btnRow = wrap.createDiv({ cls: "mindos-recall-summary-btns" });

    const againBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(againBtn.createSpan(), "rotate-ccw");
    againBtn.createSpan({ text: " 再来一轮" });
    againBtn.onclick = () => {
      const scenario = session.scenario;
      this.plugin.recallStore.reset();
      this.startSession(scenario);
    };

    const doneBtn = btnRow.createEl("button", { cls: "mindos-btn-large" });
    setIcon(doneBtn.createSpan(), "home");
    doneBtn.createSpan({ text: " 返回主页" });
    doneBtn.onclick = () => {
      this.plugin.recallStore.reset();
    };
  }

  private makeSummaryStat(
    parent: HTMLElement,
    icon: string,
    value: string,
    label: string,
  ) {
    const item = parent.createDiv({ cls: "mindos-recall-summary-stat" });
    setIcon(item.createSpan({ cls: "mindos-recall-summary-stat-icon" }), icon);
    item.createDiv({ cls: "mindos-recall-summary-stat-value", text: value });
    item.createDiv({ cls: "mindos-recall-summary-stat-label", text: label });
  }

  // ════════════════════════════════════════════════════════════
  // 工具
  // ════════════════════════════════════════════════════════════

  /**
   * 自动朗读：每张新卡出现时调用一次
   * 防重：同一 cardId 不会二次触发
   */
  private async autoSpeakCard(card: RecallCard): Promise<void> {
    if (!this.plugin.settings.recallVocabAutoSpeak) return;
    if (card.scenario !== "vocab") return;
    if (this.lastAutoSpokenCardId === card.id) return;

    this.lastAutoSpokenCardId = card.id;

    const text = this.stripMarkdownForTTS(card.front);
    if (!text) return;

    const inputEl = this.answerInputEl;

    this.isSpeaking = true;
    try {
      await this.plugin.speakVocab(text);
    } catch (e) {
      console.warn("[MindOS TTS] autoSpeak failed:", e);
    } finally {
      this.isSpeaking = false;

      // ✅ 朗读结束后把焦点尽量还给输入框
      requestAnimationFrame(() => {
        inputEl?.focus();
      });
    }
  }
  // ════════════════════════════════════════════════════════════
  // v0.7 TTS：朗读当前 vocab 卡
  // ════════════════════════════════════════════════════════════
  private async speakCurrentVocab(card: RecallCard) {
    try {
      if (card.scenario !== "vocab") return;

      const text = this.stripMarkdownForTTS(card.front);
      if (!text) {
        new Notice("没有可朗读的内容");
        return;
      }

      // 复用 plugin 的 speakVocab（统一 settings）
      // @ts-ignore
      if (typeof (this.plugin as any).speakVocab === "function") {
        // @ts-ignore
        await (this.plugin as any).speakVocab(text);
        return;
      }

      new Notice("TTS 未初始化：请先在 main.ts 中接入 TTSService + speakVocab()");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`TTS 朗读失败：${msg}`);
    }
  }

  private stripMarkdownForTTS(md: string): string {
    let s = String(md ?? "").trim();
    if (!s) return "";

    // 去代码块
    s = s.replace(/```[\s\S]*?```/g, " ");

    // 去行内代码
    s = s.replace(/`([^`]+)`/g, "$1");

    // 去链接/图片
    s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // 去粗斜体
    s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
    s = s.replace(/\*([^*]+)\*/g, "$1");
    s = s.replace(/__([^_]+)__/g, "$1");
    s = s.replace(/_([^_]+)_/g, "$1");

    // 去标题/引用
    s = s.replace(/^\s{0,3}#+\s+/gm, "");
    s = s.replace(/^\s{0,3}>\s+/gm, "");

    // 合并空白
    s = s.replace(/\s+/g, " ").trim();

    // vocab 朗读：优先只读第一段（避免把释义全读了）
    // 如果你的 front 是 "word\n释义" 这种，这里会只读 word
     const firstLine = String(md ?? "").split("\n").map(x => x.trim()).filter(Boolean)[0];
    if (firstLine) {
      const t = firstLine
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .trim();

      // 如果还是像英文单词/短语，则直接返回
      if (/^[a-zA-Z][a-zA-Z\s'’-]*$/.test(t) && t.length <= 40) return t;
    }

    if (s.length > 80) s = s.slice(0, 80);
    return s;
  }

  private getVocabTTSHotkeyHint(): string {
    const hk1 = (this.plugin.settings.recallVocabTTSHotkey ?? "Shift+Space").trim();
    const hk2 = (this.plugin.settings.recallVocabTTSHotkeyAlt ?? "Alt+S").trim();
    if (hk1 && hk2) return `快捷键：${hk1} / ${hk2}`;
    if (hk1) return `快捷键：${hk1}`;
    if (hk2) return `快捷键：${hk2}`;
    return "快捷键：未设置";
  }

  /**
   * 判断事件是否匹配类似 "Shift+Space" / "Alt+S" / "Ctrl+Enter" / "Cmd+K"
   */
  private matchHotkey(e: KeyboardEvent, hotkey: string): boolean {
    const want = hotkey
      .split("+")
      .map(s => s.trim())
      .filter(Boolean);

    if (want.length === 0) return false;

    // 修饰键期望
    const needShift = want.some(x => x.toLowerCase() === "shift");
    const needAlt   = want.some(x => x.toLowerCase() === "alt" || x.toLowerCase() === "option");
    const needCtrl  = want.some(x => x.toLowerCase() === "ctrl" || x.toLowerCase() === "control");
    const needMeta  = want.some(x => x.toLowerCase() === "cmd" || x.toLowerCase() === "meta" || x.toLowerCase() === "command");

    if (!!e.shiftKey !== needShift) return false;
    if (!!e.altKey   !== needAlt)   return false;
    if (!!e.ctrlKey  !== needCtrl)  return false;
    if (!!e.metaKey  !== needMeta)  return false;

    // 主键：取最后一个非修饰键 token
    const main = want
      .filter(x => !["shift", "alt", "option", "ctrl", "control", "cmd", "meta", "command"].includes(x.toLowerCase()))
      .slice(-1)[0];

    if (!main) return false;

    // 标准化比较：Space / Enter / 字母
    const m = main.toLowerCase();
    if (m === "space") return e.key === " ";
    if (m === "enter" || m === "return") return e.key === "Enter";

    // 其它：字母/数字/符号
    return e.key.toLowerCase() === m;
  }

  /**
   * vocab 正面遮罩：
   * - 默认隐藏第一行（通常是单词本身）
   * - 如果第一行太像英文单词/短语，则用占位符替换
   * - 保留后续提示（词性/音标/释义等）
   */
  private maskVocabFront(front: string): string {
    const raw = String(front ?? "").trim();
    if (!raw) return raw;

    const lines = raw.split("\n");
    if (lines.length === 0) return raw;

    const first = (lines[0] ?? "").trim();

    // 判断第一行是否“像一个英文词/短语”
    // 允许：字母/空格/连字符/撇号
    const looksLikeWord = /^[a-zA-Z][a-zA-Z\s'’-]*$/.test(first) && first.length <= 40;

    if (looksLikeWord) {
      lines[0] = `::: mindos-vocab-mask
      •••
      :::
      `;
    } else {
      // 如果第一行不是纯单词（可能 front 里有标题），也尽量不破坏结构：
      // 但仍然尝试隐藏其中的粗体单词：**ability**
      lines[0] = lines[0].replace(/\*\*([a-zA-Z][a-zA-Z\s'’-]{0,40})\*\*/g, "▢▢▢");
    }

    return lines.join("\n").trim();
  }

    // ════════════════════════════════════════════════════════════
  // 词库管理（单词场景）
  // ════════════════════════════════════════════════════════════
  private openWordListManager() {
    // 动态 import 避免循环依赖
    import("./word-list-manager-modal").then(({ WordListManagerModal }) => {
      const modal = new WordListManagerModal(
        this.plugin.app,
        this.plugin.wordListStore,
        this.plugin.vocabGenerator,
        this.plugin.recallCardStore,
        async () => {
          // 配置或卡片变更时刷新主页统计
          const todayStats = await this.plugin.recallCardStore.getTodayStats();
          this.plugin.recallStore.setTodayStats(todayStats);
        },
      );
      modal.open();
    });
  }

  // ════════════════════════════════════════════════════════════
  // 概念场景入口
  // ════════════════════════════════════════════════════════════
  private openConceptGenerator() {
    import("./concept-phrase-modal").then(({ ConceptGenerateModal }) => {
      const modal = new ConceptGenerateModal(
        this.plugin.app,
        this.plugin.conceptGenerator,
        async () => {
          const todayStats = await this.plugin.recallCardStore.getTodayStats();
          this.plugin.recallStore.setTodayStats(todayStats);
        },
      );
      modal.open();
    });
  }

  // ════════════════════════════════════════════════════════════
  // 多语言场景入口
  // ════════════════════════════════════════════════════════════
  private openPhraseGenerator() {
    import("./concept-phrase-modal").then(({ PhraseGenerateModal }) => {
      const modal = new PhraseGenerateModal(
        this.plugin.app,
        this.plugin.phraseGenerator,
        async () => {
          const todayStats = await this.plugin.recallCardStore.getTodayStats();
          this.plugin.recallStore.setTodayStats(todayStats);
        },
      );
      modal.open();
    });
  }

    // ════════════════════════════════════════════════════════════
  // 自定义场景管理入口
  // ════════════════════════════════════════════════════════════
  private openCustomScenarioManager() {
    import("./custom-scenario-modals").then(({ CustomScenarioListModal }) => {
      const modal = new CustomScenarioListModal(
        this.plugin.app,
        this.plugin.customScenarioStore,
        this.plugin.recallCardStore,
        this.plugin.aiCardGenerator,
        async () => {
          const todayStats = await this.plugin.recallCardStore.getTodayStats();
          this.plugin.recallStore.setTodayStats(todayStats);
        },
      );
      modal.open();
    });
  }

    // ════════════════════════════════════════════════════════════
  // 数据看板入口
  // ════════════════════════════════════════════════════════════
  private openDashboard() {
    import("./dashboard-view").then(({ DashboardView }) => {
      const modal = new DashboardView(
        this.plugin.app,
        this.plugin.dashboardService,
      );
      modal.open();
    });
  }
  /**
   * ✅ 智能时长格式化（修复显示 491 分钟的问题）
   */
  private formatDuration(ms: number): string {
    if (!ms || ms < 0) return "0 秒";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec} 秒`;
    const min = Math.floor(sec / 60);
    const remainSec = sec % 60;
    if (min < 60) {
      if (remainSec === 0) return `${min} 分钟`;
      return `${min}分${remainSec}秒`;
    }
    const hours = Math.floor(min / 60);
    const remainMin = min % 60;
    if (remainMin === 0) return `${hours} 小时`;
    return `${hours}小时${remainMin}分`;
  }

  private shortenPath(path: string): string {
    const parts = path.split("/");
    if (parts.length <= 2) return path;
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }

  private shuffleArray<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}