import {
  setIcon,
  MarkdownRenderer,
  Component,
  Notice,
  Modal,
} from "obsidian";
import type MindOSPlugin from "../../../main";
import {
  JDAnalysis,
  SkillRequirement,
  SkillStatus,
  RecallCard,
  RecallScenario,
  InterviewCardMetadata,
  InterviewQuestion, 
} from "../../core/types";
import {
  SKILL_LEVEL_LABELS,
  SKILL_STATUS_LABELS,
} from "../../core/constants";
import { generateUID, nowISOString } from "../../core/utils";
import { SRSEngine } from "./srs-engine";

/**
 * 面试 Tab 视图：替代默认的复习场景卡片，提供完整的面试助手 UI
 *
 * 三个子页：
 *  - JD 列表
 *  - JD 详情（含分析结果 + 知识盘点 + 模拟题入口）
 *  - 新建 JD（粘贴框）
 */
export class InterviewView {
  private mdComponent: Component;
  private srsEngine: SRSEngine;

  // 当前打开的 JD ID（null 表示在列表/新建页）
  private currentJDId: string | null = null;
  // 当前页面：list / detail / create
  private currentPage: "list" | "detail" | "create" = "list";

  constructor(private plugin: MindOSPlugin) {
    this.mdComponent = new Component();
    this.srsEngine = new SRSEngine("sm2");
  }

  unload() {
    this.mdComponent.unload();
  }

