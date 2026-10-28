// The report page. It reads the embedded data and renders every view from it.
// All test data goes into the DOM as text (never as HTML), so a response body
// or error message cannot inject markup.
(() => {
  'use strict';

  const data = JSON.parse(document.getElementById('report-data').textContent);
  const app = document.getElementById('app');

  const STATUSES = ['passed', 'failed', 'flaky', 'skipped'];
  const STATUS_LABEL = {
    passed: 'Passed',
    failed: 'Failed',
    flaky: 'Flaky',
    skipped: 'Skipped',
  };
  const STATUS_GLYPH = { passed: '✓', failed: '✕', flaky: '!', skipped: '–' };
  const KIND_LABEL = {
    step: 'Step',
    action: 'Action',
    assertion: 'Check',
    api: 'API',
    hook: 'Hook',
    attachment: 'File',
  };

  const byId = new Map(data.scenarios.map((s) => [s.id, s]));
  const filters = { status: 'all', level: 'all', search: '' };

  // ---------------------------------------------------------------- helpers

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child === undefined || child === null || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
  }

  function svg(tag, attrs, ...children) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      el.setAttribute(key, String(value));
    }
    append(el, children);
    return el;
  }

  function fmtDuration(ms) {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s`;
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  function link(route) {
    return `#/${route.map(encodeURIComponent).join('/')}`;
  }

  function counts(scenarios) {
    const c = {
      total: scenarios.length,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
    };
    for (const s of scenarios) c[s.status] += 1;
    return c;
  }

  function pct(n, total) {
    return total ? Math.round((n / total) * 100) : 0;
  }

  function statusIcon(status) {
    return h(
      'span',
      {
        class: `status-icon ${status}`,
        role: 'img',
        'aria-label': STATUS_LABEL[status],
      },
      STATUS_GLYPH[status],
    );
  }

  function statusBadge(status) {
    return h('span', { class: `badge ${status}` }, STATUS_LABEL[status]);
  }

  function stackedBar(c) {
    const bar = h('div', {
      class: 'bar',
      role: 'img',
      'aria-label': STATUSES.map((s) => `${c[s]} ${s}`).join(', '),
    });
    for (const s of STATUSES) {
      if (c[s])
        bar.append(
          h('span', {
            class: `bg-${s}`,
            style: `width:${(c[s] / c.total) * 100}%`,
          }),
        );
    }
    return bar;
  }

  function issueLink(issue) {
    if (/^https?:\/\//.test(issue))
      return h(
        'a',
        { href: issue, target: '_blank', rel: 'noreferrer' },
        issue,
      );
    if (data.issueUrl && /^[A-Z][A-Z0-9]*-\d+$/.test(issue)) {
      return h(
        'a',
        {
          href: data.issueUrl.replace('{key}', issue),
          target: '_blank',
          rel: 'noreferrer',
        },
        issue,
      );
    }
    return h('span', {}, issue);
  }

  function lastAttempt(run) {
    return run.attempts[run.attempts.length - 1];
  }

  function firstError(scenario) {
    for (const run of scenario.runs) {
      const err = lastAttempt(run)?.errors[0];
      if (err) return err.message.split('\n')[0];
    }
    return '';
  }

  /** A test's describe titles, outermost first, or '' outside any describe. */
  function describeText(s) {
    return s.describePath.join(' › ');
  }

  function isBrowserCall(node) {
    return node.kind === 'api' && node.api?.source === 'browser';
  }

  /** API steps in a tree, split by who made them: the test or the browser. */
  function countApiCalls(nodes, into = { test: 0, browser: 0 }) {
    for (const node of nodes) {
      if (node.kind === 'api')
        into[isBrowserCall(node) ? 'browser' : 'test'] += 1;
      countApiCalls(node.children, into);
    }
    return into;
  }

  function stepKindLabel(node) {
    if (node.kind !== 'api') return KIND_LABEL[node.kind] || node.kind;
    return isBrowserCall(node) ? 'Browser API' : 'Test API';
  }

  /** The step's title; a browser call's badge already says it is one. */
  function stepTitle(node) {
    return isBrowserCall(node)
      ? node.title.replace(/\s*\(browser\)$/, '')
      : node.title;
  }

  // ------------------------------------------------------------------ chrome

  function header(current) {
    const nav = h('nav', { class: 'nav', 'aria-label': 'Report sections' });
    const items = [
      ['Overview', link([]), 'overview'],
      ['Features', link(['features']), 'features'],
      ...data.levels.map((l) => [
        `${l} tests`,
        link(['level', l]),
        `level:${l}`,
      ]),
      ['All tests', link(['tests']), 'tests'],
    ];
    for (const [label, href, key] of items) {
      nav.append(
        h(
          'a',
          { href, 'aria-current': key === current ? 'page' : null },
          label,
        ),
      );
    }
    const meta = h(
      'div',
      { class: 'run-meta' },
      h('span', {}, fmtDate(data.startTime)),
      h('span', {}, `Duration ${fmtDuration(data.duration)}`),
      data.metadata.targetEnv &&
        h('span', {}, `Environment ${data.metadata.targetEnv}`),
      data.git?.branch && h('span', {}, `Branch ${data.git.branch}`),
      data.shuffleSeed &&
        h(
          'span',
          { title: `Run this order again with --shuffle ${data.shuffleSeed}` },
          `Shuffled, seed ${data.shuffleSeed}`,
        ),
      data.git?.hash &&
        h(
          'span',
          { title: data.git.subject || '' },
          `Commit ${data.git.hash.slice(0, 8)}`,
        ),
    );
    return h(
      'header',
      { class: 'header' },
      h(
        'div',
        { class: 'header-top' },
        h('div', { class: 'brand' }, logo(), h('h1', {}, data.title)),
        meta,
      ),
      nav,
    );
  }

  /** The theme's logo, with its dark-mode image when there is one. */
  function logo() {
    if (!data.logo) return null;
    const { src, srcDark, alt, height } = data.logo;
    const img = h('img', { src, alt, height, style: `height:${height}px` });
    if (!srcDark) return img;
    return h(
      'picture',
      {},
      h('source', { srcset: srcDark, media: '(prefers-color-scheme: dark)' }),
      img,
    );
  }

  function page(current, ...content) {
    app.replaceChildren(header(current), h('main', {}, ...content));
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- overview

  function donut(c) {
    const size = 180;
    const r = 70;
    const circumference = 2 * Math.PI * r;
    const chart = svg('svg', {
      class: 'donut',
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      role: 'img',
      'aria-label': `${c.total} tests: ${STATUSES.map((s) => `${c[s]} ${s}`).join(', ')}`,
    });
    chart.append(
      svg('circle', {
        cx: 90,
        cy: 90,
        r,
        fill: 'none',
        stroke: 'var(--surface-2)',
        'stroke-width': 22,
      }),
    );
    let offset = 0;
    for (const s of STATUSES) {
      if (!c[s]) continue;
      const len = (c[s] / c.total) * circumference;
      chart.append(
        svg('circle', {
          cx: 90,
          cy: 90,
          r,
          fill: 'none',
          stroke: `var(--${s})`,
          'stroke-width': 22,
          'stroke-dasharray': `${len} ${circumference - len}`,
          'stroke-dashoffset': -offset,
          transform: 'rotate(-90 90 90)',
        }),
      );
      offset += len;
    }
    chart.append(
      svg(
        'text',
        {
          x: 90,
          y: 88,
          'text-anchor': 'middle',
          'font-size': 30,
          'font-weight': 700,
        },
        `${pct(c.passed, c.total)}%`,
      ),
      svg(
        'text',
        {
          x: 90,
          y: 112,
          'text-anchor': 'middle',
          'font-size': 12,
          opacity: 0.7,
        },
        'passed',
      ),
    );
    const legend = h('ul', { class: 'legend' });
    for (const s of STATUSES) {
      legend.append(
        h(
          'li',
          {},
          h('span', { class: `swatch bg-${s}` }),
          h('span', {}, `${STATUS_LABEL[s]}: ${c[s]} (${pct(c[s], c.total)}%)`),
        ),
      );
    }
    return h('div', { class: 'donut-wrap' }, chart, legend);
  }

  function kpi(label, value, cls) {
    return h(
      'div',
      { class: `card kpi ${cls || ''}` },
      h('div', { class: 'label' }, label),
      h('div', { class: 'value' }, value),
    );
  }

  function breakdownTable(rows, routeFor) {
    const body = h('tbody');
    for (const { name, scenarios } of rows) {
      const c = counts(scenarios);
      const href = routeFor(name);
      body.append(
        h(
          'tr',
          { class: 'clickable', onclick: () => (location.hash = href) },
          h('td', { class: 'title-cell' }, h('a', { href }, name)),
          h('td', { style: 'width:40%' }, stackedBar(c)),
          h('td', { class: 'num' }, c.passed),
          h('td', { class: 'num' }, c.failed),
          h('td', { class: 'num hide-sm' }, c.flaky),
          h('td', { class: 'num hide-sm' }, c.skipped),
          h('td', { class: 'num' }, c.total),
        ),
      );
    }
    return h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Name'),
            h('th', {}, 'Results'),
            h('th', { class: 'num' }, 'Passed'),
            h('th', { class: 'num' }, 'Failed'),
            h('th', { class: 'num hide-sm' }, 'Flaky'),
            h('th', { class: 'num hide-sm' }, 'Skipped'),
            h('th', { class: 'num' }, 'Total'),
          ),
        ),
        body,
      ),
    );
  }

  function groupBy(scenarios, key, order) {
    return order
      .map((name) => ({
        name,
        scenarios: scenarios.filter((s) => s[key] === name),
      }))
      .filter((g) => g.scenarios.length > 0);
  }

  function renderOverview() {
    const all = data.scenarios;
    const c = counts(all);
    const failures = all.filter(
      (s) => s.status === 'failed' || s.status === 'flaky',
    );
    const slowest = [...all]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);

    const levelCards = h('div', { class: 'grid cols-2' });
    for (const group of groupBy(all, 'level', data.levels)) {
      const lc = counts(group.scenarios);
      levelCards.append(
        h(
          'a',
          {
            class: 'card',
            href: link(['level', group.name]),
            style: 'text-decoration:none;color:inherit;display:block',
          },
          h('h3', {}, `${group.name} tests`),
          h(
            'div',
            { class: 'muted small', style: 'margin-bottom:8px' },
            `${lc.total} tests, ${pct(lc.passed, lc.total)}% passed`,
          ),
          stackedBar(lc),
          h(
            'div',
            { class: 'chips small', style: 'margin-top:8px' },
            STATUSES.filter((s) => lc[s]).map((s) =>
              h('span', { class: `badge ${s}` }, `${lc[s]} ${s}`),
            ),
          ),
        ),
      );
    }

    page(
      'overview',
      h(
        'div',
        { class: 'grid kpis' },
        kpi('Tests', c.total),
        kpi('Passed', c.passed, 'passed'),
        kpi('Failed', c.failed, 'failed'),
        kpi('Flaky', c.flaky, 'flaky'),
        kpi('Skipped', c.skipped, 'skipped'),
        kpi('Duration', fmtDuration(data.duration)),
      ),
      h(
        'div',
        { class: 'grid cols-2' },
        h('section', { class: 'card' }, h('h2', {}, 'Test results'), donut(c)),
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Run details'),
          runDetails(),
        ),
      ),
      h(
        'section',
        {},
        h('h2', { style: 'margin-top:8px' }, 'By level'),
        levelCards,
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'By feature'),
        breakdownTable(groupBy(all, 'feature', data.features), (n) =>
          link(['feature', n]),
        ),
      ),
      h(
        'div',
        { class: 'grid cols-2' },
        h(
          'section',
          { class: 'card' },
          h('h2', {}, `Failures (${failures.length})`),
          failures.length
            ? scenarioList(failures, true)
            : h('p', { class: 'empty' }, 'No failures.'),
        ),
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Slowest tests'),
          scenarioList(slowest, false),
        ),
      ),
    );
  }

  function runDetails() {
    const rows = [
      ['Started', fmtDate(data.startTime)],
      ['Duration', fmtDuration(data.duration)],
      ['Run status', data.runStatus],
      ['Projects', data.projects.join(', ')],
      ...(data.shuffleSeed
        ? [
            [
              'Test order',
              `Shuffled, seed ${data.shuffleSeed}. Run the same order again with --shuffle ${data.shuffleSeed}.`,
            ],
          ]
        : [['Test order', 'Not shuffled']]),
      ...(data.git?.branch ? [['Branch', data.git.branch]] : []),
      ...(data.git?.hash
        ? [['Commit', `${data.git.hash.slice(0, 8)} ${data.git.subject || ''}`]]
        : []),
      ...Object.entries(data.metadata).filter(([k]) => k !== 'ciRun'),
    ];
    const body = h('tbody');
    for (const [k, v] of rows)
      body.append(h('tr', {}, h('td', { class: 'muted' }, k), h('td', {}, v)));
    if (data.metadata.ciRun && /^https:\/\//.test(data.metadata.ciRun)) {
      body.append(
        h(
          'tr',
          {},
          h('td', { class: 'muted' }, 'CI run'),
          h(
            'td',
            {},
            h(
              'a',
              {
                href: data.metadata.ciRun,
                target: '_blank',
                rel: 'noreferrer',
              },
              'Open',
            ),
          ),
        ),
      );
    }
    return h('table', { class: 'headers' }, body);
  }

  function scenarioList(scenarios, withError) {
    const list = h('ul', { class: 'legend', style: 'gap:10px' });
    for (const s of scenarios) {
      list.append(
        h(
          'li',
          { style: 'align-items:flex-start' },
          statusIcon(s.status),
          h(
            'div',
            { style: 'min-width:0' },
            s.describePath.length > 0 &&
              h('span', { class: 'describe-prefix' }, `${describeText(s)} › `),
            h('a', { href: link(['test', s.id]) }, s.title),
            h(
              'div',
              { class: 'muted small' },
              `${s.feature} · ${s.level} · ${fmtDuration(s.duration)}`,
            ),
            withError &&
              firstError(s) &&
              h(
                'div',
                {
                  class: 'small',
                  style: 'color:var(--failed);overflow-wrap:anywhere',
                },
                firstError(s),
              ),
          ),
        ),
      );
    }
    return list;
  }

  // ------------------------------------------------------------ test tables

  function applyFilters(scenarios, { level = true } = {}) {
    const term = filters.search.trim().toLowerCase();
    return scenarios.filter(
      (s) =>
        (filters.status === 'all' || s.status === filters.status) &&
        (!level || filters.level === 'all' || s.level === filters.level) &&
        (!term ||
          [s.title, ...s.describePath, s.file, s.feature, s.spec, ...s.tags]
            .join(' ')
            .toLowerCase()
            .includes(term)),
    );
  }

  function segmented(label, options, value, onChange) {
    const group = h('div', {
      class: 'seg',
      role: 'group',
      'aria-label': label,
    });
    for (const [key, text] of options) {
      group.append(
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': key === value ? 'true' : 'false',
            onclick: () => onChange(key),
          },
          text,
        ),
      );
    }
    return group;
  }

  function toolbar(rerender, { level = true } = {}) {
    const search = h('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Search titles, files, tags',
      'aria-label': 'Search tests',
      value: filters.search,
    });
    search.addEventListener('input', () => {
      filters.search = search.value;
      rerender(true);
    });
    return h(
      'div',
      { class: 'toolbar' },
      segmented(
        'Status',
        [['all', 'All'], ...STATUSES.map((s) => [s, STATUS_LABEL[s]])],
        filters.status,
        (v) => {
          filters.status = v;
          rerender();
        },
      ),
      level &&
        data.levels.length > 1 &&
        segmented(
          'Level',
          [['all', 'All levels'], ...data.levels.map((l) => [l, l])],
          filters.level,
          (v) => {
            filters.level = v;
            rerender();
          },
        ),
      search,
    );
  }

  function scenarioTable(
    scenarios,
    { showFeature = true, showLevel = true } = {},
  ) {
    if (scenarios.length === 0)
      return h('p', { class: 'empty' }, 'No tests match.');
    const body = h('tbody');
    const columns = 5 + (showFeature ? 1 : 0) + (showLevel ? 1 : 0);
    let currentDescribe = null;
    for (const s of scenarios) {
      const href = link(['test', s.id]);
      // A describe heading row starts each run of tests in one describe, so the
      // describe and the test titles under it read as one sentence.
      const describe = describeText(s);
      if (describe && describe !== currentDescribe)
        body.append(
          h(
            'tr',
            { class: 'describe-row' },
            h('td', { colspan: columns }, describe),
          ),
        );
      currentDescribe = describe;
      body.append(
        h(
          'tr',
          {
            class: describe ? 'clickable in-describe' : 'clickable',
            onclick: (e) => e.target.tagName !== 'A' && (location.hash = href),
          },
          h('td', { style: 'width:28px' }, statusIcon(s.status)),
          h('td', { class: 'title-cell' }, h('a', { href }, s.title)),
          showFeature && h('td', { class: 'hide-sm' }, s.feature),
          showLevel &&
            h('td', {}, h('span', { class: 'badge level' }, s.level)),
          h(
            'td',
            { class: 'hide-sm' },
            h(
              'div',
              { class: 'chips' },
              s.runs.map((r) =>
                h(
                  'span',
                  { class: `badge ${r.status}`, title: STATUS_LABEL[r.status] },
                  r.project,
                ),
              ),
            ),
          ),
          h(
            'td',
            { class: 'hide-sm' },
            h(
              'div',
              { class: 'chips' },
              s.tags.map((t) => h('span', { class: 'badge tag' }, t)),
            ),
          ),
          h('td', { class: 'num' }, fmtDuration(s.duration)),
        ),
      );
    }
    return h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { 'aria-label': 'Status' }),
            h('th', {}, 'Test'),
            showFeature && h('th', { class: 'hide-sm' }, 'Feature'),
            showLevel && h('th', {}, 'Level'),
            h('th', { class: 'hide-sm' }, 'Projects'),
            h('th', { class: 'hide-sm' }, 'Tags'),
            h('th', { class: 'num' }, 'Time'),
          ),
        ),
        body,
      ),
    );
  }

  /** Re-renders a filterable page, keeping focus in the search box. */
  function filterable(render) {
    const rerender = (keepFocus) => {
      const active = keepFocus ? document.activeElement?.selectionStart : null;
      render(rerender);
      if (keepFocus) {
        const box = app.querySelector('.search');
        if (box) {
          box.focus();
          if (active !== null && active !== undefined)
            box.setSelectionRange(active, active);
        }
      }
    };
    rerender();
  }

  function renderFeatures() {
    page(
      'features',
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Features'),
        h(
          'p',
          { class: 'muted small', style: 'margin-top:-6px' },
          'A feature holds the tests for one area, at every level.',
        ),
        breakdownTable(groupBy(data.scenarios, 'feature', data.features), (n) =>
          link(['feature', n]),
        ),
      ),
    );
  }

  function levelSummary(scenarios) {
    return h(
      'div',
      { class: 'chips small' },
      data.levels.map((l) => {
        const n = scenarios.filter((s) => s.level === l).length;
        return n ? h('span', { class: 'badge level' }, `${n} ${l}`) : null;
      }),
    );
  }

  function renderFeature(name) {
    const inFeature = data.scenarios.filter((s) => s.feature === name);
    filterable((rerender) => {
      const c = counts(inFeature);
      page(
        'features',
        h(
          'div',
          { class: 'breadcrumb' },
          h('a', { href: link(['features']) }, 'Features'),
          ' › ',
          name,
        ),
        h(
          'section',
          { class: 'card' },
          h(
            'div',
            { class: 'group-head' },
            h('h2', { style: 'margin:0' }, name),
            levelSummary(inFeature),
          ),
          h(
            'div',
            { class: 'muted small', style: 'margin-bottom:8px' },
            `${c.total} tests, ${pct(c.passed, c.total)}% passed`,
          ),
          stackedBar(c),
        ),
        h(
          'section',
          { class: 'card' },
          toolbar(rerender),
          specSections(applyFilters(inFeature)),
        ),
      );
    });
  }

  /**
   * A feature's tests, one section per spec file, by level then file. API and
   * UI specs can share a name, so each heading carries its level.
   */
  function specSections(scenarios) {
    const files = [...new Set(scenarios.map((s) => s.file))].sort((a, b) => {
      const sa = scenarios.find((s) => s.file === a);
      const sb = scenarios.find((s) => s.file === b);
      return sa.level.localeCompare(sb.level) || a.localeCompare(b);
    });
    if (files.length === 0)
      return h('p', { class: 'empty' }, 'No tests match.');
    return files.map((file) => {
      const inSpec = scenarios.filter((s) => s.file === file);
      const c = counts(inSpec);
      return h(
        'section',
        { class: 'group-section' },
        h(
          'div',
          { class: 'group-head' },
          h(
            'h3',
            { style: 'margin:0' },
            inSpec[0].spec,
            ' ',
            h('span', { class: 'badge level' }, inSpec[0].level),
          ),
          h(
            'div',
            { class: 'chips small' },
            `${c.passed}/${c.total} passed`,
            stackedBar(c),
          ),
        ),
        scenarioTable(inSpec, { showFeature: false, showLevel: false }),
      );
    });
  }

  function renderLevel(level) {
    const inLevel = data.scenarios.filter((s) => s.level === level);
    filterable((rerender) => {
      const shown = applyFilters(inLevel, { level: false });
      const sections = groupBy(shown, 'feature', data.features).map((g) => {
        const c = counts(g.scenarios);
        return h(
          'section',
          { class: 'group-section' },
          h(
            'div',
            { class: 'group-head' },
            h(
              'h3',
              { style: 'margin:0' },
              h('a', { href: link(['feature', g.name]) }, g.name),
            ),
            h(
              'div',
              { class: 'chips small' },
              `${c.passed}/${c.total} passed`,
              stackedBar(c),
            ),
          ),
          scenarioTable(g.scenarios, { showFeature: false, showLevel: false }),
        );
      });
      const c = counts(inLevel);
      page(
        `level:${level}`,
        h(
          'section',
          { class: 'card' },
          h('h2', {}, `${level} tests`),
          h(
            'div',
            { class: 'muted small', style: 'margin-bottom:8px' },
            `${c.total} tests, ${pct(c.passed, c.total)}% passed`,
          ),
          stackedBar(c),
        ),
        h(
          'section',
          { class: 'card' },
          toolbar(rerender, { level: false }),
          sections.length
            ? sections
            : h('p', { class: 'empty' }, 'No tests match.'),
        ),
      );
    });
  }

  function renderAllTests() {
    filterable((rerender) => {
      const shown = applyFilters(data.scenarios);
      page(
        'tests',
        h(
          'section',
          { class: 'card' },
          h(
            'h2',
            {},
            `All tests (${shown.length} of ${data.scenarios.length})`,
          ),
          toolbar(rerender),
          scenarioTable(shown),
        ),
      );
    });
  }

  // ---------------------------------------------------------- scenario page

  function errorBox(err) {
    return h(
      'div',
      { class: 'error' },
      err.location && h('div', { class: 'where' }, err.location),
      h('pre', {}, err.message),
      err.snippet &&
        h('pre', { class: 'code', style: 'margin-top:8px' }, err.snippet),
    );
  }

  function bodyText(body) {
    if (body === undefined || body === null || body === '') return null;
    return typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  }

  function copyButton(text) {
    const btn = h('button', { type: 'button', class: 'btn small' }, 'Copy');
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
      } catch {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    });
    return btn;
  }

  function headersTable(headers) {
    const entries = Object.entries(headers || {});
    if (entries.length === 0)
      return h('p', { class: 'muted small' }, 'No headers recorded.');
    const body = h('tbody');
    for (const [k, v] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      body.append(h('tr', {}, h('td', {}, k), h('td', {}, v)));
    }
    return h('table', { class: 'headers' }, body);
  }

  function messageView(message, emptyText) {
    const text = bodyText(message?.body);
    return [
      h(
        'div',
        { class: 'api-section' },
        h('h4', {}, 'Headers'),
        headersTable(message?.headers),
      ),
      h(
        'div',
        { class: 'api-section' },
        h('h4', {}, 'Body', text && copyButton(text)),
        text
          ? h('pre', { class: 'code' }, text)
          : h('p', { class: 'muted small' }, emptyText),
      ),
    ];
  }

  function apiPanel(api) {
    const ok = api.status !== undefined && api.status < 400;
    const content = h('div');
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const views = {
      Request: () => messageView(api.request, 'No body sent.'),
      Response: () =>
        api.response
          ? messageView(api.response, 'No body.')
          : [h('p', { class: 'muted' }, 'No response recorded.')],
    };
    let current = 'Request';
    const draw = () => {
      tabs.replaceChildren(
        ...Object.keys(views).map((name) =>
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': name === current ? 'true' : 'false',
              onclick: () => {
                current = name;
                draw();
              },
            },
            name,
          ),
        ),
      );
      content.replaceChildren(...views[current]());
    };
    draw();
    const fromBrowser = api.source === 'browser';
    return h(
      'div',
      { class: `api-panel ${fromBrowser ? 'browser' : ''}` },
      h(
        'p',
        { class: `api-origin ${fromBrowser ? 'browser' : ''}` },
        fromBrowser
          ? 'Browser API call: made by the page in the browser while this step ran, not by the test.'
          : 'Test API call: made by the test itself.',
      ),
      h(
        'div',
        { class: 'api-summary' },
        h('span', { class: 'method' }, api.method),
        h('span', {}, api.url),
        api.status !== undefined &&
          h(
            'span',
            { class: `http-status ${ok ? 'ok' : 'bad'}` },
            `${api.status}${api.statusText ? ` ${api.statusText}` : ''}`,
          ),
      ),
      api.error && errorBox({ message: api.error }),
      tabs,
      content,
    );
  }

  function evidenceView(item) {
    if (item.kind === 'image' && item.href) {
      return h(
        'figure',
        {},
        h(
          'a',
          { href: item.href, target: '_blank' },
          h('img', { src: item.href, alt: item.name, loading: 'lazy' }),
        ),
        h('figcaption', {}, item.name),
      );
    }
    if (item.kind === 'video' && item.href) {
      return h(
        'figure',
        {},
        h('video', { src: item.href, controls: true, preload: 'metadata' }),
        h('figcaption', {}, item.name),
      );
    }
    if (item.kind === 'trace' && item.href) {
      const absolute = new URL(item.href, location.href).href;
      const served = location.protocol.startsWith('http');
      return h(
        'figure',
        { class: 'card' },
        h('h3', {}, 'Trace'),
        h(
          'div',
          { class: 'chips' },
          h(
            'a',
            { class: 'btn', href: item.href, download: '' },
            'Download trace',
          ),
          served &&
            h(
              'a',
              {
                class: 'btn',
                href: `https://trace.playwright.dev/?trace=${encodeURIComponent(absolute)}`,
                target: '_blank',
                rel: 'noreferrer',
              },
              'Open in trace viewer',
            ),
        ),
        h(
          'figcaption',
          {},
          served
            ? 'The trace viewer opens in a new tab.'
            : 'Open with: npx playwright show-trace <file>',
        ),
      );
    }
    if (item.text !== undefined) {
      return h(
        'details',
        { class: 'card', style: 'grid-column:1/-1' },
        h(
          'summary',
          {},
          item.name,
          h('span', { class: 'muted small' }, ` (${item.contentType})`),
        ),
        h('pre', { class: 'code', style: 'margin-top:8px' }, item.text),
      );
    }
    return h(
      'div',
      { class: 'card' },
      item.href
        ? h('a', { href: item.href, download: '' }, item.name)
        : item.name,
    );
  }

  function hasFailure(node) {
    return node.failed;
  }

  /**
   * One step and its children. Steps on the failure path start open; the rest
   * start closed. API steps and attachments open a detail panel instead.
   */
  function stepItem(node, state) {
    const li = h('li');
    const expandable = node.children.length > 0;
    const detail =
      node.api ||
      node.evidence ||
      (node.error && !node.children.some(hasFailure));
    const childList = expandable ? h('ul') : null;
    const extra = h('div', { class: 'step-extra', hidden: true });
    let open = expandable && node.failed;
    let extraOpen = false;

    const toggle = expandable
      ? h(
          'button',
          {
            type: 'button',
            class: 'toggle',
            'aria-label': `Show substeps of ${node.title}`,
          },
          '▶',
        )
      : h('span', { class: 'toggle-spacer' });

    const setOpen = (value) => {
      open = value;
      if (!childList) return;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      childList.hidden = !open;
    };

    const setExtra = (value) => {
      extraOpen = value;
      extra.hidden = !extraOpen;
      if (extraOpen && extra.childElementCount === 0) {
        if (node.api) extra.append(apiPanel(node.api));
        else if (node.evidence)
          extra.append(
            h('div', { class: 'evidence' }, evidenceView(node.evidence)),
          );
        if (node.error && !node.children.some(hasFailure))
          extra.append(errorBox(node.error));
      }
      opener?.setAttribute('aria-expanded', extraOpen ? 'true' : 'false');
    };

    const opener = detail
      ? h(
          'button',
          {
            type: 'button',
            class: `api-open ${isBrowserCall(node) ? 'browser' : ''}`,
            'aria-expanded': 'false',
          },
          node.api ? 'Request / response' : node.evidence ? 'View' : 'Error',
        )
      : null;
    opener?.addEventListener('click', () => setExtra(!extraOpen));
    if (expandable) toggle.addEventListener('click', () => setOpen(!open));

    const row = h(
      'div',
      { class: `step-row ${node.failed ? 'failed' : ''}` },
      toggle,
      h('span', {
        class: `dot ${node.failed ? 'failed' : ''}`,
        role: 'img',
        'aria-label': node.failed ? 'Failed' : 'Passed',
      }),
      h(
        'span',
        {
          class: `step-kind ${isBrowserCall(node) ? 'browser' : node.kind}`,
          title: isBrowserCall(node)
            ? 'Made by the page in the browser, not by the test'
            : node.kind === 'api'
              ? 'Made by the test'
              : null,
        },
        stepKindLabel(node),
      ),
      h('span', { class: 'step-title' }, stepTitle(node)),
      opener,
      node.location && h('span', { class: 'step-loc' }, node.location),
      h('span', { class: 'step-dur' }, fmtDuration(node.duration)),
    );
    if (expandable) row.addEventListener('dblclick', () => setOpen(!open));
    li.append(row, extra);

    if (childList) {
      for (const child of node.children)
        childList.append(stepItem(child, state));
      li.append(childList);
      setOpen(open);
      state.togglers.push(setOpen);
    }
    // A failed leaf shows its error straight away.
    if (node.failed && !expandable && node.error) setExtra(true);
    return li;
  }

  function stepsView(steps) {
    if (steps.length === 0)
      return h('p', { class: 'muted' }, 'No steps recorded.');
    const state = { togglers: [] };
    const list = h('ul', { class: 'steps' });
    for (const node of steps) list.append(stepItem(node, state));
    const calls = countApiCalls(steps);
    const callSummary = [
      calls.test && `${calls.test} test API call${calls.test === 1 ? '' : 's'}`,
      calls.browser &&
        `${calls.browser} browser API call${calls.browser === 1 ? '' : 's'}`,
    ]
      .filter(Boolean)
      .join(' · ');
    return [
      h(
        'div',
        { class: 'steps-head' },
        h(
          'h3',
          { style: 'margin:0' },
          'Steps',
          callSummary
            ? h('span', { class: 'muted small' }, ` · ${callSummary}`)
            : null,
        ),
        h(
          'div',
          { class: 'chips' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              onclick: () => state.togglers.forEach((f) => f(true)),
            },
            'Expand all',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              onclick: () => state.togglers.forEach((f) => f(false)),
            },
            'Collapse all',
          ),
        ),
      ),
      list,
    ];
  }

  function stepErrors(nodes, into = new Set()) {
    for (const node of nodes) {
      if (node.error) into.add(node.error.message);
      stepErrors(node.children, into);
    }
    return into;
  }

  function attemptView(attempt) {
    // An error a step already shows, at the step that failed, is not repeated.
    const shown = stepErrors(attempt.steps);
    const errors = attempt.errors.filter((e) => !shown.has(e.message));
    return [
      errors.length > 0 &&
        h(
          'section',
          { style: 'margin-bottom:16px' },
          h('h3', {}, 'Error'),
          errors.map(errorBox),
        ),
      h('section', {}, stepsView(attempt.steps)),
      attempt.evidence.length > 0 &&
        h(
          'section',
          { style: 'margin-top:20px' },
          h('h3', {}, 'Evidence'),
          h('div', { class: 'evidence' }, attempt.evidence.map(evidenceView)),
        ),
    ];
  }

  function runView(run) {
    const wrap = h('div');
    let index = run.attempts.length - 1;
    const draw = () => {
      const attempt = run.attempts[index];
      const picker =
        run.attempts.length > 1 &&
        segmented(
          'Attempt',
          run.attempts.map((a, i) => [
            i,
            a.retry === 0 ? 'First run' : `Retry ${a.retry}`,
          ]),
          index,
          (v) => {
            index = v;
            draw();
          },
        );
      wrap.replaceChildren(
        h(
          'div',
          { class: 'meta-row', style: 'margin:0 0 14px' },
          statusBadge(run.status),
          h('span', {}, `Ran ${fmtDate(attempt.startTime)}`),
          h('span', {}, fmtDuration(attempt.duration)),
          picker,
        ),
        ...attemptView(attempt).filter(Boolean),
      );
    };
    draw();
    return wrap;
  }

  function renderScenario(id, projectParam) {
    const s = byId.get(id);
    if (!s) {
      page('tests', h('p', { class: 'empty' }, 'Test not found.'));
      return;
    }
    const runIndex = Math.max(
      0,
      s.runs.findIndex((r) => r.project === projectParam),
    );
    const tabs = h('div', {
      class: 'tabs',
      role: 'tablist',
      'aria-label': 'Projects',
    });
    const body = h('div');
    const select = (i) => {
      tabs.replaceChildren(
        ...s.runs.map((r, j) =>
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': i === j ? 'true' : 'false',
              onclick: () => select(j),
            },
            statusIcon(r.status),
            r.project,
          ),
        ),
      );
      body.replaceChildren(runView(s.runs[i]));
    };
    select(runIndex);

    page(
      `level:${s.level}`,
      h(
        'div',
        { class: 'breadcrumb' },
        h('a', { href: link(['feature', s.feature]) }, s.feature),
        ' › ',
        s.spec,
      ),
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'headline' },
          statusIcon(s.status),
          h(
            'div',
            {},
            s.describePath.length > 0 &&
              h('div', { class: 'describe-eyebrow' }, describeText(s)),
            h('h1', {}, s.title),
          ),
        ),
        s.narrative && h('p', { class: 'narrative' }, s.narrative),
        h(
          'div',
          { class: 'meta-row' },
          h('span', { class: 'badge level' }, s.level),
          h('span', {}, s.feature),
          h('span', { class: 'step-loc' }, `${s.file}:${s.line}`),
          s.tags.length > 0 &&
            h(
              'span',
              { class: 'chips' },
              s.tags.map((t) => h('span', { class: 'badge tag' }, t)),
            ),
          s.issues.length > 0 &&
            h('span', { class: 'chips' }, 'Issues:', s.issues.map(issueLink)),
        ),
      ),
      h('section', { class: 'card' }, s.runs.length > 1 ? tabs : null, body),
    );
  }

  // ------------------------------------------------------------------ router

  function route() {
    const parts = location.hash
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const [view, arg, extra] = parts;
    if (view === 'features') renderFeatures();
    else if (view === 'feature' && arg) renderFeature(arg);
    else if (view === 'level' && arg) renderLevel(arg);
    else if (view === 'tests') renderAllTests();
    else if (view === 'test' && arg) renderScenario(arg, extra);
    else renderOverview();
  }

  window.addEventListener('hashchange', () => {
    filters.status = 'all';
    filters.search = '';
    route();
  });
  route();
})();
