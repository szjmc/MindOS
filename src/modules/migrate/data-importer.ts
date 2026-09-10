/**
 * 导入器 —— 从多种格式解析出复习卡片
 *
 * 支持：
 * - MindOS JSON 导出（无损）
 * - Anki 文本（# 指令 + tab/分号分隔）
 * - 通用 CSV/TSV（可选表头）
 *
 * 纯函数实现（不依赖 Obsidian API），便于单元测试。
 */
import {
  RecallCard,
  RecallScenario,
  SRSData,
  RecallCardStats,
} from "../../core/types";
import { generateUID } from "../../core/utils";

const VALID_SCENARIOS: RecallScenario[] = [
  "wiki", "command", "vocab", "interview", "concept", "phrase", "custom",
];

export interface ParsedImport {
  cards: RecallCard[];
  skipped: number;
  errors: string[];
}

/** 判断文本大概是什么格式 */
export function detectFormat(text: string): "json" | "delimited" {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "delimited";
}

/** 新导入卡片的初始 SRS 数据 */
function initialSRS(): SRSData {
  return {
    algorithm: "sm2",
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    stability: 1,
    difficulty: 0.3,
    nextReview: new Date().toISOString().substring(0, 10),
    lastReview: "",
    lastRating: 0,
  };
}

/** 新导入卡片的初始统计 */
function initialStats(): RecallCardStats {
  return {
    totalReviews: 0,
    correctCount: 0,
    wrongCount: 0,
    avgResponseTimeMs: 0,
    streak: 0,
  };
}

function isValidScenario(s: unknown): s is RecallScenario {
  return typeof s === "string" && VALID_SCENARIOS.includes(s as RecallScenario);
}

/** 规范化标签：拆分、去空、去重 */
function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  const text = Array.isArray(raw) ? raw.join(" ") : String(raw);
  const tags = text
    .split(/[\s,;，；]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

/** 由 front/back/tags 构建一张合法的新卡片（标签会被规范化：去 # / 去重） */
export function buildImportedCard(
  front: string,
  back: string,
  tags: string[] = [],
  scenario: RecallScenario = "custom",
): RecallCard {
  const now = new Date().toISOString();
  return {
    id: `imp_${generateUID()}`,
    scenario,
    front: front.trim(),
    back: back.trim(),
    tags: parseTags(tags),
    srs: initialSRS(),
    stats: initialStats(),
    status: "new",
    createdAt: now,
    updatedAt: now,
  };
}

/** 从 JSON 文本解析（支持 MindOS 导出格式或裸数组） */
export function parseCardsFromJSON(
  text: string,
  fallbackScenario: RecallScenario = "custom",
): ParsedImport {
  const errors: string[] = [];
  const cards: RecallCard[] = [];
  let skipped = 0;

  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { cards, skipped, errors: [`JSON 解析失败: ${(e as Error).message}`] };
  }

  const rawCards: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.cards)
      ? data.cards
      : [];

  if (rawCards.length === 0) {
    errors.push("未找到卡片数组（需要顶层数组或 {cards: [...]} 结构）");
    return { cards, skipped, errors };
  }

  for (const raw of rawCards) {
    if (!raw || typeof raw.front !== "string" || !raw.front.trim()) {
      skipped++;
      continue;
    }
    const now = new Date().toISOString();
    const card: RecallCard = {
      id: typeof raw.id === "string" && raw.id ? raw.id : `imp_${generateUID()}`,
      scenario: isValidScenario(raw.scenario) ? raw.scenario : fallbackScenario,
      front: raw.front.trim(),
      back: typeof raw.back === "string" ? raw.back.trim() : "",
      hints: Array.isArray(raw.hints) ? raw.hints : undefined,
      examples: Array.isArray(raw.examples) ? raw.examples : undefined,
      metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : undefined,
      sourcePath: typeof raw.sourcePath === "string" ? raw.sourcePath : undefined,
      tags: parseTags(raw.tags),
      srs: raw.srs && typeof raw.srs === "object" ? { ...initialSRS(), ...raw.srs } : initialSRS(),
      stats: raw.stats && typeof raw.stats === "object" ? { ...initialStats(), ...raw.stats } : initialStats(),
      status: typeof raw.status === "string" ? raw.status : "new",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    };
    cards.push(card);
  }

  return { cards, skipped, errors };
}

/** 解析分隔符文本首部的 Anki 指令（#separator / #tags column 等） */
interface DelimitedMeta {
  separator: string;
  tagsColumn: number | null; // 0-based，null 表示未指定
  dataLines: string[];
}

