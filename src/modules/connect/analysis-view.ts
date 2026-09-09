import { ItemView, WorkspaceLeaf, Notice, setIcon, Component } from "obsidian";
import type MindOSPlugin from "../../../main";
import { VIEW_TYPE_ANALYSIS, PLUGIN_NAME } from "../../core/constants";
import type { AnalysisTab } from "../../core/types";
import { WikiEvolutionRenderer } from "../wiki/wiki-evolution-renderer";
import { BacklinkRenderer } from "./backlink/backlink-renderer";
import { ContextAwarenessRenderer } from "../retrieve/context-awareness-renderer";
import { KnowledgeGapsRenderer } from "../wiki/knowledge-gaps-renderer";

export class AnalysisView extends ItemView {
  private currentTab: AnalysisTab = "context";
  private mdComponent: Component;
  private wikiEvolutionRenderer: WikiEvolutionRenderer;
  private backlinkRenderer: BacklinkRenderer;
  private contextAwarenessRenderer: ContextAwarenessRenderer;
  private knowledgeGapsRenderer: KnowledgeGapsRenderer;
  private fileChangeListener: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: MindOSPlugin) {
    super(leaf);
    this.mdComponent = new Component();
    this.wikiEvolutionRenderer = new WikiEvolutionRenderer(plugin);
    this.backlinkRenderer = new BacklinkRenderer(plugin);
    this.contextAwarenessRenderer = new ContextAwarenessRenderer(plugin);
    this.knowledgeGapsRenderer = new KnowledgeGapsRenderer(plugin);
  }

  getViewType(): string { return VIEW_TYPE_ANALYSIS; }
  getDisplayText(): string { return PLUGIN_NAME; }
  getIcon(): string { return "brain-circuit"; }

  async onOpen() {
    this.render();
    await this.backlinkRenderer.initialize();
    this.setupFileChangeListener();
  }

  async onClose() {
    this.mdComponent.unload();
    this.cleanupFileChangeListener();
    this.backlinkRenderer.destroy();
    this.contextAwarenessRenderer.destroy();
  }

  private setupFileChangeListener() {
    if (this.fileChangeListener) return;
    this.fileChangeListener = () => {
      if (this.plugin.isOpeningFile) return;
    };
    this.plugin.app.workspace.on('active-leaf-change', this.fileChangeListener);
  }

  private cleanupFileChangeListener() {
    if (this.fileChangeListener) {
      this.plugin.app.workspace.off('active-leaf-change', this.fileChangeListener);
      this.fileChangeListener = null;
    }
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-root");
    contentEl.style.height = "100%";
    contentEl.style.overflow = "hidden";
    contentEl.style.padding = "0";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";

    const wrap = contentEl.createDiv({ cls: "mindos-analysis-view" });
    
    this.renderTopBar(wrap);
    this.renderTabBar(wrap);
    
    const contentArea = wrap.createDiv({ cls: "mindos-content-area" });
    await this.renderContent(contentArea);
  }

  private renderTopBar(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: "mindos-topbar" });
    
    const left = bar.createDiv({ cls: "mindos-topbar-left" });
    const titleWrap = left.createDiv({ cls: "mindos-brand" });
    const iconEl = titleWrap.createSpan({ cls: "mindos-brand-icon" });
    setIcon(iconEl, "brain-circuit");
    titleWrap.createSpan({ cls: "mindos-brand-text", text: PLUGIN_NAME });
    titleWrap.createSpan({ cls: "mindos-version-tag", text: `v${this.plugin.manifest.version}` });

    const right = bar.createDiv({ cls: "mindos-topbar-right" });
    const settingsBtn = right.createEl("button", { cls: "mindos-settings-btn" });
    const settingsIcon = settingsBtn.createSpan({ cls: "mindos-settings-icon" });
    setIcon(settingsIcon, "settings");
    settingsBtn.addEventListener("click", () => {
      // @ts-ignore
      this.plugin.app.setting.open();
      // @ts-ignore
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
    });
  }

  private renderTabBar(parent: HTMLElement) {
    const tabs = parent.createDiv({ cls: "mindos-tab-bar" });
    const tabConfig: Record<AnalysisTab, { label: string; icon: string }> = {
      context: { label: "情境感知", icon: "link" },
      gaps: { label: "知识空白", icon: "radar" },
      evolution: { label: "知识演化", icon: "git-branch" },
      backlink: { label: "反向链接", icon: "link-2" },
    };

    for (const [key, info] of Object.entries(tabConfig)) {
      const btn = tabs.createDiv({ cls: `mindos-tab-btn ${this.currentTab === key ? "is-active" : ""}` });
      const iconEl = btn.createSpan({ cls: "mindos-tab-btn-icon" });
      setIcon(iconEl, info.icon);
      btn.createSpan({ cls: "mindos-tab-btn-label", text: info.label });
      btn.addEventListener("click", () => {
        this.currentTab = key as AnalysisTab;
        this.render();
      });
    }
  }

  private async renderContent(parent: HTMLElement) {
    parent.empty();
    parent.style.height = "100%";
    parent.style.overflowY = "auto";

    switch (this.currentTab) {
      case "context":
        this.renderContextTab(parent);
        break;
      case "gaps":
        this.renderGapsTab(parent);
        break;
      case "evolution":
        await this.renderEvolutionTab(parent);
        break;
      case "backlink":
        this.renderBacklinkTab(parent);
        break;
    }
  }

  private renderContextTab(parent: HTMLElement) {
    this.contextAwarenessRenderer.setContainer(parent);
    this.contextAwarenessRenderer.render();
  }

  private async renderGapsTab(parent: HTMLElement) {
    this.knowledgeGapsRenderer.setContainer(parent);
    await this.knowledgeGapsRenderer.render();
  }

  private async renderEvolutionTab(parent: HTMLElement) {
    this.wikiEvolutionRenderer.setContainer(parent);
    await this.wikiEvolutionRenderer.render();
  }

  private renderBacklinkTab(parent: HTMLElement) {
    this.backlinkRenderer.setContainer(parent);
    this.backlinkRenderer.render();
  }
}
