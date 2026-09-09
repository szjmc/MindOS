import { App, TFile } from "obsidian";
import { ProtocolValue } from "./types";
import { SYSTEM_FILE_BASENAMES, EXCLUDED_DIRS } from "./constants";

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
  // 使用时间戳 base36 + 随机数，避免同一秒内批量生成时的碰撞
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
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

/**
 * 安全的文件创建/更新函数。
 *
 * 解决 Obsidian 插件加载时 Vault 索引未就绪导致的竞态问题：
 * `getAbstractFileByPath` 可能在文件实际存在时仍返回 null，
 * 导致后续 `vault.create` 抛出 "File already exists" 错误。
 *
 * 此函数使用 `adapter.exists` 直查文件系统（不依赖 Vault 索引），
 * 若文件已存在则 modify，否则 create，并对竞态情况做防御性 catch。
 */
export async function vaultSave(app: App, filePath: string, content: string): Promise<TFile> {
  // 用 adapter.exists 直查文件系统，绕过 Vault 索引竞态
  const exists = await app.vault.adapter.exists(filePath);
  if (exists) {
    // 文件已存在 → modify
    const f = app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) {
      await app.vault.modify(f, content);
      return f;
    }
    // 索引还没跟上，直接 adapter.write 更新内容
    await app.vault.adapter.write(filePath, content);
    // 等 Obsidian 索引刷新后再拿引用（给个短暂等待）
    await sleep(50);
    const f2 = app.vault.getAbstractFileByPath(filePath);
    if (f2 instanceof TFile) return f2;
    // 实在拿不到就再强制刷新一次
    await (app.vault as any).onChange?.("modify", filePath);
    return app.vault.getAbstractFileByPath(filePath) as TFile;
  }
  // 文件不存在 → create，对并发竞态做防御
  try {
    return await app.vault.create(filePath, content);
  } catch (e: any) {
    if (e?.message?.includes?.("already exists")) {
      // 另一个并发调用抢先创建了，改为 modify
      await sleep(30);
      const f = app.vault.getAbstractFileByPath(filePath);
      if (f instanceof TFile) {
        await app.vault.modify(f, content);
        return f;
      }
      // 仍然拿不到引用，写底层
      await app.vault.adapter.write(filePath, content);
      return app.vault.getAbstractFileByPath(filePath) as TFile;
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════
// 系统文件过滤（集中式，替代各模块分散的过滤逻辑）
// ═══════════════════════════════════════════════════════════

/**
 * 判断文件是否为系统/元数据文件（不应出现在推荐/链接/扫描结果中）。
 *
 * 判定规则：
 * 1. basename 以 `_` 开头
 * 2. basename 以 `index` 开头（兼容 INDEX.md / INDEX-xxx.md）
 * 3. basename 精确匹配已知系统文件名（CLAUDE, AGENTS, conventions, README 等）
 * 4. 文件路径位于排除目录下（规则/, _系统数据/, 原始素材/ 等）
 */
export function isSystemFile(file: TFile): boolean {
  const basename = file.basename.toLowerCase();

  // 1. _ 开头的系统文件
  if (basename.startsWith('_')) return true;

  // 2. index 前缀（兼容现有逻辑：INDEX, INDEX-old 等）
  if (basename.startsWith('index')) return true;

  // 3. 已知系统文件名（精确匹配）
  if (SYSTEM_FILE_BASENAMES.has(basename)) return true;

  // 4. 排除目录下的文件
  const path = file.path;
  for (const dir of EXCLUDED_DIRS) {
    if (path.includes(`/${dir}/`) || path.startsWith(`${dir}/`)) return true;
  }

  return false;
}

/**
 * 判断文件是否为 Wiki 内容文件（可参与推荐/链接/扫描）。
 *
 * 条件：
 * 1. 位于 知识库/wiki/baseFolder 路径下
 * 2. 不是系统文件
 *
 * 用法（替代各模块中分散的 getMarkdownFiles().filter(...) 逻辑）：
 * ```ts
 * const files = app.vault.getMarkdownFiles().filter(f => isWikiContentFile(f, baseFolder));
 * ```
 */
export function isWikiContentFile(file: TFile, baseFolder: string): boolean {
  if (!(file.path.includes('知识库') || file.path.includes('wiki') || file.path.startsWith(baseFolder))) return false;
  return !isSystemFile(file);
}