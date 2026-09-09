/**
 * 最小 Obsidian API mock
 * jest.config.js 通过 moduleNameMapper 将 `obsidian` 映射到本文件。
 * 仅覆盖测试路径上会被 import 的符号，按需扩展。
 */

export class Notice {
  constructor(public message?: string | DocumentFragment, public timeout?: number) {}
}

export class Plugin {
  app: any = {};
  manifest: any = {};
  async loadData(): Promise<any> { return {}; }
  async saveData(_data: any): Promise<void> {}
  addCommand(cmd: any) { return cmd; }
  registerView(_type: string, _factory: any) {}
  registerEvent(_e: any) {}
  addSettingTab(_tab: any) {}
  registerMarkdownPostProcessor(_p: any) {}
}

export class Modal {
  app: any;
  contentEl: any = {};
  constructor(app: any) { this.app = app; }
  open() {}
  close() {}
}

export class ItemView {
  app: any;
  containerEl: any = {};
  constructor(leaf: any) { this.app = leaf?.app; }
}

export class TFile {
  path = "";
  basename = "";
  extension = "md";
  stat = { ctime: 0, mtime: 0, size: 0 };
  parent: any = null;
}

export class TFolder {
  path = "";
  children: any[] = [];
}

export class MarkdownRenderer {
  static render(..._args: any[]): Promise<void> { return Promise.resolve(); }
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export function setIcon(_el: any, _icon: string): void {}

export function requestUrl(_options: any): Promise<any> {
  return Promise.resolve({ status: 200, json: {}, text: "", arrayBuffer: new ArrayBuffer(0) });
}

export function parseYaml(s: string): any {
  return JSON.parse(s || "{}");
}

export const Platform = { isDesktop: true, isMobile: false };

export type App = any;
export type Editor = any;
export type MarkdownView = any;
export type MarkdownFileInfo = any;
export type WorkspaceLeaf = any;
