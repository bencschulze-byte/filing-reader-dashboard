/* Filing Reader private view: fetches payload.json (encrypted), derives the key from the password with
   PBKDF2-HMAC-SHA256 and decrypts with AES-256-GCM, all with WebCrypto; then draws with d3 v7.
   Nothing is stored: the key and the decrypted data live only in this page's memory (the origin
   bencschulze-byte.github.io is shared with every Pages site of the account), so a reload asks for the
   password again; "Lock" reloads the page, dropping both.
   Parameters must match src/filing_reader/dashboard/crypto.py. */
(function () {
  'use strict';

  const FRCrypto = {
    FORMAT: 'filing-reader-private',
    VERSION: 1,
    MIN_ITERATIONS: 600000,
    b64d(s) {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    b64e(bytes) {
      let bin = '';
      bytes.forEach((b) => { bin += String.fromCharCode(b); });
      return btoa(bin);
    },
    check(env) {
      if (env.format !== FRCrypto.FORMAT || env.v !== FRCrypto.VERSION || env.kdf !== 'PBKDF2' ||
          env.hash !== 'SHA-256' || env.cipher !== 'AES-256-GCM' || env.compression !== 'gzip' ||
          !(env.iterations >= FRCrypto.MIN_ITERATIONS)) {
        throw new Error('unsupported payload format');
      }
    },
    /* 32 raw key bytes from the password (NFC-normalised, as crypto.py does) and the payload's salt. */
    async deriveBits(password, env) {
      FRCrypto.check(env);
      const subtle = globalThis.crypto.subtle;
      const pw = new TextEncoder().encode(String(password).normalize('NFC'));
      const base = await subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits(
        {name: 'PBKDF2', hash: 'SHA-256', salt: FRCrypto.b64d(env.salt), iterations: env.iterations}, base, 256);
      return new Uint8Array(bits);
    },
    /* The payload's JSON text; rejects (OperationError) on a wrong key or altered data. */
    async decrypt(keyBytes, env) {
      FRCrypto.check(env);
      const subtle = globalThis.crypto.subtle;
      const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
      const plain = await subtle.decrypt(
        {name: 'AES-GCM', iv: FRCrypto.b64d(env.nonce), tagLength: 128,
          additionalData: new TextEncoder().encode(`${FRCrypto.FORMAT}/v${FRCrypto.VERSION}`)},
        key, FRCrypto.b64d(env.ciphertext));
      const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    },
  };
  if (typeof module !== 'undefined' && module.exports) {  // tests (node) use the crypto part only
    module.exports = FRCrypto;
    return;
  }

  const $ = (id) => document.getElementById(id);
  const errBox = $('load-error');
  function fail(msg) {
    errBox.textContent = msg;
    errBox.hidden = false;
  }

  if (!(globalThis.crypto && crypto.subtle) || typeof DecompressionStream === 'undefined') {
    fail('This browser cannot decrypt the private view (it needs WebCrypto and DecompressionStream, ' +
      'available in current Chrome, Edge, Firefox and Safari over https).');
    return;
  }
  if (typeof window.d3 === 'undefined') {
    fail('The chart library (d3, from cdnjs.cloudflare.com) did not load. Reload the page.');
    return;
  }

  let env = null;
  const form = $('unlock'), msg = $('unlock-msg'), btn = $('unlock-btn'), pw = $('password');

  fetch('payload.json', {cache: 'no-cache'}).then((r) => {
    if (r.status === 404) throw new Error('not-published');
    if (!r.ok) throw new Error(`payload.json: HTTP ${r.status}`);
    return r.json();
  }).then(async (e) => {
    env = e;
    FRCrypto.check(env);
    form.hidden = false;
    pw.focus();
  }).catch((e) => fail(e.message === 'not-published'
    ? 'No private data is published. The private view is not configured.'
    : 'Could not load the private data (' + e.message + '). Try reloading the page.'));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!env || !pw.value) return;
    btn.disabled = true;
    msg.textContent = 'Unlocking…';
    let text = null;
    try {
      const bits = await FRCrypto.deriveBits(pw.value, env);
      try {
        text = await FRCrypto.decrypt(bits, env);
      } catch (e) {
        msg.textContent = 'Wrong password: the data could not be decrypted. Try again.';
      }
    } catch (e) {
      msg.textContent = 'Could not unlock (' + e.message + ').';
    }
    btn.disabled = false;
    if (text !== null) {
      pw.value = '';
      msg.textContent = '';
      show(text);
    } else {
      pw.select();
    }
  });

  $('lock').addEventListener('click', () => {
    window.location.reload();  // drops the decrypted data and the key from memory
  });

  /* ---------- rendering ---------- */
  const D = {};
  const DIRS = ['up', 'flat', 'down'];
  const DIR_COLOR = {up: 'var(--series-3)', flat: 'var(--bar-muted)', down: 'var(--series-2)'};
  const fmt = {
    int: d3.format(','),
    prob: d3.format('.2f'),
    score: d3.format('+.3f'),
    pct: d3.format('.1%'),
    ret: (v) => (v == null ? '—' : d3.format('+.2%')(v)),
    usd: d3.format('$,.2f'),
    day: (s) => (s ? d3.utcFormat('%b %-d, %Y')(new Date(s.slice(0, 10) + 'T00:00:00Z')) : '—'),
    stamp: (s) => (s ? d3.utcFormat('%b %-d, %Y %H:%M')(new Date(s)) : '—'),
  };
  const armLabel = (a) => {
    const s = String(a).replace(/^baseline_/, '').replace(/_/g, ' ');
    return s === 'sue' ? 'SUE' : s.charAt(0).toUpperCase() + s.slice(1);
  };

  function show(text) {
    Object.assign(D, JSON.parse(text));
    form.hidden = true;
    $('lock').hidden = false;
    $('content').hidden = false;
    drawAll();
    let lastW = window.innerWidth, t = null;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(t);
      t = setTimeout(drawCharts, 150);
    });
  }

  function td(text, cls) {
    const c = document.createElement('td');
    c.textContent = text;
    if (cls) c.className = cls;
    return c;
  }
  function pill(dir) {
    const c = document.createElement('td');
    const s = document.createElement('span');
    s.className = 'fr-pill dir-' + dir;
    s.textContent = dir;
    c.appendChild(s);
    return c;
  }
  function emptyRow(tb, cols, text) {
    const tr = document.createElement('tr');
    const c = td(text, 'fr-empty-cell');
    c.colSpan = cols;
    tr.appendChild(c);
    tb.replaceChildren(tr);
  }
  function daysFromToday(day) {
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((new Date(day + 'T00:00:00Z') - today) / 86400000);
  }

  function drawAll() {
    const P = D.predictions;
    const soon = D.upcoming.filter((u) => !u.release_on_file && daysFromToday(u.expected) >= 0 && daysFromToday(u.expected) <= 14);
    const vals = {
      data_as_of: D.data_as_of ? fmt.stamp(D.data_as_of) + ' UTC' : '—', generated_at: fmt.stamp(D.generated_at) + ' UTC',
      n_predictions: fmt.int(P.length), n_companies: fmt.int(new Set(P.map((p) => p.cik)).size),
      n_outcomes: fmt.int(D.outcomes.filter((o) => o.horizon === 'ann').length), n_soon: fmt.int(soon.length),
    };
    document.querySelectorAll('[data-k]').forEach((el) => {
      if (el.dataset.k in vals) el.textContent = vals[el.dataset.k];
    });
    $('tile-pred-sub').textContent = `${new Set(P.map((p) => p.arm)).size} arms`;
    if (D.issue_count) {
      $('issues').textContent = `${D.issue_count} ledger line(s) could not be read and were left out: ` + D.issues.slice(0, 5).join('; ');
      $('issues').hidden = false;
    }
    const armSel = $('pred-arm');
    [...new Set(P.map((p) => p.arm))].sort().forEach((a) => {
      const o = document.createElement('option');
      o.value = a;
      o.textContent = armLabel(a);
      armSel.appendChild(o);
    });
    legend();
    setupPredictions();
    drawSkips();
    setupUpcoming();
    drawScoreboard();
    drawOutcomes();
    drawCharts();
  }
  function drawCharts() {
    drawDirChart();
    drawSpend();
  }

  function legend() {
    const box = $('dir-legend');
    box.replaceChildren();
    DIRS.forEach((d) => {
      const s = document.createElement('span');
      const i = document.createElement('i');
      i.style.background = DIR_COLOR[d];
      s.append(i, document.createTextNode(d));
      box.appendChild(s);
    });
  }

  /* ---------- predictions ---------- */
  const NUMERIC = new Set(['probability', 'score']);
  const sort = {key: 'created_at', dir: -1};
  function filtered() {
    const q = $('pred-search').value.trim().toLowerCase(), arm = $('pred-arm').value, dir = $('pred-dir').value;
    return D.predictions.filter((p) => (!arm || p.arm === arm) && (!dir || p.direction === dir) &&
      (!q || `${p.ticker} ${p.target_period} ${armLabel(p.arm)} ${p.rationale || ''}`.toLowerCase().includes(q)));
  }
  function setupPredictions() {
    document.querySelectorAll('#predictions button[data-sort]').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.sort;
        sort.dir = sort.key === k ? -sort.dir : (NUMERIC.has(k) || k.endsWith('_at') ? -1 : 1);
        sort.key = k;
        document.querySelectorAll('#predictions button[data-sort]').forEach((x) => {
          x.closest('th').setAttribute('aria-sort', x.dataset.sort === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
        });
        drawPredictions();
      });
    });
    ['pred-search', 'pred-arm', 'pred-dir'].forEach((id) => $(id).addEventListener('input', () => {
      drawPredictions();
      drawCounts();
      drawDirChart();
    }));
    drawPredictions();
    drawCounts();
  }
  function drawPredictions() {
    const rows = filtered();
    const k = sort.key, dir = sort.dir;
    rows.sort((a, b) => {
      const c = NUMERIC.has(k) ? a[k] - b[k] : String(a[k]).localeCompare(String(b[k]));
      return c * dir || a.prediction_id.localeCompare(b.prediction_id);
    });
    const frag = document.createDocumentFragment();
    rows.forEach((p) => {
      const tr = document.createElement('tr');
      tr.title = p.prediction_id;
      tr.append(td(p.ticker), td(armLabel(p.arm)), pill(p.direction), td(fmt.prob(p.probability), 'n'),
        td(fmt.score(p.score), 'n'), td(p.target_period), td(fmt.stamp(p.created_at)), td(fmt.day(p.filing_accepted_at)),
        td(p.rationale || '', 'wrap opt small'));
      frag.appendChild(tr);
    });
    $('pred-body').replaceChildren(frag);
    if (!rows.length) emptyRow($('pred-body'), 9, D.predictions.length ? 'No prediction matches the filters.' : 'No predictions yet.');
    $('pred-count').textContent = rows.length === D.predictions.length
      ? `${fmt.int(rows.length)} predictions` : `${fmt.int(rows.length)} of ${fmt.int(D.predictions.length)} predictions`;
  }
  function countsByArm(rows) {
    const m = new Map();
    rows.forEach((p) => {
      if (!m.has(p.arm)) m.set(p.arm, {arm: p.arm, up: 0, flat: 0, down: 0});
      m.get(p.arm)[p.direction] += 1;
    });
    return [...m.values()].sort((a, b) => a.arm.localeCompare(b.arm));
  }
  function drawCounts() {
    const rows = countsByArm(filtered());
    const tb = $('counts-body');
    tb.replaceChildren();
    const tot = {up: 0, flat: 0, down: 0};
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      DIRS.forEach((d) => { tot[d] += r[d]; });
      tr.append(td(armLabel(r.arm)), td(fmt.int(r.up), 'n'), td(fmt.int(r.flat), 'n'), td(fmt.int(r.down), 'n'),
        td(fmt.int(r.up + r.flat + r.down), 'n'));
      tb.appendChild(tr);
    });
    if (!rows.length) { emptyRow(tb, 5, 'No predictions.'); return; }
    const tr = document.createElement('tr');
    tr.className = 'total';
    tr.append(td('All arms'), td(fmt.int(tot.up), 'n'), td(fmt.int(tot.flat), 'n'), td(fmt.int(tot.down), 'n'),
      td(fmt.int(tot.up + tot.flat + tot.down), 'n'));
    tb.appendChild(tr);
  }
  function drawDirChart() {
    const el = $('dir-chart');
    el.replaceChildren();
    const rows = countsByArm(filtered());
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'fr-empty';
      p.textContent = 'No predictions match.';
      el.appendChild(p);
      return;
    }
    const W = Math.max(280, el.clientWidth), rowH = 26, labelW = 96, H = rows.length * rowH + 4;
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', 'Predictions by arm and direction');
    const max = d3.max(rows, (r) => r.up + r.flat + r.down);
    const x = d3.scaleLinear().domain([0, max]).range([labelW, W - 40]);
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (r, i) => `translate(0,${i * rowH})`);
    g.append('text').attr('x', 0).attr('y', rowH / 2).attr('dy', '0.32em').attr('font-size', 12)
      .style('fill', 'var(--ink-2)').text((r) => armLabel(r.arm));
    g.each(function (r) {
      let acc = 0;
      DIRS.forEach((d) => {
        if (!r[d]) return;
        d3.select(this).append('rect').attr('x', x(acc)).attr('y', 4).attr('height', rowH - 8)
          .attr('width', Math.max(1, x(acc + r[d]) - x(acc) - 1)).style('fill', DIR_COLOR[d])
          .append('title').text(`${armLabel(r.arm)}, ${d}: ${r[d]}`);
        acc += r[d];
      });
      d3.select(this).append('text').attr('x', x(acc) + 4).attr('y', rowH / 2).attr('dy', '0.32em').attr('font-size', 11)
        .style('fill', 'var(--ink-2)').text(fmt.int(acc));
    });
  }
  function drawSkips() {
    const tb = $('skips-body');
    tb.replaceChildren();
    D.skips.forEach((s) => {
      const tr = document.createElement('tr');
      tr.append(td(armLabel(s.arm)), td(s.reason, 'wrap'), td(fmt.int(s.n), 'n'));
      tb.appendChild(tr);
    });
    if (!D.skips.length) emptyRow(tb, 3, 'None.');
  }

  /* ---------- upcoming ---------- */
  function setupUpcoming() {
    $('up-hide-done').addEventListener('change', drawUpcoming);
    drawUpcoming();
  }
  function drawUpcoming() {
    const hide = $('up-hide-done').checked;
    const rows = D.upcoming.filter((u) => !hide || !u.release_on_file);
    const frag = document.createDocumentFragment();
    rows.forEach((u) => {
      const tr = document.createElement('tr');
      const days = daysFromToday(u.expected);
      const st = u.release_on_file ? `On file ${fmt.day(u.release_on_file)}` : days < 0 ? 'Not seen yet' : 'Expected';
      tr.append(td(u.ticker), td(u.name, 'wrap'), td(u.target_period), td(fmt.day(u.quarter_end_est), 'opt'),
        td(fmt.day(u.expected)), td(u.release_on_file ? '' : `${days} d`, days < 0 && !u.release_on_file ? 'n fr-bad' : 'n'),
        td(u.basis, 'opt small'), td(st));
      frag.appendChild(tr);
    });
    $('up-body').replaceChildren(frag);
    if (!rows.length) emptyRow($('up-body'), 8, D.upcoming.length ? 'Every target release is on file.' : 'No predicted companies yet.');
    $('up-count').textContent = `${fmt.int(rows.length)} of ${fmt.int(D.upcoming.length)} companies`;
  }

  /* ---------- outcomes ---------- */
  function drawScoreboard() {
    const tb = $('score-body');
    tb.replaceChildren();
    D.scoreboard.forEach((s) => {
      const tr = document.createElement('tr');
      tr.append(td(armLabel(s.arm)), td(fmt.int(s.scored), 'n'), td(s.hit_rate == null ? '—' : fmt.pct(s.hit_rate), 'n'),
        td(fmt.ret(s.mean_after_up), 'n'), td(fmt.ret(s.mean_after_down), 'n'),
        td(s.rank_ic == null ? '—' : d3.format('+.3f')(s.rank_ic), 'n'));
      tb.appendChild(tr);
    });
    if (!D.scoreboard.length) emptyRow(tb, 6, 'No outcomes yet. Scoring starts once the target announcements have happened and their reaction windows have closed.');
  }
  function drawOutcomes() {
    const tb = $('out-body');
    const rows = D.outcomes.slice(0, 500);
    const frag = document.createDocumentFragment();
    rows.forEach((o) => {
      const tr = document.createElement('tr');
      tr.append(td(o.ticker), td(armLabel(o.arm)), pill(o.direction), td(o.horizon), td(fmt.ret(o.factor_adj), 'n'),
        td(fmt.day(o.known_at), 'opt'));
      frag.appendChild(tr);
    });
    tb.replaceChildren(frag);
    if (!rows.length) emptyRow(tb, 6, 'No outcomes yet.');
  }

  /* ---------- spend ---------- */
  function drawSpend() {
    const el = $('spend-chart'), note = $('spend-note');
    el.replaceChildren();
    if (!D.spend) {
      note.textContent = 'No AI spend yet: the AI reading step (milestone 5) has not started. Spend against the monthly cap shows here once it does.';
      return;
    }
    const months = D.spend.months, cap = D.spend.cap_usd;
    note.textContent = `Monthly AI spend against the ${fmt.usd(cap)} cap.`;
    if (!months.length) return;
    const W = Math.max(280, el.clientWidth), rowH = 26, labelW = 72, H = months.length * rowH + 22;
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', 'Monthly AI spend against the cap');
    const x = d3.scaleLinear().domain([0, Math.max(cap, d3.max(months, (m) => m.cost_usd))]).range([labelW, W - 70]);
    const g = svg.selectAll('g.m').data(months).join('g').attr('class', 'm').attr('transform', (m, i) => `translate(0,${i * rowH + 18})`);
    g.append('text').attr('x', 0).attr('y', rowH / 2).attr('dy', '0.32em').attr('font-size', 12).style('fill', 'var(--ink-2)').text((m) => m.month);
    g.append('rect').attr('x', labelW).attr('y', 4).attr('height', rowH - 8).attr('width', (m) => Math.max(1, x(m.cost_usd) - labelW))
      .style('fill', (m) => (m.cost_usd > cap ? 'var(--bad)' : 'var(--series-1)'));
    g.append('text').attr('x', (m) => x(m.cost_usd) + 4).attr('y', rowH / 2).attr('dy', '0.32em').attr('font-size', 11)
      .style('fill', 'var(--ink-2)').text((m) => fmt.usd(m.cost_usd));
    svg.append('line').attr('x1', x(cap)).attr('x2', x(cap)).attr('y1', 14).attr('y2', H).style('stroke', 'var(--bench)')
      .style('stroke-dasharray', '4 3');
    svg.append('text').attr('x', x(cap)).attr('y', 10).attr('text-anchor', 'middle').attr('font-size', 11)
      .style('fill', 'var(--ink-2)').text(`cap ${fmt.usd(cap)}`);
  }
})();
