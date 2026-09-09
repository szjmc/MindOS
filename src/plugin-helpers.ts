/**
 * 插件工具函数 —— 从 main.ts 提取
 * 文件操作、Schema/Index 打开、加载/保存设置
 */
import { TFile, normalizePath } from "obsidian";
import {
  FILE_INDEX,
  FILE_CLAUDE,
} from "./core/constants";
import type { MindOSSettings, UICollapsedState, RetrieveTab } from "./core/types";
import { safeFileName } from "./core/utils";
export { safeFileName };

// ── 设置加载 ──

export function loadSettings(
  loadDataFn: () => Promise<any>,
  defaults: MindOSSettings,
  defaultUI: UICollapsedState,
): { loaded: MindOSSettings; loader: () => Promise<MindOSSettings> } {
  const loader = async (): Promise<MindOSSettings> => {
    const loaded = await loadDataFn();
    const settings: MindOSSettings = Object.assign({}, defaults, loaded ?? {});
    if (!settings.uiCollapsed || typeof settings.uiCollapsed !== "object") {
      settings.uiCollapsed = { ...defaultUI };
    } else {
      settings.uiCollapsed = { ...defaultUI, ...settings.uiCollapsed };
    }
    if (typeof settings.candidateTopN !== "number") settings.candidateTopN = 5;
    if (typeof settings.searchTopK !== "number") settings.searchTopK = 10;
    if (typeof settings.ragTopK !== "number") settings.ragTopK = 5;
    if (typeof settings.dailyTokenLimit !== "number") settings.dailyTokenLimit = 1000000;
    if (typeof settings.recallSRSAlgorithm !== "string") settings.recallSRSAlgorithm = "sm2";
    if (typeof settings.recallNewCardsPerDay !== "number") settings.recallNewCardsPerDay = 20;
    if (typeof settings.recallReviewLimit !== "number") settings.recallReviewLimit = 100;
    return settings;
  };
  return { loaded: defaults, loader };
}

// ── UI 状态持久化 ──

export async function setUICollapsed(
  settings: MindOSSettings,
  saveFn: () => Promise<void>,
  key: keyof UICollapsedState,
  value: boolean,
): Promise<void> {
  settings.uiCollapsed[key] = value;
  await saveFn();
}

export async function saveCurrentTab(
  settings: MindOSSettings,
  saveFn: () => Promise<void>,
  tab: RetrieveTab,
): Promise<void> {
  settings.currentTab = tab;
  await saveFn();
}

// ── 文件操作 ──

export async function ensureFolder(
  app: any,
  p: string,
): Promise<void> {
  const path = normalizePath(p);
  // adapter.exists 直查文件系统，不依赖 Obsidian 索引，避免竞态
  if (await app.vault.adapter.exists(path)) return;
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!(await app.vault.adapter.exists(cur))) {
      try {
        await app.vault.createFolder(cur);
      } catch (e: any) {
        // 并发竞态：文件夹在 check 和 create 之间被其他进程（如 git）创建
        if (!e?.message?.includes?.("already exists")) throw e;
      }
    }
  }
}

export async function openFile(
  app: any,
  path: string,
): Promise<void> {
  if (!path) return;
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return;
  try {
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(f);
  } catch {}
}

export async function openSchemaFile(
  app: any,
  baseFolder: string,
): Promise<void> {
  const path = `${baseFolder}/${FILE_CLAUDE}`;
  await openFile(app, normalizePath(path));
}

export async function openIndexFile(
  app: any,
  baseFolder: string,
): Promise<void> {
  const path = `${baseFolder}/${FILE_INDEX}`;
  await openFile(app, normalizePath(path));
}
