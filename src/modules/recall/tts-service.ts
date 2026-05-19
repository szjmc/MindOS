/* src/modules/recall/tts-service.ts
 * v0.7 复习强化：TTS 听力模式（Web Speech API）
 */

export interface TTSSettings {
  enabled: boolean;
  lang: string;          // e.g. "en-US"
  rate: number;          // 0.5 - 2
  pitch: number;         // 0 - 2
  volume: number;        // 0 - 1
  preferredVoice?: string; // voice.name
}

export interface TTSVoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export class TTSService {
  private synth: SpeechSynthesis | null;
  private voices: SpeechSynthesisVoice[] = [];
  private voicesReady = false;

  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  }

  isSupported(): boolean {
    return !!this.synth && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /**
   * 某些浏览器 voices 异步加载，需要等待 voiceschanged
   */
  async init(timeoutMs = 1500): Promise<void> {
    if (!this.isSupported()) return;
    if (this.voicesReady) return;

    const load = () => {
      this.voices = (this.synth?.getVoices() ?? []).slice();
      if (this.voices.length > 0) this.voicesReady = true;
    };

    load();
    if (this.voicesReady) return;

    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => resolve(), timeoutMs);

      const handler = () => {
        window.clearTimeout(timer);
        load();
        resolve();
      };

      // voiceschanged 可能触发多次
      this.synth?.addEventListener?.('voiceschanged', handler, { once: true } as any);
      // 兜底：如果 addEventListener 不可用
      // @ts-ignore
      this.synth!.onvoiceschanged = handler;
    });

    load();
  }

  getVoices(): TTSVoiceInfo[] {
    const vs = this.voices ?? [];
    return vs.map(v => ({
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
    }));
  }

  stop(): void {
    try { this.synth?.cancel(); } catch {}
  }

  /**
   * speak: 朗读一段文字（会 cancel 当前播放）
   */
  async speak(text: string, settings: TTSSettings): Promise<void> {
    if (!settings.enabled) return;
    if (!this.isSupported()) throw new Error('当前环境不支持 TTS（Web Speech API）');

    const clean = (text ?? '').trim();
    if (!clean) return;

    await this.init();

    // 停止之前的朗读
    this.stop();

    const u = new SpeechSynthesisUtterance(clean);
    u.lang = settings.lang || 'en-US';
    u.rate = clamp(settings.rate, 0.5, 2);
    u.pitch = clamp(settings.pitch, 0, 2);
    u.volume = clamp(settings.volume, 0, 1);

    // 选 voice（优先 preferredVoice，其次同语言默认）
    const voice =
      (settings.preferredVoice
        ? this.voices.find(v => v.name === settings.preferredVoice)
        : null) ||
      this.voices.find(v => v.lang === u.lang && v.default) ||
      this.voices.find(v => v.lang === u.lang) ||
      null;

    if (voice) u.voice = voice;

    await new Promise<void>((resolve, reject) => {
      u.onend = () => resolve();
      u.onerror = (e) => reject(new Error((e as any)?.error || 'TTS 播放失败'));
      this.synth!.speak(u);
    });
  }
}

function clamp(n: number, min: number, max: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}