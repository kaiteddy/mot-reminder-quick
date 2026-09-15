/**
 * How much of a part was fitted, returned, or left spare.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
 * `omnipartOrderMeta.partStates` holds one STATE per product code: `fitted`, `returned` or
 * `spare`. That works for a line of one, and cannot express a line of four.
 *
 * Real orders are not all lines of one. From 20 real Omnipart confirmations: `x2` bulbs, `x2` wiper
 * blades, `x2` brake discs, `x4` wheel nuts, `x3` gloves. And the case the whole system was asked
 * for — "we charge for what is used and return what is not" — is precisely a split: four filters
 * bought, three fitted, one going back. A single state has to round that to all-or-nothing, and
 * whichever way it rounds is wrong: charge the customer for four, or lose the credit on the fourth.
 *
 * ── HOW IT STAYS COMPATIBLE ──────────────────────────────────────────────────────────────
 * The stored value widens from `string` to `string | {fitted, returned, spare}`. Everything already
 * written stays valid and keeps its meaning, and `readUsage` accepts both. Nothing needs migrating,
 * and a row written by the old code path is still read correctly by the new one.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

/** The three states, as stored today. */
export type PartState = 'fitted' | 'returned' | 'spare'

/** What is stored per product code — a bare state as before, or a split. */
export type StoredUsage = PartState | { fitted?: number; returned?: number; spare?: number }

export interface PartUsage {
  fitted: number
  returned: number
  spare: number
  /** Not yet accounted for: ordered less everything decided. Never negative. */
  undecided: number
  /**
   * One word for the whole line, for a view that shows a single pill.
   * `'part'` means the line is split and a single word cannot describe it — show the numbers.
   * `null` means nothing has been decided yet.
   */
  state: PartState | 'part' | null
}

function toCount(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Read a stored value against the quantity ordered.
 *
 * A bare state means the WHOLE line: `'fitted'` on a line of four is four fitted. That is what the
 * old UI meant by it, so reading it any other way would silently change the meaning of every row
 * already recorded.
 */
export function readUsage(stored: StoredUsage | null | undefined, quantityOrdered = 1): PartUsage {
  const ordered = Math.max(toCount(quantityOrdered), 0)

  if (stored == null) {
    return { fitted: 0, returned: 0, spare: 0, undecided: ordered, state: null }
  }

  if (typeof stored === 'string') {
    const whole = ordered || 1
    const usage = {
      fitted: stored === 'fitted' ? whole : 0,
      returned: stored === 'returned' ? whole : 0,
      spare: stored === 'spare' ? whole : 0
    }
    return { ...usage, undecided: 0, state: stored }
  }

  const fitted = toCount(stored.fitted)
  const returned = toCount(stored.returned)
  const spare = toCount(stored.spare)
  const decided = fitted + returned + spare

  let state: PartUsage['state'] = null
  if (decided === 0) state = null
  else if (fitted === decided && decided >= ordered) state = 'fitted'
  else if (returned === decided && decided >= ordered) state = 'returned'
  else if (spare === decided && decided >= ordered) state = 'spare'
  else state = 'part'

  return { fitted, returned, spare, undecided: Math.max(ordered - decided, 0), state }
}

/**
 * Build a value to store, clamped so it can never claim more than was bought.
 *
 * Over-claiming is the failure that matters: it credits stock that was never ordered, or charges
 * for parts that were never delivered. Clamping here means no caller can produce an impossible
 * row, however the numbers arrive.
 */
export function makeUsage(
  input: { fitted?: number; returned?: number; spare?: number },
  quantityOrdered = 1
): { fitted: number; returned: number; spare: number } | null {
  const ordered = Math.max(toCount(quantityOrdered), 1)

  let fitted = Math.min(toCount(input.fitted), ordered)
  let returned = Math.min(toCount(input.returned), Math.max(ordered - fitted, 0))
  let spare = Math.min(toCount(input.spare), Math.max(ordered - fitted - returned, 0))

  if (fitted + returned + spare === 0) return null   // nothing decided: clear the row
  return { fitted, returned, spare }
}

/**
 * Collapse to a bare state where that loses nothing, so the stored shape stays as small and as
 * familiar as it was. A whole line of one thing writes exactly what the old code wrote.
 */
export function compactUsage(
  usage: { fitted: number; returned: number; spare: number } | null,
  quantityOrdered = 1
): StoredUsage | null {
  if (!usage) return null
  const ordered = Math.max(toCount(quantityOrdered), 1)
  if (usage.fitted >= ordered && !usage.returned && !usage.spare) return 'fitted'
  if (usage.returned >= ordered && !usage.fitted && !usage.spare) return 'returned'
  if (usage.spare >= ordered && !usage.fitted && !usage.returned) return 'spare'
  return usage
}

/** What to show on one line. "3 fitted · 1 to return", or a single word when it is all one thing. */
export function describeUsage(usage: PartUsage): string {
  if (usage.state === null) return 'not decided'
  if (usage.state !== 'part') return usage.state
  const bits: string[] = []
  if (usage.fitted) bits.push(`${usage.fitted} fitted`)
  if (usage.returned) bits.push(`${usage.returned} to return`)
  if (usage.spare) bits.push(`${usage.spare} spare`)
  if (usage.undecided) bits.push(`${usage.undecided} not decided`)
  return bits.join(' · ')
}
