import { App, TFile, Notice } from "obsidian";
import { MindOSSettings, PageVersion } from "../../core/types";
import { generateChangeSummary } from "./version-differ";

const DIR_VERSIONS = "原始素材/版本历史";

export class VersionManager {
  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
  ) {}

  /** Simple content hash for change detection */
  getContentHash(content: string): string {
    // lightweight hash: combine length + first/last 100 chars
    const head = content.slice(0, 100);
    const tail = content.slice(-100);
    const combined = `${content.length}|${head}|${tail}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const ch = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0; // convert to 32-bit int
    }
    return hash.toString(36);
  }

  wordCount(content: string): number {
    const text = content.replace(/#+\s|\*|`|\[|\]|\(|\)|-{3,}|>/g, " ");
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length;
  }

  /** Record a new version when content changes */
  async recordVersion(filePath: string, content: string): Promise<PageVersion | null> {
    const settings = this.getSettings();
    if (!settings.versionHistoryEnabled) return null;

    const hash = this.getContentHash(content);
    const existing = await this.getVersions(filePath);

    // Skip if content hasn't changed
    if (existing.length > 0 && existing[0].hash === hash) {
      return null;
    }

    const id = Date.now().toString(36);
    const version: PageVersion = {
      id,
      pagePath: filePath,
      content,
      wordCount: this.wordCount(content),
      timestamp: new Date().toISOString(),
      hash,
    };

    // Store as JSON
    const safeName = filePath.replace(/[/\\:]/g, "_").replace(/\.md$/, "");
    const versionDir = `${settings.baseFolder}/${DIR_VERSIONS}/${safeName}`;
    const versionFile = `${versionDir}/${id}.json`;

    await this.ensureDir(versionDir);
    await this.app.vault.adapter.write(
      versionFile,
      JSON.stringify(version, null, 2),
    );

    // Prune old versions
    await this.pruneVersions(filePath);

    return version;
  }

  /** List all versions for a page, newest first */
  async getVersions(filePath: string): Promise<PageVersion[]> {
    const settings = this.getSettings();
    const safeName = filePath.replace(/[/\\:]/g, "_").replace(/\.md$/, "");
    const versionDir = `${settings.baseFolder}/${DIR_VERSIONS}/${safeName}`;

    const exists = await this.app.vault.adapter.exists(versionDir);
    if (!exists) return [];

    try {
      const files = await this.app.vault.adapter.list(versionDir);
      const versions: PageVersion[] = [];

      for (const f of files.files) {
        if (!f.endsWith(".json")) continue;
        const data = await this.app.vault.adapter.read(f);
        const v: PageVersion = JSON.parse(data);
        versions.push(v);
      }

      return versions.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    } catch {
      return [];
    }
  }

  /** Get change summary between a version and the previous one */
  async getChangeSummary(version: PageVersion, filePath: string): Promise<string> {
    const versions = await this.getVersions(filePath);
    const idx = versions.findIndex((v) => v.id === version.id);
    if (idx < 0 || idx >= versions.length - 1) return "首次记录";

    const prev = versions[idx + 1]; // next older
    return generateChangeSummary(prev.content, version.content);
  }

  /** Delete all versions for a page */
  async deleteVersions(filePath: string): Promise<void> {
    const settings = this.getSettings();
    const safeName = filePath.replace(/[/\\:]/g, "_").replace(/\.md$/, "");
    const versionDir = `${settings.baseFolder}/${DIR_VERSIONS}/${safeName}`;

    const exists = await this.app.vault.adapter.exists(versionDir);
    if (!exists) return;

    try {
      const entries = await this.app.vault.adapter.list(versionDir);
      for (const f of entries.files) {
        await this.app.vault.adapter.remove(f);
      }
      await this.app.vault.adapter.rmdir(versionDir, true);
    } catch (e) {
      console.error("VersionManager: failed to delete versions", e);
    }
  }

  /** Remove oldest versions exceeding max count */
  private async pruneVersions(filePath: string): Promise<void> {
    const settings = this.getSettings();
    const versions = await this.getVersions(filePath);

    const maxCount = settings.versionMaxCount ?? 50;
    if (versions.length <= maxCount) return;

    const safeName = filePath.replace(/[/\\:]/g, "_").replace(/\.md$/, "");
    const versionDir = `${settings.baseFolder}/${DIR_VERSIONS}/${safeName}`;

    // Keep newest N, delete the rest
    const toDelete = versions.slice(maxCount);
    for (const v of toDelete) {
      const file = `${versionDir}/${v.id}.json`;
      try {
        await this.app.vault.adapter.remove(file);
      } catch { /* ignore */ }
    }
  }

  private async ensureDir(dir: string): Promise<void> {
    const parts = dir.split("/");
    let current = "";
    for (const part of parts) {
      current += (current ? "/" : "") + part;
      const exists = await this.app.vault.adapter.exists(current);
      if (!exists) {
        try {
          await this.app.vault.adapter.mkdir(current);
        } catch (e: any) {
          if (!e?.message?.includes?.('already exists')) throw e;
        }
      }
    }
  }
}
