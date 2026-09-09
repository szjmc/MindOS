import { ItemView, WorkspaceLeaf, Notice, setIcon, TFile } from "obsidian";
import type MindOSPlugin from "../../../main";
import { VIEW_TYPE_WIKI_EVOLUTION } from "../../core/constants";
import { WikiEvolutionRenderer } from "./wiki-evolution-renderer";

export type EvolutionTab = "versions" | "health";

export class WikiEvolutionView extends ItemView {
  private currentTab: EvolutionTab = "versions";
  private renderer: WikiEvolutionRenderer;

  constructor(leaf: WorkspaceLeaf, private plugin: MindOSPlugin) {
    super(leaf);
    this.renderer = new WikiEvolutionRenderer(plugin);
  }

  getViewType(): string { return VIEW_TYPE_WIKI_EVOLUTION; }
  getDisplayText(): string { return "知识演化"; }
  getIcon(): string { return "git-branch"; }

  async onOpen() {
    await this.render();
  }

  async onClose() {
    // cleanup if needed
  }

  // ════════════════════════════════════════════════════════════
  // 主渲染 - 委托给 WikiEvolutionRenderer
  // ════════════════════════════════════════════════════════════
  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-root");
    contentEl.style.height = "100%";
    contentEl.style.overflow = "hidden";
    contentEl.style.padding = "0";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";

    // 同步 tab 状态到 renderer
    this.renderer.setTab(this.currentTab);
    this.renderer.setTabChangeCallback((tab) => {
      this.currentTab = tab;
    });
    this.renderer.setContainer(contentEl);
    await this.renderer.render();
  }
}
