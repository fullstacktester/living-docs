/**
 * Playwright's test details argument, as `about()` builds it. Declared here
 * rather than imported, so it matches any supported Playwright version.
 */
export interface AboutDetails {
  tag?: string | string[];
  annotation: { type: string; description?: string }[];
}

export interface AboutOptions {
  tag?: string | string[];
  /** Issue keys, URLs or text. The report links keys and URLs. */
  issue?: string | string[];
}

/**
 * A test's narrative, plus optional tags and issues, as Playwright's details
 * argument. The living-docs report shows the narrative under the test title.
 *
 * ```ts
 * test('returns the form', about('A client sees the form they asked for.', { tag: '@smoke' }), async () => {});
 * ```
 */
export function about(
  narrative: string,
  { tag, issue }: AboutOptions = {},
): AboutDetails {
  const issues = issue === undefined ? [] : [issue].flat();
  return {
    ...(tag ? { tag } : {}),
    annotation: [
      { type: 'description', description: narrative },
      ...issues.map((description) => ({ type: 'issue', description })),
    ],
  };
}
