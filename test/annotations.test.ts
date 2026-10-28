import { describe, expect, it } from 'vitest';
import { about } from '../src/annotations.js';

describe('about', () => {
  it('builds a description annotation', () => {
    expect(about('Why it matters.')).toEqual({
      annotation: [{ type: 'description', description: 'Why it matters.' }],
    });
  });

  it('adds tags and one issue annotation per issue', () => {
    expect(about('N', { tag: '@smoke', issue: ['ABC-1', 'text'] })).toEqual({
      tag: '@smoke',
      annotation: [
        { type: 'description', description: 'N' },
        { type: 'issue', description: 'ABC-1' },
        { type: 'issue', description: 'text' },
      ],
    });
  });
});
