import { describe, expect, it } from 'vitest';
import { createRedactor, REDACTED } from '../src/record/redaction.js';

describe('createRedactor', () => {
  it('redacts default and extra headers, case-insensitively', () => {
    const r = createRedactor({ headers: ['X-Waf-Bypass'] });
    expect(
      r.headers({
        Authorization: 'Bearer a',
        cookie: 'c',
        'x-waf-bypass': 's',
        accept: '*/*',
      }),
    ).toEqual({
      Authorization: REDACTED,
      cookie: REDACTED,
      'x-waf-bypass': REDACTED,
      accept: '*/*',
    });
  });

  it('redacts secret keys at any depth in JSON', () => {
    const r = createRedactor();
    expect(
      r.text(
        '{"user":{"password":"p","name":"n"},"items":[{"token":"t"}]}',
        'response',
      ),
    ).toEqual({
      user: { password: REDACTED, name: 'n' },
      items: [{ token: REDACTED }],
    });
  });

  it('redacts request-only keys in requests but not responses', () => {
    const r = createRedactor({ requestKeys: ['code'] });
    expect(r.requestBody({ code: '123456' })).toEqual({ code: REDACTED });
    expect(r.text('{"code":"field.invalid"}', 'response')).toEqual({
      code: 'field.invalid',
    });
  });

  it('reads and redacts a form-encoded request body', () => {
    const r = createRedactor();
    expect(r.text('email=a%40b.c&password=secret', 'request')).toEqual({
      email: 'a@b.c',
      password: REDACTED,
    });
  });

  it('can replace the defaults', () => {
    const r = createRedactor({ replaceDefaults: true, keys: ['pin'] });
    expect(r.requestBody({ password: 'p', pin: '1' })).toEqual({
      password: 'p',
      pin: REDACTED,
    });
  });

  it('scrubs secret header lines from a call log', () => {
    const r = createRedactor();
    const log = 'GET /a\n  authorization: Bearer abc\n  accept: */*';
    expect(r.scrub(log)).not.toContain('Bearer abc');
    expect(r.scrub(log)).toContain('accept: */*');
  });

  it('truncates long non-JSON bodies', () => {
    const r = createRedactor({ maxBodyChars: 5 });
    expect(r.text('abcdefghij', 'response')).toBe('abcde... [truncated]');
  });
});
