/**
 * Shared text-normalization + content-key helpers for crowd contributions.
 *
 * The content key is used BOTH as the exact-duplicate `normalizedSignature`
 * and as the text we embed for vector similarity. It deliberately:
 *   - lowercases + collapses whitespace (cosmetic differences don't dodge dedup),
 *   - sorts the options (reordering options can't dodge dedup),
 *   - EXCLUDES the correct-option index (re-keying the same MCQ can't dodge dedup).
 */

export function normalizeText(text: string): string {
  return (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface OptionLike {
  text: string;
}

/**
 * Stable, key-independent representation of an MCQ's content.
 * Same string for the same question regardless of option order or which
 * option is marked correct.
 */
export function buildContentKey(
  questionText: string,
  options: OptionLike[],
): string {
  const opts = (options ?? [])
    .map(o => normalizeText(o.text))
    .sort()
    .join('\n');
  return `${normalizeText(questionText)}\n${opts}`;
}
