import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type MindOSPlugin from "../../../main";
import { VIEW_TYPE_WIKI_EVOLUTION, PLUGIN_NAME } from "../../core/constants";
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
    this.renderer.destroy();
  }

  private renderTopBar(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: "mindos-topbar" });
    const left = bar.createDiv({ cls: "mindos-topbar-left" });
    const titleWrap = left.createDiv({ cls: "mindos-brand" });
    const iconEl = titleWrap.createSpan({ cls: "mindos-brand-icon" });
    setIcon(iconEl, "git-branch");
    titleWrap.createSpan({ cls: "mindos-brand-text", text: PLUGIN_NAME });
    titleWrap.createSpan({ cls: "mindos-version-tag", text: `v${this.plugin.manifest.version}` });

    const right = bar.createDiv({ cls: "mindos-topbar-right" });
    const settingsBtn = right.createEl("button", { cls: "mindos-icon-btn", attr: { "aria-label": "设置", title: "设置" } });
    setIcon(settingsBtn, "settings");
    settingsBtn.addEventListener("click", () => {
      // @ts-ignore
      this.plugin.app.setting.open();
      // @ts-ignore
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
    });
  }

  // ════════════════════════════════════════════════════════════
  // 主渲染 - 委托给 WikiEvolutionRenderer
  // ════════════════════════════════════════════════════════════
  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-root");

    this.renderTopBar(contentEl);

    const body = contentEl.createDiv({ cls: "mindos-content-area is-flush" });

    this.renderer.setTab(this.currentTab);
    this.renderer.setTabChangeCallback((tab) => {
      this.currentTab = tab;
    });
    this.renderer.setContainer(body);
    await this.renderer.render();
  }
}
