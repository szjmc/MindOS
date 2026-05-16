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

    // 复习中需要监听键盘
    if (state.currentSession && state.currentCard) {
      this.attachKeyboardListener();
    } else {
      this.removeKeyboardListener();
    }

    // ── 焦点恢复（如果在输入答案中）──
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

    if (state.currentSession && state.currentCard) {
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
      // 输入框中不触发快捷键（除了输入答案的 Ctrl+Enter）
      const target = e.target as HTMLElement;
      const inInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      const state = this.plugin.recallStore.getState();
      if (!state.currentCard) return;

      if (inInput && target === this.answerInputEl) {
        // 答题输入框中，Ctrl+Enter 提交答案（翻转卡片）
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          if (!state.isFlipped) {
            this.flipCard();
          }
        }
        return;
      }

      if (inInput) return; // 其他输入框中不处理

      // 未翻转：空格翻转
      if (!state.isFlipped) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          this.flipCard();
        }
      } else {
        // 已翻转：1/2/3/4 评分
        if (e.key === "1") { e.preventDefault(); this.submitRating(state.currentCard, 1); }
        else if (e.key === "2") { e.preventDefault(); this.submitRating(state.currentCard, 2); }
        else if (e.key === "3") { e.preventDefault(); this.submitRating(state.currentCard, 3); }
        else if (e.key === "4") { e.preventDefault(); this.submitRating(state.currentCard, 4); }
      }
    };
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

    const frontEl = cardEl.createDiv({ cls: "mindos-recall-card-front" });
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
   * ✅ 新增：答题输入区
   * 用户可以在翻转前先输入答案，便于自我检验
   */
  private renderAnswerInputArea(parent: HTMLElement, card: RecallCard) {
    const wrap = parent.createDiv({ cls: "mindos-recall-answer-input-area" });

    const labelRow = wrap.createDiv({ cls: "mindos-recall-answer-label-row" });
    const ic = labelRow.createSpan();
    setIcon(ic, "edit-3");
    labelRow.createSpan({ text: " 写下你的答案（可选）" });
    labelRow.createSpan({
      cls: "mindos-recall-answer-shortcut-hint",
      text: "Ctrl+Enter 翻转",
    });

    const textarea = wrap.createEl("textarea", { cls: "mindos-recall-answer-input" });
    textarea.placeholder = "在此回忆并写下你的答案...（不写也可以直接翻转）";
    textarea.value = this.answerInputCache;
    this.answerInputEl = textarea;

    textarea.addEventListener("compositionstart", () => { this.isComposing = true; });
    textarea.addEventListener("compositionend", () => { this.isComposing = false; });

    textarea.addEventListener("input", () => {
      // 实时缓存到内存（不触发 store 更新避免 re-render）
      this.answerInputCache = textarea.value;
      // 自动调整高度
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    });

    // 自动聚焦
    setTimeout(() => textarea.focus(), 50);
  }

  private renderFlipArea(parent: HTMLElement) {
    const area = parent.createDiv({ cls: "mindos-recall-flip-area" });

    const flipBtn = area.createEl("button", {
      cls: "mindos-recall-flip-btn",
    });
    setIcon(flipBtn.createSpan(), "eye");
    flipBtn.createSpan({ text: " 查看答案" });
    flipBtn.onclick = () => this.flipCard();

    area.createDiv({
      cls: "mindos-recall-flip-hint",
      text: "💡 快捷键：空格翻转 · Ctrl+Enter 提交答案",
    });
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
      } else {
        this.plugin.recallStore.finishSession();
      }
      return;
    }

    if (nextIndex < cards.length) {
      const nextCard = cards[nextIndex];
      this.plugin.recallStore.setCurrentCard(nextCard, nextIndex);
      this.cardStartTime = Date.now();
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