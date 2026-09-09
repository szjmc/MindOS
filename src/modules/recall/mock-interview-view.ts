import {
  setIcon,
  MarkdownRenderer,
  Component,
  Notice,
} from "obsidian";
import type MindOSPlugin from "../../../main";
import {
  JDAnalysis,
  InterviewQuestion,
  AnswerEvaluation,
  MockInterviewState,
  MockInterviewAnswer,
  RecallCard,
  RecallScenario,
  InterviewCardMetadata,
} from "../../core/types";
import { generateUID, nowISOString } from "../../core/utils";
import { SRSEngine } from "./srs-engine";

/**
 * 模拟面试视图（独立子页面）
 *
 * 流程：
 *  1. 显示当前题目（隐藏参考答案）
 *  2. 用户输入答案
 *  3. 提交后 AI 评估
 *  4. 显示评估结果（得分 + 优点 + 不足 + 参考答案对比）
 *  5. 进入下一题
 *  6. 全部完成后显示总结
 */
export class MockInterviewView {
  private mdComponent: Component;
  private srsEngine: SRSEngine;

  // 模拟面试状态（由外部 view-recall 路由进入时初始化）
  private state: MockInterviewState | null = null;

  // UI 状态
  private questionStartTime = 0;
  private isEvaluating = false;
  private currentEvaluation: AnswerEvaluation | null = null;
  private answerInputEl: HTMLTextAreaElement | null = null;
  private answerInputCache = "";

  constructor(private plugin: MindOSPlugin) {
    this.mdComponent = new Component();
    this.srsEngine = new SRSEngine("sm2");
  }

  unload() {
    this.mdComponent.unload();
  }

  /**
   * 由外部触发：开始一场模拟面试
   */
  startSession(jd: JDAnalysis, questions: InterviewQuestion[]) {
    this.state = {
      jdId: jd.id,
      questions,
      currentIndex: 0,
      answers: [],
      startedAt: nowISOString(),
    };
    this.questionStartTime = Date.now();
    this.answerInputCache = "";
    this.currentEvaluation = null;
  }

  isInSession(): boolean {
    return this.state !== null && !this.state.finishedAt;
  }

  getJDId(): string | null {
    return this.state?.jdId ?? null;
  }

  exitSession() {
    this.state = null;
    this.currentEvaluation = null;
    this.answerInputCache = "";
  }

