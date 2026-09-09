import { App } from 'obsidian';
import { MindOSSettings, BacklinkResult, ImplicitBacklink } from '../../../core/types';
import { DIR_CONNECT_DATA, FILE_BACKLINK_IGNORES } from '../constants';

interface IgnoredBacklinkEntry {
  sourcePath: string;
  targetPath: string;
  ignoredAt: string;
}

interface BacklinkStoreData {
  ignoredBacklinks: IgnoredBacklinkEntry[];
  cachedBacklinks: Record<string, BacklinkResult>;
}

export class BacklinkStore {
  private app: App;
  private getSettings: () => MindOSSettings;
  private data: BacklinkStoreData;
  private isLoaded: boolean;

  constructor(app: App, getSettings: () => MindOSSettings) {
    this.app = app;
    this.getSettings = getSettings;
    this.data = { ignoredBacklinks: [], cachedBacklinks: {} };
    this.isLoaded = false;
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;

    const settings = this.getSettings();
    const ignoresPath = `${settings.baseFolder}/${DIR_CONNECT_DATA}/${FILE_BACKLINK_IGNORES}`;
    
    try {
      const exists = await this.app.vault.adapter.exists(ignoresPath);
      if (exists) {
        const content = await this.app.vault.adapter.read(ignoresPath);
        this.data = JSON.parse(content);
      }
    } catch (e) {
      console.error('[MindOS] Failed to load backlink store:', e);
    }

    this.isLoaded = true;
  }

  async save(): Promise<void> {
    const settings = this.getSettings();
    const baseDir = `${settings.baseFolder}/${DIR_CONNECT_DATA}`;
    await this.ensureDir(baseDir);
    const ignoresPath = `${baseDir}/${FILE_BACKLINK_IGNORES}`;
    await this.app.vault.adapter.write(ignoresPath, JSON.stringify(this.data, null, 2));
  }

  async ignoreBacklink(sourcePath: string, targetPath: string): Promise<void> {
    const entry: IgnoredBacklinkEntry = {
      sourcePath,
      targetPath,
      ignoredAt: new Date().toISOString(),
    };
    const existing = this.data.ignoredBacklinks.find(
      i => i.sourcePath === sourcePath && i.targetPath === targetPath
    );
    if (!existing) {
      this.data.ignoredBacklinks.push(entry);
      await this.save();
    }
  }

  isIgnored(sourcePath: string, targetPath: string): boolean {
    return this.data.ignoredBacklinks.some(
      i => i.sourcePath === sourcePath && i.targetPath === targetPath
    );
  }

  async setCache(path: string, result: BacklinkResult): Promise<void> {
    this.data.cachedBacklinks[path] = result;
    await this.save();
  }

  getCache(path: string): BacklinkResult | null {
    return this.data.cachedBacklinks[path] || null;
  }

  filterIgnoredBacklinks(backlinks: ImplicitBacklink[]): ImplicitBacklink[] {
    return backlinks.filter(b => !this.isIgnored(b.sourcePath, b.targetPath));
  }

  private async ensureDir(dirPath: string): Promise<void> {
    const parts = dirPath.split('/');
    let current = '';
    for (const part of parts) {
      current += (current ? '/' : '') + part;
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