  // ════════════════════════════════════════════════════════════
  // 主渲染入口
  // ════════════════════════════════════════════════════════════
  async render(parent: HTMLElement) {
    this.renderHeader(parent);

    if (this.currentPage === "create") {
      this.renderCreatePage(parent);
    } else if (this.currentPage === "detail" && this.currentJDId) {
      await this.renderDetailPage(parent, this.currentJDId);
    } else {
      await this.renderListPage(parent);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 顶部头
  // ════════════════════════════════════════════════════════════
  private renderHeader(parent: HTMLElement) {
    const head = parent.createDiv({ cls: "mindos-interview-head" });

    const left = head.createDiv({ cls: "mindos-interview-head-left" });

    // ✅ 列表页 + 详情页 + 创建页 都显示返回按钮
    const backBtn = left.createEl("button", { cls: "mindos-icon-btn" });
    setIcon(backBtn, "arrow-left");
    backBtn.setAttribute(
      "title",
      this.currentPage === "list" ? "返回复习主页" : "返回 JD 列表",
    );
    backBtn.onclick = () => {
      if (this.currentPage === "list") {
        // 在列表页：返回到复习场景主页
        this.plugin.recallStore.setSelectedScenario("wiki");
        this.plugin.recallStore.reset();
      } else {
        // 在详情/创建页：返回到列表
        this.currentPage = "list";
        this.currentJDId = null;
        this.plugin.recallStore.reset();
        this.plugin.recallStore.setSelectedScenario("interview");
      }
    };

    const titleWrap = left.createDiv({ cls: "mindos-interview-title-wrap" });
    const ic = titleWrap.createSpan({ cls: "mindos-interview-title-icon" });
    setIcon(ic, "briefcase");
    titleWrap.createSpan({
      cls: "mindos-interview-title",
      text:
        this.currentPage === "create"
          ? "新建 JD 分析"
          : this.currentPage === "detail"
          ? "JD 详情"
          : "面试助手",
    });

    if (this.currentPage === "list") {
      const right = head.createDiv({ cls: "mindos-interview-head-right" });
      const newBtn = right.createEl("button", { cls: "mindos-btn is-primary" });
      setIcon(newBtn.createSpan(), "plus");
      newBtn.createSpan({ text: " 新增 JD" });
      newBtn.onclick = () => {
        this.currentPage = "create";
        this.plugin.recallStore.reset();
        this.plugin.recallStore.setSelectedScenario("interview");
      };
    }
  }

  // ════════════════════════════════════════════════════════════
  // 页面：JD 列表
  // ════════════════════════════════════════════════════════════
  private async renderListPage(parent: HTMLElement) {
    const jds = await this.plugin.interviewStore.getAll();

    if (jds.length === 0) {
      this.renderEmpty(parent);
      return;
    }

    const list = parent.createDiv({ cls: "mindos-interview-list" });
    for (const jd of jds) {
      this.renderJDCard(list, jd);
    }
  }

  private renderEmpty(parent: HTMLElement) {
    const empty = parent.createDiv({ cls: "mindos-interview-empty" });
    const ic = empty.createSpan({ cls: "mindos-interview-empty-icon" });
    setIcon(ic, "file-text");

    empty.createDiv({
      cls: "mindos-interview-empty-title",
      text: "还没有 JD 分析",
    });
    empty.createDiv({
      cls: "mindos-interview-empty-desc",
      text: "粘贴一份招聘 JD，AI 自动提炼技能要求，对照你的 Wiki 知识库给出盘点报告",
    });

    const startBtn = empty.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(startBtn.createSpan(), "plus");
    startBtn.createSpan({ text: " 创建第一份 JD 分析" });
    startBtn.onclick = () => {
      this.currentPage = "create";
      this.plugin.recallStore.reset();
      this.plugin.recallStore.setSelectedScenario("interview");
    };
  }

  private renderJDCard(parent: HTMLElement, jd: JDAnalysis) {
    const card = parent.createDiv({ cls: "mindos-interview-jd-card" });
    card.onclick = () => {
      this.currentJDId = jd.id;
      this.currentPage = "detail";
      this.plugin.recallStore.reset();
      this.plugin.recallStore.setSelectedScenario("interview");
    };

    // 头部
    const head = card.createDiv({ cls: "mindos-interview-jd-head" });

    const titleWrap = head.createDiv({ cls: "mindos-interview-jd-title-wrap" });
    titleWrap.createDiv({
      cls: "mindos-interview-jd-position",
      text: jd.position,
    });
    if (jd.company) {
      titleWrap.createDiv({
        cls: "mindos-interview-jd-company",
        text: jd.company,
      });
    }

    // 准备度徽章
    if (jd.gapAnalysis) {
      const pct = Math.round(jd.gapAnalysis.overallReadiness * 100);
      const badge = head.createDiv({
        cls: `mindos-interview-jd-readiness ${this.readinessClass(pct)}`,
      });
      badge.createDiv({ cls: "mindos-interview-jd-readiness-pct", text: `${pct}%` });
      badge.createDiv({ cls: "mindos-interview-jd-readiness-label", text: "准备度" });
    }

    // 元信息
    const meta = card.createDiv({ cls: "mindos-interview-jd-meta" });
    if (jd.level) meta.createSpan({ cls: "mindos-interview-jd-tag", text: jd.level });
    if (jd.location) meta.createSpan({ cls: "mindos-interview-jd-tag", text: `📍 ${jd.location}` });
    if (jd.salary) meta.createSpan({ cls: "mindos-interview-jd-tag", text: `💰 ${jd.salary}` });
    meta.createSpan({
      cls: "mindos-interview-jd-tag is-muted",
      text: this.formatRelativeTime(jd.updatedAt),
    });

    // 技能统计
    if (jd.skills.length > 0) {
      const skillStats = card.createDiv({ cls: "mindos-interview-jd-skills-stats" });

      const mastered = jd.skills.filter((s) => s.status === "mastered").length;
      const partial = jd.skills.filter((s) => s.status === "partial").length;
      const missing = jd.skills.filter((s) => s.status === "missing").length;
      const unanalyzed = jd.skills.length - mastered - partial - missing;

      skillStats.createSpan({ cls: "mindos-interview-jd-stat-total", text: `${jd.skills.length} 项技能` });
      if (mastered > 0)
        skillStats.createSpan({ cls: "mindos-interview-jd-stat is-success", text: `✅ ${mastered}` });
      if (partial > 0)
        skillStats.createSpan({ cls: "mindos-interview-jd-stat is-warning", text: `🟡 ${partial}` });
      if (missing > 0)
        skillStats.createSpan({ cls: "mindos-interview-jd-stat is-danger", text: `❌ ${missing}` });
      if (unanalyzed > 0)
        skillStats.createSpan({ cls: "mindos-interview-jd-stat is-muted", text: `⏳ ${unanalyzed} 待盘点` });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 页面：JD 详情
  // ════════════════════════════════════════════════════════════
  private async renderDetailPage(parent: HTMLElement, jdId: string) {
    const jd = await this.plugin.interviewStore.getById(jdId);
    if (!jd) {
      parent.createDiv({ cls: "mindos-empty", text: "JD 不存在，可能已被删除" });
      return;
    }

    // 摘要信息
    this.renderJDSummary(parent, jd);

    // 知识盘点结果
    this.renderGapAnalysis(parent, jd);

    // 技能清单
    this.renderSkillsList(parent, jd);

    // 职责与要求
    this.renderResponsibilities(parent, jd);

    // 危险操作区
    this.renderDangerZone(parent, jd);
  }

  private renderJDSummary(parent: HTMLElement, jd: JDAnalysis) {
    const card = parent.createDiv({ cls: "mindos-interview-detail-card" });

    const head = card.createDiv({ cls: "mindos-interview-detail-head" });
    const titleWrap = head.createDiv({ cls: "mindos-interview-detail-title-wrap" });

    const positionEl = titleWrap.createDiv({
      cls: "mindos-interview-detail-position",
      text: jd.position,
    });
    positionEl.onclick = async () => {
      const newName = prompt("重命名职位：", jd.position);
      if (newName && newName.trim()) {
        await this.plugin.interviewStore.rename(jd.id, newName.trim());
        this.plugin.recallStore.reset();
      }
    };

    if (jd.company) {
      titleWrap.createDiv({
        cls: "mindos-interview-detail-company",
        text: jd.company,
      });
    }

    const meta = head.createDiv({ cls: "mindos-interview-detail-meta" });
    if (jd.level)
      meta.createSpan({ cls: "mindos-interview-jd-tag", text: jd.level });
    if (jd.location)
      meta.createSpan({ cls: "mindos-interview-jd-tag", text: `📍 ${jd.location}` });
    if (jd.salary)
      meta.createSpan({ cls: "mindos-interview-jd-tag", text: `💰 ${jd.salary}` });

    if (jd.description) {
      const descEl = card.createDiv({ cls: "mindos-interview-detail-desc" });
      try {
        MarkdownRenderer.render(
          this.plugin.app,
          jd.description,
          descEl,
          "",
          this.mdComponent,
        );
      } catch {
        descEl.setText(jd.description);
      }
    }

    // 操作行
    const actionRow = card.createDiv({ cls: "mindos-interview-detail-actions" });

    if (!jd.gapAnalysis) {
      const analyzeBtn = actionRow.createEl("button", { cls: "mindos-btn is-primary" });
      setIcon(analyzeBtn.createSpan(), "scan-search");
      analyzeBtn.createSpan({ text: " 本地盘点（对照 Wiki）" });
      analyzeBtn.onclick = () => this.runGapAnalysis(jd);
    } else {
      const reAnalyzeBtn = actionRow.createEl("button", { cls: "mindos-btn" });
      setIcon(reAnalyzeBtn.createSpan(), "rotate-cw");
      reAnalyzeBtn.createSpan({ text: " 重新本地盘点" });
      reAnalyzeBtn.onclick = () => this.runGapAnalysis(jd);
    }

    // ✅ 新增：AI 增强盘点
    const aiBtn = actionRow.createEl("button", { cls: "mindos-btn is-primary" });
    setIcon(aiBtn.createSpan(), "sparkles");
    aiBtn.createSpan({ text: " AI 增强盘点（生成缺失知识）" });
    aiBtn.onclick = () => this.runAIEnhancedAnalysis(jd);

    const viewRawBtn = actionRow.createEl("button", { cls: "mindos-btn" });
    setIcon(viewRawBtn.createSpan(), "file-text");
    viewRawBtn.createSpan({ text: " 查看原文" });
    viewRawBtn.onclick = () => this.showRawJD(jd);

  }

  private renderGapAnalysis(parent: HTMLElement, jd: JDAnalysis) {
    if (!jd.gapAnalysis) {
      const tip = parent.createDiv({ cls: "mindos-interview-tip" });
      tip.createSpan({ text: "💡 点击「开始知识盘点」，对照你的 Wiki 知识库分析每个技能的掌握程度" });
      return;
    }

    const card = parent.createDiv({ cls: "mindos-interview-gap-card" });

    const head = card.createDiv({ cls: "mindos-interview-gap-head" });
    const ic = head.createSpan({ cls: "mindos-interview-gap-icon" });
    setIcon(ic, "scan-search");
    head.createSpan({ cls: "mindos-interview-gap-title", text: "知识盘点报告" });

    // 准备度大圆
    const readinessWrap = card.createDiv({ cls: "mindos-interview-readiness-wrap" });
    const pct = Math.round(jd.gapAnalysis.overallReadiness * 100);
    const ring = readinessWrap.createDiv({ cls: `mindos-interview-readiness-ring ${this.readinessClass(pct)}` });
    ring.createDiv({ cls: "mindos-interview-readiness-ring-pct", text: `${pct}%` });
    ring.createDiv({ cls: "mindos-interview-readiness-ring-label", text: "整体准备度" });

    // 数据条
    const dataRow = readinessWrap.createDiv({ cls: "mindos-interview-readiness-data" });
    this.makeReadinessChip(dataRow, "✅", "已掌握", jd.gapAnalysis.masteredCount, "is-success");
    this.makeReadinessChip(dataRow, "🟡", "部分掌握", jd.gapAnalysis.partialCount, "is-warning");
    this.makeReadinessChip(dataRow, "❌", "缺失", jd.gapAnalysis.missingCount, "is-danger");

    // 文字总结
    const summary = card.createDiv({ cls: "mindos-interview-gap-summary" });
    try {
      MarkdownRenderer.render(
        this.plugin.app,
        jd.gapAnalysis.summary,
        summary,
        "",
        this.mdComponent,
      );
    } catch {
      summary.setText(jd.gapAnalysis.summary);
    }

    // ✅ 操作行：所有按钮统一在这里
    const actionRow = card.createDiv({ cls: "mindos-interview-gap-actions" });

    // 为薄弱技能生成复习卡片
    const missing = jd.skills.filter((s) => s.status === "missing" || s.status === "partial");
    if (missing.length > 0) {
      const genBtn = actionRow.createEl("button", { cls: "mindos-btn is-primary" });
      setIcon(genBtn.createSpan(), "sparkles");
      genBtn.createSpan({ text: ` 为 ${missing.length} 个薄弱技能生成复习卡片` });
      genBtn.onclick = () => this.generateCardsForWeakSkills(jd, missing);
    }

    // 开始模拟面试
    const mockBtn = actionRow.createEl("button", { cls: "mindos-btn" });
    setIcon(mockBtn.createSpan(), "play-circle");
    mockBtn.createSpan({ text: " 开始模拟面试" });
    mockBtn.onclick = () => this.startMockInterview(jd);
  }
  
  private makeReadinessChip(parent: HTMLElement, icon: string, label: string, count: number, cls: string) {
    const chip = parent.createDiv({ cls: `mindos-interview-readiness-chip ${cls}` });
    chip.createSpan({ cls: "mindos-interview-readiness-chip-icon", text: icon });
    chip.createSpan({ cls: "mindos-interview-readiness-chip-count", text: String(count) });
    chip.createSpan({ cls: "mindos-interview-readiness-chip-label", text: label });
  }

  private renderSkillsList(parent: HTMLElement, jd: JDAnalysis) {
    if (jd.skills.length === 0) return;

    const card = parent.createDiv({ cls: "mindos-interview-detail-card" });

    const head = card.createDiv({ cls: "mindos-interview-detail-section-head" });
    const ic = head.createSpan();
    setIcon(ic, "list-checks");
    head.createSpan({ text: ` 技能清单 (${jd.skills.length})` });

    // 按 category 分组
    const grouped = new Map<string, SkillRequirement[]>();
    for (const s of jd.skills) {
      const cat = s.category || "其他";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(s);
    }

    const list = card.createDiv({ cls: "mindos-interview-skills-list" });
    for (const [cat, skills] of grouped.entries()) {
      const group = list.createDiv({ cls: "mindos-interview-skill-group" });
      group.createDiv({ cls: "mindos-interview-skill-group-title", text: cat });

      for (const skill of skills) {
        this.renderSkillItem(group, skill);
      }
    }
  }

  private renderSkillItem(parent: HTMLElement, skill: SkillRequirement) {
    const item = parent.createDiv({ cls: "mindos-interview-skill-item" });

    // 左侧：技能信息
    const left = item.createDiv({ cls: "mindos-interview-skill-left" });

    const nameRow = left.createDiv({ cls: "mindos-interview-skill-name-row" });
    nameRow.createSpan({ cls: "mindos-interview-skill-name", text: skill.skill });

    if (skill.required) {
      nameRow.createSpan({ cls: "mindos-interview-skill-required-tag", text: "必需" });
    } else {
      nameRow.createSpan({ cls: "mindos-interview-skill-nice-tag", text: "加分" });
    }

    nameRow.createSpan({
      cls: "mindos-interview-skill-level",
      text: SKILL_LEVEL_LABELS[skill.level] ?? skill.level,
    });

    if (skill.matchedPages && skill.matchedPages.length > 0) {
      const matchedRow = left.createDiv({ cls: "mindos-interview-skill-matched" });
      matchedRow.createSpan({ cls: "mindos-interview-skill-matched-label", text: "📎 匹配：" });
      for (const path of skill.matchedPages.slice(0, 3)) {
        const link = matchedRow.createSpan({
          cls: "mindos-interview-skill-matched-link",
          text: this.basename(path),
        });
        link.onclick = (e) => {
          e.stopPropagation();
          this.plugin.openFile(path);
        };
      }
      if (skill.matchedPages.length > 3) {
        matchedRow.createSpan({
          cls: "mindos-interview-skill-matched-more",
          text: ` +${skill.matchedPages.length - 3} 更多`,
        });
      }
    }

    // 右侧：状态徽章
    if (skill.status) {
      const statusInfo = SKILL_STATUS_LABELS[skill.status];
      const right = item.createDiv({
        cls: `mindos-interview-skill-status is-${statusInfo.color}`,
      });
      right.createSpan({ cls: "mindos-interview-skill-status-label", text: statusInfo.label });
      if (skill.coverage !== undefined) {
        right.createSpan({
          cls: "mindos-interview-skill-status-score",
          text: `${(skill.coverage * 100).toFixed(0)}%`,
        });
      }
    }
  }

  private renderResponsibilities(parent: HTMLElement, jd: JDAnalysis) {
    if (jd.responsibilities.length === 0 && jd.requirements.length === 0 && jd.niceToHave.length === 0) {
      return;
    }

    const card = parent.createDiv({ cls: "mindos-interview-detail-card" });

    if (jd.responsibilities.length > 0) {
      const respHead = card.createDiv({ cls: "mindos-interview-detail-section-head" });
      setIcon(respHead.createSpan(), "check-square");
      respHead.createSpan({ text: ` 主要职责` });
      const respList = card.createEl("ul", { cls: "mindos-interview-list-ul" });
      for (const r of jd.responsibilities) {
        respList.createEl("li", { text: r });
      }
    }

    if (jd.requirements.length > 0) {
      const reqHead = card.createDiv({ cls: "mindos-interview-detail-section-head" });
      setIcon(reqHead.createSpan(), "shield-check");
      reqHead.createSpan({ text: ` 任职要求` });
      const reqList = card.createEl("ul", { cls: "mindos-interview-list-ul" });
      for (const r of jd.requirements) {
        reqList.createEl("li", { text: r });
      }
    }

    if (jd.niceToHave.length > 0) {
      const ntHead = card.createDiv({ cls: "mindos-interview-detail-section-head" });
      setIcon(ntHead.createSpan(), "plus-circle");
      ntHead.createSpan({ text: ` 加分项` });
      const ntList = card.createEl("ul", { cls: "mindos-interview-list-ul" });
      for (const r of jd.niceToHave) {
        ntList.createEl("li", { text: r });
      }
    }
  }

  private renderDangerZone(parent: HTMLElement, jd: JDAnalysis) {
    const card = parent.createDiv({ cls: "mindos-interview-danger-zone" });
    const delBtn = card.createEl("button", { cls: "mindos-btn is-danger-text" });
    setIcon(delBtn.createSpan(), "trash-2");
    delBtn.createSpan({ text: " 删除此 JD 分析" });
    delBtn.onclick = async () => {
      if (!confirm(`确定删除「${jd.position}」？该操作不可恢复！`)) return;
      await this.plugin.interviewStore.delete(jd.id);
      new Notice("✅ 已删除");
      this.currentPage = "list";
      this.currentJDId = null;
      this.plugin.recallStore.reset();
      this.plugin.recallStore.setSelectedScenario("interview");
    };
  }

  // ════════════════════════════════════════════════════════════
  // 页面：新建 JD
  // ════════════════════════════════════════════════════════════
  private renderCreatePage(parent: HTMLElement) {
    const card = parent.createDiv({ cls: "mindos-interview-create-card" });

    // 公司
    const companyRow = card.createDiv({ cls: "mindos-cp-field" });
    companyRow.createDiv({ cls: "mindos-cp-label", text: "公司（可选）" });
    const companyInput = companyRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    companyInput.placeholder = "例如：字节跳动";

    // 职位
    const positionRow = card.createDiv({ cls: "mindos-cp-field" });
    positionRow.createDiv({ cls: "mindos-cp-label", text: "职位（可选，会从 JD 自动提取）" });
    const positionInput = positionRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    positionInput.placeholder = "例如：高级前端工程师";

    // JD 原文
    const rawRow = card.createDiv({ cls: "mindos-cp-field" });
    rawRow.createDiv({ cls: "mindos-cp-label", text: "JD 原文 *（直接粘贴招聘描述）" });
    const rawInput = rawRow.createEl("textarea", { cls: "mindos-cp-textarea" });
    rawInput.placeholder = "粘贴完整的 JD 内容（职位描述、岗位职责、任职要求等）";
    rawInput.rows = 15;
    rawInput.style.fontFamily = "var(--font-monospace)";
    rawInput.style.fontSize = "12px";

    // 按钮
    const btnRow = card.createDiv({ cls: "mindos-cp-btn-row" });
    const analyzeBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(analyzeBtn.createSpan(), "sparkles");
    analyzeBtn.createSpan({ text: " 开始解析" });
    analyzeBtn.onclick = async () => {
      const raw = rawInput.value.trim();
      if (!raw) { new Notice("⚠️ 请粘贴 JD 内容"); return; }

      analyzeBtn.disabled = true;
      const notice = new Notice("AI 解析中...", 0);

      try {
        const jd = await this.plugin.jdAnalyzer.analyze({
          rawText: raw,
          company: companyInput.value.trim() || undefined,
          position: positionInput.value.trim() || undefined,
        });

        notice.hide();
        new Notice(`✅ JD 解析完成：${jd.position}`);
        this.currentJDId = jd.id;
        this.currentPage = "detail";
        this.plugin.recallStore.reset();
        this.plugin.recallStore.setSelectedScenario("interview");
      } catch (e) {
        notice.hide();
        new Notice(`❌ 解析失败：${e instanceof Error ? e.message : String(e)}`);
        analyzeBtn.disabled = false;
      }
    };

    setTimeout(() => rawInput.focus(), 50);
  }

  // ════════════════════════════════════════════════════════════
  // 操作：知识盘点
  // ════════════════════════════════════════════════════════════
  private async runGapAnalysis(jd: JDAnalysis) {
    if (!confirm(`将对 ${jd.skills.length} 个技能逐一进行知识盘点（需要向量索引就绪），继续？`)) {
      return;
    }

    const notice = new Notice(`知识盘点中... 0/${jd.skills.length}`, 0);

    try {
      const updated = await this.plugin.gapAnalyzer.analyze(jd, (p) => {
        notice.setMessage(`知识盘点中... ${p.done}/${p.total} (${p.currentSkill})`);
      });

      notice.hide();
      new Notice(`✅ 盘点完成：整体准备度 ${(updated.gapAnalysis!.overallReadiness * 100).toFixed(0)}%`);
      // 刷新视图
      this.plugin.recallStore.reset();
      this.plugin.recallStore.setSelectedScenario("interview");
    } catch (e) {
      notice.hide();
      new Notice(`❌ 盘点失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

    // ════════════════════════════════════════════════════════════
  // ✅ 新增：AI 增强盘点
  // ════════════════════════════════════════════════════════════
  private async runAIEnhancedAnalysis(jd: JDAnalysis) {
    const weakCount = jd.gapAnalysis
      ? jd.gapAnalysis.missingCount + jd.gapAnalysis.partialCount
      : jd.skills.length;

    const confirmMsg = `AI 增强盘点将：

1️⃣ 调用 AI 生成 ${weakCount} 个薄弱技能的完整知识
2️⃣ 把生成的知识自动整理保存到你的 Wiki
3️⃣ 重新向量化索引
4️⃣ 重新盘点（这次很多技能会变成已掌握）

预计耗时：${weakCount} 分钟左右
预计 Token：约 ${weakCount * 3000} tokens

继续吗？`;

    if (!confirm(confirmMsg)) return;

    const notice = new Notice("准备开始...", 0);

    try {
      const result = await this.plugin.gapAnalyzer.aiEnhancedAnalyze(
        jd,
        this.plugin,
        (p) => {
          const phase = p.phase ?? "处理中";
          const skill = p.currentSkill ? ` · ${p.currentSkill}` : "";
          notice.setMessage(`${phase} ${p.done}/${p.total}${skill}`);
        },
      );

      notice.hide();

      const updated = result.jd;
      const newPct = updated.gapAnalysis
        ? (updated.gapAnalysis.overallReadiness * 100).toFixed(0)
        : "?";

      let msg = `✅ AI 增强完成！\n\n`;
      msg += `📚 新增知识：${result.addedKnowledge} 项已保存到 Wiki\n`;
      msg += `📊 新准备度：${newPct}%\n`;
      if (result.errors.length > 0) {
        msg += `⚠️ ${result.errors.length} 个失败`;
      }

      new Notice(msg, 8000);

      // 刷新视图
      this.plugin.recallStore.reset();
      this.plugin.recallStore.setSelectedScenario("interview");
    } catch (e) {
      notice.hide();
      new Notice(`❌ AI 增强失败：${e instanceof Error ? e.message : String(e)}`, 5000);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 操作：为薄弱技能生成复习卡
  // ════════════════════════════════════════════════════════════
  private async generateCardsForWeakSkills(jd: JDAnalysis, weakSkills: SkillRequirement[]) {
    if (weakSkills.length === 0) return;

    if (!confirm(`将为 ${weakSkills.length} 个薄弱技能各生成 1 张复习卡片（共 ${weakSkills.length} 张），继续？`)) {
      return;
    }

    const notice = new Notice(`生成中... 0/${weakSkills.length}`, 0);
    let done = 0;
    let success = 0;

    try {
      const cards: RecallCard[] = [];

      for (const skill of weakSkills) {
        done++;
        notice.setMessage(`生成中... ${done}/${weakSkills.length} (${skill.skill})`);

        try {
          const card = this.makeInterviewCard(jd, skill);
          cards.push(card);
          success++;
        } catch (e) {
          // 单个失败不阻塞
        }
      }

      if (cards.length > 0) {
        await this.plugin.recallCardStore.saveCards(cards);
        this.plugin.recallCardStore.invalidateCache("interview");
      }

      notice.hide();
      new Notice(`✅ 已为 ${success} 个技能创建复习卡（场景：面试助手）`);

      const todayStats = await this.plugin.recallCardStore.getTodayStats();
      this.plugin.recallStore.setTodayStats(todayStats);
    } catch (e) {
      notice.hide();
      new Notice(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 为薄弱技能构造一张简单的"准备题目卡"
   */
  private makeInterviewCard(jd: JDAnalysis, skill: SkillRequirement): RecallCard {
    const id = `interview_${generateUID()}`;
    const meta: InterviewCardMetadata = {
      jdId: jd.id,
      jdPosition: jd.position,
      skill: skill.skill,
      category: skill.category,
      difficulty: skill.level === "advanced" || skill.level === "expert" ? "hard" :
                  skill.level === "intermediate" ? "medium" : "easy",
    };

    const statusEmoji = skill.status === "missing" ? "❌ 完全缺失" : "🟡 部分掌握";

    const front = `面试题：请讲讲 **${skill.skill}** 的核心要点`;
    const back = `# ${skill.skill}

**所属：** ${skill.category} · ${SKILL_LEVEL_LABELS[skill.level]}

**应聘职位：** ${jd.position}${jd.company ? ` @ ${jd.company}` : ""}

**当前状态：** ${statusEmoji}（盘点匹配度 ${((skill.coverage ?? 0) * 100).toFixed(0)}%）

---

## 学习建议

请系统学习 **${skill.skill}** 的以下方面：
- 核心概念与定义
- 主要使用场景
- 与相关技术的对比
- 实战经验/案例

${skill.matchedPages && skill.matchedPages.length > 0
  ? `**Wiki 中已有相关页面：**\n${skill.matchedPages.map((p) => `- [[${this.basename(p)}]]`).join("\n")}`
  : "**Wiki 中暂无相关页面**，建议从基础开始学习"}`;

    return {
      id,
      scenario: "interview" as RecallScenario,
      front,
      back,
      hints: skill.keywords.slice(0, 3),
      examples: [],
      metadata: meta,
      sourcePath: skill.matchedPages?.[0],
      sourceSection: jd.position,
      srs: this.srsEngine.createInitialSRS(),
      stats: {
        totalReviews: 0,
        correctCount: 0,
        wrongCount: 0,
        avgResponseTimeMs: 0,
        streak: 0,
      },
      tags: ["interview", jd.position, skill.category, skill.skill].filter(Boolean) as string[],
      status: "new",
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };
  }

  // ════════════════════════════════════════════════════════════
  // 弹窗：查看 JD 原文
  // ════════════════════════════════════════════════════════════
  private showRawJD(jd: JDAnalysis) {
    const modal = new RawJDModal(this.plugin.app, jd);
    modal.open();
  }

  // ════════════════════════════════════════════════════════════
  // 辅助
  // ════════════════════════════════════════════════════════════
  private readinessClass(pct: number): string {
    if (pct >= 80) return "is-excellent";
    if (pct >= 60) return "is-good";
    if (pct >= 40) return "is-medium";
    return "is-low";
  }

  private basename(path: string): string {
    const parts = path.split("/");
    const last = parts[parts.length - 1] ?? path;
    return last.replace(/\.md$/, "");
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
  
  // ════════════════════════════════════════════════════════════
  // 启动模拟面试（弹窗选项）
  // ════════════════════════════════════════════════════════════
  private startMockInterview(jd: JDAnalysis) {
    if (!jd.gapAnalysis) {
      new Notice("⚠️ 请先完成知识盘点");
      return;
    }

    // 如果已有题目，可以选择直接开始或重新生成
    if (jd.questions && jd.questions.length > 0) {
      this.showMockInterviewModal(jd, true);
    } else {
      this.showMockInterviewModal(jd, false);
    }
  }

  private showMockInterviewModal(jd: JDAnalysis, hasExisting: boolean) {
    const modal = new MockInterviewSetupModal(
      this.plugin.app,
      jd,
      hasExisting,
      async (action, opts) => {
        if (action === "use_existing") {
          this.enterMockSession(jd, jd.questions ?? []);
        } else if (action === "regenerate") {
          await this.generateAndStart(jd, opts);
        }
      },
    );
    modal.open();
  }

  private async generateAndStart(jd: JDAnalysis, opts: { count: number; focus: boolean; difficulty: string }) {
    const notice = new Notice(`生成模拟题中... 0/${opts.count}`, 0);

    try {
      const questions = await this.plugin.mockInterviewer.generateQuestions(
        {
          jdId: jd.id,
          totalCount: opts.count,
          focusOnWeakness: opts.focus,
          difficulty: opts.difficulty as any,
        },
        (p) => {
          notice.setMessage(`生成模拟题中... ${p.done}/${p.total} (${p.currentBatch})`);
        },
      );

      notice.hide();
      new Notice(`✅ 已生成 ${questions.length} 道题`);

      // 重新拉取最新 JD（含 questions）
      const freshJD = await this.plugin.interviewStore.getById(jd.id);
      if (freshJD) {
        this.enterMockSession(freshJD, questions);
      }
    } catch (e) {
      notice.hide();
      new Notice(`❌ 生成失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private enterMockSession(jd: JDAnalysis, questions: InterviewQuestion[]) {
    if (questions.length === 0) {
      new Notice("⚠️ 没有可用的题目");
      return;
    }

    this.plugin.mockInterviewView.startSession(jd, questions);
    // 切换状态触发渲染
    this.plugin.recallStore.reset();
    this.plugin.recallStore.setSelectedScenario("interview");
  }
}

// ════════════════════════════════════════════════════════════
// 模拟面试设置弹窗（在文件末尾追加）
// ════════════════════════════════════════════════════════════
import { Modal as ObsidianModal } from "obsidian";

export class MockInterviewSetupModal extends ObsidianModal {
  constructor(
    app: any,
    private jd: JDAnalysis,
    private hasExisting: boolean,
    private onChoose: (
      action: "use_existing" | "regenerate",
      opts: { count: number; focus: boolean; difficulty: string },
    ) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-mock-setup-modal");

    contentEl.createEl("h2", { text: "🎯 模拟面试设置" });

    contentEl.createDiv({
      cls: "mindos-cp-tip",
      text: `应聘职位：${this.jd.position}${this.jd.company ? " @ " + this.jd.company : ""}`,
    });

    if (this.hasExisting && this.jd.questions) {
      const existingCard = contentEl.createDiv({ cls: "mindos-mock-existing-card" });
      existingCard.createDiv({
        cls: "mindos-mock-existing-title",
        text: `📚 已有 ${this.jd.questions.length} 道题`,
      });
      existingCard.createDiv({
        cls: "mindos-mock-existing-desc",
        text: "可以直接开始已生成的题目，或重新生成新题",
      });

      const useBtn = existingCard.createEl("button", { cls: "mindos-btn is-primary" });
      setIcon(useBtn.createSpan(), "play");
      useBtn.createSpan({ text: " 使用已有题目开始" });
      useBtn.onclick = () => {
        this.onChoose("use_existing", { count: 0, focus: false, difficulty: "" });
        this.close();
      };

      contentEl.createEl("hr");
      contentEl.createDiv({
        cls: "mindos-cp-label",
        text: "或者：重新生成新题",
      });
    }

    // 题目数量
    const countRow = contentEl.createDiv({ cls: "mindos-cp-field" });
    countRow.createDiv({ cls: "mindos-cp-label", text: "题目数量" });
    const countInput = countRow.createEl("input", { type: "number", cls: "mindos-cp-input" });
    countInput.value = "10";
    countInput.min = "3";
    countInput.max = "30";

    // 难度
    const diffRow = contentEl.createDiv({ cls: "mindos-cp-field" });
    diffRow.createDiv({ cls: "mindos-cp-label", text: "难度" });
    const diffSelect = diffRow.createEl("select", { cls: "mindos-cp-select" });
    [
      { v: "mixed", l: "🎲 混合（推荐）" },
      { v: "easy", l: "🟢 简单" },
      { v: "medium", l: "🟡 中等" },
      { v: "hard", l: "🔴 困难" },
    ].forEach((d) => {
      const opt = diffSelect.createEl("option", { value: d.v, text: d.l });
      if (d.v === "mixed") opt.selected = true;
    });

    // 重点关注薄弱项
    const focusRow = contentEl.createDiv({ cls: "mindos-cp-field" });
    const focusLabel = focusRow.createEl("label");
    focusLabel.style.display = "flex";
    focusLabel.style.alignItems = "center";
    focusLabel.style.gap = "8px";
    focusLabel.style.fontSize = "13px";
    focusLabel.style.cursor = "pointer";
    const focusCheck = focusLabel.createEl("input");
    focusCheck.type = "checkbox";
    focusCheck.checked = true;
    focusLabel.createSpan({ text: "重点出薄弱项的题（推荐）" });

    // 按钮
    const btnRow = contentEl.createDiv({ cls: "mindos-cp-btn-row" });
    const cancelBtn = btnRow.createEl("button", { cls: "mindos-btn" });
    cancelBtn.setText("取消");
    cancelBtn.onclick = () => this.close();

    const genBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(genBtn.createSpan(), "sparkles");
    genBtn.createSpan({ text: " 生成并开始" });
    genBtn.onclick = () => {
      const count = parseInt(countInput.value);
      if (!Number.isFinite(count) || count <= 0) {
        new Notice("⚠️ 题目数量无效");
        return;
      }

      this.onChoose("regenerate", {
        count,
        focus: focusCheck.checked,
        difficulty: diffSelect.value,
      });
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════
// 查看 JD 原文弹窗
// ════════════════════════════════════════════════════════════
class RawJDModal extends Modal {
  constructor(app: any, private jd: JDAnalysis) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-jd-raw-modal");

    contentEl.createEl("h3", { text: `📄 ${this.jd.position} - 原文` });

    const pre = contentEl.createEl("pre", { cls: "mindos-jd-raw-pre" });
    pre.setText(this.jd.rawText);

    const btnRow = contentEl.createDiv({ cls: "mindos-jd-raw-btn-row" });
    const copyBtn = btnRow.createEl("button", { cls: "mindos-btn" });
    setIcon(copyBtn.createSpan(), "copy");
    copyBtn.createSpan({ text: " 复制" });
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(this.jd.rawText);
      new Notice("✅ 已复制");
    };

    const closeBtn = btnRow.createEl("button", { cls: "mindos-btn is-primary" });
    closeBtn.setText("关闭");
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}