import { RecallCard } from "../../../core/types";

export interface CardRelationScore {
  textScore: number;
  vectorScore: number;
  tagBoost: number;
  scenarioBoost: number;
  finalScore: number;
}

function normalizeText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[`*_>#\-+=|[\]{}()!?,.;:/\\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const basic = normalized.split(" ").filter(Boolean);

  const cjk = Array.from(normalized)
    .filter((ch) => /[\u4e00-\u9fa5]/.test(ch));

  return [...basic, ...cjk];
}

function buildCardText(card: RecallCard): string {
  const parts = [
    (card as any).front,
    (card as any).back,
    ((card as any).tags || []).join(" "),
    (card as any).hint,
    (card as any).notes,
  ];
  return parts.filter(Boolean).join(" ");
}

function toFreqMap(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokens) {
    map.set(t, (map.get(t) || 0) + 1);
  }
  return map;
}

function cosineFromFreq(a: Map<string, number>, b: Map<string, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dot = 0;
  let na = 0;
  let nb = 0;

  for (const k of keys) {
    const va = a.get(k) || 0;
    const vb = b.get(k) || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }

  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function overlapScore(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;

  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }

  return inter / Math.max(sa.size, sb.size);
}

export function computeTextSimilarity(cardA: RecallCard, cardB: RecallCard): number {
  const textA = buildCardText(cardA);
  const textB = buildCardText(cardB);

  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (!tokensA.length || !tokensB.length) return 0;

  const cosine = cosineFromFreq(toFreqMap(tokensA), toFreqMap(tokensB));
  const overlap = overlapScore(tokensA, tokensB);

  return Math.max(0, Math.min(1, cosine * 0.7 + overlap * 0.3));
}

export function computeTagBoost(cardA: RecallCard, cardB: RecallCard): number {
  const tagsA = new Set(((cardA as any).tags || []).map((x: string) => String(x).toLowerCase()));
  const tagsB = new Set(((cardB as any).tags || []).map((x: string) => String(x).toLowerCase()));

  if (!tagsA.size || !tagsB.size) return 0;

  let match = 0;
  for (const t of tagsA) {
    if (tagsB.has(t)) match++;
  }

  if (match === 0) return 0;
  return Math.min(1, match / Math.max(tagsA.size, tagsB.size));
}

export function computeScenarioBoost(cardA: RecallCard, cardB: RecallCard): number {
  const sa = (cardA as any).scenario || "";
  const sb = (cardB as any).scenario || "";
  return sa && sb && sa === sb ? 1 : 0;
}

export function cosineSimilarity(vecA?: number[], vecB?: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    na += vecA[i] * vecA[i];
    nb += vecB[i] * vecB[i];
  }

  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}