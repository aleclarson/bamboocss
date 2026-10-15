/** Edits turning `a` into `b`: an insertion, a deletion, a substitution, or two neighbours swapped. */
export const editDistance = (a: string, b: string) => {
  let beforePrevious: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      let distance = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, beforePrevious[j - 2]! + 1)
      }
      current.push(distance)
    }
    beforePrevious = previous
    previous = current
  }
  return previous[b.length]!
}

/**
 * The candidate `word` is a typo of: one edit away for every four characters, and always one.
 * A tie goes to the candidate listed first.
 *
 * Scaled to the word, so a short one is not matched to whatever else is short — two edits turn
 * `sp` into `spec` — and a long one still survives a slip or two.
 */
export const closestMatch = (word: string, candidates: Iterable<string>) => {
  let nearest: string | undefined
  let distance = Math.max(1, Math.floor(word.length / 4)) + 1
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - word.length) >= distance) continue
    const edits = editDistance(word, candidate)
    if (edits < distance) {
      nearest = candidate
      distance = edits
    }
  }
  return nearest
}
