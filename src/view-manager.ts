/**
 * View 激活与管理 —— 从 main.ts 提取
 * 负责 ribbon 回调、视图激活、情境感知面板、智能分析菜单
 */
import { App, Notice, setIcon, Menu, Workspace, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_MINDOS, VIEW_TYPE_WIKI_EVOLUTION, VIEW_TYPE_CONNECT_BACKLINK } from "./core/constants";
import { EXPRESS_VIEW_TYPE } from "./modules/express";
import { RetrieveStore } from "./core/store";
import type { ContextAwarenessView } from "./modules/retrieve/context-awareness-view";
import type { ContextAwarenessService } from "./modules/retrieve/context-awareness";
import type { KnowledgeGapAnalyzer } from "./modules/wiki";

export interface ViewManagerDeps {
  app: App;
  workspace: Workspace;
  retrieveStore: RetrieveStore;
  contextAwarenessService: ContextAwarenessService;
  knowledgeGapAnalyzer: KnowledgeGapAnalyzer;
}

export class ViewManager {
  private deps: ViewManagerDeps;
  contextAwarenessView: ContextAwarenessView | null = null;

  constructor(deps: ViewManagerDeps) {
    this.deps = deps;
  }

  // ── 激活视图 ──

  async activateTaskCenter(): Promise<void> {
    const { app, workspace } = this.deps;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_MINDOS)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建任务中心"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_MINDOS, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateExpressView(): Promise<void> {
    const { app, workspace } = this.deps;
    let leaf = workspace.getLeavesOfType(EXPRESS_VIEW_TYPE)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建 Express 视图"); return; }
      leaf = right;
      await leaf.setViewState({ type: EXPRESS_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  // ── 情境感知面板 ──

  async showContextAwarenessPanel(): Promise<void> {
    const { app, workspace, contextAwarenessService } = this.deps;
    const allLeaves = workspace.getLeavesOfType(VIEW_TYPE_MINDOS);

    for (const leaf of allLeaves) {
      if ((leaf as any).containerEl?.querySelector(".mindos-context-panel")) {
        await workspace.revealLeaf(leaf);
        if (this.contextAwarenessView) {
          await this.contextAwarenessView.refresh();
        }
        return;
      }
    }

    const leaf = workspace.getLeaf(true);

    if (this.contextAwarenessView) {
      this.contextAwarenessView.destroy();
    }

    (leaf as any).containerEl.empty();

    const container = (leaf as any).containerEl.createDiv({ cls: "mindos-context-panel" });

    const header = container.createDiv({ cls: "mindos-context-panel-header" });
    const titleDiv = header.createDiv();
    titleDiv.createDiv({ cls: "mindos-context-panel-title", text: "🔗 情境感知" });
    titleDiv.createDiv({ cls: "mindos-context-panel-desc", text: "基于当前页面推荐相关内容" });

    const closeBtn = header.createEl("button", { cls: "mindos-context-panel-close" });
    setIcon(closeBtn, "x");
    closeBtn.title = "关闭";
    closeBtn.onclick = () => {
      if (this.contextAwarenessView) {
        this.contextAwarenessView.destroy();
        this.contextAwarenessView = null;
      }
      leaf.detach();
    };

    const refreshBtn = header.createEl("button", { cls: "mindos-context-panel-refresh" });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.title = "刷新推荐";
    refreshBtn.onclick = async () => {
      if (this.contextAwarenessView) {
        await this.contextAwarenessView.refresh();
      }
    };

    const { ContextAwarenessView: CV } = await import("./modules/retrieve/context-awareness-view");

    const viewContainer = container.createDiv({ cls: "mindos-context-panel-content" });
    this.contextAwarenessView = new CV(app, contextAwarenessService, viewContainer);

    await workspace.revealLeaf(leaf);
  }

  showContextAwareness(): void {
    this.showContextAwarenessPanel();
  }

  showKnowledgeGaps(): void {
    const { app, knowledgeGapAnalyzer } = this.deps;
    // Lazy import to avoid circular dependency
    import("./ui/knowledge-gaps-modal").then(({ KnowledgeGapsModal }) => {
      new KnowledgeGapsModal(app, knowledgeGapAnalyzer).open();
    });
  }

  // ── 智能分析菜单（整合知识演化和反向链接）──

  showSmartAnalysisMenu(): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setIcon("link")
        .setTitle("🔗 情境感知推荐")
        .onClick(async () => {
          await this.showContextAwarenessPanel();
        });
    });

    menu.addItem((item) => {
      item
        .setIcon("radar")
        .setTitle("📡 知识空白雷达")
        .onClick(() => {
          this.showKnowledgeGaps();
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setIcon("git-branch")
        .setTitle("🌱 知识演化 · 版本历史 / 健康度报告")
        .onClick(async () => {
          await this.activateWikiEvolutionView();
        });
    });

    menu.addItem((item) => {
      item
        .setIcon("link-2")
        .setTitle("🔗 反向链接增强 · 显式链接 + 隐式关联")
        .onClick(async () => {
          await this.activateBacklinkView();
        });
    });

    const ribbonButtons = document.querySelectorAll(".workspace-ribbon.mod-left a");
    let x = window.innerWidth - 50;
    let y = 100;

    if (ribbonButtons.length > 0) {
      const lastButton = ribbonButtons[ribbonButtons.length - 1];
      const buttonRect = lastButton.getBoundingClientRect();
      x = buttonRect.right + 10;
      y = buttonRect.top;
    }

    menu.showAtPosition({ x, y });
  }

  async activateWikiEvolutionView(): Promise<void> {
    const { workspace } = this.deps;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_WIKI_EVOLUTION)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建知识演化视图"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_WIKI_EVOLUTION, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateBacklinkView(): Promise<void> {
    const { workspace } = this.deps;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CONNECT_BACKLINK)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建反向链接视图"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_CONNECT_BACKLINK, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}
