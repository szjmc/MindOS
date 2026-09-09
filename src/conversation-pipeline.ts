/**
 * 对话流水线引擎 —— 从 main.ts 提取
 * 负责对话采集、解析、Pipeline 执行、审核
 */
import { Notice, TFile, normalizePath } from "obsidian";
import {
  DIR_RAW_CONVERSATIONS,
  DIR_RAW,
  DIR_WIKI,
  DIR_SCHEMA,
} from "./core/constants";
import {
  PromptPayload,
  ConversationRound,
  WikiAction,
} from "./core/types";
import {
  normalizeText,
  decodeParam,
  simpleHash,
  nowISOString,
  parseFrontmatter,
  buildFrontmatter,
  truncateBrief,
  safeFileName,
  vaultSave,
} from "./core/utils";

// ── 依赖适配 ──

export interface PipelineDeps {
  app: any;
  workspaces: any;
  getSettings: () => any;
  saveSettings: () => Promise<void>;
  getBaseFolder: () => string;
  taskStore: any;
  retrieveStore: any;
  schemaManager: any;
  indexManager: any;
  migrator: any;
  workflowEngine: any;
  executor: any;
  embeddingManager: any;
  aiClient: any;
  unifiedParser: any;
  openFile: (path: string) => void;
  activateTaskCenter: () => Promise<void>;
  showContextAwarenessPanel: () => Promise<void>;
}

let _deps: PipelineDeps | null = null;

export function setPipelineDeps(d: PipelineDeps) { _deps = d; }

function dep(): PipelineDeps { return _deps!; }

// ════════════════════════════════════════════════════════════
// 初始化结构
// ════════════════════════════════════════════════════════════

export async function initializeStructure(): Promise<void> {
  const d = dep();
  await ensureFolder(`${d.getBaseFolder()}/${DIR_RAW}`);
  await ensureFolder(`${d.getBaseFolder()}/${DIR_RAW_CONVERSATIONS}`);
  await ensureFolder(`${d.getBaseFolder()}/${DIR_WIKI}`);
  await ensureFolder(`${d.getBaseFolder()}/${DIR_SCHEMA}`);
  await d.schemaManager.initialize();
  await d.indexManager.rebuild();
}

export async function migrateOldStructure(): Promise<any> {
  return await dep().migrator.migrate();
}

// ════════════════════════════════════════════════════════════
// 采集 & 协议
// ════════════════════════════════════════════════════════════

function readClipboardText(): string {
  try {
    const { clipboard } = require("electron");
    return String(clipboard.readText() ?? "");
  } catch { return ""; }
}

export async function collectFromClipboard(meta: Partial<PromptPayload>): Promise<void> {
  const text = normalizeText(readClipboardText());
  if (!text) { new Notice("剪贴板为空"); return; }
  await processConversation({
    source: meta.source ?? "clipboard",
    title: meta.title,
    pageTitle: meta.pageTitle,
    url: meta.url,
    content: text,
  });
}

export async function handleProtocol(params: Record<string, any>): Promise<void> {
  const mode = (decodeParam(params.mode) || "clipboard").toLowerCase();
  const source = decodeParam(params.source) || "browser";
  const title = decodeParam(params.title) || "";
  const pageTitle = decodeParam(params.page_title) || decodeParam(params.pageTitle) || "";
  const url = decodeParam(params.page_url) || decodeParam(params.url) || "";

  if (mode === "clipboard") {
    await collectFromClipboard({ source, title, pageTitle, url });
    return;
  }

  const content = normalizeText(decodeParam(params.content));
  if (!content) { new Notice("协议中无内容"); return; }
  await processConversation({ source, title, pageTitle, url, content });
}

// ════════════════════════════════════════════════════════════
// 核心流水线
// ════════════════════════════════════════════════════════════

let _stopRequested = false;
let _currentRounds: ConversationRound[] | null = null;
let _currentPayload: PromptPayload | null = null;

export function getCurrentRounds() { return _currentRounds; }
export function getCurrentPayload() { return _currentPayload; }

export function requestStop(): void {
  _stopRequested = true;
  dep().taskStore.log("⏹ 用户请求中止");
}

