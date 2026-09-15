/**
 * Putting a parts order onto a job — the shared shapes and wording.
 *
 * Automatic matching only fires when exactly one job matches the registration on the order.
 * Everything else needs a person: stock orders, anything bought at the counter or on eBay (which
 * carry no registration at all), a car that came in twice the same week, or a reference somebody
 * typed as a surname. That is not a gap in the matching — it is most of the work.
 *
 * Labels live here rather than in the component so every list of orders reads the same way, and
 * so the wording can be tested without rendering anything.
 */

/** Why an order is being offered for this job. Shown on the row so a choice takes one glance. */
export type SuggestionReason =
  /** Carries this job's registration. Almost always the right one. */
  | 'same vehicle'
  /** No registration match, but bought while this job was open. */
  | 'ordered around this job'
  /** Neither. Listed so nothing is unreachable, but nothing suggests it belongs here. */
  | 'recent'

export interface OrderOption {
  orderId: number
  supplier: string
  ref: string
  orderedAt: string | null
  netTotal: number | null
  branch: string | null
  typedRef: string | null
  lineCount: number
  reason: SuggestionReason
  daysApart: number | null
}

/** How far either side of a job an order counts as "around" it. */
export const AROUND_JOB_DAYS = 7

/** Orders older than this are not offered: the list has to stay pickable. */
export const MAX_AGE_DAYS = 365

export function money(value: number | null | undefined): string {
  return value == null ? '—' : `£${Number(value).toFixed(2)}`
}

/**
 * `10 Sep`. Written out rather than via `toLocaleDateString`, whose "short" month is not stable —
 * the same en-GB call gives "Sep" in a browser and "Sept" under Node. A label that differs between
 * server and client is a needless way to make two screens disagree.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return 'no date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'no date'
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`
}

/**
 * One row of dropdown text, in the order somebody scans it: what it cost, who from, when, how many
 * parts. The supplier's reference goes last — it identifies the order to Euro Car Parts, not to the
 * person choosing.
 *
 * No registration: the list is read next to the job, which already shows the car, so repeating the
 * plate on every row spreads it across screens and logs for nothing.
 */
export function optionLabel(o: Pick<OrderOption, 'supplier' | 'ref' | 'orderedAt' | 'netTotal' | 'lineCount'>): string {
  const parts = `${o.lineCount} ${o.lineCount === 1 ? 'part' : 'parts'}`
  return `${money(o.netTotal)} · ${o.supplier} · ${shortDate(o.orderedAt)} · ${parts} · ${o.ref}`
}

/** What the person is told when an order cannot be attached. Plain words, and what to do next. */
export const ATTACH_MESSAGES = {
  alreadyTaken: 'That order has already been put on a job. Refresh and check.',
  noUser: 'Cannot record who is attaching this order.',
  gone: 'That order no longer exists.'
} as const
