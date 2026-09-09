/**
 * Token 估算器
 * 不调 API，本地估算，用于成本预估
 */

export class TokenEstimator {
  /**
   * 估算文本的 token 数
   * 经验公式：
   * - 中文：1 字 ≈ 1.5 tokens
   * - 英文：1 词 ≈ 1.3 tokens
   * - 混合：取平均
   */
  static estimate(text: string): number {
    if (!text) return 0;

    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (text.match(/[0-9]+/g) || []).length;
    const punctuation = (text.match(/[^\u4e00-\u9fffa-zA-Z0-9\s]/g) || []).length;

    // 加权估算
    const tokens =
      chineseChars * 1.5 +
      englishWords * 1.3 +
      numbers * 1.0 +
      punctuation * 0.5;

    return Math.ceil(tokens);
  }

  /**
   * 估算多个文本的总 token
   */
  static estimateBatch(texts: string[]): number {
    return texts.reduce((sum, t) => sum + this.estimate(t), 0);
  }

  /**
   * 计算成本（人民币）
   * @param tokens token 数量
   * @param costPerMillionCny 每百万 token 的人民币成本
   */
  static estimateCost(tokens: number, costPerMillionCny: number): number {
    return (tokens / 1_000_000) * costPerMillionCny;
  }

  /**
   * 格式化显示
   */
  static formatTokens(tokens: number): string {
    if (tokens < 1000) return `${tokens}`;
    if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }

  static formatCost(cny: number): string {
    if (cny < 0.001) return `< ¥0.001`;
    if (cny < 1) return `¥${cny.toFixed(4)}`;
    return `¥${cny.toFixed(2)}`;
  }
}