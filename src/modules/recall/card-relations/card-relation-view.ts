import { setIcon } from "obsidian";
import { RecallCard } from "../../../core/types";
import { CardRelationItem, CardRelationService } from "./card-relation-service";

export interface CardRelationViewOptions {
  onOpenCard?: (card: RecallCard) => void;
  onQuickReview?: (card: RecallCard) => void;
  onRefresh?: () => void;
}

export class CardRelationView {
  private container: HTMLElement;
  private relationService: CardRelationService;
  private options: CardRelationViewOptions;
  private currentCard: RecallCard | null = null;

  constructor(
    container: HTMLElement,
    relationService: CardRelationService,
    options: CardRelationViewOptions = {},
  ) {
    this.container = container;
    this.relationService = relationService;
    this.options = options;
  }

  async render(card: RecallCard, limit = 3) {
    this.currentCard = card;
    this.container.empty();

    const wrap = this.container.createDiv({ cls: "mindos-card-relations" });

    const header = wrap.createDiv({ cls: "mindos-card-relations-header" });
    const titleRow = header.createDiv({ cls: "mindos-card-relations-title-row" });
    titleRow.createDiv({ cls: "mindos-card-relations-title", text: "🔗 相关推荐" });
    
    if (this.options.onRefresh) {
      const refreshBtn = titleRow.createEl("button", { cls: "mindos-card-relations-refresh-btn" });
      setIcon(refreshBtn, "refresh-cw");
      refreshBtn.title = "刷新推荐";
      refreshBtn.onclick = () => {
        if (this.currentCard) {
          this.render(this.currentCard, limit);
        }
      };
    }

    const loading = wrap.createDiv({ cls: "mindos-card-relations-loading" });
    const spinner = loading.createSpan({ cls: "mindos-card-relations-loading-spinner" });
    setIcon(spinner, "loader-2");
    loading.createSpan({ text: " 正在分析相关卡片..." });

    let items: CardRelationItem[] = [];
    try {
      items = await this.relationService.getRelatedCards(card, limit);
    } catch (e) {
      loading.empty();
      loading.setText(`加载失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    loading.remove();

    if (!items.length) {
      const empty = wrap.createDiv({ cls: "mindos-card-relations-empty" });
      const emptyIcon = empty.createSpan();
      setIcon(emptyIcon, "search-x");
      empty.createSpan({ text: " 暂无相关推荐" });
      return;
    }

    const hint = wrap.createDiv({ cls: "mindos-card-relations-hint" });
    hint.setText(`根据卡片内容、标签和场景，为你推荐 ${items.length} 张相关卡片`);

    const list = wrap.createDiv({ cls: "mindos-card-relations-list" });

    for (const item of items) {
      const row = list.createDiv({ cls: "mindos-card-relation-item" });

      const top = row.createDiv({ cls: "mindos-card-relation-top" });

      const scenario = top.createSpan({
        cls: "mindos-card-relation-scenario",
        text: String((item.card as any).scenario || "unknown"),
      });

      const score = top.createSpan({
        cls: "mindos-card-relation-score",
        text: `${Math.round(item.score * 100)}%`,
      });

      const front = row.createDiv({
        cls: "mindos-card-relation-front",
        text: String((item.card as any).front || "(无正面内容)"),
      });

      if ((item.card as any).back) {
        row.createDiv({
          cls: "mindos-card-relation-back",
          text: String((item.card as any).back).slice(0, 120) + "...",
        });
      }

      if (item.reason.length) {
        const reasonWrap = row.createDiv({ cls: "mindos-card-relation-reasons" });
        for (const r of item.reason) {
          reasonWrap.createSpan({
            cls: "mindos-card-relation-reason",
            text: r,
          });
        }
      }

      const actions = row.createDiv({ cls: "mindos-card-relation-actions" });
      
      if (this.options.onQuickReview) {
        const reviewBtn = actions.createEl("button", {
          cls: "mindos-card-relation-review-btn",
          text: "复习",
        });
        setIcon(reviewBtn, "play");
        reviewBtn.title = "快速复习此卡片";
        reviewBtn.onclick = () => {
          this.options.onQuickReview!(item.card);
        };
      }

      if (this.options.onOpenCard) {
        const openBtn = actions.createEl("button", {
          cls: "mindos-card-relation-open-btn",
          text: "详情",
        });
        setIcon(openBtn, "arrow-up-right");
        openBtn.title = "查看卡片详情";
        openBtn.onclick = () => {
          this.options.onOpenCard!(item.card);
        };
      }
    }
  }

  refresh() {
    if (this.currentCard) {
      this.render(this.currentCard);
    }
  }
}