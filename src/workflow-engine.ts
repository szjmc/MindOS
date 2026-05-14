import {
  ConversationRound,
  PromptPayload,
  RoundCluster,
  DraftDoc,
  DiffDecision,
  WikiAction,
  AIPromptCollectorSettings,
  DraftBlock,
} from "./types";
import { AIClient } from "./ai-client";
import { IndexManager } from "./index-manager";
import { SimilarityScorer } from "./similarity";
import { TaskStore } from "./store";
import { generateActionId } from "./utils";
import { App, TFile } from "obsidian";

export class WorkflowEngine {
  private similarity = new SimilarityScorer();

  constructor(
    private app: App,
    private getSettings: () => AIPromptCollectorSettings,
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

    try {
      // 阶段 1：聚类
      store.setPipelineStage("cluster", "running", `分析 ${rounds.length} 个回合`);
      const clusters = await this.aiClient.clusterRounds(rounds);
      store.setPipelineClusters(clusters);
      store.setPipelineStage("cluster", "done", `识别出 ${clusters.length} 个独立主题`);
      store.log(`✅ 聚类：${clusters.length} 组`);
      clusters.forEach((c) => store.log(`  · ${c.id}：回合 [${c.rounds.join(",")}] - ${c.topic}`));
      if (this.isStopRequested()) return [];

      // 阶段 2：草稿
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

      // 阶段 3：比对
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

      // 阶段 4：转化为 actions
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
          tags: draft.tags,
          content: this.assembleContent(draft.blocks, rounds),
          blocks: draft.blocks,
          links: [],
          reason: decision.reason || "新主题",
          status: "pending",
          sourceRounds: draft.sourceRounds,
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
            content: this.assembleContent([block], rounds),
            blocks: [block],
            section: block.heading,
            links: [],
            reason: decision.reason,
            status: "pending",
            sourceRounds: block.sourceRounds,
          });
        }
      }
    }

    return actions;
  }

  private assembleContent(blocks: DraftBlock[], rounds: ConversationRound[]): string {
    const parts: string[] = [];
    for (const b of blocks) {
      parts.push(b.heading);
      parts.push("");
      parts.push(b.content.trim());
      parts.push("");
      const callout = this.buildSourceCallout(b.sourceRounds, rounds);
      if (callout) {
        parts.push(callout);
        parts.push("");
      }
    }
    return parts.join("\n");
  }

  private buildSourceCallout(sourceRounds: number[], rounds: ConversationRound[]): string {
    if (!sourceRounds || sourceRounds.length === 0) return "";
    const lines: string[] = [];
    lines.push(`> [!source]- 📎 来源（${sourceRounds.length} 个回合）`);
    for (const rn of sourceRounds) {
      const r = rounds.find((x) => x.round === rn);
      if (!r) continue;
      const path = r.rawPath ?? "";
      const anchor = r.anchor ?? `round-${rn}`;
      const link = path ? `[[${path}#^${anchor}|回合 ${rn}]]` : `回合 ${rn}`;
      const preview = String(r.user ?? "").replace(/\s+/g, " ").substring(0, 40);
      lines.push(`> - ${link}：${preview}${preview.length >= 40 ? "…" : ""}`);
    }
    return lines.join("\n");
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
          refs.push(`[[${r.rawPath}#^${r.anchor ?? `round-${rn}`}|回合 ${rn}]]`);
        }
      }
      if (refs.length > 0) lines.push(`  - 来源：${refs.join("、")}`);
    }
    return lines.join("\n");
  }
}