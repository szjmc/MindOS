import { WikiPageMeta, DraftDoc, CandidatePage } from "./types";

export class SimilarityScorer {
  scoreCandidates(draft: DraftDoc, allPages: WikiPageMeta[], topN: number): CandidatePage[] {
    const candidates: CandidatePage[] = [];

    for (const page of allPages) {
      const result = this.scoreOne(draft, page);
      if (result.score > 0) {
        candidates.push({ meta: page, score: result.score, reason: result.reason });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, topN);
  }

  private scoreOne(draft: DraftDoc, page: WikiPageMeta): { score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    const dTitle = this.normalize(draft.title);
    const pTitle = this.normalize(page.title);

    if (dTitle === pTitle) {
      score += 100;
      reasons.push("标题完全相同");
    } else if (dTitle.includes(pTitle) || pTitle.includes(dTitle)) {
      score += 50;
      reasons.push("标题包含");
    } else {
      const overlap = this.charOverlap(dTitle, pTitle);
      if (overlap >= 0.5) {
        score += Math.round(overlap * 40);
        reasons.push(`标题相似 ${Math.round(overlap * 100)}%`);
      }
    }

    if (draft.pageType === page.type) {
      score += 20;
      reasons.push("类型相同");
    }

    const draftTags = new Set(draft.tags.map((t) => t.toLowerCase()));
    const pageTags = new Set((page.tags ?? []).map((t) => t.toLowerCase()));
    let tagOverlap = 0;
    for (const t of draftTags) {
      if (t && t !== "ai-collected" && pageTags.has(t)) tagOverlap++;
    }
    if (tagOverlap > 0) {
      score += tagOverlap * 15;
      reasons.push(`${tagOverlap} 个标签重合`);
    }

    if (page.brief && draft.brief) {
      const overlap = this.charOverlap(this.normalize(draft.brief), this.normalize(page.brief));
      if (overlap >= 0.3) {
        score += Math.round(overlap * 25);
        reasons.push(`简介相似 ${Math.round(overlap * 100)}%`);
      }
    }

    return { score, reason: reasons.join(" + ") };
  }

  private normalize(text: string): string {
    return String(text ?? "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[【】《》「」『』""''（）()[\]、，。\-_·]/g, "");
  }

  private charOverlap(a: string, b: string): number {
    if (!a || !b) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersect = 0;
    for (const ch of setA) {
      if (setB.has(ch)) intersect++;
    }
    return intersect / Math.min(setA.size, setB.size);
  }
}