export function resetState(): void {
  _stopRequested = false;
  _currentRounds = null;
  _currentPayload = null;
}

export async function processConversation(payload: PromptPayload): Promise<void> {
  const d = dep();
  await d.activateTaskCenter();
  d.taskStore.reset();
  _stopRequested = false;
  d.retrieveStore.setTab("capture");

  try {
    await initializeStructure();

    d.taskStore.setStatus("running", "解析回合", "正在解析对话内容");
    d.taskStore.log("ℹ️ 开始处理新对话");

    const rounds = parseRounds(payload.content);
    d.taskStore.log(`ℹ️ 识别到 ${rounds.length} 个回合`);
    if (rounds.length === 0) throw new Error("未识别到有效回合");
    d.taskStore.setTotalRounds(rounds.length);

    const rawPath = await saveRawConversationMerged(rounds, payload);
    for (const r of rounds) {
      r.rawPath = rawPath;
      r.anchor = `round-${r.round}`;
    }
    d.taskStore.log(`📂 raw 已存档：${rawPath}`);

    const actions = await d.workflowEngine.runPipeline(rounds, payload);

    if (_stopRequested) {
      d.taskStore.setStatus("done", "已中止", "用户中止处理");
      d.taskStore.finishPipeline();
      return;
    }

    _currentRounds = rounds;
    _currentPayload = payload;

    if (d.getSettings().reviewMode) {
      if (actions.length === 0) {
        d.taskStore.setStatus("done", "完成", "无需执行任何动作");
      } else {
        d.taskStore.addPendingActions(actions);
        d.taskStore.setStatus("awaiting_review", "等待审核", `共 ${actions.length} 个动作待审核`);
      }
    } else {
      await executeAllActions(actions, rounds, payload);
      d.taskStore.setStatus("done", "完成", "所有动作已执行");
    }

    d.taskStore.finishPipeline();
    d.taskStore.addResult({
      round: 0,
      rawFilePath: rawPath,
      actions,
      summary: `处理完成：${actions.length} 个动作`,
    });

    for (const a of actions) {
      if (a.op === "create" && a.path) {
        d.embeddingManager.notifyFileChanged(a.path);
      }
    }

    new Notice(`✅ 处理完成（${actions.length} 个动作）`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    d.taskStore.setStatus("error", "失败", msg);
    d.taskStore.setError(msg);
    d.taskStore.finishPipeline();
    new Notice("❌ 处理失败，请查看任务中心");
  }
}

// ════════════════════════════════════════════════════════════
// 审核
// ════════════════════════════════════════════════════════════

export async function approveAction(id: string): Promise<void> {
  const d = dep();
  if (!_currentRounds || !_currentPayload) {
    new Notice("没有可执行的上下文");
    return;
  }
  const state = d.taskStore.getState();
  const a = state.pendingActions.find((x: WikiAction) => x.id === id);
  if (!a) return;

  try {
    await d.executor.execute(a, _currentRounds, _currentPayload);
    d.taskStore.log(`✅ ${a.op.toUpperCase()} ${a.title}`);
    if (d.getSettings().openAfterSave && a.op === "create" && a.path) {
      await d.openFile(a.path);
    }
    if (a.path) d.embeddingManager.notifyFileChanged(a.path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    d.taskStore.log(`❌ 执行失败：${a.title} - ${msg}`);
  }
  d.taskStore.removePendingAction(id);

  if (d.taskStore.getState().pendingActions.length === 0) {
    d.taskStore.setStatus("done", "完成", "所有 action 已处理");
  }
}

export async function approveAllActions(): Promise<void> {
  const d = dep();
  if (!_currentRounds || !_currentPayload) {
    new Notice("没有可执行的上下文");
    return;
  }
  const actions = [...d.taskStore.getState().pendingActions];
  await executeAllActions(actions, _currentRounds, _currentPayload);
  d.taskStore.clearPendingActions();
  d.taskStore.setStatus("done", "完成", "全部 actions 执行完毕");
}

export async function executeAllActions(
  actions: WikiAction[],
  rounds: ConversationRound[],
  payload: PromptPayload,
): Promise<void> {
  const d = dep();
  for (const a of actions) {
    try {
      await d.executor.execute(a, rounds, payload);
      d.taskStore.log(`✅ ${a.op.toUpperCase()} ${a.title}`);
      if (a.path) d.embeddingManager.notifyFileChanged(a.path);
      
      if (a.op === "create" && a.path && d.unifiedParser) {
        await processWikiWithUnifiedParser(d, a.path);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      d.taskStore.log(`❌ ${a.title} 执行失败：${msg}`);
    }
  }
}

async function processWikiWithUnifiedParser(d: PipelineDeps, filePath: string): Promise<void> {
  try {
    d.taskStore.log(`🤖 开始解析文档内容...`);
    const result = await d.unifiedParser.parse(filePath, false);
    
    if (result.summary) {
      d.taskStore.log(`✅ 生成总结完成`);
    }
    if (result.questions && result.questions.length > 0) {
      d.taskStore.log(`✅ 生成 ${result.questions.length} 个复习问题`);
    }
    if (result.keyConcepts && result.keyConcepts.length > 0) {
      d.taskStore.log(`✅ 提取 ${result.keyConcepts.length} 个关键概念`);
    }
  } catch (e) {
    d.taskStore.log(`⚠️ 文档解析跳过：${e instanceof Error ? e.message : String(e)}`);
  }
}

// ════════════════════════════════════════════════════════════
// Brief 补全
// ════════════════════════════════════════════════════════════

export async function fillMissingBriefs(): Promise<void> {
  const d = dep();
  const pages = await d.indexManager.scanAllWikiPages();
  const missing = pages.filter((p: any) => !p.brief);
  if (missing.length === 0) {
    new Notice("✅ 所有页面都有 brief");
    return;
  }
  d.taskStore.log(`🤖 开始补全 ${missing.length} 个页面的 brief`);
  let done = 0;
  for (const p of missing) {
    const file = d.app.vault.getAbstractFileByPath(p.path);
    if (!(file instanceof TFile)) continue;
    try {
      const content = await d.app.vault.read(file);
      const { frontmatter, body } = parseFrontmatter(content);
      const brief = await d.aiClient.generateBrief(p.title, body, d.getSettings().briefMaxLength);
      frontmatter.brief = truncateBrief(brief, d.getSettings().briefMaxLength);
      const newFm = buildFrontmatter(frontmatter);
      await d.app.vault.modify(file, `${newFm}\n${body}`);
      d.taskStore.log(`✅ ${p.title} → ${frontmatter.brief}`);
      done++;
      d.embeddingManager.notifyFileChanged(p.path);
    } catch (e) {
      d.taskStore.log(`❌ ${p.title} 失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await d.indexManager.rebuild();
  new Notice(`补全完成：${done}/${missing.length}`);
}

// ════════════════════════════════════════════════════════════
// 批量解析已有页面（离线可用）
// ════════════════════════════════════════════════════════════

export async function batchParseAllWikiPages(): Promise<void> {
  const d = dep();
  if (!d.unifiedParser) {
    new Notice("统一解析器未初始化");
    return;
  }

  const pages = await d.indexManager.scanAllWikiPages();
  if (pages.length === 0) {
    new Notice("没有找到 Wiki 页面");
    return;
  }

  await d.activateTaskCenter();
  d.taskStore.reset();
  d.taskStore.setStatus("running", "批量解析", `正在解析 ${pages.length} 个页面`);
  d.taskStore.log(`🤖 开始批量解析 ${pages.length} 个 Wiki 页面`);

  let done = 0;
  let failed = 0;

  for (const p of pages) {
    const file = d.app.vault.getAbstractFileByPath(p.path);
    if (!(file instanceof TFile)) continue;

    try {
      const result = await d.unifiedParser.parse(p.path, false);
      done++;
      
      const summaryParts = [];
      if (result.summary) summaryParts.push("总结");
      if (result.questions && result.questions.length > 0) summaryParts.push(`${result.questions.length}个问题`);
      if (result.keyConcepts && result.keyConcepts.length > 0) summaryParts.push(`${result.keyConcepts.length}个概念`);
      
      d.taskStore.log(`✅ ${p.title} → ${summaryParts.join("、")}`);
    } catch (e) {
      failed++;
      d.taskStore.log(`❌ ${p.title} 失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  d.taskStore.setStatus("done", "完成", `成功 ${done}，失败 ${failed}`);
  d.taskStore.finishPipeline();
  new Notice(`批量解析完成：${done} 成功，${failed} 失败`);
}

// ════════════════════════════════════════════════════════════
// 解析 & 存档
// ════════════════════════════════════════════════════════════

export function parseRounds(content: string): ConversationRound[] {
  const text = normalizeText(content);
  const sections = text.split(/\n(?=###\s*第?\s*\d+\s*回合)/g).filter(Boolean);

  if (sections.length > 0 && sections.some((s) => /##\s*用户/.test(s))) {
    const rounds: ConversationRound[] = [];
    sections.forEach((sec, i) => {
      const userMatch = sec.match(/##\s*用户\s*\n([\s\S]*?)(?=\n##\s*AI\b|\s*$)/);
      const aiMatch = sec.match(/##\s*AI\s*\n([\s\S]*?)$/);
      const user = normalizeText(userMatch?.[1] || "");
      const ai = normalizeText(aiMatch?.[1] || "");
      if (!user && !ai) return;
      rounds.push({
        round: i + 1, user, ai, raw: normalizeText(sec),
        hash: simpleHash(`${user}\n---\n${ai}`),
      });
    });
    if (rounds.length > 0) return rounds;
  }

  const regex = /##\s*用户\s*\n([\s\S]*?)(?=\n##\s*AI\b)\n##\s*AI\s*\n([\s\S]*?)(?=\n##\s*用户|\s*$)/g;
  const rounds: ConversationRound[] = [];
  let m: RegExpExecArray | null;
  let i = 1;
  while ((m = regex.exec(text)) !== null) {
    const user = normalizeText(m[1]);
    const ai = normalizeText(m[2]);
    rounds.push({
      round: i++, user, ai,
      raw: `## 用户\n${user}\n\n## AI\n${ai}`,
      hash: simpleHash(`${user}\n---\n${ai}`),
    });
  }
  if (rounds.length > 0) return rounds;

  return [{ round: 1, user: text, ai: "", raw: text, hash: simpleHash(text) }];
}

export async function saveRawConversationMerged(
  rounds: ConversationRound[],
  payload: PromptPayload,
): Promise<string> {
  const d = dep();
  const folder = `${d.getBaseFolder()}/${DIR_RAW_CONVERSATIONS}`;
  await ensureFolder(folder);
  const ts = new Date().toISOString().replace(/[-:T]/g, "").substring(0, 15);
  const titlePart = (payload.pageTitle || payload.source || "对话").substring(0, 20);
  const fileName = safeFileName(`${ts}-${titlePart}`);
  const path = normalizePath(`${folder}/${fileName}.md`);

  const fm = buildFrontmatter({
    source: payload.source ?? "unknown",
    url: payload.url ?? "",
    page_title: payload.pageTitle ?? "",
    collected_at: nowISOString(),
    total_rounds: rounds.length,
    tags: ["raw", "conversation"],
  });

  const sections = rounds.map((r) =>
    `## 回合 ${r.round} ^round-${r.round}\n\n### 用户\n\n${r.user || "(空)"}\n\n### AI\n\n${r.ai || "(空)"}`
  ).join("\n\n---\n\n");

  const content = `${fm}\n\n# 原始对话存档\n\n> 来源：${payload.source ?? "unknown"} | 共 ${rounds.length} 回合\n> 采集时间：${nowISOString()}\n\n---\n\n${sections}\n`;

  await vaultSave(d.app, path, content);
  return path;
}

// ════════════════════════════════════════════════════════════
// 工具
// ════════════════════════════════════════════════════════════

export async function ensureFolder(p: string): Promise<void> {
  const d = dep();
  const path = normalizePath(p);
  // adapter.exists 直查文件系统，不依赖 Obsidian 索引
  if (await d.app.vault.adapter.exists(path)) return;
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!(await d.app.vault.adapter.exists(cur))) {
      try {
        await d.app.vault.createFolder(cur);
      } catch (e: any) {
        // 并发竞态：文件夹在 check 和 create 之间被创建
        if (!e?.message?.includes?.("already exists")) throw e;
      }
    }
  }
}
