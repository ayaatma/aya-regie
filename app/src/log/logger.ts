/**
 * The journal: what happened, in order, kept where somebody else can read it.
 *
 * The person running this on the night is not the developer. When something goes wrong they will
 * say so afterwards, in a sentence, from memory, and the browser that saw it will be closed. What
 * answers that is not a stack trace at the moment of the crash, it is the twenty things that
 * happened before it, in order, still readable months later.
 *
 * FOUR RULES, and the first one outranks the other three.
 *
 * 1. LOGGING NEVER BREAKS THE TOOL. Every path here swallows its own failures. A journal that can
 *    take the planning down with it is worse than no journal: it would fail exactly when the
 *    thing it exists to explain is already going wrong.
 * 2. It is bounded. The buffer holds a few hundred entries and drops the oldest past that, and it
 *    says how many it dropped rather than pretending it did not. The database prunes its end.
 * 3. It is batched. An afternoon of dragging boxes is hundreds of entries, and a round trip each
 *    would be a tax on the very thing being measured.
 * 4. No contact details, ever. A line names people the way the interface already does
 *    ("déplacement de Marie Perrin"); it never carries a phone number, an address or a mail
 *    address of a volunteer. Everybody who can read the journal can already read the planning,
 *    so this is the one thing that would widen what they see.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** The families, so a listing can be filtered without reading every sentence. */
export type LogKind =
  | 'session'
  | 'planning'
  | 'edition'
  | 'enregistrement'
  | 'historique'
  | 'import'
  | 'solveur'
  | 'ecran'
  | 'divers';

export interface LogEntry {
  /** ISO, from the browser's clock, which is the one to read and the one to distrust. */
  at: string;
  level: LogLevel;
  kind: LogKind;
  message: string;
  detail?: Record<string, unknown>;
  /** The organiser's mail address as their own browser knows it. Postgres records its own. */
  actor?: string;
  /** One value per browser tab, so two organisers at once can be told apart in one listing. */
  session: string;
}

/** What a store has to offer for the journal to reach it. Both halves are optional on the store. */
export interface LogSink {
  appendLog(eventId: string | null, entries: readonly LogEntry[]): Promise<unknown>;
}

/** Longer than this and it is a payload, not a sentence. */
const MAX_MESSAGE = 500;
const MAX_DETAIL = 1000;

/**
 * How long entries wait before being sent.
 *
 * Not a debounce: the timer is set when the buffer goes from empty to filling and is not pushed
 * back by later entries, so a continuous stream still reaches the database every few seconds
 * rather than only when it stops.
 */
const FLUSH_DELAY_MS = 4000;

/** Past this the oldest go, because the newest are the ones that explain the crash. */
const BUFFER_LIMIT = 400;

const short = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;

/** A detail small enough to be worth keeping, or a note saying it was not. */
function trimDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  try {
    const text = JSON.stringify(detail);
    if (text.length <= MAX_DETAIL) return detail;
    return { tronque: true, apercu: short(text, MAX_DETAIL) };
  } catch {
    // Circular, or something that will not serialise. Saying so beats sending nothing.
    return { illisible: true };
  }
}

function newSessionId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid.slice(0, 8);
  } catch {
    // No Web Crypto, or a browser that refuses it. The fallback is only an identifier.
  }
  return Math.random().toString(36).slice(2, 10);
}

interface Buffered {
  eventId: string | null;
  entry: LogEntry;
}

export class Logger {
  private sink: LogSink | null = null;
  private eventId: string | null = null;
  private actor: string | undefined;
  private buffer: Buffered[] = [];
  private dropped = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;

  readonly session = newSessionId();

  /** Off until a sink is attached, so tests and the login screen record nothing. */
  constructor(private readonly autoFlush = true) {}

  attach(sink: LogSink | null): void {
    this.sink = sink;
  }

  /** Which plan the entries from now on belong to. Null before one is open. */
  setEvent(eventId: string | null): void {
    this.eventId = eventId;
  }

  setActor(actor: string | undefined): void {
    this.actor = actor;
  }

  record(level: LogLevel, kind: LogKind, message: string, detail?: Record<string, unknown>): void {
    try {
      this.buffer.push({
        eventId: this.eventId,
        entry: {
          at: new Date().toISOString(),
          level,
          kind,
          message: short(message, MAX_MESSAGE),
          detail: trimDetail(detail),
          actor: this.actor,
          session: this.session,
        },
      });

      if (this.buffer.length > BUFFER_LIMIT) {
        // The newest explain the crash; the oldest are the ones to lose. Counted rather than
        // silently forgotten, because a gap nobody mentions is a gap somebody will misread.
        this.dropped += this.buffer.length - BUFFER_LIMIT;
        this.buffer = this.buffer.slice(-BUFFER_LIMIT);
      }

      if (this.autoFlush && this.timer === null && this.sink) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, FLUSH_DELAY_MS);
      }
    } catch {
      // Rule 1. Recording must not be able to throw into whatever called it.
    }
  }

  info(kind: LogKind, message: string, detail?: Record<string, unknown>): void {
    this.record('info', kind, message, detail);
  }

  warn(kind: LogKind, message: string, detail?: Record<string, unknown>): void {
    this.record('warn', kind, message, detail);
  }

  error(kind: LogKind, message: string, detail?: Record<string, unknown>): void {
    this.record('error', kind, message, detail);
  }

  /**
   * Sends what is buffered, grouped by the plan each entry belonged to.
   *
   * Entries recorded before a plan was opened belong to no plan, and entries recorded under the
   * previous plan belong to that one. Sending the lot under whatever happens to be open now would
   * file the login failures under the plan somebody opened afterwards.
   */
  async flush(): Promise<void> {
    if (this.sending || this.sink === null || this.buffer.length === 0) return;
    this.sending = true;

    const sending = this.buffer;
    this.buffer = [];
    if (this.dropped > 0) {
      sending.unshift({
        eventId: sending[0]!.eventId,
        entry: {
          at: new Date().toISOString(),
          level: 'warn',
          kind: 'session',
          message: `${this.dropped} entrée(s) de journal perdues: le tampon était plein.`,
          session: this.session,
          actor: this.actor,
        },
      });
      this.dropped = 0;
    }

    const groups = new Map<string, Buffered[]>();
    for (const item of sending) {
      const key = item.eventId ?? '';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }

    try {
      for (const [key, items] of groups) {
        await this.sink.appendLog(
          key === '' ? null : key,
          items.map((item) => item.entry),
        );
      }
    } catch {
      // The network, or a database that refused. Put them back at the front, oldest first, and
      // let the cap decide what survives: a failing journal must not grow without end either.
      this.buffer = [...sending, ...this.buffer].slice(-BUFFER_LIMIT);
    } finally {
      this.sending = false;
    }
  }

  /** For tests, and for a screen that wants to show what has not been sent yet. */
  get pending(): number {
    return this.buffer.length;
  }
}

/**
 * The one instance the app uses.
 *
 * Ambient on purpose. Threading a logger through every component would mean touching every
 * component to add a line to the journal, and the lines worth having are exactly the ones nobody
 * plans for in advance.
 */
export const log = new Logger();
