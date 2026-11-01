/* Filing Reader public dashboard: fetches data/*.json (relative URLs) and draws with d3 v7. */
(function () {
  'use strict';

  const errBox = document.getElementById('load-error');
  function fail(msg) {
    errBox.textContent = msg;
    errBox.hidden = false;
  }
  if (typeof window.d3 === 'undefined') {
    fail('The chart library (d3, from cdnjs.cloudflare.com) did not load, so charts and tables cannot be drawn. ' +
      'Reload the page, or read the raw numbers in the data/ folder (JSON).');
    return;
  }

  const FILES = ['meta', 'summary', 'universe', 'index', 'filings_weekly', 'filing_status', 'screening', 'jobs'];
  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
  const fmt = {
    int: d3.format(','),
    pct: d3.format('+.1%'),
    lvl: d3.format('.1f'),
    money: (v) => (v == null ? '' : '$' + new Intl.NumberFormat('en', {notation: 'compact', maximumFractionDigits: 2}).format(v)),
    day: (s) => (s ? d3.utcFormat('%b %-d, %Y')(new Date(s.slice(0, 10) + 'T00:00:00Z')) : '—'),
    shortDay: (s) => d3.utcFormat('%b %-d')(new Date(s.slice(0, 10) + 'T00:00:00Z')),
    stamp: (s) => (s ? d3.utcFormat('%b %-d, %H:%M')(new Date(s)) : ''),
  };
  const D = {};

  Promise.all(FILES.map((f) => fetch(`data/${f}.json`, {cache: 'no-cache'}).then((r) => {
    if (!r.ok) throw new Error(`data/${f}.json: HTTP ${r.status}`);
    return r.json();
  }))).then((all) => {
    FILES.forEach((f, i) => { D[f] = all[i]; });
    drawAll();
    let lastW = window.innerWidth;
    let t = null;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(t);
      t = setTimeout(drawCharts, 150);
    });
  }).catch((e) => fail('Could not load the dashboard data (' + e.message + '). Try reloading the page.'));

  function drawAll() {
    fillText();
    legend('index-legend', indexKeys().map((k) => [k.name, k.color, k.dash]));
    legend('filings-legend', FILING_KEYS.map((k, i) => [k.name, SERIES[i]]));
    drawCharts();
    drawJobs();
    drawStatus();
    setupCompanies();
  }

  function drawCharts() {
    drawIndex(document.getElementById('index-chart'));
    drawFilings(document.getElementById('filings-chart'));
    drawScreening(document.getElementById('screening-chart'));
  }

  /* ---------- text values ---------- */
  function fillText() {
    const m = D.meta, s = D.summary;
    const vals = {
      companies: fmt.int(s.companies), parsed: fmt.int(s.parsed), failed: fmt.int(s.failed),
      index_change: s.index_change == null ? '—' : fmt.pct(s.index_change), index_since: fmt.day(s.index_since),
      data_as_of: fmt.day(m.data_as_of), generated_at: m.generated_at ? fmt.stamp(m.generated_at) + ' UTC' : '—',
      snapshot_date: fmt.day(m.snapshot_date), filings_since: fmt.day(m.filings_since),
    };
    document.querySelectorAll('[data-k]').forEach((el) => {
      if (el.dataset.k in vals) el.textContent = vals[el.dataset.k];
    });
    document.getElementById('tile-failed').classList.toggle('fr-bad', s.failed > 0);
    if (m.min_market_cap && m.max_market_cap) {
      document.getElementById('tile-companies-sub').textContent =
        `${fmt.money(m.min_market_cap)} to ${fmt.money(m.max_market_cap)}, split into three size groups`;
    }
    if (m.filings_since) {
      document.getElementById('tile-parsed-sub').textContent =
        `Annual, quarterly and earnings releases since ${fmt.day(m.filings_since)}`;
    }
    const note = document.getElementById('iwm-note');
    note.textContent = m.iwm_days >= m.iwm_min_days
      ? 'The Russell 2000 (IWM, dashed) is rebased to the all-company index on its first day with a price.'
      : `The Russell 2000 benchmark (IWM) appears once daily price capture has ${m.iwm_min_days} days of it ` +
        `(${m.iwm_days} so far).`;
  }

  function legend(id, items) {
    const box = document.getElementById(id);
    box.replaceChildren();
    items.forEach(([name, color, dash]) => {
      const s = document.createElement('span');
      const i = document.createElement('i');
      if (dash) i.className = 'dash'; else i.style.background = color;
      s.append(i, document.createTextNode(name));
      box.appendChild(s);
    });
  }

  /* ---------- shared chart helpers ---------- */
  function empty(el, msg) {
    el.replaceChildren();
    const p = document.createElement('p');
    p.className = 'fr-empty';
    p.textContent = msg;
    el.appendChild(p);
  }
  function textWidth(svg, s) {
    const t = svg.append('text').attr('font-size', 11).text(s);
    const w = t.node().getComputedTextLength();
    t.remove();
    return w;
  }
  function tipFor(el) {
    const tip = document.createElement('div');
    tip.className = 'fr-tip';
    tip.hidden = true;
    tip.setAttribute('role', 'presentation');
    el.appendChild(tip);
    return tip;
  }
  function fillTip(tip, title, rows) {
    tip.replaceChildren();
    const d = document.createElement('div');
    d.className = 'd';
    d.textContent = title;
    tip.appendChild(d);
    rows.forEach(([color, text]) => {
      const r = document.createElement('div');
      r.className = 'r';
      const i = document.createElement('i');
      i.style.background = color;
      r.append(i, document.createTextNode(text));
      tip.appendChild(r);
    });
    tip.hidden = false;
  }
  /* Place the tooltip near (x, y) in the chart box's pixels, always fully inside the box. */
  function placeTip(el, tip, x, y) {
    const w = tip.offsetWidth, h = tip.offsetHeight, bw = el.clientWidth, bh = el.clientHeight;
    let left = x + 12;
    if (left + w > bw) left = x - 12 - w;
    left = Math.max(0, Math.min(bw - w, left));
    let top = y - h - 10;
    if (top < 0) top = y + 14;
    top = Math.max(0, Math.min(Math.max(0, bh - h), top));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  function svgScale(el, svg, W) {
    const box = el.getBoundingClientRect(), sv = svg.node().getBoundingClientRect();
    return {s: sv.width / W, dx: sv.left - box.left, dy: sv.top - box.top};
  }
  function yAxis(svg, y, left, right, W, fmtTick) {
    const ticks = y.ticks(4);
    svg.append('g').selectAll('line').data(ticks).join('line')
      .attr('x1', left).attr('x2', W - right).attr('y1', (t) => y(t)).attr('y2', (t) => y(t))
      .style('stroke', 'var(--grid)');
    svg.append('g').selectAll('text').data(ticks).join('text')
      .attr('x', left - 6).attr('y', (t) => y(t)).attr('dy', '0.32em').attr('text-anchor', 'end')
      .attr('font-size', 11).style('fill', 'var(--ink-muted)').text(fmtTick);
  }

  /* ---------- index line chart ---------- */
  function indexKeys() {
    const keys = [
      {k: 'small', name: 'Small', color: SERIES[0]},
      {k: 'mid', name: 'Mid', color: SERIES[1]},
      {k: 'large', name: 'Large', color: SERIES[2]},
    ];
    if (D.meta.iwm_days >= D.meta.iwm_min_days && D.index.some((r) => r.iwm != null)) {
      keys.push({k: 'iwm', name: 'Russell 2000 (IWM)', color: 'var(--bench)', dash: true});
    }
    return keys;
  }

  function drawIndex(el) {
    if (!D.index.length) return empty(el, 'No prices captured yet.');
    el.replaceChildren();
    const keys = indexKeys();
    const rows = D.index.map((r) => ({date: new Date(r.date + 'T00:00:00Z'), raw: r}));
    const W = Math.max(280, el.clientWidth), H = 240, top = 10, bottom = 24;
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', 'Equal-weighted price index of the tracked companies by size group, rebased to 100');
    const vals = rows.flatMap((r) => keys.map((k) => r.raw[k.k]).filter((v) => v != null));
    const y = d3.scaleLinear(d3.extent(vals.concat([100])), [H - bottom, top]).nice();
    const left = textWidth(svg, d3.format('.0f')(y.domain()[1])) + 10;
    const last = (k) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].raw[k] != null) return rows[i]; return null; };
    const narrow = W < 480;
    const endLabel = (k) => (narrow ? '' : k.name.replace(' (IWM)', '') + ' ') + fmt.lvl(last(k.k).raw[k.k]);
    const right = d3.max(keys, (k) => textWidth(svg, endLabel(k))) + 16;
    const x = d3.scaleUtc(d3.extent(rows, (r) => r.date), [left, W - right]);
    yAxis(svg, y, left, right, W, (t) => d3.format('.0f')(t));
    svg.append('line').attr('x1', left).attr('x2', W - right).attr('y1', y(100)).attr('y2', y(100))
      .style('stroke', 'var(--axis)').attr('stroke-dasharray', '2 3');
    const xt = x.ticks(Math.max(2, Math.floor((W - left - right) / 90)));
    svg.append('g').selectAll('text').data(xt).join('text')
      .attr('x', (t) => x(t)).attr('y', H - 6).attr('text-anchor', 'middle')
      .attr('font-size', 11).style('fill', 'var(--ink-muted)').text((t) => d3.utcFormat('%b %-d')(t));
    keys.forEach((k) => {
      svg.append('path').datum(rows).attr('fill', 'none').style('stroke', k.color)
        .attr('stroke-width', k.dash ? 1.5 : 2).attr('stroke-dasharray', k.dash ? '5 4' : null)
        .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
        .attr('d', d3.line().defined((r) => r.raw[k.k] != null).x((r) => x(r.date)).y((r) => y(r.raw[k.k])));
    });
    const ends = keys.map((k) => ({k, y: y(last(k.k).raw[k.k])})).sort((a, b) => a.y - b.y);
    for (let j = 1; j < ends.length; j++) if (ends[j].y - ends[j - 1].y < 13) ends[j].y = ends[j - 1].y + 13;
    svg.append('g').selectAll('line').data(ends).join('line')
      .attr('x1', W - right + 2).attr('x2', W - right + 8).attr('y1', (e) => e.y).attr('y2', (e) => e.y)
      .style('stroke', (e) => e.k.color).attr('stroke-width', 2).attr('stroke-dasharray', (e) => (e.k.dash ? '2 2' : null));
    svg.append('g').selectAll('text').data(ends).join('text')
      .attr('x', W - right + 11).attr('y', (e) => e.y).attr('dy', '0.32em').attr('font-size', 11)
      .style('fill', 'var(--ink-2)').text((e) => endLabel(e.k));

    const tip = tipFor(el);
    const dots = svg.append('g').attr('pointer-events', 'none');
    const rule = svg.append('line').attr('y1', top).attr('y2', H - bottom).style('stroke', 'var(--axis)').attr('visibility', 'hidden');
    const bis = d3.bisector((r) => r.date).center;
    const hide = () => { tip.hidden = true; rule.attr('visibility', 'hidden'); dots.selectAll('circle').remove(); };
    svg.append('rect').attr('x', left).attr('y', 0).attr('width', Math.max(0, W - left - right)).attr('height', H - bottom)
      .attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const [mx] = d3.pointer(ev);
        const r = rows[bis(rows, x.invert(mx))];
        const shown = keys.filter((k) => r.raw[k.k] != null);
        rule.attr('x1', x(r.date)).attr('x2', x(r.date)).attr('visibility', 'visible');
        dots.selectAll('circle').data(shown).join('circle').attr('r', 4).attr('cx', x(r.date))
          .attr('cy', (k) => y(r.raw[k.k])).style('fill', (k) => k.color).style('stroke', 'var(--panel)').attr('stroke-width', 2);
        fillTip(tip, fmt.day(r.raw.date), shown.map((k) => [k.color, `${k.name} ${fmt.lvl(r.raw[k.k])}`])
          .concat([['transparent', `${fmt.int(r.raw.companies_priced)} companies priced`]]));
        const p = svgScale(el, svg, W);
        placeTip(el, tip, x(r.date) * p.s + p.dx, y(r.raw.mid) * p.s + p.dy);
      })
      .on('pointerleave', hide);
  }

  /* ---------- filings per week ---------- */
  const FILING_KEYS = [
    {k: 'annual_reports', name: 'Annual reports'},
    {k: 'quarterly_reports', name: 'Quarterly reports'},
    {k: 'earnings_releases', name: 'Earnings releases'},
  ];

  function drawFilings(el) {
    const rows = D.filings_weekly;
    if (!rows.length) return empty(el, 'No filings parsed yet.');
    el.replaceChildren();
    const keys = FILING_KEYS.map((k) => k.k);
    const W = Math.max(280, el.clientWidth), H = 240, top = 10, bottom = 24;
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', 'Filings read per week by form');
    const stack = d3.stack().keys(keys)(rows);
    const total = (r) => keys.reduce((s, k) => s + r[k], 0);
    const y = d3.scaleLinear([0, Math.max(1, d3.max(rows, total))], [H - bottom, top]).nice();
    const left = textWidth(svg, d3.format(',')(y.domain()[1])) + 10;
    const x = d3.scaleBand(rows.map((r) => r.week), [left, W - 4]).padding(0.2);
    yAxis(svg, y, left, 4, W, d3.format(','));
    const every = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((W - left) / 70))));
    svg.append('g').selectAll('text').data(rows.filter((r, i) => i % every === 0)).join('text')
      .attr('x', (r) => x(r.week) + x.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle')
      .attr('font-size', 11).style('fill', 'var(--ink-muted)').text((r) => fmt.shortDay(r.week));
    stack.forEach((layer, i) => {
      svg.append('g').style('fill', SERIES[i]).selectAll('rect').data(layer).join('rect')
        .attr('x', (s) => x(s.data.week)).attr('width', x.bandwidth())
        .attr('y', (s) => y(s[1])).attr('height', (s) => Math.max(0, y(s[0]) - y(s[1])));
    });
    svg.append('line').attr('x1', left).attr('x2', W - 4).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--axis)');
    const tip = tipFor(el);
    const step = x.step();
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', (r) => x(r.week) - (step - x.bandwidth()) / 2).attr('width', step).attr('y', 0).attr('height', H - bottom)
      .attr('fill', 'transparent')
      .on('pointermove', (ev, r) => {
        fillTip(tip, 'Week of ' + fmt.day(r.week),
          FILING_KEYS.map((k, i) => [SERIES[i], `${k.name} ${fmt.int(r[k.k])}`]));
        const p = svgScale(el, svg, W);
        placeTip(el, tip, (x(r.week) + x.bandwidth() / 2) * p.s + p.dx, y(total(r)) * p.s + p.dy);
      })
      .on('pointerleave', () => { tip.hidden = true; });
  }

  /* ---------- screening bars ---------- */
  function drawScreening(el) {
    const rows = D.screening;
    if (!rows.length) return empty(el, 'No company-list build yet.');
    el.replaceChildren();
    const W = Math.max(280, el.clientWidth), rowH = 22, H = rows.length * rowH + 4;
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', 'Candidates by screening outcome');
    const maxN = d3.max(rows, (r) => r.companies);
    const labelW = Math.min(W * 0.48, d3.max(rows, (r) => textWidth(svg, r.step)) + 10);
    const numW = textWidth(svg, fmt.int(maxN)) + 8;
    const x = d3.scaleLinear([0, maxN], [labelW, W - numW]);
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (r, i) => `translate(0,${i * rowH + 2})`);
    g.append('title').text((r) => `${r.step}: ${fmt.int(r.companies)}`);
    g.append('text').attr('x', labelW - 8).attr('y', rowH / 2).attr('dy', '0.32em').attr('text-anchor', 'end').attr('font-size', 11)
      .style('fill', (r) => (r.step === 'Included' ? 'var(--ink)' : 'var(--ink-2)'))
      .style('font-weight', (r) => (r.step === 'Included' ? 600 : null)).text((r) => r.step);
    g.append('rect').attr('x', labelW).attr('y', 4).attr('height', rowH - 8).attr('rx', 2)
      .attr('width', (r) => Math.max(1, x(r.companies) - labelW))
      .style('fill', (r) => (r.step === 'Included' ? SERIES[0] : 'var(--bar-muted)'));
    g.append('text').attr('x', (r) => x(r.companies) + 4).attr('y', rowH / 2).attr('dy', '0.32em').attr('font-size', 11)
      .style('fill', 'var(--ink-2)').text((r) => fmt.int(r.companies));
  }

  /* ---------- tables ---------- */
  function td(text, cls) {
    const c = document.createElement('td');
    c.textContent = text;
    if (cls) c.className = cls;
    return c;
  }

  function drawJobs() {
    const tb = document.getElementById('jobs-body');
    tb.replaceChildren();
    D.jobs.forEach((r) => {
      const tr = document.createElement('tr');
      const st = document.createElement('td');
      const pill = document.createElement('span');
      const ok = r.status === 'ok', idle = r.status === 'not run yet';
      pill.className = 'fr-pill ' + (ok ? 'ok' : idle ? 'idle' : 'bad');
      pill.textContent = (ok ? '✓ ' : idle ? '' : '✕ ') + r.status;
      st.appendChild(pill);
      tr.append(td(r.name), td(r.last_run ? fmt.stamp(r.last_run) : '—'), st,
        td(r.last_ok ? fmt.stamp(r.last_ok) : idle ? '—' : 'none', 'opt'));
      tb.appendChild(tr);
      if (r.error) {
        tr.className = 'has-err';
        const er = document.createElement('tr');
        const c = td(r.error, 'err');
        c.colSpan = 4;
        er.appendChild(c);
        tb.appendChild(er);
      }
    });
  }

  function drawStatus() {
    const tb = document.getElementById('status-body');
    tb.replaceChildren();
    D.filing_status.forEach((r) => {
      const tr = document.createElement('tr');
      tr.append(td(r.form), td(fmt.int(r.parsed), 'n'), td(fmt.int(r.failed), r.failed > 0 ? 'n fr-bad' : 'n'),
        td(fmt.int(r.skipped), 'n'));
      tb.appendChild(tr);
    });
  }

  const NUMERIC = new Set(['market_cap', 'avg_daily_dollar_volume', 'annual_reports', 'quarterly_reports', 'earnings_releases']);
  const SIZE_ORDER = {Small: 1, Mid: 2, Large: 3};
  const sort = {key: 'market_cap', dir: -1};

  function setupCompanies() {
    document.querySelectorAll('button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.sort;
        sort.dir = sort.key === k ? -sort.dir : (NUMERIC.has(k) || k === 'last_filing' ? -1 : 1);
        sort.key = k;
        document.querySelectorAll('button[data-sort]').forEach((b) => {
          b.closest('th').setAttribute('aria-sort', b.dataset.sort === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
        });
        drawCompanies();
      });
    });
    document.getElementById('company-search').addEventListener('input', drawCompanies);
    drawCompanies();
  }

  function drawCompanies() {
    const tb = document.getElementById('companies-body');
    const q = document.getElementById('company-search').value.trim().toLowerCase();
    const rows = D.universe.filter((r) => !q || `${r.ticker} ${r.name} ${r.sector} ${r.size_group}`.toLowerCase().includes(q));
    const k = sort.key, dir = sort.dir;
    const val = (r) => (k === 'size_group' ? SIZE_ORDER[r[k]] || 0 : r[k]);
    rows.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = NUMERIC.has(k) || k === 'size_group' ? (va ?? -Infinity) - (vb ?? -Infinity) : String(va).localeCompare(String(vb));
      return c * dir || a.ticker.localeCompare(b.ticker);
    });
    const frag = document.createDocumentFragment();
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.append(td(r.ticker), td(r.name, 'wrap'), td(r.size_group), td(r.sector),
        td(fmt.money(r.market_cap), 'n'), td(fmt.money(r.avg_daily_dollar_volume), 'n'),
        td(fmt.int(r.annual_reports), 'n'), td(fmt.int(r.quarterly_reports), 'n'), td(fmt.int(r.earnings_releases), 'n'),
        td(r.last_filing ? fmt.day(r.last_filing) : ''));
      frag.appendChild(tr);
    });
    tb.replaceChildren(frag);
    document.getElementById('company-count').textContent =
      q ? `${fmt.int(rows.length)} of ${fmt.int(D.universe.length)} companies` : `${fmt.int(rows.length)} companies`;
  }
})();
