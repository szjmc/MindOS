import { ProtocolValue } from "./types";

export function normalizeText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getFirstParam(value: ProtocolValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function decodeParam(value: ProtocolValue): string {
  const raw = getFirstParam(value);
  if (!raw) return "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, "%20"));
  } catch {
    return raw;
  }
}

export function simpleHash(text: string): string {
  let hash = 0;
  const input = normalizeText(text);
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return String(hash >>> 0);
}

export function nowISOString(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

export function nowDateString(): string {
  return new Date().toISOString().substring(0, 10);
}

export function generateUID(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").substring(0, 14);
}

export function generateActionId(): string {
  return `act_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim() || "未命名";
}

export function truncateBrief(text: string, maxLen: number): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen - 1) + "…";
}

/** 简单 frontmatter 解析 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: content };

  const yaml = m[1];
  const body = m[2] ?? "";
  const fm: Record<string, any> = {};

  yaml.split("\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return;
    const key = line.substring(0, idx).trim();
    let val = line.substring(idx + 1).trim();
    if (!key) return;
    // 去引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // 数组
    if (val.startsWith("[") && val.endsWith("]")) {
      try {
        fm[key] = JSON.parse(val.replace(/'/g, '"'));
        return;
      } catch {
        fm[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
        return;
      }
    }
    fm[key] = val;
  });

  return { frontmatter: fm, body };
}

export function buildFrontmatter(fm: Record<string, any>): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(", ")}]`);
    } else {
      lines.push(`${k}: ${JSON.stringify(String(v))}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function pinyinSafeSort(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hans-CN", { sensitivity: "base" });
}