import { DiffLine, DiffResult } from "../../core/types";

/** Line-by-line diff between two version contents */
export function diffVersions(oldContent: string, newContent: string): DiffResult {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  const maxLen = Math.max(oldLines.length, newLines.length);

  // Simple LCS-based diff for readability
  let i = 0, j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      lines.push({
        type: "unchanged",
        content: oldLines[i],
        lineNumber: { old: i + 1, new: j + 1 },
      });
      i++;
      j++;
    } else {
      // Look ahead to see if it's a deletion or addition
      const nextMatchInOld = oldLines.indexOf(newLines[j], i);
      const nextMatchInNew = newLines.indexOf(oldLines[i], j);

      if (nextMatchInOld === -1 || (nextMatchInNew !== -1 && nextMatchInNew - j <= nextMatchInOld - i)) {
        // Deletion from old
        lines.push({
          type: "removed",
          content: oldLines[i],
          lineNumber: { old: i + 1, new: 0 },
        });
        deletions++;
        i++;
      } else {
        // Addition to new
        lines.push({
          type: "added",
          content: newLines[j],
          lineNumber: { old: 0, new: j + 1 },
        });
        additions++;
        j++;
      }
    }
  }

  // Remaining old lines = removals
  while (i < oldLines.length) {
    lines.push({
      type: "removed",
      content: oldLines[i],
      lineNumber: { old: i + 1, new: 0 },
    });
    deletions++;
    i++;
  }

  // Remaining new lines = additions
  while (j < newLines.length) {
    lines.push({
      type: "added",
      content: newLines[j],
      lineNumber: { old: 0, new: j + 1 },
    });
    additions++;
    j++;
  }

  return { additions, deletions, lines };
}

/** Generate a brief human-readable change summary */
export function generateChangeSummary(oldContent: string, newContent: string): string {
  const diff = diffVersions(oldContent, newContent);
  const parts: string[] = [];

  if (diff.additions > 0) {
    parts.push(`+${diff.additions} 行`);
  }
  if (diff.deletions > 0) {
    parts.push(`-${diff.deletions} 行`);
  }

  if (parts.length === 0) return "无变化";

  // Detect if it's mainly headings/structural changes
  const addedHeadings = diff.lines.filter(
    (l) => l.type === "added" && /^#+\s/.test(l.content),
  ).length;
  const removedHeadings = diff.lines.filter(
    (l) => l.type === "removed" && /^#+\s/.test(l.content),
  ).length;

  if (addedHeadings > 0 && addedHeadings > diff.additions * 0.3) {
    parts.push("新增标题结构");
  }
  if (removedHeadings > 0 && removedHeadings > diff.deletions * 0.3) {
    parts.push("删除标题结构");
  }

  return parts.join("，");
}

export type { DiffLine, DiffResult };
