import type { Register } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';

const SECRET = 'sk-test-0123456789abcdefghijklmnopqrstuv';

// Stands in for fast-jev-compaction: logs a fallback and calls TypeSafe with the key.
// It loads in an environment of its own, so the key is spelled out, not closed over.
const fakeJev: Register = (on) => {
  on('session.compact', async ($) => {
    const key = 'sk-test-0123456789abcdefghijklmnopqrstuv';
    $.ui.log('fallback to built-in summary (Jev said no)');
    await $.http.fetch(`https://api.typesafe.test/v1/jev?key=${key}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({ key }),
    });
    return { skip: 'fake' };
  });
};

test(
  'logs the watched plugin, never its key',
  { plugins: [{ name: 'fast-jev-compaction', register: fakeJev }] },
  async ($, on) => {
    const writes: string[] = [];
    const paths: string[] = [];
    on('fs.read', async () => ({ deny: 'ENOENT' }));
    on('fs.write', async (_$, e) => {
      paths.push(e.path);
      writes.push(e.text);
      return { value: undefined };
    });
    on('http.fetch', async () => ({
      value: { status: 401, ok: false, headers: {}, text: `{"error":"bad key ${SECRET}"}` },
    }));

    const shown: string[] = [];
    on('ui.log', async (_$, e) => {
      shown.push(e.text);
      return { value: undefined };
    });
    mock.env(on, { USERPROFILE: 'C:/Users/test' });
    on('session.id', async () => ({ value: 'sess-1' }));
    const clock = mock.clock(on);

    await $.session.compact({
      trigger: 'manual',
      messages: [{ role: 'user', text: 'hi', toolUses: [] }],
    });
    await clock.settle();

    expect(shown.filter((text) => text.startsWith('jev-watch'))).toEqual([]);
    // The engine hands fs hooks a native path: backslashes on Windows.
    expect(paths.at(-1) ?? '').toMatch(
      /^C:[\\/]Users[\\/]test[\\/]\.claude[\\/]logs[\\/]jev-watch[\\/]\d{4}-\d\d-\d\d_sess-1\.jsonl$/,
    );
    const log = writes.at(-1) ?? '';
    expect(log).toContain('"outcome":"fallback"');
    expect(log).toContain('"kind":"http"');
    expect(log).toContain('"status":401');
    expect(log).toContain('"url":"https://api.typesafe.test/v1/jev"');
    expect(log).not.toContain(SECRET);
  },
);
