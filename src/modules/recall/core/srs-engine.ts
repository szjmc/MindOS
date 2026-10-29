/**
 * SRS Engine - 间隔重复算法实现
 *
 * 支持两种算法：
 * - SM-2：经典算法，简单可靠
 * - FSRS-4.5：现代算法，更精准（基于记忆模型）
 *
 * 用户可在设置中切换。
 */

import {
  SRSData,
  SRSAlgorithm,
  RecallRating,
} from "../../../core/types";
import {
  SM2_DEFAULT_EASE_FACTOR,
  SM2_MIN_EASE_FACTOR,
  SM2_EASY_BONUS,
  FSRS_DEFAULT_PARAMS,
} from "../../../core/constants";

export interface SRSResult {
  newSRS: SRSData;
  nextReviewDate: Date;
  intervalDays: number;
  message: string;        // 给用户的反馈提示
}

export class SRSEngine {
  constructor(private algorithm: SRSAlgorithm = "sm2") {}

  setAlgorithm(alg: SRSAlgorithm) {
    this.algorithm = alg;
  }

  /**
   * 处理一次复习评分，返回新的 SRS 数据
   */
  review(card: SRSData, rating: RecallRating): SRSResult {
    if (this.algorithm === "fsrs") {
      return this.reviewFSRS(card, rating);
    }
    return this.reviewSM2(card, rating);
  }

  /**
   * 创建新卡片的初始 SRS 数据
   */
  createInitialSRS(algorithm: SRSAlgorithm = this.algorithm): SRSData {
    return {
      algorithm,
      interval: 0,
      repetitions: 0,
      easeFactor: SM2_DEFAULT_EASE_FACTOR,
      stability: 1,
      difficulty: 0.3,
      nextReview: new Date().toISOString().substring(0, 10),
      lastReview: "",
      lastRating: 0,
    };
  }

  /**
   * 判断卡片是否今天需要复习
   */
  isDueToday(srs: SRSData): boolean {
    if (!srs.nextReview) return true;
    const today = new Date().toISOString().substring(0, 10);
    return srs.nextReview <= today;
  }

