// El reloj: cómo se lee un instante.
//
// An event happens at an instant, and every other way of saying when — "HOY ·
// 11 AGO", "12:41", "hace 12 min" — is that instant read against the clock of
// whoever is looking. So the event stores one thing, the instant, and the
// readings are worked out here.
//
// Everything takes `now` so that a caller can ask what a screen said at some
// other moment, and so that two readings taken in the same render agree with
// each other instead of straddling a midnight.

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']

const pad = (n: number) => String(n).padStart(2, '0')

/** Midnight of whatever day that instant fell on, locally. */
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Whole days between two instants, counted in midnights crossed rather than in
 * hours: 23:50 and 00:10 are a day apart even though twenty minutes separate
 * them, which is what "ayer" means to the person reading it.
 */
export function daysApart(at: string | Date, now: Date = new Date()) {
  return Math.round((startOfDay(now) - startOfDay(new Date(at))) / DAY)
}

/** "06 AGO", the way the app writes a date. */
export function dateLabel(at: string | Date) {
  const d = new Date(at)
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`
}

/** "12:41". The clock the device showed when it recorded. */
export function timeLabel(at: string | Date) {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The header the log groups under. The two most recent days get a word in
 * front of the date, because that is how someone reading their own morning
 * refers to it; older days are just the date.
 */
export function dayLabel(at: string | Date, now: Date = new Date()) {
  const days = daysApart(at, now)
  const date = dateLabel(at)
  if (days === 0) return `HOY · ${date}`
  if (days === 1) return `AYER · ${date}`
  return date
}

/** Whether that instant falls on the day being lived right now. */
export function isToday(at: string | Date, now: Date = new Date()) {
  return daysApart(at, now) === 0
}

/**
 * How long ago, in the largest unit that still says something true: minutes up
 * to an hour, then hours up to a day, then days. Rounded down, because "hace
 * 2 h" and not yet three is what a person means by two hours ago.
 */
export function sinceLabel(at: string | Date, now: Date = new Date()) {
  const ms = now.getTime() - new Date(at).getTime()
  if (ms < MINUTE) return 'ahora'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`
  return `${Math.floor(ms / DAY)} d`
}
