/**
 * 导出器 —— 把复习卡片导出为多种格式
 *
 * - Anki 文本（.txt，tab 分隔，Anki 可直接导入）
 * - CSV（通用表格）
 * - Markdown（人类可读归档）
 * - JSON（完整数据，可用于无损回导）
 */
import { RecallCard, RecallScenario } from "../../core/types";

/** Anki 场景名映射（便于阅读） */
const SCENARIO_LABEL: Record<RecallScenario, string> = {
  wiki: "Wiki",
  command: "命令",
  vocab: "单词",
  interview: "面试",
  concept: "概念",
  phrase: "短语",
  custom: "自定义",
};

export function scenarioLabel(s: RecallScenario): string {
  return SCENARIO_LABEL[s] || s;
}

/**
 * 清理文本，使其适合作为单行字段：
 * - 去掉首尾空白
 * - 换行转 <br>（Anki/CSV 内联）
 */
function inlineText(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, "<br>")
    .replace(/\t/g, " ")
    .trim();
}

/** 导出为 Anki 文本格式（tab 分隔）
 *
 * 使用 Anki 2.1.54+ 官方支持的文本导入指令：
 * - #separator:tab     字段以 tab 分隔
 * - #html:true         字段内允许 HTML（换行以 <br> 表示）
 * - #tags column:3     第 3 列为标签（空格分隔）
 *
 * 在 Anki 中：文件 → 导入 → 选择该 .txt 即可。
 */
export function toAnkiText(cards: RecallCard[]): string {
  const lines: string[] = [];
  lines.push("#separator:tab");
  lines.push("#html:true");
  lines.push("#tags column:3");
  for (const c of cards) {
    const front = inlineText(c.front);
    const back = inlineText(c.back);
    const tags = (c.tags || []).join(" ");
    lines.push([front, back, tags].join("\t"));
  }
  return lines.join("\n");
}

/** CSV 字段转义（含引号包裹规则） */
function csvEscape(value: string): string {
  const needsQuote = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/** 导出为 CSV */
export function toCSV(cards: RecallCard[]): string {
  const header = ["scenario", "front", "back", "tags", "id"];
  const rows: string[] = [header.join(",")];
  for (const c of cards) {
    const row = [
      c.scenario,
      inlineText(c.front).replace(/<br>/g, "\n"),
      inlineText(c.back).replace(/<br>/g, "\n"),
      (c.tags || []).join(";"),
      c.id,
    ].map(csvEscape);
    rows.push(row.join(","));
  }
  return rows.join("\n");
}

/** 导出为 Markdown 归档 */
export function toMarkdown(cards: RecallCard[]): string {
  const byScenario = new Map<RecallScenario, RecallCard[]>();
  for (const c of cards) {
    const arr = byScenario.get(c.scenario) || [];
    arr.push(c);
    byScenario.set(c.scenario, arr);
  }

  const out: string[] = [];
  out.push(`# MindOS 复习卡片导出`);
  out.push("");
  out.push(`> 共 ${cards.length} 张卡片`);
  out.push(`> 导出时间：${new Date().toISOString()}`);
  out.push("");

  for (const [scenario, arr] of byScenario) {
    out.push(`## ${scenarioLabel(scenario)}（${arr.length}）`);
    out.push("");
    for (const c of arr) {
      out.push(`### Q`);
      out.push("");
      out.push(c.front || "（空）");
      out.push("");
      out.push(`**A**：`);
      out.push("");
      out.push(c.back || "（空）");
      if (c.tags && c.tags.length) {
        out.push("");
        out.push(`标签：${c.tags.map((t) => `#${t}`).join(" ")}`);
      }
      out.push("");
      out.push("---");
      out.push("");
    }
  }
  return out.join("\n");
}

/** 导出为 JSON（含完整结构，可无损回导） */
export function toJSON(cards: RecallCard[]): string {
  return JSON.stringify(
    {
      type: "mindos-recall-cards",
      version: 1,
      exportedAt: new Date().toISOString(),
      count: cards.length,
      cards,
    },
    null,
    2,
  );
}