function parseDelimitedMeta(text: string): DelimitedMeta {
  const lines = text.split(/\r?\n/);
  let separator = "\t";
  let tagsColumn: number | null = null;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#")) {
      const m1 = line.match(/^#separator:\s*(tab|semicolon|comma)/i);
      if (m1) {
        const key = m1[1].toLowerCase() as "tab" | "semicolon" | "comma";
        separator = { tab: "\t", semicolon: ";", comma: "," }[key];
        continue;
      }
      const m2 = line.match(/^#tags\s+column:\s*(\d+)/i);
      if (m2) {
        tagsColumn = parseInt(m2[1], 10) - 1;
        continue;
      }
      // 其他 # 指令（#html 等）忽略
      continue;
    }
    if (line.trim() === "") continue;
    dataLines.push(line);
  }

  // 无指令时自动嗅探分隔符（在第一行上比较出现次数）
  if (!text.includes("#separator") && dataLines.length > 0) {
    const first = dataLines[0];
    const counts: Array<[string, number]> = [
      ["\t", (first.match(/\t/g) || []).length],
      [";", (first.match(/;/g) || []).length],
      [",", (first.match(/,/g) || []).length],
    ];
    counts.sort((a, b) => b[1] - a[1]);
    if (counts[0][1] > 0) separator = counts[0][0];
  }

  return { separator, tagsColumn, dataLines };
}

/** 简易 CSV 单行解析（支持双引号包裹与 "" 转义） */
function splitDelimitedLine(line: string, separator: string): string[] {
  if (separator !== "," && separator !== ";") {
    return line.split(separator).map((s) => s.trim());
  }

  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === separator) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** <br> 还原为换行（导入侧） */
function unInline(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "\n").trim();
}

const HEADER_WORDS = new Set([
  "front", "back", "tags", "question", "answer", "scenario", "id",
  "正面", "背面", "标签", "问题", "答案",
]);

function looksLikeHeader(fields: string[]): boolean {
  const lowered = fields.map((f) => f.toLowerCase().trim());
  const hits = lowered.filter((f) => HEADER_WORDS.has(f)).length;
  return hits >= 2;
}

/**
 * 从分隔符文本解析卡片
 * 列布局（无表头时）：front, back, [tags]
 * 有表头时按 front/back/tags 列名定位
 */
export function parseCardsFromDelimited(
  text: string,
  fallbackScenario: RecallScenario = "custom",
): ParsedImport {
  const errors: string[] = [];
  const cards: RecallCard[] = [];
  let skipped = 0;

  const { separator, tagsColumn, dataLines } = parseDelimitedMeta(text);
  if (dataLines.length === 0) {
    return { cards, skipped, errors: ["没有可解析的数据行"] };
  }

  // 表头检测与列映射
  let frontCol = 0;
  let backCol = 1;
  let tagsCol: number | null = tagsColumn;
  let startIdx = 0;

  const firstFields = splitDelimitedLine(dataLines[0], separator);
  if (looksLikeHeader(firstFields)) {
    startIdx = 1;
    const lowered = firstFields.map((f) => f.toLowerCase().trim());
    const fi = lowered.findIndex((f) => f === "front" || f === "question" || f === "正面" || f === "问题");
    const bi = lowered.findIndex((f) => f === "back" || f === "answer" || f === "背面" || f === "答案");
    const ti = lowered.findIndex((f) => f === "tags" || f === "标签");
    if (fi >= 0) frontCol = fi;
    if (bi >= 0) backCol = bi;
    if (ti >= 0) tagsCol = ti;
  } else if (tagsCol === null && firstFields.length >= 3) {
    tagsCol = 2; // 默认第 3 列为标签
  }

  for (let i = startIdx; i < dataLines.length; i++) {
    const fields = splitDelimitedLine(dataLines[i], separator);
    const front = unInline(fields[frontCol] || "");
    const back = unInline(fields[backCol] || "");
    if (!front) {
      skipped++;
      continue;
    }
    const tags = tagsCol !== null ? parseTags(fields[tagsCol]) : [];
    cards.push(buildImportedCard(front, back, tags, fallbackScenario));
  }

  return { cards, skipped, errors };
}

/** 统一入口：自动识别格式 */
export function parseCards(
  text: string,
  fallbackScenario: RecallScenario = "custom",
): ParsedImport {
  if (detectFormat(text) === "json") {
    return parseCardsFromJSON(text, fallbackScenario);
  }
  return parseCardsFromDelimited(text, fallbackScenario);
}