  // ════════════════════════════════════════════════════════════
  // 渲染入口
  // ════════════════════════════════════════════════════════════
  async render(parent: HTMLElement) {
    if (!this.state) {
      parent.createDiv({ cls: "mindos-empty", text: "未进入模拟面试" });
      return;
    }

    // 焦点保护
    const activeEl = document.activeElement as HTMLElement | null;
    let savedAnswer: { selStart: number; selEnd: number; value: string } | null = null;
    if (activeEl === this.answerInputEl && this.answerInputEl) {
      savedAnswer = {
        selStart: this.answerInputEl.selectionStart ?? 0,
        selEnd: this.answerInputEl.selectionEnd ?? 0,
        value: this.answerInputEl.value,
      };
    }
    this.answerInputEl = null;

    // 已完成 → 渲染总结
    if (this.state.finishedAt) {
      this.renderSummary(parent);
      return;
    }

    // 当前题目
    const currentQ = this.state.questions[this.state.currentIndex];
    if (!currentQ) {
      this.finishSession();
      this.renderSummary(parent);
      return;
    }

    this.renderHeader(parent);
    this.renderProgress(parent);
    this.renderQuestion(parent, currentQ);

    if (this.currentEvaluation) {
      this.renderEvaluation(parent, currentQ, this.currentEvaluation);
      this.renderNextButton(parent);
    } else {
      this.renderAnswerArea(parent, currentQ);
    }

    // 焦点恢复
    if (savedAnswer && this.answerInputEl) {
      requestAnimationFrame(() => {
        if (this.answerInputEl) {
          this.answerInputEl.value = savedAnswer!.value;
          this.answerInputEl.focus();
          try {
            this.answerInputEl.setSelectionRange(savedAnswer!.selStart, savedAnswer!.selEnd);
          } catch {}
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 头部
  // ════════════════════════════════════════════════════════════
  private renderHeader(parent: HTMLElement) {
    const head = parent.createDiv({ cls: "mindos-mock-head" });

    const left = head.createDiv({ cls: "mindos-mock-head-left" });
    const exitBtn = left.createEl("button", { cls: "mindos-icon-btn" });
    setIcon(exitBtn, "arrow-left");
    exitBtn.setAttribute("title", "退出模拟面试");
    exitBtn.onclick = () => {
      if (!confirm("确定退出？当前进度将丢失")) return;
      this.exitSession();
      this.plugin.recallStore.reset();
      this.plugin.recallStore.setSelectedScenario("interview");
    };

    const titleWrap = left.createDiv({ cls: "mindos-mock-title-wrap" });
    const ic = titleWrap.createSpan();
    setIcon(ic, "briefcase");
    titleWrap.createSpan({
      cls: "mindos-mock-title",
      text: " 模拟面试进行中",
    });
  }

  // ════════════════════════════════════════════════════════════
  // 进度条
  // ════════════════════════════════════════════════════════════
  private renderProgress(parent: HTMLElement) {
    if (!this.state) return;

    const wrap = parent.createDiv({ cls: "mindos-mock-progress" });

    const info = wrap.createDiv({ cls: "mindos-mock-progress-info" });
    info.createSpan({
      cls: "mindos-mock-progress-counter",
      text: `第 ${this.state.currentIndex + 1} / ${this.state.questions.length} 题`,
    });

    if (this.state.answers.length > 0) {
      const avgScore = this.state.answers.reduce(
        (sum, a) => sum + (a.evaluation?.score ?? 0), 0,
      ) / this.state.answers.length;
      info.createSpan({
        cls: "mindos-mock-progress-avg",
        text: ` · 当前平均 ${avgScore.toFixed(1)} 分`,
      });
    }

    const bar = wrap.createDiv({ cls: "mindos-mock-progress-bar" });
    const pct = ((this.state.currentIndex) / this.state.questions.length) * 100;
    bar.createDiv({ cls: "mindos-mock-progress-fill" }).style.width = `${pct}%`;
  }

  // ════════════════════════════════════════════════════════════
  // 题目展示
  // ════════════════════════════════════════════════════════════
  private renderQuestion(parent: HTMLElement, q: InterviewQuestion) {
    const card = parent.createDiv({ cls: "mindos-mock-question-card" });

    // 题目头部：分类 + 难度
    const head = card.createDiv({ cls: "mindos-mock-question-head" });
    head.createSpan({
      cls: "mindos-mock-question-cat",
      text: q.category,
    });
    if (q.skill) {
      head.createSpan({
        cls: "mindos-mock-question-skill",
        text: q.skill,
      });
    }
    head.createSpan({
      cls: `mindos-mock-question-diff is-${q.difficulty}`,
      text: this.diffLabel(q.difficulty),
    });

    // 题目本身
    const body = card.createDiv({ cls: "mindos-mock-question-body" });
    try {
      MarkdownRenderer.render(this.plugin.app, q.question, body, "", this.mdComponent);
    } catch {
      body.setText(q.question);
    }

    // 提示（默认折叠）
    if (q.hints && q.hints.length > 0) {
      const hintsToggle = card.createEl("details", { cls: "mindos-mock-hints" });
      const summary = hintsToggle.createEl("summary", { cls: "mindos-mock-hints-summary" });
      setIcon(summary.createSpan(), "lightbulb");
      summary.createSpan({ text: " 查看提示" });

      const list = hintsToggle.createDiv({ cls: "mindos-mock-hints-list" });
      for (const h of q.hints) {
        list.createDiv({ cls: "mindos-mock-hint-item", text: `· ${h}` });
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 答题区
  // ════════════════════════════════════════════════════════════
  private renderAnswerArea(parent: HTMLElement, q: InterviewQuestion) {
    const wrap = parent.createDiv({ cls: "mindos-mock-answer-area" });

    const labelRow = wrap.createDiv({ cls: "mindos-mock-answer-label" });
    setIcon(labelRow.createSpan(), "edit-3");
    labelRow.createSpan({ text: " 你的回答（按 Ctrl+Enter 提交）" });

    const textarea = wrap.createEl("textarea", { cls: "mindos-mock-answer-input" });
    textarea.placeholder = "认真思考后回答...\n建议结构化表述：先给结论，再展开论证。\n可以使用 Markdown 格式，包括代码块。";
    textarea.value = this.answerInputCache;
    textarea.rows = 8;
    this.answerInputEl = textarea;

    // IME 兼容
    let composing = false;
    textarea.addEventListener("compositionstart", () => { composing = true; });
    textarea.addEventListener("compositionend", () => { composing = false; });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !composing) {
        e.preventDefault();
        this.handleSubmit(q);
      }
    });

    textarea.addEventListener("input", () => {
      this.answerInputCache = textarea.value;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 400) + "px";
    });

    // 自动聚焦
    setTimeout(() => textarea.focus(), 50);

    // 操作按钮
    const btnRow = wrap.createDiv({ cls: "mindos-mock-answer-btns" });

    if (this.isEvaluating) {
      const loadingBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
      loadingBtn.disabled = true;
      const spinIc = loadingBtn.createSpan();
      setIcon(spinIc, "loader-2");
      spinIc.style.animation = "mindos-spin 1.2s linear infinite";
      loadingBtn.createSpan({ text: " AI 评估中..." });
    } else {
      const submitBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
      setIcon(submitBtn.createSpan(), "send");
      submitBtn.createSpan({ text: " 提交答案" });
      submitBtn.onclick = () => this.handleSubmit(q);

      const skipBtn = btnRow.createEl("button", { cls: "mindos-btn" });
      setIcon(skipBtn.createSpan(), "skip-forward");
      skipBtn.createSpan({ text: " 跳过（直接看答案）" });
      skipBtn.onclick = () => this.handleSkip(q);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 评估结果
  // ════════════════════════════════════════════════════════════
  private renderEvaluation(parent: HTMLElement, q: InterviewQuestion, ev: AnswerEvaluation) {
    const card = parent.createDiv({ cls: "mindos-mock-eval-card" });

    // 得分大圆
    const scoreWrap = card.createDiv({ cls: "mindos-mock-eval-score-wrap" });
    const ring = scoreWrap.createDiv({
      cls: `mindos-mock-eval-score-ring ${this.scoreClass(ev.score)}`,
    });
    ring.createDiv({ cls: "mindos-mock-eval-score-num", text: String(ev.score) });
    ring.createDiv({ cls: "mindos-mock-eval-score-label", text: "/ 100" });

    const scoreText = scoreWrap.createDiv({ cls: "mindos-mock-eval-score-text" });
    scoreText.createDiv({ cls: "mindos-mock-eval-score-rating", text: this.scoreRating(ev.score) });
    scoreText.createDiv({ cls: "mindos-mock-eval-score-desc", text: this.scoreDesc(ev.score) });

    // 优点
    if (ev.strengths.length > 0) {
      const sec = card.createDiv({ cls: "mindos-mock-eval-section is-strengths" });
      const head = sec.createDiv({ cls: "mindos-mock-eval-section-head" });
      setIcon(head.createSpan(), "thumbs-up");
      head.createSpan({ text: " 答得不错的地方" });

      const list = sec.createDiv({ cls: "mindos-mock-eval-list" });
      for (const s of ev.strengths) {
        list.createDiv({ cls: "mindos-mock-eval-item", text: `· ${s}` });
      }
    }

    // 不足
    if (ev.weaknesses.length > 0) {
      const sec = card.createDiv({ cls: "mindos-mock-eval-section is-weaknesses" });
      const head = sec.createDiv({ cls: "mindos-mock-eval-section-head" });
      setIcon(head.createSpan(), "alert-triangle");
      head.createSpan({ text: " 不足之处" });

      const list = sec.createDiv({ cls: "mindos-mock-eval-list" });
      for (const w of ev.weaknesses) {
        list.createDiv({ cls: "mindos-mock-eval-item", text: `· ${w}` });
      }
    }

    // 改进建议
    if (ev.improvements.length > 0) {
      const sec = card.createDiv({ cls: "mindos-mock-eval-section is-improvements" });
      const head = sec.createDiv({ cls: "mindos-mock-eval-section-head" });
      setIcon(head.createSpan(), "lightbulb");
      head.createSpan({ text: " 改进建议" });

      const list = sec.createDiv({ cls: "mindos-mock-eval-list" });
      for (const i of ev.improvements) {
        list.createDiv({ cls: "mindos-mock-eval-item", text: `· ${i}` });
      }
    }

    // 模范答案（如果有）
    if (ev.modelAnswer) {
      const sec = card.createDiv({ cls: "mindos-mock-eval-section is-model" });
      const head = sec.createDiv({ cls: "mindos-mock-eval-section-head" });
      setIcon(head.createSpan(), "award");
      head.createSpan({ text: " 模范答案" });

      const body = sec.createDiv({ cls: "mindos-mock-eval-model-answer" });
      try {
        MarkdownRenderer.render(this.plugin.app, ev.modelAnswer, body, "", this.mdComponent);
      } catch {
        body.setText(ev.modelAnswer);
      }
    }

    // 参考答案（始终显示）
    const refSec = card.createEl("details", { cls: "mindos-mock-eval-reference" });
    const refSummary = refSec.createEl("summary", { cls: "mindos-mock-eval-section-head" });
    setIcon(refSummary.createSpan(), "book-open");
    refSummary.createSpan({ text: " 查看参考答案" });

    const refBody = refSec.createDiv({ cls: "mindos-mock-eval-ref-body" });
    try {
      MarkdownRenderer.render(this.plugin.app, q.referenceAnswer ?? "", refBody, "", this.mdComponent);
    } catch {
      refBody.setText(q.referenceAnswer ?? "");
    }

    // 追问提示
    if (q.followUps && q.followUps.length > 0) {
      const sec = card.createDiv({ cls: "mindos-mock-eval-section is-followup" });
      const head = sec.createDiv({ cls: "mindos-mock-eval-section-head" });
      setIcon(head.createSpan(), "message-circle");
      head.createSpan({ text: " 面试官可能的追问" });

      const list = sec.createDiv({ cls: "mindos-mock-eval-list" });
      for (const f of q.followUps) {
        list.createDiv({ cls: "mindos-mock-eval-item", text: `· ${f}` });
      }
    }

    // 操作：保存为复习卡片
    const saveBtn = card.createEl("button", { cls: "mindos-btn" });
    setIcon(saveBtn.createSpan(), "bookmark-plus");
    saveBtn.createSpan({ text: " 保存为复习卡片" });
    saveBtn.style.marginTop = "12px";
    saveBtn.onclick = () => this.saveQuestionAsCard(q);
  }

  // ════════════════════════════════════════════════════════════
  // 下一题按钮
  // ════════════════════════════════════════════════════════════
  private renderNextButton(parent: HTMLElement) {
    if (!this.state) return;

    const wrap = parent.createDiv({ cls: "mindos-mock-next-wrap" });
    const isLast = this.state.currentIndex >= this.state.questions.length - 1;

    const nextBtn = wrap.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(nextBtn.createSpan(), isLast ? "flag" : "arrow-right");
    nextBtn.createSpan({ text: isLast ? " 完成面试" : " 下一题" });
    nextBtn.onclick = () => this.handleNext();
  }

  // ════════════════════════════════════════════════════════════
  // 总结页
  // ════════════════════════════════════════════════════════════
  private async renderSummary(parent: HTMLElement) {
    if (!this.state) return;

    const card = parent.createDiv({ cls: "mindos-mock-summary" });

    // 标题
    const titleRow = card.createDiv({ cls: "mindos-mock-summary-title-row" });
    setIcon(titleRow.createSpan(), "trophy");
    titleRow.createSpan({
      cls: "mindos-mock-summary-title",
      text: " 模拟面试完成！",
    });

    // 平均分大圆
    const validAnswers = this.state.answers.filter((a) => a.evaluation);
    const avgScore = validAnswers.length > 0
      ? validAnswers.reduce((sum, a) => sum + (a.evaluation?.score ?? 0), 0) / validAnswers.length
      : 0;

    const avgRing = card.createDiv({
      cls: `mindos-mock-summary-avg-ring ${this.scoreClass(avgScore)}`,
    });
    avgRing.createDiv({
      cls: "mindos-mock-summary-avg-num",
      text: avgScore.toFixed(1),
    });
    avgRing.createDiv({
      cls: "mindos-mock-summary-avg-label",
      text: "平均得分",
    });

    // 数据
    const stats = card.createDiv({ cls: "mindos-mock-summary-stats" });
    this.makeSummaryStat(stats, "📝", String(this.state.questions.length), "总题数");
    this.makeSummaryStat(stats, "✅", String(validAnswers.length), "已答题");
    this.makeSummaryStat(stats, "🎯", `${this.calcPassRate(validAnswers)}%`, "及格率");

    const startTime = new Date(this.state.startedAt.replace(" ", "T")).getTime();
    const endTime = this.state.finishedAt
      ? new Date(this.state.finishedAt.replace(" ", "T")).getTime()
      : Date.now();
    const durMin = Math.max(1, Math.round((endTime - startTime) / 60000));
    this.makeSummaryStat(stats, "⏱", `${durMin}`, "分钟");

    // 题目得分列表
    if (validAnswers.length > 0) {
      card.createDiv({
        cls: "mindos-mock-summary-section-head",
        text: "📊 题目详情",
      });

      const list = card.createDiv({ cls: "mindos-mock-summary-list" });
      for (let i = 0; i < this.state.questions.length; i++) {
        const q = this.state.questions[i];
        const answer = this.state.answers.find((a) => a.questionId === q.id);
        this.renderSummaryItem(list, q, answer, i);
      }
    }

    // 按钮
    const btnRow = card.createDiv({ cls: "mindos-mock-summary-btns" });

    const saveAllBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(saveAllBtn.createSpan(), "bookmark-plus");
    saveAllBtn.createSpan({ text: " 全部保存为复习卡片" });
    saveAllBtn.onclick = () => this.saveAllAsCards();

    const exitBtn = btnRow.createEl("button", { cls: "mindos-btn-large" });
    setIcon(exitBtn.createSpan(), "home");
    exitBtn.createSpan({ text: " 返回 JD 详情" });
    exitBtn.onclick = () => {
      this.exitSession();
      this.plugin.recallStore.reset();
      this.plugin.recallStore.setSelectedScenario("interview");
    };
  }

  private renderSummaryItem(
    parent: HTMLElement,
    q: InterviewQuestion,
    answer: MockInterviewAnswer | undefined,
    index: number,
  ) {
    const item = parent.createDiv({ cls: "mindos-mock-summary-item" });

    const numEl = item.createDiv({ cls: "mindos-mock-summary-item-num" });
    numEl.setText(`${index + 1}`);

    const body = item.createDiv({ cls: "mindos-mock-summary-item-body" });
    body.createDiv({
      cls: "mindos-mock-summary-item-q",
      text: q.question.substring(0, 80) + (q.question.length > 80 ? "…" : ""),
    });

    const meta = body.createDiv({ cls: "mindos-mock-summary-item-meta" });
    meta.createSpan({ text: q.category });
    meta.createSpan({ text: " · " });
    meta.createSpan({ text: this.diffLabel(q.difficulty) });
    if (q.skill) {
      meta.createSpan({ text: " · " });
      meta.createSpan({ text: q.skill });
    }

    // 得分
    if (answer?.evaluation) {
      const scoreEl = item.createDiv({
        cls: `mindos-mock-summary-item-score ${this.scoreClass(answer.evaluation.score)}`,
      });
      scoreEl.setText(`${answer.evaluation.score}`);
    } else {
      const skipEl = item.createDiv({ cls: "mindos-mock-summary-item-skip", text: "未答" });
    }
  }

  private makeSummaryStat(parent: HTMLElement, icon: string, value: string, label: string) {
    const item = parent.createDiv({ cls: "mindos-mock-summary-stat" });
    item.createDiv({ cls: "mindos-mock-summary-stat-icon", text: icon });
    item.createDiv({ cls: "mindos-mock-summary-stat-value", text: value });
    item.createDiv({ cls: "mindos-mock-summary-stat-label", text: label });
  }

  private calcPassRate(answers: MockInterviewAnswer[]): number {
    if (answers.length === 0) return 0;
    const passed = answers.filter((a) => (a.evaluation?.score ?? 0) >= 60).length;
    return Math.round((passed / answers.length) * 100);
  }

  // ════════════════════════════════════════════════════════════
  // 操作
  // ════════════════════════════════════════════════════════════
  private async handleSubmit(q: InterviewQuestion) {
    if (!this.state) return;

    const answer = this.answerInputCache.trim();
    if (!answer) {
      new Notice("⚠️ 请先输入答案");
      return;
    }

    this.isEvaluating = true;
    // 触发刷新（按钮变 loading）
    this.plugin.recallStore.setSelectedScenario("interview");

    try {
      const evaluation = await this.plugin.mockInterviewer.evaluateAnswer(q, answer);

      this.currentEvaluation = evaluation;

      const responseTimeMs = Date.now() - this.questionStartTime;
      this.state.answers.push({
        questionId: q.id,
        userAnswer: answer,
        evaluation,
        responseTimeMs,
        reviewedAt: nowISOString(),
      });

      this.isEvaluating = false;
      this.plugin.recallStore.setSelectedScenario("interview");
    } catch (e) {
      this.isEvaluating = false;
      new Notice(`❌ 评估失败：${e instanceof Error ? e.message : String(e)}`);
      this.plugin.recallStore.setSelectedScenario("interview");
    }
  }

  private handleSkip(q: InterviewQuestion) {
    if (!this.state) return;
    if (!confirm("跳过将不会记录答题，确定继续？")) return;

    this.state.answers.push({
      questionId: q.id,
      userAnswer: "(跳过)",
      responseTimeMs: Date.now() - this.questionStartTime,
      reviewedAt: nowISOString(),
    });

    this.handleNext();
  }

  private handleNext() {
    if (!this.state) return;

    this.currentEvaluation = null;
    this.answerInputCache = "";

    if (this.state.currentIndex >= this.state.questions.length - 1) {
      this.finishSession();
    } else {
      this.state.currentIndex++;
      this.questionStartTime = Date.now();
    }

    // 触发刷新
    this.plugin.recallStore.setSelectedScenario("interview");
  }

  private finishSession() {
    if (!this.state) return;
    this.state.finishedAt = nowISOString();
  }

  // ════════════════════════════════════════════════════════════
  // 保存为复习卡片
  // ════════════════════════════════════════════════════════════
  private async saveQuestionAsCard(q: InterviewQuestion) {
    if (!this.state) return;

    const jd = await this.plugin.interviewStore.getById(this.state.jdId);
    if (!jd) {
      new Notice("❌ 找不到对应的 JD");
      return;
    }

    const card = this.makeCardFromQuestion(jd, q);
    await this.plugin.recallCardStore.saveCard(card);
    this.plugin.recallCardStore.invalidateCache("interview");

    const todayStats = await this.plugin.recallCardStore.getTodayStats();
    this.plugin.recallStore.setTodayStats(todayStats);

    new Notice(`✅ 已保存到面试场景复习库`);
  }

  private async saveAllAsCards() {
    if (!this.state) return;

    const jd = await this.plugin.interviewStore.getById(this.state.jdId);
    if (!jd) {
      new Notice("❌ 找不到对应的 JD");
      return;
    }

    const cards = this.state.questions.map((q) => this.makeCardFromQuestion(jd, q));
    await this.plugin.recallCardStore.saveCards(cards);
    this.plugin.recallCardStore.invalidateCache("interview");

    const todayStats = await this.plugin.recallCardStore.getTodayStats();
    this.plugin.recallStore.setTodayStats(todayStats);

    new Notice(`✅ 已保存 ${cards.length} 张面试题到复习库`);
  }

  private makeCardFromQuestion(jd: JDAnalysis, q: InterviewQuestion): RecallCard {
    const id = `interview_${generateUID()}`;
    const meta: InterviewCardMetadata = {
      jdId: jd.id,
      jdPosition: jd.position,
      skill: q.skill,
      questionId: q.id,
      category: q.category,
      difficulty: q.difficulty,
    };

    return {
      id,
      scenario: "interview" as RecallScenario,
      front: q.question,
      back: q.referenceAnswer ?? "（无参考答案）",
      hints: q.hints ?? [],
      examples: q.followUps ?? [],
      metadata: meta,
      sourcePath: undefined,
      sourceSection: `${jd.position} · ${q.category}`,
      srs: this.srsEngine.createInitialSRS(),
      stats: {
        totalReviews: 0,
        correctCount: 0,
        wrongCount: 0,
        avgResponseTimeMs: 0,
        streak: 0,
      },
      tags: ["interview", jd.position, q.category, q.skill, q.difficulty].filter(Boolean) as string[],
      status: "new",
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };
  }

  // ════════════════════════════════════════════════════════════
  // 辅助
  // ════════════════════════════════════════════════════════════
  private diffLabel(d: string): string {
    return ({ easy: "🟢 简单", medium: "🟡 中等", hard: "🔴 困难" } as any)[d] ?? d;
  }

  private scoreClass(score: number): string {
    if (score >= 85) return "is-excellent";
    if (score >= 70) return "is-good";
    if (score >= 60) return "is-medium";
    return "is-low";
  }

  private scoreRating(score: number): string {
    if (score >= 90) return "🌟 优秀";
    if (score >= 80) return "💪 良好";
    if (score >= 70) return "👍 不错";
    if (score >= 60) return "✅ 及格";
    if (score >= 40) return "⚠️ 待加强";
    return "❌ 不及格";
  }

  private scoreDesc(score: number): string {
    if (score >= 90) return "答得非常完整、深入，超出预期水平";
    if (score >= 80) return "回答到了核心要点，表述清晰";
    if (score >= 70) return "主要点都答到了，但部分细节有欠缺";
    if (score >= 60) return "有正确理解，但深度不够";
    if (score >= 40) return "有明显遗漏或表达错误，需要加强";
    return "基本没答到点子上，建议系统学习";
  }
}