  /**
   * 获取距离下次复习的天数
   */
  daysUntilReview(srs: SRSData): number {
    if (!srs.nextReview) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next = new Date(srs.nextReview);
    next.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((next.getTime() - today.getTime()) / 86400000));
  }

  // ════════════════════════════════════════════════════════════
  // SM-2 算法
  // ════════════════════════════════════════════════════════════
  private reviewSM2(card: SRSData, rating: RecallRating): SRSResult {
    let { interval, repetitions, easeFactor } = card;
    const now = new Date();

    // rating 1/2 = 错误，3 = 正确，4 = 简单
    const isCorrect = rating >= 3;

    if (!isCorrect) {
      // 答错：重置
      repetitions = 0;
      interval = 1;
    } else {
      // 答对：计算新间隔
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }

      // Easy bonus
      if (rating === 4) {
        interval = Math.round(interval * SM2_EASY_BONUS);
      }

      repetitions++;
    }

    // 更新难度因子
    // ΔEF = 0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02)
    const deltaEF = 0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02);
    easeFactor = Math.max(SM2_MIN_EASE_FACTOR, easeFactor + deltaEF);

    const nextReviewDate = new Date(now);
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    const newSRS: SRSData = {
      ...card,
      algorithm: "sm2",
      interval,
      repetitions,
      easeFactor,
      nextReview: nextReviewDate.toISOString().substring(0, 10),
      lastReview: now.toISOString().substring(0, 10),
      lastRating: rating,
    };

    return {
      newSRS,
      nextReviewDate,
      intervalDays: interval,
      message: this.sm2Message(rating, interval),
    };
  }

  private sm2Message(rating: RecallRating, interval: number): string {
    if (rating === 1) return `⟳ 重来，明天再见`;
    if (rating === 2) return `💪 加油，${interval} 天后复习`;
    if (rating === 3) return `✅ 不错，${interval} 天后复习`;
    return `🚀 太棒了，${interval} 天后复习`;
  }

  // ════════════════════════════════════════════════════════════
  // FSRS-4.5 算法
  // 参考：https://github.com/open-spaced-repetition/fsrs4anki
  // ════════════════════════════════════════════════════════════
  private reviewFSRS(card: SRSData, rating: RecallRating): SRSResult {
    const w = FSRS_DEFAULT_PARAMS.w;
    const R = FSRS_DEFAULT_PARAMS.requestRetention;
    const now = new Date();

    let { stability, difficulty, interval, repetitions } = card;

    // 初始化（新卡片）
    if (repetitions === 0 || !stability) {
      // 初始稳定性基于评分
      stability = w[rating - 1];          // w[0..3] 对应 rating 1..4
      difficulty = this.initDifficulty(rating, w);
      interval = this.nextInterval(stability, R);
      repetitions = 1;
    } else {
      // 计算当前可提取性
      const elapsedDays = card.lastReview
        ? Math.max(1, this.daysDiff(new Date(card.lastReview), now))
        : 1;
      const retrievability = Math.pow(1 + elapsedDays / (9 * stability), -1);

      // 更新难度
      difficulty = this.updateDifficulty(difficulty, rating, w);

      // 更新稳定性
      if (rating === 1) {
        // 遗忘：重置
        stability = this.forgetStability(difficulty, stability, retrievability, w);
        interval = 1;
        repetitions = 0;
      } else {
        stability = this.recallStability(difficulty, stability, retrievability, rating, w);
        interval = this.nextInterval(stability, R);
        repetitions++;
      }
    }

    // 限制最大间隔
    interval = Math.min(interval, FSRS_DEFAULT_PARAMS.maximumInterval);
    interval = Math.max(1, Math.round(interval));

    const nextReviewDate = new Date(now);
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    const newSRS: SRSData = {
      ...card,
      algorithm: "fsrs",
      interval,
      repetitions,
      easeFactor: card.easeFactor,    // FSRS 不用 easeFactor，保留不变
      stability,
      difficulty,
      nextReview: nextReviewDate.toISOString().substring(0, 10),
      lastReview: now.toISOString().substring(0, 10),
      lastRating: rating,
    };

    return {
      newSRS,
      nextReviewDate,
      intervalDays: interval,
      message: this.fsrsMessage(rating, interval),
    };
  }

  private initDifficulty(rating: RecallRating, w: number[]): number {
    // D0(r) = w4 - (r-3) * w5
    const d = w[4] - (rating - 3) * w[5];
    return Math.min(10, Math.max(1, d));
  }

  private updateDifficulty(d: number, rating: RecallRating, w: number[]): number {
    // D' = w6 * D0(4) + (1 - w6) * (D - w7 * (r - 3))
    const d0_4 = w[4] - (4 - 3) * w[5];  // D0(Easy=4)
    const newD = w[6] * d0_4 + (1 - w[6]) * (d - w[7] * (rating - 3));
    return Math.min(10, Math.max(1, newD));
  }

  private recallStability(d: number, s: number, r: number, rating: RecallRating, w: number[]): number {
    const hardPenalty = rating === 2 ? w[15] : 1;
    const easyBonus = rating === 4 ? w[16] : 1;
    return s * (
      Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp((1 - r) * w[10]) - 1) *
      hardPenalty *
      easyBonus
    );
  }

  private forgetStability(d: number, s: number, r: number, w: number[]): number {
    return w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  }

  private nextInterval(stability: number, r: number): number {
    // I(r, S) = S * (r^(1/c) - 1) / (1 - r^(1/c))
    // 简化：I = 9 * S * (1/r - 1)
    return Math.max(1, Math.round(9 * stability * (1 / r - 1)));
  }

  private daysDiff(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  private fsrsMessage(rating: RecallRating, interval: number): string {
    if (rating === 1) return `⟳ 再想想，明天重来`;
    if (rating === 2) return `💪 有点难，${interval} 天后见`;
    if (rating === 3) return `✅ 掌握了，${interval} 天后巩固`;
    return `🚀 完全会了，${interval} 天后回顾`;
  }
}