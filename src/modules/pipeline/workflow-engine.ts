import {
  ConversationRound,
  PromptPayload,
  RoundCluster,
  DraftDoc,
  DiffDecision,
  WikiAction,
  MindOSSettings,
  DraftBlock,
} from "../../core/types";
import { AIClient } from "./ai-client";
import { IndexManager } from "../wiki/index-manager";
import { SimilarityScorer } from "./similarity";
import { TaskStore } from "../../core/store";
import { generateActionId } from "../../core/utils";
import { App, TFile } from "obsidian";

export class WorkflowEngine {
  private similarity = new SimilarityScorer();
  private currentPayload: PromptPayload | null = null;
  private currentClusters: RoundCluster[] = [];

  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private getBaseFolder: () => string,
    private aiClient: AIClient,
    private indexManager: IndexManager,
    private taskStore: TaskStore,
    private isStopRequested: () => boolean,
  ) {}

  async runPipeline(
    rounds: ConversationRound[],
    payload: PromptPayload,
  ): Promise<WikiAction[]> {
    const store = this.taskStore;
    store.startPipeline();

    this.currentPayload = payload;

    try {
      store.setPipelineStage("cluster", "running", `分析 ${rounds.length} 个回合`);
      const clusters = await this.aiClient.clusterRounds(rounds);
      store.setPipelineClusters(clusters);
      store.setPipelineStage("cluster", "done", `识别出 ${clusters.length} 个独立主题`);
      store.log(`✅ 聚类：${clusters.length} 组`);
      clusters.forEach((c) => store.log(`  · ${c.id}：回合 [${c.rounds.join(",")}] - ${c.topic}`));

      this.currentClusters = clusters;
      if (this.isStopRequested()) return [];

      store.setPipelineStage("draft", "running", `逐组整理（共 ${clusters.length}）`);
      const drafts: DraftDoc[] = [];
      for (let i = 0; i < clusters.length; i++) {
        if (this.isStopRequested()) break;
        const c = clusters[i];
        store.setPipelineStage("draft", "running", `[${i + 1}/${clusters.length}] ${c.topic}`);
        try {
          const draft = await this.aiClient.draftFromCluster(c, rounds);
          drafts.push(draft);
          store.log(`✅ 草稿：${draft.title}（${draft.blocks.length} 个块）`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          store.log(`❌ 组 ${c.id} 草稿失败：${msg}`);
        }
      }
      store.setPipelineDrafts(drafts);
      store.setPipelineStage("draft", "done", `生成 ${drafts.length} 份草稿`);
      if (this.isStopRequested()) return [];

      store.setPipelineStage("diff", "running", "检索现有 Wiki + 比对");
      const allPages = await this.indexManager.scanAllWikiPages();
      const decisions: DiffDecision[] = [];

      for (let i = 0; i < drafts.length; i++) {
        if (this.isStopRequested()) break;
        const draft = drafts[i];
        store.setPipelineStage("diff", "running", `[${i + 1}/${drafts.length}] ${draft.title}`);

        const topN = this.getSettings().candidateTopN || 5;
        const candidates = this.similarity.scoreCandidates(draft, allPages, topN);

        if (candidates.length === 0) {
          decisions.push({ type: "create", reason: "无相似页面", draft });
          store.log(`  · ${draft.title} → CREATE（无候选）`);
          continue;
        }

        const candidatesWithContent = await Promise.all(
          candidates.map(async (c) => {
            const f = this.app.vault.getAbstractFileByPath(c.meta.path);
            const content = f instanceof TFile ? await this.app.vault.read(f) : "";
            return { candidate: c, content };
          })
        );

        try {
          const decision = await this.aiClient.diffWithCandidates(draft, candidatesWithContent);
          decisions.push(decision);
          store.log(`  · ${draft.title} → ${decision.type.toUpperCase()}：${decision.reason}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          store.log(`❌ ${draft.title} 比对失败，降级 CREATE：${msg}`);
          decisions.push({ type: "create", reason: `比对失败：${msg}`, draft });
        }
      }
      store.setPipelineDecisions(decisions);
      const mergeCount = decisions.filter((d) => d.type === "merge").length;
      const createCount = decisions.filter((d) => d.type === "create").length;
      const discardCount = decisions.filter((d) => d.type === "discard").length;
      store.setPipelineStage("diff", "done", `merge: ${mergeCount} / create: ${createCount} / discard: ${discardCount}`);

      store.setPipelineStage("execute", "running", "生成执行动作");
      const actions = this.decisionsToActions(decisions, rounds);
      store.setPipelineStage("execute", "done", `共 ${actions.length} 个动作`);

      return actions;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      store.log(`❌ 流水线失败：${msg}`);
      store.setPipelineFailed(msg);
      throw e;
    }
  }

  private decisionsToActions(decisions: DiffDecision[], rounds: ConversationRound[]): WikiAction[] {
    const actions: WikiAction[] = [];

    for (const decision of decisions) {
      const draft = decision.draft;

      if (decision.type === "discard") {
        if (decision.targetPath) {
          actions.push({
            id: generateActionId(),
            op: "append_section",
            pageType: draft.pageType,
            path: decision.targetPath,
            title: draft.title,
            brief: draft.brief,
            tags: draft.tags,
            content: this.buildDiscardMark(draft, rounds),
            blocks: [],
            section: "## 📎 重复确认记录",
            links: [],
            reason: decision.reason,
            status: "pending",
            sourceRounds: draft.sourceRounds,
            sourceDisplayNames: this.collectDisplayNames(draft.sourceRounds),
          });
        }
        continue;
      }

      if (decision.type === "create") {
        actions.push({
          id: generateActionId(),
          op: "create",
          pageType: draft.pageType,
          path: "",
          title: draft.title,
          brief: draft.brief,
          summary: this.deriveSummary(draft),
          category: this.deriveCategory(draft),
          tags: draft.tags,
          content: this.assembleContent(draft.blocks, rounds, draft),
          blocks: draft.blocks,
          links: [],
          reason: decision.reason || "新主题",
          status: "pending",
          sourceRounds: draft.sourceRounds,
          sourceDisplayNames: this.collectDisplayNames(draft.sourceRounds),
        });
        continue;
      }

      if (decision.type === "merge") {
        const newBlocks = decision.newBlocks ?? [];
        if (newBlocks.length === 0) continue;

        for (const block of newBlocks) {
          actions.push({
            id: generateActionId(),
            op: "append_section",
            pageType: draft.pageType,
            path: decision.targetPath ?? "",
            title: draft.title,
            brief: draft.brief,
            tags: draft.tags,
            content: this.assembleContent([block], rounds, draft),
            blocks: [block],
            section: block.heading,
            links: [],
            reason: decision.reason,
            status: "pending",
            sourceRounds: block.sourceRounds,
            sourceDisplayNames: this.collectDisplayNames(block.sourceRounds),
          });
        }
      }
    }

    return actions;
  }

  /**
   * ✅ 收集来源 displayName 列表（去重）
   */
  private collectDisplayNames(sourceRounds: number[] | undefined): string[] {
    if (!sourceRounds) return [];
    const set = new Set<string>();
    for (const rn of sourceRounds) {
      const name = this.buildDisplayName(rn);
      if (name) set.add(name);
    }
    return Array.from(set);
  }

  /**
   * ✅ 推导 summary（基于第一个 block 的内容前 80 字）
   */
  private deriveSummary(draft: DraftDoc): string {
    if (!draft.blocks || draft.blocks.length === 0) return "";
    const firstContent = draft.blocks[0].content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[#>*\-_=`~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (firstContent.length <= 80) return firstContent;
    return firstContent.substring(0, 80) + "…";
  }

  /**
   * ✅ 推导 category（基于第一个标签）
   */
  private deriveCategory(draft: DraftDoc): string {
    const tags = (draft.tags || []).filter(
      (t) => t && t !== "mindos-collected" && t !== "ai-collected",
    );
    return tags[0] ?? "";
  }

  // ════════════════════════════════════════════════════════════
  // 内容组装（v0.6.3 - 智能合并相同来源）
  // ════════════════════════════════════════════════════════════
  private assembleContent(blocks: DraftBlock[], rounds: ConversationRound[], draft: DraftDoc): string {
    if (blocks.length === 0) return "";

    const parts: string[] = [];
    const groups = this.groupBlocksBySource(blocks);

    for (const group of groups) {
      for (const block of group.blocks) {
        parts.push(block.heading);
        parts.push("");
        parts.push(block.content.trim());
        parts.push("");
      }
      const sourceLine = this.buildInlineSourceLine(group.sourceRounds, rounds);
      if (sourceLine) {
        parts.push(sourceLine);
        parts.push("");
      }
    }

    return parts.join("\n");
  }

  private groupBlocksBySource(
    blocks: DraftBlock[],
  ): Array<{ blocks: DraftBlock[]; sourceRounds: number[] }> {
    const groups: Array<{ blocks: DraftBlock[]; sourceRounds: number[] }> = [];

    for (const block of blocks) {
      const blockSources = block.sourceRounds ?? [];
      const lastGroup = groups[groups.length - 1];

      if (lastGroup && this.arraysEqual(lastGroup.sourceRounds, blockSources)) {
        lastGroup.blocks.push(block);
      } else {
        groups.push({
          blocks: [block],
          sourceRounds: [...blockSources],
        });
      }
    }

    return groups;
  }

  private arraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort((x, y) => x - y);
    const sortedB = [...b].sort((x, y) => x - y);
    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return false;
    }
    return true;
  }

  private buildInlineSourceLine(sourceRounds: number[], rounds: ConversationRound[]): string {
    if (!sourceRounds || sourceRounds.length === 0) return "";

    const links: string[] = [];
    for (const rn of sourceRounds) {
      const r = rounds.find((x) => x.round === rn);
      if (!r) continue;
      const path = r.rawPath ?? "";
      const anchor = r.anchor ?? `round-${rn}`;
      const displayName = this.buildDisplayName(rn);

      if (path) {
        links.push(`[[${path}#^${anchor}|${displayName}]]`);
      } else {
        links.push(displayName);
      }
    }

    if (links.length === 0) return "";
    return `> 📎 来源：${links.join("、")}`;
  }

  private buildDisplayName(roundNum: number): string {
    const parts: string[] = [];
    const dateStr = this.getDateString();
    if (dateStr) parts.push(dateStr);
    const source = this.getSourceName();
    if (source) parts.push(source);
    const clusterTopic = this.findClusterTopic(roundNum);
    if (clusterTopic) parts.push(clusterTopic);
    if (parts.length === 0) return `回合 ${roundNum}`;
    return parts.join("—");
  }

  private getDateString(): string {
    if (!this.currentPayload) return "";
    const collectedAt = this.currentPayload.collectedAt;
    if (collectedAt) {
      return collectedAt.substring(0, 10).replace(/-/g, "");
    }
    return new Date().toISOString().substring(0, 10).replace(/-/g, "");
  }

  private getSourceName(): string {
    if (!this.currentPayload) return "";
    const source = this.currentPayload.source ?? "";
    const map: Record<string, string> = {
      "ChatGPT": "ChatGPT",
      "Claude": "Claude",
      "Kimi": "Kimi",
      "豆包": "豆包",
      "通义千问": "通义",
      "文心一言": "文心",
      "browser": "网页",
      "clipboard": "剪贴板",
    };
    return map[source] ?? source;
  }

  private findClusterTopic(roundNum: number): string {
    for (const c of this.currentClusters) {
      if (c.rounds.includes(roundNum)) {
        return c.topic;
      }
    }
    return "";
  }

  private buildDiscardMark(draft: DraftDoc, rounds: ConversationRound[]): string {
    const lines: string[] = [];
    const time = new Date().toISOString().substring(0, 16).replace("T", " ");
    lines.push(`- ${time} 收到重复信息：${draft.title}`);
    if (draft.sourceRounds && draft.sourceRounds.length > 0) {
      const refs: string[] = [];
      for (const rn of draft.sourceRounds) {
        const r = rounds.find((x) => x.round === rn);
        if (r?.rawPath) {
          const displayName = this.buildDisplayName(rn);
          refs.push(`[[${r.rawPath}#^${r.anchor ?? `round-${rn}`}|${displayName}]]`);
        }
      }
      if (refs.length > 0) lines.push(`  - 来源：${refs.join("、")}`);
    }
    return lines.join("\n");
  }
}