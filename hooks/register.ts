import type { EngineInterface, Register } from 'claude-code';

const DEFAULT_WATCH = 'fast-jev-compaction';
// Trace outcomes that mean the watched plugin's hook threw or ran out of budget.
const FAILED = new Set(['skipped', 'kept', 'expired', 'caught', 'rejected']);

type Link = { plugin: string; tier: string; outcome: string; ms: number; reason?: string };

// One writer per module: records are appended in order, the file kept in memory
// after its first read. ponytail: whole-file rewrite per record; fine for one
// session's day, switch to rotation if a file nears the 4 MiB fs limit.
let file: { path: string; text: string } | undefined;
let queue: Promise<void> = Promise.resolve();
let warned = false;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Long token-like runs (keys, bearer tokens) never reach the log.
function redact(text: string): string {
  return text.replace(/[A-Za-z0-9_\-]{24,}/g, '<redacted>');
}

function outcomeOf(text: string): string | undefined {
  if (/^kept \d+\/\d+ messages/.test(text)) return 'kept';
  if (text.startsWith('fallback to built-in summary')) return 'fallback';
  if (text.startsWith('auto-compact skipped')) return 'skipped';
  if (text.startsWith('decisions')) return 'decisions';
  return undefined;
}

function chainOf(trace: readonly Link[]): Link[] {
  return trace.map(({ plugin, tier, outcome, ms, reason }) => ({
    plugin,
    tier,
    outcome,
    ms: Math.round(ms),
    ...(reason ? { reason } : {}),
  }));
}

function append($: EngineInterface, record: Record<string, unknown>): Promise<void> {
  const run = queue.then(async () => {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.';
    const now = new Date().toISOString();
    const path = `${home}/.claude/logs/jev-watch/${now.slice(0, 10)}_${await $.session.id()}.jsonl`;
    if (file?.path !== path) {
      let text = '';
      try {
        text = await $.fs.read(path);
      } catch {
        // a new file
      }
      file = { path, text };
    }
    file.text += `${JSON.stringify({ ts: now, ...record })}\n`;
    await $.fs.write(path, file.text);
  });
  // A logger that cannot write says so once on screen, then only in the debug log.
  queue = run.catch((error) => {
    $.ui.log(`jev-watch: log write failed (${message(error)})`, { to: warned ? 'debug' : 'transcript' });
    warned = true;
  });
  return queue;
}

async function failures($: EngineInterface, watch: string, event: string, trace: readonly Link[]) {
  for (const link of trace) {
    if (link.plugin === watch && FAILED.has(link.outcome)) {
      await append($, { kind: 'hook-failure', event, ...chainOf([link])[0] });
    }
  }
}

export const register: Register = (on, options) => {
  const watch =
    typeof options['watch'] === 'string' && options['watch'] ? options['watch'] : DEFAULT_WATCH;

  on('ui.log', async ($, e, next) => {
    if (next.origin.plugin === watch) {
      await append($, { kind: 'log', to: e.to, outcome: outcomeOf(e.text), text: redact(e.text) });
    }
    return next(e);
  });

  on('http.fetch', async ($, e, next) => {
    if (next.origin.plugin !== watch) return next(e);
    const started = Date.now();
    // Headers and body carry the key: only method and host/path are kept.
    const base = { kind: 'http', method: e.init?.method ?? 'GET', url: e.url.split('?')[0] };
    try {
      const result = await next(e);
      const ms = Date.now() - started;
      if ('deny' in result && result.deny !== undefined) {
        await append($, { ...base, ms, deny: result.deny });
      } else if (result.value) {
        const { status, ok, text } = result.value;
        await append($, {
          ...base,
          ms,
          status,
          ok,
          bytes: text.length,
          ...(ok ? {} : { body: redact(text.slice(0, 500)) }),
        });
      }
      return result;
    } catch (error) {
      await append($, { ...base, ms: Date.now() - started, error: redact(message(error)) });
      throw error;
    }
  });

  on('session.compact', async ($, e, next) => {
    const started = Date.now();
    const base = {
      kind: 'compact',
      trigger: e.trigger,
      by: next.origin.plugin,
      ...(e.agentId ? { agentId: e.agentId } : {}),
      before: e.messages.length,
    };
    try {
      const result = await next(e);
      await append($, {
        ...base,
        ms: Date.now() - started,
        ...(result.messages ? { after: result.messages.length } : { skip: result.skip }),
        chain: chainOf(next.trace),
      });
      await failures($, watch, 'session.compact', next.trace);
      return result;
    } catch (error) {
      await append($, {
        ...base,
        ms: Date.now() - started,
        error: redact(message(error)),
        chain: chainOf(next.trace),
      });
      throw error;
    }
  });

  // The watched plugin hooks turn.complete; its link missing from the first
  // trace means it is not loaded, or loaded above this one (enabledPlugins
  // order), where its failures and own answers cannot be seen.
  let checked = false;
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (!checked) {
      checked = true;
      if (!next.trace.some((link) => link.plugin === watch)) {
        const note = `${watch} is not beneath jev-watch: not loaded, or listed before jev-watch in enabledPlugins`;
        await append($, { kind: 'not-seen', event: 'turn.complete', note });
        $.ui.log(`jev-watch: ${note}`);
      }
    }
    await failures($, watch, 'turn.complete', next.trace);
    return result;
  });
};
